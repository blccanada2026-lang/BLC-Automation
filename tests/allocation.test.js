/**
 * allocation.test.js
 *
 * Tests for onAllocationSubmit() in AllocationSystem.js.
 *
 * What we test:
 *  1. New job creates a row in MASTER_JOB_DATABASE with status "Allocated"
 *  2. New job also creates a row in ACTIVE_JOBS
 *  3. Duplicate allocation is blocked (job already in MASTER)
 *  4. Missing required fields (jobNumber, clientCode, designer, productType) abort
 *  5. Designer name is normalised (e.g. "SG-Sarty Gosh" → "Sarty Gosh")
 *  6. Client name is looked up from CLIENT_MASTER by client code
 *  7. Notes field is saved to the MASTER row
 */

require('./gas-mocks');
const { resetMockSpreadsheet, getMockSpreadsheet } = require('./gas-mocks');

const fs   = require('fs');
const path = require('path');

// Load Code.js first (provides CONFIG, normaliseDesignerName, getSheet, etc.)
const codeJs = fs.readFileSync(path.join(__dirname, '../Code.js'), 'utf8');
eval(codeJs);

// Load AllocationSystem.js (provides onAllocationSubmit, addToActiveJobsOnAllocation, etc.)
const allocJs = fs.readFileSync(path.join(__dirname, '../AllocationSystem.js'), 'utf8');
eval(allocJs);

// ── Helpers ───────────────────────────────────────────────────

/**
 * Build an e.values array that onAllocationSubmit() reads.
 * Indices match ALLOC_FORM object (0-based):
 *   0 = timestamp, 1 = jobNumber, 2 = clientCode, 3 = designerName,
 *   4 = productType, 5 = expectedCompletion, 6 = notes, 7 = allocatedBy
 */
function makeAllocValues(overrides = {}) {
  // Use !== undefined to allow explicit '' overrides ('' || default gives wrong result)
  function v(key, def) { return overrides[key] !== undefined ? overrides[key] : def; }
  return [
    v('timestamp',          new Date(2026, 2, 17, 9, 0, 0)),  // [0]
    v('jobNumber',          'BLC-ALLOC-001'),                  // [1]
    v('clientCode',         'SBS'),                            // [2]
    v('designerName',       'Sarty Gosh'),                     // [3]
    v('productType',        'Roof Truss'),                     // [4]
    v('expectedCompletion', new Date(2026, 2, 20)),            // [5]
    v('notes',              ''),                                // [6]
    v('allocatedBy',        'Sarty Gosh'),                     // [7]
  ];
}

// ── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  resetMockSpreadsheet();
  const ss = getMockSpreadsheet();

  global.logExceptionV2 = jest.fn();

  // Empty MASTER (just header)
  ss.addSheet('MASTER_JOB_DATABASE', [
    new Array(36).fill('HEADER'),
  ]);

  ss.addSheet('ACTIVE_JOBS', [
    ['Job_Number','Client_Code','Client_Name','Designer_Name','Product_Type',
     'Status','Allocated_Date','Expected_Completion','Timestamp','Last_Updated_By'],
  ]);

  ss.addSheet('CLIENT_MASTER', [
    ['Client_Code','Client_Name','','','','','','','','Active'],
    ['SBS','SBS Client','','','','','','','','Yes'],
    ['TITAN','Titan Homes','','','','','','','','Yes'],
  ]);

  ss.addSheet('EXCEPTIONS_LOG', [
    ['Timestamp','Type','Job_Number','Person','Message']
  ]);
});


// ─────────────────────────────────────────────────────────────
// CORE — NEW JOB CREATED
// ─────────────────────────────────────────────────────────────

describe('onAllocationSubmit() — new job creation', () => {

  test('new job row is appended to MASTER_JOB_DATABASE', () => {
    onAllocationSubmit({ values: makeAllocValues() });

    const master  = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const newRow  = master._data[master._data.length - 1];
    expect(newRow[0]).toBe('BLC-ALLOC-001'); // jobNumber
  });

  test('status is set to "Allocated"', () => {
    onAllocationSubmit({ values: makeAllocValues() });

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const row    = master._data[master._data.length - 1];
    expect(row[9]).toBe('Allocated'); // col 10 (index 9) = status
  });

  test('clientCode is saved', () => {
    onAllocationSubmit({ values: makeAllocValues() });

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const row    = master._data[master._data.length - 1];
    expect(row[1]).toBe('SBS'); // col 2 (index 1) = clientCode
  });

  test('clientName is looked up from CLIENT_MASTER', () => {
    onAllocationSubmit({ values: makeAllocValues() });

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const row    = master._data[master._data.length - 1];
    expect(row[2]).toBe('SBS Client'); // col 3 (index 2) = clientName
  });

  test('designerName is saved', () => {
    onAllocationSubmit({ values: makeAllocValues() });

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const row    = master._data[master._data.length - 1];
    expect(row[3]).toBe('Sarty Gosh'); // col 4 (index 3) = designerName
  });

  test('productType is saved', () => {
    onAllocationSubmit({ values: makeAllocValues() });

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const row    = master._data[master._data.length - 1];
    expect(row[4]).toBe('Roof Truss'); // col 5 (index 4) = productType
  });

  test('notes field is saved', () => {
    onAllocationSubmit({ values: makeAllocValues({ notes: 'Urgent — needs review' }) });

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const row    = master._data[master._data.length - 1];
    expect(row[28]).toBe('Urgent — needs review'); // col 29 (index 28) = notes
  });

  test('lastUpdatedBy is set to "onAllocationSubmit"', () => {
    onAllocationSubmit({ values: makeAllocValues() });

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const row    = master._data[master._data.length - 1];
    expect(row[27]).toBe('onAllocationSubmit'); // col 28 (index 27) = lastUpdatedBy
  });

});


// ─────────────────────────────────────────────────────────────
// ACTIVE JOBS
// ─────────────────────────────────────────────────────────────

describe('onAllocationSubmit() — ACTIVE_JOBS', () => {

  test('new row is added to ACTIVE_JOBS', () => {
    onAllocationSubmit({ values: makeAllocValues() });

    const active   = getMockSpreadsheet().getSheetByName('ACTIVE_JOBS');
    const lastRow  = active._data[active._data.length - 1];
    expect(lastRow[0]).toBe('BLC-ALLOC-001'); // job number
  });

  test('ACTIVE_JOBS row has status "Allocated"', () => {
    onAllocationSubmit({ values: makeAllocValues() });

    const active  = getMockSpreadsheet().getSheetByName('ACTIVE_JOBS');
    const lastRow = active._data[active._data.length - 1];
    expect(lastRow[5]).toBe('Allocated'); // col 6 (index 5) = Status
  });

});


// ─────────────────────────────────────────────────────────────
// DUPLICATE BLOCKING
// ─────────────────────────────────────────────────────────────

describe('onAllocationSubmit() — duplicate blocking', () => {

  test('duplicate allocation is blocked — MASTER row not added', () => {
    // Pre-populate MASTER with the same job
    const ss = getMockSpreadsheet();
    const existingRow = new Array(36).fill('');
    existingRow[0]  = 'BLC-ALLOC-001';
    existingRow[9]  = 'In Design';
    existingRow[35] = 'No';
    ss.getSheetByName('MASTER_JOB_DATABASE')._data.push(existingRow);

    const beforeCount = ss.getSheetByName('MASTER_JOB_DATABASE')._data.length;
    onAllocationSubmit({ values: makeAllocValues() });
    const afterCount  = ss.getSheetByName('MASTER_JOB_DATABASE')._data.length;

    expect(afterCount).toBe(beforeCount); // no new row added
  });

  test('duplicate allocation logs a warning', () => {
    const ss = getMockSpreadsheet();
    const existingRow = new Array(36).fill('');
    existingRow[0]  = 'BLC-ALLOC-001';
    existingRow[9]  = 'In Design';
    existingRow[35] = 'No';
    ss.getSheetByName('MASTER_JOB_DATABASE')._data.push(existingRow);

    onAllocationSubmit({ values: makeAllocValues() });

    const warnCalls = global.logExceptionV2.mock.calls
      .filter(call => call[0] === 'WARNING');
    expect(warnCalls.length).toBeGreaterThan(0);
  });

});


// ─────────────────────────────────────────────────────────────
// DESIGNER NAME NORMALISATION
// ─────────────────────────────────────────────────────────────

describe('onAllocationSubmit() — designer name normalisation', () => {

  test('"SG-Sarty Gosh" is normalised to "Sarty Gosh"', () => {
    onAllocationSubmit({ values: makeAllocValues({ designerName: 'SG-Sarty Gosh' }) });

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const row    = master._data[master._data.length - 1];
    expect(row[3]).toBe('Sarty Gosh');
  });

  test('"SN-Savvy Nath" is normalised to "Savvy Nath"', () => {
    onAllocationSubmit({ values: makeAllocValues({ designerName: 'SN-Savvy Nath' }) });

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const row    = master._data[master._data.length - 1];
    expect(row[3]).toBe('Savvy Nath');
  });

});


// ─────────────────────────────────────────────────────────────
// VALIDATION — MISSING REQUIRED FIELDS
// ─────────────────────────────────────────────────────────────

describe('onAllocationSubmit() — field validation', () => {

  test('aborts if job number is blank', () => {
    onAllocationSubmit({ values: makeAllocValues({ jobNumber: '' }) });

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data.length).toBe(1); // only header
  });

  test('aborts if client code is blank', () => {
    onAllocationSubmit({ values: makeAllocValues({ clientCode: '' }) });

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data.length).toBe(1);
  });

  test('aborts if designer name is blank', () => {
    onAllocationSubmit({ values: makeAllocValues({ designerName: '' }) });

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data.length).toBe(1);
  });

  test('aborts if product type is blank', () => {
    onAllocationSubmit({ values: makeAllocValues({ productType: '' }) });

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data.length).toBe(1);
  });

});
