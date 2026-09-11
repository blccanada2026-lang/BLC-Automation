/**
 * portal-send-all-test-paystub-emails.test.js
 *
 * Tests for portal_sendAllTestPaystubEmails (Portal.gs) — thin wrapper
 * around PayrollEngine.sendAllTestPaystubEmails. Same thin-wrapper-not-
 * unit-tested-beyond-plumbing precedent as portal_runBonusRun/
 * portal_approveAllPayroll (see portal-preview-payout-statement.test.js's
 * own header comment) — this suite verifies argument plumbing and JSON
 * serialization only, not the underlying payroll math (covered in
 * payroll-engine-payout-statement.test.js).
 */

function installMocks(sendResult) {
  global.PortalAuth = { resolveEmail: jest.fn(function () { return 'test-ceo@test.blc.internal'; }) };
  global.PayrollEngine = { sendAllTestPaystubEmails: jest.fn(function () { return sendResult; }) };
}

const fs   = require('fs');
const path = require('path');
function loadSrc(relPath) { (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8')); }

beforeEach(() => {
  installMocks({ sent: true, period_id: '2026-08', sent_count: 2, skipped_count: 0, people: [] });
  loadSrc('../src/07-portal/Portal.gs');
});

test('resolves the actor from ptoken and calls PayrollEngine.sendAllTestPaystubEmails with periodId', () => {
  var json = portal_sendAllTestPaystubEmails('TOKEN123', '2026-08');

  expect(PortalAuth.resolveEmail).toHaveBeenCalledWith('TOKEN123');
  expect(PayrollEngine.sendAllTestPaystubEmails).toHaveBeenCalledWith(
    'test-ceo@test.blc.internal', '2026-08'
  );
  expect(JSON.parse(json).sent_count).toBe(2);
});

test('blank periodId passes through as an empty string default', () => {
  portal_sendAllTestPaystubEmails('TOKEN123', undefined);

  expect(PayrollEngine.sendAllTestPaystubEmails).toHaveBeenCalledWith(
    'test-ceo@test.blc.internal', ''
  );
});
