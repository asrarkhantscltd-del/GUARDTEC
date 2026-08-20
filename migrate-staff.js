// Phase-3 one-time migration (JSON→Postgres unification project — the big
// one; see ensureSitesSchema/ensureVehiclesExtendedSchema for phases 1-2):
// copies every staff_data.json (Active Staff, Ex-Staff, and any leftover
// "Duplicate Archive" records) into Postgres `employees` (core columns +
// profile_data JSONB — see ensureEmployeesExtendedSchema in server.js) plus
// their documents/photos/training-certs into `staff_documents` +
// STAFF_DOCS_DIR. Read-only against the JSON/filesystem — nothing here
// writes back to OneDrive, and files are COPIED, never moved.
//
// Unlike migrate.js/migrate-sites.js/migrate-vehicles.js's insert-only
// `ON CONFLICT DO NOTHING`, this one UPDATEs an existing row if the server
// has already created it (e.g. from live traffic between a dry run and the
// real cutover) — safe to re-run right before going live to pick up
// anything that changed. The three legacy shape variants that coexist in
// real records today (old flat, MS-Forms-inbox, full modern wizard) are all
// stored AS-IS in profile_data, no forced renaming — same tolerance the
// JSON-file era already had.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BASE = process.env.DATA_PATH || path.join(process.env.HOME || process.env.USERPROFILE, 'First Call Site Services', 'FCSS - Managers', 'HR and Legal', 'Asrar', 'GuardTec Compliance');
const ACTIVE_DIR = path.join(BASE, '02 - Vetting & Screening', 'Active Staff');
const EX_DIR = path.join(BASE, '02 - Vetting & Screening', 'Ex-Staff');
const DUPLICATE_DIR = path.join(BASE, '02 - Vetting & Screening', 'Duplicate Archive');
const STAFF_DOCS_DIR = path.join(BASE, 'staff-documents');

// Same junk-record list migrate.js already identified (dashboard/legend text
// accidentally saved as staff folders) — excluded here too so they don't
// pollute the new table.
const KNOWN_JUNK_LEGACY_IDS = new Set([
  'colour-key', 'credential', 'expired', 'expiring---90-days', 'no-data---pending',
  'red---expired---do-not-deploy-----orange---expiring---90-days---renew-now-----yellow---cscs-action-needed-----green---valid---current',
  'refreshed--26-june-2026-------48-staff-tracked', 'select-staff-member-', 'sia-licence', 'sia-licences',
  'staff-compliance-lookup-----select-a-name-to-instantly-check-all-credentials', 'total-staff-tracked', 'valid'
]);

// Same field split saveStaff() uses in server.js — kept in sync manually
// (this is a standalone one-time script, not a shared module).
const STAFF_STRIP_FIELDS = ['id','name','email','phone','phoneLandline','dateOfBirth','dob','placeOfBirth',
  'nationality','gender','drivingLicence','deployStatus','currentSite','contract','induction','addedDate',
  'status','jobRole','wizard_draft','pending_submission','rejection_reason','overall','_folderPath',
  '_nameSuffix','_pgId','documents','archived_at','archive_reason'];

const ALLOWED_DOC_KEYS = [
  'siaPhysical','passport','drivingLicenceDoc','brpCard','proofOfAddress1','proofOfAddress2',
  'p45','bankLetter','application','assignmentInstructions','cscsCard',
  'creditCheckReport','socialMediaCheckReport',
  'driverLicenceCopy','driverCpcCard','driverMedicalCert','driverTachoCard','driverDbsCheck','driverAssessmentReport'
];
const MANAGER_ONLY_DOC_KEYS = ['creditCheckReport', 'socialMediaCheckReport', 'driverTachoCard', 'driverDbsCheck', 'driverAssessmentReport'];
const ALLOWED_TRAINING_KEYS = ['siaCertificate','firstAid','manualHandling','fireAwareness','conflictManagement','bwcTraining','cscsTest'];

function s(v) { return (v === undefined || v === null || v === '') ? null : String(v); }

function findFileWithPrefix(dir, prefix) {
  var exts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
  for (const ext of exts) {
    var p = path.join(dir, prefix + ext);
    if (fs.existsSync(p)) return { path: p, ext: ext };
  }
  return null;
}

function loadFolderRecords(dir) {
  var records = [];
  if (!fs.existsSync(dir)) return records;
  fs.readdirSync(dir).forEach(function(d) {
    var fp = path.join(dir, d);
    try {
      if (!fs.statSync(fp).isDirectory()) return;
      var jp = path.join(fp, 'staff_data.json');
      if (!fs.existsSync(jp)) return;
      var emp = JSON.parse(fs.readFileSync(jp, 'utf8'));
      if (!emp.id || !emp.name) return;
      if (KNOWN_JUNK_LEGACY_IDS.has(emp.id)) return;
      emp._folderPath = fp;
      records.push(emp);
    } catch (e) {
      console.error('[SKIP] Could not read ' + fp + ': ' + e.message);
    }
  });
  return records;
}

// Copies one file-backed slot (photo/document/training cert) into
// STAFF_DOCS_DIR/<employeeId>/ and inserts/updates its staff_documents row.
async function migrateDocSlot(client, employeeId, folderPath, category, key, prefix, opts) {
  opts = opts || {};
  var found = findFileWithPrefix(folderPath, prefix);
  if (!found) return false;
  var destDir = path.join(STAFF_DOCS_DIR, employeeId);
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  var filename = category + '_' + key + found.ext;
  fs.copyFileSync(found.path, path.join(destDir, filename));
  await client.query(
    `INSERT INTO staff_documents (employee_id, doc_category, doc_key, doc_subtype, filename, original_name, visible_to_staff, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (employee_id, doc_category, doc_key) DO UPDATE SET
       doc_subtype=$4, filename=$5, original_name=$6, visible_to_staff=$7, uploaded_at=$8`,
    [employeeId, category, key, opts.subtype || null, filename, filename,
     opts.visibleToStaff !== undefined ? opts.visibleToStaff : true, opts.uploadedAt || null]
  );
  return true;
}

async function importOne(client, emp, statusOverride) {
  var legacyId = s(emp.id);

  var core = {
    name: s(emp.name) || '', email: s(emp.email), phone: s(emp.phone),
    phone_landline: s(emp.phoneLandline),
    date_of_birth: s(emp.dateOfBirth) || s(emp.dob),
    place_of_birth: s(emp.placeOfBirth), nationality: s(emp.nationality),
    gender: s(emp.gender), driving_licence: s(emp.drivingLicence),
    status: statusOverride, deploy_status: s(emp.deployStatus) || 'inactive',
    contract: s(emp.contract), induction: !!emp.induction,
    added_date: s(emp.addedDate), job_role: s(emp.jobRole), current_site_id: s(emp.currentSite),
    wizard_draft: emp.wizard_draft ? JSON.stringify(emp.wizard_draft) : null,
    pending_submission: emp.pending_submission ? JSON.stringify(emp.pending_submission) : null,
    rejection_reason: s(emp.rejection_reason),
  };

  var profileData = Object.assign({}, emp);
  STAFF_STRIP_FIELDS.forEach(function(k) { delete profileData[k]; });
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

  // archive_reason/archived_at: no real historical archive date exists for
  // pre-migration Ex-Staff (the old system only recorded THAT someone was
  // in the folder, never WHEN) — left NULL rather than fabricated as NOW(),
  // per the explicit design decision in ensureEmployeesExtendedSchema. The
  // 7-year retention guard on permanent-delete treats a NULL archived_at as
  // "never eligible" for exactly this reason.
  var archivedAt = null;
  var archiveReason = statusOverride === 'archived' ? 'left_employment' : (statusOverride === 'duplicate' ? 'duplicate_record' : null);

  var existing = await client.query('SELECT id FROM employees WHERE legacy_id = $1', [legacyId]);
  var employeeId;
  if (existing.rows.length) {
    employeeId = existing.rows[0].id;
    await client.query(
      `UPDATE employees SET name=$1, email=$2, phone=$3, phone_landline=$4, date_of_birth=$5,
        place_of_birth=$6, nationality=$7, gender=$8, driving_licence=$9, status=$10, deploy_status=$11,
        contract=$12, induction=$13, added_date=$14, job_role=$15, current_site_id=$16,
        wizard_draft=$17, pending_submission=$18, rejection_reason=$19, profile_data=$20,
        archived_at=$21, archive_reason=$22, updated_at=NOW()
       WHERE id=$23`,
      [core.name, core.email, core.phone, core.phone_landline, core.date_of_birth, core.place_of_birth,
       core.nationality, core.gender, core.driving_licence, core.status, core.deploy_status, core.contract,
       core.induction, core.added_date, core.job_role, core.current_site_id, core.wizard_draft,
       core.pending_submission, core.rejection_reason, JSON.stringify(profileData), archivedAt, archiveReason, employeeId]
    );
  } else {
    var ins = await client.query(
      `INSERT INTO employees (legacy_id, name, email, phone, phone_landline, date_of_birth, place_of_birth,
         nationality, gender, driving_licence, status, deploy_status, contract, induction, added_date,
         job_role, current_site_id, wizard_draft, pending_submission, rejection_reason, profile_data,
         archived_at, archive_reason, legacy_folder_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id`,
      [legacyId, core.name, core.email, core.phone, core.phone_landline, core.date_of_birth, core.place_of_birth,
       core.nationality, core.gender, core.driving_licence, core.status, core.deploy_status, core.contract,
       core.induction, core.added_date, core.job_role, core.current_site_id, core.wizard_draft,
       core.pending_submission, core.rejection_reason, JSON.stringify(profileData), archivedAt, archiveReason,
       s(emp._folderPath)]
    );
    employeeId = ins.rows[0].id;
  }

  var docCount = 0;
  if (await migrateDocSlot(client, employeeId, emp._folderPath, 'photo', 'profile', 'profile', {})) docCount++;
  if (await migrateDocSlot(client, employeeId, emp._folderPath, 'photo', 'pending', 'pending-profile', {})) docCount++;

  for (const key of ALLOWED_DOC_KEYS) {
    var meta = (emp.documents && emp.documents[key]) || {};
    var visibleToStaff = MANAGER_ONLY_DOC_KEYS.includes(key) ? (meta.visibleToStaff === true) : true;
    if (await migrateDocSlot(client, employeeId, emp._folderPath, 'document', key, 'doc_' + key,
        { subtype: s(meta.docType), visibleToStaff: visibleToStaff, uploadedAt: s(meta.date) })) docCount++;
  }

  for (const key of ALLOWED_TRAINING_KEYS) {
    var tmeta = (emp.training && emp.training[key]) || {};
    if (await migrateDocSlot(client, employeeId, emp._folderPath, 'training', key, 'doc_training_' + key,
        { uploadedAt: s(tmeta.certDate) })) docCount++;
  }

  return { employeeId: employeeId, docCount: docCount };
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const batches = [
    { records: loadFolderRecords(ACTIVE_DIR), status: 'active', label: 'Active Staff' },
    { records: loadFolderRecords(EX_DIR), status: 'archived', label: 'Ex-Staff' },
    { records: loadFolderRecords(DUPLICATE_DIR), status: 'duplicate', label: 'Duplicate Archive' },
  ];

  let imported = 0, failed = 0, totalDocs = 0;
  const errors = [];

  for (const batch of batches) {
    console.log('--- ' + batch.label + ': ' + batch.records.length + ' record(s) ---');
    for (const emp of batch.records) {
      try {
        await client.query('BEGIN');
        const result = await importOne(client, emp, batch.status);
        await client.query('COMMIT');
        imported++;
        totalDocs += result.docCount;
        console.log('[OK] ' + emp.name + ' (' + batch.status + ', ' + result.docCount + ' file(s))');
      } catch (e) {
        await client.query('ROLLBACK');
        failed++;
        errors.push({ name: emp.name, id: emp.id, status: batch.status, error: e.message });
        console.error('[FAIL] ' + emp.name + ': ' + e.message);
      }
    }
  }

  await client.query(
    `INSERT INTO migration_batches (source, batch_name, total_records, successful, failed, errors)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ['staff_data_json', 'phase3_staff_import', imported + failed, imported, failed, JSON.stringify(errors)]
  );

  console.log('----------------------------------------');
  console.log('Imported/updated: ' + imported);
  console.log('Failed:           ' + failed);
  console.log('Files copied:     ' + totalDocs);
  console.log('----------------------------------------');
  console.log('Note: contracts (CONTRACT_DIR/<legacyId>_contract.ext) were NOT touched —');
  console.log('they were already keyed by the stable legacy id in a flat directory, not');
  console.log('inside a per-person folder or staff_data.json, so nothing to migrate there.');

  await client.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function(e) { console.error('Migration crashed: ' + e.message); process.exit(1); });
