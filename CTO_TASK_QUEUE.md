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

- [ ] **Payroll aggregation fix** — PROD dry-run pending (PR #2 merged,
      deployed `d9c876e`). Next: confirm PROD Apps Script sharing settings,
      then run `runAggregationFixDryRun()` + `runListTriggers()` manually
      in the PROD editor.
- [ ] **Supervisor_code update** (Maruthi onboarding + reporting-line
      changes) — not started. Blocked on: Task 1 completing first
      (sequencing choice, not a technical dependency).
- [ ] **QC assignment mapping** (`DIM_QC_ASSIGNMENTS` + `QCHandler.gs` CC
      logic) — not started. Blocked on: Tasks 1 and 2 completing first.

---

## Completed

(none yet — move items here with a completion date when done)
