/**
 * portal-quarterly-readiness-check.test.js
 *
 * Tests for portal_runQuarterlyReadinessCheck / portal_applyReworkCycleBackfill
 * (Portal.gs) — thin wrappers around QuarterlyReadinessEngine. Follows the
 * same thin-wrapper-not-unit-tested-beyond-plumbing precedent as
 * portal_previewPayoutStatement (see portal-preview-payout-statement.test.js)
 * — this suite verifies argument plumbing and JSON serialization only, not
 * the underlying readiness-check/backfill logic (covered in
 * quarterly-readiness-engine.test.js).
 */

function installMocks(checkResult, backfillResult) {
  global.PortalAuth = { resolveEmail: jest.fn(function () { return 'test-ceo@test.blc.internal'; }) };
  global.QuarterlyReadinessEngine = {
    runQuarterlyReadinessCheck: jest.fn(function () { return checkResult; }),
    applyReworkCycleBackfill:   jest.fn(function () { return backfillResult; })
  };
}

const fs   = require('fs');
const path = require('path');
function loadSrc(relPath) { (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8')); }

beforeEach(() => {
  installMocks(
    { period_id: '2026-Q2', ratings: { staff_total: 3, staff_confirmed: 1, staff_missing: [] },
      rework_backfill: { dryRun: true, affected: 0, updated: 0, notFound: 0 },
      period_id_integrity: { ratings: { corruptedCount: 0 }, ledger: { corruptedCount: 0 } } },
    { dryRun: false, affected: 1, updated: 1, notFound: 0 }
  );
  loadSrc('../src/07-portal/Portal.gs');
});

test('portal_runQuarterlyReadinessCheck resolves the actor from ptoken and plumbs quarter/year through', () => {
  var json = portal_runQuarterlyReadinessCheck('TOKEN123', 'Q2', 2026);

  expect(PortalAuth.resolveEmail).toHaveBeenCalledWith('TOKEN123');
  expect(QuarterlyReadinessEngine.runQuarterlyReadinessCheck).toHaveBeenCalledWith(
    'test-ceo@test.blc.internal', 'Q2', 2026
  );
  expect(JSON.parse(json).period_id).toBe('2026-Q2');
});

test('portal_applyReworkCycleBackfill resolves the actor from ptoken and plumbs quarter/year through', () => {
  var json = portal_applyReworkCycleBackfill('TOKEN123', 'Q2', 2026);

  expect(PortalAuth.resolveEmail).toHaveBeenCalledWith('TOKEN123');
  expect(QuarterlyReadinessEngine.applyReworkCycleBackfill).toHaveBeenCalledWith(
    'test-ceo@test.blc.internal', 'Q2', 2026
  );
  expect(JSON.parse(json).updated).toBe(1);
});
