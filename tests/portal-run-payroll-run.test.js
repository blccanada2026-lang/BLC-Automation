/**
 * portal-run-payroll-run.test.js
 *
 * Tests for portal_runPayrollRun (Portal.gs) — thin wrapper around
 * PayrollEngine.runPayrollRun, giving CEO a portal button for base pay
 * (mirrors the existing portal_runBonusRun pattern). Verifies argument
 * plumbing and JSON serialization only — the underlying payroll math is
 * covered in payroll-engine-payout-statement.test.js.
 */

function installMocks(runResult) {
  global.PortalAuth = { resolveEmail: jest.fn(function () { return 'test-ceo@test.blc.internal'; }) };
  global.PayrollEngine = { runPayrollRun: jest.fn(function () { return runResult; }) };
}

const fs   = require('fs');
const path = require('path');
function loadSrc(relPath) { (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8')); }

beforeEach(() => {
  installMocks({ processed: 3, skipped: 0, errors: [], by_person: [], period_id: '2026-08' });
  loadSrc('../src/07-portal/Portal.gs');
});

test('resolves the actor from ptoken and calls PayrollEngine.runPayrollRun with the periodId', () => {
  var json = portal_runPayrollRun('TOKEN123', '2026-08');

  expect(PortalAuth.resolveEmail).toHaveBeenCalledWith('TOKEN123');
  expect(PayrollEngine.runPayrollRun).toHaveBeenCalledWith(
    'test-ceo@test.blc.internal', { periodId: '2026-08' }
  );
  expect(JSON.parse(json).processed).toBe(3);
});

test('blank periodId passes through as empty string default', () => {
  portal_runPayrollRun('TOKEN123', '');

  expect(PayrollEngine.runPayrollRun).toHaveBeenCalledWith(
    'test-ceo@test.blc.internal', { periodId: '' }
  );
});
