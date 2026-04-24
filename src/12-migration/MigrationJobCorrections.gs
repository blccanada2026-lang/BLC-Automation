// ============================================================
// MigrationJobCorrections.gs — BLC Nexus T12 Migration
// src/12-migration/MigrationJobCorrections.gs
//
// Manual correction workflow for INVALID JOB rows.
// Use when jobs failed normalization due to missing period_id
// or unknown client codes.
//
// Run order:
//   1. runCreateJobCorrectionsSheet()  — populate correction sheet
//   2. [Manual] Fill MIGRATION_JOB_CORRECTIONS in the spreadsheet
//   3. runApplyJobCorrections()         — apply reviewed corrections
//   4. runReprocessCorrectedJobs()      — replay newly-VALID rows
// ============================================================

var MigrationJobCorrections = (function () {

  var MODULE          = 'MigrationJobCorrections';
  var CORRECTIONS_TAB = 'MIGRATION_JOB_CORRECTIONS';

  var HEADERS = [
    'norm_id', 'job_number', 'client_code', 'status',
    'issue', 'payload', 'suggested_action',
    'corrected_period_id', 'corrected_client_code', 'include_in_migration',
    'reviewer_notes', 'reviewed_by', 'reviewed_date', 'processed_flag'
  ];

  // Column positions (1-based) matching HEADERS above
  var COL = {
    norm_id:              1,
    job_number:           2,
    client_code:          3,
    status:               4,
    issue:                5,
    payload:              6,
    suggested_action:     7,
    corrected_period_id:  8,
    corrected_client_code:9,
    include_in_migration: 10,
    reviewer_notes:       11,
    reviewed_by:          12,
    reviewed_date:        13,
    processed_flag:       14
  };

  function getSheet_() {
    return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CORRECTIONS_TAB);
  }

  function isTestOrUnknown_(jobNumber, clientCode) {
    return String(jobNumber  || '').indexOf('TEST-') === 0 ||
           String(clientCode || '').toUpperCase() === 'UNKNOWN';
  }

  // ── Public ────────────────────────────────────────────────────

  /**
   * Creates or updates MIGRATION_JOB_CORRECTIONS with all INVALID JOB rows.
   * Idempotent — rows already present (by norm_id) are not duplicated.
   * TEST-* and UNKNOWN-client rows are pre-filled with EXCLUDE.
   *
   * @param {string} actorEmail
   * @returns {{ created: number, skipped: number }}
   */
  function createCorrectionsSheet(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    var batch       = MigrationConfig.getBatch();
    var normRows    = DAL.readAll(MigrationConfig.TABLES.NORMALIZED, { callerModule: MODULE });
    var invalidJobs = (normRows || []).filter(function (r) {
      return r.migration_batch   === batch &&
             r.entity_type       === 'JOB' &&
             r.validation_status === 'INVALID';
    });

    if (invalidJobs.length === 0) {
      Logger.info('JOB_CORRECTIONS_NOTHING', { module: MODULE, message: 'No INVALID JOB rows' });
      return { created: 0, skipped: 0 };
    }

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CORRECTIONS_TAB);

    // Build existing norm_id index
    var existing = {};
    if (sheet && sheet.getLastRow() > 1) {
      sheet.getRange(2, COL.norm_id, sheet.getLastRow() - 1, 1)
           .getValues()
           .forEach(function (r) { if (r[0]) existing[String(r[0])] = true; });
    } else {
      sheet = sheet || ss.insertSheet(CORRECTIONS_TAB);
      sheet.clearContents();
      var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
      headerRange.setValues([HEADERS]);
      headerRange.setFontWeight('bold');
      headerRange.setBackground('#f3f3f3');
      sheet.setFrozenRows(1);
    }

    var newRows = [];
    invalidJobs.forEach(function (row) {
      if (existing[row.norm_id]) return;
      var payload = {};
      try { payload = JSON.parse(row.normalized_json || '{}'); } catch (e) {}

      var jobNumber  = String(payload.job_number  || '');
      var clientCode = String(payload.client_code || '');
      var status     = String(payload.status      || '');
      var isExclude  = isTestOrUnknown_(jobNumber, clientCode);

      newRows.push([
        row.norm_id,
        jobNumber,
        clientCode,
        status,
        String(row.validation_notes || ''),
        row.normalized_json || '',
        isExclude ? 'EXCLUDE' : '',
        '',                           // corrected_period_id — fill manually
        '',                           // corrected_client_code — fill if needed
        isExclude ? 'NO' : '',        // include_in_migration — pre-fill for excludes
        '',                           // reviewer_notes
        '',                           // reviewed_by
        '',                           // reviewed_date
        ''                            // processed_flag
      ]);
    });

    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, HEADERS.length)
           .setValues(newRows);
    }

    Logger.info('JOB_CORRECTIONS_SHEET_READY', {
      module: MODULE, created: newRows.length, skipped: invalidJobs.length - newRows.length
    });
    return { created: newRows.length, skipped: invalidJobs.length - newRows.length };
  }

  /**
   * Applies reviewed corrections from MIGRATION_JOB_CORRECTIONS.
   * Only processes rows where processed_flag is blank and include_in_migration is set.
   *
   * include_in_migration=NO  → sets replay_status=EXCLUDED (permanently skipped)
   * include_in_migration=YES → patches period_id/client_code, re-validates, sets VALID/INVALID
   *
   * @param {string} actorEmail
   * @returns {{ applied: number, skipped: number, errors: string[] }}
   */
  function applyCorrections(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    var sheet = getSheet_();
    if (!sheet || sheet.getLastRow() < 2) {
      throw new Error('MIGRATION_JOB_CORRECTIONS is empty — run createCorrectionsSheet first.');
    }

    // Build norm_id index from MIGRATION_NORMALIZED for fast lookup
    var normRows = DAL.readAll(MigrationConfig.TABLES.NORMALIZED, { callerModule: MODULE });
    var normByKey = {};
    (normRows || []).forEach(function (r) { normByKey[r.norm_id] = r; });

    var data    = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
    var applied = 0;
    var skipped = 0;
    var errors  = [];

    data.forEach(function (row, i) {
      var normId          = String(row[COL.norm_id            - 1] || '').trim();
      var jobNumber       = String(row[COL.job_number         - 1] || '').trim();
      var includeInMig    = String(row[COL.include_in_migration- 1] || '').trim().toUpperCase();
      var correctedPeriod = String(row[COL.corrected_period_id- 1] || '').trim();
      var correctedClient = String(row[COL.corrected_client_code-1] || '').trim();
      var processedFlag   = String(row[COL.processed_flag     - 1] || '').trim();

      if (!normId || processedFlag === 'DONE') { skipped++; return; }
      if (!includeInMig)                        { skipped++; return; }

      try {
        if (includeInMig === 'NO') {
          DAL.updateWhere(
            MigrationConfig.TABLES.NORMALIZED,
            { norm_id: normId },
            {
              replay_status:    'EXCLUDED',
              validation_notes: 'Manually excluded via MIGRATION_JOB_CORRECTIONS'
            },
            { callerModule: MODULE }
          );

        } else if (includeInMig === 'YES') {
          if (!correctedPeriod) {
            errors.push(jobNumber + ': include_in_migration=YES but corrected_period_id is blank');
            return;
          }

          var normRow = normByKey[normId];
          if (!normRow) {
            errors.push(jobNumber + ': norm_id ' + normId + ' not found in MIGRATION_NORMALIZED');
            return;
          }

          var payload = {};
          try { payload = JSON.parse(normRow.normalized_json || '{}'); } catch (e) {}

          payload.period_id = correctedPeriod;
          if (correctedClient) payload.client_code = correctedClient;

          var validation = MigrationValidator.validate('JOB', payload);

          DAL.updateWhere(
            MigrationConfig.TABLES.NORMALIZED,
            { norm_id: normId },
            {
              normalized_json:   JSON.stringify(payload),
              validation_status: validation.valid ? 'VALID' : 'INVALID',
              validation_notes:  validation.errors.join('; '),
              replay_status:     'PENDING'
            },
            { callerModule: MODULE }
          );

        } else {
          errors.push(jobNumber + ': include_in_migration must be YES or NO, got: ' + includeInMig);
          return;
        }

        sheet.getRange(i + 2, COL.processed_flag).setValue('DONE');
        applied++;

      } catch (e) {
        errors.push(jobNumber + ': ' + e.message);
      }
    });

    Logger.info('JOB_CORRECTIONS_APPLIED', {
      module: MODULE, applied: applied, skipped: skipped, errors: errors.length
    });
    return { applied: applied, skipped: skipped, errors: errors };
  }

  /**
   * Replays all corrected JOB rows now marked VALID/PENDING.
   * Delegates to MigrationReplayEngine.replayAll() — idempotent, picks up
   * any VALID/PENDING rows regardless of entity type.
   * Reports remaining INVALID count after replay.
   *
   * @param {string} actorEmail
   * @returns {{ replayed: number, failed: number, remainingInvalid: number }}
   */
  function reprocessCorrectedJobs(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    var replayResult = MigrationReplayEngine.replayAll(actorEmail);

    var batch    = MigrationConfig.getBatch();
    var normRows = DAL.readAll(MigrationConfig.TABLES.NORMALIZED, { callerModule: MODULE });
    var remainingInvalid = (normRows || []).filter(function (r) {
      return r.migration_batch === batch && r.validation_status === 'INVALID';
    }).length;

    Logger.info('JOB_REPROCESS_COMPLETE', {
      module:           MODULE,
      replayed:         replayResult.replayed,
      failed:           replayResult.failed,
      remainingInvalid: remainingInvalid
    });
    return {
      replayed:         replayResult.replayed,
      failed:           replayResult.failed,
      remainingInvalid: remainingInvalid
    };
  }

  return {
    createCorrectionsSheet: createCorrectionsSheet,
    applyCorrections:       applyCorrections,
    reprocessCorrectedJobs: reprocessCorrectedJobs
  };

}());

// ── Top-level runners (visible in Apps Script editor) ────────

function runCreateJobCorrectionsSheet() {
  var result = MigrationJobCorrections.createCorrectionsSheet(Session.getActiveUser().getEmail());
  console.log('Created: ' + result.created + ' | Already present: ' + result.skipped);
}

function runApplyJobCorrections() {
  var result = MigrationJobCorrections.applyCorrections(Session.getActiveUser().getEmail());
  console.log('Applied: ' + result.applied + ' | Skipped: ' + result.skipped);
  if (result.errors.length > 0) {
    result.errors.forEach(function (e) { console.log('ERROR: ' + e); });
  }
}

function runReprocessCorrectedJobs() {
  var result = MigrationJobCorrections.reprocessCorrectedJobs(Session.getActiveUser().getEmail());
  console.log('Replayed: ' + result.replayed + ' | Failed: ' + result.failed +
              ' | Remaining INVALID: ' + result.remainingInvalid);
}
