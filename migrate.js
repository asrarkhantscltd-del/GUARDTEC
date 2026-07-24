// Phase 1 one-time migration: copies the JSON files in Active Staff into
// PostgreSQL. Read-only against the JSON files — nothing here writes back
// to OneDrive. Safe to re-run: already-imported people (matched by their
// original JSON "id") are skipped, not duplicated.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Known junk records — dashboard/legend text that got saved as staff folders
// on 2026-07-22 (root cause not yet identified, flagged separately). Every
// one of these has an empty phone/email/SIA/CSCS/visa and matches no real
// person. Excluded here so they don't pollute the new database.
const KNOWN_JUNK_LEGACY_IDS = new Set([
  'colour-key',
  'credential',
  'expired',
  'expiring---90-days',
  'no-data---pending',
  'red---expired---do-not-deploy-----orange---expiring---90-days---renew-now-----yellow---cscs-action-needed-----green---valid---current',
  'refreshed--26-june-2026-------48-staff-tracked',
  'select-staff-member-',
  'sia-licence',
  'sia-licences',
  'staff-compliance-lookup-----select-a-name-to-instantly-check-all-credentials',
  'total-staff-tracked',
  'valid'
]);

const BASE = process.env.DATA_PATH || path.join(process.env.HOME || process.env.USERPROFILE, 'First Call Site Services', 'FCSS - Managers', 'HR and Legal', 'Asrar', 'GuardTec Compliance');
const ACTIVE_DIR = path.join(BASE, '02 - Vetting & Screening', 'Active Staff');
const EX_DIR = path.join(BASE, '02 - Vetting & Screening', 'Ex-Staff');

// Same name-cleaning rule server.js uses to build its Ex-Staff exclusion set.
function cleanName(d) {
  return d.replace(/^[^\p{L}A-Za-z]+/u, '').trim().toUpperCase();
}

function buildExNames() {
  const exNames = new Set();
  if (fs.existsSync(EX_DIR)) {
    fs.readdirSync(EX_DIR).forEach(function(d) {
      const clean = cleanName(d);
      if (clean) exNames.add(clean);
    });
  }
  return exNames;
}

// Mirrors server.js loadAllStaff() exactly: skip non-folders, skip folders
// with no staff_data.json, skip anyone whose name also appears in Ex-Staff
// (the stale name-variant duplicates we talked about).
function loadActiveStaffRecords() {
  const exNames = buildExNames();
  const records = [];
  if (!fs.existsSync(ACTIVE_DIR)) return records;

  fs.readdirSync(ACTIVE_DIR).forEach(function(d) {
    const fp = path.join(ACTIVE_DIR, d);
    try {
      if (!fs.statSync(fp).isDirectory()) return;
      const jp = path.join(fp, 'staff_data.json');
      if (!fs.existsSync(jp)) return;
      if (exNames.has(cleanName(d))) return;
      const emp = JSON.parse(fs.readFileSync(jp, 'utf8'));
      if (KNOWN_JUNK_LEGACY_IDS.has(emp.id)) return;
      emp._folderPath = fp;
      records.push(emp);
    } catch (e) {
      console.error('[SKIP] Could not read ' + fp + ': ' + e.message);
    }
  });
  return records;
}

function s(v) { return (v === undefined || v === null || v === '') ? null : String(v); }
function d(v) { return (v === undefined || v === null || v === '') ? null : v; } // dates already come as 'YYYY-MM-DD'

async function importOne(client, emp) {
  // Idempotency check: has this exact person already been imported?
  const existing = await client.query('SELECT id FROM employees WHERE legacy_id = $1', [s(emp.id)]);
  if (existing.rows.length) return { skipped: true, employeeId: existing.rows[0].id };

  const empRes = await client.query(
    `INSERT INTO employees
      (legacy_id, name, email, phone, phone_landline, place_of_birth, nationality, gender,
       driving_licence, status, deploy_status, contract, induction, added_date, legacy_folder_path)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`,
    [s(emp.id), s(emp.name), s(emp.email), s(emp.phone), s(emp.phoneLandline),
     s(emp.placeOfBirth), s(emp.nationality), s(emp.gender), s(emp.drivingLicence),
     s(emp.status) || 'active', s(emp.deployStatus) || 'inactive', s(emp.contract),
     !!emp.induction, d(emp.addedDate), s(emp._folderPath)]
  );
  const employeeId = empRes.rows[0].id;

  const bank = emp.bank || {};
  const criminal = emp.criminal || {};
  await client.query(
    `INSERT INTO employee_private
      (employee_id, ni_number, bank_account_number, bank_sort_code, bank_holder_name, bank_name,
       criminal_offences, criminal_offence_details, bankrupt, ccj, credit_check_consent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [employeeId, s(emp.ni), s(bank.accountNumber), s(bank.sortCode), s(bank.holder), s(bank.bankName),
     s(criminal.offences) || 'No', s(criminal.offenceDetails), s(criminal.bankrupt) || 'No',
     s(criminal.ccj) || 'No', s(criminal.creditCheck) || 'No']
  );

  const addr = emp.address || {};
  if (s(addr.current)) {
    await client.query(
      `INSERT INTO employee_addresses (employee_id, address_line, moved_in, moved_out, is_current, address_order)
       VALUES ($1,$2,$3,$4,true,1)`,
      [employeeId, s(addr.current), d(addr.movedIn), d(addr.movedOut)]
    );
  }
  if (s(addr.previous)) {
    await client.query(
      `INSERT INTO employee_addresses (employee_id, address_line, moved_in, moved_out, is_current, address_order)
       VALUES ($1,$2,$3,$4,false,2)`,
      [employeeId, s(addr.previous), d(addr.prevMovedIn), d(addr.prevMovedOut)]
    );
  }

  const sia = emp.sia || {}, cscs = emp.cscs || {}, visa = emp.visa || {};
  const docs = [
    ['SIA_LICENCE', s(sia.number), null, d(sia.expiry)],
    ['CSCS_CARD', s(cscs.number), s(emp.cscsQualification), d(cscs.expiry)],
    ['RIGHT_TO_WORK', null, s(visa.type), d(visa.expiry)]
  ];
  for (const [type, number, subtype, expiry] of docs) {
    if (!number && !subtype && !expiry) continue; // nothing on file for this document — skip the row entirely
    await client.query(
      `INSERT INTO compliance_documents (employee_id, document_type, document_number, document_subtype, expiry_date)
       VALUES ($1,$2,$3,$4,$5)`,
      [employeeId, type, number, subtype, expiry]
    );
  }

  const refs = emp.references || {};
  for (const key of ['ref1', 'ref2']) {
    const r = refs[key];
    if (!r || !(s(r.name) || s(r.company) || s(r.email))) continue; // blank placeholder — nothing to import
    await client.query(
      `INSERT INTO staff_references (employee_id, ref_number, name, company, email, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [employeeId, key === 'ref1' ? 1 : 2, s(r.name), s(r.company), s(r.email), s(r.status) || 'Not Started']
    );
  }

  const history = Array.isArray(emp.employmentHistory) ? emp.employmentHistory : [];
  for (let i = 0; i < history.length; i++) {
    if (!s(history[i])) continue;
    await client.query(
      `INSERT INTO employment_history (employee_id, employer_name, order_index) VALUES ($1,$2,$3)`,
      [employeeId, s(history[i]), i]
    );
  }

  return { skipped: false, employeeId };
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const records = loadActiveStaffRecords();
  console.log('Found ' + records.length + ' real active staff records to process.');

  let imported = 0, skipped = 0, failed = 0;
  const errors = [];

  for (const emp of records) {
    try {
      await client.query('BEGIN');
      const result = await importOne(client, emp);
      await client.query('COMMIT');
      if (result.skipped) { skipped++; }
      else { imported++; console.log('[OK] ' + emp.name); }
    } catch (e) {
      await client.query('ROLLBACK');
      failed++;
      errors.push({ name: emp.name, id: emp.id, error: e.message });
      console.error('[FAIL] ' + emp.name + ': ' + e.message);
    }
  }

  await client.query(
    `INSERT INTO migration_batches (source, batch_name, total_records, successful, failed, errors)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ['json_folders', 'phase1_initial_import', records.length, imported, failed, JSON.stringify(errors)]
  );

  console.log('----------------------------------------');
  console.log('Total found:  ' + records.length);
  console.log('Imported:     ' + imported);
  console.log('Already done: ' + skipped);
  console.log('Failed:       ' + failed);
  console.log('----------------------------------------');

  await client.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function(e) { console.error('Migration crashed: ' + e.message); process.exit(1); });
