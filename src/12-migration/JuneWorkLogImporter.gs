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
  'savvy nath':     'SNA',
  'bittu dalui':    'BTD',
  'bittuu dalui':   'BTD'
};

// ── Private helpers ────────────────────────────────────────

function buildJuneStaffLookup_() {
  var nameMap = {}, firstMap = {};
  try {
    var rows = DAL.readAll('DIM_STAFF_ROSTER', { callerModule: 'JuneWorkLogImporter' });
    (rows || []).forEach(function(r) {
      var code  = String(r.person_code || '').trim();
      var name  = String(r.name        || '').trim().toLowerCase();
      if (!code || !name) return;
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
function importJuneCsvFile_(file, sourceTabKey, staffLookup) {
  var fileName = file.getName();
  var content;
  try {
    content = file.getBlob().getDataAsString('UTF-8');
  } catch(e) {
    console.log('  ERROR reading ' + fileName + ': ' + e.message);
    return { imported: 0, skipped: 0, filtered: 0, unresolved: [] };
  }

  var rows = Utilities.parseCsv(content);
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

  var files    = folder.getFilesByType(MimeType.CSV);
  var fileList = [];
  while (files.hasNext()) fileList.push(files.next());

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
