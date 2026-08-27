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
