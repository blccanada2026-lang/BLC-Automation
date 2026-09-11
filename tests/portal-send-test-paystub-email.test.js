/**
 * portal-send-test-paystub-email.test.js
 *
 * Tests for portal_sendTestPaystubEmail (Portal.gs) — thin wrapper around
 * PayrollEngine.sendTestPaystubEmail. Same thin-wrapper-not-unit-tested-
 * beyond-plumbing precedent as portal_runBonusRun/portal_approveAllPayroll
 * (see portal-preview-payout-statement.test.js's own header comment) —
 * this suite verifies argument plumbing and JSON serialization only, not
 * the underlying payroll math (covered in payroll-engine-payout-statement.test.js).
 */

function installMocks(sendResult) {
  global.PortalAuth = { resolveEmail: jest.fn(function () { return 'test-ceo@test.blc.internal'; }) };
  global.PayrollEngine = { sendTestPaystubEmail: jest.fn(function () { return sendResult; }) };
}

const fs   = require('fs');
const path = require('path');
function loadSrc(relPath) { (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8')); }

beforeEach(() => {
  installMocks({ sent: true, period_id: '2026-08', person_code: 'DES1', name: 'Rita Nair', row: {} });
  loadSrc('../src/07-portal/Portal.gs');
});

test('resolves the actor from ptoken and calls PayrollEngine.sendTestPaystubEmail with personCode and periodId', () => {
  var json = portal_sendTestPaystubEmail('TOKEN123', 'DES1', '2026-08');

  expect(PortalAuth.resolveEmail).toHaveBeenCalledWith('TOKEN123');
  expect(PayrollEngine.sendTestPaystubEmail).toHaveBeenCalledWith(
    'test-ceo@test.blc.internal', 'DES1', '2026-08'
  );
  expect(JSON.parse(json).name).toBe('Rita Nair');
});

test('blank personCode and periodId pass through as empty string defaults', () => {
  portal_sendTestPaystubEmail('TOKEN123', undefined, undefined);

  expect(PayrollEngine.sendTestPaystubEmail).toHaveBeenCalledWith(
    'test-ceo@test.blc.internal', '', ''
  );
});
