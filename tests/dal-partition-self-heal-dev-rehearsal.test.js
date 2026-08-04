/**
 * dal-partition-self-heal-dev-rehearsal.test.js
 *
 * Smoke test for DalPartitionSelfHealDevRehearsal.gs's OWN control flow
 * (reset -> blank -> real DAL call -> verify), loading the REAL DAL.gs
 * alongside it — not a handler stub, since this rehearsal calls
 * DAL.appendRow()/DAL.ensurePartition() directly. Catches syntax/
 * reference errors and control-flow bugs before real DEV execution.
 * The real Sheets behavior (does the insertSheet()-then-setValues()
 * split actually get healed against a live spreadsheet) is proven by
 * the real DEV run itself, per this session's established pattern.
 */

const fs   = require('fs');
const path = require('path');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

function makeMockSheet(name, opts) {
  opts = opts || {};
  var headerRow = opts.headerRow ? opts.headerRow.slice() : [];
  var appended  = [];
  return {
    getName:       function () { return name; },
    getLastColumn: function () { return headerRow.length; },
    getLastRow:    function () { return 1 + appended.length; },
    getRange:      function (row, col, numRows) {
      return {
        getValues: function () {
          if (row === 1) return [headerRow];
          return appended.slice(row - 2, row - 2 + (numRows || 1));
        },
        setValues: function (values) {
          if (row === 1) { headerRow = values[0].slice(); return; }
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

  var ssMock = {
    getSheetByName: function (name) { return sheetsByName[name] || null; },
    insertSheet: function (name) {
      var sheet = makeMockSheet(name, {});
      sheetsByName[name] = sheet;
      return sheet;
    },
    deleteSheet: function (sheet) {
      Object.keys(sheetsByName).forEach(function (k) { if (sheetsByName[k] === sheet) delete sheetsByName[k]; });
    },
    getSheets: function () { return Object.keys(sheetsByName).map(function (k) { return sheetsByName[k]; }); }
  };

  global.SpreadsheetApp = {
    openById:            function () { return ssMock; },
    getActiveSpreadsheet: function () { return ssMock; },
    flush:               function () {}
  };

  global.Config = {
    getSpreadsheetId: function () { return 'MOCK-SS-ID'; },
    isDev: function () { return true; },
    TABLES: { FACT_WORK_LOGS: 'FACT_WORK_LOGS', FACT_QC_EVENTS: 'FACT_QC_EVENTS' }
  };

  global.Identifiers = {
    generateCurrentPeriodId:  function () { return '2026-08'; },
    generatePartitionTabName: function (t, p) { return t + '|' + p; }
  };

  global.SCHEMAS = {
    FACT_WORK_LOGS: ['event_id', 'job_number', 'period_id', 'event_type', 'timestamp', 'actor_code', 'actor_role', 'hours', 'work_date', 'notes', 'idempotency_key', 'payload_json'],
    FACT_QC_EVENTS: ['event_id', 'job_number', 'period_id', 'event_type', 'timestamp', 'actor_code', 'actor_role', 'qc_result', 'rework_notes', 'notes', 'idempotency_key', 'payload_json', 'qc_session_id']
  };

  global.Logger = { log: function () {} };
}

beforeEach(() => {
  installMocks();
  loadSrc('../src/01-dal/DAL.gs');
  global.DAL._resetForTesting();
  loadSrc('../src/12-migration/DalPartitionSelfHealDevRehearsal.gs');
});

describe('runDalPartitionSelfHealDevRehearsal() — smoke test (real DAL.gs, mocked Sheets)', () => {
  test('runs the full control flow without error, all checks pass', () => {
    const result = runDalPartitionSelfHealDevRehearsal();
    if (result.fail > 0) {
      throw new Error('Rehearsal reported ' + result.fail + ' failure(s):\n' + result.failures.join('\n'));
    }
    expect(result.fail).toBe(0);
    expect(result.pass).toBeGreaterThan(0);
  });

  test('refuses to run outside DEV', () => {
    global.Config.isDev = () => false;
    expect(() => runDalPartitionSelfHealDevRehearsal()).toThrow(/cannot run outside DEV/);
  });
});
