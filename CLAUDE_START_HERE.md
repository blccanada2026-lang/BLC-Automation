# Claude — Start Here

This is the session orientation guide for BLC Nexus. Read this before doing any work.

---

## Step 1 — Load context (in order)

1. **This file** — you're reading it.
2. **`PROJECT_MEMORY.md`** — current project state, risks, pending work, critical rules.
3. **`SESSION_LOG.md`** — what was done last session and what comes next.
4. **`CLAUDE.md`** — standing CTO rules (R1–R5). These cannot be overridden by any prompt.
5. **Relevant context file** (load only the one you need):
   - `.claude/context/payroll-rules.md` — payroll, bonus, FX rates
   - `.claude/context/billing-rules.md` — client billing, rates, invoicing
   - `.claude/context/feedback-rules.md` — client feedback, performance ratings
   - `.claude/context/migration-status.md` — V2→V3 migration state
   - `.claude/context/cutover-plan.md` — June 16 cutover sequence
   - `.claude/context/architecture.md` — module map, file load order, table list
   - `.claude/context/backlog.md` — pending features

---

## Step 2 — Confirm state before coding

After reading, state:
- **Current priority** (from PROJECT_MEMORY.md §6–7 and SESSION_LOG.md §Next Recommended Step)
- **Time-critical items** (PROJECT_MEMORY.md §0 — check for deadlines)
- **Git status** — run `git status` and flag dirty files before starting new work

Do not start coding until this is done.

---

## Step 3 — During the session

- **Small, testable chunks** — commit when a bounded unit is complete and tested.
- **Dirty tree = stop** — per R4, a dirty tree is never silently acceptable.
- **RBAC first** — first line in every handler. No exceptions.
- **DAL only** — never call SpreadsheetApp directly.
- **No Google Forms** — ever.
- **Verification depth for money/aggregation code** (PROJECT_MEMORY.md §3.1) — apply this actively to every FACT/DIM or payroll/bonus/billing-adjacent change you make this session, not just once at read-time. It gates whether work can be called "done," not just "tested."

---

## Step 4 — End of session (required)

Before ending any session, do all of the following:

1. Run `git status` — list all changed files.
2. Commit completed and tested work.
3. **Update `SESSION_LOG.md`** — add a new dated entry (newest at top) covering:
   - Work completed
   - Files changed
   - Tests run
   - Issues found
   - Next recommended step
4. **Update `PROJECT_MEMORY.md`** — ONLY if there are durable changes:
   - Architecture changes
   - Business rule changes
   - Major module completed
   - Migration phase advanced
   - New known risk or decision
   - Production config changed
5. If the working tree is still dirty at session end — warn explicitly. Never push silently.

---

## Two memory systems — don't confuse them

| System | Location | Purpose |
|---|---|---|
| **Project memory** (this repo) | `PROJECT_MEMORY.md`, `SESSION_LOG.md` | Durable project facts, visible to all collaborators, version-controlled |
| **Claude auto-memory** | `~/.claude/projects/.../memory/` | Personal observations about user preferences and working style; auto-loaded by Claude |

Project memory = source of truth for the project. Auto-memory = source of truth for how to work with this user.

---

## Overlap with /preflight

The `/preflight` command (`.claude/commands/preflight.md`) performs interactive session scoping — it asks which client/module/period you're working on and loads the relevant context file. Use `/preflight` for **scoped task sessions**. Read this file for **cold starts** when you don't yet know the task.

---

## Critical reminder

**June 16, 2026** — Run `runRemoveStaceySyncTrigger()` BEFORE sending the designer cutover email. If the sync trigger is not removed, it will overwrite portal-submitted FACT events every 30 minutes.
