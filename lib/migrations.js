// Self-healing schema migrations that run in the background on startup.
//
// Loaded from server.js: mount(require('./lib/migrations')(deps))

module.exports = function migrationsLib(deps) {
  var pgPool = deps.pgPool;

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

  return {
    employeesExtendedSchemaReady: employeesExtendedSchemaReady,
  };
};
