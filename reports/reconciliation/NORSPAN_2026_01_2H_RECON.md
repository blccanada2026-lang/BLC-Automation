# Norspan Reconciliation — Jan 16–31 2026 (2026-01 2H)
# Generated: 2026-05-09
# Source: Invoice From Jan 16th-31st Norspan.pdf
# Period: 2026-01-16 to 2026-01-31
# Client: Norspan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| BC-Bharath Charles | 16 |
| RG-Ravi Gummadi | 70.5 |
| VK-Vani KV | 8.15 |
| **TOTAL** | **94.65** |

---

## Notes

- VK (Vani KV) is a new designer, first appearance. Actor code unknown.
- Two VK entries are dated 2026-01-15 (technically prior period) but appear on this invoice. Recorded as-is with date note.
- BCH has one entry with job# "Q260028/29" (bundled) and work type "Others" — recorded as QC with note; needs import confirmation.
- BCH dates in DD-MM-YYYY format on invoice, converted to YYYY-MM-DD below.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| BC | BCH | Confirmed |
| RG | ??? | Ravi Gummadi — actor code UNKNOWN (same blocker as Jan 1H) |
| VK | ??? | Vani KV — actor code UNKNOWN, new this period |

---

### RG — 15 rows, 70.5 hrs (all DESIGNER)

⚠️ Actor code UNKNOWN. All 70.5 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-16 | Q260034 | DESIGNER | 5 | |
| 2026-01-17 | Q260002 | DESIGNER | 8 | |
| 2026-01-18 | Q260017 | DESIGNER | 2 | |
| 2026-01-19 | Q260003 | DESIGNER | 12 | |
| 2026-01-19 | Q251143 | DESIGNER | 2 | |
| 2026-01-20 | Q260036 | DESIGNER | 5 | |
| 2026-01-20 | Q260022 | DESIGNER | 1 | |
| 2026-01-21 | Q260031 | DESIGNER | 4 | |
| 2026-01-22 | Q260031 | DESIGNER | 4 | |
| 2026-01-26 | Q260038 | DESIGNER | 6 | |
| 2026-01-27 | Q260025 | DESIGNER | 1.5 | |
| 2026-01-27 | Q260053 | DESIGNER | 3 | |
| 2026-01-29 | Q260054 | DESIGNER | 4 | |
| 2026-01-30 | Q260054 | DESIGNER | 12 | |
| 2026-01-30 | Q260031 | DESIGNER | 1 | |

**Subtotal: 70.5 hrs — BLOCKED: actor code unknown**

---

### VK — 12 rows, 8.15 hrs (all DESIGNER)

⚠️ Actor code UNKNOWN. All 8.15 hrs BLOCKED.
⚠️ First two entries dated 2026-01-15 (prior period) but included on this invoice.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-15 | Q260030 | DESIGNER | 0.5 | ⚠️ date falls in Jan 1H period; on this invoice |
| 2026-01-15 | Q260035 | DESIGNER | 0.5 | ⚠️ date falls in Jan 1H period; on this invoice |
| 2026-01-19 | Q260028 | DESIGNER | 0.75 | |
| 2026-01-20 | Q260029 | DESIGNER | 0.75 | |
| 2026-01-21 | Q260023 | DESIGNER | 0.25 | |
| 2026-01-22 | Q260023 | DESIGNER | 0.25 | |
| 2026-01-23 | Q260042 | DESIGNER | 0.7 | |
| 2026-01-25 | Q260052 | DESIGNER | 0.45 | |
| 2026-01-26 | Q260052 | DESIGNER | 0.5 | |
| 2026-01-27 | Q260042 | DESIGNER | 0.5 | |
| 2026-01-28 | Q260042 | DESIGNER | 2.5 | |
| 2026-01-30 | Q260023 | DESIGNER | 0.5 | |

**Subtotal: 8.15 hrs — BLOCKED: actor code unknown**

---

### BCH — 15 rows, 16 hrs

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-01-19 | Q260003 | DESIGNER | 1 | |
| 2026-01-19 | Q260002 | QC | 1.5 | |
| 2026-01-19 | Q260017 | QC | 0.5 | |
| 2026-01-19 | Q260028 | QC | 0.5 | invoice shows "Q260028/29 Others"; recorded as QC against primary job Q260028; needs import confirmation |
| 2026-01-20 | Q260022 | QC | 0.5 | |
| 2026-01-21 | Q260029 | QC | 1 | |
| 2026-01-22 | Q260034 | QC | 1 | |
| 2026-01-22 | Q260036 | QC | 0.5 | |
| 2026-01-23 | Q260031 | QC | 2 | |
| 2026-01-26 | Q260038 | QC | 1.5 | |
| 2026-01-27 | Q260052 | QC | 1 | |
| 2026-01-28 | Q260053 | QC | 1 | |
| 2026-01-29 | Q260042 | QC | 1.5 | |
| 2026-01-30 | Q260054 | QC | 2 | |
| 2026-01-31 | Q260023 | QC | 0.5 | |

**Subtotal: 16 hrs**

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
| RG | ??? | 15 | 70.5 | ❌ BLOCKED — actor code unknown |
| VK | ??? | 12 | 8.15 | ❌ BLOCKED — actor code unknown (new designer) |
| BC | BCH | 15 | 16 | Ready to import (pending Q260028/29 "Others" confirmation) |
| **TOTAL** | | **42** | **94.65** | **78.65 hrs blocked** |

### Pre-Import Blockers
1. Resolve system actor code for RG (Ravi Gummadi) — 70.5 hrs, 15 rows
2. Resolve system actor code for VK (Vani KV) — 8.15 hrs, 12 rows
3. Confirm work_type for BCH Q260028/29 "Others" entry (0.5 hrs) — recorded as QC pending review
