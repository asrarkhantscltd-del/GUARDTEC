// Compliance Calendar items, reminders and the public share link.
//
// Registered from server.js: require('./routes/complianceCalendar')(deps)

var crypto = require('crypto');

module.exports = function registerComplianceCalendarRoutes(deps) {
  var BASE_URL = deps.BASE_URL,
    app = deps.app,
    pgPool = deps.pgPool,
    requireLogin = deps.requireLogin,
    requirePermission = deps.requirePermission;

  // ── COMPLIANCE CALENDAR ─────────────────────────────────────────────────────────
  app.get('/api/compliance-calendar', requireLogin, requirePermission('compliance_calendar'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT * FROM compliance_calendar_items ORDER BY due_date ASC NULLS LAST, title ASC');
      res.json({ ok: true, items: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/compliance-calendar', requireLogin, requirePermission('compliance_calendar'), async function(req, res) {
    try {
      var title = String(req.body.title || '').trim();
      if (!title) return res.status(400).json({ ok: false, error: 'Title required' });
      var recurrenceUnit = ['none', 'week', 'month'].indexOf(req.body.recurrence_unit) >= 0 ? req.body.recurrence_unit : 'none';
      var r = await pgPool.query(
        `INSERT INTO compliance_calendar_items (title, description, responsible_email, due_date, recurrence_unit, recurrence_value, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          title,
          String(req.body.description || '').trim(),
          String(req.body.responsible_email || '').trim(),
          req.body.due_date || null,
          recurrenceUnit,
          recurrenceUnit === 'none' ? 0 : (parseInt(req.body.recurrence_value, 10) || 0),
          String(req.body.notes || '').trim()
        ]
      );
      res.json({ ok: true, item: r.rows[0] });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ ok: false, error: 'A calendar item with this title already exists' });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/compliance-calendar/:id', requireLogin, requirePermission('compliance_calendar'), async function(req, res) {
    try {
      var existing = await pgPool.query('SELECT * FROM compliance_calendar_items WHERE id = $1', [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Calendar item not found' });
      var o = existing.rows[0];
      var b = req.body;
      var recurrenceUnit = b.recurrence_unit !== undefined
        ? (['none', 'week', 'month'].indexOf(b.recurrence_unit) >= 0 ? b.recurrence_unit : 'none')
        : o.recurrence_unit;
      var updated = {
        title:               String(b.title               !== undefined ? b.title               : o.title).trim(),
        description:         String(b.description          !== undefined ? b.description          : o.description || '').trim(),
        responsible_email:   String(b.responsible_email     !== undefined ? b.responsible_email     : o.responsible_email || '').trim(),
        due_date:            b.due_date                     !== undefined ? (b.due_date || null)    : o.due_date,
        recurrence_unit:     recurrenceUnit,
        recurrence_value:    recurrenceUnit === 'none' ? 0 : (b.recurrence_value !== undefined ? (parseInt(b.recurrence_value, 10) || 0) : o.recurrence_value),
        notes:               String(b.notes                 !== undefined ? b.notes                 : o.notes || '').trim(),
      };
      if (!updated.title) return res.status(400).json({ ok: false, error: 'Title required' });
      // A manual due-date change means whatever reminder stage was already sent
      // for the old date no longer applies to the new one.
      var dueDateChanged = String(updated.due_date || '') !== String(o.due_date || '');
      await pgPool.query(
        `UPDATE compliance_calendar_items
       SET title=$1, description=$2, responsible_email=$3, due_date=$4, recurrence_unit=$5, recurrence_value=$6, notes=$7,
           last_reminder_stage = CASE WHEN $8 THEN NULL ELSE last_reminder_stage END,
           last_reminder_due_date = CASE WHEN $8 THEN NULL ELSE last_reminder_due_date END,
           updated_at=NOW()
       WHERE id=$9`,
        [updated.title, updated.description, updated.responsible_email, updated.due_date, updated.recurrence_unit,
         updated.recurrence_value, updated.notes, dueDateChanged, req.params.id]
      );
      var fresh = await pgPool.query('SELECT * FROM compliance_calendar_items WHERE id = $1', [req.params.id]);
      res.json({ ok: true, item: fresh.rows[0] });
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ ok: false, error: 'A calendar item with this title already exists' });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete('/api/compliance-calendar/:id', requireLogin, requirePermission('compliance_calendar'), async function(req, res) {
    try {
      await pgPool.query('DELETE FROM compliance_calendar_items WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Shared by both the logged-in "Mark Complete" route and the public,
  // token-authenticated one below — logs who completed it, then advances
  // due_date by the recurrence interval (or clears it for a one-off task).
  async function completeComplianceCalendarItem(item, completedBy) {
    await pgPool.query(
      'INSERT INTO compliance_calendar_completions (item_id, completed_by, due_date_at_completion) VALUES ($1,$2,$3)',
      [item.id, completedBy || 'Unknown', item.due_date]
    );

    var nextDueDate = null;
    if (item.recurrence_unit === 'week' && item.recurrence_value > 0 && item.due_date) {
      var r1 = await pgPool.query(
        `SELECT (due_date + ($1 || ' weeks')::interval)::date AS next_date FROM compliance_calendar_items WHERE id = $2`,
        [item.recurrence_value, item.id]
      );
      nextDueDate = r1.rows[0].next_date;
    } else if (item.recurrence_unit === 'month' && item.recurrence_value > 0 && item.due_date) {
      var r2 = await pgPool.query(
        `SELECT (due_date + ($1 || ' months')::interval)::date AS next_date FROM compliance_calendar_items WHERE id = $2`,
        [item.recurrence_value, item.id]
      );
      nextDueDate = r2.rows[0].next_date;
    }

    await pgPool.query(
      `UPDATE compliance_calendar_items
     SET due_date = $1, last_reminder_stage = NULL, last_reminder_due_date = NULL, updated_at = NOW()
     WHERE id = $2`,
      [nextDueDate, item.id]
    );
    var fresh = await pgPool.query('SELECT * FROM compliance_calendar_items WHERE id = $1', [item.id]);
    return fresh.rows[0];
  }

  app.post('/api/compliance-calendar/:id/complete', requireLogin, requirePermission('compliance_calendar'), async function(req, res) {
    try {
      var existing = await pgPool.query('SELECT * FROM compliance_calendar_items WHERE id = $1', [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Calendar item not found' });
      var updated = await completeComplianceCalendarItem(existing.rows[0], req.user && (req.user.name || req.user.username));
      res.json({ ok: true, item: updated });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── COMPLIANCE CALENDAR — SHAREABLE REMINDER LINK ───────────────────────────────
  // Lets a Director/Ops hand a responsible person (who may not even have a
  // GuardTec app login — e.g. an external solicitor) a link that shows just
  // their own due tasks, so they can keep track of reminders themselves.

  app.post('/api/compliance-calendar/share-link', requireLogin, requirePermission('compliance_calendar'), async function(req, res) {
    try {
      var email = String(req.body.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ ok: false, error: 'Email required' });

      var existing = await pgPool.query('SELECT token FROM compliance_calendar_share_links WHERE LOWER(email) = $1', [email]);
      var token;
      if (existing.rows.length) {
        token = existing.rows[0].token;
      } else {
        token = crypto.randomBytes(32).toString('hex'); // 256 bits, same as acknowledgment_forms.form_token
        await pgPool.query(
          'INSERT INTO compliance_calendar_share_links (email, token) VALUES ($1,$2)',
          [email, token]
        );
      }
      res.json({ ok: true, url: BASE_URL + '/compliance-calendar/shared/' + token });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Public — no requireLogin. The token in the URL is the security boundary
  // (see the CSRF-exemption comment near CSRF_EXEMPT_PATHS above). Matches
  // any item whose (comma-separated) responsible_email field contains this
  // address, case-insensitively.
  app.get('/api/public/compliance-calendar/:token', async function(req, res) {
    try {
      var link = await pgPool.query('SELECT email FROM compliance_calendar_share_links WHERE token = $1', [req.params.token]);
      if (!link.rows.length) return res.status(404).json({ ok: false, error: 'This reminder link is not valid.' });
      var email = link.rows[0].email;
      var r = await pgPool.query(
        `SELECT id, title, description, due_date, recurrence_unit, recurrence_value, notes
       FROM compliance_calendar_items
       WHERE LOWER(responsible_email) LIKE '%' || $1 || '%'
       ORDER BY due_date ASC NULLS LAST, title ASC`,
        [email]
      );
      res.json({ ok: true, email: email, items: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/public/compliance-calendar/:token/:itemId/complete', async function(req, res) {
    try {
      var link = await pgPool.query('SELECT email FROM compliance_calendar_share_links WHERE token = $1', [req.params.token]);
      if (!link.rows.length) return res.status(404).json({ ok: false, error: 'This reminder link is not valid.' });
      var email = link.rows[0].email;

      var existing = await pgPool.query(
        `SELECT * FROM compliance_calendar_items WHERE id = $1 AND LOWER(responsible_email) LIKE '%' || $2 || '%'`,
        [req.params.itemId, email]
      );
      // Not just "not found" — this email genuinely isn't responsible for this
      // item, so no confirmation either way beyond a flat 404 (don't leak
      // whether the item id exists at all to an untrusted public request).
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Task not found' });

      var updated = await completeComplianceCalendarItem(existing.rows[0], email + ' (via shared link)');
      res.json({ ok: true, item: updated });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};
