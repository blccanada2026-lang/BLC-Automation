// ============================================================
// Q1TimesheetImporter.gs — BLC Nexus T12 Migration
// src/12-migration/Q1TimesheetImporter.gs
//
// Imports Jan/Feb/Mar 2026 (Q1) timesheets from CSV files in Google Drive.
//
// SETUP (one-time):
//   CSV files must already be in the "BLC May Timesheets" Drive folder.
//   Each file must have these headers (extra columns ignored):
//     Date | Job# | Billable Hours | Designer | Description
//
// RUN ORDER:
//   Step A: runImportQ1Timesheets()     ← reads Drive CSVs → MIGRATION_RAW_IMPORT
//   Step B: runNormalizeQ1Timesheets()  ← normalizes BATCH-003
//   Step C: runEnableOverridesQ1()      ← enables backdate for 2026-01/02/03
//   Step D: runReplayQ1Timesheets()     ← writes to FACT tables (re-run if partial)
//   Step E: runDisableOverridesQ1()     ← CRITICAL: restore prod mode
// ============================================================

var Q1_BATCH         = 'BATCH-003';
var Q1_RUNNER_EMAIL_ = 'blccanada2026@gmail.com';
var Q1_DRIVE_FOLDER_ = 'BLC May Timesheets';

var Q1_DESCRIPTION_ROLE_MAP_ = {
  'quality check': 'QC',
  'qc':            'QC',
  'q/c':           'QC'
};

// CSV name variants that don't match DIM_STAFF_ROSTER spelling exactly.
var Q1_NAME_ALIASES_ = {
  'abhisekh rit':   'AR001',
  'prianka santra': 'PRS',
  'abby bera':      'ABB',
  'sandy das':      'SDA',
  'nitish mishra':  'NMM',
  'ravi gummadi':   'RKG'
};

// ── Private helpers ────────────────────────────────────────

function q1BuildStaffLookup_() {
  var nameMap = {}, firstMap = {};
  try {
    var rows = DAL.readAll('DIM_STAFF_ROSTER', { callerModule: 'Q1TimesheetImporter' });
    (rows || []).forEach(function (r) {
      var code = String(r.person_code || '').trim();
      var name = String(r.name        || '').trim().toLowerCase();
      if (!code || !name) return;
      nameMap[name] = code;
      var first = name.split(/\s+/)[0];
      if (first && !firstMap[first]) firstMap[first] = code;
    });
  } catch (e) {
    console.log('  WARN: could not read DIM_STAFF_ROSTER — ' + e.message);
  }
  return { nameMap: nameMap, firstMap: firstMap };
}

function q1ResolveDesigner_(cell, lookup) {
  if (!cell) return null;
  var raw      = String(cell).trim();
  var dash     = raw.indexOf('-');
  var namePart = (dash >= 0 ? raw.substring(dash + 1) : raw).trim().toLowerCase();

  if (Q1_NAME_ALIASES_[namePart])           return Q1_NAME_ALIASES_[namePart];
  if (lookup.nameMap[namePart])             return lookup.nameMap[namePart];
  var first = namePart.split(/\s+/)[0];
  if (first && lookup.firstMap[first])      return lookup.firstMap[first];

  if (dash > 0) {
    var prefix = raw.substring(0, dash).trim();
    var codes  = Object.keys(lookup.nameMap).map(function (k) { return lookup.nameMap[k]; });
    if (codes.indexOf(prefix) !== -1)       return prefix;
  }
  return null;
}

function q1ResolveRole_(desc) {
  var key = String(desc || '').trim().toLowerCase();
  return Q1_DESCRIPTION_ROLE_MAP_[key] || 'DESIGNER';
}

function q1Col_(headers, name) {
  var lc = name.toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === lc) return i;
  }
  return -1;
}

function q1ImportCsvFile_(file, sourceTabKey, staffLookup) {
  var fileName = file.getName();
  var content;
  try {
    content = file.getBlob().getDataAsString('UTF-8');
  } catch (e) {
    console.log('  ERROR reading ' + fileName + ': ' + e.message);
    return { imported: 0, skipped: 0, unresolved: [] };
  }

  var rows = Utilities.parseCsv(content);
  if (!rows || rows.length < 2) {
    console.log('  SKIP (empty): ' + fileName);
    return { imported: 0, skipped: 0, unresolved: [] };
  }

  var headers  = rows[0];
  var dateCol  = q1Col_(headers, 'Date');
  var jobCol   = q1Col_(headers, 'Job#');
  var hoursCol = q1Col_(headers, 'Billable Hours');
  var desgCol  = q1Col_(headers, 'Designer');
  var descCol  = q1Col_(headers, 'Description');

  if (dateCol < 0 || jobCol < 0 || hoursCol < 0 || desgCol < 0) {
    console.log('  ERROR: ' + fileName + ' missing required headers (Date, Job#, Billable Hours, Designer)');
    return { imported: 0, skipped: 0, unresolved: [] };
  }

  // Load existing keys for idempotency
  var existing = {};
  try {
    var allRaw = DAL.readAll(MigrationConfig.TABLES.RAW_IMPORT, { callerModule: 'Q1TimesheetImporter' });
    (allRaw || []).forEach(function (r) {
      if (r.migration_batch === Q1_BATCH && r.source_tab === sourceTabKey + '|' + fileName) {
        existing[r.import_key] = true;
      }
    });
  } catch (e) { /* proceed */ }

  var buffer = [], imported = 0, skipped = 0, unresolved = [];

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (!row[jobCol] && !row[dateCol]) { skipped++; continue; }

    var importKey = Q1_BATCH + '|FILE-' + fileName + '|ROW-' + i;
    if (existing[importKey]) { skipped++; continue; }

    var workDate   = String(row[dateCol]  || '').trim();
    var jobNum     = String(row[jobCol]   || '').trim();
    var hours      = String(row[hoursCol] || '').trim();
    var designer   = String(row[desgCol]  || '').trim();
    var desc       = descCol >= 0 ? String(row[descCol] || '').trim() : '';

    // Only import Q1 rows (Jan/Feb/Mar 2026)
    var periodId = workDate.length >= 7 ? workDate.substring(0, 7) : '';
    if (periodId !== '2026-01' && periodId !== '2026-02' && periodId !== '2026-03') {
      skipped++;
      continue;
    }

    var personCode = q1ResolveDesigner_(designer, staffLookup);
    var actorRole  = q1ResolveRole_(desc);

    if (!personCode) {
      unresolved.push('row ' + (i + 1) + ': "' + designer + '"');
      personCode = designer;
    }

    buffer.push({
      import_key:      importKey,
      migration_batch: Q1_BATCH,
      source_tag:      'Q1_TIMESHEETS',
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
      imported_by: Q1_RUNNER_EMAIL_
    });

    if (buffer.length >= 100) {
      DAL.appendRows(MigrationConfig.TABLES.RAW_IMPORT, buffer, { callerModule: 'Q1TimesheetImporter' });
      imported += buffer.length;
      buffer = [];
    }
  }

  if (buffer.length > 0) {
    DAL.appendRows(MigrationConfig.TABLES.RAW_IMPORT, buffer, { callerModule: 'Q1TimesheetImporter' });
    imported += buffer.length;
  }

  return { imported: imported, skipped: skipped, unresolved: unresolved };
}

// ── Top-level runners ──────────────────────────────────────

/** Step A — reads all CSV files from "BLC May Timesheets" and imports Q1 rows into MIGRATION_RAW_IMPORT as BATCH-003. */
function runImportQ1Timesheets() {
  console.log('═══════════════════════════════════════════');
  console.log('[Q1TimesheetImporter] STEP A: import from Drive');
  console.log('  Batch:  ' + Q1_BATCH);
  console.log('  Folder: ' + Q1_DRIVE_FOLDER_);
  console.log('  Filter: 2026-01, 2026-02, 2026-03 rows only');
  console.log('═══════════════════════════════════════════');

  var folders = DriveApp.getFoldersByName(Q1_DRIVE_FOLDER_);
  if (!folders.hasNext()) {
    console.log('  ❌ Folder "' + Q1_DRIVE_FOLDER_ + '" not found in Drive.');
    return;
  }
  var folder = folders.next();
  var files   = folder.getFilesByType(MimeType.CSV);
  var fileList = [];
  while (files.hasNext()) fileList.push(files.next());

  if (fileList.length === 0) {
    console.log('  ❌ No CSV files found in "' + Q1_DRIVE_FOLDER_ + '".');
    return;
  }
  console.log('  Found ' + fileList.length + ' CSV file(s)');

  var staffLookup   = q1BuildStaffLookup_();
  var sourceTabKey  = MigrationConfig.STACEY_TABLES.WORK_LOGS;
  var totalImported = 0, totalSkipped = 0, allUnresolved = [];

  fileList.forEach(function (file) {
    console.log('  ─── ' + file.getName());
    var r = q1ImportCsvFile_(file, sourceTabKey, staffLookup);
    totalImported += r.imported;
    totalSkipped  += r.skipped;
    allUnresolved  = allUnresolved.concat(r.unresolved);
    console.log('    imported=' + r.imported + '  skipped=' + r.skipped +
                (r.unresolved.length ? '  ⚠️ unresolved=' + r.unresolved.length : ''));
    r.unresolved.forEach(function (u) { console.log('    ⚠️  ' + u); });
  });

  console.log('─────────────────────────────────────────');
  console.log('  Total imported: ' + totalImported);
  console.log('  Total skipped:  ' + totalSkipped);
  if (allUnresolved.length > 0) {
    console.log('  ⚠️  ' + allUnresolved.length + ' unresolved designer(s) — check MIGRATION_NORMALIZED after Step B.');
  } else {
    console.log('  ✅ All designers resolved. Run runNormalizeQ1Timesheets() next.');
  }
  console.log('═══════════════════════════════════════════');
}

/** Step B — normalize BATCH-003. */
function runNormalizeQ1Timesheets() {
  console.log('═══════════════════════════════════════════');
  console.log('[Q1TimesheetImporter] STEP B: normalize BATCH-003');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MigrationNormalizer.normalizeAll(Q1_RUNNER_EMAIL_, Q1_BATCH);
    console.log('  normalized=' + (r.normalized || 0) + '  invalid=' + (r.invalid || 0) + '  skipped=' + (r.skipped || 0));
    console.log(r.invalid > 0
      ? '  ⚠️  Check MIGRATION_NORMALIZED for validation_notes. Fix then run runReNormalizeQ1Invalids().'
      : '  ✅ Done. Run runEnableOverridesQ1() then runReplayQ1Timesheets().');
  } catch (e) { console.log('  ❌ ' + e.message); }
  console.log('═══════════════════════════════════════════');
}

/** Step B2 — re-normalize INVALID rows after fixing aliases or corrections. */
function runReNormalizeQ1Invalids() {
  console.log('═══════════════════════════════════════════');
  console.log('[Q1TimesheetImporter] STEP B2: re-normalize INVALID rows');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MigrationNormalizer.reNormalizeInvalid(Q1_RUNNER_EMAIL_, Q1_BATCH);
    console.log('  fixed=' + (r.fixed || 0) + '  stillInvalid=' + (r.stillInvalid || 0));
    console.log(r.stillInvalid > 0
      ? '  ⚠️  ' + r.stillInvalid + ' rows still invalid — check MIGRATION_NORMALIZED.'
      : '  ✅ All resolved. Run runEnableOverridesQ1() then runReplayQ1Timesheets().');
  } catch (e) { console.log('  ❌ ' + e.message); }
  console.log('═══════════════════════════════════════════');
}

/** Step C — enable backdate override for 2026-01/02/03 writes. */
function runEnableOverridesQ1() {
  MigrationConfig.enableOverrides();
  console.log('  ✅ Overrides ENABLED. Run runReplayQ1Timesheets() now.');
}

/** Step D — replay BATCH-003 into FACT tables. Re-run if partial. */
function runReplayQ1Timesheets() {
  console.log('═══════════════════════════════════════════');
  console.log('[Q1TimesheetImporter] STEP D: replay BATCH-003');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MigrationReplayEngine.replayAll(Q1_RUNNER_EMAIL_, Q1_BATCH);
    console.log('  replayed=' + r.replayed + '  skipped=' + r.skipped + '  failed=' + r.failed);
    console.log(r.partial
      ? '  ⚠️  Partial — re-run to continue.'
      : '  ✅ Complete. Run runDisableOverridesQ1() NOW.');
  } catch (e) { console.log('  ❌ ' + e.message); }
  console.log('═══════════════════════════════════════════');
}

/** Step E — CRITICAL: restore production mode. */
function runDisableOverridesQ1() {
  MigrationConfig.disableOverrides();
  console.log('  ✅ Overrides DISABLED. System back in production mode.');
}
