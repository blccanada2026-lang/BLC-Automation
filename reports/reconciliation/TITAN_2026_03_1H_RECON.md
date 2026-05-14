# Titan Reconciliation — Mar 1–15 2026 (2026-03 1H)
# Generated: 2026-05-13
# Source: Invoice From March 1st to 15th titan.pdf
# Period: 2026-03-01 to 2026-03-15
# Client: Titan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| PG-Pabitra Ghosh | 3 |
| PS-Prianka Santra | 14.5 |
| NM-Nitish Mishra | 2.5 |
| SG-Sarty Gosh | 0 |
| DS-Deb Sen | 0 |
| **TOTAL** | **20** |

---

## Notes

- Dates: mixed formats — PG rows use YYYY-MM-DD; PS and NM rows use DD-MM-YYYY. All converted to YYYY-MM-DD below.
- PG, PS, NM actor codes all UNKNOWN — all 20 hrs blocked (100%).
- SG (SGO) and DS: 0 hrs this period.
- B600079 carry-over from Feb 2H (PS design Mar 5, PG QC Mar 10).
- B500354 — new B5-series job number.

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

### PG — 3 rows, 3 hrs (all QC)

⚠️ Actor code UNKNOWN. All 3 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-10 | B600079 | QC | 1 | Roof Truss |
| 2026-03-12 | B600089 | QC | 1 | Roof Truss |
| 2026-03-12 | B500354 | QC | 1 | Roof Truss |

**Subtotal: 3 hrs — BLOCKED: actor code unknown**

---

### PS — 5 rows, 14.5 hrs (all DESIGNER)

⚠️ Actor code UNKNOWN. All 14.5 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-05 | B600079 | DESIGNER | 4 | Roof Truss |
| 2026-03-11 | B500354 | DESIGNER | 5.75 | Roof Truss |
| 2026-03-12 | B500354 | DESIGNER | 1 | Roof Truss |
| 2026-03-12 | B600077 | DESIGNER | 0.75 | Roof Truss |
| 2026-03-15 | B600102 | DESIGNER | 3 | Roof Truss |

**Subtotal: 14.5 hrs — BLOCKED: actor code unknown**

---

### NM — 1 row, 2.5 hrs (DESIGNER)

⚠️ Actor code UNKNOWN. All 2.5 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-08 | B600089 | DESIGNER | 2.5 | Roof Truss |

**Subtotal: 2.5 hrs — BLOCKED: actor code unknown**

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
| PG | ??? | 3 | 3 | ❌ BLOCKED — actor code unknown |
| PS | ??? | 5 | 14.5 | ❌ BLOCKED — actor code unknown |
| NM | ??? | 1 | 2.5 | ❌ BLOCKED — actor code unknown |
| SG | SGO | 0 | 0 | No hrs this period |
| DS | ??? | 0 | 0 | No hrs this period |
| **TOTAL** | | **9** | **20** | **20 hrs blocked (100%)** |

### Pre-Import Blockers
1. Resolve system actor code for PG (Pabitra Ghosh) — 3 hrs, 3 rows
2. Resolve system actor code for PS (Prianka Santra) — 14.5 hrs, 5 rows
3. Resolve system actor code for NM (Nitish Mishra) — 2.5 hrs, 1 row
