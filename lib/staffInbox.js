// New-starter inbox (Power Automate bridge), duplicate detection and auto git push.
//
// Loaded from server.js: mount(require('./lib/staffInbox')(deps))

var { execFile } = require('child_process');
var fs = require('fs');
var path = require('path');

module.exports = function staffInboxLib(deps) {
  var INBOX_DIR = deps.INBOX_DIR,
    INBOX_DONE_DIR = deps.INBOX_DONE_DIR,
    getTodayStr = deps.getTodayStr,
    loadAllStaff = deps.loadAllStaff,
    pgPool = deps.pgPool,
    refreshStaffCacheEntry = deps.refreshStaffCacheEntry,
    saveStaff = deps.saveStaff;


  // ── AUTO GIT COMMIT + PUSH ────────────────────────────────────────────────────
  var _gitTimer = null;
  function scheduleGitPush(reason) {
    if (_gitTimer) clearTimeout(_gitTimer);
    _gitTimer = setTimeout(function() {
      var appDir = __dirname;
      var now    = new Date();
      var stamp = now.toISOString().slice(0, 16).replace('T', ' ');
      // reason can originate from untrusted input (e.g. a name from the New Staff
      // Inbox) — pass it to git as a single argv element via execFile, never
      // through a shell, so it can't break out into arbitrary command execution.
      var msg = 'Auto-save: ' + stamp + (reason ? ' — ' + String(reason).slice(0, 200) : '');
      var opts = { cwd: appDir };
      execFile('git', ['add', '-A'], opts, function(errAdd) {
        if (errAdd) { console.log('[GIT] add failed:', errAdd.message); return; }
        execFile('git', ['commit', '-m', msg], opts, function(errCommit, _out, errCommitStderr) {
          if (errCommit) { console.log('[GIT] commit failed (likely nothing to commit):', errCommitStderr || errCommit.message); return; }
          execFile('git', ['push', 'origin', 'main'], opts, function(errPush, _out2, errPushStderr) {
            if (errPush) { console.log('[GIT] Push failed:', errPushStderr || errPush.message); }
            else          { console.log('[GIT] Pushed to GitHub —', msg); }
          });
        });
      });
    }, 5000);
  }

  // ── AUTO DUPLICATE DETECTION ──────────────────────────────────────────────────
  function normPhone(p) {
    if (!p) return '';
    return String(p).replace(/\D/g,'').replace(/^(440|44|0)/,'');
  }
  function normEmail(e) { return e ? String(e).toLowerCase().trim() : ''; }
  function normSIA(s)   { return s ? String(s).replace(/\s/g,'').toUpperCase() : ''; }

  function nameSimilarity(a, b) {
    var wa = a.toLowerCase().replace(/[^a-z ]/g,'').split(/\s+/).filter(Boolean);
    var wb = b.toLowerCase().replace(/[^a-z ]/g,'').split(/\s+/).filter(Boolean);
    if (!wa.length || !wb.length) return 0;
    var inter = wa.filter(function(w){ return wb.indexOf(w) >= 0; }).length;
    var union  = new Set(wa.concat(wb)).size;
    var jaccard = inter / union;
    var prefix = 0;
    wa.forEach(function(w1){ wb.forEach(function(w2){
      var l = Math.min(w1.length, w2.length);
      if (l >= 4) {
        var m = 0;
        for (var k = 0; k < l; k++) { if (w1[k]===w2[k]) m++; else break; }
        prefix = Math.max(prefix, m / l);
      }
    }); });
    return Math.max(jaccard, prefix * 0.85);
  }

  async function checkNewStaffInbox() {
    try {
      if (!fs.existsSync(INBOX_DIR)) return;
      if (!fs.existsSync(INBOX_DONE_DIR)) fs.mkdirSync(INBOX_DONE_DIR, {recursive:true});

      var files = fs.readdirSync(INBOX_DIR).filter(function(f) {
        return f.endsWith('.json') && fs.statSync(path.join(INBOX_DIR, f)).isFile();
      });
      if (files.length === 0) return;

      var created = 0;
      for (const file of files) {
        var filePath = path.join(INBOX_DIR, file);
        try {
          var raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));

          // Build name from Surname + First Name
          var firstName = String(raw.firstName || raw['First Name'] || '').trim();
          var surname   = String(raw.surname   || raw['Surname']    || '').trim();
          var fullName  = (firstName + ' ' + surname).trim().toUpperCase();
          if (!fullName) { console.warn('[INBOX] Skipping ' + file + ': no name'); continue; }

          // Prevent duplicates — check existing staff
          var existing = loadAllStaff();
          var already = existing.find(function(e) {
            return String(e.name||'').toUpperCase() === fullName;
          });
          if (already) {
            console.log('[INBOX] Already exists: ' + fullName + ', skipping ' + file);
            fs.renameSync(filePath, path.join(INBOX_DONE_DIR, 'DUPLICATE_' + file));
            continue;
          }

          // Map employment history (Employer 1..10)
          var empHistory = [];
          for (var i = 1; i <= 10; i++) {
            var val = raw['employer' + i] || raw['Employer ' + i] || '';
            if (String(val).trim()) empHistory.push(String(val).trim());
          }

          // Parse date helper (dd/MM/yyyy or ISO)
          function parseDate(s) {
            if (!s) return null;
            s = String(s).trim();
            // dd/MM/yyyy
            var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (m) return m[3] + '-' + m[2].padStart(2,'0') + '-' + m[1].padStart(2,'0');
            // ISO already
            if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0,10);
            return null;
          }

          var emp = {
            id:            fullName.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now(),
            name:          fullName,
            email:         String(raw.email          || raw['Email']                        || '').trim(),
            phone:         String(raw.mobile          || raw['Mobile Number']               || raw.phone || '').trim(),
            phoneLandline: String(raw.telephone       || raw['Telephone Number']            || '').trim(),
            address: {
              current:      String(raw.address       || raw['Address']                     || '').trim(),
              movedIn:      parseDate(raw.dateMovedIn || raw['Date Moved in']),
              movedOut:     parseDate(raw.dateMovedOut|| raw['Date Moved out']),
              previous:     String(raw.previousAddress|| raw['Previous Address (If less than 3 years)'] || '').trim(),
              prevMovedIn:  parseDate(raw.prevDateMovedIn  || raw['Date Moved in_2']),
              prevMovedOut: parseDate(raw.prevDateMovedOut || raw['Date Moved out_2'])
            },
            placeOfBirth:  String(raw.placeOfBirth   || raw['Place Of Birth']              || '').trim(),
            ni:            String(raw.ni              || raw['National Insurance Number (only required for employees).'] || '').trim(),
            drivingLicence:String(raw.drivingLicence  || raw['Current Driving Licence Number (if Held)'] || '').trim(),
            cscs: {
              number: String(raw.cscs || raw['CSCS Card or Other Safety Body Registration Number'] || '').trim(),
              expiry: null
            },
            cscsQualification: String(raw.cscsQualification || raw['Construction Industry Qualification Held (i.e. labourer, banksman etc.)'] || '').trim(),
            sia:  { number: '', expiry: null },
            visa: {
              type:   String(raw.rtw  || raw['Do You Have The Right To Work In The UK?'] || '').trim(),
              expiry: null
            },
            bank: {
              accountNumber: String(raw.bankAccount || raw['Bank Account Number']        || '').trim(),
              sortCode:      String(raw.sortCode    || raw['Bank Account Sort Code']     || '').trim(),
              holder:        String(raw.bankHolder  || raw['Name Of Account Holder']     || '').trim(),
              bankName:      String(raw.bankName    || raw['Name Of Bank']               || '').trim()
            },
            criminal: {
              offences:      String(raw.criminal   || raw['Have You Ever Appeared Before A Court, Charged With A Criminal Or Military Offence ... Including Motoring Offences?'] || 'No').trim(),
              offenceDetails:String(raw.offenceDetails || raw['Please Give Details Below'] || '').trim(),
              bankrupt:      String(raw.bankrupt   || raw['Have you ever been made bankrupt?'] || 'No').trim(),
              ccj:           String(raw.ccj        || raw['Do you have any County Court Judgements against your name?'] || 'No').trim(),
              creditCheck:   String(raw.creditCheck|| raw['Do you object to TSC Ltd contacting a credit agency with reference to yourself ?'] || 'No').trim()
            },
            references: {
              ref1: {
                name:    String(raw.refName    || raw['Name of Professional Reference']                   || '').trim(),
                company: String(raw.refCompany || raw['Company Professional Reference Works For']         || '').trim(),
                address: String(raw.refAddress || raw['Work Address for Professional Reference']          || '').trim(),
                email:   String(raw.refEmail   || raw['Email Address of Professional Reference']          || '').trim(),
                phone:   String(raw.refPhone   || raw['Telephone Number of Professional Reference']       || '').trim(),
                status: 'Not Started'
              },
              ref2: { name:'', company:'', email:'', status:'Not Started' }
            },
            employmentHistory: empHistory,
            documentsAgreed:   String(raw.documentsAgreed || raw['Do you agree to upload the following files? Birth Certificate, Passport (if held), Proof of Right to Work (if not a UK citizen), Two recent utility bills, Driving Licence (if held), Passport photo for ID badge (plain background, clear face, no smiling), P45/P60 from last employment (if available)'] || '').trim(),
            contract:    '',
            induction:   false,
            status:      'active',
            deployStatus:'inactive',
            addedDate:   getTodayStr(),
            formSource:  'Microsoft Forms',
            formFile:    file
          };

          await saveStaff(emp, null);
          created++;
          console.log('[INBOX] Created staff record: ' + fullName);

          // Archive processed file
          fs.renameSync(filePath, path.join(INBOX_DONE_DIR, file));

        } catch(e) {
          console.error('[INBOX] Error processing ' + file + ':', e.message);
          // Move to Processed with ERROR_ prefix so it doesn't loop
          try { fs.renameSync(filePath, path.join(INBOX_DONE_DIR, 'ERROR_' + file)); } catch(_) {}
        }
      }

      if (created > 0) {
        console.log('[INBOX] ' + created + ' new staff record(s) created from form submissions.');
        scheduleGitPush('new staff from forms: ' + created);
      }
    } catch(e) {
      console.error('[INBOX] checkNewStaffInbox error:', e.message);
    }
  }

  async function autoDedup() {
    try {
      var staff = loadAllStaff();

      var archived = 0;
      var checked  = {};

      for (var i = 0; i < staff.length; i++) {
        for (var j = i + 1; j < staff.length; j++) {
          var key = i + '-' + j;
          if (checked[key]) continue;
          checked[key] = true;

          var a = staff[i], b = staff[j];
          var score = 0;

          var pa = normPhone(a.phone), pb = normPhone(b.phone);
          if (pa && pb && pa === pb && pa.length >= 7) score += 3;

          var ea = normEmail(a.email), eb = normEmail(b.email);
          if (ea && eb && ea === eb) score += 3;

          var sa = normSIA(a.sia && a.sia.number), sb = normSIA(b.sia && b.sia.number);
          if (sa && sb && sa === sb && sa !== '' && sa !== 'N/A') score += 4;

          var ns = nameSimilarity(a.name || '', b.name || '');
          if (ns >= 0.5) score += ns * 2;
          else if (ns >= 0.3) score += ns;

          if (score < 2.5) continue;

          // Keep the record with more complete name; archive the other.
          // 'duplicate' is a third status distinct from 'archived' (Ex-Staff)
          // on purpose — mirrors the old "Duplicate Archive" folder being
          // invisible to both Active Staff and Ex-Staff views (see
          // loadAllStaff()/loadExStaff()), so a dedup'd record never shows up
          // looking like a real leaver.
          var keepIdx = (a.name||'').length >= (b.name||'').length ? i : j;
          var dropIdx = keepIdx === i ? j : i;
          var keep = staff[keepIdx], drop = staff[dropIdx];

          if (!drop._pgId) continue;

          try {
            await pgPool.query("UPDATE employees SET status='duplicate', archived_at=NOW(), archive_reason='duplicate_record' WHERE id=$1", [drop._pgId]);
            await refreshStaffCacheEntry(drop._pgId);
            console.log('[DEDUP] Archived: ' + drop.name + ' — kept: ' + keep.name + ' (score ' + score.toFixed(1) + ')');
            archived++;
            staff.splice(dropIdx, 1);
            if (dropIdx <= i) i--;
            if (dropIdx <= j) j--;
          } catch(dbErr) {
            console.log('[DEDUP] Could not archive duplicate ' + drop.name + ':', dbErr.message);
          }
        }
      }

      if (archived > 0) {
        console.log('[DEDUP] Done — ' + archived + ' duplicate(s) archived.');
        scheduleGitPush('auto-dedup: ' + archived + ' duplicate(s) removed');
      } else {
        console.log('[DEDUP] No duplicates found.');
      }
    } catch(e) {
      console.error('[DEDUP] Error:', e.message);
    }
  }

  return {
    autoDedup: autoDedup,
    checkNewStaffInbox: checkNewStaffInbox,
  };
};
