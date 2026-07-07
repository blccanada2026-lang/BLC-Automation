// ============================================================
// QcSubmitDeadLetterAudit.gs — BLC Nexus Data Diagnostic
// src/12-migration/QcSubmitDeadLetterAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runQcSubmitDeadLetterAudit()
//
// Console-only deep dive on the 14 dead-lettered QC_SUBMIT items found by
// runNorspanSartyQueueAudit() (2026-06-16/17, all submitter_email=
// sarthakaespl@gmail.com). For each: queue_id, job_number, exception_id,
// full _SYS_EXCEPTIONS message + stack_trace, and the job's CURRENT
// current_state in VW_JOB_CURRENT_STATE. Ends with a grouping summary by
// distinct error message, to show whether this is one root cause or
// several, plus a flag for any job whose state looks inconsistent with
// "QC submission never completed" (i.e. anything other than IN_PROGRESS/
// MINOR_FIX, which would mean a later successful action already moved
// it forward and the dead-letter is stale/moot).
//
// Read-only — no writes to any table.
// ============================================================

var QSDA_ITEMS = [
  { queue_id: '760d4df0-9dfb-40f2-a193-8bc7d584e025', job_number: '260337F', exception_id: 'eca97738-974b-4cc8-b45b-e90306463211' },
  { queue_id: '7597060c-ffc9-40d2-921d-7fd26633d796', job_number: '260646F', exception_id: 'bfb4e7ed-e693-4153-8afc-055748432eb7' },
  { queue_id: '16fb3a23-1f3a-47f6-896a-5412c6eca2ba', job_number: '2605-6889-A_Wells Crossing Lot 00.0048_Revision', exception_id: '7b055c86-e5af-4a3e-af37-127c4660ec9b' },
  { queue_id: 'd2ec5ad2-14f4-4d50-a757-46a582fc3c1a', job_number: '260337F', exception_id: '5c99d256-02be-4000-bfde-27383339c8ea' },
  { queue_id: '00c0f6bd-3fb1-4656-b433-cfdddd099d41', job_number: '260337F', exception_id: 'efa11453-7845-470d-a480-4db290378739' },
  { queue_id: '24cd8e7d-1644-4cce-8217-aa0d04a4191f', job_number: '261114-2', exception_id: 'b3f78ebc-6db6-4f15-a47d-d5fca3ee50a7' },
  { queue_id: '9a5a1d2a-eb10-4b27-b2d4-fb94b355cfd6', job_number: '2603-3646-E_Huntsville Reserve Lot 207', exception_id: 'c7e92af0-dbc8-47d7-be95-d624c80ff344' },
  { queue_id: 'adf01232-00ac-4d44-a0dc-00fee7f1ff9e', job_number: '2603-3646-E_Huntsville Reserve Lot 207', exception_id: 'b170bd37-b01c-415b-b57c-793a5acacbce' },
  { queue_id: '397dfa21-c1d5-44fb-97b3-a8a11ab845f7', job_number: '2603-3646-F_Kayfield Farms Lot 93', exception_id: 'f2dd9afd-9300-4aea-9283-3d3ca51cb499' },
  { queue_id: '70c1112c-b939-4a5c-aed8-244d4bc0f5a4', job_number: '2603-3646-G_Kayfield Farms Lot 68', exception_id: 'df8a20a3-4e47-448f-b5e0-331f9f20204d' },
  { queue_id: '7c1f6a70-3c6c-40f6-b1bd-23748f86fa44', job_number: "2605-6083-A_Benjamin's Grove Lot 00.0084", exception_id: 'd8b562bc-6b2e-4276-b3e3-10d96f139cde' },
  { queue_id: '001404e9-9a37-4215-9374-6f454e0f91d4', job_number: '2605-6165-A_The Wilds Lot 00.0014', exception_id: '42b8c2b9-ef37-462d-92bd-dae60d1fc69b' },
  { queue_id: '00326c26-8093-4726-b902-85a5b369af11', job_number: '2605-6165-A_The Wilds Lot 00.0014', exception_id: 'df06ca03-ea64-4ce9-b374-5a9fd75dd764' },
  { queue_id: '5bf2fab9-0f86-4286-933e-631fffa58e42', job_number: '2605-6889-A_Wells Crossing Lot 00.0048_Revision', exception_id: '4d065b32-a365-49a1-9af9-1b8cb567a882' }
];

function runQcSubmitDeadLetterAudit() {
  var MODULE = 'QcSubmitDeadLetterAudit';

  console.log('=== QC_SUBMIT Dead Letter Deep Audit — 14 items, 2026-06-16/17 ===');
  console.log('');

  var excRows = DAL.readAll(Config.TABLES.SYS_EXCEPTIONS, { callerModule: MODULE });
  var excById = {};
  for (var e = 0; e < excRows.length; e++) {
    excById[String(excRows[e].exception_id || '')] = excRows[e];
  }

  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  var vwByJob = {};
  for (var v = 0; v < vwRows.length; v++) {
    vwByJob[String(vwRows[v].job_number || '')] = vwRows[v];
  }

  var messageGroups = {}; // message -> [job_number, ...]
  var stateGroups    = {}; // current_state (or NOT_FOUND) -> [job_number, ...]

  for (var i = 0; i < QSDA_ITEMS.length; i++) {
    var item = QSDA_ITEMS[i];
    console.log('[' + (i + 1) + ']');
    console.log('  queue_id:     ' + item.queue_id);
    console.log('  job_number:   ' + item.job_number);
    console.log('  exception_id: ' + item.exception_id);

    var exc = excById[item.exception_id];
    var msg = '(exception_id not found in _SYS_EXCEPTIONS)';
    if (exc) {
      msg = String(exc.message || '(blank message)');
      console.log('  error_code:   ' + String(exc.error_code || '(blank)'));
      console.log('  message:      ' + msg);
      console.log('  stack_trace:');
      console.log(String(exc.stack_trace || '(blank)'));
    } else {
      console.log('  message:      ' + msg);
    }

    var vw = vwByJob[item.job_number];
    var state = vw ? String(vw.current_state || '(blank)') : 'NOT FOUND IN VW_JOB_CURRENT_STATE';
    console.log('  current_state: ' + state);

    if (!messageGroups[msg]) messageGroups[msg] = [];
    messageGroups[msg].push(item.job_number);

    if (!stateGroups[state]) stateGroups[state] = [];
    stateGroups[state].push(item.job_number);

    console.log('');
  }

  console.log('--- SUMMARY: distinct error messages (' + Object.keys(messageGroups).length + ' distinct) ---');
  for (var msgKey in messageGroups) {
    console.log('  [' + messageGroups[msgKey].length + 'x] ' + msgKey);
    console.log('       jobs: ' + messageGroups[msgKey].join(', '));
  }

  console.log('');
  console.log('--- SUMMARY: current_state distribution ---');
  for (var stateKey in stateGroups) {
    console.log('  ' + stateKey + ': ' + stateGroups[stateKey].length + ' job(s) — ' + stateGroups[stateKey].join(', '));
  }

  console.log('');
  console.log('=== End ===');
}
