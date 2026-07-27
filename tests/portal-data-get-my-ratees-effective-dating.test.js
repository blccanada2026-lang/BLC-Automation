/**
 * portal-data-get-my-ratees-effective-dating.test.js
 *
 * Tests for PortalData.getMyRatees() — Task 2's effective-dating fix.
 * getMyRatees(raterEmail, quarterPeriodId, ...) already took
 * quarterPeriodId as a parameter, but the supervisor/pm match
 * (`s.supervisor_code === actor.personCode`) never referenced it — it
 * always matched against whatever's currently in the roster.
 *
 * Two revisions, both caught by a real DEV run before Jest did — this
 * file's own coverage had to grow to catch up:
 *
 *   REVISION 1: used the quarter's START date. Wrong — a mid-quarter
 *   change still falls inside the OLD row's still-valid range at the
 *   quarter's first day, so a rating request for the quarter containing
 *   the change asked the OLD TL, not whoever supervised the person for
 *   most of it. The two original tests (Q1 entirely before the change,
 *   Q3 entirely after) both passed anyway, because neither quarter
 *   straddles the change date.
 *
 *   REVISION 2: switched to the quarter's END date alone. Also wrong,
 *   two ways: (a) a change effective LATE in a quarter would attribute
 *   the entire quarter to the new supervisor — the mirror-image bug,
 *   just flipped to the other boundary; (b) for the CURRENT,
 *   in-progress quarter, the end date is a FUTURE date, so a change
 *   scheduled to take effect later this quarter would show as already
 *   in effect today.
 *
 *   CURRENT: ratingAsOfDate_() = min(quarter end, today) — never looks
 *   into the future, fixing (b) completely. (a) is a documented,
 *   accepted limitation (PROJECT_MEMORY.md §3.2), not fixed here —
 *   tested explicitly below so it stays a known, intentional tradeoff
 *   rather than something a future change could silently regress into
 *   worse behavior.
 *
 * "Today" is controlled via Jest fake timers in every test that needs a
 * specific relationship to a fixed date — real system time is never
 * relied on, so these tests don't quietly become meaningless once the
 * calendar moves past the 2026 dates used throughout.
 *
 * PortalData.gs (T07) does NOT call into QuarterlyBonusEngine.gs (T10)
 * for quarter-date math, even though quarterDateRange_ is public there —
 * Rule A1 forbids a lower tier depending on a higher one. Small,
 * self-contained quarterEndDate_()/ratingAsOfDate_() helpers are added
 * to PortalData.gs itself instead (pure string/integer math, no Date
 * object timezone concerns — quarter-ending months are always
 * 31/30/30/31 days, so no leap-year handling is needed either).
 */

const fs   = require('fs');
const path = require('path');
const { installV3StaffMocks } = require('./gas-v3-staff-mocks');

function loadSrc(relPath) {
  // eval() loads trusted, repo-local .gs source (not user input) — same
  // pattern as every other test in this repo. Indirect (global) eval so
  // declarations become visible outside this helper.
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let mocks;

beforeEach(() => {
  mocks = installV3StaffMocks();
  loadSrc('../src/07-portal/PortalData.gs');
});

afterEach(() => {
  jest.useRealTimers();
});

function seedRoster(rows) {
  mocks.store['DIM_STAFF_ROSTER'] = rows.map(r => Object.assign({
    person_code: '', name: '', email: '', role: 'DESIGNER',
    supervisor_code: '', pm_code: '', pay_currency: 'INR',
    pay_design: 0, pay_qc: 0, bonus_eligible: 'FALSE',
    active: 'TRUE', effective_from: '2025-01-01', effective_to: ''
  }, r));
}

/** Seeds OLD_TL/NEW_TL/KUM with a supervisor change from OLD_TL to NEW_TL at changeDate. */
function seedChangeScenario(changeDate) {
  seedRoster([
    { person_code: 'OLD_TL', role: 'TEAM_LEAD' },
    { person_code: 'NEW_TL', role: 'TEAM_LEAD' },
    { person_code: 'KUM', role: 'DESIGNER', supervisor_code: 'OLD_TL', effective_from: '2025-01-01', effective_to: dayBefore(changeDate) }
  ]);
  mocks.store['DIM_STAFF_ROSTER'].push({
    person_code: 'KUM', name: '', email: '', role: 'DESIGNER',
    supervisor_code: 'NEW_TL', pm_code: '', pay_currency: 'INR',
    pay_design: 0, pay_qc: 0, bonus_eligible: 'FALSE',
    active: 'TRUE', effective_from: changeDate, effective_to: ''
  });
  mocks.RBAC.resolveActor = function (email) {
    return email === 'old-tl@test.blc.internal'
      ? { email: email, role: 'TEAM_LEAD', personCode: 'OLD_TL' }
      : { email: email, role: 'TEAM_LEAD', personCode: 'NEW_TL' };
  };
}

function dayBefore(isoDateStr) {
  var d = new Date(isoDateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().substring(0, 10);
}

/** Freezes Date.now()/new Date() for the current test to the given 'YYYY-MM-DD'. */
function freezeToday(isoDateStr) {
  jest.useFakeTimers().setSystemTime(new Date(isoDateStr + 'T12:00:00Z'));
}

describe('PortalData.getMyRatees() — effective-dated supervisor lookup', () => {
  test('rating request for a PAST quarter, after a supervisor change, asks the OLD TL to rate — not today\'s TL', () => {
    freezeToday('2026-08-01'); // querying well after Q1 has closed
    seedChangeScenario('2026-04-15');

    // Requesting ratings for Q1 2026 (Jan-Mar) — entirely before the April 15 change.
    const oldTlRatees = JSON.parse(PortalData.getMyRatees('old-tl@test.blc.internal', '2026-Q1'));
    const newTlRatees = JSON.parse(PortalData.getMyRatees('new-tl@test.blc.internal', '2026-Q1'));

    expect(oldTlRatees.map(r => r.person_code)).toContain('KUM');
    expect(newTlRatees.map(r => r.person_code)).not.toContain('KUM');
  });

  test('change EARLY in a quarter: the quarter containing it routes to the NEW TL once the quarter has closed', () => {
    freezeToday('2026-08-01'); // Q2 has closed by the time of this query
    seedChangeScenario('2026-04-15'); // 15 days into Q2 (Apr-Jun) — "early"

    const oldTlQ2 = JSON.parse(PortalData.getMyRatees('old-tl@test.blc.internal', '2026-Q2'));
    const newTlQ2 = JSON.parse(PortalData.getMyRatees('new-tl@test.blc.internal', '2026-Q2'));

    expect(oldTlQ2.map(r => r.person_code)).not.toContain('KUM');
    expect(newTlQ2.map(r => r.person_code)).toContain('KUM');

    // Q1 must still be correct (regression guard on the fix above) — entirely before the change.
    const oldTlQ1 = JSON.parse(PortalData.getMyRatees('old-tl@test.blc.internal', '2026-Q1'));
    const newTlQ1 = JSON.parse(PortalData.getMyRatees('new-tl@test.blc.internal', '2026-Q1'));
    expect(oldTlQ1.map(r => r.person_code)).toContain('KUM');
    expect(newTlQ1.map(r => r.person_code)).not.toContain('KUM');
  });

  test('change LATE in a quarter: still routes the WHOLE quarter to the NEW TL once it has closed — documented, accepted tradeoff, not a bug', () => {
    freezeToday('2026-08-01'); // Q2 has closed by the time of this query
    seedChangeScenario('2026-06-28'); // 2 days before Q2 (Apr-Jun) ends — "late"

    const oldTlQ2 = JSON.parse(PortalData.getMyRatees('old-tl@test.blc.internal', '2026-Q2'));
    const newTlQ2 = JSON.parse(PortalData.getMyRatees('new-tl@test.blc.internal', '2026-Q2'));

    // This IS min(quarter_end, today)'s known, accepted limitation
    // (PROJECT_MEMORY.md §3.2/ratingAsOfDate_'s own comment) — the new TL
    // only actually supervised KUM for the last 2 days of the quarter, but
    // still gets the whole quarter's rating request. Asserting this
    // explicitly so a future change can't silently make it worse (e.g. by
    // reverting to quarter-start) without this test catching it.
    expect(oldTlQ2.map(r => r.person_code)).not.toContain('KUM');
    expect(newTlQ2.map(r => r.person_code)).toContain('KUM');
  });

  test('change scheduled for a FUTURE date within the CURRENT, in-progress quarter: does NOT yet route to the new TL', () => {
    freezeToday('2026-05-01'); // we're currently inside Q2 (Apr-Jun) — the quarter has NOT closed yet
    seedChangeScenario('2026-06-15'); // scheduled for later in Q2 — still in the future relative to "today"

    const oldTlQ2 = JSON.parse(PortalData.getMyRatees('old-tl@test.blc.internal', '2026-Q2'));
    const newTlQ2 = JSON.parse(PortalData.getMyRatees('new-tl@test.blc.internal', '2026-Q2'));

    // min(quarter_end, today) = today (2026-05-01), since the quarter hasn't
    // closed — and 2026-05-01 is BEFORE the change's effective_from
    // (2026-06-15), so the OLD row is still the one in effect. The change
    // has not happened yet as far as "today" is concerned.
    expect(oldTlQ2.map(r => r.person_code)).toContain('KUM');
    expect(newTlQ2.map(r => r.person_code)).not.toContain('KUM');
  });

  describe('duplicate-row guard', () => {
    test('throws if MORE THAN ONE row resolves as valid for the same person_code at asOfDate', () => {
      freezeToday('2026-08-01');
      seedRoster([
        { person_code: 'OLD_TL', role: 'TEAM_LEAD' },
        { person_code: 'NEW_TL', role: 'TEAM_LEAD' },
        { person_code: 'KUM', role: 'DESIGNER', supervisor_code: 'OLD_TL', effective_from: '2024-01-01', effective_to: '' },
        { person_code: 'KUM', role: 'DESIGNER', supervisor_code: 'NEW_TL', effective_from: '2025-01-01', effective_to: '' }
      ]);
      mocks.RBAC.resolveActor = function (email) {
        return { email: email, role: 'TEAM_LEAD', personCode: 'OLD_TL' };
      };

      // Tightened 2026-07-27: assert on the SPECIFIC guard, not just any
      // throw mentioning KUM.
      expect(() => PortalData.getMyRatees('old-tl@test.blc.internal', '2026-Q1')).toThrow(/KUM/);
      expect(() => PortalData.getMyRatees('old-tl@test.blc.internal', '2026-Q1')).toThrow(/more than one/i);
    });

    test('throws on an inverted validity window (effective_to before effective_from), even for a quarter that would otherwise skip the row entirely', () => {
      freezeToday('2026-08-01');
      seedRoster([
        { person_code: 'OLD_TL', role: 'TEAM_LEAD' },
        // effective_from is AFTER effective_to — an impossible window, far outside
        // Q1 2026's range either way, so the normal range filter would silently skip
        // it if the inverted-window check didn't fire first.
        { person_code: 'KUM', role: 'DESIGNER', supervisor_code: 'OLD_TL', effective_from: '2026-05-01', effective_to: '2026-04-01' }
      ]);
      mocks.RBAC.resolveActor = function (email) {
        return { email: email, role: 'TEAM_LEAD', personCode: 'OLD_TL' };
      };

      expect(() => PortalData.getMyRatees('old-tl@test.blc.internal', '2026-Q1')).toThrow(/KUM/);
      expect(() => PortalData.getMyRatees('old-tl@test.blc.internal', '2026-Q1')).toThrow(/inverted/i);
    });
  });
});
