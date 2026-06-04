# Migration Status — BLC Nexus (V2 → V3)

> **Durable state file.** Update this at session end instead of keeping migration state in chat.

---

## Overall Status
| Area | Status | Notes |
|---|---|---|
| EventReplayEngine | ✅ Complete | 51 jobs replayed, idempotency verified |
| Staff data migration | ✅ Complete | Bulk import via STG_STAFF_IMPORT |
| MART refresh | ✅ Complete | 4 MARTs, nightly trigger |
| Annual bonus backfill | ✅ Complete | 5 staff, Dec payroll |
| SBS Jan–Apr 2026 recon | ✅ Complete | 1561 entries — SbsReconFiller_Jan/Feb/Mar/Apr2026.gs |
| Norspan + Titan Jan–Apr 2026 recon | ✅ Complete | 431 entries — MigrationReconFiller.gs |
| Nelson Lumber Mar–Apr 2026 recon | ✅ Complete | 39 entries, 239.5 hrs — NelsonReconFiller_2026.gs |
| Matix SK Jan–Apr 2026 recon | ✅ Complete | 554 entries, 1205.25 hrs — MatixReconFiller_2026.gs |
| Alberta Truss Mar–Apr 2026 recon | ✅ Complete | 33 entries, 98 hrs — AlbertaTrussReconFiller_2026.gs |
| May 2026 timesheets (all clients) | ✅ Complete | 1997 FACT rows: 1081 (May 1–15) + 560 (May 16–31) + 356 no-date events — BATCH-002 (427 raw rows) confirmed in MIGRATION_RAW_IMPORT |
| Active job import (StaceyJobImporter) | ✅ Complete | 168 active jobs → 443 FACT_JOB_EVENTS (24 Mar + 82 Apr + 200 May + 137 Jun). VW_JOB_CURRENT_STATE: 51 IN_PROGRESS + 117 QC_REVIEW. 1 test job row still in VW — delete manually. |
| Stacey auto-sync (parallel running) | ✅ Running | runStaceySyncJob trigger installed — every 30 min. Syncs new/changed jobs from Stacey MASTER_JOB_DATABASE → FACT_JOB_EVENTS + VW. Run runRemoveStaceySyncTrigger() on June 16 BEFORE designer cutover. |

---

## Session Log
<!-- Append a line here at the end of each migration session -->
<!-- Format: YYYY-MM-DD | What was done | What's next | Dirty files? -->
2026-06-04 | Verified May 2026 already complete (1997 FACT rows, BATCH-002 done). Installed runMartRefresh trigger (4/4 triggers now live). Committed QuarterlyBonusEngine bonus letter/amendment runners. Pushed to PROD via clasp. | Next: CEO portal verification + send Q1 bonus letters (runSendQ1BonusLetters) | Clean
2026-06-04 | Built and ran StaceyJobImporter.gs. 168 active jobs imported → 443 FACT_JOB_EVENTS. VW_JOB_CURRENT_STATE written directly (EventReplayEngine bypass due to 6min timeout). Fixes: DAL write permissions, partition creation, designer alias (Bittuu), rebuildJobViewOnly. | Next: delete test job row from VW manually, verify portal, build JuneWorkLogImporter (BATCH-004) | Clean
2026-06-04 | Built JuneWorkLogImporter (BATCH-004). Built Stacey auto-sync — runStaceySyncJob trigger installed every 30min. Manual test: 14s, 168 jobs, 7 new events. Portal showing jobs correctly. | Next: managers verify portal ~June 4-15, import June 1-15 CSVs when received (~June 15) for data validation, runRemoveStaceySyncTrigger() + designer cutover June 16 | Clean
