// ============================================================
// SupervisorBonusByAccountDryRun.gs — BLC Nexus T12 Migration/Promotion
// src/12-migration/SupervisorBonusByAccountDryRun.gs
//
// PRE-CUTOVER DRY-RUN for the product-scoped supervisor bonus calc
// (PayrollEngine.buildSupervisorBonusMapByAccount_, 2026-09-10 design
// spec Phase 1.5). Prints blockedPairs against REAL FACT_WORK_LOGS data
// for a period, before REF_ACCOUNT_SUPERVISION's real-data backfill and
// the (separate, not-yet-written) runBonusRun/previewPayoutStatement
// cutover — see
// docs/superpowers/plans/2026-09-10-product-scoped-supervision-phase1.5.md
// Task 8 Step 6. This is exactly the "review blockedPairs against real
// data" step that plan deliberately left as a manual/data operation, not
// an implementation task — this script exists only to make that review
// possible without writing anything.
//
// READ-ONLY BY CONSTRUCTION: calls only
//   PayrollEngine.buildJobToClientProductMap_() — DAL.readAll(VW_JOB_CURRENT_STATE)
//   DAL.readAll(FACT_WORK_LOGS) directly (one month partition)
//   aggregateNetWorkLogHoursByAccount() — pure in-memory reduction
//   PayrollEngine.buildStaffCache_() — DAL.readAll(DIM_STAFF_ROSTER)
//   PayrollEngine.buildSupervisorBonusMapByAccount_() — DAL.readAll(REF_ACCOUNT_SUPERVISION)
//   PayrollEngine.filterUnexpectedBlockedPairs_() — pure in-memory filter
// Confirmed by reading each function in full before writing this file.
// Nothing in this file or anything it calls contains DAL.appendRow /
// appendRows / updateWhere / ensurePartition.
//
// DELIBERATELY NOT Config.isDev()-gated, same reasoning as
// AggregationFixDryRun.gs — its entire purpose is to run against PROD
// once the real backfill is in place. Prints the active script ID on
// every run so whoever runs it can visually confirm DEV vs PROD before
// trusting the output (this exact mix-up happened twice this session
// with runPatchAccountSupervisionSchema()/runBlankProductAudit()).
//
// HOW TO RUN (Apps Script editor, whichever project is active):
//   runSupervisorBonusByAccountDryRun('2026-08')
//
// Requires PAYROLL_VIEW (read-only RBAC action). Writes nothing to any
// FACT/DIM/REF table.
// ============================================================

var SBAD_ACTOR_EMAIL_ = 'raj.nair@bluelotuscanada.ca';

/**
 * @param {string} periodId   e.g. '2026-08' — matches FACT_WORK_LOGS'
 *                             monthly partitioning (see
 *                             PayrollEngine.aggregateHours_), NOT the
 *                             half-month 'A'/'B' periods some other
 *                             migration scripts (BlankProductAudit.gs)
 *                             use for their own date-range filtering.
 * @param {string} [asOfDate] 'YYYY-MM-DD'. Defaults to periodId + '-01'.
 * @returns {{ bonusMap: Object, blockedPairs: Array, unexpectedBlockedPairs: Array, skippedNonTeamLead: Array }}
 */
function runSupervisorBonusByAccountDryRun(periodId, asOfDate) {
  var actualScriptId = ScriptApp.getScriptId();
  console.log('=== Supervisor bonus (by account+product) dry-run (read-only) ===');
  console.log('Script ID: ' + actualScriptId + ' — confirm this matches the project you intend to check ' +
              '(DEV: 1smkj0mmUqcWDDJPq... / PROD: 1HzRiDrQJ6z-BxPzk...) before trusting this output.');

  if (!periodId) {
    throw new Error('runSupervisorBonusByAccountDryRun: periodId is required, e.g. "2026-08"');
  }
  asOfDate = asOfDate || (periodId + '-01');

  var actor = RBAC.resolveActor(SBAD_ACTOR_EMAIL_);
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);

  console.log('Period: ' + periodId + ' | asOfDate: ' + asOfDate);

  var rows;
  try {
    rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: 'SupervisorBonusByAccountDryRun', periodId: periodId });
  } catch (e) {
    if (e.code === 'SHEET_NOT_FOUND') rows = [];
    else throw e;
  }
  console.log('FACT_WORK_LOGS rows read: ' + rows.length);

  var jobToClientProductMap = PayrollEngine.buildJobToClientProductMap_();
  var hoursMapByAccount     = aggregateNetWorkLogHoursByAccount(rows, jobToClientProductMap);
  var staffCache            = PayrollEngine.buildStaffCache_(asOfDate);

  var result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, asOfDate);
  var unexpectedBlockedPairs = PayrollEngine.filterUnexpectedBlockedPairs_(result.blockedPairs);

  console.log('');
  console.log('--- bonusMap (' + Object.keys(result.bonusMap).length + ' recipients) ---');
  Object.keys(result.bonusMap).sort().forEach(function (code) {
    console.log('  ' + code + ': INR ' + result.bonusMap[code]);
  });

  console.log('');
  console.log('--- blockedPairs (' + result.blockedPairs.length + ' total) ---');
  result.blockedPairs.forEach(function (p) {
    console.log('  ' + p.client_code + ' / ' + (p.product_code || '(blank product_code)') + ' / ' + p.designer_code + ' — ' + p.hours + 'h');
  });

  console.log('');
  console.log('--- unexpectedBlockedPairs (' + unexpectedBlockedPairs.length + ' — NOT covered by ACCEPTED_UNSUPERVISED_PAIRS_) ---');
  unexpectedBlockedPairs.forEach(function (p) {
    console.log('  ' + p.client_code + ' / ' + (p.product_code || '(blank product_code)') + ' / ' + p.designer_code + ' — ' + p.hours + 'h');
  });

  console.log('');
  console.log('--- skippedNonTeamLead (' + result.skippedNonTeamLead.length + ' — informational only, NOT gating) ---');
  result.skippedNonTeamLead.forEach(function (p) {
    console.log('  ' + p.client_code + ' / ' + (p.product_code || '(blank product_code)') + ' / ' + p.designer_code +
                ' — ' + p.hours + 'h — supervisor ' + p.supervisor_code + ' is ' + p.role + ', not TEAM_LEAD');
  });

  console.log('');
  console.log('=== PRE-CUTOVER GATE: ' +
              (unexpectedBlockedPairs.length === 0
                ? 'CLEAN — 0 unexpected blocked pairs'
                : 'NOT CLEAN — ' + unexpectedBlockedPairs.length + ' unexpected blocked pair(s), see above') +
              ' ===');
  console.log('=== End of dry-run. No writes were made. ===');

  return {
    bonusMap: result.bonusMap,
    blockedPairs: result.blockedPairs,
    unexpectedBlockedPairs: unexpectedBlockedPairs,
    skippedNonTeamLead: result.skippedNonTeamLead
  };
}
