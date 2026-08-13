const express      = require('express');
const { exec }     = require('child_process');
const fs           = require('fs');
const path         = require('path');
const XLSX         = require('xlsx');
const cookieParser = require('cookie-parser');
const jwt          = require('jsonwebtoken');
const bcrypt       = require('bcryptjs');
const crypto       = require('crypto');
const { Pool }     = require('pg');

const app  = express();
const PORT = 3000;

const JWT_SECRET = process.env.JWT_SECRET;
const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });

// Self-healing schema — adds columns introduced after the original users table
// was created, so upgrades never require a manual migration step.
(async function ensureUsersSchema() {
  try {
    await pgPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''");
    await pgPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE");
    await pgPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_id TEXT");
  } catch (e) {
    console.error('[DB] users schema migration failed:', e.message);
  }
})();

// ── ROLES (configurable, module-level permissions) ────────────────────────────
// Modules a role can be granted: staff, fleet, sites, compliance, pending_review.
// Team Access + Manage Roles are deliberately NOT part of this system — they stay
// hardcoded director-only everywhere, so no role can ever grant itself the power
// to create/edit other accounts or roles (privilege-escalation guard).
var DEFAULT_ROLES = [
  { slug: 'director',       name: 'Director',            is_system: true,  permissions: { staff: true,  fleet: true,  sites: true,  compliance: true,  pending_review: true  } },
  { slug: 'ops_manager',    name: 'Operations Manager',  is_system: true,  permissions: { staff: true,  fleet: true,  sites: true,  compliance: true,  pending_review: true  } },
  { slug: 'hr_manager',     name: 'HR Manager',          is_system: true,  permissions: { staff: true,  fleet: false, sites: true,  compliance: true,  pending_review: false } },
  { slug: 'office_manager', name: 'Office Manager',      is_system: true,  permissions: { staff: true,  fleet: false, sites: true,  compliance: false, pending_review: false } },
  { slug: 'accounts',       name: 'Accounts',            is_system: true,  permissions: { staff: true,  fleet: false, sites: false, compliance: false, pending_review: false } },
  { slug: 'media',          name: 'Media',               is_system: true,  permissions: { staff: false, fleet: false, sites: false, compliance: false, pending_review: false } },
  { slug: 'supervisor',     name: 'Supervisor',          is_system: true,  permissions: { staff: true,  fleet: false, sites: true,  compliance: true,  pending_review: false } },
  { slug: 'fleet_manager',  name: 'Fleet Manager',       is_system: true,  permissions: { staff: false, fleet: true,  sites: false, compliance: false, pending_review: false } },
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
function invalidateRolesCache() { rolesCache = null; }

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

// ── AUTH HELPERS ──────────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role || 'supervisor', staff_id: user.staff_id || null }, JWT_SECRET, { expiresIn: '7d' });
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
    secure: false, // TODO: set true once Phase 7 adds HTTPS, matches the auth cookie's own TODO
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
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
function requireLogin(req, res, next) {
  var user = getAuthedUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
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


const HOME        = process.env.USERPROFILE || ('C:\\Users\\' + require('os').userInfo().username);
const BASE        = process.env.DATA_PATH || path.join(HOME, "First Call Site Services", "FCSS - Managers", "HR and Legal", "Asrar", "GuardTec Compliance");
const ACTIVE_DIR  = path.join(BASE, "02 - Vetting & Screening", "Active Staff");
const OVERVIEW    = path.join(BASE, "02 - Vetting & Screening", "GUARDTEC — COMPLIANCE OVERVIEW.html");
const SPREADSHEET = process.env.DATA_PATH ? path.join(process.env.DATA_PATH, "01 - Staff Compliance Tracker", "GuardTec Security — Staff Compliance Tracker.xlsx") : path.join(HOME, "OneDrive - First Call Site Services", "TOTAL EMPLOYEE spreadsheet.xlsl.xlsx");
const COMPLIANCE_TRACKER   = path.join(BASE, "01 - Staff Compliance Tracker", "GuardTec Security — Staff Compliance Tracker.xlsx");
const REFERENCE_TRACKER    = path.join(BASE, "05 - Reference Tracker", "GuardTec Security — Reference Check Tracker.xlsx");
const SHAREPOINT_DASHBOARD = path.join(BASE, "! GuardTec Compliance Dashboard.html");
const SITES_FILE           = path.join(BASE, "deployment-sites.json");

const SUBFOLDERS = ['01 - SIA Licence','02 - CSCS Card','03 - Right to Work & Visa','04 - References','05 - Employment Contract','06 - Training & Induction'];
function getTodayStr() { return new Date().toISOString().split('T')[0]; }

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// ── CSRF double-submit check ──────────────────────────────────────────────────
// Every mutating request must echo the csrf_token cookie back as a header.
// A cross-site attacker's page can trigger the request but can never read the
// cookie to put in the header, so the two won't match. Login/register are
// exempt — no CSRF cookie exists yet before the user is authenticated.
var CSRF_EXEMPT_PATHS = ['/api/login', '/api/register'];
app.use(function(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].indexOf(req.method) !== -1) return next();
  if (CSRF_EXEMPT_PATHS.indexOf(req.path) !== -1) return next();
  var cookieToken = req.cookies && req.cookies.csrf_token;
  var headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ ok: false, error: 'Invalid or missing CSRF token. Please log out and back in.' });
  }
  next();
});

// ── LOGIN / LOGOUT (no gatekeeper — these ARE the gate) ───────────────────────
async function resolveRoleInfo(role) {
  if (role === 'director') {
    return { name: 'Director', permissions: { staff: true, fleet: true, sites: true, compliance: true, pending_review: true } };
  }
  var roles = await loadRoles();
  var def = roles.find(function(r){ return r.slug === role; });
  return { name: (def && def.name) || role, permissions: (def && def.permissions) || {} };
}

app.post('/api/login', async function(req, res) {
  try {
    var username = String((req.body && req.body.username) || '').trim();
    var password = String((req.body && req.body.password) || '');
    var result = await pgPool.query('SELECT id, username, password_hash, role, full_name, staff_id, is_active FROM users WHERE username = $1', [username]);
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
      secure: false, // TODO: set true once Phase 7 adds HTTPS — a secure cookie is silently dropped over plain HTTP
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
app.post('/api/register', async function(req, res) {
  try {
    var code     = String((req.body && req.body.registration_code) || '').trim().toUpperCase();
    var username = String((req.body && req.body.username) || '').trim().toLowerCase();
    var password = String((req.body && req.body.password) || '');

    if (!code)      return res.status(400).json({ ok: false, error: 'Registration code is required.' });
    if (!username)  return res.status(400).json({ ok: false, error: 'Username is required.' });
    if (!password || password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters.' });

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
    saveStaff(emp, emp._folderPath);

    var token = signToken(user);
    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
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
    var result = await pgPool.query('SELECT id, username, role, full_name, staff_id, is_active FROM users WHERE id = $1', [authed.id]);
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
        permissions: meRoleInfo.permissions,
        departments: deptResult.rows.map(function(d) { return d.slug; })
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve logo as its own endpoint (no logo configured — always 404)
app.get('/logo', function(req, res) {
  res.status(404).end();
});

// ── PROFILE PHOTO ─────────────────────────────────────────────────────────────
function findFileByExts(dir, prefix) {
  var exts = ['.jpg', '.jpeg', '.png', '.webp'];
  for (var e of exts) {
    var p = path.join(dir, prefix + e);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findProfilePhoto(folderPath) { return findFileByExts(folderPath, 'profile'); }

app.get('/api/staff/:id/photo', requireLogin, function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._folderPath) return res.status(404).end();
    var photo = findProfilePhoto(emp._folderPath);
    if (!photo) return res.status(404).end();
    var ext = path.extname(photo).toLowerCase();
    var mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(photo));
  } catch(e) {
    res.status(500).end();
  }
});

app.post('/api/staff/:id/photo', requireLogin, function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._folderPath) return res.status(404).json({ ok:false, error:'Staff not found' });

    var chunks = [];
    req.on('data', function(c){ chunks.push(c); });
    req.on('end', function() {
      var buf = Buffer.concat(chunks);
      // Detect image type from header bytes
      var ext = '.jpg';
      if (buf[0]===0x89 && buf[1]===0x50) ext = '.png';
      else if (buf[0]===0xFF && buf[1]===0xD8) ext = '.jpg';

      // Remove any old profile photo
      ['.jpg','.jpeg','.png','.webp'].forEach(function(e){
        var old = path.join(emp._folderPath, 'profile' + e);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      });

      var dest = path.join(emp._folderPath, 'profile' + ext);
      fs.writeFileSync(dest, buf);
      console.log('[PHOTO] Saved profile photo for', emp.name);
      res.json({ ok: true });
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── STAFF DOCUMENT FILES ──────────────────────────────────────────────────────
var ALLOWED_DOC_KEYS = [
  'siaPhysical','passport','brpCard','proofOfAddress1','proofOfAddress2',
  'p45','bankLetter','application','assignmentInstructions'
];

function findDocFile(folderPath, docKey) {
  var exts = ['.pdf','.jpg','.jpeg','.png','.webp'];
  for (var e of exts) {
    var dp = path.join(folderPath, 'doc_' + docKey + e);
    if (fs.existsSync(dp)) return dp;
  }
  return null;
}

app.get('/api/staff/:id/documents/:docKey', requireLogin, function(req, res) {
  var docKey = req.params.docKey;
  if (!ALLOWED_DOC_KEYS.includes(docKey)) return res.status(400).end();
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._folderPath) return res.status(404).end();
    var fp = findDocFile(emp._folderPath, docKey);
    if (!fp) return res.status(404).end();
    var ext = path.extname(fp).toLowerCase();
    var mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', 'inline; filename="' + docKey + ext + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(fp));
  } catch(e) {
    res.status(500).end();
  }
});

app.post('/api/staff/:id/documents/:docKey', requireLogin, function(req, res) {
  var docKey = req.params.docKey;
  if (!ALLOWED_DOC_KEYS.includes(docKey)) return res.status(400).json({ ok:false, error:'Invalid document key' });
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._folderPath) return res.status(404).json({ ok:false, error:'Staff not found' });
    var chunks = [];
    req.on('data', function(c){ chunks.push(c); });
    req.on('end', function() {
      var buf = Buffer.concat(chunks);
      // Detect file type from magic bytes
      var ext = '.pdf';
      if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
      else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';
      // Remove any existing file for this docKey
      ['.pdf','.jpg','.jpeg','.png','.webp'].forEach(function(e){
        var old = path.join(emp._folderPath, 'doc_' + docKey + e);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      });
      fs.writeFileSync(path.join(emp._folderPath, 'doc_' + docKey + ext), buf);
      // Auto-update metadata in staff_data.json
      var jp = path.join(emp._folderPath, 'staff_data.json');
      var data = JSON.parse(fs.readFileSync(jp, 'utf8'));
      if (!data.documents) data.documents = {};
      var today = new Date().toISOString().split('T')[0];
      data.documents[docKey] = { uploaded: true, date: today };
      fs.writeFileSync(jp, JSON.stringify(data, null, 2));
      console.log('[DOCS] Saved', docKey, 'for', emp.name);
      res.json({ ok:true, date: today });
    });
  } catch(e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ── USER (ACCOUNT) PROFILE PHOTOS ────────────────────────────────────────────
// One photo per logged-in account (stored by postgres user id, not staff id).
// Works for every role — director, manager, staff — anyone with a login.
var USER_PHOTOS_DIR = path.join(BASE, 'user-photos');
if (!fs.existsSync(USER_PHOTOS_DIR)) fs.mkdirSync(USER_PHOTOS_DIR, { recursive: true });

function findUserPhoto(userId) { return findFileByExts(USER_PHOTOS_DIR, String(userId)); }

app.get('/api/users/:id/photo', requireLogin, function(req, res) {
  try {
    var photo = findUserPhoto(req.params.id);
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

// ── DATE HELPERS ──────────────────────────────────────────────────────────────
function excelDate(v) {
  if (!v) return null;
  var s = String(v).trim().toUpperCase();
  if (['N/A','NA','--','ILR','WAITING',''].includes(s)) return null;
  if (typeof v === 'number') return new Date(Date.UTC(1899,11,30) + v * 86400000);
  var d = new Date(String(v).trim());
  return isNaN(d.getTime()) ? null : d;
}
function toISO(d) { return d ? d.toISOString().split('T')[0] : null; }
function daysFrom(dateStr) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr) - new Date(getTodayStr())) / 86400000);
}
function fmtDate(s) {
  if (!s) return 'N/A';
  var p = String(s).split('-');
  if (p.length === 3) return p[2] + '/' + p[1] + '/' + p[0];
  return new Date(s).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'});
}
function statusOf(days) {
  if (days === null) return 'unknown';
  if (days < 0) return 'red';
  if (days < 91) return 'amber';
  return 'green';
}
function worstStatus(arr) {
  if (arr.includes('red'))   return 'red';
  if (arr.includes('amber')) return 'amber';
  if (arr.includes('green')) return 'green';
  return 'unknown';
}
function calcOverall(emp) {
  var s = [];
  // SIA Licence — required, missing = action required
  if (!emp.sia || !emp.sia.number) {
    s.push('amber');
  } else {
    s.push(statusOf(daysFrom(emp.sia.expiry)));
  }
  // CSCS Card — required, missing or pending = action required
  if (!emp.cscs || !emp.cscs.number) {
    s.push('amber');
  } else if (String(emp.cscs.number).toUpperCase().startsWith('PENDING')) {
    s.push('amber');
  } else {
    s.push(statusOf(daysFrom(emp.cscs.expiry)));
  }
  // Right to Work — British (no visa type) = green automatically
  if (!emp.visa || !emp.visa.type) {
    s.push('green');
  } else if (emp.visa.expiry) {
    s.push(statusOf(daysFrom(emp.visa.expiry)));
  } else {
    s.push('green'); // ILR or indefinite leave
  }
  return worstStatus(s);
}
function overallEmoji(s) { return s==='green'?'🟢':s==='amber'?'🟡':s==='red'?'🔴':'⚪'; }
function safeName(n) { return String(n).replace(/[<>:"/\\|?*]/g,'').trim(); }

function folderForEmp(emp) {
  return path.join(ACTIVE_DIR, overallEmoji(emp.overall) + ' ' + safeName(emp.name));
}

// ── EXCEL HELPERS ─────────────────────────────────────────────────────────────
var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function isoToExcelDate(isoStr) {
  if (!isoStr) return '';
  var d = new Date(isoStr);
  if (isNaN(d.getTime())) return '';
  return String(d.getUTCDate()).padStart(2,'0') + ' ' + MONTHS_SHORT[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}
function siaStatusText(emp) {
  if (!emp.sia || !emp.sia.number) return 'NOT ON FILE';
  var days = daysFrom(emp.sia.expiry);
  if (days === null) return 'VALID';
  if (days < 0)  return 'EXPIRED';
  if (days < 91) return 'EXPIRING < 90 DAYS';
  return 'VALID';
}
function cscsStatusText(emp) {
  if (!emp.cscs || !emp.cscs.number) return 'NOT ON FILE';
  if (String(emp.cscs.number).toUpperCase().startsWith('PENDING')) return 'PENDING';
  var days = daysFrom(emp.cscs.expiry);
  if (days === null) return 'VALID';
  if (days < 0)  return 'EXPIRED';
  if (days < 91) return 'EXPIRING < 90 DAYS';
  return 'VALID';
}
function rtwStatusText(emp) {
  if (!emp.visa || !emp.visa.type) return 'NOT ON FILE';
  var t = String(emp.visa.type).toUpperCase();
  if (!emp.visa.expiry || ['ILR','BRITISH','EUSS'].some(function(x){ return t.includes(x); })) return 'VALID (ILR/BRITISH/EUSS)';
  var days = daysFrom(emp.visa.expiry);
  if (days === null) return 'VALID';
  if (days < 0)  return 'EXPIRED';
  if (days < 91) return 'EXPIRING < 90 DAYS';
  return 'VALID (BRP)';
}
function setXlCell(ws, r, c, val) {
  var addr = XLSX.utils.encode_cell({r: r, c: c});
  ws[addr] = {t: 's', v: val === null || val === undefined ? '' : String(val)};
}
function findXlRow(rows, name) {
  var low = String(name).toLowerCase().trim();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i][0] && String(rows[i][0]).toLowerCase().trim() === low) return i;
  }
  return -1;
}

function updateComplianceTracker(emp) {
  try {
    var wb = XLSX.readFile(COMPLIANCE_TRACKER);

    // SIA Licences: cols — 0=Name, 2=SIA#, 3=Expiry, 4=Status
    var siaSh = wb.Sheets['SIA Licences'];
    if (siaSh) {
      var siaRows = XLSX.utils.sheet_to_json(siaSh, {header:1});
      var ri = findXlRow(siaRows, emp.name);
      if (ri >= 0) {
        setXlCell(siaSh, ri, 2, emp.sia && emp.sia.number ? emp.sia.number : '');
        setXlCell(siaSh, ri, 3, isoToExcelDate(emp.sia && emp.sia.expiry));
        setXlCell(siaSh, ri, 4, siaStatusText(emp));
      } else { console.warn('[Excel] SIA sheet: no row for', emp.name); }
    }

    // CSCS Cards: cols — 0=Name, 2=CSCS#, 3=Expiry, 4=Status
    var cscsSh = wb.Sheets['CSCS Cards'];
    if (cscsSh) {
      var cscsRows = XLSX.utils.sheet_to_json(cscsSh, {header:1});
      var ri2 = findXlRow(cscsRows, emp.name);
      if (ri2 >= 0) {
        setXlCell(cscsSh, ri2, 2, emp.cscs && emp.cscs.number ? emp.cscs.number : '');
        setXlCell(cscsSh, ri2, 3, isoToExcelDate(emp.cscs && emp.cscs.expiry));
        setXlCell(cscsSh, ri2, 4, cscsStatusText(emp));
      } else { console.warn('[Excel] CSCS sheet: no row for', emp.name); }
    }

    // Visa & Right to Work: cols — 0=Name, 2=VisaType, 3=Expiry, 4=RTWStatus, 5=SIAExpiry
    var visaSh = wb.Sheets['Visa & Right to Work'];
    if (visaSh) {
      var visaRows = XLSX.utils.sheet_to_json(visaSh, {header:1});
      var ri3 = findXlRow(visaRows, emp.name);
      if (ri3 >= 0) {
        setXlCell(visaSh, ri3, 2, emp.visa && emp.visa.type ? emp.visa.type : '');
        setXlCell(visaSh, ri3, 3, isoToExcelDate(emp.visa && emp.visa.expiry));
        setXlCell(visaSh, ri3, 4, rtwStatusText(emp));
        setXlCell(visaSh, ri3, 5, isoToExcelDate(emp.sia && emp.sia.expiry));
      } else { console.warn('[Excel] Visa sheet: no row for', emp.name); }
    }

    XLSX.writeFile(wb, COMPLIANCE_TRACKER);
    console.log('[Excel] Compliance Tracker updated:', emp.name);
  } catch(e) {
    console.error('[Excel] updateComplianceTracker error:', e.message);
  }
}

function updateReferenceTracker(emp) {
  try {
    var wb = XLSX.readFile(REFERENCE_TRACKER);
    var ws = wb.Sheets['Reference Board'];
    if (!ws) { console.warn('[Excel] Reference Board sheet not found'); return; }

    var rows = XLSX.utils.sheet_to_json(ws, {header:1});
    // rows[0]=title, rows[1]=status key, rows[2]=headers, rows[3+]=data
    var ri = -1;
    var low = String(emp.name).toLowerCase().trim();
    for (var i = 3; i < rows.length; i++) {
      if (rows[i] && rows[i][0] && String(rows[i][0]).toLowerCase().trim() === low) { ri = i; break; }
    }
    if (ri < 0) { console.warn('[Excel] Reference Tracker: no row for', emp.name); return; }

    var ref1 = (emp.references && emp.references.ref1) || {};
    var ref2 = (emp.references && emp.references.ref2) || {};

    // cols: 1=Ref1Name, 2=Ref1Co, 3=Ref1Email, 5=Ref1Status
    //       6=Ref2Name, 7=Ref2Co, 8=Ref2Email, 10=Ref2Status, 11=Overall
    setXlCell(ws, ri, 1,  ref1.name    || '');
    setXlCell(ws, ri, 2,  ref1.company || '');
    setXlCell(ws, ri, 3,  ref1.email   || '');
    setXlCell(ws, ri, 5,  ref1.status  || 'Not Started');
    setXlCell(ws, ri, 6,  ref2.name    || '');
    setXlCell(ws, ri, 7,  ref2.company || '');
    setXlCell(ws, ri, 8,  ref2.email   || '');
    setXlCell(ws, ri, 10, ref2.status  || 'Not Started');

    var s1 = ref1.status || 'Not Started';
    var s2 = ref2.status || 'Not Started';
    var overall;
    if (s1 === 'Satisfactory' && s2 === 'Satisfactory') overall = 'Satisfactory';
    else if (s1 === 'Unsatisfactory' || s2 === 'Unsatisfactory') overall = 'Unsatisfactory';
    else if (['Received','Chased'].includes(s1) || ['Received','Chased'].includes(s2)) overall = 'In Progress';
    else if (s1 === 'Email Sent' || s2 === 'Email Sent') overall = 'Email Sent';
    else if (s1 === 'N/A' && s2 === 'N/A') overall = 'N/A';
    else overall = 'Not Started';

    setXlCell(ws, ri, 11, overall);

    XLSX.writeFile(wb, REFERENCE_TRACKER);
    console.log('[Excel] Reference Tracker updated:', emp.name);
  } catch(e) {
    console.error('[Excel] updateReferenceTracker error:', e.message);
  }
}

// ── LOAD STAFF ────────────────────────────────────────────────────────────────
function loadAllStaff() {
  var staff = [];
  if (!fs.existsSync(ACTIVE_DIR)) return staff;

  // Build set of ex-staff names to exclude (OneDrive may restore deleted folders)
  var exDir = path.join(BASE, '02 - Vetting & Screening', 'Ex-Staff');
  var exNames = new Set();
  if (fs.existsSync(exDir)) {
    fs.readdirSync(exDir).forEach(function(d) {
      var clean = d.replace(/^[^\p{L}A-Za-z]+/u, '').trim().toUpperCase();
      if (clean) exNames.add(clean);
    });
  }

  fs.readdirSync(ACTIVE_DIR).forEach(function(d) {
    var fp = path.join(ACTIVE_DIR, d);
    try {
      if (!fs.statSync(fp).isDirectory()) return;
      var jp = path.join(fp, 'staff_data.json');
      if (!fs.existsSync(jp)) return;
      // Skip if this person is also in Ex-Staff
      var clean = d.replace(/^[^\p{L}A-Za-z]+/u, '').trim().toUpperCase();
      if (exNames.has(clean)) return;
      var emp = JSON.parse(fs.readFileSync(jp,'utf8'));
      emp._folderPath = fp;
      emp.overall = calcOverall(emp);
      staff.push(emp);
    } catch(e) {}
  });
  return staff;
}

// ── SAVE STAFF ────────────────────────────────────────────────────────────────
function saveStaff(emp, oldFolderPath) {
  emp.overall = calcOverall(emp);
  var newFolder = folderForEmp(emp);
  if (oldFolderPath && oldFolderPath !== newFolder && fs.existsSync(oldFolderPath)) {
    try { fs.renameSync(oldFolderPath, newFolder); } catch(e) { newFolder = oldFolderPath; }
  }
  if (!fs.existsSync(newFolder)) fs.mkdirSync(newFolder, {recursive:true});
  SUBFOLDERS.forEach(function(sf) {
    var p = path.join(newFolder, sf);
    if (!fs.existsSync(p)) fs.mkdirSync(p, {recursive:true});
  });
  emp._folderPath = newFolder;
  fs.writeFileSync(path.join(newFolder,'staff_data.json'), JSON.stringify(emp,null,2), 'utf8');
  fs.writeFileSync(path.join(newFolder,'COMPLIANCE SUMMARY - '+safeName(emp.name)+'.html'), buildReportHTML(emp), 'utf8');
  scheduleGitPush(emp.name);
  return newFolder;
}

// ── DEPLOYMENT SITES ──────────────────────────────────────────────────────────
function loadSites() {
  if (!fs.existsSync(SITES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(SITES_FILE, 'utf8')).sites || []; } catch(e) { return []; }
}
function saveSites(sites) {
  fs.writeFileSync(SITES_FILE, JSON.stringify({ sites: sites }, null, 2), 'utf8');
}

// ── INIT FROM SPREADSHEET ─────────────────────────────────────────────────────
function initFromSpreadsheet() {
  try {
    var wb = XLSX.readFile(SPREADSHEET);
    var ws = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws,{header:1});
    rows.slice(1).forEach(function(r) {
      if (!r || !r[0]) return;
      var name = String(r[0]).trim();
      if (!name) return;

      // Sanity check: real staff rows always have a real phone number.
      // Legend/summary/caption rows in the spreadsheet (e.g. "COLOUR KEY",
      // "TOTAL STAFF TRACKED") have either a blank phone column or non-numeric
      // text there instead — skip anything that isn't a real phone number so
      // it doesn't get created as a fake staff folder on every app restart.
      var phoneDigits = (r[3] ? String(r[3]) : '').replace(/\D/g, '');
      if (phoneDigits.length < 7) return;

      var siaNum = r[5] ? String(r[5]).trim().replace(/\s+/g,'') : '';
      if (['N/A','NA',''].includes(siaNum.toUpperCase())) siaNum = '';

      var cscsNum = r[7] ? String(r[7]).trim() : '';
      var cscsUp = cscsNum.replace(/\s+/g,'').toUpperCase();
      if (['N/A','NA','--',''].includes(cscsUp)) cscsNum = '';
      else if (['BOOKCOSAC','BOOKTEST','NOTCOMPLETE','WAITING'].includes(cscsUp)) cscsNum = 'PENDING - Book required';

      var visaType = r[9] ? String(r[9]).trim() : '';
      if (['N/A','NA',''].includes(visaType.toUpperCase())) visaType = '';

      var emp = {
        id: name.toLowerCase().replace(/[^a-z0-9]/g,'-'),
        name: name,
        nationality: r[1] ? String(r[1]).trim() : '',
        gender:      r[2] ? String(r[2]).trim() : '',
        phone:       r[3] ? String(r[3]).toString().trim() : '',
        email:       r[4] ? String(r[4]).trim() : '',
        sia:  { number: siaNum,   expiry: toISO(excelDate(r[6])) },
        cscs: { number: cscsNum,  expiry: toISO(excelDate(r[8])) },
        visa: { type:   visaType, expiry: toISO(excelDate(r[10])) },
        references: {
          ref1: { name:'', company:'', email:'', status:'Not Started' },
          ref2: { name:'', company:'', email:'', status:'Not Started' }
        },
        contract: '', induction: false, status: 'active', addedDate: getTodayStr()
      };
      emp.overall = calcOverall(emp);

      // Find existing folder (any emoji prefix + name)
      var matched = null;
      if (fs.existsSync(ACTIVE_DIR)) {
        fs.readdirSync(ACTIVE_DIR).forEach(function(d) {
          var clean = d.replace(/^[\s\S]{1,3}/,'').trim();
          if (clean.toLowerCase() === name.toLowerCase()) matched = path.join(ACTIVE_DIR, d);
        });
      }

      var target = matched || folderForEmp(emp);
      if (!fs.existsSync(target)) fs.mkdirSync(target, {recursive:true});
      SUBFOLDERS.forEach(function(sf) {
        var p = path.join(target, sf);
        if (!fs.existsSync(p)) fs.mkdirSync(p, {recursive:true});
      });

      var jp = path.join(target, 'staff_data.json');
      if (!fs.existsSync(jp)) {
        emp._folderPath = target;
        fs.writeFileSync(jp, JSON.stringify(emp,null,2), 'utf8');
        fs.writeFileSync(path.join(target,'COMPLIANCE SUMMARY - '+safeName(name)+'.html'), buildReportHTML(emp), 'utf8');
        console.log('  Init:', name);
      }
    });
  } catch(e) {
    console.error('Spreadsheet init error:', e.message);
  }
}

// ── HTML REPORT ───────────────────────────────────────────────────────────────
function buildReportHTML(emp) {
  var logoB64 = '';
  var siaDays  = daysFrom(emp.sia && emp.sia.expiry);
  var cscsDays = daysFrom(emp.cscs && emp.cscs.expiry);
  var visaDays = daysFrom(emp.visa && emp.visa.expiry);

  function statusRow(label, num, days, expiry, type) {
    var st = num ? statusOf(days) : 'unknown';
    if (!num && (label==='CSCS Card'||label==='Right to Work')) st = 'na';
    var bg,color,badge,detail;
    if (st==='na')      { bg='#f3f4f6';color='#6b7280';badge='N/A';detail='Not required for this employee'; }
    else if (st==='unknown'){ bg='#f3f4f6';color='#6b7280';badge='NOT ON FILE';detail='No data recorded'; }
    else if (st==='red')    { bg='#fee2e2';color='#b91c1c';badge='EXPIRED';detail='Expired '+Math.abs(days)+' days ago - Expiry: '+fmtDate(expiry); }
    else if (st==='amber')  { bg='#fef3c7';color='#92400e';badge='EXPIRING SOON';detail='Expires in '+days+' days - Expiry: '+fmtDate(expiry); }
    else                    { bg='#d1fae5';color='#065f46';badge='VALID';detail=(days!==null?days+' days remaining':'No expiry / ILR')+' - Exp: '+fmtDate(expiry); }
    return '<div style="background:white;border-radius:10px;padding:18px 22px;margin-bottom:12px;border-left:5px solid '+color+';box-shadow:0 1px 5px rgba(0,0,0,0.07);">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">'
      +'<div><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">'+label+'</div>'
      +'<div style="font-size:17px;font-weight:700;color:#111111;margin-top:3px;">'+(num||'—')+'</div></div>'
      +'<div style="text-align:right;">'
      +'<div style="background:'+bg+';color:'+color+';padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;display:inline-block;">'+badge+'</div>'
      +'<div style="font-size:12px;color:'+color+';margin-top:5px;">'+detail+'</div>'
      +'</div></div></div>';
  }

  var oBg    = emp.overall==='green'?'#d1fae5':emp.overall==='amber'?'#fef3c7':emp.overall==='red'?'#fee2e2':'#f3f4f6';
  var oColor = emp.overall==='green'?'#065f46':emp.overall==='amber'?'#92400e':emp.overall==='red'?'#b91c1c':'#6b7280';
  var oWord  = emp.overall==='green'?'FULLY COMPLIANT':emp.overall==='amber'?'ACTION REQUIRED':emp.overall==='red'?'NON-COMPLIANT':'INCOMPLETE DATA';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+safeName(emp.name)+'</title>'
    +'<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;background:#f4f6fb;}.wrap{max-width:820px;margin:0 auto;padding:28px 20px 60px;}</style></head><body><div class="wrap">'
    +'<div style="background:#111111;border-radius:12px;padding:22px 26px;display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">'
    +'<img src="'+logoB64+'" style="height:46px;"><div style="text-align:right;"><div style="color:#CC0000;font-size:11px;text-transform:uppercase;">Staff Compliance Record</div>'
    +'<div style="color:white;font-size:11px;">Generated: '+new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'})+'</div>'
    +'<div style="color:#CC0000;font-size:10px;">CONFIDENTIAL</div></div></div>'
    +'<div style="background:white;border-radius:12px;padding:22px;box-shadow:0 2px 8px rgba(0,0,0,0.08);margin-bottom:22px;">'
    +'<div style="font-size:22px;font-weight:800;color:#111111;">'+emp.name+'</div>'
    +'<div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;">'
    +'<span style="background:#eef2ff;color:#3730a3;padding:3px 12px;border-radius:20px;font-size:12px;">'+(emp.nationality||'—')+'</span>'
    +'<span style="background:#eef2ff;color:#3730a3;padding:3px 12px;border-radius:20px;font-size:12px;">'+(emp.gender||'—')+'</span>'
    +'<span style="background:#eef2ff;color:#3730a3;padding:3px 12px;border-radius:20px;font-size:12px;">Tel: '+(emp.phone||'—')+'</span>'
    +'</div><div style="font-size:13px;color:#6b7280;">Email: '+(emp.email||'—')+'</div>'
    +'<div style="margin-top:14px;background:'+oBg+';color:'+oColor+';padding:8px 18px;border-radius:8px;display:inline-block;font-size:14px;font-weight:800;">'
    +overallEmoji(emp.overall)+' '+oWord+'</div></div>'
    +'<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:10px;">Compliance Checks</div>'
    +statusRow('SIA Licence',    emp.sia&&emp.sia.number,   siaDays,  emp.sia&&emp.sia.expiry,   'SIA')
    +statusRow('CSCS Card',      emp.cscs&&emp.cscs.number, cscsDays, emp.cscs&&emp.cscs.expiry, 'CSCS')
    +statusRow('Right to Work',  emp.visa&&emp.visa.type,   visaDays, emp.visa&&emp.visa.expiry, 'Visa')
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px;">'
    +'<div style="background:white;border-radius:10px;padding:16px 18px;box-shadow:0 1px 5px rgba(0,0,0,0.06);border-left:4px solid #d1d5db;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;">Reference 1</div><div style="font-size:13px;color:#374151;margin-top:5px;">'+(emp.references&&emp.references.ref1&&emp.references.ref1.name||'Not recorded')+'</div><div style="font-size:11px;background:#f3f4f6;color:#6b7280;display:inline-block;padding:2px 10px;border-radius:20px;margin-top:6px;">'+(emp.references&&emp.references.ref1&&emp.references.ref1.status||'Not Started')+'</div></div>'
    +'<div style="background:white;border-radius:10px;padding:16px 18px;box-shadow:0 1px 5px rgba(0,0,0,0.06);border-left:4px solid #d1d5db;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;">Reference 2</div><div style="font-size:13px;color:#374151;margin-top:5px;">'+(emp.references&&emp.references.ref2&&emp.references.ref2.name||'Not recorded')+'</div><div style="font-size:11px;background:#f3f4f6;color:#6b7280;display:inline-block;padding:2px 10px;border-radius:20px;margin-top:6px;">'+(emp.references&&emp.references.ref2&&emp.references.ref2.status||'Not Started')+'</div></div>'
    +'</div>'
    +'<div style="margin-top:36px;border-top:1px solid #e5e7eb;padding-top:14px;text-align:center;font-size:11px;color:#9ca3af;">GuardTec Security | BS 7858 Compliant | CONFIDENTIAL</div>'
    +'</div></body></html>';
}

// ── OVERVIEW HTML ─────────────────────────────────────────────────────────────
function refreshOverview() {
  var html = buildOverviewHTML(loadAllStaff());
  fs.writeFileSync(OVERVIEW, html, 'utf8');
  fs.writeFileSync(SHAREPOINT_DASHBOARD, html, 'utf8');
}

function buildOverviewHTML(staff) {
  var logoB64 = '';
  var green = staff.filter(function(e){return e.overall==='green';}).length;
  var amber = staff.filter(function(e){return e.overall==='amber';}).length;
  var red   = staff.filter(function(e){return e.overall==='red';}).length;
  var unk   = staff.length - green - amber - red;
  var rows  = staff.map(function(e,i) {
    var sd = daysFrom(e.sia&&e.sia.expiry), cd = daysFrom(e.cscs&&e.cscs.expiry), vd = daysFrom(e.visa&&e.visa.expiry);
    var oBg=e.overall==='green'?'#d1fae5':e.overall==='amber'?'#fef3c7':e.overall==='red'?'#fee2e2':'#f3f4f6';
    var oC=e.overall==='green'?'#065f46':e.overall==='amber'?'#92400e':e.overall==='red'?'#b91c1c':'#555';
    var oW=e.overall==='green'?'COMPLIANT':e.overall==='amber'?'ACTION':e.overall==='red'?'NON-COMPLIANT':'INCOMPLETE';
    var bg=i%2===0?'#f9fafb':'#fff';
    var st = function(d,num){ if(!num)return '-'; if(d===null)return 'ILR'; if(d<0)return 'Expired'; return d+'d'; };
    return '<tr style="background:'+bg+'"><td style="padding:9px 12px;font-weight:700;color:#111111;">'+(i+1)+'. '+e.name+'</td>'
      +'<td style="padding:9px;text-align:center"><span style="background:'+oBg+';color:'+oC+';padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">'+overallEmoji(e.overall)+' '+oW+'</span></td>'
      +'<td style="padding:9px;text-align:center;font-size:12px;">'+st(sd,e.sia&&e.sia.number)+'</td>'
      +'<td style="padding:9px;text-align:center;font-size:12px;">'+st(cd,e.cscs&&e.cscs.number)+'</td>'
      +'<td style="padding:9px;text-align:center;font-size:12px;">'+(e.visa&&e.visa.type?st(vd,e.visa.type):'British')+'</td></tr>';
  }).join('');
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>GuardTec Compliance Overview</title>'
    +'<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;background:#f4f6fb;}.wrap{max-width:1050px;margin:0 auto;padding:28px 20px 60px;}table{width:100%;border-collapse:collapse;}th{background:#111111;color:white;padding:11px 13px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;}td{border-bottom:1px solid #f0f0f0;font-size:13px;}</style></head><body><div class="wrap">'
    +'<div style="background:#111111;border-radius:12px;padding:22px 26px;display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:14px;">'
    +'<div><img src="'+logoB64+'" style="height:44px;margin-bottom:10px;display:block;"><div style="color:white;font-size:18px;font-weight:800;">Staff Compliance Overview</div><div style="color:#CC0000;font-size:12px;margin-top:3px;">'+new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'})+' | CONFIDENTIAL</div></div>'
    +'<div style="display:flex;gap:10px;flex-wrap:wrap;">'
    +'<div style="background:#d1fae5;border-radius:10px;padding:12px 18px;text-align:center;"><div style="font-size:24px;font-weight:800;color:#065f46;">'+green+'</div><div style="font-size:10px;color:#065f46;font-weight:700;">COMPLIANT</div></div>'
    +'<div style="background:#fef3c7;border-radius:10px;padding:12px 18px;text-align:center;"><div style="font-size:24px;font-weight:800;color:#92400e;">'+amber+'</div><div style="font-size:10px;color:#92400e;font-weight:700;">ACTION NEEDED</div></div>'
    +'<div style="background:#fee2e2;border-radius:10px;padding:12px 18px;text-align:center;"><div style="font-size:24px;font-weight:800;color:#b91c1c;">'+red+'</div><div style="font-size:10px;color:#b91c1c;font-weight:700;">NON-COMPLIANT</div></div>'
    +'<div style="background:#f3f4f6;border-radius:10px;padding:12px 18px;text-align:center;"><div style="font-size:24px;font-weight:800;color:#6b7280;">'+unk+'</div><div style="font-size:10px;color:#6b7280;font-weight:700;">INCOMPLETE</div></div>'
    +'</div></div>'
    +'<div style="background:white;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.07);overflow:hidden;">'
    +'<table><thead><tr><th>Employee Name</th><th>Overall</th><th>SIA</th><th>CSCS</th><th>Right to Work</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    +'<div style="margin-top:32px;border-top:1px solid #e5e7eb;padding-top:14px;text-align:center;font-size:11px;color:#9ca3af;">GuardTec Security | BS 7858 | CONFIDENTIAL</div>'
    +'</div></body></html>';
}

// ── API ───────────────────────────────────────────────────────────────────────
app.get('/api/staff', requireLogin, requirePermission('staff'), function(req, res) {
  try {
    res.json(loadAllStaff());
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── STAFF EXCEL EXPORT ────────────────────────────────────────────────────────
app.get('/api/staff/export', requireLogin, requirePermission('staff'), function(req, res) {
  try {
    var all = loadAllStaff();
    var ids = req.query.ids ? String(req.query.ids).split(',') : null;
    var list = ids ? all.filter(function(s) { return ids.indexOf(s.id) !== -1; }) : all;
    var rows = list.map(function(s) {
      var missingItems = [];
      if (!(s.sia && s.sia.number)) missingItems.push('SIA');
      if (!(s.cscs && s.cscs.number)) missingItems.push('CSCS');
      if (!(s.dbs && s.dbs.type)) missingItems.push('DBS');
      if (!(s.bs7858 && s.bs7858.completed)) missingItems.push('BS7858');
      return {
        'Name': s.name || '',
        'Job Role': s.jobRole || '',
        'Overall Status': s.overall || '',
        'Email': s.email || '',
        'Phone': s.phone || '',
        'Nationality': s.nationality || '',
        'Date of Birth': s.dateOfBirth || s.dob || '',
        'NI Number': s.ni || '',
        'Address': s.address || '',
        'Deploy Status': s.deployStatus || '',
        'Current Site': s.currentSite || '',
        'SIA Number': (s.sia && s.sia.number) || 'Missing',
        'SIA Expiry': (s.sia && s.sia.expiry) || 'Missing',
        'CSCS Number': (s.cscs && s.cscs.number) || 'Missing',
        'CSCS Expiry': (s.cscs && s.cscs.expiry) || 'Missing',
        'Visa Type': (s.visa && s.visa.type) || 'Missing',
        'Visa Expiry': (s.visa && s.visa.expiry) || 'Missing',
        'DBS Type': (s.dbs && s.dbs.type) || 'Missing',
        'DBS Check Date': (s.dbs && s.dbs.checkDate) || 'Missing',
        'BS7858 Completed': (s.bs7858 && s.bs7858.completed) ? 'Yes' : 'No',
        'Missing Documents': missingItems.length ? missingItems.join(', ') : 'None',
      };
    });
    sendXlsx(res, 'GuardTec-Staff-Report-' + new Date().toISOString().slice(0,10) + '.xlsx', rows);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

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

// ── DEPLOYMENT STATUS ─────────────────────────────────────────────────────────
app.patch('/api/staff/:id/deploy', requireLogin, requirePermission('staff'), function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
    emp.deployStatus = req.body.deployStatus || emp.deployStatus || 'inactive';
    if (req.body.currentSite !== undefined) emp.currentSite = req.body.currentSite;
    saveStaff(emp, emp._folderPath);
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── TRAINING ──────────────────────────────────────────────────────────────────
app.patch('/api/staff/:id/training', requireLogin, requirePermission('staff'), function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
    emp.training = req.body.training || {};
    saveStaff(emp, emp._folderPath);
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── STAFF SELF-SERVICE PORTAL ─────────────────────────────────────────────────

function generateRegistrationCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
  var code = '';
  for (var i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// Ops Manager / Director generate & share this with a staff member so they
// can self-register their own portal login.
app.get('/api/staff/:id/registration-code', requireLogin, requirePermission('pending_review'), function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
    if (emp.registration_claimed) return res.json({ ok: true, claimed: true, code: null });
    if (!emp.registration_code) {
      emp.registration_code = generateRegistrationCode();
      saveStaff(emp, emp._folderPath);
    }
    res.json({ ok: true, claimed: false, code: emp.registration_code });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/staff/:id/registration-code/regenerate', requireLogin, requirePermission('pending_review'), function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
    emp.registration_code = generateRegistrationCode();
    emp.registration_claimed = false;
    saveStaff(emp, emp._folderPath);
    res.json({ ok: true, code: emp.registration_code });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function sanitizeForStaffView(emp) {
  var copy = Object.assign({}, emp);
  delete copy._folderPath;
  return copy;
}

// The logged-in staff member's own profile — reads via the staff_id baked
// into their JWT at login/registration time.
app.get('/api/my-profile', requireLogin, requireRole('staff'), function(req, res) {
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
app.post('/api/my-profile', requireLogin, requireRole('staff'), function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.user.staff_id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Profile not found' });

    var b = req.body || {};
    var pending = Object.assign({}, emp.pending_submission, {
      submitted_at: new Date().toISOString(),
      phone: b.phone, address: b.address,
      emergencyContact: b.emergencyContact,
      sia: b.sia, cscs: b.cscs, visa: b.visa, references: b.references,
      notes: b.notes,
    });
    emp.pending_submission = pending;
    delete emp.rejection_reason;
    saveStaff(emp, emp._folderPath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/my-profile/photo', requireLogin, requireRole('staff'), function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.user.staff_id; });
    if (!emp || !emp._folderPath) return res.status(404).json({ ok: false, error: 'Profile not found' });

    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() {
      var buf = Buffer.concat(chunks);
      var ext = '.jpg';
      if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
      else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';

      ['.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
        var old = path.join(emp._folderPath, 'pending-profile' + e);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      });
      fs.writeFileSync(path.join(emp._folderPath, 'pending-profile' + ext), buf);

      emp.pending_submission = Object.assign({}, emp.pending_submission, {
        submitted_at: new Date().toISOString(),
        photo_pending: true,
      });
      saveStaff(emp, emp._folderPath);
      res.json({ ok: true });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function findPendingPhoto(folderPath) { return findFileByExts(folderPath, 'pending-profile'); }

app.get('/api/staff/:id/pending-photo', requireLogin, requirePermission('pending_review'), function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._folderPath) return res.status(404).end();
    var photo = findPendingPhoto(emp._folderPath);
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

// Ops Manager / Director review queue — every staff member with an
// outstanding self-submitted change.
app.get('/api/staff/pending-review', requireLogin, requirePermission('pending_review'), function(req, res) {
  try {
    var all = loadAllStaff();
    var pending = all
      .filter(function(e){ return !!e.pending_submission; })
      .map(function(e){ return sanitizeForStaffView(e); });
    res.json({ ok: true, staff: pending });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/staff/:id/approve', requireLogin, requirePermission('pending_review'), function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
    var pending = emp.pending_submission;
    if (!pending) return res.status(400).json({ ok: false, error: 'No pending submission for this staff member' });

    ['phone', 'address', 'emergencyContact', 'sia', 'cscs', 'visa', 'references', 'notes'].forEach(function(field) {
      if (pending[field] !== undefined) emp[field] = pending[field];
    });

    if (pending.photo_pending && emp._folderPath) {
      var pendingPhoto = findPendingPhoto(emp._folderPath);
      if (pendingPhoto) {
        var ext = path.extname(pendingPhoto);
        ['.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
          var old = path.join(emp._folderPath, 'profile' + e);
          if (fs.existsSync(old)) fs.unlinkSync(old);
        });
        fs.renameSync(pendingPhoto, path.join(emp._folderPath, 'profile' + ext));
      }
    }

    delete emp.pending_submission;
    delete emp.rejection_reason;
    saveStaff(emp, emp._folderPath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/staff/:id/reject', requireLogin, requirePermission('pending_review'), function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
    if (!emp.pending_submission) return res.status(400).json({ ok: false, error: 'No pending submission for this staff member' });

    if (emp._folderPath) {
      var pendingPhoto = findPendingPhoto(emp._folderPath);
      if (pendingPhoto) fs.unlinkSync(pendingPhoto);
    }

    emp.rejection_reason = String(req.body.reason || 'Please review and resubmit your details.').trim();
    delete emp.pending_submission;
    saveStaff(emp, emp._folderPath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── DEPLOYMENT SITES CRUD ─────────────────────────────────────────────────────
app.get('/api/sites', requireLogin, function(req, res) {
  res.json({ sites: loadSites() });
});

app.post('/api/sites', requireLogin, requirePermission('sites'), function(req, res) {
  try {
    var name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'Site name required' });
    var sites = loadSites();
    if (sites.some(function(s){ return s.name.toLowerCase() === name.toLowerCase(); })) {
      return res.status(409).json({ ok: false, error: 'Site already exists' });
    }
    var site = {
      id: Date.now().toString(),
      name: name,
      type: String(req.body.type || 'other').trim(),
      client_name: String(req.body.client_name || '').trim(),
      client_phone: String(req.body.client_phone || '').trim(),
      client_email: String(req.body.client_email || '').trim(),
      address: String(req.body.address || '').trim(),
      supervisor_name: String(req.body.supervisor_name || '').trim(),
      supervisor_phone: String(req.body.supervisor_phone || '').trim(),
      supervisor_email: String(req.body.supervisor_email || '').trim(),
      status: String(req.body.status || 'active').trim(),
      notes: String(req.body.notes || '').trim(),
    };
    sites.push(site);
    saveSites(sites);
    res.json({ ok: true, site: site });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/sites/:id', requireLogin, requirePermission('sites'), function(req, res) {
  try {
    var sites = loadSites();
    var idx = sites.findIndex(function(s){ return s.id === req.params.id; });
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Site not found' });
    var b = req.body;
    var o = sites[idx];
    sites[idx] = Object.assign({}, o, {
      name:             String(b.name             !== undefined ? b.name             : o.name             || '').trim(),
      type:             String(b.type             !== undefined ? b.type             : o.type             || 'other').trim(),
      client_name:      String(b.client_name      !== undefined ? b.client_name      : o.client_name      || '').trim(),
      client_phone:     String(b.client_phone     !== undefined ? b.client_phone     : o.client_phone     || '').trim(),
      client_email:     String(b.client_email     !== undefined ? b.client_email     : o.client_email     || '').trim(),
      address:          String(b.address          !== undefined ? b.address          : o.address          || '').trim(),
      supervisor_name:  String(b.supervisor_name  !== undefined ? b.supervisor_name  : o.supervisor_name  || '').trim(),
      supervisor_phone: String(b.supervisor_phone !== undefined ? b.supervisor_phone : o.supervisor_phone || '').trim(),
      supervisor_email: String(b.supervisor_email !== undefined ? b.supervisor_email : o.supervisor_email || '').trim(),
      status:           String(b.status           !== undefined ? b.status           : o.status           || 'active').trim(),
      notes:            String(b.notes            !== undefined ? b.notes            : o.notes            || '').trim(),
    });
    saveSites(sites);
    res.json({ ok: true, site: sites[idx] });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/sites/:id', requireLogin, requirePermission('sites'), function(req, res) {
  try {
    var sites = loadSites().filter(function(s){ return s.id !== req.params.id; });
    saveSites(sites);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SITE STAFF ASSIGNMENT ─────────────────────────────────────────────────────
app.get('/api/sites/:id/staff', requireLogin, function(req, res) {
  var site = loadSites().find(function(s){ return s.id === req.params.id; });
  if (!site) return res.status(404).json({ ok: false, error: 'Site not found' });
  var assignedIds = site.assigned_staff || [];
  var allStaff = loadAllStaff();
  var assigned = allStaff.filter(function(s){ return assignedIds.indexOf(s.id) !== -1; })
    .map(function(s){ return { id: s.id, name: s.name, overall: s.overall }; });
  res.json({ ok: true, staff: assigned, count: assigned.length });
});

app.post('/api/sites/:id/staff', requireLogin, requirePermission('sites'), function(req, res) {
  try {
    var sites = loadSites();
    var idx = sites.findIndex(function(s){ return s.id === req.params.id; });
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Site not found' });
    var staffId = String(req.body.staff_id || '').trim();
    if (!staffId) return res.status(400).json({ ok: false, error: 'staff_id required' });
    if (!sites[idx].assigned_staff) sites[idx].assigned_staff = [];
    if (sites[idx].assigned_staff.indexOf(staffId) === -1) {
      sites[idx].assigned_staff.push(staffId);
      saveSites(sites);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/sites/:id/staff/:staffId', requireLogin, requirePermission('sites'), function(req, res) {
  try {
    var sites = loadSites();
    var idx = sites.findIndex(function(s){ return s.id === req.params.id; });
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Site not found' });
    sites[idx].assigned_staff = (sites[idx].assigned_staff || []).filter(function(id){ return id !== req.params.staffId; });
    saveSites(sites);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── SITE WELFARE / ASSETS ─────────────────────────────────────────────────────
app.get('/api/sites/:id/welfare', requireLogin, function(req, res) {
  var site = loadSites().find(function(s){ return s.id === req.params.id; });
  if (!site) return res.status(404).json({ ok: false, error: 'Site not found' });
  res.json({ ok: true, items: site.welfare_items || [] });
});

app.post('/api/sites/:id/welfare', requireLogin, requirePermission('sites'), function(req, res) {
  try {
    var sites = loadSites();
    var idx = sites.findIndex(function(s){ return s.id === req.params.id; });
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Site not found' });
    if (!sites[idx].welfare_items) sites[idx].welfare_items = [];
    var item = {
      id: Date.now().toString(),
      name: String(req.body.name || '').trim(),
      quantity: parseInt(req.body.quantity) || 1,
      condition: String(req.body.condition || 'good').trim(),
      serial_number: String(req.body.serial_number || '').trim(),
      notes: String(req.body.notes || '').trim(),
    };
    if (!item.name) return res.status(400).json({ ok: false, error: 'Item name required' });
    sites[idx].welfare_items.push(item);
    saveSites(sites);
    res.json({ ok: true, item: item });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/sites/:id/welfare/:itemId', requireLogin, requirePermission('sites'), function(req, res) {
  try {
    var sites = loadSites();
    var sIdx = sites.findIndex(function(s){ return s.id === req.params.id; });
    if (sIdx === -1) return res.status(404).json({ ok: false, error: 'Site not found' });
    var items = sites[sIdx].welfare_items || [];
    var iIdx = items.findIndex(function(i){ return i.id === req.params.itemId; });
    if (iIdx === -1) return res.status(404).json({ ok: false, error: 'Item not found' });
    var b = req.body; var o = items[iIdx];
    items[iIdx] = {
      id: o.id,
      name:          String(b.name          !== undefined ? b.name          : o.name          || '').trim(),
      quantity:      parseInt(b.quantity     !== undefined ? b.quantity      : o.quantity)    || 1,
      condition:     String(b.condition      !== undefined ? b.condition     : o.condition     || 'good').trim(),
      serial_number: String(b.serial_number  !== undefined ? b.serial_number : o.serial_number || '').trim(),
      notes:         String(b.notes          !== undefined ? b.notes         : o.notes         || '').trim(),
    };
    sites[sIdx].welfare_items = items;
    saveSites(sites);
    res.json({ ok: true, item: items[iIdx] });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/sites/:id/welfare/:itemId', requireLogin, requirePermission('sites'), function(req, res) {
  try {
    var sites = loadSites();
    var sIdx = sites.findIndex(function(s){ return s.id === req.params.id; });
    if (sIdx === -1) return res.status(404).json({ ok: false, error: 'Site not found' });
    sites[sIdx].welfare_items = (sites[sIdx].welfare_items || []).filter(function(i){ return i.id !== req.params.itemId; });
    saveSites(sites);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/api/staff/:id', requireLogin, requirePermission('staff'), function(req, res) {
  try {
    var emp = req.body;
    var all = loadAllStaff();
    var old = all.find(function(e){ return e.id === req.params.id; });
    saveStaff(emp, old ? old._folderPath : null);
    updateComplianceTracker(emp);
    updateReferenceTracker(emp);
    refreshOverview();
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/staff', requireLogin, requirePermission('staff'), function(req, res) {
  try {
    var emp = req.body;
    if (!emp.id) emp.id = emp.name.toLowerCase().replace(/[^a-z0-9]/g,'-');
    saveStaff(emp, null);
    updateComplianceTracker(emp);
    updateReferenceTracker(emp);
    refreshOverview();
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/staff/:id', requireLogin, requirePermission('staff'), function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });

    var folderPath = emp._folderPath;
    if (!folderPath || !fs.existsSync(folderPath)) {
      return res.status(404).json({ ok: false, error: 'Folder not found: ' + folderPath });
    }

    var exStaffDir = path.join(BASE, '02 - Vetting & Screening', 'Ex-Staff');
    if (!fs.existsSync(exStaffDir)) fs.mkdirSync(exStaffDir, { recursive: true });

    // Block duplicate — check if ANY folder in Ex-Staff matches this person's name
    var empNameClean = safeName(emp.name).toUpperCase();
    var alreadyExists = fs.readdirSync(exStaffDir).some(function(d) {
      var clean = d.replace(/^[\u{1F7E2}\u{1F7E1}\u{1F534}⚪️⃣]/gu, '').trim().toUpperCase();
      return clean === empNameClean;
    });
    if (alreadyExists) {
      return res.status(409).json({ ok: false, error: emp.name + ' is already in Ex-Staff.' });
    }

    var destFolder = path.join(exStaffDir, path.basename(folderPath));
    fs.renameSync(folderPath, destFolder);

    refreshOverview();

    console.log('[DELETE] Moved to Ex-Staff:', path.basename(folderPath));
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/exstaff', requireLogin, requirePermission('staff'), function(req, res) {
  try {
    var exDir = path.join(BASE, '02 - Vetting & Screening', 'Ex-Staff');
    if (!fs.existsSync(exDir)) return res.json([]);
    var list = [];
    fs.readdirSync(exDir).forEach(function(d) {
      var fp = path.join(exDir, d);
      if (!fs.statSync(fp).isDirectory()) return;
      var jp = path.join(fp, 'staff_data.json');
      if (!fs.existsSync(jp)) return;
      try {
        var emp = JSON.parse(fs.readFileSync(jp, 'utf8'));
        list.push({
          folderId: d,
          name: emp.name || d,
          nationality: emp.nationality || '',
          gender: emp.gender || '',
          overall: emp.overall || 'unknown'
        });
      } catch(e) {}
    });
    list.sort(function(a,b){ return a.name.localeCompare(b.name); });
    res.json(list);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Permanently delete an ex-staff folder (director only)
app.delete('/api/exstaff/permanent', requireLogin, requireRole('director'), function(req, res) {
  try {
    var folderId = req.body.folderId;
    if (!folderId) return res.status(400).json({ ok: false, error: 'No folderId provided' });
    var safeFolderId = path.basename(folderId);
    var exDir = path.join(BASE, '02 - Vetting & Screening', 'Ex-Staff');
    var targetFolder = path.join(exDir, safeFolderId);
    if (!fs.existsSync(targetFolder)) return res.status(404).json({ ok: false, error: 'Ex-staff folder not found' });
    var resolvedTarget = path.resolve(targetFolder);
    var resolvedExDir  = path.resolve(exDir);
    if (!resolvedTarget.startsWith(resolvedExDir + path.sep)) {
      return res.status(400).json({ ok: false, error: 'Invalid folder path' });
    }
    fs.rmSync(targetFolder, { recursive: true, force: true });
    console.log('[DELETE] Permanently deleted ex-staff:', safeFolderId);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/exstaff/restore', requireLogin, requirePermission('staff'), function(req, res) {
  try {
    var folderId = req.body.folderId;
    if (!folderId) return res.status(400).json({ ok: false, error: 'No folderId provided' });

    var exDir  = path.join(BASE, '02 - Vetting & Screening', 'Ex-Staff');
    var srcFolder = path.join(exDir, folderId);
    if (!fs.existsSync(srcFolder)) return res.status(404).json({ ok: false, error: 'Ex-staff folder not found' });

    var jp = path.join(srcFolder, 'staff_data.json');
    var emp = JSON.parse(fs.readFileSync(jp, 'utf8'));

    // Recalculate overall so emoji prefix is correct
    emp.overall = calcOverall(emp);
    var destFolder = path.join(ACTIVE_DIR, overallEmoji(emp.overall) + ' ' + safeName(emp.name));

    // If name already exists in Active, add suffix
    if (fs.existsSync(destFolder)) destFolder = destFolder + ' (Returned)';

    fs.renameSync(srcFolder, destFolder);

    // Update staff_data.json with new folder path
    emp._folderPath = destFolder;
    fs.writeFileSync(path.join(destFolder, 'staff_data.json'), JSON.stringify(emp, null, 2), 'utf8');

    refreshOverview();

    console.log('[RESTORE] ' + emp.name + ' moved back to Active Staff');
    res.json({ ok: true, name: emp.name });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
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

// ── SERVE APP WITH EMBEDDED STAFF DATA (no browser fetch needed) ──────────────
app.get('/', function(req, res) {
  if (!getAuthedUser(req)) {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(path.join(__dirname, 'public', 'login.html'));
  }
  try {
    var staff = loadAllStaff();
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

app.get('/reload', requireLogin, function(req, res) {
  try {
    var staff = loadAllStaff();
    res.json(staff);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ── AUTO GIT COMMIT + PUSH ────────────────────────────────────────────────────
var _gitTimer = null;
function scheduleGitPush(reason) {
  if (_gitTimer) clearTimeout(_gitTimer);
  _gitTimer = setTimeout(function() {
    var appDir = __dirname;
    var now    = new Date();
    var stamp = now.toISOString().slice(0, 16).replace('T', ' ');
    var msg = 'Auto-save: ' + stamp + (reason ? ' — ' + reason : '');
    var cmd = 'cd /d "' + appDir + '" && git add -A && git commit -m "' + msg + '" && git push origin main';
    exec(cmd, function(err, stdout, stderr) {
      if (err) { console.log('[GIT] Push failed:', stderr || err.message); }
      else      { console.log('[GIT] Pushed to GitHub —', msg); }
    });
  }, 5000);
}

// ── AUTO DUPLICATE DETECTION ──────────────────────────────────────────────────
function normPhone(p) {
  if (!p) return '';
  return String(p).replace(/\D/g,'').replace(/^(440|44|0)/,'');
}
function normEmail(e) { return e ? String(e).toLowerCase().trim() : ''; }
function normSIA(s)   { return s ? String(s).replace(/\s/g,'').toUpperCase() : ''; }

function nameSimilarity(a, b) {
  var wa = a.toLowerCase().replace(/[^a-z ]/g,'').split(/\s+/).filter(Boolean);
  var wb = b.toLowerCase().replace(/[^a-z ]/g,'').split(/\s+/).filter(Boolean);
  if (!wa.length || !wb.length) return 0;
  var inter = wa.filter(function(w){ return wb.indexOf(w) >= 0; }).length;
  var union  = new Set(wa.concat(wb)).size;
  var jaccard = inter / union;
  var prefix = 0;
  wa.forEach(function(w1){ wb.forEach(function(w2){
    var l = Math.min(w1.length, w2.length);
    if (l >= 4) {
      var m = 0;
      for (var k = 0; k < l; k++) { if (w1[k]===w2[k]) m++; else break; }
      prefix = Math.max(prefix, m / l);
    }
  }); });
  return Math.max(jaccard, prefix * 0.85);
}

// ── NEW STAFF INBOX (Power Automate → OneDrive bridge) ────────────────────────
var INBOX_DIR      = path.join(BASE, '! New Staff Inbox');
var INBOX_DONE_DIR = path.join(BASE, '! New Staff Inbox', 'Processed');

function checkNewStaffInbox() {
  try {
    if (!fs.existsSync(INBOX_DIR)) return;
    if (!fs.existsSync(INBOX_DONE_DIR)) fs.mkdirSync(INBOX_DONE_DIR, {recursive:true});

    var files = fs.readdirSync(INBOX_DIR).filter(function(f) {
      return f.endsWith('.json') && fs.statSync(path.join(INBOX_DIR, f)).isFile();
    });
    if (files.length === 0) return;

    var created = 0;
    files.forEach(function(file) {
      var filePath = path.join(INBOX_DIR, file);
      try {
        var raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        // Build name from Surname + First Name
        var firstName = String(raw.firstName || raw['First Name'] || '').trim();
        var surname   = String(raw.surname   || raw['Surname']    || '').trim();
        var fullName  = (firstName + ' ' + surname).trim().toUpperCase();
        if (!fullName) { console.warn('[INBOX] Skipping ' + file + ': no name'); return; }

        // Prevent duplicates — check existing staff
        var existing = loadAllStaff();
        var already = existing.find(function(e) {
          return String(e.name||'').toUpperCase() === fullName;
        });
        if (already) {
          console.log('[INBOX] Already exists: ' + fullName + ', skipping ' + file);
          fs.renameSync(filePath, path.join(INBOX_DONE_DIR, 'DUPLICATE_' + file));
          return;
        }

        // Map employment history (Employer 1..10)
        var empHistory = [];
        for (var i = 1; i <= 10; i++) {
          var val = raw['employer' + i] || raw['Employer ' + i] || '';
          if (String(val).trim()) empHistory.push(String(val).trim());
        }

        // Parse date helper (dd/MM/yyyy or ISO)
        function parseDate(s) {
          if (!s) return null;
          s = String(s).trim();
          // dd/MM/yyyy
          var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (m) return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
          // ISO already
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
          return null;
        }

        var emp = {
          id:            fullName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now(),
          name:          fullName,
          email:         String(raw.email          || raw['Email']                        || '').trim(),
          phone:         String(raw.mobile          || raw['Mobile Number']               || raw.phone || '').trim(),
          phoneLandline: String(raw.telephone       || raw['Telephone Number']            || '').trim(),
          address: {
            current:      String(raw.address       || raw['Address']                     || '').trim(),
            movedIn:      parseDate(raw.dateMovedIn || raw['Date Moved in']),
            movedOut:     parseDate(raw.dateMovedOut|| raw['Date Moved out']),
            previous:     String(raw.previousAddress|| raw['Previous Address (If less than 3 years)'] || '').trim(),
            prevMovedIn:  parseDate(raw.prevDateMovedIn  || raw['Date Moved in_2']),
            prevMovedOut: parseDate(raw.prevDateMovedOut || raw['Date Moved out_2'])
          },
          placeOfBirth:  String(raw.placeOfBirth   || raw['Place Of Birth']              || '').trim(),
          ni:            String(raw.ni              || raw['National Insurance Number (only required for employees).'] || '').trim(),
          drivingLicence:String(raw.drivingLicence  || raw['Current Driving Licence Number (if Held)'] || '').trim(),
          cscs: {
            number: String(raw.cscs || raw['CSCS Card or Other Safety Body Registration Number'] || '').trim(),
            expiry: null
          },
          cscsQualification: String(raw.cscsQualification || raw['Construction Industry Qualification Held (i.e. labourer, banksman etc.)'] || '').trim(),
          sia:  { number: '', expiry: null },
          visa: {
            type:   String(raw.rtw  || raw['Do You Have The Right To Work In The UK?'] || '').trim(),
            expiry: null
          },
          bank: {
            accountNumber: String(raw.bankAccount || raw['Bank Account Number']        || '').trim(),
            sortCode:      String(raw.sortCode    || raw['Bank Account Sort Code']     || '').trim(),
            holder:        String(raw.bankHolder  || raw['Name Of Account Holder']     || '').trim(),
            bankName:      String(raw.bankName    || raw['Name Of Bank']               || '').trim()
          },
          criminal: {
            offences:      String(raw.criminal   || raw['Have You Ever Appeared Before A Court, Charged With A Criminal Or Military Offence ... Including Motoring Offences?'] || 'No').trim(),
            offenceDetails:String(raw.offenceDetails || raw['Please Give Details Below'] || '').trim(),
            bankrupt:      String(raw.bankrupt   || raw['Have you ever been made bankrupt?'] || 'No').trim(),
            ccj:           String(raw.ccj        || raw['Do you have any County Court Judgements against your name?'] || 'No').trim(),
            creditCheck:   String(raw.creditCheck|| raw['Do you object to TSC Ltd contacting a credit agency with reference to yourself ?'] || 'No').trim()
          },
          references: {
            ref1: {
              name:    String(raw.refName    || raw['Name of Professional Reference']                   || '').trim(),
              company: String(raw.refCompany || raw['Company Professional Reference Works For']         || '').trim(),
              address: String(raw.refAddress || raw['Work Address for Professional Reference']          || '').trim(),
              email:   String(raw.refEmail   || raw['Email Address of Professional Reference']          || '').trim(),
              phone:   String(raw.refPhone   || raw['Telephone Number of Professional Reference']       || '').trim(),
              status: 'Not Started'
            },
            ref2: { name:'', company:'', email:'', status:'Not Started' }
          },
          employmentHistory: empHistory,
          documentsAgreed:   String(raw.documentsAgreed || raw['Do you agree to upload the following files? Birth Certificate, Passport (if held), Proof of Right to Work (if not a UK citizen), Two recent utility bills, Driving Licence (if held), Passport photo for ID badge (plain background, clear face, no smiling), P45/P60 from last employment (if available)'] || '').trim(),
          contract:    '',
          induction:   false,
          status:      'active',
          deployStatus:'inactive',
          addedDate:   getTodayStr(),
          formSource:  'Microsoft Forms',
          formFile:    file
        };

        saveStaff(emp, null);
        created++;
        console.log('[INBOX] Created staff record: ' + fullName);

        // Archive processed file
        fs.renameSync(filePath, path.join(INBOX_DONE_DIR, file));

      } catch(e) {
        console.error('[INBOX] Error processing ' + file + ':', e.message);
        // Move to Processed with ERROR_ prefix so it doesn't loop
        try { fs.renameSync(filePath, path.join(INBOX_DONE_DIR, 'ERROR_' + file)); } catch(_) {}
      }
    });

    if (created > 0) {
      console.log('[INBOX] ' + created + ' new staff record(s) created from form submissions.');
      scheduleGitPush('new staff from forms: ' + created);
    }
  } catch(e) {
    console.error('[INBOX] checkNewStaffInbox error:', e.message);
  }
}

function autoDedup() {
  try {
    var staff = loadAllStaff();
    var archiveDir = path.join(BASE, '02 - Vetting & Screening', 'Duplicate Archive');
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, {recursive:true});

    var archived = 0;
    var checked  = {};

    for (var i = 0; i < staff.length; i++) {
      for (var j = i + 1; j < staff.length; j++) {
        var key = i + '-' + j;
        if (checked[key]) continue;
        checked[key] = true;

        var a = staff[i], b = staff[j];
        var score = 0;

        var pa = normPhone(a.phone), pb = normPhone(b.phone);
        if (pa && pb && pa === pb && pa.length >= 7) score += 3;

        var ea = normEmail(a.email), eb = normEmail(b.email);
        if (ea && eb && ea === eb) score += 3;

        var sa = normSIA(a.sia && a.sia.number), sb = normSIA(b.sia && b.sia.number);
        if (sa && sb && sa === sb && sa !== '' && sa !== 'N/A') score += 4;

        var ns = nameSimilarity(a.name || '', b.name || '');
        if (ns >= 0.5) score += ns * 2;
        else if (ns >= 0.3) score += ns;

        if (score < 2.5) continue;

        // Keep the record with more complete name; archive the other
        var keepIdx = (a.name||'').length >= (b.name||'').length ? i : j;
        var dropIdx = keepIdx === i ? j : i;
        var keep = staff[keepIdx], drop = staff[dropIdx];

        if (!drop._folderPath || !fs.existsSync(drop._folderPath)) continue;

        var dropFolder = path.basename(drop._folderPath);
        var dest = path.join(archiveDir, dropFolder);
        if (fs.existsSync(dest)) dest = dest + '_dup_' + Date.now();

        try {
          fs.renameSync(drop._folderPath, dest);
          console.log('[DEDUP] Archived: ' + drop.name + ' — kept: ' + keep.name + ' (score ' + score.toFixed(1) + ')');
          archived++;
          staff.splice(dropIdx, 1);
          if (dropIdx <= i) i--;
          if (dropIdx <= j) j--;
        } catch(moveErr) {
          console.log('[DEDUP] Could not move ' + dropFolder + ':', moveErr.message);
        }
      }
    }

    if (archived > 0) {
      console.log('[DEDUP] Done — ' + archived + ' duplicate(s) archived.');
      scheduleGitPush('auto-dedup: ' + archived + ' duplicate(s) removed');
    } else {
      console.log('[DEDUP] No duplicates found.');
    }
  } catch(e) {
    console.error('[DEDUP] Error:', e.message);
  }
}

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

    var vehicleCount = loadVehicles().filter(function(v){ return v.status === 'active'; }).length;

    var activeSites = loadSites().filter(function(s){ return s.status !== 'inactive'; }).length;
    var fleetDrivers = loadFleetDrivers().length;

    res.json({
      totalStaff: totalStaff,
      compliant: compliant,
      expiringSoon: expiringSoon,
      expired: expired,
      vehicles: vehicleCount,
      activeSites: activeSites,
      drivers: fleetDrivers,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── VEHICLES ──────────────────────────────────────────────────────────────────
var VEHICLES_FILE = path.join(BASE, 'vehicles.json');
var VEHICLE_PHOTOS_DIR = path.join(BASE, 'vehicle-photos');
if (!fs.existsSync(VEHICLE_PHOTOS_DIR)) fs.mkdirSync(VEHICLE_PHOTOS_DIR, { recursive: true });

var VEHICLE_DOCS_DIR = path.join(BASE, 'vehicle-docs');
if (!fs.existsSync(VEHICLE_DOCS_DIR)) fs.mkdirSync(VEHICLE_DOCS_DIR, { recursive: true });

function ensureVehicleDocsDir(vehicleId) {
  var dir = path.join(VEHICLE_DOCS_DIR, vehicleId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function loadVehicleDocs(vehicleId) {
  return loadJsonFile(path.join(VEHICLE_DOCS_DIR, vehicleId, 'index.json'));
}

function saveVehicleDocs(vehicleId, docs) {
  var dir = ensureVehicleDocsDir(vehicleId);
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(docs, null, 2), 'utf8');
}

// ── EXCEL EXPORT HELPER ────────────────────────────────────────────────────────
function sendXlsx(res, filename, rows) {
  var ws = XLSX.utils.json_to_sheet(rows);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  res.send(buf);
}

function loadJsonFile(filePath, defaultVal) {
  if (defaultVal === undefined) defaultVal = [];
  if (!fs.existsSync(filePath)) return defaultVal;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (e) { return defaultVal; }
}

function loadVehicles() { return loadJsonFile(VEHICLES_FILE); }

function saveVehicles(vehicles) {
  fs.writeFileSync(VEHICLES_FILE, JSON.stringify(vehicles, null, 2), 'utf8');
}

function findVehiclePhoto(id) { return findFileByExts(VEHICLE_PHOTOS_DIR, id); }

app.get('/api/vehicles', requireLogin, requirePermission('fleet'), function(req, res) {
  res.json({ vehicles: loadVehicles() });
});

app.post('/api/vehicles', requireLogin, requirePermission('fleet'), function(req, res) {
  try {
    var vehicles = loadVehicles();
    var newVehicle = Object.assign({}, req.body, { id: Date.now().toString() });
    vehicles.push(newVehicle);
    saveVehicles(vehicles);
    res.json({ ok: true, vehicle: newVehicle });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/vehicles/:id', requireLogin, requirePermission('fleet'), function(req, res) {
  try {
    var vehicles = loadVehicles();
    var idx = vehicles.findIndex(function(v) { return v.id === req.params.id; });
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Vehicle not found' });
    vehicles[idx] = Object.assign({}, vehicles[idx], req.body);
    saveVehicles(vehicles);
    res.json({ ok: true, vehicle: vehicles[idx] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/vehicles/:id', requireLogin, requirePermission('fleet'), function(req, res) {
  try {
    var vehicles = loadVehicles();
    vehicles = vehicles.filter(function(v) { return v.id !== req.params.id; });
    saveVehicles(vehicles);
    var oldPhoto = findVehiclePhoto(req.params.id);
    if (oldPhoto) fs.unlinkSync(oldPhoto);
    var docsDir = path.join(VEHICLE_DOCS_DIR, req.params.id);
    if (fs.existsSync(docsDir)) {
      try { fs.rmSync(docsDir, { recursive: true, force: true }); } catch (e) {}
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/vehicles/:id/photo', requireLogin, function(req, res) {
  try {
    var photo = findVehiclePhoto(req.params.id);
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

app.post('/api/vehicles/:id/photo', requireLogin, requirePermission('fleet'), function(req, res) {
  try {
    var vehicles = loadVehicles();
    var idx = vehicles.findIndex(function(v) { return v.id === req.params.id; });
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Vehicle not found' });

    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() {
      var buf = Buffer.concat(chunks);
      var ext = '.jpg';
      if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
      else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';

      ['.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
        var old = path.join(VEHICLE_PHOTOS_DIR, req.params.id + e);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      });

      fs.writeFileSync(path.join(VEHICLE_PHOTOS_DIR, req.params.id + ext), buf);
      vehicles[idx].has_photo = true;
      saveVehicles(vehicles);
      res.json({ ok: true });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── VEHICLE DOCUMENTS ─────────────────────────────────────────────────────────

app.get('/api/vehicles/:id/docs', requireLogin, requirePermission('fleet'), function(req, res) {
  res.json(loadVehicleDocs(req.params.id));
});

app.post('/api/vehicles/:id/docs', requireLogin, requirePermission('fleet'), function(req, res) {
  try {
    var vehicles = loadVehicles();
    var idx = vehicles.findIndex(function(v) { return v.id === req.params.id; });
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Vehicle not found' });

    ensureVehicleDocsDir(req.params.id);
    var originalName = 'document';
    try { originalName = decodeURIComponent(req.headers['x-filename'] || 'document'); } catch (e) {}
    var docType = req.headers['x-doc-type'] || 'other';
    var timestamp = Date.now().toString();
    var ext = path.extname(originalName) || '';
    var filename = timestamp + ext;
    var filePath = path.join(VEHICLE_DOCS_DIR, req.params.id, filename);

    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() {
      try {
        var buf = Buffer.concat(chunks);
        fs.writeFileSync(filePath, buf);

        var docs = loadVehicleDocs(req.params.id);
        var doc = { filename: filename, originalName: originalName, docType: docType, size: buf.length, uploadedAt: new Date().toISOString() };
        docs.push(doc);
        saveVehicleDocs(req.params.id, docs);

        res.json({ ok: true, doc: doc });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
    req.on('error', function(e) {
      res.status(500).json({ ok: false, error: e.message });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/vehicles/:id/docs/:filename', requireLogin, function(req, res) {
  try {
    var filename = path.basename(req.params.filename);
    var filePath = path.join(VEHICLE_DOCS_DIR, req.params.id, filename);
    if (!fs.existsSync(filePath)) return res.status(404).end();

    var docs = loadVehicleDocs(req.params.id);
    var doc = docs.find(function(d) { return d.filename === filename; });
    var originalName = doc ? doc.originalName : filename;

    res.setHeader('Content-Disposition', 'attachment; filename="' + originalName.replace(/"/g, '\\"') + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(filePath));
  } catch (e) {
    res.status(500).end();
  }
});

app.delete('/api/vehicles/:id/docs/:filename', requireLogin, requirePermission('fleet'), function(req, res) {
  try {
    var filename = path.basename(req.params.filename);
    var filePath = path.join(VEHICLE_DOCS_DIR, req.params.id, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    var docs = loadVehicleDocs(req.params.id);
    docs = docs.filter(function(d) { return d.filename !== filename; });
    saveVehicleDocs(req.params.id, docs);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── FLEET DRIVERS ─────────────────────────────────────────────────────────────
var FLEET_DRIVERS_FILE = path.join(BASE, 'fleet-drivers.json');

function loadFleetDrivers() { return loadJsonFile(FLEET_DRIVERS_FILE); }

function saveFleetDrivers(drivers) {
  fs.writeFileSync(FLEET_DRIVERS_FILE, JSON.stringify(drivers, null, 2), 'utf8');
}

app.get('/api/fleet-drivers', requireLogin, requirePermission('fleet'), function(req, res) {
  res.json(loadFleetDrivers());
});

app.post('/api/fleet-drivers', requireLogin, requirePermission('fleet'), function(req, res) {
  try {
    var drivers = loadFleetDrivers();
    var newDriver = Object.assign({}, req.body, { id: Date.now().toString() });
    drivers.push(newDriver);
    saveFleetDrivers(drivers);
    res.json({ ok: true, driver: newDriver });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/fleet-drivers/:id', requireLogin, requirePermission('fleet'), function(req, res) {
  try {
    var drivers = loadFleetDrivers();
    var idx = drivers.findIndex(function(d) { return d.id === req.params.id; });
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Driver not found' });
    drivers[idx] = Object.assign({}, drivers[idx], req.body);
    saveFleetDrivers(drivers);
    res.json({ ok: true, driver: drivers[idx] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/fleet-drivers/:id', requireLogin, requirePermission('fleet'), function(req, res) {
  try {
    var drivers = loadFleetDrivers();
    drivers = drivers.filter(function(d) { return d.id !== req.params.id; });
    saveFleetDrivers(drivers);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── FLEET EXCEL EXPORTS ───────────────────────────────────────────────────────
app.get('/api/vehicles/export', requireLogin, requirePermission('fleet'), function(req, res) {
  try {
    var all = loadVehicles();
    var drivers = loadFleetDrivers();
    var ids = req.query.ids ? String(req.query.ids).split(',') : null;
    var list = ids ? all.filter(function(v) { return ids.indexOf(v.id) !== -1; }) : all;
    var rows = list.map(function(v) {
      var driver = drivers.find(function(d) { return d.id === v.assignedDriverId; });
      return {
        'Registration': v.registration || '',
        'Make': v.make || '',
        'Model': v.model || '',
        'Year': v.year || '',
        'Colour': v.colour || '',
        'Type': v.type || '',
        'Status': v.status || '',
        'Mileage': v.mileage || '',
        'MOT Expiry': v.mot_expiry || '',
        'Insurance Expiry': v.insurance_expiry || '',
        'Road Tax Expiry': v.road_tax_expiry || '',
        'Service Due': v.service_due || '',
        'Assigned Driver': driver ? (driver.first_name + ' ' + driver.last_name) : '',
      };
    });
    sendXlsx(res, 'GuardTec-Fleet-Report-' + new Date().toISOString().slice(0,10) + '.xlsx', rows);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/drivers/export', requireLogin, requirePermission('fleet'), function(req, res) {
  try {
    var all = loadFleetDrivers();
    var vehicles = loadVehicles();
    var ids = req.query.ids ? String(req.query.ids).split(',') : null;
    var list = ids ? all.filter(function(d) { return ids.indexOf(d.id) !== -1; }) : all;
    var rows = list.map(function(d) {
      var vehicle = vehicles.find(function(v) { return v.id === d.assignedVehicleId; });
      return {
        'First Name': d.first_name || '',
        'Last Name': d.last_name || '',
        'Phone': d.phone || '',
        'Email': d.email || '',
        'Licence Number': d.licenceNumber || '',
        'Licence Expiry': d.licenceExpiry || '',
        'Licence Categories': (d.licenceCategories || []).join(', '),
        'CPC Card': d.cpcCard || '',
        'CPC Expiry': d.cpcExpiry || '',
        'Tacho Card': d.tachoCard || '',
        'Tacho Expiry': d.tachoExpiry || '',
        'Medical Expiry': d.medicalExpiry || '',
        'DBS Number': d.dbsNumber || '',
        'DBS Date': d.dbsDate || '',
        'Status': d.status || '',
        'Assigned Vehicle': vehicle ? vehicle.registration : '',
        'Notes': d.notes || '',
      };
    });
    sendXlsx(res, 'GuardTec-Drivers-Report-' + new Date().toISOString().slice(0,10) + '.xlsx', rows);
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/users', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var result = await pgPool.query('SELECT id, username, full_name, role, email, is_active, created_at FROM users ORDER BY full_name');
    res.json({ users: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/users', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var b = req.body;
    var username  = String(b.username  || '').trim().toLowerCase();
    var full_name = String(b.full_name || '').trim();
    var role      = String(b.role      || 'supervisor').trim();
    var email     = String(b.email     || '').trim().toLowerCase();
    var password  = String(b.password  || '');

    if (!username)  return res.status(400).json({ ok: false, error: 'Username is required.' });
    if (!full_name) return res.status(400).json({ ok: false, error: 'Full name is required.' });
    if (!password || password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters.' });

    var exists = await pgPool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (exists.rows.length) return res.status(400).json({ ok: false, error: 'Username already exists.' });

    var hash = await bcrypt.hash(password, 10);
    var r = await pgPool.query(
      'INSERT INTO users (username, password_hash, full_name, role, email, is_active) VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id, username, full_name, role, email, is_active, created_at',
      [username, hash, full_name, role, email]
    );
    res.json({ ok: true, user: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/users/:id', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var b = req.body;
    var id        = req.params.id;
    var full_name = String(b.full_name || '').trim();
    var role      = String(b.role      || '').trim();
    var email     = String(b.email     || '').trim().toLowerCase();
    var is_active = b.is_active !== undefined ? Boolean(b.is_active) : true;

    if (!full_name) return res.status(400).json({ ok: false, error: 'Full name is required.' });

    // Prevent director from suspending their own account
    if (String(req.user.id) === String(id) && !is_active) {
      return res.status(400).json({ ok: false, error: 'You cannot suspend your own account.' });
    }

    var r = await pgPool.query(
      'UPDATE users SET full_name=$1, role=$2, email=$3, is_active=$4 WHERE id=$5 RETURNING id, username, full_name, role, email, is_active',
      [full_name, role, email, is_active, id]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'User not found.' });
    res.json({ ok: true, user: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/users/:id/reset-password', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var password = String(req.body.password || '');
    if (!password || password.length < 6) return res.status(400).json({ ok: false, error: 'New password must be at least 6 characters.' });
    var hash = await bcrypt.hash(password, 10);
    var r = await pgPool.query('UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING id', [hash, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'User not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/users/:id', requireLogin, requireRole('director'), async function(req, res) {
  try {
    if (String(req.user.id) === String(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'You cannot delete your own account.' });
    }
    var r = await pgPool.query('DELETE FROM users WHERE id=$1 RETURNING id', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'User not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── ROLES MANAGEMENT ──────────────────────────────────────────────────────────
// Deliberately director-only and NOT itself permission-configurable — letting
// any role grant/edit roles would be a privilege-escalation hole.
function slugify(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'role';
}

app.get('/api/roles', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var roles = await loadRoles();
    res.json({ ok: true, roles: roles });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/roles', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var name = String(req.body.name || '').trim();
    var permissions = req.body.permissions && typeof req.body.permissions === 'object' ? req.body.permissions : {};
    if (!name) return res.status(400).json({ ok: false, error: 'Role name is required.' });

    var slug = slugify(name);
    var existing = await pgPool.query('SELECT slug FROM roles WHERE slug = $1', [slug]);
    if (existing.rows.length) {
      slug = slug + '_' + Date.now().toString().slice(-5);
    }

    var r = await pgPool.query(
      'INSERT INTO roles (slug, name, is_system, permissions) VALUES ($1,$2,FALSE,$3) RETURNING slug, name, is_system, permissions',
      [slug, name, JSON.stringify(permissions)]
    );
    invalidateRolesCache();
    res.json({ ok: true, role: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/roles/:slug', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var slug = req.params.slug;
    var existing = await pgPool.query('SELECT * FROM roles WHERE slug = $1', [slug]);
    if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Role not found.' });
    var current = existing.rows[0];

    if (slug === 'director' || slug === 'staff') {
      return res.status(400).json({ ok: false, error: 'This role is required by the system and cannot be edited.' });
    }

    var name = String(req.body.name || current.name).trim();
    var permissions = req.body.permissions && typeof req.body.permissions === 'object' ? req.body.permissions : current.permissions;
    if (!name) return res.status(400).json({ ok: false, error: 'Role name is required.' });

    var r = await pgPool.query(
      'UPDATE roles SET name=$1, permissions=$2 WHERE slug=$3 RETURNING slug, name, is_system, permissions',
      [name, JSON.stringify(permissions), slug]
    );
    invalidateRolesCache();
    res.json({ ok: true, role: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/roles/:slug', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var slug = req.params.slug;
    var existing = await pgPool.query('SELECT is_system FROM roles WHERE slug = $1', [slug]);
    if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Role not found.' });
    if (existing.rows[0].is_system) {
      return res.status(400).json({ ok: false, error: 'Built-in roles cannot be deleted.' });
    }

    var inUse = await pgPool.query('SELECT COUNT(*) as count FROM users WHERE role = $1', [slug]);
    var count = parseInt(inUse.rows[0].count) || 0;
    if (count > 0) {
      return res.status(400).json({ ok: false, error: count + ' user(s) currently have this role. Reassign them first in Team Access.' });
    }

    await pgPool.query('DELETE FROM roles WHERE slug = $1', [slug]);
    invalidateRolesCache();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── DB HELPERS ────────────────────────────────────────────────────────────────
async function resolveEmpId(legacyId) {
  var r = await pgPool.query('SELECT id FROM employees WHERE legacy_id = $1', [legacyId]);
  return r.rows.length ? r.rows[0].id : null;
}

// ── PHASE 4 API: Disciplinary Records & Incident Reports ─────────────────────

// ── Disciplinary: list for a staff member (management) ──
app.get('/api/staff/:id/disciplinary', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var empId = await resolveEmpId(req.params.id);
    if (!empId) return res.json({ ok: true, records: [] });
    var result = await pgPool.query(
      `SELECT dr.*, u.full_name AS issued_by_name
       FROM disciplinary_records dr
       LEFT JOIN users u ON u.id = dr.issued_by
       WHERE dr.employee_id = $1
       ORDER BY dr.incident_date DESC`,
      [empId]
    );
    res.json({ ok: true, records: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Disciplinary: add record (Director / Ops Manager only) ──
app.post('/api/staff/:id/disciplinary', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var b = req.body;
    if (!b.incident_date || !b.type || !b.description) {
      return res.status(400).json({ ok: false, error: 'incident_date, type and description are required.' });
    }
    var empId = await resolveEmpId(req.params.id);
    if (!empId) return res.status(404).json({ ok: false, error: 'Staff member not found in database.' });
    var result = await pgPool.query(
      `INSERT INTO disciplinary_records (employee_id, incident_date, type, description, action_taken, issued_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [empId, b.incident_date, b.type, b.description, b.action_taken || null, req.user.id]
    );
    res.json({ ok: true, record: result.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Disciplinary: delete a record (Director only) ──
app.delete('/api/disciplinary/:recordId', requireLogin, requireRole('director'), async function(req, res) {
  try {
    await pgPool.query('DELETE FROM disciplinary_records WHERE id = $1', [req.params.recordId]);
    res.json({ ok: true });
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

// ── Incident Reports: submit (any logged-in staff member) ──
app.post('/api/incident-reports', requireLogin, async function(req, res) {
  try {
    var b = req.body;
    if (!b.incident_type || !b.description) {
      return res.status(400).json({ ok: false, error: 'incident_type and description are required.' });
    }
    var reporterId = null;
    if (!b.is_anonymous && req.user.staff_id) {
      var empResult = await pgPool.query('SELECT id FROM employees WHERE legacy_id = $1', [req.user.staff_id]);
      if (empResult.rows.length) reporterId = empResult.rows[0].id;
    }
    var result = await pgPool.query(
      `INSERT INTO incident_reports
         (reporter_id, is_anonymous, report_date, site_location, incident_type, against_person, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        b.is_anonymous ? null : reporterId,
        !!b.is_anonymous,
        b.report_date || new Date().toISOString().slice(0, 10),
        b.site_location || null,
        b.incident_type,
        b.against_person || null,
        b.description,
      ]
    );
    res.json({ ok: true, report: result.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Incident Reports: staff view their own submitted reports ──
app.get('/api/my-incident-reports', requireLogin, requireRole('staff'), async function(req, res) {
  try {
    if (!req.user.staff_id) return res.json({ ok: true, reports: [] });
    var empId = await resolveEmpId(req.user.staff_id);
    if (!empId) return res.json({ ok: true, reports: [] });
    var result = await pgPool.query(
      `SELECT ir.id, ir.is_anonymous, ir.report_date, ir.site_location, ir.incident_type, ir.against_person, ir.description, ir.status, ir.resolution_notes, ir.created_at,
              COUNT(ia.id)::int AS attachment_count
       FROM incident_reports ir
       LEFT JOIN incident_attachments ia ON ia.incident_id = ir.id
       WHERE ir.reporter_id = $1
       GROUP BY ir.id ORDER BY ir.created_at DESC`,
      [empId]
    );
    res.json({ ok: true, reports: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Incident Reports: management — view all ──
app.get('/api/incident-reports', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var result = await pgPool.query(
      `SELECT ir.*,
         CASE WHEN ir.is_anonymous THEN NULL ELSE e.name END AS reporter_name,
         u.full_name AS reviewed_by_name,
         COUNT(ia.id)::int AS attachment_count
       FROM incident_reports ir
       LEFT JOIN employees e ON e.id = ir.reporter_id
       LEFT JOIN users u ON u.id = ir.reviewed_by
       LEFT JOIN incident_attachments ia ON ia.incident_id = ir.id
       GROUP BY ir.id, e.name, u.full_name
       ORDER BY ir.created_at DESC`
    );
    res.json({ ok: true, reports: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Incident Reports: management — update status ──
app.patch('/api/incident-reports/:reportId', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var b = req.body;
    await pgPool.query(
      `UPDATE incident_reports
       SET status = COALESCE($1, status),
           resolution_notes = COALESCE($2, resolution_notes),
           reviewed_by = $3,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [b.status || null, b.resolution_notes || null, req.user.id, req.params.reportId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Incident Attachments ──────────────────────────────────────────────────────
var INCIDENT_ATTACH_DIR = path.join(BASE, 'incident-attachments');
if (!fs.existsSync(INCIDENT_ATTACH_DIR)) fs.mkdirSync(INCIDENT_ATTACH_DIR, { recursive: true });

var ALLOWED_ATTACH_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/avi': '.avi',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx'
};
var MAX_ATTACH_SIZE = 100 * 1024 * 1024; // 100 MB

// Upload attachment for an incident report
app.post('/api/incident-reports/:reportId/attachments', requireLogin, function(req, res) {
  var mime = (req.headers['content-type'] || '').split(';')[0].trim();
  var ext = ALLOWED_ATTACH_MIME[mime];
  if (!ext) return res.status(400).json({ ok: false, error: 'File type not allowed.' });

  var originalName = decodeURIComponent(req.headers['x-original-name'] || 'attachment' + ext);
  var filename = crypto.randomUUID() + ext;
  var dest = path.join(INCIDENT_ATTACH_DIR, filename);

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
        'INSERT INTO incident_attachments (incident_id, filename, original_name, mime_type, size_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id, filename, original_name, mime_type, size_bytes, uploaded_at',
        [req.params.reportId, filename, originalName, mime, buf.length]
      );
      res.json({ ok: true, attachment: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
  req.on('error', function() { res.status(500).json({ ok: false, error: 'Upload failed.' }); });
});

// List attachments for an incident report
app.get('/api/incident-reports/:reportId/attachments', requireLogin, async function(req, res) {
  try {
    var r = await pgPool.query(
      'SELECT id, filename, original_name, mime_type, size_bytes, uploaded_at FROM incident_attachments WHERE incident_id = $1 ORDER BY uploaded_at ASC',
      [req.params.reportId]
    );
    res.json({ ok: true, attachments: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Serve / download an attachment
app.get('/api/incident-attachments/:filename', requireLogin, function(req, res) {
  try {
    var safe = path.basename(req.params.filename);
    var filePath = path.join(INCIDENT_ATTACH_DIR, safe);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
  } catch (e) {
    res.status(500).end();
  }
});

// Delete an attachment (reporter or management)
app.delete('/api/incident-attachments/:attachId', requireLogin, async function(req, res) {
  try {
    var r = await pgPool.query('SELECT filename FROM incident_attachments WHERE id = $1', [req.params.attachId]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Not found.' });
    var filePath = path.join(INCIDENT_ATTACH_DIR, r.rows[0].filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await pgPool.query('DELETE FROM incident_attachments WHERE id = $1', [req.params.attachId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Staff Messages ────────────────────────────────────────────────────────────

// Management: view full conversation for a staff member
app.get('/api/staff/:id/messages', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var empId = await resolveEmpId(req.params.id);
    if (!empId) return res.json({ ok: true, messages: [] });
    var result = await pgPool.query(
      `SELECT sm.id, sm.message, sm.is_read, sm.created_at,
              u.full_name AS sender_name, u.role AS sender_role
       FROM staff_messages sm
       JOIN users u ON u.id = sm.sender_id
       WHERE sm.employee_id = $1
       ORDER BY sm.created_at ASC`,
      [empId]
    );
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
    var result = await pgPool.query(
      `SELECT sm.id, sm.message, sm.is_read, sm.created_at,
              u.full_name AS sender_name, u.role AS sender_role
       FROM staff_messages sm
       JOIN users u ON u.id = sm.sender_id
       WHERE sm.employee_id = $1
       ORDER BY sm.created_at ASC`,
      [empId]
    );
    var unread = result.rows.filter(function(m) { return !m.is_read && m.sender_role !== 'staff'; }).length;
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
    var empId = await resolveEmpId(req.user.staff_id);
    if (!empId) return res.status(400).json({ ok: false, error: 'Staff profile not found.' });
    var msg = String((req.body && req.body.message) || '').trim();
    if (!msg) return res.status(400).json({ ok: false, error: 'Message cannot be empty.' });
    var r = await pgPool.query(
      'INSERT INTO staff_messages (employee_id, sender_id, message, is_read) VALUES ($1,$2,$3, FALSE) RETURNING id, message, created_at',
      [empId, req.user.id, msg]
    );
    res.json({ ok: true, message: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Staff Provisions (Uniform & Equipment) ────────────────────────────────────

// Management: list provisions for a staff member
app.get('/api/staff/:id/provisions', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var empId = await resolveEmpId(req.params.id);
    if (!empId) return res.json({ ok: true, provisions: [] });
    var result = await pgPool.query(
      `SELECT sp.*, u.full_name AS recorded_by_name
       FROM staff_provisions sp
       LEFT JOIN users u ON u.id = sp.recorded_by
       WHERE sp.employee_id = $1 ORDER BY sp.created_at DESC`,
      [empId]
    );
    res.json({ ok: true, provisions: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Management: add a provision record
app.post('/api/staff/:id/provisions', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var empId = await resolveEmpId(req.params.id);
    if (!empId) return res.status(404).json({ ok: false, error: 'Staff not found.' });
    var b = req.body;
    if (!b.item) return res.status(400).json({ ok: false, error: 'Item name is required.' });
    var r = await pgPool.query(
      `INSERT INTO staff_provisions (employee_id, item, provided, date_given, date_returned, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [empId, b.item, b.provided !== false, b.date_given || null, b.date_returned || null, b.notes || null, req.user.id]
    );
    res.json({ ok: true, provision: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Management: delete a provision record
app.delete('/api/provisions/:id', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    await pgPool.query('DELETE FROM staff_provisions WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
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

// ── STAFF CONTRACT DOCUMENTS ─────────────────────────────────────────────────
// Stored at BASE/contracts/{legacy_id}_contract.{ext}

var CONTRACT_DIR = path.join(BASE, 'contracts');
if (!fs.existsSync(CONTRACT_DIR)) fs.mkdirSync(CONTRACT_DIR, { recursive: true });

function findContractFile(legacyId) {
  var exts = ['.pdf', '.docx', '.doc', '.jpg', '.jpeg', '.png'];
  for (var e of exts) {
    var p = path.join(CONTRACT_DIR, String(legacyId) + '_contract' + e);
    if (fs.existsSync(p)) return { filePath: p, ext: e };
  }
  return null;
}

function contractMime(ext) {
  if (ext === '.pdf')             return 'application/pdf';
  if (ext === '.docx')            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.doc')             return 'application/msword';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png')             return 'image/png';
  return 'application/octet-stream';
}

// Check if contract exists (management)
app.get('/api/staff/:id/contract/info', requireLogin, requirePermission('staff'), function(req, res) {
  var found = findContractFile(req.params.id);
  res.json({ ok: true, exists: !!found, ext: found ? found.ext : null });
});

// Upload contract (management)
app.post('/api/staff/:id/contract', requireLogin, requirePermission('staff'), function(req, res) {
  var legacyId = req.params.id;
  var mime = (req.headers['content-type'] || '').toLowerCase();
  var ext = '.pdf';
  if      (mime.includes('pdf'))    ext = '.pdf';
  else if (mime.includes('docx'))   ext = '.docx';
  else if (mime.includes('msword')) ext = '.doc';
  else if (mime.includes('jpeg'))   ext = '.jpg';
  else if (mime.includes('png'))    ext = '.png';

  var chunks = [];
  req.on('data', function(c) { chunks.push(c); });
  req.on('end', function() {
    try {
      var buf = Buffer.concat(chunks);
      ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'].forEach(function(e) {
        var old = path.join(CONTRACT_DIR, legacyId + '_contract' + e);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      });
      fs.writeFileSync(path.join(CONTRACT_DIR, legacyId + '_contract' + ext), buf);
      res.json({ ok: true });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
});

// Download / view contract (management)
app.get('/api/staff/:id/contract', requireLogin, requirePermission('staff'), function(req, res) {
  var found = findContractFile(req.params.id);
  if (!found) return res.status(404).json({ ok: false, error: 'No contract on file.' });
  res.setHeader('Content-Type', contractMime(found.ext));
  res.setHeader('Content-Disposition', 'inline; filename="contract' + found.ext + '"');
  res.send(fs.readFileSync(found.filePath));
});

// Delete contract (management)
app.delete('/api/staff/:id/contract', requireLogin, requirePermission('staff'), function(req, res) {
  var found = findContractFile(req.params.id);
  if (found) fs.unlinkSync(found.filePath);
  res.json({ ok: true });
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

// ── INTERNAL n8n ENDPOINTS ────────────────────────────────────────────────────
// These endpoints use a pre-shared token instead of session auth — for n8n agents only.

var N8N_TOKEN = process.env.N8N_TOKEN || '';

function requireN8nToken(req, res, next) {
  var token = req.headers['x-n8n-token'] || req.query.token;
  if (!N8N_TOKEN || token !== N8N_TOKEN) return res.status(401).json({ ok: false, error: 'Unauthorised' });
  next();
}

// GET /api/internal/fleet — returns all vehicles with pre-computed days_until_* fields
app.get('/api/internal/fleet', requireN8nToken, function(req, res) {
  try {
    var vehicles = loadVehicles();
    var now = Date.now();
    function daysUntil(dateStr) {
      if (!dateStr) return null;
      var d = new Date(dateStr);
      if (isNaN(d.getTime())) return null;
      return Math.floor((d.getTime() - now) / 86400000);
    }
    var enriched = vehicles
      .filter(function(v) { return v.status !== 'sold'; })
      .map(function(v) {
        return {
          id: v.id,
          registration: v.registration,
          make: v.make,
          model: v.model,
          year: v.year,
          type: v.type,
          status: v.status,
          mot_expiry:       v.mot_expiry       || null,
          insurance_expiry: v.insurance_expiry || null,
          road_tax_expiry:  v.road_tax_expiry  || null,
          service_due:      v.service_due      || null,
          days_mot:       daysUntil(v.mot_expiry),
          days_insurance: daysUntil(v.insurance_expiry),
          days_road_tax:  daysUntil(v.road_tax_expiry),
          days_service:   daysUntil(v.service_due),
        };
      });
    res.json({ ok: true, vehicles: enriched, generatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────

// Management: which staff have unread messages (for bell notification list)
app.get('/api/staff-messages/unread', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var result = await pgPool.query(
      `SELECT e.legacy_id AS staff_id, e.name AS staff_name, COUNT(*) AS unread_count,
              MAX(sm.created_at) AS latest_at
       FROM staff_messages sm
       JOIN employees e ON e.id = sm.employee_id
       JOIN users u ON u.id = sm.sender_id
       WHERE u.role = 'staff' AND sm.is_read = FALSE
       GROUP BY e.legacy_id, e.name
       ORDER BY latest_at DESC`
    );
    res.json({ ok: true, staff: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Management: count of unread staff messages + open incident reports
app.get('/api/notifications/count', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var msgResult = await pgPool.query(
      `SELECT COUNT(*) AS cnt FROM staff_messages
       WHERE sender_id IN (SELECT id FROM users WHERE role = 'staff') AND is_read = FALSE`
    );
    var incResult = await pgPool.query(
      `SELECT COUNT(*) AS cnt FROM incident_reports WHERE status = 'open'`
    );
    var msgs = parseInt(msgResult.rows[0].cnt) || 0;
    var incidents = parseInt(incResult.rows[0].cnt) || 0;
    res.json({ ok: true, messages: msgs, incidents: incidents, total: msgs + incidents });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── START ─────────────────────────────────────────────────────────────────────
console.log('\nInitialising staff data from spreadsheet...');
initFromSpreadsheet();

app.listen(PORT, function() {
  console.log('\n========================================');
  console.log('  GuardTec Compliance App is RUNNING');
  console.log('  Open Chrome: http://localhost:' + PORT);
  console.log('  Press Ctrl+C to stop');
  console.log('========================================\n');

  // Duplicate check on every startup, then every hour automatically
  setTimeout(autoDedup, 3000);
  setInterval(autoDedup, 60 * 60 * 1000);

  // New Staff Inbox — check every 30 seconds for Power Automate form submissions
  checkNewStaffInbox();
  setInterval(checkNewStaffInbox, 30 * 1000);
  console.log('[INBOX] Watching ! New Staff Inbox/ for new form submissions...');
});