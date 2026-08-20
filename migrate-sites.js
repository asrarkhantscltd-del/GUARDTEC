// Phase-1 one-time migration (JSON→Postgres unification project): copies
// deployment-sites.json, its per-site document manifests, and its embedded
// welfare_items/assigned_staff arrays into Postgres (sites, site_documents,
// site_welfare_items, site_staff_assignments — see ensureSitesSchema() in
// server.js). Read-only against the JSON/filesystem: document/photo files
// themselves are left exactly where they are, only the manifest data moves.
// Safe to re-run: idempotent per site via `ON CONFLICT (id) DO NOTHING` on the
// site row itself (see note in main() about re-running after edits).

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BASE = process.env.DATA_PATH || path.join(process.env.HOME || process.env.USERPROFILE, 'First Call Site Services', 'FCSS - Managers', 'HR and Legal', 'Asrar', 'GuardTec Compliance');
const SITES_FILE = path.join(BASE, 'deployment-sites.json');
const SITE_DOCS_DIR = path.join(BASE, 'site-documents');

function loadSitesJson() {
  if (!fs.existsSync(SITES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(SITES_FILE, 'utf8')).sites || []; } catch (e) { return []; }
}

function loadSiteDocsJson(siteId) {
  var p = path.join(SITE_DOCS_DIR, siteId, 'index.json');
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) || []; } catch (e) { return []; }
}

function s(v) { return (v === undefined || v === null || v === '') ? null : String(v); }

async function importOne(client, site, resolveEmpId, orphanReport) {
  var existing = await client.query('SELECT id FROM sites WHERE id = $1', [s(site.id)]);
  if (existing.rows.length) return { skipped: true };

  // client_name/client_phone/.../notes are NOT NULL DEFAULT '' on the sites
  // table (matching how POST/PATCH /api/sites always store '' rather than
  // null for these optional text fields) — `|| ''` here, not just s(), because
  // real production sites have several of these genuinely blank in the JSON,
  // and DEFAULT '' only applies when a column is omitted from the INSERT
  // entirely, not when an explicit NULL is passed for it.
  await client.query(
    `INSERT INTO sites (id, name, type, client_name, client_phone, client_email, address,
                        supervisor_name, supervisor_phone, supervisor_email, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [s(site.id), s(site.name) || site.id, s(site.type) || 'other', s(site.client_name) || '', s(site.client_phone) || '',
     s(site.client_email) || '', s(site.address) || '', s(site.supervisor_name) || '', s(site.supervisor_phone) || '',
     s(site.supervisor_email) || '', s(site.status) || 'active', s(site.notes) || '']
  );

  var docs = loadSiteDocsJson(site.id);
  for (const doc of docs) {
    if (!doc || !doc.filename) continue;
    await client.query(
      `INSERT INTO site_documents (site_id, filename, original_name, category, size_bytes, uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (site_id, filename) DO NOTHING`,
      [site.id, doc.filename, s(doc.originalName) || doc.filename, s(doc.category), doc.size || null, doc.uploadedAt || null]
    );
  }

  var welfareItems = Array.isArray(site.welfare_items) ? site.welfare_items : [];
  for (const item of welfareItems) {
    if (!item || !item.id) continue;
    await client.query(
      `INSERT INTO site_welfare_items (id, site_id, name, quantity, condition, serial_number, notes, image_ext)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [item.id, site.id, s(item.name) || 'Unnamed item', item.quantity || 1, s(item.condition) || 'good',
       s(item.serial_number) || '', s(item.notes) || '', s(item.image_ext) || '']
    );
  }

  var assignedStaff = Array.isArray(site.assigned_staff) ? site.assigned_staff : [];
  for (const legacyId of assignedStaff) {
    if (!s(legacyId)) continue;
    // No FK to enforce here on purpose (see ensureSitesSchema comment in
    // server.js) — Staff hasn't migrated yet, so there's nothing to validate
    // against. Still worth flagging anything that clearly isn't a real id.
    if (!resolveEmpId.has(legacyId)) orphanReport.push({ site: site.id, staff: legacyId });
    await client.query(
      'INSERT INTO site_staff_assignments (site_id, employee_legacy_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [site.id, legacyId]
    );
  }

  return { skipped: false, documents: docs.length, welfareItems: welfareItems.length, staff: assignedStaff.length };
}

// Used only to flag likely-orphaned assignments in the report below — does
// NOT block the assignment from being migrated (see comment in importOne).
function loadKnownStaffLegacyIds() {
  var ACTIVE_DIR = path.join(BASE, '02 - Vetting & Screening', 'Active Staff');
  var ids = new Set();
  if (!fs.existsSync(ACTIVE_DIR)) return ids;
  fs.readdirSync(ACTIVE_DIR).forEach(function(d) {
    try {
      var jp = path.join(ACTIVE_DIR, d, 'staff_data.json');
      if (!fs.existsSync(jp)) return;
      var emp = JSON.parse(fs.readFileSync(jp, 'utf8'));
      if (emp.id) ids.add(emp.id);
    } catch (e) {}
  });
  return ids;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const sites = loadSitesJson();
  const knownStaffIds = loadKnownStaffLegacyIds();
  console.log('Found ' + sites.length + ' site(s) to process.');

  let imported = 0, skipped = 0, failed = 0;
  const errors = [];
  const orphanReport = [];

  for (const site of sites) {
    try {
      await client.query('BEGIN');
      const result = await importOne(client, site, knownStaffIds, orphanReport);
      await client.query('COMMIT');
      if (result.skipped) { skipped++; }
      else { imported++; console.log('[OK] ' + site.name + ' (docs=' + result.documents + ', welfare=' + result.welfareItems + ', staff=' + result.staff + ')'); }
    } catch (e) {
      await client.query('ROLLBACK');
      failed++;
      errors.push({ name: site.name, id: site.id, error: e.message });
      console.error('[FAIL] ' + site.name + ': ' + e.message);
    }
  }

  await client.query(
    `INSERT INTO migration_batches (source, batch_name, total_records, successful, failed, errors)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ['deployment_sites_json', 'phase1_sites_import', sites.length, imported, failed, JSON.stringify(errors)]
  );

  console.log('----------------------------------------');
  console.log('Total found:  ' + sites.length);
  console.log('Imported:     ' + imported);
  console.log('Already done: ' + skipped);
  console.log('Failed:       ' + failed);
  if (orphanReport.length) {
    console.log('Orphaned staff assignments (legacy id not found in Active Staff — check by hand):');
    orphanReport.forEach(function(o) { console.log('  site=' + o.site + ' staff=' + o.staff); });
  }
  console.log('----------------------------------------');

  await client.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function(e) { console.error('Migration crashed: ' + e.message); process.exit(1); });
