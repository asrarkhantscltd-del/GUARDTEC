// Non-API routes: logo, SPA shell, new-starter form and the reload hook.
//
// Registered from server.js: require('./routes/pages')(deps)

var fs = require('fs');
var path = require('path');

module.exports = function registerPagesRoutes(deps) {
  var app = deps.app,
    getAuthedUser = deps.getAuthedUser,
    loadAllStaff = deps.loadAllStaff,
    loadRoles = deps.loadRoles,
    requireLogin = deps.requireLogin,
    requirePermission = deps.requirePermission;

  // Serve logo as its own endpoint (no logo configured — always 404)
  app.get('/logo', function(req, res) {
    res.status(404).end();
  });

  // ── SERVE APP WITH EMBEDDED STAFF DATA (no browser fetch needed) ──────────────
  app.get('/', async function(req, res) {
    var authed = getAuthedUser(req);
    if (!authed) {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-store');
      return res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
    try {
      // Only embed the full staff roster (now including bank/NI details) for
      // users who actually hold the 'staff' permission — same gate as /api/staff.
      var hasStaffPerm = authed.role === 'director';
      if (!hasStaffPerm) {
        var roles = await loadRoles();
        var roleDef = roles.find(function(r){ return r.slug === authed.role; });
        hasStaffPerm = !!(roleDef && roleDef.permissions && roleDef.permissions.staff);
      }
      var staff = hasStaffPerm ? loadAllStaff() : [];
      var staffJSON = JSON.stringify(staff);
      var tpl = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
      var page = tpl.replace('/*STAFF_DATA_PLACEHOLDER*/[]', staffJSON);
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-store');
      res.send(page);
    } catch(e) {
      res.send('<h2 style="color:red;padding:20px">Server error: ' + e.message + '</h2>');
    }
  });

  app.get('/new-starter', function(req, res) {
    res.sendFile(path.join(__dirname, 'public', 'new-starter.html'));
  });

  app.get('/reload', requireLogin, requirePermission('staff'), function(req, res) {
    try {
      var staff = loadAllStaff();
      res.json(staff);
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });
};
