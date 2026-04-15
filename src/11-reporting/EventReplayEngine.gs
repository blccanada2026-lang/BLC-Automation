// ============================================================
// EventReplayEngine.gs — BLC Nexus T11 Reporting
// src/11-reporting/EventReplayEngine.gs
//
// LOAD ORDER: T11. Loads after all T0–T10 files.
// DEPENDENCIES: Config (T0), Constants (T0), DAL (T1),
//               RBAC (T2), Logger (T3), HealthMonitor (T3)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  CEO-triggered recovery tool.                           ║
// ║  Rebuilds VW_JOB_CURRENT_STATE and VW_DESIGNER_WORKLOAD ║
// ║  by replaying all FACT_JOB_EVENTS and FACT_WORK_LOGS    ║
// ║  partitions from scratch.                               ║
// ║                                                         ║
// ║  Not a routine operation — run only when VW tables      ║
// ║  are suspected to be corrupted or out of sync.          ║
// ║                                                         ║
// ║  Entry point:                                           ║
// ║    rebuildAllViews(actorEmail)                          ║
// ║                                                         ║
// ║  Permission: PAYROLL_RUN + enforceFinancialAccess (CEO) ║
// ║                                                         ║
// ║  NOTE: Uses SpreadsheetApp.getSheetByName().deleteRows()║
// ║  to clear VW sheets — same known A2 exception as        ║
// ║  BillingEngine/PayrollEngine. DAL has no clearSheet().  ║
// ║  TODO: migrate when DAL.clearSheet() is implemented.    ║
// ║                                                         ║
// ║  FUTURE: migrate portal button to AdminConsole (T13)    ║
// ║  when that module is built.                             ║
// ╚══════════════════════════════════════════════════════════╝

var EventReplayEngine = (function () {

  var MODULE = 'EventReplayEngine';

  // ============================================================
  // SECTION 1: PARTITION DISCOVERY
  // ============================================================

  /**
   * Scans the active spreadsheet for tab names matching
   * `BASE_TABLE_NAME|YYYY-MM` and returns the period IDs
   * sorted ascending (oldest first).
   *
   * @param {string} baseTableName  e.g. 'FACT_JOB_EVENTS'
   * @returns {string[]}  e.g. ['2025-11', '2025-12', '2026-01']
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
        if (/^\d{4}-\d{2}$/.test(period)) {
          periods.push(period);
        }
      }
    }
    periods.sort();
    return periods;
  }

  // ============================================================
  // SECTION 2: SHEET CLEAR
  // ============================================================

  /**
   * Clears all data rows from a sheet (keeps header row 1).
   * Returns the number of rows cleared, or 0 if sheet is
   * empty or missing.
   *
   * NOTE: Uses SpreadsheetApp directly — known A2 exception.
   * Same pattern as BillingEngine.refreshMartBillingSummary_().
   *
   * @param {string} sheetName  e.g. 'VW_JOB_CURRENT_STATE'
   * @returns {number}  rows cleared
   */
  function clearSheet_(sheetName) {
    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() <= 1) return 0;
    var rowCount = sheet.getLastRow() - 1;
    sheet.deleteRows(2, rowCount);
    return rowCount;
  }

  // ============================================================
  // SECTION 3: REBUILD VW_JOB_CURRENT_STATE
  // ============================================================

  /**
   * Replays all FACT_JOB_EVENTS partitions (oldest first) into
   * an in-memory job map, then clears and rewrites
   * VW_JOB_CURRENT_STATE in one DAL.appendRows call.
   *
   * @returns {{ written: number, cleared: number, partial: boolean }}
   */
  function rebuildJobView_() {
    var periods = discoverPartitions_(Config.TABLES.FACT_JOB_EVENTS);
    var jobMap  = {};  // keyed by job_number

    for (var p = 0; p < periods.length; p++) {
      var periodId = periods[p];
      var rows;
      try {
        rows = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS, {
          callerModule: MODULE,
          periodId:     periodId
        });
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') {
          Logger.warn('REPLAY_PARTITION_SKIPPED', {
            module: MODULE, table: Config.TABLES.FACT_JOB_EVENTS, periodId: periodId
          });
          continue;
        }
        throw e;
      }

      for (var i = 0; i < rows.length; i++) {
        if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
          Logger.warn('REPLAY_QUOTA_CUTOFF', {
            module: MODULE, processed: i, period: periodId
          });
          return { written: 0, cleared: 0, partial: true };
        }
        foldJobEvent_(jobMap, rows[i]);
      }
    }

    // Clear VW then batch-write all rebuilt rows
    var cleared = clearSheet_(Config.TABLES.VW_JOB_CURRENT_STATE);
    var vwRows  = objectValues_(jobMap);
    if (vwRows.length > 0) {
      DAL.appendRows(Config.TABLES.VW_JOB_CURRENT_STATE, vwRows, { callerModule: MODULE });
    }

    Logger.info('REPLAY_JOB_VIEW_REBUILT', {
      module: MODULE, written: vwRows.length, cleared: cleared
    });

    return { written: vwRows.length, cleared: cleared, partial: false };
  }

  /**
   * Applies a single FACT_JOB_EVENTS row to the in-memory job map.
   * Mutates jobMap in place.
   *
   * @param {Object} jobMap  keyed by job_number
   * @param {Object} row     one FACT_JOB_EVENTS row
   */
  function foldJobEvent_(jobMap, row) {
    var jobNumber = String(row.job_number  || '').trim();
    var eventType = String(row.event_type  || '').trim();
    var updatedAt = String(row.timestamp   || '').trim();
    if (!jobNumber) return;

    switch (eventType) {

      case 'JOB_CREATED':
        jobMap[jobNumber] = {
          job_number:          jobNumber,
          client_code:         String(row.client_code    || ''),
          job_type:            String(row.job_type       || ''),
          product_code:        String(row.product_code   || ''),
          quantity:            parseFloat(row.quantity)  || 0,
          current_state:       row.allocated_to
                                 ? Config.STATES.ALLOCATED
                                 : Config.STATES.INTAKE_RECEIVED,
          prev_state:          '',
          allocated_to:        String(row.allocated_to   || ''),
          period_id:           String(row.period_id      || ''),
          created_at:          updatedAt,
          updated_at:          updatedAt,
          rework_cycle:        0,
          client_return_count: 0
        };
        break;

      case 'JOB_STARTED':
        if (!jobMap[jobNumber]) break;
        jobMap[jobNumber].prev_state    = jobMap[jobNumber].current_state;
        jobMap[jobNumber].current_state = Config.STATES.IN_PROGRESS;
        jobMap[jobNumber].allocated_to  = String(row.allocated_to || jobMap[jobNumber].allocated_to);
        jobMap[jobNumber].updated_at    = updatedAt;
        break;

      case 'JOB_HELD':
        if (!jobMap[jobNumber]) break;
        jobMap[jobNumber].prev_state    = jobMap[jobNumber].current_state;
        jobMap[jobNumber].current_state = Config.STATES.ON_HOLD;
        jobMap[jobNumber].updated_at    = updatedAt;
        break;

      case 'JOB_RESUMED':
        if (!jobMap[jobNumber]) break;
        jobMap[jobNumber].current_state = jobMap[jobNumber].prev_state;
        jobMap[jobNumber].prev_state    = Config.STATES.ON_HOLD;
        jobMap[jobNumber].updated_at    = updatedAt;
        break;

      case 'QC_SUBMITTED':
        if (!jobMap[jobNumber]) break;
        jobMap[jobNumber].current_state = Config.STATES.QC_REVIEW;
        jobMap[jobNumber].updated_at    = updatedAt;
        break;

      case 'QC_APPROVED':
        if (!jobMap[jobNumber]) break;
        jobMap[jobNumber].current_state = Config.STATES.COMPLETED_BILLABLE;
        jobMap[jobNumber].updated_at    = updatedAt;
        break;

      case 'QC_REWORK_REQUESTED':
        if (!jobMap[jobNumber]) break;
        jobMap[jobNumber].current_state       = Config.STATES.IN_PROGRESS;
        jobMap[jobNumber].rework_cycle        = (jobMap[jobNumber].rework_cycle || 0) + 1;
        jobMap[jobNumber].client_return_count = (jobMap[jobNumber].client_return_count || 0) + 1;
        jobMap[jobNumber].updated_at          = updatedAt;
        break;

      case 'INVOICED':
        if (!jobMap[jobNumber]) break;
        jobMap[jobNumber].current_state = Config.STATES.INVOICED;
        jobMap[jobNumber].updated_at    = updatedAt;
        break;

      default:
        Logger.warn('REPLAY_UNKNOWN_EVENT', {
          module: MODULE, event_type: eventType, job_number: jobNumber
        });
        break;
    }
  }

  // ============================================================
  // SECTION 4: REBUILD VW_DESIGNER_WORKLOAD
  // ============================================================

  /**
   * Aggregates all FACT_WORK_LOGS partitions into an in-memory
   * workload map, then clears and rewrites VW_DESIGNER_WORKLOAD.
   *
   * @returns {{ written: number, cleared: number, partial: boolean }}
   */
  function rebuildWorkloadView_() {
    var periods     = discoverPartitions_(Config.TABLES.FACT_WORK_LOGS);
    var workloadMap = {};  // keyed by 'person_code|period_id'

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
          Logger.warn('REPLAY_PARTITION_SKIPPED', {
            module: MODULE, table: Config.TABLES.FACT_WORK_LOGS, periodId: periodId
          });
          continue;
        }
        throw e;
      }

      for (var i = 0; i < rows.length; i++) {
        if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
          Logger.warn('REPLAY_QUOTA_CUTOFF', {
            module: MODULE, processed: i, period: periodId, table: 'FACT_WORK_LOGS'
          });
          return { written: 0, cleared: 0, partial: true };
        }

        var code = String(rows[i].person_code || '').trim();
        var pid  = String(rows[i].period_id   || '').trim();
        var qty  = parseFloat(rows[i].quantity) || 0;
        var ts   = String(rows[i].timestamp    || '');
        if (!code || !pid) continue;

        var key = code + '|' + pid;
        if (!workloadMap[key]) {
          workloadMap[key] = {
            person_code:    code,
            period_id:      pid,
            job_count:      0,
            total_quantity: 0,
            last_updated:   ts
          };
        }
        workloadMap[key].job_count++;
        workloadMap[key].total_quantity += qty;
        if (ts > workloadMap[key].last_updated) workloadMap[key].last_updated = ts;
      }
    }

    var cleared = clearSheet_(Config.TABLES.VW_DESIGNER_WORKLOAD);
    var wlRows  = objectValues_(workloadMap);
    if (wlRows.length > 0) {
      DAL.appendRows(Config.TABLES.VW_DESIGNER_WORKLOAD, wlRows, { callerModule: MODULE });
    }

    Logger.info('REPLAY_WORKLOAD_VIEW_REBUILT', {
      module: MODULE, written: wlRows.length, cleared: cleared
    });

    return { written: wlRows.length, cleared: cleared, partial: false };
  }

  // ============================================================
  // SECTION 5: UTILITY
  // ============================================================

  /** Returns Object.values() equivalent (GAS V8 compatible). */
  function objectValues_(obj) {
    var keys   = Object.keys(obj);
    var values = [];
    for (var i = 0; i < keys.length; i++) values.push(obj[keys[i]]);
    return values;
  }

  // ============================================================
  // SECTION 6: MAIN ENTRY POINT
  // ============================================================

  /**
   * Rebuilds VW_JOB_CURRENT_STATE and VW_DESIGNER_WORKLOAD
   * by replaying all FACT partitions from scratch.
   * CEO only (PAYROLL_RUN + enforceFinancialAccess).
   *
   * @param {string} actorEmail
   * @returns {{
   *   vw_job:      { written: number, cleared: number },
   *   vw_workload: { written: number, cleared: number },
   *   partial:     boolean,
   *   elapsed_ms:  number
   * }}
   */
  function rebuildAllViews_(actorEmail) {
    var startMs = Date.now();

    Logger.info('REPLAY_STARTED', { module: MODULE, actor: actorEmail });

    var jobResult      = rebuildJobView_();
    var workloadResult = rebuildWorkloadView_();

    var elapsed = Date.now() - startMs;
    var partial = jobResult.partial || workloadResult.partial;

    Logger.info('REPLAY_COMPLETE', {
      module:     MODULE,
      elapsed_ms: elapsed,
      partial:    partial,
      jobs:       jobResult.written,
      workload:   workloadResult.written
    });

    return {
      vw_job:      { written: jobResult.written,      cleared: jobResult.cleared },
      vw_workload: { written: workloadResult.written, cleared: workloadResult.cleared },
      partial:     partial,
      elapsed_ms:  elapsed
    };
  }

  // ============================================================
  // SECTION 7: PUBLIC API
  // ============================================================

  /**
   * Rebuilds all VW projection tables by replaying FACT events.
   * CEO only.
   *
   * @param {string} actorEmail
   * @returns {{ vw_job, vw_workload, partial, elapsed_ms }}
   */
  function rebuildAllViews(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
    RBAC.enforceFinancialAccess(actor);
    return rebuildAllViews_(actorEmail);
  }

  return {
    rebuildAllViews: rebuildAllViews
  };

})();
