# QC Findings-Picker — Design Spec
**Date:** 2026-08-10
**Status:** Draft — advisor-reviewed, revisions applied, pending user review
**Task:** CTO_TASK_QUEUE.md Wave 2, TASK W2-3

## Problem

`DIM_QC_FINDING_TYPES` (`src/13-sop/QcFindingTypes.gs`) defines a 17-code QC finding taxonomy (structural/process/documentation categories, severity, KPI weight, product applicability) but has zero consumers anywhere in the codebase — it's pure seeded reference data. The live QC review flow (`QCHandler.gs` + `#modal-qc-review` in `PortalView.html`) only captures a coarse `qc_result` (APPROVED/MINOR_REWORK/MAJOR_REWORK/CLIENT_SENT) plus free-text notes. There is no way to record *why* a job was returned for rework in a structured, reportable way.

Separately, `FACT_QC_FINDINGS` (16-column schema, `SetupScript.gs`) is already fully designed for exactly this — one row per finding, `event_type` RECORDED/CORRECTED for future amendment support, `severity`, `comment`, and a `qc_session_id` FK — but is currently unwired: write access is restricted to a `QcReviewDAL` module that doesn't exist, and `FACT_QC_EVENTS.qc_session_id` (added previously as forward-compat scaffolding) is never set by `QCHandler.gs` today.

## Solution

Build a multi-select finding-code picker on the existing `#modal-qc-review` modal, active only for `MINOR_REWORK`/`MAJOR_REWORK` outcomes. Reuse the already-designed `FACT_QC_FINDINGS` table rather than inventing a new column: `QCHandler.handleFlowB_` writes one `FACT_QC_FINDINGS` row per selected finding code in the same call that writes the `FACT_QC_EVENTS` row. No new session-tracking system, no `QcReviewDAL`/`QcReviewEngine` buildout — those remain future Layer 2 work, out of scope here.

**Session ID convention (revised after advisor review):** generate one `QS-`-prefixed id (`Identifiers.generatePrefixedId(Config.ID_PREFIXES.QC_SESSION)`) per Flow B review and stamp it on **both** the `FACT_QC_EVENTS` row's `qc_session_id` column (exists today, never set) and every `FACT_QC_FINDINGS` row's `qc_session_id` — rather than repurposing the event's own `event_id` into that column. `qc_session_id` was designed as a `QS-` ID space (FK to the future `FACT_QC_REVIEW_SESSIONS`, whose own schema holds the reverse `qc_event_id` FK) — using a proper `QS-` id keeps the join intact and means Layer 2 inherits real session ids without a backfill/migration when it's eventually built.

## Files Changed

| File | Change |
|---|---|
| `src/07-portal/Portal.gs` | New `portal_getQcFindingTypes(ptoken, productCode)` read endpoint |
| `src/07-portal/PortalView.html` | New multi-select block in `#modal-qc-review`; `openQCReview()` populates it; `submitQCReview()` includes `finding_codes` in payload + client-side required-when-rework check |
| `src/06-handlers/QCHandler.gs` | `QC_SUBMIT_SCHEMA` gains `finding_codes`; `handleFlowB_` validates + writes `FACT_QC_FINDINGS` rows |
| `src/01-dal/DAL.gs` | `WRITE_PERMISSIONS['FACT_QC_FINDINGS']` gains `'QCHandler'` |

## Design

### 1. Data flow

Designer's job is in `QC_REVIEW`. Reviewer opens `#modal-qc-review`, picks `MINOR_REWORK` or `MAJOR_REWORK` → finding-code picker appears (already-existing `rework-notes-field` toggle logic extends to cover it) → reviewer selects ≥1 code (required) → `submitQCReview()` posts `{ job_number, qc_result, rework_notes, notes, finding_codes: [...] }` → `QCHandler.handleFlowB_`:

1. Validates as today (RBAC, state transition, rework_notes required).
2. New, **blocking — policy, not infra:** if `qcResult` is MINOR_REWORK/MAJOR_REWORK, require `finding_codes.length >= 1` and `Array.isArray(...)`, then call `getFindingMeta_(codes, view.product_code)` (§4) — a **read-only** `DIM_QC_FINDING_TYPES` lookup that throws on any code that's unknown, inactive, or not applicable to the job's product. This runs *before* any FACT table is touched, same place the existing `rework_notes` check runs. Its return value (severity per code) is held for step 5.
3. Writes the `FACT_QC_EVENTS` row as today, plus the new `qc_session_id` (generated once, see above).
4. Updates `VW_JOB_CURRENT_STATE` and sends notifications exactly as today — **unchanged position in the sequence**.
5. New, **last step, isolated failure domain** (revised after advisor review — see §4 for why): `DAL.ensurePartition(Config.TABLES.FACT_QC_FINDINGS, periodId, 'QCHandler')` then `BatchOperations.appendRows` writes one `FACT_QC_FINDINGS` row per selected code (using the severity map from step 2 — no second `DIM_QC_FINDING_TYPES` read), wrapped in its own `try/catch` that `Logger.error`s (`event_id`, `job_number`, codes) and does **not** rethrow. A findings-write failure degrades to today's exact behavior — review lands, state advances, findings are missing but loudly logged for manual backfill — rather than risking a stuck job.

**Why the split matters:** code validity (does this code exist, is it active, does it apply to this product) is a policy decision — same category as "`rework_notes` is required" — and must block the review exactly like that check does. Whether the resulting row can be *persisted* to a table that's never been written before is an infra concern, and infra failures shouldn't be able to strand a job in `QC_REVIEW` forever. `getFindingMeta_` (a read) does the former; `ensurePartition` + `appendRows` (a write) does the latter — they run at different points in the sequence for exactly that reason, not just for organizational convenience.

`FACT_QC_FINDINGS` row shape per selected code:
```
qc_finding_id:         Identifiers.generatePrefixedId(Config.ID_PREFIXES.QC_FINDING)  // 'QF'
event_type:             'FINDING_RECORDED'
amendment_of:            ''
period_id:               periodId                  // same as the FACT_QC_EVENTS row
qc_session_id:           sessionId                 // QS-... generated once for this review, also stamped on the FACT_QC_EVENTS row
job_number:              jobNumber
client_code:             view.client_code
product_code:            view.product_code
reviewer_person_code:    actor.personCode
finding_code:            <selected code>
severity:                <code's severity_default from DIM_QC_FINDING_TYPES>
comment:                 cleanPayload.rework_notes   // shared field, duplicated onto every row
corrected_at:             ''
corrected_in_revision:    ''
created_at:               eventRow.timestamp
request_id:               queueId
```

`severity` is always the code's own `severity_default` — no reviewer override in this UI (no per-finding severity picker).

### 2. `portal_getQcFindingTypes(ptoken, productCode)` — `Portal.gs`

Placed alongside `portal_getSopChecklist`. `RBAC.enforcePermission(actor, RBAC.ACTIONS.QC_APPROVE)` first line (matches the permission `handleFlowB_` itself requires — only QC reviewers ever need this list). Reads `DIM_QC_FINDING_TYPES` via `DAL.readAll`, filters in-memory to `active_flag === 'TRUE'` and (`product_applicability === 'ALL'` or `=== productCode`), sorted by `display_order`. Returns `finding_code`, `finding_label`, `category` per entry (no severity/kpi_weight needed client-side — those are resolved server-side at write time).

**This filter is client-advisory only** — it shapes what the picker shows, it does not by itself stop a bad code from being submitted (a request can bypass the UI entirely). The authoritative check is server-side in `handleFlowB_` (§4), which re-applies the same `active_flag`/`product_applicability` rule against the submitted codes before writing anything.

### 3. UI — `#modal-qc-review` (`PortalView.html`)

New block between the "Decision" `<select>` and the "Rework Notes" field: a checkbox list (`<div id="qc-findings-field">`, `style="display:none"` by default), populated from `portal_getQcFindingTypes(ptoken, _activeJob.product_code)` inside `openQCReview()`, following the existing `openAssign()` async-populate pattern (disabled "Loading…" placeholder option while the call is in flight). Its visibility is driven by the same change handler that already toggles `#rework-notes-field` for MINOR_REWORK/MAJOR_REWORK — one shared function, not two separate listeners. `submitQCReview()` collects checked codes into `finding_codes: [...]` on the payload and — mirroring the existing `if (!reworkNotes) return showToast(...)` guard — blocks submission client-side with a toast if `finding_codes.length === 0` while `qcResult` is MINOR_REWORK/MAJOR_REWORK.

**Fetch-failure behavior:** if `portal_getQcFindingTypes` fails or times out, the picker shows an inline error message with a "Retry" action — it must not silently leave an empty/dead checkbox list that blocks a legitimate rework submission with no way to proceed. Retry re-calls the same populate function.

### 4. `QCHandler.gs` changes

**`QC_SUBMIT_SCHEMA.finding_codes` — no `type` key (revised after advisor review).** `ValidationEngine.checkType_` only recognizes `'string'|'number'|'boolean'|'date'|'email'` — its `default` case returns `false`, so declaring `type: 'array'` would make every submission with finding codes fail validation. Declare the field as `{ required: false, label: 'Finding Codes' }` (no `type`) so `ValidationEngine`'s type-check block (`if (descriptor.type && ...)`) is skipped entirely and the array passes through into `cleanPayload` untouched; validate its shape and contents manually in `handleFlowB_` instead — matching the advisor's recommendation not to extend `ValidationEngine` for a one-off array field.

`handleFlowB_` gains, right after the existing `rework_notes` required check:
```javascript
if (qcResult === 'MINOR_REWORK' || qcResult === 'MAJOR_REWORK') {
  if (!Array.isArray(cleanPayload.finding_codes) || cleanPayload.finding_codes.length === 0) {
    throw new Error('QCHandler: at least one finding_code is required when qc_result = "' + qcResult + '".');
  }
}
```

**Finding metadata lookup + server-side validation (expanded after advisor review).** `handleFlowB_` needs each selected code's `severity_default` to populate `FACT_QC_FINDINGS.severity` (§1) — and per §2, the server must independently re-check `active_flag`/`product_applicability`, not trust that the client only ever sent picker-shown codes. One helper does both:

```javascript
// getFindingMeta_(codes, productCode) -> { code: { severity: '...' } }
// Throws on any code that is unknown, inactive, or not applicable to productCode.
function getFindingMeta_(codes, productCode) {
  var rows = DAL.readAll(Config.TABLES.DIM_QC_FINDING_TYPES, { callerModule: 'QCHandler' });
  var byCode = {};
  rows.forEach(function (r) { byCode[r.finding_code] = r; });

  var meta = {};
  codes.forEach(function (code) {
    var row = byCode[code];
    var applicable = row && row.active_flag === 'TRUE' &&
      (row.product_applicability === 'ALL' || row.product_applicability === productCode);
    if (!applicable) {
      throw new Error('QCHandler: finding_code "' + code + '" is unknown, inactive, or not applicable to product "' + productCode + '".');
    }
    meta[code] = { severity: row.severity_default };
  });
  return meta;
}
```
Called once per `handleFlowB_` invocation (with `view.product_code`), at **§1 step 2 — early, blocking, before any FACT table is touched.** This replaces the earlier plan to check membership against `QcFindingTypes.CODES` directly — reading `DIM_QC_FINDING_TYPES` itself is required anyway for `severity_default`, and doing the applicability check against the same read avoids a second lookup. Its returned `meta` map is held in a local variable and consumed later at §1 step 5 when the `FACT_QC_FINDINGS` rows are actually built — the lookup itself is not repeated at write time.

**Partition + write ordering (fixed after advisor review — two real defects found in the original draft):**
1. `FACT_QC_FINDINGS` is partitioned and has never been written anywhere in the codebase — no partition tabs exist. The original draft omitted `DAL.ensurePartition(Config.TABLES.FACT_QC_FINDINGS, periodId, 'QCHandler')` before the batch append, which would fail on the very first production write. Now added, mirroring the existing `DAL.ensurePartition(Config.TABLES.FACT_QC_EVENTS, periodId, 'QCHandler')` call already in `handleFlowB_`.
2. The original draft proposed releasing the idempotency mark on a findings-write failure so a retry could "heal" the missing findings. Traced against the actual retry path: `isDuplicate_()` runs *before* `IdempotencyEngine.checkAndMark()` (lines ~232 and ~239) and checks `FACT_QC_EVENTS` directly by `idempotency_key` — so a retry would find the already-written event row, return `'DUPLICATE'`, and never reach the findings write *or* the `VW_JOB_CURRENT_STATE` update. Net effect of the original plan: event logged as reworked, VW stuck at `QC_REVIEW` forever, no way to retry out of it. Fixed by moving the *write* (not the validation — see §1's "why the split matters") to *after* the VW update/notifications and making its failure non-rethrowing (logged, not thrown) — a findings-write failure now degrades to exactly today's pre-W2-3 behavior instead of stalling the job.

`DAL.gs`: add `'QCHandler'` to `WRITE_PERMISSIONS['FACT_QC_FINDINGS']` (currently `['QcReviewDAL']` only).

### 5. Testing (T1: happy path + RBAC denial + invalid input + duplicate submission, plus 3 cases added after advisor review)

- Happy path: MINOR_REWORK with 2 valid finding codes → 1 `FACT_QC_EVENTS` row + 2 `FACT_QC_FINDINGS` rows, matching `qc_session_id` (`QS-...`) on both, correct `severity` per code.
- RBAC denial: actor without `QC_APPROVE` calling `portal_getQcFindingTypes` or submitting Flow B → rejected before any read/write.
- Invalid input: unknown finding code rejected; MINOR_REWORK/MAJOR_REWORK with zero finding codes rejected; APPROVED with finding_codes present is simply ignored (out of scope per the "only rework" decision — not an error).
- Duplicate submission: existing idempotency-key retry path skips the whole flow (event + findings) — verify via the existing `isDuplicate_`/`IdempotencyEngine.checkAndMark` guards.
- Product filtering (client-side): non-TRUSS job's `portal_getQcFindingTypes` response excludes `PLATE_ERROR`; TRUSS job includes it.
- **New — server-side product/active rejection:** submit `PLATE_ERROR` directly against a non-TRUSS job (bypassing the UI/endpoint filter entirely) → `handleFlowB_` rejects it via `getFindingMeta_`, confirming the server-side check isn't just cosmetic.
- **New — first-write partition creation:** confirm `FACT_QC_FINDINGS` partition tab is auto-created on the very first-ever write via `DAL.ensurePartition`, since no partition exists yet anywhere.
- **New — findings-write-failure isolation:** simulate the `FACT_QC_FINDINGS` batch append throwing → confirm `FACT_QC_EVENTS` is still written, `VW_JOB_CURRENT_STATE` still transitions, rework notification still sends, and the failure is `Logger.error`-logged with `event_id`+codes — i.e. the job does *not* get stuck, findings are just missing and flagged for backfill.

Per R10/`testing-policy.md`: `Config.isDev()` guard on every new test runner, synthetic `TEST-CLIENT`/`test-*@test.blc.internal` actors only.

## Resolved during advisor review

- **Comment duplication drift:** not a risk — `FACT_QC_EVENTS`/`rework_notes` has no amendment path today (A5 — corrections are new events, not edits), so there's nothing for the findings-row copies to drift from.
- **Retry payload staleness:** not a risk — queue rows are immutable; a retry reprocesses the exact same `payload_json`, so `finding_codes` can't differ between attempts.
- **`QcFindingTypes.CODES` lookup:** superseded — `handleFlowB_` no longer checks membership against `QcFindingTypes.CODES` directly; `getFindingMeta_`'s `DIM_QC_FINDING_TYPES` read (needed anyway for `severity_default` and the active/applicability check) serves as the sole validation source.
