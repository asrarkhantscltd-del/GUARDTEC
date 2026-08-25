# GuardTec Agency & Custom Forms Implementation Plan

## Overview
Three interconnected features for managing external cover guards from agencies, event-specific compliance acknowledgment forms (for both agency cover guards AND GuardTec's own staff), and a reusable custom form builder.

---

## DEBUG PASS — What Was Wrong With v1 And Why

The first draft of this plan was written from the conversation alone, without checking it against the actual running app. Checking it against `server.js` and the real `schema*.sql` files surfaced real bugs — some would have failed outright at build time, others would have quietly broken agreed requirements. Listed worst-first:

1. **`site_id UUID REFERENCES sites(id)` doesn't reference anything real.** There is no Postgres `sites` table anywhere in this codebase. Sites are JSON — `deployment-sites.json` — with plain string IDs generated as `Date.now().toString()` (`server.js:1546`). Every FK to `sites(id)` in v1 (on `agency_deployments` and `event_instructions`) would have failed to migrate. **Fixed:** `site_id TEXT`, no FK, validated at the application layer against `loadSites()` — same treatment `users.staff_id` already gets (it's `TEXT` with no FK into `employees`, precisely because the real staff record lives in JSON, not Postgres).

2. **Agency login invented a second, parallel auth system.** v1 put `login_email` / `login_password_hash` directly on the `agencies` table. But this app already has exactly the mechanism needed: the `users` table + `role` column + JWT session (`server.js:264` `/api/login`), where `role = 'staff'` plus a `staff_id TEXT` column already restricts one login to one staff record (see `requireOwnStaffOrPermission`). **Fixed:** agencies get a `role = 'agency'` login the same way — a `users` row with a new `agency_id TEXT` column (mirrors `staff_id`), no separate password system, no separate session logic. One auth system, not two.

3. **Two competing "acknowledgment form" tables, drafted at different points in the conversation, never reconciled.** Section 1.2 of v1 defined `agency_acknowledgment_forms` (deployment_id, staff_id, form_content, form_signed…). Section 2.2 independently defined a *second*, differently-shaped table for the same concept — `acknowledgment_form_responses` (form_token, instruction_id, read_duration_seconds, signature_data…) — because Feature 2 was designed in a later message without circling back to what Feature 1 already had. Building both would mean two disconnected records of "did this guard sign," neither authoritative. **Fixed:** merged into one table, `acknowledgment_forms` (see Feature 2 below). The agency admin's *own* "I understand / I've briefed my staff" checkbox stays where it already correctly lived — the `agency_acknowledged` columns already on `agency_deployments` — because that's a different fact (the agency confirming) from an individual guard signing.

4. **The merged acknowledgment table only pointed at `agency_staff` — but you explicitly asked for this to also cover GuardTec's own staff** ("i want that kind of Event Instructions as Acknowledgment Form for guardtec as well"). A hard FK to `agency_staff(id)` makes that structurally impossible — regular staff aren't rows in that table. **Fixed:** polymorphic respondent (`respondent_type` + `respondent_id`, no FK — same reasoning as point 1), so one table serves both a cover guard and a GuardTec employee.

5. **Messaging duplicated `staff_messages` instead of extending it**, even though you said "same message system which we created for our staff" and I confirmed that. A new `agency_messages` table would be a second messaging system with its own attachment handling, its own delete logic, its own unread-count logic — none of it shared with the one already built and tested. **Fixed:** extend `staff_messages` in place (relax `employee_id` to nullable, add nullable `agency_id`, one check constraint that exactly one is set). Same table, same `message_attachments` join, same delete permission model — genuinely one system, not two that happen to look similar.

6. **Compliance status didn't account for role-conditional documents.** v1's `calculateComplianceStatus` checked `dog_handler_cert_uploaded` unconditionally, which would flag every non-Dog-Handler guard as incomplete for a certificate that doesn't apply to them. The staff onboarding wizard already solves exactly this (CSCS is only required when a CSCS number is actually entered — see memory `guardtec_bs7858_onboarding_wizard`). **Fixed:** cert requirements are conditional on `job_role`, same pattern.

7. **"Delete" meant hard delete**, which throws away the audit trail (who was deployed where, who signed what) the second an agency or a guard is removed — a real problem for BS7858/GDPR retention, and inconsistent with how this app already treats staff removal (existing staff "delete" is actually an archive-to-Ex-Staff move, never destructive). **Fixed:** agencies and agency_staff are deactivated/archived, never hard-deleted; their deployment and acknowledgment history stays queryable.

8. **Sign-form race condition.** v1's pseudocode was check-then-write ("read `signed_at`, if empty then `UPDATE`"), which is a classic TOCTOU gap — two near-simultaneous submits (double-click, or a replayed request) could both pass the check before either write lands, defeating "one-time use." **Fixed:** the sign operation is a single atomic conditional update (`UPDATE ... WHERE token = $1 AND signed_at IS NULL`), and the caller checks the row count, not a separate read.

9. **The link's 5-minute expiry was echoed into the URL's query string.** Decorative for a countdown display is fine; anything that validates against it instead of the DB row would be a client-controlled bypass. **Fixed:** made explicit that `expires_at` in the DB is the only source of truth — the query string is display-only.

10. **Given this app's core workflow is Excel-integrated** (per the original `CLAUDE.md`, spreadsheet auto-sync is a founding feature), a CSV bulk-import of guard names/roles is a live formula-injection surface: a field starting with `=`, `+`, `-`, or `@` executes if that data is later opened in Excel. Not flagged in v1 at all. **Fixed:** added as an explicit sanitization step on CSV import.

11. **Several refinements you explicitly approved** ("sub theek hai add kardo unhe bhi") **never made it into the actual schema** — they were listed as chat bullets but the plan file predated most of them structurally. Missing: attendance confirmation, guard certification auto-block as an enforced rule (not just a UI hint), agency performance dashboard, deployment notes/comments, and guard unavailability/leave marking. **Fixed:** all five now have real tables/rules below, not just a bullet point.

12. **`staff_assignments JSONB` on `agency_deployments`** would have made "show me every no-show this month across all agencies" require unpacking a JSON blob inside every deployment row rather than a plain query. **Fixed:** replaced with a real child table, `deployment_attendance`, one row per guard per deployment — which is also where attendance confirmation (point 11) naturally lives.

Everything below reflects these fixes — this is not a delta, it's the corrected plan in full.

---

## FEATURE 1: AGENCY COVER GUARDS MANAGEMENT

### 1.1 Architecture

```
Admin (You) — logs in as normal, role has 'staff' permission
  ├─ Create Agency Accounts (creates a `users` row with role='agency')
  ├─ Upload Event Instructions (Feature 2, linked to a site)
  ├─ View All Agencies Dashboard + Performance
  │
Agency Admin — logs in via the SAME /api/login, role='agency'
  ├─ Register Cover Guards (Tab 1)
  ├─ Create Deployments (Tab 2: Calendar)
  ├─ Confirm Attendance After Deployment
  ├─ Mark Guard Unavailability
  ├─ Messages (shared staff_messages system)
  │
Cover Guards (no login at all — Option 2, confirmed)
  ├─ Receive a secure one-time link to view + sign acknowledgment forms
  ├─ Everything else is managed FOR them by their agency admin
```

### 1.2 Database Schema

**Table: agencies**
```sql
CREATE TABLE agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active' | 'archived'
  archived_at TIMESTAMPTZ,
  notes TEXT
  -- No password/login columns here — see "Agency Login" below.
);
```

**Agency Login (reuses existing auth, does not add a new system)**
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS agency_id TEXT;
-- Mirrors the existing users.staff_id TEXT column exactly. A users row with
-- role = 'agency' and agency_id = <agencies.id> is how an agency logs in —
-- same /api/login endpoint, same JWT, same cookie, same requireLogin.
```

```typescript
// New middleware, sibling to the existing requireOwnStaffOrPermission,
// same shape, reused everywhere an agency-scoped route needs gating:
function requireOwnAgencyOrPermission(moduleKey) {
  return async function(req, res, next) {
    if (req.user && req.user.role === 'agency') {
      if (req.user.agency_id && req.user.agency_id === req.params.agencyId) return next()
      return res.status(403).json({ ok: false, error: 'Forbidden' })
    }
    return requirePermission(moduleKey)(req, res, next) // admin path — unchanged
  }
}
```

`'agency'` is a structural role like `'staff'` — it should NOT appear in the normal role-management UI where a Director assigns `ops_manager`/`hr_manager`/etc. to a department user. It only ever gets created by the "create agency account" action.

**Table: agency_staff (Cover Guards)**
```sql
CREATE TABLE agency_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  nationality VARCHAR(100),
  job_role VARCHAR(100) NOT NULL, -- Security Officer, Door Supervisor, Dog Handler, Other
  custom_role VARCHAR(255), -- filled when job_role = 'Other'
  badge_type VARCHAR(50), -- SIA, CSCS, Other
  -- Profile photo is NOT a column — file-based, see 1.5 "Profile Photo Storage".

  -- BS7858 Compliance — each cert's *requirement* is conditional on job_role,
  -- see calculateComplianceStatus() in 1.5. The columns below only record
  -- whether something was uploaded; they don't imply it was required.
  dbs_expiry DATE,
  sia_cert_uploaded BOOLEAN NOT NULL DEFAULT FALSE,
  sia_cert_upload_date TIMESTAMPTZ,
  cscs_cert_uploaded BOOLEAN NOT NULL DEFAULT FALSE,
  cscs_cert_upload_date TIMESTAMPTZ,
  rtw_cert_uploaded BOOLEAN NOT NULL DEFAULT FALSE,
  rtw_cert_upload_date TIMESTAMPTZ,
  dog_handler_cert_uploaded BOOLEAN NOT NULL DEFAULT FALSE, -- only meaningful if job_role = 'Dog Handler'
  dog_handler_cert_upload_date TIMESTAMPTZ,
  training_cert_uploaded BOOLEAN NOT NULL DEFAULT FALSE,
  training_cert_upload_date TIMESTAMPTZ,

  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active' | 'archived' — never hard-deleted
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_agency_staff_agency ON agency_staff(agency_id) WHERE status = 'active';
```

**Table: agency_staff_unavailability** *(new — was missing entirely in v1)*
```sql
CREATE TABLE agency_staff_unavailability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_staff_id UUID NOT NULL REFERENCES agency_staff(id) ON DELETE CASCADE,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  reason VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (date_to >= date_from)
);
```
Guard-matching (1.5) excludes anyone whose unavailability range overlaps the event date.

**Table: agency_deployments**
```sql
CREATE TABLE agency_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES agencies(id),
  site_id TEXT NOT NULL, -- deployment-sites.json id — see debug note #1, no FK
  event_date DATE NOT NULL,

  agency_acknowledged BOOLEAN NOT NULL DEFAULT FALSE, -- "I understand + I've briefed my staff"
  agency_acknowledged_by TEXT, -- users.id of the agency admin who ticked it
  agency_acknowledged_at TIMESTAMPTZ,

  status VARCHAR(20) NOT NULL DEFAULT 'scheduled', -- scheduled | completed | cancelled
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_deployments_agency ON agency_deployments(agency_id);
CREATE INDEX idx_deployments_site_date ON agency_deployments(site_id, event_date);
```

**Table: deployment_attendance** *(replaces v1's `staff_assignments JSONB` — see debug note #12; also where attendance confirmation, debug note #11, lives)*
```sql
CREATE TABLE deployment_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES agency_deployments(id) ON DELETE CASCADE,
  agency_staff_id UUID NOT NULL REFERENCES agency_staff(id),
  scheduled_hours NUMERIC(5,2) NOT NULL,

  attended BOOLEAN, -- NULL = not yet confirmed, TRUE = showed up, FALSE = no-show
  actual_hours NUMERIC(5,2),
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,

  UNIQUE (deployment_id, agency_staff_id)
);
```
**Enforced rule (server-side, not just a UI hint):** inserting a row here is rejected if that `agency_staff_id`'s `compliance_status` is `expired` at the time of assignment (guard certification auto-block, debug note #11).

**Table: deployment_notes** *(new — deployment notes/comments, debug note #11)*
```sql
CREATE TABLE deployment_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES agency_deployments(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Messaging — extends `staff_messages`, does not fork it** *(debug note #5)*
```sql
ALTER TABLE staff_messages ALTER COLUMN employee_id DROP NOT NULL;
ALTER TABLE staff_messages ADD COLUMN IF NOT EXISTS agency_id UUID REFERENCES agencies(id) ON DELETE CASCADE;
ALTER TABLE staff_messages ADD CONSTRAINT staff_messages_one_party CHECK (
  (employee_id IS NOT NULL AND agency_id IS NULL) OR
  (employee_id IS NULL AND agency_id IS NOT NULL)
);
```
`message_attachments`, the unread-count logic, and the management-only delete route are all reused as-is — only the ownership check gains an `agency_id` branch alongside the existing `employee_id` one (mirrors `canAccessOwnerEmpId`, needs a sibling `canAccessOwnerAgencyId` following the identical shape).

### 1.3 API Endpoints

**Admin: Agency Management**
```
POST   /api/agencies
       Body: { name, email, phone }
       Creates the agencies row AND a users row (role='agency', agency_id=<new id>)
       Response: { id, login_username, temp_password }  -- shown once, agency must change it

GET    /api/agencies
       Response: [{ id, name, status, staff_count, compliance_summary }]

GET    /api/agencies/:id
       Response: { agency, staff: [...], deployments: [...], performance }

PATCH  /api/agencies/:id
       Body: { name, email, phone }

POST   /api/agencies/:id/archive     -- soft delete, debug note #7
POST   /api/agencies/:id/reactivate
```

**Admin: Event Instructions** — see Feature 2, these are shared with GuardTec's own staff, not agency-only.

**Agency: Staff Registration** (all routes gated by `requireOwnAgencyOrPermission('staff')`, `:agencyId` compared against `req.user.agency_id`)
```
POST   /api/agencies/:agencyId/staff
       Body: { name, email, phone, nationality, job_role, custom_role, badge_type, dbs_expiry }

GET    /api/agencies/:agencyId/staff
       Response: [{ id, name, role, compliance_status }]

PATCH  /api/agencies/:agencyId/staff/:id

POST   /api/agencies/:agencyId/staff/:id/archive   -- soft delete, debug note #7
```

**Agency: Bulk Import**
```
POST   /api/agencies/:agencyId/staff/import-csv
       Body: FormData with CSV file
       Every text field is run through a formula-injection guard before storage
       (debug note #10) — a leading =, +, -, or @ gets a leading apostrophe
       prepended, same defensive step Excel-facing importers need generally.
       Response: { imported_count, errors: [] }
```

**Agency: Certificate + Photo Uploads**
```
POST   /api/agencies/:agencyId/staff/:id/documents/:docType
GET    /api/agencies/:agencyId/staff/:id/documents/:docType
       docType: sia_cert | cscs_cert | rtw_cert | dog_handler_cert | training_cert
       Both routes path.basename() every path segment before touching the
       filesystem — the exact class of bug already found and fixed once in
       this codebase's site-documents route.

POST   /api/agencies/:agencyId/staff/:id/photo
GET    /api/agencies/:agencyId/staff/:id/photo
       Flat ID-keyed directory (agency-staff-photos/), same pattern as
       USER_PHOTOS_DIR — see 1.5.
```

**Agency: Unavailability**
```
POST   /api/agencies/:agencyId/staff/:id/unavailability
       Body: { date_from, date_to, reason }
GET    /api/agencies/:agencyId/staff/:id/unavailability
DELETE /api/agencies/:agencyId/unavailability/:id
```

**Agency: Deployments**
```
POST   /api/agencies/:agencyId/deployments
       Body: { site_id, event_date, staff: [{ agency_staff_id, scheduled_hours }] }
       Rejects (409) if any staff_id has compliance_status = 'expired', or
       has an unavailability row covering event_date.
       Response: { deployment_id }

GET    /api/agencies/:agencyId/deployments
PATCH  /api/agencies/:agencyId/deployments/:id
       Body: { staff: [...], status }

PATCH  /api/agencies/:agencyId/deployments/:id/acknowledge
       Body: { confirmed: true }
       Sets agency_acknowledged / agency_acknowledged_by / agency_acknowledged_at.
       Deployment cannot be finalized without this.

POST   /api/agencies/:agencyId/deployments/:id/attendance
       Body: { agency_staff_id, attended, actual_hours, note }
       Upserts into deployment_attendance.

POST   /api/agencies/:agencyId/deployments/:id/notes
       Body: { note }
GET    /api/agencies/:agencyId/deployments/:id/notes
```

**Admin: Dashboard + Performance**
```
GET    /api/admin/agencies/overview
       Response: { total_agencies, total_staff, compliance_breakdown }

GET    /api/admin/agencies/:id/performance
       Response: { compliance_pct, no_show_rate, incident_count, deployments_count }
       Computed from deployment_attendance + deployment_notes — no new raw
       table needed, this is a query, not stored state (debug note #11).

GET    /api/admin/deployments
       Query: ?site_id=&date_from=&date_to=&agency_id=
```

**Messaging** (extends the existing staff messaging endpoints with an agency branch)
```
POST   /api/agencies/:agencyId/messages
GET    /api/agencies/:agencyId/messages
DELETE /api/messages/:id   -- unchanged, already management-only
```

### 1.4 Frontend Components

**Admin Side**
```
/admin/agencies
  ├─ AgenciesListPage.tsx
  ├─ AgencyDetailPage.tsx (staff, deployments, performance, messages)
  ├─ CreateAgencyModal.tsx
  └─ AgenciesDashboard.tsx

/admin/deployments
  └─ DeploymentsPage.tsx (cross-agency view, filter by site/date)
```

**Agency Admin Side**
```
/agency/dashboard        AgencyDashboard.tsx
/agency/staff            AgencyStaffPage.tsx, AgencyStaffForm.tsx (incl. photo,
                          same upload/preview UX as the staff onboarding wizard),
                          DocumentUploadRow.tsx, ComplianceBadge.tsx,
                          UnavailabilityCalendar.tsx
/agency/deployments       DeploymentCalendarPage.tsx, DeploymentForm.tsx,
                          AttendanceConfirmation.tsx, DeploymentNotes.tsx,
                          DeploymentAcknowledgment.tsx
/agency/messages          AgencyMessagesPage.tsx (same component family as
                          staff messaging, agency_id branch instead of employee_id)
```

### 1.5 Key Implementation Details

**Compliance Status Calculation (role-conditional — debug note #6)**
```typescript
function calculateComplianceStatus(staff): ComplianceStatus {
  const required = {
    dbs: true,
    sia: staff.badge_type === 'SIA',
    cscs: staff.badge_type === 'CSCS',
    rtw: true,
    dog_handler: staff.job_role === 'Dog Handler',
    training: true,
  }
  const checks = {
    dbs: !staff.dbs_expiry ? 'missing' : staff.dbs_expiry < today ? 'expired' : staff.dbs_expiry < today + 30days ? 'warning' : 'ok',
    sia: !required.sia ? 'n/a' : staff.sia_cert_uploaded ? 'ok' : 'missing',
    cscs: !required.cscs ? 'n/a' : staff.cscs_cert_uploaded ? 'ok' : 'missing',
    dog_handler: !required.dog_handler ? 'n/a' : staff.dog_handler_cert_uploaded ? 'ok' : 'missing',
    // rtw, training follow the same shape
  }
  const active = Object.values(checks).filter(c => c !== 'n/a')
  if (active.includes('expired')) return 'EXPIRED'
  if (active.includes('missing')) return 'INCOMPLETE'
  if (active.includes('warning')) return 'ACTION_NEEDED'
  return 'COMPLIANT'
}
```

**Profile Photo Storage**

Regular staff photos live inside each employee's own folder (`findProfilePhoto(emp._folderPath)`) — that only works because regular staff are one-folder-per-person on disk. `agency_staff` is a Postgres table with no folder, so it needs the *other* existing pattern instead: the flat, ID-keyed directory already used for user account photos (`USER_PHOTOS_DIR`, `findUserPhoto(id)`).

```
agency-staff-photos/
  <agency_staff.id>.jpg
```

Upload deletes any existing file for that ID first (one photo per guard, same "replace on reupload" rule as every other document in this app), and every route does `path.basename()` on `:id` before touching disk.

**CSV Import — Formula Injection Guard (debug note #10)**
```typescript
function sanitizeForExcel(value) {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value
  return value
}
// Applied to every field on import, not just ones that "look like" formulas —
// the check is on the leading character, which is what Excel actually keys off.
```

**Guard Matching Suggestion**
```sql
SELECT * FROM agency_staff
WHERE agency_id = $1
  AND status = 'active'
  AND compliance_status != 'expired'
  AND id NOT IN (
    SELECT agency_staff_id FROM agency_staff_unavailability
    WHERE date_from <= $2 AND date_to >= $2  -- $2 = event_date
  )
```

---

## FEATURE 2: EVENT INSTRUCTIONS & ACKNOWLEDGMENT FORMS

Covers BOTH agency cover guards and GuardTec's own staff (explicitly requested) — one mechanism, two respondent types.

### 2.1 How It Attaches

- Instructions can stand alone, or link to an existing site (Option B, confirmed) — `site_id TEXT`, same JSON-backed id as everywhere else in this plan, `NULL` when standalone.
- A deployment's guards, or a set of GuardTec staff, each get their own individually-tracked secure link — one link per person, not one shared link, so signature proof is per-individual.

### 2.2 Database Schema

```sql
CREATE TABLE event_instructions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id TEXT, -- nullable: standalone instructions aren't required to link to a site
  event_date DATE,
  title VARCHAR(255) NOT NULL,
  instructions_html TEXT,
  requirements JSONB, -- [{ title, description, mandatory }]
  document_file_url VARCHAR(500),
  document_mime_type VARCHAR(100),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  version INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' -- draft | published | archived
);
```

**Single, consolidated acknowledgment table** (debug notes #3 and #4 — this replaces BOTH `agency_acknowledgment_forms` and `acknowledgment_form_responses` from v1):

```sql
CREATE TABLE acknowledgment_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  instruction_id UUID NOT NULL REFERENCES event_instructions(id),
  instruction_version INT NOT NULL, -- snapshot at send-time; see re-ack rule below
  deployment_id UUID REFERENCES agency_deployments(id), -- NULL for GuardTec-staff-only sends

  respondent_type VARCHAR(20) NOT NULL CHECK (respondent_type IN ('agency_staff', 'employee')),
  respondent_id TEXT NOT NULL, -- agency_staff.id, or employees.legacy_id — no FK, resolved
                                -- at the app layer (same reasoning as site_id, debug note #1)
  respondent_name_snapshot VARCHAR(255), -- captured at send time

  form_token VARCHAR(64) UNIQUE NOT NULL,
  link_expires_at TIMESTAMPTZ NOT NULL, -- the ONLY source of truth for expiry (debug note #9)

  form_opened_at TIMESTAMPTZ,
  form_read_at TIMESTAMPTZ,
  read_duration_seconds INT,
  current_step INT NOT NULL DEFAULT 0, -- enforces sequential reading

  signed_at TIMESTAMPTZ,
  signer_name VARCHAR(255),
  signature_data TEXT, -- optional base64 signature image

  ip_address VARCHAR(50),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ack_forms_token ON acknowledgment_forms(form_token);
CREATE INDEX idx_ack_forms_instruction ON acknowledgment_forms(instruction_id, respondent_type, respondent_id);
```

**Re-acknowledgment on version bump:** no trigger or invalidation logic needed — `instruction_version` is a snapshot on each row. "Has this person acknowledged the *current* version" is just `EXISTS (... WHERE instruction_id = ? AND respondent_id = ? AND instruction_version = <current version> AND signed_at IS NOT NULL)`. Bumping `event_instructions.version` naturally means nobody has a row at the new version yet, and old rows remain as an accurate historical record of what was signed for the old version — nothing needs to be deleted or overwritten.

### 2.3 Frontend Components

```
AcknowledgmentFormPage.tsx           -- public, unauthenticated, reached only via token
  ├─ SecureFormRenderer.tsx          -- sequential steps, can't skip ahead
  │   ├─ InstructionStep.tsx
  │   ├─ ProgressBar.tsx
  │   └─ TimeTracker.tsx
  └─ SignatureSection.tsx
      ├─ DigitalSignaturePad.tsx (or plain name input)
      └─ ConfirmationCheckbox.tsx

EventInstructionsPanel.tsx           -- admin: create/publish instructions, generate
                                          links for a deployment OR a list of employees
```

### 2.4 Acknowledgment Form Logic

```typescript
function generateFormLink(instructionId, respondentType, respondentId, deploymentId) {
  const token = crypto.randomBytes(32).toString('hex') // 256 bits — brute force is not realistic
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000)
  db.insert('acknowledgment_forms', {
    instruction_id: instructionId,
    instruction_version: currentVersionOf(instructionId),
    deployment_id: deploymentId ?? null,
    respondent_type: respondentType,
    respondent_id: respondentId,
    form_token: token,
    link_expires_at: expiresAt,
  })
  // The ?expires= query param below is DISPLAY ONLY (a countdown for the
  // user) — validation always re-reads link_expires_at from the DB, never
  // trusts anything from the URL (debug note #9).
  return `${BASE_URL}/acknowledge/${token}?expires=${expiresAt.getTime()}`
}

function validateFormAccess(token) {
  const form = db.query('SELECT * FROM acknowledgment_forms WHERE form_token = $1', [token])
  if (!form) return { error: 'Invalid link', status: 404 }
  if (form.link_expires_at < now()) return { error: 'This link has expired', status: 403 }
  if (form.signed_at) return { error: 'This form has already been signed', status: 403 }
  return { form }
}

// Atomic — no separate read-then-write, closes the race in debug note #8.
function signForm(token, signerName, signatureData) {
  const result = db.query(`
    UPDATE acknowledgment_forms
    SET signed_at = NOW(), signer_name = $1, signature_data = $2
    WHERE form_token = $3 AND link_expires_at > NOW() AND signed_at IS NULL
    RETURNING id
  `, [signerName, signatureData, token])
  if (result.rowCount === 0) return { error: 'Link expired or already used', status: 403 }
  return { success: true }
}
```

### 2.5 Key Properties

- **Secure links:** 256-bit token, 5-minute expiry enforced server-side only, one-time use enforced via an atomic conditional update.
- **Sequential reading:** `current_step` only moves forward; the signature step is unreachable until the last instruction step has been marked read.
- **Audit trail:** open time, read duration, sign time, IP, user agent — all captured.
- **Works for both respondent types** — an agency cover guard or a GuardTec employee, same table, same link mechanism, same 5-minute rule.
- **Re-acknowledgment:** automatic consequence of version-snapshotting, not a separate feature to build.

---

## FEATURE 3: CUSTOM FORMS BUILDER

### 3.1 Architecture

```
Admin: Forms Builder
  ├─ CreateCustomForm.tsx
  ├─ FormFieldEditor.tsx
  └─ FormLinkGenerator.tsx

Respondent
  └─ CustomFormPage.tsx

Admin: Responses
  └─ FormResponsesPage.tsx
```

### 3.2 Database Schema

```sql
CREATE TABLE custom_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  form_type VARCHAR(20) NOT NULL, -- staff_info | agency_info | site_info | event_info | general
  fields JSONB NOT NULL,
  linked_to_entity_type VARCHAR(50), -- 'staff' | 'agency' | 'site' | 'event' | NULL
  linked_to_entity_id TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  auto_map_to_profile BOOLEAN NOT NULL DEFAULT FALSE,
  version INT NOT NULL DEFAULT 1
);

CREATE TABLE custom_form_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES custom_forms(id),
  respondent_type VARCHAR(20), -- 'staff' | 'agency_staff' | 'agency' | NULL (anonymous)
  respondent_id TEXT,          -- no FK — same reasoning throughout this plan
  response_data JSONB NOT NULL,
  submitted_at TIMESTAMPTZ,
  ip_address VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'submitted' -- draft | submitted | approved | rejected
);
```

### 3.3 Form Field Types

```typescript
interface FormField {
  id: string
  type: 'text' | 'textarea' | 'email' | 'phone' | 'date' | 'number' |
        'dropdown' | 'radio' | 'checkbox' | 'file' | 'signature' | 'table'
  label: string
  required: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
  validation?: string
  helpText?: string
}
```

### 3.4 API Endpoints

```
POST   /api/custom-forms
GET    /api/custom-forms                Query: ?form_type=&linked_to=
PATCH  /api/custom-forms/:id
GET    /api/custom-forms/:id/responses
POST   /api/custom-forms/:id/submit
GET    /api/custom-forms/:id/export     -- CSV; every field runs through the same
                                            sanitizeForExcel() as CSV import (debug note #10),
                                            since this direction can carry a formula just as easily
```

### 3.5 auto_map_to_profile — Governance Fix

v1 let a published form write straight into a staff profile field on submission. That silently bypasses the exact mechanism this app already relies on for staff-submitted data: `MY_PROFILE_FIELDS` in `server.js`, which gates what a staff member can submit and requires manager approval before anything reaches the live record (see memory `guardtec_bs7858_onboarding_wizard`). A custom form is just another way for a staff member to submit data — it doesn't get to skip the approval step the onboarding wizard is built around.

**Fixed:** `auto_map_to_profile` responses are written into `pending_submission`, exactly like any other self-service profile edit, and only apply after the existing manager-approve-merge step. The form builder can only offer field names that already exist in `MY_PROFILE_FIELDS` as mapping targets — not arbitrary free-text field names — so it's impossible to build a custom form that silently creates a new ungoverned field.

### 3.6 Integration Points

```
"Agency Onboarding Checklist"  → agencies, admin-filled, no auto-map (agencies aren't
                                  staff, there's no pending_submission concept for them —
                                  responses just attach to the agency record directly)
"Guard Emergency Contact Update" → agency_staff, agency-filled, direct write (agency_staff
                                  has no approval workflow — only regular staff self-service
                                  goes through pending_submission)
"Site Induction Checklist"     → attached to event_instructions, filled as part of the
                                  acknowledgment flow (Feature 2), not auto-mapped anywhere
```

---

## IMPLEMENTATION PHASES

### Phase A: Core Infrastructure
- [ ] `agencies`, `agency_staff`, `agency_staff_unavailability` tables
- [ ] `users.agency_id` column + `requireOwnAgencyOrPermission` middleware
- [ ] Agency CRUD (admin) + staff CRUD (agency) endpoints
- [ ] Admin: agencies list + create modal. Agency: login (existing screen, no new UI needed)

### Phase B: Compliance Tracking
- [ ] Document + photo upload endpoints (role-conditional compliance calc)
- [ ] Agency staff registration form + certificate upload UI
- [ ] Bulk CSV import (with formula-injection sanitization)

### Phase C: Deployments, Attendance, Acknowledgments
- [ ] `agency_deployments`, `deployment_attendance`, `deployment_notes` tables
- [ ] Deployment calendar + cert-expired auto-block on assignment
- [ ] `event_instructions` + consolidated `acknowledgment_forms` tables
- [ ] Secure link generation/validation (atomic sign, DB-only expiry check)
- [ ] Attendance confirmation UI + deployment notes UI

### Phase D: Messaging & Admin Dashboard
- [ ] `staff_messages` migration (nullable `employee_id`, new `agency_id`, check constraint)
- [ ] `canAccessOwnerAgencyId` alongside existing `canAccessOwnerEmpId`
- [ ] Agency messages page (reuses existing message components)
- [ ] Admin dashboard: compliance overview, cross-agency deployments, performance view
- [ ] Expiry alert notifications

### Phase E: Custom Forms
- [ ] `custom_forms` / `custom_form_responses` tables
- [ ] Form builder UI + field types
- [ ] Submission page; `auto_map_to_profile` routes through `pending_submission`, not a direct write
- [ ] CSV export (same sanitization as import)

### Phase F: Integration & Polish
- [ ] Confirm agency isolation on every `:agencyId` route (no cross-agency leakage)
- [ ] Confirm `'agency'` role is hidden from the normal role-assignment UI
- [ ] Docker rebuild + PWA cache clear
- [ ] Live smoke test

---

## Key Security Considerations

1. **Agency isolation:** every agency-scoped route compares `:agencyId` against `req.user.agency_id`, not just a `WHERE agency_id = ...` on the query — the same pattern already used for staff self-service ownership checks.
2. **Public acknowledgment-form routes are unauthenticated by design** — the token itself (256-bit, 5-minute, one-time) *is* the security boundary, not a login session. These routes deliberately sit outside the CSRF double-submit pattern that protects the logged-in session routes elsewhere in this feature (agency admin actions, admin actions) — don't conflate the two; the logged-in routes still need the existing CSRF cookie check.
3. **No hard deletes** — agencies, agency_staff, both soft-delete only, so deployment/acknowledgment history stays intact for BS7858/audit purposes.
4. **Formula-injection sanitization** on both CSV import and CSV export, given this app's Excel-centric workflow.
5. **Every file route does `path.basename()`** on every path segment before touching disk — certs, photos, instruction documents alike.
6. **Sign-form updates are atomic conditional updates**, never check-then-write.

---

## Testing Checklist

- [ ] Agency A cannot read/write Agency B's staff, deployments, or messages via direct API calls with a guessed ID
- [ ] Assigning a guard with `compliance_status = 'expired'` to a deployment is rejected
- [ ] Assigning a guard with an overlapping unavailability window is excluded from matching suggestions
- [ ] CSV import of a name like `=cmd|'/c calc'!A1` is stored with a leading apostrophe, not as a live formula
- [ ] Acknowledgment link works within 5 minutes, 403s after
- [ ] Two rapid duplicate sign requests on the same token: exactly one succeeds
- [ ] A GuardTec employee (not an agency guard) can receive and sign an acknowledgment form
- [ ] Bumping an instruction's version does not retroactively invalidate old signed rows, and requires a fresh signature at the new version
- [ ] Archiving an agency does not delete its deployment/acknowledgment history
- [ ] Agency messages appear correctly attributed and don't collide with regular staff messages in the same `staff_messages` table

---

## Deployment Checklist

- [ ] Run all new migrations, including the `staff_messages` column relaxation — this touches a live table, take a backup first
- [ ] Backend + frontend type check
- [ ] Docker rebuild, PWA cache clear (verify bundle hash)
- [ ] Smoke test: agency login → register guard → deploy → guard signs form → agency confirms attendance
- [ ] Smoke test: same acknowledgment flow for a GuardTec employee, not just an agency guard
