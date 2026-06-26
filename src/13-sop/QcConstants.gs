// ============================================================
// QcConstants.gs — BLC Nexus T13 QMS Layer 2+3
// src/13-sop/QcConstants.gs
//
// Shared constants for QC Review Process (Layer 2) and QC
// Findings (Layer 3). Engine and DAL files import nothing from
// here — they reference these directly by module name.
//
// QMS-3A: constants only. No engines, no DAL, no seed data.
// QMS-3C will implement QcReviewDAL.gs and QcReviewEngine.gs.
// ============================================================

var QcConstants = (function () {

  // ──────────────────────────────────────────────────────────
  // ID PREFIXES
  // Registered here for QMS Layer 2+3 use.
  // Config.gs.ID_PREFIXES also holds these values.
  // Note: QI is taken by QUEUE_ITEM — QC process items use QPI.
  // See ADR-QMS-016.
  // ──────────────────────────────────────────────────────────
  var ID_PREFIXES = {
    QC_PROCESS_TEMPLATE: 'QT',   // DIM_QC_PROCESS_TEMPLATES
    QC_PROCESS_ITEM:     'QPI',  // DIM_QC_PROCESS_ITEMS (QI taken by QUEUE_ITEM)
    QC_SESSION:          'QS',   // FACT_QC_REVIEW_SESSIONS
    QC_RESPONSE:         'QR',   // FACT_QC_REVIEW_CHECKLISTS
    QC_FINDING:          'QF'    // FACT_QC_FINDINGS
  };

  // ──────────────────────────────────────────────────────────
  // PROCESS CODES
  // Identity keys for QC process template families.
  // GLOBAL_QC_PROCESS is the universal default (ADR-QMS-003).
  // Product supplements use PRODUCT_QC_{product_code} pattern.
  // Client overrides use CLIENT_OVERRIDE_{client_code} pattern
  // and require an ADR reference (ADR-QMS-016).
  // ──────────────────────────────────────────────────────────
  var PROCESS_CODES = {
    GLOBAL:                'GLOBAL_QC_PROCESS',
    PRODUCT_QC_TRUSS:      'PRODUCT_QC_TRUSS',
    PRODUCT_QC_OWF:        'PRODUCT_QC_OPEN_WOOD_FLOOR',
    PRODUCT_QC_I_JOIST:    'PRODUCT_QC_I_JOIST_FLOOR'
    // CLIENT_OVERRIDE_* codes are created dynamically — not enumerated here.
    // Each requires its own ADR before use.
  };

  // ──────────────────────────────────────────────────────────
  // TEMPLATE TIERS
  // Controls template resolution order at review time.
  // GLOBAL always resolved. PRODUCT_SUPPLEMENT resolved if exists.
  // CLIENT_OVERRIDE resolved only if ADR-authorized and exists.
  // ──────────────────────────────────────────────────────────
  var TEMPLATE_TIERS = {
    GLOBAL:             'GLOBAL',
    PRODUCT_SUPPLEMENT: 'PRODUCT_SUPPLEMENT',
    CLIENT_OVERRIDE:    'CLIENT_OVERRIDE'
  };

  // ──────────────────────────────────────────────────────────
  // TEMPLATE STATUSES
  // Mirrors DIM_SOP_TEMPLATES lifecycle pattern.
  // ──────────────────────────────────────────────────────────
  var TEMPLATE_STATUSES = {
    DRAFT:   'DRAFT',
    ACTIVE:  'ACTIVE',
    RETIRED: 'RETIRED'
  };

  // ──────────────────────────────────────────────────────────
  // SESSION EVENT TYPES
  // FACT_QC_REVIEW_SESSIONS uses an event_type discriminator
  // to remain append-only (ADR-QMS-016). One STARTED row is
  // appended when a session opens. One COMPLETED or VOIDED row
  // is appended when the session closes. Outcome is null on
  // STARTED rows; set on COMPLETED rows.
  // ──────────────────────────────────────────────────────────
  var SESSION_EVENTS = {
    STARTED:   'QC_REVIEW_STARTED',
    COMPLETED: 'QC_REVIEW_COMPLETED',
    VOIDED:    'QC_REVIEW_VOIDED'
  };

  // ──────────────────────────────────────────────────────────
  // REVIEW OUTCOMES
  // Aligned to existing QCHandler vocabulary (ADR-QMS-007).
  // Recorded on FACT_QC_REVIEW_SESSIONS COMPLETED rows only.
  // ──────────────────────────────────────────────────────────
  var OUTCOMES = {
    APPROVED:     'APPROVED',
    MINOR_REWORK: 'MINOR_REWORK',
    MAJOR_REWORK: 'MAJOR_REWORK'
  };

  // ──────────────────────────────────────────────────────────
  // FINDING EVENT TYPES
  // FACT_QC_FINDINGS uses event_type to support append-only
  // correction tracking. FINDING_CORRECTED rows reference the
  // original via amendment_of (ADR-QMS-016).
  // ──────────────────────────────────────────────────────────
  var FINDING_EVENTS = {
    RECORDED:   'FINDING_RECORDED',
    CORRECTED:  'FINDING_CORRECTED'
  };

  // ──────────────────────────────────────────────────────────
  // CHECKLIST RESPONSE VALUES
  // ──────────────────────────────────────────────────────────
  var CHECKED_VALUES = {
    YES: 'Y',
    NO:  'N',
    NA:  'NA'
  };

  // ──────────────────────────────────────────────────────────
  // ITEM SEVERITIES
  // Used on DIM_QC_PROCESS_ITEMS.severity.
  // ──────────────────────────────────────────────────────────
  var ITEM_SEVERITIES = {
    INFO:     'INFO',
    WARNING:  'WARNING',
    BLOCKING: 'BLOCKING'
  };

  // ──────────────────────────────────────────────────────────
  // FINDING SEVERITIES
  // Used on FACT_QC_FINDINGS.severity.
  // ──────────────────────────────────────────────────────────
  var FINDING_SEVERITIES = {
    INFO:     'INFO',
    MINOR:    'MINOR',
    MAJOR:    'MAJOR',
    CRITICAL: 'CRITICAL'
  };

  // ──────────────────────────────────────────────────────────
  // RBAC ACTIONS (stubs — registered in RBAC.gs in QMS-3C)
  // Defined here for reference. Do not use until QMS-3C.
  // ──────────────────────────────────────────────────────────
  var RBAC_ACTIONS = {
    QC_REVIEWER:       'QC_REVIEWER',
    QC_PROCESS_ADMIN:  'QC_PROCESS_ADMIN'
  };

  // ──────────────────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────────────────
  return {
    ID_PREFIXES:      ID_PREFIXES,
    PROCESS_CODES:    PROCESS_CODES,
    TEMPLATE_TIERS:   TEMPLATE_TIERS,
    TEMPLATE_STATUSES: TEMPLATE_STATUSES,
    SESSION_EVENTS:   SESSION_EVENTS,
    OUTCOMES:         OUTCOMES,
    FINDING_EVENTS:   FINDING_EVENTS,
    CHECKED_VALUES:   CHECKED_VALUES,
    ITEM_SEVERITIES:  ITEM_SEVERITIES,
    FINDING_SEVERITIES: FINDING_SEVERITIES,
    RBAC_ACTIONS:     RBAC_ACTIONS
  };

})();
