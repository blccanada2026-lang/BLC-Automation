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

---

## Session Log
<!-- Append a line here at the end of each migration session -->
<!-- Format: YYYY-MM-DD | What was done | What's next | Dirty files? -->
2026-06-04 | Verified May 2026 already complete (1997 FACT rows, BATCH-002 done). Installed runMartRefresh trigger (4/4 triggers now live). Committed QuarterlyBonusEngine bonus letter/amendment runners. Pushed to PROD via clasp. | Next: CEO portal verification + send Q1 bonus letters (runSendQ1BonusLetters) | Clean
