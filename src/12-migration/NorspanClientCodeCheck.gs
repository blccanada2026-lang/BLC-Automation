// ============================================================
// NorspanClientCodeCheck.gs — BLC Nexus T12 Diagnostic (READ-ONLY)
//
// Investigates Sarty's 2026-07-08 report: plain "NORSPAN" (~55 jobs)
// and "NORSPAN-MB" (~4 jobs) both showing in the portal job list —
// flagged as the same class of problem as MATIX vs. MATIX-SK (a bare
// client_code with no DIM_CLIENT_MASTER row). Confirmed via
// SetupScript.gs: only NORSPAN-MB has a real DIM_CLIENT_MASTER row;
// bare "NORSPAN" does not.
//
// A prior note (ExecutionHealthMonitor.gs's HM_TEST_CLIENT_CODES_
// comment, 2026-07-09) says "88 NORSPAN jobs were a client_code
// mismatch/typo, already voided" — but that predates this
// investigation, uses a different count than Sarty's 55, and doesn't
// say whether the jobs themselves were voided (data/billing loss risk)
// or just the client_code was corrected. This re-checks CURRENT real
// state rather than trusting that note at face value.
//
// Also checks the user's specific hypothesis (2026-08-07): some
// job_numbers might legitimately appear more than once because the
// SAME job_number covers both a roof and a floor component with a
// DIFFERENT product_code — not a true duplicate/mismatch. Same class
// of pattern as the client_job_ref/designer split documented in
// PROJECT_MEMORY.md §3.6 (job-create duplicate-prevention work).
//
// Read-only. DAL.readAll only, no writes, no fix applied here.
//
// HOW TO RUN (Apps Script editor, PROD project):
//   runNorspanClientCodeCheck()
// ============================================================

function runNorspanClientCodeCheck() {
  var scriptId = ScriptApp.getScriptId();
  console.log('=== NORSPAN client-code investigation (read-only) ===');
  console.log('Script ID: ' + scriptId + ' — confirm this is the PROD project before trusting this output.');

  // ── 1. DIM_CLIENT_MASTER — which NORSPAN-ish codes have a real dimension row? ──
  var clientRows = DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: 'MigrationReplayEngine' });
  var norspanClients = clientRows.filter(function (c) {
    return /NORSPAN/i.test(String(c.client_code || '')) || /NORSPAN/i.test(String(c.client_name || ''));
  });
  console.log('');
  console.log('--- DIM_CLIENT_MASTER rows matching /NORSPAN/i: ' + norspanClients.length + ' ---');
  norspanClients.forEach(function (c) {
    console.log('  client_code=' + c.client_code + '  client_name=' + c.client_name + '  active=' + c.active);
  });

  // ── 2. VW_JOB_CURRENT_STATE — all jobs on any NORSPAN-ish client_code, active vs voided ──
  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: 'MigrationReplayEngine' });
  var norspanJobs = vwRows.filter(function (r) {
    return /NORSPAN/i.test(String(r.client_code || ''));
  });
  console.log('');
  console.log('--- VW_JOB_CURRENT_STATE rows matching /NORSPAN/i: ' + norspanJobs.length + ' ---');

  var byCode = {};
  norspanJobs.forEach(function (r) {
    var code = String(r.client_code || '');
    if (!byCode[code]) byCode[code] = { total: 0, voided: 0, active: 0 };
    byCode[code].total++;
    if (String(r.current_state || '').toUpperCase() === 'VOIDED') byCode[code].voided++;
    else byCode[code].active++;
  });
  Object.keys(byCode).sort().forEach(function (code) {
    var d = byCode[code];
    console.log('  "' + code + '": ' + d.total + ' total (' + d.active + ' active/visible today, ' + d.voided + ' voided)');
  });

  // ── 3. Job numbers appearing under MORE THAN ONE NORSPAN-ish client_code ──
  var byJobNumber = {};
  norspanJobs.forEach(function (r) {
    var jn = String(r.job_number || '');
    if (!byJobNumber[jn]) byJobNumber[jn] = [];
    byJobNumber[jn].push(r);
  });
  var multiCodeJobs = Object.keys(byJobNumber).filter(function (jn) {
    var codes = {};
    byJobNumber[jn].forEach(function (r) { codes[String(r.client_code || '')] = true; });
    return Object.keys(codes).length > 1;
  });
  console.log('');
  console.log('--- job_numbers appearing under MORE THAN ONE NORSPAN-ish client_code: ' + multiCodeJobs.length + ' ---');
  multiCodeJobs.forEach(function (jn) {
    console.log('  ' + jn + ':');
    byJobNumber[jn].forEach(function (r) {
      console.log('    client_code=' + r.client_code + ' product_code=' + r.product_code +
                  ' client_job_ref=' + r.client_job_ref + ' current_state=' + r.current_state +
                  ' allocated_to=' + r.allocated_to);
    });
  });

  // ── 4. Job numbers appearing MORE THAN ONCE under the SAME client_code —
  //      real duplicate rows, or a legitimate roof/floor split (different
  //      product_code, same job_number, per the user's hypothesis)? ──
  var dupWithinCode = Object.keys(byJobNumber).filter(function (jn) {
    return byJobNumber[jn].length > 1 && multiCodeJobs.indexOf(jn) === -1;
  });
  console.log('');
  console.log('--- job_numbers appearing MORE THAN ONCE under the SAME NORSPAN-ish client_code: ' + dupWithinCode.length + ' ---');
  dupWithinCode.forEach(function (jn) {
    console.log('  ' + jn + ' (' + byJobNumber[jn].length + ' rows):');
    byJobNumber[jn].forEach(function (r) {
      console.log('    client_code=' + r.client_code + ' product_code=' + r.product_code +
                  ' client_job_ref=' + r.client_job_ref + ' current_state=' + r.current_state +
                  ' allocated_to=' + r.allocated_to);
    });
  });

  // ── 5. Full listing of ACTIVE (non-voided) bare "NORSPAN" jobs — what a
  //      user would actually see in the portal job list today ──
  var activeBareNorspan = norspanJobs.filter(function (r) {
    return String(r.client_code || '').toUpperCase() === 'NORSPAN' &&
           String(r.current_state || '').toUpperCase() !== 'VOIDED';
  });
  console.log('');
  console.log('--- ACTIVE (visible, non-voided) jobs on bare client_code "NORSPAN": ' + activeBareNorspan.length + ' ---');
  activeBareNorspan.forEach(function (r) {
    console.log('  ' + r.job_number + ' product_code=' + r.product_code + ' client_job_ref=' + r.client_job_ref +
                ' current_state=' + r.current_state + ' allocated_to=' + r.allocated_to);
  });

  console.log('');
  console.log('=== Done. Review every section above before proposing any fix — do not act on this output alone. ===');
}
