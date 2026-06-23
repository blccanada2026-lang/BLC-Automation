// ============================================================
// SopGate.gs — BLC Nexus T13 SOP Checklist Gate
// src/13-sop/SopGate.gs
//
// LOAD ORDER: T13, after SopDAL.gs and SopAuditEngine.gs.
// DEPENDENCIES: Config (T0), RBAC (T2), Logger (T3),
//               SopDAL, SopAuditEngine (T13)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  SOP completion gate for QC submission (Flow A only).  ║
// ║                                                         ║
// ║  Feature flags (Script Properties):                    ║
// ║    SOP_ENABLED       — 'true' to activate (default off) ║
// ║    SOP_MODE          — 'WARN_ONLY' | 'BLOCK'           ║
// ║                        (default WARN_ONLY if absent)   ║
// ║    SOP_PILOT_CLIENTS — comma-separated client codes    ║
// ║                        checked against job client_code ║
// ║                                                         ║
// ║  evaluate_() is the single shared evaluator. Both      ║
// ║  checkForQcSubmit (server gate) and portal_getSopGate- ║
// ║  Status (portal pre-check) call it to prevent drift.   ║
// ╚══════════════════════════════════════════════════════════╝
// ============================================================

var SopGate = (function () {

  var MODULE = 'SopGate';

  // ──────────────────────────────────────────────────────────
  // evaluate_
  // Internal shared evaluator. Reads Script Properties,
  // checks pilot client list, finds active template, and
  // calls SopAuditEngine.getIncompleteRequiredItems.
  //
  // param view — VW_JOB_CURRENT_STATE row
  //
  // Returns:
  //   {
  //     gateActive:    boolean,
  //     mode:          'WARN_ONLY' | 'BLOCK' | null,
  //     complete:      boolean,
  //     missing:       [{ sopItemId, sopItemCode, itemLabel }],
  //     sopTemplateId: string | null,
  //     reason:        'FEATURE_DISABLED' | 'NON_PILOT_CLIENT' |
  //                    'NO_TEMPLATE' | 'EVALUATED'
  //   }
  // ──────────────────────────────────────────────────────────
  function evaluate_(view) {
    var props = PropertiesService.getScriptProperties();

    // ── 1. Feature flag ──────────────────────────────────────
    var enabled = String(props.getProperty(Config.SOP_FLAGS.ENABLED) || '').trim().toLowerCase();
    if (enabled !== 'true') {
      return { gateActive: false, mode: null, complete: true, missing: [], sopTemplateId: null, reason: 'FEATURE_DISABLED' };
    }

    // ── 2. Pilot client check ────────────────────────────────
    var pilotRaw     = String(props.getProperty(Config.SOP_FLAGS.PILOT_CLIENTS) || '').trim();
    var clientCode   = String(view.client_code || '').trim().toUpperCase();
    if (pilotRaw) {
      var pilotCodes = pilotRaw.split(',').map(function (s) { return s.trim().toUpperCase(); });
      if (pilotCodes.indexOf(clientCode) === -1) {
        return { gateActive: false, mode: null, complete: true, missing: [], sopTemplateId: null, reason: 'NON_PILOT_CLIENT' };
      }
    }

    // ── 3. Read mode (default WARN_ONLY) ─────────────────────
    var modeRaw = String(props.getProperty(Config.SOP_FLAGS.MODE) || '').trim().toUpperCase();
    var mode    = (modeRaw === 'BLOCK') ? 'BLOCK' : 'WARN_ONLY';

    // ── 4. Find active template for this job ─────────────────
    var jobType  = String(view.job_type || '').trim();
    var template = SopDAL.findActiveTemplateForJob(view.client_code, jobType);
    if (!template) {
      return { gateActive: false, mode: mode, complete: true, missing: [], sopTemplateId: null, reason: 'NO_TEMPLATE' };
    }

    // ── 5. Get items and evaluate completeness ───────────────
    var items      = SopDAL.getSopItems(template.sop_template_id);
    var templateContext = { items: items };
    var jobId      = view.job_number;  // job_number is the stable job identifier used in FACT tables
    var missing    = SopAuditEngine.getIncompleteRequiredItems(jobId, templateContext);
    var complete   = missing.length === 0;

    return {
      gateActive:    true,
      mode:          mode,
      complete:      complete,
      missing:       missing,
      sopTemplateId: template.sop_template_id,
      reason:        'EVALUATED'
    };
  }

  // ──────────────────────────────────────────────────────────
  // checkForQcSubmit
  // Server-side gate called from QCHandler.handleFlowA_ after
  // StateMachine.assertTransition and before idempotency mark.
  // Allows WARN_ONLY through unconditionally; throws on BLOCK
  // when checklist is incomplete.
  //
  // Does NOT consume an idempotency key — a BLOCK rejection
  // must be retryable after the designer completes the checklist.
  //
  // params:
  //   view     — VW_JOB_CURRENT_STATE row
  //   actor    — resolved actor (for logging)
  //   queueId  — queue item ID (for logging)
  // ──────────────────────────────────────────────────────────
  function checkForQcSubmit(view, actor, queueId) {
    var result = evaluate_(view);

    if (!result.gateActive) {
      Logger.info('SOP_GATE_SKIPPED', {
        module:    MODULE,
        jobNumber: view.job_number,
        reason:    result.reason,
        queue_id:  queueId
      });
      return;
    }

    if (result.complete) {
      Logger.info('SOP_GATE_PASSED', {
        module:        MODULE,
        jobNumber:     view.job_number,
        sopTemplateId: result.sopTemplateId,
        queue_id:      queueId
      });
      return;
    }

    // Incomplete checklist
    var missingCodes = result.missing.map(function (m) { return m.sopItemCode; }).join(', ');

    if (result.mode === 'WARN_ONLY') {
      Logger.warn('SOP_GATE_WARN', {
        module:        MODULE,
        jobNumber:     view.job_number,
        sopTemplateId: result.sopTemplateId,
        missingItems:  missingCodes,
        queue_id:      queueId
      });
      return;  // Allow through
    }

    // BLOCK mode
    Logger.warn('SOP_GATE_BLOCKED', {
      module:        MODULE,
      jobNumber:     view.job_number,
      sopTemplateId: result.sopTemplateId,
      missingItems:  missingCodes,
      actorCode:     actor && actor.personCode,
      queue_id:      queueId
    });
    throw SopError_('SOP_GATE_INCOMPLETE',
      'SOP checklist incomplete — required items not checked: ' + missingCodes,
      {
        jobNumber:      view.job_number,
        clientCode:     view.client_code,
        sopTemplateId:  result.sopTemplateId,
        incompleteItems: result.missing
      }
    );
  }

  return {
    evaluate_:         evaluate_,
    checkForQcSubmit:  checkForQcSubmit
  };

}());
