/**
 * portal-data-get-my-hours-permission.test.js
 *
 * Tests for PortalData.getMyHours()'s Step 1 permission gate.
 *
 * Context (2026-09-04): HR_ACCOUNTING gained the WORK_LOG_CORRECTION_ADMIN
 * carve-out (see rbac.test.js, work-log-correction-handler-admin-grant.test.js)
 * so it can void/amend duplicate or erroneous work-log entries via the
 * portal's "My Hours" browse-and-correct flow. But getMyHours's own Step 1
 * was `RBAC.enforcePermission(actor, RBAC.ACTIONS.WORK_LOG_SUBMIT)` — a
 * self-service permission HR_ACCOUNTING deliberately does NOT have (see
 * rbac.test.js) — so it could never even open the list to find the row to
 * correct. This gate must accept either WORK_LOG_SUBMIT or
 * WORK_LOG_CORRECTION_ADMIN, mirroring WorkLogCorrectionHandler.gs's
 * enforceCorrectionPermission_.
 *
 * Side effect worth noting: ADMIN's WORK_LOG_SUBMIT is also false (it has
 * full WORK_LOG_AMEND/VOID authority but never logs its own hours) — this
 * same fix is what lets ADMIN open "My Hours" for the first time too.
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
  mocks.RBAC.SCOPES = { SELF: 'SELF', TEAM: 'TEAM', ACCOUNTS: 'ACCOUNTS', ALL: 'ALL' };
  mocks.RBAC.ACTIONS.WORK_LOG_SUBMIT = 'WORK_LOG_SUBMIT';
  mocks.RBAC.ACTIONS.WORK_LOG_CORRECTION_ADMIN = 'WORK_LOG_CORRECTION_ADMIN';
  mocks.RBAC.getScopeForRole = function (role) { return mocks.RBAC.SCOPES.ALL; };
  mocks.Identifiers.generateCurrentPeriodId = function () { return '2026-08'; };
  loadSrc('../src/00-foundation/Constants.gs');
  loadSrc('../src/07-portal/PortalData.gs');
});

function actorFor(role, hasPermissionImpl) {
  mocks.RBAC.resolveActor = function (email) {
    return { email: email, role: role, personCode: 'X1', scope: 'ALL' };
  };
  mocks.RBAC.hasPermission = hasPermissionImpl;
  mocks.RBAC.enforcePermission = function (actor, action) {
    if (!hasPermissionImpl(actor, action)) {
      throw new Error('RBACError: "' + role + '" does not have permission to perform "' + action + '".');
    }
  };
}

describe('PortalData.getMyHours — permission gate accepts WORK_LOG_SUBMIT or WORK_LOG_CORRECTION_ADMIN', () => {
  test('HR_ACCOUNTING (WORK_LOG_CORRECTION_ADMIN only, no WORK_LOG_SUBMIT) can call getMyHours without throwing', () => {
    actorFor('HR_ACCOUNTING', (actor, action) => action === 'WORK_LOG_CORRECTION_ADMIN');
    expect(() => PortalData.getMyHours('hr@test.blc.internal')).not.toThrow();
  });

  test('a role with neither grant is still denied', () => {
    actorFor('CLIENT', () => false);
    expect(() => PortalData.getMyHours('client@test.blc.internal')).toThrow();
  });

  test('DESIGNER (WORK_LOG_SUBMIT only, the original grant) is unaffected', () => {
    actorFor('DESIGNER', (actor, action) => action === 'WORK_LOG_SUBMIT');
    expect(() => PortalData.getMyHours('designer@test.blc.internal')).not.toThrow();
  });

  test('ADMIN (WORK_LOG_CORRECTION_ADMIN, no WORK_LOG_SUBMIT) can now open "My Hours" too — a pre-existing gap this fix also closes', () => {
    actorFor('ADMIN', (actor, action) => action === 'WORK_LOG_CORRECTION_ADMIN');
    expect(() => PortalData.getMyHours('admin@test.blc.internal')).not.toThrow();
  });
});
