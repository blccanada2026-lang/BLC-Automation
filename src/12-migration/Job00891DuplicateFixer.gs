// ============================================================
// Job00891DuplicateFixer.gs — BLC Nexus T12 Migration
// src/12-migration/Job00891DuplicateFixer.gs
//
// One-time fix for a PM-reported duplicate job creation (Sarty,
// 2026-08-05): creating one job (SBS/ROOF_TRUSS, "2608-9955 Litchfield
// Rev 1", assigned to Sayan Roy) resulted in two — BLC-00891 and
// BLC-00892 — 16.4 seconds apart (JobDuplicateTimingCheck.gs). Manually
// confirmed via the spreadsheet: BLC-00891 was put ON_HOLD with no work
// logged against it; BLC-00892 has real work logged. BLC-00892 is the
// job to keep; BLC-00891 is the duplicate to void.
//
// Same shape as Job260337DuplicateFixer.gs, adapted for two distinct
// job_numbers (each with its own single VW_JOB_CURRENT_STATE row)
// rather than one job_number with two VW rows.
//
// Step 1: runJob00891Audit()  — read-only, prints current state, no changes
// Step 2: runJob00891Fix()    — voids BLC-00891
// Idempotent: safe to re-run; already-voided job is skipped.
// ============================================================

var Job00891DuplicateFixer = (function () {

  var MODULE      = 'Job00891DuplicateFixer';
  var VOID_JOB     = 'BLC-00891';
  var KEEP_JOB     = 'BLC-00892';

  /**
   * Read-only — prints current state of both jobs. No changes.
   */
  function runAudit() {
    var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    var voidRow = null, keepRow = null;
    vwRows.forEach(function (r) {
      if (String(r.job_number || '') === VOID_JOB) voidRow = r;
      if (String(r.job_number || '') === KEEP_JOB) keepRow = r;
    });

    console.log('=== Job00891DuplicateFixer audit (read-only) ===');
    console.log(VOID_JOB + ' (void candidate): ' + (voidRow ? JSON.stringify(voidRow) : 'NOT FOUND'));
    console.log(KEEP_JOB + ' (keep): ' + (keepRow ? JSON.stringify(keepRow) : 'NOT FOUND'));

    if (!voidRow) {
      console.log('*** ' + VOID_JOB + ' not found — nothing to do. ***');
    } else if (String(voidRow.current_state || '') === 'VOIDED') {
      console.log('*** ' + VOID_JOB + ' is already VOIDED — fix already applied. ***');
    } else {
      console.log('Ready to run runJob00891Fix() — will void ' + VOID_JOB + ' (current_state: ' +
                  voidRow.current_state + '), keep ' + KEEP_JOB + ' untouched.');
    }

    return { voidRow: voidRow, keepRow: keepRow };
  }

  /**
   * Voids BLC-00891 — writes JOB_DUPLICATE_VOIDED to FACT_JOB_EVENTS,
   * sets VW_JOB_CURRENT_STATE.current_state = 'VOIDED' (same
   * out-of-band admin correction as Job260337DuplicateFixer.gs — not a
   * StateMachine.assertTransition() transition, a manual audit-trail
   * correction, matching that precedent exactly). BLC-00892 is never
   * touched.
   * @param {string} actorEmail
   */
  function runFix(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    var voidRow = null;
    vwRows.forEach(function (r) {
      if (String(r.job_number || '') === VOID_JOB) voidRow = r;
    });

    if (!voidRow) {
      Logger.warn('JOB00891_FIX_NOT_FOUND', { module: MODULE, message: VOID_JOB + ' not found — nothing to do.' });
      return { status: 'NOT_FOUND' };
    }

    if (String(voidRow.current_state || '') === 'VOIDED') {
      Logger.info('JOB00891_FIX_ALREADY_DONE', { module: MODULE, message: VOID_JOB + ' already VOIDED — idempotent skip.' });
      return { status: 'ALREADY_DONE' };
    }

    Logger.info('JOB00891_FIX_START', {
      module: MODULE, job_number: VOID_JOB, current_state: voidRow.current_state,
      allocated_to: voidRow.allocated_to
    });

    try {
      DAL.appendRow(Config.TABLES.FACT_JOB_EVENTS, {
        event_id:      Identifiers.generateId(),
        job_number:    VOID_JOB,
        period_id:     Identifiers.generateCurrentPeriodId(),
        event_type:    'JOB_DUPLICATE_VOIDED',
        current_state: 'VOIDED',
        prev_state:    String(voidRow.current_state || ''),
        client_code:   String(voidRow.client_code || ''),
        allocated_to:  String(voidRow.allocated_to || ''),
        notes:         'Duplicate of ' + KEEP_JOB + ' — same client/product/description, created 16.4s apart ' +
                        '(portal_createJob() called twice for one PM action, 2026-08-05). ' + KEEP_JOB +
                        ' has real work logged and is kept as the real job; ' + VOID_JOB +
                        ' was held with no work logged and is voided here.',
        created_by:    actor.personCode,
        created_at:    new Date().toISOString()
      }, { callerModule: MODULE });
    } catch (e) {
      Logger.error('JOB00891_FACT_FAIL', { module: MODULE, error: e.message });
      throw e;
    }

    try {
      var result = DAL.updateWhere(
        Config.TABLES.VW_JOB_CURRENT_STATE,
        { job_number: VOID_JOB },
        { current_state: 'VOIDED', updated_at: new Date().toISOString() },
        { callerModule: MODULE }
      );
      Logger.info('JOB00891_FIX_DONE', {
        module: MODULE, message: VOID_JOB + ' voided. ' + KEEP_JOB + ' is the real job, untouched.',
        rowsUpdated: result.updated
      });
      return { status: 'FIXED', rowsUpdated: result.updated };
    } catch (e) {
      Logger.error('JOB00891_VW_FAIL', { module: MODULE, error: e.message });
      throw e;
    }
  }

  return { runAudit: runAudit, runFix: runFix };
}());

// ── Top-level runners ─────────────────────────────────────────

/** Audit: prints current state of BLC-00891 and BLC-00892. No changes. */
function runJob00891Audit() {
  Job00891DuplicateFixer.runAudit();
}

/** Fix: voids BLC-00891 (the duplicate). BLC-00892 (the real job) is untouched. Run audit first. */
function runJob00891Fix() {
  var email  = Session.getActiveUser().getEmail();
  var result = Job00891DuplicateFixer.runFix(email);
  console.log('Job 00891 fix result: ' + JSON.stringify(result));
}
