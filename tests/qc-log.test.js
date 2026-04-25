/**
 * qc-log.test.js
 *
 * Tests for onQCLogSubmit() — the QC Log Form handler.
 *
 * What we test:
 *  1. QC hours accumulate in qcHoursTotal
 *  2. totalBillableHours = designHours + qcHours
 *  3. QC outcomes set the right status:
 *       "Pass"             → Completed - Billable
 *       "Major Error"      → Rework - Major
 *       "Minor Error"      → Rework - Minor
 *       "Re-QC Pass"       → Completed - Billable
 *       "Re-QC Failed"     → Rework - Major
 *  4. On completion: billingPeriod and invoiceMonth are recorded
 *  5. On completion: job is removed from ACTIVE_JOBS
 *  6. On rework: reworkFlag = "Yes" and reworkCount increments
 *  7. Invalid hours are rejected
 *  8. Missing job number is rejected
 *  9. Job not in MASTER is rejected
 */

require('./gas-mocks');
const { resetMockSpreadsheet, getMockSpreadsheet } = require('./gas-mocks');

const fs   = require('fs');
const path = require('path');

const codeJs = fs.readFileSync(path.join(__dirname, '../Code.js'), 'utf8');
eval(codeJs);

// ── Helpers ───────────────────────────────────────────────────

function makeMasterRow(overrides = {}) {
  const row = new Array(36).fill('');
  row[0]  = overrides.jobNumber       || 'BLC-TEST-001';
  row[1]  = overrides.clientCode      || 'SBS';
  row[2]  = overrides.clientName      || 'SBS Client';
  row[3]  = overrides.designerName    || 'Sarty Gosh';
  row[4]  = overrides.productType     || 'Roof Truss';
  row[9]  = overrides.status          || 'Submitted For QC';
  row[10] = overrides.designHoursTotal|| 8;   // col 11 = designHoursTotal
  row[11] = overrides.qcHoursTotal    || 0;   // col 12 = qcHoursTotal
  row[12] = overrides.totalBillable   || 8;   // col 13 = totalBillableHours
  row[22] = overrides.reworkFlag      || 'No';// col 23 = reworkFlag
  row[23] = overrides.reworkCount     || 0;   // col 24 = reworkCount
  row[30] = 'No';                             // isTest
  row[35] = 'No';                             // isImported
  return row;
}

/**
 * QC form response — indices match response[] positions (0-based).
 * The handler reads sheet.getRange(lastRow, 1, 1, 12).getValues()[0]
 *
 * [0]  timestamp
 * [1]  jobNumber       (qcLogCols.jobNumber   - 1 = 1)
 * [2]  reviewerName    (qcLogCols.reviewerName- 1 = 2)
 * [3]  dateOfReview    (qcLogCols.dateOfReview- 1 = 3)
 * [4]  hoursSpent      (qcLogCols.hoursSpent  - 1 = 4)
 * [5]  productType     (qcLogCols.productType - 1 = 5)
 * [6]  outcome         (qcLogCols.outcome     - 1 = 6)
 * [7]  qcNotes
 * [8]  checklistConfirm
 * [9]  sqftVerified    (hardcoded response[9])
 * [10] boardFootage    (hardcoded response[10])
 * [11] typeOfReview
 */
function makeQCResponse(overrides = {}) {
  // Use !== undefined to allow explicit '' overrides ('' || default would give wrong result)
  function v(key, def) { return overrides[key] !== undefined ? overrides[key] : def; }
  return [
    v('timestamp',       new Date(2026, 2, 17, 10, 0, 0)), // [0]
    v('jobNumber',       'BLC-TEST-001'),                   // [1]
    v('reviewerName',    'Sarty Gosh'),                    // [2]
    v('dateOfReview',    new Date(2026, 2, 17)),           // [3]
    v('hoursSpent',      2),                               // [4]
    v('productType',     'Roof Truss'),                    // [5]
    v('outcome',         'Pass'),                          // [6]
    v('qcNotes',         ''),                              // [7]
    v('checklistConfirm','Yes'),                           // [8]
    v('sqftVerified',    ''),                              // [9]
    v('boardFootage',    ''),                              // [10]
    v('typeOfReview',    'Full QC'),                       // [11]
  ];
}

// ── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  resetMockSpreadsheet();
  const ss = getMockSpreadsheet();

  global.logExceptionV2 = jest.fn();
  // NOTE: onQCLogSubmit does its own MASTER scan — does NOT use findJobRowByKey

  ss.addSheet('FORM_QC_Log', [
    ['Timestamp','Job Number','Reviewer','Date','Hours','Product','Outcome',
     'Notes','Checklist','SqftVerified','BoardFootage','Type'],
    makeQCResponse()
  ]);

  ss.addSheet('MASTER_JOB_DATABASE', [
    new Array(36).fill('HEADER'),
    makeMasterRow()
  ]);

  ss.addSheet('ACTIVE_JOBS', [
    ['Job_Number','Client_Code','Client_Name','Designer_Name','Product_Type',
     'Status','Allocated_Date','Expected_Completion','Timestamp','Last_Updated_By'],
    ['BLC-TEST-001','SBS','SBS Client','Sarty Gosh','Roof Truss',
     'Submitted For QC','','','','']
  ]);

  ss.addSheet('EXCEPTIONS_LOG', [
    ['Timestamp','Type','Job_Number','Person','Message']
  ]);
});


// ─────────────────────────────────────────────────────────────
// QC HOURS
// ─────────────────────────────────────────────────────────────

describe('onQCLogSubmit() — QC hours', () => {

  test('QC hours added to qcHoursTotal', () => {
    onQCLogSubmit({});

    const master   = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const qcHours  = master._data[1][11]; // col 12 (index 11) = qcHoursTotal
    expect(qcHours).toBe(2);
  });

  test('QC hours stack on existing hours', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('MASTER_JOB_DATABASE')._data[1][11] = 3; // already has 3 hours

    onQCLogSubmit({});

    const master  = ss.getSheetByName('MASTER_JOB_DATABASE');
    const qcHours = master._data[1][11];
    expect(qcHours).toBe(5); // 3 existing + 2 new
  });

  test('totalBillableHours = designHours + qcHours', () => {
    onQCLogSubmit({});

    const master   = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const total    = master._data[1][12]; // col 13 (index 12) = totalBillableHours
    expect(total).toBe(10); // 8 design + 2 QC
  });

  test('reviewer name is recorded in qcLead', () => {
    onQCLogSubmit({});

    const master  = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const qcLead  = master._data[1][15]; // col 16 (index 15) = qcLead
    expect(qcLead).toBe('Sarty Gosh');
  });

});


// ─────────────────────────────────────────────────────────────
// OUTCOME → STATUS TRANSITIONS
// ─────────────────────────────────────────────────────────────

describe('onQCLogSubmit() — outcome status transitions', () => {

  test('"Pass" → Completed - Billable', () => {
    onQCLogSubmit({});

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][9]).toBe('Completed - Billable');
  });

  test('"Major Error" → Rework - Major', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_QC_Log')._data[1] = makeQCResponse({ outcome: 'Major Error' });

    onQCLogSubmit({});

    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][9]).toBe('Rework - Major');
  });

  test('"Minor Error" → Rework - Minor', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_QC_Log')._data[1] = makeQCResponse({ outcome: 'Minor Error' });

    onQCLogSubmit({});

    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][9]).toBe('Rework - Minor');
  });

  test('"Re-QC Pass" → Completed - Billable', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_QC_Log')._data[1] = makeQCResponse({ outcome: 'Re-QC Pass' });

    onQCLogSubmit({});

    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][9]).toBe('Completed - Billable');
  });

  test('"Re-QC Failed" → Rework - Major', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_QC_Log')._data[1] = makeQCResponse({ outcome: 'Re-QC Failed' });

    onQCLogSubmit({});

    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][9]).toBe('Rework - Major');
  });

  test('"Spot Check Approved" → Completed - Billable', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_QC_Log')._data[1] = makeQCResponse({ outcome: 'Spot Check Approved' });

    onQCLogSubmit({});

    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][9]).toBe('Completed - Billable');
  });

  test('unknown outcome → QC In Progress', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_QC_Log')._data[1] = makeQCResponse({ outcome: 'Still reviewing' });

    onQCLogSubmit({});

    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][9]).toBe('QC In Progress');
  });

});


// ─────────────────────────────────────────────────────────────
// COMPLETION FLOW
// ─────────────────────────────────────────────────────────────

describe('onQCLogSubmit() — completion flow', () => {

  test('billingPeriod is set when job passes QC', () => {
    onQCLogSubmit({});

    const master  = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const billing = master._data[1][17]; // col 18 (index 17) = billingPeriod
    expect(billing).toMatch(/^\d{4}-\d{2} \| (1-15|16-End)$/);
  });

  test('invoiceMonth is set when job passes QC', () => {
    onQCLogSubmit({});

    const master       = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const invoiceMonth = master._data[1][18]; // col 19 (index 18) = invoiceMonth
    expect(invoiceMonth).toMatch(/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/);
  });

  test('completed job is removed from ACTIVE_JOBS', () => {
    onQCLogSubmit({});

    const active    = getMockSpreadsheet().getSheetByName('ACTIVE_JOBS');
    const remaining = active._data.slice(1); // skip header
    const stillThere = remaining.some(r => String(r[0]).trim() === 'BLC-TEST-001');
    expect(stillThere).toBe(false);
  });

  test('billingPeriod NOT changed when job goes to rework', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_QC_Log')._data[1] = makeQCResponse({ outcome: 'Major Error' });
    ss.getSheetByName('MASTER_JOB_DATABASE')._data[1][17] = ''; // blank billing period

    onQCLogSubmit({});

    const master  = ss.getSheetByName('MASTER_JOB_DATABASE');
    const billing = master._data[1][17];
    // billingPeriod should remain blank — only set on completion
    expect(billing).toBe('');
  });

});


// ─────────────────────────────────────────────────────────────
// REWORK TRACKING
// ─────────────────────────────────────────────────────────────

describe('onQCLogSubmit() — rework tracking', () => {

  test('reworkFlag set to "Yes" on Major Error', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_QC_Log')._data[1] = makeQCResponse({ outcome: 'Major Error' });

    onQCLogSubmit({});

    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][22]).toBe('Yes'); // col 23 (index 22) = reworkFlag
  });

  test('reworkCount increments on each rework outcome', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('MASTER_JOB_DATABASE')._data[1][23] = 1; // already had 1 rework
    ss.getSheetByName('FORM_QC_Log')._data[1] = makeQCResponse({ outcome: 'Minor Error' });

    onQCLogSubmit({});

    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][23]).toBe(2); // 1 existing + 1 new
  });

  test('reworkFlag NOT set to Yes on Pass', () => {
    onQCLogSubmit({});

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][22]).toBe('No'); // reworkFlag stays No
  });

});


// ─────────────────────────────────────────────────────────────
// VALIDATION — INVALID INPUTS REJECTED
// ─────────────────────────────────────────────────────────────

describe('onQCLogSubmit() — input validation', () => {

  test('rejects submission with no job number', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_QC_Log')._data[1] = makeQCResponse({ jobNumber: '' });

    onQCLogSubmit({});

    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    // QC hours should remain 0 — nothing was written
    expect(master._data[1][11]).toBe(0);
  });

  test('rejects submission with 0 hours', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_QC_Log')._data[1] = makeQCResponse({ hoursSpent: 0 });

    onQCLogSubmit({});

    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][11]).toBe(0); // no hours written
  });

  test('rejects submission with hours over 24', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_QC_Log')._data[1] = makeQCResponse({ hoursSpent: 25 });

    onQCLogSubmit({});

    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][11]).toBe(0);
  });

  test('rejects submission for job not in MASTER', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_QC_Log')._data[1] = makeQCResponse({ jobNumber: 'BLC-GHOST-999' });

    onQCLogSubmit({});

    // Nothing blown up — just no write to data
    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][11]).toBe(0);
  });

  test('rejects QC on completed job (terminal status)', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('MASTER_JOB_DATABASE')._data[1][9] = 'Completed - Billable';

    onQCLogSubmit({});

    // Should NOT overwrite status of a completed job
    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][9]).toBe('Completed - Billable');
    expect(master._data[1][11]).toBe(0); // QC hours not written
  });

});
