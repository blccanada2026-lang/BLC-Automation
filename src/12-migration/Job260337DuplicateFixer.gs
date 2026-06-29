// ============================================================
// Job260337DuplicateFixer.gs — BLC Nexus T12 Migration
// src/12-migration/Job260337DuplicateFixer.gs
//
// One-time fix for job 260337 which has two VW_JOB_CURRENT_STATE
// rows (both COMPLETED_BILLABLE). Root cause: StaceyJobImporter
// wrote the migration row; Sarty re-entered the job manually via
// V3 portal when it appeared stuck in QC_REVIEW. MigratedQCApprovalFixer
// later set both rows to COMPLETED_BILLABLE.
//
// Fix: identify the newer (V3 portal re-entry) row by created_at,
// void just that row via compound updateWhere, and write a
// JOB_DUPLICATE_VOIDED event to FACT_JOB_EVENTS for the audit trail.
//
// Step 1: runJob260337Audit()  — dry run, confirms two rows exist, no changes
// Step 2: runJob260337Fix()    — voids the duplicate row
// Idempotent: safe to re-run; already-voided row is skipped.
// ============================================================

var Job260337DuplicateFixer = (function() {

  var MODULE    = 'Job260337DuplicateFixer';
  var JOB_NUM   = '260337';
  var CLIENT    = 'NELSON';

  var AUDIT_TAB = '_TEMP_AUDIT_260337';

  /**
   * Dry run — writes both VW rows for 260337 side-by-side to _TEMP_AUDIT_260337.
   * No changes to any FACT or VW table.
   * @param {string} actorEmail
   */
  function runAudit(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    var matches = (vwRows || []).filter(function(r) {
      return String(r.job_number || '') === JOB_NUM;
    });

    Logger.info('JOB260337_AUDIT', { module: MODULE, rowsFound: matches.length });

    // Sort oldest first so Row 1 = migration row, Row 2 = portal re-entry
    matches.sort(function(a, b) {
      var da = new Date(a.created_at), db = new Date(b.created_at);
      if (!isNaN(da) && !isNaN(db)) return da - db;
      return a.created_at < b.created_at ? -1 : 1;
    });

    // Build union of all field names across both rows, preserving insertion order
    var fieldSet = {}, fields = [];
    matches.forEach(function(r) {
      Object.keys(r).forEach(function(k) {
        if (!fieldSet[k]) { fieldSet[k] = true; fields.push(k); }
      });
    });

    var row1 = matches[0] || {};
    var row2 = matches[1] || {};

    var sheetData = [];
    // Header
    sheetData.push([
      'Field',
      'Row 1 — Older (Migration / keep)',
      'Row 2 — Newer (Portal re-entry / void candidate)'
    ]);
    // One row per field
    fields.forEach(function(f) {
      sheetData.push([f, String(row1[f] !== undefined ? row1[f] : ''), String(row2[f] !== undefined ? row2[f] : '')]);
    });
    // Status banner at bottom
    sheetData.push(['', '', '']);
    if (matches.length !== 2) {
      sheetData.push(['STATUS', 'WARNING: Expected 2 rows, found ' + matches.length + '. Do not run fix.', '']);
    } else {
      sheetData.push(['STATUS', 'Two rows confirmed. Run runJob260337Fix() to void Row 2.', '']);
    }

    // Direct SpreadsheetApp: _TEMP_AUDIT_260337 is a one-time diagnostic output tab,
    // not a FACT table. DAL does not support tab creation or arbitrary-layout writes.
    var ss   = SpreadsheetApp.getActiveSpreadsheet();
    var tab  = ss.getSheetByName(AUDIT_TAB);
    if (tab) {
      tab.clearContents();
    } else {
      tab = ss.insertSheet(AUDIT_TAB);
    }
    tab.getRange(1, 1, sheetData.length, 3).setValues(sheetData);
    tab.getRange(1, 1, 1, 3).setFontWeight('bold');
    tab.setFrozenRows(1);
    tab.autoResizeColumns(1, 3);

    Logger.info('JOB260337_AUDIT_WRITTEN', { module: MODULE, tab: AUDIT_TAB, rows: sheetData.length });
  }

  /**
   * Voids the duplicate VW row for job 260337 — the newer (V3 portal
   * re-entry) row identified by the later created_at timestamp.
   * Writes JOB_DUPLICATE_VOIDED to FACT_JOB_EVENTS for the audit trail.
   * @param {string} actorEmail
   */
  function runFix(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    var matches = (vwRows || []).filter(function(r) {
      return String(r.job_number || '') === JOB_NUM;
    });

    if (matches.length === 0) {
      Logger.warn('JOB260337_FIX_NOT_FOUND', { module: MODULE, message: 'No VW rows for 260337 — nothing to do.' });
      return { status: 'NOT_FOUND' };
    }

    if (matches.length === 1) {
      var existing = String(matches[0].current_state || '');
      if (existing === 'VOIDED') {
        Logger.info('JOB260337_FIX_ALREADY_DONE', { module: MODULE, message: 'Single row already VOIDED — idempotent skip.' });
        return { status: 'ALREADY_DONE' };
      }
      Logger.warn('JOB260337_FIX_SINGLE_ROW', {
        module: MODULE, message: 'Only one row remains and it is not VOIDED. Duplicate may have been cleaned up already.',
        current_state: existing
      });
      return { status: 'SINGLE_ROW_NOT_VOIDED', current_state: existing };
    }

    // Sort by created_at ascending — oldest = migration row (keep), newest = duplicate (void)
    matches.sort(function(a, b) {
      var da = new Date(a.created_at);
      var db = new Date(b.created_at);
      if (!isNaN(da) && !isNaN(db)) return da - db;
      return a.created_at < b.created_at ? -1 : 1;
    });

    var keepRow  = matches[0]; // older — the migrated V2 row, source of truth
    var dupeRow  = matches[1]; // newer — Sarty's V3 portal re-entry

    if (String(dupeRow.current_state || '') === 'VOIDED') {
      Logger.info('JOB260337_FIX_ALREADY_DONE', {
        module:    MODULE,
        message:   'Duplicate row already VOIDED — idempotent skip.',
        created_at: dupeRow.created_at
      });
      return { status: 'ALREADY_DONE' };
    }

    Logger.info('JOB260337_FIX_START', {
      module:      MODULE,
      keepRow:     { created_at: keepRow.created_at, current_state: keepRow.current_state, allocated_to: keepRow.allocated_to },
      dupeRow:     { created_at: dupeRow.created_at, current_state: dupeRow.current_state, allocated_to: dupeRow.allocated_to }
    });

    // 1. Write audit event to FACT_JOB_EVENTS
    try {
      DAL.appendRow(Config.TABLES.FACT_JOB_EVENTS, {
        event_id:        Identifiers.generateId(),
        job_number:      JOB_NUM,
        period_id:       Identifiers.generateCurrentPeriodId(),
        event_type:      'JOB_DUPLICATE_VOIDED',
        current_state:   'VOIDED',
        prev_state:      String(dupeRow.current_state || ''),
        client_code:     CLIENT,
        allocated_to:    String(dupeRow.allocated_to || ''),
        notes:           'Duplicate VW row voided — job 260337 entered twice (V2 migration + V3 portal re-entry). Keeping older migration row as source of truth.',
        migration_batch: 'JOB260337_DEDUP_2026_06_19',
        created_by:      actor.personCode,
        created_at:      new Date().toISOString()
      }, { callerModule: MODULE });
    } catch(e) {
      Logger.error('JOB260337_FACT_FAIL', { module: MODULE, error: e.message });
      throw e;
    }

    // 2. Void the duplicate VW row using compound key (job_number + created_at)
    // created_at uniquely identifies the duplicate since the two rows have different timestamps.
    try {
      var result = DAL.updateWhere(
        Config.TABLES.VW_JOB_CURRENT_STATE,
        { job_number: JOB_NUM, created_at: String(dupeRow.created_at || '') },
        { current_state: 'VOIDED', updated_at: new Date().toISOString() },
        { callerModule: MODULE }
      );
      Logger.info('JOB260337_FIX_DONE', {
        module:     MODULE,
        message:    'Duplicate VW row voided. Billing engine will see only the kept migration row.',
        rowsUpdated: result.updated,
        dupeCreatedAt: dupeRow.created_at,
        keepCreatedAt: keepRow.created_at
      });
      return { status: 'FIXED', rowsUpdated: result.updated };
    } catch(e) {
      Logger.error('JOB260337_VW_FAIL', { module: MODULE, error: e.message });
      throw e;
    }
  }

  return { runAudit: runAudit, runFix: runFix };
}());

// ── Top-level runners ─────────────────────────────────────────

/** Audit: writes both VW rows for 260337 side-by-side to _TEMP_AUDIT_260337. No data changes. */
function runJob260337Audit() {
  var email = Session.getActiveUser().getEmail();
  Job260337DuplicateFixer.runAudit(email);
  console.log('Job 260337 audit complete — open _TEMP_AUDIT_260337 tab in the spreadsheet.');
}

/** Fix: void the duplicate (newer) VW row for job 260337. Run audit first. */
function runJob260337Fix() {
  var email  = Session.getActiveUser().getEmail();
  var result = Job260337DuplicateFixer.runFix(email);
  console.log('Job 260337 fix result: ' + JSON.stringify(result));
}
