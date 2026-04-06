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


// ── Setup ──────────────────────────────────────────────

beforeEach(() => {
  resetMockSpreadsheet();
});


// ── Placeholder suite (tests added in subsequent tasks) ──

describe('QuarterlyBonusEngine (scaffold)', () => {
  test('stub placeholder', () => {
    expect(true).toBe(true);
  });
});
