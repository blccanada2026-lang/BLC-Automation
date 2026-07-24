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

- [ ] **Supervisor_code update, effective-dated (Task 2)** —
      branch `payroll/supervisor-effective-dating` (own worktree,
      `.worktrees/supervisor-effective-dating`, off `main` @ `5def76a`).
      **In progress, DEV verification pending.** Built and Jest-tested
      (322 tests, 17 suites, 0 failures; 2 commits: `e7e1451` implementation,
      `e6d7818` DEV tooling): `StaffOnboarding.changeSupervisor()` (SCD-2
      write), `PayrollEngine`/`QuarterlyBonusEngine`'s own separate
      `buildStaffCache_(asOfDate)` (all 5 known call sites updated),
      `PortalData.getMyRatees()` (quarter-start-date resolution).
      `RBAC.buildTeamCodes()` confirmed correct as-is, left untouched.
      DEV tooling (`SupervisorEffectiveDatingDevSeed.gs`/`...Recompute.gs`)
      pushed to DEV, **not yet run** — next step is for you to run both
      manually in the DEV Apps Script editor and report the log back,
      same process as Task 1.
      **Blocked before step 6 (applying the real business hierarchy
      change):** which "Bharath" and which "Kumar" — still unresolved,
      not assumed (see the 2026-07-23/24 user/team-structure
      investigation, separate worktree/branch). Do not apply the real
      Kumar/Sandy/Bharath/Pabby/Savvy/Roy/Joy/Bittu/Abby hierarchy until
      both DEV verification is folded in AND this ambiguity is resolved.
- [ ] **QC assignment mapping** (`DIM_QC_ASSIGNMENTS` + `QCHandler.gs` CC
      logic) — not started. Blocked on: Task 2 completing first.
      **Design decision recorded now, before design starts (2026-07-24):**
      `DIM_QC_ASSIGNMENTS` will be date-ranged from day one — same
      `effective_from`/`effective_to` pattern and the same
      `asOfDate`-parameter approach Task 2 just built, not bolted on
      later. Reasoning: QC ratings already feed the quarterly bonus
      composite score, so QC assignment has the identical
      retroactive-reattribution risk `supervisor_code` had. This table
      doesn't exist yet — confirmed via full-repo grep — so this is a
      greenfield design constraint, not a retrofit.

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
