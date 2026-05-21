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
# SBS Apr 2026   → SbsReconFiller_Apr2026.gs   (BATCH-RECON-SBS-2604) — DONE (706 entries)
# Norspan+Titan  → MigrationReconFiller.gs      (BATCH-RECON-001)      — DONE (431 entries)
# Nelson         → NelsonReconFiller_2026.gs    (BATCH-RECON-NELSON-2026) — DONE (39 entries, 239.5 hrs)
# Matix SK       → MatixReconFiller_2026.gs     (BATCH-RECON-MATIX-2026)  — DONE (554 entries, 1205.25 hrs)
# Alberta Truss  → AlbertaTrussReconFiller_2026.gs (BATCH-RECON-ALBERTA-2026) — DONE (33 entries, 98 hrs)

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
| 09 | Norspan      | Jan 1–15     | 2026-01 1H  | COMPLETE | COMPLETE | reports/reconciliation/NORSPAN_2026_01_1H_RECON.md | RG=RKG, VK=VKV resolved — MigrationReconFiller.gs |
| 10 | Norspan      | Jan 16–31    | 2026-01 2H  | COMPLETE | COMPLETE | reports/reconciliation/NORSPAN_2026_01_2H_RECON.md | RG=RKG, VK=VKV resolved — MigrationReconFiller.gs |
| 11 | Norspan      | Feb 1–15     | 2026-02 1H  | COMPLETE | COMPLETE | reports/reconciliation/NORSPAN_2026_02_1H_RECON.md | RG=RKG, VK=VKV resolved — MigrationReconFiller.gs |
| 12 | Norspan      | Feb 16–28    | 2026-02 2H  | COMPLETE | COMPLETE | reports/reconciliation/NORSPAN_2026_02_2H_RECON.md | RG=RKG, VK=VKV resolved — MigrationReconFiller.gs |
| 13 | Norspan      | Mar 1–15     | 2026-03 1H  | COMPLETE | COMPLETE | reports/reconciliation/NORSPAN_2026_03_1H_RECON.md | RG=RKG, VK=VKV resolved — MigrationReconFiller.gs |
| 14 | Norspan      | Mar 16–31    | 2026-03 2H  | COMPLETE | COMPLETE | reports/reconciliation/NORSPAN_2026_03_2H_RECON.md | RG=RKG, VK=VKV resolved — MigrationReconFiller.gs |
| 15 | Norspan      | Apr 1–15     | 2026-04 1H  | COMPLETE | COMPLETE | reports/reconciliation/NORSPAN_2026_04_1H_RECON.md | RG=RKG, VK=VKV resolved — MigrationReconFiller.gs |
| 16 | Norspan      | Apr 16–30    | 2026-04 2H  | COMPLETE | COMPLETE | reports/reconciliation/NORSPAN_2026_04_2H_RECON.md | RG=RKG, VK=VKV resolved — MigrationReconFiller.gs |
| 17 | Nelson Lumber | Jan 1–15    | 2026-01 1H  | SKIPPED  | SKIPPED | — | No invoice file |
| 18 | Nelson Lumber | Jan 16–31   | 2026-01 2H  | SKIPPED  | SKIPPED | — | No invoice file |
| 19 | Nelson Lumber | Feb 1–15    | 2026-02 1H  | SKIPPED  | SKIPPED | — | No invoice file |
| 20 | Nelson Lumber | Feb 16–28   | 2026-02 2H  | SKIPPED  | SKIPPED | — | No invoice file |
| 21 | Nelson Lumber | Mar 1–15    | 2026-03 1H  | SKIPPED  | SKIPPED | — | No invoice file |
| 22 | Nelson Lumber | Mar 16–31   | 2026-03 2H  | COMPLETE | COMPLETE | reports/reconciliation/NELSON_2026_03_2H_RECON.md | AR=AR001, DS=DBS, SG=SGO resolved — NelsonReconFiller_2026.gs |
| 23 | Nelson Lumber | Apr 1–15    | 2026-04 1H  | COMPLETE | COMPLETE | reports/reconciliation/NELSON_2026_04_1H_RECON.md | AR=AR001, DS=DBS, SG=SGO resolved — NelsonReconFiller_2026.gs |
| 24 | Nelson Lumber | Apr 16–30   | 2026-04 2H  | COMPLETE | COMPLETE | reports/reconciliation/NELSON_2026_04_2H_RECON.md | AR=AR001, DS=DBS, SG=SGO resolved — NelsonReconFiller_2026.gs |
| 25 | Matix SK     | Jan 1–15     | 2026-01 1H  | COMPLETE | COMPLETE | reports/reconciliation/MATIX_2026_01_1H_RECON.md | DG=DBG, DS=DBS, SG=SGO resolved — MatixReconFiller_2026.gs |
| 26 | Matix SK     | Jan 16–31    | 2026-01 2H  | COMPLETE | COMPLETE | reports/reconciliation/MATIX_2026_01_2H_RECON.md | DG=DBG, DS=DBS, SG=SGO resolved — MatixReconFiller_2026.gs |
| 27 | Matix SK     | Feb 1–15     | 2026-02 1H  | COMPLETE | COMPLETE | reports/reconciliation/MATIX_2026_02_1H_RECON.md | DG=DBG, DS=DBS, SG=SGO resolved — MatixReconFiller_2026.gs |
| 28 | Matix SK     | Feb 16–28    | 2026-02 2H  | COMPLETE | COMPLETE | reports/reconciliation/MATIX_2026_02_2H_RECON.md | DG=DBG, DS=DBS, SG=SGO resolved — MatixReconFiller_2026.gs |
| 29 | Matix SK     | Mar 1–15     | 2026-03 1H  | COMPLETE | COMPLETE | reports/reconciliation/MATIX_2026_03_1H_RECON.md | DG=DBG, DS=DBS, SG=SGO resolved — MatixReconFiller_2026.gs |
| 30 | Matix SK     | Mar 16–31    | 2026-03 2H  | COMPLETE | COMPLETE | reports/reconciliation/MATIX_2026_03_2H_RECON.md | DG=DBG, DS=DBS, SG=SGO resolved — MatixReconFiller_2026.gs |
| 31 | Matix SK     | Apr 1–15     | 2026-04 1H  | COMPLETE | COMPLETE | reports/reconciliation/MATIX_2026_04_1H_RECON.md | DG=DBG, DS=DBS, SG=SGO resolved — MatixReconFiller_2026.gs |
| 32 | Matix SK     | Apr 16–30    | 2026-04 2H  | COMPLETE | COMPLETE | reports/reconciliation/MATIX_2026_04_2H_RECON.md | DG=DBG, DS=DBS, SG=SGO resolved — MatixReconFiller_2026.gs |
| 33 | Titan        | Jan 1–15     | 2026-01 1H  | COMPLETE | COMPLETE | reports/reconciliation/TITAN_2026_01_1H_RECON.md | PS=PRS, PG=PBG, NM=NMM, DS=DBS resolved — MigrationReconFiller.gs |
| 34 | Titan        | Jan 16–31    | 2026-01 2H  | COMPLETE | COMPLETE | reports/reconciliation/TITAN_2026_01_2H_RECON.md | PS=PRS, PG=PBG, NM=NMM resolved — MigrationReconFiller.gs |
| 35 | Titan        | Feb 1–15     | 2026-02 1H  | COMPLETE | COMPLETE | reports/reconciliation/TITAN_2026_02_1H_RECON.md | PS=PRS, PG=PBG, NM=NMM resolved — MigrationReconFiller.gs |
| 36 | Titan        | Feb 16–28    | 2026-02 2H  | COMPLETE | COMPLETE | reports/reconciliation/TITAN_2026_02_2H_RECON.md | PS=PRS, PG=PBG, NM=NMM, DS=DBS resolved — MigrationReconFiller.gs |
| 37 | Titan        | Mar 1–15     | 2026-03 1H  | COMPLETE | COMPLETE | reports/reconciliation/TITAN_2026_03_1H_RECON.md | PS=PRS, PG=PBG, NM=NMM resolved — MigrationReconFiller.gs |
| 38 | Titan        | Mar 16–31    | 2026-03 2H  | COMPLETE | COMPLETE | reports/reconciliation/TITAN_2026_03_2H_RECON.md | PS=PRS, PG=PBG, NM=NMM resolved — MigrationReconFiller.gs |
| 39 | Titan        | Apr 1–15     | 2026-04 1H  | COMPLETE | COMPLETE | reports/reconciliation/TITAN_2026_04_1H_RECON.md | PS=PRS, PG=PBG, NM=NMM resolved — MigrationReconFiller.gs |
| 40 | Titan        | Apr 16–30    | 2026-04 2H  | COMPLETE | COMPLETE | reports/reconciliation/TITAN_2026_04_2H_RECON.md | PS=PRS, PG=PBG resolved — MigrationReconFiller.gs |
| 41 | Alberta Truss | Jan 1–15    | 2026-01 1H  | SKIPPED  | SKIPPED | — | No invoice file |
| 42 | Alberta Truss | Jan 16–31   | 2026-01 2H  | SKIPPED  | SKIPPED | — | No invoice file |
| 43 | Alberta Truss | Feb 1–15    | 2026-02 1H  | SKIPPED  | SKIPPED | — | No invoice file |
| 44 | Alberta Truss | Feb 16–28   | 2026-02 2H  | SKIPPED  | SKIPPED | — | No invoice file |
| 45 | Alberta Truss | Mar 1–15    | 2026-03 1H  | SKIPPED  | SKIPPED | — | No invoice file |
| 46 | Alberta Truss | Mar 16–31   | 2026-03 2H  | COMPLETE | COMPLETE | reports/reconciliation/ALBERTA_2026_03_2H_RECON.md | PS=PRS, DS=DBS, SG=SGO resolved — AlbertaTrussReconFiller_2026.gs |
| 47 | Alberta Truss | Apr 1–15    | 2026-04 1H  | COMPLETE | COMPLETE | reports/reconciliation/ALBERTA_2026_04_1H_RECON.md | PS=PRS, DS=DBS, SG=SGO resolved — AlbertaTrussReconFiller_2026.gs |
| 48 | Alberta Truss | Apr 16–30   | 2026-04 2H  | COMPLETE | COMPLETE | reports/reconciliation/ALBERTA_2026_04_2H_RECON.md | PS=PRS, DS=DBS, SG=SGO resolved — AlbertaTrussReconFiller_2026.gs |
