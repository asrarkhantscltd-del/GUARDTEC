// Login, logout, self-registration and the current-session lookup.
//
// Registered from server.js: require('./routes/auth')(deps)

var bcrypt = require('bcryptjs');
var crypto = require('crypto');
var jwt = require('jsonwebtoken');

module.exports = function registerAuthRoutes(deps) {
  var JWT_SECRET = deps.JWT_SECRET,
    app = deps.app,
    authRateLimiter = deps.authRateLimiter,
    getAuthedUser = deps.getAuthedUser,
    isPasswordBreached = deps.isPasswordBreached,
    loadAllStaff = deps.loadAllStaff,
    loadRoles = deps.loadRoles,
    passwordStrengthError = deps.passwordStrengthError,
    pgPool = deps.pgPool,
    saveStaff = deps.saveStaff;
  // Cookies are Secure-only in production (HTTPS via Caddy). Plain-http local dev
  // would silently drop a Secure cookie, so it is off outside NODE_ENV=production.
  const COOKIE_SECURE = process.env.NODE_ENV === 'production';

  // ── AUTH HELPERS ──────────────────────────────────────────────────────────────
  function signToken(user) {
    return jwt.sign({ id: user.id, username: user.username, role: user.role || 'supervisor', staff_id: user.staff_id || null, agency_id: user.agency_id || null }, JWT_SECRET, { expiresIn: '7d' });
  }

  // Double-submit CSRF token — readable by JS (unlike the httpOnly auth cookie)
  // so the frontend can echo it back as a header on every mutating request.
  // Defense-in-depth on top of sameSite:'strict', which already blocks the
  // auth cookie from being sent on any cross-site request.
  function issueCsrfCookie(res) {
    var csrfToken = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf_token', csrfToken, {
      httpOnly: false,
      sameSite: 'strict',
      secure: COOKIE_SECURE,
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
  }

  // ── LOGIN / LOGOUT (no gatekeeper — these ARE the gate) ───────────────────────
  async function resolveRoleInfo(role) {
    if (role === 'director') {
      return { name: 'Director', permissions: { staff: true, fleet: true, sites: true, compliance: true, pending_review: true } };
    }
    var roles = await loadRoles();
    var def = roles.find(function(r){ return r.slug === role; });
    return { name: (def && def.name) || role, permissions: (def && def.permissions) || {} };
  }

  app.post('/api/login', authRateLimiter, async function(req, res) {
    try {
      var username = String((req.body && req.body.username) || '').trim().toLowerCase();
      var password = String((req.body && req.body.password) || '');
      var result = await pgPool.query('SELECT id, username, password_hash, role, full_name, staff_id, agency_id, is_active FROM users WHERE username = $1', [username]);
      if (!result.rows.length) return res.status(401).json({ error: 'Invalid username or password' });

      var user = result.rows[0];
      if (user.is_active === false) return res.status(401).json({ error: 'This account has been suspended' });
      var match = await bcrypt.compare(password, user.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid username or password' });

      var deptResult = await pgPool.query(
        'SELECT d.slug, d.name FROM user_departments ud JOIN departments d ON d.id = ud.department_id WHERE ud.user_id = $1',
        [user.id]
      ).catch(function() { return { rows: [] }; });

      var token = signToken(user);
      res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: COOKIE_SECURE,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days, matches the token's own expiry
      });
      issueCsrfCookie(res);
      var roleInfo = await resolveRoleInfo(user.role);
      res.json({
        ok: true,
        token: token,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name || user.username,
          role: user.role || 'supervisor',
          role_name: roleInfo.name,
          staff_id: user.staff_id || null,
          agency_id: user.agency_id || null,
          permissions: roleInfo.permissions,
          departments: deptResult.rows.map(function(d) { return d.slug; })
        }
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/logout', function(req, res) {
    res.clearCookie('token');
    res.clearCookie('csrf_token');
    res.json({ ok: true });
  });

  // Staff self-registration — proves identity with a one-time code an Ops
  // Manager/Director hands them, then the staff member picks their own
  // username & password. No requireLogin gate — this IS how staff get in.
  app.post('/api/register', authRateLimiter, async function(req, res) {
    try {
      var code     = String((req.body && req.body.registration_code) || '').trim().toUpperCase();
      var username = String((req.body && req.body.username) || '').trim().toLowerCase();
      var password = String((req.body && req.body.password) || '');

      if (!code)      return res.status(400).json({ ok: false, error: 'Registration code is required.' });
      if (!username)  return res.status(400).json({ ok: false, error: 'Username is required.' });
      var pwError = passwordStrengthError(password);
      if (pwError) return res.status(400).json({ ok: false, error: pwError });
      if (await isPasswordBreached(password)) return res.status(400).json({ ok: false, error: 'That password has appeared in a known data breach. Please choose a different one.' });

      var all = loadAllStaff();
      var emp = all.find(function(e) { return e.registration_code === code && !e.registration_claimed; });
      if (!emp) return res.status(400).json({ ok: false, error: 'Invalid or already-used registration code. Ask your manager for a new one.' });

      var exists = await pgPool.query('SELECT id FROM users WHERE username = $1', [username]);
      if (exists.rows.length) return res.status(400).json({ ok: false, error: 'That username is already taken.' });

      var hash = await bcrypt.hash(password, 10);
      var r = await pgPool.query(
        'INSERT INTO users (username, password_hash, full_name, role, email, is_active, staff_id) VALUES ($1,$2,$3,$4,$5,TRUE,$6) RETURNING id, username, full_name, role, staff_id',
        [username, hash, emp.name, 'staff', emp.email || '', emp.id]
      );
      var user = r.rows[0];

      emp.registration_claimed = true;
      await saveStaff(emp, emp._folderPath);

      var token = signToken(user);
      res.cookie('token', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: COOKIE_SECURE,
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
      issueCsrfCookie(res);
      var registerRoleInfo = await resolveRoleInfo(user.role);
      res.json({
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name || user.username,
          role: user.role,
          role_name: registerRoleInfo.name,
          staff_id: user.staff_id,
          permissions: registerRoleInfo.permissions,
          departments: []
        }
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/me', async function(req, res) {
    var authed = getAuthedUser(req);
    if (!authed) return res.status(401).json({ error: 'Not logged in' });
    try {
      var result = await pgPool.query('SELECT id, username, role, full_name, staff_id, agency_id, is_active FROM users WHERE id = $1', [authed.id]);
      if (!result.rows.length) return res.status(401).json({ error: 'User not found' });
      var user = result.rows[0];
      if (user.is_active === false) return res.status(401).json({ error: 'This account has been suspended' });
      var deptResult = await pgPool.query(
        'SELECT d.slug, d.name FROM user_departments ud JOIN departments d ON d.id = ud.department_id WHERE ud.user_id = $1',
        [user.id]
      ).catch(function() { return { rows: [] }; });
      var meRoleInfo = await resolveRoleInfo(user.role);
      res.json({
        user: {
          id: user.id,
          username: user.username,
          full_name: user.full_name || user.username,
          role: user.role || 'supervisor',
          role_name: meRoleInfo.name,
          staff_id: user.staff_id || null,
          agency_id: user.agency_id || null,
          permissions: meRoleInfo.permissions,
          departments: deptResult.rows.map(function(d) { return d.slug; })
        }
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
