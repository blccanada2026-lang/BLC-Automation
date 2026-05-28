// ============================================================
// MayTimesheetImporter.gs — BLC Nexus T12 Migration
// src/12-migration/MayTimesheetImporter.gs
//
// Imports May 1–15 timesheets from CSV files in Google Drive.
//
// SETUP (one-time):
//   1. In Google Drive, create a folder named exactly:
//        BLC May Timesheets
//   2. Upload all client timesheet CSV files into that folder.
//      File names don't matter. Each file must have these headers
//      (extra columns like Sno, Job Type, Remarks are ignored):
//        Date | Job# | Billable Hours | Designer | Description
//   3. Run the steps below in order.
//
// RUN ORDER:
//   Step A: runImportMayTimesheets()     ← reads Drive CSVs → MIGRATION_RAW_IMPORT
//   Step B: runNormalizeMayTimesheets()  ← normalizes BATCH-002
//   Step C: runEnableOverridesMay()      ← enables backdate for 2026-05
//   Step D: runReplayMayTimesheets()     ← writes to FACT tables (re-run if partial)
//   Step E: runDisableOverridesMay()     ← CRITICAL: restore prod mode
// ============================================================

var MAY_BATCH          = 'BATCH-002';
var MAY_RUNNER_EMAIL_  = 'blccanada2026@gmail.com';
var MAY_DRIVE_FOLDER_  = 'BLC May Timesheets';

var DESCRIPTION_ROLE_MAP_ = {
  'quality check': 'QC',
  'qc':            'QC',
  'q/c':           'QC'
};

// CSV name variants that don't match DIM_STAFF_ROSTER spelling exactly.
var NAME_ALIASES_ = {
  'abhisekh rit':   'AR001',
  'prianka santra': 'PRS',
  'abby bera':      'ABB',
  'sandy das':      'SDA',
  'nitish mishra':  'NMM',
  'ravi gummadi':   'RKG'
};

// ── Private helpers ────────────────────────────────────────

/**
 * Reads DIM_STAFF_ROSTER and builds:
 *   nameMap:  lowercase(full name)       → person_code
 *   firstMap: lowercase(first word only) → person_code  (fallback)
 */
function buildStaffLookup_() {
  var nameMap = {}, firstMap = {};
  try {
    var rows = DAL.readAll('DIM_STAFF_ROSTER', { callerModule: 'MayTimesheetImporter' });
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

/**
 * Resolves "CODE-Full Name" → person_code via DIM_STAFF_ROSTER lookup.
 * Returns null if unresolved.
 */
function resolveDesigner_(cell, lookup) {
  if (!cell) return null;
  var raw     = String(cell).trim();
  var dash    = raw.indexOf('-');
  var namePart = (dash >= 0 ? raw.substring(dash + 1) : raw).trim().toLowerCase();

  if (NAME_ALIASES_[namePart])                       return NAME_ALIASES_[namePart];
  if (lookup.nameMap[namePart])                     return lookup.nameMap[namePart];
  var first = namePart.split(/\s+/)[0];
  if (first && lookup.firstMap[first])              return lookup.firstMap[first];

  // Last resort: prefix before dash is itself a valid person_code
  if (dash > 0) {
    var prefix = raw.substring(0, dash).trim();
    var codes  = Object.keys(lookup.nameMap).map(function(k){ return lookup.nameMap[k]; });
    if (codes.indexOf(prefix) !== -1)               return prefix;
  }
  return null;
}

function resolveRole_(desc) {
  var key = String(desc || '').trim().toLowerCase();
  return DESCRIPTION_ROLE_MAP_[key] || 'DESIGNER';
}

/**
 * Finds the column index of a header (case-insensitive).
 * Returns -1 if not found.
 */
function col_(headers, name) {
  var lc = name.toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === lc) return i;
  }
  return -1;
}

/**
 * Parses one CSV file and writes rows to MIGRATION_RAW_IMPORT as BATCH-002.
 * Idempotent by batch + filename + row index.
 */
function importCsvFile_(file, sourceTabKey, staffLookup) {
  var fileName = file.getName();
  var content;
  try {
    content = file.getBlob().getDataAsString('UTF-8');
  } catch(e) {
    console.log('  ERROR reading ' + fileName + ': ' + e.message);
    return { imported: 0, skipped: 0, unresolved: [] };
  }

  var rows = Utilities.parseCsv(content);
  if (!rows || rows.length < 2) {
    console.log('  SKIP (empty): ' + fileName);
    return { imported: 0, skipped: 0, unresolved: [] };
  }

  var headers  = rows[0];
  var dateCol  = col_(headers, 'Date');
  var jobCol   = col_(headers, 'Job#');
  var hoursCol = col_(headers, 'Billable Hours');
  var desgCol  = col_(headers, 'Designer');
  var descCol  = col_(headers, 'Description');

  if (dateCol < 0 || jobCol < 0 || hoursCol < 0 || desgCol < 0) {
    console.log('  ERROR: ' + fileName + ' missing required headers (Date, Job#, Billable Hours, Designer)');
    return { imported: 0, skipped: 0, unresolved: [] };
  }

  // Load existing keys for idempotency
  var existing = {};
  try {
    var allRaw = DAL.readAll(MigrationConfig.TABLES.RAW_IMPORT, { callerModule: 'MayTimesheetImporter' });
    (allRaw || []).forEach(function(r) {
      if (r.migration_batch === MAY_BATCH && r.source_tab === sourceTabKey + '|' + fileName) {
        existing[r.import_key] = true;
      }
    });
  } catch(e) { /* proceed */ }

  var buffer = [], imported = 0, skipped = 0, unresolved = [];

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row[jobCol] && !row[dateCol]) { skipped++; continue; }

    var importKey = 'BATCH-' + MAY_BATCH + '|FILE-' + fileName + '|ROW-' + i;
    if (existing[importKey]) { skipped++; continue; }

    var workDate   = String(row[dateCol]  || '').trim();
    var jobNum     = String(row[jobCol]   || '').trim();
    var hours      = String(row[hoursCol] || '').trim();
    var designer   = String(row[desgCol]  || '').trim();
    var desc       = descCol >= 0 ? String(row[descCol] || '').trim() : '';

    var personCode = resolveDesigner_(designer, staffLookup);
    var actorRole  = resolveRole_(desc);

    if (!personCode) {
      unresolved.push('row ' + (i + 1) + ': "' + designer + '"');
      personCode = designer; // stored raw — validator will flag with a clear message
    }

    buffer.push({
      import_key:      importKey,
      migration_batch: MAY_BATCH,
      source_tag:      'MAY_TIMESHEETS',
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
      imported_by: MAY_RUNNER_EMAIL_
    });

    if (buffer.length >= 100) {
      DAL.appendRows(MigrationConfig.TABLES.RAW_IMPORT, buffer, { callerModule: 'MayTimesheetImporter' });
      imported += buffer.length;
      buffer = [];
    }
  }

  if (buffer.length > 0) {
    DAL.appendRows(MigrationConfig.TABLES.RAW_IMPORT, buffer, { callerModule: 'MayTimesheetImporter' });
    imported += buffer.length;
  }

  return { imported: imported, skipped: skipped, unresolved: unresolved };
}

// ── Top-level runners ──────────────────────────────────────

/**
 * Step A — reads all CSV files from the "BLC May Timesheets" Drive folder
 * and imports them into MIGRATION_RAW_IMPORT as BATCH-002.
 */
function runImportMayTimesheets() {
  console.log('═══════════════════════════════════════════');
  console.log('[MayTimesheetImporter] STEP A: import from Drive');
  console.log('  Batch:  ' + MAY_BATCH);
  console.log('  Folder: ' + MAY_DRIVE_FOLDER_);
  console.log('═══════════════════════════════════════════');

  // Locate the Drive folder
  var folders = DriveApp.getFoldersByName(MAY_DRIVE_FOLDER_);
  if (!folders.hasNext()) {
    console.log('  ❌ Folder "' + MAY_DRIVE_FOLDER_ + '" not found in Drive.');
    console.log('     Create it, upload your CSV files, then re-run.');
    return;
  }
  var folder = folders.next();

  // Get all CSV files
  var files    = folder.getFilesByType(MimeType.CSV);
  var fileList = [];
  while (files.hasNext()) fileList.push(files.next());

  if (fileList.length === 0) {
    console.log('  ❌ No CSV files found in "' + MAY_DRIVE_FOLDER_ + '".');
    return;
  }
  console.log('  Found ' + fileList.length + ' CSV file(s)');

  var staffLookup   = buildStaffLookup_();
  var sourceTabKey  = MigrationConfig.STACEY_TABLES.WORK_LOGS;
  var totalImported = 0, totalSkipped = 0, allUnresolved = [];

  fileList.forEach(function(file) {
    console.log('  ─── ' + file.getName());
    var r = importCsvFile_(file, sourceTabKey, staffLookup);
    totalImported += r.imported;
    totalSkipped  += r.skipped;
    allUnresolved  = allUnresolved.concat(r.unresolved);
    console.log('    imported=' + r.imported + '  skipped=' + r.skipped +
                (r.unresolved.length ? '  ⚠️ unresolved=' + r.unresolved.length : ''));
    r.unresolved.forEach(function(u) { console.log('    ⚠️  ' + u); });
  });

  console.log('─────────────────────────────────────────');
  console.log('  Total imported: ' + totalImported);
  console.log('  Total skipped:  ' + totalSkipped);
  if (allUnresolved.length > 0) {
    console.log('  ⚠️  ' + allUnresolved.length + ' unresolved designer(s) — will be flagged INVALID in normalize step.');
  } else {
    console.log('  ✅ All designers resolved. Run runNormalizeMayTimesheets() next.');
  }
  console.log('═══════════════════════════════════════════');
}

/** Step B — normalize BATCH-002. */
function runNormalizeMayTimesheets() {
  console.log('═══════════════════════════════════════════');
  console.log('[MayTimesheetImporter] STEP B: normalize BATCH-002');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MigrationNormalizer.normalizeAll(MAY_RUNNER_EMAIL_, MAY_BATCH);
    console.log('  normalized=' + (r.normalized||0) + '  invalid=' + (r.invalid||0) + '  skipped=' + (r.skipped||0));
    console.log(r.invalid > 0
      ? '  ⚠️  Check MIGRATION_NORMALIZED for validation_notes.'
      : '  ✅ Done. Run runEnableOverridesMay() then runReplayMayTimesheets().');
  } catch(e) { console.log('  ❌ ' + e.message); }
  console.log('═══════════════════════════════════════════');
}

/** Step B2 — re-normalize INVALID rows after fixing aliases or corrections. */
function runReNormalizeMayInvalids() {
  console.log('═══════════════════════════════════════════');
  console.log('[MayTimesheetImporter] STEP B2: re-normalize INVALID rows');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MigrationNormalizer.reNormalizeInvalid(MAY_RUNNER_EMAIL_, MAY_BATCH);
    console.log('  fixed=' + (r.fixed||0) + '  stillInvalid=' + (r.stillInvalid||0));
    console.log(r.stillInvalid > 0
      ? '  ⚠️  ' + r.stillInvalid + ' rows still invalid — check MIGRATION_NORMALIZED.'
      : '  ✅ All resolved. Run runEnableOverridesMay() then runReplayMayTimesheets().');
  } catch(e) { console.log('  ❌ ' + e.message); }
  console.log('═══════════════════════════════════════════');
}

/** Step C — enable override for 2026-05 writes. */
function runEnableOverridesMay() {
  MigrationConfig.enableOverrides();
  console.log('  ✅ Overrides ENABLED. Run runReplayMayTimesheets() now.');
}

/** Step D — replay BATCH-002 into FACT tables. Re-run if partial. */
function runReplayMayTimesheets() {
  console.log('═══════════════════════════════════════════');
  console.log('[MayTimesheetImporter] STEP D: replay BATCH-002');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MigrationReplayEngine.replayAll(MAY_RUNNER_EMAIL_, MAY_BATCH);
    console.log('  replayed=' + r.replayed + '  skipped=' + r.skipped + '  failed=' + r.failed);
    console.log(r.partial
      ? '  ⚠️  Partial — re-run to continue.'
      : '  ✅ Complete. Run runDisableOverridesMay() NOW.');
  } catch(e) { console.log('  ❌ ' + e.message); }
  console.log('═══════════════════════════════════════════');
}

/** Step E — CRITICAL: restore production mode. */
function runDisableOverridesMay() {
  MigrationConfig.disableOverrides();
  console.log('  ✅ Overrides DISABLED. System back in production mode.');
}
