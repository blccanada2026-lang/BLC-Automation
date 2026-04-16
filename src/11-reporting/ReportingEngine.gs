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
// ║  Sheet clearing uses DAL.clearSheet() — A2 compliant.   ║
// ╚══════════════════════════════════════════════════════════╝

var ReportingEngine = (function () {

  var MODULE = 'ReportingEngine';

  // ============================================================
  // SECTION 1: UTILITIES
  // ============================================================

  /**
   * Scans for tab names matching BASE_TABLE|YYYY-MM, returns
   * period IDs sorted ascending (oldest first).
   *
   * @param {string} baseTableName  e.g. 'FACT_WORK_LOGS'
   * @returns {string[]}
   */
  function discoverPartitions_(baseTableName) {
    var sheets  = DAL.listSheets();
    var prefix  = baseTableName + '|';
    var periods = [];
    for (var i = 0; i < sheets.length; i++) {
      var name = sheets[i];
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
    var dashCleared = DAL.clearSheet(Config.TABLES.MART_DASHBOARD);
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
    var teamCleared = DAL.clearSheet(Config.TABLES.MART_TEAM_SUMMARY);
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
    var designerCleared = DAL.clearSheet(Config.TABLES.MART_DESIGNER_SUMMARY);
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
    var accountCleared = DAL.clearSheet(Config.TABLES.MART_ACCOUNT_SUMMARY);
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
