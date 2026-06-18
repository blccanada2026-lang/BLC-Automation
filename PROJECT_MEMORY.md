# BLC Nexus — Project Memory

> **Read CLAUDE_START_HERE.md first.** This file is the top-level dashboard.
> For deep detail on any section, follow the links to `.claude/context/` files.

---

## 0. Time-Critical

| Deadline | Action | Risk if missed |
|---|---|---|
| **ASAP** | Confirm with Sarty: job `260337` — same job entered twice, or two separate jobs? | Billing engine may invoice it twice (two COMPLETED_BILLABLE VW rows) |
| **2026-Q2 (end of June)** | Send Q2 rating requests via portal (Send Rating Requests → `2026-Q2`) | Q2 quarterly bonus lacks rating input |
| **2026-Q2** | Send Q2 feedback requests to clients | Q2 quarterly bonus lacks client feedback |
| **End of June** | Forward Q1 bonus letters — 16 in CEO inbox (blccanada2026@gmail.com) | Designers haven't received their Q1 bonus details |

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

## 6. Current Active Work

- **PROD portal live** ✅ — ~17 staff active, post-cutover bugs resolved as of 2026-06-18.
- **BATCH-004 migration complete** ✅ — June 1–15 timesheets fully reconciled: 1278.25h, all 16 actors balanced.
- **Q1 bonus corrections** — ✅ COMPLETE (2026-06-16). 16 letters in CEO inbox (₹72,231.13 total). Not yet forwarded to designers.
- **Stacey auto-sync** — ✅ Removed (2026-06-16 cutover).
- **Client timesheet generator** — NOT YET BUILT. Data exists (FACT_WORK_LOGS + FACT_BILLING_LEDGER + VW_JOB_CURRENT_STATE). See §7.

---

## 7. Pending Work / Next Steps

Priority order:
1. **Resolve job 260337 duplicate** — confirm with Sarty (same job or two separate), then void/renumber
2. **Forward Q1 bonus letters** — 16 in CEO inbox (blccanada2026@gmail.com), review and forward to designers
3. **Send Q2 rating requests + Q2 feedback requests** — via portal before end of June
4. **Build client timesheet generator** — `generateClientTimesheet(clientCode, periodId)` in new `src/11-reporting/ClientTimesheetEngine.gs`
5. **First June payroll run from V3** — after all active jobs are in correct state
6. **Raw Q1 FACT_WORK_LOGS dedup** — 1,694 duplicate rows not yet cleaned (bonus already corrected via amendment)

→ Full backlog: `.claude/context/backlog.md`
→ Cutover sequence: `.claude/context/cutover-plan.md`

---

## 8. Known Risks / Bugs / Open Questions

| Risk | Severity | Status |
|---|---|---|
| Job `260337` duplicate in VW_JOB_CURRENT_STATE | **HIGH** | Two COMPLETED_BILLABLE rows — billing double-invoice risk. Needs Sarty confirmation before fix. |
| Client timesheet generator not built | **HIGH** | Sarty needs per-job breakdown with designer hours for client invoices — no function exists yet |
| Q1 FACT_WORK_LOGS has 1,694 duplicate rows | Medium | Root cause: CSV re-import. Bonus corrected via amendment. Raw data not cleaned yet. |
| BIT designer in FACT_QUARTERLY_BONUS | Medium | CALCULATED, composite 52.19% = same as JYS. Is BIT = Bittuu alias = JYS, or different person? |
| 7 PENDING designers (AVM, PRG, RUD, SKR, SMB, SUB, SUB2) | Medium | All zeros in Q1. Confirm Q1 eligibility. Mark SKIPPED if ineligible. |
| Dead-letter queue items (27 VALIDATION_FAILED) | Low | Fix deployed. Affected staff must resubmit any submissions from before 2026-06-18. |
| Apps Script deployment | Low | `clasp push` alone is NOT enough — must also do "New version" redeploy in Apps Script editor for `/exec` URL to pick up changes. |

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
