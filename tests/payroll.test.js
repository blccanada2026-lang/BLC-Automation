/**
 * payroll.test.js
 *
 * Tests for PayrollEngine.js — the BLC monthly payroll system.
 *
 * What we test:
 *  1. buildDesignerProfileMap_()     — reads STAFF_ROSTER correctly
 *  2. getMasterHoursForPeriod_()     — aggregates hours from MASTER
 *  3. calculateSupervisorBonuses_()  — ₹25/hr chain walk, QC Reviewer exclusion
 *  4. runMonthlyPayroll()            — full integration: hours × rate + bonus
 *  5. Edge cases                     — rework excluded, inactive designers,
 *                                      expired roster rows, zero hours
 */

require('./gas-mocks');
const { resetMockSpreadsheet, getMockSpreadsheet } = require('./gas-mocks');

const fs   = require('fs');
const path = require('path');

// Load Code.js first — provides CONFIG, normaliseDesignerName, getSheet, getSheetData
const codeJs = fs.readFileSync(path.join(__dirname, '../Code.js'), 'utf8');
eval(codeJs);

// Load PayrollEngine.js — provides all payroll functions
const payrollJs = fs.readFileSync(path.join(__dirname, '../PayrollEngine.js'), 'utf8');
eval(payrollJs);


// ── Shared stubs ──────────────────────────────────────────────

// logException (Code.js) calls logExceptionV2 (ExceptionLogArchiverV2.js) — stub both
global.logExceptionV2 = jest.fn();
global.logException   = jest.fn();
global.GmailApp       = { sendEmail: jest.fn() };


// ── Data builders ─────────────────────────────────────────────

/**
 * Build a STAFF_ROSTER row (18 cols, 0-based).
 * Row 0 of the sheet = title, Row 1 = headers, Row 2+ = these rows.
 */
function makeRosterRow(o = {}) {
  const row = new Array(18).fill('');
  row[0]  = o.recordId    || 'SR-TEST';
  row[1]  = o.designerId  || 'TST';
  row[2]  = o.name        || 'Test Designer';
  row[3]  = o.role        || 'Designer';
  row[4]  = o.clientCode  || 'SBS';
  row[5]  = o.supId       || '';
  row[6]  = o.supName     || '';
  row[7]  = o.payDesign   || 'Yes';
  row[8]  = o.payQC       || 'No';
  row[9]  = o.bonusElig   || 'No';
  row[10] = o.rate        !== undefined ? o.rate : 300;
  row[11] = o.effFrom     || '2026-01-01';
  row[12] = o.effTo       || '';          // blank = still active
  row[13] = o.status      || 'ACTIVE';
  return row;
}

/**
 * Build a MASTER_JOB_DATABASE row (36 cols, 0-based indices).
 * Matches CONFIG.masterCols (1-based) → index = col - 1.
 */
function makeMasterRow(o = {}) {
  const row = new Array(36).fill('');
  row[0]  = o.jobNumber     || 'JOB-001';   // col 1
  row[3]  = o.designerName  || 'Test Designer'; // col 4
  row[10] = o.designHours   !== undefined ? o.designHours : 0;  // col 11
  row[11] = o.qcHours       !== undefined ? o.qcHours     : 0;  // col 12
  row[13] = o.reworkMajor   !== undefined ? o.reworkMajor : 0;  // col 14
  row[14] = o.reworkMinor   !== undefined ? o.reworkMinor : 0;  // col 15
  row[17] = o.billingPeriod || 'March 2026'; // col 18
  row[30] = o.isTest        || 'No';          // col 31
  return row;
}

/** Standard STAFF_ROSTER sheet: title row + header row + data rows */
function makeRosterSheet(rows) {
  return [
    new Array(18).fill(''),   // row 0: title
    new Array(18).fill(''),   // row 1: headers
    ...rows
  ];
}

/** Standard MASTER sheet: header row + data rows */
function makeMasterSheet(rows) {
  const header = new Array(36).fill('');
  header[0] = 'Job_Number';
  return [header, ...rows];
}


// ── Setup ─────────────────────────────────────────────────────

beforeEach(() => {
  resetMockSpreadsheet();
  jest.clearAllMocks();
});


// =============================================================
// 1. buildDesignerProfileMap_()
// =============================================================
describe('buildDesignerProfileMap_()', () => {

  test('returns correct profile for a single active designer', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([
      makeRosterRow({ designerId: 'SDA', name: 'Samar Kumar Das', role: 'Team Leader',
                      supId: 'SGO', supName: 'Sarty Gosh',
                      bonusElig: 'Yes', rate: 350 })
    ]));

    const map = buildDesignerProfileMap_();
    expect(map['Samar Kumar Das']).toBeDefined();
    expect(map['Samar Kumar Das'].designerId).toBe('SDA');
    expect(map['Samar Kumar Das'].role).toBe('Team Leader');
    expect(map['Samar Kumar Das'].rate).toBe(350);
    expect(map['Samar Kumar Das'].bonusEligible).toBe(true);
    expect(map['Samar Kumar Das'].supId).toBe('SGO');
    expect(map['Samar Kumar Das'].supName).toBe('Sarty Gosh');
  });

  test('builds _byId reverse lookup correctly', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([
      makeRosterRow({ designerId: 'SDA', name: 'Samar Kumar Das', role: 'Team Leader',
                      supId: 'SGO', supName: 'Sarty Gosh', bonusElig: 'Yes', rate: 350 })
    ]));

    const map = buildDesignerProfileMap_();
    expect(map._byId['SDA']).toBeDefined();
    expect(map._byId['SDA'].name).toBe('Samar Kumar Das');
    expect(map._byId['SDA'].profile.rate).toBe(350);
  });

  test('deduplicates designer appearing in multiple client rows', () => {
    // Bharath Charles appears for both SBS and NORSPAN-MB
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([
      makeRosterRow({ designerId: 'BCH', name: 'Bharath Charles', role: 'Team Leader',
                      clientCode: 'SBS', supId: 'SGO', rate: 400 }),
      makeRosterRow({ designerId: 'BCH', name: 'Bharath Charles', role: 'Team Leader',
                      clientCode: 'NORSPAN-MB', supId: 'SGO', rate: 400 })
    ]));

    const map = buildDesignerProfileMap_();
    // Should appear only once
    const bcEntries = Object.keys(map).filter(k => k !== '_byId' && map[k].designerId === 'BCH');
    expect(bcEntries).toHaveLength(1);
    expect(map['Bharath Charles'].rate).toBe(400);
  });

  test('skips rows with status != ACTIVE', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([
      makeRosterRow({ designerId: 'TST', name: 'Inactive Designer', status: 'INACTIVE' })
    ]));

    const map = buildDesignerProfileMap_();
    expect(map['Inactive Designer']).toBeUndefined();
  });

  test('skips rows where Effective_To is in the past', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([
      makeRosterRow({ designerId: 'OLD', name: 'Old Designer',
                      effTo: '2025-01-01' })  // expired
    ]));

    const map = buildDesignerProfileMap_();
    expect(map['Old Designer']).toBeUndefined();
  });

  test('keeps rows where Effective_To is blank (still active)', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([
      makeRosterRow({ designerId: 'ACT', name: 'Active Designer', effTo: '' })
    ]));

    const map = buildDesignerProfileMap_();
    expect(map['Active Designer']).toBeDefined();
  });

  test('payQC flag is parsed correctly', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([
      makeRosterRow({ name: 'QC Person', payQC: 'Yes' }),
      makeRosterRow({ designerId: 'D2', name: 'Design Only', payQC: 'No' })
    ]));

    const map = buildDesignerProfileMap_();
    expect(map['QC Person'].payQC).toBe(true);
    expect(map['Design Only'].payQC).toBe(false);
  });

  test('throws if STAFF_ROSTER sheet is missing', () => {
    // Don't add STAFF_ROSTER — should throw
    expect(() => buildDesignerProfileMap_()).toThrow('STAFF_ROSTER sheet not found');
  });

});


// =============================================================
// 2. getMasterHoursForPeriod_()
// =============================================================
describe('getMasterHoursForPeriod_()', () => {

  test('sums design hours for a designer in the billing period', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', makeMasterSheet([
      makeMasterRow({ designerName: 'Sarty Gosh', designHours: 8,
                      billingPeriod: 'March 2026' }),
      makeMasterRow({ jobNumber: 'JOB-002', designerName: 'Sarty Gosh',
                      designHours: 4, billingPeriod: 'March 2026' })
    ]));

    const hours = getMasterHoursForPeriod_('March 2026');
    expect(hours['Sarty Gosh'].designHours).toBe(12);
  });

  test('sums QC hours separately from design hours', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', makeMasterSheet([
      makeMasterRow({ designerName: 'Raj Kumar', designHours: 0,
                      qcHours: 6, billingPeriod: 'March 2026' })
    ]));

    const hours = getMasterHoursForPeriod_('March 2026');
    expect(hours['Raj Kumar'].designHours).toBe(0);
    expect(hours['Raj Kumar'].qcHours).toBe(6);
  });

  test('sums rework hours (major + minor) into reworkHours', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', makeMasterSheet([
      makeMasterRow({ designerName: 'Deb Sen', designHours: 10,
                      reworkMajor: 3, reworkMinor: 1,
                      billingPeriod: 'March 2026' })
    ]));

    const hours = getMasterHoursForPeriod_('March 2026');
    expect(hours['Deb Sen'].reworkHours).toBe(4);
    expect(hours['Deb Sen'].designHours).toBe(10); // design hours unaffected
  });

  test('ignores rows from a different billing period', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', makeMasterSheet([
      makeMasterRow({ designerName: 'Sarty Gosh', designHours: 10,
                      billingPeriod: 'February 2026' }),   // wrong period
      makeMasterRow({ jobNumber: 'JOB-002', designerName: 'Sarty Gosh',
                      designHours: 5, billingPeriod: 'March 2026' })
    ]));

    const hours = getMasterHoursForPeriod_('March 2026');
    expect(hours['Sarty Gosh'].designHours).toBe(5);  // only March row counted
  });

  test('ignores Is_Test = Yes rows', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', makeMasterSheet([
      makeMasterRow({ designerName: 'Test User', designHours: 99,
                      billingPeriod: 'March 2026', isTest: 'Yes' })
    ]));

    const hours = getMasterHoursForPeriod_('March 2026');
    expect(hours['Test User']).toBeUndefined();
  });

  test('returns empty object when no matching rows', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', makeMasterSheet([]));

    const hours = getMasterHoursForPeriod_('March 2026');
    expect(Object.keys(hours)).toHaveLength(0);
  });

  test('aggregates hours across multiple designers independently', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', makeMasterSheet([
      makeMasterRow({ designerName: 'Sarty Gosh',  designHours: 8,  billingPeriod: 'March 2026' }),
      makeMasterRow({ jobNumber: 'JOB-002', designerName: 'Deb Sen', designHours: 12, billingPeriod: 'March 2026' }),
      makeMasterRow({ jobNumber: 'JOB-003', designerName: 'Sarty Gosh', designHours: 4, billingPeriod: 'March 2026' })
    ]));

    const hours = getMasterHoursForPeriod_('March 2026');
    expect(hours['Sarty Gosh'].designHours).toBe(12);
    expect(hours['Deb Sen'].designHours).toBe(12);
  });

  test('normalises designer name variants', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', makeMasterSheet([
      makeMasterRow({ designerName: 'DS-Deb Sen', designHours: 8,
                      billingPeriod: 'March 2026' })
    ]));

    const hours = getMasterHoursForPeriod_('March 2026');
    // 'DS-Deb Sen' should normalise to 'Deb Sen'
    expect(hours['Deb Sen']).toBeDefined();
    expect(hours['Deb Sen'].designHours).toBe(8);
  });

});


// =============================================================
// 3. calculateSupervisorBonuses_()
// =============================================================
describe('calculateSupervisorBonuses_()', () => {

  // Build a minimal 3-level hierarchy:
  //   Sayan Roy (Designer) → Samar Das (TL) → Sarty Gosh (PM)
  function buildHierarchyMap() {
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([
      makeRosterRow({ designerId: 'SGO', name: 'Sarty Gosh',
                      role: 'Project Manager', supId: '', supName: '',
                      bonusElig: 'Yes', rate: 500 }),
      makeRosterRow({ designerId: 'SDA', name: 'Samar Kumar Das',
                      role: 'Team Leader', supId: 'SGO', supName: 'Sarty Gosh',
                      bonusElig: 'Yes', rate: 350 }),
      makeRosterRow({ designerId: 'SYR', name: 'Sayan Roy',
                      role: 'Designer', supId: 'SDA', supName: 'Samar Kumar Das',
                      bonusElig: 'No', rate: 250 })
    ]));
    return buildDesignerProfileMap_();
  }

  test('TL gets ₹25 per paid hour of their direct report designer', () => {
    const map    = buildHierarchyMap();
    const paidH  = { 'Sayan Roy': 10 };
    const bonuses = calculateSupervisorBonuses_(paidH, map);

    expect(bonuses['Samar Kumar Das']).toBeDefined();
    expect(bonuses['Samar Kumar Das'].totalBonusINR).toBe(250);   // 10 × 25
    expect(bonuses['Samar Kumar Das'].totalBonusHours).toBe(10);
  });

  test('PM also gets ₹25 per designer hour (chain walk)', () => {
    const map    = buildHierarchyMap();
    const paidH  = { 'Sayan Roy': 10 };
    const bonuses = calculateSupervisorBonuses_(paidH, map);

    expect(bonuses['Sarty Gosh']).toBeDefined();
    expect(bonuses['Sarty Gosh'].totalBonusINR).toBe(250);   // 10 × 25
  });

  test('TL own hours → only PM gets ₹25 (TL has no supervisor above for bonus)', () => {
    // TL reports to PM directly — PM gets bonus for TL hours
    const map    = buildHierarchyMap();
    const paidH  = { 'Samar Kumar Das': 8 };
    const bonuses = calculateSupervisorBonuses_(paidH, map);

    expect(bonuses['Sarty Gosh']).toBeDefined();
    expect(bonuses['Sarty Gosh'].totalBonusINR).toBe(200);   // 8 × 25
    // TL (Samar Das) himself does NOT get bonus for his own hours
    expect(bonuses['Samar Kumar Das']).toBeUndefined();
  });

  test('QC Reviewer hours generate NO bonus for anyone', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([
      makeRosterRow({ designerId: 'BCH', name: 'Bharath Charles',
                      role: 'Team Leader', supId: 'SGO', supName: 'Sarty Gosh',
                      bonusElig: 'Yes', rate: 400 }),
      makeRosterRow({ designerId: 'SGO', name: 'Sarty Gosh',
                      role: 'Project Manager', supId: '',
                      bonusElig: 'Yes', rate: 500 }),
      makeRosterRow({ designerId: 'RKU', name: 'Raj Kumar',
                      role: 'QC Reviewer', supId: 'BCH', supName: 'Bharath Charles',
                      bonusElig: 'No', rate: 350 })
    ]));
    const map    = buildDesignerProfileMap_();
    const paidH  = { 'Raj Kumar': 20 };
    const bonuses = calculateSupervisorBonuses_(paidH, map);

    expect(Object.keys(bonuses)).toHaveLength(0);   // nobody gets bonus
  });

  test('designer with zero paid hours generates no bonus', () => {
    const map    = buildHierarchyMap();
    const paidH  = { 'Sayan Roy': 0 };
    const bonuses = calculateSupervisorBonuses_(paidH, map);

    expect(Object.keys(bonuses)).toHaveLength(0);
  });

  test('PM with no supervisor above generates no bonus at top', () => {
    // PM (Sarty) has own hours — nobody above, no bonus generated
    const map    = buildHierarchyMap();
    const paidH  = { 'Sarty Gosh': 15 };
    const bonuses = calculateSupervisorBonuses_(paidH, map);

    expect(bonuses['Sarty Gosh']).toBeUndefined();
  });

  test('bonus breakdown tracks which designer generated each bonus', () => {
    const map    = buildHierarchyMap();
    const paidH  = { 'Sayan Roy': 10 };
    const bonuses = calculateSupervisorBonuses_(paidH, map);

    const sdaBonus = bonuses['Samar Kumar Das'];
    expect(sdaBonus.breakdown).toHaveLength(1);
    expect(sdaBonus.breakdown[0].designerName).toBe('Sayan Roy');
    expect(sdaBonus.breakdown[0].hours).toBe(10);
    expect(sdaBonus.breakdown[0].bonusINR).toBe(250);
  });

  test('multiple designers under same TL are accumulated correctly', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([
      makeRosterRow({ designerId: 'SGO', name: 'Sarty Gosh',
                      role: 'Project Manager', supId: '', bonusElig: 'Yes', rate: 500 }),
      makeRosterRow({ designerId: 'SDA', name: 'Samar Kumar Das',
                      role: 'Team Leader', supId: 'SGO', supName: 'Sarty Gosh',
                      bonusElig: 'Yes', rate: 350 }),
      makeRosterRow({ designerId: 'SYR', name: 'Sayan Roy',
                      role: 'Designer', supId: 'SDA', supName: 'Samar Kumar Das',
                      bonusElig: 'No', rate: 250 }),
      makeRosterRow({ designerId: 'BSG', name: 'Banik Sagar',
                      role: 'Designer', supId: 'SDA', supName: 'Samar Kumar Das',
                      bonusElig: 'No', rate: 300 })
    ]));
    const map    = buildDesignerProfileMap_();
    const paidH  = { 'Sayan Roy': 10, 'Banik Sagar': 8 };
    const bonuses = calculateSupervisorBonuses_(paidH, map);

    expect(bonuses['Samar Kumar Das'].totalBonusHours).toBe(18);  // 10 + 8
    expect(bonuses['Samar Kumar Das'].totalBonusINR).toBe(450);   // 18 × 25
    expect(bonuses['Sarty Gosh'].totalBonusHours).toBe(18);       // all flows to PM
  });

});


// =============================================================
// 4. runMonthlyPayroll() — integration
// =============================================================
describe('runMonthlyPayroll() — integration', () => {

  function setupPayrollSheets(rosterRows, masterRows) {
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER',        makeRosterSheet(rosterRows));
    ss.addSheet('MASTER_JOB_DATABASE', makeMasterSheet(masterRows));
    ss.addSheet('DESIGNER_MASTER', [
      ['Designer_ID','Designer_Name','Email','Phone','Role','Team_Lead',
       'Hourly_Rate','Start_Date','Active','Notes','Clients','Active_Names'],
      ['SYR','Sayan Roy','sr@test.com','','Designer','Samar Kumar Das',
       250,'',  'Yes','','SBS','']
    ]);
    ss.addSheet('PAYROLL_RATES_SNAPSHOT', [
      ['Payroll_Month','Designer_Name','Rate_Used_INR','Snapshot_Timestamp']
    ]);
    return ss;
  }

  test('creates PAYROLL_LEDGER and PAYROLL_BONUS_LEDGER sheets if missing', () => {
    const ss = setupPayrollSheets(
      [ makeRosterRow({ designerId: 'SYR', name: 'Sayan Roy', rate: 250 }) ],
      [ makeMasterRow({ designerName: 'Sayan Roy', designHours: 10, billingPeriod: 'March 2026' }) ]
    );

    runMonthlyPayroll('March 2026');

    expect(ss.getSheetByName('PAYROLL_LEDGER')).not.toBeNull();
    expect(ss.getSheetByName('PAYROLL_BONUS_LEDGER')).not.toBeNull();
  });

  test('writes one ledger row per designer', () => {
    const ss = setupPayrollSheets(
      [
        makeRosterRow({ designerId: 'SYR', name: 'Sayan Roy',     rate: 250 }),
        makeRosterRow({ designerId: 'BSG', name: 'Banik Sagar',   rate: 300 })
      ],
      [
        makeMasterRow({ jobNumber: 'J1', designerName: 'Sayan Roy',   designHours: 10, billingPeriod: 'March 2026' }),
        makeMasterRow({ jobNumber: 'J2', designerName: 'Banik Sagar', designHours: 8,  billingPeriod: 'March 2026' })
      ]
    );

    runMonthlyPayroll('March 2026');

    const ledger = ss.getSheetByName('PAYROLL_LEDGER');
    const data   = ledger.getDataRange().getValues();
    // Row 0 = header, rows 1-2 = two designers
    const dataRows = data.slice(1).filter(r => r[PL.month - 1] === 'March 2026');
    expect(dataRows).toHaveLength(2);
  });

  test('base pay = paid hours × rate', () => {
    const ss = setupPayrollSheets(
      [ makeRosterRow({ designerId: 'SYR', name: 'Sayan Roy', rate: 250 }) ],
      [ makeMasterRow({ designerName: 'Sayan Roy', designHours: 10, billingPeriod: 'March 2026' }) ]
    );

    runMonthlyPayroll('March 2026');

    const data = ss.getSheetByName('PAYROLL_LEDGER').getDataRange().getValues();
    const row  = data.find(r => r[PL.designerName - 1] === 'Sayan Roy' &&
                                r[PL.month - 1] === 'March 2026');
    expect(row[PL.rateINR  - 1]).toBe(250);
    expect(row[PL.basePay  - 1]).toBe(2500);   // 10 × 250
  });

  test('rework hours are excluded from paid hours and base pay', () => {
    const ss = setupPayrollSheets(
      [ makeRosterRow({ designerId: 'SYR', name: 'Sayan Roy', rate: 250 }) ],
      [ makeMasterRow({ designerName: 'Sayan Roy', designHours: 10,
                        reworkMajor: 2, reworkMinor: 1,
                        billingPeriod: 'March 2026' }) ]
    );

    runMonthlyPayroll('March 2026');

    const data = ss.getSheetByName('PAYROLL_LEDGER').getDataRange().getValues();
    const row  = data.find(r => r[PL.designerName - 1] === 'Sayan Roy' &&
                                r[PL.month - 1] === 'March 2026');
    expect(row[PL.reworkExcluded - 1]).toBe(3);    // 2 + 1
    expect(row[PL.totalPaidHours - 1]).toBe(10);   // only design hours, rework separate
    expect(row[PL.basePay        - 1]).toBe(2500); // 10 × 250 (rework not deducted from designHours)
  });

  test('QC hours included in pay when Pay_QC = Yes', () => {
    const ss = setupPayrollSheets(
      [ makeRosterRow({ designerId: 'RKU', name: 'Raj Kumar',
                        payQC: 'Yes', rate: 350 }) ],
      [ makeMasterRow({ designerName: 'Raj Kumar', designHours: 0,
                        qcHours: 8, billingPeriod: 'March 2026' }) ]
    );

    runMonthlyPayroll('March 2026');

    const data = ss.getSheetByName('PAYROLL_LEDGER').getDataRange().getValues();
    const row  = data.find(r => r[PL.designerName - 1] === 'Raj Kumar' &&
                                r[PL.month - 1] === 'March 2026');
    expect(row[PL.qcHours       - 1]).toBe(8);
    expect(row[PL.totalPaidHours- 1]).toBe(8);
    expect(row[PL.basePay       - 1]).toBe(2800);  // 8 × 350
  });

  test('QC hours excluded from pay when Pay_QC = No', () => {
    const ss = setupPayrollSheets(
      [ makeRosterRow({ designerId: 'DES', name: 'Test Designer',
                        payQC: 'No', rate: 300 }) ],
      [ makeMasterRow({ designerName: 'Test Designer', designHours: 5,
                        qcHours: 3, billingPeriod: 'March 2026' }) ]
    );

    runMonthlyPayroll('March 2026');

    const data = ss.getSheetByName('PAYROLL_LEDGER').getDataRange().getValues();
    const row  = data.find(r => r[PL.designerName - 1] === 'Test Designer' &&
                                r[PL.month - 1] === 'March 2026');
    expect(row[PL.totalPaidHours - 1]).toBe(5);    // only design hours
    expect(row[PL.basePay        - 1]).toBe(1500); // 5 × 300
  });

  test('supervisor bonus is included in total pay', () => {
    // TL with one designer under them
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([
      makeRosterRow({ designerId: 'TL1', name: 'Team Lead One',
                      role: 'Team Leader', supId: '', supName: '',
                      bonusElig: 'Yes', rate: 350 }),
      makeRosterRow({ designerId: 'D1', name: 'Designer One',
                      role: 'Designer', supId: 'TL1', supName: 'Team Lead One',
                      bonusElig: 'No', rate: 250 })
    ]));
    ss.addSheet('MASTER_JOB_DATABASE', makeMasterSheet([
      makeMasterRow({ jobNumber: 'J1', designerName: 'Team Lead One',
                      designHours: 5,  billingPeriod: 'March 2026' }),
      makeMasterRow({ jobNumber: 'J2', designerName: 'Designer One',
                      designHours: 10, billingPeriod: 'March 2026' })
    ]));
    ss.addSheet('DESIGNER_MASTER', [['x'], ['x']]);
    ss.addSheet('PAYROLL_RATES_SNAPSHOT', [['x']]);

    runMonthlyPayroll('March 2026');

    const data = ss.getSheetByName('PAYROLL_LEDGER').getDataRange().getValues();
    const tlRow = data.find(r => r[PL.designerName - 1] === 'Team Lead One' &&
                                 r[PL.month - 1] === 'March 2026');

    // TL base pay = 5 × 350 = 1750
    // TL bonus    = 10 × 25 = 250 (for Designer One's 10 hours)
    // TL total    = 2000
    expect(tlRow[PL.basePay    - 1]).toBe(1750);
    expect(tlRow[PL.bonusINR   - 1]).toBe(250);
    expect(tlRow[PL.totalPay   - 1]).toBe(2000);
  });

  test('status is set to Draft', () => {
    const ss = setupPayrollSheets(
      [ makeRosterRow({ designerId: 'SYR', name: 'Sayan Roy', rate: 250 }) ],
      [ makeMasterRow({ designerName: 'Sayan Roy', designHours: 10, billingPeriod: 'March 2026' }) ]
    );

    runMonthlyPayroll('March 2026');

    const data = ss.getSheetByName('PAYROLL_LEDGER').getDataRange().getValues();
    const row  = data.find(r => r[PL.designerName - 1] === 'Sayan Roy' &&
                                r[PL.month - 1] === 'March 2026');
    expect(row[PL.status - 1]).toBe('Draft');
  });

  test('snapshot rates written to PAYROLL_RATES_SNAPSHOT', () => {
    const ss = setupPayrollSheets(
      [ makeRosterRow({ designerId: 'SYR', name: 'Sayan Roy', rate: 250 }) ],
      [ makeMasterRow({ designerName: 'Sayan Roy', designHours: 10, billingPeriod: 'March 2026' }) ]
    );

    runMonthlyPayroll('March 2026');

    const snap = ss.getSheetByName('PAYROLL_RATES_SNAPSHOT').getDataRange().getValues();
    // Row 0 = header, row 1 = snapshot
    const snapRow = snap.find(r => r[1] === 'Sayan Roy');
    expect(snapRow).toBeDefined();
    expect(snapRow[0]).toBe('March 2026');
    expect(snapRow[2]).toBe(250);
  });

  test('bonus ledger written with correct breakdown', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([
      makeRosterRow({ designerId: 'TL1', name: 'Team Lead One',
                      role: 'Team Leader', supId: '', bonusElig: 'Yes', rate: 350 }),
      makeRosterRow({ designerId: 'D1', name: 'Designer One',
                      role: 'Designer', supId: 'TL1', supName: 'Team Lead One',
                      bonusElig: 'No', rate: 250 })
    ]));
    ss.addSheet('MASTER_JOB_DATABASE', makeMasterSheet([
      makeMasterRow({ designerName: 'Designer One', designHours: 10,
                      billingPeriod: 'March 2026' })
    ]));
    ss.addSheet('DESIGNER_MASTER', [['x'], ['x']]);
    ss.addSheet('PAYROLL_RATES_SNAPSHOT', [['x']]);

    runMonthlyPayroll('March 2026');

    const bonus = ss.getSheetByName('PAYROLL_BONUS_LEDGER').getDataRange().getValues();
    // Row 0 = header, row 1 = bonus entry
    const bonusRow = bonus.find(r => r[PB.supName - 1] === 'Team Lead One' &&
                                     r[PB.month   - 1] === 'March 2026');
    expect(bonusRow).toBeDefined();
    expect(bonusRow[PB.hours    - 1]).toBe(10);
    expect(bonusRow[PB.bonusINR - 1]).toBe(250);
  });

});


// =============================================================
// 5. Edge cases
// =============================================================
describe('Edge cases', () => {

  test('designer in MASTER but not in STAFF_ROSTER falls back to DESIGNER_MASTER rate', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([]));  // empty roster
    ss.addSheet('MASTER_JOB_DATABASE', makeMasterSheet([
      makeMasterRow({ designerName: 'Sayan Roy', designHours: 8, billingPeriod: 'March 2026' })
    ]));
    ss.addSheet('DESIGNER_MASTER', [
      ['Designer_ID','Designer_Name','Email','Phone','Role','Team_Lead',
       'Hourly_Rate','Start_Date','Active'],
      ['SYR','Sayan Roy','sr@test.com','','Designer','','₹250.00','','Yes']
    ]);
    ss.addSheet('PAYROLL_RATES_SNAPSHOT', [['x']]);

    runMonthlyPayroll('March 2026');

    const data = ss.getSheetByName('PAYROLL_LEDGER').getDataRange().getValues();
    const row  = data.find(r => r[PL.designerName - 1] === 'Sayan Roy' &&
                                r[PL.month - 1] === 'March 2026');
    expect(row[PL.rateINR - 1]).toBe(250);
    expect(row[PL.basePay - 1]).toBe(2000);
  });

  test('getMasterHoursForPeriod_ handles missing/empty hour cells as zero', () => {
    const ss = getMockSpreadsheet();
    const row = new Array(36).fill('');
    row[3]  = 'Empty Hours Designer';
    row[10] = '';   // designHours blank
    row[17] = 'March 2026';
    row[30] = 'No';
    ss.addSheet('MASTER_JOB_DATABASE', [new Array(36).fill(''), row]);

    const hours = getMasterHoursForPeriod_('March 2026');
    expect(hours['Empty Hours Designer'].designHours).toBe(0);
    expect(hours['Empty Hours Designer'].qcHours).toBe(0);
    expect(hours['Empty Hours Designer'].reworkHours).toBe(0);
  });

  test('STAFF_ROSTER rate with ₹ symbol is parsed correctly', () => {
    const ss = getMockSpreadsheet();
    const rosterRow = makeRosterRow({ name: 'Rupee Designer' });
    rosterRow[10] = '₹450.00';  // rate stored with symbol
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([rosterRow]));

    const map = buildDesignerProfileMap_();
    expect(map['Rupee Designer'].rate).toBe(450);
  });

  test('calculateSupervisorBonuses_ ignores unknown designers (not in profileMap)', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('STAFF_ROSTER', makeRosterSheet([
      makeRosterRow({ designerId: 'TL1', name: 'Team Lead One',
                      role: 'Team Leader', bonusElig: 'Yes', rate: 350 })
    ]));
    const map    = buildDesignerProfileMap_();
    // Ghost designer not in STAFF_ROSTER
    const paidH  = { 'Ghost Designer': 10, 'Team Lead One': 5 };
    const bonuses = calculateSupervisorBonuses_(paidH, map);

    // Ghost has no profile so no bonus generated; TL has no supervisor so no bonus
    expect(Object.keys(bonuses)).toHaveLength(0);
  });

  test('multiple jobs for same designer in same period are summed correctly', () => {
    const ss = getMockSpreadsheet();
    ss.addSheet('MASTER_JOB_DATABASE', makeMasterSheet([
      makeMasterRow({ jobNumber: 'J1', designerName: 'Sayan Roy', designHours: 4, billingPeriod: 'March 2026' }),
      makeMasterRow({ jobNumber: 'J2', designerName: 'Sayan Roy', designHours: 6, billingPeriod: 'March 2026' }),
      makeMasterRow({ jobNumber: 'J3', designerName: 'Sayan Roy', designHours: 3, billingPeriod: 'March 2026' })
    ]));

    const hours = getMasterHoursForPeriod_('March 2026');
    expect(hours['Sayan Roy'].designHours).toBe(13);
  });

});
