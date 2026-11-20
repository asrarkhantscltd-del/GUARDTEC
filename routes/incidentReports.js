// Incident reports, moderation and attachments.
//
// Registered from server.js: require('./routes/incidentReports')(deps)

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

module.exports = function registerIncidentReportsRoutes(deps) {
  var ALLOWED_ATTACH_MIME = deps.ALLOWED_ATTACH_MIME,
    INCIDENT_ATTACH_DIR = deps.INCIDENT_ATTACH_DIR,
    MAX_ATTACH_SIZE = deps.MAX_ATTACH_SIZE,
    app = deps.app,
    canAccessOwnerEmpId = deps.canAccessOwnerEmpId,
    createNotification = deps.createNotification,
    logAuditEvent = deps.logAuditEvent,
    pgPool = deps.pgPool,
    requireLogin = deps.requireLogin,
    requirePermission = deps.requirePermission,
    requireRole = deps.requireRole,
    resolveEmpId = deps.resolveEmpId;

  // ── Incident Reports: submit (any logged-in staff member) ──
  app.post('/api/incident-reports', requireLogin, async function(req, res) {
    try {
      var b = req.body;
      if (!b.incident_type || !b.description) {
        return res.status(400).json({ ok: false, error: 'incident_type and description are required.' });
      }
      var reporterId = null;
      var reporterName = null;
      if (!b.is_anonymous && req.user.staff_id) {
        var empResult = await pgPool.query('SELECT id, name FROM employees WHERE legacy_id = $1', [req.user.staff_id]);
        if (empResult.rows.length) { reporterId = empResult.rows[0].id; reporterName = empResult.rows[0].name; }
      }
      var result = await pgPool.query(
        `INSERT INTO incident_reports
         (reporter_id, is_anonymous, report_date, site_location, incident_type, against_person, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          b.is_anonymous ? null : reporterId,
          !!b.is_anonymous,
          b.report_date || new Date().toISOString().slice(0, 10),
          b.site_location || null,
          b.incident_type,
          b.against_person || null,
          b.description,
        ]
      );
      createNotification({
        type: 'incident_report',
        actorName: b.is_anonymous ? 'Anonymous' : (reporterName || 'A staff member'),
        summary: 'submitted an incident report',
        linkIncidentId: result.rows[0].id,
      });
      res.json({ ok: true, report: result.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Incident Reports: staff view their own submitted reports ──
  app.get('/api/my-incident-reports', requireLogin, requireRole('staff'), async function(req, res) {
    try {
      if (!req.user.staff_id) return res.json({ ok: true, reports: [] });
      var empId = await resolveEmpId(req.user.staff_id);
      if (!empId) return res.json({ ok: true, reports: [] });
      var result = await pgPool.query(
        `SELECT ir.id, ir.is_anonymous, ir.report_date, ir.site_location, ir.incident_type, ir.against_person, ir.description, ir.status, ir.resolution_notes, ir.created_at,
              COUNT(ia.id)::int AS attachment_count
       FROM incident_reports ir
       LEFT JOIN incident_attachments ia ON ia.incident_id = ir.id
       WHERE ir.reporter_id = $1
       GROUP BY ir.id ORDER BY ir.created_at DESC`,
        [empId]
      );
      res.json({ ok: true, reports: result.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Incident Reports: management — view all ──
  app.get('/api/incident-reports', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      // Flagged (inappropriate-content) reports are hidden from the normal
      // queue for everyone by default — director-only, and only on request,
      // since reviewing them is a deliberate moderation action, not routine
      // triage. Never based on reporter identity (there isn't one to filter
      // on) — purely the report's own flagged_inappropriate column.
      var includeFlagged = req.query.includeFlagged === 'true' && req.user.role === 'director';
      var result = await pgPool.query(
        `SELECT ir.*,
         CASE WHEN ir.is_anonymous THEN NULL ELSE e.name END AS reporter_name,
         u.full_name AS reviewed_by_name,
         fb.full_name AS flagged_by_name,
         COUNT(ia.id)::int AS attachment_count
       FROM incident_reports ir
       LEFT JOIN employees e ON e.id = ir.reporter_id
       LEFT JOIN users u ON u.id = ir.reviewed_by
       LEFT JOIN users fb ON fb.id = ir.flagged_by
       LEFT JOIN incident_attachments ia ON ia.incident_id = ir.id
       WHERE ir.flagged_inappropriate = FALSE OR $1
       GROUP BY ir.id, e.name, u.full_name, fb.full_name
       ORDER BY ir.created_at DESC`,
        [includeFlagged]
      );
      res.json({ ok: true, reports: result.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Incident Reports: management — update status ──
  app.patch('/api/incident-reports/:reportId', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var b = req.body;
      await pgPool.query(
        `UPDATE incident_reports
       SET status = COALESCE($1, status),
           resolution_notes = COALESCE($2, resolution_notes),
           reviewed_by = $3,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
        [b.status || null, b.resolution_notes || null, req.user.id, req.params.reportId]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Director-only content moderation — flags a report as inappropriate (e.g.
  // abusive language) to pull it out of the normal management queue. Operates
  // solely on the report row; never touches reporter_id/is_anonymous, so an
  // anonymous submitter's identity is never at risk of exposure through this
  // route, by design (see the schema comment above for why a "reveal identity"
  // feature was considered and deliberately rejected instead of this).
  app.patch('/api/incident-reports/:reportId/flag', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var reason = String((req.body && req.body.reason) || '').trim();
      var r = await pgPool.query(
        `UPDATE incident_reports
       SET flagged_inappropriate = TRUE, flagged_at = NOW(), flagged_by = $1, flagged_reason = $2, updated_at = NOW()
       WHERE id = $3 RETURNING id`,
        [req.user.id, reason || null, req.params.reportId]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Report not found.' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Reverses a flag made in error — same director-only, identity-blind scope.
  app.patch('/api/incident-reports/:reportId/unflag', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var r = await pgPool.query(
        `UPDATE incident_reports
       SET flagged_inappropriate = FALSE, flagged_at = NULL, flagged_by = NULL, flagged_reason = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING id`,
        [req.params.reportId]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Report not found.' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Hard delete — director-only, and only once a report is no longer active
  // (status 'resolved'/'closed'; not 'open'/'under_review') — "once it's been
  // reviewed", per the user's own framing. Incident reports can allege
  // harassment/discrimination/misconduct, so this isn't offered as a casual
  // action: gating on review-complete avoids a still-open complaint being
  // deleted before anyone's actually looked at it, and the deletion itself is
  // logged to audit_events (same pattern as /api/exstaff/permanent) so there's
  // still a trace even though the record itself is gone. reporter_id is never
  // read/logged here beyond what's already on the row — deleting doesn't
  // require or cause any extra exposure of an anonymous submitter's identity.
  app.delete('/api/incident-reports/:reportId', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT * FROM incident_reports WHERE id = $1', [req.params.reportId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Report not found.' });
      var report = r.rows[0];
      if (report.status !== 'resolved' && report.status !== 'closed') {
        return res.status(400).json({ ok: false, error: 'Only a resolved/closed report can be deleted — update its status first.' });
      }

      var attachments = await pgPool.query('SELECT filename FROM incident_attachments WHERE incident_id = $1', [req.params.reportId]);

      await pgPool.query('DELETE FROM incident_reports WHERE id = $1', [req.params.reportId]); // cascades incident_attachments rows
      attachments.rows.forEach(function(a) {
        try { fs.unlinkSync(path.join(INCIDENT_ATTACH_DIR, a.filename)); } catch (e) { /* file already gone — fine */ }
      });

      logAuditEvent(req, 'INCIDENT_REPORT_DELETED', 'incident_report', report.id, report.incident_type, { status: report.status, is_anonymous: report.is_anonymous, report_date: report.report_date });

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Upload attachment for an incident report
  app.post('/api/incident-reports/:reportId/attachments', requireLogin, async function(req, res) {
    var reportRow = await pgPool.query('SELECT reporter_id FROM incident_reports WHERE id = $1', [req.params.reportId]);
    if (!reportRow.rows.length) return res.status(404).json({ ok: false, error: 'Report not found.' });
    if (!await canAccessOwnerEmpId(req, res, reportRow.rows[0].reporter_id)) return;

    var mime = (req.headers['content-type'] || '').split(';')[0].trim();
    var ext = ALLOWED_ATTACH_MIME[mime];
    if (!ext) return res.status(400).json({ ok: false, error: 'File type not allowed.' });

    var originalName = decodeURIComponent(req.headers['x-original-name'] || 'attachment' + ext);
    var filename = crypto.randomUUID() + ext;
    var dest = path.join(INCIDENT_ATTACH_DIR, filename);

    var chunks = [];
    var total = 0;
    req.on('data', function(c) {
      total += c.length;
      if (total > MAX_ATTACH_SIZE) { req.destroy(); return res.status(413).json({ ok: false, error: 'File too large (max 100 MB).' }); }
      chunks.push(c);
    });
    req.on('end', async function() {
      try {
        var buf = Buffer.concat(chunks);
        fs.writeFileSync(dest, buf);
        var r = await pgPool.query(
          'INSERT INTO incident_attachments (incident_id, filename, original_name, mime_type, size_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id, filename, original_name, mime_type, size_bytes, uploaded_at',
          [req.params.reportId, filename, originalName, mime, buf.length]
        );
        res.json({ ok: true, attachment: r.rows[0] });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
    req.on('error', function() { res.status(500).json({ ok: false, error: 'Upload failed.' }); });
  });

  // List attachments for an incident report
  app.get('/api/incident-reports/:reportId/attachments', requireLogin, async function(req, res) {
    try {
      var reportRow = await pgPool.query('SELECT reporter_id FROM incident_reports WHERE id = $1', [req.params.reportId]);
      if (!reportRow.rows.length) return res.status(404).json({ ok: false, error: 'Report not found.' });
      if (!await canAccessOwnerEmpId(req, res, reportRow.rows[0].reporter_id)) return;
      var r = await pgPool.query(
        'SELECT id, filename, original_name, mime_type, size_bytes, uploaded_at FROM incident_attachments WHERE incident_id = $1 ORDER BY uploaded_at ASC',
        [req.params.reportId]
      );
      res.json({ ok: true, attachments: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Serve / download an attachment
  app.get('/api/incident-attachments/:filename', requireLogin, async function(req, res) {
    try {
      var safe = path.basename(req.params.filename);
      var owner = await pgPool.query(
        'SELECT ir.reporter_id FROM incident_attachments ia JOIN incident_reports ir ON ir.id = ia.incident_id WHERE ia.filename = $1',
        [safe]
      );
      if (!owner.rows.length) return res.status(404).end();
      if (!await canAccessOwnerEmpId(req, res, owner.rows[0].reporter_id)) return;
      var filePath = path.join(INCIDENT_ATTACH_DIR, safe);
      if (!fs.existsSync(filePath)) return res.status(404).end();
      res.sendFile(filePath);
    } catch (e) {
      res.status(500).end();
    }
  });

  // Delete an attachment (reporter or management)
  app.delete('/api/incident-attachments/:attachId', requireLogin, async function(req, res) {
    try {
      var r = await pgPool.query(
        'SELECT ia.filename, ir.reporter_id FROM incident_attachments ia JOIN incident_reports ir ON ir.id = ia.incident_id WHERE ia.id = $1',
        [req.params.attachId]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Not found.' });
      if (!await canAccessOwnerEmpId(req, res, r.rows[0].reporter_id)) return;
      var filePath = path.join(INCIDENT_ATTACH_DIR, r.rows[0].filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await pgPool.query('DELETE FROM incident_attachments WHERE id = $1', [req.params.attachId]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};
