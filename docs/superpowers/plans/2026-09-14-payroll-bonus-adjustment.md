# Payroll Bonus Adjustment Mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the two Aug-2026 `FACT_PAYROLL_LEDGER` supervisor-bonus rows found wrong during this session's audit (Bharath/BCH: ₹4,487.50 → ₹7,987.50; Sarty/SGO PM: ₹48,343.75 → ₹54,843.75) via a new, generalizable append-only adjustment mechanism, and send HR-routed correction emails before `approveAllPayroll('2026-08')` runs.

**Architecture:** A new `PAYROLL_BONUS_ADJUSTED` event type is appended to `FACT_PAYROLL_LEDGER` carrying only the delta amount — `refreshMartPayrollSummary_` already sums `bonus_amount` per person+period, so this needs no overwrite of the original row. A new `sendBonusAdjustmentEmail_` function (same HR-routing convention as the existing `sendBonusEmail_`) sends the correction email. A hardcoded, one-off migration script applies both corrections together, verifying each person's current ledger state before writing anything.

**Tech Stack:** Google Apps Script (V8), Jest (via `eval()`-loaded `.gs` source against DAL mocks — no real Sheets access in tests).

**Spec:** `docs/superpowers/specs/2026-09-14-payroll-bonus-adjustment-design.md`

## Global Constraints

- `FACT_PAYROLL_LEDGER` is append-only (Rule A5) — no task may call `DAL.updateWhere` or any delete on it. Corrections are new rows only.
- Every write path is RBAC-gated: the real (writing) run uses `RBAC.ACTIONS.PAYROLL_RUN` + `RBAC.enforceFinancialAccess`; the dry-run (read-only) uses `RBAC.ACTIONS.PAYROLL_VIEW`, matching `SupervisorBonusByAccountDryRun.gs`'s existing convention.
- `idempotency_key` format for the new event type: `'PAYROLL_BONUS_ADJUSTED|' + personCode + '|' + periodId` — exactly one adjustment per person+period (documented limitation, not solved in this plan).
- DBS's existing row must never be read for a write decision, never appended to, never emailed — the corrections list contains only `BCH` and `SGO`.
- Every write must be preceded by a verification read confirming the person's *current* summed `PAYROLL_BONUS_SUPERVISOR` total still equals the expected old amount — abort with no writes if it doesn't match (data may have changed since this plan was written).
- `notes` text sent to staff must be self-contained — no reference to `CTO_TASK_QUEUE.md` or other internal docs.

---

## File Structure

- **Modify:** `src/10-payroll/PayrollEngine.gs`
  - `refreshMartPayrollSummary_` (`:1024-1025`) — sum the new event type too.
  - New function `sendBonusAdjustmentEmail_` (placed after `sendBonusEmail_`, `:793`) — correction email, HR-routed.
  - Public API return object — expose `sendBonusAdjustmentEmail_` and `refreshMartPayrollSummary_` (only `sendBonusAdjustmentEmail_` and `refreshMartPayrollSummary_` are new exposures; both needed by the migration script in a different file/closure).
- **Create:** `src/12-migration/Aug2026BonusAdjustment.gs` — the one-off, hardcoded correction script (`runAug2026BonusAdjustmentDryRun`, `runAug2026BonusAdjustment`), following `SupervisorBonusByAccountDryRun.gs`'s conventions (plain top-level functions, hardcoded actor email constant for the dry-run, RBAC-checked, logs before/after).
- **Create:** `tests/payroll-engine-bonus-adjustment.test.js` — all new Jest coverage for both files above, in one file since they ship together and are tested together end-to-end.

---

### Task 1: `refreshMartPayrollSummary_` sums `PAYROLL_BONUS_ADJUSTED`, and both functions get exposed

**Files:**
- Modify: `src/10-payroll/PayrollEngine.gs:1024-1025` (the summing branch)
- Modify: `src/10-payroll/PayrollEngine.gs` (public API return object, near the end of the file — add two lines)
- Test: `tests/payroll-engine-bonus-adjustment.test.js` (new file, created in this task)

**Interfaces:**
- Produces: `PayrollEngine.refreshMartPayrollSummary_(periodId)` — now callable from outside the module. No signature change, same as its existing internal usage.

- [ ] **Step 1: Write the failing test**

Create `tests/payroll-engine-bonus-adjustment.test.js`:

```javascript
/**
 * payroll-engine-bonus-adjustment.test.js
 *
 * Tests for the PAYROLL_BONUS_ADJUSTED correction mechanism (2026-09-14,
 * per docs/superpowers/specs/2026-09-14-payroll-bonus-adjustment-design.md)
 * — the append-only correction path for FACT_PAYROLL_LEDGER, used to fix
 * the two Aug-2026 supervisor-bonus rows found wrong during this session's
 * audit (Bharath/BCH, Sarty/SGO). Covers both PayrollEngine.gs's new
 * summing branch + email function, and the one-off migration script in
 * src/12-migration/Aug2026BonusAdjustment.gs that applies them.
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
  mocks.DAL.appendRows      = function (t, rows) { rows.forEach(function (r) { mocks.DAL.appendRow(t, r); }); };
  // refreshMartPayrollSummary_ calls DAL.clearSheet, wrapped in a try/catch
  // in the real code — without this mock the catch silently swallows a
  // TypeError and MART_PAYROLL_SUMMARY accumulates stale rows across calls
  // within one test. Real behavior: replace the sheet's contents.
  mocks.DAL.clearSheet = function (t) { mocks.store[t] = []; };
  loadSrc('../src/10-payroll/PayrollEngine.gs');
});

function seedLedger(rows) { mocks.store['FACT_PAYROLL_LEDGER'] = rows; }

function bonusRow(personCode, amount, overrides) {
  return Object.assign({
    event_id: 'ORIG-' + personCode, period_id: '2026-08', event_type: 'PAYROLL_BONUS_SUPERVISOR',
    timestamp: '2026-09-12T10:00:00.000Z', actor_code: 'RAJ', actor_role: 'CEO', person_code: personCode,
    design_hours: 0, qc_hours: 0, design_pay: 0, qc_pay: 0, bonus_amount: amount, total_pay: amount,
    status: 'PENDING_CONFIRMATION', notes: '', idempotency_key: 'PAYROLL_BONUS|' + personCode + '|2026-08',
    payload_json: '{}'
  }, overrides || {});
}

describe('PayrollEngine.refreshMartPayrollSummary_() — sums PAYROLL_BONUS_ADJUSTED alongside PAYROLL_BONUS_SUPERVISOR', () => {
  test('a PAYROLL_BONUS_ADJUSTED row adds to supervisor_bonus, not replaces it', () => {
    seedLedger([
      bonusRow('BCH', 4487.50),
      bonusRow('BCH', 3500.00, { event_id: 'ADJ-BCH', event_type: 'PAYROLL_BONUS_ADJUSTED', idempotency_key: 'PAYROLL_BONUS_ADJUSTED|BCH|2026-08' })
    ]);

    PayrollEngine.refreshMartPayrollSummary_('2026-08');

    const row = mocks.store['MART_PAYROLL_SUMMARY'].find(r => r.person_code === 'BCH');
    expect(row.supervisor_bonus).toBe(7987.50);
    expect(row.total_pay).toBe(7987.50);
  });

  test('a person with only the original row (no adjustment) is unaffected', () => {
    seedLedger([bonusRow('DBS', 1150)]);

    PayrollEngine.refreshMartPayrollSummary_('2026-08');

    const row = mocks.store['MART_PAYROLL_SUMMARY'].find(r => r.person_code === 'DBS');
    expect(row.supervisor_bonus).toBe(1150);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/payroll-engine-bonus-adjustment.test.js -v`
Expected: FAIL — `row.supervisor_bonus` is `4487.5`, not `7987.5` (the `PAYROLL_BONUS_ADJUSTED` row is currently ignored by `refreshMartPayrollSummary_`'s `else if` chain, since it doesn't match `PAYROLL_BONUS_SUPERVISOR`).

- [ ] **Step 3: Implement the minimal change**

In `src/10-payroll/PayrollEngine.gs`, find (around line 1024):

```javascript
      } else if (etype === 'PAYROLL_BONUS_SUPERVISOR') {
        personData[code].supervisor_bonus += parseFloat(row.bonus_amount) || 0;
```

Replace with:

```javascript
      } else if (etype === 'PAYROLL_BONUS_SUPERVISOR' || etype === 'PAYROLL_BONUS_ADJUSTED') {
        personData[code].supervisor_bonus += parseFloat(row.bonus_amount) || 0;
```

Then find the public API return object near the end of the file (it currently ends with `sendPayoutStatementSummary_: sendPayoutStatementSummary_` followed by `};`). Add, just before the closing `};`:

```javascript
    sendPayoutStatementSummary_: sendPayoutStatementSummary_,

    // Exposed 2026-09-14 (Aug-2026 bonus-adjustment correction) — so the
    // one-off migration script in src/12-migration/Aug2026BonusAdjustment.gs
    // can rebuild the summary after writing correction rows, same
    // precedent as every other function exposed above.
    refreshMartPayrollSummary_: refreshMartPayrollSummary_
```

(The `sendBonusAdjustmentEmail_` exposure is added in Task 2, once that function exists — don't add a reference to an undefined name yet.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/payroll-engine-bonus-adjustment.test.js -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/10-payroll/PayrollEngine.gs tests/payroll-engine-bonus-adjustment.test.js
git commit -m "Sum PAYROLL_BONUS_ADJUSTED into MART_PAYROLL_SUMMARY alongside PAYROLL_BONUS_SUPERVISOR"
```

---

### Task 2: `sendBonusAdjustmentEmail_` — the correction email

**Files:**
- Modify: `src/10-payroll/PayrollEngine.gs` (new function after `sendBonusEmail_`, `:793-825`; one line added to the public API object)
- Test: `tests/payroll-engine-bonus-adjustment.test.js` (append to the file from Task 1)

**Interfaces:**
- Consumes: nothing new from Task 1.
- Produces: `PayrollEngine.sendBonusAdjustmentEmail_(staff, personCode, periodId, oldAmount, newAmount, correctionNote)` — `staff` is a `staffCache` entry shape (`{ name, email, role, ... }`, from `buildStaffCache_`). Called by Task 3's migration script.

- [ ] **Step 1: Write the failing test**

Append to `tests/payroll-engine-bonus-adjustment.test.js`:

```javascript
describe('PayrollEngine.sendBonusAdjustmentEmail_() — HR-routed correction email', () => {
  function staff(overrides) {
    return Object.assign({ name: 'Bharath Chandran', email: 'bch@test.blc.internal', role: 'TEAM_LEAD' }, overrides);
  }

  test('subject is labeled CORRECTION, body shows old and new amounts and the correction note', () => {
    PayrollEngine.sendBonusAdjustmentEmail_(
      staff(), 'BCH', '2026-08', 4487.50, 7987.50,
      'Aug 2026 supervisor bonus correction: +140 supervised hrs (Rajkumar, SBS) newly attributed. INR 4,487.50 -> INR 7,987.50.'
    );

    expect(MailApp.sendEmail).toHaveBeenCalledTimes(1);
    const call = MailApp.sendEmail.mock.calls[0][0];
    expect(call.subject).toBe('BLC Supervisor Bonus CORRECTION — Bharath Chandran — 2026-08');
    expect(call.body).toContain('4487.50');
    expect(call.body).toContain('7987.50');
    expect(call.body).toContain('Aug 2026 supervisor bonus correction: +140 supervised hrs');
  });

  test('routes to HR (PAYSTUB_ROUTE_TO_HR_ is true), not directly to staff, with a forward instruction naming the person', () => {
    PayrollEngine.sendBonusAdjustmentEmail_(staff(), 'BCH', '2026-08', 4487.50, 7987.50, 'note');

    const call = MailApp.sendEmail.mock.calls[0][0];
    expect(call.to).toBe('HR@bluelotuscanada.ca');
    expect(call.body).toContain('forward to Bharath Chandran <bch@test.blc.internal>');
  });

  test('a MailApp failure is non-fatal — logs a warning, does not throw', () => {
    global.MailApp.sendEmail = jest.fn(() => { throw new Error('quota exceeded'); });

    expect(() => {
      PayrollEngine.sendBonusAdjustmentEmail_(staff(), 'BCH', '2026-08', 4487.50, 7987.50, 'note');
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/payroll-engine-bonus-adjustment.test.js -v`
Expected: FAIL — `PayrollEngine.sendBonusAdjustmentEmail_ is not a function`

- [ ] **Step 3: Implement the minimal change**

In `src/10-payroll/PayrollEngine.gs`, immediately after the closing `}` of `sendBonusEmail_` (ends around line 825, just before the `SECTION 8b` comment block), add:

```javascript
  // ============================================================
  // SECTION 7b: BONUS ADJUSTMENT EMAIL
  //
  // Correction email for a PAYROLL_BONUS_ADJUSTED row (2026-09-14 —
  // see docs/superpowers/specs/2026-09-14-payroll-bonus-adjustment-design.md).
  // Distinct from sendBonusEmail_ above: this shows OLD -> NEW and a
  // reason, not a fresh bonus notice — sending sendBonusEmail_ with the
  // new total would read as a duplicate, not a correction, to whoever
  // opens it. Same PAYSTUB_ROUTE_TO_HR_/resolveHrReviewRecipient_
  // HR-routing convention as every other payout email in this file.
  // ============================================================

  function sendBonusAdjustmentEmail_(staff, personCode, periodId, oldAmount, newAmount, correctionNote) {
    if (!PAYSTUB_ROUTE_TO_HR_ && !staff.email) return;

    try {
      var recipient = PAYSTUB_ROUTE_TO_HR_ ? resolveHrReviewRecipient_() : staff.email;
      var subject   = 'BLC Supervisor Bonus CORRECTION — ' + staff.name + ' — ' + periodId;
      var bodyLines = [
        'Hi ' + staff.name + ',',
        '',
        'Your supervisor bonus for period ' + periodId + ' has been corrected.',
        '',
        'BONUS CORRECTION',
        '───────────────────────────────',
        'Period:            ' + periodId,
        'Previous amount:   INR ' + oldAmount.toFixed(2),
        'Corrected amount:  INR ' + newAmount.toFixed(2),
        '───────────────────────────────',
        '',
        correctionNote,
        ''
      ];
      if (PAYSTUB_ROUTE_TO_HR_) {
        bodyLines.push(
          '(HR review copy — forward to ' + staff.name + ' <' + (staff.email || 'no email on file') + '> after checking.)',
          ''
        );
      }
      bodyLines.push(
        'ACTION REQUIRED:',
        'Please confirm your corrected payout statement in the BLC Portal.',
        '',
        '— BLC Payroll System'
      );

      MailApp.sendEmail({ to: recipient, subject: subject, body: bodyLines.join('\n') });
    } catch (e) {
      Logger.warn('PAYROLL_BONUS_ADJUSTMENT_EMAIL_FAILED', {
        module: MODULE, person_code: personCode, error: e.message
      });
    }
  }
```

Then in the public API return object (added in Task 1), change:

```javascript
    // Exposed 2026-09-14 (Aug-2026 bonus-adjustment correction) — so the
    // one-off migration script in src/12-migration/Aug2026BonusAdjustment.gs
    // can rebuild the summary after writing correction rows, same
    // precedent as every other function exposed above.
    refreshMartPayrollSummary_: refreshMartPayrollSummary_
```

to:

```javascript
    // Exposed 2026-09-14 (Aug-2026 bonus-adjustment correction) — so the
    // one-off migration script in src/12-migration/Aug2026BonusAdjustment.gs
    // can rebuild the summary and send the correction email after writing
    // correction rows, same precedent as every other function exposed above.
    refreshMartPayrollSummary_:   refreshMartPayrollSummary_,
    sendBonusAdjustmentEmail_:    sendBonusAdjustmentEmail_
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/payroll-engine-bonus-adjustment.test.js -v`
Expected: PASS (5 tests total — 2 from Task 1, 3 from this task)

- [ ] **Step 5: Commit**

```bash
git add src/10-payroll/PayrollEngine.gs tests/payroll-engine-bonus-adjustment.test.js
git commit -m "Add sendBonusAdjustmentEmail_ for HR-routed bonus correction notices"
```

---

### Task 3: `Aug2026BonusAdjustment.gs` — the one-off correction script

**Files:**
- Create: `src/12-migration/Aug2026BonusAdjustment.gs`
- Test: `tests/payroll-engine-bonus-adjustment.test.js` (append to the file from Tasks 1-2)

**Interfaces:**
- Consumes: `PayrollEngine.buildStaffCache_(asOfDate)`, `PayrollEngine.sendBonusAdjustmentEmail_(...)`, `PayrollEngine.refreshMartPayrollSummary_(periodId)` — all from Tasks 1-2. `DAL.readAll`, `DAL.readWhere`, `DAL.appendRow` (existing DAL surface, no changes needed). `RBAC.resolveActor`, `RBAC.enforcePermission`, `RBAC.enforceFinancialAccess`, `RBAC.ACTIONS.PAYROLL_RUN`, `RBAC.ACTIONS.PAYROLL_VIEW` (existing).
- Produces: `runAug2026BonusAdjustmentDryRun()` (no params, read-only) and `runAug2026BonusAdjustment(actorEmail)` (writes) — both return `{ results: Array<{ person_code, old_amount, new_amount, delta, applied, reason }> }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/payroll-engine-bonus-adjustment.test.js`:

```javascript
describe('Aug2026BonusAdjustment.gs — the one-off correction script', () => {
  beforeEach(() => {
    loadSrc('../src/12-migration/Aug2026BonusAdjustment.gs');
  });

  function seedAugState() {
    seedLedger([
      bonusRow('BCH', 4487.50),
      bonusRow('SGO', 48343.75, { event_id: 'ORIG-SGO' }),
      bonusRow('DBS', 1150, { event_id: 'ORIG-DBS' })
    ]);
    mocks.store['DIM_STAFF_ROSTER'] = [
      { person_code: 'BCH', name: 'Bharath Chandran', email: 'bch@test.blc.internal', role: 'TEAM_LEAD',
        supervisor_code: '', pm_code: '', pay_currency: 'INR', pay_design: 350, pay_qc: 350,
        bonus_eligible: 'TRUE', active: 'TRUE', effective_from: '2025-01-01', effective_to: '' },
      { person_code: 'SGO', name: 'Sarty Gosh', email: 'sgo@test.blc.internal', role: 'PM',
        supervisor_code: '', pm_code: '', pay_currency: 'INR', pay_design: 350, pay_qc: 350,
        bonus_eligible: 'TRUE', active: 'TRUE', effective_from: '2025-01-01', effective_to: '' },
      { person_code: 'DBS', name: 'Deb Sen', email: 'dbs@test.blc.internal', role: 'TEAM_LEAD',
        supervisor_code: '', pm_code: '', pay_currency: 'INR', pay_design: 350, pay_qc: 350,
        bonus_eligible: 'TRUE', active: 'TRUE', effective_from: '2025-01-01', effective_to: '' }
    ];
  }

  test('dry run: reports both corrections, applies nothing, sends no email', () => {
    seedAugState();

    const result = runAug2026BonusAdjustmentDryRun();

    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ person_code: 'BCH', old_amount: 4487.50, new_amount: 7987.50, delta: 3500.00 }),
      expect.objectContaining({ person_code: 'SGO', old_amount: 48343.75, new_amount: 54843.75, delta: 6500.00 })
    ]));
    expect(mocks.store['FACT_PAYROLL_LEDGER'].filter(r => r.event_type === 'PAYROLL_BONUS_ADJUSTED')).toHaveLength(0);
    expect(MailApp.sendEmail).not.toHaveBeenCalled();
  });

  test('real run: appends one PAYROLL_BONUS_ADJUSTED row per person with the correct delta, references the original event_id', () => {
    seedAugState();

    runAug2026BonusAdjustment('raj.nair@bluelotuscanada.ca');

    const adjustments = mocks.store['FACT_PAYROLL_LEDGER'].filter(r => r.event_type === 'PAYROLL_BONUS_ADJUSTED');
    expect(adjustments).toHaveLength(2);

    const bch = adjustments.find(r => r.person_code === 'BCH');
    expect(bch.bonus_amount).toBe(3500.00);
    expect(bch.idempotency_key).toBe('PAYROLL_BONUS_ADJUSTED|BCH|2026-08');
    expect(JSON.parse(bch.payload_json).adjustment_of).toBe('ORIG-BCH');
    expect(JSON.parse(bch.payload_json).old_amount).toBe(4487.50);
    expect(JSON.parse(bch.payload_json).new_amount).toBe(7987.50);

    const sgo = adjustments.find(r => r.person_code === 'SGO');
    expect(sgo.bonus_amount).toBe(6500.00);
  });

  test('real run: sends exactly one correction email per corrected person, none for DBS', () => {
    seedAugState();

    runAug2026BonusAdjustment('raj.nair@bluelotuscanada.ca');

    expect(MailApp.sendEmail).toHaveBeenCalledTimes(2);
    const subjects = MailApp.sendEmail.mock.calls.map(c => c[0].subject);
    expect(subjects.some(s => s.indexOf('Bharath Chandran') !== -1)).toBe(true);
    expect(subjects.some(s => s.indexOf('Sarty Gosh') !== -1)).toBe(true);
    expect(subjects.some(s => s.indexOf('Deb Sen') !== -1)).toBe(false);
  });

  test('real run: MART_PAYROLL_SUMMARY reflects the corrected totals afterward', () => {
    seedAugState();

    runAug2026BonusAdjustment('raj.nair@bluelotuscanada.ca');

    const bch = mocks.store['MART_PAYROLL_SUMMARY'].find(r => r.person_code === 'BCH');
    const sgo = mocks.store['MART_PAYROLL_SUMMARY'].find(r => r.person_code === 'SGO');
    expect(bch.supervisor_bonus).toBe(7987.50);
    expect(sgo.supervisor_bonus).toBe(54843.75);
  });

  test('DBS is never written to and never emailed', () => {
    seedAugState();

    runAug2026BonusAdjustment('raj.nair@bluelotuscanada.ca');

    const dbsRows = mocks.store['FACT_PAYROLL_LEDGER'].filter(r => r.person_code === 'DBS');
    expect(dbsRows).toHaveLength(1); // only the original ORIG-DBS row — untouched
    expect(dbsRows[0].event_type).toBe('PAYROLL_BONUS_SUPERVISOR');
  });

  test('idempotent: a second real run does not double-write or double-email', () => {
    seedAugState();

    runAug2026BonusAdjustment('raj.nair@bluelotuscanada.ca');
    MailApp.sendEmail.mockClear();
    runAug2026BonusAdjustment('raj.nair@bluelotuscanada.ca');

    const adjustments = mocks.store['FACT_PAYROLL_LEDGER'].filter(r => r.event_type === 'PAYROLL_BONUS_ADJUSTED');
    expect(adjustments).toHaveLength(2); // still 2, not 4
    expect(MailApp.sendEmail).not.toHaveBeenCalled();
  });

  test('safety guard: aborts with NO writes if the current bonus total no longer matches the expected old amount', () => {
    seedLedger([
      bonusRow('BCH', 9999.99), // does not match the hardcoded expected 4487.50
      bonusRow('SGO', 48343.75, { event_id: 'ORIG-SGO' })
    ]);
    mocks.store['DIM_STAFF_ROSTER'] = [
      { person_code: 'BCH', name: 'Bharath Chandran', email: 'bch@test.blc.internal', role: 'TEAM_LEAD',
        supervisor_code: '', pm_code: '', pay_currency: 'INR', pay_design: 350, pay_qc: 350,
        bonus_eligible: 'TRUE', active: 'TRUE', effective_from: '2025-01-01', effective_to: '' }
    ];

    expect(() => runAug2026BonusAdjustment('raj.nair@bluelotuscanada.ca')).toThrow(/BCH/);
    expect(() => runAug2026BonusAdjustment('raj.nair@bluelotuscanada.ca')).toThrow(/9999\.99/);
    expect(mocks.store['FACT_PAYROLL_LEDGER'].filter(r => r.event_type === 'PAYROLL_BONUS_ADJUSTED')).toHaveLength(0);
    expect(MailApp.sendEmail).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/payroll-engine-bonus-adjustment.test.js -v`
Expected: FAIL — `runAug2026BonusAdjustmentDryRun is not defined` (the file doesn't exist yet)

- [ ] **Step 3: Implement the minimal code**

Create `src/12-migration/Aug2026BonusAdjustment.gs`:

```javascript
// ============================================================
// Aug2026BonusAdjustment.gs — BLC Nexus T12 Migration/Correction
// src/12-migration/Aug2026BonusAdjustment.gs
//
// One-off correction for the two Aug-2026 FACT_PAYROLL_LEDGER
// supervisor-bonus rows found wrong during this session's audit — see
// docs/superpowers/specs/2026-09-14-payroll-bonus-adjustment-design.md.
// NOT a general adjustment API: the two corrections below are
// hardcoded, specific to this one incident. A future correction reuses
// the PAYROLL_BONUS_ADJUSTED event type and this script's pattern, not
// this file itself.
//
// HOW TO RUN (Apps Script editor, PROD project):
//   1. runAug2026BonusAdjustmentDryRun()   — read-only, no writes, no emails
//   2. runAug2026BonusAdjustment('raj.nair@bluelotuscanada.ca')  — writes +
//      sends HR-routed correction emails
//
// Must be run BEFORE approveAllPayroll('2026-08') — user decision
// 2026-09-14: HR re-sends corrected statements before CEO approval, not
// after.
//
// Each correction is verified against the person's CURRENT summed
// PAYROLL_BONUS_SUPERVISOR total before anything is written — if it no
// longer matches the expected old amount (data changed since this
// script was written), the run aborts with NO writes.
// ============================================================

var AUG2026_ADJUSTMENT_ACTOR_EMAIL_ = 'raj.nair@bluelotuscanada.ca';
var AUG2026_ADJUSTMENT_PERIOD_ID_   = '2026-08';

var AUG2026_ADJUSTMENT_CORRECTIONS_ = [
  {
    personCode:        'BCH',
    expectedOldAmount: 4487.50,
    deltaAmount:       3500.00,
    notes:             'Aug 2026 supervisor bonus correction: +140 supervised hrs ' +
                        '(Rajkumar, SBS) newly attributed. INR 4,487.50 -> INR 7,987.50.'
  },
  {
    personCode:        'SGO',
    expectedOldAmount: 48343.75,
    deltaAmount:       6500.00,
    notes:             'Aug 2026 PM bonus correction: QC hours now count equally with ' +
                        'design hours (billing-parity rule) - +260 QC hrs across staff ' +
                        '(Deb Sen 120, Rajkumar 140). INR 48,343.75 -> INR 54,843.75.'
  }
];

/**
 * Reads a person's current FACT_PAYROLL_LEDGER state for the period:
 * every row (for the ledger-status print), the summed
 * PAYROLL_BONUS_SUPERVISOR total, the original bonus row's event_id
 * (for payload_json.adjustment_of), and whether a PAYROLL_BONUS_ADJUSTED
 * row already exists for this idempotency key.
 *
 * @returns {{ allRows: Array, currentBonusTotal: number, originalEventId: string,
 *             alreadyAdjusted: boolean, idempotencyKey: string }}
 */
function aug2026GatherPersonState_(personCode) {
  var allRows = DAL.readAll(Config.TABLES.FACT_PAYROLL_LEDGER, {
    callerModule: 'Aug2026BonusAdjustment', periodId: AUG2026_ADJUSTMENT_PERIOD_ID_
  }).filter(function (r) { return r.person_code === personCode; });

  var bonusRows = allRows.filter(function (r) { return r.event_type === 'PAYROLL_BONUS_SUPERVISOR'; });
  var currentBonusTotal = bonusRows.reduce(function (sum, r) { return sum + (parseFloat(r.bonus_amount) || 0); }, 0);
  var originalEventId = bonusRows.length > 0 ? bonusRows[0].event_id : '';

  var idempotencyKey = 'PAYROLL_BONUS_ADJUSTED|' + personCode + '|' + AUG2026_ADJUSTMENT_PERIOD_ID_;
  var alreadyAdjusted = allRows.some(function (r) { return r.idempotency_key === idempotencyKey; });

  return {
    allRows: allRows,
    currentBonusTotal: Math.round(currentBonusTotal * 100) / 100,
    originalEventId: originalEventId,
    alreadyAdjusted: alreadyAdjusted,
    idempotencyKey: idempotencyKey
  };
}

/**
 * Shared core for both entry points. write=false never touches DAL,
 * MailApp, or refreshMartPayrollSummary_ — pure read + verify + report.
 *
 * @param {boolean} write
 * @param {string} [actorEmail]  Required when write=true.
 * @returns {{ results: Array<{person_code, old_amount, new_amount, delta, applied, reason}> }}
 */
function aug2026RunCorrections_(write, actorEmail) {
  var actor = null;
  if (write) {
    actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
    RBAC.enforceFinancialAccess(actor);
  } else {
    actor = RBAC.resolveActor(AUG2026_ADJUSTMENT_ACTOR_EMAIL_);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);
  }

  console.log('=== Aug 2026 bonus adjustment — ' + (write ? 'REAL RUN (writes + emails)' : 'DRY RUN (read-only)') + ' ===');

  var staffCache = PayrollEngine.buildStaffCache_(AUG2026_ADJUSTMENT_PERIOD_ID_ + '-01');
  var results = [];

  for (var i = 0; i < AUG2026_ADJUSTMENT_CORRECTIONS_.length; i++) {
    var c = AUG2026_ADJUSTMENT_CORRECTIONS_[i];
    var state = aug2026GatherPersonState_(c.personCode);

    console.log('');
    console.log('--- ' + c.personCode + ' — existing FACT_PAYROLL_LEDGER rows for ' + AUG2026_ADJUSTMENT_PERIOD_ID_ + ' ---');
    state.allRows.forEach(function (r) {
      console.log('  ' + r.event_type + ' | status=' + r.status + ' | bonus_amount=' + r.bonus_amount + ' | ' + r.timestamp);
    });

    if (Math.round(state.currentBonusTotal * 100) !== Math.round(c.expectedOldAmount * 100)) {
      throw new Error('Aug2026BonusAdjustment: ' + c.personCode + ' current PAYROLL_BONUS_SUPERVISOR total is ' +
                       state.currentBonusTotal + ', expected ' + c.expectedOldAmount + ' — data has changed since ' +
                       'this script was written. Aborting with NO writes. Re-verify before re-running.');
    }

    var newAmount = Math.round((c.expectedOldAmount + c.deltaAmount) * 100) / 100;

    if (state.alreadyAdjusted) {
      console.log('  ' + c.personCode + ': already adjusted (idempotency_key=' + state.idempotencyKey + ') — skipping.');
      results.push({ person_code: c.personCode, old_amount: c.expectedOldAmount, new_amount: newAmount, delta: c.deltaAmount, applied: false, reason: 'already_adjusted' });
      continue;
    }

    console.log('  ' + c.personCode + ': ' + c.expectedOldAmount.toFixed(2) + ' -> ' + newAmount.toFixed(2) + ' (delta ' + c.deltaAmount.toFixed(2) + ')' +
                (write ? '' : ' [DRY RUN — not written]'));

    if (write) {
      var adjustmentRow = {
        event_id:        Identifiers.generateId(),
        period_id:       AUG2026_ADJUSTMENT_PERIOD_ID_,
        event_type:      'PAYROLL_BONUS_ADJUSTED',
        timestamp:       new Date().toISOString(),
        actor_code:      actor.personCode || '',
        actor_role:      actor.role || '',
        person_code:     c.personCode,
        design_hours:    0,
        qc_hours:        0,
        design_pay:      0,
        qc_pay:          0,
        bonus_amount:    c.deltaAmount,
        total_pay:       c.deltaAmount,
        status:          'PENDING_CONFIRMATION',
        notes:           c.notes,
        idempotency_key: state.idempotencyKey,
        payload_json:    JSON.stringify({
                            adjustment_of: state.originalEventId,
                            reason:        'Aug 2026 supervisor/PM bonus audit correction',
                            old_amount:    c.expectedOldAmount,
                            new_amount:    newAmount
                          })
      };
      DAL.appendRow(Config.TABLES.FACT_PAYROLL_LEDGER, adjustmentRow, {
        callerModule: 'Aug2026BonusAdjustment', periodId: AUG2026_ADJUSTMENT_PERIOD_ID_
      });

      var staff = staffCache[c.personCode];
      if (staff) {
        PayrollEngine.sendBonusAdjustmentEmail_(staff, c.personCode, AUG2026_ADJUSTMENT_PERIOD_ID_, c.expectedOldAmount, newAmount, c.notes);
      }
    }

    results.push({ person_code: c.personCode, old_amount: c.expectedOldAmount, new_amount: newAmount, delta: c.deltaAmount, applied: write, reason: write ? 'applied' : 'dry_run' });
  }

  if (write) {
    PayrollEngine.refreshMartPayrollSummary_(AUG2026_ADJUSTMENT_PERIOD_ID_);
    console.log('');
    console.log('=== Done. Run approveAllPayroll(\'' + AUG2026_ADJUSTMENT_PERIOD_ID_ + '\') only AFTER confirming ' +
                'HR has forwarded the correction emails above and both staff have re-confirmed. ===');
  } else {
    console.log('');
    console.log('=== Dry run complete. No writes were made. Run runAug2026BonusAdjustment(actorEmail) to apply. ===');
  }

  return { results: results };
}

function runAug2026BonusAdjustmentDryRun() {
  return aug2026RunCorrections_(false);
}

function runAug2026BonusAdjustment(actorEmail) {
  return aug2026RunCorrections_(true, actorEmail);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/payroll-engine-bonus-adjustment.test.js -v`
Expected: PASS (12 tests total)

- [ ] **Step 5: Run the full suite to confirm nothing else broke**

Run: `npx jest`
Expected: PASS — same total as before this plan (4,757) plus the 12 new tests (4,769), same 2 pre-existing unrelated `code-review-graph/` fixture failures.

- [ ] **Step 6: Commit**

```bash
git add src/12-migration/Aug2026BonusAdjustment.gs tests/payroll-engine-bonus-adjustment.test.js
git commit -m "Add one-off Aug-2026 bonus adjustment script (Bharath +3500, Sarty +6500)"
```

---

## After implementation (not part of this plan's tasks — deployment steps for the user)

1. `npm run push:dev`, smoke-test-free per this project's own rule (no real August data belongs in DEV) — the Jest suite from Task 3 is the correctness gate.
2. `npm run push:prod` (after git commit + push to `origin/main`, matching this session's established R5/R6 discipline).
3. In the Apps Script editor (PROD): run `runAug2026BonusAdjustmentDryRun()` first, review its output (the printed ledger rows in particular — confirm neither BCH nor SGO has moved to `PAYROLL_CONFIRMED`/`PAYROLL_PROCESSED` since 2026-09-12).
4. Run `runAug2026BonusAdjustment('raj.nair@bluelotuscanada.ca')`.
5. Confirm HR received and forwarded both correction emails.
6. Only then: `approveAllPayroll('2026-08')`.

These are user-executed operational steps, not implementation tasks — no code change accomplishes them.
