# BLC Nexus — Migration / Reconciliation Progress
# One row per billing period. Update after every checkpoint.
# Report Status:  PENDING | IN_PROGRESS | COMPLETE | SKIPPED
# Import Status:  PENDING | IN_PROGRESS | COMPLETE | SKIPPED | BLOCKED (unknown actor codes)
# Created: 2026-05-08 | Import phase started: 2026-05-15

## Import Phase — File Map
# Each COMPLETE report maps to a .gs filler file in src/12-migration/
# SBS Jan 2026   → SbsReconFiller_Jan2026.gs   (BATCH-RECON-SBS-2601)
# SBS Feb 2026   → SbsReconFiller_Feb2026.gs   (BATCH-RECON-SBS-2602) — next session
# SBS Mar 2026   → SbsReconFiller_Mar2026.gs   (BATCH-RECON-SBS-2603) — future
# SBS Apr 2026   → SbsReconFiller_Apr2026.gs   (BATCH-RECON-SBS-2604) — future (actor blockers)
# Norspan+Titan  → MigrationReconFiller.gs      (BATCH-RECON-001)      — DONE (431 entries)
# Nelson/Matix/Alberta → TBD after actor codes resolved

| # | Client        | Period       | Label       | Report Status | Import Status | Report Path | Notes |
|---|---|---|---|---|---|---|---|
| 01 | SBS          | Jan 1–15     | 2026-01 1H  | COMPLETE | COMPLETE | reports/reconciliation/SBS_2026_01_1H_RECON.md | 107 entries, 293 hrs — SbsReconFiller_Jan2026.gs |
| 02 | SBS          | Jan 16–31    | 2026-01 2H  | COMPLETE | COMPLETE | reports/reconciliation/SBS_2026_01_2H_RECON.md | 181 entries, 578.75 hrs — SbsReconFiller_Jan2026.gs |
| 03 | SBS          | Feb 1–15     | 2026-02 1H  | COMPLETE | COMPLETE | reports/reconciliation/SBS_2026_02_1H_RECON.md | 258 entries, 760.5 hrs — SbsReconFiller_Feb2026.gs |
| 04 | SBS          | Feb 16–28    | 2026-02 2H  | COMPLETE | COMPLETE | reports/reconciliation/SBS_2026_02_2H_RECON.md | 230 entries, 668.75 hrs — SbsReconFiller_Feb2026.gs |
| 05 | SBS          | Mar 1–15     | 2026-03 1H  | COMPLETE | COMPLETE | reports/reconciliation/SBS_2026_03_1H_RECON.md | 381 entries, 642 hrs — SbsReconFiller_Mar2026.gs |
| 06 | SBS          | Mar 16–31    | 2026-03 2H  | COMPLETE | COMPLETE | reports/reconciliation/SBS_2026_03_2H_RECON.md | 393 entries, 571.75 hrs — SbsReconFiller_Mar2026.gs |
| 07 | SBS          | Apr 1–15     | 2026-04 1H  | COMPLETE | COMPLETE | reports/reconciliation/SBS_2026_04_1H_RECON.md | 344 entries, 739.75 hrs — SbsReconFiller_Apr2026.gs |
| 08 | SBS          | Apr 16–30    | 2026-04 2H  | COMPLETE | COMPLETE | reports/reconciliation/SBS_2026_04_2H_RECON.md | 362 entries, 821.25 hrs — SbsReconFiller_Apr2026.gs (SDA row count in report off by 1) |
| 09 | Norspan      | Jan 1–15     | 2026-01 1H  | COMPLETE | BLOCKED | reports/reconciliation/NORSPAN_2026_01_1H_RECON.md | ⚠️ RG-Ravi Gummadi unknown (32.5 hrs blocked) |
| 10 | Norspan      | Jan 16–31    | 2026-01 2H  | COMPLETE | BLOCKED | reports/reconciliation/NORSPAN_2026_01_2H_RECON.md | ⚠️ RG + VK unknown (78.65 hrs blocked) |
| 11 | Norspan      | Feb 1–15     | 2026-02 1H  | COMPLETE | BLOCKED | reports/reconciliation/NORSPAN_2026_02_1H_RECON.md | ⚠️ RG + VK unknown (64 hrs blocked) |
| 12 | Norspan      | Feb 16–28    | 2026-02 2H  | COMPLETE | BLOCKED | reports/reconciliation/NORSPAN_2026_02_2H_RECON.md | ⚠️ RG + VK unknown (59.75 hrs blocked) |
| 13 | Norspan      | Mar 1–15     | 2026-03 1H  | COMPLETE | BLOCKED | reports/reconciliation/NORSPAN_2026_03_1H_RECON.md | ⚠️ RG + VK unknown (70.5 hrs blocked) |
| 14 | Norspan      | Mar 16–31    | 2026-03 2H  | COMPLETE | BLOCKED | reports/reconciliation/NORSPAN_2026_03_2H_RECON.md | ⚠️ RG + VK unknown (90.5 hrs blocked) |
| 15 | Norspan      | Apr 1–15     | 2026-04 1H  | COMPLETE | BLOCKED | reports/reconciliation/NORSPAN_2026_04_1H_RECON.md | ⚠️ RG + VK unknown (30.25 hrs blocked) |
| 16 | Norspan      | Apr 16–30    | 2026-04 2H  | COMPLETE | BLOCKED | reports/reconciliation/NORSPAN_2026_04_2H_RECON.md | ⚠️ RG + VK unknown (64.5 hrs blocked) |
| 17 | Nelson Lumber | Jan 1–15    | 2026-01 1H  | SKIPPED  | SKIPPED | — | No invoice file |
| 18 | Nelson Lumber | Jan 16–31   | 2026-01 2H  | SKIPPED  | SKIPPED | — | No invoice file |
| 19 | Nelson Lumber | Feb 1–15    | 2026-02 1H  | SKIPPED  | SKIPPED | — | No invoice file |
| 20 | Nelson Lumber | Feb 16–28   | 2026-02 2H  | SKIPPED  | SKIPPED | — | No invoice file |
| 21 | Nelson Lumber | Mar 1–15    | 2026-03 1H  | SKIPPED  | SKIPPED | — | No invoice file |
| 22 | Nelson Lumber | Mar 16–31   | 2026-03 2H  | COMPLETE | BLOCKED | reports/reconciliation/NELSON_2026_03_2H_RECON.md | ⚠️ AR-Abhisekh Rit unknown (64 hrs blocked) |
| 23 | Nelson Lumber | Apr 1–15    | 2026-04 1H  | COMPLETE | BLOCKED | reports/reconciliation/NELSON_2026_04_1H_RECON.md | ⚠️ AR + DS unknown (60.5 hrs blocked) |
| 24 | Nelson Lumber | Apr 16–30   | 2026-04 2H  | COMPLETE | BLOCKED | reports/reconciliation/NELSON_2026_04_2H_RECON.md | ⚠️ AR + DS unknown (47 hrs blocked) |
| 25 | Matix SK     | Jan 1–15     | 2026-01 1H  | COMPLETE | BLOCKED | reports/reconciliation/MATIX_2026_01_1H_RECON.md | ⚠️ DG + DS unknown (113.5 hrs blocked) |
| 26 | Matix SK     | Jan 16–31    | 2026-01 2H  | COMPLETE | BLOCKED | reports/reconciliation/MATIX_2026_01_2H_RECON.md | ⚠️ DG + DS unknown (124 hrs blocked) |
| 27 | Matix SK     | Feb 1–15     | 2026-02 1H  | COMPLETE | BLOCKED | reports/reconciliation/MATIX_2026_02_1H_RECON.md | ⚠️ DG + DS unknown (111.75 hrs blocked) |
| 28 | Matix SK     | Feb 16–28    | 2026-02 2H  | COMPLETE | BLOCKED | reports/reconciliation/MATIX_2026_02_2H_RECON.md | ⚠️ DG + DS unknown (137.25 hrs blocked) |
| 29 | Matix SK     | Mar 1–15     | 2026-03 1H  | COMPLETE | BLOCKED | reports/reconciliation/MATIX_2026_03_1H_RECON.md | ⚠️ DG + DS unknown (119.75 hrs blocked) |
| 30 | Matix SK     | Mar 16–31    | 2026-03 2H  | COMPLETE | BLOCKED | reports/reconciliation/MATIX_2026_03_2H_RECON.md | ⚠️ DG + DS unknown (169.25 hrs blocked) |
| 31 | Matix SK     | Apr 1–15     | 2026-04 1H  | COMPLETE | BLOCKED | reports/reconciliation/MATIX_2026_04_1H_RECON.md | ⚠️ DG + DS unknown (183.75 hrs blocked) |
| 32 | Matix SK     | Apr 16–30    | 2026-04 2H  | COMPLETE | BLOCKED | reports/reconciliation/MATIX_2026_04_2H_RECON.md | ⚠️ DG + DS unknown (172 hrs blocked) |
| 33 | Titan        | Jan 1–15     | 2026-01 1H  | COMPLETE | BLOCKED | reports/reconciliation/TITAN_2026_01_1H_RECON.md | ⚠️ PS/PG/NM/DS unknown (42.5 hrs blocked) |
| 34 | Titan        | Jan 16–31    | 2026-01 2H  | COMPLETE | BLOCKED | reports/reconciliation/TITAN_2026_01_2H_RECON.md | ⚠️ PS/PG/NM unknown (100% blocked) |
| 35 | Titan        | Feb 1–15     | 2026-02 1H  | COMPLETE | BLOCKED | reports/reconciliation/TITAN_2026_02_1H_RECON.md | ⚠️ PS/PG/NM unknown (100% blocked) |
| 36 | Titan        | Feb 16–28    | 2026-02 2H  | COMPLETE | BLOCKED | reports/reconciliation/TITAN_2026_02_2H_RECON.md | ⚠️ PS/PG/NM/DS unknown (100% blocked) |
| 37 | Titan        | Mar 1–15     | 2026-03 1H  | COMPLETE | BLOCKED | reports/reconciliation/TITAN_2026_03_1H_RECON.md | ⚠️ PS/PG/NM unknown (100% blocked) |
| 38 | Titan        | Mar 16–31    | 2026-03 2H  | COMPLETE | BLOCKED | reports/reconciliation/TITAN_2026_03_2H_RECON.md | ⚠️ PS/PG/NM unknown (100% blocked) |
| 39 | Titan        | Apr 1–15     | 2026-04 1H  | COMPLETE | BLOCKED | reports/reconciliation/TITAN_2026_04_1H_RECON.md | ⚠️ PS/PG/NM unknown (100% blocked) |
| 40 | Titan        | Apr 16–30    | 2026-04 2H  | COMPLETE | BLOCKED | reports/reconciliation/TITAN_2026_04_2H_RECON.md | ⚠️ PS/PG unknown (100% blocked) |
| 41 | Alberta Truss | Jan 1–15    | 2026-01 1H  | SKIPPED  | SKIPPED | — | No invoice file |
| 42 | Alberta Truss | Jan 16–31   | 2026-01 2H  | SKIPPED  | SKIPPED | — | No invoice file |
| 43 | Alberta Truss | Feb 1–15    | 2026-02 1H  | SKIPPED  | SKIPPED | — | No invoice file |
| 44 | Alberta Truss | Feb 16–28   | 2026-02 2H  | SKIPPED  | SKIPPED | — | No invoice file |
| 45 | Alberta Truss | Mar 1–15    | 2026-03 1H  | SKIPPED  | SKIPPED | — | No invoice file |
| 46 | Alberta Truss | Mar 16–31   | 2026-03 2H  | COMPLETE | BLOCKED | reports/reconciliation/ALBERTA_2026_03_2H_RECON.md | ⚠️ PS unknown (11 hrs blocked) |
| 47 | Alberta Truss | Apr 1–15    | 2026-04 1H  | COMPLETE | BLOCKED | reports/reconciliation/ALBERTA_2026_04_1H_RECON.md | ⚠️ PS+DS unknown (21 hrs blocked) |
| 48 | Alberta Truss | Apr 16–30   | 2026-04 2H  | COMPLETE | BLOCKED | reports/reconciliation/ALBERTA_2026_04_2H_RECON.md | ⚠️ PS+DS unknown (36.75 hrs blocked) |
