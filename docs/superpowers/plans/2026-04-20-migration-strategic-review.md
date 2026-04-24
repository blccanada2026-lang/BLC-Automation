# Migration Strategic Review — Stacey → Nexus
**Date:** 2026-04-20  
**Author:** Claude (Principal Architect + Migration Strategist)  
**Status:** AWAITING CEO APPROVAL

---

## 1. Executive Diagnosis

The migration is not broken. The system design is largely sound. But the **execution approach is wrong**: we have been treating Stacey's data as clean enough to auto-migrate in bulk, and we have been discovering, one commit at a time, that it is not.

The last 21 commits are migration patches — header fixes, period-id normalization, partition pre-creation, invalid-row diagnostics, reset tools, raw-import purges. This is the textbook symptom of **data quality debt being paid one surprise at a time**, rather than being catalogued upfront and triaged strategically.

The result: we are always one edge case away from "done," and the edge cases keep coming.

Additionally, the single remaining test failure (`Period-boundary work log has hours = 1.0`) is **not a migration defect**. It is a test harness bug — the assertion compares `r.work_date` (a JavaScript `Date` object returned by Sheets) against a string `'2026-04-01'`. `String(new Date(...))` produces `"Wed Apr 01 2026 00:00:00 GMT-0600..."` — which does not contain `'2026-04-01'`. The data write succeeded; only the check is wrong. This is a one-line fix and should not be treated as a migration blocker.

---

## 2. Root Cause of Current Blockers

### 2a. The Immediate Failure — Test Assertion Bug

**File:** `src/setup/TestRunner.gs:2493`

```javascript
// BROKEN — r.work_date is a Date object, not a string
String(r.work_date).indexOf(periodBoundaryDate) === 0
// String(Date) → "Wed Apr 01 2026 00:00:00 GMT-0600..." → does not match '2026-04-01'
```

**Fix (one line):**
```javascript
Utilities.formatDate(r.work_date instanceof Date ? r.work_date : new Date(r.work_date),
  Session.getScriptTimeZone(), 'yyyy-MM-dd') === periodBoundaryDate
```

This is **not** a migration problem. It is a test problem. It should not have consumed debugging cycles.

### 2b. The Systemic Problem — No Upfront Data Profile

We started migration without a quantified inventory of Stacey data quality. We did not know before starting:
- What fraction of rows have blank Billing_Period?
- What fraction have malformed job numbers?
- How many rows span period boundaries in unexpected ways?
- How many STAFF rows are missing required fields?

We found out row by row, mid-migration, under pressure. This forced a reactive patch cycle instead of a strategic triage.

### 2c. Wrong Debugging Order — Symptoms First

Every fix addressed a specific failing row or edge case rather than asking "how many rows have this problem?" and "what is the cheapest way to handle all of them?" This inverted the correct order:

```
Correct:  Profile → Categorize → Decide → Implement
Actual:   Fail → Patch → Fail again → Patch again
```

### 2d. Weak Observability at Migration Layer

The migration pipeline produces MIGRATION_AUDIT_LOG but there is no aggregate exception report surfacing the full population of unmigratable rows, grouped by failure reason, with severity and suggested owner action. We know individual rows failed; we cannot see the shape of the problem.

---

## 3. Architecture Review

### What Is Strong

| Component | Assessment |
|---|---|
| DAL + WriteGuard | Solid. All writes are gated. No bypass risk. |
| Queue + IntakeService | Correct. Form → STG_RAW_INTAKE → queue → handler is clean. |
| IdempotencyEngine | Properly implemented. Replay is safe to re-run. |
| FACT append-only model | Correct. Migration batch tag isolates migrated rows from live ops. |
| RBAC on replay | CEO-only enforcement is present. |
| Partition pre-creation | Recently fixed — now correct. |
| MigrationReplayEngine replay order | STAFF → CLIENT → JOB → WORK_LOG → BILLING → PAYROLL is the right dependency order. |

### What Is Fragile

| Component | Weakness |
|---|---|
| MigrationNormalizer | Normalization logic has been patched repeatedly for edge cases it should not have to handle — bad period IDs, blank billing periods, bi-monthly format. This is a data quality filter pretending to be a normalizer. |
| StaceyAuditor | Exists but output has not been used to drive a triage decision. Auditor → triage → categorize flow was skipped. |
| MigrationTestRunner | Post-migration tests exist but are decoupled from exception reporting. Pass/fail of tests does not tell us how many records were skipped or quarantined. |
| Test assertions (TestRunner.gs) | Date type handling is inconsistent — Sheets returns `Date` objects, tests compare as strings. This class of bug will recur in any test that touches date fields. |

### What Must Change

1. **Migration scope must be explicitly declared per entity type.** Some Stacey data should never be auto-migrated. This decision must be made and documented before any further normalization runs.
2. **Exception queue must be a first-class artifact.** Not a log line — a queryable sheet with structured fields that a human can act on.
3. **Test harness must canonicalize date comparisons.** All date assertions must use `Utilities.formatDate` or equivalent — never `String(date)`.

---

## 4. Best Migration Strategy Recommendation

### Recommendation: Option 3 + Partial Option 4 (Hybrid)

**For all non-financial entities (STAFF, CLIENT, JOB):**  
→ Auto-migrate with validation. Rows that fail normalization go to an exception queue, not to MIGRATION_NORMALIZED. Human reviews exception queue once; most are fixable with a lookup.

**For financial entities (WORK_LOG, BILLING, PAYROLL):**  
→ Treat as Option 4 (parallel run). Do NOT replay historical BILLING and PAYROLL rows into FACT tables. Instead:
- Migrate WORK_LOG hours (they are fact data needed for ongoing operations).
- Archive historical BILLING and PAYROLL as a read-only reference sheet only — do not replay into FACT_BILLING_EVENTS or FACT_PAYROLL_LEDGER.
- Run first live billing and payroll cycles in Nexus from a clean slate, using migrated WORK_LOG data from the cutover date forward.

**Why this hybrid:**
- Historical billing invoices have already been sent and paid — replaying them into FACT_BILLING_EVENTS adds no operational value and creates ledger reconciliation risk.
- Historical payroll has already been disbursed — same problem.
- WORK_LOGS are the atomic fact units that drive future billing and payroll; migrating them accurately is critical.
- JOB state (current status: IN_PROGRESS, COMPLETED, etc.) must be migrated for operations continuity.

**What this means for the current pipeline:**
- Stop trying to normalize BILLING and PAYROLL rows from Stacey.
- Focus normalization on: STAFF, CLIENT, JOB (current state), WORK_LOG (post-cutover window only).
- Archive pre-cutover billing and payroll in a `STG_LEGACY_ARCHIVE` sheet for reference.

---

## 5. Data Migration Plan

### Category A — Must Auto-Migrate (operational continuity at risk without it)

| Entity | Target | Validation Required |
|---|---|---|
| Staff roster | DIM_STAFF_ROSTER | person_code, email, role, rates must all be present |
| Client master | DIM_CLIENT_MASTER | client_code, name, billing currency |
| Client rates | DIM_CLIENT_RATES | client_code must resolve; rate must be numeric |
| Active jobs (IN_PROGRESS, ON_HOLD) | FACT_JOB_EVENTS | job_number, client_code, assigned_designer must resolve |
| Work logs (cutover window: last 60 days) | FACT_WORK_LOGS | job_number must resolve; hours must be numeric; period_id must be derivable |

### Category B — Auto-Migrate With Validation Gate (safe to migrate; exceptions to queue)

| Entity | Target | Exception Condition |
|---|---|---|
| Completed jobs (last 6 months) | FACT_JOB_EVENTS | Missing client_code or job_number → exception queue |
| Work logs (60–180 days ago) | FACT_WORK_LOGS | Blank billing period + no derivable YYMM → exception queue |
| Staff banking details | DIM_STAFF_BANKING | Missing required OFX fields by country → exception queue |

### Category C — Exception Queue (human decision required)

- Staff rows missing person_code or pay rates
- Jobs with no client mapping
- Work logs older than 180 days with blank billing period
- Duplicate job numbers in Stacey

### Category D — Archive Only (do not replay into live FACT tables)

- Historical BILLING rows (pre-cutover invoices already issued)
- Historical PAYROLL rows (pre-cutover pay already disbursed)
- QC events older than 6 months

### Category E — Do Not Migrate

- Stacey internal audit logs
- Stacey form submission raw history
- Test or demo data (identifiable by job number prefix or known test accounts)

---

## 6. Exception Reporting Design

A sheet named `MIGRATION_EXCEPTION_REPORT` should be created as part of the migration pipeline output. This is not a log — it is an actionable triage document.

### Columns

| Column | Type | Description |
|---|---|---|
| `exception_id` | String | Auto-generated unique ID |
| `source_table` | String | Which Stacey table the row came from |
| `source_row_ref` | String | Row number or source ID in Stacey |
| `entity_type` | Enum | STAFF \| CLIENT \| JOB \| WORK_LOG \| BILLING \| PAYROLL |
| `failure_reason` | String | Human-readable failure reason (e.g. "blank period_id, YYMM not derivable") |
| `raw_data_snapshot` | JSON | Key fields from the raw Stacey row |
| `suggested_fix` | String | What a human should do (e.g. "look up job in legacy system and enter period manually") |
| `owner` | Enum | CEO \| PM \| SYSTEM |
| `severity` | Enum | BLOCKER \| HIGH \| MEDIUM \| LOW |
| `retry_eligible` | Boolean | Can this row be retried after fix? |
| `retry_status` | Enum | PENDING \| RETRIED \| RESOLVED \| ABANDONED |
| `created_at` | Timestamp | When the exception was logged |
| `resolved_at` | Timestamp | When it was resolved (blank if open) |
| `resolved_by` | String | Email of resolver |
| `notes` | String | Free-text notes from human reviewer |

### Severity Rules

| Severity | Condition |
|---|---|
| BLOCKER | Staff row with no pay rate; Active job with no client mapping |
| HIGH | Work log with unresolvable period_id |
| MEDIUM | Completed job with missing optional fields |
| LOW | Historical billing row excluded from migration by design |

---

## 7. Risk Matrix

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Work log period_id wrong → billing errors in first live cycle | Medium | High | Validate every replayed WORK_LOG against a period existence check before writing |
| Staff pay rates missing → payroll run fails at first real run | Medium | High | Mark STAFF exception as BLOCKER; do not complete cutover until zero BLOCKERs in exception report |
| Duplicate job numbers replayed → duplicate FACT events | Low | High | IdempotencyEngine already handles this; verify idem key covers job_number + event_type |
| Historical billing rows accidentally replayed → ledger inflation | Low | Critical | Do not migrate BILLING to FACT — archive only |
| Cutover timing: live jobs in-flight during migration window | High | Medium | Run cutover during a low-volume window (weekend); freeze new job submissions for 4 hours during replay |
| Test harness date comparison bugs mask real failures | High | Medium | Fix all date assertions before next full test run |
| Stacey access revoked before migration complete | Low | High | Export full Stacey data to Google Sheets backup before starting any replay phase |

---

## 8. Execution Plan (Post-Approval)

This plan does not start until CEO approval is received.

### Phase 0 — Hotfixes (no migration work)
1. Fix TestRunner.gs date assertion bug (1-line fix, `Utilities.formatDate`)
2. Verify all 27 tests pass with zero failures

### Phase 1 — Data Profile (1 day)
3. Run StaceyAuditor across all Stacey tables
4. Produce row counts by entity type, by validation status (valid / fixable / unmigratable)
5. Produce a written triage decision for each entity type (which category: A/B/C/D/E)
6. CEO reviews and approves triage decisions

### Phase 2 — Exception Report Infrastructure (1 day)
7. Create `MIGRATION_EXCEPTION_REPORT` sheet with schema above
8. Modify MigrationNormalizer to write to exception report instead of failing silently
9. Add exception severity classifier

### Phase 3 — Scoped Normalization (1 day)
10. Run normalization for Category A entities only (STAFF, CLIENT, active JOBs)
11. Review exception report — resolve all BLOCKERs before proceeding
12. Run normalization for Category B entities (completed JOBs, recent WORK_LOGs)
13. Review exception report again

### Phase 4 — Replay (1 day)
14. Replay Category A in dependency order: STAFF → CLIENT → JOB → WORK_LOG
15. Run MigrationReconciler — verify row counts match
16. Run MigrationTestRunner — verify all post-migration assertions pass

### Phase 5 — Archive (0.5 day)
17. Export Stacey BILLING and PAYROLL rows to `STG_LEGACY_ARCHIVE` sheet (read-only)
18. Do NOT replay these into FACT tables

### Phase 6 — Parallel Run (1 week)
19. Run first live billing cycle in Nexus using migrated WORK_LOG data
20. Compare billing totals against last Stacey billing run (spot-check 3–5 accounts)
21. Run first live payroll run in Nexus
22. Compare payroll totals against last Stacey payroll run per staff member
23. Any discrepancy → investigate before proceeding

### Phase 7 — Cutover
24. Freeze Stacey job submissions
25. Final Stacey export and archive
26. Announce Nexus as live system to all staff
27. Remove Stacey form links; replace with Nexus portal

---

## 9. Codex Readiness Check

**Codex is not installed in this environment.**

Running `which codex` and `which openai` both return "not found." The `.mcp.json` file shows only the `code-review-graph` MCP server — no OpenAI tooling is configured.

**Should it be added?**

Not for this project at this time. Here is why:

- BLC Nexus runs entirely in Google Apps Script, a server-side JavaScript environment with no npm, no Node.js runtime, no file-system access, and Google Sheets as the database. Codex is optimized for standard development environments where it can run tests, install packages, and execute code locally.
- Claude Code (this session) already has full read/write access to the codebase, MCP tools for graph analysis, and the ability to execute `clasp` commands for deployment. That covers the entire development loop.
- Adding Codex would introduce a second agent with overlapping scope and no clear division of responsibility — more coordination overhead than value.

**If Codex were to be added later:** The most productive use would be as a standalone code-generation assistant for boilerplate GAS modules where no context about the live Sheets environment is needed. It is not suited for migration debugging, data profiling, or anything that requires live Sheets access.

**Recommendation: Do not install Codex for this project.**

---

## 10. Approval Gate

The above strategy changes the scope, reduces the migration surface area, and front-loads data quality decisions that were previously being made reactively under debugging pressure.

Key decisions requiring CEO approval before execution begins:

- [ ] **Approve triage categories** — specifically: BILLING and PAYROLL as archive-only (Category D), not replayed into FACT
- [ ] **Approve exception reporting design** — sheet schema, severity rules, ownership model
- [ ] **Approve cutover timing** — parallel run duration (suggested: 1 week), freeze window
- [ ] **Approve Phase 0 hotfix** — fix the TestRunner date assertion bug immediately (no migration impact, just test harness)

---

**WAITING FOR CEO APPROVAL BEFORE CODING**
