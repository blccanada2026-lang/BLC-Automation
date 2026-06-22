# Backlog — BLC Nexus

## Pending
- [ ] **Leader Dashboard: TL-grouped team hours** — break flat Team Hours table into per-TL sections (e.g. "SVN's team: X hrs"). Currently all staff shown in one flat list sorted by total hours. *Requested 2026-05-07*
- [x] **CEO Daily Briefing** — `CEODailyBriefing.run()` + daily trigger (8 AM CST Mon–Sat) + portal "Send Daily Briefing" button. Covers: job pipeline by state, QC backlog, hours not logged today, billing pipeline, dead letter health. *Completed 2026-06-09*

---

## Completed
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
