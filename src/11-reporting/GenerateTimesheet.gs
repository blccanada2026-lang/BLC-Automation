// ============================================================
// GenerateTimesheet.gs — BLC Nexus T11 Reporting
// src/11-reporting/GenerateTimesheet.gs
//
// LOAD ORDER: T11, after ClientTimesheetEngine.gs (alphabetical within
// T11; also needs its exposed helpers already defined).
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1),
//               WorkLogExclusion (T6, isMigratedWorkLog),
//               ClientTimesheetEngine (T11, exposed helpers)
//
// Phase B1, payroll automation, Item 4. A NEW, small file rather than
// adding to ClientTimesheetEngine.gs (already ~880 lines, well over
// RULE A8's ~500-line cap) — same precedent as TimesheetPeriodRunner.gs
// and RatingRequestPreview.gs.
//
// generateTimesheet(client, startDate, endDate) is deliberately
// narrower in scope than ClientTimesheetEngine.generate(): no
// PreBillingGate check, no rate/amount lookup, no PDF/invoice
// generation. This is a general-purpose, read-only "give me the
// timesheet entries for one client and an arbitrary date range" data
// function — it does not replace or interact with the billing invoice
// pipeline, which stays untouched.
//
// Shared exclusion + netting: reuses isMigratedWorkLog() (the exact
// same shared exclusion predicate every other engine uses) and the
// same NETTING PRINCIPLE Task 1 established in aggregateNetWorkLogHours()
// — sum every nonzero hours value, including negative correction
// deltas, rather than early-filtering `hours <= 0` (the bug Task 1
// fixed for Payroll/Bonus). aggregateNetWorkLogHours() itself is NOT
// called directly here because it aggregates per-actor only
// (design_hours/qc_hours totals) — a client timesheet needs per-
// (job_number, designer_code) granularity for billing line items,
// which that function's return shape doesn't provide. The netting
// loop below applies the identical principle at that finer
// granularity, mirroring ClientTimesheetEngine.buildWorkLogEntries_'s
// already-correct (if not literally shared) implementation.
//
// Unlike ClientTimesheetEngine's period-based functions (a semi-
// monthly period never crosses a calendar month), an arbitrary
// [startDate, endDate] range CAN span more than one monthly
// FACT_WORK_LOGS partition — this function reads every partition the
// range touches and combines them.
//
// HOW TO RUN (Apps Script editor, DEV project only for the proof
// script — this function itself has no environment guard, since it's
// read-only and has no side effects to gate):
//   generateTimesheet('ACME', '2026-08-01', '2026-08-15')
//   firstHalf(2026, 8)   — all active clients, 1st-15th
//   secondHalf(2026, 8)  — all active clients, 16th-end of month
// ============================================================

/** 'YYYY-MM-DD' string or Date -> Date (local midnight). Throws on anything ambiguous or unparseable. */
function gts_parseUnambiguousDate_(val, label) {
  if (val instanceof Date) {
    if (isNaN(val.getTime())) throw new Error('generateTimesheet: ' + label + ' is an invalid Date object.');
    return new Date(val.getFullYear(), val.getMonth(), val.getDate());
  }
  var s = String(val || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    throw new Error('generateTimesheet: ' + label + ' "' + s + '" is not an unambiguous date. ' +
      'Use "YYYY-MM-DD" or a real Date object — ambiguous formats like "MM/DD/YYYY" are rejected.');
  }
  var year = parseInt(m[1], 10), month = parseInt(m[2], 10), day = parseInt(m[3], 10);
  var d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    throw new Error('generateTimesheet: ' + label + ' "' + s + '" is not a real calendar date.');
  }
  return d;
}

function gts_ymd_(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }

function gts_toIsoDate_(d) {
  var m = String(d.getMonth() + 1); if (m.length < 2) m = '0' + m;
  var day = String(d.getDate()); if (day.length < 2) day = '0' + day;
  return d.getFullYear() + '-' + m + '-' + day;
}

/** Every 'YYYY-MM' partition key touched by [fromDate, toDate], inclusive. */
function gts_monthPartitionsInRange_(fromDate, toDate) {
  var partitions = [];
  var cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1);
  var last   = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
  while (cursor <= last) {
    var mm = String(cursor.getMonth() + 1); if (mm.length < 2) mm = '0' + mm;
    partitions.push(cursor.getFullYear() + '-' + mm);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return partitions;
}

/**
 * Timesheet entries for one client over an arbitrary date range.
 * Read-only — no writes, no PDF, no billing gate.
 *
 * @param {string} client       Client code (e.g. 'ACME'). Required.
 * @param {string|Date} startDate  'YYYY-MM-DD' or a Date. Required.
 * @param {string|Date} endDate    'YYYY-MM-DD' or a Date. Required, >= startDate.
 * @returns {{ run_id, generated_at, client, start_date, end_date,
 *             entries: Array<{job_number, designer_code, job_type,
 *             client_job_ref, hours, work_date, notes}>, total_hours }}
 */
function generateTimesheet(client, startDate, endDate) {
  var cc = String(client || '').trim().toUpperCase();
  if (!cc) throw new Error('generateTimesheet: client is required.');

  var fromDate = gts_parseUnambiguousDate_(startDate, 'startDate');
  var toDate   = gts_parseUnambiguousDate_(endDate,   'endDate');
  if (fromDate > toDate) {
    throw new Error('generateTimesheet: startDate (' + gts_toIsoDate_(fromDate) + ') is after endDate (' +
      gts_toIsoDate_(toDate) + ').');
  }

  var jobMap     = ClientTimesheetEngine.loadJobMap_();
  var productMap = ClientTimesheetEngine.loadProductMap_();
  var fromYMD    = gts_ymd_(fromDate);
  var toYMD      = gts_ymd_(toDate);
  var year       = fromDate.getFullYear();

  // Accumulator keyed by "job_number\x00designer_code" — same shape as
  // ClientTimesheetEngine.buildWorkLogEntries_'s proven netting logic.
  var agg = {};

  gts_monthPartitionsInRange_(fromDate, toDate).forEach(function (monthPartition) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: 'GenerateTimesheet', periodId: monthPartition });
    } catch (e) { rows = []; }

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (isMigratedWorkLog(row)) continue;

      var d = ClientTimesheetEngine.parseWorkDate_(row.work_date, year);
      if (!d) continue;
      var wd = gts_ymd_(d);
      if (wd < fromYMD || wd > toYMD) continue;

      var jn = String(row.job_number || '').trim().split(/\s+/)[0];
      var hrs = parseFloat(row.hours);
      if (!jn || isNaN(hrs) || hrs === 0) continue;

      var job = jobMap[jn];
      if (!job) continue;
      if (String(job.client_code || '').toUpperCase().trim() !== cc) continue;

      var ac  = String(row.actor_code || '').trim().toUpperCase();
      var key = jn + '\x00' + ac;
      if (!agg[key]) {
        agg[key] = { job: job, job_number: jn, designer_code: ac, minDate: d, hours: 0, notes: {} };
      } else if (hrs > 0 && d < agg[key].minDate) {
        agg[key].minDate = d;
      }
      agg[key].hours += hrs;
      var note = String(row.notes || '').trim();
      if (note) agg[key].notes[note] = true;
    }
  });

  var entries = [];
  var totalHours = 0;
  Object.keys(agg).forEach(function (key) {
    var a = agg[key];
    var net = Math.round(a.hours * 100) / 100;
    if (net <= 0) return; // fully-reversed pair — no ghost entry, same as ClientTimesheetEngine
    entries.push({
      job_number:     a.job_number,
      designer_code:  a.designer_code,
      job_type:       ClientTimesheetEngine.resolveProductName_(String(a.job.product_code || ''), productMap) ||
                       String(a.job.job_type || '') || '—',
      client_job_ref: String(a.job.client_job_ref || '').trim() || ('BLC-' + a.job_number),
      hours:          net,
      work_date:      gts_toIsoDate_(a.minDate),
      notes:          Object.keys(a.notes).join('; ')
    });
    totalHours += net;
  });

  return {
    run_id:       Identifiers.generateId(),
    generated_at: new Date().toISOString(),
    client:       cc,
    start_date:   gts_toIsoDate_(fromDate),
    end_date:     gts_toIsoDate_(toDate),
    entries:      entries,
    total_hours:  Math.round(totalHours * 100) / 100
  };
}

/**
 * Every active client's generateTimesheet() for the 1st-15th of the
 * given month. Convenience wrapper — computes the date range so
 * callers don't have to.
 *
 * @param {number} year
 * @param {number} month  1-12
 * @returns {Array<ReturnType<generateTimesheet>>}
 */
function firstHalf(year, month) {
  var mm = String(month); if (mm.length < 2) mm = '0' + mm;
  var start = year + '-' + mm + '-01';
  var end   = year + '-' + mm + '-15';
  return gts_runForAllActiveClients_(start, end);
}

/**
 * Every active client's generateTimesheet() for the 16th through the
 * LAST day of the given month — correctly handles 28/29/30/31-day
 * months, including leap-year February.
 *
 * @param {number} year
 * @param {number} month  1-12
 * @returns {Array<ReturnType<generateTimesheet>>}
 */
function secondHalf(year, month) {
  var mm = String(month); if (mm.length < 2) mm = '0' + mm;
  var start = year + '-' + mm + '-16';
  // Day 0 of next month = last day of this month — correctly accounts
  // for 28/29/30/31 and leap years without a lookup table.
  var lastDay = new Date(year, month, 0).getDate();
  var dd = String(lastDay); if (dd.length < 2) dd = '0' + dd;
  var end = year + '-' + mm + '-' + dd;
  return gts_runForAllActiveClients_(start, end);
}

function gts_runForAllActiveClients_(start, end) {
  var activeCodes = [];
  try {
    var rows = DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: 'GenerateTimesheet' });
    rows.forEach(function (r) {
      if (String(r.active || '').toUpperCase() === 'TRUE') {
        activeCodes.push(String(r.client_code || '').trim().toUpperCase());
      }
    });
  } catch (e) { /* no clients configured */ }

  return activeCodes.filter(Boolean).map(function (code) {
    return generateTimesheet(code, start, end);
  });
}
