# EventReplayEngine — Design Spec

**Date:** 2026-04-15
**Status:** Approved
**Author:** Brainstorming session

---

## Goal

Build `EventReplayEngine` — a CEO-triggered recovery tool that rebuilds `VW_JOB_CURRENT_STATE` and `VW_DESIGNER_WORKLOAD` by replaying all FACT table events from scratch. Provides a reliable "nuclear option" when view projections become corrupted or out of sync with the FACT tables.

---

## Architecture

### Approach

Single-pass sequential replay. Read all FACT partitions oldest-first, fold events into in-memory maps, then clear and rewrite each VW table in one batch write. Simple, quota-safe, and consistent with the existing MART rebuild pattern used by BillingEngine and PayrollEngine.

### Files

| File | Change |
|---|---|
| `src/11-reporting/EventReplayEngine.gs` | New — all replay logic |
| `src/07-portal/Portal.gs` | Add `portal_rebuildViews()` |
| `src/07-portal/PortalView.html` | Add "Rebuild Views" button + JS handler |
| `src/setup/TestRunner.gs` | Add `testEventReplay()` diagnostic |

### Module Tier

`src/11-reporting/` — new module between T5 Financial and T6 Presentation. Reads FACT tables (T5), writes VW tables consumed by the portal (T6). When `src/13-admin/AdminConsole.gs` is built, the portal button should migrate there.

### Public API

```javascript
EventReplayEngine.rebuildAllViews(actorEmail)
// Returns:
// {
//   vw_job:      { written: number, cleared: number },
//   vw_workload: { written: number, cleared: number },
//   partial:     boolean,
//   elapsed_ms:  number
// }
```

### RBAC

CEO only — `RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN)` + `RBAC.enforceFinancialAccess(actor)`. Same gate as payroll and annual bonus runs.

---

## VW_JOB_CURRENT_STATE Rebuild

### Partition Discovery

Scan the spreadsheet for tabs matching `FACT_JOB_EVENTS_YYYY_MM`. Sort ascending (oldest first). Process in order. Tabs that don't exist are skipped with a `REPLAY_PARTITION_SKIPPED` log entry.

### Event Folding

Build an in-memory map keyed by `job_number`. For each event row, apply the following rules via a `switch` on `event_type`:

| event_type | Fields updated in map |
|---|---|
| `JOB_CREATED` | Insert new entry — all fields from event, `current_state = ALLOCATED` or `INTAKE_RECEIVED`, `rework_cycle = 0`, `client_return_count = 0` |
| `JOB_STARTED` | `prev_state = map[job_number].current_state`, `current_state = IN_PROGRESS`, `allocated_to`, `updated_at` |
| `JOB_ON_HOLD` | `prev_state = current_state`, `current_state = ON_HOLD`, `updated_at` |
| `JOB_RESUMED` | `current_state = prev_state`, `prev_state = ON_HOLD`, `updated_at` |
| `QC_SUBMITTED` | `current_state = IN_QC`, `updated_at` |
| `QC_APPROVED` | `current_state = COMPLETED`, `updated_at` |
| `QC_REWORK` | `current_state = IN_PROGRESS`, `rework_cycle++`, `client_return_count++`, `updated_at` |
| `INVOICED` | `current_state = INVOICED`, `updated_at` |
| Unknown | `Logger.warn('REPLAY_UNKNOWN_EVENT', ...)`, skip row, continue |

### Write

Clear `VW_JOB_CURRENT_STATE` via `SpreadsheetApp.getActiveSpreadsheet().getSheetByName(...).clearContents()` — same known exception used by BillingEngine and PayrollEngine since DAL has no "clear all rows" method. Then write all map values in one `BatchOperations.appendRows()` call (Rule P2).

---

## VW_DESIGNER_WORKLOAD Rebuild

### Partition Discovery

Scan for tabs matching `FACT_WORK_LOGS_YYYY_MM`. Sort ascending. Same skip-and-log pattern as above.

### Aggregation

In-memory map keyed by `person_code + '|' + period_id`:

```
For each work log row:
  key = person_code + '|' + period_id
  map[key].job_count++
  map[key].total_quantity += quantity
  map[key].last_updated = max(timestamp)
```

### Output columns

| Column | Value |
|---|---|
| `person_code` | from key |
| `period_id` | from key |
| `job_count` | count of work log rows for this person+period |
| `total_quantity` | sum of `quantity` |
| `last_updated` | latest `timestamp` seen |

### Write

Clear `VW_DESIGNER_WORKLOAD` via `SpreadsheetApp.getActiveSpreadsheet().getSheetByName(...).clearContents()` (same exception as above). Then write all map values in one `BatchOperations.appendRows()` call (Rule P2).

---

## Quota Guard (Rule P1)

Both the job replay and workload rebuild loops check `HealthMonitor.isApproachingLimit()` every 20 records. If the limit is approached:
- Log `REPLAY_QUOTA_CUTOFF` with `{ processed, total }` counts
- Return `{ partial: true }` in the result
- Portal shows a yellow warning toast: `"Partial rebuild — quota limit reached, re-run to complete"`

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Unknown `event_type` | `Logger.warn('REPLAY_UNKNOWN_EVENT')`, skip row, continue |
| Missing partition tab | Skip, log `REPLAY_PARTITION_SKIPPED`, continue |
| Sheet clear fails | Abort before write — never leave VW half-written. Return `{ success: false, error }` |
| Quota cutoff mid-loop | Return `{ partial: true }`, portal shows yellow toast |
| RBAC failure | Throws — portal shows red error toast |

---

## Portal Wiring

### Button

Added to the leader dashboard toolbar (CEO only, `canRunPayroll` gate). To be migrated to `AdminConsole` when that module is built.

```html
<button class="btn-muted btn-sm" id="btn-rebuild-views" style="display:none">🔧 Rebuild Views</button>
```

### Confirmation Dialog

```
Rebuild all view projections?

This clears and rewrites VW_JOB_CURRENT_STATE and VW_DESIGNER_WORKLOAD
by replaying all FACT events from scratch.

⚠ Do not run during active queue processing.
Run time: ~30–60 seconds depending on data volume.
```

### Toast Messages

| Result | Toast | Colour |
|---|---|---|
| Success | `"Views rebuilt in Xs — N jobs, M workload rows"` | Green |
| Partial | `"Partial rebuild — quota limit reached, re-run to complete"` | Yellow |
| Failure | `"Error: <message>"` | Red |

On completion (success or partial): call `loadLeaderDashboard()` to refresh portal data.

### `portal_rebuildViews()` in Portal.gs

```javascript
function portal_rebuildViews() {
  var email  = Session.getActiveUser().getEmail();
  var result = EventReplayEngine.rebuildAllViews(email);
  return JSON.stringify(result);
}
```

---

## Testing — `testEventReplay()`

Added to `src/setup/TestRunner.gs`. Run from Apps Script editor.

1. Call `EventReplayEngine.rebuildAllViews(actorEmail)`
2. Assert return shape has `vw_job.written`, `vw_workload.written`, `partial`, `elapsed_ms`
3. Assert `VW_JOB_CURRENT_STATE` row count matches `vw_job.written`
4. Assert idempotency — second run produces identical row counts
5. `pass_()` / `fail_()` via TestRunner helpers

---

## Out of Scope

- MART tables (`MART_BILLING_SUMMARY`, `MART_PAYROLL_SUMMARY`) — these have dedicated refresh logic in BillingEngine and PayrollEngine
- Incremental/partial replay by date range — YAGNI; add when needed
- Checkpoint/resume across quota cutoffs — Rule P1 + `partial: true` return is sufficient
- Auto-trigger from handlers — deliberate CEO action only; handlers should fail loudly
