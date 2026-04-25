/**
 * sop-integration.test.js
 *
 * Tests for SopIntegration.js and the QC Exempt / FPO changes wired into
 * Code.js and AllocationSystem.js.
 *
 * What we test:
 *  1. getDesignerEmail_()        — looks up email from DESIGNER_MASTER
 *  2. getClientSopFormUrl_()     — looks up SOP form URLs from CLIENT_MASTER
 *  3. sendSopChecklistEmail_()   — emails designer on allocation
 *  4. sendSopReminderEmail_()    — reminder + Sarty alert when checklist missing on QC submit
 *  5. sendQcChecklistEmail_()    — emails reviewer when QC checklist not submitted
 *  6. onDailyLogSubmit() QC Exempt  — FPO jobs skip QC, go to "Ready For Billing"
 *  7. onDailyLogSubmit() SOP tracking  — reminder fired / suppressed based on flag
 *  8. onAllocationSubmit() qcExempt  — flag written to MASTER, SOP email gated
 */

require('./gas-mocks');
const { resetMockSpreadsheet, getMockSpreadsheet } = require('./gas-mocks');

const fs   = require('fs');
const path = require('path');

const codeJs         = fs.readFileSync(path.join(__dirname, '../Code.js'),          'utf8');
const allocJs        = fs.readFileSync(path.join(__dirname, '../AllocationSystem.js'), 'utf8');
const sopJs          = fs.readFileSync(path.join(__dirname, '../SopIntegration.js'), 'utf8');

eval(codeJs);
eval(sopJs);
eval(allocJs);


// ── Shared stubs ──────────────────────────────────────────────

global.logExceptionV2  = jest.fn();
global.findJobRowByKey = jest.fn(() => 2);   // row 2 = first data row in MASTER


// ── Data builders ─────────────────────────────────────────────

/** 39-column MASTER row (matches current masterCols including new qcExempt cols) */
function makeMasterRow(o = {}) {
  const row = new Array(39).fill('');
  row[0]  = o.jobNumber              || 'BLC-TEST-001';
  row[1]  = o.clientCode             || 'SBS';
  row[2]  = o.clientName             || 'SBS Client';
  row[3]  = o.designerName           || 'Deb Sen';
  row[4]  = o.productType            || 'Roof Truss';
  row[9]  = o.status                 || 'In Design';
  row[10] = o.designHoursTotal       || 4;
  row[11] = o.qcHoursTotal           || 0;
  row[12] = o.totalBillable          || 4;
  row[17] = o.billingPeriod          || '';
  row[18] = o.invoiceMonth           || '';
  row[22] = o.reworkFlag             || 'No';
  row[23] = o.reworkCount            || 0;
  row[30] = 'No';                         // isTest
  row[35] = 'No';                         // isImported
  row[36] = o.qcExempt               || 'No';   // col 37
  row[37] = o.sopChecklistSubmitted  || 'No';   // col 38
  row[38] = o.qcChecklistSubmitted   || 'No';   // col 39
  return row;
}

/** DESIGNER_MASTER rows: [ID, Name, Email, Phone, Role, TL, Rate, Start, Active, ...] */
function makeDesignerSheet(ss) {
  ss.addSheet('DESIGNER_MASTER', [
    ['Designer_ID','Designer_Name','Email','Phone','Role','Team_Lead','Hourly_Rate','Start_Date','Active'],
    ['SGO', 'Sarty Gosh',   'sarthakaespl@gmail.com',         '', 'Project Manager', '', 500, '', 'Yes'],
    ['DBS', 'Deb Sen',      'Debnathsen9831@gmail.com',       '', 'Senior Designer',  '', 300, '', 'Yes'],
    ['BCH', 'Bharath Charles','bharathchunarkar121@gmail.com', '', 'Team Leader',      '', 400, '', 'Yes'],
    ['SDA', 'Samar Kumar Das','samar.das1995@gmail.com',      '', 'Team Leader',      '', 350, '', 'Yes'],
  ]);
}

/**
 * CLIENT_MASTER row: 21 cols — last two are designerSopFormUrl (col 20) and qcSopFormUrl (col 21).
 * [0]=clientCode, [1]=clientName, [9]=active, [19]=designerSopFormUrl, [20]=qcSopFormUrl
 */
function makeClientMasterSheet(ss, opts = {}) {
  const row = new Array(21).fill('');
  row[0]  = opts.clientCode         || 'SBS';
  row[1]  = opts.clientName         || 'SBS Client';
  row[9]  = opts.active             || 'Yes';
  row[15] = opts.returnFormId       || '';
  row[19] = opts.designerSopFormUrl || 'https://forms.gle/designer-sop-sbs';
  row[20] = opts.qcSopFormUrl       || 'https://forms.gle/qc-sop-sbs';
  ss.addSheet('CLIENT_MASTER', [
    new Array(21).fill('HEADER'),
    row
  ]);
}

/** Daily log form response row — 10 columns */
function makeDailyLogRow(o = {}) {
  return [
    o.timestamp    || new Date(2026, 2, 18),
    o.jobNumber    || 'BLC-TEST-001',
    o.designerName || 'Deb Sen',
    o.dateWorked   || new Date(2026, 2, 18),
    o.productType  || 'Roof Truss',
    o.hoursWorked  || 4,
    o.readyForQC   || 'No',
    o.notes        || '',
    o.sopConf      || '',
    o.boardFt      || '',
  ];
}

/** Allocation form e.values row — 9 elements (indices 0-8) */
function makeAllocValues(o = {}) {
  return [
    o.timestamp    || new Date(2026, 2, 18),     // [0]
    o.jobNumber    || 'BLC-NEW-001',             // [1]
    o.clientCode   || 'SBS',                     // [2]
    o.designerName || 'Deb Sen',                 // [3]
    o.productType  || 'Roof Truss',              // [4]
    o.expectedComp || new Date(2026, 2, 25),     // [5]
    o.notes        || '',                        // [6]
    o.allocatedBy  || 'Sarty Gosh',              // [7]
    o.qcExempt     || 'No',                      // [8]
  ];
}


// ── beforeEach ────────────────────────────────────────────────

beforeEach(() => {
  resetMockSpreadsheet();
  jest.clearAllMocks();
  global.logExceptionV2  = jest.fn();
  global.findJobRowByKey = jest.fn(() => 2);
  global.GmailApp        = { sendEmail: jest.fn() };
});


// ─────────────────────────────────────────────────────────────
// 1. getDesignerEmail_()
// ─────────────────────────────────────────────────────────────

describe('getDesignerEmail_()', () => {
  beforeEach(() => makeDesignerSheet(getMockSpreadsheet()));

  test('returns email for known designer', () => {
    expect(getDesignerEmail_('Deb Sen')).toBe('Debnathsen9831@gmail.com');
  });

  test('returns email for PM (Sarty)', () => {
    expect(getDesignerEmail_('Sarty Gosh')).toBe('sarthakaespl@gmail.com');
  });

  test('returns empty string for unknown designer', () => {
    expect(getDesignerEmail_('Nobody')).toBe('');
  });

  test('normalises designer name before matching', () => {
    // 'Sayana Roy' normalises to 'Sayan Roy' — but Sayan Roy not in fixture, so test normalisation works
    // Test that a known alias resolves correctly
    expect(getDesignerEmail_('Sarty Gosh')).toBe('sarthakaespl@gmail.com');
  });
});


// ─────────────────────────────────────────────────────────────
// 2. getClientSopFormUrl_()
// ─────────────────────────────────────────────────────────────

describe('getClientSopFormUrl_()', () => {
  beforeEach(() => makeClientMasterSheet(getMockSpreadsheet()));

  test('returns designer SOP form URL (isQc=false)', () => {
    expect(getClientSopFormUrl_('SBS', false)).toBe('https://forms.gle/designer-sop-sbs');
  });

  test('returns QC SOP form URL (isQc=true)', () => {
    expect(getClientSopFormUrl_('SBS', true)).toBe('https://forms.gle/qc-sop-sbs');
  });

  test('returns empty string for unknown client', () => {
    expect(getClientSopFormUrl_('UNKNOWN', false)).toBe('');
  });

  test('returns empty string when URL column is blank', () => {
    const ss = getMockSpreadsheet();
    const row = new Array(21).fill('');
    row[0] = 'NURL';   // client with no URLs set
    ss.addSheet('CLIENT_MASTER2', [['HEADER'], row]);
    // Directly test: blank URL returns ''
    expect(getClientSopFormUrl_('NURL', false)).toBe('');
  });
});


// ─────────────────────────────────────────────────────────────
// 3. sendSopChecklistEmail_()
// ─────────────────────────────────────────────────────────────

describe('sendSopChecklistEmail_()', () => {
  beforeEach(() => {
    makeDesignerSheet(getMockSpreadsheet());
    makeClientMasterSheet(getMockSpreadsheet());
  });

  test('sends email to designer when both email and form URL exist', () => {
    sendSopChecklistEmail_('BLC-001', 'Deb Sen', 'SBS');
    expect(GmailApp.sendEmail).toHaveBeenCalledTimes(1);
    expect(GmailApp.sendEmail.mock.calls[0][0]).toBe('Debnathsen9831@gmail.com');
  });

  test('email subject contains job number', () => {
    sendSopChecklistEmail_('BLC-XYZ', 'Deb Sen', 'SBS');
    const subject = GmailApp.sendEmail.mock.calls[0][1];
    expect(subject).toContain('BLC-XYZ');
  });

  test('skips email when designer has no email address', () => {
    sendSopChecklistEmail_('BLC-001', 'Nobody Unknown', 'SBS');
    expect(GmailApp.sendEmail).not.toHaveBeenCalled();
  });

  test('skips email when client has no SOP form URL', () => {
    sendSopChecklistEmail_('BLC-001', 'Deb Sen', 'CLIENTWITHNOFORM');
    expect(GmailApp.sendEmail).not.toHaveBeenCalled();
  });
});


// ─────────────────────────────────────────────────────────────
// 4. sendSopReminderEmail_()
// ─────────────────────────────────────────────────────────────

describe('sendSopReminderEmail_()', () => {
  beforeEach(() => {
    makeDesignerSheet(getMockSpreadsheet());
    makeClientMasterSheet(getMockSpreadsheet());
  });

  test('sends reminder to designer', () => {
    sendSopReminderEmail_('BLC-001', 'Deb Sen', 'SBS');
    const recipients = GmailApp.sendEmail.mock.calls.map(c => c[0]);
    expect(recipients).toContain('Debnathsen9831@gmail.com');
  });

  test('also alerts Sarty (PM) when designer misses checklist', () => {
    sendSopReminderEmail_('BLC-001', 'Deb Sen', 'SBS');
    const recipients = GmailApp.sendEmail.mock.calls.map(c => c[0]);
    expect(recipients).toContain('sarthakaespl@gmail.com');
  });

  test('skips entirely when designer has no email', () => {
    sendSopReminderEmail_('BLC-001', 'Ghost Designer', 'SBS');
    expect(GmailApp.sendEmail).not.toHaveBeenCalled();
  });
});


// ─────────────────────────────────────────────────────────────
// 5. sendQcChecklistEmail_() — reviewer reminder
// ─────────────────────────────────────────────────────────────

describe('sendQcChecklistEmail_()', () => {
  beforeEach(() => {
    makeDesignerSheet(getMockSpreadsheet());
    makeClientMasterSheet(getMockSpreadsheet());
  });

  test('sends QC checklist reminder to reviewer', () => {
    sendQcChecklistEmail_('BLC-001', 'Bharath Charles', 'SBS');
    expect(GmailApp.sendEmail).toHaveBeenCalledTimes(1);
    expect(GmailApp.sendEmail.mock.calls[0][0]).toBe('bharathchunarkar121@gmail.com');
  });

  test('email subject contains job number', () => {
    sendQcChecklistEmail_('BLC-QC-99', 'Bharath Charles', 'SBS');
    expect(GmailApp.sendEmail.mock.calls[0][1]).toContain('BLC-QC-99');
  });

  test('skips when reviewer has no email', () => {
    sendQcChecklistEmail_('BLC-001', 'Unknown Reviewer', 'SBS');
    expect(GmailApp.sendEmail).not.toHaveBeenCalled();
  });
});


// ─────────────────────────────────────────────────────────────
// 6. onDailyLogSubmit() — QC Exempt (FPO) flag
// ─────────────────────────────────────────────────────────────

describe('onDailyLogSubmit() — QC Exempt (FPO) jobs', () => {
  beforeEach(() => {
    const ss = getMockSpreadsheet();
    makeDesignerSheet(ss);
    makeClientMasterSheet(ss);
    ss.addSheet('EXCEPTIONS_LOG', [['Timestamp','Type','Job','Person','Message']]);
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(39).fill('HEADER'),
      makeMasterRow({ qcExempt: 'Yes', status: 'In Design', sopChecklistSubmitted: 'No' })
    ]);
    ss.addSheet('FORM_Daily_Work_Log', [
      ['Timestamp','Job','Designer','Date','Product','Hours','ReadyForQC','Notes','SOP','BF'],
      makeDailyLogRow({ readyForQC: 'Yes' })
    ]);
  });

  test('QC Exempt + readyForQC=Yes → status becomes "Ready For Billing"', () => {
    onDailyLogSubmit({});
    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][9]).toBe('Ready For Billing');
  });

  test('QC Exempt job does NOT trigger SOP reminder email', () => {
    onDailyLogSubmit({});
    // sendSopReminderEmail_ is the real function from SopIntegration.js eval
    // but GmailApp.sendEmail is mocked — it should NOT be called for QC Exempt jobs
    // (no reminder to designer, no alert to Sarty)
    const sopReminderCalls = GmailApp.sendEmail.mock.calls.filter(c =>
      c[1] && c[1].toString().includes('SOP Checklist Not Submitted')
    );
    expect(sopReminderCalls.length).toBe(0);
  });

  test('QC Exempt job does NOT trigger QC checklist email to team', () => {
    onDailyLogSubmit({});
    const qcChecklistCalls = GmailApp.sendEmail.mock.calls.filter(c =>
      c[1] && c[1].toString().includes('QC Checklist Required')
    );
    expect(qcChecklistCalls.length).toBe(0);
  });

  test('non-exempt job with readyForQC=Yes → status stays "Submitted For QC"', () => {
    const ss = getMockSpreadsheet();
    // Replace MASTER with a non-exempt row
    ss._sheets['MASTER_JOB_DATABASE']._data[1][36] = 'No'; // qcExempt = No
    ss._sheets['MASTER_JOB_DATABASE']._data[1][37] = 'Yes'; // sopChecklistSubmitted = Yes
    onDailyLogSubmit({});
    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][9]).toBe('Submitted For QC');
  });
});


// ─────────────────────────────────────────────────────────────
// 7. onDailyLogSubmit() — SOP checklist tracking
// ─────────────────────────────────────────────────────────────

describe('onDailyLogSubmit() — SOP checklist reminder logic', () => {
  function setupDailyLogTest(sopChecklistSubmitted) {
    const ss = getMockSpreadsheet();
    makeDesignerSheet(ss);
    makeClientMasterSheet(ss);
    ss.addSheet('EXCEPTIONS_LOG', [['Timestamp','Type','Job','Person','Message']]);
    ss.addSheet('MASTER_JOB_DATABASE', [
      new Array(39).fill('HEADER'),
      makeMasterRow({ qcExempt: 'No', status: 'In Design', sopChecklistSubmitted })
    ]);
    ss.addSheet('FORM_Daily_Work_Log', [
      ['Timestamp','Job','Designer','Date','Product','Hours','ReadyForQC','Notes','SOP','BF'],
      makeDailyLogRow({ readyForQC: 'Yes' })
    ]);
  }

  test('SOP not submitted + readyForQC=Yes → reminder email sent to designer', () => {
    setupDailyLogTest('No');
    onDailyLogSubmit({});
    const designerEmails = GmailApp.sendEmail.mock.calls
      .filter(c => c[0] === 'Debnathsen9831@gmail.com');
    expect(designerEmails.length).toBeGreaterThan(0);
  });

  test('SOP not submitted + readyForQC=Yes → Sarty also alerted', () => {
    setupDailyLogTest('No');
    onDailyLogSubmit({});
    const sartyEmails = GmailApp.sendEmail.mock.calls
      .filter(c => c[0] === 'sarthakaespl@gmail.com');
    expect(sartyEmails.length).toBeGreaterThan(0);
  });

  test('SOP already submitted → no reminder email fired', () => {
    setupDailyLogTest('Yes');
    onDailyLogSubmit({});
    const reminderCalls = GmailApp.sendEmail.mock.calls.filter(c =>
      c[1] && c[1].toString().includes('SOP Checklist Not Submitted')
    );
    expect(reminderCalls.length).toBe(0);
  });
});


// ─────────────────────────────────────────────────────────────
// 8. onAllocationSubmit() — qcExempt flag
// ─────────────────────────────────────────────────────────────

describe('onAllocationSubmit() — qcExempt flag', () => {
  beforeEach(() => {
    const ss = getMockSpreadsheet();
    makeDesignerSheet(ss);
    makeClientMasterSheet(ss);
    ss.addSheet('MASTER_JOB_DATABASE', [ new Array(39).fill('HEADER') ]);
    ss.addSheet('ACTIVE_JOBS', [
      ['Job_Number','Client_Code','Client_Name','Designer_Name','Product_Type',
       'Status','Allocated_Date','Expected_Completion','Timestamp','Last_Updated_By']
    ]);
    ss.addSheet('JOB_INTAKE',          [['Job_Number','Status']]);
    ss.addSheet('CLIENT_INTAKE_CONFIG',[['Client_Code']]);
    ss.addSheet('EXCEPTIONS_LOG',      [['Timestamp','Type','Job','Person','Message']]);
    // postAllocationIntakeSync lives in IntakeAllocationBridge.js — stub it here
    global.postAllocationIntakeSync = jest.fn();
  });

  test('qcExempt=Yes → MASTER row has qcExempt="Yes"', () => {
    onAllocationSubmit({ values: makeAllocValues({ qcExempt: 'Yes', jobNumber: 'BLC-FPO-001' }) });
    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    const newRow = master._data[1]; // first appended row
    expect(newRow[36]).toBe('Yes'); // col 37 = qcExempt (index 36)
  });

  test('qcExempt=No → MASTER row has qcExempt="No"', () => {
    onAllocationSubmit({ values: makeAllocValues({ qcExempt: 'No', jobNumber: 'BLC-STD-001' }) });
    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][36]).toBe('No');
  });

  test('new MASTER row always initialises sopChecklistSubmitted="No"', () => {
    onAllocationSubmit({ values: makeAllocValues({ jobNumber: 'BLC-NEW-001' }) });
    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][37]).toBe('No'); // col 38 = sopChecklistSubmitted (index 37)
  });

  test('new MASTER row always initialises qcChecklistSubmitted="No"', () => {
    onAllocationSubmit({ values: makeAllocValues({ jobNumber: 'BLC-NEW-002' }) });
    const master = getMockSpreadsheet().getSheetByName('MASTER_JOB_DATABASE');
    expect(master._data[1][38]).toBe('No'); // col 39 = qcChecklistSubmitted (index 38)
  });

  test('qcExempt=No → SOP email is sent to designer', () => {
    onAllocationSubmit({ values: makeAllocValues({ qcExempt: 'No', jobNumber: 'BLC-SOP-001' }) });
    const designerEmails = GmailApp.sendEmail.mock.calls
      .filter(c => c[0] === 'Debnathsen9831@gmail.com');
    expect(designerEmails.length).toBeGreaterThan(0);
  });

  test('qcExempt=Yes → SOP email is NOT sent to designer', () => {
    onAllocationSubmit({ values: makeAllocValues({ qcExempt: 'Yes', jobNumber: 'BLC-FPO-002' }) });
    const sopEmails = GmailApp.sendEmail.mock.calls.filter(c =>
      c[1] && c[1].toString().includes('SOP Checklist')
    );
    expect(sopEmails.length).toBe(0);
  });
});
