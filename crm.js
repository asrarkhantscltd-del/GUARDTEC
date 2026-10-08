// CRM — event-based lead tracking for Directors / Ops Managers (permission 'crm').
//
// Migrated from the standalone "GuardTec Stand CRM" (Supabase + Netlify, built
// for UK Construction Week 2026). Deliberately its OWN set of tables with no
// link to staff / sites / vetting data (no GDPR cross-contamination): the leads
// are prospective-client business contacts, kept apart from employee records.
//
// Model: one crm_event per trade show / campaign ("a new CRM" for each event),
// crm_leads belong to an event, crm_lead_activity is the per-lead history.
//
// Registered from server.js:  require('./crm')({ app, pgPool, requireLogin,
//   requirePermission, logAuditEvent, sendXlsx })

var DEFAULT_SERVICES = [
  'Manned guarding', 'CCTV & remote monitoring', 'Mobile patrol', 'Construction site security',
  'Key holding', 'Alarm response', 'Event security', 'Reception & concierge',
];
var DEFAULT_SOURCES = ['Walk-up at stand', 'Pre-booked meeting', 'Referral', 'Existing contact', 'Badge scan', 'Other'];
var DEFAULT_EMAIL_SUBJECT = 'GuardTec Security — following up from {event}';
var DEFAULT_EMAIL_BODY =
  'Hi {firstName},\n\nGreat to meet you at {event}. Thanks for your interest in {services}.\n\n' +
  '{nextAction}I\'d be glad to arrange a quick call to talk through how we can support you.\n\n' +
  'Best regards,\n{owner}\nGuardTec Security & Patrol UK Ltd';
var DEFAULT_SMS_BODY =
  'Hi {firstName}, great to meet you at {event} — GuardTec Security here. {nextAction}' +
  'Could we arrange a quick call about your security needs? Thanks!';

var STAGES = ['new', 'qualified', 'quote', 'won', 'lost'];
var STAGE_LABEL = { new: 'New', qualified: 'Qualified', quote: 'Quote sent', won: 'Won', lost: 'Lost' };
var RATINGS = ['', 'hot', 'warm', 'cold'];
var ACTIVITY_KINDS = ['email', 'text', 'call', 'note'];
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); }
function strArr(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  var out = [];
  v.forEach(function (x) {
    var s = str(x, maxLen || 120);
    if (s && out.indexOf(s) < 0 && out.length < (maxItems || 40)) out.push(s);
  });
  return out;
}
function dateOrNull(v) {
  var s = String(v == null ? '' : v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function money(v) {
  var n = Number(v);
  return isFinite(n) && n >= 0 ? Math.min(n, 1e10) : 0;
}
function isUuid(v) { return UUID_RE.test(String(v || '')); }

// 'pre' | 'd1'..'dN' | 'post' — which day of the event a lead was captured on.
function dayKey(ev, todayIso) {
  if (!ev || !ev.start_date || !ev.end_date) return 'pre';
  if (todayIso < ev.start_date) return 'pre';
  if (todayIso > ev.end_date) return 'post';
  var days = Math.round((Date.parse(todayIso) - Date.parse(ev.start_date)) / 86400000) + 1;
  return 'd' + days;
}

var EVENT_COLS =
  "id, name, venue, to_char(start_date,'YYYY-MM-DD') AS start_date, to_char(end_date,'YYYY-MM-DD') AS end_date, " +
  'services, sources, email_subject, email_body, sms_body, archived, created_by, created_at, updated_at';

var LEAD_COLS =
  'l.id, l.event_id, l.company, l.contact_name, l.job_title, l.email, l.phone, l.source, l.services, l.site_type, ' +
  "l.region, l.value, l.start_expected, l.rating, l.stage, l.show_day, to_char(l.follow_up,'YYYY-MM-DD') AS follow_up, " +
  'l.owner, l.next_action, l.tags, l.notes, l.last_contact, l.deleted_at, l.created_by, l.created_at, l.updated_at, ' +
  "COALESCE((SELECT json_agg(json_build_object('id', a.id, 'kind', a.kind, 'text', a.text, 'by', a.by_user, 'ts', a.created_at) " +
  'ORDER BY a.created_at DESC) FROM (SELECT * FROM crm_lead_activity WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 80) a), ' +
  "'[]'::json) AS activity";

module.exports = function registerCrm(deps) {
  var app = deps.app;
  var pgPool = deps.pgPool;
  var requireLogin = deps.requireLogin;
  var requirePermission = deps.requirePermission;
  var logAuditEvent = deps.logAuditEvent;
  var sendXlsx = deps.sendXlsx;
  var guard = [requireLogin, requirePermission('crm')];

  function actor(req) { return str((req.user && (req.user.full_name || req.user.name || req.user.username)) || 'Unknown', 120); }
  function today() { return new Date().toISOString().slice(0, 10); }

  // ── Schema ────────────────────────────────────────────────────────────────
  (async function ensureCrmSchema() {
    try {
      await pgPool.query(
        'CREATE TABLE IF NOT EXISTS crm_events (' +
        'id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, venue TEXT NOT NULL DEFAULT \'\', ' +
        'start_date DATE, end_date DATE, services TEXT[] NOT NULL DEFAULT \'{}\', sources TEXT[] NOT NULL DEFAULT \'{}\', ' +
        'email_subject TEXT NOT NULL DEFAULT \'\', email_body TEXT NOT NULL DEFAULT \'\', sms_body TEXT NOT NULL DEFAULT \'\', ' +
        'archived BOOLEAN NOT NULL DEFAULT FALSE, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())'
      );
      await pgPool.query(
        'CREATE TABLE IF NOT EXISTS crm_leads (' +
        'id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_id UUID NOT NULL REFERENCES crm_events(id) ON DELETE CASCADE, ' +
        'company TEXT NOT NULL, contact_name TEXT NOT NULL DEFAULT \'\', job_title TEXT NOT NULL DEFAULT \'\', ' +
        'email TEXT NOT NULL DEFAULT \'\', phone TEXT NOT NULL DEFAULT \'\', source TEXT NOT NULL DEFAULT \'\', ' +
        'services TEXT[] NOT NULL DEFAULT \'{}\', site_type TEXT NOT NULL DEFAULT \'\', region TEXT NOT NULL DEFAULT \'\', ' +
        'value NUMERIC(14,2) NOT NULL DEFAULT 0, start_expected TEXT NOT NULL DEFAULT \'\', ' +
        'rating TEXT NOT NULL DEFAULT \'\' CHECK (rating IN (\'\',\'hot\',\'warm\',\'cold\')), ' +
        'stage TEXT NOT NULL DEFAULT \'new\' CHECK (stage IN (\'new\',\'qualified\',\'quote\',\'won\',\'lost\')), ' +
        'show_day TEXT NOT NULL DEFAULT \'pre\', follow_up DATE, owner TEXT NOT NULL DEFAULT \'\', ' +
        'next_action TEXT NOT NULL DEFAULT \'\', tags TEXT[] NOT NULL DEFAULT \'{}\', notes TEXT NOT NULL DEFAULT \'\', ' +
        'last_contact TIMESTAMPTZ, deleted_at TIMESTAMPTZ, created_by TEXT, ' +
        'created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())'
      );
      await pgPool.query(
        'CREATE TABLE IF NOT EXISTS crm_lead_activity (' +
        'id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE, ' +
        'kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT \'\', by_user TEXT NOT NULL DEFAULT \'\', created_at TIMESTAMPTZ DEFAULT NOW())'
      );
      await pgPool.query('CREATE INDEX IF NOT EXISTS idx_crm_leads_event ON crm_leads(event_id)');
      await pgPool.query('CREATE INDEX IF NOT EXISTS idx_crm_activity_lead ON crm_lead_activity(lead_id, created_at)');
      await pgPool.query('CREATE TABLE IF NOT EXISTS crm_meta (key TEXT PRIMARY KEY, value TEXT)');

      // 'crm' permission for roles that already exist in the live DB (the
      // roles seed uses ON CONFLICT DO NOTHING, so a new JSONB key never
      // reaches them on its own). Directors + Ops Managers get it by default;
      // everyone else starts without, and a Director can toggle it per role in
      // Manage Roles.
      await pgPool.query(
        "UPDATE roles SET permissions = permissions || jsonb_build_object('crm', slug IN ('director','ops_manager')) " +
        "WHERE NOT (permissions ? 'crm')"
      );

      await seedUkcw2026();
    } catch (e) {
      console.error('[DB] crm schema migration failed:', e.message);
    }
  })();

  // One-time copy of the leads that lived in the old Supabase "GuardTec Stand
  // CRM" (the "JOJO" test lead was deliberately left out). Guarded by crm_meta
  // so it runs once and never resurrects anything a user later deletes.
  async function seedUkcw2026() {
    var done = await pgPool.query("SELECT 1 FROM crm_meta WHERE key = 'seed_ukcw_2026'");
    if (done.rows.length) return;
    var ev = await pgPool.query(
      'INSERT INTO crm_events (name, venue, start_date, end_date, services, sources, email_subject, email_body, sms_body, created_by) ' +
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',
      ['UK Construction Week 2026', 'NEC Birmingham', '2026-09-29', '2026-10-01', DEFAULT_SERVICES, DEFAULT_SOURCES,
       DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_BODY, DEFAULT_SMS_BODY, 'Imported from Supabase CRM']
    );
    var eventId = ev.rows[0].id;
    var seeds = [
      {
        company: 'PRINCIPAL SECURITY CONSULTANTS', contact: 'SADDIQUE KHAN', title: 'MANAGING DIRECTOR',
        email: 'SID@PRINCIPALSECURITYCONSULTANTS.COM', phone: '07380671002', region: 'REDBOURNE', site: 'UNION PARK',
        services: ['Manned guarding', 'CCTV & remote monitoring', 'Mobile patrol', 'Construction site security', 'Event security'],
        created: 1790089230729, updated: 1790596617172,
        activity: [
          [1790089230729, 'created', 'Lead created'],
          [1790154641557, 'edit', 'Company: Test Run → PRINCIPAL SECURITY CONSULTANTS'],
          [1790154641557, 'edit', 'Contact: MK → SADDIQUE KHAN'],
          [1790154719658, 'edit', 'Contact: SADDIQUE KHAN → Saddique khan'],
          [1790154743928, 'edit', 'Contact: Saddique khan → SADDIQUE KHAN'],
          [1790596617172, 'edit', 'Services updated'],
        ],
      },
      {
        company: 'FIRST CALL SITE SERVICES', contact: 'MATTHEW HUNTER', title: 'MANAGING DIRECTOR',
        email: 'MATT@FIRSTCALLSITESERVICES.CO.UK', phone: '07307381718', region: 'Slough', site: 'NAV NAT CENTER',
        services: ['Mobile patrol', 'Key holding', 'Alarm response'],
        created: 1790089306394, updated: 1790154760709,
        activity: [
          [1790089306394, 'created', 'Lead created'],
          [1790096204687, 'text', 'Follow-up text started'],
          [1790154555315, 'edit', 'Company: Test Run 2 → First call site services'],
          [1790154555315, 'edit', 'Contact: AK → MATTHEW HUNTER'],
          [1790154760709, 'edit', 'Company: First call site services → FIRST CALL SITE SERVICES'],
        ],
      },
    ];
    for (var i = 0; i < seeds.length; i++) {
      var s = seeds[i];
      var lr = await pgPool.query(
        'INSERT INTO crm_leads (event_id, company, contact_name, job_title, email, phone, source, services, site_type, region, ' +
        "rating, stage, show_day, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,'Walk-up at stand',$7,$8,$9,'hot','new','pre',$10,$11,$12) RETURNING id",
        [eventId, s.company, s.contact, s.title, s.email, s.phone, s.services, s.site, s.region, 'Imported from Supabase CRM',
         new Date(s.created), new Date(s.updated)]
      );
      for (var j = 0; j < s.activity.length; j++) {
        await pgPool.query(
          'INSERT INTO crm_lead_activity (lead_id, kind, text, by_user, created_at) VALUES ($1,$2,$3,$4,$5)',
          [lr.rows[0].id, s.activity[j][1], s.activity[j][2], '', new Date(s.activity[j][0])]
        );
      }
    }
    await pgPool.query("INSERT INTO crm_meta (key, value) VALUES ('seed_ukcw_2026', NOW()::text)");
    console.log('[CRM] Imported 2 leads from the old Supabase CRM into "UK Construction Week 2026"');
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function readEventBody(b, existing) {
    var o = existing || {};
    function pick(k, fallback) { return b[k] !== undefined ? b[k] : fallback; }
    var services = strArr(pick('services', o.services), 40, 80);
    var sources = strArr(pick('sources', o.sources), 20, 80);
    return {
      name: str(pick('name', o.name), 160),
      venue: str(pick('venue', o.venue), 160),
      start_date: dateOrNull(pick('start_date', o.start_date)),
      end_date: dateOrNull(pick('end_date', o.end_date)),
      services: services.length ? services : DEFAULT_SERVICES,
      sources: sources.length ? sources : DEFAULT_SOURCES,
      email_subject: str(pick('email_subject', o.email_subject), 300) || DEFAULT_EMAIL_SUBJECT,
      email_body: str(pick('email_body', o.email_body), 4000) || DEFAULT_EMAIL_BODY,
      sms_body: str(pick('sms_body', o.sms_body), 1000) || DEFAULT_SMS_BODY,
      archived: b.archived !== undefined ? !!b.archived : !!o.archived,
    };
  }

  app.get('/api/crm/events', guard, async function (req, res) {
    try {
      var r = await pgPool.query(
        'SELECT ' + EVENT_COLS + ', ' +
        '(SELECT COUNT(*)::int FROM crm_leads l WHERE l.event_id = e.id AND l.deleted_at IS NULL) AS lead_count, ' +
        "(SELECT COUNT(*)::int FROM crm_leads l WHERE l.event_id = e.id AND l.deleted_at IS NULL AND l.rating = 'hot') AS hot_count, " +
        "(SELECT COUNT(*)::int FROM crm_leads l WHERE l.event_id = e.id AND l.deleted_at IS NULL AND l.stage = 'won') AS won_count " +
        'FROM crm_events e ORDER BY e.archived ASC, e.start_date DESC NULLS LAST, e.created_at DESC'
      );
      res.json({ ok: true, events: r.rows, defaults: {
        services: DEFAULT_SERVICES, sources: DEFAULT_SOURCES,
        email_subject: DEFAULT_EMAIL_SUBJECT, email_body: DEFAULT_EMAIL_BODY, sms_body: DEFAULT_SMS_BODY,
      } });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/crm/events', guard, async function (req, res) {
    try {
      var d = readEventBody(req.body || {});
      if (!d.name) return res.status(400).json({ ok: false, error: 'Event name is required' });
      if (d.start_date && d.end_date && d.end_date < d.start_date) {
        return res.status(400).json({ ok: false, error: 'End date cannot be before the start date' });
      }
      var r = await pgPool.query(
        'INSERT INTO crm_events (name, venue, start_date, end_date, services, sources, email_subject, email_body, sms_body, created_by) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ' + EVENT_COLS,
        [d.name, d.venue, d.start_date, d.end_date, d.services, d.sources, d.email_subject, d.email_body, d.sms_body, actor(req)]
      );
      await logAuditEvent(req, 'crm_event_created', 'crm_event', r.rows[0].id, d.name, {});
      res.json({ ok: true, event: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.patch('/api/crm/events/:id', guard, async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Event not found' });
      var cur = await pgPool.query('SELECT ' + EVENT_COLS + ' FROM crm_events WHERE id = $1', [req.params.id]);
      if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'Event not found' });
      var d = readEventBody(req.body || {}, cur.rows[0]);
      if (!d.name) return res.status(400).json({ ok: false, error: 'Event name is required' });
      if (d.start_date && d.end_date && d.end_date < d.start_date) {
        return res.status(400).json({ ok: false, error: 'End date cannot be before the start date' });
      }
      var r = await pgPool.query(
        'UPDATE crm_events SET name=$1, venue=$2, start_date=$3, end_date=$4, services=$5, sources=$6, email_subject=$7, ' +
        'email_body=$8, sms_body=$9, archived=$10, updated_at=NOW() WHERE id=$11 RETURNING ' + EVENT_COLS,
        [d.name, d.venue, d.start_date, d.end_date, d.services, d.sources, d.email_subject, d.email_body, d.sms_body, d.archived, req.params.id]
      );
      res.json({ ok: true, event: r.rows[0] });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Deleting an event wipes every lead in it, so it is Director-only (same
  // bar as other permanent deletes) and always audit-logged.
  app.delete('/api/crm/events/:id', guard, async function (req, res) {
    try {
      if (req.user.role !== 'director') return res.status(403).json({ ok: false, error: 'Only a Director can permanently delete an event' });
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Event not found' });
      var cur = await pgPool.query('SELECT name, (SELECT COUNT(*)::int FROM crm_leads WHERE event_id = $1) AS leads FROM crm_events WHERE id = $1', [req.params.id]);
      if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'Event not found' });
      await pgPool.query('DELETE FROM crm_events WHERE id = $1', [req.params.id]);
      await logAuditEvent(req, 'crm_event_deleted', 'crm_event', req.params.id, cur.rows[0].name, { leads_deleted: cur.rows[0].leads });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── Leads ─────────────────────────────────────────────────────────────────
  app.get('/api/crm/events/:id/leads', guard, async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Event not found' });
      var trash = req.query.trash === '1';
      var r = await pgPool.query(
        'SELECT ' + LEAD_COLS + ' FROM crm_leads l WHERE l.event_id = $1 AND l.deleted_at IS ' + (trash ? 'NOT NULL' : 'NULL') +
        ' ORDER BY ' + (trash ? 'l.deleted_at DESC' : 'l.created_at DESC'),
        [req.params.id]
      );
      res.json({ ok: true, leads: r.rows });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  function readLeadBody(b, o) {
    o = o || {};
    function pick(k, fallback) { return b[k] !== undefined ? b[k] : fallback; }
    var stage = pick('stage', o.stage || 'new');
    var rating = pick('rating', o.rating || '');
    return {
      company: str(pick('company', o.company), 200),
      contact_name: str(pick('contact_name', o.contact_name), 160),
      job_title: str(pick('job_title', o.job_title), 160),
      email: str(pick('email', o.email), 200),
      phone: str(pick('phone', o.phone), 60),
      source: str(pick('source', o.source), 80),
      services: strArr(pick('services', o.services), 40, 80),
      site_type: str(pick('site_type', o.site_type), 200),
      region: str(pick('region', o.region), 200),
      value: money(pick('value', o.value)),
      start_expected: str(pick('start_expected', o.start_expected), 80),
      rating: RATINGS.indexOf(rating) >= 0 ? rating : '',
      stage: STAGES.indexOf(stage) >= 0 ? stage : 'new',
      show_day: str(pick('show_day', o.show_day || 'pre'), 10) || 'pre',
      follow_up: dateOrNull(pick('follow_up', o.follow_up)),
      owner: str(pick('owner', o.owner), 60),
      next_action: str(pick('next_action', o.next_action), 300),
      tags: strArr(pick('tags', o.tags), 20, 40),
      notes: str(pick('notes', o.notes), 8000),
    };
  }

  async function addActivity(leadId, kind, text, by) {
    await pgPool.query('INSERT INTO crm_lead_activity (lead_id, kind, text, by_user) VALUES ($1,$2,$3,$4)', [leadId, kind, str(text, 600), by]);
  }

  async function loadLead(id) {
    var r = await pgPool.query('SELECT ' + LEAD_COLS + ' FROM crm_leads l WHERE l.id = $1', [id]);
    return r.rows[0] || null;
  }

  app.post('/api/crm/events/:id/leads', guard, async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Event not found' });
      var evr = await pgPool.query('SELECT ' + EVENT_COLS + ' FROM crm_events WHERE id = $1', [req.params.id]);
      if (!evr.rows.length) return res.status(404).json({ ok: false, error: 'Event not found' });
      var b = req.body || {};
      var d = readLeadBody(b);
      if (!d.company) return res.status(400).json({ ok: false, error: 'Company name is required' });
      if (b.show_day === undefined) d.show_day = dayKey(evr.rows[0], today());
      if (!d.owner) d.owner = '';
      var by = actor(req);
      var r = await pgPool.query(
        'INSERT INTO crm_leads (event_id, company, contact_name, job_title, email, phone, source, services, site_type, region, value, ' +
        'start_expected, rating, stage, show_day, follow_up, owner, next_action, tags, notes, created_by) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id',
        [req.params.id, d.company, d.contact_name, d.job_title, d.email, d.phone, d.source, d.services, d.site_type, d.region, d.value,
         d.start_expected, d.rating, d.stage, d.show_day, d.follow_up, d.owner, d.next_action, d.tags, d.notes, by]
      );
      await addActivity(r.rows[0].id, 'created', b.quick ? 'Quick-captured' : 'Lead created', by);
      res.json({ ok: true, lead: await loadLead(r.rows[0].id) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.patch('/api/crm/leads/:id', guard, async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Lead not found' });
      var cur = await loadLead(req.params.id);
      if (!cur) return res.status(404).json({ ok: false, error: 'Lead not found' });
      var d = readLeadBody(req.body || {}, cur);
      if (!d.company) return res.status(400).json({ ok: false, error: 'Company name is required' });
      var by = actor(req);

      var notes = [];
      if (d.company !== cur.company) notes.push(['edit', 'Company: ' + cur.company + ' → ' + d.company]);
      if (d.contact_name !== cur.contact_name) notes.push(['edit', 'Contact: ' + (cur.contact_name || '—') + ' → ' + (d.contact_name || '—')]);
      if (d.stage !== cur.stage) notes.push(['stage', 'Moved to ' + STAGE_LABEL[d.stage]]);
      if (d.rating !== cur.rating) notes.push(['edit', 'Rating: ' + (cur.rating || '—') + ' → ' + (d.rating || '—')]);
      if ((d.follow_up || '') !== (cur.follow_up || '')) notes.push(['edit', 'Follow-up date: ' + (cur.follow_up || '—') + ' → ' + (d.follow_up || '—')]);
      if (Number(d.value) !== Number(cur.value)) notes.push(['edit', 'Value: £' + Number(cur.value) + ' → £' + d.value]);
      if (JSON.stringify(d.services.slice().sort()) !== JSON.stringify((cur.services || []).slice().sort())) notes.push(['edit', 'Services updated']);

      await pgPool.query(
        'UPDATE crm_leads SET company=$1, contact_name=$2, job_title=$3, email=$4, phone=$5, source=$6, services=$7, site_type=$8, ' +
        'region=$9, value=$10, start_expected=$11, rating=$12, stage=$13, show_day=$14, follow_up=$15, owner=$16, next_action=$17, ' +
        'tags=$18, notes=$19, updated_at=NOW() WHERE id=$20',
        [d.company, d.contact_name, d.job_title, d.email, d.phone, d.source, d.services, d.site_type, d.region, d.value,
         d.start_expected, d.rating, d.stage, d.show_day, d.follow_up, d.owner, d.next_action, d.tags, d.notes, req.params.id]
      );
      for (var i = 0; i < notes.length; i++) await addActivity(req.params.id, notes[i][0], notes[i][1], by);
      res.json({ ok: true, lead: await loadLead(req.params.id) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Logs a follow-up (email/text/call/note) and stamps last_contact.
  app.post('/api/crm/leads/:id/activity', guard, async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Lead not found' });
      var kind = ACTIVITY_KINDS.indexOf((req.body || {}).kind) >= 0 ? req.body.kind : 'note';
      var text = str((req.body || {}).text, 600);
      if (!text) return res.status(400).json({ ok: false, error: 'Text is required' });
      var cur = await pgPool.query('SELECT 1 FROM crm_leads WHERE id = $1', [req.params.id]);
      if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found' });
      await addActivity(req.params.id, kind, text, actor(req));
      await pgPool.query('UPDATE crm_leads SET last_contact = NOW(), updated_at = NOW() WHERE id = $1', [req.params.id]);
      res.json({ ok: true, lead: await loadLead(req.params.id) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Quick stage move from the board (drag / dropdown).
  app.post('/api/crm/leads/:id/stage', guard, async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Lead not found' });
      var stage = (req.body || {}).stage;
      if (STAGES.indexOf(stage) < 0) return res.status(400).json({ ok: false, error: 'Invalid stage' });
      var cur = await pgPool.query('SELECT stage FROM crm_leads WHERE id = $1', [req.params.id]);
      if (!cur.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found' });
      if (cur.rows[0].stage !== stage) {
        await pgPool.query('UPDATE crm_leads SET stage = $1, updated_at = NOW() WHERE id = $2', [stage, req.params.id]);
        await addActivity(req.params.id, 'stage', 'Moved to ' + STAGE_LABEL[stage], actor(req));
      }
      res.json({ ok: true, lead: await loadLead(req.params.id) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/crm/leads/:id/trash', guard, async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Lead not found' });
      var r = await pgPool.query('UPDATE crm_leads SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING company', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found' });
      await addActivity(req.params.id, 'note', 'Moved to trash', actor(req));
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/crm/leads/:id/restore', guard, async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Lead not found' });
      var r = await pgPool.query('UPDATE crm_leads SET deleted_at = NULL, updated_at = NOW() WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found in trash' });
      await addActivity(req.params.id, 'note', 'Restored from trash', actor(req));
      res.json({ ok: true, lead: await loadLead(req.params.id) });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Permanent delete — trash only, Director only, audit-logged. Personal data
  // of prospects must be erasable on request (UK GDPR Art. 17).
  app.delete('/api/crm/leads/:id', guard, async function (req, res) {
    try {
      if (req.user.role !== 'director') return res.status(403).json({ ok: false, error: 'Only a Director can permanently delete a lead' });
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Lead not found' });
      var r = await pgPool.query('DELETE FROM crm_leads WHERE id = $1 AND deleted_at IS NOT NULL RETURNING company, event_id', [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'Move the lead to the trash first' });
      await logAuditEvent(req, 'crm_lead_deleted', 'crm_lead', req.params.id, r.rows[0].company, { event_id: r.rows[0].event_id });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── Export ────────────────────────────────────────────────────────────────
  app.get('/api/crm/events/:id/export', guard, async function (req, res) {
    try {
      if (!isUuid(req.params.id)) return res.status(404).json({ ok: false, error: 'Event not found' });
      var evr = await pgPool.query('SELECT ' + EVENT_COLS + ' FROM crm_events WHERE id = $1', [req.params.id]);
      if (!evr.rows.length) return res.status(404).json({ ok: false, error: 'Event not found' });
      var ev = evr.rows[0];
      var lr = await pgPool.query(
        "SELECT l.*, to_char(l.follow_up,'YYYY-MM-DD') AS follow_up_text FROM crm_leads l WHERE l.event_id = $1 AND l.deleted_at IS NULL ORDER BY l.created_at ASC",
        [req.params.id]
      );
      var rows = lr.rows.map(function (l) {
        return {
          'Company': l.company, 'Contact': l.contact_name, 'Job title': l.job_title, 'Email': l.email, 'Phone': l.phone,
          'Services': (l.services || []).join('; '), 'Site / project': l.site_type, 'Region': l.region,
          'Est. value (£)': Number(l.value) || 0, 'Expected start': l.start_expected, 'Rating': l.rating,
          'Stage': STAGE_LABEL[l.stage] || l.stage, 'Show day': l.show_day, 'Follow-up date': l.follow_up_text || '',
          'Next action': l.next_action, 'Source': l.source, 'Owner': l.owner, 'Tags': (l.tags || []).join('; '), 'Notes': l.notes,
        };
      });
      var base = 'GuardTec-CRM-' + ev.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + today();
      await logAuditEvent(req, 'crm_export', 'crm_event', ev.id, ev.name, { rows: rows.length, format: req.query.format === 'csv' ? 'csv' : 'xlsx' });
      if (req.query.format === 'csv') {
        var cols = rows.length ? Object.keys(rows[0]) : ['Company'];
        var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
        var csv = '﻿' + [cols.map(q).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c]); }).join(','); })).join('\r\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="' + base + '.csv"');
        return res.send(csv);
      }
      sendXlsx(res, base + '.xlsx', rows.length ? rows : [{ 'Company': '' }]);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });
};
