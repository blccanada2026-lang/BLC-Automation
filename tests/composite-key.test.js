/**
 * composite-key.test.js
 *
 * Tests for findJobRowByKey() in CompositeKeyFix.js.
 *
 * This is the 8-level priority matcher that routes form submissions
 * to the right MASTER row when the same job has multiple rows
 * (parallel components, revisions, etc.).
 *
 * Priority order (highest to lowest):
 *   p0a — active + exact designer + exact product  ← THE KEY FIX
 *   p0b — active + exact designer
 *   p0c — active + exact product
 *   p0d — active, any (non-imported)
 *   p1  — exact designer + product (terminal ok)
 *   p2  — exact designer (terminal ok)
 *   p3  — exact product (terminal ok)
 *   p4  — non-imported, non-terminal
 *   p0i — active, imported (last active resort)
 *   p5  — any row
 */

require('./gas-mocks');
const { resetMockSpreadsheet, getMockSpreadsheet } = require('./gas-mocks');

const fs   = require('fs');
const path = require('path');

// Load Code.js first (CONFIG, normaliseDesignerName, getSheet, etc.)
const codeJs = fs.readFileSync(path.join(__dirname, '../Code.js'), 'utf8');
eval(codeJs);

// Load CompositeKeyFix.js (findJobRowByKey)
const compositeJs = fs.readFileSync(
  path.join(__dirname, '../CompositeKeyFix.js'), 'utf8'
);
eval(compositeJs);

// ── Helpers ───────────────────────────────────────────────────

function makeMasterRow(overrides = {}) {
  const row = new Array(36).fill('');
  row[0]  = overrides.jobNumber    || 'BLC-TEST-001';
  row[3]  = overrides.designerName || 'Sarty Gosh';
  row[4]  = overrides.productType  || 'Roof Truss';
  row[9]  = overrides.status       || 'In Design';
  row[35] = overrides.isImported   || 'No';
  return row;
}

// ── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  resetMockSpreadsheet();
  global.logExceptionV2 = jest.fn();
});


// ─────────────────────────────────────────────────────────────
// BASIC MATCHING
// ─────────────────────────────────────────────────────────────

describe('findJobRowByKey() — basic matching', () => {

  test('finds the only row (active + exact designer + exact product)', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow() // row 2
    ]);

    const result = findJobRowByKey('BLC-TEST-001', 'Roof Truss', 'Sarty Gosh');
    expect(result).toBe(2);
  });

  test('returns -1 when job number does not exist', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow()
    ]);

    const result = findJobRowByKey('BLC-GHOST-999', 'Roof Truss', 'Sarty Gosh');
    expect(result).toBe(-1);
  });

  test('job number matching is case-insensitive', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow()
    ]);

    const result = findJobRowByKey('blc-test-001', 'Roof Truss', 'Sarty Gosh');
    expect(result).toBe(2);
  });

});


// ─────────────────────────────────────────────────────────────
// PRIORITY — PARALLEL COMPONENTS (SAME JOB, DIFFERENT PRODUCTS)
// This is the bug fix: two designers working different product
// types on the same job must not write to each other's row.
// ─────────────────────────────────────────────────────────────

describe('findJobRowByKey() — parallel components priority', () => {

  test('returns the row whose product type matches (Roof Truss)', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow({ designerName: 'Sarty Gosh', productType: 'Roof Truss' }),   // row 2
      makeMasterRow({ designerName: 'Savvy Nath', productType: 'Floor Truss' }),  // row 3
    ]);

    const result = findJobRowByKey('BLC-TEST-001', 'Roof Truss', 'Sarty Gosh');
    expect(result).toBe(2); // must pick Sarty's Roof Truss row
  });

  test('returns the row whose product type matches (Floor Truss)', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow({ designerName: 'Sarty Gosh', productType: 'Roof Truss' }),   // row 2
      makeMasterRow({ designerName: 'Savvy Nath', productType: 'Floor Truss' }),  // row 3
    ]);

    const result = findJobRowByKey('BLC-TEST-001', 'Floor Truss', 'Savvy Nath');
    expect(result).toBe(3); // must pick Savvy's Floor Truss row
  });

  test('does NOT return a different designer\'s row when exact match exists', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow({ designerName: 'Sarty Gosh', productType: 'Roof Truss' }), // row 2
      makeMasterRow({ designerName: 'Savvy Nath', productType: 'Roof Truss' }), // row 3 — same product, different designer
    ]);

    // Looking for Sarty Gosh's row
    const result = findJobRowByKey('BLC-TEST-001', 'Roof Truss', 'Sarty Gosh');
    expect(result).toBe(2); // must NOT return row 3 (Savvy's row)
  });

});


// ─────────────────────────────────────────────────────────────
// PRIORITY — ACTIVE vs TERMINAL
// Active rows (p0a–p0d) should always win over terminal rows (p1–p5).
// ─────────────────────────────────────────────────────────────

describe('findJobRowByKey() — active row priority over terminal', () => {

  test('active row wins over completed row', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow({ status: 'Completed - Billable', productType: 'Roof Truss', designerName: 'Sarty Gosh' }), // row 2 — terminal
      makeMasterRow({ status: 'In Design',            productType: 'Roof Truss', designerName: 'Sarty Gosh' }), // row 3 — active
    ]);

    // Should return the active row (3), not the completed row (2)
    const result = findJobRowByKey('BLC-TEST-001', 'Roof Truss', 'Sarty Gosh');
    expect(result).toBe(3);
  });

  test('"Allocated" status is treated as active', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow({ status: 'Allocated' })
    ]);

    const result = findJobRowByKey('BLC-TEST-001', 'Roof Truss', 'Sarty Gosh');
    expect(result).toBe(2);
  });

  test('"Revision" status is treated as active', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow({ status: 'Revision' })
    ]);

    const result = findJobRowByKey('BLC-TEST-001', 'Roof Truss', 'Sarty Gosh');
    expect(result).toBe(2);
  });

});


// ─────────────────────────────────────────────────────────────
// PRIORITY — IMPORTED ROWS
// Imported rows are deprioritised — only used as absolute last resort.
// ─────────────────────────────────────────────────────────────

describe('findJobRowByKey() — imported row deprioritisation', () => {

  test('non-imported active row wins over imported active row', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow({ isImported: 'Yes', status: 'In Design' }), // row 2 — imported
      makeMasterRow({ isImported: 'No',  status: 'In Design' }), // row 3 — live
    ]);

    const result = findJobRowByKey('BLC-TEST-001', 'Roof Truss', 'Sarty Gosh');
    expect(result).toBe(3); // live row wins
  });

  test('falls back to imported row when no live row exists', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow({ isImported: 'Yes', status: 'In Design' }), // row 2 — only option
    ]);

    const result = findJobRowByKey('BLC-TEST-001', 'Roof Truss', 'Sarty Gosh');
    expect(result).toBe(2);
  });

});


// ─────────────────────────────────────────────────────────────
// EDGE CASES
// ─────────────────────────────────────────────────────────────

describe('findJobRowByKey() — edge cases', () => {

  test('returns -1 for null job number', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow()
    ]);

    const result = findJobRowByKey(null, 'Roof Truss', 'Sarty Gosh');
    expect(result).toBe(-1);
  });

  test('prefers most recent row within same priority bucket', () => {
    const ss = getMockSpreadsheet();
    // Two identical rows — should return the LAST one (most recent)
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow({ status: 'In Design' }), // row 2
      makeMasterRow({ status: 'In Design' }), // row 3 — same, but newer
    ]);

    const result = findJobRowByKey('BLC-TEST-001', 'Roof Truss', 'Sarty Gosh');
    expect(result).toBe(3); // picks last within bucket
  });

  test('works with designer name variants (normalised)', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      makeMasterRow({ designerName: 'Sarty Gosh' }) // canonical name in MASTER
    ]);

    // Submitting with variant "SG-Sarty Gosh" — should still find row 2
    const result = findJobRowByKey('BLC-TEST-001', 'Roof Truss', 'SG-Sarty Gosh');
    expect(result).toBe(2);
  });

  test('blank product in MASTER row acts as wildcard (matches any product)', () => {
    const ss = getMockSpreadsheet();
    const row = makeMasterRow({ productType: '', status: 'In Design' });
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(36).fill('HEADER'),
      row // product type is blank
    ]);

    // Should still find the row even though products don't exactly match
    const result = findJobRowByKey('BLC-TEST-001', 'Floor Truss', 'Sarty Gosh');
    expect(result).toBe(2);
  });

});
