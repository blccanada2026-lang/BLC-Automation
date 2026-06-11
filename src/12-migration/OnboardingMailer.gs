// ============================================================
// OnboardingMailer.gs — BLC Nexus T12 Migration
// src/12-migration/OnboardingMailer.gs
//
// Sends role-specific portal onboarding letters + cutoff
// announcement to all active staff before the June 16 launch.
//
// USAGE (run from Apps Script editor):
//   runSendCutoffAnnouncement()         — cutoff email to ALL staff
//   runSendAllOnboarding()              — role guides to all staff
//   runSendOnboardingForRole('DESIGNER')
//   runSendOnboardingForRole('TEAM_LEAD')
//   runSendOnboardingForRole('PM')
// ============================================================

/**
 * Sends the go-live cutoff announcement to every active staff member.
 * Send this Thursday June 12 or Friday June 13 morning.
 */
function runSendCutoffAnnouncement() {
  var props     = PropertiesService.getScriptProperties();
  var portalUrl = props.getProperty('PORTAL_BASE_URL') || '[PORTAL URL — SET PORTAL_BASE_URL PROPERTY]';
  var all       = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'OnboardingMailer' });
  var active    = all.filter(function(s) {
    var active = s.active !== false && s.active !== 'false' && s.active !== 'FALSE';
    return active && String(s.email || '').trim();
  });

  console.log('[OnboardingMailer] Cutoff announcement: ' + active.length + ' recipients.');
  var sent = 0;
  active.forEach(function(s) {
    var name  = String(s.name || s.person_code || '').trim();
    var email = String(s.email || '').trim();
    var html  = buildCutoffHtml_(name, portalUrl);
    try {
      GmailApp.sendEmail(email, 'BLC Nexus Goes Live Monday June 16 — Please Read', '', {
        htmlBody: html,
        name:     'Blue Lotus Consulting Corporation'
      });
      console.log('[OnboardingMailer] ✓ Cutoff → ' + name + ' <' + email + '>');
      sent++;
    } catch(e) {
      console.log('[OnboardingMailer] ❌ ' + name + ': ' + e.message);
    }
  });
  console.log('[OnboardingMailer] Cutoff done. ' + sent + '/' + active.length + ' sent.');
}

/**
 * Sends onboarding letters to all active staff (DESIGNER + TEAM_LEAD + PM).
 * NOTE: Gmail quota is 100/day. With 100+ staff this may need two days.
 */
function runSendAllOnboarding() {
  ['DESIGNER', 'TEAM_LEAD', 'PM'].forEach(function(role) {
    runSendOnboardingForRole(role);
  });
}

/**
 * Sends onboarding letters to all active staff in one role group.
 * QC_REVIEWER staff receive the TEAM_LEAD letter.
 * @param {string} role  'DESIGNER' | 'TEAM_LEAD' | 'PM'
 */
function runSendOnboardingForRole(role) {
  var props     = PropertiesService.getScriptProperties();
  var portalUrl = props.getProperty('PORTAL_BASE_URL') || '[PORTAL URL — SET PORTAL_BASE_URL PROPERTY]';

  var all     = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'OnboardingMailer' });
  var targets = all.filter(function(s) {
    var sRole  = String(s.role  || '').toUpperCase().trim();
    var active = s.active !== false && s.active !== 'false' && s.active !== 'FALSE';
    var email  = String(s.email || '').trim();
    var matchTL = (role === 'TEAM_LEAD' && (sRole === 'TEAM_LEAD' || sRole === 'QC_REVIEWER'));
    return active && email && (sRole === role || matchTL);
  });

  console.log('[OnboardingMailer] ' + role + ': ' + targets.length + ' recipients.');
  if (targets.length === 0) return;

  var sent = 0;
  targets.forEach(function(s) {
    var name  = String(s.name       || s.person_code || '').trim();
    var email = String(s.email      || '').trim();
    var sRole = String(s.role       || '').toUpperCase().trim();
    var html  = buildOnboardingHtml_(name, sRole, portalUrl);
    try {
      GmailApp.sendEmail(email, 'Welcome to BLC Nexus — Your Portal Guide', '', {
        htmlBody: html,
        name:     'Blue Lotus Consulting Corporation'
      });
      console.log('[OnboardingMailer] ✓ ' + name + ' <' + email + '>');
      sent++;
    } catch(e) {
      console.log('[OnboardingMailer] ❌ ' + name + ': ' + e.message);
    }
  });
  console.log('[OnboardingMailer] Done. ' + sent + '/' + targets.length + ' sent.');
}

// ─────────────────────────────────────────────────────────────
// HTML letter builder
// ─────────────────────────────────────────────────────────────

function buildOnboardingHtml_(name, role, portalUrl) {
  var firstName = name.split(' ')[0] || name;
  var header    = buildEmailHeader_();
  var footer    = buildEmailFooter_();
  var body;

  if (role === 'PM') {
    body = buildPMBody_(firstName, portalUrl);
  } else if (role === 'TEAM_LEAD' || role === 'QC_REVIEWER') {
    body = buildTLBody_(firstName, portalUrl);
  } else {
    body = buildDesignerBody_(firstName, portalUrl);
  }

  return '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#222;">' +
         header + body + footer + '</div>';
}

function buildEmailHeader_() {
  return '<div style="background:#1a3c6e;padding:24px 28px;border-radius:6px 6px 0 0;">' +
         '  <h2 style="margin:0;color:#fff;font-size:20px;letter-spacing:0.5px;">Blue Lotus Consulting Corporation</h2>' +
         '  <p style="margin:6px 0 0;color:#a8c4e8;font-size:13px;">BLC Nexus — Portal Launch Guide</p>' +
         '</div>';
}

function buildEmailFooter_() {
  return '<div style="border:1px solid #ddd;border-top:none;padding:16px 28px;border-radius:0 0 6px 6px;background:#f8f9fc;">' +
         '  <p style="font-size:12px;color:#888;margin:0;">Questions? Contact your Team Lead or reply to this email.</p>' +
         '  <p style="font-size:12px;color:#888;margin:4px 0 0;">— Blue Lotus Consulting Corporation</p>' +
         '</div>';
}

// ── CUTOFF ANNOUNCEMENT ───────────────────────────────────────

function buildCutoffHtml_(name, portalUrl) {
  var firstName = name.split(' ')[0] || name;
  return '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#222;">' +
    buildEmailHeader_() +
    '<div style="border:1px solid #ddd;border-top:none;border-bottom:none;padding:28px;">' +
    '<p style="font-size:15px;margin:0 0 6px;">Hi <strong>' + firstName + '</strong>,</p>' +
    '<p style="font-size:14px;line-height:1.7;margin:0 0 20px;">' +
      'We are launching <strong>BLC Nexus</strong> — our new operations portal — on ' +
      '<strong>Monday, June 16</strong>. This replaces Stacey for all job tracking and ' +
      'time logging. Please read the dates below carefully.' +
    '</p>' +

    '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">' +
      '<thead><tr style="background:#f4f7fb;">' +
        '<th style="text-align:left;padding:10px 12px;border-bottom:2px solid #dde3ee;color:#1a3c6e;">Date</th>' +
        '<th style="text-align:left;padding:10px 12px;border-bottom:2px solid #dde3ee;color:#1a3c6e;">What to do</th>' +
      '</tr></thead>' +
      '<tbody>' +
        '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:10px 12px;white-space:nowrap;"><strong>Now → Fri June 13</strong></td>' +
          '<td style="padding:10px 12px;">Continue using Stacey as normal. Log all hours daily.</td>' +
        '</tr>' +
        '<tr style="background:#fdf0ef;border-bottom:1px solid #eee;">' +
          '<td style="padding:10px 12px;white-space:nowrap;"><strong>Fri June 13 (EOD)</strong></td>' +
          '<td style="padding:10px 12px;color:#c0392b;">' +
            '<strong>Last day in Stacey.</strong> Log all remaining hours and submit any pending QC before end of day. ' +
            'After Friday, Stacey is locked.' +
          '</td>' +
        '</tr>' +
        '<tr style="border-bottom:1px solid #eee;">' +
          '<td style="padding:10px 12px;white-space:nowrap;"><strong>Sat–Sun June 14–15</strong></td>' +
          '<td style="padding:10px 12px;">Rest days — please do not log work in either system. Your PM will collect your June timesheet on Saturday.</td>' +
        '</tr>' +
        '<tr style="background:#f0fdf4;border-bottom:1px solid #eee;">' +
          '<td style="padding:10px 12px;white-space:nowrap;"><strong>Mon June 16 onwards</strong></td>' +
          '<td style="padding:10px 12px;color:#1a7a3c;">' +
            '<strong>BLC Nexus is live.</strong> Log all hours, submit QC, and track jobs in the new portal only. ' +
            'Do not use Stacey.' +
          '</td>' +
        '</tr>' +
      '</tbody>' +
    '</table>' +

    '<p style="font-size:14px;line-height:1.7;margin:0 0 12px;">' +
      'You will receive a separate email on Monday with step-by-step instructions for your role. ' +
      'Your jobs are already loaded into the system — you don\'t need to set anything up.' +
    '</p>' +
    '<p style="font-size:14px;line-height:1.7;margin:0 0 20px;">' +
      'The portal link is below. You can bookmark it now — login opens on June 16.' +
    '</p>' +

    btn_(portalUrl, 'BLC Nexus Portal') +

    '<p style="font-size:13px;color:#666;border-top:1px solid #eee;padding-top:16px;margin:0;">' +
      'If you have any questions before launch, speak to your Team Lead or PM. ' +
      'Thank you for your patience as we move to a better system.' +
    '</p>' +
    '</div>' +
    buildEmailFooter_() +
    '</div>';
}

// ── DESIGNER ─────────────────────────────────────────────────

function buildDesignerBody_(firstName, portalUrl) {
  return '<div style="border:1px solid #ddd;border-top:none;border-bottom:none;padding:28px;">' +

    '<p style="font-size:15px;margin:0 0 6px;">Hi <strong>' + firstName + '</strong>,</p>' +
    '<p style="font-size:14px;line-height:1.7;margin:0 0 20px;">' +
      'Starting <strong>June 16</strong>, all job tracking and time logging moves to ' +
      '<strong>BLC Nexus</strong>. This replaces Stacey. Your jobs are already loaded — ' +
      'you don\'t need to set anything up.' +
    '</p>' +

    step_(1, 'Log In',
      'Open the portal in your browser and enter your <strong>work email</strong>. ' +
      'You\'ll see your assigned jobs immediately.' +
      btn_(portalUrl, 'Open Portal')) +

    step_(2, 'See Your Jobs',
      'The <strong>Jobs</strong> tab shows every job assigned to you. Each card shows the ' +
      'job number, client, status, and available actions. Jobs are grouped by status: ' +
      '<em>In Progress → QC → On Hold → Done</em>.') +

    step_(3, 'Log Your Hours',
      'When you finish work on a job, click <strong>Log Hours</strong> on the job card.' +
      '<ul style="margin:8px 0;padding-left:20px;font-size:13px;line-height:1.8;">' +
      '<li>Enter the date worked and hours spent.</li>' +
      '<li>Add a short note (e.g. "Floor plan — Level 3").</li>' +
      '<li>Click <strong>Submit</strong>. Your hours are saved immediately.</li>' +
      '<li>You can log hours across multiple days for the same job.</li>' +
      '</ul>' +
      '<p style="font-size:13px;color:#c0392b;margin:8px 0 0;"><strong>⚠ Log hours the same day you work them.</strong> ' +
      'The portal locks past periods at month-end.</p>') +

    step_(4, 'Submit for QC',
      'When your design is complete and ready for review, click <strong>Submit QC</strong> on the job card.' +
      '<ul style="margin:8px 0;padding-left:20px;font-size:13px;line-height:1.8;">' +
      '<li>Confirm the job number is correct.</li>' +
      '<li>Click Submit. Your Team Lead will be notified.</li>' +
      '<li>The job status changes to <em>In QC</em> — do not log more hours until QC result is back.</li>' +
      '</ul>') +

    step_(5, 'After QC Review',
      '<ul style="margin:8px 0;padding-left:20px;font-size:13px;line-height:1.8;">' +
      '<li><strong>Passed:</strong> Job moves to Done. No action needed.</li>' +
      '<li><strong>Minor rework:</strong> Job comes back to you. Fix and re-submit QC.</li>' +
      '<li><strong>Major rework:</strong> Job comes back. Your TL will discuss corrections with you.</li>' +
      '</ul>') +

  '</div>';
}

// ── TEAM LEAD ─────────────────────────────────────────────────

function buildTLBody_(firstName, portalUrl) {
  return '<div style="border:1px solid #ddd;border-top:none;border-bottom:none;padding:28px;">' +

    '<p style="font-size:15px;margin:0 0 6px;">Hi <strong>' + firstName + '</strong>,</p>' +
    '<p style="font-size:14px;line-height:1.7;margin:0 0 20px;">' +
      'Starting <strong>June 16</strong>, BLC Nexus is live. As a Team Lead, you\'ll manage ' +
      'QC reviews, rate your team, and track job progress — all in one place.' +
    '</p>' +

    btn_(portalUrl, 'Open Portal') +

    step_(1, 'Log In &amp; Your Dashboard',
      'Log in with your work email. You\'ll see two tabs by default: ' +
      '<strong>Jobs</strong> (all jobs across your team) and <strong>QC Backlog</strong> ' +
      '(jobs waiting for your review).') +

    step_(2, 'Reviewing QC',
      'When a designer submits a job for QC, it appears in your <strong>QC Backlog</strong>.' +
      '<ul style="margin:8px 0;padding-left:20px;font-size:13px;line-height:1.8;">' +
      '<li>Click <strong>QC Review</strong> on the job card.</li>' +
      '<li>Choose the outcome:<br>' +
      '  &nbsp;&nbsp;✅ <strong>Pass</strong> — job is complete, moves to Done.<br>' +
      '  &nbsp;&nbsp;⚠️ <strong>Minor Rework</strong> — small fix needed, job returns to designer.<br>' +
      '  &nbsp;&nbsp;❌ <strong>Major Rework</strong> — significant error, designer revises and re-submits.<br>' +
      '  &nbsp;&nbsp;📤 <strong>Client Sent</strong> — job delivered to client directly from QC.' +
      '</li>' +
      '<li>Add review notes. These are logged permanently for the audit trail.</li>' +
      '</ul>') +

    step_(3, 'Reassign QC',
      'If you can\'t review a job (conflict, workload), click <strong>Reassign QC</strong> ' +
      'and select another eligible reviewer. The job moves to their backlog.') +

    step_(4, 'Logging Your Own Hours',
      'If you also do design work, log your hours the same way as designers: ' +
      '<strong>Log Hours</strong> button → date + hours + note → Submit.') +

    step_(5, 'Creating New Jobs',
      '<strong>Only Team Leads and PMs can create jobs.</strong> Designers cannot start work until a job exists in the system.' +
      '<ul style="margin:8px 0;padding-left:20px;font-size:13px;line-height:1.8;">' +
      '<li>Click the <strong>+ New Job</strong> button in the top bar.</li>' +
      '<li>Fill in: Client, Job Type, Product Code, Quantity, Client Ref (optional), Due Date (optional).</li>' +
      '<li>Optionally assign a designer immediately — or leave blank and assign later.</li>' +
      '<li>Click <strong>Create Job</strong>. The job appears instantly for the assigned designer.</li>' +
      '</ul>' +
      '<p style="font-size:13px;color:#c0392b;margin:8px 0 0;"><strong>⚠ On June 16, all client briefs must be entered here before designers can begin work.</strong> ' +
      'Brief your team: they will see jobs appear in their Jobs tab once you create and assign them.</p>') +

    step_(6, 'Rating Your Team (Quarterly)',
      'At the end of each quarter, you\'ll receive an email asking you to rate your direct reports. ' +
      'Log in → <strong>Ratings</strong> tab → score each person on quality and SOP compliance. ' +
      'Scores feed directly into the quarterly bonus calculation.') +

    step_(7, 'View Team Load Balance',
      'The <strong>Dashboard</strong> tab shows hours per designer, QC pass rates, and workload ' +
      'distribution across your team. Use it to spot overloaded or underutilised designers.') +

  '</div>';
}

// ── PM ────────────────────────────────────────────────────────

function buildPMBody_(firstName, portalUrl) {
  return '<div style="border:1px solid #ddd;border-top:none;border-bottom:none;padding:28px;">' +

    '<p style="font-size:15px;margin:0 0 6px;">Hi <strong>' + firstName + '</strong>,</p>' +
    '<p style="font-size:14px;line-height:1.7;margin:0 0 20px;">' +
      'Starting <strong>June 16</strong>, BLC Nexus is live. As a Project Manager, ' +
      'you have full visibility across your accounts — job status, designer workload, ' +
      'error rates, and billing pipeline — in real time.' +
    '</p>' +

    btn_(portalUrl, 'Open Portal') +

    step_(1, 'Log In &amp; Your View',
      'Log in with your work email. Your default view shows all jobs across ' +
      'your assigned accounts, grouped by status. Use the account filter to ' +
      'focus on one client at a time.') +

    step_(2, 'Job Pipeline',
      '<ul style="margin:8px 0;padding-left:20px;font-size:13px;line-height:1.8;">' +
      '<li><strong>In Progress</strong> — designer actively working.</li>' +
      '<li><strong>In QC</strong> — waiting for Team Lead review.</li>' +
      '<li><strong>QC Passed</strong> — ready to send to client.</li>' +
      '<li><strong>Client Sent</strong> — delivered. Eligible for invoicing.</li>' +
      '<li><strong>On Hold</strong> — paused by TL or admin.</li>' +
      '</ul>') +

    step_(3, 'Creating New Jobs',
      '<strong>Only PMs and Team Leads can create jobs.</strong> Designers pick up jobs once they exist in the system.' +
      '<ul style="margin:8px 0;padding-left:20px;font-size:13px;line-height:1.8;">' +
      '<li>Click <strong>+ New Job</strong> in the top bar.</li>' +
      '<li>Select the client, job type, product code, and quantity.</li>' +
      '<li>Add the client\'s own reference number if they have one.</li>' +
      '<li>Assign a designer from the dropdown — only designers mapped to that client appear.</li>' +
      '<li>Click <strong>Create Job</strong>. It appears in the designer\'s Jobs tab immediately.</li>' +
      '</ul>' +
      '<p style="font-size:13px;color:#c0392b;margin:8px 0 0;">' +
      '<strong>⚠ Starting June 16, every client brief must be entered here before any design work begins.</strong>' +
      '</p>') +

    step_(4, 'Marking Jobs as Client Sent',
      'Once a job passes QC and you\'ve delivered it to the client, click ' +
      '<strong>Client Sent</strong> on the job card. This locks the job for invoicing. ' +
      'Do not mark jobs as Client Sent until delivery is confirmed.') +

    step_(5, 'Rating Designers (Quarterly)',
      'At the end of each quarter you\'ll receive an email asking you to rate all designers ' +
      'in your accounts. Log in → <strong>Ratings</strong> tab → score each designer on ' +
      'quality and SOP compliance. Scores directly affect the quarterly bonus calculation. ' +
      '<strong>Please complete ratings within 7 days of the request email.</strong>') +

    step_(6, 'Account Dashboard',
      'The <strong>Dashboard</strong> tab shows per-account metrics: jobs in flight, ' +
      'average hours per job, error rates, and QC pass rates. Use this for client check-ins ' +
      'and before invoicing periods close.') +

    step_(7, 'Logging Your Own Hours',
      'If you do design work, log hours the same way as designers: ' +
      '<strong>Log Hours</strong> button → date + hours + note → Submit.') +

  '</div>';
}

// ── Shared HTML helpers ───────────────────────────────────────

function step_(num, title, content) {
  return '<div style="margin-bottom:20px;">' +
         '  <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:6px;">' +
         '    <span style="display:inline-block;background:#1a3c6e;color:#fff;border-radius:50%;' +
         '      width:22px;height:22px;line-height:22px;text-align:center;font-size:12px;' +
         '      font-weight:bold;flex-shrink:0;">' + num + '</span>' +
         '    <strong style="font-size:14px;color:#1a3c6e;">' + title + '</strong>' +
         '  </div>' +
         '  <div style="margin-left:32px;font-size:13px;line-height:1.7;color:#444;">' + content + '</div>' +
         '</div>';
}

function btn_(url, label) {
  return '<div style="margin:0 0 20px;">' +
         '  <a href="' + url + '" style="display:inline-block;background:#1a3c6e;color:#fff;' +
         '    text-decoration:none;padding:10px 22px;border-radius:4px;font-size:13px;' +
         '    font-weight:bold;">' + label + ' →</a>' +
         '</div>';
}
