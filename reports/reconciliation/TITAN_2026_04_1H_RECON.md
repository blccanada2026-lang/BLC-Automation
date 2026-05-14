# Titan Reconciliation — Apr 1–15 2026 (2026-04 1H)
# Generated: 2026-05-13
# Source: Invoice From April 1st to 15th Titan.pdf
# Period: 2026-04-01 to 2026-04-15
# Client: Titan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| PG-Pabitra Ghosh | 4.75 |
| PS-Prianka Santra | 12.75 |
| NM-Nitish Mishra | 4 |
| SG-Sarty Gosh | 0 |
| DS-Deb Sen | 0 |
| **TOTAL** | **21.5** |

---

## Notes

- Dates: mixed formats — PG rows use YYYY-MM-DD; PS and NM rows use DD-MM-YYYY. All converted to YYYY-MM-DD below.
- PG, PS, NM actor codes all UNKNOWN — all 21.5 hrs blocked (100%).
- SG (SGO) and DS: 0 hrs this period.
- "B600050 rev" — "rev" suffix (lowercase) is part of the job number; record as written. Two PS rows on 2026-04-08 for B600050 rev (0.75 + 0.5) — D4: import both as separate rows.
- B600133 Apr 1: two PS rows (Roof Truss 2.25 + OWW Floor 1 2.75) — both DESIGNER, record as separate rows.
- "Roof & Floor Truss" job type (NM, B600126) → DESIGNER.

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

### PG — 6 rows, 4.75 hrs (all QC)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-02 | B600133 | QC | 1 | Roof Truss |
| 2026-04-02 | B600128 | QC | 0.25 | Roof Truss |
| 2026-04-02 | B600126 | QC | 1 | Roof Truss |
| 2026-04-10 | B600140 | QC | 1 | Roof Truss |
| 2026-04-10 | B600131 | QC | 1 | Roof Truss |
| 2026-04-10 | B600050 | QC | 0.5 | Roof Truss |

**Subtotal: 4.75 hrs**

---

### PS — 6 rows, 12.75 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | B600133 | DESIGNER | 2.25 | Roof Truss |
| 2026-04-01 | B600133 | DESIGNER | 2.75 | OWW Floor 1 |
| 2026-04-08 | B600131 | DESIGNER | 2.75 | Roof Truss |
| 2026-04-08 | B600050 rev | DESIGNER | 0.75 | Roof Truss; "rev" suffix is part of job number |
| 2026-04-08 | B600050 rev | DESIGNER | 0.5 | Roof Truss; D4: second row same job/date |
| 2026-04-10 | B600140 | DESIGNER | 3.75 | Roof Truss |

**Subtotal: 12.75 hrs**

---

### NM — 1 row, 4 hrs (DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-02 | B600126 | DESIGNER | 4 | Roof & Floor Truss → DESIGNER |

**Subtotal: 4 hrs**

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
| PG | PBG | 6 | 4.75 | ✅ Ready to import |
| PS | PRS | 6 | 12.75 | ✅ Ready to import |
| NM | NMM | 1 | 4 | ✅ Ready to import |
| SG | SGO | 0 | 0 | No hrs this period |
| DS | DBS | 0 | 0 | No hrs this period |
| **TOTAL** | | **13** | **21.5** | **21.5 hrs blocked (100%)** |

### Pre-Import Blockers
1. ✅ RESOLVED: PG = PBG (Pabitra Ghosh) — 4.75 hrs, 6 rows
2. ✅ RESOLVED: PS = PRS (Prianka Santra) — 12.75 hrs, 6 rows
3. ✅ RESOLVED: NM = NMM (Nitish Mishra) — 4 hrs, 1 row

### Import Notes
- B600050 rev (PS, 2026-04-08): two rows same job/date — D4, import both as separate rows.
- B600133 (PS, 2026-04-01): two rows same job/date (Roof Truss + OWW Floor 1) — import as separate rows.
