# Norspan Reconciliation — Feb 1–15 2026 (2026-02 1H)
# Generated: 2026-05-09
# Source: Invoice From Feb 1st-15th Norspan.pdf
# Period: 2026-02-01 to 2026-02-15
# Client: Norspan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| BC-Bharath Charles | 7.5 |
| RG-Ravi Gummadi | 37 |
| VK-Vani | 27 |
| **TOTAL** | **71.5** |

---

## Notes

- RG has QC entries this period (Q260081, Q260082 on Feb 10) — not all DESIGNER.
- VK on 2026-02-10: two entries for Q260081 — DESIGNER (2 hrs) and QC (2 hrs) same day. D4 applies (different work types).
- BCH dates in DD-MM-YYYY format on invoice, converted to YYYY-MM-DD below.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| BC | BCH | Confirmed |
| RG | RKG | Confirmed |
| VK | VKV | Confirmed |

---

### RG — 11 rows, 37 hrs


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-02-03 | Q260070 | DESIGNER | 2 | |
| 2026-02-04 | Q260070 | DESIGNER | 5 | |
| 2026-02-06 | Q260075 | DESIGNER | 7 | |
| 2026-02-07 | Q250357G | DESIGNER | 0.5 | G is part of job number |
| 2026-02-07 | Q260077 | DESIGNER | 1.5 | |
| 2026-02-10 | Q260081 | QC | 1 | |
| 2026-02-10 | Q260082 | QC | 1 | |
| 2026-02-11 | Q260084 | DESIGNER | 5 | |
| 2026-02-12 | Q260093 | DESIGNER | 8 | |
| 2026-02-13 | Q260093 | DESIGNER | 4 | |
| 2026-02-13 | Q260092 | DESIGNER | 2 | |

**Subtotal: 37 hrs**

---

### VK — 13 rows, 27 hrs


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-02-04 | Q260071 | DESIGNER | 2.5 | |
| 2026-02-05 | Q260071 | DESIGNER | 0.5 | |
| 2026-02-06 | Q260071 | DESIGNER | 0.5 | |
| 2026-02-07 | Q260079 | DESIGNER | 1.5 | |
| 2026-02-08 | Q260081 | DESIGNER | 5 | |
| 2026-02-08 | Q260082 | DESIGNER | 1 | |
| 2026-02-09 | Q260082 | DESIGNER | 5 | |
| 2026-02-10 | Q260081 | DESIGNER | 2 | |
| 2026-02-10 | Q260081 | QC | 2 | D4: different work type, same job/date |
| 2026-02-12 | Q260089 | QC | 2.5 | |
| 2026-02-13 | Q260089 | QC | 3 | |
| 2026-02-15 | Q260089 | DESIGNER | 1.5 | |

**Subtotal: 27 hrs**

---

### BCH — 8 rows, 7.5 hrs (all QC)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-02-05 | Q260070 | QC | 1.5 | |
| 2026-02-06 | Q260071 | QC | 1 | |
| 2026-02-07 | Q260075 | QC | 1.5 | |
| 2026-02-07 | Q260077 | QC | 0.5 | |
| 2026-02-07 | Q250357G | QC | 0.5 | G is part of job number |
| 2026-02-10 | Q260081 | QC | 0.5 | |
| 2026-02-12 | Q260082 | QC | 0.5 | |
| 2026-02-12 | Q260084 | QC | 1.5 | |

**Subtotal: 7.5 hrs**

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
| RG | RKG | 11 | 37 | ✅ Ready to import |
| VK | VKV | 13 | 27 | ✅ Ready to import |
| BC | BCH | 8 | 7.5 | Ready to import |
| **TOTAL** | | **32** | **71.5** | **64 hrs blocked** |

### Pre-Import Blockers
1. ✅ RESOLVED: RG = RKG (Ravi Gummadi) — 37 hrs, 11 rows
2. ✅ RESOLVED: VK = VKV (Vani KV) — 27 hrs, 13 rows
