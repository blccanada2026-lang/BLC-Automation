# Backlog — BLC Nexus

## Pending
- [ ] **Leader Dashboard: TL-grouped team hours** — break flat Team Hours table into per-TL sections (e.g. "SVN's team: X hrs"). Currently all staff shown in one flat list sorted by total hours. *Requested 2026-05-07*
- [x] **CEO Daily Briefing** — `CEODailyBriefing.run()` + daily trigger (8 AM CST Mon–Sat) + portal "Send Daily Briefing" button. Covers: job pipeline by state, QC backlog, hours not logged today, billing pipeline, dead letter health. *Completed 2026-06-09*

---

## Completed
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
