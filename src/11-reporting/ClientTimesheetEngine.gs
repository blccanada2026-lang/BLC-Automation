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

    var fromYMD = ymd_(fromDate), toYMD = ymd_(toDate);
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.migration_batch) continue;
      var d   = parseWorkDate_(row.work_date, year);
      if (!d) continue;
      var wd  = ymd_(d);
      if (wd < fromYMD || wd > toYMD) continue;
      var jn  = String(row.job_number  || '').trim();
      var ac  = String(row.actor_code  || '').trim().toUpperCase();
      var hrs = parseFloat(row.hours)  || 0;
      if (!jn || hrs <= 0) continue;
      if (!byJobDesigner[jn]) byJobDesigner[jn] = {};
      byJobDesigner[jn][ac] = (byJobDesigner[jn][ac] || 0) + hrs;
    }
    return byJobDesigner;
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

  // ── PUBLIC API ───────────────────────────────────────────────
  return {
    generate: generate
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
