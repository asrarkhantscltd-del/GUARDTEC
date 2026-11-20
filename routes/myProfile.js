// Staff self-service: own profile, photo, disciplinary, provisions and contract.
//
// Registered from server.js: require('./routes/myProfile')(deps)

var fs = require('fs');
var path = require('path');

module.exports = function registerMyProfileRoutes(deps) {
  var MY_PROFILE_FIELDS = deps.MY_PROFILE_FIELDS,
    USER_PHOTOS_DIR = deps.USER_PHOTOS_DIR,
    app = deps.app,
    applyPendingProfileFields = deps.applyPendingProfileFields,
    contractMime = deps.contractMime,
    createNotification = deps.createNotification,
    detectExtFromBuffer = deps.detectExtFromBuffer,
    findContractFile = deps.findContractFile,
    findUserPhoto = deps.findUserPhoto,
    loadAllStaff = deps.loadAllStaff,
    pgPool = deps.pgPool,
    requireLogin = deps.requireLogin,
    requireRole = deps.requireRole,
    resolveEmpId = deps.resolveEmpId,
    sanitizeForStaffView = deps.sanitizeForStaffView,
    saveStaff = deps.saveStaff,
    saveStaffDocFile = deps.saveStaffDocFile;

  app.get('/api/me/photo', requireLogin, function(req, res) {
    try {
      var photo = findUserPhoto(req.user.id);
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

  app.post('/api/me/photo', requireLogin, function(req, res) {
    try {
      var chunks = [];
      req.on('data', function(c) { chunks.push(c); });
      req.on('end', function() {
        try {
          var buf = Buffer.concat(chunks);
          var ext = '.jpg';
          if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
          else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';

          ['.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
            var old = path.join(USER_PHOTOS_DIR, String(req.user.id) + e);
            if (fs.existsSync(old)) fs.unlinkSync(old);
          });

          fs.writeFileSync(path.join(USER_PHOTOS_DIR, String(req.user.id) + ext), buf);
          res.json({ ok: true });
        } catch (e) {
          res.status(500).json({ ok: false, error: e.message });
        }
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // The logged-in staff member's own profile — reads via the staff_id baked
  // into their JWT at login/registration time.
  app.get('/api/my-profile', requireLogin, function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.user.staff_id; });
      if (!emp) return res.status(404).json({ ok: false, error: 'Profile not found' });
      res.json({ ok: true, profile: sanitizeForStaffView(emp) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Staff submit changes here — they land in pending_submission and do NOT
  // touch the live compliance record until a manager approves them.
  app.post('/api/my-profile', requireLogin, async function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.user.staff_id; });
      if (!emp) return res.status(404).json({ ok: false, error: 'Profile not found' });

      applyPendingProfileFields(emp, req.body || {});
      // The draft has now been promoted into a real, reviewable submission —
      // clear it so a stale in-progress copy doesn't reappear and silently
      // overwrite a later edit the next time this staff member reopens the
      // wizard (see wizard_draft below).
      delete emp.wizard_draft;
      await saveStaff(emp, emp._folderPath);
      // Without this, a submission landed in pending_submission with no signal
      // anywhere that a manager needed to look — the bell never rang, so it
      // only ever got noticed if someone happened to open Pending Review.
      createNotification({
        type: 'profile_submission', actorName: emp.name,
        summary: 'submitted profile changes for review',
        linkStaffId: emp.id, linkTab: 'pending-review',
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Autosaves the onboarding wizard's in-progress answers so a reload, crash,
  // or the earlier document-status desync bug (fixed alongside this) doesn't
  // wipe an entire session's typing — everything from Personal Details through
  // Bank Details lived ONLY in this page's React state until the final
  // "Submit for Review" succeeded, with no recovery path if that never
  // happened. wizard_draft is intentionally separate from pending_submission:
  // it's never shown to a manager, never triggers a notification, and gets
  // cleared the moment a real submission promotes it (above) — it's purely a
  // private resume-buffer for the person still filling the form in.
  app.put('/api/my-profile/draft', requireLogin, async function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.user.staff_id; });
      if (!emp) return res.status(404).json({ ok: false, error: 'Profile not found' });

      var draft = Object.assign({}, emp.wizard_draft);
      var body = req.body || {};
      MY_PROFILE_FIELDS.forEach(function(field) {
        if (body[field] !== undefined) draft[field] = body[field];
      });
      emp.wizard_draft = draft;
      await saveStaff(emp, emp._folderPath);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/my-profile/photo', requireLogin, async function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.user.staff_id; });
      if (!emp || !emp._pgId) return res.status(404).json({ ok: false, error: 'Profile not found' });

      var chunks = [];
      req.on('data', function(c) { chunks.push(c); });
      req.on('end', async function() {
        try {
          var buf = Buffer.concat(chunks);
          var ext = detectExtFromBuffer(buf, '.jpg');
          await saveStaffDocFile(emp._pgId, 'photo', 'pending', buf, ext, {});

          emp.pending_submission = Object.assign({}, emp.pending_submission, {
            submitted_at: new Date().toISOString(),
            photo_pending: true,
          });
          await saveStaff(emp, emp._folderPath);
          res.json({ ok: true });
        } catch (e) {
          res.status(500).json({ ok: false, error: e.message });
        }
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Disciplinary: staff view their own record ──
  app.get('/api/my-disciplinary', requireLogin, requireRole('staff'), async function(req, res) {
    try {
      if (!req.user.staff_id) return res.json({ ok: true, records: [] });
      var empId = await resolveEmpId(req.user.staff_id);
      if (!empId) return res.json({ ok: true, records: [] });
      var result = await pgPool.query(
        `SELECT id, incident_date, type, description, action_taken, created_at
       FROM disciplinary_records WHERE employee_id = $1 ORDER BY incident_date DESC`,
        [empId]
      );
      res.json({ ok: true, records: result.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Staff: view their own provisions
  app.get('/api/my-provisions', requireLogin, requireRole('staff'), async function(req, res) {
    try {
      if (!req.user.staff_id) return res.json({ ok: true, provisions: [] });
      var empId = await resolveEmpId(req.user.staff_id);
      if (!empId) return res.json({ ok: true, provisions: [] });
      var result = await pgPool.query(
        'SELECT id, item, provided, date_given, date_returned, notes, created_at FROM staff_provisions WHERE employee_id = $1 ORDER BY created_at DESC',
        [empId]
      );
      res.json({ ok: true, provisions: result.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Staff: check own contract
  app.get('/api/my-contract/info', requireLogin, requireRole('staff'), function(req, res) {
    if (!req.user.staff_id) return res.json({ ok: true, exists: false });
    var found = findContractFile(req.user.staff_id);
    res.json({ ok: true, exists: !!found });
  });

  // Staff: view own contract
  app.get('/api/my-contract', requireLogin, requireRole('staff'), function(req, res) {
    if (!req.user.staff_id) return res.status(404).json({ ok: false, error: 'No contract on file.' });
    var found = findContractFile(req.user.staff_id);
    if (!found) return res.status(404).json({ ok: false, error: 'No contract on file.' });
    res.setHeader('Content-Type', contractMime(found.ext));
    res.setHeader('Content-Disposition', 'inline; filename="your-contract' + found.ext + '"');
    res.send(fs.readFileSync(found.filePath));
  });
};
