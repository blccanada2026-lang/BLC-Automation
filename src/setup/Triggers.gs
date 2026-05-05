// ============================================================
// Triggers.gs — BLC Nexus Setup
// src/setup/Triggers.gs
//
// PURPOSE: Installs, lists, and removes Apps Script project
// triggers for the BLC Nexus system.
//
// HOW TO RUN (from Apps Script editor):
//   runInstallTriggers()   — install QueueProcessor time trigger
//   runInstallFormTrigger() — install form submit trigger
//                            (edit FORM_ID constant below first)
//   runListTriggers()      — list all installed triggers
//   runRemoveAllTriggers() — remove ALL triggers (use with care)
//
// TRIGGER ARCHITECTURE:
//
//   ┌─────────────────────────────────────────────────┐
//   │  Time-based (every 5 min in DEV)                │
//   │  Function: runQueueProcessor                    │
//   │  → QueueProcessor.processQueue()               │
//   └─────────────────────────────────────────────────┘
//
//   ┌─────────────────────────────────────────────────┐
//   │  Form onSubmit                                  │
//   │  Function: onIntakeFormSubmit                   │
//   │  → IntakeService.onFormSubmit(e)               │
//   └─────────────────────────────────────────────────┘
//
// SETUP ORDER:
//   1. Run runSetup() in SetupScript.gs first
//   2. Set INTAKE_FORM_ID below to your Google Form's ID
//   3. Run runInstallTriggers()
//   4. Run runInstallFormTrigger()
//   5. Verify with runListTriggers()
//
// FINDING FORM ID:
//   Open your Google Form → look at the URL:
//   https://docs.google.com/forms/d/{FORM_ID}/edit
//   Copy the FORM_ID and paste it below.
// ============================================================

// ── CONFIGURE THIS before running runInstallFormTrigger() ─────
// Replace with the actual Google Form ID for job intake.
// Found in the form's URL: /forms/d/{ID}/edit
var INTAKE_FORM_ID = '11MmM7Cux1hBaBB14X9-HcG-8roPgPDK8s0qOJrisuEA';

// ── Trigger function name constants ───────────────────────────
var TRIGGER_FN_QUEUE    = 'runQueueProcessor';
var TRIGGER_FN_INTAKE   = 'onIntakeFormSubmit';
var TRIGGER_FN_HEALTH   = 'runDailyHealthCheck';

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Returns true if a trigger for the given function name
 * already exists in this project.
 *
 * @param {string} functionName
 * @returns {boolean}
 */
function triggerExists_(functionName) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === functionName) return true;
  }
  return false;
}

/**
 * Logs trigger details to the execution console.
 * @param {Trigger} trigger  GAS Trigger object
 */
function logTrigger_(trigger) {
  var type = trigger.getEventType();
  var fn   = trigger.getHandlerFunction();
  var id   = trigger.getUniqueId();
  console.log('  [' + id.substring(0, 8) + '…] ' + fn + ' (' + type + ')');
}

// ============================================================
// INSTALL: QUEUE PROCESSOR TRIGGER
// Time-based trigger — fires every N minutes.
// Frequency from Config: DEV=5min, STAGING=5min, PROD=3min.
// Falls back to 5 minutes if Config is unavailable.
// ============================================================

/**
 * Installs the time-based QueueProcessor trigger.
 * Idempotent — skips if trigger already exists.
 */
function installQueueTrigger() {
  console.log('[Triggers] Installing QueueProcessor trigger…');

  if (triggerExists_(TRIGGER_FN_QUEUE)) {
    console.log('  ✅ Already installed — skipping.');
    return;
  }

  var minutes = 5;
  try {
    minutes = Config.getTriggerFrequency('queueProcessorMinutes') || 5;
  } catch (ignored) {}

  ScriptApp.newTrigger(TRIGGER_FN_QUEUE)
    .timeBased()
    .everyMinutes(minutes)
    .create();

  console.log('  ➕ Installed: ' + TRIGGER_FN_QUEUE + ' every ' + minutes + ' min');
}

// ============================================================
// INSTALL: FORM SUBMIT TRIGGER
// Fires when a user submits the intake Google Form.
// Requires INTAKE_FORM_ID to be set above.
// ============================================================

/**
 * Installs the form onSubmit trigger for the intake form.
 * Idempotent — skips if trigger already exists.
 *
 * @param {string} [formId]  Optional — overrides INTAKE_FORM_ID constant
 */
function installFormTrigger(formId) {
  var id = formId || INTAKE_FORM_ID;
  console.log('[Triggers] Installing form submit trigger…');

  if (!id || id === 'REPLACE_WITH_INTAKE_FORM_ID') {
    console.log('  ⚠️  INTAKE_FORM_ID not set.');
    console.log('  Edit Triggers.gs and set INTAKE_FORM_ID to your Google Form ID.');
    console.log('  Find it in the form URL: /forms/d/{FORM_ID}/edit');
    return;
  }

  if (triggerExists_(TRIGGER_FN_INTAKE)) {
    console.log('  ✅ Already installed — skipping.');
    return;
  }

  try {
    var form = FormApp.openById(id);
    ScriptApp.newTrigger(TRIGGER_FN_INTAKE)
      .forForm(form)
      .onFormSubmit()
      .create();
    console.log('  ➕ Installed: ' + TRIGGER_FN_INTAKE + ' on form ' + id);
  } catch (e) {
    console.log('  ❌ Failed to install form trigger: ' + e.message);
    console.log('  Check that the form ID is correct and this account has edit access.');
  }
}

// ============================================================
// INSTALL: DAILY HEALTH CHECK TRIGGER
// ============================================================

/**
 * Installs the daily health check trigger (6am, every day).
 * Idempotent — skips if trigger already exists.
 */
function installHealthCheckTrigger() {
  console.log('[Triggers] Installing daily health check trigger…');
  if (triggerExists_(TRIGGER_FN_HEALTH)) {
    console.log('  ✅ Already installed — skipping.');
    return;
  }
  ScriptApp.newTrigger(TRIGGER_FN_HEALTH)
    .timeBased()
    .atHour(6)
    .everyDays(1)
    .create();
  console.log('  ➕ Installed: ' + TRIGGER_FN_HEALTH + ' daily at 6am');
}

// ============================================================
// LIST TRIGGERS
// ============================================================

/**
 * Lists all project triggers to the execution log.
 */
function listTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  console.log('[Triggers] Installed triggers (' + triggers.length + '):');
  if (triggers.length === 0) {
    console.log('  (none)');
    return;
  }
  for (var i = 0; i < triggers.length; i++) {
    logTrigger_(triggers[i]);
  }
}

// ============================================================
// REMOVE TRIGGERS
// ============================================================

/**
 * Removes all project triggers.
 * DESTRUCTIVE — use only to reset before reinstalling.
 */
function removeAllTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  console.log('[Triggers] Removing ' + triggers.length + ' trigger(s)…');
  for (var i = 0; i < triggers.length; i++) {
    console.log('  🗑  Removing: ' + triggers[i].getHandlerFunction());
    ScriptApp.deleteTrigger(triggers[i]);
  }
  console.log('[Triggers] All triggers removed.');
}

// ============================================================
// TOP-LEVEL TRIGGER WRAPPER FUNCTIONS
//
// GAS calls trigger handlers by name from the global scope.
// These must be top-level functions — not inside any module.
// ============================================================

/**
 * QueueProcessor time-based trigger entry point.
 * DO NOT RENAME — this exact name is registered as the trigger handler.
 */
function runQueueProcessor() {
  QueueProcessor.processQueue();
}

// ============================================================
// PUBLIC ENTRY POINTS (visible in Apps Script editor)
// ============================================================

/**
 * Install the QueueProcessor time-based trigger.
 * Run this once after initial setup.
 */
function runInstallTriggers() {
  console.log('═══════════════════════════════════════════');
  console.log('BLC Nexus — Install Triggers');
  console.log('═══════════════════════════════════════════');
  installQueueTrigger();
  console.log('');
  console.log('Next: set INTAKE_FORM_ID in Triggers.gs');
  console.log('then run runInstallFormTrigger()');
  console.log('═══════════════════════════════════════════');
}

/**
 * Install the form onSubmit trigger.
 * Set INTAKE_FORM_ID at the top of this file first.
 */
function runInstallFormTrigger() {
  console.log('═══════════════════════════════════════════');
  console.log('BLC Nexus — Install Form Trigger');
  console.log('═══════════════════════════════════════════');
  installFormTrigger();
  console.log('═══════════════════════════════════════════');
}

/**
 * Public entry point — run once after initial setup.
 */
function runInstallHealthCheckTrigger() {
  console.log('═══════════════════════════════════════════');
  console.log('BLC Nexus — Install Health Check Trigger');
  console.log('═══════════════════════════════════════════');
  installHealthCheckTrigger();
  console.log('═══════════════════════════════════════════');
}

/**
 * List all installed project triggers.
 */
function runListTriggers() {
  console.log('═══════════════════════════════════════════');
  console.log('BLC Nexus — Trigger Status');
  console.log('═══════════════════════════════════════════');
  listTriggers_();
  console.log('═══════════════════════════════════════════');
}

/**
 * Remove ALL project triggers.
 * WARNING: This stops all background processing.
 * Re-run runInstallTriggers() after this to restore.
 */
function runRemoveAllTriggers() {
  console.log('═══════════════════════════════════════════');
  console.log('BLC Nexus — Remove All Triggers');
  console.log('═══════════════════════════════════════════');
  removeAllTriggers_();
  console.log('Run runInstallTriggers() to restore.');
  console.log('═══════════════════════════════════════════');
}

// ============================================================
// DESIGNER NAME RESOLUTION DIAGNOSTIC
// ============================================================

/**
 * Prints the name→code map built from DIM_STAFF_ROSTER and tests
 * how "Sarty Gosh - BL" resolves. Run from Apps Script editor.
 */
function runDiagnoseDesignerResolution() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('DIM_STAFF_ROSTER');
  if (!sheet) { console.log('ERROR: DIM_STAFF_ROSTER not found.'); return; }

  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var nameIdx = headers.indexOf('name');
  var codeIdx = headers.indexOf('person_code');

  if (nameIdx === -1 || codeIdx === -1) {
    console.log('ERROR: name or person_code column not found. Headers: ' + headers.join(', '));
    return;
  }

  console.log('=== DIM_STAFF_ROSTER name→code map ===');
  var nameMap = {};
  for (var i = 1; i < data.length; i++) {
    var code = String(data[i][codeIdx] || '').trim();
    var name = String(data[i][nameIdx] || '').trim();
    if (code && name) {
      nameMap[name.toLowerCase()] = code;
      console.log('  "' + name.toLowerCase() + '" → ' + code);
    }
  }

  console.log('');
  console.log('=== Resolution test: "Sarty Gosh - BL" ===');
  var raw     = 'Sarty Gosh - BL';
  var stripped = raw.replace(/\s*-\s*\w+\s*$/, '').trim().toLowerCase();
  console.log('  Stripped: "' + stripped + '"');
  console.log('  Resolved: ' + (nameMap[stripped] || 'NOT FOUND'));
}

// ============================================================
// SBS INTAKE TEST
// ============================================================

/**
 * Seeds one test row into STG_INTAKE_SBS for designer auto-assign testing.
 * Run from Apps Script editor, then click "Process SBS Jobs" in the portal.
 * Safe to re-run — adds a new row each time (use a unique Job # to avoid
 * idempotency collisions with previous test runs).
 */
function runSeedSbsTestRow() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('STG_INTAKE_SBS');
  if (!sheet) {
    console.log('ERROR: STG_INTAKE_SBS sheet not found.');
    return;
  }
  var jobRef = 'TEST-' + new Date().getTime();
  // Columns: Job #, Customer, Due Date, Notes, Product, Design/Estimator, Job Name, Model, _status, _queue_id, _queued_at, _error
  sheet.appendRow([
    jobRef,
    'Test Customer',
    '12/31/2026',
    'Submittal',
    'Roof',
    'Sarty Gosh - BL',
    'Test auto-assign row',
    'TestModel',
    '', '', '', ''
  ]);
  console.log('Test row added: ' + jobRef + ' | Roof | Sarty Gosh - BL');
  console.log('Now go to the portal and click "Process SBS Jobs".');
}

// ============================================================
// ONE-TIME SCHEMA PATCH
// ============================================================

/**
 * Adds the Design/Estimator → designer_name config row to DIM_CLIENT_INTAKE_CONFIG
 * for SBS. Run once from the Apps Script editor. Idempotent.
 */
function runAddSbsDesignerConfig() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('DIM_CLIENT_INTAKE_CONFIG');
  if (!sheet) {
    console.log('ERROR: DIM_CLIENT_INTAKE_CONFIG sheet not found.');
    return;
  }
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === 'SBS' && data[i][1] === 'Design/Estimator' && data[i][2] === 'designer_name') {
        console.log('Already present — nothing to do.');
        return;
      }
    }
  }
  sheet.appendRow(['SBS', 'Design/Estimator', 'designer_name', 'TRIM', 'FALSE', 5, '', 'Designer display name — resolved to allocated_to via DIM_STAFF_ROSTER']);
  console.log('Added: SBS | Design/Estimator → designer_name');
}

/**
 * Adds client_job_ref and target_date columns to VW_JOB_CURRENT_STATE.
 * Run once from the Apps Script editor. Safe to re-run — skips
 * columns that already exist.
 */
function runAddJobTableColumns() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet()
                .getSheetByName('VW_JOB_CURRENT_STATE');
  if (!sheet) {
    console.log('ERROR: VW_JOB_CURRENT_STATE sheet not found.');
    return;
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var newCols = ['client_job_ref', 'target_date'];
  var added   = [];
  newCols.forEach(function(col) {
    if (headers.indexOf(col) === -1) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col);
      added.push(col);
    }
  });
  console.log(added.length ? 'Added: ' + added.join(', ') : 'Already present — nothing to do.');
}
