# CTO_TASK_QUEUE.md — Active Workstreams

Running, human-and-Claude-readable log of active cross-session workstreams:
current step, and what's blocked on what. Distinct from `SESSION_LOG.md`
(what happened in a given session) — this tracks task *state* across
sessions, so a fresh session (or a fresh Claude instance) can pick up any
active thread without re-deriving where it left off.

**Update this file at the start and end of every session touching any of
these threads.**

**Standing practice, added 2026-07-26:** also update the "Session State"
block immediately below at the end of **every turn**, not just at
session/task boundaries — this is what kept getting lost across a long
session otherwise. Keep it terse (2-4 lines) and overwrite it each turn;
it's a same-turn breadcrumb, not a log. The durable narrative belongs in
each task's own entry below.

**Standing practice, added 2026-07-27 — `push:dev` discipline.** A
memory note alone failed to prevent this twice in one session (see the
"DEV-only rehearsal work" task below for the incident): `clasp push
--force` (what `push:dev`/`push:prod` run) fully **replaces** a
script's deployed content — it does not merge. When a DEV-only
rehearsal/testing branch exists with content beyond `main` (extra
files `main` doesn't have), **the rule, chosen and followed
mechanically, not left to memory:**

> **All `push:dev` calls must originate from the worktree/branch that
> currently has the superset of everything that needs to be in DEV** —
> rebase that branch onto current `main` first if `main` has advanced,
> then push from there. Never run `push:dev` from the primary checkout
> (`main`) while a separate DEV-only branch has content `main` lacks —
> that silently deletes it from DEV. Only resume pushing `push:dev`
> directly from `main` once the DEV-only branch's work is merged into
> `main` or abandoned.

(The alternative considered — "always re-push the DEV-only branch
afterward as a manual follow-up step" — was rejected: it's the same
"remember to do X" shape that already failed twice.)

---

## Session State (last updated: end of turn, 2026-07-29)

**Just completed:** PR #5 (Item 1, RBAC extension for `HR_ACCOUNTING`)
merged and deployed to PROD — verified byte-identical, `HR_ACCOUNTING`
role live. (Mid-deploy, a `push:dev` was accidentally run from the
primary checkout instead of `payroll-automation/phase-b1`, briefly
deleting Items 2-4's DEV-only files — caught and fixed within the same
turn via isolated verification, per the standing `push:dev` rule
above.) Then two rounds of real-DEV debugging on
`PayrollAutomationPmBonusProofB1.gs` (Item 3's rehearsal script, still
on `payroll-automation/phase-b1`, not yet promoted): (1) duplicate
roster rows from a crashed first run — fixed with a full reset-at-start
pattern (`parb1PmBonusReset_()`), same shape as `bpldrReset_()`; (2)
verification couldn't find written bonus rows — root-caused to Google
Sheets auto-formatting the `"YYYY-MM"` `period_id` string as a `Date`
on write, a **new, system-wide, PROD-and-DEV-alike storage artifact**
(zero current blast radius — full sweep found no other code anywhere
in `src/` filtering on `period_id` as a cell-value condition) — fixed
by matching on `event_type` alone within the already partition-scoped
read, plus fixing the reset to also clear `FACT_PAYROLL_LEDGER|2020-01`
(it was clearing `FACT_WORK_LOGS` but not the ledger, causing a false
`processed:0` on re-run). New standing rule recorded:
`PROJECT_MEMORY.md` §3.4. Full detail in the "Payroll automation
build" task entry above.
**Q2 status (unrelated thread, unchanged):** `Q2RatingsPreflightCheck.gs`
still shows **0 of 13** active staff confirmed for `2026-Q2` — blocked
on ratings collection, not code.
**Next action:** none pending from the assistant. `runPayrollAutomation
TimesheetProofB1()` already confirmed passing (9/9). Waiting on the
user to re-run `runPayrollAutomationPmBonusProofB1()` (expecting a
clean 3/3 pass this time) and to run the still-outstanding
`runPayrollAutomationOnboardProofB1()` (status still unconfirmed — not
yet reported run), then to review Phase B1 overall before any PROD
deployment of Items 2-4 or further phases (B2 combined paystub, B3
aggregate gate/payment advice, B4 reminder/UI) begin. Q2 bonus dry-run
remains a separate go-ahead, your call on timing.

---

## Active

- [ ] **Payroll automation build — HR_ACCOUNTING role for Aarthi, combined
      paystub, aggregate confirmation gate, PM bonus flat calc,
      auto-reminder, collapsible My Hours UI.**

      **Investigation phase — complete, 2026-07-27**, branch
      `payroll-automation/investigation` (own worktree, off
      `main`@`58ed600`). Full findings/proposals/build plan/open
      questions/risk register in `PAYROLL_AUTOMATION_ARCHITECTURE.md`
      §1-§4, 6 commits (`0c0ab9e`..`36348e2`). Read-only — no
      code/schema/config touched.

      **Phase B1 (Foundation) — all 4 items complete, 2026-07-28**,
      branch `payroll-automation/phase-b1` (own worktree, off
      `main`@`dafc2b3`), TDD-first throughout, **all pushed to DEV,
      not PROD**. `PAYROLL_AUTOMATION_ARCHITECTURE.md` §5 records what
      was built, per item.

      **Business decision recorded before coding** (§2/§5.1): Aarthi's
      email `aarthirajeshnair@gmail.com`, role `HR_ACCOUNTING`, access
      PREPARE + REVIEW only — no commit authority (payroll commit,
      bonus commit stay CEO-exclusive).

      - **Item 1 — RBAC extension, all three gates, atomic.** New
        `HR_ACCOUNTING` role + 7 new actions
        (`PAYROLL_PREVIEW/COMMIT`, `BONUS_PREVIEW/COMMIT`,
        `APPROVE_ALL_PAYROLL`, `TIMESHEET_GENERATE`, `REPORT_GENERATE`).
        `enforceFinancialAccess(actor, action)` now action-aware,
        100% backward compatible (omitting `action` preserves every
        pre-existing call site's exact CEO/SYSTEM-only behavior).
        Portal's hardcoded `canRunPayroll`/`canApprovePayroll`/
        `canManageStaff` (`role === 'CEO'` checks — exactly the
        anti-pattern `RBAC.gs`'s own header forbids) replaced with
        `RBAC.hasPermission()`. `PAYROLL_RUN` deliberately left
        `false` for `HR_ACCOUNTING` — the existing
        `runPayrollRun`/`runBonusRun`/`approveAllPayroll` aren't
        touched yet, so granting it would show her buttons that then
        fail confusingly (the exact risk #1 the architecture doc's
        own risk register flagged). `StaffOnboarding.gs`'s two
        independently-duplicated `validRoles` lists unified into one
        `VALID_ONBOARD_ROLES_` constant. DEV proof script
        (`PayrollAutomationRbacProofB1.gs`) **run live in DEV by the
        user — 40/40 checks passed**, matching the Jest integration
        test's prediction exactly. **Promoted separately** (PR #5,
        branch `payroll-automation/promote-rbac-hr-accounting`, exactly
        the 8 Item-1 files, no proof script/architecture doc),
        **merged and deployed to PROD, 2026-07-29** — isolated pull
        confirmed all 4 product files byte-identical to `main`,
        `HR_ACCOUNTING` role is now live in PROD. Aarthi has not been
        onboarded yet — that remains the user's own manual step,
        separate from this deploy.
      - **Item 2 — DEV verification of the real onboarding path.**
        Extended the proof script with
        `runPayrollAutomationOnboardProofB1()`: onboards a synthetic
        test person (not Aarthi) through the real
        `StaffOnboarding.onboardStaff()` path, confirms
        `RBAC.resolveActor()` picks up `HR_ACCOUNTING` from the live
        roster row, deactivates the test row after. Pushed to DEV,
        awaiting the user's run.
      - **Item 3 — PM bonus flat calculation.** New
        `PayrollEngine.buildPmBonusMap_()` — flat, roster-wide `INR
        25 × Σ(every non-PM staff member's design hours)`, no
        `supervisor_code`/`pm_code` lookup, not recursive.
        `buildSupervisorBonusMap_` is now TL-only.
        `runBonusRun()` merges both. **The PM bonus calculation logic
        itself has been correct since it was first written and was
        never in question at any point** — confirmed independently
        three separate times (9 Jest tests against mocks; the DEV
        rehearsal's own `runBonusRun()` return value; a real
        `FACT_PAYROLL_LEDGER` readback once the verification bug
        below was fixed). Two real-DEV bugs found and fixed in the
        **rehearsal script** (`PayrollAutomationPmBonusProofB1.gs`),
        2026-07-28/29, neither in product code: (1) duplicate active
        roster rows from a crashed first run — fixed with a full
        reset-at-start (`parb1PmBonusReset_()`, same pattern as
        `bpldrReset_()`), replacing a fragile conditional-deactivate
        that only had to fail once to leave stale state; (2) the
        verification step matched on `period_id` as a cell-value
        condition, which Google Sheets silently auto-formats as a
        `Date` on write for any `"YYYY-MM"`-shaped string — a new,
        **system-wide, PROD-and-DEV-alike storage artifact** (own
        entry added to the "DAL date-column matching audit" task
        below, own standing rule in `PROJECT_MEMORY.md` §3.4) — fixed
        by matching on `event_type` alone within the already
        partition-scoped read (the pattern every other real read in
        this codebase already uses), plus fixing the reset to also
        clear `FACT_PAYROLL_LEDGER|2020-01` (it was clearing
        `FACT_WORK_LOGS` but not the ledger, so a second run's fresh
        work-log seed fed a `runBonusRun()` that immediately skipped
        against leftover idempotency keys from run 1 —
        `processed:0`). Pushed to DEV. **Status: fixed, awaiting the
        user's re-run** (expecting a clean 3/3 this time).
      - **Item 4 — `generateTimesheet(client, startDate, endDate)`.**
        New file `GenerateTimesheet.gs` (deliberately narrower than
        the existing billing-domain `ClientTimesheetEngine.generate()`
        — no PreBillingGate, no PDF/invoice; a general-purpose
        read-only data function). Reuses `isMigratedWorkLog()` and the
        same netting *principle* Task 1 established (not the exact
        `aggregateNetWorkLogHours()` function — wrong granularity for
        a client timesheet, documented precisely in the source
        comment). Handles cross-month partition reads. `firstHalf`/
        `secondHalf(year, month)` loop every active client, with
        correct 28/29/30/31-day month-boundary math. 18 Jest tests.
        DEV proof script caught and fixed a real off-by-one bug **in
        the proof script's own fallback verification code** (wrong
        month-indexing) via the Jest integration test before push —
        not in `secondHalf()` itself, which passed cleanly. Pushed to
        DEV, awaiting the user's run.

      **Test coverage**: 450/450 (381 baseline + 69 new across 8 new
      test files, after the two PM bonus proof-script fix rounds).
      Every proof script verified end-to-end via a Jest integration
      test loading the real production sources together *before* being
      pushed to DEV — none handed off untested.

      **Status by item, 2026-07-29**: Item 1 fully done (DEV-verified,
      promoted via PR #5, live in PROD). Item 4 DEV-verified (9/9).
      Item 3 fixed twice on real DEV findings, awaiting a clean re-run.
      Item 2 still not confirmed run at all. Items 2-3 remain on
      `payroll-automation/phase-b1` only, not yet promoted.

      **Blocked on:** the user re-running
      `runPayrollAutomationPmBonusProofB1()` and running
      `runPayrollAutomationOnboardProofB1()` for the first time, then
      reviewing Phase B1 overall. **No PROD deployment of Items 2-4
      yet** — separate go-ahead required, same promotion discipline as
      Item 1 (PR, drift check, stop for review). §4.4's
      original 10 open questions mostly still apply to *later* phases
      (payment advice format, quarterly/annual double-count marker
      mechanism, etc.) — Phase B1 only resolved the 5 items listed in
      §5.1.

- [x] **`changeSupervisor()` is not truly idempotent — FIXED, MERGED, DEPLOYED TO PROD, 2026-07-27.**
      Shipped together with the bonus-period-layer promotion in PR #4
      (merged `b39f175`), since the fix gates the bonus layer's safety.
      `npm run push:prod` from the primary checkout, 153 files, from
      `main`@`b39f175`. Post-deploy verification via a fresh isolated
      PROD pull confirmed: `StaffOnboarding.gs`, `PayrollEngine.gs`,
      `QuarterlyBonusEngine.gs`, `PortalData.gs` all byte-identical to
      `main` (idempotency fix live); `BonusPeriodEngine.gs`,
      `BonusPeriodCommit.gs`, `DanglingCorrectionGuard.gs` all present
      and byte-identical to `main` (bonus layer live); `DAL.gs`'s
      `FACT_QUARTERLY_BONUS` `WRITE_PERMISSIONS` carries the
      `BonusPeriodEngine` entry. Confirmed absent from PROD (correctly
      excluded, DEV-only tooling): `DevRosterDuplicateCleanup.gs`,
      `Sedds1StaleRowFix.gs`, `BonusPeriodLayerDevRehearsal.gs`.
      `npm run push:dev` run immediately after from the same checkout
      (holds the superset — main content only, no DEV-only rehearsal
      files) to keep DEV in sync; `.clasp.json` restored to DEV in the
      primary checkout, other worktrees' independent `.clasp.json`
      files confirmed untouched/still correct. PROD's pre-deploy Apps
      Script version (81, "Version 1July 9", the version the live
      `/exec` deployment is pinned to) recorded as the rollback
      reference — this deploy doesn't touch `PortalView.html`/`Portal.gs`
      so no New Version redeploy was needed for the `/exec` endpoint.
      Below is the original investigation/fix history, preserved as-is.

      Found 2026-07-27 via a
      DEV rehearsal of the (now-paused) bonus promotion: re-running
      `changeSupervisor()`/`scd2FieldChange_()` with identical arguments
      produced 6 corrupted `DIM_STAFF_ROSTER` rows for a synthetic
      designer, each with `effective_to` **before** its own
      `effective_from` (an inverted/impossible validity window).
      **Root cause:** the idempotency check
      (`String(r.effective_from).trim() !== effectiveDate`) compares a
      Sheets-returned `Date` object against a plain ISO string — never
      matches on real data, only on the Jest mock's plain-string
      fixtures. A third instance of the same mock/real fidelity gap
      documented in `PROJECT_MEMORY.md` §3.1 (Date-object vs string),
      this time inside `scd2FieldChange_`'s own idempotency logic, not
      a `DAL.gs` matching call. Every repeat call closes whatever row
      is currently open (even one a prior identical call just created)
      and appends another — N calls produce N rows, all but the last
      corrupted with the same stale `effective_to`.
      **`PROD confirmed clean 2026-07-27`** (`RosterIntegrityCheck.gs`:
      0 inverted-window rows, 0 person_codes with duplicate open rows,
      across all 35 roster rows) — clean only because
      `Task2Step6Apply.gs`'s pre-write verification aborts a second run
      against a state that no longer matches its hardcoded expectation,
      not because `changeSupervisor()` itself is safe. Any future
      caller without that specific guard is exposed.
      **Fix — TDD-first, on its own branch, NOT the bonus promotion
      branch:**
      1. True idempotency: if the person's current open row already has
         the target `supervisor_code` (or field values, for the
         generic `scd2FieldChange_` case) with the same
         `effective_from`, return a no-op without writing. Normalize
         both sides (Date object or string) to `'YYYY-MM-DD'` before
         comparing — do not repeat the string-vs-Date mistake. Test:
         calling `changeSupervisor()` twice with identical args must
         leave exactly two rows, not three.
      2. Invariant validation in `scd2FieldChange_()`: reject any write
         that would produce `effective_to < effective_from`. Throw,
         naming the person and both dates. Test it.
      3. Extend the duplicate/integrity guard in all four `asOfDate`
         resolution paths (`PayrollEngine.buildStaffCache_`,
         `QuarterlyBonusEngine.buildStaffCache_`,
         `PortalData.resolveRosterAsOf_`, `changeSupervisor`'s own
         open-row check) to also flag `effective_to < effective_from`
         rows — inert for date-range matching today (by coincidence of
         the corrupted values, not by design), but real corruption
         that should surface loudly, not sit silently in a payroll
         table.
      4. The DEV rehearsal seed script itself
         (`BonusPeriodLayerDevRehearsal.gs`, DEV-only branch) is not
         idempotent either — re-running it compounded this exact
         corruption. Make it reset-then-seed, or detect prior seed
         state and refuse, before it's used again.
      **Bonus-period-layer promotion (`payroll-hardening/
      promote-bonus-period-layer`) stays paused until this is fixed and
      re-verified** — it was otherwise fully built and green (see
      Completed section for the promotion's own status).

      **STATUS UPDATE, 2026-07-27 — fix implemented, DEV re-verification in progress.**
      Items 1-4 all implemented on `payroll-hardening/
      changesupervisor-idempotency-fix` (off `main`), TDD throughout —
      7 new tests, RED verified before implementing, GREEN after. Full
      suite 342/342.

      **A false pass was caught mid-verification, worth recording
      precisely.** The first version of the DEV "prove the new guard
      works" script accepted ANY thrown error as proof — the same
      weak-assertion shape as the original hardcoded `closedRow: true`
      bug (checking "did it throw," not "did the *right* thing throw").
      What actually fired was the **pre-existing** duplicate-open-row
      guard catching `SGO`, not the **new** inverted-window guard
      catching the intended `BPLDS1` corruption — a real throw, proof of
      a different bug entirely. Fixed by asserting on the specific error
      content (must name the expected person AND the expected reason),
      and the same tightening applied to every other throw-assertion in
      this test suite that only checked a person's name.

      **`SGO`'s corruption itself was a second real finding, not just
      what exposed the false pass:** the original hardcoded-list DEV
      cleanup (`SupervisorEffectiveDatingDevCleanup.gs`, Task 2) only
      ever covered the nine step-6 codes + `MARV` — never `SGO`, since
      it wasn't in that list. A whole-roster scan
      (`DevRosterDuplicateCleanup.gs`, new) found **10 person_codes**
      with duplicate open-ended rows in DEV, not 9 — the original
      double-seeding root cause (`SetupScript.seedDimStaffRoster_()` raw
      `appendRow` + `SeedStaffImport.gs`/`bulkOnboardStaff()`, both
      uncoordinated) was broader than the earlier hardcoded list
      assumed. Another concrete argument for whole-roster scans over
      hardcoded person-code lists, on top of the one that already
      motivated this rewrite.

      **`SEDDS1` (Task 2's own DEV fixture) was the one AMBIGUOUS case,
      resolved as a known-cause repair, not a guess.** Its two open
      rows (`SEDTL1`/`SEDTL2`, disagreeing supervisor_code) were
      correctly left untouched by the generic safe/ambiguous
      classifier. Root cause confirmed: residue of the pre-fix
      close-row bug — `SEDTL1`'s row was never actually closed when
      Task 2's original DEV rehearsal ran, despite reporting
      `closedRow: true`. `Sedds1StaleRowFix.gs` closes it exactly as
      `changeSupervisor()` should have at the time
      (`effective_to=2026-04-14`), preserving the fixture as
      re-runnable Task 2 test data rather than deleting it. **This also
      revealed Task 2's original DEV recompute passed its 2026-05 check
      for the wrong reason** (last-write-wins array ordering happened
      to pick the correct row, before any duplicate-row guard existed)
      — full writeup in `TEST_EVIDENCE.md`'s Task 2 section and
      `PROJECT_MEMORY.md` §3.1's third instance. Does not invalidate
      PROD — confirmed separately via `RosterIntegrityCheck.gs` (0
      duplicate-open rows across all 35 PROD rows) and the real
      post-fix `SYR`/`SVN` rehearsal and PROD apply.

      **Remaining before promotion resumes:** re-run the corrected
      verification chain in DEV (roster cleanup → corruption-proof →
      seed → resolution check → preview/commit) and confirm all pass
      for the right reason this time.

      **REHEARSAL RESULTS, 2026-07-27 — corrected chain re-run, assessed
      by the user:**
      **PROVEN:**
      - Task 2's effective-dating works under the bonus path (`BPLTL1`
        correctly resolved for `2025-10-01`, not `BPLTL2`).
      - `BonusPeriodCommit` drives `main`'s real `QuarterlyBonusEngine`
        end-to-end — the untested integration point from the original
        investigation is now proven, not just structurally argued.
      - Duplicate-row guard stayed silent on clean data (correct
        negative — no false-positive).
      - Inverted-window guard caught real corruption (`BPLDS1`),
        proven this time with the tightened, specific assertion.
      - Dangling-correction guard ran and found 0 (correct for this
        scenario — no cross-partition corrections were seeded).
      **NOT PROVEN (DEV-tooling gap, not a product-code bug):** actual
      bonus arithmetic with non-zero hours — the commit computed ₹0/0h
      because work-log seeding failed (`appendRow` empty-content error,
      line 226 of `BonusPeriodLayerDevRehearsal.gs`, most likely the
      same `ensurePartition()` headerless-tab issue tracked below).
      **Assessed as not blocking the promotion** — the integration and
      guard behavior were the actual open questions; the arithmetic
      itself is exercised for real by the real Q2 run against PROD's
      actual hours data (see Track B below), not by synthetic DEV
      seeding.

      **Two parallel tracks opened, 2026-07-27:**
      - **Track A (promotion) — COMPLETE.** PR #4 built, verified
        (381/381 tests, exact 16-file diff scope, zero PROD drift),
        opened, and merged by the user (`b39f175`). Deployed to PROD
        the same day — see the FIXED/MERGED/DEPLOYED status above for
        the full deploy + post-deploy verification record. The bonus-
        period layer and the idempotency fix are both now live in PROD.
      - **Track B (Q2 readiness) — BLOCKED ON RATINGS.**
        `Q2RatingsPreflightCheck.gs` confirmed live in PROD and run by
        the user: **0 of 13** active designer/QC staff have a
        `FACT_PERFORMANCE_RATINGS` row for `2026-Q2` yet. Q2's bonus
        cannot run correctly until TL/PM quarterly ratings are actually
        submitted through the portal — this is a data-collection gap,
        not a code gap; nothing to fix here. **Next action:** once
        ratings start coming in, re-run the preflight to track progress
        toward 13/13, then the Q2 dry-run preview is a separate
        go-ahead from the user once ratings are complete (or the user
        decides to proceed with partial ratings).

- [ ] **Partition headers silently diverge from canonical `SCHEMAS`, two
      independent ways — confirmed with real findings, not just a
      theoretical hazard.** Started 2026-07-27 (a real Sheets service
      timeout during the DEV rehearsal, since fixed independently —
      `changeSupervisor()` idempotency task above), then confirmed
      structural via a full PROD partition-header scan the same day.

      **Mechanism A — `ensurePartition()` is not atomic.** (`DAL.gs`):
      creating a new partition tab (`insertSheet()`) and populating its
      header row (`getHeaders_()` + `setValues()`) are two separate
      Sheets API calls. If interrupted between them — a timeout, a
      quota error, anything — the result is a tab that **exists but has
      no header row**, and the early-return "already exists" check
      (`if (existingSheet) return`) only checks the tab *name*, never
      verifies headers are present, so it never self-heals.
      `objectToRow_()` (used by every `DAL.appendRow()`) maps field
      values strictly against row 1 — a blank row 1 means every field
      of every row written is **silently discarded**, write reports
      success, data is gone. Same failure shape as the independently-
      found Jan–May "exists but empty" confusion.

      **Mechanism B — `ensurePartition()` propagates STALE schemas
      forward, confirmed via a real example.** When creating a *new*
      partition, `ensurePartition()` copies headers from whichever
      existing partition tab it finds *first* in tab order — not from
      canonical `SCHEMAS`, not from the most recent partition
      (`DAL.gs`'s header-source loop breaks on first prefix match).
      Real evidence: `qc_session_id` was added to `FACT_QC_EVENTS` in
      `SCHEMAS` on 2026-06-26 (`df1eee8`) — but the `2026-07` partition,
      created *after* that change, still lacks the column, because it
      copied headers from an older sibling tab rather than the current
      canonical definition. So old partitions don't just fail to get
      migrated forward (expected) — brand-new partitions can be born
      already stale.

      **Full-spreadsheet PROD scan completed 2026-07-27**
      (`PartitionHeaderIntegrityCheck.gs`) — 0 blank-header partitions
      (`ensurePartition()`'s Mechanism A hasn't materialized in PROD;
      `FACT_PAYROLL_LEDGER|2026-07` correctly provisioned, does not
      block the bonus promotion). Three real Mechanism-B-class findings:
      1. **`FACT_QC_EVENTS|2026-04/05/06/07`** missing `qc_session_id`.
         Confirmed **latent, not active**: grepped all of `src/` —
         zero live code writes this field (only referenced in the
         unbuilt QMS Layer 2/3 subsystem's forward-declared schema,
         `ADR-QMS-017`). No data has been lost. `QCHandler.gs`'s
         `buildQCEvent_()` (the only live `FACT_QC_EVENTS` writer)
         never includes it.
      2. **`FACT_BILLING_LEDGER|2026-04` and `|2026-06`** have all
         canonical columns present but in a different order (`notes`
         shifted). Confirmed **not a live data-corruption risk**: every
         read/write path to this table (`BillingEngine.gs`,
         `MigrationReplayEngine.gs`) goes through `DAL.appendRow`/
         `readAll`/`readWhere` exclusively — name-based mapping via
         `objectToRow_`/`rowToObject_`, immune to column order. Likely
         mechanism: `BillingEngine.gs`'s `runPatchBillingLedgerSchema()`
         — an explicit one-time migration using raw
         `sheet.insertColumnAfter()` per-tab, the one place that
         manipulates these headers positionally instead of through DAL.
      3. **`FACT_SOP_SUBMISSIONS`** exists in PROD with no `SCHEMAS`
         entry. Confirmed harmless orphan: `git log -S` finds exactly
         one commit (`b2da2f3`, 2026-06-23) whose own message states
         *"Rename FACT_SOP_SUBMISSIONS → FACT_SOP_AUDITS (no handler
         existed, no prod data)"* — the constant was renamed in code,
         but the already-provisioned PROD tab was never cleaned up.
         Zero live references to the old name anywhere in `src/`.

      **Proposed fix, for when this is scoped (not implemented yet):**
      `ensurePartition()`'s early-return path should compare the
      existing tab's headers against canonical `SCHEMAS` (not just
      confirm the tab exists) and either repair or flag a mismatch,
      rather than trusting tab existence alone — this addresses both
      mechanisms at once, since both stem from the same root gap
      (nothing ever re-checks a partition's headers against the
      canonical source after creation).

- [ ] **Task 3 — QC assignment mapping** (`DIM_QC_ASSIGNMENTS` +
      `QCHandler.gs` CC logic) — **unblocked as of 2026-07-26** (Task 2,
      including step 6's PROD write, is now fully complete — see
      Completed section). **Still requires explicit go-ahead before any
      code is written** — do not start on the strength of this file
      alone.

      **Two design decisions already settled — do not re-litigate:**
      1. **Date-ranged from day one** (recorded 2026-07-24): same
         `effective_from`/`effective_to` pattern and the same
         `asOfDate`-parameter approach Task 2 built, not bolted on
         later. Reasoning: QC ratings already feed the quarterly bonus
         composite score, so QC assignment has the identical
         retroactive-reattribution risk `supervisor_code` had. This
         table doesn't exist yet — confirmed via full-repo grep — so
         this is a greenfield design constraint, not a retrofit.
         **Also recorded:** picking a single `asOfDate` isn't
         automatically correct just for being explicit — see
         `PROJECT_MEMORY.md` §3.2's `getMyRatees()` writeup (two wrong
         intermediate fixes, both caught by real DEV runs) before
         deciding which point-in-time convention `DIM_QC_ASSIGNMENTS`
         should use.
      2. **Must replace `QCHandler.gs`'s current `supervisor_code`
         derivation** (recorded 2026-07-25, `PROJECT_MEMORY.md` §3.3):
         `sendReworkNotification_()` (`src/06-handlers/QCHandler.gs`,
         lines ~369/~448) currently CCs rework notifications based on
         `designer.supervisor_code` — the reporting line, not the QC
         review relationship. This is the known, pre-existing gap Task
         3 exists to close: QC review assignment (e.g. "`RKU` QCs
         everyone's `OPEN_WOOD_FLOOR` work," "`SDA` QCs `BCH` and
         `SVN`") is a wholly independent structure from `supervisor_code`
         and must never be inferred from or written to it — see §3.3's
         full TL-vs-QC business rule and its stated failure mode.

- [ ] **Task 4 — Staff lifecycle management** — **not started, do not
      begin** (explicit instruction, 2026-07-25). Promotions/role
      changes, pay-rate changes, account allocation `[SCOPE TBD]`,
      surfaced in portal or as script functions.
      **Depends on:** Task 2's effective-dating foundation —
      `StaffOnboarding.scd2FieldChange_()` (generalized 2026-07-25 from
      `changeSupervisor()`'s SCD-2 mechanism specifically so this task
      can reuse it for role/pay changes instead of duplicating the
      close-old-row/open-new-row write path a third time).
      **Open question:** what "account allocation" means — client-account
      assignment vs portal access provisioning vs something else. Not
      resolved, not guessed at.
      **Also open, surfaced during Task 2's read-only investigation
      (2026-07-25) and directly relevant to this task's scope:** no
      code path currently exists that changes `role` or pay rates
      (`pay_design`/`pay_qc`) on an existing active staff member — the
      only current writes to those fields are at initial onboarding.
      Confirmed via full-repo grep, read-only, not fixed. If/when this
      task adds such a path, it must go through `scd2FieldChange_()`
      (proper SCD-2 row) — a raw `DAL.updateWhere()` on the existing
      open-ended row would silently make the change retroactive to
      every prior period, the exact class of bug Task 2 fixed for
      `supervisor_code`. See `PROJECT_MEMORY.md` §3.2.

- [ ] **DAL date-column matching audit** — `DAL.gs`'s `matchesConditions_()`
      (~line 407) uses loose `!=` for all condition matching. For two
      **object** operands this is reference-identity, not value equality —
      and Google Sheets' `getValues()` returns a fresh `Date` object on
      every read of a date-formatted cell, so matching `updateWhere`/
      `readWhere` conditions on a date column using a value captured from
      an earlier read silently matches **zero rows** (no throw — a
      no-op for `updateWhere`, an empty result for `readWhere`). This is
      the exact root cause of the 2026-07-25 `StaffOnboarding` SCD-2
      close-row bug (fixed in Task 2 by matching on `effective_to: ''`
      instead of the date-typed `effective_from`).
      **Not started, not fixed here — deliberately out of Task 2's
      scope.** Changing `matchesConditions_()`'s comparison semantics
      would alter query behavior for every caller in the system and
      needs its own scoped work, not a side effect of a supervisor_code
      fix.
      **Blast-radius sweep completed 2026-07-26** (read-only, all 243
      `DAL.updateWhere`/`DAL.readWhere` call sites in `src/` reviewed):
      - **242 of 243 sites are SAFE** — every condition matches on a
        plain string/id/enum field (`job_number`, `person_code`,
        `email`, `queue_id`, `event_id`, `client_code`, `status`, etc.).
        Date-typed fields appear constantly but always in the *updates*
        (write) argument, never as a match *condition*.
      - **Zero other sites found matching Date-object-vs-Date-object**
        (the confirmed-broken pattern) anywhere in `src/`.
      - **One lower-confidence finding**: `src/12-migration/
        Job260337DuplicateFixer.gs:184` matches on `created_at` (a
        date-formatted column) using `String(dupeRow.created_at || '')`
        — a **string**, not a raw Date object, unlike the confirmed
        `StaffOnboarding` bug. Per the JS spec, string-vs-Date loose
        comparison *does* coerce (via the Date's `toString()`), so if
        the underlying cell hasn't changed between reads this
        comparison likely still succeeds — this looks like a working
        pattern by coincidence of `Date.toString()` symmetry, not a
        confirmed break. Not verified against a real Sheet; flagged for
        whoever picks up this audit to confirm, not assumed either way.
        If it does fail silently, the consequence is narrow: this
        one-off duplicate-job fixer's VOID would silently not apply
        (and it already checks `result.updated`, so it wouldn't lie
        about that — it just wouldn't fix the duplicate).
      **Bottom line:** the bug class is real but **narrowly exploited**
      — confirmed broken in exactly the one place Task 2 already fixed,
      plus one unconfirmed, likely-harmless case. Not urgent beyond
      that one spot-check; recorded so it isn't silently reintroduced
      elsewhere and so `matchesConditions_()` itself gets fixed
      properly (own scoped task) rather than patched around
      case-by-case forever. See `PROJECT_MEMORY.md` §3.1's second
      instance writeup for the underlying mock-fidelity gap that let
      the original bug through Jest undetected.

      **New confirmed instance, 2026-07-29 — `period_id`, a different
      trigger mechanism than the original finding.** Found via
      `PayrollAutomationPmBonusProofB1.gs` (Phase B1, Item 3 DEV
      rehearsal): `PayrollEngine.runBonusRun()` wrote
      `FACT_PAYROLL_LEDGER` rows correctly (bonus amounts confirmed
      right, no double-count), but a `readWhere` matching on
      `period_id: '2020-01'` as a cell-value condition found nothing.
      Root cause, confirmed via a raw diagnostic read: Google Sheets
      auto-formatted the `"YYYY-MM"`-shaped string as a `Date` on
      **write** — the stored value was
      `"2020-01-01T06:00:00.000Z"`, not the string being compared
      against. This is the *same bug class* as the original
      `matchesConditions_()` finding above, but a **different trigger**
      — that one was about *reading* a Date-formatted cell and
      comparing two `Date` instances (reference-identity); this one is
      about Sheets *silently reinterpreting a plain string as a Date at
      write time*, before `matchesConditions_()` is ever involved.
      Confirmed via direct code read that no column anywhere in this
      codebase (`DAL.gs`, `SetupScript.gs`) is ever explicitly set to
      plain-text format — so this is a **system-wide storage artifact,
      present in DEV and PROD identically** (same write code path in
      both), not something fixable per-column without a DAL-level
      change (e.g. explicit `setNumberFormat('@')` on partition
      creation, or storing period identifiers in a format Sheets won't
      auto-convert).
      **Blast radius, confirmed via a fresh full sweep**: exactly
      **one** place in the entire `src/` tree ever filtered on
      `period_id` as a row condition — the proof script itself (now
      fixed, filters on `event_type` only within the already
      partition-scoped read). Every other partition-scoped read in the
      system relies exclusively on `options.periodId` for tab
      selection (a JS string used to build a sheet *name*, never
      written into a cell, never at risk) — **zero current exploitable
      instances**, but a latent risk for any future caller that adds
      such a filter without knowing this. New standing rule recorded:
      `PROJECT_MEMORY.md` §3.4 — "Never match on `period_id` as a
      cell-value condition; use `options.periodId` for partition
      selection instead." Also worth noting for whoever picks up the
      DAL-level fix: the same Sheets auto-formatting risk could in
      principle apply to *any* other date-shaped string field in the
      system, not just `period_id` — this instance is the second
      confirmed proof that `matchesConditions_()`'s fragility isn't
      limited to the columns already known to be Date-typed.

---

## Completed

- [x] **Payroll aggregation fix (Task 1)** — 2026-07-24. PR #2 merged into
      `main`, deployed to PROD (`d9c876e`). PROD dry-run run and its
      "zero actors for Jan/Feb/Mar/May" result independently verified
      correct (not a bug) via direct `event_type` distribution checks
      against real PROD data — see `TEST_EVIDENCE.md`'s "Task 1 CLOSED"
      section for the full chain. **Open follow-on, not yet a scheduled
      task:** all of Q1 2026 (Jan/Feb/Mar) contains zero rows that would
      count toward payroll under the correct exclusion logic — what this
      means for the already-committed ₹72,231.13 Q1 bonus is held as an
      open hypothesis pending a deliberate discussion, not decided or
      scheduled here.
- [x] **Supervisor_code update, effective-dated (Task 2) — FULLY COMPLETE**
      (implementation, DEV verification, promotion, PROD deploy, and the
      real step 6 PROD write all done) — 2026-07-26. Branch
      `payroll/supervisor-effective-dating` (own worktree). Built,
      Jest-tested (324 tests, 17 suites, 0 failures), and confirmed
      against real DAL behavior in DEV: `StaffOnboarding.changeSupervisor()`
      (SCD-2 write), both engines' `buildStaffCache_(asOfDate)`,
      `PortalData.getMyRatees()`. Real DEV run confirmed correct on the
      final pass: supervisor-bonus attribution (items 2-4) right on the
      first try; `getMyRatees()` (item 5) needed two fix iterations —
      quarter-start then quarter-end both caught wrong by design tracing
      and a real DEV run before landing on `min(quarter_end, today)` —
      full writeup in `TEST_EVIDENCE.md`'s "Task 2" section and
      `PROJECT_MEMORY.md` §3.2. `RBAC.buildTeamCodes()` confirmed correct
      as current-value-only, left untouched.
      **Step 6 (applying the real business hierarchy change) — no longer
      blocked as of 2026-07-25.** Both business confirmations came back
      from Sarty: **Kumar = `RKU`** (Raj Kumar, not `SDA`/Samar Kumar
      Das), **effective date = `2026-07-01`** (start of the current
      quarter). Step 6 itself has **not been executed yet** — resuming
      to confirm the exact person list and DEV-vs-PROD sequencing before
      any `changeSupervisor()` calls run, since the instruction to
      proceed didn't have an attached work list to execute against.

      **CRITICAL CORRECTION, 2026-07-25:** the original step 6 change
      list conflated a QC-review relationship (Sarty's original chart:
      "Sandy does internal QC for Bharath") with the actual reporting
      line, and would have set `SDA.supervisor_code = BCH` — giving
      Bharath supervisor bonus on Sandy's own hours. Caught before any
      write. Authoritative TL-vs-QC business rule now recorded verbatim
      in `PROJECT_MEMORY.md` §3.3.

      **PREFLIGHT RESULTS (PROD, run 2026-07-25, read-only):**
      - `FACT_PAYROLL_LEDGER|2026-07`: exists, 0 rows.
      - `FACT_QUARTERLY_BONUS`: 76 rows total, 0 touching `2026-Q3`.
        => Backdating `supervisor_code` to `2026-07-01` is **not**
        retroactive over any already-computed period.
      - `DIM_STAFF_ROSTER` (one clean row each, `effective_from
        2024-01-01`, `active=true`): `RKU->BCH`, `SDA->SGO`, `BCH->SGO`,
        `PBG->SDA`, `SVN->SDA`, `SYR->BCH`, `JYS->SVN`, `BIT->SVN`,
        `ABB->SVN`, `MARV->BCH` (Maruthi Vadla, DESIGNER,
        `effective_from 2026-07-22`).
      - DEV's roster had duplicate rows for every target code; PROD did
        not. Root cause: `SetupScript.seedDimStaffRoster_()` (raw
        `sheet.appendRow`, bypasses DAL, `2025-01-01` dates) and
        `SeedStaffImport.gs` → `StaffOnboarding.bulkOnboardStaff()`
        (DAL-based, `2024-01-01` dates) are two uncoordinated seed
        paths, neither aware of the other. DEV cleaned via
        `SupervisorEffectiveDatingDevCleanup.gs`. All four `asOfDate`
        resolution paths (`PayrollEngine.buildStaffCache_`,
        `QuarterlyBonusEngine.buildStaffCache_`,
        `PortalData.resolveRosterAsOf_`, `StaffOnboarding.changeSupervisor`)
        now throw loudly on duplicate rows instead of silently picking
        one — since the raw-`appendRow` seed path still exists and could
        reintroduce duplicates to PROD at any time.

      **RESOLVED, 2026-07-26** — confirmed directly by the business
      owner in conversation: `SVN` (Savvy) reports to `SGO` (the PM),
      not `SDA`. Savvy is a TL in his own right; Sandy only performs
      his QC (same pattern as Bharath/Sandy) — same TL-vs-QC
      distinction as §3.3, not a new exception to it.

      **FINAL TL STRUCTURE, authoritative:**
      ```
      SGO (PM) -> BCH, SDA, SVN     [three TLs, peers]
      BCH -> RKU, MARV
      SDA -> PBG, SYR
      SVN -> JYS, BIT, ABB
      ```

      **STEP 6 SCOPE (final):** **TWO** changes, both effective
      `2026-07-01`:
      - `SYR` (Roy): `BCH -> SDA` — **proven in DEV, 2026-07-26.**
      - `SVN` (Savvy): `SDA -> SGO` — **proven in DEV, 2026-07-26.**
      All others already correct in PROD; no rows written for no-ops.
      `SDA` stays on `SGO` (Bharath QCs Sandy, does not supervise her).

      **Process note (2026-07-26):** the `SVN` change above was
      initially introduced in a later conversation turn without any
      statement that Sarty's confirmation had arrived, directly
      contradicting this file's own then-current "pending — do not
      change" text. Treated as a live discrepancy and surfaced before
      acting on it (correct call — confirmed by the user afterward),
      rather than silently proceeding either way. Root cause: the
      confirmation had actually landed in an earlier conversation turn,
      but this file wasn't updated in that same turn, so it went stale
      relative to the live conversation. Standing practice going
      forward: write confirmed scope/status changes into this file in
      the turn they're confirmed, not later.

      **Two bugs found and fixed during the SYR DEV rehearsal
      (2026-07-25/26)** — concrete instances of `PROJECT_MEMORY.md`
      §3.1's verification-depth rule, not just aggregation-code cases:
      1. **Silent close-row failure.** `scd2FieldChange_()`'s close-row
         `DAL.updateWhere()` matched on `effective_from`, a
         date-formatted `DIM_STAFF_ROSTER` column. `DAL.gs`'s
         `matchesConditions_()` uses loose `!=`, which is
         reference-identity for two `Date` objects — Sheets returns a
         fresh `Date` instance on every `getValues()` read, so matching
         a date-typed value captured in an earlier read always fails.
         The close silently updated 0 rows in a real DEV run. 335 green
         Jest tests never caught it because the mock compares
         plain-string fixtures with `===` (works regardless of read
         timing) — a fidelity gap, not a missing assertion. Fixed by
         matching on `effective_to: ''` instead (a genuinely blank cell
         always reads back as primitive `''`). Full writeup:
         `PROJECT_MEMORY.md` §3.1.
      2. **Hardcoded return value.** `scd2FieldChange_()` returned
         `closedRow: true` unconditionally, never checking
         `DAL.updateWhere()`'s actual `{ updated: N }` result — so it
         reported success even while bug (1) silently did nothing.
         Fixed: `closedRow`/`newRowCreated` now derived from DAL's real
         result, and the function throws (naming the person_code and
         actual count) if the close affects zero or more than one row,
         rather than proceeding either way.
      Both caught only by a real DEV rehearsal against actual DAL/Sheets
      behavior — Jest alone reported all-green throughout. Related, not
      fixed here: the "DAL date-column matching audit" task above.

      **DEV rehearsal, BOTH changes (2026-07-26) — CORRECT, step 6's DEV
      verification is COMPLETE:**
      ```
      SYR: BEFORE: BCH, effective_from=2024-01-01, effective_to=(empty)
           AFTER:   BCH, effective_from=2024-01-01, effective_to=2026-06-30  [closed]
                    SDA, effective_from=2026-07-01, effective_to=(empty)     [open]

      SVN: BEFORE: SDA, effective_from=2024-01-01, effective_to=(empty)
           AFTER:   SDA, effective_from=2024-01-01, effective_to=2026-06-30  [closed]
                    SGO, effective_from=2026-07-01, effective_to=(empty)     [open]
      ```
      Exactly one open row per person after each change — both fixes
      confirmed against real DAL behavior in a single DEV run, using the
      same `changeSupervisor()` write path that would run in PROD.

      **PROMOTED AND DEPLOYED, 2026-07-26.** PR #3 merged into `main`
      (`e900887`) — 10 files (product code + direct tests +
      `TEST_EVIDENCE.md` only, DEV-only scripts excluded), drift-checked
      clean against PROD before opening. `npm run push:prod` run from
      the primary checkout on `main`; DEV restored immediately after;
      post-deploy drift check confirmed the fix-set live in PROD
      byte-identical to `main`, zero DEV-only scripts landed.

      **STEP 6 PROD WRITE — COMPLETE, 2026-07-26.** `Task2Step6Apply.gs`
      deployed to PROD (`6779016`) and run by the business owner from
      the PROD Apps Script editor. Pre-write verification passed for
      both `SYR` and `SVN` against the confirmed pre-state; both writes
      confirmed correct: `SYR` (`BCH` closed `2026-06-30`, `SDA` opened
      `2026-07-01`), `SVN` (`SDA` closed `2026-06-30`, `SGO` opened
      `2026-07-01`). Exactly one open row per person, no other
      `person_code` touched. Full record: `TEST_EVIDENCE.md`'s "Step 6
      — PROD apply, COMPLETE" section.

      **Final TL structure, now live in PROD:**
      ```
      SGO (PM) -> BCH, SDA, SVN     [three TLs, peers]
      BCH -> RKU, MARV
      SDA -> PBG, SYR
      SVN -> JYS, BIT, ABB
      ```

      **PROD rollback reference — CORRECTED 2026-07-26.** Apps Script's
      version history (`clasp versions`) is **not a usable rollback
      path for this system, full stop** — its latest saved snapshot
      (`#81, "Version 1July 9"`, 2026-07-09) predates Task 1's
      aggregation-fix deploy (2026-07-25); restoring it would silently
      undo Task 1 along with Task 2. Combined with the fact that
      `npm run push:prod` (`clasp push --force`) never creates a new
      version snapshot, there is no Apps Script version that reflects
      "PROD immediately before this Task 2 deploy" — **git is the only
      source of truth for what's actually deployed to PROD.** This is
      exactly why the "always run `push:prod` from `main` in the
      primary checkout, never from a worktree" rule (R6) is
      **load-bearing, not stylistic** — a worktree-sourced push would
      leave no version-history trail to distinguish it from a `main`
      push after the fact.

      **The real rollback target:** the commit on `main` immediately
      before PR #3's merge commit (`e900887`) — its first parent,
      **`bcb45a8`** ("feat: read-only preflight check for Task 2 step
      6"). Confirmed: `bcb45a8` is a descendant of Task 1's merge
      (`d9c876e`, so post-Task-1) and its `StaffOnboarding.gs` has no
      `changeSupervisor`/`scd2FieldChange_` (so pre-Task-2) — exactly
      the correct pre-Task-2, post-Task-1 baseline.

      **Rollback procedure, if ever needed:**
      1. In the primary checkout (`/Users/rajnair/blc-nexus`):
         `git checkout bcb45a8` (detached HEAD is fine for this one-shot
         push — do not commit anything while detached).
      2. `npm run push:prod` from that checkout.
      3. `git checkout main` to return, then `npm run push:dev` to
         restore DEV in the primary checkout.
      4. Prefer `CLAUDE.md` R7's proper mechanism when time allows
         instead (`git revert` the bad commit on `main`, push, redeploy
         from the reverted `main` — leaves a clean forward-only git
         history rather than a detached-HEAD deploy).
