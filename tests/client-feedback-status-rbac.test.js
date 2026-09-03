/**
 * client-feedback-status-rbac.test.js
 *
 * Regression test for a real PROD incident (2026-09-03): ClientFeedback.gs's
 * getFeedbackStatus() gated on RBAC.ACTIONS.PAYROLL_RUN (CEO-only) instead
 * of a permission TEAM_LEAD/PM also hold, despite its own JSDoc promising
 * "CEO/PM/TL only" (Portal.gs's portal_getFeedbackStatus doc says the same).
 * This denied a real TEAM_LEAD ("Samar Kumar Das") in production.
 *
 * Fix: added RBAC.ACTIONS.FEEDBACK_VIEW (true for CEO/PM/TEAM_LEAD/ADMIN/
 * SYSTEM, false elsewhere) and switched getFeedbackStatus to use it —
 * matching the sibling getLeaderDashboard's CEO/PM/TEAM_LEAD/ADMIN
 * visibility tier instead of the CEO-only financial gate.
 */

const fs   = require('fs');
const path = require('path');
const { installRbacMocks, seedRosterActor } = require('./gas-rbac-mocks');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let mocks;

beforeEach(() => {
  mocks = installRbacMocks();
  mocks.Config.TABLES.FACT_CLIENT_FEEDBACK = 'FACT_CLIENT_FEEDBACK';
  mocks.Config.FORM_TYPES = { CLIENT_FEEDBACK: 'CLIENT_FEEDBACK' };
  global.QueueProcessor = { registerHandler: function () {} };
  loadSrc('../src/02-security/RBAC.gs');
  loadSrc('../src/09-feedback/ClientFeedback.gs');
});

function seedActor(email, role, personCode) {
  seedRosterActor(mocks, { email: email, role: role, person_code: personCode });
}

describe('ClientFeedback.getFeedbackStatus() — RBAC gate', () => {
  test('TEAM_LEAD can view feedback status (previously denied — the real incident)', () => {
    seedActor('teamlead1@test.blc.internal', 'TEAM_LEAD', 'TL1');
    const result = ClientFeedback.getFeedbackStatus('teamlead1@test.blc.internal', '2026-08');
    expect(result.period_id).toBe('2026-08');
  });

  test('PM can view feedback status', () => {
    seedActor('pm1@test.blc.internal', 'PM', 'PM1');
    const result = ClientFeedback.getFeedbackStatus('pm1@test.blc.internal', '2026-08');
    expect(result.period_id).toBe('2026-08');
  });

  test('CEO can view feedback status (already worked before the fix)', () => {
    seedActor('ceo1@test.blc.internal', 'CEO', 'CEO1');
    const result = ClientFeedback.getFeedbackStatus('ceo1@test.blc.internal', '2026-08');
    expect(result.period_id).toBe('2026-08');
  });

  test('DESIGNER is denied — not part of the CEO/PM/TL visibility tier', () => {
    seedActor('designer1@test.blc.internal', 'DESIGNER', 'DES1');
    expect(() => ClientFeedback.getFeedbackStatus('designer1@test.blc.internal', '2026-08'))
      .toThrow(/RBAC:PERMISSION_DENIED/);
  });
});
