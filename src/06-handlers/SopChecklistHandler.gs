// ============================================================
// SopChecklistHandler.gs — BLC Nexus T13 SOP Checklist Gate
// src/06-handlers/SopChecklistHandler.gs
//
// LOAD ORDER: T6 (handler tier), after T0–T5 and 13-sop/*.
// DEPENDENCIES: Config (T0), DAL (T1), RBAC (T2), Logger (T3),
//               QueueProcessor (T5), SopDAL/SopTemplateEngine/
//               SopAuditEngine (T13)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Handles FORM_TYPE = 'SOP_CHECKLIST'                    ║
// ║  Saves designer SOP checklist item states for a job.    ║
// ║  Batch-idempotent: re-submitting the same checked state  ║
// ║  for the same item is a no-op (duplicate, not error).   ║
// ╚══════════════════════════════════════════════════════════╝
//
// PAYLOAD SCHEMA (from portal_submitAction):
//   jobNumber       string    required  BLC-XXXXX job identifier
//   sopTemplateId   string    required  ST-... template primary key
//   sopTemplateHash string    required  SHA-256 hash of template at load time
//   batchRequestId  string    required  client-generated UUID for idempotency
//   items           Object[]  required  array of checklist item states:
//     { sopItemId, sopItemCode, checkedValue, comment }
//
// PERMISSION REQUIRED: RBAC.ACTIONS.SOP_SAVE
//
// The handler re-verifies the template hash server-side before
// writing any audit row. If the template changed since the
// client loaded it, the request is rejected with SOP_HASH_MISMATCH.
//
// jobId is resolved server-side from jobNumber via
// VW_JOB_CURRENT_STATE — the client never controls jobId.
// ============================================================

var SopChecklistHandler = (function () {

  var MODULE = 'SopChecklistHandler';

  // ──────────────────────────────────────────────────────────
  // handle
  // ──────────────────────────────────────────────────────────
  function handle(queueItem, actor) {
    // R3 — RBAC unconditionally first
    RBAC.enforcePermission(actor, RBAC.ACTIONS.SOP_SAVE);

    var queueId = queueItem.queue_id || '(unknown)';
    Logger.info('SOP_CHECKLIST_START', {
      module:   MODULE,
      queue_id: queueId,
      actor:    actor.personCode
    });

    // ── Step 1: Parse payload ───────────────────────────────
    var payload;
    try {
      payload = JSON.parse(queueItem.payload_json || '{}');
    } catch (e) {
      throw new Error(MODULE + ': invalid JSON in payload_json for queue_id "' + queueId + '": ' + e.message);
    }

    var jobNumber       = payload.jobNumber;
    var sopTemplateId   = payload.sopTemplateId;
    var sopTemplateHash = payload.sopTemplateHash;
    var batchRequestId  = payload.batchRequestId;
    var items           = payload.items;

    // ── Step 2: Validate required fields ────────────────────
    if (!jobNumber)       throw new Error(MODULE + ': jobNumber required');
    if (!sopTemplateId)   throw new Error(MODULE + ': sopTemplateId required');
    if (!sopTemplateHash) throw new Error(MODULE + ': sopTemplateHash required');
    if (!batchRequestId)  throw new Error(MODULE + ': batchRequestId required');
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error(MODULE + ': items must be a non-empty array');
    }

    // ── Step 3: Resolve jobId from jobNumber (server controls this) ──
    var jobRows;
    try {
      jobRows = DAL.readWhere(
        Config.TABLES.VW_JOB_CURRENT_STATE,
        { job_number: jobNumber },
        { callerModule: MODULE }
      );
    } catch (e) {
      throw new Error(MODULE + ': VW_JOB_CURRENT_STATE read failed — ' + e.message);
    }
    if (!jobRows || jobRows.length === 0) {
      throw new Error(MODULE + ': job not found in VW — ' + jobNumber);
    }
    var job        = jobRows[0];
    var jobId      = job.job_number;  // job_number is the stable job identifier
    var clientCode = job.client_code;

    // ── Step 4: Verify template exists and is ACTIVE ────────
    var template = SopDAL.getTemplateById(sopTemplateId);
    if (!template) {
      throw SopError_('SOP_TEMPLATE_NOT_FOUND',
        'SOP template not found: ' + sopTemplateId,
        { sopTemplateId: sopTemplateId });
    }
    if (template.status !== 'ACTIVE') {
      throw SopError_('SOP_TEMPLATE_NOT_ACTIVE',
        'SOP template is not ACTIVE: ' + sopTemplateId,
        { sopTemplateId: sopTemplateId, status: template.status });
    }

    // ── Step 5: Cross-check template belongs to this job's client ──
    if (template.client_code !== clientCode) {
      throw SopError_('SOP_TEMPLATE_CLIENT_MISMATCH',
        'Template client does not match job client',
        { templateClient: template.client_code, jobClient: clientCode });
    }

    // ── Step 6: Re-verify template hash (tamper protection) ─
    var activeItems  = SopDAL.getSopItems(sopTemplateId);
    var computedHash = SopTemplateEngine.computeTemplateHash(activeItems);
    if (computedHash !== sopTemplateHash) {
      throw SopError_('SOP_HASH_MISMATCH',
        'Template hash mismatch — template may have changed since checklist was loaded',
        { sopTemplateId: sopTemplateId });
    }

    // ── Step 7: Process items idempotently ──────────────────
    var saved      = 0;
    var duplicates = 0;
    var failed     = [];

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      try {
        var result = SopAuditEngine.recordItemCheck({
          actor:               actor,
          requestId:           batchRequestId + '-' + i,
          jobId:               jobId,
          jobNumber:           jobNumber,
          clientCode:          clientCode,
          sopTemplateId:       sopTemplateId,
          sopTemplateVersion:  template.version,
          sopTemplateHash:     sopTemplateHash,
          sopItemId:           item.sopItemId,
          sopItemCode:         item.sopItemCode,
          checkedValue:        item.checkedValue,
          comment:             item.comment || ''
        });
        if (result.duplicate) {
          duplicates++;
        } else {
          saved++;
        }
      } catch (e) {
        Logger.error('SOP_CHECKLIST_ITEM_FAILED', {
          module:    MODULE,
          jobNumber: jobNumber,
          sopItemId: item.sopItemId,
          error:     e.message
        });
        failed.push({ sopItemId: item.sopItemId, error: e.message });
      }
    }

    // ── Step 8: Log and return ──────────────────────────────
    Logger.info('SOP_CHECKLIST_SAVED', {
      module:     MODULE,
      queue_id:   queueId,
      jobNumber:  jobNumber,
      saved:      saved,
      duplicates: duplicates,
      failed:     failed.length
    });

    return { saved: saved, duplicates: duplicates, failed: failed };
  }

  // ── Self-registration at load time ─────────────────────────
  (function register_() {
    try {
      QueueProcessor.registerHandler(Config.FORM_TYPES.SOP_CHECKLIST, handle);
    } catch (e) {
      console.log('[SopChecklistHandler REGISTRATION FAILED] ' + e.message);
    }
  }());

  return { handle: handle };

}());
