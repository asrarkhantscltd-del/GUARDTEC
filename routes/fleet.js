// Fleet: vehicles, vehicle photos/documents, export and the n8n fleet feed.
//
// Registered from server.js: require('./routes/fleet')(deps)

var fs = require('fs');
var path = require('path');

module.exports = function registerFleetRoutes(deps) {
  var VEHICLE_DOCS_DIR = deps.VEHICLE_DOCS_DIR,
    VEHICLE_JOIN_SQL = deps.VEHICLE_JOIN_SQL,
    VEHICLE_PHOTOS_DIR = deps.VEHICLE_PHOTOS_DIR,
    app = deps.app,
    attachHasPhoto = deps.attachHasPhoto,
    findVehiclePhoto = deps.findVehiclePhoto,
    loadAllStaff = deps.loadAllStaff,
    loadVehicles = deps.loadVehicles,
    logAuditEvent = deps.logAuditEvent,
    pgPool = deps.pgPool,
    requireLogin = deps.requireLogin,
    requirePermission = deps.requirePermission,
    resolveEmpId = deps.resolveEmpId,
    sendXlsx = deps.sendXlsx;

  function ensureVehicleDocsDir(vehicleId) {
    var dir = path.join(VEHICLE_DOCS_DIR, vehicleId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  async function getVehicleById(id) {
    var r = await pgPool.query(VEHICLE_JOIN_SQL + " WHERE v.id = $1", [id]);
    return r.rows.length ? attachHasPhoto(r.rows[0]) : null;
  }

  async function setVehicleComplianceDate(vehicleId, docType, expiryDate) {
    var existing = await pgPool.query(
      'SELECT id FROM vehicle_compliance WHERE vehicle_id = $1 AND document_type = $2 ORDER BY created_at DESC LIMIT 1',
      [vehicleId, docType]
    );
    if (!expiryDate) {
      if (existing.rows.length) await pgPool.query('DELETE FROM vehicle_compliance WHERE id = $1', [existing.rows[0].id]);
      return;
    }
    if (existing.rows.length) {
      await pgPool.query('UPDATE vehicle_compliance SET expiry_date = $1 WHERE id = $2', [expiryDate, existing.rows[0].id]);
    } else {
      await pgPool.query('INSERT INTO vehicle_compliance (vehicle_id, document_type, expiry_date) VALUES ($1,$2,$3)', [vehicleId, docType, expiryDate]);
    }
  }

  var VEHICLE_COMPLIANCE_FIELD_MAP = [['mot_expiry', 'MOT'], ['insurance_expiry', 'INSURANCE'], ['road_tax_expiry', 'ROAD_TAX'], ['service_due', 'SERVICE']];

  async function applyVehicleComplianceFields(vehicleId, b, isCreate) {
    for (var i = 0; i < VEHICLE_COMPLIANCE_FIELD_MAP.length; i++) {
      var key = VEHICLE_COMPLIANCE_FIELD_MAP[i][0], docType = VEHICLE_COMPLIANCE_FIELD_MAP[i][1];
      if (isCreate) {
        if (b[key]) await setVehicleComplianceDate(vehicleId, docType, b[key]);
      } else if (b[key] !== undefined) {
        await setVehicleComplianceDate(vehicleId, docType, b[key] || null);
      }
    }
  }

  // vehicle_assignments models assignment HISTORY (assigned_date/unassigned_date)
  // rather than a flat field — "current driver" is whichever row has no
  // unassigned_date yet. Closing the old row before opening a new one keeps
  // that invariant (at most one open assignment per vehicle) intact.
  async function setVehicleDriver(vehicleId, newLegacyId) {
    var openRow = await pgPool.query(
      "SELECT va.id, e.legacy_id FROM vehicle_assignments va JOIN employees e ON e.id = va.employee_id " +
      "WHERE va.vehicle_id = $1 AND va.unassigned_date IS NULL ORDER BY va.assigned_date DESC LIMIT 1",
      [vehicleId]
    );
    var currentLegacyId = openRow.rows.length ? openRow.rows[0].legacy_id : null;
    if ((newLegacyId || null) === currentLegacyId) return;
    if (openRow.rows.length) {
      await pgPool.query('UPDATE vehicle_assignments SET unassigned_date = CURRENT_DATE WHERE id = $1', [openRow.rows[0].id]);
    }
    if (newLegacyId) {
      var empId = await resolveEmpId(newLegacyId);
      // Silently no-op if the legacy id doesn't resolve to an employees row —
      // mirrors the old system's total lack of validation on this field rather
      // than 500ing an otherwise-valid PATCH over one bad driver id.
      if (empId) {
        await pgPool.query('INSERT INTO vehicle_assignments (vehicle_id, employee_id, is_primary_driver) VALUES ($1,$2,true)', [vehicleId, empId]);
      }
    }
  }

  function vehicleDocRowToItem(row) {
    return { filename: row.filename, originalName: row.original_name, docType: row.doc_type, size: row.size_bytes, uploadedAt: row.uploaded_at };
  }

  app.get('/api/vehicles', requireLogin, requirePermission('fleet'), async function(req, res) {
    try {
      res.json({ vehicles: await loadVehicles() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/vehicles', requireLogin, requirePermission('fleet'), async function(req, res) {
    try {
      var b = req.body || {};
      var registration = String(b.registration || '').trim();
      if (!registration) return res.status(400).json({ ok: false, error: 'Registration is required' });
      var r = await pgPool.query(
        `INSERT INTO vehicles (legacy_id, registration, make, model, vehicle_type, year, colour, status, notes, mileage)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [Date.now().toString(), registration, b.make || null, b.model || null, b.type || 'other',
         b.year || null, b.colour || null, b.status || 'active', b.notes || null, b.mileage || null]
      );
      var vehicleId = r.rows[0].id;
      await applyVehicleComplianceFields(vehicleId, b, true);
      if (b.assignedDriverId) await setVehicleDriver(vehicleId, b.assignedDriverId);
      logAuditEvent(req, 'VEHICLE_CREATED', 'vehicle', vehicleId, registration, {});
      res.json({ ok: true, vehicle: await getVehicleById(vehicleId) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/vehicles/:id', requireLogin, requirePermission('fleet'), async function(req, res) {
    try {
      var existing = await pgPool.query('SELECT id FROM vehicles WHERE id = $1', [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Vehicle not found' });

      var b = req.body || {};
      var colMap = { registration: 'registration', make: 'make', model: 'model', type: 'vehicle_type', year: 'year', colour: 'colour', status: 'status', notes: 'notes', mileage: 'mileage' };
      var sets = []; var params = []; var i = 1;
      Object.keys(colMap).forEach(function(jsonKey) {
        if (b[jsonKey] !== undefined) { sets.push(colMap[jsonKey] + ' = $' + i); params.push(b[jsonKey]); i++; }
      });
      if (sets.length) {
        params.push(req.params.id);
        await pgPool.query('UPDATE vehicles SET ' + sets.join(', ') + ', updated_at = NOW() WHERE id = $' + i, params);
      }
      await applyVehicleComplianceFields(req.params.id, b, false);
      if (b.assignedDriverId !== undefined) await setVehicleDriver(req.params.id, b.assignedDriverId || null);
      logAuditEvent(req, 'VEHICLE_UPDATED', 'vehicle', req.params.id, b.registration || null, {});
      res.json({ ok: true, vehicle: await getVehicleById(req.params.id) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete('/api/vehicles/:id', requireLogin, requirePermission('delete_fleet'), async function(req, res) {
    try {
      // ON DELETE CASCADE on vehicle_compliance/vehicle_assignments/vehicle_documents
      // handles the DB-side child rows; photo + docs dir are filesystem concerns.
      await pgPool.query('DELETE FROM vehicles WHERE id = $1', [req.params.id]);
      var oldPhoto = findVehiclePhoto(req.params.id);
      if (oldPhoto) fs.unlinkSync(oldPhoto);
      var docsDir = path.join(VEHICLE_DOCS_DIR, req.params.id);
      if (fs.existsSync(docsDir)) {
        try { fs.rmSync(docsDir, { recursive: true, force: true }); } catch (e) {}
      }
      logAuditEvent(req, 'VEHICLE_DELETED', 'vehicle', req.params.id, null, {});
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/vehicles/:id/photo', requireLogin, function(req, res) {
    try {
      var photo = findVehiclePhoto(req.params.id);
      if (!photo) return res.status(404).end();
      var ext = path.extname(photo).toLowerCase();
      var mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(photo));
    } catch (e) {
      res.status(500).end();
    }
  });

  app.post('/api/vehicles/:id/photo', requireLogin, requirePermission('fleet'), async function(req, res) {
    try {
      var existing = await pgPool.query('SELECT id FROM vehicles WHERE id = $1', [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Vehicle not found' });

      var chunks = [];
      req.on('data', function(c) { chunks.push(c); });
      req.on('end', function() {
        var buf = Buffer.concat(chunks);
        var ext = '.jpg';
        if (buf[0] === 0x89 && buf[1] === 0x50) ext = '.png';
        else if (buf[0] === 0xFF && buf[1] === 0xD8) ext = '.jpg';

        ['.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
          var old = path.join(VEHICLE_PHOTOS_DIR, req.params.id + e);
          if (fs.existsSync(old)) fs.unlinkSync(old);
        });

        fs.writeFileSync(path.join(VEHICLE_PHOTOS_DIR, req.params.id + ext), buf);
        res.json({ ok: true });
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── VEHICLE DOCUMENTS ─────────────────────────────────────────────────────────

  app.get('/api/vehicles/:id/docs', requireLogin, requirePermission('fleet'), async function(req, res) {
    try {
      var r = await pgPool.query('SELECT * FROM vehicle_documents WHERE vehicle_id = $1 ORDER BY uploaded_at', [req.params.id]);
      res.json(r.rows.map(vehicleDocRowToItem));
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/vehicles/:id/docs', requireLogin, requirePermission('fleet'), async function(req, res) {
    try {
      var existing = await pgPool.query('SELECT id FROM vehicles WHERE id = $1', [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Vehicle not found' });

      ensureVehicleDocsDir(req.params.id);
      var originalName = 'document';
      try { originalName = decodeURIComponent(req.headers['x-filename'] || 'document'); } catch (e) {}
      var docType = req.headers['x-doc-type'] || 'other';
      var timestamp = Date.now().toString();
      var ext = path.extname(originalName) || '';
      var filename = timestamp + ext;
      var filePath = path.join(VEHICLE_DOCS_DIR, req.params.id, filename);

      var chunks = [];
      req.on('data', function(c) { chunks.push(c); });
      req.on('end', async function() {
        try {
          var buf = Buffer.concat(chunks);
          fs.writeFileSync(filePath, buf);

          var r = await pgPool.query(
            'INSERT INTO vehicle_documents (vehicle_id, filename, original_name, doc_type, size_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
            [req.params.id, filename, originalName, docType, buf.length]
          );
          res.json({ ok: true, doc: vehicleDocRowToItem(r.rows[0]) });
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

  app.get('/api/vehicles/:id/docs/:filename', requireLogin, async function(req, res) {
    try {
      var filename = path.basename(req.params.filename);
      var filePath = path.join(VEHICLE_DOCS_DIR, req.params.id, filename);
      if (!fs.existsSync(filePath)) return res.status(404).end();

      var r = await pgPool.query('SELECT original_name FROM vehicle_documents WHERE vehicle_id = $1 AND filename = $2', [req.params.id, filename]);
      var originalName = r.rows.length ? r.rows[0].original_name : filename;

      res.setHeader('Content-Disposition', 'attachment; filename="' + originalName.replace(/"/g, '\\"') + '"');
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(filePath));
    } catch (e) {
      res.status(500).end();
    }
  });

  app.delete('/api/vehicles/:id/docs/:filename', requireLogin, requirePermission('delete_fleet'), async function(req, res) {
    try {
      var filename = path.basename(req.params.filename);
      var filePath = path.join(VEHICLE_DOCS_DIR, req.params.id, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      await pgPool.query('DELETE FROM vehicle_documents WHERE vehicle_id = $1 AND filename = $2', [req.params.id, filename]);

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── FLEET EXCEL EXPORTS ───────────────────────────────────────────────────────
  app.get('/api/vehicles/export', requireLogin, requirePermission('fleet'), async function(req, res) {
    try {
      var all = await loadVehicles();
      var staff = loadAllStaff();
      var ids = req.query.ids ? String(req.query.ids).split(',') : null;
      var list = ids ? all.filter(function(v) { return ids.indexOf(v.id) !== -1; }) : all;

      var statusFilter = req.query.status ? String(req.query.status) : null;
      if (statusFilter) list = list.filter(function(v) { return v.status === statusFilter; });

      var typeFilter = req.query.type ? String(req.query.type) : null;
      if (typeFilter) list = list.filter(function(v) { return v.type === typeFilter; });

      var rows = list.map(function(v) {
        var driver = staff.find(function(s) { return s.id === v.assignedDriverId; });
        return {
          'Registration': v.registration || '',
          'Make': v.make || '',
          'Model': v.model || '',
          'Year': v.year || '',
          'Colour': v.colour || '',
          'Type': v.type || '',
          'Status': v.status || '',
          'Mileage': v.mileage || '',
          'MOT Expiry': v.mot_expiry || '',
          'Insurance Expiry': v.insurance_expiry || '',
          'Road Tax Expiry': v.road_tax_expiry || '',
          'Service Due': v.service_due || '',
          'Assigned Driver': driver ? driver.name : '',
        };
      });
      sendXlsx(res, 'GuardTec-Fleet-Report-' + new Date().toISOString().slice(0,10) + '.xlsx', rows);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── INTERNAL n8n ENDPOINTS ────────────────────────────────────────────────────
  // These endpoints use a pre-shared token instead of session auth — for n8n agents only.

  var N8N_TOKEN = process.env.N8N_TOKEN || '';

  function requireN8nToken(req, res, next) {
    var token = req.headers['x-n8n-token'] || req.query.token;
    if (!N8N_TOKEN || token !== N8N_TOKEN) return res.status(401).json({ ok: false, error: 'Unauthorised' });
    next();
  }

  // GET /api/internal/fleet — returns all vehicles with pre-computed days_until_* fields
  app.get('/api/internal/fleet', requireN8nToken, async function(req, res) {
    try {
      var vehicles = await loadVehicles();
      var now = Date.now();
      function daysUntil(dateStr) {
        if (!dateStr) return null;
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        return Math.floor((d.getTime() - now) / 86400000);
      }
      var enriched = vehicles
        .filter(function(v) { return v.status !== 'sold'; })
        .map(function(v) {
          return {
            id: v.id,
            registration: v.registration,
            make: v.make,
            model: v.model,
            year: v.year,
            type: v.type,
            status: v.status,
            mot_expiry:       v.mot_expiry       || null,
            insurance_expiry: v.insurance_expiry || null,
            road_tax_expiry:  v.road_tax_expiry  || null,
            service_due:      v.service_due      || null,
            days_mot:       daysUntil(v.mot_expiry),
            days_insurance: daysUntil(v.insurance_expiry),
            days_road_tax:  daysUntil(v.road_tax_expiry),
            days_service:   daysUntil(v.service_due),
          };
        });
      res.json({ ok: true, vehicles: enriched, generatedAt: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};
