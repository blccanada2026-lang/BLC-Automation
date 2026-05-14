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
| PG | PBG | Confirmed |
| PS | PRS | Confirmed |
| NM | NMM | Confirmed |
| SG | SGO | Confirmed; 0 hrs this period |
| DS | DBS | Confirmed |

---

### PG — 3 rows, 3 hrs (all QC)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-10 | B600079 | QC | 1 | Roof Truss |
| 2026-03-12 | B600089 | QC | 1 | Roof Truss |
| 2026-03-12 | B500354 | QC | 1 | Roof Truss |

**Subtotal: 3 hrs**

---

### PS — 5 rows, 14.5 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-05 | B600079 | DESIGNER | 4 | Roof Truss |
| 2026-03-11 | B500354 | DESIGNER | 5.75 | Roof Truss |
| 2026-03-12 | B500354 | DESIGNER | 1 | Roof Truss |
| 2026-03-12 | B600077 | DESIGNER | 0.75 | Roof Truss |
| 2026-03-15 | B600102 | DESIGNER | 3 | Roof Truss |

**Subtotal: 14.5 hrs**

---

### NM — 1 row, 2.5 hrs (DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-08 | B600089 | DESIGNER | 2.5 | Roof Truss |

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
| PG | PBG | 3 | 3 | ✅ Ready to import |
| PS | PRS | 5 | 14.5 | ✅ Ready to import |
| NM | NMM | 1 | 2.5 | ✅ Ready to import |
| SG | SGO | 0 | 0 | No hrs this period |
| DS | DBS | 0 | 0 | No hrs this period |
| **TOTAL** | | **9** | **20** | **20 hrs blocked (100%)** |

### Pre-Import Blockers
1. ✅ RESOLVED: PG = PBG (Pabitra Ghosh) — 3 hrs, 3 rows
2. ✅ RESOLVED: PS = PRS (Prianka Santra) — 14.5 hrs, 5 rows
3. ✅ RESOLVED: NM = NMM (Nitish Mishra) — 2.5 hrs, 1 row
