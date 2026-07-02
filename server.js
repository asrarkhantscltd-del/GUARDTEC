const express = require('express');
const fs      = require('fs');
const path    = require('path');
const XLSX    = require('xlsx');

const app  = express();
const PORT = 3000;

const BASE        = "C:\\Users\\AsrarKhan\\First Call Site Services\\FCSS - Managers\\HR and Legal\\Asrar\\GuardTec Compliance";
const ACTIVE_DIR  = BASE + "\\02 - Vetting & Screening\\Active Staff";
const OVERVIEW    = BASE + "\\02 - Vetting & Screening\\GUARDTEC — COMPLIANCE OVERVIEW.html";
const SPREADSHEET = "C:\\Users\\AsrarKhan\\OneDrive - First Call Site Services\\TOTAL EMPLOYEE spreadsheet.xlsl.xlsx";
const LOGO_PATH   = "C:\\Users\\AsrarKhan\\First Call Site Services\\FCSS - Managers\\GuardTech Logo's\\Guard-Tec-final-Logos\\PNG\\GuardTec Security_Logo-white-for-black-bg.png";
const COMPLIANCE_TRACKER = BASE + "\\01 - Staff Compliance Tracker\\GuardTec Security — Staff Compliance Tracker.xlsx";
const REFERENCE_TRACKER  = BASE + "\\05 - Reference Tracker\\GuardTec Security — Reference Check Tracker.xlsx";
const SHAREPOINT_DASHBOARD = BASE + "\\! GuardTec Compliance Dashboard.html";

const SUBFOLDERS = ['01 - SIA Licence','02 - CSCS Card','03 - Right to Work & Visa','04 - References','05 - Employment Contract','06 - Training & Induction'];
function getTodayStr() { return new Date().toISOString().split('T')[0]; }

app.use(express.json({ limit: '10mb' }));

// Serve logo as its own endpoint
app.get('/logo', (req, res) => {
  res.setHeader('Content-Type', 'image/png');
  res.send(fs.readFileSync(LOGO_PATH));
});

// ── PROFILE PHOTO ─────────────────────────────────────────────────────────────
function findProfilePhoto(folderPath) {
  // Check for dedicated profile photo first
  var exts = ['.jpg','.jpeg','.png','.webp'];
  for (var e of exts) {
    var p = path.join(folderPath, 'profile' + e);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

app.get('/api/staff/:id/photo', function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._folderPath) return res.status(404).end();
    var photo = findProfilePhoto(emp._folderPath);
    if (!photo) return res.status(404).end();
    var ext = path.extname(photo).toLowerCase();
    var mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    res.send(fs.readFileSync(photo));
  } catch(e) {
    res.status(500).end();
  }
});

app.post('/api/staff/:id/photo', function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp || !emp._folderPath) return res.status(404).json({ ok:false, error:'Staff not found' });

    var chunks = [];
    req.on('data', function(c){ chunks.push(c); });
    req.on('end', function() {
      var buf = Buffer.concat(chunks);
      // Detect image type from header bytes
      var ext = '.jpg';
      if (buf[0]===0x89 && buf[1]===0x50) ext = '.png';
      else if (buf[0]===0xFF && buf[1]===0xD8) ext = '.jpg';

      // Remove any old profile photo
      ['.jpg','.jpeg','.png','.webp'].forEach(function(e){
        var old = path.join(emp._folderPath, 'profile' + e);
        if (fs.existsSync(old)) fs.unlinkSync(old);
      });

      var dest = path.join(emp._folderPath, 'profile' + ext);
      fs.writeFileSync(dest, buf);
      console.log('[PHOTO] Saved profile photo for', emp.name);
      res.json({ ok: true });
    });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

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
function calcOverall(emp) {
  var s = [];
  // SIA Licence — required, missing = action required
  if (!emp.sia || !emp.sia.number) {
    s.push('amber');
  } else {
    s.push(statusOf(daysFrom(emp.sia.expiry)));
  }
  // CSCS Card — required, missing or pending = action required
  if (!emp.cscs || !emp.cscs.number) {
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

function folderForEmp(emp) {
  return path.join(ACTIVE_DIR, overallEmoji(emp.overall) + ' ' + safeName(emp.name));
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

// ── LOAD STAFF ────────────────────────────────────────────────────────────────
function loadAllStaff() {
  var staff = [];
  if (!fs.existsSync(ACTIVE_DIR)) return staff;

  // Build set of ex-staff names to exclude (OneDrive may restore deleted folders)
  var exDir = path.join(BASE, '02 - Vetting & Screening', 'Ex-Staff');
  var exNames = new Set();
  if (fs.existsSync(exDir)) {
    fs.readdirSync(exDir).forEach(function(d) {
      var clean = d.replace(/^[^\p{L}A-Za-z]+/u, '').trim().toUpperCase();
      if (clean) exNames.add(clean);
    });
  }

  fs.readdirSync(ACTIVE_DIR).forEach(function(d) {
    var fp = path.join(ACTIVE_DIR, d);
    try {
      if (!fs.statSync(fp).isDirectory()) return;
      var jp = path.join(fp, 'staff_data.json');
      if (!fs.existsSync(jp)) return;
      // Skip if this person is also in Ex-Staff
      var clean = d.replace(/^[^\p{L}A-Za-z]+/u, '').trim().toUpperCase();
      if (exNames.has(clean)) return;
      var emp = JSON.parse(fs.readFileSync(jp,'utf8'));
      emp._folderPath = fp;
      emp.overall = calcOverall(emp);
      staff.push(emp);
    } catch(e) {}
  });
  return staff;
}

// ── SAVE STAFF ────────────────────────────────────────────────────────────────
function saveStaff(emp, oldFolderPath) {
  emp.overall = calcOverall(emp);
  var newFolder = folderForEmp(emp);
  if (oldFolderPath && oldFolderPath !== newFolder && fs.existsSync(oldFolderPath)) {
    try { fs.renameSync(oldFolderPath, newFolder); } catch(e) { newFolder = oldFolderPath; }
  }
  if (!fs.existsSync(newFolder)) fs.mkdirSync(newFolder, {recursive:true});
  SUBFOLDERS.forEach(function(sf) {
    var p = path.join(newFolder, sf);
    if (!fs.existsSync(p)) fs.mkdirSync(p, {recursive:true});
  });
  emp._folderPath = newFolder;
  fs.writeFileSync(path.join(newFolder,'staff_data.json'), JSON.stringify(emp,null,2), 'utf8');
  fs.writeFileSync(path.join(newFolder,'COMPLIANCE SUMMARY - '+safeName(emp.name)+'.html'), buildReportHTML(emp), 'utf8');
  return newFolder;
}

// ── INIT FROM SPREADSHEET ─────────────────────────────────────────────────────
function initFromSpreadsheet() {
  try {
    var wb = XLSX.readFile(SPREADSHEET);
    var ws = wb.Sheets[wb.SheetNames[0]];
    var rows = XLSX.utils.sheet_to_json(ws,{header:1});
    rows.slice(1).forEach(function(r) {
      if (!r || !r[0]) return;
      var name = String(r[0]).trim();
      if (!name) return;

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
      emp.overall = calcOverall(emp);

      // Find existing folder (any emoji prefix + name)
      var matched = null;
      if (fs.existsSync(ACTIVE_DIR)) {
        fs.readdirSync(ACTIVE_DIR).forEach(function(d) {
          var clean = d.replace(/^[\s\S]{1,3}/,'').trim();
          if (clean.toLowerCase() === name.toLowerCase()) matched = path.join(ACTIVE_DIR, d);
        });
      }

      var target = matched || folderForEmp(emp);
      if (!fs.existsSync(target)) fs.mkdirSync(target, {recursive:true});
      SUBFOLDERS.forEach(function(sf) {
        var p = path.join(target, sf);
        if (!fs.existsSync(p)) fs.mkdirSync(p, {recursive:true});
      });

      var jp = path.join(target, 'staff_data.json');
      if (!fs.existsSync(jp)) {
        emp._folderPath = target;
        fs.writeFileSync(jp, JSON.stringify(emp,null,2), 'utf8');
        fs.writeFileSync(path.join(target,'COMPLIANCE SUMMARY - '+safeName(name)+'.html'), buildReportHTML(emp), 'utf8');
        console.log('  Init:', name);
      }
    });
  } catch(e) {
    console.error('Spreadsheet init error:', e.message);
  }
}

// ── HTML REPORT ───────────────────────────────────────────────────────────────
function buildReportHTML(emp) {
  var logoB64 = 'data:image/png;base64,' + fs.readFileSync(LOGO_PATH).toString('base64');
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
function buildOverviewHTML(staff) {
  var logoB64 = 'data:image/png;base64,' + fs.readFileSync(LOGO_PATH).toString('base64');
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

// ── API ───────────────────────────────────────────────────────────────────────
app.get('/api/staff', function(req, res) {
  try {
    res.json(loadAllStaff());
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/staff/:id', function(req, res) {
  try {
    var emp = req.body;
    var all = loadAllStaff();
    var old = all.find(function(e){ return e.id === req.params.id; });
    saveStaff(emp, old ? old._folderPath : null);
    updateComplianceTracker(emp);
    updateReferenceTracker(emp);
    var overviewHtml = buildOverviewHTML(loadAllStaff());
    fs.writeFileSync(OVERVIEW, overviewHtml, 'utf8');
    fs.writeFileSync(SHAREPOINT_DASHBOARD, overviewHtml, 'utf8');
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/staff', function(req, res) {
  try {
    var emp = req.body;
    if (!emp.id) emp.id = emp.name.toLowerCase().replace(/[^a-z0-9]/g,'-');
    saveStaff(emp, null);
    updateComplianceTracker(emp);
    updateReferenceTracker(emp);
    var overviewHtml = buildOverviewHTML(loadAllStaff());
    fs.writeFileSync(OVERVIEW, overviewHtml, 'utf8');
    fs.writeFileSync(SHAREPOINT_DASHBOARD, overviewHtml, 'utf8');
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/staff/:id', function(req, res) {
  try {
    var all = loadAllStaff();
    var emp = all.find(function(e){ return e.id === req.params.id; });
    if (!emp) return res.status(404).json({ ok: false, error: 'Staff not found' });

    var folderPath = emp._folderPath;
    if (!folderPath || !fs.existsSync(folderPath)) {
      return res.status(404).json({ ok: false, error: 'Folder not found: ' + folderPath });
    }

    var exStaffDir = path.join(BASE, '02 - Vetting & Screening', 'Ex-Staff');
    if (!fs.existsSync(exStaffDir)) fs.mkdirSync(exStaffDir, { recursive: true });

    // Block duplicate — check if ANY folder in Ex-Staff matches this person's name
    var empNameClean = safeName(emp.name).toUpperCase();
    var alreadyExists = fs.readdirSync(exStaffDir).some(function(d) {
      var clean = d.replace(/^[\u{1F7E2}\u{1F7E1}\u{1F534}⚪️⃣]/gu, '').trim().toUpperCase();
      return clean === empNameClean;
    });
    if (alreadyExists) {
      return res.status(409).json({ ok: false, error: emp.name + ' is already in Ex-Staff.' });
    }

    var destFolder = path.join(exStaffDir, path.basename(folderPath));
    fs.renameSync(folderPath, destFolder);

    var overviewHtml = buildOverviewHTML(loadAllStaff());
    fs.writeFileSync(OVERVIEW, overviewHtml, 'utf8');
    fs.writeFileSync(SHAREPOINT_DASHBOARD, overviewHtml, 'utf8');

    console.log('[DELETE] Moved to Ex-Staff:', path.basename(folderPath));
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/exstaff', function(req, res) {
  try {
    var exDir = path.join(BASE, '02 - Vetting & Screening', 'Ex-Staff');
    if (!fs.existsSync(exDir)) return res.json([]);
    var list = [];
    fs.readdirSync(exDir).forEach(function(d) {
      var fp = path.join(exDir, d);
      if (!fs.statSync(fp).isDirectory()) return;
      var jp = path.join(fp, 'staff_data.json');
      if (!fs.existsSync(jp)) return;
      try {
        var emp = JSON.parse(fs.readFileSync(jp, 'utf8'));
        list.push({
          folderId: d,
          name: emp.name || d,
          nationality: emp.nationality || '',
          gender: emp.gender || '',
          overall: emp.overall || 'unknown'
        });
      } catch(e) {}
    });
    list.sort(function(a,b){ return a.name.localeCompare(b.name); });
    res.json(list);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/exstaff/restore', function(req, res) {
  try {
    var folderId = req.body.folderId;
    if (!folderId) return res.status(400).json({ ok: false, error: 'No folderId provided' });

    var exDir  = path.join(BASE, '02 - Vetting & Screening', 'Ex-Staff');
    var srcFolder = path.join(exDir, folderId);
    if (!fs.existsSync(srcFolder)) return res.status(404).json({ ok: false, error: 'Ex-staff folder not found' });

    var jp = path.join(srcFolder, 'staff_data.json');
    var emp = JSON.parse(fs.readFileSync(jp, 'utf8'));

    // Recalculate overall so emoji prefix is correct
    emp.overall = calcOverall(emp);
    var destFolder = path.join(ACTIVE_DIR, overallEmoji(emp.overall) + ' ' + safeName(emp.name));

    // If name already exists in Active, add suffix
    if (fs.existsSync(destFolder)) destFolder = destFolder + ' (Returned)';

    fs.renameSync(srcFolder, destFolder);

    // Update staff_data.json with new folder path
    emp._folderPath = destFolder;
    fs.writeFileSync(path.join(destFolder, 'staff_data.json'), JSON.stringify(emp, null, 2), 'utf8');

    var overviewHtml = buildOverviewHTML(loadAllStaff());
    fs.writeFileSync(OVERVIEW, overviewHtml, 'utf8');
    fs.writeFileSync(SHAREPOINT_DASHBOARD, overviewHtml, 'utf8');

    console.log('[RESTORE] ' + emp.name + ' moved back to Active Staff');
    res.json({ ok: true, name: emp.name });
  } catch(e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/overview', function(req, res) {
  try {
    var overviewHtml = buildOverviewHTML(loadAllStaff());
    fs.writeFileSync(OVERVIEW, overviewHtml, 'utf8');
    fs.writeFileSync(SHAREPOINT_DASHBOARD, overviewHtml, 'utf8');
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── SERVE APP WITH EMBEDDED STAFF DATA (no browser fetch needed) ──────────────
app.get('/', function(req, res) {
  try {
    var staff = loadAllStaff();
    var staffJSON = JSON.stringify(staff);
    var tpl = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    var page = tpl.replace('/*STAFF_DATA_PLACEHOLDER*/[]', staffJSON);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store');
    res.send(page);
  } catch(e) {
    res.send('<h2 style="color:red;padding:20px">Server error: ' + e.message + '</h2>');
  }
});

app.get('/reload', function(req, res) {
  try {
    var staff = loadAllStaff();
    res.json(staff);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


// ── START ─────────────────────────────────────────────────────────────────────
console.log('\nInitialising staff data from spreadsheet...');
initFromSpreadsheet();

app.listen(PORT, function() {
  console.log('\n========================================');
  console.log('  GuardTec Compliance App is RUNNING');
  console.log('  Open Chrome: http://localhost:' + PORT);
  console.log('  Press Ctrl+C to stop');
  console.log('========================================\n');
});
