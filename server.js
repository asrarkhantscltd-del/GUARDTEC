const express      = require('express');
const { execFile }  = require('child_process');
const fs           = require('fs');
const path         = require('path');
const XLSX         = require('xlsx');
const cookieParser = require('cookie-parser');
const jwt          = require('jsonwebtoken');
const bcrypt       = require('bcryptjs');
const crypto       = require('crypto');
const rateLimit    = require('express-rate-limit');
const helmet       = require('helmet');
const AdmZip       = require('adm-zip');
const webpush      = require('web-push');
const { Pool }     = require('pg');

const app  = express();
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })); // security headers (nosniff, HSTS, frame, referrer…); CSP off — this server only returns JSON/files, the SPA's CSP belongs in nginx
app.set('trust proxy', 2); // behind Caddy + frontend nginx in production (2 hops); needed for express-rate-limit to read X-Forwarded-For correctly
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const BASE_URL = process.env.BASE_URL || ('http://localhost:' + PORT); // link base for acknowledgment-form URLs (Feature 2)

const JWT_SECRET = process.env.JWT_SECRET;
const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── SHARED LIBRARIES ──────────────────────────────────────────────────────────
// lib/<name>.js modules load in dependency order; each one adds its exports to
// `deps` (getters kept live for STAFF_CACHE-style mutable state), which is then
// handed to every routes/<domain>.js file and to crm.js / procurement.js.
var deps = { app: app, PORT: PORT, BASE_URL: BASE_URL, JWT_SECRET: JWT_SECRET, pgPool: pgPool };
function mount(mod) { Object.defineProperties(deps, Object.getOwnPropertyDescriptors(mod)); }
mount(require('./lib/paths')(deps));
mount(require('./lib/migrations')(deps));
mount(require('./lib/audit')(deps));
mount(require('./lib/auth')(deps));
mount(require('./lib/notifications')(deps));
mount(require('./lib/complianceCalendar')(deps));
mount(require('./lib/complianceCalc')(deps));
mount(require('./lib/staffData')(deps));
mount(require('./lib/staffDocs')(deps));
mount(require('./lib/sites')(deps));
mount(require('./lib/reports')(deps));
mount(require('./lib/vehicles')(deps));
mount(require('./lib/staffInbox')(deps));
var BASE = deps.BASE,
  autoDedup = deps.autoDedup,
  checkComplianceCalendarReminders = deps.checkComplianceCalendarReminders,
  checkNewStaffInbox = deps.checkNewStaffInbox,
  createNotification = deps.createNotification,
  employeesExtendedSchemaReady = deps.employeesExtendedSchemaReady,
  initFromSpreadsheet = deps.initFromSpreadsheet,
  logAuditEvent = deps.logAuditEvent,
  purgeExpiredRecycleBin = deps.purgeExpiredRecycleBin,
  refreshStaffCacheFull = deps.refreshStaffCacheFull,
  requireLogin = deps.requireLogin,
  requirePermission = deps.requirePermission,
  requireRole = deps.requireRole,
  sendXlsx = deps.sendXlsx;


app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// ── CSRF double-submit check ──────────────────────────────────────────────────
// Every mutating request must echo the csrf_token cookie back as a header.
// A cross-site attacker's page can trigger the request but can never read the
// cookie to put in the header, so the two won't match. Login/register are
// exempt — no CSRF cookie exists yet before the user is authenticated. The
// public acknowledgment-form routes are exempt for a different reason: they
// never sit behind a login session at all, by design — the 256-bit token in
// the URL IS the security boundary for those routes, not this cookie (plan's
// Key Security Considerations #2). Don't conflate the two exemptions.
var CSRF_EXEMPT_PATHS = ['/api/login', '/api/register'];
app.use(function(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].indexOf(req.method) !== -1) return next();
  if (CSRF_EXEMPT_PATHS.indexOf(req.path) !== -1) return next();
  if (req.path.indexOf('/api/acknowledge/') === 0) return next();
  // Same reasoning as /api/acknowledge/ above — the token IS the security
  // boundary for these public compliance-calendar reminder links, not a
  // login session, so there's no CSRF cookie to check here either.
  if (req.path.indexOf('/api/public/compliance-calendar/') === 0) return next();
  // Public supplier evaluation link — same token-is-the-boundary model.
  if (req.path.indexOf('/api/public/supplier-evaluation/') === 0) return next();
  var cookieToken = req.cookies && req.cookies.csrf_token;
  var headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ ok: false, error: 'Invalid or missing CSRF token. Please log out and back in.' });
  }
  next();
});

// ── CRM (event-based leads — see crm.js) ──────────────────────────────────────
require('./crm')({ app: app, pgPool: pgPool, requireLogin: requireLogin, requirePermission: requirePermission, logAuditEvent: logAuditEvent, sendXlsx: sendXlsx });

// ── PROCUREMENT (purchase orders + approved suppliers — see procurement.js) ───
require('./procurement')({ app: app, pgPool: pgPool, requireLogin: requireLogin, requirePermission: requirePermission, requireRole: requireRole, logAuditEvent: logAuditEvent, createNotification: createNotification, BASE: BASE, BASE_URL: BASE_URL, rateLimit: rateLimit });

// ── DOMAIN ROUTES ─────────────────────────────────────────────────────────────
// Each routes/<domain>.js file registers its own endpoints (same pattern as
// crm.js / procurement.js). Order matters only where paths could overlap; it
// mirrors the order the routes originally appeared in this file.
require('./routes/auth')(deps);
require('./routes/pages')(deps);
require('./routes/staff')(deps);
require('./routes/usersRoles')(deps);
require('./routes/myProfile')(deps);
require('./routes/dashboard')(deps);
require('./routes/sites')(deps);
require('./routes/complianceCalendar')(deps);
require('./routes/recycleBin')(deps);
require('./routes/fleet')(deps);
require('./routes/agencies')(deps);
require('./routes/eventInstructions')(deps);
require('./routes/customForms')(deps);
require('./routes/incidentReports')(deps);
require('./routes/messages')(deps);
require('./routes/notifications')(deps);
require('./routes/aiChat')(deps);

// ── START ─────────────────────────────────────────────────────────────────────
// loadAllStaff() must be callable synchronously the instant the server
// starts accepting requests, so STAFF_CACHE has to be warm BEFORE
// app.listen() — unlike the schema-repair IIFEs above (which are fine
// racing in the background), an empty cache on the first real request would
// mean an empty staff roster, not just a slow one.
(async function startServer() {
  await employeesExtendedSchemaReady;
  await refreshStaffCacheFull();
  console.log('\nInitialising staff data from spreadsheet...');
  await initFromSpreadsheet();

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

    // Compliance Calendar reminders — 3-days-before/due-today/overdue, checked
    // every 6h (cheap enough to be safe against server restarts landing mid-day).
    setTimeout(checkComplianceCalendarReminders, 5000);
    setInterval(checkComplianceCalendarReminders, 6 * 60 * 60 * 1000);

    // Recycle Bin — permanently remove anything binned more than RECYCLE_RETENTION_DAYS ago.
    setTimeout(purgeExpiredRecycleBin, 10000);
    setInterval(purgeExpiredRecycleBin, 6 * 60 * 60 * 1000);
  });
})();