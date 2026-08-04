// ============================================================
// DalPartitionSelfHealDevRehearsal.gs — BLC Nexus T12 (DEV-only)
//
// DEV rehearsal for the ensurePartition() non-atomic header-gap fix in
// DAL.gs (root cause of the Aug 2026 partition incident —
// CTO_TASK_QUEUE.md). Exercises the REAL DAL.appendRow()/
// DAL.ensurePartition() directly against real Sheets, not a Jest mock —
// this session's own lesson repeatedly: a mock cannot reproduce the
// real insertSheet()-then-setValues() split that caused the original
// incident, so passing Jest is necessary but not sufficient for a
// change this foundational (DAL.gs is T1 — every FACT write in the
// system goes through it).
//
// Covers both mechanisms:
//   A. A blank-header tab self-heals on the next appendRow() AND on
//      the next ensurePartition() call — not just at creation time.
//   B. A brand-new partition is born from canonical SCHEMAS, never
//      copied from a stale sibling tab.
//
// Synthetic period 2020-06/07/08 — distinct from every other DEV
// rehearsal this session (2020-01 through 2020-05).
//
// KNOWN HARNESS LIMITATION, confirmed 2026-08-04 — the scenario 2/3
// live checks (ensurePartition()'s early-return self-heal; a new
// partition preferring canonical SCHEMAS over a stale sibling) can
// throw "A sheet with the name ... already exists" rather than
// reaching their assertions. Root cause: this rehearsal creates test
// tabs via SpreadsheetApp.getActiveSpreadsheet(), while DAL.gs
// internally caches its OWN handle via SpreadsheetApp.openById() the
// first time it's used in the execution — two different Sheets API
// sessions for the same file, which can disagree about whether a
// just-created tab exists yet. This is a test-harness artifact only:
// production never mixes handles (RULE A2 — every real write goes
// through DAL's single internal handle exclusively), and the pattern
// this "failure" would need to reproduce (ensurePartition() then
// appendRow() back-to-back, same handle throughout) is the exact
// pattern WorkLogHandler/QCHandler have run correctly for months.
// Scenario 1 (the load-bearing case — a blank header self-healing via
// the real DAL.appendRow()) already proves the fix live and is not
// affected by this. Scenarios 2/3's own LOGIC (not their Sheets
// timing) is fully covered by tests/dal-partition-header-self-heal.test.js.
// Not chasing this further — see CTO_TASK_QUEUE.md for the full
// reasoning trail.
//
// HOW TO RUN (Apps Script editor, DEV project only):
//   runDalPartitionSelfHealDevRehearsal()
// ============================================================

var DPSHDR_CALLER_       = 'MigrationEngine';
var DPSHDR_APPENDROW_PID_ = '2020-06';
var DPSHDR_STALE_SIBLING_PID_ = '2020-07';
var DPSHDR_NEW_PARTITION_PID_ = '2020-08';

/** Local, self-contained header-status read — deliberately not shared
 * with Aug2026PartitionRecovery.gs's a26prGetHeaderStatus_(), so this
 * general DAL fix's rehearsal has no dependency on unrelated incident
 * tooling. */
function dpshdrGetHeaderStatus_(tableName, periodId) {
  var tabName = Identifiers.generatePartitionTabName(tableName, periodId);
  var sheet   = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  if (!sheet) return { exists: false, blank: null, tabName: tabName, sheet: null };
  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var nonBlank = headers.filter(function (h) { return String(h || '').trim() !== ''; });
  return { exists: true, blank: nonBlank.length === 0, tabName: tabName, sheet: sheet, headers: headers };
}

function dpshdrReset_() {
  console.log('--- Reset: removing any prior rehearsal tabs ---');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabsToDelete = [
    Identifiers.generatePartitionTabName(Config.TABLES.FACT_WORK_LOGS, DPSHDR_APPENDROW_PID_),
    Identifiers.generatePartitionTabName(Config.TABLES.FACT_QC_EVENTS, DPSHDR_APPENDROW_PID_),
    Identifiers.generatePartitionTabName(Config.TABLES.FACT_WORK_LOGS, DPSHDR_STALE_SIBLING_PID_),
    Identifiers.generatePartitionTabName(Config.TABLES.FACT_WORK_LOGS, DPSHDR_NEW_PARTITION_PID_)
  ];
  tabsToDelete.forEach(function (tabName) {
    var sheet = ss.getSheetByName(tabName);
    if (sheet) { ss.deleteSheet(sheet); console.log('  Deleted existing ' + tabName + '.'); }
  });
  console.log('--- Reset complete. ---');
}

function runDalPartitionSelfHealDevRehearsal() {
  if (!Config.isDev()) {
    throw new Error('runDalPartitionSelfHealDevRehearsal cannot run outside DEV.');
  }

  var results = { pass: 0, fail: 0, failures: [] };
  function check(label, actualPass, detail) {
    if (actualPass) { results.pass++; console.log('  PASS — ' + label); }
    else { results.fail++; results.failures.push(label + ' — ' + detail); console.log('  FAIL — ' + label + ' — ' + detail); }
  }

  console.log('=== DAL partition self-heal DEV rehearsal — real ensurePartition()/appendRow() against real Sheets ===');

  dpshdrReset_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── Mechanism A via appendRow() — the path every write actually
  //    goes through, regardless of whether the caller re-calls
  //    ensurePartition() first. ──
  var wlTabName = Identifiers.generatePartitionTabName(Config.TABLES.FACT_WORK_LOGS, DPSHDR_APPENDROW_PID_);
  ss.insertSheet(wlTabName); // deliberately blank — no header written
  console.log('  Created ' + wlTabName + ' with a BLANK header (simulated incident).');

  var beforeStatus = dpshdrGetHeaderStatus_(Config.TABLES.FACT_WORK_LOGS, DPSHDR_APPENDROW_PID_);
  check('FACT_WORK_LOGS|' + DPSHDR_APPENDROW_PID_ + ' confirmed BLANK before any write', beforeStatus.blank === true, JSON.stringify(beforeStatus));

  var appendErr = null;
  try {
    DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
      event_id: 'DPSHDR-E1', job_number: 'BLC-DPSHDR', period_id: DPSHDR_APPENDROW_PID_,
      event_type: 'WORK_LOG_SUBMITTED', actor_code: 'DPSHDR', hours: 3, work_date: '2020-06-15'
    }, { callerModule: DPSHDR_CALLER_, periodId: DPSHDR_APPENDROW_PID_ });
  } catch (e) { appendErr = e.message; }
  check('DAL.appendRow() against a blank-header partition succeeds (no throw) — this is the exact call that used to throw "must be nonempty"', appendErr === null, appendErr || '');

  var afterStatus = dpshdrGetHeaderStatus_(Config.TABLES.FACT_WORK_LOGS, DPSHDR_APPENDROW_PID_);
  check('Header self-healed to canonical SCHEMAS after appendRow()', afterStatus.blank === false, JSON.stringify(afterStatus));

  var wlRows = DAL.readWhere(Config.TABLES.FACT_WORK_LOGS, { event_id: 'DPSHDR-E1' }, { callerModule: DPSHDR_CALLER_, periodId: DPSHDR_APPENDROW_PID_ });
  check('The row itself actually landed (not silently discarded)', wlRows.length === 1 && parseFloat(wlRows[0].hours) === 3, JSON.stringify(wlRows));

  // ── Mechanism A via ensurePartition()'s own early-return path ──
  var qcTabName = Identifiers.generatePartitionTabName(Config.TABLES.FACT_QC_EVENTS, DPSHDR_APPENDROW_PID_);
  ss.insertSheet(qcTabName);
  console.log('  Created ' + qcTabName + ' with a BLANK header (simulated incident).');

  // DAL.gs caches its own Spreadsheet handle (opened via openById()) for
  // the rest of this execution the first time it's used — this
  // rehearsal creates tabs through a SEPARATE getActiveSpreadsheet()
  // handle, so DAL's cached handle can miss a tab created after it was
  // first opened (a harness artifact — production never mixes handles
  // like this, since every real write goes through DAL exclusively,
  // Rule A2). Force DAL to re-open fresh so its next call sees this
  // tab, replicating the same "handle opened after the tab exists"
  // ordering that already worked correctly for FACT_WORK_LOGS above.
  DAL._resetForTesting();

  var ensureResult = DAL.ensurePartition(Config.TABLES.FACT_QC_EVENTS, DPSHDR_APPENDROW_PID_, DPSHDR_CALLER_);
  check('ensurePartition() on an existing blank-header tab reports created:false (tab already existed)', ensureResult.created === false, JSON.stringify(ensureResult));

  var qcStatus = dpshdrGetHeaderStatus_(Config.TABLES.FACT_QC_EVENTS, DPSHDR_APPENDROW_PID_);
  check('ensurePartition() self-healed the blank header on its early-return path', qcStatus.blank === false, JSON.stringify(qcStatus));

  // ── Mechanism B — a NEW partition must be born from canonical
  //    SCHEMAS, not copied from an older, stale sibling. ──
  var staleSiblingTab = Identifiers.generatePartitionTabName(Config.TABLES.FACT_WORK_LOGS, DPSHDR_STALE_SIBLING_PID_);
  var staleSheet = ss.insertSheet(staleSiblingTab);
  var staleHeader = SCHEMAS.FACT_WORK_LOGS.slice(0, -1); // missing the last canonical column — simulates a pre-schema-change tab
  staleSheet.getRange(1, 1, 1, staleHeader.length).setValues([staleHeader]);
  console.log('  Created ' + staleSiblingTab + ' with a STALE header (missing "' + SCHEMAS.FACT_WORK_LOGS[SCHEMAS.FACT_WORK_LOGS.length - 1] + '") to simulate an older partition predating a schema change.');
  DAL._resetForTesting(); // same handle-cache reasoning as above

  var newPartitionResult = DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, DPSHDR_NEW_PARTITION_PID_, DPSHDR_CALLER_);
  check('A brand-new partition reports created:true', newPartitionResult.created === true, JSON.stringify(newPartitionResult));

  // Reverse direction this time — DAL just created this tab via ITS
  // handle; force pending changes to flush before reading it back via
  // the rehearsal's separate getActiveSpreadsheet() handle.
  SpreadsheetApp.flush();
  var newPartitionStatus = dpshdrGetHeaderStatus_(Config.TABLES.FACT_WORK_LOGS, DPSHDR_NEW_PARTITION_PID_);
  var newHeaders = newPartitionStatus.sheet ? newPartitionStatus.sheet.getRange(1, 1, 1, newPartitionStatus.sheet.getLastColumn()).getValues()[0] : [];
  check('New partition got the FULL canonical header, not the stale sibling\'s shorter one', JSON.stringify(newHeaders) === JSON.stringify(SCHEMAS.FACT_WORK_LOGS), JSON.stringify(newHeaders));

  console.log('');
  console.log('=== RESULT: ' + results.pass + ' passed, ' + results.fail + ' failed ===');
  if (results.fail > 0) {
    console.log('FAILURES:');
    results.failures.forEach(function (f) { console.log('  - ' + f); });
  }

  return results;
}
