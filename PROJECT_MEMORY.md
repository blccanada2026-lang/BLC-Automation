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
- **Client timesheet generator** — ✅ BUILT (HTML-to-PDF, all clients, designer summary, product fallback). See SESSION_LOG.md 2026-06-30→07-08 entry.
- **Work log correction system** — ✅ SHIPPED — amend/void/reassign with RBAC hierarchy + period-close guard, portal UI on My Hours.
- **Work log job_number orphan cleanup** — ✅ 46 of 66 post-cutover orphans resolved (see §7 for the 19 remaining + §12 ADR-WL-001).
- **June billing** — **PENDING**, blocked on Sarty confirmation of the June 06B reconciliation findings (client mis-attribution: BCH, DBS; missing hours: PBG, DBG, AR001) and outstanding designer hour submissions.
- **New Sarty-reported portal issue (2026-07-08, not yet investigated)** — duplicate NORSPAN client entries in the job list, and `WORK_LOG_PERIOD_FIXED` maintenance rows visible in My Hours. See §8.

---

## 7. Pending Work / Next Steps

Priority order:
1. **Investigate Sarty's 2026-07-08 email** — (a) duplicate NORSPAN client entries (plain "NORSPAN" 55 jobs vs. "NORSPAN-MB" 4 jobs — same class of problem as MATIX vs. MATIX-SK); (b) `WORK_LOG_PERIOD_FIXED` system-maintenance rows visible to Sarty in My Hours — need to be filtered from that view. **Not yet investigated as of this entry.**
2. **19 truly orphaned job_numbers** (post-cutover, don't resolve via normalization) — need a manual decision: create VW rows for them, or write them off. See ADR-WL-001.
3. **Admin overhead policy decision** — how should `"job assign & help"`-style non-job hours be tracked going forward? Separate pseudo-job in VW, or excluded entirely from work-log reporting?
4. **Fix `submitted_at`/`created_at` bug in `writeQueueItem`** — identified 2026-07-08, not yet fixed.
5. **Test suite uses real staff identities** — flagged as a risk; needs a DEV-only test actor pass so test runs can't affect real staff data.
6. **Inactive staff security check** — review RBAC/portal access for staff marked inactive in DIM_STAFF_ROSTER.
7. **June billing** — resolve pending on Sarty confirmation + outstanding designer hour submissions, then run first June payroll from V3.
8. **Forward Q1 bonus letters** — 16 in CEO inbox (blccanada2026@gmail.com), review and forward to designers.
9. **Send Q2 rating requests + Q2 feedback requests** — via portal (may be overtaken by events — confirm current quarter status before sending).
10. **Raw Q1 FACT_WORK_LOGS dedup** — 1,694 duplicate rows from Jan–Mar CSV re-import not yet cleaned (bonus already corrected via amendment; distinct from the 6 June duplicates found and voided this sprint).

→ Full backlog: `.claude/context/backlog.md`
→ Cutover sequence: `.claude/context/cutover-plan.md`

---

## 8. Known Risks / Bugs / Open Questions

| Risk | Severity | Status |
|---|---|---|
| Job `260337` duplicate in VW_JOB_CURRENT_STATE | ~~HIGH~~ | **RESOLVED 2026-06-29.** Three VW rows found: 260337 (Roof Truss, AR001), 260337F (I-Joist Floor, SGO), and a spurious 260337 (I-Joist Floor, SGO). Spurious row voided via `runJob260337Fix()`. JOB_DUPLICATE_VOIDED written to FACT_JOB_EVENTS. |
| Client timesheet generator not built | ~~HIGH~~ | **RESOLVED — shipped this sprint.** HTML-to-PDF, all clients, designer summary, product fallback. |
| Full work log dedup (June) | ~~Medium~~ | **RESOLVED.** 6 duplicates (5 Category 1 + 1 ABB) found and voided via `WorkLogDedupFixer`. |
| Q1 FACT_WORK_LOGS has 1,694 duplicate rows | Medium | **STILL OPEN — distinct from the June dedup above.** Root cause: Jan–Mar CSV re-import. Bonus corrected via amendment. Raw data not cleaned yet. |
| **Duplicate NORSPAN client entries** | **HIGH — new, 2026-07-08** | Sarty reports plain "NORSPAN" (55 jobs) and "NORSPAN-MB" (4 jobs) both showing in the portal job list — same class of problem as MATIX vs. MATIX-SK. Likely either a second `client_code` entry in DIM_CLIENT_MASTER, or 55 jobs created with the wrong client_code. Those 55 jobs may be billing to a phantom client. **Not yet investigated** — flagged from Sarty's email, no diagnosis run yet. |
| **`WORK_LOG_PERIOD_FIXED` rows visible in My Hours** | **Medium — new, 2026-07-08** | Sarty sees 0-hour system-maintenance rows ("period_id normalised...") from the period_id fixer in their My Hours view. These are internal maintenance events, not real work entries, and should be filtered out of that view. **Not yet fixed.** |
| 1,448 total FACT_WORK_LOGS → VW orphan job_numbers | Medium | 1,382 pre-cutover (expected — migration artifact, see §11) + 66 post-cutover. Of the 66: 46 resolved via `OrphanJobNumberFixer` (99.75h moved, net zero), 19 remain genuinely orphaned (need manual VW decision), 1 is admin overhead ("job assign & help"). See ADR-WL-001. |
| `submitted_at`/`created_at` bug in `writeQueueItem` | Medium | Identified 2026-07-08. Not yet fixed — needs a follow-up session. |
| Test suite uses real staff identities | Medium | Test runs should use DEV-only synthetic actors, not real staff person_codes — risk of test data touching real staff records. Needs a pass to isolate. |
| Inactive staff security check | Medium | Portal/RBAC access for staff marked `active=FALSE` in DIM_STAFF_ROSTER has not been explicitly re-verified since the active-flag whitelist fix (2026-06-29). |
| BIT designer in FACT_QUARTERLY_BONUS | Medium | CALCULATED, composite 52.19% = same as JYS. Is BIT = Bittuu alias = JYS, or different person? |
| 7 PENDING designers (AVM, PRG, RUD, SKR, SMB, SUB, SUB2) | Medium | All zeros in Q1. Confirm Q1 eligibility. Mark SKIPPED if ineligible. |
| Dead-letter queue items (27 VALIDATION_FAILED) | Low | Fix deployed. Affected staff must resubmit any submissions from before 2026-06-18. |
| Dead-letter queue — full investigation | ~~Low~~ | **RESOLVED.** 1 real blocked job (NORSPAN, Sarty notified — separate from the NORSPAN client-duplicate issue above); 14 historical QC_SUBMIT failures, all pre-existing and resolved by `MigratedQCApprovalFixer`. |
| Apps Script deployment | Low | `clasp push` alone is NOT enough — must also do "New version" redeploy in Apps Script editor for `/exec` URL to pick up changes. Portal redeploy requirement now explicit in R4/R5 checklists. |

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
| **ADR-WL-001** — job_number normalization guard + net-zero retroactive fixer (not additive amendment) | Handler-level normalization prevents new orphans; net-zero void+resubmit avoids double-counting hours in PayrollEngine.aggregateHours_() (sums by actor_code+period regardless of job_number/event_type). Full ADR: `docs/SOP_DECISIONS.md` |
| **ADR-WL-002** — 16-hour daily cap on work log submissions | Catches data-entry mistakes at submission time rather than in payroll/billing reconciliation weeks later. Full ADR: `docs/SOP_DECISIONS.md` |
| **ADR-WL-003** — closed-job guard blocks work log submission against INVOICED/VOIDED/CANCELLED jobs | Protects billing integrity once a job is invoiced; corrections route through WorkLogCorrectionHandler instead. Full ADR: `docs/SOP_DECISIONS.md` |
| **ADR-JOB-002** — product_code required at job creation, enforced via post-validation guard (not schema `required: true`) | Generic ValidationEngine message isn't actionable for a dropdown-driven submission; product_code drives job_type, SOP template resolution, and timesheet columns downstream. Full ADR: `docs/SOP_DECISIONS.md` |

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
