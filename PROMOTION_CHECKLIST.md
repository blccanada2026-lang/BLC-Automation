# PROMOTION_CHECKLIST.md — Aggregation Fix-Set Only (Phase 4)

**Scope of this promotion: bug fixes only, revised 2026-07-23.**
`WorkLogExclusion.gs`, `WorkLogAggregation.gs`, the engine wiring
(`WorkLogHandler.gs`, `BillingEngine.gs`, `PayrollEngine.gs`,
`QuarterlyBonusEngine.gs`, `ClientTimesheetEngine.gs`), and
`AggregationFixDryRun.gs` (8 files total — see §1). **Explicitly out of
scope:** Phase 2 (correction workflow), the parameterized bonus-run layer
(`BonusPeriodEngine.gs`, `BonusPeriodCommit.gs`,
`runBonusForPeriod`/`previewBonusForPeriod`/`commitBonusForPeriod`/
`supersedeBonusForPeriod`), any bonus run of any kind, `DanglingCorrectionGuard.gs`
(deferred — see §1), and the DEV-only diagnostic scripts (also excluded —
see §1). This document authorizes preparing and reviewing a bug-fix
promotion. It does not authorize a PROD write, a bonus run, or PROD
promotion of anything outside the file list below.

**Revision note (2026-07-23):** preparing the actual PR surfaced that a
whole-branch merge would bring 30 files into `main`, not the 9 originally
scoped — including the entire bonus-run layer. Three items were dropped as
a result: `DanglingCorrectionGuard.gs` (deferred to whichever future
promotion includes its caller), the four DEV-only diagnostic scripts plus
the one-line `DAL.gs` `WRITE_PERMISSIONS` entry tied to one of them
(excluded — structural absence from PROD beats a runtime gate for a script
that writes to `FACT_WORK_LOGS`), and the `appsscript.json` `executionApi`
change (investigated and excluded — see §1, it has no effect on the
planned manual-editor execution path). §1 and §6 below reflect the
corrected, final scope. Full reasoning also recorded in `TEST_EVIDENCE.md`.

This is a planning document. **No PROD write has happened. No PROD
execution beyond a read-only source pull (see `DRIFT_CHECK.md`) has
happened.** The dry-run step in §3 is documented, not executed — it
requires your separate, explicit go-ahead per your instruction.

**§6 contains a real blocker found while answering a pre-approval
clarification request: this branch is not merged into `main`, and
`npm run push:prod` deploys from whatever is checked out in the worktree
it's run from — not specifically from `main`. Read §6 before treating §5's
sign-off checklist as ready to execute. §7 records the fresh promotion
branch prepared to resolve this, scoped to exactly the file list below.**

---

## 1. Exact file list (revised 2026-07-23)

Diffed against `main` (git commit `9605d9d`, the commit this branch
diverged from) — confirmed via `DRIFT_CHECK.md` to be byte-identical to
PROD's current live source for every file that already exists there. This
is therefore a known, reviewable delta: exactly `git diff main HEAD -- <these
8 files>`, nothing else.

| File | Status | Lines changed | Role |
|---|---|---|---|
| `src/06-handlers/WorkLogExclusion.gs` | **New** | +57 | Shared `isMigratedWorkLog()` predicate |
| `src/06-handlers/WorkLogAggregation.gs` | **New** | +83 | Shared `aggregateNetWorkLogHours()` — void/amendment netting |
| `src/06-handlers/WorkLogHandler.gs` | Modified | +5/-3 (net +5 diff lines) | `getDailyNetHours_()` consolidated onto the shared predicate |
| `src/09-billing/BillingEngine.gs` | Modified | 34 lines changed | `buildHoursCache_()`, `runBillingRateCheck()` — general exclusion added, redundant BTD/SNA carve-out removed |
| `src/10-payroll/PayrollEngine.gs` | Modified | 45 lines changed | `aggregateHours_()` — delegates to shared exclusion + netting; also now exposed on the public API (read-only, RBAC-gated) so `AggregationFixDryRun.gs` can dry-run it — see §3 |
| `src/10-payroll/QuarterlyBonusEngine.gs` | Modified | 46 lines changed | `aggregateQuarterHours_()` — delegates to shared exclusion + netting; combines quarter's 3 months before aggregating |
| `src/11-reporting/ClientTimesheetEngine.gs` | Modified | 40 lines changed | `buildHoursMap_()`, `buildWorkLogEntries_()`, `runWorkLogDiagnostic()` — consolidated onto the shared predicate |
| `src/12-migration/AggregationFixDryRun.gs` | **New** | +142 | This promotion's own read-only dry-run tool — see §3 |

**8 files, 3 new + 5 modified.** `DanglingCorrectionGuard.gs` is no longer
in this list — see "Dropped from this promotion" below.

**Associated Jest test files** (not deployed to Apps Script — regression
coverage, part of the reviewable delta conceptually, not part of the
`clasp push` payload):
`tests/work-log-exclusion.test.js` (9), `tests/work-log-aggregation.test.js`
(10), `tests/shared-aggregation-guard.test.js` (25). **44 tests total.**

### Dropped from this promotion (2026-07-23 revision)

Preparing the actual PR against `main` surfaced that this branch's full
diff is 30 files, not 9 — the 21 extras included the entire bonus-run
layer. Three items dropped as a result, all per your explicit direction:

1. **`DanglingCorrectionGuard.gs` + `dangling-correction-guard.test.js` —
   deferred, not shipped inert.** The original plan ("ships as inert,
   correctly-tested code") assumed only the 9-file scope. The full diff
   showed it has *two* real dependencies on the out-of-scope bonus-run
   layer: its only caller **and** its runtime dependency
   (`bpcGetActiveMarker_()`) both live in `BonusPeriodCommit.gs`, and its
   own unit tests can't load without that file present — so there was no
   way to promote it that didn't either drag `BonusPeriodCommit.gs` along
   (reopening the whole bonus-run-layer question) or ship it with no
   working tests on the deployed branch. It ships with whichever future
   promotion includes the bonus-run layer instead, where it will have both
   a real caller and working tests. `ADR-WL-005`/`ADR-BONUS-001` updated
   to reflect "deferred," not "ships inert."
2. **DEV-only diagnostics excluded, not just gated.**
   `CrossPartitionCorrectionAudit.gs`, `DevEnvironmentInspector.gs`,
   `PayrollHardeningDevSeed.gs`, `PayrollHardeningRecompute.gs`, and the
   one-line `DAL.gs` `WRITE_PERMISSIONS` entry for
   `PayrollHardeningDevSeed` are not part of this promotion branch at all.
   `PayrollHardeningDevSeed.gs` writes synthetic rows to `FACT_WORK_LOGS`;
   it's `Config.isDev()`-gated today, but structural absence from PROD is
   a stronger guarantee than a runtime gate for a script with that write
   surface — same reasoning as `testing-policy.md`'s post-2026-07-08
   contamination rules.
3. **`appsscript.json`'s `executionApi` change — investigated, excluded.**
   `executionApi` configures the Apps Script Execution API — what
   `clasp run` and the `scripts.run` REST endpoint use. It has no effect
   on manually running a function via the editor's dropdown + Run button
   (confirmed by this project's own history: `clasp run` still failed with
   this setting present, and every actual DEV verification this whole
   session — including `runAggregationFixDryRun()`'s DEV run — used the
   manual editor path, which needed no manifest change at all). Since the
   planned execution is exclusively the manual editor run, and `clasp run`
   remains blocked by a separate, unresolved prerequisite regardless, this
   setting provides no benefit and is excluded.

---

## 2. Pre-promotion gate

**Full suite, fresh run, this session:**
```
Test Suites: 16 passed, 16 total
Tests:       339 passed, 339 total
Snapshots:   0 total
```

**`shared-aggregation-guard.test.js`, fresh isolated run, this session:**
```
Test Suites: 1 passed, 1 total
Tests:       25 passed, 25 total
```
This is the test that would fail if any of the 5 modified engine files had
the `migration_batch`/`hours <= 0` pattern reintroduced, or stopped calling
the shared functions — it reads the actual promotion-scoped source files
directly, not a mock.

**Drift check — is this evidence valid for the PROD-bound files, or only
for DEV's copy?** `DRIFT_CHECK.md` confirms all 5 modified files are
byte-identical between PROD's current live source and the `main` baseline
this branch diverged from. There is no PROD-only code path in any of these
5 files that this worktree's copy — and therefore this fresh test run —
doesn't already account for. The gate above is valid evidence for what's
about to be promoted, not just for DEV's local copy.

**Gate: PASS.** 339/339, 16/16 suites, 0 failures, drift = 0.

---

## 3. PROD dry-run step (documented only — NOT executed this turn)

**This is the one point in this promotion where PROD is touched, and it
must not write anything.** Requires your explicit go-ahead, separate from
approval of everything else in this document.

**Revision note (2026-07-23):** the original version of this section
covered `QuarterlyBonusEngine` only. Extended per your explicit instruction
— this promotion includes a `PayrollEngine` fix, and validating only the
bonus engine against real data would leave the payroll fix unverified
against real PROD data shape, the exact gap class this project started
from. `PayrollEngine.aggregateHours_` is now exposed read-only on
`PayrollEngine`'s public API (mirroring the exact precedent
`QuarterlyBonusEngine.aggregateQuarterHours_` already set — a dated comment
on the public return object, no new environment gate on the function
itself), and `AggregationFixDryRun.gs` now calls both engines. **The
previously-stated coverage gap is closed.**

### What runs

`src/12-migration/AggregationFixDryRun.gs`, function `runAggregationFixDryRun()`.
Extended to cover both engines, pushed to DEV, and **verified with a real
DEV run** (see the end of this section) — **not yet run against PROD.**

**Why these calls specifically, and why both are provably read-only:**
- `PayrollEngine.aggregateHours_(periodId)` → `DAL.readAll()` (one month
  partition, a read) → `aggregateNetWorkLogHours(rows)` in
  `WorkLogAggregation.gs` (pure in-memory reduction, no DAL calls at all).
- `QuarterlyBonusEngine.aggregateQuarterHours_(quarter, year)` → `DAL.readAll()`
  (once per month partition, 3x, a read) → the same shared
  `aggregateNetWorkLogHours(rows)`.

Both call graphs confirmed by reading every function involved in full
before writing/extending this file. There is no `DAL.appendRow`,
`DAL.appendRows`, or `DAL.ensurePartition` anywhere in this file or
anything it transitively calls, for either engine. The function prints the
active script ID on every run as a visible confirmation of which project
it's running against.

### Order

1. `runAggregationFixDryRun()` — one call runs everything. For each
   configured quarter (Q1 2026, then Q2 2026, from `AFPD_QUARTERS_`): first
   `PayrollEngine.aggregateHours_()` for each of that quarter's 3 months
   individually (Jan, Feb, Mar for Q1; Apr, May, Jun for Q2 — from
   `AFPD_QUARTER_MONTHS_`, a local month-list map kept independent of
   `QuarterlyBonusEngine`'s own private one, same reasoning
   `DanglingCorrectionGuard.gs` used for its own local copy), then
   `QuarterlyBonusEngine.aggregateQuarterHours_()` once for the whole
   quarter — so the monthly payroll numbers and the quarter's bonus-basis
   total print together and can be sanity-compared by eye.
2. That's the only call. No second function to run.

### Execution mechanism

`clasp run` has been non-functional all session (confirmed repeatedly —
the Apps Script project isn't linked to a standard GCP project; a one-time
manual browser step outside CLI/API reach). The dry-run must be executed
the same way every DEV verification in this effort has been: **open the
Apps Script editor on the target project, select `runAggregationFixDryRun`
from the function dropdown, run it, and copy the full execution log back.**
Before running: visually confirm in the editor which project is open (the
function's own first log line prints the script ID as a second
confirmation).

### What confirms it was read-only

- The call-graph argument above, for both engines (no write call exists in
  either code path — not "didn't happen to write this time," structurally
  cannot).
- The function's own closing log line: `"No writes were made — this
  function calls only PayrollEngine.aggregateHours_() and
  QuarterlyBonusEngine.aggregateQuarterHours_(), both of which only read
  via DAL.readAll()."`
- After running, `runProdContaminationCheck()` (existing, `CLAUDE.md`
  R10.4/testing-policy.md §4) can be run as an independent second check
  that nothing changed — belt-and-suspenders, not required by this
  function's own logic but consistent with this repo's existing PROD
  verification convention.

### DEV verification of this dry-run script itself — DONE

Run manually in the DEV Apps Script editor on 2026-07-23 (script ID
confirmed `1smkj0mmUqcWDDJPq...`, matching `.clasp.dev.json`). Both engines
produced output for both quarters, covering `PHD1`-`PHD4` (Phase 0's seed)
and `DS1` (the reserved DEV-only synthetic actor code — expected, not
contamination). Cross-checked: every actor's three monthly
`PayrollEngine.aggregateHours_()` design-hours figures sum exactly to that
quarter's `QuarterlyBonusEngine.aggregateQuarterHours_()` total, with no
errors and no implausible values. `PHD4`'s QC hours correctly excluded from
the quarterly view — `aggregateQuarterHours_()` only carries `design_hours`
forward, the pre-existing intended bonus-basis definition, not a new
finding. Full log and cross-check detail in `TEST_EVIDENCE.md`.

**This is a precondition satisfied, not the PROD dry-run itself.** The
PROD dry-run (§3 above, run against the PROD script) still requires your
separate, explicit go-ahead, unchanged from before this DEV run.

---

## 4. Rollback plan

**If the dry-run reveals something unexpected** (PROD data shape differs
from DEV's assumptions, an error is thrown, numbers look implausible):

1. **Stop.** Do not proceed to any write — nothing in this promotion
   involves a write regardless, so "stop" here means: do not push the fix
   files to PROD, do not run anything further against PROD, report the
   unexpected finding back before any other action.
2. **No code revert is needed for the dry-run itself** — `runAggregationFixDryRun()`
   made no writes, so there is nothing to undo in `FACT_WORK_LOGS` or any
   other table regardless of what its output shows.
3. **If the dry-run surfaces a real bug** (the fix behaves differently
   against real PROD data than DEV's synthetic/seeded data suggested):
   treat it as a new finding, not a promotion failure to force through —
   return to DEV, reproduce against a DEV fixture shaped like the real PROD
   case if possible, fix, re-test, and re-run this checklist's gate before
   trying the dry-run again.

**If something goes wrong AFTER the fix files are actually pushed to
PROD** (a step this document does not authorize — recorded here so the plan
exists before that step is ever taken):

1. Follow `CLAUDE.md` R7 (Emergency Rollback Procedure) exactly: stop
   further changes, identify the last known good commit, `git revert
   <bad_commit_sha>` (never `--force` or amend), push the revert, redeploy
   via `npm run push:prod`.
2. Because every file in this promotion is a **read/aggregation** fix, not
   a write path — `PayrollEngine`/`QuarterlyBonusEngine`/`BillingEngine`/
   `ClientTimesheetEngine`'s aggregation functions only ever read
   `FACT_WORK_LOGS`, they don't write to it — a bad promotion cannot
   itself corrupt `FACT_WORK_LOGS` or any other FACT table. The worst case
   is a wrong *report/preview/paystub number* being shown, not bad data
   being written. This materially lowers rollback urgency and risk compared
   to a fix that touched a write path — worth stating explicitly since it
   changes how urgently R7 needs to be invoked if something looks off.
3. Verify per R10.4/testing-policy.md §4 after any redeploy: `runHealthCheck()`,
   `runProdContaminationCheck()`, confirm the portal loads.

---

## 5. R10.7 sign-off checklist

What CTO approval covers **specifically for this promotion**, and — as
important — what it explicitly does not:

**Covered by sign-off on this promotion:**
- [ ] The 8-file delta in §1 (exclusion fix + void-netting fix, plus their
      regression tests) may be pushed to PROD via `npm run push:prod` —
      **from a `main` checkout after the promotion branch (§7) is reviewed
      and merged**, following R6's standard pre-deploy checklist
      (`git status` clean, `git log origin/main..HEAD` empty,
      `.clasp.json` matches `.clasp.prod.json`).
- [ ] The dry-run step in §3 may be executed against PROD (a read, not a
      write) — **only if approved separately from the rest of this
      document**, per your explicit instruction.

**NOT covered by sign-off on this promotion — requires separate, later
approval:**
- [ ] Any bonus run of any kind, quarterly or annual, parameterized or
      legacy.
- [ ] Promoting `BonusPeriodEngine.gs`/`BonusPeriodCommit.gs` or any part
      of the parameterized bonus-run layer.
- [ ] Phase 2 (correction workflow) in any form.
- [ ] `DanglingCorrectionGuard.gs` and its test — deferred, not part of
      this promotion at all (§1). Ships with whichever future promotion
      includes the bonus-run layer.
- [ ] The 4 DEV-only diagnostic scripts and the `DAL.gs` write-permission
      entry tied to one of them — excluded from this promotion branch
      entirely (§1).
- [ ] `appsscript.json`'s `executionApi` change — investigated and
      excluded (§1); not needed for the planned manual-editor execution.

**Required before pushing:**
- [ ] This document and `DRIFT_CHECK.md` reviewed and approved.
- [ ] Dry-run step (§3) explicitly approved and run, output reviewed —
      *or* explicitly waived with stated reasoning if you choose to skip
      it (per this session's standing verification-depth rule, a skip
      must be stated, not silent).
- [ ] Standard R6 pre-deploy checklist run immediately before
      `npm run push:prod`.
- [ ] Standard R10.4/testing-policy.md §4 PROD verification run
      immediately after.

---

## 6. CTO pre-approval clarifications (2026-07-23)

Four questions, investigated with actual commands (output shown, not
asserted) before answering. **No push:prod, no PROD execution of any kind
happened while producing this section.**

### 6.1 Merge status — R6's check is currently FAILING, not passing

**This branch is not merged into `main`.** Actual output, run just now:

```
$ git status
On branch payroll-hardening/phase0-exclusion-fix
nothing to commit, working tree clean

$ git log origin/main..HEAD --oneline
c54af9f docs: fold real DEV verification of AggregationFixDryRun.gs into promotion docs
3f7311b docs: Phase 4 promotion planning for the aggregation fix-set (bug fixes only)
597b0a5 fix: resolve ADR-WL-005 cross-partition correction gap; add commit-time dangling-correction guard
1254e09 docs: add verification-depth standing rule to PROJECT_MEMORY.md
54af201 docs: Phase 3 TEST_EVIDENCE + ADR-WL-005/ADR-BONUS-001
a84446f feat: runBonusForPeriod() entry point + dry-run determinism test
062a1b7 feat: parameterized bonus periods (QUARTER/ANNUAL) with commit gating and supersede
edcb017 fix: shared net-hours aggregation — void/amendment corrections were double-counted
692f20c docs: fold real DEV Q1/Q2 recompute results into TEST_EVIDENCE, Phase 0 done
e50bb5f docs: Phase 0 TEST_EVIDENCE update — ClientTimesheetEngine fix, DEV blocker
c53dda4 feat: DEV inspection/seed/recompute tooling for Q1/Q2 regression evidence
9ffc365 fix: wire isMigratedWorkLog() into ClientTimesheetEngine; document ADR-WL-004
0af6e9d docs: Phase 0 TEST_EVIDENCE — predicate TDD, engine wiring, open questions
a8f6b93 fix: wire isMigratedWorkLog() into Payroll/QuarterlyBonus/Billing engines
ad1f075 feat: add shared isMigratedWorkLog() predicate (WorkLogExclusion.gs)
  (15 commits — NOT empty)

$ git log --oneline -5 main
9605d9d feat: dated wrapper to generate July 1-15 2026 client timesheets
9078b53 audit: read-only FACT_JOB_EVENTS origin diagnostic for NORSPAN jobs BLC-00406/BLC-00547
20f0fc2 fix: remove role gate from supervisor ratee lookup — roster assignment is authoritative
c2a8837 feat: read-only DIM_STAFF_ROSTER data-quality dump for rating assignment rewrite
f7617ce fix: rating request preview showed wrong email in [TEST] subject tag

$ git log --oneline -5 HEAD   (this branch)
c54af9f docs: fold real DEV verification of AggregationFixDryRun.gs into promotion docs
3f7311b docs: Phase 4 promotion planning for the aggregation fix-set (bug fixes only)
597b0a5 fix: resolve ADR-WL-005 cross-partition correction gap; add commit-time dangling-correction guard
1254e09 docs: add verification-depth standing rule to PROJECT_MEMORY.md
54af201 docs: Phase 3 TEST_EVIDENCE + ADR-WL-005/ADR-BONUS-001

$ git rev-parse main; git rev-parse origin/main
9605d9dbbded5c08323d8ec67856c511bdad55c7
9605d9dbbded5c08323d8ec67856c511bdad55c7   (identical — local main is not itself stale)
```

`main` and `origin/main` are identical (`9605d9d`). This branch is 15
commits ahead of both, entirely unmerged. **This corrects something I
stated imprecisely in an earlier turn** — I described the R6 pre-deploy
checklist as "already true," when in fact only the `git status` clean
check was true; the `git log origin/main..HEAD` empty check is currently
false.

**What `npm run push:prod` actually deploys from:** `package.json` defines
it as `cp .clasp.prod.json .clasp.json && clasp push --force`. `clasp push`
uploads whatever files currently exist on disk under `rootDir` (`./src`)
**in the working directory the command is run from** — it does not check
out, reference, or care about any particular git branch. It pushes the
literal current file contents of wherever you run it. Run from this
worktree right now, `npm run push:prod` would deploy **this branch's HEAD**
(`c54af9f`), not `main` — confirming your suspicion is the actual mechanism
(the former, not the latter).

**Recommendation: merge to `main` via a PR/review trail before deploying.**
R6's check ("`git log origin/main..HEAD` is empty") only means anything if
deployment happens from a checkout that *is* `main` after a reviewed merge
— it's not a check this repo's tooling enforces mechanically, it's a
precondition CLAUDE.md assumes is already true by the time you run
`push:prod`. Deploying an unmerged feature branch directly would satisfy
none of R6's actual intent (a reviewed, auditable trail before payroll code
goes live) even though nothing in the tooling stops it. Concretely:
`git push origin payroll-hardening/phase0-exclusion-fix`, open a PR into
`main` (`gh pr create`), get it reviewed/approved and merged, **then** run
`push:prod` from a checkout of `main` (or this worktree after merging and
switching to `main`) — not from this feature branch. This gives payroll
code exactly the review trail its risk level warrants, and makes R6's
check actually mean something when it's evaluated.

### 6.2 `AggregationFixDryRun.gs` gating — no `Config.isDev()` gate; the real boundary is Apps Script project access, not in-code RBAC

**Confirmed absent, by grep — no match:**
```
$ grep -n "isDev\|Config\." src/12-migration/AggregationFixDryRun.gs
31:// this file is DELIBERATELY NOT Config.isDev()-gated — its entire
```
The only hit is the header comment explaining the deliberate absence — no
`Config.isDev()` call anywhere in the file. Contrast with
`CrossPartitionCorrectionAudit.gs`, which does have one:
```
$ grep -n "isDev" src/12-migration/CrossPartitionCorrectionAudit.gs
83:  if (!Config.isDev()) {
84:    throw new Error('runCrossPartitionCorrectionAudit() refuses to run outside DEV...');
```

**Walking through what the in-code RBAC check actually does, precisely —
and what it does NOT do:** `runAggregationFixDryRun()` calls
`RBAC.resolveActor(AFPD_ACTOR_EMAIL_)` where `AFPD_ACTOR_EMAIL_` is the
**hardcoded string** `'raj.nair@bluelotuscanada.ca'`. Reading
`RBAC.resolveActor(email)`'s actual body: it takes an email **string
parameter** and resolves permissions for *that string* — it does not call
`Session.getActiveUser()` or inspect who is actually running the script.
This means: **regardless of who physically clicks Run in the Apps Script
editor, the function always resolves and checks permissions as the CEO**,
because the email is hardcoded, not derived from the invoking session. The
`RBAC.enforcePermission(actor, PAYROLL_VIEW)` check that follows will
therefore always pass — it is not gating *who can invoke this function*,
it is only confirming that a fixed, hardcoded identity has view access
(which it always will).

**So what actually prevents someone other than the CEO from running it?**
Not this code. The real boundary is **Apps Script's own project-level
access control** — the Apps Script editor's Run button requires Edit
access to the script project itself, and only whoever has been granted
that access (via the project's Share settings, a Google
Workspace/Drive-level permission, entirely outside this codebase) can even
open the file and see `runAggregationFixDryRun` in the function dropdown.
**I cannot verify the PROD project's current sharing list from any tool
available to me** — that's a fact about Google's sharing settings, not
something visible in source. This should be confirmed independently (Apps
Script editor → Share, or Google Workspace admin console) before treating
"only the CEO can run this" as an established fact rather than an assumed
one.

### 6.3 Triggers — verified negative, source-level; live-PROD-state caveat stated explicitly

**Every trigger-installation call site in the entire `src/` tree,
exhaustively grepped, and every handler function name each one registers:**

| File | Handler function registered |
|---|---|
| `src/setup/Triggers.gs` | `runQueueProcessor`, `onIntakeFormSubmit`, `runDailyHealthCheck`, `runMartRefresh` |
| `src/09-monitoring/PerformanceMonitor.gs` | `runDailyHealthCheck` (comment reference, not an install call in this file) |
| `src/09-notifications/WorkLogReminder.gs` | `runWorkLogReminder` |
| `src/09-notifications/DataIntegrityMonitor.gs` | `runDeadLetterRecovery`, `runDataIntegrityMonitorJob`, `runSendDailyIntegrityDigest`, `runSendWeeklyIntegrityDigest` |
| `src/09-notifications/ExecutionHealthMonitor.gs` | `runHealthMonitorJob` |
| `src/09-notifications/CEODailyBriefing.gs` | `runCEODailyBriefing` |
| `src/09-feedback/ClientFeedbackTrigger.gs` | `onFeedbackFormSubmit` |
| `src/setup/SetupScript.gs` | `refreshDashboardSystem` |
| `src/12-migration/StaceyJobImporter.gs` | `runStaceySyncJob` |
| `src/11-reporting/TimesheetNotifier.gs` | `runCheckTimesheetNotifications` |

**None of these are `aggregateHours_`, `aggregateQuarterHours_`,
`commitBonusForPeriod`, `previewBonusForPeriod`, `runPayrollRun`,
`runBonusRun`, or `runAggregationFixDryRun`.** Also traced every actual
*caller* of the fix-set functions directly (not just trigger
registrations): `aggregateHours_()` is called only from inside
`PayrollEngine.gs` itself (`runPayrollRun`/`runBonusRun`, both CEO-only,
manually invoked per their own docblocks) and from
`AggregationFixDryRun.gs`. `aggregateQuarterHours_()` is called only from
inside `QuarterlyBonusEngine.gs` itself, the DEV-only
`PayrollHardeningRecompute.gs`, and `AggregationFixDryRun.gs`.
`commitBonusForPeriod`/`previewBonusForPeriod` are called from nowhere
outside `BonusPeriodCommit.gs` itself — nothing outside that one file
touches the bonus-commit layer at all, and that whole layer (along with
`DanglingCorrectionGuard.gs`, which depends on it) is out of scope for
this promotion, deferred per §1's revision.

**Stated as a verified negative: no code anywhere in this repository
installs a trigger, direct or indirect, that invokes anything in this
promotion's call graph.** This is a genuine source-level finding, not an
assumption.

**The caveat I can't close from here:** this proves no *installation code*
targets these functions. It does not prove PROD's *live* trigger list is
free of something added manually through the Apps Script UI outside of any
code in this repo — triggers are project state, not source code, and I
have no way to query PROD's actual `ScriptApp.getProjectTriggers()` output
from here (same `clasp run` limitation as everything else this session).
`runListTriggers()` already exists (`src/setup/Triggers.gs:317`, confirmed
read-only — it only calls `console.log`/`listTriggers_()`, no writes) and
would give a live, authoritative answer. Recommend running it in the PROD
editor as a cheap, read-only check alongside — or just before — the actual
dry-run, since you'll already be in that editor.

### 6.4 Code-deployment rollback plan — Apps Script version history vs. git-based redeploy; untested in this repo's history

Two distinct recovery mechanisms exist; neither has been exercised in this
repo's visible history (checked — see below).

**Mechanism A — Apps Script's built-in version history (UI-only, fastest,
independent of git/clasp).** The Apps Script editor has a "See version
history" / clock-icon panel that shows prior saved states of the project
and lets a human restore one directly through the UI, with no terminal or
clasp command involved. `npm run push:prod` is `clasp push --force` only —
it does **not** call `clasp deploy`, so it does not create an immutable
Apps Script "version" in the deployment sense; it only overwrites the live
editable HEAD content. Whether the editor's own autosave-style history
captures a distinct, individually-restorable snapshot for that specific
`clasp push` write is a real Apps Script UI behavior I cannot verify from
here (I have no way to inspect the live PROD project's version-history
panel) — flagging this as unconfirmed rather than asserting it works.

**Mechanism B — git-based redeploy (documented, `CLAUDE.md` R7).** Find
the last known-good commit, `git revert <bad_commit_sha>` (never
`--force`/amend), push the revert, then `npm run push:prod` again **from a
checkout that has the reverted content** — which, per §6.1's finding,
means explicitly checking out/switching to the correct commit or branch
before running it, not assuming "whatever's currently checked out" is
correct. This is the same mechanism R6/R7 already document; §6.1's finding
means it needs to be exercised carefully (confirm which branch/commit is
checked out immediately before `push:prod`), not that it's broken.

**Has either ever been exercised — even in DEV?** Checked directly:
```
$ git log --all --oneline --grep="revert" -i
(no output — zero revert commits anywhere in this repo's history)
```
**No revert has ever been recorded in this repository's git history**, in
DEV or PROD, for this fix-set or anything prior to it. Mechanism B is
documented policy, untested in practice here. I have no way to confirm
whether `npm run push:prod` itself has ever actually been run historically
either — it's a clasp action, not a git action, so it leaves no trace in
`git log` even when it does happen; only the absence of any *revert*
commit is something I can state with certainty.

**Practical implication:** treat R7 as an unexercised procedure the first
time it might actually be needed, not a proven one. If the PROD dry-run
(§3) or anything after this promotion ever requires an actual rollback,
budget for the possibility that Mechanism B's exact steps need to be
worked out carefully in the moment, not just executed from memory.
