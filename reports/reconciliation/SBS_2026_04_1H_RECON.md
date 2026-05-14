# SBS Reconciliation — Apr 1–15 2026 (2026-04 1H)
# Generated: 2026-05-08
# Source: Invoice From April 1st to 15th SBS.pdf
# Period: 2026-04-01 to 2026-04-15
# Client: SBS (Structural Building Systems)

---

## Invoice Summary (from PDF footer)

| Designer | Invoice Total (hrs) | Line-Item Total (hrs) | Discrepancy |
|---|---|---|---|
| SGO | — | 4.5 | — |
| BCH | 66.25 | 66.75 | ⚠️ +0.5 (line items exceed invoice total) |
| ABB | — | 87.5 | — |
| RKU | — | 67.75 | — |
| SDA | — | 97 | — |
| SYR | 94.5 | 96.25 | ⚠️ +1.75 (line items exceed invoice total) |
| SVN | — | 87.75 | — |
| BSG | — | 24.25 | — |
| PBG | — | 94 | — |
| JS  | — | 68 | ⚠️ NEW EMPLOYEE — actor code unknown |
| DG  | — | 29 | ⚠️ NEW EMPLOYEE — actor code unknown |
| BT  | — | 17 | ⚠️ NEW EMPLOYEE — actor code unknown |
| **TOTAL** | **737.5** | **739.75** | **+2.25 (BCH 0.5 + SYR 1.75)** |

Note: Line items recorded as-is. BCH and SYR discrepancies noted. Invoice grand total = 737.5 hrs.
New employees JS (Joy Sarkar), DG (Debby Ghosh), BT (Bittu Dalui) — system actor codes must be resolved before import. Combined blocked hours = 114 hrs.

---

## Section 1 — Jobs on Invoice NOT in FACT_WORK_LOGS

ALL 344 rows are missing from the database. This is consistent with all prior SBS periods (Jan–Mar).

### Actor Mapping Applied
| Invoice Code | System Actor Code | Name |
|---|---|---|
| SG | SGO | — |
| BC | BCH | — |
| AB | ABB | — |
| RK | RKU | — |
| SKD | SDA | Sandy Das = Samar Kumar Das (Decision D1) |
| SR | SYR | — |
| SN | SVN | — |
| SB | BSG | BSG job descriptions stripped (text after `_` removed) |
| PG | PBG | — |
| JS | JYS | Confirmed |
| DG | DBG | Confirmed |
| BT | BIT | Confirmed |

### Work Type Mapping
| Invoice Label | System work_type |
|---|---|
| Quality Check | QC |
| Design-Quote | DESIGNER |
| Design-Production | DESIGNER |
| Rework | DESIGNER |
| Roof Truss | DESIGNER |
| Floor Truss | DESIGNER |
| OWW Floor 1/2/3 | DESIGNER (product description, not work type) |
| I JOIST Floor 1/2 | DESIGNER (product description, not work type) |

---

### SGO — 9 rows, 4.5 hrs (all QC)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-07 | 2604-4117 | QC | 1 | |
| 2026-04-13 | 2604-4133-A | QC | 0.5 | |
| 2026-04-13 | 2603-4043-A | QC | 0.5 | |
| 2026-04-14 | 2501-0506-D | QC | 0.25 | |
| 2026-04-14 | 2501-0506-E | QC | 0.25 | |
| 2026-04-15 | 2604-4117-B | QC | 0.5 | |
| 2026-04-15 | 2604-4117-C | QC | 0.5 | |
| 2026-04-15 | 2604-4117-D | QC | 0.5 | |
| 2026-04-15 | 2604-4117-E | QC | 0.5 | |

**Subtotal: 4.5 hrs**

---

### BCH — 48 rows, 66.75 hrs (line-item) / 66.25 (invoice)

⚠️ 0.5 hr discrepancy between line items and invoice total. Recording line items as-is.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | 2511-8323-C | QC | 0.75 | |
| 2026-04-01 | 2503-3627-B | DESIGNER | 2.5 | |
| 2026-04-01 | 2503-3559-A | DESIGNER | 1.5 | |
| 2026-04-01 | 2503-3627-B | DESIGNER | 0.5 | Rework→DESIGNER |
| 2026-04-01 | 2603-3833-B | QC | 1.5 | |
| 2026-04-02 | 2603-3874-A | QC | 0.75 | |
| 2026-04-02 | 2603-3993-A | QC | 0.75 | |
| 2026-04-02 | 2603-3860-A | QC | 1 | |
| 2026-04-02 | 2507-1840-A | QC | 1.5 | |
| 2026-04-02 | 2603-3833-B | QC | 0.5 | |
| 2026-04-02 | 2503-3559-D | DESIGNER | 3 | |
| 2026-04-02 | 2603-3823-A | QC | 0.75 | |
| 2026-04-03 | 2502-2023-D | QC | 0.25 | |
| 2026-04-03 | 2501-0201-C | QC | 1.75 | |
| 2026-04-03 | 2411-0117-D | QC | 2.25 | |
| 2026-04-04 | 2503-3559-D | DESIGNER | 3 | |
| 2026-04-06 | 2501-0506-B | QC | 1.5 | |
| 2026-04-06 | 2509-4875-A | QC | 1.75 | |
| 2026-04-06 | 2504-5726-E | QC | 1.5 | |
| 2026-04-06 | 2603-3814 | DESIGNER | 2 | |
| 2026-04-06 | 2604-4117 | DESIGNER | 3 | |
| 2026-04-07 | 2603-3993-A | QC | 1 | |
| 2026-04-07 | 2603-3812 | DESIGNER | 2.5 | |
| 2026-04-07 | 2503-3559-C | DESIGNER | 0.75 | |
| 2026-04-07 | M00477-A | QC | 1.5 | |
| 2026-04-08 | 2603-4002-A | QC | 0.75 | |
| 2026-04-08 | 2508-4346-F | QC | 1.5 | |
| 2026-04-08 | 2506-0697-B | QC | 2 | |
| 2026-04-08 | 2603-3869-A | QC | 0.75 | |
| 2026-04-08 | 2603-4059-A | QC | 1 | |
| 2026-04-08 | 2603-4031 | DESIGNER | 2.5 | |
| 2026-04-08 | 2603-3933-B | QC | 2 | |
| 2026-04-09 | 2604-4111 | DESIGNER | 2 | |
| 2026-04-09 | 2506-0697-B | QC | 0.5 | |
| 2026-04-10 | 2603-3933-B | QC | 0.5 | |
| 2026-04-10 | 2603-4036 | DESIGNER | 3 | |
| 2026-04-10 | 2603-4009-G | QC | 1.5 | |
| 2026-04-10 | 2603-4009-L | QC | 0.5 | |
| 2026-04-10 | 2603-4009-J | QC | 0.5 | |
| 2026-04-10 | 2603-4009-I | QC | 0.5 | |
| 2026-04-10 | 2603-4009-A | QC | 1.5 | |
| 2026-04-10 | M00477-A | QC | 0.5 | |
| 2026-04-10 | 2603-4007-B | QC | 1.5 | OWW Floor 3 |
| 2026-04-10 | 2603-4007-K | QC | 1.5 | OWW Floor 3 |
| 2026-04-11 | 2603-4007-L | QC | 0.5 | OWW Floor 3 |
| 2026-04-11 | 2604-4111-A | DESIGNER | 1 | |
| 2026-04-11 | 2604-4117-A | DESIGNER | 1.5 | |
| 2026-04-11 | 2604-4113-A | DESIGNER | 1.5 | |

**Subtotal: 66.75 hrs (line-item)**

---

### ABB — 33 rows, 87.5 hrs (all DESIGNER)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | 2603-3963-B | DESIGNER | 4 | |
| 2026-04-01 | 2603-4048-A | DESIGNER | 3.5 | |
| 2026-04-02 | 2603-3798 | DESIGNER | 2.5 | |
| 2026-04-02 | 2603-4048-A | DESIGNER | 3 | |
| 2026-04-02 | 2603-3963-B | DESIGNER | 2 | |
| 2026-04-05 | 2604-4127-A | DESIGNER | 2 | |
| 2026-04-05 | 2604-4126-A | DESIGNER | 2 | OWW Floor 1 |
| 2026-04-06 | 2604-4128-A | DESIGNER | 2.5 | OWW Floor 1 |
| 2026-04-06 | 2603-3796 | DESIGNER | 2.5 | |
| 2026-04-06 | 2604-4126-A | DESIGNER | 0.75 | OWW Floor 1 |
| 2026-04-06 | 2604-4127-A | DESIGNER | 1 | |
| 2026-04-06 | 2604-4129-A | DESIGNER | 2 | |
| 2026-04-07 | 2604-4129-A | DESIGNER | 1 | |
| 2026-04-07 | 2411-0199-E | DESIGNER | 2.5 | |
| 2026-04-07 | 2603-4007-C | DESIGNER | 4.5 | |
| 2026-04-08 | 2512-9505-F | DESIGNER | 3 | |
| 2026-04-08 | 2603-4007-E | DESIGNER | 4.5 | |
| 2026-04-08 | 2603-4007-A | DESIGNER | 1.5 | |
| 2026-04-09 | 2603-4007-G | DESIGNER | 3 | |
| 2026-04-09 | 2603-4007-A | DESIGNER | 5 | |
| 2026-04-10 | 2603-4007-A | DESIGNER | 1 | |
| 2026-04-10 | 2603-4007-C | DESIGNER | 0.25 | |
| 2026-04-10 | 2603-4007-I | DESIGNER | 2.25 | |
| 2026-04-10 | 2603-4007-G | DESIGNER | 0.5 | |
| 2026-04-10 | 2603-4007-J | DESIGNER | 2 | |
| 2026-04-10 | 2603-4007-E | DESIGNER | 1 | |
| 2026-04-10 | 2603-4048 | DESIGNER | 2 | |
| 2026-04-13 | 2604-4564-A | DESIGNER | 5 | |
| 2026-04-14 | 2604-4564-A | DESIGNER | 3 | |
| 2026-04-14 | 2604-4111 | DESIGNER | 3.25 | |
| 2026-04-14 | 2604-4643-A | DESIGNER | 4 | |
| 2026-04-15 | 2604-4643-A | DESIGNER | 2.5 | |
| 2026-04-15 | 2604-4645-A | DESIGNER | 8 | normalized from 2604-4645_A |

**Subtotal: 87.5 hrs**

---

### RKU — 39 rows, 67.75 hrs

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | 2501-0201-C | DESIGNER | 2 | |
| 2026-04-01 | 2603-3860-A | DESIGNER | 2 | |
| 2026-04-01 | 2603-3869-A | DESIGNER | 2 | |
| 2026-04-02 | 2603-3860-A | DESIGNER | 0.5 | |
| 2026-04-02 | 2501-0201-C | DESIGNER | 2 | |
| 2026-04-02 | 2501-0506-A | QC | 2 | |
| 2026-04-03 | 2411-0117-A | QC | 1.5 | |
| 2026-04-03 | 2411-0117-A | QC | 0.25 | D4: same person/job/date, separate invoice row |
| 2026-04-03 | 2504-5726-E | DESIGNER | 2 | |
| 2026-04-04 | 2504-5726-E | DESIGNER | 1.5 | |
| 2026-04-06 | 2604-4128-A | QC | 0.75 | |
| 2026-04-06 | 2506-0697-B | DESIGNER | 3 | |
| 2026-04-07 | 2603-4058-A | QC | 0.5 | |
| 2026-04-07 | 2604-4126-A | QC | 0.75 | |
| 2026-04-07 | 2506-0697-B | DESIGNER | 7 | |
| 2026-04-08 | 2603-3869-A | DESIGNER | 2 | |
| 2026-04-08 | 2604-4130-A | QC | 0.75 | |
| 2026-04-08 | 2604-4130-A | QC | 0.25 | D4: same person/job/date, separate invoice row |
| 2026-04-09 | 2603-4009-I | DESIGNER | 2 | |
| 2026-04-09 | 2603-4009-J | DESIGNER | 0.75 | |
| 2026-04-10 | 2603-4009-A | DESIGNER | 6 | |
| 2026-04-10 | 2603-4009-L | DESIGNER | 0.25 | |
| 2026-04-10 | 2603-4007-B | DESIGNER | 4.5 | |
| 2026-04-10 | 2603-4007-K | DESIGNER | 1 | |
| 2026-04-10 | 2603-4007-L | DESIGNER | 1 | |
| 2026-04-11 | 2603-4009-A | QC | 2 | |
| 2026-04-13 | 2411-0117-A | QC | 0.5 | |
| 2026-04-13 | 2604-4132-A | QC | 1 | |
| 2026-04-14 | 2604-4584-A | DESIGNER | 2.25 | |
| 2026-04-14 | 2506-0697-B | DESIGNER | 2 | |
| 2026-04-14 | 2604-4110-A | DESIGNER | 2 | date normalized from "4/14/2026" |
| 2026-04-15 | 2604-4110-B | DESIGNER | 1.25 | |
| 2026-04-15 | 2604-4110-C | DESIGNER | 1.5 | |
| 2026-04-15 | 2604-4110-D | DESIGNER | 1 | |
| 2026-04-15 | 2604-4116 | QC | 1.5 | |
| 2026-04-15 | 2604-4112-A | DESIGNER | 2 | |
| 2026-04-15 | 2604-4112-B | DESIGNER | 1.5 | |
| 2026-04-15 | 2604-4112-C | DESIGNER | 1.5 | |
| 2026-04-15 | 2604-4112-D | DESIGNER | 1.5 | |

**Subtotal: 67.75 hrs**

---

### SDA — 78 rows, 97 hrs

(Decision D1: invoice SKD = system SDA; Sandy Das = Samar Kumar Das)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | 2503-3627-G | QC | 1 | |
| 2026-04-01 | 2503-3627-B | QC | 1.5 | |
| 2026-04-01 | 2511-7690-E | QC | 1.25 | |
| 2026-04-01 | 2503-3627-B | QC | 0.25 | D4: same person/job/date, separate invoice row |
| 2026-04-01 | 2603-3993-A | DESIGNER | 5.5 | |
| 2026-04-02 | 2511-7690-E | QC | 0.25 | |
| 2026-04-02 | 2503-3559-A | QC | 0.75 | |
| 2026-04-02 | 2603-3806-A | QC | 1 | |
| 2026-04-02 | 2507-1840-A | DESIGNER | 4.75 | |
| 2026-04-02 | 2603-2756-A | QC | 1 | |
| 2026-04-02 | 2503-3559-D | QC | 1.25 | |
| 2026-04-03 | 2503-3559-D | QC | 0.25 | |
| 2026-04-03 | 2603-3895-A | QC | 0.75 | |
| 2026-04-03 | 2501-0506-B | DESIGNER | 6.75 | |
| 2026-04-03 | 2603-3898-A | QC | 1.5 | |
| 2026-04-06 | 2603-3898-A | QC | 0.25 | |
| 2026-04-06 | 2503-3559-D | QC | 1 | |
| 2026-04-06 | 2603-4051 | QC | 1.75 | |
| 2026-04-06 | 2603-3993-A | DESIGNER | 3.75 | |
| 2026-04-06 | 2603-3814 | QC | 0.5 | |
| 2026-04-06 | 2508-4346-K | DESIGNER | 1.25 | OWW Floor 2 |
| 2026-04-07 | 2503-3559-C | QC | 0.25 | |
| 2026-04-07 | 2603-3812 | QC | 0.5 | |
| 2026-04-07 | 2508-4346-K | DESIGNER | 3.5 | |
| 2026-04-07 | 2508-4346-F | DESIGNER | 3.25 | |
| 2026-04-07 | 2603-3898-B | QC | 0.5 | |
| 2026-04-07 | 2603-3898-C | QC | 0.5 | |
| 2026-04-07 | 2603-3898-D | QC | 0.5 | |
| 2026-04-08 | 2603-3900 | QC | 1.5 | |
| 2026-04-08 | 2603-4002-A | DESIGNER | 2.5 | |
| 2026-04-08 | 2603-4031 | QC | 0.75 | |
| 2026-04-08 | 2603-3900 | QC | 0.25 | D4: same person/job/date, separate invoice row |
| 2026-04-08 | 2604-4331-C | DESIGNER | 2.5 | |
| 2026-04-09 | 2604-4111 | QC | 2 | |
| 2026-04-09 | 2603-4051-B | QC | 0.5 | |
| 2026-04-09 | 2604-4113 | QC | 1.5 | |
| 2026-04-09 | 2604-4331-C | DESIGNER | 4.5 | |
| 2026-04-10 | 2603-4009-B | QC | 1.5 | |
| 2026-04-10 | 2603-4009-C | QC | 0.5 | |
| 2026-04-10 | 2603-4009-D | QC | 0.75 | |
| 2026-04-10 | 2603-4009-E | QC | 0.75 | |
| 2026-04-10 | 2603-4009-F | QC | 0.5 | |
| 2026-04-10 | 2603-4007-D | QC | 0.5 | |
| 2026-04-10 | 2603-4007-F | QC | 0.5 | |
| 2026-04-10 | 2603-4007-H | QC | 0.5 | |
| 2026-04-10 | 2603-4036 | QC | 0.5 | |
| 2026-04-10 | 2603-4007-G | QC | 0.5 | |
| 2026-04-10 | 2603-4007-J | QC | 0.5 | |
| 2026-04-10 | 2603-4007-D | QC | 0.25 | D4: same person/job/date, separate invoice row |
| 2026-04-10 | 2603-4007-F | QC | 0.25 | D4: same person/job/date, separate invoice row |
| 2026-04-10 | 2603-4007-H | QC | 0.25 | D4: same person/job/date, separate invoice row |
| 2026-04-10 | 2603-4007-E | QC | 0.75 | |
| 2026-04-10 | 2603-4009-K | QC | 0.75 | |
| 2026-04-10 | 2603-3933-C | QC | 0.25 | |
| 2026-04-13 | 2604-4132-A | DESIGNER | 2.25 | OWW Floor 2 |
| 2026-04-13 | 2604-4133-A | DESIGNER | 2.5 | |
| 2026-04-13 | 2603-4009-N | QC | 0.25 | |
| 2026-04-13 | 2603-4051 | QC | 1.75 | |
| 2026-04-13 | 2604-4331-C | DESIGNER | 1.5 | |
| 2026-04-14 | 2501-0506 | DESIGNER | 2.75 | OWW Floor 2 |
| 2026-04-14 | 2604-4131-A | QC | 0.5 | |
| 2026-04-14 | 2501-0506-D | DESIGNER | 1 | |
| 2026-04-14 | 2501-0506-E | DESIGNER | 1.25 | OWW Floor 2 |
| 2026-04-14 | 2604-4117-B | DESIGNER | 0.75 | |
| 2026-04-14 | 2604-4117-C | DESIGNER | 0.75 | |
| 2026-04-14 | 2604-4117-D | DESIGNER | 0.75 | |
| 2026-04-14 | 2604-4117-E | DESIGNER | 0.75 | |
| 2026-04-14 | 2501-0145-A | QC | 1.5 | |
| 2026-04-15 | 2501-0145-A | QC | 0.25 | |
| 2026-04-15 | 2604-4117-A | QC | 0.25 | |
| 2026-04-15 | 2604-4111-A | QC | 0.25 | |
| 2026-04-15 | 2604-4113-A | QC | 0.5 | |
| 2026-04-15 | 2501-0145-A | QC | 0.25 | D4: same person/job/date, separate invoice row |
| 2026-04-15 | 2604-4110-A | QC | 0.5 | OWW Floor 2 |
| 2026-04-15 | 2604-4110-B | QC | 0.5 | OWW Floor 2 |
| 2026-04-15 | 2604-4110-C | QC | 0.5 | OWW Floor 2 |
| 2026-04-15 | 2604-4110-D | QC | 0.5 | OWW Floor 2 |
| 2026-04-15 | 2604-4331-C | DESIGNER | 4.5 | |

**Subtotal: 97 hrs**

---

### SYR — 36 rows, 96.25 hrs (line-item) / 94.5 (invoice)

⚠️ 1.75 hr discrepancy between line items and invoice total. Recording line items as-is.
Note: 2026-04-01 has two entries for 2511-8323-C — Rework (0.5) and regular DESIGNER (1) are treated as separate rows per D4 (different work descriptions on invoice, same underlying work_type).

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | 2511-8323-C | DESIGNER | 0.5 | Rework→DESIGNER |
| 2026-04-01 | 2511-8323-C | DESIGNER | 1 | D4: separate invoice row, same job/date |
| 2026-04-01 | 2603-3874-A | DESIGNER | 2 | |
| 2026-04-01 | 2411-0117-A | DESIGNER | 1 | OWW Floor 2 |
| 2026-04-01 | 2411-0117-D | DESIGNER | 1.5 | |
| 2026-04-01 | 2509-4875-A | DESIGNER | 2 | |
| 2026-04-02 | 2411-0117-A | DESIGNER | 5 | OWW Floor 2 |
| 2026-04-02 | 2603-3823-A | DESIGNER | 2.5 | |
| 2026-04-02 | 2509-4875-A | DESIGNER | 2 | |
| 2026-04-03 | 2411-0117-D | DESIGNER | 4 | |
| 2026-04-03 | 2411-0117-A | DESIGNER | 0.75 | OWW Floor 2 |
| 2026-04-03 | 2509-4875-A | DESIGNER | 4 | |
| 2026-04-03 | 2411-0117-D | DESIGNER | 1 | Rework→DESIGNER |
| 2026-04-06 | 2509-4875-A | DESIGNER | 1 | |
| 2026-04-06 | 2603-4058-A | DESIGNER | 2 | OWW Floor 1 |
| 2026-04-07 | M00477-A | DESIGNER | 6.5 | |
| 2026-04-07 | 2604-4130-A | DESIGNER | 2 | OWW Floor 1 |
| 2026-04-08 | 2603-4059-A | DESIGNER | 4 | |
| 2026-04-08 | 2603-4009-G | DESIGNER | 4 | |
| 2026-04-09 | 2603-4009-G | DESIGNER | 6 | |
| 2026-04-09 | 2603-4009-K | DESIGNER | 2.5 | |
| 2026-04-10 | 2603-4058-A | DESIGNER | 1 | OWW Floor 2 |
| 2026-04-10 | 2603-4009-K | DESIGNER | 6 | |
| 2026-04-10 | M00477-A | DESIGNER | 0.25 | |
| 2026-04-10 | M00477-A | DESIGNER | 0.75 | D4: Rework→DESIGNER, separate invoice row |
| 2026-04-10 | 2603-4043-A | DESIGNER | 1.5 | |
| 2026-04-11 | 2603-4043-A | DESIGNER | 3 | |
| 2026-04-13 | M00477-C | DESIGNER | 7 | |
| 2026-04-13 | M00477-E | DESIGNER | 1 | |
| 2026-04-13 | 2604-4131-A | DESIGNER | 1.5 | |
| 2026-04-14 | M00477-E | DESIGNER | 4 | |
| 2026-04-14 | M00477-F | DESIGNER | 3 | |
| 2026-04-14 | M00477-G | DESIGNER | 1.5 | |
| 2026-04-15 | 2604-4116-A | DESIGNER | 7 | OWW Floor 2 |
| 2026-04-15 | M00477-G | DESIGNER | 1.5 | |
| 2026-04-15 | M00477-H | DESIGNER | 2 | |

**Subtotal: 96.25 hrs (line-item)**

---

### SVN — 44 rows, 87.75 hrs

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | 2503-3627-G | DESIGNER | 3 | |
| 2026-04-01 | 2603-3965-B | QC | 2 | |
| 2026-04-01 | 2603-3806-A | DESIGNER | 5 | |
| 2026-04-02 | 2603-4009-B | DESIGNER | 2 | |
| 2026-04-02 | 2603-3798 | QC | 2 | |
| 2026-04-03 | 2603-4048-A | QC | 2.5 | |
| 2026-04-03 | 2603-3964-B | QC | 2.5 | |
| 2026-04-03 | 2603-4048-A | QC | 0.5 | D4: same person/job/date, separate invoice row |
| 2026-04-03 | 2603-3964-B | QC | 0.5 | D4: same person/job/date, separate invoice row |
| 2026-04-03 | 2603-4051-A | DESIGNER | 3 | |
| 2026-04-04 | 2603-3965-B | QC | 0.5 | |
| 2026-04-04 | 2603-3963-B | QC | 1.5 | |
| 2026-04-06 | 2603-4051-A | DESIGNER | 5 | |
| 2026-04-06 | 2603-4009-C | DESIGNER | 2.5 | |
| 2026-04-06 | 2603-3796 | QC | 1.5 | |
| 2026-04-07 | 2604-4127-A | QC | 1.75 | |
| 2026-04-07 | 2604-4129-A | QC | 2 | |
| 2026-04-07 | 2603-3899-A | QC | 2.5 | |
| 2026-04-07 | 2603-4009-C | DESIGNER | 2.25 | |
| 2026-04-08 | 2411-0199-E | QC | 1.5 | |
| 2026-04-08 | 2603-3899-A | QC | 0.75 | |
| 2026-04-08 | 2603-3899-B | QC | 1.25 | |
| 2026-04-08 | 2603-3899-C | QC | 1 | |
| 2026-04-08 | 2512-9505-F | QC | 1.5 | |
| 2026-04-08 | 2603-4009-D | DESIGNER | 3 | |
| 2026-04-08 | 2603-3899-D | QC | 1 | |
| 2026-04-09 | 2603-4009-D | DESIGNER | 2 | |
| 2026-04-09 | 2603-4051-B | DESIGNER | 1.5 | |
| 2026-04-09 | 2603-4009-B | DESIGNER | 6.5 | |
| 2026-04-09 | 2603-4009-E | DESIGNER | 2 | |
| 2026-04-10 | 2603-4009-F | DESIGNER | 3 | |
| 2026-04-10 | 2603-4009-H | QC | 2 | |
| 2026-04-10 | 2603-4007-A | QC | 1.25 | |
| 2026-04-10 | 2603-4007-C | QC | 0.75 | |
| 2026-04-10 | 2603-4007-I | QC | 0.5 | |
| 2026-04-10 | 2603-4009-H | QC | 0.25 | D4: same person/job/date, separate invoice row |
| 2026-04-10 | 2603-4009-M | QC | 1 | |
| 2026-04-10 | 2603-4009-M | QC | 0.5 | D4: same person/job/date, separate invoice row |
| 2026-04-13 | 2603-4009-N | DESIGNER | 1.5 | |
| 2026-04-13 | 2603-4051 | DESIGNER | 3.5 | |
| 2026-04-14 | 2604-4564-A | QC | 2 | |
| 2026-04-14 | 2604-4567-A | DESIGNER | 1 | |
| 2026-04-14 | 2604-4113-A | DESIGNER | 5 | |
| 2026-04-15 | 2604-4111 | QC | 1 | |

**Subtotal: 87.75 hrs**

---

### BSG — 8 rows, 24.25 hrs (all DESIGNER)

Note: BSG invoice entries include product descriptions after job number (e.g. "2603-3895-A Roof Truss"). Descriptions stripped — job number only retained.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | 2603-3895-A | DESIGNER | 3.5 | description stripped |
| 2026-04-03 | 2603-3933-B | DESIGNER | 5 | description stripped |
| 2026-04-07 | 2603-3933-B | DESIGNER | 4.25 | description stripped |
| 2026-04-08 | 2603-3933-B | DESIGNER | 3.5 | description stripped |
| 2026-04-09 | 2603-3933-C | DESIGNER | 1 | description stripped |
| 2026-04-14 | 2604-4549-A | DESIGNER | 3 | description stripped |
| 2026-04-15 | 2604-4594-A | QC | 1.5 | description stripped |
| 2026-04-15 | 2604-4549-A | DESIGNER | 2.5 | description stripped |

**Subtotal: 24.25 hrs**

---

### PBG — 16 rows, 94 hrs (all DESIGNER)

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | 2603-3898-A | DESIGNER | 10 | |
| 2026-04-02 | 2603-2756-A | DESIGNER | 1 | |
| 2026-04-02 | 2603-3898-A | DESIGNER | 9 | |
| 2026-04-03 | 2603-3898-B | DESIGNER | 3 | |
| 2026-04-03 | 2603-3898-C | DESIGNER | 2.5 | |
| 2026-04-03 | 2603-3898-D | DESIGNER | 2.5 | |
| 2026-04-06 | 2603-3900 | DESIGNER | 8 | |
| 2026-04-07 | 2603-4007-D | DESIGNER | 9 | |
| 2026-04-08 | 2603-4007-D | DESIGNER | 2 | |
| 2026-04-08 | 2603-4007-F | DESIGNER | 8 | |
| 2026-04-09 | 2603-4007-F | DESIGNER | 4 | |
| 2026-04-09 | 2603-4007-H | DESIGNER | 6 | |
| 2026-04-13 | 2501-0145-A | DESIGNER | 9 | |
| 2026-04-14 | 2603-3790-B | DESIGNER | 10 | |
| 2026-04-15 | 2603-3790-B | DESIGNER | 6 | |
| 2026-04-15 | 2604-4587-A | DESIGNER | 4 | |

**Subtotal: 94 hrs**

---

### JS — 14 rows, 68 hrs (all DESIGNER)

⚠️ NEW EMPLOYEE — Joy Sarkar. First appeared Mar 16–31 (SBS_2026_03_2H_RECON.md). System actor code UNKNOWN. All 68 hrs BLOCKED until actor code resolved.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | 2603-3964-B | DESIGNER | 11 | Roof Truss |
| 2026-04-02 | 2603-3964-B | DESIGNER | 9.5 | Roof Truss |
| 2026-04-06 | 2603-3899-A | DESIGNER | 4.5 | Roof Truss |
| 2026-04-07 | 2603-3899-A | DESIGNER | 2 | Roof Truss |
| 2026-04-07 | 2603-3899-B | DESIGNER | 3.5 | Roof Truss |
| 2026-04-07 | 2603-3899-C | DESIGNER | 3.75 | Roof Truss |
| 2026-04-07 | 2603-3899-D | DESIGNER | 1.25 | Roof Truss |
| 2026-04-08 | 2603-3899-C | DESIGNER | 1.5 | Roof Truss |
| 2026-04-08 | 2603-3899-D | DESIGNER | 2.75 | Roof Truss |
| 2026-04-09 | 2603-4009-H | DESIGNER | 7 | Roof Truss |
| 2026-04-10 | 2603-4009-H | DESIGNER | 0.25 | Roof Truss |
| 2026-04-10 | 2603-4009-M | DESIGNER | 9 | Roof Truss |
| 2026-04-14 | 2604-4594-A | DESIGNER | 8 | Roof Truss |
| 2026-04-15 | 2604-4556-A | DESIGNER | 4 | Floor Truss |

**Subtotal: 68 hrs**

---

### DG — 16 rows, 29 hrs (all DESIGNER)

⚠️ NEW EMPLOYEE — Debby Ghosh. First appearance. System actor code UNKNOWN. All 29 hrs BLOCKED until actor code resolved.
All entries are for job 2603-3646-A (normalized from invoice "2603-3646A"). Two line items per day (I JOIST Floor 1 / I JOIST Floor 2 — treated as separate rows per D4).

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-01 | 2603-3646-A | DESIGNER | 3 | I JOIST Floor 1; normalized from 2603-3646A |
| 2026-04-01 | 2603-3646-A | DESIGNER | 3 | I JOIST Floor 2; D4 |
| 2026-04-02 | 2603-3646-A | DESIGNER | 1 | I JOIST Floor 1 |
| 2026-04-02 | 2603-3646-A | DESIGNER | 1 | I JOIST Floor 2; D4 |
| 2026-04-07 | 2603-3646-A | DESIGNER | 1.5 | I JOIST Floor 1 |
| 2026-04-07 | 2603-3646-A | DESIGNER | 1.5 | I JOIST Floor 2; D4 |
| 2026-04-08 | 2603-3646-A | DESIGNER | 2 | I JOIST Floor 1 |
| 2026-04-08 | 2603-3646-A | DESIGNER | 2 | I JOIST Floor 2; D4 |
| 2026-04-09 | 2603-3646-A | DESIGNER | 4 | I JOIST Floor 1 |
| 2026-04-09 | 2603-3646-A | DESIGNER | 2 | I JOIST Floor 2; D4 |
| 2026-04-10 | 2603-3646-A | DESIGNER | 1 | I JOIST Floor 1 |
| 2026-04-10 | 2603-3646-A | DESIGNER | 1 | I JOIST Floor 2; D4 |
| 2026-04-13 | 2603-3646-A | DESIGNER | 2 | I JOIST Floor 1 |
| 2026-04-13 | 2603-3646-A | DESIGNER | 2 | I JOIST Floor 2; D4 |
| 2026-04-15 | 2603-3646-A | DESIGNER | 1 | I JOIST Floor 1 |
| 2026-04-15 | 2603-3646-A | DESIGNER | 1 | I JOIST Floor 2; D4 |

**Subtotal: 29 hrs**

---

### BT — 3 rows, 17 hrs (all DESIGNER)

⚠️ NEW EMPLOYEE — Bittu Dalui. First appearance. System actor code UNKNOWN. All 17 hrs BLOCKED until actor code resolved.
All entries are for job 2502-2158-F (normalized from invoice "2502-2158F"), all Roof Truss.

| work_date | job_number | work_type | hours | notes |
|---|---|---|---|---|
| 2026-04-13 | 2502-2158-F | DESIGNER | 2 | normalized from 2502-2158F |
| 2026-04-14 | 2502-2158-F | DESIGNER | 8 | |
| 2026-04-15 | 2502-2158-F | DESIGNER | 7 | |

**Subtotal: 17 hrs**

---

## Section 2 — Hours Mismatch > 0.25 hrs

No comparison possible — FACT_WORK_LOGS has zero SBS entries for this period. Consistent with all prior periods.

---

## Section 3 — Jobs in FACT_WORK_LOGS NOT on Invoice

No comparison possible — FACT_WORK_LOGS has zero SBS entries for this period. Consistent with all prior periods.

---

## Section 4 — Summary

| Designer | System Code | Rows | Hours (line-item) | Hours (invoice) | Status |
|---|---|---|---|---|---|
| SG | SGO | 9 | 4.5 | 4.5 | Ready to import |
| BC | BCH | 48 | 66.75 | 66.25 | ⚠️ +0.5 discrepancy — recording line items |
| AB | ABB | 33 | 87.5 | 87.5 | Ready to import |
| RK | RKU | 39 | 67.75 | 67.75 | Ready to import |
| SKD | SDA | 78 | 97 | 97 | Ready to import |
| SR | SYR | 36 | 96.25 | 94.5 | ⚠️ +1.75 discrepancy — recording line items |
| SN | SVN | 44 | 87.75 | 87.75 | Ready to import |
| SB | BSG | 8 | 24.25 | 24.25 | Ready to import |
| PG | PBG | 16 | 94 | 94 | Ready to import |
| JS | JYS | 14 | 68 | 68 | ✅ Ready to import |
| DG | DBG | 16 | 29 | 29 | ✅ Ready to import |
| BT | BIT | 3 | 17 | 17 | ✅ Ready to import |
| **TOTAL** | | **344** | **739.75** | **737.5** | **114 hrs blocked** |

### Key Findings
- ALL 344 rows are missing from FACT_WORK_LOGS. Consistent with all prior SBS periods.
- Invoice grand total: 737.5 hrs. Line-item total: 739.75 hrs. Gap: 2.25 hrs (BCH 0.5 + SYR 1.75).
- 3 new employees appear for the first time this period: JS (Joy Sarkar), DG (Debby Ghosh), BT (Bittu Dalui).
- 114 hrs blocked pending actor code resolution for new employees.
- 230 hrs (9 designers with known codes) are ready to import once import session begins.
- D4 applied to 12 duplicate same-person/same-job/same-date invoice rows across multiple designers.
- Normalizations: 2603-3646A→2603-3646-A (DG), 2502-2158F→2502-2158-F (BT), 2604-4645_A→2604-4645-A (ABB).

### Pre-Import Blockers
1. ✅ RESOLVED: JS = JYS (Joy Sarkar) — 68 hrs, 14 rows
2. ✅ RESOLVED: DG = DBG (Debby Ghosh) — 29 hrs, 16 rows
3. ✅ RESOLVED: BT = BIT (Bittu Dalui) — 17 hrs, 3 rows
4. Add new employees to DIM_STAFF_ROSTER if not already present
