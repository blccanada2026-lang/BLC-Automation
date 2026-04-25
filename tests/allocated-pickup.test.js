/**
 * allocated-pickup.test.js
 *
 * Tests for the pre-allocated job pickup fix in onJobStartSubmit().
 *
 * THE BUG (now fixed):
 *   Sarty allocates a job to a designer via the Allocation Form.
 *   The job sits in MASTER with status = "Allocated".
 *   Designer submits the Job Start Form.
 *   OLD BEHAVIOUR: system logged "DUPLICATE JOB START" and did nothing.
 *   NEW BEHAVIOUR: system updates status to "Picked Up" ✅
 */

require('./gas-mocks');
const { resetMockSpreadsheet, getMockSpreadsheet } = require('./gas-mocks');

const fs   = require('fs');
const path = require('path');

// ── Load Code.js ──────────────────────────────────────────────
const codeJs = fs.readFileSync(path.join(__dirname, '../Code.js'), 'utf8');
eval(codeJs);

// ── Helpers ───────────────────────────────────────────────────

/**
 * Build a 36-column MASTER row (all blanks, then override what you need).
 * Indices are 0-based to match array positions.
 */
function makeMasterRow(overrides = {}) {
  const row = new Array(36).fill('');
  // Defaults
  row[0]  = overrides.jobNumber    || 'BLC-TEST-001';
  row[1]  = overrides.clientCode   || 'SBS';
  row[2]  = overrides.clientName   || 'SBS Client';
  row[3]  = overrides.designerName || 'Sarty Gosh';
  row[4]  = overrides.productType  || 'Roof Truss';
  row[9]  = overrides.status       || 'Allocated';
  row[30] = overrides.isTest       || 'No';
  row[35] = overrides.isImported   || 'No';
  return row;
}

/**
 * Build a fake Job Start Form response row.
 * Columns match CONFIG.jobStartCols (1-based → 0-based index here).
 */
function makeFormResponse(overrides = {}) {
  return [
    overrides.timestamp          || new Date(2026, 2, 17, 9, 0, 0),  // [0] timestamp
    overrides.jobNumber          || 'BLC-TEST-001',                   // [1] jobNumber
    overrides.clientName         || 'SBS Client',                     // [2] clientName
    overrides.designerName       || 'Sarty Gosh',                     // [3] designerName
    overrides.expectedCompletion || new Date(2026, 2, 20),            // [4] expectedCompletion
    overrides.isReallocation     || 'No',                             // [5] isReallocation
    overrides.sopAcknowledged    || 'Yes',                            // [6] sopAcknowledged
    overrides.productType        || 'Roof Truss'                      // [7] productType
  ];
}

// ── Test setup ────────────────────────────────────────────────

beforeEach(() => {
  resetMockSpreadsheet();
  const ss = getMockSpreadsheet();

  // Stub functions that live in OTHER .gs files
  global.logExceptionV2  = jest.fn();           // ExceptionLogArchiverV2.gs
  global.findJobRowByKey = jest.fn(() => 2);    // CompositeKeyFix.gs

  // Set up all required sheets
  ss.addSheet('FORM_Job_Start', [
    ['Timestamp', 'Job Number', 'Client Name', 'Designer Name',
     'Expected Completion', 'Is Reallocation?', 'SOP Acknowledged?', 'Product Type'],
    makeFormResponse()
  ]);

  ss.addSheet('MASTER_JOB_DATABASE', [
    new Array(36).fill('HEADER'),   // row 1 = header
    makeMasterRow()                 // row 2 = BLC-TEST-001 in Allocated status
  ]);

  ss.addSheet('ACTIVE_JOBS', [
    ['Job_Number','Client_Code','Client_Name','Designer_Name','Product_Type',
     'Status','Allocated_Date','Expected_Completion','Timestamp','Last_Updated_By'],
    ['BLC-TEST-001','SBS','SBS Client','Sarty Gosh','Roof Truss',
     'Allocated', new Date(2026,2,15), new Date(2026,2,20), new Date(), 'onAllocationSubmit']
  ]);

  ss.addSheet('EXCEPTIONS_LOG', [
    ['Timestamp','Type','Job_Number','Person','Message']
  ]);
});


// ─────────────────────────────────────────────────────────────
// THE MAIN FIX — pre-allocated pickup
// ─────────────────────────────────────────────────────────────

describe('onJobStartSubmit() — pre-allocated pickup (THE FIX)', () => {

  test('status in MASTER changes from Allocated to Picked Up', () => {
    onJobStartSubmit({});

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const status = master._data[1][9]; // row 2 (index 1), col 10 (index 9) = status
    expect(status).toBe('Picked Up');
  });

  test('startDate gets filled in (was blank before pickup)', () => {
    onJobStartSubmit({});

    const master    = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const startDate = master._data[1][6]; // col 7 (index 6) = startDate
    expect(startDate).not.toBe('');
    expect(startDate).not.toBeNull();
  });

  test('billingPeriod gets filled in', () => {
    onJobStartSubmit({});

    const master        = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const billingPeriod = master._data[1][17]; // col 18 (index 17) = billingPeriod
    expect(billingPeriod).toMatch(/^\d{4}-\d{2} \| (1-15|16-End)$/);
  });

  test('sopAcknowledged gets saved from the form', () => {
    onJobStartSubmit({});

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const sop    = master._data[1][19]; // col 20 (index 19) = sopAcknowledged
    expect(sop).toBe('Yes');
  });

  test('lastUpdatedBy is set to "Job Start Form - Allocated Pickup"', () => {
    onJobStartSubmit({});

    const master        = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const lastUpdatedBy = master._data[1][27]; // col 28 (index 27) = lastUpdatedBy
    expect(lastUpdatedBy).toBe('Job Start Form - Allocated Pickup');
  });

  test('ACTIVE_JOBS status updates from Allocated to Picked Up', () => {
    onJobStartSubmit({});

    const active = getMockSpreadsheet().getSheetByName('ACTIVE_JOBS');
    const status = active._data[1][5]; // row 2 (index 1), col 6 (index 5) = Status
    expect(status).toBe('Picked Up');
  });

  test('does NOT log DUPLICATE JOB START (the old bug)', () => {
    onJobStartSubmit({});

    // Check every call to logExceptionV2 — none should mention DUPLICATE
    const allMessages = global.logExceptionV2.mock.calls
      .map(call => String(call[3] || '').toUpperCase());

    const hasDuplicate = allMessages.some(msg => msg.includes('DUPLICATE'));
    expect(hasDuplicate).toBe(false);
  });

});


// ─────────────────────────────────────────────────────────────
// DESIGNER MISMATCH WARNING
// ─────────────────────────────────────────────────────────────

describe('onJobStartSubmit() — designer mismatch warning', () => {

  test('logs a WARNING when a different designer picks up the job', () => {
    const ss = getMockSpreadsheet();

    // Override form response: different designer picking up
    ss.getSheetByName('FORM_Job_Start')._data[1] =
      makeFormResponse({ designerName: 'Savvy Nath' });  // allocated to Sarty, picked up by Savvy

    onJobStartSubmit({});

    const warningCalls = global.logExceptionV2.mock.calls
      .filter(call => call[0] === 'WARNING');
    expect(warningCalls.length).toBeGreaterThan(0);
  });

  test('still updates status to Picked Up even with designer mismatch', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_Job_Start')._data[1] =
      makeFormResponse({ designerName: 'Savvy Nath' });

    onJobStartSubmit({});

    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][9]).toBe('Picked Up');
  });

});


// ─────────────────────────────────────────────────────────────
// OTHER WORKFLOWS STILL WORK
// ─────────────────────────────────────────────────────────────

describe('onJobStartSubmit() — other workflows unaffected', () => {

  test('true duplicate (job already Picked Up) still logs DUPLICATE', () => {
    const ss = getMockSpreadsheet();

    // Change the existing row status to "In Design" (not Allocated)
    ss.getSheetByName('MASTER_JOB_DATABASE')._data[1][9] = 'In Design';

    onJobStartSubmit({});

    const messages = global.logExceptionV2.mock.calls
      .map(call => String(call[3] || '').toUpperCase());

    expect(messages.some(msg => msg.includes('DUPLICATE'))).toBe(true);
  });

  test('reallocation (isReallocation=Yes) updates designer name', () => {
    const ss = getMockSpreadsheet();

    // Change status to active (non-allocated) and flag as reallocation
    ss.getSheetByName('MASTER_JOB_DATABASE')._data[1][9] = 'In Design';
    ss.getSheetByName('FORM_Job_Start')._data[1] =
      makeFormResponse({ isReallocation: 'Yes', designerName: 'Savvy Nath' });

    onJobStartSubmit({});

    const master     = ss.getSheetByName('MASTER_JOB_DATABASE');
    const designer   = master._data[1][3];  // col 4 (index 3) = designerName
    const realloc    = master._data[1][20]; // col 21 (index 20) = reallocationFlag
    expect(designer).toBe('Savvy Nath');
    expect(realloc).toBe('Yes');
  });

  test('brand new job (not in MASTER) creates a new row', () => {
    const ss = getMockSpreadsheet();

    // Use a job number that doesn't exist in MASTER
    ss.getSheetByName('FORM_Job_Start')._data[1] =
      makeFormResponse({ jobNumber: 'BLC-NEW-999' });

    // Add CLIENT_MASTER so getClientCode() doesn't crash
    ss.addSheet('CLIENT_MASTER', [
      ['Client_Code', 'Client_Name', '', '', '', '', '', '', '', 'Yes'],
      ['SBS', 'SBS Client', '', '', '', '', '', '', '', 'Yes']
    ]);

    onJobStartSubmit({});

    const master   = ss.getSheetByName('MASTER_JOB_DATABASE');
    const lastRow  = master._data[master._data.length - 1];
    expect(lastRow[0]).toBe('BLC-NEW-999');
    expect(lastRow[9]).toBe('Picked Up');
  });

});
