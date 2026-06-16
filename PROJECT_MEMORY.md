# BLC Nexus — Project Memory

> **Read CLAUDE_START_HERE.md first.** This file is the top-level dashboard.
> For deep detail on any section, follow the links to `.claude/context/` files.

---

## 0. Time-Critical

| Deadline | Action | Risk if missed |
|---|---|---|
| **2026-06-16 (Monday) — BEFORE designer cutover** | Run `runRemoveStaceySyncTrigger()` in Apps Script editor | Sync job fires every 30 min; if not removed it will overwrite post-cutover FACT events |
| **2026-06-16** | Send cutover email to all staff (portal URL) | Designers log hours in Stacey instead of portal |
| **2026-Q2 (deadline end of June)** | Send Q2 rating requests via portal (Send Rating Requests → `2026-Q2`) | Q2 quarterly bonus engine lacks input data |
| **2026-Q2** | Send Q2 feedback requests to clients (Send Feedback Requests → `2026-Q2`) | Q2 quarterly bonus lacks client feedback input |

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

---

## 6. Current Active Work

- **PROD portal live** ✅ — 17 staff received portal links (June 15). Designers logging hours live.
- **BATCH-004 migration complete** ✅ — June 1–15 timesheets fully reconciled: 1278.25h, all 16 actors balanced.
- **Q1 bonus corrections** — `runQ1ApplyManualCorrections()` not yet run. Run it, then `runSendQ1BonusLetters()`. Letters land in CEO inbox for review. See SESSION_LOG for full detail.
- **Stacey auto-sync** — running every 30 min (live since 2026-06-04). **Must be removed June 16.**

---

## 7. Pending Work / Next Steps

Priority order:
1. **June 16 FIRST THING**: `runRemoveStaceySyncTrigger()` in Apps Script editor → send cutover email to all designers
2. Run `runQ1ApplyManualCorrections()` then `runSendQ1BonusLetters()` (Q1 bonus still outstanding)
3. Send Q2 rating requests + Q2 feedback requests to clients (via portal)
4. First June payroll run from V3 (after Phase 3 cutover verified — not before)
5. Leader Dashboard: TL-grouped team hours (backlog item)

→ Full backlog: `.claude/context/backlog.md`
→ Cutover sequence: `.claude/context/cutover-plan.md`

---

## 8. Known Risks / Bugs / Open Questions

| Risk | Severity | Status |
|---|---|---|
| Stacey sync not removed before June 16 cutover | **CRITICAL** | Pending — set a reminder |
| Q1 bonus letters not yet sent | **HIGH** | Run `runQ1ApplyManualCorrections()` then `runSendQ1BonusLetters()`. See SESSION_LOG. |
| BIT designer in FACT_QUARTERLY_BONUS | Medium | CALCULATED, composite 52.19% = same as JYS. Is BIT = Bittuu alias = JYS, or different person? |
| 7 PENDING designers (AVM, PRG, RUD, SKR, SMB, SUB, SUB2) | Medium | All zeros — not in manual. Confirm Q1 eligibility. Mark SKIPPED if ineligible. |
| Q1 FACT_WORK_LOGS has 1,694 duplicate rows | Medium | Real dupes confirmed (all rows have dates). Root cause: CSV re-import. Bonus corrected via amendment. Raw data not cleaned yet. |
| `designer@blc.com` (54 jobs) + BTD + SNA in VW_JOB_CURRENT_STATE | Medium | Test/legacy data from migration. Filter applied in CEO briefing. Needs purge. |
| QC backlog inflated by test jobs (~128 items) | Medium | Email-format entries filtered. Jobs with real-looking person_codes still show. |
| June payroll run before cutover verified | **HIGH** | Rule: do NOT run June payroll until Phase 3 complete. |
| CEO email in auto-memory stale | Low | Auto-memory `feedback_ceo_email.md` correct: `raj.nair@bluelotuscanada.ca`. |

---

## 9. Important Commands / Scripts

```bash
# Apps Script deployment
clasp push --force                        # force push all 78 files
# Then: Apps Script editor → Deploy → Manage → Edit → New version → Deploy

# Portal URL
https://script.google.com/macros/s/AKfycbxttvUv9GeeEHnvsXwKbQIa8U4qDwV36qBWXwvLpibCX2VV2aXeyrzSvCU0-rbGuse_/exec

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
