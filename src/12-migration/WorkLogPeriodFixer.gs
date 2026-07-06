// ============================================================
// WorkLogPeriodFixer.gs — BLC Nexus Migration
// src/12-migration/WorkLogPeriodFixer.gs
//
// Fixes malformed period_id values in FACT_WORK_LOGS.
// Some migration batches wrote period_id as a Date object or
// date string (e.g. "2026-06-01") instead of the required YYYY-MM
// format. This script appends a WORK_LOG_PERIOD_FIXED amendment
// event for each affected row so the correct period_id is
// represented in the audit trail.
//
// FACT tables are append-only (Rule A5) — original rows are NOT
// modified. The amendment event is the authoritative correction.
//
// HOW TO RUN (Apps Script editor):
//   runWorkLogPeriodFixer_DryRun()   — preview, no writes
//   runWorkLogPeriodFixer_LIVE()     — write amendment events
//
// Idempotent: already-fixed rows (existing WORK_LOG_PERIOD_FIXED
// with matching amendment_of) are skipped.
// ============================================================

var WorkLogPeriodFixer = (function () {

  var MODULE = 'WorkLogPeriodFixer';

  // All FACT_WORK_LOGS partitions that may contain migration rows.
  var SCAN_PARTITIONS = [
    '2025-10', '2025-11', '2025-12',
    '2026-01', '2026-02', '2026-03',
    '2026-04', '2026-05', '2026-06', '2026-07'
  ];

  // ── Helpers ──────────────────────────────────────────────────

  function isMalformed_(val) {
    if (val instanceof Date) return true;
    return !/^\d{4}-\d{2}$/.test(String(val || '').trim());
  }

  function toPeriodId_(val) {
    if (val instanceof Date) {
      if (isNaN(val.getTime())) return null;
      var y = val.getFullYear(), m = val.getMonth() + 1;
      return y + '-' + (m < 10 ? '0' : '') + m;
    }
    var s = String(val || '').trim();
    var hit = s.match(/^(\d{4})-(\d{2})/);
    if (hit) return hit[1] + '-' + hit[2];
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      var dy = d.getFullYear(), dm = d.getMonth() + 1;
      return dy + '-' + (dm < 10 ? '0' : '') + dm;
    }
    return null;
  }

  // ── Core ─────────────────────────────────────────────────────

  function run(dryRun) {
    dryRun = !!dryRun;

    Logger.info('WL_PERIOD_FIXER_START', { module: MODULE, dry_run: dryRun });

    var totalScanned = 0;
    var totalFixed   = 0;
    var totalSkipped = 0;
    var totalUnparseable = 0;

    for (var p = 0; p < SCAN_PARTITIONS.length; p++) {
      var partition = SCAN_PARTITIONS[p];
      var rows;

      try {
        rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
          callerModule: MODULE,
          periodId:     partition
        });
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') continue;
        throw e;
      }

      if (!rows || rows.length === 0) continue;
      totalScanned += rows.length;

      // ── Build idempotency set from existing fix events ───────
      var alreadyFixed = {};
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i].event_type || '') === Constants.EVENT_TYPES.WORK_LOG_PERIOD_FIXED) {
          var ref = String(rows[i].amendment_of || '');
          if (ref) alreadyFixed[ref] = true;
        }
      }

      // ── Find malformed rows and build amendment events ───────
      var toWrite = [];
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        if (!isMalformed_(row.period_id)) continue;

        var originalId = String(row.event_id || '').trim();
        if (!originalId) continue;

        if (alreadyFixed[originalId]) {
          totalSkipped++;
          continue;
        }

        var corrected = toPeriodId_(row.period_id);
        if (!corrected) {
          console.log('[WorkLogPeriodFixer] UNPARSEABLE period_id for event_id=' +
                      originalId + ' value=' + String(row.period_id));
          totalUnparseable++;
          continue;
        }

        var rawVal = (row.period_id instanceof Date)
          ? row.period_id.toISOString()
          : String(row.period_id);

        var fixEvent = {
          event_id:        Identifiers.generateId(),
          job_number:      String(row.job_number  || ''),
          period_id:       corrected,
          event_type:      Constants.EVENT_TYPES.WORK_LOG_PERIOD_FIXED,
          timestamp:       new Date().toISOString(),
          actor_code:      String(row.actor_code  || ''),
          actor_role:      String(row.actor_role  || ''),
          hours:           0,
          work_date:       String(row.work_date   || ''),
          amendment_of:    originalId,
          notes:           'period_id normalised: "' + rawVal + '" → "' + corrected +
                           '". Original event_id: ' + originalId +
                           '. Fixed by WorkLogPeriodFixer.',
          idempotency_key: 'WL_PERIOD_FIX_' + originalId,
          migration_batch: 'PERIOD_FIX_2026-07',
          payload_json:    ''
        };

        toWrite.push({ event: fixEvent, partition: corrected });

        if (dryRun) {
          console.log('[WorkLogPeriodFixer] DRY-RUN would fix: event_id=' + originalId +
                      ' | job=' + String(row.job_number || '') +
                      ' | period_id "' + rawVal + '" → "' + corrected + '"');
        }
      }

      // ── Write fix events ─────────────────────────────────────
      if (!dryRun && toWrite.length > 0) {
        // Group by target partition so ensurePartition is called once per partition
        var byPartition = {};
        for (var w = 0; w < toWrite.length; w++) {
          var pt = toWrite[w].partition;
          if (!byPartition[pt]) byPartition[pt] = [];
          byPartition[pt].push(toWrite[w].event);
        }
        var pts = Object.keys(byPartition);
        for (var pp = 0; pp < pts.length; pp++) {
          var targetPt = pts[pp];
          DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, targetPt, MODULE);
          DAL.appendRows(
            Config.TABLES.FACT_WORK_LOGS,
            byPartition[targetPt],
            { callerModule: MODULE, periodId: targetPt }
          );
          console.log('[WorkLogPeriodFixer] partition ' + partition +
                      ' → wrote ' + byPartition[targetPt].length +
                      ' fix event(s) to ' + targetPt);
        }
      }

      totalFixed   += dryRun ? 0 : toWrite.length;
      totalSkipped += dryRun ? 0 : 0; // already counted above per row
      if (dryRun && toWrite.length > 0) {
        console.log('[WorkLogPeriodFixer] partition ' + partition +
                    ' — would fix ' + toWrite.length + ' row(s)');
      }
    }

    console.log('[WorkLogPeriodFixer] ' + (dryRun ? 'DRY-RUN' : 'DONE') +
                ' — scanned: '     + totalScanned +
                ' | fixed: '       + (dryRun ? '(dry-run)' : totalFixed) +
                ' | skipped: '     + totalSkipped +
                ' | unparseable: ' + totalUnparseable);

    Logger.info('WL_PERIOD_FIXER_DONE', {
      module:       MODULE,
      dry_run:      dryRun,
      scanned:      totalScanned,
      fixed:        totalFixed,
      skipped:      totalSkipped,
      unparseable:  totalUnparseable
    });

    return {
      scanned:     totalScanned,
      fixed:       totalFixed,
      skipped:     totalSkipped,
      unparseable: totalUnparseable
    };
  }

  return { run: run };

}());

/**
 * Prints up to N examples of unparseable period_id rows across all
 * scan partitions. Read-only — no writes.
 * Run from Apps Script editor: runWorkLogPeriodFixer_ShowUnparseable()
 */
function runWorkLogPeriodFixer_ShowUnparseable() {
  var MODULE     = 'WorkLogPeriodFixer';
  var MAX        = 5;
  var collected  = [];

  var SCAN_PARTITIONS = [
    '2025-10', '2025-11', '2025-12',
    '2026-01', '2026-02', '2026-03',
    '2026-04', '2026-05', '2026-06', '2026-07'
  ];

  for (var p = 0; p < SCAN_PARTITIONS.length && collected.length < MAX; p++) {
    var partition = SCAN_PARTITIONS[p];
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: MODULE,
        periodId:     partition
      });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') continue;
      throw e;
    }

    for (var r = 0; r < rows.length && collected.length < MAX; r++) {
      var row = rows[r];
      var val = row.period_id;

      // Already well-formed — skip
      if (!(val instanceof Date) && /^\d{4}-\d{2}$/.test(String(val || '').trim())) continue;

      // Attempt parse — collect only the ones that fail
      var parsed = null;
      if (val instanceof Date) {
        parsed = 'DATE_OBJECT';  // parseable — skip
        continue;
      }
      var s   = String(val || '').trim();
      var hit = s.match(/^(\d{4})-(\d{2})/);
      if (hit) continue;  // parseable prefix — skip
      var d = new Date(s);
      if (!isNaN(d.getTime())) continue;  // parseable as date string — skip

      collected.push({
        partition:   partition,
        raw_value:   s || '(blank)',
        type:        typeof val,
        event_id:    String(row.event_id   || '(none)'),
        job_number:  String(row.job_number || '(none)'),
        actor_code:  String(row.actor_code || '(none)'),
        event_type:  String(row.event_type || '(none)')
      });
    }
  }

  console.log('=== WorkLogPeriodFixer — Unparseable period_id samples ===');
  console.log('Showing up to ' + MAX + ' of 137 unparseable rows:');
  console.log('');
  for (var i = 0; i < collected.length; i++) {
    var ex = collected[i];
    console.log('[' + (i + 1) + '] partition:  ' + ex.partition);
    console.log('     raw_value: "' + ex.raw_value + '"  (typeof ' + ex.type + ')');
    console.log('     job:       ' + ex.job_number);
    console.log('     actor:     ' + ex.actor_code);
    console.log('     event_id:  ' + ex.event_id);
    console.log('     type:      ' + ex.event_type);
    console.log('');
  }
  if (collected.length === 0) {
    console.log('No unparseable rows found — all malformed values are Date objects or parseable strings.');
  }
  console.log('=== End ===');
}

/** Dry-run — previews fixes without writing anything. */
function runWorkLogPeriodFixer_DryRun() {
  WorkLogPeriodFixer.run(true);
}

/** Live run — writes WORK_LOG_PERIOD_FIXED amendment events. */
function runWorkLogPeriodFixer_LIVE() {
  WorkLogPeriodFixer.run(false);
}
