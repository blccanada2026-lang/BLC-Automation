# Payout Statement Summary — Design Spec

**Status:** Draft — ready for user review
**Task:** `CTO_TASK_QUEUE.md` TASK NEW-1

## 1. Purpose

CEO and HR admin (`HR_ACCOUNTING`) need a portal-triggered way to generate a
review summary of pay for any period — base pay, supervisor bonus, and
optionally quarterly bonus — emailed to an HR review address before it goes
out to the team. Today, `runPayrollRun`/`runBonusRun` compute and commit pay
*and* email each staff member directly, with no review step in between.

**User's requirement, verbatim:** "a feature that CEO and the HR admin can
use from their portal to generate paystubs that would go as emails to the
HR@bluelotuscanada.ca email so that they can check it and then send it to
the team."

**Terminology:** this feature — and the wording of every user-facing
artifact it touches — uses **"Payout Statement,"** not "paystub." All
consultants at BLC are contractors, not employees; "paystub" carries payroll
connotations the business wants to avoid for CRA/legal reasons. See §7 for
the full rename scope.

## 2. Decisions already settled (do not re-litigate)

1. **Additive, not a replacement.** The existing per-consultant confirm-gate
   email flow (`sendPaystubEmail_` → `portal_confirmPaystub` →
   `confirmPaystub`) is unchanged in mechanism — it still gates payroll
   processing exactly as today. This feature adds an HR-facing summary
   alongside it; it never replaces the individual consultant email.
2. **No RBAC matrix changes.** `PAYROLL_PREVIEW` (compute without
   committing) and `PAYROLL_VIEW` (read committed/quarterly figures) are
   *already* `true` for both `CEO` and `HR_ACCOUNTING` (`RBAC.gs:440-441`,
   `601-602`), and `PAYROLL_PREVIEW` is already in
   `HR_ACCOUNTING_FINANCIAL_ACTIONS_` (`RBAC.gs:1202`) — the allowlist
   `enforceFinancialAccess()` checks for non-CEO/SYSTEM actors. HR admin
   gets a genuine trigger without ever gaining `PAYROLL_RUN`/`PAYROLL_COMMIT`
   — her role stays strictly prepare/review, matching the existing
   documented design intent for that role.
3. **Plain-text batch summary**, not per-person PDFs. Matches the existing
   `sendPaystubEmail_`/`sendBonusEmail_` style. A PDF pipeline
   (`exportHtmlAsPdf_`, `ClientTimesheetEngine.gs:604`) exists and could be
   reused later if the business wants real PDF statements — out of scope
   here.
4. **Manual trigger only** — a portal button, no scheduled trigger. No
   monthly-cadence trigger infrastructure exists in this codebase today;
   building one is out of scope.
5. **Period selection**: a `window.prompt()` for `periodId` (`'YYYY-MM'`,
   blank = current period), matching the existing pattern used by
   `portal_runBonusRun`/`portal_approveAllPayroll`. Not a new modal.
6. **Hourly rate and Team Lead supervisor bonus verified correct as
   specified.** `design_pay = design_hours × staff.pay_design`,
   `qc_pay = qc_hours × staff.pay_qc` (each converted from the staff
   member's own `pay_currency` to INR via `toInr_()`/`DIM_FX_RATES`,
   `PayrollEngine.gs:653-654`) — matches `.claude/context/payroll-rules.md`
   exactly. `buildSupervisorBonusMap_` (`PayrollEngine.gs:269`) sums each
   TL's direct reports strictly by `supervisor_code`, with no
   `DIM_QC_ASSIGNMENTS` involvement — per `PROJECT_MEMORY.md` §3.3 that is
   exactly right, QC review relationships and TL reporting lines are
   deliberately independent structures. No change needed to either; both
   are reused as-is.
7. **PM/manager bonus — confirmed doc/code drift, resolved 2026-08-26.**
   `.claude/context/payroll-rules.md` still describes a per-PM,
   `pm_code`-scoped calculation. The live code (`buildPmBonusMap_`,
   `PayrollEngine.gs:318`) is a **deliberate, already-shipped rewrite**
   (Phase B1, 2026-07, rationale in the unmerged
   `.worktrees/payroll-automation-phase-b1/PAYROLL_AUTOMATION_ARCHITECTURE.md`
   §2.3) to a flat, company-wide sum — `INR 25 × Σ(design_hours of every
   non-PM staff member)`, no `pm_code` lookup at all, removing a
   data-integrity dependency the old rule had. Since Sarty (`SGO`) is the
   only active PM today and `pm_code=SGO` is set on effectively every
   staff row, both rules currently produce the same number — the doc
   drift was invisible until now. **User-confirmed decision: use the flat
   rule as-is** (it's correct for today's one-PM reality); `payroll-rules.md`
   gets corrected to match reality as part of this feature (§7a below).
   The rule's own documented consequence — if BLC ever activates a second
   PM simultaneously, both would be credited the identical company-wide
   total with no attribution split — is a real structural risk but
   explicitly **not** being fixed here; flagged as a separate backlog item
   for whenever a second PM becomes a real possibility, not blocking this
   feature. `buildPmBonusMap_`/`buildSupervisorBonusMap_` are both reused
   unchanged by `previewPayoutStatement` (§4.2) exactly as `runBonusRun`
   already calls them.
8. **Quarterly bonus is a separate, optional section** — different
   calculation (`computeBonuses_`: error rates, client scores, ratings),
   different period grain (`Q1`/year, not `YYYY-MM`). Included only when the
   requester opts in, via the already-existing no-write
   `previewQuarterlyBonus(actorEmail, quarter, year)`. **Deliberately does
   NOT extend to annual bonus** — confirmed via
   `PAYROLL_AUTOMATION_ARCHITECTURE.md` §3.1 that the annual-bonus ledger
   key (`'ANNUAL-' + year`) is year-scoped, not month-scoped, so a naive
   "look up bonus for this period" merge would show the same annual bonus
   under every month of that year and risk double-counting if ever summed
   into a total. Quarterly/annual bonus also has no confirmation mechanism
   at all today (unlike base pay/TL/PM bonus) — this design's quarterly
   section is clearly labeled "preview" and never summed into any total
   for exactly this reason.

## 3. Architecture

Two triggers share one pure calculation core:

```
                    ┌─ computePersonPay_(staff, hours, fxCache)  [pure, new]
                    │
   HR/CEO "Preview  │   previewPayoutStatement(actorEmail, periodId, options)
   & Send to HR"  ──┤   [new, PAYROLL_PREVIEW-gated]
   button           │   → base pay (computePersonPay_) + supervisor/PM bonus
                    │     (buildSupervisorBonusMap_/buildPmBonusMap_, reused
                    │     unchanged) + optional quarterly bonus
                    │     (previewQuarterlyBonus, reused unchanged)
                    │   → sendPayoutStatementSummary_(periodId, sections,
                    │     { committed: false })
                    │   → NO FACT write, NO consultant emails, repeatable
                    │
   CEO "Run         │   runPayrollRun(actorEmail, options)  [existing,
   Payroll" button ─┤   unchanged trigger/gate]
                    │   → per-person loop now calls computePersonPay_
                    │     internally (pure refactor, see §5)
                    │   → writes FACT_PAYROLL_LEDGER, sends per-consultant
                    │     confirm-gate emails — unchanged
                    │   → NEW: also calls sendPayoutStatementSummary_(
                    │     periodId, { basePay: byPerson }, { committed:
                    │     true }) once, at the end
                    │
   CEO "Run Bonus"  │   runBonusRun(actorEmail, options)  [existing,
   button ──────────┘   unchanged trigger/gate]
                        → writes FACT_PAYROLL_LEDGER, sends per-supervisor
                          emails — unchanged
                        → NEW: also calls sendPayoutStatementSummary_(
                          periodId, { supervisorBonus: bySupervisor },
                          { committed: true }) once, at the end
```

`runPayrollRun` and `runBonusRun` stay separate operations, exactly as they
are documented today ("Run SEPARATELY from runBonusRun()") — each sends its
own HR summary email when it commits, covering only what it just committed.
The preview path is the only place base pay + supervisor bonus (+ optional
quarterly) appear combined in one email, since a preview is a single
point-in-time snapshot with no reason to force two reviews.

## 4. Backend changes — `src/10-payroll/PayrollEngine.gs`

### 4.1 `computePersonPay_(staff, hours, fxCache)` — new, private, pure

Extracted from `runPayrollRun`'s per-person loop. Returns exactly today's
`by_person` entry shape:
```
{ person_code, name, design_hours, qc_hours, design_pay, qc_pay, total_pay, currency }
```
Uses `toInr_` (`PayrollEngine.gs:209`, already pure) for the rate/FX lookup.
**Must preserve the exact rounding behavior**: `design_pay` and `qc_pay` are
each rounded independently inside `toInr_`, then `total_pay` is rounded again
after summing the two already-rounded values (`PayrollEngine.gs:655`) — do
not collapse this into a single rounding pass; that changes totals by a cent
in edge cases.

Deliberately **excludes** everything row-assembly-related (`event_id`,
`actor_code`, `actor_role`, `idempotency_key`, `status`, `payload_json`) —
those stay exactly where they are today, inside `runPayrollRun`'s loop,
which now wraps `computePersonPay_`'s result into the full ledger row the
same way it always has. This was a real gap caught during design review: an
earlier draft of this helper's signature omitted `actor`/`idempotencyKey`,
which would have silently broken `hasEvent_`'s idempotency check
(`PayrollEngine.gs:353-365`) and caused duplicate `PAYROLL_CALCULATED` rows
on re-run. Keeping the helper to pure math only avoids that risk entirely.

`runPayrollRun` itself changes only inside its loop body: replace the inline
calculation with a call to `computePersonPay_`, then continue exactly as
today (idempotency check, `DAL.appendRow`, `sendPaystubEmail_`). No change
to its signature, return shape, or any other behavior.

### 4.2 `previewPayoutStatement(actorEmail, periodId, options)` — new, public export

```javascript
RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_PREVIEW);
RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.PAYROLL_PREVIEW);
```
`options = { includeQuarterly: boolean, quarter: string, year: number }`
(quarter/year only read when `includeQuarterly` is true).

Steps: `buildStaffCache_(periodId + '-01')` (same effective-dating as
`runPayrollRun`, per §3.2's standing rule) → `aggregateHours_(periodId)` →
for each person with hours, `computePersonPay_` (no idempotency check, no
`DAL.ensurePartition`, no FACT write, no `sendPaystubEmail_` call) → collect
`basePay` rows. Then `buildSupervisorBonusMap_`/`buildPmBonusMap_` (same
calls `runBonusRun` makes, reused unchanged) → `supervisorBonus` rows. If
`includeQuarterly`, `previewQuarterlyBonus(actorEmail, quarter, year)`
(reused unchanged, already `PAYROLL_VIEW`-gated internally) →
`quarterlyBonus` rows.

Same `HealthMonitor.isApproachingLimit()` quota guard as `runPayrollRun`'s
loop (RULE P1) — staff counts are small today but this keeps the pattern
consistent and safe if the roster grows.

Calls `sendPayoutStatementSummary_(periodId, { basePay, supervisorBonus,
quarterlyBonus }, { committed: false, quarterPeriodId })`. Returns
`{ previewed: true, period_id, by_person: basePay, by_supervisor:
supervisorBonus, quarterly: quarterlyBonus || null }`.

**Fully repeatable** — no writes, no idempotency marking, same period can be
previewed any number of times with identical results (given unchanged
underlying data).

### 4.3 `sendPayoutStatementSummary_(periodId, sections, meta)` — new, private

`sections = { basePay, supervisorBonus, quarterlyBonus }` — any key may be
`undefined`/`null`, meaning that section is omitted from the email entirely.
`meta = { committed: boolean, quarterPeriodId: string|null }`.

One plain-text email via `MailApp`, sent to the Script Property
`PAYOUT_STATEMENT_REVIEW_RECIPIENT` (default `HR@bluelotuscanada.ca` — a
Script Property, not hardcoded, matching the existing
`CEO_BRIEFING_RECIPIENT`/`HM_ALERT_RECIPIENT` convention). Subject:
`"BLC Payout Statement Summary — " + periodId + " (Review)"`.

Body sections, only the ones present in `sections`:
```
BASE PAY
───────────────────────────────
Person          Design Hrs   QC Hrs   Design Pay      QC Pay        Total Pay
RND             120.5        0        INR 12,050.00   INR 0.00      INR 12,050.00
...
                                                         Period Total: INR XX,XXX.XX
───────────────────────────────

SUPERVISOR BONUS
───────────────────────────────
Person          Role         Bonus
BCH             TEAM_LEAD    INR 750.00
...
                              Total: INR X,XXX.XX
───────────────────────────────

QUARTERLY BONUS PREVIEW — Q3 2026 (preview, not yet committed)
───────────────────────────────
... same row shape as computeBonuses_ output ...
───────────────────────────────
```
Closing line depends on `meta.committed`:
- `false` (preview trigger): *"This is a review summary only. No payroll
  has been committed yet."*
- `true` (real commit — either `runPayrollRun` or `runBonusRun`):
  *"This reflects payroll already committed for this period; confirmation
  emails have already been sent to affected staff."*

Non-fatal on `MailApp` failure, `Logger.warn`, same pattern as
`sendPaystubEmail_`. If `PAYOUT_STATEMENT_REVIEW_RECIPIENT` is unset,
`Logger.warn` and no-op (does not throw) — matches `sendPaystubEmail_`'s
no-email-address handling.

## 5. Portal wiring — `src/07-portal/Portal.gs` + `PortalView.html`

New endpoint:
```javascript
// portal_previewPayoutStatement — CEO/HR_ACCOUNTING preview & send to HR
function portal_previewPayoutStatement(ptoken, periodId, includeQuarterly, quarter, year) {
  var email  = PortalAuth.resolveEmail(ptoken);
  var result = PayrollEngine.previewPayoutStatement(email, periodId || '', {
    includeQuarterly: !!includeQuarterly,
    quarter: quarter || '',
    year:    parseInt(year, 10) || null
  });
  return JSON.stringify(result);
}
```

New toolbar button, visible when `perms.canPreviewPayoutStatement` (new
perm flag, `true` for CEO/HR_ACCOUNTING — mirrors `perms.canGenerateTimesheet`'s
existing pattern). Click handler:
1. `prompt()` for period (`'YYYY-MM'`, blank = current).
2. `confirm()`: *"Also include quarterly bonus preview for Q<N> <year>?"*
   (quarter inferred from the chosen month) — only if yes, prompt is skipped
   (quarter/year derived, not re-asked) and `includeQuarterly=true` is sent.
3. Call `portal_previewPayoutStatement`, show a toast with the result count
   on success.

`runBonusRun`'s existing portal wrapper (`portal_runBonusRun`,
`Portal.gs:763`) is unchanged. `runPayrollRun` itself has **no** portal
wrapper today — confirmed no `portal_runPayrollRun` exists; base pay is
still triggered from the Apps Script editor only, matching
`CTO_TASK_QUEUE.md`'s existing note. This feature does not change that —
the new HR-summary send is internal to `PayrollEngine.gs` and fires
regardless of how `runPayrollRun` was invoked, so it needs no new portal
wrapper of its own. Adding a portal button for base-pay commit itself is a
separate, unscoped change.

## 6. RBAC — no changes

Confirmed in §2.2: `PAYROLL_PREVIEW` and `PAYROLL_VIEW` are already granted
to `CEO` and `HR_ACCOUNTING`, and `PAYROLL_PREVIEW` is already in
`HR_ACCOUNTING_FINANCIAL_ACTIONS_`. `RBAC.gs` is not touched by this
feature.

## 7. Rename scope — "Paystub" → "Payout Statement"

Applies to **all user-facing text** (what a human reads: email
subject/body, UI labels, log/toast messages, JSDoc comments). Internal code
identifiers (function/variable names, CSS ids/classes, JSON field names) are
**left unchanged** — renaming `sendPaystubEmail_`/`confirmPaystub`/
`#paystub-banner`/`paystub_pending` etc. adds real risk (call-site breakage,
CSS selector drift) for zero legal benefit, since nothing in an internal
identifier is ever shown to a person.

Confirmed via full-codebase sweep — exact scope:

| File | What changes |
|---|---|
| `src/10-payroll/PayrollEngine.gs` | Email subject (`'BLC Paystub — ...'` → `'BLC Payout Statement — ...'`), `'PAYSTUB SUMMARY'` header, all `Logger`/return `message` strings, box-comment/JSDoc prose (lines 16, 25, 368, 370, 378, 385, 391, 402, 418, 426, 454, 558, 916, 949, 1065, 1077, 1084) |
| `src/07-portal/PortalView.html` | Banner heading `"⚠ Paystub Confirmation Required"` (line 330), button label `"✓ Confirm My Paystub"` (line 333), toast fallback `'Paystub confirmed.'` (line 4399) |
| `src/08-staff/StaffOnboarding.gs:433` | Contract boilerplate — *"their monthly paystub in the BLC Portal"* → *"their monthly payout statement in the BLC Portal"*. Most legally-relevant single occurrence in the codebase; found during the rename sweep, not part of the original ask. |
| `Portal.gs`, `PortalData.gs`, `RBAC.gs` | No changes — every match is an internal identifier or comment |

Not in scope for this implementation (optional follow-up, non-blocking):
`docs/superpowers/specs/2026-04-07-quarterly-bonus-engine-design.md` and
`2026-04-15-annual-bonus-design.md` (historical design specs for other
features, reference "paystub" in scope-description prose) and
`CTO_TASK_QUEUE.md`'s TASK NEW-1 entry itself (references `sendPaystubEmail_`
by name, which is intentionally correct — that's the real, unrenamed
function name). `SESSION_LOG.md` is a historical record and must not be
edited.

### 7a. Documentation fix — `.claude/context/payroll-rules.md`

Part of this feature, per §2.7's user-confirmed decision. The file's
"Supervisor Bonus" section currently describes the PM branch as
`pm_code`-scoped (stale, pre-Phase-B1). Correct it to describe the actual
live rule: flat, company-wide, `INR 25 × Σ(design_hours of every non-PM
staff member)`, no `pm_code` lookup — and add a one-line note on the
multi-PM caveat (identical total credited to every active PM if more than
one exists) so a future reader isn't misled the way this session was. This
is a doc-only change — no code in `PayrollEngine.gs`'s bonus functions
changes as part of it.

## 8. Error handling

- Every new/changed function follows existing non-fatal-email conventions:
  a failed `MailApp.sendEmail` in `sendPayoutStatementSummary_` logs a
  warning and does not throw or block the caller.
- `previewPayoutStatement` on a period with zero work-log hours returns an
  empty `basePay`/`supervisorBonus` (matching `runPayrollRun`'s existing
  `PAYROLL_NO_HOURS` handling) rather than erroring — the summary email
  still sends, noting nothing to report for that period.
- RBAC denial (non-CEO/HR_ACCOUNTING actor) throws the standard
  `RBACError_`/`FINANCIAL_ACCESS_DENIED` path, unchanged from every other
  payroll action.

## 9. Testing plan (T1: happy path + RBAC denial + invalid input + duplicate submission)

- **`computePersonPay_` extraction is a pure refactor** — the existing
  `runPayrollRun` test suite (including the idempotency test at
  `src/setup/TestRunner.gs:2174-2178`, "second payroll run is idempotent")
  must still pass unchanged. This is the most important regression check:
  it directly catches the idempotency-break failure mode identified during
  design review if the refactor is ever done wrong.
- **`previewPayoutStatement`**: happy path (base pay + supervisor bonus
  computed, HR email sent, zero FACT writes, zero consultant emails); RBAC
  denial (DESIGNER/PM/TEAM_LEAD/QC/ADMIN/CLIENT all rejected); repeatable
  (same period previewed twice → identical result, no skip/dedup applied);
  empty-hours period (graceful empty summary, not a thrown error);
  `includeQuarterly=true` path (quarterly section present, correctly
  labeled with the derived quarter/year); `includeQuarterly=false`/omitted
  (quarterly section absent from the email).
- **`sendPayoutStatementSummary_`**: each section-presence combination
  (base-only, bonus-only, base+bonus, all three); missing
  `PAYOUT_STATEMENT_REVIEW_RECIPIENT` Script Property (warns, no throw).
- **`runPayrollRun`/`runBonusRun` regression**: confirm each still sends its
  own HR summary exactly once per successful commit, with `committed: true`
  wording, and that neither's existing per-consultant/per-supervisor email
  behavior changed.
- Per `PROJECT_MEMORY.md` §3.1 (verification depth for money/aggregation
  code): a live DEV run against real `DAL`/Sheets behavior is required
  before this is trusted, in addition to Jest — not a substitute for it.
  Every recent payroll-adjacent feature in this codebase has found real
  bugs invisible to mocked tests alone.

## 10. Out of scope

- Real PDF/document-format payout statements (plain-text batch summary only
  — see §2.3).
- Scheduled/automatic monthly generation (manual portal trigger only — see
  §2.4).
- Any change to `HR_ACCOUNTING`'s RBAC grants (none needed — see §6).
- Renaming historical docs/session logs (see §7's "not in scope" list).
- `QcProcessAdminEngine`/other unrelated Wave 2 work — untouched by this
  feature.
