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
