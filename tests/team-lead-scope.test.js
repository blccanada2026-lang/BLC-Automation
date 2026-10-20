/**
 * team-lead-scope.test.js
 *
 * TeamLeadScope.forPeriod(tlCode, periodId) decides which work-log entries
 * a TEAM_LEAD may see (Team Hours, My Hours) and correct
 * (WorkLogCorrectionHandler). Raj, 2026-10-20: "match Team Hours". A TL
 * gets their own entries, their roster direct reports' entries, and entries
 * on jobs REF_ACCOUNT_SUPERVISION assigns to them. Before this, My Hours and
 * corrections used shared-account membership, which let Sandy (SDA) see and
 * correct 12 other people's hours, including his PM's.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let store;

beforeEach(() => {
  store = {};
  global.DAL = { readAll: function (t) { return (store[t] || []).slice(); } };
  global.Config = {
    TABLES: {
      DIM_STAFF_ROSTER:        'DIM_STAFF_ROSTER',
      REF_ACCOUNT_SUPERVISION: 'REF_ACCOUNT_SUPERVISION',
      VW_JOB_CURRENT_STATE:    'VW_JOB_CURRENT_STATE'
    }
  };
  loadSrc('../src/06-handlers/TeamLeadScope.gs');

  store['DIM_STAFF_ROSTER'] = [
    { person_code: 'PBG', supervisor_code: 'SDA', active: true, effective_from: '', effective_to: '' },
    // Closed historical row: SYR reported to BCH until 2026-06-30, still active=TRUE
    { person_code: 'SYR', supervisor_code: 'BCH', active: true, effective_from: new Date(2024, 0, 1), effective_to: new Date(2026, 5, 30) },
    { person_code: 'SYR', supervisor_code: 'SDA', active: true, effective_from: new Date(2026, 6, 1),  effective_to: '' },
    // Joined SDA mid-month (October 15) — still counts for October
    { person_code: 'NEW', supervisor_code: 'SDA', active: true, effective_from: '2026-10-15', effective_to: '' },
    { person_code: 'OFF', supervisor_code: 'SDA', active: false, effective_from: '', effective_to: '' },
    { person_code: 'SGO', supervisor_code: '',    active: true, effective_from: '', effective_to: '' }
  ];
  store['VW_JOB_CURRENT_STATE'] = [
    { job_number: 'J-SBS', client_code: 'SBS',    product_code: 'roof_truss' },
    { job_number: 'J-NEL', client_code: 'NELSON', product_code: 'ROOF_TRUSS' }
  ];
  store['REF_ACCOUNT_SUPERVISION'] = [
    { client_code: 'SBS', product_code: '', designer_code: 'AR001', supervisor_code: 'SDA', effective_from: new Date(2026, 9, 1), effective_to: '' }
  ];
});

describe('TeamLeadScope.forPeriod — direct reports', () => {
  test('own entries and current direct reports are in scope on any job', () => {
    const s = TeamLeadScope.forPeriod('SDA', '2026-10');
    expect(s.inScope('SDA', 'J-NEL')).toBe(true);
    expect(s.inScope('PBG', 'J-NEL')).toBe(true);
    expect(s.inScope('SYR', 'J-SBS')).toBe(true);
  });

  test('a report who joined mid-month counts for that month', () => {
    expect(TeamLeadScope.forPeriod('SDA', '2026-10').inScope('NEW', 'J-NEL')).toBe(true);
    expect(TeamLeadScope.forPeriod('SDA', '2026-09').inScope('NEW', 'J-NEL')).toBe(false);
  });

  test('a closed roster row no longer grants the old TL scope', () => {
    expect(TeamLeadScope.forPeriod('BCH', '2026-10').inScope('SYR', 'J-SBS')).toBe(false);
    expect(TeamLeadScope.forPeriod('BCH', '2026-06').inScope('SYR', 'J-SBS')).toBe(true);
  });

  test('inactive staff and unrelated people are out of scope', () => {
    const s = TeamLeadScope.forPeriod('SDA', '2026-10');
    expect(s.inScope('OFF', 'J-SBS')).toBe(false);
    expect(s.inScope('SGO', 'J-SBS')).toBe(false);
  });

  test('codes are compared case- and space-insensitively', () => {
    expect(TeamLeadScope.forPeriod(' sda ', '2026-10').inScope(' pbg', 'J-NEL')).toBe(true);
  });
});

describe('TeamLeadScope.forPeriod — account supervision (matches the bonus engine)', () => {
  test('AR001 is in Sandy\'s scope only on SBS jobs, from October', () => {
    const oct = TeamLeadScope.forPeriod('SDA', '2026-10');
    expect(oct.inScope('AR001', 'J-SBS')).toBe(true);
    expect(oct.inScope('AR001', 'J-NEL')).toBe(false);
    expect(oct.inScope('AR001', 'J-UNKNOWN')).toBe(false);
    expect(TeamLeadScope.forPeriod('SDA', '2026-09').inScope('AR001', 'J-SBS')).toBe(false);
  });

  test('an exact-product row for another TL beats the wildcard', () => {
    store['REF_ACCOUNT_SUPERVISION'].push(
      { client_code: 'SBS', product_code: 'ROOF_TRUSS', designer_code: 'AR001', supervisor_code: 'BCH', effective_from: '2026-10-01', effective_to: '' });
    expect(TeamLeadScope.forPeriod('SDA', '2026-10').inScope('AR001', 'J-SBS')).toBe(false);
    expect(TeamLeadScope.forPeriod('BCH', '2026-10').inScope('AR001', 'J-SBS')).toBe(true);
  });

  test('couldBeInScope: cheap pre-check — self, direct report, or any supervision row to this TL', () => {
    const s = TeamLeadScope.forPeriod('SDA', '2026-10');
    expect(s.couldBeInScope('SDA')).toBe(true);
    expect(s.couldBeInScope('PBG')).toBe(true);
    expect(s.couldBeInScope('AR001')).toBe(true);
    expect(s.couldBeInScope('SGO')).toBe(false);
  });
});
