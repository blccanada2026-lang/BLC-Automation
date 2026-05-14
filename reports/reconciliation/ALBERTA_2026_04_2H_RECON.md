# Alberta Truss Reconciliation — Apr 16–30 2026 (2026-04 2H)
# Generated: 2026-05-13
# Source: Invoice From April 16th to 30th  AB Truss.pdf
# Period: 2026-04-16 to 2026-04-30
# Client: Alberta Truss

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| SG-Sarty Gosh | 17 |
| DS-Deb Sen | 11.25 |
| PS-Prianka Santra | 25.5 |
| **TOTAL** | **53.75** |

---

## Notes

- All dates in DD-MM-YYYY format; converted to YYYY-MM-DD below.
- PS actor code UNKNOWN — 25.5 hrs blocked.
- DS actor code UNKNOWN — 11.25 hrs blocked. DS has both DESIGNER rows (Apr 17) and QC rows (Apr 21, 28) this period.
- SG = SGO confirmed. SGO doing I JOIST Floor 1 Design-Quote → DESIGNER (consistent across all Alberta Truss periods).
- D4: Two DS QC rows on 2026-04-21 for 261647 (1.5 hrs + 0.75 hrs) — import both as separate rows.
- SGO 17 hrs ready to import (DESIGNER work type).

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| PS | ??? | Prianka Santra — actor code UNKNOWN |
| DS | ??? | Deb Sen — actor code UNKNOWN |
| SG | SGO | Confirmed |

---

### PS — 8 rows, 25.5 hrs (all DESIGNER)

⚠️ Actor code UNKNOWN. All 25.5 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-17 | 261647 | DESIGNER | 4 | Roof Truss |
| 2026-04-20 | 261712 | DESIGNER | 3 | Roof Truss |
| 2026-04-21 | 261891 | DESIGNER | 4.75 | Roof Truss |
| 2026-04-23 | 261647 | DESIGNER | 1.25 | Roof Truss |
| 2026-04-23 | 261891 | DESIGNER | 1.25 | Roof Truss |
| 2026-04-27 | 261712 | DESIGNER | 4 | Roof Truss |
| 2026-04-29 | 261865 | DESIGNER | 3 | Roof Truss |
| 2026-04-30 | 261865 | DESIGNER | 4.25 | Roof Truss |

**Subtotal: 25.5 hrs — BLOCKED: actor code unknown**

---

### DS — 6 rows, 11.25 hrs (DESIGNER + QC)

⚠️ Actor code UNKNOWN. All 11.25 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-17 | 261646 | DESIGNER | 4 | Roof Truss |
| 2026-04-17 | 261647 | DESIGNER | 1.5 | Roof Truss |
| 2026-04-21 | 261647 | QC | 1.5 | Roof Truss |
| 2026-04-21 | 261647 | QC | 0.75 | Roof Truss; D4: second QC row same job/date |
| 2026-04-21 | 261891 | QC | 0.5 | Roof Truss |
| 2026-04-28 | 261712 | QC | 3 | Roof Truss |

**Subtotal: 11.25 hrs — BLOCKED: actor code unknown**

---

### SGO — 4 rows, 17 hrs (all DESIGNER)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-16 | 261715 | DESIGNER | 3.5 | I JOIST Floor 1 |
| 2026-04-22 | 261953 | DESIGNER | 5 | I JOIST Floor 1 |
| 2026-04-28 | 262070 | DESIGNER | 4 | I JOIST Floor 1 |
| 2026-04-28 | 262076 | DESIGNER | 4.5 | I JOIST Floor 1 |

**Subtotal: 17 hrs**

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
| PS | ??? | 8 | 25.5 | ❌ BLOCKED — actor code unknown |
| DS | ??? | 6 | 11.25 | ❌ BLOCKED — actor code unknown |
| SG | SGO | 4 | 17 | Ready to import (DESIGNER work type) |
| **TOTAL** | | **18** | **53.75** | **36.75 hrs blocked** |

### Pre-Import Blockers
1. Resolve system actor code for PS (Prianka Santra) — 25.5 hrs, 8 rows
2. Resolve system actor code for DS (Deb Sen) — 11.25 hrs, 6 rows

### Import Notes
- SGO rows: work_type = DESIGNER (I JOIST Floor 1 Design-Quote) — not QC.
- DS has mixed work types this period: DESIGNER (Apr 17) and QC (Apr 21, 28) — determine work_type per row from invoice.
- D4: Two DS QC rows on 2026-04-21 for 261647 (1.5 + 0.75) — import both as separate rows.
