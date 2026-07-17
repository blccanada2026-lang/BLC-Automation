// ============================================================
// TimesheetPeriodRunner.gs — BLC Nexus T11 Reporting
// src/11-reporting/TimesheetPeriodRunner.gs
//
// Dedicated, dated wrapper functions for ClientTimesheetEngine.gs's
// runGenerateClientTimesheets(periodId). New small file rather than
// adding to ClientTimesheetEngine.gs (already 872 lines, well over
// RULE A8's ~500-line cap) — same precedent as RatingRequestPreview.gs.
//
// Why this file exists: the Apps Script editor's Run button cannot pass
// arguments to a function — it always calls the selected function with
// zero arguments. runGenerateClientTimesheets(periodId) defaults to
// *today's* half-month period when called with no argument, which is
// wrong whenever you need a period other than the current one (e.g.
// running on/after July 16 for the July 1–15 period). These wrappers
// hardcode the period so they're directly runnable from the function
// dropdown with no manual argument entry.
// ============================================================

/**
 * Generates client timesheets + PDFs for July 1–15, 2026 (period
 * 2026-07A). Writes sheet tab TIMESHEET|2026-07A and one PDF per client
 * with billable entries in that range.
 */
function runGenerateClientTimesheetsJuly2026A() {
  runGenerateClientTimesheets('2026-07A');
}
