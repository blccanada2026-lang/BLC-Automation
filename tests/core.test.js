/**
 * core.test.js
 * Tests for the most critical BLC business logic.
 *
 * What we test:
 *  1. getBillingPeriod()   — splits dates into 1-15 or 16-End correctly
 *  2. getInvoiceMonth()    — returns the right month name
 *  3. normaliseDesignerName() — maps name variants to canonical names
 *  4. isValidHours()       — rejects bad hour values
 *  5. findJobRow()         — finds the right row in MASTER for a job number
 */

require('./gas-mocks');
const { resetMockSpreadsheet, getMockSpreadsheet } = require('./gas-mocks');

// ── Load the code under test ───────────────────────────────────
// We read Code.js as a string and eval it so GAS globals are available.
const fs   = require('fs');
const path = require('path');

const codeJs = fs.readFileSync(path.join(__dirname, '../Code.js'), 'utf8');
eval(codeJs);  // loads CONFIG, DESIGNER_NAME_MAP, and all functions into scope


// ─────────────────────────────────────────────────────────────
// 1. getBillingPeriod()
// ─────────────────────────────────────────────────────────────
describe('getBillingPeriod()', () => {

  test('March 1 → 1-15 period', () => {
    expect(getBillingPeriod(new Date(2026, 2, 1))).toBe('2026-03 | 1-15');
  });

  test('March 15 → 1-15 period', () => {
    expect(getBillingPeriod(new Date(2026, 2, 15))).toBe('2026-03 | 1-15');
  });

  test('March 16 → 16-End period', () => {
    expect(getBillingPeriod(new Date(2026, 2, 16))).toBe('2026-03 | 16-End');
  });

  test('March 31 → 16-End period', () => {
    expect(getBillingPeriod(new Date(2026, 2, 31))).toBe('2026-03 | 16-End');
  });

  test('January 1 → zero-padded month', () => {
    expect(getBillingPeriod(new Date(2026, 0, 1))).toBe('2026-01 | 1-15');
  });

});


// ─────────────────────────────────────────────────────────────
// 2. getInvoiceMonth()
// ─────────────────────────────────────────────────────────────
describe('getInvoiceMonth()', () => {

  test('March 2026', () => {
    expect(getInvoiceMonth(new Date(2026, 2, 10))).toBe('March 2026');
  });

  test('January 2026', () => {
    expect(getInvoiceMonth(new Date(2026, 0, 1))).toBe('January 2026');
  });

  test('December 2026', () => {
    expect(getInvoiceMonth(new Date(2026, 11, 25))).toBe('December 2026');
  });

});


// ─────────────────────────────────────────────────────────────
// 3. normaliseDesignerName()
// ─────────────────────────────────────────────────────────────
describe('normaliseDesignerName()', () => {

  test('exact canonical name passes through unchanged', () => {
    expect(normaliseDesignerName('Sarty Gosh')).toBe('Sarty Gosh');
  });

  test('SG-Sarty Gosh → Sarty Gosh', () => {
    expect(normaliseDesignerName('SG-Sarty Gosh')).toBe('Sarty Gosh');
  });

  test('SG - Sarty Gosh (with spaces) → Sarty Gosh', () => {
    expect(normaliseDesignerName('SG - Sarty Gosh')).toBe('Sarty Gosh');
  });

  test('SN-Savvy Nath → Savvy Nath', () => {
    expect(normaliseDesignerName('SN-Savvy Nath')).toBe('Savvy Nath');
  });

  test('DS-Deb Sen → Deb Sen', () => {
    expect(normaliseDesignerName('DS-Deb Sen')).toBe('Deb Sen');
  });

  test('Debnath Sen → Deb Sen', () => {
    expect(normaliseDesignerName('Debnath Sen')).toBe('Deb Sen');
  });

  test('unknown name passes through unchanged', () => {
    expect(normaliseDesignerName('John Smith')).toBe('John Smith');
  });

  test('trims whitespace', () => {
    expect(normaliseDesignerName('  Sarty Gosh  ')).toBe('Sarty Gosh');
  });

});


// ─────────────────────────────────────────────────────────────
// 4. isValidHours()
// ─────────────────────────────────────────────────────────────
describe('isValidHours()', () => {

  test('8 hours → valid', () => {
    expect(isValidHours(8)).toBe(true);
  });

  test('0.5 hours → valid', () => {
    expect(isValidHours(0.5)).toBe(true);
  });

  test('24 hours → valid (max)', () => {
    expect(isValidHours(24)).toBe(true);
  });

  test('0 hours → invalid', () => {
    expect(isValidHours(0)).toBe(false);
  });

  test('25 hours → invalid (over 24)', () => {
    expect(isValidHours(25)).toBe(false);
  });

  test('negative hours → invalid', () => {
    expect(isValidHours(-1)).toBe(false);
  });

  test('text string → invalid', () => {
    expect(isValidHours('abc')).toBe(false);
  });

  test('empty string → invalid', () => {
    expect(isValidHours('')).toBe(false);
  });

});


// ─────────────────────────────────────────────────────────────
// 5. findJobRow()
// ─────────────────────────────────────────────────────────────
describe('findJobRow()', () => {

  beforeEach(() => {
    resetMockSpreadsheet();
    const ss = getMockSpreadsheet();

    // Set up a fake MASTER_JOB_DATABASE with 3 rows
    // Row 1 = header, Row 2 = job BLC-001, Row 3 = job BLC-002
    ss.addSheet('MASTER_JOB_DATABASE', [
      ['Job_Number', 'Client_Code', 'Designer_Name', 'Status', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'No'],  // header
      ['BLC-001',   'SBS',         'Sarty Gosh',    'In Design', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'No'],
      ['BLC-002',   'TITAN',       'Savvy Nath',    'Allocated',  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'No']
    ]);
  });

  test('finds BLC-001 at row 2', () => {
    expect(findJobRow('BLC-001')).toBe(2);
  });

  test('finds BLC-002 at row 3', () => {
    expect(findJobRow('BLC-002')).toBe(3);
  });

  test('returns -1 for job that does not exist', () => {
    expect(findJobRow('BLC-999')).toBe(-1);
  });

  test('job number matching is case-insensitive', () => {
    expect(findJobRow('blc-001')).toBe(2);
  });

});
