// ============================================================
// TimesheetNotifier.gs — BLC Nexus T11 Reporting
// src/11-reporting/TimesheetNotifier.gs
//
// LOAD ORDER: T11. Loads after T0–T9.
// DEPENDENCIES: Config (T0), DAL (T1), Logger (T3), MailApp, UrlFetchApp
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Automated semi-monthly timesheet notification system.  ║
// ║                                                         ║
// ║  Fires daily at 4 PM Saskatoon (America/Regina, UTC-6). ║
// ║  On the 15th → period A (days 1–15).                    ║
// ║  On the last day of month → period B (days 16–EOM).     ║
// ║  On all other days → exits immediately (no-op).         ║
// ║                                                         ║
// ║  Phase 1: Each designer with hours receives a personal  ║
// ║    HTML email showing their jobs + hours for review.    ║
// ║                                                         ║
// ║  Phase 2: CEO receives one email per client containing  ║
// ║    a PDF timesheet ready to attach to a Xero invoice.   ║
// ║                                                         ║
// ║  PDF generated via Google Sheets _PDF_STAGING tab +     ║
// ║  Drive export URL — no third-party service required.    ║
// ║                                                         ║
// ║  Idempotent: Script Property TIMESHEET_NOTIF_SENT|{id}  ║
// ║  prevents duplicate sends if trigger fires twice.       ║
// ║                                                         ║
// ║  Entry points (top-level, trigger-safe):                ║
// ║    runCheckTimesheetNotifications()  — daily trigger    ║
// ║    runTimesheetNotifierManual(pid)   — force re-send    ║
// ║    runTestTimesheetNotifier(pid)     — dry run, no email ║
// ║    runInstallTimesheetNotifierTrigger()                  ║
// ╚══════════════════════════════════════════════════════════╝
//
// A2 EXCEPTION NOTE:
//   writePdfStagingSheet_() uses SpreadsheetApp directly.
//   _PDF_STAGING is a temporary rendering surface — not a FACT
//   table, not persisted. It is written, exported, then immediately
//   cleared. No persistent data bypasses the DAL/WriteGuard path.
//
// TRIGGER SETUP:
//   Project Settings → Time zone MUST be America/Regina.
//   Run runInstallTimesheetNotifierTrigger() once from the editor.
//
// ============================================================

var TimesheetNotifier = (function () {

  var MODULE = 'TimesheetNotifier';

  // Saskatoon = America/Regina = UTC-6 year-round, no DST.
  var SASKATOON_OFFSET_MS = 6 * 60 * 60 * 1000;

  // PDF staging tab name — temporary rendering surface, always cleared after use.
  var PDF_STAGING_TAB = '_PDF_STAGING';

  // Idempotency key prefix in Script Properties.
  var NOTIF_KEY_PREFIX = 'TIMESHEET_NOTIF_SENT|';

  var MONTH_NAMES = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'
  ];
  var MONTH_MAP = {
    jan:0,feb:1,mar:2,apr:3,may:4,jun:5,
    jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
  };
  var BLUE  = '#1a3c5e';
  var MUTED = '#6b7280';

  // ── Config helpers ───────────────────────────────────────

  /** CEO email — Script Property overrides hardcoded fallback. */
  function getCeoEmail_() {
    return PropertiesService.getScriptProperties()
             .getProperty('CEO_BRIEFING_RECIPIENT') || 'raj@bluelotuscanada.ca';
  }

  // ── Timezone guard ───────────────────────────────────────

  /**
   * Warns if the spreadsheet timezone is not America/Regina.
   * A wrong timezone means the 4 PM trigger fires at the wrong local time.
   */
  function checkTimezone_() {
    try {
      var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
      if (tz !== 'America/Regina') {
        Logger.warn('TIMESHEET_NOTIF_TZ_MISMATCH', {
          module:   MODULE,
          actual:   tz,
          expected: 'America/Regina',
          message:  'Trigger may fire at wrong local time. Fix: Apps Script → Project Settings → Time zone → America/Regina'
        });
      }
      return tz;
    } catch (e) {
      return 'unknown';
    }
  }

  // ── Period detection ─────────────────────────────────────

  /** Returns today's date components in Saskatoon time (UTC-6). */
  function todaySaskatoon_() {
    var now = new Date(Date.now() - SASKATOON_OFFSET_MS);
    return {
      year:  now.getUTCFullYear(),
      month: now.getUTCMonth(),   // 0-indexed
      day:   now.getUTCDate()
    };
  }

  /** Returns the last calendar day of a month (month is 0-indexed). */
  function lastDayOfMonth_(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  /**
   * Returns the billing period ID if today is a cutoff date, else null.
   * 15th      → YYYY-MMa (days 1–15)
   * Last day  → YYYY-MMb (days 16–EOM)
   */
  function getPeriodIfCutoffToday_() {
    var t    = todaySaskatoon_();
    var mm   = (t.month + 1 < 10 ? '0' : '') + (t.month + 1);
    var base = t.year + '-' + mm;
    var last = lastDayOfMonth_(t.year, t.month);

    if (t.day === 15)   return base + 'A';
    if (t.day === last) return base + 'B';
    return null;
  }

  /** Parses a period ID into its date range and partition. */
  function parsePeriod_(periodId) {
    var m = periodId.match(/^(\d{4})-(\d{2})([AB])$/i);
    if (!m) throw new Error('TimesheetNotifier: invalid period "' + periodId + '"');
    var year     = parseInt(m[1], 10);
    var monthIdx = parseInt(m[2], 10) - 1;
    var half     = m[3].toUpperCase();
    var fromDate = half === 'A' ? new Date(year, monthIdx, 1)      : new Date(year, monthIdx, 16);
    var toDate   = half === 'A' ? new Date(year, monthIdx, 15)     : new Date(year, monthIdx + 1, 0);
    return {
      fromDate:       fromDate,
      toDate:         toDate,
      monthPartition: m[1] + '-' + m[2],
      year:           year
    };
  }

  /** Human-readable label like "June 1–15, 2026". */
  function periodLabel_(period) {
    var f = period.fromDate, t = period.toDate;
    return MONTH_NAMES[f.getMonth()] + ' ' + f.getDate() + '–' + t.getDate() + ', ' + f.getFullYear();
  }

  // ── Idempotency ──────────────────────────────────────────

  function isAlreadySent_(periodId) {
    return !!PropertiesService.getScriptProperties().getProperty(NOTIF_KEY_PREFIX + periodId);
  }

  function markSent_(periodId) {
    PropertiesService.getScriptProperties()
      .setProperty(NOTIF_KEY_PREFIX + periodId, new Date().toISOString());
  }

  function clearSentFlag_(periodId) {
    PropertiesService.getScriptProperties().deleteProperty(NOTIF_KEY_PREFIX + periodId);
  }

  // ── Data loading ─────────────────────────────────────────

  /** Parses a work_date value (Date or string) to a JS Date. */
  function parseWorkDate_(raw, year) {
    if (!raw) return null;
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
    var s   = String(raw).trim();
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(parseInt(iso[1],10), parseInt(iso[2],10)-1, parseInt(iso[3],10));
    var mg  = s.match(/[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})/);
    if (mg) {
      var mi = MONTH_MAP[mg[1].toLowerCase()];
      if (mi !== undefined) return new Date(year, mi, parseInt(mg[2], 10));
    }
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function ymd_(d) {
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  /**
   * Loads DIM_STAFF_ROSTER into a map keyed by person_code.
   * Only active staff included.
   * @returns {{ [code]: { name: string, email: string } }}
   */
  function loadStaffMap_() {
    var map = {};
    try {
      var rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
      for (var i = 0; i < rows.length; i++) {
        var code     = String(rows[i].person_code || '').trim().toUpperCase();
        var isActive = rows[i].active !== false
                    && String(rows[i].active || '').toUpperCase().trim() !== 'FALSE';
        if (code && isActive) {
          map[code] = {
            name:  String(rows[i].name  || code).trim(),
            email: String(rows[i].email || '').trim()
          };
        }
      }
    } catch (e) {
      Logger.warn('TIMESHEET_NOTIF_STAFF_LOAD_FAIL', { module: MODULE, error: e.message });
    }
    return map;
  }

  /**
   * Loads DIM_CLIENT_RATES into a cache keyed by 'CLIENT:PRODUCT'.
   * @returns {{ [key]: { hourly_rate: number, currency: string } }}
   */
  function loadRateCache_() {
    var cache = {};
    try {
      var rows = DAL.readAll(Config.TABLES.DIM_CLIENT_RATES, { callerModule: MODULE });
      for (var i = 0; i < rows.length; i++) {
        var r      = rows[i];
        var active = String(r.active || '').toUpperCase();
        if (active !== 'TRUE' && active !== 'YES' && active !== '1') continue;
        var cc  = String(r.client_code  || '').toUpperCase().trim();
        var pc  = String(r.product_code || '').toUpperCase().trim();
        var key = cc + ':' + pc;
        if (!cache[key]) {
          cache[key] = {
            hourly_rate: parseFloat(r.hourly_rate) || 0,
            currency:    String(r.currency || 'CAD').toUpperCase()
          };
        }
      }
    } catch (e) {
      Logger.warn('TIMESHEET_NOTIF_RATE_LOAD_FAIL', { module: MODULE, error: e.message });
    }
    return cache;
  }

  function resolveRate_(cache, clientCode, productCode) {
    var c = (clientCode  || '').toUpperCase().trim();
    var p = (productCode || '').toUpperCase().trim();
    return cache[c + ':' + p] || cache[c + ':'] || null;
  }

  /**
   * Loads VW_JOB_CURRENT_STATE into a map keyed by job_number.
   * @returns {{ [jobNum]: Object }}
   */
  function loadJobMap_() {
    var map = {};
    try {
      var rows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
      for (var i = 0; i < rows.length; i++) {
        var jn = String(rows[i].job_number || '').trim();
        if (jn) map[jn] = rows[i];
      }
    } catch (e) {
      Logger.warn('TIMESHEET_NOTIF_JOB_LOAD_FAIL', { module: MODULE, error: e.message });
    }
    return map;
  }

  // ── Core data assembly ───────────────────────────────────

  /**
   * Builds all notification data for a period.
   *
   * Returns:
   *   byClient   — { clientCode → { jobs, totalHours, totalAmount, currency, rate } }
   *   byDesigner — { personCode → { jobs: [{client_code, job_number, client_job_ref,
   *                                          product_code, hours}], totalHours } }
   *   label      — human-readable period label
   *   staffMap   — full staff map (passed through for email lookups)
   */
  function buildNotificationData_(periodId) {
    var period = parsePeriod_(periodId);
    var label  = periodLabel_(period);

    var staffMap  = loadStaffMap_();
    var rateCache = loadRateCache_();
    var jobMap    = loadJobMap_();

    // BTD/SNA WORK_LOG_MIGRATED rows were superseded by WORK_LOG_AMENDED BIT/SVN rows.
    // Skip the originals to avoid double-counting SBS hours.
    var SUPERSEDED_MIGRATED = { 'BTD': true, 'SNA': true };

    var rows = [];
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: MODULE,
        periodId:     period.monthPartition
      });
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }

    var fromYMD = ymd_(period.fromDate);
    var toYMD   = ymd_(period.toDate);

    // { jobNumber → { designerCode → netHours } } — allow negative to accumulate
    var rawByJobDesigner = {};

    for (var i = 0; i < rows.length; i++) {
      var row     = rows[i];
      var evType  = String(row.event_type || '');
      var actCode = String(row.actor_code || '').trim().toUpperCase();

      if (evType === 'WORK_LOG_MIGRATED' && SUPERSEDED_MIGRATED[actCode]) continue;

      var d = parseWorkDate_(row.work_date, period.year);
      if (!d) continue;
      var wd = ymd_(d);
      if (wd < fromYMD || wd > toYMD) continue;

      // Strip job description suffixes (e.g. "2605-6039-A Mary's Landing...")
      var jn  = String(row.job_number || '').trim().split(/\s+/)[0];
      var hrs = parseFloat(row.hours);
      if (!jn || isNaN(hrs) || hrs === 0) continue;

      if (!rawByJobDesigner[jn]) rawByJobDesigner[jn] = {};
      rawByJobDesigner[jn][actCode] = (rawByJobDesigner[jn][actCode] || 0) + hrs;
    }

    // Net out corrections — remove entries that zeroed or went negative
    var allJobNums = Object.keys(rawByJobDesigner);
    for (var j = 0; j < allJobNums.length; j++) {
      var acMap  = rawByJobDesigner[allJobNums[j]];
      var acKeys = Object.keys(acMap);
      for (var a = 0; a < acKeys.length; a++) {
        if (acMap[acKeys[a]] <= 0) delete acMap[acKeys[a]];
      }
      if (Object.keys(acMap).length === 0) delete rawByJobDesigner[allJobNums[j]];
    }

    var byClient   = {};
    var byDesigner = {};

    allJobNums = Object.keys(rawByJobDesigner);
    for (var ji = 0; ji < allJobNums.length; ji++) {
      var jobNum = allJobNums[ji];
      var job    = jobMap[jobNum];
      if (!job) continue;

      var cc    = String(job.client_code  || 'UNKNOWN').toUpperCase().trim();
      var pc    = String(job.product_code || '').toUpperCase().trim();
      var cjRef = String(job.client_job_ref || '').trim();
      var rate  = resolveRate_(rateCache, cc, pc);

      var designerMap   = rawByJobDesigner[jobNum];
      var jobTotalHours = 0;
      var dcodes        = Object.keys(designerMap);

      for (var di = 0; di < dcodes.length; di++) {
        var dcode = dcodes[di];
        var dhrs  = Math.round(designerMap[dcode] * 100) / 100;
        jobTotalHours += dhrs;

        if (!byDesigner[dcode]) byDesigner[dcode] = { jobs: [], totalHours: 0 };
        byDesigner[dcode].jobs.push({
          client_code:    cc,
          job_number:     jobNum,
          client_job_ref: cjRef,
          product_code:   pc,
          hours:          dhrs
        });
        byDesigner[dcode].totalHours =
          Math.round((byDesigner[dcode].totalHours + dhrs) * 100) / 100;
      }

      jobTotalHours = Math.round(jobTotalHours * 100) / 100;
      var amount    = rate ? Math.round(jobTotalHours * rate.hourly_rate * 100) / 100 : null;

      if (!byClient[cc]) {
        byClient[cc] = {
          jobs:        [],
          totalHours:  0,
          totalAmount: 0,
          currency:    rate ? rate.currency    : 'CAD',
          rate:        rate ? rate.hourly_rate : null
        };
      }
      byClient[cc].jobs.push({
        job_number:     jobNum,
        client_job_ref: cjRef,
        product_code:   pc,
        total_hours:    jobTotalHours,
        amount:         amount
      });
      byClient[cc].totalHours  =
        Math.round((byClient[cc].totalHours  + jobTotalHours)  * 100) / 100;
      byClient[cc].totalAmount =
        Math.round((byClient[cc].totalAmount + (amount || 0))  * 100) / 100;
      if (rate) {
        byClient[cc].currency = rate.currency;
        byClient[cc].rate     = rate.hourly_rate;
      }
    }

    return { byClient: byClient, byDesigner: byDesigner, label: label, staffMap: staffMap };
  }

  // ── Phase 1: Designer verification emails ────────────────

  function buildDesignerEmailHtml_(designerName, jobs, periodLabel) {
    // Group jobs by client for a clean sectioned view
    var byClient = {};
    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i];
      if (!byClient[j.client_code]) byClient[j.client_code] = [];
      byClient[j.client_code].push(j);
    }

    var html = '<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#111">';

    html += '<div style="background:' + BLUE + ';color:#fff;padding:16px 20px;border-radius:4px 4px 0 0">' +
            '<h2 style="margin:0;font-size:17px">Blue Lotus Consulting — Hours Summary</h2>' +
            '<div style="font-size:12px;margin-top:4px;opacity:0.75">' + periodLabel + '</div></div>';

    html += '<div style="background:#fff;padding:20px;border:1px solid #e5e7eb;' +
            'border-top:none;border-radius:0 0 4px 4px">';

    html += '<p style="margin:0 0 14px">Hi ' + designerName + ',</p>';
    html += '<p style="margin:0 0 18px">Here are the hours logged for you for <strong>' + periodLabel +
            '</strong>. Please reply to this email if anything looks incorrect.</p>';

    var clients    = Object.keys(byClient).sort();
    var grandTotal = 0;

    for (var ci = 0; ci < clients.length; ci++) {
      var cc    = clients[ci];
      var cjobs = byClient[cc].slice().sort(function (a, b) {
        return a.job_number < b.job_number ? -1 : 1;
      });
      var subtotal = 0;

      html += '<h4 style="margin:18px 0 8px;color:' + BLUE + ';font-size:13px;' +
              'border-bottom:1px solid #e5e7eb;padding-bottom:4px">' + cc + '</h4>';
      html += '<table style="border-collapse:collapse;width:100%;font-size:13px">';
      html += '<tr style="background:#f9fafb">' +
              '<th style="text-align:left;padding:5px 8px;color:' + MUTED + ';font-size:12px">Job #</th>' +
              '<th style="text-align:left;padding:5px 8px;color:' + MUTED + ';font-size:12px">Client Ref</th>' +
              '<th style="text-align:left;padding:5px 8px;color:' + MUTED + ';font-size:12px">Type</th>' +
              '<th style="text-align:right;padding:5px 8px;color:' + MUTED + ';font-size:12px">Hours</th></tr>';

      for (var jj = 0; jj < cjobs.length; jj++) {
        var jr = cjobs[jj];
        subtotal += jr.hours;
        html += '<tr style="border-top:1px solid #f3f4f6">' +
                '<td style="padding:5px 8px">' + jr.job_number + '</td>' +
                '<td style="padding:5px 8px;color:' + MUTED + '">' + (jr.client_job_ref || '—') + '</td>' +
                '<td style="padding:5px 8px;color:' + MUTED + '">' + (jr.product_code   || '—') + '</td>' +
                '<td style="padding:5px 8px;text-align:right;font-weight:600">' + jr.hours + '</td></tr>';
      }
      subtotal = Math.round(subtotal * 100) / 100;
      grandTotal += subtotal;
      html += '<tr style="border-top:2px solid #e5e7eb;font-weight:700">' +
              '<td colspan="3" style="padding:5px 8px">Subtotal — ' + cc + '</td>' +
              '<td style="padding:5px 8px;text-align:right">' + subtotal + ' h</td></tr>';
      html += '</table>';
    }

    grandTotal = Math.round(grandTotal * 100) / 100;
    html += '<div style="margin-top:16px;padding:12px;background:#f0fdf4;border-radius:4px;font-size:14px">' +
            '<strong>Total hours this period: ' + grandTotal + ' h</strong></div>';

    html += '<p style="margin:20px 0 0;font-size:12px;color:' + MUTED + '">' +
            'This is an automated notification from BLC Nexus. Reply to this email to flag any discrepancies.</p>';
    html += '</div></div>';
    return html;
  }

  /**
   * Sends individual verification emails to all designers with hours in the period.
   * Each send is isolated — one failure does not block others.
   *
   * @returns {{ sent: number, skipped_no_email: string[], errors: string[] }}
   */
  function sendDesignerEmails_(byDesigner, staffMap, periodLabel, periodId) {
    var results  = { sent: 0, skipped_no_email: [], errors: [] };
    var codes    = Object.keys(byDesigner).sort();

    for (var i = 0; i < codes.length; i++) {
      var code  = codes[i];
      var staff = staffMap[code];
      var email = staff ? staff.email : '';
      var name  = staff ? staff.name  : code;

      if (!email || email.indexOf('@') === -1) {
        results.skipped_no_email.push(code);
        Logger.warn('TIMESHEET_NOTIF_NO_EMAIL', {
          module: MODULE, person_code: code, period_id: periodId
        });
        continue;
      }

      try {
        var html = buildDesignerEmailHtml_(name, byDesigner[code].jobs, periodLabel);
        MailApp.sendEmail({
          to:       email,
          subject:  '[BLC] Your hours for ' + periodLabel + ' — please review',
          htmlBody: html,
          name:     'BLC Nexus'
        });
        results.sent++;
        Logger.info('TIMESHEET_NOTIF_DESIGNER_SENT', {
          module: MODULE, person_code: code, email: email, period_id: periodId
        });
      } catch (e) {
        results.errors.push(code + ': ' + e.message);
        Logger.error('TIMESHEET_NOTIF_DESIGNER_FAIL', {
          module: MODULE, person_code: code, email: email,
          error: e.message, period_id: periodId
        });
      }
    }

    return results;
  }

  // ── Phase 2: PDF generation ──────────────────────────────

  /**
   * Writes client timesheet data to the _PDF_STAGING sheet for export.
   *
   * A2 EXCEPTION: SpreadsheetApp used directly because DAL has no cell-formatting
   * API and _PDF_STAGING is a transient rendering surface, not a FACT table.
   * It is cleared immediately after exportStagingAsPdf_() returns.
   */
  function writePdfStagingSheet_(sheet, clientCode, clientData, periodLabel) {
    sheet.clearContents();
    sheet.clearFormats();

    var jobs     = clientData.jobs.slice().sort(function (a, b) {
      return a.job_number < b.job_number ? -1 : 1;
    });
    var currency = clientData.currency || 'CAD';
    var rate     = clientData.rate;
    var data     = [];

    // Header block
    data.push(['Blue Lotus Consulting Corporation', '', '', '', '', '']);
    data.push(['Timesheet / Invoice',               '', '', '', '', '']);
    data.push([periodLabel,                          '', '', '', '', '']);
    data.push(['Client: ' + clientCode,              '', '', '', '', '']);
    data.push(['',                                   '', '', '', '', '']);

    // Column headers row (index 5, 1-based row 6)
    var hdrRow = data.length + 1;
    data.push(['Job #', 'Client Ref', 'Type', 'Hours',
               'Rate (' + currency + '/hr)', 'Amount (' + currency + ')']);

    // Job rows
    for (var i = 0; i < jobs.length; i++) {
      var jr = jobs[i];
      data.push([
        jr.job_number,
        jr.client_job_ref || '',
        jr.product_code   || '',
        jr.total_hours,
        rate              || '',
        jr.amount !== null && jr.amount !== undefined ? jr.amount : ''
      ]);
    }

    // Totals row
    var totalRow = data.length + 1;
    data.push(['', '', 'TOTAL', clientData.totalHours, '',
               clientData.totalAmount > 0 ? clientData.totalAmount : '']);

    // Write all values in one call
    sheet.getRange(1, 1, data.length, 6).setValues(data);

    // Formatting
    sheet.getRange(1, 1).setFontSize(13).setFontWeight('bold');
    sheet.getRange(hdrRow, 1, 1, 6)
         .setFontWeight('bold')
         .setBackground(BLUE)
         .setFontColor('#ffffff');
    sheet.getRange(totalRow, 1, 1, 6)
         .setFontWeight('bold')
         .setBackground('#f9fafb');
    sheet.setColumnWidth(1, 110);
    sheet.setColumnWidth(2, 140);
    sheet.setColumnWidth(3, 90);
    sheet.setColumnWidth(4, 70);
    sheet.setColumnWidth(5, 120);
    sheet.setColumnWidth(6, 120);
  }

  /**
   * Exports the _PDF_STAGING sheet as a named PDF blob using the Drive export URL.
   * Requires no third-party service — uses the script's own OAuth token.
   */
  function exportStagingAsPdf_(ss, stagingSheet, filename) {
    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() +
              '/export?format=pdf' +
              '&gid='          + stagingSheet.getSheetId() +
              '&size=A4' +
              '&portrait=true' +
              '&fitw=true' +
              '&gridlines=false' +
              '&printtitle=false' +
              '&sheetnames=false' +
              '&pagenumbers=false' +
              '&attachment=true';

    var response = UrlFetchApp.fetch(url, {
      headers:            { 'Authorization': 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      throw new Error('PDF export HTTP ' + response.getResponseCode() +
                      ' for ' + filename);
    }

    return response.getBlob().setName(filename);
  }

  /**
   * Generates a PDF timesheet for one client.
   * Writes to _PDF_STAGING, exports, clears — all in one atomic block.
   * The staging sheet is cleared in a finally block so it never persists dirty.
   *
   * @returns {Blob}
   */
  function generateClientPdf_(clientCode, clientData, periodId, periodLabel) {
    // A2 EXCEPTION — see module header and writePdfStagingSheet_ comment
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(PDF_STAGING_TAB);
    if (!sheet) {
      sheet = ss.insertSheet(PDF_STAGING_TAB);
      try { sheet.hideSheet(); } catch (e) { /* already only sheet — harmless */ }
    }

    try {
      writePdfStagingSheet_(sheet, clientCode, clientData, periodLabel);
      SpreadsheetApp.flush(); // commit writes before Drive export fetch
      return exportStagingAsPdf_(ss, sheet, clientCode + '_Timesheet_' + periodId + '.pdf');
    } finally {
      // Always clear staging, even on error, so no stale data remains
      try { sheet.clearContents(); sheet.clearFormats(); } catch (e2) { /* ignore */ }
    }
  }

  // ── Phase 2: CEO client emails ───────────────────────────

  function buildCEOClientEmailHtml_(clientCode, clientData, periodLabel) {
    var currency = clientData.currency || 'CAD';
    var html = '<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#111">';

    html += '<div style="background:' + BLUE + ';color:#fff;padding:16px 20px;border-radius:4px 4px 0 0">' +
            '<h2 style="margin:0;font-size:17px">' + clientCode + ' — Timesheet Ready</h2>' +
            '<div style="font-size:12px;margin-top:4px;opacity:0.75">' + periodLabel + '</div></div>';

    html += '<div style="background:#fff;padding:20px;border:1px solid #e5e7eb;' +
            'border-top:none;border-radius:0 0 4px 4px">';

    html += '<p style="margin:0 0 16px">Timesheet for <strong>' + clientCode + '</strong> (' +
            periodLabel + ') is attached. Attach the PDF to the Xero invoice before sending to the client.</p>';

    html += '<table style="border-collapse:collapse;width:100%;font-size:14px">';
    html += '<tr><td style="padding:5px 0;color:' + MUTED + ';width:160px">Total Hours</td>' +
            '<td style="padding:5px 0;font-weight:700">' + clientData.totalHours + ' h</td></tr>';
    if (clientData.rate) {
      html += '<tr><td style="padding:5px 0;color:' + MUTED + '">Rate</td>' +
              '<td style="padding:5px 0">' + currency + ' $' + clientData.rate + '/hr</td></tr>';
    }
    html += '<tr><td style="padding:5px 0;color:' + MUTED + '">Total Amount</td>' +
            '<td style="padding:5px 0;font-weight:700">' + currency + ' $' +
            clientData.totalAmount.toLocaleString() + '</td></tr>';
    html += '<tr><td style="padding:5px 0;color:' + MUTED + '">Jobs billed</td>' +
            '<td style="padding:5px 0">' + clientData.jobs.length + '</td></tr>';
    html += '</table>';

    html += '<p style="margin:20px 0 0;font-size:12px;color:' + MUTED + '">' +
            'BLC Nexus automated timesheet notification.</p>';
    html += '</div></div>';
    return html;
  }

  /**
   * Generates a PDF and emails it to the CEO for each client with hours.
   * Each client is processed independently — one failure does not block others.
   *
   * @returns {{ sent: number, errors: string[] }}
   */
  function sendCEOClientEmails_(byClient, periodId, periodLabel) {
    var ceoEmail = getCeoEmail_();
    var results  = { sent: 0, errors: [] };
    var clients  = Object.keys(byClient).sort();

    for (var i = 0; i < clients.length; i++) {
      var cc         = clients[i];
      var clientData = byClient[cc];

      try {
        var pdfBlob = generateClientPdf_(cc, clientData, periodId, periodLabel);
        var html    = buildCEOClientEmailHtml_(cc, clientData, periodLabel);

        MailApp.sendEmail({
          to:          ceoEmail,
          subject:     '[BLC Invoice Ready] ' + cc + ' — ' + periodLabel,
          htmlBody:    html,
          attachments: [pdfBlob],
          name:        'BLC Nexus'
        });
        results.sent++;
        Logger.info('TIMESHEET_NOTIF_CEO_SENT', {
          module:    MODULE,
          client:    cc,
          period_id: periodId,
          amount:    clientData.totalAmount,
          currency:  clientData.currency
        });
      } catch (e) {
        results.errors.push(cc + ': ' + e.message);
        Logger.error('TIMESHEET_NOTIF_CEO_FAIL', {
          module: MODULE, client: cc, period_id: periodId, error: e.message
        });
      }
    }

    return results;
  }

  // ── Orchestrator ──────────────────────────────────────────

  /**
   * Runs the full two-phase notification pipeline for a given period.
   *
   * Phase 1: Designer verification emails (individual HTML emails).
   * Phase 2: CEO client PDF emails (one PDF per client, sent to CEO).
   *
   * If dryRun=true, logs all data and counts without sending anything
   * and without marking the period as sent.
   *
   * Idempotency: if the period was already notified successfully, exits
   * immediately unless the sent flag was cleared (e.g. by runTimesheetNotifierManual).
   *
   * @param {string}  periodId  e.g. '2026-06A'
   * @param {boolean} dryRun    If true, no emails sent
   */
  function runForPeriod_(periodId, dryRun) {
    Logger.info('TIMESHEET_NOTIF_START', {
      module: MODULE, period_id: periodId, dry_run: !!dryRun
    });

    if (!dryRun && isAlreadySent_(periodId)) {
      Logger.info('TIMESHEET_NOTIF_ALREADY_SENT', { module: MODULE, period_id: periodId });
      return { ok: true, skipped: true, reason: 'already sent for ' + periodId };
    }

    var data          = buildNotificationData_(periodId);
    var designerCount = Object.keys(data.byDesigner).length;
    var clientCount   = Object.keys(data.byClient).length;

    Logger.info('TIMESHEET_NOTIF_DATA_LOADED', {
      module: MODULE, period_id: periodId,
      label: data.label, designers: designerCount, clients: clientCount
    });

    if (dryRun) {
      console.log('=== TIMESHEET NOTIFIER DRY RUN: ' + periodId + ' ===');
      console.log('Period label: ' + data.label);
      console.log('\nDesigners with hours (' + designerCount + '):');
      var dcodes = Object.keys(data.byDesigner).sort();
      for (var di = 0; di < dcodes.length; di++) {
        var de    = data.byDesigner[dcodes[di]];
        var staff = data.staffMap[dcodes[di]];
        var email = staff ? staff.email : '(no email)';
        console.log('  ' + dcodes[di] + ' <' + email + '>: ' +
                    de.totalHours + 'h across ' + de.jobs.length + ' jobs');
      }
      console.log('\nClients (' + clientCount + '):');
      var ccodes = Object.keys(data.byClient).sort();
      for (var ci = 0; ci < ccodes.length; ci++) {
        var cd = data.byClient[ccodes[ci]];
        console.log('  ' + ccodes[ci] + ': ' + cd.totalHours + 'h | ' +
                    cd.currency + ' $' + cd.totalAmount + ' (' + cd.jobs.length + ' jobs)');
      }
      return {
        ok:        true,
        dry_run:   true,
        period_id: periodId,
        label:     data.label,
        designers: designerCount,
        clients:   clientCount
      };
    }

    // Phase 1: Designer verification emails
    var designerResults = sendDesignerEmails_(
      data.byDesigner, data.staffMap, data.label, periodId
    );

    // Phase 2: CEO client PDF emails — always runs, even if some designer emails failed
    var ceoResults = sendCEOClientEmails_(data.byClient, periodId, data.label);

    // Mark as sent only if CEO emails all succeeded (CEO emails are blocking — a
    // missing client PDF means the invoice can't be sent, so re-run must be safe).
    if (ceoResults.errors.length === 0) {
      markSent_(periodId);
    } else {
      Logger.warn('TIMESHEET_NOTIF_NOT_MARKED_SENT', {
        module:    MODULE,
        period_id: periodId,
        message:   'CEO client emails had errors — period NOT marked as sent so re-run is safe',
        errors:    ceoResults.errors
      });
    }

    return {
      ok:              ceoResults.errors.length === 0,
      period_id:       periodId,
      label:           data.label,
      designer_emails: designerResults,
      ceo_emails:      ceoResults
    };
  }

  // ── Daily trigger entry point ────────────────────────────

  /**
   * Called by the daily 4 PM time-based trigger.
   * Checks if today is the 15th or last day of month (Saskatoon time).
   * Exits immediately on all other days.
   */
  function checkAndRun_() {
    checkTimezone_();
    var periodId = getPeriodIfCutoffToday_();
    if (!periodId) {
      Logger.info('TIMESHEET_NOTIF_NOT_TODAY', {
        module: MODULE, message: 'Not a cutoff date — no action taken'
      });
      return { ok: true, skipped: true, reason: 'not a cutoff date' };
    }
    return runForPeriod_(periodId, false);
  }

  // ── Trigger management ───────────────────────────────────

  /**
   * Installs the daily 4 PM time-based trigger.
   * Removes any existing trigger for the same function before installing.
   *
   * IMPORTANT: Apps Script uses the project timezone for atHour().
   * Project Settings → Time zone MUST be America/Regina.
   */
  function installTrigger_() {
    var FN       = 'runCheckTimesheetNotifications';
    var existing = ScriptApp.getProjectTriggers();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].getHandlerFunction() === FN) {
        ScriptApp.deleteTrigger(existing[i]);
        console.log('  Removed existing trigger for ' + FN);
      }
    }
    ScriptApp.newTrigger(FN)
      .timeBased()
      .everyDays(1)
      .atHour(16)
      .create();
    Logger.info('TIMESHEET_NOTIF_TRIGGER_INSTALLED', {
      module: MODULE, handler: FN, hour: 16
    });
    console.log('Trigger installed: ' + FN + ' fires daily at 4 PM project timezone.');
    checkTimezone_();
  }

  // ── Public API ────────────────────────────────────────────

  return {
    checkAndRun:    checkAndRun_,
    runForPeriod:   runForPeriod_,
    installTrigger: installTrigger_,
    clearSentFlag:  clearSentFlag_
  };

})();

// ============================================================
// TOP-LEVEL ENTRY POINTS
// GAS trigger handlers must be top-level functions.
// ============================================================

/**
 * Daily trigger handler — fires at 4 PM Saskatoon time.
 * Acts only on the 15th and last day of each month.
 * DO NOT RENAME — this exact name is registered as the trigger handler.
 */
function runCheckTimesheetNotifications() {
  try {
    var result = TimesheetNotifier.checkAndRun();
    console.log('[TimesheetNotifier] ' + JSON.stringify(result));
  } catch (e) {
    console.log('[TimesheetNotifier] FATAL: ' + e.message);
    console.log('[TimesheetNotifier] STACK: ' + e.stack);
    Logger.error('TIMESHEET_NOTIF_FATAL', {
      module: 'TimesheetNotifier', error: e.message, stack: e.stack
    });
  }
}

/**
 * Force re-sends notifications for a specific period.
 * Clears the idempotency flag first so the run always proceeds.
 * Safe to run multiple times — each send produces the same output.
 *
 * @param {string} [periodId]  e.g. '2026-06A'. Defaults to '2026-06A'.
 */
function runTimesheetNotifierManual(periodId) {
  var pid = periodId || '2026-06A';
  console.log('[TimesheetNotifier] Manual re-send for ' + pid);
  try {
    TimesheetNotifier.clearSentFlag(pid);
    var result = TimesheetNotifier.runForPeriod(pid, false);
    console.log('[TimesheetNotifier] Result: ' + JSON.stringify(result));
  } catch (e) {
    console.log('[TimesheetNotifier] ERROR: ' + e.message);
    console.log('[TimesheetNotifier] STACK: ' + e.stack);
  }
}

/**
 * Dry run — logs all data (designers, hours, clients, amounts) without
 * sending any emails or marking the period as sent.
 * Run this first to verify the data before going live.
 *
 * @param {string} [periodId]  e.g. '2026-06A'. Defaults to '2026-06A'.
 */
function runTestTimesheetNotifier(periodId) {
  var pid = periodId || '2026-06A';
  console.log('[TimesheetNotifier] Dry run for ' + pid);
  try {
    var result = TimesheetNotifier.runForPeriod(pid, true);
    console.log('[TimesheetNotifier] Dry run result: ' + JSON.stringify(result));
  } catch (e) {
    console.log('[TimesheetNotifier] ERROR: ' + e.message);
    console.log('[TimesheetNotifier] STACK: ' + e.stack);
  }
}

/**
 * One-time setup: installs the daily 4 PM trigger.
 * Run once from the Apps Script editor.
 * Verify Project Settings → Time zone = America/Regina before running.
 */
function runInstallTimesheetNotifierTrigger() {
  console.log('═══════════════════════════════════════════');
  console.log('BLC Nexus — Install Timesheet Notifier Trigger');
  console.log('═══════════════════════════════════════════');
  TimesheetNotifier.installTrigger();
  console.log('═══════════════════════════════════════════');
}
