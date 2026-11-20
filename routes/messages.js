// Staff/agency messaging, the admin inbox and message attachments.
//
// Registered from server.js: require('./routes/messages')(deps)

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

module.exports = function registerMessagesRoutes(deps) {
  var ALLOWED_ATTACH_MIME = deps.ALLOWED_ATTACH_MIME,
    MAX_ATTACH_SIZE = deps.MAX_ATTACH_SIZE,
    MESSAGE_ATTACH_DIR = deps.MESSAGE_ATTACH_DIR,
    app = deps.app,
    canAccessOwnerEmpId = deps.canAccessOwnerEmpId,
    createNotification = deps.createNotification,
    deliverPush = deps.deliverPush,
    hasStaffPermission = deps.hasStaffPermission,
    loadAllStaff = deps.loadAllStaff,
    pgPool = deps.pgPool,
    requireLogin = deps.requireLogin,
    requireOwnAgencyOrPermission = deps.requireOwnAgencyOrPermission,
    requirePermission = deps.requirePermission,
    requireRole = deps.requireRole,
    resolveEmpId = deps.resolveEmpId;

  // Targeted push to one specific person — e.g. the staff member a manager
  // just messaged. userId is a users.id, not an employees.id/legacy_id;
  // callers resolve that first (see the /api/staff/:id/messages hook below).
  async function pushToUser(userId, body, url) {
    if (!process.env.VAPID_PUBLIC_KEY || !userId) return;
    var subs = (await pgPool.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId])).rows;
    await deliverPush(subs, JSON.stringify({ title: 'GuardTec Compliance', body: body, url: url || '/' }));
  }

  // Sibling to canAccessOwnerEmpId, identical shape — for rows owned by an
  // agency_id instead of an employees.id (messaging's agency_id branch,
  // debug note #5). req.user.agency_id mirrors req.user.staff_id (TEXT),
  // set when role === 'agency'.
  async function canAccessOwnerAgencyId(req, res, ownerAgencyId) {
    if (await hasStaffPermission(req)) return true;
    if (req.user.agency_id && ownerAgencyId && req.user.agency_id === ownerAgencyId) return true;
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return false;
  }

  // ── Staff Messages ────────────────────────────────────────────────────────────

  // ownerColumn is always one of the two hardcoded literals below — never
  // request input — so building the WHERE clause with it is safe.
  function messagesSelectQuery(ownerColumn) {
    return `
    SELECT sm.id, sm.message, sm.is_read, sm.created_at,
           u.full_name AS sender_name, u.role AS sender_role,
           ma.id AS attachment_id, ma.filename AS attachment_filename,
           ma.original_name AS attachment_original_name,
           ma.mime_type AS attachment_mime_type, ma.size_bytes AS attachment_size
    FROM staff_messages sm
    JOIN users u ON u.id = sm.sender_id
    LEFT JOIN message_attachments ma ON ma.message_id = sm.id
    WHERE sm.${ownerColumn} = $1
    ORDER BY sm.created_at ASC
  `;
  }
  var MESSAGES_SELECT = messagesSelectQuery('employee_id');

  // Resolves which owner column a staff_messages row actually uses (exactly
  // one is ever set, enforced by staff_messages_one_party) and runs the
  // matching ownership gate — lets the shared attachment/download/delete
  // routes serve both employee_id-owned and agency_id-owned threads without
  // forking into parallel routes (debug note #5).
  async function canAccessMessageOwner(req, res, ownerRow) {
    return ownerRow.employee_id
      ? canAccessOwnerEmpId(req, res, ownerRow.employee_id)
      : canAccessOwnerAgencyId(req, res, ownerRow.agency_id);
  }

  // Management: view full conversation for a staff member
  app.get('/api/staff/:id/messages', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var empId = await resolveEmpId(req.params.id);
      if (!empId) return res.json({ ok: true, messages: [] });
      var result = await pgPool.query(MESSAGES_SELECT, [empId]);
      // Mark all unread (sent by staff) as read when management opens
      await pgPool.query(
        `UPDATE staff_messages SET is_read = TRUE WHERE employee_id = $1 AND sender_id IN (SELECT id FROM users WHERE role = 'staff') AND is_read = FALSE`,
        [empId]
      );
      res.json({ ok: true, messages: result.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Management: inbox — one row per staff conversation, newest first, with the
  // count of unread messages sent BY staff. Read-only (does not mark anything read).
  app.get('/api/messages/inbox', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var r = await pgPool.query(`
      SELECT sm.employee_id,
             MAX(sm.created_at) AS last_at,
             COUNT(*) FILTER (WHERE sm.is_read = FALSE AND u.role = 'staff') AS unread,
             (ARRAY_AGG(sm.message ORDER BY sm.created_at DESC))[1] AS last_message,
             (ARRAY_AGG(u.role ORDER BY sm.created_at DESC))[1] AS last_sender_role
      FROM staff_messages sm
      JOIN users u ON u.id = sm.sender_id
      WHERE sm.employee_id IS NOT NULL
      GROUP BY sm.employee_id
      ORDER BY MAX(sm.created_at) DESC
    `);
      var byPg = {};
      loadAllStaff().forEach(function(s) { if (s._pgId) byPg[s._pgId] = s; });
      var conversations = r.rows
        .filter(function(row) { return byPg[row.employee_id]; })
        .map(function(row) {
          var s = byPg[row.employee_id];
          return {
            staffId: s.id, name: s.name, jobRole: s.jobRole || null,
            lastMessage: row.last_message, lastAt: row.last_at,
            lastFromStaff: row.last_sender_role === 'staff',
            unread: Number(row.unread) || 0,
          };
        });
      var totalUnread = conversations.reduce(function(n, c) { return n + c.unread; }, 0);
      res.json({ ok: true, conversations: conversations, totalUnread: totalUnread });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Management: send a message to a staff member
  app.post('/api/staff/:id/messages', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var empId = await resolveEmpId(req.params.id);
      if (!empId) return res.status(404).json({ ok: false, error: 'Staff not found.' });
      var msg = String((req.body && req.body.message) || '').trim();
      if (!msg) return res.status(400).json({ ok: false, error: 'Message cannot be empty.' });
      var r = await pgPool.query(
        'INSERT INTO staff_messages (employee_id, sender_id, message) VALUES ($1,$2,$3) RETURNING id, message, created_at',
        [empId, req.user.id, msg]
      );
      res.json({ ok: true, message: r.rows[0] });

      // Targeted push to this specific staff member — req.params.id is the
      // legacy_id, which is exactly what users.staff_id stores (confirmed
      // against the /api/my-messages reply handler below, which resolves the
      // same way). Not every staff member has registered a login yet, so a
      // no-match here is normal, not an error.
      pgPool.query("SELECT id FROM users WHERE staff_id = $1 AND role = 'staff'", [req.params.id])
        .then(function(ur) {
          if (ur.rows.length) pushToUser(ur.rows[0].id, (req.user.full_name || req.user.username) + ' sent you a message', '/');
        })
        .catch(function(e) { console.error('[PUSH] staff-message lookup failed:', e.message); });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Staff: view their own messages
  app.get('/api/my-messages', requireLogin, requireRole('staff'), async function(req, res) {
    try {
      if (!req.user.staff_id) return res.json({ ok: true, messages: [], unread: 0 });
      var empId = await resolveEmpId(req.user.staff_id);
      if (!empId) return res.json({ ok: true, messages: [], unread: 0 });
      var result = await pgPool.query(MESSAGES_SELECT, [empId]);
      var unread = result.rows.filter(function(m) { return !m.is_read && m.sender_role !== 'staff'; }).length;
      // ?peek=1 = header badge poll: count only, never mark read (otherwise the
      // badge cleared itself within 30s without the staff member reading anything).
      if (req.query.peek === '1') return res.json({ ok: true, unread: unread });
      // Mark management messages as read
      await pgPool.query(
        `UPDATE staff_messages SET is_read = TRUE WHERE employee_id = $1 AND is_read = FALSE AND sender_id NOT IN (SELECT id FROM users WHERE role = 'staff')`,
        [empId]
      );
      res.json({ ok: true, messages: result.rows, unread: unread });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Staff: reply to management
  app.post('/api/my-messages', requireLogin, requireRole('staff'), async function(req, res) {
    try {
      if (!req.user.staff_id) return res.status(400).json({ ok: false, error: 'No staff profile linked.' });
      var empRow = await pgPool.query('SELECT id, name FROM employees WHERE legacy_id = $1', [req.user.staff_id]);
      if (!empRow.rows.length) return res.status(400).json({ ok: false, error: 'Staff profile not found.' });
      var empId = empRow.rows[0].id;
      var msg = String((req.body && req.body.message) || '').trim();
      if (!msg) return res.status(400).json({ ok: false, error: 'Message cannot be empty.' });
      var r = await pgPool.query(
        'INSERT INTO staff_messages (employee_id, sender_id, message, is_read) VALUES ($1,$2,$3, FALSE) RETURNING id, message, created_at',
        [empId, req.user.id, msg]
      );
      createNotification({
        type: 'message', actorName: empRow.rows[0].name, summary: 'sent you a message',
        linkStaffId: req.user.staff_id, linkTab: 'messages',
      });
      res.json({ ok: true, message: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Agency Messages ───────────────────────────────────────────────────────────
  // Thin routes over the same staff_messages/message_attachments machinery as
  // the employee_id-owned routes above, parameterized by agency_id instead
  // (plan 1.2/1.3, debug note #5) — no new table, no duplicated logic.
  // requireOwnAgencyOrPermission already tells apart the agency's own user
  // (self-service, mirrors /api/my-messages) from management viewing a
  // specific agency's thread (mirrors /api/staff/:id/messages), so one route
  // covers both instead of forking into two like the older employee_id side.
  app.get('/api/agencies/:agencyId/messages', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var agencyId = req.params.agencyId;
      var result = await pgPool.query(messagesSelectQuery('agency_id'), [agencyId]);
      var isAgencyViewer = req.user.role === 'agency';
      var payload = { ok: true, messages: result.rows };
      if (isAgencyViewer) {
        payload.unread = result.rows.filter(function(m) { return !m.is_read && m.sender_role !== 'agency'; }).length;
        // Viewer is the agency: mark management's messages as read.
        await pgPool.query(
          `UPDATE staff_messages SET is_read = TRUE WHERE agency_id = $1 AND is_read = FALSE AND sender_id NOT IN (SELECT id FROM users WHERE role = 'agency')`,
          [agencyId]
        );
      } else {
        // Viewer is management: mark the agency's messages as read.
        await pgPool.query(
          `UPDATE staff_messages SET is_read = TRUE WHERE agency_id = $1 AND sender_id IN (SELECT id FROM users WHERE role = 'agency') AND is_read = FALSE`,
          [agencyId]
        );
      }
      res.json(payload);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/agencies/:agencyId/messages', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
    try {
      var agencyId = req.params.agencyId;
      var msg = String((req.body && req.body.message) || '').trim();
      if (!msg) return res.status(400).json({ ok: false, error: 'Message cannot be empty.' });
      var r = await pgPool.query(
        'INSERT INTO staff_messages (agency_id, sender_id, message, is_read) VALUES ($1,$2,$3, FALSE) RETURNING id, message, created_at',
        [agencyId, req.user.id, msg]
      );
      if (req.user.role === 'agency') {
        var agencyRow = await pgPool.query('SELECT name FROM agencies WHERE id = $1', [agencyId]);
        createNotification({
          type: 'message',
          actorName: agencyRow.rows.length ? agencyRow.rows[0].name : 'Agency',
          summary: 'sent you a message',
          linkTab: 'messages',
          linkAgencyId: agencyId,
        });
      }
      res.json({ ok: true, message: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Attach a file to a message either party just sent (reuses the same
  // image/video/doc whitelist and 100MB cap already defined for incident reports).
  app.post('/api/messages/:messageId/attachment', requireLogin, async function(req, res) {
    var msgRow = await pgPool.query('SELECT employee_id, agency_id FROM staff_messages WHERE id = $1', [req.params.messageId]);
    if (!msgRow.rows.length) return res.status(404).json({ ok: false, error: 'Message not found.' });
    if (!await canAccessMessageOwner(req, res, msgRow.rows[0])) return;

    var mime = (req.headers['content-type'] || '').split(';')[0].trim();
    var ext = ALLOWED_ATTACH_MIME[mime];
    if (!ext) return res.status(400).json({ ok: false, error: 'File type not allowed.' });

    var originalName = decodeURIComponent(req.headers['x-original-name'] || 'attachment' + ext);
    var filename = crypto.randomUUID() + ext;
    var dest = path.join(MESSAGE_ATTACH_DIR, filename);

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
          'INSERT INTO message_attachments (message_id, filename, original_name, mime_type, size_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id, filename, original_name, mime_type, size_bytes, uploaded_at',
          [req.params.messageId, filename, originalName, mime, buf.length]
        );
        res.json({ ok: true, attachment: r.rows[0] });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
    req.on('error', function() { res.status(500).json({ ok: false, error: 'Upload failed.' }); });
  });

  app.get('/api/message-attachments/:filename', requireLogin, async function(req, res) {
    try {
      var safe = path.basename(req.params.filename);
      var owner = await pgPool.query(
        'SELECT sm.employee_id, sm.agency_id FROM message_attachments ma JOIN staff_messages sm ON sm.id = ma.message_id WHERE ma.filename = $1',
        [safe]
      );
      if (!owner.rows.length) return res.status(404).end();
      if (!await canAccessMessageOwner(req, res, owner.rows[0])) return;
      var filePath = path.join(MESSAGE_ATTACH_DIR, safe);
      if (!fs.existsSync(filePath)) return res.status(404).end();
      res.sendFile(filePath);
    } catch (e) {
      res.status(500).end();
    }
  });

  // Delete a message (and its attachment, if any). Management-only — deliberately
  // not exposed to staff, so a message can't be used to hide something and then
  // erased before a manager has a chance to review it.
  app.delete('/api/messages/:messageId', requireLogin, requirePermission('delete_staff'), async function(req, res) {
    try {
      var attRes = await pgPool.query('SELECT filename FROM message_attachments WHERE message_id = $1', [req.params.messageId]);
      attRes.rows.forEach(function(row) {
        var fp = path.join(MESSAGE_ATTACH_DIR, row.filename);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      });
      var r = await pgPool.query('DELETE FROM staff_messages WHERE id = $1', [req.params.messageId]);
      if (!r.rowCount) return res.status(404).json({ ok: false, error: 'Message not found.' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};
