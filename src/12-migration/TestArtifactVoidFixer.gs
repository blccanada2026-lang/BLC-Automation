// ============================================================
// TestArtifactVoidFixer.gs — BLC Nexus T12 Migration
// src/12-migration/TestArtifactVoidFixer.gs
//
// Voids VW_JOB_CURRENT_STATE rows with client_code = 'NORSPAN'
// (not 'NORSPAN-MB'). These are test-pollution artifacts, not
// miscoded real client jobs — DIM_CLIENT_MASTER has exactly one
// real Norspan row (client_code 'NORSPAN-MB'), and the Create New
// Job portal form was confirmed to submit client_code correctly
// (see PortalView.html investigation, 2026-07-08). 'NORSPAN' alone
// was never a value a real user could select — it only ever came
// from TestHarness.gs/TestRunner.gs hardcoding it as their fixture
// client_code, deployed to and executable in PROD before the
// Config.isDev() test-isolation guard (2026-07-08).
//
// This is why these rows are VOIDED here, not corrected to
// NORSPAN-MB — correcting them would inject fake test jobs into
// the real client's real billing history. See
// NorspanClientCodeFixer.gs (built earlier, before this root cause
// was confirmed) — that fixer's LIVE path should NOT be run against
// these rows.
//
// HOW TO RUN (Apps Script editor):
//   runTestArtifactVoid()       — DRY RUN. Lists every matching job.
//                                 No writes.
//   runTestArtifactVoid_LIVE()  — LIVE. Writes a JOB_VOIDED event to
//                                 FACT_JOB_EVENTS per job (same
//                                 pattern as StaleJobVoidEngine.gs),
//                                 then marks the VW row
//                                 current_state='VOIDED'.
//
// Idempotent: skips any row already current_state='VOIDED'. The
// FACT_JOB_EVENTS write is additionally guarded per job by a DAL
// scan for an existing void event plus IdempotencyEngine, so a
// partial prior run (crashed mid-loop) can be safely re-run.
// ============================================================

var TestArtifactVoidFixer = (function() {

  var MODULE      = 'TestArtifactVoidFixer';
  var TARGET_CODE = 'NORSPAN';

  /** Returns every VW_JOB_CURRENT_STATE row with client_code exactly
   *  'NORSPAN' that isn't already voided. */
  function findMatches_() {
    var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    return (vwRows || []).filter(function(r) {
      return String(r.client_code || '').trim() === TARGET_CODE &&
             String(r.current_state || '') !== 'VOIDED';
    });
  }

  /**
   * Dry run — lists every VW_JOB_CURRENT_STATE row with
   * client_code = 'NORSPAN'. No writes.
   * @param {string} actorEmail
   */
  function runDryRun(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    var matches = findMatches_();

    console.log('=== Test artifact void — client_code="' + TARGET_CODE + '" — DRY RUN ===');
    console.log('VW_JOB_CURRENT_STATE rows with client_code = "' + TARGET_CODE + '" (not already voided): ' + matches.length);
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
    console.log('Jobs that WOULD be voided: ' + matches.length);
    console.log('No changes made — run runTestArtifactVoid_LIVE() to apply.');

    Logger.info('TEST_ARTIFACT_VOID_DRY_RUN', { module: MODULE, matchCount: matches.length });

    return {
      dryRun:     true,
      matchCount: matches.length,
      jobNumbers: matches.map(function(r) { return String(r.job_number || ''); })
    };
  }

  /**
   * Live run — writes a JOB_VOIDED event to FACT_JOB_EVENTS and marks
   * each matching VW row current_state='VOIDED'. Idempotent — see
   * file header.
   * @param {string} actorEmail
   */
  function runLive(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    var matches  = findMatches_();
    var periodId = Identifiers.generateCurrentPeriodId();

    DAL.ensurePartition(Config.TABLES.FACT_JOB_EVENTS, periodId, MODULE);

    console.log('=== Test artifact void — client_code="' + TARGET_CODE + '" — LIVE ===');
    console.log('VW_JOB_CURRENT_STATE rows with client_code = "' + TARGET_CODE + '" (not already voided): ' + matches.length);
    console.log('');

    var voided = 0, alreadyDone = 0, failed = 0;

    for (var i = 0; i < matches.length; i++) {
      var row       = matches[i];
      var jobNumber = String(row.job_number || '');
      if (!jobNumber) continue;

      var idKey = 'TEST_ARTIFACT_VOID_' + jobNumber;

      // ── Already voided? (DAL scan — covers a crashed/partial prior run) ──
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
        console.log('[ALREADY VOIDED] ' + jobNumber);
        continue;
      }

      // ── Idempotency (Rule D1) ────────────────────────────────
      if (!IdempotencyEngine.checkAndMark(idKey)) {
        alreadyDone++;
        console.log('[ALREADY VOIDED — idempotency key] ' + jobNumber);
        continue;
      }

      // 1. Write audit event to FACT_JOB_EVENTS first (same order/shape
      //    as StaleJobVoidEngine.gs — audit trail before the VW change).
      try {
        DAL.appendRow(Config.TABLES.FACT_JOB_EVENTS, {
          event_id:        Identifiers.generateId(),
          job_number:      jobNumber,
          period_id:       periodId,
          event_type:      'JOB_VOIDED',
          timestamp:       new Date().toISOString(),
          actor_code:      actor.personCode || '',
          actor_role:      actor.role || '',
          current_state:   'VOIDED',
          prev_state:      String(row.current_state || ''),
          client_code:     TARGET_CODE,
          allocated_to:    String(row.allocated_to || ''),
          notes:           'Test-pollution artifact — client_code="' + TARGET_CODE +
                            '" was never a legitimate portal value (real Norspan client is NORSPAN-MB). ' +
                            'Voided, not corrected, per CTO directive 2026-07-08.',
          idempotency_key: idKey,
          payload_json:    JSON.stringify({ client_code: TARGET_CODE, action: 'VOID' })
        }, { callerModule: MODULE, periodId: periodId });
      } catch (e) {
        IdempotencyEngine.clear(idKey);
        Logger.error('TEST_ARTIFACT_VOID_FACT_FAIL', { module: MODULE, job_number: jobNumber, error: e.message });
        failed++;
        continue;
      }

      // 2. Mark the VW row VOIDED — compound match (job_number + old
      //    client_code) so a row already corrected/voided between the
      //    read and the write is left alone rather than silently re-matched.
      try {
        DAL.updateWhere(
          Config.TABLES.VW_JOB_CURRENT_STATE,
          { job_number: jobNumber, client_code: TARGET_CODE },
          { current_state: 'VOIDED', updated_at: new Date().toISOString() },
          { callerModule: MODULE }
        );
        console.log('[VOIDED] ' + jobNumber);
        voided++;
      } catch (e) {
        Logger.error('TEST_ARTIFACT_VOID_VW_FAIL', { module: MODULE, job_number: jobNumber, error: e.message });
        failed++;
      }
    }

    console.log('');
    console.log('--- SUMMARY ---');
    console.log('Voided: ' + voided);
    console.log('Already voided (idempotent skip): ' + alreadyDone);
    console.log('Failed: ' + failed);

    Logger.info('TEST_ARTIFACT_VOID_DONE', {
      module: MODULE, voided: voided, alreadyDone: alreadyDone, failed: failed
    });

    return { voided: voided, alreadyDone: alreadyDone, failed: failed };
  }

  return { runDryRun: runDryRun, runLive: runLive };
}());

// ── Top-level runners ─────────────────────────────────────────

/** Dry run — lists all VW_JOB_CURRENT_STATE jobs with client_code='NORSPAN'. No writes. */
function runTestArtifactVoid() {
  var email = Session.getActiveUser().getEmail();
  return TestArtifactVoidFixer.runDryRun(email);
}

/** Live — voids client_code='NORSPAN' jobs (JOB_VOIDED event + VW current_state=VOIDED). Run dry run first. */
function runTestArtifactVoid_LIVE() {
  var email = Session.getActiveUser().getEmail();
  return TestArtifactVoidFixer.runLive(email);
}
