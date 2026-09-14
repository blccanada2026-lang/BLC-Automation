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
