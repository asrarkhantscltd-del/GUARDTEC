// Phase-2 one-time migration (JSON→Postgres unification project): copies
// vehicles.json and its per-vehicle document manifests into Postgres
// (vehicles/vehicle_compliance/vehicle_assignments/vehicle_documents — see
// ensureVehiclesExtendedSchema() in server.js). Unlike sites, vehicles get a
// FRESH UUID (the dormant vehicles table from schema-phase3.sql was already
// UUID-keyed and nothing outside vehicles.json referenced the old
// Date.now().toString() id as a live Postgres column) — so this script also
// COPIES (never moves/deletes) each vehicle's photo and doc-folder from the
// old id-keyed filename to the new UUID-keyed one, leaving the originals
// untouched on disk. Safe to re-run: idempotent per vehicle via a legacy_id
// lookup before inserting.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BASE = process.env.DATA_PATH || path.join(process.env.HOME || process.env.USERPROFILE, 'First Call Site Services', 'FCSS - Managers', 'HR and Legal', 'Asrar', 'GuardTec Compliance');
const VEHICLES_FILE = path.join(BASE, 'vehicles.json');
const VEHICLE_PHOTOS_DIR = path.join(BASE, 'vehicle-photos');
const VEHICLE_DOCS_DIR = path.join(BASE, 'vehicle-docs');

const COMPLIANCE_FIELD_MAP = [['mot_expiry', 'MOT'], ['insurance_expiry', 'INSURANCE'], ['road_tax_expiry', 'ROAD_TAX'], ['service_due', 'SERVICE']];

function loadVehiclesJson() {
  if (!fs.existsSync(VEHICLES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(VEHICLES_FILE, 'utf8')) || []; } catch (e) { return []; }
}

function loadVehicleDocsJson(oldId) {
  var p = path.join(VEHICLE_DOCS_DIR, oldId, 'index.json');
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) || []; } catch (e) { return []; }
}

function s(v) { return (v === undefined || v === null || v === '') ? null : String(v); }

function copyPhoto(oldId, newId) {
  ['.jpg', '.jpeg', '.png', '.webp'].forEach(function(ext) {
    var oldPath = path.join(VEHICLE_PHOTOS_DIR, oldId + ext);
    if (fs.existsSync(oldPath)) {
      fs.copyFileSync(oldPath, path.join(VEHICLE_PHOTOS_DIR, newId + ext));
    }
  });
}

function copyDocs(oldId, newId) {
  var oldDir = path.join(VEHICLE_DOCS_DIR, oldId);
  if (!fs.existsSync(oldDir)) return;
  var newDir = path.join(VEHICLE_DOCS_DIR, newId);
  if (!fs.existsSync(newDir)) fs.mkdirSync(newDir, { recursive: true });
  fs.readdirSync(oldDir).forEach(function(f) {
    if (f === 'index.json') return;
    fs.copyFileSync(path.join(oldDir, f), path.join(newDir, f));
  });
}

async function importOne(client, vehicle, orphanReport) {
  var oldId = s(vehicle.id);
  var existing = await client.query('SELECT id FROM vehicles WHERE legacy_id = $1', [oldId]);
  if (existing.rows.length) return { skipped: true };

  var registration = s(vehicle.registration);
  if (!registration) {
    throw new Error('missing registration — cannot import (registration is NOT NULL/UNIQUE on vehicles)');
  }

  var vehicleRes = await client.query(
    `INSERT INTO vehicles (legacy_id, registration, make, model, vehicle_type, year, colour, status, notes, mileage)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [oldId, registration, s(vehicle.make), s(vehicle.model), s(vehicle.type) || 'other',
     vehicle.year || null, s(vehicle.colour), s(vehicle.status) || 'active', s(vehicle.notes), vehicle.mileage || null]
  );
  var newId = vehicleRes.rows[0].id;

  for (const [jsonKey, docType] of COMPLIANCE_FIELD_MAP) {
    if (s(vehicle[jsonKey])) {
      await client.query('INSERT INTO vehicle_compliance (vehicle_id, document_type, expiry_date) VALUES ($1,$2,$3)', [newId, docType, vehicle[jsonKey]]);
    }
  }

  var driverAssigned = false;
  if (s(vehicle.assignedDriverId)) {
    var empRes = await client.query('SELECT id FROM employees WHERE legacy_id = $1', [vehicle.assignedDriverId]);
    if (empRes.rows.length) {
      await client.query('INSERT INTO vehicle_assignments (vehicle_id, employee_id, is_primary_driver) VALUES ($1,$2,true)', [newId, empRes.rows[0].id]);
      driverAssigned = true;
    } else {
      orphanReport.push({ vehicle: oldId, driver: vehicle.assignedDriverId });
    }
  }

  var docs = loadVehicleDocsJson(oldId);
  for (const doc of docs) {
    if (!doc || !doc.filename) continue;
    await client.query(
      `INSERT INTO vehicle_documents (vehicle_id, filename, original_name, doc_type, size_bytes, uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (vehicle_id, filename) DO NOTHING`,
      [newId, doc.filename, s(doc.originalName) || doc.filename, s(doc.docType), doc.size || null, doc.uploadedAt || null]
    );
  }

  copyPhoto(oldId, newId);
  copyDocs(oldId, newId);

  return { skipped: false, newId: newId, compliance: COMPLIANCE_FIELD_MAP.filter(function(f) { return !!vehicle[f[0]]; }).length, driverAssigned: driverAssigned, docs: docs.length };
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const vehicles = loadVehiclesJson();
  console.log('Found ' + vehicles.length + ' vehicle(s) to process.');

  let imported = 0, skipped = 0, failed = 0;
  const errors = [];
  const orphanReport = [];

  for (const vehicle of vehicles) {
    try {
      await client.query('BEGIN');
      const result = await importOne(client, vehicle, orphanReport);
      await client.query('COMMIT');
      if (result.skipped) { skipped++; }
      else {
        imported++;
        console.log('[OK] ' + (vehicle.registration || vehicle.id) + ' -> ' + result.newId +
          ' (compliance=' + result.compliance + ', driver=' + result.driverAssigned + ', docs=' + result.docs + ')');
      }
    } catch (e) {
      await client.query('ROLLBACK');
      failed++;
      errors.push({ id: vehicle.id, registration: vehicle.registration, error: e.message });
      console.error('[FAIL] ' + (vehicle.registration || vehicle.id) + ': ' + e.message);
    }
  }

  await client.query(
    `INSERT INTO migration_batches (source, batch_name, total_records, successful, failed, errors)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ['vehicles_json', 'phase2_vehicles_import', vehicles.length, imported, failed, JSON.stringify(errors)]
  );

  console.log('----------------------------------------');
  console.log('Total found:  ' + vehicles.length);
  console.log('Imported:     ' + imported);
  console.log('Already done: ' + skipped);
  console.log('Failed:       ' + failed);
  if (orphanReport.length) {
    console.log('Driver assignments that could not be resolved (staff legacy id not found in employees — check by hand):');
    orphanReport.forEach(function(o) { console.log('  vehicle=' + o.vehicle + ' driver=' + o.driver); });
  }
  console.log('----------------------------------------');

  await client.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function(e) { console.error('Migration crashed: ' + e.message); process.exit(1); });
