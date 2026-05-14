# Titan Reconciliation — Jan 16–31 2026 (2026-01 2H)
# Generated: 2026-05-13
# Source: Invoice From Jan 16th-31st TITAN .pdf
# Period: 2026-01-16 to 2026-01-31
# Client: Titan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| PG-Pabitra Ghosh | 5.5 |
| NM-Nitish Mishra | 5 |
| PS-Prianka Santra | 5.75 |
| SG-Sarty Gosh | 0 |
| DS-Deb Sen | 0 |
| **TOTAL** | **16.25** |

---

## Notes

- Dates: mixed formats — PG rows use YYYY-MM-DD; PS and NM rows use DD-MM-YYYY. All converted to YYYY-MM-DD below.
- PS, PG, NM actor codes all UNKNOWN — all 16.25 hrs blocked.
- SG (SGO) and DS: listed in employee summary, 0 hrs this period.
- PG doing Quality Check this period (vs DESIGNER in Jan 1H) — PG works both roles across periods.
- NM first active period: 5 hrs DESIGNER (Roof Truss Design-Quote).
- B600015 carry-over from Jan 1H (PG QC Jan 19).
- All Design-Quote → DESIGNER; Quality Check → QC.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| PG | ??? | Pabitra Ghosh — actor code UNKNOWN |
| PS | ??? | Prianka Santra — actor code UNKNOWN |
| NM | ??? | Nitish Mishra — actor code UNKNOWN |
| SG | SGO | Confirmed; 0 hrs this period |
| DS | ??? | Deb Sen — actor code UNKNOWN; 0 hrs this period |

---

### PG — 5 rows, 5.5 hrs (all QC)

⚠️ Actor code UNKNOWN. All 5.5 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-19 | B600015 | QC | 2 | Roof Truss; carry-over from Jan 1H |
| 2026-01-21 | B600025 | QC | 0.5 | Roof Truss |
| 2026-01-22 | B600020 | QC | 1 | Roof Truss |
| 2026-01-27 | B600024 | QC | 1 | Roof Truss |
| 2026-01-29 | B600019 | QC | 1 | Roof Truss |

**Subtotal: 5.5 hrs — BLOCKED: actor code unknown**

---

### PS — 2 rows, 5.75 hrs (all DESIGNER)

⚠️ Actor code UNKNOWN. All 5.75 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-16 | B600019 | DESIGNER | 4.5 | Roof Truss |
| 2026-01-19 | B600025 | DESIGNER | 1.25 | Roof Truss |

**Subtotal: 5.75 hrs — BLOCKED: actor code unknown**

---

### NM — 2 rows, 5 hrs (all DESIGNER)

⚠️ Actor code UNKNOWN. All 5 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-16 | B600020 | DESIGNER | 3 | Roof Truss |
| 2026-01-21 | B600024 | DESIGNER | 2 | Roof Truss |

**Subtotal: 5 hrs — BLOCKED: actor code unknown**

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
| PG | ??? | 5 | 5.5 | ❌ BLOCKED — actor code unknown |
| PS | ??? | 2 | 5.75 | ❌ BLOCKED — actor code unknown |
| NM | ??? | 2 | 5 | ❌ BLOCKED — actor code unknown |
| SG | SGO | 0 | 0 | No hrs this period |
| DS | ??? | 0 | 0 | No hrs this period |
| **TOTAL** | | **9** | **16.25** | **16.25 hrs blocked (100%)** |

### Pre-Import Blockers
1. Resolve system actor code for PG (Pabitra Ghosh) — 5.5 hrs, 5 rows
2. Resolve system actor code for PS (Prianka Santra) — 5.75 hrs, 2 rows
3. Resolve system actor code for NM (Nitish Mishra) — 5 hrs, 2 rows

### Import Notes
- PG acts as both QC and DESIGNER across periods — work_type is determined per-row from invoice Description column.
