// ============================================================
// PurgeTool.gs — BLC Nexus T12 Migration
// src/12-migration/PurgeTool.gs
//
// Identifies and (with explicit confirmation) removes test/dummy
// data from Nexus before production migration.
//
// SAFETY: dryRun=true by default in runPurge(). Pass false ONLY
// after reviewing the audit output and confirming with CEO.
// ============================================================

var PurgeTool = (function () {

  var MODULE = 'PurgeTool';

  var TEST_PREFIXES = ['TEST-', 'DUMMY-', 'SAMPLE-', 'DEV-', 'BLC-TEST'];
  var TEST_EMAIL_PATTERNS = ['@blctest.com', 'test-designer@', 'test-pm@'];

  function isTestId_(id) {
    if (!id) return false;
    var s = String(id).toUpperCase();
    return TEST_PREFIXES.some(function (p) { return s.indexOf(p) === 0; });
  }

  function isTestEmail_(email) {
    if (!email) return false;
    var s = String(email).toLowerCase();
    return TEST_EMAIL_PATTERNS.some(function (p) { return s.indexOf(p) !== -1; });
  }

  function scanTable_(tableName, idField) {
    var rows;
    try {
      rows = DAL.readAll(tableName, { callerModule: MODULE });
    } catch (e) {
      Logger.error('PURGE_SCAN_FAILED', { module: MODULE, table: tableName, error: e.message });
      return { tableName: tableName, rows: [], count: 0, error: e.message };
    }
    if (!rows || rows.length === 0) return { tableName: tableName, rows: [], count: 0 };
    var suspect = rows.filter(function (r) {
      return isTestId_(r[idField]) ||
             isTestEmail_(r.actor_email) ||
             isTestEmail_(r.submitter_email) ||
             isTestEmail_(r.email);
    });
    return { tableName: tableName, rows: suspect, count: suspect.length };
  }

  /**
   * Non-destructive audit: scans all Nexus tables for test/dummy data.
   * Run this FIRST and review output before calling runPurge().
   *
   * @param {string} actorEmail
   * @returns {{ total: number, results: Object[] }}
   */
  function runAudit(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    Logger.info('PURGE_AUDIT_START', { module: MODULE, message: 'Starting test data audit' });

    var targets = [
      { table: Config.TABLES.FACT_JOB_EVENTS,     id: 'job_number'  },
      { table: Config.TABLES.FACT_WORK_LOGS,       id: 'event_id'    },
      { table: Config.TABLES.FACT_BILLING_LEDGER,  id: 'billing_id'  },
      { table: Config.TABLES.FACT_PAYROLL_LEDGER,  id: 'payroll_id'  },
      { table: Config.TABLES.VW_JOB_CURRENT_STATE, id: 'job_number'  },
      { table: Config.TABLES.STG_PROCESSING_QUEUE, id: 'queue_id'    },
      { table: Config.TABLES.STG_RAW_INTAKE,       id: 'intake_id'   },
      { table: Config.TABLES.DIM_STAFF_ROSTER,     id: 'person_code' },
      { table: Config.TABLES.DIM_CLIENT_MASTER,    id: 'client_code' }
    ];

    var results = [];
    targets.forEach(function (t) {
      var scan = scanTable_(t.table, t.id);
      results.push(scan);
      Logger.info('PURGE_AUDIT_TABLE', { module: MODULE, table: t.table, suspects: scan.count });
      Logger.info('PURGE_AUDIT_TABLE_RESULT', { module: MODULE, table: t.table, suspects: scan.count, status: scan.count > 0 ? 'WARN' : 'OK' });
      if (scan.count > 0) {
        scan.rows.forEach(function (r) {
          Logger.info('PURGE_AUDIT_ROW', { module: MODULE, table: t.table, id: r[t.id] || r.event_id || r.queue_id || '?' });
        });
      }
    });

    var totalSuspect = results.reduce(function (s, r) { return s + r.count; }, 0);
    Logger.info('PURGE_AUDIT_SUMMARY', { module: MODULE, totalSuspect: totalSuspect });
    Logger.info('PURGE_AUDIT_NEXT_STEP', { module: MODULE, message: 'Review results above, then call PurgeTool.runPurge(email, false) to execute.' });

    return { total: totalSuspect, results: results };
  }

  /**
   * Tags FACT test rows as PURGED and marks STG test rows PURGED.
   * FACT tables are append-only — rows are tagged, not hard-deleted.
   *
   * @param {string}  actorEmail
   * @param {boolean} dryRun — pass false to execute; default true (safe)
   * @returns {{ tagged: number, deleted: number }}
   */
  function runPurge(actorEmail, dryRun) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    if (dryRun !== false) {
      Logger.warn('PURGE_DRY_RUN', { module: MODULE,
        message: 'dryRun=true — no data will be deleted. Pass false to execute.' });
      return runAudit(actorEmail);
    }

    Logger.info('PURGE_START', { module: MODULE,
      message: 'Starting test data purge', actor: actorEmail });

    var factTargets = [
      { table: Config.TABLES.FACT_JOB_EVENTS,    id: 'job_number', eventType: 'JOB_TEST_PURGED'     },
      { table: Config.TABLES.FACT_WORK_LOGS,      id: 'event_id',   eventType: 'WORK_LOG_TEST_PURGED' },
      { table: Config.TABLES.FACT_BILLING_LEDGER, id: 'billing_id', eventType: 'BILLING_TEST_PURGED'  },
      { table: Config.TABLES.FACT_PAYROLL_LEDGER, id: 'payroll_id', eventType: 'PAYROLL_TEST_PURGED'  }
    ];

    var totalTagged  = 0;
    var totalDeleted = 0;

    factTargets.forEach(function (t) {
      var scan = scanTable_(t.table, t.id);
      for (var i = 0; i < scan.rows.length; i++) {
        if (i > 0 && i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
          Logger.warn('PURGE_QUOTA_CUTOFF', { module: MODULE, table: t.table, processed: i });
          break;
        }
        var r = scan.rows[i];
        try {
          DAL.appendRow(t.table, {
            event_id:         Identifiers.generateId(),
            event_type:       t.eventType,
            amendment_of:     r[t.id],
            migration_batch:  'TEST_PURGED',
            status:           'PURGED',
            created_by:       actorEmail,
            created_at:       new Date().toISOString()
          }, { callerModule: MODULE });
          totalTagged++;
        } catch (e) {
          Logger.warn('PURGE_TAG_FAILED', { module: MODULE, id: r[t.id], error: e.message });
        }
      }
    });

    var stgTargets = [
      { table: Config.TABLES.VW_JOB_CURRENT_STATE, id: 'job_number' },
      { table: Config.TABLES.STG_PROCESSING_QUEUE,  id: 'queue_id'  },
      { table: Config.TABLES.STG_RAW_INTAKE,        id: 'intake_id' }
    ];

    stgTargets.forEach(function (t) {
      var scan = scanTable_(t.table, t.id);
      for (var i = 0; i < scan.rows.length; i++) {
        if (i > 0 && i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
          Logger.warn('PURGE_QUOTA_CUTOFF', { module: MODULE, table: t.table, processed: i });
          break;
        }
        var r = scan.rows[i];
        try {
          var cond = {};
          cond[t.id] = r[t.id];
          DAL.updateWhere(t.table, cond,
            { status: 'PURGED', migration_batch: 'TEST_PURGED' },
            { callerModule: MODULE }
          );
          totalDeleted++;
        } catch (e) {
          Logger.warn('PURGE_DELETE_FAILED', { module: MODULE, id: r[t.id], error: e.message });
        }
      }
    });

    Logger.info('PURGE_COMPLETE', { module: MODULE,
      tagged: totalTagged, deleted: totalDeleted, actor: actorEmail });
    Logger.info('PURGE_COMPLETE_SUMMARY', { module: MODULE, tagged: totalTagged, deleted: totalDeleted });

    return { tagged: totalTagged, deleted: totalDeleted };
  }

  // ============================================================
  // FULL WIPE — pre-migration clean slate
  // Clears ALL data rows from every FACT, VW, and staging sheet
  // while keeping the header row intact.
  // DIM tables (staff, clients, rates) are NOT wiped.
  // Bypasses DAL directly — approved exception for admin wipe tool.
  // ============================================================

  function wipeSheet_(sheetName) {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) { console.log('WIPE SKIP (not found): ' + sheetName); return 0; }
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) { console.log('WIPE SKIP (empty): ' + sheetName); return 0; }
    var numRows = lastRow - 1;
    var numCols = sheet.getLastColumn() || 1;
    sheet.getRange(2, 1, numRows, numCols).clearContent();
    console.log('WIPED ' + numRows + ' rows — ' + sheetName);
    return numRows;
  }

  /**
   * Full pre-migration wipe. Pass dryRun=false to execute.
   * @param {string}  actorEmail
   * @param {boolean} dryRun  default true (safe)
   */
  function runFullWipe(actorEmail, dryRun) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    // Fixed (non-partitioned) targets
    var FIXED_TARGETS = [
      Config.TABLES.FACT_CLIENT_FEEDBACK,
      Config.TABLES.FACT_PERFORMANCE_RATINGS,
      Config.TABLES.FACT_QUARTERLY_BONUS,
      Config.TABLES.VW_JOB_CURRENT_STATE,
      Config.TABLES.STG_PROCESSING_QUEUE,
      Config.TABLES.STG_RAW_INTAKE,
      'MIGRATION_RAW_IMPORT',
      'MIGRATION_NORMALIZED',
      'MIGRATION_AUDIT_LOG'
    ];

    // Partitioned FACT table prefixes — tabs named e.g. FACT_JOB_EVENTS|2026-01
    var PARTITIONED_PREFIXES = [
      'FACT_JOB_EVENTS|',
      'FACT_WORK_LOGS|',
      'FACT_QC_EVENTS|',
      'FACT_BILLING_LEDGER|',
      'FACT_PAYROLL_LEDGER|',
      'FACT_SOP_SUBMISSIONS|'
    ];

    // Discover all partitioned tabs in the spreadsheet
    var ss            = SpreadsheetApp.getActiveSpreadsheet();
    var allSheets     = ss.getSheets();
    var partitioned   = [];
    allSheets.forEach(function(sheet) {
      var name = sheet.getName();
      for (var i = 0; i < PARTITIONED_PREFIXES.length; i++) {
        if (name.indexOf(PARTITIONED_PREFIXES[i]) === 0) {
          partitioned.push(name);
          break;
        }
      }
    });

    var ALL_TARGETS = FIXED_TARGETS.concat(partitioned);

    if (dryRun !== false) {
      console.log('FULL WIPE DRY RUN — ' + ALL_TARGETS.length + ' targets:');
      ALL_TARGETS.forEach(function(t) { console.log('  ' + t); });
      return { sheetsWiped: [], totalRows: 0 };
    }

    Logger.info('FULL_WIPE_START', { module: MODULE, actor: actorEmail, targets: ALL_TARGETS.length });
    var totalRows = 0;
    var wiped     = [];
    ALL_TARGETS.forEach(function(name) {
      var n = wipeSheet_(name);
      if (n > 0) { wiped.push(name); totalRows += n; }
    });
    Logger.info('FULL_WIPE_COMPLETE', { module: MODULE, sheets: wiped.length, rows: totalRows });
    return { sheetsWiped: wiped, totalRows: totalRows };
  }

  return { runAudit: runAudit, runPurge: runPurge, runFullWipe: runFullWipe };
}());

// ============================================================
// TOP-LEVEL RUNNERS — callable from the Apps Script editor
// ============================================================

/** Scan tables for test data (dry run — no changes). */
function runPurgeAudit() {
  var email  = Session.getActiveUser().getEmail();
  var result = PurgeTool.runAudit(email);
  console.log('PURGE AUDIT — suspects: ' + result.total);
  result.results.forEach(function(r) {
    if (r.count > 0) console.log('  ' + r.tableName + ': ' + r.count);
  });
}

/** Tag matched test rows as PURGED (selective — by prefix/email pattern). */
function runPurgeExecute() {
  var email  = Session.getActiveUser().getEmail();
  var result = PurgeTool.runPurge(email, false);
  console.log('PURGE DONE — tagged: ' + result.tagged + ', deleted: ' + result.deleted);
}

/** Preview which sheets would be wiped (no changes). Run before runFullWipeExecute. */
function runFullWipeDryRun() {
  var email = Session.getActiveUser().getEmail();
  PurgeTool.runFullWipe(email, true);
}

/** WIPE ALL test data rows from FACT/VW/staging sheets. Keeps DIM tables and headers. */
function runFullWipeExecute() {
  var email  = Session.getActiveUser().getEmail();
  var result = PurgeTool.runFullWipe(email, false);
  console.log('FULL WIPE DONE — ' + result.sheetsWiped.length + ' sheets, ' + result.totalRows + ' rows removed');
}
