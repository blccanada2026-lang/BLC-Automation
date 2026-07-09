// ============================================================
// TestWorkLogVoidFixer.gs — BLC Nexus T12 Migration
// src/12-migration/TestWorkLogVoidFixer.gs
//
// PROD contamination cleanup — Fix 4. Voids every FACT_WORK_LOGS
// entry with actor_code = 'DS1' in the 2026-06 and 2026-07
// partitions — test artifacts from PROD test suite contamination
// (see runFullContaminationDiscovery.gs, TestStaffDeactivator.gs).
//
// Net-zero void (same pattern as OrphanJobNumberFixer.gs): each
// original entry gets a matching WORK_LOG_VOIDED row with the SAME
// job_number/actor_code/work_date but NEGATED hours. This is
// required, not cosmetic — PayrollEngine.aggregateHours_() sums
// FACT_WORK_LOGS by actor_code+period_id regardless of DIM_STAFF_ROSTER
// active status, so a flag-only "void" event would not by itself
// prevent these hours from being counted in a payroll run.
//
// HOW TO RUN (Apps Script editor):
//   runTestWorkLogVoid()       — DRY RUN. Lists every matching
//                                entry. No writes.
//   runTestWorkLogVoid_LIVE()  — LIVE. Writes a WORK_LOG_VOIDED row
//                                (hours negated) per matching entry.
//
// Idempotent: the FACT_WORK_LOGS write is guarded per original
// event_id by a DAL scan for an existing void event plus
// IdempotencyEngine, so a partial prior run (crashed mid-loop) can
// be safely re-run.
// ============================================================

var TestWorkLogVoidFixer = (function() {

  var MODULE       = 'TestWorkLogVoidFixer';
  var TARGET_CODE   = 'DS1';
  var TARGET_PERIODS = ['2026-06', '2026-07'];
  var VOID_NOTES    = 'Voided — test artifact from PROD test suite contamination';

  /** Returns [{ periodId, row }] for every TARGET_CODE entry across TARGET_PERIODS. */
  function findMatches_() {
    var matches = [];
    TARGET_PERIODS.forEach(function(periodId) {
      var rows;
      try {
        rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: MODULE, periodId: periodId });
      } catch (e) {
        console.log('  [' + periodId + '] ERROR reading partition: ' + e.message);
        return;
      }
      (rows || []).forEach(function(r) {
        if (String(r.actor_code || '').trim().toUpperCase() === TARGET_CODE) {
          matches.push({ periodId: periodId, row: r });
        }
      });
    });
    return matches;
  }

  /**
   * Dry run — lists every matching FACT_WORK_LOGS entry. No writes.
   * @param {string} actorEmail
   */
  function runDryRun(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    var matches = findMatches_();
    var totalHours = 0;

    console.log('=== Test work log void — actor_code="' + TARGET_CODE + '" — DRY RUN ===');
    console.log('Partitions scanned: ' + TARGET_PERIODS.join(', '));
    console.log('Matching entries: ' + matches.length);
    console.log('');

    matches.forEach(function(m, i) {
      var hours = parseFloat(m.row.hours) || 0;
      totalHours += hours;
      console.log('[' + (i + 1) + '] partition=' + m.periodId +
        ' | event_id=' + String(m.row.event_id || '') +
        ' | job_number=' + String(m.row.job_number || '') +
        ' | work_date=' + String(m.row.work_date || '') +
        ' | hours=' + hours +
        ' | event_type=' + String(m.row.event_type || ''));
    });

    console.log('');
    console.log('--- SUMMARY ---');
    console.log('Entries that WOULD be voided: ' + matches.length);
    console.log('Total hours that WOULD be voided: ' + (Math.round(totalHours * 100) / 100));
    console.log('No changes made — run runTestWorkLogVoid_LIVE() to apply.');

    Logger.info('TEST_WORKLOG_VOID_DRY_RUN', { module: MODULE, matchCount: matches.length, totalHours: totalHours });

    return { dryRun: true, matchCount: matches.length, totalHours: Math.round(totalHours * 100) / 100 };
  }

  /**
   * Live run — writes a WORK_LOG_VOIDED row (negated hours) for every
   * matching entry. Idempotent — see file header.
   * @param {string} actorEmail
   */
  function runLive(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    var matches = findMatches_();

    console.log('=== Test work log void — actor_code="' + TARGET_CODE + '" — LIVE ===');
    console.log('Partitions scanned: ' + TARGET_PERIODS.join(', '));
    console.log('Matching entries: ' + matches.length);
    console.log('');

    var voided = 0, alreadyDone = 0, failed = 0, totalHoursVoided = 0;

    matches.forEach(function(m) {
      var periodId       = m.periodId;
      var row            = m.row;
      var originalEventId = String(row.event_id || '');
      if (!originalEventId) return;

      var idKey = 'TEST_WORKLOG_VOID_' + originalEventId;

      // ── Already voided? (DAL scan — covers a crashed/partial prior run) ──
      var already = [];
      try {
        already = DAL.readWhere(
          Config.TABLES.FACT_WORK_LOGS,
          { idempotency_key: idKey },
          { periodId: periodId, callerModule: MODULE }
        );
      } catch (e) {
        if (e.code !== 'SHEET_NOT_FOUND') throw e;
      }
      if (already.length > 0) {
        alreadyDone++;
        console.log('[ALREADY VOIDED] event_id=' + originalEventId);
        return;
      }

      // ── Idempotency (Rule D1) ────────────────────────────────
      if (!IdempotencyEngine.checkAndMark(idKey)) {
        alreadyDone++;
        console.log('[ALREADY VOIDED — idempotency key] event_id=' + originalEventId);
        return;
      }

      var hours = parseFloat(row.hours) || 0;

      try {
        DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
          event_id:        Identifiers.generateId(),
          job_number:      row.job_number || '',
          period_id:       periodId,
          event_type:      Constants.EVENT_TYPES.WORK_LOG_VOIDED,
          timestamp:       new Date().toISOString(),
          actor_code:      row.actor_code || '',
          actor_role:      row.actor_role || '',
          hours:           -hours,
          work_date:       row.work_date || '',
          notes:           VOID_NOTES + ' (original event_id ' + originalEventId + ')',
          idempotency_key: idKey,
          payload_json:    row.payload_json || ''
        }, { callerModule: MODULE, periodId: periodId });

        console.log('[VOIDED] event_id=' + originalEventId + ' | job_number=' + (row.job_number || '') +
          ' | hours=' + hours + ' | partition=' + periodId);
        voided++;
        totalHoursVoided += hours;
      } catch (e) {
        IdempotencyEngine.clear(idKey);
        Logger.error('TEST_WORKLOG_VOID_FAIL', { module: MODULE, event_id: originalEventId, error: e.message });
        console.log('[FAILED] event_id=' + originalEventId + ' — ' + e.message);
        failed++;
      }
    });

    console.log('');
    console.log('--- SUMMARY ---');
    console.log('Voided: ' + voided);
    console.log('Already voided (idempotent skip): ' + alreadyDone);
    console.log('Failed: ' + failed);
    console.log('Total hours voided: ' + (Math.round(totalHoursVoided * 100) / 100));

    Logger.info('TEST_WORKLOG_VOID_DONE', {
      module: MODULE, voided: voided, alreadyDone: alreadyDone, failed: failed, totalHoursVoided: totalHoursVoided
    });

    return { voided: voided, alreadyDone: alreadyDone, failed: failed, totalHoursVoided: Math.round(totalHoursVoided * 100) / 100 };
  }

  return { runDryRun: runDryRun, runLive: runLive };
}());

// ── Top-level runners ─────────────────────────────────────────

/** Dry run — lists every FACT_WORK_LOGS entry with actor_code='DS1' in 2026-06/2026-07. No writes. */
function runTestWorkLogVoid() {
  var email = Session.getActiveUser().getEmail();
  return TestWorkLogVoidFixer.runDryRun(email);
}

/** Live — voids (net-zero) every matching DS1 entry. Run dry run first. */
function runTestWorkLogVoid_LIVE() {
  var email = Session.getActiveUser().getEmail();
  return TestWorkLogVoidFixer.runLive(email);
}
