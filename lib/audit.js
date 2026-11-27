// Audit trail writer (audit_events table).
//
// Loaded from server.js: mount(require('./lib/audit')(deps))

module.exports = function auditLib(deps) {
  var pgPool = deps.pgPool;

  // Shared audit-trail logger — reused by every create/edit/delete route that
  // should show up in the Director-only Audit Trail page. Never throws: a
  // logging failure must not break the actual action it's recording.
  async function logAuditEvent(req, action, objectType, objectId, objectName, metadata) {
    try {
      await pgPool.query(
        `INSERT INTO audit_events (actor_id, actor_email, action, object_type, object_id, object_name, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [(req.user && req.user.id) || null, (req.user && req.user.username) || null, action, objectType, objectId, objectName, JSON.stringify(metadata || {})]
      );
    } catch (e) {
      console.error('[AUDIT] log failed:', e.message);
    }
  }

  return {
    logAuditEvent: logAuditEvent,
  };
};
