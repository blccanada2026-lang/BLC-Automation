# Titan Reconciliation — Apr 16–30 2026 (2026-04 2H)
# Generated: 2026-05-13
# Source: Invoice From April 16th to 30th Titan.pdf
# Period: 2026-04-16 to 2026-04-30
# Client: Titan

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| PS-Prianka Santra | 13 |
| PG-Pabitra Ghosh | 1 |
| NM-Nitish Mishra | 0 |
| SG-Sarty Gosh | 0 |
| DS-Deb Sen | 0 |
| **TOTAL** | **14** |

---

## Notes

- Dates: mixed formats — PG row uses YYYY-MM-DD; PS rows use DD-MM-YYYY. All converted to YYYY-MM-DD below.
- PG, PS actor codes UNKNOWN — all 14 hrs blocked (100%).
- NM, SG (SGO), DS: 0 hrs this period.
- Date typo: PG QC row shows 2026-05-22 (May 22) on an Apr 16–30 invoice → corrected to 2026-04-22. Verify against original PDF at import.
- P-169 (PS, Apr 16) — P-prefix job number, same series as P-157 (Mar 2H).
- Two PS rows on 2026-04-22 for B600147 (4 hrs + 2.5 hrs, both Roof Truss Design-Quote) — D4: import both as separate rows.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| PG | ??? | Pabitra Ghosh — actor code UNKNOWN |
| PS | ??? | Prianka Santra — actor code UNKNOWN |
| NM | ??? | Nitish Mishra — actor code UNKNOWN; 0 hrs this period |
| SG | SGO | Confirmed; 0 hrs this period |
| DS | ??? | Deb Sen — actor code UNKNOWN; 0 hrs this period |

---

### PG — 1 row, 1 hr (QC)

⚠️ Actor code UNKNOWN. All 1 hr BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-22 | B600147 | QC | 1 | Roof Truss; invoice shows 2026-05-22 — corrected to 2026-04-22 |

**Subtotal: 1 hr — BLOCKED: actor code unknown**

---

### PS — 3 rows, 13 hrs (all DESIGNER)

⚠️ Actor code UNKNOWN. All 13 hrs BLOCKED.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-16 | P-169 | DESIGNER | 6.5 | Roof Truss; P-prefix job number |
| 2026-04-22 | B600147 | DESIGNER | 4 | Roof Truss |
| 2026-04-22 | B600147 | DESIGNER | 2.5 | Roof Truss; D4: second row same job/date |

**Subtotal: 13 hrs — BLOCKED: actor code unknown**

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
| PG | ??? | 1 | 1 | ❌ BLOCKED — actor code unknown |
| PS | ??? | 3 | 13 | ❌ BLOCKED — actor code unknown |
| NM | ??? | 0 | 0 | No hrs this period |
| SG | SGO | 0 | 0 | No hrs this period |
| DS | ??? | 0 | 0 | No hrs this period |
| **TOTAL** | | **4** | **14** | **14 hrs blocked (100%)** |

### Pre-Import Blockers
1. Resolve system actor code for PG (Pabitra Ghosh) — 1 hr, 1 row
2. Resolve system actor code for PS (Prianka Santra) — 13 hrs, 3 rows

### Import Notes
- PG B600147 QC: invoice date 2026-05-22 → corrected to 2026-04-22; verify against original PDF at import.
- B600147 (PS, 2026-04-22): two rows same job/date — D4, import both as separate rows.
- P-169: P-prefix series (same as P-157 from Mar 2H); record full string as job number.
