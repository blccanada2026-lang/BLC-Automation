// ============================================================
// JobCreateRecentDuplicateDevRehearsal.gs — BLC Nexus T12 (DEV-only)
//
// DEV rehearsal for JobCreateHandler.gs's new recent-content-duplicate
// guard (prevention fix for BLC-00891/BLC-00892, Sarty, 2026-08-05).
// Calls the REAL JobCreateHandler.handle() twice in a row with an
// identical payload — proves the second call is blocked against real
// Sheets, not just a Jest mock.
//
// Writes into DEV's REAL current-period FACT_JOB_EVENTS/
// VW_JOB_CURRENT_STATE (JobCreateHandler always resolves
// Identifiers.generateCurrentPeriodId() internally — same constraint
// established earlier this session, the DAL self-heal rehearsal).
// Never bulk-clears either table — narrow-filtered by a distinctive
// synthetic client_job_ref only, same reset-at-start pattern as every
// other DEV rehearsal this session.
//
// HOW TO RUN (Apps Script editor, DEV project only):
//   runJobCreateRecentDuplicateDevRehearsal()
// ============================================================

var JCRDDR_CALLER_   = 'MigrationEngine';
var JCRDDR_CLIENT_    = 'TEST-CLIENT';
var JCRDDR_PRODUCT_   = 'ROOF_TRUSS';
var JCRDDR_REF_       = 'DEVREHEARSAL-DUPGUARD-' + new Date().getTime();
var JCRDDR_EMAIL_     = 'test-pm@test.blc.internal';

function jcrddrReset_(periodId) {
  console.log('--- Reset: removing any prior rehearsal artifacts ---');

  [Config.TABLES.FACT_JOB_EVENTS, Config.TABLES.VW_JOB_CURRENT_STATE].forEach(function (t) {
    var opts = (t === Config.TABLES.FACT_JOB_EVENTS) ? { callerModule: JCRDDR_CALLER_, periodId: periodId } : { callerModule: JCRDDR_CALLER_ };
    var all;
    try { all = DAL.readAll(t, opts); } catch (e) { all = []; }
    var kept = all.filter(function (r) { return String(r.client_job_ref || '') !== JCRDDR_REF_; });
    if (kept.length < all.length) {
      var tabName = (t === Config.TABLES.FACT_JOB_EVENTS) ? (t + '|' + periodId) : t;
      DAL.clearSheet(tabName);
      if (kept.length > 0) DAL.appendRows(t, kept, opts);
      console.log('  ' + t + ': kept ' + kept.length + ', dropped ' + (all.length - kept.length) + ' synthetic row(s).');
    }
  });

  console.log('--- Reset complete. ---');
}

function runJobCreateRecentDuplicateDevRehearsal() {
  if (!Config.isDev()) {
    throw new Error('runJobCreateRecentDuplicateDevRehearsal cannot run outside DEV.');
  }

  var results = { pass: 0, fail: 0, failures: [] };
  function check(label, actualPass, detail) {
    if (actualPass) { results.pass++; console.log('  PASS — ' + label); }
    else { results.fail++; results.failures.push(label + ' — ' + detail); console.log('  FAIL — ' + label + ' — ' + detail); }
  }

  console.log('=== JobCreateHandler recent-content-duplicate guard — DEV rehearsal ===');

  var periodId = Identifiers.generateCurrentPeriodId();
  console.log('Resolved current period: ' + periodId);
  jcrddrReset_(periodId);

  var actor = RBAC.resolveActor(JCRDDR_EMAIL_);
  check('actor resolves correctly (PM test actor)', actor && actor.personCode, JSON.stringify(actor));

  var payload = {
    client_code: JCRDDR_CLIENT_, job_type: 'DESIGN', product_code: JCRDDR_PRODUCT_,
    quantity: 1, client_job_ref: JCRDDR_REF_
  };

  function makeQueueItem() {
    return { queue_id: Identifiers.generateId(), payload_json: JSON.stringify(payload) };
  }

  // ── 1. First call — must succeed ──
  var firstJobNumber = null, firstErr = null;
  try {
    firstJobNumber = JobCreateHandler.handle(makeQueueItem(), actor);
  } catch (e) { firstErr = e.message; }
  check('First JobCreateHandler.handle() call succeeds (no throw)', firstErr === null, firstErr || '');
  check('First call returns a real job_number', !!(firstJobNumber && String(firstJobNumber).indexOf('BLC-') === 0), String(firstJobNumber));

  // ── 2. Second call, same content, moments later — must be blocked ──
  var secondJobNumber = null, secondErr = null;
  try {
    secondJobNumber = JobCreateHandler.handle(makeQueueItem(), actor);
  } catch (e) { secondErr = e.message; }
  check('Second call (same client/product/description/submitter, moments later) throws', secondErr !== null, String(secondJobNumber));
  check('Thrown message names the matched job and explains the block', !!(secondErr && secondErr.indexOf(firstJobNumber) !== -1), secondErr || '');

  // ── 3. Verify exactly ONE VW row was created, not two ──
  var vwRows = DAL.readWhere(Config.TABLES.VW_JOB_CURRENT_STATE, { client_job_ref: JCRDDR_REF_ }, { callerModule: JCRDDR_CALLER_ });
  check('Exactly 1 VW_JOB_CURRENT_STATE row exists for this synthetic job — no duplicate was created', vwRows.length === 1, JSON.stringify(vwRows));

  console.log('');
  console.log('=== RESULT: ' + results.pass + ' passed, ' + results.fail + ' failed ===');
  if (results.fail > 0) {
    console.log('FAILURES:');
    results.failures.forEach(function (f) { console.log('  - ' + f); });
  }

  return results;
}
