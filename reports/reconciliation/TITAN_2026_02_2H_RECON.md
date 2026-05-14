# Titan Reconciliation — Feb 16–28 2026 (2026-02 2H)
# Generated: 2026-05-13
# Source: Invoice From Feb 16th to 28th Titan.pdf
# Period: 2026-02-16 to 2026-02-28
# Client: Titan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| PG-Pabitra Ghosh | 11.75 |
| PS-Prianka Santra | 26.5 |
| NM-Nitish Mishra | 10.5 |
| DS-Deb Sen | 4 |
| SG-Sarty Gosh | 0 |
| **TOTAL** | **52.75** |

---

## Notes

- Dates: mixed formats — PG rows use YYYY-MM-DD; PS, NM, DS rows use DD-MM-YYYY. All converted to YYYY-MM-DD below.
- PS, PG, NM, DS actor codes all UNKNOWN — all 52.75 hrs blocked (100%).
- SG (SGO): listed in employee summary, 0 hrs this period.
- Date typo: PS last row shows 27-03-2026 on a Feb 16–28 invoice → corrected to 2026-02-27 (Feb 27 is within period; March 27 is outside). Verify against original PDF at import.
- DS active this period: 1 row, 4 hrs DESIGNER (Roof Truss Design-Quote).
- New description types → all DESIGNER:
  - "Design-Order" (NM, B600061 Feb 23)
  - "Design-Quote" (standard)
- New job type strings → all DESIGNER:
  - "Roof Truss & Floor truss" (NM, B600061 Feb 23)
  - "Roof Truss Revision" (NM, B600062 Feb 23)
- New job: B500058 (PG QC Feb 23) — B5-prefix series.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| PG | PBG | Confirmed |
| PS | PRS | Confirmed |
| NM | NMM | Confirmed |
| DS | DBS | Confirmed |
| SG | SGO | Confirmed; 0 hrs this period |

---

### PG — 12 rows, 11.75 hrs (all QC)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-02-16 | B600054 | QC | 1 | Roof Truss |
| 2026-02-16 | B600047 | QC | 2 | Roof Truss |
| 2026-02-18 | B600048 | QC | 0.5 | Roof Truss |
| 2026-02-19 | B600050 | QC | 1 | Roof Truss |
| 2026-02-20 | B600062 | QC | 1 | Roof Truss |
| 2026-02-23 | B600057 | QC | 0.5 | Roof Truss |
| 2026-02-23 | B500058 | QC | 0.25 | Roof Truss |
| 2026-02-23 | B600062 | QC | 0.5 | Roof Truss |
| 2026-02-24 | B600061 | QC | 1 | Roof Truss |
| 2026-02-25 | B600067 | QC | 1 | Roof Truss |
| 2026-02-25 | B600064 | QC | 1 | Roof Truss |
| 2026-02-25 | B600069 | QC | 2 | Roof Truss |

**Subtotal: 11.75 hrs**

---

### PS — 8 rows, 26.5 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-02-16 | B600050 | DESIGNER | 3 | Roof Truss |
| 2026-02-17 | B600050 | DESIGNER | 2.5 | Roof Truss |
| 2026-02-18 | B600057 | DESIGNER | 4.5 | Roof Truss |
| 2026-02-19 | B600064 | DESIGNER | 3.5 | Roof Truss |
| 2026-02-19 | B600067 | DESIGNER | 1.5 | Roof Truss |
| 2026-02-20 | B600067 | DESIGNER | 3.5 | Roof Truss |
| 2026-02-24 | B600069 | DESIGNER | 5.5 | Roof Truss |
| 2026-02-27 | B600079 | DESIGNER | 2.5 | Roof Truss; invoice shows 27-03-2026 — corrected to 2026-02-27 (within period) |

**Subtotal: 26.5 hrs**

---

### NM — 4 rows, 10.5 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-02-17 | B600048 | DESIGNER | 2 | Roof Truss |
| 2026-02-21 | B600062 | DESIGNER | 4 | Roof Truss |
| 2026-02-23 | B600061 | DESIGNER | 3 | Roof Truss & Floor truss; Design-Order description → DESIGNER |
| 2026-02-23 | B600062 | DESIGNER | 1.5 | Roof Truss Revision; Design-Quote → DESIGNER |

**Subtotal: 10.5 hrs**

---

### DS — 1 row, 4 hrs (DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-02-16 | B600054 | DESIGNER | 4 | Roof Truss |

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
| PG | PBG | 12 | 11.75 | ✅ Ready to import |
| PS | PRS | 8 | 26.5 | ✅ Ready to import |
| NM | NMM | 4 | 10.5 | ✅ Ready to import |
| DS | DBS | 1 | 4 | ✅ Ready to import |
| SG | SGO | 0 | 0 | No hrs this period |
| **TOTAL** | | **25** | **52.75** | **52.75 hrs blocked (100%)** |

### Pre-Import Blockers
1. ✅ RESOLVED: PG = PBG (Pabitra Ghosh) — 11.75 hrs, 12 rows
2. ✅ RESOLVED: PS = PRS (Prianka Santra) — 26.5 hrs, 8 rows
3. ✅ RESOLVED: NM = NMM (Nitish Mishra) — 10.5 hrs, 4 rows
4. ✅ RESOLVED: DS = DBS (Deb Sen) — 4 hrs, 1 row

### Import Notes
- PS B600079 Feb 27: invoice shows date 27-03-2026 — corrected to 2026-02-27; verify against original PDF at import.
- NM B600061 Feb 23: job type "Roof Truss & Floor truss", description "Design-Order" → work_type = DESIGNER.
- NM B600062 Feb 23: job type "Roof Truss Revision" → work_type = DESIGNER.
