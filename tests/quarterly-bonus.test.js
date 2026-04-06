/**
 * quarterly-bonus.test.js
 * Tests for QuarterlyBonusEngine.js — the BLC quarterly bonus system.
 */

require('./gas-mocks');
const { resetMockSpreadsheet, getMockSpreadsheet } = require('./gas-mocks');

const fs   = require('fs');
const path = require('path');

// Load Code.js first — provides CONFIG, normaliseDesignerName, getSheet, getSheetData
const codeJs = fs.readFileSync(path.join(__dirname, '../Code.js'), 'utf8');
eval(codeJs);

// Load SheetDB.js — provides SheetDB, ConfigService, and CONFIG_MASTER schema
const sheetDbJs = fs.readFileSync(path.join(__dirname, '../SheetDB.js'), 'utf8');
eval(sheetDbJs);

// Load QuarterlyBonusEngine.js — provides quarterly bonus functions
const quarterlyBonusJs = fs.readFileSync(path.join(__dirname, '../QuarterlyBonusEngine.js'), 'utf8');
eval(quarterlyBonusJs);


// ── Master row builder ────────────────────────────────────────
function makeMasterRow(opts) {
  var row = new Array(42).fill('');
  row[CONFIG.masterCols.billingPeriod - 1] = opts.period       || 'March 2026';
  row[CONFIG.masterCols.designerName  - 1] = opts.name         || 'Alice';
  row[CONFIG.masterCols.designHours   - 1] = opts.design       || 0;
  row[CONFIG.masterCols.reworkHours   - 1] = opts.rework       || 0;
  row[CONFIG.masterCols.isTest        - 1] = opts.isTest       || 'No';
  row[CONFIG.masterCols.clientReturn  - 1] = opts.clientReturn || 0;
  row[CONFIG.masterCols.supId         - 1] = opts.supId        || '';
  return row;
}

function makeMasterSheet(rows) {
  var header = new Array(42).fill('header');
  return [header].concat(rows);
}


// ── Setup ──────────────────────────────────────────────

beforeEach(() => {
  resetMockSpreadsheet();
  // Reset SheetDB's cached spreadsheet reference and read cache so each test
  // gets a fresh MockSpreadsheet rather than the one from the previous test.
  _SDB_STATE.ss = null;
  _SDB_STATE.cache = {};
});


// ── Placeholder suite (tests added in subsequent tasks) ──

describe('QuarterlyBonusEngine (scaffold)', () => {
  test('stub placeholder', () => {
    expect(true).toBe(true);
  });
});


describe('getQuarterHours_', function () {
  test('aggregates design hours across 3 months of a quarter', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026',  name: 'Alice', design: 80 }),
      makeMasterRow({ period: 'February 2026', name: 'Alice', design: 60 }),
      makeMasterRow({ period: 'March 2026',    name: 'Alice', design: 40 }),
      makeMasterRow({ period: 'April 2026',    name: 'Alice', design: 99 })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    var result = getQuarterHours_('Q1', 2026);

    expect(result['Alice']).toBe(180);
    expect(result['AprilAlice']).toBeUndefined();
  });

  test('excludes isTest=Yes rows', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', name: 'Bob', design: 50 }),
      makeMasterRow({ period: 'January 2026', name: 'Bob', design: 10, isTest: 'Yes' })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    var result = getQuarterHours_('Q1', 2026);

    expect(result['Bob']).toBe(50);
  });
});


describe('getErrorRates_', function () {
  test('computes rework/design ratio per designer', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026',  name: 'Alice', design: 100, rework: 10 }),
      makeMasterRow({ period: 'February 2026', name: 'Alice', design: 100, rework: 0  })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    var result = getErrorRates_('Q1', 2026);

    // 10 rework / 200 total design = 0.05
    expect(result['Alice']).toBeCloseTo(0.05);
  });

  test('returns 0 when no rework', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', name: 'Bob', design: 80, rework: 0 })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    expect(getErrorRates_('Q1', 2026)['Bob']).toBe(0);
  });

  test('returns 0 when designer has zero design hours (avoid divide-by-zero)', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', name: 'Carol', design: 0, rework: 0 })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    expect(getErrorRates_('Q1', 2026)['Carol']).toBe(0);
  });
});


describe('getClientQcReturnRates_', function () {
  test('computes return rate per supervisor', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', supId: 'TL001', clientReturn: 1 }),
      makeMasterRow({ period: 'January 2026', supId: 'TL001', clientReturn: 0 }),
      makeMasterRow({ period: 'January 2026', supId: 'TL001', clientReturn: 0 }),
      makeMasterRow({ period: 'January 2026', supId: 'TL001', clientReturn: 0 })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    var result = getClientQcReturnRates_('Q1', 2026);

    // 1 return / 4 total = 0.25
    expect(result['TL001']).toBeCloseTo(0.25);
  });

  test('returns 0 for supervisor with no returns', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', supId: 'TL002', clientReturn: 0 })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    expect(getClientQcReturnRates_('Q1', 2026)['TL002']).toBe(0);
  });

  test('ignores rows with no supId', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', supId: '', clientReturn: 1 })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    var result = getClientQcReturnRates_('Q1', 2026);
    expect(Object.keys(result).length).toBe(0);
  });

  test('excludes isTest rows', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', supId: 'TL003', clientReturn: 1 }),
      makeMasterRow({ period: 'January 2026', supId: 'TL003', clientReturn: 1, isTest: 'Yes' })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    var result = getClientQcReturnRates_('Q1', 2026);
    // Only 1 real job with 1 return; the isTest row must be ignored
    expect(result['TL003']).toBeCloseTo(1.0);
  });
});
