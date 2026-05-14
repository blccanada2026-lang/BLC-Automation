# Nelson Lumber Reconciliation — Apr 1–15 2026 (2026-04 1H)
# Generated: 2026-05-09
# Source: Invoice From April 1st-15th Nelson.pdf
# Period: 2026-04-01 to 2026-04-15
# Client: Nelson Lumber

---

## Invoice Summary

| Designer | Invoice Total (hrs) |
|---|---|
| SG-Sarty Gosh | 33.5 |
| DS-Deb Sen | 19.5 |
| AR-Abhisekh Rit | 41 |
| **TOTAL** | **94** |

---

## Notes

- SG - Sarty Gosh = SGO (confirmed across SBS, Norspan, and Nelson Lumber).
- DS-Deb Sen — first period with actual hours. Actor code still UNKNOWN. 19.5 hrs blocked.
- AR-Abhisekh Rit — actor code still UNKNOWN. 41 hrs blocked.
- AR date typo: last AR row on invoice shows 15-04-2028 — clearly 2026 given billing period. Corrected to 2026.
- Job number variants this period (all suffixes/descriptors are part of the job number):
  - G2602072_CORRIDOR — underscore + descriptor suffix
  - G2602072F_REVISION — underscore + REVISION suffix
  - G2602072-Rev — hyphen + Rev suffix (AR's revision jobs)
  - 260391B1F — B1F suffix (Floor variant of B1)
  - 260391B1 — B1 suffix (Roof Truss variant of B1)
  - 260391B2 — B2 suffix
- All entries are Design-Quote → DESIGNER work type.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

### Actor Mapping
| Invoice Code | System Actor Code | Notes |
|---|---|---|
| SG | SGO | Confirmed |
| DS | DBS | Confirmed |
| AR | AR001 | Confirmed |

---

### AR — 5 rows, 41 hrs (all DESIGNER)

⚠️ Last AR row on invoice shows 15-04-2028 — corrected to 2026.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-09 | G2602072-Rev | DESIGNER | 8 | Hyphen+Rev suffix is part of job number |
| 2026-04-10 | G2602072-Rev | DESIGNER | 12 | Hyphen+Rev suffix is part of job number |
| 2026-04-13 | 260391B1 | DESIGNER | 8 | B1 suffix is part of job number |
| 2026-04-14 | 260391B1 | DESIGNER | 5 | B1 suffix is part of job number |
| 2026-04-15 | 260391B1 | DESIGNER | 8 | Invoice date showed 15-04-2028; corrected to 2026 |

**Subtotal: 41 hrs**

---

### DS — 4 rows, 19.5 hrs (all DESIGNER)


| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-07 | 260391B2 | DESIGNER | 7.5 | B2 suffix is part of job number |
| 2026-04-09 | 260391B2 | DESIGNER | 2 | |
| 2026-04-11 | 260391B2 | DESIGNER | 7 | |
| 2026-04-14 | 260391B2 | DESIGNER | 3 | |

**Subtotal: 19.5 hrs**

---

### SGO — 8 rows, 33.5 hrs (all DESIGNER)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | G2602072F | DESIGNER | 6 | I JOIST Floor; F suffix is part of job number |
| 2026-04-02 | G2602072_CORRIDOR | DESIGNER | 6 | I JOIST Floor; full string is the job number |
| 2026-04-06 | 260391B1F | DESIGNER | 2 | I JOIST Floor; B1F suffix is part of job number |
| 2026-04-07 | 260391B1F | DESIGNER | 2 | I JOIST Floor |
| 2026-04-08 | G2602072F_REVISION | DESIGNER | 5 | I JOIST Floor; full string is the job number |
| 2026-04-08 | 260391B1F | DESIGNER | 2.5 | I JOIST Floor |
| 2026-04-09 | G2602072F_REVISION | DESIGNER | 6 | I JOIST Floor |
| 2026-04-15 | 260391B1F | DESIGNER | 4 | I JOIST Floor |

**Subtotal: 33.5 hrs**

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
| AR | AR001 | 5 | 41 | ✅ Ready to import |
| DS | DBS | 4 | 19.5 | ✅ Ready to import |
| SG | SGO | 8 | 33.5 | Ready to import |
| **TOTAL** | | **17** | **94** | **60.5 hrs blocked** |

### Pre-Import Blockers
1. ✅ RESOLVED: AR = AR001 (Abhisekh Rit) — 41 hrs, 5 rows
2. ✅ RESOLVED: DS = DBS (Deb Sen) — 19.5 hrs, 4 rows

### Import Notes
- Last AR row on invoice dated 15-04-2028 — corrected to 2026 in this report. Verify against original PDF at import.
- Nelson Lumber job numbers include extended variants: G2602072_CORRIDOR, G2602072F_REVISION, G2602072-Rev. Import the full string as the job_number — do not truncate.
