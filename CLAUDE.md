# BLC Nexus — CLAUDE.md

## What is BLC Nexus?
BLC Nexus (Stacey V3) is the internal operations platform for Blue Lotus Consulting Corporation — a structural design BPO company. It handles job tracking, work logging, QC, billing, payroll, SOP compliance, and audit trails for 100+ designers across 25+ client accounts.

## Tech Stack
| Layer | Technology |
|---|---|
| Data | Google Sheets (partitioned fact tables) |
| Backend | Google Apps Script (V8 runtime) |
| Input | Google Forms |
| Reporting | Looker Studio |
| Accounting | Xero (external integration) |

## Architecture
**Event-driven, queue-based, append-only facts.**

```
Form Submit → STG_RAW_INTAKE → STG_PROCESSING_QUEUE → Handler → FACT Table → View Projection
```

All job state is derived from events. VW_JOB_CURRENT_STATE is a projection, not source of truth.

## Agents
Use these agents for specialized tasks:
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

## Critical Rules (abbreviated)
- **A2**: ALL sheet access through `getDAL()` — never SpreadsheetApp directly
- **A3**: ALL form submissions → queue → async processor
- **A5**: FACT tables are append-only — no updates, no deletes
- **S1**: RBAC enforced on every operation — no exceptions
- **D2**: Idempotency checked before every write — reject duplicates gracefully

## File Load Order (deployment)
1. Config.gs → Constants.gs → Identifiers.gs
2. DAL.gs → WriteGuard.gs → CacheManager.gs → BatchOperations.gs
3. RBAC.gs → ActorResolver.gs → ScopeFilter.gs
4. Logger.gs → IdempotencyEngine.gs → HealthMonitor.gs → ErrorHandler.gs → NotificationService.gs
5. ValidationEngine.gs → FieldValidators.gs → BusinessRuleValidator.gs → SOPEnforcer.gs
6. QueueProcessor.gs → IntakeService.gs → RetryManager.gs → DeadLetterHandler.gs
7. StateMachine.gs → all job lifecycle handlers
8. All business logic modules (07–11)
9. MigrationEngine.gs and related (12)
10. AdminConsole.gs → ConfigManager.gs → ArchivalService.gs (13)
11. Setup files last (SheetCreator, ProtectionApplier, TriggerManager, SeedData, VersionRecorder)
12. Tests: DEV environment only

## Multi-Agent Collaboration
- **Claude** = Architect + Code (primary development)
- **ChatGPT** = CTO (strategic decisions, architecture review)
- **Gemini** = Validator (schema validation, reconciliation checks)

---

## Business Rules — Compensation & Payroll

### Currencies
- **All payroll is calculated and stored in INR** — single currency for the entire pay run
- Supervisor base pay (TEAM_LEAD, PM) may have a CAD rate in DIM_STAFF_ROSTER but the system converts to INR at run time using a configured exchange rate in DIM_FX_RATES
- Supervisor bonus is always INR 25/hour — no conversion needed
- `DIM_STAFF_ROSTER` has `pay_currency` per person; PayrollEngine converts everything to INR for the ledger
- Supported currencies: CAD, USD, INR

### Paystub Approval Workflow
- After payroll is calculated, a paystub summary is emailed to each staff member
- Staff must **confirm** the paystub before payroll is marked as PROCESSED
- Until confirmed, the payroll record status = PENDING_CONFIRMATION
- Once confirmed by staff → status = CONFIRMED
- CEO runs a final approval to mark all CONFIRMED records as PROCESSED
- Stored in `FACT_PAYROLL_LEDGER` via `status` column
- Paystub email sent via Gmail / GAS MailApp — includes: period, design hours, qc hours, rates, supervisor bonus, quarterly bonus (if applicable), total pay in INR

### Hourly Pay
- Each staff member has `pay_design` (per design hour) and `pay_qc` (per QC hour) in their own `pay_currency`
- Work log entries are classified by `actor_role`: role=QC → qc_hours, all others → design_hours

### Payroll Run vs Bonus Run — SEPARATE OPERATIONS
- **`runPayrollRun()`** — base pay only (design + QC). Run first. Sends paystub emails.
- **`runBonusRun()`** — supervisor bonus only. Run AFTER base pay. Can be re-run independently.
- These are separate so bonus can be recalculated if new hours come in, without re-triggering paystub emails
- Both are CEO-only. Both write to FACT_PAYROLL_LEDGER as separate event_type rows
- `runPayrollRun` → event_type='PAYROLL_CALCULATED'
- `runBonusRun` → event_type='PAYROLL_BONUS_SUPERVISOR'

### Supervisor Bonus (INR 25 per supervised design hour)
- **TEAM_LEAD**: `bonus = INR 25 × Σ(design_hours of designers directly managed by this TL)`
  - Designers are linked to a TL via `supervisor_code` in DIM_STAFF_ROSTER
- **PM**: `bonus = INR 25 × Σ(design_hours of ALL designers + TLs mapped to this PM, excluding PM's own hours)`
  - Staff are linked to a PM via `pm_code` in DIM_STAFF_ROSTER
  - Rule applies per-PM: if multiple PMs exist in future, each PM only gets bonus for their mapped staff
- Supervisor bonus is always denominated in **INR** regardless of the supervisor's own pay currency

### Quarterly Bonus
- **Quarters**: Q1 = Jan/Feb/Mar · Q2 = Apr/May/Jun · Q3 = Jul/Aug/Sep · Q4 = Oct/Nov/Dec
- Triggered when the payroll run period falls on the last month of a quarter (Mar, Jun, Sep, Dec)
- **Formula** (score 0–100, multiplied by a configured bonus rate):
  - 30% — Client feedback score (collected from main client contact via feedback form)
  - 40% — Error rate score (derived from QC rework cycles in FACT_QC_EVENTS)
  - 30% — TL + PM rating (entered by supervisor via portal)
- Quarterly bonus requires all three input sources to be present for the period
- If any input is missing, the quarterly bonus is deferred (not skipped) — logged as PENDING

### Annual Bonus
- **Formula**: Annual bonus = sum of Q1 + Q2 + Q3 + Q4 quarterly bonus scores for the calendar year, recalculated over the full Jan–Dec period
- Paid once at year-end (December payroll run)
- Annual bonus is **in addition to** the Q4 quarterly bonus — both are paid in December
- Uses the same 30/40/30 scoring formula but aggregated over all 4 quarters of the year

### Client Feedback System (T9 — src/09-feedback/)
- Module: `ClientFeedback.gs` + `ClientFeedbackTrigger.gs`
- **Flow**: CEO clicks "Send Feedback Requests" → Google Form created via FormApp → one email per client with pre-filled links (one per designer) → client submits → `onFeedbackFormSubmit` trigger → `STG_PROCESSING_QUEUE` → QueueProcessor → `ClientFeedback.processFeedbackResponse()` → `FACT_CLIENT_FEEDBACK`
- Form created per quarter, stored via Script Properties (`FEEDBACK_FORM_{periodId}`)
- Score: 1–5 linear scale → normalized 0–100 via `(raw-1)/4*100`
- `getFeedbackSummary(periodId)` returns per-designer average for quarterly bonus engine
- **One-time setup**: run `installFeedbackTrigger()` from Apps Script editor after first form is created
- Designer→client mapping derived from REF_ACCOUNT_DESIGNER_MAP (official account team assignments — NOT from FACT_WORK_LOGS)

### Feedback System (required for quarterly bonus)
- A feedback request is sent to the **main contact** of each client at quarter-end
- Each feedback response is linked to: designer_code, client_code, quarter, rating (1–5 or 0–100)
- Stored in `FACT_CLIENT_FEEDBACK`
- TL + PM ratings stored in `FACT_PERFORMANCE_RATINGS` (entered via portal)
- Error rate derived from `FACT_QC_EVENTS` rework_cycle counts per designer per period

### Performance Rating Rules (TL/PM/CEO quarterly ratings)

#### Who rates whom
| Rater | Rates | How determined |
|---|---|---|
| CEO | All active TLs + PMs | `role = TEAM_LEAD or PM` |
| TEAM_LEAD | All direct reports (any role) | `supervisor_code = TL's person_code` |
| PM | All active DESIGNERs in the org | `pm_code = PM's person_code AND role = DESIGNER` |

- TLs can have other TLs as direct reports (e.g. SVN/PBG report to SDA via `supervisor_code=SDA`)
- TLs are rated by CEO only — not by PM
- A designer is rated by **both** their TL and their PM (two separate rows in FACT_PERFORMANCE_RATINGS per designer per period)
- A TL with no direct reports gets no email and rates no one

#### Rating request emails (`sendRatingRequests`)
- CEO → **1 email** listing all TLs + PMs (sent to CEO's own email = actorEmail)
- Each TL → **1 email** listing their direct reports by name
- PM → **1 email** listing all designers under them by name
- TLs with no direct reports are skipped (no email sent)
- All emails contain the same portal link: `PORTAL_BASE_URL?page=rate-staff&period=periodId`
- Portal `getMyRatees()` filters the correct ratees based on the logged-in user's role

#### Portal `getMyRatees()` logic
- CEO: returns all active staff with `role = TEAM_LEAD or PM`
- TEAM_LEAD: returns all active staff where `supervisor_code = actor.personCode` (any role)
- PM: returns all active staff where `pm_code = actor.personCode AND role = DESIGNER`

---

## Business Rules — Billing

### Rate Model
- Billing is **hourly** — `amount = total_hours × client_hourly_rate`
- Hours sourced from `FACT_WORK_LOGS` grouped by `job_number`
- Rates stored in `DIM_CLIENT_RATES` (per client, optional per-product override)
- `product_code` blank in DIM_CLIENT_RATES = flat rate for all products
- `product_code` set = product-specific override (differential pricing — future use)
- Supported billing currencies: CAD, USD

### Client Onboarding
- New clients are onboarded via the portal (CEO/PM only)
- Creates one row in DIM_CLIENT_MASTER + one flat-rate row in DIM_CLIENT_RATES
- Additional product-specific rates added directly in DIM_CLIENT_RATES sheet

---

## Business Rules — Staff Hierarchy

### DIM_STAFF_ROSTER required columns
| Column | Purpose |
|---|---|
| `person_code` | Unique short code (e.g. DS1, TL1, RNR) |
| `supervisor_code` | person_code of the TL who manages this designer (blank for TLs+) |
| `pm_code` | person_code of the PM this person is mapped to |
| `pay_design` | Hourly rate for design work (in pay_currency) |
| `pay_qc` | Hourly rate for QC work (in pay_currency) |
| `pay_currency` | INR for designers, CAD for supervisors |
| `bonus_eligible` | TRUE/FALSE — eligible for quarterly/annual bonus |

---

### Leader Dashboard (portal)
- Visible to CEO / PM / TEAM_LEAD roles automatically on portal load
- Shows: Team Hours table (person, design hrs, QC hrs, total) + Payroll Status table (base pay, bonus, total INR, confirmation status)
- CEO toolbar buttons: "Run Bonus" (calls runBonusRun) + "Approve Payroll" (calls approveAllPayroll)
- Individual staff members see a "Confirm My Paystub" button when their payroll is PENDING_CONFIRMATION

### DIM_FX_RATES table
- Columns: `from_currency`, `to_currency`, `rate`, `effective_from`, `effective_to`, `notes`
- All rates are X→INR (to_currency must be 'INR')
- Example: `CAD, INR, 62.5, 2026-01-01, ,` means 1 CAD = 62.50 INR
- Most recently effective row wins per currency at payroll run time

---

## Business Rules — Staff Onboarding

Staff onboarding is a **mandatory step** before any person can receive work or payroll. All new designers, QC reviewers, team leads, and PMs must be onboarded before they appear in job allocation or payroll runs.

### Onboarding Workflow (required sequence)
1. CEO or ADMIN runs "Onboard Staff" from the portal
2. Profile written to `DIM_STAFF_ROSTER` (person_code, name, email, role, supervisor_code, pm_code, rates, pay_currency)
3. Banking details written to `DIM_STAFF_BANKING` (all OFX fields — see below)
4. CEO clicks "Generate Contract" → contractor agreement Doc created in Google Drive
5. Contract metadata (URL, start date, jurisdiction) written to `DIM_STAFF_CONTRACTS`

### DIM_STAFF_BANKING — OFX Field Requirements by Country

| Bank Country | Required fields |
|---|---|
| **India** | `bank_name`, `bank_account_number`, `ifsc_code`, `account_type`, `beneficiary_name` |
| **Canada** | `bank_name`, `bank_account_number`, `institution_number`, `transit_number`, `beneficiary_name` |
| **USA** | `bank_name`, `bank_account_number`, `routing_number`, `account_type`, `beneficiary_name` |
| **International** | `bank_name`, `bank_account_number`, `swift_bic`, `iban` (if applicable), `beneficiary_name`, `bank_address` |

All records also store: `bank_country`, `bank_city`, `bank_address`, `ofx_recipient_id` (assigned after OFX account setup).

### DIM_STAFF_CONTRACTS — Contract Generation Rules
- Generated by `StaffOnboarding.generateContract(actorEmail, personCode, options)` using `DocumentApp.create()`
- Saved to Google Drive folder `BLC Contractor Agreements` automatically
- Contract URL stored in `DIM_STAFF_CONTRACTS.doc_url`
- Contract type is always `INDEPENDENT_CONTRACTOR`
- Governing law: Saskatchewan, Canada (or overridden via `options.jurisdiction`)
- 12-clause agreement includes: Services, Compensation (design + QC rates), Payment via OFX, IP Assignment, Confidentiality, Independent Contractor Status, Standards of Work, Term & Termination, Non-Solicitation, Liability Cap, Governing Law, General Provisions
- CEO only — guarded by PAYROLL_RUN permission (via RBAC)

### StaffOnboarding module (T8)
- File: `src/08-staff/StaffOnboarding.gs`
- WRITE_PERMISSIONS: registered for `DIM_STAFF_ROSTER`, `DIM_STAFF_BANKING`, `DIM_STAFF_CONTRACTS`
- Public API: `onboardStaff()`, `generateContract()`, `getStaffList()`, `getBankingDetails()`
- `getBankingDetails()` is CEO-only (PAYROLL_RUN permission)
- `getStaffList()` returns summary (no sensitive banking fields) for ADMIN+ roles
- Idempotent: re-running onboardStaff for an existing person_code updates banking only; does not duplicate ROSTER row

### Bulk Staff Import (migration use)
- Sheet: `STG_STAFF_IMPORT` — human-editable staging sheet with all DIM_STAFF_ROSTER + banking columns
- CEO fills in one row per staff member, then clicks "Bulk Import from Sheet" in the portal
- System calls `StaffOnboarding.bulkOnboardStaff()` which reads the sheet and processes each row
- Status is **written back** to `import_status` column per row: `IMPORTED`, `SKIPPED_EXISTS`, or `ERROR: <message>`
- Rows already marked `IMPORTED` are automatically skipped — safe to re-run after fixing errors
- Portal renders a result table showing each person's import status
- If new staff were created, the Staff Management table auto-refreshes

### Portal — Staff Management Panel
- Visible to CEO and ADMIN roles
- Toolbar button "Manage Staff" toggles the panel
- Table shows: person code, name, role, supervisor, PM, rates, banking status, contract status
- Actions per row: "Generate Contract", "View Banking" (CEO only)
- "Onboard Staff" form has three sections: Profile, Pay Config, Banking (OFX)
- Banking form fields show/hide by `bank_country` selection (India / Canada / USA / International)

---

## Pending Features (not yet built)
- [x] Staff onboarding: DIM_STAFF_ROSTER, DIM_STAFF_BANKING, DIM_STAFF_CONTRACTS, contract generation
- [x] Bulk staff import: STG_STAFF_IMPORT staging sheet + portal "Bulk Import from Sheet" button
- [x] Leader Dashboard: team hours + payroll status per period (CEO/PM/TL)
- [x] Payroll run + bonus run (separate operations), paystub confirmation, CEO approval
- [x] Client feedback system: Google Form, qualitative questions, email send, onFormSubmit trigger, FACT_CLIENT_FEEDBACK
- [x] TL/PM/CEO performance rating portal + FACT_PERFORMANCE_RATINGS table
- [x] Quarterly bonus engine: client(30%) + error rate(40%) + ratings(30%) × INR 25 × design hours → FACT_QUARTERLY_BONUS
- [x] sendRatingRequests: emails TL/PM/CEO a rating portal link per quarter
- [x] CEO Preview As: view portal and rating page as any staff member
- [x] SBS sheet intake: SheetAdapter + STG_INTAKE_SBS + DIM_CLIENT_INTAKE_CONFIG
- [x] Annual bonus: sum Q1–Q4 scores over full Jan–Dec period, paid in December — fully complete, 5 staff written, idempotency verified
- [x] EventReplayEngine (VW rebuild from FACT events) — fully complete, 51 jobs replayed, idempotency verified
- [ ] MART refresh / Looker Studio reporting layer
