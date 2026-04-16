// ============================================================
// TestRunner.gs — BLC Nexus Setup
// src/setup/TestRunner.gs
//
// PURPOSE: Manual end-to-end tests runnable from the Apps
// Script editor. Verifies the full JOB_CREATE pipeline:
//
//   IntakeService → STG_PROCESSING_QUEUE
//                       ↓
//             QueueProcessor → JobCreateHandler
//                                   ↓
//                         FACT_JOB_EVENTS|2026-04
//
// HOW TO RUN:
//   runTestEndToEnd()    — full pipeline test (intake + process)
//   runTestIntakeOnly()  — intake only (writes to queue, no processing)
//   runTestQueueOnly()   — processes whatever is already in the queue
//   runTestCleanup()     — shows row counts across all test tables
//
// WHAT TO CHECK AFTER EACH TEST:
//   STG_RAW_INTAKE        → new row with status QUEUED
//   STG_PROCESSING_QUEUE  → new row, status COMPLETED after processing
//   FACT_JOB_EVENTS|2026-04 → new JOB_CREATED event row
//   _SYS_LOGS             → INFO entries for each step
// ============================================================

// ============================================================
// DIAGNOSTIC — run this to see exactly what went wrong
// ============================================================

/**
 * Traces buildDesignerClientPairs_ logic step-by-step to find why 0 pairs return.
 */
function diagnosePairs() {
  header_('PAIRS DIAGNOSTIC');

  var periodId     = '2026-03';
  var quarterStart = '2026-01-01';
  var quarterEnd   = '2026-03-31';

  var rows = DAL.readAll(Config.TABLES.REF_ACCOUNT_DESIGNER_MAP, { callerModule: 'ClientFeedback' });
  console.log('Total rows from DAL: ' + rows.length);

  var included = 0, skippedRole = 0, skippedFrom = 0, skippedTo = 0, skippedEmpty = 0;

  for (var i = 0; i < rows.length; i++) {
    var r            = rows[i];
    var clientCode   = String(r.client_code   || '').trim().toUpperCase();
    var designerCode = String(r.designer_code || '').trim().toUpperCase();
    var role         = String(r.role          || '').trim().toUpperCase();
    var fromRaw      = r.assigned_from_date;
    var toRaw        = r.assigned_to_date;
    var assignedFrom = String(fromRaw || '').trim();
    var assignedTo   = String(toRaw   || '').trim();

    if (!clientCode || !designerCode) { skippedEmpty++; continue; }
    if (role !== 'DESIGNER')           { skippedRole++;  continue; }
    if (assignedFrom > quarterEnd)     { skippedFrom++;
      console.log('  SKIPPED from>end: ' + clientCode + '|' + designerCode + ' from=' + assignedFrom + ' end=' + quarterEnd);
      continue;
    }
    if (assignedTo !== '' && assignedTo < quarterStart) { skippedTo++;
      console.log('  SKIPPED to<start: ' + clientCode + '|' + designerCode + ' to=' + assignedTo);
      continue;
    }
    included++;
    if (included <= 3) console.log('  INCLUDED: ' + clientCode + '|' + designerCode + ' role=' + role + ' from=' + assignedFrom);
  }

  console.log('Summary: included=' + included + ' skippedRole=' + skippedRole +
              ' skippedFrom=' + skippedFrom + ' skippedTo=' + skippedTo + ' skippedEmpty=' + skippedEmpty);
  line_();
}

/**
 * Diagnoses why testFeedback() returns 0 pairs.
 * Checks REF_ACCOUNT_DESIGNER_MAP via both direct sheet access and DAL.
 */
function diagnoseFeedback() {
  header_('FEEDBACK DIAGNOSTIC');

  // 1. Check spreadsheet ID Config resolves to
  var ssId = Config.getSpreadsheetId();
  console.log('Config spreadsheet ID: ' + ssId);
  console.log('Active spreadsheet ID: ' + SpreadsheetApp.getActiveSpreadsheet().getId());
  console.log('IDs match: ' + (ssId === SpreadsheetApp.getActiveSpreadsheet().getId()));

  // 2. Check tab exists and has rows
  var ss    = SpreadsheetApp.openById(ssId);
  var sheet = ss.getSheetByName('REF_ACCOUNT_DESIGNER_MAP');
  if (!sheet) {
    console.log('❌ REF_ACCOUNT_DESIGNER_MAP tab NOT FOUND in spreadsheet ' + ssId);
  } else {
    console.log('✅ REF_ACCOUNT_DESIGNER_MAP tab found, lastRow=' + sheet.getLastRow());
    if (sheet.getLastRow() > 1) {
      var sample = sheet.getRange(2, 1, Math.min(3, sheet.getLastRow() - 1), 6).getValues();
      console.log('  First rows: ' + JSON.stringify(sample));
    }
  }

  // 3. Try DAL.readAll directly
  try {
    var rows = DAL.readAll(Config.TABLES.REF_ACCOUNT_DESIGNER_MAP, { callerModule: 'ClientFeedback' });
    console.log('DAL.readAll returned ' + rows.length + ' rows');
    if (rows.length > 0) console.log('  First row: ' + JSON.stringify(rows[0]));
  } catch (e) {
    console.log('DAL.readAll threw: [' + e.code + '] ' + e.message);
  }

  line_();
}

/**
 * Reads and logs the last 5 rows of key tables to diagnose failures.
 */
function runDiagnostic() {
  header_('DIAGNOSTIC');
  var ss = SpreadsheetApp.openById(Config.getSpreadsheetId());

  // STG_PROCESSING_QUEUE — show status + error_message
  var qSheet = ss.getSheetByName('STG_PROCESSING_QUEUE');
  if (qSheet && qSheet.getLastRow() > 1) {
    console.log('STG_PROCESSING_QUEUE (last row):');
    var qHeaders = qSheet.getRange(1, 1, 1, qSheet.getLastColumn()).getValues()[0];
    var qData    = qSheet.getRange(qSheet.getLastRow(), 1, 1, qSheet.getLastColumn()).getValues()[0];
    for (var i = 0; i < qHeaders.length; i++) {
      if (qData[i] !== '') console.log('  ' + qHeaders[i] + ': ' + qData[i]);
    }
  }
  line_();

  // _SYS_LOGS — last 10 rows
  var lSheet = ss.getSheetByName('_SYS_LOGS');
  if (lSheet && lSheet.getLastRow() > 1) {
    var lastRow  = lSheet.getLastRow();
    var startRow = Math.max(2, lastRow - 9);
    var lHeaders = lSheet.getRange(1, 1, 1, lSheet.getLastColumn()).getValues()[0];
    var lData    = lSheet.getRange(startRow, 1, lastRow - startRow + 1, lSheet.getLastColumn()).getValues();
    console.log('_SYS_LOGS (last ' + lData.length + ' rows):');
    for (var r = 0; r < lData.length; r++) {
      var row = {};
      for (var c = 0; c < lHeaders.length; c++) row[lHeaders[c]] = lData[r][c];
      console.log('  [' + row.level + '] ' + row.action + ' — ' + row.message +
                  (row.detail_json ? ' | ' + row.detail_json : ''));
    }
  }
  line_();
}

// ── Test actor — must exist in RBAC.MOCK_ACTOR_MAP ────────────
// sarty@blclotus.com = PM role — has JOB_CREATE permission
var TEST_ACTOR_EMAIL = 'sarty@blclotus.com';

// ── Test payloads ─────────────────────────────────────────────
// JOB_CREATE — includes allocated_to so VW initial state = ALLOCATED
// This allows runTestJobStartE2E() to immediately start the job.
var TEST_JOB_PAYLOAD = {
  client_code:  'NORSPAN',
  job_type:     'DESIGN',
  product_code: 'Alpine-iCommand',
  quantity:     3,
  allocated_to: 'designer@blclotus.com',   // pre-allocate to DS1
  notes:        'E2E test — ' + new Date().toISOString()
};

// JOB_START — job_number filled in dynamically by runTestJobStartE2E()
var TEST_JOB_START_ACTOR = 'designer@blclotus.com';  // DS1 — DESIGNER role, JOB_START allowed

// ============================================================
// HELPERS
// ============================================================

/**
 * Marks all PENDING items in STG_PROCESSING_QUEUE as FAILED.
 * Called at the start of each E2E test to remove stale items left by
 * previous aborted runs, so processQueue() only sees fresh submissions.
 * Bypasses DAL WriteGuard intentionally — test helper only.
 */
function clearStalePendingItems_() {
  // Reset DAL's cumulative API call counter so HealthMonitor.isApproachingLimit()
  // does not block processQueue() in subsequent tests after a quota-intensive test.
  DAL._resetApiCallCount();

  var ss    = SpreadsheetApp.openById(Config.getSpreadsheetId());
  var sheet = ss.getSheetByName('STG_PROCESSING_QUEUE');
  if (!sheet || sheet.getLastRow() <= 1) return;

  var headers   = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var statusIdx = headers.indexOf('status');
  var errorIdx  = headers.indexOf('error_message');
  if (statusIdx < 0) return;

  var data    = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  var cleared = 0;

  for (var i = 0; i < data.length; i++) {
    if (data[i][statusIdx] === 'PENDING') {
      sheet.getRange(i + 2, statusIdx + 1).setValue('FAILED');
      if (errorIdx >= 0) {
        sheet.getRange(i + 2, errorIdx + 1).setValue('[test-cleanup] stale item cleared');
      }
      cleared++;
    }
  }
  if (cleared > 0) info_('Cleared ' + cleared + ' stale PENDING item(s) from queue');
}

/**
 * Creates a job and immediately starts it (JOB_CREATE + JOB_START pipeline).
 * Returns the job_number in IN_PROGRESS state, or null on failure.
 * Used by WorkLog, HoldResume, and QC tests to skip repeated setup.
 */
function setupTestJobInProgress_() {
  // Snapshot VW row count before creating — used to confirm a new row was added
  var prevVwCount = getVwRowCount_();

  // Create
  var createResult = IntakeService.processSubmission({
    formType:       'JOB_CREATE',
    submitterEmail: TEST_ACTOR_EMAIL,
    payload:        TEST_JOB_PAYLOAD,
    source:         'MANUAL'
  });
  if (!createResult.ok) { console.log('  [setup] JOB_CREATE intake failed'); return null; }

  // Diagnostic: count PENDING items directly after flush (before processQueue)
  var pendingBefore = countPendingQueueItems_();
  console.log('  [setup] PENDING items after flush, before processQueue: ' + pendingBefore);

  QueueProcessor.processQueue();

  // Flush VW writes before checking row count — processQueue writes to VW but
  // may buffer the write; flush ensures it is visible to subsequent getLastRow().
  SpreadsheetApp.flush();

  var newVwCount = getVwRowCount_();

  if (newVwCount <= prevVwCount) {
    var pendingAfter = countPendingQueueItems_();
    console.log('  [setup] JOB_CREATE not processed — VW count unchanged (' + prevVwCount +
                '), PENDING after processQueue: ' + pendingAfter);
    return null;
  }

  var jobNumber = getLatestJobNumber_();
  if (!jobNumber) { console.log('  [setup] Could not read job_number from VW'); return null; }

  // Start
  var startResult = IntakeService.processSubmission({
    formType:       'JOB_START',
    submitterEmail: TEST_JOB_START_ACTOR,
    payload:        { job_number: jobNumber, notes: 'Setup start' },
    source:         'MANUAL'
  });
  if (!startResult.ok) { console.log('  [setup] JOB_START intake failed'); return null; }

  QueueProcessor.processQueue();

  // Verify actual state — return null if not IN_PROGRESS (prevents tests from running on wrong job)
  var finalView = StateMachine.getJobView(jobNumber);
  if (!finalView || finalView.current_state !== Config.STATES.IN_PROGRESS) {
    console.log('  [setup] Job ' + jobNumber + ' not IN_PROGRESS after JOB_START — state: ' +
                (finalView ? finalView.current_state : 'null'));
    return null;
  }

  return jobNumber;
}

/**
 * Reads the last job_number from VW_JOB_CURRENT_STATE.
 * Used by runTestJobStartE2E() to get the job just created.
 * Returns null if the view is empty or missing.
 */
function getLatestJobNumber_() {
  try {
    var ss    = SpreadsheetApp.openById(Config.getSpreadsheetId());
    var sheet = ss.getSheetByName('VW_JOB_CURRENT_STATE');
    if (!sheet || sheet.getLastRow() <= 1) return null;
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var lastRow = sheet.getRange(sheet.getLastRow(), 1, 1, sheet.getLastColumn()).getValues()[0];
    var idx = headers.indexOf('job_number');
    return idx >= 0 ? lastRow[idx] : null;
  } catch (e) {
    return null;
  }
}

/**
 * Counts PENDING items in STG_PROCESSING_QUEUE directly via SpreadsheetApp.
 * Used for diagnostics in setupTestJobInProgress_() to verify flush visibility.
 */
function countPendingQueueItems_() {
  try {
    var ss     = SpreadsheetApp.openById(Config.getSpreadsheetId());
    var sheet  = ss.getSheetByName('STG_PROCESSING_QUEUE');
    if (!sheet || sheet.getLastRow() <= 1) return 0;
    var headers   = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var statusIdx = headers.indexOf('status');
    if (statusIdx < 0) return -1;
    var data    = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
    var pending = 0;
    for (var i = 0; i < data.length; i++) {
      if (data[i][statusIdx] === 'PENDING') pending++;
    }
    return pending;
  } catch (e) { return -1; }
}

/**
 * Returns the number of data rows in VW_JOB_CURRENT_STATE (header not counted).
 * Used by setupTestJobInProgress_() to confirm a new job row was actually added.
 */
function getVwRowCount_() {
  try {
    var ss    = SpreadsheetApp.openById(Config.getSpreadsheetId());
    var sheet = ss.getSheetByName('VW_JOB_CURRENT_STATE');
    if (!sheet) return 0;
    return Math.max(0, sheet.getLastRow() - 1);
  } catch (e) { return 0; }
}

function line_() {
  console.log('───────────────────────────────────────────');
}

function header_(title) {
  console.log('═══════════════════════════════════════════');
  console.log('  ' + title);
  console.log('═══════════════════════════════════════════');
}

function pass_(msg) { console.log('  ✅  ' + msg); }
function fail_(msg) { console.log('  ❌  ' + msg); }
function info_(msg) { console.log('  ℹ️   ' + msg); }

// ============================================================
// TEST 1: INTAKE ONLY
// Submits a job creation payload via IntakeService.
// Checks STG_RAW_INTAKE and STG_PROCESSING_QUEUE for new rows.
// Does NOT run QueueProcessor.
// ============================================================

/**
 * Runs intake only — writes to queue but does not process.
 * @returns {{ ok: boolean, intakeId: string, queueId: string }}
 */
function runTestIntakeOnly() {
  header_('TEST: Intake Only');

  var result = IntakeService.processSubmission({
    formType:       'JOB_CREATE',
    submitterEmail: TEST_ACTOR_EMAIL,
    payload:        TEST_JOB_PAYLOAD,
    source:         'MANUAL'
  });

  line_();
  if (result.ok) {
    pass_('IntakeService.processSubmission succeeded');
    info_('intake_id : ' + result.intakeId);
    info_('queue_id  : ' + result.queueId);
    info_('form_type : ' + result.formType);
    console.log('');
    console.log('  Check these tabs in the spreadsheet:');
    console.log('  → STG_RAW_INTAKE       (status = QUEUED)');
    console.log('  → STG_PROCESSING_QUEUE (status = PENDING)');
  } else {
    fail_('IntakeService.processSubmission returned ok=false');
    fail_('Check _SYS_LOGS and _SYS_EXCEPTIONS for details');
  }
  line_();

  return result;
}

// ============================================================
// TEST 2: QUEUE ONLY
// Runs QueueProcessor against whatever is currently PENDING.
// Use after runTestIntakeOnly() to process the queued item.
// ============================================================

/**
 * Runs QueueProcessor — processes all PENDING items in the queue.
 */
function runTestQueueOnly() {
  header_('TEST: Queue Processor Only');
  info_('Processing all PENDING items in STG_PROCESSING_QUEUE…');
  line_();

  QueueProcessor.processQueue();

  line_();
  console.log('  Check these tabs in the spreadsheet:');
  console.log('  → STG_PROCESSING_QUEUE  (status = COMPLETED or FAILED)');
  console.log('  → FACT_JOB_EVENTS|2026-04 (new JOB_CREATED row)');
  console.log('  → _SYS_LOGS             (INFO entries for each step)');
  line_();
}

// ============================================================
// TEST 3: END-TO-END
// Runs intake + queue processing in sequence.
// This is the full pipeline test.
// ============================================================

/**
 * Full end-to-end test — intake then immediate queue processing.
 */
function runTestEndToEnd() {
  header_('TEST: End-to-End (Intake + Process)');

  // Step 1: Submit
  info_('Step 1: Submitting via IntakeService…');
  var intakeResult = IntakeService.processSubmission({
    formType:       'JOB_CREATE',
    submitterEmail: TEST_ACTOR_EMAIL,
    payload:        TEST_JOB_PAYLOAD,
    source:         'MANUAL'
  });

  line_();
  if (!intakeResult.ok) {
    fail_('Intake failed — aborting test. Check _SYS_EXCEPTIONS.');
    return;
  }
  pass_('Intake succeeded');
  info_('intake_id : ' + intakeResult.intakeId);
  info_('queue_id  : ' + intakeResult.queueId);
  line_();

  // Step 2: Process
  info_('Step 2: Running QueueProcessor…');
  line_();

  QueueProcessor.processQueue();

  line_();
  pass_('QueueProcessor run complete');
  console.log('');
  console.log('  Expected results in spreadsheet:');
  console.log('  → STG_RAW_INTAKE          status = QUEUED');
  console.log('  → STG_PROCESSING_QUEUE    status = COMPLETED');
  console.log('  → FACT_JOB_EVENTS|2026-04 1 new row, event_type = JOB_CREATED');
  console.log('  → DIM_SEQUENCE_COUNTERS   JOB_NUMBER incremented by 1');
  console.log('  → _SYS_LOGS               INFO trail for each step');
  line_();
  console.log('  Run runTestCleanup() to see row counts.');
  console.log('═══════════════════════════════════════════');
}

// ============================================================
// TEST 4: CLEANUP / ROW COUNTS
// Logs the current row count of each test-relevant table.
// Helps verify data landed in the right places.
// ============================================================

// ============================================================
// TEST 5: JOB_START END-TO-END
// Creates a job (pre-allocated) then immediately starts it.
// Verifies:
//   FACT_JOB_EVENTS   → JOB_CREATED + JOB_STARTED events
//   VW_JOB_CURRENT_STATE → current_state = IN_PROGRESS
// ============================================================

/**
 * Full end-to-end test for the JOB_START pipeline.
 * Creates a pre-allocated job then starts it as the designer.
 */
function runTestJobStartE2E() {
  header_('TEST: Job Start End-to-End');

  // ── Phase 1: Create a pre-allocated job ─────────────────
  info_('Phase 1: Creating pre-allocated job via IntakeService…');
  var createResult = IntakeService.processSubmission({
    formType:       'JOB_CREATE',
    submitterEmail: TEST_ACTOR_EMAIL,
    payload:        TEST_JOB_PAYLOAD,
    source:         'MANUAL'
  });

  line_();
  if (!createResult.ok) {
    fail_('JOB_CREATE intake failed — aborting. Check _SYS_EXCEPTIONS.');
    return;
  }
  pass_('JOB_CREATE intake succeeded');
  info_('queue_id : ' + createResult.queueId);
  line_();

  // ── Phase 2: Process JOB_CREATE ─────────────────────────
  info_('Phase 2: Processing JOB_CREATE queue item…');
  QueueProcessor.processQueue();
  line_();

  // ── Phase 3: Read job number from VW ───────────────────
  var jobNumber = getLatestJobNumber_();
  if (!jobNumber) {
    fail_('Could not read job_number from VW_JOB_CURRENT_STATE — did JobCreateHandler run?');
    info_('Run runDiagnostic() to see the last _SYS_LOGS entries.');
    return;
  }
  pass_('Job created: ' + jobNumber);
  info_('Check VW_JOB_CURRENT_STATE → current_state should be ALLOCATED');
  line_();

  // ── Phase 4: Start the job (as the designer) ────────────
  info_('Phase 3: Starting job ' + jobNumber + ' as designer@blclotus.com…');
  var startResult = IntakeService.processSubmission({
    formType:       'JOB_START',
    submitterEmail: TEST_JOB_START_ACTOR,
    payload:        {
      job_number: jobNumber,
      notes:      'E2E test — JOB_START — ' + new Date().toISOString()
    },
    source: 'MANUAL'
  });

  line_();
  if (!startResult.ok) {
    fail_('JOB_START intake failed — aborting. Check _SYS_EXCEPTIONS.');
    return;
  }
  pass_('JOB_START intake succeeded');
  info_('queue_id : ' + startResult.queueId);
  line_();

  // ── Phase 5: Process JOB_START ──────────────────────────
  info_('Phase 4: Processing JOB_START queue item…');
  QueueProcessor.processQueue();

  line_();
  pass_('QueueProcessor run complete');
  console.log('');
  console.log('  Expected results in spreadsheet:');
  console.log('  → FACT_JOB_EVENTS|' + Identifiers.generateCurrentPeriodId() +
              '  2 new rows (JOB_CREATED + JOB_STARTED)');
  console.log('  → VW_JOB_CURRENT_STATE  current_state = IN_PROGRESS');
  console.log('  → STG_PROCESSING_QUEUE  both items COMPLETED');
  console.log('  → _SYS_LOGS             INFO trail for each step');
  line_();
  console.log('  Run runTestCleanup() to see row counts.');
  console.log('═══════════════════════════════════════════');
}

// ============================================================
// TEST 6: DIAGNOSE CURRENT STATE
// Shows VW_JOB_CURRENT_STATE rows (last 5) for quick review.
// ============================================================

/**
 * Logs the last 5 rows of VW_JOB_CURRENT_STATE for inspection.
 */
function runCheckVwState() {
  header_('VW_JOB_CURRENT_STATE');
  var ss    = SpreadsheetApp.openById(Config.getSpreadsheetId());
  var sheet = ss.getSheetByName('VW_JOB_CURRENT_STATE');

  if (!sheet || sheet.getLastRow() <= 1) {
    info_('VW_JOB_CURRENT_STATE is empty or missing.');
    line_();
    return;
  }

  var headers  = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var lastRow  = sheet.getLastRow();
  var startRow = Math.max(2, lastRow - 4);
  var data     = sheet.getRange(startRow, 1, lastRow - startRow + 1, sheet.getLastColumn()).getValues();

  console.log('  Last ' + data.length + ' row(s):');
  for (var r = 0; r < data.length; r++) {
    var row = {};
    for (var c = 0; c < headers.length; c++) row[headers[c]] = data[r][c];
    console.log('  [' + row.job_number + '] ' + row.current_state +
                ' | client=' + row.client_code +
                ' | allocated_to=' + row.allocated_to);
  }
  line_();
}

// ============================================================
// TEST 8: WORK LOG E2E
// Creates + starts a job then submits a work log entry.
// ============================================================

function runTestWorkLogE2E() {
  header_('TEST: Work Log End-to-End');
  clearStalePendingItems_();

  info_('Setting up: creating and starting a job…');
  var jobNumber = setupTestJobInProgress_();
  if (!jobNumber) { fail_('Setup failed — check _SYS_EXCEPTIONS'); return; }
  pass_('Job in IN_PROGRESS: ' + jobNumber);
  line_();

  info_('Submitting work log (3 hours, today)…');
  var today = Utilities.formatDate(new Date(), 'America/Regina', 'yyyy-MM-dd');
  var result = IntakeService.processSubmission({
    formType:       'WORK_LOG',
    submitterEmail: TEST_JOB_START_ACTOR,   // designer@blclotus.com
    payload:        {
      job_number: jobNumber,
      hours:      3,
      work_date:  today,
      notes:      'E2E test — WORK_LOG — ' + new Date().toISOString()
    },
    source: 'MANUAL'
  });

  if (!result.ok) { fail_('WORK_LOG intake failed'); return; }
  pass_('WORK_LOG intake succeeded');
  info_('queue_id : ' + result.queueId);
  line_();

  QueueProcessor.processQueue();

  line_();
  pass_('QueueProcessor run complete');
  console.log('  Expected: FACT_WORK_LOGS|' + Identifiers.generateCurrentPeriodId() + '  → 1 new row (WORK_LOG_SUBMITTED)');
  line_();
}

// ============================================================
// TEST 9: HOLD / RESUME E2E
// Creates + starts a job, places it on hold, then resumes it.
// ============================================================

function runTestHoldResumeE2E() {
  header_('TEST: Hold / Resume End-to-End');
  clearStalePendingItems_();

  info_('Setting up: creating and starting a job…');
  var jobNumber = setupTestJobInProgress_();
  if (!jobNumber) { fail_('Setup failed — check _SYS_EXCEPTIONS'); return; }
  pass_('Job in IN_PROGRESS: ' + jobNumber);
  line_();

  // HOLD
  info_('Placing job on hold…');
  var holdResult = IntakeService.processSubmission({
    formType:       'JOB_HOLD',
    submitterEmail: TEST_ACTOR_EMAIL,   // PM can hold
    payload:        { job_number: jobNumber, notes: 'E2E hold test' },
    source:         'MANUAL'
  });
  if (!holdResult.ok) { fail_('JOB_HOLD intake failed'); return; }
  pass_('JOB_HOLD intake succeeded');
  QueueProcessor.processQueue();
  line_();

  info_('Check VW: current_state should be ON_HOLD, prev_state = IN_PROGRESS');
  line_();

  // RESUME
  info_('Resuming job…');
  var resumeResult = IntakeService.processSubmission({
    formType:       'JOB_RESUME',
    submitterEmail: TEST_ACTOR_EMAIL,
    payload:        { job_number: jobNumber, notes: 'E2E resume test' },
    source:         'MANUAL'
  });
  if (!resumeResult.ok) { fail_('JOB_RESUME intake failed'); return; }
  pass_('JOB_RESUME intake succeeded');
  QueueProcessor.processQueue();

  line_();
  pass_('Hold/Resume cycle complete');
  console.log('  Expected: VW current_state = IN_PROGRESS, prev_state = ""');
  console.log('  Expected: FACT_JOB_EVENTS  → JOB_HELD + JOB_RESUMED rows');
  line_();
}

// ============================================================
// TEST 10: FULL QC LIFECYCLE E2E
// Creates → starts → submits for QC → QC approves.
// ============================================================

function runTestQCE2E() {
  header_('TEST: QC Lifecycle End-to-End');
  clearStalePendingItems_();

  info_('Setting up: creating and starting a job…');
  var jobNumber = setupTestJobInProgress_();
  if (!jobNumber) { fail_('Setup failed — check _SYS_EXCEPTIONS'); return; }
  pass_('Job in IN_PROGRESS: ' + jobNumber);
  line_();

  // Flow A: designer submits for QC
  info_('Flow A: Designer submitting job for QC review…');
  var submitResult = IntakeService.processSubmission({
    formType:       'QC_SUBMIT',
    submitterEmail: TEST_JOB_START_ACTOR,   // designer@blclotus.com
    payload:        { job_number: jobNumber, notes: 'E2E QC submit' },
    source:         'MANUAL'
  });
  if (!submitResult.ok) { fail_('QC_SUBMIT (Flow A) intake failed'); return; }
  pass_('QC_SUBMIT intake succeeded');
  QueueProcessor.processQueue();

  info_('Check VW: current_state should be QC_REVIEW');
  line_();

  // Flow B: QC reviewer approves
  info_('Flow B: QC reviewer approving the job…');
  var approveResult = IntakeService.processSubmission({
    formType:       'QC_SUBMIT',
    submitterEmail: 'qc@blclotus.com',    // QC reviewer
    payload:        {
      job_number: jobNumber,
      qc_result:  'APPROVED',
      notes:      'E2E QC approve — looks good'
    },
    source: 'MANUAL'
  });
  if (!approveResult.ok) { fail_('QC_SUBMIT (Flow B) intake failed'); return; }
  pass_('QC approval intake succeeded');
  QueueProcessor.processQueue();

  line_();
  pass_('Full QC lifecycle complete');
  console.log('  Expected: VW current_state = COMPLETED_BILLABLE');
  console.log('  Expected: FACT_QC_EVENTS|' + Identifiers.generateCurrentPeriodId() +
              '  → QC_SUBMITTED + QC_APPROVED rows');
  line_();
}

// ============================================================
// TEST 11: ROW COUNTS
// ============================================================

/**
 * Logs row counts for all test-relevant tables.
 * Does not modify any data.
 */
// ============================================================
// BILLING TEST
// ============================================================

/**
 * End-to-end billing test.
 * Requires at least one job in COMPLETED_BILLABLE state and at
 * least one active rate in DIM_PRODUCT_RATES.
 *
 * Run after runTestQCE2E() has produced a COMPLETED_BILLABLE job.
 */
function runTestBillingRun() {
  header_('TEST: Billing Run');

  var result = BillingEngine.runBillingRun('ceo@blclotus.com');

  info_('processed:    ' + result.processed);
  info_('skipped:      ' + result.skipped);
  info_('total_amount: ' + result.total_amount + ' ' + result.currency);
  info_('invoice_id:   ' + result.invoice_id);
  info_('period_id:    ' + result.period_id);

  if (result.errors.length > 0) {
    result.errors.forEach(function(e) { fail_('ERROR: ' + e); });
  }

  if (result.processed === 0 && result.skipped === 0) {
    info_('No COMPLETED_BILLABLE jobs found — run runTestQCE2E() first,');
    info_('and ensure DIM_PRODUCT_RATES has an active rate for the product.');
  } else {
    pass_('Billing run complete');
  }

  line_();
}

// ============================================================
// PAYROLL TEST
// ============================================================

/**
 * End-to-end payroll test.
 * Requires work log entries in FACT_WORK_LOGS for the current period
 * and active staff rows in DIM_STAFF_ROSTER with pay_design / pay_qc set.
 *
 * Run after runTestWorkLogE2E() has produced work log hours.
 */
function runTestPayrollRun() {
  header_('TEST: Payroll Run');

  var result = PayrollEngine.runPayrollRun('ceo@blclotus.com');

  info_('processed:  ' + result.processed);
  info_('skipped:    ' + result.skipped);
  info_('period_id:  ' + result.period_id);

  if (result.by_person && result.by_person.length > 0) {
    result.by_person.forEach(function(p) {
      info_('  ' + p.person_code + ' (' + p.name + '): ' +
            p.design_hours + 'h design + ' + p.qc_hours + 'h QC = ' +
            p.total_pay + ' ' + p.currency);
    });
  }

  if (result.errors.length > 0) {
    result.errors.forEach(function(e) { fail_('ERROR: ' + e); });
  }

  if (result.processed === 0 && result.skipped === 0) {
    info_('No work log hours found — run runTestWorkLogE2E() first,');
    info_('and ensure DIM_STAFF_ROSTER has active rows with pay_design set.');
  } else {
    pass_('Payroll run complete');
  }

  line_();
}

function runTestCleanup() {
  header_('TABLE ROW COUNTS');

  var ss      = SpreadsheetApp.openById(Config.getSpreadsheetId());
  var tables  = [
    'STG_RAW_INTAKE',
    'STG_PROCESSING_QUEUE',
    'DEAD_LETTER_QUEUE',
    'FACT_JOB_EVENTS|2026-04',
    'FACT_WORK_LOGS|2026-04',
    'FACT_QC_EVENTS|2026-04',
    'FACT_BILLING_LEDGER|2026-04',
    'FACT_PAYROLL_LEDGER|2026-04',
    'VW_JOB_CURRENT_STATE',
    'MART_BILLING_SUMMARY',
    'MART_PAYROLL_SUMMARY',
    'DIM_SEQUENCE_COUNTERS',
    '_SYS_LOGS',
    '_SYS_EXCEPTIONS'
  ];

  for (var i = 0; i < tables.length; i++) {
    var sheet = ss.getSheetByName(tables[i]);
    if (!sheet) {
      fail_(tables[i] + '  ← tab not found');
      continue;
    }
    var dataRows = Math.max(0, sheet.getLastRow() - 1); // subtract header
    var icon     = dataRows > 0 ? '✅' : '⬜';
    console.log('  ' + icon + '  ' + tables[i] +
                '  →  ' + dataRows + ' row(s)');
  }

  // Show current job number sequence
  try {
    var seqSheet = ss.getSheetByName('DIM_SEQUENCE_COUNTERS');
    if (seqSheet && seqSheet.getLastRow() > 1) {
      var seqVal = seqSheet.getRange(2, 2).getValue();
      info_('Next job will be: BLC-' +
            String(parseInt(seqVal, 10) + 1).padStart(5, '0'));
    }
  } catch (ignored) {}

  line_();
}

// ============================================================
// TEST: SHEET ADAPTER — SBS INTAKE
// Seeds test rows into STG_INTAKE_SBS and runs the adapter.
// Verifies mapping, queue submission, and per-row status writeback.
// ============================================================

/**
 * End-to-end test for SheetAdapter.processSbsIntake().
 *
 * Seeds 3 rows into STG_INTAKE_SBS:
 *   Row 1 — valid Roof job (should queue)
 *   Row 2 — valid Floor job (should queue)
 *   Row 3 — missing Product (required) → should write ERROR status
 *
 * After running, check STG_INTAKE_SBS:
 *   Row 1 _status = QUEUED, _queue_id populated
 *   Row 2 _status = QUEUED, _queue_id populated
 *   Row 3 _status = ERROR: Required column "Product"...
 *
 * Then check STG_PROCESSING_QUEUE for 2 new PENDING items.
 * Run runTestQueueOnly() to process them into FACT_JOB_EVENTS.
 */
function runTestSheetAdapterSBS() {
  header_('TEST: SheetAdapter — SBS Intake');

  var ss    = SpreadsheetApp.openById(Config.getSpreadsheetId());
  var sheet = ss.getSheetByName('STG_INTAKE_SBS');

  if (!sheet) {
    fail_('STG_INTAKE_SBS tab not found — run runSetup() first.');
    line_();
    return;
  }

  // ── Step 1: Clear any existing data rows ──────────────────
  info_('Step 1: Clearing existing data rows in STG_INTAKE_SBS…');
  if (sheet.getLastRow() > 1) {
    sheet.deleteRows(2, sheet.getLastRow() - 1);
    pass_('Cleared ' + (sheet.getLastRow()) + ' existing rows');
  } else {
    info_('Sheet already empty');
  }
  line_();

  // ── Step 2: Seed test rows ────────────────────────────────
  // Column order must match STG_INTAKE_SBS headers exactly:
  // Job #, Customer, Due Date, Notes, Product, Design/Estimator, Job Name, Model,
  // _status, _queue_id, _queued_at, _error
  info_('Step 2: Seeding 3 test rows…');

  // Row 1: valid Roof job
  sheet.appendRow([
    'TEST-2603-001',
    'DRB Test Division',
    '4/30/2026',
    'Submittal',
    'Roof',
    'Sarty Gosh - BL',
    'Test Park Lot 00.0001 Roof',
    'Parker',
    '', '', '', ''   // system columns — blank = PENDING
  ]);
  pass_('Row 1 seeded: TEST-2603-001 | Roof | Submittal');

  // Row 2: valid Floor job
  sheet.appendRow([
    'TEST-2603-002',
    'DRB Test Division',
    '5/15/2026',
    'Submittal',
    'Floor',
    'Sarty Gosh - BL',
    'Test Park Lot 00.0001 Floor',
    'Parker',
    '', '', '', ''
  ]);
  pass_('Row 2 seeded: TEST-2603-002 | Floor | Submittal');

  // Row 3: missing Product (required field) — expect ERROR
  sheet.appendRow([
    'TEST-2603-003',
    'DRB Test Division',
    '5/15/2026',
    'Submittal',
    '',              // Product blank — required field
    'Sarty Gosh - BL',
    'Test Park Lot 00.0001 — Missing Product',
    'Beramont',
    '', '', '', ''
  ]);
  pass_('Row 3 seeded: TEST-2603-003 | Product blank (expect ERROR)');
  line_();

  // ── Step 3: Run the adapter ───────────────────────────────
  info_('Step 3: Running SheetAdapter.processSbsIntake…');
  line_();

  var result;
  try {
    result = SheetAdapter.processSbsIntake(TEST_ACTOR_EMAIL);
  } catch (e) {
    fail_('SheetAdapter threw: ' + e.message);
    info_('Run runDiagnostic() to see _SYS_LOGS.');
    line_();
    return;
  }

  // ── Step 4: Report results ────────────────────────────────
  line_();
  info_('processed : ' + result.processed);
  info_('queued    : ' + result.queued);
  info_('errors    : ' + result.errors.length);

  if (result.queued === 2) {
    pass_('2 jobs queued as expected');
  } else {
    fail_('Expected 2 queued, got ' + result.queued);
  }

  if (result.errors.length === 1) {
    pass_('1 mapping error as expected (missing Product on row 3)');
    info_('  error key: ' + result.errors[0].key);
    info_('  reason:    ' + result.errors[0].errors.join('; '));
  } else {
    fail_('Expected 1 error, got ' + result.errors.length);
  }

  line_();
  console.log('  Check STG_INTAKE_SBS:');
  console.log('    Row 1  _status = QUEUED,  _queue_id populated');
  console.log('    Row 2  _status = QUEUED,  _queue_id populated');
  console.log('    Row 3  _status = ERROR: Required column "Product"…');
  console.log('');
  console.log('  Check STG_PROCESSING_QUEUE:');
  console.log('    2 new PENDING items (client_code=SBS, form_type=JOB_CREATE)');
  console.log('');
  console.log('  Run runTestQueueOnly() to process them into FACT_JOB_EVENTS.');
  line_();
}

// ============================================================
// CLIENT FEEDBACK TEST
// Sends all feedback emails to BLC Gmail for review before
// real clients receive them. Pairs are auto-derived from
// FACT_JOB_EVENTS (allocated_to + client_code) across all
// three months of the quarter — no hardcoding needed.
// ============================================================

/**
 * Clears cached form IDs for a given period so testFeedback() recreates them
 * with the new design (no Period ID / Client Code fields).
 * Run this once before re-running testFeedback().
 */
function clearFeedbackFormCache() {
  var periodId = '2026-03';
  var props    = PropertiesService.getScriptProperties();
  var all      = props.getProperties();
  var cleared  = 0;
  for (var key in all) {
    if (key.indexOf('FEEDBACK_FORM_' + periodId) === 0 ||
        key.indexOf('FEEDBACK_ENTRY_IDS_' + periodId) === 0) {
      props.deleteProperty(key);
      console.log('  🗑️  Cleared: ' + key);
      cleared++;
    }
  }
  console.log('Cleared ' + cleared + ' cached form entries for ' + periodId + '. Run testFeedback() to recreate.');
}

function testFeedback() {
  // Sends one feedback email per active client to BLC Gmail (not real clients).
  // Designer-client pairs are derived from REF_ACCOUNT_DESIGNER_MAP for Q1 2026.
  // Period 2026-03 = last completed quarter (Jan/Feb/Mar).
  // All emails go to BLC Gmail instead of real client addresses.
  var actorEmail = Session.getActiveUser().getEmail();
  var result = ClientFeedback.sendFeedbackRequests(
    actorEmail,
    {
      periodId:  '2026-03',
      testEmail: 'blccanada2026@gmail.com'
    }
  );
  console.log(JSON.stringify(result, null, 2));
}

/**
 * TEST: sends all rating request emails to blccanada2026@gmail.com
 * instead of real TL/PM addresses. Safe to run before go-live.
 */
function testRatingRequests() {
  var actorEmail = Session.getActiveUser().getEmail();
  var result = PortalData.sendRatingRequests(actorEmail, '2026-03', 'blccanada2026@gmail.com');
  console.log(JSON.stringify(result, null, 2));
}

/**
 * DRY RUN: shows exactly who would receive rating emails and what ratees
 * each person would be rating — without sending any emails.
 * Run this to verify logic before quota is available.
 */
function dryRunRatingRequests() {
  var actorEmail = Session.getActiveUser().getEmail();
  var result = PortalData.sendRatingRequests(actorEmail, '2026-03', 'blccanada2026@gmail.com', true);
  console.log(JSON.stringify(result, null, 2));
}

/**
 * DRY RUN: shows exactly who would receive feedback emails and to which clients
 * — without sending any emails.
 */
function dryRunFeedbackRequests() {
  var actorEmail = Session.getActiveUser().getEmail();
  var result = ClientFeedback.sendFeedbackRequests(actorEmail, {
    periodId:  '2026-03',
    testEmail: 'blccanada2026@gmail.com',
    dryRun:    true
  });
  console.log(JSON.stringify(result, null, 2));
}

/**
 * DIAGNOSTIC: dumps raw active/effective_to/pm_code values from DIM_STAFF_ROSTER
 * so we can see exactly what DAL reads back from the sheet.
 */
function diagnoseStaffRoster() {
  var allStaff = DAL.readAll('DIM_STAFF_ROSTER', { callerModule: 'TestRunner' });
  var today    = new Date().toISOString().substring(0, 10);
  console.log('Total rows: ' + allStaff.length);
  allStaff.forEach(function(s) {
    var et = s.effective_to;
    var etType = typeof et + (et instanceof Date ? '(Date)' : '');
    var etStr  = et instanceof Date ? (et.getFullYear() + '-' + String(et.getMonth()+1).padStart(2,'0') + '-' + String(et.getDate()).padStart(2,'0')) : String(et);
    console.log([
      s.person_code,
      'role=' + s.role,
      'active=' + s.active + '(' + typeof s.active + ')',
      'pm_code=' + s.pm_code,
      'supervisor=' + s.supervisor_code,
      'effective_to=' + etStr + '[' + etType + ']'
    ].join(' | '));
  });
}

/**
 * ONE-TIME SETUP: stores the portal /exec URL in Script Properties.
 * Run once from the Apps Script editor after deploying.
 */
function setupPortalUrl() {
  var result = setPortalBaseUrl(
    'https://script.google.com/macros/s/AKfycbwBcUO-JhVfdHsbTVp-Vi6oXiLsaVMWxQISbHEheJ5QzvnJL8VhQ-MaXZWSc936TC26/exec'
  );
  console.log(result);
}

// ============================================================
// AUTOMATED TEST SUITE — runAllTests()
//
// These tests follow the assert/result pattern below.
// Every test function:
//   - Is independent and idempotent
//   - Uses TEST- prefixed IDs for all created records
//   - Does not delete FACT rows (append-only rule)
//   - Returns { passed: N, failed: N }
//
// Run from Apps Script editor: runAllTests()
//
// Actors used (from RBAC.MOCK_ACTOR_MAP):
//   CEO/PM:     sarty@blclotus.com       (PM role — JOB_CREATE allowed)
//   Designer:   designer@blclotus.com    (DS1)
//   QC:         qc@blclotus.com          (QC1)
//   CEO only:   ceo@blclotus.com         (for payroll/bonus)
//   Unknown:    unknown@notinrbac.com    (should fail RBAC)
// ============================================================

// ── Shared test constants ───────────────────────────────────
var SUITE_PERIOD_ID  = '2026-04';
var SUITE_CEO_EMAIL  = 'ceo@blclotus.com';
var SUITE_PM_EMAIL   = 'sarty@blclotus.com';
var SUITE_DESIGNER   = 'designer@blclotus.com';
var SUITE_QC_EMAIL   = 'qc@blclotus.com';
var SUITE_UNKNOWN    = 'unknown@notinrbac.com';

var SUITE_JOB_PAYLOAD = {
  client_code:  'NORSPAN',
  job_type:     'DESIGN',
  product_code: 'Alpine-iCommand',
  quantity:     1,
  allocated_to: 'designer@blclotus.com',
  notes:        'Automated test suite — ' + new Date().toISOString()
};

// ── Internal assert helper (shared) ────────────────────────

/**
 * Internal assertion helper used by every test function.
 * @param {Array}   results   Array to push pass/fail strings into
 * @param {Object}  counters  { passed, failed } counters (mutated)
 * @param {string}  label
 * @param {boolean} condition
 * @param {string}  [detail]
 */
function assert_(results, counters, label, condition, detail) {
  if (condition) {
    results.push('  PASS: ' + label);
    counters.passed++;
  } else {
    results.push('  FAIL: ' + label + (detail ? ' — ' + detail : ''));
    counters.failed++;
  }
}

// ============================================================
// TEST A: JOB LIFECYCLE HAPPY PATH
//
// Creates a job → starts it → logs hours → submits for QC →
// QC approves. Verifies FACT rows and VW state at each step.
// ============================================================

/**
 * Full job lifecycle: create → start → log → QC submit → QC approve.
 * Verifies FACT_JOB_EVENTS, FACT_WORK_LOGS, FACT_QC_EVENTS, and VW.
 * @returns {{ passed: number, failed: number }}
 */
function testJobLifecycleHappyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();

    // ── Step 1: Create job ────────────────────────────────────
    var createResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: SUITE_PM_EMAIL,
      payload:        SUITE_JOB_PAYLOAD,
      source:         'TEST'
    });

    assert_(results, counters, 'JOB_CREATE intake returns ok=true',
      createResult.ok === true, JSON.stringify(createResult));
    assert_(results, counters, 'JOB_CREATE intake returns a queue_id',
      !!(createResult.queueId), 'queueId=' + createResult.queueId);

    QueueProcessor.processQueue();

    var jobNumber = getLatestJobNumber_();
    assert_(results, counters, 'Job number assigned after queue processing',
      !!jobNumber, 'jobNumber=' + jobNumber);

    if (!jobNumber) {
      results.push('  SKIP: cannot continue — no job_number');
      return counters;
    }

    // Verify FACT_JOB_EVENTS has a JOB_CREATED row for this job
    var jobEvents = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' }
    );
    assert_(results, counters, 'FACT_JOB_EVENTS has JOB_CREATED row',
      jobEvents.length >= 1, 'found ' + jobEvents.length + ' rows');

    var createdEvent = null;
    for (var i = 0; i < jobEvents.length; i++) {
      if (jobEvents[i].event_type === 'JOB_CREATED') { createdEvent = jobEvents[i]; break; }
    }
    assert_(results, counters, 'FACT_JOB_EVENTS event_type = JOB_CREATED',
      !!(createdEvent), 'event_types found: ' + jobEvents.map(function(r) { return r.event_type; }).join(','));
    assert_(results, counters, 'JOB_CREATED row has correct client_code',
      createdEvent && createdEvent.client_code === SUITE_JOB_PAYLOAD.client_code,
      createdEvent ? createdEvent.client_code : 'null');

    // Verify VW shows ALLOCATED (allocated_to was provided in payload)
    var vwRow = StateMachine.getJobView(jobNumber);
    assert_(results, counters, 'VW_JOB_CURRENT_STATE row exists after create',
      !!(vwRow), 'vwRow=' + JSON.stringify(vwRow));
    assert_(results, counters, 'VW current_state = ALLOCATED after create',
      vwRow && vwRow.current_state === Config.STATES.ALLOCATED,
      vwRow ? vwRow.current_state : 'null');

    // ── Step 2: Start job ─────────────────────────────────────
    var startResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_START,
      submitterEmail: SUITE_DESIGNER,
      payload:        { job_number: jobNumber, notes: 'Test start' },
      source:         'TEST'
    });
    assert_(results, counters, 'JOB_START intake returns ok=true', startResult.ok === true);
    QueueProcessor.processQueue();

    var vwAfterStart = StateMachine.getJobView(jobNumber);
    assert_(results, counters, 'VW current_state = IN_PROGRESS after JOB_START',
      vwAfterStart && vwAfterStart.current_state === Config.STATES.IN_PROGRESS,
      vwAfterStart ? vwAfterStart.current_state : 'null');

    // Verify JOB_STARTED event in FACT
    var jobEventsAfterStart = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' }
    );
    var hasStartedEvent = false;
    for (var j = 0; j < jobEventsAfterStart.length; j++) {
      if (jobEventsAfterStart[j].event_type === 'JOB_STARTED') { hasStartedEvent = true; break; }
    }
    assert_(results, counters, 'FACT_JOB_EVENTS has JOB_STARTED row',
      hasStartedEvent, 'total events for job: ' + jobEventsAfterStart.length);

    // ── Step 3: Log work hours ────────────────────────────────
    var today = Utilities.formatDate(new Date(), 'America/Regina', 'yyyy-MM-dd');
    var logResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: SUITE_DESIGNER,
      payload:        { job_number: jobNumber, hours: 2.5, work_date: today, notes: 'Test log' },
      source:         'TEST'
    });
    assert_(results, counters, 'WORK_LOG intake returns ok=true', logResult.ok === true);
    QueueProcessor.processQueue();

    var workLogs = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' }
    );
    assert_(results, counters, 'FACT_WORK_LOGS has a row for this job',
      workLogs.length >= 1, 'found ' + workLogs.length);

    var totalHours = 0;
    for (var k = 0; k < workLogs.length; k++) {
      totalHours += parseFloat(workLogs[k].hours) || 0;
    }
    assert_(results, counters, 'Logged hours >= 2.5 for this job',
      totalHours >= 2.5, 'total hours=' + totalHours);

    // ── Step 4: Submit for QC ─────────────────────────────────
    var qcSubmitResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: SUITE_DESIGNER,
      payload:        { job_number: jobNumber, notes: 'Test QC submit' },
      source:         'TEST'
    });
    assert_(results, counters, 'QC_SUBMIT (Flow A) intake returns ok=true', qcSubmitResult.ok === true);
    QueueProcessor.processQueue();

    var vwAfterQcSubmit = StateMachine.getJobView(jobNumber);
    assert_(results, counters, 'VW current_state = QC_REVIEW after QC_SUBMIT',
      vwAfterQcSubmit && vwAfterQcSubmit.current_state === Config.STATES.QC_REVIEW,
      vwAfterQcSubmit ? vwAfterQcSubmit.current_state : 'null');

    // ── Step 5: QC Approve ────────────────────────────────────
    var qcApproveResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: SUITE_QC_EMAIL,
      payload:        { job_number: jobNumber, qc_result: 'APPROVED', notes: 'Looks good' },
      source:         'TEST'
    });
    assert_(results, counters, 'QC_SUBMIT (Flow B APPROVED) intake returns ok=true',
      qcApproveResult.ok === true);
    QueueProcessor.processQueue();

    var vwFinal = StateMachine.getJobView(jobNumber);
    assert_(results, counters, 'VW current_state = COMPLETED_BILLABLE after QC approve',
      vwFinal && vwFinal.current_state === Config.STATES.COMPLETED_BILLABLE,
      vwFinal ? vwFinal.current_state : 'null');
    assert_(results, counters, 'rework_cycle = 0 after clean QC approve',
      vwFinal && parseInt(vwFinal.rework_cycle || 0, 10) === 0,
      vwFinal ? 'rework_cycle=' + vwFinal.rework_cycle : 'null');

    // Verify billing hours: work log total matches what was logged
    var billingLogs = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' }
    );
    var billingHours = 0;
    for (var m = 0; m < billingLogs.length; m++) {
      billingHours += parseFloat(billingLogs[m].hours) || 0;
    }
    assert_(results, counters, 'Billing hours (FACT_WORK_LOGS sum) >= 2.5',
      billingHours >= 2.5, 'billingHours=' + billingHours);

  } catch (e) {
    results.push('  EXCEPTION: ' + e.message + (e.stack ? '\n' + e.stack : ''));
    counters.failed++;
  }

  console.log('=== testJobLifecycleHappyPath ===');
  results.forEach(function(r) { console.log(r); });
  console.log('RESULT: ' + counters.passed + ' passed, ' + counters.failed + ' failed');
  return counters;
}

// ============================================================
// TEST B: QC REWORK PATH
//
// Create → start → log → QC submit → QC reject (rework) →
// verify rework_cycle = 1 and state back to IN_PROGRESS →
// log more hours → QC submit again → QC approve →
// verify COMPLETED_BILLABLE with rework_cycle = 1
// ============================================================

/**
 * QC rework cycle: reject then approve. Verifies rework_cycle counter.
 * @returns {{ passed: number, failed: number }}
 */
function testQCReworkPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();

    // Setup: create + start job
    var jobNumber = setupTestJobInProgress_();
    assert_(results, counters, 'Setup: job in IN_PROGRESS',
      !!jobNumber, 'jobNumber=' + jobNumber);

    if (!jobNumber) {
      results.push('  SKIP: setup failed — no job_number');
      return counters;
    }

    // Log initial hours
    var today = Utilities.formatDate(new Date(), 'America/Regina', 'yyyy-MM-dd');
    var logR1 = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: SUITE_DESIGNER,
      payload:        { job_number: jobNumber, hours: 1.5, work_date: today },
      source:         'TEST'
    });
    assert_(results, counters, 'Initial work log intake ok', logR1.ok === true);
    QueueProcessor.processQueue();

    // Submit for QC
    var qcSub1 = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: SUITE_DESIGNER,
      payload:        { job_number: jobNumber },
      source:         'TEST'
    });
    assert_(results, counters, 'QC_SUBMIT (Flow A) for rework test ok', qcSub1.ok === true);
    QueueProcessor.processQueue();

    var vwBeforeRework = StateMachine.getJobView(jobNumber);
    assert_(results, counters, 'State = QC_REVIEW before rework decision',
      vwBeforeRework && vwBeforeRework.current_state === Config.STATES.QC_REVIEW,
      vwBeforeRework ? vwBeforeRework.current_state : 'null');

    // QC Rejects — rework
    var qcRework = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: SUITE_QC_EMAIL,
      payload:        { job_number: jobNumber, qc_result: 'REWORK', rework_notes: 'Fix the truss geometry' },
      source:         'TEST'
    });
    assert_(results, counters, 'QC_SUBMIT (Flow B REWORK) intake ok', qcRework.ok === true);
    QueueProcessor.processQueue();

    var vwAfterRework = StateMachine.getJobView(jobNumber);
    assert_(results, counters, 'State = IN_PROGRESS after REWORK decision',
      vwAfterRework && vwAfterRework.current_state === Config.STATES.IN_PROGRESS,
      vwAfterRework ? vwAfterRework.current_state : 'null');
    assert_(results, counters, 'rework_cycle = 1 after first rework',
      vwAfterRework && parseInt(vwAfterRework.rework_cycle || 0, 10) === 1,
      vwAfterRework ? 'rework_cycle=' + vwAfterRework.rework_cycle : 'null');

    // Log more hours after rework
    var logR2 = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: SUITE_DESIGNER,
      payload:        { job_number: jobNumber, hours: 0.75, work_date: today, notes: 'Rework hours' },
      source:         'TEST'
    });
    assert_(results, counters, 'Post-rework work log intake ok', logR2.ok === true);
    QueueProcessor.processQueue();

    // Submit for QC again
    var qcSub2 = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: SUITE_DESIGNER,
      payload:        { job_number: jobNumber },
      source:         'TEST'
    });
    assert_(results, counters, 'Second QC_SUBMIT intake ok', qcSub2.ok === true);
    QueueProcessor.processQueue();

    // QC Approves
    var qcApprove = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: SUITE_QC_EMAIL,
      payload:        { job_number: jobNumber, qc_result: 'APPROVED' },
      source:         'TEST'
    });
    assert_(results, counters, 'Final QC_SUBMIT (APPROVED) intake ok', qcApprove.ok === true);
    QueueProcessor.processQueue();

    var vwFinal = StateMachine.getJobView(jobNumber);
    assert_(results, counters, 'State = COMPLETED_BILLABLE after final approval',
      vwFinal && vwFinal.current_state === Config.STATES.COMPLETED_BILLABLE,
      vwFinal ? vwFinal.current_state : 'null');
    assert_(results, counters, 'rework_cycle remains 1 after final approval',
      vwFinal && parseInt(vwFinal.rework_cycle || 0, 10) === 1,
      vwFinal ? 'rework_cycle=' + vwFinal.rework_cycle : 'null');

    // Verify FACT_QC_EVENTS has QC_REWORK_REQUESTED and QC_APPROVED rows
    var qcEvents = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' }
    );
    var hasRework  = false;
    var hasApprove = false;
    for (var i = 0; i < qcEvents.length; i++) {
      if (qcEvents[i].event_type === 'QC_REWORK_REQUESTED') hasRework  = true;
      if (qcEvents[i].event_type === 'QC_APPROVED')         hasApprove = true;
    }
    assert_(results, counters, 'FACT_QC_EVENTS has QC_REWORK_REQUESTED row', hasRework,
      'event_types: ' + qcEvents.map(function(r) { return r.event_type; }).join(','));
    assert_(results, counters, 'FACT_QC_EVENTS has QC_APPROVED row', hasApprove,
      'event_types: ' + qcEvents.map(function(r) { return r.event_type; }).join(','));

  } catch (e) {
    results.push('  EXCEPTION: ' + e.message);
    counters.failed++;
  }

  console.log('=== testQCReworkPath ===');
  results.forEach(function(r) { console.log(r); });
  console.log('RESULT: ' + counters.passed + ' passed, ' + counters.failed + ' failed');
  return counters;
}

// ============================================================
// TEST C: JOB HOLD / RESUME
//
// Create → start → hold → verify ON_HOLD →
// resume → verify IN_PROGRESS, prev_state cleared
// ============================================================

/**
 * Hold/resume cycle with state verification at each step.
 * @returns {{ passed: number, failed: number }}
 */
function testJobHoldResume() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();

    var jobNumber = setupTestJobInProgress_();
    assert_(results, counters, 'Setup: job in IN_PROGRESS', !!jobNumber);

    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      return counters;
    }

    // Place on hold
    var holdR = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_HOLD,
      submitterEmail: SUITE_PM_EMAIL,
      payload:        { job_number: jobNumber, notes: 'Test hold' },
      source:         'TEST'
    });
    assert_(results, counters, 'JOB_HOLD intake ok', holdR.ok === true);
    QueueProcessor.processQueue();

    var vwOnHold = StateMachine.getJobView(jobNumber);
    assert_(results, counters, 'VW current_state = ON_HOLD after hold',
      vwOnHold && vwOnHold.current_state === Config.STATES.ON_HOLD,
      vwOnHold ? vwOnHold.current_state : 'null');
    assert_(results, counters, 'VW prev_state = IN_PROGRESS after hold',
      vwOnHold && vwOnHold.prev_state === Config.STATES.IN_PROGRESS,
      vwOnHold ? 'prev_state=' + vwOnHold.prev_state : 'null');

    // Resume
    var resumeR = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_RESUME,
      submitterEmail: SUITE_PM_EMAIL,
      payload:        { job_number: jobNumber, notes: 'Test resume' },
      source:         'TEST'
    });
    assert_(results, counters, 'JOB_RESUME intake ok', resumeR.ok === true);
    QueueProcessor.processQueue();

    var vwAfterResume = StateMachine.getJobView(jobNumber);
    assert_(results, counters, 'VW current_state = IN_PROGRESS after resume',
      vwAfterResume && vwAfterResume.current_state === Config.STATES.IN_PROGRESS,
      vwAfterResume ? vwAfterResume.current_state : 'null');

    // Verify FACT events were written
    var jobEvts = DAL.readWhere(
      Config.TABLES.FACT_JOB_EVENTS,
      { job_number: jobNumber },
      { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' }
    );
    var eventTypes = jobEvts.map(function(r) { return r.event_type; });
    assert_(results, counters, 'FACT_JOB_EVENTS contains JOB_HELD event',
      eventTypes.indexOf('JOB_HELD') >= 0, 'events: ' + eventTypes.join(','));
    assert_(results, counters, 'FACT_JOB_EVENTS contains JOB_RESUMED event',
      eventTypes.indexOf('JOB_RESUMED') >= 0, 'events: ' + eventTypes.join(','));

  } catch (e) {
    results.push('  EXCEPTION: ' + e.message);
    counters.failed++;
  }

  console.log('=== testJobHoldResume ===');
  results.forEach(function(r) { console.log(r); });
  console.log('RESULT: ' + counters.passed + ' passed, ' + counters.failed + ' failed');
  return counters;
}

// ============================================================
// TEST D: RBAC ENFORCEMENT
//
// D1: Designer attempts JOB_CREATE → must fail RBAC
// D2: Designer attempts QC_APPROVE → must fail RBAC
// D3: QC reviewer attempts JOB_CREATE → must fail
// D4: Unknown email → IntakeService must reject at intake
// ============================================================

/**
 * RBAC enforcement: verifies unauthorized actors are blocked.
 * NOTE: IntakeService resolves the actor inside QueueProcessor.
 * A designer CAN submit a form; the queue item will fail when
 * the handler enforces RBAC. We test the processed outcome.
 * @returns {{ passed: number, failed: number }}
 */
function testRBACEnforcement() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();

    // ── D1: Designer cannot create a job ─────────────────────
    // The queue item will be processed and the handler must throw RBAC error.
    // After processing, the queue item status will be FAILED.
    var beforeCount = 0;
    try {
      var existingEvents = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS,
        { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
      beforeCount = existingEvents.length;
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }

    var designerCreateResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: SUITE_DESIGNER,     // DESIGNER — no JOB_CREATE permission
      payload:        SUITE_JOB_PAYLOAD,
      source:         'TEST'
    });
    // Intake itself may succeed (it just enqueues); we verify after processing
    QueueProcessor.processQueue();

    // FACT row count must not increase — RBAC blocked the write
    var afterCount = 0;
    try {
      var eventsAfter = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS,
        { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
      afterCount = eventsAfter.length;
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }
    assert_(results, counters, 'Designer JOB_CREATE: no FACT row written (RBAC blocked)',
      afterCount === beforeCount,
      'before=' + beforeCount + ' after=' + afterCount);

    // ── D2: Designer cannot approve QC ───────────────────────
    // Set up a job in QC_REVIEW, then have a designer attempt to approve it
    clearStalePendingItems_();
    var qcTestJob = setupTestJobInProgress_();

    if (qcTestJob) {
      // Submit for QC (valid — designer can do this)
      IntakeService.processSubmission({
        formType:       Config.FORM_TYPES.QC_SUBMIT,
        submitterEmail: SUITE_DESIGNER,
        payload:        { job_number: qcTestJob },
        source:         'TEST'
      });
      QueueProcessor.processQueue();

      var vwInQcReview = StateMachine.getJobView(qcTestJob);
      assert_(results, counters, 'Setup: job reached QC_REVIEW state',
        vwInQcReview && vwInQcReview.current_state === Config.STATES.QC_REVIEW,
        vwInQcReview ? vwInQcReview.current_state : 'null');

      // Now designer (not QC role) tries to approve — should be blocked
      var designerApproveIntake = IntakeService.processSubmission({
        formType:       Config.FORM_TYPES.QC_SUBMIT,
        submitterEmail: SUITE_DESIGNER,    // DESIGNER — no QC_APPROVE permission
        payload:        { job_number: qcTestJob, qc_result: 'APPROVED' },
        source:         'TEST'
      });
      QueueProcessor.processQueue();

      // State must still be QC_REVIEW — not COMPLETED_BILLABLE
      var vwAfterBadApprove = StateMachine.getJobView(qcTestJob);
      assert_(results, counters, 'Designer QC_APPROVE blocked: state still QC_REVIEW',
        vwAfterBadApprove && vwAfterBadApprove.current_state === Config.STATES.QC_REVIEW,
        vwAfterBadApprove ? vwAfterBadApprove.current_state : 'null');
    } else {
      results.push('  SKIP: D2 test — setup job failed');
      counters.failed++;
    }

    // ── D3: Unknown email — RBAC.resolveActor returns null ───
    // IntakeService should reject at intake if actor cannot be resolved,
    // or the queue item should fail. Either way no FACT write occurs.
    clearStalePendingItems_();
    var unknownBefore = 0;
    try {
      var existingBeforeUnknown = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS,
        { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
      unknownBefore = existingBeforeUnknown.length;
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }

    var unknownResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: SUITE_UNKNOWN,
      payload:        SUITE_JOB_PAYLOAD,
      source:         'TEST'
    });
    QueueProcessor.processQueue();

    var unknownAfter = 0;
    try {
      var existingAfterUnknown = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS,
        { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
      unknownAfter = existingAfterUnknown.length;
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }
    assert_(results, counters, 'Unknown email: no FACT row written',
      unknownAfter === unknownBefore,
      'before=' + unknownBefore + ' after=' + unknownAfter);

  } catch (e) {
    results.push('  EXCEPTION: ' + e.message);
    counters.failed++;
  }

  console.log('=== testRBACEnforcement ===');
  results.forEach(function(r) { console.log(r); });
  console.log('RESULT: ' + counters.passed + ' passed, ' + counters.failed + ' failed');
  return counters;
}

// ============================================================
// TEST E: IDEMPOTENCY
//
// Submits the same queue item twice (same queue_id) by manually
// constructing two submissions with identical source_submission_id.
// The second must be silently skipped — no duplicate FACT row.
// ============================================================

/**
 * Idempotency: duplicate queue item does not create a duplicate FACT row.
 * @returns {{ passed: number, failed: number }}
 */
function testIdempotency() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();

    // First submission — should succeed and create a FACT row
    var firstResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: SUITE_PM_EMAIL,
      payload:        SUITE_JOB_PAYLOAD,
      source:         'TEST'
    });
    assert_(results, counters, 'First intake submission ok', firstResult.ok === true);

    QueueProcessor.processQueue();

    // Read count of JOB_CREATED rows after first processing
    var afterFirst = [];
    try {
      afterFirst = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS,
        { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }
    var createdCountAfterFirst = afterFirst.filter(function(r) {
      return r.event_type === 'JOB_CREATED';
    }).length;

    assert_(results, counters, 'At least 1 JOB_CREATED row exists after first submission',
      createdCountAfterFirst >= 1, 'count=' + createdCountAfterFirst);

    // Second submission — resubmit the exact same queue_id by simulating a
    // re-delivery. We retrieve the queue_id from the first intake result and
    // call the handler directly with a cloned queue item carrying the same
    // idempotency key. This tests the handler-level idempotency guard.
    var firstQueueId = firstResult.queueId;
    assert_(results, counters, 'First intake returned a queueId for idempotency test',
      !!firstQueueId, 'queueId=' + firstQueueId);

    if (firstQueueId) {
      // Build a mock queue item that mimics the original (same queue_id = same idempotency key)
      var duplicateQueueItem = {
        queue_id:     firstQueueId,   // same key — handler will detect duplicate
        form_type:    Config.FORM_TYPES.JOB_CREATE,
        payload_json: JSON.stringify(SUITE_JOB_PAYLOAD)
      };
      var actor = RBAC.resolveActor(SUITE_PM_EMAIL);

      var duplicateHandlerResult = JobCreateHandler.handle(duplicateQueueItem, actor);

      assert_(results, counters, 'Duplicate handler call returns DUPLICATE sentinel (not an error)',
        duplicateHandlerResult === 'DUPLICATE',
        'returned: ' + duplicateHandlerResult);

      // Row count must not increase
      var afterSecond = [];
      try {
        afterSecond = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS,
          { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
      } catch (e) {
        if (e.code !== 'SHEET_NOT_FOUND') throw e;
      }
      var createdCountAfterSecond = afterSecond.filter(function(r) {
        return r.event_type === 'JOB_CREATED';
      }).length;

      assert_(results, counters, 'No duplicate JOB_CREATED row written on second call',
        createdCountAfterSecond === createdCountAfterFirst,
        'after first=' + createdCountAfterFirst + ' after second=' + createdCountAfterSecond);
    }

  } catch (e) {
    results.push('  EXCEPTION: ' + e.message);
    counters.failed++;
  }

  console.log('=== testIdempotency ===');
  results.forEach(function(r) { console.log(r); });
  console.log('RESULT: ' + counters.passed + ' passed, ' + counters.failed + ' failed');
  return counters;
}

// ============================================================
// TEST F: WORK LOG ACCUMULATION
//
// Create + start a job. Log 2.5 hours on day 1, 3.0 hours on
// day 2. Verify total = 5.5 in FACT_WORK_LOGS for the job.
// ============================================================

/**
 * Work log accumulation: two logs for the same job sum correctly.
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogAccumulation() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();

    var jobNumber = setupTestJobInProgress_();
    assert_(results, counters, 'Setup: job in IN_PROGRESS', !!jobNumber);

    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      return counters;
    }

    var today = Utilities.formatDate(new Date(), 'America/Regina', 'yyyy-MM-dd');

    // Log 1: 2.5 hours today
    var log1 = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: SUITE_DESIGNER,
      payload:        { job_number: jobNumber, hours: 2.5, work_date: today, notes: 'Day 1 log' },
      source:         'TEST'
    });
    assert_(results, counters, 'First work log intake ok', log1.ok === true);
    QueueProcessor.processQueue();

    // Log 2: 3.0 hours (same day, different entry is valid per system rules)
    var log2 = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: SUITE_DESIGNER,
      payload:        { job_number: jobNumber, hours: 3.0, work_date: today, notes: 'Day 2 log' },
      source:         'TEST'
    });
    assert_(results, counters, 'Second work log intake ok', log2.ok === true);
    QueueProcessor.processQueue();

    // Verify both logs are in FACT_WORK_LOGS
    var workLogs = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' }
    );

    assert_(results, counters, 'FACT_WORK_LOGS has at least 2 rows for this job',
      workLogs.length >= 2, 'found ' + workLogs.length + ' rows');

    var totalHours = 0;
    for (var i = 0; i < workLogs.length; i++) {
      totalHours += parseFloat(workLogs[i].hours) || 0;
    }
    assert_(results, counters, 'Total hours in FACT_WORK_LOGS = 5.5 for this job',
      Math.abs(totalHours - 5.5) < 0.01,
      'expected 5.5, got ' + totalHours);

    assert_(results, counters, 'All work log rows have correct job_number',
      workLogs.every(function(r) { return r.job_number === jobNumber; }),
      'job_numbers found: ' + workLogs.map(function(r) { return r.job_number; }).join(','));

  } catch (e) {
    results.push('  EXCEPTION: ' + e.message);
    counters.failed++;
  }

  console.log('=== testWorkLogAccumulation ===');
  results.forEach(function(r) { console.log(r); });
  console.log('RESULT: ' + counters.passed + ' passed, ' + counters.failed + ' failed');
  return counters;
}

// ============================================================
// TEST G: PAYROLL RUN
//
// Requires work log hours in FACT_WORK_LOGS for the current period
// and active staff in DIM_STAFF_ROSTER.
// Runs runPayrollRun(). Verifies:
//   - Rows written to FACT_PAYROLL_LEDGER with event_type=PAYROLL_CALCULATED
//   - total_pay > 0 for staff with hours
//   - status = PENDING_CONFIRMATION (pre-approval state)
// ============================================================

/**
 * Payroll base run verification.
 * Depends on work log data existing for the period (run testWorkLogAccumulation first).
 * @returns {{ passed: number, failed: number }}
 */
function testPayrollRun() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    // Read FACT_PAYROLL_LEDGER row count before run
    var beforeRows = 0;
    try {
      var beforeLedger = DAL.readAll(Config.TABLES.FACT_PAYROLL_LEDGER,
        { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
      beforeRows = beforeLedger.length;
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }

    // Run payroll
    var result = PayrollEngine.runPayrollRun(SUITE_CEO_EMAIL, { periodId: SUITE_PERIOD_ID });

    assert_(results, counters, 'runPayrollRun returns a result object', !!(result));
    assert_(results, counters, 'runPayrollRun has processed property', typeof result.processed === 'number',
      'result=' + JSON.stringify(result));
    assert_(results, counters, 'runPayrollRun has period_id in result',
      result.period_id === SUITE_PERIOD_ID,
      'period_id=' + result.period_id);
    assert_(results, counters, 'runPayrollRun has errors array', Array.isArray(result.errors));

    // Check FACT_PAYROLL_LEDGER for PAYROLL_CALCULATED rows
    var afterLedger = [];
    try {
      afterLedger = DAL.readAll(Config.TABLES.FACT_PAYROLL_LEDGER,
        { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }

    var payrollCalcRows = afterLedger.filter(function(r) {
      return r.event_type === 'PAYROLL_CALCULATED';
    });

    if (result.processed > 0) {
      assert_(results, counters, 'FACT_PAYROLL_LEDGER gained PAYROLL_CALCULATED rows',
        afterLedger.length > beforeRows,
        'before=' + beforeRows + ' after=' + afterLedger.length);

      assert_(results, counters, 'At least one PAYROLL_CALCULATED row exists',
        payrollCalcRows.length >= 1, 'found ' + payrollCalcRows.length);

      // Verify amounts > 0 for staff with hours
      var positivePayRows = payrollCalcRows.filter(function(r) {
        return (parseFloat(r.total_pay) || 0) > 0;
      });
      assert_(results, counters, 'At least one PAYROLL_CALCULATED row has total_pay > 0',
        positivePayRows.length >= 1,
        'positive pay rows: ' + positivePayRows.length + ' of ' + payrollCalcRows.length);

      // Verify status = PENDING_CONFIRMATION
      var pendingRows = payrollCalcRows.filter(function(r) {
        return r.status === 'PENDING_CONFIRMATION';
      });
      assert_(results, counters, 'PAYROLL_CALCULATED rows have status=PENDING_CONFIRMATION',
        pendingRows.length === payrollCalcRows.length,
        'pending=' + pendingRows.length + ' total=' + payrollCalcRows.length);

      // Verify all rows have the correct period_id
      var correctPeriodRows = payrollCalcRows.filter(function(r) {
        return r.period_id === SUITE_PERIOD_ID;
      });
      assert_(results, counters, 'All PAYROLL_CALCULATED rows have correct period_id',
        correctPeriodRows.length === payrollCalcRows.length,
        'correct=' + correctPeriodRows.length + ' total=' + payrollCalcRows.length);

      // Verify payroll run is idempotent — second run should skip already-processed rows
      var result2 = PayrollEngine.runPayrollRun(SUITE_CEO_EMAIL, { periodId: SUITE_PERIOD_ID });
      assert_(results, counters, 'Second payroll run is idempotent (all skipped)',
        result2.processed === 0,
        'processed on 2nd run: ' + result2.processed);

    } else {
      // No hours found — this test still passes but notes the condition
      results.push('  INFO: No work log hours found for period ' + SUITE_PERIOD_ID +
                   ' — run testWorkLogAccumulation first to seed hours.');
      assert_(results, counters, 'runPayrollRun completes without errors when no hours',
        result.errors.length === 0, 'errors: ' + result.errors.join('; '));
    }

  } catch (e) {
    results.push('  EXCEPTION: ' + e.message);
    counters.failed++;
  }

  console.log('=== testPayrollRun ===');
  results.forEach(function(r) { console.log(r); });
  console.log('RESULT: ' + counters.passed + ' passed, ' + counters.failed + ' failed');
  return counters;
}

// ============================================================
// TEST H: SUPERVISOR BONUS RUN
//
// Runs runBonusRun() for the current period.
// Verifies FACT_PAYROLL_LEDGER has rows with
// event_type = PAYROLL_BONUS_SUPERVISOR for TL / PM actors.
// ============================================================

/**
 * Supervisor bonus run verification.
 * @returns {{ passed: number, failed: number }}
 */
function testBonusRun() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var result = PayrollEngine.runBonusRun(SUITE_CEO_EMAIL, { periodId: SUITE_PERIOD_ID });

    assert_(results, counters, 'runBonusRun returns a result object', !!(result));
    assert_(results, counters, 'runBonusRun has processed property',
      typeof result.processed === 'number', 'result keys: ' + Object.keys(result).join(','));
    assert_(results, counters, 'runBonusRun returns correct period_id',
      result.period_id === SUITE_PERIOD_ID, 'period_id=' + result.period_id);
    assert_(results, counters, 'runBonusRun has by_supervisor array',
      Array.isArray(result.by_supervisor), 'result keys: ' + Object.keys(result).join(','));

    if (result.processed > 0) {
      // Check FACT_PAYROLL_LEDGER for PAYROLL_BONUS_SUPERVISOR rows
      var ledgerRows = [];
      try {
        ledgerRows = DAL.readAll(Config.TABLES.FACT_PAYROLL_LEDGER,
          { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
      } catch (e) {
        if (e.code !== 'SHEET_NOT_FOUND') throw e;
      }

      var bonusRows = ledgerRows.filter(function(r) {
        return r.event_type === 'PAYROLL_BONUS_SUPERVISOR';
      });

      assert_(results, counters, 'FACT_PAYROLL_LEDGER has PAYROLL_BONUS_SUPERVISOR rows',
        bonusRows.length >= 1, 'found ' + bonusRows.length);

      var positiveBonusRows = bonusRows.filter(function(r) {
        return (parseFloat(r.bonus_amount) || 0) > 0;
      });
      assert_(results, counters, 'At least one bonus row has bonus_amount > 0',
        positiveBonusRows.length >= 1,
        'positive: ' + positiveBonusRows.length + ' of ' + bonusRows.length);

      // Bonus run idempotency
      var result2 = PayrollEngine.runBonusRun(SUITE_CEO_EMAIL, { periodId: SUITE_PERIOD_ID });
      assert_(results, counters, 'Second bonus run is idempotent (all skipped)',
        result2.processed === 0,
        'processed on 2nd run: ' + result2.processed);

    } else {
      results.push('  INFO: No supervisor bonus calculated — no supervised hours found. ' +
                   'Run testWorkLogAccumulation first to seed hours.');
      assert_(results, counters, 'runBonusRun completes when no supervised hours',
        result.processed === 0, 'processed=' + result.processed);
    }

  } catch (e) {
    results.push('  EXCEPTION: ' + e.message);
    counters.failed++;
  }

  console.log('=== testBonusRun ===');
  results.forEach(function(r) { console.log(r); });
  console.log('RESULT: ' + counters.passed + ' passed, ' + counters.failed + ' failed');
  return counters;
}

// ============================================================
// TEST I: STATE MACHINE VALIDATION
//
// Verifies that invalid state transitions are blocked at the
// handler level. Tests:
//   I1: Cannot start a job that is already IN_PROGRESS
//   I2: Cannot submit for QC a job that is already in QC_REVIEW
//   I3: Cannot hold a job that is already ON_HOLD
// ============================================================

/**
 * Invalid state transitions are rejected without corrupting state.
 * @returns {{ passed: number, failed: number }}
 */
function testStateMachineGuards() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();

    var jobNumber = setupTestJobInProgress_();
    assert_(results, counters, 'Setup: job in IN_PROGRESS', !!jobNumber);

    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      return counters;
    }

    // ── I1: Try to start an already-IN_PROGRESS job ───────────
    var invalidStart = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_START,
      submitterEmail: SUITE_DESIGNER,
      payload:        { job_number: jobNumber },
      source:         'TEST'
    });
    QueueProcessor.processQueue();

    // State must remain IN_PROGRESS — not change
    var vwAfterBadStart = StateMachine.getJobView(jobNumber);
    assert_(results, counters, 'State unchanged after invalid JOB_START on IN_PROGRESS job',
      vwAfterBadStart && vwAfterBadStart.current_state === Config.STATES.IN_PROGRESS,
      vwAfterBadStart ? vwAfterBadStart.current_state : 'null');

    // ── I2: Submit for QC then try to submit again ────────────
    clearStalePendingItems_();
    var jobNumber2 = setupTestJobInProgress_();
    assert_(results, counters, 'Setup: second job in IN_PROGRESS', !!jobNumber2);

    if (jobNumber2) {
      // Valid QC submit
      IntakeService.processSubmission({
        formType:       Config.FORM_TYPES.QC_SUBMIT,
        submitterEmail: SUITE_DESIGNER,
        payload:        { job_number: jobNumber2 },
        source:         'TEST'
      });
      QueueProcessor.processQueue();

      var vwInQCReview = StateMachine.getJobView(jobNumber2);
      assert_(results, counters, 'Job2 reached QC_REVIEW',
        vwInQCReview && vwInQCReview.current_state === Config.STATES.QC_REVIEW,
        vwInQCReview ? vwInQCReview.current_state : 'null');

      // Invalid: try to submit for QC again from QC_REVIEW (Flow A requires IN_PROGRESS)
      IntakeService.processSubmission({
        formType:       Config.FORM_TYPES.QC_SUBMIT,
        submitterEmail: SUITE_DESIGNER,
        payload:        { job_number: jobNumber2 },
        source:         'TEST'
      });
      QueueProcessor.processQueue();

      var vwAfterDoubleQC = StateMachine.getJobView(jobNumber2);
      assert_(results, counters, 'State unchanged after invalid double QC_SUBMIT',
        vwAfterDoubleQC && vwAfterDoubleQC.current_state === Config.STATES.QC_REVIEW,
        vwAfterDoubleQC ? vwAfterDoubleQC.current_state : 'null');
    }

  } catch (e) {
    results.push('  EXCEPTION: ' + e.message);
    counters.failed++;
  }

  console.log('=== testStateMachineGuards ===');
  results.forEach(function(r) { console.log(r); });
  console.log('RESULT: ' + counters.passed + ' passed, ' + counters.failed + ' failed');
  return counters;
}

// ============================================================
// TEST J: VALIDATION REJECTION
//
// Sends payloads with missing required fields. Verifies that
// the queue item fails and no FACT row is written.
// ============================================================

/**
 * Payload validation rejects bad inputs without writing FACT rows.
 * @returns {{ passed: number, failed: number }}
 */
function testValidationRejection() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();

    // Count FACT_JOB_EVENTS rows before
    var before = 0;
    try {
      var evBefore = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS,
        { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
      before = evBefore.length;
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }

    // ── V1: JOB_CREATE missing client_code (required) ────────
    IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: SUITE_PM_EMAIL,
      payload:        { job_type: 'DESIGN', quantity: 1 },  // missing client_code
      source:         'TEST'
    });
    QueueProcessor.processQueue();

    var afterV1 = 0;
    try {
      var evAfterV1 = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS,
        { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
      afterV1 = evAfterV1.length;
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }
    assert_(results, counters, 'JOB_CREATE missing client_code: no FACT row written',
      afterV1 === before, 'before=' + before + ' after=' + afterV1);

    // ── V2: JOB_CREATE quantity=0 (below minimum) ────────────
    clearStalePendingItems_();
    IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.JOB_CREATE,
      submitterEmail: SUITE_PM_EMAIL,
      payload:        { client_code: 'NORSPAN', job_type: 'DESIGN', quantity: 0 },
      source:         'TEST'
    });
    QueueProcessor.processQueue();

    var afterV2 = 0;
    try {
      var evAfterV2 = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS,
        { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
      afterV2 = evAfterV2.length;
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }
    assert_(results, counters, 'JOB_CREATE quantity=0: no FACT row written',
      afterV2 === before, 'before=' + before + ' after=' + afterV2);

    // ── V3: WORK_LOG with hours=0 (below minimum 0.25) ───────
    clearStalePendingItems_();
    // Setup a job to log against
    var jobForV3 = setupTestJobInProgress_();
    if (jobForV3) {
      var beforeWorkLogs = 0;
      try {
        var wlBefore = DAL.readAll(Config.TABLES.FACT_WORK_LOGS,
          { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
        beforeWorkLogs = wlBefore.length;
      } catch (e) {
        if (e.code !== 'SHEET_NOT_FOUND') throw e;
      }

      var today = Utilities.formatDate(new Date(), 'America/Regina', 'yyyy-MM-dd');
      IntakeService.processSubmission({
        formType:       Config.FORM_TYPES.WORK_LOG,
        submitterEmail: SUITE_DESIGNER,
        payload:        { job_number: jobForV3, hours: 0, work_date: today },
        source:         'TEST'
      });
      QueueProcessor.processQueue();

      var afterWorkLogs = 0;
      try {
        var wlAfter = DAL.readAll(Config.TABLES.FACT_WORK_LOGS,
          { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' });
        afterWorkLogs = wlAfter.length;
      } catch (e) {
        if (e.code !== 'SHEET_NOT_FOUND') throw e;
      }
      assert_(results, counters, 'WORK_LOG hours=0: no FACT row written',
        afterWorkLogs === beforeWorkLogs,
        'before=' + beforeWorkLogs + ' after=' + afterWorkLogs);
    } else {
      results.push('  SKIP: V3 test — setup job failed');
    }

  } catch (e) {
    results.push('  EXCEPTION: ' + e.message);
    counters.failed++;
  }

  console.log('=== testValidationRejection ===');
  results.forEach(function(r) { console.log(r); });
  console.log('RESULT: ' + counters.passed + ' passed, ' + counters.failed + ' failed');
  return counters;
}

// ============================================================
// TEST K: WORK LOG PERIOD BOUNDARY
//
// Verifies that a work log with work_date in the previous period
// is still accepted (work logs are period-agnostic for the entry)
// but the FACT row is written in the CURRENT period partition
// (based on when it was submitted, not work_date).
// ============================================================

/**
 * Work log with a past work_date is accepted and written to current period.
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogPeriodBoundary() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();

    var jobNumber = setupTestJobInProgress_();
    assert_(results, counters, 'Setup: job in IN_PROGRESS', !!jobNumber);

    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      return counters;
    }

    // Submit a work log with a work_date from the beginning of the period
    // (period boundary: first day of current period)
    var periodBoundaryDate = SUITE_PERIOD_ID + '-01';   // e.g. '2026-04-01'

    var logR = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: SUITE_DESIGNER,
      payload:        {
        job_number: jobNumber,
        hours:      1.0,
        work_date:  periodBoundaryDate,
        notes:      'Period boundary test — first day of period'
      },
      source: 'TEST'
    });
    assert_(results, counters, 'Work log with period-start date accepted at intake',
      logR.ok === true, 'result=' + JSON.stringify(logR));
    QueueProcessor.processQueue();

    // The row must be in the current period partition
    var workLogs = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: SUITE_PERIOD_ID, callerModule: 'TestRunner' }
    );
    var boundaryLog = workLogs.filter(function(r) {
      return r.work_date === periodBoundaryDate || String(r.work_date).indexOf(periodBoundaryDate) === 0;
    });
    assert_(results, counters, 'Period-boundary work log row written to FACT_WORK_LOGS',
      workLogs.length >= 1, 'workLogs.length=' + workLogs.length);
    assert_(results, counters, 'Period-boundary work log has hours = 1.0',
      workLogs.some(function(r) {
        return Math.abs(parseFloat(r.hours) - 1.0) < 0.01 &&
               (r.work_date === periodBoundaryDate || String(r.work_date).indexOf(periodBoundaryDate) === 0);
      }),
      'logs found: ' + workLogs.map(function(r) { return r.work_date + ':' + r.hours; }).join(','));

  } catch (e) {
    results.push('  EXCEPTION: ' + e.message);
    counters.failed++;
  }

  console.log('=== testWorkLogPeriodBoundary ===');
  results.forEach(function(r) { console.log(r); });
  console.log('RESULT: ' + counters.passed + ' passed, ' + counters.failed + ' failed');
  return counters;
}

// ============================================================
// TEST L: PAYROLL RBAC GUARD
//
// Verifies that only CEO can run payroll.
// A PM-role actor (SUITE_PM_EMAIL) must be rejected.
// ============================================================

/**
 * Payroll run is rejected for non-CEO actors.
 * @returns {{ passed: number, failed: number }}
 */
function testPayrollRBACGuard() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var threw = false;
    var errorMessage = '';
    try {
      PayrollEngine.runPayrollRun(SUITE_PM_EMAIL, { periodId: SUITE_PERIOD_ID });
    } catch (e) {
      threw = true;
      errorMessage = e.message;
    }

    assert_(results, counters, 'runPayrollRun throws for PM actor (non-CEO)',
      threw, 'error: ' + errorMessage);

    threw = false;
    errorMessage = '';
    try {
      PayrollEngine.runPayrollRun(SUITE_DESIGNER, { periodId: SUITE_PERIOD_ID });
    } catch (e) {
      threw = true;
      errorMessage = e.message;
    }

    assert_(results, counters, 'runPayrollRun throws for DESIGNER actor',
      threw, 'error: ' + errorMessage);

    // CEO should NOT throw (even if there are no hours — it just returns 0 processed)
    var ceoThrew = false;
    try {
      PayrollEngine.runPayrollRun(SUITE_CEO_EMAIL, { periodId: SUITE_PERIOD_ID });
    } catch (e) {
      ceoThrew = true;
    }
    assert_(results, counters, 'runPayrollRun does NOT throw for CEO actor',
      !ceoThrew);

  } catch (e) {
    results.push('  EXCEPTION: ' + e.message);
    counters.failed++;
  }

  console.log('=== testPayrollRBACGuard ===');
  results.forEach(function(r) { console.log(r); });
  console.log('RESULT: ' + counters.passed + ' passed, ' + counters.failed + ' failed');
  return counters;
}

// ============================================================
// runAllTests — master runner
//
// Calls every test function, aggregates results, prints summary.
// Run this from the Apps Script editor to execute the full suite.
//
// Zero failures is the only acceptable result before deployment.
// ============================================================

/**
 * Runs all automated tests and prints a final pass/fail summary.
 * Intended to be called from the Apps Script editor.
 *
 * Test order:
 *   A - Job lifecycle happy path
 *   B - QC rework cycle
 *   C - Job hold / resume
 *   D - RBAC enforcement
 *   E - Idempotency
 *   F - Work log accumulation
 *   G - Payroll run
 *   H - Supervisor bonus run
 *   I - State machine guards
 *   J - Validation rejection
 *   K - Work log period boundary
 *   L - Payroll RBAC guard
 */
function runAllTests() {
  var totalPassed = 0;
  var totalFailed = 0;
  var suiteResults = [];

  var tests = [
    { name: 'A — Job Lifecycle Happy Path',    fn: testJobLifecycleHappyPath  },
    { name: 'B — QC Rework Path',              fn: testQCReworkPath            },
    { name: 'C — Job Hold / Resume',           fn: testJobHoldResume           },
    { name: 'D — RBAC Enforcement',            fn: testRBACEnforcement         },
    { name: 'E — Idempotency',                 fn: testIdempotency             },
    { name: 'F — Work Log Accumulation',       fn: testWorkLogAccumulation     },
    { name: 'G — Payroll Run',                 fn: testPayrollRun              },
    { name: 'H — Supervisor Bonus Run',        fn: testBonusRun                },
    { name: 'I — State Machine Guards',        fn: testStateMachineGuards      },
    { name: 'J — Validation Rejection',        fn: testValidationRejection     },
    { name: 'K — Work Log Period Boundary',    fn: testWorkLogPeriodBoundary   },
    { name: 'L — Payroll RBAC Guard',          fn: testPayrollRBACGuard        }
  ];

  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('  BLC NEXUS AUTOMATED TEST SUITE');
  console.log('  Period: ' + SUITE_PERIOD_ID);
  console.log('  Started: ' + new Date().toISOString());
  console.log('══════════════════════════════════════════════');

  for (var i = 0; i < tests.length; i++) {
    var t = tests[i];
    console.log('');
    console.log('Running: ' + t.name);

    var result = { passed: 0, failed: 0 };
    try {
      result = t.fn();
    } catch (e) {
      console.log('  UNHANDLED EXCEPTION in ' + t.name + ': ' + e.message);
      result.failed++;
    }

    totalPassed += result.passed;
    totalFailed += result.failed;

    var status = (result.failed === 0) ? 'PASS' : 'FAIL';
    suiteResults.push({
      name:   t.name,
      passed: result.passed,
      failed: result.failed,
      status: status
    });
  }

  // Summary
  console.log('');
  console.log('══════════════════════════════════════════════');
  console.log('  TEST SUITE SUMMARY');
  console.log('══════════════════════════════════════════════');
  for (var j = 0; j < suiteResults.length; j++) {
    var r = suiteResults[j];
    console.log('  [' + r.status + '] ' + r.name +
               ' (' + r.passed + ' passed, ' + r.failed + ' failed)');
  }
  console.log('──────────────────────────────────────────────');
  console.log('  TOTAL: ' + totalPassed + ' passed, ' + totalFailed + ' failed');
  console.log('  ' + (totalFailed === 0 ? 'ALL TESTS PASSED — safe to deploy' :
                                          'FAILURES DETECTED — fix before deploying'));
  console.log('══════════════════════════════════════════════');

  return { totalPassed: totalPassed, totalFailed: totalFailed };
}

/**
 * Manual test: verifies runAnnualBonus returns the correct shape
 * and is idempotent. Run from Apps Script editor.
 * Requires at least one QUARTERLY_BONUS CALCULATED row in FACT_QUARTERLY_BONUS.
 */
function testAnnualBonus() {
  header_('ANNUAL BONUS TEST');

  var year = new Date().getFullYear();

  // First run — should write rows (or 0 if no quarterly data yet)
  var result1 = QuarterlyBonusEngine.runAnnualBonus(Session.getActiveUser().getEmail(), year);
  info_('First run:  written=' + result1.written + ' skipped=' + result1.skipped + ' year=' + result1.year);

  var shapeOk = typeof result1.written === 'number' &&
                typeof result1.skipped === 'number' &&
                result1.year === year;
  info_('Shape OK:  ' + shapeOk);

  // Second run — must be idempotent (written=0, skipped=result1.written)
  var result2 = QuarterlyBonusEngine.runAnnualBonus(Session.getActiveUser().getEmail(), year);
  info_('Second run: written=' + result2.written + ' skipped=' + result2.skipped);

  var idempotent = result2.written === 0 && result2.skipped === result1.written;
  info_('Idempotent: ' + idempotent);

  if (shapeOk && idempotent) { pass_('Annual bonus shape and idempotency checks passed'); }
  else { fail_('Annual bonus check failed — shapeOk=' + shapeOk + ' idempotent=' + idempotent); }
  line_();
}

/**
 * Manual test: verifies rebuildAllViews returns the correct shape
 * and is idempotent. Run from Apps Script editor.
 * Requires at least one FACT_JOB_EVENTS partition tab to exist.
 */
function testEventReplay() {
  header_('EVENT REPLAY TEST');

  var email = Session.getActiveUser().getEmail();

  // First run — rebuilds from all FACT partitions
  var result1 = EventReplayEngine.rebuildAllViews(email);
  info_('First run: jobs=' + result1.vw_job.written +
        ' workload=' + result1.vw_workload.written +
        ' partial=' + result1.partial +
        ' elapsed_ms=' + result1.elapsed_ms);

  var shapeOk = (
    typeof result1.vw_job.written      === 'number' &&
    typeof result1.vw_job.cleared      === 'number' &&
    typeof result1.vw_workload.written === 'number' &&
    typeof result1.vw_workload.cleared === 'number' &&
    typeof result1.partial             === 'boolean' &&
    typeof result1.elapsed_ms          === 'number'
  );
  info_('Shape OK: ' + shapeOk);

  // Row count check — VW_JOB_CURRENT_STATE must match vw_job.written
  var ss         = SpreadsheetApp.getActiveSpreadsheet();
  var vwSheet    = ss.getSheetByName('VW_JOB_CURRENT_STATE');
  var actualRows = vwSheet ? Math.max(vwSheet.getLastRow() - 1, 0) : 0;
  var rowCountOk = (actualRows === result1.vw_job.written);
  info_('Row count OK: ' + rowCountOk +
        ' (sheet=' + actualRows + ' written=' + result1.vw_job.written + ')');

  // Second run — idempotent: same row counts
  var result2 = EventReplayEngine.rebuildAllViews(email);
  info_('Second run: jobs=' + result2.vw_job.written +
        ' workload=' + result2.vw_workload.written);

  var idempotent = (
    result2.vw_job.written      === result1.vw_job.written &&
    result2.vw_workload.written === result1.vw_workload.written
  );
  info_('Idempotent: ' + idempotent);

  var allOk = shapeOk && rowCountOk && idempotent && !result1.partial;
  if (allOk) {
    pass_('EventReplay shape, row count, and idempotency checks passed');
  } else {
    fail_('EventReplay check failed — shapeOk=' + shapeOk +
          ' rowCountOk=' + rowCountOk +
          ' idempotent=' + idempotent +
          ' partial=' + result1.partial);
  }
  line_();
}

/**
 * Manual test: verifies refreshDashboard returns correct shape,
 * row counts match MART sheets, and run is idempotent.
 * Run from Apps Script editor.
 */
function testReportingEngine() {
  header_('REPORTING ENGINE TEST');

  var email = Session.getActiveUser().getEmail();

  // First run — aggregates all source data into four MARTs
  var result1 = ReportingEngine.refreshDashboard(email);
  info_('First run: periods=' + result1.periods +
        ' dashboard=' + result1.mart_dashboard.written +
        ' team=' + result1.mart_team.written +
        ' designer=' + result1.mart_designer.written +
        ' account=' + result1.mart_account.written +
        ' partial=' + result1.partial +
        ' elapsed_ms=' + result1.elapsed_ms);

  var shapeOk = (
    typeof result1.periods                 === 'number'  &&
    typeof result1.mart_dashboard.written  === 'number'  &&
    typeof result1.mart_dashboard.cleared  === 'number'  &&
    typeof result1.mart_team.written       === 'number'  &&
    typeof result1.mart_designer.written   === 'number'  &&
    typeof result1.mart_account.written    === 'number'  &&
    typeof result1.partial                 === 'boolean' &&
    typeof result1.elapsed_ms              === 'number'
  );
  info_('Shape OK: ' + shapeOk);

  // Row count checks — each MART sheet must match .written
  var ss            = SpreadsheetApp.getActiveSpreadsheet();
  var dashSheet     = ss.getSheetByName('MART_DASHBOARD');
  var teamSheet     = ss.getSheetByName('MART_TEAM_SUMMARY');
  var designerSheet = ss.getSheetByName('MART_DESIGNER_SUMMARY');
  var accountSheet  = ss.getSheetByName('MART_ACCOUNT_SUMMARY');

  var dashRows     = dashSheet     ? Math.max(dashSheet.getLastRow()     - 1, 0) : 0;
  var teamRows     = teamSheet     ? Math.max(teamSheet.getLastRow()     - 1, 0) : 0;
  var designerRows = designerSheet ? Math.max(designerSheet.getLastRow() - 1, 0) : 0;
  var accountRows  = accountSheet  ? Math.max(accountSheet.getLastRow()  - 1, 0) : 0;

  var rowCountOk = (
    dashRows     === result1.mart_dashboard.written &&
    teamRows     === result1.mart_team.written      &&
    designerRows === result1.mart_designer.written  &&
    accountRows  === result1.mart_account.written
  );
  info_('Row count OK: ' + rowCountOk +
        ' (dashboard=' + dashRows + '/' + result1.mart_dashboard.written +
        ' team=' + teamRows + '/' + result1.mart_team.written +
        ' designer=' + designerRows + '/' + result1.mart_designer.written +
        ' account=' + accountRows + '/' + result1.mart_account.written + ')');

  // Second run — idempotent: row counts must be identical
  var result2 = ReportingEngine.refreshDashboard(email);
  info_('Second run: periods=' + result2.periods +
        ' dashboard=' + result2.mart_dashboard.written +
        ' designer=' + result2.mart_designer.written +
        ' account=' + result2.mart_account.written);

  var idempotent = (
    result2.mart_dashboard.written === result1.mart_dashboard.written &&
    result2.mart_team.written      === result1.mart_team.written      &&
    result2.mart_designer.written  === result1.mart_designer.written  &&
    result2.mart_account.written   === result1.mart_account.written
  );
  info_('Idempotent: ' + idempotent);

  var allOk = shapeOk && rowCountOk && idempotent && !result1.partial;
  if (allOk) {
    pass_('ReportingEngine shape, row counts, and idempotency checks passed');
  } else {
    fail_('ReportingEngine check failed — shapeOk=' + shapeOk +
          ' rowCountOk=' + rowCountOk +
          ' idempotent=' + idempotent +
          ' partial=' + result1.partial);
  }
  line_();
}

/**
 * Verifies JobCreateHandler.handle() enforces RBAC.
 * A DESIGNER actor (JOB_CREATE=false) must be denied before any data access.
 * Run from Apps Script editor. Requires no live data.
 */
function testJobCreateHandlerRBAC() {
  header_('TEST: JobCreateHandler RBAC');

  var designerActor = {
    email:      'test-designer@blctest.com',
    personCode: 'TEST-DS',
    role:       'DESIGNER',
    scope:      'SELF',
    isSystem:   false
  };

  var mockItem = {
    queue_id:        'TEST-QITM-RBAC-001',
    form_type:       'JOB_CREATE',
    submitter_email: 'test-designer@blctest.com',
    payload_json:    JSON.stringify({ client_code: 'TC', job_type: 'TEST', quantity: 1 }),
    created_at:      new Date().toISOString()
  };

  var denied = false;
  try {
    JobCreateHandler.handle(mockItem, designerActor);
  } catch (e) {
    var msg = (e && e.message) ? e.message.toLowerCase() : '';
    if (msg.indexOf('permission') !== -1 || msg.indexOf('denied') !== -1 ||
        msg.indexOf('rbac') !== -1 || msg.indexOf('job_create') !== -1) {
      denied = true;
    } else {
      info_('Unexpected error (not RBAC): ' + e.message);
    }
  }

  if (denied) {
    pass_('DESIGNER correctly denied JOB_CREATE');
  } else {
    fail_('DESIGNER was NOT denied — RBAC guard missing on JobCreateHandler.handle()');
  }

  line_();
}

/**
 * Verifies bulkOnboardStaff returns { partial: true } shape when quota limit
 * is approached. Checks the return object has a partial field (not undefined).
 * Run from Apps Script editor.
 */
function testBulkOnboardQuotaGuard() {
  header_('TEST: bulkOnboardStaff quota guard shape');

  var email = Session.getActiveUser().getEmail();

  // Run bulk import against whatever is in STG_STAFF_IMPORT.
  // We only check that the return shape always includes a partial field.
  var result;
  try {
    result = StaffOnboarding.bulkOnboardStaff(email);
  } catch (e) {
    fail_('bulkOnboardStaff threw unexpectedly: ' + e.message);
    line_();
    return;
  }

  var hasPartialField = (result !== null && result !== undefined &&
                         typeof result.partial !== 'undefined');
  var hasTotal        = typeof result.total   === 'number';
  var hasCreated      = typeof result.created === 'number';

  info_('Result shape — total=' + result.total + ' created=' + result.created +
        ' skipped=' + result.skipped + ' errors=' + result.errors +
        ' partial=' + result.partial);

  if (hasPartialField && hasTotal && hasCreated) {
    pass_('bulkOnboardStaff return shape includes partial field');
  } else {
    fail_('Return shape missing partial field — quota guard not implemented');
  }

  line_();
}
