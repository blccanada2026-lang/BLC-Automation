/**
 * portal-generate-client-timesheets.test.js
 *
 * Tests for portal_generateClientTimesheets (Portal.gs) — thin wrapper
 * around ClientTimesheetEngine.generate(), giving CEO/HR_ACCOUNTING a
 * portal button to run semi-monthly client timesheet generation on
 * demand for any period. Unlike PayrollEngine's portal wrappers,
 * ClientTimesheetEngine.generate() has no RBAC of its own (same
 * situation as GenerateTimesheetPdf.gs) — RBAC.enforcePermission +
 * enforceFinancialAccess are enforced directly here, matching
 * portal_generateTimesheetPdf's precedent. Verifies argument plumbing,
 * RBAC gating, and JSON serialization only — the underlying per-client
 * gate logic is covered in client-timesheet-engine-per-client-gate.test.js.
 */

function installMocks(generateResult) {
  global.PortalAuth = { resolveEmail: jest.fn(function () { return 'test-ceo@test.blc.internal'; }) };
  global.RBAC = {
    ACTIONS:              { TIMESHEET_GENERATE: 'TIMESHEET_GENERATE' },
    resolveActor:         jest.fn(function (email) { return { email: email, role: 'CEO' }; }),
    enforcePermission:    jest.fn(),
    enforceFinancialAccess: jest.fn()
  };
  global.ClientTimesheetEngine = { generate: jest.fn(function () { return generateResult; }) };
}

const fs   = require('fs');
const path = require('path');
function loadSrc(relPath) { (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8')); }

beforeEach(() => {
  installMocks({
    clients:         { ALPHA: { rows: [] }, BETA: { rows: [] } },
    period_id:       '2026-08A',
    skipped_clients: [],
    skipped_reasons: {}
  });
  loadSrc('../src/07-portal/Portal.gs');
});

test('happy path: resolves actor, enforces RBAC, delegates to ClientTimesheetEngine.generate(), returns summary JSON', () => {
  var json = portal_generateClientTimesheets('TOKEN123', '2026-08A');

  expect(PortalAuth.resolveEmail).toHaveBeenCalledWith('TOKEN123');
  expect(RBAC.resolveActor).toHaveBeenCalledWith('test-ceo@test.blc.internal');
  expect(RBAC.enforcePermission).toHaveBeenCalledWith({ email: 'test-ceo@test.blc.internal', role: 'CEO' }, 'TIMESHEET_GENERATE');
  expect(RBAC.enforceFinancialAccess).toHaveBeenCalledWith({ email: 'test-ceo@test.blc.internal', role: 'CEO' }, 'TIMESHEET_GENERATE');
  expect(ClientTimesheetEngine.generate).toHaveBeenCalledWith('2026-08A');

  var parsed = JSON.parse(json);
  expect(parsed.period_id).toBe('2026-08A');
  expect(parsed.client_codes.sort()).toEqual(['ALPHA', 'BETA']);
  expect(parsed.skipped_clients).toEqual([]);
});

test('RBAC denial propagates and ClientTimesheetEngine.generate() is never called', () => {
  RBAC.enforcePermission = jest.fn(function () { throw new Error('RBAC_DENIED'); });

  expect(() => portal_generateClientTimesheets('TOKEN123', '2026-08A')).toThrow('RBAC_DENIED');
  expect(ClientTimesheetEngine.generate).not.toHaveBeenCalled();
});

test('blank periodId passes through as empty string default (current half-month)', () => {
  portal_generateClientTimesheets('TOKEN123', '');

  expect(ClientTimesheetEngine.generate).toHaveBeenCalledWith('');
});

test('skipped clients and their reasons are surfaced in the response', () => {
  installMocks({
    clients:         { BETA: { rows: [] } },
    period_id:       '2026-08A',
    skipped_clients: ['ALPHA'],
    skipped_reasons: { ALPHA: ['CHECK_3_CLIENT_CODE_CONSISTENCY: bad code'] }
  });

  var parsed = JSON.parse(portal_generateClientTimesheets('TOKEN123', '2026-08A'));

  expect(parsed.skipped_clients).toEqual(['ALPHA']);
  expect(parsed.skipped_reasons.ALPHA).toEqual(['CHECK_3_CLIENT_CODE_CONSISTENCY: bad code']);
});
