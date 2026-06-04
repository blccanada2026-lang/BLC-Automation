# BLC Nexus — Staff Portal Cutover Plan
> Last updated: 2026-06-04

## Status: IN PROGRESS — Pre-cutover phase

---

## What We Know

### Stacey V2 Sheet
- URL: https://docs.google.com/spreadsheets/d/1EIuLg4dJjePPOSinMcGZocKGpe2wnjXI2pEFflD_f9U/edit
- Read via Google Drive MCP (connected 2026-06-04)
- **Daily work log stopped March 11, 2026** — 247 rows total, last entry 2026-03-11
- From April onwards hours went into CSV timesheet files (same format as Jan–May migration)

### Active Jobs in Stacey Master Table
| Status | Count |
|---|---|
| Picked Up | 196 |
| In Design | 25 |
| Submitted For QC | 112 |
| On Hold | 2 |
| **Total to import into V3** | **~335** |

### Stacey Job Master Table Columns
`Job_Number | Client_Code | Client_Name | Designer_Name | Product_Type | Allocated_Date | Start_Date | Expected_Completion | Actual_Completion | Status | Design_Hours_Total | QC_Hours_Total | Total_Billable_Hours | Rework_Hours_Major | Rework_Hours_Minor | QC_Lead | QC_Status | Billing_Period | Invoice_Month | SOP_Acknowledged | Reallocation_Flag | Previous_Designer | Rework_Flag | Rework_Count | On_Hold_Flag | On_Hold_Reason | Last_Updated | Last_Updated_By | Notes | Row_ID | Is_Test | Is_Imported`

### Stacey Daily Work Log Columns (for reference — no longer in use)
`Timestamp | Job Number | Your Name | Date Worked | Product Type | Hours Worked | Is this job ready for QC? | Notes | Daily SOP Confirmation | Square Footage`

### V3 PROD State (as of 2026-06-04)
- FACT_WORK_LOGS|2026-05: 1997 rows ✅ (both halves migrated)
- FACT_WORK_LOGS|2026-06: 0 rows (not started)
- VW_JOB_CURRENT_STATE: 1 row (test job only) — no active jobs
- FACT_JOB_EVENTS: sparse — historical jobs only, all terminal states

---

## What Needs to Be Built

### 1. StaceyJobImporter.gs (PRIORITY 1)
**Purpose:** Read active jobs from Stacey master table → write FACT_JOB_EVENTS  
**Source:** Stacey sheet, master job table  
**Filter:** Status IN (Picked Up, In Design, Submitted For QC, On Hold) AND Is_Test != Yes  
**Events to create per job:**
- JOB_CREATED (use Allocated_Date)
- JOB_ASSIGNED (use Allocated_Date, assigned designer from Designer_Name)
- JOB_STARTED (use Start_Date, status = Picked Up/In Design)
- JOB_SUBMITTED_FOR_QC (if Status = Submitted For QC)
**Idempotency key:** `STACEY_JOB|{Job_Number}`  
**Status:** ❌ Not built

### 2. JuneWorkLogImporter.gs (PRIORITY 2 — BATCH-004)
**Purpose:** Import June 1–today hours from CSV timesheet files  
**Source:** Client CSV files (same format as May: `Date | Job# | Billable Hours | Designer | Description`)  
**Drive folder:** "BLC June Timesheets" (to be created by user)  
**Date filter:** Only rows where Date >= 2026-06-01  
**Idempotency key:** `BATCH-004|FILE-{filename}|ROW-{n}`  
**Status:** ❌ Not built

---

## Cutover Sequence

```
PHASE 1 — Build & import (current phase)
  [ ] Build StaceyJobImporter.gs
  [ ] Run StaceyJobImporter → 335 active jobs in FACT_JOB_EVENTS
  [ ] Rebuild VW_JOB_CURRENT_STATE (runRebuildViews)
  [ ] Verify: CEO logs in, sees job list populated
  [ ] Build JuneWorkLogImporter.gs (BATCH-004)
  [ ] Upload June 1-today CSVs to "BLC June Timesheets" Drive folder
  [ ] Run JuneWorkLogImporter A→E
  [ ] Verify FACT_WORK_LOGS|2026-06 row count

PHASE 2 — Parallel running (~1 week)
  [ ] Staff continue using Stacey CSV timesheets (V2)
  [ ] Portal is VIEW-ONLY — no hour submissions yet
  [ ] CEO/TL verify portal shows correct jobs and hours
  [ ] NO June payroll or billing run in V3 until Phase 3 complete
  [ ] Hard rule: STOP all CSV imports once any team goes portal-live

PHASE 3 — Cutover (target: Monday after Phase 1 complete)
  [ ] Final delta import: June parallel-week CSVs (date filter: after snapshot date)
  [ ] Verify June FACT row count matches Stacey totals
  [ ] Send cutover email to all staff (portal URL + instructions)
  [ ] Staff log first hours via portal
  [ ] Monitor queue daily (pending/failed items)

PHASE 4 — Confirm & payroll
  [ ] First portal-only week verified (no missing staff)
  [ ] Run June payroll from V3 (first live payroll)
```

---

## Key Risks (summary)
1. Duplicate rows if portal used + CSV imported simultaneously → **rule: stop CSV imports when team goes live**
2. June payroll run before delta import complete → **rule: no payroll until Phase 3 verified**
3. Staff use portal during parallel week → **rule: portal is view-only until cutover email sent**
4. Active jobs not visible → **fixed by StaceyJobImporter**

---

## Session Log
2026-06-04 | Read Stacey sheet via Drive MCP. Found 335 active jobs, daily log stopped March. June hours in CSV files not Stacey. Plan documented. | Next: build StaceyJobImporter.gs | Clean
