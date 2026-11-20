// Staff records: CRUD, documents, photos, training certificates, registration codes, pending review, ex-staff, disciplinary, provisions and contracts.
//
// Registered from server.js: require('./routes/staff')(deps)

var XLSX = require('xlsx');
var fs = require('fs');
var path = require('path');

module.exports = function registerStaffRoutes(deps) {
  var BASE = deps.BASE,
    CONTRACT_DIR = deps.CONTRACT_DIR,
    MANAGER_ONLY_DOC_KEYS = deps.MANAGER_ONLY_DOC_KEYS,
    MY_PROFILE_FIELDS = deps.MY_PROFILE_FIELDS,
    app = deps.app,
    contractMime = deps.contractMime,
    createNotification = deps.createNotification,
    daysFrom = deps.daysFrom,
    deepCloneEmp = deps.deepCloneEmp,
    detectExtFromBuffer = deps.detectExtFromBuffer,
    findContractFile = deps.findContractFile,
    hasStaffPermission = deps.hasStaffPermission,
    loadAllStaff = deps.loadAllStaff,
    loadSites = deps.loadSites,
    logAuditEvent = deps.logAuditEvent,
    pgPool = deps.pgPool,
    refreshOverview = deps.refreshOverview,
    refreshStaffCacheEntry = deps.refreshStaffCacheEntry,
    requireLogin = deps.requireLogin,
    requirePermission = deps.requirePermission,
    requireRole = deps.requireRole,
    resolveEmpId = deps.resolveEmpId,
    safeName = deps.safeName,
    sanitizeForStaffView = deps.sanitizeForStaffView,
    saveStaff = deps.saveStaff,
    saveStaffDocFile = deps.saveStaffDocFile,
    sendXlsx = deps.sendXlsx,
    staffDocDir = deps.staffDocDir;

  // Lets a staff user act on their OWN record (req.params.id must match their
  // staff_id), or falls back to the normal management permission check for
  // everyone else (director / any role granted moduleKey).
  function requireOwnStaffOrPermission(moduleKey) {
    var permCheck = requirePermission(moduleKey);
    return function(req, res, next) {
      if (req.user && req.user.role === 'staff') {
        if (req.user.staff_id && req.user.staff_id === req.params.id) return next();
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      permCheck(req, res, next);
    };
  }
  const COMPLIANCE_TRACKER   = path.join(BASE, "01 - Staff Compliance Tracker", "GuardTec Security — Staff Compliance Tracker.xlsx");
  const REFERENCE_TRACKER    = path.join(BASE, "05 - Reference Tracker", "GuardTec Security — Reference Check Tracker.xlsx");

  async function getStaffDocRow(employeeId, category, key) {
    var r = await pgPool.query(
      'SELECT * FROM staff_documents WHERE employee_id=$1 AND doc_category=$2 AND doc_key=$3',
      [employeeId, category, key]
    );
    return r.rows[0] || null;
  }

  async function deleteStaffDocFile(employeeId, category, key) {
    var row = await getStaffDocRow(employeeId, category, key);
    if (row) {
      var fp = path.join(staffDocDir(employeeId), row.filename);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      await pgPool.query('DELETE FROM staff_documents WHERE id = $1', [row.id]);
    }
    await refreshStaffCacheEntry(employeeId);
  }

  app.get('/api/staff/:id/photo', requireLogin, requireOwnStaffOrPermission('staff'), async function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp || !emp._pgId) return res.status(404).end();
      var row = await getStaffDocRow(emp._pgId, 'photo', 'profile');
      if (!row) return res.status(404).end();
      var fp = path.join(staffDocDir(emp._pgId), row.filename);
      if (!fs.existsSync(fp)) return res.status(404).end();
      var ext = path.extname(fp).toLowerCase();
      var mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(fp));
    } catch(e) {
      res.status(500).end();
    }
  });

  app.post('/api/staff/:id/photo', requireLogin, requireOwnStaffOrPermission('staff'), async function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp || !emp._pgId) return res.status(404).json({ ok:false, error:'Staff not found' });

      var chunks = [];
      req.on('data', function(c){ chunks.push(c); });
      req.on('end', async function() {
        try {
          var buf = Buffer.concat(chunks);
          var ext = detectExtFromBuffer(buf, '.jpg');
          await saveStaffDocFile(emp._pgId, 'photo', 'profile', buf, ext, {});
          console.log('[PHOTO] Saved profile photo for', emp.name);
          res.json({ ok: true });
        } catch (e) {
          res.status(500).json({ ok: false, error: e.message });
        }
      });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── STAFF DOCUMENT FILES ──────────────────────────────────────────────────────
  var ALLOWED_DOC_KEYS = [
    'siaPhysical','passport','drivingLicenceDoc','brpCard','proofOfAddress1','proofOfAddress2',
    'p45','bankLetter','application','assignmentInstructions','cscsCard','dbsCertificate',
    'creditCheckReport','socialMediaCheckReport',
    'driverLicenceCopy','driverCpcCard','driverMedicalCert','driverTachoCard','driverDbsCheck','driverAssessmentReport'
  ];

  var ALLOWED_TRAINING_KEYS = [
    'siaCertificate','firstAid','manualHandling','fireAwareness',
    'conflictManagement','bwcTraining','cscsTest'
  ];

  var DOC_KEY_LABELS = {
    siaPhysical: 'SIA Licence copy', passport: 'Passport / Photo ID', drivingLicenceDoc: 'Driving Licence', brpCard: 'BRP Card',
    proofOfAddress1: 'Proof of Address', proofOfAddress2: 'Proof of Address',
    p45: 'P45/P60', bankLetter: 'Bank Letter', application: 'Application Form',
    assignmentInstructions: 'Assignment Instructions', cscsCard: 'CSCS Card', dbsCertificate: 'DBS Certificate',
    creditCheckReport: 'Credit Check Report', socialMediaCheckReport: 'Social Media Check Report',
    driverLicenceCopy: 'Driving Licence (scan)',
    driverCpcCard: 'Driver CPC Card', driverMedicalCert: 'Driver Medical Certificate',
    driverTachoCard: 'Tachograph Card', driverDbsCheck: 'Driver DBS Certificate',
    driverAssessmentReport: 'Driving Assessment Report',
  };
  var TRAINING_KEY_LABELS = {
    siaCertificate: 'SIA Qualifying Certificate', firstAid: 'First Aid certificate',
    manualHandling: 'Manual Handling certificate', fireAwareness: 'Fire Awareness certificate',
    conflictManagement: 'Conflict Management (ACT) certificate', bwcTraining: 'BWC Training certificate',
    cscsTest: 'CSCS Health & Safety Test certificate',
  };

  app.get('/api/staff/:id/documents/:docKey', requireLogin, requireOwnStaffOrPermission('staff'), async function(req, res) {
    var docKey = req.params.docKey;
    if (!ALLOWED_DOC_KEYS.includes(docKey)) return res.status(400).end();
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp || !emp._pgId) return res.status(404).end();
      // requireOwnStaffOrPermission already let the staff member themselves
      // through for their own :id — this extra check catches that specific
      // case for manager-only docs, since the middleware alone can't tell
      // "staff viewing their own record" apart from "manager viewing it".
      if (MANAGER_ONLY_DOC_KEYS.includes(docKey) && !(await hasStaffPermission(req))) {
        var visMeta = emp.documents && emp.documents[docKey];
        if (!visMeta || visMeta.visibleToStaff !== true) return res.status(404).end();
      }
      var row = await getStaffDocRow(emp._pgId, 'document', docKey);
      if (!row) return res.status(404).end();
      var fp = path.join(staffDocDir(emp._pgId), row.filename);
      if (!fs.existsSync(fp)) return res.status(404).end();
      var ext = path.extname(fp).toLowerCase();
      var mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', 'inline; filename="' + docKey + ext + '"');
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(fp));
    } catch(e) {
      res.status(500).end();
    }
  });

  app.post('/api/staff/:id/documents/:docKey', requireLogin, requireOwnStaffOrPermission('staff'), async function(req, res) {
    var docKey = req.params.docKey;
    if (!ALLOWED_DOC_KEYS.includes(docKey)) return res.status(400).json({ ok:false, error:'Invalid document key' });
    if (MANAGER_ONLY_DOC_KEYS.includes(docKey) && !(await hasStaffPermission(req))) {
      return res.status(403).json({ ok:false, error: 'Only management can upload this document.' });
    }
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp || !emp._pgId) return res.status(404).json({ ok:false, error:'Staff not found' });
      var chunks = [];
      req.on('data', function(c){ chunks.push(c); });
      req.on('end', async function() {
        try {
          var buf = Buffer.concat(chunks);
          var ext = detectExtFromBuffer(buf, '.pdf');
          // Manager-only docs default HIDDEN from the subject unless the uploader
          // explicitly opts them in via this header at upload time (see
          // MANAGER_ONLY_DOC_KEYS comment) — everything else stays visible, same
          // as before this feature existed.
          var visibleToStaff = MANAGER_ONLY_DOC_KEYS.includes(docKey)
            ? req.query.visibleToStaff === 'true'
            : true;
          await saveStaffDocFile(emp._pgId, 'document', docKey, buf, ext, { visibleToStaff: visibleToStaff });
          console.log('[DOCS] Saved', docKey, 'for', emp.name);
          if (req.user.role === 'staff') {
            createNotification({
              type: 'document', actorName: emp.name,
              summary: 'uploaded ' + (DOC_KEY_LABELS[docKey] || docKey),
              linkStaffId: req.params.id, linkTab: 'documents',
            });
          }
          res.json({ ok:true, date: new Date().toISOString().slice(0, 10) });
        } catch (e) {
          res.status(500).json({ ok:false, error: e.message });
        }
      });
    } catch(e) {
      res.status(500).json({ ok:false, error: e.message });
    }
  });

  // Management-only — deliberately requirePermission, not requireOwnStaffOrPermission,
  // so a staff member can never remove a document their manager has already reviewed.
  app.delete('/api/staff/:id/documents/:docKey', requireLogin, requirePermission('delete_staff'), async function(req, res) {
    var docKey = req.params.docKey;
    if (!ALLOWED_DOC_KEYS.includes(docKey)) return res.status(400).json({ ok:false, error:'Invalid document key' });
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp || !emp._pgId) return res.status(404).json({ ok:false, error:'Staff not found' });
      await deleteStaffDocFile(emp._pgId, 'document', docKey);
      console.log('[DOCS] Deleted', docKey, 'for', emp.name);
      res.json({ ok:true });
    } catch(e) {
      res.status(500).json({ ok:false, error: e.message });
    }
  });

  // Flip visibility on an already-uploaded manager-only document without
  // re-uploading it — the manager's own control over "can this person see
  // what I checked", separate from the upload step itself.
  app.patch('/api/staff/:id/documents/:docKey/visibility', requireLogin, requirePermission('staff'), async function(req, res) {
    var docKey = req.params.docKey;
    if (!MANAGER_ONLY_DOC_KEYS.includes(docKey)) {
      return res.status(400).json({ ok:false, error: 'Visibility is not configurable for this document type.' });
    }
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp || !emp._pgId) return res.status(404).json({ ok:false, error:'Staff not found' });
      var row = await getStaffDocRow(emp._pgId, 'document', docKey);
      if (!row) return res.status(404).json({ ok:false, error: 'Document not found' });
      var visibleToStaff = !!(req.body && req.body.visibleToStaff);
      await pgPool.query('UPDATE staff_documents SET visible_to_staff = $1 WHERE id = $2', [visibleToStaff, row.id]);
      await refreshStaffCacheEntry(emp._pgId);
      res.json({ ok:true, visibleToStaff: visibleToStaff });
    } catch(e) {
      res.status(500).json({ ok:false, error: e.message });
    }
  });

  // ── TRAINING CERTIFICATE FILES ────────────────────────────────────────────────
  // Staff upload their own certificate for each standard course; management can
  // only view whether one is on file (no upload button on that side of the UI).
  app.get('/api/staff/:id/training/:key/certificate', requireLogin, requireOwnStaffOrPermission('staff'), async function(req, res) {
    var key = req.params.key;
    if (!ALLOWED_TRAINING_KEYS.includes(key)) return res.status(400).end();
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp || !emp._pgId) return res.status(404).end();
      var row = await getStaffDocRow(emp._pgId, 'training', key);
      if (!row) return res.status(404).end();
      var fp = path.join(staffDocDir(emp._pgId), row.filename);
      if (!fs.existsSync(fp)) return res.status(404).end();
      var ext = path.extname(fp).toLowerCase();
      var mime = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', 'inline; filename="' + key + ext + '"');
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(fp));
    } catch(e) {
      res.status(500).end();
    }
  });

  app.post('/api/staff/:id/training/:key/certificate', requireLogin, requireOwnStaffOrPermission('staff'), async function(req, res) {
    var key = req.params.key;
    if (!ALLOWED_TRAINING_KEYS.includes(key)) return res.status(400).json({ ok:false, error:'Invalid training key' });
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp || !emp._pgId) return res.status(404).json({ ok:false, error:'Staff not found' });
      var chunks = [];
      req.on('data', function(c){ chunks.push(c); });
      req.on('end', async function() {
        try {
          var buf = Buffer.concat(chunks);
          var ext = detectExtFromBuffer(buf, '.pdf');
          await saveStaffDocFile(emp._pgId, 'training', key, buf, ext, {});
          console.log('[TRAINING CERT] Saved', key, 'for', emp.name);
          if (req.user.role === 'staff') {
            createNotification({
              type: 'training_cert', actorName: emp.name,
              summary: 'uploaded ' + (TRAINING_KEY_LABELS[key] || key),
              linkStaffId: req.params.id, linkTab: 'training',
            });
          }
          res.json({ ok:true, date: new Date().toISOString().slice(0, 10) });
        } catch (e) {
          res.status(500).json({ ok:false, error: e.message });
        }
      });
    } catch(e) {
      res.status(500).json({ ok:false, error: e.message });
    }
  });

  // Management-only, same reasoning as the documents delete route above.
  app.delete('/api/staff/:id/training/:key/certificate', requireLogin, requirePermission('delete_staff'), async function(req, res) {
    var key = req.params.key;
    if (!ALLOWED_TRAINING_KEYS.includes(key)) return res.status(400).json({ ok:false, error:'Invalid training key' });
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp || !emp._pgId) return res.status(404).json({ ok:false, error:'Staff not found' });
      await deleteStaffDocFile(emp._pgId, 'training', key);
      console.log('[TRAINING CERT] Deleted', key, 'for', emp.name);
      res.json({ ok:true });
    } catch(e) {
      res.status(500).json({ ok:false, error: e.message });
    }
  });

  // Postgres-backed equivalent of nextFreeNameSuffix — finds the lowest
  // numeric suffix not already taken by an existing employees.legacy_id, used
  // to disambiguate two different people who share a name (the folder-name
  // suffix concept above doesn't apply any more; only the stored id needs to
  // stay unique).
  async function nextFreeIdSuffix(baseId) {
    for (var n = 2; ; n++) {
      var r = await pgPool.query('SELECT 1 FROM employees WHERE legacy_id = $1', [baseId + '-' + n]);
      if (!r.rows.length) return n;
    }
  }

  // ── EXCEL HELPERS ─────────────────────────────────────────────────────────────
  var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function isoToExcelDate(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return String(d.getUTCDate()).padStart(2,'0') + ' ' + MONTHS_SHORT[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function siaStatusText(emp) {
    if (!emp.sia || !emp.sia.number) return 'NOT ON FILE';
    var days = daysFrom(emp.sia.expiry);
    if (days === null) return 'VALID';
    if (days < 0)  return 'EXPIRED';
    if (days < 91) return 'EXPIRING < 90 DAYS';
    return 'VALID';
  }
  function cscsStatusText(emp) {
    if (!emp.cscs || !emp.cscs.number) return 'NOT ON FILE';
    if (String(emp.cscs.number).toUpperCase().startsWith('PENDING')) return 'PENDING';
    var days = daysFrom(emp.cscs.expiry);
    if (days === null) return 'VALID';
    if (days < 0)  return 'EXPIRED';
    if (days < 91) return 'EXPIRING < 90 DAYS';
    return 'VALID';
  }
  function rtwStatusText(emp) {
    if (!emp.visa || !emp.visa.type) return 'NOT ON FILE';
    var t = String(emp.visa.type).toUpperCase();
    if (!emp.visa.expiry || ['ILR','BRITISH','EUSS'].some(function(x){ return t.includes(x); })) return 'VALID (ILR/BRITISH/EUSS)';
    var days = daysFrom(emp.visa.expiry);
    if (days === null) return 'VALID';
    if (days < 0)  return 'EXPIRED';
    if (days < 91) return 'EXPIRING < 90 DAYS';
    return 'VALID (BRP)';
  }
  function setXlCell(ws, r, c, val) {
    var addr = XLSX.utils.encode_cell({r: r, c: c});
    ws[addr] = {t: 's', v: val === null || val === undefined ? '' : String(val)};
  }
  function findXlRow(rows, name) {
    var low = String(name).toLowerCase().trim();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i][0] && String(rows[i][0]).toLowerCase().trim() === low) return i;
    }
    return -1;
  }

  function updateComplianceTracker(emp) {
    try {
      var wb = XLSX.readFile(COMPLIANCE_TRACKER);

      // SIA Licences: cols — 0=Name, 2=SIA#, 3=Expiry, 4=Status
      var siaSh = wb.Sheets['SIA Licences'];
      if (siaSh) {
        var siaRows = XLSX.utils.sheet_to_json(siaSh, {header:1});
        var ri = findXlRow(siaRows, emp.name);
        if (ri >= 0) {
          setXlCell(siaSh, ri, 2, emp.sia && emp.sia.number ? emp.sia.number : '');
          setXlCell(siaSh, ri, 3, isoToExcelDate(emp.sia && emp.sia.expiry));
          setXlCell(siaSh, ri, 4, siaStatusText(emp));
        } else { console.warn('[Excel] SIA sheet: no row for', emp.name); }
      }

      // CSCS Cards: cols — 0=Name, 2=CSCS#, 3=Expiry, 4=Status
      var cscsSh = wb.Sheets['CSCS Cards'];
      if (cscsSh) {
        var cscsRows = XLSX.utils.sheet_to_json(cscsSh, {header:1});
        var ri2 = findXlRow(cscsRows, emp.name);
        if (ri2 >= 0) {
          setXlCell(cscsSh, ri2, 2, emp.cscs && emp.cscs.number ? emp.cscs.number : '');
          setXlCell(cscsSh, ri2, 3, isoToExcelDate(emp.cscs && emp.cscs.expiry));
          setXlCell(cscsSh, ri2, 4, cscsStatusText(emp));
        } else { console.warn('[Excel] CSCS sheet: no row for', emp.name); }
      }

      // Visa & Right to Work: cols — 0=Name, 2=VisaType, 3=Expiry, 4=RTWStatus, 5=SIAExpiry
      var visaSh = wb.Sheets['Visa & Right to Work'];
      if (visaSh) {
        var visaRows = XLSX.utils.sheet_to_json(visaSh, {header:1});
        var ri3 = findXlRow(visaRows, emp.name);
        if (ri3 >= 0) {
          setXlCell(visaSh, ri3, 2, emp.visa && emp.visa.type ? emp.visa.type : '');
          setXlCell(visaSh, ri3, 3, isoToExcelDate(emp.visa && emp.visa.expiry));
          setXlCell(visaSh, ri3, 4, rtwStatusText(emp));
          setXlCell(visaSh, ri3, 5, isoToExcelDate(emp.sia && emp.sia.expiry));
        } else { console.warn('[Excel] Visa sheet: no row for', emp.name); }
      }

      XLSX.writeFile(wb, COMPLIANCE_TRACKER);
      console.log('[Excel] Compliance Tracker updated:', emp.name);
    } catch(e) {
      console.error('[Excel] updateComplianceTracker error:', e.message);
    }
  }

  function updateReferenceTracker(emp) {
    try {
      var wb = XLSX.readFile(REFERENCE_TRACKER);
      var ws = wb.Sheets['Reference Board'];
      if (!ws) { console.warn('[Excel] Reference Board sheet not found'); return; }

      var rows = XLSX.utils.sheet_to_json(ws, {header:1});
      // rows[0]=title, rows[1]=status key, rows[2]=headers, rows[3+]=data
      var ri = -1;
      var low = String(emp.name).toLowerCase().trim();
      for (var i = 3; i < rows.length; i++) {
        if (rows[i] && rows[i][0] && String(rows[i][0]).toLowerCase().trim() === low) { ri = i; break; }
      }
      if (ri < 0) { console.warn('[Excel] Reference Tracker: no row for', emp.name); return; }

      var ref1 = (emp.references && emp.references.ref1) || {};
      var ref2 = (emp.references && emp.references.ref2) || {};

      // cols: 1=Ref1Name, 2=Ref1Co, 3=Ref1Email, 5=Ref1Status
      //       6=Ref2Name, 7=Ref2Co, 8=Ref2Email, 10=Ref2Status, 11=Overall
      setXlCell(ws, ri, 1,  ref1.name    || '');
      setXlCell(ws, ri, 2,  ref1.company || '');
      setXlCell(ws, ri, 3,  ref1.email   || '');
      setXlCell(ws, ri, 5,  ref1.status  || 'Not Started');
      setXlCell(ws, ri, 6,  ref2.name    || '');
      setXlCell(ws, ri, 7,  ref2.company || '');
      setXlCell(ws, ri, 8,  ref2.email   || '');
      setXlCell(ws, ri, 10, ref2.status  || 'Not Started');

      var s1 = ref1.status || 'Not Started';
      var s2 = ref2.status || 'Not Started';
      var overall;
      if (s1 === 'Satisfactory' && s2 === 'Satisfactory') overall = 'Satisfactory';
      else if (s1 === 'Unsatisfactory' || s2 === 'Unsatisfactory') overall = 'Unsatisfactory';
      else if (['Received','Chased'].includes(s1) || ['Received','Chased'].includes(s2)) overall = 'In Progress';
      else if (s1 === 'Email Sent' || s2 === 'Email Sent') overall = 'Email Sent';
      else if (s1 === 'N/A' && s2 === 'N/A') overall = 'N/A';
      else overall = 'Not Started';

      setXlCell(ws, ri, 11, overall);

      XLSX.writeFile(wb, REFERENCE_TRACKER);
      console.log('[Excel] Reference Tracker updated:', emp.name);
    } catch(e) {
      console.error('[Excel] updateReferenceTracker error:', e.message);
    }
  }

  function loadExStaff() {
    return deps.STAFF_CACHE.filter(function(e) { return e.status === 'archived'; }).map(deepCloneEmp);
  }

  // ── API ───────────────────────────────────────────────────────────────────────
  app.get('/api/staff', requireLogin, requirePermission('staff'), function(req, res) {
    try {
      res.json(loadAllStaff());
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── STAFF EXCEL EXPORT ────────────────────────────────────────────────────────
  // Mirrors the frontend's normDeploy() so filters match what the UI shows.
  function normDeployStatus(raw) {
    var v = String(raw || '').toLowerCase().replace(/[\s_-]/g, '');
    if (v.indexOf('onsite') !== -1 || v.indexOf('site') !== -1 || v.indexOf('deployed') !== -1) return 'onsite';
    if (v.indexOf('available') !== -1 || v.indexOf('standby') !== -1) return 'available';
    if (v.indexOf('off') !== -1 || v.indexOf('leave') !== -1 || v.indexOf('rest') !== -1 || v.indexOf('inactive') !== -1) return 'offduty';
    return 'unknown';
  }

  app.get('/api/staff/export', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var all = loadAllStaff();
      var sites = await loadSites();
      var siteName = function(id) {
        var s = sites.find(function(x) { return x.id === id; });
        return s ? s.name : (id || '');
      };

      var ids = req.query.ids ? String(req.query.ids).split(',') : null;
      var list = ids ? all.filter(function(s) { return ids.indexOf(s.id) !== -1; }) : all;

      var deployFilter = req.query.deployStatus ? String(req.query.deployStatus) : null;
      if (deployFilter) list = list.filter(function(s) { return normDeployStatus(s.deployStatus) === deployFilter; });

      var siteFilter = req.query.site ? String(req.query.site) : null;
      if (siteFilter) list = list.filter(function(s) { return s.currentSite === siteFilter; });

      var overallFilter = req.query.overall ? String(req.query.overall) : null;
      if (overallFilter) list = list.filter(function(s) { return s.overall === overallFilter; });

      var rows = list.map(function(s) {
        var missingItems = [];
        if (!(s.sia && s.sia.number)) missingItems.push('SIA');
        if (!(s.cscs && s.cscs.number)) missingItems.push('CSCS');
        if (!(s.dbs && s.dbs.type)) missingItems.push('DBS');
        if (!(s.bs7858 && s.bs7858.completed)) missingItems.push('BS7858');
        return {
          'Name': s.name || '',
          'Job Role': s.jobRole || '',
          'Overall Status': s.overall || '',
          'Email': s.email || '',
          'Phone': s.phone || '',
          'Nationality': s.nationality || '',
          'Date of Birth': s.dateOfBirth || s.dob || '',
          'NI Number': s.ni || '',
          'Address': s.address || '',
          'Deploy Status': normDeployStatus(s.deployStatus),
          'Current Site': s.currentSite ? siteName(s.currentSite) : '',
          'SIA Number': (s.sia && s.sia.number) || 'Missing',
          'SIA Expiry': (s.sia && s.sia.expiry) || 'Missing',
          'CSCS Number': (s.cscs && s.cscs.number) || 'Missing',
          'CSCS Expiry': (s.cscs && s.cscs.expiry) || 'Missing',
          'Visa Type': (s.visa && s.visa.type) || 'Missing',
          'Visa Expiry': (s.visa && s.visa.expiry) || 'Missing',
          'DBS Type': (s.dbs && s.dbs.type) || 'Missing',
          'DBS Check Date': (s.dbs && s.dbs.checkDate) || 'Missing',
          'BS7858 Completed': (s.bs7858 && s.bs7858.completed) ? 'Yes' : 'No',
          'Missing Documents': missingItems.length ? missingItems.join(', ') : 'None',
        };
      });
      sendXlsx(res, 'GuardTec-Staff-Report-' + new Date().toISOString().slice(0,10) + '.xlsx', rows);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── DEPLOYMENT STATUS ─────────────────────────────────────────────────────────
  app.patch('/api/staff/:id/deploy', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
      emp.deployStatus = req.body.deployStatus || emp.deployStatus || 'inactive';
      if (req.body.currentSite !== undefined) emp.currentSite = req.body.currentSite;
      await saveStaff(emp, emp._folderPath);
      res.json({ ok: true });
    } catch(e) {
      console.error(e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── TRAINING ──────────────────────────────────────────────────────────────────
  app.patch('/api/staff/:id/training', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
      emp.training = req.body.training || {};
      await saveStaff(emp, emp._folderPath);
      res.json({ ok: true });
    } catch(e) {
      console.error(e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── STAFF SELF-SERVICE PORTAL ─────────────────────────────────────────────────

  function generateRegistrationCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
    var code = '';
    for (var i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }

  // Ops Manager / Director generate & share this with a staff member so they
  // can self-register their own portal login.
  app.get('/api/staff/:id/registration-code', requireLogin, requirePermission('pending_review'), async function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
      if (emp.registration_claimed) return res.json({ ok: true, claimed: true, code: null });
      if (!emp.registration_code) {
        emp.registration_code = generateRegistrationCode();
        await saveStaff(emp, emp._folderPath);
      }
      res.json({ ok: true, claimed: false, code: emp.registration_code });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/staff/:id/registration-code/regenerate', requireLogin, requirePermission('pending_review'), async function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
      emp.registration_code = generateRegistrationCode();
      emp.registration_claimed = false;
      await saveStaff(emp, emp._folderPath);
      res.json({ ok: true, code: emp.registration_code });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Moves the pending photo into the live 'profile' slot on approve — reuses
  // saveStaffDocFile so the same old-extension cleanup + metadata upsert logic
  // runs as any other photo write, rather than a bespoke fs.renameSync.
  async function promotePendingPhoto(employeeId) {
    var pendingRow = await getStaffDocRow(employeeId, 'photo', 'pending');
    if (!pendingRow) return;
    var srcPath = path.join(staffDocDir(employeeId), pendingRow.filename);
    if (fs.existsSync(srcPath)) {
      var buf = fs.readFileSync(srcPath);
      var ext = path.extname(pendingRow.filename) || '.jpg';
      await saveStaffDocFile(employeeId, 'photo', 'profile', buf, ext, {});
    }
    await deleteStaffDocFile(employeeId, 'photo', 'pending');
  }

  app.get('/api/staff/:id/pending-photo', requireLogin, requirePermission('pending_review'), async function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp || !emp._pgId) return res.status(404).end();
      var row = await getStaffDocRow(emp._pgId, 'photo', 'pending');
      if (!row) return res.status(404).end();
      var fp = path.join(staffDocDir(emp._pgId), row.filename);
      if (!fs.existsSync(fp)) return res.status(404).end();
      var ext = path.extname(fp).toLowerCase();
      var mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(fp));
    } catch (e) {
      res.status(500).end();
    }
  });

  // Ops Manager / Director review queue — every staff member with an
  // outstanding self-submitted change.
  app.get('/api/staff/pending-review', requireLogin, requirePermission('pending_review'), function(req, res) {
    try {
      var all = loadAllStaff();
      var pending = all
        .filter(function(e){ return !!e.pending_submission; })
        .map(function(e){ return sanitizeForStaffView(e); });
      res.json({ ok: true, staff: pending });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/staff/:id/approve', requireLogin, requirePermission('pending_review'), async function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
      var pending = emp.pending_submission;
      if (!pending) return res.status(400).json({ ok: false, error: 'No pending submission for this staff member' });

      MY_PROFILE_FIELDS.forEach(function(field) {
        if (pending[field] !== undefined) emp[field] = pending[field];
      });

      if (pending.photo_pending && emp._pgId) {
        await promotePendingPhoto(emp._pgId);
      }

      delete emp.pending_submission;
      delete emp.rejection_reason;
      await saveStaff(emp, emp._folderPath);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/staff/:id/reject', requireLogin, requirePermission('pending_review'), async function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });
      if (!emp.pending_submission) return res.status(400).json({ ok: false, error: 'No pending submission for this staff member' });

      if (emp._pgId) {
        await deleteStaffDocFile(emp._pgId, 'photo', 'pending');
      }

      emp.rejection_reason = String(req.body.reason || 'Please review and resubmit your details.').trim();
      delete emp.pending_submission;
      await saveStaff(emp, emp._folderPath);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.put('/api/staff/:id', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var emp = req.body;
      await saveStaff(emp, null);
      updateComplianceTracker(emp);
      updateReferenceTracker(emp);
      refreshOverview();
      logAuditEvent(req, 'STAFF_UPDATED', 'employee', emp.id, emp.name, {});
      res.json({ ok: true });
    } catch(e) {
      console.error(e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/staff', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var emp = req.body;
      var confirmDifferentPerson = !!emp.confirmDifferentPerson;
      delete emp.confirmDifferentPerson;
      if (!emp.id) emp.id = emp.name.toLowerCase().replace(/[^a-z0-9]/g,'-');

      // "Add Staff" must only ever create a NEW record. Without this check,
      // submitting the same name again (e.g. someone re-adding a person who
      // looked like they'd disappeared, per the Abu Baker incident) silently
      // overwrites that person's existing record — destroying their real SIA/
      // CSCS/RTW data with whatever bare fields were in this new submission,
      // with no warning. Matched by NAME ONLY. Queried fresh from Postgres,
      // not STAFF_CACHE — this exact guard exists to catch cases where
      // something already caused a person to seem hidden/missing, so it must
      // never trust a cache that could be part of that same problem.
      var addTargetName = safeName(emp.name).toUpperCase();
      var activeNames = (await pgPool.query("SELECT name FROM employees WHERE status = 'active'")).rows;
      var addCollision = activeNames.some(function(r) { return safeName(r.name).toUpperCase() === addTargetName; });

      if (addCollision && !confirmDifferentPerson) {
        // Two different people can genuinely share a name — don't just block
        // outright. Send back the existing person's basic details so the UI
        // can show a side-by-side comparison and let the admin decide: edit
        // the existing profile (the usual case, and what the original bug
        // used to do by accident), or confirm this really is someone else.
        var existing = loadAllStaff().find(function(e){ return safeName(e.name).toUpperCase() === addTargetName; });
        return res.status(409).json({
          ok: false,
          sameNameConflict: true,
          error: 'A staff member named "' + emp.name + '" already has an active profile.',
          existing: existing ? {
            id: existing.id, name: existing.name, phone: existing.phone || null,
            email: existing.email || null, nationality: existing.nationality || null,
            jobRole: existing.jobRole || null,
          } : null,
        });
      }

      if (addCollision && confirmDifferentPerson) {
        // Confirmed as a different person with the same name — disambiguate
        // the STORED id (legacy_id must stay unique), never the displayed name.
        var suffixN = await nextFreeIdSuffix(emp.id);
        emp.id = emp.id + '-' + suffixN;
      }

      await saveStaff(emp, null);
      updateComplianceTracker(emp);
      updateReferenceTracker(emp);
      refreshOverview();
      logAuditEvent(req, 'STAFF_CREATED', 'employee', emp.id, emp.name, {});

      res.json({ ok: true });
    } catch(e) {
      console.error(e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete('/api/staff/:id', requireLogin, requirePermission('delete_staff'), async function(req, res) {
    try {
      var all = loadAllStaff();
      var emp = all.find(function(e){ return e.id === req.params.id; });
      if (!emp || !emp._pgId) return res.status(404).json({ ok: false, error: 'Staff not found' });

      // No same-name-in-Ex-Staff collision check needed any more — each
      // employees row has its own UUID, so there's nothing left for two
      // archived people sharing a name to actually collide on.
      await pgPool.query("UPDATE employees SET status='archived', archived_at=NOW(), archive_reason='left_employment' WHERE id=$1", [emp._pgId]);
      await refreshStaffCacheEntry(emp._pgId);
      refreshOverview();
      logAuditEvent(req, 'STAFF_ARCHIVED', 'employee', emp._pgId, emp.name, {});

      console.log('[DELETE] Archived (moved to Ex-Staff):', emp.name);
      res.json({ ok: true });
    } catch(e) {
      console.error(e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/exstaff', requireLogin, requirePermission('staff'), function(req, res) {
    try {
      var list = loadExStaff().map(function(e) {
        return { folderId: e.id, name: e.name || e.id, nationality: e.nationality || '', gender: e.gender || '', overall: e.overall || 'unknown' };
      });
      list.sort(function(a,b){ return a.name.localeCompare(b.name); });
      res.json(list);
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Permanently delete an ex-staff record (director only). Retention-guarded:
  // BS7858/GDPR expect vetting records kept ~7 years after someone leaves, and
  // migrating this off a filesystem move (fs.rmSync) onto a one-line DELETE
  // made it structurally easier to invoke than before — this guard exists so
  // that ease doesn't translate into an easier compliance mistake. A record
  // with no recorded archive date (migrated in before this safeguard existed)
  // can never be confirmed to have cleared retention, so it's never eligible.
  app.delete('/api/exstaff/permanent', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var legacyId = req.body.folderId;
      if (!legacyId) return res.status(400).json({ ok: false, error: 'No folderId provided' });
      var r = await pgPool.query("SELECT id, name, archived_at FROM employees WHERE legacy_id = $1 AND status = 'archived'", [legacyId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Ex-staff record not found' });
      var row = r.rows[0];

      var archivedAt = row.archived_at ? new Date(row.archived_at) : null;
      var retentionCutoff = new Date();
      retentionCutoff.setFullYear(retentionCutoff.getFullYear() - 7);
      if (!archivedAt || archivedAt > retentionCutoff) {
        return res.status(403).json({
          ok: false,
          error: archivedAt
            ? 'Archived on ' + archivedAt.toISOString().slice(0, 10) + ' — BS7858/GDPR requires keeping vetting records for 7 years. Not eligible for permanent deletion until ' +
              new Date(archivedAt.getFullYear() + 7, archivedAt.getMonth(), archivedAt.getDate()).toISOString().slice(0, 10) + '.'
            : 'No recorded archive date on file (this record predates this safeguard) — it can never be confirmed to have cleared the 7-year retention period, so it cannot be permanently deleted.',
        });
      }

      var confirmPhrase = String(req.body.confirmPhrase || '').trim();
      if (confirmPhrase !== row.name) {
        return res.status(400).json({ ok: false, error: 'Type the staff member\'s full name exactly to confirm permanent deletion.', requiresConfirmPhrase: row.name });
      }

      await pgPool.query('DELETE FROM employees WHERE id = $1', [row.id]);
      logAuditEvent(req, 'STAFF_PERMANENTLY_DELETED', 'employee', row.id, row.name, { legacy_id: legacyId, archived_at: row.archived_at });
      deps.STAFF_CACHE = deps.STAFF_CACHE.filter(function(e) { return e._pgId !== row.id; });

      console.log('[DELETE] Permanently deleted ex-staff:', row.name);
      res.json({ ok: true });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/exstaff/restore', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var legacyId = req.body.folderId;
      if (!legacyId) return res.status(400).json({ ok: false, error: 'No folderId provided' });

      var r = await pgPool.query("SELECT id, name FROM employees WHERE legacy_id = $1 AND status = 'archived'", [legacyId]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Ex-staff record not found' });

      await pgPool.query("UPDATE employees SET status='active', archived_at=NULL, archive_reason=NULL WHERE id=$1", [r.rows[0].id]);
      await refreshStaffCacheEntry(r.rows[0].id);
      refreshOverview();

      console.log('[RESTORE] ' + r.rows[0].name + ' moved back to Active Staff');
      res.json({ ok: true, name: r.rows[0].name });
    } catch(e) {
      console.error(e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── PHASE 4 API: Disciplinary Records & Incident Reports ─────────────────────

  // ── Disciplinary: list for a staff member (management) ──
  app.get('/api/staff/:id/disciplinary', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var empId = await resolveEmpId(req.params.id);
      if (!empId) return res.json({ ok: true, records: [] });
      var result = await pgPool.query(
        `SELECT dr.*, u.full_name AS issued_by_name
       FROM disciplinary_records dr
       LEFT JOIN users u ON u.id = dr.issued_by
       WHERE dr.employee_id = $1
       ORDER BY dr.incident_date DESC`,
        [empId]
      );
      res.json({ ok: true, records: result.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Disciplinary: add record (Director / Ops Manager only) ──
  app.post('/api/staff/:id/disciplinary', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var b = req.body;
      if (!b.incident_date || !b.type || !b.description) {
        return res.status(400).json({ ok: false, error: 'incident_date, type and description are required.' });
      }
      var empId = await resolveEmpId(req.params.id);
      if (!empId) return res.status(404).json({ ok: false, error: 'Staff member not found in database.' });
      var result = await pgPool.query(
        `INSERT INTO disciplinary_records (employee_id, incident_date, type, description, action_taken, issued_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [empId, b.incident_date, b.type, b.description, b.action_taken || null, req.user.id]
      );
      res.json({ ok: true, record: result.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Disciplinary: delete a record (Director only) ──
  app.delete('/api/disciplinary/:recordId', requireLogin, requireRole('director'), async function(req, res) {
    try {
      await pgPool.query('DELETE FROM disciplinary_records WHERE id = $1', [req.params.recordId]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Staff Provisions (Uniform & Equipment) ────────────────────────────────────

  // Management: list provisions for a staff member
  app.get('/api/staff/:id/provisions', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var empId = await resolveEmpId(req.params.id);
      if (!empId) return res.json({ ok: true, provisions: [] });
      var result = await pgPool.query(
        `SELECT sp.*, u.full_name AS recorded_by_name
       FROM staff_provisions sp
       LEFT JOIN users u ON u.id = sp.recorded_by
       WHERE sp.employee_id = $1 ORDER BY sp.created_at DESC`,
        [empId]
      );
      res.json({ ok: true, provisions: result.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Management: add a provision record
  app.post('/api/staff/:id/provisions', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var empId = await resolveEmpId(req.params.id);
      if (!empId) return res.status(404).json({ ok: false, error: 'Staff not found.' });
      var b = req.body;
      if (!b.item) return res.status(400).json({ ok: false, error: 'Item name is required.' });
      var r = await pgPool.query(
        `INSERT INTO staff_provisions (employee_id, item, provided, date_given, date_returned, notes, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [empId, b.item, b.provided !== false, b.date_given || null, b.date_returned || null, b.notes || null, req.user.id]
      );
      res.json({ ok: true, provision: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Management: delete a provision record
  app.delete('/api/provisions/:id', requireLogin, requirePermission('delete_staff'), async function(req, res) {
    try {
      await pgPool.query('DELETE FROM staff_provisions WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Check if contract exists (management)
  app.get('/api/staff/:id/contract/info', requireLogin, requirePermission('staff'), function(req, res) {
    var found = findContractFile(req.params.id);
    res.json({ ok: true, exists: !!found, ext: found ? found.ext : null });
  });

  // Upload contract (management)
  app.post('/api/staff/:id/contract', requireLogin, requirePermission('staff'), function(req, res) {
    var legacyId = req.params.id;
    var mime = (req.headers['content-type'] || '').toLowerCase();
    var ext = '.pdf';
    if      (mime.includes('pdf'))    ext = '.pdf';
    else if (mime.includes('docx'))   ext = '.docx';
    else if (mime.includes('msword')) ext = '.doc';
    else if (mime.includes('jpeg'))   ext = '.jpg';
    else if (mime.includes('png'))    ext = '.png';

    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() {
      try {
        var buf = Buffer.concat(chunks);
        ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png'].forEach(function(e) {
          var old = path.join(CONTRACT_DIR, legacyId + '_contract' + e);
          if (fs.existsSync(old)) fs.unlinkSync(old);
        });
        fs.writeFileSync(path.join(CONTRACT_DIR, legacyId + '_contract' + ext), buf);
        res.json({ ok: true });
      } catch(e) {
        res.status(500).json({ ok: false, error: e.message });
      }
    });
  });

  // Download / view contract (management)
  app.get('/api/staff/:id/contract', requireLogin, requirePermission('staff'), function(req, res) {
    var found = findContractFile(req.params.id);
    if (!found) return res.status(404).json({ ok: false, error: 'No contract on file.' });
    res.setHeader('Content-Type', contractMime(found.ext));
    res.setHeader('Content-Disposition', 'inline; filename="contract' + found.ext + '"');
    res.send(fs.readFileSync(found.filePath));
  });

  // Delete contract (management)
  app.delete('/api/staff/:id/contract', requireLogin, requirePermission('delete_staff'), function(req, res) {
    var found = findContractFile(req.params.id);
    if (found) fs.unlinkSync(found.filePath);
    res.json({ ok: true });
  });
};
