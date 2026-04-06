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
