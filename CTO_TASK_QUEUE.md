# CTO_TASK_QUEUE.md — Active Workstreams

Running, human-and-Claude-readable log of active cross-session workstreams:
current step, and what's blocked on what. Distinct from `SESSION_LOG.md`
(what happened in a given session) — this tracks task *state* across
sessions, so a fresh session (or a fresh Claude instance) can pick up any
active thread without re-deriving where it left off.

**Update this file at the start and end of every session touching any of
these threads.**

---

## Active

- [ ] **QC assignment mapping** (`DIM_QC_ASSIGNMENTS` + `QCHandler.gs` CC
      logic) — **not started, and do not start yet** (explicit
      instruction, 2026-07-24) — even though Task 2's engineering is
      done, only step 6 of it (below) remains, and that's a business-side
      block, not a technical one blocking Task 3's own start. Wait for
      explicit go-ahead regardless.
      **Design decision recorded (2026-07-24), before design starts:**
      `DIM_QC_ASSIGNMENTS` will be date-ranged from day one — same
      `effective_from`/`effective_to` pattern and the same
      `asOfDate`-parameter approach Task 2 built, not bolted on later.
      Reasoning: QC ratings already feed the quarterly bonus composite
      score, so QC assignment has the identical retroactive-reattribution
      risk `supervisor_code` had. This table doesn't exist yet —
      confirmed via full-repo grep — so this is a greenfield design
      constraint, not a retrofit. **Also recorded:** picking a single
      `asOfDate` isn't automatically correct just for being explicit —
      see `PROJECT_MEMORY.md` §3.2's `getMyRatees()` writeup (two wrong
      intermediate fixes, both caught by real DEV runs) before deciding
      which point-in-time convention `DIM_QC_ASSIGNMENTS` should use.

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
- [x] **Supervisor_code update, effective-dated (Task 2) — implementation
      + DEV verification COMPLETE** — 2026-07-24. Branch
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
      **Remaining before PROD:** promotion PR #3 merged into `main`
      (`e900887`, 2026-07-26) — the code fix-set is now on `main`. Next:
      `npm run push:prod` (separate go-ahead), then the actual two
      `changeSupervisor()` PROD calls for `SYR`/`SVN` (separate go-ahead
      again, after deploy).

      **PROD rollback reference, recorded 2026-07-26 before `push:prod`
      (go-ahead granted):** `clasp versions` against PROD's script ID
      shows 81 saved versions; the latest is **#81, "Version 1July 9"**
      (2026-07-09). **Caveat, stated explicitly per
      `PROMOTION_CHECKLIST.md` §6.4:** `npm run push:prod` is
      `clasp push --force` only — it does **not** create a new Apps
      Script version snapshot. At least one `clasp push` has landed on
      PROD since version #81 was saved (the `Task2Step6PreflightCheck.gs`
      diagnostic, pushed directly from `main` earlier this session), so
      **HEAD already differs from #81** — restoring version #81 via the
      Apps Script editor's UI would undo that push too, not just this
      Task 2 deploy. Per this repo's own established conclusion (§6.4),
      the reliable rollback mechanism here is git-based (`CLAUDE.md` R7:
      `git revert` the bad commit, push, re-run `push:prod` from the
      reverted checkout) — not restoring a version snapshot.
