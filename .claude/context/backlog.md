# Backlog — BLC Nexus

## Pending
- [ ] **Data hygiene: normalize FACT_WORK_LOGS period_id from migration** — migrated rows have `period_id` stored as a Date object (e.g. `Mon Jun 01 2026 00:00:00 GMT-0600`) instead of the `YYYY-MM` string partition key. Doesn't affect current queries (filtered by `work_date`), but will break any future code that queries by `period_id` directly. Write a one-time normalizer to rewrite all malformed `period_id` values to `YYYY-MM` string format. *Identified 2026-06-29 during PBG designer hours audit.*
- [ ] **Leader Dashboard: TL-grouped team hours** — break flat Team Hours table into per-TL sections (e.g. "SVN's team: X hrs"). Currently all staff shown in one flat list sorted by total hours. *Requested 2026-05-07* — **Note: A2 (2026-06-22) now scopes TEAM_LEAD to own team only; this feature is about UI grouping for CEO/PM view, still pending.**
- [ ] **Phase B security roadmap** — B1: fix rating portal functions to use PortalAuth.resolveEmail (currently Session.getActiveUser); B3: tighten QC scope (currently sees all jobs on shared accounts via buildTeamCodes_, should restrict to own allocated/reviewed jobs); B4: audit staffNameMap visibility (full staff directory sent to every authenticated user on every portal load). *Identified 2026-06-22 — awaiting Raj approval to proceed.*
- [x] **CEO Daily Briefing** — `CEODailyBriefing.run()` + daily trigger (8 AM CST Mon–Sat) + portal "Send Daily Briefing" button. Covers: job pipeline by state, QC backlog, hours not logged today, billing pipeline, dead letter health. *Completed 2026-06-09*

---

## Completed
- [x] Security hardening sprint (Phase A) — A1–A7: payroll/bonus amounts CEO-only, client rates CEO-only, staff pay rates CEO-only, TEAM_LEAD team_hours scoped to own team, ADMIN team_hours empty, RBAC gates added to portal_getQCReviewers and portal_processQueue. Commit ce77350, deployed to PROD 2026-06-22.
- [x] Job search bar — live search across all job tiers for all roles; filters by job number, client, product, status, assignee. *Completed 2026-06-19*
- [x] My Hours sort — entries sorted latest-first with readable date format (e.g. "19 Jun 2026"). *Completed 2026-06-19*
- [x] Hold/Resume permission gate — `canHold`/`canResume` perms added to `buildPerms_()`; buttons now hidden for DESIGNER role. *Completed 2026-06-19*
- [x] StaleJobVoidEngine — voided 19 stale migration artefact jobs from VW_JOB_CURRENT_STATE. *Completed 2026-06-19*
- [x] Job 260337 duplicate fix — `Job260337DuplicateFixer.gs` voids the duplicate VW row (Sarty's V3 re-entry) using compound `created_at` key, preserving the V2 migration row. *Completed 2026-06-20*
- [x] Security: untrack `.clasp.prod.json` / `.clasp.json` from git; scrubbed from all history via `git-filter-repo`; `npm run push:prod` / `push:dev` scripts added. *Completed 2026-06-22*
- [x] Staff onboarding: DIM_STAFF_ROSTER, DIM_STAFF_BANKING, DIM_STAFF_CONTRACTS, contract generation
- [x] Bulk staff import: STG_STAFF_IMPORT staging sheet + portal "Bulk Import from Sheet"
- [x] Leader Dashboard: team hours + payroll status per period (CEO/PM/TL)
- [x] Payroll run + bonus run (separate operations), paystub confirmation, CEO approval
- [x] Client feedback system: Google Form, qualitative questions, email send, onFormSubmit trigger, FACT_CLIENT_FEEDBACK
- [x] TL/PM/CEO performance rating portal + FACT_PERFORMANCE_RATINGS
- [x] Quarterly bonus engine: client(30%) + error rate(40%) + ratings(30%) × INR 25 × design hours → FACT_QUARTERLY_BONUS
- [x] sendRatingRequests: emails TL/PM/CEO a rating portal link per quarter
- [x] CEO Preview As: view portal and rating page as any staff member
- [x] SBS sheet intake: SheetAdapter + STG_INTAKE_SBS + DIM_CLIENT_INTAKE_CONFIG
- [x] Annual bonus: sum Q1–Q4 scores over full Jan–Dec period, paid in December — fully complete, 5 staff written, idempotency verified
- [x] EventReplayEngine (VW rebuild from FACT events) — fully complete, 51 jobs replayed, idempotency verified
- [x] MART refresh / Looker Studio reporting layer — ReportingEngine, 4 MARTs, nightly trigger, portal button, idempotency verified
