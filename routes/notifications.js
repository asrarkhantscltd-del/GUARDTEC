// Notification bell feed and Web Push subscriptions.
//
// Registered from server.js: require('./routes/notifications')(deps)

module.exports = function registerNotificationsRoutes(deps) {
  var app = deps.app,
    canViewNotification = deps.canViewNotification,
    pgPool = deps.pgPool,
    requireLogin = deps.requireLogin,
    requirePermission = deps.requirePermission,
    roleHasPermission = deps.roleHasPermission;

  async function notificationViewer(user) {
    var r = await pgPool.query('SELECT email FROM users WHERE id = $1', [user.id]);
    return {
      email: r.rows.length ? r.rows[0].email : '',
      hasCalendarModule: await roleHasPermission(user.role, 'compliance_calendar')
    };
  }

  // ── NOTIFICATIONS ─────────────────────────────────────────────────────────────

  // Management: which staff have unread messages (for bell notification list)
  // Management: unseen per-event notifications for the bell — each one clickable,
  // each disappears (seen_at set) once the manager has navigated to it.
  app.get('/api/notifications', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      // Calendar reminders are personal — see canViewNotification(). Fetch a
      // wider window, then filter, so hidden rows don't crowd out visible ones.
      var viewer = await notificationViewer(req.user);
      var result = await pgPool.query(
        `SELECT id, type, actor_name, summary, link_staff_id, link_tab, link_incident_id, link_agency_id, created_at
       FROM notifications WHERE seen_at IS NULL ORDER BY created_at DESC LIMIT 300`
      );
      var visible = result.rows.filter(function(n) { return canViewNotification(n, viewer); }).slice(0, 50);
      res.json({ ok: true, notifications: visible });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/notifications/:id/seen', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      // Only mark it seen if this user is actually allowed to see it.
      var viewer = await notificationViewer(req.user);
      var row = await pgPool.query('SELECT type, summary FROM notifications WHERE id = $1', [req.params.id]);
      if (row.rows.length && canViewNotification(row.rows[0], viewer)) {
        await pgPool.query('UPDATE notifications SET seen_at = NOW() WHERE id = $1', [req.params.id]);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/notifications/seen-all', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      // "Clear all" only clears what this user can actually see — otherwise one
      // person clearing their bell would silently wipe someone else's calendar alerts.
      var viewer = await notificationViewer(req.user);
      var unseen = await pgPool.query('SELECT id, type, summary FROM notifications WHERE seen_at IS NULL');
      var ids = unseen.rows.filter(function(n) { return canViewNotification(n, viewer); }).map(function(n) { return n.id; });
      if (ids.length) {
        await pgPool.query('UPDATE notifications SET seen_at = NOW() WHERE id = ANY($1::uuid[])', [ids]);
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── WEB PUSH — routes ──────────────────────────────────────────────────────
  // pushToManagers() and the push_subscriptions schema are defined up near
  // createNotification() (they're plain functions, order doesn't matter for
  // those); these three routes have to live down here specifically, after
  // app.use(cookieParser())/app.use(express.json()) above, or req.cookies and
  // req.body are both undefined when they run.
  // Just requireLogin (not requirePermission('staff'), which is the "manage
  // staff records" module permission, not the role) — staff members now get
  // targeted push too (see the /api/staff/:id/messages hook), so anyone
  // logged in, manager or staff, needs to be able to subscribe.
  app.get('/api/push/vapid-public-key', requireLogin, function(req, res) {
    res.json({ ok: true, key: process.env.VAPID_PUBLIC_KEY || null });
  });

  app.post('/api/push/subscribe', requireLogin, async function(req, res) {
    try {
      var sub = req.body && req.body.subscription;
      if (!sub || !sub.endpoint || !sub.keys) return res.status(400).json({ ok: false, error: 'Invalid subscription.' });
      await pgPool.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4`,
        [req.user.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/push/unsubscribe', requireLogin, async function(req, res) {
    try {
      var endpoint = req.body && req.body.endpoint;
      if (!endpoint) return res.status(400).json({ ok: false, error: 'endpoint is required.' });
      await pgPool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};
