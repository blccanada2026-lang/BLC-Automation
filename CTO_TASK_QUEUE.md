# CTO_TASK_QUEUE.md — Active Workstreams

Running, human-and-Claude-readable log of active cross-session workstreams:
current step, and what's blocked on what. Distinct from `SESSION_LOG.md`
(what happened in a given session) — this tracks task *state* across
sessions, so a fresh session (or a fresh Claude instance) can pick up any
active thread without re-deriving where it left off.

**Update this file at the start and end of every session touching any of
these threads. Keep it lean** — this file tracks what's ACTIVE, not a
permanent archive. Once a thread is fully closed, its durable outcome
belongs in `PROJECT_MEMORY.md` (Completed Work / Known Risks / standing
§3.x rules) and `SESSION_LOG.md` (dated entry) — trim it out of here
rather than letting it accumulate. (Trimmed 2026-08-10 from ~1390 lines —
full pre-trim detail is preserved in `git log -p CTO_TASK_QUEUE.md` if
ever needed; nothing durable was lost, it's all already cross-referenced
into `PROJECT_MEMORY.md`.)

**Standing practice, added 2026-07-26:** update the "Session State" block
below at the end of every turn, not just at session/task boundaries. Keep
it terse (2-4 lines), overwrite it each turn — same-turn breadcrumb, not a
log. The durable narrative belongs in `PROJECT_MEMORY.md`/`SESSION_LOG.md`.

**Standing practice, added 2026-07-27 — `push:dev` discipline.** `clasp
push --force` (what `push:dev`/`push:prod` run) fully **replaces** a
script's deployed content — it does not merge. All `push:dev` calls must
originate from the worktree/branch that currently has the superset of
everything that needs to be in DEV — never run `push:dev` from the
primary checkout while a separate DEV-only branch has content `main`
lacks, that silently deletes it from DEV.

---

## Session State (last updated: end of turn, 2026-08-13)

**SOP upload workflow — implementation complete on branch `sop-upload-workflow`
(4 tasks + 1 final-review fix wave, commits `55ba9c7..442aa7a`), NOT yet
merged to main, NOT yet deployed to DEV or PROD.** New CEO-only
structured-upload → manager-review → CEO-publish path for SOP documents
(`SopUploadEngine.gs`, `DIM_SOP_UPLOADS`, `FACT_SOP_REVIEW_FEEDBACK`,
`SOP_UPLOAD` RBAC action, `ReviewSop.html`). Full detail in
`SESSION_LOG.md`'s 2026-08-13 entry.

**Final whole-branch review found 1 Critical + 6 Important issues, all
fixed and re-verified clean (2026-08-13):** the Critical finding was a
real plan defect, faithfully implemented by every task and invisible to
task-scoped review — neither the manager review page nor the CEO publish
screen actually showed the structured checklist/notes the human was
meant to verify before approving. Both now render it. The 6 Important
fixes: XSS-unescaped `</script>` in the new `review-sop` doGet route (a
no-login, link-distributed page — real risk, not cosmetic);
`markDraftReady` now validates the linked template actually exists and
matches the upload's client/product (previously a typo'd template ID
would silently bind the wrong client's SOP); uploaded Drive files are now
shared link-viewable so managers can actually open them; a missing
secret/URL now shows a clear error instead of a silently-absent review
link; `publishUpload` now explicitly rejects `QC_REVIEW_SOP` uploads
instead of failing with a misleading error.

`runSopUploadEngineTests()` (17 tests after the fix wave) verified by
manual code trace only in this environment — **not yet executed live**,
same caveat every prior GAS feature built without a live Apps Script
editor has carried. Needs a live DEV run before being trusted, following
the exact same process used for the QC-findings-picker feature (that
feature's own live run found 2 real bugs invisible to manual trace).

**Live-DEV-run checklist, in this order (5 items — 2 original deploy
prerequisites + 3 more surfaced by the final review):**
1. `runSetupSchemas()` once in the DEV Apps Script editor after the first
   push — creates the `DIM_SOP_UPLOADS`/`FACT_SOP_REVIEW_FEEDBACK` tabs.
   Declaring a table in `SCHEMAS` does not create its tab automatically.
2. `runGenerateSopReviewSecret()` once — until run, `tokenForUpload()`
   throws and no manager review link will work.
3. **Confirm the deployed web app's "Who has access" setting.**
   `appsscript.json` currently says `"access": "MYSELF"`, which would
   make a no-login manager review link unusable — this contradicts known
   live usage (100+ staff already use no-login `?pt=` portal links), so
   the checked-in manifest is likely stale versus the actual deployment.
   Verify, don't assume.
4. **Verify `driveFile.setSharing(ANYONE_WITH_LINK, VIEW)` doesn't throw.**
   No prior `setSharing` call exists anywhere else in this codebase to
   confirm the Workspace domain's admin policy allows external
   link-sharing. If it's blocked, every SOP upload will fail at creation
   time. Test with one real upload before this reaches PROD.
5. **Manually exercise a real file upload through the portal UI** (not
   just the automated test suite, which constructs file blobs
   server-side and never touches the actual `google.script.run`
   file-transport path). The plan assumed — never verified — that
   `google.script.run` accepts a bare `File` object from
   `<input type="file">` directly; if that assumption is wrong, the
   fallback is a client-side `FileReader` → base64 → server-side
   `Utilities.newBlob(Utilities.base64Decode(...))` rebuild, confined to
   `PortalView.html` + the `Portal.gs` wrapper.

Also note: the QC-review-SOP backend (`QcProcessAdminEngine`) remains
unbuilt — `doc_type: 'QC_REVIEW_SOP'` uploads can be created and reviewed
by managers through this workflow, but `publishUpload` now explicitly
rejects publishing them (see above) until that engine exists (explicitly
out of scope for this plan, flagged as the next project).

**W2-1 — numeric conflicts resolved by user's managers, 2026-08-10.**
All three blockers from the two NORSPAN-MB source docs (`SOP-NOR-TRS-003`
designer rules, `SOP-NOR-TRS-QC-005` QC-reviewer checklist) now have
confirmed answers:
- **Deflection limit: L/360 for both LL and TL** (Doc 1 was correct;
  Doc 2's L/300 was wrong).
- **Valley truss stud spacing: 4' O.C. is the default; 24" O.C. applies
  only when the valley is at an exposed location, for sheathing** — both
  docs were partially right, this is a conditional exception, not a
  straight conflict. Checklist item wording needs to capture the
  exposed-location condition, not just state one flat number.
- **Span limits: Residential 40' / Commercial 75' caps confirmed** (Doc
  1), **and separately, truss length >48' requires 2×6 top & bottom
  chords** (clarifies Doc 2's "2×6 for spans ≥48'" as a lumber-sizing
  rule, not a competing span cap) — "both apply together" was the
  right call. Note: Doc 2's other claim ("2×4 up to 28'") was not
  explicitly restated by the manager — minor loose end, not blocking
  given the checklist is category-level (~9 items), not itemizing every
  lumber-size threshold individually.

All prior settled inputs still stand: software = Alpine, ~9-item
category-level granularity, `job_type='Roof Truss'`/`scope_code='TRUSS'`.
Doc 2's QC-reviewer content (admin tracking, Pass/Fail, Root Cause
tagging, Section 7) is still explicitly held aside from this pilot —
targets the separate unwired `PRODUCT_QC_TRUSS` system, not `SopGate`.

**Next action — W2-1 now unblocked, ready to build:** write the
~9-item designer checklist reflecting the resolved values above, then
build/publish via `SopAdminEngine.createTemplate`/`addItem`/
`publishTemplate` for NORSPAN-MB. Original pre-flight gap (confirm no
conflicting ACTIVE template already exists in `DIM_SOP_TEMPLATES` for
NORSPAN-MB) still applies — check before flipping `SOP_ENABLED`.
2026-08-17 pilot start date back on track.

**W2-3 (findings-picker UI) — merged to main 2026-08-12 (PR #21,
`5e80aa7`), fully validated live in DEV.**
`runQCFindingsPickerTests()` 23/23, `runQCHandlerTests()` 25/25,
`runQCHandlerFlowTests()` 31/31 — **79/79 passing, 0 regressions.**
Live execution (this was the first time these suites ever actually
ran — previously only manually traced) found and fixed 2 real bugs
along the way: a `PARTITIONED_TABLES` registration gap for
`FACT_QC_FINDINGS`, and a Google-Sheets-coerces-`"TRUE"`-to-boolean
bug in the `active_flag` check (2 call sites). Full writeup in "Other
Still-Open Items" below and in `SESSION_LOG.md`'s 2026-08-12 entry.
`DIM_QC_FINDING_TYPES` confirmed seeded correctly in DEV (17/17 rows).
**Not yet deployed to PROD** — no PROD deploy is authorized without
separate, explicit user approval (CLAUDE.md R4/R6/R9). When that
approval comes: Tasks 2+3 (backend validation + frontend picker) must
ship together, same push — the backend unconditionally rejects
MINOR_REWORK/MAJOR_REWORK without `finding_codes`, and the frontend is
the only thing that supplies it from the real UI.

---

## CTO Wave Backlog (from 2026-08-07 assessment, prioritized 2026-08-09)

Source: full CTO architecture/performance/tech-debt assessment,
2026-08-07 (see `PROJECT_MEMORY.md` §3.8 for durable findings).

### EPIC: Wave 0 — Verification & Safety
- **TASK W0-1** | PROD Apps Script project ID rotation | P0 (security) but **explicitly DEFERRED by user, 2026-08-09** — do not action without being asked again; reminder saved to cross-session memory, surface once the rest of this backlog is implemented.
- **TASK W0-2** | Add minimal performance instrumentation to the 4 highest-traffic portal reads | P1 | **DONE 2026-08-10, PR #20, deployed PROD `0014b58`.** Reused existing `HealthMonitor.startExecution()`/`endExecution()` pattern — `portal_getViewData`/`portal_getLeaderDashboard`/`portal_getMyHours`/`portal_getCEODashboard` now log duration_ms+api_calls to `_SYS_LOGS` per call. `PerfBaselineReport.gs` (new, read-only) reports count/min/avg/p95/max per module. **Pending: confirm PROD New Version redeploy done, then let real usage accumulate a day or two before reading the report there.**
- **TASK W0-3** | Review `blc-go-live-fixes.patch` (gitignored, unreviewed since June) | P3 | Not started.
- **TASK W0-4** | Investigate `QueueProcessor` 232-second execution outlier (`max=231994ms` vs `p95≈8.8s` across 2,906+ calls, pre-existing instrumentation) | P2 | Found 2026-08-10 while validating W0-2's report tooling. Close to Apps Script's 6-min execution ceiling — if ever actually hit mid-run, that's a silent partial-processing risk. Single outlier so far, not confirmed as a pattern. Not investigated.

### EPIC: Wave 1 — Technical Debt Reduction (`src/12-migration/` archival)
- **TASK W1-1** | Systematic caller-trace of all 71 T12 files (cross-reference `DAL.gs` `WRITE_PERMISSIONS` + git history per file) → classify KEEP/ARCHIVE definitively | P2 | Prerequisite — do not archive anything before this. Not started. **Deprioritized by user, 2026-08-09** — doing Wave 0 → Wave 2 first.
- **TASK W1-2** | Archive the legacy `onIntakeFormSubmit`/`INTAKE_FORM_ID` trigger installer in `setup/Triggers.gs` (confirmed not installed, confirmed superseded by portal-button SBS intake) | P3 | Not started.

### EPIC: Wave 2 — SOP/QC Finish & Activate (NOT a rebuild — `src/13-sop/` already exists, 3,725 lines, feature-flagged pilot infra) — **CURRENT FOCUS**
- **TASK W2-1** | Design pilot rollout plan: which client(s) first, `WARN_ONLY` vs `BLOCK`, timeline | P2 | **Inputs confirmed 2026-08-10: client `NORSPAN-MB`, mode `WARN_ONLY`, start week of 2026-08-17 (Monday).** Rollout mechanics (`SopGate.gs`): set Script Properties `SOP_ENABLED='true'`, `SOP_MODE='WARN_ONLY'`, `SOP_PILOT_CLIENTS='NORSPAN-MB'` in the Apps Script editor (no code change needed — flags are already read live). WARN_ONLY means non-blocking — designers see nothing rejected, only `SOP_GATE_WARN` log entries land in `_SYS_LOGS` when a QC submission has incomplete checklist items. **Unblocked 2026-08-10** — all content decisions settled (software Alpine, ~9-item category-level checklist, job_type/scope_code, and the 3 numeric conflicts between the two source docs all resolved via user's managers). Full detail in Session State above. **Ready to build via `SopAdminEngine`** — pre-flight gap (verify no conflicting ACTIVE template already exists) still applies before flipping `SOP_ENABLED`.
- **TASK W2-2** | Trace `QcFindingTypes.gs` (521 lines, defines a QC finding taxonomy) — confirm whether an internal-QC reviewer queue UI exists or still needs building | P2 | **DONE 2026-08-10.** At the time, taxonomy (17 codes, `DIM_QC_FINDING_TYPES`) was fully seeded but had zero consumers — confirmed needing a UI, not a revival. **W2-3 (below) built and merged that consumer 2026-08-12** — no longer zero consumers.
- **TASK W2-3** | Build QC findings-picker UI: multi-select finding codes (from `DIM_QC_FINDING_TYPES`) on the `#modal-qc-review` modal, new `portal_getQcFindingTypes()` read endpoint (first-ever reader of that table), `QCHandler.gs` changes to accept/store selected finding code(s) on the QC event | P2 | **DONE 2026-08-12 — merged to main (PR #21), 79/79 tests passing live in DEV.** Only remaining step is a PROD deploy, which needs separate explicit user approval. See Session State above.
- **TASK W2-4** | Build SOP upload workflow: CEO-only structured upload → manager review link (no login) → CEO publish, for both SOP designer docs and (partially) QC-review SOP docs | P2 | **Implementation DONE 2026-08-13 on branch `sop-upload-workflow` (4 tasks + final-review fix wave, commits `55ba9c7..442aa7a`) — NOT yet merged, NOT yet deployed to DEV or PROD.** Final whole-branch review found and fixed 1 Critical (manager/CEO review screens didn't show the structured checklist) + 6 Important issues. `runSopUploadEngineTests()` (17 tests) manually traced only, needs a live DEV run per the 5-item checklist in Session State above before trusted.

### EPIC: Wave 3 — Client Feedback data-model extension
- **TASK W3-1** | Add structured severity/root-cause/resubmission fields to the existing `ClientFeedback.gs` intake | P3 | Depends on Wave 2 producing real QC data. Not started.

### EPIC: Wave 4 — Quality Analytics
- **TASK W4-1** | Define metrics precisely (First Pass Quality, rework rate by designer/client/product, etc.) before any dashboard work | P3 | Not started.

### EPIC: Wave 5 — Learning Hub
- **TASK W5-1** | Design content/tagging model | P4 | Sequenced after Wave 2 produces real error-classification data. Not started.

### Parallel Track: BLC Growth Platform
- **TASK GP-1** | Standalone project decision + architecture (own future CTO assessment, not folded into this backlog) | P4 | Not started, not scoped.

---

## Other Still-Open Items

- **Task 3 — QC assignment mapping** (`DIM_QC_ASSIGNMENTS`) — unblocked since 2026-07-26, **explicit go-ahead still required before starting.** Two settled design decisions, don't re-litigate: date-ranged from day one (same `asOfDate` pattern as the supervisor_code work); must replace `QCHandler.gs`'s `sendReworkNotification_()`'s current `supervisor_code`-based CC logic with real QC-assignment data — see `PROJECT_MEMORY.md` §3.3 for the TL-vs-QC business rule this depends on.
- **Task 4 — Staff lifecycle management** — **not started, explicit instruction not to begin.** Promotions/pay changes/account allocation. Depends on `StaffOnboarding.scd2FieldChange_()` (already built, generalized for reuse). Open question: what "account allocation" means — not resolved.
- **DAL date-column matching audit** — `DAL.gs`'s `matchesConditions_()` uses loose `!=`, breaks on Date-object-vs-Date-object comparison (see `PROJECT_MEMORY.md` §3.1/§3.4 for the confirmed bug class). Full blast-radius sweep (2026-07-26): 242/243 call sites safe, one low-confidence unconfirmed case (`Job260337DuplicateFixer.gs:184`, string-vs-Date, likely coincidentally safe). Not urgent — proper fix is scoping `matchesConditions_()` itself as its own task.
- **Partition headers can diverge from canonical `SCHEMAS`** — proposed fix scoped, not implemented: `ensurePartition()`'s early-return path should verify existing headers against canonical `SCHEMAS`, not just tab existence. 0 blank-header partitions found in a full 2026-07-27 PROD scan; a few confirmed-harmless header-order/orphan-table cases found alongside. Low urgency — see git history for full detail if ever needed.
- **Payroll Automation Phase B1 (Items 2–3)** — status last checked 2026-07-29, not revisited since. Item 1 (RBAC/`HR_ACCOUNTING`) is live in PROD. Items 2 (onboarding proof) and 3 (PM bonus, fixed twice on real DEV findings) — **needs a status check**, may be stale/paused or simply forgotten. Branch `payroll-automation/phase-b1`. **Correction (2026-08-12): DEV was NOT actually holding this branch** — see DEV state note below; this item's "pushed to DEV" claim was stale/inaccurate and should be re-verified once DEV is repointed back to phase-b2.
- **DEV environment state (2026-08-12):** DEV had been running the **uncommitted working tree** of `payroll-automation/phase-b2` (found via `clasp pull` comparison — not any committed branch). That work is now committed (`payroll-automation/phase-b2` `0786b49`, not yet pushed to origin) plus backed up to `~/blc-nexus-dev-snapshot-2026-08-12.tar.gz`. DEV now holds `qc-findings-picker`/`main` post-merge. **To restore DEV to the phase-b2/Aug2026-partition-recovery state:** run `npm run push:dev` from `.worktrees/payroll-automation-phase-b2`.
- **Two real bugs found by W2-3's first-ever live test execution (2026-08-12), both fixed, merged in PR #21:** (1) `FACT_QC_FINDINGS` was missing from `DAL.gs`'s `PARTITIONED_TABLES` map, so every read/write resolved to a bare, never-created tab instead of a monthly partition (`FACT_QC_REVIEW_SESSIONS`/`FACT_QC_REVIEW_CHECKLISTS` have the identical latent gap, not fixed — no writer yet, will bite their first writer the same way). (2) Google Sheets silently coerces a `"TRUE"` string into a real boolean on write; `String(true) === 'true'` (lowercase) failed a strict `=== 'TRUE'` check on `DIM_QC_FINDING_TYPES.active_flag`, rejecting every finding code as inactive despite correct seed data. Fixed in `QCHandler.gs` and `Portal.gs` (`.toUpperCase()` before compare). **Standing gotcha:** any future `DIM_*`/`FACT_*` table with a `TRUE`/`FALSE` column will hit this same coercion.
- **Q2 ratings** — blocked on data collection, not code. `Q2RatingsPreflightCheck.gs` last showed 0/13 active staff confirmed for `2026-Q2`. Re-run to check current progress before any Q2 bonus dry-run.
- **First-ever supervised HR_ACCOUNTING/ADMIN Run Billing click** and **CEO smoke-test of Generate Timesheet with a real range** — both still open from the 2026-08-06 PR #15 thread, not yet confirmed done.
- `runSendOnboardingEmailToARN()` — harmless one-off sitting in `StaffOnboardingMailer.gs`, safe to delete whenever that file is next touched.
- **19 truly orphaned job_numbers** (post-cutover, don't resolve via normalization) — needs a manual decision: create VW rows for them, or write them off. See `PROJECT_MEMORY.md` §12 ADR-WL-001.
- **Admin overhead policy decision** — how should `"job assign & help"`-style non-job hours be tracked going forward? Separate pseudo-job in VW, or excluded entirely from work-log reporting?
- **`submitted_at`/`created_at` bug in `writeQueueItem`** — identified 2026-07-08, not yet fixed.
- **Test suite uses some real staff identities** — needs a DEV-only-synthetic-actor pass; a lot of this session's own work already moved this direction, but the original audit item was never formally closed.
- **Inactive staff security check** — review RBAC/portal access for staff marked `active=FALSE` in `DIM_STAFF_ROSTER`, not re-verified since the 2026-06-29 active-flag fix.
- **June billing** — was blocked on Sarty confirmation of June 06B reconciliation findings + outstanding designer hour submissions; status not rechecked recently.
- **Business/ops, non-code**: forward 16 Q1 bonus letters (₹72,231.13, sitting in CEO inbox) to designers; send Q2 rating + feedback requests via portal (confirm current quarter status first); raw Q1 `FACT_WORK_LOGS` dedup (1,694 rows from a Jan–Mar CSV re-import, bonus already corrected via amendment, raw data itself still uncleaned).
