# Payroll Bonus Adjustment Mechanism — Design Spec

**Date:** 2026-09-14
**Status:** Approved (2026-09-14) — proceeding to implementation plan
**Related:** This session's audit of Sarty's (SGO) August 2026 PM bonus,
which also uncovered two real Team Lead bonus gaps (Bharath/BCH,
missing Rajkumar's hours; Deb Sen/DBS's own hours never attributed).
Both root causes fixed in code + `REF_ACCOUNT_SUPERVISION` data earlier
this session (design+QC-hours billing parity, `PayrollEngine.gs`
`db3b810`, pushed to PROD 2026-09-14). This spec covers only the
remaining piece: correcting the two already-written, already-wrong
August `FACT_PAYROLL_LEDGER` rows.

## 1. Problem

`FACT_PAYROLL_LEDGER` is a FACT table — append-only per Rule A5, no
updates or deletes. Two rows written for `2026-08` under the old
(pre-fix) formula are now confirmed wrong:

| Person | Event | Old (wrong) | Corrected | Delta |
|---|---|---|---|---|
| BCH (Bharath) | `PAYROLL_BONUS_SUPERVISOR` | ₹4,487.50 | ₹7,987.50 | +₹3,500.00 |
| SGO (Sarty, PM) | `PAYROLL_BONUS_SUPERVISOR` | ₹48,343.75 | ₹54,843.75 | +₹6,500.00 |

DBS (Deb Sen)'s existing row (₹1,150) was independently confirmed
correct this session and must NOT be touched.

No existing correction pattern exists for `FACT_PAYROLL_LEDGER` today
(the `WORK_LOG_AMENDED`/`WORK_LOG_VOIDED` pattern is `FACT_WORK_LOGS`-
specific). This spec defines the first one, generalizable to future
payroll/bonus corrections.

## 2. Confirmed facts this design is built on

- `PAYROLL_CONFIRMED` and `PAYROLL_PROCESSED` rows carry zero dollar
  amounts (`design_pay`/`qc_pay`/`bonus_amount`/`total_pay` all `0`) —
  they are pure status markers, not financial snapshots
  (`PayrollEngine.gs:1455-1473`, `:1556-1574`).
- `refreshMartPayrollSummary_` (`PayrollEngine.gs:991`) already **sums**
  `bonus_amount` across every row of a given `event_type` for a
  person+period (`personData[code].supervisor_bonus += ...`,
  `:1024-1025`) — it does not expect exactly one row per type. A second,
  small row is additive by construction, not a special case.
- `hasEvent_`'s duplicate-write guard (`PayrollEngine.gs:667`) keys
  purely on the literal `idempotency_key` string value — a new key
  format for the adjustment type cannot collide with the original
  `PAYROLL_BONUS|<code>|<period>` keys, and protects the adjustment
  itself from double-application.
- Both affected rows are still `PENDING_CONFIRMATION` as of 2026-09-14
  (neither staff member has confirmed, `approveAllPayroll('2026-08')`
  has not run) — confirmed via this session's dry-run tooling. This
  spec does not need to handle the case of correcting an already-CEO-
  approved (`PAYROLL_PROCESSED`) row.

## 3. Mechanism

New event type: `PAYROLL_BONUS_ADJUSTED`. One row per correction,
carrying only the **delta**, not the full new total:

```javascript
{
  event_id:        Identifiers.generateId(),
  period_id:       '2026-08',
  event_type:      'PAYROLL_BONUS_ADJUSTED',
  timestamp:       new Date().toISOString(),
  actor_code:      actor.personCode,
  actor_role:      actor.role,
  person_code:     'BCH',                    // or 'SGO'
  design_hours:    0,
  qc_hours:        0,
  design_pay:      0,
  qc_pay:          0,
  bonus_amount:    3500.00,                  // the delta only
  total_pay:       3500.00,
  status:          'PENDING_CONFIRMATION',
  notes:           'Aug 2026 supervisor bonus correction: +140 supervised hrs ' +
                    '(Rajkumar, SBS) newly attributed. ₹4,487.50 → ₹7,987.50.',
  idempotency_key: 'PAYROLL_BONUS_ADJUSTED|BCH|2026-08',
  payload_json:    JSON.stringify({
                     adjustment_of: '<original PAYROLL_BONUS_SUPERVISOR event_id>',
                     reason: 'design+QC-parity fix + REF_ACCOUNT_SUPERVISION gap (Rajkumar)',
                     old_amount: 4487.50,
                     new_amount: 7987.50
                   })
}
```

Same shape for SGO — `bonus_amount: 6500.00`, `notes`: `'Aug 2026 PM
bonus correction: QC hours now count equally with design hours (billing-
parity rule) — +260 QC hrs across staff (Deb Sen 120, Rajkumar 140).
₹48,343.75 → ₹54,843.75.'` Both `notes` values must stand alone — these
are the only explanation BCH and SGO will ever see for why their number
changed; no reference to internal docs (`CTO_TASK_QUEUE.md` etc.).

Original rows are never touched — Rule A5 intact. The corrected total
is always "sum of all `PAYROLL_BONUS_SUPERVISOR` + `PAYROLL_BONUS_ADJUSTED`
rows for that person+period," exactly matching how base pay already
works via `PAYROLL_CALCULATED`.

## 4. Code change (permanent, reusable)

`refreshMartPayrollSummary_` (`PayrollEngine.gs:1024-1025`) gains one
more branch so `MART_PAYROLL_SUMMARY` reflects corrections automatically:

```javascript
} else if (etype === 'PAYROLL_BONUS_SUPERVISOR' || etype === 'PAYROLL_BONUS_ADJUSTED') {
  personData[code].supervisor_bonus += parseFloat(row.bonus_amount) || 0;
```

Second, small addition to `PayrollEngine.gs`: a new function,
`sendBonusAdjustmentEmail_(staff, personCode, periodId, oldAmount,
newAmount, correctionNote)`, alongside the existing `sendBonusEmail_`
(`:793`) and following the same `PAYSTUB_ROUTE_TO_HR_`/
`resolveHrReviewRecipient_` (`:713`) HR-routing convention already in
place for every other payout email this session touched — so HR gets
one consistent email shape to review and forward, not a new pattern.
Distinct from `sendBonusEmail_` because the content is different in
kind, not just in number: it must show OLD → NEW and the reason, not
present as a fresh bonus notice (a plain re-send of `sendBonusEmail_`
with the new total would look like a duplicate, not a correction, to
whoever reads it). Exposed on the public API (same precedent as
`buildPmBonusMap_` etc.) so the one-off script in §5 can call it.

Subject: `'BLC Supervisor Bonus CORRECTION — ' + staff.name + ' — ' +
periodId`. Body includes old amount, new amount, and the same
`notes` text from §3's ledger row (one source of truth for the
explanation, not reworded twice).

Both this and the `refreshMartPayrollSummary_` branch above are the
only changes to `PayrollEngine.gs` itself, and both are generic — any
future bonus correction reuses them with no further engine changes.

## 5. One-off application script

A new file, `src/12-migration/Aug2026BonusAdjustment.gs`, following the
existing conventions in that directory (`SupervisorBonusByAccountDryRun.gs`
as the closest precedent — RBAC-checked, logs before/after, no hidden
side effects):

- `runAug2026BonusAdjustment(actorEmail)` — CEO/financial-access only
  (`RBAC.enforceFinancialAccess`), hardcodes the two corrections above
  (not a general parameterized tool — this fixes exactly this incident).
  Per person: duplicate check (`hasEvent_`-equivalent) → append the
  `PAYROLL_BONUS_ADJUSTED` row → call
  `PayrollEngine.sendBonusAdjustmentEmail_(...)` (§4) so the correction
  email goes out in the same pass as the ledger write, not a separate
  manual step someone has to remember. Then
  `refreshMartPayrollSummary_('2026-08')` once at the end. **User
  confirmed 2026-09-14: HR re-sends corrected statements before
  `approveAllPayroll('2026-08')` runs** — this script must be run (and
  its correction emails confirmed sent) before that approval step, not
  after. Log a clear reminder of this ordering in the script's own
  final console output.
- A paired `runAug2026BonusAdjustmentDryRun()` — read-only, logs what
  *would* be written and each person's resulting total, no writes.
  Matches this session's established read-before-write discipline. Must
  also print BCH's and SGO's EXISTING `2026-08` `FACT_PAYROLL_LEDGER`
  rows in full, including `event_type` and `status` — the design's §2
  assumption that both are still `PENDING_CONFIRMATION` is sourced from
  a 2026-09-12 note, two days stale as of implementation; HR may have
  forwarded statements and either person may have confirmed since. This
  print is how that gets caught at run time instead of assumed.

## 6. Testing

Jest coverage in `tests/payroll-engine-bonus-adjustment.test.js`:
happy path (both rows written, `MART_PAYROLL_SUMMARY` total correct,
`sendBonusAdjustmentEmail_` called once per person with the right
old/new amounts via a mocked `MailApp`, same mocking pattern already
used in `tests/payroll-engine-pm-bonus.test.js`), idempotency (re-run
is a no-op — including no second email sent, matching the existing
"fully-idempotent re-run" test pattern for `runBonusRun`), and confirms
`DBS`'s untouched row is never written to and no email is sent for her.
`refreshMartPayrollSummary_` already has coverage in
`tests/payroll-engine-payout-statement.test.js` and
`tests/payroll-engine-pm-bonus.test.js` — extend one of those with a
case asserting `PAYROLL_BONUS_ADJUSTED` rows are summed into
`supervisor_bonus` alongside `PAYROLL_BONUS_SUPERVISOR` rows.

## 7. Known limitations / out of scope

- **`idempotency_key` format (`PAYROLL_BONUS_ADJUSTED|<code>|<period>`)
  allows exactly one adjustment per person per period, ever.** Fine for
  this incident (one correction each for BCH/SGO); if a second, separate
  correction is ever needed for the same person+period, the key format
  needs a sequence/reason suffix at that time — not built now, flagged
  so it isn't rediscovered as a surprise.
- No portal/UI changes.
- No change to `runBonusRun`, `confirmPaystub`, or `approveAllPayroll` —
  they already work correctly against summed totals.
- No general "adjustment API" — this is scoped to the one incident;
  a future correction reuses the event type and pattern, not this
  specific script.
- **Re-sending corrected statements to BCH/SGO — RESOLVED, user
  confirmed 2026-09-14: yes, HR re-sends before `approveAllPayroll`.**
  Built into the mechanism itself (§4's `sendBonusAdjustmentEmail_`,
  §5's script), not left as a manual follow-up. If either person has
  already confirmed based on the old (wrong) number by the time this
  runs — visible via §5's dry-run ledger-status print — that's a
  decision point for the user at run time (does an already-CONFIRMED
  row need anything beyond the corrected email + ledger row, or does it
  need to be un-confirmed and re-confirmed?), not resolved in advance
  by this spec since it depends on state not yet known.
