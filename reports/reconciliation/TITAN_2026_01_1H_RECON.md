# Titan Reconciliation — Jan 1–15 2026 (2026-01 1H)
# Generated: 2026-05-13
# Source: Invoice From Jan1st to 15th Titan .pdf
# Period: 2026-01-01 to 2026-01-15
# Client: Titan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| PS-Prianka Santra | 22 |
| PG-Pabitra Ghosh | 8.5 |
| DS-Deb Sen | 12 |
| SG-Sarty Gosh | 4 |
| NM-Nitish Mishra | 0 |
| **TOTAL** | **46.5** |

---

## Notes

- NEW CLIENT: Titan. First period processed.
- Job number format: B-prefix + 6 digits (B500378, B500668, B500677, B500678, B600002, B600004, B600015). Different from all other clients.
- Dates: mixed formats on invoice — PS rows use DD-MM-YYYY; PG rows use YYYY-MM-DD. All converted to YYYY-MM-DD below.
- NEW actors: PS (Prianka Santra) and PG (Pabitra Ghosh) — actor codes UNKNOWN.
- NEW actor: NM (Nitish Mishra) — listed in employee summary, 0 hrs this period; actor code will be needed for future periods.
- DS (Deb Sen) — same ongoing blocker as Nelson Lumber and Matix SK; actor code UNKNOWN.
- SG = SGO confirmed. However: SGO does LVL FRAMING Design-Quote this period → DESIGNER work type (not QC). Note for import: SGO work_type = DESIGNER for this row.
- LVL FRAMING Design-Quote → DESIGNER work type (new job type for Titan).
- OWW Floor 1 Design-Quote → DESIGNER work type (consistent with prior clients).
- All entries this period are Design-Quote → DESIGNER; no Quality Check rows.
- Blocked: PS + PG + DS = 42.5 hrs. SGO (4 hrs DESIGNER) ready to import.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| PS | PRS | Confirmed |
| PG | PBG | Confirmed |
| DS | DBS | Confirmed |
| SG | SGO | Confirmed |
| NM | NMM | Confirmed |

---

### PS — 7 rows, 22 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-01 | B500678 | DESIGNER | 2 | Roof Truss |
| 2026-01-02 | B500678 | DESIGNER | 4 | Roof Truss |
| 2026-01-05 | B500678 | DESIGNER | 3 | Roof Truss |
| 2026-01-05 | B500668 | DESIGNER | 3 | Roof Truss |
| 2026-01-08 | B500678 | DESIGNER | 1 | Roof Truss |
| 2026-01-14 | B600015 | DESIGNER | 5 | Roof Truss |
| 2026-01-15 | B600015 | DESIGNER | 4 | Roof Truss |

**Subtotal: 22 hrs**

---

### PG — 7 rows, 8.5 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-06 | B500378 | DESIGNER | 0.5 | Roof Truss |
| 2026-01-07 | B500677 | DESIGNER | 1 | OWW Floor 1 |
| 2026-01-07 | B500378 | DESIGNER | 1 | Roof Truss |
| 2026-01-07 | B500668 | DESIGNER | 0.5 | Roof Truss |
| 2026-01-07 | B500678 | DESIGNER | 1 | Roof Truss |
| 2026-01-09 | B600002 | DESIGNER | 3 | Roof Truss |
| 2026-01-13 | B600004 | DESIGNER | 1.5 | Roof Truss |

**Subtotal: 8.5 hrs**

---

### DS — 3 rows, 12 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-06 | B600004 | DESIGNER | 6 | Roof Truss |
| 2026-01-07 | B600004 | DESIGNER | 3.5 | Roof Truss |
| 2026-01-08 | B600004 | DESIGNER | 2.5 | Roof Truss |

**Subtotal: 12 hrs**

---

### SGO — 1 row, 4 hrs (DESIGNER)

⚠️ Note: SGO doing LVL FRAMING Design-Quote → DESIGNER work type (not QC). Unusual for SGO but correct per invoice.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-08 | B600004 | DESIGNER | 4 | LVL FRAMING; SGO acting as designer this entry |

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
| PS | PRS | 7 | 22 | ✅ Ready to import |
| PG | PBG | 7 | 8.5 | ✅ Ready to import |
| DS | DBS | 3 | 12 | ✅ Ready to import |
| SG | SGO | 1 | 4 | Ready to import (DESIGNER work type) |
| NM | NMM | 0 | 0 | No hrs this period; resolve actor code for future periods |
| **TOTAL** | | **18** | **46.5** | **42.5 hrs blocked** |

### Pre-Import Blockers
1. ✅ RESOLVED: PS = PRS (Prianka Santra) — 22 hrs, 7 rows
2. ✅ RESOLVED: PG = PBG (Pabitra Ghosh) — 8.5 hrs, 7 rows
3. ✅ RESOLVED: DS = DBS (Deb Sen) — 12 hrs, 3 rows
4. ✅ RESOLVED: NM = NMM (Nitish Mishra) — 0 hrs this period; needed for future

### Import Notes
- SGO Jan 8 B600004 LVL FRAMING: work_type = DESIGNER (not QC) — SGO acting as designer for this entry.
- Job numbers are B-prefix format (B500xxx, B600xxx) — unique to Titan.
