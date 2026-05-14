# Nelson Lumber Reconciliation — Mar 16–31 2026 (2026-03 2H)
# Generated: 2026-05-09
# Source: Invoice From March 16th to 31st Nelson.pdf
# Period: 2026-03-16 to 2026-03-31
# Client: Nelson Lumber

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| SG-Sarty Gosh | 13.5 |
| AR-Abhisekh Rit | 64 |
| DS-Deb Sen | 0 |
| **TOTAL** | **77.5** |

---

## Notes

- First Nelson Lumber period processed. New client — different job number format from Norspan/SBS.
- Nelson Lumber job number format: no Q-prefix. Examples: 260337, 260337F, G2602072, G2602072F.
  - F suffix on job numbers = Floor variant (I JOIST Floor job type). Letter suffix is part of the job number.
  - G prefix on G2602072/G2602072F — part of the job number as issued by the client.
- SG - Sarty Gosh = SGO (same person confirmed across SBS and Norspan invoices).
- AR - Abhisekh Rit — NEW designer for Nelson Lumber. Actor code UNKNOWN. All 64 hrs blocked.
- DS - Deb Sen — listed in employee summary table but has zero line items and 0 hrs this period. Actor code unknown; no import action needed this period.
- AR date typo: all AR rows on the invoice show year 2020 (19-03-2020, 22-03-2020, etc.) — clearly 2026 given the billing period. Corrected to 2026 below.
- All entries are Design-Quote → DESIGNER work type.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| SG | SGO | Confirmed — same Sarty Gosh/Ghosh across all clients |
| AR | AR001 | Confirmed |
| DS | DBS | Confirmed |

---

### AR — 9 rows, 64 hrs (all DESIGNER)

⚠️ Invoice shows year 2020 for all AR dates — corrected to 2026.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-19 | 260337 | DESIGNER | 8 | Invoice date showed 19-03-2020; corrected to 2026 |
| 2026-03-22 | 260337 | DESIGNER | 8 | Invoice date showed 22-03-2020; corrected to 2026 |
| 2026-03-23 | 260337 | DESIGNER | 6 | Invoice date showed 23-03-2020; corrected to 2026 |
| 2026-03-24 | 260337 | DESIGNER | 2 | Invoice date showed 24-03-2020; corrected to 2026 |
| 2026-03-25 | 260337 | DESIGNER | 6 | Invoice date showed 25-03-2020; corrected to 2026 |
| 2026-03-27 | G2602072 | DESIGNER | 1 | Invoice date showed 27-03-2020; corrected to 2026 |
| 2026-03-29 | G2602072 | DESIGNER | 8 | Invoice date showed 29-03-2020; corrected to 2026 |
| 2026-03-30 | G2602072 | DESIGNER | 10 | Invoice date showed 30-03-2020; corrected to 2026 |
| 2026-03-31 | G2602072 | DESIGNER | 15 | Invoice date showed 31-03-2020; corrected to 2026 |

**Subtotal: 64 hrs**

---

### SGO — 4 rows, 13.5 hrs (all DESIGNER)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-03-19 | 260337F | DESIGNER | 3 | I JOIST Floor job; F suffix is part of job number |
| 2026-03-22 | 260337F | DESIGNER | 2.5 | I JOIST Floor job; F suffix is part of job number |
| 2026-03-23 | 260337F | DESIGNER | 2 | I JOIST Floor job; F suffix is part of job number |
| 2026-03-31 | G2602072F | DESIGNER | 6 | I JOIST Floor job; F suffix is part of job number |

**Subtotal: 13.5 hrs**

---

### DS — 0 rows, 0 hrs

DS-Deb Sen listed in employee summary table but has no line items and no billable hours this period.

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
| AR | AR001 | 9 | 64 | ✅ Ready to import |
| SG | SGO | 4 | 13.5 | Ready to import |
| DS | DBS | 0 | 0 | No entries this period; actor code TBD |
| **TOTAL** | | **13** | **77.5** | **64 hrs blocked** |

### Pre-Import Blockers
1. ✅ RESOLVED: AR = AR001 (Abhisekh Rit) — 64 hrs, 9 rows
2. ✅ RESOLVED: DS = DBS (Deb Sen) — 0 hrs this period, but needed for future periods

### Import Notes
- All AR dates on invoice showed year 2020 — corrected to 2026 in this report. Verify against original PDF at import time.
- Nelson Lumber job numbers have no Q-prefix. Do not add Q prefix during import.
