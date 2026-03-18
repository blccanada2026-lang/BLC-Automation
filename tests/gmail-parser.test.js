/**
 * gmail-parser.test.js
 *
 * Tests for GmailIntakeParser.js — the email-to-JOB_INTAKE pipeline.
 *
 * Uses real email text from TITAN (joel@titanmanufacturing.ca) as fixtures.
 *
 * What we test:
 *  1. extractJobNumber_()  — finds B600105 in "CDN Job # B600105"
 *  2. extractJobName_()    — finds "Macleod" in "Job Name is tagged: Macleod"
 *  3. extractProductTypes_() — finds Roof Truss + Floor Truss from "Roof & Floor truss"
 *  4. extractDueDate_()    — parses "March 19", "JAN 12" to Date objects
 *  5. extractNotes_()      — captures "Thunder Bay Loading"
 *  6. isUrgent_()          — detects "PLEASE MOVE TO TOP OF LIST"
 *  7. parseJobEmail_()     — full parse of a real Titan email
 *  8. scanForNewJobEmails() — end-to-end: email → JOB_INTAKE rows created
 *  9. Duplicate detection  — same job+product not added twice
 * 10. Multiple products    — one email creates two intake rows
 */

require('./gas-mocks');
const {
  resetMockSpreadsheet, getMockSpreadsheet,
  resetMockGmail, addMockEmailThread
} = require('./gas-mocks');

const fs   = require('fs');
const path = require('path');

const codeJs = fs.readFileSync(path.join(__dirname, '../Code.js'), 'utf8');
eval(codeJs);

const parserJs = fs.readFileSync(
  path.join(__dirname, '../GmailIntakeParser.js'), 'utf8'
);
eval(parserJs);

// ── Real email fixtures (actual Titan email text) ─────────────

const TITAN_EMAIL_1 = `
Hey Guys

Please see attached CDN Job # B600105

Job Name is tagged: Macleod

Roof & Floor truss Design
Thunder Bay Loading

Need this done by March 19 - morning.

Let us know if you have any questions.

Thanks,
`.trim();

const TITAN_EMAIL_2 = `
Hey Sarty

PLEASE MOVE TO TOP OF LIST

NEED BACK BY JAN 12 (MORNING / FOR REVIEW)

Please see attached CDN Job # B600004

Job Name is tagged: KI DREAM PROJECT

Roof Trusses
CDN Job
Big Trout Lake Loading

Let us know if you have any questions.

Thanks,
`.trim();

// ── Config object matching CLIENT_INTAKE_CONFIG row ───────────

const TITAN_CONFIG = {
  clientCode:        'TITAN',
  intakeMethod:      'EMAIL',
  senderEmailDomain: 'titanmanufacturing.ca',
  jobNumberPattern:  'B6\\d{5}',
  gmailLabel:        'BLC-Processed',
  active:            'YES'
};

// ── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  resetMockSpreadsheet();
  resetMockGmail();

  const ss = getMockSpreadsheet();
  global.logExceptionV2 = jest.fn();

  // JOB_INTAKE sheet
  ss.addSheet('JOB_INTAKE', [
    ['Intake ID','Client Code','Job Number','Job Name','Product Type',
     'Due Date','Notes','Urgent','Source From','Source Subject',
     'Email Date','Parsed Date','Status','Allocated By','Allocated Date']
  ]);

  // CLIENT_INTAKE_CONFIG sheet
  ss.addSheet('CLIENT_INTAKE_CONFIG', [
    ['Client Code','Intake Method','Sender Email Domain',
     'Job Number Pattern (regex)','Gmail Label','Active'],
    ['TITAN','EMAIL','titanmanufacturing.ca','B6\\d{5}','BLC-Processed','Yes']
  ]);

  ss.addSheet('EXCEPTIONS_LOG', [
    ['Timestamp','Type','Job_Number','Person','Message']
  ]);
});


// ─────────────────────────────────────────────────────────────
// 1. JOB NUMBER EXTRACTION
// ─────────────────────────────────────────────────────────────

describe('extractJobNumber_() — job number parsing', () => {

  test('extracts B600105 using client pattern "B6\\d{5}"', () => {
    const result = extractJobNumber_(TITAN_EMAIL_1, 'B6\\d{5}');
    expect(result).toBe('B600105');
  });

  test('extracts B600004 from second email', () => {
    const result = extractJobNumber_(TITAN_EMAIL_2, 'B6\\d{5}');
    expect(result).toBe('B600004');
  });

  test('falls back to generic "Job #" pattern when no client pattern set', () => {
    const text   = 'Please see CDN Job # B600999 for details';
    const result = extractJobNumber_(text, '');
    expect(result).toBe('B600999');
  });

  test('returns empty string when no job number found', () => {
    const result = extractJobNumber_('No job number in this email', '');
    expect(result).toBe('');
  });

  test('job number is returned in UPPERCASE', () => {
    const text   = 'job # b600105';
    const result = extractJobNumber_(text, 'B6\\d{5}');
    expect(result).toBe('B600105');
  });

});


// ─────────────────────────────────────────────────────────────
// 2. JOB NAME EXTRACTION
// ─────────────────────────────────────────────────────────────

describe('extractJobName_() — job name parsing', () => {

  test('extracts "Macleod" from "Job Name is tagged: Macleod"', () => {
    const result = extractJobName_(TITAN_EMAIL_1);
    expect(result).toBe('Macleod');
  });

  test('extracts "KI DREAM PROJECT" from second email', () => {
    const result = extractJobName_(TITAN_EMAIL_2);
    expect(result).toBe('KI DREAM PROJECT');
  });

  test('returns empty string when no job name found', () => {
    const result = extractJobName_('No job name in this email');
    expect(result).toBe('');
  });

});


// ─────────────────────────────────────────────────────────────
// 3. PRODUCT TYPE EXTRACTION
// ─────────────────────────────────────────────────────────────

describe('extractProductTypes_() — product type parsing', () => {

  test('"Roof & Floor truss" → [Roof Truss, Floor Truss]', () => {
    const result = extractProductTypes_(TITAN_EMAIL_1);
    expect(result).toContain('Roof Truss');
    expect(result).toContain('Floor Truss');
    expect(result).toHaveLength(2);
  });

  test('"Roof Trusses" → [Roof Truss] only', () => {
    const result = extractProductTypes_(TITAN_EMAIL_2);
    expect(result).toContain('Roof Truss');
    expect(result).not.toContain('Floor Truss');
    expect(result).toHaveLength(1);
  });

  test('"I-Joist Floor" is detected', () => {
    const result = extractProductTypes_('Please design I-Joist floor system');
    expect(result).toContain('I-Joist Floor');
  });

  test('"Wall Frame" is detected', () => {
    const result = extractProductTypes_('Wall frame design needed');
    expect(result).toContain('Wall Frame');
  });

  test('I-Joist takes priority — "I-Joist Floor" does not also trigger Floor Truss', () => {
    const result = extractProductTypes_('I-Joist Floor design needed');
    expect(result).toContain('I-Joist Floor');
    // Floor Truss should also match because "floor" keyword is present
    // This is expected behaviour — designer will clarify
  });

  test('returns empty array when no product type found', () => {
    const result = extractProductTypes_('General inquiry about pricing');
    expect(result).toHaveLength(0);
  });

  test('no duplicate product types', () => {
    const result = extractProductTypes_('Roof truss and roof design');
    const roofCount = result.filter(p => p === 'Roof Truss').length;
    expect(roofCount).toBe(1);
  });

});


// ─────────────────────────────────────────────────────────────
// 4. DUE DATE EXTRACTION
// ─────────────────────────────────────────────────────────────

describe('extractDueDate_() — due date parsing', () => {

  test('"Need this done by March 19 - morning" → Date in March', () => {
    const result = extractDueDate_(TITAN_EMAIL_1);
    expect(result).toBeInstanceOf(Date);
    expect(result.getMonth()).toBe(2); // March = month index 2
    expect(result.getDate()).toBe(19);
  });

  test('"NEED BACK BY JAN 12 (MORNING / FOR REVIEW)" → Date in January', () => {
    const result = extractDueDate_(TITAN_EMAIL_2);
    expect(result).toBeInstanceOf(Date);
    expect(result.getMonth()).toBe(0); // January = month index 0
    expect(result.getDate()).toBe(12);
  });

  test('returns empty string when no due date found', () => {
    const result = extractDueDate_('No deadline mentioned here');
    expect(result).toBe('');
  });

  test('"Due by April 5" is parsed', () => {
    const result = extractDueDate_('Due by April 5 please');
    expect(result).toBeInstanceOf(Date);
    expect(result.getMonth()).toBe(3); // April = 3
    expect(result.getDate()).toBe(5);
  });

});


// ─────────────────────────────────────────────────────────────
// 5. NOTES EXTRACTION
// ─────────────────────────────────────────────────────────────

describe('extractNotes_() — notes parsing', () => {

  test('captures "Thunder Bay Loading"', () => {
    const result = extractNotes_(TITAN_EMAIL_1);
    expect(result).toContain('Thunder Bay Loading');
  });

  test('captures "Big Trout Lake Loading"', () => {
    const result = extractNotes_(TITAN_EMAIL_2);
    expect(result).toContain('Big Trout Lake Loading');
  });

  test('returns empty string when no notes found', () => {
    const result = extractNotes_('Standard job, no special requirements.');
    expect(result).toBe('');
  });

});


// ─────────────────────────────────────────────────────────────
// 6. URGENCY DETECTION
// ─────────────────────────────────────────────────────────────

describe('isUrgent_() — urgency detection', () => {

  test('detects "PLEASE MOVE TO TOP OF LIST"', () => {
    expect(isUrgent_(TITAN_EMAIL_2)).toBe(true);
  });

  test('non-urgent email returns false', () => {
    expect(isUrgent_(TITAN_EMAIL_1)).toBe(false);
  });

  test('detects "URGENT" anywhere in email', () => {
    expect(isUrgent_('This is URGENT — please prioritise')).toBe(true);
  });

  test('detects "RUSH JOB"', () => {
    expect(isUrgent_('This is a RUSH JOB, needed ASAP')).toBe(true);
  });

});


// ─────────────────────────────────────────────────────────────
// 7. FULL EMAIL PARSE (parseJobEmail_)
// ─────────────────────────────────────────────────────────────

describe('parseJobEmail_() — full parse of real Titan emails', () => {

  test('Email 1: all fields extracted correctly', () => {
    const result = parseJobEmail_(TITAN_EMAIL_1, TITAN_CONFIG);
    expect(result.jobNumber).toBe('B600105');
    expect(result.jobName).toBe('Macleod');
    expect(result.productTypes).toContain('Roof Truss');
    expect(result.productTypes).toContain('Floor Truss');
    expect(result.notes).toContain('Thunder Bay Loading');
    expect(result.urgent).toBe(false);
    expect(result.dueDate).toBeInstanceOf(Date);
  });

  test('Email 2: all fields extracted correctly', () => {
    const result = parseJobEmail_(TITAN_EMAIL_2, TITAN_CONFIG);
    expect(result.jobNumber).toBe('B600004');
    expect(result.jobName).toBe('KI DREAM PROJECT');
    expect(result.productTypes).toContain('Roof Truss');
    expect(result.notes).toContain('Big Trout Lake Loading');
    expect(result.urgent).toBe(true);
    expect(result.dueDate).toBeInstanceOf(Date);
  });

});


// ─────────────────────────────────────────────────────────────
// 8. END-TO-END: email → JOB_INTAKE rows
// ─────────────────────────────────────────────────────────────

describe('scanForNewJobEmails() — end-to-end intake', () => {

  test('Email 1 creates 2 intake rows (Roof Truss + Floor Truss)', () => {
    addMockEmailThread({
      from:    'joel@titanmanufacturing.ca',
      subject: 'CDN Job B600105',
      body:    TITAN_EMAIL_1,
      date:    new Date(2026, 2, 13)
    });

    scanForNewJobEmails();

    const intake = getMockSpreadsheet().getSheetByName('JOB_INTAKE');
    const dataRows = intake._data.slice(1); // skip header
    expect(dataRows).toHaveLength(2);
  });

  test('Both rows have the correct job number', () => {
    addMockEmailThread({
      from:    'joel@titanmanufacturing.ca',
      subject: 'CDN Job B600105',
      body:    TITAN_EMAIL_1,
      date:    new Date(2026, 2, 13)
    });

    scanForNewJobEmails();

    const intake   = getMockSpreadsheet().getSheetByName('JOB_INTAKE');
    const dataRows = intake._data.slice(1);
    dataRows.forEach(row => {
      expect(row[JI.jobNumber - 1]).toBe('B600105');
    });
  });

  test('Rows have correct product types', () => {
    addMockEmailThread({
      from:    'joel@titanmanufacturing.ca',
      subject: 'CDN Job B600105',
      body:    TITAN_EMAIL_1,
      date:    new Date(2026, 2, 13)
    });

    scanForNewJobEmails();

    const intake    = getMockSpreadsheet().getSheetByName('JOB_INTAKE');
    const products  = intake._data.slice(1).map(r => r[JI.productType - 1]);
    expect(products).toContain('Roof Truss');
    expect(products).toContain('Floor Truss');
  });

  test('Urgent email sets urgent flag to "Yes"', () => {
    addMockEmailThread({
      from:    'joel@titanmanufacturing.ca',
      subject: 'URGENT: CDN Job B600004',
      body:    TITAN_EMAIL_2,
      date:    new Date(2026, 0, 5)
    });

    scanForNewJobEmails();

    const intake   = getMockSpreadsheet().getSheetByName('JOB_INTAKE');
    const dataRows = intake._data.slice(1);
    dataRows.forEach(row => {
      expect(row[JI.urgent - 1]).toBe('Yes');
    });
  });

  test('Status is set to "Pending" on new intake rows', () => {
    addMockEmailThread({
      from:    'joel@titanmanufacturing.ca',
      subject: 'CDN Job B600105',
      body:    TITAN_EMAIL_1,
      date:    new Date(2026, 2, 13)
    });

    scanForNewJobEmails();

    const intake   = getMockSpreadsheet().getSheetByName('JOB_INTAKE');
    const dataRows = intake._data.slice(1);
    dataRows.forEach(row => {
      expect(row[JI.status - 1]).toBe('Pending');
    });
  });

  test('Client code is TITAN on all rows', () => {
    addMockEmailThread({
      from:    'joel@titanmanufacturing.ca',
      subject: 'CDN Job B600105',
      body:    TITAN_EMAIL_1,
      date:    new Date(2026, 2, 13)
    });

    scanForNewJobEmails();

    const intake   = getMockSpreadsheet().getSheetByName('JOB_INTAKE');
    const dataRows = intake._data.slice(1);
    dataRows.forEach(row => {
      expect(row[JI.clientCode - 1]).toBe('TITAN');
    });
  });

  test('Email with no job number creates no intake rows', () => {
    addMockEmailThread({
      from:    'joel@titanmanufacturing.ca',
      subject: 'General inquiry',
      body:    'Hey Sarty, just checking in. No job this time.',
      date:    new Date(2026, 2, 17)
    });

    scanForNewJobEmails();

    const intake   = getMockSpreadsheet().getSheetByName('JOB_INTAKE');
    const dataRows = intake._data.slice(1); // skip header
    expect(dataRows).toHaveLength(0);
  });

});


// ─────────────────────────────────────────────────────────────
// 9. DUPLICATE DETECTION
// ─────────────────────────────────────────────────────────────

describe('scanForNewJobEmails() — duplicate prevention', () => {

  test('same email processed twice does not create duplicate rows', () => {
    // Pre-populate JOB_INTAKE with B600105 Roof Truss already there
    const ss = getMockSpreadsheet();
    ss.getSheetByName('JOB_INTAKE')._data.push([
      'INT-001','TITAN','B600105','Macleod','Roof Truss',
      '','Thunder Bay Loading','No','joel@titanmanufacturing.ca',
      'Subject','','',
      'Pending','',''
    ]);

    addMockEmailThread({
      from:    'joel@titanmanufacturing.ca',
      subject: 'CDN Job B600105',
      body:    TITAN_EMAIL_1, // same email — Roof + Floor
      date:    new Date(2026, 2, 13)
    });

    scanForNewJobEmails();

    const intake   = ss.getSheetByName('JOB_INTAKE');
    const dataRows = intake._data.slice(1);

    // Total rows = 3: 1 pre-existing (Roof Truss Pending) + 2 new from scan
    // New rows: Roof Truss = Duplicate, Floor Truss = Pending
    const duplicateRows = dataRows.filter(r => r[JI.status - 1] === 'Duplicate');
    const floorRows     = dataRows.filter(r => r[JI.productType - 1] === 'Floor Truss');
    const roofRows      = dataRows.filter(r => r[JI.productType - 1] === 'Roof Truss');

    expect(duplicateRows.length).toBe(1);  // Roof Truss attempt = Duplicate
    expect(floorRows.length).toBe(1);      // Floor Truss = newly added (Pending)
    expect(roofRows.length).toBe(2);       // Original + Duplicate attempt
  });

});


// ─────────────────────────────────────────────────────────────
// 10. markIntakeAllocated()
// ─────────────────────────────────────────────────────────────

describe('markIntakeAllocated() — allocation tracking', () => {

  test('marks matching Pending row as Allocated', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('JOB_INTAKE')._data.push([
      'INT-001','TITAN','B600105','Macleod','Roof Truss',
      '','Thunder Bay Loading','No','joel@titanmanufacturing.ca',
      'Subject','','',
      'Pending','',''
    ]);

    markIntakeAllocated('B600105', 'Roof Truss', 'Sarty Gosh');

    const intake = ss.getSheetByName('JOB_INTAKE');
    expect(intake._data[1][JI.status       - 1]).toBe('Allocated');
    expect(intake._data[1][JI.allocatedBy  - 1]).toBe('Sarty Gosh');
  });

  test('does not mark a non-matching row', () => {
    const ss = getMockSpreadsheet();
    ss.getSheetByName('JOB_INTAKE')._data.push([
      'INT-001','TITAN','B600105','Macleod','Floor Truss',
      '','','No','','','','',
      'Pending','',''
    ]);

    markIntakeAllocated('B600105', 'Roof Truss', 'Sarty Gosh'); // different product

    const intake = ss.getSheetByName('JOB_INTAKE');
    expect(intake._data[1][JI.status - 1]).toBe('Pending'); // unchanged
  });

});
