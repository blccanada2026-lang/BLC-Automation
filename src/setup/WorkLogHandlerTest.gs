// ============================================================
// WorkLogHandlerTest.gs — BLC Nexus Setup / Tests
// src/setup/WorkLogHandlerTest.gs
//
// LOAD ORDER: Setup tier — loads after all T0–T7 files.
//
// HOW TO RUN (Apps Script editor):
//   runWorkLogTests()  — all 7 tests, summary at end
//
// Individual tests:
//   testWorkLogHandler_happyPath()
//   testWorkLogHandler_rbacDenial()
//   testWorkLogHandler_invalidPayload()
//   testWorkLogHandler_wrongState()
//   testWorkLogHandler_duplicate()
//   testWorkLogHandler_contentDuplicate()
//   testWorkLogHandler_dailyCap()
//
// Test actors:
//   DESIGNER (WORK_LOG_SUBMIT allowed) : designer@blclotus.com  (TH_DESIGNER_EMAIL)
//   Unknown  (no RBAC entry)           : nobody@notinrbac.com   (TH_UNKNOWN_EMAIL)
//
// Starting state: IN_PROGRESS (via thSetupInProgressJob_())
//
// NOTE — wrongState design:
//   WorkLogHandler rejects only terminal states (INVOICED).
//   ALLOCATED is non-terminal so it would be ACCEPTED, not rejected —
//   thSetupAllocatedJob_() cannot produce a wrongState failure here.
//   Instead, wrongState submits a syntactically valid job number
//   (BLC-99999) that does not exist in VW_JOB_CURRENT_STATE.
//   This exercises the real Step 4 guard: job-not-found throws,
//   queue item stays non-COMPLETED, no FACT_WORK_LOGS row written.
//
// NOTE — state invariant:
//   WorkLogHandler writes to FACT_WORK_LOGS only — it does NOT
//   update VW_JOB_CURRENT_STATE. VW current_state must remain
//   IN_PROGRESS before and after every successful log submission.
// ============================================================

// assertH_() and printResultsH_() are defined in TestHarness.gs (shared harness).

// Work date used across most tests — a mid-month date in the test period.
var TW_WORK_DATE     = '2026-04-15';
// Separate date for daily-cap test — keeps it isolated from other test hours.
var TW_WORK_DATE_CAP = '2026-04-14';

// ============================================================
// TEST 1 — Happy Path
// IN_PROGRESS job → WORK_LOG submitted → FACT_WORK_LOGS row written
// VW current_state must remain IN_PROGRESS (no state change)
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogHandler_happyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('wl-happy');
    assertH_(results, counters, 'Setup: IN_PROGRESS job created', !!jobNumber,
      'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: setup failed'); return counters; }

    DAL._resetApiCallCount();

    var logResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        hours:      3.5,
        work_date:  TW_WORK_DATE,
        notes:      'WorkLogHandlerTest happyPath'
      },
      source: 'TEST'
    });
    assertH_(results, counters, 'IntakeService returns ok=true',
      logResult.ok === true, JSON.stringify(logResult));

    processQueueFresh_();

    // ── VW state must be unchanged ───────────────────────────
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW current_state still IN_PROGRESS (no state change)',
      vw && vw.current_state === Config.STATES.IN_PROGRESS,
      vw ? vw.current_state : 'null');

    // ── FACT_WORK_LOGS row ───────────────────────────────────
    var logs = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    var logEvent = null;
    for (var i = 0; i < logs.length; i++) {
      if (logs[i].event_type === Constants.EVENT_TYPES.WORK_LOG_SUBMITTED) {
        logEvent = logs[i]; break;
      }
    }
    assertH_(results, counters, 'FACT_WORK_LOGS has WORK_LOG_SUBMITTED row', !!logEvent,
      'rows found: ' + logs.length);
    assertH_(results, counters, 'WORK_LOG_SUBMITTED hours = 3.5',
      logEvent && Number(logEvent.hours) === 3.5,
      logEvent ? String(logEvent.hours) : 'null');
    var storedDate = logEvent ? logEvent.work_date : null;
    var storedDateStr = storedDate instanceof Date
      ? Utilities.formatDate(storedDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(storedDate || '');
    assertH_(results, counters, 'WORK_LOG_SUBMITTED work_date correct',
      storedDateStr === TW_WORK_DATE, storedDateStr);
    assertH_(results, counters, 'WORK_LOG_SUBMITTED actor_code = DS1',
      logEvent && logEvent.actor_code === TH_DESIGNER_CODE,
      logEvent ? logEvent.actor_code : 'null');
    assertH_(results, counters, 'WORK_LOG_SUBMITTED has idempotency_key',
      logEvent && !!logEvent.idempotency_key,
      logEvent ? logEvent.idempotency_key : 'null');

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testWorkLogHandler_happyPath', results, counters);
  return counters;
}

// ============================================================
// TEST 2 — RBAC Denial
// All staff roles (DESIGNER through CEO) have WORK_LOG_SUBMIT=true, so
// RBAC denial cannot be triggered via the queue flow (unknown emails
// resolve to DESIGNER which is allowed). Instead, directly call handle()
// with a mock CLIENT actor (WORK_LOG_SUBMIT=false) to verify the guard fires.
// VW state must remain IN_PROGRESS, no FACT_WORK_LOGS row written.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogHandler_rbacDenial() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('wl-rbac');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testWorkLogHandler_rbacDenial', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // Submit via IntakeService to get a real queue item (use DESIGNER as submitter
    // so IntakeService accepts it — we replace the actor before calling handle()).
    var logResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        hours:      2.0,
        work_date:  TW_WORK_DATE
      },
      source: 'TEST'
    });

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: logResult.queueId },
      { callerModule: 'WorkLogHandlerTest' }
    );
    assertH_(results, counters, 'Queue item exists', queueItems.length > 0,
      'queueId=' + logResult.queueId);
    if (queueItems.length === 0) {
      results.push('  SKIP: cannot find queue item');
      counters.failed++;
      printResultsH_('testWorkLogHandler_rbacDenial', results, counters);
      return counters;
    }

    // CLIENT role has WORK_LOG_SUBMIT=false — use it to test the RBAC guard.
    // _rbacResolved:true is required by assertActorExists_() inside enforcePermission;
    // without it the error is ACTOR_NOT_RESOLVED, not PERMISSION_DENIED.
    var clientActor = {
      email:            'testclient@example.com',
      personCode:       'EXT',
      role:             'CLIENT',
      displayName:      'External Client',
      isActive:         true,
      canAccessBilling: false,
      _rbacResolved:    true
    };

    var rbacThrew = false;
    try {
      WorkLogHandler.handle(queueItems[0], clientActor);
    } catch (rbacErr) {
      rbacThrew = String(rbacErr.message || '').indexOf('PERMISSION_DENIED') !== -1;
    }

    assertH_(results, counters, 'RBAC denial: CLIENT actor rejected for WORK_LOG_SUBMIT',
      rbacThrew);

    // VW must be unchanged
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state unchanged (still IN_PROGRESS)',
      vw && vw.current_state === Config.STATES.IN_PROGRESS,
      vw ? vw.current_state : 'null');

    // No FACT_WORK_LOGS row written
    var logs = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    assertH_(results, counters, 'No FACT_WORK_LOGS row written after RBAC denial',
      logs.length === 0, 'rows found: ' + logs.length);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testWorkLogHandler_rbacDenial', results, counters);
  return counters;
}

// ============================================================
// TEST 3 — Invalid Payload
// hours field absent → ValidationEngine rejects before any state check
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogHandler_invalidPayload() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('wl-invalid');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testWorkLogHandler_invalidPayload', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // hours intentionally omitted (required field)
    var logResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        work_date:  TW_WORK_DATE,
        notes:      'missing hours field'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: logResult.queueId },
      { callerModule: 'WorkLogHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + logResult.queueId);
    assertH_(results, counters, 'Queue item not completed (validation failure)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // Setup job VW must be undisturbed
    var vw = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'Setup job VW state unchanged (still IN_PROGRESS)',
      vw && vw.current_state === Config.STATES.IN_PROGRESS,
      vw ? vw.current_state : 'null');

    // No FACT_WORK_LOGS row written
    var logs = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    assertH_(results, counters, 'No FACT_WORK_LOGS row written after validation failure',
      logs.length === 0, 'rows found: ' + logs.length);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testWorkLogHandler_invalidPayload', results, counters);
  return counters;
}

// ============================================================
// TEST 4 — Wrong State (job not found)
// Payload is schema-valid but job_number does not exist in
// VW_JOB_CURRENT_STATE — handler throws at Step 4 job-existence
// guard. ALLOCATED is non-terminal and would be accepted, so
// this test uses a ghost job number instead (see file header).
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogHandler_wrongState() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    clearStalePendingItems_();
    DAL._resetApiCallCount();

    // BLC-99999 matches the schema pattern but has no VW row
    var ghostJobNumber = 'BLC-99999';

    var logResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: ghostJobNumber,
        hours:      1.0,
        work_date:  TW_WORK_DATE,
        notes:      'wrong state — ghost job'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: logResult.queueId },
      { callerModule: 'WorkLogHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item exists', !!queueItem,
      'queueId=' + logResult.queueId);
    assertH_(results, counters, 'Queue item not completed (job not found in VW)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');
    assertH_(results, counters, 'Queue item error_message has retry metadata',
      queueItem && (String(queueItem.error_message || '').indexOf('attempt') !== -1 ||
                    String(queueItem.error_message || '').indexOf('exception') !== -1),
      queueItem ? String(queueItem.error_message) : 'no error_message');

    // Confirm ghost job has no VW entry and no FACT_WORK_LOGS row
    var ghostView = StateMachine.getJobView(ghostJobNumber);
    assertH_(results, counters, 'Ghost job has no VW entry',
      !ghostView, ghostView ? ghostView.current_state : 'correctly null');

    var logs = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: ghostJobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    assertH_(results, counters, 'No FACT_WORK_LOGS row written for ghost job',
      logs.length === 0, 'rows found: ' + logs.length);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testWorkLogHandler_wrongState', results, counters);
  return counters;
}

// ============================================================
// TEST 5 — Duplicate Queue Replay
// Submit work log via queue, then directly call handle() with
// the same queue item — second call must return 'DUPLICATE' and
// write no additional FACT_WORK_LOGS row.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogHandler_duplicate() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('wl-dupe');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testWorkLogHandler_duplicate', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // ── Step 1: Successful first log submission ──────────────
    var firstResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        hours:      4.0,
        work_date:  TW_WORK_DATE,
        notes:      'WorkLogHandlerTest duplicate'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var logsAfterFirst = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    var logCountBefore = 0;
    for (var i = 0; i < logsAfterFirst.length; i++) {
      if (logsAfterFirst[i].event_type === Constants.EVENT_TYPES.WORK_LOG_SUBMITTED) logCountBefore++;
    }
    assertH_(results, counters, 'Exactly 1 WORK_LOG_SUBMITTED row after first submission',
      logCountBefore === 1, 'count=' + logCountBefore);

    var vwAfterFirst = StateMachine.getJobView(jobNumber);
    assertH_(results, counters, 'VW state still IN_PROGRESS after first log',
      vwAfterFirst && vwAfterFirst.current_state === Config.STATES.IN_PROGRESS,
      vwAfterFirst ? vwAfterFirst.current_state : 'null');

    // ── Step 2: Directly re-call handle() with same queue item
    var firstQueueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: firstResult.queueId },
      { callerModule: 'WorkLogHandlerTest' }
    );
    if (firstQueueItems.length === 0) {
      results.push('  SKIP: cannot find original queue item for duplicate test');
      counters.failed++;
      printResultsH_('testWorkLogHandler_duplicate', results, counters);
      return counters;
    }

    var fakeActor  = RBAC.resolveActor(TH_DESIGNER_EMAIL);
    var dupeReturn = WorkLogHandler.handle(firstQueueItems[0], fakeActor);

    assertH_(results, counters, 'Direct re-handle() returns DUPLICATE',
      dupeReturn === 'DUPLICATE', 'returned: ' + dupeReturn);

    // ── Step 3: Row count must still be 1 ───────────────────
    var logsAfterDupe = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    var logCountAfter = 0;
    for (var j = 0; j < logsAfterDupe.length; j++) {
      if (logsAfterDupe[j].event_type === Constants.EVENT_TYPES.WORK_LOG_SUBMITTED) logCountAfter++;
    }
    assertH_(results, counters, 'Still exactly 1 WORK_LOG_SUBMITTED row after duplicate replay',
      logCountAfter === 1, 'count=' + logCountAfter);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testWorkLogHandler_duplicate', results, counters);
  return counters;
}

// ============================================================
// TEST 6 — Content-based Duplicate Guard
// Submit identical job+date+hours twice via the full queue flow
// (two distinct queue_ids, so queue-level idempotency does not
// fire). Second must be silently skipped; FACT_WORK_LOGS must
// still contain exactly 1 WORK_LOG_SUBMITTED row for the job.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogHandler_contentDuplicate() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('wl-content-dupe');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testWorkLogHandler_contentDuplicate', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // ── First submission — must succeed ─────────────────────
    IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        hours:      5.0,
        work_date:  TW_WORK_DATE,
        notes:      'WorkLogHandlerTest contentDuplicate first'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var logsAfterFirst = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    var countAfterFirst = 0;
    for (var i = 0; i < logsAfterFirst.length; i++) {
      if (logsAfterFirst[i].event_type === Constants.EVENT_TYPES.WORK_LOG_SUBMITTED) countAfterFirst++;
    }
    assertH_(results, counters, 'First submission written to FACT_WORK_LOGS',
      countAfterFirst === 1, 'count=' + countAfterFirst);

    // ── Second submission — same job + date + hours ──────────
    // Different queue_id → different idempotency key → queue-level
    // dedup does NOT fire. Content dedup guard should block this.
    var secondResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        hours:      5.0,
        work_date:  TW_WORK_DATE,
        notes:      'WorkLogHandlerTest contentDuplicate second'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    // Content dedup returns DUPLICATE_WORK_LOG (no throw) so queue item is COMPLETED
    var secondItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: secondResult.queueId },
      { callerModule: 'WorkLogHandlerTest' }
    );
    var secondItem = secondItems.length > 0 ? secondItems[0] : null;
    assertH_(results, counters, 'Content duplicate queue item processed without error',
      secondItem && secondItem.status === 'COMPLETED',
      secondItem ? secondItem.status : 'no item');

    // Row count must still be exactly 1
    var logsAfterSecond = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    var countAfterSecond = 0;
    for (var j = 0; j < logsAfterSecond.length; j++) {
      if (logsAfterSecond[j].event_type === Constants.EVENT_TYPES.WORK_LOG_SUBMITTED) countAfterSecond++;
    }
    assertH_(results, counters, 'No duplicate FACT_WORK_LOGS row written (content dedup blocked second)',
      countAfterSecond === 1, 'count=' + countAfterSecond);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testWorkLogHandler_contentDuplicate', results, counters);
  return counters;
}

// ============================================================
// TEST 7 — Daily Hours Cap
// Log 14h on TW_WORK_DATE_CAP via the queue, then attempt 4h
// more on the same date (total 18h > 16h cap). Handler must
// throw; queue item stays non-COMPLETED; only the first
// WORK_LOG_SUBMITTED row must exist in FACT_WORK_LOGS.
//
// TW_WORK_DATE_CAP is a separate date to avoid accumulation
// from other tests that also use TH_DESIGNER_CODE.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testWorkLogHandler_dailyCap() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var jobNumber = thSetupInProgressJob_('wl-cap');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testWorkLogHandler_dailyCap', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    // ── First submission: 14h — must succeed ────────────────
    IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        hours:      14,
        work_date:  TW_WORK_DATE_CAP,
        notes:      'WorkLogHandlerTest dailyCap first (14h)'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var logsAfterFirst = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    var countAfterFirst = 0;
    for (var i = 0; i < logsAfterFirst.length; i++) {
      if (logsAfterFirst[i].event_type === Constants.EVENT_TYPES.WORK_LOG_SUBMITTED) countAfterFirst++;
    }
    assertH_(results, counters, '14h first submission written to FACT_WORK_LOGS',
      countAfterFirst === 1, 'count=' + countAfterFirst);

    // ── Second submission: 4h — must be rejected by daily cap
    var capResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.WORK_LOG,
      submitterEmail: TH_DESIGNER_EMAIL,
      payload: {
        job_number: jobNumber,
        hours:      4,
        work_date:  TW_WORK_DATE_CAP,
        notes:      'WorkLogHandlerTest dailyCap second (4h — should be rejected)'
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var capItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: capResult.queueId },
      { callerModule: 'WorkLogHandlerTest' }
    );
    var capItem = capItems.length > 0 ? capItems[0] : null;
    assertH_(results, counters, 'Cap-exceeded queue item not completed (handler threw)',
      capItem && capItem.status !== 'COMPLETED',
      capItem ? capItem.status : 'no item');
    assertH_(results, counters, 'Cap error message mentions 16-hour limit',
      capItem && String(capItem.error_message || '').indexOf('16 hours') !== -1,
      capItem ? String(capItem.error_message) : 'no error_message');

    // FACT_WORK_LOGS must still have exactly 1 WORK_LOG_SUBMITTED row
    var logsAfterCap = DAL.readWhere(
      Config.TABLES.FACT_WORK_LOGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'WorkLogHandlerTest' }
    );
    var countAfterCap = 0;
    for (var j = 0; j < logsAfterCap.length; j++) {
      if (logsAfterCap[j].event_type === Constants.EVENT_TYPES.WORK_LOG_SUBMITTED) countAfterCap++;
    }
    assertH_(results, counters, 'No over-cap FACT_WORK_LOGS row written (daily cap blocked second)',
      countAfterCap === 1, 'count=' + countAfterCap);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testWorkLogHandler_dailyCap', results, counters);
  return counters;
}

// ============================================================
// RUNNER — executes all 7 tests and prints combined summary
// ============================================================

/**
 * Run all WorkLog tests and return aggregate counters.
 * Called by runV3HandlerTests() in TestHarness.gs.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runWorkLogTests() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  WORK LOG HANDLER TEST SUITE (7 tests)');
  console.log('═══════════════════════════════════════════════════════');

  seedTestStaff();

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testWorkLogHandler_happyPath,
    testWorkLogHandler_rbacDenial,
    testWorkLogHandler_invalidPayload,
    testWorkLogHandler_wrongState,
    testWorkLogHandler_duplicate,
    testWorkLogHandler_contentDuplicate,
    testWorkLogHandler_dailyCap
  ];

  for (var i = 0; i < tests.length; i++) {
    DAL._resetApiCallCount();
    var c = tests[i]();
    suiteCounters.passed += c.passed;
    suiteCounters.failed += c.failed;
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SUITE TOTAL — passed: ' + suiteCounters.passed +
              '  failed: ' + suiteCounters.failed);
  if (suiteCounters.failed === 0) {
    console.log('  ✅  ALL TESTS PASSED — ready to commit');
  } else {
    console.log('  ❌  ' + suiteCounters.failed + ' test(s) failed — fix before commit');
  }
  console.log('═══════════════════════════════════════════════════════');

  return suiteCounters;
}
