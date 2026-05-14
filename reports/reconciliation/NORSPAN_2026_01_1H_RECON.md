# Norspan Reconciliation — Jan 1–15 2026 (2026-01 1H)
# Generated: 2026-05-09
# Source: Invoice From Jan 1st-15th Norspan.pdf
# Period: 2026-01-01 to 2026-01-15
# Client: Norspan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| BC-Bharath Charles | 39 |
| RG-Ravi Gummadi | 32.5 |
| **TOTAL** | **71.5** |

---

## Notes on Norspan Format

- Job numbers use Q-prefix format (e.g. Q251132, Q260000, Q251145G)
- Q-suffix letters (e.g. the G in Q251145G) are part of the job number — not normalized away
- Date format on invoice is mixed: RG entries use YYYY-MM-DD; BCH entries use DD-MM-YYYY. All converted to YYYY-MM-DD below.
- Only 2 designers this period

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

Assuming all rows missing from DB consistent with pattern from SBS. DB check required at import.

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| BC | BCH | Same Bharath Charles as SBS — confirmed |
| RG | RKG | Confirmed |

### Work Type Mapping
| Invoice Label | System work_type |
|---|---|
| Quality Check | QC |
| Design-Quote | DESIGNER |

---

### RG — 10 rows, 32.5 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-05 | Q251132 | DESIGNER | 0.5 | |
| 2026-01-05 | Q251109 | DESIGNER | 2 | |
| 2026-01-06 | Q260000 | DESIGNER | 6 | |
| 2026-01-07 | Q251144 | DESIGNER | 6 | |
| 2026-01-08 | Q260001 | DESIGNER | 5 | |
| 2026-01-09 | Q251145G | DESIGNER | 0.5 | G is part of job number |
| 2026-01-09 | Q260015 | DESIGNER | 6 | |
| 2026-01-09 | Q260018 | DESIGNER | 1.5 | |
| 2026-01-10 | Q251145 | DESIGNER | 4 | |
| 2026-01-15 | Q260021 | DESIGNER | 1 | |

**Subtotal: 32.5 hrs**

---

### BCH — 20 rows, 39 hrs

Note: Invoice dates in DD-MM-YYYY format, converted to YYYY-MM-DD.
Note: Q251145G on 2026-01-10 has both QC (0.5) and DESIGNER (1) on same day — two separate invoice rows, different work types, both valid (D4).

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-02 | Q251129 | QC | 1.5 | |
| 2026-01-02 | Q251130 | QC | 1.5 | |
| 2026-01-03 | Q251131 | QC | 0.75 | |
| 2026-01-03 | Q251143 | QC | 0.75 | |
| 2026-01-03 | Q251149 | QC | 1.5 | |
| 2026-01-05 | Q251109 | QC | 1.5 | |
| 2026-01-05 | Q251150 | DESIGNER | 4 | |
| 2026-01-06 | Q251150 | DESIGNER | 3 | |
| 2026-01-06 | Q260000 | QC | 1.5 | |
| 2026-01-07 | Q251144 | QC | 1.5 | |
| 2026-01-08 | Q260001 | QC | 1.5 | |
| 2026-01-08 | Q251037 | DESIGNER | 3.5 | |
| 2026-01-09 | Q260010 | DESIGNER | 6.5 | |
| 2026-01-10 | Q251145G | QC | 0.5 | G is part of job number |
| 2026-01-10 | Q251145G | DESIGNER | 1 | D4: different work type, same job/date |
| 2026-01-13 | Q251145 | DESIGNER | 4 | |
| 2026-01-14 | Q260015 | DESIGNER | 3 | |
| 2026-01-15 | Q260034 | DESIGNER | 0.5 | |
| 2026-01-15 | Q260021 | QC | 0.5 | |
| 2026-01-15 | Q260035 | QC | 0.5 | |

**Subtotal: 39 hrs**

---

## Section 2 — Hours Mismatch > 0.25 hrs

DB check required at import. Assuming no Norspan data in FACT_WORK_LOGS.

---

## Section 3 — Jobs in FACT_WORK_LOGS NOT on Invoice

DB check required at import.

---

## Section 4 — Summary

| Designer | System Code | Rows | Hours | Status |
|---|---|---|---|---|
| BC | BCH | 20 | 39 | Ready to import |
| RG | RKG | 10 | 32.5 | ✅ Ready to import |
| **TOTAL** | | **30** | **71.5** | **32.5 hrs blocked** |

### Pre-Import Blockers
1. ✅ RESOLVED: RG = RKG (Ravi Gummadi) — 32.5 hrs, 10 rows
2. Verify RG is in DIM_STAFF_ROSTER for Norspan account
