// ============================================================
// Constants.gs — BLC Nexus T0 Foundation
// src/00-foundation/Constants.gs
//
// LOAD ORDER: Second T0 file (loads after Config.gs).
// DEPENDENCIES: None — this module has zero imports.
//
// Responsibilities:
//   All enumerated string constants used across handlers and
//   engines. Using these symbols instead of raw strings ensures
//   typos surface as undefined at runtime rather than silently
//   routing to the wrong branch.
//
// DO NOT:
//   - Store runtime config here (that belongs in Config.gs)
//   - Store ID-generation logic (that belongs in Identifiers.gs)
//   - Call any GAS API (no SpreadsheetApp, Session, etc.)
//   - Import or call any other module
// ============================================================

var Constants = (function () {

  // ──────────────────────────────────────────────────────────
  // EVENT TYPES
  // All valid values for FACT_JOB_EVENTS.event_type,
  // FACT_WORK_LOGS.event_type, FACT_PAYROLL_LEDGER.event_type,
  // and FACT_BILLING_LEDGER.event_type.
  //
  // Grouped by domain. Handlers must use these constants —
  // never raw strings — when writing to FACT tables.
  // ──────────────────────────────────────────────────────────
  var EVENT_TYPES = {
    // ── Job lifecycle ───────────────────────────────────────
    JOB_CREATED:             'JOB_CREATED',
    JOB_ALLOCATED:           'JOB_ALLOCATED',
    JOB_STARTED:             'JOB_STARTED',
    JOB_HELD:                'JOB_HELD',
    JOB_RESUMED:             'JOB_RESUMED',
    JOB_COMPLETED:           'JOB_COMPLETED',
    JOB_REWORKED:            'JOB_REWORKED',
    // ── QC ──────────────────────────────────────────────────
    QC_SUBMITTED:            'QC_SUBMITTED',
    QC_APPROVED:             'QC_APPROVED',
    QC_REJECTED:             'QC_REJECTED',
    QC_REWORK_REQUESTED:     'QC_REWORK_REQUESTED',
    // ── Client return ───────────────────────────────────────
    CLIENT_RETURN_RECEIVED:  'CLIENT_RETURN_RECEIVED',
    CLIENT_RETURN_RESOLVED:  'CLIENT_RETURN_RESOLVED',
    // ── Billing ─────────────────────────────────────────────
    INVOICE_GENERATED:       'INVOICE_GENERATED',
    BILLING_CALCULATED:      'BILLING_CALCULATED',
    BILLING_AMENDED:         'BILLING_AMENDED',
    // ── Work logs ───────────────────────────────────────────
    WORK_LOG_SUBMITTED:      'WORK_LOG_SUBMITTED',
    WORK_LOG_AMENDED:        'WORK_LOG_AMENDED',
    // ── Payroll ─────────────────────────────────────────────
    PAYROLL_CALCULATED:      'PAYROLL_CALCULATED',
    PAYROLL_AMENDED:         'PAYROLL_AMENDED',
    BONUS_CALCULATED:        'BONUS_CALCULATED',
    // ── SOP ─────────────────────────────────────────────────
    SOP_CHECKLIST_SUBMITTED: 'SOP_CHECKLIST_SUBMITTED',
    SOP_CHECKLIST_APPROVED:  'SOP_CHECKLIST_APPROVED'
  };

  // ──────────────────────────────────────────────────────────
  // STAFF ROLES
  // Valid values for DIM_STAFF_ROSTER.role and actor.role.
  // Used by RBAC.enforcePermission() for gate decisions.
  // ──────────────────────────────────────────────────────────
  var ROLES = {
    DESIGNER:  'DESIGNER',
    TEAM_LEAD: 'TEAM_LEAD',
    PM:        'PM',
    QC:        'QC',
    CEO:       'CEO',
    ADMIN:     'ADMIN'
  };

  // ──────────────────────────────────────────────────────────
  // QUEUE STATUSES
  // Valid values for STG_PROCESSING_QUEUE.status.
  // QueueProcessor transitions items through this lifecycle.
  // ──────────────────────────────────────────────────────────
  var QUEUE_STATUSES = {
    PENDING:     'PENDING',      // waiting for QueueProcessor pickup
    PROCESSING:  'PROCESSING',   // handler is currently executing
    COMPLETED:   'COMPLETED',    // handler succeeded
    FAILED:      'FAILED',       // handler threw — eligible for retry
    DEAD_LETTER: 'DEAD_LETTER'   // max attempts reached — parked permanently
  };

  // ──────────────────────────────────────────────────────────
  // INTAKE STATUSES
  // Valid values for STG_RAW_INTAKE.status.
  // IntakeService sets initial status; QueueProcessor updates
  // as it moves the submission through processing.
  // ──────────────────────────────────────────────────────────
  var INTAKE_STATUSES = {
    PENDING:   'PENDING',    // received, not yet enqueued
    QUEUED:    'QUEUED',     // written to STG_PROCESSING_QUEUE
    PROCESSED: 'PROCESSED',  // handler completed successfully
    FAILED:    'FAILED',     // terminal failure after all retries
    DUPLICATE: 'DUPLICATE'   // idempotency check detected re-submission
  };

  // ──────────────────────────────────────────────────────────
  // EXCEPTION SEVERITIES
  // Valid values for _SYS_EXCEPTIONS.severity.
  // ErrorHandler routes to different channels by severity.
  // ──────────────────────────────────────────────────────────
  var SEVERITIES = {
    WARNING:  'WARNING',   // degraded operation — logged, no alert
    ERROR:    'ERROR',     // handler failure — logged, admin notified
    CRITICAL: 'CRITICAL'  // data integrity risk — logged, CEO + admin notified
  };

  // ──────────────────────────────────────────────────────────
  // CURRENCIES
  // Valid values for DIM_CLIENT_MASTER.currency and all
  // financial FACT table currency columns.
  // ──────────────────────────────────────────────────────────
  var CURRENCIES = {
    CAD: 'CAD',
    USD: 'USD',
    INR: 'INR'
  };

  // ──────────────────────────────────────────────────────────
  // PERIOD FORMAT
  // Regex to validate period_id values (YYYY-MM).
  // Used by ValidationEngine and Identifiers.generatePeriodId().
  // ──────────────────────────────────────────────────────────
  var PERIOD_ID_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

  // ──────────────────────────────────────────────────────────
  // BOOLEAN DISPLAY VALUES
  // Normalised TRUE/FALSE strings used in Google Sheets
  // boolean columns (pay_design, pay_qc, bonus_eligible, active).
  // ──────────────────────────────────────────────────────────
  var BOOL = {
    TRUE:  'TRUE',
    FALSE: 'FALSE'
  };

  // ──────────────────────────────────────────────────────────
  // PUBLIC API
  // Expose all constants. No function arguments accepted —
  // constants are read-only frozen data.
  // ──────────────────────────────────────────────────────────
  return {
    EVENT_TYPES:     EVENT_TYPES,
    ROLES:           ROLES,
    QUEUE_STATUSES:  QUEUE_STATUSES,
    INTAKE_STATUSES: INTAKE_STATUSES,
    SEVERITIES:      SEVERITIES,
    CURRENCIES:      CURRENCIES,
    PERIOD_ID_REGEX: PERIOD_ID_REGEX,
    BOOL:            BOOL
  };

})();
