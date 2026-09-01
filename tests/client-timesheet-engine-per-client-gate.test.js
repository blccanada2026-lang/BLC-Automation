/**
 * client-timesheet-engine-per-client-gate.test.js
 *
 * ClientTimesheetEngine.generate() previously hard-failed the ENTIRE
 * run if runPreBillingChecks() found any blocker anywhere in the
 * period, blocking every client's timesheet on one client's data
 * issue. This tests the new per-client isolation: a blocker that can
 * be attributed to a specific client (via data.client_code,
 * data.clients, data.combos, or data.all_job_numbers mapped through
 * loadJobMap_()) excludes only that client from this run; everyone
 * else still generates normally. A blocker that can't be attributed
 * to any specific client (e.g. an orphaned work log with no VW row,
 * or an unrecognized shape) conservatively falls back to the
 * original whole-period block — safety default preserved.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

class FakeSheet {
  clearContents() {}
  getRange() { return { setValues: function () {} }; }
  autoResizeColumn() {}
}

function installMocks() {
  var store = {};
  function readAll(tableName, opts) {
    var key = tableName;
    if (opts && opts.periodId) key = tableName + '|' + opts.periodId;
    return (store[key] || store[tableName] || []).slice();
  }

  global.DAL = { readAll: function (t, opts) { return readAll(t, opts); } };
  global.Config = {
    TABLES: {
      FACT_WORK_LOGS:       'FACT_WORK_LOGS',
      VW_JOB_CURRENT_STATE: 'VW_JOB_CURRENT_STATE',
      DIM_CLIENT_MASTER:    'DIM_CLIENT_MASTER',
      DIM_CLIENT_RATES:     'DIM_CLIENT_RATES',
      DIM_PRODUCT_RATES:    'DIM_PRODUCT_RATES',
      DIM_STAFF_ROSTER:     'DIM_STAFF_ROSTER'
    }
  };
  global.Logger = { info: function () {}, warn: function () {}, error: function () {} };
  global.SpreadsheetApp = {
    getActiveSpreadsheet: function () {
      return {
        getSheetByName: function () { return new FakeSheet(); },
        insertSheet:    function () { return new FakeSheet(); }
      };
    }
  };
  global.isMigratedWorkLog = function () { return false; };

  return store;
}

let store;
let preBillingResult;

beforeEach(() => {
  store = installMocks();
  preBillingResult = { cleared: true, blockers: [] };
  global.runPreBillingChecks = function () { return preBillingResult; };
  loadSrc('../src/11-reporting/ClientTimesheetEngine.gs');
});

function seedJobsAndHours(periodId, jobs) {
  store['VW_JOB_CURRENT_STATE'] = jobs.map(j => ({
    job_number: j.job_number, client_code: j.client_code, product_code: '',
    current_state: 'IN_PROGRESS', client_job_ref: ''
  }));
  store['FACT_WORK_LOGS|' + periodId] = jobs.map(j => ({
    job_number: j.job_number, actor_code: 'DBS', work_date: j.work_date || '2026-08-05',
    hours: '2', event_type: 'WORK_LOG_SUBMITTED'
  }));
}

describe('generate() — gate fully cleared (baseline, unchanged behavior)', () => {
  test('generates every client, skipped_clients is empty', () => {
    seedJobsAndHours('2026-08', [
      { job_number: 'JOB-A', client_code: 'ALPHA' },
      { job_number: 'JOB-B', client_code: 'BETA' }
    ]);

    var result = ClientTimesheetEngine.generate('2026-08A');

    expect(Object.keys(result.clients).sort()).toEqual(['ALPHA', 'BETA']);
    expect(result.skipped_clients).toEqual([]);
  });
});

describe('generate() — blocker attributable to one specific client', () => {
  test('data.client_code: only that client is skipped, others generate normally', () => {
    seedJobsAndHours('2026-08', [
      { job_number: 'JOB-A', client_code: 'ALPHA' },
      { job_number: 'JOB-B', client_code: 'BETA' }
    ]);
    preBillingResult = {
      cleared: false,
      blockers: [{
        check: 'CHECK_3_CLIENT_CODE_CONSISTENCY', message: 'bad code',
        data: { client_code: 'ALPHA' }
      }]
    };

    var result = ClientTimesheetEngine.generate('2026-08A');

    expect(Object.keys(result.clients)).toEqual(['BETA']);
    expect(result.skipped_clients).toEqual(['ALPHA']);
  });

  test('data.clients (array): all listed clients are skipped, others generate normally', () => {
    seedJobsAndHours('2026-08', [
      { job_number: 'JOB-A', client_code: 'ALPHA' },
      { job_number: 'JOB-B', client_code: 'BETA' },
      { job_number: 'JOB-C', client_code: 'GAMMA' }
    ]);
    preBillingResult = {
      cleared: false,
      blockers: [{
        check: 'CHECK_9_RATE_CONFIGURATION', message: 'no rates',
        data: { clients: ['ALPHA', 'GAMMA'] }
      }]
    };

    var result = ClientTimesheetEngine.generate('2026-08A');

    expect(Object.keys(result.clients)).toEqual(['BETA']);
    expect(result.skipped_clients.sort()).toEqual(['ALPHA', 'GAMMA']);
  });

  test('data.combos (object keyed by client|product): each combo\'s client is skipped', () => {
    seedJobsAndHours('2026-08', [
      { job_number: 'JOB-A', client_code: 'ALPHA' },
      { job_number: 'JOB-B', client_code: 'BETA' }
    ]);
    preBillingResult = {
      cleared: false,
      blockers: [{
        check: 'CHECK_9_RATE_CONFIGURATION', message: 'missing combo',
        data: { combos: { 'ALPHA|TRUSS': { client_code: 'ALPHA', product_code: 'TRUSS' } } }
      }]
    };

    var result = ClientTimesheetEngine.generate('2026-08A');

    expect(Object.keys(result.clients)).toEqual(['BETA']);
    expect(result.skipped_clients).toEqual(['ALPHA']);
  });

  test('data.all_job_numbers mapped through the job map: only the affected client is skipped', () => {
    seedJobsAndHours('2026-08', [
      { job_number: 'JOB-A', client_code: 'ALPHA' },
      { job_number: 'JOB-B', client_code: 'BETA' }
    ]);
    preBillingResult = {
      cleared: false,
      blockers: [{
        check: 'CHECK_1_DUPLICATE_WORK_LOGS', message: 'dupes',
        data: { all_job_numbers: ['JOB-A'] }
      }]
    };

    var result = ClientTimesheetEngine.generate('2026-08A');

    expect(Object.keys(result.clients)).toEqual(['BETA']);
    expect(result.skipped_clients).toEqual(['ALPHA']);
  });

  test('skipped_reasons reports WHY each skipped client was excluded', () => {
    seedJobsAndHours('2026-08', [
      { job_number: 'JOB-A', client_code: 'ALPHA' },
      { job_number: 'JOB-B', client_code: 'BETA' }
    ]);
    preBillingResult = {
      cleared: false,
      blockers: [{
        check: 'CHECK_3_CLIENT_CODE_CONSISTENCY', message: 'bad code',
        data: { client_code: 'ALPHA' }
      }]
    };

    var result = ClientTimesheetEngine.generate('2026-08A');

    expect(result.skipped_reasons.ALPHA).toEqual(['CHECK_3_CLIENT_CODE_CONSISTENCY: bad code']);
  });
});

describe('generate() — unattributable blocker falls back to the original whole-period block', () => {
  test('all_job_numbers containing a job with no VW row (e.g. a true orphan) blocks the whole run', () => {
    seedJobsAndHours('2026-08', [
      { job_number: 'JOB-A', client_code: 'ALPHA' }
    ]);
    preBillingResult = {
      cleared: false,
      blockers: [{
        check: 'CHECK_2_ORPHANED_WORK_LOGS', message: 'orphan',
        data: { all_job_numbers: ['ORPHAN-JOB-WITH-NO-VW-ROW'] }
      }]
    };

    expect(() => ClientTimesheetEngine.generate('2026-08A')).toThrow(/Billing blocked/);
  });

  test('a blocker shape with none of the recognized attribution fields blocks the whole run', () => {
    seedJobsAndHours('2026-08', [
      { job_number: 'JOB-A', client_code: 'ALPHA' }
    ]);
    preBillingResult = {
      cleared: false,
      blockers: [{ check: 'CHECK_UNKNOWN', message: 'mystery blocker', data: {} }]
    };

    expect(() => ClientTimesheetEngine.generate('2026-08A')).toThrow(/Billing blocked/);
  });
});
