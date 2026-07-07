// ============================================================
// DeadLetterQueueAudit.gs — BLC Nexus Data Diagnostic
// src/12-migration/DeadLetterQueueAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runDeadLetterQueueAudit()
//
// Console-only dump of:
//   Section 1 — STG_PROCESSING_QUEUE items with status=DEAD_LETTER or
//               attempt_count >= Config.LIMITS.deadLetterAfterAttempts,
//               timestamped in the last 48 hours.
//   Section 2 — STG_PROCESSING_QUEUE items currently PENDING or
//               PROCESSING, flagged if older than ~15 min (5x the
//               3-min queue trigger interval — possibly stuck).
//
// NOTE ON created_at: PortalData.writeQueueItem() (the live portal
// submission path — portal_submitAction) writes a field called
// "submitted_at", but the actual STG_PROCESSING_QUEUE header column is
// "created_at" (confirmed in SetupScript.gs). DAL maps by header name,
// so "submitted_at" is silently dropped and created_at is written blank
// for every portal-submitted queue item. IntakeService.gs (used by test
// harnesses and non-portal submission paths) writes created_at
// correctly. This audit falls back to updated_at when created_at is
// blank and flags the source explicitly per row — it does NOT fix the
// underlying field-name bug in PortalData.gs.
//
// Read-only — no writes to any table.
// ============================================================

/** Emails/patterns that look like test or dev traffic, not real staff. */
var DLQ_TEST_EMAIL_HINTS_ = [
  'designer@blclotus.com', 'qc@blclotus.com', 'nobody@notinrbac.com',
  'rajeshnair34@gmail.com', 'rajnaircanada@gmail.com', 'nairscanada@gmail.com',
  'testclient@example.com', 'testpm@blclotus.com', 'tlmember@blclotus.com',
  'wlcdesigner@blclotus.com'
];

function dlqLooksLikeTest_(submitterEmail, payloadJson) {
  var email = String(submitterEmail || '').toLowerCase();
  for (var i = 0; i < DLQ_TEST_EMAIL_HINTS_.length; i++) {
    if (email === DLQ_TEST_EMAIL_HINTS_[i]) return true;
  }
  var p = String(payloadJson || '');
  if (/TEST-|BLC-99999/i.test(p)) return true;
  return false;
}

function dlqPayloadSummary_(payloadJson) {
  var out = {};
  try {
    var p = JSON.parse(payloadJson || '{}');
    if (p.job_number)      out.job_number  = p.job_number;
    if (p.new_job_number)  out.new_job_number = p.new_job_number;
    if (p.client_code)     out.client_code = p.client_code;
    if (p.actor_code)      out.actor_code  = p.actor_code;
    if (p.hours != null)   out.hours       = p.hours;
    if (p.work_date)       out.work_date   = p.work_date;
  } catch (e) {
    out._parse_error = 'payload_json did not parse: ' + e.message;
  }
  return out;
}

function dlqFormatRow_(r) {
  var createdAt   = r.created_at;
  var usedFallback = false;
  if (!createdAt) { createdAt = r.updated_at; usedFallback = true; }
  var ts = createdAt ? new Date(createdAt) : null;
  var tsStr = (ts && !isNaN(ts.getTime())) ? ts.toISOString() : '(blank/unparseable)';

  console.log('  queue_id:        ' + String(r.queue_id || '(blank)'));
  console.log('  form_type:       ' + String(r.form_type || '(blank)'));
  console.log('  created_at:      ' + tsStr + (usedFallback ? '  [fallback: created_at was blank, used updated_at]' : ''));
  console.log('  status:          ' + String(r.status || '(blank)'));
  console.log('  attempt_count:   ' + String(r.attempt_count != null ? r.attempt_count : '(blank)'));
  console.log('  submitter_email: ' + String(r.submitter_email || '(blank)'));
  console.log('  error_message:   ' + String(r.error_message || '(blank)'));
  console.log('  payload summary: ' + JSON.stringify(dlqPayloadSummary_(r.payload_json)));
  console.log('  looks like test/dev traffic: ' + (dlqLooksLikeTest_(r.submitter_email, r.payload_json) ? 'YES' : 'no'));
}

/**
 * Prints dead-lettered/max-attempt queue items from the last 48h, plus
 * currently PENDING/PROCESSING items that may be stuck. Read-only.
 */
function runDeadLetterQueueAudit() {
  var MODULE       = 'DeadLetterQueueAudit';
  var MAX_ATTEMPTS = Config.LIMITS.deadLetterAfterAttempts || 3;
  var CUTOFF_MS    = 48 * 60 * 60 * 1000;
  var STUCK_MS     = 15 * 60 * 1000; // 5x the 3-min queue trigger interval
  var now          = new Date();

  var rows = DAL.readAll(Config.TABLES.STG_PROCESSING_QUEUE, { callerModule: MODULE });

  console.log('=== Dead Letter Queue Investigation ===');
  console.log('Scanned ' + rows.length + ' total STG_PROCESSING_QUEUE row(s). MAX_ATTEMPTS=' + MAX_ATTEMPTS);
  console.log('');

  // ── SECTION 1: DEAD_LETTER or max-attempts, last 48h ─────────
  var deadItems = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var status   = String(r.status || '');
    var attempts = parseInt(r.attempt_count, 10) || 0;
    var isDead   = status === 'DEAD_LETTER' || attempts >= MAX_ATTEMPTS;
    if (!isDead) continue;

    var tsRaw = r.created_at || r.updated_at;
    var ts    = tsRaw ? new Date(tsRaw) : null;
    var within48h = true;
    if (ts && !isNaN(ts.getTime())) within48h = (now - ts) <= CUTOFF_MS;
    // No usable timestamp at all — include rather than silently drop it.
    if (within48h) deadItems.push(r);
  }

  console.log('--- SECTION 1: DEAD_LETTER / max-attempts items, last 48h (' + deadItems.length + ') ---');
  console.log('');
  for (var d = 0; d < deadItems.length; d++) {
    console.log('[' + (d + 1) + ']');
    dlqFormatRow_(deadItems[d]);
    console.log('');
  }

  // ── SECTION 2: currently PENDING / PROCESSING ────────────────
  var pending = [];
  for (var j = 0; j < rows.length; j++) {
    var status2 = String(rows[j].status || '');
    if (status2 === 'PENDING' || status2 === 'PROCESSING') pending.push(rows[j]);
  }

  console.log('--- SECTION 2: currently PENDING / PROCESSING (' + pending.length + ') ---');
  console.log('(queue trigger runs ~every 3 min — flagged POSSIBLY STUCK if older than 15 min)');
  console.log('');
  for (var k = 0; k < pending.length; k++) {
    var pr = pending[k];
    var pTsRaw = pr.updated_at || pr.created_at;
    var pTs    = pTsRaw ? new Date(pTsRaw) : null;
    var ageMin = (pTs && !isNaN(pTs.getTime())) ? Math.round((now - pTs) / 60000) : null;
    var stuckFlag = (ageMin !== null && (now - pTs) > STUCK_MS) ? '  ⚠ POSSIBLY STUCK (' + ageMin + ' min since last update)' : '';
    console.log('[' + (k + 1) + ']' + stuckFlag);
    dlqFormatRow_(pr);
    console.log('');
  }

  console.log('=== End — ' + deadItems.length + ' dead-lettered/maxed, ' + pending.length + ' pending/processing ===');
}
