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

## Session State (last updated: end of turn, 2026-08-27)

**Payout Statement Summary (TASK NEW-1) — implementation complete, on branch
`worktree-payout-statement`, NOT merged/pushed/deployed.** Full detail in
that task's entry below (Wave Backlog section) and in
`docs/superpowers/plans/2026-08-26-payout-statement.md`'s SDD ledger.
8 tasks + 1 final-review fix wave, all individually reviewed clean, 533/533
Jest passing. **Next step is user-driven: live DEV verification** (checklist
in the plan's Task 8), then explicit approval to merge/deploy per CLAUDE.md
R9 — neither has happened yet.

Prior session (2026-08-14, SOP upload workflow + QC findings-picker live
DEV walkthrough) is fully closed — durable outcomes already in
`PROJECT_MEMORY.md` and `SESSION_LOG.md`'s 2026-08-14 entry; compressed out
of this Session State block per this file's own standing practice (nothing
lost, see `git log -p CTO_TASK_QUEUE.md` for the pre-compression detail).

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

### EPIC: New — Portal Payout Statement Generation for CEO/HR Review
- **TASK NEW-1** | Build a portal-triggered Payout Statement generation feature for CEO + HR admin, routing output to `HR@bluelotuscanada.ca` for review before team distribution | **IMPLEMENTATION COMPLETE 2026-08-27, awaiting live DEV verification + explicit PROD approval** | Requested 2026-08-14, brainstormed and designed 2026-08-26 (design questions (a)-(d) all resolved — see spec), implemented via subagent-driven-development on branch `worktree-payout-statement` (`.claude/worktrees/payout-statement`).
  **Design spec:** `docs/superpowers/specs/2026-08-26-payout-statement-design.md`. **Implementation plan:** `docs/superpowers/plans/2026-08-26-payout-statement.md` (8 tasks, all individually reviewed clean, plus a final whole-branch review that found and fixed 4 Important issues — see that plan's Global Constraints and the SDD ledger at `.claude/worktrees/payout-statement/.superpowers/sdd/2026-08-26-payout-statement/progress.md` for full detail).
  **What shipped:** `PayrollEngine.previewPayoutStatement(actorEmail, periodId, options)` — a new no-write CEO/HR_ACCOUNTING preview trigger (reuses the existing `PAYROLL_PREVIEW`/`PAYROLL_VIEW` RBAC actions, no matrix change) that computes base pay + supervisor bonus (+ optional quarterly bonus) and emails one combined summary to the `PAYOUT_STATEMENT_REVIEW_RECIPIENT` Script Property (default `HR@bluelotuscanada.ca`). Additive only — the existing per-consultant confirm-gate email flow (`sendPaystubEmail_`/`confirmPaystub`) is completely unchanged in mechanism; `runPayrollRun`/`runBonusRun` now also send the same HR summary automatically on a real commit (guarded to only fire when something was actually processed, not on an idempotent re-run). New portal button "📧 Generate Payout Statement" (CEO/HR_ACCOUNTING only), plain-text batch email (no PDF), manual `prompt()`-based period entry (no scheduled trigger). Also renamed all pre-existing user-facing "Paystub" text to "Payout Statement" across `PayrollEngine.gs`/`PortalView.html`/`StaffOnboarding.gs` (contractor CRA/legal terminology — BLC's consultants are not employees) — internal identifiers (`sendPaystubEmail_`, `confirmPaystub`, CSS ids) deliberately left unrenamed. Also fixed a stale `.claude/context/payroll-rules.md` doc/code drift found during design: PM bonus is a flat, company-wide calculation (not `pm_code`-scoped as the doc incorrectly said) — confirmed as the correct, already-shipped Phase B1 behavior; kept as-is, doc corrected.
  **Tests:** 533/533 Jest passing (full repo suite), including new coverage for the double-rounding contract, RBAC gating, additive-not-replacing behavior, and the idempotent-re-run guard added during final review.
  **NOT done yet — live DEV verification required before this is trusted** (per `PROJECT_MEMORY.md` §3.1, money/aggregation code always needs this in addition to Jest): push to DEV, set `PAYOUT_STATEMENT_REVIEW_RECIPIENT` to a real checkable inbox first, click through the preview button as both CEO and HR_ACCOUNTING (fresh Incognito per §3.9(a)'s standing lesson), confirm the quarterly-bonus opt-in section renders correctly, confirm a real `runPayrollRun`/`runBonusRun` commit still sends exactly one additional "committed" HR email, confirm all renamed consultant-facing strings read correctly live. Full 7-item checklist in the plan's Task 8. **NOT merged to main, NOT pushed to origin, NOT deployed to PROD** — needs explicit user approval per CLAUDE.md R9, same as every other feature in this backlog.

### Parallel Track: BLC Growth Platform
- **TASK GP-1** | Standalone project decision + architecture (own future CTO assessment, not folded into this backlog) | P4 | Not started, not scoped.

---

## Other Still-Open Items

- **`PLATE_ERROR` finding code has stale `product_applicability`
  (`'TRUSS'`)** — needs to become `'ROOF_TRUSS'` in both DEV and PROD
  `DIM_QC_FINDING_TYPES` seed/live data, direct consequence of the
  2026-08-14 SOP-upload/job-creation vocabulary unification fix. Not
  yet done.
- **Findings-picker checkboxes render visually all-ticked on open**
  (cosmetic only — confirmed via live data that actual submissions are
  correct, not a data bug) — low-priority CSS/rendering fix, not
  scoped/scheduled.
- **W0-2's `PerfBaselineReport` has 4 days of unread real PROD
  traffic** (since 2026-08-10) — read it before deciding whether portal
  action latency needs work; raised again 2026-08-14 during live DEV
  testing (DEV's own latency is not representative — bloated by test
  data).
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
