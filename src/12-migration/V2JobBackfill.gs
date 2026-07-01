// ============================================================
// V2JobBackfill.gs — BLC Nexus Migration
// src/12-migration/V2JobBackfill.gs
//
// HOW TO RUN (Apps Script editor):
//   runV2JobBackfill()
//
// Creates VW_JOB_CURRENT_STATE rows for V2 jobs that were never
// migrated into V3. Idempotent — skips any job that already exists.
//
// Jobs backfilled (July 1 2026 — team leads unable to log hours):
//   2606-7985  SBS        Roof Truss   IN_PROGRESS
//   2606-8421  SBS        Roof Truss   IN_PROGRESS
//   2605-5694  SBS        Roof Truss   IN_PROGRESS
//   Q260410    NORSPAN-MB Roof Truss   IN_PROGRESS
//   Q260421    NORSPAN-MB Roof Truss   IN_PROGRESS
//   2606-8093  SBS        Roof Truss   IN_PROGRESS
//   2606-8087  SBS        Floor Truss  IN_PROGRESS
//
// Output → execution log only (no temp sheet)
// ============================================================

function runV2JobBackfill() {
  var MODULE = 'V2JobBackfill';

  var JOBS = [
    { job_number: '2606-7985', client_code: 'SBS',        job_type: 'Roof Truss',  period: '2026-06-01' },
    { job_number: '2606-8421', client_code: 'SBS',        job_type: 'Roof Truss',  period: '2026-06-01' },
    { job_number: '2605-5694', client_code: 'SBS',        job_type: 'Roof Truss',  period: '2026-05-01' },
    { job_number: 'Q260410',   client_code: 'NORSPAN-MB', job_type: 'Roof Truss',  period: '2026-04-01' },
    { job_number: 'Q260421',   client_code: 'NORSPAN-MB', job_type: 'Roof Truss',  period: '2026-04-01' },
    { job_number: '2606-8093', client_code: 'SBS',        job_type: 'Roof Truss',  period: '2026-06-01' },
    { job_number: '2606-8087', client_code: 'SBS',        job_type: 'Floor Truss', period: '2026-06-01' }
  ];

  // Build existing job_number set from VW
  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  var existing = {};
  for (var i = 0; i < vwRows.length; i++) {
    existing[String(vwRows[i].job_number || '').trim()] = true;
  }

  var now = new Date().toISOString();
  var created = 0;
  var skipped = 0;

  for (var j = 0; j < JOBS.length; j++) {
    var job = JOBS[j];

    if (existing[job.job_number]) {
      console.log('[V2JobBackfill] SKIP (already exists): ' + job.job_number);
      skipped++;
      continue;
    }

    var row = {
      job_number:          job.job_number,
      client_code:         job.client_code,
      job_type:            job.job_type,
      product_code:        '',
      quantity:            1,
      current_state:       'IN_PROGRESS',
      prev_state:          'ASSIGNED',
      allocated_to:        '',
      period_id:           job.period,
      created_at:          job.period,
      updated_at:          now,
      rework_cycle:        0,
      client_return_count: 0,
      client_job_ref:      '',
      target_date:         '',
      minor_rework_count:  '',
      major_rework_count:  '',
      qc_reviewer_code:    ''
    };

    DAL.appendRow(Config.TABLES.VW_JOB_CURRENT_STATE, row, { callerModule: MODULE });
    console.log('[V2JobBackfill] CREATED: ' + job.job_number + ' | ' + job.client_code + ' | ' + job.job_type);
    created++;
  }

  console.log('[V2JobBackfill] Done. Created: ' + created + '  Skipped: ' + skipped);
}

// ============================================================
// Diagnostic: print current VW state for all 7 backfilled jobs.
// Run from Apps Script editor: runV2BackfillAudit()
// Read-only — no writes.
// ============================================================
function runV2BackfillAudit() {
  var JOB_NUMBERS = [
    '2606-7985', '2606-8421', '2605-5694',
    'Q260410',   'Q260421',
    '2606-8093', '2606-8087'
  ];

  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: 'V2BackfillAudit' });
  var vwIndex = {};
  for (var i = 0; i < vwRows.length; i++) {
    vwIndex[String(vwRows[i].job_number || '').trim()] = vwRows[i];
  }

  console.log('=== V2 Backfill Job Audit ===');
  console.log('');
  for (var j = 0; j < JOB_NUMBERS.length; j++) {
    var jn  = JOB_NUMBERS[j];
    var row = vwIndex[jn];
    if (!row) {
      console.log('[' + (j + 1) + '] ' + jn + ' — NOT FOUND IN VW');
      continue;
    }
    console.log('[' + (j + 1) + '] job_number:      ' + jn);
    console.log('     client_code:    ' + (row.client_code     || '(blank)'));
    console.log('     client_job_ref: ' + (row.client_job_ref  || '(blank)'));
    console.log('     job_type:       ' + (row.job_type        || '(blank)'));
    console.log('     product_code:   ' + (row.product_code    || '(blank)'));
    console.log('     allocated_to:   ' + (row.allocated_to    || '(blank)'));
    console.log('     current_state:  ' + (row.current_state   || '(blank)'));
    console.log('     period_id:      ' + (row.period_id       || '(blank)'));
    console.log('     target_date:    ' + (row.target_date     || '(blank)'));
    console.log('     qc_reviewer:    ' + (row.qc_reviewer_code || '(blank)'));
    console.log('');
  }
  console.log('=== End Audit ===');
}
