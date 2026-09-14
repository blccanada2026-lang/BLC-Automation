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
