# BLC Nexus — Reconciliation Memory
# APPEND-ONLY. Never overwrite existing entries.
# Created: 2026-05-08

---

## Project Context

**Mission**: Reconcile Jan–Apr 2026 client timesheets against FACT_WORK_LOGS.
**Source of truth**: Invoices / timesheets (PDF files listed below).
**Goal**: Database ready for go-live by 2026-05-15.
**System**: BLC Nexus V3 (Google Apps Script + Google Sheets).

---

## Business Rules

- Billing based on `work_date`, not completion date
- DESIGNER and QC hours are both billable
- Ignore TEST-* jobs
- Jobs can span billing periods
- Do not merge suffix jobs blindly (e.g. BLC-001-A ≠ BLC-001-B)
- Preserve raw values — no rounding
- Correction entries only — no destructive edits to FACT tables
- Every change must be auditable (append-only FACT writes)
- Reruns must be idempotent — never duplicate rows

---

## Client Processing Order

1. SBS (Structural Building Systems)
2. Norspan
3. Nelson Lumber
4. Matix SK
5. Titan
6. Alberta Truss

**Period order per client**:
Jan 1–15 → Jan 16–31 → Feb 1–15 → Feb 16–28
Mar 1–15 → Mar 16–31 → Apr 1–15 → Apr 16–30

---

## Invoice File Inventory

**Base path**: `/Users/rajnair/Downloads/invoices 2026 BLC/`

### SBS (Structural Building Systems) — 8 files — ALL PERIODS PRESENT

| Period       | Label | Path |
|---|---|---|
| Jan 1–15     | 2026-01 1H | `SBS invoices 2026/Invoice From January 1st to 15th SBS.pdf` |
| Jan 16–31    | 2026-01 2H | `SBS invoices 2026/Invoice From January 16th to 31st SBS.pdf` |
| Feb 1–15     | 2026-02 1H | `SBS invoices 2026/Invoice From February 1st to 15th SBS.pdf` |
| Feb 16–28    | 2026-02 2H | `SBS invoices 2026/Invoice From February 16th to 28th SBS.pdf` |
| Mar 1–15     | 2026-03 1H | `SBS invoices 2026/Invoice From March 1st to 15th SBS.pdf` |
| Mar 16–31    | 2026-03 2H | `SBS invoices 2026/Invoice From March 16th to 31st SBS.pdf` |
| Apr 1–15     | 2026-04 1H | `SBS invoices 2026/Invoice From April 1st to 15th SBS.pdf` |
| Apr 16–30    | 2026-04 2H | `SBS invoices 2026/Invoice From April 16th to 30th SBS.pdf` |

### Norspan — 8 files — ALL PERIODS PRESENT

| Period       | Label | Path |
|---|---|---|
| Jan 1–15     | 2026-01 1H | `Norspan -MB Invoices  2026/Invoice From Jan 1st-15th Norspan.pdf` |
| Jan 16–31    | 2026-01 2H | `Norspan -MB Invoices  2026/Invoice From Jan 16th-31st Norspan.pdf` |
| Feb 1–15     | 2026-02 1H | `Norspan -MB Invoices  2026/Invoice From Feb 1st-15th Norspan.pdf` |
| Feb 16–28    | 2026-02 2H | `Norspan -MB Invoices  2026/Invoice From Feb 16th to 28thNorspan.pdf` |
| Mar 1–15     | 2026-03 1H | `Norspan -MB Invoices  2026/Invoice From March 1st-15th Norspan MB.pdf` |
| Mar 16–31    | 2026-03 2H | `Norspan -MB Invoices  2026/Invoice From March 16th to 31st Norspan.pdf` |
| Apr 1–15     | 2026-04 1H | `Norspan -MB Invoices  2026/Invoice From April 1st-15th Norspan Alpine.pdf` |
| Apr 16–30    | 2026-04 2H | `Norspan -MB Invoices  2026/Invoice From April 16th to 30th Norspan.pdf` |

### Nelson Lumber — 3 files — ⚠️ MISSING Jan + Feb + Mar 1–15

| Period       | Label | Path |
|---|---|---|
| Mar 16–31    | 2026-03 2H | `Nelson Lumber Invoices 2026/Invoice From March 16th to 31st Nelson.pdf` |
| Apr 1–15     | 2026-04 1H | `Nelson Lumber Invoices 2026/Invoice From April 1st-15th Nelson.pdf` |
| Apr 16–30    | 2026-04 2H | `Nelson Lumber Invoices 2026/Invoice From April 16th to 30th Nelson.pdf` |

### Matix SK — 8 files — ALL PERIODS PRESENT

| Period       | Label | Path |
|---|---|---|
| Jan 1–15     | 2026-01 1H | `Matix-SK invoices 2026/Invoice From Jan 1st to 15th Matix.pdf` |
| Jan 16–31    | 2026-01 2H | `Matix-SK invoices 2026/Invoice From Jan 16th to 31stMatix.pdf` |
| Feb 1–15     | 2026-02 1H | `Matix-SK invoices 2026/Invoice From Feb 1st to 15th Matix.pdf` |
| Feb 16–28    | 2026-02 2H | `Matix-SK invoices 2026/Invoice From Feb 16th to 28th Matix.pdf` |
| Mar 1–15     | 2026-03 1H | `Matix-SK invoices 2026/Invoice From March 1st to 15th MatixSK.pdf` |
| Mar 16–31    | 2026-03 2H | `Matix-SK invoices 2026/Invoice From March 16th to 31st Matix.pdf` |
| Apr 1–15     | 2026-04 1H | `Matix-SK invoices 2026/Invoice From April 1st to 15th Matix.pdf` |
| Apr 16–30    | 2026-04 2H | `Matix-SK invoices 2026/Invoice From April 16th to 30th Matix.pdf` |

### Titan — 8 files — ALL PERIODS PRESENT

| Period       | Label | Path |
|---|---|---|
| Jan 1–15     | 2026-01 1H | `invoices TITAN 2026 /Invoice From Jan1st to 15th Titan .pdf` |
| Jan 16–31    | 2026-01 2H | `invoices TITAN 2026 /Invoice From Jan 16th-31st TITAN .pdf` |
| Feb 1–15     | 2026-02 1H | `invoices TITAN 2026 /Invoice From Feb1st to 15th TITAN .pdf` |
| Feb 16–28    | 2026-02 2H | `invoices TITAN 2026 /Invoice From Feb 16th to 28th Titan.pdf` |
| Mar 1–15     | 2026-03 1H | `invoices TITAN 2026 /Invoice From March 1st to 15th titan.pdf` |
| Mar 16–31    | 2026-03 2H | `invoices TITAN 2026 /Invoice From March 16th to 31st Titan.pdf` |
| Apr 1–15     | 2026-04 1H | `invoices TITAN 2026 /Invoice From April 1st to 15th Titan.pdf` |
| Apr 16–30    | 2026-04 2H | `invoices TITAN 2026 /Invoice From April 16th to 30th Titan.pdf` |

### Alberta Truss — 3 files — ⚠️ MISSING Jan + Feb + Mar 1–15

| Period       | Label | Path |
|---|---|---|
| Mar 16–31    | 2026-03 2H | `Alberta Truss Invoices 2026/Invoice From March 16th to 31st AB Truss.pdf` |
| Apr 1–15     | 2026-04 1H | `Alberta Truss Invoices 2026/Invoice From April 1st-15th AB.pdf` |
| Apr 16–30    | 2026-04 2H | `Alberta Truss Invoices 2026/Invoice From April 16th to 30th  AB Truss.pdf` |

---

## Summary

| Client         | Files Found | Periods Present | Gaps |
|---|---|---|---|
| SBS            | 8           | Jan–Apr all 8   | None |
| Norspan        | 8           | Jan–Apr all 8   | None |
| Nelson Lumber  | 3           | Mar 2H, Apr 1H, Apr 2H | Missing Jan, Feb, Mar 1H |
| Matix SK       | 8           | Jan–Apr all 8   | None |
| Titan          | 8           | Jan–Apr all 8   | None |
| Alberta Truss  | 3           | Mar 2H, Apr 1H, Apr 2H | Missing Jan, Feb, Mar 1H |
| **TOTAL**      | **38**      |                 | |

---

## Session Resume Instructions

### Phase 1 (DONE): Reconciliation Reports
All 48 reports are written to reports/reconciliation/. Do not redo them.

### Phase 2 (CURRENT): Data Import — month by month
At the start of every session:
1. Read this file (RECONCILIATION_MEMORY.md)
2. Read MIGRATION_PROGRESS.md — find first PENDING import row
3. Read the corresponding RECON.md report for that period
4. Write a SbsReconFiller_{Mon}{Year}.gs file (src/12-migration/) with all entries
5. Update MIGRATION_PROGRESS.md Import Status → COMPLETE
6. Commit, then move to next period IF tokens allow

### Import order (SBS only — no blockers on actors Jan–Mar 2026):
- ✅ Jan 2026 (1H + 2H) → SbsReconFiller_Jan2026.gs — IN_PROGRESS this session
- ⬜ Feb 2026 (1H + 2H) → SbsReconFiller_Feb2026.gs — next session
- ⬜ Mar 1–15          → SbsReconFiller_Mar2026_1H.gs — next session
- ⚠️ Mar 16–31 + Apr   → BLOCKED (JS/DG/BT actor codes unknown — resolve first)

### How to run each filler (in Apps Script editor):
1. runMigrationEnableOverrides()
2. runFillSbsJan1H()   ← or the relevant month function
3. runFillSbsJan2H()
4. runMigrationDisableOverrides()

---

## Reconciliation Output Location

`/Users/rajnair/blc-nexus/reports/reconciliation/{CLIENT}_{YYYY_MM}_{1H|2H}_RECON.md`

Sections per report:
1. Jobs on invoice NOT in FACT_WORK_LOGS
2. Hours mismatch > 0.25 hrs
3. Jobs in FACT_WORK_LOGS NOT on invoice
4. Summary totals

---

## Confirmed Decisions (do not re-ask)

| # | Decision | Rule |
|---|---|---|
| D1 | SKD (invoice) = SDA (system) | "Sandy Das" = Samar Kumar Das |
| D2 | "job assign & help" rows | Write against placeholder job number. Not design time. Work type = ADMIN. |
| D3 | Duplicate same-person/same-job/same-date entries | Write ALL rows separately if each appears on the invoice |
| D4 | Multiple same-day entries for same job (e.g. BSG 4× on 01-01) | Write all as separate rows if each is on the invoice |
| D5 | RKU (Raj Kumar) actor_role | Use 'QC' — paid for QC hours, no supervisor bonus |
| D6 | BCH job# `2601-038` (Jan 2H, 17-01) | Normalize to `2601-0038` (missing leading zero) |

**Placeholder job number for admin/coordination time (no job#):** `SBS-ADMIN-{YYYY-MM}` — e.g. `SBS-ADMIN-2026-01` for January 2026. Use period-specific placeholder per month.

---

## Change Log

| Date       | Action |
|---|---|
| 2026-05-08 | File created. Inventory completed. 38 invoice files found across 6 clients. |
| 2026-05-08 | SBS 2026-01 1H reconciliation complete. 293 hrs missing from DB. Decisions D1–D4 confirmed. |
| 2026-05-08 | Strategy confirmed: ALL reconciliation reports first (all clients/periods), then single import session. Reports are durable on disk — safe across context resets. |
| 2026-05-15 | All 48 reports COMPLETE. Phase 2 (import) started. D5+D6 confirmed. SbsReconFiller_Jan2026.gs created — 288 entries (107 Jan1H + 181 Jan2H), 871.75 hrs. BLOCKED clients: Norspan/Titan/Nelson/Matix/Alberta/SBS-Apr (unknown actor codes). |
