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
