# Norspan Reconciliation — Apr 16–30 2026 (2026-04 2H)
# Generated: 2026-05-09
# Source: Invoice From April 16th to 30th Norspan.pdf
# Period: 2026-04-16 to 2026-04-30
# Client: Norspan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| BC-Bharath Charles | 11.75 |
| RG-Ravi Gummadi | 50 |
| VK-Vani | 14.5 |
| SG-Sarty Ghosh | 0 |
| **TOTAL** | **76.25** |

---

## Notes

- BCH dates in DD-MM-YYYY format, converted to YYYY-MM-DD below.
- BCH all QC this period.
- RG has both DESIGNER and QC entries this period.
- VK all DESIGNER this period.
- SG-Sarty Ghosh listed in the employee summary table but has zero line items and 0 hrs this period (second consecutive period).
- Q260239G, Q260245A, Q260241A, Q260241B, Q260241C — letter suffixes are part of the job number (consistent with prior periods).
- Q260241, Q260241A, Q260241B, Q260241C — four separate job variants on 2026-04-20 for RG; all recorded as separate rows.
- Q250411 (VK, Apr 28–29) — Q25-prefix job appearing in Apr 2026; older job carried over. Recorded as-is.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| BC | BCH | Confirmed |
| RG | RKG | Confirmed |
| VK | VKV | Confirmed |
| SG | SGO | Confirmed — 0 hrs this period |

---

### RG — 23 rows, 50 hrs


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-16 | Q260239G | DESIGNER | 0.25 | G suffix is part of job number |
| 2026-04-17 | Q260242 | DESIGNER | 2 | |
| 2026-04-17 | Q260230 | DESIGNER | 0.25 | |
| 2026-04-17 | Q260245 | DESIGNER | 0.5 | |
| 2026-04-17 | Q260245A | DESIGNER | 0.5 | A suffix is part of job number |
| 2026-04-17 | Q260243 | DESIGNER | 1 | |
| 2026-04-17 | Q260239 | DESIGNER | 0.75 | |
| 2026-04-18 | Q260246 | DESIGNER | 5 | |
| 2026-04-18 | Q260232 | DESIGNER | 1.5 | |
| 2026-04-19 | Q260246 | DESIGNER | 3 | |
| 2026-04-19 | Q260233 | DESIGNER | 1.5 | |
| 2026-04-20 | Q260241 | DESIGNER | 2.25 | |
| 2026-04-20 | Q260241A | DESIGNER | 1 | A suffix is part of job number |
| 2026-04-20 | Q260241B | DESIGNER | 0.75 | B suffix is part of job number |
| 2026-04-20 | Q260241C | DESIGNER | 0.75 | C suffix is part of job number |
| 2026-04-22 | Q260251 | DESIGNER | 3 | |
| 2026-04-22 | Q260248 | QC | 0.75 | |
| 2026-04-23 | Q260250 | QC | 0.75 | |
| 2026-04-24 | Q260256 | DESIGNER | 8 | |
| 2026-04-27 | Q260260 | DESIGNER | 5 | |
| 2026-04-29 | Q260261 | DESIGNER | 3 | |
| 2026-04-29 | Q260263 | DESIGNER | 2.5 | |
| 2026-04-30 | Q260267 | DESIGNER | 6 | |

**Subtotal: 50 hrs**

---

### VK — 9 rows, 14.5 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-20 | Q260248 | DESIGNER | 1 | |
| 2026-04-21 | Q260248 | DESIGNER | 1.5 | |
| 2026-04-22 | Q260250 | DESIGNER | 2 | |
| 2026-04-24 | Q260254 | DESIGNER | 2 | |
| 2026-04-28 | Q250411 | DESIGNER | 2 | Q25-prefix; older job carried over to Apr 2026, recorded as-is |
| 2026-04-29 | Q250411 | DESIGNER | 1.5 | Q25-prefix; older job carried over to Apr 2026, recorded as-is |
| 2026-04-29 | Q260250 | DESIGNER | 1.5 | |
| 2026-04-30 | Q260275 | DESIGNER | 2 | |
| 2026-04-30 | Q260265 | DESIGNER | 1 | |

**Subtotal: 14.5 hrs**

---

### BCH — 16 rows, 11.75 hrs (all QC)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-17 | Q260242 | QC | 0.5 | |
| 2026-04-20 | Q260230 | QC | 0.5 | |
| 2026-04-20 | Q260239G | QC | 0.5 | G suffix is part of job number |
| 2026-04-20 | Q260243 | QC | 0.5 | |
| 2026-04-20 | Q260232 | QC | 0.75 | |
| 2026-04-20 | Q260205 | QC | 0.25 | |
| 2026-04-20 | Q260245 | QC | 0.5 | |
| 2026-04-20 | Q260245A | QC | 0.5 | A suffix is part of job number |
| 2026-04-20 | Q260246 | QC | 1.5 | |
| 2026-04-24 | Q260233 | QC | 0.5 | |
| 2026-04-24 | Q260239 | QC | 0.75 | |
| 2026-04-24 | Q260250 | QC | 0.5 | |
| 2026-04-24 | Q260251 | QC | 0.75 | |
| 2026-04-27 | Q260256 | QC | 1.5 | |
| 2026-04-28 | Q260260 | QC | 1.5 | |
| 2026-04-30 | Q260261 | QC | 0.75 | |

**Subtotal: 11.75 hrs**

---

### SGO — 0 rows, 0 hrs

SGO listed in employee summary table this period but has no line items and no billable hours.

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
| RG | RKG | 23 | 50 | ✅ Ready to import |
| VK | VKV | 9 | 14.5 | ✅ Ready to import |
| BC | BCH | 16 | 11.75 | Ready to import |
| SG | SGO | 0 | 0 | No entries this period |
| **TOTAL** | | **48** | **76.25** | **64.5 hrs blocked** |

### Pre-Import Blockers
1. ✅ RESOLVED: RG = RKG (Ravi Gummadi) — 50 hrs, 23 rows
2. ✅ RESOLVED: VK = VKV (Vani KV) — 14.5 hrs, 9 rows
