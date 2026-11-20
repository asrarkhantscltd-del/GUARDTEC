// Dashboard stats, departments, compliance alerts and the HTML overview.
//
// Registered from server.js: require('./routes/dashboard')(deps)

module.exports = function registerDashboardRoutes(deps) {
  var app = deps.app,
    loadAllStaff = deps.loadAllStaff,
    loadSites = deps.loadSites,
    loadVehicles = deps.loadVehicles,
    pgPool = deps.pgPool,
    refreshOverview = deps.refreshOverview,
    requireLogin = deps.requireLogin,
    requirePermission = deps.requirePermission;

  // ── COMPLIANCE ALERTS ─────────────────────────────────────────────────────────
  app.get('/api/compliance/alerts', requireLogin, requirePermission('staff'), function(req, res) {
    try {
      var all = loadAllStaff();
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var in30 = new Date(today.getTime() + 30 * 86400000);
      var items = [];

      all.forEach(function(s) {
        function check(label, dateStr) {
          if (!dateStr) return;
          var d = new Date(dateStr);
          if (isNaN(d.getTime())) return;
          var isExpired = d < today;
          var isExpiring = !isExpired && d <= in30;
          if (isExpired || isExpiring) {
            items.push({ staffId: s.id, name: s.name, label: label, expiry: dateStr, type: isExpired ? 'expired' : 'expiring' });
          }
        }
        check('SIA Licence',    s.sia  && s.sia.expiry);
        check('CSCS Card',      s.cscs && s.cscs.expiry);
        var isBritish = (s.nationality || '').toLowerCase().includes('british');
        if (!isBritish) check('Right to Work', s.visa && s.visa.expiry);
      });

      res.json({ total: items.length, expiredCount: items.filter(function(i){ return i.type === 'expired'; }).length, expiringCount: items.filter(function(i){ return i.type === 'expiring'; }).length, items: items.slice(0, 20) });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/overview', requireLogin, function(req, res) {
    try {
      refreshOverview();
      res.json({ ok: true });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── PHASE 3 API: Departments, Dashboard Stats, Fleet ──────────────────────────

  app.get('/api/departments', requireLogin, async function(req, res) {
    try {
      var result = await pgPool.query('SELECT id, slug, name, description, is_active FROM departments ORDER BY name');
      res.json({ departments: result.rows });
    } catch (e) {
      res.json({ departments: [] });
    }
  });

  app.get('/api/dashboard/stats', requireLogin, async function(req, res) {
    try {
      var allStaff = loadAllStaff();
      var totalStaff = allStaff.length;

      var compliant = 0;
      var expiringSoon = 0;
      var expired = 0;

      // overall is calculated by calcOverall() in loadAllStaff() using the real
      // field names (sia.expiry, cscs.expiry, visa.expiry) — use it directly.
      allStaff.forEach(function(s) {
        if      (s.overall === 'red')   expired++;
        else if (s.overall === 'amber') expiringSoon++;
        else if (s.overall === 'green') compliant++;
      });

      var vehicleCount = (await loadVehicles()).filter(function(v){ return v.status === 'active'; }).length;

      var activeSites = (await loadSites()).filter(function(s){ return s.status !== 'inactive'; }).length;
      // Drivers are just staff carrying the "Driver" role now (see driver/staff
      // unification) — no separate fleet-drivers collection to count anymore.
      var driverCount = allStaff.filter(function(s){
        return String(s.jobRole || '').split(',').map(function(r){ return r.trim(); }).indexOf('Driver') !== -1;
      }).length;

      res.json({
        totalStaff: totalStaff,
        compliant: compliant,
        expiringSoon: expiringSoon,
        expired: expired,
        vehicles: vehicleCount,
        activeSites: activeSites,
        drivers: driverCount,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
};
