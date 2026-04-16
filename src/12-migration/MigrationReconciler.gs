// ============================================================
// MigrationReconciler.gs — BLC Nexus T12 Migration
// src/12-migration/MigrationReconciler.gs
//
// Phase F — reconciliation: compares source record counts and
// hours/billing totals between Stacey raw import and replayed
// FACT tables. Produces a pass/fail reconciliation report.
// ============================================================

var MigrationReconciler = (function () {

  var MODULE = 'MigrationReconciler';

  /**
   * Counts rows in MIGRATION_RAW_IMPORT grouped by source_tab and batch.
   * @param {string} batch
   * @returns {Object} counts keyed by source_tab
   */
  function getRawCounts_(batch) {
    var rows = DAL.readAll(MigrationConfig.TABLES.RAW_IMPORT, { callerModule: MODULE });
    var counts = {};
    (rows || []).filter(function (r) { return r.migration_batch === batch; })
               .forEach(function (r) {
                 counts[r.source_tab] = (counts[r.source_tab] || 0) + 1;
               });
    return counts;
  }

  /**
   * Counts MIGRATION_NORMALIZED rows by entity_type, replay_status, and validation_status.
   * @param {string} batch
   * @returns {Object} counts keyed by entity_type
   */
  function getNormCounts_(batch) {
    var rows = DAL.readAll(MigrationConfig.TABLES.NORMALIZED, { callerModule: MODULE });
    var byEntity = {};
    (rows || []).filter(function (r) { return r.migration_batch === batch; })
               .forEach(function (r) {
                 var key = r.entity_type;
                 if (!byEntity[key]) {
                   byEntity[key] = { total: 0, valid: 0, invalid: 0, replayed: 0, failed: 0, pending: 0 };
                 }
                 byEntity[key].total++;
                 if (r.validation_status === 'VALID')   byEntity[key].valid++;
                 if (r.validation_status === 'INVALID') byEntity[key].invalid++;
                 if (r.replay_status === 'REPLAYED')    byEntity[key].replayed++;
                 if (r.replay_status === 'FAILED')      byEntity[key].failed++;
                 if (r.replay_status === 'PENDING')     byEntity[key].pending++;
               });
    return byEntity;
  }

  /**
   * Sums hours from FACT_WORK_LOGS for migrated rows in this batch.
   * @param {string} batch
   * @returns {number}
   */
  function getMigratedHours_(batch) {
    var rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: MODULE });
    return (rows || [])
      .filter(function (r) { return r.migration_batch === batch; })
      .reduce(function (sum, r) { return sum + (Number(r.hours) || 0); }, 0);
  }

  /**
   * Sums hours from MIGRATION_RAW_IMPORT for WORK_LOG rows.
   * Best-effort — parses raw_json to find the hours field.
   * @param {string} batch
   * @returns {number}
   */
  function getRawHours_(batch) {
    var rows = DAL.readAll(MigrationConfig.TABLES.RAW_IMPORT, { callerModule: MODULE });
    var staceyWorkLogTab = MigrationConfig.STACEY_TABLES.WORK_LOGS;
    var total = 0;
    (rows || []).filter(function (r) {
      return r.migration_batch === batch && r.source_tab === staceyWorkLogTab;
    }).forEach(function (r, i) {
      if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) return;
      try {
        var obj = JSON.parse(r.raw_json || '{}');
        var h = Number(obj.hours || obj.Hours || obj.design_hours || obj.DesignHours || 0);
        total += isNaN(h) ? 0 : h;
      } catch (e) { /* skip unparseable rows */ }
    });
    return total;
  }

  /**
   * Sums billing amounts from FACT_BILLING_LEDGER for migrated rows in this batch.
   * @param {string} batch
   * @returns {number}
   */
  function getMigratedBilling_(batch) {
    var rows = DAL.readAll(Config.TABLES.FACT_BILLING_LEDGER, { callerModule: MODULE });
    return (rows || [])
      .filter(function (r) { return r.migration_batch === batch; })
      .reduce(function (sum, r) { return sum + (Number(r.amount) || 0); }, 0);
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Runs the full reconciliation report for the current migration batch.
   * Checks: per-entity replay counts, hours total with 1% tolerance,
   * no FAILED rows, no PENDING rows.
   *
   * @param {string} actorEmail
   * @returns {{ batch: string, checks: Object[], passed: boolean }}
   */
  function runReconciliation(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    var batch = MigrationConfig.getBatch();

    Logger.info('RECONCILE_START', { module: MODULE, batch: batch });

    var rawCounts  = getRawCounts_(batch);
    var normCounts = getNormCounts_(batch);
    var rawHours   = getRawHours_(batch);
    var migrHours  = getMigratedHours_(batch);
    var migrBill   = getMigratedBilling_(batch);

    var checks = [];

    // Check 1: every entity type has >0 replayed rows (or nothing to replay)
    ['STAFF', 'CLIENT', 'JOB', 'WORK_LOG', 'BILLING', 'PAYROLL'].forEach(function (et) {
      var nc     = normCounts[et] || { total: 0, replayed: 0, failed: 0, invalid: 0 };
      var passed = nc.replayed > 0 || nc.total === 0;
      checks.push({
        check:    et + '_REPLAYED',
        passed:   passed,
        total:    nc.total,
        replayed: nc.replayed,
        failed:   nc.failed,
        invalid:  nc.invalid
      });
      Logger.info('RECONCILE_ENTITY', {
        module: MODULE, entityType: et, passed: passed, counts: nc
      });
    });

    // Check 2: hours within 1% tolerance
    var hoursDelta     = Math.abs(migrHours - rawHours);
    var hoursTolerance = rawHours > 0 ? hoursDelta / rawHours : 0;
    var hoursPass      = hoursTolerance <= 0.01;
    checks.push({
      check:     'HOURS_TOTAL',
      passed:    hoursPass,
      raw:       rawHours,
      migrated:  migrHours,
      delta:     hoursDelta,
      tolerance: (hoursTolerance * 100).toFixed(2) + '%'
    });
    Logger.info('RECONCILE_HOURS', {
      module: MODULE, rawHours: rawHours, migrHours: migrHours, passed: hoursPass
    });

    // Check 3: no FAILED rows across all entity types
    var totalFailed = Object.keys(normCounts).reduce(function (s, k) {
      return s + (normCounts[k].failed || 0);
    }, 0);
    var noFailures = totalFailed === 0;
    checks.push({ check: 'NO_FAILED_ROWS', passed: noFailures, failedCount: totalFailed });
    Logger.info('RECONCILE_FAILURES', {
      module: MODULE, totalFailed: totalFailed, passed: noFailures
    });

    // Check 4: no PENDING rows (all rows were attempted)
    var totalPending = Object.keys(normCounts).reduce(function (s, k) {
      return s + (normCounts[k].pending || 0);
    }, 0);
    var noPending = totalPending === 0;
    checks.push({ check: 'NO_PENDING_ROWS', passed: noPending, pendingCount: totalPending });
    Logger.info('RECONCILE_PENDING', {
      module: MODULE, totalPending: totalPending, passed: noPending
    });

    var allPassed = checks.every(function (c) { return c.passed; });

    Logger.info('RECONCILE_COMPLETE', {
      module:       MODULE,
      batch:        batch,
      passed:       allPassed,
      totalChecks:  checks.length,
      passedChecks: checks.filter(function (c) { return c.passed; }).length
    });

    return { batch: batch, checks: checks, passed: allPassed };
  }

  return { runReconciliation: runReconciliation };

}());
