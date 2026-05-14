# Reconciliation Report — SBS | Jan 16–31 2026 (2026-01 2H)
Generated: 2026-05-08
Invoice: `/Users/rajnair/Downloads/invoices 2026 BLC/SBS invoices 2026/Invoice From January 16th to 31st SBS.pdf`
FACT_WORK_LOGS source: `FACT_WORK_LOGS|2026-01` (98 rows — Norspan + Titan/Alberta only)

---

## HEADLINE FINDING

**All 578.75 hours (183 line items, 9 designers) are absent from FACT_WORK_LOGS.**
Same root cause as 2026-01 1H — SBS work logs were never migrated into the Jan partition.

**Flags in this invoice (normalize on import):**
- `2601-038` (BCH, 17-01) — likely `2601-0038`, missing leading zero. ⚠️ Confirm job number.
- `2601-0050-c` (ABB, 26-01) — lowercase suffix; normalize to `2601-0050-C`.
- `2601 - 0418` (PBG, 19-01) — spaces in job number; normalize to `2601-0418`.

---

## Section 1 — All Invoice Line Items (missing from DB)

### SGO — Sarty Gosh | Invoice total: 29.00 hrs

| Date       | Job#              | Type       | Hrs  | Work Type |
|---|---|---|---|---|
| 16-01-2026 | SBS-ADMIN-2026-01 | —          | 1.50 | ADMIN     |
| 16-01-2026 | 2601-0382         | Roof Truss | 2.00 | QC        |
| 19-01-2026 | SBS-ADMIN-2026-01 | —          | 1.50 | ADMIN     |
| 20-01-2026 | SBS-ADMIN-2026-01 | —          | 1.50 | ADMIN     |
| 21-01-2026 | SBS-ADMIN-2026-01 | —          | 1.50 | ADMIN     |
| 21-01-2026 | 2601-0549         | Roof Truss | 2.00 | QC        |
| 22-01-2026 | SBS-ADMIN-2026-01 | —          | 1.50 | ADMIN     |
| 22-01-2026 | 2601-0163         | Roof Truss | 2.50 | QC        |
| 23-01-2026 | SBS-ADMIN-2026-01 | —          | 1.50 | ADMIN     |
| 26-01-2026 | SBS-ADMIN-2026-01 | —          | 1.50 | ADMIN     |
| 27-01-2026 | SBS-ADMIN-2026-01 | —          | 3.00 | ADMIN     |
| 28-01-2026 | SBS-ADMIN-2026-01 | —          | 3.00 | ADMIN     |
| 29-01-2026 | SBS-ADMIN-2026-01 | —          | 3.00 | ADMIN     |
| 30-01-2026 | SBS-ADMIN-2026-01 | —          | 2.00 | ADMIN     |
| 30-01-2026 | 2601-0673         | Roof Truss | 1.00 | QC        |

### BCH — Bharath Charles | Invoice total: 60.00 hrs

| Date       | Job#      | Type        | Hrs   | Work Type |
|---|---|---|---|---|
| 17-01-2026 | 2506-0430 | OWW Floor 1 | 1.50  | QC        |
| 17-01-2026 | 2601-038  | Roof Truss  | 2.00  | QC        |
| 19-01-2026 | 2601-0222 | Roof Truss  | 2.00  | DESIGN    |
| 19-01-2026 | 2601-0163 | Roof Truss  | 4.00  | DESIGN    |
| 20-01-2026 | 2601-0163 | Roof Truss  | 10.00 | DESIGN    |
| 21-01-2026 | 2601-0633 | Roof Truss  | 0.50  | QC        |
| 21-01-2026 | 2601-0163 | Roof Truss  | 4.00  | DESIGN    |
| 21-01-2026 | 2601-0161 | OWW Floor 1 | 2.00  | DESIGN    |
| 22-01-2026 | 2601-0161 | OWW Floor 1 | 8.00  | DESIGN    |
| 23-01-2026 | 2601-0358 | OWW Floor 1 | 2.00  | QC        |
| 23-01-2026 | 2601-0676 | Roof Truss  | 1.50  | QC        |
| 24-01-2026 | 2601-0673 | Roof Truss  | 5.00  | DESIGN    |
| 26-01-2026 | 2601-0673 | Roof Truss  | 1.00  | DESIGN    |
| 26-01-2026 | 2601-0667 | Roof Truss  | 1.50  | DESIGN    |
| 27-01-2026 | 2601-0650 | Roof Truss  | 1.50  | QC        |
| 28-01-2026 | 2601-0637 | Roof Truss  | 1.50  | QC        |
| 28-01-2026 | 2601-0555 | Roof Truss  | 2.00  | QC        |
| 29-01-2026 | 2601-0673 | Roof Truss  | 7.00  | DESIGN    |
| 30-01-2026 | 2601-0673 | Roof Truss  | 3.00  | DESIGN    |

### RKU — Raj Kumar | Invoice total: 58.50 hrs

| Date       | Job#         | Type        | Hrs  | Work Type |
|---|---|---|---|---|
| 19-01-2026 | 2512-8644-B  | Roof Truss  | 0.75 | DESIGN    |
| 19-01-2026 | 2512-8644-D  | Roof Truss  | 0.50 | DESIGN    |
| 19-01-2026 | 2512-8644-E  | Roof Truss  | 0.75 | DESIGN    |
| 19-01-2026 | 2512-8644-F  | Roof Truss  | 0.75 | DESIGN    |
| 19-01-2026 | 2511-8323-A  | Roof Truss  | 0.75 | DESIGN    |
| 19-01-2026 | 2511-8323-C  | Roof Truss  | 0.50 | DESIGN    |
| 19-01-2026 | 2601-0335-A  | Roof Truss  | 0.50 | DESIGN    |
| 21-01-2026 | 2501-0469-B  | Roof Truss  | 2.00 | DESIGN    |
| 21-01-2026 | 2601-0633    | Roof Truss  | 2.00 | DESIGN    |
| 21-01-2026 | 2601-0684    | Roof Truss  | 2.00 | DESIGN    |
| 21-01-2026 | 2601-0163    | OWW Floor 2 | 1.50 | DESIGN    |
| 22-01-2026 | 2601-0475    | OWW Floor 1 | 1.00 | QC        |
| 22-01-2026 | 2601-0475    | OWW Floor 2 | 0.75 | QC        |
| 22-01-2026 | 2601-0163    | OWW Floor 1 | 2.00 | DESIGN    |
| 22-01-2026 | 2601-0163    | OWW Floor 2 | 0.50 | DESIGN    |
| 22-01-2026 | 2601-0684    | Roof Truss  | 3.00 | DESIGN    |
| 23-01-2026 | 2601-0358    | OWW Floor 2 | 6.00 | DESIGN    |
| 26-01-2026 | 2601-0650    | Roof Truss  | 3.50 | DESIGN    |
| 26-01-2026 | 2501-1012    | OWW Floor 2 | 0.50 | DESIGN    |
| 26-01-2026 | 2601-0555    | Roof Truss  | 0.50 | DESIGN    |
| 27-01-2026 | 2601-0555    | Roof Truss  | 5.50 | DESIGN    |
| 28-01-2026 | 2601-0635    | OWW Floor 1 | 1.75 | QC        |
| 28-01-2026 | 2601-0636    | OWW Floor 2 | 1.50 | QC        |
| 28-01-2026 | 2601-0603    | OWW Floor 2 | 2.50 | QC        |
| 29-01-2026 | 2601-0820    | OWW Floor 2 | 3.50 | DESIGN    |
| 30-01-2026 | 2601-0824    | OWW Floor 2 | 3.50 | DESIGN    |
| 30-01-2026 | 2601-0555    | Roof Truss  | 1.50 | DESIGN    |
| 31-01-2026 | 2601-1056    | OWW Floor 2 | 1.00 | QC        |
| 31-01-2026 | 2601-1056    | OWW Floor 1 | 1.00 | QC        |
| 31-01-2026 | 2601-0825    | OWW Floor 2 | 3.50 | DESIGN    |
| 31-01-2026 | 2601-0826    | OWW Floor 2 | 3.50 | DESIGN    |

### SDA — Sandy Das | Invoice total: 83.50 hrs

| Date       | Job#              | Description                          | Type        | Hrs  | Work Type |
|---|---|---|---|---|---|
| 16-01-2026 | 2601-0364         | 7 Solitude Ct Roof T318178           | Roof Truss  | 1.75 | QC        |
| 16-01-2026 | 2601-0382         | 1313 Cleveland Street Roof           | Roof Truss  | 3.50 | DESIGN    |
| 16-01-2026 | 2506-0431         | The Farm at Neill's Creek Lot 152    | Roof Truss  | 1.50 | QC        |
| 16-01-2026 | 2503-4005         | Bridgeport Rev2                      | Roof Truss  | 1.75 | QC        |
| 17-01-2026 | 2601-0382         | 1313 Cleveland Street Roof           | Roof Truss  | 0.75 | DESIGN    |
| 19-01-2026 | 2601-0418         | 7788 Greenwich Rd Roof/OWF           | OWW Floor 2 | 1.25 | QC        |
| 19-01-2026 | 2601-0418         | 7788 Greenwich Rd Roof/OWF           | Roof Truss  | 0.50 | QC        |
| 19-01-2026 | 2601-0060         | All American Builders Hatley Roof    | Roof Truss  | 1.75 | QC        |
| 20-01-2026 | 2601-0549         | 922 Glyndon St Roof                  | Roof Truss  | 6.50 | DESIGN    |
| 20-01-2026 | 2601-0395         | Huntsville Reserve Lot 00.0182 Roof  | Roof Truss  | 1.50 | QC        |
| 21-01-2026 | 2601-0639         | 121 Vernon Drive Roof                | Roof Truss  | 1.25 | QC        |
| 21-01-2026 | 2601-0549         | 922 Glyndon St Roof                  | Roof Truss  | 5.50 | DESIGN    |
| 21-01-2026 | 2601-0635         | Muldoon Cottage OWF1                 | OWW Floor 1 | 1.75 | DESIGN    |
| 22-01-2026 | 2601-0393         | Hampton Rev. 99                      | Roof Truss  | 1.50 | QC        |
| 22-01-2026 | 2601-0635         | Muldoon Cottage OWF1                 | OWW Floor 1 | 6.50 | DESIGN    |
| 24-01-2026 | 2601-0046-C       | Crawford BA (Bungalow) Roof          | Roof Truss  | 1.75 | QC        |
| 24-01-2026 | 2601-0049-C       | Crawford EA (European) Roof          | Roof Truss  | 1.75 | QC        |
| 26-01-2026 | 2601-0636         | Muldoon Cottage OWF2                 | OWW Floor 2 | 3.50 | DESIGN    |
| 26-01-2026 | 2601-0637         | Muldoon Cottage Roof                 | Roof Truss  | 4.50 | DESIGN    |
| 27-01-2026 | 2601-0689         | 5552 Merry Oaks Road Roof            | Roof Truss  | 1.75 | QC        |
| 27-01-2026 | 2601-0637         | Muldoon Cottage Roof                 | Roof Truss  | 2.00 | DESIGN    |
| 27-01-2026 | 2601-0635         | Muldoon Cottage OWF1                 | OWW Floor 1 | 2.75 | DESIGN    |
| 27-01-2026 | 2601-0636         | Muldoon Cottage OWF2                 | OWW Floor 2 | 2.75 | DESIGN    |
| 28-01-2026 | 2601-0920         | 1813 Generals Highway Roof           | Roof Truss  | 4.50 | DESIGN    |
| 28-01-2026 | 2601-0635         | Muldoon Cottage OWF1                 | OWW Floor 1 | 1.25 | DESIGN    |
| 28-01-2026 | 2601-0636         | Muldoon Cottage OWF2                 | OWW Floor 2 | 1.25 | DESIGN    |
| 28-01-2026 | 2601-0049         | Crawford Roof                        | Roof Truss  | 1.00 | QC        |
| 29-01-2026 | 2512-9195         | Everette Residence Roof              | Roof Truss  | 8.50 | DESIGN    |
| 30-01-2026 | 2601-0871         | 2190 Bolivar Ct Roof                 | Roof Truss  | 1.25 | QC        |
| 30-01-2026 | 2601-0847         | Bradleys Overlook Lot 5 Roof         | Roof Truss  | 1.50 | QC        |
| 30-01-2026 | 2601-0637         | Muldoon Cottage Roof                 | Roof Truss  | 1.00 | DESIGN    |
| 30-01-2026 | 2601-0920         | 1813 Generals Highway Roof           | Roof Truss  | 2.50 | DESIGN    |
| 30-01-2026 | 2601-0919         | 1813 Generals Highway OWF            | OWW Floor 2 | 2.75 | DESIGN    |

### SVN — Savvy Nath | Invoice total: 62.50 hrs

| Date       | Job#         | Type       | Hrs  | Work Type |
|---|---|---|---|---|
| 16-01-2026 | 2601-0060-A  | Roof Truss | 8.00 | DESIGN    |
| 17-01-2026 | 2601-0060-A  | Roof Truss | 4.00 | DESIGN    |
| 19-01-2026 | 2601-0060-A  | Roof Truss | 9.50 | DESIGN    |
| 20-01-2026 | 2601-0639-A  | Roof Truss | 2.00 | DESIGN    |
| 21-01-2026 | 2601-0393-D  | Roof Truss | 3.00 | DESIGN    |
| 21-01-2026 | 2601-0393-E  | Roof Truss | 3.00 | DESIGN    |
| 22-01-2026 | 2601-0478-A  | Roof Truss | 2.00 | QC        |
| 22-01-2026 | 2601-0393-D  | Roof Truss | 2.00 | DESIGN    |
| 22-01-2026 | 2601-0393-E  | Roof Truss | 2.00 | DESIGN    |
| 28-01-2026 | 2601-0847-A  | Roof Truss | 8.00 | DESIGN    |
| 29-01-2026 | 2601-0847-A  | Roof Truss | 8.50 | DESIGN    |
| 29-01-2026 | 2601-0915-A  | Roof Truss | 1.00 | DESIGN    |
| 30-01-2026 | 2601-0985-A  | Roof Truss | 1.50 | QC        |
| 30-01-2026 | 2601-0915-A  | Roof Truss | 8.00 | DESIGN    |

### PBG — Pabitra Ghosh | Invoice total: 30.00 hrs

| Date       | Job#      | Type       | Hrs  | Work Type |
|---|---|---|---|---|
| 19-01-2026 | 2601-0418 | Roof Truss | 8.00 | DESIGN    |
| 20-01-2026 | 2601-0395 | Roof Truss | 8.00 | DESIGN    |
| 27-01-2026 | 2601-0689 | Roof Truss | 8.00 | DESIGN    |
| 29-01-2026 | 2601-0871 | Roof Truss | 4.00 | DESIGN    |
| 30-01-2026 | 2601-0913 | Roof Truss | 2.00 | DESIGN    |

### BSG — Sagar Banik | Invoice total: 64.25 hrs

| Date       | Job#         | Description                    | Type        | Hrs  | Work Type |
|---|---|---|---|---|---|
| 16-01-2026 | 2601-0362-A  | 7 Solitude Ct Roof T318178     | OWW Floor 1 | 0.50 | QC        |
| 16-01-2026 | 2601-0362-A  | 7 Solitude Ct Roof T318178     | OWW Floor 2 | 0.50 | QC        |
| 20-01-2026 | 2512-9236-A  | Creighton Farms Lot 19         | Roof Truss  | 2.25 | DESIGN    |
| 20-01-2026 | 2601-0392-E  | Washington rev 99 (Metro)      | Roof Truss  | 2.50 | DESIGN    |
| 20-01-2026 | 2601-0392-E  | Washington rev 99 (Metro)      | Roof Truss  | 2.25 | DESIGN    |
| 20-01-2026 | 2601-0392-E  | Washington rev 99 (Metro)      | Roof Truss  | 3.50 | DESIGN    |
| 21-01-2026 | 2601-0392-E  | Washington rev 99 (Metro)      | Roof Truss  | 1.50 | DESIGN    |
| 21-01-2026 | 2601-0392-D  | Washington rev 99 (Metro)      | Roof Truss  | 4.25 | DESIGN    |
| 22-01-2026 | 2601-0047-C  | Crawford                       | Roof Truss  | 8.00 | DESIGN    |
| 23-01-2026 | 2601-0047-C  | Crawford                       | Roof Truss  | 6.50 | DESIGN    |
| 26-01-2026 | 2601-0805-A  | Conestoga Dr Roof              | Roof Truss  | 2.00 | DESIGN    |
| 27-01-2026 | 2601-0805-A  | Conestoga Dr Roof              | Roof Truss  | 5.50 | DESIGN    |
| 28-01-2026 | 2601-0805-A  | Conestoga Dr Roof              | Roof Truss  | 8.50 | DESIGN    |
| 29-01-2026 | 2601-0805-A  | Conestoga Dr Roof              | Roof Truss  | 7.00 | DESIGN    |
| 30-01-2026 | 2601-0805-A  | Conestoga Dr Roof              | Roof Truss  | 9.50 | DESIGN    |

### ABB — Abby Bera | Invoice total: 98.50 hrs

| Date       | Job#         | Type        | Hrs   | Work Type |
|---|---|---|---|---|
| 19-01-2026 | 2601-0478    | Roof Truss  | 7.50  | DESIGN    |
| 19-01-2026 | 2601-0475-B  | OWW Floor 2 | 1.00  | DESIGN    |
| 21-01-2026 | 2601-0475-B  | OWW Floor 2 | 4.00  | DESIGN    |
| 21-01-2026 | 2601-0475-A  | OWW Floor 1 | 4.00  | DESIGN    |
| 21-01-2026 | 2601-0046-C  | Roof Truss  | 3.50  | DESIGN    |
| 22-01-2026 | 2601-0046-C  | Roof Truss  | 10.00 | DESIGN    |
| 23-01-2026 | 2601-0050-C  | Roof Truss  | 8.00  | DESIGN    |
| 26-01-2026 | 2601-0050-C  | Roof Truss  | 1.50  | DESIGN    |
| 26-01-2026 | 2601-0048    | Roof Truss  | 6.00  | DESIGN    |
| 26-01-2026 | 2601-0605    | Roof Truss  | 2.00  | DESIGN    |
| 27-01-2026 | 2601-0605    | Roof Truss  | 11.00 | DESIGN    |
| 28-01-2026 | 2601-0605    | Roof Truss  | 10.00 | DESIGN    |
| 29-01-2026 | 2601-0985    | Roof Truss  | 9.00  | DESIGN    |
| 29-01-2026 | 2601-0998    | OWW Floor 1 | 1.00  | DESIGN    |
| 30-01-2026 | 2601-0998    | OWW Floor 1 | 10.00 | DESIGN    |
| 31-01-2026 | 2601-0998    | OWW Floor 1 | 2.00  | DESIGN    |
| 31-01-2026 | 2601-0998    | Roof Truss  | 8.00  | DESIGN    |

### SYR — Sayan Roy | Invoice total: 92.50 hrs

| Date       | Job#          | Type        | Hrs  | Work Type |
|---|---|---|---|---|
| 16-01-2026 | 2503-4005-I   | Roof Truss  | 1.00 | DESIGN    |
| 16-01-2026 | 2503-4005-J   | Roof Truss  | 1.00 | DESIGN    |
| 19-01-2026 | 2503-4005-F   | Roof Truss  | 0.25 | DESIGN    |
| 19-01-2026 | 2503-4005-G   | Roof Truss  | 0.25 | DESIGN    |
| 19-01-2026 | 2503-4005-I   | Roof Truss  | 0.25 | DESIGN    |
| 19-01-2026 | 2503-4005-J   | Roof Truss  | 0.25 | DESIGN    |
| 19-01-2026 | 2601-0222-A   | OWW Floor 2 | 3.50 | DESIGN    |
| 19-01-2026 | 2601-0223-A   | Roof Truss  | 4.00 | DESIGN    |
| 20-01-2026 | 2601-0222-A   | OWW Floor 1 | 3.00 | DESIGN    |
| 20-01-2026 | 2601-0223-A   | Roof Truss  | 4.00 | DESIGN    |
| 20-01-2026 | 2601-0578-A   | OWW Floor 3 | 2.00 | DESIGN    |
| 21-01-2026 | 2601-0578-A   | OWW Floor 3 | 8.00 | DESIGN    |
| 22-01-2026 | 2601-0049-C   | Roof Truss  | 8.00 | DESIGN    |
| 23-01-2026 | 2601-0049-C   | Roof Truss  | 4.00 | DESIGN    |
| 24-01-2026 | 2601-0049-C   | Roof Truss  | 4.00 | DESIGN    |
| 26-01-2026 | 2601-0049-C   | Roof Truss  | 6.00 | DESIGN    |
| 26-01-2026 | 2601-0603-A   | OWW Floor 1 | 2.00 | DESIGN    |
| 27-01-2026 | 2601-0603-A   | OWW Floor 1 | 8.00 | DESIGN    |
| 28-01-2026 | 2601-0603-A   | OWW Floor 1 | 6.00 | DESIGN    |
| 28-01-2026 | 2506-0664-A   | Roof Truss  | 2.00 | DESIGN    |
| 29-01-2026 | 2506-0666-A   | Roof Truss  | 1.50 | DESIGN    |
| 29-01-2026 | 2506-0668-A   | Roof Truss  | 1.50 | DESIGN    |
| 29-01-2026 | 2601-0959-A   | Roof Truss  | 1.50 | DESIGN    |
| 29-01-2026 | 2601-0961-A   | Roof Truss  | 1.00 | DESIGN    |
| 29-01-2026 | M00098-A      | Roof Truss  | 2.00 | DESIGN    |
| 30-01-2026 | M00098-A      | Roof Truss  | 1.00 | DESIGN    |
| 30-01-2026 | 2501-0042-A   | Roof Truss  | 2.50 | DESIGN    |
| 30-01-2026 | 2501-0756-A   | Roof Truss  | 2.00 | DESIGN    |
| 30-01-2026 | 2412-1402-A   | Roof Truss  | 3.50 | DESIGN    |
| 31-01-2026 | 2601-1056-A   | OWW Floor 2 | 3.50 | DESIGN    |
| 31-01-2026 | 2601-0959-A   | Roof Truss  | 2.00 | DESIGN    |
| 31-01-2026 | 2506-0666-A   | Roof Truss  | 3.00 | DESIGN    |

---

## Section 2 — Hours Mismatch > 0.25 hrs

**N/A** — No SBS work logs in DB for this period.

---

## Section 3 — In FACT_WORK_LOGS NOT on Invoice

**None** — Zero SBS entries in DB for this period.

---

## Section 4 — Summary Totals

| Designer        | Code | Invoice Hrs | DB Hrs | Delta    | Status        |
|---|---|---|---|---|---|
| Sarty Gosh      | SGO  | 29.00       | 0.00   | -29.00   | ❌ MISSING    |
| Bharath Charles | BCH  | 60.00       | 0.00   | -60.00   | ❌ MISSING    |
| Raj Kumar       | RKU  | 58.50       | 0.00   | -58.50   | ❌ MISSING    |
| Sandy Das       | SDA  | 83.50       | 0.00   | -83.50   | ❌ MISSING    |
| Savvy Nath      | SVN  | 62.50       | 0.00   | -62.50   | ❌ MISSING    |
| Pabitra Ghosh   | PBG  | 30.00       | 0.00   | -30.00   | ❌ MISSING    |
| Sagar Banik     | BSG  | 64.25       | 0.00   | -64.25   | ❌ MISSING    |
| Abby Bera       | ABB  | 98.50       | 0.00   | -98.50   | ❌ MISSING    |
| Sayan Roy       | SYR  | 92.50       | 0.00   | -92.50   | ❌ MISSING    |
| **TOTAL**       |      | **578.75**  | **0**  | **-578.75** | **❌ ALL MISSING** |

**Invoice total: 578.75 hrs | DB: 0 hrs | Gap: 578.75 hrs across 183 line items**

---

## Normalize on Import

| Raw job# on invoice | Normalized job# | Reason |
|---|---|---|
| `2601-038`    | ⚠️ confirm `2601-0038` | Missing leading zero — verify against job register |
| `2601-0050-c` | `2601-0050-C`   | Lowercase suffix, uppercase C on all other entries |
| `2601 - 0418` | `2601-0418`     | Spaces in job number |
