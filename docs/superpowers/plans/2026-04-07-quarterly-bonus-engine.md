# Quarterly Bonus Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a quarterly performance bonus engine in blc-nexus that calculates `design_hours × composite_score × INR 25` per eligible designer/TL/PM and records the result in `FACT_PAYROLL_LEDGER` as a standalone report separate from payroll.

**Architecture:** Single `QuarterlyBonusEngine.gs` IIFE module (mirrors `PayrollEngine.gs`). Ratings entered via a new portal route backed by new `FACT_PERFORMANCE_RATINGS` table. Composite score = client feedback (30%) + QC error rate (40%) + internal ratings (30%).

**Tech Stack:** Google Apps Script (GAS), clasp for deployment, blc-nexus DAL/RBAC/Logger pattern, no external dependencies.

---

## Codebase Context

- **Working directory:** `/Users/rajnair/blc-nexus`
- **Deploy command:** `cd /Users/rajnair/blc-nexus && clasp push --force`
- **Script ID:** `1smkj0mmUqcWDDJPq-RUuVxRG4nE3TMKy4KrOIVUcdEN9lrFucL57aqAE`
- **All files are `.gs`** — GAS JavaScript. No `import`/`require`. Variables declared with `var`. Modules are IIFEs assigned to global `var`.
- **Load order matters:** Files prefixed `00-` load first. `QuarterlyBonusEngine.gs` goes in `src/10-payroll/` (same tier as PayrollEngine).
- **DAL pattern:** `DAL.readAll(Config.TABLES.X, { callerModule: 'Y', periodId: pid })` · `DAL.appendRow(Config.TABLES.X, rowObj, { callerModule: 'Y', periodId: pid })` · `DAL.readWhere(Config.TABLES.X, { field: val }, { periodId: pid })`
- **RBAC pattern:** `RBAC.enforcePermission(actor, RBAC.ACTIONS.X)` must be the FIRST call in every public function. `actor = RBAC.resolveActor(email)`.
- **Logger pattern:** `Logger.info('EVENT_KEY', { module: 'M', message: 'msg', ...fields })`
- **Idempotency:** `key = 'TYPE|personCode|periodId'` → check with `DAL.readWhere(FACT_PAYROLL_LEDGER, { idempotency_key: key }, { periodId: pid })` before writing.
- **Period IDs:** Monthly = `'YYYY-MM'` (e.g. `'2026-03'`). Quarterly = `'YYYY-Qn'` (e.g. `'2026-Q1'`). FACT tables partition on monthly period_id. FACT_PERFORMANCE_RATINGS uses quarterly period_id (no monthly partitioning — one tab per quarter).
- **ClientFeedback.getFeedbackSummary(periodId)** returns `{ designer_code: { avg_normalized: 0–100, response_count, client_codes[] } }`. Call once per monthly period_id, merge across 3 months.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/00-foundation/Config.gs` | Modify | Add `FACT_PERFORMANCE_RATINGS` to TABLES, `PERF_RATING` to ID_PREFIXES |
| `src/02-security/RBAC.gs` | Modify | Add `RATE_STAFF` action + permission matrix rows |
| `src/10-payroll/QuarterlyBonusEngine.gs` | Create | Full bonus calculation engine IIFE |
| `src/07-portal/PortalData.gs` | Modify | Add `getMyRatees()` + `submitRating()` |
| `src/07-portal/Portal.gs` | Modify | Add `portal_getMyRatees()` + `portal_submitRating()` |
| `src/07-portal/QuarterlyRating.html` | Create | Rating entry form (TL/PM/CEO) |

---

## Task 1: Add FACT_PERFORMANCE_RATINGS to Config.gs

**Files:**
- Modify: `src/00-foundation/Config.gs`

- [ ] **Step 1: Add table name to TABLES registry**

In `Config.gs`, find the line `FACT_SOP_SUBMISSIONS:'FACT_SOP_SUBMISSIONS',` (around line 189) and add directly after it:

```javascript
    FACT_PERFORMANCE_RATINGS: 'FACT_PERFORMANCE_RATINGS',  // quarterly TL/PM/CEO ratings
```

- [ ] **Step 2: Add PERF_RATING to ID_PREFIXES**

Find `FEEDBACK:   'FB',` (around line 291) and add after it:

```javascript
    PERF_RATING: 'PR',    // PR-202601-00001  (performance rating)
```

- [ ] **Step 3: Verify Config loads correctly**

Open the Apps Script editor, run any existing function (e.g. `portal_getViewData` in the console), and confirm no syntax errors are thrown. OR run `clasp push --force` and check the execution log shows no errors on load.

- [ ] **Step 4: Commit**

```bash
cd /Users/rajnair/blc-nexus
git add src/00-foundation/Config.gs
git commit -m "feat: add FACT_PERFORMANCE_RATINGS table + PR id prefix to Config"
```

---

## Task 2: Add RATE_STAFF action to RBAC.gs

**Files:**
- Modify: `src/02-security/RBAC.gs`

- [ ] **Step 1: Add RATE_STAFF to ACTIONS**

In `RBAC.gs`, find the `ADMIN_OVERRIDE` alias line in the ACTIONS block (around line 168) and add before the closing `};`:

```javascript
    // ── Performance ratings ──────────────────────────────────
    RATE_STAFF:         'RATE_STAFF',      // Submit quarterly performance ratings (TL, PM, CEO)
```

- [ ] **Step 2: Add RATE_STAFF row to every role in PERMISSION_MATRIX**

Every canonical role block needs `RATE_STAFF: true/false`. Locate each block and add the line. Rules:
- DESIGNER: `false` (designers don't rate others)
- TEAM_LEAD: `true` (rates their direct report designers)
- QC: `false`
- PM: `true` (rates their mapped designers)
- CEO: `true` (rates TLs and PMs)
- ADMIN: `false`
- SYSTEM: `true`
- CLIENT: `false`

For each role block in PERMISSION_MATRIX, add after `DATA_EXPORT: false/true`:

```javascript
      RATE_STAFF:      false,  // replace false/true per role above
```

- [ ] **Step 3: Verify no role is missing the new action**

After the edit, do a quick scan: every role block (DESIGNER, TEAM_LEAD, QC, PM, CEO, ADMIN, SYSTEM, CLIENT) must have `RATE_STAFF:` in it. The matrix must be complete — missing keys cause `hasPermission()` to return `undefined` (falsy) which silently denies instead of throwing.

- [ ] **Step 4: Commit**

```bash
cd /Users/rajnair/blc-nexus
git add src/02-security/RBAC.gs
git commit -m "feat: add RATE_STAFF action to RBAC for quarterly performance ratings"
```

---

## Task 3: Scaffold QuarterlyBonusEngine.gs

**Files:**
- Create: `src/10-payroll/QuarterlyBonusEngine.gs`

- [ ] **Step 1: Create the file with the full IIFE skeleton**

```javascript
// ============================================================
// QuarterlyBonusEngine.gs — BLC Nexus T10 Payroll
// src/10-payroll/QuarterlyBonusEngine.gs
//
// LOAD ORDER: T10. Loads after all T0–T9 files.
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1),
//               RBAC (T2), Logger (T3), ClientFeedback (T9)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Quarterly performance bonus for designers, TLs, PMs.   ║
// ║                                                         ║
// ║  Formula:                                               ║
// ║    composite = client(30%) + error(40%) + rating(30%)   ║
// ║    bonus_INR = design_hours × composite × INR 25        ║
// ║                                                         ║
// ║  Annual bonus = sum of Q1+Q2+Q3+Q4 amounts              ║
// ║                                                         ║
// ║  Entry points:                                          ║
// ║    runQuarterlyBonus(actorEmail, quarter, year)          ║
// ║    runAnnualBonus(actorEmail, year)                      ║
// ║    previewQuarterlyBonus(actorEmail, quarter, year)      ║
// ║                                                         ║
// ║  Permission: PAYROLL_RUN (CEO only)                     ║
// ║  Writes to: FACT_PAYROLL_LEDGER (separate from payroll) ║
// ╚══════════════════════════════════════════════════════════╝
//
// ELIGIBILITY:
//   Staff must have start_date ≥ 1 year ago, OR bonus_eligible=TRUE
//   (CEO override). active must be TRUE.
//
// IDEMPOTENCY:
//   Key: QUARTERLY_BONUS|{person_code}|{quarterPeriodId}
//        ANNUAL_BONUS|{person_code}|{year}
//   Safe to re-run — existing keys are skipped.
//
// CALL PATTERN:
//   QuarterlyBonusEngine.runQuarterlyBonus('raj@blc.ca', 'Q1', 2026);
//   QuarterlyBonusEngine.runAnnualBonus('raj@blc.ca', 2026);
// ============================================================

var QuarterlyBonusEngine = (function () {

  var MODULE                    = 'QuarterlyBonusEngine';
  var BONUS_INR_PER_HOUR        = 25;
  var WEIGHTS                   = { client: 0.30, error: 0.40, rating: 0.30 };
  var QUARTER_MONTHS            = {
    Q1: ['01', '02', '03'],
    Q2: ['04', '05', '06'],
    Q3: ['07', '08', '09'],
    Q4: ['10', '11', '12']
  };

  // ============================================================
  // SECTION 1: HELPERS
  // ============================================================

  /** Returns '2026-Q1' style string. */
  function quarterPeriodId_(quarter, year) {
    return String(year) + '-' + quarter;
  }

  /** Returns ['2026-01','2026-02','2026-03'] for Q1 2026. */
  function monthPeriodIds_(quarter, year) {
    var months = QUARTER_MONTHS[quarter];
    if (!months) throw new Error(MODULE + ': invalid quarter "' + quarter + '". Use Q1/Q2/Q3/Q4.');
    return months.map(function (m) { return String(year) + '-' + m; });
  }

  /**
   * Returns true if the staff member is eligible for a quarterly bonus.
   * Eligible when:
   *   a) start_date is ≥ 1 year before today, OR
   *   b) bonus_eligible = TRUE (CEO override)
   * AND active = TRUE.
   */
  function isEligible_(staffRow, today) {
    var active = String(staffRow.active || '').toUpperCase();
    if (active !== 'TRUE' && active !== 'YES' && active !== '1') return false;

    var override = String(staffRow.bonus_eligible || '').toUpperCase();
    if (override === 'TRUE') return true;

    var startStr = String(staffRow.start_date || '').slice(0, 10);
    if (!startStr) return false;

    var startDate    = new Date(startStr);
    var oneYearAgo   = new Date(today);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    return startDate <= oneYearAgo;
  }

  // ============================================================
  // SECTION 2: DATA GATHERING
  // ============================================================

  function aggregateQuarterHours_(quarter, year) { return {}; }   // Task 4
  function getQcErrorRates_(quarter, year)        { return {}; }   // Task 5
  function getClientScores_(quarter, year)        { return {}; }   // Task 6
  function getInternalRatings_(qPid)              { return {}; }   // Task 7

  // ============================================================
  // SECTION 3: SCORE COMPUTATION
  // ============================================================

  function computeCompositeScore_(clientScore, errorScore, ratingScore) { return 0; }  // Task 8

  // ============================================================
  // SECTION 4: BONUS ROWS
  // ============================================================

  function computeBonuses_(staffCache, hoursMap, errorRates, clientScores, ratings, qPid) { return []; }  // Task 8

  // ============================================================
  // SECTION 5: LEDGER
  // ============================================================

  function writeBonusLedger_(bonusRows, actorEmail, qPid) {}  // Task 9

  // ============================================================
  // SECTION 6: ANNUAL BONUS
  // ============================================================

  function runAnnualBonus_(actorEmail, year) {}  // Task 10

  // ============================================================
  // SECTION 7: STAFF CACHE (same pattern as PayrollEngine)
  // ============================================================

  function buildStaffCache_() {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') {
        Logger.warn('QB_NO_STAFF_TABLE', { module: MODULE, message: 'DIM_STAFF_ROSTER not found' });
        return {};
      }
      throw e;
    }
    var cache = {};
    for (var i = 0; i < rows.length; i++) {
      var row  = rows[i];
      var code = String(row.person_code || '').trim();
      if (!code) continue;
      cache[code] = {
        name:            String(row.name            || code),
        email:           String(row.email           || '').trim().toLowerCase(),
        role:            String(row.role            || '').toUpperCase().trim(),
        supervisor_code: String(row.supervisor_code || '').trim(),
        pm_code:         String(row.pm_code         || '').trim(),
        bonus_eligible:  String(row.bonus_eligible  || '').toUpperCase() === 'TRUE',
        active:          String(row.active          || ''),
        start_date:      String(row.start_date      || '')
      };
    }
    return cache;
  }

  // ============================================================
  // SECTION 8: PUBLIC ENTRY POINTS
  // ============================================================

  /**
   * Runs the quarterly bonus calculation and writes to FACT_PAYROLL_LEDGER.
   * CEO only.
   * @param {string} actorEmail
   * @param {string} quarter  'Q1'|'Q2'|'Q3'|'Q4'
   * @param {number} year     e.g. 2026
   * @returns {Object} { written, pending, skipped, quarterPeriodId }
   */
  function runQuarterlyBonus(actorEmail, quarter, year) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
    RBAC.enforceFinancialAccess(actor);

    Logger.info('QB_RUN_START', { module: MODULE,
      message: 'Quarterly bonus run started', quarter: quarter, year: year });

    var qPid       = quarterPeriodId_(quarter, year);
    var staffCache = buildStaffCache_();
    var hoursMap   = aggregateQuarterHours_(quarter, year);
    var errorRates = getQcErrorRates_(quarter, year);
    var clientScores = getClientScores_(quarter, year);
    var ratings    = getInternalRatings_(qPid);

    var bonusRows  = computeBonuses_(staffCache, hoursMap, errorRates, clientScores, ratings, qPid);
    writeBonusLedger_(bonusRows, actorEmail, qPid);

    var written = bonusRows.filter(function (r) { return r.status === 'CALCULATED'; }).length;
    var pending = bonusRows.filter(function (r) { return r.status === 'PENDING'; }).length;
    var skipped = bonusRows.filter(function (r) { return r.status === 'SKIPPED'; }).length;

    Logger.info('QB_RUN_COMPLETE', { module: MODULE,
      message: 'Quarterly bonus run complete',
      quarter: quarter, year: year, written: written, pending: pending, skipped: skipped });

    return { written: written, pending: pending, skipped: skipped, quarterPeriodId: qPid };
  }

  /**
   * Same as runQuarterlyBonus but writes nothing — returns preview data.
   * @param {string} actorEmail
   * @param {string} quarter
   * @param {number} year
   * @returns {Object[]} bonusRows array (not persisted)
   */
  function previewQuarterlyBonus(actorEmail, quarter, year) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);

    var qPid       = quarterPeriodId_(quarter, year);
    var staffCache = buildStaffCache_();
    var hoursMap   = aggregateQuarterHours_(quarter, year);
    var errorRates = getQcErrorRates_(quarter, year);
    var clientScores = getClientScores_(quarter, year);
    var ratings    = getInternalRatings_(qPid);

    return computeBonuses_(staffCache, hoursMap, errorRates, clientScores, ratings, qPid);
  }

  /**
   * Sums Q1–Q4 quarterly bonuses and writes a single ANNUAL_BONUS row per person.
   * @param {string} actorEmail
   * @param {number} year
   */
  function runAnnualBonus(actorEmail, year) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
    RBAC.enforceFinancialAccess(actor);
    runAnnualBonus_(actorEmail, year);
  }

  return {
    runQuarterlyBonus:    runQuarterlyBonus,
    previewQuarterlyBonus: previewQuarterlyBonus,
    runAnnualBonus:       runAnnualBonus
  };

}());
```

- [ ] **Step 2: Push to Apps Script and verify it loads**

```bash
cd /Users/rajnair/blc-nexus && clasp push --force
```

Open Apps Script editor → Run `portal_getViewData()` in the console. Expected: no `QuarterlyBonusEngine is not defined` errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/rajnair/blc-nexus
git add src/10-payroll/QuarterlyBonusEngine.gs
git commit -m "feat: scaffold QuarterlyBonusEngine IIFE with skeleton functions"
```

---

## Task 4: Implement aggregateQuarterHours_

**Files:**
- Modify: `src/10-payroll/QuarterlyBonusEngine.gs`

- [ ] **Step 1: Replace the stub in SECTION 2**

Replace `function aggregateQuarterHours_(quarter, year) { return {}; }` with:

```javascript
  /**
   * Sums design_hours from FACT_WORK_LOGS across all 3 months of the quarter.
   * Returns: { person_code: design_hours_total }
   * Only design hours (actor_role !== 'QC') are included.
   */
  function aggregateQuarterHours_(quarter, year) {
    var periodIds = monthPeriodIds_(quarter, year);
    var hoursMap  = {};

    for (var p = 0; p < periodIds.length; p++) {
      var rows;
      try {
        rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
          callerModule: MODULE,
          periodId:     periodIds[p]
        });
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') continue;
        throw e;
      }

      for (var i = 0; i < rows.length; i++) {
        var row   = rows[i];
        var code  = String(row.actor_code || '').trim();
        var role  = String(row.actor_role || '').toUpperCase();
        var hours = parseFloat(row.hours) || 0;
        if (!code || hours <= 0 || role === 'QC') continue;
        hoursMap[code] = (hoursMap[code] || 0) + hours;
      }
    }

    // Round to 2dp
    var codes = Object.keys(hoursMap);
    for (var j = 0; j < codes.length; j++) {
      hoursMap[codes[j]] = Math.round(hoursMap[codes[j]] * 100) / 100;
    }
    return hoursMap;
  }
```

- [ ] **Step 2: Manual smoke test in Apps Script console**

Add a temporary test function at the bottom of the file (outside the IIFE), push, run it, then delete it:

```javascript
function testAggregateHours() {
  var result = QuarterlyBonusEngine.previewQuarterlyBonus(
    'raj.nair@bluelotuscanada.ca', 'Q1', 2026
  );
  Logger.log(JSON.stringify(result));
}
```

Expected: runs without error (returns empty array since other data functions still stub). Delete `testAggregateHours` after verifying.

- [ ] **Step 3: Commit**

```bash
cd /Users/rajnair/blc-nexus
git add src/10-payroll/QuarterlyBonusEngine.gs
git commit -m "feat: implement aggregateQuarterHours_ — sums design hours across 3-month quarter"
```

---

## Task 5: Implement getQcErrorRates_

**Files:**
- Modify: `src/10-payroll/QuarterlyBonusEngine.gs`

- [ ] **Step 1: Replace the stub**

Replace `function getQcErrorRates_(quarter, year) { return {}; }` with:

```javascript
  /**
   * Computes QC error score per designer from VW_JOB_CURRENT_STATE.
   * error_rate  = count(jobs where rework_cycle > 0) / total_jobs
   * error_score = 1 - error_rate  (higher is better)
   * Returns: { person_code: error_score 0.0–1.0 }
   * Designers with 0 jobs → error_score = 1.0 (no rework = no errors).
   */
  function getQcErrorRates_(quarter, year) {
    var periodIds = monthPeriodIds_(quarter, year);
    // VW_JOB_CURRENT_STATE is NOT partitioned — read it all, filter by period_id
    var allRows;
    try {
      allRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return {};
      throw e;
    }

    // Build a set of qualifying period_ids for fast lookup
    var pidSet = {};
    for (var p = 0; p < periodIds.length; p++) { pidSet[periodIds[p]] = true; }

    // Accumulate per-designer: { total, reworkCount }
    var accum = {};
    for (var i = 0; i < allRows.length; i++) {
      var row    = allRows[i];
      var pid    = String(row.period_id || '').slice(0, 7);  // 'YYYY-MM'
      if (!pidSet[pid]) continue;

      var code   = String(row.allocated_to || '').trim();
      if (!code) continue;

      if (!accum[code]) accum[code] = { total: 0, reworkCount: 0 };
      accum[code].total++;
      if (parseInt(row.rework_cycle || 0, 10) > 0) accum[code].reworkCount++;
    }

    var result = {};
    var codes  = Object.keys(accum);
    for (var j = 0; j < codes.length; j++) {
      var a          = accum[codes[j]];
      var errorRate  = a.total > 0 ? a.reworkCount / a.total : 0;
      result[codes[j]] = Math.round((1 - errorRate) * 10000) / 10000;  // 4dp
    }
    return result;
  }
```

- [ ] **Step 2: Commit**

```bash
cd /Users/rajnair/blc-nexus
git add src/10-payroll/QuarterlyBonusEngine.gs
git commit -m "feat: implement getQcErrorRates_ — error score from VW_JOB_CURRENT_STATE rework_cycle"
```

---

## Task 6: Implement getClientScores_

**Files:**
- Modify: `src/10-payroll/QuarterlyBonusEngine.gs`

- [ ] **Step 1: Replace the stub**

Replace `function getClientScores_(quarter, year) { return {}; }` with:

```javascript
  /**
   * Aggregates client feedback scores across all 3 months of the quarter.
   * Uses ClientFeedback.getFeedbackSummary(periodId) per monthly period.
   * avg_normalized is 0–100; divides by 100 to get 0.0–1.0.
   * When a designer has responses in multiple months, takes the weighted
   * average (response_count-weighted).
   * Returns: { person_code: score 0.0–1.0 }
   */
  function getClientScores_(quarter, year) {
    var periodIds = monthPeriodIds_(quarter, year);
    // Accumulate weighted sum: { person_code: { weightedSum, totalCount } }
    var accum = {};

    for (var p = 0; p < periodIds.length; p++) {
      var summary;
      try {
        summary = ClientFeedback.getFeedbackSummary(periodIds[p]);
      } catch (e) {
        Logger.warn('QB_CLIENT_SCORE_READ_FAIL', { module: MODULE,
          message: 'Could not read client feedback for period',
          periodId: periodIds[p], error: e.message });
        continue;
      }

      var codes = Object.keys(summary || {});
      for (var i = 0; i < codes.length; i++) {
        var code  = codes[i];
        var entry = summary[code];
        var count = parseInt(entry.response_count || 0, 10);
        if (count <= 0) continue;
        var norm  = parseFloat(entry.avg_normalized || 0);
        if (!accum[code]) accum[code] = { weightedSum: 0, totalCount: 0 };
        accum[code].weightedSum += norm * count;
        accum[code].totalCount  += count;
      }
    }

    var result = {};
    var keys   = Object.keys(accum);
    for (var j = 0; j < keys.length; j++) {
      var a = accum[keys[j]];
      result[keys[j]] = a.totalCount > 0
        ? Math.round((a.weightedSum / a.totalCount) / 100 * 10000) / 10000
        : 0;
    }
    return result;
  }
```

- [ ] **Step 2: Commit**

```bash
cd /Users/rajnair/blc-nexus
git add src/10-payroll/QuarterlyBonusEngine.gs
git commit -m "feat: implement getClientScores_ — weighted client feedback avg across quarter"
```

---

## Task 7: Implement getInternalRatings_

**Files:**
- Modify: `src/10-payroll/QuarterlyBonusEngine.gs`

- [ ] **Step 1: Replace the stub**

Replace `function getInternalRatings_(qPid) { return {}; }` with:

```javascript
  /**
   * Reads FACT_PERFORMANCE_RATINGS for the quarter period_id.
   * For DESIGNER ratees: averages TL score + PM score (both required for CALCULATED status).
   * For TEAM_LEAD / PM ratees: uses CEO score directly.
   * avg_score_normalized is already 0.0–1.0 (stored pre-normalised by submitRating).
   * Returns: { person_code: score 0.0–1.0 | null }
   *   null = ratings incomplete (caller marks row as PENDING)
   */
  function getInternalRatings_(qPid) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_PERFORMANCE_RATINGS, {
        callerModule: MODULE,
        periodId:     qPid
      });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return {};
      throw e;
    }

    // Group ratings by ratee_code → { rater_role: avg_score_normalized }
    // Last write wins per rater_role (idempotency ensures one row per rater/ratee/period)
    var byRatee = {};
    for (var i = 0; i < rows.length; i++) {
      var row      = rows[i];
      var rateeCode = String(row.ratee_code  || '').trim();
      var raterRole = String(row.rater_role  || '').toUpperCase().trim();
      var score     = parseFloat(row.avg_score_normalized);
      if (!rateeCode || isNaN(score)) continue;
      if (!byRatee[rateeCode]) byRatee[rateeCode] = {};
      byRatee[rateeCode][raterRole] = score;
    }

    // Build staff cache to know each ratee's role (needed to determine expected raters)
    var staffCache = buildStaffCache_();

    var result = {};
    var ratees  = Object.keys(byRatee);
    for (var j = 0; j < ratees.length; j++) {
      var code   = ratees[j];
      var scores = byRatee[code];
      var staff  = staffCache[code];
      var role   = staff ? staff.role : '';

      if (role === 'DESIGNER') {
        // Requires both TL and PM scores
        var tlScore = scores['TEAM_LEAD'];
        var pmScore = scores['PM'];
        if (tlScore === undefined || pmScore === undefined) {
          result[code] = null;  // incomplete → PENDING
        } else {
          result[code] = Math.round(((tlScore + pmScore) / 2) * 10000) / 10000;
        }
      } else if (role === 'TEAM_LEAD' || role === 'PM') {
        // Only CEO rates TLs and PMs
        var ceoScore = scores['CEO'];
        result[code] = (ceoScore !== undefined) ? ceoScore : null;
      } else {
        // Other roles: use any available score or null
        result[code] = null;
      }
    }
    return result;
  }
```

- [ ] **Step 2: Commit**

```bash
cd /Users/rajnair/blc-nexus
git add src/10-payroll/QuarterlyBonusEngine.gs
git commit -m "feat: implement getInternalRatings_ — reads FACT_PERFORMANCE_RATINGS per quarter"
```

---

## Task 8: Implement computeCompositeScore_ and computeBonuses_

**Files:**
- Modify: `src/10-payroll/QuarterlyBonusEngine.gs`

- [ ] **Step 1: Replace computeCompositeScore_ stub**

Replace `function computeCompositeScore_(clientScore, errorScore, ratingScore) { return 0; }` with:

```javascript
  /**
   * Weighted composite: client(30%) + error(40%) + rating(30%)
   * All inputs are 0.0–1.0. Returns 0.0–1.0 rounded to 4dp.
   */
  function computeCompositeScore_(clientScore, errorScore, ratingScore) {
    var c = WEIGHTS.client * (parseFloat(clientScore) || 0);
    var e = WEIGHTS.error  * (parseFloat(errorScore)  || 0);
    var r = WEIGHTS.rating * (parseFloat(ratingScore) || 0);
    return Math.round((c + e + r) * 10000) / 10000;
  }
```

- [ ] **Step 2: Replace computeBonuses_ stub**

Replace `function computeBonuses_(staffCache, hoursMap, errorRates, clientScores, ratings, qPid) { return []; }` with:

```javascript
  /**
   * Builds an array of bonus row objects — one per eligible staff member.
   * status = 'CALCULATED' | 'PENDING' | 'SKIPPED'
   * PENDING: missing one or more inputs (ratings incomplete)
   * SKIPPED: not eligible (< 1 year, not active)
   */
  function computeBonuses_(staffCache, hoursMap, errorRates, clientScores, ratings, qPid) {
    var today = new Date();
    var rows  = [];
    var codes = Object.keys(staffCache);

    for (var i = 0; i < codes.length; i++) {
      var code  = codes[i];
      var staff = staffCache[code];

      if (!isEligible_(staff, today)) {
        rows.push({
          person_code:     code,
          name:            staff.name,
          role:            staff.role,
          quarter_period:  qPid,
          design_hours:    0,
          composite_score: 0,
          bonus_inr:       0,
          status:          'SKIPPED',
          pending_reason:  'not_eligible'
        });
        continue;
      }

      var designHours  = hoursMap[code]   || 0;
      var errorScore   = (errorRates[code]  !== undefined) ? errorRates[code]  : 1.0;
      var clientScore  = (clientScores[code] !== undefined) ? clientScores[code] : 0;
      var ratingScore  = ratings[code];  // null = incomplete

      // Internal rating is required — if missing, mark PENDING
      if (ratingScore === null || ratingScore === undefined) {
        rows.push({
          person_code:     code,
          name:            staff.name,
          role:            staff.role,
          quarter_period:  qPid,
          design_hours:    designHours,
          composite_score: 0,
          bonus_inr:       0,
          status:          'PENDING',
          pending_reason:  'ratings_incomplete'
        });
        continue;
      }

      var composite = computeCompositeScore_(clientScore, errorScore, ratingScore);
      var bonusInr  = Math.round(designHours * composite * BONUS_INR_PER_HOUR * 100) / 100;

      rows.push({
        person_code:     code,
        name:            staff.name,
        role:            staff.role,
        quarter_period:  qPid,
        design_hours:    designHours,
        client_score:    clientScore,
        error_score:     errorScore,
        rating_score:    ratingScore,
        composite_score: composite,
        bonus_inr:       bonusInr,
        status:          'CALCULATED'
      });
    }
    return rows;
  }
```

- [ ] **Step 3: Commit**

```bash
cd /Users/rajnair/blc-nexus
git add src/10-payroll/QuarterlyBonusEngine.gs
git commit -m "feat: implement computeCompositeScore_ and computeBonuses_ with eligibility gate"
```

---

## Task 9: Implement writeBonusLedger_ and complete runQuarterlyBonus

**Files:**
- Modify: `src/10-payroll/QuarterlyBonusEngine.gs`

- [ ] **Step 1: Replace writeBonusLedger_ stub**

Replace `function writeBonusLedger_(bonusRows, actorEmail, qPid) {}` with:

```javascript
  /**
   * Writes bonus rows to FACT_PAYROLL_LEDGER.
   * Skips SKIPPED rows entirely. Writes both CALCULATED and PENDING rows.
   * Idempotency key: QUARTERLY_BONUS|{person_code}|{quarterPeriodId}
   */
  function writeBonusLedger_(bonusRows, actorEmail, qPid) {
    DAL.ensurePartition(Config.TABLES.FACT_PAYROLL_LEDGER, qPid, MODULE);

    for (var i = 0; i < bonusRows.length; i++) {
      var row = bonusRows[i];
      if (row.status === 'SKIPPED') continue;

      var idempotencyKey = 'QUARTERLY_BONUS|' + row.person_code + '|' + qPid;

      // Check for existing row
      var existing;
      try {
        existing = DAL.readWhere(
          Config.TABLES.FACT_PAYROLL_LEDGER,
          { idempotency_key: idempotencyKey },
          { periodId: qPid }
        );
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') existing = [];
        else throw e;
      }

      if (existing.length > 0) {
        Logger.warn('QB_DUPLICATE_SKIP', { module: MODULE,
          message: 'Quarterly bonus already recorded — skipping',
          person_code: row.person_code, quarterPeriodId: qPid });
        continue;
      }

      var ledgerRow = {
        event_id:        Identifiers.generateId(),
        event_type:      'QUARTERLY_BONUS',
        person_code:     row.person_code,
        period_id:       qPid,
        amount_inr:      row.bonus_inr,
        design_hours:    row.design_hours,
        composite_score: row.composite_score,
        client_score:    row.client_score    || 0,
        error_score:     row.error_score     || 0,
        rating_score:    row.rating_score    || 0,
        status:          row.status,
        pending_reason:  row.pending_reason  || '',
        actor_email:     actorEmail,
        timestamp:       new Date().toISOString(),
        idempotency_key: idempotencyKey
      };

      DAL.appendRow(Config.TABLES.FACT_PAYROLL_LEDGER, ledgerRow, {
        callerModule: MODULE,
        periodId:     qPid
      });

      Logger.info('QB_ROW_WRITTEN', { module: MODULE,
        message: 'Quarterly bonus row written',
        person_code: row.person_code, status: row.status, amount_inr: row.bonus_inr });
    }
  }
```

- [ ] **Step 2: Push and do a first end-to-end dry run**

```bash
cd /Users/rajnair/blc-nexus && clasp push --force
```

In Apps Script console run:
```javascript
var preview = QuarterlyBonusEngine.previewQuarterlyBonus('raj.nair@bluelotuscanada.ca', 'Q1', 2026);
Logger.log(JSON.stringify(preview));
```
Expected: array of bonus row objects (may be empty if no data yet). No errors thrown.

- [ ] **Step 3: Commit**

```bash
cd /Users/rajnair/blc-nexus
git add src/10-payroll/QuarterlyBonusEngine.gs
git commit -m "feat: implement writeBonusLedger_ — idempotent writes to FACT_PAYROLL_LEDGER"
```

---

## Task 10: Implement runAnnualBonus_

**Files:**
- Modify: `src/10-payroll/QuarterlyBonusEngine.gs`

- [ ] **Step 1: Replace runAnnualBonus_ stub**

Replace `function runAnnualBonus_(actorEmail, year) {}` with:

```javascript
  /**
   * Reads all 4 quarterly bonus rows for the year and writes one
   * ANNUAL_BONUS row per person = sum of Q1+Q2+Q3+Q4 amounts.
   * Only CALCULATED rows are summed (PENDING rows excluded).
   * Idempotency key: ANNUAL_BONUS|{person_code}|{year}
   */
  function runAnnualBonus_(actorEmail, year) {
    var quarters  = ['Q1', 'Q2', 'Q3', 'Q4'];
    var yearPid   = String(year);

    // Gather all quarterly bonus rows across all quarters
    var totals = {};  // { person_code: total_inr }

    for (var q = 0; q < quarters.length; q++) {
      var qPid = quarterPeriodId_(quarters[q], year);
      var rows;
      try {
        rows = DAL.readWhere(
          Config.TABLES.FACT_PAYROLL_LEDGER,
          { event_type: 'QUARTERLY_BONUS', status: 'CALCULATED' },
          { periodId: qPid }
        );
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') continue;
        throw e;
      }

      for (var i = 0; i < rows.length; i++) {
        var row  = rows[i];
        var code = String(row.person_code || '').trim();
        var amt  = parseFloat(row.amount_inr) || 0;
        if (!code) continue;
        totals[code] = (totals[code] || 0) + amt;
      }
    }

    // Write one ANNUAL_BONUS row per person
    DAL.ensurePartition(Config.TABLES.FACT_PAYROLL_LEDGER, 'ANNUAL-' + yearPid, MODULE);

    var codes = Object.keys(totals);
    for (var j = 0; j < codes.length; j++) {
      var personCode    = codes[j];
      var annualAmount  = Math.round(totals[personCode] * 100) / 100;
      var idempotencyKey = 'ANNUAL_BONUS|' + personCode + '|' + yearPid;

      var existing;
      try {
        existing = DAL.readWhere(
          Config.TABLES.FACT_PAYROLL_LEDGER,
          { idempotency_key: idempotencyKey },
          { periodId: 'ANNUAL-' + yearPid }
        );
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') existing = [];
        else throw e;
      }
      if (existing.length > 0) {
        Logger.warn('QB_ANNUAL_DUPLICATE', { module: MODULE,
          message: 'Annual bonus already recorded', person_code: personCode, year: year });
        continue;
      }

      DAL.appendRow(Config.TABLES.FACT_PAYROLL_LEDGER, {
        event_id:        Identifiers.generateId(),
        event_type:      'ANNUAL_BONUS',
        person_code:     personCode,
        period_id:       'ANNUAL-' + yearPid,
        amount_inr:      annualAmount,
        status:          'CALCULATED',
        actor_email:     actorEmail,
        timestamp:       new Date().toISOString(),
        idempotency_key: idempotencyKey
      }, { callerModule: MODULE, periodId: 'ANNUAL-' + yearPid });

      Logger.info('QB_ANNUAL_WRITTEN', { module: MODULE,
        message: 'Annual bonus written',
        person_code: personCode, amount_inr: annualAmount, year: year });
    }
  }
```

- [ ] **Step 2: Commit**

```bash
cd /Users/rajnair/blc-nexus
git add src/10-payroll/QuarterlyBonusEngine.gs
git commit -m "feat: implement runAnnualBonus_ — sums Q1-Q4 QUARTERLY_BONUS rows per person"
```

---

## Task 11: Add rating functions to PortalData.gs

**Files:**
- Modify: `src/07-portal/PortalData.gs`

Add both functions at the end of the PortalData IIFE, just before the `return {` line.

- [ ] **Step 1: Add getMyRatees function**

```javascript
  /**
   * Returns the list of staff this rater should rate for the given quarter.
   * TEAM_LEAD → designers where supervisor_code = rater's person_code
   * PM        → designers where pm_code = rater's person_code
   * CEO       → all active TEAM_LEAD and PM staff
   *
   * @param {string} raterEmail
   * @param {string} quarterPeriodId  e.g. '2026-Q1'
   * @returns {string}  JSON array of ratee objects
   */
  function getMyRatees(raterEmail, quarterPeriodId) {
    var actor = RBAC.resolveActor(raterEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.RATE_STAFF);

    var allStaff;
    try {
      allStaff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return JSON.stringify([]);
      throw e;
    }

    var ratees = [];
    for (var i = 0; i < allStaff.length; i++) {
      var s      = allStaff[i];
      var active = String(s.active || '').toUpperCase();
      if (active !== 'TRUE' && active !== 'YES' && active !== '1') continue;

      var role = String(s.role || '').toUpperCase().trim();

      var include = false;
      if (actor.role === 'TEAM_LEAD' && String(s.supervisor_code || '').trim() === actor.personCode) {
        include = (role === 'DESIGNER');
      } else if (actor.role === 'PM' && String(s.pm_code || '').trim() === actor.personCode) {
        include = (role === 'DESIGNER');
      } else if (actor.role === 'CEO') {
        include = (role === 'TEAM_LEAD' || role === 'PM');
      }

      if (include) {
        ratees.push({
          person_code: String(s.person_code || ''),
          name:        String(s.name        || ''),
          role:        role
        });
      }
    }

    return JSON.stringify(ratees);
  }
```

- [ ] **Step 2: Add submitRating function**

```javascript
  /**
   * Validates and writes a performance rating to FACT_PERFORMANCE_RATINGS.
   * payload: { ratee_code, score_quality, score_sop, score_communication,
   *            score_initiative, quarter_period_id }
   * Each score is 1–5 stars. avg_score_normalized = (avg_raw - 1) / 4 → 0.0–1.0.
   * Idempotency: PERF_RATING|{rater_code}|{ratee_code}|{quarter_period_id}
   *
   * @param {string} raterEmail
   * @param {string} payloadJson  JSON-encoded payload
   * @returns {string}  JSON: { ok: true }
   */
  function submitRating(raterEmail, payloadJson) {
    var actor = RBAC.resolveActor(raterEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.RATE_STAFF);

    var payload;
    try {
      payload = JSON.parse(payloadJson);
    } catch (e) {
      throw new Error('PortalData.submitRating: invalid JSON payload.');
    }

    var rateeCode = String(payload.ratee_code         || '').trim();
    var qPid      = String(payload.quarter_period_id  || '').trim();
    var sq        = parseInt(payload.score_quality     || 0, 10);
    var ss        = parseInt(payload.score_sop         || 0, 10);
    var sc        = parseInt(payload.score_communication || 0, 10);
    var si        = parseInt(payload.score_initiative  || 0, 10);

    if (!rateeCode) throw new Error('PortalData.submitRating: ratee_code is required.');
    if (!qPid)      throw new Error('PortalData.submitRating: quarter_period_id is required.');
    [sq, ss, sc, si].forEach(function (v, idx) {
      if (v < 1 || v > 5) throw new Error('PortalData.submitRating: score ' + (idx+1) + ' must be 1–5, got ' + v + '.');
    });

    var avgRaw        = (sq + ss + sc + si) / 4;
    var avgNormalized = Math.round(((avgRaw - 1) / 4) * 10000) / 10000;  // 0.0–1.0

    var idempotencyKey = 'PERF_RATING|' + actor.personCode + '|' + rateeCode + '|' + qPid;

    DAL.ensurePartition(Config.TABLES.FACT_PERFORMANCE_RATINGS, qPid, 'PortalData');

    // Overwrite any existing rating (last write wins — rater can revise)
    // Remove old row first if it exists
    try {
      var existing = DAL.readWhere(
        Config.TABLES.FACT_PERFORMANCE_RATINGS,
        { idempotency_key: idempotencyKey },
        { periodId: qPid }
      );
      if (existing.length > 0) {
        Logger.info('QB_RATING_OVERWRITE', { module: 'PortalData',
          message: 'Overwriting existing rating', rater: actor.personCode, ratee: rateeCode });
        DAL.deleteWhere(
          Config.TABLES.FACT_PERFORMANCE_RATINGS,
          { idempotency_key: idempotencyKey },
          { periodId: qPid }
        );
      }
    } catch (e) {
      if (e.code !== 'SHEET_NOT_FOUND') throw e;
    }

    DAL.appendRow(Config.TABLES.FACT_PERFORMANCE_RATINGS, {
      rating_id:            Identifiers.generateId(),
      period_id:            qPid,
      ratee_code:           rateeCode,
      rater_code:           actor.personCode,
      rater_role:           actor.role,
      score_quality:        sq,
      score_sop:            ss,
      score_communication:  sc,
      score_initiative:     si,
      avg_score_normalized: avgNormalized,
      submitted_at:         new Date().toISOString(),
      idempotency_key:      idempotencyKey
    }, { callerModule: 'PortalData', periodId: qPid });

    Logger.info('QB_RATING_SUBMITTED', { module: 'PortalData',
      message: 'Performance rating submitted',
      rater: actor.personCode, ratee: rateeCode, period: qPid, avg: avgNormalized });

    return JSON.stringify({ ok: true });
  }
```

- [ ] **Step 3: Expose both functions in the PortalData return object**

Find the `return {` block at the bottom of `PortalData.gs` and add:

```javascript
    getMyRatees:   getMyRatees,
    submitRating:  submitRating,
```

- [ ] **Step 4: Check if DAL.deleteWhere exists**

Run `grep -n "deleteWhere" /Users/rajnair/blc-nexus/src/01-dal/DAL.gs`. If it does NOT exist, replace the delete block in `submitRating` with a simpler approach — skip deletion and just append (duplicates are resolved by taking the last row per rater/ratee in `getInternalRatings_`). Remove the `DAL.deleteWhere` call and the surrounding try/catch, keeping only the `Logger.info` for the overwrite message.

- [ ] **Step 5: Commit**

```bash
cd /Users/rajnair/blc-nexus
git add src/07-portal/PortalData.gs
git commit -m "feat: add getMyRatees and submitRating to PortalData for quarterly ratings portal"
```

---

## Task 12: Add portal endpoints to Portal.gs

**Files:**
- Modify: `src/07-portal/Portal.gs`

Add two new top-level functions at the end of `Portal.gs`.

- [ ] **Step 1: Add portal_getMyRatees**

```javascript
// ============================================================
// portal_getMyRatees — returns staff the current user should rate
// ============================================================

/**
 * Returns ratees for the current user and quarter.
 * TEAM_LEAD → their direct report designers
 * PM        → their mapped designers
 * CEO       → all TLs and PMs
 *
 * @param {string} quarterPeriodId  e.g. '2026-Q1'
 * @returns {string}  JSON array of { person_code, name, role }
 */
function portal_getMyRatees(quarterPeriodId) {
  var email = Session.getActiveUser().getEmail();
  return PortalData.getMyRatees(email, quarterPeriodId);
}
```

- [ ] **Step 2: Add portal_submitRating**

```javascript
// ============================================================
// portal_submitRating — submits a performance rating
// ============================================================

/**
 * Submits a quarterly performance rating for one ratee.
 * payload: { ratee_code, score_quality, score_sop,
 *            score_communication, score_initiative, quarter_period_id }
 *
 * @param {string} payloadJson  JSON-encoded payload
 * @returns {string}  JSON: { ok: true }
 */
function portal_submitRating(payloadJson) {
  var email = Session.getActiveUser().getEmail();
  return PortalData.submitRating(email, payloadJson);
}
```

- [ ] **Step 3: Push and verify**

```bash
cd /Users/rajnair/blc-nexus && clasp push --force
```

Open Apps Script console and run:
```javascript
Logger.log(portal_getMyRatees('2026-Q1'));
```
Expected: JSON array (empty if no staff with matching supervisor_code/pm_code yet). No errors thrown.

- [ ] **Step 4: Commit**

```bash
cd /Users/rajnair/blc-nexus
git add src/07-portal/Portal.gs
git commit -m "feat: add portal_getMyRatees and portal_submitRating endpoints to Portal.gs"
```

---

## Task 13: Create QuarterlyRating.html

**Files:**
- Create: `src/07-portal/QuarterlyRating.html`

- [ ] **Step 1: Create the file**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BLC Quarterly Ratings</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #333; }
    h1 { font-size: 1.4rem; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 32px; }
    .ratee-card { border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
    .ratee-name { font-size: 1.1rem; font-weight: bold; margin-bottom: 16px; }
    .category { margin-bottom: 12px; }
    .category label { display: block; font-size: 0.85rem; color: #555; margin-bottom: 4px; }
    .stars { display: flex; gap: 6px; }
    .stars input[type=radio] { display: none; }
    .stars label { font-size: 1.6rem; cursor: pointer; color: #ccc; user-select: none; }
    .stars input[type=radio]:checked ~ label,
    .stars label:hover,
    .stars label:hover ~ label { color: #ccc; }
    .stars label:hover,
    .stars input[type=radio]:checked + label { color: #f5a623; }
    /* RTL trick so CSS :checked ~ label highlights preceding stars */
    .stars { flex-direction: row-reverse; justify-content: flex-end; }
    .stars input[type=radio]:checked ~ label { color: #f5a623; }
    .submit-btn { margin-top: 16px; background: #1a73e8; color: #fff; border: none;
                  padding: 10px 24px; border-radius: 6px; cursor: pointer; font-size: 0.95rem; }
    .submit-btn:disabled { background: #aaa; cursor: default; }
    .status-msg { font-size: 0.85rem; margin-top: 8px; min-height: 20px; }
    .status-msg.ok  { color: #2e7d32; }
    .status-msg.err { color: #c62828; }
    #loading { color: #666; }
    #no-ratees { color: #666; }
  </style>
</head>
<body>
  <h1>Quarterly Performance Ratings</h1>
  <p class="subtitle" id="period-label">Loading...</p>
  <div id="loading">Loading your ratees...</div>
  <div id="no-ratees" style="display:none">No staff to rate this quarter.</div>
  <div id="cards"></div>

  <script>
    // ── Helpers ──────────────────────────────────────────────
    function esc(str) {
      var d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    function getQuarterPeriodId() {
      var params = new URLSearchParams(window.location.search);
      return params.get('period') || '';
    }

    var QUARTER_PERIOD_ID = getQuarterPeriodId();

    // ── Load ratees ──────────────────────────────────────────
    function loadRatees() {
      if (!QUARTER_PERIOD_ID) {
        document.getElementById('loading').textContent =
          'Missing ?period= parameter. Use e.g. ?period=2026-Q1';
        return;
      }
      document.getElementById('period-label').textContent =
        'Quarter: ' + QUARTER_PERIOD_ID;

      google.script.run
        .withSuccessHandler(function(json) {
          var ratees = JSON.parse(json);
          document.getElementById('loading').style.display = 'none';
          if (!ratees.length) {
            document.getElementById('no-ratees').style.display = 'block';
            return;
          }
          var container = document.getElementById('cards');
          ratees.forEach(function(r) { container.appendChild(buildCard(r)); });
        })
        .withFailureHandler(function(err) {
          document.getElementById('loading').textContent = 'Error: ' + err.message;
        })
        .portal_getMyRatees(QUARTER_PERIOD_ID);
    }

    // ── Build one ratee card ─────────────────────────────────
    var CATEGORIES = [
      { key: 'quality',       label: 'Quality & Accuracy' },
      { key: 'sop',           label: 'SOP Adherence' },
      { key: 'communication', label: 'Communication' },
      { key: 'initiative',    label: 'Initiative' }
    ];

    function buildCard(ratee) {
      var card = document.createElement('div');
      card.className = 'ratee-card';
      card.dataset.rateeCode = ratee.person_code;

      var nameEl = document.createElement('div');
      nameEl.className = 'ratee-name';
      nameEl.textContent = ratee.name + ' (' + ratee.role + ')';
      card.appendChild(nameEl);

      CATEGORIES.forEach(function(cat) {
        var catDiv = document.createElement('div');
        catDiv.className = 'category';

        var lbl = document.createElement('label');
        lbl.textContent = cat.label;
        catDiv.appendChild(lbl);

        var stars = document.createElement('div');
        stars.className = 'stars';

        // Stars 5 down to 1 (RTL flex trick)
        for (var v = 5; v >= 1; v--) {
          var radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = ratee.person_code + '_' + cat.key;
          radio.value = v;
          radio.id = ratee.person_code + '_' + cat.key + '_' + v;

          var starLbl = document.createElement('label');
          starLbl.htmlFor = radio.id;
          starLbl.textContent = '\u2605';

          stars.appendChild(radio);
          stars.appendChild(starLbl);
        }
        catDiv.appendChild(stars);
        card.appendChild(catDiv);
      });

      var btn = document.createElement('button');
      btn.className = 'submit-btn';
      btn.textContent = 'Submit Rating';
      btn.onclick = function() { submitCard(ratee.person_code, card, btn); };
      card.appendChild(btn);

      var msg = document.createElement('div');
      msg.className = 'status-msg';
      card.appendChild(msg);

      return card;
    }

    // ── Submit one card ──────────────────────────────────────
    function submitCard(rateeCode, card, btn) {
      var msg = card.querySelector('.status-msg');
      msg.textContent = '';
      msg.className = 'status-msg';

      function getScore(key) {
        var sel = card.querySelector('input[name="' + rateeCode + '_' + key + '"]:checked');
        return sel ? parseInt(sel.value, 10) : 0;
      }

      var scores = {
        score_quality:       getScore('quality'),
        score_sop:           getScore('sop'),
        score_communication: getScore('communication'),
        score_initiative:    getScore('initiative')
      };

      for (var k in scores) {
        if (scores[k] < 1) {
          msg.textContent = 'Please rate all 4 categories before submitting.';
          msg.className = 'status-msg err';
          return;
        }
      }

      scores.ratee_code = rateeCode;
      scores.quarter_period_id = QUARTER_PERIOD_ID;

      btn.disabled = true;
      btn.textContent = 'Saving...';

      google.script.run
        .withSuccessHandler(function() {
          msg.textContent = 'Rating saved.';
          msg.className = 'status-msg ok';
          btn.textContent = 'Saved \u2713';
        })
        .withFailureHandler(function(err) {
          msg.textContent = 'Error: ' + err.message;
          msg.className = 'status-msg err';
          btn.disabled = false;
          btn.textContent = 'Retry';
        })
        .portal_submitRating(JSON.stringify(scores));
    }

    window.addEventListener('load', loadRatees);
  </script>
</body>
</html>
```

- [ ] **Step 2: Push and manually test the rating form**

```bash
cd /Users/rajnair/blc-nexus && clasp push --force
```

Open the web app URL with `?period=2026-Q1` appended. Log in as a TL or PM user. Expected: ratees list loads, star ratings appear, submit button writes to FACT_PERFORMANCE_RATINGS.

- [ ] **Step 3: Commit**

```bash
cd /Users/rajnair/blc-nexus
git add src/07-portal/QuarterlyRating.html
git commit -m "feat: add QuarterlyRating.html — 4-category star rating form for TL/PM/CEO"
```

---

## Task 14: Full end-to-end test + final push

**Files:**
- No code changes — verification only

- [ ] **Step 1: Push everything**

```bash
cd /Users/rajnair/blc-nexus && clasp push --force
```

- [ ] **Step 2: Test previewQuarterlyBonus in Apps Script console**

```javascript
var preview = QuarterlyBonusEngine.previewQuarterlyBonus(
  'raj.nair@bluelotuscanada.ca', 'Q1', 2026
);
Logger.log('Total rows: ' + preview.length);
Logger.log('Sample: ' + JSON.stringify(preview[0]));
```

Expected: runs without error.

- [ ] **Step 3: Test runQuarterlyBonus in Apps Script console (writes to ledger)**

```javascript
var result = QuarterlyBonusEngine.runQuarterlyBonus(
  'raj.nair@bluelotuscanada.ca', 'Q1', 2026
);
Logger.log(JSON.stringify(result));
```

Expected: `{ written: N, pending: N, skipped: N, quarterPeriodId: '2026-Q1' }`.
Check the `FACT_PAYROLL_LEDGER|2026-Q1` sheet tab — rows with `event_type = QUARTERLY_BONUS` should be visible.

- [ ] **Step 4: Test re-run for idempotency**

Run `runQuarterlyBonus` a second time with the same quarter/year.
Expected: `{ written: 0, pending: 0, skipped: N }` — no new rows written (idempotency keys already exist).

- [ ] **Step 5: Test annual bonus**

```javascript
QuarterlyBonusEngine.runAnnualBonus('raj.nair@bluelotuscanada.ca', 2026);
```

Expected: runs without error. Check `FACT_PAYROLL_LEDGER|ANNUAL-2026` sheet tab.

- [ ] **Step 6: Commit final state**

```bash
cd /Users/rajnair/blc-nexus
git add -A
git commit -m "chore: quarterly bonus engine — full implementation complete"
```
