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

// Load SheetDB.js — provides SheetDB and CONFIG_MASTER schema
const sheetDbJs = fs.readFileSync(path.join(__dirname, '../SheetDB.js'), 'utf8');
eval(sheetDbJs);

// Load ConfigService.js — provides ConfigService (reads from CONFIG_MASTER via SheetDB)
const configServiceJs = fs.readFileSync(path.join(__dirname, '../ConfigService.js'), 'utf8');
eval(configServiceJs);

// Load QuarterlyBonusEngine.js — provides quarterly bonus functions
const quarterlyBonusJs = fs.readFileSync(path.join(__dirname, '../QuarterlyBonusEngine.js'), 'utf8');
eval(quarterlyBonusJs);


// ── Master row builder ────────────────────────────────────────
function makeMasterRow(opts) {
  var row = new Array(42).fill('');
  row[CONFIG.masterCols.billingPeriod - 1] = opts.period       || 'March 2026';
  row[CONFIG.masterCols.designerName  - 1] = opts.name         || 'Alice';
  row[CONFIG.masterCols.designHours   - 1] = opts.design       || 0;
  row[CONFIG.masterCols.reworkHours   - 1] = opts.rework       || 0;
  row[CONFIG.masterCols.isTest        - 1] = opts.isTest       || 'No';
  row[CONFIG.masterCols.clientReturn  - 1] = opts.clientReturn || 0;
  row[CONFIG.masterCols.supId         - 1] = opts.supId        || '';
  return row;
}

function makeMasterSheet(rows) {
  var header = new Array(42).fill('header');
  return [header].concat(rows);
}


function makeQBIRow(opts) {
  return {
    inputId           : opts.inputId           || 'QBI-2026-0001',
    quarter           : opts.quarter           || 'Q1-2026',
    personId          : opts.personId          || 'D001',
    personName        : opts.personName        || 'Alice',
    role              : opts.role              || 'Designer',
    clientFeedbackAvg : opts.clientFeedbackAvg !== undefined ? opts.clientFeedbackAvg : 4.0,
    tlRatingAvg       : opts.tlRatingAvg       !== undefined ? opts.tlRatingAvg       : 4.0,
    pmRatingAvg       : opts.pmRatingAvg       !== undefined ? opts.pmRatingAvg       : 4.0,
    ceoRatingAvg      : opts.ceoRatingAvg      !== undefined ? opts.ceoRatingAvg      : 0,
    forcedDiffFlag    : opts.forcedDiffFlag    || false,
    strengthNote      : opts.strengthNote      || '',
    improvementNote   : opts.improvementNote   || '',
    compositeScore    : opts.compositeScore    || 0,
    status            : opts.status            || 'Draft',
    computedAt        : opts.computedAt        || null
  };
}


// ── Setup ──────────────────────────────────────────────

beforeEach(() => {
  resetMockSpreadsheet();
  // Reset SheetDB's cached spreadsheet reference and read cache so each test
  // gets a fresh MockSpreadsheet rather than the one from the previous test.
  _SDB_STATE.ss = null;
  _SDB_STATE.cache = {};
});


// ── Placeholder suite (tests added in subsequent tasks) ──

describe('QuarterlyBonusEngine (scaffold)', () => {
  test('stub placeholder', () => {
    expect(true).toBe(true);
  });
});


describe('getQuarterHours_', function () {
  test('aggregates design hours across 3 months of a quarter', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026',  name: 'Alice', design: 80 }),
      makeMasterRow({ period: 'February 2026', name: 'Alice', design: 60 }),
      makeMasterRow({ period: 'March 2026',    name: 'Alice', design: 40 }),
      makeMasterRow({ period: 'April 2026',    name: 'Alice', design: 99 })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    var result = getQuarterHours_('Q1', 2026);

    expect(result['Alice']).toBe(180);
    expect(result['AprilAlice']).toBeUndefined();
  });

  test('excludes isTest=Yes rows', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', name: 'Bob', design: 50 }),
      makeMasterRow({ period: 'January 2026', name: 'Bob', design: 10, isTest: 'Yes' })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    var result = getQuarterHours_('Q1', 2026);

    expect(result['Bob']).toBe(50);
  });
});


describe('getErrorRates_', function () {
  test('computes rework/design ratio per designer', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026',  name: 'Alice', design: 100, rework: 10 }),
      makeMasterRow({ period: 'February 2026', name: 'Alice', design: 100, rework: 0  })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    var result = getErrorRates_('Q1', 2026);

    // 10 rework / 200 total design = 0.05
    expect(result['Alice']).toBeCloseTo(0.05);
  });

  test('returns 0 when no rework', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', name: 'Bob', design: 80, rework: 0 })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    expect(getErrorRates_('Q1', 2026)['Bob']).toBe(0);
  });

  test('returns 0 when designer has zero design hours (avoid divide-by-zero)', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', name: 'Carol', design: 0, rework: 0 })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    expect(getErrorRates_('Q1', 2026)['Carol']).toBe(0);
  });
});


describe('getClientQcReturnRates_', function () {
  test('computes return rate per supervisor', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', supId: 'TL001', clientReturn: 1 }),
      makeMasterRow({ period: 'January 2026', supId: 'TL001', clientReturn: 0 }),
      makeMasterRow({ period: 'January 2026', supId: 'TL001', clientReturn: 0 }),
      makeMasterRow({ period: 'January 2026', supId: 'TL001', clientReturn: 0 })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    var result = getClientQcReturnRates_('Q1', 2026);

    // 1 return / 4 total = 0.25
    expect(result['TL001']).toBeCloseTo(0.25);
  });

  test('returns 0 for supervisor with no returns', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', supId: 'TL002', clientReturn: 0 })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    expect(getClientQcReturnRates_('Q1', 2026)['TL002']).toBe(0);
  });

  test('ignores rows with no supId', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', supId: '', clientReturn: 1 })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    var result = getClientQcReturnRates_('Q1', 2026);
    expect(Object.keys(result).length).toBe(0);
  });

  test('excludes isTest rows', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026', supId: 'TL003', clientReturn: 1 }),
      makeMasterRow({ period: 'January 2026', supId: 'TL003', clientReturn: 1, isTest: 'Yes' })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    var result = getClientQcReturnRates_('Q1', 2026);
    // Only 1 real job with 1 return; the isTest row must be ignored
    expect(result['TL003']).toBeCloseTo(1.0);
  });
});


describe('getBonusInputs_', function () {
  test('returns only rows matching the quarter key', function () {
    var allRows = [
      makeQBIRow({ personId: 'D001', quarter: 'Q1-2026' }),
      makeQBIRow({ personId: 'D002', quarter: 'Q2-2026' })
    ];
    SheetDB.findRows = jest.fn(function (alias, fn) { return allRows.filter(fn); });

    var result = getBonusInputs_('Q1', 2026);

    expect(result.length).toBe(1);
    expect(result[0].personId).toBe('D001');
  });

  test('excludes rows from other quarters', function () {
    var allRows = [
      makeQBIRow({ personId: 'D001', quarter: 'Q1-2026' }),
      makeQBIRow({ personId: 'D002', quarter: 'Q2-2026' })
    ];
    SheetDB.findRows = jest.fn(function (alias, fn) { return allRows.filter(fn); });

    var result = getBonusInputs_('Q1', 2026);

    expect(result.some(function (r) { return r.quarter === 'Q2-2026'; })).toBe(false);
  });
});

describe('checkForcedDifferentiation_', function () {
  test('returns true when >60% of designers are rated above 4.0', function () {
    // 3/4 = 75% above 4.0
    var inputs = [
      makeQBIRow({ tlRatingAvg: 4.5 }),
      makeQBIRow({ tlRatingAvg: 4.2 }),
      makeQBIRow({ tlRatingAvg: 4.1 }),
      makeQBIRow({ tlRatingAvg: 3.5 })
    ];
    expect(checkForcedDifferentiation_('TL Sarty', inputs)).toBe(true);
  });

  test('returns false when <=60% rated above 4.0', function () {
    // 1/4 = 25%
    var inputs = [
      makeQBIRow({ tlRatingAvg: 4.5 }),
      makeQBIRow({ tlRatingAvg: 3.0 }),
      makeQBIRow({ tlRatingAvg: 3.2 }),
      makeQBIRow({ tlRatingAvg: 2.8 })
    ];
    expect(checkForcedDifferentiation_('TL Sarty', inputs)).toBe(false);
  });

  test('returns false at exactly 60%', function () {
    // 3/5 = 60% -- rule is STRICTLY >60%
    var inputs = [
      makeQBIRow({ tlRatingAvg: 4.5 }),
      makeQBIRow({ tlRatingAvg: 4.2 }),
      makeQBIRow({ tlRatingAvg: 4.1 }),
      makeQBIRow({ tlRatingAvg: 3.0 }),
      makeQBIRow({ tlRatingAvg: 2.0 })
    ];
    expect(checkForcedDifferentiation_('TL Sarty', inputs)).toBe(false);
  });

  test('returns false for empty inputs array', function () {
    expect(checkForcedDifferentiation_('TL Sarty', [])).toBe(false);
  });

  test('returns false for null inputs', function () {
    expect(checkForcedDifferentiation_('TL Sarty', null)).toBe(false);
  });
});

describe('computeDesignerScores_', function () {
  test('computes composite correctly for a complete input set', function () {
    var inputs = [
      makeQBIRow({
        personId: 'D001', personName: 'Alice', role: 'Designer',
        clientFeedbackAvg: 5.0, tlRatingAvg: 4.0, pmRatingAvg: 4.0
      })
    ];
    // composite = 0.30*(5/5) + 0.30*(1-0) + 0.25*(4/5) + 0.15*(4/5)
    //           = 0.30 + 0.30 + 0.20 + 0.12 = 0.92
    ConfigService.getNumber = jest.fn(function(key, def) { return def; });
    var result = computeDesignerScores_('Q1', 2026, inputs, { 'Alice': 0.0 }, { 'Alice': 100 });

    expect(result['D001'].compositeScore).toBeCloseTo(0.92);
    expect(result['D001'].status).toBe('Draft');
    expect(result['D001'].bonusINR).toBe(Math.round(0.92 * 100 * 25));
  });

  test('marks PENDING when clientFeedbackAvg is missing (0)', function () {
    var inputs = [
      makeQBIRow({
        personId: 'D002', personName: 'Bob', role: 'Designer',
        clientFeedbackAvg: 0, tlRatingAvg: 4.0, pmRatingAvg: 4.0
      })
    ];
    ConfigService.getNumber = jest.fn(function(key, def) { return def; });
    var result = computeDesignerScores_('Q1', 2026, inputs, { 'Bob': 0 }, { 'Bob': 80 });

    expect(result['D002'].status).toBe('Pending');
    expect(result['D002'].bonusINR).toBe(0);
    expect(result['D002'].pendingReason).toMatch(/client/i);
  });

  test('writes zero bonus for designer with zero hours but Draft status', function () {
    var inputs = [
      makeQBIRow({
        personId: 'D003', personName: 'Carol', role: 'Designer',
        clientFeedbackAvg: 4.0, tlRatingAvg: 4.0, pmRatingAvg: 4.0
      })
    ];
    ConfigService.getNumber = jest.fn(function(key, def) { return def; });
    var result = computeDesignerScores_('Q1', 2026, inputs, { 'Carol': 0 }, { 'Carol': 0 });

    expect(result['D003'].bonusINR).toBe(0);
    expect(result['D003'].status).toBe('Draft');
  });

  test('skips non-Designer roles', function () {
    var inputs = [
      makeQBIRow({ personId: 'TL001', role: 'Team Leader' })
    ];
    ConfigService.getNumber = jest.fn(function(key, def) { return def; });
    var result = computeDesignerScores_('Q1', 2026, inputs, {}, {});
    expect(result['TL001']).toBeUndefined();
  });
});

describe('computeSupervisorScores_', function () {
  test('computes TL composite using designer average and CEO rating', function () {
    ConfigService.getNumber = jest.fn(function(key, def) { return def; });
    var tlInput = makeQBIRow({
      personId: 'TL001', personName: 'Sarty', role: 'Team Leader',
      ceoRatingAvg: 4.0, clientFeedbackAvg: 0, tlRatingAvg: 0, pmRatingAvg: 0
    });

    // Alice and Bob both report to TL001
    var designerScores = {
      'D001': { compositeScore: 0.80, hours: 100, status: 'Draft', personName: 'Alice' },
      'D002': { compositeScore: 0.60, hours:  80, status: 'Draft', personName: 'Bob'   }
    };
    var returnRates = { 'TL001': 0.10 };
    var profileMap  = {
      'Alice': { supId: 'TL001', designerId: 'D001', role: 'Designer' },
      'Bob':   { supId: 'TL001', designerId: 'D002', role: 'Designer' }
    };

    var result = computeSupervisorScores_(
      'Q1', 2026, [tlInput], designerScores, returnRates, profileMap
    );

    // avgDesignerComposite = (0.80 + 0.60) / 2 = 0.70
    // composite = 0.30*(1-0.10) + 0.40*0.70 + 0.30*(4.0/5)
    //           = 0.27 + 0.28 + 0.24 = 0.79
    expect(result['TL001'].compositeScore).toBeCloseTo(0.79, 2);
    expect(result['TL001'].hours).toBe(180);   // 100 + 80
    expect(result['TL001'].bonusINR).toBe(Math.round(180 * 0.79 * 25));
  });

  test('marks PENDING when CEO rating is missing', function () {
    ConfigService.getNumber = jest.fn(function(key, def) { return def; });
    var tlInput = makeQBIRow({
      personId: 'TL002', personName: 'Priya', role: 'Team Leader', ceoRatingAvg: 0
    });
    var result = computeSupervisorScores_('Q1', 2026, [tlInput], {}, {}, {});

    expect(result['TL002'].status).toBe('Pending');
    expect(result['TL002'].pendingReason).toMatch(/CEO/i);
  });

  test('excludes PENDING designer scores from average', function () {
    ConfigService.getNumber = jest.fn(function(key, def) { return def; });
    var tlInput = makeQBIRow({
      personId: 'TL003', personName: 'Maya', role: 'Team Leader', ceoRatingAvg: 4.0
    });
    var designerScores = {
      'D010': { compositeScore: 0.80, hours: 100, status: 'Draft',   personName: 'Eve'  },
      'D011': { compositeScore: 0,    hours:  0,  status: 'Pending', personName: 'Frank' }
    };
    var profileMap = {
      'Eve':   { supId: 'TL003', designerId: 'D010', role: 'Designer' },
      'Frank': { supId: 'TL003', designerId: 'D011', role: 'Designer' }
    };
    var result = computeSupervisorScores_('Q1', 2026, [tlInput], designerScores, {}, profileMap);

    // Only Eve (Draft) included in average; Frank (Pending) excluded.
    // avgDesignerComposite = 0.80
    // composite = 0.30*(1-0) + 0.40*0.80 + 0.30*(4.0/5) = 0.30 + 0.32 + 0.24 = 0.86
    expect(result['TL003'].compositeScore).toBeCloseTo(0.86, 2);
    expect(result['TL003'].hours).toBe(100);  // Frank's hours excluded too
  });

  test('PM uses pmCode lookup, not supId', function () {
    ConfigService.getNumber = jest.fn(function(key, def) { return def; });
    var pmInput = makeQBIRow({
      personId: 'PM001', personName: 'Raj', role: 'Project Manager', ceoRatingAvg: 5.0
    });
    var designerScores = {
      'D020': { compositeScore: 0.80, hours: 120, status: 'Draft', personName: 'Grace' }
    };
    // Grace is linked to PM001 via pmCode, NOT supId
    var profileMap = {
      'Grace': { supId: 'TL999', pmCode: 'PM001', designerId: 'D020', role: 'Designer' }
    };

    var result = computeSupervisorScores_('Q1', 2026, [pmInput], designerScores, {}, profileMap);

    // composite = 0.30*(1-0) + 0.40*0.80 + 0.30*(5.0/5) = 0.30 + 0.32 + 0.30 = 0.92
    expect(result['PM001'].compositeScore).toBeCloseTo(0.92, 2);
    expect(result['PM001'].hours).toBe(120);
  });
});

describe('writeBonusLedger_', function () {
  test('deletes existing quarterly rows then inserts new ones', function () {
    SheetDB.deleteWhere = jest.fn();
    SheetDB.insertRows  = jest.fn();

    var entries = [{
      personId: 'D001', personName: 'Alice', role: 'Designer',
      compositeScore: 0.90, bonusINR: 2250, hours: 100,
      status: 'Draft', pendingReason: ''
    }];

    writeBonusLedger_(entries, 'Q1', 2026);

    expect(SheetDB.deleteWhere).toHaveBeenCalledWith(
      'BONUS_LEDGER', expect.any(Function)
    );
    expect(SheetDB.insertRows).toHaveBeenCalledWith(
      'BONUS_LEDGER',
      expect.arrayContaining([
        expect.objectContaining({ bonusINR: 2250, bonusType: 'QUARTERLY', status: 'Draft' })
      ])
    );
  });

  test('sets performanceTier correctly', function () {
    SheetDB.deleteWhere = jest.fn();
    SheetDB.insertRows  = jest.fn();

    writeBonusLedger_([
      { personId:'A', personName:'Hi',  role:'Designer', compositeScore:0.85, bonusINR:100, hours:50, status:'Draft', pendingReason:'' },
      { personId:'B', personName:'Mid', role:'Designer', compositeScore:0.65, bonusINR:80,  hours:50, status:'Draft', pendingReason:'' },
      { personId:'C', personName:'Low', role:'Designer', compositeScore:0.40, bonusINR:0,   hours:50, status:'Draft', pendingReason:'' }
    ], 'Q1', 2026);

    var rows = SheetDB.insertRows.mock.calls[0][1];
    expect(rows[0].performanceTier).toBe('HIGH');
    expect(rows[1].performanceTier).toBe('AVERAGE');
    expect(rows[2].performanceTier).toBe('NEEDS_IMPROVEMENT');
  });
});
