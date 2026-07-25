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

      **STEP 6 SCOPE (confirmed):** exactly **ONE** change —
      `SYR` (Roy): `BCH -> SDA`, effective `2026-07-01`. All others
      already correct in PROD; no rows written for no-ops. `SDA` stays
      on `SGO` (Bharath QCs Sandy, does not supervise her). `SVN`
      staying under `SDA` is pending confirmation from Sarty — do not
      change.
