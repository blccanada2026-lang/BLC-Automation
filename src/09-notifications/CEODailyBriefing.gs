// ============================================================
// CEODailyBriefing.gs — BLC Nexus T9 Notifications
// src/09-notifications/CEODailyBriefing.gs
//
// LOAD ORDER: T9. Loads after all T0–T8 files.
// DEPENDENCIES: Config (T0), DAL (T1), Logger (T3), PortalData (T7)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Sends a plain-English daily operations email to the    ║
// ║  CEO covering:                                          ║
// ║    1. Job pipeline — active job counts by state         ║
// ║    2. QC backlog — jobs in QC_REVIEW, days waiting      ║
// ║    3. Hours not logged — designers with IN_PROGRESS     ║
// ║       jobs who haven't logged any hours today (IST)     ║
// ║    4. Billing pipeline — current period revenue         ║
// ║    5. System health — dead letter queue count           ║
// ║                                                         ║
// ║  Recipient is read from Script Property:                ║
// ║    CEO_BRIEFING_RECIPIENT  (defaults to hardcoded CEO)  ║
// ║                                                         ║
// ║  Entry points (top-level, trigger-safe):                ║
// ║    runCEODailyBriefing()                                ║
// ║    runInstallCEOBriefingTrigger()                       ║
// ║    runRemoveCEOBriefingTrigger()                        ║
// ║    runTestCEODailyBriefing()  — dry-run, no email       ║
// ╚══════════════════════════════════════════════════════════╝
//
// TRIGGER SETUP:
//   Script timezone = America/Regina (CST = UTC-6)
//   8 AM CST = 2 PM UTC = 7:30 PM IST (end of Indian workday)
//   Fires Mon–Sat; Sunday is skipped in code.
//
// SCRIPT PROPERTY:
//   CEO_BRIEFING_RECIPIENT — email address to send the briefing
//   Set via: PropertiesService.getScriptProperties()
//              .setProperty('CEO_BRIEFING_RECIPIENT', 'raj@bluelotuscanada.ca')
//
// ============================================================

var CEODailyBriefing = (function () {

  var MODULE = 'CEODailyBriefing';

  // IST is UTC+5:30
  var IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

  // State display order and labels for the pipeline table
  var STATE_ORDER = [
    'IN_PROGRESS', 'QC_REVIEW', 'MINOR_FIX', 'CLIENT_RETURN',
    'ALLOCATED', 'INTAKE_RECEIVED', 'ON_HOLD'
  ];
  var STATE_LABEL = {
    IN_PROGRESS:     'In Progress',
    QC_REVIEW:       'QC Review',
    MINOR_FIX:       'Minor Fix',
    CLIENT_RETURN:   'Client Return',
    ALLOCATED:       'Allocated',
    INTAKE_RECEIVED: 'Intake Received',
    ON_HOLD:         'On Hold'
  };

  // ── Helpers ──────────────────────────────────────────────

  /** Returns today's date in IST as YYYY-MM-DD */
  function todayIST_() {
    var d = new Date(Date.now() + IST_OFFSET_MS);
    return d.toISOString().substring(0, 10);
  }

  /** Returns YYYY-MM from a YYYY-MM-DD string */
  function periodFromDate_(dateStr) {
    return dateStr.substring(0, 7);
  }

  /** CEO email from Script Property, with hardcoded fallback */
  function getCeoEmail_() {
    return PropertiesService.getScriptProperties()
             .getProperty('CEO_BRIEFING_RECIPIENT') || 'raj@bluelotuscanada.ca';
  }

  /** Normalises a work_date value (Date or string) to YYYY-MM-DD */
  function normDate_(val) {
    if (val instanceof Date) {
      return val.toISOString().substring(0, 10);
    }
    return String(val || '').trim().substring(0, 10);
  }

  // ── Data gathering ───────────────────────────────────────

  /**
   * Returns designers who have at least one IN_PROGRESS job today
   * but have not logged any hours for today (IST date).
   *
   * @param {string} todayStr   YYYY-MM-DD in IST
   * @param {string} periodId   YYYY-MM
   * @returns {Array<{person_code, name, active_jobs}>}
   */
  function findNoHoursToday_(todayStr, periodId) {
    // 1. Designers with IN_PROGRESS jobs
    var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    var activeMap    = {};
    var jobCountMap  = {};
    for (var i = 0; i < vwRows.length; i++) {
      var st   = String(vwRows[i].current_state || '').trim();
      var code = String(vwRows[i].allocated_to  || '').trim();
      if (st === Config.STATES.IN_PROGRESS && code) {
        activeMap[code]   = true;
        jobCountMap[code] = (jobCountMap[code] || 0) + 1;
      }
    }

    // 2. Who already logged today
    var loggedToday = {};
    try {
      var logs = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: MODULE,
        periodId:     periodId
      });
      for (var j = 0; j < logs.length; j++) {
        if (normDate_(logs[j].work_date) === todayStr) {
          loggedToday[String(logs[j].actor_code || '').trim()] = true;
        }
      }
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }

    // 3. Name lookup from roster
    var nameMap = {};
    try {
      var roster = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
      for (var k = 0; k < roster.length; k++) {
        var pc = String(roster[k].person_code || '').trim();
        if (pc) nameMap[pc] = String(roster[k].name || pc);
      }
    } catch (e) { /* roster unavailable — use person_code as name */ }

    // 4. Build list of designers behind
    var behind = [];
    Object.keys(activeMap).forEach(function (code) {
      if (!loggedToday[code]) {
        behind.push({
          person_code: code,
          name:        nameMap[code] || code,
          active_jobs: jobCountMap[code] || 0
        });
      }
    });
    behind.sort(function (a, b) { return b.active_jobs - a.active_jobs; });
    return behind;
  }

  /**
   * Returns revenue totals for the given period from MART_BILLING_SUMMARY.
   *
   * @param {string} periodId  YYYY-MM
   * @returns {{ period_id, revenue_cad, revenue_usd }}
   */
  function getBillingForPeriod_(periodId) {
    var rows = DAL.readAll(Config.TABLES.MART_BILLING_SUMMARY, { callerModule: MODULE });
    var cad  = 0;
    var usd  = 0;
    for (var i = 0; i < rows.length; i++) {
      var pid = String(rows[i].period_id || '').trim();
      if (pid !== periodId) continue;
      var cur = String(rows[i].currency || '').trim().toUpperCase();
      var amt = parseFloat(rows[i].total_amount) || 0;
      if (cur === 'CAD') cad += amt;
      if (cur === 'USD') usd += amt;
    }
    return { period_id: periodId, revenue_cad: cad, revenue_usd: usd };
  }

  /**
   * Assembles all briefing data. Each section is wrapped in try/catch
   * so a single read failure does not abort the whole briefing.
   *
   * @param {string} todayStr  YYYY-MM-DD
   * @param {string} periodId  YYYY-MM
   * @returns {Object}
   */
  function buildBriefingData_(todayStr, periodId) {
    var data = {
      date:           todayStr,
      period_id:      periodId,
      job_pipeline:   null,
      qc_backlog:     [],
      no_hours_today: [],
      billing:        null,
      dead_letters:   0,
      section_errors: []
    };

    // Section 1 + 2: CEO dashboard (job pipeline + QC backlog)
    try {
      var dashJson = PortalData.getCEODashboard(getCeoEmail_());
      var dash     = JSON.parse(dashJson);
      data.job_pipeline = dash.job_summary  || null;
      data.qc_backlog   = dash.qc_backlog   || [];
    } catch (e) {
      Logger.warn('CEO_BRIEFING_DASHBOARD_FAIL', { module: MODULE, error: e.message });
      data.section_errors.push('job pipeline/QC backlog: ' + e.message);
    }

    // Section 3: hours not logged today
    try {
      data.no_hours_today = findNoHoursToday_(todayStr, periodId);
    } catch (e) {
      Logger.warn('CEO_BRIEFING_HOURS_FAIL', { module: MODULE, error: e.message });
      data.section_errors.push('hours check: ' + e.message);
    }

    // Section 4: billing pipeline
    try {
      data.billing = getBillingForPeriod_(periodId);
    } catch (e) {
      Logger.warn('CEO_BRIEFING_BILLING_FAIL', { module: MODULE, error: e.message });
      data.section_errors.push('billing: ' + e.message);
    }

    // Section 5: system health — dead letter count
    try {
      var dl = DAL.readAll(Config.TABLES.DEAD_LETTER_QUEUE, { callerModule: MODULE });
      data.dead_letters = dl.length;
    } catch (e) {
      data.dead_letters = 0; // table absent = no dead letters
    }

    return data;
  }

  // ── HTML email builder ───────────────────────────────────

  /**
   * Builds the HTML email body from briefing data.
   *
   * @param {Object} data  Result of buildBriefingData_()
   * @returns {string}  HTML string
   */
  function buildHtmlEmail_(data) {
    var BLUE  = '#1a3c5e';
    var RED   = '#dc2626';
    var GREEN = '#16a34a';
    var MUTED = '#6b7280';

    function row_(label, value, color) {
      return '<tr><td style="padding:4px 0;color:' + MUTED + ';width:180px">' + label +
             '</td><td style="padding:4px 0;font-weight:600;color:' + (color || '#111') + '">' +
             value + '</td></tr>';
    }

    function section_(title, body) {
      return '<div style="margin-bottom:28px">' +
               '<h3 style="margin:0 0 12px;font-size:15px;color:' + BLUE + ';' +
               'border-bottom:2px solid #e5e7eb;padding-bottom:6px">' + title + '</h3>' +
               body +
             '</div>';
    }

    var html = '<div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;color:#111">';

    // ── Header ──────────────────────────────────────────────
    html += '<div style="background:' + BLUE + ';color:#fff;padding:18px 24px;border-radius:4px 4px 0 0">' +
            '<h2 style="margin:0;font-size:18px">BLC Nexus — Daily Briefing</h2>' +
            '<div style="font-size:13px;margin-top:4px;opacity:0.75">' + data.date + ' &nbsp;|&nbsp; Period ' + data.period_id + '</div>' +
            '</div>';

    html += '<div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 4px 4px">';

    // ── Section 1: Job Pipeline ─────────────────────────────
    var pipelineBody = '';
    if (!data.job_pipeline) {
      pipelineBody = '<p style="color:' + MUTED + ';margin:0">Data unavailable.</p>';
    } else {
      var byState = data.job_pipeline.by_state || {};
      var total   = data.job_pipeline.total_active || 0;
      pipelineBody += '<p style="margin:0 0 10px;font-size:14px"><strong>' + total + '</strong> active job' +
                      (total !== 1 ? 's' : '') + ' across all states</p>';
      pipelineBody += '<table style="border-collapse:collapse;width:100%">';
      for (var s = 0; s < STATE_ORDER.length; s++) {
        var st    = STATE_ORDER[s];
        var count = byState[st] || 0;
        var color = (st === 'QC_REVIEW' && count > 0) ? RED
                  : (st === 'IN_PROGRESS')             ? GREEN
                  : '#111';
        pipelineBody += row_(STATE_LABEL[st] || st, count, color);
      }
      pipelineBody += '</table>';
    }
    html += section_('1. Job Pipeline', pipelineBody);

    // ── Section 2: QC Backlog ───────────────────────────────
    var qcBody = '';
    if (data.qc_backlog.length === 0) {
      qcBody = '<p style="color:' + GREEN + ';margin:0;font-weight:600">No jobs in QC review.</p>';
    } else {
      qcBody += '<table style="border-collapse:collapse;width:100%;font-size:13px">';
      qcBody += '<tr style="background:#f9fafb"><th style="text-align:left;padding:6px 8px;font-size:12px;color:' + MUTED + '">Job</th>' +
                '<th style="text-align:left;padding:6px 8px;font-size:12px;color:' + MUTED + '">Client</th>' +
                '<th style="text-align:left;padding:6px 8px;font-size:12px;color:' + MUTED + '">Designer</th>' +
                '<th style="text-align:right;padding:6px 8px;font-size:12px;color:' + MUTED + '">Days Waiting</th></tr>';
      for (var q = 0; q < data.qc_backlog.length; q++) {
        var item  = data.qc_backlog[q];
        var days  = item.days_waiting || 0;
        var daysColor = days >= 3 ? RED : '#111';
        qcBody += '<tr style="border-top:1px solid #f3f4f6">' +
                  '<td style="padding:6px 8px">' + item.job_number + '</td>' +
                  '<td style="padding:6px 8px">' + item.client_code + '</td>' +
                  '<td style="padding:6px 8px">' + (item.designer_name || '—') + '</td>' +
                  '<td style="padding:6px 8px;text-align:right;font-weight:600;color:' + daysColor + '">' + days + '</td>' +
                  '</tr>';
      }
      qcBody += '</table>';
    }
    html += section_('2. QC Backlog (' + data.qc_backlog.length + ')', qcBody);

    // ── Section 3: Hours Not Logged Today ──────────────────
    var hoursBody = '';
    if (data.no_hours_today.length === 0) {
      hoursBody = '<p style="color:' + GREEN + ';margin:0;font-weight:600">All active designers have logged hours today.</p>';
    } else {
      hoursBody += '<p style="margin:0 0 10px;color:' + RED + ';font-weight:600">' +
                   data.no_hours_today.length + ' designer' +
                   (data.no_hours_today.length !== 1 ? 's' : '') +
                   ' with active jobs have not logged hours today.</p>';
      hoursBody += '<table style="border-collapse:collapse;width:100%">';
      for (var h = 0; h < data.no_hours_today.length; h++) {
        var d = data.no_hours_today[h];
        hoursBody += row_(d.name, d.active_jobs + ' active job' + (d.active_jobs !== 1 ? 's' : ''));
      }
      hoursBody += '</table>';
    }
    html += section_('3. Hours Not Logged Today', hoursBody);

    // ── Section 4: Billing Pipeline ────────────────────────
    var billBody = '';
    if (!data.billing) {
      billBody = '<p style="color:' + MUTED + ';margin:0">Data unavailable.</p>';
    } else {
      billBody += '<table style="border-collapse:collapse;width:100%">';
      billBody += row_('Revenue (CAD)', data.billing.revenue_cad > 0
                       ? '$' + data.billing.revenue_cad.toLocaleString()
                       : '—');
      if (data.billing.revenue_usd > 0) {
        billBody += row_('Revenue (USD)', '$' + data.billing.revenue_usd.toLocaleString());
      }
      billBody += '</table>';
      if (data.billing.revenue_cad === 0 && data.billing.revenue_usd === 0) {
        billBody += '<p style="color:' + MUTED + ';font-size:12px;margin:8px 0 0">' +
                    'No billing data found for ' + data.period_id + '. Run billing or refresh MART to populate.</p>';
      }
    }
    html += section_('4. Billing Pipeline — ' + data.period_id, billBody);

    // ── Section 5: System Health ────────────────────────────
    var healthBody = '<table style="border-collapse:collapse;width:100%">';
    var dlColor = data.dead_letters > 0 ? RED : GREEN;
    var dlText  = data.dead_letters > 0
                  ? data.dead_letters + ' item' + (data.dead_letters !== 1 ? 's' : '') + ' — ACTION REQUIRED'
                  : '0 — All clear';
    healthBody += row_('Dead letter queue', dlText, dlColor);
    healthBody += '</table>';
    if (data.dead_letters > 0) {
      healthBody += '<p style="font-size:12px;color:' + RED + ';margin:8px 0 0">' +
                    'Dead letter items require manual review. Open the portal to inspect failed queue items.</p>';
    }
    html += section_('5. System Health', healthBody);

    // ── Section errors (partial data warnings) ──────────────
    if (data.section_errors.length > 0) {
      html += '<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;padding:12px;margin-bottom:20px;font-size:12px">' +
              '<strong>Warning:</strong> Some sections could not be loaded: ' +
              data.section_errors.join('; ') + '</div>';
    }

    // ── Footer ──────────────────────────────────────────────
    var portalUrl = PropertiesService.getScriptProperties().getProperty('PORTAL_BASE_URL') || '';
    html += '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 16px">';
    html += '<p style="font-size:12px;color:' + MUTED + ';margin:0">';
    if (portalUrl) {
      html += '<a href="' + portalUrl + '" style="color:' + BLUE + '">Open Portal</a> &nbsp;|&nbsp; ';
    }
    html += 'BLC Nexus Automated Daily Briefing — sent ' + data.date + '</p>';

    html += '</div></div>';
    return html;
  }

  // ── Core ─────────────────────────────────────────────────

  /**
   * Builds and sends (or dry-runs) the CEO daily briefing.
   *
   * @param {boolean} dryRun  If true, logs the email body without sending
   * @returns {{ ok: boolean, sent_to: string, dry_run?: boolean, date: string }}
   */
  function run_(dryRun) {
    var today    = todayIST_();
    var periodId = periodFromDate_(today);
    var ceoEmail = getCeoEmail_();

    var data = buildBriefingData_(today, periodId);
    var html = buildHtmlEmail_(data);

    var subject = '[BLC Daily Briefing] ' + today;

    if (dryRun) {
      Logger.info('CEO_BRIEFING_DRY_RUN', {
        module:   MODULE,
        to:       ceoEmail,
        date:     today,
        sections: {
          pipeline_ok:     !!data.job_pipeline,
          qc_count:        data.qc_backlog.length,
          no_hours_count:  data.no_hours_today.length,
          billing_ok:      !!data.billing,
          dead_letters:    data.dead_letters
        }
      });
      console.log('--- CEO BRIEFING DRY RUN ---');
      console.log('To: ' + ceoEmail);
      console.log('Subject: ' + subject);
      console.log('HTML (first 1000 chars):\n' + html.substring(0, 1000));
      return { ok: true, dry_run: true, sent_to: ceoEmail, date: today };
    }

    try {
      MailApp.sendEmail({
        to:       ceoEmail,
        subject:  subject,
        htmlBody: html,
        name:     'BLC Nexus'
      });
    } catch (e) {
      Logger.error('CEO_BRIEFING_EMAIL_FAIL', { module: MODULE, to: ceoEmail, error: e.message });
      return { ok: false, error: e.message, sent_to: ceoEmail, date: today };
    }

    Logger.info('CEO_BRIEFING_SENT', { module: MODULE, to: ceoEmail, date: today });
    return { ok: true, sent_to: ceoEmail, date: today };
  }

  // ── Trigger management ────────────────────────────────────

  function installTrigger_() {
    var existing = ScriptApp.getProjectTriggers();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].getHandlerFunction() === 'runCEODailyBriefing') {
        ScriptApp.deleteTrigger(existing[i]);
      }
    }
    // 8 AM CST (America/Regina = UTC-6) = 2 PM UTC = 7:30 PM IST
    ScriptApp.newTrigger('runCEODailyBriefing')
      .timeBased()
      .everyDays(1)
      .atHour(8)
      .create();
    Logger.info('CEO_BRIEFING_TRIGGER_INSTALLED', { module: MODULE });
  }

  function removeTrigger_() {
    var existing = ScriptApp.getProjectTriggers();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].getHandlerFunction() === 'runCEODailyBriefing') {
        ScriptApp.deleteTrigger(existing[i]);
      }
    }
    Logger.info('CEO_BRIEFING_TRIGGER_REMOVED', { module: MODULE });
  }

  // ── Public API ────────────────────────────────────────────

  return {
    run:            run_,
    installTrigger: installTrigger_,
    removeTrigger:  removeTrigger_
  };

})();

// ── Top-level entry points (trigger + manual) ─────────────

/** Daily trigger handler — skip Sunday automatically */
function runCEODailyBriefing() {
  if (new Date().getDay() === 0) return; // 0 = Sunday
  try {
    CEODailyBriefing.run(false);
  } catch (e) {
    Logger.error('CEO_BRIEFING_FATAL', { module: 'CEODailyBriefing', error: e.message });
  }
}

/** Run from Apps Script editor to install the daily trigger */
function runInstallCEOBriefingTrigger() {
  CEODailyBriefing.installTrigger();
  console.log('CEO Daily Briefing trigger installed — fires daily ~8 AM CST (Mon–Sat), 7:30 PM IST');
}

/** Run from Apps Script editor to remove the trigger */
function runRemoveCEOBriefingTrigger() {
  CEODailyBriefing.removeTrigger();
  console.log('CEO Daily Briefing trigger removed');
}

/**
 * Dry-run — builds and logs the email without sending.
 * Run from the Apps Script editor to preview before going live.
 */
function runTestCEODailyBriefing() {
  var result = CEODailyBriefing.run(true);
  console.log('Dry run complete — would send to: ' + result.sent_to + ' for date: ' + result.date);
}
