/**
 * staff-onboarding-email.test.js
 *
 * Tests for the automatic new-staff onboarding email (2026-08-06):
 * StaffOnboardingMailer.gs's sendNewStaffOnboardingEmail_(), plus its
 * wiring into StaffOnboarding.onboardStaff() (only for genuinely new
 * staff, never on re-activation of an existing row).
 *
 * Loads the REAL OnboardingMailer.gs (T12) alongside
 * StaffOnboardingMailer.gs (T8) — same integration-style pattern used
 * elsewhere this session — since the mailer deliberately reuses its
 * existing DESIGNER/TEAM_LEAD/PM body builders rather than duplicating
 * ~50 lines of already-tested HTML per role.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

describe('sendNewStaffOnboardingEmail_(personCode)', () => {
  let store, sentEmails;

  beforeEach(() => {
    store = { DIM_STAFF_ROSTER: [] };
    sentEmails = [];

    global.DAL = {
      readWhere: function (t, cond) {
        return (store[t] || []).filter(function (row) {
          return Object.keys(cond).every(function (k) { return row[k] === cond[k]; });
        });
      }
    };
    global.Config = { TABLES: { DIM_STAFF_ROSTER: 'DIM_STAFF_ROSTER' } };
    global.Logger = { info: function () {}, warn: function () {}, error: function () {} };
    global.PortalAuth = { buildPersonalLink: function (code) { return 'https://portal.example/?pt=TOKEN-' + code; } };
    global.GmailApp = { sendEmail: function (to, subject, body, opts) { sentEmails.push({ to: to, subject: subject, opts: opts }); } };

    loadSrc('../src/12-migration/OnboardingMailer.gs');
    loadSrc('../src/08-staff/StaffOnboardingMailer.gs');
  });

  function seedRoster(row) {
    store.DIM_STAFF_ROSTER.push(Object.assign({ person_code: '', name: '', email: '', role: '' }, row));
  }

  test('DESIGNER gets the existing designer body, with their real personal link embedded', () => {
    seedRoster({ person_code: 'DES1', name: 'Dana Smith', email: 'dana@test.blc.internal', role: 'DESIGNER' });
    sendNewStaffOnboardingEmail_('DES1');

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe('dana@test.blc.internal');
    expect(sentEmails[0].opts.htmlBody).toContain('https://portal.example/?pt=TOKEN-DES1');
    expect(sentEmails[0].opts.htmlBody).toContain('Log Your Hours'); // designer-specific step
  });

  test('PM gets the existing PM body', () => {
    seedRoster({ person_code: 'PM1', name: 'Pat Manager', email: 'pat@test.blc.internal', role: 'PM' });
    sendNewStaffOnboardingEmail_('PM1');

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].opts.htmlBody).toContain('https://portal.example/?pt=TOKEN-PM1');
  });

  test('TEAM_LEAD gets the existing TL body', () => {
    seedRoster({ person_code: 'TL1', name: 'Tia Lead', email: 'tia@test.blc.internal', role: 'TEAM_LEAD' });
    sendNewStaffOnboardingEmail_('TL1');

    expect(sentEmails).toHaveLength(1);
  });

  test('ADMIN (no dedicated template) falls back to the generic body, still with their real link and role named', () => {
    seedRoster({ person_code: 'ADM1', name: 'Alex Admin', email: 'alex@test.blc.internal', role: 'ADMIN' });
    sendNewStaffOnboardingEmail_('ADM1');

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].opts.htmlBody).toContain('https://portal.example/?pt=TOKEN-ADM1');
    expect(sentEmails[0].opts.htmlBody).toContain('ADMIN');
    expect(sentEmails[0].opts.htmlBody).not.toContain('Log Your Hours'); // not the designer template
  });

  test('HR_ACCOUNTING and CEO also fall back to the generic body', () => {
    seedRoster({ person_code: 'HRA1', name: 'Hana R', email: 'hana@test.blc.internal', role: 'HR_ACCOUNTING' });
    seedRoster({ person_code: 'CEO1', name: 'Cee Oh', email: 'cee@test.blc.internal', role: 'CEO' });
    sendNewStaffOnboardingEmail_('HRA1');
    sendNewStaffOnboardingEmail_('CEO1');

    expect(sentEmails).toHaveLength(2);
    expect(sentEmails[0].opts.htmlBody).toContain('HR_ACCOUNTING');
    expect(sentEmails[1].opts.htmlBody).toContain('CEO');
  });

  test('skips silently (no email, no throw) when the roster row is not found', () => {
    expect(() => sendNewStaffOnboardingEmail_('NOBODY')).not.toThrow();
    expect(sentEmails).toHaveLength(0);
  });

  test('skips silently when the roster row has no email on file', () => {
    seedRoster({ person_code: 'NOMAIL', name: 'No Email', email: '', role: 'DESIGNER' });
    expect(() => sendNewStaffOnboardingEmail_('NOMAIL')).not.toThrow();
    expect(sentEmails).toHaveLength(0);
  });

  test('never throws even if GmailApp.sendEmail itself fails — best-effort, must not break onboarding', () => {
    seedRoster({ person_code: 'FAIL1', name: 'Fail Case', email: 'fail@test.blc.internal', role: 'PM' });
    global.GmailApp.sendEmail = function () { throw new Error('Quota exceeded'); };
    expect(() => sendNewStaffOnboardingEmail_('FAIL1')).not.toThrow();
  });
});

describe('StaffOnboarding.onboardStaff() — onboarding email wiring', () => {
  const { installV3StaffMocks } = require('./gas-v3-staff-mocks');
  let mocks, emailCalls;

  beforeEach(() => {
    mocks = installV3StaffMocks();
    mocks.Config.TABLES.STG_STAFF_IMPORT = 'STG_STAFF_IMPORT';
    mocks.HealthMonitor = { isApproachingLimit: () => false };
    global.HealthMonitor = mocks.HealthMonitor;

    emailCalls = [];
    global.sendNewStaffOnboardingEmail_ = function (personCode) { emailCalls.push(personCode); };

    loadSrc('../src/08-staff/StaffOnboarding.gs');
  });

  function basePayload(overrides) {
    return Object.assign({
      person_code:    'NEW1',
      name:           'New Hire',
      email:          'newhire@test.blc.internal',
      role:           'ADMIN',
      pay_currency:   'INR',
      pay_design:     0,
      pay_qc:         0,
      effective_from: '2026-08-01'
    }, overrides);
  }

  test('fires the onboarding email exactly once for a genuinely new staff member', () => {
    var result = StaffOnboarding.onboardStaff('ceo@test.blc.internal', basePayload());
    expect(result.isNew).toBe(true);
    expect(emailCalls).toEqual(['NEW1']);
  });

  test('does NOT fire the onboarding email when re-activating an existing inactive row', () => {
    // First onboard — consumes the "new" email call.
    StaffOnboarding.onboardStaff('ceo@test.blc.internal', basePayload());
    emailCalls.length = 0;

    // Mark the roster row inactive to simulate a prior departure, then re-onboard.
    var roster = mocks.store.DIM_STAFF_ROSTER;
    roster[roster.length - 1].active = 'FALSE';

    var result = StaffOnboarding.onboardStaff('ceo@test.blc.internal', basePayload());
    expect(result.isNew).toBe(false);
    expect(emailCalls).toEqual([]);
  });

  test('does NOT fire the onboarding email when the row already exists and is already active (no-op)', () => {
    StaffOnboarding.onboardStaff('ceo@test.blc.internal', basePayload());
    emailCalls.length = 0;

    var result = StaffOnboarding.onboardStaff('ceo@test.blc.internal', basePayload());
    expect(result.isNew).toBe(false);
    expect(emailCalls).toEqual([]);
  });
});
