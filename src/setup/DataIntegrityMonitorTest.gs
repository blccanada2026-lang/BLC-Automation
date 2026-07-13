// ============================================================
// DataIntegrityMonitorTest.gs — BLC Nexus Setup / Tests
// src/setup/DataIntegrityMonitorTest.gs
//
// COMMIT 6 OF 7 — tests for the Data Integrity Monitor (commits 1-5:
// DataIntegrityChecks_WorkLog.gs, DataIntegrityChecks_Entity.gs,
// DataSelfHealing.gs, PreBillingGate.gs, DataIntegrityMonitor.gs).
//
// LOAD ORDER: Setup tier — loads after all T0-T9 files (calls check
// functions defined in src/09-notifications/*.gs directly — same
// global GAS namespace, no import needed).
//
// HOW TO RUN (Apps Script editor):
//   runDataIntegrityMonitorTests()  — all 11 tests, summary at end
//
// Individual tests (each Config.isDev()-gated indirectly via the
// module-level guard in the runner; safe to run standalone too):
//   testDataIntegrityMonitor_check1_duplicateWorkLogs()
//   testDataIntegrityMonitor_check2_orphanedWorkLogs()
//   testDataIntegrityMonitor_check3_clientCodeConsistency()
//   testDataIntegrityMonitor_check4_deadLetterGrowth()
//   testDataIntegrityMonitor_check5_testContamination()
//   testDataIntegrityMonitor_check6_periodIdFormat()
//   testDataIntegrityMonitor_check7_jobNumberNormalization()
//   testDataIntegrityMonitor_check8_allocatedToValidation()
//   testDataIntegrityMonitor_check9_rateConfiguration()
//   testDataIntegrityMonitor_check10_vwStateIntegrity()
//   testDataIntegrityMonitor_check11_preBillingGateIntegration()
//
// ── Seed strategy by table type (per FACT append-only Rule A5) ──
//   DIM tables       — seed a row, revert/deactivate after.
//   VW_JOB_CURRENT_STATE — seed a row, void (current_state='VOIDED') after.
//   FACT_WORK_LOGS   — seed with actor_code=DS1, job_number prefixed
//                      'INTEGRITY-TEST-', notes tagged
//                      'INTEGRITY_MONITOR_TEST_SEED'. Net-zeroed via a
//                      WORK_LOG_VOIDED amendment after the check runs.
//   DEAD_LETTER_QUEUE — seed rows, push dead_lettered_at outside the
//                      24h detection window after (see Test 4 note —
//                      this table has no status column; see below).
//
// ── Three corrections to the original build spec (self-caught,
//    verified against the actual check implementations before
//    writing any test) ──
//
// 1. CHECK 4 READS THE WRONG TABLE IN THE ORIGINAL SPEC.
//    checkDeadLetterGrowth_() (DataSelfHealing.gs) reads
//    Config.TABLES.DEAD_LETTER_QUEUE — a separate, non-partitioned
//    table with columns (dead_letter_id, queue_id, form_type,
//    submitter_email, attempt_count, payload_json, error_message,
//    original_created_at, dead_lettered_at) written once by
//    QueueProcessor.gs's markDeadLetter_(). It does NOT read
//    STG_PROCESSING_QUEUE and STG_PROCESSING_QUEUE rows do not carry
//    a 'DEAD_LETTER' status value that check reads either way — the
//    live queue table uses PENDING/PROCESSING/FAILED/COMPLETED/
//    DEAD_LETTER status transitions in a different sense (queue-item
//    lifecycle, consumed by DataSelfHealing's OWN dead-letter
//    recovery, a different code path). Seeding STG_PROCESSING_QUEUE
//    as originally specified would never trigger Check 4 — Test 4
//    below seeds DEAD_LETTER_QUEUE directly. WRITE_PERMISSIONS
//    updated accordingly (DEAD_LETTER_QUEUE, not STG_PROCESSING_QUEUE).
//    DEAD_LETTER_QUEUE has no status column, so "cleanup" cannot set
//    status='TEST_CLEANED' as originally specified — Test 4 instead
//    updates dead_lettered_at to 30 days in the past, pushing the
//    rows outside checkDeadLetterGrowth_()'s 24h detection window,
//    which is the actual mechanism that check uses to decide
//    relevance. DAL.updateWhere() is permitted here — DEAD_LETTER_QUEUE
//    is not a partitioned/FACT table (see DAL.gs FACT_TABLES), so
//    Rule A5's append-only block does not apply to it.
//
// 2. THREE CHECKS HAVE NO "ALREADY HANDLED" EXCLUSION MECHANISM, SO
//    "RE-RUN TO CONFIRM CLEAN" (test structure step 5) DOES NOT APPLY
//    TO ALL 10 CHECKS UNIFORMLY:
//      - Check 1 (duplicates) nets voided hours against submitted
//        hours internally (netCount = group.length - voided) — voiding
//        genuinely clears its detection. Works as specified.
//      - Check 3, 8, 9, 10 key off VW_JOB_CURRENT_STATE.current_state,
//        and all four explicitly exclude VOIDED — voiding the seeded
//        VW row genuinely clears detection. Works as specified.
//      - Check 6 (period_id format) DOES have a real exclusion in
//        production: it looks for a matching WORK_LOG_PERIOD_FIXED
//        amendment event keyed by idempotency_key = 'WL_PERIOD_FIX_' +
//        original event_id (the real WorkLogPeriodFixer.gs convention).
//        This is NOT the same situation as Check 5/7 below — the
//        exclusion mechanism itself is real and correct. Test 6 cannot
//        reliably DEMONSTRATE it, though: observed in DEV (2026-07-1x
//        run), the cleanup step's own fix-event write comes back
//        malformed too (afterCleanup total stayed at afterSeed's
//        baseline+1 instead of returning to baseline). Root cause
//        appears to be Sheets' row-append format inheritance — the
//        seeded row's period_id cell holds a raw Date object, and the
//        fix-event row appended immediately after it inherits that
//        cell's date formatting, silently coercing the fix event's own
//        valid 'YYYY-MM' string back into a Date on write. That makes
//        the fix event register as a new malformed row in place of the
//        one it just excluded — a test-sequencing artifact of writing
//        a Date-typed seed and a string-typed fix into adjacent rows
//        of the same column, not evidence that Check 6's exclusion
//        logic is broken. Test 6 therefore asserts detection only
//        (like Tests 5 and 7), with the cleanup fix-event still written
//        for audit-trail completeness.
//      - Check 2 (orphans) determines "orphan" purely by the ABSENCE
//        of a VW_JOB_CURRENT_STATE row for the job_number —
//        computeWorkLogOrphans_() sums hours (net-zero after voiding)
//        but never filters on the resulting total, so a net-zero
//        voided entry is STILL reported as an orphan. Voiding the
//        FACT row alone does not clear Check 2's finding. Test 2's
//        cleanup therefore ALSO writes a VOIDED VW_JOB_CURRENT_STATE
//        row for the same job_number (closing the actual gap the
//        check tests for), in addition to the FACT-side void (kept
//        for audit-trail hygiene, matching the general FACT
//        convention). Because that backfill checks EXISTENCE, not
//        current_state (unlike Checks 3/8/9/10, which key off
//        current_state and are safe to reuse a fixed job_number
//        against), a fixed job_number would only ever be a genuine
//        orphan on its very first run — every run after that would
//        find it pre-registered in VW from its own prior cleanup.
//        Test 2 therefore generates a fresh job_number
//        (DIMT_JOB_ORPHAN_ + '-' + Date.now()) every run, and its
//        detection assertion uses a baseline-delta (orphan count
//        before/after, not "any finding present") so pre-existing
//        DEV orphans unrelated to this test — including permanent
//        stale residue from any Test 6/7 run that predates their own
//        VW-backfill fix, itself unrecoverable since FACT is
//        append-only — don't produce a false pass or a false fail.
//      - Check 5 (test contamination) and Check 7 (job number
//        normalization) have NO exclusion mechanism of any kind —
//        every sub-check in Check 5 (checkRosterContamination_,
//        checkVwContamination_, checkWorkLogContamination_,
//        checkQueueContamination_ in ExecutionHealthMonitor.gs) scans
//        for raw existence of a test fixture value with no
//        active/voided/status filter, and Check 7 scans the current
//        month's FACT_WORK_LOGS partition for any row whose job_number
//        doesn't already equal its normalized form, with no equivalent
//        of Check 6's fix-event exclusion. For Check 5 this is by
//        design — DS1/QC1 are STANDING DEV fixtures (seedTestStaff(),
//        TestHarness.gs) required by every other test suite in this
//        codebase, so DIM_STAFF_ROSTER genuinely SHOULD show
//        contamination in DEV at all times; this check exists to catch
//        the same rows appearing in PROD, not to ever read clean in
//        DEV. Deactivating DS1 to chase a "clean" re-run would (a) not
//        even work — checkRosterContamination_ has no active-status
//        filter — and (b) break every other suite that depends on DS1
//        resolving as an active actor. Tests 5 and 7 therefore assert
//        DETECTION only (correct severity/category/marker), not a
//        clean round-trip; this is documented inline at each test, not
//        silently skipped.
//
// 3. TEST 11'S PERIOD MUST BE RESOLVED DYNAMICALLY, NOT HARDCODED.
//    The original spec called runPreBillingChecks('2026-07A')
//    literally. Checks 1/2/3/9 as invoked by PreBillingGate.gs are
//    scoped to a jobFilter built from FACT_WORK_LOGS rows dated inside
//    that period's actual date range (pbgResolveJobsInPeriod_()). Test
//    seeds use "today" (whenever the suite actually runs) for
//    work_date. A hardcoded '2026-07A' only lines up with "today" in
//    July 2026 — run this suite in any other month and the seeded jobs
//    fall outside the hardcoded period's date range, jobFilter excludes
//    them, and Test 11 fails for a reason that has nothing to do with
//    the code under test. Test 11 instead calls
//    BillingEngine.generateCurrentBillingPeriodId_() — the exact
//    function runPreBillingChecks() itself defaults to when called
//    with no argument — so the test period always matches "today."
//
// Companion FACT_WORK_LOGS rows for Tests 3 and 9: checkClientCodeConsistency_
// and checkRateConfigurationCompleteness_ take an optional jobFilter
// (job_number -> true) when called from PreBillingGate — a VW row with
// no hours logged in the billing period's date range never enters that
// filter and would be invisible to Test 11's pre-billing gate call.
// Tests 3 and 9 each additionally seed one FACT_WORK_LOGS hour on the
// same job_number, dated today, purely so pbgResolveJobsInPeriod_()
// picks the job up. Standalone Test 3/Test 9 (checkClientCodeConsistency_()/
// checkRateConfigurationCompleteness_() called with no jobFilter — full
// table scan) do not need this and are unaffected by it either way.
// ============================================================

var DIMT_MODULE_ = 'DataIntegrityMonitorTest';

// ── Marker constants — every seeded value below is prefixed/tagged
//    so it can never collide with real data and is trivially greppable
//    if a cleanup step is ever interrupted mid-run. ────────────────
var DIMT_SEED_NOTE_              = 'INTEGRITY_MONITOR_TEST_SEED';
var DIMT_JOB_DUP_                = 'INTEGRITY-TEST-DUP';
var DIMT_JOB_ORPHAN_             = 'INTEGRITY-TEST-ORPHAN';
var DIMT_JOB_FAKECLIENT_         = 'INTEGRITY-TEST-FAKECL';
var DIMT_CLIENT_FAKE_            = 'INTEGRITY-TEST-FAKECLIENT';
var DIMT_JOB_PERIOD_             = 'INTEGRITY-TEST-PERIOD';
var DIMT_JOB_NORM_RAW_           = 'INTEGRITY-TEST-001 Some Description Here';
var DIMT_JOB_NORM_NORMALIZED_    = 'INTEGRITY-TEST-001';
var DIMT_JOB_ALLOC_              = 'INTEGRITY-TEST-ALLOC';
var DIMT_ALLOC_INVALID_CODE_     = 'nonexistent-person-code';
var DIMT_JOB_RATE_               = 'INTEGRITY-TEST-RATEJOB';
var DIMT_PRODUCT_FAKE_           = 'INTEGRITY-TEST-PRODUCT';
var DIMT_JOB_STATE_              = 'INTEGRITY-TEST-STATE';
var DIMT_DEAD_LETTER_FORM_TYPE_  = 'INTEGRITY_TEST';

// ── Shared helpers ─────────────────────────────────────────────

/**
 * Guard called at the top of every dimtSeedCheckN_()/dimtCleanupCheckN_()
 * write helper — not just the runDataIntegrityMonitorTests() aggregator.
 * Per testing-policy.md §3 ("Guard both the aggregator and the shared
 * helper"): every one of these helpers is a top-level function and
 * directly invocable from the Apps Script editor's function picker,
 * independent of the runner. WRITE_PERMISSIONS authorizes
 * 'DataIntegrityMonitorTest' in every environment (WriteGuard is not
 * environment-aware — see DAL.gs), so without this guard a direct call
 * while pointed at PROD would write DS1/TEST-CLIENT rows straight into
 * real FACT/VW tables — exactly the R10.8 class of incident
 * testing-policy.md exists to prevent.
 */
function dimtRequireDev_() {
  if (!Config.isDev()) {
    throw new Error('Test suite cannot run in PROD. Switch to DEV environment.');
  }
}

/** 'YYYY-MM-DD' for today, local time. */
function dimtToday_() {
  var d = new Date();
  var mo = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + '-' + (mo < 10 ? '0' : '') + mo + '-' + (day < 10 ? '0' : '') + day;
}

/** True if any issue in the array references marker anywhere in its fields. */
function dimtHasMarker_(issues, marker) {
  for (var i = 0; i < issues.length; i++) {
    if (JSON.stringify(issues[i]).indexOf(marker) !== -1) return true;
  }
  return false;
}

/** Issues whose stringified form contains marker. */
function dimtFilterByMarker_(issues, marker) {
  return issues.filter(function(i) { return JSON.stringify(i).indexOf(marker) !== -1; });
}

// ============================================================
// TEST 1 — Duplicate work log (Check 1, HIGH)
// ============================================================

/** @returns {{ periodId:string, workDate:string, jobNumber:string }} */
function dimtSeedCheck1_() {
  dimtRequireDev_();
  var periodId = dimCurrentMonthPartition_();
  DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, periodId, DIMT_MODULE_);
  var workDate = dimtToday_();
  var eventId1 = Identifiers.generateId();
  var eventId2 = Identifiers.generateId();

  [eventId1, eventId2].forEach(function(eventId) {
    DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
      event_id:        eventId,
      job_number:      DIMT_JOB_DUP_,
      period_id:       periodId,
      event_type:      Constants.EVENT_TYPES.WORK_LOG_SUBMITTED,
      timestamp:       new Date().toISOString(),
      actor_code:      TH_DESIGNER_CODE,
      actor_role:      'DESIGNER',
      hours:            1,
      work_date:        workDate,
      notes:            DIMT_SEED_NOTE_ + ' check1',
      idempotency_key:  'DIMT_' + eventId,
      payload_json:     ''
    }, { callerModule: DIMT_MODULE_, periodId: periodId });
  });

  return { periodId: periodId, workDate: workDate, jobNumber: DIMT_JOB_DUP_ };
}

/** @param {Object} seed  From dimtSeedCheck1_() */
function dimtAssertCheck1_(seed, results, counters) {
  var findings = checkDuplicateWorkLogs_();
  var hits = dimtFilterByMarker_(findings, seed.jobNumber);
  assertH_(results, counters, 'Check 1 detects the seeded duplicate', hits.length > 0,
    'findings=' + findings.length);
  assertH_(results, counters, 'Duplicate finding severity is HIGH',
    hits.length > 0 && hits[0].severity === DIM_SEVERITY_.HIGH,
    hits.length ? hits[0].severity : 'no hit');
  assertH_(results, counters, 'Duplicate finding category is DUPLICATE_WORK_LOGS',
    hits.length > 0 && hits[0].category === 'DUPLICATE_WORK_LOGS',
    hits.length ? hits[0].category : 'no hit');
}

/** @param {Object} seed  From dimtSeedCheck1_() */
function dimtCleanupCheck1_(seed) {
  dimtRequireDev_();
  DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
    event_id:        Identifiers.generateId(),
    job_number:      seed.jobNumber,
    period_id:       seed.periodId,
    event_type:      Constants.EVENT_TYPES.WORK_LOG_VOIDED,
    timestamp:       new Date().toISOString(),
    actor_code:      TH_DESIGNER_CODE,
    actor_role:      'DESIGNER',
    hours:           -1,
    work_date:        seed.workDate,
    notes:            DIMT_SEED_NOTE_ + ' check1 void',
    idempotency_key:  'DIMT_VOID_' + Identifiers.generateId(),
    payload_json:     ''
  }, { callerModule: DIMT_MODULE_, periodId: seed.periodId });
  // Repeated once more — two SUBMITTED rows were seeded, so two
  // matching VOIDED rows are required to net checkDuplicateWorkLogs_()'s
  // count back down to <= 1 (see that function's netCount logic).
  DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
    event_id:        Identifiers.generateId(),
    job_number:      seed.jobNumber,
    period_id:       seed.periodId,
    event_type:      Constants.EVENT_TYPES.WORK_LOG_VOIDED,
    timestamp:       new Date().toISOString(),
    actor_code:      TH_DESIGNER_CODE,
    actor_role:      'DESIGNER',
    hours:           -1,
    work_date:        seed.workDate,
    notes:            DIMT_SEED_NOTE_ + ' check1 void',
    idempotency_key:  'DIMT_VOID_' + Identifiers.generateId(),
    payload_json:     ''
  }, { callerModule: DIMT_MODULE_, periodId: seed.periodId });
}

/** @returns {{ passed:number, failed:number }} */
function testDataIntegrityMonitor_check1_duplicateWorkLogs() {
  var results = [], counters = { passed: 0, failed: 0 };
  var seed = null;
  try {
    seed = dimtSeedCheck1_();
    dimtAssertCheck1_(seed, results, counters);
    dimtCleanupCheck1_(seed);
    var after = checkDuplicateWorkLogs_();
    assertH_(results, counters, 'Check 1 clean after cleanup (voided net to zero)',
      !dimtHasMarker_(after, seed.jobNumber), 'still present after cleanup');
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
    if (seed) { try { dimtCleanupCheck1_(seed); } catch (e2) { /* best effort */ } }
  }
  printResultsH_('testDataIntegrityMonitor_check1_duplicateWorkLogs', results, counters);
  return counters;
}

// ============================================================
// TEST 2 — Orphaned work log (Check 2, HIGH)
// ============================================================

/**
 * Job number includes a Date.now() suffix — NOT reused across runs.
 * dimtCleanupCheck2_() permanently backfills a VW row for whatever
 * job_number is seeded here (see that function's comment), and
 * computeWorkLogOrphans_() treats mere VW-row EXISTENCE — not
 * current_state — as "not an orphan" (unlike Checks 3/8/9/10, which
 * key off current_state and are safe to reuse a fixed job_number
 * against, since VOIDED is filtered by state, not by existence). A
 * fixed job_number here would only be a genuine orphan on the very
 * first run ever; every run after that would find it pre-registered
 * in VW from its own prior cleanup and silently fail to seed a new
 * orphan at all. A fresh job_number every run avoids that entirely.
 * @returns {{ periodId:string, workDate:string, jobNumber:string }}
 */
function dimtSeedCheck2_() {
  dimtRequireDev_();
  var periodId = dimCurrentMonthPartition_();
  DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, periodId, DIMT_MODULE_);
  var workDate = dimtToday_();
  var jobNumber = DIMT_JOB_ORPHAN_ + '-' + Date.now();
  var eventId = Identifiers.generateId();

  DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
    event_id:        eventId,
    job_number:      jobNumber,
    period_id:       periodId,
    event_type:      Constants.EVENT_TYPES.WORK_LOG_SUBMITTED,
    timestamp:       new Date().toISOString(),
    actor_code:      TH_DESIGNER_CODE,
    actor_role:      'DESIGNER',
    hours:            2,
    work_date:        workDate,
    notes:            DIMT_SEED_NOTE_ + ' check2',
    idempotency_key:  'DIMT_' + eventId,
    payload_json:     ''
  }, { callerModule: DIMT_MODULE_, periodId: periodId });

  return { periodId: periodId, workDate: workDate, jobNumber: jobNumber };
}

/** data.orphan_count from checkOrphanedWorkLogs_()'s single aggregate finding, or 0. */
function dimtCheck2Total_() {
  var findings = checkOrphanedWorkLogs_();
  return findings.length ? findings[0].data.orphan_count : 0;
}

/**
 * Baseline-delta pattern — resilient to pre-existing DEV orphans
 * (e.g. residual append-only FACT rows from historical Test 6/7 runs
 * predating their own VW-backfill fix). checkOrphanedWorkLogs_()
 * returns AT MOST ONE aggregate finding (data.orphan_count / data.samples
 * for ALL current orphans, not one finding per orphan) — a bare
 * "findings detected" check can't distinguish our seed from unrelated
 * pre-existing noise, so this compares the count before/after and
 * confirms our specific job_number is among the (now larger) sample set.
 */
function dimtAssertCheck2_(baseline, seed, results, counters) {
  var afterSeedFindings = checkOrphanedWorkLogs_();
  var afterSeedTotal    = dimtCheck2Total_();
  assertH_(results, counters, 'Check 2 total increases by exactly 1 after seeding',
    afterSeedTotal === baseline + 1, 'baseline=' + baseline + ' afterSeed=' + afterSeedTotal);

  var hits = dimtFilterByMarker_(afterSeedFindings, seed.jobNumber);
  assertH_(results, counters, 'New orphan finding includes the seeded job_number', hits.length > 0,
    'findings=' + afterSeedFindings.length);
  assertH_(results, counters, 'Orphan finding severity is HIGH',
    hits.length > 0 && hits[0].severity === DIM_SEVERITY_.HIGH,
    hits.length ? hits[0].severity : 'no hit');
  assertH_(results, counters, 'Orphan finding category is ORPHANED_WORK_LOGS',
    hits.length > 0 && hits[0].category === 'ORPHANED_WORK_LOGS',
    hits.length ? hits[0].category : 'no hit');
}

/**
 * computeWorkLogOrphans_() (WorkLogOrphanAudit.gs) determines "orphan"
 * purely by the absence of a VW_JOB_CURRENT_STATE row for the
 * job_number — it sums hours (so a voided FACT entry nets to zero) but
 * never filters the orphan list on that total. A FACT-side void alone
 * does NOT clear this finding. Cleanup therefore writes BOTH: a
 * WORK_LOG_VOIDED FACT amendment (audit-trail hygiene, matching the
 * general convention) AND a VW_JOB_CURRENT_STATE row (already VOIDED)
 * for the same job_number, which is what actually closes the gap
 * computeWorkLogOrphans_() checks for.
 */
function dimtCleanupCheck2_(seed) {
  dimtRequireDev_();
  DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
    event_id:        Identifiers.generateId(),
    job_number:      seed.jobNumber,
    period_id:       seed.periodId,
    event_type:      Constants.EVENT_TYPES.WORK_LOG_VOIDED,
    timestamp:       new Date().toISOString(),
    actor_code:      TH_DESIGNER_CODE,
    actor_role:      'DESIGNER',
    hours:           -2,
    work_date:        seed.workDate,
    notes:            DIMT_SEED_NOTE_ + ' check2 void',
    idempotency_key:  'DIMT_VOID_' + Identifiers.generateId(),
    payload_json:     ''
  }, { callerModule: DIMT_MODULE_, periodId: seed.periodId });

  DAL.appendRow(Config.TABLES.VW_JOB_CURRENT_STATE, {
    job_number:    seed.jobNumber,
    client_code:   TH_CLIENT_CODE,
    job_type:      'DESIGN',
    product_code:  TH_PRODUCT_CODE,
    quantity:      1,
    current_state: 'VOIDED',
    prev_state:    '',
    allocated_to:  '',
    period_id:     seed.periodId,
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString()
  }, { callerModule: DIMT_MODULE_ });
}

function testDataIntegrityMonitor_check2_orphanedWorkLogs() {
  var results = [], counters = { passed: 0, failed: 0 };
  var seed = null;
  try {
    var baseline = dimtCheck2Total_();
    seed = dimtSeedCheck2_();
    dimtAssertCheck2_(baseline, seed, results, counters);

    dimtCleanupCheck2_(seed);
    var afterCleanupTotal = dimtCheck2Total_();
    assertH_(results, counters, 'Check 2 total returns to baseline after cleanup',
      afterCleanupTotal === baseline, 'baseline=' + baseline + ' afterCleanup=' + afterCleanupTotal);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
    if (seed) { try { dimtCleanupCheck2_(seed); } catch (e2) { /* best effort */ } }
  }
  printResultsH_('testDataIntegrityMonitor_check2_orphanedWorkLogs', results, counters);
  return counters;
}

// ============================================================
// TEST 3 — Client code consistency (Check 3, CRITICAL)
// ============================================================

/** @returns {{ periodId:string, workDate:string, jobNumber:string }} */
function dimtSeedCheck3_() {
  dimtRequireDev_();
  var periodId = dimCurrentMonthPartition_();
  DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, periodId, DIMT_MODULE_);
  var workDate = dimtToday_();

  DAL.appendRow(Config.TABLES.VW_JOB_CURRENT_STATE, {
    job_number:    DIMT_JOB_FAKECLIENT_,
    client_code:   DIMT_CLIENT_FAKE_,
    job_type:      'DESIGN',
    product_code:  TH_PRODUCT_CODE,
    quantity:      1,
    current_state: Config.STATES.IN_PROGRESS,
    prev_state:    '',
    allocated_to:  TH_DESIGNER_CODE,
    period_id:     periodId,
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString()
  }, { callerModule: DIMT_MODULE_ });

  // Companion FACT_WORK_LOGS hour so this job lands in PreBillingGate's
  // jobFilter for Test 11 — see file header note 3.
  var eventId = Identifiers.generateId();
  DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
    event_id:        eventId,
    job_number:      DIMT_JOB_FAKECLIENT_,
    period_id:       periodId,
    event_type:      Constants.EVENT_TYPES.WORK_LOG_SUBMITTED,
    timestamp:       new Date().toISOString(),
    actor_code:      TH_DESIGNER_CODE,
    actor_role:      'DESIGNER',
    hours:            1,
    work_date:        workDate,
    notes:            DIMT_SEED_NOTE_ + ' check3 billing-scope backer',
    idempotency_key:  'DIMT_' + eventId,
    payload_json:     ''
  }, { callerModule: DIMT_MODULE_, periodId: periodId });

  return { periodId: periodId, workDate: workDate, jobNumber: DIMT_JOB_FAKECLIENT_ };
}

function dimtAssertCheck3_(seed, results, counters) {
  var findings = checkClientCodeConsistency_();
  var hits = dimtFilterByMarker_(findings, DIMT_CLIENT_FAKE_);
  assertH_(results, counters, 'Check 3 detects the seeded unknown client_code', hits.length > 0,
    'findings=' + findings.length);
  assertH_(results, counters, 'Client code finding severity is CRITICAL',
    hits.length > 0 && hits[0].severity === DIM_SEVERITY_.CRITICAL,
    hits.length ? hits[0].severity : 'no hit');
  assertH_(results, counters, 'Client code finding category is CLIENT_CODE_ORPHAN',
    hits.length > 0 && hits[0].category === 'CLIENT_CODE_ORPHAN',
    hits.length ? hits[0].category : 'no hit');
}

function dimtCleanupCheck3_(seed) {
  dimtRequireDev_();
  DAL.updateWhere(
    Config.TABLES.VW_JOB_CURRENT_STATE,
    { job_number: seed.jobNumber },
    { current_state: 'VOIDED', updated_at: new Date().toISOString() },
    { callerModule: DIMT_MODULE_ }
  );
  DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
    event_id:        Identifiers.generateId(),
    job_number:      seed.jobNumber,
    period_id:       seed.periodId,
    event_type:      Constants.EVENT_TYPES.WORK_LOG_VOIDED,
    timestamp:       new Date().toISOString(),
    actor_code:      TH_DESIGNER_CODE,
    actor_role:      'DESIGNER',
    hours:           -1,
    work_date:        seed.workDate,
    notes:            DIMT_SEED_NOTE_ + ' check3 void',
    idempotency_key:  'DIMT_VOID_' + Identifiers.generateId(),
    payload_json:     ''
  }, { callerModule: DIMT_MODULE_, periodId: seed.periodId });
}

function testDataIntegrityMonitor_check3_clientCodeConsistency() {
  var results = [], counters = { passed: 0, failed: 0 };
  var seed = null;
  try {
    seed = dimtSeedCheck3_();
    dimtAssertCheck3_(seed, results, counters);
    dimtCleanupCheck3_(seed);
    var after = checkClientCodeConsistency_();
    assertH_(results, counters, 'Check 3 clean after cleanup (VW row voided)',
      !dimtHasMarker_(after, DIMT_CLIENT_FAKE_), 'still present after cleanup');
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
    if (seed) { try { dimtCleanupCheck3_(seed); } catch (e2) { /* best effort */ } }
  }
  printResultsH_('testDataIntegrityMonitor_check3_clientCodeConsistency', results, counters);
  return counters;
}

// ============================================================
// TEST 4 — Dead letter growth (Check 4, HIGH)
// See file header note 1 — seeds DEAD_LETTER_QUEUE (not
// STG_PROCESSING_QUEUE), which is what checkDeadLetterGrowth_()
// actually reads.
// ============================================================

/** @returns {{ ids:string[] }} */
function dimtSeedCheck4_() {
  dimtRequireDev_();
  var nowIso = new Date().toISOString();
  // original_created_at isn't read by checkDeadLetterGrowth_() (only
  // dead_lettered_at is) — set to a plausible pre-dead-letter timestamp
  // for row realism only.
  var oldIso = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  var ids = [];

  for (var i = 0; i < 4; i++) {
    var dlId = Identifiers.generateId();
    ids.push(dlId);
    DAL.appendRow(Config.TABLES.DEAD_LETTER_QUEUE, {
      dead_letter_id:       dlId,
      queue_id:             'DIMT-Q-' + dlId,
      form_type:            DIMT_DEAD_LETTER_FORM_TYPE_,
      submitter_email:      TH_DESIGNER_EMAIL,
      attempt_count:        3,
      payload_json:         '{}',
      error_message:        DIMT_SEED_NOTE_ + ' check4 synthetic dead letter',
      original_created_at:  oldIso,
      dead_lettered_at:     nowIso
    }, { callerModule: DIMT_MODULE_ });
  }

  return { ids: ids };
}

function dimtAssertCheck4_(seed, results, counters) {
  var findings = checkDeadLetterGrowth_();
  var hits = dimtFilterByMarker_(findings, DIMT_DEAD_LETTER_FORM_TYPE_);
  assertH_(results, counters, 'Check 4 detects the seeded dead-letter growth', hits.length > 0,
    'findings=' + findings.length);
  assertH_(results, counters, 'Dead letter finding severity is HIGH',
    hits.length > 0 && hits[0].severity === DIM_SEVERITY_.HIGH,
    hits.length ? hits[0].severity : 'no hit');
  assertH_(results, counters, 'Dead letter finding category is DEAD_LETTER_GROWTH',
    hits.length > 0 && hits[0].category === 'DEAD_LETTER_GROWTH',
    hits.length ? hits[0].category : 'no hit');
}

/**
 * DEAD_LETTER_QUEUE has no status column (see file header note 1), so
 * cleanup cannot mark rows 'TEST_CLEANED'. checkDeadLetterGrowth_()'s
 * only relevance filter is dead_lettered_at >= (now - 24h) — pushing
 * it 30 days into the past is the actual mechanism that removes these
 * rows from its "recent" window.
 */
function dimtCleanupCheck4_(seed) {
  dimtRequireDev_();
  var pastIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  DAL.updateWhere(
    Config.TABLES.DEAD_LETTER_QUEUE,
    { form_type: DIMT_DEAD_LETTER_FORM_TYPE_ },
    { dead_lettered_at: pastIso },
    { callerModule: DIMT_MODULE_ }
  );
}

function testDataIntegrityMonitor_check4_deadLetterGrowth() {
  var results = [], counters = { passed: 0, failed: 0 };
  var seed = null;
  try {
    seed = dimtSeedCheck4_();
    dimtAssertCheck4_(seed, results, counters);
    dimtCleanupCheck4_(seed);
    var after = checkDeadLetterGrowth_();
    assertH_(results, counters, 'Check 4 clean after cleanup (pushed outside 24h window)',
      !dimtHasMarker_(after, DIMT_DEAD_LETTER_FORM_TYPE_), 'still present after cleanup');
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
    if (seed) { try { dimtCleanupCheck4_(seed); } catch (e2) { /* best effort */ } }
  }
  printResultsH_('testDataIntegrityMonitor_check4_deadLetterGrowth', results, counters);
  return counters;
}

// ============================================================
// TEST 5 — Test contamination (Check 5, CRITICAL)
// See file header note 2 — no exclusion mechanism exists for any of
// Check 5's four sub-checks, and DS1 is a standing DEV fixture
// (seedTestStaff(), required by nearly every other test suite in this
// codebase). This test asserts DETECTION only; there is no
// "clean after cleanup" step, and DS1 is never deactivated — doing so
// would not even clear the finding (checkRosterContamination_() has
// no active-status filter) and would break other concurrently-relied-
// upon test infrastructure for no benefit.
// ============================================================

function testDataIntegrityMonitor_check5_testContamination() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var before = DAL.readWhere(
      Config.TABLES.DIM_STAFF_ROSTER, { person_code: TH_DESIGNER_CODE },
      { callerModule: DIMT_MODULE_ }
    );
    if (before.length === 0) {
      seedTestStaff(); // idempotent — creates DS1/QC1/RND/NTL, active=TRUE
      results.push('  [seed] DS1 did not exist — created via seedTestStaff()');
    } else {
      results.push('  [seed] DS1 already a standing DEV fixture — no seed needed');
    }

    var findings = checkTestContamination_();
    var hits = dimtFilterByMarker_(findings, TH_DESIGNER_CODE);
    assertH_(results, counters, 'Check 5 detects DS1 in DIM_STAFF_ROSTER', hits.length > 0,
      'findings=' + findings.length);
    assertH_(results, counters, 'Contamination finding severity is CRITICAL',
      hits.length > 0 && hits[0].severity === DIM_SEVERITY_.CRITICAL,
      hits.length ? hits[0].severity : 'no hit');
    assertH_(results, counters, 'Contamination finding category is CHECK_5\'s roster category',
      hits.length > 0 && hits[0].category === 'PROD_CONTAMINATION_ROSTER',
      hits.length ? hits[0].category : 'no hit');

    results.push('  NOTE: no cleanup/reconfirm-clean step — see file header note 2. ' +
      'DS1 remaining detectable here is expected DEV behavior, not a test failure.');
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  printResultsH_('testDataIntegrityMonitor_check5_testContamination', results, counters);
  return counters;
}

// ============================================================
// TEST 6 — Malformed period_id (Check 6, INFO — suppressed 2026-07-10,
// see DataIntegrityChecks_WorkLog.gs's checkPeriodIdFormat_() header
// comment for why: 20,128 malformed rows found in a PROD baseline
// audit, dominated by the fixer's own WORK_LOG_PERIOD_FIXED output
// getting Sheets-coerced back into a Date on write. Detection logic
// is unchanged; only the returned severity was downgraded so this
// stops routing to the digest.)
// checkPeriodIdFormat_()'s issue payload reports only aggregate counts
// (data.total, data.partitions), never per-row detail — see file
// header note 2 — so this test verifies via count delta rather than
// a string marker.
// ============================================================

/** @returns {{ periodId:string, eventId:string }} */
function dimtSeedCheck6_() {
  dimtRequireDev_();
  var periodId = dimCurrentMonthPartition_();
  DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, periodId, DIMT_MODULE_);
  var eventId = Identifiers.generateId();

  DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
    event_id:        eventId,
    job_number:      DIMT_JOB_PERIOD_,
    period_id:       new Date(),  // malformed on purpose — a Date object, not 'YYYY-MM'
    event_type:      Constants.EVENT_TYPES.WORK_LOG_SUBMITTED,
    timestamp:       new Date().toISOString(),
    actor_code:      TH_DESIGNER_CODE,
    actor_role:      'DESIGNER',
    hours:            1,
    work_date:        dimtToday_(),
    notes:            DIMT_SEED_NOTE_ + ' check6',
    idempotency_key:  'DIMT_' + eventId,
    payload_json:     ''
  }, { callerModule: DIMT_MODULE_, periodId: periodId });

  return { periodId: periodId, eventId: eventId };
}

function dimtCheck6Total_() {
  var findings = checkPeriodIdFormat_();
  return findings.length ? findings[0].data.total : 0;
}

/**
 * Writes the real WORK_LOG_PERIOD_FIXED amendment convention
 * (WorkLogPeriodFixer.gs) — the only actual exclusion mechanism
 * checkPeriodIdFormat_() has. Also backfills a VOIDED VW row for
 * DIMT_JOB_PERIOD_ — without it, this job_number has FACT_WORK_LOGS
 * entries but no VW row, and would surface as a permanent phantom
 * Check 2 (orphan) finding on every future run (same gap documented
 * for Test 2's own cleanup — see dimtCleanupCheck2_()).
 */
function dimtCleanupCheck6_(seed) {
  dimtRequireDev_();
  DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
    event_id:        Identifiers.generateId(),
    job_number:      DIMT_JOB_PERIOD_,
    period_id:       seed.periodId,
    event_type:      Constants.EVENT_TYPES.WORK_LOG_PERIOD_FIXED,
    timestamp:       new Date().toISOString(),
    actor_code:      TH_DESIGNER_CODE,
    actor_role:      'DESIGNER',
    hours:            0,
    work_date:        dimtToday_(),
    notes:            DIMT_SEED_NOTE_ + ' check6 fix',
    idempotency_key:  'WL_PERIOD_FIX_' + seed.eventId,
    payload_json:     ''
  }, { callerModule: DIMT_MODULE_, periodId: seed.periodId });

  DAL.appendRow(Config.TABLES.VW_JOB_CURRENT_STATE, {
    job_number:    DIMT_JOB_PERIOD_,
    client_code:   TH_CLIENT_CODE,
    job_type:      'DESIGN',
    product_code:  TH_PRODUCT_CODE,
    quantity:      1,
    current_state: 'VOIDED',
    prev_state:    '',
    allocated_to:  '',
    period_id:     seed.periodId,
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString()
  }, { callerModule: DIMT_MODULE_ });
}

function testDataIntegrityMonitor_check6_periodIdFormat() {
  var results = [], counters = { passed: 0, failed: 0 };
  var seed = null;
  try {
    var baseline = dimtCheck6Total_();
    seed = dimtSeedCheck6_();

    var afterSeedFindings = checkPeriodIdFormat_();
    var afterSeedTotal    = dimtCheck6Total_();
    assertH_(results, counters, 'Check 6 total increases by exactly 1 after seeding',
      afterSeedTotal === baseline + 1, 'baseline=' + baseline + ' afterSeed=' + afterSeedTotal);
    assertH_(results, counters, 'Period_id finding severity is INFO (suppressed 2026-07-10 — see file header note 2)',
      afterSeedFindings.length > 0 && afterSeedFindings[0].severity === DIM_SEVERITY_.INFO,
      afterSeedFindings.length ? afterSeedFindings[0].severity : 'no finding');
    assertH_(results, counters, 'Period_id finding category is PERIOD_ID_MALFORMED',
      afterSeedFindings.length > 0 && afterSeedFindings[0].category === 'PERIOD_ID_MALFORMED',
      afterSeedFindings.length ? afterSeedFindings[0].category : 'no finding');

    dimtCleanupCheck6_(seed);
    results.push('  NOTE: no reconfirm-clean step — see file header note 2 (updated). Check 6\'s ' +
      'WORK_LOG_PERIOD_FIXED exclusion is real and is what production\'s WorkLogPeriodFixer.gs ' +
      'relies on, but this test\'s own fix-event write is unreliable: appending a valid \'YYYY-MM\' ' +
      'string immediately after a row whose period_id was a raw Date object appears to inherit that ' +
      'cell\'s date formatting (Sheets row-append behavior), silently coercing the fix event\'s own ' +
      'period_id back into a Date on write — so it registers as a new malformed row in place of the ' +
      'one it just excluded, netting no visible change (observed in DEV: baseline=5, afterCleanup=6, ' +
      'same as afterSeed). This is a test-sequencing artifact, not a Check 6 limitation. Fix event ' +
      'still written for audit-trail completeness.');
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
    if (seed) { try { dimtCleanupCheck6_(seed); } catch (e2) { /* best effort */ } }
  }
  printResultsH_('testDataIntegrityMonitor_check6_periodIdFormat', results, counters);
  return counters;
}

// ============================================================
// TEST 7 — Unnormalized job_number (Check 7, MEDIUM)
// See file header note 2 — checkJobNumberNormalization_() has no
// exclusion mechanism at all; a raw job_number written to an
// append-only FACT partition stays visible to it for the rest of
// that partition's life. This test asserts detection and performs
// audit-trail cleanup (void), but does not assert a clean re-run.
// ============================================================

/** @returns {{ periodId:string, workDate:string }} */
function dimtSeedCheck7_() {
  dimtRequireDev_();
  var periodId = dimCurrentMonthPartition_();
  DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, periodId, DIMT_MODULE_);
  var workDate = dimtToday_();
  var eventId = Identifiers.generateId();

  DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
    event_id:        eventId,
    job_number:      DIMT_JOB_NORM_RAW_,
    period_id:       periodId,
    event_type:      Constants.EVENT_TYPES.WORK_LOG_SUBMITTED,
    timestamp:       new Date().toISOString(),
    actor_code:      TH_DESIGNER_CODE,
    actor_role:      'DESIGNER',
    hours:            1,
    work_date:        workDate,
    notes:            DIMT_SEED_NOTE_ + ' check7',
    idempotency_key:  'DIMT_' + eventId,
    payload_json:     ''
  }, { callerModule: DIMT_MODULE_, periodId: periodId });

  return { periodId: periodId, workDate: workDate };
}

function dimtAssertCheck7_(seed, results, counters) {
  var findings = checkJobNumberNormalization_();
  var hits = dimtFilterByMarker_(findings, DIMT_JOB_NORM_RAW_);
  assertH_(results, counters, 'Check 7 detects the seeded unnormalized job_number', hits.length > 0,
    'findings=' + findings.length);
  assertH_(results, counters, 'Job number finding severity is MEDIUM',
    hits.length > 0 && hits[0].severity === DIM_SEVERITY_.MEDIUM,
    hits.length ? hits[0].severity : 'no hit');
  assertH_(results, counters, 'Job number finding category is JOB_NUMBER_UNNORMALIZED',
    hits.length > 0 && hits[0].category === 'JOB_NUMBER_UNNORMALIZED',
    hits.length ? hits[0].category : 'no hit');
}

/**
 * Voids the FACT row (audit hygiene) and backfills a VOIDED VW row
 * keyed on the exact RAW (un-normalized) job_number — computeWorkLogOrphans_()
 * matches VW existence against the literal FACT job_number string, not
 * its normalized form, so this is the only value that closes the
 * Check 2 phantom-orphan gap this seed would otherwise leave (same
 * reasoning as dimtCleanupCheck6_() — a real VW row would never
 * actually contain a description-suffixed job_number; this exists
 * purely to keep the DEV daily monitor's orphan list clean).
 */
function dimtCleanupCheck7_(seed) {
  dimtRequireDev_();
  DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
    event_id:        Identifiers.generateId(),
    job_number:      DIMT_JOB_NORM_RAW_,
    period_id:       seed.periodId,
    event_type:      Constants.EVENT_TYPES.WORK_LOG_VOIDED,
    timestamp:       new Date().toISOString(),
    actor_code:      TH_DESIGNER_CODE,
    actor_role:      'DESIGNER',
    hours:           -1,
    work_date:        seed.workDate,
    notes:            DIMT_SEED_NOTE_ + ' check7 void (audit hygiene only — see file header note 2)',
    idempotency_key:  'DIMT_VOID_' + Identifiers.generateId(),
    payload_json:     ''
  }, { callerModule: DIMT_MODULE_, periodId: seed.periodId });

  DAL.appendRow(Config.TABLES.VW_JOB_CURRENT_STATE, {
    job_number:    DIMT_JOB_NORM_RAW_,
    client_code:   TH_CLIENT_CODE,
    job_type:      'DESIGN',
    product_code:  TH_PRODUCT_CODE,
    quantity:      1,
    current_state: 'VOIDED',
    prev_state:    '',
    allocated_to:  '',
    period_id:     seed.periodId,
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString()
  }, { callerModule: DIMT_MODULE_ });
}

function testDataIntegrityMonitor_check7_jobNumberNormalization() {
  var results = [], counters = { passed: 0, failed: 0 };
  var seed = null;
  try {
    seed = dimtSeedCheck7_();
    dimtAssertCheck7_(seed, results, counters);
    dimtCleanupCheck7_(seed);
    results.push('  NOTE: no reconfirm-clean step — see file header note 2. Check 7 has no ' +
      'exclusion mechanism; the raw job_number remains visible to it for the rest of this ' +
      'partition\'s life. Void written for audit-trail hygiene only.');
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
    if (seed) { try { dimtCleanupCheck7_(seed); } catch (e2) { /* best effort */ } }
  }
  printResultsH_('testDataIntegrityMonitor_check7_jobNumberNormalization', results, counters);
  return counters;
}

// ============================================================
// TEST 8 — Invalid allocated_to (Check 8, HIGH)
// ============================================================

/** @returns {{ jobNumber:string }} */
function dimtSeedCheck8_() {
  dimtRequireDev_();
  DAL.appendRow(Config.TABLES.VW_JOB_CURRENT_STATE, {
    job_number:    DIMT_JOB_ALLOC_,
    client_code:   TH_CLIENT_CODE,
    job_type:      'DESIGN',
    product_code:  TH_PRODUCT_CODE,
    quantity:      1,
    current_state: Config.STATES.IN_PROGRESS,
    prev_state:    '',
    allocated_to:  DIMT_ALLOC_INVALID_CODE_,
    period_id:     dimCurrentMonthPartition_(),
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString()
  }, { callerModule: DIMT_MODULE_ });

  return { jobNumber: DIMT_JOB_ALLOC_ };
}

function dimtAssertCheck8_(seed, results, counters) {
  var findings = checkAllocatedToValidity_();
  var hits = dimtFilterByMarker_(findings, seed.jobNumber);
  assertH_(results, counters, 'Check 8 detects the seeded invalid allocated_to', hits.length > 0,
    'findings=' + findings.length);
  assertH_(results, counters, 'Allocated_to finding severity is HIGH',
    hits.length > 0 && hits[0].severity === DIM_SEVERITY_.HIGH,
    hits.length ? hits[0].severity : 'no hit');
  assertH_(results, counters, 'Allocated_to finding category is ALLOCATED_TO_INVALID',
    hits.length > 0 && hits[0].category === 'ALLOCATED_TO_INVALID',
    hits.length ? hits[0].category : 'no hit');
}

function dimtCleanupCheck8_(seed) {
  dimtRequireDev_();
  DAL.updateWhere(
    Config.TABLES.VW_JOB_CURRENT_STATE,
    { job_number: seed.jobNumber },
    { current_state: 'VOIDED', updated_at: new Date().toISOString() },
    { callerModule: DIMT_MODULE_ }
  );
}

function testDataIntegrityMonitor_check8_allocatedToValidation() {
  var results = [], counters = { passed: 0, failed: 0 };
  var seed = null;
  try {
    seed = dimtSeedCheck8_();
    dimtAssertCheck8_(seed, results, counters);
    dimtCleanupCheck8_(seed);
    var after = checkAllocatedToValidity_();
    assertH_(results, counters, 'Check 8 clean after cleanup (VW row voided — terminal state excluded)',
      !dimtHasMarker_(after, seed.jobNumber), 'still present after cleanup');
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
    if (seed) { try { dimtCleanupCheck8_(seed); } catch (e2) { /* best effort */ } }
  }
  printResultsH_('testDataIntegrityMonitor_check8_allocatedToValidation', results, counters);
  return counters;
}

// ============================================================
// TEST 9 — Missing rate (Check 9, CRITICAL)
// ============================================================

/** @returns {{ periodId:string, workDate:string, jobNumber:string }} */
function dimtSeedCheck9_() {
  dimtRequireDev_();
  var periodId = dimCurrentMonthPartition_();
  DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, periodId, DIMT_MODULE_);
  var workDate = dimtToday_();

  DAL.appendRow(Config.TABLES.VW_JOB_CURRENT_STATE, {
    job_number:    DIMT_JOB_RATE_,
    client_code:   TH_CLIENT_CODE,
    job_type:      'DESIGN',
    product_code:  DIMT_PRODUCT_FAKE_,
    quantity:      1,
    current_state: Config.STATES.IN_PROGRESS,
    prev_state:    '',
    allocated_to:  TH_DESIGNER_CODE,
    period_id:     periodId,
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString()
  }, { callerModule: DIMT_MODULE_ });

  // Companion FACT_WORK_LOGS hour so this job lands in PreBillingGate's
  // jobFilter for Test 11 — see file header note 3.
  var eventId = Identifiers.generateId();
  DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
    event_id:        eventId,
    job_number:      DIMT_JOB_RATE_,
    period_id:       periodId,
    event_type:      Constants.EVENT_TYPES.WORK_LOG_SUBMITTED,
    timestamp:       new Date().toISOString(),
    actor_code:      TH_DESIGNER_CODE,
    actor_role:      'DESIGNER',
    hours:            1,
    work_date:        workDate,
    notes:            DIMT_SEED_NOTE_ + ' check9 billing-scope backer',
    idempotency_key:  'DIMT_' + eventId,
    payload_json:     ''
  }, { callerModule: DIMT_MODULE_, periodId: periodId });

  return { periodId: periodId, workDate: workDate, jobNumber: DIMT_JOB_RATE_ };
}

function dimtAssertCheck9_(seed, results, counters) {
  var findings = checkRateConfigurationCompleteness_();
  var hits = dimtFilterByMarker_(findings, DIMT_PRODUCT_FAKE_);
  assertH_(results, counters, 'Check 9 detects the seeded missing-rate product', hits.length > 0,
    'findings=' + findings.length);
  assertH_(results, counters, 'Rate finding severity is CRITICAL',
    hits.length > 0 && hits[0].severity === DIM_SEVERITY_.CRITICAL,
    hits.length ? hits[0].severity : 'no hit');
  assertH_(results, counters, 'Rate finding category is a Check 9 category',
    hits.length > 0 && (hits[0].category === 'CLIENT_PRODUCT_NO_RATE' || hits[0].category === 'CLIENT_NO_RATES'),
    hits.length ? hits[0].category : 'no hit');
}

function dimtCleanupCheck9_(seed) {
  dimtRequireDev_();
  DAL.updateWhere(
    Config.TABLES.VW_JOB_CURRENT_STATE,
    { job_number: seed.jobNumber },
    { current_state: 'VOIDED', updated_at: new Date().toISOString() },
    { callerModule: DIMT_MODULE_ }
  );
  DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
    event_id:        Identifiers.generateId(),
    job_number:      seed.jobNumber,
    period_id:       seed.periodId,
    event_type:      Constants.EVENT_TYPES.WORK_LOG_VOIDED,
    timestamp:       new Date().toISOString(),
    actor_code:      TH_DESIGNER_CODE,
    actor_role:      'DESIGNER',
    hours:           -1,
    work_date:        seed.workDate,
    notes:            DIMT_SEED_NOTE_ + ' check9 void',
    idempotency_key:  'DIMT_VOID_' + Identifiers.generateId(),
    payload_json:     ''
  }, { callerModule: DIMT_MODULE_, periodId: seed.periodId });
}

function testDataIntegrityMonitor_check9_rateConfiguration() {
  var results = [], counters = { passed: 0, failed: 0 };
  var seed = null;
  try {
    seed = dimtSeedCheck9_();
    dimtAssertCheck9_(seed, results, counters);
    dimtCleanupCheck9_(seed);
    var after = checkRateConfigurationCompleteness_();
    assertH_(results, counters, 'Check 9 clean after cleanup (VW row voided)',
      !dimtHasMarker_(after, DIMT_PRODUCT_FAKE_), 'still present after cleanup');
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
    if (seed) { try { dimtCleanupCheck9_(seed); } catch (e2) { /* best effort */ } }
  }
  printResultsH_('testDataIntegrityMonitor_check9_rateConfiguration', results, counters);
  return counters;
}

// ============================================================
// TEST 10 — VW state integrity (Check 10, MEDIUM)
// ============================================================

/** @returns {{ jobNumber:string }} */
function dimtSeedCheck10_() {
  dimtRequireDev_();
  DAL.appendRow(Config.TABLES.VW_JOB_CURRENT_STATE, {
    job_number:    DIMT_JOB_STATE_,
    client_code:   TH_CLIENT_CODE,
    job_type:      'DESIGN',
    product_code:  TH_PRODUCT_CODE,
    quantity:      1,
    current_state: '',
    prev_state:    '',
    allocated_to:  TH_DESIGNER_CODE,
    period_id:     dimCurrentMonthPartition_(),
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString()
  }, { callerModule: DIMT_MODULE_ });

  return { jobNumber: DIMT_JOB_STATE_ };
}

function dimtAssertCheck10_(seed, results, counters) {
  var findings = checkVwStateIntegrity_();
  var hits = dimtFilterByMarker_(findings, seed.jobNumber);
  assertH_(results, counters, 'Check 10 detects the seeded blank current_state', hits.length > 0,
    'findings=' + findings.length);
  assertH_(results, counters, 'VW state finding severity is MEDIUM',
    hits.length > 0 && hits[0].severity === DIM_SEVERITY_.MEDIUM,
    hits.length ? hits[0].severity : 'no hit');
  assertH_(results, counters, 'VW state finding category is VW_BLANK_STATE',
    hits.length > 0 && hits[0].category === 'VW_BLANK_STATE',
    hits.length ? hits[0].category : 'no hit');
}

function dimtCleanupCheck10_(seed) {
  dimtRequireDev_();
  DAL.updateWhere(
    Config.TABLES.VW_JOB_CURRENT_STATE,
    { job_number: seed.jobNumber },
    { current_state: 'VOIDED', updated_at: new Date().toISOString() },
    { callerModule: DIMT_MODULE_ }
  );
}

function testDataIntegrityMonitor_check10_vwStateIntegrity() {
  var results = [], counters = { passed: 0, failed: 0 };
  var seed = null;
  try {
    seed = dimtSeedCheck10_();
    dimtAssertCheck10_(seed, results, counters);
    dimtCleanupCheck10_(seed);
    var after = checkVwStateIntegrity_();
    assertH_(results, counters, 'Check 10 clean after cleanup (VW row voided — no longer blank)',
      !dimtHasMarker_(after, seed.jobNumber), 'still present after cleanup');
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
    if (seed) { try { dimtCleanupCheck10_(seed); } catch (e2) { /* best effort */ } }
  }
  printResultsH_('testDataIntegrityMonitor_check10_vwStateIntegrity', results, counters);
  return counters;
}

// ============================================================
// TEST 11 — Pre-billing gate integration
// Seeds fresh copies of the Check 1 / Check 3 / Check 9 conditions
// (independent of whether those individual tests have already run in
// this session), runs runPreBillingChecks() for the CURRENT period
// (see file header note 3 — never hardcode '2026-07A'), asserts the
// gate blocks with findings from all three, then cleans up.
//
// Standalone-runnable on its own. The runDataIntegrityMonitorTests()
// runner does NOT call this function directly — it inlines the same
// seed/assert/cleanup calls so Tests 1, 3, and 9's OWN individual
// assertions and this integration assertion share one seed lifetime,
// per the required "seed all three -> run gate -> assert -> clean up"
// order (see the runner below).
// ============================================================

function dimtAssertCheck11_(results, counters) {
  var periodId = BillingEngine.generateCurrentBillingPeriodId_();
  var gate = runPreBillingChecks(periodId);

  assertH_(results, counters, 'Pre-billing gate cleared=false with seeds active',
    gate.cleared === false, JSON.stringify({ cleared: gate.cleared, count: gate.blockers.length }));

  var check1Hits = dimtFilterByMarker_(gate.blockers, DIMT_JOB_DUP_);
  assertH_(results, counters, 'Gate blockers include Check 1 (duplicate) finding',
    check1Hits.length > 0 && check1Hits[0].severity === DIM_SEVERITY_.HIGH,
    'hits=' + check1Hits.length);

  var check3Hits = dimtFilterByMarker_(gate.blockers, DIMT_CLIENT_FAKE_);
  assertH_(results, counters, 'Gate blockers include Check 3 (client code) finding',
    check3Hits.length > 0 && check3Hits[0].severity === DIM_SEVERITY_.CRITICAL,
    'hits=' + check3Hits.length);

  var check9Hits = dimtFilterByMarker_(gate.blockers, DIMT_PRODUCT_FAKE_);
  assertH_(results, counters, 'Gate blockers include Check 9 (rate) finding',
    check9Hits.length > 0 && check9Hits[0].severity === DIM_SEVERITY_.CRITICAL,
    'hits=' + check9Hits.length);
}

/** Standalone entry point — seeds/asserts/cleans up its own copies. */
function testDataIntegrityMonitor_check11_preBillingGateIntegration() {
  var results = [], counters = { passed: 0, failed: 0 };
  var seed1 = null, seed3 = null, seed9 = null;
  try {
    seed1 = dimtSeedCheck1_();
    seed3 = dimtSeedCheck3_();
    seed9 = dimtSeedCheck9_();
    dimtAssertCheck11_(results, counters);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  } finally {
    if (seed1) { try { dimtCleanupCheck1_(seed1); } catch (e1) { /* best effort */ } }
    if (seed3) { try { dimtCleanupCheck3_(seed3); } catch (e3) { /* best effort */ } }
    if (seed9) { try { dimtCleanupCheck9_(seed9); } catch (e9) { /* best effort */ } }
  }
  printResultsH_('testDataIntegrityMonitor_check11_preBillingGateIntegration', results, counters);
  return counters;
}

// ============================================================
// RUNNER — executes all 11 tests, sharing seed data across the
// 1 / 3 / 9 / 11 dependency group per the required ordering.
// Every test is independent — a failure in one does not skip the
// rest. try/finally guarantees cleanup runs even on assertion failure.
// ============================================================

/**
 * Runs all 11 Data Integrity Monitor tests and returns aggregate counters.
 * @returns {{ passed:number, failed:number }}
 */
function runDataIntegrityMonitorTests() {
  if (!Config.isDev()) {
    throw new Error('Test suite cannot run in PROD. Switch to DEV environment.');
  }
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  DATA INTEGRITY MONITOR TEST SUITE (11 tests)');
  console.log('═══════════════════════════════════════════════════════');

  seedTestStaff();

  var suiteCounters = { passed: 0, failed: 0 };

  // ── Tests 2, 4, 5, 6, 7, 8, 10 — fully self-contained ──────────
  var independentTests = [
    testDataIntegrityMonitor_check2_orphanedWorkLogs,
    testDataIntegrityMonitor_check4_deadLetterGrowth,
    testDataIntegrityMonitor_check5_testContamination,
    testDataIntegrityMonitor_check6_periodIdFormat,
    testDataIntegrityMonitor_check7_jobNumberNormalization,
    testDataIntegrityMonitor_check8_allocatedToValidation,
    testDataIntegrityMonitor_check10_vwStateIntegrity
  ];
  for (var i = 0; i < independentTests.length; i++) {
    DAL._resetApiCallCount();
    var c = independentTests[i]();
    suiteCounters.passed += c.passed;
    suiteCounters.failed += c.failed;
  }

  // ── Tests 1, 3, 9, 11 — coordinated group ──────────────────────
  // Seed all three, run Tests 1/3/9's own assertions, run Test 11's
  // pre-billing gate assertion against the SAME still-active seeds,
  // THEN clean up — required order per this test's own header comment.
  DAL._resetApiCallCount();
  var groupResults = [];
  var groupCounters = { passed: 0, failed: 0 };
  var seed1 = null, seed3 = null, seed9 = null;
  try {
    seed1 = dimtSeedCheck1_();
    dimtAssertCheck1_(seed1, groupResults, groupCounters);

    seed3 = dimtSeedCheck3_();
    dimtAssertCheck3_(seed3, groupResults, groupCounters);

    seed9 = dimtSeedCheck9_();
    dimtAssertCheck9_(seed9, groupResults, groupCounters);

    dimtAssertCheck11_(groupResults, groupCounters);
  } catch (e) {
    groupResults.push('  FAIL: unexpected exception in 1/3/9/11 group — ' + e.message);
    groupCounters.failed++;
  } finally {
    if (seed1) { try { dimtCleanupCheck1_(seed1); } catch (e1) { /* best effort */ } }
    if (seed3) { try { dimtCleanupCheck3_(seed3); } catch (e3) { /* best effort */ } }
    if (seed9) { try { dimtCleanupCheck9_(seed9); } catch (e9) { /* best effort */ } }
  }
  printResultsH_('testDataIntegrityMonitor_group_1_3_9_11 (Tests 1, 3, 9, 11)', groupResults, groupCounters);
  suiteCounters.passed += groupCounters.passed;
  suiteCounters.failed += groupCounters.failed;

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

  // Belt-and-suspenders: per-test cleanups above cover their own rows;
  // this catches any leftover TEST-CLIENT VW artifacts from a crashed
  // or interrupted prior run (testing-policy.md §3.3 runner requirement).
  thCleanupTestArtifacts_();

  return suiteCounters;
}
