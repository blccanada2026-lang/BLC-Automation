// ============================================================
// QcProcessSeed.gs — BLC Nexus T13 QMS Layer 2
// src/13-sop/QcProcessSeed.gs
//
// Idempotent seed for GLOBAL_QC_PROCESS v1 template and its
// 12 approved process items. DEV utility only — not wired to
// any handler, trigger, or Portal workflow.
//
// Public API:
//   QcProcessSeed.seed()  — idempotent; safe to call multiple times
//
// Idempotency:
//   - Template: reads existing ACTIVE GLOBAL_QC_PROCESS rows first.
//     If one exists, reuses its ID and skips the write.
//     If multiple ACTIVE exist, throws SEED_CONFLICT and stops.
//   - Items: reads existing items for the resolved template ID,
//     builds a Set of present item_codes, inserts only the delta.
//
// ADR-QMS-016. QMS-3B.
// ============================================================

var QcProcessSeed = (function () {

  var PROCESS_CODE  = QcConstants.PROCESS_CODES.GLOBAL;   // 'GLOBAL_QC_PROCESS'
  var TEMPLATE_TIER = QcConstants.TEMPLATE_TIERS.GLOBAL;  // 'GLOBAL'
  var TEMPLATE_NAME = 'Universal QC Review — Structural Design';
  var VERSION       = '1';

  // ──────────────────────────────────────────────────────────
  // APPROVED SEED DATA
  // GLOBAL_QC_PROCESS v1 — 12 items.
  // Severity split: 8 BLOCKING / 4 WARNING.
  // requires_comment = TRUE for GQC-004, GQC-008, GQC-011.
  // Approved by CTO 2026-06-26. GQC-001 wording adjusted.
  // ──────────────────────────────────────────────────────────
  var SEED_ITEMS = [
    {
      item_seq:         1,
      item_code:        'GQC-001',
      item_label:       'Designer SOP reviewed',
      item_description: 'If the Designer SOP is incomplete, the reviewer must record the appropriate finding and cannot select APPROVED unless the missing SOP item is clearly non-applicable or documented with justification.',
      severity:         QcConstants.ITEM_SEVERITIES.BLOCKING,
      requires_comment: 'FALSE'
    },
    {
      item_seq:         2,
      item_code:        'GQC-002',
      item_label:       'Client notes reviewed',
      item_description: 'Confirm all client-specific notes, job instructions, and portal submission notes were read and considered during review.',
      severity:         QcConstants.ITEM_SEVERITIES.BLOCKING,
      requires_comment: 'FALSE'
    },
    {
      item_seq:         3,
      item_code:        'GQC-003',
      item_label:       'Client standing requirements reviewed',
      item_description: 'Confirm client standing requirements, design standards, load overrides, and output preferences were verified for this job.',
      severity:         QcConstants.ITEM_SEVERITIES.BLOCKING,
      requires_comment: 'FALSE'
    },
    {
      item_seq:         4,
      item_code:        'GQC-004',
      item_label:       'Revision history reviewed',
      item_description: 'If this is a revision submission, confirm all revision notes and change markers were reviewed. Mark NA for fresh submissions.',
      severity:         QcConstants.ITEM_SEVERITIES.WARNING,
      requires_comment: 'TRUE'
    },
    {
      item_seq:         5,
      item_code:        'GQC-005',
      item_label:       'Design loading criteria verified',
      item_description: 'Confirm the applied gravity, wind, snow, and live loads match client specification and applicable design standard for this job.',
      severity:         QcConstants.ITEM_SEVERITIES.BLOCKING,
      requires_comment: 'FALSE'
    },
    {
      item_seq:         6,
      item_code:        'GQC-006',
      item_label:       'Bearing and support conditions verified',
      item_description: 'Confirm bearing locations, conditions, and support reactions are correctly captured in the design and consistent with architectural or structural drawings.',
      severity:         QcConstants.ITEM_SEVERITIES.BLOCKING,
      requires_comment: 'FALSE'
    },
    {
      item_seq:         7,
      item_code:        'GQC-007',
      item_label:       'Design standard confirmed',
      item_description: 'Confirm the correct design standard was applied and matches client requirement and project jurisdiction.',
      severity:         QcConstants.ITEM_SEVERITIES.BLOCKING,
      requires_comment: 'FALSE'
    },
    {
      item_seq:         8,
      item_code:        'GQC-008',
      item_label:       'Software output reviewed for warnings',
      item_description: 'Confirm the design software output was reviewed and all warnings were either resolved or explicitly acknowledged with engineering justification.',
      severity:         QcConstants.ITEM_SEVERITIES.BLOCKING,
      requires_comment: 'TRUE'
    },
    {
      item_seq:         9,
      item_code:        'GQC-009',
      item_label:       'Output package completeness verified',
      item_description: 'Confirm the required output files, drawings, calculations, schedules, or equivalent deliverables are present, correctly labelled, and match the design.',
      severity:         QcConstants.ITEM_SEVERITIES.WARNING,
      requires_comment: 'FALSE'
    },
    {
      item_seq:         10,
      item_code:        'GQC-010',
      item_label:       'Special framing conditions reviewed',
      item_description: 'If this job includes special framing, confirm these were identified and reviewed. Mark NA if no special conditions exist.',
      severity:         QcConstants.ITEM_SEVERITIES.WARNING,
      requires_comment: 'FALSE'
    },
    {
      item_seq:         11,
      item_code:        'GQC-011',
      item_label:       'Prior rework findings addressed',
      item_description: 'If this is a rework resubmission, confirm all findings from the prior QC session have been addressed. Mark NA for fresh submissions.',
      severity:         QcConstants.ITEM_SEVERITIES.WARNING,
      requires_comment: 'TRUE'
    },
    {
      item_seq:         12,
      item_code:        'GQC-012',
      item_label:       'QC outcome justified',
      item_description: 'Confirm the selected outcome APPROVED / MINOR_REWORK / MAJOR_REWORK is consistent with the findings documented in this session.',
      severity:         QcConstants.ITEM_SEVERITIES.BLOCKING,
      requires_comment: 'FALSE'
    }
  ];

  // ──────────────────────────────────────────────────────────
  // PRIVATE: build item rows for a given template ID
  // ──────────────────────────────────────────────────────────
  function buildItemRows_(templateId) {
    var now = new Date().toISOString();
    return SEED_ITEMS.map(function (spec) {
      return {
        qc_item_id:             Identifiers.generatePrefixedId(Config.ID_PREFIXES.QC_PROCESS_ITEM),
        qc_process_template_id: templateId,
        qc_process_code:        PROCESS_CODE,
        item_seq:               spec.item_seq,
        item_code:              spec.item_code,
        item_label:             spec.item_label,
        item_description:       spec.item_description,
        is_required:            'TRUE',
        severity:               spec.severity,
        requires_comment:       spec.requires_comment,
        active_flag:            'TRUE',
        created_by:             'SYSTEM',
        created_at:             now
      };
    });
  }

  // ──────────────────────────────────────────────────────────
  // PUBLIC: seed()
  // ──────────────────────────────────────────────────────────
  /**
   * Idempotent seed for GLOBAL_QC_PROCESS v1.
   * @returns {{ templateId: string, templateInserted: boolean,
   *             itemsInserted: number, itemsSkipped: number }}
   */
  function seed() {
    Logger.info('QC_PROCESS_SEED_START', { module: 'QcProcessSeed', processCode: PROCESS_CODE });

    // ── Step 1: Resolve or create template ──────────────────
    var allTemplates = DAL.readWhere(
      Config.TABLES.DIM_QC_PROCESS_TEMPLATES,
      { qc_process_code: PROCESS_CODE }
    );

    var activeTemplates = allTemplates.filter(function (r) {
      return String(r.status) === QcConstants.TEMPLATE_STATUSES.ACTIVE;
    });

    var templateId;
    var templateInserted = false;

    if (activeTemplates.length > 1) {
      var err = new Error(
        'QcProcessSeed: ' + activeTemplates.length + ' ACTIVE ' + PROCESS_CODE +
        ' templates found. Resolve conflict before seeding.'
      );
      err.code = 'SEED_CONFLICT';
      throw err;
    } else if (activeTemplates.length === 1) {
      templateId = activeTemplates[0].qc_process_template_id;
      Logger.info('QC_PROCESS_SEED_TEMPLATE_EXISTS', {
        module:     'QcProcessSeed',
        templateId: templateId
      });
    } else {
      var now        = new Date().toISOString();
      templateId     = Identifiers.generatePrefixedId(Config.ID_PREFIXES.QC_PROCESS_TEMPLATE);
      DAL.appendRow(Config.TABLES.DIM_QC_PROCESS_TEMPLATES, {
        qc_process_template_id: templateId,
        qc_process_code:        PROCESS_CODE,
        template_tier:          TEMPLATE_TIER,
        template_name:          TEMPLATE_NAME,
        product_code:           null,
        client_code:            null,
        adr_reference:          'ADR-QMS-016',
        version:                VERSION,
        status:                 QcConstants.TEMPLATE_STATUSES.ACTIVE,
        effective_from:         now.split('T')[0],
        effective_to:           null,
        template_hash:          '',
        created_by:             'SYSTEM',
        created_at:             now,
        published_by:           null,
        published_at:           null,
        retired_by:             null,
        retired_at:             null
      }, { callerModule: 'QcProcessSeed' });
      templateInserted = true;
      Logger.info('QC_PROCESS_SEED_TEMPLATE_INSERTED', {
        module:     'QcProcessSeed',
        templateId: templateId
      });
    }

    // ── Step 2: Resolve or create items ─────────────────────
    var existingItems = DAL.readWhere(
      Config.TABLES.DIM_QC_PROCESS_ITEMS,
      { qc_process_template_id: templateId }
    );

    var existingCodes = {};
    for (var i = 0; i < existingItems.length; i++) {
      if (existingItems[i].item_code) {
        existingCodes[String(existingItems[i].item_code)] = true;
      }
    }

    var allItems = buildItemRows_(templateId);
    var toInsert = allItems.filter(function (row) {
      return !existingCodes[row.item_code];
    });

    if (toInsert.length > 0) {
      DAL.appendRows(
        Config.TABLES.DIM_QC_PROCESS_ITEMS,
        toInsert,
        { callerModule: 'QcProcessSeed' }
      );
    }

    var skipped = allItems.length - toInsert.length;

    Logger.info('QC_PROCESS_SEED_COMPLETE', {
      module:           'QcProcessSeed',
      processCode:      PROCESS_CODE,
      templateId:       templateId,
      templateInserted: templateInserted,
      itemsInserted:    toInsert.length,
      itemsSkipped:     skipped
    });

    return {
      templateId:       templateId,
      templateInserted: templateInserted,
      itemsInserted:    toInsert.length,
      itemsSkipped:     skipped
    };
  }

  // ──────────────────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────────────────
  return {
    seed: seed
  };

})();
