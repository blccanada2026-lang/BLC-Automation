// ============================================================
// NorspanJobOriginAudit.gs — BLC Nexus Data Diagnostic
// src/12-migration/NorspanJobOriginAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runNorspanJobOriginAudit()
//
// Prints every FACT_JOB_EVENTS row (all event types, all partitions)
// for a fixed list of NORSPAN-client jobs (BLC-00406, BLC-00547 by
// default) so their origin (actor_code, actor_role, client_code,
// notes) can be confirmed. Read-only — no writes to any table.
// ============================================================

var NJOA_TARGET_JOBS = ['BLC-00406', 'BLC-00547'];

/** Discovers all FACT_JOB_EVENTS|YYYY-MM partition tab names. */
function njoaDiscoverPartitions_() {
  var sheets  = DAL.listSheets();
  var prefix  = Config.TABLES.FACT_JOB_EVENTS + '|';
  var periods = [];
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i];
    if (name.indexOf(prefix) === 0) {
      var period = name.substring(prefix.length);
      if (/^\d{4}-\d{2}$/.test(period)) periods.push(period);
    }
  }
  periods.sort();
  return periods;
}

/**
 * Prints every FACT_JOB_EVENTS row for NJOA_TARGET_JOBS, across all
 * partitions, sorted by timestamp ascending within each job. Read-only.
 */
function runNorspanJobOriginAudit() {
  var MODULE = 'NorspanJobOriginAudit';

  var partitions = njoaDiscoverPartitions_();
  console.log('=== NORSPAN job origin audit ===');
  console.log('Target jobs: ' + NJOA_TARGET_JOBS.join(', '));
  console.log('Partitions scanned: ' + partitions.join(', '));
  console.log('');

  var byJob = {}; // job_number -> [rows]
  for (var j = 0; j < NJOA_TARGET_JOBS.length; j++) byJob[NJOA_TARGET_JOBS[j]] = [];

  for (var p = 0; p < partitions.length; p++) {
    var pid = partitions[p];
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS, { callerModule: MODULE, periodId: pid });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') continue;
      throw e;
    }
    for (var i = 0; i < rows.length; i++) {
      var jn = String(rows[i].job_number || '');
      if (byJob.hasOwnProperty(jn)) byJob[jn].push(rows[i]);
    }
  }

  for (var k = 0; k < NJOA_TARGET_JOBS.length; k++) {
    var jobNumber = NJOA_TARGET_JOBS[k];
    var events    = byJob[jobNumber];

    events.sort(function(a, b) {
      var ta = new Date(a.timestamp), tb = new Date(b.timestamp);
      if (!isNaN(ta) && !isNaN(tb)) return ta - tb;
      return String(a.timestamp) < String(b.timestamp) ? -1 : 1;
    });

    console.log('--- ' + jobNumber + ' (' + events.length + ' event(s)) ---');
    for (var e = 0; e < events.length; e++) {
      var r = events[e];
      console.log('  event_type:      ' + String(r.event_type      || '(blank)'));
      console.log('  timestamp:       ' + String(r.timestamp       || '(blank)'));
      console.log('  actor_code:      ' + String(r.actor_code      || '(blank)'));
      console.log('  actor_role:      ' + String(r.actor_role      || '(blank)'));
      console.log('  client_code:     ' + String(r.client_code     || '(blank)'));
      console.log('  job_type:        ' + String(r.job_type        || '(blank)'));
      console.log('  product_code:    ' + String(r.product_code    || '(blank)'));
      console.log('  client_job_ref:  ' + String(r.client_job_ref  || '(blank)'));
      console.log('  notes:           ' + String(r.notes           || '(blank)'));
      console.log('  idempotency_key: ' + String(r.idempotency_key || '(blank)'));
      console.log('  payload_json:    ' + String(r.payload_json    || '(blank)'));
      console.log('');
    }
    if (events.length === 0) {
      console.log('  No FACT_JOB_EVENTS rows found for ' + jobNumber + ' in any scanned partition.');
      console.log('');
    }
  }

  console.log('=== End ===');
}
