// ============================================================
// DataSelfHealing.gs — BLC Nexus T9 Notifications
// src/09-notifications/DataSelfHealing.gs
//
// COMMIT 3 OF 7 — Check 4 (dead letter growth) + the two self-healing
// actions. Detection and healing for the dead letter queue live
// together here; Check 4 was moved out of the original single-file
// DataIntegrityMonitor.gs during the 2026-07-09 split (RULE A8,
// .claude/rules/core_rules.md).
//
// Module naming: this file's DAL callerModule is 'DataSelfHealing',
// added to STG_PROCESSING_QUEUE's WRITE_PERMISSIONS in DAL.gs. It
// deliberately does NOT reuse the 'RetryManager' identity already
// registered there — architecture.md describes RetryManager.gs as
// exponential-backoff retry for FAILED items *before* they reach
// DEAD_LETTER (queue-layer, not yet built); this file recovers items
// *after* they've already reached the terminal DEAD_LETTER status
// (notifications-layer, per this build's spec). Different stage,
// different concern — claiming RetryManager's identity here would
// misattribute whoever eventually builds the real queue-layer module.
//
// Self-healing constraints (from spec):
//   - Config.isDev() guard on both self-healing actions — they only
//     execute in PROD. Config.isDev() reflects the deployed
//     environment (Config.gs: `_env === 'DEV'`), not a per-call test
//     toggle, so this is a real environment gate, not R10's test-
//     runner guard.
//   - Every recovery action is logged via Logger.info() → _SYS_LOGS.
//   - Dead letter retry is idempotent by construction: it only acts
//     on items currently in DEAD_LETTER status; once reset to
//     PENDING, a re-run's DEAD_LETTER filter no longer matches them.
//   - Queue stall auto-trigger debounces via a script property
//     cooldown so it fires at most once per 15-minute cycle even if
//     called more than once within that window.
//
// Trigger wiring (installing these on the 15-min health cycle / a
// daily 04:00 schedule) is commit 5, per the build plan. For now both
// are manually-callable functions only.
// ============================================================

// ─────────────────────────────────────────────────────────────
// Check 4 — Dead letter queue growth (HIGH)
//
// DEAD_LETTER_QUEUE items in the last 24 hours. Threshold: > 3 items
// triggers the issue. Grouped by form_type + most common error_message
// so the alert is actionable rather than just a count (distinct from
// ExecutionHealthMonitor's 15-min checkDeadLetter_(), which is an
// unconditional any-recent-item routine ops check — left unmodified).
// ─────────────────────────────────────────────────────────────

function checkDeadLetterGrowth_() {
  var MODULE = 'DataIntegrityMonitor';
  var THRESHOLD = 3;

  var rows   = DAL.readAll(Config.TABLES.DEAD_LETTER_QUEUE, { callerModule: MODULE });
  var cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  var recent = rows.filter(function(r) {
    return String(r.dead_lettered_at || '') >= cutoff;
  });

  if (recent.length <= THRESHOLD) return [];

  // byFormType[form_type] = { count, errors: { message: count } }
  var byFormType = {};
  recent.forEach(function(r) {
    var ft = String(r.form_type || 'UNKNOWN');
    if (!byFormType[ft]) byFormType[ft] = { count: 0, errors: {} };
    byFormType[ft].count++;
    var err = String(r.error_message || '').substring(0, 120);
    byFormType[ft].errors[err] = (byFormType[ft].errors[err] || 0) + 1;
  });

  var breakdown = Object.keys(byFormType).sort(function(a, b) {
    return byFormType[b].count - byFormType[a].count;
  }).map(function(ft) {
    var errs = byFormType[ft].errors;
    var topError = Object.keys(errs).sort(function(a, b) { return errs[b] - errs[a]; })[0] || '';
    return ft + ': ' + byFormType[ft].count + ' (top error: "' + topError + '")';
  });

  return [{
    check:    'CHECK_4_DEAD_LETTER_GROWTH',
    severity: DIM_SEVERITY_.HIGH,
    category: 'DEAD_LETTER_GROWTH',
    message:  recent.length + ' item(s) dead-lettered in the last 24 hours (threshold ' + THRESHOLD +
              '). Breakdown: ' + breakdown.join('; '),
    data: {
      total_24h:  recent.length,
      threshold:  THRESHOLD,
      by_form_type: byFormType
    },
    recommendedAction: 'Review the Dead Letter Queue sheet, or run runDeadLetterRecovery() to auto-retry ' +
                        'items classified as transient.'
  }];
}

// ─────────────────────────────────────────────────────────────
// Self-healing action 1 — Dead letter auto-retry
//
// STG_PROCESSING_QUEUE items with status DEAD_LETTER, older than 24h
// (by updated_at, set when markDeadLetter_() ran — see
// QueueProcessor.gs), classified by error text:
//   PERMANENT (skip)  — validation/RBAC/business-rule rejections that
//     will fail identically on retry.
//   TRANSIENT (retry) — infrastructure hiccups (timeouts, sheet-read
//     failures) that a plain re-run can plausibly clear.
//   UNKNOWN (skip)    — anything not confidently classified. Guessing
//     wrong here means silently resurrecting a permanently-broken
//     item into the live queue, so unmatched errors are left for
//     manual review rather than retried.
// Capped at 20 items per run (RULE P1 — quota guard).
//
// IMPORTANT — where the real error text actually lives:
// For the dominant dead-letter path (handler failure via
// ErrorHandler.wrap in QueueProcessor.gs Step 6), the DEAD_LETTER_QUEUE
// / STG_PROCESSING_QUEUE error_message field is NOT the underlying
// exception's message — it's a synthesized wrapper:
//   'Handler failed (attempt N/M) — exception: <uuid>'
// (QueueProcessor.gs ~line 442). The real message — e.g. an
// RBACError_'s '[RBAC:PERMISSION_DENIED] ...' or a DalError_'s
// '[DAL:SHEET_NOT_FOUND] ...' (RBAC.gs, DAL.gs) — is recorded
// separately in _SYS_EXCEPTIONS.message, keyed by that same uuid as
// exception_id (ErrorHandler.gs buildRow_/persistException_).
// Classifying against the wrapper text alone would never match either
// pattern list and silently recover nothing. dshResolveErrorText_()
// extracts the uuid and resolves it before classification; item.error_message
// stays in the mix too, since the item-structure/actor-resolve/no-handler
// paths (QueueProcessor.gs Steps 1–3) write plain descriptive text
// directly with no exception_id at all.
// ─────────────────────────────────────────────────────────────

var DSH_PERMANENT_ERROR_PATTERNS_ = [
  'validation_failed', 'permission_denied', 'rbac',
  'product type is required', 'daily total would exceed', 'duplicate'
];
var DSH_TRANSIENT_ERROR_PATTERNS_ = [
  'timeout', 'sheet_not_found', 'service spreadsheets failed', 'queue_read_failed'
];
var DSH_RECOVERY_CAP_ = 20;
var DSH_DEAD_LETTER_AGE_MS_ = 24 * 60 * 60 * 1000;
var DSH_EXCEPTION_ID_PATTERN_ = /exception:\s*([0-9a-f-]{8,})/i;

/**
 * Resolves the real error text for a dead-lettered queue item: its own
 * error_message, plus (if the message references an exception_id, per
 * the 'Handler failed ... — exception: <uuid>' wrapper) the matching
 * _SYS_EXCEPTIONS row's message + error_code. Concatenated, since
 * either source alone can be the only place a matching pattern lives.
 * @param {Object} item             STG_PROCESSING_QUEUE row
 * @param {Object} exceptionsById   Map built once per run by runDeadLetterRecovery()
 * @returns {string}
 */
function dshResolveErrorText_(item, exceptionsById) {
  var text = String(item.error_message || '');
  var match = text.match(DSH_EXCEPTION_ID_PATTERN_);
  if (match) {
    var exc = exceptionsById[match[1]];
    if (exc) text += ' | ' + String(exc.message || '') + ' | ' + String(exc.error_code || '');
  }
  return text;
}

/** 'PERMANENT' | 'TRANSIENT' | 'UNKNOWN'. Transient checked first — an
 *  error containing both a transient and a permanent-looking substring
 *  is treated as transient (infra failure reporting a business error
 *  message is more likely than the reverse). */
function dshClassifyDeadLetterError_(errorText) {
  var msg = String(errorText || '').toLowerCase();
  for (var t = 0; t < DSH_TRANSIENT_ERROR_PATTERNS_.length; t++) {
    if (msg.indexOf(DSH_TRANSIENT_ERROR_PATTERNS_[t]) !== -1) return 'TRANSIENT';
  }
  for (var p = 0; p < DSH_PERMANENT_ERROR_PATTERNS_.length; p++) {
    if (msg.indexOf(DSH_PERMANENT_ERROR_PATTERNS_[p]) !== -1) return 'PERMANENT';
  }
  return 'UNKNOWN';
}

/**
 * Resets up to DSH_RECOVERY_CAP_ transiently-failed DEAD_LETTER queue
 * items back to PENDING (attempt_count 0) so QueueProcessor picks
 * them up on its next cycle.
 *
 * @param {boolean} [dryRun] When true, runs the full scan + resolve +
 *   classify pass and logs what it WOULD recover, but performs no
 *   DAL.updateWhere writes — and, unlike a live run, this bypasses the
 *   Config.isDev() gate so the classification logic (dshClassifyDeadLetterError_,
 *   dshResolveErrorText_) is actually observable in DEV. Without this,
 *   both self-healing actions are entirely unverifiable before their
 *   first PROD run — runDataIntegrityChecks() doesn't call them, and
 *   a live run early-returns under Config.isDev(). Use
 *   runDeadLetterRecovery(true) in DEV to see real classification
 *   output before trusting the live path.
 * @returns {{ skipped: boolean, dryRun: boolean, scanned: number,
 *             recovered: number, permanent: number, unknown: number,
 *             reason: string }}
 */
function runDeadLetterRecovery(dryRun) {
  var MODULE = 'DataSelfHealing';
  dryRun = !!dryRun;

  if (!dryRun && Config.isDev()) {
    console.log('[DataSelfHealing] runDeadLetterRecovery() skipped — DEV environment. ' +
                'Pass true (dry run) to preview classification without writing.');
    return { skipped: true, reason: 'DEV', dryRun: false, scanned: 0, recovered: 0, permanent: 0, unknown: 0 };
  }

  var rows = DAL.readAll(Config.TABLES.STG_PROCESSING_QUEUE, { callerModule: MODULE });
  var cutoff = Date.now() - DSH_DEAD_LETTER_AGE_MS_;

  var candidates = rows.filter(function(r) {
    if (String(r.status || '') !== Constants.QUEUE_STATUSES.DEAD_LETTER) return false;
    var updated = new Date(r.updated_at);
    return !isNaN(updated.getTime()) && updated.getTime() < cutoff;
  });

  // Build the exception_id -> row lookup once per run (see the
  // "IMPORTANT" note above dshResolveErrorText_) rather than one DAL
  // read per candidate.
  var exceptionRows = DAL.readAll(Config.TABLES.SYS_EXCEPTIONS, { callerModule: MODULE });
  var exceptionsById = {};
  exceptionRows.forEach(function(e) {
    if (e.exception_id) exceptionsById[String(e.exception_id)] = e;
  });

  var recovered = 0, permanent = 0, unknown = 0;
  var timestamp = new Date().toISOString();

  for (var i = 0; i < candidates.length && recovered < DSH_RECOVERY_CAP_; i++) {
    var item = candidates[i];
    var resolvedText   = dshResolveErrorText_(item, exceptionsById);
    var classification = dshClassifyDeadLetterError_(resolvedText);

    if (classification === 'PERMANENT') { permanent++; continue; }
    if (classification === 'UNKNOWN')   { unknown++; continue; }

    if (dryRun) {
      console.log('[DataSelfHealing] DRY RUN would recover queue_id=' + item.queue_id +
                  ' form_type=' + item.form_type + ' — resolved text: ' + resolvedText.substring(0, 200));
      recovered++;
      continue;
    }

    DAL.updateWhere(
      Config.TABLES.STG_PROCESSING_QUEUE,
      { queue_id: item.queue_id },
      {
        status:        Constants.QUEUE_STATUSES.PENDING,
        attempt_count: 0,
        error_message: 'Auto-recovered by DataSelfHealing at ' + timestamp +
                        '. Previous error: ' + resolvedText.substring(0, 300),
        updated_at:    timestamp
      },
      { callerModule: MODULE }
    );

    Logger.info('DEAD_LETTER_AUTO_RECOVERED', {
      module: MODULE, queue_id: item.queue_id, form_type: item.form_type,
      previous_error: resolvedText.substring(0, 200)
    });
    recovered++;
  }

  console.log('[DataSelfHealing] Dead letter recovery' + (dryRun ? ' (DRY RUN)' : '') +
              ' — scanned: ' + candidates.length +
              ', recovered: ' + recovered + ', permanent (skipped): ' + permanent +
              ', unknown (skipped): ' + unknown +
              (candidates.length > DSH_RECOVERY_CAP_ ? ' (cap reached — remainder next run)' : ''));

  return { skipped: false, dryRun: dryRun, scanned: candidates.length, recovered: recovered, permanent: permanent, unknown: unknown };
}

// ─────────────────────────────────────────────────────────────
// Self-healing action 2 — Queue stall detection
//
// STG_PROCESSING_QUEUE items with status PENDING older than 15
// minutes indicate QueueProcessor's trigger isn't running (or is
// stuck). If found, calls QueueProcessor.processQueue() once to
// unstick it. Debounced via a script property so back-to-back calls
// within DSH_STALL_COOLDOWN_MS_ don't re-trigger repeatedly.
// PROD only — no-ops in DEV.
// ─────────────────────────────────────────────────────────────

var DSH_STALL_THRESHOLD_MS_    = 15 * 60 * 1000;
var DSH_STALL_COOLDOWN_MS_     = 15 * 60 * 1000;
var DSH_LAST_STALL_TRIGGER_PROP_ = 'DSH_LAST_STALL_TRIGGER_MS';

/**
 * @returns {{ skipped: boolean, stalled: boolean, count: number,
 *             triggered: boolean, reason: string }}
 */
function runQueueStallRecovery() {
  var MODULE = 'DataSelfHealing';

  if (Config.isDev()) {
    console.log('[DataSelfHealing] runQueueStallRecovery() skipped — DEV environment.');
    return { skipped: true, reason: 'DEV', stalled: false, count: 0, triggered: false };
  }

  var rows   = DAL.readAll(Config.TABLES.STG_PROCESSING_QUEUE, { callerModule: MODULE });
  var cutoff = Date.now() - DSH_STALL_THRESHOLD_MS_;
  var stalled = rows.filter(function(r) {
    var status = String(r.status || '');
    if (status !== Constants.QUEUE_STATUSES.PENDING) return false;
    var created = new Date(r.created_at);
    return !isNaN(created.getTime()) && created.getTime() < cutoff;
  });

  if (stalled.length === 0) {
    return { skipped: false, stalled: false, count: 0, triggered: false };
  }

  var props = PropertiesService.getScriptProperties();
  var lastTrigger = parseInt(props.getProperty(DSH_LAST_STALL_TRIGGER_PROP_) || '0', 10);
  if (Date.now() - lastTrigger < DSH_STALL_COOLDOWN_MS_) {
    console.log('[DataSelfHealing] Queue stalled (' + stalled.length + ' item(s)) but auto-trigger is in cooldown.');
    return { skipped: false, stalled: true, count: stalled.length, triggered: false, reason: 'cooldown' };
  }

  props.setProperty(DSH_LAST_STALL_TRIGGER_PROP_, String(Date.now()));

  Logger.info('QUEUE_STALL_AUTO_TRIGGERED', { module: MODULE, stalled_count: stalled.length });
  console.log('[DataSelfHealing] Queue stalled — ' + stalled.length +
              ' item(s) pending > 15 min. Auto-triggered QueueProcessor.processQueue().');

  QueueProcessor.processQueue();

  return { skipped: false, stalled: true, count: stalled.length, triggered: true };
}
