// Event book-on: external/agency guards who work a standalone event book
// themselves on, per day, via a persistent per-person link — reading the
// assignment instruction, then submitting a live selfie + SIA badge photo.
// That photo-stamped record is the attendance proof used at payment time.
//
// Deliberately separate from the acknowledgment_forms e-signature flow in
// routes/eventInstructions.js: that one is 5-minute, one-time, drawn-signature,
// for people already in the system. This is multi-day, repeatable, photo-based,
// for people who are not. See lib/migrations.js ensureEventBookOnSchema.
//
// Registered from server.js: require('./routes/eventBookOn')(deps)

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var XLSX = require('xlsx');

module.exports = function registerEventBookOnRoutes(deps) {
  var app = deps.app,
    pgPool = deps.pgPool,
    BASE_URL = deps.BASE_URL,
    requireLogin = deps.requireLogin,
    requirePermission = deps.requirePermission,
    authRateLimiter = deps.authRateLimiter,
    getSiteById = deps.getSiteById,
    createNotification = deps.createNotification,
    EVENT_BOOK_ON_PHOTOS_DIR = deps.EVENT_BOOK_ON_PHOTOS_DIR;

  // "Today" from the event's point of view — the UK is where the guards are.
  // en-CA gives an ISO-style YYYY-MM-DD, which string-compares correctly.
  function ukToday() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  }

  // node-pg parses a DATE column into a JS Date at local midnight, so
  // String(date) gives "Mon Nov 23 2026 …", not an ISO date — slicing that is
  // wrong. Normalise any DATE value (Date object or ISO string) to YYYY-MM-DD.
  function toYMD(v) {
    if (!v) return null;
    if (v instanceof Date) {
      return v.getFullYear() + '-' +
        String(v.getMonth() + 1).padStart(2, '0') + '-' +
        String(v.getDate()).padStart(2, '0');
    }
    return String(v).slice(0, 10);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // UK display format: YYYY-MM-DD (or a Date) -> DD/MM/YYYY. Used in every
  // user-facing date (errors, PDF, Excel) so dates read day-first everywhere.
  function fmtUK(v) {
    var ymd = toYMD(v);
    if (!ymd) return '';
    var p = ymd.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  // assigned_dates comes back as a sorted text[] of YYYY-MM-DD via this SQL
  // expression, sidestepping DATE[]/timezone parsing surprises in node-pg.
  var ASSIGNED_DATES_SQL =
    "(SELECT array_agg(to_char(d,'YYYY-MM-DD') ORDER BY d) FROM unnest(es.assigned_dates) d) AS assigned_dates";

  // Normalise a list of incoming date strings: unique, valid YYYY-MM-DD, sorted.
  function cleanDates(arr) {
    if (!Array.isArray(arr)) return [];
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var d = String(arr[i] || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (isNaN(new Date(d + 'T00:00:00Z').getTime())) continue;
      if (seen[d]) continue;
      seen[d] = true;
      out.push(d);
    }
    out.sort();
    return out;
  }

  // Every assigned date must fall inside the event's own from/till range —
  // you cannot roster someone for a day the event is not running.
  function datesWithinEvent(dates, instruction) {
    var from = toYMD(instruction.event_date_from);
    var to = toYMD(instruction.event_date_to);
    if (!from || !to) return { ok: false, error: 'This event has no date range set — add From/Till dates first.' };
    for (var i = 0; i < dates.length; i++) {
      if (dates[i] < from || dates[i] > to) {
        return { ok: false, error: 'Date ' + fmtUK(dates[i]) + ' is outside the event range (' + fmtUK(from) + ' to ' + fmtUK(to) + ').' };
      }
    }
    return { ok: true };
  }

  // Decode a "data:image/...;base64,xxxx" URI (or a bare base64 string) to a
  // Buffer, enforcing it really is a JPEG/PNG by its magic bytes. Returns null
  // if it is neither — we never trust the client-declared mime type.
  function decodeImage(dataUri) {
    if (!dataUri || typeof dataUri !== 'string') return null;
    var base64 = dataUri.indexOf('base64,') !== -1 ? dataUri.split('base64,')[1] : dataUri;
    var buf;
    try { buf = Buffer.from(base64, 'base64'); } catch (e) { return null; }
    if (buf.length < 4) return null;
    var isPng = buf[0] === 0x89 && buf[1] === 0x50;
    var isJpg = buf[0] === 0xFF && buf[1] === 0xD8;
    if (!isPng && !isJpg) return null;
    return { buf: buf, ext: isPng ? '.png' : '.jpg', mime: isPng ? 'image/png' : 'image/jpeg' };
  }

  async function loadInstruction(id) {
    var r = await pgPool.query('SELECT * FROM event_instructions WHERE id = $1', [id]);
    return r.rows.length ? r.rows[0] : null;
  }

  // ── ADMIN: EVENT STAFF (roster external guards for a standalone event) ────────

  // List every rostered external guard for an instruction, with a per-day
  // book-on status so the panel can render the attendance matrix.
  app.get('/api/event-instructions/:id/event-staff', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var instruction = await loadInstruction(req.params.id);
      if (!instruction) return res.status(404).json({ ok: false, error: 'Instruction not found.' });

      var staff = (await pgPool.query(
        'SELECT es.id, es.name, es.mobile, es.sia_number, es.book_on_token, es.created_at, ' +
        ASSIGNED_DATES_SQL + ' FROM event_staff es WHERE es.instruction_id = $1 ORDER BY es.created_at',
        [req.params.id]
      )).rows;

      var bookOns = (await pgPool.query(
        'SELECT eb.id, eb.event_staff_id, to_char(eb.book_on_date,\'YYYY-MM-DD\') AS book_on_date, ' +
        'eb.booked_on_at, eb.sia_photo_path, eb.gps_lat, eb.gps_lng ' +
        'FROM event_book_ons eb JOIN event_staff es ON es.id = eb.event_staff_id WHERE es.instruction_id = $1',
        [req.params.id]
      )).rows;

      var byStaff = {};
      bookOns.forEach(function(b) { (byStaff[b.event_staff_id] = byStaff[b.event_staff_id] || []).push(b); });
      staff.forEach(function(s) {
        s.assigned_dates = s.assigned_dates || [];
        s.book_ons = byStaff[s.id] || [];
        s.book_on_url = BASE_URL + '/event-book-on/' + s.book_on_token;
      });

      res.json({ ok: true, staff: staff });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/event-instructions/:id/event-staff', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var instruction = await loadInstruction(req.params.id);
      if (!instruction) return res.status(404).json({ ok: false, error: 'Instruction not found.' });

      var b = req.body || {};
      var name = String(b.name || '').trim();
      if (!name) return res.status(400).json({ ok: false, error: 'Name is required.' });
      var mobile = b.mobile ? String(b.mobile).trim() : null;
      var siaNumber = b.sia_number ? String(b.sia_number).trim() : null;

      var dates = cleanDates(b.assigned_dates);
      if (!dates.length) return res.status(400).json({ ok: false, error: 'Select at least one assigned date.' });
      var within = datesWithinEvent(dates, instruction);
      if (!within.ok) return res.status(400).json({ ok: false, error: within.error });

      var token = crypto.randomBytes(32).toString('hex');
      var r = await pgPool.query(
        'INSERT INTO event_staff (instruction_id, name, mobile, sia_number, assigned_dates, book_on_token, created_by) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [req.params.id, name, mobile, siaNumber, dates, token, req.user.id]
      );
      res.json({ ok: true, id: r.rows[0].id, book_on_url: BASE_URL + '/event-book-on/' + token });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/event-instructions/:id/event-staff/:sid', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var instruction = await loadInstruction(req.params.id);
      if (!instruction) return res.status(404).json({ ok: false, error: 'Instruction not found.' });
      var existing = await pgPool.query('SELECT * FROM event_staff WHERE id = $1 AND instruction_id = $2', [req.params.sid, req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ ok: false, error: 'Event staff not found.' });
      var cur = existing.rows[0];

      var b = req.body || {};
      var name = b.name !== undefined ? String(b.name).trim() : cur.name;
      if (!name) return res.status(400).json({ ok: false, error: 'Name cannot be empty.' });
      var mobile = b.mobile !== undefined ? (String(b.mobile).trim() || null) : cur.mobile;
      var siaNumber = b.sia_number !== undefined ? (String(b.sia_number).trim() || null) : cur.sia_number;

      var dates;
      if (b.assigned_dates !== undefined) {
        dates = cleanDates(b.assigned_dates);
        if (!dates.length) return res.status(400).json({ ok: false, error: 'Select at least one assigned date.' });
        var within = datesWithinEvent(dates, instruction);
        if (!within.ok) return res.status(400).json({ ok: false, error: within.error });
        // A date already booked on cannot be removed — that is an attendance
        // record that must survive.
        var booked = (await pgPool.query(
          "SELECT to_char(book_on_date,'YYYY-MM-DD') AS d FROM event_book_ons WHERE event_staff_id = $1",
          [req.params.sid]
        )).rows.map(function(x) { return x.d; });
        for (var i = 0; i < booked.length; i++) {
          if (dates.indexOf(booked[i]) === -1) {
            return res.status(400).json({ ok: false, error: 'Cannot remove ' + fmtUK(booked[i]) + ' — this person already booked on that day.' });
          }
        }
      } else {
        dates = null;
      }

      await pgPool.query(
        'UPDATE event_staff SET name = $1, mobile = $2, sia_number = $3' +
        (dates ? ', assigned_dates = $5' : '') + ' WHERE id = $4',
        dates ? [name, mobile, siaNumber, req.params.sid, dates] : [name, mobile, siaNumber, req.params.sid]
      );
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.delete('/api/event-instructions/:id/event-staff/:sid', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var booked = await pgPool.query('SELECT COUNT(*)::int AS n FROM event_book_ons WHERE event_staff_id = $1', [req.params.sid]);
      if (booked.rows[0].n > 0) {
        return res.status(400).json({ ok: false, error: 'This person has booked on ' + booked.rows[0].n + ' day(s) — their attendance record must be kept. Edit their dates instead.' });
      }
      var r = await pgPool.query('DELETE FROM event_staff WHERE id = $1 AND instruction_id = $2', [req.params.sid, req.params.id]);
      if (!r.rowCount) return res.status(404).json({ ok: false, error: 'Event staff not found.' });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Serve a stored book-on photo (selfie or SIA badge) to an authed manager.
  app.get('/api/event-instructions/:id/book-on-photo/:bookOnId/:kind', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var kind = req.params.kind === 'sia' ? 'sia_photo_path' : 'selfie_path';
      var r = await pgPool.query(
        'SELECT eb.' + kind + ' AS fname FROM event_book_ons eb JOIN event_staff es ON es.id = eb.event_staff_id ' +
        'WHERE eb.id = $1 AND es.instruction_id = $2',
        [req.params.bookOnId, req.params.id]
      );
      if (!r.rows.length || !r.rows[0].fname) return res.status(404).end();
      var fp = path.join(EVENT_BOOK_ON_PHOTOS_DIR, path.basename(r.rows[0].fname));
      if (!fs.existsSync(fp)) return res.status(404).end();
      var ext = path.extname(fp).toLowerCase();
      res.setHeader('Content-Type', ext === '.png' ? 'image/png' : 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(fp));
    } catch (e) {
      res.status(500).end();
    }
  });

  // ── ADMIN: ATTENDANCE EXPORT ──────────────────────────────────────────────────
  async function buildAttendance(instructionId) {
    var instruction = await loadInstruction(instructionId);
    if (!instruction) return null;
    var staff = (await pgPool.query(
      'SELECT es.id, es.name, es.mobile, es.sia_number, ' + ASSIGNED_DATES_SQL +
      ' FROM event_staff es WHERE es.instruction_id = $1 ORDER BY es.name',
      [instructionId]
    )).rows;
    var bookOns = (await pgPool.query(
      "SELECT eb.id, eb.event_staff_id, to_char(eb.book_on_date,'YYYY-MM-DD') AS book_on_date, " +
      'eb.booked_on_at, eb.gps_lat, eb.gps_lng, eb.signature_data FROM event_book_ons eb ' +
      'JOIN event_staff es ON es.id = eb.event_staff_id WHERE es.instruction_id = $1',
      [instructionId]
    )).rows;
    var byStaff = {};
    bookOns.forEach(function(b) { (byStaff[b.event_staff_id] = byStaff[b.event_staff_id] || {})[b.book_on_date] = b; });
    // All event days, from the range.
    var days = [];
    if (instruction.event_date_from && instruction.event_date_to) {
      var d = new Date(toYMD(instruction.event_date_from) + 'T00:00:00Z');
      var end = new Date(toYMD(instruction.event_date_to) + 'T00:00:00Z');
      while (d <= end) { days.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
    }
    return { instruction: instruction, staff: staff, days: days, byStaff: byStaff };
  }

  app.get('/api/event-instructions/:id/attendance.xlsx', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var data = await buildAttendance(req.params.id);
      if (!data) return res.status(404).send('Instruction not found.');
      var header = ['Name', 'Mobile', 'SIA Number'];
      data.days.forEach(function(d) { header.push(fmtUK(d)); });
      header.push('Days Worked');
      var rows = [header];
      data.staff.forEach(function(s) {
        var assigned = s.assigned_dates || [];
        var row = [s.name, s.mobile || '', s.sia_number || ''];
        var worked = 0;
        data.days.forEach(function(d) {
          var b = (data.byStaff[s.id] || {})[d];
          if (b) { row.push('Booked ' + new Date(b.booked_on_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })); worked++; }
          else if (assigned.indexOf(d) !== -1) row.push('Did not book on');
          else row.push('—');
        });
        row.push(worked);
        rows.push(row);
      });
      var ws = XLSX.utils.aoa_to_sheet(rows);
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
      var buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="attendance-' + req.params.id + '.xlsx"');
      res.send(buf);
    } catch (e) {
      res.status(500).send('Error: ' + e.message);
    }
  });

  app.get('/api/event-instructions/:id/attendance.pdf', requireLogin, requirePermission('staff'), async function(req, res) {
    try {
      var data = await buildAttendance(req.params.id);
      if (!data) return res.status(404).send('Instruction not found.');
      var instruction = data.instruction;
      var site = instruction.site_id ? await getSiteById(instruction.site_id) : null;

      var cards = '';
      data.staff.forEach(function(s) {
        var assigned = s.assigned_dates || [];
        var dayRows = data.days.filter(function(d) { return assigned.indexOf(d) !== -1; }).map(function(d) {
          var b = (data.byStaff[s.id] || {})[d];
          if (b) {
            var t = new Date(b.booked_on_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' });
            var selfie = '/api/event-instructions/' + instruction.id + '/book-on-photo/' + b.id + '/selfie';
            var sia = '/api/event-instructions/' + instruction.id + '/book-on-photo/' + b.id + '/sia';
            var gps = (b.gps_lat != null && b.gps_lng != null) ? '<div class="gps">GPS: ' + esc(b.gps_lat) + ', ' + esc(b.gps_lng) + '</div>' : '';
            var sign = (b.signature_data && b.signature_data.indexOf('data:image') === 0)
              ? '<img src="' + b.signature_data + '" class="sign"/>' : '<span class="no">Not signed</span>';
            return '<tr><td>' + esc(fmtUK(d)) + '</td><td class="ok">Booked on — ' + esc(t) + gps + '</td>' +
              '<td><img src="' + selfie + '" class="ph"/></td>' +
              '<td><img src="' + sia + '" class="ph"/></td>' +
              '<td>' + sign + '</td></tr>';
          }
          return '<tr><td>' + esc(fmtUK(d)) + '</td><td class="no">Did not book on</td><td>—</td><td>—</td><td>—</td></tr>';
        }).join('');
        cards += '<div class="staff"><h3>' + esc(s.name) + (s.sia_number ? ' <span class="sia">SIA ' + esc(s.sia_number) + '</span>' : '') +
          '</h3>' + (s.mobile ? '<div class="mob">' + esc(s.mobile) + '</div>' : '') +
          '<table><thead><tr><th>Day</th><th>Status</th><th>Selfie</th><th>SIA badge</th><th>Signature</th></tr></thead><tbody>' +
          (dayRows || '<tr><td colspan="5">No assigned days.</td></tr>') + '</tbody></table></div>';
      });

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(
        '<!doctype html><html><head><meta charset="utf-8"><title>Attendance — ' + esc(instruction.title) + '</title>' +
        '<style>body{font-family:Arial,Helvetica,sans-serif;max-width:820px;margin:28px auto;padding:0 20px;color:#1a1a1a}' +
        'h1{font-size:20px;border-bottom:2px solid #c00;padding-bottom:8px}.meta{background:#f7f7f7;border-radius:6px;padding:12px 16px;margin:14px 0;font-size:14px}' +
        '.staff{border:1px solid #e5e5e5;border-radius:8px;padding:12px 16px;margin:16px 0;page-break-inside:avoid}h3{margin:0 0 4px;font-size:16px}' +
        '.sia{font-size:12px;color:#555;font-weight:normal}.mob{font-size:13px;color:#555;margin-bottom:8px}' +
        'table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #e5e5e5;padding:6px 8px;text-align:left;vertical-align:top}' +
        'th{background:#fafafa}.ok{color:#137333;font-weight:600}.no{color:#c00;font-weight:600}.gps{font-size:11px;color:#777;margin-top:2px}' +
        '.ph{max-width:120px;max-height:120px;border-radius:4px;border:1px solid #ddd}' +
        '.sign{max-width:140px;max-height:70px;border:1px solid #ddd;border-radius:4px;background:#fff;padding:2px}' +
        '@media print{body{margin:0}.staff{border-color:#ccc}}</style></head><body>' +
        '<h1>Event Attendance Record</h1>' +
        '<div class="meta"><div><strong>Event:</strong> ' + esc(instruction.title) + '</div>' +
        (site ? '<div><strong>Site:</strong> ' + esc(site.name) + '</div>' : '') +
        '<div><strong>Dates:</strong> ' + esc(fmtUK(instruction.event_date_from)) + ' to ' + esc(fmtUK(instruction.event_date_to)) + '</div></div>' +
        (cards || '<p><em>No event staff rostered.</em></p>') +
        '</body></html>'
      );
    } catch (e) {
      res.status(500).send('Error: ' + e.message);
    }
  });

  // ── PUBLIC: BOOK-ON (unauthenticated, token is the boundary) ──────────────────
  async function loadStaffByToken(token) {
    var r = await pgPool.query(
      'SELECT es.*, ' + ASSIGNED_DATES_SQL + ' FROM event_staff es WHERE es.book_on_token = $1',
      [token]
    );
    return r.rows.length ? r.rows[0] : null;
  }

  app.get('/api/event-book-on/:token', async function(req, res) {
    try {
      var staff = await loadStaffByToken(req.params.token);
      if (!staff) return res.status(404).json({ ok: false, error: 'Invalid link.' });
      var instruction = await loadInstruction(staff.instruction_id);
      if (!instruction) return res.status(404).json({ ok: false, error: 'Event not found.' });

      var today = ukToday();
      var to = toYMD(instruction.event_date_to);
      var assigned = staff.assigned_dates || [];

      var booked = (await pgPool.query(
        "SELECT to_char(book_on_date,'YYYY-MM-DD') AS d FROM event_book_ons WHERE event_staff_id = $1",
        [staff.id]
      )).rows.map(function(x) { return x.d; });

      var eventEnded = to ? today > to : false;
      var assignedToday = assigned.indexOf(today) !== -1;
      var bookedToday = booked.indexOf(today) !== -1;

      res.json({
        ok: true,
        staff_name: staff.name,
        today: today,
        assigned_dates: assigned,
        booked_dates: booked,
        assigned_today: assignedToday,
        booked_today: bookedToday,
        event_ended: eventEnded,
        can_book: assignedToday && !bookedToday && !eventEnded,
        // When the admin recorded an SIA number for this guard, book-on asks
        // them to type it and must match — a lightweight identity check so a
        // forwarded link cannot be used by someone else.
        sia_required: !!staff.sia_number,
        instruction: {
          id: instruction.id,
          title: instruction.title,
          instructions_html: instruction.instructions_html,
          requirements: instruction.requirements || [],
          event_date_from: instruction.event_date_from,
          event_date_to: instruction.event_date_to,
          has_document: !!instruction.document_file_url,
          document_mime_type: instruction.document_mime_type
        }
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Serve the instruction's attached document to the book-on holder (public,
  // token-scoped — mirrors the authed /document route but gated by the token).
  app.get('/api/event-book-on/:token/document', async function(req, res) {
    try {
      var staff = await loadStaffByToken(req.params.token);
      if (!staff) return res.status(404).end();
      var instruction = await loadInstruction(staff.instruction_id);
      if (!instruction || !instruction.document_file_url) return res.status(404).end();
      var exts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
      var dir = deps.EVENT_INSTRUCTIONS_DOCS_DIR;
      var fp = null;
      for (var i = 0; i < exts.length; i++) {
        var cand = path.join(dir, instruction.id + exts[i]);
        if (fs.existsSync(cand)) { fp = cand; break; }
      }
      if (!fp) return res.status(404).end();
      var ext = path.extname(fp).toLowerCase();
      res.setHeader('Content-Type', ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg');
      res.setHeader('Cache-Control', 'no-store');
      res.send(fs.readFileSync(fp));
    } catch (e) {
      res.status(500).end();
    }
  });

  app.post('/api/event-book-on/:token/book', authRateLimiter, async function(req, res) {
    try {
      var staff = await loadStaffByToken(req.params.token);
      if (!staff) return res.status(404).json({ ok: false, error: 'Invalid link.' });
      var instruction = await loadInstruction(staff.instruction_id);
      if (!instruction) return res.status(404).json({ ok: false, error: 'Event not found.' });

      var today = ukToday();
      var to = toYMD(instruction.event_date_to);
      var assigned = staff.assigned_dates || [];
      if (to && today > to) return res.status(403).json({ ok: false, error: 'This event has ended.' });
      if (assigned.indexOf(today) === -1) return res.status(403).json({ ok: false, error: 'You are not rostered for today.' });

      var b = req.body || {};

      // Identity check: when the admin recorded this guard's SIA number, they
      // must type a matching one here. Normalised (spaces/dashes stripped,
      // case-insensitive) so formatting differences don't block a real match.
      if (staff.sia_number) {
        var normalise = function(s) { return String(s || '').replace(/[\s-]/g, '').toUpperCase(); };
        if (normalise(b.sia_number) !== normalise(staff.sia_number)) {
          return res.status(403).json({ ok: false, error: 'SIA number does not match our records. Please check and try again.' });
        }
      }

      var selfie = decodeImage(b.selfie);
      if (!selfie) return res.status(400).json({ ok: false, error: 'A live selfie is required.' });
      var sia = decodeImage(b.sia_photo);
      if (!sia) return res.status(400).json({ ok: false, error: 'A photo of your SIA badge is required.' });

      // Drawn signature confirming they read the briefing — required, stored as
      // a base64 PNG data URI (same shape as the acknowledgment-form signature).
      var signatureData = (b.signature_data && String(b.signature_data).indexOf('data:image') === 0) ? String(b.signature_data) : null;
      if (!signatureData) return res.status(400).json({ ok: false, error: 'Please sign to confirm you have read the briefing.' });

      var selfieName = staff.id + '_' + today + '_selfie' + selfie.ext;
      var siaName = staff.id + '_' + today + '_sia' + sia.ext;
      var readDuration = (b.read_duration_seconds != null) ? Number(b.read_duration_seconds) : null;
      var gpsLat = (b.gps_lat != null && isFinite(b.gps_lat)) ? Number(b.gps_lat) : null;
      var gpsLng = (b.gps_lng != null && isFinite(b.gps_lng)) ? Number(b.gps_lng) : null;
      var ipAddress = req.ip || null;
      var userAgent = req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 500) : null;

      // Insert first (UNIQUE(event_staff_id, book_on_date) blocks a double
      // book-on atomically); only write the photo files once the row is ours.
      var ins;
      try {
        ins = await pgPool.query(
          'INSERT INTO event_book_ons (event_staff_id, book_on_date, selfie_path, sia_photo_path, signature_data, read_duration_seconds, ip_address, user_agent, gps_lat, gps_lng) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
          [staff.id, today, selfieName, siaName, signatureData, readDuration, ipAddress, userAgent, gpsLat, gpsLng]
        );
      } catch (err) {
        if (err.code === '23505') return res.status(409).json({ ok: false, error: 'You have already booked on for today.' });
        throw err;
      }

      fs.writeFileSync(path.join(EVENT_BOOK_ON_PHOTOS_DIR, selfieName), selfie.buf);
      fs.writeFileSync(path.join(EVENT_BOOK_ON_PHOTOS_DIR, siaName), sia.buf);

      // Tell the managers someone booked on (simple feed; they open the event
      // page to see who is still pending).
      if (createNotification) {
        createNotification({
          type: 'event_book_on',
          actorName: staff.name,
          summary: staff.name + ' booked on for "' + instruction.title + '" (' + fmtUK(today) + ')'
        });
      }

      res.json({ ok: true, book_on_id: ins.rows[0].id });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
};
