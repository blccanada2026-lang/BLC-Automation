// ============================================================
// SopAuditEngine.gs — BLC Nexus T13 SOP Checklist Gate
// src/13-sop/SopAuditEngine.gs
//
// Records item checks to FACT_SOP_AUDITS and projects the
// current state to FACT_SOP_CURRENT_STATUS.
// Verifies checklist completeness for the QC gate (PR 5).
//
// Depends on: SopDAL, SopTemplateEngine (same module)
// ============================================================

var SopAuditEngine = (function () {

  var MODULE = 'SopAuditEngine';

  // ──────────────────────────────────────────────────────────
  // recordItemCheck
  // Records one item-checked event.
  //
  // Required params:
  //   actor         — resolved actor object (from RBAC.resolveActor)
  //   requestId     — client-supplied idempotency key (non-empty)
  //   jobId         — FACT_JOB_EVENTS job_id
  //   jobNumber     — human-readable job reference
  //   clientCode    — dimension key
  //   sopTemplateId — from resolved template
  //   sopTemplateVersion — from resolved template
  //   sopTemplateHash    — from resolved template
  //   sopItemId     — item being checked
  //   sopItemCode   — item code (denormalized for audit readability)
  //   checkedValue  — boolean: true = checked, false = unchecked
  //   comment       — string or null
  //
  // Flow:
  //   1. RBAC permission check (SOP_SAVE)
  //   2. Validate requestId non-empty
  //   3. Idempotency check (requestId + sopItemId)
  //   4. appendAuditRow → FACT_SOP_AUDITS
  //   5. upsertCurrentStatus → FACT_SOP_CURRENT_STATUS
  //
  // Returns: { auditId: string }
  // ──────────────────────────────────────────────────────────
  function recordItemCheck(params) {
    // 1. RBAC — must be first meaningful check per Rule S1
    if (!RBAC.hasPermission(params.actor, RBAC.ACTIONS.SOP_SAVE)) {
      Logger.warn('SOP_RBAC_DENIED', {
        module:      MODULE,
        action:      RBAC.ACTIONS.SOP_SAVE,
        actorCode:   params.actor && params.actor.personCode,
        actorRole:   params.actor && params.actor.role
      });
      throw SopError_('SOP_RBAC_DENIED', 'Actor does not have SOP_SAVE permission', {
        actorCode: params.actor && params.actor.personCode,
        actorRole: params.actor && params.actor.role
      });
    }

    // 2. requestId is required (Identifiers.buildIdempotencyKey throws on empty parts)
    if (!params.requestId || String(params.requestId).trim() === '') {
      throw SopError_('SOP_MISSING_REQUEST_ID', 'requestId is required for idempotency', {});
    }

    // 3. Idempotency — key scoped to requestId + item so one request can check multiple items
    var idempotencyKey = Identifiers.buildIdempotencyKey(
      'SOP_CHECK',
      String(params.requestId),
      String(params.sopItemId)
    );

    if (!IdempotencyEngine.checkAndMark(idempotencyKey)) {
      Logger.info('SOP_DUPLICATE_CHECK', {
        module:         MODULE,
        idempotencyKey: idempotencyKey,
        jobId:          params.jobId,
        sopItemId:      params.sopItemId
      });
      return { auditId: null, duplicate: true };
    }

    var now    = new Date().toISOString();
    var auditId = Identifiers.generatePrefixedId(Config.ID_PREFIXES.SOP_AUDIT);

    // 4. Append audit row
    var auditRow = {
      audit_id:             auditId,
      job_id:               params.jobId,
      job_number:           params.jobNumber,
      client_code:          params.clientCode,
      designer_email:       params.actor.email,
      role_at_action:       params.actor.role,
      sop_template_id:      params.sopTemplateId,
      sop_template_version: params.sopTemplateVersion,
      sop_template_hash:    params.sopTemplateHash,
      sop_item_id:          params.sopItemId,
      sop_item_code:        params.sopItemCode,
      checked_value:        params.checkedValue === true || params.checkedValue === 'true' || params.checkedValue === 'TRUE' ? 'TRUE' : 'FALSE',
      comment:              params.comment || '',
      action_type:          Constants.EVENT_TYPES.SOP_ITEM_CHECKED,
      source_state:         params.sourceState || '',
      target_state:         params.targetState || '',
      idempotency_key:      idempotencyKey,
      request_id:           params.requestId,
      checked_at:           now,
      checked_by:           params.actor.email,
      row_status:           'ACTIVE',
      superseded_by_audit_id: '',
      created_at:           now
    };

    SopDAL.appendAuditRow(auditRow);

    // 5. Project to current status
    var statusRow = {
      job_id:               params.jobId,
      job_number:           params.jobNumber,
      client_code:          params.clientCode,
      sop_template_id:      params.sopTemplateId,
      sop_template_version: params.sopTemplateVersion,
      sop_template_hash:    params.sopTemplateHash,
      sop_item_id:          params.sopItemId,
      sop_item_code:        params.sopItemCode,
      checked_value:        auditRow.checked_value,
      comment:              params.comment || '',
      last_audit_id:        auditId,
      checked_by:           params.actor.email,
      checked_at:           now,
      updated_at:           now
    };

    SopDAL.upsertCurrentStatus(statusRow);

    Logger.info('SOP_ITEM_CHECKED', {
      module:    MODULE,
      auditId:   auditId,
      jobId:     params.jobId,
      sopItemId: params.sopItemId,
      checked:   auditRow.checked_value,
      actor:     params.actor.email
    });

    return { auditId: auditId, duplicate: false };
  }

  // ──────────────────────────────────────────────────────────
  // isChecklistComplete
  // Returns true if every required item in the template has
  // checked_value = TRUE in FACT_SOP_CURRENT_STATUS.
  //
  // params:
  //   jobId           — job to evaluate
  //   templateContext — result of SopTemplateEngine.resolveTemplate()
  //
  // Only items where is_required resolves to TRUE are evaluated.
  // Optional items (is_required = FALSE) do not gate completion.
  // ──────────────────────────────────────────────────────────
  function isChecklistComplete(jobId, templateContext) {
    var currentStatus = SopDAL.getCurrentStatus(jobId);

    // Index current status by sop_item_id for O(1) lookup
    var statusById = {};
    currentStatus.forEach(function (row) {
      statusById[row.sop_item_id] = row;
    });

    var requiredItems = templateContext.items.filter(function (item) {
      var f = String(item.is_required).toUpperCase();
      return f === 'TRUE' || f === '1';
    });

    if (requiredItems.length === 0) {
      // No required items — treat as complete
      return true;
    }

    for (var i = 0; i < requiredItems.length; i++) {
      var item       = requiredItems[i];
      var statusRow  = statusById[item.sop_item_id];
      if (!statusRow) return false;
      var checked = String(statusRow.checked_value).toUpperCase();
      if (checked !== 'TRUE' && checked !== '1') return false;
    }

    return true;
  }

  // ──────────────────────────────────────────────────────────
  // getIncompleteRequiredItems
  // Returns the subset of required items that are NOT yet checked
  // TRUE in FACT_SOP_CURRENT_STATUS. Used by SopGate to build
  // the list of blocking items shown to the designer.
  //
  // params:
  //   jobId           — job to evaluate (job_number used as job_id)
  //   templateContext — { items: [{sop_item_id, item_code, item_label, is_required}] }
  //
  // Returns: [{ sopItemId, sopItemCode, itemLabel }]
  // ──────────────────────────────────────────────────────────
  function getIncompleteRequiredItems(jobId, templateContext) {
    var currentStatus = SopDAL.getCurrentStatus(jobId);

    var statusById = {};
    currentStatus.forEach(function (row) {
      statusById[row.sop_item_id] = row;
    });

    var requiredItems = templateContext.items.filter(function (item) {
      var f = String(item.is_required).toUpperCase();
      return f === 'TRUE' || f === '1';
    });

    return requiredItems.filter(function (item) {
      var statusRow = statusById[item.sop_item_id];
      if (!statusRow) return true;
      var checked = String(statusRow.checked_value).toUpperCase();
      return checked !== 'TRUE' && checked !== '1';
    }).map(function (item) {
      return {
        sopItemId:   item.sop_item_id,
        sopItemCode: item.item_code,
        itemLabel:   item.item_label
      };
    });
  }

  return {
    recordItemCheck:             recordItemCheck,
    isChecklistComplete:         isChecklistComplete,
    getIncompleteRequiredItems:  getIncompleteRequiredItems
  };

}());
