# Session Log — BLC Nexus

> Rolling log of session activity. Newest entry at the top.
> Keep each entry under 40 lines. Full project state lives in PROJECT_MEMORY.md.

---

## 2026-08-10 → 2026-08-11 Session (Wave 2 task W2-3 — findings-picker implemented, subagent-driven, 4 tasks)

### Work Completed
- Implemented W2-3 (QC findings-picker) end-to-end on branch `qc-findings-picker` via subagent-driven development, 4 tasks, each independently reviewed. Commits `fb0728b..efd548c`.
- **Task 1**: new `portal_getQcFindingTypes` read endpoint (`Portal.gs`) — first-ever reader of `DIM_QC_FINDING_TYPES`. Reviewed clean after 1 fix round (removed a debug/manual-check helper that shipped by accident — write-before-RBAC, no `Config.isDev()` guard, testing-policy.md §3 violation).
- **Task 2**: `QCHandler.gs` validation (rejects MINOR_REWORK/MAJOR_REWORK without `finding_codes`) + `FACT_QC_FINDINGS` write, 5 new tests, suite 12 registered in `TestHarness.gs`. Reviewed clean (0 Critical, 0 Important, 5 Minor deferred — below). Implementer itself caught and fixed a real pre-existing-test regression (3 fixtures needed `finding_codes` added) before review started.
- **Task 3**: frontend picker UI on `#modal-qc-review` (`PortalView.html`). Reviewed clean after 1 fix round (added a missing scroll cap on the checklist, mirroring the existing `#sop-items-list` pattern).

### Files Changed
- `src/07-portal/Portal.gs`, `src/07-portal/PortalView.html`, `src/06-handlers/QCHandler.gs`, `src/setup/QCHandlerTest.gs`, `src/setup/TestHarness.gs`, `src/01-dal/DAL.gs` (1-line)

### Tests Run
- **Not literally executed** — this environment has no live Google Apps Script editor. `runQCFindingsPickerTests`/`runQCHandlerTests`/`runQCHandlerFlowTests` were verified by manual code trace only, by both each task's implementer and its independent task reviewer. This is real, accumulated evidence but is NOT the same as "ran green in DEV." Live GAS execution is still outstanding.
- Jest: not touched by this work (GAS-only change surface).

### Issues Found (deferred Minor findings — carried forward, not silently dropped)
- Task 2 (4 of 5 deferred minors — the review summary counted 5, only 4 were individually itemized in the ledger; not re-derived here): (1) no de-dup of `finding_codes` before write — dupes create duplicate append-only `FACT_QC_FINDINGS` rows; (2) 2 tests read `FACT_QC_FINDINGS` for a partition not guaranteed to exist standalone post-rollover, mitigated by setup-time partition creation; (3) inconsistent `DIM_QC_FINDING_TYPES` seeding convention between suite 9 (seeds once at runner, individual tests now silently depend on it) and suite 12 (seeds per-test) — breaks the direct-function-picker workflow testing-policy.md anticipates; (4) the duplicate-replay test doesn't actually re-exercise the findings write path (job already in a different state by replay time, hits a different pre-existing guard) — disclosed coverage gap, not a false pass.
- Task 3 (2): (1) missing a flex wrapper div around each checkbox row's label (cosmetic, matches the plan's own literal spec — not implementer drift); (2) a product with zero applicable `DIM_QC_FINDING_TYPES` rows would show an empty picker and permanently block rework submission with no in-UI escape — currently unreachable (16/17 codes apply to all products today), backlog item for future data-entry mistakes.
- **Deployment-sequencing constraint (not a code defect — a deploy-checklist item):** Task 2's backend and Task 3's frontend are not independently deployable. Backend unconditionally rejects rework submissions without `finding_codes`; only the Task 3 UI supplies that field. **Must ship to PROD together, same push**, or every live QC rework submission breaks the moment the backend alone lands.

### Next Recommended Step
- Run the live GAS test suites (`runQCFindingsPickerTests`, `runQCHandlerTests`, `runQCHandlerFlowTests`, or the full `runV3HandlerTests()`) in DEV via the Apps Script editor — first real execution, not just trace-verification.
- Get explicit user approval before `npm run push:prod` (branch is not yet merged to main either — that's also a user decision).
- Per R4.7: since `PortalView.html` and `Portal.gs` both changed, a New Version redeploy in the Apps Script editor is required after any PROD push — not yet applicable since no PROD push has happened.

---

## 2026-08-10 Session Part 4 (Wave 2 task W2-1 — pilot rollout plan)

### Work Completed
- User confirmed the three inputs W2-1 was blocked on: pilot client `NORSPAN-MB`, mode `WARN_ONLY`, start week of 2026-08-17 (next Monday from session date 2026-08-10).
- Traced `SopGate.gs` to confirm rollout mechanics: activation is Script-Properties-only (`SOP_ENABLED='true'`, `SOP_MODE='WARN_ONLY'`, `SOP_PILOT_CLIENTS='NORSPAN-MB'`), no code change needed — flags are already read live by `evaluate_()`.
- Surfaced a pre-flight gap while tracing: `SopGate.evaluate_()` silently no-ops with `reason: 'NO_TEMPLATE'` if no ACTIVE/PUBLISHED template exists in `DIM_SOP_TEMPLATES` for `NORSPAN-MB` × its product code(s). This can't be verified from code — needs a live-sheet check (or `SopDAL.findActiveTemplateForJob('NORSPAN-MB', <productCode>)` run in the Apps Script editor). Without this check, flipping the flags could look like a live pilot while producing zero actual signal. Flagged as a must-resolve item before 2026-08-17.
- Recorded the confirmed decision in `PROJECT_MEMORY.md` §12 and the full rollout detail in `CTO_TASK_QUEUE.md` W2-1.

### Files Changed
- `CTO_TASK_QUEUE.md`, `PROJECT_MEMORY.md` (docs only — no code touched)

### Next Recommended Step
- Verify a NORSPAN-MB SOP template exists and is ACTIVE before 2026-08-17. If missing, building/publishing one via `SopAdminEngine` becomes a prerequisite task ahead of flipping `SOP_ENABLED`. W2-3 (findings-picker UI) still not started.

---

## 2026-08-10 Session Part 3 (Wave 2 task W2-2 — QC finding taxonomy trace)

### Work Completed
- Traced `QcFindingTypes.gs` (`src/13-sop/`) per Wave 2 task W2-2. It's a self-contained 17-code QC finding taxonomy (structural/process/documentation categories, severity/kpi_weight/structural-risk metadata) that idempotently seeds `DIM_QC_FINDING_TYPES`. Confirmed via grep across `src/`: no code anywhere reads that table — it's pure unwired reference data, not dormant functionality.
- Confirmed the live QC review flow (`src/06-handlers/QCHandler.gs` + `#modal-qc-review` in `PortalView.html:1105-1129`) only captures coarse `qc_result` (APPROVED/MINOR_REWORK/MAJOR_REWORK/CLIENT_SENT) plus free-text `rework_notes`/`notes` — no structured finding-code selection exists in any form.
- Answer to W2-2's open question: unlike the SOP checklist gate itself (§3.8 point 2, already built and just needs activating), the findings-picker reviewer UI genuinely does not exist and needs building. Scoped as new task **W2-3** in `CTO_TASK_QUEUE.md`: multi-select finding picker on the QC review modal, new `portal_getQcFindingTypes()` read endpoint (first-ever reader of `DIM_QC_FINDING_TYPES`), and `QCHandler.gs` changes to store selected finding code(s) on the QC event.

### Files Changed
- `CTO_TASK_QUEUE.md`, `PROJECT_MEMORY.md` (docs only — read-only investigation, no code touched)

### Next Recommended Step
- W2-1 (pilot rollout plan) still blocked on user input: pilot client(s), WARN_ONLY vs BLOCK, timeline. W2-3 (findings-picker UI) can be designed/sequenced in parallel — likely bundles with W2-1 since both touch `#modal-qc-review`.

---

## 2026-08-10 Session Part 2 (State-doc cleanup for lean fresh-session context)

### Work Completed
- User asked to cap fresh-session context at 100K tokens before moving to Wave 2. `CTO_TASK_QUEUE.md` had grown to ~1390 lines (~21K tokens) of mostly closed-thread narrative already duplicated in `PROJECT_MEMORY.md`/this file — trimmed to ~100 lines (~2.6K tokens): standing practices, Session State, CTO Wave Backlog, and one consolidated "Other Still-Open Items" list (also absorbed several genuinely-open items that only lived in `PROJECT_MEMORY.md` §7 before, e.g. 19 orphaned job_numbers, admin overhead policy, `submitted_at` bug). Nothing lost — full pre-trim detail recoverable via `git log -p CTO_TASK_QUEUE.md`.
- Found and fixed real staleness while doing this: `PROJECT_MEMORY.md` §0/§6/§7 still listed the NORSPAN investigation as the #1 unresolved priority despite it closing 2026-08-07, and §0 listed a resolved job + passed June deadlines as "time-critical." Both sections now point to `CTO_TASK_QUEUE.md` as the single pending-work source instead of an independently-drifting duplicate.
- `CLAUDE_START_HERE.md` never listed `CTO_TASK_QUEUE.md` in its reading order at all — a fresh session following it literally would never have read the active-workstreams file. Fixed. Also removed a stale June 16 cutover reminder.
- Total fresh-session reading order (`CLAUDE_START_HERE.md`→`PROJECT_MEMORY.md`→`SESSION_LOG.md`→`CTO_TASK_QUEUE.md`): **~29.5K tokens**, comfortably under the 100K target.

### Files Changed
- `CTO_TASK_QUEUE.md`, `PROJECT_MEMORY.md`, `CLAUDE_START_HERE.md` (docs only, no code)

### Next Recommended Step
- Move to Wave 2 (SOP/QC pilot launch design, task W2-1) — session context can be cleared now, next session will pick this up correctly via the trimmed docs.

---

## 2026-08-09 → 2026-08-10 Session (Wave 0 performance instrumentation shipped)

### Work Completed
- **Both Critical Questions from the 2026-08-07 CTO assessment answered**: `SOP_ENABLED` confirmed off everywhere (Wave 2 SOP/QC is a clean pilot launch, not reviving something stalled); PROD Apps Script ID rotation explicitly deferred by the user, saved as a durable cross-session memory note (`project_prod_appsscript_id_rotation_deferred.md`) so it isn't lost — remind again once the current implementation wave is fully done, don't action without being asked.
- **Full Wave 0–5 CTO backlog written into `CTO_TASK_QUEUE.md`** as real EPIC/TASK entries with priorities (P0–P4), per the master prompt's task-management format. User chose to do Wave 0 then Wave 2 next, skipping Wave 1 (`12-migration` cleanup) for now.
- **Wave 0 task W0-2 shipped** (PR #20, deployed PROD `0014b58`): instrumented the 4 highest-traffic portal reads (`portal_getViewData`, `portal_getLeaderDashboard`, `portal_getMyHours`, `portal_getCEODashboard`) by reusing the already-existing `HealthMonitor.startExecution()`/`endExecution()` pattern (already used by `QueueProcessor`/`BillingEngine`/`PayrollEngine`) — no new infrastructure built, zero behavior change to the wrapped functions. New `PerfBaselineReport.gs` (read-only) queries the resulting `_SYS_LOGS` rows and reports count/min/avg/p95/max `duration_ms` per module. Verified end-to-end in DEV (real numbers: 1.2s–2.9s range on DEV's small dataset) before PROD deploy. 507/507 Jest passing throughout (no new tests — matches established precedent that thin `portal_*` wrappers are DEV/live-verified, not unit tested).
- **Unplanned finding, surfaced by building the report**: pre-existing `QueueProcessor` instrumentation (unrelated to this PR) shows a `max=231994ms` (232s) outlier against a healthy `p95≈8.8s` across 2,906+ calls — close to Apps Script's 6-minute execution ceiling. Flagged as a new backlog item, not yet investigated.

### Files Changed
- `src/07-portal/Portal.gs` (4 functions wrapped)
- `src/09-monitoring/PerfBaselineReport.gs` (new)

### Tests Run
- Jest: 507/507 passing

### Issues Found
- QueueProcessor's 232-second outlier (see above) — worth investigating once Wave 0's own baseline has more data.

### Next Recommended Step
- Confirm the PROD New Version redeploy is done (required — this touched `Portal.gs`), then let real PROD usage accumulate for a day or two before reading `runPerfBaselineReport()` there. After that, move to Wave 2 (SOP/QC pilot launch design) per the user's chosen sequencing.

---

## 2026-08-07 Session Part 2 (CTO architecture/performance/tech-debt assessment; trigger audit + fixes)

### Work Completed
- **Full CTO-level architecture assessment** (read-only, no code changes) delivered per the user's "master program prompt" — covered current architecture map, production function audit, trigger audit, performance/instrumentation assessment, QC/SOP gap analysis, Learning Hub/Growth Platform gap analysis, system boundaries, execution waves. Key findings, evidence-based (not guessed):
  - `src/12-migration/` is 71 of 160 total `.gs` files (44%) — overwhelmingly one-off incident diagnostics/fixers/importers already served their purpose. Single biggest, cheapest technical-debt cleanup opportunity. Proposed as Wave 1, not yet executed.
  - `src/13-sop/` (3,725 lines, 11 files) is a **mature, already-built** QC/SOP checklist gate system — template engine, admin engine, importer, audit engine, full portal UI — feature-flagged off by default (`SOP_ENABLED`/`SOP_MODE`/`SOP_PILOT_CLIENTS`). Workstream A from the user's prompt is "finish and activate," not "build." Current activation state in PROD still unconfirmed — open question.
  - **Zero performance instrumentation exists anywhere** — `PerformanceMonitor.gs` measures business health (stuck jobs, error rates), not latency/query-cost/page-load. "Portal feels slow" currently has no supporting telemetry. Recommended 3 minimal additive instrumentation points (entry-point timing, DAL read row-count+elapsed-ms, execution duration) as Wave 0.
  - Learning Hub and Growth Platform confirmed 100% absent by direct search — genuinely greenfield, correctly sequenced after QC/SOP produces real error-classification data.
- **Trigger audit, real findings, acted on:**
  - Ran `runListTriggers()` (already existed, `setup/Triggers.gs`) — 10 triggers actually live in PROD.
  - **Stacey sync trigger confirmed NOT installed** — resolves the one risk flagged in the assessment; matches `PROJECT_MEMORY.md`'s claim it was removed at cutover. No incident.
  - **SBS intake form trigger (`onIntakeFormSubmit`/`INTAKE_FORM_ID`) also not installed** — initially proposed reinstalling it, but investigation showed current SBS intake is entirely portal-button-triggered (`portal_processSbsIntake` → `SheetAdapter.gs` → `STG_INTAKE_SBS`), no form involved at all. This trigger is legacy/pre-refactor, likely predates or violates R1 (No Google Forms). **Correctly did NOT reinstall it** — flagged as a Wave 1 dead-code candidate instead.
  - **CEO daily briefing trigger (`runCEODailyBriefing`) was NOT installed**, despite `PROJECT_MEMORY.md` describing it as a live daily feature — real doc-vs-reality gap. User confirmed they want it automatic. Reinstalled via the already-existing `runInstallCEOBriefingTrigger()` (idempotent, no new code) — **confirmed installed, fires daily ~8 AM CST Mon–Sat.**

### Files Changed
- None — this entire session part was read-only investigation plus running two pre-existing Apps Script functions (`runListTriggers`, `runInstallCEOBriefingTrigger`). No commits, no deploys.

### Tests Run
- N/A — no code changed.

### Issues Found
- See assessment above. Two items from the assessment's "Critical Questions" remain genuinely open (not yet answered by user): (1) PROD Apps Script ID rotation status (flagged security-urgent 2026-06-22, still unverified); (2) current `SOP_ENABLED`/pilot-client state in PROD.

### Next Recommended Step
- Get answers to the two open critical questions above, then persist the confirmed Wave 0–5 backlog structure into `CTO_TASK_QUEUE.md`/`backlog.md` (deliberately not written yet — user hasn't signed off on the wave sequencing itself, only individually actioned the trigger findings so far).

---

## 2026-08-07 Session (Pending-work audit; NORSPAN duplicate-client investigation closed)

### Work Completed
- **Pending-development-task audit** — surveyed `PROJECT_MEMORY.md`, `CTO_TASK_QUEUE.md`, `.claude/context/backlog.md`, `.claude/context/open-items.md` for a full pending-work list. Found and fixed two stale entries before reporting: `backlog.md`'s auto-onboarding-link item was already fully shipped (PR #17) but never marked done — split into a completed entry + a residual "extend to bulk import" pending item; `open-items.md`'s "review migration/ directory" item was already resolved (committed `6ed2703`, prior session) but never checked off.
- **NORSPAN duplicate-client-entries investigation, RESOLVED** — user asked to investigate Sarty's 2026-07-08 report (plain "NORSPAN" ~55 jobs vs "NORSPAN-MB" ~4 jobs both visible), with a specific hypothesis that some apparent duplicates might be legitimate roof/floor splits sharing one job_number with different product_codes (same pattern as §3.6). Built `NorspanClientCodeCheck.gs` (read-only, PR #19, deployed PROD `afb9502`) rather than trust a 2026-07-09 fix note at face value (different job count, unclear whether jobs were voided or corrected). Real result: bare `NORSPAN` has 88 jobs, **all voided, zero active today**; `NORSPAN-MB` has 112 active jobs, zero voided; zero overlap between codes; zero in-code duplicates. Already fully cleaned up by the 2026-07-09 fix — nothing left to do. The roof/floor hypothesis was checked directly and did not reproduce for this specific report. User confirmed no billing/data-loss concern (regenerated timesheet matched Sarty's manually-sent ones) — this also closes the pending "Sarty manual cross-check" item from the day before.

### Files Changed
- `src/12-migration/NorspanClientCodeCheck.gs` (new, read-only, no writes)
- `.claude/context/backlog.md`, `.claude/context/open-items.md` (staleness fixes)

### Tests Run
- Jest: 507/507 passing (no new tests — read-only diagnostic, same precedent as `JobDuplicateTimingCheck.gs`)

### Issues Found
- None outstanding.

### Next Recommended Step
- Still open from 2026-08-06: first supervised HR_ACCOUNTING/ADMIN click on Run Billing (now reachable for the first time), and a CEO smoke-test of Generate Timesheet with one real client/range.

---

## 2026-08-06 Session Part 2 (ADMIN granted TIMESHEET_GENERATE; automatic staff-onboarding email shipped)

### Work Completed
- **Live-tested the timesheet feature** — user found Aarthi (real onboarded `ADMIN`, not `HR_ACCOUNTING`) couldn't see Generate Timesheet. Confirmed via RBAC.gs read: correct behavior per matrix, not a bug — `ADMIN` was never granted `TIMESHEET_GENERATE`. User's explicit decision: extend it to `ADMIN`, matching `BILLING_RUN`'s existing scope (PR #16, merged/deployed `12d57cc`). Two gates needed updating since `portal_generateTimesheetPdf` calls both: the `PERMISSION_MATRIX` flag and a new narrow `ADMIN_FINANCIAL_ACTIONS_` allowlist in `enforceFinancialAccess()`/`hasFinancialAccess()` (mirrors the existing `HR_ACCOUNTING_FINANCIAL_ACTIONS_` pattern — kept the defense-in-depth second gate rather than removing it). 496/496 Jest passing (5 new). No ADMIN actor exists in DEV to verify with — user explicitly accepted Jest-only + live PROD check, confirmed working after New Version redeploy.
- **New feature: automatic staff-onboarding email** (PR #17, merged/deployed `17ef362`). User asked for a way to send new hires their portal access + instructions automatically. Found: portal link-sending already existed (`PortalAuth.sendAllLinks`/`requestLink`) but only as a bulk blast with no instructions; a role-specific instructional mailer already existed (`OnboardingMailer.gs`, T12) but only for DESIGNER/TEAM_LEAD/PM, editor-only, not portal-triggered, and using the generic shared URL not a real personal link. New `StaffOnboardingMailer.gs` (T8) combines both: one email per new hire with role-appropriate instructions + their actual personal tokenized link (`PortalAuth.buildPersonalLink`, new export of `buildLink_`), wired into `StaffOnboarding.onboardStaff()`'s `isNew` branch, best-effort (never blocks the roster write). Reuses `OnboardingMailer.gs`'s existing DESIGNER/TEAM_LEAD/PM bodies; new generic fallback for ADMIN/HR_ACCOUNTING/CEO/QC. Deliberately NOT wired into bulk import. 507/507 Jest passing (11 new + fixed 2 pre-existing tests broken by the new dependency). User chose Jest-only verification (no DEV dry-run) given low blast radius.
- **One-off** (PR #18, merged/deployed `84fb2c5`): sent Aarthi her real onboarding email manually (`runSendOnboardingEmailToARN()`), since she was onboarded before the automatic trigger existed. **Confirmed 2026-08-07: Aarthi received it.** Thread fully closed.

### Files Changed
- `src/02-security/RBAC.gs` (ADMIN_FINANCIAL_ACTIONS_)
- `src/02-security/PortalAuth.gs` (buildPersonalLink export)
- `src/08-staff/StaffOnboarding.gs`, `StaffOnboardingMailer.gs` (new)

### Tests Run
- Jest: 507/507 passing across both PRs

### Issues Found
- None outstanding. The "Aarthi is ADMIN not HR_ACCOUNTING" mismatch was the actual root cause of both the RBAC gap and the button-visibility confusion — now resolved at the source (RBAC matrix), not worked around.

### Next Recommended Step
- User still wants to spot-check the regenerated timesheet PDFs against manually-sent historical ones (Sarty is doing this manually, in progress as of session end).

---

## 2026-08-06 Session (Timesheet-for-any-period feature shipped; Run Billing's isLeader trap fixed)

### Work Completed
- **Timesheet-for-any-period feature** (PR #15, merged/deployed to PROD `4c07df5`): CEO/HR_ACCOUNTING-only "Generate Timesheet" button — arbitrary date range, any client or all active clients, same polished PDF output as the existing fixed-period timesheets. New `GenerateTimesheetPdf.gs` bridges the already-shipped `generateTimesheet()` (Phase B1 Item 4) with `ClientTimesheetEngine.gs`'s HTML/PDF pipeline. `RBAC.gs`'s `TIMESHEET_GENERATE` was already correctly CEO/SYSTEM/HR_ACCOUNTING-only — no matrix change needed.
- **Advisor review before DEV push caught 3 real gaps, all fixed**: (1) button was nested inside the `isLeader`-gated leader-dashboard, unreachable for HR_ACCOUNTING — moved to the main toolbar; (2) added a RULE P1 quota guard to the all-clients generation loop (`HealthMonitor.isApproachingLimit()` checked every iteration, since each client does real Drive PDF-conversion work); (3) generated PDFs now explicitly shared with the requesting user (`exportHtmlAsPdf_`'s new optional `viewerEmail` param) — portal calls resolve identity from a token, not `Session`, so without this a returned Drive link could 404 for whoever generated it.
- **Same-root-cause bonus fix**: `Run Billing` (PR #11) had the identical `isLeader` trap — HR_ACCOUNTING/ADMIN were granted `BILLING_RUN` weeks ago but could never see the button. Fixed in this same PR (moved to main toolbar). No RBAC change — `canRunBilling` was already correct, only its container was unreachable for 2 of its 3 granted roles.
- **DEV verification finding**: DEV has no live (non-migrated) `FACT_WORK_LOGS` data at all — everything before June 2026 is excluded by the standard `isMigratedWorkLog()` exclusion, and nothing has been logged in DEV since. Built `runGenerateTimesheetPdfMechanismProof()` — seeds one synthetic non-migrated TEST-CLIENT entry, generates a real PDF, verifies it, cleans up — to prove the real Drive pipeline works without depending on real DEV data. Ran clean: 5/5, real PDF + real Drive URL.

### Files Changed
- `src/07-portal/Portal.gs`, `PortalData.gs`, `PortalView.html`
- `src/11-reporting/ClientTimesheetEngine.gs`, `GenerateTimesheetPdf.gs` (new)
- `src/12-migration/GenerateTimesheetPdfDevRehearsal.gs` (new)
- `src/01-dal/DAL.gs` (WRITE_PERMISSIONS: registered `GenerateTimesheetPdfDevRehearsal`)

### Tests Run
- Jest: 491/491 passing (9 new tests: happy path, empty-range null, cross-month range, active-client loop, P1 truncation, viewerEmail sharing)
- DEV mechanism proof against real Drive: 5/5 passing

### Issues Found
- None outstanding on the mechanism itself. Two things remain genuinely unverifiable anywhere except PROD (DEV structurally lacks the data/actors): HR_ACCOUNTING's live button/click flow, and business-content correctness against a real historical manually-sent timesheet.

### Next Recommended Step
- Post-deploy: CEO smoke-test Generate Timesheet in PROD with one real client/small range before wider rollout. Before HR_ACCOUNTING/ADMIN use Run Billing for the first time ever (now reachable), do that first click supervised, not unattended. For the manual-timesheet comparison, start with one known real period/client, not a bulk run.

---

## 2026-08-05 → 2026-08-06 Session (RBAC audit + billing-access fix; Sarty duplicate-job incident diagnosed, fixed, and prevented)

### Work Completed
- **RBAC audit** (PR #11, merged/deployed): full `PERMISSION_MATRIX` table produced across all 9 roles. Found and fixed 2 real gaps — `getLeaderDashboard()`'s hardcoded `role==='CEO'` check (now `RBAC.hasPermission`), and "Run Billing" wired to `canRunPayroll` instead of its own flag. **User correction applied:** billing access is CEO/ADMIN/HR_ACCOUNTING-only — PM must NOT see it. Fixed the actual `BILLING_RUN` matrix values (PM→false, ADMIN→true, HR_ACCOUNTING→true), not just the wiring.
- **Sarty's duplicate job (BLC-00891/BLC-00892):** root-caused — `JobCreateHandler`'s idempotency keys on `queue_id` alone, so two genuinely separate submissions (confirmed 16.4s apart via `JobDuplicateTimingCheck.gs`) both go through. Data fixed via one-off `Job00891DuplicateFixer.gs`, run successfully in PROD by the user (`{"status":"FIXED"}`), after the user manually confirmed BLC-00891 was the phantom via the spreadsheet.
- **Prevention fix shipped** (PR #14, merged, deployed to PROD `c19b945`, New Version redeployed): 60-second content-duplicate guard (client + product + description + submitter) added on top of the existing idempotency check. **Designer-aware per explicit user correction** — some clients (e.g. Matix) legitimately reuse the same `client_job_ref` across two different designers (roof vs. floor), so the guard also compares intended designer (via a new `_intended_designer` hint `portal_createJob()` attaches to the raw payload, invisible to validated state) and does NOT block a same-ref/different-designer split. Frontend submit button now disables and waits for the real server response instead of closing the modal immediately.

### Files Changed
- `src/02-security/RBAC.gs`, `src/07-portal/PortalData.gs`, `src/07-portal/PortalView.html` (PR #11)
- `src/12-migration/JobDuplicateTimingCheck.gs`, `src/12-migration/Job00891DuplicateFixer.gs` (PRs #12/#13)
- `src/06-handlers/JobCreateHandler.gs`, `src/07-portal/Portal.gs`, `src/07-portal/PortalView.html`, `src/12-migration/JobCreateRecentDuplicateDevRehearsal.gs` (PR #14)

### Tests Run
- Jest: 482/482 passing (6 new cases directly covering the designer-split scenario)
- DEV rehearsal (`runJobCreateRecentDuplicateDevRehearsal()`) against real Sheets: 8/8 passed — same-designer resubmission blocked, different-designer resubmission of the same ref succeeds, exactly 2 VW rows created not 3

### Issues Found
- None outstanding on this thread — both the RBAC gap and the duplicate-job class of bug are closed end-to-end (data fix + root-cause prevention + PROD deploy + New Version redeploy confirmed by user).

### Next Recommended Step
- Resume the paused timesheet-for-any-period feature (CEO/HR-admin only, polished-PDF output direction already chosen by user) — deferred mid-session for the urgent RBAC/duplicate-job work, not yet resumed.

---

## 2026-08-04 → 2026-08-05 Session (Aug 2026 partition incident — diagnosed, fixed, root-caused)

### Work Completed
- **Live PROD incident:** `FACT_WORK_LOGS|2026-08`/`FACT_QC_EVENTS|2026-08` created with blank headers (`ensurePartition()`'s non-atomic gap) — every designer/QC submission since 2026-08-01 failed and dead-lettered (31 items, nothing lost — full payloads in `DEAD_LETTER_QUEUE`).
- Header repair shipped first, separately from the replay (PR #7) — stopped new submissions failing without waiting on the more complex fix.
- 31-item replay shipped after adding a scope filter (61 dead-letter items existed total; only 31 audited for this incident, the rest a separate unrelated population) and a WORK_LOG double-count safety net (PR #8). Real PROD replay: 21/21 WORK_LOG recovered (59.75h, exact match to original count), 6/10 QC_SUBMIT recovered, 4 safely rejected by the pre-identified duplicate-routing guard.
- **Root cause fixed** (PR #9, `fix/ensurepartition-header-gap`): `DAL.appendRow()`/`appendRows()` now self-heal a blank partition header against canonical `SCHEMAS` before writing; new partitions now write from canonical `SCHEMAS` directly instead of copying a possibly-stale sibling tab. Full writeup: `PROJECT_MEMORY.md` §3.5.

### Files Changed
- `src/01-dal/DAL.gs` (root cause fix, PR #9)
- `src/12-migration/Aug2026PartitionRecovery.gs` (new — header repair/replay tool, PRs #7/#8)
- `src/12-migration/DalPartitionSelfHealDevRehearsal.gs` (new — DEV rehearsal, PR #9)
- Full incident tooling + DEV rehearsals also live on `incident/aug2026-partition-recovery` (own worktree)

### Tests Run
- Jest: 448/448 passing (10 new tests directly against real `DAL.gs`)
- DEV: real Apps Script runs for every stage — header repair, replay mechanism, and the root-cause self-heal all proven against real Sheets, not just mocks (this incident's own root cause was exactly the kind of bug Jest mocks can't reproduce)

### Issues Found
- Discovery pulled in 61 dead-letter items, not 31 — the other 30 are an unrelated population (legacy job formats, some already `INVOICED`), correctly excluded, not investigated further.
- One dead-letter item (`QITM-C0476432AD82`, job `BLC-99999`) is likely residue from the already-documented 2026-07-08 NORSPAN test-contamination incident — flagged, not chased.

### Next Recommended Step
- **PR #9 awaiting user review before merge/deploy to PROD** (as of session end — touches `DAL.gs`, a foundational file, so held for explicit sign-off unlike the two incident hotfixes).
- Separately, still open: `FACT_PAYROLL_LEDGER|2020-03` in DEV has the same root-cause bug, root-caused but never repaired (blocks Phase B2 Item 2's own proof script).

---

## 2026-06-30 → 2026-07-08 Sprint (Billing Hardening — job fixes, CI, timesheets, work log corrections, orphan cleanup)

> Multi-day rollup entry — see git log for individual commits. Exceeds the usual 40-line
> guideline deliberately: PROJECT_MEMORY.md and this file had drifted several sessions
> behind actual work (e.g. still listed the client timesheet generator as "not built"
> after it had shipped). This entry catches both files up in one pass.

### Work Completed

**Job 260337 duplicate — RESOLVED in PROD** (carried over from 2026-06-29 entry, confirmed stable).

**CI pipeline live:** `.github/workflows/test.yml` — push to `main` → `npm install` → `npm test` (Node 20). Green since first run.

**Job creation dedup guard:** `JobCreateHandler` blocks duplicate `job_number` creation (`3eef807`); `VwJobDedupAudit.gs` added to scan VW for duplicate job_numbers.

**Client timesheet generator — shipped:** HTML-to-PDF generation (replaces Sheets export) for all clients, per-designer hours summary, product-based job type with fallback job ref, negative-correction-hours netting, client-facing "Job Ref / Job #" column rename, `DIM_CLIENT_MASTER.address` fix. (`70703de`, `dd78007`, `b82f65b`, `9b665e0`, `fa410ab`, `63ec063`, `fa20216`, `13f987c`)

**Full work log dedup audit:** duplicate-key scanner for 2026-06 partition (`a1a8d8c`) found 6 duplicate entries (5 Category 1 pre-billing dupes + 1 ABB); voided via `WorkLogDedupFixer` (`0cefd5b` + follow-up write-permission/appendRows fixes).

**Sarty ground-truth reconciliation (June 06B):** `SartyReconAudit.gs` / `SartyConfirmation.gs` built and run — identified client mis-attribution (BCH, DBS billed under wrong client) and missing hours (PBG, DBG, AR001). MATIX client_code alias corrected; CTO-confirmed nickname overrides applied. (`19db02a`, `bf3deec`, `c75b650`, `dca63cf`, `c2f4afa`)

**Work log submission hardening:** content-based duplicate guard + 16h daily cap (ADR-WL-002), closed-job guard (ADR-WL-003), portal UI (disable-on-submit button, confirm dialog, show existing entries for the date). (`7e624ed`, `a4c6934`, `5f7e4a0`, `bfd987b`)

**Work log correction system shipped:** amend / void / reassign handlers in `WorkLogCorrectionHandler.gs` with RBAC hierarchy (DESIGNER/QC_REVIEWER → TEAM_LEAD → PM/CEO/ADMIN), period-close guard (payroll-calculated OR job-closed, PM/CEO/ADMIN override), portal UI with Edit/Void/Reassign buttons + search/filter on My Hours, chained-edit protection (disables actions on already-corrected rows), migrated-entry support. (`6cc5c2c`, `4850848`, `da7ef25`, `5c5e026`, `adf70a6`, `0268dd8`)

**V2 backfill state corrections:** 7 jobs backfilled into VW_JOB_CURRENT_STATE, then state-corrected after audit found 5 needed a reset. (`41ce5ab`, `44a205d`, `e3803a2`, `b620f2c`, `5a59c07`, `b4bc47e`)

**product_code required at job creation** (ADR-JOB-002) — post-validation guard with actionable error message, not a schema change.

**Staff `display_name` column added to DIM_STAFF_ROSTER** for ops reconciliation (`f796eaa`).

**Malformed period_id normalized** across 9,873 FACT_WORK_LOGS rows (`3a2c7bc`, plus blank-period_id-from-partition handling `813f509` and per-partition dry-run breakdown `9ed2094`).

**R3 RBAC compliance fix:** `WorkLogHandler` — `RBAC.enforcePermission()` moved to the unconditional first statement (`a663337`).

**Job_number normalization guard + retroactive orphan cleanup (ADR-WL-001):** `WorkLogHandler` now normalizes job_number before the VW check and FACT_WORK_LOGS write. Full orphan audit (`WorkLogOrphanAudit.gs`) found **1,448 total orphans**: 1,382 pre-cutover (expected — migration imported raw hours without job-lifecycle events for jobs already closed before cutover) and 66 post-cutover (unexpected). Of the 66: 46 resolved via normalization + `OrphanJobNumberFixer.gs` net-zero void/re-submit (99.75 hours moved, net zero to actor totals), 19 remain genuinely orphaned (need a manual VW decision), 1 is admin overhead (`"job assign & help"`, intentionally skipped). `OrphanJobNumberFixer` registered in `DAL.gs` `FACT_WORK_LOGS` `WRITE_PERMISSIONS`.

**Dead letter queue investigated:** 1 real blocked job (NORSPAN — Sarty notified, see Sarty's new email re: NORSPAN below), 14 historical QC_SUBMIT failures — all pre-existing and resolved by `MigratedQCApprovalFixer` (no new action needed).

**Portal redeploy requirement added to R4/R5 checklists** — `clasp push` alone doesn't update the live `/exec` webapp version; New Version redeploy required after any `PortalView.html`/`Portal.gs` change.

**Code graph rebuilt:** 139 files, 1,957 nodes, 21,904 edges (code-review-graph MCP index).

### Known Issue — Not Yet Fixed
- **`submitted_at`/`created_at` bug in `writeQueueItem`** — identified, not yet fixed. Needs a follow-up session.

### Files Changed
Too many individual files across ~9 days to list exhaustively — see `git log --oneline` for the full commit range (`19db02a` through `3475845`). Key new files: `src/12-migration/WorkLogOrphanAudit.gs`, `src/12-migration/OrphanJobNumberFixer.gs`, `src/06-handlers/WorkLogCorrectionHandler.gs`, `src/11-reporting/ClientTimesheetEngine.gs`, `.github/workflows/test.yml`. Docs: `docs/SOP_DECISIONS.md` (ADR-WL-001/002/003, ADR-JOB-002), `PROJECT_MEMORY.md`.

### Next Steps
1. **New Sarty-reported issue (2026-07-08, not yet investigated):** duplicate NORSPAN client entries (plain "NORSPAN" — 55 jobs — vs. "NORSPAN-MB" — 4 jobs — in DIM_CLIENT_MASTER/portal job list) and `WORK_LOG_PERIOD_FIXED` maintenance rows visible to Sarty in My Hours (should be filtered from that view). Needs its own investigation session — not yet started.
2. **19 remaining truly-orphaned job_numbers** — need a manual decision (create VW rows vs. write off) before they can be resolved.
3. **Admin overhead policy** — decide how `"job assign & help"`-style non-job hours should be tracked going forward (separate pseudo-job in VW? excluded entirely?).
4. **Fix `submitted_at`/`created_at` bug in `writeQueueItem`.**
5. **Test suite uses real staff identities** — flagged as a risk, needs a DEV-only test actor pass.
6. **Inactive staff security check** — review RBAC/portal access for staff marked inactive.
7. Forward Q1 bonus letters (16 in CEO inbox, still pending from prior sessions).
8. First June payroll run from V3 (blocked on June billing — see below).
9. June billing pending — blocked on Sarty confirmation + outstanding designer hour submissions.

---

## 2026-06-29 Session (260337 fix, QMS-3C-Prep, CI pipeline)

### Work Completed

**Job 260337 duplicate — RESOLVED:**
- `runJob260337Audit()` modified to write side-by-side VW comparison to `_TEMP_AUDIT_260337` sheet tab.
- Audit revealed 3 VW rows: 260337 (Roof Truss/AR001), 260337F (I-Joist/SGO correct), 260337 (I-Joist/SGO spurious).
- `runJob260337Fix()` ran in PROD: spurious row voided, `JOB_DUPLICATE_VOIDED` written to FACT_JOB_EVENTS. `{ status: FIXED, rowsUpdated: 1 }`.
- Billing double-invoice risk eliminated. PROJECT_MEMORY.md §8 updated.

**QMS-3C-Prep — schema corrections deployed to DEV:**
- `FACT_QC_EVENTS`: 12 → 13 cols (`qc_session_id` added, nullable FK).
- `FACT_QC_REVIEW_SESSIONS`: 14 → 18 cols (`period_id`, `qc_event_id`, replaced `qc_template_ids_resolved` with `global_template_id` / `product_template_id` / `client_template_id`).
- `FACT_QC_REVIEW_CHECKLISTS`: 13 → 14 cols (`period_id` added).
- `FACT_QC_FINDINGS`: 15 → 16 cols (`period_id` added).
- ADR-QMS-017 + ADR-QMS-018 added to `docs/SOP_DECISIONS.md`. `docs/QUALITY_FRAMEWORK.md` Sections 3 + 5 updated.
- DEV validation: `runFixHeaders()` 50/50 ✅, `runVerify()` 50/50 ✅, `runQcFindingTypesTests()` 52/52 ✅, `testSopAll()` 10/10 ✅.
- **DEV only. Not deployed to PROD. Stop before QMS-3C.**

**CI pipeline:**
- `.github/workflows/test.yml` created: push to main → `npm install` → `npm test`, Node 20.
- First Actions run: ✅ passed in 17s.

### Files Changed
- `src/setup/SetupScript.gs` — 4 schema changes
- `src/12-migration/Job260337DuplicateFixer.gs` — audit output to sheet tab
- `docs/SOP_DECISIONS.md` — ADR-QMS-017, ADR-QMS-018
- `docs/QUALITY_FRAMEWORK.md` — Sections 3 + 5
- `PROJECT_MEMORY.md` — 260337 risk closed
- `.github/workflows/test.yml` — new file

**Rating requests — active flag bug fixed:**
- `sendRatingRequests`, `getMyRatees`, `getRatingsGaps` all used blacklist filter (`skip if active=FALSE`).
- Staff with blank `active` field (e.g. Banik Sagar) slipped through.
- Fixed to whitelist (`include only if active=TRUE`) in all three functions. Deployed to PROD.

**SBS client feedback — data fixes pending (manual sheet edits required):**
- DIM_CLIENT_MASTER has two SBS rows — blank duplicate must be deleted manually.
- Good SBS row: update `contact_name` → `AL, Roger, Ray`; update `contact_email` → `aguerra@structuralbuildingsolutions.com,respinoza@structuralbuildingsolutions.com,rrespass@structuralbuildingsolutions.com`

**Dead letter queue investigation:**
- 35 total dead letter items. 6 from Sarthy (June 19, pre-fix noise). 
- Bittu + Abhijit submitting JOB_HOLD — RBAC correctly blocking (DESIGNERs cannot hold jobs).
- Root cause: stale browser cache. Fix: ask Abhijit to hard-refresh portal (Cmd+Shift+R).
- No code change needed. No data damage.

### Files Changed
- `src/setup/SetupScript.gs` — 4 QMS schema changes (DEV only)
- `src/12-migration/Job260337DuplicateFixer.gs` — audit output to sheet tab
- `src/07-portal/PortalData.gs` — active flag whitelist fix (3 functions)
- `docs/SOP_DECISIONS.md` — ADR-QMS-017, ADR-QMS-018
- `docs/QUALITY_FRAMEWORK.md` — Sections 3 + 5
- `PROJECT_MEMORY.md` — 260337 risk closed
- `.github/workflows/test.yml` — CI pipeline added
- `SESSION_LOG.md` — this file

### Next Steps
1. **Manual sheet fix** — DIM_CLIENT_MASTER: delete blank SBS row, update contact_name + contact_email on good SBS row
2. **Banik Sagar** — set `active=FALSE` + `effective_to` on his DIM_STAFF_ROSTER row
3. **Ask Abhijit** — hard-refresh portal (Cmd+Shift+R)
4. Forward Q1 bonus letters (16 in CEO inbox blccanada2026@gmail.com)
5. Send Q2 rating requests (Test Mode first) + Q2 client feedback requests
6. QMS-3C — DAL + Engine only (no portal) — await CTO go-ahead
7. Build client timesheet generator (`ClientTimesheetEngine.gs`)
8. First June payroll run from V3

---

## 2026-06-19 Session (Sarty Bug Fixes — 5 issues resolved)

### Work Completed

**Bug 1 & 2 — QC/QC_REVIEWER team visibility (DBS, RKU):**
- `loadJobs_()` QC/QC_REVIEWER branch now uses `buildTeamCodes_()` — same account-scoped
  visibility as TEAM_LEAD (REF_ACCOUNT_DESIGNER_MAP Path 1).
- DBS (QC) and RKU (QC_REVIEWER) now see all designers on shared accounts.
- **Data action needed:** DBS must be added to REF_ACCOUNT_DESIGNER_MAP for ALBERTA TRUSS + NELSON.

**Bug 3 — ABR hours not showing in My Hours panel:**
- `getMyHours()` actor_code comparison made case-insensitive (`.toUpperCase()` both sides).
- Prevents mismatch between DIM_STAFF_ROSTER person_code casing and FACT_WORK_LOGS actor_code.

**Bug 4 — SGO (PM) Submit for QC button missing:**
- Added `canSubmitQC` perm to `buildPerms_()` — covers DESIGNER + TL + QC + QC_REVIEWER + **PM**.
- `PortalView.html` Submit QC button changed from `perms.isDesigner` → `perms.canSubmitQC`.

**Bug 5 — 19 stale migration artefact jobs:**
- `StaleJobVoidEngine.gs` created — `runStaleJobAudit()` (dry run) + `runStaleJobVoid()` (execute).
- `loadJobs_()` now excludes `current_state = 'VOIDED'` rows from all portal views.
- **Action needed:** Run `runStaleJobAudit()` then `runStaleJobVoid()` from Apps Script editor.

### Deployment
- `clasp push --force` to PROD ✅
- commit `5a01962` — 4 files changed
- **REDEPLOY REQUIRED** in Apps Script editor (New Version) for portal URL to serve new code

### Next Steps
1. Add DBS to REF_ACCOUNT_DESIGNER_MAP (ALBERTA TRUSS + NELSON accounts)
2. Run `runStaleJobVoid()` to void 19 stale jobs
3. Forward Q1 bonus letters (16 in CEO inbox blccanada2026@gmail.com)
4. Send Q2 rating requests + Q2 feedback requests before end of June
5. Resolve job 260337 duplicate (needs Sarty confirmation)

---

## 2026-06-18 Session (Team Feedback Bug Fixes + Migrated QC Repair + Dashboard Cleanup)

### Work Completed

**Timesheet PDF fixes (carried from previous session):**
- Designer name blank in CEO PDF: `staffMap` stores `{ name, email }` — was accessing `.first_name`/`.last_name`. Fixed to `.name`.
- Remarks column empty: now populated from `notes` field in FACT_WORK_LOGS (amendment rows excluded).
- Added `runTimesheetCEOEmailOnly(periodId)` / `sendCEOOnly_()` — re-sends only CEO PDFs, skips designer emails.

**RBAC fixes (commits `fa32ecb`):**
- `TEAM_LEAD`: `QC_APPROVE/REJECT: false → true` — Sandy (Samar/SDA), Bharath (BCH), Savvy (SVN) REVIEW button now shows.
- `QC` role: `JOB_START: false → true` — Rajkumar (RKU, QC_REVIEWER) can start design jobs.

**Handler validation fix (commit `fa32ecb`):**
- `job_number maxLength: 30 → 200` in all 6 handlers: QCHandler, JobHoldHandler, QCReassignHandler, JobResumeHandler, WorkLogHandler, JobStartHandler.
- Root cause of 27 VALIDATION_FAILED errors + 36 dead-lettered queue items. Dead-letter queue will drain on next QueueProcessor cycle.

**Portal team visibility fix (commit `fa32ecb`):**
- `buildTeamCodes_()` in PortalData.gs: added supervisor_code path (Path 2). TLs now see direct reports via DIM_STAFF_ROSTER `supervisor_code`, not only shared-account designers via REF_ACCOUNT_DESIGNER_MAP.

**Billing WRITE_GUARD fix:**
- `BillingEngine` was already added to `FACT_JOB_EVENTS` WRITE_PERMISSIONS in a prior session (local only, never pushed). Pushed today — 3 stuck COMPLETED_BILLABLE jobs (BLC-00184, BLC-00171, BLC-00186) confirmed already INVOICED; repair function skipped.

**Migrated QC_REVIEW repair (commits `9cd28a7`, `3c684c0`):**
- `MigratedQCApprovalFixer.gs` — identifies migrated jobs (STACEY_JOB| idempotency key) stuck in QC_REVIEW, writes QC_APPROVED event to FACT_QC_EVENTS, transitions VW → COMPLETED_BILLABLE.
- Dry run: 122/129 QC_REVIEW jobs identified as migrated.
- Live run: **121 fixed, 1 skipped (duplicate job_number 260337 — idempotency, both VW rows updated), 0 errors.**

**Grouped tree view for PM and TEAM_LEAD (commit `77baedd`):**
- Gate changed from `canRunPayroll` (CEO only) to `canViewAll` — Sarty (PM) and all TLs now get client-grouped collapsible tree, identical to CEO view.

**Three-tier job view (commit `f8331ba`):**
- Tier 1 — Active Jobs: INTAKE_RECEIVED→CLIENT_RETURN states. Flat for DESIGNER/QC, client tree for TL/PM/CEO.
- Tier 2 — Ready to Invoice: COMPLETED_BILLABLE, collapsed by default, all roles. Client tree for canViewAll, flat for others. Lets team verify work before billing cycle.
- Tier 3 — Invoiced: CEO only, collapsed. Billing complete — rest of team doesn't need it.
- Toolbar h2 updated: "Jobs" → "Active Jobs".

**Dashboard DS1/UNKNOWN cleanup (commits `b099c9b`, `3bf36fd`):**
- `buildStaffNameMap_()`: added active filter — inactive roster entries no longer included in nameMap.
- `renderWorkloadPanel` (PortalView.html): added `!nameMap[who]` guard — codes not in active roster excluded from workload counts.
- `getLeaderDashboard`: `EXCLUDED_CODES = { DS1, UNKNOWN }` — skipped unconditionally in work log loop (previous check was WORK_LOG_MIGRATED only, non-MIGRATED events were leaking through).
- `getCEODashboard`: same `CEO_EXCLUDED_CODES` guard added to both activeJobsMap and hoursMap loops.
- BTD/SNA: user manually reassigned VW jobs to correct V3 codes and deactivated in DIM_STAFF_ROSTER. Double-count eliminated.

### User Data Fixes (spreadsheet — completed)
- `DIM_STAFF_ROSTER`: DBS (Deb Sen) role changed `DESIGNER → QC` ✓
- `REF_ACCOUNT_DESIGNER_MAP`: RKU rows added for his client accounts ✓

### Key Commits
- `fa32ecb` fix(rbac,handlers,portal): QC permissions, job_number validation, team visibility
- `9cd28a7` feat(migration): MigratedQCApprovalFixer — retroactive QC approval for V2 stuck jobs
- `3c684c0` fix(migration): add runMigratedQCApprovalFixerLIVE wrapper
- `b099c9b` fix(portal): filter DS1/UNKNOWN from workload panel and nameMap
- `3bf36fd` fix(portal): unconditionally exclude DS1/UNKNOWN from all dashboard panels
- `d18604e` fix(portal): absolute final-stage exclusion of retired V2 codes

### Open Items
1. Duplicate job_number `260337` in VW_JOB_CURRENT_STATE — needs data cleanup
2. Q1 bonus letters — still in CEO inbox (blccanada2026@gmail.com), review and forward

### Note on Deployment
Apps Script `/exec` URL serves versioned snapshots — every `clasp push` must be followed by a "New version" redeploy in the Apps Script editor for changes to take effect at the production URL.

---

## 2026-06-17 Session (Semi-Monthly Billing Engine Rewrite)

### Work Completed

**BillingEngine.gs — full rewrite (commit `a4f1b31`):**
- Semi-monthly periods: `2026-06A` (1–15th) and `2026-06B` (16–end)
- Bills ALL jobs with hours in the period (not just COMPLETED_BILLABLE)
- In-progress jobs billed for their hours but state unchanged — billed again next period for new hours
- Only COMPLETED_BILLABLE jobs → INVOICED transition
- New columns: `job_status` ('COMPLETED'/'IN_PROGRESS') and `remarks` on every billing row
- Defensive work_date parser handles both ISO (`2026-06-15`) and mangled BATCH-004 format (`Mon Jun 01`)
- FACT_BILLING_LEDGER partitioned monthly (`|2026-06`); semi-monthly period_id stored as row field
- MART refresh now reads full monthly partition — running B-half no longer erases A-half aggregates
- Dry-run mode: `options.dryRun=true` → full compute, no writes, logs all amounts
- Runner functions: `runBillingRunDryRun()`, `runBillingRunManual()`
- One-time schema patcher: `runPatchBillingLedgerSchema()` — adds job_status + remarks to existing partition headers

**Supporting changes:**
- `SetupScript.gs`: FACT_BILLING_LEDGER header updated to include job_status + remarks
- `Portal.gs`: JSDoc updated (period ID example, return shape)
- `PortalView.html`: confirm dialog + success toast updated for new billing model

### BEFORE FIRST BILLING RUN — Required Sequence
1. `clasp push --force` → deploy new version via Apps Script editor
2. `runPatchBillingLedgerSchema()` in Apps Script editor — patches FACT_BILLING_LEDGER|2026-04 header
3. `runBillingRunDryRun()` — verify amounts, confirm jobs + hours are correct
4. `runBillingRunManual()` — live run (or use portal billing button)

### Open Items for Next Session
1. **Execute billing run** — after runPatchBillingLedgerSchema() + dry run verify
2. **Client timesheet generator** — new feature: per-job breakdown (designer, hours, amount) for client invoices
3. **Full testing plan** — `.claude/context/test-plan.md` — real-job testing across all 6 accounts / 5 roles
4. **Stale QC_REVIEW migrated jobs** — bulk-update script needed
5. **Q1 bonus letters** — 16 in CEO inbox (blccanada2026@gmail.com), review and forward to designers

---

## 2026-06-16 Session (Live Bug Fixes + Portal Features — Day 2)

### Work Completed

**Portal bugs fixed (all committed + pushed to PROD, 6 deployments):**
- TL job visibility: replaced supervisor-hierarchy lookup (`buildTeamCodes_`) with account-scoped lookup via `REF_ACCOUNT_DESIGNER_MAP`. TLs now see all jobs across their accounts.
- QC/QC_REVIEWER added to assign dropdown (`getActiveDesigners` + `getDesignersForClient`). Raj Kumar now appears when assigning jobs.
- Log Work button: switched from `isDesigner` flag to `canLogWork` permission flag (WORK_LOG_SUBMIT). PM, TL, QC_REVIEWER all see it on every non-terminal state.
- My Hours panel: new `getMyHours()` / `portal_getMyHours()` endpoint + panel rendered for all roles that can log work. Shows per-job hours this period.
- Fixed fatal spinner bug: `_ptoken` (undeclared) → `TOKEN_RUN` in `loadMyHours`. Was crashing `onDataLoaded` before `showLoading(false)`, freezing all users on spinner.
- Fixed `minLength: 6` on job_number in all 7 handlers + ValidationEngine — was rejecting migrated short job numbers (e.g. NL-01, AT-1). Removed entirely; `required: true` handles empty.
- Fixed DS1/UNKNOWN appearing in CEO Load Balance: `getCEODashboard` hoursMap now filtered by `staffNameMap` (active roster only).
- Fixed `BillingEngine.gs` BILLING_LEDGER_SCHEMA + INVOICED_EVENT_SCHEMA: removed `pattern: /^BLC-\d{5}$/` from both job_number fields — would have blocked billing run on migrated jobs.
- Fixed email: Deb Sen (DBS) mixed-case email lookup — case-insensitive fallback in `lookupActor_`.
- Added `QC_REVIEWER: 'QC'` alias in RBAC.gs ROLES map.

### Files Changed
- `src/07-portal/PortalData.gs` — buildTeamCodes_, getActiveDesigners, getDesignersForClient, buildPerms_, getMyHours, getCEODashboard hoursMap filter
- `src/07-portal/PortalView.html` — Log Work buttons (canLogWork), My Hours panel + JS, TOKEN_RUN fix
- `src/07-portal/Portal.gs` — portal_getMyHours
- `src/02-security/RBAC.gs` — QC_REVIEWER alias, case-insensitive email lookup
- `src/06-handlers/` — all 7 handlers: minLength removed from job_number schema
- `src/04-validation/ValidationEngine.gs` — SCHEMA_FRAGMENTS.JOB_NUMBER minLength removed
- `src/09-billing/BillingEngine.gs` — pattern removed from both job_number schema fields

### Key Commits
- `5d0cde5` feat(portal): TL visibility by account membership
- `b73be54` fix(portal): QC/QC_REVIEWER in assign dropdown
- `bddec3a` feat(portal): Log Work + My Hours panel for PM/TL/QC
- `66dd9e9` fix(portal): TOKEN_RUN in loadMyHours (_ptoken crash)
- `72589ab` fix(validation): drop minLength from job_number in all handlers
- `15fd4fb` fix(dashboard): filter DS1/UNKNOWN from CEO load balance

**Q1 bonus — COMPLETED ✅ (same session, continued):**
- `runQ1MarkIneligibleSkipped()` — BIT + 7 PENDING designers (AVM, PRG, RUD, SKR, SMB, SUB, SUB2) marked SKIPPED. Not in HR manual hours → not Q1-eligible.
- Fixed `runSendBonusLetters` dedup: switched to latest-row-wins across ALL rows before filtering by CALCULATED — previous logic let an old CALCULATED row survive even after a SKIPPED amendment was added.
- `runQ1ForceHRComposites()` — wrote 16 final amendments using exact HR composites (m.comp from Q1_MANUAL_HRS_) instead of engine-recalculated composites. Supersedes earlier amendments via latest-row-wins dedup.
- `runSendQ1BonusLetters()` — 16 letters sent to blccanada2026@gmail.com. All amounts verified against HR sheet. Total: ₹72,231.13. Safe to forward.

### Key Commits (Q1 bonus)
- `fbed9b7` fix(billing): remove job_number pattern from BillingEngine schemas
- `4ddeb87` chore(docs): update PROJECT_MEMORY + add CTO test plan
- `220ebb9` fix(bonus): correct letter-send dedup + add Q1 ineligible skip function
- `7639432` feat(bonus): runQ1ForceHRComposites — pin exact HR composites to ledger

### Note (updated 2026-06-17)
Billing run NOT yet executed — BillingEngine was rewritten next session (see 2026-06-17 entry).
Q1 bonus letters in CEO inbox — ready to forward.

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
