# Quarterly Bonus Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build QuarterlyBonusEngine.js — a standalone engine that computes quarterly performance bonuses for BLC designers, TLs, and PMs, served via a new rating portal.

**Architecture:** Engine reads hours/error data from MASTER_JOB_DATABASE and ratings from QUARTERLY_BONUS_INPUTS (new sheet), then writes to BONUS_LEDGER. Designers are scored first; TL/PM scores depend on their designers' scores. Ratings are submitted via QuarterlyRating.html through Portalsecurity.js.

**Tech Stack:** Google Apps Script (ES5 only — no arrow functions, no const/let outside function scope), SheetDB.js for all sheet I/O, ConfigService.js for config, Jest + gas-mocks.js for tests.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `SheetDB.js` | Modify | Add QUARTERLY_BONUS_INPUTS schema |
| `ConfigService.js` | Modify | Add bonus_links_send_direct + quarterly_bonus_rate_inr seed keys |
| `QuarterlyBonusEngine.js` | Create | All computation logic |
| `tests/quarterly-bonus.test.js` | Create | Jest tests for engine |
| `Portalsecurity.js` | Modify | Route /rating page; add getQuarterlyRatingData() + submitQuarterlyRating() |
| `QuarterlyRating.html` | Create | Portal HTML form (TL/PM/CEO views) |
| `ClientRating.html` | Create | Client-facing rating form (token-auth) |

---

## Task 1: Add QUARTERLY_BONUS_INPUTS schema to SheetDB.js

**Files:**
- Modify: `SheetDB.js` (after the BONUS_LEDGER schema block)

- [ ] **Step 1: Find the insertion point**

Open `SheetDB.js`. Search for `SDB_SCHEMAS['BONUS_LEDGER']`. The new schema goes immediately after the closing `};` of that block.

- [ ] **Step 2: Insert the schema**

```js
SDB_SCHEMAS['QUARTERLY_BONUS_INPUTS'] = {
  _sheetName    : 'QUARTERLY_BONUS_INPUTS',
  _dataStartRow : 1,
  _idField      : 'inputId',
  _idPrefix     : 'QBI',
  columns: {
    inputId           : { col:  0, type: SDB_T.STRING,    required: false, default: ''      },
    quarter           : { col:  1, type: SDB_T.STRING,    required: true,  default: ''      },
    personId          : { col:  2, type: SDB_T.STRING,    required: true,  default: ''      },
    personName        : { col:  3, type: SDB_T.STRING,    required: false, default: ''      },
    role              : { col:  4, type: SDB_T.STRING,    required: false, default: ''      },
    clientFeedbackAvg : { col:  5, type: SDB_T.NUMBER,    required: false, default: 0       },
    tlRatingAvg       : { col:  6, type: SDB_T.NUMBER,    required: false, default: 0       },
    pmRatingAvg       : { col:  7, type: SDB_T.NUMBER,    required: false, default: 0       },
    ceoRatingAvg      : { col:  8, type: SDB_T.NUMBER,    required: false, default: 0       },
    forcedDiffFlag    : { col:  9, type: SDB_T.BOOLEAN,   required: false, default: false   },
    strengthNote      : { col: 10, type: SDB_T.STRING,    required: false, default: ''      },
    improvementNote   : { col: 11, type: SDB_T.STRING,    required: false, default: ''      },
    compositeScore    : { col: 12, type: SDB_T.NUMBER,    required: false, default: 0       },
    status            : { col: 13, type: SDB_T.STRING,    required: false, default: 'Draft' },
    computedAt        : { col: 14, type: SDB_T.TIMESTAMP, required: false, default: null    }
  }
};
```

- [ ] **Step 3: Commit**

```bash
git add SheetDB.js
git commit -m "feat: add QUARTERLY_BONUS_INPUTS schema to SheetDB"
```

---

## Task 2: Add config seed keys to ConfigService.js

**Files:**
- Modify: `ConfigService.js` (CONFIG_MASTER_SEED array, BONUS group)

- [ ] **Step 1: Find the BONUS group in the seed array**

Search for `configGroup: 'BONUS'` in `ConfigService.js`. Add the two new keys alongside existing BONUS keys.

- [ ] **Step 2: Insert the keys**

```js
{ configKey: 'bonus_links_send_direct',  configValue: 'false', configGroup: 'BONUS' },
{ configKey: 'quarterly_bonus_rate_inr', configValue: '25',    configGroup: 'BONUS' },
```

- `bonus_links_send_direct = false` — Phase 1: all rating links go to blccanada2026@gmail.com for manual forwarding.
- `bonus_links_send_direct = true` — Phase 2: links go directly to recipients (flip in CONFIG_MASTER, no code change).
- `quarterly_bonus_rate_inr = 25` — INR per design hour (spec §1).

- [ ] **Step 3: Commit**

```bash
git add ConfigService.js
git commit -m "feat: add quarterly bonus config seed keys"
```

---

## Task 3: Create test file scaffold and QuarterlyBonusEngine.js stub

**Files:**
- Create: `tests/quarterly-bonus.test.js`
- Create: `QuarterlyBonusEngine.js`

- [ ] **Step 1: Create the test file**

The test file must load Code.js, SheetDB.js, and QuarterlyBonusEngine.js using the same
fs.readFileSync + execute pattern established in `tests/payroll.test.js` lines 16–27.
Mirror that file's header exactly: require gas-mocks, destructure resetMockSpreadsheet and
getMockSpreadsheet, load Code.js first (provides CONFIG, normaliseDesignerName), then SheetDB.js,
then QuarterlyBonusEngine.js.

```js
/**
 * quarterly-bonus.test.js
 * Tests for QuarterlyBonusEngine.js — the BLC quarterly bonus system.
 */

require('./gas-mocks');
const { resetMockSpreadsheet, getMockSpreadsheet } = require('./gas-mocks');

const fs   = require('fs');
const path = require('path');

// Load Code.js, SheetDB.js, QuarterlyBonusEngine.js in dependency order.
// Use the same fs.readFileSync + execute pattern as tests/payroll.test.js:16-27.
// IMPORTANT: execute Code.js first, SheetDB.js second, engine last.

beforeEach(() => {
  resetMockSpreadsheet();
});
```

Fill in the three file-load calls by copying the pattern from `tests/payroll.test.js:22-27`.

- [ ] **Step 2: Create QuarterlyBonusEngine.js stub**

```js
/**
 * QuarterlyBonusEngine.js
 * Quarterly and annual performance bonus engine for BLC.
 * Designers scored first; TL/PM scored using their designers' averages.
 * Formula: bonus_INR = design_hours x composite_score x INR_25
 *
 * Computation order (enforced in runQuarterlyBonus):
 *   1. getQuarterHours_       — hours per designer from MASTER
 *   2. getErrorRates_         — rework/design ratio per designer
 *   3. getClientQcReturnRates_ — return rate per supervisor
 *   4. getBonusInputs_        — ratings from QUARTERLY_BONUS_INPUTS
 *   5. computeDesignerScores_ — score every designer (PENDING if input missing)
 *   6. computeSupervisorScores_ — score TL then PM (needs designer scores)
 *   7. checkForcedDifferentiation_ — warning flag, not a block
 *   8. writeBonusLedger_      — clear + rewrite BONUS_LEDGER for the quarter
 *   9. runAnnualBonus (Dec only)
 */

/* global SheetDB, ConfigService, CONFIG, normaliseDesignerName, Logger,
          GmailApp, Utilities, getUiSafe_, buildDesignerProfileMap_ */

var QB_QUARTERS = {
  'Q1': [1, 2, 3],
  'Q2': [4, 5, 6],
  'Q3': [7, 8, 9],
  'Q4': [10, 11, 12]
};

// Functions added in subsequent tasks.
```

- [ ] **Step 3: Run tests — confirm zero failures**

```bash
npx jest tests/quarterly-bonus.test.js --no-coverage
```

Expected: 0 tests, 0 failures (empty suite is fine here).

- [ ] **Step 4: Commit**

```bash
git add QuarterlyBonusEngine.js tests/quarterly-bonus.test.js
git commit -m "feat: scaffold QuarterlyBonusEngine and test file"
```

---

## Task 4: getQuarterHours_()

Reads MASTER_JOB_DATABASE and returns total design hours per designer for the quarter's 3 months.

**Files:**
- Modify: `QuarterlyBonusEngine.js`
- Modify: `tests/quarterly-bonus.test.js`

- [ ] **Step 1: Add helper builders to the test file**

```js
// ── Master row builder ────────────────────────────────────────
// Column indices match CONFIG.masterCols (1-based in CONFIG, so subtract 1 for array index).
// Check Code.js CONFIG.masterCols for the authoritative list.
function makeMasterRow(opts) {
  var row = new Array(30).fill('');
  row[CONFIG.masterCols.billingPeriod - 1] = opts.period       || 'March 2026';
  row[CONFIG.masterCols.designerName  - 1] = opts.name         || 'Alice';
  row[CONFIG.masterCols.designHours   - 1] = opts.design       || 0;
  row[CONFIG.masterCols.reworkHours   - 1] = opts.rework       || 0;
  row[CONFIG.masterCols.isTest        - 1] = opts.isTest       || 'No';
  // clientReturn: 1 if client returned this job, else 0
  row[CONFIG.masterCols.clientReturn  - 1] = opts.clientReturn || 0;
  // supId: the designer's supervisor ID
  row[CONFIG.masterCols.supId         - 1] = opts.supId        || '';
  return row;
}

function makeMasterSheet(rows) {
  var header = new Array(30).fill('header');
  return [header].concat(rows);
}
```

**Note:** If `CONFIG.masterCols.clientReturn` or `CONFIG.masterCols.supId` do not yet exist in Code.js, add them there (with the correct 1-based column index from the actual MASTER_JOB_DATABASE sheet). Verify before running.

- [ ] **Step 2: Write the failing test**

```js
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

    expect(result['Alice']).toBe(180);      // Jan+Feb+Mar only
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
```

- [ ] **Step 3: Run — expect FAIL** (function not defined)

```bash
npx jest tests/quarterly-bonus.test.js -t "getQuarterHours" --no-coverage
```

- [ ] **Step 4: Implement getQuarterHours_()**

```js
var QB_MONTH_NAMES = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];

/**
 * Returns total design hours per normalised designer name for a quarter.
 * @param {string} quarter  'Q1'|'Q2'|'Q3'|'Q4'
 * @param {number} year     e.g. 2026
 * @returns {Object}  { normalisedDesignerName: totalHours }
 */
function getQuarterHours_(quarter, year) {
  var months       = QB_QUARTERS[quarter];
  var validPeriods = {};
  months.forEach(function (m) {
    validPeriods[QB_MONTH_NAMES[m - 1] + ' ' + year] = true;
  });

  var rows   = SheetDB.getAll('MASTER');
  var totals = {};

  rows.forEach(function (row) {
    if (row.isTest === 'Yes') return;
    var period = typeof row.billingPeriod === 'object'
      ? Utilities.formatDate(row.billingPeriod, 'Asia/Kolkata', 'MMMM yyyy')
      : String(row.billingPeriod || '');
    if (!validPeriods[period]) return;

    var name  = normaliseDesignerName(row.designerName || '');
    var hours = Number(row.designHours) || 0;
    totals[name] = (totals[name] || 0) + hours;
  });

  return totals;
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
npx jest tests/quarterly-bonus.test.js -t "getQuarterHours" --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add QuarterlyBonusEngine.js tests/quarterly-bonus.test.js
git commit -m "feat: implement getQuarterHours_"
```

---

## Task 5: getErrorRates_()

Returns rework error rate per designer: `rework_hours / total_design_hours` for the quarter.

**Files:**
- Modify: `QuarterlyBonusEngine.js`
- Modify: `tests/quarterly-bonus.test.js`

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/quarterly-bonus.test.js -t "getErrorRates" --no-coverage
```

- [ ] **Step 3: Implement getErrorRates_()**

```js
/**
 * Returns error rate per normalised designer name: rework_hours / total_design_hours.
 * @returns {Object}  { name: rate } where rate is 0–1
 */
function getErrorRates_(quarter, year) {
  var months       = QB_QUARTERS[quarter];
  var validPeriods = {};
  months.forEach(function (m) {
    validPeriods[QB_MONTH_NAMES[m - 1] + ' ' + year] = true;
  });

  var rows         = SheetDB.getAll('MASTER');
  var designTotals = {};
  var reworkTotals = {};

  rows.forEach(function (row) {
    if (row.isTest === 'Yes') return;
    var period = typeof row.billingPeriod === 'object'
      ? Utilities.formatDate(row.billingPeriod, 'Asia/Kolkata', 'MMMM yyyy')
      : String(row.billingPeriod || '');
    if (!validPeriods[period]) return;

    var name = normaliseDesignerName(row.designerName || '');
    designTotals[name] = (designTotals[name] || 0) + (Number(row.designHours)  || 0);
    reworkTotals[name] = (reworkTotals[name] || 0) + (Number(row.reworkHours)  || 0);
  });

  var rates = {};
  Object.keys(designTotals).forEach(function (name) {
    var total  = designTotals[name];
    rates[name] = total > 0 ? (reworkTotals[name] || 0) / total : 0;
  });
  return rates;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/quarterly-bonus.test.js -t "getErrorRates" --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add QuarterlyBonusEngine.js tests/quarterly-bonus.test.js
git commit -m "feat: implement getErrorRates_"
```

---

## Task 6: getClientQcReturnRates_()

Returns client QC return rate per supervisor ID: `client_returned_jobs / total_jobs`.

**Files:**
- Modify: `QuarterlyBonusEngine.js`
- Modify: `tests/quarterly-bonus.test.js`

- [ ] **Step 1: Write the failing tests**

```js
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
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/quarterly-bonus.test.js -t "getClientQcReturnRates" --no-coverage
```

- [ ] **Step 3: Implement getClientQcReturnRates_()**

```js
/**
 * Returns client QC return rate per supervisor ID.
 * @returns {Object}  { supId: rate } where rate is 0–1
 */
function getClientQcReturnRates_(quarter, year) {
  var months       = QB_QUARTERS[quarter];
  var validPeriods = {};
  months.forEach(function (m) {
    validPeriods[QB_MONTH_NAMES[m - 1] + ' ' + year] = true;
  });

  var rows         = SheetDB.getAll('MASTER');
  var jobCounts    = {};
  var returnCounts = {};

  rows.forEach(function (row) {
    if (row.isTest === 'Yes') return;
    var period = typeof row.billingPeriod === 'object'
      ? Utilities.formatDate(row.billingPeriod, 'Asia/Kolkata', 'MMMM yyyy')
      : String(row.billingPeriod || '');
    if (!validPeriods[period]) return;

    var supId = String(row.supId || '').trim();
    if (!supId) return;

    jobCounts[supId]    = (jobCounts[supId] || 0) + 1;
    returnCounts[supId] = (returnCounts[supId] || 0) + (Number(row.clientReturn) || 0);
  });

  var rates = {};
  Object.keys(jobCounts).forEach(function (id) {
    rates[id] = jobCounts[id] > 0 ? returnCounts[id] / jobCounts[id] : 0;
  });
  return rates;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/quarterly-bonus.test.js -t "getClientQcReturnRates" --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add QuarterlyBonusEngine.js tests/quarterly-bonus.test.js
git commit -m "feat: implement getClientQcReturnRates_"
```

---

## Task 7: getBonusInputs_() + checkForcedDifferentiation_()

**Files:**
- Modify: `QuarterlyBonusEngine.js`
- Modify: `tests/quarterly-bonus.test.js`

- [ ] **Step 1: Add QBI row builder to the test file**

```js
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
```

- [ ] **Step 2: Write the failing tests**

```js
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
    // 3/5 = 60% — rule is STRICTLY >60%
    var inputs = [
      makeQBIRow({ tlRatingAvg: 4.5 }),
      makeQBIRow({ tlRatingAvg: 4.2 }),
      makeQBIRow({ tlRatingAvg: 4.1 }),
      makeQBIRow({ tlRatingAvg: 3.0 }),
      makeQBIRow({ tlRatingAvg: 2.0 })
    ];
    expect(checkForcedDifferentiation_('TL Sarty', inputs)).toBe(false);
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
npx jest tests/quarterly-bonus.test.js -t "getBonusInputs|checkForcedDifferentiation" --no-coverage
```

- [ ] **Step 4: Implement both functions**

```js
/**
 * Loads all QUARTERLY_BONUS_INPUTS rows for a quarter.
 * @returns {Array}  filtered QBI rows
 */
function getBonusInputs_(quarter, year) {
  var quarterKey = quarter + '-' + year;   // e.g. 'Q1-2026'
  return SheetDB.findRows('QUARTERLY_BONUS_INPUTS', function (row) {
    return row.quarter === quarterKey;
  });
}

/**
 * Returns true if >60% of the given inputs have tlRatingAvg > 4.0.
 * Warning flag only — does not block the run.
 * @param {string} raterName  Used for logging only
 * @param {Array}  inputs     QBI rows for this rater's reportees
 */
function checkForcedDifferentiation_(raterName, inputs) {
  if (!inputs || inputs.length === 0) return false;
  var aboveFour = inputs.filter(function (r) {
    return (Number(r.tlRatingAvg) || 0) > 4.0;
  }).length;
  return (aboveFour / inputs.length) > 0.60;
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
npx jest tests/quarterly-bonus.test.js -t "getBonusInputs|checkForcedDifferentiation" --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add QuarterlyBonusEngine.js tests/quarterly-bonus.test.js
git commit -m "feat: implement getBonusInputs_ and checkForcedDifferentiation_"
```

---

## Task 8: computeDesignerScores_()

Applies the 4-factor designer formula. PENDING if any required input is missing.

Designer formula:
```
composite = 0.30 x (clientFeedbackAvg / 5)
          + 0.30 x (1 - error_rate)
          + 0.25 x (tlRatingAvg / 5)
          + 0.15 x (pmRatingAvg / 5)
```

**Files:**
- Modify: `QuarterlyBonusEngine.js`
- Modify: `tests/quarterly-bonus.test.js`

- [ ] **Step 1: Write the failing tests**

```js
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
    var result = computeDesignerScores_('Q1', 2026, inputs, { 'Carol': 0 }, { 'Carol': 0 });

    expect(result['D003'].bonusINR).toBe(0);
    expect(result['D003'].status).toBe('Draft');  // zero hours is valid, just no payout
  });

  test('skips non-Designer roles', function () {
    var inputs = [
      makeQBIRow({ personId: 'TL001', role: 'Team Leader' })
    ];
    var result = computeDesignerScores_('Q1', 2026, inputs, {}, {});
    expect(result['TL001']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/quarterly-bonus.test.js -t "computeDesignerScores" --no-coverage
```

- [ ] **Step 3: Implement computeDesignerScores_()**

```js
/**
 * Scores every Designer row in inputs.
 * @param {string} quarter
 * @param {number} year
 * @param {Array}  inputs        All QBI rows for the quarter
 * @param {Object} errorRates    { normalisedName: rate } from getErrorRates_()
 * @param {Object} quarterHours  { normalisedName: hours } from getQuarterHours_()
 * @returns {Object}  { personId: { compositeScore, bonusINR, hours, status, pendingReason, ... } }
 */
function computeDesignerScores_(quarter, year, inputs, errorRates, quarterHours) {
  var rate    = ConfigService.getNumber('quarterly_bonus_rate_inr', 25);
  var results = {};

  inputs.forEach(function (row) {
    if (row.role !== 'Designer') return;

    var name  = normaliseDesignerName(row.personName || '');
    var hours = quarterHours[name] || 0;
    var eRate = errorRates[name]   || 0;

    var missing = [];
    if (!(Number(row.clientFeedbackAvg) > 0)) missing.push('client feedback');
    if (!(Number(row.tlRatingAvg)       > 0)) missing.push('TL rating');
    if (!(Number(row.pmRatingAvg)       > 0)) missing.push('PM rating');

    if (missing.length > 0) {
      results[row.personId] = {
        personId: row.personId, personName: row.personName, role: 'Designer',
        compositeScore: 0, bonusINR: 0, hours: hours,
        status: 'Pending', pendingReason: 'Missing: ' + missing.join(', ')
      };
      return;
    }

    var composite = 0.30 * (Number(row.clientFeedbackAvg) / 5)
                  + 0.30 * (1 - eRate)
                  + 0.25 * (Number(row.tlRatingAvg) / 5)
                  + 0.15 * (Number(row.pmRatingAvg) / 5);
    composite = Math.min(1, Math.max(0, composite));

    results[row.personId] = {
      personId: row.personId, personName: row.personName, role: 'Designer',
      compositeScore: composite,
      bonusINR: Math.round(hours * composite * rate),
      hours: hours,
      status: 'Draft',
      pendingReason: ''
    };
  });

  return results;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/quarterly-bonus.test.js -t "computeDesignerScores" --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add QuarterlyBonusEngine.js tests/quarterly-bonus.test.js
git commit -m "feat: implement computeDesignerScores_"
```

---

## Task 9: computeSupervisorScores_()

Scores TL and PM using the shared formula. Must be called after computeDesignerScores_().

TL/PM formula:
```
composite = 0.30 x (1 - client_qc_return_rate)
          + 0.40 x avg_designer_composite_score
          + 0.30 x (ceoRatingAvg / 5)

Hours base = sum of all reporting designers' design hours in the quarter.
```

**Files:**
- Modify: `QuarterlyBonusEngine.js`
- Modify: `tests/quarterly-bonus.test.js`

- [ ] **Step 1: Write the failing tests**

```js
describe('computeSupervisorScores_', function () {
  test('computes TL composite using designer average and CEO rating', function () {
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
    var tlInput = makeQBIRow({
      personId: 'TL002', personName: 'Priya', role: 'Team Leader', ceoRatingAvg: 0
    });
    var result = computeSupervisorScores_('Q1', 2026, [tlInput], {}, {}, {});

    expect(result['TL002'].status).toBe('Pending');
    expect(result['TL002'].pendingReason).toMatch(/CEO/i);
  });

  test('excludes PENDING designer scores from average', function () {
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
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/quarterly-bonus.test.js -t "computeSupervisorScores" --no-coverage
```

- [ ] **Step 3: Implement computeSupervisorScores_()**

```js
/**
 * Scores every Team Leader and Project Manager.
 * MUST be called after computeDesignerScores_().
 * @param {Object} designerScores  Output of computeDesignerScores_()
 * @param {Object} returnRates     Output of getClientQcReturnRates_() — keyed by supId
 * @param {Object} profileMap      From buildDesignerProfileMap_() — keyed by normalised name
 *                                 Each profile has: { supId, pmCode, designerId, role }
 * @returns {Object}  { personId: { compositeScore, bonusINR, hours, status, ... } }
 */
function computeSupervisorScores_(quarter, year, inputs, designerScores, returnRates, profileMap) {
  var rate     = ConfigService.getNumber('quarterly_bonus_rate_inr', 25);
  var results  = {};
  var supRoles = ['Team Leader', 'Project Manager'];

  inputs.forEach(function (row) {
    if (supRoles.indexOf(row.role) === -1) return;

    if (!(Number(row.ceoRatingAvg) > 0)) {
      results[row.personId] = {
        personId: row.personId, personName: row.personName, role: row.role,
        compositeScore: 0, bonusINR: 0, hours: 0,
        status: 'Pending', pendingReason: 'Missing: CEO rating'
      };
      return;
    }

    // Find designers reporting to this supervisor
    var reporteeScores = [];
    var totalHours     = 0;

    Object.keys(designerScores).forEach(function (dId) {
      var ds      = designerScores[dId];
      var profile = profileMap[normaliseDesignerName(ds.personName || '')];
      if (!profile) return;

      var reportsToThis = (profile.supId    === row.personId) ||
                          (profile.pmCode   === row.personId);
      if (!reportsToThis) return;

      // Only include Draft designer scores in the average
      if (ds.status === 'Draft') {
        reporteeScores.push(ds.compositeScore);
        totalHours += (ds.hours || 0);
      }
      // PENDING designers' hours still not counted (spec: hours base = reporting designers)
      // Note: if you want to include PENDING hours but not scores, adjust here.
    });

    var avgScore      = reporteeScores.length > 0
      ? reporteeScores.reduce(function (s, v) { return s + v; }, 0) / reporteeScores.length
      : 0;
    var qcReturnRate  = returnRates[row.personId] || 0;
    var composite     = 0.30 * (1 - qcReturnRate)
                      + 0.40 * avgScore
                      + 0.30 * (Number(row.ceoRatingAvg) / 5);
    composite = Math.min(1, Math.max(0, composite));

    results[row.personId] = {
      personId: row.personId, personName: row.personName, role: row.role,
      compositeScore: composite,
      bonusINR: Math.round(totalHours * composite * rate),
      hours: totalHours,
      status: 'Draft',
      pendingReason: ''
    };
  });

  return results;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/quarterly-bonus.test.js -t "computeSupervisorScores" --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add QuarterlyBonusEngine.js tests/quarterly-bonus.test.js
git commit -m "feat: implement computeSupervisorScores_"
```

---

## Task 10: writeBonusLedger_()

Clears existing BONUS_LEDGER rows for the quarter, then writes new computed rows.

**Files:**
- Modify: `QuarterlyBonusEngine.js`
- Modify: `tests/quarterly-bonus.test.js`

- [ ] **Step 1: Confirm BONUS_LEDGER alias fields**

Open `SheetDB.js` and find `SDB_SCHEMAS['BONUS_LEDGER']`. Note every column field name — you will write exactly those fields. Common fields: `bonusId`, `bonusType`, `calculationPeriod`, `bonusINR`, `feedbackScore`, `performanceTier`, `status`. Add any missing fields (`personId`, `personName`, `role`, `hours`, `notes`, `computedAt`) to the schema if they are absent.

- [ ] **Step 2: Write the failing test**

```js
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
```

- [ ] **Step 3: Run — expect FAIL**

```bash
npx jest tests/quarterly-bonus.test.js -t "writeBonusLedger" --no-coverage
```

- [ ] **Step 4: Implement writeBonusLedger_()**

```js
function toPerformanceTier_(score) {
  if (score >= 0.80) return 'HIGH';
  if (score >= 0.60) return 'AVERAGE';
  return 'NEEDS_IMPROVEMENT';
}

/**
 * Clears BONUS_LEDGER rows for this quarter+QUARTERLY type, then writes new rows.
 * Safe to re-run: existing rows are deleted first.
 */
function writeBonusLedger_(entries, quarter, year) {
  var periodKey = quarter + '-' + year;

  SheetDB.deleteWhere('BONUS_LEDGER', function (row) {
    return row.calculationPeriod === periodKey && row.bonusType === 'QUARTERLY';
  });

  var ts   = new Date();
  var rows = entries.map(function (e) {
    return {
      bonusType         : 'QUARTERLY',
      calculationPeriod : periodKey,
      personId          : e.personId,
      personName        : e.personName,
      role              : e.role,
      hours             : e.hours,
      feedbackScore     : e.compositeScore,
      performanceTier   : toPerformanceTier_(e.compositeScore),
      bonusINR          : e.bonusINR,
      status            : e.status || 'Draft',
      notes             : e.pendingReason || '',
      computedAt        : ts
    };
  });

  SheetDB.insertRows('BONUS_LEDGER', rows);
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
npx jest tests/quarterly-bonus.test.js -t "writeBonusLedger" --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add QuarterlyBonusEngine.js tests/quarterly-bonus.test.js
git commit -m "feat: implement writeBonusLedger_ with performanceTier"
```

---

## Task 11: runAnnualBonus()

December-only. Aggregates quarterly data per person using hours-weighted composite. Excludes PENDING quarters.

**Files:**
- Modify: `QuarterlyBonusEngine.js`
- Modify: `tests/quarterly-bonus.test.js`

- [ ] **Step 1: Write the failing tests**

```js
describe('runAnnualBonus', function () {
  test('aggregates hours and uses hours-weighted composite across 4 quarters', function () {
    SheetDB.findRows    = jest.fn(function (alias, fn) {
      var ledger = [
        { bonusType:'QUARTERLY', calculationPeriod:'Q1-2026', personId:'D001', personName:'Alice', role:'Designer', feedbackScore:0.80, hours:100, status:'Draft' },
        { bonusType:'QUARTERLY', calculationPeriod:'Q2-2026', personId:'D001', personName:'Alice', role:'Designer', feedbackScore:0.90, hours:120, status:'Draft' },
        { bonusType:'QUARTERLY', calculationPeriod:'Q3-2026', personId:'D001', personName:'Alice', role:'Designer', feedbackScore:0.70, hours:110, status:'Draft' },
        { bonusType:'QUARTERLY', calculationPeriod:'Q4-2026', personId:'D001', personName:'Alice', role:'Designer', feedbackScore:0.85, hours:130, status:'Draft' }
      ];
      return ledger.filter(fn);
    });
    SheetDB.deleteWhere = jest.fn();
    SheetDB.insertRows  = jest.fn();

    runAnnualBonus(2026);

    var rows = SheetDB.insertRows.mock.calls[0][1];
    var row  = rows.find(function (r) { return r.personId === 'D001'; });
    expect(row.hours).toBe(460);
    expect(row.bonusType).toBe('ANNUAL');

    var expectedComposite = (0.80*100 + 0.90*120 + 0.70*110 + 0.85*130) / 460;
    expect(row.feedbackScore).toBeCloseTo(expectedComposite, 3);
    expect(row.bonusINR).toBe(Math.round(460 * expectedComposite * 25));
  });

  test('excludes PENDING quarters and notes them', function () {
    SheetDB.findRows    = jest.fn(function (alias, fn) {
      var ledger = [
        { bonusType:'QUARTERLY', calculationPeriod:'Q1-2026', personId:'D002', personName:'Bob', role:'Designer', feedbackScore:0.80, hours:100, status:'Draft'   },
        { bonusType:'QUARTERLY', calculationPeriod:'Q2-2026', personId:'D002', personName:'Bob', role:'Designer', feedbackScore:0,    hours:0,   status:'Pending' }
      ];
      return ledger.filter(fn);
    });
    SheetDB.deleteWhere = jest.fn();
    SheetDB.insertRows  = jest.fn();

    runAnnualBonus(2026);

    var rows = SheetDB.insertRows.mock.calls[0][1];
    var row  = rows.find(function (r) { return r.personId === 'D002'; });
    expect(row.hours).toBe(100);   // Q2 excluded
    expect(row.notes).toMatch(/Q2/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/quarterly-bonus.test.js -t "runAnnualBonus" --no-coverage
```

- [ ] **Step 3: Implement runAnnualBonus()**

```js
/**
 * Computes annual bonuses for the full year.
 * Called automatically in December by runQuarterlyBonus().
 * Uses hours-weighted composite across included quarters.
 * @param {number} year  e.g. 2026
 */
function runAnnualBonus(year) {
  var rate    = ConfigService.getNumber('quarterly_bonus_rate_inr', 25);
  var periods = ['Q1-'+year, 'Q2-'+year, 'Q3-'+year, 'Q4-'+year];

  var qRows = SheetDB.findRows('BONUS_LEDGER', function (row) {
    return row.bonusType === 'QUARTERLY' &&
           periods.indexOf(row.calculationPeriod) !== -1;
  });

  // Group by personId
  var byPerson = {};
  qRows.forEach(function (row) {
    if (!byPerson[row.personId]) byPerson[row.personId] = [];
    byPerson[row.personId].push(row);
  });

  // Clear existing ANNUAL rows for this year
  SheetDB.deleteWhere('BONUS_LEDGER', function (row) {
    return row.bonusType === 'ANNUAL' && String(row.calculationPeriod) === String(year);
  });

  var ts         = new Date();
  var annualRows = [];

  Object.keys(byPerson).forEach(function (personId) {
    var rows     = byPerson[personId];
    var included = rows.filter(function (r) { return r.status !== 'Pending'; });
    var excluded = rows.filter(function (r) { return r.status === 'Pending'; });

    var totalHours    = 0;
    var weightedScore = 0;
    included.forEach(function (r) {
      totalHours    += (Number(r.hours)        || 0);
      weightedScore += (Number(r.feedbackScore) || 0) * (Number(r.hours) || 0);
    });

    var composite   = totalHours > 0 ? weightedScore / totalHours : 0;
    var excludeNote = excluded.length > 0
      ? 'Excluded PENDING quarters: ' + excluded.map(function (r) { return r.calculationPeriod; }).join(', ')
      : '';

    annualRows.push({
      bonusType         : 'ANNUAL',
      calculationPeriod : String(year),
      personId          : personId,
      personName        : rows[0].personName || '',
      role              : rows[0].role       || '',
      hours             : totalHours,
      feedbackScore     : composite,
      performanceTier   : toPerformanceTier_(composite),
      bonusINR          : Math.round(totalHours * composite * rate),
      status            : 'Draft',
      notes             : excludeNote,
      computedAt        : ts
    });
  });

  SheetDB.insertRows('BONUS_LEDGER', annualRows);
  Logger.log('[QuarterlyBonusEngine] Annual bonus ' + year + ': ' + annualRows.length + ' rows written.');
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/quarterly-bonus.test.js -t "runAnnualBonus" --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add QuarterlyBonusEngine.js tests/quarterly-bonus.test.js
git commit -m "feat: implement runAnnualBonus"
```

---

## Task 12: runQuarterlyBonus() — main orchestrator

Orchestrates all sub-functions. Calls runAnnualBonus automatically in December.

**Files:**
- Modify: `QuarterlyBonusEngine.js`
- Modify: `tests/quarterly-bonus.test.js`

- [ ] **Step 1: Write the integration test**

```js
describe('runQuarterlyBonus — integration', function () {
  test('end-to-end: computes Draft bonus for a designer with all inputs present', function () {
    var masterData = makeMasterSheet([
      makeMasterRow({ period: 'January 2026',  name: 'Alice', design: 100, rework: 10 }),
      makeMasterRow({ period: 'February 2026', name: 'Alice', design:  80, rework:  0 }),
      makeMasterRow({ period: 'March 2026',    name: 'Alice', design:  70, rework:  0 })
    ]);
    getMockSpreadsheet().setSheetData('MASTER_JOB_DATABASE', masterData);

    SheetDB.findRows = jest.fn(function (alias, fn) {
      if (alias === 'QUARTERLY_BONUS_INPUTS') {
        return [makeQBIRow({
          personId: 'D001', personName: 'Alice', role: 'Designer', quarter: 'Q1-2026',
          clientFeedbackAvg: 4.0, tlRatingAvg: 4.0, pmRatingAvg: 4.0
        })].filter(fn);
      }
      return [];
    });
    SheetDB.deleteWhere            = jest.fn();
    SheetDB.insertRows             = jest.fn();
    global.buildDesignerProfileMap_ = jest.fn(function () { return {}; });

    runQuarterlyBonus('Q1', 2026);

    var inserted = SheetDB.insertRows.mock.calls[0][1];
    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({ personId: 'D001', bonusType: 'QUARTERLY', status: 'Draft' })
    ]));
  });

  test('calls runAnnualBonus automatically when quarter is Q4', function () {
    // Stub everything to no-ops; just verify annual bonus is triggered.
    SheetDB.findRows             = jest.fn(function () { return []; });
    SheetDB.deleteWhere          = jest.fn();
    SheetDB.insertRows           = jest.fn();
    global.buildDesignerProfileMap_ = jest.fn(function () { return {}; });

    var annualSpy = jest.spyOn(global, 'runAnnualBonus');
    // runAnnualBonus may not be on global yet — if it fails, move runAnnualBonus spy setup earlier.

    runQuarterlyBonus('Q4', 2026);

    // Annual bonus called once with year=2026
    expect(SheetDB.insertRows).toHaveBeenCalledTimes(2); // quarterly + annual
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/quarterly-bonus.test.js -t "runQuarterlyBonus" --no-coverage
```

- [ ] **Step 3: Implement runQuarterlyBonus()**

```js
/**
 * Main entry point. Called from BLC Menu or directly.
 * Prompts for quarter and year when called interactively (no args).
 */
function runQuarterlyBonus(quarter, year) {
  var ui = getUiSafe_();

  if (!quarter || !year) {
    if (!ui) {
      Logger.log('[QuarterlyBonusEngine] runQuarterlyBonus requires quarter and year when called non-interactively.');
      return;
    }
    var qResp = ui.prompt('Quarterly Bonus', 'Enter quarter (Q1/Q2/Q3/Q4):', ui.ButtonSet.OK_CANCEL);
    if (qResp.getSelectedButton() !== ui.Button.OK) return;
    quarter = qResp.getResponseText().trim().toUpperCase();

    var yResp = ui.prompt('Quarterly Bonus', 'Enter year (e.g. 2026):', ui.ButtonSet.OK_CANCEL);
    if (yResp.getSelectedButton() !== ui.Button.OK) return;
    year = parseInt(yResp.getResponseText().trim(), 10);
  }

  if (!QB_QUARTERS[quarter]) {
    Logger.log('[QuarterlyBonusEngine] Invalid quarter: ' + quarter);
    if (ui) ui.alert('Invalid quarter: ' + quarter + '. Use Q1, Q2, Q3, or Q4.');
    return;
  }

  Logger.log('[QuarterlyBonusEngine] Starting ' + quarter + '-' + year + '...');

  var quarterHours = getQuarterHours_(quarter, year);
  var errorRates   = getErrorRates_(quarter, year);
  var returnRates  = getClientQcReturnRates_(quarter, year);
  var inputs       = getBonusInputs_(quarter, year);
  var profileMap   = buildDesignerProfileMap_();

  var designerResults   = computeDesignerScores_(quarter, year, inputs, errorRates, quarterHours);
  var supervisorResults = computeSupervisorScores_(quarter, year, inputs, designerResults, returnRates, profileMap);

  // Forced differentiation warnings (per spec: warning only, not a block)
  inputs.filter(function (r) {
    return r.role === 'Team Leader' || r.role === 'Project Manager';
  }).forEach(function (supRow) {
    var reporteeInputs = inputs.filter(function (r) {
      var profile = profileMap[normaliseDesignerName(r.personName || '')];
      return profile && (profile.supId === supRow.personId || profile.pmCode === supRow.personId);
    });
    if (checkForcedDifferentiation_(supRow.personName, reporteeInputs)) {
      Logger.log('[QuarterlyBonusEngine] FORCED DIFF WARNING: ' + supRow.personName +
                 ' rated >60% of their designers above 4.0 — please review.');
      if (ui) ui.alert('Warning: ' + supRow.personName +
                       ' has rated more than 60% of their designers above 4.0.\nPlease review differentiation before approving.');
    }
  });

  var allEntries = [];
  Object.keys(designerResults).forEach(function (id)   { allEntries.push(designerResults[id]);   });
  Object.keys(supervisorResults).forEach(function (id) { allEntries.push(supervisorResults[id]); });

  writeBonusLedger_(allEntries, quarter, year);

  if (quarter === 'Q4') {
    runAnnualBonus(year);
  }

  var pending = allEntries.filter(function (e) { return e.status === 'Pending'; }).length;
  var summary = quarter + '-' + year + ' complete. ' + allEntries.length + ' entries written. ' +
                pending + ' pending.';
  Logger.log('[QuarterlyBonusEngine] ' + summary);
  if (ui) ui.alert('Quarterly Bonus Run Complete', summary, ui.ButtonSet.OK);
}
```

- [ ] **Step 4: Run all quarterly-bonus tests — expect PASS**

```bash
npx jest tests/quarterly-bonus.test.js --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add QuarterlyBonusEngine.js tests/quarterly-bonus.test.js
git commit -m "feat: implement runQuarterlyBonus orchestrator"
```

---

## Task 13: previewQuarterlyBonus()

UI-only summary alert — shows what the run would produce without writing to BONUS_LEDGER.

**Files:**
- Modify: `QuarterlyBonusEngine.js`

No test needed (UI-only alert).

- [ ] **Step 1: Implement**

```js
/**
 * Shows a preview summary of the bonus run without writing any rows.
 * Prompts for quarter and year when called from the menu.
 */
function previewQuarterlyBonus(quarter, year) {
  var ui = getUiSafe_();
  if (!ui) return;

  if (!quarter || !year) {
    var qResp = ui.prompt('Preview Bonus', 'Enter quarter (Q1/Q2/Q3/Q4):', ui.ButtonSet.OK_CANCEL);
    if (qResp.getSelectedButton() !== ui.Button.OK) return;
    quarter = qResp.getResponseText().trim().toUpperCase();
    var yResp = ui.prompt('Preview Bonus', 'Enter year:', ui.ButtonSet.OK_CANCEL);
    if (yResp.getSelectedButton() !== ui.Button.OK) return;
    year = parseInt(yResp.getResponseText().trim(), 10);
  }

  var quarterHours    = getQuarterHours_(quarter, year);
  var errorRates      = getErrorRates_(quarter, year);
  var returnRates     = getClientQcReturnRates_(quarter, year);
  var inputs          = getBonusInputs_(quarter, year);
  var profileMap      = buildDesignerProfileMap_();
  var designerResults = computeDesignerScores_(quarter, year, inputs, errorRates, quarterHours);
  var supResults      = computeSupervisorScores_(quarter, year, inputs, designerResults, returnRates, profileMap);

  var all  = Object.keys(designerResults).map(function (id) { return designerResults[id]; })
             .concat(Object.keys(supResults).map(function (id) { return supResults[id]; }));

  var draft    = all.filter(function (e) { return e.status === 'Draft'; });
  var pending  = all.filter(function (e) { return e.status === 'Pending'; });
  var totalINR = draft.reduce(function (s, e) { return s + (e.bonusINR || 0); }, 0);

  var msg = 'PREVIEW — ' + quarter + '-' + year + '\n\n' +
            'Total staff: ' + all.length + '\n' +
            'Ready (Draft): ' + draft.length + '\n' +
            'Pending (missing inputs): ' + pending.length + '\n' +
            'Total bonus pool: Rs.' + totalINR.toLocaleString();

  if (pending.length > 0) {
    msg += '\n\nPending staff:\n' +
           pending.map(function (e) { return '  - ' + e.personName + ': ' + e.pendingReason; }).join('\n');
  }

  ui.alert('Quarterly Bonus Preview', msg, ui.ButtonSet.OK);
}
```

- [ ] **Step 2: Commit**

```bash
git add QuarterlyBonusEngine.js
git commit -m "feat: implement previewQuarterlyBonus"
```

---

## Task 14: sendBonusRatingReminders()

Sends portal links to raters. Phase 1: all emails go to blccanada2026@gmail.com with labels.

**Files:**
- Modify: `QuarterlyBonusEngine.js`

No automated test (GmailApp call — test manually in Apps Script).

- [ ] **Step 1: Confirm CONFIG key**

Ensure `portal_base_url` exists in CONFIG_MASTER with the deployed Apps Script web app URL.
Add it to the seed if missing:
```js
{ configKey: 'portal_base_url', configValue: 'https://script.google.com/macros/s/YOUR_DEPLOY_ID/exec', configGroup: 'SYSTEM' },
```

- [ ] **Step 2: Implement**

```js
/**
 * Sends quarterly rating reminder emails.
 * Phase 1 (bonus_links_send_direct=false): all to blccanada2026@gmail.com for manual forwarding.
 * Phase 2 (bonus_links_send_direct=true):  direct to each recipient.
 */
function sendBonusRatingReminders(quarter, year) {
  var sendDirect   = ConfigService.getBoolean('bonus_links_send_direct', false);
  var stagingEmail = ConfigService.get('payroll_from_email', 'blccanada2026@gmail.com');
  var baseUrl      = ConfigService.get('portal_base_url', '');
  var quarterKey   = quarter + '-' + year;

  function buildRatingUrl(params) {
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return baseUrl + '?' + qs;
  }

  function dispatchEmail(toEmail, subject, body, forLabel) {
    var actualTo  = sendDirect ? toEmail : stagingEmail;
    var fullBody  = sendDirect ? body : ('[FOR: ' + forLabel + ']\n\n' + body);
    GmailApp.sendEmail(actualTo, subject, fullBody);
  }

  // ── Client rating links (token-secured) ──────────────────────
  var clients = SheetDB.getAll('CLIENT_MASTER');
  clients.forEach(function (client) {
    if (!client.feedbackToken) return;
    var url  = buildRatingUrl({ page: 'client-rating', token: client.feedbackToken, quarter: quarterKey });
    var body = 'Dear ' + (client.billingContact || 'Client') + ',\n\n' +
               'Please rate the designers who worked on your projects this quarter (' + quarterKey + ').\n\n' +
               'Your rating link:\n' + url + '\n\n' +
               'This link is unique to your account. Please do not share it.\n\n' +
               'Thank you,\nBlue Lotus Consulting';
    dispatchEmail(
      client.feedbackEmail || '',
      'BLC Quarterly Rating — ' + quarterKey,
      body,
      (client.billingContact || '') + ' <' + (client.feedbackEmail || '') + '>'
    );
  });

  // ── Internal rater links (Google session auth) ────────────────
  var internalRaters = SheetDB.findRows('STAFF_ROSTER', function (r) {
    return r.status === 'ACTIVE' &&
           (r.role === 'Team Leader' || r.role === 'Project Manager' || r.role === 'CEO');
  });
  internalRaters.forEach(function (rater) {
    if (!rater.email) {
      Logger.log('[sendBonusRatingReminders] No email for: ' + rater.name);
      return;
    }
    var url  = buildRatingUrl({ page: 'rating', quarter: quarterKey });
    var body = 'Hi ' + rater.name + ',\n\n' +
               'Please submit your quarterly ratings for ' + quarterKey + '.\n\n' +
               'Rating portal:\n' + url + '\n\n' +
               'Sign in with your BLC Google account when prompted.\n\n' +
               'Thank you,\nBlue Lotus Consulting';
    dispatchEmail(
      rater.email,
      'BLC Quarterly Ratings — ' + quarterKey,
      body,
      rater.name + ' (' + rater.role + ') <' + rater.email + '>'
    );
  });

  Logger.log('[sendBonusRatingReminders] Done for ' + quarterKey +
             (sendDirect ? ' — direct' : ' — staging to ' + stagingEmail));
}
```

- [ ] **Step 3: Commit**

```bash
git add QuarterlyBonusEngine.js
git commit -m "feat: implement sendBonusRatingReminders with staged rollout"
```

---

## Task 15: Portal routing and data functions in Portalsecurity.js

**Files:**
- Modify: `Portalsecurity.js`

- [ ] **Step 1: Locate the routing block in doGetSecure()**

Open `Portalsecurity.js`. Find `doGetSecure()` (~line 711). Find the existing `if (page === ...)` chain.
The new `rating` and `client-rating` routes go before any existing role-specific routes.

- [ ] **Step 2: Add the two new routes**

```js
// ── Quarterly rating portal (TL, PM, CEO — Google session auth) ──
if (page === 'rating') {
  var ratingAuth    = authenticateInternalUser(e);
  var ratingAllowed = ['CEO', 'Team Leader', 'Project Manager'];
  if (!ratingAuth.authenticated || ratingAllowed.indexOf(ratingAuth.role) === -1) {
    return HtmlService.createHtmlOutput(
      '<h2>Access denied</h2><p>This portal requires a BLC Google account with a TL, PM, or CEO role.</p>'
    );
  }
  return HtmlService.createHtmlOutputFromFile('QuarterlyRating')
    .setTitle('BLC — Quarterly Ratings')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── Client quarterly rating (32-char token, no Google login) ─────
if (page === 'client-rating') {
  var clientRatingAuth = authenticateClient(e);
  if (!clientRatingAuth.authenticated) {
    return HtmlService.createHtmlOutput('<h2>Invalid or expired link.</h2>');
  }
  return HtmlService.createHtmlOutputFromFile('ClientRating')
    .setTitle('BLC — Client Quarterly Rating')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

- [ ] **Step 3: Add getQuarterlyRatingData()**

```js
/**
 * Called from QuarterlyRating.html via google.script.run.
 * Returns the list of staff this internal rater can rate.
 */
function getQuarterlyRatingData(quarterKey) {
  var auth = authenticateInternalUser();
  if (!auth.authenticated) return { error: 'Not authenticated' };

  var active = SheetDB.findRows('STAFF_ROSTER', function (r) { return r.status === 'ACTIVE'; });
  var reportees;

  if (auth.role === 'Team Leader') {
    reportees = active.filter(function (r) {
      return r.supId === auth.personId && r.role === 'Designer';
    });
  } else if (auth.role === 'Project Manager') {
    reportees = active.filter(function (r) {
      return r.pmCode === auth.personId && r.role === 'Designer';
    });
  } else if (auth.role === 'CEO') {
    reportees = active.filter(function (r) {
      return r.role === 'Team Leader' || r.role === 'Project Manager';
    });
  } else {
    return { error: 'Role not permitted to rate' };
  }

  var existing = SheetDB.findRows('QUARTERLY_BONUS_INPUTS', function (r) {
    return r.quarter === quarterKey && r.personId === auth.personId;
  });

  return {
    raterName  : auth.name,
    raterRole  : auth.role,
    quarterKey : quarterKey,
    reportees  : reportees.map(function (r) {
      return { personId: r.designerId, personName: r.name, role: r.role };
    }),
    existing   : existing
  };
}
```

- [ ] **Step 4: Add submitQuarterlyRating()**

```js
/**
 * Called from QuarterlyRating.html to save a completed rating submission.
 * Upserts one QBI row per ratee (one row per person per quarter).
 */
function submitQuarterlyRating(payload) {
  // payload: { quarterKey, rateeId, rateeName, rateeRole, scores[], strengthNote, improvementNote }
  var auth = authenticateInternalUser();
  if (!auth.authenticated) return { error: 'Not authenticated' };

  var fieldMap = {
    'Team Leader'     : 'tlRatingAvg',
    'Project Manager' : 'pmRatingAvg',
    'CEO'             : 'ceoRatingAvg'
  };
  var fieldToUpdate = fieldMap[auth.role];
  if (!fieldToUpdate) return { error: 'Role not permitted to rate' };

  var scores  = payload.scores || [];
  var avgScore = scores.length > 0
    ? scores.reduce(function (s, v) { return s + Number(v); }, 0) / scores.length
    : 0;

  var existing = SheetDB.findOne('QUARTERLY_BONUS_INPUTS', function (r) {
    return r.quarter === payload.quarterKey && r.personId === payload.rateeId;
  });

  if (existing) {
    var updates        = {};
    updates[fieldToUpdate] = avgScore;
    if (payload.strengthNote)    updates.strengthNote    = payload.strengthNote;
    if (payload.improvementNote) updates.improvementNote = payload.improvementNote;
    SheetDB.updateRow('QUARTERLY_BONUS_INPUTS', existing._rowIndex, updates);
  } else {
    var newRow         = {
      quarter     : payload.quarterKey,
      personId    : payload.rateeId,
      personName  : payload.rateeName,
      role        : payload.rateeRole,
      status      : 'Draft'
    };
    newRow[fieldToUpdate] = avgScore;
    if (payload.strengthNote)    newRow.strengthNote    = payload.strengthNote;
    if (payload.improvementNote) newRow.improvementNote = payload.improvementNote;
    SheetDB.insertRows('QUARTERLY_BONUS_INPUTS', [newRow]);
  }

  return { success: true };
}
```

- [ ] **Step 5: Commit**

```bash
git add Portalsecurity.js
git commit -m "feat: add quarterly rating routes and data functions to Portalsecurity"
```

---

## Task 16: QuarterlyRating.html portal form

Internal rater form — role-aware: TL/PM see 4 designer sub-scores + mandatory open-ended fields; CEO sees 4 TL/PM sub-scores + optional notes.

**Key security requirement:** All server data (personName, etc.) must be set via
`element.textContent`, never via string concatenation into `textContent` or `innerHTML`.
Build DOM nodes programmatically; never set `element.innerHTML = userDataString`.

**Files:**
- Create: `QuarterlyRating.html`

- [ ] **Step 1: Create the HTML shell with static layout**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BLC Quarterly Rating</title>
  <style>
    body        { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #333; }
    h1          { color: #2c5282; border-bottom: 2px solid #2c5282; padding-bottom: 10px; }
    .card       { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .score-row  { display: flex; align-items: center; margin: 10px 0; gap: 16px; }
    .score-label { flex: 1; font-size: 14px; }
    .stars      { display: flex; gap: 8px; }
    .star       { font-size: 24px; cursor: pointer; color: #cbd5e0; user-select: none; }
    .star.on    { color: #f6ad55; }
    label       { display: block; font-size: 13px; color: #718096; margin-top: 12px; }
    textarea    { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e0; border-radius: 4px; padding: 8px; min-height: 60px; margin-top: 4px; }
    button      { background: #2c5282; color: white; border: none; padding: 12px 24px; border-radius: 6px; cursor: pointer; font-size: 16px; margin-top: 16px; }
    button:hover { background: #2a4a7f; }
    .msg-ok     { color: green; font-weight: bold; margin-top: 10px; }
    .msg-err    { color: red;   font-weight: bold; margin-top: 10px; }
  </style>
</head>
<body>
  <h1>BLC Quarterly Rating</h1>
  <p id="loading">Loading your rating form...</p>
  <div id="main" style="display:none;">
    <p>Logged in as: <strong id="rater-info"></strong></p>
    <p>Quarter: <strong id="quarter-info"></strong></p>
    <div id="ratee-forms"></div>
    <button onclick="submitAll()">Submit All Ratings</button>
    <p id="status-msg"></p>
  </div>
  <script>
    // All user data is set via textContent only — never via innerHTML string concat.
    var QUARTER_KEY  = new URLSearchParams(window.location.search).get('quarter') || '';
    var raterRole    = '';
    var reportees    = [];
    var ratings      = {};  // { personId: { scores: [0,0,0,0], strengthNote: '', improvementNote: '' } }

    var SCORE_LABELS = {
      'Team Leader': [
        'QC Discipline & Error Ownership',
        'SOP Compliance & Process Discipline',
        'Productivity Consistency',
        'Learning Ability & Improvement Curve'
      ],
      'Project Manager': [
        'Ownership & Accountability',
        'Communication Within Team',
        'Attitude, Reliability & Culture Fit',
        'Consistency Under Pressure'
      ],
      'CEO': [
        'Team Development',
        'Client Relationship Management',
        'Delivery Consistency',
        'Escalation Handling'
      ]
    };

    google.script.run
      .withSuccessHandler(onDataLoaded)
      .withFailureHandler(function (err) {
        document.getElementById('loading').textContent = 'Error: ' + err.message;
      })
      .getQuarterlyRatingData(QUARTER_KEY);

    function onDataLoaded(data) {
      if (data.error) {
        document.getElementById('loading').textContent = data.error;
        return;
      }
      raterRole = data.raterRole;
      reportees = data.reportees;

      document.getElementById('rater-info').textContent   = data.raterName + ' (' + data.raterRole + ')';
      document.getElementById('quarter-info').textContent  = data.quarterKey;
      document.getElementById('loading').style.display    = 'none';
      document.getElementById('main').style.display       = 'block';
      renderForms();
    }

    function renderForms() {
      var container = document.getElementById('ratee-forms');
      var labels    = SCORE_LABELS[raterRole] || [];
      // Remove any previously rendered cards
      while (container.firstChild) { container.removeChild(container.firstChild); }

      reportees.forEach(function (ratee) {
        ratings[ratee.personId] = { scores: [0,0,0,0], strengthNote: '', improvementNote: '' };

        var card = document.createElement('div');
        card.className = 'card';

        // Heading — personName set via textContent (safe)
        var heading = document.createElement('h3');
        heading.textContent = ratee.personName + ' — ' + ratee.role;
        card.appendChild(heading);

        // Star score rows
        labels.forEach(function (labelText, idx) {
          var row = document.createElement('div');
          row.className = 'score-row';

          var lbl = document.createElement('span');
          lbl.className = 'score-label';
          lbl.textContent = labelText;   // static label text
          row.appendChild(lbl);

          var starsDiv = document.createElement('div');
          starsDiv.className = 'stars';
          starsDiv.id = 'stars-' + ratee.personId + '-' + idx;

          for (var n = 1; n <= 5; n++) {
            (function (starVal) {
              var star = document.createElement('span');
              star.className = 'star';
              star.textContent = '\u2605';   // filled star character
              star.setAttribute('data-ratee', ratee.personId);
              star.setAttribute('data-idx', String(idx));
              star.setAttribute('data-val', String(starVal));
              star.addEventListener('click', function () { setStar(this); });
              starsDiv.appendChild(star);
            })(n);
          }
          row.appendChild(starsDiv);
          card.appendChild(row);
        });

        // Text fields
        if (raterRole !== 'CEO') {
          appendTextarea(card, 'Biggest Strength *', 'strength-' + ratee.personId, function (v) {
            ratings[ratee.personId].strengthNote = v;
          });
          appendTextarea(card, 'Key Improvement Area *', 'improve-' + ratee.personId, function (v) {
            ratings[ratee.personId].improvementNote = v;
          });
        } else {
          appendTextarea(card, 'Supporting Notes (optional)', 'notes-' + ratee.personId, function (v) {
            ratings[ratee.personId].strengthNote = v;
          });
        }

        container.appendChild(card);
      });
    }

    function appendTextarea(parent, labelText, id, onInput) {
      var lbl = document.createElement('label');
      lbl.textContent = labelText;
      parent.appendChild(lbl);
      var ta = document.createElement('textarea');
      ta.id = id;
      ta.addEventListener('input', function () { onInput(this.value); });
      parent.appendChild(ta);
    }

    function setStar(starEl) {
      var rateeId = starEl.getAttribute('data-ratee');
      var idx     = parseInt(starEl.getAttribute('data-idx'), 10);
      var val     = parseInt(starEl.getAttribute('data-val'), 10);
      ratings[rateeId].scores[idx] = val;

      var starsDiv = document.getElementById('stars-' + rateeId + '-' + idx);
      var stars    = starsDiv.querySelectorAll('.star');
      for (var i = 0; i < stars.length; i++) {
        if (i < val) { stars[i].classList.add('on'); }
        else         { stars[i].classList.remove('on'); }
      }
    }

    function setStatus(text, isError) {
      var el = document.getElementById('status-msg');
      el.textContent = text;
      el.className   = isError ? 'msg-err' : 'msg-ok';
    }

    function submitAll() {
      // Validate completeness
      var incomplete = [];
      reportees.forEach(function (ratee) {
        var r = ratings[ratee.personId];
        var allScored = r.scores.every(function (s) { return s > 0; });
        var notesOk   = raterRole === 'CEO' || (r.strengthNote.trim() && r.improvementNote.trim());
        if (!allScored || !notesOk) incomplete.push(ratee.personName);
      });
      if (incomplete.length > 0) {
        setStatus('Please complete all scores and required notes for: ' + incomplete.join(', '), true);
        return;
      }

      setStatus('Submitting...', false);
      var total   = reportees.length;
      var done    = 0;
      var hadError = false;

      reportees.forEach(function (ratee) {
        var r = ratings[ratee.personId];
        google.script.run
          .withSuccessHandler(function () {
            done++;
            if (done === total && !hadError) setStatus('All ratings submitted. Thank you!', false);
          })
          .withFailureHandler(function (err) {
            hadError = true;
            setStatus('Error: ' + err.message, true);
          })
          .submitQuarterlyRating({
            quarterKey      : QUARTER_KEY,
            rateeId         : ratee.personId,
            rateeName       : ratee.personName,
            rateeRole       : ratee.role,
            scores          : r.scores,
            strengthNote    : r.strengthNote,
            improvementNote : r.improvementNote
          });
      });
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Create ClientRating.html**

Mirror the structure of QuarterlyRating.html but using token-auth and showing the 5 client sub-scores.
The five sub-score labels for clients:
```
1. Quality & Accuracy
2. Adherence to SOP
3. Turn Around Time & Reliability
4. Communication & Responsiveness
5. Overall Satisfaction
```

Use `google.script.run.getClientRatingData(QUARTER_KEY)` and `google.script.run.submitClientRating(payload)` (add those server-side functions to Portalsecurity.js following the same pattern as submitQuarterlyRating — writes `clientFeedbackAvg` to QBI rows).

- [ ] **Step 3: Commit**

```bash
git add QuarterlyRating.html ClientRating.html
git commit -m "feat: add QuarterlyRating and ClientRating HTML portal forms"
```

---

## Task 17: Final test run, BONUS_LEDGER schema update, and BLC Menu

**Files:**
- Modify: `Code.js` (BLC menu)
- Modify: `SheetDB.js` (extend BONUS_LEDGER schema if needed)

- [ ] **Step 1: Extend BONUS_LEDGER schema in SheetDB.js**

Check the current `SDB_SCHEMAS['BONUS_LEDGER']` column list. If any of these fields are missing, add them with the next available column index:
- `personId`, `personName`, `role`, `hours`, `notes`, `computedAt`

Keep indices in order. Do not renumber existing columns.

- [ ] **Step 2: Run the complete test suite**

```bash
npx jest --no-coverage
```

Expected: all existing tests (payroll, sop-integration, etc.) still pass, plus all quarterly-bonus tests.

- [ ] **Step 3: Add menu entries to Code.js**

Find the BLC Menu builder in `Code.js` (the `onOpen()` function or wherever the menu is constructed). Add:

```js
.addItem('Run Quarterly Bonus',     'runQuarterlyBonus')
.addItem('Preview Quarterly Bonus', 'previewQuarterlyBonus')
.addItem('Send Rating Reminders',   'sendBonusRatingReminders')
```

- [ ] **Step 4: Deploy and run bootstrap in Apps Script**

After pasting all files into the Apps Script editor:
1. Run `SheetDB.bootstrap()` once — creates the QUARTERLY_BONUS_INPUTS sheet tab.
2. Run `seedConfigMaster()` once — adds `bonus_links_send_direct` and `quarterly_bonus_rate_inr` keys.
3. Test `sendBonusRatingReminders('Q1', 2026)` in the script editor — verify one email per recipient arrives at blccanada2026@gmail.com with `[FOR: ...]` labels.

- [ ] **Step 5: Final commit**

```bash
git add Code.js SheetDB.js
git commit -m "feat: extend BONUS_LEDGER schema and add quarterly bonus BLC menu entries"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1.1 Designer formula (4 factors, weights 30/30/25/15) | Task 8 |
| §1.2 TL formula (3 factors, 30/40/30; hours = designer hours) | Task 9 |
| §1.3 PM formula (same as TL) | Task 9 |
| §1.4 Annual bonus (December, hours-weighted composite) | Task 11 |
| §2.1 QUARTERLY_BONUS_INPUTS schema (15 columns) | Task 1 |
| §2.2 BONUS_LEDGER fields used | Task 10, 17 |
| §3.1 Client rates designer — 5 sub-scores | Task 16 (ClientRating.html) |
| §3.2 TL rates designer — 4 sub-scores + open-ended | Tasks 15, 16 |
| §3.3 PM rates designer — 4 sub-scores + open-ended | Tasks 15, 16 |
| §3.4 CEO rates TL/PM — 4 sub-scores | Tasks 15, 16 |
| §4.3 Execution order: Designers first, then TL, then PM | Task 12 |
| §4.4 Status: Draft/Pending + pendingReason | Tasks 8, 9, 10 |
| §5 Staged rollout (bonus_links_send_direct config flag) | Tasks 2, 14 |
| §6 Error handling: PENDING rows written, re-run clears, zero hours | Tasks 8, 9, 10 |
| §7 Testing plan (unit + integration, TDD throughout) | Tasks 4–12 |

**Type consistency:** `compositeScore`, `bonusINR`, `personId`, `personName`, `status`, `pendingReason`, `hours` used consistently across Tasks 8–12. `toPerformanceTier_()` defined in Task 10, used in Tasks 10 and 11.

**Security:** No innerHTML with user-supplied data anywhere in HTML tasks. All dynamic values set via `textContent` or `setAttribute`. Server functions return plain objects, never HTML strings.
