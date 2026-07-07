// ============================================================
// NorspanSartyQueueAudit.gs — BLC Nexus Data Diagnostic
// src/12-migration/NorspanSartyQueueAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runNorspanSartyQueueAudit()
//
// Console-only, all-time (no 48h window) dump of every
// STG_PROCESSING_QUEUE row with status FAILED or DEAD_LETTER where
// EITHER payload_json.client_code == NORSPAN OR
// submitter_email == sarthakaespl@gmail.com.
//
// Read-only — no writes to any table.
// ============================================================

var NSQA_TARGET_CLIENT = 'NORSPAN';
var NSQA_TARGET_EMAIL  = 'sarthakaespl@gmail.com';

function nsqaPayloadSummary_(payloadJson) {
  var out = {};
  try {
    var p = JSON.parse(payloadJson || '{}');
    if (p.job_number)     out.job_number     = p.job_number;
    if (p.new_job_number) out.new_job_number = p.new_job_number;
    if (p.client_code)    out.client_code    = p.client_code;
    if (p.actor_code)     out.actor_code     = p.actor_code;
    if (p.product_code !== undefined) out.product_code = p.product_code;
    if (p.hours != null)  out.hours          = p.hours;
    if (p.work_date)      out.work_date      = p.work_date;
  } catch (e) {
    out._parse_error = 'payload_json did not parse: ' + e.message;
  }
  return out;
}

function nsqaMatches_(row) {
  var status = String(row.status || '');
  if (status !== 'FAILED' && status !== 'DEAD_LETTER') return false;

  var email = String(row.submitter_email || '').trim().toLowerCase();
  if (email === NSQA_TARGET_EMAIL.toLowerCase()) return true;

  try {
    var p = JSON.parse(row.payload_json || '{}');
    if (String(p.client_code || '').trim().toUpperCase() === NSQA_TARGET_CLIENT) return true;
  } catch (e) { /* unparseable payload — client_code match not possible, email already checked */ }

  return false;
}

/**
 * Prints every FAILED/DEAD_LETTER STG_PROCESSING_QUEUE row, all time,
 * matching client_code=NORSPAN or submitter_email=sarthakaespl@gmail.com.
 * Read-only.
 */
function runNorspanSartyQueueAudit() {
  var MODULE = 'NorspanSartyQueueAudit';

  var rows = DAL.readAll(Config.TABLES.STG_PROCESSING_QUEUE, { callerModule: MODULE });

  console.log('=== NORSPAN / Sarty — FAILED + DEAD_LETTER items, all time ===');
  console.log('Scanned ' + rows.length + ' total STG_PROCESSING_QUEUE row(s).');
  console.log('Filter: status in {FAILED, DEAD_LETTER} AND (client_code=NORSPAN OR submitter_email=' + NSQA_TARGET_EMAIL + ')');
  console.log('');

  var matched = [];
  for (var i = 0; i < rows.length; i++) {
    if (nsqaMatches_(rows[i])) matched.push(rows[i]);
  }

  // Sort by created_at ascending where parseable, unparseable/blank last
  matched.sort(function(a, b) {
    var da = a.created_at ? new Date(a.created_at) : null;
    var db = b.created_at ? new Date(b.created_at) : null;
    var va = (da && !isNaN(da.getTime())) ? da.getTime() : Infinity;
    var vb = (db && !isNaN(db.getTime())) ? db.getTime() : Infinity;
    return va - vb;
  });

  console.log('Matched ' + matched.length + ' item(s):');
  console.log('');

  for (var j = 0; j < matched.length; j++) {
    var r = matched[j];
    console.log('[' + (j + 1) + ']');
    console.log('  queue_id:        ' + String(r.queue_id || '(blank)'));
    console.log('  form_type:       ' + String(r.form_type || '(blank)'));
    console.log('  created_at:      ' + String(r.created_at || '(blank — see PortalData.writeQueueItem field-name bug noted in prior audits)'));
    console.log('  updated_at:      ' + String(r.updated_at || '(blank)'));
    console.log('  status:          ' + String(r.status || '(blank)'));
    console.log('  attempt_count:   ' + String(r.attempt_count != null ? r.attempt_count : '(blank)'));
    console.log('  submitter_email: ' + String(r.submitter_email || '(blank)'));
    console.log('  error_message:   ' + String(r.error_message || '(blank)'));
    console.log('  payload summary: ' + JSON.stringify(nsqaPayloadSummary_(r.payload_json)));
    console.log('');
  }

  console.log('=== End — ' + matched.length + ' matching item(s) ===');
}
