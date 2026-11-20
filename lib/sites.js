// Sites data access, site documents and the Recycle Bin purge.
//
// Loaded from server.js: mount(require('./lib/sites')(deps))

var fs = require('fs');
var path = require('path');

module.exports = function sitesLib(deps) {
  var RECYCLE_DIR = deps.RECYCLE_DIR,
    RECYCLE_RETENTION_DAYS = deps.RECYCLE_RETENTION_DAYS,
    SITE_DOCS_DIR = deps.SITE_DOCS_DIR,
    pgPool = deps.pgPool;

  // ── DEPLOYMENT SITES ──────────────────────────────────────────────────────────
  // Postgres-backed (see ensureSitesSchema above). welfare_items/assigned_staff
  // are reconstructed via LEFT JOIN so every route's response shape stays
  // byte-identical to the old deployment-sites.json era — SitesPage.tsx reads
  // site.welfare_items?.length / site.assigned_staff?.length directly off the
  // list response, so those arrays must stay embedded, not dropped.
  var SITE_JOIN_SQL =
    "SELECT s.*, " +
    "  COALESCE(w.items, '[]'::json) AS welfare_items, " +
    "  COALESCE(a.ids, '[]'::json) AS assigned_staff " +
    "FROM sites s " +
    "LEFT JOIN ( " +
    "  SELECT site_id, json_agg(json_build_object( " +
    "    'id', id, 'name', name, 'quantity', quantity, 'condition', condition, " +
    "    'serial_number', serial_number, 'notes', notes, 'image_ext', image_ext " +
    "  ) ORDER BY created_at) AS items " +
    "  FROM site_welfare_items GROUP BY site_id " +
    ") w ON w.site_id = s.id " +
    "LEFT JOIN ( " +
    "  SELECT site_id, json_agg(employee_legacy_id ORDER BY assigned_at) AS ids " +
    "  FROM site_staff_assignments GROUP BY site_id " +
    ") a ON a.site_id = s.id";

  async function loadSites() {
    var r = await pgPool.query(SITE_JOIN_SQL + " ORDER BY s.created_at");
    return r.rows;
  }
  async function getSiteById(siteId) {
    var r = await pgPool.query(SITE_JOIN_SQL + " WHERE s.id = $1", [siteId]);
    return r.rows[0] || null;
  }

  // ── SITE DOCUMENTATION ─────────────────────────────────────────────────────────
  // Per-site file library: general documentation, presentations, induction packs.
  // Files stay on disk under SITE_DOCS_DIR; site_documents holds only metadata
  // (same split as message_attachments/incident_attachments elsewhere in this file).

  // ── RECYCLE BIN (site documents) ──────────────────────────────────────────────
  // Deleting a site document no longer destroys it: the file moves into RECYCLE_DIR
  // and its metadata moves from site_documents into recycle_bin. Director-only
  // page/routes below can restore it (back into its site) or delete it for good;
  // anything still here after RECYCLE_RETENTION_DAYS is purged automatically.
  (async function ensureRecycleBinSchema() {
    try {
      await pgPool.query(`
      CREATE TABLE IF NOT EXISTS recycle_bin (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind              TEXT NOT NULL DEFAULT 'site_document',
        site_id           TEXT NOT NULL,
        site_name         TEXT,
        original_filename TEXT NOT NULL,
        original_name     TEXT NOT NULL,
        category          TEXT,
        size_bytes        INTEGER,
        uploaded_at       TIMESTAMPTZ,
        bin_filename      TEXT NOT NULL UNIQUE,
        deleted_by        TEXT,
        deleted_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `);
      await pgPool.query("CREATE INDEX IF NOT EXISTS idx_recycle_bin_deleted_at ON recycle_bin(deleted_at)");
    } catch (e) {
      console.error('[DB] recycle_bin schema migration failed:', e.message);
    }
  })();

  // rename() is atomic and instant on one volume; fall back to copy+delete if the
  // bin ever ends up on a different filesystem (EXDEV).
  function moveFileSafe(src, dest) {
    try {
      fs.renameSync(src, dest);
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      fs.copyFileSync(src, dest);
      fs.unlinkSync(src);
    }
  }

  // Permanently removes bin entries (file + row). Used by "Delete forever",
  // "Empty bin" and the 30-day auto-purge, so all three behave identically.
  async function purgeRecycleRows(rows) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) {
      var binPath = path.join(RECYCLE_DIR, path.basename(rows[i].bin_filename));
      try { if (fs.existsSync(binPath)) fs.unlinkSync(binPath); } catch (e) { console.error('[RECYCLE] unlink failed:', e.message); continue; }
      await pgPool.query('DELETE FROM recycle_bin WHERE id = $1', [rows[i].id]);
      n++;
    }
    return n;
  }

  async function purgeExpiredRecycleBin() {
    try {
      var r = await pgPool.query(
        'SELECT id, bin_filename FROM recycle_bin WHERE deleted_at < NOW() - make_interval(days => $1)', [RECYCLE_RETENTION_DAYS]
      );
      if (!r.rows.length) return;
      var n = await purgeRecycleRows(r.rows);
      console.log('[RECYCLE] auto-purged ' + n + ' item(s) older than ' + RECYCLE_RETENTION_DAYS + ' days');
    } catch (e) {
      console.error('[RECYCLE] auto-purge failed:', e.message);
    }
  }

  // File types a browser can show in a tab without running anything — see the
  // GET route below for why everything else is forced to download.
  var SITE_DOC_INLINE_TYPES = {
    '.pdf': 'application/pdf',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.txt': 'text/plain; charset=utf-8',
    '.mp4': 'video/mp4', '.mp3': 'audio/mpeg'
  };

  // Sends a stored document with the right Content-Type/Content-Disposition. Shared by
  // the site-documents route and the Recycle Bin preview so they can't drift apart.
  // extSource = the on-disk name (extension decides inline-vs-download);
  // originalName = what the user uploaded it as (may include a folder path).
  function sendSiteDocFile(res, filePath, extSource, originalName) {
    // Without an explicit Content-Type, res.send(Buffer) defaults to
    // application/octet-stream and every browser downloads instead of showing the
    // file. Only types browsers render safely are served inline; anything else
    // (office files, and especially HTML/SVG/JS, which would run as this app's
    // own origin = stored XSS) is forced to download.
    var inlineType = SITE_DOC_INLINE_TYPES[path.extname(extSource).toLowerCase()];
    // Folder uploads store "Folder/Sub/file.pdf" as the name — download as just file.pdf.
    var shownName = path.basename(String(originalName).replace(/\\/g, '/')) || extSource;
    // Header values must be latin-1: give an ASCII fallback plus an RFC 5987 UTF-8 name,
    // otherwise a file called "Plan – final.pdf" makes res.setHeader throw -> 500.
    var asciiName = shownName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Type', inlineType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition',
      (inlineType ? 'inline' : 'attachment') + '; filename="' + asciiName + '"; filename*=UTF-8\'\'' +
      encodeURIComponent(shownName).replace(/'/g, '%27'));
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(filePath));
    return !inlineType; // true = delivered as a download (not displayed in the browser)
  }

  function ensureSiteDocsDir(siteId) {
    var dir = path.join(SITE_DOCS_DIR, siteId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  return {
    ensureSiteDocsDir: ensureSiteDocsDir,
    getSiteById: getSiteById,
    loadSites: loadSites,
    moveFileSafe: moveFileSafe,
    purgeExpiredRecycleBin: purgeExpiredRecycleBin,
    purgeRecycleRows: purgeRecycleRows,
    sendSiteDocFile: sendSiteDocFile,
  };
};
