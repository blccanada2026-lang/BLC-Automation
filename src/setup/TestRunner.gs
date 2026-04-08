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
  // Create
  var createResult = IntakeService.processSubmission({
    formType:       'JOB_CREATE',
    submitterEmail: TEST_ACTOR_EMAIL,
    payload:        TEST_JOB_PAYLOAD,
    source:         'MANUAL'
  });
  if (!createResult.ok) { console.log('  [setup] JOB_CREATE intake failed'); return null; }
  QueueProcessor.processQueue();

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
