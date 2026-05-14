# Reconciliation Report — SBS | Jan 1–15 2026 (2026-01 1H)
Generated: 2026-05-08
Invoice: `/Users/rajnair/Downloads/invoices 2026 BLC/SBS invoices 2026/Invoice From January 1st to 15th SBS.pdf`
FACT_WORK_LOGS source: `FACT_WORK_LOGS|2026-01` (98 rows total in DB for period)
Client filter: job numbers matching SBS format (YYMM-NNNN, M00NNN)

---

## HEADLINE FINDING

**The entire SBS Jan 1–15 invoice (293 hours, 76 line items, 9 designers) is absent from FACT_WORK_LOGS.**
The Jan 2026 work log partition contains only Norspan (Q-prefix) and Titan/Alberta (B-prefix) entries.
Zero SBS work log rows exist for this period.

**Action required: All 76 invoice line items need to be written to FACT_WORK_LOGS.**

---

## Person Code Mapping (Invoice → System)

| Invoice Code | Invoice Name    | System Code | System Name           | Role        |
|---|---|---|---|---|
| SG           | Sarty Gosh      | SGO         | Sarty Gosh            | PM          |
| BC           | Bharath Charles | BCH         | Bharath Charles       | TEAM_LEAD   |
| SKD          | Sandy Das       | SDA         | Samar Kumar Das       | TEAM_LEAD   |
| SN           | Savvy Nath      | SVN         | Savvy Nath            | TEAM_LEAD   |
| RK           | Raj Kumar       | RKU         | Raj Kumar             | QC_REVIEWER |
| AB           | Abby Bera       | ABB         | Abhijit Bera          | DESIGNER    |
| SR           | Sayan Roy       | SYR         | Sayan Roy             | DESIGNER    |
| PG           | Pabitra Ghosh   | PBG         | Pabitra Gosh          | TEAM_LEAD   |
| SB           | Sagar Banik     | BSG         | Banik Sagar           | DESIGNER    |

Note: SKD→SDA mapping inferred (invoice "Sandy Das" = system "Samar Kumar Das"). Confirm before import.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS (ALL 76 entries)

### SGO — Sarty Gosh | Invoice total: 8.75 hrs

| Date       | Job#             | Type         | Hrs  | Work Type    |
|---|---|---|---|---|
| 07-01-2026 | 2501-0502        | Roof Truss   | 3.00 | QC           |
| 12-01-2026 | 2512-9641        | Roof Truss   | 1.50 | QC           |
| 13-01-2026 | 2601-0198        | Roof Truss   | 1.50 | QC           |
| 13-01-2026 | (job assign & help) | —         | 0.75 | ADMIN        |
| 14-01-2026 | (job assign & help) | —         | 1.00 | ADMIN        |
| 15-01-2026 | (job assign & help) | —         | 1.00 | ADMIN        |

### BCH — Bharath Charles | Invoice total: 24.5 hrs

| Date       | Job#             | Type         | Hrs  | Work Type    |
|---|---|---|---|---|
| 02-01-2026 | 2512-9521        | Roof Truss   | 1.50 | QC           |
| 07-01-2026 | 2503-3460        | Roof Truss   | 3.00 | QC           |
| 08-01-2026 | 2501-0469        | Roof Truss   | 2.00 | QC           |
| 08-01-2026 | 2601-0113        | Roof Truss   | 1.00 | QC           |
| 10-01-2026 | 2512-9411        | Roof Truss   | 6.00 | DESIGN       |
| 12-01-2026 | 2512-9411        | Roof Truss   | 5.00 | DESIGN       |
| 15-01-2026 | 2601-0386        | Roof Truss   | 6.00 | DESIGN       |

### SDA — Sandy Das (SKD) | Invoice total: 73.5 hrs

| Date       | Job#             | Description                              | Hrs  | Work Type    |
|---|---|---|---|---|
| 01-01-2026 | 2512-9195        | Everette Residence Roof                  | 4.50 | DESIGN       |
| 02-01-2026 | 2512-9195        | Everette Residence Roof                  | 5.50 | DESIGN       |
| 02-01-2026 | 2503-4005        | Bidgeport Rev2                           | 2.25 | QC           |
| 03-01-2026 | 2512-9656        | The Village of College Park Lot 00.0103  | 1.00 | QC           |
| 05-01-2026 | 2503-3616        | Neroli Rev.2                             | 2.50 | QC           |
| 05-01-2026 | 2512-9195        | Everette Residence Roof                  | 2.50 | DESIGN       |
| 05-01-2026 | 2509-4562        | Cumberland II Rev.15                     | 2.75 | QC           |
| 07-01-2026 | 2501-0502        | Regent II Rev.3                          | 3.50 | DESIGN       |
| 07-01-2026 | 2512-9641        | Dance Hall Road Roof                     | 1.50 | DESIGN       |
| 08-01-2026 | 2512-9641        | Dance Hall Road Roof                     | 8.25 | DESIGN       |
| 09-01-2026 | 2512-9641        | Dance Hall Road Roof                     | 8.50 | DESIGN       |
| 12-01-2026 | 2512-9641        | Dance Hall Road Roof                     | 2.50 | DESIGN       |
| 12-01-2026 | 2512-9411        | Walsh Residence Roof                     | 5.50 | DESIGN       |
| 13-01-2026 | 2512-9411        | Walsh Residence Roof                     | 9.50 | DESIGN       |
| 14-01-2026 | 2601-0292        | Briar Creek Dr                           | 2.25 | QC           |
| 14-01-2026 | 2601-0382        | 1313 Cleveland Street Roof               | 2.50 | DESIGN       |
| 15-01-2026 | 2601-0260        | 409 Elm Avenue Roof                      | 1.50 | QC           |
| 15-01-2026 | 2512-9411        | Walsh Residence Roof                     | 5.25 | DESIGN       |
| 15-01-2026 | 2601-0207        | 1909 Hillside Drive Roof                 | 1.75 | QC           |

### SVN — Savvy Nath | Invoice total: 37.5 hrs

| Date       | Job#             | Hrs  | Work Type    |
|---|---|---|---|
| 01-01-2026 | 2503-3616-H      | 4.00 | DESIGN       |
| 02-01-2026 | 2503-3616-H      | 3.00 | DESIGN       |
| 02-01-2026 | 2503-3616-I      | 6.00 | DESIGN       |
| 04-01-2026 | 2503-3616-I      | 5.00 | DESIGN       |
| 13-01-2026 | 2601-0207-A      | 4.00 | DESIGN       |
| 13-01-2026 | 2510-6647-A      | 2.00 | DESIGN       |
| 14-01-2026 | 2601-0207-A      | 8.00 | DESIGN       |
| 15-01-2026 | 2601-0207-A      | 4.00 | DESIGN       |
| 15-01-2026 | 2601-0246-A      | 1.50 | QC           |

### RKU — Raj Kumar | Invoice total: 34.5 hrs

| Date       | Job#             | Type         | Hrs  | Work Type    |
|---|---|---|---|---|
| 05-01-2026 | 2503-3460-C      | Roof Truss   | 1.50 | DESIGN       |
| 05-01-2026 | 2512-9748-A      | OWW Floor 2  | 1.75 | QC           |
| 06-01-2026 | 2503-3460-C      | Roof Truss   | 2.50 | DESIGN       |
| 06-01-2026 | 2601-0013-A      | OWW Floor 2  | 1.00 | QC           |
| 06-01-2026 | 2503-3460-D      | Roof Truss   | 3.00 | DESIGN       |
| 07-01-2026 | 2506-3460-B      | Roof Truss   | 2.50 | DESIGN       |
| 07-01-2026 | 2601-0010-A      | OWW Floor 2  | 1.25 | QC           |
| 07-01-2026 | M00181           | OWW Floor 2  | 0.75 | QC           |
| 07-01-2026 | 2503-3460-H      | Roof Truss   | 2.00 | DESIGN       |
| 08-01-2026 | 2601-0113-A      | OWW Floor 2  | 2.00 | DESIGN       |
| 07-01-2026 | 2601-0010-A      | OWW Floor 2  | 1.00 | QC           |
| 12-01-2026 | 2512-8822        | Roof Truss   | 0.50 | DESIGN       |
| 12-01-2026 | 2502-1842        | Roof Truss   | 1.75 | DESIGN       |
| 14-01-2026 | 2601-0362        | OWW Floor 1  | 5.50 | DESIGN       |
| 15-01-2026 | 2601-0362        | OWW Floor 2  | 5.00 | DESIGN       |
| 15-01-2026 | 2506-0431        | Roof Truss   | 2.00 | DESIGN       |
| 15-01-2026 | 2506-0430        | OWW Floor 2  | 0.50 | DESIGN       |

### ABB — Abhijit Bera (Abby Bera) | Invoice total: 15.5 hrs

| Date       | Job#             | Type         | Hrs  | Work Type    |
|---|---|---|---|---|
| 07-01-2026 | M00181           | OWW Floor 1  | 1.50 | DESIGN       |
| 09-01-2026 | 2601-0010        | OWW Floor 1  | 2.00 | DESIGN       |
| 09-01-2026 | 2510-7410        | Roof Truss   | 1.50 | DESIGN       |
| 12-01-2026 | 2601-0198        | Roof Truss   | 2.50 | DESIGN       |
| 13-01-2026 | 2601-0292        | Roof Truss   | 6.50 | DESIGN       |
| 15-01-2026 | 2601-0246        | Roof Truss   | 1.50 | DESIGN       |

### SYR — Sayan Roy | Invoice total: 22.75 hrs

| Date       | Job#             | Type         | Hrs  | Work Type    |
|---|---|---|---|---|
| 02-01-2026 | 2512-9748-A      | OWW Floor 2  | 5.00 | DESIGN       |
| 03-01-2026 | 2512-9748-A      | OWW Floor 2  | 2.00 | DESIGN       |
| 05-01-2026 | 2512-9748-A      | OWW Floor 2  | 2.00 | DESIGN       |
| 05-01-2026 | 2503-4005-K      | Roof Truss   | 1.00 | DESIGN       |
| 05-01-2026 | 2503-4005-E      | Roof Truss   | 0.50 | DESIGN       |
| 05-01-2026 | 2503-4005-H      | Roof Truss   | 0.50 | DESIGN       |
| 05-01-2026 | 2503-4005-A      | Roof Truss   | 0.50 | DESIGN       |
| 06-01-2026 | 2601-0013-A      | OWW Floor 1  | 1.50 | DESIGN       |
| 09-01-2026 | 2510-7409-A      | OWW Floor 2  | 1.75 | DESIGN       |
| 15-01-2026 | 2601-0222-A      | OWW Floor 1  | 3.00 | DESIGN       |
| 15-01-2026 | 2601-0223-A      | Roof Truss   | 3.00 | DESIGN       |
| 15-01-2026 | 2503-4005-F      | Roof Truss   | 1.00 | DESIGN       |
| 15-01-2026 | 2503-4005-G      | Roof Truss   | 1.00 | DESIGN       |

### PBG — Pabitra Ghosh | Invoice total: 5.5 hrs

| Date       | Job#             | Type         | Hrs  | Work Type    |
|---|---|---|---|---|
| 02-01-2026 | 2512-9656        | Roof Truss   | 4.00 | DESIGN       |
| 14-01-2026 | 2601-0260        | Roof Truss   | 1.50 | DESIGN       |

### BSG — Sagar Banik | Invoice total: 70.5 hrs

| Date       | Job#             | Description                    | Hrs  | Work Type    |
|---|---|---|---|---|
| 01-01-2026 | 2509-4562-D      | Cumberland II rev 15 (Metro)   | 1.50 | DESIGN       |
| 01-01-2026 | 2509-4562-D      | Cumberland II rev 15 (Metro)   | 2.50 | DESIGN       |
| 01-01-2026 | 2509-4562-D      | Cumberland II rev 15 (Metro)   | 1.50 | DESIGN       |
| 01-01-2026 | 2509-4562-D      | Cumberland II rev 15 (Metro)   | 2.50 | DESIGN       |
| 02-01-2026 | 2509-4562-D      | Cumberland II rev 15 (Metro)   | 2.50 | DESIGN       |
| 02-01-2026 | 2509-4562-D      | Cumberland II rev 15 (Metro)   | 2.25 | DESIGN       |
| 02-01-2026 | 2509-4562-G      | Cumberland II rev 15 (Metro)   | 2.50 | DESIGN       |
| 05-01-2026 | 2509-4562-G      | Cumberland II rev 15 (Metro)   | 2.50 | DESIGN       |
| 05-01-2026 | 2509-4562-G      | Cumberland II rev 15 (Metro)   | 2.25 | DESIGN       |
| 05-01-2026 | 2509-4562-G      | Cumberland II rev 15 (Metro)   | 2.50 | DESIGN       |
| 06-01-2026 | 2509-4562-G      | Cumberland II rev 15 (Metro)   | 1.50 | DESIGN       |
| 06-01-2026 | 2509-4562-G      | Cumberland II rev 15 (Metro)   | 1.50 | DESIGN       |
| 06-01-2026 | 2509-4562-A      | Cumberland II rev 15 (Metro)   | 1.50 | DESIGN       |
| 06-01-2026 | 2509-4562-A      | Cumberland II rev 15 (Metro)   | 2.50 | DESIGN       |
| 07-01-2026 | 2509-4562-A      | Cumberland II rev 15 (Metro)   | 1.50 | DESIGN       |
| 07-01-2026 | 2509-4562-A      | Cumberland II rev 15 (Metro)   | 2.50 | DESIGN       |
| 07-01-2026 | 2509-4562-A      | Cumberland II rev 15 (Metro)   | 2.50 | DESIGN       |
| 07-01-2026 | 2509-4562-A      | Cumberland II rev 15 (Metro)   | 2.25 | DESIGN       |
| 08-01-2026 | 2509-4562-C      | Cumberland II rev 15 (Metro)   | 2.00 | DESIGN       |
| 08-01-2026 | 2509-4562-H      | Cumberland II rev 15 (Metro)   | 2.50 | DESIGN       |
| 08-01-2026 | 2509-4562-H      | Cumberland II rev 15 (Metro)   | 2.50 | DESIGN       |
| 09-01-2026 | 2509-4562-H      | Cumberland II rev 15 (Metro)   | 2.25 | DESIGN       |
| 09-01-2026 | 2509-4562-H      | Cumberland II rev 15 (Metro)   | 2.50 | DESIGN       |
| 09-01-2026 | 2509-4562-H      | Cumberland II rev 15 (Metro)   | 1.50 | DESIGN       |
| 09-01-2026 | 2509-4562-H      | Cumberland II rev 15 (Metro)   | 1.50 | DESIGN       |
| 12-01-2026 | 2601-0204-A      | 18853 Harmony Church Road Roof | 2.00 | DESIGN       |
| 14-01-2026 | 2601-0364-A      | 7 Solitude Ct Roof T318178     | 7.50 | DESIGN       |
| 15-01-2026 | 2601-0364-A      | 7 Solitude Ct Roof T318178     | 8.00 | DESIGN       |

---

## Section 2 — Hours Mismatch > 0.25 hrs

**N/A** — No SBS work logs exist in FACT_WORK_LOGS for this period. Cannot compute mismatch.

---

## Section 3 — Jobs in FACT_WORK_LOGS NOT on Invoice

**None** — No SBS entries exist in FACT_WORK_LOGS for 2026-01.

(The Jan 2026 partition contains 98 rows total: Norspan entries for RKG/BCH/VKV and Titan entries for PRS/PBG/DBS/NMM/SGO. Zero SBS job numbers present.)

---

## Section 4 — Summary Totals

| Designer    | System Code | Invoice Hrs | DB Hrs | Delta   | Status         |
|---|---|---|---|---|---|
| Sarty Gosh  | SGO         | 8.75        | 0.00   | -8.75   | ❌ MISSING     |
| Bharath Charles | BCH     | 24.50       | 0.00   | -24.50  | ❌ MISSING     |
| Sandy Das   | SDA         | 73.50       | 0.00   | -73.50  | ❌ MISSING     |
| Savvy Nath  | SVN         | 37.50       | 0.00   | -37.50  | ❌ MISSING     |
| Raj Kumar   | RKU         | 34.50       | 0.00   | -34.50  | ❌ MISSING     |
| Abby Bera   | ABB         | 15.50       | 0.00   | -15.50  | ❌ MISSING     |
| Sayan Roy   | SYR         | 22.75       | 0.00   | -22.75  | ❌ MISSING     |
| Pabitra Ghosh | PBG       | 5.50        | 0.00   | -5.50   | ❌ MISSING     |
| Sagar Banik | BSG         | 70.50       | 0.00   | -70.50  | ❌ MISSING     |
| **TOTAL**   |             | **293.00**  | **0.00** | **-293.00** | **❌ ALL MISSING** |

**Invoice total hours: 293.00**
**DB hours (SBS, Jan 1–15): 0.00**
**Gap: 293.00 hours across 76 line items**

---

## Flags / Blockers Before Import

1. **SKD → SDA mapping** — Confirm "Sandy Das" (invoice) = "Samar Kumar Das" (system code SDA). If wrong, all 19 SDA entries will be mis-attributed.
2. **"job assign & help" entries (SGO, 2.75 hrs)** — No job number. Need a placeholder job number or admin work log category to store these.
3. **RKU duplicate date** — Two entries on 07-01-2026 for job 2601-0010-A (1.25 + 1.00 hrs). Both are on the invoice — confirm both should be written.
4. **BSG multiple same-day entries** — Sagar Banik has 4 entries on 01-01-2026 all for 2509-4562-D. Invoice shows them separately — write as 4 distinct rows.
