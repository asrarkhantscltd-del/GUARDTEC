// Director-only Recycle Bin for binned site documents.
//
// Registered from server.js: require('./routes/recycleBin')(deps)

var fs = require('fs');
var path = require('path');

module.exports = function registerRecycleBinRoutes(deps) {
  var RECYCLE_DIR = deps.RECYCLE_DIR,
    RECYCLE_RETENTION_DAYS = deps.RECYCLE_RETENTION_DAYS,
    SITE_DOCS_DIR = deps.SITE_DOCS_DIR,
    app = deps.app,
    ensureSiteDocsDir = deps.ensureSiteDocsDir,
    getSiteById = deps.getSiteById,
    logAuditEvent = deps.logAuditEvent,
    moveFileSafe = deps.moveFileSafe,
    pgPool = deps.pgPool,
    purgeRecycleRows = deps.purgeRecycleRows,
    requireLogin = deps.requireLogin,
    requireRole = deps.requireRole,
    sendSiteDocFile = deps.sendSiteDocFile;

  // ── RECYCLE BIN routes (Director only) ────────────────────────────────────────
  app.get('/api/recycle-bin', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var r = await pgPool.query(
        `SELECT rb.id, rb.kind, rb.site_id, COALESCE(s.name, rb.site_name) AS site_name, (s.id IS NOT NULL) AS site_exists,
              rb.original_name, rb.category, rb.size_bytes, rb.uploaded_at, rb.deleted_by, rb.deleted_at,
              GREATEST(0, CEIL(EXTRACT(EPOCH FROM (rb.deleted_at + make_interval(days => $1) - NOW())) / 86400))::int AS days_left
       FROM recycle_bin rb LEFT JOIN sites s ON s.id = rb.site_id
       ORDER BY rb.deleted_at DESC`,
        [RECYCLE_RETENTION_DAYS]
      );
      res.json({ ok: true, retentionDays: RECYCLE_RETENTION_DAYS, items: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Preview/download a binned file before deciding to restore it.
  app.get('/api/recycle-bin/:id/file', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT original_filename, original_name, bin_filename FROM recycle_bin WHERE id = $1', [req.params.id]);
      if (!r.rows.length) return res.status(404).end();
      var binPath = path.join(RECYCLE_DIR, path.basename(r.rows[0].bin_filename));
      if (!fs.existsSync(binPath)) return res.status(404).end();
      var served = sendSiteDocFile(res, binPath, r.rows[0].original_filename, r.rows[0].original_name);
      logAuditEvent(req, served ? 'SITE_DOCUMENT_DOWNLOADED' : 'SITE_DOCUMENT_VIEWED', 'site_document', req.params.id, r.rows[0].original_name, { from_recycle_bin: true });
    } catch (e) {
      res.status(500).end();
    }
  });

  app.post('/api/recycle-bin/:id/restore', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT * FROM recycle_bin WHERE id = $1', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Item not found — it may already have been restored or removed.' });
      var item = r.rows[0];

      var site = await getSiteById(item.site_id);
      if (!site) {
        return res.status(409).json({ ok: false, error: 'The site "' + (item.site_name || item.site_id) + '" no longer exists, so this file cannot be restored into it. You can still preview it or delete it permanently.' });
      }
      var binPath = path.join(RECYCLE_DIR, path.basename(item.bin_filename));
      if (!fs.existsSync(binPath)) {
        return res.status(410).json({ ok: false, error: 'The stored file is missing from the Recycle Bin, so it cannot be restored.' });
      }

      ensureSiteDocsDir(item.site_id);
      var filename = item.original_filename;
      // Names are timestamp-based so this is practically never taken, but never overwrite a live file.
      if (fs.existsSync(path.join(SITE_DOCS_DIR, item.site_id, filename))) {
        filename = Date.now().toString() + path.extname(item.original_filename);
      }
      var destPath = path.join(SITE_DOCS_DIR, item.site_id, filename);
      moveFileSafe(binPath, destPath);

      var client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO site_documents (site_id, filename, original_name, category, size_bytes, uploaded_at)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6, NOW()))`,
          [item.site_id, filename, item.original_name, item.category, item.size_bytes, item.uploaded_at]
        );
        await client.query('DELETE FROM recycle_bin WHERE id = $1', [item.id]);
        await client.query('COMMIT');
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch (e2) {}
        try { moveFileSafe(destPath, binPath); } catch (e3) { console.error('[RECYCLE] could not put file back in bin:', e3.message); }
        throw e;
      } finally {
        client.release();
      }
      logAuditEvent(req, 'SITE_DOCUMENT_RESTORED', 'site_document', filename, item.original_name, { site_id: item.site_id });
      res.json({ ok: true, siteName: site.name });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/recycle-bin/empty', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT id, bin_filename FROM recycle_bin');
      var n = await purgeRecycleRows(r.rows);
      logAuditEvent(req, 'RECYCLE_BIN_EMPTIED', 'site_document', null, null, { count: n });
      res.json({ ok: true, deleted: n });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete('/api/recycle-bin/:id', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT id, original_name, site_id, bin_filename FROM recycle_bin WHERE id = $1', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Item not found.' });
      await purgeRecycleRows(r.rows);
      logAuditEvent(req, 'SITE_DOCUMENT_PURGED', 'site_document', req.params.id, r.rows[0].original_name, { site_id: r.rows[0].site_id });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};
