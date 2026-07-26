// ============================================================
// Task2Step6Apply.gs — BLC Nexus T12 Migration/Diagnostic
//
// Applies Task 2 step 6's two confirmed real supervisor_code changes,
// both effective 2026-07-01:
//   SYR (Sayan Roy):  BCH -> SDA
//   SVN (Savvy Nath): SDA -> SGO
// Business rule, authoritative (PROJECT_MEMORY.md §3.3): both are
// reporting-line changes only. SDA stays on SGO (Bharath QCs Sandy,
// does not supervise her); SVN was confirmed by the business owner to
// report to SGO directly (Savvy is a TL in his own right, Sandy only
// performs his QC — same pattern as Bharath/Sandy).
//
// Uses the real StaffOnboarding.changeSupervisor() write path — the
// same SCD-2 mechanism (scd2FieldChange_) rehearsed successfully
// against real DAL behavior in DEV on 2026-07-26 (see
// CTO_TASK_QUEUE.md / TEST_EVIDENCE.md), including the cycle-detection
// guard, the duplicate-open-row guard, and the effective_to=''-based
// close-row fix.
//
// SAFETY: hard-asserts the running script is PROD before anything
// else — this must NEVER run against DEV or any other project. Before
// any write, re-reads and verifies SYR's and SVN's CURRENT roster
// state matches the exact expected pre-state confirmed by
// runTask2Step6PreflightCheck() (2026-07-26, 11:24) — aborts with no
// writes at all if either does not match, rather than proceeding
// against an unverified/possibly-drifted state. Writes nothing else
// and touches no other person_code.
//
// NOT Config.isDev()-gated — this is a deliberate one-shot PROD write,
// not a test/dev script. NOT executed by Claude — deploy only, per
// explicit instruction. A human runs this from the PROD Apps Script
// editor.
//
// HOW TO RUN (Apps Script editor, PROD project only):
//   runTask2Step6Apply()
// ============================================================

var T2S6A_PROD_SCRIPT_ID_ = '1HzRiDrQJ6z-BxPzk-MHgm4pUb5enabsEA9Hg16OoRzpOhGjv9FyeiQQ0';
var T2S6A_ACTOR_EMAIL_    = 'raj.nair@bluelotuscanada.ca';
var T2S6A_EFFECTIVE_DATE_ = '2026-07-01';
var T2S6A_CHANGES_ = [
  { personCode: 'SYR', expectedCurrentSupervisor: 'BCH', newSupervisorCode: 'SDA' },
  { personCode: 'SVN', expectedCurrentSupervisor: 'SDA', newSupervisorCode: 'SGO' }
];

function runTask2Step6Apply() {
  var actualScriptId = ScriptApp.getScriptId();
  console.log('=== Task 2 step 6 APPLY — script ID: ' + actualScriptId + ' ===');
  if (actualScriptId !== T2S6A_PROD_SCRIPT_ID_) {
    throw new Error('runTask2Step6Apply: refusing to run — this script ID (' + actualScriptId +
                     ') does not match PROD (' + T2S6A_PROD_SCRIPT_ID_ + '). ' +
                     'This script must only ever run against PROD.');
  }
  console.log('Confirmed: running against PROD.');

  function readRows_(personCode) {
    return DAL.readWhere(
      Config.TABLES.DIM_STAFF_ROSTER,
      { person_code: personCode },
      { callerModule: 'Task2Step6Apply' }
    );
  }

  function logRows_(personCode, label, rows) {
    console.log('--- ' + personCode + ' ' + label + ' (' + rows.length + ' row(s)) ---');
    rows.forEach(function (r) {
      console.log('  supervisor_code=' + r.supervisor_code +
                  ' | effective_from=' + r.effective_from +
                  ' | effective_to=' + r.effective_to +
                  ' | active=' + r.active);
    });
  }

  // ── Pre-write verification: abort entirely, no writes, if either
  //    person's CURRENT state doesn't match the confirmed pre-state
  //    (runTask2Step6PreflightCheck, 2026-07-26 11:24 PROD run). ──
  console.log('');
  console.log('--- Pre-write verification ---');
  var beforeRows = {};
  T2S6A_CHANGES_.forEach(function (change) {
    var rows = readRows_(change.personCode);
    beforeRows[change.personCode] = rows;
    logRows_(change.personCode, 'BEFORE', rows);

    var openRows = rows.filter(function (r) { return !String(r.effective_to || '').trim(); });
    if (openRows.length !== 1) {
      throw new Error('runTask2Step6Apply: ABORTING before any write — expected exactly 1 open-ended row ' +
                       'for "' + change.personCode + '" but found ' + openRows.length + '. ' +
                       'Roster state does not match the verified pre-state; investigate before retrying.');
    }
    var currentSupervisor = String(openRows[0].supervisor_code || '').trim().toUpperCase();
    if (currentSupervisor !== change.expectedCurrentSupervisor) {
      throw new Error('runTask2Step6Apply: ABORTING before any write — expected "' + change.personCode +
                       '" to currently report to "' + change.expectedCurrentSupervisor + '" but found "' +
                       currentSupervisor + '". Roster state has drifted since the last preflight check; ' +
                       'investigate before retrying.');
    }
  });
  console.log('Pre-write verification passed for both SYR and SVN.');

  // ── Apply — real StaffOnboarding.changeSupervisor() write path ──
  console.log('');
  console.log('--- Applying changes ---');
  var results = {};
  T2S6A_CHANGES_.forEach(function (change) {
    console.log('');
    console.log('### ' + change.personCode + ': ' + change.expectedCurrentSupervisor + ' -> ' +
                change.newSupervisorCode + ', effective ' + T2S6A_EFFECTIVE_DATE_ + ' ###');
    var result = StaffOnboarding.changeSupervisor(
      T2S6A_ACTOR_EMAIL_, change.personCode, change.newSupervisorCode, T2S6A_EFFECTIVE_DATE_
    );
    results[change.personCode] = result;
    console.log('changeSupervisor() result: ' + JSON.stringify(result));
  });

  // ── Post-write verification record ──
  console.log('');
  console.log('--- AFTER ---');
  T2S6A_CHANGES_.forEach(function (change) {
    logRows_(change.personCode, 'AFTER', readRows_(change.personCode));
  });

  console.log('');
  console.log('Expected for each: old row effective_to=2026-06-30 [closed]; ' +
              'new row effective_from=2026-07-01, effective_to=\'\' [open]. ' +
              'Exactly one open row per person after the change.');
  console.log('=== Task 2 step 6 APPLY complete. Results: ' + JSON.stringify(results) + ' ===');
  return results;
}
