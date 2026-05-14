# Norspan Reconciliation — Mar 1–15 2026 (2026-03 1H)
# Generated: 2026-05-09
# Source: Invoice From March 1st-15th Norspan MB.pdf
# Period: 2026-03-01 to 2026-03-15
# Client: Norspan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| BC-Bharath Charles | 8.75 |
| RG-Ravi Gummadi | 49.5 |
| VK-Vani | 21 |
| SG-Sarty Ghosh | 2.5 |
| **TOTAL** | **81.75** |

---

## Notes

- SG-Sarty Ghosh = SGO (same Sarty Gosh/Ghosh from SBS) — actor code confirmed as SGO.
- RG has two QC entries this period (Q260141 on Mar 11, Q260140 on Mar 13).
- Q260127M — M suffix is part of the job number throughout (same pattern as Q251145G in Jan).
- Q24403A — different format from standard Q26xxxx; recorded as-is.
- BCH and VK dates in DD-MM-YYYY on invoice, converted to YYYY-MM-DD below.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| BC | BCH | Confirmed |
| RG | ??? | Ravi Gummadi — actor code UNKNOWN (ongoing blocker) |
| VK | ??? | Vani KV — actor code UNKNOWN (ongoing blocker) |
| SG | SGO | Sarty Ghosh = SGO — confirmed via SBS invoices |

---

### RG — 20 rows, 49.5 hrs

⚠️ Actor code UNKNOWN. All 49.5 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-03 | Q260127 | DESIGNER | 0.5 | |
| 2026-03-03 | Q260127M | DESIGNER | 0.5 | OWW Floor 1; M is part of job number |
| 2026-03-03 | Q260103 | DESIGNER | 3 | |
| 2026-03-04 | Q260103 | DESIGNER | 4 | |
| 2026-03-04 | Q260124 | DESIGNER | 4 | |
| 2026-03-05 | Q260124 | DESIGNER | 6 | |
| 2026-03-06 | Q260124 | DESIGNER | 6 | |
| 2026-03-06 | Q24403A | DESIGNER | 1 | non-standard job number format; recorded as-is |
| 2026-03-06 | Q260129 | DESIGNER | 2 | |
| 2026-03-07 | Q260129 | DESIGNER | 2 | |
| 2026-03-07 | Q260133 | DESIGNER | 3 | |
| 2026-03-09 | Q260135 | DESIGNER | 4 | |
| 2026-03-10 | Q260134 | DESIGNER | 3 | |
| 2026-03-10 | Q260140 | DESIGNER | 0.5 | |
| 2026-03-11 | Q260141 | QC | 0.5 | |
| 2026-03-11 | Q260133 | DESIGNER | 3 | |
| 2026-03-12 | Q260134 | DESIGNER | 4 | |
| 2026-03-13 | Q260140 | QC | 1 | |
| 2026-03-13 | Q260127M | DESIGNER | 0.5 | OWW Floor 1 |
| 2026-03-13 | Q260142 | DESIGNER | 1 | |

**Subtotal: 49.5 hrs — BLOCKED: actor code unknown**

---

### VK — 12 rows, 21 hrs (all DESIGNER)

⚠️ Actor code UNKNOWN. All 21 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-02 | Q260125 | DESIGNER | 3.5 | |
| 2026-03-03 | Q260126 | DESIGNER | 2 | |
| 2026-03-04 | Q260128 | DESIGNER | 4 | |
| 2026-03-05 | Q260128 | DESIGNER | 1 | |
| 2026-03-05 | Q260132 | DESIGNER | 1 | |
| 2026-03-06 | Q260132 | DESIGNER | 1 | |
| 2026-03-09 | Q260140 | DESIGNER | 2.5 | |
| 2026-03-10 | Q260140 | DESIGNER | 1 | |
| 2026-03-10 | Q260141 | DESIGNER | 1.5 | |
| 2026-03-11 | Q260141 | DESIGNER | 1 | |
| 2026-03-11 | Q260140 | DESIGNER | 1 | |
| 2026-03-12 | Q260141 | DESIGNER | 1.5 | |

**Subtotal: 21 hrs — BLOCKED: actor code unknown**

---

### BCH — 10 rows, 8.75 hrs (all QC)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-02 | Q260113 | QC | 1.5 | |
| 2026-03-02 | Q260099 | QC | 1.5 | |
| 2026-03-04 | Q260125 | QC | 0.5 | |
| 2026-03-04 | Q260126 | QC | 0.5 | |
| 2026-03-04 | Q260103 | QC | 1.25 | |
| 2026-03-06 | Q260128 | QC | 0.5 | |
| 2026-03-06 | Q260127 | QC | 0.5 | |
| 2026-03-06 | Q260124 | QC | 1.5 | |
| 2026-03-06 | Q260127M | QC | 0.5 | M is part of job number |
| 2026-03-06 | Q260132 | QC | 0.5 | |

**Subtotal: 8.75 hrs**

---

### SGO — 5 rows, 2.5 hrs (all QC)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-12 | Q260129 | QC | 0.5 | |
| 2026-03-12 | Q260133 | QC | 0.5 | |
| 2026-03-12 | Q260135 | QC | 0.5 | |
| 2026-03-13 | Q260142 | QC | 0.5 | |
| 2026-03-13 | Q260127M | QC | 0.5 | M is part of job number |

**Subtotal: 2.5 hrs**

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
| RG | ??? | 20 | 49.5 | ❌ BLOCKED — actor code unknown |
| VK | ??? | 12 | 21 | ❌ BLOCKED — actor code unknown |
| BC | BCH | 10 | 8.75 | Ready to import |
| SG | SGO | 5 | 2.5 | Ready to import |
| **TOTAL** | | **47** | **81.75** | **70.5 hrs blocked** |

### Pre-Import Blockers
1. Resolve system actor code for RG (Ravi Gummadi) — 49.5 hrs, 20 rows
2. Resolve system actor code for VK (Vani KV) — 21 hrs, 12 rows
