// ============================================================
// GenerateTimesheetPdfDevRehearsal.gs — BLC Nexus T12 (DEV-only)
//
// DEV rehearsal for the timesheet-for-any-period feature
// (GenerateTimesheetPdf.gs). generateTimesheetPdf()/
// generateAllTimesheetPdfsForRange() are pure-read on FACT/VW data —
// no FACT/VW writes, so unlike this session's other DEV rehearsals
// there is nothing to reset and no callerModule/WRITE_PERMISSIONS
// registration needed. Their one real-service dependency Jest cannot
// verify is the actual HTML-to-PDF Drive conversion (Jest's own test,
// tests/generate-timesheet-pdf.test.js, mocks DriveApp) — this
// rehearsal proves that conversion actually works against a real
// Drive, using whatever real client/date-range data already exists in
// DEV (safe: read-only on FACT/VW, the only write is a new Drive PDF
// file, same as running runGenerateClientTimesheets() manually).
//
// This script alone CANNOT prove the addViewer() Drive-sharing fix
// (ClientTimesheetEngine.exportHtmlAsPdf_'s viewerEmail param) actually
// helps a real portal user — it runs as its own operator, who already
// owns the files it creates. That needs a real CEO/HR_ACCOUNTING
// account clicking "Generate PDF" in the portal itself and confirming
// they can open the returned link — see the reminder this script
// prints at the end.
//
// HOW TO RUN (Apps Script editor, DEV project only):
//   runGenerateTimesheetPdfDevRehearsal()                                   — all active clients, current month to date
//   runGenerateTimesheetPdfDevRehearsal('SBS', '2026-08-01', '2026-08-20')  — one client, explicit range
// ============================================================

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
