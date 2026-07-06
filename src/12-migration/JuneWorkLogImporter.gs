// ============================================================
// JuneWorkLogImporter.gs — BLC Nexus T12 Migration
// src/12-migration/JuneWorkLogImporter.gs
//
// Imports June 1–today timesheets from client CSV files in Drive.
// Rows with Date < 2026-06-01 are silently skipped (safe to upload
// full-history exports — only June rows are imported).
//
// SETUP (one-time):
//   1. In Google Drive, create a folder named exactly:
//        BLC June Timesheets
//   2. Upload all client CSV timesheet files into that folder.
//      File names don't matter. Each file must have these headers:
//        Date | Job# | Billable Hours | Designer | Description
//   3. Run the steps below in order.
//
// RUN ORDER:
//   Step A: runImportJuneTimesheets()    ← reads Drive CSVs → MIGRATION_RAW_IMPORT
//   Step B: runNormalizeJuneTimesheets() ← normalizes BATCH-004
//   Step C: runEnableOverridesJune()     ← enables migration idempotency flag
//   Step D: runReplayJuneTimesheets()    ← writes to FACT_WORK_LOGS|2026-06 (re-run if partial)
//   Step E: runDisableOverridesJune()    ← CRITICAL: restore production mode
// ============================================================

var JUNE_BATCH         = 'BATCH-004';
var JUNE_RUNNER_EMAIL_ = 'blccanada2026@gmail.com';
var JUNE_DRIVE_FOLDER_ = 'BLC June Timesheets';
var JUNE_DATE_CUTOFF_  = '2026-06-01';  // rows before this date are skipped

var JUNE_ROLE_MAP_ = {
  'quality check': 'QC',
  'qc':            'QC',
  'q/c':           'QC'
};

// Name variants in CSVs that don't match DIM_STAFF_ROSTER exactly.
// Add entries here if runImportJuneTimesheets() reports unresolved names.
var JUNE_NAME_ALIASES_ = {
  'abhisekh rit':   'AR001',
  'prianka santra': 'PRS',
  'abby bera':      'ABB',
  'sandy das':      'SDA',
  'nitish mishra':  'NMM',
  'ravi gummadi':   'RKG',
  'raj kumar':      'RKU',
  'priyanka s':     'PRS',
  'debby gosh':     'DBG',
  'deb sen':        'DBS',
  'banik sagar':    'BSG',
  'sarty gosh':     'SGO',
  'pabitra gosh':   'PBG',
  'vani kv':        'VKV',
  'savvy nath':     'SVN',
  'bittu dalui':    'BIT',
  'bittuu dalui':   'BIT'
};

// ── Private helpers ────────────────────────────────────────

function buildJuneStaffLookup_() {
  var nameMap = {}, firstMap = {};
  try {
    var rows = DAL.readAll('DIM_STAFF_ROSTER', { callerModule: 'JuneWorkLogImporter' });
    (rows || []).forEach(function(r) {
      var code        = String(r.person_code  || '').trim();
      var name        = String(r.name         || '').trim().toLowerCase();
      var displayName = String(r.display_name || '').trim().toLowerCase();
      if (!code || !name) return;
      if (displayName) {
        nameMap[displayName] = code;
        var dfirst = displayName.split(/\s+/)[0];
        if (dfirst && !firstMap[dfirst]) firstMap[dfirst] = code;
      }
      nameMap[name] = code;
      var first = name.split(/\s+/)[0];
      if (first && !firstMap[first]) firstMap[first] = code;
    });
  } catch(e) {
    console.log('  WARN: could not read DIM_STAFF_ROSTER — ' + e.message);
  }
  return { nameMap: nameMap, firstMap: firstMap };
}

function resolveJuneDesigner_(cell, lookup) {
  if (!cell) return null;
  var raw      = String(cell).trim();
  var dash     = raw.indexOf('-');
  var namePart = (dash >= 0 ? raw.substring(dash + 1) : raw).trim().toLowerCase();

  if (JUNE_NAME_ALIASES_[namePart])              return JUNE_NAME_ALIASES_[namePart];
  if (lookup.nameMap[namePart])                  return lookup.nameMap[namePart];
  var first = namePart.split(/\s+/)[0];
  if (first && lookup.firstMap[first])           return lookup.firstMap[first];

  if (dash > 0) {
    var prefix = raw.substring(0, dash).trim();
    var codes  = Object.keys(lookup.nameMap).map(function(k){ return lookup.nameMap[k]; });
    if (codes.indexOf(prefix) !== -1)            return prefix;
  }
  return null;
}

function resolveJuneRole_(desc) {
  var key = String(desc || '').trim().toLowerCase();
  return JUNE_ROLE_MAP_[key] || 'DESIGNER';
}

function juneCol_(headers, name) {
  var lc = name.toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === lc) return i;
  }
  return -1;
}

/**
 * Normalises a date string or Date object to 'YYYY-MM-DD'.
 * Returns '' if unreadable.
 */
function juneNormaliseDate_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(val).trim();
  // M/D/YYYY → YYYY-MM-DD
  var mdY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdY) {
    return mdY[3] + '-' + ('0' + mdY[1]).slice(-2) + '-' + ('0' + mdY[2]).slice(-2);
  }
  return s.slice(0, 10);
}

/**
 * Parses one CSV file and writes June rows to MIGRATION_RAW_IMPORT as BATCH-004.
 * Rows with work_date < JUNE_DATE_CUTOFF_ are silently skipped.
 * Idempotent by batch + filename + row index.
 */
function readFileRows_(file) {
  var mime = file.getMimeType();
  if (mime === MimeType.CSV) {
    var content = file.getBlob().getDataAsString('UTF-8');
    return Utilities.parseCsv(content);
  }
  // Google Sheets or Excel — open with SpreadsheetApp.
  // Cells are returned as their native types (Date, Number, String).
  // Do NOT call String() on cells here — juneNormaliseDate_() handles
  // Date objects correctly via Utilities.formatDate(). Converting Date
  // to String first produces "Mon Jun 01 ..." which loses the year.
  try {
    var ss    = SpreadsheetApp.openById(file.getId());
    var sheet = ss.getSheets()[0];
    return sheet.getDataRange().getValues().map(function(row) {
      return row.map(function(cell) { return cell === null || cell === undefined ? '' : cell; });
    });
  } catch(e) {
    throw new Error('Cannot read file as spreadsheet: ' + e.message);
  }
}

function importJuneCsvFile_(file, sourceTabKey, staffLookup) {
  var fileName = file.getName();
  var rows;
  try {
    rows = readFileRows_(file);
  } catch(e) {
    console.log('  ERROR reading ' + fileName + ': ' + e.message);
    return { imported: 0, skipped: 0, filtered: 0, unresolved: [] };
  }
  if (!rows || rows.length < 2) {
    console.log('  SKIP (empty): ' + fileName);
    return { imported: 0, skipped: 0, filtered: 0, unresolved: [] };
  }

  var headers  = rows[0];
  var dateCol  = juneCol_(headers, 'Date');
  var jobCol   = juneCol_(headers, 'Job#');
  var hoursCol = juneCol_(headers, 'Billable Hours');
  var desgCol  = juneCol_(headers, 'Designer');
  var descCol  = juneCol_(headers, 'Description');

  if (dateCol < 0 || jobCol < 0 || hoursCol < 0 || desgCol < 0) {
    console.log('  ERROR: ' + fileName + ' missing required headers (Date, Job#, Billable Hours, Designer)');
    return { imported: 0, skipped: 0, filtered: 0, unresolved: [] };
  }

  // Load existing idempotency keys for this file
  var existing = {};
  try {
    var allRaw = DAL.readAll(MigrationConfig.TABLES.RAW_IMPORT, { callerModule: 'JuneWorkLogImporter' });
    (allRaw || []).forEach(function(r) {
      if (r.migration_batch === JUNE_BATCH && r.source_tab === sourceTabKey + '|' + fileName) {
        existing[r.import_key] = true;
      }
    });
  } catch(e) { /* proceed */ }

  var buffer   = [], imported = 0, skipped = 0, filtered = 0, unresolved = [];

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row[jobCol] && !row[dateCol]) { skipped++; continue; }

    var workDate = juneNormaliseDate_(row[dateCol]);

    // Skip rows before June 1 — safe to upload full-history exports
    if (workDate && workDate < JUNE_DATE_CUTOFF_) { filtered++; continue; }

    var importKey = 'BATCH-004|FILE-' + fileName + '|ROW-' + i;
    if (existing[importKey]) { skipped++; continue; }

    var jobNum     = String(row[jobCol]   || '').trim();
    var hours      = String(row[hoursCol] || '').trim();
    var designer   = String(row[desgCol]  || '').trim();
    var desc       = descCol >= 0 ? String(row[descCol] || '').trim() : '';

    var personCode = resolveJuneDesigner_(designer, staffLookup);
    var actorRole  = resolveJuneRole_(desc);

    if (!personCode) {
      unresolved.push('row ' + (i + 1) + ': "' + designer + '"');
      personCode = designer;
    }

    buffer.push({
      import_key:      importKey,
      migration_batch: JUNE_BATCH,
      source_tag:      'JUNE_TIMESHEETS',
      source_tab:      sourceTabKey + '|' + fileName,
      row_index:       i,
      raw_json:        JSON.stringify({
        job_number:  jobNum,
        person_code: personCode,
        hours:       hours,
        work_date:   workDate,
        actor_role:  actorRole
      }),
      imported_at: new Date().toISOString(),
      imported_by: JUNE_RUNNER_EMAIL_
    });

    if (buffer.length >= 100) {
      DAL.appendRows(MigrationConfig.TABLES.RAW_IMPORT, buffer, { callerModule: 'JuneWorkLogImporter' });
      imported += buffer.length;
      buffer = [];
    }
  }

  if (buffer.length > 0) {
    DAL.appendRows(MigrationConfig.TABLES.RAW_IMPORT, buffer, { callerModule: 'JuneWorkLogImporter' });
    imported += buffer.length;
  }

  return { imported: imported, skipped: skipped, filtered: filtered, unresolved: unresolved };
}

// ── Top-level runners ──────────────────────────────────────

/**
 * Step A — reads all CSV files from "BLC June Timesheets" Drive folder
 * and imports June rows into MIGRATION_RAW_IMPORT as BATCH-004.
 * Rows before 2026-06-01 are skipped automatically.
 * Idempotent — re-run safely at any time.
 */
function runImportJuneTimesheets() {
  console.log('═══════════════════════════════════════════');
  console.log('[JuneWorkLogImporter] STEP A: import from Drive');
  console.log('  Batch:  ' + JUNE_BATCH);
  console.log('  Folder: ' + JUNE_DRIVE_FOLDER_);
  console.log('  Filter: date >= ' + JUNE_DATE_CUTOFF_);
  console.log('═══════════════════════════════════════════');

  var folders = DriveApp.getFoldersByName(JUNE_DRIVE_FOLDER_);
  if (!folders.hasNext()) {
    console.log('  ❌ Folder "' + JUNE_DRIVE_FOLDER_ + '" not found in Drive.');
    console.log('     Create it, upload your June CSV files, then re-run.');
    return;
  }
  var folder = folders.next();

  var files    = folder.getFiles();
  var fileList = [];
  while (files.hasNext()) {
    var f = files.next();
    var mime = f.getMimeType();
    if (mime === MimeType.CSV ||
        mime === MimeType.GOOGLE_SHEETS ||
        mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      fileList.push(f);
    }
  }

  if (fileList.length === 0) {
    console.log('  ❌ No CSV files found in "' + JUNE_DRIVE_FOLDER_ + '".');
    return;
  }
  console.log('  Found ' + fileList.length + ' CSV file(s)');

  var staffLookup   = buildJuneStaffLookup_();
  var sourceTabKey  = MigrationConfig.STACEY_TABLES.WORK_LOGS;
  var totalImported = 0, totalSkipped = 0, totalFiltered = 0, allUnresolved = [];

  fileList.forEach(function(file) {
    console.log('  ─── ' + file.getName());
    var r = importJuneCsvFile_(file, sourceTabKey, staffLookup);
    totalImported  += r.imported;
    totalSkipped   += r.skipped;
    totalFiltered  += r.filtered;
    allUnresolved   = allUnresolved.concat(r.unresolved);
    console.log('    imported=' + r.imported + '  skipped=' + r.skipped +
                '  pre-June=' + r.filtered +
                (r.unresolved.length ? '  ⚠️ unresolved=' + r.unresolved.length : ''));
    r.unresolved.forEach(function(u) { console.log('    ⚠️  ' + u); });
  });

  console.log('─────────────────────────────────────────');
  console.log('  Total imported: ' + totalImported);
  console.log('  Total skipped:  ' + totalSkipped + ' (already in RAW or blank)');
  console.log('  Pre-June rows:  ' + totalFiltered + ' (skipped — before 2026-06-01)');
  if (allUnresolved.length > 0) {
    console.log('  ⚠️  ' + allUnresolved.length + ' unresolved designer(s) — will be flagged INVALID in normalize step.');
    console.log('  Add aliases to JUNE_NAME_ALIASES_ and re-run Step A before continuing.');
  } else {
    console.log('  ✅ All designers resolved. Run runNormalizeJuneTimesheets() next.');
  }
  console.log('═══════════════════════════════════════════');
}

/** Step B — normalize BATCH-004. */
function runNormalizeJuneTimesheets() {
  console.log('═══════════════════════════════════════════');
  console.log('[JuneWorkLogImporter] STEP B: normalize BATCH-004');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MigrationNormalizer.normalizeAll(JUNE_RUNNER_EMAIL_, JUNE_BATCH);
    console.log('  normalized=' + (r.normalized||0) + '  invalid=' + (r.invalid||0) + '  skipped=' + (r.skipped||0));
    console.log(r.invalid > 0
      ? '  ⚠️  Check MIGRATION_NORMALIZED for validation_notes. Fix aliases then re-run.'
      : '  ✅ Done. Run runEnableOverridesJune() then runReplayJuneTimesheets().');
  } catch(e) { console.log('  ❌ ' + e.message); }
  console.log('═══════════════════════════════════════════');
}

/** Step B2 — re-normalize INVALID rows after fixing aliases. */
function runReNormalizeJuneInvalids() {
  console.log('═══════════════════════════════════════════');
  console.log('[JuneWorkLogImporter] STEP B2: re-normalize INVALID rows');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MigrationNormalizer.reNormalizeInvalid(JUNE_RUNNER_EMAIL_, JUNE_BATCH);
    console.log('  fixed=' + (r.fixed||0) + '  stillInvalid=' + (r.stillInvalid||0));
    console.log(r.stillInvalid > 0
      ? '  ⚠️  ' + r.stillInvalid + ' rows still invalid — check MIGRATION_NORMALIZED.'
      : '  ✅ All resolved. Run runEnableOverridesJune() then runReplayJuneTimesheets().');
  } catch(e) { console.log('  ❌ ' + e.message); }
  console.log('═══════════════════════════════════════════');
}

/** Step C — enable migration overrides (required for ALLOW_MIGR_IDEMPOTENCY). */
function runEnableOverridesJune() {
  MigrationConfig.enableOverrides();
  console.log('  ✅ Overrides ENABLED. Run runReplayJuneTimesheets() now.');
}

/** Step D — replay BATCH-004 into FACT_WORK_LOGS|2026-06. Re-run if partial. */
function runReplayJuneTimesheets() {
  console.log('═══════════════════════════════════════════');
  console.log('[JuneWorkLogImporter] STEP D: replay BATCH-004');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MigrationReplayEngine.replayAll(JUNE_RUNNER_EMAIL_, JUNE_BATCH);
    console.log('  replayed=' + r.replayed + '  skipped=' + r.skipped + '  failed=' + r.failed);
    console.log(r.partial
      ? '  ⚠️  Partial — re-run runReplayJuneTimesheets() to continue.'
      : '  ✅ Complete. Run runDisableOverridesJune() NOW.');
  } catch(e) { console.log('  ❌ ' + e.message); }
  console.log('═══════════════════════════════════════════');
}

/** Step E — CRITICAL: restore production mode. Always run after Step D. */
function runDisableOverridesJune() {
  MigrationConfig.disableOverrides();
  console.log('  ✅ Overrides DISABLED. System back in production mode.');
}

/**
 * Status check — run this to see if June hours are already imported.
 * Shows MIGRATION_RAW_IMPORT batch counts and FACT_WORK_LOGS|2026-06 row count.
 */
/**
 * Diagnostic — finds all FACT_WORK_LOGS partition sheets and counts rows in each.
 * Also checks MIGRATION_NORMALIZED for BATCH-004 sample period_id values.
 */
/** Shows headers and first 3 rows of FACT_WORK_LOGS|2001-06 for cleanup planning. */
function runInspect2001Sheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('FACT_WORK_LOGS|2001-06');
  if (!sheet) { console.log('Sheet not found'); return; }
  var data  = sheet.getDataRange().getValues();
  console.log('Headers: ' + JSON.stringify(data[0]));
  for (var i = 1; i <= Math.min(3, data.length - 1); i++) {
    console.log('Row ' + i + ': ' + JSON.stringify(data[i]));
  }
  console.log('Total rows (excl header): ' + (data.length - 1));
}

function runDiagnoseJuneReplay() {
  console.log('=== June Replay Diagnostic ===');

  // 1. List all FACT_WORK_LOGS sheets in the spreadsheet
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var allSheets = ss.getSheets();
  console.log('FACT_WORK_LOGS sheets found:');
  allSheets.forEach(function(s) {
    var name = s.getName();
    if (name.indexOf('FACT_WORK_LOG') === 0) {
      var rows = Math.max(0, s.getLastRow() - 1); // subtract header
      console.log('  ' + name + ': ' + rows + ' data rows');
    }
  });

  // 2. Sample 5 BATCH-004 rows from MIGRATION_NORMALIZED to check period_id
  console.log('MIGRATION_NORMALIZED BATCH-004 sample:');
  try {
    var norm = DAL.readAll(MigrationConfig.TABLES.NORMALIZED, { callerModule: 'JuneWorkLogImporter' });
    var batch4 = (norm || []).filter(function(r) { return r.migration_batch === 'BATCH-004'; });
    console.log('  Total BATCH-004 rows: ' + batch4.length);
    batch4.slice(0, 5).forEach(function(r) {
      try {
        var p = JSON.parse(r.normalized_json || '{}');
        console.log('  norm_id=' + r.norm_id + ' status=' + r.replay_status +
                    ' period_id=' + p.period_id + ' job=' + p.job_number +
                    ' person=' + p.person_code + ' date=' + p.work_date);
      } catch(e) { console.log('  parse error: ' + e.message); }
    });
  } catch(e) {
    console.log('  Could not read MIGRATION_NORMALIZED: ' + e.message);
  }
  console.log('==============================');
}

/**
 * ONE-TIME patch for the "Mon Jun 01" date bug.
 * Fixes work_date and period_id in MIGRATION_NORMALIZED for all BATCH-004 rows,
 * resets their replay_status to VALID, and removes the wrongly-placed
 * BATCH-004 rows from FACT_WORK_LOGS|2001-06.
 * Safe to re-run — idempotent.
 */
function runPatchBatch004Dates() {
  console.log('=== Patching BATCH-004 date bug ===');
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Fix MIGRATION_NORMALIZED
  var normSheet = ss.getSheetByName(MigrationConfig.TABLES.NORMALIZED);
  if (!normSheet) { console.log('ERROR: MIGRATION_NORMALIZED not found'); return; }

  var data     = normSheet.getDataRange().getValues();
  var headers  = data[0];
  var batchCol = headers.indexOf('migration_batch');
  var jsonCol  = headers.indexOf('normalized_json');
  var statCol  = headers.indexOf('replay_status');
  if (batchCol < 0 || jsonCol < 0 || statCol < 0) {
    console.log('ERROR: required columns not found in MIGRATION_NORMALIZED');
    return;
  }

  var fixed = 0, alreadyOk = 0;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][batchCol]) !== 'BATCH-004') continue;
    try {
      var p  = JSON.parse(data[i][jsonCol] || '{}');
      var wd = String(p.work_date || '');
      // Already fixed if it looks like YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(wd)) { alreadyOk++; continue; }
      // Parse "Mon Jun 01", "Tue Jun 02", ... → "2026-06-01", "2026-06-02", ...
      var m = wd.match(/Jun\s+(\d{1,2})/i);
      if (!m) { console.log('  WARN: cannot parse work_date "' + wd + '" on row ' + (i+1)); continue; }
      var day = ('0' + parseInt(m[1])).slice(-2);
      p.work_date  = '2026-06-' + day;
      p.period_id  = '2026-06';
      data[i][jsonCol] = JSON.stringify(p);
      data[i][statCol] = 'VALID';
      fixed++;
    } catch(e) {
      console.log('  WARN row ' + (i+1) + ': ' + e.message);
    }
  }
  normSheet.getRange(1, 1, data.length, headers.length).setValues(data);
  console.log('MIGRATION_NORMALIZED: fixed=' + fixed + ' alreadyOk=' + alreadyOk);

  // 2. Remove BATCH-004 rows from FACT_WORK_LOGS|2001-06
  var wlSheet = ss.getSheetByName('FACT_WORK_LOGS|2001-06');
  if (!wlSheet) {
    console.log('FACT_WORK_LOGS|2001-06: not found — skipping cleanup');
  } else {
    var wlData    = wlSheet.getDataRange().getValues();
    var wlHeaders = wlData[0];
    var mbCol     = wlHeaders.indexOf('migration_batch');
    if (mbCol < 0) {
      console.log('FACT_WORK_LOGS|2001-06: migration_batch column not found — skipping cleanup');
    } else {
      var toDelete = [];
      for (var j = wlData.length - 1; j >= 1; j--) {
        if (String(wlData[j][mbCol]) === 'BATCH-004') toDelete.push(j + 1);
      }
      toDelete.forEach(function(r) { wlSheet.deleteRow(r); });
      console.log('FACT_WORK_LOGS|2001-06: removed ' + toDelete.length + ' BATCH-004 rows');
    }
  }

  console.log('Patch complete. Run runEnableOverridesJune() then runReplayJuneTimesheets().');
  console.log('===================================');
}

/**
 * Removes rows from FACT_WORK_LOGS|2001-06 where work_date is in June 2026.
 * These are the wrongly-placed BATCH-004 rows. Rows with other work_dates are untouched.
 */
function runCleanup2001Sheet() {
  console.log('=== Cleaning FACT_WORK_LOGS|2001-06 ===');
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('FACT_WORK_LOGS|2001-06');
  if (!sheet) { console.log('Sheet not found — nothing to clean'); return; }

  var data     = sheet.getDataRange().getValues();
  var headers  = data[0];
  var wdCol    = headers.indexOf('work_date');
  if (wdCol < 0) { console.log('ERROR: work_date column not found'); return; }

  var toDelete = [];
  for (var i = data.length - 1; i >= 1; i--) {
    var wd = data[i][wdCol];
    // work_date may be a Date object or an ISO string — check for year=2026, month=June
    var d = (wd instanceof Date) ? wd : new Date(String(wd));
    if (!isNaN(d.getTime()) && d.getFullYear() === 2026 && d.getMonth() === 5) {
      toDelete.push(i + 1); // 1-indexed sheet row
    }
  }
  toDelete.forEach(function(r) { sheet.deleteRow(r); });
  console.log('Deleted ' + toDelete.length + ' BATCH-004 rows (work_date in June 2026)');
  console.log('Remaining rows: ' + (sheet.getLastRow() - 1));
  console.log('======================================');
}

/**
 * Verifies FACT_WORK_LOGS|2026-06 content — counts by event_type, actor, and date range.
 * Also checks for any rows with bad period_id or mangled work_date.
 */
function runVerifyJuneWorkLogs() {
  console.log('=== Verifying FACT_WORK_LOGS|2026-06 ===');
  try {
    var rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: 'JuneWorkLogImporter', periodId: '2026-06'
    });
    console.log('Total rows: ' + (rows || []).length);

    var byType = {}, byActor = {}, badPeriod = 0, badDate = 0, totalHours = 0;
    var minDate = '9999', maxDate = '0000';

    (rows || []).forEach(function(r) {
      byType[r.event_type || 'UNKNOWN'] = (byType[r.event_type || 'UNKNOWN'] || 0) + 1;
      byActor[r.actor_code || 'UNKNOWN'] = (byActor[r.actor_code || 'UNKNOWN'] || 0) + 1;
      totalHours += Number(r.hours) || 0;

      var wd = String(r.work_date || '');
      if (wd && wd.indexOf('2026-06') === -1 && wd.indexOf('Mon') === -1) badDate++;
      var pid = String(r.period_id || '');
      if (pid && pid.indexOf('2026-06') === -1) badPeriod++;

      var d = wd.slice(0, 10);
      if (d > maxDate) maxDate = d;
      if (d < minDate) minDate = d;
    });

    console.log('By event_type: ' + JSON.stringify(byType));
    console.log('By actor_code: ' + JSON.stringify(byActor));
    console.log('Total hours: ' + totalHours);
    console.log('Date range: ' + minDate + ' → ' + maxDate);
    if (badPeriod) console.log('⚠️  Rows with bad period_id: ' + badPeriod);
    if (badDate)   console.log('⚠️  Rows with unexpected work_date: ' + badDate);
    if (!badPeriod && !badDate) console.log('✅ All rows look clean');
  } catch(e) {
    console.log('ERROR: ' + e.message);
  }
  console.log('=========================================');
}

/** Shows all rows in FACT_WORK_LOGS|2026-06 for a given actor_code. */
function runInspectActorRows() {
  var ACTOR = 'DS1'; // change if needed
  console.log('=== FACT rows for actor: ' + ACTOR + ' ===');
  try {
    var rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: 'JuneWorkLogImporter', periodId: '2026-06'
    });
    var found = (rows || []).filter(function(r) { return r.actor_code === ACTOR; });
    found.forEach(function(r) {
      console.log('  job=' + r.job_number + ' date=' + r.work_date +
                  ' hours=' + r.hours + ' type=' + r.event_type);
    });
    console.log('Total: ' + found.length + ' rows');
  } catch(e) { console.log('ERROR: ' + e.message); }
  console.log('==================================');
}

/**
 * Appends WORK_LOG_AMENDED events for the 33 BTD rows, correcting actor_code to BIT.
 * Idempotent — checks for existing amendments before writing.
 */
/** Appends WORK_LOG_AMENDED events for the 59 SNA rows, correcting actor_code to SVN. */
function runFixSNAtoSVN() {
  console.log('=== Fixing SNA → SVN in FACT_WORK_LOGS|2026-06 ===');
  try {
    var rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: 'JuneWorkLogImporter', periodId: '2026-06'
    });
    var snaRows = (rows || []).filter(function(r) {
      return r.actor_code === 'SNA' && r.event_type === 'WORK_LOG_MIGRATED';
    });
    console.log('SNA rows found: ' + snaRows.length);
    if (snaRows.length === 0) { console.log('Nothing to fix.'); return; }

    var alreadyAmended = {};
    (rows || []).forEach(function(r) {
      if (r.event_type === 'WORK_LOG_AMENDED' && r.amendment_of) alreadyAmended[r.amendment_of] = true;
    });

    var fixed = 0;
    snaRows.forEach(function(r) {
      if (alreadyAmended[r.event_id]) { console.log('  SKIP (already amended): ' + r.event_id); return; }
      DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
        event_id:        Identifiers.generateId(),
        event_type:      'WORK_LOG_AMENDED',
        amendment_of:    r.event_id,
        job_number:      r.job_number,
        actor_code:      'SVN',
        hours:           r.hours,
        work_date:       r.work_date,
        actor_role:      r.actor_role || 'DESIGNER',
        period_id:       '2026-06',
        migration_batch: 'BATCH-004-FIX',
        created_by:      JUNE_RUNNER_EMAIL_,
        created_at:      new Date().toISOString(),
        notes:           'SNA corrected to SVN (Savvy Nath code mismatch)'
      }, { callerModule: 'JuneWorkLogImporter', periodId: '2026-06' });
      fixed++;
    });
    console.log('Amendments written: ' + fixed);
    console.log('✅ SVN will now receive credit for ' + fixed + ' June work log entries.');
  } catch(e) { console.log('ERROR: ' + e.message); }
  console.log('=================================================');
}

function runFixBTDtoBIT() {
  console.log('=== Fixing BTD → BIT in FACT_WORK_LOGS|2026-06 ===');
  try {
    var rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: 'JuneWorkLogImporter', periodId: '2026-06'
    });
    var btdRows = (rows || []).filter(function(r) {
      return r.actor_code === 'BTD' && r.event_type === 'WORK_LOG_MIGRATED';
    });
    console.log('BTD rows found: ' + btdRows.length);
    if (btdRows.length === 0) { console.log('Nothing to fix.'); return; }

    // Check for existing amendments to avoid duplicates
    var alreadyAmended = {};
    (rows || []).forEach(function(r) {
      if (r.event_type === 'WORK_LOG_AMENDED' && r.amendment_of) {
        alreadyAmended[r.amendment_of] = true;
      }
    });

    var fixed = 0;
    btdRows.forEach(function(r) {
      if (alreadyAmended[r.event_id]) { console.log('  SKIP (already amended): ' + r.event_id); return; }
      DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
        event_id:        Identifiers.generateId(),
        event_type:      'WORK_LOG_AMENDED',
        amendment_of:    r.event_id,
        job_number:      r.job_number,
        actor_code:      'BIT',
        hours:           r.hours,
        work_date:       r.work_date,
        actor_role:      r.actor_role || 'DESIGNER',
        period_id:       '2026-06',
        migration_batch: 'BATCH-004-FIX',
        created_by:      JUNE_RUNNER_EMAIL_,
        created_at:      new Date().toISOString(),
        notes:           'BTD corrected to BIT (Bittu Dalui code mismatch)'
      }, { callerModule: 'JuneWorkLogImporter', periodId: '2026-06' });
      fixed++;
    });
    console.log('Amendments written: ' + fixed);
    console.log('✅ BIT will now receive credit for ' + fixed + ' June work log entries.');
  } catch(e) { console.log('ERROR: ' + e.message); }
  console.log('=================================================');
}

/**
 * Reconciliation report: compares BATCH-004 source (MIGRATION_RAW_IMPORT)
 * against effective hours in FACT_WORK_LOGS|2026-06 (migrated + amendments).
 * Groups by actor_code and prints source hours vs FACT hours, flagging gaps.
 */
function runJuneReconciliation() {
  console.log('═══════════════════════════════════════════');
  console.log('[BATCH-004] June 1-15 Reconciliation Report');
  console.log('═══════════════════════════════════════════');

  // Stacey used BTD/SNA codes; FACT was corrected to BIT/SVN via amendments.
  // Normalise source codes so comparison is against the canonical codes.
  var SRC_CODE_MAP = { 'BTD': 'BIT', 'SNA': 'SVN' };

  // 1. Source hours from MIGRATION_RAW_IMPORT (BATCH-004 raw_json)
  var srcByActor = {}, srcTotal = 0;
  try {
    var raw = DAL.readAll(MigrationConfig.TABLES.RAW_IMPORT, { callerModule: 'JuneWorkLogImporter' });
    (raw || []).filter(function(r) { return r.migration_batch === 'BATCH-004'; }).forEach(function(r) {
      try {
        var p    = JSON.parse(r.raw_json || '{}');
        var code = SRC_CODE_MAP[String(p.person_code || 'UNKNOWN')] || String(p.person_code || 'UNKNOWN');
        var hrs  = Number(p.hours) || 0;
        srcByActor[code] = (srcByActor[code] || 0) + hrs;
        srcTotal += hrs;
      } catch(e) {}
    });
  } catch(e) { console.log('ERROR reading RAW_IMPORT: ' + e.message); return; }

  // 2. Effective FACT hours.
  //    BTD/SNA MIGRATED rows have been superseded by BIT/SVN AMENDED rows.
  //    Since amendment_of is not in the FACT header, we exclude BTD/SNA MIGRATED
  //    rows directly (all were amended) and count AMENDED rows by their actor_code.
  var SUPERSEDED_MIGRATED = { 'BTD': true, 'SNA': true };
  var factByActor = {}, factTotal = 0;
  try {
    var rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: 'JuneWorkLogImporter', periodId: '2026-06'
    });
    (rows || []).forEach(function(r) {
      if (r.event_type === 'WORK_LOG_SUBMITTED') return;
      if (r.event_type === 'WORK_LOG_MIGRATED' && SUPERSEDED_MIGRATED[r.actor_code]) return;
      var code = String(r.actor_code || 'UNKNOWN');
      var hrs  = Number(r.hours) || 0;
      factByActor[code] = (factByActor[code] || 0) + hrs;
      factTotal += hrs;
    });
  } catch(e) { console.log('ERROR reading FACT: ' + e.message); return; }

  // 3. Print comparison (hide zero-zero rows for cleaner output)
  var allCodes = {};
  Object.keys(srcByActor).forEach(function(c) { allCodes[c] = true; });
  Object.keys(factByActor).forEach(function(c) { allCodes[c] = true; });

  var gaps = 0;
  Object.keys(allCodes).sort().forEach(function(code) {
    var src  = Math.round((srcByActor[code]  || 0) * 100) / 100;
    var fact = Math.round((factByActor[code] || 0) * 100) / 100;
    if (src === 0 && fact === 0) return;
    var flag = (src !== fact) ? ' ⚠️  MISMATCH' : ' ✅';
    if (src !== fact) gaps++;
    console.log('  ' + code + ': source=' + src + 'h  fact=' + fact + 'h' + flag);
  });

  console.log('───────────────────────────────────────────');
  console.log('  Source total: ' + Math.round(srcTotal * 100) / 100 + 'h');
  console.log('  FACT total:   ' + Math.round(factTotal * 100) / 100 + 'h');
  console.log(gaps === 0 ? '  ✅ FULLY RECONCILED' : '  ⚠️  ' + gaps + ' actor(s) have mismatches');
  console.log('═══════════════════════════════════════════');
}

/**
 * Row-level cross-check: compares Stacey source vs Nexus FACT at the
 * actor+job+date granularity. Logs mismatches only. Prints Nexus timesheet
 * summary sorted by date → actor → job at the end.
 */
function runJuneTimesheetCrossCheck() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('[BATCH-004] June 1-15 Row-Level Cross-Check');
  console.log('═══════════════════════════════════════════════════════');

  var SRC_CODE_MAP  = { 'BTD': 'BIT', 'SNA': 'SVN' };
  var SKIP_MIGRATED = { 'BTD': true, 'SNA': true };

  // 1. Build source map: "actor|job|date" → hours
  var srcMap = {};
  try {
    var raw = DAL.readAll(MigrationConfig.TABLES.RAW_IMPORT, { callerModule: 'JuneWorkLogImporter' });
    (raw || []).filter(function(r) { return r.migration_batch === 'BATCH-004'; }).forEach(function(r) {
      try {
        var p    = JSON.parse(r.raw_json || '{}');
        var code = SRC_CODE_MAP[p.person_code] || p.person_code;
        var rawDate = String(p.work_date || '');
        var nd;
        if (rawDate.match(/^\d{4}-\d{2}-\d{2}/)) {
          nd = rawDate.slice(0, 10);
        } else {
          var d = new Date(rawDate + ' 2026');
          nd = !isNaN(d.getTime()) ? Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd') : rawDate;
        }
        var key = code + '|' + p.job_number + '|' + nd;
        srcMap[key] = (srcMap[key] || 0) + (Number(p.hours) || 0);
      } catch(e) {}
    });
  } catch(e) { console.log('ERROR reading RAW_IMPORT: ' + e.message); return; }

  // 2. Build FACT effective map: "actor|job|date" → hours
  var factMap = {};
  try {
    var rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: 'JuneWorkLogImporter', periodId: '2026-06'
    });
    (rows || []).forEach(function(r) {
      if (r.event_type === 'WORK_LOG_SUBMITTED') return;
      if (r.event_type === 'WORK_LOG_MIGRATED' && SKIP_MIGRATED[r.actor_code]) return;
      var wd = r.work_date instanceof Date
        ? Utilities.formatDate(r.work_date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r.work_date || '').slice(0, 10);
      var key = r.actor_code + '|' + r.job_number + '|' + wd;
      factMap[key] = (factMap[key] || 0) + (Number(r.hours) || 0);
    });
  } catch(e) { console.log('ERROR reading FACT: ' + e.message); return; }

  // 3. Compare — report mismatches only
  var allKeys = {};
  Object.keys(srcMap).forEach(function(k)  { allKeys[k] = true; });
  Object.keys(factMap).forEach(function(k) { allKeys[k] = true; });

  var mismatches = 0, matched = 0;
  Object.keys(allKeys).sort().forEach(function(k) {
    var src  = Math.round((srcMap[k]  || 0) * 100) / 100;
    var fact = Math.round((factMap[k] || 0) * 100) / 100;
    if (src === fact) { matched++; return; }
    var parts = k.split('|');
    console.log('  ⚠️  ' + parts[2] + ' | ' + parts[0] + ' | ' + parts[1] +
                ': src=' + src + 'h  nexus=' + fact + 'h  diff=' + Math.round((fact-src)*100)/100 + 'h');
    mismatches++;
  });

  console.log('───────────────────────────────────────────────────────');
  console.log('  Matched rows: ' + matched);
  console.log('  Mismatches:   ' + mismatches);
  console.log(mismatches === 0 ? '  ✅ ALL ROWS MATCH' : '  ⚠️  ' + mismatches + ' row(s) differ');

  // 4. Print Nexus timesheet summary sorted date → actor → job
  console.log('');
  console.log('--- Nexus Timesheet (FACT effective hours) ---');
  console.log('Date        | Actor | Job#                                      | Hours');
  console.log('────────────|───────|───────────────────────────────────────────|──────');
  var srcTotal = 0;
  Object.keys(srcMap).sort().forEach(function(k) {
    var parts = k.split('|');
    var date  = parts[2], actor = parts[0], job = parts[1];
    var fact  = Math.round((factMap[k] || 0) * 100) / 100;
    console.log(date + ' | ' + actor.padEnd(5) + ' | ' + job.substring(0, 41).padEnd(41) + ' | ' + fact);
    srcTotal += fact;
  });
  console.log('────────────|───────|───────────────────────────────────────────|──────');
  console.log('TOTAL: ' + Math.round(srcTotal * 100) / 100 + 'h');
  console.log('═══════════════════════════════════════════════════════');
}

/**
 * Drills into missing hours for a specific actor by comparing source rows
 * (MIGRATION_RAW_IMPORT BATCH-004) vs FACT rows, grouped by job+date.
 * Change ACTOR below before running.
 */
function runDrillDownMissingHours() {
  var ACTOR = 'DBG'; // change to PBG, RKU, SGO as needed
  var CODE_MAP = { 'BTD': 'BIT', 'SNA': 'SVN' };
  console.log('=== Missing hours drill-down: ' + ACTOR + ' ===');

  // Source: sum hours per job+date for this actor
  // raw_json work_date may be "Mon Jun 01" (pre-fix format) or ISO "2026-06-01" — normalize to ISO
  var srcMap = {};
  try {
    var raw = DAL.readAll(MigrationConfig.TABLES.RAW_IMPORT, { callerModule: 'JuneWorkLogImporter' });
    (raw || []).filter(function(r) { return r.migration_batch === 'BATCH-004'; }).forEach(function(r) {
      try {
        var p    = JSON.parse(r.raw_json || '{}');
        var code = CODE_MAP[p.person_code] || p.person_code;
        if (code !== ACTOR) return;
        var rawDate = String(p.work_date || '');
        var normDate;
        if (rawDate.match(/^\d{4}-\d{2}-\d{2}/)) {
          normDate = rawDate.slice(0, 10);
        } else {
          // "Mon Jun 01" → "2026-06-01"
          var d = new Date(rawDate + ' 2026');
          normDate = !isNaN(d.getTime())
            ? Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd')
            : rawDate;
        }
        var key  = p.job_number + '|' + normDate;
        srcMap[key] = (srcMap[key] || 0) + (Number(p.hours) || 0);
      } catch(e) {}
    });
  } catch(e) { console.log('ERROR: ' + e.message); return; }

  // FACT: sum hours per job+date for this actor (migrated only, exclude SNA/BTD originals)
  var factMap = {};
  try {
    var rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: 'JuneWorkLogImporter', periodId: '2026-06'
    });
    (rows || []).forEach(function(r) {
      if (r.event_type === 'WORK_LOG_SUBMITTED') return;
      if (r.actor_code !== ACTOR) return;
      var wd  = r.work_date instanceof Date
        ? Utilities.formatDate(r.work_date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r.work_date || '').slice(0, 10);
      var key = r.job_number + '|' + wd;
      factMap[key] = (factMap[key] || 0) + (Number(r.hours) || 0);
    });
  } catch(e) { console.log('ERROR: ' + e.message); return; }

  // Compare
  var allKeys = {};
  Object.keys(srcMap).forEach(function(k) { allKeys[k] = true; });
  Object.keys(factMap).forEach(function(k) { allKeys[k] = true; });
  var gaps = 0;
  Object.keys(allKeys).sort().forEach(function(k) {
    var src  = Math.round((srcMap[k]  || 0) * 100) / 100;
    var fact = Math.round((factMap[k] || 0) * 100) / 100;
    var diff = Math.round((src - fact) * 100) / 100;
    if (src !== fact) {
      console.log('  ⚠️  ' + k + ': source=' + src + 'h  fact=' + fact + 'h  missing=' + diff + 'h');
      gaps++;
    }
  });
  if (gaps === 0) console.log('  ✅ No gaps found');
  console.log('Total gaps: ' + gaps);
  console.log('=======================================');
}

/**
 * Writes WORK_LOG_AMENDED delta events to correct DBG hours lost to idempotency
 * (multiple source rows per job+date — only first row's hours were captured).
 * Idempotent: skips if correction already exists for a given job+date.
 * After running, verify with runJuneReconciliation().
 */
function runFixDBGHours() {
  console.log('=== Fix DBG missing hours (BATCH-004 idempotency gaps) ===');

  // Delta corrections derived from source vs FACT comparison
  var CORRECTIONS = [
    { job_number: '160945', work_date: '2026-06-04', hours_delta: 2.25 },
    { job_number: '160950', work_date: '2026-06-08', hours_delta: 12.5 },
    { job_number: '160959', work_date: '2026-06-03', hours_delta: 1.5 },
    { job_number: '160997', work_date: '2026-06-10', hours_delta: 6 },
    { job_number: '160997', work_date: '2026-06-11', hours_delta: 2 },
    { job_number: '160999', work_date: '2026-06-12', hours_delta: 5.5 },
    { job_number: '161000', work_date: '2026-06-15', hours_delta: 1.75 },
    { job_number: '161001', work_date: '2026-06-15', hours_delta: 1.75 },
    { job_number: '161005', work_date: '2026-06-11', hours_delta: 1 }
  ];

  // Idempotency: find existing delta corrections for DBG
  var existingRows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
    callerModule: 'JuneWorkLogImporter', periodId: '2026-06'
  });
  var alreadyFixed = {};
  (existingRows || []).forEach(function(r) {
    if (r.event_type === 'WORK_LOG_AMENDED' &&
        r.actor_code === 'DBG' &&
        r.migration_batch === 'BATCH-004-HOURS-FIX') {
      var wd = r.work_date instanceof Date
        ? Utilities.formatDate(r.work_date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r.work_date || '').slice(0, 10);
      alreadyFixed[r.job_number + '|' + wd] = true;
    }
  });

  var written = 0, skipped = 0;
  CORRECTIONS.forEach(function(c) {
    var key = c.job_number + '|' + c.work_date;
    if (alreadyFixed[key]) {
      console.log('  SKIP (already fixed): ' + key);
      skipped++;
      return;
    }
    DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
      event_id:        Identifiers.generateId(),
      event_type:      'WORK_LOG_AMENDED',
      job_number:      c.job_number,
      actor_code:      'DBG',
      hours:           c.hours_delta,
      work_date:       c.work_date,
      actor_role:      'DESIGNER',
      period_id:       '2026-06',
      migration_batch: 'BATCH-004-HOURS-FIX',
      created_by:      JUNE_RUNNER_EMAIL_,
      created_at:      new Date().toISOString(),
      notes:           'BATCH-004 idempotency gap: multiple source rows per job+date, delta correction'
    }, { callerModule: 'JuneWorkLogImporter', periodId: '2026-06' });
    console.log('  ✅ ' + key + ' +' + c.hours_delta + 'h');
    written++;
  });

  console.log('Written: ' + written + ', Skipped: ' + skipped);
  console.log('Total delta: 34.25h');
  console.log('Run runJuneReconciliation() to verify DBG is now balanced.');
  console.log('=================================================');
}

/**
 * Self-healing undo for duplicate DBG corrections.
 * Reads total WORK_LOG_AMENDED hours per job+date for DBG, compares against
 * the expected single-delta, and writes a negative reversal for any excess.
 * Idempotent: if excess is already zero, skips that entry.
 */
function runUndoDuplicateDBGFix() {
  console.log('=== Undo duplicate DBG corrections ===');
  var EXPECTED = {
    '160945|2026-06-04': 2.25,
    '160950|2026-06-08': 12.5,
    '160959|2026-06-03': 1.5,
    '160997|2026-06-10': 6,
    '160997|2026-06-11': 2,
    '160999|2026-06-12': 5.5,
    '161000|2026-06-15': 1.75,
    '161001|2026-06-15': 1.75,
    '161005|2026-06-11': 1
  };

  var rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
    callerModule: 'JuneWorkLogImporter', periodId: '2026-06'
  });

  // Sum all AMENDED hours for DBG per job+date (includes both positive and any prior negatives)
  var amendedByKey = {};
  (rows || []).forEach(function(r) {
    if (r.event_type !== 'WORK_LOG_AMENDED' || r.actor_code !== 'DBG') return;
    var wd = r.work_date instanceof Date
      ? Utilities.formatDate(r.work_date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(r.work_date || '').slice(0, 10);
    var key = r.job_number + '|' + wd;
    amendedByKey[key] = (amendedByKey[key] || 0) + (Number(r.hours) || 0);
  });

  var written = 0;
  Object.keys(EXPECTED).sort().forEach(function(key) {
    var expected = EXPECTED[key];
    var actual   = Math.round((amendedByKey[key] || 0) * 100) / 100;
    var excess   = Math.round((actual - expected) * 100) / 100;
    if (excess <= 0) {
      console.log('  OK ' + key + ': amended=' + actual + 'h expected=' + expected + 'h');
      return;
    }
    var parts = key.split('|');
    DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
      event_id:    Identifiers.generateId(),
      event_type:  'WORK_LOG_AMENDED',
      job_number:  parts[0],
      actor_code:  'DBG',
      hours:       -excess,
      work_date:   parts[1],
      actor_role:  'DESIGNER',
      period_id:   '2026-06',
      created_by:  JUNE_RUNNER_EMAIL_,
      created_at:  new Date().toISOString(),
      notes:       'Reversal: duplicate BATCH-004-HOURS-FIX cancelled -' + excess + 'h'
    }, { callerModule: 'JuneWorkLogImporter', periodId: '2026-06' });
    console.log('  ✅ Reversed ' + key + ': -' + excess + 'h (was ' + actual + 'h, expected ' + expected + 'h)');
    written++;
  });

  console.log('Reversals written: ' + written);
  console.log('Run runJuneReconciliation() to verify.');
  console.log('=================================================');
}

function runFixPBGHours() {
  console.log('=== Fix PBG missing hours (BATCH-004 idempotency gap) ===');
  var CORRECTIONS = [
    { job_number: '2505-7978', work_date: '2026-06-05', hours_delta: 5 }
  ];
  var existingRows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
    callerModule: 'JuneWorkLogImporter', periodId: '2026-06'
  });
  var alreadyFixed = {};
  (existingRows || []).forEach(function(r) {
    if (r.event_type === 'WORK_LOG_AMENDED' && r.actor_code === 'PBG' && r.migration_batch === 'BATCH-004-HOURS-FIX') {
      var wd = r.work_date instanceof Date
        ? Utilities.formatDate(r.work_date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r.work_date || '').slice(0, 10);
      alreadyFixed[r.job_number + '|' + wd] = true;
    }
  });
  var written = 0, skipped = 0;
  CORRECTIONS.forEach(function(c) {
    var key = c.job_number + '|' + c.work_date;
    if (alreadyFixed[key]) { console.log('  SKIP: ' + key); skipped++; return; }
    DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
      event_id:        Identifiers.generateId(),
      event_type:      'WORK_LOG_AMENDED',
      job_number:      c.job_number,
      actor_code:      'PBG',
      hours:           c.hours_delta,
      work_date:       c.work_date,
      actor_role:      'DESIGNER',
      period_id:       '2026-06',
      migration_batch: 'BATCH-004-HOURS-FIX',
      created_by:      JUNE_RUNNER_EMAIL_,
      created_at:      new Date().toISOString(),
      notes:           'BATCH-004 idempotency gap: multiple source rows per job+date, delta correction'
    }, { callerModule: 'JuneWorkLogImporter', periodId: '2026-06' });
    console.log('  ✅ ' + key + ' +' + c.hours_delta + 'h');
    written++;
  });
  console.log('Written: ' + written + ', Skipped: ' + skipped);
  console.log('=================================================');
}

function runFixRKUHours() {
  console.log('=== Fix RKU missing hours (BATCH-004 idempotency gap) ===');
  var CORRECTIONS = [
    { job_number: '2605-6941-D', work_date: '2026-06-12', hours_delta: 0.75 }
  ];
  var existingRows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
    callerModule: 'JuneWorkLogImporter', periodId: '2026-06'
  });
  var alreadyFixed = {};
  (existingRows || []).forEach(function(r) {
    if (r.event_type === 'WORK_LOG_AMENDED' && r.actor_code === 'RKU' && r.migration_batch === 'BATCH-004-HOURS-FIX') {
      var wd = r.work_date instanceof Date
        ? Utilities.formatDate(r.work_date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r.work_date || '').slice(0, 10);
      alreadyFixed[r.job_number + '|' + wd] = true;
    }
  });
  var written = 0, skipped = 0;
  CORRECTIONS.forEach(function(c) {
    var key = c.job_number + '|' + c.work_date;
    if (alreadyFixed[key]) { console.log('  SKIP: ' + key); skipped++; return; }
    DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
      event_id:        Identifiers.generateId(),
      event_type:      'WORK_LOG_AMENDED',
      job_number:      c.job_number,
      actor_code:      'RKU',
      hours:           c.hours_delta,
      work_date:       c.work_date,
      actor_role:      'DESIGNER',
      period_id:       '2026-06',
      migration_batch: 'BATCH-004-HOURS-FIX',
      created_by:      JUNE_RUNNER_EMAIL_,
      created_at:      new Date().toISOString(),
      notes:           'BATCH-004 idempotency gap: multiple source rows per job+date, delta correction'
    }, { callerModule: 'JuneWorkLogImporter', periodId: '2026-06' });
    console.log('  ✅ ' + key + ' +' + c.hours_delta + 'h');
    written++;
  });
  console.log('Written: ' + written + ', Skipped: ' + skipped);
  console.log('=================================================');
}

function runFixSGOHours() {
  console.log('=== Fix SGO missing hours (BATCH-004 idempotency gap) ===');
  var CORRECTIONS = [
    { job_number: '160997', work_date: '2026-06-11', hours_delta: 0.5 },
    { job_number: '161005', work_date: '2026-06-11', hours_delta: 0.5 }
  ];
  var existingRows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
    callerModule: 'JuneWorkLogImporter', periodId: '2026-06'
  });
  var alreadyFixed = {};
  (existingRows || []).forEach(function(r) {
    if (r.event_type === 'WORK_LOG_AMENDED' && r.actor_code === 'SGO' && r.migration_batch === 'BATCH-004-HOURS-FIX') {
      var wd = r.work_date instanceof Date
        ? Utilities.formatDate(r.work_date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r.work_date || '').slice(0, 10);
      alreadyFixed[r.job_number + '|' + wd] = true;
    }
  });
  var written = 0, skipped = 0;
  CORRECTIONS.forEach(function(c) {
    var key = c.job_number + '|' + c.work_date;
    if (alreadyFixed[key]) { console.log('  SKIP: ' + key); skipped++; return; }
    DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
      event_id:        Identifiers.generateId(),
      event_type:      'WORK_LOG_AMENDED',
      job_number:      c.job_number,
      actor_code:      'SGO',
      hours:           c.hours_delta,
      work_date:       c.work_date,
      actor_role:      'DESIGNER',
      period_id:       '2026-06',
      migration_batch: 'BATCH-004-HOURS-FIX',
      created_by:      JUNE_RUNNER_EMAIL_,
      created_at:      new Date().toISOString(),
      notes:           'BATCH-004 idempotency gap: multiple source rows per job+date, delta correction'
    }, { callerModule: 'JuneWorkLogImporter', periodId: '2026-06' });
    console.log('  ✅ ' + key + ' +' + c.hours_delta + 'h');
    written++;
  });
  console.log('Written: ' + written + ', Skipped: ' + skipped);
  console.log('=================================================');
}

/**
 * Drill-down for PBG, RKU, and SGO in one run.
 * Prints per-job+date gaps so runFixPBGHours/RKU/SGO can be written.
 */
function runDrillDownRemainingActors() {
  var ACTORS = ['PBG', 'RKU', 'SGO'];
  var CODE_MAP = { 'BTD': 'BIT', 'SNA': 'SVN' };

  // Load source once
  var rawRows = [];
  try {
    var raw = DAL.readAll(MigrationConfig.TABLES.RAW_IMPORT, { callerModule: 'JuneWorkLogImporter' });
    rawRows = (raw || []).filter(function(r) { return r.migration_batch === 'BATCH-004'; });
  } catch(e) { console.log('ERROR reading RAW_IMPORT: ' + e.message); return; }

  // Load FACT once
  var factRows = [];
  try {
    factRows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: 'JuneWorkLogImporter', periodId: '2026-06'
    }) || [];
  } catch(e) { console.log('ERROR reading FACT: ' + e.message); return; }

  ACTORS.forEach(function(ACTOR) {
    console.log('=== ' + ACTOR + ' ===');

    var srcMap = {};
    rawRows.forEach(function(r) {
      try {
        var p    = JSON.parse(r.raw_json || '{}');
        var code = CODE_MAP[p.person_code] || p.person_code;
        if (code !== ACTOR) return;
        var rawDate = String(p.work_date || '');
        var normDate;
        if (rawDate.match(/^\d{4}-\d{2}-\d{2}/)) {
          normDate = rawDate.slice(0, 10);
        } else {
          var d = new Date(rawDate + ' 2026');
          normDate = !isNaN(d.getTime()) ? Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd') : rawDate;
        }
        var key = p.job_number + '|' + normDate;
        srcMap[key] = (srcMap[key] || 0) + (Number(p.hours) || 0);
      } catch(e) {}
    });

    var factMap = {};
    factRows.forEach(function(r) {
      if (r.event_type === 'WORK_LOG_SUBMITTED') return;
      if (r.actor_code !== ACTOR) return;
      var wd = r.work_date instanceof Date
        ? Utilities.formatDate(r.work_date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(r.work_date || '').slice(0, 10);
      factMap[r.job_number + '|' + wd] = (factMap[r.job_number + '|' + wd] || 0) + (Number(r.hours) || 0);
    });

    var allKeys = {};
    Object.keys(srcMap).forEach(function(k) { allKeys[k] = true; });
    Object.keys(factMap).forEach(function(k) { allKeys[k] = true; });
    var gaps = 0;
    Object.keys(allKeys).sort().forEach(function(k) {
      var src  = Math.round((srcMap[k]  || 0) * 100) / 100;
      var fact = Math.round((factMap[k] || 0) * 100) / 100;
      if (src !== fact) {
        console.log('  ⚠️  ' + k + ': src=' + src + 'h  fact=' + fact + 'h  missing=' + Math.round((src-fact)*100)/100 + 'h');
        gaps++;
      }
    });
    if (gaps === 0) console.log('  ✅ No gaps');
  });
}

/**
 * Reads Sarty's 5 June 1–15 invoice Google Sheets from Drive and creates
 * FACT_JOB_EVENTS + VW_JOB_CURRENT_STATE entries for any job number that
 * exists in FACT_WORK_LOGS but is missing from VW_JOB_CURRENT_STATE.
 *
 * This fixes the "UNKNOWN client — 1007.5h dropped" problem identified by
 * runWorkLogDiagnostic(). Run once, idempotent.
 *
 * After this, run runGenerateClientTimesheets('2026-06A') to verify totals.
 */
function runImportSartyJuneJobs() {
  var MODULE = 'JuneWorkLogImporter';
  console.log('═══════════════════════════════════════════════════════');
  console.log('[JuneWorkLogImporter] Import Sarty June 1-15 jobs into VW');
  console.log('═══════════════════════════════════════════════════════');

  // Sarty's 5 invoice sheets — Drive IDs confirmed 2026-06-17
  // client_code must match exactly what is in DIM_CLIENT_MASTER / DIM_CLIENT_RATES
  var SARTY_SHEETS = [
    { id: '1zpCyO68PQkqfFmasQKF-uiObZbQ9CiRYQS0-Deh81Rk', client_code: 'SBS' },
    { id: '1xJ8AbtrtEmh2-kVIJIqLAqMI3RyROWtV07MCDFCMECw', client_code: 'MATIX-SK' },
    { id: '1tB0bSAdx_CorT14AFtRZ1pjy8OkKxDs0cf0zS1OtESA', client_code: 'NELSON' },
    { id: '1nklnCZoSyUgtI2WncMoLrOzhe2Eup0bbaeb1VXA35ys', client_code: 'ALBERTA TRUSS' },
    { id: '1TouEYyfOcL14nab59tJBInY8crFiGxtHOEdBSfmUScA', client_code: 'NORSPAN-MB' }
  ];

  // Map Sarty's "Job Type" column to product_code
  function toProductCode(jobType) {
    var t = String(jobType || '').toLowerCase().trim();
    if (t.indexOf('roof') !== -1)   return 'ROOF';
    if (t.indexOf('oww') !== -1)    return 'OWW';
    if (t.indexOf('joist') !== -1)  return 'IJOIST';
    return '';
  }

  // Clean job number: strip description suffix ("2605-6039-A Mary's Landing..." → "2605-6039-A")
  function cleanJobNum(raw) {
    return String(raw || '').trim().split(/\s+/)[0];
  }

  // Admin/non-job entries to skip
  var SKIP_ENTRIES = { 'job assign & help': true, 'oxford homes': true };

  // Load existing VW job numbers
  var existingJobs = {};
  try {
    var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    (vwRows || []).forEach(function(r) {
      var jn = String(r.job_number || '').trim();
      if (jn) existingJobs[jn] = true;
    });
  } catch(e) {
    console.log('ERROR loading VW: ' + e.message); return;
  }
  console.log('VW entries before import: ' + Object.keys(existingJobs).length);

  // Collect jobs from all 5 Sarty sheets
  var toCreate = {};  // job_number → { client_code, product_code }

  SARTY_SHEETS.forEach(function(sheet) {
    console.log('Reading: ' + sheet.client_code + ' (' + sheet.id + ')');
    try {
      var ss      = SpreadsheetApp.openById(sheet.id);
      var data    = ss.getSheets()[0].getDataRange().getValues();
      if (data.length < 2) { console.log('  SKIP: empty sheet'); return; }

      var headers = data[0].map(function(h) { return String(h).trim().toLowerCase(); });
      var jobCol  = headers.indexOf('job#');
      var typeCol = headers.indexOf('job type');
      if (jobCol < 0) { console.log('  SKIP: no Job# column'); return; }

      var added = 0;
      for (var i = 1; i < data.length; i++) {
        var raw     = String(data[i][jobCol] || '').trim();
        if (!raw) continue;
        var jn      = cleanJobNum(raw);
        if (!jn) continue;
        if (SKIP_ENTRIES[jn.toLowerCase()]) continue;
        if (existingJobs[jn]) continue;  // already in VW
        if (!toCreate[jn]) {
          var pc = typeCol >= 0 ? toProductCode(data[i][typeCol]) : '';
          toCreate[jn] = { client_code: sheet.client_code, product_code: pc };
          added++;
        }
      }
      console.log('  New jobs found: ' + added);
    } catch(e) {
      console.log('  ERROR: ' + e.message);
    }
  });

  var jobNums = Object.keys(toCreate);
  console.log('Total new jobs to create: ' + jobNums.length);
  if (jobNums.length === 0) {
    console.log('✅ Nothing to import — VW already has all jobs.');
    return;
  }

  var now        = new Date().toISOString();
  var periodId   = '2026-06';
  var createdFact = 0, createdVw = 0, errors = 0;

  jobNums.forEach(function(jn) {
    var info = toCreate[jn];
    try {
      // Write FACT_JOB_EVENTS
      DAL.appendRow(Config.TABLES.FACT_JOB_EVENTS, {
        event_id:       Identifiers.generateId(),
        job_number:     jn,
        period_id:      periodId,
        event_type:     'JOB_IMPORTED_HISTORICAL',
        timestamp:      now,
        actor_code:     'SGO',
        actor_role:     'PM',
        client_code:    info.client_code,
        product_code:   info.product_code,
        notes:          'Sarty June 1-15 invoice — historical completed job missing from V3 import'
      }, { callerModule: MODULE, periodId: periodId });
      createdFact++;

      // Write VW_JOB_CURRENT_STATE directly (same pattern as StaceyJobImporter)
      DAL.appendRow(Config.TABLES.VW_JOB_CURRENT_STATE, {
        job_number:    jn,
        client_code:   info.client_code,
        product_code:  info.product_code,
        current_state: 'COMPLETED',
        period_id:     periodId,
        created_at:    now,
        updated_at:    now
      }, { callerModule: MODULE });
      createdVw++;

      existingJobs[jn] = true;  // prevent duplicates within this run
    } catch(e) {
      console.log('  ERROR ' + jn + ': ' + e.message);
      errors++;
    }
  });

  console.log('───────────────────────────────────────────────────────');
  console.log('FACT_JOB_EVENTS written: ' + createdFact);
  console.log('VW_JOB_CURRENT_STATE written: ' + createdVw);
  console.log('Errors: ' + errors);
  console.log('VW entries after import: ' + Object.keys(existingJobs).length);
  if (errors === 0) {
    console.log('✅ Done. Now run runGenerateClientTimesheets(\'2026-06A\') to verify totals.');
  } else {
    console.log('⚠️  ' + errors + ' jobs failed. Check errors above.');
  }
  console.log('═══════════════════════════════════════════════════════');
}

/**
 * One-time fix: corrects 'ALBERTA-TRUSS' (hyphen) to 'ALBERTA TRUSS' (space)
 * in VW_JOB_CURRENT_STATE rows that were imported by runImportSartyJuneJobs().
 */
function runFixAlbertaTrussClientCode() {
  var MODULE = 'JuneWorkLogImporter';
  console.log('=== Fix ALBERTA-TRUSS → ALBERTA TRUSS in VW ===');
  try {
    var rows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    var toFix = (rows || []).filter(function(r) { return r.client_code === 'ALBERTA-TRUSS'; });
    console.log('Rows with ALBERTA-TRUSS: ' + toFix.length);
    toFix.forEach(function(r) {
      DAL.updateWhere(
        Config.TABLES.VW_JOB_CURRENT_STATE,
        { job_number: r.job_number },
        { client_code: 'ALBERTA TRUSS' },
        { callerModule: MODULE }
      );
      console.log('  Fixed: ' + r.job_number);
    });
    console.log('✅ Done. Re-run runGenerateClientTimesheets(\'2026-06A\') to verify.');
  } catch(e) { console.log('ERROR: ' + e.message); }
  console.log('===============================================');
}

/**
 * Diagnostic: shows SBS hours per designer in FACT_WORK_LOGS for June 1-15.
 * Use to identify which designers have hours beyond Sarty's 926.75h invoice.
 */
function runSBSDesignerBreakdown() {
  var MODULE = 'JuneWorkLogImporter';
  console.log('=== SBS June 1-15 Hours per Designer (FACT_WORK_LOGS) ===');

  // Load VW to identify SBS jobs
  var sbsJobs = {};
  try {
    var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    (vwRows || []).forEach(function(r) {
      if (String(r.client_code || '').toUpperCase() === 'SBS') {
        sbsJobs[String(r.job_number || '').trim()] = true;
      }
    });
  } catch(e) { console.log('ERROR loading VW: ' + e.message); return; }
  console.log('SBS jobs in VW: ' + Object.keys(sbsJobs).length);

  // Load staff names
  var staffNames = {};
  try {
    var staff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
    (staff || []).forEach(function(r) {
      staffNames[String(r.person_code || '').trim().toUpperCase()] = String(r.name || r.person_code || '');
    });
  } catch(e) {}

  // Load June 1-15 work logs
  var rows = [];
  try {
    rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: MODULE, periodId: '2026-06' });
  } catch(e) { console.log('ERROR: ' + e.message); return; }

  var MONTH_MAP = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  function ymd(d) { return d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate(); }
  function parseDate(raw) {
    if (!raw) return null;
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
    var s = String(raw).trim();
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(parseInt(iso[1]),parseInt(iso[2])-1,parseInt(iso[3]));
    var mg = s.match(/[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})/);
    if (mg) { var mi=MONTH_MAP[mg[1].toLowerCase()]; if(mi!==undefined) return new Date(2026,mi,parseInt(mg[2])); }
    var d=new Date(s); return isNaN(d.getTime())?null:d;
  }
  var from = 20260601, to = 20260615;

  var byDesigner = {};
  rows.forEach(function(r) {
    if (r.migration_batch) return;
    var d = parseDate(r.work_date);
    if (!d) return;
    var wd = ymd(d);
    if (wd < from || wd > to) return;
    var jn = String(r.job_number || '').trim().split(/\s+/)[0];
    if (!sbsJobs[jn]) return;
    var ac = String(r.actor_code || '').trim().toUpperCase();
    var hrs = parseFloat(r.hours) || 0;
    if (hrs <= 0) return;
    byDesigner[ac] = (byDesigner[ac] || 0) + hrs;
  });

  var total = 0;
  var codes = Object.keys(byDesigner).sort();
  console.log('\nDesigner       | Code  | Hours | Name');
  console.log('───────────────────────────────────────────────');
  codes.forEach(function(ac) {
    var hrs = Math.round(byDesigner[ac] * 100) / 100;
    total += hrs;
    console.log((staffNames[ac] || '?').padEnd(15) + ' | ' + ac.padEnd(5) + ' | ' + hrs);
  });
  console.log('───────────────────────────────────────────────');
  console.log('TOTAL: ' + Math.round(total * 100) / 100 + 'h');
  console.log('\nSarty\'s invoice total: 926.75h');
  console.log('Difference: ' + Math.round((total - 926.75) * 100) / 100 + 'h');
  console.log('=======================================================');
}

function runCheckJuneStatus() {
  console.log('=== June Work Log Status ===');

  // Check MIGRATION_RAW_IMPORT for all batches
  try {
    var raw = DAL.readAll(MigrationConfig.TABLES.RAW_IMPORT, { callerModule: 'JuneWorkLogImporter' });
    var byBatch = {};
    (raw || []).forEach(function(r) {
      var b = String(r.migration_batch || 'UNKNOWN');
      byBatch[b] = (byBatch[b] || 0) + 1;
    });
    console.log('MIGRATION_RAW_IMPORT by batch:');
    Object.keys(byBatch).sort().forEach(function(b) {
      console.log('  ' + b + ': ' + byBatch[b] + ' rows');
    });
    console.log('  (Total: ' + (raw || []).length + ' rows)');
  } catch(e) {
    console.log('  Could not read MIGRATION_RAW_IMPORT: ' + e.message);
  }

  // Check FACT_WORK_LOGS|2026-06
  try {
    var logs = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: 'JuneWorkLogImporter',
      periodId:     '2026-06'
    });
    console.log('FACT_WORK_LOGS|2026-06: ' + (logs || []).length + ' rows');
  } catch(e) {
    console.log('FACT_WORK_LOGS|2026-06: ' + (e.code === 'SHEET_NOT_FOUND' ? '0 rows (tab not created yet)' : e.message));
  }

  // Check FACT_WORK_LOGS|2026-05 for reference
  try {
    var may = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: 'JuneWorkLogImporter',
      periodId:     '2026-05'
    });
    console.log('FACT_WORK_LOGS|2026-05: ' + (may || []).length + ' rows (reference)');
  } catch(e) { /* skip */ }

  console.log('===========================');
}
