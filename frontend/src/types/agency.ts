// Types for Feature 1 (Agency Cover Guards Management), Feature 2 (Event
// Instructions & Acknowledgment Forms), and Feature 3 (Custom Forms Builder).
// Source of truth: GUARDTEC_IMPLEMENTATION_PLAN.md — field names are the
// snake_case SQL columns from that plan's schema sections, camelCased, so
// backend JSON responses (Postgres rows passed through as-is, or lightly
// mapped) line up with these interfaces without any renaming step.
//
// Optionality follows the plan's SQL literally: a column is required (no `?`)
// only where the CREATE TABLE text says NOT NULL; every nullable column,
// including timestamp columns that only carry `DEFAULT NOW()` with no NOT
// NULL, is optional here. Style (interface naming, optional-field convention)
// matches ./staff.ts.
//
// This file is imported-only by other frontend work on these features — it
// is not edited by them, so it must already be complete for all three
// features.

// ─────────────────────────────────────────────────────────────────────────
// Shared enums / status unions
// ─────────────────────────────────────────────────────────────────────────

export type ArchivableStatus = "active" | "archived"

// Returned by calculateComplianceStatus() (plan §1.5) — not a stored column,
// but every agency-staff API response includes it, so downstream components
// need the type.
export type ComplianceStatus = "COMPLIANT" | "ACTION_NEEDED" | "INCOMPLETE" | "EXPIRED"

export type DeploymentStatus = "scheduled" | "completed" | "cancelled"

export type AcknowledgmentRespondentType = "agency_staff" | "employee"

export type EventInstructionStatus = "draft" | "published" | "archived"

export type CustomFormType = "staff_info" | "agency_info" | "site_info" | "event_info" | "general"

export type CustomFormLinkedEntityType = "staff" | "agency" | "site" | "event"

export type CustomFormFieldType =
  | "text"
  | "textarea"
  | "email"
  | "phone"
  | "date"
  | "number"
  | "dropdown"
  | "radio"
  | "checkbox"
  | "file"
  | "signature"
  | "table"

// custom_form_responses.respondent_type — nullable, NULL means an anonymous
// submission (plan §3.2).
export type CustomFormResponseRespondentType = "staff" | "agency_staff" | "agency"

export type CustomFormResponseStatus = "draft" | "submitted" | "approved" | "rejected"

// ─────────────────────────────────────────────────────────────────────────
// FEATURE 1: Agency Cover Guards Management
// ─────────────────────────────────────────────────────────────────────────

// Table: agencies (plan §1.2)
export interface Agency {
  id: string
  name: string
  email: string
  phone?: string
  createdBy: string
  createdAt?: string
  status: ArchivableStatus
  archivedAt?: string
  notes?: string
}

// Table: agency_staff — the cover guards themselves (plan §1.2).
// Profile photo is deliberately NOT a field here — it's file-based, stored
// flat as `agency-staff-photos/<agency_staff.id>.jpg` (plan §1.5), fetched
// via GET /api/agencies/:agencyId/staff/:id/photo, not a JSON column.
export interface AgencyStaffMember {
  id: string
  agencyId: string
  name: string
  email?: string
  phone?: string
  nationality?: string
  jobRole: string // "Security Officer" | "Door Supervisor" | "Dog Handler" | "Other" — free text, see customRole
  customRole?: string // filled when jobRole === 'Other'
  badgeType?: string // "SIA" | "CSCS" | "Other"

  // BS7858 compliance — each cert's *requirement* is conditional on jobRole /
  // badgeType (see calculateComplianceStatus, plan §1.5). These columns only
  // record whether something was uploaded, not whether it was required.
  dbsExpiry?: string
  siaCertUploaded: boolean
  siaCertUploadDate?: string
  cscsCertUploaded: boolean
  cscsCertUploadDate?: string
  rtwCertUploaded: boolean
  rtwCertUploadDate?: string
  dogHandlerCertUploaded: boolean // only meaningful if jobRole === 'Dog Handler'
  dogHandlerCertUploadDate?: string
  trainingCertUploaded: boolean
  trainingCertUploadDate?: string

  status: ArchivableStatus // never hard-deleted
  archivedAt?: string
  createdAt?: string
  updatedAt?: string

  // Computed by calculateComplianceStatus() server-side, not a DB column —
  // present on GET /api/agencies/:agencyId/staff and similar list responses.
  complianceStatus?: ComplianceStatus
}

// Table: agency_staff_unavailability (plan §1.2)
export interface AgencyStaffUnavailability {
  id: string
  agencyStaffId: string
  dateFrom: string
  dateTo: string
  reason?: string
  createdAt?: string
}

// Table: agency_deployments (plan §1.2)
export interface AgencyDeployment {
  id: string
  agencyId: string
  siteId: string // deployment-sites.json id — no FK, see plan debug note #1
  eventDate: string

  agencyAcknowledged: boolean // "I understand + I've briefed my staff"
  agencyAcknowledgedBy?: string // users.id of the agency admin who ticked it
  agencyAcknowledgedAt?: string

  status: DeploymentStatus
  createdAt?: string
  updatedAt?: string
}

// Table: deployment_attendance — one row per guard per deployment
// (replaces v1's staff_assignments JSONB; plan debug note #12).
export interface DeploymentAttendance {
  id: string
  deploymentId: string
  agencyStaffId: string
  scheduledHours: number

  attended?: boolean | null // undefined/null = not yet confirmed, true = showed up, false = no-show
  actualHours?: number
  confirmedBy?: string
  confirmedAt?: string
}

// Table: deployment_notes (plan §1.2)
export interface DeploymentNote {
  id: string
  deploymentId: string
  authorId: string
  note: string
  createdAt?: string
}

// ─────────────────────────────────────────────────────────────────────────
// FEATURE 2: Event Instructions & Acknowledgment Forms
// ─────────────────────────────────────────────────────────────────────────

// One entry of event_instructions.requirements (JSONB array, plan §2.2).
export interface EventInstructionRequirement {
  title: string
  description?: string
  mandatory: boolean
}

// Table: event_instructions (plan §2.2)
export interface EventInstruction {
  id: string
  siteId?: string // nullable: standalone instructions aren't required to link to a site
  eventDate?: string
  title: string
  instructionsHtml?: string
  requirements?: EventInstructionRequirement[]
  documentFileUrl?: string
  documentMimeType?: string
  createdBy: string
  createdAt?: string
  version: number
  status: EventInstructionStatus
}

// Table: acknowledgment_forms — the single, consolidated table that replaces
// v1's two competing drafts (plan debug notes #3 and #4). Polymorphic
// respondent: covers both an agency cover guard and a GuardTec employee.
export interface AcknowledgmentForm {
  id: string

  instructionId: string
  instructionVersion: number // snapshot at send-time; enables re-ack on version bump
  deploymentId?: string // undefined/null for GuardTec-staff-only sends

  respondentType: AcknowledgmentRespondentType
  respondentId: string // agency_staff.id, or employees.legacy_id — no FK, resolved at app layer
  respondentNameSnapshot?: string // captured at send time

  formToken: string
  linkExpiresAt: string // the ONLY source of truth for expiry — never trust the URL query string

  formOpenedAt?: string
  formReadAt?: string
  readDurationSeconds?: number
  currentStep: number // enforces sequential reading, only moves forward

  signedAt?: string
  signerName?: string
  signatureData?: string // optional base64 signature image

  ipAddress?: string
  userAgent?: string
  createdAt?: string
}

// ─────────────────────────────────────────────────────────────────────────
// FEATURE 3: Custom Forms Builder
// ─────────────────────────────────────────────────────────────────────────

// One field definition inside custom_forms.fields (JSONB, plan §3.3).
// Note: this JSON shape's own keys are already camelCase in the plan — it is
// not derived from separate SQL columns like the table-backed interfaces
// above.
export interface CustomFormField {
  id: string
  type: CustomFormFieldType
  label: string
  required: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
  validation?: string
  helpText?: string
}

// Table: custom_forms (plan §3.2)
export interface CustomForm {
  id: string
  name: string
  description?: string
  formType: CustomFormType
  fields: CustomFormField[]
  linkedToEntityType?: CustomFormLinkedEntityType
  linkedToEntityId?: string
  createdBy: string
  createdAt?: string
  updatedAt?: string
  isPublished: boolean
  // Governance fix (plan §3.5): when true, submissions route into
  // pending_submission and only apply after manager approve-merge — same
  // gate as any other staff self-service profile edit. The form builder may
  // only offer field names already in MY_PROFILE_FIELDS as mapping targets.
  autoMapToProfile: boolean
  version: number
}

// Table: custom_form_responses (plan §3.2)
export interface CustomFormResponse {
  id: string
  formId: string
  respondentType?: CustomFormResponseRespondentType // undefined/null = anonymous
  respondentId?: string // no FK — same reasoning throughout this plan
  responseData: Record<string, unknown>
  submittedAt?: string
  ipAddress?: string
  status: CustomFormResponseStatus
}
