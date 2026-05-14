# Titan Reconciliation — Mar 16–31 2026 (2026-03 2H)
# Generated: 2026-05-13
# Source: Invoice From March 16th to 31st Titan.pdf
# Period: 2026-03-16 to 2026-03-31
# Client: Titan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| PG-Pabitra Ghosh | 4.5 |
| PS-Prianka Santra | 18.75 |
| NM-Nitish Mishra | 3.25 |
| SG-Sarty Gosh | 0 |
| DS-Deb Sen | 0 |
| **TOTAL** | **26.5** |

---

## Notes

- Dates: mixed formats — PG rows use YYYY-MM-DD; PS and NM rows use DD-MM-YYYY. All converted to YYYY-MM-DD below.
- PG, PS, NM actor codes all UNKNOWN — all 26.5 hrs blocked (100%).
- SG (SGO) and DS: 0 hrs this period.
- New job number format: P-157 (PS, Mar 31) — P-prefix series. Record full string as job number.
- B600105 has two rows on 2026-03-18 for PS: OWW Floor 1 and Roof Truss — both DESIGNER, both recorded as separate rows.
- "design-order" (lowercase, NM B500592 Mar 18) → DESIGNER work type.
- B600102 carry-over from Mar 1H.

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

### PG — 4 rows, 4.5 hrs (all QC)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-16 | B600102 | QC | 1 | Roof Truss |
| 2026-03-17 | B600098 | QC | 1 | Roof Truss |
| 2026-03-19 | B600105 | QC | 1.5 | Roof Truss |
| 2026-03-19 | B500592 | QC | 1 | Roof Truss |

**Subtotal: 4.5 hrs**

---

### PS — 6 rows, 18.75 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-16 | B600102 | DESIGNER | 0.75 | Roof Truss |
| 2026-03-18 | B600105 | DESIGNER | 2.5 | OWW Floor 1 |
| 2026-03-18 | B600105 | DESIGNER | 2.5 | Roof Truss |
| 2026-03-19 | B600105 | DESIGNER | 4 | Roof Truss |
| 2026-03-31 | P-157 | DESIGNER | 7 | Roof Truss; P-prefix job number |
| 2026-03-31 | B600128 | DESIGNER | 2 | Roof Truss |

**Subtotal: 18.75 hrs**

---

### NM — 2 rows, 3.25 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-17 | B600098 | DESIGNER | 1.5 | Roof Truss |
| 2026-03-18 | B500592 | DESIGNER | 1.75 | Roof Truss; "design-order" description → DESIGNER |

**Subtotal: 3.25 hrs**

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
| PG | PBG | 4 | 4.5 | ✅ Ready to import |
| PS | PRS | 6 | 18.75 | ✅ Ready to import |
| NM | NMM | 2 | 3.25 | ✅ Ready to import |
| SG | SGO | 0 | 0 | No hrs this period |
| DS | DBS | 0 | 0 | No hrs this period |
| **TOTAL** | | **12** | **26.5** | **26.5 hrs blocked (100%)** |

### Pre-Import Blockers
1. ✅ RESOLVED: PG = PBG (Pabitra Ghosh) — 4.5 hrs, 4 rows
2. ✅ RESOLVED: PS = PRS (Prianka Santra) — 18.75 hrs, 6 rows
3. ✅ RESOLVED: NM = NMM (Nitish Mishra) — 3.25 hrs, 2 rows

### Import Notes
- P-157 (PS, 2026-03-31): P-prefix job number format — new series for Titan; record full string.
- B600105 Mar 18: two PS rows (OWW Floor 1 + Roof Truss) — import as separate rows.
