// ============================================================
// WorkLogOrphanAudit.gs — BLC Nexus Data Integrity Audit
// src/12-migration/WorkLogOrphanAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runWorkLogOrphanAudit()        — full orphan gap audit
//   runWorkLogOrphanAuditRecent()  — same audit, filtered to
//                                    post-cutover orphans only
//
// Reads every FACT_WORK_LOGS|YYYY-MM partition (discovered
// dynamically — no hardcoded month list), collects every unique
// job_number, and checks each against VW_JOB_CURRENT_STATE.
//
// runWorkLogOrphanAudit() → _TEMP_AUDIT_ORPHAN_JOBS
//   All job_numbers with NO matching VW row. Sorted by total
//   hours descending.
//
// runWorkLogOrphanAuditRecent() → _TEMP_AUDIT_ORPHAN_JOBS_RECENT
//   Same orphan set, restricted to job_numbers whose MOST RECENT
//   partition is 2026-06 or 2026-07 (post-cutover) — i.e. hours
//   logged after the portal went live with no VW projection.
//   Sorted by total hours descending.
//
// Read-only — no FACT or VW writes.
// ============================================================

var AUDIT_TAB_ORPHAN_JOBS        = '_TEMP_AUDIT_ORPHAN_JOBS';
var AUDIT_TAB_ORPHAN_JOBS_RECENT = '_TEMP_AUDIT_ORPHAN_JOBS_RECENT';
var POST_CUTOVER_PARTITIONS      = ['2026-06', '2026-07'];

/**
 * Full FACT_WORK_LOGS → VW_JOB_CURRENT_STATE orphan gap audit.
 * Read-only. Writes results to _TEMP_AUDIT_ORPHAN_JOBS.
 */
function runWorkLogOrphanAudit() {
  var MODULE = 'WorkLogOrphanAudit';

  Logger.info('ORPHAN_AUDIT_START', { module: MODULE });

  var result = computeWorkLogOrphans_(MODULE);
  var orphans = result.orphans.slice();
  orphans.sort(function(a, b) { return b.total_hours - a.total_hours; });
  var totalOrphanHours = sumOrphanHours_(orphans);

  Logger.info('ORPHAN_AUDIT_DONE', {
    module:              MODULE,
    partitionsRead:      result.partitionsRead.length,
    partitionsFailed:    result.partitionsFailed.length,
    uniqueJobNumbers:    result.uniqueJobNumbers,
    vwRows:              result.vwRowCount,
    orphanJobNumbers:    orphans.length,
    orphanHours:         totalOrphanHours
  });

  var partitionsLine = 'Partitions scanned: ' + result.partitionsRead.join(', ') +
    (result.partitionsFailed.length ? (' | FAILED: ' + result.partitionsFailed.join(', ')) : '');

  writeOrphanAuditTab_(AUDIT_TAB_ORPHAN_JOBS, orphans, {
    title:       'AUDIT: FACT_WORK_LOGS → VW_JOB_CURRENT_STATE orphan gap analysis',
    partitions:  partitionsLine,
    countLabel:  'Total orphaned job_numbers: ' + orphans.length,
    hoursLabel:  'Total orphaned hours: ' + totalOrphanHours
  });

  // ── Console summary ──────────────────────────────────────────
  console.log('[WorkLogOrphanAudit] Partitions scanned: ' + result.partitionsRead.join(', '));
  if (result.partitionsFailed.length) {
    console.log('[WorkLogOrphanAudit] ⚠️  Partitions failed to read: ' + result.partitionsFailed.join(', '));
  }
  console.log('[WorkLogOrphanAudit] Unique job_numbers in FACT_WORK_LOGS: ' + result.uniqueJobNumbers);
  console.log('[WorkLogOrphanAudit] VW_JOB_CURRENT_STATE rows: ' + result.vwRowCount);
  console.log('[WorkLogOrphanAudit] Orphaned job_numbers (no VW row): ' + orphans.length);
  console.log('[WorkLogOrphanAudit] Total orphaned hours: ' + totalOrphanHours);
  if (orphans.length === 0) {
    console.log('[WorkLogOrphanAudit] ✅ Every job_number in FACT_WORK_LOGS has a VW_JOB_CURRENT_STATE row.');
  } else {
    console.log('[WorkLogOrphanAudit] ⚠️  Open ' + AUDIT_TAB_ORPHAN_JOBS + ' tab for full detail.');
  }

  return {
    partitionsRead:   result.partitionsRead,
    partitionsFailed: result.partitionsFailed,
    uniqueJobNumbers: result.uniqueJobNumbers,
    vwRows:           result.vwRowCount,
    orphanCount:      orphans.length,
    orphanHours:      totalOrphanHours
  };
}

/**
 * Post-cutover slice of the orphan gap audit.
 * Same orphan set as runWorkLogOrphanAudit(), filtered to job_numbers
 * whose most recent partition is 2026-06 or 2026-07 — hours logged
 * after portal cutover with no VW_JOB_CURRENT_STATE row.
 * Read-only. Writes results to _TEMP_AUDIT_ORPHAN_JOBS_RECENT.
 */
function runWorkLogOrphanAuditRecent() {
  var MODULE = 'WorkLogOrphanAudit';

  Logger.info('ORPHAN_AUDIT_RECENT_START', { module: MODULE, filter: POST_CUTOVER_PARTITIONS });

  var result = computeWorkLogOrphans_(MODULE);

  var recentOrphans = result.orphans.filter(function(o) {
    return POST_CUTOVER_PARTITIONS.indexOf(o.most_recent_partition) !== -1;
  });
  recentOrphans.sort(function(a, b) { return b.total_hours - a.total_hours; });
  var totalRecentHours = sumOrphanHours_(recentOrphans);

  Logger.info('ORPHAN_AUDIT_RECENT_DONE', {
    module:              MODULE,
    postCutoverOrphans:  recentOrphans.length,
    postCutoverHours:    totalRecentHours
  });

  var partitionsLine = 'Partitions scanned: ' + result.partitionsRead.join(', ') +
    (result.partitionsFailed.length ? (' | FAILED: ' + result.partitionsFailed.join(', ')) : '');

  writeOrphanAuditTab_(AUDIT_TAB_ORPHAN_JOBS_RECENT, recentOrphans, {
    title:       'AUDIT: FACT_WORK_LOGS → VW_JOB_CURRENT_STATE orphan gap — post-cutover (' +
                 POST_CUTOVER_PARTITIONS.join('/') + ') only',
    partitions:  partitionsLine,
    countLabel:  'Post-cutover orphaned job_numbers: ' + recentOrphans.length,
    hoursLabel:  'Post-cutover orphaned hours: ' + totalRecentHours
  });

  // ── Console summary ──────────────────────────────────────────
  console.log('[WorkLogOrphanAuditRecent] Filter: most recent partition in [' + POST_CUTOVER_PARTITIONS.join(', ') + ']');
  console.log('[WorkLogOrphanAuditRecent] Post-cutover orphaned job_numbers: ' + recentOrphans.length);
  console.log('[WorkLogOrphanAuditRecent] Post-cutover orphaned hours: ' + totalRecentHours);
  if (recentOrphans.length === 0) {
    console.log('[WorkLogOrphanAuditRecent] ✅ No post-cutover orphans found.');
  } else {
    console.log('[WorkLogOrphanAuditRecent] ⚠️  Open ' + AUDIT_TAB_ORPHAN_JOBS_RECENT + ' tab for full detail.');
  }

  return {
    postCutoverOrphanCount: recentOrphans.length,
    postCutoverOrphanHours: totalRecentHours
  };
}

// ── Private helpers ───────────────────────────────────────────

/**
 * Core computation shared by both entry points: reads all
 * FACT_WORK_LOGS partitions, aggregates per job_number, and
 * returns every job_number with no matching VW_JOB_CURRENT_STATE
 * row (unsorted). Each orphan entry includes most_recent_partition
 * so callers can filter by recency.
 *
 * @param {string} callerModule
 * @returns {{partitionsRead:string[], partitionsFailed:string[],
 *            uniqueJobNumbers:number, vwRowCount:number, orphans:Object[]}}
 */
function computeWorkLogOrphans_(callerModule) {
  var partitions = discoverWorkLogPartitions_();

  // perJob[job_number] = { hours: 0, entries: 0, actors: {code:true}, partitions: {pid:true} }
  var perJob = {};
  var partitionsRead = [];
  var partitionsFailed = [];

  for (var p = 0; p < partitions.length; p++) {
    var pid = partitions[p];
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: callerModule,
        periodId:     pid
      });
    } catch (e) {
      Logger.warn('ORPHAN_AUDIT_PARTITION_FAIL', { module: callerModule, partition: pid, error: e.message });
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
  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: callerModule });
  var vwJobSet = {};
  for (var v = 0; v < vwRows.length; v++) {
    var vjn = String(vwRows[v].job_number || '').trim();
    if (vjn) vwJobSet[vjn] = true;
  }

  // ── Build orphan list — only job_numbers with NO VW row ─────
  var allJobNumbers = Object.keys(perJob);
  var orphans = [];

  for (var j = 0; j < allJobNumbers.length; j++) {
    var jobNum = allJobNumbers[j];
    if (vwJobSet[jobNum]) continue; // has a VW row — not an orphan

    var agg = perJob[jobNum];
    var sortedPartitions = Object.keys(agg.partitions).sort();
    orphans.push({
      job_number:            jobNum,
      total_hours:           agg.hours,
      entries:               agg.entries,
      actor_codes:           Object.keys(agg.actors).sort().join(', '),
      partitions:            sortedPartitions.join(', '),
      most_recent_partition: sortedPartitions.length ? sortedPartitions[sortedPartitions.length - 1] : ''
    });
  }

  return {
    partitionsRead:   partitionsRead,
    partitionsFailed: partitionsFailed,
    uniqueJobNumbers: allJobNumbers.length,
    vwRowCount:       vwRows.length,
    orphans:          orphans
  };
}

/** Sums total_hours across a list of orphan entries. */
function sumOrphanHours_(orphans) {
  var total = 0;
  for (var i = 0; i < orphans.length; i++) total += orphans[i].total_hours;
  return total;
}

/**
 * Writes an orphan list to the given sheet tab in the shared
 * audit format (banner + header + one row per orphan). Creates
 * the tab if absent, clears it if present.
 *
 * Direct SpreadsheetApp: these are one-time diagnostic output tabs,
 * not FACT tables. DAL does not support tab creation or arbitrary
 * layout writes (same convention as WorkLogDedupAudit.gs / VwJobDedupAudit.gs).
 *
 * @param {string}   tabName
 * @param {Object[]} orphans  Already sorted by caller.
 * @param {Object}   meta     { title, partitions, countLabel, hoursLabel }
 */
function writeOrphanAuditTab_(tabName, orphans, meta) {
  var COLS = ['job_number', 'total_hours', 'distinct_entries', 'actor_codes', 'partitions', 'vw_row_exists'];
  var numCols = COLS.length;
  var sheetData = [];

  sheetData.push([
    meta.title,
    'Run: ' + new Date().toISOString(),
    meta.partitions,
    meta.countLabel,
    meta.hoursLabel,
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

  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(tabName);
  if (tab) {
    tab.clearContents();
    tab.clearFormats();
  } else {
    tab = ss.insertSheet(tabName);
  }

  tab.getRange(1, 1, sheetData.length, numCols).setValues(sheetData);

  tab.getRange(1, 1, 1, numCols).setFontWeight('bold').setBackground('#fff2cc'); // summary = yellow
  tab.getRange(3, 1, 1, numCols).setFontWeight('bold').setBackground('#cfe2f3'); // headers = blue
  tab.setFrozenRows(3);
  tab.autoResizeColumns(1, numCols);
}

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

// ============================================================
// SECTION: job_number normalization diagnostic
//
// HOW TO RUN (Apps Script editor):
//   runOrphanJobNumberNormalizationDiagnostic()
//
// Reads the orphan list already written to _TEMP_AUDIT_ORPHAN_JOBS_RECENT
// (run runWorkLogOrphanAuditRecent() first) and checks whether stripping
// everything after the first space or underscore in job_number resolves
// each orphan to a real VW_JOB_CURRENT_STATE row. This catches cases
// where FACT_WORK_LOGS.job_number carries a client/lot description
// suffix that VW never had (e.g. "2605-6039-A Mary's Landing Lot 9-16 OWF"
// vs VW's "2605-6039-A").
//
// "job assign & help" is flagged separately — it's admin overhead
// logged against no real job, not a normalization case.
//
// Console-only output. Read-only — no sheet writes.
// ============================================================

var ADMIN_OVERHEAD_JOB_NUMBER = 'job assign & help';

/**
 * Diagnoses post-cutover orphans from _TEMP_AUDIT_ORPHAN_JOBS_RECENT:
 * strips each job_number down to the token before the first space or
 * underscore, and checks whether that normalized form exists in
 * VW_JOB_CURRENT_STATE. Logs one line per orphan plus a summary.
 * Read-only — no sheet writes.
 */
function runOrphanJobNumberNormalizationDiagnostic() {
  var MODULE = 'WorkLogOrphanAudit';

  var orphanRows = readOrphanTabRows_(AUDIT_TAB_ORPHAN_JOBS_RECENT);

  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  var vwJobSet = {};
  for (var v = 0; v < vwRows.length; v++) {
    var vjn = String(vwRows[v].job_number || '').trim();
    if (vjn) vwJobSet[vjn] = true;
  }

  var totalOrphans    = orphanRows.length;
  var resolvedCount   = 0, remainingCount   = 0, specialCount   = 0;
  var resolvedHours   = 0, remainingHours   = 0, specialHours   = 0;

  console.log('[OrphanNormalizationDiagnostic] Original job_number → normalized → VW match');

  for (var i = 0; i < orphanRows.length; i++) {
    var row      = orphanRows[i];
    var original = row.job_number;
    var hours    = row.total_hours;

    if (isAdminOverheadJobNumber_(original)) {
      specialCount++;
      specialHours += hours;
      console.log('[SPECIAL] ' + original + ' → (admin overhead — not a real job, excluded from resolve/remain totals)');
      continue;
    }

    var normalized = normalizeJobNumber_(original);
    var matched    = !!vwJobSet[normalized];

    console.log(original + ' → ' + normalized + ' → VW match: ' + (matched ? 'YES' : 'NO'));

    if (matched) {
      resolvedCount++;
      resolvedHours += hours;
    } else {
      remainingCount++;
      remainingHours += hours;
    }
  }

  console.log('--- SUMMARY ---');
  console.log('Total post-cutover orphans: ' + totalOrphans);
  console.log('Admin overhead ("' + ADMIN_OVERHEAD_JOB_NUMBER + '"): ' + specialCount + ' (' + specialHours + ' hours) — excluded from resolve/remain');
  console.log('Resolve with normalization: ' + resolvedCount + ' (' + resolvedHours + ' hours)');
  console.log('Remain truly orphaned: ' + remainingCount + ' (' + remainingHours + ' hours)');

  Logger.info('ORPHAN_NORMALIZATION_DIAGNOSTIC_DONE', {
    module:          MODULE,
    totalOrphans:    totalOrphans,
    adminOverhead:   specialCount,
    resolvedCount:   resolvedCount,
    resolvedHours:   resolvedHours,
    remainingCount:  remainingCount,
    remainingHours:  remainingHours
  });

  return {
    totalOrphans:   totalOrphans,
    adminOverhead:  specialCount,
    adminOverheadHours: specialHours,
    resolvedCount:  resolvedCount,
    resolvedHours:  resolvedHours,
    remainingCount: remainingCount,
    remainingHours: remainingHours
  };
}

/**
 * Strips a job_number down to the token before the first space or
 * underscore. "2605-6039-A Mary's Landing Lot 9-16 OWF" → "2605-6039-A".
 * "2606-7042-A_Foxbank Lot 00.0133" → "2606-7042-A". No space/underscore
 * present → returned unchanged.
 */
function normalizeJobNumber_(jobNumber) {
  var s   = String(jobNumber || '').trim();
  var idx = s.search(/[ _]/);
  return idx === -1 ? s : s.substring(0, idx);
}

/**
 * True if jobNumber is the admin-overhead pseudo job "job assign & help"
 * (case-insensitive, whitespace-collapsed) — not a real job, so it
 * should never be checked against VW_JOB_CURRENT_STATE.
 */
function isAdminOverheadJobNumber_(jobNumber) {
  var norm = String(jobNumber || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return norm === ADMIN_OVERHEAD_JOB_NUMBER;
}

/**
 * Reads the orphan rows already written to an orphan-audit tab
 * (e.g. _TEMP_AUDIT_ORPHAN_JOBS_RECENT) by writeOrphanAuditTab_().
 * Locates the header row by scanning for the 'job_number' label, then
 * reads every data row below it. Read-only.
 *
 * @param {string} tabName
 * @returns {Object[]} [{ job_number, total_hours, entries, actor_codes, partitions, vw_row_exists }]
 */
function readOrphanTabRows_(tabName) {
  var ss  = SpreadsheetApp.getActiveSpreadsheet();
  var tab = ss.getSheetByName(tabName);
  if (!tab) {
    throw new Error('Tab "' + tabName + '" not found. Run runWorkLogOrphanAuditRecent() first.');
  }

  var values = tab.getDataRange().getValues();

  var headerRowIdx = -1;
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === 'job_number') { headerRowIdx = i; break; }
  }
  if (headerRowIdx === -1) {
    throw new Error('Could not find "job_number" header row in "' + tabName + '".');
  }

  var rows = [];
  for (var r = headerRowIdx + 1; r < values.length; r++) {
    var jn = String(values[r][0] || '').trim();
    if (!jn) continue; // skip blank rows / "no orphans found" placeholder row
    var hours = parseFloat(values[r][1]);
    if (isNaN(hours)) hours = 0;
    rows.push({
      job_number:     jn,
      total_hours:    hours,
      entries:        values[r][2],
      actor_codes:    values[r][3],
      partitions:     values[r][4],
      vw_row_exists:  values[r][5]
    });
  }
  return rows;
}
