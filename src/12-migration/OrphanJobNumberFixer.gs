// ============================================================
// OrphanJobNumberFixer.gs — BLC Nexus Retroactive Data Fix
// src/12-migration/OrphanJobNumberFixer.gs
//
// HOW TO RUN (Apps Script editor):
//   runOrphanJobNumberFixer()       — DRY RUN (default). No writes.
//   runOrphanJobNumberFixer(true)   — DRY RUN, explicit.
//   runOrphanJobNumberFixer(false)  — LIVE. Writes corrections.
//
// Fixes the post-cutover orphans (see WorkLogOrphanAudit.gs /
// runOrphanJobNumberNormalizationDiagnostic()) where stripping
// job_number down to the token before the first space or underscore
// resolves to a real VW_JOB_CURRENT_STATE row — e.g.
// "2605-6039-A Mary's Landing Lot 9-16 OWF" → "2605-6039-A".
//
// Skips:
//   - "job assign & help" (admin overhead, not a real job)
//   - orphans that do NOT resolve via normalization
//   - any FACT_WORK_LOGS row whose event_type is not in
//     Constants.CORRECTABLE_WORK_LOG_EVENT_TYPES (i.e. rows that are
//     themselves already a VOID/AMENDED correction, not an original
//     hours entry)
//
// MECHANISM — net-zero re-attribution, not an additive amendment:
// for each correctable row found under a resolvable orphan's raw
// job_number, writes a WORK_LOG_VOIDED row (same job_number/actor/
// date/period, hours negated) plus a WORK_LOG_SUBMITTED row (the
// normalized job_number, same actor/date/period/hours). Net change
// to the actor's total logged hours for that period is zero — only
// job attribution moves. This mirrors the existing WORK_LOG_REASSIGN
// pattern in WorkLogCorrectionHandler.gs.
//
// WHY NOT A SINGLE ADDITIVE WORK_LOG_AMENDED ROW: PayrollEngine.
// aggregateHours_() sums FACT_WORK_LOGS hours by actor_code + period
// only — it does not filter by job_number or event_type (it only
// excludes rows carrying a migration_batch value, a column that
// isn't present on the 2026-06/07 partitions these orphans live in).
// An additive row under the normalized job_number, with the original
// orphan row left untouched, would double the actor's counted hours
// the moment payroll runs for that period. Net-zero avoids that
// regardless of when payroll runs. Confirmed with Raj before building
// this — see 2026-07-08 session.
//
// IDEMPOTENT: idempotency_key = 'ORPHAN_JOB_FIX_<original event_id>'
// (+ '_VOID' / '_NEW' suffix on the two written rows). Checked both
// via a DAL scan (so dry-run can report "already fixed") and via
// IdempotencyEngine.checkAndMark() (Rule D1) before any live write —
// safe to re-run in live mode after a partial run.
//
// Dry-run performs no writes at all — read-only. Live mode writes to
// FACT_WORK_LOGS only, never to VW_JOB_CURRENT_STATE.
// ============================================================

var ORPHAN_FIX_BATCH_TAG = 'ORPHAN_JOB_NUMBER_FIX_2026-07';

/**
 * @param {boolean} [dryRun=true]  Pass false explicitly to write live corrections.
 * @returns {{ dryRun:boolean, resolvableOrphans:number, entriesFixed:number,
 *             entriesSkippedAlready:number, entriesSkippedEventType:number,
 *             hoursMoved:number }}
 */
function runOrphanJobNumberFixer(dryRun) {
  var MODULE = 'OrphanJobNumberFixer';
  if (dryRun === undefined) dryRun = true;

  Logger.info('ORPHAN_JOB_FIX_START', { module: MODULE, dryRun: dryRun });

  var result = computeWorkLogOrphans_(MODULE);

  // ── VW existence set (for normalization match) ──────────────
  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  var vwJobSet = {};
  for (var v = 0; v < vwRows.length; v++) {
    var vjn = String(vwRows[v].job_number || '').trim();
    if (vjn) vwJobSet[vjn] = true;
  }

  // ── Restrict to post-cutover orphans (same filter as runWorkLogOrphanAuditRecent()) ──
  var postCutoverOrphans = result.orphans.filter(function(o) {
    return POST_CUTOVER_PARTITIONS.indexOf(o.most_recent_partition) !== -1;
  });

  var resolvable         = [];
  var adminOverheadCount = 0;
  var unresolvedCount    = 0;

  for (var i = 0; i < postCutoverOrphans.length; i++) {
    var o = postCutoverOrphans[i];
    if (isAdminOverheadJobNumber_(o.job_number)) { adminOverheadCount++; continue; }
    var normalized = normalizeJobNumber_(o.job_number);
    if (!vwJobSet[normalized]) { unresolvedCount++; continue; }
    resolvable.push({
      raw:        o.job_number,
      normalized: normalized,
      partitions: o.partitions ? o.partitions.split(', ') : []
    });
  }

  console.log('[OrphanJobNumberFixer] Mode: ' + (dryRun ? 'DRY RUN — no writes' : 'LIVE — writes will be applied'));
  console.log('[OrphanJobNumberFixer] Post-cutover orphans scanned: ' + postCutoverOrphans.length);
  console.log('[OrphanJobNumberFixer] Admin overhead skipped ("job assign & help"): ' + adminOverheadCount);
  console.log('[OrphanJobNumberFixer] Unresolved (no VW match after normalization): ' + unresolvedCount);
  console.log('[OrphanJobNumberFixer] Resolvable job_numbers: ' + resolvable.length);

  var entriesFixed        = 0;
  var entriesAlreadyFixed = 0;
  var entriesBadEventType = 0;
  var hoursMoved          = 0;

  for (var r = 0; r < resolvable.length; r++) {
    var job = resolvable[r];

    for (var p = 0; p < job.partitions.length; p++) {
      var pid = job.partitions[p];
      var rows;
      try {
        rows = DAL.readWhere(
          Config.TABLES.FACT_WORK_LOGS,
          { job_number: job.raw },
          { periodId: pid, callerModule: MODULE }
        );
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') continue;
        throw e;
      }

      for (var i2 = 0; i2 < rows.length; i2++) {
        var row   = rows[i2];
        var etype = String(row.event_type || '');

        if (!Constants.CORRECTABLE_WORK_LOG_EVENT_TYPES[etype]) {
          entriesBadEventType++;
          console.log('[SKIP non-correctable event_type] ' + job.raw +
            ' event_id=' + row.event_id + ' event_type=' + etype);
          continue;
        }

        var originalEventId = row.event_id;
        var baseKey          = 'ORPHAN_JOB_FIX_' + originalEventId;
        var voidKey           = baseKey + '_VOID';
        var newKey            = baseKey + '_NEW';

        // ── Already fixed? (DAL scan — works in dry-run too) ────
        var already = DAL.readWhere(
          Config.TABLES.FACT_WORK_LOGS,
          { idempotency_key: voidKey },
          { periodId: pid, callerModule: MODULE }
        );
        if (already.length > 0) {
          entriesAlreadyFixed++;
          console.log('[ALREADY FIXED] ' + job.raw + ' → ' + job.normalized +
            ' event_id=' + originalEventId);
          continue;
        }

        var hours = parseFloat(row.hours) || 0;

        console.log((dryRun ? '[WOULD FIX] ' : '[FIXING] ') +
          job.raw + ' → ' + job.normalized +
          ' | event_id=' + originalEventId +
          ' | actor_code=' + row.actor_code +
          ' | hours=' + hours +
          ' | work_date=' + row.work_date +
          ' | partition=' + pid);

        if (dryRun) {
          entriesFixed++;
          hoursMoved += hours;
          continue;
        }

        // ── Idempotency (Rule D1) — one check gates both writes ──
        if (!IdempotencyEngine.checkAndMark(baseKey)) {
          Logger.warn('ORPHAN_JOB_FIX_DUPLICATE', { module: MODULE, event_id: originalEventId });
          entriesAlreadyFixed++;
          continue;
        }

        DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, pid, MODULE);

        var voidRow = {
          event_id:        Identifiers.generateId(),
          job_number:      job.raw,
          period_id:       pid,
          event_type:      Constants.EVENT_TYPES.WORK_LOG_VOIDED,
          timestamp:       new Date().toISOString(),
          actor_code:      row.actor_code || '',
          actor_role:      row.actor_role || '',
          hours:           -hours,
          work_date:       row.work_date,
          notes:           'Void of event_id ' + originalEventId + ' — job_number relocated to "' +
                            job.normalized + '" (' + ORPHAN_FIX_BATCH_TAG + ').',
          idempotency_key: voidKey,
          payload_json:    row.payload_json || ''
        };

        var newRow = {
          event_id:        Identifiers.generateId(),
          job_number:      job.normalized,
          period_id:       pid,
          event_type:      Constants.EVENT_TYPES.WORK_LOG_SUBMITTED,
          timestamp:       new Date().toISOString(),
          actor_code:      row.actor_code || '',
          actor_role:      row.actor_role || '',
          hours:           hours,
          work_date:       row.work_date,
          notes:           'Relocated from job_number "' + job.raw + '" (original event_id ' +
                            originalEventId + '). ' + ORPHAN_FIX_BATCH_TAG + '.',
          idempotency_key: newKey,
          payload_json:    row.payload_json || ''
        };

        try {
          DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, voidRow, { callerModule: MODULE, periodId: pid });
          DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, newRow,  { callerModule: MODULE, periodId: pid });
        } catch (e) {
          IdempotencyEngine.clear(baseKey);
          throw e;
        }

        Logger.info('ORPHAN_JOB_FIX_APPLIED', {
          module:              MODULE,
          original_event_id:   originalEventId,
          from_job:            job.raw,
          to_job:              job.normalized,
          actor_code:          row.actor_code,
          hours:               hours,
          period_id:           pid
        });

        entriesFixed++;
        hoursMoved += hours;
      }
    }
  }

  hoursMoved = Math.round(hoursMoved * 100) / 100;

  console.log('--- SUMMARY ---');
  console.log('Mode: ' + (dryRun ? 'DRY RUN — no writes' : 'LIVE — writes applied'));
  console.log('Resolvable job_numbers processed: ' + resolvable.length);
  console.log((dryRun ? 'Entries that WOULD be fixed: ' : 'Entries fixed: ') + entriesFixed);
  console.log('Entries already fixed (idempotent skip): ' + entriesAlreadyFixed);
  console.log('Entries skipped (non-correctable event_type): ' + entriesBadEventType);
  console.log('Hours ' + (dryRun ? 'that would move' : 'moved') + ' (net zero to actor totals): ' + hoursMoved);

  Logger.info('ORPHAN_JOB_FIX_DONE', {
    module:                  MODULE,
    dryRun:                  dryRun,
    resolvableJobNumbers:    resolvable.length,
    entriesFixed:            entriesFixed,
    entriesAlreadyFixed:     entriesAlreadyFixed,
    entriesSkippedEventType: entriesBadEventType,
    hoursMoved:              hoursMoved
  });

  return {
    dryRun:                   dryRun,
    resolvableOrphans:        resolvable.length,
    entriesFixed:             entriesFixed,
    entriesSkippedAlready:    entriesAlreadyFixed,
    entriesSkippedEventType:  entriesBadEventType,
    hoursMoved:               hoursMoved
  };
}
