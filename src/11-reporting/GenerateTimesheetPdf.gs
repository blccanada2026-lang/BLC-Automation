// ============================================================
// GenerateTimesheetPdf.gs — BLC Nexus T11 Reporting
// src/11-reporting/GenerateTimesheetPdf.gs
//
// LOAD ORDER: T11, after ClientTimesheetEngine.gs (needs its exposed
// helpers) and GenerateTimesheet.gs (needs generateTimesheet()).
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1),
//               ClientTimesheetEngine (T11, exposed helpers),
//               generateTimesheet() (T11, GenerateTimesheet.gs)
//
// Timesheet-for-any-period feature, CEO/HR_ACCOUNTING only (RBAC
// TIMESHEET_GENERATE — already correctly gated in RBAC.gs, no matrix
// change needed for this feature). User's chosen design direction: the
// same polished PDF output as the existing fixed-period timesheets
// (ClientTimesheetEngine.gs's generateForClient_), not a new format —
// this file reuses that exact HTML/PDF pipeline for an arbitrary
// [startDate, endDate] range instead of a fixed 'YYYY-MMA'/'YYYY-MMB'
// period.
//
// A NEW, small file rather than adding to ClientTimesheetEngine.gs
// (already ~890 lines, over RULE A8's ~500-line cap) or to
// GenerateTimesheet.gs (whose own header comment deliberately scopes
// it to read-only data, no PDF/invoice generation) — same precedent as
// both of those files being split out in the first place.
//
// Reuses generateTimesheet(client, startDate, endDate) for the actual
// entries — that function already has full Jest coverage (netting,
// exclusion, multi-month partition handling, date validation) and is
// the one arbitrary-range entry source in this codebase; duplicating
// that logic here would just be a second, divergent copy of the same
// netting rules. Its entries carry work_date as an ISO string;
// ClientTimesheetEngine.buildTimesheetHtml_ needs a real Date object
// (calls .getFullYear()/.getMonth()/.getDate() directly) — this file's
// only real logic is that reshape, plus wiring the result into the
// existing styled-HTML/PDF/Drive pipeline.
//
// HOW TO RUN (Apps Script editor, DEV project only for the proof
// script — this function itself has no environment guard, since PDF
// generation is a Drive-only side effect with no FACT-table write):
//   generateTimesheetPdf('ACME', '2026-08-01', '2026-08-20')
//   generateAllTimesheetPdfsForRange('2026-08-01', '2026-08-20')
// ============================================================

/** 'YYYY-MM-DD' string -> local-midnight Date. Assumes an already-validated string (generateTimesheet() validated it first). */
function gtp_isoToDate_(iso) {
  var m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

/**
 * Generates a polished PDF timesheet for one client over an arbitrary
 * date range — same HTML/PDF template as the fixed-period timesheets.
 * Returns null if there are no billable entries in range (same
 * contract as ClientTimesheetEngine.generateForClient).
 *
 * @param {string} client          Client code (e.g. 'ACME'). Required.
 * @param {string|Date} startDate  'YYYY-MM-DD' or a Date. Required.
 * @param {string|Date} endDate    'YYYY-MM-DD' or a Date. Required, >= startDate.
 * @param {string} [viewerEmail]   Grants this address VIEW access on the
 *   created PDF — see exportHtmlAsPdf_'s own comment for why this
 *   matters for portal callers specifically.
 * @returns {{ driveUrl: string, entries: number, client: string,
 *             start_date: string, end_date: string, total_hours: number }|null}
 */
function generateTimesheetPdf(client, startDate, endDate, viewerEmail) {
  var data = generateTimesheet(client, startDate, endDate); // validates client/dates, throws on bad input

  if (data.entries.length === 0) {
    console.log('[GenerateTimesheetPdf] No billable entries for ' + data.client + ' in ' +
      data.start_date + ' to ' + data.end_date + ' — PDF skipped.');
    return null;
  }

  var entries = data.entries.map(function (e) {
    return {
      work_date:      gtp_isoToDate_(e.work_date),
      job_number:     e.job_number,
      job_type:       e.job_type,
      client_job_ref: e.client_job_ref,
      designer_code:  e.designer_code,
      hours:          e.hours,
      notes:          e.notes
    };
  });

  var clientInfo = ClientTimesheetEngine.loadClientMap_()[data.client] || { client_name: data.client, address: '' };
  var staffMap   = ClientTimesheetEngine.loadStaffMap_();
  var summary    = ClientTimesheetEngine.buildDesignerSummary_(entries, ClientTimesheetEngine.loadStaffDetailMap_());

  var label    = data.start_date + ' to ' + data.end_date;
  var periodId = 'CUSTOM_' + data.start_date + '_' + data.end_date;
  var html     = ClientTimesheetEngine.buildTimesheetHtml_(
    data.client, clientInfo.client_name, clientInfo.address, periodId, label, entries, staffMap, summary
  );
  var fileName = 'BLC-Timesheet_' + data.client + '_' + data.start_date + '_to_' + data.end_date + '.pdf';
  var driveUrl = ClientTimesheetEngine.exportHtmlAsPdf_(html, fileName, viewerEmail);

  return {
    driveUrl:    driveUrl,
    entries:     entries.length,
    client:      data.client,
    start_date:  data.start_date,
    end_date:    data.end_date,
    total_hours: data.total_hours
  };
}

/**
 * Generates a PDF timesheet for every active client over an arbitrary
 * date range. Clients with no billable entries in range are silently
 * skipped (same as generateTimesheetPdf's null contract) — not an
 * error, just nothing to bill.
 *
 * RULE P1 quota guard: each client does 2 DriveApp.createFile calls
 * plus an HTML->PDF conversion — seconds of real work per client, not
 * the cheap per-record case RULE P1's usual "check every 20" cadence
 * assumes. Checked every iteration instead, since a handful of
 * remaining clients could each individually push past the 6-minute
 * execution limit. Stops before starting a client it can't safely
 * finish and reports what was skipped — never a silent partial run.
 *
 * @param {string|Date} startDate
 * @param {string|Date} endDate
 * @param {string} [viewerEmail]  See generateTimesheetPdf's own comment.
 * @returns {{ results: Array<ReturnType<generateTimesheetPdf>>,
 *             truncated: boolean, remainingClients: Array<string> }}
 */
function generateAllTimesheetPdfsForRange(startDate, endDate, viewerEmail) {
  var activeCodes = [];
  try {
    var rows = DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: 'GenerateTimesheetPdf' });
    rows.forEach(function (r) {
      if (String(r.active || '').toUpperCase() === 'TRUE') {
        activeCodes.push(String(r.client_code || '').trim().toUpperCase());
      }
    });
  } catch (e) { /* no clients configured */ }
  activeCodes = activeCodes.filter(Boolean);

  var results = [];
  var i;
  for (i = 0; i < activeCodes.length; i++) {
    if (HealthMonitor.isApproachingLimit()) break;
    var pdf = generateTimesheetPdf(activeCodes[i], startDate, endDate, viewerEmail);
    if (pdf) results.push(pdf);
  }

  var truncated = i < activeCodes.length;
  if (truncated) {
    Logger.warn('TIMESHEET_PDF_RANGE_QUOTA_CUTOFF', {
      module: 'GenerateTimesheetPdf', processed: i, total: activeCodes.length
    });
  }

  return { results: results, truncated: truncated, remainingClients: activeCodes.slice(i) };
}
