// Authentication, roles/permissions, password rules and access-control middleware.
//
// Loaded from server.js: mount(require('./lib/auth')(deps))

var crypto = require('crypto');
var jwt = require('jsonwebtoken');
var rateLimit = require('express-rate-limit');

module.exports = function authLib(deps) {
  var JWT_SECRET = deps.JWT_SECRET,
    pgPool = deps.pgPool;

  // Throttles credential-guessing on the few routes anyone (not just a logged-in
  // user) can hit repeatedly: login, self-registration, and the public
  // acknowledgment-signing link. Keyed by IP by default (express-rate-limit's
  // standard behaviour) — generous enough for a real user who mistypes a
  // password a few times, tight enough that scripting through it is slow.
  var authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many attempts. Please wait 15 minutes and try again.' }
  });

  // ── ROLES (configurable, module-level permissions) ────────────────────────────
  // Modules a role can be granted: staff, fleet, sites, compliance, compliance_calendar, pending_review, crm.
  // Team Access + Manage Roles are deliberately NOT part of this system — they stay
  // hardcoded director-only everywhere, so no role can ever grant itself the power
  // to create/edit other accounts or roles (privilege-escalation guard).
  var DEFAULT_ROLES = [
    { slug: 'director',       name: 'Director',            is_system: true,  permissions: { staff: true,  fleet: true,  sites: true,  compliance: true,  compliance_calendar: true,  pending_review: true,  crm: true  } },
    { slug: 'ops_manager',    name: 'Operations Manager',  is_system: true,  permissions: { staff: true,  fleet: true,  sites: true,  compliance: true,  compliance_calendar: true,  pending_review: true,  crm: true  } },
    { slug: 'hr_manager',     name: 'HR Manager',          is_system: true,  permissions: { staff: true,  fleet: false, sites: true,  compliance: true,  compliance_calendar: true,  pending_review: false } },
    { slug: 'office_manager', name: 'Office Manager',      is_system: true,  permissions: { staff: true,  fleet: false, sites: true,  compliance: false, compliance_calendar: false, pending_review: false } },
    { slug: 'accounts',       name: 'Accounts',            is_system: true,  permissions: { staff: true,  fleet: false, sites: false, compliance: false, compliance_calendar: false, pending_review: false } },
    { slug: 'media',          name: 'Media',               is_system: true,  permissions: { staff: false, fleet: false, sites: false, compliance: false, compliance_calendar: false, pending_review: false } },
    { slug: 'supervisor',     name: 'Supervisor',          is_system: true,  permissions: { staff: true,  fleet: false, sites: true,  compliance: true,  compliance_calendar: true,  pending_review: false } },
    { slug: 'fleet_manager',  name: 'Fleet Manager',       is_system: true,  permissions: { staff: false, fleet: true,  sites: false, compliance: false, compliance_calendar: false, pending_review: false } },
    // Catch-all for a role that doesn't fit any named slot above — starts with
    // no permissions (safest default); a Director adjusts it per-person via
    // Manage Roles rather than it carrying one fixed meaning for everyone
    // assigned to it.
    { slug: 'other',          name: 'Other',                is_system: true,  permissions: {} },
    { slug: 'staff',          name: 'Staff (self-service)',is_system: true,  permissions: {} },
  ];

  (async function ensureRolesSchema() {
    try {
      await pgPool.query(
        "CREATE TABLE IF NOT EXISTS roles (" +
        "slug TEXT PRIMARY KEY, name TEXT NOT NULL, is_system BOOLEAN NOT NULL DEFAULT FALSE, " +
        "permissions JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW())"
      );
      for (var i = 0; i < DEFAULT_ROLES.length; i++) {
        var r = DEFAULT_ROLES[i];
        await pgPool.query(
          'INSERT INTO roles (slug, name, is_system, permissions) VALUES ($1,$2,$3,$4) ON CONFLICT (slug) DO NOTHING',
          [r.slug, r.name, r.is_system, JSON.stringify(r.permissions)]
        );
      }
      // Backfill for roles already in the live DB before this permission key
      // existed — ON CONFLICT DO NOTHING above skips those rows entirely, so a
      // brand-new JSONB key never reaches them on its own. Mirrors each role's
      // existing 'compliance' grant as the default for 'compliance_calendar'
      // (same audience: whoever already sees compliance alerts).
      await pgPool.query(
        `UPDATE roles
       SET permissions = permissions || jsonb_build_object('compliance_calendar', COALESCE(permissions->'compliance', 'false'::jsonb))
       WHERE NOT (permissions ? 'compliance_calendar')`
      );
    } catch (e) {
      console.error('[DB] roles schema migration failed:', e.message);
    }
  })();

  var rolesCache = null;
  async function loadRoles() {
    if (!rolesCache) {
      var result = await pgPool.query('SELECT slug, name, is_system, permissions FROM roles ORDER BY name');
      rolesCache = result.rows;
    }
    return rolesCache;
  }

  // Director always passes — a safety net so a misconfigured role can never
  // lock the Director out of their own system.
  function requirePermission(moduleKey) {
    return async function(req, res, next) {
      if (!req.user || !req.user.role) return res.status(403).json({ error: 'Forbidden' });
      if (req.user.role === 'director') return next();
      try {
        var roles = await loadRoles();
        var roleDef = roles.find(function(r){ return r.slug === req.user.role; });
        if (!roleDef || !roleDef.permissions || !roleDef.permissions[moduleKey]) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        next();
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    };
  }

  // Same rule as requirePermission(), but as a plain yes/no so a handler can
  // decide WHAT to return (or who to push to) instead of 403-ing the whole
  // request. Used to keep compliance-calendar alerts away from roles that
  // don't have the compliance_calendar module (e.g. supervisors).
  async function roleHasPermission(roleSlug, moduleKey) {
    if (!roleSlug) return false;
    if (roleSlug === 'director') return true;
    var roles = await loadRoles();
    var roleDef = roles.find(function(r){ return r.slug === roleSlug; });
    return !!(roleDef && roleDef.permissions && roleDef.permissions[moduleKey]);
  }

  // ── PASSWORD STRENGTH ─────────────────────────────────────────────────────────
  // Shared by every route that lets a human pick their own password
  // (/api/register, /api/users create, /api/users/:id/reset-password) — not
  // applied to generateTempPassword()'s output above, since that's already a
  // random 12-char string nobody typed in.
  function passwordStrengthError(password) {
    if (!password || password.length < 10) return 'Password must be at least 10 characters.';
    return null;
  }

  // Have I Been Pwned's k-anonymity range API: only the first 5 hex chars of
  // the SHA-1 hash ever leave this server, so the real password (and even its
  // full hash) is never sent anywhere. Fails OPEN on any network problem —
  // staff must still be able to register/reset a password if HIBP is
  // unreachable; this is a defence-in-depth extra, not the only gate.
  async function isPasswordBreached(password) {
    try {
      var sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
      var prefix = sha1.slice(0, 5);
      var suffix = sha1.slice(5);
      var resp = await fetch('https://api.pwnedpasswords.com/range/' + prefix, { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) return false;
      var text = await resp.text();
      return text.split('\n').some(function(line) { return line.split(':')[0].trim() === suffix; });
    } catch (e) {
      return false;
    }
  }

  // Pulls the token from wherever it might be — cookie (web/PWA) or Authorization
  // header (future native mobile app) — without sending any response itself.
  function getAuthedUser(req) {
    var token = null;
    if (req.cookies && req.cookies.token) token = req.cookies.token;
    else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7);
    }
    if (!token) return null;
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (e) {
      return null; // missing, expired, or tampered — all treated as "not logged in"
    }
  }

  // The gatekeeper: sits in front of API routes. No valid token -> 401, real
  // route code never runs.
  //
  // Agencies get one extra check other roles don't: is_active is re-verified
  // against the DB on every request, not just trusted from the JWT. Found via
  // testing — archiving an agency (which sets users.is_active=false) otherwise
  // left any session token that agency had already been issued fully working
  // for the rest of its 7-day life, since a JWT's signature staying valid says
  // nothing about whether the account behind it is still allowed to log in.
  // That's an acceptable gap for internal staff (rare, trusted, and app-wide
  // change would be a bigger unrelated behavior shift) but not for an external
  // party you may need to lock out immediately.
  async function requireLogin(req, res, next) {
    var user = getAuthedUser(req);
    if (!user) return res.status(401).json({ error: 'Not logged in' });
    if (user.role === 'agency') {
      try {
        var r = await pgPool.query('SELECT is_active FROM users WHERE id = $1', [user.id]);
        if (!r.rows.length || r.rows[0].is_active === false) {
          return res.status(401).json({ error: 'This account has been suspended.' });
        }
      } catch (e) {
        return res.status(500).json({ error: 'Auth check failed.' });
      }
    }
    req.user = user;
    next();
  }

  function requireRole() {
    var allowedRoles = Array.prototype.slice.call(arguments);
    return function(req, res, next) {
      if (!req.user || !req.user.role) return res.status(403).json({ error: 'Forbidden' });
      if (allowedRoles.indexOf(req.user.role) === -1) return res.status(403).json({ error: 'Forbidden' });
      next();
    };
  }

  // Lets an agency user act on their OWN agency (req.params.agencyId must match
  // their agency_id), or falls back to the normal management permission check
  // for everyone else (director / any role granted moduleKey). Sibling to
  // requireOwnStaffOrPermission, same shape.
  function requireOwnAgencyOrPermission(moduleKey) {
    var permCheck = requirePermission(moduleKey);
    return function(req, res, next) {
      if (req.user && req.user.role === 'agency') {
        if (req.user.agency_id && req.user.agency_id === req.params.agencyId) return next();
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      permCheck(req, res, next);
    };
  }

  // ── DB HELPERS ────────────────────────────────────────────────────────────────
  async function resolveEmpId(legacyId) {
    var r = await pgPool.query('SELECT id FROM employees WHERE legacy_id = $1', [legacyId]);
    return r.rows.length ? r.rows[0].id : null;
  }

  async function hasStaffPermission(req) {
    if (!req.user || !req.user.role) return false;
    if (req.user.role === 'director') return true;
    var roles = await loadRoles();
    var roleDef = roles.find(function(r){ return r.slug === req.user.role; });
    return !!(roleDef && roleDef.permissions && roleDef.permissions.staff);
  }

  // Shared ownership gate for incident-report / message attachment routes, which
  // are keyed by reportId/messageId/attachId — not a staff :id — so the existing
  // requireOwnStaffOrPermission() pattern can't compare params directly. Callers
  // resolve the row's owning employees.id first, then this checks either
  // management (`staff` permission) or "this employees.id is me". Sends the 403
  // itself so call sites can just `if (!await ...) return;`.
  async function canAccessOwnerEmpId(req, res, ownerEmpId) {
    if (await hasStaffPermission(req)) return true;
    var myEmpId = req.user.staff_id ? await resolveEmpId(req.user.staff_id) : null;
    if (myEmpId && ownerEmpId && myEmpId === ownerEmpId) return true;
    res.status(403).json({ ok: false, error: 'Forbidden' });
    return false;
  }

  return {
    authRateLimiter: authRateLimiter,
    canAccessOwnerEmpId: canAccessOwnerEmpId,
    getAuthedUser: getAuthedUser,
    hasStaffPermission: hasStaffPermission,
    isPasswordBreached: isPasswordBreached,
    loadRoles: loadRoles,
    passwordStrengthError: passwordStrengthError,
    requireLogin: requireLogin,
    requireOwnAgencyOrPermission: requireOwnAgencyOrPermission,
    requirePermission: requirePermission,
    requireRole: requireRole,
    resolveEmpId: resolveEmpId,
    roleHasPermission: roleHasPermission,
    get rolesCache() { return rolesCache; },
    set rolesCache(v) { rolesCache = v; },
  };
};
