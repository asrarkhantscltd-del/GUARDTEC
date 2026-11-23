// Data-folder locations under DATA_PATH, created on startup if missing.
//
// Loaded from server.js: mount(require('./lib/paths')(deps))

var fs = require('fs');
var path = require('path');

module.exports = function pathsLib(deps) {


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

  // ── STAFF DOCUMENTS (Postgres-backed) ────────────────────────────────────────
  // Replaces the old per-person-folder document/photo/training-cert storage
  // (doc_<key>.ext, doc_training_<key>.ext, profile.ext, pending-profile.ext).
  // One flat directory per employee UUID; staff_documents is the single source
  // of truth for both "does this file exist" and its metadata — the two were
  // separate, unguarded fs writes before (see ensureEmployeesExtendedSchema
  // comment), which could already silently desync.
  var STAFF_DOCS_DIR = path.join(BASE, 'staff-documents');
  if (!fs.existsSync(STAFF_DOCS_DIR)) fs.mkdirSync(STAFF_DOCS_DIR, { recursive: true });

  // ── USER (ACCOUNT) PROFILE PHOTOS ────────────────────────────────────────────
  // One photo per logged-in account (stored by postgres user id, not staff id).
  // Works for every role — director, manager, staff — anyone with a login.
  var USER_PHOTOS_DIR = path.join(BASE, 'user-photos');
  if (!fs.existsSync(USER_PHOTOS_DIR)) fs.mkdirSync(USER_PHOTOS_DIR, { recursive: true });

  // ── NEW STAFF INBOX (Power Automate → OneDrive bridge) ────────────────────────
  var INBOX_DIR      = path.join(BASE, '! New Staff Inbox');
  var INBOX_DONE_DIR = path.join(BASE, '! New Staff Inbox', 'Processed');

  // ── VEHICLES ──────────────────────────────────────────────────────────────────
  // Postgres-backed (see ensureVehiclesExtendedSchema above). VEHICLES_FILE is
  // no longer read by any route below — kept only as the source path for the
  // one-time migrate-vehicles.js script.
  var VEHICLES_FILE = path.join(BASE, 'vehicles.json');
  var VEHICLE_PHOTOS_DIR = path.join(BASE, 'vehicle-photos');
  if (!fs.existsSync(VEHICLE_PHOTOS_DIR)) fs.mkdirSync(VEHICLE_PHOTOS_DIR, { recursive: true });

  var VEHICLE_DOCS_DIR = path.join(BASE, 'vehicle-docs');
  if (!fs.existsSync(VEHICLE_DOCS_DIR)) fs.mkdirSync(VEHICLE_DOCS_DIR, { recursive: true });
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

  // Book-on selfies + SIA badge photos for external event staff. Personal data
  // kept as attendance/payment proof, filed per book-on (staff id + date).
  var EVENT_BOOK_ON_PHOTOS_DIR = path.join(BASE, 'event-book-on-photos');
  if (!fs.existsSync(EVENT_BOOK_ON_PHOTOS_DIR)) fs.mkdirSync(EVENT_BOOK_ON_PHOTOS_DIR, { recursive: true });

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

  return {
    ACTIVE_DIR: ACTIVE_DIR,
    AGENCY_STAFF_CUSTOM_DOCS_DIR: AGENCY_STAFF_CUSTOM_DOCS_DIR,
    AGENCY_STAFF_DOCS_DIR: AGENCY_STAFF_DOCS_DIR,
    AGENCY_STAFF_PHOTOS_DIR: AGENCY_STAFF_PHOTOS_DIR,
    ALLOWED_ATTACH_MIME: ALLOWED_ATTACH_MIME,
    BASE: BASE,
    CONTRACT_DIR: CONTRACT_DIR,
    EVENT_INSTRUCTIONS_DOCS_DIR: EVENT_INSTRUCTIONS_DOCS_DIR,
    EVENT_BOOK_ON_PHOTOS_DIR: EVENT_BOOK_ON_PHOTOS_DIR,
    INBOX_DIR: INBOX_DIR,
    INBOX_DONE_DIR: INBOX_DONE_DIR,
    INCIDENT_ATTACH_DIR: INCIDENT_ATTACH_DIR,
    MAX_ATTACH_SIZE: MAX_ATTACH_SIZE,
    MESSAGE_ATTACH_DIR: MESSAGE_ATTACH_DIR,
    OVERVIEW: OVERVIEW,
    RECYCLE_DIR: RECYCLE_DIR,
    RECYCLE_RETENTION_DAYS: RECYCLE_RETENTION_DAYS,
    SHAREPOINT_DASHBOARD: SHAREPOINT_DASHBOARD,
    SITE_DOCS_DIR: SITE_DOCS_DIR,
    SPREADSHEET: SPREADSHEET,
    STAFF_DOCS_DIR: STAFF_DOCS_DIR,
    USER_PHOTOS_DIR: USER_PHOTOS_DIR,
    VEHICLE_DOCS_DIR: VEHICLE_DOCS_DIR,
    VEHICLE_PHOTOS_DIR: VEHICLE_PHOTOS_DIR,
    getTodayStr: getTodayStr,
  };
};
