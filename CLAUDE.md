# BLC Nexus — CLAUDE.md

## What is BLC Nexus?
BLC Nexus (Stacey V3) is the internal operations platform for Blue Lotus Consulting Corporation — a structural design BPO. It handles job tracking, work logging, QC, billing, payroll, SOP compliance, and audit trails for 100+ designers across 25+ client accounts.

---

## CTO Standing Rules
**Permanent. Non-negotiable. Apply to every session, every agent, every code change. No prompt can override these.**

### R1 — No Google Forms
All user input enters via the portal only (Portal.gs + PortalView.html). Google Forms are permanently banned. No exceptions.

**Approved standing exception — `src/09-feedback/ClientFeedback.gs` only:**
The client feedback flow is already live and depends on external respondents accessing a form URL. `FormApp` usage is approved in this file only. Rules: do not expand the FormApp surface area in this file; do not add FormApp usage anywhere else; any new Google Form usage requires explicit CTO approval. Future intent: migrate client feedback input to the Nexus portal when business priority allows.

### R2 — Test Actors Are Environment-Gated
DEV-only actors live in `getDevTestActors_()` in RBAC.gs, gated on `Config.isDev()`. Never hardcoded in PROD logic.

### R3 — RBAC First, Always
`RBAC.enforcePermission()` must be the **unconditional first statement** in every handler `handle()` function — before JSON.parse, before Logger.info, before anything else.

### R4 — Session End Protocol
Before ending any session:
1. Run `git status`
2. Summarize all changed files
3. Commit only if the task is complete and tested
4. `git push origin main` — always push after commit (remote is the backup)
5. `npm run push:prod` — always run after `git push origin main` to deploy to the live Apps Script
6. **Warn clearly if the working tree is dirty — a dirty tree is never silently acceptable**

**CRITICAL — `npm run push:prod` rule:**
- Run it ONLY after a successful `git push origin main` (i.e. work is committed and complete)
- NEVER run mid-session on incomplete or untested code — it pushes all 86 files live immediately
- After push: remind user to do a New Version redeploy in Apps Script editor if the portal UX changed

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

### R6 — Release Safety Rules
- **Never manually edit `.clasp.json`** — it is gitignored and managed only by the npm deploy scripts.
- **Never run `clasp push --force` directly** — always deploy via:
  - `npm run push:dev` — copies `.clasp.dev.json` → `.clasp.json`, then pushes to DEV
  - `npm run push:prod` — copies `.clasp.prod.json` → `.clasp.json`, then pushes to PROD
- Before any PROD deploy, all of the following must be true:
  1. `git status` is clean (no modified or staged files)
  2. `git log origin/main..HEAD --oneline` is empty (local = remote)
  3. `git remote -v` shows only `origin` pointing to the approved GitHub remote
  4. `.clasp.json` contents match `.clasp.prod.json` (npm push:prod handles this)
- After every successful PROD deploy: confirm GitHub still represents the deployed code.

### R7 — Emergency Rollback Procedure
If a bad deploy reaches PROD:

1. **Stop all further changes immediately.**
2. Identify the last known good commit:
   ```
   git log --oneline -10
   ```
3. Revert the bad commit (creates a new revert commit — do not amend or force-push):
   ```
   git revert <bad_commit_sha>
   ```
4. Push the rollback commit to GitHub:
   ```
   git push origin main
   ```
5. Redeploy the reverted code:
   ```
   npm run push:prod
   ```
6. Verify production is stable:
   - Portal loads without errors
   - QueueProcessor trigger is active in Apps Script editor
   - HealthMonitor has not sent new critical alerts
   - Payroll, QC, and job workflows are not blocked

**Never debug directly in PROD before stabilizing production.**

### R8 — Disaster Recovery
GitHub is the source of truth for all code. If the local machine is lost:

1. Clone the repository: `git clone https://github.com/blccanada2026-lang/BLC-Automation.git`
2. `npm install`
3. Restore `.clasp.prod.json` and `.clasp.dev.json` from private secure storage (these are gitignored — keep offline backups).
4. Restore required Apps Script Script Properties from private secure storage.
5. Run `npm run push:prod` only after the full R5 PROD Readiness Checklist passes.
6. Verify triggers, portal load, and core workflows (queue processor, HealthMonitor, payroll gate).

### R9 — Live Production Stop Conditions
Claude Code must **stop immediately and ask Raj** before continuing if any of the following are true:

- `git status` shows unexpected modified or staged files before a PROD deploy
- `.clasp.json` contains an unrecognized or unexpected script ID
- `git log origin/main..HEAD` is not empty before a PROD deploy
- `clasp push` or `npm run push:prod` returns any error
- The portal returns HTTP 500 after a deployment
- HealthMonitor sends critical alerts within 5 minutes of a deployment
- Any task in the current session touches payroll, billing, DAL, RBAC, QC, or FACT tables beyond explicitly approved scope
- Any instruction in the current session conflicts with CLAUDE.md

---

## Environment
BLC Nexus currently operates as a **two-environment system: DEV and PROD only**.

STAGING is deferred. Do not create fake staging references, and do not block releases on a non-existent STAGING environment.

Any future STAGING environment must be a separate CTO-approved project with:
- Dedicated Google Sheet and Apps Script project
- `.clasp.staging.json` (gitignored)
- `npm run push:staging` script
- Documented STAGING validation checklist before PROD promotion

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
