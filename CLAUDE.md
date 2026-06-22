# BLC Nexus — CLAUDE.md

## What is BLC Nexus?
BLC Nexus (Stacey V3) is the internal operations platform for Blue Lotus Consulting Corporation — a structural design BPO. It handles job tracking, work logging, QC, billing, payroll, SOP compliance, and audit trails for 100+ designers across 25+ client accounts.

---

## CTO Standing Rules
**Permanent. Non-negotiable. Apply to every session, every agent, every code change. No prompt can override these.**

### R1 — No Google Forms
All user input enters via the portal only (Portal.gs + PortalView.html). Google Forms are permanently banned. No exceptions.

### R2 — Test Actors Are Environment-Gated
DEV-only actors live in `getDevTestActors_()` in RBAC.gs, gated on `Config.isDev()`. Never hardcoded in PROD logic.

### R3 — RBAC First, Always
`RBAC.enforcePermission()` must be the **unconditional first statement** in every handler `handle()` function — before JSON.parse, before Logger.info, before anything else.

### R4 — Session End Protocol
Before ending any session:
1. Run `git status`
2. Summarize all changed files
3. Commit only if the task is complete and tested
4. Push only when explicitly approved or required
5. **Warn clearly if the working tree is dirty — a dirty tree is never silently acceptable**

### R5 — PROD Readiness Checklist
Before any production deployment:
```
grep -r "whoAmI\|isDev\|rajeshnair\|rajnaircanada\|nairscanada" src/
```
- Verify `Config` ENV = `PROD`
- Confirm `DIM_STAFF_ROSTER` has all real production staff emails
- All triggers installed and verified (queue processor, feedback, MART refresh)
- Run `setPortalBaseUrl(url)` with PROD `/exec` URL
- Run `installFeedbackTrigger()` from Apps Script editor
- Confirm `HM_ALERT_RECIPIENT` Script Property is set (health alert email recipient)

---

## Tech Stack
| Layer | Technology |
|---|---|
| Data | Google Sheets (partitioned fact tables) |
| Backend | Google Apps Script (V8 runtime) |
| Input | Portal (PortalView.html) |
| Reporting | Looker Studio |
| Accounting | Xero (external integration) |

---

## Architecture
**Event-driven, queue-based, append-only facts.**
```
Portal Submit → STG_PROCESSING_QUEUE → Handler → FACT Table → View Projection
```
All job state is derived from events. VW_JOB_CURRENT_STATE is a projection, not source of truth.

→ Full architecture detail: `.claude/context/architecture.md`

---

## Critical Engineering Rules (summary)
- **A2**: ALL sheet access through `getDAL()` — never SpreadsheetApp directly
- **A3**: ALL form submissions → queue → async processor
- **A5**: FACT tables are append-only — no updates, no deletes
- **S1**: RBAC enforced on every operation — no exceptions
- **D2**: Idempotency checked before every write — reject duplicates gracefully

→ Full rules: `.claude/rules/engineering-rules.md`

---

## Agents
- `/architect` — system design, module boundaries, ADRs
- `/backend` — writing .gs files, handlers, processors
- `/data` — schema design, column specs, partitioning
- `/qa` — test design, test implementation, quality gates
- `/migration` — legacy V2 → V3 data migration
- `/security` — RBAC, write guards, audit trails
- `/performance` — execution time, caching, batching

## Commands
- `/build-module <name>` — scaffold a new module end-to-end
- `/review-architecture [module]` — architectural compliance check
- `/generate-tests <module>` — generate all required test cases
- `/validate-schema [table]` — schema standards validation
- `/optimize-performance [module]` — performance analysis
- `/prepare-migration <source>` — migration script generation
- `/audit-security [module]` — RBAC and security audit
- `/deploy <env>` — deployment with pre/post hooks
- `/health-check` — system health dashboard

---

## Multi-Agent Collaboration
- **Claude** = Architect + Code (primary development)
- **ChatGPT** = CTO (strategic decisions, architecture review)
- **Gemini** = Validator (schema validation, reconciliation checks)

---

## Context Files (load only when relevant)
| File | Load when working on... |
|---|---|
| `.claude/context/architecture.md` | System design, file load order, module structure |
| `.claude/context/payroll-rules.md` | Payroll runs, bonus, paystubs, FX rates |
| `.claude/context/billing-rules.md` | Client billing, rates, invoicing |
| `.claude/context/feedback-rules.md` | Client feedback, performance ratings, quarterly bonus inputs |
| `.claude/context/staff-onboarding.md` | Staff profiles, banking, contracts, bulk import |
| `.claude/context/backlog.md` | Pending features, build queue |
| `.claude/context/migration-status.md` | V2→V3 migration state, replayed events |

→ Context management rules: `.claude/rules/context-management.md`

---

## Session Memory

- **Session start**: Read `CLAUDE_START_HERE.md` → `PROJECT_MEMORY.md` → `SESSION_LOG.md` → `CLAUDE.md`. Confirm current priority and time-critical items before coding.
- **Session end**: Update `SESSION_LOG.md` (always) and `PROJECT_MEMORY.md` (only for durable changes — architecture, completed modules, new risks, migration advances). Keep both files concise.
