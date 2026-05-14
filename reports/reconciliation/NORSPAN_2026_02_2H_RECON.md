# Norspan Reconciliation — Feb 16–28 2026 (2026-02 2H)
# Generated: 2026-05-09
# Source: Invoice From Feb 16th to 28th Norspan.pdf
# Period: 2026-02-16 to 2026-02-28
# Client: Norspan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| BC-Bharath Charles | 12.75 |
| RG-Ravi Gummadi | 38.5 |
| VK-Vani | 21.25 |
| **TOTAL** | **72.5** |

---

## Notes

- Same three designers as prior periods. No new actors.
- BCH dates in DD-MM-YYYY format, converted to YYYY-MM-DD below.
- BCH has one DESIGNER entry (Q260010 on 2026-02-26) — not all QC.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| BC | BCH | Confirmed |
| RG | RKG | Confirmed |
| VK | VKV | Confirmed |

---

### RG — 10 rows, 38.5 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-02-16 | Q260099 | DESIGNER | 3 | |
| 2026-02-17 | Q260098 | DESIGNER | 3 | |
| 2026-02-18 | Q260106 | DESIGNER | 6 | |
| 2026-02-20 | Q260108 | DESIGNER | 1 | |
| 2026-02-20 | Q260110 | DESIGNER | 3 | |
| 2026-02-24 | Q260114 | DESIGNER | 0.5 | |
| 2026-02-24 | Q260117 | DESIGNER | 2 | |
| 2026-02-26 | Q260110 | DESIGNER | 7 | |
| 2026-02-27 | Q260110 | DESIGNER | 10 | |
| 2026-02-28 | Q260099 | DESIGNER | 3 | |

**Subtotal: 38.5 hrs**

---

### VK — 14 rows, 21.25 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-02-16 | Q260089 | DESIGNER | 1 | |
| 2026-02-16 | Q260090 | DESIGNER | 1 | |
| 2026-02-16 | Q260091 | DESIGNER | 1 | |
| 2026-02-17 | Q260091 | DESIGNER | 2.5 | |
| 2026-02-17 | Q260102 | DESIGNER | 0.5 | |
| 2026-02-20 | Q260107 | DESIGNER | 2.5 | |
| 2026-02-21 | Q260107 | DESIGNER | 1.5 | |
| 2026-02-22 | Q260112 | DESIGNER | 3 | |
| 2026-02-24 | Q260113 | DESIGNER | 3 | |
| 2026-02-25 | Q260113 | DESIGNER | 1 | |
| 2026-02-26 | Q260113 | DESIGNER | 1 | |
| 2026-02-26 | Q260123 | DESIGNER | 1.75 | |
| 2026-02-27 | Q260113 | DESIGNER | 1 | |
| 2026-02-28 | Q260113 | DESIGNER | 0.5 | |

**Subtotal: 21.25 hrs**

---

### BCH — 12 rows, 12.75 hrs

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-02-16 | Q260089 | QC | 2 | |
| 2026-02-18 | Q260091 | QC | 1 | |
| 2026-02-18 | Q260098 | QC | 1 | |
| 2026-02-20 | Q260106 | QC | 0.5 | |
| 2026-02-24 | Q260106 | QC | 1 | |
| 2026-02-24 | Q260107 | QC | 1 | |
| 2026-02-24 | Q260108 | QC | 0.5 | |
| 2026-02-24 | Q260112 | QC | 0.5 | |
| 2026-02-26 | Q260010 | DESIGNER | 2 | |
| 2026-02-26 | Q260114 | QC | 0.5 | |
| 2026-02-27 | Q260117 | QC | 0.75 | |
| 2026-02-28 | Q260010 | QC | 2 | |

**Subtotal: 12.75 hrs**

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
| RG | RKG | 10 | 38.5 | ✅ Ready to import |
| VK | VKV | 14 | 21.25 | ✅ Ready to import |
| BC | BCH | 12 | 12.75 | Ready to import |
| **TOTAL** | | **36** | **72.5** | **59.75 hrs blocked** |

### Pre-Import Blockers
1. ✅ RESOLVED: RG = RKG (Ravi Gummadi) — 38.5 hrs, 10 rows
2. ✅ RESOLVED: VK = VKV (Vani KV) — 21.25 hrs, 14 rows
