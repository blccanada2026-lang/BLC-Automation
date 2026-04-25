/**
 * revision-daily-log.test.js
 *
 * Tests for the Revision status fix in onDailyLogSubmit().
 *
 * THE BUG (now fixed):
 *   A job gets sent back to a designer as a "Revision" (client changed their mind).
 *   Designer opens the Daily Work Log and submits hours.
 *   OLD BEHAVIOUR: system logged "INVALID STATUS" and threw away the hours.
 *   NEW BEHAVIOUR: hours accumulate in designHoursTotal ✅
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
  row[0]  = overrides.jobNumber        || 'BLC-TEST-001';
  row[1]  = overrides.clientCode       || 'SBS';
  row[2]  = overrides.clientName       || 'SBS Client';
  row[3]  = overrides.designerName     || 'Sarty Gosh';
  row[4]  = overrides.productType      || 'Roof Truss';
  row[9]  = overrides.status           || 'Revision';
  row[10] = overrides.designHoursTotal || 0;   // col 11 = designHoursTotal
  row[11] = overrides.qcHoursTotal     || 0;   // col 12 = qcHoursTotal
  row[12] = overrides.totalBillable    || 0;   // col 13 = totalBillableHours
  row[13] = overrides.reworkMajor      || 0;   // col 14 = reworkHoursMajor
  row[14] = overrides.reworkMinor      || 0;   // col 15 = reworkHoursMinor
  row[30] = 'No';                              // isTest
  row[35] = 'No';                              // isImported
  return row;
}

function makeDailyLogResponse(overrides = {}) {
  // Indices match CONFIG.dailyLogCols (1-based) minus 1
  return [
    overrides.timestamp   || new Date(2026, 2, 17, 9, 0, 0), // [0] timestamp
    overrides.jobNumber   || 'BLC-TEST-001',                  // [1] jobNumber
    overrides.designerName|| 'Sarty Gosh',                    // [2] designerName
    overrides.dateWorked  || new Date(2026, 2, 17),           // [3] dateWorked
    overrides.productType || 'Roof Truss',                    // [4] productType
    overrides.hoursWorked || 4,                               // [5] hoursWorked
    overrides.readyForQC  || 'No',                            // [6] readyForQC
    '',                                                        // [7] notes
    ''                                                         // [8] sopConfirmation
  ];
}

// ── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  resetMockSpreadsheet();
  const ss = getMockSpreadsheet();

  // Stub functions that live in other .gs files
  global.logExceptionV2  = jest.fn();
  global.findJobRowByKey = jest.fn(() => 2); // always return row 2

  ss.addSheet('FORM_Daily_Work_Log', [
    ['Timestamp','Job Number','Designer Name','Date Worked',
     'Product Type','Hours Worked','Ready For QC?','Notes','SOP'],
    makeDailyLogResponse()
  ]);

  ss.addSheet('MASTER_JOB_DATABASE', [
    new Array(36).fill('HEADER'),
    makeMasterRow() // row 2, status = Revision by default
  ]);

  ss.addSheet('DESIGNER_MASTER', [
    ['ID','Name','Email','Phone','Role','Team_Lead','Rate','Start','Active'],
    ['D001','Sarty Gosh','sarty@blc.com','','Team Leader','','','','Yes']
  ]);

  ss.addSheet('EXCEPTIONS_LOG', [
    ['Timestamp','Type','Job_Number','Person','Message']
  ]);
});


// ─────────────────────────────────────────────────────────────
// THE MAIN FIX — Revision status should accept hours
// ─────────────────────────────────────────────────────────────

describe('onDailyLogSubmit() — Revision status (THE FIX)', () => {

  test('hours accumulate in designHoursTotal', () => {
    onDailyLogSubmit({});

    const master      = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const designHours = master._data[1][10]; // col 11 (index 10) = designHoursTotal
    expect(designHours).toBe(4);
  });

  test('hours add on top of existing hours', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('MASTER_JOB_DATABASE')._data[1][10] = 6; // already has 6 hours

    onDailyLogSubmit({});

    const master      = ss.getSheetByName('MASTER_JOB_DATABASE');
    const designHours = master._data[1][10];
    expect(designHours).toBe(10); // 6 existing + 4 new
  });

  test('totalBillableHours updates', () => {
    onDailyLogSubmit({});

    const master        = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const totalBillable = master._data[1][12]; // col 13 (index 12) = totalBillableHours
    expect(totalBillable).toBe(4);
  });

  test('status advances from Revision to In Design', () => {
    onDailyLogSubmit({});

    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const status = master._data[1][9]; // col 10 (index 9) = status
    expect(status).toBe('In Design');
  });

  test('does NOT log INVALID STATUS (the old bug)', () => {
    onDailyLogSubmit({});

    const messages = global.logExceptionV2.mock.calls
      .map(call => String(call[3] || '').toUpperCase());

    expect(messages.some(msg => msg.includes('INVALID STATUS'))).toBe(false);
  });

  test('Revision + readyForQC=Yes advances to Submitted For QC', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('FORM_Daily_Work_Log')._data[1] =
      makeDailyLogResponse({ readyForQC: 'Yes' });

    onDailyLogSubmit({});

    const master = ss.getSheetByName('MASTER_JOB_DATABASE');
    const status = master._data[1][9];
    expect(status).toBe('Submitted For QC');
  });

});


// ─────────────────────────────────────────────────────────────
// OTHER VALID STATUSES STILL WORK
// ─────────────────────────────────────────────────────────────

describe('onDailyLogSubmit() — other valid statuses unaffected', () => {

  const validStatuses = [
    'Picked Up',
    'In Design',
    'Rework - Major',
    'Rework - Minor',
    'Waiting Re-QC',
    'Submitted For QC'
  ];

  validStatuses.forEach(status => {
    test(`"${status}" still accepts hours`, () => {
      const ss = getMockSpreadsheet();
      ss.getSheetByName('MASTER_JOB_DATABASE')._data[1][9] = status;

      onDailyLogSubmit({});

      const messages = global.logExceptionV2.mock.calls
        .map(call => String(call[3] || '').toUpperCase());

      expect(messages.some(msg => msg.includes('INVALID STATUS'))).toBe(false);
    });
  });

});


// ─────────────────────────────────────────────────────────────
// INVALID STATUSES STILL GET REJECTED
// ─────────────────────────────────────────────────────────────

describe('onDailyLogSubmit() — invalid statuses still rejected', () => {

  const invalidStatuses = [
    'Completed - Billable',
    'Billed',
    'QC In Progress',
    'Allocated'
  ];

  invalidStatuses.forEach(status => {
    test(`"${status}" still rejects hours`, () => {
      const ss = getMockSpreadsheet();
      ss.getSheetByName('MASTER_JOB_DATABASE')._data[1][9] = status;

      onDailyLogSubmit({});

      const messages = global.logExceptionV2.mock.calls
        .map(call => String(call[3] || '').toUpperCase());

      expect(messages.some(msg => msg.includes('INVALID STATUS'))).toBe(true);
    });
  });

});


// ─────────────────────────────────────────────────────────────
// REWORK HOURS GO TO THE RIGHT BUCKET
// ─────────────────────────────────────────────────────────────

describe('onDailyLogSubmit() — rework hours routing', () => {

  test('Rework - Major hours go to reworkHoursMajor, not designHoursTotal', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('MASTER_JOB_DATABASE')._data[1][9] = 'Rework - Major';

    onDailyLogSubmit({});

    const master      = ss.getSheetByName('MASTER_JOB_DATABASE');
    const reworkMajor = master._data[1][13]; // col 14 (index 13) = reworkHoursMajor
    const designHours = master._data[1][10]; // col 11 (index 10) = designHoursTotal

    expect(reworkMajor).toBe(4);
    expect(designHours).toBe(0); // design hours should NOT increase
  });

  test('Rework - Minor hours go to reworkHoursMinor', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('MASTER_JOB_DATABASE')._data[1][9] = 'Rework - Minor';

    onDailyLogSubmit({});

    const master      = ss.getSheetByName('MASTER_JOB_DATABASE');
    const reworkMinor = master._data[1][14]; // col 15 (index 14) = reworkHoursMinor
    expect(reworkMinor).toBe(4);
  });

  test('Revision hours go to designHoursTotal (not rework)', () => {
    onDailyLogSubmit({});

    const master      = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const designHours = master._data[1][10];
    const reworkMajor = master._data[1][13];
    const reworkMinor = master._data[1][14];

    expect(designHours).toBe(4); // revision = design hours
    expect(reworkMajor).toBe(0);
    expect(reworkMinor).toBe(0);
  });

});
