# QC Findings-Picker — Design Spec
**Date:** 2026-08-10
**Status:** Draft — pending advisor review
**Task:** CTO_TASK_QUEUE.md Wave 2, TASK W2-3

## Problem

`DIM_QC_FINDING_TYPES` (`src/13-sop/QcFindingTypes.gs`) defines a 17-code QC finding taxonomy (structural/process/documentation categories, severity, KPI weight, product applicability) but has zero consumers anywhere in the codebase — it's pure seeded reference data. The live QC review flow (`QCHandler.gs` + `#modal-qc-review` in `PortalView.html`) only captures a coarse `qc_result` (APPROVED/MINOR_REWORK/MAJOR_REWORK/CLIENT_SENT) plus free-text notes. There is no way to record *why* a job was returned for rework in a structured, reportable way.

Separately, `FACT_QC_FINDINGS` (16-column schema, `SetupScript.gs`) is already fully designed for exactly this — one row per finding, `event_type` RECORDED/CORRECTED for future amendment support, `severity`, `comment`, and a `qc_session_id` FK — but is currently unwired: write access is restricted to a `QcReviewDAL` module that doesn't exist, and `FACT_QC_EVENTS.qc_session_id` (added previously as forward-compat scaffolding) is never set by `QCHandler.gs` today.

## Solution

Build a multi-select finding-code picker on the existing `#modal-qc-review` modal, active only for `MINOR_REWORK`/`MAJOR_REWORK` outcomes. Reuse the already-designed `FACT_QC_FINDINGS` table rather than inventing a new column: `QCHandler.handleFlowB_` writes one `FACT_QC_FINDINGS` row per selected finding code in the same call that writes the `FACT_QC_EVENTS` row, using that event's `event_id` as `qc_session_id` — this is what the column was scaffolded for. No new session-tracking system, no `QcReviewDAL`/`QcReviewEngine` buildout — those remain future Layer 2 work, out of scope here.

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
2. New: if `qcResult` is MINOR_REWORK/MAJOR_REWORK, require `finding_codes.length >= 1`; reject any code not in `QcFindingTypes.CODES`.
3. Writes the `FACT_QC_EVENTS` row exactly as today (unchanged).
4. New: writes one `FACT_QC_FINDINGS` row per selected code via `BatchOperations.appendRows` (P2 — batch write, >1 row), in the same try/catch that already releases the idempotency mark on failure — a `FACT_QC_FINDINGS` write failure must not leave `FACT_QC_EVENTS` written but idempotency marked, or the item becomes unretryable.

`FACT_QC_FINDINGS` row shape per selected code:
```
qc_finding_id:         Identifiers.generatePrefixedId(Config.ID_PREFIXES.QC_FINDING)  // 'QF'
event_type:             'FINDING_RECORDED'
amendment_of:            ''
period_id:               periodId               // same as the FACT_QC_EVENTS row
qc_session_id:           eventRow.event_id       // the FACT_QC_EVENTS row just written
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

### 3. UI — `#modal-qc-review` (`PortalView.html`)

New block between the "Decision" `<select>` and the "Rework Notes" field: a checkbox list (`<div id="qc-findings-field">`, `style="display:none"` by default), populated from `portal_getQcFindingTypes(ptoken, _activeJob.product_code)` inside `openQCReview()`. Its visibility is driven by the same change handler that already toggles `#rework-notes-field` for MINOR_REWORK/MAJOR_REWORK — one shared function, not two separate listeners. `submitQCReview()` collects checked codes into `finding_codes: [...]` on the payload and — mirroring the existing `if (!reworkNotes) return showToast(...)` guard — blocks submission client-side with a toast if `finding_codes.length === 0` while `qcResult` is MINOR_REWORK/MAJOR_REWORK.

### 4. `QCHandler.gs` changes

`QC_SUBMIT_SCHEMA.finding_codes`: `{ type: 'array', required: false }` (server-side required-when-rework check lives in `handleFlowB_`, not the schema, matching how `rework_notes` is already handled — schema-optional, flow-enforced). `handleFlowB_` gains, right after the existing `rework_notes` required check:
```javascript
if ((qcResult === 'MINOR_REWORK' || qcResult === 'MAJOR_REWORK')) {
  if (!cleanPayload.finding_codes || cleanPayload.finding_codes.length === 0) {
    throw new Error('QCHandler: at least one finding_code is required when qc_result = "' + qcResult + '".');
  }
  cleanPayload.finding_codes.forEach(function (code) {
    // QcFindingTypes.CODES is a self-mapping object ({ LOAD_ERROR: 'LOAD_ERROR', ... }) —
    // hasOwnProperty is a direct, correct membership check, no new lookup structure needed.
    if (!QcFindingTypes.CODES.hasOwnProperty(code)) {
      throw new Error('QCHandler: unknown finding_code "' + code + '".');
    }
  });
}
```

**Severity lookup:** `handleFlowB_` needs each selected code's `severity_default` to populate the `FACT_QC_FINDINGS.severity` column (§1) — `portal_getQcFindingTypes` resolves this at read time for the picker, but the handler resolves it again at write time (server never trusts a client-supplied severity). Add a small `getSeverityByCode_(codes)` helper in `QCHandler.gs`: one `DAL.readAll(Config.TABLES.DIM_QC_FINDING_TYPES)` call, filtered to the submitted codes, building a `{ code: severity_default }` map — called once per `handleFlowB_` invocation, right before building the `FACT_QC_FINDINGS` rows.

`DAL.gs`: add `'QCHandler'` to `WRITE_PERMISSIONS['FACT_QC_FINDINGS']` (currently `['QcReviewDAL']` only).

### 5. Testing (T1: happy path + RBAC denial + invalid input + duplicate submission)

- Happy path: MINOR_REWORK with 2 valid finding codes → 1 `FACT_QC_EVENTS` row + 2 `FACT_QC_FINDINGS` rows, correct `qc_session_id` linkage, correct `severity` per code.
- RBAC denial: actor without `QC_APPROVE` calling `portal_getQcFindingTypes` or submitting Flow B → rejected before any read/write.
- Invalid input: unknown finding code rejected; MINOR_REWORK/MAJOR_REWORK with zero finding codes rejected; APPROVED with finding_codes present is simply ignored (out of scope per the "only rework" decision — not an error).
- Duplicate submission: existing idempotency-key retry path skips the findings write too (no double-insert) — verify via the existing `isDuplicate_`/`IdempotencyEngine.checkAndMark` guards, which already gate the whole flow before either table is written.
- Product filtering: non-TRUSS job's `portal_getQcFindingTypes` response excludes `PLATE_ERROR`; TRUSS job includes it.
- Partial-failure safety: simulate `FACT_QC_FINDINGS` write throwing after `FACT_QC_EVENTS` succeeds → confirm idempotency mark is released (retry becomes possible) rather than left in a stuck marked-but-incomplete state.

## Open questions / risks for advisor review

- Is duplicating the shared `rework_notes` text onto every `FACT_QC_FINDINGS.comment` the right call long-term, or does it create drift risk if `FACT_QC_EVENTS.rework_notes` is ever amended without touching the findings rows? (No amendment path exists today, so likely fine, but flagging.)
- Partial-failure ordering: writing `FACT_QC_EVENTS` first, then `FACT_QC_FINDINGS`, means a crash between the two writes leaves an event with no findings (idempotency mark released, so retry is *possible* — but does retry correctly re-derive `finding_codes` from the original payload, or could a queue retry with a stale/edited payload produce inconsistent findings on the retry vs. what almost got written the first time)?
- `QcFindingTypes.CODES` is a plain value object today, not a Set/lookup-optimized structure — confirm the cleanest way to validate submitted codes against it without introducing an unnecessary new module.
