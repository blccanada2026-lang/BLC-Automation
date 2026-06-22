# Payroll Rules — BLC Nexus

## Currencies
- All payroll calculated and stored in **INR** — single currency for the entire pay run
- Supervisor base pay (TEAM_LEAD, PM) may have a CAD rate in DIM_STAFF_ROSTER; converted to INR at run time via DIM_FX_RATES
- Supervisor bonus is always INR 25/hour — no conversion needed
- `DIM_STAFF_ROSTER.pay_currency` per person; PayrollEngine converts all to INR for the ledger
- Supported input currencies: CAD, USD, INR

---

## Payroll Run vs Bonus Run — SEPARATE OPERATIONS
- **`runPayrollRun()`** — base pay only (design + QC hours). Run first. Sends paystub emails.
- **`runBonusRun()`** — supervisor bonus only. Run AFTER base pay. Can be re-run independently.
- These are separate so bonus can be recalculated if new hours arrive without re-triggering paystub emails.
- Both are CEO-only. Both write to FACT_PAYROLL_LEDGER as separate event_type rows.
  - `runPayrollRun` → `event_type = 'PAYROLL_CALCULATED'`
  - `runBonusRun` → `event_type = 'PAYROLL_BONUS_SUPERVISOR'`

---

## Hourly Pay
- Each staff member has `pay_design` (per design hour) and `pay_qc` (per QC hour) in `pay_currency`
- Work log entries classified by `actor_role`: role=QC → qc_hours, all others → design_hours

---

## Paystub Approval Workflow
1. Payroll calculated → paystub summary emailed to each staff member
2. Staff confirms → status changes to CONFIRMED
3. CEO runs final approval → all CONFIRMED records → PROCESSED
4. Until confirmed: `status = PENDING_CONFIRMATION`
5. Stored in `FACT_PAYROLL_LEDGER.status` column
6. Paystub email includes: period, design hours, QC hours, rates, supervisor bonus, quarterly bonus (if applicable), total INR

---

## Supervisor Bonus (INR 25 per supervised design hour)
- **TEAM_LEAD**: `bonus = INR 25 × Σ(design_hours of designers directly managed by this TL)`
  - Designers linked to TL via `supervisor_code` in DIM_STAFF_ROSTER
- **PM**: `bonus = INR 25 × Σ(design_hours of ALL designers + TLs mapped to this PM, excluding PM's own hours)`
  - Staff linked to PM via `pm_code` in DIM_STAFF_ROSTER
  - Per-PM calculation — each PM only gets bonus for their own mapped staff
- Supervisor bonus always in **INR** regardless of supervisor's own pay_currency

---

## Quarterly Bonus
- **Quarters**: Q1 = Jan/Feb/Mar · Q2 = Apr/May/Jun · Q3 = Jul/Aug/Sep · Q4 = Oct/Nov/Dec
- Triggered when payroll run period = last month of a quarter (Mar, Jun, Sep, Dec)
- **Formula** (score 0–100 × configured bonus rate):
  - 30% — Client feedback score (FACT_CLIENT_FEEDBACK)
  - 40% — Error rate score (FACT_QC_EVENTS rework cycles)
  - 30% — TL + PM rating (FACT_PERFORMANCE_RATINGS)
- All three input sources must be present; if any missing → status = PENDING (deferred, not skipped)

---

## Annual Bonus
- Formula: sum of Q1 + Q2 + Q3 + Q4 quarterly bonus scores over full Jan–Dec period
- Paid once at year-end (December payroll run)
- In addition to Q4 quarterly bonus — both paid in December
- Uses same 30/40/30 formula aggregated over all 4 quarters

---

## DIM_FX_RATES
- Columns: `from_currency`, `to_currency`, `rate`, `effective_from`, `effective_to`, `notes`
- All rates are X→INR (`to_currency` must be 'INR')
- Most recently effective row wins per currency at payroll run time
- Example: `CAD, INR, 62.5, 2026-01-01` = 1 CAD = 62.50 INR

---

## Leader Dashboard (portal)
- Visible to CEO / PM / TEAM_LEAD automatically on portal load
- Shows: Team Hours table (person, design hrs, QC hrs, total) + Payroll Status table (base pay, bonus, total INR, confirmation status)
- CEO toolbar buttons: "Run Bonus" (runBonusRun) + "Approve Payroll" (approveAllPayroll)
- Individual staff see "Confirm My Paystub" button when status = PENDING_CONFIRMATION
