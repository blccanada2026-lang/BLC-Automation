// ============================================================
// WorkLogDedupFixer.gs — BLC Nexus Category 1 Duplicate Void
// src/12-migration/WorkLogDedupFixer.gs
//
// HOW TO RUN (Apps Script editor):
//   runWorkLogDedupFixer_DryRun()  — preview, no writes
//   runWorkLogDedupFixer_LIVE()    — write void events to FACT_WORK_LOGS
//
// Voids the later duplicate row for each confirmed Category 1
// double-submit identified in the 2026-06 dedup audit.
//
// Each void is a WORK_LOG_DUPLICATE_VOIDED event written with
// negative hours equal to the duplicate — the timesheet engine
// nets these against the retained row and the correct hours remain.
//
// Idempotent: safe to re-run. Already-voided targets are skipped.
// ============================================================

/**
 * Category 1 duplicates confirmed by WorkLogDedupAudit on 2026-06-30.
 * Exact match on actor_code + job_number + work_date + hours + event_type.
 * Keep earliest row (lowest sheet index), void latest.
 */
var DEDUP_FIX_TARGETS_ = [
  { actor_code: 'AR001', job_number: 'BLC-00239', work_date: '2026-06-20', hours: 7,   event_type: 'WORK_LOG_SUBMITTED' },
  { actor_code: 'PBG',   job_number: 'BLC-00329', work_date: '2026-06-22', hours: 10,  event_type: 'WORK_LOG_SUBMITTED' },
  { actor_code: 'PBG',   job_number: 'BLC-00394', work_date: '2026-06-16', hours: 3,   event_type: 'WORK_LOG_SUBMITTED' },
  { actor_code: 'SGO',   job_number: 'BLC-00209', work_date: '2026-06-16', hours: 1.5, event_type: 'WORK_LOG_SUBMITTED' }
];

var DEDUP_FIX_PARTITION_ = '2026-06';

/**
 * Voids one duplicate row per Category 1 target.
 * Writes a WORK_LOG_DUPLICATE_VOIDED event with negative hours.
 * @param {boolean} [dryRun]  If true, logs intent but writes nothing.
 */
function runWorkLogDedupFixer(dryRun) {
  var MODULE = 'WorkLogDedupFixer';
  dryRun = !!dryRun;

  Logger.info('WORKLOG_DEDUP_FIXER_START', {
    module:    MODULE,
    partition: DEDUP_FIX_PARTITION_,
    targets:   DEDUP_FIX_TARGETS_.length,
    dry_run:   dryRun
  });

  // ── Read FACT_WORK_LOGS ──────────────────────────────────────
  var wlRows = [];
  try {
    wlRows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: MODULE,
      periodId:     DEDUP_FIX_PARTITION_
    });
  } catch (e) {
    throw new Error('WorkLogDedupFixer: cannot read FACT_WORK_LOGS — ' + e.message);
  }

  // ── Build idempotency set from existing void events ──────────
  var alreadyVoided = {};
  for (var i = 0; i < wlRows.length; i++) {
    if (String(wlRows[i].event_type || '') === 'WORK_LOG_DUPLICATE_VOIDED') {
      var ik = String(wlRows[i].idempotency_key || '');
      if (ik) alreadyVoided[ik] = true;
    }
  }

  // ── Process each target ──────────────────────────────────────
  var toWrite  = [];
  var skipped  = 0;
  var notFound = 0;

  for (var t = 0; t < DEDUP_FIX_TARGETS_.length; t++) {
    var tgt      = DEDUP_FIX_TARGETS_[t];
    var idempKey = 'DEDUP_VOID_' + tgt.actor_code + '_' +
                   tgt.job_number + '_' + tgt.work_date;

    if (alreadyVoided[idempKey]) {
      Logger.info('WORKLOG_DEDUP_FIXER_SKIP', { module: MODULE, key: idempKey });
      console.log('[WorkLogDedupFixer] SKIP (already voided): ' + idempKey);
      skipped++;
      continue;
    }

    // Find all rows matching this target exactly
    var matching = [];
    for (var r = 0; r < wlRows.length; r++) {
      var row = wlRows[r];
      if (String(row.actor_code  || '').trim().toUpperCase() !== tgt.actor_code)  continue;
      if (String(row.job_number  || '').trim()               !== tgt.job_number)  continue;
      if (String(row.event_type  || '').trim()               !== tgt.event_type)  continue;
      if (parseFloat(row.hours)                              !== tgt.hours)       continue;
      if (normWdFixer_(row.work_date)                        !== tgt.work_date)   continue;
      matching.push({ row: row, idx: r });
    }

    if (matching.length < 2) {
      Logger.warn('WORKLOG_DEDUP_FIXER_NOT_FOUND', {
        module: MODULE, key: idempKey, found: matching.length
      });
      console.log('[WorkLogDedupFixer] WARN: expected ≥2 rows, found ' +
                  matching.length + ' for ' + idempKey);
      notFound++;
      continue;
    }

    // Keep earliest (lowest sheet index), void latest
    matching.sort(function(a, b) { return a.idx - b.idx; });
    var keptRow   = matching[0].row;
    var voidedRow = matching[matching.length - 1].row;

    var voidEvent = {
      event_id:        Identifiers.generateId(),
      job_number:      tgt.job_number,
      period_id:       DEDUP_FIX_PARTITION_,
      event_type:      'WORK_LOG_DUPLICATE_VOIDED',
      timestamp:       new Date().toISOString(),
      actor_code:      tgt.actor_code,
      actor_role:      String(keptRow.actor_role || ''),
      hours:           -tgt.hours,
      work_date:       tgt.work_date,
      notes:           'Category 1 duplicate void. ' +
                       'Kept: '   + (keptRow.event_id   || 'row#' + (matching[0].idx + 1)) + ' | ' +
                       'Voided: ' + (voidedRow.event_id || 'row#' + (matching[matching.length - 1].idx + 1)) + ' | ' +
                       'Fixer: WorkLogDedupFixer 2026-06-30',
      idempotency_key: idempKey,
      payload_json:    ''
    };

    toWrite.push(voidEvent);
    console.log('[WorkLogDedupFixer] ' + (dryRun ? 'DRY-RUN ' : '') + 'VOID: ' +
                tgt.actor_code + ' / ' + tgt.job_number + ' / ' +
                tgt.work_date  + ' / -' + tgt.hours + 'h');
  }

  // ── Write void events ────────────────────────────────────────
  if (toWrite.length > 0 && !dryRun) {
    BatchOperations.appendRows(Config.TABLES.FACT_WORK_LOGS, toWrite);
    Logger.info('WORKLOG_DEDUP_FIXER_WRITTEN', { module: MODULE, count: toWrite.length });
  }

  var written = dryRun ? 0 : toWrite.length;
  Logger.info('WORKLOG_DEDUP_FIXER_DONE', {
    module:    MODULE,
    written:   written,
    skipped:   skipped,
    not_found: notFound,
    dry_run:   dryRun
  });
  console.log('[WorkLogDedupFixer] ' + (dryRun ? 'DRY-RUN complete' : 'Done') +
              ' — written: ' + written +
              ' | skipped: ' + skipped +
              ' | not found: ' + notFound);

  return { written: written, skipped: skipped, not_found: notFound };
}

// ── Private helpers ───────────────────────────────────────────

function normWdFixer_(raw) {
  if (!raw) return '';
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return '';
    var y = raw.getFullYear(), mo = raw.getMonth() + 1, d = raw.getDate();
    return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
  }
  var s      = String(raw).trim();
  var iso    = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    var py = parsed.getFullYear(), pm = parsed.getMonth() + 1, pd = parsed.getDate();
    return py + '-' + (pm < 10 ? '0' : '') + pm + '-' + (pd < 10 ? '0' : '') + pd;
  }
  return s;
}

/** Dry-run — previews voids without writing. */
function runWorkLogDedupFixer_DryRun() { runWorkLogDedupFixer(true); }

/** Live run — writes WORK_LOG_DUPLICATE_VOIDED events to FACT_WORK_LOGS. */
function runWorkLogDedupFixer_LIVE()   { runWorkLogDedupFixer(false); }
