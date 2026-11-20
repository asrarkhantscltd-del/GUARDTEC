// User accounts, roles/permissions, password changes and the audit trail.
//
// Registered from server.js: require('./routes/usersRoles')(deps)

var bcrypt = require('bcryptjs');
var fs = require('fs');
var path = require('path');

module.exports = function registerUsersRolesRoutes(deps) {
  var app = deps.app,
    findUserPhoto = deps.findUserPhoto,
    isPasswordBreached = deps.isPasswordBreached,
    loadAllStaff = deps.loadAllStaff,
    loadRoles = deps.loadRoles,
    logAuditEvent = deps.logAuditEvent,
    passwordStrengthError = deps.passwordStrengthError,
    pgPool = deps.pgPool,
    requireLogin = deps.requireLogin,
    requireRole = deps.requireRole;
  function invalidateRolesCache() { deps.rolesCache = null; }

  app.get('/api/users/:id/photo', requireLogin, function(req, res) {
    try {
      var photo = findUserPhoto(req.params.id);
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

  app.get('/api/users', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var result = await pgPool.query('SELECT id, username, full_name, role, email, is_active, staff_id, created_at FROM users ORDER BY full_name');
      res.json({ users: result.rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Lightweight staff list used by the "Link staff record" dropdown in the
  // Edit User panel — returns only id + name so we don't over-fetch.
  app.get('/api/staff/for-link', requireLogin, requireRole('director'), function(req, res) {
    try {
      var all = loadAllStaff();
      var list = all.map(function(e) { return { id: e.id, name: e.name }; })
                    .sort(function(a, b) { return a.name.localeCompare(b.name); });
      res.json({ staff: list });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/users', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var b = req.body;
      var username  = String(b.username  || '').trim().toLowerCase();
      var full_name = String(b.full_name || '').trim();
      var role      = String(b.role      || 'supervisor').trim();
      var email     = String(b.email     || '').trim().toLowerCase();
      var password  = String(b.password  || '');

      if (!username)  return res.status(400).json({ ok: false, error: 'Username is required.' });
      if (!full_name) return res.status(400).json({ ok: false, error: 'Full name is required.' });
      var pwError = passwordStrengthError(password);
      if (pwError) return res.status(400).json({ ok: false, error: pwError });
      if (await isPasswordBreached(password)) return res.status(400).json({ ok: false, error: 'That password has appeared in a known data breach. Please choose a different one.' });

      var exists = await pgPool.query('SELECT id FROM users WHERE username = $1', [username]);
      if (exists.rows.length) return res.status(400).json({ ok: false, error: 'Username already exists.' });

      var hash = await bcrypt.hash(password, 10);
      var r = await pgPool.query(
        'INSERT INTO users (username, password_hash, full_name, role, email, is_active) VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id, username, full_name, role, email, is_active, created_at',
        [username, hash, full_name, role, email]
      );
      logAuditEvent(req, 'USER_CREATED', 'user', r.rows[0].id, full_name, { role: role });
      res.json({ ok: true, user: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/users/:id', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var b = req.body;
      var id        = req.params.id;
      var full_name = String(b.full_name || '').trim();
      var role      = String(b.role      || '').trim();
      var email     = String(b.email     || '').trim().toLowerCase();
      var is_active = b.is_active !== undefined ? Boolean(b.is_active) : true;
      // staff_id links this portal account to a staff compliance record so the
      // user can fill their own profile (My Profile page). null clears the link.
      var staff_id  = b.staff_id !== undefined ? (b.staff_id || null) : undefined;

      if (!full_name) return res.status(400).json({ ok: false, error: 'Full name is required.' });

      // Prevent director from suspending their own account
      if (String(req.user.id) === String(id) && !is_active) {
        return res.status(400).json({ ok: false, error: 'You cannot suspend your own account.' });
      }

      var r;
      if (staff_id !== undefined) {
        r = await pgPool.query(
          'UPDATE users SET full_name=$1, role=$2, email=$3, is_active=$4, staff_id=$5 WHERE id=$6 RETURNING id, username, full_name, role, email, is_active, staff_id',
          [full_name, role, email, is_active, staff_id, id]
        );
      } else {
        r = await pgPool.query(
          'UPDATE users SET full_name=$1, role=$2, email=$3, is_active=$4 WHERE id=$5 RETURNING id, username, full_name, role, email, is_active, staff_id',
          [full_name, role, email, is_active, id]
        );
      }
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'User not found.' });
      logAuditEvent(req, 'USER_UPDATED', 'user', id, r.rows[0].full_name, { role: r.rows[0].role, is_active: r.rows[0].is_active });
      res.json({ ok: true, user: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Self-service password change — any logged-in role (staff/agency/office/
  // director), unlike /api/users/:id/reset-password below which is
  // director-only and skips the current-password check entirely (that's the
  // "I forgot it" recovery path; this is the "I know it, just want to change
  // it" path).
  app.post('/api/account/change-password', requireLogin, async function(req, res) {
    try {
      var currentPassword = String(req.body.currentPassword || '');
      var newPassword = String(req.body.newPassword || '');
      var pwError = passwordStrengthError(newPassword);
      if (pwError) return res.status(400).json({ ok: false, error: pwError });

      var result = await pgPool.query('SELECT password_hash, full_name FROM users WHERE id = $1', [req.user.id]);
      if (!result.rows.length) return res.status(404).json({ ok: false, error: 'User not found.' });
      var match = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
      if (!match) return res.status(400).json({ ok: false, error: 'Current password is incorrect.' });

      if (await isPasswordBreached(newPassword)) return res.status(400).json({ ok: false, error: 'That password has appeared in a known data breach. Please choose a different one.' });

      var hash = await bcrypt.hash(newPassword, 10);
      await pgPool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
      logAuditEvent(req, 'USER_PASSWORD_CHANGED_SELF', 'user', req.user.id, result.rows[0].full_name, {});
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/users/:id/reset-password', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var password = String(req.body.password || '');
      var pwError = passwordStrengthError(password);
      if (pwError) return res.status(400).json({ ok: false, error: pwError });
      if (await isPasswordBreached(password)) return res.status(400).json({ ok: false, error: 'That password has appeared in a known data breach. Please choose a different one.' });
      var hash = await bcrypt.hash(password, 10);
      var r = await pgPool.query('UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING id, full_name', [hash, req.params.id]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'User not found.' });
      logAuditEvent(req, 'USER_PASSWORD_RESET', 'user', req.params.id, r.rows[0].full_name, {});
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete('/api/users/:id', requireLogin, requireRole('director'), async function(req, res) {
    try {
      if (String(req.user.id) === String(req.params.id)) {
        return res.status(400).json({ ok: false, error: 'You cannot delete your own account.' });
      }
      var r = await pgPool.query('DELETE FROM users WHERE id=$1 RETURNING id, full_name', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'User not found.' });
      logAuditEvent(req, 'USER_DELETED', 'user', req.params.id, r.rows[0].full_name, {});
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── ROLES MANAGEMENT ──────────────────────────────────────────────────────────
  // Deliberately director-only and NOT itself permission-configurable — letting
  // any role grant/edit roles would be a privilege-escalation hole.
  function slugify(name) {
    return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'role';
  }

  app.get('/api/roles', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var roles = await loadRoles();
      res.json({ ok: true, roles: roles });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/roles', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var name = String(req.body.name || '').trim();
      var permissions = req.body.permissions && typeof req.body.permissions === 'object' ? req.body.permissions : {};
      if (!name) return res.status(400).json({ ok: false, error: 'Role name is required.' });

      var slug = slugify(name);
      var existing = await pgPool.query('SELECT slug FROM roles WHERE slug = $1', [slug]);
      if (existing.rows.length) {
        slug = slug + '_' + Date.now().toString().slice(-5);
      }

      var r = await pgPool.query(
        'INSERT INTO roles (slug, name, is_system, permissions) VALUES ($1,$2,FALSE,$3) RETURNING slug, name, is_system, permissions',
        [slug, name, JSON.stringify(permissions)]
      );
      invalidateRolesCache();
      logAuditEvent(req, 'ROLE_CREATED', 'role', slug, name, {});
      res.json({ ok: true, role: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/roles/:slug', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var slug = req.params.slug;
      var existing = await pgPool.query('SELECT * FROM roles WHERE slug = $1', [slug]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Role not found.' });
      var current = existing.rows[0];

      if (slug === 'director' || slug === 'staff') {
        return res.status(400).json({ ok: false, error: 'This role is required by the system and cannot be edited.' });
      }

      var name = String(req.body.name || current.name).trim();
      var permissions = req.body.permissions && typeof req.body.permissions === 'object' ? req.body.permissions : current.permissions;
      if (!name) return res.status(400).json({ ok: false, error: 'Role name is required.' });

      var r = await pgPool.query(
        'UPDATE roles SET name=$1, permissions=$2 WHERE slug=$3 RETURNING slug, name, is_system, permissions',
        [name, JSON.stringify(permissions), slug]
      );
      invalidateRolesCache();
      logAuditEvent(req, 'ROLE_UPDATED', 'role', slug, name, {});
      res.json({ ok: true, role: r.rows[0] });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete('/api/roles/:slug', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var slug = req.params.slug;
      var existing = await pgPool.query('SELECT is_system, name FROM roles WHERE slug = $1', [slug]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Role not found.' });
      if (existing.rows[0].is_system) {
        return res.status(400).json({ ok: false, error: 'Built-in roles cannot be deleted.' });
      }

      var inUse = await pgPool.query('SELECT COUNT(*) as count FROM users WHERE role = $1', [slug]);
      var count = parseInt(inUse.rows[0].count) || 0;
      if (count > 0) {
        return res.status(400).json({ ok: false, error: count + ' user(s) currently have this role. Reassign them first in Team Access.' });
      }

      await pgPool.query('DELETE FROM roles WHERE slug = $1', [slug]);
      invalidateRolesCache();
      logAuditEvent(req, 'ROLE_DELETED', 'role', slug, existing.rows[0].name, {});
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── AUDIT TRAIL ───────────────────────────────────────────────────────────────
  // Director-only — shows who created/edited/deleted the significant records
  // (Staff, Sites, Vehicles, Agencies, Users, Roles). Populated by logAuditEvent()
  // above, called from each of those routes.
  app.get('/api/audit-events', requireLogin, requireRole('director'), async function(req, res) {
    try {
      var limit = Math.min(parseInt(req.query.limit) || 100, 500);
      var offset = parseInt(req.query.offset) || 0;
      var where = []; var params = []; var i = 1;
      if (req.query.object_type) { where.push('ae.object_type = $' + i); params.push(req.query.object_type); i++; }
      if (req.query.from) { where.push('ae.created_at >= $' + i); params.push(req.query.from); i++; }
      if (req.query.to) { where.push('ae.created_at <= $' + i); params.push(req.query.to); i++; }
      var whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
      params.push(limit); params.push(offset);
      var r = await pgPool.query(
        `SELECT ae.id, ae.action, ae.object_type, ae.object_id, ae.object_name, ae.metadata, ae.created_at,
              ae.actor_email, u.full_name AS actor_name, u.role AS actor_role
       FROM audit_events ae
       LEFT JOIN users u ON u.id = ae.actor_id
       ${whereSql}
       ORDER BY ae.created_at DESC
       LIMIT $${i} OFFSET $${i + 1}`,
        params
      );
      res.json({ ok: true, events: r.rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};
