// Excel export, spreadsheet sync and the HTML compliance overview.
//
// Loaded from server.js: mount(require('./lib/reports')(deps))

var XLSX = require('xlsx');
var fs = require('fs');

module.exports = function reportsLib(deps) {
  var OVERVIEW = deps.OVERVIEW,
    SHAREPOINT_DASHBOARD = deps.SHAREPOINT_DASHBOARD,
    SPREADSHEET = deps.SPREADSHEET,
    daysFrom = deps.daysFrom,
    excelDate = deps.excelDate,
    fmtDate = deps.fmtDate,
    getTodayStr = deps.getTodayStr,
    loadAllStaff = deps.loadAllStaff,
    overallEmoji = deps.overallEmoji,
    safeName = deps.safeName,
    saveStaff = deps.saveStaff,
    statusOf = deps.statusOf,
    toISO = deps.toISO;

  // ── INIT FROM SPREADSHEET ─────────────────────────────────────────────────────
  // Only ever fills gaps — never overwrites an existing record of the same
  // name (byte-identical semantics to the old fs.existsSync(jp) check, now
  // checked against the freshly-populated STAFF_CACHE rather than a fresh
  // Postgres query: this runs once, sequentially, at startup right after
  // refreshStaffCacheFull(), before the server accepts any traffic, so the
  // cache is guaranteed warm and there's no concurrent-write race to guard
  // against the way there is for the live POST /api/staff Abu Baker check).
  async function initFromSpreadsheet() {
    try {
      var wb = XLSX.readFile(SPREADSHEET);
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws,{header:1});
      for (const r of rows.slice(1)) {
        if (!r || !r[0]) continue;
        var name = String(r[0]).trim();
        if (!name) continue;

        // Sanity check: real staff rows always have a real phone number.
        // Legend/summary/caption rows in the spreadsheet (e.g. "COLOUR KEY",
        // "TOTAL STAFF TRACKED") have either a blank phone column or non-numeric
        // text there instead — skip anything that isn't a real phone number so
        // it doesn't get created as a fake staff record on every app restart.
        var phoneDigits = (r[3] ? String(r[3]) : '').replace(/\D/g, '');
        if (phoneDigits.length < 7) continue;

        var already = deps.STAFF_CACHE.some(function(e) { return safeName(e.name).toUpperCase() === safeName(name).toUpperCase(); });
        if (already) continue;

        var siaNum = r[5] ? String(r[5]).trim().replace(/\s+/g,'') : '';
        if (['N/A','NA',''].includes(siaNum.toUpperCase())) siaNum = '';

        var cscsNum = r[7] ? String(r[7]).trim() : '';
        var cscsUp = cscsNum.replace(/\s+/g,'').toUpperCase();
        if (['N/A','NA','--',''].includes(cscsUp)) cscsNum = '';
        else if (['BOOKCOSAC','BOOKTEST','NOTCOMPLETE','WAITING'].includes(cscsUp)) cscsNum = 'PENDING - Book required';

        var visaType = r[9] ? String(r[9]).trim() : '';
        if (['N/A','NA',''].includes(visaType.toUpperCase())) visaType = '';

        var emp = {
          id: name.toLowerCase().replace(/[^a-z0-9]/g,'-'),
          name: name,
          nationality: r[1] ? String(r[1]).trim() : '',
          gender:      r[2] ? String(r[2]).trim() : '',
          phone:       r[3] ? String(r[3]).toString().trim() : '',
          email:       r[4] ? String(r[4]).trim() : '',
          sia:  { number: siaNum,   expiry: toISO(excelDate(r[6])) },
          cscs: { number: cscsNum,  expiry: toISO(excelDate(r[8])) },
          visa: { type:   visaType, expiry: toISO(excelDate(r[10])) },
          references: {
            ref1: { name:'', company:'', email:'', status:'Not Started' },
            ref2: { name:'', company:'', email:'', status:'Not Started' }
          },
          contract: '', induction: false, status: 'active', addedDate: getTodayStr()
        };

        await saveStaff(emp, null);
        console.log('  Init:', name);
      }
    } catch(e) {
      console.error('Spreadsheet init error:', e.message);
    }
  }

  // ── HTML REPORT ───────────────────────────────────────────────────────────────
  function buildReportHTML(emp) {
    var logoB64 = '';
    var siaDays  = daysFrom(emp.sia && emp.sia.expiry);
    var cscsDays = daysFrom(emp.cscs && emp.cscs.expiry);
    var visaDays = daysFrom(emp.visa && emp.visa.expiry);

    function statusRow(label, num, days, expiry, type) {
      var st = num ? statusOf(days) : 'unknown';
      if (!num && (label==='CSCS Card'||label==='Right to Work')) st = 'na';
      var bg,color,badge,detail;
      if (st==='na')      { bg='#f3f4f6';color='#6b7280';badge='N/A';detail='Not required for this employee'; }
      else if (st==='unknown'){ bg='#f3f4f6';color='#6b7280';badge='NOT ON FILE';detail='No data recorded'; }
      else if (st==='red')    { bg='#fee2e2';color='#b91c1c';badge='EXPIRED';detail='Expired '+Math.abs(days)+' days ago - Expiry: '+fmtDate(expiry); }
      else if (st==='amber')  { bg='#fef3c7';color='#92400e';badge='EXPIRING SOON';detail='Expires in '+days+' days - Expiry: '+fmtDate(expiry); }
      else                    { bg='#d1fae5';color='#065f46';badge='VALID';detail=(days!==null?days+' days remaining':'No expiry / ILR')+' - Exp: '+fmtDate(expiry); }
      return '<div style="background:white;border-radius:10px;padding:18px 22px;margin-bottom:12px;border-left:5px solid '+color+';box-shadow:0 1px 5px rgba(0,0,0,0.07);">'
        +'<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">'
        +'<div><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;">'+label+'</div>'
        +'<div style="font-size:17px;font-weight:700;color:#111111;margin-top:3px;">'+(num||'—')+'</div></div>'
        +'<div style="text-align:right;">'
        +'<div style="background:'+bg+';color:'+color+';padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700;display:inline-block;">'+badge+'</div>'
        +'<div style="font-size:12px;color:'+color+';margin-top:5px;">'+detail+'</div>'
        +'</div></div></div>';
    }

    var oBg    = emp.overall==='green'?'#d1fae5':emp.overall==='amber'?'#fef3c7':emp.overall==='red'?'#fee2e2':'#f3f4f6';
    var oColor = emp.overall==='green'?'#065f46':emp.overall==='amber'?'#92400e':emp.overall==='red'?'#b91c1c':'#6b7280';
    var oWord  = emp.overall==='green'?'FULLY COMPLIANT':emp.overall==='amber'?'ACTION REQUIRED':emp.overall==='red'?'NON-COMPLIANT':'INCOMPLETE DATA';

    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+safeName(emp.name)+'</title>'
      +'<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;background:#f4f6fb;}.wrap{max-width:820px;margin:0 auto;padding:28px 20px 60px;}</style></head><body><div class="wrap">'
      +'<div style="background:#111111;border-radius:12px;padding:22px 26px;display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">'
      +'<img src="'+logoB64+'" style="height:46px;"><div style="text-align:right;"><div style="color:#CC0000;font-size:11px;text-transform:uppercase;">Staff Compliance Record</div>'
      +'<div style="color:white;font-size:11px;">Generated: '+new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'})+'</div>'
      +'<div style="color:#CC0000;font-size:10px;">CONFIDENTIAL</div></div></div>'
      +'<div style="background:white;border-radius:12px;padding:22px;box-shadow:0 2px 8px rgba(0,0,0,0.08);margin-bottom:22px;">'
      +'<div style="font-size:22px;font-weight:800;color:#111111;">'+emp.name+'</div>'
      +'<div style="display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;">'
      +'<span style="background:#eef2ff;color:#3730a3;padding:3px 12px;border-radius:20px;font-size:12px;">'+(emp.nationality||'—')+'</span>'
      +'<span style="background:#eef2ff;color:#3730a3;padding:3px 12px;border-radius:20px;font-size:12px;">'+(emp.gender||'—')+'</span>'
      +'<span style="background:#eef2ff;color:#3730a3;padding:3px 12px;border-radius:20px;font-size:12px;">Tel: '+(emp.phone||'—')+'</span>'
      +'</div><div style="font-size:13px;color:#6b7280;">Email: '+(emp.email||'—')+'</div>'
      +'<div style="margin-top:14px;background:'+oBg+';color:'+oColor+';padding:8px 18px;border-radius:8px;display:inline-block;font-size:14px;font-weight:800;">'
      +overallEmoji(emp.overall)+' '+oWord+'</div></div>'
      +'<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b7280;margin-bottom:10px;">Compliance Checks</div>'
      +statusRow('SIA Licence',    emp.sia&&emp.sia.number,   siaDays,  emp.sia&&emp.sia.expiry,   'SIA')
      +statusRow('CSCS Card',      emp.cscs&&emp.cscs.number, cscsDays, emp.cscs&&emp.cscs.expiry, 'CSCS')
      +statusRow('Right to Work',  emp.visa&&emp.visa.type,   visaDays, emp.visa&&emp.visa.expiry, 'Visa')
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px;">'
      +'<div style="background:white;border-radius:10px;padding:16px 18px;box-shadow:0 1px 5px rgba(0,0,0,0.06);border-left:4px solid #d1d5db;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;">Reference 1</div><div style="font-size:13px;color:#374151;margin-top:5px;">'+(emp.references&&emp.references.ref1&&emp.references.ref1.name||'Not recorded')+'</div><div style="font-size:11px;background:#f3f4f6;color:#6b7280;display:inline-block;padding:2px 10px;border-radius:20px;margin-top:6px;">'+(emp.references&&emp.references.ref1&&emp.references.ref1.status||'Not Started')+'</div></div>'
      +'<div style="background:white;border-radius:10px;padding:16px 18px;box-shadow:0 1px 5px rgba(0,0,0,0.06);border-left:4px solid #d1d5db;"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#9ca3af;">Reference 2</div><div style="font-size:13px;color:#374151;margin-top:5px;">'+(emp.references&&emp.references.ref2&&emp.references.ref2.name||'Not recorded')+'</div><div style="font-size:11px;background:#f3f4f6;color:#6b7280;display:inline-block;padding:2px 10px;border-radius:20px;margin-top:6px;">'+(emp.references&&emp.references.ref2&&emp.references.ref2.status||'Not Started')+'</div></div>'
      +'</div>'
      +'<div style="margin-top:36px;border-top:1px solid #e5e7eb;padding-top:14px;text-align:center;font-size:11px;color:#9ca3af;">GuardTec Security | BS 7858 Compliant | CONFIDENTIAL</div>'
      +'</div></body></html>';
  }

  // ── OVERVIEW HTML ─────────────────────────────────────────────────────────────
  function refreshOverview() {
    var html = buildOverviewHTML(loadAllStaff());
    fs.writeFileSync(OVERVIEW, html, 'utf8');
    fs.writeFileSync(SHAREPOINT_DASHBOARD, html, 'utf8');
  }

  function buildOverviewHTML(staff) {
    var logoB64 = '';
    var green = staff.filter(function(e){return e.overall==='green';}).length;
    var amber = staff.filter(function(e){return e.overall==='amber';}).length;
    var red   = staff.filter(function(e){return e.overall==='red';}).length;
    var unk   = staff.length - green - amber - red;
    var rows  = staff.map(function(e,i) {
      var sd = daysFrom(e.sia&&e.sia.expiry), cd = daysFrom(e.cscs&&e.cscs.expiry), vd = daysFrom(e.visa&&e.visa.expiry);
      var oBg=e.overall==='green'?'#d1fae5':e.overall==='amber'?'#fef3c7':e.overall==='red'?'#fee2e2':'#f3f4f6';
      var oC=e.overall==='green'?'#065f46':e.overall==='amber'?'#92400e':e.overall==='red'?'#b91c1c':'#555';
      var oW=e.overall==='green'?'COMPLIANT':e.overall==='amber'?'ACTION':e.overall==='red'?'NON-COMPLIANT':'INCOMPLETE';
      var bg=i%2===0?'#f9fafb':'#fff';
      var st = function(d,num){ if(!num)return '-'; if(d===null)return 'ILR'; if(d<0)return 'Expired'; return d+'d'; };
      return '<tr style="background:'+bg+'"><td style="padding:9px 12px;font-weight:700;color:#111111;">'+(i+1)+'. '+e.name+'</td>'
        +'<td style="padding:9px;text-align:center"><span style="background:'+oBg+';color:'+oC+';padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">'+overallEmoji(e.overall)+' '+oW+'</span></td>'
        +'<td style="padding:9px;text-align:center;font-size:12px;">'+st(sd,e.sia&&e.sia.number)+'</td>'
        +'<td style="padding:9px;text-align:center;font-size:12px;">'+st(cd,e.cscs&&e.cscs.number)+'</td>'
        +'<td style="padding:9px;text-align:center;font-size:12px;">'+(e.visa&&e.visa.type?st(vd,e.visa.type):'British')+'</td></tr>';
    }).join('');
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>GuardTec Compliance Overview</title>'
      +'<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;background:#f4f6fb;}.wrap{max-width:1050px;margin:0 auto;padding:28px 20px 60px;}table{width:100%;border-collapse:collapse;}th{background:#111111;color:white;padding:11px 13px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;}td{border-bottom:1px solid #f0f0f0;font-size:13px;}</style></head><body><div class="wrap">'
      +'<div style="background:#111111;border-radius:12px;padding:22px 26px;display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:14px;">'
      +'<div><img src="'+logoB64+'" style="height:44px;margin-bottom:10px;display:block;"><div style="color:white;font-size:18px;font-weight:800;">Staff Compliance Overview</div><div style="color:#CC0000;font-size:12px;margin-top:3px;">'+new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'})+' | CONFIDENTIAL</div></div>'
      +'<div style="display:flex;gap:10px;flex-wrap:wrap;">'
      +'<div style="background:#d1fae5;border-radius:10px;padding:12px 18px;text-align:center;"><div style="font-size:24px;font-weight:800;color:#065f46;">'+green+'</div><div style="font-size:10px;color:#065f46;font-weight:700;">COMPLIANT</div></div>'
      +'<div style="background:#fef3c7;border-radius:10px;padding:12px 18px;text-align:center;"><div style="font-size:24px;font-weight:800;color:#92400e;">'+amber+'</div><div style="font-size:10px;color:#92400e;font-weight:700;">ACTION NEEDED</div></div>'
      +'<div style="background:#fee2e2;border-radius:10px;padding:12px 18px;text-align:center;"><div style="font-size:24px;font-weight:800;color:#b91c1c;">'+red+'</div><div style="font-size:10px;color:#b91c1c;font-weight:700;">NON-COMPLIANT</div></div>'
      +'<div style="background:#f3f4f6;border-radius:10px;padding:12px 18px;text-align:center;"><div style="font-size:24px;font-weight:800;color:#6b7280;">'+unk+'</div><div style="font-size:10px;color:#6b7280;font-weight:700;">INCOMPLETE</div></div>'
      +'</div></div>'
      +'<div style="background:white;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.07);overflow:hidden;">'
      +'<table><thead><tr><th>Employee Name</th><th>Overall</th><th>SIA</th><th>CSCS</th><th>Right to Work</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
      +'<div style="margin-top:32px;border-top:1px solid #e5e7eb;padding-top:14px;text-align:center;font-size:11px;color:#9ca3af;">GuardTec Security | BS 7858 | CONFIDENTIAL</div>'
      +'</div></body></html>';
  }

  // ── EXCEL EXPORT HELPER ────────────────────────────────────────────────────────
  function sendXlsx(res, filename, rows) {
    var ws = XLSX.utils.json_to_sheet(rows);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(buf);
  }

  function loadJsonFile(filePath, defaultVal) {
    if (defaultVal === undefined) defaultVal = [];
    if (!fs.existsSync(filePath)) return defaultVal;
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch (e) { return defaultVal; }
  }

  // ── AGENCY STAFF (COVER GUARDS) ───────────────────────────────────────────────
  // Registration, documents, photo, bulk import and unavailability for guards
  // belonging to an agency. Every route here is gated by
  // requireOwnAgencyOrPermission('staff') — an 'agency' user may only touch rows
  // whose agency_id matches their own token, everyone else needs the 'staff'
  // module permission (director / any role granted it).

  // Formula-injection guard for CSV import (debug note #10) — Excel treats a
  // leading =, +, -, or @ as the start of a live formula. Prepending a quote
  // makes it render as literal text instead of executing if the export is later
  // opened in Excel. Applied to every text field on import, not just ones that
  // "look like" formulas — the check is on the leading character alone.
  function sanitizeForExcel(value) {
    if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
    return value;
  }

  return {
    initFromSpreadsheet: initFromSpreadsheet,
    refreshOverview: refreshOverview,
    sanitizeForExcel: sanitizeForExcel,
    sendXlsx: sendXlsx,
  };
};
