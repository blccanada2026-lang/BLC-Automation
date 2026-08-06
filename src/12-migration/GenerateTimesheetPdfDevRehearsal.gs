// ============================================================
// GenerateTimesheetPdfDevRehearsal.gs — BLC Nexus T12 (DEV-only)
//
// DEV rehearsal for the timesheet-for-any-period feature
// (GenerateTimesheetPdf.gs). Their one real-service dependency Jest
// cannot verify is the actual HTML-to-PDF Drive conversion (Jest's own
// test, tests/generate-timesheet-pdf.test.js, mocks DriveApp) — this
// rehearsal proves that conversion actually works against a real Drive.
//
// 2026-08-06 finding: DEV has NO live (non-migrated) FACT_WORK_LOGS
// data at all — everything before June 2026 is excluded by
// isMigratedWorkLog() (V2->V3 migration, same exclusion every
// timesheet/billing/payroll calculation applies, not unique to this
// feature), and nothing has been logged in DEV since. So "whatever
// real data exists" (this file's original approach) can never
// exercise the real-PDF-generation path in DEV — runGenerateTimesheet
// PdfMechanismProof() below seeds one small synthetic (TEST-CLIENT,
// non-migrated event_type) work log entry instead, proving the Drive
// pipeline actually works without depending on real data existing.
// Narrow-filtered reset before AND after, same pattern as every other
// DEV rehearsal this session — never bulk-clears either table.
//
// This mechanism proof does NOT and cannot prove the generated PDF's
// BUSINESS CONTENT matches a real historical manually-sent timesheet
// — that needs real non-migrated data, which only exists in PROD.
//
// It also cannot prove the addViewer() Drive-sharing fix
// (ClientTimesheetEngine.exportHtmlAsPdf_'s viewerEmail param) helps a
// real DIFFERENT user — it runs as its own operator, who already owns
// the files it creates. That needs a real CEO/HR_ACCOUNTING account
// clicking "Generate PDF" in the portal and confirming they can open
// the returned link.
//
// HOW TO RUN (Apps Script editor, DEV project only):
//   runGenerateTimesheetPdfMechanismProof()                                — RECOMMENDED. Seeds synthetic
//                                                                             non-migrated data, proves the real
//                                                                             Drive PDF pipeline works, cleans up.
//   runGenerateTimesheetPdfDevRehearsal()                                   — ad-hoc check against real DEV data,
//   runGenerateTimesheetPdfDevRehearsal('SBS', '2026-08-01', '2026-08-20')    if/when DEV ever has any again.
//   runGenerateTimesheetPdfDevRehearsalWideRange()                         — no-arg wide-range version of the above.
// ============================================================

var GTPDR_CLIENT_     = 'TEST-CLIENT';
var GTPDR_JOB_NUMBER_  = 'BLC-90001'; // out-of-range synthetic block, per testing-policy.md §1
var GTPDR_REF_         = 'DEVREHEARSAL-TIMESHEET-PDF';
var GTPDR_PARTITION_   = '2026-06';   // after the Jan-May migration cutoff — a real non-migrated month
var GTPDR_WORK_DATE_   = '2026-06-10';
var GTPDR_DESIGNER_    = 'DS1';       // reserved DEV-only synthetic designer, per testing-policy.md §1
var GTPDR_CALLER_      = 'GenerateTimesheetPdfDevRehearsal';

function gtpdr_reset_() {
  console.log('--- Reset: removing any prior rehearsal artifacts ---');
  [
    { table: Config.TABLES.FACT_WORK_LOGS, opts: { callerModule: GTPDR_CALLER_, periodId: GTPDR_PARTITION_ }, tabName: Config.TABLES.FACT_WORK_LOGS + '|' + GTPDR_PARTITION_, matchField: 'notes' },
    { table: Config.TABLES.VW_JOB_CURRENT_STATE, opts: { callerModule: GTPDR_CALLER_ }, tabName: Config.TABLES.VW_JOB_CURRENT_STATE, matchField: 'client_job_ref' }
  ].forEach(function (spec) {
    var all;
    try { all = DAL.readAll(spec.table, spec.opts); } catch (e) { all = []; }
    var kept = all.filter(function (r) { return String(r[spec.matchField] || '').indexOf(GTPDR_REF_) === -1; });
    if (kept.length < all.length) {
      DAL.clearSheet(spec.tabName);
      if (kept.length > 0) DAL.appendRows(spec.table, kept, spec.opts);
      console.log('  ' + spec.table + ': kept ' + kept.length + ', dropped ' + (all.length - kept.length) + ' synthetic row(s).');
    }
  });
  console.log('--- Reset complete. ---');
}

function gtpdr_seed_() {
  DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, GTPDR_PARTITION_, GTPDR_CALLER_); // idempotent — safe even if the tab already exists

  DAL.appendRow(Config.TABLES.VW_JOB_CURRENT_STATE, {
    job_number: GTPDR_JOB_NUMBER_, client_code: GTPDR_CLIENT_, product_code: 'ROOF_TRUSS',
    job_type: 'DESIGN', client_job_ref: GTPDR_REF_, current_state: 'COMPLETED_BILLABLE',
    allocated_to: GTPDR_DESIGNER_
  }, { callerModule: GTPDR_CALLER_ });

  DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
    event_id: Identifiers.generateId(), event_type: 'WORK_LOG_SUBMITTED',
    job_number: GTPDR_JOB_NUMBER_, actor_code: GTPDR_DESIGNER_, hours: 3,
    work_date: GTPDR_WORK_DATE_, notes: GTPDR_REF_
  }, { callerModule: GTPDR_CALLER_, periodId: GTPDR_PARTITION_ });
}

/**
 * RECOMMENDED entry point. Seeds one small, synthetic, non-migrated
 * work log entry (TEST-CLIENT, June 2026 — a real live month, not the
 * Jan-May migrated window), generates a real PDF against it, verifies
 * the result, and cleans up. Proves the actual Drive PDF pipeline
 * works without depending on real DEV data existing (it currently
 * doesn't, past May 2026 — see this file's header).
 */
function runGenerateTimesheetPdfMechanismProof() {
  if (!Config.isDev()) {
    throw new Error('runGenerateTimesheetPdfMechanismProof cannot run outside DEV.');
  }

  var results = { pass: 0, fail: 0, failures: [] };
  function check(label, actualPass, detail) {
    if (actualPass) { results.pass++; console.log('  PASS — ' + label); }
    else { results.fail++; results.failures.push(label + ' — ' + detail); console.log('  FAIL — ' + label + ' — ' + detail); }
  }

  console.log('=== generateTimesheetPdf — real Drive PDF mechanism proof (synthetic data) ===');
  gtpdr_reset_();
  gtpdr_seed_();

  var viewerEmail = Session.getActiveUser().getEmail();
  var result = null, err = null;
  try {
    result = generateTimesheetPdf(GTPDR_CLIENT_, '2026-06-01', '2026-06-15', viewerEmail);
  } catch (e) { err = e.message; }

  check('generateTimesheetPdf does not throw', err === null, err || '');
  check('Result is not null (the seeded entry was found)', result !== null, JSON.stringify(result));

  if (result) {
    check('entries === 1', result.entries === 1, String(result.entries));
    check('total_hours === 3', result.total_hours === 3, String(result.total_hours));
    check('driveUrl looks like a real Drive URL', /^https:\/\/.*drive/.test(result.driveUrl || ''), result.driveUrl || '');
    console.log('  [PDF] ' + result.client + ' — ' + result.entries + ' entries, ' + result.total_hours + 'h -> ' + result.driveUrl);
  }

  gtpdr_reset_();

  console.log('');
  console.log('=== RESULT: ' + results.pass + ' passed, ' + results.fail + ' failed ===');
  if (result) console.log('Open the Drive URL above and eyeball the PDF — client name, 1 row for ' + GTPDR_WORK_DATE_ + ', 3h, designer resolved.');
  console.log('NOTE: this proves the mechanism, not business-content correctness against a real historical ' +
    'timesheet (needs real non-migrated data, only in PROD), and cannot prove addViewer() helps a DIFFERENT ' +
    'user (this script owns its own files) — see this file\'s header.');
  if (results.fail > 0) {
    console.log('FAILURES:');
    results.failures.forEach(function (f) { console.log('  - ' + f); });
  }

  return results;
}

function runGenerateTimesheetPdfDevRehearsalWideRange() {
  return runGenerateTimesheetPdfDevRehearsal('', '2026-01-01', generateTimesheetPdfDevRehearsal_toIso_(new Date()));
}

function runGenerateTimesheetPdfDevRehearsal(clientCode, startDate, endDate) {
  if (!Config.isDev()) {
    throw new Error('runGenerateTimesheetPdfDevRehearsal cannot run outside DEV.');
  }

  var results = { pass: 0, fail: 0, failures: [] };
  function check(label, actualPass, detail) {
    if (actualPass) { results.pass++; console.log('  PASS — ' + label); }
    else { results.fail++; results.failures.push(label + ' — ' + detail); console.log('  FAIL — ' + label + ' — ' + detail); }
  }

  console.log('=== generateTimesheetPdf / generateAllTimesheetPdfsForRange — DEV rehearsal ===');

  // ── 1. An empty, far-future range must return null and touch no Drive file. ──
  var emptyResult = null, emptyErr = null;
  try {
    emptyResult = generateTimesheetPdf('SBS', '2099-01-01', '2099-01-02');
  } catch (e) { emptyErr = e.message; }
  check('Empty/future range returns null (no throw)', emptyErr === null, emptyErr || '');
  check('Empty/future range result is null', emptyResult === null, JSON.stringify(emptyResult));

  // ── 2. A real client + range with actual logged hours produces a real PDF. ──
  var now   = new Date();
  var start = startDate || (now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01');
  var end   = endDate   || generateTimesheetPdfDevRehearsal_toIso_(now);

  var pdfResults = [];
  var truncated  = false;
  var runErr     = null;
  var viewerEmail = Session.getActiveUser().getEmail(); // proves the addViewer share path against a real Drive too
  try {
    if (clientCode) {
      pdfResults = [generateTimesheetPdf(clientCode, start, end, viewerEmail)].filter(Boolean);
    } else {
      var outcome = generateAllTimesheetPdfsForRange(start, end, viewerEmail);
      pdfResults = outcome.results;
      truncated  = outcome.truncated;
    }
  } catch (e) { runErr = e.message; }

  check('Real-data range does not throw', runErr === null, runErr || '');
  check('At least one PDF was generated for ' + start + ' to ' + end,
    pdfResults.length > 0,
    'Got 0 results — try passing a client_code/date range known to have logged hours in DEV.');
  check('Did not hit the RULE P1 quota cutoff for this small a run', !truncated,
    'truncated=true — unexpected for a normal-size DEV rehearsal run.');

  pdfResults.forEach(function (r) {
    check('PDF for ' + r.client + ' has a real Drive URL', /^https:\/\/.*drive/.test(r.driveUrl || ''), r.driveUrl || '');
    console.log('  [PDF] ' + r.client + ' — ' + r.entries + ' entries, ' + r.total_hours + 'h -> ' + r.driveUrl);
  });

  console.log('');
  console.log('=== RESULT: ' + results.pass + ' passed, ' + results.fail + ' failed ===');
  console.log('Open the Drive URL(s) above and eyeball the PDF — correct client name/address, dates in range, designer names resolved, totals add up.');
  console.log('NOTE: this script runs as ' + viewerEmail + ', who already owns these files by default — ' +
    'it cannot prove the addViewer() share actually helps a DIFFERENT user. Verify that separately: have an ' +
    'actual CEO/HR_ACCOUNTING account click "Generate PDF" in the real portal and confirm THEY can open the ' +
    'returned link.');
  if (results.fail > 0) {
    console.log('FAILURES:');
    results.failures.forEach(function (f) { console.log('  - ' + f); });
  }

  return results;
}

function generateTimesheetPdfDevRehearsal_toIso_(d) {
  var mm = String(d.getMonth() + 1); if (mm.length < 2) mm = '0' + mm;
  var dd = String(d.getDate());      if (dd.length < 2) dd = '0' + dd;
  return d.getFullYear() + '-' + mm + '-' + dd;
}
