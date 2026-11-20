// Custom form builder, responses, submissions and export.
//
// Registered from server.js: require('./routes/customForms')(deps)

module.exports = function registerCustomFormsRoutes(deps) {
  var MY_PROFILE_FIELDS = deps.MY_PROFILE_FIELDS,
    app = deps.app,
    applyPendingProfileFields = deps.applyPendingProfileFields,
    hasStaffPermission = deps.hasStaffPermission,
    loadAllStaff = deps.loadAllStaff,
    pgPool = deps.pgPool,
    requireLogin = deps.requireLogin,
    requirePermission = deps.requirePermission,
    sanitizeForExcel = deps.sanitizeForExcel,
    saveStaff = deps.saveStaff;

  // ── FEATURE 3: CUSTOM FORMS BUILDER ───────────────────────────────────────────
  // A published custom form can be answered by a regular staff member, an
  // agency (the admin org itself), or one of an agency's guards. Only the
  // 'staff' case has a pending_submission / manager-approval concept — agencies
  // and agency_staff have no such workflow (plan 3.6), so auto-mapped answers
  // for them write straight onto their Postgres row.
  var CUSTOM_FORM_FIELD_TYPES = ['text', 'textarea', 'email', 'phone', 'date', 'number', 'dropdown', 'radio', 'checkbox', 'file', 'signature', 'table'];
  var CUSTOM_FORM_TYPES = ['staff_info', 'agency_info', 'site_info', 'event_info', 'general'];

  // Direct-write allowlists for the non-staff auto-map targets — sibling to
  // MY_PROFILE_FIELDS, same reasoning: a field name that ends up as a bare
  // column in an UPDATE statement must come from a fixed list, never off the
  // request body, or a form's field_mapping becomes an arbitrary-column-write
  // primitive. Deliberately excludes id/status/cert/audit columns on both
  // tables — those aren't things a form response should ever be able to touch.
  var AGENCY_PROFILE_FIELDS = ['name', 'email', 'phone', 'notes'];
  var AGENCY_STAFF_PROFILE_FIELDS = ['name', 'email', 'phone', 'nationality', 'job_role', 'custom_role', 'badge_type', 'dbs_expiry', 'sia_expiry', 'cscs_expiry'];

  // The Governance Fix (plan 3.5): whatever entity type a mapped field targets,
  // the target name must come from one of these three fixed allowlists — never
  // an arbitrary string the form builder typed in. This is what makes it
  // impossible to build a form that silently creates/writes an ungoverned field.
  function isAllowedProfileMapping(fieldName) {
    return MY_PROFILE_FIELDS.indexOf(fieldName) !== -1 ||
           AGENCY_PROFILE_FIELDS.indexOf(fieldName) !== -1 ||
           AGENCY_STAFF_PROFILE_FIELDS.indexOf(fieldName) !== -1;
  }

  // Validates the fields JSONB body of a custom form. When auto_map_to_profile
  // is true, every field's optional `profile_field` mapping target is checked
  // against the allowlists above — this is the one check that keeps 3.5's
  // governance fix real rather than advisory. Returns an error string, or null.
  function validateCustomFormFields(fields, autoMapToProfile) {
    if (!Array.isArray(fields) || !fields.length) return 'fields must be a non-empty array.';
    var seenIds = {};
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i] || {};
      var id = String(f.id || '').trim();
      var type = String(f.type || '').trim();
      var label = String(f.label || '').trim();
      if (!id) return 'Every field needs an id.';
      if (seenIds[id]) return 'Duplicate field id: ' + id;
      seenIds[id] = true;
      if (CUSTOM_FORM_FIELD_TYPES.indexOf(type) === -1) return 'Field "' + id + '" has an invalid type.';
      if (!label) return 'Field "' + id + '" needs a label.';
      if (autoMapToProfile && f.profile_field !== undefined && f.profile_field !== null && f.profile_field !== '') {
        if (!isAllowedProfileMapping(String(f.profile_field))) {
          return 'Field "' + id + '" maps to an unrecognised profile field: ' + f.profile_field;
        }
      }
    }
    return null;
  }

  // ── ADMIN: CUSTOM FORMS (create/edit/publish) ─────────────────────────────────
  app.post('/api/custom-forms', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var b = req.body || {};
      var name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ ok: false, error: 'name is required.' });

      var formType = String(b.form_type || '').trim();
      if (CUSTOM_FORM_TYPES.indexOf(formType) === -1) {
        return res.status(400).json({ ok: false, error: 'form_type must be one of: ' + CUSTOM_FORM_TYPES.join(', ') });
      }

      var autoMap = b.auto_map_to_profile === true;
      var fieldsError = validateCustomFormFields(b.fields, autoMap);
      if (fieldsError) return res.status(400).json({ ok: false, error: fieldsError });

      var linkedType = b.linked_to_entity_type ? String(b.linked_to_entity_type).trim() : null;
      var linkedId   = b.linked_to_entity_id ? String(b.linked_to_entity_id).trim() : null;

      var r = await pgPool.query(
        `INSERT INTO custom_forms
         (name, description, form_type, fields, linked_to_entity_type, linked_to_entity_id, created_by, is_published, auto_map_to_profile)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [name, b.description || null, formType, JSON.stringify(b.fields), linkedType, linkedId, req.user.id, b.is_published === true, autoMap]
      );
      res.json({ ok: true, form: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/custom-forms', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var conditions = [];
      var params = [];
      if (req.query.form_type) { params.push(req.query.form_type); conditions.push('form_type = $' + params.length); }
      if (req.query.linked_to) { params.push(req.query.linked_to); conditions.push('linked_to_entity_type = $' + params.length); }

      var sql = 'SELECT * FROM custom_forms' +
        (conditions.length ? ' WHERE ' + conditions.join(' AND ') : '') +
        ' ORDER BY created_at DESC';
      var result = await pgPool.query(sql, params);
      res.json({ ok: true, forms: result.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Single-form fetch — needed by the respondent-facing fill page (which only
  // knows a form id from a shared link, never the full list) and by the
  // responses page. Deliberately NOT gated by requirePermission('staff'): a
  // 'staff'/'agency' respondent filling out a published form has no management
  // permission at all, so gating this the same as the list route would make
  // the fill flow 403 for every real respondent. Unpublished/draft forms are
  // hidden from non-managers so a guessed id can't preview a form still being
  // built. Still requires a session (requireLogin) — see the router-integration
  // notes on CustomFormFillPage for why a truly anonymous, no-login fill isn't
  // supported yet.
  app.get('/api/custom-forms/:id', requireLogin, async function(req, res) {
    try {
      var r = await pgPool.query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Form not found.' });
      var form = r.rows[0];
      if (!form.is_published && !(await hasStaffPermission(req))) {
        return res.status(404).json({ ok: false, error: 'Form not found.' });
      }
      res.json({ ok: true, form: form });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/custom-forms/:id', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var existing = await pgPool.query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Form not found.' });
      var current = existing.rows[0];

      var b = req.body || {};
      var formType = current.form_type;
      if (b.form_type !== undefined) {
        formType = String(b.form_type).trim();
        if (CUSTOM_FORM_TYPES.indexOf(formType) === -1) {
          return res.status(400).json({ ok: false, error: 'form_type must be one of: ' + CUSTOM_FORM_TYPES.join(', ') });
        }
      }

      var autoMap = b.auto_map_to_profile !== undefined ? (b.auto_map_to_profile === true) : current.auto_map_to_profile;
      var fields = b.fields !== undefined ? b.fields : current.fields;
      var fieldsError = validateCustomFormFields(fields, autoMap);
      if (fieldsError) return res.status(400).json({ ok: false, error: fieldsError });

      var name          = b.name !== undefined ? String(b.name).trim() : current.name;
      var description   = b.description !== undefined ? b.description : current.description;
      var linkedType    = b.linked_to_entity_type !== undefined ? (String(b.linked_to_entity_type || '').trim() || null) : current.linked_to_entity_type;
      var linkedId      = b.linked_to_entity_id !== undefined ? (String(b.linked_to_entity_id || '').trim() || null) : current.linked_to_entity_id;
      var isPublished   = b.is_published !== undefined ? (b.is_published === true) : current.is_published;
      // Same explicit-flag pattern as event_instructions' bump_version (2.2) —
      // editing a published form's fields doesn't retroactively change past
      // responses' meaning, so version only moves on request, not implicitly.
      var version = b.bump_version === true ? current.version + 1 : current.version;

      var r = await pgPool.query(
        `UPDATE custom_forms
       SET name = $1, description = $2, form_type = $3, fields = $4, linked_to_entity_type = $5,
           linked_to_entity_id = $6, is_published = $7, auto_map_to_profile = $8, version = $9, updated_at = NOW()
       WHERE id = $10 RETURNING *`,
        [name, description, formType, JSON.stringify(fields), linkedType, linkedId, isPublished, autoMap, version, req.params.id]
      );
      res.json({ ok: true, form: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Hard delete — a custom form isn't vetting/compliance data with a
  // retention requirement (unlike ex-staff records), so unlike
  // /api/exstaff/permanent this needs no 7-year guard. Still destroys
  // recorded responses, so the response count is returned for the frontend
  // to warn on before the confirm click, same info-then-confirm shape as any
  // other irreversible delete in this app.
  app.delete('/api/custom-forms/:id', requireLogin, requirePermission('delete_staff'), async function(req, res) {
    try {
      var existing = await pgPool.query('SELECT id FROM custom_forms WHERE id = $1', [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Form not found.' });

      var client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        var deletedResponses = await client.query('DELETE FROM custom_form_responses WHERE form_id = $1', [req.params.id]);
        await client.query('DELETE FROM custom_forms WHERE id = $1', [req.params.id]);
        await client.query('COMMIT');
        res.json({ ok: true, deleted_responses: deletedResponses.rowCount });
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/custom-forms/:id/responses', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var formResult = await pgPool.query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id]);
      if (!formResult.rows.length) return res.status(404).json({ ok: false, error: 'Form not found.' });
      var responses = await pgPool.query(
        'SELECT * FROM custom_form_responses WHERE form_id = $1 ORDER BY submitted_at DESC NULLS LAST',
        [req.params.id]
      );
      res.json({ ok: true, form: formResult.rows[0], responses: responses.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Resolves who is actually submitting, from the logged-in session — never
  // from a client-supplied respondent_type/id, UNLESS the requester already
  // holds the 'staff' management permission (i.e. an admin filling a form on
  // someone else's behalf, like the plan's "Agency Onboarding Checklist" —
  // admin-filled, 3.6). Everyone else can only ever submit as themselves: a
  // 'staff' role submits as their own staff_id, an 'agency' role submits either
  // as their own agency or — if they pass agency_staff_id — as one of their own
  // guards (ownership re-checked against agency_id, same trust boundary as
  // requireOwnAgencyOrPermission elsewhere). Throws {status, error} on failure.
  async function resolveFormRespondent(req) {
    var b = req.body || {};
    if (await hasStaffPermission(req)) {
      var explicitType = String(b.respondent_type || '');
      var explicitId   = b.respondent_id !== undefined && b.respondent_id !== null ? String(b.respondent_id) : '';
      if (['staff', 'agency', 'agency_staff'].indexOf(explicitType) === -1 || !explicitId) {
        throw { status: 400, error: 'respondent_type (staff|agency|agency_staff) and respondent_id are required.' };
      }
      return { type: explicitType, id: explicitId };
    }
    if (req.user.role === 'staff') {
      if (!req.user.staff_id) throw { status: 403, error: 'No linked staff profile.' };
      return { type: 'staff', id: req.user.staff_id };
    }
    if (req.user.role === 'agency') {
      var agencyStaffId = b.agency_staff_id ? String(b.agency_staff_id) : '';
      if (agencyStaffId) {
        var check = await pgPool.query('SELECT id FROM agency_staff WHERE id = $1 AND agency_id = $2', [agencyStaffId, req.user.agency_id]);
        if (!check.rows.length) throw { status: 403, error: 'That guard is not registered to your agency.' };
        return { type: 'agency_staff', id: agencyStaffId };
      }
      if (!req.user.agency_id) throw { status: 403, error: 'No linked agency.' };
      return { type: 'agency', id: req.user.agency_id };
    }
    throw { status: 403, error: 'Forbidden' };
  }

  // Builds { profile_field: value } from a submitted response_data object,
  // using the form's own field->profile_field mapping — never trusts a mapping
  // supplied by the request itself, only the one already validated and stored
  // on the form at create/PATCH time (validateCustomFormFields above).
  function extractMappedFields(formFields, responseData) {
    var mapped = {};
    (formFields || []).forEach(function(f) {
      var target = f && f.profile_field;
      if (!target || responseData[f.id] === undefined) return;
      mapped[target] = responseData[f.id];
    });
    return mapped;
  }

  app.post('/api/custom-forms/:id/submit', requireLogin, async function(req, res) {
    try {
      var formResult = await pgPool.query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id]);
      if (!formResult.rows.length) return res.status(404).json({ ok: false, error: 'Form not found.' });
      var form = formResult.rows[0];
      if (!form.is_published) return res.status(403).json({ ok: false, error: 'This form is not currently open for responses.' });

      var b = req.body || {};
      var responseData = (b.response_data && typeof b.response_data === 'object') ? b.response_data : {};

      var respondent = await resolveFormRespondent(req);

      var inserted = await pgPool.query(
        `INSERT INTO custom_form_responses (form_id, respondent_type, respondent_id, response_data, submitted_at, ip_address, status)
       VALUES ($1,$2,$3,$4,NOW(),$5,'submitted') RETURNING *`,
        [form.id, respondent.type, respondent.id, JSON.stringify(responseData), req.ip || null]
      );

      // auto_map_to_profile — Governance Fix (plan 3.5): a 'staff' respondent's
      // mapped answers land in pending_submission and wait for manager
      // approval, EXACTLY like a self-service /api/my-profile edit — this form
      // is just another door into the same gated mechanism, never a bypass of
      // it. 'agency'/'agency_staff' have no such workflow (3.6), so their
      // mapped answers write straight onto the Postgres row.
      if (form.auto_map_to_profile) {
        var mapped = extractMappedFields(form.fields, responseData);
        if (Object.keys(mapped).length) {
          if (respondent.type === 'staff') {
            var all = loadAllStaff();
            var emp = all.find(function(e) { return e.id === respondent.id; });
            if (emp) {
              applyPendingProfileFields(emp, mapped);
              await saveStaff(emp, emp._folderPath);
            }
          } else if (respondent.type === 'agency') {
            var agencySets = [];
            var agencyParams = [];
            Object.keys(mapped).forEach(function(field) {
              if (AGENCY_PROFILE_FIELDS.indexOf(field) === -1) return; // belt-and-braces; already enforced at form save time
              agencyParams.push(mapped[field]);
              agencySets.push(field + ' = $' + agencyParams.length);
            });
            if (agencySets.length) {
              agencyParams.push(respondent.id);
              await pgPool.query('UPDATE agencies SET ' + agencySets.join(', ') + ' WHERE id = $' + agencyParams.length, agencyParams);
            }
          } else if (respondent.type === 'agency_staff') {
            var staffSets = [];
            var staffParams = [];
            Object.keys(mapped).forEach(function(field) {
              if (AGENCY_STAFF_PROFILE_FIELDS.indexOf(field) === -1) return;
              staffParams.push(mapped[field]);
              staffSets.push(field + ' = $' + staffParams.length);
            });
            if (staffSets.length) {
              staffSets.push('updated_at = NOW()');
              staffParams.push(respondent.id);
              await pgPool.query('UPDATE agency_staff SET ' + staffSets.join(', ') + ' WHERE id = $' + staffParams.length, staffParams);
            }
          }
        }
      }

      res.json({ ok: true, response: inserted.rows[0] });
    } catch (e) {
      if (e && e.status) return res.status(e.status).json({ ok: false, error: e.error });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // CSV export — every field runs through the same sanitizeForExcel() used by
  // CSV import (debug note #10), since a formula-injection payload works just
  // as well typed into a form response as it does in an imported spreadsheet
  // cell, and this export is just as likely to be reopened in Excel.
  function csvCell(value) {
    var str = value === null || value === undefined ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value));
    str = String(sanitizeForExcel(str));
    if (/[",\n\r]/.test(str)) str = '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  app.get('/api/custom-forms/:id/export', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var formResult = await pgPool.query('SELECT * FROM custom_forms WHERE id = $1', [req.params.id]);
      if (!formResult.rows.length) return res.status(404).json({ ok: false, error: 'Form not found.' });
      var form = formResult.rows[0];
      var fields = Array.isArray(form.fields) ? form.fields : [];

      var responses = await pgPool.query(
        'SELECT * FROM custom_form_responses WHERE form_id = $1 ORDER BY submitted_at DESC NULLS LAST',
        [req.params.id]
      );

      var headers = ['respondent_type', 'respondent_id', 'submitted_at', 'status'].concat(fields.map(function(f) { return f.label || f.id; }));
      var lines = [headers.map(csvCell).join(',')];
      responses.rows.forEach(function(row) {
        var data = row.response_data || {};
        var line = [row.respondent_type, row.respondent_id, row.submitted_at, row.status]
          .concat(fields.map(function(f) { return data[f.id]; }));
        lines.push(line.map(csvCell).join(','));
      });

      var csv = lines.join('\r\n');
      var filename = (form.name || 'form').replace(/[^a-z0-9_\- ]/gi, '').trim() || 'form';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '.csv"');
      res.send(csv);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};
