# ReportingEngine — MART Refresh & Looker Studio Layer Design Spec

**Date:** 2026-04-15
**Status:** Approved
**Author:** Brainstorming session

---

## Goal

Build `ReportingEngine` — aggregates data from existing FACT and VW tables into four MART tables optimised for Looker Studio consumption. Runs nightly via time-based trigger and on-demand via CEO portal button. Financial data is CEO-only; operational data (hours, headcount) is accessible to PM and TL.

---

## Architecture

### Approach

Single-pass aggregation. Read source tables (MART_BILLING_SUMMARY, MART_PAYROLL_SUMMARY, VW_DESIGNER_WORKLOAD, VW_JOB_CURRENT_STATE, FACT_WORK_LOGS partitions) into in-memory maps keyed by period. Merge maps. Clear and rewrite all four MART tables in one batch each. Consistent with the existing rebuild pattern used by BillingEngine, PayrollEngine, and EventReplayEngine.

### Files

| File | Change |
|---|---|
| `src/11-reporting/ReportingEngine.gs` | New — all aggregation and MART write logic |
| `src/07-portal/Portal.gs` | Add `portal_refreshDashboard()` |
| `src/07-portal/PortalView.html` | Add "Refresh Dashboard" button + JS handler |
| `src/00-foundation/Config.gs` | Add `MART_TEAM_SUMMARY`, `MART_DESIGNER_SUMMARY`, `MART_ACCOUNT_SUMMARY` to `Config.TABLES` |
| `src/01-dal/DAL.gs` | Add `ReportingEngine` write permission for all three new MART tables; add `MART_DASHBOARD` write permission for `ReportingEngine` |
| `src/02-security/RBAC.gs` | Add `MART_DASHBOARD` to `FINANCIAL_TABLES` (CEO-only read); do NOT add the three non-financial MARTs |
| `src/setup/SetupScript.gs` | Add schema for `MART_TEAM_SUMMARY`, `MART_DESIGNER_SUMMARY`, `MART_ACCOUNT_SUMMARY`; add `installReportingTrigger()` |
| `src/setup/TestRunner.gs` | Add `testReportingEngine()` diagnostic |

### Module Tier

`src/11-reporting/` — same tier as EventReplayEngine. Reads FACT tables (T5), VW tables, and MART tables (T11 inputs); writes MART tables consumed by Looker Studio.

### Public API

```javascript
ReportingEngine.refreshDashboard(actorEmail)
// Returns:
// {
//   periods:         number,
//   mart_dashboard:  { written: number, cleared: number },
//   mart_team:       { written: number, cleared: number },
//   mart_designer:   { written: number, cleared: number },
//   mart_account:    { written: number, cleared: number },
//   partial:         boolean,
//   elapsed_ms:      number
// }

ReportingEngine.refreshDashboardSystem()
// Called by nightly trigger — no actor, no RBAC check.
// Returns same shape as refreshDashboard.
```

### RBAC

Portal-triggered refresh: CEO only — `RBAC.resolveActor(email)` + `RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN)` + `RBAC.enforceFinancialAccess(actor)`.

Nightly trigger: runs as system job via `refreshDashboardSystem()` — no actor context, no RBAC check. Trigger is installed by CEO running `installReportingTrigger()` once from Apps Script editor.

---

## MART Tables

### MART_DASHBOARD (CEO only)

One row per period. Contains full financial + operational summary.

| Column | Source | Notes |
|---|---|---|
| `period_id` | key | e.g. `2026-03` |
| `total_revenue_cad` | MART_BILLING_SUMMARY | Sum of `total_amount` where `currency = CAD` |
| `total_revenue_usd` | MART_BILLING_SUMMARY | Sum of `total_amount` where `currency = USD` |
| `total_payroll_inr` | MART_PAYROLL_SUMMARY | Sum of `total_pay` (all INR) |
| `design_hours` | VW_DESIGNER_WORKLOAD | Sum of `total_quantity` |
| `active_designers` | MART_PAYROLL_SUMMARY | Distinct count of `person_code` |
| `updated_at` | timestamp | ISO string |

Sheet protection: CEO-only. Financial data — same protection level as FACT_BILLING_LEDGER and MART_BILLING_SUMMARY.

### MART_TEAM_SUMMARY (CEO + PM + TL)

One row per period. Non-financial operational summary.

| Column | Source |
|---|---|
| `period_id` | key |
| `design_hours` | VW_DESIGNER_WORKLOAD — sum of `total_quantity` |
| `active_designers` | MART_PAYROLL_SUMMARY — distinct `person_code` count |
| `updated_at` | timestamp |

### MART_DESIGNER_SUMMARY (CEO + PM + TL)

One row per designer per period.

| Column | Source |
|---|---|
| `period_id` | from VW_DESIGNER_WORKLOAD |
| `person_code` | from VW_DESIGNER_WORKLOAD |
| `design_hours` | `total_quantity` from VW_DESIGNER_WORKLOAD |
| `updated_at` | timestamp |

### MART_ACCOUNT_SUMMARY (CEO + PM + TL)

One row per client account per period. Non-financial (hours only — no rates or billing amounts).

| Column | Source |
|---|---|
| `period_id` | derived from FACT_WORK_LOGS partition |
| `client_code` | looked up via VW_JOB_CURRENT_STATE (`job_number → client_code`) |
| `design_hours` | sum of `quantity` from FACT_WORK_LOGS for that client + period |
| `updated_at` | timestamp |

**Join logic:** ReportingEngine reads VW_JOB_CURRENT_STATE once to build a `job_number → client_code` lookup map. Then reads all FACT_WORK_LOGS partitions (oldest first, same partition discovery pattern as EventReplayEngine). For each work log row, resolves `client_code` from the lookup map and aggregates hours by `client_code + period_id`.

---

## Data Flow

```
MART_BILLING_SUMMARY    ──► revenue map (period → CAD/USD totals)
MART_PAYROLL_SUMMARY    ──► payroll map (period → INR total, headcount)
VW_DESIGNER_WORKLOAD    ──► designer map (person+period → hours)
VW_JOB_CURRENT_STATE    ──► job lookup map (job_number → client_code)
FACT_WORK_LOGS|YYYY-MM  ──► account map (client+period → hours)
                                    │
                                    ▼
                         merge by period_id
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
            MART_DASHBOARD  MART_TEAM_SUMMARY  MART_DESIGNER_SUMMARY
            MART_ACCOUNT_SUMMARY
```

---

## Quota Guard (Rule P1)

Quota checked every 20 rows in all loops (FACT_WORK_LOGS partition loop, VW reads). If `HealthMonitor.isApproachingLimit()`:
- Log `REPORTING_QUOTA_CUTOFF`
- Return `{ partial: true }` — portal shows yellow toast: `"Partial refresh — quota limit reached, re-run to complete"`

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| No data yet (empty MARTs/VW) | Write 0 rows, return success — not an error |
| FACT_WORK_LOGS partition missing | Skip and log `REPORTING_PARTITION_SKIPPED`, continue |
| job_number not in VW_JOB_CURRENT_STATE | Skip that work log row, log `REPORTING_UNKNOWN_JOB` |
| Sheet clear fails | Log warn, continue — appends on stale data (non-critical for reporting) |
| Quota cutoff | Return `{ partial: true }`, yellow toast |
| RBAC failure | Throws — portal shows red toast |

---

## Nightly Trigger

Installed once by CEO running `installReportingTrigger()` from Apps Script editor. Creates a daily time-based trigger pointing at `refreshDashboardSystem`. Trigger fires between 2–3am (low-traffic window).

```javascript
function installReportingTrigger() {
  ScriptApp.newTrigger('refreshDashboardSystem')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
}
```

`refreshDashboardSystem` is a top-level function in `ReportingEngine.gs` that calls `ReportingEngine.refreshDashboardSystem()` — required because Apps Script triggers can only point to top-level functions.

---

## Portal Wiring

### Button

Added to CEO toolbar (`canRunPayroll` gate):

```html
<button class="btn-muted btn-sm" id="btn-refresh-dashboard" style="display:none">🔄 Refresh Dashboard</button>
```

### Confirmation Dialog

```
Refresh Looker Studio dashboard data?

This rebuilds MART_DASHBOARD, MART_TEAM_SUMMARY,
MART_DESIGNER_SUMMARY, and MART_ACCOUNT_SUMMARY
from current FACT and VW data.

Run time: ~15–30 seconds depending on data volume.
```

### Toast Messages

| Result | Toast | Colour |
|---|---|---|
| Success | `"Dashboard refreshed in Xs — N periods updated"` | Green |
| Partial | `"Partial refresh — quota limit reached, re-run to complete"` | Yellow |
| Failure | `"Error: <message>"` | Red |

No `loadLeaderDashboard()` call needed — this refresh updates Looker Studio MART tables, not portal data.

### `portal_refreshDashboard()` in Portal.gs

```javascript
function portal_refreshDashboard() {
  var email  = Session.getActiveUser().getEmail();
  var result = ReportingEngine.refreshDashboard(email);
  return JSON.stringify(result);
}
```

---

## Looker Studio Setup (one-time, no code)

Two reports, configured once by CEO in Looker Studio UI:

**CEO Dashboard** — data source: `MART_DASHBOARD`
- Revenue trend (line chart: period_id × total_revenue_cad/usd)
- Payroll cost trend (line chart: period_id × total_payroll_inr)
- Hours trend (bar chart: period_id × design_hours)
- Headcount (line chart: period_id × active_designers)

**Team Dashboard** — data sources: `MART_TEAM_SUMMARY`, `MART_DESIGNER_SUMMARY`, `MART_ACCOUNT_SUMMARY`
- Total hours per period (bar chart)
- Hours per designer per period (table or bar chart)
- Hours per account per period (bar chart)

Not shared with PM/TL — CEO shares Team Dashboard only when ready.

---

## Future Extensions (out of scope for this launch)

- `cost_per_sqft_truss`, `cost_per_sqft_floor`, `cost_per_sqft_wall` columns in MART_DASHBOARD — add when product quantity units (sqft) are captured in FACT_WORK_LOGS
- Wall panels product (`WALL_PANEL`) — same pattern as truss/floor once product is added
- Incremental refresh (only recompute periods with new data) — YAGNI; add when nightly full rebuild is too slow

---

## Testing — `testReportingEngine()`

Added to `src/setup/TestRunner.gs`. Run from Apps Script editor.

1. Call `ReportingEngine.refreshDashboard(actorEmail)`
2. Assert return shape has `periods`, `mart_dashboard.written`, `mart_team.written`, `mart_designer.written`, `mart_account.written`, `partial`, `elapsed_ms`
3. Assert each MART sheet row count matches its `.written` value
4. Assert idempotency — second run produces identical row counts
5. `pass_()` / `fail_()` via TestRunner helpers

---

## Out of Scope

- Incremental/partial refresh by date range — full rebuild is sufficient at current data volumes
- Looker Studio embed in portal — connect via Looker Studio UI, not embedded iframe
- MART_DASHBOARD for non-CEO roles — split into MART_TEAM_SUMMARY (non-financial) for PM/TL access
- Auto-trigger from BillingEngine or PayrollEngine — nightly trigger is sufficient and avoids cross-module coupling
