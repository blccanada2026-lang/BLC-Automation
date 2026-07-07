// ============================================================
// QueueItemDeepAudit.gs — BLC Nexus Data Diagnostic
// src/12-migration/QueueItemDeepAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runQueueItemDeepAudit()
//
// Console-only dump for the NORSPAN dead-letter investigation:
//   1. Every field of STG_PROCESSING_QUEUE row queue_id=QITM-026284C5A67A,
//      including a full parse of payload_json (all keys, not just a
//      summary) so product_code presence/blankness is directly visible.
//   2. _SYS_EXCEPTIONS row for exception_id=2d506255-7ebb-458f-8372-
//      c54f842106df — this is the table exception_id is actually the
//      primary key of (SetupScript.gs header). _SYS_LOGS has NO
//      exception_id column at all; ErrorHandler.gs embeds it inside
//      detail_json on the correlated Logger.error call instead (Layer 2
//      of its two-layer write: _SYS_EXCEPTIONS then _SYS_LOGS). So this
//      also scans _SYS_LOGS.detail_json for the same exception_id string
//      as the closest match to "the full error from _SYS_LOGS."
//
// Read-only — no writes to any table.
// ============================================================

var QIDA_QUEUE_ID     = 'QITM-026284C5A67A';
var QIDA_EXCEPTION_ID = '2d506255-7ebb-458f-8372-c54f842106df';

function runQueueItemDeepAudit() {
  var MODULE = 'QueueItemDeepAudit';

  console.log('=== Queue Item Deep Audit: ' + QIDA_QUEUE_ID + ' / exception ' + QIDA_EXCEPTION_ID + ' ===');
  console.log('');

  // ── PART 1: STG_PROCESSING_QUEUE row, every field ────────────
  console.log('--- PART 1: STG_PROCESSING_QUEUE row ---');
  var queueRows = DAL.readAll(Config.TABLES.STG_PROCESSING_QUEUE, { callerModule: MODULE });
  var target = null;
  for (var i = 0; i < queueRows.length; i++) {
    if (String(queueRows[i].queue_id || '') === QIDA_QUEUE_ID) { target = queueRows[i]; break; }
  }

  if (!target) {
    console.log('NOT FOUND: no STG_PROCESSING_QUEUE row with queue_id=' + QIDA_QUEUE_ID);
  } else {
    console.log('queue_id:        ' + String(target.queue_id || '(blank)'));
    console.log('form_type:       ' + String(target.form_type || '(blank)'));
    console.log('submitter_email: ' + String(target.submitter_email || '(blank)'));
    console.log('status:          ' + String(target.status || '(blank)'));
    console.log('attempt_count:   ' + String(target.attempt_count != null ? target.attempt_count : '(blank)'));
    console.log('created_at:      ' + String(target.created_at || '(blank)'));
    console.log('updated_at:      ' + String(target.updated_at || '(blank)'));
    console.log('error_message:   ' + String(target.error_message || '(blank)'));
    console.log('');
    console.log('payload_json (raw): ' + String(target.payload_json || '(blank)'));
    console.log('');
    console.log('payload_json (parsed, every key):');
    try {
      var payload = JSON.parse(target.payload_json || '{}');
      var keys = Object.keys(payload);
      if (keys.length === 0) {
        console.log('  (empty object — no keys at all)');
      } else {
        for (var k = 0; k < keys.length; k++) {
          console.log('  ' + keys[k] + ': ' + JSON.stringify(payload[keys[k]]));
        }
      }
      console.log('');
      console.log('product_code present as a key: ' + (payload.hasOwnProperty('product_code') ? 'YES' : 'NO'));
      console.log('product_code value: ' + (payload.hasOwnProperty('product_code') ? JSON.stringify(payload.product_code) : '(key absent)'));
    } catch (e) {
      console.log('  PARSE ERROR: ' + e.message);
    }
  }

  console.log('');
  console.log('--- PART 2: _SYS_EXCEPTIONS row (exception_id is this table\'s actual key) ---');
  var excRows = DAL.readAll(Config.TABLES.SYS_EXCEPTIONS, { callerModule: MODULE });
  var excTarget = null;
  for (var e2 = 0; e2 < excRows.length; e2++) {
    if (String(excRows[e2].exception_id || '') === QIDA_EXCEPTION_ID) { excTarget = excRows[e2]; break; }
  }
  if (!excTarget) {
    console.log('NOT FOUND: no _SYS_EXCEPTIONS row with exception_id=' + QIDA_EXCEPTION_ID);
  } else {
    console.log('exception_id:  ' + String(excTarget.exception_id || '(blank)'));
    console.log('timestamp:     ' + String(excTarget.timestamp || '(blank)'));
    console.log('severity:      ' + String(excTarget.severity || '(blank)'));
    console.log('error_code:    ' + String(excTarget.error_code || '(blank)'));
    console.log('module:        ' + String(excTarget.module || '(blank)'));
    console.log('actor_code:    ' + String(excTarget.actor_code || '(blank)'));
    console.log('actor_role:    ' + String(excTarget.actor_role || '(blank)'));
    console.log('execution_id:  ' + String(excTarget.execution_id || '(blank)'));
    console.log('message:       ' + String(excTarget.message || '(blank)'));
    console.log('stack_trace:');
    console.log(String(excTarget.stack_trace || '(blank)'));
    console.log('context_json:  ' + String(excTarget.context_json || '(blank)'));
  }

  console.log('');
  console.log('--- PART 3: _SYS_LOGS rows correlated via detail_json (no exception_id column exists on this table) ---');
  var logRows = DAL.readAll(Config.TABLES.SYS_LOGS, { callerModule: MODULE });
  var matchedLogs = [];
  for (var l = 0; l < logRows.length; l++) {
    var detail = String(logRows[l].detail_json || '');
    if (detail.indexOf(QIDA_EXCEPTION_ID) !== -1) matchedLogs.push(logRows[l]);
  }
  if (matchedLogs.length === 0) {
    console.log('No _SYS_LOGS rows found whose detail_json mentions exception_id ' + QIDA_EXCEPTION_ID + '.');
  } else {
    for (var m = 0; m < matchedLogs.length; m++) {
      var lr = matchedLogs[m];
      console.log('[' + (m + 1) + ']');
      console.log('  log_id:     ' + String(lr.log_id || '(blank)'));
      console.log('  timestamp:  ' + String(lr.timestamp || '(blank)'));
      console.log('  level:      ' + String(lr.level || '(blank)'));
      console.log('  module:     ' + String(lr.module || '(blank)'));
      console.log('  action:     ' + String(lr.action || '(blank)'));
      console.log('  target_id:  ' + String(lr.target_id || '(blank)'));
      console.log('  message:    ' + String(lr.message || '(blank)'));
      console.log('  detail_json:' + String(lr.detail_json || '(blank)'));
      console.log('');
    }
  }

  console.log('=== End ===');
}
