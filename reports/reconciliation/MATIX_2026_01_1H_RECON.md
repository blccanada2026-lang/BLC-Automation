# Matix SK Reconciliation — Jan 1–15 2026 (2026-01 1H)
# Generated: 2026-05-09
# Source: Invoice From Jan 1st to 15th Matix.pdf
# Period: 2026-01-01 to 2026-01-15
# Client: Matix SK

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| DG-Debby Gosh | 65 |
| DS-Deb Sen | 48.5 |
| SG-Sarty Gosh | 4.5 |
| **TOTAL** | **118** |

---

## Notes

- First Matix SK period processed. New client.
- Matix SK job number format: plain 6-digit numeric, 16xxxx series (e.g. 160539). No prefix.
- DG - Debby Gosh = DG-Debby Ghosh from SBS invoices (same person, spelling variant). Actor code UNKNOWN across all clients. 65 hrs blocked.
- DS - Deb Sen = same DS from Nelson Lumber invoices. Actor code UNKNOWN. 48.5 hrs blocked.
- SG - Sarty Gosh = SGO (confirmed across SBS, Norspan, Nelson Lumber, and now Matix SK).
- Multi-component invoicing: DG has up to 3 rows per job per day, one each for I JOIST Floor 1, I JOIST Floor 2, and Roof Truss. All are Design-Quote → DESIGNER work type. Each line item recorded as a separate row per D4 rule.
- SG entries are Quality Check only (no Job Type column on these rows) → QC work type.
- DS entries are all Roof Truss Design-Quote → DESIGNER.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| DG | DBG | Confirmed |
| DS | DBS | Confirmed |
| SG | SGO | Confirmed |

---

### DG — 32 rows, 65 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-06 | 160539 | DESIGNER | 4 | I JOIST Floor 1 |
| 2026-01-06 | 160539 | DESIGNER | 2 | I JOIST Floor 2 |
| 2026-01-06 | 160539 | DESIGNER | 1 | Roof Truss |
| 2026-01-07 | 160539 | DESIGNER | 1.5 | I JOIST Floor 1 |
| 2026-01-07 | 160539 | DESIGNER | 3.5 | I JOIST Floor 2 |
| 2026-01-07 | 160539 | DESIGNER | 1 | Roof Truss |
| 2026-01-07 | 160554 | DESIGNER | 1 | I JOIST Floor 1 |
| 2026-01-07 | 160554 | DESIGNER | 1 | I JOIST Floor 2 |
| 2026-01-07 | 160554 | DESIGNER | 1 | Roof Truss |
| 2026-01-08 | 160554 | DESIGNER | 3 | I JOIST Floor 1 |
| 2026-01-08 | 160554 | DESIGNER | 3.5 | I JOIST Floor 2 |
| 2026-01-08 | 160554 | DESIGNER | 1 | Roof Truss |
| 2026-01-09 | 160561 | DESIGNER | 6 | I JOIST Floor 1 |
| 2026-01-09 | 160561 | DESIGNER | 1.5 | Roof Truss |
| 2026-01-12 | 160566 | DESIGNER | 4 | I JOIST Floor 1 |
| 2026-01-12 | 160566 | DESIGNER | 5 | I JOIST Floor 2 |
| 2026-01-12 | 160566 | DESIGNER | 1 | Roof Truss |
| 2026-01-13 | 160566 | DESIGNER | 1 | I JOIST Floor 1 |
| 2026-01-13 | 160566 | DESIGNER | 0.5 | I JOIST Floor 2 |
| 2026-01-13 | 160566 | DESIGNER | 1 | Roof Truss |
| 2026-01-13 | 160571 | DESIGNER | 4 | I JOIST Floor 1 |
| 2026-01-13 | 160571 | DESIGNER | 3 | I JOIST Floor 2 |
| 2026-01-13 | 160571 | DESIGNER | 1 | Roof Truss |
| 2026-01-14 | 160571 | DESIGNER | 1 | I JOIST Floor 1 |
| 2026-01-14 | 160571 | DESIGNER | 0.5 | I JOIST Floor 2 |
| 2026-01-14 | 160571 | DESIGNER | 0.5 | Roof Truss |
| 2026-01-15 | 160569 | DESIGNER | 4 | I JOIST Floor 1 |
| 2026-01-15 | 160569 | DESIGNER | 3.5 | I JOIST Floor 2 |
| 2026-01-15 | 160569 | DESIGNER | 1 | Roof Truss |
| 2026-01-15 | 160572 | DESIGNER | 1 | I JOIST Floor 1 |
| 2026-01-15 | 160572 | DESIGNER | 1 | I JOIST Floor 2 |
| 2026-01-15 | 160572 | DESIGNER | 1 | Roof Truss |

**Subtotal: 65 hrs**

---

### DS — 10 rows, 48.5 hrs (all DESIGNER, all Roof Truss)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-07 | 160554 | DESIGNER | 8 | |
| 2026-01-10 | 160566 | DESIGNER | 9 | |
| 2026-01-12 | 160571 | DESIGNER | 6 | |
| 2026-01-12 | 160569 | DESIGNER | 2 | |
| 2026-01-13 | 160569 | DESIGNER | 3.5 | |
| 2026-01-13 | 160576 | DESIGNER | 4 | |
| 2026-01-14 | 160576 | DESIGNER | 7 | |
| 2026-01-14 | 160571 | DESIGNER | 2 | |
| 2026-01-15 | 160571 | DESIGNER | 4 | |
| 2026-01-15 | 160595 | DESIGNER | 3 | |

**Subtotal: 48.5 hrs**

---

### SGO — 6 rows, 4.5 hrs (all QC)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-07 | 160539 | QC | 0.75 | |
| 2026-01-08 | 160554 | QC | 0.75 | |
| 2026-01-12 | 160561 | QC | 0.75 | |
| 2026-01-13 | 160566 | QC | 0.75 | |
| 2026-01-15 | 160571 | QC | 0.75 | |
| 2026-01-15 | 160569 | QC | 0.75 | |

**Subtotal: 4.5 hrs**

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
| DG | DBG | 32 | 65 | ✅ Ready to import |
| DS | DBS | 10 | 48.5 | ✅ Ready to import |
| SG | SGO | 6 | 4.5 | Ready to import |
| **TOTAL** | | **48** | **118** | **113.5 hrs blocked** |

### Pre-Import Blockers
1. ✅ RESOLVED: DG = DBG (Debby Gosh/Ghosh) — 65 hrs, 32 rows; also blocked in SBS Apr invoices
2. ✅ RESOLVED: DS = DBS (Deb Sen) — 48.5 hrs, 10 rows; also blocked in Nelson Lumber invoices
