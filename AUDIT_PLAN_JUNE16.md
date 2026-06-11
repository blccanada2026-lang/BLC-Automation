# Pre-Cutover Audit Plan — June 16, 2026
## BLC Nexus: Data Integrity Verification Before Designer Cutover

**Goal:** Identify and correct all data issues before designers start logging hours in the portal. A bad baseline corrupts June payroll, Q2 bonus calculations, and audit trails permanently.

**Deadline:** All phases complete by EOD June 15, 2026.

---

## Phase A — Q1 2026 Bonus Hours Audit (CRITICAL)

The Q1 bonus was calculated. There is a reported mismatch between the system total and manual calculations. This must be reconciled before June payroll runs.

### A1. Run Per-Designer Diagnostic
In Apps Script editor → Run:
```
runQ1BonusAuditDetailed()
```
This prints a per-designer table: Jan hours / Feb hours / Mar hours / Q1 total / QC hours / flags.

**Flags to investigate:**
- `MISSING_CODE` — rows used `person_code` fallback instead of `actor_code`. These count correctly in the engine but indicate a data quality issue.
- `DUPE_ROWS` — the same hours appear more than once. This inflates totals.
- `NOT_IN_ROSTER` — hours logged for a code not in DIM_STAFF_ROSTER. These were counted in the bonus engine but may be test/migration artifacts.
- `INACTIVE` — hours for a designer marked inactive. Should not receive bonus.

### A2. Cross-Check Against Manual File
User to provide manual calculations file (Google Sheet or Excel).
Compare: each designer's Q1 total from the system vs. manual.

**Columns to match:** person_code / name / Q1 design hours total.

Discrepancies fall into 3 categories:
| Category | Likely cause | Fix |
|---|---|---|
| System > manual | Duplicate rows, test data counted | Remove duplicate rows (new VOID event in FACT_WORK_LOGS) |
| System < manual | CSV rows not imported, wrong actor_code | Add missing rows via corrective import |
| System correct, manual wrong | Manual calculation error | Confirm with manual source |

### A3. Duplicate Row Identification
Run also:
```
runDiagnoseQ1Hours()
```
Existing function shows per-period row counts and totals. Spike in row count vs expected = likely duplicate import.

If duplicates found: amend them using `WORK_LOG_VOID` event type — do NOT delete rows.

### A4. Bonus Already Paid — Correction Path
If Q1 bonus was already written to FACT_PAYROLL_LEDGER:
- Do NOT modify existing ledger rows (append-only)
- If underpaid: write new `QUARTERLY_BONUS_ADJUSTMENT` row for the delta
- If overpaid: write `QUARTERLY_BONUS_CLAWBACK` row (negative amount) — discuss with Raj before doing this

---

## Phase B — Work Log Completeness (Jan–May 2026)

Verify the migration brought in all work log data correctly.

### B1. Row Count Verification
For each partition, run a check (or query from Apps Script):
```
runDiagnoseQ1Hours()  // Jan/Feb/Mar
```
Then manually check:
- `FACT_WORK_LOGS|2026-04` — expected from CSV import
- `FACT_WORK_LOGS|2026-05` — expected from CSV import (1997 rows confirmed per SESSION_LOG.md)

**Expected:** Total hours per month should roughly match Stacey V2 source sheets. If a month is significantly lower, rows were dropped during import.

### B2. Actor Code Coverage
```
runQ1BonusAuditDetailed()
```
Any `NOT_IN_ROSTER` codes = rows imported with an actor alias not resolved to a person_code. Example: "Bittuu" alias issue encountered during migration.

Check: are all aliases in the Stacey source mapped to canonical person_codes in the importer?

### B3. April and May Hours (Not in Bonus Engine)
April and May are not in the Q1 bonus. But they feed:
- June payroll base (hours-based)
- Q2 bonus (if we run it for Apr–Jun)

Spot-check at least 3 designers: verify Apr and May hour totals look reasonable vs Stacey source.

---

## Phase C — Test Data Cleanup

### C1. Test Jobs in VW_JOB_CURRENT_STATE
Known test data remaining in VW_JOB_CURRENT_STATE (per PROJECT_MEMORY.md §8):
- `designer@blc.com` — 54 jobs (email-format, filtered in CEO briefing but visible in portal)
- `BTD` — test person_code
- `SNA` — test person_code

**Action:** Purge these from VW_JOB_CURRENT_STATE. Since VW is a projection (acceptable to write directly per migration decision), delete these rows.

Steps:
1. Open VW_JOB_CURRENT_STATE in Google Sheets
2. Filter `allocated_to` = `designer@blc.com` → delete rows
3. Filter `allocated_to` = `BTD` → delete rows
4. Filter `allocated_to` = `SNA` → delete rows
5. Also check FACT_JOB_EVENTS for matching event rows — if they have TEST- prefixed job_ids they can be left (they won't appear in VW after VW rows are removed)

### C2. QC Backlog Inflation
QC backlog shows ~128 items but many are test jobs. After C1 cleanup, recount. Target: only real jobs with real person_codes should remain.

### C3. Test Data in FACT_WORK_LOGS
Run:
```
runQ1BonusAuditDetailed()
```
Any `NOT_IN_ROSTER` designers with hours = likely test or alias rows. Void these if confirmed test data.

---

## Phase D — Final System Verification

### D1. MART Accuracy
Run:
```
runMartRefresh()
```
After cleanup in Phase C, refresh all 4 MARTs and verify Looker Studio dashboards reflect clean data.

### D2. VW_JOB_CURRENT_STATE Accuracy
After test data purge and Stacey sync, verify:
- 168 active real jobs (as imported during migration)
- No email-format `allocated_to` entries
- All states are valid state machine values

### D3. Stacey Sync Still Running
Confirm the sync trigger is still active and running cleanly (check Apps Script executions — should show `runStaceySyncJob` every 30 min with no errors).

### D4. CEO Email Verification
Run `runTestCEODailyBriefing()` and confirm output looks clean — no test designers in "hours not logged" section.

---

## Phase E — Cutover Readiness Checklist (June 16 Morning)

Run through this in order on the morning of June 16:

- [ ] All Phase A–D items complete
- [ ] `runTestCEODailyBriefing()` output looks clean
- [ ] Stacey sync shows no errors in last 24 hours
- [ ] VW_JOB_CURRENT_STATE has no test data
- [ ] Q1 bonus mismatch resolved (or documented with adjustment plan)
- [ ] **Run `runRemoveStaceySyncTrigger()`** ← CRITICAL, do this BEFORE the email
- [ ] Confirm trigger removed: Apps Script editor → Triggers → verify `runStaceySyncJob` is gone
- [ ] Send cutover email to all designers (portal URL only)
- [ ] Monitor for first portal hour submissions (should appear in STG_PROCESSING_QUEUE within minutes)
- [ ] Verify queue processor picks them up (FACT_WORK_LOGS|2026-06 partition created)

---

## Audit Execution Order

| # | Action | Function / Step | Prerequisite |
|---|---|---|---|
| 1 | Run per-designer hours diagnostic | `runQ1BonusAuditDetailed()` | None |
| 2 | Cross-check against manual file | Manual comparison | Step 1 output + user file |
| 3 | Identify and void duplicate rows | Manual + WORK_LOG_VOID events | Step 2 discrepancies |
| 4 | Purge test data from VW | Manual sheet edit | None |
| 5 | Refresh MARTs | `runMartRefresh()` | Step 4 |
| 6 | Verify CEO briefing output | `runTestCEODailyBriefing()` | Step 5 |
| 7 | Remove sync trigger | `runRemoveStaceySyncTrigger()` | All above complete |
| 8 | Send cutover email | Manual email | Step 7 confirmed |

---

## Open Questions (Resolve Before June 15)

1. **Q1 bonus adjustment method**: If mismatch found and bonus was already distributed, do we issue corrections in Q2 payroll or as a separate QUARTERLY_BONUS_ADJUSTMENT event in June?
2. **Manual calculations file**: Which designers are showing the biggest discrepancy? That narrows the search to specific actor_code mappings or partition imports.
3. **April/May hours**: Were these imported from Stacey CSVs? Which CSVs and on what date? (SESSION_LOG.md mentions JuneWorkLogImporter but Apr/May import history unclear.)
4. **"Bittuu" alias**: Was this mapping confirmed and corrected in the actor_code column, or are there still rows with the alias as the code?
