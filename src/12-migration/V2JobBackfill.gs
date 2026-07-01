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
// State reset for 5 of the 7 backfilled jobs.
// Run from Apps Script editor: runV2BackfillStateReset()
//
// What this does (in order):
//   1. Logs pre-flight VW state for each of the 5 jobs
//   2. VOIDs any IN_PROGRESS rows — these are the old-portal duplicates.
//      VOID ≠ delete. Rows remain in VW but loadJobs_() filters them out.
//   3. Flips each COMPLETED_BILLABLE row → IN_PROGRESS and sets allocated_to.
//   4. Logs post-flight VW state to confirm.
//
// Idempotent: VOID step matches 0 rows if no IN_PROGRESS exists (no-op).
//             Flip step matches 0 rows if already IN_PROGRESS (no-op).
//
// Assignments:
//   2606-7985  SVN  (Savvy Nath — QC)
//   2606-8093  BCH  (Bharath)
//   2606-8087  BCH  (Bharath)
//   Q260410    RKG  (Ravikumar)
//   Q260421    RKG  (Ravikumar)
// ============================================================

function runV2BackfillStateReset() {
  var MODULE = 'V2BackfillStateReset';

  var RESETS = [
    { job_number: '2606-7985', allocated_to: 'SVN' },
    { job_number: '2606-8093', allocated_to: 'BCH' },
    { job_number: '2606-8087', allocated_to: 'BCH' },
    { job_number: 'Q260410',   allocated_to: 'RKG' },
    { job_number: 'Q260421',   allocated_to: 'RKG' }
  ];

  var now = new Date().toISOString();

  function groupByJobNumber_(rows) {
    var g = {};
    for (var i = 0; i < rows.length; i++) {
      var jn = String(rows[i].job_number || '').trim();
      if (!g[jn]) g[jn] = [];
      g[jn].push(rows[i]);
    }
    return g;
  }

  function logJobRows_(label, grouped) {
    console.log('[V2BackfillStateReset] === ' + label + ' ===');
    for (var r = 0; r < RESETS.length; r++) {
      var jn   = RESETS[r].job_number;
      var rows = grouped[jn] || [];
      console.log('[V2BackfillStateReset] ' + jn + ': ' + rows.length + ' row(s)');
      for (var m = 0; m < rows.length; m++) {
        console.log('   [' + (m + 1) + '] current_state=' + (rows[m].current_state || '(blank)') +
                    '  allocated_to=' + (rows[m].allocated_to || '(blank)'));
      }
    }
  }

  // ── Pre-flight ───────────────────────────────────────────────
  var vwBefore = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  logJobRows_('PRE-FLIGHT STATE', groupByJobNumber_(vwBefore));

  // ── Step 1: VOID IN_PROGRESS rows (old-portal duplicates) ───
  var voidTotal = 0;
  for (var v = 0; v < RESETS.length; v++) {
    var jn = RESETS[v].job_number;
    var res = DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jn, current_state: 'IN_PROGRESS' },
      { current_state: 'VOIDED', updated_at: now },
      { callerModule: MODULE }
    );
    if (res.updated > 0) {
      console.log('[V2BackfillStateReset] VOIDED ' + res.updated + ' IN_PROGRESS row(s) for ' + jn +
                  ' — row(s) hidden from portal, NOT deleted.');
      voidTotal += res.updated;
    } else {
      console.log('[V2BackfillStateReset] VOID: no IN_PROGRESS rows found for ' + jn + ' (no-op).');
    }
  }

  // ── Step 2: Flip COMPLETED_BILLABLE → IN_PROGRESS ───────────
  var flipTotal = 0;
  for (var f = 0; f < RESETS.length; f++) {
    var jn       = RESETS[f].job_number;
    var assignee = RESETS[f].allocated_to;
    var res = DAL.updateWhere(
      Config.TABLES.VW_JOB_CURRENT_STATE,
      { job_number: jn, current_state: 'COMPLETED_BILLABLE' },
      { current_state: 'IN_PROGRESS', allocated_to: assignee, updated_at: now },
      { callerModule: MODULE }
    );
    if (res.updated > 0) {
      console.log('[V2BackfillStateReset] FLIPPED ' + jn +
                  ' COMPLETED_BILLABLE → IN_PROGRESS, allocated_to=' + assignee);
      flipTotal++;
    } else {
      console.log('[V2BackfillStateReset] WARNING: no COMPLETED_BILLABLE row found for ' + jn +
                  ' — flip skipped. Check VW manually.');
    }
  }

  // ── Post-flight ──────────────────────────────────────────────
  var vwAfter = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  logJobRows_('POST-FLIGHT STATE', groupByJobNumber_(vwAfter));

  console.log('[V2BackfillStateReset] Done. Voided: ' + voidTotal + '  Flipped: ' + flipTotal);
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
