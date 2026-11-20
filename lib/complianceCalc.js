// Date helpers, compliance status calculation and staff folder naming.
//
// Loaded from server.js: mount(require('./lib/complianceCalc')(deps))

var fs = require('fs');
var path = require('path');

module.exports = function complianceCalcLib(deps) {
  var ACTIVE_DIR = deps.ACTIVE_DIR,
    getTodayStr = deps.getTodayStr;

  // ── DATE HELPERS ──────────────────────────────────────────────────────────────
  function excelDate(v) {
    if (!v) return null;
    var s = String(v).trim().toUpperCase();
    if (['N/A','NA','--','ILR','WAITING',''].includes(s)) return null;
    if (typeof v === 'number') return new Date(Date.UTC(1899,11,30) + v * 86400000);
    var d = new Date(String(v).trim());
    return isNaN(d.getTime()) ? null : d;
  }
  function toISO(d) { return d ? d.toISOString().split('T')[0] : null; }
  function daysFrom(dateStr) {
    if (!dateStr) return null;
    return Math.round((new Date(dateStr) - new Date(getTodayStr())) / 86400000);
  }
  function fmtDate(s) {
    if (!s) return 'N/A';
    var p = String(s).split('-');
    if (p.length === 3) return p[2] + '/' + p[1] + '/' + p[0];
    return new Date(s).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'});
  }
  function statusOf(days) {
    if (days === null) return 'unknown';
    if (days < 0) return 'red';
    if (days < 91) return 'amber';
    return 'green';
  }
  function worstStatus(arr) {
    if (arr.includes('red'))   return 'red';
    if (arr.includes('amber')) return 'amber';
    if (arr.includes('green')) return 'green';
    return 'unknown';
  }
  // Office-based login roles never deployed as a guard — SIA/CSCS/training
  // aren't relevant to their job, so they're exempt from those compliance
  // checks (Asrar's explicit decision, 2026-08-28). Supervisor is deliberately
  // NOT in this list — not confirmed exempt, may still do guard-facing work.
  var OFFICE_ROLES_EXEMPT_FROM_SIA_CSCS = ['director', 'ops_manager', 'hr_manager', 'office_manager', 'accounts', 'media', 'fleet_manager'];

  function isOfficeExemptRole(role) {
    return OFFICE_ROLES_EXEMPT_FROM_SIA_CSCS.indexOf(role) !== -1;
  }

  function calcOverall(emp) {
    var exempt = isOfficeExemptRole(emp.linkedRole);
    var s = [];
    // SIA Licence — required, missing = action required (unless office-exempt)
    if (exempt) {
      s.push('green');
    } else if (!emp.sia || !emp.sia.number) {
      s.push('amber');
    } else {
      s.push(statusOf(daysFrom(emp.sia.expiry)));
    }
    // CSCS Card — required, missing or pending = action required (unless office-exempt)
    if (exempt) {
      s.push('green');
    } else if (!emp.cscs || !emp.cscs.number) {
      s.push('amber');
    } else if (String(emp.cscs.number).toUpperCase().startsWith('PENDING')) {
      s.push('amber');
    } else {
      s.push(statusOf(daysFrom(emp.cscs.expiry)));
    }
    // Right to Work — British (no visa type) = green automatically
    if (!emp.visa || !emp.visa.type) {
      s.push('green');
    } else if (emp.visa.expiry) {
      s.push(statusOf(daysFrom(emp.visa.expiry)));
    } else {
      s.push('green'); // ILR or indefinite leave
    }
    return worstStatus(s);
  }
  function overallEmoji(s) { return s==='green'?'🟢':s==='amber'?'🟡':s==='red'?'🔴':'⚪'; }
  function safeName(n) { return String(n).replace(/[<>:"/\\|?*]/g,'').trim(); }

  // emp._nameSuffix disambiguates two DIFFERENT people who happen to share a
  // name (see nextFreeNameSuffix below) — it only ever affects storage
  // (folder name / id), never the displayed emp.name, so two "John Smith"s
  // each keep their real name everywhere in the UI while living in separate
  // folders on disk.
  function folderForEmp(emp) {
    return path.join(ACTIVE_DIR, overallEmoji(emp.overall) + ' ' + safeName(emp.name) + (emp._nameSuffix || ''));
  }

  function cleanFolderName(d) {
    return d.replace(/^[^\p{L}A-Za-z]+/u, '').trim().toUpperCase();
  }

  // Finds the lowest " (2)", " (3)"... suffix not already taken by an
  // existing Active Staff folder whose cleaned name matches. Used when an
  // admin explicitly confirms a same-name "Add Staff" submission is a
  // genuinely different person, not the duplicate-creation mistake the
  // collision check normally exists to catch.
  function nextFreeNameSuffix(name) {
    var base = safeName(name).toUpperCase();
    for (var n = 2; ; n++) {
      var target = base + ' (' + n + ')';
      var taken = fs.existsSync(ACTIVE_DIR) && fs.readdirSync(ACTIVE_DIR).some(function(d) {
        return cleanFolderName(d) === target;
      });
      if (!taken) return n;
    }
  }

  return {
    calcOverall: calcOverall,
    daysFrom: daysFrom,
    excelDate: excelDate,
    fmtDate: fmtDate,
    isOfficeExemptRole: isOfficeExemptRole,
    overallEmoji: overallEmoji,
    safeName: safeName,
    statusOf: statusOf,
    toISO: toISO,
  };
};
