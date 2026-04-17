// ============================================================
// MigrationRawImporter.gs — BLC Nexus T12 Migration
// src/12-migration/MigrationRawImporter.gs
//
// Phase D — Layer 1: raw copy of Stacey tabs into
// MIGRATION_RAW_IMPORT. Idempotent by batch+tab+row_index.
//
// SpreadsheetApp.openById() is the approved A2 exception for
// reading the legacy Stacey source.
// ============================================================

var MigrationRawImporter = (function () {

  var MODULE = 'MigrationRawImporter';
  var BATCH_SIZE = 100; // rows per DAL.appendRows flush

  /**
   * Builds an idempotency key for a given source row.
   * Format: BATCH-{batch}|TAB-{tabName}|ROW-{rowIndex}
   *
   * @param {string} batch
   * @param {string} tabName
   * @param {number} rowIndex  1-based row index (header excluded)
   * @returns {string}
   */
  function makeImportKey_(batch, tabName, rowIndex) {
    return 'BATCH-' + batch + '|TAB-' + tabName + '|ROW-' + rowIndex;
  }

  /**
   * Loads all already-imported keys for a given batch+tab from
   * MIGRATION_RAW_IMPORT so we can skip duplicates.
   *
   * @param {string} batch
   * @param {string} tabName
   * @returns {Object} map of importKey → true
   */
  function loadExistingKeys_(batch, tabName) {
    var rows;
    try {
      rows = DAL.readAll(MigrationConfig.TABLES.RAW_IMPORT, { callerModule: MODULE });
    } catch (e) {
      Logger.warn('RAW_IMPORT_READ_FAILED', { module: MODULE, error: e.message });
      return {};
    }
    var existing = {};
    (rows || []).forEach(function (r) {
      if (r.migration_batch === batch && r.source_tab === tabName) {
        existing[r.import_key] = true;
      }
    });
    return existing;
  }

  /**
   * Imports one Stacey tab into MIGRATION_RAW_IMPORT.
   * Idempotent — already-imported rows are skipped.
   * Uses DAL.appendRows for bulk writes (Rule P2).
   *
   * @param {string} actorEmail
   * @param {string} tabName  Stacey tab to import
   * @returns {{ imported: number, skipped: number, partial: boolean }}
   */
  function importTab(actorEmail, tabName) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    var batch     = MigrationConfig.getBatch();
    var sourceTag = MigrationConfig.getSourceTag();

    Logger.info('RAW_IMPORT_START', { module: MODULE, tab: tabName, batch: batch });

    // Open Stacey read-only — approved A2 exception for migration
    var ss;
    try {
      ss = SpreadsheetApp.openById(MigrationConfig.getStaceyId());
    } catch (e) {
      Logger.error('RAW_IMPORT_OPEN_FAILED', { module: MODULE, error: e.message });
      throw new Error('MigrationRawImporter: cannot open Stacey. Cause: ' + e.message);
    }

    var sheet = ss.getSheetByName(tabName);
    if (!sheet) throw new Error('MigrationRawImporter: tab "' + tabName + '" not found.');

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      Logger.warn('RAW_IMPORT_EMPTY_TAB', { module: MODULE, tab: tabName });
      return { imported: 0, skipped: 0, partial: false };
    }

    var numCols  = sheet.getLastColumn();
    var rawData  = sheet.getRange(1, 1, lastRow, numCols).getValues();
    var headers  = rawData[0].map(function (h) { return String(h).trim(); });
    var existing = loadExistingKeys_(batch, tabName);

    var imported  = 0;
    var skipped   = 0;
    var partial   = false;
    var buffer    = [];

    function flushBuffer_() {
      if (buffer.length === 0) return;
      DAL.appendRows(MigrationConfig.TABLES.RAW_IMPORT, buffer, { callerModule: MODULE });
      imported += buffer.length;
      buffer = [];
    }

    for (var i = 1; i < rawData.length; i++) {
      // Quota guard — check every 20 iterations per Rule P1
      if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
        Logger.warn('RAW_IMPORT_QUOTA_CUTOFF', {
          module: MODULE, tab: tabName, processed: i, total: rawData.length - 1
        });
        flushBuffer_();
        partial = true;
        break;
      }

      var importKey = makeImportKey_(batch, tabName, i);
      if (existing[importKey]) {
        skipped++;
        continue;
      }

      // Serialize row as JSON blob — preserves all source columns
      var rowObj = {};
      headers.forEach(function (h, idx) { rowObj[h] = rawData[i][idx]; });

      buffer.push({
        import_id:       Identifiers.generateId(),
        import_key:      importKey,
        migration_batch: batch,
        source_tag:      sourceTag,
        source_tab:      tabName,
        row_index:       i,
        raw_json:        JSON.stringify(rowObj),
        imported_at:     new Date().toISOString(),
        imported_by:     actorEmail,
        status:          'IMPORTED'
      });

      if (buffer.length >= BATCH_SIZE) {
        flushBuffer_();
        if (HealthMonitor.isApproachingLimit()) {
          Logger.warn('RAW_IMPORT_QUOTA_CUTOFF', {
            module: MODULE, tab: tabName, processed: i, total: rawData.length - 1
          });
          partial = true;
          break;
        }
      }
    }

    flushBuffer_();

    Logger.info('RAW_IMPORT_COMPLETE', {
      module: MODULE, tab: tabName, imported: imported, skipped: skipped, partial: partial
    });

    return { imported: imported, skipped: skipped, partial: partial };
  }

  /**
   * Imports ALL configured Stacey tables in sequence.
   * Stops early if quota limit is hit.
   * Skips any table whose tab name is still the placeholder value.
   *
   * @param {string} actorEmail
   * @returns {{ results: Object[], anyPartial: boolean }}
   */
  function importAll(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    Logger.info('RAW_IMPORT_ALL_START', {
      module: MODULE, message: 'Starting full Stacey raw import'
    });

    var staceyTables = MigrationConfig.STACEY_TABLES;
    var results      = [];
    var anyPartial   = false;

    var keys = Object.keys(staceyTables);
    for (var k = 0; k < keys.length; k++) {
      if (HealthMonitor.isApproachingLimit()) {
        Logger.warn('RAW_IMPORT_ALL_QUOTA_CUTOFF', {
          module: MODULE, remaining: keys.length - k
        });
        anyPartial = true;
        break;
      }

      var key     = keys[k];
      var tabName = staceyTables[key];

      if (!tabName || tabName === 'REPLACE_AFTER_AUDIT' || tabName === 'SKIP') {
        Logger.info('RAW_IMPORT_SKIP', { module: MODULE, key: key, tab: tabName });
        continue;
      }

      try {
        var result = importTab(actorEmail, tabName);
        results.push({ key: key, tab: tabName, result: result });
        if (result.partial) anyPartial = true;
      } catch (e) {
        Logger.error('RAW_IMPORT_TAB_FAILED', {
          module: MODULE, key: key, tab: tabName, error: e.message
        });
        results.push({ key: key, tab: tabName, error: e.message });
      }
    }

    Logger.info('RAW_IMPORT_ALL_COMPLETE', {
      module: MODULE, tabsAttempted: results.length, anyPartial: anyPartial
    });

    return { results: results, anyPartial: anyPartial };
  }

  return {
    importTab: importTab,
    importAll: importAll
  };

}());
