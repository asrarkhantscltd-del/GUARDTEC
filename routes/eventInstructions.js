// Event instructions and the public acknowledgment (e-signature) forms.
//
// Registered from server.js: require('./routes/eventInstructions')(deps)

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

module.exports = function registerEventInstructionsRoutes(deps) {
  var BASE_URL = deps.BASE_URL,
    EVENT_INSTRUCTIONS_DOCS_DIR = deps.EVENT_INSTRUCTIONS_DOCS_DIR,
    app = deps.app,
    authRateLimiter = deps.authRateLimiter,
    getSiteById = deps.getSiteById,
    pgPool = deps.pgPool,
    requireLogin = deps.requireLogin,
    requirePermission = deps.requirePermission,
    requireRole = deps.requireRole;

  // ── EVENT INSTRUCTIONS & ACKNOWLEDGMENT FORMS (Feature 2) ─────────────────────
  // Covers BOTH agency cover guards and GuardTec's own staff — one consolidated
  // acknowledgment_forms table, one link-generation mechanism, two respondent
  // types (debug notes #3/#4). Instructions stand alone or link to a site —
  // site_id TEXT, same id space as agency_deployments.site_id — now backed by
  // a real `sites` row (see ensureSitesSchema/migrate-sites.js) with a real FK
  // added once that migration has run (ensureSiteForeignKeysSchema); respondent_id
  // is still resolved at the app layer, unrelated to the site_id question.

  // Generates one secure, single-use link for one respondent — a deployment's
  // guards, or a list of GuardTec staff, always get their own individually
  // tracked link (2.1: "one link per person, not one shared link"), never a
  // shared one. 256-bit token, 5-minute expiry. This inserted row is the ONLY
  // source of truth for both: the ?expires= query param on the returned URL is
  // DISPLAY ONLY (a client-side countdown) — validation never reads anything
  // from the URL itself, only link_expires_at from the DB (debug note #9).
  // Kept in sync with the acknowledgment_forms.respondent_type CHECK constraint
  // (widened in ensureEventInstructionsSchema to add driver/manager) — found via
  // testing that the DB accepted the wider set while this function still
  // silently rejected two of them, making Driver/Manager audience selection a
  // dead end at the API layer despite compiling and looking correct end to end.
  var VALID_RESPONDENT_TYPES = ['agency_staff', 'employee', 'driver', 'manager'];

  async function generateFormLink(instructionId, respondentType, respondentId, deploymentId) {
    if (VALID_RESPONDENT_TYPES.indexOf(respondentType) === -1) {
      throw { status: 400, error: 'respondentType must be one of: ' + VALID_RESPONDENT_TYPES.join(', ') + '.' };
    }

    var versionResult = await pgPool.query('SELECT version FROM event_instructions WHERE id = $1', [instructionId]);
    if (!versionResult.rows.length) throw { status: 404, error: 'Instruction not found.' };
    var instructionVersion = versionResult.rows[0].version;

    // respondent_name_snapshot is captured here, at send time — same "no FK,
    // resolved at the app layer" reasoning as respondent_id itself.
    var name = null;
    if (respondentType === 'agency_staff') {
      var agencyStaffResult = await pgPool.query('SELECT name FROM agency_staff WHERE id = $1', [respondentId]);
      if (agencyStaffResult.rows.length) name = agencyStaffResult.rows[0].name;
    } else {
      var employeeResult = await pgPool.query('SELECT name FROM employees WHERE legacy_id = $1', [respondentId]);
      if (employeeResult.rows.length) name = employeeResult.rows[0].name;
    }
    if (name === null) throw { status: 404, error: 'Respondent not found: ' + respondentType + ' ' + respondentId };

    var token = crypto.randomBytes(32).toString('hex'); // 256 bits — brute force is not realistic
    var expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await pgPool.query(
      `INSERT INTO acknowledgment_forms
       (instruction_id, instruction_version, deployment_id, respondent_type, respondent_id, respondent_name_snapshot, form_token, link_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [instructionId, instructionVersion, deploymentId || null, respondentType, String(respondentId), name, token, expiresAt]
    );

    return BASE_URL + '/acknowledge/' + token + '?expires=' + expiresAt.getTime();
  }

  // ── ADMIN: EVENT INSTRUCTIONS (create/publish) ────────────────────────────────
  app.post('/api/event-instructions', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var b = req.body || {};
      var title = String(b.title || '').trim();
      if (!title) return res.status(400).json({ ok: false, error: 'title is required.' });

      var siteId = b.site_id ? String(b.site_id).trim() : '';
      if (siteId && !(await getSiteById(siteId))) return res.status(400).json({ ok: false, error: 'Unknown site_id.' });

      var status = b.status === 'published' ? 'published' : 'draft';
      var requirements = Array.isArray(b.requirements) ? b.requirements : [];

      var r = await pgPool.query(
        `INSERT INTO event_instructions
         (site_id, event_date, title, instructions_html, requirements, document_file_url, document_mime_type, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [siteId || null, b.event_date || null, title, b.instructions_html || null,
         JSON.stringify(requirements), b.document_file_url || null, b.document_mime_type || null,
         req.user.id, status]
      );
      res.json({ ok: true, instruction: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/event-instructions', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var conditions = [];
      var params = [];
      if (req.query.site_id) { params.push(req.query.site_id); conditions.push('site_id = $' + params.length); }
      if (req.query.status) {
        params.push(req.query.status); conditions.push('status = $' + params.length);
      } else {
        // No explicit status filter -> exclude archived by default, same as
        // every other list endpoint in this app (agencies, agency_staff).
        // Found via testing: a caller with no filters at all was getting
        // archived instructions back, relying entirely on the frontend to
        // filter them out client-side rather than having a sane default here.
        conditions.push("status != 'archived'");
      }

      var sql = 'SELECT * FROM event_instructions' +
        (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '') +
        ' ORDER BY created_at DESC';
      var result = await pgPool.query(sql, params);
      var instructions = await Promise.all(result.rows.map(async function(row) { row.site = row.site_id ? await getSiteById(row.site_id) : null; return row; }));
      res.json({ ok: true, instructions: instructions });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/event-instructions/:id', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT * FROM event_instructions WHERE id = $1', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Instruction not found.' });
      var instruction = r.rows[0];
      instruction.site = instruction.site_id ? await getSiteById(instruction.site_id) : null;

      var formsResult = await pgPool.query(
        `SELECT id, respondent_type, respondent_id, respondent_name_snapshot, instruction_version,
              link_expires_at, form_opened_at, signed_at, current_step
       FROM acknowledgment_forms WHERE instruction_id = $1 ORDER BY created_at DESC`,
        [req.params.id]
      );
      res.json({ ok: true, instruction: instruction, forms: formsResult.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Renders one signed acknowledgment as a standalone, print-friendly HTML
  // page — the instruction content plus signer name/date/IP and the captured
  // signature image, all in one document. Opening it and using the browser's
  // Print → Save as PDF is the "copy of their signed document" a director can
  // keep/export; no PDF-generation dependency needed for that. 404s (rather
  // than a 200 with an "unsigned" message) if the form hasn't been signed yet,
  // so a stray link never looks like proof of something that didn't happen.
  app.get('/api/event-instructions/:id/acknowledgments/:formId/document', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var instrResult = await pgPool.query('SELECT * FROM event_instructions WHERE id = $1', [req.params.id]);
      if (!instrResult.rows.length) return res.status(404).send('Instruction not found.');
      var instruction = instrResult.rows[0];

      var formResult = await pgPool.query(
        'SELECT * FROM acknowledgment_forms WHERE id = $1 AND instruction_id = $2',
        [req.params.formId, req.params.id]
      );
      if (!formResult.rows.length) return res.status(404).send('Acknowledgment record not found.');
      var form = formResult.rows[0];
      if (!form.signed_at) return res.status(404).send('This form has not been signed yet.');

      var site = instruction.site_id ? await getSiteById(instruction.site_id) : null;
      var signedAtStr = new Date(form.signed_at).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
      var signatureImg = form.signature_data && form.signature_data.indexOf('data:image') === 0
        ? '<img src="' + form.signature_data + '" alt="Signature" style="max-width:320px;border:1px solid #ddd;border-radius:4px;padding:8px;background:#fff" />'
        : '<p style="color:#888;font-style:italic">No signature image captured.</p>';

      function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(
        '<!doctype html><html><head><meta charset="utf-8"><title>Signed Acknowledgment — ' + esc(instruction.title) + '</title>' +
        '<style>body{font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:32px auto;padding:0 20px;color:#1a1a1a;line-height:1.5}' +
        'h1{font-size:20px;border-bottom:2px solid #c00;padding-bottom:10px}h2{font-size:14px;color:#555;margin-top:28px}' +
        '.meta{background:#f7f7f7;border-radius:6px;padding:14px 18px;margin:16px 0;font-size:14px}' +
        '.meta div{margin:3px 0}.instructions{border:1px solid #eee;border-radius:6px;padding:16px 18px;margin:10px 0}' +
        '@media print{body{margin:0}}</style></head><body>' +
        '<h1>Signed Acknowledgment</h1>' +
        '<div class="meta">' +
          '<div><strong>Instruction:</strong> ' + esc(instruction.title) + '</div>' +
          (site ? '<div><strong>Site:</strong> ' + esc(site.name) + '</div>' : '') +
          (instruction.event_date ? '<div><strong>Event date:</strong> ' + esc(instruction.event_date) + '</div>' : '') +
          '<div><strong>Version acknowledged:</strong> ' + esc(form.instruction_version) + '</div>' +
        '</div>' +
        '<h2>Instructions as read and signed</h2>' +
        '<div class="instructions">' + (instruction.instructions_html || '<p><em>No content.</em></p>') + '</div>' +
        '<h2>Signature</h2>' +
        '<div class="meta">' +
          '<div><strong>Signed by:</strong> ' + esc(form.signer_name) + '</div>' +
          '<div><strong>Signed at:</strong> ' + esc(signedAtStr) + '</div>' +
          '<div><strong>IP address:</strong> ' + esc(form.ip_address || 'unknown') + '</div>' +
        '</div>' +
        signatureImg +
        '</body></html>'
      );
    } catch (e) {
      res.status(500).send('Error generating document: ' + e.message);
    }
  });

  // Cancels an un-signed acknowledgment link — e.g. sent to the wrong person,
  // or the guard never opened it and a fresh link is needed. Blocked once
  // signed_at is set: a signed form is compliance proof (same reasoning as
  // the event-instruction permanent-delete guard above), so this route can
  // only ever remove links nobody has actually acknowledged yet.
  app.delete('/api/event-instructions/:id/acknowledgments/:formId', requireLogin, requirePermission('delete_staff'), async function(req, res) {
    try {
      var formResult = await pgPool.query(
        'SELECT signed_at FROM acknowledgment_forms WHERE id = $1 AND instruction_id = $2',
        [req.params.formId, req.params.id]
      );
      if (!formResult.rows.length) return res.status(404).json({ ok: false, error: 'Acknowledgment link not found.' });
      if (formResult.rows[0].signed_at) {
        return res.status(400).json({ ok: false, error: 'This link has already been signed and is a compliance record — it cannot be deleted.' });
      }
      await pgPool.query('DELETE FROM acknowledgment_forms WHERE id = $1', [req.params.formId]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/event-instructions/:id', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var existing = await pgPool.query('SELECT * FROM event_instructions WHERE id = $1', [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Instruction not found.' });
      var current = existing.rows[0];

      var b = req.body || {};
      var allowedStatuses = ['draft', 'published', 'archived'];
      if (b.status !== undefined && allowedStatuses.indexOf(b.status) === -1) {
        return res.status(400).json({ ok: false, error: 'status must be one of: ' + allowedStatuses.join(', ') });
      }
      var siteIdVal = current.site_id;
      if (b.site_id !== undefined) {
        siteIdVal = String(b.site_id || '').trim() || null;
        if (siteIdVal && !(await getSiteById(siteIdVal))) return res.status(400).json({ ok: false, error: 'Unknown site_id.' });
      }

      var title            = b.title !== undefined ? String(b.title).trim() : current.title;
      var eventDate         = b.event_date !== undefined ? (b.event_date || null) : current.event_date;
      var instructionsHtml  = b.instructions_html !== undefined ? b.instructions_html : current.instructions_html;
      var requirements      = b.requirements !== undefined ? (Array.isArray(b.requirements) ? b.requirements : []) : current.requirements;
      var documentFileUrl   = b.document_file_url !== undefined ? b.document_file_url : current.document_file_url;
      var documentMimeType  = b.document_mime_type !== undefined ? b.document_mime_type : current.document_mime_type;
      var status            = b.status !== undefined ? b.status : current.status;
      // Re-acknowledgment on version bump needs no invalidation logic (2.2) —
      // instruction_version is a snapshot on each acknowledgment_forms row, so
      // bumping version here just means nobody has signed at the new version
      // yet; existing signed rows stand as an accurate record of what was
      // signed for the version that was current at the time.
      var version = b.bump_version === true ? current.version + 1 : current.version;

      var r = await pgPool.query(
        `UPDATE event_instructions
       SET title = $1, site_id = $2, event_date = $3, instructions_html = $4, requirements = $5,
           document_file_url = $6, document_mime_type = $7, status = $8, version = $9
       WHERE id = $10 RETURNING *`,
        [title, siteIdVal, eventDate, instructionsHtml, JSON.stringify(requirements),
         documentFileUrl, documentMimeType, status, version, req.params.id]
      );
      res.json({ ok: true, instruction: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Dedicated soft-delete for event instructions (Stage 2). Never a hard
  // DELETE: acknowledgment_forms rows can point at an instruction via
  // instruction_id, and a signed acknowledgment form is compliance/audit proof
  // that must survive — same reasoning this file already applies to agencies
  // and agency_staff (archived, never hard-deleted). status already accepts
  // 'archived' via the generic PATCH above; this route exists purely so the
  // frontend has a clear, discoverable "delete" action instead of reaching for
  // PATCH with a magic status string.
  app.post('/api/event-instructions/:id/archive', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var r = await pgPool.query(
        "UPDATE event_instructions SET status = 'archived' WHERE id = $1 RETURNING *",
        [req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Instruction not found.' });
      res.json({ ok: true, instruction: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Mirror of archive — brings an instruction back to 'draft' (deliberately
  // not straight back to 'published': re-showing it to guards/staff should be
  // a second, explicit decision, not an automatic side effect of restoring).
  app.post('/api/event-instructions/:id/restore', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var r = await pgPool.query(
        "UPDATE event_instructions SET status = 'draft' WHERE id = $1 AND status = 'archived' RETURNING *",
        [req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Archived instruction not found.' });
      res.json({ ok: true, instruction: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Hard delete — deliberately narrower than the Custom Forms one: only
  // allowed once an instruction is already archived (delete lives inside the
  // archive view, not next to the everyday Archive action), AND only when no
  // acknowledgment_forms rows exist against it. A signed acknowledgment is
  // compliance/audit proof a guard was briefed — that must survive even if the
  // instruction itself is being cleaned up, so we refuse rather than cascade.
  app.delete('/api/event-instructions/:id', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var existing = await pgPool.query('SELECT id, status FROM event_instructions WHERE id = $1', [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Instruction not found.' });
      if (existing.rows[0].status !== 'archived') {
        return res.status(400).json({ ok: false, error: 'Archive this instruction before permanently deleting it.' });
      }
      var ackCount = await pgPool.query('SELECT COUNT(*)::int AS n FROM acknowledgment_forms WHERE instruction_id = $1', [req.params.id]);
      if (ackCount.rows[0].n > 0) {
        return res.status(400).json({
          ok: false,
          error: 'Cannot permanently delete — ' + ackCount.rows[0].n + ' acknowledgment record(s) exist for this instruction and must be kept as compliance proof. Leave it archived instead.'
        });
      }
      await pgPool.query('DELETE FROM event_instructions WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  function findEventInstructionDoc(instructionId) {
    var exts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    for (var e of exts) {
      var fp = path.join(EVENT_INSTRUCTIONS_DOCS_DIR, instructionId + e);
      if (fs.existsSync(fp)) return fp;
    }
    return null;
  }

  app.post('/api/event-instructions/:id/document', requireLogin, requirePermission('staff'), async function(req, res) {
    var instructionId = path.basename(req.params.id);
    try {
      var check = await pgPool.query('SELECT id FROM event_instructions WHERE id = $1', [instructionId]);
      if (!check.rows.length) return res.status(404).json({ ok: false, error: 'Instruction not found.' });

      var chunks = [];
      req.on('data', function(c) { chunks.push(c); });
      req.on('end', async function() {
        try {
          var buf = Buffer.concat(chunks);
          // Detect file type from magic bytes — same convention as the agency document routes above.
          var ext = '.pdf';
          var mime = 'application/pdf';
          if (buf[0] === 0x89 && buf[1] === 0x50) { ext = '.png'; mime = 'image/png'; }
          else if (buf[0] === 0xFF && buf[1] === 0xD8) { ext = '.jpg'; mime = 'image/jpeg'; }

          // Remove any existing file for this instruction before writing the new one.
          ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
            var old = path.join(EVENT_INSTRUCTIONS_DOCS_DIR, instructionId + e);
            if (fs.existsSync(old)) fs.unlinkSync(old);
          });
          fs.writeFileSync(path.join(EVENT_INSTRUCTIONS_DOCS_DIR, instructionId + ext), buf);

          var documentUrl = '/api/event-instructions/' + instructionId + '/document';
          var r = await pgPool.query(
            'UPDATE event_instructions SET document_file_url = $1, document_mime_type = $2 WHERE id = $3 RETURNING *',
            [documentUrl, mime, instructionId]
          );
          console.log('[EVENT INSTRUCTIONS] Saved document for instruction', instructionId);
          res.json({ ok: true, instruction: r.rows[0] });
        } catch (e) {
          res.status(500).json({ ok: false, error: e.message });
        }
      });
      req.on('error', function() {
        res.status(500).json({ ok: false, error: 'Upload failed.' });
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/event-instructions/:id/document', requireLogin, requirePermission('staff'), function(req, res) {
    var instructionId = path.basename(req.params.id);
    try {
      var fp = findEventInstructionDoc(instructionId);
      if (!fp) return res.status(404).end();
      var ext = path.extname(fp).toLowerCase();
      var mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', 'inline; filename="' + instructionId + ext + '"');
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(fp));
    } catch (e) {
      res.status(500).end();
    }
  });

  // Generates individually-tracked links for a deployment's guards, an explicit
  // respondent list (agency guards and/or GuardTec staff, mixed), or both —
  // EventInstructionsPanel's "generate links for a deployment OR a list of
  // employees" (2.3), backed by generateFormLink() above.
  app.post('/api/event-instructions/:id/links', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var instructionCheck = await pgPool.query('SELECT id FROM event_instructions WHERE id = $1', [req.params.id]);
      if (!instructionCheck.rows.length) return res.status(404).json({ ok: false, error: 'Instruction not found.' });

      var b = req.body || {};
      var deploymentId = b.deployment_id ? String(b.deployment_id).trim() : null;
      var respondents = Array.isArray(b.respondents) ? b.respondents : [];

      // No explicit respondent list but a deployment was given — default to
      // every guard currently assigned to that deployment.
      if (!respondents.length && deploymentId) {
        var attendanceResult = await pgPool.query('SELECT agency_staff_id FROM deployment_attendance WHERE deployment_id = $1', [deploymentId]);
        respondents = attendanceResult.rows.map(function(row) { return { respondent_type: 'agency_staff', respondent_id: row.agency_staff_id }; });
      }
      if (!respondents.length) {
        return res.status(400).json({ ok: false, error: 'Provide a deployment_id (with assigned guards) or an explicit respondents list.' });
      }

      var links = [];
      for (var i = 0; i < respondents.length; i++) {
        var respondentType = String(respondents[i].respondent_type || '');
        var respondentId   = String(respondents[i].respondent_id || '');
        if (!respondentId) return res.status(400).json({ ok: false, error: 'Every respondent needs a respondent_id.' });
        var url = await generateFormLink(req.params.id, respondentType, respondentId, deploymentId);
        links.push({ respondent_type: respondentType, respondent_id: respondentId, url: url });
      }
      res.json({ ok: true, links: links });
    } catch (e) {
      if (e && e.status) return res.status(e.status).json({ ok: false, error: e.error });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── PUBLIC: ACKNOWLEDGMENT FORM (unauthenticated by design) ───────────────────
  // No requireLogin gate on any of the three routes below, same lightweight
  // pattern as /api/login and /api/register — and all three are exempted from
  // the CSRF double-submit check above. Reasoning is different from
  // login/register though: this isn't "there's no session yet", it's "there is
  // deliberately never going to be a session here at all" — the 256-bit token
  // in the URL IS the security boundary (plan's Key Security Considerations
  // #2). Reached only via the link generateFormLink() hands out; there is no
  // listing/browsing route for these.

  // Shared read-only validation for the view + progress-update routes below —
  // mirrors the plan's validateFormAccess exactly (404 unknown token, 403
  // expired, 403 already-signed). The sign route further down deliberately does
  // NOT use this: it must be a single atomic conditional UPDATE, never a
  // check-then-write (debug note #8), so it re-implements its own WHERE clause
  // instead of calling through this SELECT-based helper.
  async function loadAckFormOrThrow(token) {
    var r = await pgPool.query('SELECT * FROM acknowledgment_forms WHERE form_token = $1', [token]);
    if (!r.rows.length) throw { status: 404, error: 'Invalid link.' };
    var form = r.rows[0];
    if (new Date(form.link_expires_at) < new Date()) throw { status: 403, error: 'This link has expired.' };
    if (form.signed_at) throw { status: 403, error: 'This form has already been signed.' };
    return form;
  }

  app.get('/api/acknowledge/:token', async function(req, res) {
    try {
      var form = await loadAckFormOrThrow(req.params.token);

      // First open — audit trail (2.5). Guarded by IS NULL so a re-open never
      // overwrites the original open time.
      if (!form.form_opened_at) {
        var opened = await pgPool.query(
          'UPDATE acknowledgment_forms SET form_opened_at = NOW() WHERE id = $1 AND form_opened_at IS NULL RETURNING *',
          [form.id]
        );
        if (opened.rows.length) form = opened.rows[0];
      }

      var instructionResult = await pgPool.query('SELECT * FROM event_instructions WHERE id = $1', [form.instruction_id]);
      res.json({ ok: true, form: form, instruction: instructionResult.rows[0] || null });
    } catch (err) {
      if (err && err.status) return res.status(err.status).json({ ok: false, error: err.error });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/acknowledge/:token/progress', async function(req, res) {
    try {
      var form = await loadAckFormOrThrow(req.params.token);

      var b = req.body || {};
      var currentStep = Number(b.current_step);
      if (!Number.isFinite(currentStep) || currentStep < 0) {
        return res.status(400).json({ ok: false, error: 'current_step must be a non-negative number.' });
      }
      var readDuration = (b.read_duration_seconds !== undefined && b.read_duration_seconds !== null) ? Number(b.read_duration_seconds) : null;

      // current_step only ever moves forward (2.5: "current_step only moves
      // forward") — GREATEST() so a stale/out-of-order request (e.g. a slow
      // duplicate tab) can never rewind progress already made. Re-checks
      // expiry/signed state in the WHERE clause too, so a form that expired or
      // got signed in the gap since loadAckFormOrThrow() above can't be
      // touched here either.
      var r = await pgPool.query(
        `UPDATE acknowledgment_forms
       SET current_step = GREATEST(current_step, $1), read_duration_seconds = COALESCE($2, read_duration_seconds)
       WHERE id = $3 AND link_expires_at > NOW() AND signed_at IS NULL
       RETURNING *`,
        [currentStep, readDuration, form.id]
      );
      if (!r.rows.length) return res.status(403).json({ ok: false, error: 'Link expired or already used.' });
      res.json({ ok: true, form: r.rows[0] });
    } catch (err) {
      if (err && err.status) return res.status(err.status).json({ ok: false, error: err.error });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/acknowledge/:token/sign', authRateLimiter, async function(req, res) {
    try {
      var token = String(req.params.token || '');
      var b = req.body || {};
      var signerName = String(b.signer_name || '').trim();
      if (!signerName) return res.status(400).json({ ok: false, error: 'signer_name is required.' });
      var signatureData = b.signature_data ? String(b.signature_data) : null;
      var ipAddress = req.ip || null;
      var userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']) : null;

      // Single atomic conditional UPDATE — no separate SELECT-then-UPDATE. If
      // two sign requests for the same token race each other, both reach this
      // statement, but only the one that still finds signed_at IS NULL at
      // commit time actually updates a row — so exactly one gets rowCount = 1
      // and the loser gets 0, closing the race in debug note #8.
      var r = await pgPool.query(
        `UPDATE acknowledgment_forms
       SET signed_at = NOW(), signer_name = $1, signature_data = $2,
           ip_address = $3, user_agent = $4, form_read_at = COALESCE(form_read_at, NOW())
       WHERE form_token = $5 AND link_expires_at > NOW() AND signed_at IS NULL
       RETURNING *`,
        [signerName, signatureData, ipAddress, userAgent, token]
      );
      if (r.rowCount === 0) {
        return res.status(403).json({ ok: false, error: 'Link expired or already used.' });
      }
      res.json({ ok: true, form: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};
