/**
 * dal-partition-header-self-heal.test.js
 *
 * Covers the fix for ensurePartition()'s non-atomic insertSheet()-then-
 * header-copy gap (the root cause of the Aug 2026 partition incident —
 * see CTO_TASK_QUEUE.md). Two mechanisms:
 *
 *   A. A tab that EXISTS but has a BLANK header (interrupted between
 *      insertSheet() and the header write) previously stayed broken
 *      forever — every write silently discarded, and no caller ever
 *      re-checked. Fixed: appendRow()/appendRows() (the one path every
 *      write goes through, regardless of whether the caller called
 *      ensurePartition() again first) and ensurePartition()'s own
 *      early-return path both now self-heal a blank header against
 *      canonical SCHEMAS before proceeding.
 *
 *   B. A brand-new partition's header was copied from whichever sibling
 *      tab happened to be found first in tab order — not canonical
 *      SCHEMAS — so a new tab could be born already stale if that
 *      sibling predated a schema change. Fixed: new partitions now
 *      write directly from canonical SCHEMAS; sibling-copy is only a
 *      fallback when SCHEMAS is unavailable.
 *
 * A NON-blank header that doesn't match canonical SCHEMAS is
 * deliberately never auto-rewritten (real data rows may already be
 * positionally written against that exact header) — only warned about.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

function makeMockSheet(name, opts) {
  opts = opts || {};
  var headerRow = opts.headerRow ? opts.headerRow.slice() : [];
  var dataRows  = opts.dataRows ? opts.dataRows.map(function (r) { return r.slice(); }) : [];
  var appended  = [];

  return {
    getName:       function () { return name; },
    getLastColumn: function () { return headerRow.length; },
    getLastRow:    function () { return 1 + dataRows.length + appended.length; },
    getRange:      function (row, col, numRows, numCols) {
      return {
        getValues: function () {
          if (row === 1) return [headerRow];
          throw new Error('mock only supports reading row 1 (header)');
        },
        setValues: function (values) {
          if (row === 1) { headerRow = values[0].slice(); return; }
          // bulk appendRows write path
          values.forEach(function (v) { appended.push(v); });
        }
      };
    },
    appendRow: function (row) { appended.push(row); },
    _headerRow: function () { return headerRow; },
    _appended:  function () { return appended; }
  };
}

let sheetsByName;

function installMocks() {
  sheetsByName = {};

  global.SpreadsheetApp = {
    openById: function () {
      return {
        getSheetByName: function (name) { return sheetsByName[name] || null; },
        insertSheet: function (name) {
          var sheet = makeMockSheet(name, {});
          sheetsByName[name] = sheet;
          return sheet;
        },
        getSheets: function () { return Object.keys(sheetsByName).map(function (k) { return sheetsByName[k]; }); }
      };
    }
  };

  global.Config = {
    getSpreadsheetId: function () { return 'MOCK-SS-ID'; },
    isDev: function () { return true; },
    TABLES: { FACT_WORK_LOGS: 'FACT_WORK_LOGS', DIM_STAFF_ROSTER: 'DIM_STAFF_ROSTER' }
  };

  global.Identifiers = {
    generateCurrentPeriodId:  function () { return '2026-08'; },
    generatePartitionTabName: function (t, p) { return t + '|' + p; }
  };

  global.SCHEMAS = {
    FACT_WORK_LOGS: ['event_id', 'job_number', 'period_id', 'event_type', 'timestamp', 'actor_code', 'actor_role', 'hours', 'work_date', 'notes', 'idempotency_key', 'payload_json']
  };

  global.Logger = { log: function () {} };
}

let DAL;

beforeEach(() => {
  installMocks();
  loadSrc('../src/01-dal/DAL.gs');
  DAL = global.DAL;
  DAL._resetForTesting();
});

describe('appendRow() self-heals a blank header before writing (Mechanism A)', () => {
  test('a blank-header partition is repaired to canonical SCHEMAS, then the write succeeds', () => {
    sheetsByName['FACT_WORK_LOGS|2026-08'] = makeMockSheet('FACT_WORK_LOGS|2026-08', { headerRow: [] });

    DAL.appendRow('FACT_WORK_LOGS', {
      event_id: 'E1', job_number: 'BLC-00001', period_id: '2026-08', event_type: 'WORK_LOG_SUBMITTED',
      actor_code: 'DS1', hours: 2
    }, { callerModule: 'WorkLogHandler' });

    const sheet = sheetsByName['FACT_WORK_LOGS|2026-08'];
    expect(sheet._headerRow()).toEqual(global.SCHEMAS.FACT_WORK_LOGS);
    expect(sheet._appended().length).toBe(1);
  });

  test('throws a clear BLANK_HEADER_NO_SCHEMA error rather than silently discarding the write when no canonical schema is available', () => {
    delete global.SCHEMAS.FACT_WORK_LOGS;
    sheetsByName['FACT_WORK_LOGS|2026-08'] = makeMockSheet('FACT_WORK_LOGS|2026-08', { headerRow: [] });

    expect(() => DAL.appendRow('FACT_WORK_LOGS', { event_id: 'E1' }, { callerModule: 'WorkLogHandler' }))
      .toThrow(/BLANK_HEADER_NO_SCHEMA|blank header/i);
  });

  test('does NOT touch an already-healthy header', () => {
    sheetsByName['FACT_WORK_LOGS|2026-08'] = makeMockSheet('FACT_WORK_LOGS|2026-08', { headerRow: global.SCHEMAS.FACT_WORK_LOGS });

    DAL.appendRow('FACT_WORK_LOGS', {
      event_id: 'E1', job_number: 'BLC-00001', period_id: '2026-08', event_type: 'WORK_LOG_SUBMITTED', actor_code: 'DS1', hours: 2
    }, { callerModule: 'WorkLogHandler' });

    expect(sheetsByName['FACT_WORK_LOGS|2026-08']._headerRow()).toEqual(global.SCHEMAS.FACT_WORK_LOGS);
  });

  test('does NOT auto-rewrite a non-blank header that merely differs from canonical (missing a newer column)', () => {
    var oldHeader = global.SCHEMAS.FACT_WORK_LOGS.slice(0, -1); // missing payload_json
    sheetsByName['FACT_WORK_LOGS|2026-08'] = makeMockSheet('FACT_WORK_LOGS|2026-08', { headerRow: oldHeader });

    DAL.appendRow('FACT_WORK_LOGS', {
      event_id: 'E1', job_number: 'BLC-00001', period_id: '2026-08', event_type: 'WORK_LOG_SUBMITTED', actor_code: 'DS1', hours: 2
    }, { callerModule: 'WorkLogHandler' });

    // header must be untouched — exactly the old (shorter) header, not silently rewritten
    expect(sheetsByName['FACT_WORK_LOGS|2026-08']._headerRow()).toEqual(oldHeader);
  });
});

describe('appendRows() self-heals a blank header before bulk-writing (Mechanism A, bulk path)', () => {
  test('a blank-header partition is repaired before the bulk write', () => {
    sheetsByName['FACT_WORK_LOGS|2026-08'] = makeMockSheet('FACT_WORK_LOGS|2026-08', { headerRow: [] });

    DAL.appendRows('FACT_WORK_LOGS', [
      { event_id: 'E1', job_number: 'BLC-00001', period_id: '2026-08', event_type: 'WORK_LOG_SUBMITTED', actor_code: 'DS1', hours: 2 },
      { event_id: 'E2', job_number: 'BLC-00002', period_id: '2026-08', event_type: 'WORK_LOG_SUBMITTED', actor_code: 'DS2', hours: 3 }
    ], { callerModule: 'MigrationReconFiller' });

    expect(sheetsByName['FACT_WORK_LOGS|2026-08']._headerRow()).toEqual(global.SCHEMAS.FACT_WORK_LOGS);
  });
});

describe('ensurePartition() — early-return path also self-heals (Mechanism A)', () => {
  test('a blank-header EXISTING tab is repaired, not just silently confirmed as "exists"', () => {
    sheetsByName['FACT_WORK_LOGS|2026-08'] = makeMockSheet('FACT_WORK_LOGS|2026-08', { headerRow: [] });

    const result = DAL.ensurePartition('FACT_WORK_LOGS', '2026-08', 'WorkLogHandler');

    expect(result.created).toBe(false);
    expect(sheetsByName['FACT_WORK_LOGS|2026-08']._headerRow()).toEqual(global.SCHEMAS.FACT_WORK_LOGS);
  });

  test('throws rather than silently returning created:false when blank and no schema available', () => {
    delete global.SCHEMAS.FACT_WORK_LOGS;
    sheetsByName['FACT_WORK_LOGS|2026-08'] = makeMockSheet('FACT_WORK_LOGS|2026-08', { headerRow: [] });

    expect(() => DAL.ensurePartition('FACT_WORK_LOGS', '2026-08', 'WorkLogHandler')).toThrow();
  });
});

describe('ensurePartition() — new partition creation writes from canonical SCHEMAS (Mechanism B)', () => {
  test('a brand-new partition gets the canonical header, even when an older, stale sibling exists', () => {
    var staleHeader = global.SCHEMAS.FACT_WORK_LOGS.slice(0, -1); // missing payload_json — simulates a pre-schema-change sibling
    sheetsByName['FACT_WORK_LOGS|2026-06'] = makeMockSheet('FACT_WORK_LOGS|2026-06', { headerRow: staleHeader });

    const result = DAL.ensurePartition('FACT_WORK_LOGS', '2026-08', 'WorkLogHandler');

    expect(result.created).toBe(true);
    expect(sheetsByName['FACT_WORK_LOGS|2026-08']._headerRow()).toEqual(global.SCHEMAS.FACT_WORK_LOGS);
  });

  test('falls back to copying a sibling header only when canonical SCHEMAS is unavailable', () => {
    delete global.SCHEMAS.FACT_WORK_LOGS;
    var siblingHeader = ['event_id', 'job_number', 'hours'];
    sheetsByName['FACT_WORK_LOGS|2026-06'] = makeMockSheet('FACT_WORK_LOGS|2026-06', { headerRow: siblingHeader });

    const result = DAL.ensurePartition('FACT_WORK_LOGS', '2026-08', 'WorkLogHandler');

    expect(result.created).toBe(true);
    expect(sheetsByName['FACT_WORK_LOGS|2026-08']._headerRow()).toEqual(siblingHeader);
  });

  test('creates an empty tab (no header) when neither canonical SCHEMAS nor any sibling is available — unchanged first-deploy behavior', () => {
    delete global.SCHEMAS.FACT_WORK_LOGS;

    const result = DAL.ensurePartition('FACT_WORK_LOGS', '2026-08', 'WorkLogHandler');

    expect(result.created).toBe(true);
    expect(sheetsByName['FACT_WORK_LOGS|2026-08']._headerRow()).toEqual([]);
  });
});
