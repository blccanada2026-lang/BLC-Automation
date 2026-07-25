// ============================================================
// Task2Step6PreflightCheck.gs — BLC Nexus T12 Migration/Diagnostic
// src/12-migration/Task2Step6PreflightCheck.gs
//
// READ-ONLY. Answers two questions before Task 2 step 6 (applying the
// real supervisor_code hierarchy change) touches anything:
//
//   1. Has any payroll or supervisor-bonus computation already been
//      RUN/COMMITTED for a 2026-07 period? Checks FACT_PAYROLL_LEDGER|
//      2026-07 (base payroll, monthly-partitioned) and FACT_QUARTERLY_BONUS
//      (quarterly, single sheet) for any quarter_period_id touching Q3
//      2026 (Jul-Sep). This determines whether backdating supervisor_code
//      to 2026-07-01 is retroactive relative to an already-computed period.
//   2. What does DIM_STAFF_ROSTER currently hold for the real person
//      codes involved in the change (RKU/SDA/BCH/PBG/SVN/SYR/JYS/BIT/ABB),
//      plus a search for Maruthi (onboarded via portal earlier today,
//      person_code not yet known here — searched by email).
//
// Run this against BOTH PROD (source of truth for "has this really
// happened" and "what's the real current state") and DEV (to check
// whether DEV already has these real codes seeded, or needs seeding
// before changeSupervisor() can be exercised realistically there).
//
// READ-ONLY BY CONSTRUCTION: DAL.listSheets() + DAL.readAll()/readWhere()
// only. No DAL.appendRow/appendRows/updateWhere/ensurePartition anywhere
// in this file. Not Config.isDev()-gated — deliberately, since it must
// run against PROD to answer question 1 truthfully.
//
// HOW TO RUN (Apps Script editor, whichever project is active):
//   runTask2Step6PreflightCheck()
// ============================================================

var T2S6_ACTOR_EMAIL_ = 'raj.nair@bluelotuscanada.ca';
var T2S6_TARGET_CODES_ = ['RKU', 'SDA', 'BCH', 'PBG', 'SVN', 'SYR', 'JYS', 'BIT', 'ABB'];
var T2S6_MARUTHI_EMAIL_ = 'vadlamaruthi902@gmail.com';

function runTask2Step6PreflightCheck() {
  var actualScriptId = ScriptApp.getScriptId();
  console.log('=== Task 2 step 6 preflight check (read-only) ===');
  console.log('Script ID: ' + actualScriptId + ' — confirm which project this is ' +
              '(DEV: 1smkj0mmUqcWDDJPq... / PROD: 1HzRiDrQJ6z-BxPzk...) before trusting this output.');

  var actor = RBAC.resolveActor(T2S6_ACTOR_EMAIL_);
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);

  // ── 1a. FACT_PAYROLL_LEDGER|2026-07 — does the partition even exist, and if so what's in it? ──
  console.log('');
  console.log('--- 1a. FACT_PAYROLL_LEDGER|2026-07 (base payroll, monthly) ---');
  var allSheets = DAL.listSheets();
  var plTab = Config.TABLES.FACT_PAYROLL_LEDGER + '|2026-07';
  var plExists = allSheets.indexOf(plTab) !== -1;
  console.log('Partition exists: ' + plExists);
  if (plExists) {
    var plRows = DAL.readAll(Config.TABLES.FACT_PAYROLL_LEDGER, { callerModule: 'Task2Step6PreflightCheck', periodId: '2026-07' });
    console.log('Row count: ' + plRows.length);
    var plStatusCounts = {};
    plRows.forEach(function (r) {
      var key = String(r.event_type || '(blank event_type)') + ' / ' + String(r.status || '(blank status)');
      plStatusCounts[key] = (plStatusCounts[key] || 0) + 1;
    });
    Object.keys(plStatusCounts).sort().forEach(function (k) {
      console.log('  ' + k + ': ' + plStatusCounts[k]);
    });
  }

  // ── 1b. FACT_QUARTERLY_BONUS — anything touching Q3 2026 (Jul-Sep)? ──
  console.log('');
  console.log('--- 1b. FACT_QUARTERLY_BONUS — rows with quarter_period_id touching 2026-Q3 ---');
  var qbRows;
  try {
    qbRows = DAL.readAll(Config.TABLES.FACT_QUARTERLY_BONUS, { callerModule: 'Task2Step6PreflightCheck' });
  } catch (e) {
    qbRows = [];
    console.log('  ERROR / table not found: ' + e.message);
  }
  var q3Rows = qbRows.filter(function (r) { return String(r.quarter_period_id || '').indexOf('2026-Q3') !== -1; });
  console.log('Total FACT_QUARTERLY_BONUS rows: ' + qbRows.length + ' | rows touching 2026-Q3: ' + q3Rows.length);
  q3Rows.forEach(function (r) {
    console.log('  event_type=' + r.event_type + ' | person_code=' + r.person_code +
                ' | status=' + r.status + ' | timestamp=' + r.timestamp);
  });
  console.log('(Context — most recent quarterly activity of any kind, last 5 by row order:)');
  qbRows.slice(-5).forEach(function (r) {
    console.log('  event_type=' + r.event_type + ' | quarter_period_id=' + r.quarter_period_id +
                ' | person_code=' + r.person_code + ' | status=' + r.status);
  });

  // ── 2. DIM_STAFF_ROSTER current state for the 9 target codes ──
  console.log('');
  console.log('--- 2. DIM_STAFF_ROSTER — current state for target codes ---');
  var allStaff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'Task2Step6PreflightCheck' });

  T2S6_TARGET_CODES_.forEach(function (code) {
    var rows = allStaff.filter(function (r) { return String(r.person_code || '').trim().toUpperCase() === code; });
    if (rows.length === 0) {
      console.log('  ' + code + ': NOT FOUND');
      return;
    }
    rows.forEach(function (r) {
      console.log('  ' + code + ' (' + r.name + '): supervisor_code="' + r.supervisor_code +
                  '" | effective_from=' + r.effective_from + ' | effective_to=' + r.effective_to +
                  ' | active=' + r.active);
    });
  });

  console.log('');
  console.log('--- Maruthi — searched by email (' + T2S6_MARUTHI_EMAIL_ + ') ---');
  var maruthiRows = allStaff.filter(function (r) {
    return String(r.email || '').trim().toLowerCase() === T2S6_MARUTHI_EMAIL_;
  });
  if (maruthiRows.length === 0) {
    console.log('  NOT FOUND by email — not yet onboarded here, or onboarded under a different email.');
  }
  maruthiRows.forEach(function (r) {
    console.log('  person_code=' + r.person_code + ' | name=' + r.name +
                ' | supervisor_code="' + r.supervisor_code + '" | role=' + r.role +
                ' | effective_from=' + r.effective_from + ' | effective_to=' + r.effective_to +
                ' | active=' + r.active);
  });

  console.log('');
  console.log('=== End of preflight check. Read-only — DAL.listSheets()/readAll() only, no writes. ===');
}
