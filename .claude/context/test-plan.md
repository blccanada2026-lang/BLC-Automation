# BLC Nexus — CTO Testing Plan (June 2026)

> **Goal:** Systematically validate every portal feature with real production data across all client accounts and all roles, before the first payroll run.
> **Scope:** 5 roles × 6 client accounts × 8 job states + financial flows + portal UX
> **Status:** Initiated 2026-06-16. Not yet executed.

---

## Roles and Testers

| Role | Tester | Person Code | What They Test |
|---|---|---|---|
| CEO | Raj (you) | RAJ | Full portal, all panels, billing, payroll, CEO dashboard |
| PM | Sarty | SGO | Job creation, assignment, QC escalation, timesheet approval |
| TEAM_LEAD | Sandy | SNY | Team jobs visibility, hours logging, My Hours panel |
| QC_REVIEWER | Raj Kumar | RKU | QC review actions, assign dropdown appearance |
| DESIGNER | Any active | (varies) | Log Work button visibility, My Hours panel, job list |

---

## Feedback Capture

Create a Google Sheet (outside Nexus — read-only observer, not form intake) named:
**"BLC Nexus UAT — June 2026"**

Columns:
`Tester | Role | Account | Job Number | Feature Tested | Expected | Actual | Pass/Fail | Screenshot URL | Notes`

Sarty can paste this into WhatsApp/email; CEO reviews at end of each test day.

---

## Phase 1 — Portal Access & Visibility (Day 1, ~30 min)

**Tester: Each role opens their portal link and confirms what they see.**

| # | Role | Check | Expected | Notes |
|---|---|---|---|---|
| 1.1 | DESIGNER | Jobs panel | Own jobs only | Scoped to SELF |
| 1.2 | TEAM_LEAD | Jobs panel | All jobs for their account(s) | Scoped via REF_ACCOUNT_DESIGNER_MAP |
| 1.3 | QC_REVIEWER | Jobs panel | Jobs where they are assigned reviewer | Scoped to QC-assigned |
| 1.4 | PM | Jobs panel | All jobs across all accounts | Scoped to ALL |
| 1.5 | CEO | Jobs panel | Client-grouped collapsible view | CEO-only grouped layout |
| 1.6 | CEO | Leader Dashboard | Appears below jobs panel | PM/CEO role |
| 1.7 | CEO | QC Backlog panel | Shows only real accounts (no DS1/UNKNOWN) | Filtered by staffNameMap |
| 1.8 | DESIGNER | "Log Work" button | Visible on IN_PROGRESS / ALLOCATED / MINOR_FIX jobs | canLogWork flag |
| 1.9 | TL / PM / QC | "Log Work" button | Visible on same states | canLogWork flag |
| 1.10 | DESIGNER | My Hours panel | Visible, shows current period hours | canLogWork gated |

---

## Phase 2 — Job Lifecycle (Day 1–2, core flows)

Test with REAL jobs across each of the 6 client accounts. Pick 1–2 jobs per account.

### 2A — Job Creation (PM / CEO only)
| # | Check | Expected |
|---|---|---|
| 2A.1 | Create job — all required fields | Job appears in VW_JOB_CURRENT_STATE with state PENDING |
| 2A.2 | Create job — missing client code | Validation error shown in portal |
| 2A.3 | Create job — short job number (e.g. NL-01, AT-1) | Accepted — no minLength error |

### 2B — Assignment (PM / CEO)
| # | Check | Expected |
|---|---|---|
| 2B.1 | Assign job → open assign modal | Dropdown shows active designers + TLs + QC reviewers |
| 2B.2 | Assign to Raj Kumar (RKU) | RKU appears in dropdown (QC_REVIEWER included) |
| 2B.3 | Assign to Sandy (TL) | Appears in dropdown |
| 2B.4 | Assign → confirm | Job state → ALLOCATED in jobs panel |

### 2C — Work Logging (DESIGNER / TL / PM / QC)
| # | Check | Expected |
|---|---|---|
| 2C.1 | Log Work on ALLOCATED job | Work log modal appears; submit succeeds |
| 2C.2 | Log Work → My Hours panel updates | Hours total increases after reload |
| 2C.3 | Log Work on IN_PROGRESS job | Same as 2C.1 |
| 2C.4 | Log Work with fractional hours (e.g. 2.5) | Accepted |
| 2C.5 | Submit without hours | Validation error shown |
| 2C.6 | Log Work — short job number job (e.g. NL-01) | Accepted — minLength fix confirmed |

### 2D — Job Start
| # | Check | Expected |
|---|---|---|
| 2D.1 | Start job (ALLOCATED → IN_PROGRESS) | State chip changes to IN_PROGRESS |

### 2E — QC Submission
| # | Check | Expected |
|---|---|---|
| 2E.1 | Submit to QC (IN_PROGRESS → QC_REVIEW) | Job appears in QC Backlog panel for CEO |
| 2E.2 | QC Reviewer sees job in their list | RKU portal shows job with QC actions visible |

### 2F — QC Review
| # | Check | Expected |
|---|---|---|
| 2F.1 | QC PASS → Completed | State → COMPLETED; client email triggered |
| 2F.2 | QC MINOR_FIX | State → MINOR_FIX; designer notified |
| 2F.3 | QC MAJOR_FIX | State → MAJOR_FIX; rework loop triggers |

### 2G — Completion + Hold
| # | Check | Expected |
|---|---|---|
| 2G.1 | Hold job (any state) | State → ON_HOLD |
| 2G.2 | Resume job | State returns to prior non-hold state |

---

## Phase 3 — CEO Dashboard (Day 2)

| # | Check | Expected |
|---|---|---|
| 3.1 | CEO Load Balance panel | No DS1, UNKNOWN, BTD, SNA entries |
| 3.2 | CEO Load Balance — hours match designer | Spot check 1 designer hours vs FACT_WORK_LOGS |
| 3.3 | QC Backlog — "max Nd" warning | Any job waiting ≥3 days shows red warning |
| 3.4 | CEO Daily Briefing email | Run `runTestCEODailyBriefing()` — confirms email content |
| 3.5 | Leader Dashboard — visible to CEO and PM | Not visible to DESIGNER |

---

## Phase 4 — My Hours Panel (Day 2)

| # | Tester | Check | Expected |
|---|---|---|---|
| 4.1 | DESIGNER | My Hours shows logged entries | Per-job rows with date, hours, notes |
| 4.2 | TEAM_LEAD | My Hours panel visible and populated | Logged hours shown |
| 4.3 | QC_REVIEWER | My Hours panel visible | Same |
| 4.4 | PM | My Hours panel visible | Same |
| 4.5 | Any | Submit work log → refresh page → My Hours updates | New entry appears |

---

## Phase 5 — TL Account Visibility (Day 2)

**Sandy (SNY) as TEAM_LEAD tester.**

| # | Check | Expected |
|---|---|---|
| 5.1 | Sandy sees all jobs for accounts she is assigned to | Per REF_ACCOUNT_DESIGNER_MAP |
| 5.2 | Sandy does NOT see jobs from accounts she is not assigned to | Correctly scoped |
| 5.3 | Sandy can see Raj Kumar's jobs on shared accounts | All designers on same account visible to TL |

---

## Phase 6 — Cross-Account Spot Checks (Day 3)

Run 1 full create→assign→work log→QC→complete flow per client account.

| Account | Job to use | Tester flow |
|---|---|---|
| Nirma Labs (NL-*) | Create new or use existing | PM creates → Designer logs → QC pass |
| Atelier (AT-*) | Use existing migrated job | Work log → confirm accepted |
| BLC-#### jobs | Use existing | Full cycle |
| (other accounts) | Per roster | Spot check assign + work log |

---

## Phase 7 — Billing Readiness Check (Day 3, CEO only)

| # | Check | Expected |
|---|---|---|
| 7.1 | BillingEngine schema check | Pattern removed — run `runBillingHealthCheck()` if exists |
| 7.2 | Pick 1 COMPLETED job → trigger billing | No schema error; ledger row written |
| 7.3 | Spot check FACT_BILLING_LEDGER | Row has correct job_number, hours, rate, amount |

---

## Phase 8 — Q1 Bonus (CEO + Sarty, before June 20)

| # | Step | Action |
|---|---|---|
| 8.1 | Confirm BIT identity | Is BIT = Bittuu = JYS (same person)? If yes, no separate entry needed. |
| 8.2 | Confirm 7 PENDING eligibility | AVM, PRG, RUD, SKR, SMB, SUB, SUB2 — eligible or SKIP? |
| 8.3 | Run corrections | `runQ1ApplyManualCorrections()` in Apps Script editor |
| 8.4 | Run letter send | `runSendQ1BonusLetters()` — letters to CEO inbox for review |
| 8.5 | Forward letters | CEO reviews, forwards to each designer |

---

## Phase 9 — Client Timesheet Generator (Build, then test)

**Not yet built.** Build `generateClientTimesheet(clientCode, periodId)` in `src/11-reporting/ClientTimesheetEngine.gs`.

Output per job:
- Job number, job title, client code
- Per designer: name, total hours, hourly rate, line total
- Period total hours + amount

Test: Run for 1 client after a billing period closes. Compare with Sarty's manual Stacey sheet.

---

## Feedback Capture Template

After each test session, Sarty/Sandy/Raj Kumar pastes results into the UAT sheet:

```
Tester | Role | Account | Job# | Feature | Expected | Actual | P/F | Notes
Sandy  | TL   | NL      | NL-01| TL Visibility | See all NL jobs | Saw 3/3 NL jobs | P | —
RKU    | QC   | BLC     | BLC-00123 | Assign dropdown | See RKU in list | Not in list | F | QC_REVIEWER not showing
```

CEO reviews daily. Any `F` → file in WhatsApp or email to Raj with screenshot.

---

## Definition of Done

Testing is complete when:
- [ ] All Phase 1–6 checks pass across all 6 accounts
- [ ] Zero `F` items in UAT sheet (or all F items have linked bug fixes deployed)
- [ ] Phase 7 billing test passes on at least 1 job
- [ ] Q1 bonus letters reviewed and ready to forward
- [ ] Client timesheet generator built and spot-checked

Once all checks pass → safe to run June payroll.
