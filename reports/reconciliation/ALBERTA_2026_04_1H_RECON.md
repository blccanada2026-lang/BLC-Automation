# Alberta Truss Reconciliation — Apr 1–15 2026 (2026-04 1H)
# Generated: 2026-05-13
# Source: Invoice From April 1st-15th AB.pdf
# Period: 2026-04-01 to 2026-04-15
# Client: Alberta Truss

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| PS-Prianka Santra | 17.25 |
| DS-Deb Sen | 3.75 |
| SG-Sarty Gosh | 2.5 |
| **TOTAL** | **23.5** |

---

## Notes

- All dates in DD-MM-YYYY or YYYY-MM-DD format; all converted to YYYY-MM-DD below.
- PS actor code UNKNOWN — 17.25 hrs blocked.
- DS actor code UNKNOWN — 3.75 hrs blocked. DS doing Quality Check (consistent with Mar 2H).
- SG = SGO confirmed. SGO doing I JOIST Floor 1 Design-Quote → DESIGNER (consistent with Mar 2H).
- DS QC job "161580" (Apr 4) — 16xxxx series number, different from 26xxxx series seen elsewhere on this invoice. Record as-is.
- SGO 2.5 hrs ready to import (DESIGNER work type).

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| PS | ??? | Prianka Santra — actor code UNKNOWN |
| DS | ??? | Deb Sen — actor code UNKNOWN |
| SG | SGO | Confirmed |

---

### PS — 4 rows, 17.25 hrs (all DESIGNER)

⚠️ Actor code UNKNOWN. All 17.25 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-03 | 261580 | DESIGNER | 2.75 | Roof Truss |
| 2026-04-04 | 261580 | DESIGNER | 3.25 | Roof Truss |
| 2026-04-09 | 261519 | DESIGNER | 5 | Roof Truss |
| 2026-04-13 | 261519 | DESIGNER | 6.25 | Roof Truss |

**Subtotal: 17.25 hrs — BLOCKED: actor code unknown**

---

### DS — 2 rows, 3.75 hrs (all QC)

⚠️ Actor code UNKNOWN. All 3.75 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-04 | 161580 | QC | 1.5 | Roof Truss; 16xxxx series job number |
| 2026-04-15 | 261519 | QC | 2.25 | Roof Truss |

**Subtotal: 3.75 hrs — BLOCKED: actor code unknown**

---

### SGO — 1 row, 2.5 hrs (DESIGNER)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-06 | 261614 | DESIGNER | 2.5 | I JOIST Floor 1 |

**Subtotal: 2.5 hrs**

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
| PS | ??? | 4 | 17.25 | ❌ BLOCKED — actor code unknown |
| DS | ??? | 2 | 3.75 | ❌ BLOCKED — actor code unknown |
| SG | SGO | 1 | 2.5 | Ready to import (DESIGNER work type) |
| **TOTAL** | | **7** | **23.5** | **21 hrs blocked** |

### Pre-Import Blockers
1. Resolve system actor code for PS (Prianka Santra) — 17.25 hrs, 4 rows
2. Resolve system actor code for DS (Deb Sen) — 3.75 hrs, 2 rows

### Import Notes
- SGO row: work_type = DESIGNER (I JOIST Floor 1 Design-Quote).
- DS job 161580 (Apr 4): 16xxxx series — unusual for Alberta Truss (26xxxx typical); record as-is, verify at import.
