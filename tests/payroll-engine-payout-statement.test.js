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
});

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
    mocks.DAL.appendRow = jest.fn();
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
