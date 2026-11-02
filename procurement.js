// Procurement — Purchase Order Register, Approved Supplier Register and the
// Supplier Evaluation form (paper form digitised, incl. a public fill link).
//
// Permissions: 'purchase_orders' (raise/track POs), 'approve_purchase_orders'
// (approve/reject), 'suppliers' (supplier register + evaluations). Director
// always passes (requirePermission). Hard deletes are Director-only + audited.
//
// Public supplier link: the 256-bit token in the URL is the security boundary
// (same model as /api/public/compliance-calendar). It only ever exposes the
// one supplier it was issued for, expires after LINK_TTL_DAYS and becomes
// read-only once submitted. Suppliers answer Yes/No + upload evidence; grades
// are set internally afterwards — a supplier never grades itself.
//
// Registered from server.js: require('./procurement')({ ... })

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var SECTIONS = [
  { key: 'A', title: 'Performance & Quality', questions: [
    'Is the service or product provided within the agreed time frame?',
    'Does the service or product meet the agreed requirements?',
    'Does the Supplier hold a valid ISO 9001:2015 certification?' ] },
  { key: 'B', title: 'Environmental', questions: [
    'Does the supplier have a suitable environmental policy in place?',
    "Does the supplier operate within the company's environmental objectives?",
    'Does the supplier hold a valid ISO 14001:2015 certification?' ] },
  { key: 'C', title: 'Health & Safety', questions: [
    'Does the supplier have a suitable Health & Safety Policy in place?',
    "Does the supplier operate within the company's Health & Safety objectives?",
    'Does the Supplier hold a valid ISO 45001:2018 or OHSAS certification?' ] },
  { key: 'D', title: 'Ethical Purchasing', questions: [
    'Does the supplier have an ethical purchasing policy?',
    'Does the company have an anti-slavery policy?',
    'Does the company have an anti-bribery policy?' ] },
  { key: 'E', title: 'Data Handling', questions: [
    'Does the supplier hold any sensitive information?',
    'Does the supplier have an ICO certificate?',
    'Does the supplier have a GDPR Policy in place?' ] },
];
var SECTION_KEYS = SECTIONS.map(function (s) { return s.key; });
var GRADES = ['acceptable', 'unacceptable', 'under_review'];
var REVIEW_TYPES = ['standard', 'specific', 'performance'];
var SUPPLIER_STATUSES = ['pending', 'approved', 'under_review', 'rejected'];
var PO_STATUSES = ['requested', 'approved', 'ordered', 'received', 'paid', 'rejected'];
// Forward-only fulfilment chain once approved; approve/reject handled separately.
var PO_NEXT = { approved: 'ordered', ordered: 'received', received: 'paid' };
var LINK_TTL_DAYS = 30;
var MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
var MAX_PUBLIC_UPLOADS = 25;
var ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.heic', '.doc', '.docx', '.xls', '.xlsx', '.txt'];
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var TOKEN_RE = /^[0-9a-f]{64}$/;

function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); }
function dateOrNull(v) {
  var s = String(v == null ? '' : v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function num(v, max) {
  var n = Number(v);
  return isFinite(n) && n >= 0 ? Math.min(Math.round(n * 100) / 100, max || 1e9) : 0;
}
function isUuid(v) { return UUID_RE.test(String(v || '')); }
function oneOf(v, list, fallback) { v = String(v || '').toLowerCase(); return list.indexOf(v) !== -1 ? v : fallback; }
function today() { return new Date().toISOString().slice(0, 10); }
function plusMonths(iso, m) {
  var d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + m); return d.toISOString().slice(0, 10);
}

function cleanAnswers(raw) {
  var out = {};
  SECTIONS.forEach(function (s) {
    var src = (raw && raw[s.key]) || [];
    out[s.key] = s.questions.map(function (_, i) {
      var v = String(src[i] || '').toLowerCase();
      return v === 'yes' || v === 'no' ? v : '';
    });
  });
  return out;
}
function cleanComments(raw) {
  var out = {};
  SECTION_KEYS.forEach(function (k) { out[k] = str(raw && raw[k], 2000); });
  return out;
}
function cleanGrades(raw) {
  var out = {};
  SECTION_KEYS.forEach(function (k) { out[k] = oneOf(raw && raw[k], GRADES, ''); });
  return out;
}
function answersComplete(a) {
  return SECTION_KEYS.every(function (k) { return a[k].every(function (x) { return x === 'yes' || x === 'no'; }); });
}
// Overall = worst section grade; blank if any section ungraded.
function overallFrom(grades) {
  var vals = SECTION_KEYS.map(function (k) { return grades[k]; });
  if (vals.some(function (v) { return !v; })) return '';
  if (vals.indexOf('unacceptable') !== -1) return 'unacceptable';
  if (vals.indexOf('under_review') !== -1) return 'under_review';
  return 'acceptable';
}
var STATUS_FROM_OVERALL = { acceptable: 'approved', unacceptable: 'rejected', under_review: 'under_review' };

module.exports = function (deps) {
  var app = deps.app, pgPool = deps.pgPool, requireLogin = deps.requireLogin,
      requirePermission = deps.requirePermission, requireRole = deps.requireRole,
      logAuditEvent = deps.logAuditEvent, createNotification = deps.createNotification,
      BASE_URL = deps.BASE_URL, rateLimit = deps.rateLimit;

  var DOCS_DIR = path.join(deps.BASE, 'procurement-documents');
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });

  var publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false,
    message: { ok: false, error: 'Too many requests. Please wait a few minutes and try again.' }
  });

  (async function ensureProcurementSchema() {
    try {
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS suppliers (
          id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name             TEXT NOT NULL,
          services         TEXT NOT NULL DEFAULT '',
          contract_number  TEXT NOT NULL DEFAULT '',
          contact_name     TEXT NOT NULL DEFAULT '',
          contact_phone    TEXT NOT NULL DEFAULT '',
          contact_email    TEXT NOT NULL DEFAULT '',
          address          TEXT NOT NULL DEFAULT '',
          status           TEXT NOT NULL DEFAULT 'pending',
          review_date      DATE,
          next_review_due  DATE,
          notes            TEXT NOT NULL DEFAULT '',
          created_by       TEXT,
          created_at       TIMESTAMPTZ DEFAULT NOW(),
          updated_at       TIMESTAMPTZ DEFAULT NOW()
        )`);
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS supplier_evaluations (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          supplier_id   UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
          header        JSONB NOT NULL DEFAULT '{}'::jsonb,
          answers       JSONB NOT NULL DEFAULT '{}'::jsonb,
          comments      JSONB NOT NULL DEFAULT '{}'::jsonb,
          grades        JSONB NOT NULL DEFAULT '{}'::jsonb,
          overall       TEXT NOT NULL DEFAULT '',
          reviewed_by   TEXT NOT NULL DEFAULT 'Matthew Hunter',
          review_type   TEXT NOT NULL DEFAULT 'standard',
          submitted_via TEXT NOT NULL DEFAULT 'internal',
          submitted_at  TIMESTAMPTZ DEFAULT NOW(),
          graded_at     TIMESTAMPTZ,
          graded_by     TEXT
        )`);
      await pgPool.query('CREATE INDEX IF NOT EXISTS idx_supplier_evals_supplier ON supplier_evaluations(supplier_id, submitted_at DESC)');
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS supplier_eval_links (
          token          TEXT PRIMARY KEY,
          supplier_id    UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
          review_type    TEXT NOT NULL DEFAULT 'standard',
          reviewed_by    TEXT NOT NULL DEFAULT 'Matthew Hunter',
          created_by     TEXT,
          created_at     TIMESTAMPTZ DEFAULT NOW(),
          expires_at     TIMESTAMPTZ NOT NULL,
          used_at        TIMESTAMPTZ,
          evaluation_id  UUID
        )`);
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS supplier_documents (
          id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          supplier_id    UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
          evaluation_id  UUID REFERENCES supplier_evaluations(id) ON DELETE SET NULL,
          link_token     TEXT,
          section        TEXT NOT NULL DEFAULT '',
          filename       TEXT NOT NULL,
          original_name  TEXT NOT NULL,
          size_bytes     INTEGER NOT NULL DEFAULT 0,
          uploaded_via   TEXT NOT NULL DEFAULT 'internal',
          created_at     TIMESTAMPTZ DEFAULT NOW()
        )`);
      await pgPool.query('CREATE INDEX IF NOT EXISTS idx_supplier_docs_supplier ON supplier_documents(supplier_id)');
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS purchase_orders (
          id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          po_number           TEXT NOT NULL UNIQUE,
          request_date        DATE NOT NULL DEFAULT CURRENT_DATE,
          requested_by        TEXT NOT NULL DEFAULT '',
          supplier_id         UUID REFERENCES suppliers(id) ON DELETE SET NULL,
          supplier_name       TEXT NOT NULL DEFAULT '',
          description         TEXT NOT NULL DEFAULT '',
          items               JSONB NOT NULL DEFAULT '[]'::jsonb,
          total               NUMERIC(12,2) NOT NULL DEFAULT 0,
          status              TEXT NOT NULL DEFAULT 'requested',
          approved_by         TEXT,
          approved_at         TIMESTAMPTZ,
          rejected_reason     TEXT NOT NULL DEFAULT '',
          notes               TEXT NOT NULL DEFAULT '',
          attachment_filename TEXT,
          attachment_name     TEXT,
          created_by          TEXT,
          created_at          TIMESTAMPTZ DEFAULT NOW(),
          updated_at          TIMESTAMPTZ DEFAULT NOW()
        )`);
      await pgPool.query('CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status)');
    } catch (e) {
      console.error('[DB] procurement schema migration failed:', e.message);
    }
  })();

  function actor(req) { return (req.user && (req.user.full_name || req.user.username)) || 'Unknown'; }

  // Raw-body upload (no multer in this codebase) with a hard size cap.
  function readUpload(req, res, cb) {
    var originalName = 'document';
    try { originalName = decodeURIComponent(req.headers['x-filename'] || 'document'); } catch (e) {}
    originalName = path.basename(originalName).slice(0, 200) || 'document';
    var ext = path.extname(originalName).toLowerCase();
    if (ALLOWED_EXT.indexOf(ext) === -1) {
      return res.status(400).json({ ok: false, error: 'File type not allowed. Use PDF, image, Word, Excel or text files.' });
    }
    var chunks = [], size = 0, aborted = false;
    req.on('data', function (c) {
      if (aborted) return;
      size += c.length;
      if (size > MAX_UPLOAD_BYTES) {
        aborted = true;
        res.status(413).json({ ok: false, error: 'File is too large (max 15 MB).' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', function () {
      if (aborted) return;
      var buf = Buffer.concat(chunks);
      if (!buf.length) return res.status(400).json({ ok: false, error: 'Empty file.' });
      var filename = crypto.randomBytes(16).toString('hex') + ext;
      fs.writeFile(path.join(DOCS_DIR, filename), buf, function (err) {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        cb(filename, originalName, buf.length);
      });
    });
    req.on('error', function (e) { if (!aborted) res.status(500).json({ ok: false, error: e.message }); });
  }

  function sendDoc(res, filename, originalName) {
    var fp = path.join(DOCS_DIR, path.basename(filename));
    if (!fs.existsSync(fp)) return res.status(404).end();
    res.setHeader('Content-Disposition', 'inline; filename="' + String(originalName).replace(/["\r\n]/g, '') + '"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(fp);
  }
  function removeFile(filename) {
    if (!filename) return;
    fs.unlink(path.join(DOCS_DIR, path.basename(filename)), function () {});
  }

  // ═══ SUPPLIERS ═════════════════════════════════════════════════════════════

  function supplierFields(b) {
    return {
      name: str(b.name, 200), services: str(b.services, 1000), contract_number: str(b.contract_number, 100),
      contact_name: str(b.contact_name, 200), contact_phone: str(b.contact_phone, 50),
      contact_email: str(b.contact_email, 200).toLowerCase(), address: str(b.address, 1000),
      status: oneOf(b.status, SUPPLIER_STATUSES, 'pending'),
      review_date: dateOrNull(b.review_date), next_review_due: dateOrNull(b.next_review_due),
      notes: str(b.notes, 4000),
    };
  }

  app.get('/api/suppliers', requireLogin, requirePermission('suppliers'), async function (req, res) {
    try {
      var r = await pgPool.query(`
        SELECT s.*,
          le.id AS latest_eval_id, le.overall AS latest_overall, le.submitted_at AS latest_submitted_at,
          le.graded_at AS latest_graded_at, le.submitted_via AS latest_submitted_via,
          (SELECT COUNT(*)::int FROM supplier_evaluations e WHERE e.supplier_id = s.id) AS eval_count,
          (SELECT COUNT(*)::int FROM purchase_orders p WHERE p.supplier_id = s.id) AS po_count
        FROM suppliers s
        LEFT JOIN LATERAL (
          SELECT id, overall, submitted_at, graded_at, submitted_via FROM supplier_evaluations
          WHERE supplier_id = s.id ORDER BY submitted_at DESC LIMIT 1
        ) le ON TRUE
        ORDER BY s.name ASC`);
      res.json({ ok: true, suppliers: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Minimal list for the PO supplier picker — PO raisers may not hold 'suppliers'.
  app.get('/api/suppliers/options', requireLogin, requirePermission('purchase_orders'), async function (req, res) {
    try {
      var r = await pgPool.query('SELECT id, name, status FROM suppliers ORDER BY name ASC');
      res.json({ ok: true, suppliers: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/suppliers/:id', requireLogin, requirePermission('suppliers'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Supplier not found' });
      var s = await pgPool.query('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
      if (!s.rows.length) return res.status(404).json({ ok: false, error: 'Supplier not found' });
      var ev = await pgPool.query('SELECT * FROM supplier_evaluations WHERE supplier_id = $1 ORDER BY submitted_at DESC', [req.params.id]);
      var docs = await pgPool.query(
        `SELECT id, evaluation_id, section, original_name, size_bytes, uploaded_via, created_at
         FROM supplier_documents WHERE supplier_id = $1 AND (evaluation_id IS NOT NULL OR link_token IS NULL)
         ORDER BY created_at DESC`, [req.params.id]);
      var links = await pgPool.query(
        `SELECT token, review_type, created_at, expires_at, used_at FROM supplier_eval_links
         WHERE supplier_id = $1 AND used_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC`, [req.params.id]);
      res.json({
        ok: true, supplier: s.rows[0], evaluations: ev.rows, documents: docs.rows,
        open_links: links.rows.map(function (l) {
          return { url: BASE_URL + '/supplier-evaluation/' + l.token, review_type: l.review_type, created_at: l.created_at, expires_at: l.expires_at };
        }),
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/suppliers', requireLogin, requirePermission('suppliers'), async function (req, res) {
    try {
      var f = supplierFields(req.body || {});
      if (!f.name) return res.status(400).json({ ok: false, error: 'Supplier name is required.' });
      var r = await pgPool.query(
        `INSERT INTO suppliers (name, services, contract_number, contact_name, contact_phone, contact_email, address, status, review_date, next_review_due, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [f.name, f.services, f.contract_number, f.contact_name, f.contact_phone, f.contact_email, f.address, f.status, f.review_date, f.next_review_due, f.notes, actor(req)]);
      logAuditEvent(req, 'SUPPLIER_CREATED', 'supplier', r.rows[0].id, f.name, {});
      res.json({ ok: true, supplier: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.patch('/api/suppliers/:id', requireLogin, requirePermission('suppliers'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Supplier not found' });
      var f = supplierFields(req.body || {});
      if (!f.name) return res.status(400).json({ ok: false, error: 'Supplier name is required.' });
      var r = await pgPool.query(
        `UPDATE suppliers SET name=$2, services=$3, contract_number=$4, contact_name=$5, contact_phone=$6, contact_email=$7,
           address=$8, status=$9, review_date=$10, next_review_due=$11, notes=$12, updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [req.params.id, f.name, f.services, f.contract_number, f.contact_name, f.contact_phone, f.contact_email, f.address, f.status, f.review_date, f.next_review_due, f.notes]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Supplier not found' });
      logAuditEvent(req, 'SUPPLIER_UPDATED', 'supplier', req.params.id, f.name, { status: f.status });
      res.json({ ok: true, supplier: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/suppliers/:id', requireLogin, requireRole('director'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Supplier not found' });
      var s = await pgPool.query('SELECT name FROM suppliers WHERE id = $1', [req.params.id]);
      if (!s.rows.length) return res.status(404).json({ ok: false, error: 'Supplier not found' });
      var files = await pgPool.query('SELECT filename FROM supplier_documents WHERE supplier_id = $1', [req.params.id]);
      await pgPool.query('DELETE FROM suppliers WHERE id = $1', [req.params.id]);
      files.rows.forEach(function (f) { removeFile(f.filename); });
      logAuditEvent(req, 'SUPPLIER_DELETED', 'supplier', req.params.id, s.rows[0].name, { documents_removed: files.rows.length });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Issue a public evaluation link (copy-to-clipboard in the UI; never emailed).
  app.post('/api/suppliers/:id/eval-link', requireLogin, requirePermission('suppliers'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Supplier not found' });
      var s = await pgPool.query('SELECT name FROM suppliers WHERE id = $1', [req.params.id]);
      if (!s.rows.length) return res.status(404).json({ ok: false, error: 'Supplier not found' });
      var token = crypto.randomBytes(32).toString('hex');
      var reviewType = oneOf(req.body && req.body.review_type, REVIEW_TYPES, 'standard');
      var reviewedBy = str(req.body && req.body.reviewed_by, 120) || 'Matthew Hunter';
      await pgPool.query(
        `INSERT INTO supplier_eval_links (token, supplier_id, review_type, reviewed_by, created_by, expires_at)
         VALUES ($1,$2,$3,$4,$5, NOW() + ($6 || ' days')::interval)`,
        [token, req.params.id, reviewType, reviewedBy, actor(req), String(LINK_TTL_DAYS)]);
      logAuditEvent(req, 'SUPPLIER_EVAL_LINK_CREATED', 'supplier', req.params.id, s.rows[0].name, { review_type: reviewType });
      res.json({ ok: true, url: BASE_URL + '/supplier-evaluation/' + token, expires_in_days: LINK_TTL_DAYS });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/suppliers/:id/eval-links', requireLogin, requirePermission('suppliers'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Supplier not found' });
      await pgPool.query('UPDATE supplier_eval_links SET expires_at = NOW() WHERE supplier_id = $1 AND used_at IS NULL', [req.params.id]);
      logAuditEvent(req, 'SUPPLIER_EVAL_LINKS_REVOKED', 'supplier', req.params.id, '', {});
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Internal evaluation (reviewer fills the whole form incl. grades).
  app.post('/api/suppliers/:id/evaluations', requireLogin, requirePermission('suppliers'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Supplier not found' });
      var s = await pgPool.query('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
      if (!s.rows.length) return res.status(404).json({ ok: false, error: 'Supplier not found' });
      var b = req.body || {};
      var answers = cleanAnswers(b.answers);
      if (!answersComplete(answers)) return res.status(400).json({ ok: false, error: 'Answer every Yes/No question.' });
      var grades = cleanGrades(b.grades);
      var overall = overallFrom(grades);
      var header = headerFrom(s.rows[0], b.header);
      var r = await pgPool.query(
        `INSERT INTO supplier_evaluations (supplier_id, header, answers, comments, grades, overall, reviewed_by, review_type, submitted_via, graded_at, graded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'internal', CASE WHEN $6 = '' THEN NULL ELSE NOW() END, CASE WHEN $6 = '' THEN NULL ELSE $9 END) RETURNING *`,
        [req.params.id, header, answers, cleanComments(b.comments), grades, overall,
         str(b.reviewed_by, 120) || 'Matthew Hunter', oneOf(b.review_type, REVIEW_TYPES, 'standard'), actor(req)]);
      if (overall) await applyOverall(req.params.id, overall);
      logAuditEvent(req, 'SUPPLIER_EVALUATION_CREATED', 'supplier', req.params.id, s.rows[0].name, { overall: overall });
      res.json({ ok: true, evaluation: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Grade a (usually supplier-submitted) evaluation.
  app.patch('/api/supplier-evaluations/:id/grades', requireLogin, requirePermission('suppliers'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Evaluation not found' });
      var b = req.body || {};
      var grades = cleanGrades(b.grades);
      var overall = overallFrom(grades);
      var r = await pgPool.query(
        `UPDATE supplier_evaluations SET grades=$2, overall=$3, comments = comments || $4::jsonb,
           reviewed_by = COALESCE(NULLIF($5,''), reviewed_by), review_type = COALESCE(NULLIF($6,''), review_type),
           graded_at = CASE WHEN $3 = '' THEN NULL ELSE NOW() END, graded_by = CASE WHEN $3 = '' THEN NULL ELSE $7 END
         WHERE id=$1 RETURNING *`,
        [req.params.id, grades, overall, JSON.stringify(reviewerComments(b.comments)), str(b.reviewed_by, 120),
         b.review_type ? oneOf(b.review_type, REVIEW_TYPES, '') : '', actor(req)]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Evaluation not found' });
      if (overall) await applyOverall(r.rows[0].supplier_id, overall);
      logAuditEvent(req, 'SUPPLIER_EVALUATION_GRADED', 'supplier', r.rows[0].supplier_id, '', { evaluation_id: req.params.id, overall: overall });
      res.json({ ok: true, evaluation: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/supplier-evaluations/:id', requireLogin, requireRole('director'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Evaluation not found' });
      var r = await pgPool.query('DELETE FROM supplier_evaluations WHERE id = $1 RETURNING supplier_id', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Evaluation not found' });
      logAuditEvent(req, 'SUPPLIER_EVALUATION_DELETED', 'supplier', r.rows[0].supplier_id, '', { evaluation_id: req.params.id });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Reviewer notes live under "<section>_reviewer" so they never overwrite supplier comments.
  function reviewerComments(raw) {
    var out = {};
    SECTION_KEYS.forEach(function (k) {
      if (raw && raw[k + '_reviewer'] != null) out[k + '_reviewer'] = str(raw[k + '_reviewer'], 2000);
    });
    return out;
  }

  function headerFrom(supplier, raw) {
    raw = raw || {};
    return {
      supplier_name: str(raw.supplier_name, 200) || supplier.name,
      services: str(raw.services, 1000) || supplier.services,
      contract_number: str(raw.contract_number, 100) || supplier.contract_number,
      contact_number: str(raw.contact_number, 50) || supplier.contact_phone,
      completed_by: str(raw.completed_by, 200),
      completed_by_position: str(raw.completed_by_position, 200),
    };
  }

  async function applyOverall(supplierId, overall) {
    var t = today();
    await pgPool.query(
      'UPDATE suppliers SET status=$2, review_date=$3, next_review_due=$4, updated_at=NOW() WHERE id=$1',
      [supplierId, STATUS_FROM_OVERALL[overall], t, plusMonths(t, 12)]);
  }

  app.post('/api/suppliers/:id/documents', requireLogin, requirePermission('suppliers'), async function (req, res) {
    if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Supplier not found' });
    var s = await pgPool.query('SELECT name FROM suppliers WHERE id = $1', [req.params.id]).catch(function () { return { rows: [] }; });
    if (!s.rows.length) return res.status(404).json({ ok: false, error: 'Supplier not found' });
    var section = oneOf(req.headers['x-doc-section'], SECTION_KEYS.map(function (k) { return k.toLowerCase(); }).concat(['general']), 'general');
    readUpload(req, res, async function (filename, originalName, size) {
      try {
        var r = await pgPool.query(
          `INSERT INTO supplier_documents (supplier_id, section, filename, original_name, size_bytes, uploaded_via)
           VALUES ($1,$2,$3,$4,$5,'internal') RETURNING id, evaluation_id, section, original_name, size_bytes, uploaded_via, created_at`,
          [req.params.id, section.toUpperCase() === 'GENERAL' ? 'general' : section.toUpperCase(), filename, originalName, size]);
        logAuditEvent(req, 'SUPPLIER_DOCUMENT_UPLOADED', 'supplier', req.params.id, s.rows[0].name, { file: originalName });
        res.json({ ok: true, document: r.rows[0] });
      } catch (e) { removeFile(filename); res.status(500).json({ ok: false, error: e.message }); }
    });
  });

  app.get('/api/supplier-documents/:id', requireLogin, requirePermission('suppliers'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).end();
      var r = await pgPool.query('SELECT filename, original_name FROM supplier_documents WHERE id = $1', [req.params.id]);
      if (!r.rows.length) return res.status(404).end();
      sendDoc(res, r.rows[0].filename, r.rows[0].original_name);
    } catch (e) { res.status(500).end(); }
  });

  app.delete('/api/supplier-documents/:id', requireLogin, requireRole('director'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Document not found' });
      var r = await pgPool.query('DELETE FROM supplier_documents WHERE id = $1 RETURNING supplier_id, filename, original_name', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Document not found' });
      removeFile(r.rows[0].filename);
      logAuditEvent(req, 'SUPPLIER_DOCUMENT_DELETED', 'supplier', r.rows[0].supplier_id, '', { file: r.rows[0].original_name });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══ PUBLIC SUPPLIER EVALUATION LINK ═══════════════════════════════════════

  async function loadLink(token) {
    if (!TOKEN_RE.test(String(token || ''))) return null;
    var r = await pgPool.query(
      `SELECT l.*, s.name, s.services, s.contract_number, s.contact_phone
       FROM supplier_eval_links l JOIN suppliers s ON s.id = l.supplier_id WHERE l.token = $1`, [token]);
    return r.rows[0] || null;
  }
  function linkState(l) {
    if (!l) return 'invalid';
    if (l.used_at) return 'submitted';
    if (new Date(l.expires_at) < new Date()) return 'expired';
    return 'open';
  }

  app.get('/api/public/supplier-evaluation/:token', publicLimiter, async function (req, res) {
    try {
      var l = await loadLink(req.params.token);
      var state = linkState(l);
      if (state === 'invalid') return res.status(404).json({ ok: false, error: 'This link is not valid.' });
      var docs = state === 'open'
        ? (await pgPool.query('SELECT id, section, original_name, size_bytes FROM supplier_documents WHERE link_token = $1 ORDER BY created_at', [req.params.token])).rows
        : [];
      res.json({
        ok: true, state: state, expires_at: l.expires_at,
        supplier: { name: l.name, services: l.services, contract_number: l.contract_number, contact_number: l.contact_phone },
        review_type: l.review_type, reviewed_by: l.reviewed_by,
        sections: SECTIONS, documents: docs,
      });
    } catch (e) { res.status(500).json({ ok: false, error: 'Something went wrong. Please try again.' }); }
  });

  app.post('/api/public/supplier-evaluation/:token/documents', publicLimiter, async function (req, res) {
    try {
      var l = await loadLink(req.params.token);
      if (linkState(l) !== 'open') return res.status(410).json({ ok: false, error: 'This link is no longer accepting uploads.' });
      var count = await pgPool.query('SELECT COUNT(*)::int AS n FROM supplier_documents WHERE link_token = $1', [req.params.token]);
      if (count.rows[0].n >= MAX_PUBLIC_UPLOADS) return res.status(400).json({ ok: false, error: 'Upload limit reached for this form.' });
      var section = oneOf(req.headers['x-doc-section'], SECTION_KEYS.map(function (k) { return k.toLowerCase(); }), 'a').toUpperCase();
      readUpload(req, res, async function (filename, originalName, size) {
        try {
          var r = await pgPool.query(
            `INSERT INTO supplier_documents (supplier_id, link_token, section, filename, original_name, size_bytes, uploaded_via)
             VALUES ($1,$2,$3,$4,$5,$6,'supplier') RETURNING id, section, original_name, size_bytes`,
            [l.supplier_id, req.params.token, section, filename, originalName, size]);
          res.json({ ok: true, document: r.rows[0] });
        } catch (e) { removeFile(filename); res.status(500).json({ ok: false, error: 'Upload failed. Please try again.' }); }
      });
    } catch (e) { res.status(500).json({ ok: false, error: 'Upload failed. Please try again.' }); }
  });

  app.delete('/api/public/supplier-evaluation/:token/documents/:docId', publicLimiter, async function (req, res) {
    try {
      var l = await loadLink(req.params.token);
      if (linkState(l) !== 'open' || !isUuid(req.params.docId)) return res.status(404).json({ ok: false, error: 'Not found' });
      var r = await pgPool.query(
        'DELETE FROM supplier_documents WHERE id = $1 AND link_token = $2 AND evaluation_id IS NULL RETURNING filename',
        [req.params.docId, req.params.token]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
      removeFile(r.rows[0].filename);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: 'Something went wrong.' }); }
  });

  app.post('/api/public/supplier-evaluation/:token', publicLimiter, async function (req, res) {
    var client;
    try {
      var l = await loadLink(req.params.token);
      var state = linkState(l);
      if (state === 'invalid') return res.status(404).json({ ok: false, error: 'This link is not valid.' });
      if (state !== 'open') return res.status(410).json({ ok: false, error: state === 'submitted' ? 'This form has already been submitted.' : 'This link has expired.' });
      var b = req.body || {};
      var answers = cleanAnswers(b.answers);
      if (!answersComplete(answers)) return res.status(400).json({ ok: false, error: 'Please answer every question with Yes or No.' });
      var header = headerFrom({ name: l.name, services: l.services, contract_number: l.contract_number, contact_phone: l.contact_phone }, b.header);
      if (!header.completed_by) return res.status(400).json({ ok: false, error: 'Please enter the name of the person completing this form.' });

      client = await pgPool.connect();
      await client.query('BEGIN');
      // Claim the link atomically so a double-submit can't create two evaluations.
      var claim = await client.query('UPDATE supplier_eval_links SET used_at = NOW() WHERE token = $1 AND used_at IS NULL RETURNING token', [req.params.token]);
      if (!claim.rows.length) { await client.query('ROLLBACK'); return res.status(410).json({ ok: false, error: 'This form has already been submitted.' }); }
      var ev = await client.query(
        `INSERT INTO supplier_evaluations (supplier_id, header, answers, comments, reviewed_by, review_type, submitted_via)
         VALUES ($1,$2,$3,$4,$5,$6,'supplier') RETURNING id`,
        [l.supplier_id, header, answers, cleanComments(b.comments), l.reviewed_by, l.review_type]);
      var evalId = ev.rows[0].id;
      await client.query('UPDATE supplier_eval_links SET evaluation_id = $2 WHERE token = $1', [req.params.token, evalId]);
      await client.query('UPDATE supplier_documents SET evaluation_id = $2 WHERE link_token = $1', [req.params.token, evalId]);
      await client.query("UPDATE suppliers SET status = 'under_review', updated_at = NOW() WHERE id = $1 AND status = 'pending'", [l.supplier_id]);
      await client.query('COMMIT');

      createNotification({
        type: 'supplier_evaluation', actorName: l.name,
        summary: l.name + ' submitted their supplier evaluation form — ready to grade',
      });
      res.json({ ok: true });
    } catch (e) {
      if (client) { try { await client.query('ROLLBACK'); } catch (_) {} }
      res.status(500).json({ ok: false, error: 'Could not submit the form. Please try again.' });
    } finally {
      if (client) client.release();
    }
  });

  // ═══ PURCHASE ORDERS ═══════════════════════════════════════════════════════

  function cleanItems(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.slice(0, 100).map(function (it) {
      var qty = num(it && it.qty, 1e6), unit = num(it && it.unit_price, 1e8);
      return { item: str(it && it.item, 300), qty: qty, unit_price: unit, line_total: Math.round(qty * unit * 100) / 100 };
    }).filter(function (it) { return it.item; });
  }
  function itemsTotal(items) {
    return Math.round(items.reduce(function (a, it) { return a + it.line_total; }, 0) * 100) / 100;
  }

  async function nextPoNumber(client) {
    var year = new Date().getFullYear();
    var prefix = 'PO-' + year + '-';
    var r = await client.query(
      "SELECT COALESCE(MAX(CAST(SUBSTRING(po_number FROM $2::int) AS INTEGER)), 0) AS n FROM purchase_orders WHERE po_number ~ $1",
      ['^' + prefix + '[0-9]+$', prefix.length + 1]);
    return prefix + String(r.rows[0].n + 1).padStart(4, '0');
  }

  async function poFields(b) {
    var items = cleanItems(b.items);
    var supplierId = isUuid(b.supplier_id) ? b.supplier_id : null;
    var supplierName = str(b.supplier_name, 200);
    if (supplierId) {
      var s = await pgPool.query('SELECT name FROM suppliers WHERE id = $1', [supplierId]);
      if (!s.rows.length) supplierId = null; else supplierName = s.rows[0].name;
    }
    return {
      request_date: dateOrNull(b.request_date) || today(), requested_by: str(b.requested_by, 200),
      supplier_id: supplierId, supplier_name: supplierName, description: str(b.description, 2000),
      items: items, total: items.length ? itemsTotal(items) : num(b.total, 1e10), notes: str(b.notes, 4000),
    };
  }

  app.get('/api/purchase-orders', requireLogin, requirePermission('purchase_orders'), async function (req, res) {
    try {
      var r = await pgPool.query(
        `SELECT p.*, s.status AS supplier_status FROM purchase_orders p
         LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.created_at DESC`);
      res.json({ ok: true, purchase_orders: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/purchase-orders', requireLogin, requirePermission('purchase_orders'), async function (req, res) {
    try {
      var f = await poFields(req.body || {});
      if (!f.description && !f.items.length) return res.status(400).json({ ok: false, error: 'Add a description or at least one item.' });
      if (!f.requested_by) f.requested_by = actor(req);
      // Retry on the (rare) race where two POs grab the same number.
      for (var attempt = 0; attempt < 3; attempt++) {
        var poNumber = await nextPoNumber(pgPool);
        try {
          var r = await pgPool.query(
            `INSERT INTO purchase_orders (po_number, request_date, requested_by, supplier_id, supplier_name, description, items, total, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [poNumber, f.request_date, f.requested_by, f.supplier_id, f.supplier_name, f.description, JSON.stringify(f.items), f.total, f.notes, actor(req)]);
          logAuditEvent(req, 'PO_CREATED', 'purchase_order', r.rows[0].id, poNumber, { total: f.total });
          return res.json({ ok: true, purchase_order: r.rows[0] });
        } catch (e) {
          if (e.code !== '23505') throw e;
        }
      }
      res.status(500).json({ ok: false, error: 'Could not allocate a PO number. Please try again.' });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.patch('/api/purchase-orders/:id', requireLogin, requirePermission('purchase_orders'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Purchase order not found' });
      var cur = await pgPool.query('SELECT status, po_number FROM purchase_orders WHERE id = $1', [req.params.id]);
      if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'Purchase order not found' });
      var f = await poFields(req.body || {});
      if (!f.description && !f.items.length) return res.status(400).json({ ok: false, error: 'Add a description or at least one item.' });
      // Editing the money after approval would bypass sign-off — send it back for re-approval.
      var status = cur.rows[0].status;
      var resetApproval = status !== 'requested' && status !== 'rejected';
      var r = await pgPool.query(
        `UPDATE purchase_orders SET request_date=$2, requested_by=$3, supplier_id=$4, supplier_name=$5, description=$6, items=$7, total=$8, notes=$9,
           status = CASE WHEN $10 THEN 'requested' ELSE status END,
           approved_by = CASE WHEN $10 THEN NULL ELSE approved_by END,
           approved_at = CASE WHEN $10 THEN NULL ELSE approved_at END,
           updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [req.params.id, f.request_date, f.requested_by || actor(req), f.supplier_id, f.supplier_name, f.description, JSON.stringify(f.items), f.total, f.notes, resetApproval && status !== 'paid']);
      logAuditEvent(req, 'PO_UPDATED', 'purchase_order', req.params.id, cur.rows[0].po_number, { total: f.total, approval_reset: resetApproval && status !== 'paid' });
      res.json({ ok: true, purchase_order: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/purchase-orders/:id/decision', requireLogin, requirePermission('approve_purchase_orders'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Purchase order not found' });
      var decision = oneOf(req.body && req.body.decision, ['approved', 'rejected'], '');
      if (!decision) return res.status(400).json({ ok: false, error: 'Decision must be approved or rejected.' });
      var reason = str(req.body && req.body.reason, 1000);
      if (decision === 'rejected' && !reason) return res.status(400).json({ ok: false, error: 'Give a reason for rejecting.' });
      var r = await pgPool.query(
        `UPDATE purchase_orders SET status=$2, approved_by=$3, approved_at=NOW(), rejected_reason=$4, updated_at=NOW()
         WHERE id=$1 AND status='requested' RETURNING *`,
        [req.params.id, decision, actor(req), decision === 'rejected' ? reason : '']);
      if (!r.rows.length) return res.status(409).json({ ok: false, error: 'Only requested purchase orders can be approved or rejected.' });
      logAuditEvent(req, decision === 'approved' ? 'PO_APPROVED' : 'PO_REJECTED', 'purchase_order', req.params.id, r.rows[0].po_number, { reason: reason });
      res.json({ ok: true, purchase_order: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/purchase-orders/:id/advance', requireLogin, requirePermission('purchase_orders'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Purchase order not found' });
      var cur = await pgPool.query('SELECT status FROM purchase_orders WHERE id = $1', [req.params.id]);
      if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'Purchase order not found' });
      var from = cur.rows[0].status;
      if (from === 'rejected') {
        var re = await pgPool.query(
          "UPDATE purchase_orders SET status='requested', approved_by=NULL, approved_at=NULL, rejected_reason='', updated_at=NOW() WHERE id=$1 AND status='rejected' RETURNING *",
          [req.params.id]);
        logAuditEvent(req, 'PO_RESUBMITTED', 'purchase_order', req.params.id, re.rows[0].po_number, {});
        return res.json({ ok: true, purchase_order: re.rows[0] });
      }
      var to = PO_NEXT[from];
      if (!to) return res.status(409).json({ ok: false, error: from === 'requested' ? 'This purchase order needs approval first.' : 'Nothing further to do.' });
      var r = await pgPool.query('UPDATE purchase_orders SET status=$3, updated_at=NOW() WHERE id=$1 AND status=$2 RETURNING *', [req.params.id, from, to]);
      if (!r.rows.length) return res.status(409).json({ ok: false, error: 'Status changed — refresh and try again.' });
      logAuditEvent(req, 'PO_STATUS_CHANGED', 'purchase_order', req.params.id, r.rows[0].po_number, { from: from, to: to });
      res.json({ ok: true, purchase_order: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/purchase-orders/:id', requireLogin, requireRole('director'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Purchase order not found' });
      var r = await pgPool.query('DELETE FROM purchase_orders WHERE id = $1 RETURNING po_number, attachment_filename, total', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Purchase order not found' });
      removeFile(r.rows[0].attachment_filename);
      logAuditEvent(req, 'PO_DELETED', 'purchase_order', req.params.id, r.rows[0].po_number, { total: r.rows[0].total });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/purchase-orders/:id/attachment', requireLogin, requirePermission('purchase_orders'), async function (req, res) {
    if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Purchase order not found' });
    var cur = await pgPool.query('SELECT po_number, attachment_filename FROM purchase_orders WHERE id = $1', [req.params.id]).catch(function () { return { rows: [] }; });
    if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'Purchase order not found' });
    readUpload(req, res, async function (filename, originalName) {
      try {
        var r = await pgPool.query(
          'UPDATE purchase_orders SET attachment_filename=$2, attachment_name=$3, updated_at=NOW() WHERE id=$1 RETURNING *',
          [req.params.id, filename, originalName]);
        removeFile(cur.rows[0].attachment_filename);
        logAuditEvent(req, 'PO_ATTACHMENT_UPLOADED', 'purchase_order', req.params.id, cur.rows[0].po_number, { file: originalName });
        res.json({ ok: true, purchase_order: r.rows[0] });
      } catch (e) { removeFile(filename); res.status(500).json({ ok: false, error: e.message }); }
    });
  });

  app.get('/api/purchase-orders/:id/attachment', requireLogin, requirePermission('purchase_orders'), async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).end();
      var r = await pgPool.query('SELECT attachment_filename, attachment_name FROM purchase_orders WHERE id = $1', [req.params.id]);
      if (!r.rows.length || !r.rows[0].attachment_filename) return res.status(404).end();
      sendDoc(res, r.rows[0].attachment_filename, r.rows[0].attachment_name || 'attachment');
    } catch (e) { res.status(500).end(); }
  });
};
