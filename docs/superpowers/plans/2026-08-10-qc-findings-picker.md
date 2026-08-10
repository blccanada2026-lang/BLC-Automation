# QC Findings-Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a QC reviewer tag structured finding codes (from the already-seeded but unwired `DIM_QC_FINDING_TYPES`) when returning a job for `MINOR_REWORK`/`MAJOR_REWORK`, persisted to the already-designed but never-written `FACT_QC_FINDINGS` table.

**Architecture:** New `portal_getQcFindingTypes` read endpoint feeds a multi-select checkbox picker on the existing `#modal-qc-review` modal. `QCHandler.handleFlowB_` gains an early, blocking validation step (finding codes required + server-verified against `DIM_QC_FINDING_TYPES` for existence/active/product-applicability) and a late, isolated, non-rethrowing write step (one `FACT_QC_FINDINGS` row per code, linked to the `FACT_QC_EVENTS` row via a newly-generated `QS-` session id). Validation blocks the review (policy); the persistence write does not (infra) — a findings-write failure degrades to pre-feature behavior instead of stranding a job in `QC_REVIEW`.

**Tech Stack:** Google Apps Script (V8), vanilla JS DOM manipulation in GAS HtmlService, Google Sheets as the datastore via this repo's DAL.

**Reference:** Design spec — `docs/superpowers/specs/2026-08-10-qc-findings-picker-design.md` (advisor-reviewed, user-approved).

## Global Constraints

- R3 (CLAUDE.md): `RBAC.enforcePermission()` is the unconditional first statement in every handler — already true for `handleFlowB_`/`portal_getQcFindingTypes`, and no new code in this plan may run before it.
- A2/RULE A2 (`.claude/rules/core_rules.md`): all sheet access through `DAL` — no direct `SpreadsheetApp` calls.
- A5/RULE A5: `FACT_QC_FINDINGS` is append-only — this plan only ever appends, never updates/deletes it.
- RULE P2: writes of >1 row use `DAL.appendRows` (this codebase's actual batch-write function — **not** `BatchOperations.appendRows`, which does not exist as a separate module; `appendRows` is defined directly in `src/01-dal/DAL.gs:788` and exposed as `DAL.appendRows`).
- R10/`testing-policy.md`: every new test runner starts with `if (!Config.isDev()) { throw new Error(...) }`; only synthetic actors (`TH_DESIGNER_EMAIL`, `TH_QC_EMAIL` — already defined in `src/setup/TestHarness.gs`) and `TH_PRODUCT_CODE`/`TH_PERIOD_ID` are used, never real identities.
- T1 (`.claude/rules/testing.md`): happy path + RBAC denial + invalid input + duplicate submission, at minimum, for the handler change.
- Coding standards (`.claude/rules/coding-standards.md`): private helpers get a trailing underscore (`getFindingMeta_`); no `Logger.log`/`console.log` in production code paths (test runners' `console.log` for suite output is existing precedent, kept as-is).
- house style: no PROD deploy steps in this plan — `npm run push:prod` is a session-end action gated on user approval, out of scope here (per CLAUDE.md R4/R6, and this plan's own scope is DEV implementation + DEV verification only).

---

## Files Changed

| File | Change |
|---|---|
| `src/07-portal/Portal.gs` | New `portal_getQcFindingTypes(ptoken, productCode)`, inserted after `portal_getSopChecklist` (currently ends line 1104) |
| `src/01-dal/DAL.gs` | Line 129: `WRITE_PERMISSIONS['FACT_QC_FINDINGS']` gains `'QCHandler'` |
| `src/06-handlers/QCHandler.gs` | `QC_SUBMIT_SCHEMA` gains `finding_codes` (line 57-82); new `getFindingMeta_` helper; `handleFlowB_` (line 207+) gains early validation + late isolated write |
| `src/setup/QCHandlerTest.gs` | New tests 10-14 + new suite runner `runQCFindingsPickerTests()`, following the existing Test 6-9 (`runQCHandlerFlowTests`) pattern in the same file |
| `src/setup/TestHarness.gs` | Register suite 12 in `runV3HandlerTests()` (line ~401-415) |
| `src/07-portal/PortalView.html` | New checkbox-list block in `#modal-qc-review` (currently lines 1106-1130); `openQCReview()` populates it; `submitQCReview()` includes `finding_codes` |

---

## Task 1: Backend — `portal_getQcFindingTypes` read endpoint

**Files:**
- Modify: `src/07-portal/Portal.gs` (insert after line 1104, the closing `}` of `portal_getSopChecklist`)

**Interfaces:**
- Produces: `portal_getQcFindingTypes(ptoken, productCode)` → JSON string `{ findingTypes: [{ finding_code, finding_label, category }, ...] }`, sorted by `display_order` ascending. Consumed by Task 3's `openQCReview()`.

- [ ] **Step 1: Read `portal_getSopChecklist` once more for the exact auth/error pattern to mirror**

It's already open in context from the design phase (`src/07-portal/Portal.gs:1008-1041`): `PortalAuth.resolveEmail(ptoken)` → `RBAC.resolveActor(email)` → `RBAC.enforcePermission(actor, ...)` as the first three lines, unconditionally.

- [ ] **Step 2: Insert the new endpoint immediately after line 1104**

In `src/07-portal/Portal.gs`, insert this function immediately after the closing `}` of `portal_getSopChecklist` (currently line 1104):

```javascript

/**
 * Returns active QC finding types applicable to the given product,
 * for the multi-select finding-code picker on #modal-qc-review.
 * Filtering here is client-advisory only — QCHandler.handleFlowB_
 * re-validates server-side against the same table before any write.
 *
 * @param {string} ptoken
 * @param {string} productCode
 * @returns {string} JSON: { findingTypes: [{ finding_code, finding_label, category }] }
 */
function portal_getQcFindingTypes(ptoken, productCode) {
  var email = PortalAuth.resolveEmail(ptoken);
  var actor = RBAC.resolveActor(email);
  RBAC.enforcePermission(actor, RBAC.ACTIONS.QC_APPROVE);

  var rows;
  try {
    rows = DAL.readAll(Config.TABLES.DIM_QC_FINDING_TYPES, { callerModule: 'Portal' });
  } catch (e) {
    Logger.error('PORTAL_QC_FINDING_TYPES_READ_FAILED', { module: 'Portal', error: e.message });
    throw e;
  }

  var filtered = rows.filter(function (r) {
    return String(r.active_flag) === 'TRUE' &&
      (String(r.product_applicability) === 'ALL' || String(r.product_applicability) === String(productCode));
  });

  filtered.sort(function (a, b) {
    return (Number(a.display_order) || 0) - (Number(b.display_order) || 0);
  });

  var findingTypes = filtered.map(function (r) {
    return {
      finding_code:  r.finding_code,
      finding_label: r.finding_label,
      category:      r.category
    };
  });

  return JSON.stringify({ findingTypes: findingTypes });
}
```

- [ ] **Step 3: Manual DEV verification (no dedicated automated test — matches existing precedent)**

This repo's own precedent (SESSION_LOG.md, 2026-08-09→2026-08-10 session, W0-2): thin `portal_*` read wrappers are DEV/live-verified, not unit tested — `portal_getViewData`/`portal_getLeaderDashboard`/`portal_getMyHours`/`portal_getCEODashboard` shipped the same way. This endpoint is the same shape (RBAC check + one DAL read + filter/sort). Follow suit:

`portal_getQcFindingTypes` takes a `ptoken` (resolved to an email via `PortalAuth.resolveEmail`), not a raw email — a real `ptoken` only exists inside a live portal browser session, so it can't be called exactly as written from the Apps Script editor in isolation. Verify the underlying logic directly instead, bypassing only the token-resolution layer (everything after that line is the real, unmodified endpoint body):

```javascript
function _manualCheck_portalGetQcFindingTypes() {
  QcFindingTypes.seed(TH_QC_EMAIL);  // idempotent — ensures DIM_QC_FINDING_TYPES has rows
  var actor = RBAC.resolveActor(TH_QC_EMAIL);       // TH_QC_EMAIL has QC_APPROVE
  RBAC.enforcePermission(actor, RBAC.ACTIONS.QC_APPROVE);
  var rows = DAL.readAll(Config.TABLES.DIM_QC_FINDING_TYPES, { callerModule: 'Portal' });
  var filtered = rows.filter(function (r) {
    return String(r.active_flag) === 'TRUE' &&
      (String(r.product_applicability) === 'ALL' || String(r.product_applicability) === 'Alpine-iCommand');
  });
  console.log('findingTypes count: ' + filtered.length);
  console.log(JSON.stringify(filtered.map(function (r) { return r.finding_code; })));
}
```

This exercises the exact same RBAC call, DAL read, and filter predicate that `portal_getQcFindingTypes` itself runs — the only thing skipped is `PortalAuth.resolveEmail`, which has no logic of its own to verify (it's a token→email lookup, already exercised by every other `portal_*` endpoint in this codebase). The real end-to-end path — including token resolution — gets its actual verification in Task 4's browser walkthrough, where the picker's network call goes through the full stack with a genuine session token.

Confirm: no thrown error, `findingTypes count: 16` (all codes except `PLATE_ERROR`, since `'Alpine-iCommand'` isn't `'TRUSS'`), and the logged code list does not contain `PLATE_ERROR`.

- [ ] **Step 4: Commit**

```bash
git add src/07-portal/Portal.gs
git commit -m "feat(portal): add portal_getQcFindingTypes read endpoint"
```

---

## Task 2: Backend — `QCHandler.gs` validation + `FACT_QC_FINDINGS` write

**Files:**
- Modify: `src/01-dal/DAL.gs:129` (WRITE_PERMISSIONS)
- Modify: `src/06-handlers/QCHandler.gs:57-82` (schema), `:207+` (handleFlowB_), insert new `getFindingMeta_` helper
- Modify: `src/setup/QCHandlerTest.gs` (new tests 10-14 + suite runner, appended after the existing `runQCHandlerFlowTests` block at the end of the file)
- Modify: `src/setup/TestHarness.gs:401-415` (register suite 12)

**Interfaces:**
- Consumes: `Config.ID_PREFIXES.QC_SESSION` (`'QS'`) and `Config.ID_PREFIXES.QC_FINDING` (`'QF'`) — both already defined in `src/00-foundation/Config.gs:339,341`. `Identifiers.generatePrefixedId(prefix)` — already defined, `src/00-foundation/Identifiers.gs:58`.
- Produces: `getFindingMeta_(codes, productCode)` → `{ code: { severity: string } }`, throws on any unknown/inactive/inapplicable code. Consumed only within `handleFlowB_` in this task — no other file calls it.

- [ ] **Step 1: Add the DAL write permission (prerequisite for every later step in this task)**

In `src/01-dal/DAL.gs`, line 129, change:
```javascript
    'FACT_QC_FINDINGS':          ['QcReviewDAL'],
```
to:
```javascript
    'FACT_QC_FINDINGS':          ['QcReviewDAL', 'QCHandler'],
```

- [ ] **Step 2: Write the failing tests first**

Append this block to the very end of `src/setup/QCHandlerTest.gs` (after the closing of `runQCHandlerFlowTests` at line 941):

```javascript

// ============================================================
// FINDINGS-PICKER TESTS (W2-3) — Flow B finding_codes handling
//
// These tests are registered as suite 12 (runQCFindingsPickerTests)
// in runV3HandlerTests() in TestHarness.gs.
//
// HOW TO RUN (Apps Script editor):
//   runQCFindingsPickerTests()  — all 5 tests, summary at end
//
// Uses real DIM_QC_FINDING_TYPES codes (seeded via QcFindingTypes.seed()):
//   LOAD_ERROR, GEOMETRY_ERROR — severity_default CRITICAL/MAJOR, product_applicability ALL
//   PLATE_ERROR                — severity_default MAJOR, product_applicability TRUSS only
// Test jobs use TH_PRODUCT_CODE = 'Alpine-iCommand' (not TRUSS), so PLATE_ERROR
// is the natural "inapplicable to this job's product" case — no synthetic
// product code needed.
// ============================================================

// ============================================================
// TEST 10 — Findings happy path
// MINOR_REWORK with 2 valid ALL-applicability codes → FACT_QC_EVENTS
// row + 2 FACT_QC_FINDINGS rows, matching qc_session_id on both,
// correct severity per code.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCFindings_happyPath() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    QcFindingTypes.seed(TH_QC_EMAIL);

    var jobNumber = thSetupQCReviewJob_('findings-happy');
    assertH_(results, counters, 'Setup: job in QC_REVIEW', !!jobNumber,
      'jobNumber=' + jobNumber);
    if (!jobNumber) { results.push('  SKIP: setup failed'); return counters; }

    DAL._resetApiCallCount();

    var submitResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: TH_QC_EMAIL,
      payload: {
        job_number:    jobNumber,
        qc_result:     'MINOR_REWORK',
        rework_notes:  'QCFindings happyPath — load path and geometry both need correction',
        finding_codes: ['LOAD_ERROR', 'GEOMETRY_ERROR']
      },
      source: 'TEST'
    });
    assertH_(results, counters, 'IntakeService returns ok=true',
      submitResult.ok === true, JSON.stringify(submitResult));

    processQueueFresh_();

    // ── FACT_QC_EVENTS row has a qc_session_id ─────────────────
    var events = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    var minorEvent = null;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event_type === Constants.EVENT_TYPES.QC_MINOR_REWORK) { minorEvent = events[i]; break; }
    }
    assertH_(results, counters, 'FACT_QC_EVENTS has QC_MINOR_REWORK row', !!minorEvent,
      'event_types found: ' + events.map(function(e) { return e.event_type; }).join(','));
    assertH_(results, counters, 'QC_MINOR_REWORK has a qc_session_id (QS- prefixed)',
      minorEvent && String(minorEvent.qc_session_id || '').indexOf('QS-') === 0,
      minorEvent ? minorEvent.qc_session_id : 'null');

    // ── FACT_QC_FINDINGS has exactly 2 rows, correct linkage ───
    var findings = DAL.readWhere(
      Config.TABLES.FACT_QC_FINDINGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    assertH_(results, counters, 'FACT_QC_FINDINGS has exactly 2 rows', findings.length === 2,
      'count=' + findings.length);

    var byCode = {};
    findings.forEach(function (f) { byCode[f.finding_code] = f; });

    assertH_(results, counters, 'LOAD_ERROR finding row present', !!byCode.LOAD_ERROR);
    assertH_(results, counters, 'GEOMETRY_ERROR finding row present', !!byCode.GEOMETRY_ERROR);

    if (byCode.LOAD_ERROR) {
      assertH_(results, counters, 'LOAD_ERROR severity = CRITICAL',
        byCode.LOAD_ERROR.severity === 'CRITICAL', byCode.LOAD_ERROR.severity);
      assertH_(results, counters, 'LOAD_ERROR qc_session_id matches event',
        minorEvent && byCode.LOAD_ERROR.qc_session_id === minorEvent.qc_session_id,
        byCode.LOAD_ERROR.qc_session_id + ' vs ' + (minorEvent ? minorEvent.qc_session_id : 'null'));
      assertH_(results, counters, 'LOAD_ERROR comment = shared rework_notes text',
        byCode.LOAD_ERROR.comment === 'QCFindings happyPath — load path and geometry both need correction',
        byCode.LOAD_ERROR.comment);
      assertH_(results, counters, 'LOAD_ERROR reviewer_person_code = QC1',
        byCode.LOAD_ERROR.reviewer_person_code === TH_QC_CODE, byCode.LOAD_ERROR.reviewer_person_code);
    }
    if (byCode.GEOMETRY_ERROR) {
      assertH_(results, counters, 'GEOMETRY_ERROR severity = MAJOR',
        byCode.GEOMETRY_ERROR.severity === 'MAJOR', byCode.GEOMETRY_ERROR.severity);
      assertH_(results, counters, 'GEOMETRY_ERROR qc_session_id matches event',
        minorEvent && byCode.GEOMETRY_ERROR.qc_session_id === minorEvent.qc_session_id,
        byCode.GEOMETRY_ERROR.qc_session_id + ' vs ' + (minorEvent ? minorEvent.qc_session_id : 'null'));
    }

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCFindings_happyPath', results, counters);
  return counters;
}

// ============================================================
// TEST 11 — Missing finding codes rejected
// MINOR_REWORK with finding_codes omitted (or empty array) must be
// rejected the same way rework_notes-missing already is: queue item
// not completed, no FACT_QC_EVENTS row, no FACT_QC_FINDINGS row.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCFindings_missingCodes() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    QcFindingTypes.seed(TH_QC_EMAIL);

    var jobNumber = thSetupQCReviewJob_('findings-missing');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testQCFindings_missingCodes', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    var submitResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: TH_QC_EMAIL,
      payload: {
        job_number:   jobNumber,
        qc_result:    'MINOR_REWORK',
        rework_notes: 'QCFindings missingCodes — notes present, finding_codes intentionally omitted'
        // finding_codes omitted
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: submitResult.queueId },
      { callerModule: 'QCHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item not completed (missing finding_codes rejected)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');

    var events = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    var minorRows = events.filter(function (e) { return e.event_type === Constants.EVENT_TYPES.QC_MINOR_REWORK; });
    assertH_(results, counters, 'No QC_MINOR_REWORK row written', minorRows.length === 0,
      'count=' + minorRows.length);

    var findings = DAL.readWhere(
      Config.TABLES.FACT_QC_FINDINGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    assertH_(results, counters, 'No FACT_QC_FINDINGS rows written', findings.length === 0,
      'count=' + findings.length);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCFindings_missingCodes', results, counters);
  return counters;
}

// ============================================================
// TEST 12 — Unknown finding code rejected
// A code that doesn't exist in DIM_QC_FINDING_TYPES at all must be
// rejected by getFindingMeta_ before any FACT table is touched.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCFindings_unknownCode() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    QcFindingTypes.seed(TH_QC_EMAIL);

    var jobNumber = thSetupQCReviewJob_('findings-unknown');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testQCFindings_unknownCode', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    var submitResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: TH_QC_EMAIL,
      payload: {
        job_number:    jobNumber,
        qc_result:     'MAJOR_REWORK',
        rework_notes:  'QCFindings unknownCode — deliberately bad code',
        finding_codes: ['NOT_A_REAL_CODE']
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: submitResult.queueId },
      { callerModule: 'QCHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item not completed (unknown code rejected)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');

    var events = DAL.readWhere(
      Config.TABLES.FACT_QC_EVENTS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    var majorRows = events.filter(function (e) { return e.event_type === Constants.EVENT_TYPES.QC_MAJOR_REWORK; });
    assertH_(results, counters, 'No QC_MAJOR_REWORK row written', majorRows.length === 0,
      'count=' + majorRows.length);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCFindings_unknownCode', results, counters);
  return counters;
}

// ============================================================
// TEST 13 — Product-inapplicable code rejected server-side
// PLATE_ERROR (product_applicability='TRUSS') submitted directly
// against a job whose product_code is TH_PRODUCT_CODE
// ('Alpine-iCommand', not TRUSS) — bypasses the picker/endpoint
// filter entirely, proving the server-side check in getFindingMeta_
// isn't just cosmetic.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCFindings_productInapplicable() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    QcFindingTypes.seed(TH_QC_EMAIL);

    var jobNumber = thSetupQCReviewJob_('findings-inapplicable');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testQCFindings_productInapplicable', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    var submitResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: TH_QC_EMAIL,
      payload: {
        job_number:    jobNumber,
        qc_result:     'MINOR_REWORK',
        rework_notes:  'QCFindings productInapplicable — PLATE_ERROR on a non-TRUSS job',
        finding_codes: ['PLATE_ERROR']
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var queueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: submitResult.queueId },
      { callerModule: 'QCHandlerTest' }
    );
    var queueItem = queueItems.length > 0 ? queueItems[0] : null;
    assertH_(results, counters, 'Queue item not completed (PLATE_ERROR rejected for non-TRUSS job)',
      queueItem && queueItem.status !== 'COMPLETED',
      queueItem ? queueItem.status : 'null');

    var findings = DAL.readWhere(
      Config.TABLES.FACT_QC_FINDINGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    assertH_(results, counters, 'No FACT_QC_FINDINGS rows written', findings.length === 0,
      'count=' + findings.length);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCFindings_productInapplicable', results, counters);
  return counters;
}

// ============================================================
// TEST 14 — Duplicate replay does not double-write findings
// Submit MINOR_REWORK with finding codes once (success), then
// directly re-call handle() with the same queue item. Mirrors the
// existing testQCHandler_duplicate pattern (TEST 5) for Flow B.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQCFindings_duplicateReplay() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    QcFindingTypes.seed(TH_QC_EMAIL);

    var jobNumber = thSetupQCReviewJob_('findings-dupe');
    if (!jobNumber) {
      results.push('  SKIP: setup failed');
      counters.failed++;
      printResultsH_('testQCFindings_duplicateReplay', results, counters);
      return counters;
    }

    DAL._resetApiCallCount();

    var firstResult = IntakeService.processSubmission({
      formType:       Config.FORM_TYPES.QC_SUBMIT,
      submitterEmail: TH_QC_EMAIL,
      payload: {
        job_number:    jobNumber,
        qc_result:     'MINOR_REWORK',
        rework_notes:  'QCFindings duplicateReplay',
        finding_codes: ['LOAD_ERROR']
      },
      source: 'TEST'
    });
    processQueueFresh_();

    var findingsAfterFirst = DAL.readWhere(
      Config.TABLES.FACT_QC_FINDINGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    assertH_(results, counters, 'Exactly 1 FACT_QC_FINDINGS row after first submission',
      findingsAfterFirst.length === 1, 'count=' + findingsAfterFirst.length);

    var firstQueueItems = DAL.readWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: firstResult.queueId },
      { callerModule: 'QCHandlerTest' }
    );
    if (firstQueueItems.length === 0) {
      results.push('  SKIP: cannot find original queue item for duplicate test');
      counters.failed++;
      printResultsH_('testQCFindings_duplicateReplay', results, counters);
      return counters;
    }

    var fakeActor = RBAC.resolveActor(TH_QC_EMAIL);
    var secondThrew = false;
    var secondReturn;
    try {
      secondReturn = QCHandler.handle(firstQueueItems[0], fakeActor);
    } catch (routingError) {
      secondThrew = true;
    }

    assertH_(results, counters,
      'Second handle() threw or returned DUPLICATE (no second write)',
      secondThrew || secondReturn === 'DUPLICATE',
      secondThrew ? 'correctly threw' : 'returned: ' + secondReturn);

    var findingsAfterDupe = DAL.readWhere(
      Config.TABLES.FACT_QC_FINDINGS,
      { job_number: jobNumber },
      { periodId: TH_PERIOD_ID, callerModule: 'QCHandlerTest' }
    );
    assertH_(results, counters, 'Still exactly 1 FACT_QC_FINDINGS row after duplicate replay',
      findingsAfterDupe.length === 1, 'count=' + findingsAfterDupe.length);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQCFindings_duplicateReplay', results, counters);
  return counters;
}

// ============================================================
// RUNNER — suite 12: findings-picker tests
// ============================================================

/**
 * Run all QC findings-picker tests and return aggregate counters.
 * Registered as suite 12 in runV3HandlerTests() in TestHarness.gs.
 *
 * @returns {{ passed: number, failed: number }}
 */
function runQCFindingsPickerTests() {
  if (!Config.isDev()) {
    throw new Error('Test suite cannot run in PROD. Switch to DEV environment.');
  }
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  QC FINDINGS-PICKER TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');

  seedTestStaff();

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testQCFindings_happyPath,
    testQCFindings_missingCodes,
    testQCFindings_unknownCode,
    testQCFindings_productInapplicable,
    testQCFindings_duplicateReplay
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

  thCleanupTestArtifacts_();
  return suiteCounters;
}
```

- [ ] **Step 3: Register suite 12 in `TestHarness.gs`**

In `src/setup/TestHarness.gs`, change the `runV3HandlerTests` block (currently lines 401-415) from:
```javascript
function runV3HandlerTests() {
  runSuiteGroup_('1–11', [
    { name: '1 — JobCreateHandler',      fn: runJobCreateTests       },
    { name: '2 — JobAssignHandler',      fn: runJobAssignTests       },
    { name: '3 — JobStartHandler',       fn: runJobStartTests        },
    { name: '4 — JobHoldHandler',        fn: runJobHoldTests         },
    { name: '5 — JobResumeHandler',      fn: runJobResumeTests       },
    { name: '6 — WorkLogHandler',        fn: runWorkLogTests         },
    { name: '7 — QCHandler',             fn: runQCHandlerTests       },
    { name: '8 — JobUpdateHandler',      fn: runJobUpdateTests       },
    { name: '9 — QCHandler Flow B/C',    fn: runQCHandlerFlowTests   },
    { name: '10 — QCReassignHandler',    fn: runQCReassignTests      },
    { name: '11 — WorkLogCorrectionHandler', fn: runWorkLogCorrectionTests }
  ]);
}
```
to:
```javascript
function runV3HandlerTests() {
  runSuiteGroup_('1–12', [
    { name: '1 — JobCreateHandler',      fn: runJobCreateTests       },
    { name: '2 — JobAssignHandler',      fn: runJobAssignTests       },
    { name: '3 — JobStartHandler',       fn: runJobStartTests        },
    { name: '4 — JobHoldHandler',        fn: runJobHoldTests         },
    { name: '5 — JobResumeHandler',      fn: runJobResumeTests       },
    { name: '6 — WorkLogHandler',        fn: runWorkLogTests         },
    { name: '7 — QCHandler',             fn: runQCHandlerTests       },
    { name: '8 — JobUpdateHandler',      fn: runJobUpdateTests       },
    { name: '9 — QCHandler Flow B/C',    fn: runQCHandlerFlowTests   },
    { name: '10 — QCReassignHandler',    fn: runQCReassignTests      },
    { name: '11 — WorkLogCorrectionHandler', fn: runWorkLogCorrectionTests },
    { name: '12 — QC Findings Picker',   fn: runQCFindingsPickerTests }
  ]);
}
```

Also update the doc comment directly above (currently lines 393-400, the `runV3HandlerTests` JSDoc block) — change `Runs all 11 V3 handler test suites` to `Runs all 12 V3 handler test suites`, and add a line to the suite listing comment block near line 298:
```javascript
//   runQCFindingsPickerTests()   — suite  12   (~2 min, estimated)
```

- [ ] **Step 4: Run the new suite — confirm all 5 tests fail (function/table not defined yet)**

In the Apps Script editor: select `runQCFindingsPickerTests` and run it.
Expected: every test fails at `IntakeService.processSubmission` / `ValidationEngine.validate` time, or `assertH_` failures reporting "FACT_QC_FINDINGS has exactly 2 rows" got `count=0`, etc. — because `finding_codes` isn't recognized by `QC_SUBMIT_SCHEMA` yet and no `FACT_QC_FINDINGS` write exists. This confirms the tests actually exercise the new behavior rather than trivially passing.

- [ ] **Step 5: Add `finding_codes` to `QC_SUBMIT_SCHEMA`**

In `src/06-handlers/QCHandler.gs`, change (lines 57-82):
```javascript
  var QC_SUBMIT_SCHEMA = {
    job_number: {
      type:      'string',
      required:  true,
      maxLength: 200,
      label:     'Job Number'
    },
    qc_result: {
      type:          'string',
      required:      false,
      allowedValues: ['APPROVED', 'MINOR_REWORK', 'MAJOR_REWORK', 'CLIENT_SENT'],
      label:         'QC Result'
    },
    notes: {
      type:      'string',
      required:  false,
      maxLength: 500,
      label:     'Notes'
    },
    rework_notes: {
      type:      'string',
      required:  false,
      maxLength: 500,
      label:     'Rework Notes'
    }
  };
```
to:
```javascript
  var QC_SUBMIT_SCHEMA = {
    job_number: {
      type:      'string',
      required:  true,
      maxLength: 200,
      label:     'Job Number'
    },
    qc_result: {
      type:          'string',
      required:      false,
      allowedValues: ['APPROVED', 'MINOR_REWORK', 'MAJOR_REWORK', 'CLIENT_SENT'],
      label:         'QC Result'
    },
    notes: {
      type:      'string',
      required:  false,
      maxLength: 500,
      label:     'Notes'
    },
    rework_notes: {
      type:      'string',
      required:  false,
      maxLength: 500,
      label:     'Rework Notes'
    },
    finding_codes: {
      // No 'type' key — ValidationEngine.checkType_ only recognizes
      // 'string'|'number'|'boolean'|'date'|'email' (its default case
      // returns false), so declaring type:'array' would reject every
      // submission. Omitting 'type' skips the type-check block
      // entirely and the array passes through into cleanPayload
      // untouched; shape/contents are validated manually in
      // handleFlowB_ (Array.isArray + getFindingMeta_).
      required: false,
      label:    'Finding Codes'
    }
  };
```

- [ ] **Step 6: Insert `getFindingMeta_` helper**

In `src/06-handlers/QCHandler.gs`, insert this new function immediately before `handleFlowB_` (currently line 207, in "SECTION 4: FLOW HELPERS" right after `handleFlowA_` ends at line 199):

```javascript
  /**
   * Looks up severity_default for each submitted finding code and
   * validates it's known, active, and applicable to the given product.
   * Read-only — used for both validation (blocking) and metadata
   * (feeds the later write). Throws on the first invalid code found.
   *
   * @param {string[]} codes
   * @param {string}   productCode
   * @returns {Object}  { code: { severity: string } }
   */
  function getFindingMeta_(codes, productCode) {
    var rows = DAL.readAll(Config.TABLES.DIM_QC_FINDING_TYPES, { callerModule: 'QCHandler' });
    var byCode = {};
    rows.forEach(function (r) { byCode[r.finding_code] = r; });

    var meta = {};
    codes.forEach(function (code) {
      var row = byCode[code];
      var applicable = row && String(row.active_flag) === 'TRUE' &&
        (String(row.product_applicability) === 'ALL' || String(row.product_applicability) === String(productCode));
      if (!applicable) {
        throw new Error('QCHandler: finding_code "' + code + '" is unknown, inactive, or not applicable to product "' + productCode + '".');
      }
      meta[code] = { severity: row.severity_default };
    });
    return meta;
  }

```

- [ ] **Step 7: Add early validation to `handleFlowB_`**

In `src/06-handlers/QCHandler.gs`, `handleFlowB_` currently starts (lines 207-215):
```javascript
  function handleFlowB_(cleanPayload, view, actor, queueId, rawPayload) {
    var jobNumber = cleanPayload.job_number;
    var qcResult  = cleanPayload.qc_result;

    if ((qcResult === 'MINOR_REWORK' || qcResult === 'MAJOR_REWORK') && !cleanPayload.rework_notes) {
      throw new Error('QCHandler: rework_notes is required when qc_result = "' + qcResult + '".');
    }

    RBAC.enforcePermission(actor, RBAC.ACTIONS.QC_APPROVE);
```
Change to:
```javascript
  function handleFlowB_(cleanPayload, view, actor, queueId, rawPayload) {
    var jobNumber = cleanPayload.job_number;
    var qcResult  = cleanPayload.qc_result;

    if ((qcResult === 'MINOR_REWORK' || qcResult === 'MAJOR_REWORK') && !cleanPayload.rework_notes) {
      throw new Error('QCHandler: rework_notes is required when qc_result = "' + qcResult + '".');
    }

    RBAC.enforcePermission(actor, RBAC.ACTIONS.QC_APPROVE);

    // ── Finding codes: blocking validation (policy, not infra) ──
    // Runs here — after RBAC, alongside the rework_notes check —
    // because code validity is a review-completeness rule, same
    // category as "rework_notes is required". The actual FACT_QC_FINDINGS
    // *write* happens much later (see below) and is deliberately NOT
    // blocking — see the comment at that call site for why.
    var findingMeta = null;
    if (qcResult === 'MINOR_REWORK' || qcResult === 'MAJOR_REWORK') {
      if (!Array.isArray(cleanPayload.finding_codes) || cleanPayload.finding_codes.length === 0) {
        throw new Error('QCHandler: at least one finding_code is required when qc_result = "' + qcResult + '".');
      }
      findingMeta = getFindingMeta_(cleanPayload.finding_codes, view.product_code);
    }
```

- [ ] **Step 8: Generate the session id and stamp it on the `FACT_QC_EVENTS` row**

`handleFlowB_` currently builds its event row with (unchanged lines, for context — find this exact call):
```javascript
    var eventRow = buildQCEvent_(eventType, cleanPayload, actor, periodId, idempotencyKey, rawPayload);
```
This line is inside `handleFlowB_`, after `DAL.ensurePartition(Config.TABLES.FACT_QC_EVENTS, periodId, 'QCHandler');`. Change it to:
```javascript
    var sessionId = (qcResult === 'MINOR_REWORK' || qcResult === 'MAJOR_REWORK')
      ? Identifiers.generatePrefixedId(Config.ID_PREFIXES.QC_SESSION)
      : '';
    var eventRow = buildQCEvent_(eventType, cleanPayload, actor, periodId, idempotencyKey, rawPayload);
    eventRow.qc_session_id = sessionId;
```

- [ ] **Step 9: Add the isolated findings write at the end of `handleFlowB_`**

`handleFlowB_` currently ends with (unchanged lines, for context):
```javascript
    if (qcResult === 'MINOR_REWORK' || qcResult === 'MAJOR_REWORK') {
      sendReworkNotification_(view, qcResult, cleanPayload.rework_notes || '', actor);
    }
    if (qcResult === 'APPROVED') {
      sendClientCompletionEmail_(view);
    }

    Logger.info(eventType, {
      module:      'QCHandler',
      message:     'QC review processed',
      target_id:   jobNumber,
      queue_id:    queueId,
      job_number:  jobNumber,
      qc_result:   qcResult,
      to_state:    targetState,
      event_id:    eventRow.event_id
    });

    return jobNumber;
  }
```
Insert the isolated findings-write block immediately before the final `Logger.info(eventType, ...)` call:
```javascript
    if (qcResult === 'MINOR_REWORK' || qcResult === 'MAJOR_REWORK') {
      sendReworkNotification_(view, qcResult, cleanPayload.rework_notes || '', actor);
    }
    if (qcResult === 'APPROVED') {
      sendClientCompletionEmail_(view);
    }

    // ── Findings write: isolated failure domain (infra, not policy) ──
    // Code validity was already enforced above via getFindingMeta_
    // (findingMeta is non-null here whenever there are codes to write).
    // This block writes to FACT_QC_FINDINGS, a table that has never
    // been written before in this codebase — DAL.ensurePartition
    // creates its first-ever partition tab here. If this write fails
    // for any infra reason, the review must still land (event written,
    // state transitioned, notification sent, above) rather than
    // stranding the job — isDuplicate_ checks FACT_QC_EVENTS directly,
    // so a retry after a thrown error here would be treated as a
    // duplicate and never reach this write or the VW update again.
    if (findingMeta) {
      try {
        DAL.ensurePartition(Config.TABLES.FACT_QC_FINDINGS, periodId, 'QCHandler');
        var findingRows = cleanPayload.finding_codes.map(function (code) {
          return {
            qc_finding_id:         Identifiers.generatePrefixedId(Config.ID_PREFIXES.QC_FINDING),
            event_type:            'FINDING_RECORDED',
            amendment_of:          '',
            period_id:             periodId,
            qc_session_id:         sessionId,
            job_number:            jobNumber,
            client_code:           view.client_code || '',
            product_code:          view.product_code || '',
            reviewer_person_code:  actor.personCode || '',
            finding_code:          code,
            severity:              findingMeta[code].severity,
            comment:               cleanPayload.rework_notes || '',
            corrected_at:          '',
            corrected_in_revision: '',
            created_at:            eventRow.timestamp,
            request_id:            queueId
          };
        });
        DAL.appendRows(Config.TABLES.FACT_QC_FINDINGS, findingRows, { callerModule: 'QCHandler', periodId: periodId });
      } catch (findingsErr) {
        Logger.error('QC_FINDINGS_WRITE_FAILED', {
          module:     'QCHandler',
          event_id:   eventRow.event_id,
          job_number: jobNumber,
          codes:      cleanPayload.finding_codes.join(','),
          error:      findingsErr.message
        });
        // Do not rethrow — the review itself already succeeded above.
      }
    }

    Logger.info(eventType, {
      module:      'QCHandler',
      message:     'QC review processed',
      target_id:   jobNumber,
      queue_id:    queueId,
      job_number:  jobNumber,
      qc_result:   qcResult,
      to_state:    targetState,
      event_id:    eventRow.event_id
    });

    return jobNumber;
  }
```

- [ ] **Step 10: Run the suite — confirm all 5 tests pass**

In the Apps Script editor: select `runQCFindingsPickerTests` and run it.
Expected: `SUITE TOTAL — passed: N  failed: 0` with the `✅ ALL TESTS PASSED` banner. If any assertion fails, the message names the exact expectation (e.g. `LOAD_ERROR severity = CRITICAL` got something else) — fix before proceeding.

- [ ] **Step 11: Run the full existing QCHandler suites — confirm no regression**

Run `runQCHandlerTests()` (suite 7) and `runQCHandlerFlowTests()` (suite 9) in the Apps Script editor. Expected: both still `✅ ALL TESTS PASSED` — `testQCHandler_flowB_approved` in particular must still pass unchanged (APPROVED never touches `finding_codes`/`findingMeta`, so `findingMeta` stays `null` and the new write block is skipped entirely for that path).

- [ ] **Step 12: Manual verification — findings-write-failure isolation does not strand the job**

This specific failure mode (the `FACT_QC_FINDINGS` write itself throwing) cannot be triggered deterministically through the existing `assertH_` harness — this codebase has no mocking/dependency-injection seam, and `WRITE_PERMISSIONS` is a private variable inside `DAL.gs`'s closure, not reachable from test code. Verify manually instead:

1. In `src/01-dal/DAL.gs` line 129, temporarily change back to `'FACT_QC_FINDINGS': ['QcReviewDAL'],` (removing `'QCHandler'` — this reproduces exactly the permission-denied write failure this step exists to guard against).
2. In the Apps Script editor, run `testQCFindings_happyPath()` directly (not the full suite).
3. Expected: the test's own assertions about `FACT_QC_FINDINGS` rows now correctly FAIL (0 rows found) — but check the execution transcript for a `QC_FINDINGS_WRITE_FAILED` log line, and separately confirm the job's `VW_JOB_CURRENT_STATE` DID transition to `MINOR_FIX` (e.g. via `StateMachine.getJobView(jobNumber)` in the console, using the `jobNumber` the test printed) and a `QC_MINOR_REWORK` row DID land in `FACT_QC_EVENTS`. This is the actual thing being verified — state advanced despite the findings write failing, not the test's pass/fail status.
4. Revert `src/01-dal/DAL.gs` line 129 back to `'FACT_QC_FINDINGS': ['QcReviewDAL', 'QCHandler'],`.
5. Re-run `runQCFindingsPickerTests()` to confirm normal green state resumes.

- [ ] **Step 13: Commit**

```bash
git add src/01-dal/DAL.gs src/06-handlers/QCHandler.gs src/setup/QCHandlerTest.gs src/setup/TestHarness.gs
git commit -m "feat(qc): validate + persist finding_codes on QC rework review (W2-3 backend)"
```

---

## Task 3: Frontend — `#modal-qc-review` finding-code picker

**Files:**
- Modify: `src/07-portal/PortalView.html` (modal HTML block currently lines 1106-1130; `openQCReview()`; `submitQCReview()`; new render/error helper functions, following the `openSopChecklist_`/`renderSopItems_`/`showSopError_` precedent at lines 4876+ rather than `openAssign`'s close-on-failure pattern — the SOP checklist modal is a closer structural match: checkbox list + inline error banner + loading state, and doesn't abandon the modal on a transient fetch failure)

**Interfaces:**
- Consumes: `portal_getQcFindingTypes(productCode)` via `TOKEN_RUN` (Task 1) → `{ findingTypes: [{ finding_code, finding_label, category }] }`.

- [ ] **Step 1: Add the checkbox-list block to the modal HTML**

In `src/07-portal/PortalView.html`, the `#modal-qc-review` block currently reads (lines 1106-1130):
```html
<!-- ══ QC REVIEW MODAL ═══════════════════════════════════════ -->
<div class="modal-backdrop" id="modal-qc-review">
  <div class="modal">
    <div class="modal-header">
      <h3>QC Review</h3>
      <button class="modal-close" data-close="modal-qc-review">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-job-info" id="qc-review-job-info"></div>
      <div class="field"><label>Decision</label>
        <select id="qc-result">
          <option value="APPROVED">✅ APPROVED — mark as completed</option>
          <option value="MINOR_REWORK">⚠ MINOR ERROR — designer fixes and sends direct to client</option>
          <option value="MAJOR_REWORK">❌ MAJOR ERROR — designer revises and re-submits to QC</option>
        </select></div>
      <div class="field" id="rework-notes-field" style="display:none">
        <label>Rework Notes <span style="color:var(--c-danger)">*</span></label>
        <textarea id="qc-rework-notes" rows="3" maxlength="500"
          placeholder="Describe what needs to be corrected…"></textarea></div>
      <div class="field"><label>General Notes (optional)</label>
        <textarea id="qc-notes" rows="2" maxlength="500"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn-muted" data-close="modal-qc-review">Cancel</button>
      <button class="btn-success" id="btn-submit-qc-review">Submit Review</button>
    </div>
  </div>
</div>
```
Change to (new `qc-findings-field` block inserted between the Decision `<select>` and the Rework Notes field):
```html
<!-- ══ QC REVIEW MODAL ═══════════════════════════════════════ -->
<div class="modal-backdrop" id="modal-qc-review">
  <div class="modal">
    <div class="modal-header">
      <h3>QC Review</h3>
      <button class="modal-close" data-close="modal-qc-review">✕</button>
    </div>
    <div class="modal-body">
      <div class="modal-job-info" id="qc-review-job-info"></div>
      <div class="field"><label>Decision</label>
        <select id="qc-result">
          <option value="APPROVED">✅ APPROVED — mark as completed</option>
          <option value="MINOR_REWORK">⚠ MINOR ERROR — designer fixes and sends direct to client</option>
          <option value="MAJOR_REWORK">❌ MAJOR ERROR — designer revises and re-submits to QC</option>
        </select></div>
      <div class="field" id="qc-findings-field" style="display:none">
        <label>Finding(s) <span style="color:var(--c-danger)">*</span></label>
        <div id="qc-findings-error" class="sop-error-banner" style="display:none"></div>
        <div id="qc-findings-loading" style="color:var(--c-muted);font-size:13px;display:none">Loading finding types…</div>
        <div id="qc-findings-list"></div>
      </div>
      <div class="field" id="rework-notes-field" style="display:none">
        <label>Rework Notes <span style="color:var(--c-danger)">*</span></label>
        <textarea id="qc-rework-notes" rows="3" maxlength="500"
          placeholder="Describe what needs to be corrected…"></textarea></div>
      <div class="field"><label>General Notes (optional)</label>
        <textarea id="qc-notes" rows="2" maxlength="500"></textarea></div>
    </div>
    <div class="modal-footer">
      <button class="btn-muted" data-close="modal-qc-review">Cancel</button>
      <button class="btn-success" id="btn-submit-qc-review">Submit Review</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Confirm the `.sop-error-banner` CSS class exists and is reusable as-is**

```bash
grep -n "\.sop-error-banner" src/07-portal/PortalView.html
```
Expected: one `<style>` rule definition (already exists from the SOP checklist feature — reused here rather than duplicated, since the visual treatment — an error message banner — is identical).

- [ ] **Step 3: Update `openQCReview()` to reset and populate the findings list**

`openQCReview()` currently reads (in the `// ── Modal Openers ──` section):
```javascript
function openQCReview(jobNumber) {
  _activeJob = findJob(jobNumber);
  if (!_activeJob) return;
  setModalJobInfo('qc-review-job-info', _activeJob);
  document.getElementById('qc-result').value       = 'APPROVED';
  document.getElementById('qc-rework-notes').value = '';
  document.getElementById('qc-notes').value        = '';
  document.getElementById('rework-notes-field').style.display = 'none';
  openModal('modal-qc-review');
}
```
Change to:
```javascript
function openQCReview(jobNumber) {
  _activeJob = findJob(jobNumber);
  if (!_activeJob) return;
  setModalJobInfo('qc-review-job-info', _activeJob);
  document.getElementById('qc-result').value       = 'APPROVED';
  document.getElementById('qc-rework-notes').value = '';
  document.getElementById('qc-notes').value        = '';
  document.getElementById('rework-notes-field').style.display  = 'none';
  document.getElementById('qc-findings-field').style.display   = 'none';
  document.getElementById('qc-findings-error').style.display   = 'none';
  document.getElementById('qc-findings-loading').style.display = 'none';
  var list = document.getElementById('qc-findings-list');
  while (list.firstChild) list.removeChild(list.firstChild);
  _qcFindingTypes = null;
  openModal('modal-qc-review');
}
```

- [ ] **Step 4: Add a shared toggle handler + fetch/render/error functions**

The existing decision-change toggle currently lives wherever `#qc-result`'s `change` listener shows/hides `#rework-notes-field` (search for `rework-notes-field` in the `<script>` block — the listener attaches `.style.display` based on `qc-result`'s value). Find that listener (likely near the other `addEventListener('click', ...)` wiring, registered as a `change` listener on `document.getElementById('qc-result')`) and replace its body so it also drives `#qc-findings-field` and triggers the fetch. If the existing listener reads:
```javascript
document.getElementById('qc-result').addEventListener('change', function() {
  var isRework = this.value === 'MINOR_REWORK' || this.value === 'MAJOR_REWORK';
  document.getElementById('rework-notes-field').style.display = isRework ? 'block' : 'none';
});
```
change it to:
```javascript
document.getElementById('qc-result').addEventListener('change', function() {
  var isRework = this.value === 'MINOR_REWORK' || this.value === 'MAJOR_REWORK';
  document.getElementById('rework-notes-field').style.display = isRework ? 'block' : 'none';
  document.getElementById('qc-findings-field').style.display  = isRework ? 'block' : 'none';
  if (isRework && !_qcFindingTypes) loadQcFindingTypes_();
});
```
(If the existing listener is phrased differently, preserve its exact structure and add only the two new lines + the `loadQcFindingTypes_()` trigger — do not rewrite unrelated logic.)

Then insert these three new functions immediately before `function openQCReview(jobNumber) {`:
```javascript
var _qcFindingTypes = null;  // cache for the current modal session — cleared in openQCReview()

function loadQcFindingTypes_() {
  document.getElementById('qc-findings-error').style.display   = 'none';
  document.getElementById('qc-findings-loading').style.display = 'block';
  var list = document.getElementById('qc-findings-list');
  while (list.firstChild) list.removeChild(list.firstChild);

  TOKEN_RUN
    .withSuccessHandler(function (json) {
      var data;
      try { data = JSON.parse(json); } catch (e) { showQcFindingsError_('Could not parse finding types response.'); return; }
      _qcFindingTypes = data.findingTypes || [];
      renderQcFindingTypes_(_qcFindingTypes);
    })
    .withFailureHandler(function (err) {
      showQcFindingsError_('Could not load finding types: ' + (err.message || String(err)));
    })
    .portal_getQcFindingTypes(_activeJob.product_code || '');
}

function showQcFindingsError_(msg) {
  document.getElementById('qc-findings-loading').style.display = 'none';
  var banner = document.getElementById('qc-findings-error');
  banner.textContent   = msg;  // textContent — never innerHTML
  banner.style.display = 'block';
}

function renderQcFindingTypes_(findingTypes) {
  document.getElementById('qc-findings-loading').style.display = 'none';
  var list = document.getElementById('qc-findings-list');
  while (list.firstChild) list.removeChild(list.firstChild);

  findingTypes.forEach(function (ft) {
    var row = document.createElement('div');
    row.className = 'sop-item';  // reuse existing checkbox-row styling

    var cb = document.createElement('input');
    cb.type           = 'checkbox';
    cb.id              = 'qc-finding-cb-' + ft.finding_code;
    cb.dataset.code    = ft.finding_code;

    var lbl = document.createElement('label');
    lbl.htmlFor   = cb.id;
    lbl.className = 'sop-item-label';
    lbl.appendChild(document.createTextNode(ft.finding_label));

    row.appendChild(cb);
    row.appendChild(lbl);
    list.appendChild(row);
  });
}

```

- [ ] **Step 5: Update `submitQCReview()` to include `finding_codes` and enforce the client-side required check**

`submitQCReview()` currently reads:
```javascript
function submitQCReview() {
  if (!_activeJob) return;
  var qcResult    = document.getElementById('qc-result').value;
  var reworkNotes = val('qc-rework-notes');
  var notes       = val('qc-notes');

  if ((qcResult === 'MINOR_REWORK' || qcResult === 'MAJOR_REWORK') && !reworkNotes) {
    return showToast('Rework notes are required when returning a job.', 'error');
  }

  var payload = { job_number: _activeJob.job_number, qc_result: qcResult };
  if (reworkNotes) payload.rework_notes = reworkNotes;
  if (notes)       payload.notes = notes;

  closeModal('modal-qc-review');
  var msg = qcResult === 'APPROVED'
    ? _activeJob.job_number + ' approved — marked as completed.'
    : qcResult === 'MINOR_REWORK'
      ? _activeJob.job_number + ' returned — minor fix required.'
      : _activeJob.job_number + ' returned — major rework required, re-QC needed.';
  submitAction('QC_SUBMIT', payload, msg);
}
```
Change to:
```javascript
function submitQCReview() {
  if (!_activeJob) return;
  var qcResult    = document.getElementById('qc-result').value;
  var reworkNotes = val('qc-rework-notes');
  var notes       = val('qc-notes');
  var isRework    = qcResult === 'MINOR_REWORK' || qcResult === 'MAJOR_REWORK';

  if (isRework && !reworkNotes) {
    return showToast('Rework notes are required when returning a job.', 'error');
  }

  var findingCodes = [];
  if (isRework) {
    var checked = document.querySelectorAll('#qc-findings-list input[type="checkbox"]:checked');
    checked.forEach(function (cb) { findingCodes.push(cb.dataset.code); });
    if (findingCodes.length === 0) {
      return showToast('Select at least one finding when returning a job for rework.', 'error');
    }
  }

  var payload = { job_number: _activeJob.job_number, qc_result: qcResult };
  if (reworkNotes) payload.rework_notes = reworkNotes;
  if (notes)       payload.notes = notes;
  if (isRework)    payload.finding_codes = findingCodes;

  closeModal('modal-qc-review');
  var msg = qcResult === 'APPROVED'
    ? _activeJob.job_number + ' approved — marked as completed.'
    : qcResult === 'MINOR_REWORK'
      ? _activeJob.job_number + ' returned — minor fix required.'
      : _activeJob.job_number + ' returned — major rework required, re-QC needed.';
  submitAction('QC_SUBMIT', payload, msg);
}
```

- [ ] **Step 6: Open the portal in a browser and verify end-to-end**

As a QC-role user (`test-qc@test.blc.internal` or a real QC reviewer in DEV): open the portal, find a job in `QC_REVIEW`, click "QC Review".
- Select "MINOR ERROR" — confirm the Finding(s) field appears with a "Loading finding types…" message, then populates with checkboxes (16 items, since the test job's product isn't TRUSS — `PLATE_ERROR` should be absent).
- Try submitting with 0 findings checked, Rework Notes filled — confirm the toast "Select at least one finding when returning a job for rework." appears and the modal stays open.
- Check 2 findings, fill Rework Notes, submit — confirm success toast, modal closes.
- Switch back to "APPROVED" on a fresh open — confirm the Finding(s) field stays hidden and is never sent.
- Open DevTools console — confirm no JS errors during any of the above.

- [ ] **Step 7: Commit**

```bash
git add src/07-portal/PortalView.html
git commit -m "feat(portal): add finding-code picker to QC review modal (W2-3 frontend)"
```

---

## Task 4: Session close-out

**Files:**
- Modify: `SESSION_LOG.md`, `CTO_TASK_QUEUE.md`, `PROJECT_MEMORY.md` (only if durable — see below)

- [ ] **Step 1: Run the full V3 handler test suite one more time**

In the Apps Script editor, run `runV3HandlerTests()` (or the two halves `runV3Tests_1to5()`/`runV3Tests_6to10()` plus suite 12 individually if the full run risks the 6-minute execution ceiling — per the existing doc comment at `TestHarness.gs:295`). Expected: all 12 suites `✅ ALL TESTS PASSED`, zero regressions.

- [ ] **Step 2: `git status` — confirm clean tree**

Per R4/CLAUDE_START_HERE.md Step 4 — every task in this plan already commits its own work; there should be nothing left uncommitted at this point.

- [ ] **Step 3: Update `CTO_TASK_QUEUE.md`**

Mark **TASK W2-3** as done in the Wave 2 backlog section, and update the "Session State" block to reflect: findings-picker shipped in DEV (not yet PROD-deployed — that's a separate, explicit user-approved step per R4/R6, out of scope for this plan), all 12 test suites green, W2-1 (NORSPAN-MB SOP template) remains the other active Wave 2 thread.

- [ ] **Step 4: Add a new dated entry to `SESSION_LOG.md`**

Cover: work completed (endpoint, handler changes, UI picker, 5 new tests + suite 12 registration), files changed (list from the Files Changed table above), tests run (`runQCFindingsPickerTests` + full regression suite results), issues found (none expected if all prior steps passed), next recommended step (PROD deploy decision — explicitly flag that `PortalView.html`/`Portal.gs` changed, so per R4.7 a New Version redeploy in the Apps Script editor is required after any PROD push, and confirm with the user before running `npm run push:prod` per R4's explicit gate).

- [ ] **Step 5: Do not push to PROD from this plan**

Per CLAUDE.md R4/R6 and this plan's Global Constraints — `npm run push:prod` requires an explicit, separate user go-ahead and is out of scope for plan execution itself. Stop here and hand back to the user.

---

## Self-Review Checklist

- [x] Spec §1 (data flow, validation-blocks/write-isolated split): Task 2 Steps 7-9 implement exactly this split, with the "why" comment preserved inline in the code itself, not just the plan — ✓
- [x] Spec §1 (QS- session id, stamped on both tables): Task 2 Step 8 generates once, Step 9 reuses the same `sessionId` var for every finding row — ✓
- [x] Spec §2 (endpoint, client-advisory filter only): Task 1 Step 2 — ✓
- [x] Spec §3 (UI, fetch-failure behavior): Task 3 Steps 3-4 — refined from the spec's generic "retry action" to this codebase's actual existing pattern (`showSopError_`/inline banner, modal stays open, close+reopen retries) rather than inventing a new UI element with no precedent — ✓
- [x] Spec §4 (no `type` key on schema, server-side product/active check, ensurePartition, isolated non-rethrowing write): Task 2 Steps 5, 6, 9 — ✓
- [x] Spec §5 (testing — T1 + 3 added cases): happy path (Test 10), invalid input (Tests 11-12), duplicate (Test 14) cover T1; product-inapplicable (Test 13) and findings-write-failure isolation (Task 2 Step 12, manual) cover the 2 added cases; first-write partition creation is folded into Test 10's happy path per the reasoning in Task 2 Step 12's preamble (a dedicated "first ever write" test isn't deterministic across repeated DEV runs) — ✓
- [x] RBAC denial: not a new dedicated test — inherited unchanged from the existing `RBAC.enforcePermission(actor, RBAC.ACTIONS.QC_APPROVE)` gate at the top of `handleFlowB_`, which runs before any new code in this plan. Noted explicitly rather than silently omitted — ✓
- [x] Placeholder scan: no TBD/TODO, every code block is complete and copy-pasteable — ✓
- [x] Type consistency: `getFindingMeta_(codes, productCode)` called identically in Task 2 Step 7 (`getFindingMeta_(cleanPayload.finding_codes, view.product_code)`) and defined in Step 6 with matching parameter order; `findingMeta[code].severity` in Step 9 matches the `{ code: { severity } }` shape returned in Step 6 — ✓
- [x] `BatchOperations.appendRows` (spec's wording) corrected throughout the plan to the verified real API, `DAL.appendRows` — ✓
- [x] No PROD deploy anywhere in this plan (Task 4 Step 5 explicit stop) — ✓
