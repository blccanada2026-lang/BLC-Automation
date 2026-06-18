// ============================================================
// MigratedQCApprovalFixer.gs — BLC Nexus T12 Migration
// src/12-migration/MigratedQCApprovalFixer.gs
//
// ONE-TIME REPAIR: Jobs imported from Stacey V2 with status
// "Submitted For QC" or "In QC" landed in QC_REVIEW state in V3.
// Sarty reviewed all of these in V2; the approval was never
// written to FACT_QC_EVENTS in V3.
//
// This script:
//   1. Reads VW_JOB_CURRENT_STATE — finds all QC_REVIEW jobs
//   2. Cross-references FACT_JOB_EVENTS — confirms each job
//      was imported via StaceyJobImporter (STACEY_JOB| key prefix)
//   3. Writes a QC_APPROVED event to FACT_QC_EVENTS for each
//   4. Updates VW_JOB_CURRENT_STATE → COMPLETED_BILLABLE
//
// Safe to re-run — idempotency key MIGRATED_QC_APPROVE|{job_number}
// prevents double-processing.
//
// USAGE:
//   runMigratedQCApprovalFixer()        → dry run (default): lists jobs, no writes
//   runMigratedQCApprovalFixer(false)   → live run: writes events and updates VW
// ============================================================

var MigratedQCApprovalFixer = (function () {

  var MODULE = 'MigratedQCApprovalFixer';

  // Partitions to scan for StaceyJobImporter evidence.
  // Covers all months when the V2→V3 migration ran.
  var MIGRATION_PARTITIONS = [
    '2025-10', '2025-11', '2025-12',
    '2026-01', '2026-02', '2026-03',
    '2026-04', '2026-05', '2026-06'
  ];

  // ── Step 1: collect all QC_REVIEW jobs from VW ─────────────
  function getQcReviewJobs_() {
    var all = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    return all.filter(function (row) {
      return String(row.current_state || '').trim() === Config.STATES.QC_REVIEW;
    });
  }

  // ── Step 2: build set of job_numbers that were migrated ─────
  // A job is migrated if any FACT_JOB_EVENTS row for it has an
  // idempotency_key starting with 'STACEY_JOB|'.
  function getMigratedJobNumbers_() {
    var migrated = {};
    for (var p = 0; p < MIGRATION_PARTITIONS.length; p++) {
      var partition = MIGRATION_PARTITIONS[p];
      try {
        var rows = DAL.readAll(
          Config.TABLES.FACT_JOB_EVENTS,
          { callerModule: MODULE, periodId: partition }
        );
        for (var i = 0; i < rows.length; i++) {
          var ikey = String(rows[i].idempotency_key || '');
          if (ikey.indexOf('STACEY_JOB|') === 0) {
            migrated[String(rows[i].job_number || '').trim()] = true;
          }
        }
      } catch (e) {
        // Partition does not exist — skip
      }
    }
    return migrated;
  }

  // ── Core repair ─────────────────────────────────────────────
  function run(dryRun) {
    if (dryRun === undefined || dryRun === null) dryRun = true;

    Logger.info('MIGRATED_QC_FIX_START', { module: MODULE, dry_run: dryRun });

    var actor = RBAC.resolveActor('sarthakaespl@gmail.com');  // SGO — PM who performed the V2 reviews

    var qcReviewJobs = getQcReviewJobs_();
    var migratedNums = getMigratedJobNumbers_();

    // Intersection: migrated jobs currently stuck in QC_REVIEW
    var toFix = qcReviewJobs.filter(function (job) {
      return migratedNums[String(job.job_number || '').trim()];
    });

    Logger.info('MIGRATED_QC_FIX_SCOPE', {
      module:             MODULE,
      all_qc_review:      qcReviewJobs.length,
      migrated_in_review: toFix.length,
      dry_run:            dryRun
    });

    if (dryRun) {
      console.log('=== DRY RUN — no writes ===');
      console.log('Total QC_REVIEW jobs in VW:    ' + qcReviewJobs.length);
      console.log('Migrated (would be approved):  ' + toFix.length);
      toFix.forEach(function (job) {
        console.log('  ' + job.job_number +
          ' | client: '       + (job.client_code   || '?') +
          ' | assigned_to: '  + (job.allocated_to  || '?') +
          ' | reviewer: '     + (job.qc_reviewer_code || '?'));
      });
      return { dry_run: true, all_qc_review: qcReviewJobs.length, would_fix: toFix.length };
    }

    // Live run
    var periodId = Identifiers.generateCurrentPeriodId();
    DAL.ensurePartition(Config.TABLES.FACT_QC_EVENTS, periodId, MODULE);

    var fixed = 0;
    var skipped = 0;
    var errors = [];

    for (var fi = 0; fi < toFix.length; fi++) {
      if (fi % 10 === 0 && HealthMonitor.isApproachingLimit()) {
        Logger.warn('MIGRATED_QC_FIX_QUOTA_CUTOFF', { module: MODULE, processed: fi, total: toFix.length });
        break;
      }

      var job = toFix[fi];
      var jobNumber = String(job.job_number || '').trim();

      try {
        var idempotencyKey = 'MIGRATED_QC_APPROVE|' + jobNumber;

        if (!IdempotencyEngine.checkAndMark(idempotencyKey)) {
          Logger.warn('MIGRATED_QC_APPROVE_SKIP', { module: MODULE, job_number: jobNumber, reason: 'already processed' });
          skipped++;
          continue;
        }

        var ts = new Date().toISOString();

        var eventRow = {
          event_id:        Identifiers.generateId(),
          job_number:      jobNumber,
          period_id:       periodId,
          event_type:      Constants.EVENT_TYPES.QC_APPROVED,
          timestamp:       ts,
          actor_code:      actor.personCode || 'SGO',
          actor_role:      actor.role       || 'PM',
          qc_result:       'APPROVED',
          rework_notes:    '',
          notes:           'Retroactive approval — reviewed in Stacey V2 before V3 migration',
          idempotency_key: idempotencyKey,
          payload_json:    JSON.stringify({ source: MODULE, job_number: jobNumber })
        };

        DAL.appendRow(
          Config.TABLES.FACT_QC_EVENTS,
          eventRow,
          { callerModule: MODULE, periodId: periodId }
        );

        DAL.updateWhere(
          Config.TABLES.VW_JOB_CURRENT_STATE,
          { job_number: jobNumber },
          {
            current_state: Config.STATES.COMPLETED_BILLABLE,
            prev_state:    Config.STATES.QC_REVIEW,
            updated_at:    ts
          },
          { callerModule: MODULE }
        );

        Logger.info('MIGRATED_QC_APPROVED', { module: MODULE, job_number: jobNumber });
        fixed++;

      } catch (e) {
        Logger.error('MIGRATED_QC_APPROVE_ERROR', { module: MODULE, job_number: jobNumber, error: e.message });
        errors.push(jobNumber + ': ' + e.message);
      }
    }

    Logger.info('MIGRATED_QC_FIX_DONE', {
      module:  MODULE,
      fixed:   fixed,
      skipped: skipped,
      errors:  errors.length
    });

    return { fixed: fixed, skipped: skipped, errors: errors };
  }

  return { run: run };

})();

// ── Top-level entry points ──────────────────────────────────

/**
 * Dry run (default): lists migrated QC_REVIEW jobs without writing anything.
 * Pass false to run live.
 *
 * @param {boolean} [dryRun=true]
 */
function runMigratedQCApprovalFixer(dryRun) {
  var result = MigratedQCApprovalFixer.run(dryRun !== false);
  console.log(JSON.stringify(result, null, 2));
}
