// Agencies, agency cover guards, deployments, admin agency overview and manager directory.
//
// Registered from server.js: require('./routes/agencies')(deps)

var XLSX = require('xlsx');
var bcrypt = require('bcryptjs');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

module.exports = function registerAgenciesRoutes(deps) {
  var AGENCY_STAFF_CUSTOM_DOCS_DIR = deps.AGENCY_STAFF_CUSTOM_DOCS_DIR,
    AGENCY_STAFF_DOCS_DIR = deps.AGENCY_STAFF_DOCS_DIR,
    AGENCY_STAFF_PHOTOS_DIR = deps.AGENCY_STAFF_PHOTOS_DIR,
    BASE = deps.BASE,
    app = deps.app,
    daysFrom = deps.daysFrom,
    excelDate = deps.excelDate,
    findFileByExts = deps.findFileByExts,
    getSiteById = deps.getSiteById,
    logAuditEvent = deps.logAuditEvent,
    pgPool = deps.pgPool,
    requireLogin = deps.requireLogin,
    requireOwnAgencyOrPermission = deps.requireOwnAgencyOrPermission,
    requirePermission = deps.requirePermission,
    requireRole = deps.requireRole,
    sanitizeForExcel = deps.sanitizeForExcel,
    toISO = deps.toISO;

  // ── AGENCY MANAGEMENT ─────────────────────────────────────────────────────────
  // Admin side of the agency cover-guard feature. An agency's login is just a
  // users row with role='agency' + agency_id — same auth system as everyone
  // else (see requireOwnAgencyOrPermission above), no separate password system.
  function slugifyAgencyUsername(name) {
    return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'agency';
  }

  function generateTempPassword() {
    return crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  }

  app.post('/api/agencies', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var b = req.body;
      var name  = String(b.name  || '').trim();
      var email = String(b.email || '').trim().toLowerCase();
      var phone = String(b.phone || '').trim();

      if (!name)  return res.status(400).json({ ok: false, error: 'Agency name is required.' });
      if (!email) return res.status(400).json({ ok: false, error: 'Agency email is required.' });

      var agencyResult = await pgPool.query(
        'INSERT INTO agencies (name, email, phone, created_by) VALUES ($1,$2,$3,$4) RETURNING id, name, email, phone, status, created_at',
        [name, email, phone, req.user.id]
      );
      var agency = agencyResult.rows[0];

      var baseUsername = slugifyAgencyUsername(name);
      var username = baseUsername;
      var suffix = 1;
      while ((await pgPool.query('SELECT id FROM users WHERE username = $1', [username])).rows.length) {
        suffix++;
        username = baseUsername + suffix;
      }

      var tempPassword = generateTempPassword();
      var hash = await bcrypt.hash(tempPassword, 10);

      try {
        await pgPool.query(
          'INSERT INTO users (username, password_hash, full_name, role, email, is_active, agency_id) VALUES ($1,$2,$3,$4,$5,TRUE,$6)',
          [username, hash, name, 'agency', email, agency.id]
        );
      } catch (userErr) {
        // Login account creation failed — don't leave an orphaned agency row behind.
        await pgPool.query('DELETE FROM agencies WHERE id = $1', [agency.id]);
        throw userErr;
      }

      logAuditEvent(req, 'AGENCY_CREATED', 'agency', agency.id, agency.name, {});
      res.json({ ok: true, id: agency.id, login_username: username, temp_password: tempPassword });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/agencies', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var result = await pgPool.query(
        `SELECT a.id, a.name, a.email, a.phone, a.status, a.created_at,
              COUNT(s.id) FILTER (WHERE s.status = 'active') AS staff_count
       FROM agencies a
       LEFT JOIN agency_staff s ON s.agency_id = a.id
       GROUP BY a.id
       ORDER BY a.name`
      );
      res.json({ ok: true, agencies: result.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/agencies/:id', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var agencyResult = await pgPool.query(
        'SELECT id, name, email, phone, status, created_at, archived_at, notes FROM agencies WHERE id = $1',
        [req.params.id]
      );
      if (!agencyResult.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });

      var staffResult = await pgPool.query(
        'SELECT * FROM agency_staff WHERE agency_id = $1 ORDER BY name',
        [req.params.id]
      );
      var staffWithStatus = staffResult.rows.map(function(row) {
        row.compliance_status = calculateComplianceStatus(row);
        return row;
      });

      res.json({ ok: true, agency: agencyResult.rows[0], staff: staffWithStatus });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/agencies/:id', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var b = req.body;
      var name  = String(b.name  || '').trim();
      var email = String(b.email || '').trim().toLowerCase();
      var phone = String(b.phone || '').trim();

      if (!name)  return res.status(400).json({ ok: false, error: 'Agency name is required.' });
      if (!email) return res.status(400).json({ ok: false, error: 'Agency email is required.' });

      var r = await pgPool.query(
        'UPDATE agencies SET name=$1, email=$2, phone=$3 WHERE id=$4 RETURNING id, name, email, phone, status, created_at',
        [name, email, phone, req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });
      logAuditEvent(req, 'AGENCY_UPDATED', 'agency', req.params.id, r.rows[0].name, {});
      res.json({ ok: true, agency: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/agencies/:id/archive', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var r = await pgPool.query(
        "UPDATE agencies SET status='archived', archived_at=NOW() WHERE id=$1 RETURNING id",
        [req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });
      // Suspend the agency's own login too — an archived agency shouldn't still be able to sign in.
      await pgPool.query("UPDATE users SET is_active=FALSE WHERE agency_id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/agencies/:id/reactivate', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var r = await pgPool.query(
        "UPDATE agencies SET status='active', archived_at=NULL WHERE id=$1 RETURNING id",
        [req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });
      await pgPool.query("UPDATE users SET is_active=TRUE WHERE agency_id=$1", [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Permanent delete — director-only. Removes the agency, every one of its
  // guards (agency_staff cascades via agency_id ON DELETE CASCADE, which in
  // turn cascades unavailability/documents/custom_documents rows), the
  // agency's own login account, and every file on disk. Intended for purging
  // test/duplicate agencies, not routine offboarding — archive is that, and
  // stays available above.
  app.delete('/api/agencies/:id', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var agencyId = req.params.id;
      var agencyResult = await pgPool.query('SELECT * FROM agencies WHERE id = $1', [agencyId]);
      if (!agencyResult.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });
      var agency = agencyResult.rows[0];

      // agency_deployments.agency_id and deployment_attendance.agency_staff_id
      // both have NO cascade (real booking/attendance history) — check up
      // front rather than let the DELETE below fail with a raw Postgres
      // FK-violation message, same reasoning as the site-delete guard.
      var blockers = await pgPool.query(
        `SELECT (SELECT COUNT(*)::int FROM agency_deployments WHERE agency_id = $1) AS deployments,
              (SELECT COUNT(*)::int FROM deployment_attendance da JOIN agency_staff s ON s.id = da.agency_staff_id WHERE s.agency_id = $1) AS attendance`,
        [agencyId]
      );
      var bl = blockers.rows[0];
      if (bl.deployments > 0 || bl.attendance > 0) {
        var blParts = [];
        if (bl.deployments > 0) blParts.push(bl.deployments + ' deployment(s)');
        if (bl.attendance > 0) blParts.push(bl.attendance + ' attendance record(s)');
        return res.status(400).json({
          ok: false,
          error: 'Cannot delete this agency — ' + blParts.join(' and ') + ' still reference it. Remove those first, or archive the agency instead of deleting.'
        });
      }

      var staffRows = await pgPool.query('SELECT id FROM agency_staff WHERE agency_id = $1', [agencyId]);
      var customDocs = await pgPool.query(
        `SELECT d.agency_staff_id, d.filename FROM agency_staff_custom_documents d
       JOIN agency_staff s ON s.id = d.agency_staff_id
       WHERE s.agency_id = $1`, [agencyId]
      );
      var customDocsByStaff = {};
      customDocs.rows.forEach(function(d) {
        (customDocsByStaff[d.agency_staff_id] = customDocsByStaff[d.agency_staff_id] || []).push(d.filename);
      });

      await pgPool.query('DELETE FROM agencies WHERE id = $1', [agencyId]); // cascades agency_staff and its children
      await pgPool.query('DELETE FROM users WHERE agency_id = $1', [agencyId]); // the agency's own login

      staffRows.rows.forEach(function(s) {
        purgeAgencyStaffFiles(s.id, customDocsByStaff[s.id]);
      });

      logAuditEvent(req, 'AGENCY_DELETED', 'agency', agency.id, agency.name, { staff_count: staffRows.rows.length, status: agency.status });

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // CSV/XLSX headers can come in as "Job Role", "job_role", "JobRole", etc. —
  // normalize to a flat lowercase-alnum key before mapping onto our fields.
  function normalizeCsvRow(row) {
    var norm = {};
    Object.keys(row).forEach(function(k) {
      var key = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
      norm[key] = row[k];
    });
    return {
      name:        norm.name,
      email:       norm.email,
      phone:       norm.phone,
      nationality: norm.nationality,
      job_role:    norm.jobrole || norm.role,
      custom_role: norm.customrole,
      badge_type:  norm.badgetype,
      dbs_expiry:  norm.dbsexpiry !== undefined ? norm.dbsexpiry : norm.dbsexpirydate,
      sia_expiry:  norm.siaexpiry !== undefined ? norm.siaexpiry : norm.siaexpirydate,
      cscs_expiry: norm.cscsexpiry !== undefined ? norm.cscsexpiry : norm.cscsexpirydate,
    };
  }

  // Role-conditional BS7858 compliance (debug note #6) — a cert only counts
  // against a guard if their job_role actually requires it, so e.g. a Door
  // Supervisor is never flagged "incomplete" for a missing Dog Handler cert.
  // SIA expiry is unconditionally required for every guard as of 2026-08-20
  // (user's explicit decision — badge_type no longer gates this, it's kept
  // purely as informational metadata since a guard can hold other badges like
  // CCTV/Close Protection too). dbs_expiry became optional in the same change
  // — a blank one is no longer counted as a problem, but a present-and-expired
  // one still is, same as before. CSCS expiry became optional specifically for
  // Dog Handlers on 2026-08-28 (user's explicit decision) — still mandatory for
  // every other job role. Priority worst-first: EXPIRED beats INCOMPLETE beats
  // ACTION_NEEDED beats COMPLIANT.
  function expiryCheck(dateVal, requiredFlag) {
    if (!dateVal) return requiredFlag ? 'missing' : 'n/a';
    // daysFrom() takes anything `new Date()` accepts, which covers both a
    // plain date string and the JS Date object pg returns for a DATE column.
    var days = daysFrom(dateVal);
    if (days === null || isNaN(days)) return requiredFlag ? 'missing' : 'n/a';
    if (days < 0) return 'expired';
    if (days <= 30) return 'warning';
    return 'ok';
  }

  function calculateComplianceStatus(staff) {
    var required = {
      dbs: false,
      sia: true,
      cscs: staff.job_role !== 'Dog Handler',
      rtw: true,
      dog_handler: staff.job_role === 'Dog Handler',
      training: false,
    };

    var checks = {
      dbs:         expiryCheck(staff.dbs_expiry, required.dbs),
      sia:         !required.sia  ? 'n/a' : (staff.sia_cert_uploaded  ? 'ok' : 'missing'),
      sia_expiry:  expiryCheck(staff.sia_expiry, required.sia),
      cscs:        !required.cscs ? 'n/a' : (staff.cscs_cert_uploaded ? 'ok' : 'missing'),
      cscs_expiry: expiryCheck(staff.cscs_expiry, required.cscs),
      rtw:         !required.rtw         ? 'n/a' : (staff.rtw_cert_uploaded         ? 'ok' : 'missing'),
      dog_handler: !required.dog_handler ? 'n/a' : (staff.dog_handler_cert_uploaded ? 'ok' : 'missing'),
      training:    !required.training    ? 'n/a' : (staff.training_cert_uploaded    ? 'ok' : 'missing'),
    };

    var active = Object.keys(checks).map(function(k) { return checks[k]; }).filter(function(c) { return c !== 'n/a'; });
    if (active.indexOf('expired') !== -1) return 'EXPIRED';
    if (active.indexOf('missing') !== -1) return 'INCOMPLETE';
    if (active.indexOf('warning') !== -1) return 'ACTION_NEEDED';
    return 'COMPLIANT';
  }

  // ── Agency Staff: Registration (CRUD) ─────────────────────────────────────────
  app.post('/api/agencies/:agencyId/staff', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var agencyId = req.params.agencyId;
      var agencyCheck = await pgPool.query('SELECT id FROM agencies WHERE id = $1', [agencyId]);
      if (!agencyCheck.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });

      var b = req.body || {};
      var name    = String(b.name     || '').trim();
      var jobRole = String(b.job_role || '').trim();
      if (!name)    return res.status(400).json({ ok: false, error: 'Guard name is required.' });
      if (!jobRole) return res.status(400).json({ ok: false, error: 'Job role is required.' });
      // Attestation, not the guard's own click (no login exists for guards to
      // click anything themselves) — the agency confirms it has informed the
      // guard and obtained their consent before this record can be created.
      if (!b.consent_credit_check)       return res.status(400).json({ ok: false, error: 'You must confirm the guard has consented to a credit check.' });
      if (!b.consent_social_media_check) return res.status(400).json({ ok: false, error: 'You must confirm the guard has consented to a social media check.' });

      var email       = String(b.email       || '').trim().toLowerCase();
      var phone       = String(b.phone       || '').trim();
      var nationality = String(b.nationality || '').trim();
      var customRole  = String(b.custom_role || '').trim();
      var badgeType   = String(b.badge_type  || '').trim();
      var dbsExpiry   = b.dbs_expiry ? String(b.dbs_expiry).trim() : null;
      var siaExpiry   = b.sia_expiry  ? String(b.sia_expiry).trim()  : null;
      var cscsExpiry  = b.cscs_expiry ? String(b.cscs_expiry).trim() : null;
      // Mandatory for every guard regardless of badge_type — see the note on
      // calculateComplianceStatus. dbs_expiry deliberately has no such check.
      // cscs_expiry is the one exception: optional for Dog Handlers.
      if (!siaExpiry)  return res.status(400).json({ ok: false, error: 'SIA expiry is required.' });
      if (!cscsExpiry && jobRole !== 'Dog Handler') return res.status(400).json({ ok: false, error: 'CSCS expiry is required.' });

      var r = await pgPool.query(
        `INSERT INTO agency_staff (agency_id, name, email, phone, nationality, job_role, custom_role, badge_type, dbs_expiry, sia_expiry, cscs_expiry, consent_credit_check, consent_social_media_check)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,TRUE) RETURNING *`,
        [agencyId, name, email, phone, nationality, jobRole, customRole || null, badgeType || null, dbsExpiry, siaExpiry, cscsExpiry]
      );
      var staff = r.rows[0];
      staff.compliance_status = calculateComplianceStatus(staff);
      res.json({ ok: true, staff: staff });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/agencies/:agencyId/staff', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var includeArchived = req.query.status === 'all';
      var sql = 'SELECT * FROM agency_staff WHERE agency_id = $1' +
        (includeArchived ? '' : " AND status = 'active'") + ' ORDER BY name';
      var r = await pgPool.query(sql, [req.params.agencyId]);
      var staff = r.rows.map(function(row) {
        row.compliance_status = calculateComplianceStatus(row);
        return row;
      });
      res.json({ ok: true, staff: staff });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/agencies/:agencyId/staff/:id', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT * FROM agency_staff WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
      var staff = r.rows[0];
      staff.compliance_status = calculateComplianceStatus(staff);
      var unavail = await pgPool.query(
        'SELECT id, date_from, date_to, reason, created_at FROM agency_staff_unavailability WHERE agency_staff_id = $1 ORDER BY date_from',
        [req.params.id]
      );
      res.json({ ok: true, staff: staff, unavailability: unavail.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/agencies/:agencyId/staff/:id', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var existing = await pgPool.query('SELECT * FROM agency_staff WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
      var o = existing.rows[0];
      var b = req.body || {};

      var name        = String(b.name        !== undefined ? b.name        : o.name        || '').trim();
      var email       = String(b.email       !== undefined ? b.email       : o.email       || '').trim().toLowerCase();
      var phone       = String(b.phone       !== undefined ? b.phone       : o.phone       || '').trim();
      var nationality = String(b.nationality !== undefined ? b.nationality : o.nationality || '').trim();
      var jobRole     = String(b.job_role    !== undefined ? b.job_role    : o.job_role    || '').trim();
      var customRole  = String(b.custom_role !== undefined ? b.custom_role : o.custom_role || '').trim();
      var badgeType   = String(b.badge_type  !== undefined ? b.badge_type  : o.badge_type  || '').trim();
      var dbsExpiry   = b.dbs_expiry !== undefined ? (b.dbs_expiry || null) : o.dbs_expiry;
      var siaExpiry   = b.sia_expiry  !== undefined ? (b.sia_expiry  || null) : o.sia_expiry;
      var cscsExpiry  = b.cscs_expiry !== undefined ? (b.cscs_expiry || null) : o.cscs_expiry;

      if (!name)       return res.status(400).json({ ok: false, error: 'Guard name is required.' });
      if (!jobRole)    return res.status(400).json({ ok: false, error: 'Job role is required.' });
      if (!siaExpiry)  return res.status(400).json({ ok: false, error: 'SIA expiry is required.' });
      if (!cscsExpiry && jobRole !== 'Dog Handler') return res.status(400).json({ ok: false, error: 'CSCS expiry is required.' });

      var r = await pgPool.query(
        `UPDATE agency_staff SET name=$1, email=$2, phone=$3, nationality=$4, job_role=$5, custom_role=$6, badge_type=$7, dbs_expiry=$8, sia_expiry=$9, cscs_expiry=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
        [name, email, phone, nationality, jobRole, customRole || null, badgeType || null, dbsExpiry, siaExpiry, cscsExpiry, req.params.id]
      );
      var staff = r.rows[0];
      staff.compliance_status = calculateComplianceStatus(staff);
      res.json({ ok: true, staff: staff });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Soft delete only (debug note #7) — no hard DELETE, so deployment/acknowledgment
  // history for this guard stays queryable.
  app.post('/api/agencies/:agencyId/staff/:id/archive', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var r = await pgPool.query(
        "UPDATE agency_staff SET status='archived', archived_at=NOW() WHERE id=$1 AND agency_id=$2 RETURNING id",
        [req.params.id, req.params.agencyId]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Permanent delete — director-only. Unlike archive above, this actually
  // removes the row (and, via ON DELETE CASCADE, its unavailability/documents
  // rows) plus every file on disk. Intended for purging test/duplicate agency
  // guard records, not as a routine offboarding action — archive is that.
  app.delete('/api/agencies/:agencyId/staff/:id', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var agencyId = req.params.agencyId;
      var staffId  = req.params.id;
      var r = await pgPool.query('SELECT * FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, agencyId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
      var guard = r.rows[0];

      // deployment_attendance.agency_staff_id has NO cascade (it's real hours-
      // worked/no-show history feeding the agency performance stats) — check
      // for it up front rather than let the DELETE below fail with a raw
      // Postgres FK-violation message, same reasoning as the site-delete guard.
      var attendance = await pgPool.query('SELECT COUNT(*)::int AS n FROM deployment_attendance WHERE agency_staff_id = $1', [staffId]);
      if (attendance.rows[0].n > 0) {
        return res.status(400).json({
          ok: false,
          error: 'Cannot delete ' + guard.name + ' — ' + attendance.rows[0].n + ' deployment attendance record(s) reference them. Remove those attendance entries from the relevant deployment(s) first, or archive this guard instead of deleting.'
        });
      }

      var customDocs = await pgPool.query(
        'SELECT filename FROM agency_staff_custom_documents WHERE agency_staff_id = $1', [staffId]
      );

      await pgPool.query('DELETE FROM agency_staff WHERE id = $1', [staffId]); // cascades unavailability/documents/custom_documents rows

      purgeAgencyStaffFiles(staffId, customDocs.rows.map(function(d) { return d.filename; }));

      logAuditEvent(req, 'AGENCY_STAFF_DELETED', 'agency_staff', guard.id, guard.name, { agency_id: agencyId, status: guard.status });

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Agency Staff: Bulk CSV Import ─────────────────────────────────────────────
  // No multipart parser in this codebase (no multer) — same raw chunked-body
  // convention as every other upload route here. xlsx is already a dependency
  // and its reader auto-detects plain CSV text as well as real .xlsx binaries,
  // so no new package is needed.
  app.post('/api/agencies/:agencyId/staff/import-csv', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var agencyId = req.params.agencyId;
      var agencyCheck = await pgPool.query('SELECT id FROM agencies WHERE id = $1', [agencyId]);
      if (!agencyCheck.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });

      var chunks = [];
      req.on('data', function(c) { chunks.push(c); });
      req.on('end', async function() {
        try {
          var buf = Buffer.concat(chunks);
          var wb;
          try {
            wb = XLSX.read(buf, { type: 'buffer' });
          } catch (parseErr) {
            return res.status(400).json({ ok: false, error: 'Could not parse file as CSV/Excel: ' + parseErr.message });
          }
          var sheetName = wb.SheetNames[0];
          if (!sheetName) return res.status(400).json({ ok: false, error: 'No data found in file.' });
          var ws = wb.Sheets[sheetName];
          var rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });

          var importedCount = 0;
          var errors = [];

          for (var i = 0; i < rawRows.length; i++) {
            var rowNum = i + 2; // header occupies row 1
            try {
              var norm = normalizeCsvRow(rawRows[i]);
              var name    = sanitizeForExcel(String(norm.name     || '').trim());
              var jobRole = sanitizeForExcel(String(norm.job_role || '').trim());
              if (!name)    { errors.push({ row: rowNum, error: 'Missing name' });     continue; }
              if (!jobRole) { errors.push({ row: rowNum, error: 'Missing job_role' }); continue; }

              var email       = sanitizeForExcel(String(norm.email       || '').trim().toLowerCase());
              var phone       = sanitizeForExcel(String(norm.phone       || '').trim());
              var nationality = sanitizeForExcel(String(norm.nationality || '').trim());
              var customRole  = sanitizeForExcel(String(norm.custom_role || '').trim());
              var badgeType   = sanitizeForExcel(String(norm.badge_type  || '').trim());
              var dbsExpiry   = toISO(excelDate(norm.dbs_expiry));
              // Not hard-required on bulk import (unlike the Add Guard form) —
              // a row missing these just surfaces as INCOMPLETE compliance
              // status afterward rather than rejecting the whole row.
              var siaExpiry   = toISO(excelDate(norm.sia_expiry));
              var cscsExpiry  = toISO(excelDate(norm.cscs_expiry));

              await pgPool.query(
                `INSERT INTO agency_staff (agency_id, name, email, phone, nationality, job_role, custom_role, badge_type, dbs_expiry, sia_expiry, cscs_expiry)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                [agencyId, name, email, phone, nationality, jobRole, customRole || null, badgeType || null, dbsExpiry, siaExpiry, cscsExpiry]
              );
              importedCount++;
            } catch (rowErr) {
              errors.push({ row: rowNum, error: rowErr.message });
            }
          }

          res.json({ ok: true, imported_count: importedCount, errors: errors });
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

  // ── Agency Staff: Certificate Documents ───────────────────────────────────────
  // agency_staff is a Postgres table with no per-person folder on disk (unlike
  // regular staff), so documents live in a flat directory keyed by staff id —
  // same reasoning as the photo storage below. Every route path.basename()'s
  // every path segment before touching the filesystem (the exact class of bug
  // already found and fixed once in this codebase's site-documents route).
  var ALLOWED_AGENCY_DOC_TYPES = ['sia_cert', 'cscs_cert', 'rtw_cert', 'dog_handler_cert', 'training_cert'];

  function findAgencyStaffDoc(staffId, docType) {
    var exts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    for (var e of exts) {
      var dp = path.join(AGENCY_STAFF_DOCS_DIR, staffId, docType + e);
      if (fs.existsSync(dp)) return dp;
    }
    return null;
  }

  app.get('/api/agencies/:agencyId/staff/:id/documents/:docType', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    var agencyId = path.basename(req.params.agencyId);
    var staffId  = path.basename(req.params.id);
    var docType  = path.basename(req.params.docType);
    if (!ALLOWED_AGENCY_DOC_TYPES.includes(docType)) return res.status(400).end();
    try {
      var r = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, agencyId]);
      if (!r.rows.length) return res.status(404).end();
      var fp = findAgencyStaffDoc(staffId, docType);
      if (!fp) return res.status(404).end();
      var ext = path.extname(fp).toLowerCase();
      var mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', 'inline; filename="' + docType + ext + '"');
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(fp));
    } catch (e) {
      res.status(500).end();
    }
  });

  app.post('/api/agencies/:agencyId/staff/:id/documents/:docType', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    var agencyId = path.basename(req.params.agencyId);
    var staffId  = path.basename(req.params.id);
    var docType  = path.basename(req.params.docType);
    if (!ALLOWED_AGENCY_DOC_TYPES.includes(docType)) return res.status(400).json({ ok: false, error: 'Invalid document type' });
    try {
      var r = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, agencyId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });

      var chunks = [];
      req.on('data', function(c) { chunks.push(c); });
      req.on('end', async function() {
        try {
          var buf = Buffer.concat(chunks);
          // Detect file type from magic bytes — same convention as the staff document routes.
          var ext = '.pdf';
          if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
          else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';

          var staffDir = path.join(AGENCY_STAFF_DOCS_DIR, staffId);
          if (!fs.existsSync(staffDir)) fs.mkdirSync(staffDir, { recursive: true });

          // Remove any existing file for this docType before writing the new one.
          ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
            var old = path.join(staffDir, docType + e);
            if (fs.existsSync(old)) fs.unlinkSync(old);
          });
          fs.writeFileSync(path.join(staffDir, docType + ext), buf);

          var today = new Date().toISOString();
          // docType is checked against ALLOWED_AGENCY_DOC_TYPES above, so it's safe
          // to use in the column name here — never derived from free-text input.
          await pgPool.query(
            'UPDATE agency_staff SET ' + docType + '_uploaded = TRUE, ' + docType + '_upload_date = $1, updated_at = NOW() WHERE id = $2',
            [today, staffId]
          );
          console.log('[AGENCY DOCS] Saved', docType, 'for agency_staff', staffId);
          res.json({ ok: true, date: today });
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

  app.post('/api/agencies/:agencyId/staff/:id/custom-documents', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    var agencyId = path.basename(req.params.agencyId);
    var staffId  = path.basename(req.params.id);
    var label = String(req.query.label || '').trim();
    if (!label) return res.status(400).json({ ok: false, error: 'Label is required.' });
    try {
      var r = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, agencyId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });

      var chunks = [];
      req.on('data', function(c) { chunks.push(c); });
      req.on('end', async function() {
        try {
          var buf = Buffer.concat(chunks);
          // Detect file type from magic bytes — same convention as the fixed-cert routes above.
          var ext = '.pdf';
          if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
          else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';

          var docId = crypto.randomUUID();
          var filename = docId + ext;
          fs.writeFileSync(path.join(AGENCY_STAFF_CUSTOM_DOCS_DIR, filename), buf);

          var ins = await pgPool.query(
            `INSERT INTO agency_staff_custom_documents (id, agency_staff_id, label, filename, uploaded_by)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id, label, uploaded_at`,
            [docId, staffId, label, filename, req.user.id]
          );
          console.log('[AGENCY DOCS] Saved custom document "' + label + '" for agency_staff', staffId);
          res.json({ ok: true, document: ins.rows[0] });
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

  app.get('/api/agencies/:agencyId/staff/:id/custom-documents', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    var agencyId = path.basename(req.params.agencyId);
    var staffId  = path.basename(req.params.id);
    try {
      var r = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, agencyId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
      var docs = await pgPool.query(
        'SELECT id, label, uploaded_at FROM agency_staff_custom_documents WHERE agency_staff_id = $1 ORDER BY uploaded_at ASC',
        [staffId]
      );
      res.json({ ok: true, documents: docs.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/agencies/:agencyId/staff/:id/custom-documents/:docId', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    var agencyId = path.basename(req.params.agencyId);
    var staffId  = path.basename(req.params.id);
    var docId    = path.basename(req.params.docId);
    try {
      var r = await pgPool.query(
        `SELECT d.filename FROM agency_staff_custom_documents d
       JOIN agency_staff s ON s.id = d.agency_staff_id
       WHERE d.id = $1 AND d.agency_staff_id = $2 AND s.agency_id = $3`,
        [docId, staffId, agencyId]
      );
      if (!r.rows.length) return res.status(404).end();
      var fp = path.join(AGENCY_STAFF_CUSTOM_DOCS_DIR, path.basename(r.rows[0].filename));
      if (!fs.existsSync(fp)) return res.status(404).end();
      var ext = path.extname(fp).toLowerCase();
      var mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', 'inline; filename="' + docId + ext + '"');
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(fp));
    } catch (e) {
      res.status(500).end();
    }
  });

  app.delete('/api/agencies/:agencyId/staff/:id/custom-documents/:docId', requireLogin, requireOwnAgencyOrPermission('delete_staff'), async function(req, res) {
    var agencyId = path.basename(req.params.agencyId);
    var staffId  = path.basename(req.params.id);
    var docId    = path.basename(req.params.docId);
    try {
      var r = await pgPool.query(
        `SELECT d.filename FROM agency_staff_custom_documents d
       JOIN agency_staff s ON s.id = d.agency_staff_id
       WHERE d.id = $1 AND d.agency_staff_id = $2 AND s.agency_id = $3`,
        [docId, staffId, agencyId]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Document not found.' });
      var fp = path.join(AGENCY_STAFF_CUSTOM_DOCS_DIR, path.basename(r.rows[0].filename));
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      await pgPool.query('DELETE FROM agency_staff_custom_documents WHERE id = $1', [docId]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  var AGENCY_STAFF_DOC_TYPES = ['creditCheckReport', 'socialMediaCheckReport'];

  function findAgencyStaffDocFile(staffId, docType) {
    var exts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    for (var i = 0; i < exts.length; i++) {
      var fp = path.join(AGENCY_STAFF_DOCS_DIR, staffId + '_' + docType + exts[i]);
      if (fs.existsSync(fp)) return fp;
    }
    return null;
  }

  // Deletes every file on disk for one agency_staff record: the per-staff
  // certificate-documents subfolder, the flat confidential-checks files, the
  // profile photo, and any custom-labeled documents (whose filenames the
  // caller must look up from agency_staff_custom_documents BEFORE deleting
  // that row, since they're not derivable from staffId alone). Paths are
  // built directly rather than through AGENCY_STAFF_DOCS_DIR — that name is
  // declared twice in this file for two different directories, and by
  // var-hoisting rules the second declaration wins everywhere, so relying on
  // it here would silently point at the wrong folder for the fixed-doc-type
  // certs.
  function purgeAgencyStaffFiles(staffId, customDocFilenames) {
    try { fs.rmSync(path.join(BASE, 'agency-staff-documents', staffId), { recursive: true, force: true }); } catch (e) { /* already gone */ }
    var exts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    ['creditCheckReport', 'socialMediaCheckReport'].forEach(function(docType) {
      exts.forEach(function(ext) {
        try { fs.unlinkSync(path.join(BASE, 'agency-staff-confidential-docs', staffId + '_' + docType + ext)); } catch (e) { /* already gone */ }
      });
    });
    exts.forEach(function(ext) {
      try { fs.unlinkSync(path.join(BASE, 'agency-staff-photos', staffId + ext)); } catch (e) { /* already gone */ }
    });
    (customDocFilenames || []).forEach(function(fn) {
      try { fs.unlinkSync(path.join(BASE, 'agency-staff-custom-documents', fn)); } catch (e) { /* already gone */ }
    });
  }

  app.get('/api/agencies/:agencyId/staff/:id/checks', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var r = await pgPool.query(
        'SELECT doc_type, uploaded_at, visible_to_agency FROM agency_staff_documents WHERE agency_staff_id = $1',
        [req.params.id]
      );
      res.json({ ok: true, checks: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/agencies/:agencyId/staff/:id/checks/:docType', requireLogin, requirePermission('staff'), function(req, res) {
    var docType = req.params.docType;
    if (AGENCY_STAFF_DOC_TYPES.indexOf(docType) === -1) return res.status(400).end();
    var staffId = path.basename(req.params.id);
    var fp = findAgencyStaffDocFile(staffId, docType);
    if (!fp) return res.status(404).end();
    var ext = path.extname(fp).toLowerCase();
    var mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(fp));
  });

  app.post('/api/agencies/:agencyId/staff/:id/checks/:docType', requireLogin, requirePermission('staff'), async function(req, res) {
    var docType = req.params.docType;
    if (AGENCY_STAFF_DOC_TYPES.indexOf(docType) === -1) return res.status(400).json({ ok: false, error: 'Invalid document type.' });
    try {
      var staffId = path.basename(req.params.id);
      var check = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, path.basename(req.params.agencyId)]);
      if (!check.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });

      var chunks = [];
      req.on('data', function(c) { chunks.push(c); });
      req.on('end', async function() {
        try {
          var buf = Buffer.concat(chunks);
          var ext = '.pdf';
          if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
          else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';
          ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
            var old = path.join(AGENCY_STAFF_DOCS_DIR, staffId + '_' + docType + e);
            if (fs.existsSync(old)) fs.unlinkSync(old);
          });
          var filename = staffId + '_' + docType + ext;
          fs.writeFileSync(path.join(AGENCY_STAFF_DOCS_DIR, filename), buf);
          // Always lands hidden — same "upload never implies reveal" rule as
          // the staff-side ConfidentialDocManagerRow; the visibility toggle
          // below is a deliberate, separate action.
          await pgPool.query(
            `INSERT INTO agency_staff_documents (agency_staff_id, doc_type, filename, uploaded_by, visible_to_agency)
           VALUES ($1,$2,$3,$4,FALSE)
           ON CONFLICT (agency_staff_id, doc_type) DO UPDATE SET filename = $3, uploaded_by = $4, uploaded_at = NOW(), visible_to_agency = FALSE`,
            [staffId, docType, filename, req.user.id]
          );
          res.json({ ok: true });
        } catch (e) {
          res.status(500).json({ ok: false, error: e.message });
        }
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/agencies/:agencyId/staff/:id/checks/:docType/visibility', requireLogin, requirePermission('staff'), async function(req, res) {
    var docType = req.params.docType;
    if (AGENCY_STAFF_DOC_TYPES.indexOf(docType) === -1) return res.status(400).json({ ok: false, error: 'Invalid document type.' });
    try {
      var visible = !!(req.body && req.body.visibleToStaff);
      var r = await pgPool.query(
        'UPDATE agency_staff_documents SET visible_to_agency = $1 WHERE agency_staff_id = $2 AND doc_type = $3 RETURNING id',
        [visible, req.params.id, docType]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Document not found.' });
      res.json({ ok: true, visibleToStaff: visible });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  function findAgencyStaffPhoto(staffId) { return findFileByExts(AGENCY_STAFF_PHOTOS_DIR, String(staffId)); }

  app.get('/api/agencies/:agencyId/staff/:id/photo', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var staffId = path.basename(req.params.id);
      var r = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, path.basename(req.params.agencyId)]);
      if (!r.rows.length) return res.status(404).end();
      var photo = findAgencyStaffPhoto(staffId);
      if (!photo) return res.status(404).end();
      var ext = path.extname(photo).toLowerCase();
      var mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(photo));
    } catch (e) {
      res.status(500).end();
    }
  });

  app.post('/api/agencies/:agencyId/staff/:id/photo', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var staffId = path.basename(req.params.id);
      var r = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, path.basename(req.params.agencyId)]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });

      var chunks = [];
      req.on('data', function(c) { chunks.push(c); });
      req.on('end', function() {
        try {
          var buf = Buffer.concat(chunks);
          var ext = '.jpg';
          if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
          else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';

          ['.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
            var old = path.join(AGENCY_STAFF_PHOTOS_DIR, staffId + e);
            if (fs.existsSync(old)) fs.unlinkSync(old);
          });

          fs.writeFileSync(path.join(AGENCY_STAFF_PHOTOS_DIR, staffId + ext), buf);
          res.json({ ok: true });
        } catch (e) {
          res.status(500).json({ ok: false, error: e.message });
        }
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Agency Staff: Unavailability ──────────────────────────────────────────────
  app.post('/api/agencies/:agencyId/staff/:id/unavailability', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var staffCheck = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
      if (!staffCheck.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });

      var b = req.body || {};
      var dateFrom = String(b.date_from || '').trim();
      var dateTo   = String(b.date_to   || '').trim();
      var reason   = String(b.reason    || '').trim();
      if (!dateFrom || !dateTo) return res.status(400).json({ ok: false, error: 'date_from and date_to are required.' });
      if (dateTo < dateFrom) return res.status(400).json({ ok: false, error: 'date_to cannot be before date_from.' });

      var r = await pgPool.query(
        'INSERT INTO agency_staff_unavailability (agency_staff_id, date_from, date_to, reason) VALUES ($1,$2,$3,$4) RETURNING *',
        [req.params.id, dateFrom, dateTo, reason || null]
      );
      res.json({ ok: true, unavailability: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/agencies/:agencyId/staff/:id/unavailability', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var staffCheck = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
      if (!staffCheck.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
      var r = await pgPool.query(
        'SELECT * FROM agency_staff_unavailability WHERE agency_staff_id = $1 ORDER BY date_from',
        [req.params.id]
      );
      res.json({ ok: true, unavailability: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete('/api/agencies/:agencyId/staff/:id/unavailability/:unavailabilityId', requireLogin, requireOwnAgencyOrPermission('delete_staff'), async function(req, res) {
    try {
      var staffCheck = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
      if (!staffCheck.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
      var r = await pgPool.query(
        'DELETE FROM agency_staff_unavailability WHERE id = $1 AND agency_staff_id = $2 RETURNING id',
        [req.params.unavailabilityId, req.params.id]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Unavailability record not found.' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Agency Staff: Guard Matching ──────────────────────────────────────────────
  // Suggests guards eligible for a given event date — excludes expired-compliance
  // and currently-unavailable guards. compliance_status is computed app-side
  // (role-conditional, see calculateComplianceStatus), not a stored column, so
  // the EXPIRED filter happens in JS after the SQL rather than in the query.
  app.get('/api/agencies/:agencyId/staff/available', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var eventDate = String(req.query.event_date || '').trim();
      if (!eventDate) return res.status(400).json({ ok: false, error: 'event_date query param is required.' });

      var r = await pgPool.query(
        `SELECT * FROM agency_staff
       WHERE agency_id = $1 AND status = 'active'
         AND id NOT IN (
           SELECT agency_staff_id FROM agency_staff_unavailability
           WHERE date_from <= $2 AND date_to >= $2
         )`,
        [req.params.agencyId, eventDate]
      );
      var available = r.rows
        .map(function(row) { row.compliance_status = calculateComplianceStatus(row); return row; })
        .filter(function(row) { return row.compliance_status !== 'EXPIRED'; });
      res.json({ ok: true, staff: available });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── AGENCY DEPLOYMENTS ─────────────────────────────────────────────────────────
  // Site bookings for agency cover guards. Guard certification auto-block and
  // unavailability exclusion (debug note #11) are enforced here server-side —
  // a 409 rejection, not a UI hint that a direct API call could bypass.
  // getSiteById() is now Postgres-backed — defined up with loadSites() near the
  // other site functions, not here.

  // Shared validation for POST (new deployment) and PATCH (re-assign staff) —
  // checks every agency_staff_id belongs to this agency and is active, rejects
  // if any is EXPIRED compliance, rejects if any is unavailable on event_date.
  // Returns the fetched staff rows (used to resolve names for error messages)
  // or throws an object { status, error } the caller turns into a response.
  // "10:00" -> 600 minutes since midnight. Returns null for anything that
  // isn't a plain HH:MM 24-hour string, so callers can treat null as invalid.
  function timeStringToMinutes(t) {
    var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t || '').trim());
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  async function validateDeploymentStaff(agencyId, staffReq, eventDate) {
    var staffIds = staffReq.map(function(s) { return String(s.agency_staff_id || ''); });
    if (staffIds.some(function(id) { return !id; })) {
      throw { status: 400, error: 'Every staff entry needs an agency_staff_id.' };
    }
    // scheduled_hours is derived from start_time/end_time, not typed directly
    // — the user wants a shift entered as a time range (e.g. 10:00 to 18:00 on
    // the deployment's single event_date), matching how a real shift is
    // described, rather than a raw hours count.
    for (var i = 0; i < staffReq.length; i++) {
      var startMin = timeStringToMinutes(staffReq[i].start_time);
      var endMin = timeStringToMinutes(staffReq[i].end_time);
      if (startMin === null || endMin === null) {
        throw { status: 400, error: 'Every guard needs a start_time and end_time in HH:MM format.' };
      }
      if (endMin <= startMin) {
        throw { status: 400, error: 'end_time must be after start_time for every guard (shifts are within a single day).' };
      }
      staffReq[i].scheduled_hours = Math.round(((endMin - startMin) / 60) * 100) / 100;
    }
    if (!staffIds.length) return [];

    var staffResult = await pgPool.query(
      "SELECT * FROM agency_staff WHERE agency_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'",
      [agencyId, staffIds]
    );
    if (staffResult.rows.length !== staffIds.length) {
      var found = staffResult.rows.map(function(r) { return r.id; });
      var missing = staffIds.filter(function(id) { return found.indexOf(id) === -1; });
      throw { status: 400, error: 'Guard(s) not found or not active: ' + missing.join(', ') };
    }

    var expiredNames = staffResult.rows
      .filter(function(row) { return calculateComplianceStatus(row) === 'EXPIRED'; })
      .map(function(row) { return row.name; });
    if (expiredNames.length) {
      throw { status: 409, error: 'These guards have expired compliance and cannot be deployed: ' + expiredNames.join(', ') };
    }

    var unavailResult = await pgPool.query(
      'SELECT agency_staff_id FROM agency_staff_unavailability WHERE agency_staff_id = ANY($1::uuid[]) AND date_from <= $2 AND date_to >= $2',
      [staffIds, eventDate]
    );
    if (unavailResult.rows.length) {
      var unavailIds = unavailResult.rows.map(function(r) { return r.agency_staff_id; });
      var unavailNames = staffResult.rows.filter(function(row) { return unavailIds.indexOf(row.id) !== -1; }).map(function(row) { return row.name; });
      throw { status: 409, error: 'These guards are marked unavailable on ' + eventDate + ': ' + unavailNames.join(', ') };
    }

    return staffResult.rows;
  }

  app.post('/api/agencies/:agencyId/deployments', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var agencyId = req.params.agencyId;
      var agencyCheck = await pgPool.query('SELECT id FROM agencies WHERE id = $1', [agencyId]);
      if (!agencyCheck.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });

      var b = req.body || {};
      var siteId     = String(b.site_id     || '').trim();
      var eventDate  = String(b.event_date  || '').trim();
      var staffReq   = Array.isArray(b.staff) ? b.staff : [];
      var informedBy = b.informed_by ? String(b.informed_by).trim() : null;
      var approvedBy = b.approved_by ? String(b.approved_by).trim() : null;

      if (!siteId)    return res.status(400).json({ ok: false, error: 'site_id is required.' });
      if (!eventDate) return res.status(400).json({ ok: false, error: 'event_date is required.' });
      if (!staffReq.length) return res.status(400).json({ ok: false, error: 'At least one guard must be assigned.' });
      if (!(await getSiteById(siteId))) return res.status(400).json({ ok: false, error: 'Unknown site_id.' });

      try {
        await validateDeploymentStaff(agencyId, staffReq, eventDate);
      } catch (validationErr) {
        if (validationErr && validationErr.status) return res.status(validationErr.status).json({ ok: false, error: validationErr.error });
        throw validationErr;
      }

      var client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        var depResult = await client.query(
          'INSERT INTO agency_deployments (agency_id, site_id, event_date, informed_by, approved_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [agencyId, siteId, eventDate, informedBy, approvedBy]
        );
        var deployment = depResult.rows[0];
        for (var j = 0; j < staffReq.length; j++) {
          await client.query(
            'INSERT INTO deployment_attendance (deployment_id, agency_staff_id, scheduled_hours, start_time, end_time) VALUES ($1,$2,$3,$4,$5)',
            [deployment.id, staffReq[j].agency_staff_id, Number(staffReq[j].scheduled_hours), staffReq[j].start_time, staffReq[j].end_time]
          );
        }
        await client.query('COMMIT');
        res.json({ ok: true, deployment_id: deployment.id });
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/agencies/:agencyId/deployments', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var agencyId = req.params.agencyId;
      var conditions = ['d.agency_id = $1'];
      var params = [agencyId];
      if (req.query.date_from) { params.push(req.query.date_from); conditions.push('d.event_date >= $' + params.length); }
      if (req.query.date_to)   { params.push(req.query.date_to);   conditions.push('d.event_date <= $' + params.length); }
      if (req.query.status)    { params.push(req.query.status);    conditions.push('d.status = $' + params.length); }

      // staff is a json_agg of each assigned guard's name/role/hours, not just
      // a count — every page listing deployments (this one, the admin
      // cross-agency list, AgencyDetailPage) used to show only guard_count,
      // with no way to see WHO was actually assigned short of re-opening the
      // deployment's edit form. That's the "who's deployed where" confusion
      // this was built to fix.
      var result = await pgPool.query(
        "SELECT d.*, COUNT(a.id) AS guard_count, " +
        "COALESCE(json_agg(json_build_object(" +
        "  'id', s.id, 'name', s.name, 'job_role', s.job_role, " +
        "  'scheduled_hours', a.scheduled_hours, 'start_time', a.start_time, 'end_time', a.end_time, 'attended', a.attended" +
        ") ORDER BY s.name) FILTER (WHERE a.id IS NOT NULL), '[]') AS staff " +
        'FROM agency_deployments d ' +
        'LEFT JOIN deployment_attendance a ON a.deployment_id = d.id ' +
        'LEFT JOIN agency_staff s ON s.id = a.agency_staff_id ' +
        'WHERE ' + conditions.join(' AND ') + ' GROUP BY d.id ORDER BY d.event_date DESC',
        params
      );
      var deployments = await Promise.all(result.rows.map(async function(row) { row.site = await getSiteById(row.site_id); return row; }));
      res.json({ ok: true, deployments: deployments });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/agencies/:agencyId/deployments/:id', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var agencyId = req.params.agencyId;
      var depId = req.params.id;
      var depCheck = await pgPool.query('SELECT * FROM agency_deployments WHERE id = $1 AND agency_id = $2', [depId, agencyId]);
      if (!depCheck.rows.length) return res.status(404).json({ ok: false, error: 'Deployment not found.' });

      var b = req.body || {};
      var allowedStatuses = ['scheduled', 'completed', 'cancelled'];
      var status = b.status !== undefined ? String(b.status).trim() : null;
      if (status && allowedStatuses.indexOf(status) === -1) {
        return res.status(400).json({ ok: false, error: 'status must be one of: ' + allowedStatuses.join(', ') });
      }

      if (Array.isArray(b.staff)) {
        var staffReq = b.staff;
        var staffIds = staffReq.map(function(s) { return String(s.agency_staff_id || ''); });

        try {
          await validateDeploymentStaff(agencyId, staffReq, depCheck.rows[0].event_date);
        } catch (validationErr) {
          if (validationErr && validationErr.status) return res.status(validationErr.status).json({ ok: false, error: validationErr.error });
          throw validationErr;
        }

        var client = await pgPool.connect();
        try {
          await client.query('BEGIN');
          // Drop assignments no longer in the list; keep/update the ones that
          // are, so already-recorded attendance for a guard who stays assigned
          // isn't wiped out by this re-assignment.
          await client.query(
            'DELETE FROM deployment_attendance WHERE deployment_id = $1 AND NOT (agency_staff_id = ANY($2::uuid[]))',
            [depId, staffIds]
          );
          for (var j = 0; j < staffReq.length; j++) {
            await client.query(
              'INSERT INTO deployment_attendance (deployment_id, agency_staff_id, scheduled_hours, start_time, end_time) VALUES ($1,$2,$3,$4,$5) ' +
              'ON CONFLICT (deployment_id, agency_staff_id) DO UPDATE SET scheduled_hours = EXCLUDED.scheduled_hours, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time',
              [depId, staffReq[j].agency_staff_id, Number(staffReq[j].scheduled_hours), staffReq[j].start_time, staffReq[j].end_time]
            );
          }
          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK');
          throw txErr;
        } finally {
          client.release();
        }
      }

      if (status) {
        await pgPool.query('UPDATE agency_deployments SET status = $1, updated_at = NOW() WHERE id = $2', [status, depId]);
      }
      // Built per-field rather than with COALESCE — COALESCE would make it
      // impossible to ever clear one of these back to blank (sending "" would
      // just fall through to the existing value instead of clearing it).
      var deploymentUpdates = [];
      var deploymentParams = [];
      if (b.informed_by !== undefined) { deploymentParams.push(String(b.informed_by).trim() || null); deploymentUpdates.push('informed_by = $' + deploymentParams.length); }
      if (b.approved_by !== undefined) { deploymentParams.push(String(b.approved_by).trim() || null); deploymentUpdates.push('approved_by = $' + deploymentParams.length); }
      if (deploymentUpdates.length) {
        deploymentParams.push(depId);
        await pgPool.query('UPDATE agency_deployments SET ' + deploymentUpdates.join(', ') + ', updated_at = NOW() WHERE id = $' + deploymentParams.length, deploymentParams);
      }

      var updated = await pgPool.query('SELECT * FROM agency_deployments WHERE id = $1', [depId]);
      res.json({ ok: true, deployment: updated.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Permanent delete — director only. Cancelling a deployment (PATCH status
  // above) is the routine action; this actually removes the row. Attendance
  // rows cascade automatically (deployment_attendance.deployment_id ON DELETE
  // CASCADE), but acknowledgment_forms.deployment_id does NOT — a signed
  // acknowledgment for this deployment is compliance proof, same reasoning as
  // everywhere else this pattern is used (event-instruction delete, site
  // delete). Checked up front rather than surfacing a raw FK-violation error.
  app.delete('/api/agencies/:agencyId/deployments/:id', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var agencyId = req.params.agencyId;
      var depId = req.params.id;
      var depResult = await pgPool.query('SELECT * FROM agency_deployments WHERE id = $1 AND agency_id = $2', [depId, agencyId]);
      if (!depResult.rows.length) return res.status(404).json({ ok: false, error: 'Deployment not found.' });

      var acks = await pgPool.query('SELECT COUNT(*)::int AS n FROM acknowledgment_forms WHERE deployment_id = $1', [depId]);
      if (acks.rows[0].n > 0) {
        return res.status(400).json({
          ok: false,
          error: 'Cannot delete this deployment — ' + acks.rows[0].n + ' acknowledgment link(s)/signature(s) reference it. Delete any un-signed links first (a signed one cannot be removed); mark the deployment cancelled instead if it never happened.'
        });
      }

      await pgPool.query('DELETE FROM agency_deployments WHERE id = $1', [depId]); // cascades deployment_attendance

      logAuditEvent(req, 'DEPLOYMENT_DELETED', 'agency_deployment', depId, depResult.rows[0].event_date, { agency_id: agencyId, site_id: depResult.rows[0].site_id, status: depResult.rows[0].status });

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Agency admin's "I understand + I've briefed my staff" confirmation — distinct
  // from an individual guard signing an acknowledgment form (that's a separate
  // polymorphic table for a later stage); this one fact belongs on the
  // deployment row itself.
  app.patch('/api/agencies/:agencyId/deployments/:id/acknowledge', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var r = await pgPool.query(
        `UPDATE agency_deployments
       SET agency_acknowledged = TRUE, agency_acknowledged_by = $1, agency_acknowledged_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND agency_id = $3 RETURNING *`,
        [req.user.id, req.params.id, req.params.agencyId]
      );
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Deployment not found.' });
      // The plain RETURNING * above has no guard_count column — the frontend
      // replaces its whole `detail` object with this response, so without it
      // the modal briefly showed "0 guards" right after acknowledging (the
      // real assignment was untouched; only this response was incomplete).
      // Match the same COUNT(...) LEFT JOIN shape the list/detail queries use.
      var withCount = await pgPool.query(
        `SELECT d.*, COUNT(a.id) AS guard_count FROM agency_deployments d
       LEFT JOIN deployment_attendance a ON a.deployment_id = d.id
       WHERE d.id = $1 GROUP BY d.id`,
        [req.params.id]
      );
      res.json({ ok: true, deployment: withCount.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/agencies/:agencyId/deployments/:id/attendance', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var depCheck = await pgPool.query('SELECT id FROM agency_deployments WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
      if (!depCheck.rows.length) return res.status(404).json({ ok: false, error: 'Deployment not found.' });

      var b = req.body || {};
      var staffId = String(b.agency_staff_id || '');
      if (!staffId) return res.status(400).json({ ok: false, error: 'agency_staff_id is required.' });
      var attended = (b.attended === true || b.attended === false) ? b.attended : null;
      var actualHours = (b.actual_hours !== undefined && b.actual_hours !== null && b.actual_hours !== '') ? Number(b.actual_hours) : null;

      var existing = await pgPool.query(
        'SELECT * FROM deployment_attendance WHERE deployment_id = $1 AND agency_staff_id = $2',
        [req.params.id, staffId]
      );
      var r;
      if (existing.rows.length) {
        r = await pgPool.query(
          `UPDATE deployment_attendance SET attended = $1, actual_hours = $2, confirmed_by = $3, confirmed_at = NOW()
         WHERE deployment_id = $4 AND agency_staff_id = $5 RETURNING *`,
          [attended, actualHours, req.user.id, req.params.id, staffId]
        );
      } else {
        // Guard wasn't part of the original assignment — insert rather than
        // reject, so attendance can still be logged for an ad-hoc addition.
        r = await pgPool.query(
          `INSERT INTO deployment_attendance (deployment_id, agency_staff_id, scheduled_hours, attended, actual_hours, confirmed_by, confirmed_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
          [req.params.id, staffId, actualHours || 0, attended, actualHours, req.user.id]
        );
      }

      if (b.note) {
        await pgPool.query(
          'INSERT INTO deployment_notes (deployment_id, author_id, note) VALUES ($1,$2,$3)',
          [req.params.id, req.user.id, String(b.note).trim()]
        );
      }

      res.json({ ok: true, attendance: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/agencies/:agencyId/deployments/:id/notes', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var depCheck = await pgPool.query('SELECT id FROM agency_deployments WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
      if (!depCheck.rows.length) return res.status(404).json({ ok: false, error: 'Deployment not found.' });
      var note = String((req.body || {}).note || '').trim();
      if (!note) return res.status(400).json({ ok: false, error: 'note is required.' });
      var r = await pgPool.query(
        'INSERT INTO deployment_notes (deployment_id, author_id, note) VALUES ($1,$2,$3) RETURNING *',
        [req.params.id, req.user.id, note]
      );
      res.json({ ok: true, note: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/agencies/:agencyId/deployments/:id/notes', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var depCheck = await pgPool.query('SELECT id FROM agency_deployments WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
      if (!depCheck.rows.length) return res.status(404).json({ ok: false, error: 'Deployment not found.' });
      var r = await pgPool.query(
        `SELECT n.*, u.full_name AS author_name
       FROM deployment_notes n
       LEFT JOIN users u ON u.id = n.author_id
       WHERE n.deployment_id = $1 ORDER BY n.created_at`,
        [req.params.id]
      );
      res.json({ ok: true, notes: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── ADMIN: AGENCY DASHBOARD + PERFORMANCE ─────────────────────────────────────
  // Cross-agency view for the Director/Ops side. Performance figures are pure
  // queries over deployment_attendance + deployment_notes — no new stored table
  // (debug note #11): nothing here is state, it's all computed on read.
  app.get('/api/admin/agencies/overview', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var agencyCount = await pgPool.query("SELECT COUNT(*) FROM agencies WHERE status = 'active'");
      var staffResult = await pgPool.query("SELECT * FROM agency_staff WHERE status = 'active'");
      var breakdown = { EXPIRED: 0, INCOMPLETE: 0, ACTION_NEEDED: 0, COMPLIANT: 0 };
      staffResult.rows.forEach(function(row) {
        var status = calculateComplianceStatus(row);
        breakdown[status] = (breakdown[status] || 0) + 1;
      });
      res.json({
        ok: true,
        total_agencies: Number(agencyCount.rows[0].count),
        total_staff: staffResult.rows.length,
        compliance_breakdown: breakdown
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/admin/agencies/:id/performance', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var agencyId = req.params.id;
      var agencyCheck = await pgPool.query('SELECT id FROM agencies WHERE id = $1', [agencyId]);
      if (!agencyCheck.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });

      var staffResult = await pgPool.query("SELECT * FROM agency_staff WHERE agency_id = $1 AND status = 'active'", [agencyId]);
      var compliantCount = staffResult.rows.filter(function(row) { return calculateComplianceStatus(row) === 'COMPLIANT'; }).length;
      var compliancePct = staffResult.rows.length ? Math.round((compliantCount / staffResult.rows.length) * 100) : 100;

      var deploymentsCount = await pgPool.query('SELECT COUNT(*) FROM agency_deployments WHERE agency_id = $1', [agencyId]);

      var attendanceResult = await pgPool.query(
        `SELECT a.attended FROM deployment_attendance a
       JOIN agency_deployments d ON d.id = a.deployment_id
       WHERE d.agency_id = $1 AND a.attended IS NOT NULL`,
        [agencyId]
      );
      var confirmed = attendanceResult.rows.length;
      var noShows = attendanceResult.rows.filter(function(row) { return row.attended === false; }).length;
      var noShowRate = confirmed ? Math.round((noShows / confirmed) * 100) : 0;

      var incidentCount = await pgPool.query(
        `SELECT COUNT(*) FROM deployment_notes n
       JOIN agency_deployments d ON d.id = n.deployment_id
       WHERE d.agency_id = $1`,
        [agencyId]
      );

      res.json({
        ok: true,
        compliance_pct: compliancePct,
        no_show_rate: noShowRate,
        incident_count: Number(incidentCount.rows[0].count),
        deployments_count: Number(deploymentsCount.rows[0].count)
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/admin/deployments', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var conditions = [];
      var params = [];
      if (req.query.site_id)   { params.push(req.query.site_id);   conditions.push('d.site_id = $' + params.length); }
      if (req.query.date_from) { params.push(req.query.date_from); conditions.push('d.event_date >= $' + params.length); }
      if (req.query.date_to)   { params.push(req.query.date_to);   conditions.push('d.event_date <= $' + params.length); }
      if (req.query.agency_id) { params.push(req.query.agency_id); conditions.push('d.agency_id = $' + params.length); }

      var sql = "SELECT d.*, a.name AS agency_name, COUNT(att.id) AS guard_count, " +
        "COALESCE(json_agg(json_build_object(" +
        "  'id', s.id, 'name', s.name, 'job_role', s.job_role, " +
        "  'scheduled_hours', att.scheduled_hours, 'start_time', att.start_time, 'end_time', att.end_time, 'attended', att.attended" +
        ") ORDER BY s.name) FILTER (WHERE att.id IS NOT NULL), '[]') AS staff " +
        'FROM agency_deployments d ' +
        'JOIN agencies a ON a.id = d.agency_id ' +
        'LEFT JOIN deployment_attendance att ON att.deployment_id = d.id ' +
        'LEFT JOIN agency_staff s ON s.id = att.agency_staff_id' +
        (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '') +
        ' GROUP BY d.id, a.name ORDER BY d.event_date DESC';

      var result = await pgPool.query(sql, params);
      var deployments = await Promise.all(result.rows.map(async function(row) { row.site = await getSiteById(row.site_id); return row; }));
      res.json({ ok: true, deployments: deployments });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Narrow manager-directory lookup for the "Manager" audience picker (Stage
  // 2) — deliberately NOT a reuse of GET /api/users (requireRole('director'),
  // backs the director-only Team Access user-administration page and returns
  // full rows including role/email/is_active). This route is scoped to just
  // {id, full_name} for active, manager-tier users so it can't be used to
  // enumerate or expose anything beyond a name to pick from a list.
  // "Manager-tier" = every role except 'staff' (self-service) and 'agency'
  // (external guard-agency logins) — everything else in this app's role
  // system (director, ops_manager, hr_manager, office_manager, accounts,
  // media, supervisor, fleet_manager, and any future custom role) is some
  // flavor of internal management.
  app.get('/api/manager-directory', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var result = await pgPool.query(
        "SELECT id, full_name FROM users WHERE is_active = TRUE AND role NOT IN ('staff', 'agency') ORDER BY full_name"
      );
      res.json({ ok: true, managers: result.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};
