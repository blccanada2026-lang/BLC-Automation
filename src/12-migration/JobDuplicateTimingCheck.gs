// ============================================================
// JobDuplicateTimingCheck.gs — BLC Nexus T12 Diagnostic (READ-ONLY)
//
// Investigates a PM-reported duplicate job creation (Sarty, 2026-08-05):
// BLC-00891 and BLC-00892, both SBS/ROOF_TRUSS, same description
// "2608-9955 Litchfield Rev 1", both ALLOCATED to Sayan Roy. Reads the
// JOB_CREATED events for both job numbers to compare exact timestamps —
// milliseconds apart points to a client-side double-fire (e.g.
// portal_createJob() called twice for one user action); minutes/more
// apart points to a manual resubmission instead.
//
// Read-only. DAL.readAll only, no writes.
//
// HOW TO RUN (Apps Script editor, PROD project):
//   runJobDuplicateTimingCheck()
// ============================================================

function runJobDuplicateTimingCheck() {
  var scriptId = ScriptApp.getScriptId();
  console.log('=== Job duplicate timing check (read-only) ===');
  console.log('Script ID: ' + scriptId + ' — confirm which project this is ' +
              '(DEV: 1smkj0mmUqcWDDJPq... / PROD: 1HzRiDrQJ6z-BxPzk...) before trusting this output.');

  var targetJobs = ['BLC-00891', 'BLC-00892'];
  var periodId = Identifiers.generateCurrentPeriodId();
  console.log('Checking period: ' + periodId);

  var rows;
  try {
    rows = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS, { callerModule: 'MigrationReplayEngine', periodId: periodId });
  } catch (e) {
    console.log('*** Could not read FACT_JOB_EVENTS|' + periodId + ': ' + e.message + ' ***');
    return;
  }

  console.log('Total FACT_JOB_EVENTS rows this period: ' + rows.length);
  console.log('');

  var found = [];
  targetJobs.forEach(function (jn) {
    var matches = rows.filter(function (r) {
      return String(r.job_number || '') === jn && String(r.event_type || '') === 'JOB_CREATED';
    });
    console.log('--- ' + jn + ' — ' + matches.length + ' JOB_CREATED event(s) ---');
    matches.forEach(function (r) {
      console.log('  timestamp: ' + r.timestamp + '  actor_code: ' + r.actor_code +
                  '  event_id: ' + r.event_id + '  submitter/actor_role: ' + r.actor_role);
      found.push({ job_number: jn, timestamp: r.timestamp, event_id: r.event_id, actor_code: r.actor_code });
    });
  });

  if (found.length === 2) {
    var t1 = new Date(found[0].timestamp).getTime();
    var t2 = new Date(found[1].timestamp).getTime();
    var deltaMs = Math.abs(t2 - t1);
    console.log('');
    console.log('=== Delta between the two JOB_CREATED events: ' + deltaMs + ' ms (' +
                (deltaMs / 1000).toFixed(1) + ' sec) ===');
    if (deltaMs < 5000) {
      console.log('*** Sub-5-second gap — strongly suggests a technical double-fire (double-click, duplicate RPC call), not a manual resubmission. ***');
    } else if (deltaMs < 60000) {
      console.log('*** Under a minute apart — could be either a slow double-click retry or quick manual resubmission after the user saw no feedback. ***');
    } else {
      console.log('*** More than a minute apart — more consistent with a manual resubmission (user re-did the action believing the first attempt failed). ***');
    }
  } else {
    console.log('');
    console.log('*** Expected exactly 2 JOB_CREATED events total (1 per job number) — found ' + found.length + '. Investigate manually. ***');
  }
}
