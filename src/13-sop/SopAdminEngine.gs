// ============================================================
// SopAdminEngine.gs — BLC Nexus T13 SOP Checklist Gate
// src/13-sop/SopAdminEngine.gs
//
// Admin-only operations on DIM_SOP_TEMPLATES and DIM_SOP_ITEMS:
// create, add item, edit item, copy, retire, and publish.
//
// All public functions enforce RBAC.ACTIONS.SOP_ADMIN before
// any data access. No portal wiring in this PR — admin ops
// are invoked from the GAS editor or SopImporter in PR 3,
// and from a portal admin panel in a future PR.
//
// Versioning model:
//   DRAFT  → (addItem / editItem) → (publishTemplate) → ACTIVE
//   ACTIVE → (copyTemplate)       → new DRAFT (version N+1)
//   ACTIVE → (retireTemplate)     → RETIRED
//   Only DRAFT templates may be edited. Only one ACTIVE template
//   per (client_code, job_type, software, scope_code) at a time.
// ============================================================

var SopAdminEngine = (function () {

  var MODULE = 'SopAdminEngine';

  // Fields that editItem() is permitted to update.
  // Whitelist prevents accidental write of immutable fields
  // (sop_item_id, sop_template_id, item_code, created_at).
  var EDITABLE_ITEM_FIELDS = [
    'item_label',
    'item_description',
    'is_required',
    'requires_comment',
    'requires_attachment',
    'active_flag',
    'item_seq'
  ];

  // ──────────────────────────────────────────────────────────
  // enforceAdmin_ — shared RBAC check for all public functions
  // ──────────────────────────────────────────────────────────
  function enforceAdmin_(actor) {
    if (!RBAC.hasPermission(actor, RBAC.ACTIONS.SOP_ADMIN)) {
      Logger.warn('SOP_ADMIN_RBAC_DENIED', {
        module:    MODULE,
        action:    RBAC.ACTIONS.SOP_ADMIN,
        actorCode: actor && actor.person_code,
        actorRole: actor && actor.role
      });
      throw SopError_('SOP_RBAC_DENIED', 'Actor does not have SOP_ADMIN permission', {
        actorCode: actor && actor.person_code,
        actorRole: actor && actor.role,
        action:    RBAC.ACTIONS.SOP_ADMIN
      });
    }
  }

  // ──────────────────────────────────────────────────────────
  // retireTemplateById_
  // Internal helper — retires a single template row by ID.
  // Shared by retireTemplate() (public) and publishTemplate()
  // (auto-retire of superseded ACTIVE before promotion).
  // Does NOT re-check RBAC — caller is responsible.
  // ──────────────────────────────────────────────────────────
  function retireTemplateById_(sopTemplateId) {
    SopDAL.updateTemplate(sopTemplateId, {
      status:       'RETIRED',
      effective_to: new Date().toISOString().slice(0, 10)
    });
  }

  // ──────────────────────────────────────────────────────────
  // createTemplate
  // Creates a new DRAFT template for a given set of dimensions.
  // Validates that no ACTIVE template already exists for the
  // same (clientCode, jobType, software, scopeCode) — one
  // active template per dimension set is the invariant.
  //
  // Required params: clientCode, jobType, software, scopeCode
  // Optional:        effectiveFrom (defaults to today)
  //
  // Returns: { sopTemplateId: string }
  // ──────────────────────────────────────────────────────────
  function createTemplate(actorEmail, params) {
    var actor = RBAC.resolveActor(actorEmail);
    enforceAdmin_(actor);

    if (!params.clientCode || !params.jobType || !params.software || !params.scopeCode) {
      throw SopError_('SOP_MISSING_DIMENSIONS', 'clientCode, jobType, software, and scopeCode are all required', params);
    }

    // Guard: one ACTIVE template per client_code + scope_code (product)
    var existing = SopDAL.findActiveTemplateByProduct(params.clientCode, params.scopeCode);
    if (existing) {
      throw SopError_('SOP_ACTIVE_TEMPLATE_EXISTS', 'An ACTIVE SOP template already exists for this client + scope — retire or copy it instead', {
        clientCode: params.clientCode, scopeCode: params.scopeCode,
        existingId: existing.sop_template_id
      });
    }

    var sopTemplateId = Identifiers.generatePrefixedId(Config.ID_PREFIXES.SOP_TEMPLATE);
    var now           = new Date().toISOString();

    SopDAL.saveTemplate({
      sop_template_id: sopTemplateId,
      client_code:     params.clientCode,
      job_type:        params.jobType,
      software:        params.software,
      scope_code:      params.scopeCode,
      version:         String(params.version || '1'),
      status:          'DRAFT',
      effective_from:  params.effectiveFrom || now.slice(0, 10),
      effective_to:    '',
      created_by:      actorEmail,
      created_at:      now,
      template_hash:   ''
    });

    Logger.info('SOP_TEMPLATE_CREATED', { module: MODULE, sopTemplateId: sopTemplateId, actor: actorEmail });
    return { sopTemplateId: sopTemplateId };
  }

  // ──────────────────────────────────────────────────────────
  // addItem
  // Adds one item to a DRAFT template. Assigns item_seq as
  // (current max item_seq + 1) if not supplied. Throws if the
  // parent template is not DRAFT.
  //
  // Required itemParams: item_code, item_label
  // Optional:            item_description, is_required,
  //                      requires_comment, requires_attachment,
  //                      item_seq
  //
  // Returns: { sopItemId: string }
  // ──────────────────────────────────────────────────────────
  function addItem(actorEmail, sopTemplateId, itemParams) {
    var actor = RBAC.resolveActor(actorEmail);
    enforceAdmin_(actor);

    var template = SopDAL.getTemplateById(sopTemplateId);
    if (!template) {
      throw SopError_('SOP_TEMPLATE_NOT_FOUND', 'Template not found', { sopTemplateId: sopTemplateId });
    }
    if (template.status !== 'DRAFT') {
      throw SopError_('SOP_TEMPLATE_NOT_DRAFT', 'Items can only be added to DRAFT templates', {
        sopTemplateId: sopTemplateId, status: template.status
      });
    }
    if (!itemParams.item_code || !itemParams.item_label) {
      throw SopError_('SOP_MISSING_ITEM_FIELDS', 'item_code and item_label are required', itemParams);
    }

    // Assign item_seq if not supplied
    var itemSeq = itemParams.item_seq;
    if (!itemSeq) {
      var existing = SopDAL.getAllItems(sopTemplateId);
      var maxSeq   = existing.reduce(function (m, r) { return Math.max(m, Number(r.item_seq) || 0); }, 0);
      itemSeq      = String(maxSeq + 1);
    }

    var sopItemId = Identifiers.generatePrefixedId(Config.ID_PREFIXES.SOP_ITEM);
    var now       = new Date().toISOString();

    SopDAL.saveItem({
      sop_item_id:          sopItemId,
      sop_template_id:      sopTemplateId,
      item_seq:             String(itemSeq),
      item_code:            itemParams.item_code,
      item_label:           itemParams.item_label,
      item_description:     itemParams.item_description     || '',
      is_required:          itemParams.is_required          !== undefined ? String(itemParams.is_required).toUpperCase() : 'TRUE',
      requires_comment:     itemParams.requires_comment     !== undefined ? String(itemParams.requires_comment).toUpperCase() : 'FALSE',
      requires_attachment:  itemParams.requires_attachment  !== undefined ? String(itemParams.requires_attachment).toUpperCase() : 'FALSE',
      active_flag:          'TRUE',
      created_at:           now
    });

    Logger.info('SOP_ITEM_ADDED', { module: MODULE, sopTemplateId: sopTemplateId, sopItemId: sopItemId, actor: actorEmail });
    return { sopItemId: sopItemId };
  }

  // ──────────────────────────────────────────────────────────
  // editItem
  // Updates editable fields on an existing DIM_SOP_ITEMS row.
  // Permitted fields: item_label, item_description, is_required,
  // requires_comment, requires_attachment, active_flag, item_seq.
  //
  // Immutable fields: sop_item_id, sop_template_id, item_code,
  // created_at (silently ignored even if passed in itemParams).
  //
  // Throws SOP_TEMPLATE_NOT_DRAFT if the parent template is
  // ACTIVE or RETIRED — items in published templates are locked.
  //
  // To logically retire an item from a DRAFT without deleting it,
  // pass { active_flag: 'FALSE' }. The item row is preserved and
  // excluded from hash computation and checklist rendering.
  //
  // Returns: { sopItemId: string }
  // ──────────────────────────────────────────────────────────
  function editItem(actorEmail, sopItemId, itemParams) {
    var actor = RBAC.resolveActor(actorEmail);
    enforceAdmin_(actor);

    var item = SopDAL.getItemById(sopItemId);
    if (!item) {
      throw SopError_('SOP_ITEM_NOT_FOUND', 'SOP item not found', { sopItemId: sopItemId });
    }

    var template = SopDAL.getTemplateById(item.sop_template_id);
    if (!template || template.status !== 'DRAFT') {
      throw SopError_('SOP_TEMPLATE_NOT_DRAFT', 'Items can only be edited on DRAFT templates', {
        sopItemId:      sopItemId,
        sopTemplateId:  item.sop_template_id,
        templateStatus: template ? template.status : 'NOT_FOUND'
      });
    }

    // Build whitelist update — only permitted fields, normalise booleans
    var updates = {};
    EDITABLE_ITEM_FIELDS.forEach(function (field) {
      if (!itemParams.hasOwnProperty(field)) return;
      var val = itemParams[field];
      // Normalise boolean-like fields to uppercase string
      if (['is_required', 'requires_comment', 'requires_attachment', 'active_flag'].indexOf(field) !== -1) {
        val = String(val).toUpperCase();
      }
      // Normalise item_seq to string
      if (field === 'item_seq') {
        val = String(val);
      }
      updates[field] = val;
    });

    if (Object.keys(updates).length === 0) {
      throw SopError_('SOP_NO_EDITABLE_FIELDS', 'No editable fields provided in itemParams', {
        sopItemId: sopItemId, provided: Object.keys(itemParams)
      });
    }

    SopDAL.updateItem(sopItemId, updates);

    Logger.info('SOP_ITEM_EDITED', { module: MODULE, sopItemId: sopItemId, fields: Object.keys(updates), actor: actorEmail });
    return { sopItemId: sopItemId };
  }

  // ──────────────────────────────────────────────────────────
  // copyTemplate
  // Copies an ACTIVE or RETIRED template (and its active items)
  // to a new DRAFT with version incremented by 1.
  //
  // New item rows get new sop_item_id values. The copy starts
  // with template_hash='' — it must be published before use.
  //
  // Throws SOP_TEMPLATE_COPY_SOURCE_INVALID if the source
  // template is itself DRAFT (copying a draft is pointless).
  //
  // Returns: { sopTemplateId: string } — the new DRAFT id
  // ──────────────────────────────────────────────────────────
  function copyTemplate(actorEmail, sopTemplateId) {
    var actor = RBAC.resolveActor(actorEmail);
    enforceAdmin_(actor);

    var source = SopDAL.getTemplateById(sopTemplateId);
    if (!source) {
      throw SopError_('SOP_TEMPLATE_NOT_FOUND', 'Source template not found', { sopTemplateId: sopTemplateId });
    }
    if (source.status === 'DRAFT') {
      throw SopError_('SOP_TEMPLATE_COPY_SOURCE_INVALID', 'Cannot copy a DRAFT template — edit the existing DRAFT instead', {
        sopTemplateId: sopTemplateId
      });
    }

    // Determine next version for this dimension set
    var allVersions = SopDAL.getTemplatesByDimensions(
      source.client_code, source.job_type, source.software, source.scope_code
    );
    var maxVersion = allVersions.reduce(function (m, t) {
      return Math.max(m, parseInt(t.version, 10) || 0);
    }, 0);
    var newVersion = String(maxVersion + 1);

    var newTemplateId = Identifiers.generatePrefixedId(Config.ID_PREFIXES.SOP_TEMPLATE);
    var now           = new Date().toISOString();

    SopDAL.saveTemplate({
      sop_template_id: newTemplateId,
      client_code:     source.client_code,
      job_type:        source.job_type,
      software:        source.software,
      scope_code:      source.scope_code,
      version:         newVersion,
      status:          'DRAFT',
      effective_from:  now.slice(0, 10),
      effective_to:    '',
      created_by:      actorEmail,
      created_at:      now,
      template_hash:   ''
    });

    // Copy active items only — inactive items from source are not carried forward
    var sourceItems = SopDAL.getSopItems(sopTemplateId);
    sourceItems.forEach(function (item) {
      SopDAL.saveItem({
        sop_item_id:          Identifiers.generatePrefixedId(Config.ID_PREFIXES.SOP_ITEM),
        sop_template_id:      newTemplateId,
        item_seq:             item.item_seq,
        item_code:            item.item_code,
        item_label:           item.item_label,
        item_description:     item.item_description     || '',
        is_required:          item.is_required,
        requires_comment:     item.requires_comment,
        requires_attachment:  item.requires_attachment,
        active_flag:          'TRUE',
        created_at:           now
      });
    });

    Logger.info('SOP_TEMPLATE_COPIED', {
      module:       MODULE,
      sourceId:     sopTemplateId,
      newId:        newTemplateId,
      newVersion:   newVersion,
      itemsCopied:  sourceItems.length,
      actor:        actorEmail
    });
    return { sopTemplateId: newTemplateId };
  }

  // ──────────────────────────────────────────────────────────
  // retireTemplate
  // Marks an ACTIVE template as RETIRED and sets effective_to
  // to today. Throws if the template is not currently ACTIVE.
  //
  // Returns: void
  // ──────────────────────────────────────────────────────────
  function retireTemplate(actorEmail, sopTemplateId) {
    var actor = RBAC.resolveActor(actorEmail);
    enforceAdmin_(actor);

    var template = SopDAL.getTemplateById(sopTemplateId);
    if (!template) {
      throw SopError_('SOP_TEMPLATE_NOT_FOUND', 'Template not found', { sopTemplateId: sopTemplateId });
    }
    if (template.status !== 'ACTIVE') {
      throw SopError_('SOP_TEMPLATE_NOT_ACTIVE', 'Only ACTIVE templates can be retired', {
        sopTemplateId: sopTemplateId, status: template.status
      });
    }

    retireTemplateById_(sopTemplateId);
    Logger.info('SOP_TEMPLATE_RETIRED', { module: MODULE, sopTemplateId: sopTemplateId, actor: actorEmail });
  }

  // ──────────────────────────────────────────────────────────
  // publishTemplate
  // Promotes a DRAFT template to ACTIVE.
  //
  // Steps:
  //   1. Verify template is DRAFT
  //   2. Load active items; verify at least one exists
  //   3. Validate: no duplicate item_code, no duplicate item_seq,
  //      no blank item_label on any required item
  //   4. Compute hash via SopTemplateEngine.computeTemplateHash()
  //   5. Auto-retire any current ACTIVE template for same dims
  //   6. Update this template: status → ACTIVE, hash set,
  //      effective_from → today
  //
  // Returns: { sopTemplateId, templateHash }
  // ──────────────────────────────────────────────────────────
  function publishTemplate(actorEmail, sopTemplateId) {
    var actor = RBAC.resolveActor(actorEmail);
    enforceAdmin_(actor);

    var template = SopDAL.getTemplateById(sopTemplateId);
    if (!template) {
      throw SopError_('SOP_TEMPLATE_NOT_FOUND', 'Template not found', { sopTemplateId: sopTemplateId });
    }
    if (template.status !== 'DRAFT') {
      throw SopError_('SOP_TEMPLATE_NOT_DRAFT', 'Only DRAFT templates can be published', {
        sopTemplateId: sopTemplateId, status: template.status
      });
    }

    var activeItems = SopDAL.getSopItems(sopTemplateId);
    if (!activeItems || activeItems.length === 0) {
      throw SopError_('SOP_TEMPLATE_NO_ITEMS', 'Template must have at least one active item before publishing', {
        sopTemplateId: sopTemplateId
      });
    }

    // Validate: duplicate item_code
    var codes = {};
    activeItems.forEach(function (item) {
      if (codes[item.item_code]) {
        throw SopError_('SOP_DUPLICATE_ITEM_CODE', 'Duplicate item_code found in template', {
          sopTemplateId: sopTemplateId, item_code: item.item_code
        });
      }
      codes[item.item_code] = true;
    });

    // Validate: duplicate item_seq
    var seqs = {};
    activeItems.forEach(function (item) {
      var seq = String(item.item_seq);
      if (seqs[seq]) {
        throw SopError_('SOP_DUPLICATE_ITEM_SEQ', 'Duplicate item_seq found in template', {
          sopTemplateId: sopTemplateId, item_seq: seq
        });
      }
      seqs[seq] = true;
    });

    // Validate: no blank item_label on required items
    activeItems.forEach(function (item) {
      var req = String(item.is_required).toUpperCase();
      if ((req === 'TRUE' || req === '1') && !String(item.item_label || '').trim()) {
        throw SopError_('SOP_BLANK_REQUIRED_LABEL', 'A required item has a blank item_label', {
          sopTemplateId: sopTemplateId, sopItemId: item.sop_item_id
        });
      }
    });

    // Compute and lock hash
    var templateHash = SopTemplateEngine.computeTemplateHash(activeItems);

    // Auto-retire the current ACTIVE template for this client + scope
    var currentActive = SopDAL.findActiveTemplateByProduct(
      template.client_code, template.scope_code
    );
    if (currentActive && currentActive.sop_template_id !== sopTemplateId) {
      retireTemplateById_(currentActive.sop_template_id);
      Logger.info('SOP_TEMPLATE_AUTO_RETIRED', {
        module:    MODULE,
        retiredId: currentActive.sop_template_id,
        reason:    'superseded by publish of ' + sopTemplateId
      });
    }

    // Promote to ACTIVE
    SopDAL.updateTemplate(sopTemplateId, {
      status:         'ACTIVE',
      effective_from: new Date().toISOString().slice(0, 10),
      effective_to:   '',
      template_hash:  templateHash
    });

    Logger.info('SOP_TEMPLATE_PUBLISHED', {
      module:       MODULE,
      sopTemplateId: sopTemplateId,
      templateHash:  templateHash,
      itemCount:    activeItems.length,
      actor:        actorEmail
    });
    return { sopTemplateId: sopTemplateId, templateHash: templateHash };
  }

  return {
    createTemplate:  createTemplate,
    addItem:         addItem,
    editItem:        editItem,
    copyTemplate:    copyTemplate,
    retireTemplate:  retireTemplate,
    publishTemplate: publishTemplate
  };

}());

// ============================================================
// TOP-LEVEL RUNNERS — callable from the Apps Script editor
// ============================================================

/** List all templates (any status) — useful for admin audit. */
function runListSopTemplates() {
  var email = Session.getActiveUser().getEmail();
  var actor = RBAC.resolveActor(email);
  if (!RBAC.hasPermission(actor, RBAC.ACTIONS.SOP_ADMIN)) {
    console.log('Access denied — SOP_ADMIN required');
    return;
  }
  // Read all templates directly via SopDAL for inspection
  var rows = DAL.readAll(Config.TABLES.DIM_SOP_TEMPLATES, { callerModule: 'SopAdminEngine' }) || [];
  console.log('SOP TEMPLATES — ' + rows.length + ' rows');
  rows.forEach(function (r) {
    console.log('  [' + r.status + '] v' + r.version + ' ' + r.sop_template_id +
      ' — ' + r.client_code + '/' + r.job_type + '/' + r.software + '/' + r.scope_code);
  });
}
