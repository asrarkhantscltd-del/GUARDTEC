// Staff records: Postgres-backed in-memory cache, load/save and staff-view sanitising.
//
// Loaded from server.js: mount(require('./lib/staffData')(deps))

module.exports = function staffDataLib(deps) {
  var calcOverall = deps.calcOverall,
    isOfficeExemptRole = deps.isOfficeExemptRole,
    pgPool = deps.pgPool;

  // Uploaded by management only, and hidden from the staff member by default —
  // unlike every other doc key above (self-uploaded, or manager-uploaded but
  // always visible, e.g. assignmentInstructions), visibility here is an
  // explicit per-document manager choice stored as documents[key].visibleToStaff.
  var MANAGER_ONLY_DOC_KEYS = ['creditCheckReport', 'socialMediaCheckReport', 'driverTachoCard', 'driverDbsCheck', 'driverAssessmentReport'];

  // ── STAFF: POSTGRES-BACKED, IN-MEMORY-CACHED ──────────────────────────────────
  // loadAllStaff()/saveStaff() are the ONLY two functions most of this file's
  // ~50 call sites need to know about. loadAllStaff() stays SYNCHRONOUS —
  // reading from STAFF_CACHE rather than awaiting Postgres — specifically so
  // none of those ~50 call sites (messaging, incident reports, disciplinary
  // records, custom forms, compliance alerts, dashboard stats, Excel/HTML
  // reports, the onboarding wizard) need converting to async. This is safe
  // because: the whole roster is small (tens to low hundreds of people), this
  // app runs as a single Node process (see docker-compose.yml — no horizontal
  // scaling), and nothing outside this process writes to `employees`/
  // `staff_documents` except the one-time migrate-staff.js (run with the app
  // stopped). saveStaff() itself, and the document/photo/training-cert upload
  // routes below (which bypass saveStaff() entirely, same as they bypassed it
  // pre-migration), are the only writers, and each refreshes the one affected
  // cache entry immediately after its own write — so the cache is never stale
  // for longer than one request.
  var STAFF_CACHE = [];

  // Fields that are real Postgres columns (or purely computed/retired) and
  // must never be copied into profile_data — kept in one place so saveStaff()
  // and the migration script apply the exact same rule.
  var STAFF_STRIP_FIELDS = ['id','name','email','phone','phoneLandline','dateOfBirth','dob','placeOfBirth',
    'nationality','gender','drivingLicence','deployStatus','currentSite','contract','induction','addedDate',
    'status','jobRole','wizard_draft','pending_submission','rejection_reason','overall','linkedRole','officeExempt','_folderPath',
    '_nameSuffix','_pgId','documents','archived_at','archive_reason'];

  // Rebuilds the flat `emp` object shape every existing call site already
  // expects, from a Postgres `employees` row + that employee's `staff_documents`
  // rows. Order matters: profile_data first (the base), then real columns
  // (only where non-null, so an absent key stays absent rather than becoming
  // a stored `null` — many call sites do `if (emp.rejectionReason)`-style
  // falsy checks), then computed fields last.
  // node-postgres parses a DATE column into a JS Date object by default (not
  // a string) — String(dateObj) calls .toString() ("Tue May 15 1990..."), not
  // .toISOString(), so a naive .slice(0,10) silently truncates to "Tue May 15"
  // instead of "1990-05-15" (found via live testing — see date_of_birth below).
  // Handles both cases defensively since some callers may pass an already-ISO
  // string (e.g. from migrate-staff.js's own inserted values on re-read).
  function pgDateToStr(v) {
    if (!v) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  }

  function reconstructEmp(row, docRows, linkedRole) {
    var flat = Object.assign({}, row.profile_data || {});
    var core = {
      id: row.legacy_id, name: row.name, email: row.email, phone: row.phone,
      phoneLandline: row.phone_landline,
      dateOfBirth: pgDateToStr(row.date_of_birth),
      dob: pgDateToStr(row.date_of_birth),
      placeOfBirth: row.place_of_birth, nationality: row.nationality, gender: row.gender,
      drivingLicence: row.driving_licence, status: row.status, deployStatus: row.deploy_status,
      contract: row.contract, induction: row.induction,
      addedDate: pgDateToStr(row.added_date),
      jobRole: row.job_role, currentSite: row.current_site_id,
      wizard_draft: row.wizard_draft, pending_submission: row.pending_submission,
      rejection_reason: row.rejection_reason,
    };
    Object.keys(core).forEach(function(k) {
      if (core[k] !== null && core[k] !== undefined) flat[k] = core[k];
    });
    flat._pgId = row.id;
    flat.archived_at = row.archived_at;
    flat.archive_reason = row.archive_reason;
    flat.linkedRole = linkedRole || null;
    flat.officeExempt = isOfficeExemptRole(flat.linkedRole);
    applyStaffDocuments(flat, docRows);
    flat.overall = calcOverall(flat);
    return flat;
  }

  // Merges staff_documents rows back into the documents.{key}.{uploaded,date}
  // and training.{key}.{certUploaded,certDate} shape the frontend expects —
  // this is the single source of truth for "is this file actually on disk",
  // closing a drift class the old system had (it wrote the boolean flag and
  // the file as two separate, unguarded fs writes that could already desync).
  function applyStaffDocuments(flat, docRows) {
    var documents = {};
    var trainingUpdates = {};
    (docRows || []).forEach(function(d) {
      var dateStr = d.uploaded_at ? new Date(d.uploaded_at).toISOString().slice(0, 10) : null;
      if (d.doc_category === 'document') {
        var entry = { uploaded: true, date: dateStr, visibleToStaff: d.visible_to_staff };
        if (d.doc_subtype) entry.docType = d.doc_subtype;
        documents[d.doc_key] = entry;
      } else if (d.doc_category === 'training') {
        trainingUpdates[d.doc_key] = { certUploaded: true, certDate: dateStr };
      }
    });
    flat.documents = documents;
    var training = Object.assign({}, flat.training);
    Object.keys(trainingUpdates).forEach(function(k) {
      training[k] = Object.assign({}, training[k], trainingUpdates[k]);
    });
    flat.training = training;
  }

  function deepCloneEmp(e) { return JSON.parse(JSON.stringify(e)); }

  async function refreshStaffCacheEntry(employeeId) {
    var r = await pgPool.query('SELECT * FROM employees WHERE id = $1', [employeeId]);
    if (!r.rows.length) {
      STAFF_CACHE = STAFF_CACHE.filter(function(e) { return e._pgId !== employeeId; });
      return;
    }
    var docRows = (await pgPool.query('SELECT * FROM staff_documents WHERE employee_id = $1', [employeeId])).rows;
    var roleRow = await pgPool.query('SELECT role FROM users WHERE staff_id = $1', [r.rows[0].legacy_id]);
    var reconstructed = reconstructEmp(r.rows[0], docRows, roleRow.rows[0] && roleRow.rows[0].role);
    var idx = STAFF_CACHE.findIndex(function(e) { return e._pgId === employeeId; });
    if (idx === -1) STAFF_CACHE.push(reconstructed);
    else STAFF_CACHE[idx] = reconstructed;
  }

  async function refreshStaffCacheFull() {
    var rows = (await pgPool.query('SELECT * FROM employees')).rows;
    var docsByEmployee = {};
    (await pgPool.query('SELECT * FROM staff_documents')).rows.forEach(function(d) {
      (docsByEmployee[d.employee_id] = docsByEmployee[d.employee_id] || []).push(d);
    });
    var roleByStaffId = {};
    (await pgPool.query("SELECT staff_id, role FROM users WHERE staff_id IS NOT NULL")).rows.forEach(function(u) {
      roleByStaffId[u.staff_id] = u.role;
    });
    STAFF_CACHE = rows.map(function(row) { return reconstructEmp(row, docsByEmployee[row.id] || [], roleByStaffId[row.legacy_id]); });
  }

  // ── LOAD STAFF ────────────────────────────────────────────────────────────────
  // Byte-shape-identical to the old JSON-file version: active staff only
  // (Ex-Staff — status='archived' — was always a separate directory this never
  // scanned; status='duplicate' from autoDedup() was always invisible to both
  // views via the separate "Duplicate Archive" folder, preserved here by
  // simply not returning it from either accessor). Deep-cloned on every call,
  // same as the old version implicitly was by re-parsing JSON from disk fresh
  // each time — so a caller that finds-then-mutates-then-saves never corrupts
  // the shared cache if it forgets to save, or the save fails partway.
  function loadAllStaff() {
    return STAFF_CACHE.filter(function(e) { return e.status === 'active'; }).map(deepCloneEmp);
  }

  // ── SAVE STAFF ────────────────────────────────────────────────────────────────
  // oldFolderPath is accepted (and ignored) purely so every existing call site
  // — saveStaff(emp, emp._folderPath) — keeps working unedited; _folderPath is
  // always absent on a Postgres-backed emp object, so it always evaluates to
  // undefined at the call site anyway.
  async function saveStaff(emp, oldFolderPath) {
    emp.overall = calcOverall(emp);

    var core = {
      name: emp.name || '', email: emp.email || null, phone: emp.phone || null,
      phone_landline: emp.phoneLandline || null,
      date_of_birth: emp.dateOfBirth || emp.dob || null,
      place_of_birth: emp.placeOfBirth || null, nationality: emp.nationality || null,
      gender: emp.gender || null, driving_licence: emp.drivingLicence || null,
      status: emp.status || 'active', deploy_status: emp.deployStatus || 'inactive',
      contract: emp.contract || null, induction: !!emp.induction,
      added_date: emp.addedDate || null, job_role: emp.jobRole || null,
      current_site_id: emp.currentSite || null,
      wizard_draft: emp.wizard_draft ? JSON.stringify(emp.wizard_draft) : null,
      pending_submission: emp.pending_submission ? JSON.stringify(emp.pending_submission) : null,
      rejection_reason: emp.rejection_reason || null,
    };

    var profileData = Object.assign({}, emp);
    STAFF_STRIP_FIELDS.forEach(function(k) { delete profileData[k]; });
    // training.*.certUploaded/certDate are reconstructed from staff_documents
    // at read time (see applyStaffDocuments) — strip them here so a stale copy
    // can never be written back and fight with the real source of truth.
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

    var existing = await pgPool.query('SELECT id FROM employees WHERE legacy_id = $1', [emp.id]);
    var employeeId;
    if (existing.rows.length) {
      employeeId = existing.rows[0].id;
      await pgPool.query(
        `UPDATE employees SET name=$1, email=$2, phone=$3, phone_landline=$4, date_of_birth=$5,
        place_of_birth=$6, nationality=$7, gender=$8, driving_licence=$9, status=$10, deploy_status=$11,
        contract=$12, induction=$13, added_date=$14, job_role=$15, current_site_id=$16,
        wizard_draft=$17, pending_submission=$18, rejection_reason=$19, profile_data=$20, updated_at=NOW()
       WHERE id=$21`,
        [core.name, core.email, core.phone, core.phone_landline, core.date_of_birth, core.place_of_birth,
         core.nationality, core.gender, core.driving_licence, core.status, core.deploy_status, core.contract,
         core.induction, core.added_date, core.job_role, core.current_site_id, core.wizard_draft,
         core.pending_submission, core.rejection_reason, JSON.stringify(profileData), employeeId]
      );
    } else {
      var ins = await pgPool.query(
        `INSERT INTO employees (legacy_id, name, email, phone, phone_landline, date_of_birth, place_of_birth,
         nationality, gender, driving_licence, status, deploy_status, contract, induction, added_date,
         job_role, current_site_id, wizard_draft, pending_submission, rejection_reason, profile_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
        [emp.id, core.name, core.email, core.phone, core.phone_landline, core.date_of_birth, core.place_of_birth,
         core.nationality, core.gender, core.driving_licence, core.status, core.deploy_status, core.contract,
         core.induction, core.added_date, core.job_role, core.current_site_id, core.wizard_draft,
         core.pending_submission, core.rejection_reason, JSON.stringify(profileData)]
      );
      employeeId = ins.rows[0].id;
    }

    await refreshStaffCacheEntry(employeeId);
    return employeeId;
  }

  function sanitizeForStaffView(emp) {
    var copy = Object.assign({}, emp);
    delete copy._folderPath;
    delete copy._pgId;
    // Manager-only docs (credit check, social media check) are stripped
    // entirely from what a staff member's own profile fetch returns unless
    // explicitly marked visibleToStaff — the row shouldn't just be hidden in
    // the UI, the data shouldn't reach their browser at all.
    if (copy.documents) {
      var docs = Object.assign({}, copy.documents);
      MANAGER_ONLY_DOC_KEYS.forEach(function(k) {
        if (docs[k] && docs[k].visibleToStaff !== true) delete docs[k];
      });
      copy.documents = docs;
    }
    return copy;
  }

  // Fields a staff member can submit via their self-service profile. Shared
  // between the pending_submission constructor below and the approve-merge
  // allowlist, so a field can never be accepted into pending_submission but
  // silently dropped on approval (or vice versa).
  var MY_PROFILE_FIELDS = [
    'email', 'phone', 'address', 'emergencyContact', 'sia', 'cscs', 'visa', 'references',
    'bankDetails', 'notes', 'driverLicence',
    'dateOfBirth', 'nationality', 'ni', 'uniqueTaxpayerReference', 'utrNotApplicable', 'previousNames',
    'yearsAtCurrentAddress', 'addressHistory', 'employmentHistoryDetail',
    'otherQualifications', 'hasCriminalHistory', 'criminalHistory',
    'hasCautions', 'cautionsAndInvestigations', 'declarations',
  ];

  // Merges allowed self-service fields into a staff member's pending_submission
  // — shared by the self-service /api/my-profile endpoint below and any other
  // path that submits staff data through the same manager-approval gate (e.g.
  // an auto_map_to_profile custom form, Feature 3 / plan 3.5). One function
  // means a field can never be accepted into pending_submission here but
  // silently dropped on approval, or vice versa. Does not save — callers save.
  function applyPendingProfileFields(emp, fields) {
    var pending = Object.assign({}, emp.pending_submission, { submitted_at: new Date().toISOString() });
    MY_PROFILE_FIELDS.forEach(function(field) {
      if (fields[field] !== undefined) pending[field] = fields[field];
    });
    emp.pending_submission = pending;
    delete emp.rejection_reason;
    return emp;
  }

  return {
    MANAGER_ONLY_DOC_KEYS: MANAGER_ONLY_DOC_KEYS,
    MY_PROFILE_FIELDS: MY_PROFILE_FIELDS,
    get STAFF_CACHE() { return STAFF_CACHE; },
    set STAFF_CACHE(v) { STAFF_CACHE = v; },
    applyPendingProfileFields: applyPendingProfileFields,
    deepCloneEmp: deepCloneEmp,
    loadAllStaff: loadAllStaff,
    refreshStaffCacheEntry: refreshStaffCacheEntry,
    refreshStaffCacheFull: refreshStaffCacheFull,
    sanitizeForStaffView: sanitizeForStaffView,
    saveStaff: saveStaff,
  };
};
