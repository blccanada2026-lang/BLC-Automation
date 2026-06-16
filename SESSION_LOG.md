# Session Log — BLC Nexus

> Rolling log of session activity. Newest entry at the top.
> Keep each entry under 40 lines. Full project state lives in PROJECT_MEMORY.md.

---

## 2026-06-15 Session (PROD Launch + BATCH-004 June Timesheet Migration)

### Work Completed

**PROD Portal Launch — complete ✅**
- Fixed `runAuditPortalLinkRoster()` to silently skip departed staff (BSG/SKR/SMB/SUB/SUB2/RUD/PRG/AVM) — was incorrectly blocking SAFE TO SEND.
- Redeployed web app with "Anyone" access (prior deploy was "Anyone with Google account" — blocked Sarthak).
- Ran `runSetPortalBaseUrlProd()` with new `/exec` URL, `runSendAllPortalLinks()` — 17/17 staff confirmed delivered.
- Health monitor trigger installed. go-live-fixes branch merged + pushed to main.

**BATCH-004 June 1–15 Timesheet Migration — fully reconciled ✅**
- Imported Stacey's June timesheets (619 raw rows → 595 WORK_LOG_MIGRATED events in FACT_WORK_LOGS|2026-06).
- Fixed date parsing bug: raw_json stored "Mon Jun 01" (mangled Date.toString()) → replayed to wrong partition (2001-06). Patched normalized table, cleaned wrong-partition rows, re-replayed.
- Applied actor code corrections: BTD→BIT (33 amendments), SNA→SVN (59 amendments).
- Identified and corrected idempotency gaps (multiple source rows per job+date, only first captured):
  - DBG: +34.25h across 9 job+date entries
  - PBG: +5h (job 2505-7978, Jun 5)
  - RKU: +0.75h (job 2605-6941-D, Jun 12)
  - SGO: +1h (jobs 160997 + 161005, Jun 11)
- Final reconciliation: **1278.25h source = 1278.25h FACT. ✅ FULLY RECONCILED. All 16 actors balanced.**

### Files Changed (all committed and pushed)
- `src/12-migration/JuneWorkLogImporter.gs` — date fix, BTD/BIT + SNA/SVN corrections, full reconciliation + drill-down suite, DBG/PBG/RKU/SGO hour correction functions, duplicate-DBG undo.
- `src/01-dal/DAL.gs` — added JuneWorkLogImporter to FACT_WORK_LOGS WRITE_PERMISSIONS.
- `src/02-security/PortalAuth.gs` — departed-staff fix for roster audit.
- `src/07-portal/Portal.gs` — `runSetPortalBaseUrlProd()` helper.

### Key Commits
- `ee4400c` feat(migration): BATCH-004 June 1-15 timesheet import + corrections
- `9ceb954` feat(migration): reconciliation + per-actor drill-down
- `ad5410d` fix: drill-down date mismatch + runFixDBGHours
- `ad0e37a` fix: reconciliation BTD/SNA mapping + remaining-actor drill-down
- `2dd022d` feat: runFixPBGHours/RKUHours/SGOHours
- `250e3b6` fix: runUndoDuplicateDBGFix (idempotency failure recovery)

### Tests Run
- `runJuneReconciliation()`: ✅ FULLY RECONCILED (1278.25h both sides, 16/16 actors)

### Unresolved Before Next Session
1. **Stacey sync trigger** — run `runRemoveStaceySyncTrigger()` in `src/12-migration/StaceyJobImporter.gs` BEFORE June 16 cutover
2. **Q1 bonus** — `runQ1ApplyManualCorrections()` and `runSendQ1BonusLetters()` still pending

### Next Recommended Step
1. June 16 morning: `runRemoveStaceySyncTrigger()` → send cutover email to all designers
2. Complete Q1 bonus: run corrections + send letters

---

## 2026-06-11 Session (Q1 Bonus Audit — full session)

### Work Completed
**Stacey sync alert:** `runStaceySyncJob()` now emails CEO on failure via MailApp (commits `fc6736c`).

**Q1 bonus audit — root cause found:** FACT_WORK_LOGS has duplicate rows across all 3 months.
- Jan: 483 rows, 74 excess (15%). Feb: 745 rows, 151 excess (20%). Mar: 3189 rows, 1469 excess (46%).
- All rows have `work_date` populated → duplicates are real (not a false-positive in dedup logic).
- Root cause: March CSV imported twice; Jan/Feb have partial over-imports. Plus extra rows with wrong period_id for some designers (cross-period import).
- Inflated system total: 6,367.6 Q1 design hours → Corrected (deduplicated): 5,717.35 hours.

**Manual cross-check:** HR provided manual Stacey V2 hours for 16 designers (shared 2026-06-11).
- Hardcoded as `Q1_MANUAL_HRS_` in QuarterlyBonusEngine.gs.
- System inflated hours × composite = what was in ledger: ₹89,783 total.
- Correct bonus (manual hrs × composite): ₹72,231. Net correction: -₹17,551.
- RKU (Raj Kumar) is the one UNDERPAID: +₹3,739 — because his 299 QC hours were filtered by the engine. Manual counts all hours.
- **Bonus has NOT been paid yet** — correcting ledger before letters go out.

**Rating check:** `runQ1RatingScoreCheck()` — 16 designers CALCULATED with ratings included.
- 8 designers PENDING (all zeros): AVM, BSG, PRG, RUD, SKR, SMB, SUB, SUB2.
- BSG is INACTIVE (₹0 in ledger, no action). Other 7: unknown eligibility — user to confirm.
- BIT appears as CALCULATED (same composite as JYS/Joy Sarkar 52.19%) — possibly Bittuu alias. User to confirm if same person or different.
- Client score = 0% for all designers — correct, Q1 client feedback not collected.

**Correction functions built and deployed (commit `80202c7`):**
- `runQ1ManualCorrectionReport()` — full comparison table: hours + bonus + delta per designer.
- `runQ1ApplyManualCorrections()` — writes `QUARTERLY_BONUS_AMENDMENT` rows. Uses manual hours. Fills in client_score = avg team rating (proxy for missing Q1 client feedback). Full composite = avg_rating×30% + error×40% + own_rating×30%.
- `runQ1RatingScoreCheck()` — per-designer client/error/rating/composite breakdown.
- `runSendBonusLetters()` enhanced — letter now shows individual rater breakdown (Team Lead, PM, CEO) per designer, plus client score note "(Q1 proxy: avg team rating)".
- Multiple diagnostic functions: `runQ1CorrectedHours`, `runQ1BonusOverpaymentReport`, `runQ1DupeSummaryByPartition`, `runQ1DupeInspector`, `runQ1ManualCorrectionReport`.

### Files Changed (all committed and pushed to `80202c7`)
- `src/10-payroll/QuarterlyBonusEngine.gs` — 444 lines added (diagnostics + correction functions + letter enhancement)
- `src/12-migration/StaceyJobImporter.gs` — sync failure email alert
- `AUDIT_PLAN_JUNE16.md` — pre-cutover audit plan (5 phases)

### Tests Run
- None — all changes are diagnostic/payroll functions, no handler logic changed.

### Unresolved Before Next Session
1. **BIT designer**: CALCULATED with composite 52.19% (same as JYS). Is BIT = Bittuu alias = JYS? Or separate person? If separate, needs to be in `Q1_MANUAL_HRS_`.
2. **7 PENDING designers**: AVM, PRG, RUD, SKR, SMB, SUB, SUB2 — are they Q1-eligible? If not, mark SKIPPED. If yes, collect ratings.
3. **Test data purge**: designer@blc.com (54 jobs), BTD, SNA still in VW_JOB_CURRENT_STATE.

### Next Recommended Step
1. **Confirm BIT and 7 PENDING designers** eligibility
2. **Run `runQ1ApplyManualCorrections()`** — writes 16 amendment rows with corrected hours + client proxy
3. **Run `runSendQ1BonusLetters()`** — 16 letters land in your inbox for review before forwarding
4. **June 16 (5 days away)**: Run `runRemoveStaceySyncTrigger()` BEFORE sending cutover email to designers
5. Send Q2 rating requests + Q2 client feedback requests via portal

---

## 2026-06-11 Session

### Work Completed
- CEO jobs table: redesigned from flat list → client-grouped collapsible view (CEO only). Groups sorted by job count desc; each group shows state chips (IN PROGRESS ×N, QC REVIEW ×N, etc.). Click to expand/collapse individual job rows.
- QC Backlog dashboard panel: same grouped-by-client treatment. Each client group shows job count + red "max Nd" warning if any job waiting ≥3 days.
- Both changes are `canRunPayroll`-gated — non-CEO roles continue to see flat list.
- Prior session (2026-06-09, committed): CEO Daily Briefing module (`CEODailyBriefing.gs`) — daily email at 8 AM CST Mon–Sat. Covers job pipeline, QC backlog, hours not logged, billing, system health.
- Prior session: fixed CEO briefing data quality — filtered `designer@blc.com`, BTD, SNA from "hours not logged" via active roster check; filtered email-format entries from QC backlog.
- Prior session: Ratings panel "Change" button to view historical quarters (e.g. Q1 from portal in Q2).

### Files Changed
- `src/07-portal/PortalView.html` — grouped jobs view (`renderJobsGrouped_`) + grouped QC backlog. **Uncommitted.**
- `src/09-notifications/CEODailyBriefing.gs` — new module. Committed in `94a7647`, `ab6933f`.
- `src/07-portal/Portal.gs` — `portal_sendCEOBriefing()` added. Committed.

### Tests Run
- None this session (UI/portal changes — no handler logic changed).
- Last full test run: 50/50 passing (2026-06-09), commit `eefe849`.

### Issues Found
- Ratings "Change" button: code pushed, but user did not confirm visible in portal. May need fresh deployment.
- QC backlog count (~128) still inflated by test jobs with real person_codes. Filter removes email-format entries but not test jobs with proper codes. Needs data purge — tracked in PROJECT_MEMORY.md §8.
- `designer@blc.com` (54 jobs), BTD, SNA — legacy test data in VW_JOB_CURRENT_STATE. Filtered in briefing email but still visible in portal jobs list.

### Next Recommended Step
1. **Commit** `src/07-portal/PortalView.html` (grouped views — current dirty file).
2. `clasp push --force` → deploy new version in Apps Script editor.
3. Verify "Change" button appears in Ratings panel, and grouped views work on mobile.
4. **Send Q2 rating requests** via portal (Send Rating Requests → `2026-Q2`).
5. **Send Q2 feedback requests** to clients via portal.
6. **June 16 action:** `runRemoveStaceySyncTrigger()` BEFORE designer cutover email.

---

## 2026-06-09 Session

### Work Completed
- All 10 V3 handler test suites green: 50/50 (suites 1–5 verified, 4m 36s).
- CEO Daily Briefing built: `CEODailyBriefing.gs` (T9 notifications tier), daily trigger, portal button.
- Fixed CEO email typo: `raj@bluelotuscanada.ca` → `raj.nair@bluelotuscanada.ca`.
- Fixed briefing data quality (active roster filter, email-format QC filter).
- Added Ratings panel "Change" button + `loadRatingsStatus(overridePid)` parameter.
- Fixed stale portal URL in Script Properties via `fixPortalUrl()`.

### Files Changed
- `src/09-notifications/CEODailyBriefing.gs` (new)
- `src/07-portal/Portal.gs` (`portal_sendCEOBriefing`)
- `src/07-portal/PortalView.html` (briefing button, ratings Change button)

### Tests Run
- `runV3Tests_1to3()` and `runV3Tests_4to5()`: 50/50 green.

### Issues Found
- clasp sometimes reports "Skipping push" — use `clasp push --force`.
- Portal `/exec` URL must match Script Property `PORTAL_BASE_URL`; run `fixPortalUrl()` after new deployment.
- Consumer Apps Script quota: 6-min limit requires split test runners.

### Next Recommended Step
- CEO jobs grouped view (carried into 2026-06-11 session).

---

## 2026-06-04 Session

### Work Completed
- StaceyJobImporter.gs: 168 active jobs → 443 FACT_JOB_EVENTS. VW written directly (EventReplay too slow).
- JuneWorkLogImporter.gs (BATCH-004) built.
- Stacey auto-sync installed: `runStaceySyncJob` trigger every 30 min.
- May 2026 migration verified complete (1997 rows, BATCH-002 done).
- runMartRefresh trigger installed (4/4 triggers live).
- Q1 bonus letters committed.

### Files Changed
- `migration/StaceyJobImporter.gs`, `migration/JuneWorkLogImporter.gs`, `migration/StaceyAutoSync.gs`
- `src/10-payroll/QuarterlyBonusEngine.gs`

### Tests Run
- Manual: StaceyAutoSync 14s, 168 jobs, 7 new events.

### Issues Found
- 1 test job row in VW — needs manual delete.
- Designer alias "Bittuu" needed mapping.

### Next Recommended Step
- Managers verify portal ~June 4–15. Import June 1–15 CSVs when received. **Remove sync trigger June 16 before cutover.**
