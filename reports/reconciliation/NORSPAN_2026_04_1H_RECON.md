# Norspan Reconciliation — Apr 1–15 2026 (2026-04 1H)
# Generated: 2026-05-09
# Source: Invoice From April 1st-15th Norspan Alpine.pdf
# Period: 2026-04-01 to 2026-04-15
# Client: Norspan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| BC-Bharath Charles | 6 |
| RG-Ravi Gummadi | 20 |
| VK-Vani | 10.25 |
| SG-Sarty Ghosh | 0 |
| **TOTAL** | **36.25** |

---

## Notes

- BCH dates in DD-MM-YYYY format, converted to YYYY-MM-DD below.
- BCH all QC this period.
- RG has both DESIGNER and QC entries this period.
- VK all DESIGNER this period.
- SG-Sarty Ghosh listed in the employee summary table but has zero line items and 0 hrs this period.
- Q260210A and Q260202G — letter suffixes are part of the job number (consistent with prior periods).

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| BC | BCH | Confirmed |
| RG | ??? | Ravi Gummadi — actor code UNKNOWN (ongoing blocker) |
| VK | ??? | Vani KV — actor code UNKNOWN (ongoing blocker) |
| SG | SGO | Confirmed — 0 hrs this period |

---

### RG — 19 rows, 20 hrs

⚠️ Actor code UNKNOWN. All 20 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-02 | Q260209 | DESIGNER | 0.5 | |
| 2026-04-02 | Q260211 | DESIGNER | 0.5 | |
| 2026-04-07 | Q260210 | DESIGNER | 0.75 | |
| 2026-04-07 | Q260212 | DESIGNER | 0.75 | |
| 2026-04-08 | Q260216 | DESIGNER | 4 | |
| 2026-04-08 | Q260200 | DESIGNER | 0.5 | |
| 2026-04-09 | Q260202 | DESIGNER | 2 | |
| 2026-04-10 | Q260210A | DESIGNER | 1 | A suffix is part of job number |
| 2026-04-10 | Q260202G | DESIGNER | 0.5 | G suffix is part of job number |
| 2026-04-10 | Q260230 | DESIGNER | 0.25 | |
| 2026-04-13 | Q260234 | DESIGNER | 0.5 | |
| 2026-04-13 | Q260210 | QC | 0.25 | |
| 2026-04-13 | Q260210A | QC | 0.25 | A suffix is part of job number |
| 2026-04-13 | Q260212 | QC | 0.5 | |
| 2026-04-13 | Q260216 | QC | 0.75 | |
| 2026-04-13 | Q260219 | QC | 1 | |
| 2026-04-13 | Q260234 | QC | 0.25 | |
| 2026-04-14 | Q260237 | DESIGNER | 4 | |
| 2026-04-15 | Q260239 | DESIGNER | 1.75 | |

**Subtotal: 20 hrs — BLOCKED: actor code unknown**

---

### VK — 8 rows, 10.25 hrs (all DESIGNER)

⚠️ Actor code UNKNOWN. All 10.25 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | Q260203 | DESIGNER | 3 | |
| 2026-04-02 | Q260204 | DESIGNER | 1 | |
| 2026-04-03 | Q260204 | DESIGNER | 0.75 | |
| 2026-04-08 | Q260218 | DESIGNER | 1 | |
| 2026-04-08 | Q260219 | DESIGNER | 1 | |
| 2026-04-09 | Q260218 | DESIGNER | 1 | |
| 2026-04-10 | Q260160 | DESIGNER | 1 | |
| 2026-04-11 | Q260219 | DESIGNER | 1.5 | |

**Subtotal: 10.25 hrs — BLOCKED: actor code unknown**

---

### BCH — 9 rows, 6 hrs (all QC)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | Q260181 | QC | 1.5 | |
| 2026-04-01 | Q260201 | QC | 0.5 | |
| 2026-04-02 | Q260203 | QC | 1 | |
| 2026-04-02 | Q260209 | QC | 0.5 | |
| 2026-04-02 | Q260211 | QC | 0.5 | |
| 2026-04-03 | Q260204 | QC | 0.5 | |
| 2026-04-10 | Q260202G | QC | 0.5 | G suffix is part of job number |
| 2026-04-10 | Q260202 | QC | 0.5 | |
| 2026-04-10 | Q260160 | QC | 0.5 | |

**Subtotal: 6 hrs**

---

### SGO — 0 rows, 0 hrs

SGO listed in employee summary table this period but has no line items and no billable hours.

---

## Section 2 — Hours Mismatch > 0.25 hrs

DB check required at import.

---

## Section 3 — Jobs in FACT_WORK_LOGS NOT on Invoice

DB check required at import.

---

## Section 4 — Summary

| Designer | System Code | Rows | Hours | Status |
|---|---|---|---|---|
| RG | ??? | 19 | 20 | ❌ BLOCKED — actor code unknown |
| VK | ??? | 8 | 10.25 | ❌ BLOCKED — actor code unknown |
| BC | BCH | 9 | 6 | Ready to import |
| SG | SGO | 0 | 0 | No entries this period |
| **TOTAL** | | **36** | **36.25** | **30.25 hrs blocked** |

### Pre-Import Blockers
1. Resolve system actor code for RG (Ravi Gummadi) — 20 hrs, 19 rows
2. Resolve system actor code for VK (Vani KV) — 10.25 hrs, 8 rows
