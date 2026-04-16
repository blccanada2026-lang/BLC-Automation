// ============================================================
// StaceyAuditor.gs — BLC Nexus T12 Migration
// src/12-migration/StaceyAuditor.gs
//
// Read-only inspection of the Stacey legacy spreadsheet.
// Produces a source inventory: tab names, row counts, column
// headers, sample data, and data quality signals.
//
// NEVER writes to Stacey. All output goes to Logger.
// SpreadsheetApp.openById() is the approved A2 exception for
// migration modules reading the legacy source.
// ============================================================

var StaceyAuditor = (function () {

  var MODULE = 'StaceyAuditor';

  function getStaceySheet_(tabName) {
    var ss    = SpreadsheetApp.openById(MigrationConfig.getStaceyId());
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) throw new Error('StaceyAuditor: tab "' + tabName + '" not found in Stacey.');
    return sheet;
  }

  /**
   * Lists all tabs in the Stacey spreadsheet with their row counts.
   * Run this first to discover the tab structure.
   *
   * @param {string} actorEmail
   * @returns {{ name: string, rows: number }[]}
   */
  function listTabs(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    var ss     = SpreadsheetApp.openById(MigrationConfig.getStaceyId());
    var sheets = ss.getSheets();
    var result = sheets.map(function (s) {
      return { name: s.getName(), rows: Math.max(s.getLastRow() - 1, 0) };
    });

    Logger.info('STACEY_LIST_TABS', {
      module:    MODULE,
      tabCount:  result.length,
      totalRows: result.reduce(function (sum, t) { return sum + t.rows; }, 0)
    });

    result.forEach(function (t) {
      Logger.info('STACEY_TAB', { module: MODULE, tab: t.name, rows: t.rows });
    });

    return result;
  }

  /**
   * Returns the header row and first N data rows of a Stacey tab.
   * Used to inspect column structure before mapping.
   *
   * @param {string} actorEmail
   * @param {string} tabName
   * @param {number} [sampleSize=5]
   * @returns {{ headers: string[], rows: Object[] }}
   */
  function sampleTab(actorEmail, tabName, sampleSize) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    var n     = sampleSize || 5;
    var sheet = getStaceySheet_(tabName);
    var last  = sheet.getLastRow();

    if (last < 1) {
      Logger.warn('STACEY_SAMPLE_EMPTY', { module: MODULE, tab: tabName });
      return { headers: [], rows: [] };
    }

    var endRow   = Math.min(last, n + 1);
    var numCols  = sheet.getLastColumn();
    var rawData  = sheet.getRange(1, 1, endRow, numCols).getValues();
    var headers  = rawData[0].map(function (h) { return String(h).trim(); });
    var dataRows = rawData.slice(1).map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });

    Logger.info('STACEY_SAMPLE_TAB', {
      module:  MODULE,
      tab:     tabName,
      headers: headers.length,
      sample:  dataRows.length
    });

    return { headers: headers, rows: dataRows };
  }

  /**
   * Scans a tab for data quality signals: blank IDs, blank dates, duplicate IDs.
   *
   * @param {string} actorEmail
   * @param {string} tabName
   * @param {string} idField    — column header that should be the unique key
   * @returns {{ totalRows: number, blankIds: number, blankDates: number, duplicateIds: number, duplicates: string[] }}
   */
  function qualityScan(actorEmail, tabName, idField) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    var sheet   = getStaceySheet_(tabName);
    var last    = sheet.getLastRow();
    if (last < 2) {
      return { totalRows: 0, blankIds: 0, blankDates: 0, duplicateIds: 0, duplicates: [] };
    }

    var numCols = sheet.getLastColumn();
    var rawData = sheet.getRange(1, 1, last, numCols).getValues();
    var headers = rawData[0].map(function (h) { return String(h).trim(); });
    var idIdx   = headers.indexOf(idField);

    var seenIds    = {};
    var blankIds   = 0;
    var blankDates = 0;
    var duplicates = [];

    for (var i = 1; i < rawData.length; i++) {
      var row = rawData[i];
      var id  = idIdx >= 0 ? String(row[idIdx]).trim() : '';

      if (!id || id === '' || id === 'undefined') {
        blankIds++;
        continue;
      }
      if (seenIds[id]) {
        duplicates.push(id);
      } else {
        seenIds[id] = true;
      }

      // Count rows where every date-looking column is blank
      var hasAnyDate = row.some(function (cell) {
        return cell instanceof Date && !isNaN(cell.getTime());
      });
      if (!hasAnyDate) blankDates++;

      if (HealthMonitor.isApproachingLimit()) {
        Logger.warn('STACEY_QUALITY_QUOTA_CUTOFF', { module: MODULE, tab: tabName, processed: i });
        break;
      }
    }

    var result = {
      totalRows:    rawData.length - 1,
      blankIds:     blankIds,
      blankDates:   blankDates,
      duplicateIds: duplicates.length,
      duplicates:   duplicates.slice(0, 20)
    };

    Logger.info('STACEY_QUALITY_SCAN', {
      module:  MODULE,
      tab:     tabName,
      idField: idField,
      result:  JSON.stringify(result)
    });

    return result;
  }

  /**
   * Full audit: lists all tabs, then runs qualityScan on each configured Stacey table.
   * Records results to Logger. Run after setting MigrationConfig.STACEY_TABLES.
   *
   * @param {string} actorEmail
   * @returns {{ tabs: Object[], quality: Object[] }}
   */
  function runAudit(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    Logger.info('STACEY_AUDIT_START', { module: MODULE, message: 'Starting Stacey source audit' });

    var tabs = listTabs(actorEmail);

    var idFields = {
      STAFF:     'person_code',
      CLIENTS:   'client_code',
      JOBS:      'job_number',
      WORK_LOGS: 'event_id',
      BILLING:   'billing_id',
      PAYROLL:   'payroll_id'
    };

    var quality = [];
    var staceyTables = MigrationConfig.STACEY_TABLES;

    Object.keys(staceyTables).forEach(function (key) {
      var tabName = staceyTables[key];
      if (!tabName || tabName === 'REPLACE_AFTER_AUDIT') {
        Logger.warn('STACEY_AUDIT_SKIP', {
          module:  MODULE,
          key:     key,
          message: 'Tab name not configured — run listTabs() first'
        });
        return;
      }
      try {
        var scan = qualityScan(actorEmail, tabName, idFields[key] || 'id');
        quality.push({ key: key, tab: tabName, scan: scan });
      } catch (e) {
        Logger.error('STACEY_AUDIT_TAB_FAILED', { module: MODULE, key: key, tab: tabName, error: e.message });
        quality.push({ key: key, tab: tabName, error: e.message });
      }
    });

    Logger.info('STACEY_AUDIT_COMPLETE', { module: MODULE,
      tabCount: tabs.length, qualityScanned: quality.length });

    return { tabs: tabs, quality: quality };
  }

  return {
    listTabs:    listTabs,
    sampleTab:   sampleTab,
    qualityScan: qualityScan,
    runAudit:    runAudit
  };
}());
