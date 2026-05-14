# Nelson Lumber Reconciliation — Apr 16–30 2026 (2026-04 2H)
# Generated: 2026-05-09
# Source: Invoice From April 16th to 30th Nelson.pdf
# Period: 2026-04-16 to 2026-04-30
# Client: Nelson Lumber

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| SG-Sarty Gosh | 21 |
| DS-Deb Sen | 3 |
| AR-Abhisekh Rit | 44 |
| **TOTAL** | **68** |

---

## Notes

- SG - Sarty Gosh = SGO (confirmed).
- AR and DS actor codes still UNKNOWN — 47 hrs blocked.
- New job number this period: 260493 (plain numeric, no prefix, no suffix).
- All entries are Design-Quote → DESIGNER work type.
- No date typos this period.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| SG | SGO | Confirmed |
| DS | DBS | Confirmed |
| AR | AR001 | Confirmed |

---

### AR — 5 rows, 44 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-16 | 260391B1 | DESIGNER | 8 | |
| 2026-04-17 | 260391B1 | DESIGNER | 8 | |
| 2026-04-18 | 260391B1 | DESIGNER | 8 | |
| 2026-04-20 | 260391B1 | DESIGNER | 12 | |
| 2026-04-21 | 260391B1 | DESIGNER | 8 | |

**Subtotal: 44 hrs**

---

### DS — 1 row, 3 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-17 | 260391B2 | DESIGNER | 3 | |

**Subtotal: 3 hrs**

---

### SGO — 3 rows, 21 hrs (all DESIGNER)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-21 | 260391B1F | DESIGNER | 8 | I JOIST Floor; B1F suffix is part of job number |
| 2026-04-22 | 260391B1F | DESIGNER | 3 | I JOIST Floor |
| 2026-04-30 | 260493 | DESIGNER | 10 | I JOIST Floor; plain numeric job number |

**Subtotal: 21 hrs**

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
| AR | AR001 | 5 | 44 | ✅ Ready to import |
| DS | DBS | 1 | 3 | ✅ Ready to import |
| SG | SGO | 3 | 21 | Ready to import |
| **TOTAL** | | **9** | **68** | **47 hrs blocked** |

### Pre-Import Blockers
1. ✅ RESOLVED: AR = AR001 (Abhisekh Rit) — 44 hrs, 5 rows
2. ✅ RESOLVED: DS = DBS (Deb Sen) — 3 hrs, 1 row
