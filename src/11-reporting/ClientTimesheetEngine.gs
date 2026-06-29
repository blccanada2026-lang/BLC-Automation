// ============================================================
// ClientTimesheetEngine.gs — BLC Nexus T11 Reporting
// src/11-reporting/ClientTimesheetEngine.gs
//
// LOAD ORDER: T11. Loads after T0–T9.
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1), Logger (T3)
//
// Generates a client-facing timesheet for a semi-monthly billing
// period. Output written to TIMESHEET|{periodId} sheet tab.
//
// Per job (grouped by client):
//   Job #, Client Ref, Type, Designer(s), Hours, Rate, Amount, Status
//
// Usage (Apps Script editor):
//   runGenerateClientTimesheets()           — current period
//   runGenerateClientTimesheets('2026-06A') — specific period
// ============================================================

var ClientTimesheetEngine = (function () {

  var MODULE = 'ClientTimesheetEngine';

  // ── Period helpers (self-contained — no BillingEngine dep) ──

  function parsePeriod_(periodId) {
    var m = periodId.match(/^(\d{4})-(\d{2})([AB])$/);
    if (!m) throw new Error('ClientTimesheetEngine: invalid period "' + periodId + '"');
    var year     = parseInt(m[1], 10);
    var monthIdx = parseInt(m[2], 10) - 1;
    var half     = m[3];
    var fromDate = half === 'A' ? new Date(year, monthIdx, 1) : new Date(year, monthIdx, 16);
    var toDate   = half === 'A' ? new Date(year, monthIdx, 15) : new Date(year, monthIdx + 1, 0);
    return { fromDate: fromDate, toDate: toDate, monthPartition: m[1] + '-' + m[2], year: year };
  }

  function currentPeriod_() {
    var now = new Date();
    var mm  = (now.getMonth() + 1 < 10 ? '0' : '') + (now.getMonth() + 1);
    return now.getFullYear() + '-' + mm + (now.getDate() <= 15 ? 'A' : 'B');
  }

  function ymd_(d) {
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  var MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
  var MONTH_MAP   = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

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

  function periodLabel_(period) {
    var f = period.fromDate, t = period.toDate;
    return MONTH_NAMES[f.getMonth()] + ' ' + f.getDate() + '–' + t.getDate() + ', ' + f.getFullYear();
  }

  // ── Data loading ─────────────────────────────────────────────

  function loadStaffMap_() {
    var map = {};
    try {
      var rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
      for (var i = 0; i < rows.length; i++) {
        var code = String(rows[i].person_code || '').trim().toUpperCase();
        if (code) map[code] = String(rows[i].name || code);
      }
    } catch (e) { /* return empty map */ }
    return map;
  }

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
          cache[key] = { hourly_rate: parseFloat(r.hourly_rate) || 0,
                         currency:    String(r.currency || 'CAD').toUpperCase() };
        }
      }
    } catch (e) { /* return empty */ }
    return cache;
  }

  function resolveRate_(cache, clientCode, productCode) {
    var c = (clientCode  || '').toUpperCase().trim();
    var p = (productCode || '').toUpperCase().trim();
    return cache[c + ':' + p] || cache[c + ':'] || null;
  }

  function loadJobMap_() {
    var map = {};
    try {
      var rows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
      for (var i = 0; i < rows.length; i++) {
        var jn = String(rows[i].job_number || '').trim();
        if (jn) map[jn] = rows[i];
      }
    } catch (e) { /* return empty */ }
    return map;
  }

  // { client_code → { client_name, address } }
  function loadClientMap_() {
    var map = {};
    try {
      var rows = DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: MODULE });
      for (var i = 0; i < rows.length; i++) {
        var r  = rows[i];
        var cc = String(r.client_code || '').trim().toUpperCase();
        if (!cc) continue;
        map[cc] = {
          client_name: String(r.client_name || cc),
          address:     String(r.address     || '')
        };
      }
    } catch (e) { /* return empty map */ }
    return map;
  }

  // { jobNumber → { designerCode → hours } }
  function buildHoursMap_(monthPartition, fromDate, toDate, year) {
    var byJobDesigner = {};
    var rows = [];
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: MODULE,
        periodId:     monthPartition
      });
    } catch (e) { return byJobDesigner; }

    // Actor codes whose WORK_LOG_MIGRATED rows were corrected by WORK_LOG_AMENDED rows
    // (runFixBTDtoBIT and runFixSNAtoSVN in JuneWorkLogImporter). The amendment_of
    // field is not in the FACT_WORK_LOGS schema so we use the same pattern as
    // runJuneReconciliation(): skip MIGRATED rows for these known-superseded codes.
    var SUPERSEDED_MIGRATED = { 'BTD': true, 'SNA': true };

    var fromYMD = ymd_(fromDate), toYMD = ymd_(toDate);
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.migration_batch) continue;
      if (row.event_type === 'WORK_LOG_MIGRATED' && SUPERSEDED_MIGRATED[String(row.actor_code || '').trim().toUpperCase()]) continue;
      var d   = parseWorkDate_(row.work_date, year);
      if (!d) continue;
      var wd  = ymd_(d);
      if (wd < fromYMD || wd > toYMD) continue;
      // Strip description suffixes like "2605-6039-A Mary's Landing Lot 9-16 OWF"
      var jn  = String(row.job_number  || '').trim().split(/\s+/)[0];
      var ac  = String(row.actor_code  || '').trim().toUpperCase();
      var hrs = parseFloat(row.hours);
      if (!jn || isNaN(hrs) || hrs === 0) continue;
      if (!byJobDesigner[jn]) byJobDesigner[jn] = {};
      byJobDesigner[jn][ac] = (byJobDesigner[jn][ac] || 0) + hrs;
    }
    // Net out jobs/designers where corrections fully reversed the hours
    var jnKeys = Object.keys(byJobDesigner);
    for (var j = 0; j < jnKeys.length; j++) {
      var acMap = byJobDesigner[jnKeys[j]];
      var acKeys = Object.keys(acMap);
      for (var a = 0; a < acKeys.length; a++) {
        if (acMap[acKeys[a]] <= 0) delete acMap[acKeys[a]];
      }
    }
    return byJobDesigner;
  }

  // Per-row work log entries for a single client — used by PDF timesheet.
  // Each element: { work_date, job_number, job_type, client_job_ref, designer_code, hours, notes }
  // Applies same exclusion rules as buildHoursMap_ (migration_batch, SUPERSEDED_MIGRATED).
  function buildWorkLogEntries_(monthPartition, fromDate, toDate, year, clientCode, jobMap) {
    var entries = [];
    var rows    = [];
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: MODULE,
        periodId:     monthPartition
      });
    } catch (e) { return entries; }

    var SUPERSEDED_MIGRATED = { 'BTD': true, 'SNA': true };
    var fromYMD = ymd_(fromDate), toYMD = ymd_(toDate);
    var cc      = (clientCode || '').toUpperCase().trim();

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.migration_batch) continue;
      if (row.event_type === 'WORK_LOG_MIGRATED' &&
          SUPERSEDED_MIGRATED[String(row.actor_code || '').trim().toUpperCase()]) continue;
      var d = parseWorkDate_(row.work_date, year);
      if (!d) continue;
      var wd = ymd_(d);
      if (wd < fromYMD || wd > toYMD) continue;
      var jn  = String(row.job_number || '').trim().split(/\s+/)[0];
      var hrs = parseFloat(row.hours);
      if (!jn || isNaN(hrs) || hrs === 0) continue;
      var job = jobMap[jn];
      if (!job) continue;
      if (String(job.client_code || '').toUpperCase().trim() !== cc) continue;
      entries.push({
        work_date:      d,
        job_number:     jn,
        job_type:       String(job.job_type       || ''),
        client_job_ref: String(job.client_job_ref || ''),
        designer_code:  String(row.actor_code     || '').trim().toUpperCase(),
        hours:          Math.round(hrs * 100) / 100,
        notes:          String(row.notes          || '')
      });
    }
    return entries;
  }

  // ── Main generate function ───────────────────────────────────

  /**
   * Generates a client timesheet for the given semi-monthly period.
   * Writes output to sheet tab TIMESHEET|{periodId} (creates or overwrites).
   *
   * @param {string} [periodId]  e.g. '2026-06A'. Default: current period.
   * @returns {{ clients: Object, period_id: string }}
   */
  function generate(periodId) {
    periodId   = periodId || currentPeriod_();
    var period = parsePeriod_(periodId);
    var label  = periodLabel_(period);

    Logger.info('TIMESHEET_GEN_START', { module: MODULE, period_id: periodId, label: label });

    var staffMap    = loadStaffMap_();
    var rateCache   = loadRateCache_();
    var jobMap      = loadJobMap_();
    var hoursMap    = buildHoursMap_(period.monthPartition, period.fromDate, period.toDate, period.year);

    // Group by client → jobs
    var byClient = {};
    var jobNums  = Object.keys(hoursMap);

    for (var i = 0; i < jobNums.length; i++) {
      var jn     = jobNums[i];
      var job    = jobMap[jn];
      if (!job) continue;

      var cc     = String(job.client_code  || 'UNKNOWN').toUpperCase().trim();
      var pc     = String(job.product_code || '').toUpperCase().trim();
      var rate   = resolveRate_(rateCache, cc, pc);
      if (!rate) {
        Logger.warn('TIMESHEET_NO_RATE', { module: MODULE, job_number: jn, client_code: cc });
      }

      var designerMap  = hoursMap[jn];
      var totalHours   = 0;
      var designerList = [];
      var dcodes       = Object.keys(designerMap);
      for (var d = 0; d < dcodes.length; d++) {
        var code = dcodes[d];
        var hrs  = Math.round(designerMap[code] * 100) / 100;
        totalHours += hrs;
        designerList.push((staffMap[code] || code) + ' (' + hrs + 'h)');
      }
      totalHours = Math.round(totalHours * 100) / 100;

      var amount = rate ? Math.round(totalHours * rate.hourly_rate * 100) / 100 : null;

      if (!byClient[cc]) byClient[cc] = { rows: [], totalHours: 0, totalAmount: 0, currency: '' };
      byClient[cc].rows.push({
        job_number:     jn,
        client_job_ref: String(job.client_job_ref || ''),
        product_code:   pc,
        designers:      designerList.join(', '),
        total_hours:    totalHours,
        hourly_rate:    rate ? rate.hourly_rate : '',
        currency:       rate ? rate.currency    : '',
        amount:         amount,
        job_status:     String(job.current_state || '')
      });
      byClient[cc].totalHours  = Math.round((byClient[cc].totalHours  + totalHours)          * 100) / 100;
      byClient[cc].totalAmount = Math.round((byClient[cc].totalAmount + (amount || 0))       * 100) / 100;
      if (rate) byClient[cc].currency = rate.currency;
    }

    // Write to sheet tab TIMESHEET|{periodId}
    writeTimesheetSheet_(periodId, label, byClient);

    Logger.info('TIMESHEET_GEN_COMPLETE', {
      module:    MODULE,
      period_id: periodId,
      clients:   Object.keys(byClient).length,
      jobs:      jobNums.length
    });

    return { clients: byClient, period_id: periodId };
  }

  // ── Sheet output ─────────────────────────────────────────────

  function writeTimesheetSheet_(periodId, label, byClient) {
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var tabName = 'TIMESHEET_EXPORT';  // single overwriting tab — no tab proliferation

    // Clear existing or create new
    var sheet = ss.getSheetByName(tabName);
    if (sheet) {
      sheet.clearContents();
    } else {
      sheet = ss.insertSheet(tabName);
    }

    var allRows = [];

    // Title
    allRows.push(['BLC Nexus — Client Timesheet', label, '', '', '', '', '', '', '']);
    allRows.push(['Generated: ' + new Date().toLocaleString(), '', '', '', '', '', '', '', '']);
    allRows.push(['', '', '', '', '', '', '', '', '']);

    // Column headers
    var COL_HEADERS = ['Job #', 'Client Ref', 'Type', 'Designer(s)', 'Hours', 'Rate', 'Currency', 'Amount', 'Status'];
    var clients = Object.keys(byClient).sort();

    for (var ci = 0; ci < clients.length; ci++) {
      var cc     = clients[ci];
      var cdata  = byClient[cc];

      // Client header
      allRows.push(['CLIENT: ' + cc, 'Currency: ' + cdata.currency, 'Rate: ' + (cdata.rows[0] ? cdata.rows[0].hourly_rate : '?') + '/hr',
                    '', '', '', '', '', '']);
      allRows.push(COL_HEADERS);

      // Job rows sorted by job number
      var jobRows = cdata.rows.slice().sort(function(a, b) {
        return a.job_number < b.job_number ? -1 : 1;
      });
      for (var ji = 0; ji < jobRows.length; ji++) {
        var jr = jobRows[ji];
        allRows.push([
          jr.job_number,
          jr.client_job_ref,
          jr.product_code,
          jr.designers,
          jr.total_hours,
          jr.hourly_rate,
          jr.currency,
          jr.amount !== null ? jr.amount : 'NO RATE',
          jr.job_status
        ]);
      }

      // Subtotal row
      allRows.push(['SUBTOTAL', '', '', '',
                    cdata.totalHours, '', cdata.currency, cdata.totalAmount, '']);
      allRows.push(['', '', '', '', '', '', '', '', '']);
    }

    if (allRows.length > 0) {
      sheet.getRange(1, 1, allRows.length, 9).setValues(allRows);
      // Autosize columns
      for (var col = 1; col <= 9; col++) {
        sheet.autoResizeColumn(col);
      }
    }

    Logger.info('TIMESHEET_SHEET_WRITTEN', {
      module:   MODULE,
      tab_name: tabName,
      rows:     allRows.length
    });
  }

  // ── Per-client PDF helpers ───────────────────────────────────

  // Creates or overwrites the TS_{clientCode}_{periodId} sheet tab with a
  // client-facing timesheet layout. Returns the sheet object.
  // Direct SpreadsheetApp: reporting output tabs are not FACT tables;
  // DAL does not support tab creation or arbitrary-layout formatting.
  function writeClientTimesheetTab_(clientCode, clientName, address, periodId, label, entries, staffMap) {
    var tabName = 'TS_' + clientCode + '_' + periodId;
    var ss      = SpreadsheetApp.getActiveSpreadsheet();
    var sheet   = ss.getSheetByName(tabName);
    if (sheet) {
      sheet.clearContents();
      sheet.clearFormats();
    } else {
      sheet = ss.insertSheet(tabName);
    }

    // Sort: work_date ASC, then job_number ASC. S.No assigned after sort.
    entries.sort(function(a, b) {
      var da = ymd_(a.work_date), db = ymd_(b.work_date);
      if (da !== db) return da - db;
      return a.job_number < b.job_number ? -1 : 1;
    });

    var COL_COUNT = 8;
    var sheetData = [];

    // Header block
    sheetData.push([clientName,                                   '', '', '', '', '', '', '']);
    sheetData.push([address,                                      '', '', '', '', '', '', '']);
    sheetData.push(['Timesheet — ' + label,                  '', '', '', '', '', '', '']);
    sheetData.push(['Period: ' + periodId,                        '', '', '', '', '', '', '']);
    sheetData.push(['Generated: ' + new Date().toLocaleString(),  '', '', '', '', '', '', '']);
    sheetData.push(['',                                           '', '', '', '', '', '', '']);

    // Column headers
    sheetData.push(['S.No', 'Date', 'Job #', 'Job Type', 'Description', 'Billable Hours', 'Designer', 'Remarks']);
    var headerRow = sheetData.length; // 1-based = 7

    // Data rows
    var totalHours = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var d = e.work_date;
      var dateStr = d.getFullYear() + '-' +
                    (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' +
                    (d.getDate()    < 10 ? '0' : '') +  d.getDate();
      totalHours += e.hours;
      sheetData.push([
        i + 1,
        dateStr,
        e.job_number,
        e.job_type,
        e.client_job_ref,
        e.hours,
        staffMap[e.designer_code] || e.designer_code,
        e.notes
      ]);
    }
    totalHours = Math.round(totalHours * 100) / 100;

    // Subtotal
    var subtotalRow = sheetData.length + 1; // 1-based
    sheetData.push(['TOTAL', '', '', '', '', totalHours, '', '']);

    sheet.getRange(1, 1, sheetData.length, COL_COUNT).setValues(sheetData);

    // Formatting
    sheet.getRange(1, 1).setFontWeight('bold').setFontSize(14);
    sheet.getRange(3, 1).setFontWeight('bold').setFontSize(12);
    sheet.getRange(headerRow, 1, 1, COL_COUNT)
      .setFontWeight('bold')
      .setBackground('#1a3c5e')
      .setFontColor('#ffffff');
    if (entries.length > 0) {
      sheet.getRange(headerRow + 1, 1, entries.length, COL_COUNT)
        .setBorder(true, true, true, true, true, true, '#cccccc', SpreadsheetApp.BorderStyle.SOLID);
    }
    sheet.getRange(subtotalRow, 1, 1, COL_COUNT)
      .setFontWeight('bold')
      .setBackground('#e8f0fe');
    sheet.autoResizeColumns(1, COL_COUNT);

    return sheet;
  }

  // Exports a single sheet tab as PDF to Google Drive and returns the file URL.
  function exportToPdf_(sheet, fileName) {
    var ss  = SpreadsheetApp.getActiveSpreadsheet();
    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() +
              '/export?exportFormat=pdf&format=pdf&gid=' + sheet.getSheetId() +
              '&size=letter&portrait=true&fitw=true&sheetnames=false' +
              '&printtitle=false&pagenumbers=true&gridlines=false&fzr=true';
    var response = UrlFetchApp.fetch(url, {
      headers:           { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) {
      throw new Error('PDF export HTTP ' + response.getResponseCode() + ' for ' + fileName);
    }
    var file = DriveApp.createFile(response.getBlob().setName(fileName));
    return file.getUrl();
  }

  // Generates a per-client PDF timesheet for the given period.
  // Returns { driveUrl, entries } or null if no work log data found.
  function generateForClient_(clientCode, periodId) {
    periodId      = periodId || currentPeriod_();
    var cc        = (clientCode || '').toUpperCase().trim();
    var period    = parsePeriod_(periodId);
    var label     = periodLabel_(period);
    var clientMap = loadClientMap_();
    var staffMap  = loadStaffMap_();
    var jobMap    = loadJobMap_();

    Logger.info('TIMESHEET_CLIENT_GEN_START', { module: MODULE, client_code: cc, period_id: periodId });

    var clientInfo = clientMap[cc] || { client_name: cc, address: '' };
    var entries    = buildWorkLogEntries_(
      period.monthPartition, period.fromDate, period.toDate, period.year, cc, jobMap
    );

    if (entries.length === 0) {
      Logger.warn('TIMESHEET_CLIENT_NO_ROWS', { module: MODULE, client_code: cc, period_id: periodId });
      console.log('[ClientTimesheetEngine] No billable entries for ' + cc + ' in ' + periodId + ' — PDF skipped.');
      return null;
    }

    var sheet    = writeClientTimesheetTab_(
      cc, clientInfo.client_name, clientInfo.address, periodId, label, entries, staffMap
    );
    var fileName = 'BLC-Timesheet_' + cc + '_' + periodId + '.pdf';
    var driveUrl = exportToPdf_(sheet, fileName);

    Logger.info('TIMESHEET_CLIENT_GEN_COMPLETE', {
      module:      MODULE,
      client_code: cc,
      period_id:   periodId,
      entries:     entries.length,
      drive_url:   driveUrl
    });

    return { driveUrl: driveUrl, entries: entries.length };
  }

  // ── PUBLIC API ───────────────────────────────────────────────
  return {
    generate:           generate,
    generateForClient:  generateForClient_
  };

}());

// ============================================================
// RUNNER FUNCTIONS — call from Apps Script editor
// ============================================================

/**
 * Generates client timesheets for a specific period and writes to
 * sheet tab TIMESHEET|{periodId}.
 *
 * @param {string} [periodId]  e.g. '2026-06A'. Defaults to current period.
 */
function runGenerateClientTimesheets(periodId) {
  var pid    = periodId || '2026-06A';
  var result = ClientTimesheetEngine.generate(pid);
  var clients = Object.keys(result.clients);
  console.log('=== Client Timesheet: ' + pid + ' ===');
  for (var i = 0; i < clients.length; i++) {
    var cc    = clients[i];
    var cdata = result.clients[cc];
    console.log(cc + ': ' + cdata.totalHours + ' hrs | ' + cdata.currency + ' ' + cdata.totalAmount +
                ' (' + cdata.rows.length + ' jobs)');
  }
  console.log('Sheet written: TIMESHEET|' + pid);
}

/**
 * Generates a PDF timesheet for Nelson for the given (or current) period.
 * PDF is saved to Google Drive. Logs the Drive URL.
 *
 * @param {string} [periodId]  e.g. '2026-06B'. Defaults to current period.
 */
function runGenerateNelsonTimesheet(periodId) {
  var pid    = periodId || '2026-06B';
  var result = ClientTimesheetEngine.generateForClient('NELSON', pid);
  if (!result) {
    console.log('[runGenerateNelsonTimesheet] No data for NELSON in ' + pid + ' — nothing generated.');
    return;
  }
  console.log('[runGenerateNelsonTimesheet] PDF generated: ' + result.driveUrl);
  console.log('[runGenerateNelsonTimesheet] Entries: ' + result.entries + ' | Period: ' + pid);
}

/**
 * Diagnostic: shows raw FACT_WORK_LOGS totals for June 1–15 broken down by:
 * - rows with migration_batch (excluded by generate())
 * - rows without migration_batch but job not in VW (excluded by generate())
 * - rows that would be counted by generate()
 *
 * Run in PROD editor to find the root cause of timesheet discrepancies.
 */
function runWorkLogDiagnostic() {
  var MODULE         = 'ClientTimesheetEngine';
  var periodId       = '2026-06A';
  var monthPartition = '2026-06';

  var m = periodId.match(/^(\d{4})-(\d{2})([AB])$/);
  var year     = parseInt(m[1], 10);
  var monthIdx = parseInt(m[2], 10) - 1;
  var fromDate = new Date(year, monthIdx, 1);
  var toDate   = new Date(year, monthIdx, 15);

  function ymd(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
  var fromYMD = ymd(fromDate), toYMD = ymd(toDate);

  function parseDate(raw) {
    if (!raw) return null;
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
    var s   = String(raw).trim();
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(parseInt(iso[1],10), parseInt(iso[2],10)-1, parseInt(iso[3],10));
    var MONTH_MAP = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    var mg = s.match(/[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})/);
    if (mg) { var mi = MONTH_MAP[mg[1].toLowerCase()]; if (mi !== undefined) return new Date(year, mi, parseInt(mg[2],10)); }
    var d = new Date(s); return isNaN(d.getTime()) ? null : d;
  }

  // Load job map
  var jobMap = {};
  try {
    var jrows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    for (var j = 0; j < jrows.length; j++) {
      var jn = String(jrows[j].job_number || '').trim();
      if (jn) jobMap[jn] = jrows[j];
    }
  } catch (e) { console.log('VW load error: ' + e.message); }
  console.log('VW_JOB_CURRENT_STATE entries: ' + Object.keys(jobMap).length);

  // Load work logs
  var rows = [];
  try {
    rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: MODULE, periodId: monthPartition });
  } catch (e) { console.log('FACT_WORK_LOGS load error: ' + e.message); return; }
  console.log('FACT_WORK_LOGS total rows (partition 2026-06): ' + rows.length);

  var countTotal     = 0, hrsTotal     = 0;
  var countMigrated  = 0, hrsMigrated  = 0;
  var countInPeriod  = 0, hrsInPeriod  = 0;
  var countNoJob     = 0, hrsNoJob     = 0;
  var countCounted   = 0, hrsCounted   = 0;

  // Batch values
  var batchTotals = {};
  var clientTotals = {};  // client_code → { counted, excluded_mig, excluded_novw }
  var missingJobNums = {};

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var d   = parseDate(row.work_date);
    if (!d) continue;
    var wd  = ymd(d);
    if (wd < fromYMD || wd > toYMD) continue;

    var hrs = parseFloat(row.hours) || 0;
    if (hrs <= 0) continue;
    countTotal++; hrsTotal += hrs;

    var batch = String(row.migration_batch || '').trim();
    if (batch) {
      batchTotals[batch] = (batchTotals[batch] || 0) + hrs;
      countMigrated++; hrsMigrated += hrs;
      continue;
    }
    countInPeriod++; hrsInPeriod += hrs;

    var jn  = String(row.job_number || '').trim();
    var job = jobMap[jn];
    if (!job) {
      countNoJob++; hrsNoJob += hrs;
      missingJobNums[jn] = (missingJobNums[jn] || 0) + hrs;
      continue;
    }

    var cc = String(job.client_code || 'UNKNOWN').toUpperCase().trim();
    if (!clientTotals[cc]) clientTotals[cc] = { counted: 0, excluded_mig: 0, excluded_novw: 0 };
    clientTotals[cc].counted += hrs;
    countCounted++; hrsCounted += hrs;
  }

  // Re-pass for excluded_mig and excluded_novw per client
  // (need to redo with job lookup for migrated rows too)
  for (var i2 = 0; i2 < rows.length; i2++) {
    var r2 = rows[i2];
    var d2 = parseDate(r2.work_date);
    if (!d2) continue;
    var wd2 = ymd(d2);
    if (wd2 < fromYMD || wd2 > toYMD) continue;
    var hrs2 = parseFloat(r2.hours) || 0;
    if (hrs2 <= 0) continue;
    var jn2  = String(r2.job_number || '').trim();
    var job2 = jobMap[jn2];
    var cc2  = job2 ? String(job2.client_code || 'UNKNOWN').toUpperCase().trim() : 'UNKNOWN';
    if (!clientTotals[cc2]) clientTotals[cc2] = { counted: 0, excluded_mig: 0, excluded_novw: 0 };
    var batch2 = String(r2.migration_batch || '').trim();
    if (batch2) { clientTotals[cc2].excluded_mig += hrs2; }
    else if (!job2) { clientTotals[cc2].excluded_novw += hrs2; }
  }

  console.log('\n=== SUMMARY ===');
  console.log('In-period rows (June 1-15): ' + countTotal + ' rows, ' + Math.round(hrsTotal * 100)/100 + 'h total');
  console.log('  Excluded (migration_batch): ' + countMigrated + ' rows, ' + Math.round(hrsMigrated * 100)/100 + 'h');
  console.log('  No-VW-match (job not in VW): ' + countNoJob + ' rows, ' + Math.round(hrsNoJob * 100)/100 + 'h');
  console.log('  COUNTED by generate(): ' + countCounted + ' rows, ' + Math.round(hrsCounted * 100)/100 + 'h');

  console.log('\n=== MIGRATION BATCH BREAKDOWN ===');
  var batches = Object.keys(batchTotals).sort();
  for (var b = 0; b < batches.length; b++) {
    console.log('  ' + batches[b] + ': ' + Math.round(batchTotals[batches[b]] * 100)/100 + 'h');
  }

  console.log('\n=== PER CLIENT (all non-migrated hours) ===');
  var clients = Object.keys(clientTotals).sort();
  for (var ci = 0; ci < clients.length; ci++) {
    var cc3 = clients[ci];
    var ct  = clientTotals[cc3];
    var net = ct.counted + ct.excluded_novw;
    console.log(cc3 + ': ' + Math.round(net*100)/100 + 'h counted+no-vw | counted=' +
                Math.round(ct.counted*100)/100 + 'h | excluded_mig=' +
                Math.round(ct.excluded_mig*100)/100 + 'h | no_vw=' +
                Math.round(ct.excluded_novw*100)/100 + 'h');
  }

  console.log('\n=== TOP MISSING JOB NUMBERS (no VW match, > 0.5h) ===');
  var missingJobs = Object.keys(missingJobNums);
  missingJobs.sort(function(a, b) { return missingJobNums[b] - missingJobNums[a]; });
  var shown = 0;
  for (var mj = 0; mj < missingJobs.length && shown < 20; mj++) {
    if (missingJobNums[missingJobs[mj]] >= 0.5) {
      console.log('  ' + missingJobs[mj] + ': ' + missingJobNums[missingJobs[mj]] + 'h');
      shown++;
    }
  }
}
