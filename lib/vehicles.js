// Vehicle data access helpers.
//
// Loaded from server.js: mount(require('./lib/vehicles')(deps))

module.exports = function vehiclesLib(deps) {
  var VEHICLE_PHOTOS_DIR = deps.VEHICLE_PHOTOS_DIR,
    findFileByExts = deps.findFileByExts,
    pgPool = deps.pgPool;

  // vehicle_type is the real column name (set by the dormant schema-phase3.sql
  // table, long before this migration) — aliased back to `type` here so every
  // route/response/frontend field stays exactly what it was pre-migration.
  // mot/insurance/road_tax/service dates are ::text-cast explicitly: node-postgres
  // returns a plain DATE column as a JS Date object by default, which JSON.stringify
  // turns into a full ISO timestamp — breaking `<input type="date">` elsewhere
  // in this app (see the same issue already worked around client-side for
  // agency_deployments.event_date). Casting to text here keeps the wire format
  // as the plain YYYY-MM-DD string the old vehicles.json always had.
  var VEHICLE_JOIN_SQL =
    "SELECT v.id, v.legacy_id, v.registration, v.make, v.model, v.vehicle_type AS type, v.year, v.colour, v.status, v.notes, v.mileage, " +
    "  (SELECT vc.expiry_date::text FROM vehicle_compliance vc WHERE vc.vehicle_id = v.id AND vc.document_type = 'MOT' ORDER BY vc.created_at DESC LIMIT 1) AS mot_expiry, " +
    "  (SELECT vc.expiry_date::text FROM vehicle_compliance vc WHERE vc.vehicle_id = v.id AND vc.document_type = 'INSURANCE' ORDER BY vc.created_at DESC LIMIT 1) AS insurance_expiry, " +
    "  (SELECT vc.expiry_date::text FROM vehicle_compliance vc WHERE vc.vehicle_id = v.id AND vc.document_type = 'ROAD_TAX' ORDER BY vc.created_at DESC LIMIT 1) AS road_tax_expiry, " +
    "  (SELECT vc.expiry_date::text FROM vehicle_compliance vc WHERE vc.vehicle_id = v.id AND vc.document_type = 'SERVICE' ORDER BY vc.created_at DESC LIMIT 1) AS service_due, " +
    "  (SELECT e.legacy_id FROM vehicle_assignments va JOIN employees e ON e.id = va.employee_id " +
    "     WHERE va.vehicle_id = v.id AND va.unassigned_date IS NULL ORDER BY va.assigned_date DESC LIMIT 1) AS \"assignedDriverId\" " +
    "FROM vehicles v";

  function findVehiclePhoto(id) { return findFileByExts(VEHICLE_PHOTOS_DIR, id); }

  // has_photo was never authoritative pre-migration either — the photo-serving
  // route always re-checked disk regardless of this flag — so it's computed
  // live here rather than stored, which can never drift from reality.
  function attachHasPhoto(row) {
    row.has_photo = !!findVehiclePhoto(row.id);
    return row;
  }

  async function loadVehicles() {
    var r = await pgPool.query(VEHICLE_JOIN_SQL + " ORDER BY v.created_at");
    return r.rows.map(attachHasPhoto);
  }

  return {
    VEHICLE_JOIN_SQL: VEHICLE_JOIN_SQL,
    attachHasPhoto: attachHasPhoto,
    findVehiclePhoto: findVehiclePhoto,
    loadVehicles: loadVehicles,
  };
};
