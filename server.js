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

// Web Push (real browser/phone push notifications, works even with the PWA
// closed) — managers/directors only for now, hooked into createNotification()
// below rather than each of its call sites, so every existing broadcast
// event (staff upload, message, incident report, etc.) gets push for free.
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} else {
  console.warn('[PUSH] VAPID keys not set — push notifications disabled.');
}

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

(async function ensureMessageAttachmentsSchema() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS message_attachments (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        message_id    UUID NOT NULL REFERENCES staff_messages(id) ON DELETE CASCADE,
        filename      TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type     TEXT NOT NULL,
        size_bytes    INTEGER NOT NULL,
        uploaded_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_msg_attach_message ON message_attachments(message_id)");
  } catch (e) {
    console.error('[DB] message_attachments schema migration failed:', e.message);
  }
})();

// Per-event notification feed for the management bell — distinct from the
// compliance-alerts card, which stays status-based (persists until the real
// issue is fixed). These are dismissible: created on a staff action, cleared
// once a manager clicks through to see it.
(async function ensureNotificationsSchema() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type         TEXT NOT NULL,
        actor_name   TEXT NOT NULL,
        summary      TEXT NOT NULL,
        link_staff_id     TEXT,
        link_tab          TEXT,
        link_incident_id  UUID,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        seen_at      TIMESTAMPTZ
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_notifications_unseen ON notifications(seen_at) WHERE seen_at IS NULL");
    // An agency message notification had nowhere to point — link_staff_id
    // only makes sense for the employee_id-owned side of staff_messages, an
    // agency-owned thread needs its own link column (bug found via user
    // report: clicking the notification just dismissed it, no navigation).
    await pgPool.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link_agency_id TEXT");
  } catch (e) {
    console.error('[DB] notifications schema migration failed:', e.message);
  }
})();

// Where tapping a push notification should land — mirrors the in-app bell's
// goToNotification() routing in DashboardLayout.tsx (keep the two in step).
function notificationUrl(opts) {
  if (opts.type === 'incident_report') return '/incident-reports';
  if (opts.type === 'profile_submission') return '/pending-review';
  if (opts.type === 'compliance_calendar_reminder') return '/compliance-calendar';
  if (opts.type === 'supplier_evaluation') return '/suppliers';
  var tab = opts.linkTab ? '?tab=' + encodeURIComponent(opts.linkTab) : '';
  if (opts.linkAgencyId) return '/admin/agencies/' + encodeURIComponent(opts.linkAgencyId) + tab;
  if (opts.linkStaffId) return '/staff/' + encodeURIComponent(opts.linkStaffId) + tab;
  return '/';
}

async function createNotification(opts) {
  try {
    await pgPool.query(
      `INSERT INTO notifications (type, actor_name, summary, link_staff_id, link_tab, link_incident_id, link_agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [opts.type, opts.actorName, opts.summary, opts.linkStaffId || null, opts.linkTab || null, opts.linkIncidentId || null, opts.linkAgencyId || null]
    );
  } catch (e) {
    console.error('[NOTIFY] failed to create notification:', e.message);
  }
  // Same broadcast audience as the bell feed above (every manager/director),
  // fired from this single choke point so none of createNotification()'s
  // six call sites need editing individually. Never let a push failure
  // affect the caller — the in-app notification above already succeeded.
  // Calendar reminders are personal (only the responsible person's devices);
  // every other event keeps the original "all subscribed managers" audience.
  pushToManagers(opts.summary, opts.type === 'compliance_calendar_reminder' ? { type: opts.type, summary: opts.summary } : null, notificationUrl(opts))
    .catch(function(e) { console.error('[PUSH] broadcast failed:', e.message); });
}

// ── WEB PUSH (browser/phone notifications) ─────────────────────────────────
(async function ensurePushSubscriptionsSchema() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint   TEXT NOT NULL UNIQUE,
        p256dh     TEXT NOT NULL,
        auth       TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)");
  } catch (e) {
    console.error('[DB] push_subscriptions schema migration failed:', e.message);
  }
})();

// Shared delivery loop for both pushToManagers and pushToUser below — sends
// one payload to every given subscription row, cleaning up any the
// browser/OS has revoked (uninstalled, permission withdrawn, etc.) rather
// than retrying them forever on every future notification.
async function deliverPush(subs, payload) {
  for (var i = 0; i < subs.length; i++) {
    var sub = subs[i];
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await pgPool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      } else {
        console.error('[PUSH] send failed for subscription', sub.id, ':', e.message);
      }
    }
  }
}

// Broadcasts to every subscribed manager/director device — the bell feed's
// existing audience (see notifications table above). Used for the six
// existing createNotification() events, none of which have a specific
// target person to narrow to.
// Optional visibilityRow ({ type, summary }) narrows the audience to subscribers
// who are allowed to see that notification (see canViewNotification); null =
// everyone subscribed, as before.
async function pushToManagers(body, visibilityRow, url) {
  if (!process.env.VAPID_PUBLIC_KEY) return; // not configured — no-op, not an error
  var subs = (await pgPool.query(
    'SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, u.role AS role, u.email AS email FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id'
  )).rows;
  if (visibilityRow) {
    var allowed = [];
    for (var i = 0; i < subs.length; i++) {
      var viewer = { email: subs[i].email, hasCalendarModule: await roleHasPermission(subs[i].role, 'compliance_calendar') };
      if (canViewNotification(visibilityRow, viewer)) allowed.push(subs[i]);
    }
    subs = allowed;
  }
  await deliverPush(subs, JSON.stringify({ title: 'GuardTec Compliance', body: body, url: url || '/' }));
}

// Route handlers for these three live further down (after app.use(cookieParser())
// / app.use(express.json()) are registered) — see the "WEB PUSH — routes"
// section below. Express runs middleware/routes in registration order, so
// defining them up here (before the cookie/body parsers exist) meant
// req.cookies and req.body were both undefined for every request to them;
// found via testing (`/api/push/vapid-public-key` returned "Not logged in"
// even for an authenticated browser session).

// ── COMPLIANCE CALENDAR (recurring compliance tasks, own reminder cadence) ────
// Independent of the SharePoint "Compliance Calendar" list + Power Automate flow
// built the same day — this is a separate, in-app copy so Directors/Ops get
// "due in 3 days" reminders through this app's own notification bell without
// depending on that Microsoft 365 pipeline (or its pending admin-consent block).
var DIRECTORS_4 = 'matt.hunter@firstcallsiteservices.co.uk, mark.jones@firstcallsiteservices.co.uk, Sid@guardtec-security.co.uk, paul.gough@guardtec-security.co.uk';

// [title, description, responsible_email, due_date|null, recurrence_unit, recurrence_value, notes]
var COMPLIANCE_CALENDAR_SEED = [
  ['Site File Audit', 'Quarterly audit of site files (Site File Calendar)', 'daniel.jones@firstcallsiteservices.co.uk, asrar.khan@firstcallsiteservices.co.uk', '2026-11-01', 'month', 3, 'Quarterly: Nov, Feb, May, Aug (exact day of month not specified in source)'],
  ['Client Feedback', 'Quarterly client feedback collection (Site File Calendar)', 'zeeshan@principalsecurityconsultants.com', '2026-10-01', 'month', 3, 'Quarterly: Jan, Apr, Jul, Oct. Responsible person updated 2026-09-04 (was previously unclear in source - listed as "All client")'],
  ['Supervisor Reports', 'Monthly supervisor reports (Site File Calendar)', 'daniel.jones@firstcallsiteservices.co.uk, joe.swain@firstcallsiteservices.co.uk, mark.jones@firstcallsiteservices.co.uk', '2026-09-30', 'month', 1, 'Every month'],
  ['Customer Satisfaction', 'Quarterly customer satisfaction review (Site File Calendar)', '', '2026-11-01', 'month', 3, 'Quarterly: Nov, Feb, May, Aug. Source noted this is "Not currently completed" - compliance gap, needs an owner assigned'],
  ['3rd Penetration Visits', 'Quarterly 3rd party penetration/site visits (Site File Calendar)', 'daniel.jones@firstcallsiteservices.co.uk, mark.jones@firstcallsiteservices.co.uk, joe.swain@firstcallsiteservices.co.uk', '2026-10-01', 'month', 3, 'Quarterly: Jan, Apr, Jul, Oct'],
  ['Refresher Training', 'Annual refresher training (HR Calendar)', 'aimee.hunter@firstcallsiteservices.co.uk', '2026-12-01', 'month', 12, 'Annual: December only'],
  ['Dip Testing', 'Quarterly dip testing (HR Calendar)', 'aimee.hunter@firstcallsiteservices.co.uk', '2026-09-30', 'month', 3, 'Quarterly: Mar, Jun, Sep, Dec'],
  ['Employee Feedback', 'Employee feedback collection (HR Calendar)', 'aimee.hunter@firstcallsiteservices.co.uk', '2026-09-30', 'month', 1, 'Full survey Mar/Jun/Sep/Dec, lighter "M&R" round Jan/Apr/Jul/Oct (abbreviation unclear in source - confirm with Asrar). Source listed responsible as "All staff and contractor" - assigned to Aimee as compiler'],
  ['Monthly Newsletter', 'Monthly staff newsletter (HR Calendar)', 'aimee.hunter@firstcallsiteservices.co.uk', '2026-09-30', 'month', 1, 'Every month'],
  ['Staff Appraisals & Promotions', 'Annual staff appraisals and promotions review (HR Calendar)', 'aimee.hunter@firstcallsiteservices.co.uk', '2026-12-01', 'month', 12, 'Annual: December only'],
  ['Filing Cabinet Checks', 'Filing cabinet checks (InfoSec Calendar)', 'asrar.khan@firstcallsiteservices.co.uk', '2026-09-30', 'month', 1, 'Every month - 2 checks in Mar/Jun/Sep/Dec, 1 check other months'],
  ['Change Laptop Passwords', 'Change passwords on all laptops (InfoSec Calendar)', 'asrar.khan@firstcallsiteservices.co.uk', '2026-11-01', 'month', 3, 'Quarterly: Nov, Feb, May, Aug'],
  ['Review SharePoint & WhatsApp Group Usage Log', 'Review SharePoint & WhatsApp group usage log (InfoSec Calendar)', 'matt.hunter@firstcallsiteservices.co.uk, asrar.khan@firstcallsiteservices.co.uk, Sid@guardtec-security.co.uk, mark.jones@firstcallsiteservices.co.uk', '2026-11-01', 'month', 3, 'Quarterly: Nov, Feb, May, Aug'],
  ['Business Continuity Manual Review', 'Annual business continuity manual review', DIRECTORS_4, '2027-06-01', 'month', 12, 'Annual: June only'],
  ['Disaster Recovery Review', 'Annual disaster recovery review', DIRECTORS_4, '2027-06-01', 'month', 12, 'Annual: June only'],
  ['Automated Cascade Exercise', 'Annual automated cascade exercise', DIRECTORS_4, '2027-06-01', 'month', 12, 'Annual: June only'],
  ['Business Recovery', 'Annual business recovery exercise', DIRECTORS_4, '2027-06-01', 'month', 12, 'Annual: June only'],
  ['Review of Business Continuity Plan & Test', 'Annual review and test of the business continuity plan', DIRECTORS_4, '2027-06-01', 'month', 12, 'Annual: June only'],
  ['Review all Manuals & Registers', 'Review of all manuals and registers', DIRECTORS_4, '2027-01-01', 'month', 6, 'Twice yearly: January & June'],
  ['Policy & Procedure Review', 'Policy and procedure review', DIRECTORS_4, '2027-01-01', 'month', 6, 'Twice yearly: January & June'],
  ['Internal Audits', 'Internal audits', DIRECTORS_4, '2027-01-01', 'month', 6, 'Twice yearly: January & June'],
  ['Management Review', 'Management review', DIRECTORS_4, '2027-01-01', 'month', 6, 'Twice yearly: January & June'],
  ['Sales Process Review', 'Sales process review', DIRECTORS_4, '2027-01-01', 'month', 6, 'Twice yearly: January & June'],
  ['Analysis of the Marketplace', 'Annual analysis of the marketplace (Internal & External Factors)', DIRECTORS_4, '2027-07-01', 'month', 12, 'Annual: July only'],
  ['Business Plan', 'Annual business plan review (Internal & External Factors)', DIRECTORS_4, null, 'month', 12, 'Annual - specific month not given in source data, confirm with Asrar'],
  ['Office Management Meetings', 'Weekly office management meeting, Mondays 2pm', DIRECTORS_4, '2026-09-07', 'week', 1, 'Weekly, every Monday at 2pm'],
  ['Management Review Meetings', 'Quarterly management review meeting', DIRECTORS_4, '2026-10-01', 'month', 3, 'Quarterly: January, April, July & October'],
];

(async function ensureComplianceCalendarSchema() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS compliance_calendar_items (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title                   TEXT NOT NULL UNIQUE,
        description             TEXT,
        responsible_email       TEXT NOT NULL DEFAULT '',
        due_date                DATE,
        recurrence_unit         TEXT NOT NULL DEFAULT 'none' CHECK (recurrence_unit IN ('none','week','month')),
        recurrence_value        INTEGER NOT NULL DEFAULT 0,
        notes                   TEXT NOT NULL DEFAULT '',
        last_reminder_stage     TEXT,
        last_reminder_due_date  DATE,
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        updated_at              TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS compliance_calendar_completions (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        item_id                 UUID NOT NULL REFERENCES compliance_calendar_items(id) ON DELETE CASCADE,
        completed_by            TEXT NOT NULL,
        due_date_at_completion  DATE,
        completed_at            TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_compliance_calendar_completions_item ON compliance_calendar_completions(item_id)");

    // One link per email address, reused on repeat requests — a responsible
    // person (often not a GuardTec app user at all, e.g. an external
    // solicitor) can bookmark this once and keep seeing their own due dates.
    // Same "256-bit token in the URL IS the security boundary" model as
    // acknowledgment_forms (server.js ~5824-5836), but deliberately NON-expiring
    // — that link is a single-use signature action, this one is a standing
    // reminder view meant to be revisited indefinitely.
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS compliance_calendar_share_links (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email       TEXT NOT NULL UNIQUE,
        token       TEXT NOT NULL UNIQUE,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_compliance_calendar_share_links_token ON compliance_calendar_share_links(token)");

    // One-time seed — same 27 rows populated into the SharePoint "Compliance
    // Calendar" list on 2026-09-04. UNIQUE(title) + ON CONFLICT means this is
    // safe to run on every boot; it only ever inserts rows that don't exist yet.
    for (var i = 0; i < COMPLIANCE_CALENDAR_SEED.length; i++) {
      var s = COMPLIANCE_CALENDAR_SEED[i];
      await pgPool.query(
        `INSERT INTO compliance_calendar_items (title, description, responsible_email, due_date, recurrence_unit, recurrence_value, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (title) DO NOTHING`,
        [s[0], s[1], s[2], s[3], s[4], s[5], s[6]]
      );
    }
  } catch (e) {
    console.error('[DB] compliance_calendar schema migration failed:', e.message);
  }
})();

async function checkComplianceCalendarReminders() {
  try {
    var result = await pgPool.query(
      `SELECT id, title, responsible_email, due_date, last_reminder_stage, last_reminder_due_date
       FROM compliance_calendar_items WHERE due_date IS NOT NULL`
    );
    var today = new Date(); today.setHours(0, 0, 0, 0);
    for (var i = 0; i < result.rows.length; i++) {
      var item = result.rows[i];
      try {
        var due = new Date(item.due_date); due.setHours(0, 0, 0, 0);
        var days = Math.round((due - today) / 86400000);
        var stage = days === 3 ? '3day' : days === 0 ? 'due_today' : days < 0 ? 'overdue' : null;
        if (!stage) continue;

        var dueChanged = String(item.last_reminder_due_date || '') !== String(item.due_date);
        var alreadySent = stage === item.last_reminder_stage && !dueChanged;
        // Overdue re-fires every run (once per 6h interval) regardless of
        // last_reminder_stage — an unresolved overdue item should keep
        // nudging the bell, not go silent after the first notice.
        if (stage !== 'overdue' && alreadySent) continue;

        var label = stage === '3day' ? 'due in 3 days' : stage === 'due_today' ? 'due today' : 'overdue';
        await createNotification({
          type: 'compliance_calendar_reminder',
          actorName: 'System',
          summary: '"' + item.title + '" is ' + label + (item.responsible_email ? ' — ' + item.responsible_email : '')
        });

        if (stage !== 'overdue') {
          await pgPool.query(
            'UPDATE compliance_calendar_items SET last_reminder_stage = $1, last_reminder_due_date = $2 WHERE id = $3',
            [stage, item.due_date, item.id]
          );
        }
      } catch (innerErr) {
        console.error('[COMPLIANCE-CALENDAR] reminder check failed for item ' + item.id + ':', innerErr.message);
      }
    }
  } catch (e) {
    console.error('[COMPLIANCE-CALENDAR] reminder job failed:', e.message);
  }
}

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

// audit_events.object_id was originally UUID, but sites use TEXT ids (legacy
// Date.now() strings preserved from the JSON->Postgres migration) — widen it
// so the audit trail can log site events too, without losing any data.
(async function ensureAuditEventsSchema() {
  try {
    await pgPool.query("ALTER TABLE audit_events ALTER COLUMN object_id TYPE TEXT");
  } catch (e) {
    console.error('[DB] audit_events schema migration failed:', e.message);
  }
})();

// Shared audit-trail logger — reused by every create/edit/delete route that
// should show up in the Director-only Audit Trail page. Never throws: a
// logging failure must not break the actual action it's recording.
async function logAuditEvent(req, action, objectType, objectId, objectName, metadata) {
  try {
    await pgPool.query(
      `INSERT INTO audit_events (actor_id, actor_email, action, object_type, object_id, object_name, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [(req.user && req.user.id) || null, (req.user && req.user.username) || null, action, objectType, objectId, objectName, JSON.stringify(metadata || {})]
    );
  } catch (e) {
    console.error('[AUDIT] log failed:', e.message);
  }
}

// Agency cover-guard management (external staffing agencies) — agencies log
// in through the SAME users/JWT system as everyone else (role='agency',
// agency_id TEXT mirrors the existing users.staff_id TEXT column exactly).
// Captured as a promise (not fire-and-forget) because ensureDeploymentsSchema
// and ensureAgencyMessagingSchema below both create foreign keys into
// `agencies` — without an explicit await, these are independent async IIFEs
// that all start at module load and race the DB on their own timing, so
// "agencies" can still be mid-CREATE when a dependent ALTER/CREATE fires
// (confirmed in testing: this raced and failed intermittently before this fix).
var agenciesSchemaReady = (async function ensureAgenciesSchema() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS agencies (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name         TEXT NOT NULL,
        email        TEXT NOT NULL,
        phone        TEXT,
        created_by   UUID REFERENCES users(id),
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        status       TEXT NOT NULL DEFAULT 'active',
        archived_at  TIMESTAMPTZ,
        notes        TEXT
      )
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS agency_staff (
        id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agency_id                     UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
        name                          TEXT NOT NULL,
        email                         TEXT,
        phone                         TEXT,
        nationality                   TEXT,
        job_role                      TEXT NOT NULL,
        custom_role                   TEXT,
        badge_type                    TEXT,
        dbs_expiry                    DATE,
        sia_cert_uploaded             BOOLEAN NOT NULL DEFAULT FALSE,
        sia_cert_upload_date         TIMESTAMPTZ,
        cscs_cert_uploaded            BOOLEAN NOT NULL DEFAULT FALSE,
        cscs_cert_upload_date        TIMESTAMPTZ,
        rtw_cert_uploaded             BOOLEAN NOT NULL DEFAULT FALSE,
        rtw_cert_upload_date         TIMESTAMPTZ,
        dog_handler_cert_uploaded     BOOLEAN NOT NULL DEFAULT FALSE,
        dog_handler_cert_upload_date TIMESTAMPTZ,
        training_cert_uploaded        BOOLEAN NOT NULL DEFAULT FALSE,
        training_cert_upload_date    TIMESTAMPTZ,
        status                        TEXT NOT NULL DEFAULT 'active',
        archived_at                   TIMESTAMPTZ,
        created_at                    TIMESTAMPTZ DEFAULT NOW(),
        updated_at                    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_agency_staff_agency ON agency_staff(agency_id) WHERE status = 'active'");
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS agency_staff_unavailability (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agency_staff_id  UUID NOT NULL REFERENCES agency_staff(id) ON DELETE CASCADE,
        date_from        DATE NOT NULL,
        date_to          DATE NOT NULL,
        reason           TEXT,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        CHECK (date_to >= date_from)
      )
    `);
    await pgPool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS agency_id TEXT");
    // Consent attestations — a guard has no login of their own (Option 2,
    // confirmed design), so this is the AGENCY confirming they've informed
    // the guard and obtained consent, not the guard's own click. ALTER (not
    // baked into the CREATE above) because agency_staff already has live
    // rows from this session's own testing before this column existed.
    await pgPool.query("ALTER TABLE agency_staff ADD COLUMN IF NOT EXISTS consent_credit_check BOOLEAN NOT NULL DEFAULT FALSE");
    await pgPool.query("ALTER TABLE agency_staff ADD COLUMN IF NOT EXISTS consent_social_media_check BOOLEAN NOT NULL DEFAULT FALSE");
    // SIA/CSCS expiry — added later than dbs_expiry (2026-08-20), and unlike
    // it, both are unconditionally mandatory for every guard regardless of
    // badge_type (user's explicit decision: badge_type stays as an
    // informational field — a guard can hold CCTV/Close Protection/other
    // badges too — it no longer gates which certs are required). dbs_expiry
    // itself became optional in the same change; see calculateComplianceStatus.
    await pgPool.query("ALTER TABLE agency_staff ADD COLUMN IF NOT EXISTS sia_expiry DATE");
    await pgPool.query("ALTER TABLE agency_staff ADD COLUMN IF NOT EXISTS cscs_expiry DATE");
    // Credit/social-media check results — admin uploads after reviewing
    // externally, visibility defaults hidden. "Visible" here means visible
    // to the AGENCY (their admin portal), not the guard — guards never see
    // their own agency_staff record at all, they have no login.
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS agency_staff_documents (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agency_staff_id  UUID NOT NULL REFERENCES agency_staff(id) ON DELETE CASCADE,
        doc_type         TEXT NOT NULL,
        filename         TEXT NOT NULL,
        uploaded_by      UUID NOT NULL REFERENCES users(id),
        uploaded_at      TIMESTAMPTZ DEFAULT NOW(),
        visible_to_agency BOOLEAN NOT NULL DEFAULT FALSE,
        UNIQUE (agency_staff_id, doc_type)
      )
    `);
  } catch (e) {
    console.error('[DB] agencies schema migration failed:', e.message);
  }
})();

// Agency Staff: unlimited custom-labeled certificates, separate from the
// fixed 5 types in ALLOWED_AGENCY_DOC_TYPES (defined further down with the
// certificate document routes) — that design is a column-per-type on
// agency_staff itself and can't take arbitrary new labels, hence a proper
// child table instead. Awaits agenciesSchemaReady (not fire-and-forget) for
// the exact same reason spelled out in the comment above ensureAgenciesSchema:
// agency_staff_custom_documents.agency_staff_id FKs into agency_staff, which
// is created inside that IIFE, so an independent unawaited IIFE here could
// race it.
(async function ensureAgencyStaffCustomDocumentsSchema() {
  try {
    await agenciesSchemaReady; // agency_staff_custom_documents.agency_staff_id FKs into agency_staff
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS agency_staff_custom_documents (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agency_staff_id  UUID NOT NULL REFERENCES agency_staff(id) ON DELETE CASCADE,
        label            TEXT NOT NULL,
        filename         TEXT NOT NULL,
        uploaded_by      UUID NOT NULL REFERENCES users(id),
        uploaded_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_agency_staff_custom_docs_staff ON agency_staff_custom_documents(agency_staff_id)");
  } catch (e) {
    console.error('[DB] agency staff custom documents schema migration failed:', e.message);
  }
})();

// Deployment Sites — migrated off deployment-sites.json (JSON→Postgres
// migration, phase 1 of 3: Sites/Vehicles/Staff). id stays TEXT and preserves
// the pre-migration Date.now().toString() value on purpose: agency_deployments
// .site_id and event_instructions.site_id (both TEXT, defined below) already
// hold these exact string values with no FK — minting fresh UUIDs here would
// mean remapping both of those plus every staff record's currentSite for zero
// functional benefit at this scale. welfare_items/assigned_staff are real
// child tables, not JSONB columns, for the same "no hidden blob" reasoning as
// message_attachments/incident_attachments elsewhere in this file.
// site_staff_assignments deliberately stores the legacy staff-JSON id
// (employee_legacy_id), not a resolved employees.id UUID — Staff hasn't been
// migrated yet (that's phase 3), and not every staff member is guaranteed an
// employees row yet either, so this avoids a Sites-phase assignment silently
// failing because of a Staff-phase timing issue. Upgrade to a real FK once
// Staff migration lands and every legacy_id is guaranteed resolvable.
var sitesSchemaReady = (async function ensureSitesSchema() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id                TEXT PRIMARY KEY,
        name              TEXT NOT NULL,
        type              TEXT NOT NULL DEFAULT 'other',
        client_name       TEXT NOT NULL DEFAULT '',
        client_phone      TEXT NOT NULL DEFAULT '',
        client_email      TEXT NOT NULL DEFAULT '',
        address           TEXT NOT NULL DEFAULT '',
        supervisor_name   TEXT NOT NULL DEFAULT '',
        supervisor_phone  TEXT NOT NULL DEFAULT '',
        supervisor_email  TEXT NOT NULL DEFAULT '',
        status            TEXT NOT NULL DEFAULT 'active',
        notes             TEXT NOT NULL DEFAULT '',
        created_at        TIMESTAMPTZ DEFAULT NOW(),
        updated_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS site_documents (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        site_id       TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        filename      TEXT NOT NULL,
        original_name TEXT NOT NULL,
        category      TEXT,
        size_bytes    INTEGER,
        uploaded_at   TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (site_id, filename)
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_site_documents_site ON site_documents(site_id)");
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS site_welfare_items (
        id            TEXT PRIMARY KEY,
        site_id       TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        quantity      INTEGER NOT NULL DEFAULT 1,
        condition     TEXT NOT NULL DEFAULT 'good',
        serial_number TEXT NOT NULL DEFAULT '',
        notes         TEXT NOT NULL DEFAULT '',
        image_ext     TEXT NOT NULL DEFAULT '',
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_site_welfare_site ON site_welfare_items(site_id)");
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS site_staff_assignments (
        site_id            TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        employee_legacy_id TEXT NOT NULL,
        assigned_at        TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (site_id, employee_legacy_id)
      )
    `);
  } catch (e) {
    console.error('[DB] sites schema migration failed:', e.message);
  }
})();

// Agency deployments (site bookings) and their attendance/notes children.
// site_id stays TEXT (no FK yet) even though `sites` now exists in Postgres —
// adding the FK here would fail on every boot until the one-time sites
// migration script has actually populated `sites` from deployment-sites.json,
// since this table's existing live rows already hold those string ids. Once
// the migration has run, a separate follow-up ALTER (checked against
// pg_constraint, same idiom as staff_messages_one_party) adds the real FK.
// Captured as a promise too — ensureEventInstructionsSchema's acknowledgment_forms
// table FKs into agency_deployments created here.
var deploymentsSchemaReady = (async function ensureDeploymentsSchema() {
  try {
    await agenciesSchemaReady; // agency_deployments.agency_id FKs into agencies
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS agency_deployments (
        id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agency_id              UUID NOT NULL REFERENCES agencies(id),
        site_id                TEXT NOT NULL,
        event_date             DATE NOT NULL,

        agency_acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
        agency_acknowledged_by TEXT,
        agency_acknowledged_at TIMESTAMPTZ,

        status                 VARCHAR(20) NOT NULL DEFAULT 'scheduled',
        created_at             TIMESTAMPTZ DEFAULT NOW(),
        updated_at             TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Manually-typed names, not tied to whoever happens to be logged in —
    // the user specifically wants free text here, e.g. a manager's name
    // relayed over the phone, not a lookup against the users table.
    await pgPool.query("ALTER TABLE agency_deployments ADD COLUMN IF NOT EXISTS informed_by TEXT");
    await pgPool.query("ALTER TABLE agency_deployments ADD COLUMN IF NOT EXISTS approved_by TEXT");
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_deployments_agency ON agency_deployments(agency_id)");
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_deployments_site_date ON agency_deployments(site_id, event_date)");

    // Replaces a v1 draft's `staff_assignments JSONB` — one row per guard per
    // deployment so per-guard reporting (no-shows, hours) is a plain query
    // instead of unpacking a JSON blob on every deployment row. Also where
    // attendance confirmation lives (debug note #11).
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS deployment_attendance (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        deployment_id    UUID NOT NULL REFERENCES agency_deployments(id) ON DELETE CASCADE,
        agency_staff_id  UUID NOT NULL REFERENCES agency_staff(id),
        scheduled_hours  NUMERIC(5,2) NOT NULL,

        attended         BOOLEAN,
        actual_hours     NUMERIC(5,2),
        confirmed_by     UUID REFERENCES users(id),
        confirmed_at     TIMESTAMPTZ,

        UNIQUE (deployment_id, agency_staff_id)
      )
    `);
    // Shift times, e.g. "10:00" to "18:00" on the deployment's single
    // event_date — the user wants a start/end clock time entered directly,
    // not a raw hours count. scheduled_hours is kept (existing attendance/
    // reporting code already reads it) and is now DERIVED from these two on
    // insert, rather than being the thing typed in directly.
    await pgPool.query("ALTER TABLE deployment_attendance ADD COLUMN IF NOT EXISTS start_time TEXT");
    await pgPool.query("ALTER TABLE deployment_attendance ADD COLUMN IF NOT EXISTS end_time TEXT");
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_attendance_deployment ON deployment_attendance(deployment_id)");
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_attendance_staff ON deployment_attendance(agency_staff_id)");

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS deployment_notes (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        deployment_id  UUID NOT NULL REFERENCES agency_deployments(id) ON DELETE CASCADE,
        author_id      UUID NOT NULL REFERENCES users(id),
        note           TEXT NOT NULL,
        created_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_notes_deployment ON deployment_notes(deployment_id)");
  } catch (e) {
    console.error('[DB] deployments schema migration failed:', e.message);
  }
})();

// Messaging — extends staff_messages to carry agency-owned threads instead of
// forking a parallel table/route set (debug note #5). employee_id becomes
// nullable, agency_id is the new alternate owner column, and a CHECK keeps
// exactly one of the two set per row. Each statement is idempotent on its
// own (ALTER ... DROP NOT NULL and ADD COLUMN IF NOT EXISTS are no-ops on a
// re-run); the constraint isn't naturally idempotent, so its existence is
// checked first, same "look before you write" idiom as this file already
// uses for seeding DEFAULT_ROLES via ON CONFLICT DO NOTHING.
(async function ensureAgencyMessagingSchema() {
  try {
    await agenciesSchemaReady; // staff_messages.agency_id FKs into agencies
    await pgPool.query("ALTER TABLE staff_messages ALTER COLUMN employee_id DROP NOT NULL");
    await pgPool.query("ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE CASCADE");
    var existing = await pgPool.query("SELECT 1 FROM pg_constraint WHERE conname = 'staff_messages_one_party'");
    if (!existing.rows.length) {
      await pgPool.query(`
        ALTER TABLE staff_messages ADD CONSTRAINT staff_messages_one_party CHECK (
          (employee_id IS NOT NULL AND agency_id IS NULL) OR
          (employee_id IS NULL AND agency_id IS NOT NULL)
        )
      `);
    }
  } catch (e) {
    console.error('[DB] agency messaging schema migration failed:', e.message);
  }
})();

// Feature 2: event instructions + the single consolidated acknowledgment
// table. acknowledgment_forms deliberately replaces two conflicting v1
// designs (separate agency_acknowledgment_forms / acknowledgment_form_responses
// tables) with one polymorphic table (debug notes #3 and #4): respondent_type
// picks which id space respondent_id lives in — agency_staff.id or
// employees.legacy_id — resolved at the app layer, never a real FK, same
// reasoning as site_id (debug note #1).
// Captured as a promise (not fire-and-forget) so the FK-backfill IIFE just
// below can await it — see ensureSiteForeignKeysSchema.
var eventInstructionsSchemaReady = (async function ensureEventInstructionsSchema() {
  try {
    await deploymentsSchemaReady; // acknowledgment_forms.deployment_id FKs into agency_deployments (this also transitively waits on agencies)
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS event_instructions (
        id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        site_id            TEXT,
        event_date         DATE,
        title              VARCHAR(255) NOT NULL,
        instructions_html  TEXT,
        requirements       JSONB,
        document_file_url  VARCHAR(500),
        document_mime_type VARCHAR(100),
        created_by         UUID NOT NULL REFERENCES users(id),
        created_at         TIMESTAMPTZ DEFAULT NOW(),
        version            INT NOT NULL DEFAULT 1,
        status             VARCHAR(20) NOT NULL DEFAULT 'draft'
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_event_instructions_site ON event_instructions(site_id)");

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS acknowledgment_forms (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

        instruction_id       UUID NOT NULL REFERENCES event_instructions(id),
        instruction_version  INT NOT NULL,
        deployment_id        UUID REFERENCES agency_deployments(id),

        respondent_type          VARCHAR(20) NOT NULL CHECK (respondent_type IN ('agency_staff', 'employee')),
        respondent_id            TEXT NOT NULL,
        respondent_name_snapshot VARCHAR(255),

        form_token      VARCHAR(64) UNIQUE NOT NULL,
        link_expires_at TIMESTAMPTZ NOT NULL,

        form_opened_at        TIMESTAMPTZ,
        form_read_at          TIMESTAMPTZ,
        read_duration_seconds INT,
        current_step          INT NOT NULL DEFAULT 0,

        signed_at      TIMESTAMPTZ,
        signer_name    VARCHAR(255),
        signature_data TEXT,

        ip_address VARCHAR(50),
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_ack_forms_token ON acknowledgment_forms(form_token)");
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_ack_forms_instruction ON acknowledgment_forms(instruction_id, respondent_type, respondent_id)");

    // Widen respondent_type from ('agency_staff','employee') to also allow
    // 'driver' and 'manager' audience types (Stage 2). The constraint's real
    // name is looked up rather than assumed (Postgres's default auto-name
    // would be acknowledgment_forms_respondent_type_check, but that's not
    // guaranteed) — same "check before you write" idiom as
    // staff_messages_one_party above, adapted because this constraint already
    // exists under some name from the CREATE TABLE above rather than being
    // absent entirely.
    var respondentTypeConstraint = await pgPool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'acknowledgment_forms'::regclass AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%respondent_type%'`
    );
    if (respondentTypeConstraint.rows.length && respondentTypeConstraint.rows[0].def.indexOf('driver') === -1) {
      var conname = respondentTypeConstraint.rows[0].conname;
      await pgPool.query('ALTER TABLE acknowledgment_forms DROP CONSTRAINT ' + conname);
      await pgPool.query(
        'ALTER TABLE acknowledgment_forms ADD CONSTRAINT ' + conname +
        " CHECK (respondent_type IN ('agency_staff', 'employee', 'driver', 'manager'))"
      );
    }
  } catch (e) {
    console.error('[DB] event instructions / acknowledgment schema migration failed:', e.message);
  }
})();

// Adds the real FK from agency_deployments.site_id / event_instructions.site_id
// to sites(id) now that `sites` actually exists in Postgres — deliberately
// NOT baked into ensureDeploymentsSchema/ensureEventInstructionsSchema's own
// CREATE TABLE, because those tables already have live rows on Asrar's
// database from before `sites` existed, and the one-time migrate-sites.js
// script needs to have populated `sites` from deployment-sites.json first or
// this ALTER fails (any site_id value with no matching sites row blocks the
// constraint). Safe to fail: this IIFE re-runs on every boot and simply
// succeeds once the migration script has been run and every existing
// site_id value resolves — same "self-healing, safe to retry" idiom as every
// other schema IIFE in this file, just tolerant of failing for a while.
(async function ensureSiteForeignKeysSchema() {
  try {
    await sitesSchemaReady;
    await deploymentsSchemaReady;
    await eventInstructionsSchemaReady;

    var depFk = await pgPool.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'agency_deployments_site_id_fkey'`
    );
    if (!depFk.rows.length) {
      await pgPool.query(
        'ALTER TABLE agency_deployments ADD CONSTRAINT agency_deployments_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id)'
      );
    }

    var eiFk = await pgPool.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'event_instructions_site_id_fkey'`
    );
    if (!eiFk.rows.length) {
      await pgPool.query(
        'ALTER TABLE event_instructions ADD CONSTRAINT event_instructions_site_id_fkey FOREIGN KEY (site_id) REFERENCES sites(id)'
      );
    }
  } catch (e) {
    // Expected to fail-and-retry-next-boot until migrate-sites.js has run —
    // not logged as an error at the same severity as a genuine schema bug.
    console.log('[DB] site foreign keys not added yet (will retry next boot):', e.message);
  }
})();

// Vehicles/Fleet — JSON→Postgres migration, phase 2 of 3 (see ensureSitesSchema
// above for phase 1). Unlike sites, `vehicles`/`vehicle_compliance`/
// `vehicle_assignments`/`driver_compliance` already existed on Asrar's live
// database from schema-phase3.sql — created, empty, never read/written by any
// route until now. This ALTERs the existing table rather than re-CREATEing
// it. legacy_id bridges the old vehicles.json Date.now().toString() id —
// unlike sites, nothing outside vehicles.json itself referenced a vehicle id
// as a live Postgres column, so vehicles get a fresh UUID (the dormant
// table was already UUID-typed; legacy_id is just for traceability + the
// one-time migration's photo/doc-folder rename). mot/insurance/road_tax/
// service dates live in vehicle_compliance (one row per document_type,
// already designed for exactly this); driver assignment lives in
// vehicle_assignments (already designed with assigned_date/unassigned_date,
// richer than the old flat assignedDriverId field — an "open" assignment is
// unassigned_date IS NULL). has_photo is deliberately NOT a stored column —
// it was never authoritative pre-migration either (the photo-serving route
// always re-checked the filesystem via findVehiclePhoto() regardless of the
// flag), so it stays computed live from disk, same as before.
(async function ensureVehiclesExtendedSchema() {
  try {
    await pgPool.query("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS legacy_id TEXT UNIQUE");
    await pgPool.query("ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS mileage INTEGER");
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS vehicle_documents (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        vehicle_id    UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        filename      TEXT NOT NULL,
        original_name TEXT NOT NULL,
        doc_type      TEXT,
        size_bytes    INTEGER,
        uploaded_at   TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (vehicle_id, filename)
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_vehicle_documents_vehicle ON vehicle_documents(vehicle_id)");
  } catch (e) {
    console.error('[DB] vehicles extended-schema migration failed:', e.message);
  }
})();

// Feature 3: custom forms builder. fields is a JSONB array of FormField
// objects (plan 3.3); a field MAY carry a `profile_field` mapping target
// when auto_map_to_profile is true — validated against an allowlist at
// create/update time (3.5 Governance Fix) so a form can never be built that
// writes into an arbitrary/ungoverned field name. respondent_id on responses
// is TEXT with no FK — same "resolved at the app layer" reasoning as
// site_id/respondent_id throughout this plan (debug note #1).
(async function ensureCustomFormsSchema() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS custom_forms (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name                  VARCHAR(255) NOT NULL,
        description           TEXT,
        form_type             VARCHAR(20) NOT NULL,
        fields                JSONB NOT NULL,
        linked_to_entity_type VARCHAR(50),
        linked_to_entity_id   TEXT,
        created_by            UUID NOT NULL REFERENCES users(id),
        created_at            TIMESTAMPTZ DEFAULT NOW(),
        updated_at            TIMESTAMPTZ DEFAULT NOW(),
        is_published           BOOLEAN NOT NULL DEFAULT FALSE,
        auto_map_to_profile    BOOLEAN NOT NULL DEFAULT FALSE,
        version                INT NOT NULL DEFAULT 1
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_custom_forms_type ON custom_forms(form_type)");
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_custom_forms_linked ON custom_forms(linked_to_entity_type, linked_to_entity_id)");

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS custom_form_responses (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        form_id         UUID NOT NULL REFERENCES custom_forms(id),
        respondent_type VARCHAR(20),
        respondent_id   TEXT,
        response_data   JSONB NOT NULL,
        submitted_at    TIMESTAMPTZ,
        ip_address      VARCHAR(50),
        status          VARCHAR(20) NOT NULL DEFAULT 'submitted'
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_custom_form_responses_form ON custom_form_responses(form_id)");
  } catch (e) {
    console.error('[DB] custom forms schema migration failed:', e.message);
  }
})();

// Staff — JSON→Postgres migration, phase 3 of 3 (see ensureSitesSchema /
// ensureVehiclesExtendedSchema above for phases 1-2; this is the big one).
//
// Design: `employees` (already exists, was a bridge table with only a
// handful of columns wired up) gets a `profile_data JSONB` column holding
// almost everything else, plus a handful of new promoted scalar columns for
// fields with a genuinely stable, simple shape. This deliberately does NOT
// try to force data into the five dormant Phase-1 tables (employee_private/
// employee_addresses/compliance_documents/staff_references/employment_history)
// — confirmed by reading their actual column shapes against the real current
// staff record shape (from frontend/src/types/staff.ts + a real on-disk
// staff_data.json) that they were designed against an older, simpler shape
// than what the 12-phase onboarding wizard now produces (e.g.
// employee_private.criminal_offences VARCHAR(10) cannot hold criminalHistory[]
// — an array of rich objects with offense type/court/sentence/details; three
// DIFFERENT real shape variants coexist in production staff_data.json files
// today — old flat legacy records, an MS-Forms-inbox importer shape, and the
// full modern wizard shape — and nothing in this app ever queries into any
// of this via SQL, only ever reads/writes it as a whole JS object via
// loadAllStaff()/saveStaff()). JSONB preserves all three variants as-is, with
// zero forced renaming/normalization, which is the same "store whatever's
// there" tolerance the JSON-file era already had.
//
// current_site_id is deliberately TEXT with no FK yet — some staff records'
// currentSite may not resolve to a real sites.id (blank/stale/pre-Sites-
// migration drift), and a hard FK would fail every boot until that's been
// verified clean, same as ensureSiteForeignKeysSchema's reasoning elsewhere.
// Captured as a promise (not fire-and-forget) — the startup sequence at the
// bottom of this file awaits it before populating STAFF_CACHE, so
// refreshStaffCacheFull()'s `SELECT *` is guaranteed to see every column.
var employeesExtendedSchemaReady = (async function ensureEmployeesExtendedSchema() {
  try {
    await sitesSchemaReady; // not FK'd yet, but this order keeps intent clear
    await pgPool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS job_role TEXT");
    await pgPool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS current_site_id TEXT");
    await pgPool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS wizard_draft JSONB");
    await pgPool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS pending_submission JSONB");
    await pgPool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS rejection_reason TEXT");
    await pgPool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ");
    // archive_reason: 'left_employment' | 'duplicate_record', null for pre-migration ex-staff (no real archive date on file — see migrate-staff.js)
    await pgPool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS archive_reason TEXT");
    await pgPool.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS profile_data JSONB NOT NULL DEFAULT '{}'::jsonb");

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS staff_documents (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        doc_category      TEXT NOT NULL,   -- 'document' | 'training' | 'photo'
        doc_key           TEXT NOT NULL,
        doc_subtype       TEXT,            -- proofOfAddress1/2's docType; null otherwise
        filename          TEXT NOT NULL,
        original_name     TEXT NOT NULL,
        mime_type         TEXT,
        size_bytes        INTEGER,
        visible_to_staff  BOOLEAN NOT NULL DEFAULT TRUE,
        uploaded_at       TIMESTAMPTZ DEFAULT NOW(),
        uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
        UNIQUE (employee_id, doc_category, doc_key)
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_staff_documents_employee ON staff_documents(employee_id)");
  } catch (e) {
    console.error('[DB] employees extended-schema migration failed:', e.message);
  }
})();

// Content-moderation for incident reports, WITHOUT ever touching anonymity.
// A director can flag a report's CONTENT as inappropriate (e.g. abusive
// language used in an anonymous submission) to remove it from the normal
// management queue — this only ever operates on the report row itself, never
// on reporter_id/is_anonymous, so an anonymous submitter's identity is never
// exposed by this mechanism under any circumstance. Deliberately NOT a
// "reveal who submitted this" feature — that was considered and rejected:
// it would defeat the anonymity guarantee the reporting channel depends on
// (whistleblower protection), and creates a conflict-of-interest risk if the
// person deciding what counts as "abusive" could ever be the report's
// subject. Flagged reports are never deleted (same "no hard delete" policy
// as the rest of this app) — just excluded from the default list.
(async function ensureIncidentReportModerationSchema() {
  try {
    await pgPool.query("ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS flagged_inappropriate BOOLEAN NOT NULL DEFAULT FALSE");
    await pgPool.query("ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMPTZ");
    await pgPool.query("ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS flagged_by UUID REFERENCES users(id) ON DELETE SET NULL");
    await pgPool.query("ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS flagged_reason TEXT");
  } catch (e) {
    console.error('[DB] incident report moderation schema migration failed:', e.message);
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

// ── NOTIFICATION VISIBILITY (who may see which bell/push alert) ──────────────
// Every notification type used to go to everyone holding `staff`. Compliance
// calendar reminders are personal: they go only to the person(s) named in the
// item's responsible_email (the reminder summary ends with ' — email, email'),
// and only if their role also has the compliance_calendar module.
// An item with NO responsible person has nobody to target, so it falls back to
// everyone holding the module (the managers) rather than vanishing.
var COMPANY_EMAIL_DOMAINS = ['firstcallsiteservices.co.uk', 'guardtec-security.co.uk', 'principalsecurityconsultants.com'];

function splitEmails(s) {
  return String(s || '').toLowerCase().split(/[,;\s]+/).filter(Boolean);
}

// Two addresses are the same mailbox if identical, or if they have the same
// name part and both are company domains (the staff roster has a primary
// @firstcallsiteservices address plus an @guardtec-security alias for the same person).
function sameMailbox(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  var ap = a.split('@'), bp = b.split('@');
  return ap.length === 2 && bp.length === 2 && ap[0] === bp[0] &&
    COMPANY_EMAIL_DOMAINS.indexOf(ap[1]) !== -1 && COMPANY_EMAIL_DOMAINS.indexOf(bp[1]) !== -1;
}

function calendarTargetsFromSummary(summary) {
  var s = String(summary || '');
  var i = s.lastIndexOf(' — ');
  return i === -1 ? '' : s.slice(i + 3);
}

// row = { type, summary }; viewer = { email, hasCalendarModule }
function canViewNotification(row, viewer) {
  if (row.type !== 'compliance_calendar_reminder') return true;
  if (!viewer.hasCalendarModule) return false;
  var targets = splitEmails(calendarTargetsFromSummary(row.summary));
  if (!targets.length) return true;
  var mine = String(viewer.email || '').toLowerCase();
  return targets.some(function(t) { return sameMailbox(t, mine); });
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


const HOME        = process.env.USERPROFILE || ('C:\\Users\\' + require('os').userInfo().username);
const BASE        = process.env.DATA_PATH || path.join(HOME, "First Call Site Services", "FCSS - Managers", "HR and Legal", "Asrar", "GuardTec Compliance");
const ACTIVE_DIR  = path.join(BASE, "02 - Vetting & Screening", "Active Staff");
const OVERVIEW    = path.join(BASE, "02 - Vetting & Screening", "GUARDTEC — COMPLIANCE OVERVIEW.html");
const SPREADSHEET = process.env.DATA_PATH ? path.join(process.env.DATA_PATH, "01 - Staff Compliance Tracker", "GuardTec Security — Staff Compliance Tracker.xlsx") : path.join(HOME, "OneDrive - First Call Site Services", "TOTAL EMPLOYEE spreadsheet.xlsl.xlsx");
const SHAREPOINT_DASHBOARD = path.join(BASE, "! GuardTec Compliance Dashboard.html");
const SITES_FILE           = path.join(BASE, "deployment-sites.json");
const SITE_DOCS_DIR        = path.join(BASE, "site-documents");
// Deleted site documents are MOVED here (not unlinked) so a Director can restore
// them for RECYCLE_RETENTION_DAYS. Same data volume as everything else, so it
// survives container rebuilds; nothing in here is ever served statically.
const RECYCLE_DIR          = path.join(BASE, "recycle-bin", "site-documents");
const RECYCLE_RETENTION_DAYS = 30;
if (!fs.existsSync(SITE_DOCS_DIR)) fs.mkdirSync(SITE_DOCS_DIR, { recursive: true });

const SUBFOLDERS = ['01 - SIA Licence','02 - CSCS Card','03 - Right to Work & Visa','04 - References','05 - Employment Contract','06 - Training & Induction'];
function getTodayStr() { return new Date().toISOString().split('T')[0]; }

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

// ── PROFILE PHOTO ─────────────────────────────────────────────────────────────
function findFileByExts(dir, prefix) {
  var exts = ['.jpg', '.jpeg', '.png', '.webp'];
  for (var e of exts) {
    var p = path.join(dir, prefix + e);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── STAFF DOCUMENTS (Postgres-backed) ────────────────────────────────────────
// Replaces the old per-person-folder document/photo/training-cert storage
// (doc_<key>.ext, doc_training_<key>.ext, profile.ext, pending-profile.ext).
// One flat directory per employee UUID; staff_documents is the single source
// of truth for both "does this file exist" and its metadata — the two were
// separate, unguarded fs writes before (see ensureEmployeesExtendedSchema
// comment), which could already silently desync.
var STAFF_DOCS_DIR = path.join(BASE, 'staff-documents');
if (!fs.existsSync(STAFF_DOCS_DIR)) fs.mkdirSync(STAFF_DOCS_DIR, { recursive: true });

function staffDocDir(employeeId) {
  var dir = path.join(STAFF_DOCS_DIR, employeeId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function detectExtFromBuffer(buf, fallback) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return '.jpg';
  return fallback || '.pdf';
}

// Removes any existing file for this slot regardless of extension, writes
// the new one, and upserts the metadata row — one function so a route can
// never do the file write without the DB write (or vice versa).
async function saveStaffDocFile(employeeId, category, key, buf, ext, opts) {
  opts = opts || {};
  var dir = staffDocDir(employeeId);
  ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
    var old = path.join(dir, category + '_' + key + e);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  });
  var filename = category + '_' + key + ext;
  fs.writeFileSync(path.join(dir, filename), buf);
  await pgPool.query(
    `INSERT INTO staff_documents (employee_id, doc_category, doc_key, doc_subtype, filename, original_name, size_bytes, visible_to_staff, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (employee_id, doc_category, doc_key) DO UPDATE SET
       doc_subtype=$4, filename=$5, original_name=$6, size_bytes=$7, visible_to_staff=$8, uploaded_by=$9, uploaded_at=NOW()`,
    [employeeId, category, key, opts.subtype || null, filename, opts.originalName || filename,
     buf.length, opts.visibleToStaff !== undefined ? opts.visibleToStaff : true, opts.uploadedBy || null]
  );
  await refreshStaffCacheEntry(employeeId);
}

// Uploaded by management only, and hidden from the staff member by default —
// unlike every other doc key above (self-uploaded, or manager-uploaded but
// always visible, e.g. assignmentInstructions), visibility here is an
// explicit per-document manager choice stored as documents[key].visibleToStaff.
var MANAGER_ONLY_DOC_KEYS = ['creditCheckReport', 'socialMediaCheckReport', 'driverTachoCard', 'driverDbsCheck', 'driverAssessmentReport'];

// ── USER (ACCOUNT) PROFILE PHOTOS ────────────────────────────────────────────
// One photo per logged-in account (stored by postgres user id, not staff id).
// Works for every role — director, manager, staff — anyone with a login.
var USER_PHOTOS_DIR = path.join(BASE, 'user-photos');
if (!fs.existsSync(USER_PHOTOS_DIR)) fs.mkdirSync(USER_PHOTOS_DIR, { recursive: true });

function findUserPhoto(userId) { return findFileByExts(USER_PHOTOS_DIR, String(userId)); }

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
// Office-based login roles never deployed as a guard — SIA/CSCS/training
// aren't relevant to their job, so they're exempt from those compliance
// checks (Asrar's explicit decision, 2026-08-28). Supervisor is deliberately
// NOT in this list — not confirmed exempt, may still do guard-facing work.
var OFFICE_ROLES_EXEMPT_FROM_SIA_CSCS = ['director', 'ops_manager', 'hr_manager', 'office_manager', 'accounts', 'media', 'fleet_manager'];

function calcOverall(emp) {
  var exempt = OFFICE_ROLES_EXEMPT_FROM_SIA_CSCS.indexOf(emp.linkedRole) !== -1;
  var s = [];
  // SIA Licence — required, missing = action required (unless office-exempt)
  if (exempt) {
    s.push('green');
  } else if (!emp.sia || !emp.sia.number) {
    s.push('amber');
  } else {
    s.push(statusOf(daysFrom(emp.sia.expiry)));
  }
  // CSCS Card — required, missing or pending = action required (unless office-exempt)
  if (exempt) {
    s.push('green');
  } else if (!emp.cscs || !emp.cscs.number) {
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

// emp._nameSuffix disambiguates two DIFFERENT people who happen to share a
// name (see nextFreeNameSuffix below) — it only ever affects storage
// (folder name / id), never the displayed emp.name, so two "John Smith"s
// each keep their real name everywhere in the UI while living in separate
// folders on disk.
function folderForEmp(emp) {
  return path.join(ACTIVE_DIR, overallEmoji(emp.overall) + ' ' + safeName(emp.name) + (emp._nameSuffix || ''));
}

function cleanFolderName(d) {
  return d.replace(/^[^\p{L}A-Za-z]+/u, '').trim().toUpperCase();
}

// Finds the lowest " (2)", " (3)"... suffix not already taken by an
// existing Active Staff folder whose cleaned name matches. Used when an
// admin explicitly confirms a same-name "Add Staff" submission is a
// genuinely different person, not the duplicate-creation mistake the
// collision check normally exists to catch.
function nextFreeNameSuffix(name) {
  var base = safeName(name).toUpperCase();
  for (var n = 2; ; n++) {
    var target = base + ' (' + n + ')';
    var taken = fs.existsSync(ACTIVE_DIR) && fs.readdirSync(ACTIVE_DIR).some(function(d) {
      return cleanFolderName(d) === target;
    });
    if (!taken) return n;
  }
}

// ── STAFF: POSTGRES-BACKED, IN-MEMORY-CACHED ──────────────────────────────────
// loadAllStaff()/saveStaff() are the ONLY two functions most of this file's
// ~50 call sites need to know about. loadAllStaff() stays SYNCHRONOUS —
// reading from STAFF_CACHE rather than awaiting Postgres — specifically so
// none of those ~50 call sites (messaging, incident reports, disciplinary
// records, custom forms, compliance alerts, dashboard stats, Excel/HTML
// reports, the onboarding wizard) need converting to async. This is safe
// because: the whole roster is small (tens to low hundreds of people), this
// app runs as a single Node process (see docker-compose.yml — no horizontal
// scaling), and nothing outside this process writes to `employees`/
// `staff_documents` except the one-time migrate-staff.js (run with the app
// stopped). saveStaff() itself, and the document/photo/training-cert upload
// routes below (which bypass saveStaff() entirely, same as they bypassed it
// pre-migration), are the only writers, and each refreshes the one affected
// cache entry immediately after its own write — so the cache is never stale
// for longer than one request.
var STAFF_CACHE = [];

// Fields that are real Postgres columns (or purely computed/retired) and
// must never be copied into profile_data — kept in one place so saveStaff()
// and the migration script apply the exact same rule.
var STAFF_STRIP_FIELDS = ['id','name','email','phone','phoneLandline','dateOfBirth','dob','placeOfBirth',
  'nationality','gender','drivingLicence','deployStatus','currentSite','contract','induction','addedDate',
  'status','jobRole','wizard_draft','pending_submission','rejection_reason','overall','linkedRole','_folderPath',
  '_nameSuffix','_pgId','documents','archived_at','archive_reason'];

// Rebuilds the flat `emp` object shape every existing call site already
// expects, from a Postgres `employees` row + that employee's `staff_documents`
// rows. Order matters: profile_data first (the base), then real columns
// (only where non-null, so an absent key stays absent rather than becoming
// a stored `null` — many call sites do `if (emp.rejectionReason)`-style
// falsy checks), then computed fields last.
// node-postgres parses a DATE column into a JS Date object by default (not
// a string) — String(dateObj) calls .toString() ("Tue May 15 1990..."), not
// .toISOString(), so a naive .slice(0,10) silently truncates to "Tue May 15"
// instead of "1990-05-15" (found via live testing — see date_of_birth below).
// Handles both cases defensively since some callers may pass an already-ISO
// string (e.g. from migrate-staff.js's own inserted values on re-read).
function pgDateToStr(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function reconstructEmp(row, docRows, linkedRole) {
  var flat = Object.assign({}, row.profile_data || {});
  var core = {
    id: row.legacy_id, name: row.name, email: row.email, phone: row.phone,
    phoneLandline: row.phone_landline,
    dateOfBirth: pgDateToStr(row.date_of_birth),
    dob: pgDateToStr(row.date_of_birth),
    placeOfBirth: row.place_of_birth, nationality: row.nationality, gender: row.gender,
    drivingLicence: row.driving_licence, status: row.status, deployStatus: row.deploy_status,
    contract: row.contract, induction: row.induction,
    addedDate: pgDateToStr(row.added_date),
    jobRole: row.job_role, currentSite: row.current_site_id,
    wizard_draft: row.wizard_draft, pending_submission: row.pending_submission,
    rejection_reason: row.rejection_reason,
  };
  Object.keys(core).forEach(function(k) {
    if (core[k] !== null && core[k] !== undefined) flat[k] = core[k];
  });
  flat._pgId = row.id;
  flat.archived_at = row.archived_at;
  flat.archive_reason = row.archive_reason;
  flat.linkedRole = linkedRole || null;
  applyStaffDocuments(flat, docRows);
  flat.overall = calcOverall(flat);
  return flat;
}

// Merges staff_documents rows back into the documents.{key}.{uploaded,date}
// and training.{key}.{certUploaded,certDate} shape the frontend expects —
// this is the single source of truth for "is this file actually on disk",
// closing a drift class the old system had (it wrote the boolean flag and
// the file as two separate, unguarded fs writes that could already desync).
function applyStaffDocuments(flat, docRows) {
  var documents = {};
  var trainingUpdates = {};
  (docRows || []).forEach(function(d) {
    var dateStr = d.uploaded_at ? new Date(d.uploaded_at).toISOString().slice(0, 10) : null;
    if (d.doc_category === 'document') {
      var entry = { uploaded: true, date: dateStr, visibleToStaff: d.visible_to_staff };
      if (d.doc_subtype) entry.docType = d.doc_subtype;
      documents[d.doc_key] = entry;
    } else if (d.doc_category === 'training') {
      trainingUpdates[d.doc_key] = { certUploaded: true, certDate: dateStr };
    }
  });
  flat.documents = documents;
  var training = Object.assign({}, flat.training);
  Object.keys(trainingUpdates).forEach(function(k) {
    training[k] = Object.assign({}, training[k], trainingUpdates[k]);
  });
  flat.training = training;
}

function deepCloneEmp(e) { return JSON.parse(JSON.stringify(e)); }

async function refreshStaffCacheEntry(employeeId) {
  var r = await pgPool.query('SELECT * FROM employees WHERE id = $1', [employeeId]);
  if (!r.rows.length) {
    STAFF_CACHE = STAFF_CACHE.filter(function(e) { return e._pgId !== employeeId; });
    return;
  }
  var docRows = (await pgPool.query('SELECT * FROM staff_documents WHERE employee_id = $1', [employeeId])).rows;
  var roleRow = await pgPool.query('SELECT role FROM users WHERE staff_id = $1', [r.rows[0].legacy_id]);
  var reconstructed = reconstructEmp(r.rows[0], docRows, roleRow.rows[0] && roleRow.rows[0].role);
  var idx = STAFF_CACHE.findIndex(function(e) { return e._pgId === employeeId; });
  if (idx === -1) STAFF_CACHE.push(reconstructed);
  else STAFF_CACHE[idx] = reconstructed;
}

async function refreshStaffCacheFull() {
  var rows = (await pgPool.query('SELECT * FROM employees')).rows;
  var docsByEmployee = {};
  (await pgPool.query('SELECT * FROM staff_documents')).rows.forEach(function(d) {
    (docsByEmployee[d.employee_id] = docsByEmployee[d.employee_id] || []).push(d);
  });
  var roleByStaffId = {};
  (await pgPool.query("SELECT staff_id, role FROM users WHERE staff_id IS NOT NULL")).rows.forEach(function(u) {
    roleByStaffId[u.staff_id] = u.role;
  });
  STAFF_CACHE = rows.map(function(row) { return reconstructEmp(row, docsByEmployee[row.id] || [], roleByStaffId[row.legacy_id]); });
}

// ── LOAD STAFF ────────────────────────────────────────────────────────────────
// Byte-shape-identical to the old JSON-file version: active staff only
// (Ex-Staff — status='archived' — was always a separate directory this never
// scanned; status='duplicate' from autoDedup() was always invisible to both
// views via the separate "Duplicate Archive" folder, preserved here by
// simply not returning it from either accessor). Deep-cloned on every call,
// same as the old version implicitly was by re-parsing JSON from disk fresh
// each time — so a caller that finds-then-mutates-then-saves never corrupts
// the shared cache if it forgets to save, or the save fails partway.
function loadAllStaff() {
  return STAFF_CACHE.filter(function(e) { return e.status === 'active'; }).map(deepCloneEmp);
}

// ── SAVE STAFF ────────────────────────────────────────────────────────────────
// oldFolderPath is accepted (and ignored) purely so every existing call site
// — saveStaff(emp, emp._folderPath) — keeps working unedited; _folderPath is
// always absent on a Postgres-backed emp object, so it always evaluates to
// undefined at the call site anyway.
async function saveStaff(emp, oldFolderPath) {
  emp.overall = calcOverall(emp);

  var core = {
    name: emp.name || '', email: emp.email || null, phone: emp.phone || null,
    phone_landline: emp.phoneLandline || null,
    date_of_birth: emp.dateOfBirth || emp.dob || null,
    place_of_birth: emp.placeOfBirth || null, nationality: emp.nationality || null,
    gender: emp.gender || null, driving_licence: emp.drivingLicence || null,
    status: emp.status || 'active', deploy_status: emp.deployStatus || 'inactive',
    contract: emp.contract || null, induction: !!emp.induction,
    added_date: emp.addedDate || null, job_role: emp.jobRole || null,
    current_site_id: emp.currentSite || null,
    wizard_draft: emp.wizard_draft ? JSON.stringify(emp.wizard_draft) : null,
    pending_submission: emp.pending_submission ? JSON.stringify(emp.pending_submission) : null,
    rejection_reason: emp.rejection_reason || null,
  };

  var profileData = Object.assign({}, emp);
  STAFF_STRIP_FIELDS.forEach(function(k) { delete profileData[k]; });
  // training.*.certUploaded/certDate are reconstructed from staff_documents
  // at read time (see applyStaffDocuments) — strip them here so a stale copy
  // can never be written back and fight with the real source of truth.
  if (profileData.training) {
    var strippedTraining = {};
    Object.keys(profileData.training).forEach(function(k) {
      var t = profileData.training[k];
      if (t && typeof t === 'object' && !Array.isArray(t)) {
        strippedTraining[k] = Object.assign({}, t);
        delete strippedTraining[k].certUploaded;
        delete strippedTraining[k].certDate;
      } else {
        strippedTraining[k] = t;
      }
    });
    profileData.training = strippedTraining;
  }

  var existing = await pgPool.query('SELECT id FROM employees WHERE legacy_id = $1', [emp.id]);
  var employeeId;
  if (existing.rows.length) {
    employeeId = existing.rows[0].id;
    await pgPool.query(
      `UPDATE employees SET name=$1, email=$2, phone=$3, phone_landline=$4, date_of_birth=$5,
        place_of_birth=$6, nationality=$7, gender=$8, driving_licence=$9, status=$10, deploy_status=$11,
        contract=$12, induction=$13, added_date=$14, job_role=$15, current_site_id=$16,
        wizard_draft=$17, pending_submission=$18, rejection_reason=$19, profile_data=$20, updated_at=NOW()
       WHERE id=$21`,
      [core.name, core.email, core.phone, core.phone_landline, core.date_of_birth, core.place_of_birth,
       core.nationality, core.gender, core.driving_licence, core.status, core.deploy_status, core.contract,
       core.induction, core.added_date, core.job_role, core.current_site_id, core.wizard_draft,
       core.pending_submission, core.rejection_reason, JSON.stringify(profileData), employeeId]
    );
  } else {
    var ins = await pgPool.query(
      `INSERT INTO employees (legacy_id, name, email, phone, phone_landline, date_of_birth, place_of_birth,
         nationality, gender, driving_licence, status, deploy_status, contract, induction, added_date,
         job_role, current_site_id, wizard_draft, pending_submission, rejection_reason, profile_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
      [emp.id, core.name, core.email, core.phone, core.phone_landline, core.date_of_birth, core.place_of_birth,
       core.nationality, core.gender, core.driving_licence, core.status, core.deploy_status, core.contract,
       core.induction, core.added_date, core.job_role, core.current_site_id, core.wizard_draft,
       core.pending_submission, core.rejection_reason, JSON.stringify(profileData)]
    );
    employeeId = ins.rows[0].id;
  }

  await refreshStaffCacheEntry(employeeId);
  return employeeId;
}

// ── DEPLOYMENT SITES ──────────────────────────────────────────────────────────
// Postgres-backed (see ensureSitesSchema above). welfare_items/assigned_staff
// are reconstructed via LEFT JOIN so every route's response shape stays
// byte-identical to the old deployment-sites.json era — SitesPage.tsx reads
// site.welfare_items?.length / site.assigned_staff?.length directly off the
// list response, so those arrays must stay embedded, not dropped.
var SITE_JOIN_SQL =
  "SELECT s.*, " +
  "  COALESCE(w.items, '[]'::json) AS welfare_items, " +
  "  COALESCE(a.ids, '[]'::json) AS assigned_staff " +
  "FROM sites s " +
  "LEFT JOIN ( " +
  "  SELECT site_id, json_agg(json_build_object( " +
  "    'id', id, 'name', name, 'quantity', quantity, 'condition', condition, " +
  "    'serial_number', serial_number, 'notes', notes, 'image_ext', image_ext " +
  "  ) ORDER BY created_at) AS items " +
  "  FROM site_welfare_items GROUP BY site_id " +
  ") w ON w.site_id = s.id " +
  "LEFT JOIN ( " +
  "  SELECT site_id, json_agg(employee_legacy_id ORDER BY assigned_at) AS ids " +
  "  FROM site_staff_assignments GROUP BY site_id " +
  ") a ON a.site_id = s.id";

async function loadSites() {
  var r = await pgPool.query(SITE_JOIN_SQL + " ORDER BY s.created_at");
  return r.rows;
}
async function getSiteById(siteId) {
  var r = await pgPool.query(SITE_JOIN_SQL + " WHERE s.id = $1", [siteId]);
  return r.rows[0] || null;
}

// ── INIT FROM SPREADSHEET ─────────────────────────────────────────────────────
// Only ever fills gaps — never overwrites an existing record of the same
// name (byte-identical semantics to the old fs.existsSync(jp) check, now
// checked against the freshly-populated STAFF_CACHE rather than a fresh
// Postgres query: this runs once, sequentially, at startup right after
// refreshStaffCacheFull(), before the server accepts any traffic, so the
// cache is guaranteed warm and there's no concurrent-write race to guard
// against the way there is for the live POST /api/staff Abu Baker check).
async function initFromSpreadsheet() {
  try {
    var wb = XLSX.readFile(SPREADSHEET);
    var ws = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws,{header:1});
    for (const r of rows.slice(1)) {
      if (!r || !r[0]) continue;
      var name = String(r[0]).trim();
      if (!name) continue;

      // Sanity check: real staff rows always have a real phone number.
      // Legend/summary/caption rows in the spreadsheet (e.g. "COLOUR KEY",
      // "TOTAL STAFF TRACKED") have either a blank phone column or non-numeric
      // text there instead — skip anything that isn't a real phone number so
      // it doesn't get created as a fake staff record on every app restart.
      var phoneDigits = (r[3] ? String(r[3]) : '').replace(/\D/g, '');
      if (phoneDigits.length < 7) continue;

      var already = STAFF_CACHE.some(function(e) { return safeName(e.name).toUpperCase() === safeName(name).toUpperCase(); });
      if (already) continue;

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

      await saveStaff(emp, null);
      console.log('  Init:', name);
    }
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

function sanitizeForStaffView(emp) {
  var copy = Object.assign({}, emp);
  delete copy._folderPath;
  delete copy._pgId;
  // Manager-only docs (credit check, social media check) are stripped
  // entirely from what a staff member's own profile fetch returns unless
  // explicitly marked visibleToStaff — the row shouldn't just be hidden in
  // the UI, the data shouldn't reach their browser at all.
  if (copy.documents) {
    var docs = Object.assign({}, copy.documents);
    MANAGER_ONLY_DOC_KEYS.forEach(function(k) {
      if (docs[k] && docs[k].visibleToStaff !== true) delete docs[k];
    });
    copy.documents = docs;
  }
  return copy;
}

// Fields a staff member can submit via their self-service profile. Shared
// between the pending_submission constructor below and the approve-merge
// allowlist, so a field can never be accepted into pending_submission but
// silently dropped on approval (or vice versa).
var MY_PROFILE_FIELDS = [
  'email', 'phone', 'address', 'emergencyContact', 'sia', 'cscs', 'visa', 'references',
  'bankDetails', 'notes', 'driverLicence',
  'dateOfBirth', 'nationality', 'ni', 'uniqueTaxpayerReference', 'utrNotApplicable', 'previousNames',
  'yearsAtCurrentAddress', 'addressHistory', 'employmentHistoryDetail',
  'otherQualifications', 'hasCriminalHistory', 'criminalHistory',
  'hasCautions', 'cautionsAndInvestigations', 'declarations',
];

// Merges allowed self-service fields into a staff member's pending_submission
// — shared by the self-service /api/my-profile endpoint below and any other
// path that submits staff data through the same manager-approval gate (e.g.
// an auto_map_to_profile custom form, Feature 3 / plan 3.5). One function
// means a field can never be accepted into pending_submission here but
// silently dropped on approval, or vice versa. Does not save — callers save.
function applyPendingProfileFields(emp, fields) {
  var pending = Object.assign({}, emp.pending_submission, { submitted_at: new Date().toISOString() });
  MY_PROFILE_FIELDS.forEach(function(field) {
    if (fields[field] !== undefined) pending[field] = fields[field];
  });
  emp.pending_submission = pending;
  delete emp.rejection_reason;
  return emp;
}

// ── CRM (event-based leads — see crm.js) ──────────────────────────────────────
require('./crm')({ app: app, pgPool: pgPool, requireLogin: requireLogin, requirePermission: requirePermission, logAuditEvent: logAuditEvent, sendXlsx: sendXlsx });

// ── PROCUREMENT (purchase orders + approved suppliers — see procurement.js) ───
require('./procurement')({ app: app, pgPool: pgPool, requireLogin: requireLogin, requirePermission: requirePermission, requireRole: requireRole, logAuditEvent: logAuditEvent, createNotification: createNotification, BASE: BASE, BASE_URL: BASE_URL, rateLimit: rateLimit });

// ── SITE DOCUMENTATION ─────────────────────────────────────────────────────────
// Per-site file library: general documentation, presentations, induction packs.
// Files stay on disk under SITE_DOCS_DIR; site_documents holds only metadata
// (same split as message_attachments/incident_attachments elsewhere in this file).

// ── RECYCLE BIN (site documents) ──────────────────────────────────────────────
// Deleting a site document no longer destroys it: the file moves into RECYCLE_DIR
// and its metadata moves from site_documents into recycle_bin. Director-only
// page/routes below can restore it (back into its site) or delete it for good;
// anything still here after RECYCLE_RETENTION_DAYS is purged automatically.
(async function ensureRecycleBinSchema() {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS recycle_bin (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind              TEXT NOT NULL DEFAULT 'site_document',
        site_id           TEXT NOT NULL,
        site_name         TEXT,
        original_filename TEXT NOT NULL,
        original_name     TEXT NOT NULL,
        category          TEXT,
        size_bytes        INTEGER,
        uploaded_at       TIMESTAMPTZ,
        bin_filename      TEXT NOT NULL UNIQUE,
        deleted_by        TEXT,
        deleted_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pgPool.query("CREATE INDEX IF NOT EXISTS idx_recycle_bin_deleted_at ON recycle_bin(deleted_at)");
  } catch (e) {
    console.error('[DB] recycle_bin schema migration failed:', e.message);
  }
})();

// rename() is atomic and instant on one volume; fall back to copy+delete if the
// bin ever ends up on a different filesystem (EXDEV).
function moveFileSafe(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

// Permanently removes bin entries (file + row). Used by "Delete forever",
// "Empty bin" and the 30-day auto-purge, so all three behave identically.
async function purgeRecycleRows(rows) {
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    var binPath = path.join(RECYCLE_DIR, path.basename(rows[i].bin_filename));
    try { if (fs.existsSync(binPath)) fs.unlinkSync(binPath); } catch (e) { console.error('[RECYCLE] unlink failed:', e.message); continue; }
    await pgPool.query('DELETE FROM recycle_bin WHERE id = $1', [rows[i].id]);
    n++;
  }
  return n;
}

async function purgeExpiredRecycleBin() {
  try {
    var r = await pgPool.query(
      'SELECT id, bin_filename FROM recycle_bin WHERE deleted_at < NOW() - make_interval(days => $1)', [RECYCLE_RETENTION_DAYS]
    );
    if (!r.rows.length) return;
    var n = await purgeRecycleRows(r.rows);
    console.log('[RECYCLE] auto-purged ' + n + ' item(s) older than ' + RECYCLE_RETENTION_DAYS + ' days');
  } catch (e) {
    console.error('[RECYCLE] auto-purge failed:', e.message);
  }
}

// File types a browser can show in a tab without running anything — see the
// GET route below for why everything else is forced to download.
var SITE_DOC_INLINE_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.mp3': 'audio/mpeg'
};

// Sends a stored document with the right Content-Type/Content-Disposition. Shared by
// the site-documents route and the Recycle Bin preview so they can't drift apart.
// extSource = the on-disk name (extension decides inline-vs-download);
// originalName = what the user uploaded it as (may include a folder path).
function sendSiteDocFile(res, filePath, extSource, originalName) {
  // Without an explicit Content-Type, res.send(Buffer) defaults to
  // application/octet-stream and every browser downloads instead of showing the
  // file. Only types browsers render safely are served inline; anything else
  // (office files, and especially HTML/SVG/JS, which would run as this app's
  // own origin = stored XSS) is forced to download.
  var inlineType = SITE_DOC_INLINE_TYPES[path.extname(extSource).toLowerCase()];
  // Folder uploads store "Folder/Sub/file.pdf" as the name — download as just file.pdf.
  var shownName = path.basename(String(originalName).replace(/\\/g, '/')) || extSource;
  // Header values must be latin-1: give an ASCII fallback plus an RFC 5987 UTF-8 name,
  // otherwise a file called "Plan – final.pdf" makes res.setHeader throw -> 500.
  var asciiName = shownName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', inlineType || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition',
    (inlineType ? 'inline' : 'attachment') + '; filename="' + asciiName + '"; filename*=UTF-8\'\'' +
    encodeURIComponent(shownName).replace(/'/g, '%27'));
  res.setHeader('Cache-Control', 'no-store');
  res.send(fs.readFileSync(filePath));
  return !inlineType; // true = delivered as a download (not displayed in the browser)
}

function ensureSiteDocsDir(siteId) {
  var dir = path.join(SITE_DOCS_DIR, siteId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}


// ── AUTO GIT COMMIT + PUSH ────────────────────────────────────────────────────
var _gitTimer = null;
function scheduleGitPush(reason) {
  if (_gitTimer) clearTimeout(_gitTimer);
  _gitTimer = setTimeout(function() {
    var appDir = __dirname;
    var now    = new Date();
    var stamp = now.toISOString().slice(0, 16).replace('T', ' ');
    // reason can originate from untrusted input (e.g. a name from the New Staff
    // Inbox) — pass it to git as a single argv element via execFile, never
    // through a shell, so it can't break out into arbitrary command execution.
    var msg = 'Auto-save: ' + stamp + (reason ? ' — ' + String(reason).slice(0, 200) : '');
    var opts = { cwd: appDir };
    execFile('git', ['add', '-A'], opts, function(errAdd) {
      if (errAdd) { console.log('[GIT] add failed:', errAdd.message); return; }
      execFile('git', ['commit', '-m', msg], opts, function(errCommit, _out, errCommitStderr) {
        if (errCommit) { console.log('[GIT] commit failed (likely nothing to commit):', errCommitStderr || errCommit.message); return; }
        execFile('git', ['push', 'origin', 'main'], opts, function(errPush, _out2, errPushStderr) {
          if (errPush) { console.log('[GIT] Push failed:', errPushStderr || errPush.message); }
          else          { console.log('[GIT] Pushed to GitHub —', msg); }
        });
      });
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

async function checkNewStaffInbox() {
  try {
    if (!fs.existsSync(INBOX_DIR)) return;
    if (!fs.existsSync(INBOX_DONE_DIR)) fs.mkdirSync(INBOX_DONE_DIR, {recursive:true});

    var files = fs.readdirSync(INBOX_DIR).filter(function(f) {
      return f.endsWith('.json') && fs.statSync(path.join(INBOX_DIR, f)).isFile();
    });
    if (files.length === 0) return;

    var created = 0;
    for (const file of files) {
      var filePath = path.join(INBOX_DIR, file);
      try {
        var raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        // Build name from Surname + First Name
        var firstName = String(raw.firstName || raw['First Name'] || '').trim();
        var surname   = String(raw.surname   || raw['Surname']    || '').trim();
        var fullName  = (firstName + ' ' + surname).trim().toUpperCase();
        if (!fullName) { console.warn('[INBOX] Skipping ' + file + ': no name'); continue; }

        // Prevent duplicates — check existing staff
        var existing = loadAllStaff();
        var already = existing.find(function(e) {
          return String(e.name||'').toUpperCase() === fullName;
        });
        if (already) {
          console.log('[INBOX] Already exists: ' + fullName + ', skipping ' + file);
          fs.renameSync(filePath, path.join(INBOX_DONE_DIR, 'DUPLICATE_' + file));
          continue;
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

        await saveStaff(emp, null);
        created++;
        console.log('[INBOX] Created staff record: ' + fullName);

        // Archive processed file
        fs.renameSync(filePath, path.join(INBOX_DONE_DIR, file));

      } catch(e) {
        console.error('[INBOX] Error processing ' + file + ':', e.message);
        // Move to Processed with ERROR_ prefix so it doesn't loop
        try { fs.renameSync(filePath, path.join(INBOX_DONE_DIR, 'ERROR_' + file)); } catch(_) {}
      }
    }

    if (created > 0) {
      console.log('[INBOX] ' + created + ' new staff record(s) created from form submissions.');
      scheduleGitPush('new staff from forms: ' + created);
    }
  } catch(e) {
    console.error('[INBOX] checkNewStaffInbox error:', e.message);
  }
}

async function autoDedup() {
  try {
    var staff = loadAllStaff();

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

        // Keep the record with more complete name; archive the other.
        // 'duplicate' is a third status distinct from 'archived' (Ex-Staff)
        // on purpose — mirrors the old "Duplicate Archive" folder being
        // invisible to both Active Staff and Ex-Staff views (see
        // loadAllStaff()/loadExStaff()), so a dedup'd record never shows up
        // looking like a real leaver.
        var keepIdx = (a.name||'').length >= (b.name||'').length ? i : j;
        var dropIdx = keepIdx === i ? j : i;
        var keep = staff[keepIdx], drop = staff[dropIdx];

        if (!drop._pgId) continue;

        try {
          await pgPool.query("UPDATE employees SET status='duplicate', archived_at=NOW(), archive_reason='duplicate_record' WHERE id=$1", [drop._pgId]);
          await refreshStaffCacheEntry(drop._pgId);
          console.log('[DEDUP] Archived: ' + drop.name + ' — kept: ' + keep.name + ' (score ' + score.toFixed(1) + ')');
          archived++;
          staff.splice(dropIdx, 1);
          if (dropIdx <= i) i--;
          if (dropIdx <= j) j--;
        } catch(dbErr) {
          console.log('[DEDUP] Could not archive duplicate ' + drop.name + ':', dbErr.message);
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

// ── VEHICLES ──────────────────────────────────────────────────────────────────
// Postgres-backed (see ensureVehiclesExtendedSchema above). VEHICLES_FILE is
// no longer read by any route below — kept only as the source path for the
// one-time migrate-vehicles.js script.
var VEHICLES_FILE = path.join(BASE, 'vehicles.json');
var VEHICLE_PHOTOS_DIR = path.join(BASE, 'vehicle-photos');
if (!fs.existsSync(VEHICLE_PHOTOS_DIR)) fs.mkdirSync(VEHICLE_PHOTOS_DIR, { recursive: true });

var VEHICLE_DOCS_DIR = path.join(BASE, 'vehicle-docs');
if (!fs.existsSync(VEHICLE_DOCS_DIR)) fs.mkdirSync(VEHICLE_DOCS_DIR, { recursive: true });

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

// vehicle_type is the real column name (set by the dormant schema-phase3.sql
// table, long before this migration) — aliased back to `type` here so every
// route/response/frontend field stays exactly what it was pre-migration.
// mot/insurance/road_tax/service dates are ::text-cast explicitly: node-postgres
// returns a plain DATE column as a JS Date object by default, which JSON.stringify
// turns into a full ISO timestamp — breaking `<input type="date">` elsewhere
// in this app (see the same issue already worked around client-side for
// agency_deployments.event_date). Casting to text here keeps the wire format
// as the plain YYYY-MM-DD string the old vehicles.json always had.
var VEHICLE_JOIN_SQL =
  "SELECT v.id, v.legacy_id, v.registration, v.make, v.model, v.vehicle_type AS type, v.year, v.colour, v.status, v.notes, v.mileage, " +
  "  (SELECT vc.expiry_date::text FROM vehicle_compliance vc WHERE vc.vehicle_id = v.id AND vc.document_type = 'MOT' ORDER BY vc.created_at DESC LIMIT 1) AS mot_expiry, " +
  "  (SELECT vc.expiry_date::text FROM vehicle_compliance vc WHERE vc.vehicle_id = v.id AND vc.document_type = 'INSURANCE' ORDER BY vc.created_at DESC LIMIT 1) AS insurance_expiry, " +
  "  (SELECT vc.expiry_date::text FROM vehicle_compliance vc WHERE vc.vehicle_id = v.id AND vc.document_type = 'ROAD_TAX' ORDER BY vc.created_at DESC LIMIT 1) AS road_tax_expiry, " +
  "  (SELECT vc.expiry_date::text FROM vehicle_compliance vc WHERE vc.vehicle_id = v.id AND vc.document_type = 'SERVICE' ORDER BY vc.created_at DESC LIMIT 1) AS service_due, " +
  "  (SELECT e.legacy_id FROM vehicle_assignments va JOIN employees e ON e.id = va.employee_id " +
  "     WHERE va.vehicle_id = v.id AND va.unassigned_date IS NULL ORDER BY va.assigned_date DESC LIMIT 1) AS \"assignedDriverId\" " +
  "FROM vehicles v";

function findVehiclePhoto(id) { return findFileByExts(VEHICLE_PHOTOS_DIR, id); }

// has_photo was never authoritative pre-migration either — the photo-serving
// route always re-checked disk regardless of this flag — so it's computed
// live here rather than stored, which can never drift from reality.
function attachHasPhoto(row) {
  row.has_photo = !!findVehiclePhoto(row.id);
  return row;
}

async function loadVehicles() {
  var r = await pgPool.query(VEHICLE_JOIN_SQL + " ORDER BY v.created_at");
  return r.rows.map(attachHasPhoto);
}

// ── AGENCY STAFF (COVER GUARDS) ───────────────────────────────────────────────
// Registration, documents, photo, bulk import and unavailability for guards
// belonging to an agency. Every route here is gated by
// requireOwnAgencyOrPermission('staff') — an 'agency' user may only touch rows
// whose agency_id matches their own token, everyone else needs the 'staff'
// module permission (director / any role granted it).

// Formula-injection guard for CSV import (debug note #10) — Excel treats a
// leading =, +, -, or @ as the start of a live formula. Prepending a quote
// makes it render as literal text instead of executing if the export is later
// opened in Excel. Applied to every text field on import, not just ones that
// "look like" formulas — the check is on the leading character alone.
function sanitizeForExcel(value) {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
  return value;
}
var AGENCY_STAFF_DOCS_DIR = path.join(BASE, 'agency-staff-documents');
if (!fs.existsSync(AGENCY_STAFF_DOCS_DIR)) fs.mkdirSync(AGENCY_STAFF_DOCS_DIR, { recursive: true });

// ── Agency Staff: Custom Certificate Documents ────────────────────────────────
// Unlimited custom-labeled certs per guard, on top of (never replacing) the
// fixed 5 types above — a separate child table + flat directory because the
// column-per-type design above has no room for arbitrary new labels. Same
// path.basename()-every-segment discipline as the fixed-cert routes above.
var AGENCY_STAFF_CUSTOM_DOCS_DIR = path.join(BASE, 'agency-staff-custom-documents');
if (!fs.existsSync(AGENCY_STAFF_CUSTOM_DOCS_DIR)) fs.mkdirSync(AGENCY_STAFF_CUSTOM_DOCS_DIR, { recursive: true });

// ── Agency Staff: Profile Photo ───────────────────────────────────────────────
// Flat, ID-keyed directory — mirrors USER_PHOTOS_DIR/findUserPhoto exactly,
// since agency_staff (a Postgres table) has no per-person folder the way
// regular staff do. One photo per guard, delete-then-write on reupload.
var AGENCY_STAFF_PHOTOS_DIR = path.join(BASE, 'agency-staff-photos');
if (!fs.existsSync(AGENCY_STAFF_PHOTOS_DIR)) fs.mkdirSync(AGENCY_STAFF_PHOTOS_DIR, { recursive: true });

// Credit/social-media check results — admin-only in both directions (upload
// AND read), since a guard has no login to view anything through, and
// visibility here means "visible to the agency admin", not the guard.
var AGENCY_STAFF_DOCS_DIR = path.join(BASE, 'agency-staff-confidential-docs');
if (!fs.existsSync(AGENCY_STAFF_DOCS_DIR)) fs.mkdirSync(AGENCY_STAFF_DOCS_DIR, { recursive: true });

// ── EVENT INSTRUCTIONS: DOCUMENT ATTACHMENT ───────────────────────────────────
// Flat dir keyed by instruction id (one attached document per instruction,
// mirroring document_file_url being a single column, not a list) — same
// magic-byte extension detection and path.basename()-every-segment
// discipline as the agency staff document routes above. document_file_url is
// stored as this same GET route's own path so "is a document attached" and
// "where do I fetch it from" are the same fact, and document_mime_type
// records what GET should serve it as.
var EVENT_INSTRUCTIONS_DOCS_DIR = path.join(BASE, 'event-instructions-documents');
if (!fs.existsSync(EVENT_INSTRUCTIONS_DOCS_DIR)) fs.mkdirSync(EVENT_INSTRUCTIONS_DOCS_DIR, { recursive: true });

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

// ── Message Attachments ───────────────────────────────────────────────────────
var MESSAGE_ATTACH_DIR = path.join(BASE, 'message-attachments');
if (!fs.existsSync(MESSAGE_ATTACH_DIR)) fs.mkdirSync(MESSAGE_ATTACH_DIR, { recursive: true });

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

// ── DOMAIN ROUTES ─────────────────────────────────────────────────────────────
// Each routes/<domain>.js file registers its own endpoints (same pattern as
// crm.js / procurement.js). Order matters only where paths could overlap; it
// mirrors the order the routes originally appeared in this file.
var deps = {
  AGENCY_STAFF_CUSTOM_DOCS_DIR: AGENCY_STAFF_CUSTOM_DOCS_DIR,
  AGENCY_STAFF_DOCS_DIR: AGENCY_STAFF_DOCS_DIR,
  AGENCY_STAFF_PHOTOS_DIR: AGENCY_STAFF_PHOTOS_DIR,
  ALLOWED_ATTACH_MIME: ALLOWED_ATTACH_MIME,
  BASE: BASE,
  BASE_URL: BASE_URL,
  CONTRACT_DIR: CONTRACT_DIR,
  EVENT_INSTRUCTIONS_DOCS_DIR: EVENT_INSTRUCTIONS_DOCS_DIR,
  INCIDENT_ATTACH_DIR: INCIDENT_ATTACH_DIR,
  JWT_SECRET: JWT_SECRET,
  MANAGER_ONLY_DOC_KEYS: MANAGER_ONLY_DOC_KEYS,
  MAX_ATTACH_SIZE: MAX_ATTACH_SIZE,
  MESSAGE_ATTACH_DIR: MESSAGE_ATTACH_DIR,
  MY_PROFILE_FIELDS: MY_PROFILE_FIELDS,
  RECYCLE_DIR: RECYCLE_DIR,
  RECYCLE_RETENTION_DAYS: RECYCLE_RETENTION_DAYS,
  SITE_DOCS_DIR: SITE_DOCS_DIR,
  USER_PHOTOS_DIR: USER_PHOTOS_DIR,
  VEHICLE_DOCS_DIR: VEHICLE_DOCS_DIR,
  VEHICLE_JOIN_SQL: VEHICLE_JOIN_SQL,
  VEHICLE_PHOTOS_DIR: VEHICLE_PHOTOS_DIR,
  app: app,
  applyPendingProfileFields: applyPendingProfileFields,
  attachHasPhoto: attachHasPhoto,
  authRateLimiter: authRateLimiter,
  canAccessOwnerEmpId: canAccessOwnerEmpId,
  canViewNotification: canViewNotification,
  contractMime: contractMime,
  createNotification: createNotification,
  daysFrom: daysFrom,
  deepCloneEmp: deepCloneEmp,
  deliverPush: deliverPush,
  detectExtFromBuffer: detectExtFromBuffer,
  ensureSiteDocsDir: ensureSiteDocsDir,
  excelDate: excelDate,
  findContractFile: findContractFile,
  findFileByExts: findFileByExts,
  findUserPhoto: findUserPhoto,
  findVehiclePhoto: findVehiclePhoto,
  getAuthedUser: getAuthedUser,
  getSiteById: getSiteById,
  hasStaffPermission: hasStaffPermission,
  isPasswordBreached: isPasswordBreached,
  loadAllStaff: loadAllStaff,
  loadRoles: loadRoles,
  loadSites: loadSites,
  loadVehicles: loadVehicles,
  logAuditEvent: logAuditEvent,
  moveFileSafe: moveFileSafe,
  passwordStrengthError: passwordStrengthError,
  pgPool: pgPool,
  purgeRecycleRows: purgeRecycleRows,
  refreshOverview: refreshOverview,
  refreshStaffCacheEntry: refreshStaffCacheEntry,
  requireLogin: requireLogin,
  requireOwnAgencyOrPermission: requireOwnAgencyOrPermission,
  requirePermission: requirePermission,
  requireRole: requireRole,
  resolveEmpId: resolveEmpId,
  roleHasPermission: roleHasPermission,
  safeName: safeName,
  sanitizeForExcel: sanitizeForExcel,
  sanitizeForStaffView: sanitizeForStaffView,
  saveStaff: saveStaff,
  saveStaffDocFile: saveStaffDocFile,
  sendSiteDocFile: sendSiteDocFile,
  sendXlsx: sendXlsx,
  staffDocDir: staffDocDir,
  toISO: toISO,
  get STAFF_CACHE() { return STAFF_CACHE; },
  set STAFF_CACHE(v) { STAFF_CACHE = v; },
  get rolesCache() { return rolesCache; },
  set rolesCache(v) { rolesCache = v; },
};
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