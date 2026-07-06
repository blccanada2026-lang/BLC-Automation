// ============================================================
// V2StateCorrection.gs — BLC Nexus Migration
// src/12-migration/V2StateCorrection.gs
//
// Corrects VW_JOB_CURRENT_STATE for 7 V2 backfilled jobs and
// writes a JOB_STATE_CORRECTED audit event to FACT_JOB_EVENTS
// for each change.
//
// STEP 1 (read-only):  runV2StateCorrectionDryRun()
// STEP 2 (writes):     runV2StateCorrectionApply()   ← only after confirming dry run
//
// State flips (COMPLETED_BILLABLE → IN_PROGRESS, no other fields touched):
//   2606-7985, 2606-8093, 2606-8087, Q260410, Q260421
//
// Assignment only (allocated_to set, state untouched):
//   2606-8421 → JYS (Joy Sarkar)
//   2605-5694 → BIT (Bittu Dalui)
// ============================================================

var V2StateCorrection = (function () {

  var MODULE = 'V2StateCorrection';

  // ── Change manifest ─────────────────────────────────────────
  var STATE_FLIPS = [
    '2606-7985',
    '2606-8093',
    '2606-8087',
    'Q260410',
    'Q260421'
  ];

  var ASSIGNMENTS = [
    { job_number: '2606-8421', allocated_to: 'JYS' },
    { job_number: '2605-5694', allocated_to: 'BIT' }
  ];

  var ALL_JOB_NUMBERS = STATE_FLIPS.concat(ASSIGNMENTS.map(function (a) { return a.job_number; }));

  // ── Read current VW rows for the 7 jobs ────────────────────
  function readJobIndex_() {
    var all = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    var idx = {};
    for (var i = 0; i < all.length; i++) {
      var jn = String(all[i].job_number || '').trim();
      if (!idx[jn]) idx[jn] = [];
      idx[jn].push(all[i]);
    }
    return idx;
  }

  // ── Build a JOB_STATE_CORRECTED event row ──────────────────
  function buildEvent_(vwRow, notes, periodId) {
    return {
      event_id:        Identifiers.generateId(),
      job_number:      vwRow.job_number      || '',
      period_id:       periodId,
      event_type:      Constants.EVENT_TYPES.JOB_STATE_CORRECTED,
      timestamp:       new Date().toISOString(),
      actor_code:      'SYSTEM_CORRECTION',
      actor_role:      'ADMIN',
      client_code:     vwRow.client_code     || '',
      job_type:        vwRow.job_type        || '',
      product_code:    vwRow.product_code    || '',
      quantity:        vwRow.quantity        || 0,
      client_job_ref:  vwRow.client_job_ref  || '',
      target_date:     vwRow.target_date     || '',
      notes:           notes,
      idempotency_key: 'V2CORR-' + (vwRow.job_number || ''),
      payload_json:    ''
    };
  }

  // ============================================================
  // DRY RUN — read-only. Logs every planned change; no writes.
  // ============================================================
  function runDryRun() {
    var idx = readJobIndex_();

    console.log('[V2StateCorrectionDryRun] === PLANNED CHANGES ===');
    console.log('');

    for (var s = 0; s < STATE_FLIPS.length; s++) {
      var jn   = STATE_FLIPS[s];
      var rows = idx[jn] || [];
      if (rows.length === 0) {
        console.log('[V2StateCorrectionDryRun] STATE FLIP: ' + jn + ' — NOT FOUND IN VW. Will be skipped.');
        continue;
      }
      var active = rows[0];
      console.log('[V2StateCorrectionDryRun] STATE FLIP:  ' + jn +
                  ' | current_state: ' + (active.current_state || '(blank)') +
                  ' → IN_PROGRESS' +
                  ' | allocated_to stays: ' + (active.allocated_to || '(blank)') +
                  ' | FACT event: JOB_STATE_CORRECTED');
    }

    for (var a = 0; a < ASSIGNMENTS.length; a++) {
      var jn       = ASSIGNMENTS[a].job_number;
      var assignee = ASSIGNMENTS[a].allocated_to;
      var rows     = idx[jn] || [];
      if (rows.length === 0) {
        console.log('[V2StateCorrectionDryRun] ASSIGN:      ' + jn + ' — NOT FOUND IN VW. Will be skipped.');
        continue;
      }
      var active = rows[0];
      console.log('[V2StateCorrectionDryRun] ASSIGN:      ' + jn +
                  ' | allocated_to: ' + (active.allocated_to || '(blank)') +
                  ' → ' + assignee +
                  ' | state stays: ' + (active.current_state || '(blank)') +
                  ' | FACT event: JOB_STATE_CORRECTED');
    }

    console.log('');
    console.log('[V2StateCorrectionDryRun] Total writes if applied: ' +
                ALL_JOB_NUMBERS.length + ' VW updates + ' +
                ALL_JOB_NUMBERS.length + ' FACT_JOB_EVENTS appends.');
    console.log('[V2StateCorrectionDryRun] DRY RUN COMPLETE — no changes written.');
    console.log('[V2StateCorrectionDryRun] Run runV2StateCorrectionApply() to apply.');
  }

  // ============================================================
  // APPLY — writes VW updates and FACT_JOB_EVENTS audit events.
  // ============================================================
  function runApply() {
    var idx       = readJobIndex_();
    var now       = new Date().toISOString();
    var periodId  = Identifiers.generateCurrentPeriodId();
    var vwUpdated = 0;
    var eventsWritten = 0;
    var events    = [];

    // ── Step 1: State flips ────────────────────────────────────
    for (var s = 0; s < STATE_FLIPS.length; s++) {
      var jn   = STATE_FLIPS[s];
      var rows = idx[jn] || [];
      if (rows.length === 0) {
        console.log('[V2StateCorrectionApply] SKIP STATE FLIP: ' + jn + ' — not found in VW.');
        continue;
      }

      var res = DAL.updateWhere(
        Config.TABLES.VW_JOB_CURRENT_STATE,
        { job_number: jn, current_state: 'COMPLETED_BILLABLE' },
        { current_state: 'IN_PROGRESS', updated_at: now },
        { callerModule: MODULE }
      );

      if (res.updated > 0) {
        console.log('[V2StateCorrectionApply] STATE FLIP: ' + jn + ' COMPLETED_BILLABLE → IN_PROGRESS');
        vwUpdated++;
        events.push(buildEvent_(rows[0],
          'V2 backfill correction: state flipped COMPLETED_BILLABLE → IN_PROGRESS ' +
          'per Sarty (manager) request 2026-07-06. Job was unreachable by team.',
          periodId));
      } else {
        console.log('[V2StateCorrectionApply] WARNING: ' + jn +
                    ' — no COMPLETED_BILLABLE row matched. Current state: ' +
                    (rows[0].current_state || '(blank)') + '. Skipped.');
      }
    }

    // ── Step 2: Assignment fixes ───────────────────────────────
    for (var a = 0; a < ASSIGNMENTS.length; a++) {
      var jn       = ASSIGNMENTS[a].job_number;
      var assignee = ASSIGNMENTS[a].allocated_to;
      var rows     = idx[jn] || [];
      if (rows.length === 0) {
        console.log('[V2StateCorrectionApply] SKIP ASSIGN: ' + jn + ' — not found in VW.');
        continue;
      }

      var res = DAL.updateWhere(
        Config.TABLES.VW_JOB_CURRENT_STATE,
        { job_number: jn },
        { allocated_to: assignee, updated_at: now },
        { callerModule: MODULE }
      );

      if (res.updated > 0) {
        console.log('[V2StateCorrectionApply] ASSIGN: ' + jn + ' allocated_to → ' + assignee);
        vwUpdated++;
        events.push(buildEvent_(rows[0],
          'V2 backfill correction: allocated_to set to ' + assignee +
          ' per Raj assignment 2026-07-06. Was blank since V2 backfill.',
          periodId));
      } else {
        console.log('[V2StateCorrectionApply] WARNING: ' + jn + ' — assignment update matched 0 rows. Skipped.');
      }
    }

    // ── Step 3: Write FACT_JOB_EVENTS audit trail ──────────────
    if (events.length > 0) {
      DAL.ensurePartition(Config.TABLES.FACT_JOB_EVENTS, periodId, MODULE);
      for (var e = 0; e < events.length; e++) {
        DAL.appendRow(
          Config.TABLES.FACT_JOB_EVENTS,
          events[e],
          { callerModule: MODULE, periodId: periodId }
        );
        eventsWritten++;
      }
    }

    console.log('[V2StateCorrectionApply] Done. VW updates: ' + vwUpdated +
                '  FACT events written: ' + eventsWritten);
  }

  return {
    runDryRun: runDryRun,
    runApply:  runApply
  };

}());

// ── Top-level entry points callable from Apps Script editor ──

function runV2StateCorrectionDryRun() {
  V2StateCorrection.runDryRun();
}

function runV2StateCorrectionApply() {
  V2StateCorrection.runApply();
}
