# Alberta Truss Reconciliation — Mar 16–31 2026 (2026-03 2H)
# Generated: 2026-05-13
# Source: Invoice From March 16th to 31st AB Truss.pdf
# Period: 2026-03-16 to 2026-03-31
# Client: Alberta Truss

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| PS-Prianka Santra | 11 |
| DS-Deb Sen | 5.25 |
| SG-Sarty Gosh | 4.5 |
| **TOTAL** | **20.75** |

---

## Notes

- NEW CLIENT: Alberta Truss. First period processed.
- All dates in DD-MM-YYYY format; converted to YYYY-MM-DD below.
- Job number format: plain 6-digit 26xxxx series (261114, 261454, 261459, 261460). No prefix.
- "261114-02" — hyphen-suffix variant; record full string as job number.
- PS actor code UNKNOWN — 11 hrs blocked.
- DS actor code UNKNOWN — 5.25 hrs blocked. Note: DS doing Quality Check here (unlike other clients where DS was DESIGNER).
- SG = SGO confirmed. SGO doing I JOIST Floor 1 Design-Quote → DESIGNER work type (same pattern as Titan).
- SGO 4.5 hrs ready to import (DESIGNER work type).

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| PS | ??? | Prianka Santra — actor code UNKNOWN |
| DS | ??? | Deb Sen — actor code UNKNOWN |
| SG | SGO | Confirmed |

---

### PS — 3 rows, 11 hrs (all DESIGNER)

⚠️ Actor code UNKNOWN. All 11 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-17 | 261114 | DESIGNER | 5 | Roof Truss |
| 2026-03-20 | 261114 | DESIGNER | 3 | Roof Truss |
| 2026-03-26 | 261454 | DESIGNER | 3 | Roof Truss |

**Subtotal: 11 hrs — BLOCKED: actor code unknown**

---

### DS — 2 rows, 5.25 hrs (all QC)

⚠️ Actor code UNKNOWN. All 5.25 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-20 | 261114 | QC | 4 | Roof Truss |
| 2026-03-27 | 261454 | QC | 1.25 | Roof Truss |

**Subtotal: 5.25 hrs — BLOCKED: actor code unknown**

---

### SGO — 3 rows, 4.5 hrs (all DESIGNER)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-20 | 261114-02 | DESIGNER | 2 | I JOIST Floor 1; hyphen-suffix is part of job number |
| 2026-03-31 | 261459 | DESIGNER | 1.5 | I JOIST Floor 1 |
| 2026-03-31 | 261460 | DESIGNER | 1 | I JOIST Floor 1 |

**Subtotal: 4.5 hrs**

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
| PS | ??? | 3 | 11 | ❌ BLOCKED — actor code unknown |
| DS | ??? | 2 | 5.25 | ❌ BLOCKED — actor code unknown |
| SG | SGO | 3 | 4.5 | Ready to import (DESIGNER work type) |
| **TOTAL** | | **8** | **20.75** | **16.25 hrs blocked** |

### Pre-Import Blockers
1. Resolve system actor code for PS (Prianka Santra) — 11 hrs, 3 rows
2. Resolve system actor code for DS (Deb Sen) — 5.25 hrs, 2 rows

### Import Notes
- SGO rows: work_type = DESIGNER (I JOIST Floor 1 Design-Quote) — not QC.
- DS doing Quality Check on this client (work_type = QC).
- 261114-02: hyphen-suffix is part of the job number; record full string.
