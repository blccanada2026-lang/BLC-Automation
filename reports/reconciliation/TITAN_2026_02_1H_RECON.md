# Titan Reconciliation — Feb 1–15 2026 (2026-02 1H)
# Generated: 2026-05-13
# Source: Invoice From Feb1st to 15th TITAN .pdf
# Period: 2026-02-01 to 2026-02-15
# Client: Titan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| PS-Prianka Santra | 11.5 |
| PG-Pabitra Ghosh | 2.5 |
| NM-Nitish Mishra | 3.5 |
| SG-Sarty Gosh | 0 |
| DS-Deb Sen | 0 |
| **TOTAL** | **17.5** |

---

## Notes

- Dates: mixed formats — PG rows use YYYY-MM-DD; PS and NM rows use DD-MM-YYYY. All converted to YYYY-MM-DD below.
- PS, PG, NM actor codes all UNKNOWN — all 17.5 hrs blocked (100%).
- SG (SGO) and DS: listed in employee summary, 0 hrs this period.
- New description: "Design-Production" (NM, B400161 Feb 1) → DESIGNER work type.
- New job number prefix: B400161 — B4xxx series (prior periods had B5xxx and B6xxx only).
- All Design-Quote and Design-Production → DESIGNER; Quality Check → QC.

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

### PG — 3 rows, 2.5 hrs (all QC)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-02-01 | B400161 | QC | 1 | Roof Truss |
| 2026-02-06 | B600037 | QC | 1 | Roof Truss |
| 2026-02-12 | B600048 | QC | 0.5 | Roof Truss |

**Subtotal: 2.5 hrs**

---

### PS — 3 rows, 11.5 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-02-05 | B600037 | DESIGNER | 4 | Roof Truss |
| 2026-02-05 | B600047 | DESIGNER | 4.5 | Roof Truss |
| 2026-02-12 | B600050 | DESIGNER | 3 | Roof Truss |

**Subtotal: 11.5 hrs**

---

### NM — 2 rows, 3.5 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-02-01 | B400161 | DESIGNER | 1.5 | Roof Truss; Design-Production description → DESIGNER |
| 2026-02-11 | B600048 | DESIGNER | 2 | Roof Truss |

**Subtotal: 3.5 hrs**

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
| PG | PBG | 3 | 2.5 | ✅ Ready to import |
| PS | PRS | 3 | 11.5 | ✅ Ready to import |
| NM | NMM | 2 | 3.5 | ✅ Ready to import |
| SG | SGO | 0 | 0 | No hrs this period |
| DS | DBS | 0 | 0 | No hrs this period |
| **TOTAL** | | **8** | **17.5** | **17.5 hrs blocked (100%)** |

### Pre-Import Blockers
1. ✅ RESOLVED: PG = PBG (Pabitra Ghosh) — 2.5 hrs, 3 rows
2. ✅ RESOLVED: PS = PRS (Prianka Santra) — 11.5 hrs, 3 rows
3. ✅ RESOLVED: NM = NMM (Nitish Mishra) — 3.5 hrs, 2 rows

### Import Notes
- NM B400161 Feb 1: Description = "Design-Production" → work_type = DESIGNER.
- B400161 is a B4xxx-series job number (new prefix series for Titan).
