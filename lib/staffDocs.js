// Staff/user document, photo and contract file helpers.
//
// Loaded from server.js: mount(require('./lib/staffDocs')(deps))

var fs = require('fs');
var path = require('path');

module.exports = function staffDocsLib(deps) {
  var CONTRACT_DIR = deps.CONTRACT_DIR,
    STAFF_DOCS_DIR = deps.STAFF_DOCS_DIR,
    USER_PHOTOS_DIR = deps.USER_PHOTOS_DIR,
    pgPool = deps.pgPool,
    refreshStaffCacheEntry = deps.refreshStaffCacheEntry;

  // ── PROFILE PHOTO ─────────────────────────────────────────────────────────────
  function findFileByExts(dir, prefix) {
    var exts = ['.jpg', '.jpeg', '.png', '.webp'];
    for (var e of exts) {
      var p = path.join(dir, prefix + e);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  function staffDocDir(employeeId) {
    var dir = path.join(STAFF_DOCS_DIR, employeeId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function detectExtFromBuffer(buf, fallback) {
    if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
    if (buf[0] === 0xFF && buf[1] === 0xD8) return '.jpg';
    return fallback || '.pdf';
  }

  // Removes any existing file for this slot regardless of extension, writes
  // the new one, and upserts the metadata row — one function so a route can
  // never do the file write without the DB write (or vice versa).
  async function saveStaffDocFile(employeeId, category, key, buf, ext, opts) {
    opts = opts || {};
    var dir = staffDocDir(employeeId);
    ['.pdf', '.jpg', '.jpeg', '.png', '.webp'].forEach(function(e) {
      var old = path.join(dir, category + '_' + key + e);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    });
    var filename = category + '_' + key + ext;
    fs.writeFileSync(path.join(dir, filename), buf);
    await pgPool.query(
      `INSERT INTO staff_documents (employee_id, doc_category, doc_key, doc_subtype, filename, original_name, size_bytes, visible_to_staff, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (employee_id, doc_category, doc_key) DO UPDATE SET
       doc_subtype=$4, filename=$5, original_name=$6, size_bytes=$7, visible_to_staff=$8, uploaded_by=$9, uploaded_at=NOW()`,
      [employeeId, category, key, opts.subtype || null, filename, opts.originalName || filename,
       buf.length, opts.visibleToStaff !== undefined ? opts.visibleToStaff : true, opts.uploadedBy || null]
    );
    await refreshStaffCacheEntry(employeeId);
  }

  function findUserPhoto(userId) { return findFileByExts(USER_PHOTOS_DIR, String(userId)); }

  function findContractFile(legacyId) {
    var exts = ['.pdf', '.docx', '.doc', '.jpg', '.jpeg', '.png'];
    for (var e of exts) {
      var p = path.join(CONTRACT_DIR, String(legacyId) + '_contract' + e);
      if (fs.existsSync(p)) return { filePath: p, ext: e };
    }
    return null;
  }

  function contractMime(ext) {
    if (ext === '.pdf')             return 'application/pdf';
    if (ext === '.docx')            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === '.doc')             return 'application/msword';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png')             return 'image/png';
    return 'application/octet-stream';
  }

  return {
    contractMime: contractMime,
    detectExtFromBuffer: detectExtFromBuffer,
    findContractFile: findContractFile,
    findFileByExts: findFileByExts,
    findUserPhoto: findUserPhoto,
    saveStaffDocFile: saveStaffDocFile,
    staffDocDir: staffDocDir,
  };
};
