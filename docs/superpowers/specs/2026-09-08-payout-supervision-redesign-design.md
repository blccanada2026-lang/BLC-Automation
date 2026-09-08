# Payout & Account-Supervision Redesign — Design Spec

**Date:** 2026-09-08
**Status:** Approved in conversation, pending written-spec review
**Related:** `CTO_TASK_QUEUE.md` TASK RB-3 (full investigation trail, file:line citations)

## 1. Problem

Two independent, confirmed-live defects in the payout system, found while
reconciling HR's rate sheet against `DIM_STAFF_ROSTER`:

1. **`QC_REVIEWER` hours misclassified.** `RBAC.gs` declares `QC_REVIEWER`
   as an alias for `QC`, but the alias is only applied inside
   `RBAC.enforcePermission`'s own matrix lookup — never to the `actor`
   object itself. `WorkLogHandler.gs` writes the raw, unaliased role into
   `FACT_WORK_LOGS.actor_role`. `WorkLogAggregation.gs:70` tests
   `role === 'QC'` exactly, so every `QC_REVIEWER`-labeled person's hours
   are bucketed as `design_hours`, never `qc_hours`. Confirmed live:
   106/106 of Deb Sen's Jul/Aug 2026 rows carry `actor_role:
   "QC_REVIEWER"`. Currently financially silent only because
   `pay_design === pay_qc` for every active person (confirmed below).

2. **Team Lead bonus has no account scoping.** `buildSupervisorBonusMap_`
   (`PayrollEngine.gs:306`) sums a designer's *entire period* hours,
   company-wide, and credits 100% to whichever single flat
   `supervisor_code` sits on `DIM_STAFF_ROSTER`. There is no way to
   express "this designer's hours on Account X go to Lead A, but on
   Account Y go to Lead B" (the real business rule, per Bharath's SBS +
   Norspan example). Confirmed live: Priyanka S logged 95.25 hours in
   Jul/Aug against Alberta Truss and zero against Titan Truss, but her
   `supervisor_code` still points to Pabitra Ghosh (Titan Truss's lead,
   an account that no longer sends work) — crediting him ~₹2,381 for
   hours he has nothing to do with.

Both were found by tracing actual code, not assumed from documentation.

## 2. Confirmed facts this design is built on

- **One-rate model confirmed.** All 18 active staff (every role except
  CEO, whose pay fields are blank because the CEO isn't paid hourly)
  have `pay_design === pay_qc`. Matches the user's stated original
  intent: one hourly rate per person; QC time is just hours at that
  rate. The design/QC **hours** split is kept anyway, for reporting
  purposes unrelated to pay (client billing, timesheets) — only the
  *classification bug*, not the split itself, is being fixed.
- **The `QC_REVIEWER` raw-string behavior is load-bearing elsewhere —
  do not "fix" it by normalizing `actor.role` globally.**
  `WorkLogCorrectionHandler.gs` (lines 37-41, 389-420) deliberately
  relies on `actor.role` staying the raw `'QC_REVIEWER'` string, to
  distinguish real human QC reviewers from a synthetic DEV test actor
  whose literal role is `'QC'` (`test-qc@test.blc.internal`) —
  `QC_REVIEWER` gets self-correction rights that plain `'QC'` doesn't.
  Several other files (`PortalData.gs:188`, `QuarterlyBonusEngine.gs:363,
  900`, `OnboardingMailer.gs`, `StaffOnboardingMailer.gs`) already handle
  this correctly with `role === 'QC' || role === 'QC_REVIEWER'`.
  `WorkLogAggregation.gs:70` is the one place missing that pattern — an
  isolated, one-line fix, not an RBAC change.
- **PM bonus (`buildPmBonusMap_`) is intentional as-is, not a
  discrepancy.** Flat, company-wide, `INR 25 × Σ(design_hours of every
  non-PM staff)`, documented in both code comments and
  `payroll-rules.md`. Not touched by this design except for one
  interaction rule (§5.3).
- **`REF_ACCOUNT_DESIGNER_MAP` does not already solve this.** Checked its
  schema and seed data: `role` is always literally `'DESIGNER'`,
  "Team Lead" appears only as a free-text `notes` string, and nothing
  under `src/10-payroll/` reads it. It's a portal job-assignment
  eligibility list, not a supervision-authority table. Building a new
  table is real design work, confirmed not a matter of pointing existing
  code at existing data.
- **Sarty Gosh (`SGO`) has exactly one active roster row, role `PM`.**
  Verified live. This matters for §5.3 — the "person codes never
  collide between the TL bonus map and PM bonus map" invariant that
  `PayrollEngine.gs:906-908`'s plain-overwrite merge depends on holds
  today, and this design must not break it.

## 3. Scope

**Phase 1 — data model + calculation fix.** New table, rewritten bonus
calculation, the one-line QC fix. No portal UI.

**Phase 2 — CEO/HR self-service portal panel.** Builds on Phase 1's
table. Staff record edits (rate/role/active status) and account-supervision
assignment, from the portal, gated to CEO + HR_ACCOUNTING.

Phase 2 cannot start before Phase 1 is live and backfilled (§7).

## 4. Phase 1 — Data model

### 4.1 New table: `REF_ACCOUNT_SUPERVISION`

```
client_code | designer_code | supervisor_code | effective_from | effective_to | notes
```

Effective-dated the same way `DIM_STAFF_ROSTER` is (Rule D4) — a designer
moving accounts, or a Team Lead change on an account, is an explicit new
row, not an in-place overwrite. One open-ended (`effective_to` blank) row
per `(client_code, designer_code)` pair at any time — same "exactly one
open row" invariant `scd2FieldChange_` already enforces for
`DIM_STAFF_ROSTER`.

### 4.2 `WorkLogAggregation.gs:70` fix

```javascript
// before
if (role === 'QC') {
// after
if (role === 'QC' || role === 'QC_REVIEWER') {
```

One line. No RBAC change. Matches the existing pattern used everywhere
else in the codebase for this exact alias.

### 4.3 New per-account hours aggregation

A **new** function alongside (not replacing) `aggregateNetWorkLogHours`,
e.g. `aggregateNetWorkLogHoursByAccount(rows, jobToClientMap)`, returning
`{ personCode: { clientCode: { design_hours, qc_hours } } }`. Requires a
`job_number → client_code` resolution (join against
`VW_JOB_CURRENT_STATE`) during aggregation. Additive — `QuarterlyBonusEngine.gs`
and `GenerateTimesheet.gs`, which also consume `aggregateNetWorkLogHours`,
are untouched.

### 4.4 Rewritten `buildSupervisorBonusMap_`

For each `(designerCode, clientCode)` pair with hours > 0:
1. Look up `REF_ACCOUNT_SUPERVISION` for the row effective as of the
   period's `asOfDate` (`periodId + '-01'`, same convention
   `buildStaffCache_` already uses).
2. **If no row found:** log a warning and skip crediting anyone for that
   specific pair — do **not** fall back to the old flat
   `DIM_STAFF_ROSTER.supervisor_code` (that would silently reintroduce
   the bug being fixed). This blocks *only* that pair's bonus
   attribution; every other correctly-assigned pair in the same run
   still computes normally (matches the existing per-client isolation
   pattern in `ClientTimesheetEngine.gs`'s `PreBillingGate` handling).
   **The designer's own base pay is entirely unaffected** — base pay
   (`pay_design × design_hours`) never depended on supervision at all;
   only a Team Lead's bonus credit for that specific pair is withheld.
   `runBonusRun`'s return value must include a `blocked_pairs` list
   (`client_code`, `designer_code`, `hours`) alongside the existing
   `by_supervisor` breakdown, so this is visible to whoever runs it —
   not just a log line in the Apps Script execution log — and actionable
   through the new Phase 2 portal panel (§6.4).
3. **If a row is found:** look up the resolved `supervisor_code` in
   `staffCache`. Credit `INR 25 × hours` to that person **only if their
   role is literally `TEAM_LEAD`** (§5.3 explains why).

### 4.5 §5.3 — the PM-fallback rule, and why it doesn't double-pay

User's stated fallback: if an account has no real Team Lead, assign Sarty
(`SGO`, the PM) as the account's supervisor in `REF_ACCOUNT_SUPERVISION`,
since he does sometimes manage designers directly.

**This is a data-entry convention, not a code-level fallback.** Every
account/designer pair must have an explicit `REF_ACCOUNT_SUPERVISION`
row — including ones where that row names Sarty. The block-on-unassigned
behavior in §4.4 still applies to pairs nobody has entered *at all*; once
a row exists naming Sarty, the pair is no longer "unassigned." Doing this
in code instead (silently defaulting an unmatched lookup to Sarty) would
silently re-create the exact invisibility problem this design fixes — a
missing assignment would stop being visible.

**Why this doesn't double-pay Sarty:** `buildPmBonusMap_` already credits
him `INR 25 × Σ(every non-PM designer's design hours, company-wide)` —
unconditionally, today, regardless of any supervisor assignment. If
`REF_ACCOUNT_SUPERVISION` names `SGO` as a pair's supervisor, §4.4 step 3
looks up his role in `staffCache` — it's `PM`, not `TEAM_LEAD` — so no
Team-Lead-bonus line is credited for that pair. The hours were already in
his PM total; naming him as the pair's supervisor changes only the
attribution bookkeeping (so the pair isn't blocked), not his payout. This
is a **role-based** rule (credit only if `role === 'TEAM_LEAD'`), not a
hardcoded check for `SGO` specifically — it generalizes to anyone in the
same position, and it's what keeps `PayrollEngine.gs:906-914`'s
plain-overwrite merge of the TL and PM bonus maps safe: person codes
still never collide between the two maps, because a `PM`-role person
never gets a TL-map entry no matter what `REF_ACCOUNT_SUPERVISION` says.
Verified: Sarty holds exactly one active role (`PM`), so this invariant
holds today.

## 5. Concrete test cases this design must resolve correctly

- **Deb Sen → Priyanka S, Alberta Truss.** Deb Sen's role changes
  `QC_REVIEWER → TEAM_LEAD` (via `updateStaffRecord`, §6.1). A new
  `REF_ACCOUNT_SUPERVISION` row: `client_code=ALBERTA TRUSS,
  designer_code=PRS, supervisor_code=DBS`. After this, Priyanka's Alberta
  Truss hours credit Deb Sen's TL bonus; Pabitra is no longer credited
  for hours he has nothing to do with.
- **Bharath, two accounts, two teams.** Two separate
  `REF_ACCOUNT_SUPERVISION` rows (`SBS`/Bharath's SBS designers,
  `NORSPAN`/his Norspan designers) — each designer's hours attribute
  correctly per account, something the current flat `supervisor_code`
  field cannot express at all.
- **An account with no assigned Team Lead.** A row naming `SGO` — no
  double-pay (§4.5), no block (a row exists).
- **A genuinely unassigned pair (nobody has entered anything yet).**
  Blocked, logged, visible — forces a decision rather than silently
  mis-crediting or silently paying nobody.

## 6. Phase 2 — CEO/HR self-service portal panel

### 6.1 Staff record changes — one generic wrapper

Rather than three separate functions, one new exported function in
`StaffOnboarding.gs`, mirroring `changeSupervisor`'s existing shape:

```javascript
function updateStaffRecord(actorEmail, personCode, fieldChanges, effectiveDate) {
  var actor = RBAC.resolveActor(actorEmail);
  RBAC.enforcePermission(actor, RBAC.ACTIONS.STAFF_PAYOUT_ADMIN);
  // fieldChanges: any of { pay_design, pay_qc, role, active, supervisor_code }
  return scd2FieldChange_(personCode, fieldChanges, effectiveDate);
}
```

Covers rate changes, role changes, and active/inactive toggling (all
effective-dated via the existing SCD-2 mechanism, for audit consistency —
"was this person active/at this rate during period X" stays answerable
historically) through one code path and one permission check.

### 6.2 Account-supervision assignment — separate function

`assignAccountSupervisor(actorEmail, clientCode, designerCode,
supervisorCode, effectiveDate)` — same RBAC gate, same effective-dating
convention, operating on `REF_ACCOUNT_SUPERVISION` instead of
`DIM_STAFF_ROSTER` (different key shape, so not a literal reuse of
`scd2FieldChange_`, but the same close-current/open-new pattern).

### 6.3 RBAC — new `STAFF_PAYOUT_ADMIN` action

`CEO: true, HR_ACCOUNTING: true`, every other role `false` — explicitly
excluding `ADMIN`, whose own documentation says it's for "system config
**without financial access**." Rate/role/active-status/account-supervision
are all financial or HR-sensitive.

**Known, deliberate inconsistency, not fixed here:** `changeSupervisor`
already exists, is gated by `ADMIN_CONFIG` (which `ADMIN` does have), and
also changes `supervisor_code`. After this design, `ADMIN` keeps
org-chart-correction ability through that existing path, while the new
rate/role/active/account-supervision functions use the narrower new
action. Flagged for awareness; not in scope to reconcile now.

### 6.4 Portal UI

New "Staff & Payout Management" section, visible only when
`actor.role === 'CEO' || actor.role === 'HR_ACCOUNTING'` (gated on
`actor.role` per the portal's own convention, server-side RBAC enforced
regardless of what the client shows):

- **Staff edit form** — pick a person, change rate/role/active status, set
  an effective date (default today, overridable) → one
  `portal_updateStaffRecord` call.
- **Account-supervision table** — list of current `(client, designer,
  supervisor, effective_from)` rows, plus an add/reassign form → one
  `portal_assignAccountSupervisor` call.

## 7. Migration / cutover risk

`REF_ACCOUNT_SUPERVISION` starts **empty**. Combined with the
block-per-pair behavior (§4.4), the new bonus calculation would block
*every* active designer's Team-Lead-bonus attribution the moment it goes
live, until each of their currently-worked accounts has an assignment
row. With 19 active staff, some spanning multiple accounts, this is real
data entry, not incidental to deploying the code.

**Sequencing:** build and test Phase 1's code, but keep `runBonusRun` on
the *current* (flat, company-wide) calculation until the backfill —
every active designer's current, correct account/supervisor pairing,
entered as `REF_ACCOUNT_SUPERVISION` rows — is complete and verified.
Cut over deliberately once verified, not automatically on deploy.

## 8. Testing

Standard T1 coverage (happy path, RBAC denial, invalid input, duplicate
submission) for `updateStaffRecord` and `assignAccountSupervisor`, using
`TEST-CLIENT`/synthetic actors per `testing-policy.md`. Given this
session already found two real SCD-2 edge-case bugs this year (the
inverted-window guard and the idempotency-check bug, both in
`scd2FieldChange_`, both dated 2026-07-27 in code comments), explicitly
include:
- Re-running the same change idempotently (no duplicate row).
- Backdating `effectiveDate` to at/before the current row's own
  `effective_from` (must throw, matching `scd2FieldChange_`'s existing
  guard) — and the equivalent guard for `assignAccountSupervisor`'s own
  table.
- The role-based PM-skip rule (§4.5): a `REF_ACCOUNT_SUPERVISION` row
  naming a `PM`-role person produces no TL-bonus map entry for that pair.
- The block-per-pair behavior: one unassigned pair blocks only that
  pair's bonus, not the whole run.

## 9. Not in scope for this design

- The CAD-denominated per-account profitability calculator (explicitly
  sequenced after this design closes — its cost-side allocation depends
  on this data model existing first).
- The 7 unrelated rate corrections (verified, mechanically settled,
  proceeding independently — not blocked by any of the above).
- Reconciling the `changeSupervisor`/`ADMIN_CONFIG` vs.
  `STAFF_PAYOUT_ADMIN` inconsistency noted in §6.3.
