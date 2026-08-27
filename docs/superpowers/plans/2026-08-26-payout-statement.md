# Payout Statement Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give CEO and HR admin (`HR_ACCOUNTING`) a portal-triggered way to preview or receive a "Payout Statement" summary (base pay, supervisor bonus, optional quarterly bonus) emailed to an HR review address, without disturbing the existing per-consultant confirm-gate flow.

**Architecture:** A pure per-person pay helper (`computePersonPay_`) is extracted from `runPayrollRun`'s loop and reused by a new no-write preview function (`previewPayoutStatement`). A new email builder (`sendPayoutStatementSummary_`) is called by the preview path and, additively, by the two existing real-commit functions (`runPayrollRun`, `runBonusRun`) when they commit. A new portal endpoint and toolbar button expose the preview trigger to CEO/HR_ACCOUNTING using RBAC actions that already grant them access today. A separate, independent task renames all "Paystub" user-facing text to "Payout Statement."

**Tech Stack:** Google Apps Script (V8), Jest (Node) for unit tests against `src/` via `eval()`-loaded source + hand-written GAS-global mocks, `.claude/context/testing-policy.md`'s synthetic-identity conventions for anything that would also run live in DEV.

**Spec:** `docs/superpowers/specs/2026-08-26-payout-statement-design.md` (commit `b246119`)

## Global Constraints

- Every new user-facing string (email subject/body, UI labels, toasts) says **"Payout Statement,"** never "Paystub." Internal code identifiers (`sendPaystubEmail_`, `confirmPaystub`, `#paystub-banner`, `paystub_pending`) stay unchanged — spec §7.
- **No RBAC matrix changes.** Every new gate reuses `RBAC.ACTIONS.PAYROLL_PREVIEW` / `PAYROLL_VIEW`, both already `true` for `CEO` and `HR_ACCOUNTING` — spec §2.2/§6.
- HR review recipient comes from Script Property `PAYOUT_STATEMENT_REVIEW_RECIPIENT` (default `'HR@bluelotuscanada.ca'` if unset), never hardcoded — spec §4.3.
- `computePersonPay_` must preserve the exact double-rounding behavior (`design_pay`/`qc_pay` each rounded independently, then `total_pay` rounded again after summing) — spec §4.1. Collapsing this into one rounding pass silently changes totals by a cent.
- Quarterly bonus is a separate, clearly-labeled section, never summed into any total. Annual bonus is explicitly **out of scope** (year-scoped ledger key risks double-counting across months) — spec §2.8.
- **No PROD deploy step anywhere in this plan.** DEV push + live DEV verification only. PROD requires separate explicit user approval per `CLAUDE.md` R9 — not part of any task below.
- Test data uses synthetic person codes/emails only (`PM1`/`TL1`/`DES1`-style codes, `test-*@test.blc.internal` emails), matching `.claude/rules/testing-policy.md` and the precedent in `tests/payroll-engine-pm-bonus.test.js` — never real staff identities.

---

## Task 1: Extract `computePersonPay_` and refactor `runPayrollRun` to use it

**Files:**
- Modify: `src/10-payroll/PayrollEngine.gs` (add `computePersonPay_` as a new "SECTION 4a," insert immediately before the existing `// SECTION 5: SUPERVISOR BONUS CALCULATION` comment block; modify `runPayrollRun`'s per-person loop body; add `computePersonPay_` to the public API export object)
- Test: Create `tests/payroll-engine-payout-statement.test.js`

**Interfaces:**
- Produces: `PayrollEngine.computePersonPay_(staff, personCode, hours, fxCache)` → `{ person_code, name, design_hours, qc_hours, design_pay, qc_pay, total_pay, currency }` — a **pure** function (no DAL reads/writes, no logging, no side effects). Every later task in this plan that needs per-person pay math calls this, not a reimplementation.

- [ ] **Step 1: Write the failing tests**

Create `tests/payroll-engine-payout-statement.test.js`:

```javascript
/**
 * payroll-engine-payout-statement.test.js
 *
 * Tests for the Payout Statement Summary feature (TASK NEW-1). Spec:
 * docs/superpowers/specs/2026-08-26-payout-statement-design.md.
 *
 * Task 1: computePersonPay_() — pure per-person pay math extracted from
 * runPayrollRun()'s loop, reused by both the real commit run and the new
 * no-write preview path (Task 3).
 */

const fs   = require('fs');
const path = require('path');
const { installV3StaffMocks } = require('./gas-v3-staff-mocks');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let mocks;

beforeEach(() => {
  mocks = installV3StaffMocks();
  mocks.RBAC.ACTIONS.PAYROLL_PREVIEW = 'PAYROLL_PREVIEW';
  mocks.Config.TABLES.FACT_WORK_LOGS       = 'FACT_WORK_LOGS';
  mocks.Config.TABLES.FACT_PAYROLL_LEDGER  = 'FACT_PAYROLL_LEDGER';
  mocks.Config.TABLES.MART_PAYROLL_SUMMARY = 'MART_PAYROLL_SUMMARY';
  mocks.Config.TABLES.DIM_FX_RATES         = 'DIM_FX_RATES';
  global.HealthMonitor = {
    startExecution: function () {}, endExecution: function () {}, isApproachingLimit: function () { return false; }
  };
  global.MailApp = { sendEmail: jest.fn() };
  global.PropertiesService = {
    getScriptProperties: function () { return { getProperty: function () { return null; } }; }
  };
  mocks.DAL.ensurePartition = function () {};
  mocks.DAL.appendRows = function (t, rows) { rows.forEach(function (r) { mocks.DAL.appendRow(t, r); }); };
  loadSrc('../src/00-foundation/Constants.gs');
  loadSrc('../src/06-handlers/WorkLogExclusion.gs');
  loadSrc('../src/06-handlers/WorkLogAggregation.gs');
  loadSrc('../src/10-payroll/PayrollEngine.gs');
});

function staff(overrides) {
  return Object.assign({
    name: 'Test Staff', role: 'DESIGNER', pay_currency: 'INR',
    pay_design: 300, pay_qc: 200, supervisor_code: '', pm_code: ''
  }, overrides);
}

describe('PayrollEngine.computePersonPay_() — pure per-person pay math', () => {
  test('computes design pay + qc pay + total, no conversion when pay_currency is INR', () => {
    var s     = staff({ name: 'Rita Nair', pay_design: 300, pay_qc: 200 });
    var hours = { design_hours: 10, qc_hours: 2 };

    var result = PayrollEngine.computePersonPay_(s, 'RND', hours, {});

    expect(result).toEqual({
      person_code: 'RND', name: 'Rita Nair',
      design_hours: 10, qc_hours: 2,
      design_pay: 3000, qc_pay: 400, total_pay: 3400,
      currency: 'INR'
    });
  });

  test('converts a non-INR pay_currency via fxCache, same as toInr_', () => {
    var s       = staff({ pay_currency: 'CAD', pay_design: 20, pay_qc: 0 });
    var hours   = { design_hours: 5, qc_hours: 0 };
    var fxCache = { CAD: 62.5 };

    var result = PayrollEngine.computePersonPay_(s, 'RND', hours, fxCache);

    // 5 hrs × 20 CAD/hr = 100 CAD × 62.5 = INR 6250
    expect(result.design_pay).toBe(6250);
    expect(result.total_pay).toBe(6250);
  });

  test('rounds design_pay and qc_pay independently before summing total_pay — not one combined rounding pass', () => {
    // hours × rate chosen so raw design/qc amounts each sit exactly at a
    // half-cent boundary (100.005). Verified in Node: rounding each
    // component separately then summing gives 200.02, but rounding the
    // raw combined sum in one pass gives 200.01. A refactor that collapses
    // this into a single rounding pass would silently produce the wrong
    // total by a cent.
    var s     = staff({ pay_currency: 'INR', pay_design: 100.005, pay_qc: 100.005 });
    var hours = { design_hours: 1, qc_hours: 1 };

    var result = PayrollEngine.computePersonPay_(s, 'RND', hours, {});

    expect(result.design_pay).toBe(100.01);
    expect(result.qc_pay).toBe(100.01);
    expect(result.total_pay).toBe(200.02); // NOT 200.01
  });

  test('zero hours produces zero pay, not an error', () => {
    var s      = staff();
    var result = PayrollEngine.computePersonPay_(s, 'RND', { design_hours: 0, qc_hours: 0 }, {});
    expect(result.design_pay).toBe(0);
    expect(result.qc_pay).toBe(0);
    expect(result.total_pay).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/payroll-engine-payout-statement.test.js -v`
Expected: FAIL — `TypeError: PayrollEngine.computePersonPay_ is not a function`

- [ ] **Step 3: Add `computePersonPay_` to `PayrollEngine.gs`**

Insert immediately before the `// SECTION 5: SUPERVISOR BONUS CALCULATION` comment block (currently starts with `if (role !== 'TEAM_LEAD') continue;` a few lines below it):

```javascript
  // ============================================================
  // SECTION 4a: PER-PERSON PAY CALCULATION (pure)
  //
  // Extracted from runPayrollRun()'s per-person loop (Payout Statement
  // feature, 2026-08) so the same math is reused by both the real commit
  // run and the no-write preview path (previewPayoutStatement, Task 3).
  // Deliberately excludes everything row-assembly-related (event_id,
  // actor_code, idempotency_key, status, payload_json) — those stay in
  // runPayrollRun's own loop, which wraps this function's result into the
  // full FACT_PAYROLL_LEDGER row exactly as it always has. See
  // docs/superpowers/specs/2026-08-26-payout-statement-design.md §4.1 for
  // why the signature is scoped this way — an earlier draft that included
  // actor/idempotencyKey here would have silently broken the idempotency
  // check in hasEvent_() if that field were ever dropped by mistake.
  // ============================================================

  function computePersonPay_(staff, personCode, hours, fxCache) {
    // Rounding must match exactly: design_pay and qc_pay are each rounded
    // independently inside toInr_(), then total_pay is rounded again after
    // summing the two already-rounded values — do not collapse this into a
    // single rounding pass, it changes totals by a cent in edge cases.
    var designPayInr = toInr_(hours.design_hours * staff.pay_design, staff.pay_currency, fxCache);
    var qcPayInr     = toInr_(hours.qc_hours     * staff.pay_qc,     staff.pay_currency, fxCache);
    var totalInr     = Math.round((designPayInr + qcPayInr) * 100) / 100;

    return {
      person_code:  personCode,
      name:         staff.name,
      design_hours: hours.design_hours,
      qc_hours:     hours.qc_hours,
      design_pay:   designPayInr,
      qc_pay:       qcPayInr,
      total_pay:    totalInr,
      currency:     'INR'
    };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/payroll-engine-payout-statement.test.js -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Refactor `runPayrollRun`'s loop to call `computePersonPay_`**

In `runPayrollRun`, replace the block that currently reads:

```javascript
          var hours = hoursMap[personCode];

          // Convert pay rates to INR
          var designPayInr = toInr_(hours.design_hours * staff.pay_design, staff.pay_currency, fxCache);
          var qcPayInr     = toInr_(hours.qc_hours     * staff.pay_qc,     staff.pay_currency, fxCache);
          var totalInr     = Math.round((designPayInr + qcPayInr) * 100) / 100;

          var payrollRow = {
            event_id:        Identifiers.generateId(),
            period_id:       periodId,
            event_type:      'PAYROLL_CALCULATED',
            timestamp:       new Date().toISOString(),
            actor_code:      actor.personCode || '',
            actor_role:      actor.role       || '',
            person_code:     personCode,
            design_hours:    hours.design_hours,
            qc_hours:        hours.qc_hours,
            design_pay:      designPayInr,
            qc_pay:          qcPayInr,
            bonus_amount:    0,
            total_pay:       totalInr,
            status:          'PENDING_CONFIRMATION',
            notes:           'Base pay (' + staff.pay_currency + '→INR)',
            idempotency_key: idempotencyKey,
            payload_json:    JSON.stringify({
              name:         staff.name,
              pay_currency: staff.pay_currency,
              pay_design:   staff.pay_design,
              pay_qc:       staff.pay_qc
            })
          };

          DAL.appendRow(Config.TABLES.FACT_PAYROLL_LEDGER, payrollRow, {
            callerModule: MODULE, periodId: periodId
          });

          sendPaystubEmail_(staff, personCode, periodId, payrollRow);

          byPerson.push({
            person_code:  personCode,
            name:         staff.name,
            design_hours: hours.design_hours,
            qc_hours:     hours.qc_hours,
            design_pay:   designPayInr,
            qc_pay:       qcPayInr,
            total_pay:    totalInr,
            currency:     'INR'
          });
          processed++;

          Logger.info('PAYROLL_PERSON_CALCULATED', {
            module: MODULE, person_code: personCode, name: staff.name,
            design_hours: hours.design_hours, qc_hours: hours.qc_hours,
            total_inr: totalInr
          });
```

with:

```javascript
          var hours   = hoursMap[personCode];
          var payCalc = computePersonPay_(staff, personCode, hours, fxCache);

          var payrollRow = {
            event_id:        Identifiers.generateId(),
            period_id:       periodId,
            event_type:      'PAYROLL_CALCULATED',
            timestamp:       new Date().toISOString(),
            actor_code:      actor.personCode || '',
            actor_role:      actor.role       || '',
            person_code:     personCode,
            design_hours:    payCalc.design_hours,
            qc_hours:        payCalc.qc_hours,
            design_pay:      payCalc.design_pay,
            qc_pay:          payCalc.qc_pay,
            bonus_amount:    0,
            total_pay:       payCalc.total_pay,
            status:          'PENDING_CONFIRMATION',
            notes:           'Base pay (' + staff.pay_currency + '→INR)',
            idempotency_key: idempotencyKey,
            payload_json:    JSON.stringify({
              name:         staff.name,
              pay_currency: staff.pay_currency,
              pay_design:   staff.pay_design,
              pay_qc:       staff.pay_qc
            })
          };

          DAL.appendRow(Config.TABLES.FACT_PAYROLL_LEDGER, payrollRow, {
            callerModule: MODULE, periodId: periodId
          });

          sendPaystubEmail_(staff, personCode, periodId, payrollRow);

          byPerson.push(payCalc);
          processed++;

          Logger.info('PAYROLL_PERSON_CALCULATED', {
            module: MODULE, person_code: personCode, name: staff.name,
            design_hours: payCalc.design_hours, qc_hours: payCalc.qc_hours,
            total_inr: payCalc.total_pay
          });
```

No other line in `runPayrollRun` changes. `payCalc` has exactly the shape `byPerson` already pushed (`person_code, name, design_hours, qc_hours, design_pay, qc_pay, total_pay, currency`), so `byPerson.push(payCalc)` is behaviorally identical to the object literal it replaces.

- [ ] **Step 6: Add `computePersonPay_` to the public API export**

In the `return { ... }` block at the bottom of `PayrollEngine.gs`, add, following the existing style used for `buildPmBonusMap_`:

```javascript
    // Exposed 2026-08-26 (Payout Statement feature) — same precedent as
    // buildPmBonusMap_ above, so the Jest suite can test the real
    // per-person pay math both runPayrollRun() and previewPayoutStatement()
    // (Task 3) use, not a reimplementation. Pure — no DAL/Logger calls.
    computePersonPay_: computePersonPay_
```
(adjust the preceding line's trailing comma as needed for valid JS)

- [ ] **Step 7: Run the full Jest suite to confirm no regression**

Run: `npx jest -v`
Expected: All pre-existing suites still PASS, plus the 4 new tests from Step 1.

- [ ] **Step 8: Commit**

```bash
git add src/10-payroll/PayrollEngine.gs tests/payroll-engine-payout-statement.test.js
git commit -m "refactor: extract computePersonPay_ from runPayrollRun for reuse by Payout Statement preview"
```

---

## Task 2: `sendPayoutStatementSummary_` — the HR review email builder

**Files:**
- Modify: `src/10-payroll/PayrollEngine.gs` (add `sendPayoutStatementSummary_` and its three formatting helpers as a new "SECTION 6b," immediately after the existing `SECTION 8: BONUS EMAIL` block; add to public API export)
- Test: Modify `tests/payroll-engine-payout-statement.test.js` (append a new `describe` block)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `PayrollEngine.sendPayoutStatementSummary_(periodId, sections, meta)` where `sections = { basePay, supervisorBonus, quarterlyBonus }` (any key may be `undefined`/`null`/empty-array to omit that section) and `meta = { committed: boolean, quarterPeriodId: string|null }`. Called by Task 3 (preview) and Task 4 (real-commit wiring). `basePay` rows use the shape `computePersonPay_` (Task 1) returns; `supervisorBonus` rows use the shape `runBonusRun`'s `by_supervisor` array already uses (`person_code, name, role, bonus_amount`); `quarterlyBonus` rows use `QuarterlyBonusEngine.computeBonuses_`'s shape (`person_code, name, role, status, bonus_inr`, confirmed at `QuarterlyBonusEngine.gs:414-454`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/payroll-engine-payout-statement.test.js`:

```javascript
describe('PayrollEngine.sendPayoutStatementSummary_() — HR review email builder', () => {
  function basePayRow(overrides) {
    return Object.assign({
      person_code: 'RND', name: 'Rita Nair', design_hours: 10, qc_hours: 0,
      design_pay: 3000, qc_pay: 0, total_pay: 3000, currency: 'INR'
    }, overrides);
  }
  function supervisorRow(overrides) {
    return Object.assign({ person_code: 'TL1', name: 'TL One', role: 'TEAM_LEAD', bonus_amount: 250 }, overrides);
  }
  function quarterlyRow(overrides) {
    return Object.assign({ person_code: 'DES1', name: 'Des One', role: 'DESIGNER', status: 'CALCULATED', bonus_inr: 500 }, overrides);
  }

  test('sends one email to the Script Property recipient with subject including the period', () => {
    global.PropertiesService.getScriptProperties = function () {
      return { getProperty: function (k) { return k === 'PAYOUT_STATEMENT_REVIEW_RECIPIENT' ? 'hr-test@test.blc.internal' : null; } };
    };

    PayrollEngine.sendPayoutStatementSummary_('2026-08', { basePay: [basePayRow()] }, { committed: false, quarterPeriodId: null });

    expect(MailApp.sendEmail).toHaveBeenCalledTimes(1);
    var call = MailApp.sendEmail.mock.calls[0][0];
    expect(call.to).toBe('hr-test@test.blc.internal');
    expect(call.subject).toBe('BLC Payout Statement Summary — 2026-08 (Review)');
  });

  test('defaults to HR@bluelotuscanada.ca when the Script Property is unset', () => {
    global.PropertiesService.getScriptProperties = function () { return { getProperty: function () { return null; } }; };

    PayrollEngine.sendPayoutStatementSummary_('2026-08', { basePay: [basePayRow()] }, { committed: false, quarterPeriodId: null });

    expect(MailApp.sendEmail.mock.calls[0][0].to).toBe('HR@bluelotuscanada.ca');
  });

  test('body includes only the sections actually present', () => {
    global.PropertiesService.getScriptProperties = function () { return { getProperty: function () { return null; } }; };

    PayrollEngine.sendPayoutStatementSummary_('2026-08', { basePay: [basePayRow()] }, { committed: false, quarterPeriodId: null });
    var body1 = MailApp.sendEmail.mock.calls[0][0].body;
    expect(body1).toContain('BASE PAY');
    expect(body1).not.toContain('SUPERVISOR BONUS');
    expect(body1).not.toContain('QUARTERLY BONUS');

    MailApp.sendEmail.mockClear();
    PayrollEngine.sendPayoutStatementSummary_('2026-08', {
      basePay: [basePayRow()], supervisorBonus: [supervisorRow()], quarterlyBonus: [quarterlyRow()]
    }, { committed: false, quarterPeriodId: 'Q3-2026' });
    var body2 = MailApp.sendEmail.mock.calls[0][0].body;
    expect(body2).toContain('BASE PAY');
    expect(body2).toContain('SUPERVISOR BONUS');
    expect(body2).toContain('QUARTERLY BONUS PREVIEW — Q3-2026');
  });

  test('closing line differs based on meta.committed', () => {
    global.PropertiesService.getScriptProperties = function () { return { getProperty: function () { return null; } }; };

    PayrollEngine.sendPayoutStatementSummary_('2026-08', { basePay: [basePayRow()] }, { committed: false, quarterPeriodId: null });
    expect(MailApp.sendEmail.mock.calls[0][0].body).toContain('This is a review summary only. No payroll has been committed yet.');

    MailApp.sendEmail.mockClear();
    PayrollEngine.sendPayoutStatementSummary_('2026-08', { basePay: [basePayRow()] }, { committed: true, quarterPeriodId: null });
    expect(MailApp.sendEmail.mock.calls[0][0].body).toContain('This reflects payroll already committed for this period');
  });

  test('MailApp failure is non-fatal — logs a warning, does not throw', () => {
    global.PropertiesService.getScriptProperties = function () { return { getProperty: function () { return null; } }; };
    global.MailApp.sendEmail = jest.fn(function () { throw new Error('quota exceeded'); });
    global.Logger.warn = jest.fn();

    expect(function () {
      PayrollEngine.sendPayoutStatementSummary_('2026-08', { basePay: [basePayRow()] }, { committed: false, quarterPeriodId: null });
    }).not.toThrow();
    expect(Logger.warn).toHaveBeenCalledWith('PAYOUT_STATEMENT_SUMMARY_FAILED', expect.any(Object));
  });

  test('missing recipient (empty string default) warns and does not throw or send', () => {
    // Exercises the falsy-recipient branch directly — distinct from the
    // "Script Property unset" case above, which still resolves to the
    // hardcoded default and DOES send.
    global.PropertiesService.getScriptProperties = function () { return { getProperty: function () { return ''; } }; };
    global.Logger.warn = jest.fn();
    global.MailApp.sendEmail = jest.fn();

    // Temporarily blank the fallback by passing a periodId only — this
    // test documents intent: if a future change ever makes the default
    // itself empty, no email attempt should be made. With today's
    // hardcoded 'HR@bluelotuscanada.ca' fallback this branch is currently
    // unreachable via the Script Property alone; kept as a guard for that
    // fallback's own correctness rather than deleted.
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/payroll-engine-payout-statement.test.js -v`
Expected: FAIL — `TypeError: PayrollEngine.sendPayoutStatementSummary_ is not a function`

- [ ] **Step 3: Add `sendPayoutStatementSummary_` and its formatters to `PayrollEngine.gs`**

Insert immediately after the existing `SECTION 8: BONUS EMAIL` block (after `sendBonusEmail_`'s closing `}`):

```javascript
  // ============================================================
  // SECTION 8b: PAYOUT STATEMENT SUMMARY EMAIL
  //
  // Sends one combined review email to PAYOUT_STATEMENT_REVIEW_RECIPIENT
  // covering whichever of base pay / supervisor bonus / quarterly bonus
  // preview are present. Called by previewPayoutStatement (Task 3, no
  // write) and, additively, by runPayrollRun/runBonusRun (Task 4, on
  // real commit) — each caller passes only the section(s) it has data
  // for. Non-fatal on MailApp failure, same convention as
  // sendPaystubEmail_/sendBonusEmail_ above.
  // ============================================================

  function sendPayoutStatementSummary_(periodId, sections, meta) {
    var recipient = PropertiesService.getScriptProperties().getProperty('PAYOUT_STATEMENT_REVIEW_RECIPIENT')
      || 'HR@bluelotuscanada.ca';

    if (!recipient) {
      Logger.warn('PAYOUT_STATEMENT_NO_RECIPIENT', {
        module: MODULE, message: 'No recipient resolved — summary not sent', period_id: periodId
      });
      return;
    }

    try {
      var lines = ['Hi,', '', 'Payout statement summary for period: ' + periodId, ''];

      if (sections.basePay && sections.basePay.length > 0) {
        lines = lines.concat(formatBasePaySection_(sections.basePay));
      }
      if (sections.supervisorBonus && sections.supervisorBonus.length > 0) {
        lines = lines.concat(formatSupervisorBonusSection_(sections.supervisorBonus));
      }
      if (sections.quarterlyBonus && sections.quarterlyBonus.length > 0) {
        lines = lines.concat(formatQuarterlyBonusSection_(sections.quarterlyBonus, meta.quarterPeriodId));
      }

      lines.push(meta.committed
        ? 'This reflects payroll already committed for this period; confirmation emails have already been sent to affected staff.'
        : 'This is a review summary only. No payroll has been committed yet.');
      lines.push('');
      lines.push('— BLC Payout System');

      MailApp.sendEmail({
        to:      recipient,
        subject: 'BLC Payout Statement Summary — ' + periodId + ' (Review)',
        body:    lines.join('\n')
      });

      Logger.info('PAYOUT_STATEMENT_SUMMARY_SENT', {
        module: MODULE, message: 'Payout statement summary sent', period_id: periodId, recipient: recipient
      });
    } catch (emailErr) {
      Logger.warn('PAYOUT_STATEMENT_SUMMARY_FAILED', {
        module: MODULE, message: 'Payout statement summary email failed', period_id: periodId, error: emailErr.message
      });
    }
  }

  function formatBasePaySection_(basePay) {
    var lines = ['BASE PAY', '───────────────────────────────'];
    var total = 0;
    basePay.forEach(function (row) {
      lines.push(row.person_code + '  ' + row.name + '  Design ' + row.design_hours + 'h  QC ' +
        row.qc_hours + 'h  Design Pay INR ' + row.design_pay.toFixed(2) + '  QC Pay INR ' +
        row.qc_pay.toFixed(2) + '  Total INR ' + row.total_pay.toFixed(2));
      total += row.total_pay;
    });
    lines.push('Period Total: INR ' + (Math.round(total * 100) / 100).toFixed(2));
    lines.push('───────────────────────────────');
    lines.push('');
    return lines;
  }

  function formatSupervisorBonusSection_(supervisorBonus) {
    var lines = ['SUPERVISOR BONUS', '───────────────────────────────'];
    var total = 0;
    supervisorBonus.forEach(function (row) {
      lines.push(row.person_code + '  ' + row.name + '  ' + row.role + '  INR ' + row.bonus_amount.toFixed(2));
      total += row.bonus_amount;
    });
    lines.push('Total: INR ' + (Math.round(total * 100) / 100).toFixed(2));
    lines.push('───────────────────────────────');
    lines.push('');
    return lines;
  }

  function formatQuarterlyBonusSection_(quarterlyBonus, quarterPeriodId) {
    var lines = ['QUARTERLY BONUS PREVIEW — ' + quarterPeriodId + ' (preview, not yet committed)',
                 '───────────────────────────────'];
    quarterlyBonus.forEach(function (row) {
      lines.push(row.person_code + '  ' + row.name + '  ' + row.role + '  status=' + row.status +
        '  INR ' + (row.bonus_inr || 0).toFixed(2));
    });
    lines.push('───────────────────────────────');
    lines.push('');
    return lines;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/payroll-engine-payout-statement.test.js -v`
Expected: PASS (6 new tests; the "missing recipient" test is a documented no-op assertion, see its comment — kept for future-proofing, not currently exercising a reachable branch)

- [ ] **Step 5: Add `sendPayoutStatementSummary_` to the public API export**

```javascript
    // Exposed 2026-08-26 (Payout Statement feature) — same precedent as
    // computePersonPay_ above, so the Jest suite can test the real email
    // builder both previewPayoutStatement (Task 3) and the runPayrollRun/
    // runBonusRun commit-path wiring (Task 4) use.
    sendPayoutStatementSummary_: sendPayoutStatementSummary_
```

- [ ] **Step 6: Run the full Jest suite to confirm no regression**

Run: `npx jest -v`
Expected: All suites PASS.

- [ ] **Step 7: Commit**

```bash
git add src/10-payroll/PayrollEngine.gs tests/payroll-engine-payout-statement.test.js
git commit -m "feat: add sendPayoutStatementSummary_ email builder for HR payout review"
```

---

## Task 3: `previewPayoutStatement` — the no-write preview trigger

**Files:**
- Modify: `src/10-payroll/PayrollEngine.gs` (add `previewPayoutStatement` as a new "SECTION 13," after `approveAllPayroll`; add to public API export)
- Test: Modify `tests/payroll-engine-payout-statement.test.js` (append a new `describe` block)

**Interfaces:**
- Consumes: `computePersonPay_` (Task 1), `sendPayoutStatementSummary_` (Task 2), `buildStaffCache_`/`aggregateHours_`/`buildSupervisorBonusMap_`/`buildPmBonusMap_`/`buildFxRateCache_` (all pre-existing, unchanged), `QuarterlyBonusEngine.previewQuarterlyBonus(actorEmail, quarter, year)` (pre-existing, unchanged).
- Produces: `PayrollEngine.previewPayoutStatement(actorEmail, periodId, options)` where `options = { includeQuarterly: boolean, quarter: string, year: number }` → `{ previewed: true, period_id, by_person, by_supervisor, quarterly }`. Called by Task 5's portal endpoint.

- [ ] **Step 1: Write the failing tests**

Append to `tests/payroll-engine-payout-statement.test.js`:

```javascript
describe('PayrollEngine.previewPayoutStatement() — no-write HR/CEO preview trigger', () => {
  function seedRoster(rows) {
    mocks.store['DIM_STAFF_ROSTER'] = rows.map(r => Object.assign({
      person_code: '', name: '', email: '', role: 'DESIGNER',
      supervisor_code: '', pm_code: '', pay_currency: 'INR',
      pay_design: 0, pay_qc: 0, bonus_eligible: 'FALSE',
      active: 'TRUE', effective_from: '2025-01-01', effective_to: ''
    }, r));
  }
  function seedWorkLogs(rows) { mocks.store['FACT_WORK_LOGS'] = rows; }

  beforeEach(() => {
    global.PropertiesService.getScriptProperties = function () { return { getProperty: function () { return null; } }; };
    global.QuarterlyBonusEngine = { previewQuarterlyBonus: jest.fn(function () { return []; }) };
  });

  test('happy path: computes base pay + supervisor bonus, sends one HR email, writes nothing', () => {
    seedRoster([
      { person_code: 'TL1', role: 'TEAM_LEAD', pay_design: 300, pay_qc: 0, email: 'tl1@test.blc.internal' },
      { person_code: 'DES1', role: 'DESIGNER', supervisor_code: 'TL1', pay_design: 300, pay_qc: 0, email: 'des1@test.blc.internal' }
    ]);
    seedWorkLogs([
      { event_id: 'E1', person_code: 'DES1', actor_code: 'DES1', actor_role: 'DESIGNER',
        event_type: 'WORK_LOG_SUBMITTED', hours: 10, work_date: '2026-08-05', period_id: '2026-08' }
    ]);

    var result = PayrollEngine.previewPayoutStatement('test-ceo@test.blc.internal', '2026-08', { includeQuarterly: false });

    expect(result.previewed).toBe(true);
    expect(result.by_person.find(p => p.person_code === 'DES1').total_pay).toBe(3000);
    expect(result.by_supervisor.find(s => s.person_code === 'TL1').bonus_amount).toBe(250);
    expect(result.quarterly).toBeNull();
    expect(MailApp.sendEmail).toHaveBeenCalledTimes(1);
    expect(mocks.DAL.appendRow).not.toHaveBeenCalled();
  });

  test('calls RBAC.enforcePermission and enforceFinancialAccess with PAYROLL_PREVIEW', () => {
    seedRoster([{ person_code: 'DES1', role: 'DESIGNER', pay_design: 300, pay_qc: 0 }]);
    seedWorkLogs([{ event_id: 'E1', person_code: 'DES1', actor_code: 'DES1', actor_role: 'DESIGNER',
      event_type: 'WORK_LOG_SUBMITTED', hours: 1, work_date: '2026-08-05', period_id: '2026-08' }]);
    mocks.RBAC.enforcePermission     = jest.fn();
    mocks.RBAC.enforceFinancialAccess = jest.fn();

    PayrollEngine.previewPayoutStatement('test-hr@test.blc.internal', '2026-08', { includeQuarterly: false });

    expect(mocks.RBAC.enforcePermission).toHaveBeenCalledWith(expect.any(Object), 'PAYROLL_PREVIEW');
    expect(mocks.RBAC.enforceFinancialAccess).toHaveBeenCalledWith(expect.any(Object), 'PAYROLL_PREVIEW');
    // NOTE: gas-v3-staff-mocks.js's RBAC mock always resolves the actor as
    // CEO and always passes both calls — it cannot simulate a denied,
    // non-CEO/HR_ACCOUNTING role. This test proves the gate is wired with
    // the correct action constant (a real regression catch if the call is
    // ever removed or mis-specified); true role-based denial can only be
    // verified live in DEV, per PROJECT_MEMORY.md §3.1 — see Task 8.
  });

  test('repeatable: same period previewed twice gives identical results, no skip/dedup applied', () => {
    seedRoster([{ person_code: 'DES1', role: 'DESIGNER', pay_design: 300, pay_qc: 0 }]);
    seedWorkLogs([{ event_id: 'E1', person_code: 'DES1', actor_code: 'DES1', actor_role: 'DESIGNER',
      event_type: 'WORK_LOG_SUBMITTED', hours: 10, work_date: '2026-08-05', period_id: '2026-08' }]);

    var first  = PayrollEngine.previewPayoutStatement('test-ceo@test.blc.internal', '2026-08', { includeQuarterly: false });
    var second = PayrollEngine.previewPayoutStatement('test-ceo@test.blc.internal', '2026-08', { includeQuarterly: false });

    expect(second.by_person).toEqual(first.by_person);
    expect(MailApp.sendEmail).toHaveBeenCalledTimes(2); // both calls actually sent, no dedup
  });

  test('empty-hours period returns a graceful empty summary, not a thrown error', () => {
    seedRoster([{ person_code: 'DES1', role: 'DESIGNER', pay_design: 300, pay_qc: 0 }]);
    seedWorkLogs([]);

    var result = PayrollEngine.previewPayoutStatement('test-ceo@test.blc.internal', '2026-08', { includeQuarterly: false });

    expect(result.previewed).toBe(true);
    expect(result.by_person).toEqual([]);
  });

  test('includeQuarterly=true calls previewQuarterlyBonus and includes its result', () => {
    seedRoster([{ person_code: 'DES1', role: 'DESIGNER', pay_design: 300, pay_qc: 0 }]);
    seedWorkLogs([{ event_id: 'E1', person_code: 'DES1', actor_code: 'DES1', actor_role: 'DESIGNER',
      event_type: 'WORK_LOG_SUBMITTED', hours: 5, work_date: '2026-09-05', period_id: '2026-09' }]);
    QuarterlyBonusEngine.previewQuarterlyBonus.mockReturnValue([
      { person_code: 'DES1', name: 'Des One', role: 'DESIGNER', status: 'CALCULATED', bonus_inr: 500 }
    ]);

    var result = PayrollEngine.previewPayoutStatement('test-ceo@test.blc.internal', '2026-09',
      { includeQuarterly: true, quarter: 'Q3', year: 2026 });

    expect(QuarterlyBonusEngine.previewQuarterlyBonus).toHaveBeenCalledWith('test-ceo@test.blc.internal', 'Q3', 2026);
    expect(result.quarterly).toEqual([{ person_code: 'DES1', name: 'Des One', role: 'DESIGNER', status: 'CALCULATED', bonus_inr: 500 }]);
  });

  test('includeQuarterly=false (default) never calls previewQuarterlyBonus, quarterly is null', () => {
    seedRoster([{ person_code: 'DES1', role: 'DESIGNER', pay_design: 300, pay_qc: 0 }]);
    seedWorkLogs([{ event_id: 'E1', person_code: 'DES1', actor_code: 'DES1', actor_role: 'DESIGNER',
      event_type: 'WORK_LOG_SUBMITTED', hours: 5, work_date: '2026-08-05', period_id: '2026-08' }]);

    var result = PayrollEngine.previewPayoutStatement('test-ceo@test.blc.internal', '2026-08', { includeQuarterly: false });

    expect(QuarterlyBonusEngine.previewQuarterlyBonus).not.toHaveBeenCalled();
    expect(result.quarterly).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/payroll-engine-payout-statement.test.js -v`
Expected: FAIL — `TypeError: PayrollEngine.previewPayoutStatement is not a function`

- [ ] **Step 3: Add `previewPayoutStatement` to `PayrollEngine.gs`**

Insert as a new section immediately after `approveAllPayroll`'s closing `}` (before the `// PUBLIC API` comment block):

```javascript
  // ============================================================
  // SECTION 13: previewPayoutStatement — no-write preview for HR review
  //
  // CEO/HR_ACCOUNTING trigger. Computes base pay + supervisor bonus (and,
  // optionally, a quarterly bonus preview) for a period WITHOUT writing
  // to FACT_PAYROLL_LEDGER and WITHOUT sending any per-consultant/
  // per-supervisor confirm-gate email — only the one combined HR review
  // summary (sendPayoutStatementSummary_, Task 2). Fully repeatable: no
  // idempotency marking, same period can be previewed any number of
  // times. See docs/superpowers/specs/2026-08-26-payout-statement-design.md
  // §4.2.
  // ============================================================

  /**
   * @param {string} actorEmail
   * @param {string} periodId  'YYYY-MM'
   * @param {{ includeQuarterly: boolean, quarter: string, year: number }} options
   * @returns {{ previewed: boolean, period_id: string, by_person: Object[],
   *   by_supervisor: Object[], quarterly: Object[]|null }}
   */
  function previewPayoutStatement(actorEmail, periodId, options) {
    options = options || {};

    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_PREVIEW);
    RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.PAYROLL_PREVIEW);

    periodId = periodId || Identifiers.generateCurrentPeriodId();

    var staffCache = buildStaffCache_(periodId + '-01');
    var fxCache    = buildFxRateCache_();
    var hoursMap   = aggregateHours_(periodId);

    var basePay      = [];
    var personCodes  = Object.keys(hoursMap);

    for (var i = 0; i < personCodes.length; i++) {
      if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
        Logger.warn('PAYOUT_STATEMENT_PREVIEW_PARTIAL', {
          module: MODULE, message: 'Stopping preview — quota limit approaching',
          processed: i, remaining: personCodes.length - i
        });
        break;
      }
      var personCode = personCodes[i];
      var staff       = staffCache[personCode];
      if (!staff) continue;
      basePay.push(computePersonPay_(staff, personCode, hoursMap[personCode], fxCache));
    }

    var tlBonusMap = buildSupervisorBonusMap_(staffCache, hoursMap);
    var pmBonusMap = buildPmBonusMap_(staffCache, hoursMap);
    var bonusMap   = {};
    Object.keys(tlBonusMap).forEach(function (code) { bonusMap[code] = tlBonusMap[code]; });
    Object.keys(pmBonusMap).forEach(function (code) { bonusMap[code] = pmBonusMap[code]; });

    var supervisorBonus = Object.keys(bonusMap).map(function (code) {
      var staff = staffCache[code];
      return { person_code: code, name: staff.name, role: staff.role, bonus_amount: bonusMap[code] };
    });

    var quarterlyBonus     = null;
    var quarterPeriodId    = null;
    if (options.includeQuarterly) {
      quarterlyBonus  = QuarterlyBonusEngine.previewQuarterlyBonus(actorEmail, options.quarter, options.year);
      quarterPeriodId = options.quarter + '-' + options.year;
    }

    sendPayoutStatementSummary_(periodId, {
      basePay:         basePay,
      supervisorBonus: supervisorBonus,
      quarterlyBonus:  quarterlyBonus
    }, { committed: false, quarterPeriodId: quarterPeriodId });

    Logger.info('PAYOUT_STATEMENT_PREVIEWED', {
      module: MODULE, message: 'Payout statement previewed', period_id: periodId,
      base_pay_count: basePay.length, supervisor_bonus_count: supervisorBonus.length
    });

    return {
      previewed:     true,
      period_id:     periodId,
      by_person:     basePay,
      by_supervisor: supervisorBonus,
      quarterly:     quarterlyBonus
    };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/payroll-engine-payout-statement.test.js -v`
Expected: PASS (6 new tests)

- [ ] **Step 5: Add `previewPayoutStatement` to the public API export**

```javascript
    /**
     * CEO/HR_ACCOUNTING preview trigger — computes base pay + supervisor
     * bonus (+ optional quarterly bonus) for a period and sends ONE
     * combined summary to the HR review recipient. No FACT write, no
     * per-consultant/per-supervisor email, fully repeatable.
     */
    previewPayoutStatement: previewPayoutStatement,
```

- [ ] **Step 6: Run the full Jest suite to confirm no regression**

Run: `npx jest -v`
Expected: All suites PASS.

- [ ] **Step 7: Commit**

```bash
git add src/10-payroll/PayrollEngine.gs tests/payroll-engine-payout-statement.test.js
git commit -m "feat: add previewPayoutStatement, the no-write CEO/HR_ACCOUNTING preview trigger"
```

---

## Task 4: Wire the HR summary into `runPayrollRun` and `runBonusRun`'s real commit paths

**Files:**
- Modify: `src/10-payroll/PayrollEngine.gs` (`runPayrollRun`, `runBonusRun`)
- Test: Modify `tests/payroll-engine-pm-bonus.test.js` (extend the existing `runBonusRun` describe block); modify `tests/payroll-engine-payout-statement.test.js` (append a `runPayrollRun` describe block, since no prior Jest coverage of `runPayrollRun` exists — see note below)

**Interfaces:**
- Consumes: `sendPayoutStatementSummary_` (Task 2).
- Produces: no new exports — this task only adds one call each inside two existing, already-exported functions.

- [ ] **Step 1: Write the failing tests**

Append to `tests/payroll-engine-payout-statement.test.js` (this file has no prior `runPayrollRun` coverage anywhere in this repo's Jest suite — the only existing regression check for it is `src/setup/TestRunner.gs`'s live GAS idempotency suite, which cannot run in this environment; see Task 8):

```javascript
describe('PayrollEngine.runPayrollRun() — additive HR summary on commit (Task 4)', () => {
  function seedRoster(rows) {
    mocks.store['DIM_STAFF_ROSTER'] = rows.map(r => Object.assign({
      person_code: '', name: '', email: '', role: 'DESIGNER',
      supervisor_code: '', pm_code: '', pay_currency: 'INR',
      pay_design: 0, pay_qc: 0, bonus_eligible: 'FALSE',
      active: 'TRUE', effective_from: '2025-01-01', effective_to: ''
    }, r));
  }
  function seedWorkLogs(rows) { mocks.store['FACT_WORK_LOGS'] = rows; }

  beforeEach(() => {
    global.PropertiesService.getScriptProperties = function () { return { getProperty: function () { return null; } }; };
  });

  test('a successful commit sends exactly one HR summary email with committed:true wording, in addition to per-consultant emails', () => {
    seedRoster([{ person_code: 'DES1', role: 'DESIGNER', pay_design: 300, pay_qc: 0, email: 'des1@test.blc.internal' }]);
    seedWorkLogs([{ event_id: 'E1', person_code: 'DES1', actor_code: 'DES1', actor_role: 'DESIGNER',
      event_type: 'WORK_LOG_SUBMITTED', hours: 10, work_date: '2026-08-05', period_id: '2026-08' }]);

    var result = PayrollEngine.runPayrollRun('test-ceo@test.blc.internal', { periodId: '2026-08' });

    expect(result.processed).toBe(1);
    // 1 per-consultant paystub email (sendPaystubEmail_) + 1 HR summary
    // (sendPayoutStatementSummary_) = 2 total MailApp calls.
    expect(MailApp.sendEmail).toHaveBeenCalledTimes(2);
    var hrCall = MailApp.sendEmail.mock.calls.find(c => c[0].subject.indexOf('Payout Statement Summary') !== -1);
    expect(hrCall[0].body).toContain('This reflects payroll already committed for this period');
  });

  test('a period with zero hours does not send an HR summary at all (matches existing PAYROLL_NO_HOURS early return)', () => {
    seedRoster([{ person_code: 'DES1', role: 'DESIGNER', pay_design: 300, pay_qc: 0 }]);
    seedWorkLogs([]);

    PayrollEngine.runPayrollRun('test-ceo@test.blc.internal', { periodId: '2026-08' });

    expect(MailApp.sendEmail).not.toHaveBeenCalled();
  });
});
```

Extend `tests/payroll-engine-pm-bonus.test.js`'s existing `describe('PayrollEngine.runBonusRun() ...')` block with:

```javascript
  test('a successful bonus commit sends exactly one HR summary email covering only supervisor bonus', () => {
    global.MailApp = { sendEmail: jest.fn() };
    global.PropertiesService = { getScriptProperties: function () { return { getProperty: function () { return null; } }; } };
    seedRoster([
      { person_code: 'TL1', role: 'TEAM_LEAD', email: 'tl1@test.blc.internal' },
      { person_code: 'DES1', role: 'DESIGNER', supervisor_code: 'TL1', email: 'des1@test.blc.internal' }
    ]);
    seedWorkLogs('2026-08', [
      { event_id: 'E1', person_code: 'DES1', actor_code: 'DES1', actor_role: 'DESIGNER',
        event_type: 'WORK_LOG_SUBMITTED', hours: 8, work_date: '2026-08-05', period_id: '2026-08' }
    ]);

    PayrollEngine.runBonusRun('ceo@test.blc.internal', { periodId: '2026-08' });

    // 1 per-supervisor bonus email (sendBonusEmail_) + 1 HR summary = 2.
    expect(MailApp.sendEmail).toHaveBeenCalledTimes(2);
    var hrCall = MailApp.sendEmail.mock.calls.find(c => c[0].subject.indexOf('Payout Statement Summary') !== -1);
    expect(hrCall[0].body).toContain('SUPERVISOR BONUS');
    expect(hrCall[0].body).not.toContain('BASE PAY');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/payroll-engine-payout-statement.test.js tests/payroll-engine-pm-bonus.test.js -v`
Expected: FAIL — the new `MailApp.sendEmail` call-count assertions fail (only the pre-existing per-person/per-supervisor email fires, no HR summary yet).

- [ ] **Step 3: Wire the call into `runPayrollRun`**

Immediately after the existing per-person loop (`for (var i = 0; i < personCodes.length; i++) { ... }`) and before the `// ── 6. Refresh MART ──` comment, add:

```javascript
      sendPayoutStatementSummary_(periodId, { basePay: byPerson }, { committed: true, quarterPeriodId: null });
```

(Placed after the loop, before `if (processed > 0) refreshMartPayrollSummary_(periodId);` — fires once per successful run regardless of `processed` count, matching the "zero-hours period returns early before this point anyway" early-return at `PAYROLL_NO_HOURS`.)

- [ ] **Step 4: Wire the call into `runBonusRun`**

Immediately after `runBonusRun`'s write loop, in the same relative position (after the loop, before `if (processed > 0) refreshMartPayrollSummary_(periodId);`), add:

```javascript
      sendPayoutStatementSummary_(periodId, { supervisorBonus: bySupervisor }, { committed: true, quarterPeriodId: null });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/payroll-engine-payout-statement.test.js tests/payroll-engine-pm-bonus.test.js -v`
Expected: PASS.

- [ ] **Step 6: Run the full Jest suite to confirm no regression**

Run: `npx jest -v`
Expected: All suites PASS.

- [ ] **Step 7: Commit**

```bash
git add src/10-payroll/PayrollEngine.gs tests/payroll-engine-payout-statement.test.js tests/payroll-engine-pm-bonus.test.js
git commit -m "feat: send HR payout summary on every real payroll/bonus commit, additive to existing emails"
```

---

## Task 5: Portal endpoint — `portal_previewPayoutStatement`

**Files:**
- Modify: `src/07-portal/Portal.gs` (add new endpoint, immediately after `portal_approveAllPayroll`)
- Modify: `src/07-portal/PortalData.gs` (`buildPerms_`, add `canPreviewPayoutStatement`)
- Test: Create `tests/portal-preview-payout-statement.test.js`

**Interfaces:**
- Consumes: `PayrollEngine.previewPayoutStatement` (Task 3).
- Produces: `portal_previewPayoutStatement(ptoken, periodId, includeQuarterly, quarter, year)` → JSON string of `previewPayoutStatement`'s return value. `perms.canPreviewPayoutStatement` (boolean) available to `PortalView.html` (Task 6).

- [ ] **Step 1: Write the failing test**

Create `tests/portal-preview-payout-statement.test.js`:

```javascript
/**
 * portal-preview-payout-statement.test.js
 *
 * Tests for portal_previewPayoutStatement (Portal.gs) — thin wrapper
 * around PayrollEngine.previewPayoutStatement. Follows the same
 * thin-wrapper-not-unit-tested-beyond-plumbing precedent as
 * portal_runBonusRun/portal_approveAllPayroll (no dedicated Jest suite
 * for those either) — this suite verifies argument plumbing and JSON
 * serialization only, not the underlying payroll math (covered in
 * payroll-engine-payout-statement.test.js).
 */

function installMocks(previewResult) {
  global.PortalAuth = { resolveEmail: jest.fn(function () { return 'test-ceo@test.blc.internal'; }) };
  global.PayrollEngine = { previewPayoutStatement: jest.fn(function () { return previewResult; }) };
}

const fs   = require('fs');
const path = require('path');
function loadSrc(relPath) { (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8')); }

beforeEach(() => {
  installMocks({ previewed: true, period_id: '2026-08', by_person: [], by_supervisor: [], quarterly: null });
  loadSrc('../src/07-portal/Portal.gs');
});

test('resolves the actor from ptoken and calls PayrollEngine.previewPayoutStatement with parsed options', () => {
  var json = portal_previewPayoutStatement('TOKEN123', '2026-08', true, 'Q3', '2026');

  expect(PortalAuth.resolveEmail).toHaveBeenCalledWith('TOKEN123');
  expect(PayrollEngine.previewPayoutStatement).toHaveBeenCalledWith(
    'test-ceo@test.blc.internal', '2026-08', { includeQuarterly: true, quarter: 'Q3', year: 2026 }
  );
  expect(JSON.parse(json).period_id).toBe('2026-08');
});

test('blank periodId and no quarterly args pass through as empty/false defaults', () => {
  portal_previewPayoutStatement('TOKEN123', '', undefined, undefined, undefined);

  expect(PayrollEngine.previewPayoutStatement).toHaveBeenCalledWith(
    'test-ceo@test.blc.internal', '', { includeQuarterly: false, quarter: '', year: null }
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/portal-preview-payout-statement.test.js -v`
Expected: FAIL — `portal_previewPayoutStatement is not defined` (loading `Portal.gs` alone without the function will throw a `ReferenceError` on call, or the test fails on the missing function).

- [ ] **Step 3: Add `portal_previewPayoutStatement` to `Portal.gs`**

Insert immediately after `portal_approveAllPayroll`'s closing `}`:

```javascript
// ============================================================
// portal_previewPayoutStatement — CEO/HR_ACCOUNTING preview & send to HR
// ============================================================

/**
 * Computes base pay + supervisor bonus (+ optional quarterly bonus) for a
 * period and sends ONE combined review summary to the HR review
 * recipient. No FACT write, no per-consultant/per-supervisor email,
 * repeatable.
 *
 * @param {string} periodId          'YYYY-MM', blank = current period
 * @param {boolean} includeQuarterly Include a quarterly bonus preview section
 * @param {string} quarter           'Q1'|'Q2'|'Q3'|'Q4', only read when includeQuarterly
 * @param {string|number} year       e.g. 2026, only read when includeQuarterly
 * @returns {string}  JSON: { previewed, period_id, by_person, by_supervisor, quarterly }
 */
function portal_previewPayoutStatement(ptoken, periodId, includeQuarterly, quarter, year) {
  var email  = PortalAuth.resolveEmail(ptoken);
  var result = PayrollEngine.previewPayoutStatement(email, periodId || '', {
    includeQuarterly: !!includeQuarterly,
    quarter:          quarter || '',
    year:             parseInt(year, 10) || null
  });
  return JSON.stringify(result);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/portal-preview-payout-statement.test.js -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Add `canPreviewPayoutStatement` to `buildPerms_` in `PortalData.gs`**

In `buildPerms_`, immediately after the existing `canGenerateTimesheet` line, add:

```javascript
      // Payout Statement preview, CEO/HR_ACCOUNTING only — RBAC matrix
      // already gates PAYROLL_PREVIEW to CEO/SYSTEM/HR_ACCOUNTING (no
      // matrix change needed, see design spec §6).
      canPreviewPayoutStatement: RBAC.hasPermission(actor, RBAC.ACTIONS.PAYROLL_PREVIEW),
```

- [ ] **Step 6: Run the full Jest suite to confirm no regression**

Run: `npx jest -v`
Expected: All suites PASS.

- [ ] **Step 7: Commit**

```bash
git add src/07-portal/Portal.gs src/07-portal/PortalData.gs tests/portal-preview-payout-statement.test.js
git commit -m "feat: add portal_previewPayoutStatement endpoint and canPreviewPayoutStatement perm"
```

---

## Task 6: Portal UI — "Generate Payout Statement" button

**Files:**
- Modify: `src/07-portal/PortalView.html` (toolbar button, two perm show/hide sites, click handler)

No new automated test — this is GAS-served HTML/JS with no Jest harness in this codebase (matches the existing precedent: `PortalView.html`'s UI wiring for `canGenerateTimesheet`/the Generate Timesheet modal has no Jest coverage either, only live DEV verification). Manual verification happens in Task 8's DEV checklist.

**Interfaces:**
- Consumes: `perms.canPreviewPayoutStatement` (Task 5), `portal_previewPayoutStatement` (Task 5, via `google.script.run`).

- [ ] **Step 1: Add the toolbar button**

Immediately after the existing `btn-generate-timesheet` button line:

```html
      <button class="btn-muted btn-sm" id="btn-generate-timesheet" style="display:none">📄 Generate Timesheet</button>
      <button class="btn-muted btn-sm" id="btn-preview-payout-statement" style="display:none">📧 Generate Payout Statement</button>
```

- [ ] **Step 2: Show the button for `canPreviewPayoutStatement`, at both existing show/hide sites**

At the site next to the `canGenerateTimesheet` line noted as "Not nested in the isLeader-gated block below — HR_ACCOUNTING has canGenerateTimesheet but is not a leader":

```javascript
  if (_data.perms.canGenerateTimesheet) document.getElementById('btn-generate-timesheet').style.display = 'inline-block';
  if (_data.perms.canPreviewPayoutStatement) document.getElementById('btn-preview-payout-statement').style.display = 'inline-block';
```

At the second site (the `perms.canGenerateTimesheet` line in the other render path):

```javascript
  if (perms.canGenerateTimesheet) document.getElementById('btn-generate-timesheet').style.display = 'inline-block';
  if (perms.canPreviewPayoutStatement) document.getElementById('btn-preview-payout-statement').style.display = 'inline-block';
```

- [ ] **Step 3: Wire the click handler**

Near the existing `document.getElementById('btn-generate-timesheet').addEventListener(...)` line, add:

```javascript
  document.getElementById('btn-preview-payout-statement').addEventListener('click', previewPayoutStatement);
```

- [ ] **Step 4: Add the `previewPayoutStatement` JS function**

Near `openGenerateTimesheetModal`/`submitGenerateTimesheet` (same functional area of the file):

```javascript
function previewPayoutStatement() {
  var periodId = window.prompt('Period to preview (YYYY-MM), blank = current period:', '');
  if (periodId === null) return; // user cancelled

  var includeQuarterly = false;
  var quarter = '', year = '';
  var now = new Date();
  var monthIndex = periodId ? (parseInt(periodId.split('-')[1], 10) - 1) : now.getMonth();
  var yearGuess   = periodId ? periodId.split('-')[0] : String(now.getFullYear());
  var quarterGuess = 'Q' + (Math.floor(monthIndex / 3) + 1);

  if (window.confirm('Also include quarterly bonus preview for ' + quarterGuess + ' ' + yearGuess + '?')) {
    includeQuarterly = true;
    quarter = quarterGuess;
    year    = yearGuess;
  }

  TOKEN_RUN
    .withSuccessHandler(function (json) {
      var result = JSON.parse(json);
      showToast('Payout statement preview sent for ' + result.period_id + ' — ' +
        result.by_person.length + ' base pay, ' + result.by_supervisor.length + ' bonus rows.', 'success');
    })
    .withFailureHandler(function (err) {
      showToast('Could not generate payout statement preview: ' + err.message, 'error');
    })
    .portal_previewPayoutStatement(periodId, includeQuarterly, quarter, year);
}
```

(`TOKEN_RUN` and `showToast` are this file's existing `google.script.run`-wrapping helper and toast utility, used identically by every other portal action in this file — e.g. `submitGenerateTimesheet`.)

- [ ] **Step 5: Manual smoke check (no Jest for this file)**

Confirm by reading the diff: button id `btn-preview-payout-statement` appears exactly once in the toolbar HTML, exactly twice in show/hide JS (both render paths), and the click listener references the same id. Full functional verification happens live in DEV — Task 8.

- [ ] **Step 6: Commit**

```bash
git add src/07-portal/PortalView.html
git commit -m "feat: add Generate Payout Statement button to portal toolbar"
```

---

## Task 7: Rename "Paystub" → "Payout Statement" in all user-facing text

**Files:**
- Modify: `src/10-payroll/PayrollEngine.gs` (email subject/body, log/return messages, JSDoc — lines identified in spec §7's table: 16, 25, 368, 370, 378, 385, 391, 402, 418, 426, 454, 558, 916, 949, 1065, 1077, 1084)
- Modify: `src/07-portal/PortalView.html` (banner heading line 330, button label line 333, toast fallback line 4399)
- Modify: `src/08-staff/StaffOnboarding.gs` (contract text, line 433)
- Test: no new tests — this is a pure string-literal rename with zero logic change. Existing test suites (Tasks 1-4's, plus any pre-existing suite referencing these files) must still pass unchanged, since none of them assert on the literal old wording (confirmed: no test in `tests/` currently matches on `'BLC Paystub'`, `'PAYSTUB SUMMARY'`, or the exact confirm-banner/button strings — grepped as part of this task's Step 1).

**Interfaces:** none — text-only change, no signatures affected.

- [ ] **Step 1: Confirm no existing test asserts on the old literal strings**

Run: `grep -rn "BLC Paystub\|PAYSTUB SUMMARY\|Confirm My Paystub\|Paystub Confirmation Required\|Paystub confirmed\.\|paystub in the BLC Portal" tests/`
Expected: no matches. (If any match is found, update that test's expected string in the same commit as the source change below — do not leave a test asserting stale wording.)

- [ ] **Step 2: Rename in `PayrollEngine.gs`**

Apply these exact literal replacements (case-sensitive, whole-string):

| Current | New |
|---|---|
| `'BLC Paystub — ' + periodId + ' (Action Required)'` | `'BLC Payout Statement — ' + periodId + ' (Action Required)'` |
| `'PAYSTUB SUMMARY'` | `'PAYOUT STATEMENT SUMMARY'` |
| `'Please review and confirm your paystub by logging in to the BLC Portal.'` | `'Please review and confirm your payout statement by logging in to the BLC Portal.'` |
| `'Please confirm your paystub in the BLC Portal.'` | `'Please confirm your payout statement in the BLC Portal.'` |
| `'No email for staff member — paystub not sent'` | `'No email for staff member — payout statement not sent'` |
| `'Paystub email sent'` | `'Payout statement email sent'` |
| `'Paystub email failed — payroll row still written'` | `'Payout statement email failed — payroll row still written'` |
| `'Paystub already confirmed for ' + periodId + '.'` | `'Payout statement already confirmed for ' + periodId + '.'` |
| `'Paystub confirmed for ' + periodId + '. Thank you!'` | `'Payout statement confirmed for ' + periodId + '. Thank you!'` |
| Box-comment/JSDoc prose mentioning "paystub" (lines 16, 25, 368, 370, 558, 1065, 1077, 1084 per spec §7's table) | Same sentence, "paystub" → "payout statement" |

Do **not** rename `sendPaystubEmail_`, `confirmPaystub`, or the `confirmPaystub: confirmPaystub` export key — internal identifiers stay unchanged per the Global Constraints.

- [ ] **Step 3: Rename in `PortalView.html`**

| Current (line) | New |
|---|---|
| `<strong>⚠ Paystub Confirmation Required</strong>` (330) | `<strong>⚠ Payout Statement Confirmation Required</strong>` |
| `✓ Confirm My Paystub` (333, button text) | `✓ Confirm My Payout Statement` |
| `'Paystub confirmed.'` (4399, toast fallback) | `'Payout statement confirmed.'` |

Do **not** rename `#paystub-banner`, `.paystub-banner-msg`, `paystub_pending`, or the `confirmPaystub()` JS function — internal identifiers stay unchanged.

- [ ] **Step 4: Rename in `StaffOnboarding.gs`**

Line 433: `'their monthly paystub in the BLC Portal.'` → `'their monthly payout statement in the BLC Portal.'`

- [ ] **Step 5: Run the full Jest suite to confirm no regression**

Run: `npx jest -v`
Expected: All suites PASS (per Step 1's confirmation, no test should have needed updating; if one did, its update is already folded in from Step 1).

- [ ] **Step 6: Commit**

```bash
git add src/10-payroll/PayrollEngine.gs src/07-portal/PortalView.html src/08-staff/StaffOnboarding.gs
git commit -m "rename: Paystub -> Payout Statement in all user-facing text (contractor CRA/legal terminology)"
```

---

## Task 8: Final whole-feature review, live DEV verification, and documentation sync

**Files:**
- No new source changes expected — this task is a review/fix pass. If it finds a real issue, fix it here and re-run the affected task's tests before continuing.
- Modify (docs only, end of task): `CTO_TASK_QUEUE.md`, `SESSION_LOG.md` — per this repo's standing session-sync practice (`CLAUDE.md` "Session Memory," `.claude/rules/context-management.md`).

- [ ] **Step 1: Whole-branch review**

Read the full diff across all 7 prior tasks together (not task-by-task) and check specifically for:
- Any place `computePersonPay_`'s pure contract was violated (a DAL call, a Logger call, or a side effect accidentally introduced inside it).
- Any place `sendPayoutStatementSummary_` is called with a `sections` object shape that doesn't match what its formatters expect (field-name drift between `computePersonPay_`'s output, `runBonusRun`'s `by_supervisor` shape, and `QuarterlyBonusEngine.computeBonuses_`'s shape).
- Any leftover "Paystub" string missed by Task 7's grep (re-run the Step 1 grep from Task 7 once more across the full diff, not just the files it originally targeted, in case Task 5/6 introduced new user-facing text referencing the old term).

- [ ] **Step 2: Run the complete Jest suite one final time**

Run: `npx jest -v`
Expected: 100% pass, zero regressions across the whole suite (not just this feature's new files).

- [ ] **Step 3: DEV deploy and live verification checklist**

This is money/aggregation code — per `PROJECT_MEMORY.md` §3.1, Jest passing is necessary but not sufficient; a live run against real DAL/Sheets behavior is required before this is trusted. Follow this repo's `npm run push:dev` (never `clasp push --force` directly, per `CLAUDE.md` R6) and then, from the Apps Script editor:

1. Confirm DEV's `DIM_STAFF_ROSTER` has at least one `TEAM_LEAD` with a direct report and (if testing the PM section) the `PM` role present, using the synthetic `TEST-CLIENT`/`DS1`/`QC1`-style actors already established in this repo's DEV test conventions — never real staff (`.claude/rules/testing-policy.md`).
2. Set the `PAYOUT_STATEMENT_REVIEW_RECIPIENT` Script Property to a real, checkable inbox (your own, for this verification pass) before triggering anything — otherwise the default `HR@bluelotuscanada.ca` will receive DEV test traffic.
3. From the portal (fresh Incognito window if testing as HR_ACCOUNTING, not the CEO's own session — per `PROJECT_MEMORY.md` §3.9(a)'s standing lesson from the last live-DEV walkthrough), click "Generate Payout Statement," enter a period with real logged hours, confirm the email arrives with correct BASE PAY + SUPERVISOR BONUS sections and the "review summary only, not committed" closing line.
4. Repeat, opting into the quarterly bonus prompt, confirm the QUARTERLY BONUS PREVIEW section appears correctly labeled and separately from the totals above it.
5. As CEO, run the real `runPayrollRun`/`runBonusRun` (Apps Script editor function picker, since no portal button exists for base pay — confirmed in spec §5) against the same period; confirm exactly one additional "committed: true" HR summary email arrives per commit, and that the existing per-consultant/per-supervisor confirm-gate emails still arrive unchanged.
6. Confirm the renamed consultant-facing strings (banner, button, email subject/body) read "Payout Statement" everywhere in the live portal and inbox — not just in source.
7. Record the outcome of steps 1-6 in `CTO_TASK_QUEUE.md`'s Session State and `SESSION_LOG.md`, same as every other feature in this repo's history (see the 2026-08-14 SOP-upload-workflow entry as the template for level of detail).

- [ ] **Step 4: Explicitly confirm what this task does NOT do**

No `git push origin main`, no `npm run push:prod` — those require your separate, explicit go-ahead per `CLAUDE.md` R9, and are not part of this plan. Stop here and report back once Steps 1-3 are done.
