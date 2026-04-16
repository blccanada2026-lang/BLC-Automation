# ReportingEngine — MART Refresh & Looker Studio Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ReportingEngine — aggregates FACT/VW/MART data into four MART tables for Looker Studio, with CEO-triggered portal refresh and nightly time-based trigger.

**Architecture:** Single-pass aggregation — read MART_BILLING_SUMMARY, MART_PAYROLL_SUMMARY, VW_DESIGNER_WORKLOAD, VW_JOB_CURRENT_STATE, and FACT_WORK_LOGS partitions into in-memory maps, merge by period_id, clear and rewrite four MART tables in one batch each. CEO-only RBAC for portal; nightly trigger calls system entry point with no actor check.

**Tech Stack:** Google Apps Script (V8), DAL (appendRows, readAll), RBAC (resolveActor, enforcePermission, enforceFinancialAccess), HealthMonitor, SpreadsheetApp (clear exception — same as BillingEngine/PayrollEngine/EventReplayEngine).

---

## Files

| File | Change |
|---|---|
| `src/11-reporting/ReportingEngine.gs` | Create — all aggregation + MART write logic |
| `src/00-foundation/Config.gs` | Add 3 new MART table constants |
| `src/01-dal/DAL.gs` | Add write permissions for 3 new MART tables |
| `src/02-security/RBAC.gs` | Add MART_DASHBOARD to FINANCIAL_TABLES |
| `src/setup/SetupScript.gs` | Update MART_DASHBOARD schema; add 3 new MART schemas; add installReportingTrigger() |
| `src/07-portal/Portal.gs` | Add portal_refreshDashboard() after portal_rebuildViews |
| `src/07-portal/PortalView.html` | Add button, event listener, allBtns entry, visibility ×2, JS handler |
| `src/setup/TestRunner.gs` | Append testReportingEngine() at end of file |

---

## Task 1: Foundation — Config, DAL, RBAC, SetupScript

**Files:**
- Modify: `src/00-foundation/Config.gs`
- Modify: `src/01-dal/DAL.gs`
- Modify: `src/02-security/RBAC.gs`
- Modify: `src/setup/SetupScript.gs`

- [ ] **Step 1: Add 3 new MART constants to Config.gs**

  In `src/00-foundation/Config.gs`, find this block (around line 200):

  ```javascript
      MART_DASHBOARD:        'MART_DASHBOARD',
      MART_BILLING_SUMMARY:  'MART_BILLING_SUMMARY',
      MART_PAYROLL_SUMMARY:  'MART_PAYROLL_SUMMARY',
  ```

  Replace with:

  ```javascript
      MART_DASHBOARD:        'MART_DASHBOARD',
      MART_BILLING_SUMMARY:  'MART_BILLING_SUMMARY',
      MART_PAYROLL_SUMMARY:  'MART_PAYROLL_SUMMARY',
      MART_TEAM_SUMMARY:     'MART_TEAM_SUMMARY',
      MART_DESIGNER_SUMMARY: 'MART_DESIGNER_SUMMARY',
      MART_ACCOUNT_SUMMARY:  'MART_ACCOUNT_SUMMARY',
  ```

- [ ] **Step 2: Add write permissions to DAL.gs**

  In `src/01-dal/DAL.gs`, find this block (around line 116):

  ```javascript
      // ── Mart tables (reporting aggregates) ──────────────────
      'MART_DASHBOARD':        ['ReportingEngine', 'DashboardService'],
      'MART_BILLING_SUMMARY':  ['BillingEngine', 'ReportingEngine'],
      'MART_PAYROLL_SUMMARY':  ['PayrollEngine', 'ReportingEngine']
  ```

  Replace with:

  ```javascript
      // ── Mart tables (reporting aggregates) ──────────────────
      'MART_DASHBOARD':        ['ReportingEngine', 'DashboardService'],
      'MART_BILLING_SUMMARY':  ['BillingEngine', 'ReportingEngine'],
      'MART_PAYROLL_SUMMARY':  ['PayrollEngine', 'ReportingEngine'],
      'MART_TEAM_SUMMARY':     ['ReportingEngine'],
      'MART_DESIGNER_SUMMARY': ['ReportingEngine'],
      'MART_ACCOUNT_SUMMARY':  ['ReportingEngine'],
  ```

- [ ] **Step 3: Add MART_DASHBOARD to FINANCIAL_TABLES in RBAC.gs**

  In `src/02-security/RBAC.gs`, find this block (around line 435):

  ```javascript
    var FINANCIAL_TABLES = {
      'FACT_PAYROLL_LEDGER':   true,
      'FACT_BILLING_LEDGER':   true,
      'MART_PAYROLL_SUMMARY':  true,
      'MART_BILLING_SUMMARY':  true
    };
  ```

  Replace with:

  ```javascript
    var FINANCIAL_TABLES = {
      'FACT_PAYROLL_LEDGER':   true,
      'FACT_BILLING_LEDGER':   true,
      'MART_PAYROLL_SUMMARY':  true,
      'MART_BILLING_SUMMARY':  true,
      'MART_DASHBOARD':        true
    };
  ```

- [ ] **Step 4: Update MART_DASHBOARD schema and add 3 new schemas in SetupScript.gs**

  In `src/setup/SetupScript.gs`, find this block (around line 329):

  ```javascript
    'MART_DASHBOARD': [
      'period_id', 'metric_name', 'metric_value', 'updated_at'
    ],

    'MART_BILLING_SUMMARY': [
      'period_id', 'client_code', 'total_amount', 'currency', 'updated_at'
    ],

    // All amounts are INR. status = latest lifecycle event for this person.
    'MART_PAYROLL_SUMMARY': [
      'period_id', 'person_code',
      'design_pay', 'qc_pay', 'supervisor_bonus', 'total_pay',
      'status', 'updated_at'
    ]

  };
  ```

  Replace with:

  ```javascript
    // CEO only — full financial + operational summary per period
    'MART_DASHBOARD': [
      'period_id', 'total_revenue_cad', 'total_revenue_usd',
      'total_payroll_inr', 'design_hours', 'active_designers', 'updated_at'
    ],

    'MART_BILLING_SUMMARY': [
      'period_id', 'client_code', 'total_amount', 'currency', 'updated_at'
    ],

    // All amounts are INR. status = latest lifecycle event for this person.
    'MART_PAYROLL_SUMMARY': [
      'period_id', 'person_code',
      'design_pay', 'qc_pay', 'supervisor_bonus', 'total_pay',
      'status', 'updated_at'
    ],

    // PM + TL accessible — non-financial operational summary per period
    'MART_TEAM_SUMMARY': [
      'period_id', 'design_hours', 'active_designers', 'updated_at'
    ],

    // PM + TL accessible — hours per designer per period
    'MART_DESIGNER_SUMMARY': [
      'period_id', 'person_code', 'design_hours', 'updated_at'
    ],

    // PM + TL accessible — hours per client account per period
    'MART_ACCOUNT_SUMMARY': [
      'period_id', 'client_code', 'design_hours', 'updated_at'
    ]

  };
  ```

- [ ] **Step 5: Add installReportingTrigger() to SetupScript.gs**

  In `src/setup/SetupScript.gs`, go to the very end of the file (after `createFlatFactSheets` — currently line 1163). Append:

  ```javascript
  /**
   * Installs a nightly time-based trigger for ReportingEngine.
   * Run ONCE from Apps Script editor. CEO only.
   * Removes any existing refreshDashboardSystem trigger first to avoid duplicates.
   * Trigger fires between 2–3am daily.
   */
  function installReportingTrigger() {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'refreshDashboardSystem') {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    ScriptApp.newTrigger('refreshDashboardSystem')
      .timeBased()
      .everyDays(1)
      .atHour(2)
      .create();
    Logger.info('REPORTING_TRIGGER_INSTALLED', { module: 'SetupScript' });
  }
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add src/00-foundation/Config.gs src/01-dal/DAL.gs src/02-security/RBAC.gs src/setup/SetupScript.gs
  git commit -m "feat: add MART_TEAM_SUMMARY, MART_DESIGNER_SUMMARY, MART_ACCOUNT_SUMMARY schemas and MART_DASHBOARD to financial tables"
  ```

---

## Task 2: Create ReportingEngine.gs

**Files:**
- Create: `src/11-reporting/ReportingEngine.gs`

- [ ] **Step 1: Create the file**

  Create `src/11-reporting/ReportingEngine.gs` with this exact content:

  ```javascript
  // ============================================================
  // ReportingEngine.gs — BLC Nexus T11 Reporting
  // src/11-reporting/ReportingEngine.gs
  //
  // LOAD ORDER: T11. Loads after all T0–T10 files.
  // DEPENDENCIES: Config (T0), DAL (T1), RBAC (T2),
  //               Logger (T3), HealthMonitor (T3)
  //
  // ╔══════════════════════════════════════════════════════════╗
  // ║  Aggregates FACT/VW/MART data into four MART tables     ║
  // ║  for Looker Studio consumption.                         ║
  // ║                                                         ║
  // ║  Entry points:                                          ║
  // ║    refreshDashboard(actorEmail)  — CEO portal call      ║
  // ║    refreshDashboardSystem()      — nightly trigger call  ║
  // ║                                                         ║
  // ║  MART tables written:                                   ║
  // ║    MART_DASHBOARD       — CEO only (financial)          ║
  // ║    MART_TEAM_SUMMARY    — CEO + PM + TL                 ║
  // ║    MART_DESIGNER_SUMMARY — CEO + PM + TL               ║
  // ║    MART_ACCOUNT_SUMMARY  — CEO + PM + TL               ║
  // ║                                                         ║
  // ║  NOTE: Uses SpreadsheetApp.deleteRows() to clear sheets  ║
  // ║  — same known A2 exception as BillingEngine/Payroll/    ║
  // ║  EventReplayEngine. DAL has no clearSheet() method.     ║
  // ╚══════════════════════════════════════════════════════════╝

  var ReportingEngine = (function () {

    var MODULE = 'ReportingEngine';

    // ============================================================
    // SECTION 1: UTILITIES
    // ============================================================

    /**
     * Clears all data rows from a sheet (keeps header row 1).
     * Returns number of rows cleared, or 0 if sheet empty/missing.
     * NOTE: Uses SpreadsheetApp directly — known A2 exception.
     *
     * @param {string} sheetName
     * @returns {number}
     */
    function clearSheet_(sheetName) {
      var ss    = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet || sheet.getLastRow() <= 1) return 0;
      var rowCount = sheet.getLastRow() - 1;
      sheet.deleteRows(2, rowCount);
      return rowCount;
    }

    /**
     * Scans for tab names matching BASE_TABLE|YYYY-MM, returns
     * period IDs sorted ascending (oldest first).
     *
     * @param {string} baseTableName  e.g. 'FACT_WORK_LOGS'
     * @returns {string[]}
     */
    function discoverPartitions_(baseTableName) {
      var ss      = SpreadsheetApp.getActiveSpreadsheet();
      var sheets  = ss.getSheets();
      var prefix  = baseTableName + '|';
      var periods = [];
      for (var i = 0; i < sheets.length; i++) {
        var name = sheets[i].getName();
        if (name.indexOf(prefix) === 0) {
          var period = name.substring(prefix.length);
          if (/^\d{4}-\d{2}$/.test(period)) periods.push(period);
        }
      }
      periods.sort();
      return periods;
    }

    /** Returns Object.values() equivalent (GAS V8 compatible). */
    function objectValues_(obj) {
      var keys = Object.keys(obj);
      var vals = [];
      for (var i = 0; i < keys.length; i++) vals.push(obj[keys[i]]);
      return vals;
    }

    /** Builds a partial result object for early-return on quota cutoff. */
    function partialResult_(startMs) {
      return {
        periods:        0,
        mart_dashboard: { written: 0, cleared: 0 },
        mart_team:      { written: 0, cleared: 0 },
        mart_designer:  { written: 0, cleared: 0 },
        mart_account:   { written: 0, cleared: 0 },
        partial:        true,
        elapsed_ms:     Date.now() - startMs
      };
    }

    // ============================================================
    // SECTION 2: SOURCE MAP BUILDERS
    // ============================================================

    /**
     * Reads MART_BILLING_SUMMARY → map keyed by period_id.
     * { '2026-03': { total_revenue_cad: 45000, total_revenue_usd: 0 } }
     *
     * @returns {{ map: Object, partial: boolean }}
     */
    function buildRevenueMap_() {
      var rows = DAL.readAll(Config.TABLES.MART_BILLING_SUMMARY, { callerModule: MODULE });
      var map  = {};
      for (var i = 0; i < rows.length; i++) {
        if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
          Logger.warn('REPORTING_QUOTA_CUTOFF', { module: MODULE, section: 'revenueMap', processed: i });
          return { map: map, partial: true };
        }
        var period   = String(rows[i].period_id    || '').trim();
        var currency = String(rows[i].currency     || '').trim().toUpperCase();
        var amount   = parseFloat(rows[i].total_amount) || 0;
        if (!period) continue;
        if (!map[period]) map[period] = { total_revenue_cad: 0, total_revenue_usd: 0 };
        if (currency === 'CAD') map[period].total_revenue_cad += amount;
        if (currency === 'USD') map[period].total_revenue_usd += amount;
      }
      return { map: map, partial: false };
    }

    /**
     * Reads MART_PAYROLL_SUMMARY → map keyed by period_id.
     * { '2026-03': { total_payroll_inr: 280000, person_codes: { DS1: true, ... } } }
     *
     * @returns {{ map: Object, partial: boolean }}
     */
    function buildPayrollMap_() {
      var rows = DAL.readAll(Config.TABLES.MART_PAYROLL_SUMMARY, { callerModule: MODULE });
      var map  = {};
      for (var i = 0; i < rows.length; i++) {
        if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
          Logger.warn('REPORTING_QUOTA_CUTOFF', { module: MODULE, section: 'payrollMap', processed: i });
          return { map: map, partial: true };
        }
        var period = String(rows[i].period_id   || '').trim();
        var code   = String(rows[i].person_code || '').trim();
        var pay    = parseFloat(rows[i].total_pay) || 0;
        if (!period || !code) continue;
        if (!map[period]) map[period] = { total_payroll_inr: 0, person_codes: {} };
        map[period].total_payroll_inr      += pay;
        map[period].person_codes[code]      = true;
      }
      return { map: map, partial: false };
    }

    /**
     * Reads VW_DESIGNER_WORKLOAD → two maps.
     *   dMap:      keyed by 'person_code|period_id' → { period_id, person_code, design_hours }
     *   hoursMap:  keyed by period_id → total design hours for the period
     *
     * @returns {{ dMap: Object, hoursMap: Object, partial: boolean }}
     */
    function buildDesignerMap_() {
      var rows     = DAL.readAll(Config.TABLES.VW_DESIGNER_WORKLOAD, { callerModule: MODULE });
      var dMap     = {};
      var hoursMap = {};
      for (var i = 0; i < rows.length; i++) {
        if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
          Logger.warn('REPORTING_QUOTA_CUTOFF', { module: MODULE, section: 'designerMap', processed: i });
          return { dMap: dMap, hoursMap: hoursMap, partial: true };
        }
        var code   = String(rows[i].person_code || '').trim();
        var period = String(rows[i].period_id   || '').trim();
        var qty    = parseFloat(rows[i].total_quantity) || 0;
        if (!code || !period) continue;
        dMap[code + '|' + period] = { period_id: period, person_code: code, design_hours: qty };
        hoursMap[period]          = (hoursMap[period] || 0) + qty;
      }
      return { dMap: dMap, hoursMap: hoursMap, partial: false };
    }

    /**
     * Reads VW_JOB_CURRENT_STATE → map keyed by job_number.
     * { 'BLC-001': 'AXYZCO' }
     *
     * @returns {Object}
     */
    function buildJobClientMap_() {
      var rows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
      var map  = {};
      for (var i = 0; i < rows.length; i++) {
        var jn = String(rows[i].job_number  || '').trim();
        var cc = String(rows[i].client_code || '').trim();
        if (jn && cc) map[jn] = cc;
      }
      return map;
    }

    /**
     * Reads all FACT_WORK_LOGS partitions (oldest first).
     * Uses jobClientMap to resolve client_code from job_number.
     * Returns map keyed by 'client_code|period_id'.
     * { 'AXYZCO|2026-03': { client_code: 'AXYZCO', period_id: '2026-03', design_hours: 240 } }
     *
     * @param {Object} jobClientMap  job_number → client_code lookup
     * @returns {{ map: Object, partial: boolean }}
     */
    function buildAccountMap_(jobClientMap) {
      var periods = discoverPartitions_(Config.TABLES.FACT_WORK_LOGS);
      var map     = {};

      for (var p = 0; p < periods.length; p++) {
        var periodId = periods[p];
        var rows;
        try {
          rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
            callerModule: MODULE,
            periodId:     periodId
          });
        } catch (e) {
          if (e.code === 'SHEET_NOT_FOUND') {
            Logger.warn('REPORTING_PARTITION_SKIPPED', {
              module: MODULE, table: Config.TABLES.FACT_WORK_LOGS, periodId: periodId
            });
            continue;
          }
          throw e;
        }

        for (var i = 0; i < rows.length; i++) {
          if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
            Logger.warn('REPORTING_QUOTA_CUTOFF', {
              module: MODULE, section: 'accountMap', period: periodId, processed: i
            });
            return { map: map, partial: true };
          }
          var jn     = String(rows[i].job_number || '').trim();
          var qty    = parseFloat(rows[i].quantity) || 0;
          var client = jobClientMap[jn];
          if (!client) {
            Logger.warn('REPORTING_UNKNOWN_JOB', { module: MODULE, job_number: jn });
            continue;
          }
          var key = client + '|' + periodId;
          if (!map[key]) map[key] = { client_code: client, period_id: periodId, design_hours: 0 };
          map[key].design_hours += qty;
        }
      }
      return { map: map, partial: false };
    }

    // ============================================================
    // SECTION 3: MERGE AND WRITE
    // ============================================================

    /**
     * Merges all source maps by period_id and writes all four MART tables.
     * Returns written/cleared counts per table.
     *
     * @param {Object} revenueMap   period → { total_revenue_cad, total_revenue_usd }
     * @param {Object} payrollMap   period → { total_payroll_inr, person_codes }
     * @param {Object} hoursMap     period → total_design_hours
     * @param {Object} dMap         'person|period' → { period_id, person_code, design_hours }
     * @param {Object} accountMap   'client|period' → { client_code, period_id, design_hours }
     */
    function writeMarts_(revenueMap, payrollMap, hoursMap, dMap, accountMap) {
      var updatedAt = new Date().toISOString();

      // Collect all period IDs across all sources
      var allPeriods = {};
      [revenueMap, payrollMap, hoursMap].forEach(function (m) {
        Object.keys(m).forEach(function (k) { allPeriods[k] = true; });
      });
      var periods = Object.keys(allPeriods).sort();

      // ── MART_DASHBOARD (CEO only) ───────────────────────────
      var dashRows = [];
      for (var i = 0; i < periods.length; i++) {
        var pid   = periods[i];
        var rev   = revenueMap[pid] || { total_revenue_cad: 0, total_revenue_usd: 0 };
        var pay   = payrollMap[pid] || { total_payroll_inr: 0, person_codes: {} };
        var hours = hoursMap[pid]   || 0;
        dashRows.push({
          period_id:         pid,
          total_revenue_cad: Math.round(rev.total_revenue_cad * 100) / 100,
          total_revenue_usd: Math.round(rev.total_revenue_usd * 100) / 100,
          total_payroll_inr: Math.round(pay.total_payroll_inr * 100) / 100,
          design_hours:      Math.round(hours * 100) / 100,
          active_designers:  Object.keys(pay.person_codes).length,
          updated_at:        updatedAt
        });
      }
      var dashCleared = clearSheet_(Config.TABLES.MART_DASHBOARD);
      if (dashRows.length > 0) {
        DAL.appendRows(Config.TABLES.MART_DASHBOARD, dashRows, { callerModule: MODULE });
      }

      // ── MART_TEAM_SUMMARY (CEO + PM + TL) ──────────────────
      var teamRows = dashRows.map(function (r) {
        return {
          period_id:        r.period_id,
          design_hours:     r.design_hours,
          active_designers: r.active_designers,
          updated_at:       updatedAt
        };
      });
      var teamCleared = clearSheet_(Config.TABLES.MART_TEAM_SUMMARY);
      if (teamRows.length > 0) {
        DAL.appendRows(Config.TABLES.MART_TEAM_SUMMARY, teamRows, { callerModule: MODULE });
      }

      // ── MART_DESIGNER_SUMMARY (CEO + PM + TL) ──────────────
      var designerRows = objectValues_(dMap).map(function (dr) {
        return {
          period_id:    dr.period_id,
          person_code:  dr.person_code,
          design_hours: Math.round(dr.design_hours * 100) / 100,
          updated_at:   updatedAt
        };
      });
      var designerCleared = clearSheet_(Config.TABLES.MART_DESIGNER_SUMMARY);
      if (designerRows.length > 0) {
        DAL.appendRows(Config.TABLES.MART_DESIGNER_SUMMARY, designerRows, { callerModule: MODULE });
      }

      // ── MART_ACCOUNT_SUMMARY (CEO + PM + TL) ───────────────
      var accountRows = objectValues_(accountMap).map(function (ar) {
        return {
          period_id:    ar.period_id,
          client_code:  ar.client_code,
          design_hours: Math.round(ar.design_hours * 100) / 100,
          updated_at:   updatedAt
        };
      });
      var accountCleared = clearSheet_(Config.TABLES.MART_ACCOUNT_SUMMARY);
      if (accountRows.length > 0) {
        DAL.appendRows(Config.TABLES.MART_ACCOUNT_SUMMARY, accountRows, { callerModule: MODULE });
      }

      Logger.info('REPORTING_MARTS_WRITTEN', {
        module:   MODULE,
        periods:  periods.length,
        dashboard: dashRows.length,
        team:     teamRows.length,
        designer: designerRows.length,
        account:  accountRows.length
      });

      return {
        periods:        periods.length,
        mart_dashboard: { written: dashRows.length,    cleared: dashCleared },
        mart_team:      { written: teamRows.length,     cleared: teamCleared },
        mart_designer:  { written: designerRows.length, cleared: designerCleared },
        mart_account:   { written: accountRows.length,  cleared: accountCleared }
      };
    }

    // ============================================================
    // SECTION 4: MAIN ENTRY POINT (internal)
    // ============================================================

    /**
     * Orchestrates the full refresh: build all source maps, merge,
     * write all four MARTs. No RBAC check — callers handle that.
     *
     * @param {number} startMs  Date.now() from the public entry point
     * @returns {Object}  Full result shape
     */
    function refreshDashboard_(startMs) {
      Logger.info('REPORTING_STARTED', { module: MODULE });

      var revResult = buildRevenueMap_();
      if (revResult.partial) return partialResult_(startMs);

      var payResult = buildPayrollMap_();
      if (payResult.partial) return partialResult_(startMs);

      var dResult = buildDesignerMap_();
      if (dResult.partial) return partialResult_(startMs);

      var jobClientMap = buildJobClientMap_();

      var accResult = buildAccountMap_(jobClientMap);
      if (accResult.partial) return partialResult_(startMs);

      var written = writeMarts_(
        revResult.map,
        payResult.map,
        dResult.hoursMap,
        dResult.dMap,
        accResult.map
      );

      var elapsed = Date.now() - startMs;
      Logger.info('REPORTING_COMPLETE', {
        module:     MODULE,
        elapsed_ms: elapsed,
        periods:    written.periods,
        dashboard:  written.mart_dashboard.written
      });

      return {
        periods:        written.periods,
        mart_dashboard: written.mart_dashboard,
        mart_team:      written.mart_team,
        mart_designer:  written.mart_designer,
        mart_account:   written.mart_account,
        partial:        false,
        elapsed_ms:     elapsed
      };
    }

    // ============================================================
    // SECTION 5: PUBLIC API
    // ============================================================

    /**
     * CEO portal-triggered dashboard refresh. RBAC gated.
     *
     * @param {string} actorEmail
     * @returns {{ periods, mart_dashboard, mart_team, mart_designer, mart_account, partial, elapsed_ms }}
     */
    function refreshDashboard(actorEmail) {
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
      RBAC.enforceFinancialAccess(actor);
      return refreshDashboard_(Date.now());
    }

    /**
     * Nightly trigger dashboard refresh. No RBAC check.
     * Called by the top-level refreshDashboardSystem() trigger wrapper.
     *
     * @returns {{ periods, mart_dashboard, mart_team, mart_designer, mart_account, partial, elapsed_ms }}
     */
    function refreshDashboardSystem() {
      Logger.info('REPORTING_TRIGGER_FIRED', { module: MODULE });
      return refreshDashboard_(Date.now());
    }

    return {
      refreshDashboard:       refreshDashboard,
      refreshDashboardSystem: refreshDashboardSystem
    };

  })();

  // ============================================================
  // TOP-LEVEL TRIGGER ENTRY POINT
  // Apps Script triggers cannot point to IIFE methods.
  // This wrapper is the target for the nightly time-based trigger.
  // Install via installReportingTrigger() in SetupScript.gs.
  // ============================================================

  /**
   * Nightly trigger entry point. Do not call directly.
   */
  function refreshDashboardSystem() {
    ReportingEngine.refreshDashboardSystem();
  }
  ```

- [ ] **Step 2: Verify Config.TABLES constants are reachable**

  Run this grep to confirm the 3 new constants exist:

  ```bash
  grep -n "MART_TEAM_SUMMARY\|MART_DESIGNER_SUMMARY\|MART_ACCOUNT_SUMMARY" src/00-foundation/Config.gs
  ```

  Expected: 3 lines found. If missing, complete Task 1 Step 1 first.

- [ ] **Step 3: Commit**

  ```bash
  git add src/11-reporting/ReportingEngine.gs
  git commit -m "feat: add ReportingEngine — MART refresh for Looker Studio"
  ```

---

## Task 3: Add `portal_refreshDashboard` to Portal.gs

**Files:**
- Modify: `src/07-portal/Portal.gs`

- [ ] **Step 1: Add the portal function after `portal_rebuildViews`**

  In `src/07-portal/Portal.gs`, find the closing brace of `portal_rebuildViews` (currently around line 423):

  ```javascript
  function portal_rebuildViews() {
    var email  = Session.getActiveUser().getEmail();
    var result = EventReplayEngine.rebuildAllViews(email);
    return JSON.stringify(result);
  }
  ```

  Add the following block immediately after its closing brace:

  ```javascript
  // ============================================================
  // portal_refreshDashboard — CEO triggers Looker Studio MART refresh
  // ============================================================

  /**
   * Rebuilds MART_DASHBOARD, MART_TEAM_SUMMARY, MART_DESIGNER_SUMMARY,
   * and MART_ACCOUNT_SUMMARY from current FACT and VW data.
   * CEO only. Run on demand or triggered nightly automatically.
   *
   * NOTE: Portal button to be migrated to AdminConsole (T13) when built.
   *
   * @returns {string}  JSON: { periods, mart_dashboard, mart_team, mart_designer, mart_account, partial, elapsed_ms }
   */
  function portal_refreshDashboard() {
    var email  = Session.getActiveUser().getEmail();
    var result = ReportingEngine.refreshDashboard(email);
    return JSON.stringify(result);
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/07-portal/Portal.gs
  git commit -m "feat: add portal_refreshDashboard portal function"
  ```

---

## Task 4: Wire button, JS handler, and visibility in PortalView.html

**Files:**
- Modify: `src/07-portal/PortalView.html`

- [ ] **Step 1: Add the button HTML**

  Find the line with `btn-rebuild-views` (currently line 347):

  ```html
        <button class="btn-danger btn-sm" id="btn-rebuild-views" style="display:none">🔧 Rebuild Views</button>
  ```

  Insert the new button immediately after it:

  ```html
        <button class="btn-danger btn-sm" id="btn-rebuild-views" style="display:none">🔧 Rebuild Views</button>
        <button class="btn-muted btn-sm" id="btn-refresh-dashboard" style="display:none">🔄 Refresh Dashboard</button>
  ```

- [ ] **Step 2: Add the event listener**

  Find the line with the `btn-rebuild-views` listener (currently line 870):

  ```javascript
    document.getElementById('btn-rebuild-views').addEventListener('click',       rebuildViews);
  ```

  Add immediately after:

  ```javascript
    document.getElementById('btn-rebuild-views').addEventListener('click',       rebuildViews);
    document.getElementById('btn-refresh-dashboard').addEventListener('click',   refreshDashboard);
  ```

- [ ] **Step 3: Add to `allBtns` array**

  Find the `allBtns` array (currently around line 1190). Add `'btn-refresh-dashboard'` after `'btn-rebuild-views'`:

  ```javascript
    var allBtns = ['btn-create-job','btn-sbs-intake','btn-process-queue','btn-clients',
                   'btn-leader-dash','btn-staff-panel',
                   'btn-send-feedback','btn-send-ratings','btn-run-bonus',
                   'btn-run-quarterly-bonus','btn-run-annual-bonus','btn-rebuild-views',
                   'btn-refresh-dashboard',
                   'btn-approve-payroll','lbl-test-mode'];
  ```

- [ ] **Step 4: Add visibility in `renderPortal_`**

  Find the line setting `btn-rebuild-views` visibility in `renderPortal_` (currently around line 1211):

  ```javascript
    if (perms.canRunPayroll)   document.getElementById('btn-rebuild-views').style.display        = 'inline-block';
  ```

  Add immediately after:

  ```javascript
    if (perms.canRunPayroll)   document.getElementById('btn-rebuild-views').style.display        = 'inline-block';
    if (perms.canRunPayroll)   document.getElementById('btn-refresh-dashboard').style.display    = 'inline-block';
  ```

- [ ] **Step 5: Add visibility in `onDataLoaded`**

  Find the line setting `btn-rebuild-views` visibility in `onDataLoaded` (currently around line 954):

  ```javascript
    if (_data.perms.canRunPayroll)     document.getElementById('btn-rebuild-views').style.display          = 'inline-block';
  ```

  Add immediately after:

  ```javascript
    if (_data.perms.canRunPayroll)     document.getElementById('btn-rebuild-views').style.display          = 'inline-block';
    if (_data.perms.canRunPayroll)     document.getElementById('btn-refresh-dashboard').style.display      = 'inline-block';
  ```

- [ ] **Step 6: Add the `refreshDashboard()` JS function**

  Find the `rebuildViews()` function (currently around line 2482). Add the following function immediately after its closing brace:

  ```javascript
  function refreshDashboard() {
    if (!confirm(
      'Refresh Looker Studio dashboard data?\n\n' +
      'This rebuilds MART_DASHBOARD, MART_TEAM_SUMMARY,\n' +
      'MART_DESIGNER_SUMMARY, and MART_ACCOUNT_SUMMARY\n' +
      'from current FACT and VW data.\n\n' +
      'Run time: ~15\u201330 seconds depending on data volume.'
    )) return;

    showLoading(true);
    google.script.run
      .withSuccessHandler(function(json) {
        showLoading(false);
        try {
          var r   = JSON.parse(json);
          var sec = Math.round(r.elapsed_ms / 1000);
          if (r.partial) {
            showToast('Partial refresh \u2014 quota limit reached, re-run to complete.', 'warning');
          } else {
            showToast('Dashboard refreshed in ' + sec + 's \u2014 ' + r.periods + ' periods updated.', 'success');
          }
        } catch(e) { showToast('Dashboard refreshed.', 'success'); }
      })
      .withFailureHandler(function(err) {
        showLoading(false);
        showToast('Error: ' + (err.message || String(err)), 'error');
      })
      .portal_refreshDashboard();
  }
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add src/07-portal/PortalView.html
  git commit -m "feat: add Refresh Dashboard button and JS handler to portal"
  ```

---

## Task 5: Add `testReportingEngine()` to TestRunner.gs

**Files:**
- Modify: `src/setup/TestRunner.gs`

- [ ] **Step 1: Append the test function at the end of TestRunner.gs**

  Add the following at the very end of `src/setup/TestRunner.gs` (after the closing `}` of `testEventReplay`):

  ```javascript
  /**
   * Manual test: verifies refreshDashboard returns correct shape,
   * row counts match MART sheets, and run is idempotent.
   * Run from Apps Script editor.
   */
  function testReportingEngine() {
    header_('REPORTING ENGINE TEST');

    var email = Session.getActiveUser().getEmail();

    // First run — aggregates all source data into four MARTs
    var result1 = ReportingEngine.refreshDashboard(email);
    info_('First run: periods=' + result1.periods +
          ' dashboard=' + result1.mart_dashboard.written +
          ' team=' + result1.mart_team.written +
          ' designer=' + result1.mart_designer.written +
          ' account=' + result1.mart_account.written +
          ' partial=' + result1.partial +
          ' elapsed_ms=' + result1.elapsed_ms);

    var shapeOk = (
      typeof result1.periods                 === 'number'  &&
      typeof result1.mart_dashboard.written  === 'number'  &&
      typeof result1.mart_dashboard.cleared  === 'number'  &&
      typeof result1.mart_team.written       === 'number'  &&
      typeof result1.mart_designer.written   === 'number'  &&
      typeof result1.mart_account.written    === 'number'  &&
      typeof result1.partial                 === 'boolean' &&
      typeof result1.elapsed_ms              === 'number'
    );
    info_('Shape OK: ' + shapeOk);

    // Row count checks — each MART sheet must match .written
    var ss            = SpreadsheetApp.getActiveSpreadsheet();
    var dashSheet     = ss.getSheetByName('MART_DASHBOARD');
    var teamSheet     = ss.getSheetByName('MART_TEAM_SUMMARY');
    var designerSheet = ss.getSheetByName('MART_DESIGNER_SUMMARY');
    var accountSheet  = ss.getSheetByName('MART_ACCOUNT_SUMMARY');

    var dashRows     = dashSheet     ? Math.max(dashSheet.getLastRow()     - 1, 0) : 0;
    var teamRows     = teamSheet     ? Math.max(teamSheet.getLastRow()     - 1, 0) : 0;
    var designerRows = designerSheet ? Math.max(designerSheet.getLastRow() - 1, 0) : 0;
    var accountRows  = accountSheet  ? Math.max(accountSheet.getLastRow()  - 1, 0) : 0;

    var rowCountOk = (
      dashRows     === result1.mart_dashboard.written &&
      teamRows     === result1.mart_team.written      &&
      designerRows === result1.mart_designer.written  &&
      accountRows  === result1.mart_account.written
    );
    info_('Row count OK: ' + rowCountOk +
          ' (dashboard=' + dashRows + '/' + result1.mart_dashboard.written +
          ' team=' + teamRows + '/' + result1.mart_team.written +
          ' designer=' + designerRows + '/' + result1.mart_designer.written +
          ' account=' + accountRows + '/' + result1.mart_account.written + ')');

    // Second run — idempotent: row counts must be identical
    var result2 = ReportingEngine.refreshDashboard(email);
    info_('Second run: periods=' + result2.periods +
          ' dashboard=' + result2.mart_dashboard.written +
          ' designer=' + result2.mart_designer.written +
          ' account=' + result2.mart_account.written);

    var idempotent = (
      result2.mart_dashboard.written === result1.mart_dashboard.written &&
      result2.mart_team.written      === result1.mart_team.written      &&
      result2.mart_designer.written  === result1.mart_designer.written  &&
      result2.mart_account.written   === result1.mart_account.written
    );
    info_('Idempotent: ' + idempotent);

    var allOk = shapeOk && rowCountOk && idempotent && !result1.partial;
    if (allOk) {
      pass_('ReportingEngine shape, row counts, and idempotency checks passed');
    } else {
      fail_('ReportingEngine check failed — shapeOk=' + shapeOk +
            ' rowCountOk=' + rowCountOk +
            ' idempotent=' + idempotent +
            ' partial=' + result1.partial);
    }
    line_();
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/setup/TestRunner.gs
  git commit -m "feat: add testReportingEngine diagnostic to TestRunner"
  ```

---

## Task 6: Push, verify, and close out

- [ ] **Step 1: Push to Apps Script**

  ```bash
  clasp push
  ```

  Expected: `Pushed N files at HH:MM:SS` with no errors.

- [ ] **Step 2: Create the 3 new MART sheet tabs**

  In Apps Script editor, select `runSetupSchemas` → Run. This is idempotent — it skips existing tabs and creates only the missing ones.

  Expected log output includes:
  ```
  ✅ EXISTS   MART_DASHBOARD
  ✅ EXISTS   MART_BILLING_SUMMARY
  ✅ EXISTS   MART_PAYROLL_SUMMARY
  ✅ CREATED  MART_TEAM_SUMMARY
  ✅ CREATED  MART_DESIGNER_SUMMARY
  ✅ CREATED  MART_ACCOUNT_SUMMARY
  ```

- [ ] **Step 3: Run `testReportingEngine` in Apps Script editor**

  Open Apps Script editor → select `testReportingEngine` → Run.

  Expected output (with existing MART data):
  ```
  ═══════════════════════════════════════════
    REPORTING ENGINE TEST
  ═══════════════════════════════════════════
    ℹ️   First run: periods=N dashboard=N team=N designer=N account=0 partial=false elapsed_ms=XXXX
    ℹ️   Shape OK: true
    ℹ️   Row count OK: true (dashboard=N/N team=N/N designer=N/N account=0/0)
    ℹ️   Second run: periods=N dashboard=N designer=N account=0
    ℹ️   Idempotent: true
    ✅  ReportingEngine shape, row counts, and idempotency checks passed
  ```

  Note: `account=0` is expected until FACT_WORK_LOGS partitions exist (work logs are recorded per job, and those partitions may be empty).

- [ ] **Step 4: Smoke-test the portal button**

  Open the portal as CEO → confirm `🔄 Refresh Dashboard` button appears in the leader toolbar → click it → confirm dialog → confirm green toast shows `"Dashboard refreshed in Xs — N periods updated"`.

- [ ] **Step 5: Install the nightly trigger**

  In Apps Script editor, select `installReportingTrigger` → Run once. Verify trigger appears in **Triggers** panel (left sidebar → clock icon) pointing at `refreshDashboardSystem`, firing daily at 2am.

- [ ] **Step 6: Final commit — update CLAUDE.md**

  In `CLAUDE.md`, mark ReportingEngine complete:

  ```
  - [x] MART refresh / Looker Studio reporting layer — ReportingEngine, 4 MARTs, nightly trigger, portal button
  ```

  ```bash
  git add CLAUDE.md docs/superpowers/plans/2026-04-15-mart-refresh.md
  git commit -m "docs: mark MART refresh / Looker Studio reporting layer complete"
  ```
