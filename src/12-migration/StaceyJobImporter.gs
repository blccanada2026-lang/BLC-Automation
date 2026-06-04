// ============================================================
// StaceyJobImporter.gs — BLC Nexus T12 Migration
// src/12-migration/StaceyJobImporter.gs
//
// Reads active jobs from the Stacey V2 master Google Sheet and
// writes FACT_JOB_EVENTS so designers can log hours via the portal.
//
// SOURCE:
//   Stacey V2 sheet ID: 1EIuLg4dJjePPOSinMcGZocKGpe2wnjXI2pEFflD_f9U
//   Tab: whichever sheet contains the 'Job_Number' header (auto-detected)
//
// EVENTS WRITTEN PER JOB (in order):
//   Picked Up / In Design  → JOB_CREATED + JOB_STARTED
//   Submitted For QC / In QC → JOB_CREATED + JOB_STARTED + QC_SUBMITTED
//   On Hold                → JOB_CREATED + JOB_STARTED + JOB_HELD
//
// IDEMPOTENCY:
//   Key: STACEY_JOB|{Job_Number}|{EVENT_TYPE}
//   Safe to re-run — existing keys are skipped.
//
// RUN ORDER:
//   Step A: runImportStaceyJobs()         ← imports jobs → FACT_JOB_EVENTS
//   Step B: runRebuildViewsAfterImport()  ← rebuilds VW_JOB_CURRENT_STATE
//   Step C: runVerifyStaceyImport()       ← confirms counts + unresolved names
// ============================================================

var STACEY_SHEET_ID_  = '1EIuLg4dJjePPOSinMcGZocKGpe2wnjXI2pEFflD_f9U';
var STACEY_RUNNER_EMAIL_ = 'blccanada2026@gmail.com';

// Stacey Status → event sequence
var STATUS_EVENT_MAP_ = {
  'Picked Up':        ['JOB_CREATED', 'JOB_STARTED'],
  'In Design':        ['JOB_CREATED', 'JOB_STARTED'],
  'Submitted For QC': ['JOB_CREATED', 'JOB_STARTED', 'QC_SUBMITTED'],
  'In QC':            ['JOB_CREATED', 'JOB_STARTED', 'QC_SUBMITTED'],
  'On Hold':          ['JOB_CREATED', 'JOB_STARTED', 'JOB_HELD']
};

// Name variants in Stacey that don't match DIM_STAFF_ROSTER spelling exactly.
// Add entries here when runVerifyStaceyImport() reports unresolved names.
var JOB_NAME_ALIASES_ = {
  'raj kumar':    'RKU',
  'priyanka s':   'PRS',
  'debby gosh':   'DBG',
  'deb sen':      'DBS',
  'banik sagar':  'BSG',
  'sarty gosh':   'SGO',
  'pabitra gosh': 'PBG',
  'vani kv':      'VKV',
  'savvy nath':   'SNA',
  'bittu dalui':  'BTD'
};

// ── Private helpers ────────────────────────────────────────

/**
 * Builds name→person_code and first-name→person_code lookups
 * from DIM_STAFF_ROSTER via DAL.
 */
function buildJobStaffLookup_() {
  var nameMap = {}, firstMap = {};
  try {
    var rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'StaceyJobImporter' });
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
 * Resolves a Stacey designer name to a V3 person_code.
 * Returns null if unresolvable.
 */
function resolveJobDesigner_(raw, lookup) {
  if (!raw) return null;
  var name = String(raw).trim().toLowerCase();
  if (JOB_NAME_ALIASES_[name])          return JOB_NAME_ALIASES_[name];
  if (lookup.nameMap[name])             return lookup.nameMap[name];
  var first = name.split(/\s+/)[0];
  if (first && lookup.firstMap[first])  return lookup.firstMap[first];
  return null;
}

/**
 * Converts a Stacey date cell to 'YYYY-MM-DD'.
 * Handles Date objects (from Sheets) and string values.
 */
function staceyToIsoDate_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(val).trim();
  // Handle M/D/YYYY format
  var mdY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdY) {
    var m = ('0' + mdY[1]).slice(-2);
    var d = ('0' + mdY[2]).slice(-2);
    return mdY[3] + '-' + m + '-' + d;
  }
  return s.slice(0, 10);
}

/** Returns 'YYYY-MM' period string from a date string. Falls back to current period. */
function toPeriodId_(dateStr) {
  if (!dateStr || dateStr.length < 7) {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  }
  return dateStr.slice(0, 7);
}

/**
 * Finds the sheet tab in the Stacey spreadsheet whose first row
 * contains 'Job_Number'. Auto-detects tab name.
 * Returns the Sheet object, or null if not found.
 */
function findJobMasterSheet_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var firstRow = sheet.getRange(1, 1, 1, Math.min(sheet.getLastColumn(), 10)).getValues()[0];
    for (var j = 0; j < firstRow.length; j++) {
      if (String(firstRow[j]).trim() === 'Job_Number') return sheet;
    }
  }
  return null;
}

/**
 * Reads all values from the job master sheet and returns parsed job objects.
 * Filters out test rows (Is_Test = 'Yes') and inactive statuses.
 */
function readActiveStaceyJobs_(sheet) {
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  // Build column index map from header row
  var headers = data[0];
  var col = {};
  headers.forEach(function(h, i) {
    col[String(h).trim()] = i;
  });

  var required = ['Job_Number', 'Client_Code', 'Designer_Name', 'Status',
                  'Product_Type', 'Allocated_Date', 'Start_Date', 'Is_Test'];
  for (var r = 0; r < required.length; r++) {
    if (col[required[r]] === undefined) {
      console.log('  ❌ Missing required column: ' + required[r]);
      console.log('  Found columns: ' + headers.join(', '));
      return [];
    }
  }

  var jobs = [];
  for (var i = 1; i < data.length; i++) {
    var row    = data[i];
    var jobNum = String(row[col['Job_Number']] || '').trim();
    var status = String(row[col['Status']]     || '').trim();
    var isTest = String(row[col['Is_Test']]    || '').trim().toLowerCase();

    if (!jobNum)                        continue;  // blank row
    if (isTest === 'yes')               continue;  // test job
    if (!STATUS_EVENT_MAP_[status])     continue;  // not an active status

    jobs.push({
      job_number:     jobNum,
      client_code:    String(row[col['Client_Code']]   || '').trim(),
      designer_name:  String(row[col['Designer_Name']] || '').trim(),
      product_type:   String(row[col['Product_Type']]  || '').trim(),
      allocated_date: staceyToIsoDate_(row[col['Allocated_Date']]),
      start_date:     staceyToIsoDate_(row[col['Start_Date']]),
      status:         status,
      qc_lead:        col['QC_Lead'] !== undefined ? String(row[col['QC_Lead']] || '').trim() : ''
    });
  }
  return jobs;
}

/** Idempotency key for a job+event pair. */
function jobIdemKey_(jobNumber, eventType) {
  return 'STACEY_JOB|' + jobNumber + '|' + eventType;
}

/**
 * Returns a set of already-written idempotency keys from FACT_JOB_EVENTS.
 * Reads all partitions so re-runs are always safe.
 */
function loadExistingJobKeys_() {
  var existing = {};
  // Discover all FACT_JOB_EVENTS partitions
  var periods = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'];
  periods.forEach(function(pid) {
    try {
      var rows = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS, {
        callerModule: 'StaceyJobImporter',
        periodId: pid
      });
      (rows || []).forEach(function(r) {
        var k = String(r.idempotency_key || '').trim();
        if (k) existing[k] = true;
      });
    } catch(e) { /* partition may not exist yet */ }
  });
  return existing;
}

/**
 * Writes the event sequence for one Stacey job to FACT_JOB_EVENTS.
 * Skips events whose idempotency key already exists.
 * Returns { written, skipped }.
 */
function writeJobEvents_(job, personCode, existingKeys) {
  var events  = STATUS_EVENT_MAP_[job.status] || [];
  var written = 0, skipped = 0;

  // Use Allocated_Date for JOB_CREATED, Start_Date for JOB_STARTED+
  var createdDate = job.allocated_date || job.start_date ||
                    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var startedDate = job.start_date || createdDate;
  var periodId    = toPeriodId_(createdDate);

  var ts = new Date().toISOString();
  var base = {
    job_number:   job.job_number,
    period_id:    periodId,
    actor_code:   personCode || 'STACEY_IMPORT',
    actor_role:   'PM',
    client_code:  job.client_code,
    job_type:     job.product_type,
    product_code: '',
    quantity:     1,
    notes:        'Migrated from Stacey V2',
    payload_json: JSON.stringify({ source: 'StaceyJobImporter', status: job.status })
  };

  for (var e = 0; e < events.length; e++) {
    var eventType = events[e];
    var idemKey   = jobIdemKey_(job.job_number, eventType);

    if (existingKeys[idemKey]) { skipped++; continue; }

    var eventDate = (eventType === 'JOB_CREATED') ? createdDate : startedDate;

    var row = {
      event_id:        Identifiers.generateId(),
      event_type:      eventType,
      timestamp:       eventDate + 'T00:00:00.000Z',
      allocated_to:    personCode || '',
      idempotency_key: idemKey
    };

    // Merge base fields
    Object.keys(base).forEach(function(k) { row[k] = base[k]; });

    try {
      DAL.appendRow(Config.TABLES.FACT_JOB_EVENTS, row, {
        callerModule: 'StaceyJobImporter',
        periodId: periodId
      });
      existingKeys[idemKey] = true;  // prevent double-write in same run
      written++;
    } catch(err) {
      console.log('  ❌ Failed writing ' + eventType + ' for ' + job.job_number + ': ' + err.message);
    }
  }
  return { written: written, skipped: skipped };
}

// ── Top-level runners ──────────────────────────────────────

/**
 * Step A — reads active jobs from Stacey V2 and writes FACT_JOB_EVENTS.
 * Idempotent — re-run safely at any time.
 */
function runImportStaceyJobs() {
  console.log('═══════════════════════════════════════════');
  console.log('[StaceyJobImporter] STEP A: import active jobs');
  console.log('  Source: ' + STACEY_SHEET_ID_);
  console.log('═══════════════════════════════════════════');

  // Open Stacey sheet
  var ss;
  try {
    ss = SpreadsheetApp.openById(STACEY_SHEET_ID_);
  } catch(e) {
    console.log('  ❌ Cannot open Stacey sheet: ' + e.message);
    console.log('  Ensure the script has access to this spreadsheet.');
    return;
  }

  // Find job master tab
  var sheet = findJobMasterSheet_(ss);
  if (!sheet) {
    console.log('  ❌ Could not find a sheet with Job_Number header.');
    console.log('  Available tabs: ' + ss.getSheets().map(function(s){ return s.getName(); }).join(', '));
    return;
  }
  console.log('  Tab found: "' + sheet.getName() + '"');

  // Read active jobs
  var jobs = readActiveStaceyJobs_(sheet);
  console.log('  Active jobs to process: ' + jobs.length);
  if (jobs.length === 0) {
    console.log('  ⚠️  No active jobs found. Check status values in Stacey sheet.');
    return;
  }

  // Build staff lookup
  var lookup       = buildJobStaffLookup_();
  var existingKeys = loadExistingJobKeys_();

  var totalWritten = 0, totalSkipped = 0, unresolved = [];

  jobs.forEach(function(job) {
    var personCode = resolveJobDesigner_(job.designer_name, lookup);
    if (!personCode) {
      unresolved.push(job.job_number + ': "' + job.designer_name + '"');
    }

    var r = writeJobEvents_(job, personCode, existingKeys);
    totalWritten += r.written;
    totalSkipped += r.skipped;
  });

  console.log('─────────────────────────────────────────');
  console.log('  Events written: ' + totalWritten);
  console.log('  Events skipped: ' + totalSkipped + ' (already existed)');
  if (unresolved.length > 0) {
    console.log('  ⚠️  ' + unresolved.length + ' unresolved designer name(s):');
    unresolved.forEach(function(u) { console.log('    ' + u); });
    console.log('  Add these to JOB_NAME_ALIASES_ and re-run.');
  } else {
    console.log('  ✅ All designers resolved.');
  }
  console.log('  Next: run runRebuildViewsAfterImport()');
  console.log('═══════════════════════════════════════════');
}

/**
 * Step B — rebuilds VW_JOB_CURRENT_STATE from FACT_JOB_EVENTS.
 * Run after runImportStaceyJobs() completes.
 */
function runRebuildViewsAfterImport() {
  console.log('═══════════════════════════════════════════');
  console.log('[StaceyJobImporter] STEP B: rebuild VW_JOB_CURRENT_STATE');
  console.log('═══════════════════════════════════════════');
  try {
    var result = EventReplayEngine.rebuildAllViews(STACEY_RUNNER_EMAIL_);
    console.log('  ✅ Views rebuilt: ' + JSON.stringify(result));
    console.log('  Open the portal to verify job list.');
  } catch(e) {
    console.log('  ❌ Rebuild failed: ' + e.message);
    console.log('  Run portal_rebuildViews() from the portal (CEO dashboard) instead.');
  }
  console.log('═══════════════════════════════════════════');
}

/**
 * Diagnostic — run this FIRST if runImportStaceyJobs() shows no output.
 * Returns a short status string visible in the Apps Script editor return value area.
 */
function runTestStaceyAccess() {
  var lines = [];
  lines.push('=== StaceyJobImporter diagnostic ===');

  // 1. Can we open the Stacey sheet?
  var ss;
  try {
    ss = SpreadsheetApp.openById(STACEY_SHEET_ID_);
    lines.push('✅ Opened sheet: ' + ss.getName());
  } catch(e) {
    lines.push('❌ Cannot open Stacey sheet: ' + e.message);
    lines.push('   Fix: share the Stacey sheet with the account running this script,');
    lines.push('   or run this from the same Google account that owns both sheets.');
    var msg = lines.join('\n');
    console.log(msg);
    return msg;
  }

  // 2. List tabs
  var tabs = ss.getSheets().map(function(s) { return s.getName(); });
  lines.push('Tabs found: ' + tabs.join(', '));

  // 3. Find job master tab
  var sheet = findJobMasterSheet_(ss);
  if (!sheet) {
    lines.push('❌ No tab with Job_Number header found.');
  } else {
    lines.push('✅ Job master tab: "' + sheet.getName() + '"');
    var lastRow = sheet.getLastRow();
    lines.push('   Rows (inc. header): ' + lastRow);
    if (lastRow > 1) {
      var sample = sheet.getRange(2, 1, Math.min(3, lastRow - 1), sheet.getLastColumn()).getValues();
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var statusCol = headers.indexOf('Status');
      lines.push('   Sample statuses (first 3 rows): ' +
        sample.map(function(r){ return r[statusCol]; }).join(', '));
    }
  }

  // 4. Can we read DIM_STAFF_ROSTER?
  try {
    var roster = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'StaceyJobImporter' });
    lines.push('✅ DIM_STAFF_ROSTER: ' + (roster || []).length + ' staff rows');
  } catch(e) {
    lines.push('❌ DIM_STAFF_ROSTER read failed: ' + e.message);
  }

  var msg = lines.join('\n');
  console.log(msg);
  return msg;
}

/**
 * Step C — verifies the import result.
 * Reports: events written per period, unresolved names, VW row count.
 */
function runVerifyStaceyImport() {
  console.log('═══════════════════════════════════════════');
  console.log('[StaceyJobImporter] STEP C: verify import');
  console.log('═══════════════════════════════════════════');

  // Count FACT_JOB_EVENTS rows per period
  var periods = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'];
  var totalEvents = 0;
  periods.forEach(function(pid) {
    try {
      var rows = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS, {
        callerModule: 'StaceyJobImporter', periodId: pid
      });
      var staceyRows = (rows || []).filter(function(r) {
        return String(r.idempotency_key || '').indexOf('STACEY_JOB|') === 0;
      });
      if (staceyRows.length > 0) {
        console.log('  FACT_JOB_EVENTS|' + pid + ': ' + staceyRows.length + ' stacey events');
        totalEvents += staceyRows.length;
      }
    } catch(e) { /* partition may not exist */ }
  });
  console.log('  Total Stacey events written: ' + totalEvents);

  // Count VW_JOB_CURRENT_STATE
  try {
    var vw = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: 'StaceyJobImporter' });
    var byState = {};
    (vw || []).forEach(function(r) {
      var s = String(r.current_state || 'UNKNOWN');
      byState[s] = (byState[s] || 0) + 1;
    });
    console.log('  VW_JOB_CURRENT_STATE (' + (vw||[]).length + ' total rows):');
    Object.keys(byState).sort().forEach(function(s) {
      console.log('    ' + s + ': ' + byState[s]);
    });
  } catch(e) {
    console.log('  ⚠️  Could not read VW_JOB_CURRENT_STATE: ' + e.message);
    console.log('  Run runRebuildViewsAfterImport() if not done yet.');
  }

  console.log('═══════════════════════════════════════════');
}
