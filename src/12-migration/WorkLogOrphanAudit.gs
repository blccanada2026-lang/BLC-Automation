// ============================================================
// WorkLogOrphanAudit.gs — BLC Nexus Data Integrity Audit
// src/12-migration/WorkLogOrphanAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runWorkLogOrphanAudit()
//
// Reads every FACT_WORK_LOGS|YYYY-MM partition (discovered
// dynamically — no hardcoded month list), collects every unique
// job_number, and checks each against VW_JOB_CURRENT_STATE.
//
// Output → _TEMP_AUDIT_ORPHAN_JOBS (created if absent, cleared if
// present). Filtered to job_numbers with NO matching VW row —
// hours logged against a job that has no current-state projection.
// Sorted by total hours descending.
//
// Read-only — no FACT or VW writes.
// ============================================================

var AUDIT_TAB_ORPHAN_JOBS = '_TEMP_AUDIT_ORPHAN_JOBS';

/**
 * Full FACT_WORK_LOGS → VW_JOB_CURRENT_STATE orphan gap audit.
 * Read-only. Writes results to _TEMP_AUDIT_ORPHAN_JOBS.
 */
function runWorkLogOrphanAudit() {
  var MODULE = 'WorkLogOrphanAudit';

  // ── Discover all FACT_WORK_LOGS partitions ──────────────────
  var partitions = discoverWorkLogPartitions_();

  Logger.info('ORPHAN_AUDIT_START', {
    module:     MODULE,
    partitions: partitions
  });

  // ── Accumulate per job_number across all partitions ─────────
  // perJob[job_number] = { hours: 0, entries: 0, actors: {code:true}, partitions: {pid:true} }
  var perJob = {};
  var partitionsRead = [];
  var partitionsFailed = [];

  for (var p = 0; p < partitions.length; p++) {
    var pid = partitions[p];
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: MODULE,
        periodId:     pid
      });
    } catch (e) {
      Logger.warn('ORPHAN_AUDIT_PARTITION_FAIL', { module: MODULE, partition: pid, error: e.message });
      partitionsFailed.push(pid);
      continue;
    }
    partitionsRead.push(pid);

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var jn = String(row.job_number || '').trim();
      if (!jn) continue;

      var hours = parseFloat(row.hours);
      if (isNaN(hours)) hours = 0;

      var actor = String(row.actor_code || '').trim().toUpperCase();

      if (!perJob[jn]) {
        perJob[jn] = { hours: 0, entries: 0, actors: {}, partitions: {} };
      }
      perJob[jn].hours += hours;
      perJob[jn].entries += 1;
      if (actor) perJob[jn].actors[actor] = true;
      perJob[jn].partitions[pid] = true;
    }
  }

  // ── Read VW_JOB_CURRENT_STATE once, build existence set ─────
  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  var vwJobSet = {};
  for (var v = 0; v < vwRows.length; v++) {
    var vjn = String(vwRows[v].job_number || '').trim();
    if (vjn) vwJobSet[vjn] = true;
  }

  // ── Build result rows — only job_numbers with NO VW row ─────
  var allJobNumbers = Object.keys(perJob);
  var orphans = [];

  for (var j = 0; j < allJobNumbers.length; j++) {
    var jobNum = allJobNumbers[j];
    if (vwJobSet[jobNum]) continue; // has a VW row — not an orphan

    var agg = perJob[jobNum];
    orphans.push({
      job_number:    jobNum,
      total_hours:   agg.hours,
      entries:       agg.entries,
      actor_codes:   Object.keys(agg.actors).sort().join(', '),
      partitions:    Object.keys(agg.partitions).sort().join(', ')
    });
  }

  // Sort by total hours descending
  orphans.sort(function(a, b) { return b.total_hours - a.total_hours; });

  var totalOrphanHours = 0;
  for (var o = 0; o < orphans.length; o++) totalOrphanHours += orphans[o].total_hours;

  Logger.info('ORPHAN_AUDIT_DONE', {
    module:              MODULE,
    partitionsRead:      partitionsRead.length,
    partitionsFailed:    partitionsFailed.length,
    uniqueJobNumbers:    allJobNumbers.length,
    vwRows:              vwRows.length,
    orphanJobNumbers:    orphans.length,
    orphanHours:         totalOrphanHours
  });

  // ── Build sheet data ─────────────────────────────────────────
  var COLS = ['job_number', 'total_hours', 'distinct_entries', 'actor_codes', 'partitions', 'vw_row_exists'];
  var numCols = COLS.length;
  var sheetData = [];

  var auditTimestamp = new Date().toISOString();
  sheetData.push([
    'AUDIT: FACT_WORK_LOGS → VW_JOB_CURRENT_STATE orphan gap analysis',
    'Run: ' + auditTimestamp,
    'Partitions scanned: ' + partitionsRead.join(', ') + (partitionsFailed.length ? (' | FAILED: ' + partitionsFailed.join(', ')) : ''),
    'Total orphaned job_numbers: ' + orphans.length,
    'Total orphaned hours: ' + totalOrphanHours,
    ''
  ]);
  sheetData.push(['', '', '', '', '', '']);
  sheetData.push(COLS);

  if (orphans.length === 0) {
    sheetData.push(['✅ No orphaned job_numbers found', '', '', '', '', '']);
  } else {
    for (var r = 0; r < orphans.length; r++) {
      var row2 = orphans[r];
      sheetData.push([
        row2.job_number,
        row2.total_hours,
        row2.entries,
        row2.actor_codes,
        row2.partitions,
        'NO'
      ]);
    }
  }

  // ── Write to _TEMP_AUDIT_ORPHAN_JOBS ─────────────────────────
  // Direct SpreadsheetApp: this is a one-time diagnostic output tab,
  // not a FACT table. DAL does not support tab creation or arbitrary
  // layout writes (same convention as WorkLogDedupAudit.gs / VwJobDedupAudit.gs).
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(AUDIT_TAB_ORPHAN_JOBS);
  if (tab) {
    tab.clearContents();
    tab.clearFormats();
  } else {
    tab = ss.insertSheet(AUDIT_TAB_ORPHAN_JOBS);
  }

  tab.getRange(1, 1, sheetData.length, numCols).setValues(sheetData);

  tab.getRange(1, 1, 1, numCols).setFontWeight('bold').setBackground('#fff2cc'); // summary = yellow
  tab.getRange(3, 1, 1, numCols).setFontWeight('bold').setBackground('#cfe2f3'); // headers = blue
  tab.setFrozenRows(3);
  tab.autoResizeColumns(1, numCols);

  // ── Console summary ──────────────────────────────────────────
  console.log('[WorkLogOrphanAudit] Partitions scanned: ' + partitionsRead.join(', '));
  if (partitionsFailed.length) {
    console.log('[WorkLogOrphanAudit] ⚠️  Partitions failed to read: ' + partitionsFailed.join(', '));
  }
  console.log('[WorkLogOrphanAudit] Unique job_numbers in FACT_WORK_LOGS: ' + allJobNumbers.length);
  console.log('[WorkLogOrphanAudit] VW_JOB_CURRENT_STATE rows: ' + vwRows.length);
  console.log('[WorkLogOrphanAudit] Orphaned job_numbers (no VW row): ' + orphans.length);
  console.log('[WorkLogOrphanAudit] Total orphaned hours: ' + totalOrphanHours);
  if (orphans.length === 0) {
    console.log('[WorkLogOrphanAudit] ✅ Every job_number in FACT_WORK_LOGS has a VW_JOB_CURRENT_STATE row.');
  } else {
    console.log('[WorkLogOrphanAudit] ⚠️  Open ' + AUDIT_TAB_ORPHAN_JOBS + ' tab for full detail.');
  }

  return {
    partitionsRead:   partitionsRead,
    partitionsFailed: partitionsFailed,
    uniqueJobNumbers: allJobNumbers.length,
    vwRows:           vwRows.length,
    orphanCount:      orphans.length,
    orphanHours:      totalOrphanHours
  };
}

// ── Private helpers ───────────────────────────────────────────

/**
 * Discovers all FACT_WORK_LOGS|YYYY-MM partition tab names present
 * in the spreadsheet. Same pattern as EventReplayEngine.gs's
 * discoverPartitions_(). Returns sorted period_id strings.
 */
function discoverWorkLogPartitions_() {
  var sheets  = DAL.listSheets();
  var prefix  = Config.TABLES.FACT_WORK_LOGS + '|';
  var periods = [];
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i];
    if (name.indexOf(prefix) === 0) {
      var period = name.substring(prefix.length);
      if (/^\d{4}-\d{2}$/.test(period)) {
        periods.push(period);
      }
    }
  }
  periods.sort();
  return periods;
}
