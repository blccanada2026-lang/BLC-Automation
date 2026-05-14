# BLC Nexus — Migration / Reconciliation Progress
# One row per billing period. Update after every checkpoint.
# Statuses: PENDING | IN_PROGRESS | COMPLETE | SKIPPED
# Created: 2026-05-08

| # | Client        | Period       | Label       | Status   | Report Path | Notes |
|---|---|---|---|---|---|---|
| 01 | SBS          | Jan 1–15     | 2026-01 1H  | COMPLETE | reports/reconciliation/SBS_2026_01_1H_RECON.md | ❌ ALL 293 hrs missing from DB |
| 02 | SBS          | Jan 16–31    | 2026-01 2H  | COMPLETE | reports/reconciliation/SBS_2026_01_2H_RECON.md | ❌ ALL 578.75 hrs missing from DB |
| 03 | SBS          | Feb 1–15     | 2026-02 1H  | COMPLETE | reports/reconciliation/SBS_2026_02_1H_RECON.md | ❌ ALL 760.5 hrs missing from DB |
| 04 | SBS          | Feb 16–28    | 2026-02 2H  | COMPLETE | reports/reconciliation/SBS_2026_02_2H_RECON.md | ❌ ALL 668.75 hrs missing from DB |
| 05 | SBS          | Mar 1–15     | 2026-03 1H  | COMPLETE | reports/reconciliation/SBS_2026_03_1H_RECON.md | ❌ ALL 642 hrs missing from DB |
| 06 | SBS          | Mar 16–31    | 2026-03 2H  | COMPLETE | reports/reconciliation/SBS_2026_03_2H_RECON.md | ❌ ALL 571.75 hrs missing from DB — ⚠️ NEW: JS-Joy Sarkar (actor code unknown) |
| 07 | SBS          | Apr 1–15     | 2026-04 1H  | COMPLETE | reports/reconciliation/SBS_2026_04_1H_RECON.md | ❌ ALL 739.75 hrs missing from DB — ⚠️ NEW: DG-Debby Ghosh, BT-Bittu Dalui (actor codes unknown); JS-Joy Sarkar also unknown (114 hrs blocked) |
| 08 | SBS          | Apr 16–30    | 2026-04 2H  | COMPLETE | reports/reconciliation/SBS_2026_04_2H_RECON.md | ❌ ALL 821.25 hrs missing from DB — ⚠️ JS/BT/DG actor codes unknown (199.5 hrs blocked); BT has bundled job numbers |
| 09 | Norspan      | Jan 1–15     | 2026-01 1H  | COMPLETE | reports/reconciliation/NORSPAN_2026_01_1H_RECON.md | ❌ ALL 71.5 hrs missing from DB — ⚠️ RG-Ravi Gummadi actor code unknown (32.5 hrs blocked) |
| 10 | Norspan      | Jan 16–31    | 2026-01 2H  | COMPLETE | reports/reconciliation/NORSPAN_2026_01_2H_RECON.md | ❌ ALL 94.65 hrs missing from DB — ⚠️ RG + VK actor codes unknown (78.65 hrs blocked); VK new designer |
| 11 | Norspan      | Feb 1–15     | 2026-02 1H  | COMPLETE | reports/reconciliation/NORSPAN_2026_02_1H_RECON.md | ❌ ALL 71.5 hrs missing from DB — ⚠️ RG + VK actor codes unknown (64 hrs blocked) |
| 12 | Norspan      | Feb 16–28    | 2026-02 2H  | COMPLETE | reports/reconciliation/NORSPAN_2026_02_2H_RECON.md | ❌ ALL 72.5 hrs missing from DB — ⚠️ RG + VK actor codes unknown (59.75 hrs blocked) |
| 13 | Norspan      | Mar 1–15     | 2026-03 1H  | COMPLETE | reports/reconciliation/NORSPAN_2026_03_1H_RECON.md | ❌ ALL 81.75 hrs missing from DB — ⚠️ RG + VK actor codes unknown (70.5 hrs blocked); SGO confirmed |
| 14 | Norspan      | Mar 16–31    | 2026-03 2H  | COMPLETE | reports/reconciliation/NORSPAN_2026_03_2H_RECON.md | ❌ ALL 111.75 hrs missing from DB — ⚠️ RG + VK actor codes unknown (90.5 hrs blocked); SGO confirmed |
| 15 | Norspan      | Apr 1–15     | 2026-04 1H  | COMPLETE | reports/reconciliation/NORSPAN_2026_04_1H_RECON.md | ❌ ALL 36.25 hrs missing from DB — ⚠️ RG + VK actor codes unknown (30.25 hrs blocked); SGO listed, 0 hrs |
| 16 | Norspan      | Apr 16–30    | 2026-04 2H  | COMPLETE | reports/reconciliation/NORSPAN_2026_04_2H_RECON.md | ❌ ALL 76.25 hrs missing from DB — ⚠️ RG + VK actor codes unknown (64.5 hrs blocked); Q250411 carry-over; Q260241 A/B/C variants |
| 17 | Nelson Lumber | Jan 1–15    | 2026-01 1H  | SKIPPED  | — | No invoice file |
| 18 | Nelson Lumber | Jan 16–31   | 2026-01 2H  | SKIPPED  | — | No invoice file |
| 19 | Nelson Lumber | Feb 1–15    | 2026-02 1H  | SKIPPED  | — | No invoice file |
| 20 | Nelson Lumber | Feb 16–28   | 2026-02 2H  | SKIPPED  | — | No invoice file |
| 21 | Nelson Lumber | Mar 1–15    | 2026-03 1H  | SKIPPED  | — | No invoice file |
| 22 | Nelson Lumber | Mar 16–31   | 2026-03 2H  | COMPLETE | reports/reconciliation/NELSON_2026_03_2H_RECON.md | ❌ ALL 77.5 hrs missing from DB — ⚠️ NEW: AR-Abhisekh Rit (64 hrs blocked, actor code unknown); DS-Deb Sen new (0 hrs); AR dates typo'd as 2020 on invoice, corrected to 2026 |
| 23 | Nelson Lumber | Apr 1–15    | 2026-04 1H  | COMPLETE | reports/reconciliation/NELSON_2026_04_1H_RECON.md | ❌ ALL 94 hrs missing from DB — ⚠️ AR + DS actor codes unknown (60.5 hrs blocked); AR date typo 2028→2026; extended job number variants |
| 24 | Nelson Lumber | Apr 16–30   | 2026-04 2H  | COMPLETE | reports/reconciliation/NELSON_2026_04_2H_RECON.md | ❌ ALL 68 hrs missing from DB — ⚠️ AR + DS actor codes unknown (47 hrs blocked) |
| 25 | Matix SK     | Jan 1–15     | 2026-01 1H  | COMPLETE | reports/reconciliation/MATIX_2026_01_1H_RECON.md | ❌ ALL 118 hrs missing from DB — ⚠️ DG + DS actor codes unknown (113.5 hrs blocked); multi-component rows per job |
| 26 | Matix SK     | Jan 16–31    | 2026-01 2H  | COMPLETE | reports/reconciliation/MATIX_2026_01_2H_RECON.md | ❌ ALL 127.5 hrs missing from DB — ⚠️ DG + DS actor codes unknown (124 hrs blocked); I JOIST Floor 3 variant; 160608_Rev job number |
| 27 | Matix SK     | Feb 1–15     | 2026-02 1H  | COMPLETE | reports/reconciliation/MATIX_2026_02_1H_RECON.md | ❌ ALL 117 hrs missing from DB — ⚠️ DG + DS actor codes unknown (111.75 hrs blocked) |
| 28 | Matix SK     | Feb 16–28    | 2026-02 2H  | COMPLETE | reports/reconciliation/MATIX_2026_02_2H_RECON.md | ❌ ALL 142.75 hrs missing from DB — ⚠️ DG + DS actor codes unknown (137.25 hrs blocked); 160669_MAIN/GARAGE suffix variants |
| 29 | Matix SK     | Mar 1–15     | 2026-03 1H  | COMPLETE | reports/reconciliation/MATIX_2026_03_1H_RECON.md | ❌ ALL 138 hrs missing from DB — ⚠️ DG + DS actor codes unknown (119.75 hrs blocked); D4: DG 160706 dual Floor 1 rows Mar 2 |
| 30 | Matix SK     | Mar 16–31    | 2026-03 2H  | COMPLETE | reports/reconciliation/MATIX_2026_03_2H_RECON.md | ❌ ALL 181.75 hrs missing from DB — ⚠️ DG + DS actor codes unknown (169.25 hrs blocked); 160760_GARAGE suffix; PDF job# "E" artifact |
| 31 | Matix SK     | Apr 1–15     | 2026-04 1H  | COMPLETE | reports/reconciliation/MATIX_2026_04_1H_RECON.md | ❌ ALL 197 hrs missing from DB — ⚠️ DG + DS actor codes unknown (183.75 hrs blocked); DG summary truncated 100→100.5; 160798A/B variants |
| 32 | Matix SK     | Apr 16–30    | 2026-04 2H  | COMPLETE | reports/reconciliation/MATIX_2026_04_2H_RECON.md | ❌ ALL 183.25 hrs missing from DB — ⚠️ DG + DS actor codes unknown (172 hrs blocked); 160862/863/864 _GARAGE suffix variants; A/B job splits |
| 33 | Titan        | Jan 1–15     | 2026-01 1H  | COMPLETE | reports/reconciliation/TITAN_2026_01_1H_RECON.md | ❌ ALL 46.5 hrs missing from DB — ⚠️ NEW: PS/PG/NM actor codes unknown; DS unknown (42.5 hrs blocked); SGO 4 hrs DESIGNER (LVL FRAMING) |
| 34 | Titan        | Jan 16–31    | 2026-01 2H  | COMPLETE | reports/reconciliation/TITAN_2026_01_2H_RECON.md | ❌ ALL 16.25 hrs missing from DB — ⚠️ PS/PG/NM actor codes unknown (16.25 hrs blocked, 100%); SG+DS 0 hrs |
| 35 | Titan        | Feb 1–15     | 2026-02 1H  | COMPLETE | reports/reconciliation/TITAN_2026_02_1H_RECON.md | ❌ ALL 17.5 hrs missing from DB — ⚠️ PS/PG/NM unknown (100% blocked); Design-Production desc → DESIGNER; B4xxx job series |
| 36 | Titan        | Feb 16–28    | 2026-02 2H  | COMPLETE | reports/reconciliation/TITAN_2026_02_2H_RECON.md | ❌ ALL 52.75 hrs missing from DB — ⚠️ PS/PG/NM/DS unknown (100% blocked); date typo 27-03→27-02; Design-Order + Roof Truss Revision new types |
| 37 | Titan        | Mar 1–15     | 2026-03 1H  | COMPLETE | reports/reconciliation/TITAN_2026_03_1H_RECON.md | ❌ ALL 20 hrs missing from DB — ⚠️ PS/PG/NM unknown (100% blocked) |
| 38 | Titan        | Mar 16–31    | 2026-03 2H  | COMPLETE | reports/reconciliation/TITAN_2026_03_2H_RECON.md | ❌ ALL 26.5 hrs missing from DB — ⚠️ PS/PG/NM unknown (100% blocked); P-157 new P-prefix job series |
| 39 | Titan        | Apr 1–15     | 2026-04 1H  | COMPLETE | reports/reconciliation/TITAN_2026_04_1H_RECON.md | ❌ ALL 21.5 hrs missing from DB — ⚠️ PS/PG/NM unknown (100% blocked); B600050 rev suffix; D4 double rows |
| 40 | Titan        | Apr 16–30    | 2026-04 2H  | COMPLETE | reports/reconciliation/TITAN_2026_04_2H_RECON.md | ❌ ALL 14 hrs missing from DB — ⚠️ PS/PG unknown (100% blocked); date typo 2026-05-22→04-22; P-169 |
| 41 | Alberta Truss | Jan 1–15    | 2026-01 1H  | SKIPPED  | — | No invoice file |
| 42 | Alberta Truss | Jan 16–31   | 2026-01 2H  | SKIPPED  | — | No invoice file |
| 43 | Alberta Truss | Feb 1–15    | 2026-02 1H  | SKIPPED  | — | No invoice file |
| 44 | Alberta Truss | Feb 16–28   | 2026-02 2H  | SKIPPED  | — | No invoice file |
| 45 | Alberta Truss | Mar 1–15    | 2026-03 1H  | SKIPPED  | — | No invoice file |
| 46 | Alberta Truss | Mar 16–31   | 2026-03 2H  | COMPLETE | reports/reconciliation/ALBERTA_2026_03_2H_RECON.md | ❌ ALL 20.75 hrs missing from DB — ⚠️ NEW: PS unknown (11 hrs blocked); DS unknown doing QC; SGO 4.5 hrs DESIGNER; 261114-02 hyphen suffix |
| 47 | Alberta Truss | Apr 1–15    | 2026-04 1H  | COMPLETE | reports/reconciliation/ALBERTA_2026_04_1H_RECON.md | ❌ ALL 23.5 hrs missing from DB — ⚠️ PS+DS unknown (21 hrs blocked); SGO 2.5 hrs DESIGNER; job 161580 unusual 16xxxx series |
| 48 | Alberta Truss | Apr 16–30   | 2026-04 2H  | COMPLETE | reports/reconciliation/ALBERTA_2026_04_2H_RECON.md | ❌ ALL 53.75 hrs missing from DB — ⚠️ PS+DS unknown (36.75 hrs blocked); SGO 17 hrs DESIGNER; DS mixed DESIGNER+QC rows; D4 double QC rows |
