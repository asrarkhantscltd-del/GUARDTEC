// Sites: CRUD, site documents, assigned staff and welfare items.
//
// Registered from server.js: require('./routes/sites')(deps)

var AdmZip = require('adm-zip');
var crypto = require('crypto');
var { execFile } = require('child_process');
var fs = require('fs');
var path = require('path');

module.exports = function registerSitesRoutes(deps) {
  var BASE = deps.BASE,
    RECYCLE_DIR = deps.RECYCLE_DIR,
    SITE_DOCS_DIR = deps.SITE_DOCS_DIR,
    app = deps.app,
    ensureSiteDocsDir = deps.ensureSiteDocsDir,
    getSiteById = deps.getSiteById,
    loadAllStaff = deps.loadAllStaff,
    loadSites = deps.loadSites,
    logAuditEvent = deps.logAuditEvent,
    moveFileSafe = deps.moveFileSafe,
    pgPool = deps.pgPool,
    requireLogin = deps.requireLogin,
    requirePermission = deps.requirePermission,
    sendSiteDocFile = deps.sendSiteDocFile;

  // ── DEPLOYMENT SITES CRUD ─────────────────────────────────────────────────────
  app.get('/api/sites', requireLogin, async function(req, res) {
    try {
      res.json({ sites: await loadSites() });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/sites', requireLogin, requirePermission('sites'), async function(req, res) {
    try {
      var name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ ok: false, error: 'Site name required' });
      var dupe = await pgPool.query('SELECT 1 FROM sites WHERE LOWER(name) = LOWER($1)', [name]);
      if (dupe.rows.length) return res.status(409).json({ ok: false, error: 'Site already exists' });

      var site = {
        id: Date.now().toString(),
        name: name,
        type: String(req.body.type || 'other').trim(),
        client_name: String(req.body.client_name || '').trim(),
        client_phone: String(req.body.client_phone || '').trim(),
        client_email: String(req.body.client_email || '').trim(),
        address: String(req.body.address || '').trim(),
        supervisor_name: String(req.body.supervisor_name || '').trim(),
        supervisor_phone: String(req.body.supervisor_phone || '').trim(),
        supervisor_email: String(req.body.supervisor_email || '').trim(),
        status: String(req.body.status || 'active').trim(),
        notes: String(req.body.notes || '').trim(),
      };
      await pgPool.query(
        `INSERT INTO sites (id, name, type, client_name, client_phone, client_email, address,
                          supervisor_name, supervisor_phone, supervisor_email, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [site.id, site.name, site.type, site.client_name, site.client_phone, site.client_email,
         site.address, site.supervisor_name, site.supervisor_phone, site.supervisor_email, site.status, site.notes]
      );
      site.welfare_items = [];
      site.assigned_staff = [];
      logAuditEvent(req, 'SITE_CREATED', 'site', site.id, site.name, {});
      res.json({ ok: true, site: site });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/sites/:id', requireLogin, requirePermission('sites'), async function(req, res) {
    try {
      var o = await getSiteById(req.params.id);
      if (!o) return res.status(404).json({ ok: false, error: 'Site not found' });
      var b = req.body;
      var updated = {
        name:             String(b.name             !== undefined ? b.name             : o.name             || '').trim(),
        type:             String(b.type             !== undefined ? b.type             : o.type             || 'other').trim(),
        client_name:      String(b.client_name      !== undefined ? b.client_name      : o.client_name      || '').trim(),
        client_phone:     String(b.client_phone     !== undefined ? b.client_phone     : o.client_phone     || '').trim(),
        client_email:     String(b.client_email     !== undefined ? b.client_email     : o.client_email     || '').trim(),
        address:          String(b.address          !== undefined ? b.address          : o.address          || '').trim(),
        supervisor_name:  String(b.supervisor_name  !== undefined ? b.supervisor_name  : o.supervisor_name  || '').trim(),
        supervisor_phone: String(b.supervisor_phone !== undefined ? b.supervisor_phone : o.supervisor_phone || '').trim(),
        supervisor_email: String(b.supervisor_email !== undefined ? b.supervisor_email : o.supervisor_email || '').trim(),
        status:           String(b.status           !== undefined ? b.status           : o.status           || 'active').trim(),
        notes:            String(b.notes            !== undefined ? b.notes            : o.notes            || '').trim(),
      };
      await pgPool.query(
        `UPDATE sites SET name=$1, type=$2, client_name=$3, client_phone=$4, client_email=$5, address=$6,
              supervisor_name=$7, supervisor_phone=$8, supervisor_email=$9, status=$10, notes=$11, updated_at=NOW()
       WHERE id=$12`,
        [updated.name, updated.type, updated.client_name, updated.client_phone, updated.client_email, updated.address,
         updated.supervisor_name, updated.supervisor_phone, updated.supervisor_email, updated.status, updated.notes, req.params.id]
      );
      logAuditEvent(req, 'SITE_UPDATED', 'site', req.params.id, updated.name, {});
      res.json({ ok: true, site: await getSiteById(req.params.id) });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete('/api/sites/:id', requireLogin, requirePermission('delete_sites'), async function(req, res) {
    try {
      // ON DELETE CASCADE on site_documents/site_welfare_items/site_staff_assignments
      // handles those DB-side child rows automatically, but agency_deployments
      // and event_instructions are deliberately NOT cascaded (see their FK
      // definitions above) — a deployment is a real booking record and an
      // instruction can carry signed acknowledgment_forms, which is compliance
      // proof. Rather than let the DELETE fail with a raw FK-violation error,
      // check for them up front and explain exactly what's blocking, the same
      // way the incident-report and event-instruction delete routes do.
      var blockers = await pgPool.query(
        `SELECT (SELECT COUNT(*)::int FROM agency_deployments WHERE site_id = $1) AS deployments,
              (SELECT COUNT(*)::int FROM event_instructions WHERE site_id = $1) AS instructions`,
        [req.params.id]
      );
      var b = blockers.rows[0];
      if (b.deployments > 0 || b.instructions > 0) {
        var parts = [];
        if (b.deployments > 0) parts.push(b.deployments + ' deployment(s)');
        if (b.instructions > 0) parts.push(b.instructions + ' assignment instruction(s)');
        return res.status(400).json({
          ok: false,
          error: 'Cannot delete this site — ' + parts.join(' and ') + ' still reference it. Delete or reassign those first (an assignment instruction with signed acknowledgments must be archived, not deleted, to keep the compliance record).'
        });
      }

      // Deleting a site used to wipe its whole documents folder for good. Move each
      // document into the Recycle Bin first (so a Director can still preview or
      // permanently delete them; they can only be RESTORED while their site exists).
      var siteBeingDeleted = await getSiteById(req.params.id);
      var siteDocRows = (await pgPool.query('SELECT filename FROM site_documents WHERE site_id = $1', [req.params.id])).rows;
      for (var di = 0; di < siteDocRows.length; di++) {
        await recycleSiteDocument(req.user, req.params.id, siteDocRows[di].filename, siteBeingDeleted ? siteBeingDeleted.name : null);
      }
      await pgPool.query('DELETE FROM sites WHERE id = $1', [req.params.id]);
      var docsDir = path.join(SITE_DOCS_DIR, req.params.id);
      if (fs.existsSync(docsDir)) {
        try { fs.rmSync(docsDir, { recursive: true, force: true }); } catch (e) {}
      }
      logAuditEvent(req, 'SITE_DELETED', 'site', req.params.id, null, {});
      res.json({ ok: true });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Moves one site document into the bin. Returns its display name, or null if
  // there was nothing to move. If the DB step fails the file is put back, so a
  // failed delete never loses the document.
  async function recycleSiteDocument(actor, siteId, filename, knownSiteName) {
    var filePath = path.join(SITE_DOCS_DIR, siteId, filename);
    var row = (await pgPool.query('SELECT * FROM site_documents WHERE site_id = $1 AND filename = $2', [siteId, filename])).rows[0];
    var fileExists = fs.existsSync(filePath);
    if (!row && !fileExists) return null;

    var siteName = knownSiteName;
    if (!siteName) {
      var s = await getSiteById(siteId);
      siteName = s ? s.name : null;
    }
    var binName = crypto.randomUUID() + '-' + filename;
    var binPath = path.join(RECYCLE_DIR, binName);
    fs.mkdirSync(RECYCLE_DIR, { recursive: true });
    if (fileExists) moveFileSafe(filePath, binPath);

    var client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO recycle_bin (kind, site_id, site_name, original_filename, original_name, category, size_bytes, uploaded_at, bin_filename, deleted_by)
       VALUES ('site_document',$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [siteId, siteName, filename, row ? row.original_name : filename, row ? row.category : null,
         row ? row.size_bytes : (fileExists ? fs.statSync(binPath).size : null), row ? row.uploaded_at : null,
         binName, (actor && (actor.username || actor.full_name)) || null]
      );
      await client.query('DELETE FROM site_documents WHERE site_id = $1 AND filename = $2', [siteId, filename]);
      await client.query('COMMIT');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (e2) {}
      if (fileExists) { try { moveFileSafe(binPath, filePath); } catch (e3) { console.error('[RECYCLE] could not put file back:', e3.message); } }
      throw e;
    } finally {
      client.release();
    }
    return row ? row.original_name : filename;
  }

  function docRowToItem(row) {
    return { filename: row.filename, originalName: row.original_name, category: row.category, size: row.size_bytes, uploadedAt: row.uploaded_at };
  }

  app.get('/api/sites/:id/documents', requireLogin, requirePermission('sites'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT * FROM site_documents WHERE site_id = $1 ORDER BY uploaded_at', [path.basename(req.params.id)]);
      res.json({ ok: true, items: r.rows.map(docRowToItem) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/sites/:id/documents', requireLogin, requirePermission('sites'), async function(req, res) {
    try {
      var siteId = path.basename(req.params.id);
      var site = await getSiteById(siteId);
      if (!site) return res.status(404).json({ ok: false, error: 'Site not found' });

      ensureSiteDocsDir(siteId);
      var originalName = 'document';
      try { originalName = decodeURIComponent(req.headers['x-filename'] || 'document'); } catch (e) {}
      var category = req.headers['x-doc-category'] || 'documentation';
      var timestamp = Date.now().toString();
      var ext = path.extname(originalName) || '';
      var filename = timestamp + ext;
      var filePath = path.join(SITE_DOCS_DIR, siteId, filename);

      var chunks = [];
      req.on('data', function(c) { chunks.push(c); });
      req.on('end', async function() {
        try {
          var buf = Buffer.concat(chunks);
          fs.writeFileSync(filePath, buf);

          var r = await pgPool.query(
            'INSERT INTO site_documents (site_id, filename, original_name, category, size_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
            [siteId, filename, originalName, category, buf.length]
          );
          res.json({ ok: true, doc: docRowToItem(r.rows[0]) });
        } catch (e) {
          res.status(500).json({ ok: false, error: e.message });
        }
      });
      req.on('error', function(e) {
        res.status(500).json({ ok: false, error: e.message });
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/sites/:id/documents/:filename', requireLogin, requirePermission('sites'), async function(req, res) {
    try {
      var siteId = path.basename(req.params.id);
      var filename = path.basename(req.params.filename);
      var filePath = path.join(SITE_DOCS_DIR, siteId, filename);
      if (!fs.existsSync(filePath)) return res.status(404).end();

      var r = await pgPool.query('SELECT original_name FROM site_documents WHERE site_id = $1 AND filename = $2', [siteId, filename]);
      var originalName = r.rows.length ? r.rows[0].original_name : filename;
      // Downloads are logged (who took which file); inline views are not — image thumbnails
      // would otherwise write an audit row per tile.
      var served = sendSiteDocFile(res, filePath, filename, originalName);
      // Thumbnails ask with ?thumb=1 and aren't logged; a real open (click/View) is.
      if (served) logAuditEvent(req, 'SITE_DOCUMENT_DOWNLOADED', 'site_document', filename, originalName, { site_id: siteId });
      else if (req.query.thumb !== '1') logAuditEvent(req, 'SITE_DOCUMENT_VIEWED', 'site_document', filename, originalName, { site_id: siteId });
    } catch (e) {
      res.status(500).end();
    }
  });

  // Thumbnail for the Explorer-style tiles — the same sources Windows uses:
  //  • Office files (.pptx/.docx/.xlsx) carry a ready-made preview inside the zip
  //    (docProps/thumbnail.jpeg), written by Office when the file is saved;
  //  • PDFs get their first page rendered (poppler's pdftoppm, installed in the image).
  // Anything else, or a file with no embedded preview, answers 404 and the page
  // falls back to the plain file-type icon.
  var THUMB_OFFICE_EXTS = ['.pptx', '.docx', '.xlsx'];
  var THUMB_MAX_BYTES = 2 * 1024 * 1024; // refuse to unpack anything bigger than this (zip-bomb guard)
  app.get('/api/sites/:id/documents/:filename/thumbnail', requireLogin, requirePermission('sites'), async function(req, res) {
    var tmpDir = null;
    try {
      var siteId = path.basename(req.params.id);
      var filename = path.basename(req.params.filename);
      var filePath = path.join(SITE_DOCS_DIR, siteId, filename);
      if (!fs.existsSync(filePath)) return res.status(404).end();
      var ext = path.extname(filename).toLowerCase();
      var buf = null, type = 'image/jpeg';

      if (THUMB_OFFICE_EXTS.indexOf(ext) !== -1) {
        var zip = new AdmZip(filePath);
        var entry = zip.getEntry('docProps/thumbnail.jpeg') || zip.getEntry('docProps/thumbnail.jpg') || zip.getEntry('docProps/thumbnail.png');
        if (!entry || entry.header.size > THUMB_MAX_BYTES) return res.status(404).end();
        buf = entry.getData();
        type = /.png$/i.test(entry.entryName) ? 'image/png' : 'image/jpeg';
      } else if (ext === '.pdf') {
        tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gt-thumb-'));
        var outBase = path.join(tmpDir, 'p');
        await new Promise(function(resolve, reject) {
          execFile('pdftoppm', ['-f', '1', '-l', '1', '-jpeg', '-scale-to', '400', '-singlefile', filePath, outBase],
            { timeout: 10000 }, function(err) { err ? reject(err) : resolve(); });
        });
        buf = fs.readFileSync(outBase + '.jpg');
      } else {
        return res.status(404).end();
      }

      res.setHeader('Content-Type', type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.send(buf);
    } catch (e) {
      res.status(404).end(); // unreadable/odd file → just show the icon
    } finally {
      if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} }
    }
  });

  // "Delete" now means "move to the Recycle Bin" — recoverable by a Director for 30 days.
  app.delete('/api/sites/:id/documents/:filename', requireLogin, requirePermission('delete_sites'), async function(req, res) {
    try {
      var siteId = path.basename(req.params.id);
      var filename = path.basename(req.params.filename);
      var name = await recycleSiteDocument(req.user, siteId, filename, null);
      if (name !== null) {
        logAuditEvent(req, 'SITE_DOCUMENT_RECYCLED', 'site_document', filename, name, { site_id: siteId });
      }
      res.json({ ok: true, recycled: name !== null });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── SITE STAFF ASSIGNMENT ─────────────────────────────────────────────────────
  app.get('/api/sites/:id/staff', requireLogin, async function(req, res) {
    try {
      var siteCheck = await pgPool.query('SELECT 1 FROM sites WHERE id = $1', [req.params.id]);
      if (!siteCheck.rows.length) return res.status(404).json({ ok: false, error: 'Site not found' });
      var assignedRows = await pgPool.query('SELECT employee_legacy_id FROM site_staff_assignments WHERE site_id = $1 ORDER BY assigned_at', [req.params.id]);
      var assignedIds = assignedRows.rows.map(function(r){ return r.employee_legacy_id; });
      var allStaff = loadAllStaff();
      var assigned = allStaff.filter(function(s){ return assignedIds.indexOf(s.id) !== -1; })
        .map(function(s){ return { id: s.id, name: s.name, overall: s.overall }; });
      res.json({ ok: true, staff: assigned, count: assigned.length });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/sites/:id/staff', requireLogin, requirePermission('sites'), async function(req, res) {
    try {
      var siteCheck = await pgPool.query('SELECT 1 FROM sites WHERE id = $1', [req.params.id]);
      if (!siteCheck.rows.length) return res.status(404).json({ ok: false, error: 'Site not found' });
      var staffId = String(req.body.staff_id || '').trim();
      if (!staffId) return res.status(400).json({ ok: false, error: 'staff_id required' });
      await pgPool.query(
        'INSERT INTO site_staff_assignments (site_id, employee_legacy_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [req.params.id, staffId]
      );
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/sites/:id/staff/:staffId', requireLogin, requirePermission('delete_sites'), async function(req, res) {
    try {
      var siteCheck = await pgPool.query('SELECT 1 FROM sites WHERE id = $1', [req.params.id]);
      if (!siteCheck.rows.length) return res.status(404).json({ ok: false, error: 'Site not found' });
      await pgPool.query('DELETE FROM site_staff_assignments WHERE site_id = $1 AND employee_legacy_id = $2', [req.params.id, req.params.staffId]);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── SITE WELFARE / ASSETS ─────────────────────────────────────────────────────
  function welfareRowToItem(row) {
    return { id: row.id, name: row.name, quantity: row.quantity, condition: row.condition, serial_number: row.serial_number, notes: row.notes, image_ext: row.image_ext };
  }

  app.get('/api/sites/:id/welfare', requireLogin, async function(req, res) {
    try {
      var siteCheck = await pgPool.query('SELECT 1 FROM sites WHERE id = $1', [req.params.id]);
      if (!siteCheck.rows.length) return res.status(404).json({ ok: false, error: 'Site not found' });
      var r = await pgPool.query('SELECT * FROM site_welfare_items WHERE site_id = $1 ORDER BY created_at', [req.params.id]);
      res.json({ ok: true, items: r.rows.map(welfareRowToItem) });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/sites/:id/welfare', requireLogin, requirePermission('sites'), async function(req, res) {
    try {
      var siteCheck = await pgPool.query('SELECT 1 FROM sites WHERE id = $1', [req.params.id]);
      if (!siteCheck.rows.length) return res.status(404).json({ ok: false, error: 'Site not found' });
      var item = {
        id: Date.now().toString(),
        name: String(req.body.name || '').trim(),
        quantity: parseInt(req.body.quantity) || 1,
        condition: String(req.body.condition || 'good').trim(),
        serial_number: String(req.body.serial_number || '').trim(),
        notes: String(req.body.notes || '').trim(),
        image_ext: '',
      };
      if (!item.name) return res.status(400).json({ ok: false, error: 'Item name required' });
      await pgPool.query(
        `INSERT INTO site_welfare_items (id, site_id, name, quantity, condition, serial_number, notes, image_ext)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [item.id, req.params.id, item.name, item.quantity, item.condition, item.serial_number, item.notes, item.image_ext]
      );
      res.json({ ok: true, item: item });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/sites/:id/welfare/:itemId', requireLogin, requirePermission('sites'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT * FROM site_welfare_items WHERE site_id = $1 AND id = $2', [req.params.id, req.params.itemId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Item not found' });
      var b = req.body; var o = r.rows[0];
      var updated = {
        name:          String(b.name          !== undefined ? b.name          : o.name          || '').trim(),
        quantity:      parseInt(b.quantity     !== undefined ? b.quantity      : o.quantity)    || 1,
        condition:     String(b.condition      !== undefined ? b.condition     : o.condition     || 'good').trim(),
        serial_number: String(b.serial_number  !== undefined ? b.serial_number : o.serial_number || '').trim(),
        notes:         String(b.notes          !== undefined ? b.notes         : o.notes         || '').trim(),
      };
      await pgPool.query(
        'UPDATE site_welfare_items SET name=$1, quantity=$2, condition=$3, serial_number=$4, notes=$5 WHERE site_id=$6 AND id=$7',
        [updated.name, updated.quantity, updated.condition, updated.serial_number, updated.notes, req.params.id, req.params.itemId]
      );
      res.json({ ok: true, item: { id: o.id, name: updated.name, quantity: updated.quantity, condition: updated.condition, serial_number: updated.serial_number, notes: updated.notes, image_ext: o.image_ext } });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete('/api/sites/:id/welfare/:itemId', requireLogin, requirePermission('delete_sites'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT image_ext FROM site_welfare_items WHERE site_id = $1 AND id = $2', [req.params.id, req.params.itemId]);
      if (r.rows.length && r.rows[0].image_ext) {
        var imgPath = path.join(BASE, 'site-welfare-images', req.params.id, req.params.itemId + '.' + r.rows[0].image_ext);
        try { fs.unlinkSync(imgPath); } catch(e2) {}
      }
      await pgPool.query('DELETE FROM site_welfare_items WHERE site_id = $1 AND id = $2', [req.params.id, req.params.itemId]);
      res.json({ ok: true });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Welfare item image upload
  app.post('/api/sites/:id/welfare/:itemId/image', requireLogin, requirePermission('sites'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT image_ext FROM site_welfare_items WHERE site_id = $1 AND id = $2', [req.params.id, req.params.itemId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Item not found' });
      var chunks = [];
      req.on('data', function(c){ chunks.push(c); });
      req.on('end', async function() {
        try {
          var buf = Buffer.concat(chunks);
          var ext = 'jpg';
          if (buf[0] === 0x89 && buf[1] === 0x50) ext = 'png';
          var dir = path.join(BASE, 'site-welfare-images', req.params.id);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          // remove old image if different ext
          var oldExt = r.rows[0].image_ext;
          if (oldExt && oldExt !== ext) {
            try { fs.unlinkSync(path.join(dir, req.params.itemId + '.' + oldExt)); } catch(e2) {}
          }
          fs.writeFileSync(path.join(dir, req.params.itemId + '.' + ext), buf);
          await pgPool.query('UPDATE site_welfare_items SET image_ext = $1 WHERE site_id = $2 AND id = $3', [ext, req.params.id, req.params.itemId]);
          res.json({ ok: true, image_ext: ext });
        } catch(e) {
          res.status(500).json({ ok: false, error: e.message });
        }
      });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Welfare item image delete
  app.delete('/api/sites/:id/welfare/:itemId/image', requireLogin, requirePermission('delete_sites'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT image_ext FROM site_welfare_items WHERE site_id = $1 AND id = $2', [req.params.id, req.params.itemId]);
      var ext = r.rows.length ? r.rows[0].image_ext : null;
      if (ext) {
        var imgPath = path.join(BASE, 'site-welfare-images', req.params.id, req.params.itemId + '.' + ext);
        try { fs.unlinkSync(imgPath); } catch(e2) {}
        await pgPool.query("UPDATE site_welfare_items SET image_ext = '' WHERE site_id = $1 AND id = $2", [req.params.id, req.params.itemId]);
      }
      res.json({ ok: true });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Welfare item image serve
  app.get('/api/sites/:id/welfare/:itemId/image', requireLogin, async function(req, res) {
    try {
      var r = await pgPool.query('SELECT image_ext FROM site_welfare_items WHERE site_id = $1 AND id = $2', [req.params.id, req.params.itemId]);
      if (!r.rows.length || !r.rows[0].image_ext) return res.status(404).end();
      var imgPath = path.join(BASE, 'site-welfare-images', req.params.id, req.params.itemId + '.' + r.rows[0].image_ext);
      if (!fs.existsSync(imgPath)) return res.status(404).end();
      var mime = r.rows[0].image_ext === 'png' ? 'image/png' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(imgPath));
    } catch(e) {
      res.status(500).end();
    }
  });
};
