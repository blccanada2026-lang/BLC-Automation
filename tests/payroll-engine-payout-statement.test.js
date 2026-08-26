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
