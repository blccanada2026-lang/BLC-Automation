// ============================================================
// Q2RatingsPreflightCheck.gs — BLC Nexus T12 Migration/Diagnostic
//
// READ-ONLY. Answers two questions before any Q2 2026 bonus run is
// planned:
//
//   1. Ratings completeness: for every active DESIGNER/QC/QC_REVIEWER
//      in DIM_STAFF_ROSTER, does a FACT_PERFORMANCE_RATINGS row exist
//      for period_id='2026-Q2', and from which rater_role(s)
//      (TEAM_LEAD/PM)? QuarterlyBonusEngine.getInternalRatings_ needs
//      at least one of TEAM_LEAD/PM present for a DESIGNER/QC row to
//      resolve as CALCULATED rather than PENDING (see
//      computeBonuses_'s ratingScore === null branch).
//   2. getMyRatees() resolution correctness: Task 2's ratingAsOfDate_()
//      resolves min(quarter_end, today) = 2026-06-30 for '2026-Q2' —
//      BEFORE the 2026-07-01 SYR/SVN supervisor_code changes (step 6).
//      Calls PortalData.getMyRateesAs() as each real TEAM_LEAD/PM for
//      '2026-Q2' to confirm ratings requests for that quarter still
//      resolve against the OLD (pre-July) reporting structure — BCH
//      should still see SYR as a ratee for Q2, SDA should still see
//      SVN, not the new SDA/SGO assignments that only take effect
//      2026-07-01 onward.
//
// READ-ONLY BY CONSTRUCTION: only DAL.readAll()/readWhere() and
// PortalData.getMyRateesAs() (itself read-only — resolves an email and
// calls getMyRatees(), no writes) are called. No DAL.appendRow/
// appendRows/updateWhere/ensurePartition anywhere in this file. Not
// Config.isDev()-gated — deliberately, since it must run against PROD
// to answer these questions truthfully.
//
// HOW TO RUN (Apps Script editor, whichever project is active):
//   runQ2RatingsPreflightCheck()
// ============================================================

var Q2RPC_ACTOR_EMAIL_ = 'raj.nair@bluelotuscanada.ca';
var Q2RPC_QPID_        = '2026-Q2';
// The TLs/PM directly affected by the 2026-07-01 step 6 change, plus
// the other two TLs for a complete picture of the current TL/PM set.
var Q2RPC_RATER_CODES_ = ['BCH', 'SDA', 'SVN', 'SGO'];

function runQ2RatingsPreflightCheck() {
  var actualScriptId = ScriptApp.getScriptId();
  console.log('=== Q2 2026 ratings preflight check (read-only) ===');
  console.log('Script ID: ' + actualScriptId + ' — confirm which project this is ' +
              '(DEV: 1smkj0mmUqcWDDJPq... / PROD: 1HzRiDrQJ6z-BxPzk...) before trusting this output.');

  var actor = RBAC.resolveActor(Q2RPC_ACTOR_EMAIL_);
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);

  // ── 1. Ratings completeness for every active DESIGNER/QC/QC_REVIEWER ──
  console.log('');
  console.log('--- 1. FACT_PERFORMANCE_RATINGS completeness for ' + Q2RPC_QPID_ + ' ---');

  var allStaff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'Q2RatingsPreflightCheck' });
  var ratees = allStaff.filter(function (r) {
    var active = r.active === true || String(r.active || '').toUpperCase() === 'TRUE';
    var role   = String(r.role || '').toUpperCase().trim();
    return active && (role === 'DESIGNER' || role === 'QC' || role === 'QC_REVIEWER');
  });

  var ratingRows;
  try {
    ratingRows = DAL.readAll(Config.TABLES.FACT_PERFORMANCE_RATINGS, { callerModule: 'Q2RatingsPreflightCheck' });
  } catch (e) {
    ratingRows = [];
    console.log('  ERROR / table not found: ' + e.message);
  }
  var q2Ratings = ratingRows.filter(function (r) { return String(r.period_id || '').trim() === Q2RPC_QPID_; });
  console.log('Total FACT_PERFORMANCE_RATINGS rows: ' + ratingRows.length +
              ' | rows for ' + Q2RPC_QPID_ + ': ' + q2Ratings.length);

  var byRatee = {};
  q2Ratings.forEach(function (r) {
    var code = String(r.ratee_code || '').trim();
    if (!code) return;
    if (!byRatee[code]) byRatee[code] = [];
    byRatee[code].push(String(r.rater_role || '').toUpperCase().trim() + ' (from ' + r.rater_code + ')');
  });

  console.log('');
  console.log('Per active designer/QC (' + ratees.length + ' total):');
  var missingCount = 0;
  ratees.forEach(function (r) {
    var code  = String(r.person_code || '').trim();
    var found = byRatee[code];
    if (!found || found.length === 0) {
      missingCount++;
      console.log('  ' + code + ' (' + r.name + '): NO Q2 ratings found — would resolve PENDING, not CALCULATED');
    } else {
      console.log('  ' + code + ' (' + r.name + '): ' + found.join(', '));
    }
  });
  console.log('');
  console.log('Summary: ' + (ratees.length - missingCount) + '/' + ratees.length +
              ' active designers/QC have at least one Q2 rating row; ' + missingCount + ' have none.');

  // ── 2. getMyRateesAs() resolution — confirm Q2 still uses the OLD (pre-July) structure ──
  console.log('');
  console.log('--- 2. PortalData.getMyRateesAs() for ' + Q2RPC_QPID_ + ' — should reflect PRE-2026-07-01 structure ---');
  Q2RPC_RATER_CODES_.forEach(function (code) {
    try {
      var result = PortalData.getMyRateesAs(Q2RPC_ACTOR_EMAIL_, code, Q2RPC_QPID_);
      var parsed = JSON.parse(result);
      var codes  = parsed.map(function (p) { return p.person_code; });
      console.log('  ' + code + ' would rate for ' + Q2RPC_QPID_ + ': [' + codes.join(', ') + ']');
    } catch (e) {
      console.log('  ' + code + ': ERROR — ' + e.message);
    }
  });
  console.log('');
  console.log('Expected under the OLD (pre-2026-07-01) structure: BCH -> RKU, MARV, SYR ' +
              '(SYR still under BCH for Q2); SDA -> PBG, SVN (SVN still under SDA for Q2); ' +
              'SVN -> JYS, BIT, ABB; SGO -> (whichever TLs report to SGO as of Q2 -- likely none ' +
              'directly, since BCH/SDA/SVN\'s own supervisor_code as of Q2 predates this session\'s ' +
              'investigation and was not independently reconfirmed here).');

  console.log('');
  console.log('=== End of Q2 ratings preflight check. Read-only — no writes. ===');
}
