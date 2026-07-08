// ============================================================
// NorspanClientCodeFixer.gs — BLC Nexus T12 Migration
// src/12-migration/NorspanClientCodeFixer.gs
//
// Corrects VW_JOB_CURRENT_STATE rows with client_code = 'NORSPAN'
// to the correct code 'NORSPAN-MB', per CTO directive (2026-07-08 —
// Sarty's duplicate-client report, see NorspanClientDuplicateAudit.gs).
//
// HOW TO RUN (Apps Script editor):
//   runNorspanClientCodeFix()       — DRY RUN. Lists every matching
//                                     job. No writes.
//   runNorspanClientCodeFix_LIVE()  — LIVE. Updates client_code on
//                                     each matching VW row and writes
//                                     a JOB_CLIENT_CODE_CORRECTED
//                                     event to FACT_JOB_EVENTS per job.
//
// Idempotent: the VW match condition is client_code = 'NORSPAN' exactly,
// so a row already corrected to 'NORSPAN-MB' never matches again on a
// re-run. The FACT_JOB_EVENTS write is additionally guarded per job by
// a DAL scan for an existing correction event plus IdempotencyEngine,
// so a partial prior run (crashed mid-loop) can be safely re-run.
//
// This only fixes VW_JOB_CURRENT_STATE + the audit trail. It does NOT
// touch DIM_CLIENT_MASTER — if a duplicate "NORSPAN" row exists there
// (see NorspanClientDuplicateAudit.gs findings), that is a separate,
// deliberate cleanup step.
// ============================================================

var NorspanClientCodeFixer = (function() {

  var MODULE     = 'NorspanClientCodeFixer';
  var OLD_CLIENT = 'NORSPAN';
  var NEW_CLIENT = 'NORSPAN-MB';

  /** Returns every VW_JOB_CURRENT_STATE row with client_code exactly 'NORSPAN'. */
  function findMatches_() {
    var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    return (vwRows || []).filter(function(r) {
      return String(r.client_code || '').trim() === OLD_CLIENT;
    });
  }

  /**
   * Dry run — lists every VW_JOB_CURRENT_STATE row with client_code = 'NORSPAN'.
   * No writes.
   * @param {string} actorEmail
   */
  function runDryRun(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    var matches = findMatches_();

    console.log('=== NORSPAN → NORSPAN-MB client_code fix — DRY RUN ===');
    console.log('VW_JOB_CURRENT_STATE rows with client_code = "' + OLD_CLIENT + '": ' + matches.length);
    console.log('');

    for (var i = 0; i < matches.length; i++) {
      var r = matches[i];
      console.log('[' + (i + 1) + '] job_number=' + String(r.job_number || '') +
        ' | current_state=' + String(r.current_state || '') +
        ' | allocated_to=' + String(r.allocated_to || '') +
        ' | created_at=' + String(r.created_at || ''));
    }

    console.log('');
    console.log('--- SUMMARY ---');
    console.log('Jobs that WOULD be updated to client_code="' + NEW_CLIENT + '": ' + matches.length);
    console.log('No changes made — run runNorspanClientCodeFix_LIVE() to apply.');

    Logger.info('NORSPAN_CLIENT_FIX_DRY_RUN', { module: MODULE, matchCount: matches.length });

    return {
      dryRun:     true,
      matchCount: matches.length,
      jobNumbers: matches.map(function(r) { return String(r.job_number || ''); })
    };
  }

  /**
   * Live run — updates client_code NORSPAN -> NORSPAN-MB on each matching
   * VW row and writes a JOB_CLIENT_CODE_CORRECTED event to FACT_JOB_EVENTS
   * per job. Idempotent — see file header.
   * @param {string} actorEmail
   */
  function runLive(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    var matches  = findMatches_();
    var periodId = Identifiers.generateCurrentPeriodId();

    DAL.ensurePartition(Config.TABLES.FACT_JOB_EVENTS, periodId, MODULE);

    console.log('=== NORSPAN → NORSPAN-MB client_code fix — LIVE ===');
    console.log('VW_JOB_CURRENT_STATE rows with client_code = "' + OLD_CLIENT + '": ' + matches.length);
    console.log('');

    var fixed = 0, alreadyDone = 0, failed = 0;

    for (var i = 0; i < matches.length; i++) {
      var row       = matches[i];
      var jobNumber = String(row.job_number || '');
      if (!jobNumber) continue;

      var idKey = 'NORSPAN_CLIENT_FIX_' + jobNumber;

      // ── Already corrected? (DAL scan — covers a crashed/partial prior run) ──
      var already = [];
      try {
        already = DAL.readWhere(
          Config.TABLES.FACT_JOB_EVENTS,
          { idempotency_key: idKey },
          { periodId: periodId, callerModule: MODULE }
        );
      } catch (e) {
        if (e.code !== 'SHEET_NOT_FOUND') throw e;
      }
      if (already.length > 0) {
        alreadyDone++;
        console.log('[ALREADY FIXED] ' + jobNumber);
        continue;
      }

      // ── Idempotency (Rule D1) ────────────────────────────────
      if (!IdempotencyEngine.checkAndMark(idKey)) {
        alreadyDone++;
        console.log('[ALREADY FIXED — idempotency key] ' + jobNumber);
        continue;
      }

      // 1. Write audit event to FACT_JOB_EVENTS first (same order as
      //    Job260337DuplicateFixer.gs — audit trail before the VW change).
      try {
        DAL.appendRow(Config.TABLES.FACT_JOB_EVENTS, {
          event_id:        Identifiers.generateId(),
          job_number:      jobNumber,
          period_id:       periodId,
          event_type:      'JOB_CLIENT_CODE_CORRECTED',
          timestamp:       new Date().toISOString(),
          actor_code:      actor.personCode || '',
          actor_role:      actor.role || '',
          client_code:     NEW_CLIENT,
          notes:           'client_code corrected: ' + OLD_CLIENT + ' → ' + NEW_CLIENT + ' per CTO directive',
          idempotency_key: idKey,
          payload_json:    JSON.stringify({ old_client_code: OLD_CLIENT, new_client_code: NEW_CLIENT })
        }, { callerModule: MODULE, periodId: periodId });
      } catch (e) {
        IdempotencyEngine.clear(idKey);
        Logger.error('NORSPAN_CLIENT_FIX_FACT_FAIL', { module: MODULE, job_number: jobNumber, error: e.message });
        failed++;
        continue;
      }

      // 2. Update the VW row — compound match (job_number + old client_code)
      //    so a row already corrected between the read and the write is
      //    left alone rather than silently re-matched.
      try {
        var result = DAL.updateWhere(
          Config.TABLES.VW_JOB_CURRENT_STATE,
          { job_number: jobNumber, client_code: OLD_CLIENT },
          { client_code: NEW_CLIENT, updated_at: new Date().toISOString() },
          { callerModule: MODULE }
        );
        console.log('[FIXED] ' + jobNumber + ' — client_code NORSPAN → NORSPAN-MB (' + result.updated + ' row(s) updated)');
        fixed++;
      } catch (e) {
        Logger.error('NORSPAN_CLIENT_FIX_VW_FAIL', { module: MODULE, job_number: jobNumber, error: e.message });
        failed++;
      }
    }

    console.log('');
    console.log('--- SUMMARY ---');
    console.log('Fixed: ' + fixed);
    console.log('Already fixed (idempotent skip): ' + alreadyDone);
    console.log('Failed: ' + failed);

    Logger.info('NORSPAN_CLIENT_FIX_DONE', {
      module: MODULE, fixed: fixed, alreadyDone: alreadyDone, failed: failed
    });

    return { fixed: fixed, alreadyDone: alreadyDone, failed: failed };
  }

  return { runDryRun: runDryRun, runLive: runLive };
}());

// ── Top-level runners ─────────────────────────────────────────

/** Dry run — lists all VW_JOB_CURRENT_STATE jobs with client_code='NORSPAN'. No writes. */
function runNorspanClientCodeFix() {
  var email = Session.getActiveUser().getEmail();
  return NorspanClientCodeFixer.runDryRun(email);
}

/** Live — corrects client_code NORSPAN -> NORSPAN-MB + writes audit events. Run dry run first. */
function runNorspanClientCodeFix_LIVE() {
  var email = Session.getActiveUser().getEmail();
  return NorspanClientCodeFixer.runLive(email);
}
