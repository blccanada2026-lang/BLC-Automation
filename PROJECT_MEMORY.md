# BLC Nexus — Project Memory

> **Read CLAUDE_START_HERE.md first.** This file is the top-level dashboard.
> For deep detail on any section, follow the links to `.claude/context/` files.

---

## 0. Time-Critical

Nothing with a genuine upcoming deadline right now (last reviewed
2026-08-10). The Q2 ratings/feedback/Q1-bonus-letter items that used to
sit here are past their original "end of June" framing and are now
tracked as overdue/status-unknown items in `CTO_TASK_QUEUE.md`'s "Other
Still-Open Items" instead (business/ops bullet) — check there, not here,
for what's actually outstanding. PROD Apps Script ID rotation
(security-flagged 2026-06-22) is explicitly deferred by the user until
the current implementation wave is done — see `CTO_TASK_QUEUE.md` W0-1.

---

## 1. Project Purpose

BLC Nexus (Stacey V3) is the internal operations platform for Blue Lotus Consulting Corporation — a structural design BPO. It replaces the Stacey Google Sheet system and handles: job tracking, work logging, QC, billing, payroll, SOP compliance, and audit trails for 100+ designers across 25+ client accounts.

**Replacement trigger:** Stacey V2 couldn't scale, had no access control, and had no audit trail.

---

## 2. Current System Architecture

Event-driven, queue-based, append-only facts.
```
Portal Submit → STG_PROCESSING_QUEUE → Handler → FACT Table → View Projection
```
- VW_JOB_CURRENT_STATE is a projection, NOT source of truth
- All job state derived from FACT_JOB_EVENTS

→ Full module map, file load order, key tables: `.claude/context/architecture.md`

---

## 3. Critical Business Rules

**Non-negotiable standing rules (CLAUDE.md §CTO Standing Rules):**
- R1 — No Google Forms. Portal only.
- R2 — DEV test actors gated on `Config.isDev()`. Never in PROD logic.
- R3 — `RBAC.enforcePermission()` is first line in every handler.
- R4 — Session-end protocol: git status → summarize → commit only if complete.
- R5 — PROD readiness checklist before any deployment.

→ Full engineering rules: `.claude/rules/engineering-rules.md`
→ Architecture rules: `.claude/rules/architecture.md`

---

## 3.1 Standing Rule — Verification Depth for Money/Aggregation Code

**Origin:** this rule exists because Jest/mock-level tests passed while three real bugs shipped or nearly shipped — the `FACT_WORK_LOGS` migration-exclusion bug (dead `migration_batch` field), the void-netting double-count bug (`hours <= 0` skip), and the cross-partition correction timing gap. Each was only found by reading real engine source and/or running against real DEV data instead of trusting a green mocked test suite.

**Applies to:** any code that reads, aggregates, or writes `FACT_WORK_LOGS`, `FACT_PAYROLL_LEDGER`, or feeds payroll/bonus/billing calculations.

Before marking such work "done" or "tested," explicitly satisfy — or explicitly decline with stated reasoning — each of the following:

1. Have you read the actual current engine source for every consumer of the changed logic (grep for all call sites), not just the ones named in the task?
2. Does test coverage include a run against real DAL read/write behavior (in-GAS DEV runner) in addition to any mocked/Jest tests — not as a substitute for mocks, but as a required addition?
3. Have you checked for other code paths that produce the same kind of row or event (e.g. other fixers/handlers writing `WORK_LOG_VOIDED`, `JOB_MIGRATED`, etc.) that might share the same latent bug?
4. If numbers are being reconciled against a real, known PROD figure, and the working data is DEV/synthetic — has that gap been stated explicitly rather than the numbers being presented as authoritative?

If time pressure means skipping any of these, that must be stated explicitly ("skipping DEV verification because X") rather than silently omitted — a stated shortcut is reviewable, a silent one isn't.

**Second concrete instance, 2026-07-25/26 — a mock/real fidelity gap, not just a missing check.** The Task 2 DEV rehearsal of `StaffOnboarding.changeSupervisor()` (SYR: `BCH -> SDA`) reported `closedRow: true` but the old row was never actually closed — 335 Jest tests were green throughout, including tests that read the mock's own backing store directly (not just the return value). Root cause: `tests/gas-v3-staff-mocks.js`'s `updateWhere` mock matches conditions with `rows[i][k] === conditions[k]` against **plain JS strings** (test fixtures always seed `effective_from: '2025-01-01'` as a string literal) — `===` between two equal strings is `true` regardless of when each was read. The **real** `DAL.gs`'s `matchesConditions_()` matches with loose `!=` against values read from **Google Sheets `getValues()`**, which returns a **fresh `Date` object** for every date-formatted cell on every read — and loose (in)equality between two distinct object instances is reference-identity, never value-equality, so two `Date`s representing the identical date compare as not-equal. The mock could not have caught this: it doesn't merely lack a check, it has no way to reproduce the failure mode at all, because it never models Sheets' Date-object-on-read behavior.

**Generalized takeaway:** a green Jest suite proves the *mocked* interface contract holds, not that the mock's data-type behavior matches the real system's. When a mock simplifies a real system's type behavior (here: strings standing in for what are, in Sheets, Date objects), any bug that depends on that specific type behavior is invisible to the mock by construction, not by oversight — no number of additional assertions against that mock would have caught it. Real DEV verification (§3.1 item 2) isn't just "an extra test," it's the only check that can observe this class of bug at all. If you're modeling a date-formatted column in a mock, ask explicitly: does this mock's equality/matching behavior for this field match what the real backing store would do, not just what the test fixture happens to look like.

**Related, separately tracked:** `matchesConditions_()`'s loose-equality bug itself is not scoped to Task 2 — see the "DAL date-column matching audit" task in `CTO_TASK_QUEUE.md` for the blast-radius investigation across every `updateWhere`/`readWhere` caller in the codebase.

**Third concrete instance, 2026-07-27 — a verification passing for the wrong reason, not just an unproven one.** Task 2's own original DEV recompute (`TEST_EVIDENCE.md`'s Task 2 section) reported supervisor-bonus attribution "correct on the first DEV run, no fix needed" for both a 2026-03 and a 2026-05 check. Discovered later, while cleaning up unrelated DEV roster corruption, that `SEDDS1`'s two rows (`SEDTL1`/`SEDTL2`) had **both stayed open-ended the whole time** — the pre-fix `changeSupervisor()` close-row bug (this same section, second instance above) meant the close silently never happened, despite reporting `closedRow: true`. The 2026-03 result was correct for the right reason (`SEDTL2`'s row wasn't in date-range yet regardless). The 2026-05 result was **correct by accident**: both rows matched the date-range filter simultaneously, `buildStaffCache_` had no duplicate-row guard at the time (added later), so it silently overwrote `cache[code]` on each match — whichever row the array happened to process *last* won, and it happened to be the right one. A differently-ordered read would have silently returned the wrong supervisor, and the recompute would have reported that as confirmed correct too, with identical confidence.

**Generalized takeaway (extending the one above):** it is not enough for a DEV run to *return the expected answer* — that answer must be reachable in a way that's actually a proof, not a coincidence of data shape (row order, which duplicate happens to exist, which branch of an unguarded code path fires). A green DEV result can pass for an accidental reason just as easily as a green Jest result can pass against too-simple a mock. The same day, this recurred a different way: a DEV rehearsal's own "prove the fix works" script accepted any thrown error as proof, when the actual thrown error was a *different* pre-existing guard catching a *different* person's corruption — see `CTO_TASK_QUEUE.md`'s idempotency-fix task for the full incident and the general fix (assert on the specific failure, not just that something failed).

---

## 3.2 Standing Rule — Date-Sensitive Lookups Must Take an Explicit `asOfDate`, Never Implicitly Use "Today"

**Origin:** found twice now in code that determines who a designer reports to. `PayrollEngine.buildStaffCache_()`/`QuarterlyBonusEngine.buildStaffCache_()` resolved `supervisor_code` from whatever `DIM_STAFF_ROSTER` row currently exists, with no date filter at all — meaning a supervisor change made today would retroactively reattribute a re-run of a past month's supervisor bonus to the new TL, not whoever actually supervised that month. `PortalData.getMyRatees(raterEmail, quarterPeriodId, ...)` had the identical gap: it already took `quarterPeriodId` as a parameter, but never used it for the supervisor/PM match — only for an unrelated termination check against `today`. Both fixed 2026-07-24 (Task 2, `payroll/supervisor-effective-dating` branch) by adding an `asOfDate` parameter and SCD-2-style effective-dating (`DIM_STAFF_ROSTER` already has `effective_from`/`effective_to` columns per Rule D4 below — the columns existed, nothing read or wrote them that way).

**Applies to:** any lookup against a dimension table with `effective_from`/`effective_to` (or equivalent) columns, where the result feeds a **period-scoped** calculation (bonus, payroll, rating routing, billing) rather than a real-time action-authorization check.

Before adding or reviewing a lookup like this, ask:

1. Does this function compute something *for a specific period* (a month, a quarter, a date range)? If yes, it must accept that period's date explicitly and filter the dimension table's `effective_from`/`effective_to` against it — never fall through to "whatever's currently true."
2. Is this instead a *real-time* check — "can this actor act right now" (e.g. `RBAC.buildTeamCodes()`, used for live work-log-correction permission)? If yes, current-value-only is correct and should stay that way — don't retrofit date-awareness onto something that's supposed to reflect the present. State explicitly which of the two a given function is, don't leave it ambiguous.
3. If a function already takes a period identifier (like `getMyRatees`'s `quarterPeriodId`) but doesn't use it for a specific field's lookup, that's the exact shape of this bug — a parameter that looks like it should confer date-awareness but silently doesn't.

**A single point-in-time `asOfDate` is not automatically the right fix — a real DEV run caught this for `getMyRatees()` specifically.** "Period-scoped" doesn't mean "pick any one date inside the period and check the range against it" — which single date matters, and a wrong choice can trade one bug for its mirror image:

- Using the period's **start** date wrongly favors whoever was in the role *before* a change — a change effective on day 2 of a 90-day quarter would still attribute the whole quarter to the OLD supervisor, since day 1 (the check date) predates the change.
- Using the period's **end** date wrongly favors whoever took over *right before* the period closed — a change effective 2 days before quarter-end attributes the whole quarter to the NEW supervisor, who covered almost none of it. It also breaks for an **in-progress** period: the end date is in the future, so a change scheduled for later in the period would show as already in effect today, before it's actually happened.

**`getMyRatees()`'s resolution, as an example of the actual tradeoff decision:** `ratingAsOfDate_() = min(period_end, today)` — never look into the future (fixes the in-progress-period problem completely) and accept, as a **documented, known limitation** rather than a silently-wrong result, that a change late in an already-closed period still attributes that whole period to the new party. The more correct alternative — attribute to whichever party covered the *most days* of the period — was named and explicitly deferred as more complexity than this decision currently warrants; build it if the late-period case turns out to matter in practice. Test coverage for exactly this tradeoff (`tests/portal-data-get-my-ratees-effective-dating.test.js`) asserts the late-change behavior explicitly, so a future edit can't silently make it worse without a test failing.

**When applying this pattern elsewhere** (Task 3's `DIM_QC_ASSIGNMENTS` and any future case): don't assume period-start, period-end, or "today" is obviously correct — name the specific business tradeoff each choice makes, the way this one does, before picking one.

---

## 3.3 Business Rule — TL Reporting (`supervisor_code`) and QC Review Are Independent Structures

**Origin:** 2026-07-25. Task 2 step 6's original change list conflated a QC-review relationship from Sarty's original org chart ("Sandy does internal QC for Bharath") with the actual reporting-line business rule, and would have set `SDA.supervisor_code = BCH`. Caught before any write — by the user, not by Claude. The specific failure mode this would have caused: **writing a QC relationship into `supervisor_code` causes incorrect supervisor-bonus payment** — `PayrollEngine.buildSupervisorBonusMap_()` sums a TL's direct reports' `design_hours` by exact `supervisor_code` match (confirmed via code re-read, `src/10-payroll/PayrollEngine.gs`), so setting `SDA.supervisor_code = BCH` would have paid Bharath supervisor bonus on Sandy's own logged design hours — money Bharath was never meant to receive, since he QCs Sandy's work, he does not supervise her.

**The authoritative structure, verbatim as given by the user (Sarty-confirmed, 2026-07-25):**

```
TEAM LEAD (supervisor_code) structure — this is the ONLY thing
supervisor_code encodes:
  BCH (Bharath) -> RKU, MARV        [ONLY these two]
  SDA (Sandy)   -> PBG, SYR
  SVN (Savvy)   -> JYS, BIT, ABB
```

**CORRECTED, 2026-07-27 — the default rule (this reverses the original framing below):** **the supervisor does QC by default.** `QCHandler.gs`'s existing `supervisor_code`-derived rework-notification routing is **correct default behavior, not a gap** — for everyone whose direct `supervisor_code` is a real TL (`PBG`, `SYR`, `JYS`, `BIT`, `ABB`, `MARV`, `RKU`), their QC reviewer is exactly their TL, read directly off `supervisor_code`, and needs no separate table entry.

`DIM_QC_ASSIGNMENTS` (Task 3) therefore holds only the **exceptions and additions** to that default, confirmed 2026-07-27:
```
  BCH reviewed by SDA   [all job types]
  SDA reviewed by BCH   [all job types]
  SVN reviewed by SDA   [all job types]
  RKU reviews everyone, scoped to OPEN_WOOD_FLOOR only   [addition]
```
The three all-type rules exist specifically because `BCH`/`SDA`/`SVN` report to `SGO` (the PM) — the default (CC your `supervisor_code`) can't sensibly apply to them, since QC review by the PM isn't the intended behavior, so peer review among the three TLs is the explicit override for exactly those three. `RKU`'s rule is a pure addition layered on top of whatever the default (or an override) already resolves for `OPEN_WOOD_FLOOR` jobs specifically — it does not remove anyone else's default reviewer. **Whether it adds or replaces, and whether the three all-type rules add to or replace the existing `SGO` supervisor CC for `BCH`/`SDA`/`SVN`, are open business decisions pending Sarty's confirmation** — not decided here, and Task 3's design must make either answer a config choice, not a rewrite.

**What does NOT change from the original finding:** `supervisor_code` must still never be *written* based on a QC relationship — the original incident this section documents (nearly setting `SDA.supervisor_code = BCH` because "Bharath QCs Sandy") remains a real, correctly-caught bug. What's corrected is only the *read* direction: it was wrong to treat `QCHandler.gs` reading `supervisor_code` as the default QC reviewer as itself a violation. It isn't — that's the intended default. The independence that must hold is narrower than originally framed: `supervisor_code` is never *written* from a QC fact, but it **is** legitimately *read* as the default QC reviewer; `DIM_QC_ASSIGNMENTS` layers only the confirmed exceptions/additions on top, and picking the layering semantics (add vs. replace) is a business decision per override, not an engineering default. The reporting tree (`supervisor_code`) must still always stay acyclic (`StaffOnboarding.changeSupervisor()` enforces this — see `wouldCreateCycle_()`, `src/08-staff/StaffOnboarding.gs`) — the QC network is not required to be, and isn't (`BCH` reviewed by `SDA` and `SDA` reviewed by `BCH` is a real, intentional 2-cycle in QC review specifically, which is fine since QC review has no acyclicity requirement).

---

## 3.4 Standing Rule — Never Match on `period_id` as a Cell-Value Condition

**The rule, verbatim:** Never filter/match on `period_id` as a cell-value condition in `readWhere`/`readAll` — use the partition tab-selection mechanism (`options.periodId`) instead. Google Sheets auto-formats `YYYY-MM` strings as `Date` objects on write, so cell-value matches silently fail. This is a system-wide storage artifact, not fixable per-column without a DAL-level change.

**Origin, 2026-07-29** — `PayrollAutomationPmBonusProofB1.gs` (Phase B1, Item 3 DEV rehearsal). `PayrollEngine.runBonusRun()` wrote `PAYROLL_BONUS_SUPERVISOR` rows correctly (confirmed: `TLBT1`/`PMBT1` both credited ₹300, no double-count — the flat PM bonus calculation itself was never in question). The proof script's own verification then reported 3 failures, unable to find those rows via `DAL.readWhere(FACT_PAYROLL_LEDGER, { event_type: 'PAYROLL_BONUS_SUPERVISOR', period_id: '2020-01' }, { periodId: '2020-01' })`. Direct code trace showed the write path and this read agreed exactly on table, `event_type`, and partition — none of the usual suspects (wrong table, wrong event_type, wrong partition name) held up. A diagnostic raw read confirmed the actual mechanism: the stored `period_id` value was `"2020-01-01T06:00:00.000Z"`, not the string `"2020-01"` the condition was comparing against — Sheets had auto-formatted the `"YYYY-MM"`-shaped string as a `Date` on write. `runBonusRun()`'s own return value (built in memory, never re-reading the sheet) was correct throughout; only a *cell-value* re-read of `period_id` was affected.

**Same underlying class as §3.1's second instance** (`matchesConditions_()`'s loose `!=`, reference-identity on `Date` objects) — but a different trigger. That instance was about *reading* a Date-formatted cell and comparing two Date instances. This one is about *writing* a plain string that Sheets itself silently reinterprets as a Date before it's ever stored — the corruption happens at write time, not read time, and affects every partitioned FACT table's `period_id` column identically, since no column anywhere in this codebase (`DAL.gs`, `SetupScript.gs`) is ever explicitly set to plain-text format. **This means the risk is real and system-wide in storage — DEV and PROD alike, since the write path is identical code in both — but it is not currently exploitable anywhere in `src/`**: a full sweep of every `readWhere`/`readAll` call site found exactly one place in the entire codebase that ever filtered on `period_id` as a row condition (the proof script itself, now fixed); every other partition-scoped read relies exclusively on `options.periodId` for tab selection (a JS string used to build a sheet *name*, never written into a cell, never at risk) and then filters by other fields. See the "DAL date-column matching audit" task in `CTO_TASK_QUEUE.md` for the full blast-radius record and the broader latent risk (any *other* date-shaped string field could carry the identical risk if a future caller ever filters on it as a cell value).

---

## 3.5 Standing Rule — Fixed: `ensurePartition()`'s Non-Atomic Header Gap (Aug 2026 Incident Root Cause)

**The rule, verbatim:** As of PR #9 (2026-08-04/05, `fix/ensurepartition-header-gap`, merged to `main`), `DAL.appendRow()`/`DAL.appendRows()` self-heal a blank partition header against canonical `SCHEMAS` before writing — this closed the actual root cause behind the Aug 2026 "My Hours" incident (PRs #7/#8). If you ever see a partition tab with a blank header again, it should now repair itself on the next write rather than requiring a manual incident response. If it doesn't, that's a regression in `DAL.gs` — investigate `getHeadersSelfHealing_()` first.

**Root cause, for context:** `ensurePartition()` creates a new partition tab via `insertSheet()` then populates its header via a *separate* `setValues()` call. An interruption between the two (timeout, quota error, anything) left the tab existing with a permanently blank header — and the early-return "already exists" check only verified the tab's *name*, never its headers, so it never self-healed. `objectToRow_()` maps every write against that blank (0-column) header, so every field of every row was silently discarded. This is exactly how `FACT_WORK_LOGS|2026-08`/`FACT_QC_EVENTS|2026-08` broke for four days before anyone noticed — every designer/QC submission against them failed and dead-lettered, `DEAD_LETTER_QUEUE` preserved the payloads so nothing was permanently lost, but "My Hours" showed nothing until the fix and a manual replay (31 items, 59.75 recovered hours) landed.

**Why the fix lives in `appendRow`/`appendRows`, not just `ensurePartition()`:** most real FACT writers (migration/recon fillers, payroll/billing engines) write against an already-provisioned partition without calling `ensurePartition()` again first — so `appendRow`/`appendRows` is the one path every FACT write actually goes through regardless of caller discipline. `ensurePartition()`'s own early-return path also self-heals, as defense-in-depth, but it is not the load-bearing guarantee.

**Two related fixes, same PR:** (1) self-healing as above; (2) a brand-new partition's header now comes directly from canonical `SCHEMAS`, never copied from whichever sibling tab happens to be found first in tab order — the mechanism that separately let some `FACT_QC_EVENTS` partitions be born missing `qc_session_id` after it was added to `SCHEMAS` (a real, confirmed, latent finding from the 2026-07-27 full PROD partition-header scan, see the "Partition headers silently diverge" task history in `CTO_TASK_QUEUE.md`).

**Deliberately NOT auto-fixed:** a *non-blank* header that merely differs from canonical (e.g. an older partition missing a newer column) is only logged (`WARN`), never auto-rewritten — real data rows may already be positionally written against that exact header, so blindly rewriting row 1 risks silently misaligning existing data, which is worse than the drift itself.

---

## 3.6 Standing Business Rule — `client_job_ref` Is Not Unique Per Job; Some Clients Split One Ref Across Two Designers

**The rule, verbatim:** for some client accounts (confirmed example: Matix), the SAME `client_job_ref` legitimately covers two distinct scopes of work — e.g. one ref spanning both a roof design job and a floor design job — each sometimes assigned to a DIFFERENT designer. Any future logic that treats `client_job_ref` (alone, or combined with client/product) as a uniqueness or duplicate-detection key **must** also account for designer assignment, or it will false-positive and block a legitimate second job.

**Origin, 2026-08-05/06** — surfaced by the user, proactively, before running the DEV rehearsal for the job-create duplicate-prevention fix (PR #14, built in response to Sarty's BLC-00891/BLC-00892 incident — see §8/`CTO_TASK_QUEUE.md`). The first version of the fix's 60-second content-duplicate guard matched only on client+product+description+submitter and would have blocked exactly this legitimate workflow. Fixed by also comparing intended designer: `JobCreateHandler.gs`'s `resolveIntendedDesigner_()` reads a new `_intended_designer` hint that `portal_createJob()` (`Portal.gs`) attaches to the raw submission payload (schema-unrecognized — `ValidationEngine` strips it, so it never affects `cleanPayload`/`VW_JOB_CURRENT_STATE.allocated_to`), falling back to `cleanPayload.allocated_to` for any non-portal caller (SBS intake, migration) that sets it directly on the JOB_CREATE payload itself.

**Applies beyond this one guard** — any future feature that groups, dedupes, or reasons about jobs "by `client_job_ref`" (reporting, billing rollups, timesheet grouping, etc.) should be checked against this pattern before assuming one ref = one job = one designer.

---

## 3.7 Standing Finding — DEV Has No Live (Non-Migrated) `FACT_WORK_LOGS` Data

**The finding, verbatim:** as of 2026-08-06, DEV has zero non-migrated `FACT_WORK_LOGS` rows. Everything in DEV dated before June 2026 is stamped `event_type: WORK_LOG_MIGRATED`/`WORK_LOG_MIGRATION` from the V2→V3 migration and is correctly excluded by `isMigratedWorkLog()` — the same exclusion every timesheet/billing/payroll calculation applies, not a bug. Nothing has been logged live in DEV since. Any feature that reads real work-log hours (timesheets, billing, payroll previews) will return **zero results for any real client/period in DEV**, regardless of how much raw data sits in a `FACT_WORK_LOGS|YYYY-MM` sheet.

**Origin, 2026-08-06** — discovered while trying to DEV-verify the timesheet-for-any-period feature (`GenerateTimesheetPdf.gs`, PR #15) against real DEV data; every attempt against real clients/current-month and even a wide 2026-01-01-to-today range returned 0 entries.

**How to test anything that reads `FACT_WORK_LOGS` in DEV going forward:** don't rely on real client data existing — seed one small synthetic entry instead (`TEST-CLIENT`, a non-migrated `event_type` like `WORK_LOG_SUBMITTED`, a partition after May 2026, e.g. `2026-06`), narrow-filtered reset before and after. See `GenerateTimesheetPdfDevRehearsal.gs`'s `runGenerateTimesheetPdfMechanismProof()` for the pattern. Business-content correctness (does output match a real historical document) still can't be checked this way — that needs PROD.

---

## 3.8 Standing Finding — CTO Architecture/Performance/Tech-Debt Assessment (2026-08-07)

**Full assessment delivered in-conversation, 2026-08-07** (not reproduced here in full — see that session's transcript / `SESSION_LOG.md` entry for the complete 18-section CTO-format writeup). Durable takeaways worth keeping in memory:

1. **`src/12-migration/` is 71 of 160 total `.gs` files (44% of the codebase)** — overwhelmingly one-off incident diagnostics/fixers/importers that have already served their purpose (25 `*Diagnostic/Check/Audit.gs`, 13 `*Importer/ReconFiller.gs`, 6 `*Fixer.gs`, 3 this-session's own `*DevRehearsal.gs`). Single biggest, cheapest technical-debt cleanup opportunity in the codebase. **Not yet acted on** — proposed as "Wave 1," awaiting a systematic caller-trace before any archival.
2. **`src/13-sop/` (3,725 lines, 11 files) is a mature, already-built QC/SOP checklist gate system** — template engine, admin engine, Form/Sheet importer, audit engine, full portal UI (checklist rendering, progress bar, required-item badges). Feature-flagged off by default via Script Properties (`SOP_ENABLED`, `SOP_MODE` WARN_ONLY/BLOCK, `SOP_PILOT_CLIENTS`). **Do not rebuild this if asked for "QC/SOP integration" — it already exists.** Current PROD activation state (is `SOP_ENABLED` on for any client?) is unconfirmed as of this writing — check before assuming it's dormant or live.
   - **Sub-finding, confirmed 2026-08-10 (Wave 2 task W2-2):** `QcFindingTypes.gs` within this module (17-code QC finding taxonomy — structural/process/documentation, seeded into `DIM_QC_FINDING_TYPES`) is fully built as reference data but has **zero consumers anywhere in the codebase** — nothing reads that table. The live QC review flow (`src/06-handlers/QCHandler.gs` + `#modal-qc-review` in `PortalView.html`) only captures coarse `qc_result` (APPROVED/MINOR_REWORK/MAJOR_REWORK/CLIENT_SENT) plus free-text notes — no structured finding-code selection exists. Unlike the SOP checklist gate itself, this piece genuinely needs building, not activating. Scoped as new Wave 2 task W2-3 (findings-picker UI) in `CTO_TASK_QUEUE.md`.
3. **Zero performance instrumentation exists anywhere.** `PerformanceMonitor.gs` measures business health (stuck jobs, error/RBAC-denial log volume, payroll staleness), not latency, query cost, or page-load time. Any future "the portal is slow" investigation starts from zero telemetry — don't optimize based on guesses; add the 3 minimal instrumentation points (entry-point timing, DAL read row-count+elapsed-ms, execution duration, all via the existing `Logger`/`_SYS_LOGS` sink) before touching anything.
4. **Learning Hub and BLC Growth Platform (sales/CRM/marketing) are 100% absent**, confirmed by direct codebase search — genuinely greenfield if ever built. Growth Platform should be a standalone project with narrow integration points, not folded into the Nexus Apps Script project (blast-radius risk to live payroll/billing given `PortalView.html`'s existing size/weight).
5. **Trigger audit (2026-08-07), via `runListTriggers()`, confirmed real state**: 10 triggers were actually live before this session's fixes. Stacey sync trigger confirmed gone (no incident). CEO daily briefing trigger was NOT installed despite being documented as a live daily feature — real doc-vs-reality gap, fixed same day (see §8). A legacy `onIntakeFormSubmit`/`INTAKE_FORM_ID` form trigger in `setup/Triggers.gs` was found NOT installed — investigated and correctly left uninstalled: current SBS intake is 100% portal-button-triggered (`portal_processSbsIntake` → `SheetAdapter.gs` → `STG_INTAKE_SBS`), no form involved. That trigger installer is legacy/pre-refactor and likely predates or violates R1 (No Google Forms) — flagged as a Wave 1 dead-code candidate, not something to revive.

**Two Critical Questions from the assessment remain open** (not yet answered): (a) was the PROD Apps Script project ID rotation (flagged security-urgent 2026-06-22) ever completed? (b) current `SOP_ENABLED` state in PROD?

---

## 4. Database / Sheet / Table Structure

Key tables only. Full list in `.claude/context/architecture.md §Key Tables`.

| Critical tables | Purpose |
|---|---|
| `FACT_JOB_EVENTS` | Append-only job lifecycle events |
| `FACT_WORK_LOGS` | Append-only hours entries (partitioned monthly: `FACT_WORK_LOGS\|2026-05`) |
| `FACT_PAYROLL_LEDGER` | Append-only payroll events |
| `VW_JOB_CURRENT_STATE` | Derived projection — do not write directly except during migration |
| `DIM_STAFF_ROSTER` | Staff profiles; `actor_code` / `person_code` are the canonical IDs |
| `REF_ACCOUNT_DESIGNER_MAP` | Designer→client assignments (source for feedback, NOT FACT_WORK_LOGS) |
| `STG_PROCESSING_QUEUE` | Async write queue |

---

## 5. Completed Work

Major milestones only. Full history: `.claude/context/backlog.md §Completed`.

- Job lifecycle (create → assign → start → QC → invoice)
- Work log submission with SOP enforcement
- QC engine (major/minor rework, client completion emails, QC reassignment)
- Staff onboarding, bulk import, contracts
- Payroll engine (base pay + supervisor bonus + quarterly bonus + annual bonus)
- Client feedback system + TL/PM/CEO ratings + sendRatingRequests
- EventReplayEngine (51 jobs replayed, idempotent)
- MART refresh / Looker Studio reporting (4 MARTs, nightly trigger)
- V2→V3 migration: Jan–May 2026 work logs (2000+ rows), active jobs (168), Stacey auto-sync
- CEO daily briefing email (8 AM CST Mon–Sat via `runCEODailyBriefing`)
- CEO portal: client-grouped collapsible jobs view + grouped QC backlog panel
- **2026-08-06**: Timesheet-for-any-period feature (CEO/HR_ACCOUNTING only) — PR #15, deployed PROD `4c07df5`. Fixed Run Billing's identical `isLeader` UI unreachability bug in the same PR.
- **2026-08-06**: `ADMIN` granted `TIMESHEET_GENERATE` (matches `BILLING_RUN`'s scope) — PR #16, deployed PROD `12d57cc`. Aarthi is onboarded as `ADMIN`, not `HR_ACCOUNTING` — see §8.
- **2026-08-06**: Automatic staff-onboarding email (instructions + real personal portal link, on new hire) — PR #17, deployed PROD `17ef362`. New `StaffOnboardingMailer.gs`, T8.
- **2026-08-10**: Wave 0 performance instrumentation (CTO assessment task W0-2) — PR #20, deployed PROD `0014b58`. Reused existing `HealthMonitor` execution-tracking pattern on the 4 highest-traffic portal reads; new `PerfBaselineReport.gs` reports p50/p95/max per module from real `_SYS_LOGS` data. First real telemetry this codebase has ever had for "is the portal slow." Surfaced a pre-existing `QueueProcessor` 232-second execution outlier as a side effect — see §8.
- **2026-06-16**: PROD cutover complete — Stacey sync removed, staff on V3 portal
- **2026-06-18**: Post-cutover bug fix batch (Sarty's team feedback):
  - RBAC: TEAM_LEAD `QC_APPROVE/REJECT: true`; QC role `JOB_START: true`
  - Handler `job_number maxLength: 30 → 200` — cleared 27 VALIDATION_FAILED + 36 dead-letter items
  - `buildTeamCodes_()` supervisor_code path — TLs now see direct reports
  - BillingEngine added to FACT_JOB_EVENTS WRITE_PERMISSIONS
  - `MigratedQCApprovalFixer` — 121 migrated QC_REVIEW jobs → COMPLETED_BILLABLE
  - Dashboard: DS1/UNKNOWN/BTD/SNA retired codes excluded from all panels
  - DBS role → QC; RKU added to REF_ACCOUNT_DESIGNER_MAP (data fixes by user)

---

## 6. Current Active Work / 7. Pending Work

**Authoritative source: `CTO_TASK_QUEUE.md`** — "Session State" (exactly
where things left off) + "CTO Wave Backlog" (the active multi-wave
program, currently Wave 2 SOP/QC) + "Other Still-Open Items" (everything
else pending, code and business/ops alike). Kept there, not duplicated
here, so there's one place to check instead of two that can silently
drift apart — this section deliberately holds only durable facts unlikely
to change week to week.

- **PROD portal live** ✅ — post-cutover since 2026-06-16, ~17+ staff active (real count has grown since; check `DIM_STAFF_ROSTER` for current).
- **Stacey auto-sync** — ✅ removed at cutover, confirmed still absent from PROD's live triggers as of the 2026-08-07 trigger audit.
- **Client timesheet generator** (fixed-period) — ✅ built; **timesheet-for-any-period** (arbitrary range, CEO/HR_ACCOUNTING/ADMIN) — ✅ built 2026-08-06.
- **Work log correction system** — ✅ shipped (amend/void/reassign, RBAC hierarchy, period-close guard).
- **QC/SOP checklist gate** (`src/13-sop/`) — ✅ fully built, feature-flagged, **`SOP_ENABLED` confirmed off everywhere** as of 2026-08-09. See §3.8.

→ Full backlog: `.claude/context/backlog.md`
→ Cutover sequence: `.claude/context/cutover-plan.md`

---

## 8. Known Risks / Bugs / Open Questions

| Risk | Severity | Status |
|---|---|---|
| Job `260337` duplicate in VW_JOB_CURRENT_STATE | ~~HIGH~~ | **RESOLVED 2026-06-29.** Three VW rows found: 260337 (Roof Truss, AR001), 260337F (I-Joist Floor, SGO), and a spurious 260337 (I-Joist Floor, SGO). Spurious row voided via `runJob260337Fix()`. JOB_DUPLICATE_VOIDED written to FACT_JOB_EVENTS. |
| Client timesheet generator not built | ~~HIGH~~ | **RESOLVED — shipped this sprint.** HTML-to-PDF, all clients, designer summary, product fallback. |
| Full work log dedup (June) | ~~Medium~~ | **RESOLVED.** 6 duplicates (5 Category 1 + 1 ABB) found and voided via `WorkLogDedupFixer`. |
| Q1 FACT_WORK_LOGS has 1,694 duplicate rows | Medium | **STILL OPEN — distinct from the June dedup above.** Root cause: Jan–Mar CSV re-import. Bonus corrected via amendment. Raw data not cleaned yet. |
| **Duplicate NORSPAN client entries** | ~~HIGH~~ | **RESOLVED, confirmed 2026-08-07.** `NorspanClientCodeCheck.gs` (read-only) found: only `NORSPAN-MB` has a real `DIM_CLIENT_MASTER` row; bare `NORSPAN` has 88 jobs, **all voided, zero active today**; `NORSPAN-MB` has 112 active jobs, zero voided; zero job_numbers overlap between the two codes; zero in-code duplicates. Whatever Sarty saw 2026-07-08 (his email cited 55) was already cleaned up by a 2026-07-09 fix (see `ExecutionHealthMonitor.gs`'s `HM_TEST_CLIENT_CODES_` comment) — current state is clean, nothing left to fix. User's separate roof/floor-same-job-number hypothesis was checked directly and did NOT reproduce here (real pattern elsewhere in the system, per §3.6, just not the cause of this report). User confirmed no billing/data-loss concern: the regenerated timesheet (new any-period feature) matched Sarty's manually-sent ones. |
| **`WORK_LOG_PERIOD_FIXED` rows visible in My Hours** | **Medium — new, 2026-07-08** | Sarty sees 0-hour system-maintenance rows ("period_id normalised...") from the period_id fixer in their My Hours view. These are internal maintenance events, not real work entries, and should be filtered out of that view. **Not yet fixed.** |
| 1,448 total FACT_WORK_LOGS → VW orphan job_numbers | Medium | 1,382 pre-cutover (expected — migration artifact, see §11) + 66 post-cutover. Of the 66: 46 resolved via `OrphanJobNumberFixer` (99.75h moved, net zero), 19 remain genuinely orphaned (need manual VW decision), 1 is admin overhead ("job assign & help"). See ADR-WL-001. |
| `submitted_at`/`created_at` bug in `writeQueueItem` | Medium | Identified 2026-07-08. Not yet fixed — needs a follow-up session. |
| Test suite uses real staff identities | Medium | Test runs should use DEV-only synthetic actors, not real staff person_codes — risk of test data touching real staff records. Needs a pass to isolate. |
| Inactive staff security check | Medium | Portal/RBAC access for staff marked `active=FALSE` in DIM_STAFF_ROSTER has not been explicitly re-verified since the active-flag whitelist fix (2026-06-29). |
| BIT designer in FACT_QUARTERLY_BONUS | Medium | CALCULATED, composite 52.19% = same as JYS. Is BIT = Bittuu alias = JYS, or different person? |
| 7 PENDING designers (AVM, PRG, RUD, SKR, SMB, SUB, SUB2) | Medium | All zeros in Q1. Confirm Q1 eligibility. Mark SKIPPED if ineligible. |
| Dead-letter queue items (27 VALIDATION_FAILED) | Low | Fix deployed. Affected staff must resubmit any submissions from before 2026-06-18. |
| Dead-letter queue — full investigation | ~~Low~~ | **RESOLVED.** 1 real blocked job (NORSPAN, Sarty notified — separate from the NORSPAN client-duplicate issue above); 14 historical QC_SUBMIT failures, all pre-existing and resolved by `MigratedQCApprovalFixer`. |
| Apps Script deployment | Low | `clasp push` alone is NOT enough — must also do "New version" redeploy in Apps Script editor for `/exec` URL to pick up changes. Portal redeploy requirement now explicit in R4/R5 checklists. |
| **Billing access wrongly granted to PM** | ~~HIGH~~ | **RESOLVED 2026-08-05 (PR #11).** `RBAC.gs` `PERMISSION_MATRIX.PM.BILLING_RUN` was `true` (superseded design decision) — corrected to `false`; `ADMIN`/`HR_ACCOUNTING` corrected to `true`. Billing is now CEO/ADMIN/HR_ACCOUNTING-only, matching current business intent. |
| **Job-create duplicate (BLC-00891/BLC-00892)** | ~~HIGH~~ | **RESOLVED 2026-08-06 (PR #14).** Root cause: `JobCreateHandler` idempotency keyed on `queue_id` alone, no protection against two genuinely separate submissions. Data fixed via `Job00891DuplicateFixer.gs`; prevention shipped as a 60s content-duplicate guard, designer-aware per §3.6. Deployed to PROD, New Version redeploy confirmed. |
| **Aarthi's real role is ADMIN, not HR_ACCOUNTING** | Low (clarification, not a bug) | **CONFIRMED 2026-08-06.** The real, onboarded Aarthi (person_code `ARN`, email `aarthirajeshnair@gmail.com`) is role `ADMIN` in PROD's `DIM_STAFF_ROSTER`. Note: `tests/rbac.test.js`'s `HR_ACCOUNTING` test fixture also uses the name/email "Aarthi" (`aarthirajeshnair@gmail.com`, person_code `AAR`) — that's a **synthetic test identity from earlier HR_ACCOUNTING RBAC work, not the real person's actual role**. Don't assume "Aarthi" implies `HR_ACCOUNTING` in either code or conversation — check the real roster. `TIMESHEET_GENERATE` was extended to `ADMIN` (PR #16) specifically because of this mismatch. |
| **CEO daily briefing trigger not installed despite being documented as live** | ~~Medium~~ | **RESOLVED 2026-08-07.** `runListTriggers()` audit found `runCEODailyBriefing` absent from PROD's 10 live triggers, though `PROJECT_MEMORY.md` itself described it as a running daily feature. Reinstalled via the pre-existing `runInstallCEOBriefingTrigger()` (idempotent, no code change) — confirmed installed, fires daily ~8 AM CST Mon–Sat. |
| **Legacy `onIntakeFormSubmit` form trigger — not installed, not needed** | Low | **INVESTIGATED 2026-08-07, correctly left alone.** `setup/Triggers.gs`'s `installFormTrigger()`/`INTAKE_FORM_ID` mechanism is absent from PROD's live triggers. Initially looked like a gap (assumed = "SBS intake automation"); investigation showed current SBS intake is 100% portal-button-triggered (`portal_processSbsIntake` → `SheetAdapter.gs` → `STG_INTAKE_SBS`), no form involved. This trigger installer is legacy/pre-refactor and likely predates or violates R1 (No Google Forms). Do not reinstall it — flagged as a Wave 1 dead-code cleanup candidate instead. |
| **`src/12-migration/` is 44% of the codebase, mostly one-off tooling** | Medium (tech debt) | **IDENTIFIED 2026-08-07, not yet acted on.** 71 of 160 `.gs` files. See §3.8 for the full breakdown. Proposed as "Wave 1" — needs a systematic caller-trace (DAL `WRITE_PERMISSIONS` cross-reference + git history per file) before any archival, not a blind purge. |
| **Zero performance instrumentation exists** | Medium (observability gap) | **IDENTIFIED 2026-08-07.** No latency/query-cost/page-load telemetry anywhere — `PerformanceMonitor.gs` only checks business-health signals. "Portal feels slow" has no supporting data yet. See §3.8. |
| **PROD Apps Script project ID rotation status unverified** | **Potentially HIGH — unresolved since 2026-06-22** | Flagged urgent that day (old ID was public since first commit, treat as compromised). Cannot be verified from code — needs the user to confirm directly in the Google Apps Script/Cloud console. |
| **`SOP_ENABLED` current PROD state unverified** | ~~Medium~~ | **RESOLVED 2026-08-09.** User confirmed: off everywhere. Wave 2 is a clean pilot launch, not reviving something stalled. |
| **`QueueProcessor` 232-second execution outlier** | Medium, unconfirmed pattern | **FOUND 2026-08-10**, via `PerfBaselineReport.gs` (built for W0-2, unrelated purpose). `max=231994ms` against `p95≈8.8s` across 2,906+ calls — close to Apps Script's 6-minute execution ceiling. If ever actually hit mid-run, that's a silent partial-processing risk. Single outlier so far in the sample — not yet confirmed as recurring. Not investigated further. |
| **`DIM_QC_FINDING_TYPES` has no production seeding path** | Medium–High (deploy blocker if unaddressed) | **IDENTIFIED 2026-08-11**, W2-3 findings-picker branch's final whole-branch review. The table is now load-bearing for QC rework (`QCHandler.gs` validation added on this branch), but `runFullSetup` only creates its header row — the only callers of `QcFindingTypes.seed()` anywhere in `src/` are test files, no PROD entry point exists. If unseeded in the deploy target, every MINOR_REWORK/MAJOR_REWORK QC submission is silently rejected (empty picker, no explanatory message, no in-UI recovery). Manual seed step required before this feature's PROD deploy — see `CTO_TASK_QUEUE.md` Session State. |
| **SOP upload workflow (`sop-upload-workflow` branch) has five un-actioned live-DEV verification gates** | Medium–High (deploy blocker if unaddressed) | **IDENTIFIED during implementation and the final whole-branch review, 2026-08-13.** (1) `runSetupSchemas()` once, to create `DIM_SOP_UPLOADS`/`FACT_SOP_REVIEW_FEEDBACK` tabs. (2) `runGenerateSopReviewSecret()` once, or `tokenForUpload()` throws. (3) Confirm the deployed web app's access setting — `appsscript.json` says `MYSELF`, contradicting known live no-login portal usage, manifest likely stale. (4) Verify `driveFile.setSharing(ANYONE_WITH_LINK, VIEW)` doesn't throw — no prior `setSharing` call exists anywhere in this codebase to confirm the Workspace domain permits external link-sharing; if blocked, every upload fails at creation. (5) Manually exercise a real file upload through the portal UI — the automated test suite constructs blobs server-side and never exercises the actual `google.script.run` file-transport path the plan assumed would work. None done yet — branch not pushed to DEV as of 2026-08-13. See `CTO_TASK_QUEUE.md` W2-4/Session State for the full ordered checklist. |

---

## 9. Important Commands / Scripts

```bash
# Apps Script deployment
clasp push --force                        # force push all 78 files
# Then: Apps Script editor → Deploy → Manage → Edit → New version → Deploy

# Portal URL (updated 2026-06-16)
https://script.google.com/macros/s/AKfycbxAlO81jXcpRnuIuiSoEH6thjh1Ta_9wnrnhgJBT35w7fZrS7XDhT4_CKDDtZ2dohjW/exec

# Script Properties to verify/set in PROD
CEO_BRIEFING_RECIPIENT = raj.nair@bluelotuscanada.ca
PORTAL_BASE_URL        = <the /exec URL above>

# PROD readiness check (run before any deployment)
grep -r "whoAmI\|isDev\|rajeshnair\|rajnaircanada\|nairscanada" src/

# Trigger management (run in Apps Script editor, not clasp)
runInstallCEOBriefingTrigger()    # install 8 AM daily trigger
runRemoveStaceySyncTrigger()      # RUN ON JUNE 16 BEFORE CUTOVER
runInstallQueueTrigger()          # queue processor (every 3 min)
runMartRefreshTrigger()           # nightly MART refresh

# CEO Daily Briefing
runTestCEODailyBriefing()         # dry run — logs HTML, no email
runCEODailyBriefing()             # live run — sends email
```

---

## 10. Testing and Validation Status

- All 10 V3 handler test suites: **50/50 passing** (as of 2026-06-09)
- Suites 1–3: run `runV3Tests_1to3()` (~3 min)
- Suites 4–5: run `runV3Tests_4to5()` (~4 min 36s)
- **6-minute limit** on consumer Apps Script accounts — never run all suites in one call
- `runTestCEODailyBriefing()` — dry run for briefing module

→ Test files: `src/setup/TestHarness.gs`, `src/setup/TestRunner.gs`

---

## 11. Migration Status

→ Full detail: `.claude/context/migration-status.md`

**Current phase: Phase 3 (cutover — June 16)**
- Jan–May 2026 work logs: ✅ complete (2000+ rows)
- June 1–15 work logs: ✅ BATCH-004 complete — 1278.25h, 16 actors fully reconciled (2026-06-15)
- Active jobs: ✅ 168 jobs imported → FACT_JOB_EVENTS
- Stacey auto-sync: running — **remove trigger June 16 before cutover**
- PROD portal: ✅ live since June 15, 17 staff active
- Phase 3 action: June 16 — `runRemoveStaceySyncTrigger()` → cutover email
- Phase 4: first live June payroll from V3 (after Phase 3 verified)

**BATCH-004 idempotency note:** Multiple source rows per job+date deduplicated by idempotency engine. Corrected via WORK_LOG_AMENDED delta events (migration_batch='BATCH-004-HOURS-FIX'). amendment_of and migration_batch columns NOT in FACT_WORK_LOGS|2026-06 header — DAL silently drops them.

**Hard migration rule:** Stop CSV imports the moment any team goes portal-live. No exceptions.

---

## 12. Decisions Made

| Decision | Rationale |
|---|---|
| VW_JOB_CURRENT_STATE written directly during migration | EventReplayEngine hits 6-min timeout on 168 jobs; direct write is acceptable for one-time migration |
| Stacey sync runs parallel (not cutover immediately) | Managers need ~2 weeks to verify portal data before committing |
| Designer→client mapping from REF_ACCOUNT_DESIGNER_MAP (not FACT_WORK_LOGS) | FACT_WORK_LOGS can have gaps; reference map is authoritative for billing/feedback |
| CEO not in DIM_STAFF_ROSTER | RBAC hardcodes CEO email; keeps staff dimension clean |
| All currency stored in INR at persistence layer | Single-currency storage simplifies payroll engine; FX conversion happens at run time |
| Test runner split into 1–3 / 4–5 sub-runners (not full suite) | Consumer Apps Script 6-min limit; can't run all 50 tests in one execution |
| **ADR-WL-001** — job_number normalization guard + net-zero retroactive fixer (not additive amendment) | Handler-level normalization prevents new orphans; net-zero void+resubmit avoids double-counting hours in PayrollEngine.aggregateHours_() (sums by actor_code+period regardless of job_number/event_type). Full ADR: `docs/SOP_DECISIONS.md` |
| **ADR-WL-002** — 16-hour daily cap on work log submissions | Catches data-entry mistakes at submission time rather than in payroll/billing reconciliation weeks later. Full ADR: `docs/SOP_DECISIONS.md` |
| **ADR-WL-003** — closed-job guard blocks work log submission against INVOICED/VOIDED/CANCELLED jobs | Protects billing integrity once a job is invoiced; corrections route through WorkLogCorrectionHandler instead. Full ADR: `docs/SOP_DECISIONS.md` |
| **ADR-JOB-002** — product_code required at job creation, enforced via post-validation guard (not schema `required: true`) | Generic ValidationEngine message isn't actionable for a dropdown-driven submission; product_code drives job_type, SOP template resolution, and timesheet columns downstream. Full ADR: `docs/SOP_DECISIONS.md` |
| Wave 2 SOP pilot: client `NORSPAN-MB`, mode `WARN_ONLY`, starts 2026-08-17 | User's confirmed business input, 2026-08-10, for W2-1. Non-blocking by design (WARN_ONLY) — first real-world signal on checklist completeness before ever considering BLOCK mode. See `CTO_TASK_QUEUE.md` W2-1 for rollout mechanics and the open pre-flight template-existence gap. |
| W2-3 findings-picker: Task 2 (backend) and Task 3 (frontend) must ship to PROD together, same push | `QCHandler.gs` unconditionally rejects MINOR_REWORK/MAJOR_REWORK submissions lacking `finding_codes`; `PortalView.html`'s picker is the only thing that supplies that field from the real UI — deploying the backend alone breaks every live QC rework submission until the frontend follows. |
| W2-3 is the first-ever consumer/writer of `FACT_QC_FINDINGS` | The table (T13 QMS Layer 3) existed in schema only, unwired, until this branch — `portal_getQcFindingTypes()` (first-ever reader of `DIM_QC_FINDING_TYPES`) and `QCHandler.gs`'s write to `FACT_QC_FINDINGS` were both implemented on branch `qc-findings-picker` 2026-08-11 (not yet merged to main or deployed). |
| `DIM_SOP_TEMPLATES.scope_code` is already the product-matching field — no `product_code` column needed | Confirmed 2026-08-13 by directly reading `SopGate.evaluate_()`, not assumed: it reads the job's `product_code` and passes it into `SopDAL.findActiveTemplateForJob(clientCode, productCode)`, which matches against `scope_code` — `scope_code` already *is* the product field; `job_type`/`software` are descriptive metadata only and don't participate in resolution. This corrects an earlier wrong assumption made in the SOP upload workflow's own design spec (`docs/superpowers/specs/2026-08-13-sop-upload-workflow-design.md` initially proposed adding a `product_code` column to `DIM_SOP_TEMPLATES`, based on an incomplete reading — corrected before implementation, see that file's own "Correction" section). Upload-created templates set `scope_code` directly to the product value (`TRUSS`/`OPEN_WOOD_FLOOR`/`I_JOIST_FLOOR`). Worth recording so a future session doesn't repeat the same misunderstanding. |

---

## 13. Do Not Forget

1. **FACT tables are append-only.** Never UPDATE or DELETE. Corrections = new adjustment events.
2. **DAL only.** Never call SpreadsheetApp directly — bypasses WriteGuard + cache + batch.
3. **No Google Forms.** Ever.
4. **RBAC first.** First line in every handler, before anything else.
5. **Idempotency before every FACT write.** Reject duplicates gracefully.
6. **`clasp push` alone is not enough.** Must also deploy new version via Apps Script editor for `/exec` URL to serve new code.
7. **`actor_code` in FACT_WORK_LOGS** — not `person_code`. Use `actor_code` to look up who logged hours.
8. **CEO email** = `raj.nair@bluelotuscanada.ca` (with dot). Also aliased as `blccanada2026@gmail.com`.
9. **June 16: remove Stacey sync trigger before cutover.**
10. **No payroll run until Phase 3 cutover verified.**
11. **Before W2-3 (findings-picker) PROD deploy: confirm `DIM_QC_FINDING_TYPES` is seeded** (`QcFindingTypes.seed(<admin email>)`, idempotent) — no production seeding path exists yet; see §8.
