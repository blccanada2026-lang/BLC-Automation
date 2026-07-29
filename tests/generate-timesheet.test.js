/**
 * generate-timesheet.test.js
 *
 * Tests for GenerateTimesheet.gs's generateTimesheet(client, startDate,
 * endDate) + firstHalf(year, month)/secondHalf(year, month) convenience
 * wrappers (Phase B1, Item 4, payroll automation).
 *
 * Deliberately scoped narrower than ClientTimesheetEngine.generate():
 * no PreBillingGate check, no rate lookup, no PDF/invoice generation.
 * This is a new, general-purpose, read-only "give me the timesheet
 * entries for a client and an arbitrary date range" data function, not
 * a replacement for the billing invoice pipeline — those stay
 * untouched. Uses the same isMigratedWorkLog() exclusion and the same
 * netting PRINCIPLE Task 1 established (sum all nonzero hours
 * including negative correction deltas, never early-filter negatives)
 * as aggregateNetWorkLogHours() — not that exact function, since it
 * aggregates per-actor only and this needs per-(job, designer)
 * granularity for a client timesheet; see the source file's own
 * comment for why.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

function installMocks() {
  var store = {};
  function readAll(tableName, opts) {
    var key = tableName;
    if (opts && opts.periodId) key = tableName + '|' + opts.periodId;
    return (store[key] || store[tableName] || []).slice();
  }

  global.DAL = {
    readAll: function (t, opts) { return readAll(t, opts); }
  };
  global.Config = {
    TABLES: {
      FACT_WORK_LOGS: 'FACT_WORK_LOGS',
      VW_JOB_CURRENT_STATE: 'VW_JOB_CURRENT_STATE',
      DIM_CLIENT_MASTER: 'DIM_CLIENT_MASTER',
      DIM_PRODUCT_RATES: 'DIM_PRODUCT_RATES',
      DIM_CLIENT_RATES: 'DIM_CLIENT_RATES'
    }
  };
  global.Logger = { info: function () {}, warn: function () {}, error: function () {} };
  var idCounter = 0;
  global.Identifiers = { generateId: function () { idCounter++; return 'RUN-' + idCounter; } };

  return store;
}

let store;

beforeEach(() => {
  store = installMocks();
  loadSrc('../src/00-foundation/Constants.gs');
  loadSrc('../src/06-handlers/WorkLogExclusion.gs');
  loadSrc('../src/11-reporting/ClientTimesheetEngine.gs');
  loadSrc('../src/11-reporting/GenerateTimesheet.gs');
});

function seedJobs(rows) {
  store['VW_JOB_CURRENT_STATE'] = rows.map(r => Object.assign({
    job_number: '', client_code: '', job_type: '', product_code: '',
    current_state: 'IN_PROGRESS', client_job_ref: ''
  }, r));
}

function seedWorkLogs(periodId, rows) {
  var key = 'FACT_WORK_LOGS|' + periodId;
  store[key] = rows.map(r => Object.assign({
    event_type: 'WORK_LOG_SUBMITTED', notes: ''
  }, r));
}

function seedClients(rows) {
  store['DIM_CLIENT_MASTER'] = rows.map(r => Object.assign({
    client_code: '', client_name: '', active: 'TRUE'
  }, r));
}

describe('generateTimesheet(client, startDate, endDate) — validation', () => {
  test('throws if client is missing or empty', () => {
    expect(() => generateTimesheet('', '2026-08-01', '2026-08-15')).toThrow(/client/i);
    expect(() => generateTimesheet(null, '2026-08-01', '2026-08-15')).toThrow(/client/i);
  });

  test('throws if startDate is after endDate', () => {
    expect(() => generateTimesheet('ACME', '2026-08-15', '2026-08-01')).toThrow(/start.*end|end.*start/i);
  });

  test('throws on an ambiguous/unparseable date string', () => {
    expect(() => generateTimesheet('ACME', '08/01/2026', '2026-08-15')).toThrow(/date/i);
    expect(() => generateTimesheet('ACME', '2026-08-01', 'not-a-date')).toThrow(/date/i);
  });

  test('accepts unambiguous ISO strings and real Date objects equally', () => {
    seedJobs([]);
    expect(() => generateTimesheet('ACME', '2026-08-01', '2026-08-15')).not.toThrow();
    expect(() => generateTimesheet('ACME', new Date(2026, 7, 1), new Date(2026, 7, 15))).not.toThrow();
  });
});

describe('generateTimesheet() — aggregation, exclusion, netting', () => {
  test('aggregates hours per (job, designer) for the given client only, within the date range', () => {
    seedJobs([
      { job_number: 'BLC-001', client_code: 'ACME' },
      { job_number: 'BLC-002', client_code: 'OTHER' }
    ]);
    seedWorkLogs('2026-08', [
      { job_number: 'BLC-001', actor_code: 'DES1', hours: 5, work_date: '2026-08-05', period_id: '2026-08' },
      { job_number: 'BLC-001', actor_code: 'DES1', hours: 3, work_date: '2026-08-06', period_id: '2026-08' },
      { job_number: 'BLC-002', actor_code: 'DES1', hours: 100, work_date: '2026-08-06', period_id: '2026-08' } // OTHER client, excluded
    ]);

    var result = generateTimesheet('ACME', '2026-08-01', '2026-08-15');

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].job_number).toBe('BLC-001');
    expect(result.entries[0].designer_code).toBe('DES1');
    expect(result.entries[0].hours).toBe(8); // 5 + 3, netted
    expect(result.total_hours).toBe(8);
  });

  test('excludes rows outside the date range', () => {
    seedJobs([{ job_number: 'BLC-001', client_code: 'ACME' }]);
    seedWorkLogs('2026-08', [
      { job_number: 'BLC-001', actor_code: 'DES1', hours: 5, work_date: '2026-08-05', period_id: '2026-08' }, // in range
      { job_number: 'BLC-001', actor_code: 'DES1', hours: 9, work_date: '2026-08-20', period_id: '2026-08' }  // out of range
    ]);

    var result = generateTimesheet('ACME', '2026-08-01', '2026-08-15');

    expect(result.total_hours).toBe(5);
  });

  test('excludes migrated historical rows via isMigratedWorkLog', () => {
    seedJobs([{ job_number: 'BLC-001', client_code: 'ACME' }]);
    seedWorkLogs('2026-08', [
      { job_number: 'BLC-001', actor_code: 'DES1', hours: 5, work_date: '2026-08-05', period_id: '2026-08',
        event_type: 'WORK_LOG_MIGRATED' },
      { job_number: 'BLC-001', actor_code: 'DES1', hours: 3, work_date: '2026-08-06', period_id: '2026-08',
        event_type: 'WORK_LOG_SUBMITTED' }
    ]);

    var result = generateTimesheet('ACME', '2026-08-01', '2026-08-15');

    expect(result.total_hours).toBe(3); // migrated row excluded
  });

  test('nets a void correction against its original — Task 1\'s shared netting principle, not an early hours<=0 filter', () => {
    seedJobs([{ job_number: 'BLC-001', client_code: 'ACME' }]);
    seedWorkLogs('2026-08', [
      { job_number: 'BLC-001', actor_code: 'DES1', hours: 10, work_date: '2026-08-05', period_id: '2026-08' },
      { job_number: 'BLC-001', actor_code: 'DES1', hours: -10, work_date: '2026-08-05', period_id: '2026-08',
        event_type: 'WORK_LOG_VOIDED' },
      { job_number: 'BLC-001', actor_code: 'DES1', hours: 6, work_date: '2026-08-07', period_id: '2026-08',
        event_type: 'WORK_LOG_SUBMITTED' } // resubmit
    ]);

    var result = generateTimesheet('ACME', '2026-08-01', '2026-08-15');

    expect(result.total_hours).toBe(6); // 10 - 10 + 6, nets to the resubmit only
    expect(result.entries).toHaveLength(1); // the fully-voided job+designer pair doesn't leave a zero-hour ghost entry once netted
  });

  test('a fully-reversed (net <= 0) job+designer pair produces no entry at all', () => {
    seedJobs([{ job_number: 'BLC-001', client_code: 'ACME' }]);
    seedWorkLogs('2026-08', [
      { job_number: 'BLC-001', actor_code: 'DES1', hours: 10, work_date: '2026-08-05', period_id: '2026-08' },
      { job_number: 'BLC-001', actor_code: 'DES1', hours: -10, work_date: '2026-08-05', period_id: '2026-08',
        event_type: 'WORK_LOG_VOIDED' }
    ]);

    var result = generateTimesheet('ACME', '2026-08-01', '2026-08-15');

    expect(result.entries).toHaveLength(0);
    expect(result.total_hours).toBe(0);
  });
});

describe('generateTimesheet() — cross-month partition handling', () => {
  test('a date range spanning two calendar months reads BOTH partitions and combines results', () => {
    seedJobs([{ job_number: 'BLC-001', client_code: 'ACME' }]);
    seedWorkLogs('2026-07', [
      { job_number: 'BLC-001', actor_code: 'DES1', hours: 4, work_date: '2026-07-30', period_id: '2026-07' }
    ]);
    seedWorkLogs('2026-08', [
      { job_number: 'BLC-001', actor_code: 'DES1', hours: 6, work_date: '2026-08-02', period_id: '2026-08' }
    ]);

    var result = generateTimesheet('ACME', '2026-07-28', '2026-08-05');

    expect(result.total_hours).toBe(10); // 4 + 6, both partitions combined
  });
});

describe('generateTimesheet() — run metadata on output', () => {
  test('includes a unique run_id, an ISO generated_at timestamp, and echoes the exact requested date range', () => {
    seedJobs([]);
    var result = generateTimesheet('ACME', '2026-08-01', '2026-08-15');

    expect(result.run_id).toBeTruthy();
    expect(result.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp shape
    expect(result.client).toBe('ACME');
    expect(result.start_date).toBe('2026-08-01');
    expect(result.end_date).toBe('2026-08-15');
  });

  test('two calls produce two different run_ids', () => {
    seedJobs([]);
    var r1 = generateTimesheet('ACME', '2026-08-01', '2026-08-15');
    var r2 = generateTimesheet('ACME', '2026-08-01', '2026-08-15');
    expect(r1.run_id).not.toBe(r2.run_id);
  });
});

describe('firstHalf(year, month) / secondHalf(year, month) — month-boundary date math', () => {
  test('firstHalf is always the 1st through the 15th, regardless of month length', () => {
    seedClients([{ client_code: 'ACME' }]);
    seedJobs([]);
    var results = firstHalf(2026, 2); // February
    expect(results[0].start_date).toBe('2026-02-01');
    expect(results[0].end_date).toBe('2026-02-15');
  });

  test('secondHalf correctly computes the last day of a 31-day month (January)', () => {
    seedClients([{ client_code: 'ACME' }]);
    seedJobs([]);
    var results = secondHalf(2026, 1);
    expect(results[0].start_date).toBe('2026-01-16');
    expect(results[0].end_date).toBe('2026-01-31');
  });

  test('secondHalf correctly computes the last day of a 30-day month (April)', () => {
    seedClients([{ client_code: 'ACME' }]);
    seedJobs([]);
    var results = secondHalf(2026, 4);
    expect(results[0].end_date).toBe('2026-04-30');
  });

  test('secondHalf correctly computes the last day of February in a non-leap year (2026 -> 28)', () => {
    seedClients([{ client_code: 'ACME' }]);
    seedJobs([]);
    var results = secondHalf(2026, 2);
    expect(results[0].end_date).toBe('2026-02-28');
  });

  test('secondHalf correctly computes the last day of February in a leap year (2028 -> 29)', () => {
    seedClients([{ client_code: 'ACME' }]);
    seedJobs([]);
    var results = secondHalf(2028, 2);
    expect(results[0].end_date).toBe('2028-02-29');
  });

  test('loops every active client and skips inactive ones', () => {
    seedClients([
      { client_code: 'ACME', active: 'TRUE' },
      { client_code: 'GONE', active: 'FALSE' }
    ]);
    seedJobs([]);
    var results = firstHalf(2026, 8);
    var clients = results.map(r => r.client);
    expect(clients).toContain('ACME');
    expect(clients).not.toContain('GONE');
  });
});
