// ============================================================
// Blc00353PrsAudit.gs — BLC Nexus Data Diagnostic
// src/12-migration/Blc00353PrsAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runBlc00353PrsAudit()
//
// Console-only dump of every FACT_WORK_LOGS row for
// job_number=BLC-00353, actor_code=PRS, across a broad scan of
// partitions. No writes.
// ============================================================

/**
 * Prints every FACT_WORK_LOGS row for job_number=BLC-00353,
 * actor_code=PRS. Read-only — no FACT or VW writes.
 */
function runBlc00353PrsAudit() {
  var MODULE     = 'Blc00353PrsAudit';
  var JOB_NUMBER  = 'BLC-00353';
  var ACTOR_CODE  = 'PRS';

  var SCAN_PARTITIONS = [
    '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06',
    '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
    '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
    '2026-07', '2026-08'
  ];

  console.log('=== FACT_WORK_LOGS — job_number=' + JOB_NUMBER + ' actor_code=' + ACTOR_CODE + ' ===');
  console.log('');

  var found = [];

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

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (String(r.job_number || '').trim() !== JOB_NUMBER) continue;
      // Case-insensitive actor_code match — this codebase has known
      // casing inconsistencies in this column (see the ABR bug and the
      // recent WorkLogCorrectionHandler case-sensitivity fix).
      if (String(r.actor_code || '').trim().toUpperCase() !== ACTOR_CODE.toUpperCase()) continue;
      found.push({ partition: partition, row: r });
    }
  }

  if (found.length === 0) {
    console.log('No rows found for job_number=' + JOB_NUMBER + ' actor_code=' + ACTOR_CODE +
                ' across scanned partitions (' + SCAN_PARTITIONS[0] + ' through ' +
                SCAN_PARTITIONS[SCAN_PARTITIONS.length - 1] + ').');
    return;
  }

  console.log('Found ' + found.length + ' row(s):');
  console.log('');

  for (var j = 0; j < found.length; j++) {
    var f = found[j];
    var r2 = f.row;
    var workDate = r2.work_date;
    if (workDate instanceof Date) {
      workDate = workDate.toISOString().substr(0, 10) + ' (Date object)';
    }
    console.log('[' + (j + 1) + '] partition_scanned: ' + f.partition);
    console.log('     event_type: ' + String(r2.event_type || '(blank)'));
    console.log('     hours:      ' + String(r2.hours));
    console.log('     work_date:  ' + String(workDate));
    console.log('     period_id:  ' + String(r2.period_id || '(blank)'));
    console.log('     actor_code (raw): ' + String(r2.actor_code || '(blank)'));
    console.log('     event_id:   ' + String(r2.event_id || '(blank)'));
    console.log('     notes:      ' + String(r2.notes || '(blank)'));
    console.log('');
  }

  console.log('=== End — ' + found.length + ' row(s) ===');
}
