// ============================================================
// StaleJobVoidEngine.gs — BLC Nexus T12 Migration
// src/12-migration/StaleJobVoidEngine.gs
//
// One-time cleanup: voids 19 stale migration artefact jobs
// identified by Sarty on 2026-06-19. These jobs appear in
// VW_JOB_CURRENT_STATE but belong to cancelled/reassigned
// work that was never properly closed out in Stacey V2.
//
// Writes a JOB_VOIDED event to FACT_JOB_EVENTS (audit trail)
// and marks current_state = 'VOIDED' in VW_JOB_CURRENT_STATE
// (excluded from all portal views by loadJobs_).
//
// Run once from Apps Script editor: runStaleJobVoid()
// Idempotent — safe to re-run; already-voided rows are skipped.
// ============================================================

var StaleJobVoidEngine = (function() {

  var MODULE = 'StaleJobVoidEngine';

  // 19 stale jobs identified by Sarty 2026-06-19
  var STALE_JOBS = [
    // ALBERTA TRUSS (migrated as IN_PROGRESS — no active work)
    { job_number: '262993', client_code: 'ALBERTA_TRUSS', assigned_to: 'DBS' },
    { job_number: '262895', client_code: 'ALBERTA_TRUSS', assigned_to: 'PRS' },
    { job_number: '262008', client_code: 'ALBERTA_TRUSS', assigned_to: 'PRS' },
    { job_number: '261508', client_code: 'ALBERTA_TRUSS', assigned_to: 'PRS' },
    // SBS ON_HOLD (Bittu Dalui — BIT/JYS alias, all on hold)
    { job_number: '2502-2158-F', client_code: 'SBS',          assigned_to: 'BIT' },
    { job_number: '2604-5690-A', client_code: 'SBS',          assigned_to: 'BIT' },
    { job_number: '2606-7090-A', client_code: 'SBS',          assigned_to: 'BIT' },
    { job_number: '2606-7091-A', client_code: 'SBS',          assigned_to: 'BIT' },
    { job_number: '2606-7283-A', client_code: 'SBS',          assigned_to: 'BIT' },
    { job_number: '2606-7586-A', client_code: 'SBS',          assigned_to: 'BIT' },
    { job_number: '2606-7589-A', client_code: 'SBS',          assigned_to: 'BIT' },
    // NELSON (migrated as IN_PROGRESS — work completed outside V3)
    { job_number: '260644',   client_code: 'NELSON', assigned_to: 'ABR' },
    { job_number: 'G2606037', client_code: 'NELSON', assigned_to: 'DBS' },
    { job_number: '260522',   client_code: 'NELSON', assigned_to: 'DBS' },
    // TITAN (migrated as IN_PROGRESS — work completed outside V3)
    { job_number: 'B600158', client_code: 'TITAN', assigned_to: 'NMM' },
    { job_number: 'B600147', client_code: 'TITAN', assigned_to: 'PRS' },
    { job_number: 'P-169',   client_code: 'TITAN', assigned_to: 'PRS' },
    { job_number: 'B600126', client_code: 'TITAN', assigned_to: 'NMM' },
    { job_number: 'P-157',   client_code: 'TITAN', assigned_to: 'PRS' }
  ];

  /**
   * Dry run — logs what would be voided. No data changes.
   * @param {string} actorEmail
   */
  function runAudit(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    var vwRows;
    try {
      vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    } catch(e) {
      Logger.error('STALE_VOID_AUDIT_FAIL', { module: MODULE, error: e.message });
      return;
    }
    var vwIndex = {};
    (vwRows || []).forEach(function(r) { vwIndex[String(r.job_number || '')] = r; });

    Logger.info('STALE_VOID_AUDIT', { module: MODULE, totalStaleJobs: STALE_JOBS.length });
    var found = 0, alreadyVoided = 0, missing = 0;
    STALE_JOBS.forEach(function(j) {
      var vw = vwIndex[j.job_number];
      if (!vw) {
        Logger.info('STALE_VOID_MISSING', { module: MODULE, job_number: j.job_number });
        missing++;
      } else if (String(vw.current_state || '') === 'VOIDED') {
        Logger.info('STALE_VOID_ALREADY', { module: MODULE, job_number: j.job_number });
        alreadyVoided++;
      } else {
        Logger.info('STALE_VOID_WOULD_VOID', {
          module: MODULE, job_number: j.job_number,
          current_state: vw.current_state, allocated_to: vw.allocated_to
        });
        found++;
      }
    });
    Logger.info('STALE_VOID_AUDIT_SUMMARY', {
      module: MODULE, toVoid: found, alreadyVoided: alreadyVoided, missing: missing
    });
  }

  /**
   * Voids all 19 stale jobs — writes FACT event + marks VW row VOIDED.
   * Idempotent: already-voided rows are skipped.
   * @param {string} actorEmail
   */
  function runVoid(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    var vwRows;
    try {
      vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    } catch(e) {
      Logger.error('STALE_VOID_LOAD_FAIL', { module: MODULE, error: e.message });
      throw e;
    }
    var vwIndex = {};
    (vwRows || []).forEach(function(r) { vwIndex[String(r.job_number || '')] = r; });

    var voided = 0, skipped = 0;
    var periodId = Identifiers.generateCurrentPeriodId();

    STALE_JOBS.forEach(function(j) {
      if (HealthMonitor.isApproachingLimit()) {
        Logger.warn('STALE_VOID_QUOTA_CUTOFF', { module: MODULE, voided: voided });
        return;
      }

      var vw = vwIndex[j.job_number];
      if (!vw) {
        Logger.warn('STALE_VOID_NOT_FOUND', { module: MODULE, job_number: j.job_number });
        skipped++;
        return;
      }
      if (String(vw.current_state || '') === 'VOIDED') {
        skipped++;
        return;
      }

      // 1. Append audit event to FACT_JOB_EVENTS
      try {
        DAL.appendRow(Config.TABLES.FACT_JOB_EVENTS, {
          event_id:        Identifiers.generateId(),
          job_number:      j.job_number,
          period_id:       periodId,
          event_type:      'JOB_VOIDED',
          current_state:   'VOIDED',
          prev_state:      String(vw.current_state || ''),
          client_code:     j.client_code || String(vw.client_code || ''),
          allocated_to:    j.assigned_to  || String(vw.allocated_to || ''),
          notes:           'Stale migration artefact — voided 2026-06-19 per Sarty review',
          migration_batch: 'STALE_VOID_2026_06_19',
          created_by:      actor.personCode,
          created_at:      new Date().toISOString()
        }, { callerModule: MODULE });
      } catch(e) {
        Logger.warn('STALE_VOID_FACT_FAIL', { module: MODULE, job_number: j.job_number, error: e.message });
      }

      // 2. Mark VW_JOB_CURRENT_STATE row as VOIDED
      try {
        DAL.updateWhere(
          Config.TABLES.VW_JOB_CURRENT_STATE,
          { job_number: j.job_number },
          { current_state: 'VOIDED', updated_at: new Date().toISOString() },
          { callerModule: MODULE }
        );
        voided++;
        Logger.info('STALE_VOID_OK', { module: MODULE, job_number: j.job_number, prev: vw.current_state });
      } catch(e) {
        Logger.error('STALE_VOID_VW_FAIL', { module: MODULE, job_number: j.job_number, error: e.message });
      }
    });

    Logger.info('STALE_VOID_COMPLETE', { module: MODULE, voided: voided, skipped: skipped });
    return { voided: voided, skipped: skipped };
  }

  return { runAudit: runAudit, runVoid: runVoid };
}());

// ── Top-level runners ─────────────────────────────────────────

/** Audit: log what would be voided (no changes). */
function runStaleJobAudit() {
  var email = Session.getActiveUser().getEmail();
  StaleJobVoidEngine.runAudit(email);
  console.log('STALE JOB AUDIT complete — check Apps Script logs.');
}

/** Execute: void all 19 stale jobs. Run audit first. */
function runStaleJobVoid() {
  var email  = Session.getActiveUser().getEmail();
  var result = StaleJobVoidEngine.runVoid(email);
  console.log('STALE VOID DONE — voided: ' + result.voided + ', skipped: ' + result.skipped);
}
