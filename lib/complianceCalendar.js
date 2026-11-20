// Compliance Calendar seed items and the reminder checker.
//
// Loaded from server.js: mount(require('./lib/complianceCalendar')(deps))

module.exports = function complianceCalendarLib(deps) {
  var createNotification = deps.createNotification,
    pgPool = deps.pgPool;

  // Route handlers for these three live further down (after app.use(cookieParser())
  // / app.use(express.json()) are registered) — see the "WEB PUSH — routes"
  // section below. Express runs middleware/routes in registration order, so
  // defining them up here (before the cookie/body parsers exist) meant
  // req.cookies and req.body were both undefined for every request to them;
  // found via testing (`/api/push/vapid-public-key` returned "Not logged in"
  // even for an authenticated browser session).

  // ── COMPLIANCE CALENDAR (recurring compliance tasks, own reminder cadence) ────
  // Independent of the SharePoint "Compliance Calendar" list + Power Automate flow
  // built the same day — this is a separate, in-app copy so Directors/Ops get
  // "due in 3 days" reminders through this app's own notification bell without
  // depending on that Microsoft 365 pipeline (or its pending admin-consent block).
  var DIRECTORS_4 = 'matt.hunter@firstcallsiteservices.co.uk, mark.jones@firstcallsiteservices.co.uk, Sid@guardtec-security.co.uk, paul.gough@guardtec-security.co.uk';

  // [title, description, responsible_email, due_date|null, recurrence_unit, recurrence_value, notes]
  var COMPLIANCE_CALENDAR_SEED = [
    ['Site File Audit', 'Quarterly audit of site files (Site File Calendar)', 'daniel.jones@firstcallsiteservices.co.uk, asrar.khan@firstcallsiteservices.co.uk', '2026-11-01', 'month', 3, 'Quarterly: Nov, Feb, May, Aug (exact day of month not specified in source)'],
    ['Client Feedback', 'Quarterly client feedback collection (Site File Calendar)', 'zeeshan@principalsecurityconsultants.com', '2026-10-01', 'month', 3, 'Quarterly: Jan, Apr, Jul, Oct. Responsible person updated 2026-09-04 (was previously unclear in source - listed as "All client")'],
    ['Supervisor Reports', 'Monthly supervisor reports (Site File Calendar)', 'daniel.jones@firstcallsiteservices.co.uk, joe.swain@firstcallsiteservices.co.uk, mark.jones@firstcallsiteservices.co.uk', '2026-09-30', 'month', 1, 'Every month'],
    ['Customer Satisfaction', 'Quarterly customer satisfaction review (Site File Calendar)', '', '2026-11-01', 'month', 3, 'Quarterly: Nov, Feb, May, Aug. Source noted this is "Not currently completed" - compliance gap, needs an owner assigned'],
    ['3rd Penetration Visits', 'Quarterly 3rd party penetration/site visits (Site File Calendar)', 'daniel.jones@firstcallsiteservices.co.uk, mark.jones@firstcallsiteservices.co.uk, joe.swain@firstcallsiteservices.co.uk', '2026-10-01', 'month', 3, 'Quarterly: Jan, Apr, Jul, Oct'],
    ['Refresher Training', 'Annual refresher training (HR Calendar)', 'aimee.hunter@firstcallsiteservices.co.uk', '2026-12-01', 'month', 12, 'Annual: December only'],
    ['Dip Testing', 'Quarterly dip testing (HR Calendar)', 'aimee.hunter@firstcallsiteservices.co.uk', '2026-09-30', 'month', 3, 'Quarterly: Mar, Jun, Sep, Dec'],
    ['Employee Feedback', 'Employee feedback collection (HR Calendar)', 'aimee.hunter@firstcallsiteservices.co.uk', '2026-09-30', 'month', 1, 'Full survey Mar/Jun/Sep/Dec, lighter "M&R" round Jan/Apr/Jul/Oct (abbreviation unclear in source - confirm with Asrar). Source listed responsible as "All staff and contractor" - assigned to Aimee as compiler'],
    ['Monthly Newsletter', 'Monthly staff newsletter (HR Calendar)', 'aimee.hunter@firstcallsiteservices.co.uk', '2026-09-30', 'month', 1, 'Every month'],
    ['Staff Appraisals & Promotions', 'Annual staff appraisals and promotions review (HR Calendar)', 'aimee.hunter@firstcallsiteservices.co.uk', '2026-12-01', 'month', 12, 'Annual: December only'],
    ['Filing Cabinet Checks', 'Filing cabinet checks (InfoSec Calendar)', 'asrar.khan@firstcallsiteservices.co.uk', '2026-09-30', 'month', 1, 'Every month - 2 checks in Mar/Jun/Sep/Dec, 1 check other months'],
    ['Change Laptop Passwords', 'Change passwords on all laptops (InfoSec Calendar)', 'asrar.khan@firstcallsiteservices.co.uk', '2026-11-01', 'month', 3, 'Quarterly: Nov, Feb, May, Aug'],
    ['Review SharePoint & WhatsApp Group Usage Log', 'Review SharePoint & WhatsApp group usage log (InfoSec Calendar)', 'matt.hunter@firstcallsiteservices.co.uk, asrar.khan@firstcallsiteservices.co.uk, Sid@guardtec-security.co.uk, mark.jones@firstcallsiteservices.co.uk', '2026-11-01', 'month', 3, 'Quarterly: Nov, Feb, May, Aug'],
    ['Business Continuity Manual Review', 'Annual business continuity manual review', DIRECTORS_4, '2027-06-01', 'month', 12, 'Annual: June only'],
    ['Disaster Recovery Review', 'Annual disaster recovery review', DIRECTORS_4, '2027-06-01', 'month', 12, 'Annual: June only'],
    ['Automated Cascade Exercise', 'Annual automated cascade exercise', DIRECTORS_4, '2027-06-01', 'month', 12, 'Annual: June only'],
    ['Business Recovery', 'Annual business recovery exercise', DIRECTORS_4, '2027-06-01', 'month', 12, 'Annual: June only'],
    ['Review of Business Continuity Plan & Test', 'Annual review and test of the business continuity plan', DIRECTORS_4, '2027-06-01', 'month', 12, 'Annual: June only'],
    ['Review all Manuals & Registers', 'Review of all manuals and registers', DIRECTORS_4, '2027-01-01', 'month', 6, 'Twice yearly: January & June'],
    ['Policy & Procedure Review', 'Policy and procedure review', DIRECTORS_4, '2027-01-01', 'month', 6, 'Twice yearly: January & June'],
    ['Internal Audits', 'Internal audits', DIRECTORS_4, '2027-01-01', 'month', 6, 'Twice yearly: January & June'],
    ['Management Review', 'Management review', DIRECTORS_4, '2027-01-01', 'month', 6, 'Twice yearly: January & June'],
    ['Sales Process Review', 'Sales process review', DIRECTORS_4, '2027-01-01', 'month', 6, 'Twice yearly: January & June'],
    ['Analysis of the Marketplace', 'Annual analysis of the marketplace (Internal & External Factors)', DIRECTORS_4, '2027-07-01', 'month', 12, 'Annual: July only'],
    ['Business Plan', 'Annual business plan review (Internal & External Factors)', DIRECTORS_4, null, 'month', 12, 'Annual - specific month not given in source data, confirm with Asrar'],
    ['Office Management Meetings', 'Weekly office management meeting, Mondays 2pm', DIRECTORS_4, '2026-09-07', 'week', 1, 'Weekly, every Monday at 2pm'],
    ['Management Review Meetings', 'Quarterly management review meeting', DIRECTORS_4, '2026-10-01', 'month', 3, 'Quarterly: January, April, July & October'],
  ];

  (async function ensureComplianceCalendarSchema() {
    try {
      await pgPool.query(`
      CREATE TABLE IF NOT EXISTS compliance_calendar_items (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title                   TEXT NOT NULL UNIQUE,
        description             TEXT,
        responsible_email       TEXT NOT NULL DEFAULT '',
        due_date                DATE,
        recurrence_unit         TEXT NOT NULL DEFAULT 'none' CHECK (recurrence_unit IN ('none','week','month')),
        recurrence_value        INTEGER NOT NULL DEFAULT 0,
        notes                   TEXT NOT NULL DEFAULT '',
        last_reminder_stage     TEXT,
        last_reminder_due_date  DATE,
        created_at              TIMESTAMPTZ DEFAULT NOW(),
        updated_at              TIMESTAMPTZ DEFAULT NOW()
      )
    `);
      await pgPool.query(`
      CREATE TABLE IF NOT EXISTS compliance_calendar_completions (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        item_id                 UUID NOT NULL REFERENCES compliance_calendar_items(id) ON DELETE CASCADE,
        completed_by            TEXT NOT NULL,
        due_date_at_completion  DATE,
        completed_at            TIMESTAMPTZ DEFAULT NOW()
      )
    `);
      await pgPool.query("CREATE INDEX IF NOT EXISTS idx_compliance_calendar_completions_item ON compliance_calendar_completions(item_id)");

      // One link per email address, reused on repeat requests — a responsible
      // person (often not a GuardTec app user at all, e.g. an external
      // solicitor) can bookmark this once and keep seeing their own due dates.
      // Same "256-bit token in the URL IS the security boundary" model as
      // acknowledgment_forms (server.js ~5824-5836), but deliberately NON-expiring
      // — that link is a single-use signature action, this one is a standing
      // reminder view meant to be revisited indefinitely.
      await pgPool.query(`
      CREATE TABLE IF NOT EXISTS compliance_calendar_share_links (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email       TEXT NOT NULL UNIQUE,
        token       TEXT NOT NULL UNIQUE,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
      await pgPool.query("CREATE INDEX IF NOT EXISTS idx_compliance_calendar_share_links_token ON compliance_calendar_share_links(token)");

      // One-time seed — same 27 rows populated into the SharePoint "Compliance
      // Calendar" list on 2026-09-04. UNIQUE(title) + ON CONFLICT means this is
      // safe to run on every boot; it only ever inserts rows that don't exist yet.
      for (var i = 0; i < COMPLIANCE_CALENDAR_SEED.length; i++) {
        var s = COMPLIANCE_CALENDAR_SEED[i];
        await pgPool.query(
          `INSERT INTO compliance_calendar_items (title, description, responsible_email, due_date, recurrence_unit, recurrence_value, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (title) DO NOTHING`,
          [s[0], s[1], s[2], s[3], s[4], s[5], s[6]]
        );
      }
    } catch (e) {
      console.error('[DB] compliance_calendar schema migration failed:', e.message);
    }
  })();

  async function checkComplianceCalendarReminders() {
    try {
      var result = await pgPool.query(
        `SELECT id, title, responsible_email, due_date, last_reminder_stage, last_reminder_due_date
       FROM compliance_calendar_items WHERE due_date IS NOT NULL`
      );
      var today = new Date(); today.setHours(0, 0, 0, 0);
      for (var i = 0; i < result.rows.length; i++) {
        var item = result.rows[i];
        try {
          var due = new Date(item.due_date); due.setHours(0, 0, 0, 0);
          var days = Math.round((due - today) / 86400000);
          var stage = days === 3 ? '3day' : days === 0 ? 'due_today' : days < 0 ? 'overdue' : null;
          if (!stage) continue;

          var dueChanged = String(item.last_reminder_due_date || '') !== String(item.due_date);
          var alreadySent = stage === item.last_reminder_stage && !dueChanged;
          // Overdue re-fires every run (once per 6h interval) regardless of
          // last_reminder_stage — an unresolved overdue item should keep
          // nudging the bell, not go silent after the first notice.
          if (stage !== 'overdue' && alreadySent) continue;

          var label = stage === '3day' ? 'due in 3 days' : stage === 'due_today' ? 'due today' : 'overdue';
          await createNotification({
            type: 'compliance_calendar_reminder',
            actorName: 'System',
            summary: '"' + item.title + '" is ' + label + (item.responsible_email ? ' — ' + item.responsible_email : '')
          });

          if (stage !== 'overdue') {
            await pgPool.query(
              'UPDATE compliance_calendar_items SET last_reminder_stage = $1, last_reminder_due_date = $2 WHERE id = $3',
              [stage, item.due_date, item.id]
            );
          }
        } catch (innerErr) {
          console.error('[COMPLIANCE-CALENDAR] reminder check failed for item ' + item.id + ':', innerErr.message);
        }
      }
    } catch (e) {
      console.error('[COMPLIANCE-CALENDAR] reminder job failed:', e.message);
    }
  }

  return {
    checkComplianceCalendarReminders: checkComplianceCalendarReminders,
  };
};
