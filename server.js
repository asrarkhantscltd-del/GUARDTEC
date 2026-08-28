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
const webpush      = require('web-push');
const { Pool }     = require('pg');

const app  = express();
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
  pushToManagers(opts.summary).catch(function(e) { console.error('[PUSH] broadcast failed:', e.message); });
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

// Sends one push message to every subscribed manager/director device. Scope
// is deliberately broadcast-to-all-managers, matching the bell feed's
// existing audience (see notifications table above) — not per-staff
// targeting, which the current schema has no data model for yet.
async function pushToManagers(body) {
  if (!process.env.VAPID_PUBLIC_KEY) return; // not configured — no-op, not an error
  var subs = (await pgPool.query('SELECT id, endpoint, p256dh, auth FROM push_subscriptions')).rows;
  var payload = JSON.stringify({ title: 'GuardTec Compliance', body: body, url: '/' });
  for (var i = 0; i < subs.length; i++) {
    var sub = subs[i];
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (e) {
      // 404/410 = the browser/OS revoked this subscription (uninstalled,
      // permission withdrawn, etc.) — clean it up rather than retrying it
      // forever on every future notification.
      if (e.statusCode === 404 || e.statusCode === 410) {
        await pgPool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
      } else {
        console.error('[PUSH] send failed for subscription', sub.id, ':', e.message);
      }
    }
  }
}

// Route handlers for these three live further down (after app.use(cookieParser())
// / app.use(express.json()) are registered) — see the "WEB PUSH — routes"
// section below. Express runs middleware/routes in registration order, so
// defining them up here (before the cookie/body parsers exist) meant
// req.cookies and req.body were both undefined for every request to them;
// found via testing (`/api/push/vapid-public-key` returned "Not logged in"
// even for an authenticated browser session).

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
  } catch (e) {
    console.error('[DB] roles schema migration failed:', e.message);
  }
})();

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

// Lets a staff user act on their OWN record (req.params.id must match their
// staff_id), or falls back to the normal management permission check for
// everyone else (director / any role granted moduleKey).
function requireOwnStaffOrPermission(moduleKey) {
  var permCheck = requirePermission(moduleKey);
  return function(req, res, next) {
    if (req.user && req.user.role === 'staff') {
      if (req.user.staff_id && req.user.staff_id === req.params.id) return next();
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    permCheck(req, res, next);
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
const COMPLIANCE_TRACKER   = path.join(BASE, "01 - Staff Compliance Tracker", "GuardTec Security — Staff Compliance Tracker.xlsx");
const REFERENCE_TRACKER    = path.join(BASE, "05 - Reference Tracker", "GuardTec Security — Reference Check Tracker.xlsx");
const SHAREPOINT_DASHBOARD = path.join(BASE, "! GuardTec Compliance Dashboard.html");
const SITES_FILE           = path.join(BASE, "deployment-sites.json");
const SITE_DOCS_DIR        = path.join(BASE, "site-documents");
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

app.post('/api/login', authRateLimiter, async function(req, res) {
  try {
    var username = String((req.body && req.body.username) || '').trim();
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

async function getStaffDocRow(employeeId, category, key) {
  var r = await pgPool.query(
    'SELECT * FROM staff_documents WHERE employee_id=$1 AND doc_category=$2 AND doc_key=$3',
    [employeeId, category, key]
  );
  return r.rows[0] || null;
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

async function deleteStaffDocFile(employeeId, category, key) {
  var row = await getStaffDocRow(employeeId, category, key);
  if (row) {
    var fp = path.join(staffDocDir(employeeId), row.filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    await pgPool.query('DELETE FROM staff_documents WHERE id = $1', [row.id]);
  }
  await refreshStaffCacheEntry(employeeId);
}

app.get('/api/staff/:id/photo', requireLogin, requireOwnStaffOrPermission('staff'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._pgId) return res.status(404).end();
    var row = await getStaffDocRow(emp._pgId, 'photo', 'profile');
    if (!row) return res.status(404).end();
    var fp = path.join(staffDocDir(emp._pgId), row.filename);
    if (!fs.existsSync(fp)) return res.status(404).end();
    var ext = path.extname(fp).toLowerCase();
    var mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(fp));
  } catch(e) {
    res.status(500).end();
  }
});

app.post('/api/staff/:id/photo', requireLogin, requireOwnStaffOrPermission('staff'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._pgId) return res.status(404).json({ ok:false, error:'Staff not found' });

    var chunks = [];
    req.on('data', function(c){ chunks.push(c); });
    req.on('end', async function() {
      try {
        var buf = Buffer.concat(chunks);
        var ext = detectExtFromBuffer(buf, '.jpg');
        await saveStaffDocFile(emp._pgId, 'photo', 'profile', buf, ext, {});
        console.log('[PHOTO] Saved profile photo for', emp.name);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── STAFF DOCUMENT FILES ──────────────────────────────────────────────────────
var ALLOWED_DOC_KEYS = [
  'siaPhysical','passport','drivingLicenceDoc','brpCard','proofOfAddress1','proofOfAddress2',
  'p45','bankLetter','application','assignmentInstructions','cscsCard','dbsCertificate',
  'creditCheckReport','socialMediaCheckReport',
  'driverLicenceCopy','driverCpcCard','driverMedicalCert','driverTachoCard','driverDbsCheck','driverAssessmentReport'
];

// Uploaded by management only, and hidden from the staff member by default —
// unlike every other doc key above (self-uploaded, or manager-uploaded but
// always visible, e.g. assignmentInstructions), visibility here is an
// explicit per-document manager choice stored as documents[key].visibleToStaff.
var MANAGER_ONLY_DOC_KEYS = ['creditCheckReport', 'socialMediaCheckReport', 'driverTachoCard', 'driverDbsCheck', 'driverAssessmentReport'];

var ALLOWED_TRAINING_KEYS = [
  'siaCertificate','firstAid','manualHandling','fireAwareness',
  'conflictManagement','bwcTraining','cscsTest'
];

var DOC_KEY_LABELS = {
  siaPhysical: 'SIA Licence copy', passport: 'Passport / Photo ID', drivingLicenceDoc: 'Driving Licence', brpCard: 'BRP Card',
  proofOfAddress1: 'Proof of Address', proofOfAddress2: 'Proof of Address',
  p45: 'P45/P60', bankLetter: 'Bank Letter', application: 'Application Form',
  assignmentInstructions: 'Assignment Instructions', cscsCard: 'CSCS Card', dbsCertificate: 'DBS Certificate',
  creditCheckReport: 'Credit Check Report', socialMediaCheckReport: 'Social Media Check Report',
  driverLicenceCopy: 'Driving Licence (scan)',
  driverCpcCard: 'Driver CPC Card', driverMedicalCert: 'Driver Medical Certificate',
  driverTachoCard: 'Tachograph Card', driverDbsCheck: 'Driver DBS Certificate',
  driverAssessmentReport: 'Driving Assessment Report',
};
var TRAINING_KEY_LABELS = {
  siaCertificate: 'SIA Qualifying Certificate', firstAid: 'First Aid certificate',
  manualHandling: 'Manual Handling certificate', fireAwareness: 'Fire Awareness certificate',
  conflictManagement: 'Conflict Management certificate', bwcTraining: 'BWC Training certificate',
  cscsTest: 'CSCS Health & Safety Test certificate',
};

app.get('/api/staff/:id/documents/:docKey', requireLogin, requireOwnStaffOrPermission('staff'), async function(req, res) {
  var docKey = req.params.docKey;
  if (!ALLOWED_DOC_KEYS.includes(docKey)) return res.status(400).end();
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._pgId) return res.status(404).end();
    // requireOwnStaffOrPermission already let the staff member themselves
    // through for their own :id — this extra check catches that specific
    // case for manager-only docs, since the middleware alone can't tell
    // "staff viewing their own record" apart from "manager viewing it".
    if (MANAGER_ONLY_DOC_KEYS.includes(docKey) && !(await hasStaffPermission(req))) {
      var visMeta = emp.documents && emp.documents[docKey];
      if (!visMeta || visMeta.visibleToStaff !== true) return res.status(404).end();
    }
    var row = await getStaffDocRow(emp._pgId, 'document', docKey);
    if (!row) return res.status(404).end();
    var fp = path.join(staffDocDir(emp._pgId), row.filename);
    if (!fs.existsSync(fp)) return res.status(404).end();
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

app.post('/api/staff/:id/documents/:docKey', requireLogin, requireOwnStaffOrPermission('staff'), async function(req, res) {
  var docKey = req.params.docKey;
  if (!ALLOWED_DOC_KEYS.includes(docKey)) return res.status(400).json({ ok:false, error:'Invalid document key' });
  if (MANAGER_ONLY_DOC_KEYS.includes(docKey) && !(await hasStaffPermission(req))) {
    return res.status(403).json({ ok:false, error: 'Only management can upload this document.' });
  }
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._pgId) return res.status(404).json({ ok:false, error:'Staff not found' });
    var chunks = [];
    req.on('data', function(c){ chunks.push(c); });
    req.on('end', async function() {
      try {
        var buf = Buffer.concat(chunks);
        var ext = detectExtFromBuffer(buf, '.pdf');
        // Manager-only docs default HIDDEN from the subject unless the uploader
        // explicitly opts them in via this header at upload time (see
        // MANAGER_ONLY_DOC_KEYS comment) — everything else stays visible, same
        // as before this feature existed.
        var visibleToStaff = MANAGER_ONLY_DOC_KEYS.includes(docKey)
          ? req.query.visibleToStaff === 'true'
          : true;
        await saveStaffDocFile(emp._pgId, 'document', docKey, buf, ext, { visibleToStaff: visibleToStaff });
        console.log('[DOCS] Saved', docKey, 'for', emp.name);
        if (req.user.role === 'staff') {
          createNotification({
            type: 'document', actorName: emp.name,
            summary: 'uploaded ' + (DOC_KEY_LABELS[docKey] || docKey),
            linkStaffId: req.params.id, linkTab: 'documents',
          });
        }
        res.json({ ok:true, date: new Date().toISOString().slice(0, 10) });
      } catch (e) {
        res.status(500).json({ ok:false, error: e.message });
      }
    });
  } catch(e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// Management-only — deliberately requirePermission, not requireOwnStaffOrPermission,
// so a staff member can never remove a document their manager has already reviewed.
app.delete('/api/staff/:id/documents/:docKey', requireLogin, requirePermission('staff'), async function(req, res) {
  var docKey = req.params.docKey;
  if (!ALLOWED_DOC_KEYS.includes(docKey)) return res.status(400).json({ ok:false, error:'Invalid document key' });
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._pgId) return res.status(404).json({ ok:false, error:'Staff not found' });
    await deleteStaffDocFile(emp._pgId, 'document', docKey);
    console.log('[DOCS] Deleted', docKey, 'for', emp.name);
    res.json({ ok:true });
  } catch(e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// Flip visibility on an already-uploaded manager-only document without
// re-uploading it — the manager's own control over "can this person see
// what I checked", separate from the upload step itself.
app.patch('/api/staff/:id/documents/:docKey/visibility', requireLogin, requirePermission('staff'), async function(req, res) {
  var docKey = req.params.docKey;
  if (!MANAGER_ONLY_DOC_KEYS.includes(docKey)) {
    return res.status(400).json({ ok:false, error: 'Visibility is not configurable for this document type.' });
  }
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._pgId) return res.status(404).json({ ok:false, error:'Staff not found' });
    var row = await getStaffDocRow(emp._pgId, 'document', docKey);
    if (!row) return res.status(404).json({ ok:false, error: 'Document not found' });
    var visibleToStaff = !!(req.body && req.body.visibleToStaff);
    await pgPool.query('UPDATE staff_documents SET visible_to_staff = $1 WHERE id = $2', [visibleToStaff, row.id]);
    await refreshStaffCacheEntry(emp._pgId);
    res.json({ ok:true, visibleToStaff: visibleToStaff });
  } catch(e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ── TRAINING CERTIFICATE FILES ────────────────────────────────────────────────
// Staff upload their own certificate for each standard course; management can
// only view whether one is on file (no upload button on that side of the UI).
app.get('/api/staff/:id/training/:key/certificate', requireLogin, requireOwnStaffOrPermission('staff'), async function(req, res) {
  var key = req.params.key;
  if (!ALLOWED_TRAINING_KEYS.includes(key)) return res.status(400).end();
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._pgId) return res.status(404).end();
    var row = await getStaffDocRow(emp._pgId, 'training', key);
    if (!row) return res.status(404).end();
    var fp = path.join(staffDocDir(emp._pgId), row.filename);
    if (!fs.existsSync(fp)) return res.status(404).end();
    var ext = path.extname(fp).toLowerCase();
    var mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', 'inline; filename="' + key + ext + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(fp));
  } catch(e) {
    res.status(500).end();
  }
});

app.post('/api/staff/:id/training/:key/certificate', requireLogin, requireOwnStaffOrPermission('staff'), async function(req, res) {
  var key = req.params.key;
  if (!ALLOWED_TRAINING_KEYS.includes(key)) return res.status(400).json({ ok:false, error:'Invalid training key' });
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._pgId) return res.status(404).json({ ok:false, error:'Staff not found' });
    var chunks = [];
    req.on('data', function(c){ chunks.push(c); });
    req.on('end', async function() {
      try {
        var buf = Buffer.concat(chunks);
        var ext = detectExtFromBuffer(buf, '.pdf');
        await saveStaffDocFile(emp._pgId, 'training', key, buf, ext, {});
        console.log('[TRAINING CERT] Saved', key, 'for', emp.name);
        if (req.user.role === 'staff') {
          createNotification({
            type: 'training_cert', actorName: emp.name,
            summary: 'uploaded ' + (TRAINING_KEY_LABELS[key] || key),
            linkStaffId: req.params.id, linkTab: 'training',
          });
        }
        res.json({ ok:true, date: new Date().toISOString().slice(0, 10) });
      } catch (e) {
        res.status(500).json({ ok:false, error: e.message });
      }
    });
  } catch(e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// Management-only, same reasoning as the documents delete route above.
app.delete('/api/staff/:id/training/:key/certificate', requireLogin, requirePermission('staff'), async function(req, res) {
  var key = req.params.key;
  if (!ALLOWED_TRAINING_KEYS.includes(key)) return res.status(400).json({ ok:false, error:'Invalid training key' });
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._pgId) return res.status(404).json({ ok:false, error:'Staff not found' });
    await deleteStaffDocFile(emp._pgId, 'training', key);
    console.log('[TRAINING CERT] Deleted', key, 'for', emp.name);
    res.json({ ok:true });
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

// Postgres-backed equivalent of nextFreeNameSuffix — finds the lowest
// numeric suffix not already taken by an existing employees.legacy_id, used
// to disambiguate two different people who share a name (the folder-name
// suffix concept above doesn't apply any more; only the stored id needs to
// stay unique).
async function nextFreeIdSuffix(baseId) {
  for (var n = 2; ; n++) {
    var r = await pgPool.query('SELECT 1 FROM employees WHERE legacy_id = $1', [baseId + '-' + n]);
    if (!r.rows.length) return n;
  }
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
  'status','jobRole','wizard_draft','pending_submission','rejection_reason','overall','_folderPath',
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

function reconstructEmp(row, docRows) {
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
  var reconstructed = reconstructEmp(r.rows[0], docRows);
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
  STAFF_CACHE = rows.map(function(row) { return reconstructEmp(row, docsByEmployee[row.id] || []); });
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

function loadExStaff() {
  return STAFF_CACHE.filter(function(e) { return e.status === 'archived'; }).map(deepCloneEmp);
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

// ── API ───────────────────────────────────────────────────────────────────────
app.get('/api/staff', requireLogin, requirePermission('staff'), function(req, res) {
  try {
    res.json(loadAllStaff());
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── STAFF EXCEL EXPORT ────────────────────────────────────────────────────────
// Mirrors the frontend's normDeploy() so filters match what the UI shows.
function normDeployStatus(raw) {
  var v = String(raw || '').toLowerCase().replace(/[\s_-]/g, '');
  if (v.indexOf('onsite') !== -1 || v.indexOf('site') !== -1 || v.indexOf('deployed') !== -1) return 'onsite';
  if (v.indexOf('available') !== -1 || v.indexOf('standby') !== -1) return 'available';
  if (v.indexOf('off') !== -1 || v.indexOf('leave') !== -1 || v.indexOf('rest') !== -1 || v.indexOf('inactive') !== -1) return 'offduty';
  return 'unknown';
}

app.get('/api/staff/export', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var sites = await loadSites();
    var siteName = function(id) {
      var s = sites.find(function(x) { return x.id === id; });
      return s ? s.name : (id || '');
    };

    var ids = req.query.ids ? String(req.query.ids).split(',') : null;
    var list = ids ? all.filter(function(s) { return ids.indexOf(s.id) !== -1; }) : all;

    var deployFilter = req.query.deployStatus ? String(req.query.deployStatus) : null;
    if (deployFilter) list = list.filter(function(s) { return normDeployStatus(s.deployStatus) === deployFilter; });

    var siteFilter = req.query.site ? String(req.query.site) : null;
    if (siteFilter) list = list.filter(function(s) { return s.currentSite === siteFilter; });

    var overallFilter = req.query.overall ? String(req.query.overall) : null;
    if (overallFilter) list = list.filter(function(s) { return s.overall === overallFilter; });

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
        'Deploy Status': normDeployStatus(s.deployStatus),
        'Current Site': s.currentSite ? siteName(s.currentSite) : '',
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
app.patch('/api/staff/:id/deploy', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
    emp.deployStatus = req.body.deployStatus || emp.deployStatus || 'inactive';
    if (req.body.currentSite !== undefined) emp.currentSite = req.body.currentSite;
    await saveStaff(emp, emp._folderPath);
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── TRAINING ──────────────────────────────────────────────────────────────────
app.patch('/api/staff/:id/training', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
    emp.training = req.body.training || {};
    await saveStaff(emp, emp._folderPath);
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
app.get('/api/staff/:id/registration-code', requireLogin, requirePermission('pending_review'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
    if (emp.registration_claimed) return res.json({ ok: true, claimed: true, code: null });
    if (!emp.registration_code) {
      emp.registration_code = generateRegistrationCode();
      await saveStaff(emp, emp._folderPath);
    }
    res.json({ ok: true, claimed: false, code: emp.registration_code });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/staff/:id/registration-code/regenerate', requireLogin, requirePermission('pending_review'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
    emp.registration_code = generateRegistrationCode();
    emp.registration_claimed = false;
    await saveStaff(emp, emp._folderPath);
    res.json({ ok: true, code: emp.registration_code });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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

// Fields a staff member can submit via their self-service profile. Shared
// between the pending_submission constructor below and the approve-merge
// allowlist, so a field can never be accepted into pending_submission but
// silently dropped on approval (or vice versa).
var MY_PROFILE_FIELDS = [
  'phone', 'address', 'emergencyContact', 'sia', 'cscs', 'visa', 'references',
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

// Staff submit changes here — they land in pending_submission and do NOT
// touch the live compliance record until a manager approves them.
app.post('/api/my-profile', requireLogin, requireRole('staff'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.user.staff_id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Profile not found' });

    applyPendingProfileFields(emp, req.body || {});
    // The draft has now been promoted into a real, reviewable submission —
    // clear it so a stale in-progress copy doesn't reappear and silently
    // overwrite a later edit the next time this staff member reopens the
    // wizard (see wizard_draft below).
    delete emp.wizard_draft;
    await saveStaff(emp, emp._folderPath);
    // Without this, a submission landed in pending_submission with no signal
    // anywhere that a manager needed to look — the bell never rang, so it
    // only ever got noticed if someone happened to open Pending Review.
    createNotification({
      type: 'profile_submission', actorName: emp.name,
      summary: 'submitted profile changes for review',
      linkStaffId: emp.id, linkTab: 'pending-review',
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Autosaves the onboarding wizard's in-progress answers so a reload, crash,
// or the earlier document-status desync bug (fixed alongside this) doesn't
// wipe an entire session's typing — everything from Personal Details through
// Bank Details lived ONLY in this page's React state until the final
// "Submit for Review" succeeded, with no recovery path if that never
// happened. wizard_draft is intentionally separate from pending_submission:
// it's never shown to a manager, never triggers a notification, and gets
// cleared the moment a real submission promotes it (above) — it's purely a
// private resume-buffer for the person still filling the form in.
app.put('/api/my-profile/draft', requireLogin, requireRole('staff'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.user.staff_id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Profile not found' });

    var draft = Object.assign({}, emp.wizard_draft);
    var body = req.body || {};
    MY_PROFILE_FIELDS.forEach(function(field) {
      if (body[field] !== undefined) draft[field] = body[field];
    });
    emp.wizard_draft = draft;
    await saveStaff(emp, emp._folderPath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/my-profile/photo', requireLogin, requireRole('staff'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.user.staff_id; });
    if (!emp || !emp._pgId) return res.status(404).json({ ok: false, error: 'Profile not found' });

    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', async function() {
      try {
        var buf = Buffer.concat(chunks);
        var ext = detectExtFromBuffer(buf, '.jpg');
        await saveStaffDocFile(emp._pgId, 'photo', 'pending', buf, ext, {});

        emp.pending_submission = Object.assign({}, emp.pending_submission, {
          submitted_at: new Date().toISOString(),
          photo_pending: true,
        });
        await saveStaff(emp, emp._folderPath);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Moves the pending photo into the live 'profile' slot on approve — reuses
// saveStaffDocFile so the same old-extension cleanup + metadata upsert logic
// runs as any other photo write, rather than a bespoke fs.renameSync.
async function promotePendingPhoto(employeeId) {
  var pendingRow = await getStaffDocRow(employeeId, 'photo', 'pending');
  if (!pendingRow) return;
  var srcPath = path.join(staffDocDir(employeeId), pendingRow.filename);
  if (fs.existsSync(srcPath)) {
    var buf = fs.readFileSync(srcPath);
    var ext = path.extname(pendingRow.filename) || '.jpg';
    await saveStaffDocFile(employeeId, 'photo', 'profile', buf, ext, {});
  }
  await deleteStaffDocFile(employeeId, 'photo', 'pending');
}

app.get('/api/staff/:id/pending-photo', requireLogin, requirePermission('pending_review'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._pgId) return res.status(404).end();
    var row = await getStaffDocRow(emp._pgId, 'photo', 'pending');
    if (!row) return res.status(404).end();
    var fp = path.join(staffDocDir(emp._pgId), row.filename);
    if (!fs.existsSync(fp)) return res.status(404).end();
    var ext = path.extname(fp).toLowerCase();
    var mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(fp));
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

app.post('/api/staff/:id/approve', requireLogin, requirePermission('pending_review'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
    var pending = emp.pending_submission;
    if (!pending) return res.status(400).json({ ok: false, error: 'No pending submission for this staff member' });

    MY_PROFILE_FIELDS.forEach(function(field) {
      if (pending[field] !== undefined) emp[field] = pending[field];
    });

    if (pending.photo_pending && emp._pgId) {
      await promotePendingPhoto(emp._pgId);
    }

    delete emp.pending_submission;
    delete emp.rejection_reason;
    await saveStaff(emp, emp._folderPath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/staff/:id/reject', requireLogin, requirePermission('pending_review'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
    if (!emp.pending_submission) return res.status(400).json({ ok: false, error: 'No pending submission for this staff member' });

    if (emp._pgId) {
      await deleteStaffDocFile(emp._pgId, 'photo', 'pending');
    }

    emp.rejection_reason = String(req.body.reason || 'Please review and resubmit your details.').trim();
    delete emp.pending_submission;
    await saveStaff(emp, emp._folderPath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── DEPLOYMENT SITES CRUD ─────────────────────────────────────────────────────
app.get('/api/sites', requireLogin, async function(req, res) {
  try {
    res.json({ sites: await loadSites() });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sites', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    var name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'Site name required' });
    var dupe = await pgPool.query('SELECT 1 FROM sites WHERE LOWER(name) = LOWER($1)', [name]);
    if (dupe.rows.length) return res.status(409).json({ ok: false, error: 'Site already exists' });

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
    await pgPool.query(
      `INSERT INTO sites (id, name, type, client_name, client_phone, client_email, address,
                          supervisor_name, supervisor_phone, supervisor_email, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [site.id, site.name, site.type, site.client_name, site.client_phone, site.client_email,
       site.address, site.supervisor_name, site.supervisor_phone, site.supervisor_email, site.status, site.notes]
    );
    site.welfare_items = [];
    site.assigned_staff = [];
    res.json({ ok: true, site: site });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/sites/:id', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    var o = await getSiteById(req.params.id);
    if (!o) return res.status(404).json({ ok: false, error: 'Site not found' });
    var b = req.body;
    var updated = {
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
    };
    await pgPool.query(
      `UPDATE sites SET name=$1, type=$2, client_name=$3, client_phone=$4, client_email=$5, address=$6,
              supervisor_name=$7, supervisor_phone=$8, supervisor_email=$9, status=$10, notes=$11, updated_at=NOW()
       WHERE id=$12`,
      [updated.name, updated.type, updated.client_name, updated.client_phone, updated.client_email, updated.address,
       updated.supervisor_name, updated.supervisor_phone, updated.supervisor_email, updated.status, updated.notes, req.params.id]
    );
    res.json({ ok: true, site: await getSiteById(req.params.id) });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/sites/:id', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    // ON DELETE CASCADE on site_documents/site_welfare_items/site_staff_assignments
    // handles those DB-side child rows automatically, but agency_deployments
    // and event_instructions are deliberately NOT cascaded (see their FK
    // definitions above) — a deployment is a real booking record and an
    // instruction can carry signed acknowledgment_forms, which is compliance
    // proof. Rather than let the DELETE fail with a raw FK-violation error,
    // check for them up front and explain exactly what's blocking, the same
    // way the incident-report and event-instruction delete routes do.
    var blockers = await pgPool.query(
      `SELECT (SELECT COUNT(*)::int FROM agency_deployments WHERE site_id = $1) AS deployments,
              (SELECT COUNT(*)::int FROM event_instructions WHERE site_id = $1) AS instructions`,
      [req.params.id]
    );
    var b = blockers.rows[0];
    if (b.deployments > 0 || b.instructions > 0) {
      var parts = [];
      if (b.deployments > 0) parts.push(b.deployments + ' deployment(s)');
      if (b.instructions > 0) parts.push(b.instructions + ' event instruction(s)');
      return res.status(400).json({
        ok: false,
        error: 'Cannot delete this site — ' + parts.join(' and ') + ' still reference it. Delete or reassign those first (an event instruction with signed acknowledgments must be archived, not deleted, to keep the compliance record).'
      });
    }

    await pgPool.query('DELETE FROM sites WHERE id = $1', [req.params.id]);
    var docsDir = path.join(SITE_DOCS_DIR, req.params.id);
    if (fs.existsSync(docsDir)) {
      try { fs.rmSync(docsDir, { recursive: true, force: true }); } catch (e) {}
    }
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SITE DOCUMENTATION ─────────────────────────────────────────────────────────
// Per-site file library: general documentation, presentations, induction packs.
// Files stay on disk under SITE_DOCS_DIR; site_documents holds only metadata
// (same split as message_attachments/incident_attachments elsewhere in this file).

function ensureSiteDocsDir(siteId) {
  var dir = path.join(SITE_DOCS_DIR, siteId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function docRowToItem(row) {
  return { filename: row.filename, originalName: row.original_name, category: row.category, size: row.size_bytes, uploadedAt: row.uploaded_at };
}

app.get('/api/sites/:id/documents', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    var r = await pgPool.query('SELECT * FROM site_documents WHERE site_id = $1 ORDER BY uploaded_at', [path.basename(req.params.id)]);
    res.json({ ok: true, items: r.rows.map(docRowToItem) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sites/:id/documents', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    var siteId = path.basename(req.params.id);
    var site = await getSiteById(siteId);
    if (!site) return res.status(404).json({ ok: false, error: 'Site not found' });

    ensureSiteDocsDir(siteId);
    var originalName = 'document';
    try { originalName = decodeURIComponent(req.headers['x-filename'] || 'document'); } catch (e) {}
    var category = req.headers['x-doc-category'] || 'documentation';
    var timestamp = Date.now().toString();
    var ext = path.extname(originalName) || '';
    var filename = timestamp + ext;
    var filePath = path.join(SITE_DOCS_DIR, siteId, filename);

    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', async function() {
      try {
        var buf = Buffer.concat(chunks);
        fs.writeFileSync(filePath, buf);

        var r = await pgPool.query(
          'INSERT INTO site_documents (site_id, filename, original_name, category, size_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [siteId, filename, originalName, category, buf.length]
        );
        res.json({ ok: true, doc: docRowToItem(r.rows[0]) });
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

app.get('/api/sites/:id/documents/:filename', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    var siteId = path.basename(req.params.id);
    var filename = path.basename(req.params.filename);
    var filePath = path.join(SITE_DOCS_DIR, siteId, filename);
    if (!fs.existsSync(filePath)) return res.status(404).end();

    var r = await pgPool.query('SELECT original_name FROM site_documents WHERE site_id = $1 AND filename = $2', [siteId, filename]);
    var originalName = r.rows.length ? r.rows[0].original_name : filename;

    res.setHeader('Content-Disposition', 'inline; filename="' + originalName.replace(/"/g, '\\"') + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(filePath));
  } catch (e) {
    res.status(500).end();
  }
});

app.delete('/api/sites/:id/documents/:filename', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    var siteId = path.basename(req.params.id);
    var filename = path.basename(req.params.filename);
    var filePath = path.join(SITE_DOCS_DIR, siteId, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await pgPool.query('DELETE FROM site_documents WHERE site_id = $1 AND filename = $2', [siteId, filename]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SITE STAFF ASSIGNMENT ─────────────────────────────────────────────────────
app.get('/api/sites/:id/staff', requireLogin, async function(req, res) {
  try {
    var siteCheck = await pgPool.query('SELECT 1 FROM sites WHERE id = $1', [req.params.id]);
    if (!siteCheck.rows.length) return res.status(404).json({ ok: false, error: 'Site not found' });
    var assignedRows = await pgPool.query('SELECT employee_legacy_id FROM site_staff_assignments WHERE site_id = $1 ORDER BY assigned_at', [req.params.id]);
    var assignedIds = assignedRows.rows.map(function(r){ return r.employee_legacy_id; });
    var allStaff = loadAllStaff();
    var assigned = allStaff.filter(function(s){ return assignedIds.indexOf(s.id) !== -1; })
      .map(function(s){ return { id: s.id, name: s.name, overall: s.overall }; });
    res.json({ ok: true, staff: assigned, count: assigned.length });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sites/:id/staff', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    var siteCheck = await pgPool.query('SELECT 1 FROM sites WHERE id = $1', [req.params.id]);
    if (!siteCheck.rows.length) return res.status(404).json({ ok: false, error: 'Site not found' });
    var staffId = String(req.body.staff_id || '').trim();
    if (!staffId) return res.status(400).json({ ok: false, error: 'staff_id required' });
    await pgPool.query(
      'INSERT INTO site_staff_assignments (site_id, employee_legacy_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, staffId]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/sites/:id/staff/:staffId', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    var siteCheck = await pgPool.query('SELECT 1 FROM sites WHERE id = $1', [req.params.id]);
    if (!siteCheck.rows.length) return res.status(404).json({ ok: false, error: 'Site not found' });
    await pgPool.query('DELETE FROM site_staff_assignments WHERE site_id = $1 AND employee_legacy_id = $2', [req.params.id, req.params.staffId]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── SITE WELFARE / ASSETS ─────────────────────────────────────────────────────
function welfareRowToItem(row) {
  return { id: row.id, name: row.name, quantity: row.quantity, condition: row.condition, serial_number: row.serial_number, notes: row.notes, image_ext: row.image_ext };
}

app.get('/api/sites/:id/welfare', requireLogin, async function(req, res) {
  try {
    var siteCheck = await pgPool.query('SELECT 1 FROM sites WHERE id = $1', [req.params.id]);
    if (!siteCheck.rows.length) return res.status(404).json({ ok: false, error: 'Site not found' });
    var r = await pgPool.query('SELECT * FROM site_welfare_items WHERE site_id = $1 ORDER BY created_at', [req.params.id]);
    res.json({ ok: true, items: r.rows.map(welfareRowToItem) });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/sites/:id/welfare', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    var siteCheck = await pgPool.query('SELECT 1 FROM sites WHERE id = $1', [req.params.id]);
    if (!siteCheck.rows.length) return res.status(404).json({ ok: false, error: 'Site not found' });
    var item = {
      id: Date.now().toString(),
      name: String(req.body.name || '').trim(),
      quantity: parseInt(req.body.quantity) || 1,
      condition: String(req.body.condition || 'good').trim(),
      serial_number: String(req.body.serial_number || '').trim(),
      notes: String(req.body.notes || '').trim(),
      image_ext: '',
    };
    if (!item.name) return res.status(400).json({ ok: false, error: 'Item name required' });
    await pgPool.query(
      `INSERT INTO site_welfare_items (id, site_id, name, quantity, condition, serial_number, notes, image_ext)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [item.id, req.params.id, item.name, item.quantity, item.condition, item.serial_number, item.notes, item.image_ext]
    );
    res.json({ ok: true, item: item });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/sites/:id/welfare/:itemId', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    var r = await pgPool.query('SELECT * FROM site_welfare_items WHERE site_id = $1 AND id = $2', [req.params.id, req.params.itemId]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Item not found' });
    var b = req.body; var o = r.rows[0];
    var updated = {
      name:          String(b.name          !== undefined ? b.name          : o.name          || '').trim(),
      quantity:      parseInt(b.quantity     !== undefined ? b.quantity      : o.quantity)    || 1,
      condition:     String(b.condition      !== undefined ? b.condition     : o.condition     || 'good').trim(),
      serial_number: String(b.serial_number  !== undefined ? b.serial_number : o.serial_number || '').trim(),
      notes:         String(b.notes          !== undefined ? b.notes         : o.notes         || '').trim(),
    };
    await pgPool.query(
      'UPDATE site_welfare_items SET name=$1, quantity=$2, condition=$3, serial_number=$4, notes=$5 WHERE site_id=$6 AND id=$7',
      [updated.name, updated.quantity, updated.condition, updated.serial_number, updated.notes, req.params.id, req.params.itemId]
    );
    res.json({ ok: true, item: { id: o.id, name: updated.name, quantity: updated.quantity, condition: updated.condition, serial_number: updated.serial_number, notes: updated.notes, image_ext: o.image_ext } });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/sites/:id/welfare/:itemId', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    var r = await pgPool.query('SELECT image_ext FROM site_welfare_items WHERE site_id = $1 AND id = $2', [req.params.id, req.params.itemId]);
    if (r.rows.length && r.rows[0].image_ext) {
      var imgPath = path.join(BASE, 'site-welfare-images', req.params.id, req.params.itemId + '.' + r.rows[0].image_ext);
      try { fs.unlinkSync(imgPath); } catch(e2) {}
    }
    await pgPool.query('DELETE FROM site_welfare_items WHERE site_id = $1 AND id = $2', [req.params.id, req.params.itemId]);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Welfare item image upload
app.post('/api/sites/:id/welfare/:itemId/image', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    var r = await pgPool.query('SELECT image_ext FROM site_welfare_items WHERE site_id = $1 AND id = $2', [req.params.id, req.params.itemId]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Item not found' });
    var chunks = [];
    req.on('data', function(c){ chunks.push(c); });
    req.on('end', async function() {
      try {
        var buf = Buffer.concat(chunks);
        var ext = 'jpg';
        if (buf[0] === 0x89 && buf[1] === 0x50) ext = 'png';
        var dir = path.join(BASE, 'site-welfare-images', req.params.id);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // remove old image if different ext
        var oldExt = r.rows[0].image_ext;
        if (oldExt && oldExt !== ext) {
          try { fs.unlinkSync(path.join(dir, req.params.itemId + '.' + oldExt)); } catch(e2) {}
        }
        fs.writeFileSync(path.join(dir, req.params.itemId + '.' + ext), buf);
        await pgPool.query('UPDATE site_welfare_items SET image_ext = $1 WHERE site_id = $2 AND id = $3', [ext, req.params.id, req.params.itemId]);
        res.json({ ok: true, image_ext: ext });
      } catch(e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Welfare item image delete
app.delete('/api/sites/:id/welfare/:itemId/image', requireLogin, requirePermission('sites'), async function(req, res) {
  try {
    var r = await pgPool.query('SELECT image_ext FROM site_welfare_items WHERE site_id = $1 AND id = $2', [req.params.id, req.params.itemId]);
    var ext = r.rows.length ? r.rows[0].image_ext : null;
    if (ext) {
      var imgPath = path.join(BASE, 'site-welfare-images', req.params.id, req.params.itemId + '.' + ext);
      try { fs.unlinkSync(imgPath); } catch(e2) {}
      await pgPool.query("UPDATE site_welfare_items SET image_ext = '' WHERE site_id = $1 AND id = $2", [req.params.id, req.params.itemId]);
    }
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Welfare item image serve
app.get('/api/sites/:id/welfare/:itemId/image', requireLogin, async function(req, res) {
  try {
    var r = await pgPool.query('SELECT image_ext FROM site_welfare_items WHERE site_id = $1 AND id = $2', [req.params.id, req.params.itemId]);
    if (!r.rows.length || !r.rows[0].image_ext) return res.status(404).end();
    var imgPath = path.join(BASE, 'site-welfare-images', req.params.id, req.params.itemId + '.' + r.rows[0].image_ext);
    if (!fs.existsSync(imgPath)) return res.status(404).end();
    var mime = r.rows[0].image_ext === 'png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(imgPath));
  } catch(e) {
    res.status(500).end();
  }
});

app.put('/api/staff/:id', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var emp = req.body;
    await saveStaff(emp, null);
    updateComplianceTracker(emp);
    updateReferenceTracker(emp);
    refreshOverview();
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/staff', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var emp = req.body;
    var confirmDifferentPerson = !!emp.confirmDifferentPerson;
    delete emp.confirmDifferentPerson;
    if (!emp.id) emp.id = emp.name.toLowerCase().replace(/[^a-z0-9]/g,'-');

    // "Add Staff" must only ever create a NEW record. Without this check,
    // submitting the same name again (e.g. someone re-adding a person who
    // looked like they'd disappeared, per the Abu Baker incident) silently
    // overwrites that person's existing record — destroying their real SIA/
    // CSCS/RTW data with whatever bare fields were in this new submission,
    // with no warning. Matched by NAME ONLY. Queried fresh from Postgres,
    // not STAFF_CACHE — this exact guard exists to catch cases where
    // something already caused a person to seem hidden/missing, so it must
    // never trust a cache that could be part of that same problem.
    var addTargetName = safeName(emp.name).toUpperCase();
    var activeNames = (await pgPool.query("SELECT name FROM employees WHERE status = 'active'")).rows;
    var addCollision = activeNames.some(function(r) { return safeName(r.name).toUpperCase() === addTargetName; });

    if (addCollision && !confirmDifferentPerson) {
      // Two different people can genuinely share a name — don't just block
      // outright. Send back the existing person's basic details so the UI
      // can show a side-by-side comparison and let the admin decide: edit
      // the existing profile (the usual case, and what the original bug
      // used to do by accident), or confirm this really is someone else.
      var existing = loadAllStaff().find(function(e){ return safeName(e.name).toUpperCase() === addTargetName; });
      return res.status(409).json({
        ok: false,
        sameNameConflict: true,
        error: 'A staff member named "' + emp.name + '" already has an active profile.',
        existing: existing ? {
          id: existing.id, name: existing.name, phone: existing.phone || null,
          email: existing.email || null, nationality: existing.nationality || null,
          jobRole: existing.jobRole || null,
        } : null,
      });
    }

    if (addCollision && confirmDifferentPerson) {
      // Confirmed as a different person with the same name — disambiguate
      // the STORED id (legacy_id must stay unique), never the displayed name.
      var suffixN = await nextFreeIdSuffix(emp.id);
      emp.id = emp.id + '-' + suffixN;
    }

    await saveStaff(emp, null);
    updateComplianceTracker(emp);
    updateReferenceTracker(emp);
    refreshOverview();

    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/staff/:id', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._pgId) return res.status(404).json({ ok: false, error: 'Staff not found' });

    // No same-name-in-Ex-Staff collision check needed any more — each
    // employees row has its own UUID, so there's nothing left for two
    // archived people sharing a name to actually collide on.
    await pgPool.query("UPDATE employees SET status='archived', archived_at=NOW(), archive_reason='left_employment' WHERE id=$1", [emp._pgId]);
    await refreshStaffCacheEntry(emp._pgId);
    refreshOverview();

    console.log('[DELETE] Archived (moved to Ex-Staff):', emp.name);
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/exstaff', requireLogin, requirePermission('staff'), function(req, res) {
  try {
    var list = loadExStaff().map(function(e) {
      return { folderId: e.id, name: e.name || e.id, nationality: e.nationality || '', gender: e.gender || '', overall: e.overall || 'unknown' };
    });
    list.sort(function(a,b){ return a.name.localeCompare(b.name); });
    res.json(list);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// Permanently delete an ex-staff record (director only). Retention-guarded:
// BS7858/GDPR expect vetting records kept ~7 years after someone leaves, and
// migrating this off a filesystem move (fs.rmSync) onto a one-line DELETE
// made it structurally easier to invoke than before — this guard exists so
// that ease doesn't translate into an easier compliance mistake. A record
// with no recorded archive date (migrated in before this safeguard existed)
// can never be confirmed to have cleared retention, so it's never eligible.
app.delete('/api/exstaff/permanent', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var legacyId = req.body.folderId;
    if (!legacyId) return res.status(400).json({ ok: false, error: 'No folderId provided' });
    var r = await pgPool.query("SELECT id, name, archived_at FROM employees WHERE legacy_id = $1 AND status = 'archived'", [legacyId]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Ex-staff record not found' });
    var row = r.rows[0];

    var archivedAt = row.archived_at ? new Date(row.archived_at) : null;
    var retentionCutoff = new Date();
    retentionCutoff.setFullYear(retentionCutoff.getFullYear() - 7);
    if (!archivedAt || archivedAt > retentionCutoff) {
      return res.status(403).json({
        ok: false,
        error: archivedAt
          ? 'Archived on ' + archivedAt.toISOString().slice(0, 10) + ' — BS7858/GDPR requires keeping vetting records for 7 years. Not eligible for permanent deletion until ' +
            new Date(archivedAt.getFullYear() + 7, archivedAt.getMonth(), archivedAt.getDate()).toISOString().slice(0, 10) + '.'
          : 'No recorded archive date on file (this record predates this safeguard) — it can never be confirmed to have cleared the 7-year retention period, so it cannot be permanently deleted.',
      });
    }

    var confirmPhrase = String(req.body.confirmPhrase || '').trim();
    if (confirmPhrase !== row.name) {
      return res.status(400).json({ ok: false, error: 'Type the staff member\'s full name exactly to confirm permanent deletion.', requiresConfirmPhrase: row.name });
    }

    await pgPool.query('DELETE FROM employees WHERE id = $1', [row.id]);
    await pgPool.query(
      `INSERT INTO audit_events (actor_email, action, object_type, object_id, object_name, metadata)
       VALUES ($1,'STAFF_PERMANENTLY_DELETED','employee',$2,$3,$4)`,
      [(req.user && req.user.username) || null, row.id, row.name, JSON.stringify({ legacy_id: legacyId, archived_at: row.archived_at })]
    );
    STAFF_CACHE = STAFF_CACHE.filter(function(e) { return e._pgId !== row.id; });

    console.log('[DELETE] Permanently deleted ex-staff:', row.name);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/exstaff/restore', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var legacyId = req.body.folderId;
    if (!legacyId) return res.status(400).json({ ok: false, error: 'No folderId provided' });

    var r = await pgPool.query("SELECT id, name FROM employees WHERE legacy_id = $1 AND status = 'archived'", [legacyId]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Ex-staff record not found' });

    await pgPool.query("UPDATE employees SET status='active', archived_at=NULL, archive_reason=NULL WHERE id=$1", [r.rows[0].id]);
    await refreshStaffCacheEntry(r.rows[0].id);
    refreshOverview();

    console.log('[RESTORE] ' + r.rows[0].name + ' moved back to Active Staff');
    res.json({ ok: true, name: r.rows[0].name });
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

// ── VEHICLES ──────────────────────────────────────────────────────────────────
// Postgres-backed (see ensureVehiclesExtendedSchema above). VEHICLES_FILE is
// no longer read by any route below — kept only as the source path for the
// one-time migrate-vehicles.js script.
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
async function getVehicleById(id) {
  var r = await pgPool.query(VEHICLE_JOIN_SQL + " WHERE v.id = $1", [id]);
  return r.rows.length ? attachHasPhoto(r.rows[0]) : null;
}

async function setVehicleComplianceDate(vehicleId, docType, expiryDate) {
  var existing = await pgPool.query(
    'SELECT id FROM vehicle_compliance WHERE vehicle_id = $1 AND document_type = $2 ORDER BY created_at DESC LIMIT 1',
    [vehicleId, docType]
  );
  if (!expiryDate) {
    if (existing.rows.length) await pgPool.query('DELETE FROM vehicle_compliance WHERE id = $1', [existing.rows[0].id]);
    return;
  }
  if (existing.rows.length) {
    await pgPool.query('UPDATE vehicle_compliance SET expiry_date = $1 WHERE id = $2', [expiryDate, existing.rows[0].id]);
  } else {
    await pgPool.query('INSERT INTO vehicle_compliance (vehicle_id, document_type, expiry_date) VALUES ($1,$2,$3)', [vehicleId, docType, expiryDate]);
  }
}

var VEHICLE_COMPLIANCE_FIELD_MAP = [['mot_expiry', 'MOT'], ['insurance_expiry', 'INSURANCE'], ['road_tax_expiry', 'ROAD_TAX'], ['service_due', 'SERVICE']];

async function applyVehicleComplianceFields(vehicleId, b, isCreate) {
  for (var i = 0; i < VEHICLE_COMPLIANCE_FIELD_MAP.length; i++) {
    var key = VEHICLE_COMPLIANCE_FIELD_MAP[i][0], docType = VEHICLE_COMPLIANCE_FIELD_MAP[i][1];
    if (isCreate) {
      if (b[key]) await setVehicleComplianceDate(vehicleId, docType, b[key]);
    } else if (b[key] !== undefined) {
      await setVehicleComplianceDate(vehicleId, docType, b[key] || null);
    }
  }
}

// vehicle_assignments models assignment HISTORY (assigned_date/unassigned_date)
// rather than a flat field — "current driver" is whichever row has no
// unassigned_date yet. Closing the old row before opening a new one keeps
// that invariant (at most one open assignment per vehicle) intact.
async function setVehicleDriver(vehicleId, newLegacyId) {
  var openRow = await pgPool.query(
    "SELECT va.id, e.legacy_id FROM vehicle_assignments va JOIN employees e ON e.id = va.employee_id " +
    "WHERE va.vehicle_id = $1 AND va.unassigned_date IS NULL ORDER BY va.assigned_date DESC LIMIT 1",
    [vehicleId]
  );
  var currentLegacyId = openRow.rows.length ? openRow.rows[0].legacy_id : null;
  if ((newLegacyId || null) === currentLegacyId) return;
  if (openRow.rows.length) {
    await pgPool.query('UPDATE vehicle_assignments SET unassigned_date = CURRENT_DATE WHERE id = $1', [openRow.rows[0].id]);
  }
  if (newLegacyId) {
    var empId = await resolveEmpId(newLegacyId);
    // Silently no-op if the legacy id doesn't resolve to an employees row —
    // mirrors the old system's total lack of validation on this field rather
    // than 500ing an otherwise-valid PATCH over one bad driver id.
    if (empId) {
      await pgPool.query('INSERT INTO vehicle_assignments (vehicle_id, employee_id, is_primary_driver) VALUES ($1,$2,true)', [vehicleId, empId]);
    }
  }
}

function vehicleDocRowToItem(row) {
  return { filename: row.filename, originalName: row.original_name, docType: row.doc_type, size: row.size_bytes, uploadedAt: row.uploaded_at };
}

app.get('/api/vehicles', requireLogin, requirePermission('fleet'), async function(req, res) {
  try {
    res.json({ vehicles: await loadVehicles() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/vehicles', requireLogin, requirePermission('fleet'), async function(req, res) {
  try {
    var b = req.body || {};
    var registration = String(b.registration || '').trim();
    if (!registration) return res.status(400).json({ ok: false, error: 'Registration is required' });
    var r = await pgPool.query(
      `INSERT INTO vehicles (legacy_id, registration, make, model, vehicle_type, year, colour, status, notes, mileage)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [Date.now().toString(), registration, b.make || null, b.model || null, b.type || 'other',
       b.year || null, b.colour || null, b.status || 'active', b.notes || null, b.mileage || null]
    );
    var vehicleId = r.rows[0].id;
    await applyVehicleComplianceFields(vehicleId, b, true);
    if (b.assignedDriverId) await setVehicleDriver(vehicleId, b.assignedDriverId);
    res.json({ ok: true, vehicle: await getVehicleById(vehicleId) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/vehicles/:id', requireLogin, requirePermission('fleet'), async function(req, res) {
  try {
    var existing = await pgPool.query('SELECT id FROM vehicles WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Vehicle not found' });

    var b = req.body || {};
    var colMap = { registration: 'registration', make: 'make', model: 'model', type: 'vehicle_type', year: 'year', colour: 'colour', status: 'status', notes: 'notes', mileage: 'mileage' };
    var sets = []; var params = []; var i = 1;
    Object.keys(colMap).forEach(function(jsonKey) {
      if (b[jsonKey] !== undefined) { sets.push(colMap[jsonKey] + ' = $' + i); params.push(b[jsonKey]); i++; }
    });
    if (sets.length) {
      params.push(req.params.id);
      await pgPool.query('UPDATE vehicles SET ' + sets.join(', ') + ', updated_at = NOW() WHERE id = $' + i, params);
    }
    await applyVehicleComplianceFields(req.params.id, b, false);
    if (b.assignedDriverId !== undefined) await setVehicleDriver(req.params.id, b.assignedDriverId || null);
    res.json({ ok: true, vehicle: await getVehicleById(req.params.id) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/vehicles/:id', requireLogin, requirePermission('fleet'), async function(req, res) {
  try {
    // ON DELETE CASCADE on vehicle_compliance/vehicle_assignments/vehicle_documents
    // handles the DB-side child rows; photo + docs dir are filesystem concerns.
    await pgPool.query('DELETE FROM vehicles WHERE id = $1', [req.params.id]);
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

app.post('/api/vehicles/:id/photo', requireLogin, requirePermission('fleet'), async function(req, res) {
  try {
    var existing = await pgPool.query('SELECT id FROM vehicles WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Vehicle not found' });

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
      res.json({ ok: true });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── VEHICLE DOCUMENTS ─────────────────────────────────────────────────────────

app.get('/api/vehicles/:id/docs', requireLogin, requirePermission('fleet'), async function(req, res) {
  try {
    var r = await pgPool.query('SELECT * FROM vehicle_documents WHERE vehicle_id = $1 ORDER BY uploaded_at', [req.params.id]);
    res.json(r.rows.map(vehicleDocRowToItem));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/vehicles/:id/docs', requireLogin, requirePermission('fleet'), async function(req, res) {
  try {
    var existing = await pgPool.query('SELECT id FROM vehicles WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Vehicle not found' });

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
    req.on('end', async function() {
      try {
        var buf = Buffer.concat(chunks);
        fs.writeFileSync(filePath, buf);

        var r = await pgPool.query(
          'INSERT INTO vehicle_documents (vehicle_id, filename, original_name, doc_type, size_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [req.params.id, filename, originalName, docType, buf.length]
        );
        res.json({ ok: true, doc: vehicleDocRowToItem(r.rows[0]) });
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

app.get('/api/vehicles/:id/docs/:filename', requireLogin, async function(req, res) {
  try {
    var filename = path.basename(req.params.filename);
    var filePath = path.join(VEHICLE_DOCS_DIR, req.params.id, filename);
    if (!fs.existsSync(filePath)) return res.status(404).end();

    var r = await pgPool.query('SELECT original_name FROM vehicle_documents WHERE vehicle_id = $1 AND filename = $2', [req.params.id, filename]);
    var originalName = r.rows.length ? r.rows[0].original_name : filename;

    res.setHeader('Content-Disposition', 'attachment; filename="' + originalName.replace(/"/g, '\\"') + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(filePath));
  } catch (e) {
    res.status(500).end();
  }
});

app.delete('/api/vehicles/:id/docs/:filename', requireLogin, requirePermission('fleet'), async function(req, res) {
  try {
    var filename = path.basename(req.params.filename);
    var filePath = path.join(VEHICLE_DOCS_DIR, req.params.id, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await pgPool.query('DELETE FROM vehicle_documents WHERE vehicle_id = $1 AND filename = $2', [req.params.id, filename]);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── FLEET EXCEL EXPORTS ───────────────────────────────────────────────────────
app.get('/api/vehicles/export', requireLogin, requirePermission('fleet'), async function(req, res) {
  try {
    var all = await loadVehicles();
    var staff = loadAllStaff();
    var ids = req.query.ids ? String(req.query.ids).split(',') : null;
    var list = ids ? all.filter(function(v) { return ids.indexOf(v.id) !== -1; }) : all;

    var statusFilter = req.query.status ? String(req.query.status) : null;
    if (statusFilter) list = list.filter(function(v) { return v.status === statusFilter; });

    var typeFilter = req.query.type ? String(req.query.type) : null;
    if (typeFilter) list = list.filter(function(v) { return v.type === typeFilter; });

    var rows = list.map(function(v) {
      var driver = staff.find(function(s) { return s.id === v.assignedDriverId; });
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
        'Assigned Driver': driver ? driver.name : '',
      };
    });
    sendXlsx(res, 'GuardTec-Fleet-Report-' + new Date().toISOString().slice(0,10) + '.xlsx', rows);
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
    var pwError = passwordStrengthError(password);
    if (pwError) return res.status(400).json({ ok: false, error: pwError });
    if (await isPasswordBreached(password)) return res.status(400).json({ ok: false, error: 'That password has appeared in a known data breach. Please choose a different one.' });

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
    var pwError = passwordStrengthError(password);
    if (pwError) return res.status(400).json({ ok: false, error: pwError });
    if (await isPasswordBreached(password)) return res.status(400).json({ ok: false, error: 'That password has appeared in a known data breach. Please choose a different one.' });
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

// ── AGENCY MANAGEMENT ─────────────────────────────────────────────────────────
// Admin side of the agency cover-guard feature. An agency's login is just a
// users row with role='agency' + agency_id — same auth system as everyone
// else (see requireOwnAgencyOrPermission above), no separate password system.
function slugifyAgencyUsername(name) {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'agency';
}

function generateTempPassword() {
  return crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
}

app.post('/api/agencies', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var b = req.body;
    var name  = String(b.name  || '').trim();
    var email = String(b.email || '').trim().toLowerCase();
    var phone = String(b.phone || '').trim();

    if (!name)  return res.status(400).json({ ok: false, error: 'Agency name is required.' });
    if (!email) return res.status(400).json({ ok: false, error: 'Agency email is required.' });

    var agencyResult = await pgPool.query(
      'INSERT INTO agencies (name, email, phone, created_by) VALUES ($1,$2,$3,$4) RETURNING id, name, email, phone, status, created_at',
      [name, email, phone, req.user.id]
    );
    var agency = agencyResult.rows[0];

    var baseUsername = slugifyAgencyUsername(name);
    var username = baseUsername;
    var suffix = 1;
    while ((await pgPool.query('SELECT id FROM users WHERE username = $1', [username])).rows.length) {
      suffix++;
      username = baseUsername + suffix;
    }

    var tempPassword = generateTempPassword();
    var hash = await bcrypt.hash(tempPassword, 10);

    try {
      await pgPool.query(
        'INSERT INTO users (username, password_hash, full_name, role, email, is_active, agency_id) VALUES ($1,$2,$3,$4,$5,TRUE,$6)',
        [username, hash, name, 'agency', email, agency.id]
      );
    } catch (userErr) {
      // Login account creation failed — don't leave an orphaned agency row behind.
      await pgPool.query('DELETE FROM agencies WHERE id = $1', [agency.id]);
      throw userErr;
    }

    res.json({ ok: true, id: agency.id, login_username: username, temp_password: tempPassword });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/agencies', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var result = await pgPool.query(
      `SELECT a.id, a.name, a.email, a.phone, a.status, a.created_at,
              COUNT(s.id) FILTER (WHERE s.status = 'active') AS staff_count
       FROM agencies a
       LEFT JOIN agency_staff s ON s.agency_id = a.id
       GROUP BY a.id
       ORDER BY a.name`
    );
    res.json({ ok: true, agencies: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/agencies/:id', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var agencyResult = await pgPool.query(
      'SELECT id, name, email, phone, status, created_at, archived_at, notes FROM agencies WHERE id = $1',
      [req.params.id]
    );
    if (!agencyResult.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });

    var staffResult = await pgPool.query(
      'SELECT * FROM agency_staff WHERE agency_id = $1 ORDER BY name',
      [req.params.id]
    );
    var staffWithStatus = staffResult.rows.map(function(row) {
      row.compliance_status = calculateComplianceStatus(row);
      return row;
    });

    res.json({ ok: true, agency: agencyResult.rows[0], staff: staffWithStatus });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/agencies/:id', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var b = req.body;
    var name  = String(b.name  || '').trim();
    var email = String(b.email || '').trim().toLowerCase();
    var phone = String(b.phone || '').trim();

    if (!name)  return res.status(400).json({ ok: false, error: 'Agency name is required.' });
    if (!email) return res.status(400).json({ ok: false, error: 'Agency email is required.' });

    var r = await pgPool.query(
      'UPDATE agencies SET name=$1, email=$2, phone=$3 WHERE id=$4 RETURNING id, name, email, phone, status, created_at',
      [name, email, phone, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });
    res.json({ ok: true, agency: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/agencies/:id/archive', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var r = await pgPool.query(
      "UPDATE agencies SET status='archived', archived_at=NOW() WHERE id=$1 RETURNING id",
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });
    // Suspend the agency's own login too — an archived agency shouldn't still be able to sign in.
    await pgPool.query("UPDATE users SET is_active=FALSE WHERE agency_id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/agencies/:id/reactivate', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var r = await pgPool.query(
      "UPDATE agencies SET status='active', archived_at=NULL WHERE id=$1 RETURNING id",
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });
    await pgPool.query("UPDATE users SET is_active=TRUE WHERE agency_id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Permanent delete — director-only. Removes the agency, every one of its
// guards (agency_staff cascades via agency_id ON DELETE CASCADE, which in
// turn cascades unavailability/documents/custom_documents rows), the
// agency's own login account, and every file on disk. Intended for purging
// test/duplicate agencies, not routine offboarding — archive is that, and
// stays available above.
app.delete('/api/agencies/:id', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var agencyId = req.params.id;
    var agencyResult = await pgPool.query('SELECT * FROM agencies WHERE id = $1', [agencyId]);
    if (!agencyResult.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });
    var agency = agencyResult.rows[0];

    // agency_deployments.agency_id and deployment_attendance.agency_staff_id
    // both have NO cascade (real booking/attendance history) — check up
    // front rather than let the DELETE below fail with a raw Postgres
    // FK-violation message, same reasoning as the site-delete guard.
    var blockers = await pgPool.query(
      `SELECT (SELECT COUNT(*)::int FROM agency_deployments WHERE agency_id = $1) AS deployments,
              (SELECT COUNT(*)::int FROM deployment_attendance da JOIN agency_staff s ON s.id = da.agency_staff_id WHERE s.agency_id = $1) AS attendance`,
      [agencyId]
    );
    var bl = blockers.rows[0];
    if (bl.deployments > 0 || bl.attendance > 0) {
      var blParts = [];
      if (bl.deployments > 0) blParts.push(bl.deployments + ' deployment(s)');
      if (bl.attendance > 0) blParts.push(bl.attendance + ' attendance record(s)');
      return res.status(400).json({
        ok: false,
        error: 'Cannot delete this agency — ' + blParts.join(' and ') + ' still reference it. Remove those first, or archive the agency instead of deleting.'
      });
    }

    var staffRows = await pgPool.query('SELECT id FROM agency_staff WHERE agency_id = $1', [agencyId]);
    var customDocs = await pgPool.query(
      `SELECT d.agency_staff_id, d.filename FROM agency_staff_custom_documents d
       JOIN agency_staff s ON s.id = d.agency_staff_id
       WHERE s.agency_id = $1`, [agencyId]
    );
    var customDocsByStaff = {};
    customDocs.rows.forEach(function(d) {
      (customDocsByStaff[d.agency_staff_id] = customDocsByStaff[d.agency_staff_id] || []).push(d.filename);
    });

    await pgPool.query('DELETE FROM agencies WHERE id = $1', [agencyId]); // cascades agency_staff and its children
    await pgPool.query('DELETE FROM users WHERE agency_id = $1', [agencyId]); // the agency's own login

    staffRows.rows.forEach(function(s) {
      purgeAgencyStaffFiles(s.id, customDocsByStaff[s.id]);
    });

    await pgPool.query(
      `INSERT INTO audit_events (actor_email, action, object_type, object_id, object_name, metadata)
       VALUES ($1,'AGENCY_DELETED','agency',$2,$3,$4)`,
      [(req.user && req.user.username) || null, agency.id, agency.name,
       JSON.stringify({ staff_count: staffRows.rows.length, status: agency.status })]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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

// CSV/XLSX headers can come in as "Job Role", "job_role", "JobRole", etc. —
// normalize to a flat lowercase-alnum key before mapping onto our fields.
function normalizeCsvRow(row) {
  var norm = {};
  Object.keys(row).forEach(function(k) {
    var key = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
    norm[key] = row[k];
  });
  return {
    name:        norm.name,
    email:       norm.email,
    phone:       norm.phone,
    nationality: norm.nationality,
    job_role:    norm.jobrole || norm.role,
    custom_role: norm.customrole,
    badge_type:  norm.badgetype,
    dbs_expiry:  norm.dbsexpiry !== undefined ? norm.dbsexpiry : norm.dbsexpirydate,
    sia_expiry:  norm.siaexpiry !== undefined ? norm.siaexpiry : norm.siaexpirydate,
    cscs_expiry: norm.cscsexpiry !== undefined ? norm.cscsexpiry : norm.cscsexpirydate,
  };
}

// Role-conditional BS7858 compliance (debug note #6) — a cert only counts
// against a guard if their job_role actually requires it, so e.g. a Door
// Supervisor is never flagged "incomplete" for a missing Dog Handler cert.
// SIA and CSCS expiry are unconditionally required for every guard as of
// 2026-08-20 (user's explicit decision — badge_type no longer gates this,
// it's kept purely as informational metadata since a guard can hold other
// badges like CCTV/Close Protection too). dbs_expiry became optional in the
// same change — a blank one is no longer counted as a problem, but a
// present-and-expired one still is, same as before. Priority worst-first:
// EXPIRED beats INCOMPLETE beats ACTION_NEEDED beats COMPLIANT.
function expiryCheck(dateVal, requiredFlag) {
  if (!dateVal) return requiredFlag ? 'missing' : 'n/a';
  // daysFrom() takes anything `new Date()` accepts, which covers both a
  // plain date string and the JS Date object pg returns for a DATE column.
  var days = daysFrom(dateVal);
  if (days === null || isNaN(days)) return requiredFlag ? 'missing' : 'n/a';
  if (days < 0) return 'expired';
  if (days <= 30) return 'warning';
  return 'ok';
}

function calculateComplianceStatus(staff) {
  var required = {
    dbs: false,
    sia: true,
    cscs: true,
    rtw: true,
    dog_handler: staff.job_role === 'Dog Handler',
    training: true,
  };

  var checks = {
    dbs:         expiryCheck(staff.dbs_expiry, required.dbs),
    sia:         !required.sia  ? 'n/a' : (staff.sia_cert_uploaded  ? 'ok' : 'missing'),
    sia_expiry:  expiryCheck(staff.sia_expiry, required.sia),
    cscs:        !required.cscs ? 'n/a' : (staff.cscs_cert_uploaded ? 'ok' : 'missing'),
    cscs_expiry: expiryCheck(staff.cscs_expiry, required.cscs),
    rtw:         !required.rtw         ? 'n/a' : (staff.rtw_cert_uploaded         ? 'ok' : 'missing'),
    dog_handler: !required.dog_handler ? 'n/a' : (staff.dog_handler_cert_uploaded ? 'ok' : 'missing'),
    training:    !required.training    ? 'n/a' : (staff.training_cert_uploaded    ? 'ok' : 'missing'),
  };

  var active = Object.keys(checks).map(function(k) { return checks[k]; }).filter(function(c) { return c !== 'n/a'; });
  if (active.indexOf('expired') !== -1) return 'EXPIRED';
  if (active.indexOf('missing') !== -1) return 'INCOMPLETE';
  if (active.indexOf('warning') !== -1) return 'ACTION_NEEDED';
  return 'COMPLIANT';
}

// ── Agency Staff: Registration (CRUD) ─────────────────────────────────────────
app.post('/api/agencies/:agencyId/staff', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var agencyId = req.params.agencyId;
    var agencyCheck = await pgPool.query('SELECT id FROM agencies WHERE id = $1', [agencyId]);
    if (!agencyCheck.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });

    var b = req.body || {};
    var name    = String(b.name     || '').trim();
    var jobRole = String(b.job_role || '').trim();
    if (!name)    return res.status(400).json({ ok: false, error: 'Guard name is required.' });
    if (!jobRole) return res.status(400).json({ ok: false, error: 'Job role is required.' });
    // Attestation, not the guard's own click (no login exists for guards to
    // click anything themselves) — the agency confirms it has informed the
    // guard and obtained their consent before this record can be created.
    if (!b.consent_credit_check)       return res.status(400).json({ ok: false, error: 'You must confirm the guard has consented to a credit check.' });
    if (!b.consent_social_media_check) return res.status(400).json({ ok: false, error: 'You must confirm the guard has consented to a social media check.' });

    var email       = String(b.email       || '').trim().toLowerCase();
    var phone       = String(b.phone       || '').trim();
    var nationality = String(b.nationality || '').trim();
    var customRole  = String(b.custom_role || '').trim();
    var badgeType   = String(b.badge_type  || '').trim();
    var dbsExpiry   = b.dbs_expiry ? String(b.dbs_expiry).trim() : null;
    var siaExpiry   = b.sia_expiry  ? String(b.sia_expiry).trim()  : null;
    var cscsExpiry  = b.cscs_expiry ? String(b.cscs_expiry).trim() : null;
    // Mandatory for every guard regardless of badge_type — see the note on
    // calculateComplianceStatus. dbs_expiry deliberately has no such check.
    if (!siaExpiry)  return res.status(400).json({ ok: false, error: 'SIA expiry is required.' });
    if (!cscsExpiry) return res.status(400).json({ ok: false, error: 'CSCS expiry is required.' });

    var r = await pgPool.query(
      `INSERT INTO agency_staff (agency_id, name, email, phone, nationality, job_role, custom_role, badge_type, dbs_expiry, sia_expiry, cscs_expiry, consent_credit_check, consent_social_media_check)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,TRUE) RETURNING *`,
      [agencyId, name, email, phone, nationality, jobRole, customRole || null, badgeType || null, dbsExpiry, siaExpiry, cscsExpiry]
    );
    var staff = r.rows[0];
    staff.compliance_status = calculateComplianceStatus(staff);
    res.json({ ok: true, staff: staff });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/agencies/:agencyId/staff', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var includeArchived = req.query.status === 'all';
    var sql = 'SELECT * FROM agency_staff WHERE agency_id = $1' +
      (includeArchived ? '' : " AND status = 'active'") + ' ORDER BY name';
    var r = await pgPool.query(sql, [req.params.agencyId]);
    var staff = r.rows.map(function(row) {
      row.compliance_status = calculateComplianceStatus(row);
      return row;
    });
    res.json({ ok: true, staff: staff });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/agencies/:agencyId/staff/:id', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var r = await pgPool.query('SELECT * FROM agency_staff WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
    var staff = r.rows[0];
    staff.compliance_status = calculateComplianceStatus(staff);
    var unavail = await pgPool.query(
      'SELECT id, date_from, date_to, reason, created_at FROM agency_staff_unavailability WHERE agency_staff_id = $1 ORDER BY date_from',
      [req.params.id]
    );
    res.json({ ok: true, staff: staff, unavailability: unavail.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/agencies/:agencyId/staff/:id', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var existing = await pgPool.query('SELECT * FROM agency_staff WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
    if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
    var o = existing.rows[0];
    var b = req.body || {};

    var name        = String(b.name        !== undefined ? b.name        : o.name        || '').trim();
    var email       = String(b.email       !== undefined ? b.email       : o.email       || '').trim().toLowerCase();
    var phone       = String(b.phone       !== undefined ? b.phone       : o.phone       || '').trim();
    var nationality = String(b.nationality !== undefined ? b.nationality : o.nationality || '').trim();
    var jobRole     = String(b.job_role    !== undefined ? b.job_role    : o.job_role    || '').trim();
    var customRole  = String(b.custom_role !== undefined ? b.custom_role : o.custom_role || '').trim();
    var badgeType   = String(b.badge_type  !== undefined ? b.badge_type  : o.badge_type  || '').trim();
    var dbsExpiry   = b.dbs_expiry !== undefined ? (b.dbs_expiry || null) : o.dbs_expiry;
    var siaExpiry   = b.sia_expiry  !== undefined ? (b.sia_expiry  || null) : o.sia_expiry;
    var cscsExpiry  = b.cscs_expiry !== undefined ? (b.cscs_expiry || null) : o.cscs_expiry;

    if (!name)       return res.status(400).json({ ok: false, error: 'Guard name is required.' });
    if (!jobRole)    return res.status(400).json({ ok: false, error: 'Job role is required.' });
    if (!siaExpiry)  return res.status(400).json({ ok: false, error: 'SIA expiry is required.' });
    if (!cscsExpiry) return res.status(400).json({ ok: false, error: 'CSCS expiry is required.' });

    var r = await pgPool.query(
      `UPDATE agency_staff SET name=$1, email=$2, phone=$3, nationality=$4, job_role=$5, custom_role=$6, badge_type=$7, dbs_expiry=$8, sia_expiry=$9, cscs_expiry=$10, updated_at=NOW()
       WHERE id=$11 RETURNING *`,
      [name, email, phone, nationality, jobRole, customRole || null, badgeType || null, dbsExpiry, siaExpiry, cscsExpiry, req.params.id]
    );
    var staff = r.rows[0];
    staff.compliance_status = calculateComplianceStatus(staff);
    res.json({ ok: true, staff: staff });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Soft delete only (debug note #7) — no hard DELETE, so deployment/acknowledgment
// history for this guard stays queryable.
app.post('/api/agencies/:agencyId/staff/:id/archive', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var r = await pgPool.query(
      "UPDATE agency_staff SET status='archived', archived_at=NOW() WHERE id=$1 AND agency_id=$2 RETURNING id",
      [req.params.id, req.params.agencyId]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Permanent delete — director-only. Unlike archive above, this actually
// removes the row (and, via ON DELETE CASCADE, its unavailability/documents
// rows) plus every file on disk. Intended for purging test/duplicate agency
// guard records, not as a routine offboarding action — archive is that.
app.delete('/api/agencies/:agencyId/staff/:id', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var agencyId = req.params.agencyId;
    var staffId  = req.params.id;
    var r = await pgPool.query('SELECT * FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, agencyId]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
    var guard = r.rows[0];

    // deployment_attendance.agency_staff_id has NO cascade (it's real hours-
    // worked/no-show history feeding the agency performance stats) — check
    // for it up front rather than let the DELETE below fail with a raw
    // Postgres FK-violation message, same reasoning as the site-delete guard.
    var attendance = await pgPool.query('SELECT COUNT(*)::int AS n FROM deployment_attendance WHERE agency_staff_id = $1', [staffId]);
    if (attendance.rows[0].n > 0) {
      return res.status(400).json({
        ok: false,
        error: 'Cannot delete ' + guard.name + ' — ' + attendance.rows[0].n + ' deployment attendance record(s) reference them. Remove those attendance entries from the relevant deployment(s) first, or archive this guard instead of deleting.'
      });
    }

    var customDocs = await pgPool.query(
      'SELECT filename FROM agency_staff_custom_documents WHERE agency_staff_id = $1', [staffId]
    );

    await pgPool.query('DELETE FROM agency_staff WHERE id = $1', [staffId]); // cascades unavailability/documents/custom_documents rows

    purgeAgencyStaffFiles(staffId, customDocs.rows.map(function(d) { return d.filename; }));

    await pgPool.query(
      `INSERT INTO audit_events (actor_email, action, object_type, object_id, object_name, metadata)
       VALUES ($1,'AGENCY_STAFF_DELETED','agency_staff',$2,$3,$4)`,
      [(req.user && req.user.username) || null, guard.id, guard.name, JSON.stringify({ agency_id: agencyId, status: guard.status })]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Agency Staff: Bulk CSV Import ─────────────────────────────────────────────
// No multipart parser in this codebase (no multer) — same raw chunked-body
// convention as every other upload route here. xlsx is already a dependency
// and its reader auto-detects plain CSV text as well as real .xlsx binaries,
// so no new package is needed.
app.post('/api/agencies/:agencyId/staff/import-csv', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var agencyId = req.params.agencyId;
    var agencyCheck = await pgPool.query('SELECT id FROM agencies WHERE id = $1', [agencyId]);
    if (!agencyCheck.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });

    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', async function() {
      try {
        var buf = Buffer.concat(chunks);
        var wb;
        try {
          wb = XLSX.read(buf, { type: 'buffer' });
        } catch (parseErr) {
          return res.status(400).json({ ok: false, error: 'Could not parse file as CSV/Excel: ' + parseErr.message });
        }
        var sheetName = wb.SheetNames[0];
        if (!sheetName) return res.status(400).json({ ok: false, error: 'No data found in file.' });
        var ws = wb.Sheets[sheetName];
        var rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' });

        var importedCount = 0;
        var errors = [];

        for (var i = 0; i < rawRows.length; i++) {
          var rowNum = i + 2; // header occupies row 1
          try {
            var norm = normalizeCsvRow(rawRows[i]);
            var name    = sanitizeForExcel(String(norm.name     || '').trim());
            var jobRole = sanitizeForExcel(String(norm.job_role || '').trim());
            if (!name)    { errors.push({ row: rowNum, error: 'Missing name' });     continue; }
            if (!jobRole) { errors.push({ row: rowNum, error: 'Missing job_role' }); continue; }

            var email       = sanitizeForExcel(String(norm.email       || '').trim().toLowerCase());
            var phone       = sanitizeForExcel(String(norm.phone       || '').trim());
            var nationality = sanitizeForExcel(String(norm.nationality || '').trim());
            var customRole  = sanitizeForExcel(String(norm.custom_role || '').trim());
            var badgeType   = sanitizeForExcel(String(norm.badge_type  || '').trim());
            var dbsExpiry   = toISO(excelDate(norm.dbs_expiry));
            // Not hard-required on bulk import (unlike the Add Guard form) —
            // a row missing these just surfaces as INCOMPLETE compliance
            // status afterward rather than rejecting the whole row.
            var siaExpiry   = toISO(excelDate(norm.sia_expiry));
            var cscsExpiry  = toISO(excelDate(norm.cscs_expiry));

            await pgPool.query(
              `INSERT INTO agency_staff (agency_id, name, email, phone, nationality, job_role, custom_role, badge_type, dbs_expiry, sia_expiry, cscs_expiry)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
              [agencyId, name, email, phone, nationality, jobRole, customRole || null, badgeType || null, dbsExpiry, siaExpiry, cscsExpiry]
            );
            importedCount++;
          } catch (rowErr) {
            errors.push({ row: rowNum, error: rowErr.message });
          }
        }

        res.json({ ok: true, imported_count: importedCount, errors: errors });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
    req.on('error', function() {
      res.status(500).json({ ok: false, error: 'Upload failed.' });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Agency Staff: Certificate Documents ───────────────────────────────────────
// agency_staff is a Postgres table with no per-person folder on disk (unlike
// regular staff), so documents live in a flat directory keyed by staff id —
// same reasoning as the photo storage below. Every route path.basename()'s
// every path segment before touching the filesystem (the exact class of bug
// already found and fixed once in this codebase's site-documents route).
var ALLOWED_AGENCY_DOC_TYPES = ['sia_cert', 'cscs_cert', 'rtw_cert', 'dog_handler_cert', 'training_cert'];
var AGENCY_STAFF_DOCS_DIR = path.join(BASE, 'agency-staff-documents');
if (!fs.existsSync(AGENCY_STAFF_DOCS_DIR)) fs.mkdirSync(AGENCY_STAFF_DOCS_DIR, { recursive: true });

function findAgencyStaffDoc(staffId, docType) {
  var exts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
  for (var e of exts) {
    var dp = path.join(AGENCY_STAFF_DOCS_DIR, staffId, docType + e);
    if (fs.existsSync(dp)) return dp;
  }
  return null;
}

app.get('/api/agencies/:agencyId/staff/:id/documents/:docType', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  var agencyId = path.basename(req.params.agencyId);
  var staffId  = path.basename(req.params.id);
  var docType  = path.basename(req.params.docType);
  if (!ALLOWED_AGENCY_DOC_TYPES.includes(docType)) return res.status(400).end();
  try {
    var r = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, agencyId]);
    if (!r.rows.length) return res.status(404).end();
    var fp = findAgencyStaffDoc(staffId, docType);
    if (!fp) return res.status(404).end();
    var ext = path.extname(fp).toLowerCase();
    var mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', 'inline; filename="' + docType + ext + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(fp));
  } catch (e) {
    res.status(500).end();
  }
});

app.post('/api/agencies/:agencyId/staff/:id/documents/:docType', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  var agencyId = path.basename(req.params.agencyId);
  var staffId  = path.basename(req.params.id);
  var docType  = path.basename(req.params.docType);
  if (!ALLOWED_AGENCY_DOC_TYPES.includes(docType)) return res.status(400).json({ ok: false, error: 'Invalid document type' });
  try {
    var r = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, agencyId]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });

    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', async function() {
      try {
        var buf = Buffer.concat(chunks);
        // Detect file type from magic bytes — same convention as the staff document routes.
        var ext = '.pdf';
        if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
        else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';

        var staffDir = path.join(AGENCY_STAFF_DOCS_DIR, staffId);
        if (!fs.existsSync(staffDir)) fs.mkdirSync(staffDir, { recursive: true });

        // Remove any existing file for this docType before writing the new one.
        ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
          var old = path.join(staffDir, docType + e);
          if (fs.existsSync(old)) fs.unlinkSync(old);
        });
        fs.writeFileSync(path.join(staffDir, docType + ext), buf);

        var today = new Date().toISOString();
        // docType is checked against ALLOWED_AGENCY_DOC_TYPES above, so it's safe
        // to use in the column name here — never derived from free-text input.
        await pgPool.query(
          'UPDATE agency_staff SET ' + docType + '_uploaded = TRUE, ' + docType + '_upload_date = $1, updated_at = NOW() WHERE id = $2',
          [today, staffId]
        );
        console.log('[AGENCY DOCS] Saved', docType, 'for agency_staff', staffId);
        res.json({ ok: true, date: today });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
    req.on('error', function() {
      res.status(500).json({ ok: false, error: 'Upload failed.' });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Agency Staff: Custom Certificate Documents ────────────────────────────────
// Unlimited custom-labeled certs per guard, on top of (never replacing) the
// fixed 5 types above — a separate child table + flat directory because the
// column-per-type design above has no room for arbitrary new labels. Same
// path.basename()-every-segment discipline as the fixed-cert routes above.
var AGENCY_STAFF_CUSTOM_DOCS_DIR = path.join(BASE, 'agency-staff-custom-documents');
if (!fs.existsSync(AGENCY_STAFF_CUSTOM_DOCS_DIR)) fs.mkdirSync(AGENCY_STAFF_CUSTOM_DOCS_DIR, { recursive: true });

app.post('/api/agencies/:agencyId/staff/:id/custom-documents', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  var agencyId = path.basename(req.params.agencyId);
  var staffId  = path.basename(req.params.id);
  var label = String(req.query.label || '').trim();
  if (!label) return res.status(400).json({ ok: false, error: 'Label is required.' });
  try {
    var r = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, agencyId]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });

    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', async function() {
      try {
        var buf = Buffer.concat(chunks);
        // Detect file type from magic bytes — same convention as the fixed-cert routes above.
        var ext = '.pdf';
        if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
        else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';

        var docId = crypto.randomUUID();
        var filename = docId + ext;
        fs.writeFileSync(path.join(AGENCY_STAFF_CUSTOM_DOCS_DIR, filename), buf);

        var ins = await pgPool.query(
          `INSERT INTO agency_staff_custom_documents (id, agency_staff_id, label, filename, uploaded_by)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id, label, uploaded_at`,
          [docId, staffId, label, filename, req.user.id]
        );
        console.log('[AGENCY DOCS] Saved custom document "' + label + '" for agency_staff', staffId);
        res.json({ ok: true, document: ins.rows[0] });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
    req.on('error', function() {
      res.status(500).json({ ok: false, error: 'Upload failed.' });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/agencies/:agencyId/staff/:id/custom-documents', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  var agencyId = path.basename(req.params.agencyId);
  var staffId  = path.basename(req.params.id);
  try {
    var r = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, agencyId]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
    var docs = await pgPool.query(
      'SELECT id, label, uploaded_at FROM agency_staff_custom_documents WHERE agency_staff_id = $1 ORDER BY uploaded_at ASC',
      [staffId]
    );
    res.json({ ok: true, documents: docs.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/agencies/:agencyId/staff/:id/custom-documents/:docId', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  var agencyId = path.basename(req.params.agencyId);
  var staffId  = path.basename(req.params.id);
  var docId    = path.basename(req.params.docId);
  try {
    var r = await pgPool.query(
      `SELECT d.filename FROM agency_staff_custom_documents d
       JOIN agency_staff s ON s.id = d.agency_staff_id
       WHERE d.id = $1 AND d.agency_staff_id = $2 AND s.agency_id = $3`,
      [docId, staffId, agencyId]
    );
    if (!r.rows.length) return res.status(404).end();
    var fp = path.join(AGENCY_STAFF_CUSTOM_DOCS_DIR, path.basename(r.rows[0].filename));
    if (!fs.existsSync(fp)) return res.status(404).end();
    var ext = path.extname(fp).toLowerCase();
    var mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', 'inline; filename="' + docId + ext + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(fp));
  } catch (e) {
    res.status(500).end();
  }
});

app.delete('/api/agencies/:agencyId/staff/:id/custom-documents/:docId', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  var agencyId = path.basename(req.params.agencyId);
  var staffId  = path.basename(req.params.id);
  var docId    = path.basename(req.params.docId);
  try {
    var r = await pgPool.query(
      `SELECT d.filename FROM agency_staff_custom_documents d
       JOIN agency_staff s ON s.id = d.agency_staff_id
       WHERE d.id = $1 AND d.agency_staff_id = $2 AND s.agency_id = $3`,
      [docId, staffId, agencyId]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Document not found.' });
    var fp = path.join(AGENCY_STAFF_CUSTOM_DOCS_DIR, path.basename(r.rows[0].filename));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    await pgPool.query('DELETE FROM agency_staff_custom_documents WHERE id = $1', [docId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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
var AGENCY_STAFF_DOC_TYPES = ['creditCheckReport', 'socialMediaCheckReport'];

function findAgencyStaffDocFile(staffId, docType) {
  var exts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
  for (var i = 0; i < exts.length; i++) {
    var fp = path.join(AGENCY_STAFF_DOCS_DIR, staffId + '_' + docType + exts[i]);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

// Deletes every file on disk for one agency_staff record: the per-staff
// certificate-documents subfolder, the flat confidential-checks files, the
// profile photo, and any custom-labeled documents (whose filenames the
// caller must look up from agency_staff_custom_documents BEFORE deleting
// that row, since they're not derivable from staffId alone). Paths are
// built directly rather than through AGENCY_STAFF_DOCS_DIR — that name is
// declared twice in this file for two different directories, and by
// var-hoisting rules the second declaration wins everywhere, so relying on
// it here would silently point at the wrong folder for the fixed-doc-type
// certs.
function purgeAgencyStaffFiles(staffId, customDocFilenames) {
  try { fs.rmSync(path.join(BASE, 'agency-staff-documents', staffId), { recursive: true, force: true }); } catch (e) { /* already gone */ }
  var exts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
  ['creditCheckReport', 'socialMediaCheckReport'].forEach(function(docType) {
    exts.forEach(function(ext) {
      try { fs.unlinkSync(path.join(BASE, 'agency-staff-confidential-docs', staffId + '_' + docType + ext)); } catch (e) { /* already gone */ }
    });
  });
  exts.forEach(function(ext) {
    try { fs.unlinkSync(path.join(BASE, 'agency-staff-photos', staffId + ext)); } catch (e) { /* already gone */ }
  });
  (customDocFilenames || []).forEach(function(fn) {
    try { fs.unlinkSync(path.join(BASE, 'agency-staff-custom-documents', fn)); } catch (e) { /* already gone */ }
  });
}

app.get('/api/agencies/:agencyId/staff/:id/checks', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var r = await pgPool.query(
      'SELECT doc_type, uploaded_at, visible_to_agency FROM agency_staff_documents WHERE agency_staff_id = $1',
      [req.params.id]
    );
    res.json({ ok: true, checks: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/agencies/:agencyId/staff/:id/checks/:docType', requireLogin, requirePermission('staff'), function(req, res) {
  var docType = req.params.docType;
  if (AGENCY_STAFF_DOC_TYPES.indexOf(docType) === -1) return res.status(400).end();
  var staffId = path.basename(req.params.id);
  var fp = findAgencyStaffDocFile(staffId, docType);
  if (!fp) return res.status(404).end();
  var ext = path.extname(fp).toLowerCase();
  var mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'no-store');
  res.send(fs.readFileSync(fp));
});

app.post('/api/agencies/:agencyId/staff/:id/checks/:docType', requireLogin, requirePermission('staff'), async function(req, res) {
  var docType = req.params.docType;
  if (AGENCY_STAFF_DOC_TYPES.indexOf(docType) === -1) return res.status(400).json({ ok: false, error: 'Invalid document type.' });
  try {
    var staffId = path.basename(req.params.id);
    var check = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, path.basename(req.params.agencyId)]);
    if (!check.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });

    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', async function() {
      try {
        var buf = Buffer.concat(chunks);
        var ext = '.pdf';
        if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
        else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';
        ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
          var old = path.join(AGENCY_STAFF_DOCS_DIR, staffId + '_' + docType + e);
          if (fs.existsSync(old)) fs.unlinkSync(old);
        });
        var filename = staffId + '_' + docType + ext;
        fs.writeFileSync(path.join(AGENCY_STAFF_DOCS_DIR, filename), buf);
        // Always lands hidden — same "upload never implies reveal" rule as
        // the staff-side ConfidentialDocManagerRow; the visibility toggle
        // below is a deliberate, separate action.
        await pgPool.query(
          `INSERT INTO agency_staff_documents (agency_staff_id, doc_type, filename, uploaded_by, visible_to_agency)
           VALUES ($1,$2,$3,$4,FALSE)
           ON CONFLICT (agency_staff_id, doc_type) DO UPDATE SET filename = $3, uploaded_by = $4, uploaded_at = NOW(), visible_to_agency = FALSE`,
          [staffId, docType, filename, req.user.id]
        );
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/agencies/:agencyId/staff/:id/checks/:docType/visibility', requireLogin, requirePermission('staff'), async function(req, res) {
  var docType = req.params.docType;
  if (AGENCY_STAFF_DOC_TYPES.indexOf(docType) === -1) return res.status(400).json({ ok: false, error: 'Invalid document type.' });
  try {
    var visible = !!(req.body && req.body.visibleToStaff);
    var r = await pgPool.query(
      'UPDATE agency_staff_documents SET visible_to_agency = $1 WHERE agency_staff_id = $2 AND doc_type = $3 RETURNING id',
      [visible, req.params.id, docType]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Document not found.' });
    res.json({ ok: true, visibleToStaff: visible });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

function findAgencyStaffPhoto(staffId) { return findFileByExts(AGENCY_STAFF_PHOTOS_DIR, String(staffId)); }

app.get('/api/agencies/:agencyId/staff/:id/photo', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var staffId = path.basename(req.params.id);
    var r = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, path.basename(req.params.agencyId)]);
    if (!r.rows.length) return res.status(404).end();
    var photo = findAgencyStaffPhoto(staffId);
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

app.post('/api/agencies/:agencyId/staff/:id/photo', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var staffId = path.basename(req.params.id);
    var r = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [staffId, path.basename(req.params.agencyId)]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });

    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() {
      try {
        var buf = Buffer.concat(chunks);
        var ext = '.jpg';
        if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
        else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';

        ['.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
          var old = path.join(AGENCY_STAFF_PHOTOS_DIR, staffId + e);
          if (fs.existsSync(old)) fs.unlinkSync(old);
        });

        fs.writeFileSync(path.join(AGENCY_STAFF_PHOTOS_DIR, staffId + ext), buf);
        res.json({ ok: true });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Agency Staff: Unavailability ──────────────────────────────────────────────
app.post('/api/agencies/:agencyId/staff/:id/unavailability', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var staffCheck = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
    if (!staffCheck.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });

    var b = req.body || {};
    var dateFrom = String(b.date_from || '').trim();
    var dateTo   = String(b.date_to   || '').trim();
    var reason   = String(b.reason    || '').trim();
    if (!dateFrom || !dateTo) return res.status(400).json({ ok: false, error: 'date_from and date_to are required.' });
    if (dateTo < dateFrom) return res.status(400).json({ ok: false, error: 'date_to cannot be before date_from.' });

    var r = await pgPool.query(
      'INSERT INTO agency_staff_unavailability (agency_staff_id, date_from, date_to, reason) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.params.id, dateFrom, dateTo, reason || null]
    );
    res.json({ ok: true, unavailability: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/agencies/:agencyId/staff/:id/unavailability', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var staffCheck = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
    if (!staffCheck.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
    var r = await pgPool.query(
      'SELECT * FROM agency_staff_unavailability WHERE agency_staff_id = $1 ORDER BY date_from',
      [req.params.id]
    );
    res.json({ ok: true, unavailability: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/agencies/:agencyId/staff/:id/unavailability/:unavailabilityId', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var staffCheck = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
    if (!staffCheck.rows.length) return res.status(404).json({ ok: false, error: 'Guard not found.' });
    var r = await pgPool.query(
      'DELETE FROM agency_staff_unavailability WHERE id = $1 AND agency_staff_id = $2 RETURNING id',
      [req.params.unavailabilityId, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Unavailability record not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Agency Staff: Guard Matching ──────────────────────────────────────────────
// Suggests guards eligible for a given event date — excludes expired-compliance
// and currently-unavailable guards. compliance_status is computed app-side
// (role-conditional, see calculateComplianceStatus), not a stored column, so
// the EXPIRED filter happens in JS after the SQL rather than in the query.
app.get('/api/agencies/:agencyId/staff/available', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var eventDate = String(req.query.event_date || '').trim();
    if (!eventDate) return res.status(400).json({ ok: false, error: 'event_date query param is required.' });

    var r = await pgPool.query(
      `SELECT * FROM agency_staff
       WHERE agency_id = $1 AND status = 'active'
         AND id NOT IN (
           SELECT agency_staff_id FROM agency_staff_unavailability
           WHERE date_from <= $2 AND date_to >= $2
         )`,
      [req.params.agencyId, eventDate]
    );
    var available = r.rows
      .map(function(row) { row.compliance_status = calculateComplianceStatus(row); return row; })
      .filter(function(row) { return row.compliance_status !== 'EXPIRED'; });
    res.json({ ok: true, staff: available });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── AGENCY DEPLOYMENTS ─────────────────────────────────────────────────────────
// Site bookings for agency cover guards. Guard certification auto-block and
// unavailability exclusion (debug note #11) are enforced here server-side —
// a 409 rejection, not a UI hint that a direct API call could bypass.
// getSiteById() is now Postgres-backed — defined up with loadSites() near the
// other site functions, not here.

// Shared validation for POST (new deployment) and PATCH (re-assign staff) —
// checks every agency_staff_id belongs to this agency and is active, rejects
// if any is EXPIRED compliance, rejects if any is unavailable on event_date.
// Returns the fetched staff rows (used to resolve names for error messages)
// or throws an object { status, error } the caller turns into a response.
// "10:00" -> 600 minutes since midnight. Returns null for anything that
// isn't a plain HH:MM 24-hour string, so callers can treat null as invalid.
function timeStringToMinutes(t) {
  var m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

async function validateDeploymentStaff(agencyId, staffReq, eventDate) {
  var staffIds = staffReq.map(function(s) { return String(s.agency_staff_id || ''); });
  if (staffIds.some(function(id) { return !id; })) {
    throw { status: 400, error: 'Every staff entry needs an agency_staff_id.' };
  }
  // scheduled_hours is derived from start_time/end_time, not typed directly
  // — the user wants a shift entered as a time range (e.g. 10:00 to 18:00 on
  // the deployment's single event_date), matching how a real shift is
  // described, rather than a raw hours count.
  for (var i = 0; i < staffReq.length; i++) {
    var startMin = timeStringToMinutes(staffReq[i].start_time);
    var endMin = timeStringToMinutes(staffReq[i].end_time);
    if (startMin === null || endMin === null) {
      throw { status: 400, error: 'Every guard needs a start_time and end_time in HH:MM format.' };
    }
    if (endMin <= startMin) {
      throw { status: 400, error: 'end_time must be after start_time for every guard (shifts are within a single day).' };
    }
    staffReq[i].scheduled_hours = Math.round(((endMin - startMin) / 60) * 100) / 100;
  }
  if (!staffIds.length) return [];

  var staffResult = await pgPool.query(
    "SELECT * FROM agency_staff WHERE agency_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'",
    [agencyId, staffIds]
  );
  if (staffResult.rows.length !== staffIds.length) {
    var found = staffResult.rows.map(function(r) { return r.id; });
    var missing = staffIds.filter(function(id) { return found.indexOf(id) === -1; });
    throw { status: 400, error: 'Guard(s) not found or not active: ' + missing.join(', ') };
  }

  var expiredNames = staffResult.rows
    .filter(function(row) { return calculateComplianceStatus(row) === 'EXPIRED'; })
    .map(function(row) { return row.name; });
  if (expiredNames.length) {
    throw { status: 409, error: 'These guards have expired compliance and cannot be deployed: ' + expiredNames.join(', ') };
  }

  var unavailResult = await pgPool.query(
    'SELECT agency_staff_id FROM agency_staff_unavailability WHERE agency_staff_id = ANY($1::uuid[]) AND date_from <= $2 AND date_to >= $2',
    [staffIds, eventDate]
  );
  if (unavailResult.rows.length) {
    var unavailIds = unavailResult.rows.map(function(r) { return r.agency_staff_id; });
    var unavailNames = staffResult.rows.filter(function(row) { return unavailIds.indexOf(row.id) !== -1; }).map(function(row) { return row.name; });
    throw { status: 409, error: 'These guards are marked unavailable on ' + eventDate + ': ' + unavailNames.join(', ') };
  }

  return staffResult.rows;
}

app.post('/api/agencies/:agencyId/deployments', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var agencyId = req.params.agencyId;
    var agencyCheck = await pgPool.query('SELECT id FROM agencies WHERE id = $1', [agencyId]);
    if (!agencyCheck.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });

    var b = req.body || {};
    var siteId     = String(b.site_id     || '').trim();
    var eventDate  = String(b.event_date  || '').trim();
    var staffReq   = Array.isArray(b.staff) ? b.staff : [];
    var informedBy = b.informed_by ? String(b.informed_by).trim() : null;
    var approvedBy = b.approved_by ? String(b.approved_by).trim() : null;

    if (!siteId)    return res.status(400).json({ ok: false, error: 'site_id is required.' });
    if (!eventDate) return res.status(400).json({ ok: false, error: 'event_date is required.' });
    if (!staffReq.length) return res.status(400).json({ ok: false, error: 'At least one guard must be assigned.' });
    if (!(await getSiteById(siteId))) return res.status(400).json({ ok: false, error: 'Unknown site_id.' });

    try {
      await validateDeploymentStaff(agencyId, staffReq, eventDate);
    } catch (validationErr) {
      if (validationErr && validationErr.status) return res.status(validationErr.status).json({ ok: false, error: validationErr.error });
      throw validationErr;
    }

    var client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      var depResult = await client.query(
        'INSERT INTO agency_deployments (agency_id, site_id, event_date, informed_by, approved_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [agencyId, siteId, eventDate, informedBy, approvedBy]
      );
      var deployment = depResult.rows[0];
      for (var j = 0; j < staffReq.length; j++) {
        await client.query(
          'INSERT INTO deployment_attendance (deployment_id, agency_staff_id, scheduled_hours, start_time, end_time) VALUES ($1,$2,$3,$4,$5)',
          [deployment.id, staffReq[j].agency_staff_id, Number(staffReq[j].scheduled_hours), staffReq[j].start_time, staffReq[j].end_time]
        );
      }
      await client.query('COMMIT');
      res.json({ ok: true, deployment_id: deployment.id });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/agencies/:agencyId/deployments', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var agencyId = req.params.agencyId;
    var conditions = ['d.agency_id = $1'];
    var params = [agencyId];
    if (req.query.date_from) { params.push(req.query.date_from); conditions.push('d.event_date >= $' + params.length); }
    if (req.query.date_to)   { params.push(req.query.date_to);   conditions.push('d.event_date <= $' + params.length); }
    if (req.query.status)    { params.push(req.query.status);    conditions.push('d.status = $' + params.length); }

    // staff is a json_agg of each assigned guard's name/role/hours, not just
    // a count — every page listing deployments (this one, the admin
    // cross-agency list, AgencyDetailPage) used to show only guard_count,
    // with no way to see WHO was actually assigned short of re-opening the
    // deployment's edit form. That's the "who's deployed where" confusion
    // this was built to fix.
    var result = await pgPool.query(
      "SELECT d.*, COUNT(a.id) AS guard_count, " +
      "COALESCE(json_agg(json_build_object(" +
      "  'id', s.id, 'name', s.name, 'job_role', s.job_role, " +
      "  'scheduled_hours', a.scheduled_hours, 'start_time', a.start_time, 'end_time', a.end_time, 'attended', a.attended" +
      ") ORDER BY s.name) FILTER (WHERE a.id IS NOT NULL), '[]') AS staff " +
      'FROM agency_deployments d ' +
      'LEFT JOIN deployment_attendance a ON a.deployment_id = d.id ' +
      'LEFT JOIN agency_staff s ON s.id = a.agency_staff_id ' +
      'WHERE ' + conditions.join(' AND ') + ' GROUP BY d.id ORDER BY d.event_date DESC',
      params
    );
    var deployments = await Promise.all(result.rows.map(async function(row) { row.site = await getSiteById(row.site_id); return row; }));
    res.json({ ok: true, deployments: deployments });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/agencies/:agencyId/deployments/:id', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var agencyId = req.params.agencyId;
    var depId = req.params.id;
    var depCheck = await pgPool.query('SELECT * FROM agency_deployments WHERE id = $1 AND agency_id = $2', [depId, agencyId]);
    if (!depCheck.rows.length) return res.status(404).json({ ok: false, error: 'Deployment not found.' });

    var b = req.body || {};
    var allowedStatuses = ['scheduled', 'completed', 'cancelled'];
    var status = b.status !== undefined ? String(b.status).trim() : null;
    if (status && allowedStatuses.indexOf(status) === -1) {
      return res.status(400).json({ ok: false, error: 'status must be one of: ' + allowedStatuses.join(', ') });
    }

    if (Array.isArray(b.staff)) {
      var staffReq = b.staff;
      var staffIds = staffReq.map(function(s) { return String(s.agency_staff_id || ''); });

      try {
        await validateDeploymentStaff(agencyId, staffReq, depCheck.rows[0].event_date);
      } catch (validationErr) {
        if (validationErr && validationErr.status) return res.status(validationErr.status).json({ ok: false, error: validationErr.error });
        throw validationErr;
      }

      var client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        // Drop assignments no longer in the list; keep/update the ones that
        // are, so already-recorded attendance for a guard who stays assigned
        // isn't wiped out by this re-assignment.
        await client.query(
          'DELETE FROM deployment_attendance WHERE deployment_id = $1 AND NOT (agency_staff_id = ANY($2::uuid[]))',
          [depId, staffIds]
        );
        for (var j = 0; j < staffReq.length; j++) {
          await client.query(
            'INSERT INTO deployment_attendance (deployment_id, agency_staff_id, scheduled_hours, start_time, end_time) VALUES ($1,$2,$3,$4,$5) ' +
            'ON CONFLICT (deployment_id, agency_staff_id) DO UPDATE SET scheduled_hours = EXCLUDED.scheduled_hours, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time',
            [depId, staffReq[j].agency_staff_id, Number(staffReq[j].scheduled_hours), staffReq[j].start_time, staffReq[j].end_time]
          );
        }
        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    }

    if (status) {
      await pgPool.query('UPDATE agency_deployments SET status = $1, updated_at = NOW() WHERE id = $2', [status, depId]);
    }
    // Built per-field rather than with COALESCE — COALESCE would make it
    // impossible to ever clear one of these back to blank (sending "" would
    // just fall through to the existing value instead of clearing it).
    var deploymentUpdates = [];
    var deploymentParams = [];
    if (b.informed_by !== undefined) { deploymentParams.push(String(b.informed_by).trim() || null); deploymentUpdates.push('informed_by = $' + deploymentParams.length); }
    if (b.approved_by !== undefined) { deploymentParams.push(String(b.approved_by).trim() || null); deploymentUpdates.push('approved_by = $' + deploymentParams.length); }
    if (deploymentUpdates.length) {
      deploymentParams.push(depId);
      await pgPool.query('UPDATE agency_deployments SET ' + deploymentUpdates.join(', ') + ', updated_at = NOW() WHERE id = $' + deploymentParams.length, deploymentParams);
    }

    var updated = await pgPool.query('SELECT * FROM agency_deployments WHERE id = $1', [depId]);
    res.json({ ok: true, deployment: updated.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Permanent delete — director only. Cancelling a deployment (PATCH status
// above) is the routine action; this actually removes the row. Attendance
// rows cascade automatically (deployment_attendance.deployment_id ON DELETE
// CASCADE), but acknowledgment_forms.deployment_id does NOT — a signed
// acknowledgment for this deployment is compliance proof, same reasoning as
// everywhere else this pattern is used (event-instruction delete, site
// delete). Checked up front rather than surfacing a raw FK-violation error.
app.delete('/api/agencies/:agencyId/deployments/:id', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var agencyId = req.params.agencyId;
    var depId = req.params.id;
    var depResult = await pgPool.query('SELECT * FROM agency_deployments WHERE id = $1 AND agency_id = $2', [depId, agencyId]);
    if (!depResult.rows.length) return res.status(404).json({ ok: false, error: 'Deployment not found.' });

    var acks = await pgPool.query('SELECT COUNT(*)::int AS n FROM acknowledgment_forms WHERE deployment_id = $1', [depId]);
    if (acks.rows[0].n > 0) {
      return res.status(400).json({
        ok: false,
        error: 'Cannot delete this deployment — ' + acks.rows[0].n + ' acknowledgment link(s)/signature(s) reference it. Delete any un-signed links first (a signed one cannot be removed); mark the deployment cancelled instead if it never happened.'
      });
    }

    await pgPool.query('DELETE FROM agency_deployments WHERE id = $1', [depId]); // cascades deployment_attendance

    await pgPool.query(
      `INSERT INTO audit_events (actor_email, action, object_type, object_id, object_name, metadata)
       VALUES ($1,'DEPLOYMENT_DELETED','agency_deployment',$2,$3,$4)`,
      [(req.user && req.user.username) || null, depId, depResult.rows[0].event_date,
       JSON.stringify({ agency_id: agencyId, site_id: depResult.rows[0].site_id, status: depResult.rows[0].status })]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Agency admin's "I understand + I've briefed my staff" confirmation — distinct
// from an individual guard signing an acknowledgment form (that's a separate
// polymorphic table for a later stage); this one fact belongs on the
// deployment row itself.
app.patch('/api/agencies/:agencyId/deployments/:id/acknowledge', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var r = await pgPool.query(
      `UPDATE agency_deployments
       SET agency_acknowledged = TRUE, agency_acknowledged_by = $1, agency_acknowledged_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND agency_id = $3 RETURNING *`,
      [req.user.id, req.params.id, req.params.agencyId]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Deployment not found.' });
    // The plain RETURNING * above has no guard_count column — the frontend
    // replaces its whole `detail` object with this response, so without it
    // the modal briefly showed "0 guards" right after acknowledging (the
    // real assignment was untouched; only this response was incomplete).
    // Match the same COUNT(...) LEFT JOIN shape the list/detail queries use.
    var withCount = await pgPool.query(
      `SELECT d.*, COUNT(a.id) AS guard_count FROM agency_deployments d
       LEFT JOIN deployment_attendance a ON a.deployment_id = d.id
       WHERE d.id = $1 GROUP BY d.id`,
      [req.params.id]
    );
    res.json({ ok: true, deployment: withCount.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/agencies/:agencyId/deployments/:id/attendance', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var depCheck = await pgPool.query('SELECT id FROM agency_deployments WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
    if (!depCheck.rows.length) return res.status(404).json({ ok: false, error: 'Deployment not found.' });

    var b = req.body || {};
    var staffId = String(b.agency_staff_id || '');
    if (!staffId) return res.status(400).json({ ok: false, error: 'agency_staff_id is required.' });
    var attended = (b.attended === true || b.attended === false) ? b.attended : null;
    var actualHours = (b.actual_hours !== undefined && b.actual_hours !== null && b.actual_hours !== '') ? Number(b.actual_hours) : null;

    var existing = await pgPool.query(
      'SELECT * FROM deployment_attendance WHERE deployment_id = $1 AND agency_staff_id = $2',
      [req.params.id, staffId]
    );
    var r;
    if (existing.rows.length) {
      r = await pgPool.query(
        `UPDATE deployment_attendance SET attended = $1, actual_hours = $2, confirmed_by = $3, confirmed_at = NOW()
         WHERE deployment_id = $4 AND agency_staff_id = $5 RETURNING *`,
        [attended, actualHours, req.user.id, req.params.id, staffId]
      );
    } else {
      // Guard wasn't part of the original assignment — insert rather than
      // reject, so attendance can still be logged for an ad-hoc addition.
      r = await pgPool.query(
        `INSERT INTO deployment_attendance (deployment_id, agency_staff_id, scheduled_hours, attended, actual_hours, confirmed_by, confirmed_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
        [req.params.id, staffId, actualHours || 0, attended, actualHours, req.user.id]
      );
    }

    if (b.note) {
      await pgPool.query(
        'INSERT INTO deployment_notes (deployment_id, author_id, note) VALUES ($1,$2,$3)',
        [req.params.id, req.user.id, String(b.note).trim()]
      );
    }

    res.json({ ok: true, attendance: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/agencies/:agencyId/deployments/:id/notes', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var depCheck = await pgPool.query('SELECT id FROM agency_deployments WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
    if (!depCheck.rows.length) return res.status(404).json({ ok: false, error: 'Deployment not found.' });
    var note = String((req.body || {}).note || '').trim();
    if (!note) return res.status(400).json({ ok: false, error: 'note is required.' });
    var r = await pgPool.query(
      'INSERT INTO deployment_notes (deployment_id, author_id, note) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, req.user.id, note]
    );
    res.json({ ok: true, note: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/agencies/:agencyId/deployments/:id/notes', requireLogin, requireOwnAgencyOrPermission('staff'), async function(req, res) {
  try {
    var depCheck = await pgPool.query('SELECT id FROM agency_deployments WHERE id = $1 AND agency_id = $2', [req.params.id, req.params.agencyId]);
    if (!depCheck.rows.length) return res.status(404).json({ ok: false, error: 'Deployment not found.' });
    var r = await pgPool.query(
      `SELECT n.*, u.full_name AS author_name
       FROM deployment_notes n
       LEFT JOIN users u ON u.id = n.author_id
       WHERE n.deployment_id = $1 ORDER BY n.created_at`,
      [req.params.id]
    );
    res.json({ ok: true, notes: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── ADMIN: AGENCY DASHBOARD + PERFORMANCE ─────────────────────────────────────
// Cross-agency view for the Director/Ops side. Performance figures are pure
// queries over deployment_attendance + deployment_notes — no new stored table
// (debug note #11): nothing here is state, it's all computed on read.
app.get('/api/admin/agencies/overview', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var agencyCount = await pgPool.query("SELECT COUNT(*) FROM agencies WHERE status = 'active'");
    var staffResult = await pgPool.query("SELECT * FROM agency_staff WHERE status = 'active'");
    var breakdown = { EXPIRED: 0, INCOMPLETE: 0, ACTION_NEEDED: 0, COMPLIANT: 0 };
    staffResult.rows.forEach(function(row) {
      var status = calculateComplianceStatus(row);
      breakdown[status] = (breakdown[status] || 0) + 1;
    });
    res.json({
      ok: true,
      total_agencies: Number(agencyCount.rows[0].count),
      total_staff: staffResult.rows.length,
      compliance_breakdown: breakdown
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/admin/agencies/:id/performance', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var agencyId = req.params.id;
    var agencyCheck = await pgPool.query('SELECT id FROM agencies WHERE id = $1', [agencyId]);
    if (!agencyCheck.rows.length) return res.status(404).json({ ok: false, error: 'Agency not found.' });

    var staffResult = await pgPool.query("SELECT * FROM agency_staff WHERE agency_id = $1 AND status = 'active'", [agencyId]);
    var compliantCount = staffResult.rows.filter(function(row) { return calculateComplianceStatus(row) === 'COMPLIANT'; }).length;
    var compliancePct = staffResult.rows.length ? Math.round((compliantCount / staffResult.rows.length) * 100) : 100;

    var deploymentsCount = await pgPool.query('SELECT COUNT(*) FROM agency_deployments WHERE agency_id = $1', [agencyId]);

    var attendanceResult = await pgPool.query(
      `SELECT a.attended FROM deployment_attendance a
       JOIN agency_deployments d ON d.id = a.deployment_id
       WHERE d.agency_id = $1 AND a.attended IS NOT NULL`,
      [agencyId]
    );
    var confirmed = attendanceResult.rows.length;
    var noShows = attendanceResult.rows.filter(function(row) { return row.attended === false; }).length;
    var noShowRate = confirmed ? Math.round((noShows / confirmed) * 100) : 0;

    var incidentCount = await pgPool.query(
      `SELECT COUNT(*) FROM deployment_notes n
       JOIN agency_deployments d ON d.id = n.deployment_id
       WHERE d.agency_id = $1`,
      [agencyId]
    );

    res.json({
      ok: true,
      compliance_pct: compliancePct,
      no_show_rate: noShowRate,
      incident_count: Number(incidentCount.rows[0].count),
      deployments_count: Number(deploymentsCount.rows[0].count)
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/admin/deployments', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var conditions = [];
    var params = [];
    if (req.query.site_id)   { params.push(req.query.site_id);   conditions.push('d.site_id = $' + params.length); }
    if (req.query.date_from) { params.push(req.query.date_from); conditions.push('d.event_date >= $' + params.length); }
    if (req.query.date_to)   { params.push(req.query.date_to);   conditions.push('d.event_date <= $' + params.length); }
    if (req.query.agency_id) { params.push(req.query.agency_id); conditions.push('d.agency_id = $' + params.length); }

    var sql = "SELECT d.*, a.name AS agency_name, COUNT(att.id) AS guard_count, " +
      "COALESCE(json_agg(json_build_object(" +
      "  'id', s.id, 'name', s.name, 'job_role', s.job_role, " +
      "  'scheduled_hours', att.scheduled_hours, 'start_time', att.start_time, 'end_time', att.end_time, 'attended', att.attended" +
      ") ORDER BY s.name) FILTER (WHERE att.id IS NOT NULL), '[]') AS staff " +
      'FROM agency_deployments d ' +
      'JOIN agencies a ON a.id = d.agency_id ' +
      'LEFT JOIN deployment_attendance att ON att.deployment_id = d.id ' +
      'LEFT JOIN agency_staff s ON s.id = att.agency_staff_id' +
      (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '') +
      ' GROUP BY d.id, a.name ORDER BY d.event_date DESC';

    var result = await pgPool.query(sql, params);
    var deployments = await Promise.all(result.rows.map(async function(row) { row.site = await getSiteById(row.site_id); return row; }));
    res.json({ ok: true, deployments: deployments });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Narrow manager-directory lookup for the "Manager" audience picker (Stage
// 2) — deliberately NOT a reuse of GET /api/users (requireRole('director'),
// backs the director-only Team Access user-administration page and returns
// full rows including role/email/is_active). This route is scoped to just
// {id, full_name} for active, manager-tier users so it can't be used to
// enumerate or expose anything beyond a name to pick from a list.
// "Manager-tier" = every role except 'staff' (self-service) and 'agency'
// (external guard-agency logins) — everything else in this app's role
// system (director, ops_manager, hr_manager, office_manager, accounts,
// media, supervisor, fleet_manager, and any future custom role) is some
// flavor of internal management.
app.get('/api/manager-directory', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var result = await pgPool.query(
      "SELECT id, full_name FROM users WHERE is_active = TRUE AND role NOT IN ('staff', 'agency') ORDER BY full_name"
    );
    res.json({ ok: true, managers: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── EVENT INSTRUCTIONS & ACKNOWLEDGMENT FORMS (Feature 2) ─────────────────────
// Covers BOTH agency cover guards and GuardTec's own staff — one consolidated
// acknowledgment_forms table, one link-generation mechanism, two respondent
// types (debug notes #3/#4). Instructions stand alone or link to a site —
// site_id TEXT, same id space as agency_deployments.site_id — now backed by
// a real `sites` row (see ensureSitesSchema/migrate-sites.js) with a real FK
// added once that migration has run (ensureSiteForeignKeysSchema); respondent_id
// is still resolved at the app layer, unrelated to the site_id question.

// Generates one secure, single-use link for one respondent — a deployment's
// guards, or a list of GuardTec staff, always get their own individually
// tracked link (2.1: "one link per person, not one shared link"), never a
// shared one. 256-bit token, 5-minute expiry. This inserted row is the ONLY
// source of truth for both: the ?expires= query param on the returned URL is
// DISPLAY ONLY (a client-side countdown) — validation never reads anything
// from the URL itself, only link_expires_at from the DB (debug note #9).
// Kept in sync with the acknowledgment_forms.respondent_type CHECK constraint
// (widened in ensureEventInstructionsSchema to add driver/manager) — found via
// testing that the DB accepted the wider set while this function still
// silently rejected two of them, making Driver/Manager audience selection a
// dead end at the API layer despite compiling and looking correct end to end.
var VALID_RESPONDENT_TYPES = ['agency_staff', 'employee', 'driver', 'manager'];

async function generateFormLink(instructionId, respondentType, respondentId, deploymentId) {
  if (VALID_RESPONDENT_TYPES.indexOf(respondentType) === -1) {
    throw { status: 400, error: 'respondentType must be one of: ' + VALID_RESPONDENT_TYPES.join(', ') + '.' };
  }

  var versionResult = await pgPool.query('SELECT version FROM event_instructions WHERE id = $1', [instructionId]);
  if (!versionResult.rows.length) throw { status: 404, error: 'Instruction not found.' };
  var instructionVersion = versionResult.rows[0].version;

  // respondent_name_snapshot is captured here, at send time — same "no FK,
  // resolved at the app layer" reasoning as respondent_id itself.
  var name = null;
  if (respondentType === 'agency_staff') {
    var agencyStaffResult = await pgPool.query('SELECT name FROM agency_staff WHERE id = $1', [respondentId]);
    if (agencyStaffResult.rows.length) name = agencyStaffResult.rows[0].name;
  } else {
    var employeeResult = await pgPool.query('SELECT name FROM employees WHERE legacy_id = $1', [respondentId]);
    if (employeeResult.rows.length) name = employeeResult.rows[0].name;
  }
  if (name === null) throw { status: 404, error: 'Respondent not found: ' + respondentType + ' ' + respondentId };

  var token = crypto.randomBytes(32).toString('hex'); // 256 bits — brute force is not realistic
  var expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await pgPool.query(
    `INSERT INTO acknowledgment_forms
       (instruction_id, instruction_version, deployment_id, respondent_type, respondent_id, respondent_name_snapshot, form_token, link_expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [instructionId, instructionVersion, deploymentId || null, respondentType, String(respondentId), name, token, expiresAt]
  );

  return BASE_URL + '/acknowledge/' + token + '?expires=' + expiresAt.getTime();
}

// ── ADMIN: EVENT INSTRUCTIONS (create/publish) ────────────────────────────────
app.post('/api/event-instructions', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var b = req.body || {};
    var title = String(b.title || '').trim();
    if (!title) return res.status(400).json({ ok: false, error: 'title is required.' });

    var siteId = b.site_id ? String(b.site_id).trim() : '';
    if (siteId && !(await getSiteById(siteId))) return res.status(400).json({ ok: false, error: 'Unknown site_id.' });

    var status = b.status === 'published' ? 'published' : 'draft';
    var requirements = Array.isArray(b.requirements) ? b.requirements : [];

    var r = await pgPool.query(
      `INSERT INTO event_instructions
         (site_id, event_date, title, instructions_html, requirements, document_file_url, document_mime_type, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [siteId || null, b.event_date || null, title, b.instructions_html || null,
       JSON.stringify(requirements), b.document_file_url || null, b.document_mime_type || null,
       req.user.id, status]
    );
    res.json({ ok: true, instruction: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/event-instructions', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var conditions = [];
    var params = [];
    if (req.query.site_id) { params.push(req.query.site_id); conditions.push('site_id = $' + params.length); }
    if (req.query.status) {
      params.push(req.query.status); conditions.push('status = $' + params.length);
    } else {
      // No explicit status filter -> exclude archived by default, same as
      // every other list endpoint in this app (agencies, agency_staff).
      // Found via testing: a caller with no filters at all was getting
      // archived instructions back, relying entirely on the frontend to
      // filter them out client-side rather than having a sane default here.
      conditions.push("status != 'archived'");
    }

    var sql = 'SELECT * FROM event_instructions' +
      (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '') +
      ' ORDER BY created_at DESC';
    var result = await pgPool.query(sql, params);
    var instructions = await Promise.all(result.rows.map(async function(row) { row.site = row.site_id ? await getSiteById(row.site_id) : null; return row; }));
    res.json({ ok: true, instructions: instructions });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/event-instructions/:id', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var r = await pgPool.query('SELECT * FROM event_instructions WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Instruction not found.' });
    var instruction = r.rows[0];
    instruction.site = instruction.site_id ? await getSiteById(instruction.site_id) : null;

    var formsResult = await pgPool.query(
      `SELECT id, respondent_type, respondent_id, respondent_name_snapshot, instruction_version,
              link_expires_at, form_opened_at, signed_at, current_step
       FROM acknowledgment_forms WHERE instruction_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json({ ok: true, instruction: instruction, forms: formsResult.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Renders one signed acknowledgment as a standalone, print-friendly HTML
// page — the instruction content plus signer name/date/IP and the captured
// signature image, all in one document. Opening it and using the browser's
// Print → Save as PDF is the "copy of their signed document" a director can
// keep/export; no PDF-generation dependency needed for that. 404s (rather
// than a 200 with an "unsigned" message) if the form hasn't been signed yet,
// so a stray link never looks like proof of something that didn't happen.
app.get('/api/event-instructions/:id/acknowledgments/:formId/document', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var instrResult = await pgPool.query('SELECT * FROM event_instructions WHERE id = $1', [req.params.id]);
    if (!instrResult.rows.length) return res.status(404).send('Instruction not found.');
    var instruction = instrResult.rows[0];

    var formResult = await pgPool.query(
      'SELECT * FROM acknowledgment_forms WHERE id = $1 AND instruction_id = $2',
      [req.params.formId, req.params.id]
    );
    if (!formResult.rows.length) return res.status(404).send('Acknowledgment record not found.');
    var form = formResult.rows[0];
    if (!form.signed_at) return res.status(404).send('This form has not been signed yet.');

    var site = instruction.site_id ? await getSiteById(instruction.site_id) : null;
    var signedAtStr = new Date(form.signed_at).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
    var signatureImg = form.signature_data && form.signature_data.indexOf('data:image') === 0
      ? '<img src="' + form.signature_data + '" alt="Signature" style="max-width:320px;border:1px solid #ddd;border-radius:4px;padding:8px;background:#fff" />'
      : '<p style="color:#888;font-style:italic">No signature image captured.</p>';

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      '<!doctype html><html><head><meta charset="utf-8"><title>Signed Acknowledgment — ' + esc(instruction.title) + '</title>' +
      '<style>body{font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:32px auto;padding:0 20px;color:#1a1a1a;line-height:1.5}' +
      'h1{font-size:20px;border-bottom:2px solid #c00;padding-bottom:10px}h2{font-size:14px;color:#555;margin-top:28px}' +
      '.meta{background:#f7f7f7;border-radius:6px;padding:14px 18px;margin:16px 0;font-size:14px}' +
      '.meta div{margin:3px 0}.instructions{border:1px solid #eee;border-radius:6px;padding:16px 18px;margin:10px 0}' +
      '@media print{body{margin:0}}</style></head><body>' +
      '<h1>Signed Acknowledgment</h1>' +
      '<div class="meta">' +
        '<div><strong>Instruction:</strong> ' + esc(instruction.title) + '</div>' +
        (site ? '<div><strong>Site:</strong> ' + esc(site.name) + '</div>' : '') +
        (instruction.event_date ? '<div><strong>Event date:</strong> ' + esc(instruction.event_date) + '</div>' : '') +
        '<div><strong>Version acknowledged:</strong> ' + esc(form.instruction_version) + '</div>' +
      '</div>' +
      '<h2>Instructions as read and signed</h2>' +
      '<div class="instructions">' + (instruction.instructions_html || '<p><em>No content.</em></p>') + '</div>' +
      '<h2>Signature</h2>' +
      '<div class="meta">' +
        '<div><strong>Signed by:</strong> ' + esc(form.signer_name) + '</div>' +
        '<div><strong>Signed at:</strong> ' + esc(signedAtStr) + '</div>' +
        '<div><strong>IP address:</strong> ' + esc(form.ip_address || 'unknown') + '</div>' +
      '</div>' +
      signatureImg +
      '</body></html>'
    );
  } catch (e) {
    res.status(500).send('Error generating document: ' + e.message);
  }
});

// Cancels an un-signed acknowledgment link — e.g. sent to the wrong person,
// or the guard never opened it and a fresh link is needed. Blocked once
// signed_at is set: a signed form is compliance proof (same reasoning as
// the event-instruction permanent-delete guard above), so this route can
// only ever remove links nobody has actually acknowledged yet.
app.delete('/api/event-instructions/:id/acknowledgments/:formId', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var formResult = await pgPool.query(
      'SELECT signed_at FROM acknowledgment_forms WHERE id = $1 AND instruction_id = $2',
      [req.params.formId, req.params.id]
    );
    if (!formResult.rows.length) return res.status(404).json({ ok: false, error: 'Acknowledgment link not found.' });
    if (formResult.rows[0].signed_at) {
      return res.status(400).json({ ok: false, error: 'This link has already been signed and is a compliance record — it cannot be deleted.' });
    }
    await pgPool.query('DELETE FROM acknowledgment_forms WHERE id = $1', [req.params.formId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/event-instructions/:id', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var existing = await pgPool.query('SELECT * FROM event_instructions WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Instruction not found.' });
    var current = existing.rows[0];

    var b = req.body || {};
    var allowedStatuses = ['draft', 'published', 'archived'];
    if (b.status !== undefined && allowedStatuses.indexOf(b.status) === -1) {
      return res.status(400).json({ ok: false, error: 'status must be one of: ' + allowedStatuses.join(', ') });
    }
    var siteIdVal = current.site_id;
    if (b.site_id !== undefined) {
      siteIdVal = String(b.site_id || '').trim() || null;
      if (siteIdVal && !(await getSiteById(siteIdVal))) return res.status(400).json({ ok: false, error: 'Unknown site_id.' });
    }

    var title            = b.title !== undefined ? String(b.title).trim() : current.title;
    var eventDate         = b.event_date !== undefined ? (b.event_date || null) : current.event_date;
    var instructionsHtml  = b.instructions_html !== undefined ? b.instructions_html : current.instructions_html;
    var requirements      = b.requirements !== undefined ? (Array.isArray(b.requirements) ? b.requirements : []) : current.requirements;
    var documentFileUrl   = b.document_file_url !== undefined ? b.document_file_url : current.document_file_url;
    var documentMimeType  = b.document_mime_type !== undefined ? b.document_mime_type : current.document_mime_type;
    var status            = b.status !== undefined ? b.status : current.status;
    // Re-acknowledgment on version bump needs no invalidation logic (2.2) —
    // instruction_version is a snapshot on each acknowledgment_forms row, so
    // bumping version here just means nobody has signed at the new version
    // yet; existing signed rows stand as an accurate record of what was
    // signed for the version that was current at the time.
    var version = b.bump_version === true ? current.version + 1 : current.version;

    var r = await pgPool.query(
      `UPDATE event_instructions
       SET title = $1, site_id = $2, event_date = $3, instructions_html = $4, requirements = $5,
           document_file_url = $6, document_mime_type = $7, status = $8, version = $9
       WHERE id = $10 RETURNING *`,
      [title, siteIdVal, eventDate, instructionsHtml, JSON.stringify(requirements),
       documentFileUrl, documentMimeType, status, version, req.params.id]
    );
    res.json({ ok: true, instruction: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Dedicated soft-delete for event instructions (Stage 2). Never a hard
// DELETE: acknowledgment_forms rows can point at an instruction via
// instruction_id, and a signed acknowledgment form is compliance/audit proof
// that must survive — same reasoning this file already applies to agencies
// and agency_staff (archived, never hard-deleted). status already accepts
// 'archived' via the generic PATCH above; this route exists purely so the
// frontend has a clear, discoverable "delete" action instead of reaching for
// PATCH with a magic status string.
app.post('/api/event-instructions/:id/archive', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var r = await pgPool.query(
      "UPDATE event_instructions SET status = 'archived' WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Instruction not found.' });
    res.json({ ok: true, instruction: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Mirror of archive — brings an instruction back to 'draft' (deliberately
// not straight back to 'published': re-showing it to guards/staff should be
// a second, explicit decision, not an automatic side effect of restoring).
app.post('/api/event-instructions/:id/restore', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var r = await pgPool.query(
      "UPDATE event_instructions SET status = 'draft' WHERE id = $1 AND status = 'archived' RETURNING *",
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Archived instruction not found.' });
    res.json({ ok: true, instruction: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Hard delete — deliberately narrower than the Custom Forms one: only
// allowed once an instruction is already archived (delete lives inside the
// archive view, not next to the everyday Archive action), AND only when no
// acknowledgment_forms rows exist against it. A signed acknowledgment is
// compliance/audit proof a guard was briefed — that must survive even if the
// instruction itself is being cleaned up, so we refuse rather than cascade.
app.delete('/api/event-instructions/:id', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var existing = await pgPool.query('SELECT id, status FROM event_instructions WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Instruction not found.' });
    if (existing.rows[0].status !== 'archived') {
      return res.status(400).json({ ok: false, error: 'Archive this instruction before permanently deleting it.' });
    }
    var ackCount = await pgPool.query('SELECT COUNT(*)::int AS n FROM acknowledgment_forms WHERE instruction_id = $1', [req.params.id]);
    if (ackCount.rows[0].n > 0) {
      return res.status(400).json({
        ok: false,
        error: 'Cannot permanently delete — ' + ackCount.rows[0].n + ' acknowledgment record(s) exist for this instruction and must be kept as compliance proof. Leave it archived instead.'
      });
    }
    await pgPool.query('DELETE FROM event_instructions WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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

function findEventInstructionDoc(instructionId) {
  var exts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
  for (var e of exts) {
    var fp = path.join(EVENT_INSTRUCTIONS_DOCS_DIR, instructionId + e);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

app.post('/api/event-instructions/:id/document', requireLogin, requirePermission('staff'), async function(req, res) {
  var instructionId = path.basename(req.params.id);
  try {
    var check = await pgPool.query('SELECT id FROM event_instructions WHERE id = $1', [instructionId]);
    if (!check.rows.length) return res.status(404).json({ ok: false, error: 'Instruction not found.' });

    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', async function() {
      try {
        var buf = Buffer.concat(chunks);
        // Detect file type from magic bytes — same convention as the agency document routes above.
        var ext = '.pdf';
        var mime = 'application/pdf';
        if (buf[0] === 0x89 && buf[1] === 0x50) { ext = '.png'; mime = 'image/png'; }
        else if (buf[0] === 0xFF && buf[1] === 0xD8) { ext = '.jpg'; mime = 'image/jpeg'; }

        // Remove any existing file for this instruction before writing the new one.
        ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
          var old = path.join(EVENT_INSTRUCTIONS_DOCS_DIR, instructionId + e);
          if (fs.existsSync(old)) fs.unlinkSync(old);
        });
        fs.writeFileSync(path.join(EVENT_INSTRUCTIONS_DOCS_DIR, instructionId + ext), buf);

        var documentUrl = '/api/event-instructions/' + instructionId + '/document';
        var r = await pgPool.query(
          'UPDATE event_instructions SET document_file_url = $1, document_mime_type = $2 WHERE id = $3 RETURNING *',
          [documentUrl, mime, instructionId]
        );
        console.log('[EVENT INSTRUCTIONS] Saved document for instruction', instructionId);
        res.json({ ok: true, instruction: r.rows[0] });
      } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
    req.on('error', function() {
      res.status(500).json({ ok: false, error: 'Upload failed.' });
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/event-instructions/:id/document', requireLogin, requirePermission('staff'), function(req, res) {
  var instructionId = path.basename(req.params.id);
  try {
    var fp = findEventInstructionDoc(instructionId);
    if (!fp) return res.status(404).end();
    var ext = path.extname(fp).toLowerCase();
    var mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', 'inline; filename="' + instructionId + ext + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(fp));
  } catch (e) {
    res.status(500).end();
  }
});

// Generates individually-tracked links for a deployment's guards, an explicit
// respondent list (agency guards and/or GuardTec staff, mixed), or both —
// EventInstructionsPanel's "generate links for a deployment OR a list of
// employees" (2.3), backed by generateFormLink() above.
app.post('/api/event-instructions/:id/links', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var instructionCheck = await pgPool.query('SELECT id FROM event_instructions WHERE id = $1', [req.params.id]);
    if (!instructionCheck.rows.length) return res.status(404).json({ ok: false, error: 'Instruction not found.' });

    var b = req.body || {};
    var deploymentId = b.deployment_id ? String(b.deployment_id).trim() : null;
    var respondents = Array.isArray(b.respondents) ? b.respondents : [];

    // No explicit respondent list but a deployment was given — default to
    // every guard currently assigned to that deployment.
    if (!respondents.length && deploymentId) {
      var attendanceResult = await pgPool.query('SELECT agency_staff_id FROM deployment_attendance WHERE deployment_id = $1', [deploymentId]);
      respondents = attendanceResult.rows.map(function(row) { return { respondent_type: 'agency_staff', respondent_id: row.agency_staff_id }; });
    }
    if (!respondents.length) {
      return res.status(400).json({ ok: false, error: 'Provide a deployment_id (with assigned guards) or an explicit respondents list.' });
    }

    var links = [];
    for (var i = 0; i < respondents.length; i++) {
      var respondentType = String(respondents[i].respondent_type || '');
      var respondentId   = String(respondents[i].respondent_id || '');
      if (!respondentId) return res.status(400).json({ ok: false, error: 'Every respondent needs a respondent_id.' });
      var url = await generateFormLink(req.params.id, respondentType, respondentId, deploymentId);
      links.push({ respondent_type: respondentType, respondent_id: respondentId, url: url });
    }
    res.json({ ok: true, links: links });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ ok: false, error: e.error });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── PUBLIC: ACKNOWLEDGMENT FORM (unauthenticated by design) ───────────────────
// No requireLogin gate on any of the three routes below, same lightweight
// pattern as /api/login and /api/register — and all three are exempted from
// the CSRF double-submit check above. Reasoning is different from
// login/register though: this isn't "there's no session yet", it's "there is
// deliberately never going to be a session here at all" — the 256-bit token
// in the URL IS the security boundary (plan's Key Security Considerations
// #2). Reached only via the link generateFormLink() hands out; there is no
// listing/browsing route for these.

// Shared read-only validation for the view + progress-update routes below —
// mirrors the plan's validateFormAccess exactly (404 unknown token, 403
// expired, 403 already-signed). The sign route further down deliberately does
// NOT use this: it must be a single atomic conditional UPDATE, never a
// check-then-write (debug note #8), so it re-implements its own WHERE clause
// instead of calling through this SELECT-based helper.
async function loadAckFormOrThrow(token) {
  var r = await pgPool.query('SELECT * FROM acknowledgment_forms WHERE form_token = $1', [token]);
  if (!r.rows.length) throw { status: 404, error: 'Invalid link.' };
  var form = r.rows[0];
  if (new Date(form.link_expires_at) < new Date()) throw { status: 403, error: 'This link has expired.' };
  if (form.signed_at) throw { status: 403, error: 'This form has already been signed.' };
  return form;
}

app.get('/api/acknowledge/:token', async function(req, res) {
  try {
    var form = await loadAckFormOrThrow(req.params.token);

    // First open — audit trail (2.5). Guarded by IS NULL so a re-open never
    // overwrites the original open time.
    if (!form.form_opened_at) {
      var opened = await pgPool.query(
        'UPDATE acknowledgment_forms SET form_opened_at = NOW() WHERE id = $1 AND form_opened_at IS NULL RETURNING *',
        [form.id]
      );
      if (opened.rows.length) form = opened.rows[0];
    }

    var instructionResult = await pgPool.query('SELECT * FROM event_instructions WHERE id = $1', [form.instruction_id]);
    res.json({ ok: true, form: form, instruction: instructionResult.rows[0] || null });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ ok: false, error: err.error });
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/acknowledge/:token/progress', async function(req, res) {
  try {
    var form = await loadAckFormOrThrow(req.params.token);

    var b = req.body || {};
    var currentStep = Number(b.current_step);
    if (!Number.isFinite(currentStep) || currentStep < 0) {
      return res.status(400).json({ ok: false, error: 'current_step must be a non-negative number.' });
    }
    var readDuration = (b.read_duration_seconds !== undefined && b.read_duration_seconds !== null) ? Number(b.read_duration_seconds) : null;

    // current_step only ever moves forward (2.5: "current_step only moves
    // forward") — GREATEST() so a stale/out-of-order request (e.g. a slow
    // duplicate tab) can never rewind progress already made. Re-checks
    // expiry/signed state in the WHERE clause too, so a form that expired or
    // got signed in the gap since loadAckFormOrThrow() above can't be
    // touched here either.
    var r = await pgPool.query(
      `UPDATE acknowledgment_forms
       SET current_step = GREATEST(current_step, $1), read_duration_seconds = COALESCE($2, read_duration_seconds)
       WHERE id = $3 AND link_expires_at > NOW() AND signed_at IS NULL
       RETURNING *`,
      [currentStep, readDuration, form.id]
    );
    if (!r.rows.length) return res.status(403).json({ ok: false, error: 'Link expired or already used.' });
    res.json({ ok: true, form: r.rows[0] });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ ok: false, error: err.error });
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/acknowledge/:token/sign', authRateLimiter, async function(req, res) {
  try {
    var token = String(req.params.token || '');
    var b = req.body || {};
    var signerName = String(b.signer_name || '').trim();
    if (!signerName) return res.status(400).json({ ok: false, error: 'signer_name is required.' });
    var signatureData = b.signature_data ? String(b.signature_data) : null;
    var ipAddress = req.ip || null;
    var userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']) : null;

    // Single atomic conditional UPDATE — no separate SELECT-then-UPDATE. If
    // two sign requests for the same token race each other, both reach this
    // statement, but only the one that still finds signed_at IS NULL at
    // commit time actually updates a row — so exactly one gets rowCount = 1
    // and the loser gets 0, closing the race in debug note #8.
    var r = await pgPool.query(
      `UPDATE acknowledgment_forms
       SET signed_at = NOW(), signer_name = $1, signature_data = $2,
           ip_address = $3, user_agent = $4, form_read_at = COALESCE(form_read_at, NOW())
       WHERE form_token = $5 AND link_expires_at > NOW() AND signed_at IS NULL
       RETURNING *`,
      [signerName, signatureData, ipAddress, userAgent, token]
    );
    if (r.rowCount === 0) {
      return res.status(403).json({ ok: false, error: 'Link expired or already used.' });
    }
    res.json({ ok: true, form: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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

// ── FEATURE 3: CUSTOM FORMS BUILDER ───────────────────────────────────────────
// A published custom form can be answered by a regular staff member, an
// agency (the admin org itself), or one of an agency's guards. Only the
// 'staff' case has a pending_submission / manager-approval concept — agencies
// and agency_staff have no such workflow (plan 3.6), so auto-mapped answers
// for them write straight onto their Postgres row.
var CUSTOM_FORM_FIELD_TYPES = ['text', 'textarea', 'email', 'phone', 'date', 'number', 'dropdown', 'radio', 'checkbox', 'file', 'signature', 'table'];
var CUSTOM_FORM_TYPES = ['staff_info', 'agency_info', 'site_info', 'event_info', 'general'];

// Direct-write allowlists for the non-staff auto-map targets — sibling to
// MY_PROFILE_FIELDS, same reasoning: a field name that ends up as a bare
// column in an UPDATE statement must come from a fixed list, never off the
// request body, or a form's field_mapping becomes an arbitrary-column-write
// primitive. Deliberately excludes id/status/cert/audit columns on both
// tables — those aren't things a form response should ever be able to touch.
var AGENCY_PROFILE_FIELDS = ['name', 'email', 'phone', 'notes'];
var AGENCY_STAFF_PROFILE_FIELDS = ['name', 'email', 'phone', 'nationality', 'job_role', 'custom_role', 'badge_type', 'dbs_expiry', 'sia_expiry', 'cscs_expiry'];

// The Governance Fix (plan 3.5): whatever entity type a mapped field targets,
// the target name must come from one of these three fixed allowlists — never
// an arbitrary string the form builder typed in. This is what makes it
// impossible to build a form that silently creates/writes an ungoverned field.
function isAllowedProfileMapping(fieldName) {
  return MY_PROFILE_FIELDS.indexOf(fieldName) !== -1 ||
         AGENCY_PROFILE_FIELDS.indexOf(fieldName) !== -1 ||
         AGENCY_STAFF_PROFILE_FIELDS.indexOf(fieldName) !== -1;
}

// Validates the fields JSONB body of a custom form. When auto_map_to_profile
// is true, every field's optional `profile_field` mapping target is checked
// against the allowlists above — this is the one check that keeps 3.5's
// governance fix real rather than advisory. Returns an error string, or null.
function validateCustomFormFields(fields, autoMapToProfile) {
  if (!Array.isArray(fields) || !fields.length) return 'fields must be a non-empty array.';
  var seenIds = {};
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i] || {};
    var id = String(f.id || '').trim();
    var type = String(f.type || '').trim();
    var label = String(f.label || '').trim();
    if (!id) return 'Every field needs an id.';
    if (seenIds[id]) return 'Duplicate field id: ' + id;
    seenIds[id] = true;
    if (CUSTOM_FORM_FIELD_TYPES.indexOf(type) === -1) return 'Field "' + id + '" has an invalid type.';
    if (!label) return 'Field "' + id + '" needs a label.';
    if (autoMapToProfile && f.profile_field !== undefined && f.profile_field !== null && f.profile_field !== '') {
      if (!isAllowedProfileMapping(String(f.profile_field))) {
        return 'Field "' + id + '" maps to an unrecognised profile field: ' + f.profile_field;
      }
    }
  }
  return null;
}

// ── ADMIN: CUSTOM FORMS (create/edit/publish) ─────────────────────────────────
app.post('/api/custom-forms', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var b = req.body || {};
    var name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ ok: false, error: 'name is required.' });

    var formType = String(b.form_type || '').trim();
    if (CUSTOM_FORM_TYPES.indexOf(formType) === -1) {
      return res.status(400).json({ ok: false, error: 'form_type must be one of: ' + CUSTOM_FORM_TYPES.join(', ') });
    }

    var autoMap = b.auto_map_to_profile === true;
    var fieldsError = validateCustomFormFields(b.fields, autoMap);
    if (fieldsError) return res.status(400).json({ ok: false, error: fieldsError });

    var linkedType = b.linked_to_entity_type ? String(b.linked_to_entity_type).trim() : null;
    var linkedId   = b.linked_to_entity_id ? String(b.linked_to_entity_id).trim() : null;

    var r = await pgPool.query(
      `INSERT INTO custom_forms
         (name, description, form_type, fields, linked_to_entity_type, linked_to_entity_id, created_by, is_published, auto_map_to_profile)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, b.description || null, formType, JSON.stringify(b.fields), linkedType, linkedId, req.user.id, b.is_published === true, autoMap]
    );
    res.json({ ok: true, form: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/custom-forms', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var conditions = [];
    var params = [];
    if (req.query.form_type) { params.push(req.query.form_type); conditions.push('form_type = $' + params.length); }
    if (req.query.linked_to) { params.push(req.query.linked_to); conditions.push('linked_to_entity_type = $' + params.length); }

    var sql = 'SELECT * FROM custom_forms' +
      (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '') +
      ' ORDER BY created_at DESC';
    var result = await pgPool.query(sql, params);
    res.json({ ok: true, forms: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Single-form fetch — needed by the respondent-facing fill page (which only
// knows a form id from a shared link, never the full list) and by the
// responses page. Deliberately NOT gated by requirePermission('staff'): a
// 'staff'/'agency' respondent filling out a published form has no management
// permission at all, so gating this the same as the list route would make
// the fill flow 403 for every real respondent. Unpublished/draft forms are
// hidden from non-managers so a guessed id can't preview a form still being
// built. Still requires a session (requireLogin) — see the router-integration
// notes on CustomFormFillPage for why a truly anonymous, no-login fill isn't
// supported yet.
app.get('/api/custom-forms/:id', requireLogin, async function(req, res) {
  try {
    var r = await pgPool.query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Form not found.' });
    var form = r.rows[0];
    if (!form.is_published && !(await hasStaffPermission(req))) {
      return res.status(404).json({ ok: false, error: 'Form not found.' });
    }
    res.json({ ok: true, form: form });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/custom-forms/:id', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var existing = await pgPool.query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Form not found.' });
    var current = existing.rows[0];

    var b = req.body || {};
    var formType = current.form_type;
    if (b.form_type !== undefined) {
      formType = String(b.form_type).trim();
      if (CUSTOM_FORM_TYPES.indexOf(formType) === -1) {
        return res.status(400).json({ ok: false, error: 'form_type must be one of: ' + CUSTOM_FORM_TYPES.join(', ') });
      }
    }

    var autoMap = b.auto_map_to_profile !== undefined ? (b.auto_map_to_profile === true) : current.auto_map_to_profile;
    var fields = b.fields !== undefined ? b.fields : current.fields;
    var fieldsError = validateCustomFormFields(fields, autoMap);
    if (fieldsError) return res.status(400).json({ ok: false, error: fieldsError });

    var name          = b.name !== undefined ? String(b.name).trim() : current.name;
    var description   = b.description !== undefined ? b.description : current.description;
    var linkedType    = b.linked_to_entity_type !== undefined ? (String(b.linked_to_entity_type || '').trim() || null) : current.linked_to_entity_type;
    var linkedId      = b.linked_to_entity_id !== undefined ? (String(b.linked_to_entity_id || '').trim() || null) : current.linked_to_entity_id;
    var isPublished   = b.is_published !== undefined ? (b.is_published === true) : current.is_published;
    // Same explicit-flag pattern as event_instructions' bump_version (2.2) —
    // editing a published form's fields doesn't retroactively change past
    // responses' meaning, so version only moves on request, not implicitly.
    var version = b.bump_version === true ? current.version + 1 : current.version;

    var r = await pgPool.query(
      `UPDATE custom_forms
       SET name = $1, description = $2, form_type = $3, fields = $4, linked_to_entity_type = $5,
           linked_to_entity_id = $6, is_published = $7, auto_map_to_profile = $8, version = $9, updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [name, description, formType, JSON.stringify(fields), linkedType, linkedId, isPublished, autoMap, version, req.params.id]
    );
    res.json({ ok: true, form: r.rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Hard delete — a custom form isn't vetting/compliance data with a
// retention requirement (unlike ex-staff records), so unlike
// /api/exstaff/permanent this needs no 7-year guard. Still destroys
// recorded responses, so the response count is returned for the frontend
// to warn on before the confirm click, same info-then-confirm shape as any
// other irreversible delete in this app.
app.delete('/api/custom-forms/:id', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var existing = await pgPool.query('SELECT id FROM custom_forms WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Form not found.' });

    var client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      var deletedResponses = await client.query('DELETE FROM custom_form_responses WHERE form_id = $1', [req.params.id]);
      await client.query('DELETE FROM custom_forms WHERE id = $1', [req.params.id]);
      await client.query('COMMIT');
      res.json({ ok: true, deleted_responses: deletedResponses.rowCount });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/custom-forms/:id/responses', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var formResult = await pgPool.query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id]);
    if (!formResult.rows.length) return res.status(404).json({ ok: false, error: 'Form not found.' });
    var responses = await pgPool.query(
      'SELECT * FROM custom_form_responses WHERE form_id = $1 ORDER BY submitted_at DESC NULLS LAST',
      [req.params.id]
    );
    res.json({ ok: true, form: formResult.rows[0], responses: responses.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Resolves who is actually submitting, from the logged-in session — never
// from a client-supplied respondent_type/id, UNLESS the requester already
// holds the 'staff' management permission (i.e. an admin filling a form on
// someone else's behalf, like the plan's "Agency Onboarding Checklist" —
// admin-filled, 3.6). Everyone else can only ever submit as themselves: a
// 'staff' role submits as their own staff_id, an 'agency' role submits either
// as their own agency or — if they pass agency_staff_id — as one of their own
// guards (ownership re-checked against agency_id, same trust boundary as
// requireOwnAgencyOrPermission elsewhere). Throws {status, error} on failure.
async function resolveFormRespondent(req) {
  var b = req.body || {};
  if (await hasStaffPermission(req)) {
    var explicitType = String(b.respondent_type || '');
    var explicitId   = b.respondent_id !== undefined && b.respondent_id !== null ? String(b.respondent_id) : '';
    if (['staff', 'agency', 'agency_staff'].indexOf(explicitType) === -1 || !explicitId) {
      throw { status: 400, error: 'respondent_type (staff|agency|agency_staff) and respondent_id are required.' };
    }
    return { type: explicitType, id: explicitId };
  }
  if (req.user.role === 'staff') {
    if (!req.user.staff_id) throw { status: 403, error: 'No linked staff profile.' };
    return { type: 'staff', id: req.user.staff_id };
  }
  if (req.user.role === 'agency') {
    var agencyStaffId = b.agency_staff_id ? String(b.agency_staff_id) : '';
    if (agencyStaffId) {
      var check = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [agencyStaffId, req.user.agency_id]);
      if (!check.rows.length) throw { status: 403, error: 'That guard is not registered to your agency.' };
      return { type: 'agency_staff', id: agencyStaffId };
    }
    if (!req.user.agency_id) throw { status: 403, error: 'No linked agency.' };
    return { type: 'agency', id: req.user.agency_id };
  }
  throw { status: 403, error: 'Forbidden' };
}

// Builds { profile_field: value } from a submitted response_data object,
// using the form's own field->profile_field mapping — never trusts a mapping
// supplied by the request itself, only the one already validated and stored
// on the form at create/PATCH time (validateCustomFormFields above).
function extractMappedFields(formFields, responseData) {
  var mapped = {};
  (formFields || []).forEach(function(f) {
    var target = f && f.profile_field;
    if (!target || responseData[f.id] === undefined) return;
    mapped[target] = responseData[f.id];
  });
  return mapped;
}

app.post('/api/custom-forms/:id/submit', requireLogin, async function(req, res) {
  try {
    var formResult = await pgPool.query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id]);
    if (!formResult.rows.length) return res.status(404).json({ ok: false, error: 'Form not found.' });
    var form = formResult.rows[0];
    if (!form.is_published) return res.status(403).json({ ok: false, error: 'This form is not currently open for responses.' });

    var b = req.body || {};
    var responseData = (b.response_data && typeof b.response_data === 'object') ? b.response_data : {};

    var respondent = await resolveFormRespondent(req);

    var inserted = await pgPool.query(
      `INSERT INTO custom_form_responses (form_id, respondent_type, respondent_id, response_data, submitted_at, ip_address, status)
       VALUES ($1,$2,$3,$4,NOW(),$5,'submitted') RETURNING *`,
      [form.id, respondent.type, respondent.id, JSON.stringify(responseData), req.ip || null]
    );

    // auto_map_to_profile — Governance Fix (plan 3.5): a 'staff' respondent's
    // mapped answers land in pending_submission and wait for manager
    // approval, EXACTLY like a self-service /api/my-profile edit — this form
    // is just another door into the same gated mechanism, never a bypass of
    // it. 'agency'/'agency_staff' have no such workflow (3.6), so their
    // mapped answers write straight onto the Postgres row.
    if (form.auto_map_to_profile) {
      var mapped = extractMappedFields(form.fields, responseData);
      if (Object.keys(mapped).length) {
        if (respondent.type === 'staff') {
          var all = loadAllStaff();
          var emp = all.find(function(e) { return e.id === respondent.id; });
          if (emp) {
            applyPendingProfileFields(emp, mapped);
            await saveStaff(emp, emp._folderPath);
          }
        } else if (respondent.type === 'agency') {
          var agencySets = [];
          var agencyParams = [];
          Object.keys(mapped).forEach(function(field) {
            if (AGENCY_PROFILE_FIELDS.indexOf(field) === -1) return; // belt-and-braces; already enforced at form save time
            agencyParams.push(mapped[field]);
            agencySets.push(field + ' = $' + agencyParams.length);
          });
          if (agencySets.length) {
            agencyParams.push(respondent.id);
            await pgPool.query('UPDATE agencies SET ' + agencySets.join(', ') + ' WHERE id = $' + agencyParams.length, agencyParams);
          }
        } else if (respondent.type === 'agency_staff') {
          var staffSets = [];
          var staffParams = [];
          Object.keys(mapped).forEach(function(field) {
            if (AGENCY_STAFF_PROFILE_FIELDS.indexOf(field) === -1) return;
            staffParams.push(mapped[field]);
            staffSets.push(field + ' = $' + staffParams.length);
          });
          if (staffSets.length) {
            staffSets.push('updated_at = NOW()');
            staffParams.push(respondent.id);
            await pgPool.query('UPDATE agency_staff SET ' + staffSets.join(', ') + ' WHERE id = $' + staffParams.length, staffParams);
          }
        }
      }
    }

    res.json({ ok: true, response: inserted.rows[0] });
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ ok: false, error: e.error });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// CSV export — every field runs through the same sanitizeForExcel() used by
// CSV import (debug note #10), since a formula-injection payload works just
// as well typed into a form response as it does in an imported spreadsheet
// cell, and this export is just as likely to be reopened in Excel.
function csvCell(value) {
  var str = value === null || value === undefined ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value));
  str = String(sanitizeForExcel(str));
  if (/[",\n\r]/.test(str)) str = '"' + str.replace(/"/g, '""') + '"';
  return str;
}

app.get('/api/custom-forms/:id/export', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var formResult = await pgPool.query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id]);
    if (!formResult.rows.length) return res.status(404).json({ ok: false, error: 'Form not found.' });
    var form = formResult.rows[0];
    var fields = Array.isArray(form.fields) ? form.fields : [];

    var responses = await pgPool.query(
      'SELECT * FROM custom_form_responses WHERE form_id = $1 ORDER BY submitted_at DESC NULLS LAST',
      [req.params.id]
    );

    var headers = ['respondent_type', 'respondent_id', 'submitted_at', 'status'].concat(fields.map(function(f) { return f.label || f.id; }));
    var lines = [headers.map(csvCell).join(',')];
    responses.rows.forEach(function(row) {
      var data = row.response_data || {};
      var line = [row.respondent_type, row.respondent_id, row.submitted_at, row.status]
        .concat(fields.map(function(f) { return data[f.id]; }));
      lines.push(line.map(csvCell).join(','));
    });

    var csv = lines.join('\r\n');
    var filename = (form.name || 'form').replace(/[^a-z0-9_\- ]/gi, '').trim() || 'form';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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
    var reporterName = null;
    if (!b.is_anonymous && req.user.staff_id) {
      var empResult = await pgPool.query('SELECT id, name FROM employees WHERE legacy_id = $1', [req.user.staff_id]);
      if (empResult.rows.length) { reporterId = empResult.rows[0].id; reporterName = empResult.rows[0].name; }
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
    createNotification({
      type: 'incident_report',
      actorName: b.is_anonymous ? 'Anonymous' : (reporterName || 'A staff member'),
      summary: 'submitted an incident report',
      linkIncidentId: result.rows[0].id,
    });
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
    // Flagged (inappropriate-content) reports are hidden from the normal
    // queue for everyone by default — director-only, and only on request,
    // since reviewing them is a deliberate moderation action, not routine
    // triage. Never based on reporter identity (there isn't one to filter
    // on) — purely the report's own flagged_inappropriate column.
    var includeFlagged = req.query.includeFlagged === 'true' && req.user.role === 'director';
    var result = await pgPool.query(
      `SELECT ir.*,
         CASE WHEN ir.is_anonymous THEN NULL ELSE e.name END AS reporter_name,
         u.full_name AS reviewed_by_name,
         fb.full_name AS flagged_by_name,
         COUNT(ia.id)::int AS attachment_count
       FROM incident_reports ir
       LEFT JOIN employees e ON e.id = ir.reporter_id
       LEFT JOIN users u ON u.id = ir.reviewed_by
       LEFT JOIN users fb ON fb.id = ir.flagged_by
       LEFT JOIN incident_attachments ia ON ia.incident_id = ir.id
       WHERE ir.flagged_inappropriate = FALSE OR $1
       GROUP BY ir.id, e.name, u.full_name, fb.full_name
       ORDER BY ir.created_at DESC`,
      [includeFlagged]
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

// Director-only content moderation — flags a report as inappropriate (e.g.
// abusive language) to pull it out of the normal management queue. Operates
// solely on the report row; never touches reporter_id/is_anonymous, so an
// anonymous submitter's identity is never at risk of exposure through this
// route, by design (see the schema comment above for why a "reveal identity"
// feature was considered and deliberately rejected instead of this).
app.patch('/api/incident-reports/:reportId/flag', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var reason = String((req.body && req.body.reason) || '').trim();
    var r = await pgPool.query(
      `UPDATE incident_reports
       SET flagged_inappropriate = TRUE, flagged_at = NOW(), flagged_by = $1, flagged_reason = $2, updated_at = NOW()
       WHERE id = $3 RETURNING id`,
      [req.user.id, reason || null, req.params.reportId]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Report not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Reverses a flag made in error — same director-only, identity-blind scope.
app.patch('/api/incident-reports/:reportId/unflag', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var r = await pgPool.query(
      `UPDATE incident_reports
       SET flagged_inappropriate = FALSE, flagged_at = NULL, flagged_by = NULL, flagged_reason = NULL, updated_at = NOW()
       WHERE id = $1 RETURNING id`,
      [req.params.reportId]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Report not found.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Hard delete — director-only, and only once a report is no longer active
// (status 'resolved'/'closed'; not 'open'/'under_review') — "once it's been
// reviewed", per the user's own framing. Incident reports can allege
// harassment/discrimination/misconduct, so this isn't offered as a casual
// action: gating on review-complete avoids a still-open complaint being
// deleted before anyone's actually looked at it, and the deletion itself is
// logged to audit_events (same pattern as /api/exstaff/permanent) so there's
// still a trace even though the record itself is gone. reporter_id is never
// read/logged here beyond what's already on the row — deleting doesn't
// require or cause any extra exposure of an anonymous submitter's identity.
app.delete('/api/incident-reports/:reportId', requireLogin, requireRole('director'), async function(req, res) {
  try {
    var r = await pgPool.query('SELECT * FROM incident_reports WHERE id = $1', [req.params.reportId]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Report not found.' });
    var report = r.rows[0];
    if (report.status !== 'resolved' && report.status !== 'closed') {
      return res.status(400).json({ ok: false, error: 'Only a resolved/closed report can be deleted — update its status first.' });
    }

    var attachments = await pgPool.query('SELECT filename FROM incident_attachments WHERE incident_id = $1', [req.params.reportId]);

    await pgPool.query('DELETE FROM incident_reports WHERE id = $1', [req.params.reportId]); // cascades incident_attachments rows
    attachments.rows.forEach(function(a) {
      try { fs.unlinkSync(path.join(INCIDENT_ATTACH_DIR, a.filename)); } catch (e) { /* file already gone — fine */ }
    });

    await pgPool.query(
      `INSERT INTO audit_events (actor_email, action, object_type, object_id, object_name, metadata)
       VALUES ($1,'INCIDENT_REPORT_DELETED','incident_report',$2,$3,$4)`,
      [(req.user && req.user.username) || null, report.id, report.incident_type,
       JSON.stringify({ status: report.status, is_anonymous: report.is_anonymous, report_date: report.report_date })]
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
app.post('/api/incident-reports/:reportId/attachments', requireLogin, async function(req, res) {
  var reportRow = await pgPool.query('SELECT reporter_id FROM incident_reports WHERE id = $1', [req.params.reportId]);
  if (!reportRow.rows.length) return res.status(404).json({ ok: false, error: 'Report not found.' });
  if (!await canAccessOwnerEmpId(req, res, reportRow.rows[0].reporter_id)) return;

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
    var reportRow = await pgPool.query('SELECT reporter_id FROM incident_reports WHERE id = $1', [req.params.reportId]);
    if (!reportRow.rows.length) return res.status(404).json({ ok: false, error: 'Report not found.' });
    if (!await canAccessOwnerEmpId(req, res, reportRow.rows[0].reporter_id)) return;
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
app.get('/api/incident-attachments/:filename', requireLogin, async function(req, res) {
  try {
    var safe = path.basename(req.params.filename);
    var owner = await pgPool.query(
      'SELECT ir.reporter_id FROM incident_attachments ia JOIN incident_reports ir ON ir.id = ia.incident_id WHERE ia.filename = $1',
      [safe]
    );
    if (!owner.rows.length) return res.status(404).end();
    if (!await canAccessOwnerEmpId(req, res, owner.rows[0].reporter_id)) return;
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
    var r = await pgPool.query(
      'SELECT ia.filename, ir.reporter_id FROM incident_attachments ia JOIN incident_reports ir ON ir.id = ia.incident_id WHERE ia.id = $1',
      [req.params.attachId]
    );
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Not found.' });
    if (!await canAccessOwnerEmpId(req, res, r.rows[0].reporter_id)) return;
    var filePath = path.join(INCIDENT_ATTACH_DIR, r.rows[0].filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await pgPool.query('DELETE FROM incident_attachments WHERE id = $1', [req.params.attachId]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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
    var result = await pgPool.query(MESSAGES_SELECT, [empId]);
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

// ── Message Attachments ───────────────────────────────────────────────────────
var MESSAGE_ATTACH_DIR = path.join(BASE, 'message-attachments');
if (!fs.existsSync(MESSAGE_ATTACH_DIR)) fs.mkdirSync(MESSAGE_ATTACH_DIR, { recursive: true });

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
app.delete('/api/messages/:messageId', requireLogin, requirePermission('staff'), async function(req, res) {
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
app.get('/api/internal/fleet', requireN8nToken, async function(req, res) {
  try {
    var vehicles = await loadVehicles();
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
// Management: unseen per-event notifications for the bell — each one clickable,
// each disappears (seen_at set) once the manager has navigated to it.
app.get('/api/notifications', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    var result = await pgPool.query(
      `SELECT id, type, actor_name, summary, link_staff_id, link_tab, link_incident_id, link_agency_id, created_at
       FROM notifications WHERE seen_at IS NULL ORDER BY created_at DESC LIMIT 50`
    );
    res.json({ ok: true, notifications: result.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/notifications/:id/seen', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    await pgPool.query('UPDATE notifications SET seen_at = NOW() WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/notifications/seen-all', requireLogin, requirePermission('staff'), async function(req, res) {
  try {
    await pgPool.query('UPDATE notifications SET seen_at = NOW() WHERE seen_at IS NULL');
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
app.get('/api/push/vapid-public-key', requireLogin, requirePermission('staff'), function(req, res) {
  res.json({ ok: true, key: process.env.VAPID_PUBLIC_KEY || null });
});

app.post('/api/push/subscribe', requireLogin, requirePermission('staff'), async function(req, res) {
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

// ── AI CHAT ───────────────────────────────────────────────────────────────────
app.post('/api/ai-chat', requireLogin, async function(req, res) {
  var message = (req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Message required' });

  var webhookUrl = process.env.N8N_AI_WEBHOOK;
  if (!webhookUrl) return res.status(503).json({ error: 'AI service not configured' });

  try {
    var staffList = loadAllStaff();
    var vehicles  = await loadVehicles();

    var staffData = staffList.map(function(s) {
      return {
        name:         s.name,
        deployStatus: s.deployStatus || null,
        currentSite:  s.currentSite  || null,
        sia:  s.sia  ? { number: s.sia.number,  expiry: s.sia.expiry  } : null,
        cscs: s.cscs ? { number: s.cscs.number, expiry: s.cscs.expiry } : null,
        visa: s.visa ? { type:   s.visa.type,   expiry: s.visa.expiry } : null,
      };
    });

    var fleetData = vehicles.map(function(v) {
      return {
        registration:     v.registration     || null,
        make:             v.make             || null,
        model:            v.model            || null,
        status:           v.status           || null,
        mot_expiry:       v.mot_expiry       || null,
        insurance_expiry: v.insurance_expiry || null,
      };
    });

    var n8nRes = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ message, staffData, fleetData }),
      signal:  AbortSignal.timeout(30000),
    });

    if (!n8nRes.ok) throw new Error('n8n webhook returned ' + n8nRes.status);
    var data = await n8nRes.json();
    var answer = data.answer || data.response || data.output ||
                 (data.choices && data.choices[0]?.message?.content) ||
                 'No response received.';
    res.json({ answer });
  } catch (err) {
    console.error('[AI Chat]', err.message);
    res.status(500).json({ error: 'AI service unavailable — please try again.' });
  }
});

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
  });
})();