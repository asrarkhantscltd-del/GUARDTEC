// Bell notifications, Web Push delivery and notification visibility rules.
//
// Loaded from server.js: mount(require('./lib/notifications')(deps))

var webpush = require('web-push');

module.exports = function notificationsLib(deps) {
  var pgPool = deps.pgPool,
    roleHasPermission = deps.roleHasPermission;

  // Web Push (real browser/phone push notifications, works even with the PWA
  // closed) — managers/directors only for now, hooked into createNotification()
  // below rather than each of its call sites, so every existing broadcast
  // event (staff upload, message, incident report, etc.) gets push for free.
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  } else {
    console.warn('[PUSH] VAPID keys not set — push notifications disabled.');
  }

  // Where tapping a push notification should land — mirrors the in-app bell's
  // goToNotification() routing in DashboardLayout.tsx (keep the two in step).
  function notificationUrl(opts) {
    if (opts.type === 'incident_report') return '/incident-reports';
    if (opts.type === 'profile_submission') return '/pending-review';
    if (opts.type === 'compliance_calendar_reminder') return '/compliance-calendar';
    if (opts.type === 'supplier_evaluation') return '/suppliers';
    var tab = opts.linkTab ? '?tab=' + encodeURIComponent(opts.linkTab) : '';
    if (opts.linkAgencyId) return '/admin/agencies/' + encodeURIComponent(opts.linkAgencyId) + tab;
    if (opts.linkStaffId) return '/staff/' + encodeURIComponent(opts.linkStaffId) + tab;
    return '/';
  }

  async function createNotification(opts) {
    try {
      await pgPool.query(
        `INSERT INTO notifications (type, actor_name, summary, link_staff_id, link_tab, link_incident_id, link_agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [opts.type, opts.actorName, opts.summary, opts.linkStaffId || null, opts.linkTab || null, opts.linkIncidentId || null, opts.linkAgencyId || null]
      );
    } catch (e) {
      console.error('[NOTIFY] failed to create notification:', e.message);
    }
    // Same broadcast audience as the bell feed above (every manager/director),
    // fired from this single choke point so none of createNotification()'s
    // six call sites need editing individually. Never let a push failure
    // affect the caller — the in-app notification above already succeeded.
    // Calendar reminders are personal (only the responsible person's devices);
    // every other event keeps the original "all subscribed managers" audience.
    pushToManagers(opts.summary, opts.type === 'compliance_calendar_reminder' ? { type: opts.type, summary: opts.summary } : null, notificationUrl(opts))
      .catch(function(e) { console.error('[PUSH] broadcast failed:', e.message); });
  }

  // Shared delivery loop for both pushToManagers and pushToUser below — sends
  // one payload to every given subscription row, cleaning up any the
  // browser/OS has revoked (uninstalled, permission withdrawn, etc.) rather
  // than retrying them forever on every future notification.
  async function deliverPush(subs, payload) {
    for (var i = 0; i < subs.length; i++) {
      var sub = subs[i];
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await pgPool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]);
        } else {
          console.error('[PUSH] send failed for subscription', sub.id, ':', e.message);
        }
      }
    }
  }

  // Broadcasts to every subscribed manager/director device — the bell feed's
  // existing audience (see notifications table above). Used for the six
  // existing createNotification() events, none of which have a specific
  // target person to narrow to.
  // Optional visibilityRow ({ type, summary }) narrows the audience to subscribers
  // who are allowed to see that notification (see canViewNotification); null =
  // everyone subscribed, as before.
  async function pushToManagers(body, visibilityRow, url) {
    if (!process.env.VAPID_PUBLIC_KEY) return; // not configured — no-op, not an error
    var subs = (await pgPool.query(
      'SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, u.role AS role, u.email AS email FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id'
    )).rows;
    if (visibilityRow) {
      var allowed = [];
      for (var i = 0; i < subs.length; i++) {
        var viewer = { email: subs[i].email, hasCalendarModule: await roleHasPermission(subs[i].role, 'compliance_calendar') };
        if (canViewNotification(visibilityRow, viewer)) allowed.push(subs[i]);
      }
      subs = allowed;
    }
    await deliverPush(subs, JSON.stringify({ title: 'GuardTec Compliance', body: body, url: url || '/' }));
  }

  // ── NOTIFICATION VISIBILITY (who may see which bell/push alert) ──────────────
  // Every notification type used to go to everyone holding `staff`. Compliance
  // calendar reminders are personal: they go only to the person(s) named in the
  // item's responsible_email (the reminder summary ends with ' — email, email'),
  // and only if their role also has the compliance_calendar module.
  // An item with NO responsible person has nobody to target, so it falls back to
  // everyone holding the module (the managers) rather than vanishing.
  var COMPANY_EMAIL_DOMAINS = ['firstcallsiteservices.co.uk', 'guardtec-security.co.uk', 'principalsecurityconsultants.com'];

  function splitEmails(s) {
    return String(s || '').toLowerCase().split(/[,;\s]+/).filter(Boolean);
  }

  // Two addresses are the same mailbox if identical, or if they have the same
  // name part and both are company domains (the staff roster has a primary
  // @firstcallsiteservices address plus an @guardtec-security alias for the same person).
  function sameMailbox(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    var ap = a.split('@'), bp = b.split('@');
    return ap.length === 2 && bp.length === 2 && ap[0] === bp[0] &&
      COMPANY_EMAIL_DOMAINS.indexOf(ap[1]) !== -1 && COMPANY_EMAIL_DOMAINS.indexOf(bp[1]) !== -1;
  }

  function calendarTargetsFromSummary(summary) {
    var s = String(summary || '');
    var i = s.lastIndexOf(' — ');
    return i === -1 ? '' : s.slice(i + 3);
  }

  // row = { type, summary }; viewer = { email, hasCalendarModule }
  function canViewNotification(row, viewer) {
    if (row.type !== 'compliance_calendar_reminder') return true;
    if (!viewer.hasCalendarModule) return false;
    var targets = splitEmails(calendarTargetsFromSummary(row.summary));
    if (!targets.length) return true;
    var mine = String(viewer.email || '').toLowerCase();
    return targets.some(function(t) { return sameMailbox(t, mine); });
  }

  return {
    canViewNotification: canViewNotification,
    createNotification: createNotification,
    deliverPush: deliverPush,
  };
};
