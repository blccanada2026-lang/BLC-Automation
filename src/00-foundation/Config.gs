// ============================================================
// Config.gs — BLC Nexus T0 Foundation
// src/00-foundation/Config.gs
//
// LOAD ORDER: First file loaded in every environment.
// DEPENDENCIES: None — this module has zero imports.
//
// Responsibilities:
//   1. Environment detection (DEV / STAGING / PROD)
//   2. Spreadsheet ID binding per environment
//   3. Runtime parameters (batch sizes, TTL, lock, logging)
//   4. Table name registry (all sheet names centralised)
//   5. System limits (retries, queue safety, quota guards)
//   6. State machine definitions (pure data — no sheet access)
//   7. System version constant
//
// HOW TO SET ENVIRONMENT:
//   Environment is detected automatically by matching the
//   active spreadsheet ID to the known IDs below.
//   Set SPREADSHEET_IDS.DEV / STAGING / PROD to the real
//   Google Sheets file IDs before deploying.
//   Falls back to DEV if no ID matches (safe default).
//
// DO NOT:
//   - Call SpreadsheetApp for data access (that is DAL's job)
//   - Call any other module (zero dependencies)
//   - Hardcode business logic (handlers own that)
// ============================================================

var Config = (function () {

  // ──────────────────────────────────────────────────────────
  // SYSTEM VERSION
  // Bump on every deployment. Recorded to _SYS_VERSION by
  // src/setup/VersionRecorder.gs during deploy.
  // ──────────────────────────────────────────────────────────
  var VERSION = '3.0.0';

  // ──────────────────────────────────────────────────────────
  // SPREADSHEET IDS
  // Replace placeholder strings with real Google Sheets file IDs.
  // Find the ID in the sheet URL:
  //   https://docs.google.com/spreadsheets/d/{ID}/edit
  //
  // Environment is detected by matching the active spreadsheet
  // ID to one of these values — no Script Properties needed.
  // ──────────────────────────────────────────────────────────
  var SPREADSHEET_IDS = {
    DEV:     '18f2sSSYhlK9vDAZ9-zbPf4mFOsVmBNDjofSYN6-b1CA',
    STAGING: 'REPLACE_WITH_STAGING_SPREADSHEET_ID',
    PROD:    '1B12PSkp9QNuPX4UIdOqZbad-cYouHCpQfX3ownRFLu0'
  };

  // ──────────────────────────────────────────────────────────
  // RUNTIME PARAMETERS
  // Mirrors config/environments/*.json.
  // All three environments defined here — active one selected
  // by detectEnvironment_() at module load time.
  // ──────────────────────────────────────────────────────────
  var RUNTIME = {

    DEV: {
      environment:     'DEV',
      loggingLevel:    'DEBUG',     // all log levels written
      protectionLevel: 'WARNING',   // sheets warn before edit, no hard lock

      triggers: {
        queueProcessorMinutes:  5,
        healthMonitorMinutes:  30,
        archivalHour:           2   // 2am SK time
      },

      batchSizes: {
        queueProcessor:  10,        // items per QueueProcessor run
        payrollChunk:     5,        // designers per payroll batch
        billingChunk:    10         // jobs per billing batch
      },

      cacheTtlSeconds:     300,     // 5 min — short for dev iteration
      lockTimeoutMs:     10000,     // 10s — relaxed for single-user dev
      // Quota ceiling for HealthMonitor — higher in DEV so test scripts
      // that chain multiple processQueue() calls don't trip the guard.
      // GAS real limit is thousands; this is a soft early-warning fence.
      quotaApiCallWarning: 500
    },

    STAGING: {
      environment:     'STAGING',
      loggingLevel:    'INFO',      // INFO, WARN, ERROR written
      protectionLevel: 'PROTECTED', // sheets locked to allowed writers only

      triggers: {
        queueProcessorMinutes:  5,
        healthMonitorMinutes:  15,
        archivalHour:           3
      },

      batchSizes: {
        queueProcessor:  15,
        payrollChunk:    10,
        billingChunk:    15
      },

      cacheTtlSeconds:     600,     // 10 min
      lockTimeoutMs:     20000,     // 20s
      quotaApiCallWarning: 300
    },

    PROD: {
      environment:     'PROD',
      loggingLevel:    'WARN',      // only WARN + ERROR in production logs
      protectionLevel: 'PROTECTED',

      triggers: {
        queueProcessorMinutes:  3,  // faster queue drain in prod
        healthMonitorMinutes:  10,
        archivalHour:           4
      },

      batchSizes: {
        queueProcessor:  20,        // max batch — full quota utilisation
        payrollChunk:    20,
        billingChunk:    20
      },

      cacheTtlSeconds:     900,     // 15 min — stable prod reference data
      lockTimeoutMs:     30000,     // 30s — concurrent triggers possible in prod
      quotaApiCallWarning: 200
    }

  };

  // ──────────────────────────────────────────────────────────
  // TABLES REGISTRY
  // Single source of truth for every sheet tab name in the
  // BLC Nexus spreadsheet.
  //
  // ALL DAL calls must reference these constants, never raw
  // string literals:
  //   DAL.getRows(Config.TABLES.FACT_JOB_EVENTS, ...)  ✅
  //   DAL.getRows('FACT_JOB_EVENTS', ...)              ❌
  //
  // Grouped by table type (matches SCHEMA_REFERENCE.md):
  //   SYS    → internal system tables (_SYS_ prefix)
  //   DIM    → dimension / reference tables (effective-dated)
  //   STG    → staging tables (transient queue)
  //   FACT   → append-only event ledgers (partitioned by period)
  //   VW     → computed view projections (rebuilt from FACTs)
  //   MART   → reporting aggregates (replaced on refresh)
  //
  // NOTE: FACT table tabs are partitioned — actual tab name is
  //   Config.TABLES.FACT_JOB_EVENTS + '|' + periodId
  //   e.g. 'FACT_JOB_EVENTS|2026-03'
  //   DAL.gs handles the partition suffix automatically.
  // ──────────────────────────────────────────────────────────
  var TABLES = {

    // System tables — managed exclusively by T3 infrastructure
    SYS_LOGS:          '_SYS_LOGS',
    SYS_EXCEPTIONS:    '_SYS_EXCEPTIONS',
    SYS_IDEMPOTENCY:   '_SYS_IDEMPOTENCY',
    SYS_VERSION:       '_SYS_VERSION',

    // Dimension tables — reference data, effective-dated
    DIM_STAFF_ROSTER:        'DIM_STAFF_ROSTER',
    DIM_CLIENT_MASTER:       'DIM_CLIENT_MASTER',
    DIM_CLIENT_RATES:        'DIM_CLIENT_RATES',   // per-client hourly rates (+ optional product override)
    DIM_PRODUCT_RATES:       'DIM_PRODUCT_RATES',  // legacy — superseded by DIM_CLIENT_RATES
    DIM_FX_RATES:            'DIM_FX_RATES',            // currency conversion rates (X→INR for payroll)
    DIM_STAFF_BANKING:       'DIM_STAFF_BANKING',       // OFX / wire transfer banking details per staff
    DIM_STAFF_CONTRACTS:     'DIM_STAFF_CONTRACTS',     // contractor agreement metadata + Google Doc URL
    STG_STAFF_IMPORT:        'STG_STAFF_IMPORT',        // bulk staff import staging sheet (migration use)
    STG_FEEDBACK_RESPONSES:  'STG_FEEDBACK_RESPONSES',  // Google Form response sheet (auto-created by FormApp)
    FACT_CLIENT_FEEDBACK:    'FACT_CLIENT_FEEDBACK',    // client feedback scores per designer per quarter
    DIM_SEQUENCE_COUNTERS:   'DIM_SEQUENCE_COUNTERS',
    REF_ACCOUNT_DESIGNER_MAP: 'REF_ACCOUNT_DESIGNER_MAP', // account team assignments: which designers belong to which client

    // Staging tables — transient queue (status-driven, not append-only)
    STG_RAW_INTAKE:        'STG_RAW_INTAKE',
    STG_PROCESSING_QUEUE:  'STG_PROCESSING_QUEUE',
    DEAD_LETTER_QUEUE:     'DEAD_LETTER_QUEUE',

    // Fact tables — append-only, partitioned by period_id
    // DAL appends '|YYYY-MM' suffix when reading/writing
    FACT_JOB_EVENTS:    'FACT_JOB_EVENTS',
    FACT_WORK_LOGS:     'FACT_WORK_LOGS',
    FACT_QC_EVENTS:     'FACT_QC_EVENTS',
    FACT_BILLING_LEDGER:'FACT_BILLING_LEDGER',
    FACT_PAYROLL_LEDGER:'FACT_PAYROLL_LEDGER',
    FACT_SOP_SUBMISSIONS:'FACT_SOP_SUBMISSIONS',
    FACT_PERFORMANCE_RATINGS: 'FACT_PERFORMANCE_RATINGS',
    FACT_QUARTERLY_BONUS:     'FACT_QUARTERLY_BONUS',     // quarterly + annual bonus calculations (separate from payroll)

    // View tables — projections rebuilt by EventReplayEngine
    // Not source of truth — can be fully replaced at any time
    VW_JOB_CURRENT_STATE:  'VW_JOB_CURRENT_STATE',
    VW_DESIGNER_WORKLOAD:  'VW_DESIGNER_WORKLOAD',

    // Mart tables — reporting aggregates for Looker Studio
    MART_DASHBOARD:        'MART_DASHBOARD',
    MART_BILLING_SUMMARY:  'MART_BILLING_SUMMARY',
    MART_PAYROLL_SUMMARY:  'MART_PAYROLL_SUMMARY',
    MART_TEAM_SUMMARY:     'MART_TEAM_SUMMARY',
    MART_DESIGNER_SUMMARY: 'MART_DESIGNER_SUMMARY',
    MART_ACCOUNT_SUMMARY:  'MART_ACCOUNT_SUMMARY',

    // Client intake — sheet-based bulk job intake per client
    // DIM_CLIENT_INTAKE_CONFIG: column mapping rules per client (source → target)
    // STG_INTAKE_{CLIENT}: one tab per client using their own column headers
    DIM_CLIENT_INTAKE_CONFIG: 'DIM_CLIENT_INTAKE_CONFIG',
    STG_INTAKE_SBS:           'STG_INTAKE_SBS',

    // Migration tables — used exclusively by src/12-migration/
    // Raw import landing zone, normalised staging, and audit trail
    // for the Stacey V2 → Nexus V3 migration.
    MIGRATION_RAW_IMPORT:       'MIGRATION_RAW_IMPORT',
    MIGRATION_NORMALIZED:       'MIGRATION_NORMALIZED',
    MIGRATION_AUDIT_LOG:        'MIGRATION_AUDIT_LOG',
    MIGRATION_EXCEPTION_REPORT: 'MIGRATION_EXCEPTION_REPORT'

  };

  // ──────────────────────────────────────────────────────────
  // STATE MACHINE DEFINITIONS
  // Source of truth for valid job states and transitions.
  // Mirrors config/state-machine.json exactly.
  // Consumed by src/06-job-lifecycle/StateMachine.gs —
  // that module reads Config.STATES and Config.TRANSITIONS,
  // never the JSON file directly (no UrlFetch needed).
  //
  // RULE: States added here must also be added to TRANSITIONS.
  // RULE: Terminal states must have an empty transitions array.
  // ──────────────────────────────────────────────────────────
  var STATES = {
    INTAKE_RECEIVED:    'INTAKE_RECEIVED',
    ALLOCATED:          'ALLOCATED',
    IN_PROGRESS:        'IN_PROGRESS',
    ON_HOLD:            'ON_HOLD',
    CLIENT_RETURN:      'CLIENT_RETURN',
    QC_REVIEW:          'QC_REVIEW',
    COMPLETED_BILLABLE: 'COMPLETED_BILLABLE',
    INVOICED:           'INVOICED'       // TERMINAL — no transitions out
  };

  // Which states can a job move TO from each state.
  // Empty array = terminal state (INVOICED).
  var TRANSITIONS = {
    INTAKE_RECEIVED:    ['ALLOCATED'],
    ALLOCATED:          ['IN_PROGRESS', 'ON_HOLD'],
    IN_PROGRESS:        ['ON_HOLD', 'QC_REVIEW', 'CLIENT_RETURN'],
    ON_HOLD:            ['IN_PROGRESS', 'ALLOCATED'],
    CLIENT_RETURN:      ['IN_PROGRESS', 'ALLOCATED'],
    QC_REVIEW:          ['IN_PROGRESS', 'COMPLETED_BILLABLE'],
    COMPLETED_BILLABLE: ['INVOICED'],
    INVOICED:           []              // terminal — StateMachine rejects all transitions
  };

  // State-specific business rules (enforced by StateMachine.gs).
  var STATE_RULES = {
    ON_HOLD: {
      description:       'Stores previous state in prev_state field for correct resume routing',
      requiresPrevState: true
    },
    INVOICED: {
      description: 'Terminal — immutable after this state. No transitions allowed.',
      terminal:    true,
      immutable:   true
    },
    CLIENT_RETURN: {
      description:     'Increments client_return_count, requires return reason',
      requiresReason:  true,
      incrementsCount: 'client_return_count'
    },
    QC_REVIEW: {
      description:          'Requires completed SOP checklist. Rework increments rework_cycle.',
      requiresSopChecklist: true,
      incrementsOnRework:   'rework_cycle'
    }
  };

  // ──────────────────────────────────────────────────────────
  // FORM TYPES
  // Handler routing keys — must match form_type values written
  // to STG_PROCESSING_QUEUE by IntakeService.gs.
  // ──────────────────────────────────────────────────────────
  var FORM_TYPES = {
    JOB_CREATE:    'JOB_CREATE',
    JOB_START:     'JOB_START',
    WORK_LOG:      'WORK_LOG',
    QC_SUBMIT:     'QC_SUBMIT',
    JOB_HOLD:      'JOB_HOLD',
    JOB_RESUME:    'JOB_RESUME',
    CLIENT_RETURN:    'CLIENT_RETURN',
    SOP_CHECKLIST:    'SOP_CHECKLIST',
    CLIENT_FEEDBACK:  'CLIENT_FEEDBACK'
  };

  // ──────────────────────────────────────────────────────────
  // ID GENERATION FORMATS
  // Prefix constants used by src/00-foundation/Identifiers.gs.
  // Format:  {PREFIX}-{YYYYMM}-{SEQUENCE}
  // Example: JOB-202603-00142
  // ──────────────────────────────────────────────────────────
  var ID_PREFIXES = {
    JOB:        'JOB',   // JOB-202603-00142
    WORK_LOG:   'WL',    // WL-202603-00891
    QC_EVENT:   'QC',    // QC-202603-00023
    INVOICE:    'INV',   // INV-202603-00007
    PAYROLL:    'PAY',   // PAY-202603-00015
    FEEDBACK:   'FB',    // FB-202602-00001   (client feedback event)
    PERF_RATING: 'PR',    // PR-202601-00001  (performance rating)
    SUBMISSION: 'SUB',   // SUB-202603-04421  (intake submission)
    QUEUE_ITEM: 'QI',    // QI-202603-09912   (queue entry)
    LOG_ENTRY:  'LOG',   // LOG-202603-55021  (system log)
    EXCEPTION:  'EXC'    // EXC-202603-00003  (system exception)
  };

  // ──────────────────────────────────────────────────────────
  // LOG LEVELS
  // Numeric values allow level comparison:
  //   Logger skips writing if entry level < active loggingLevel.
  // ──────────────────────────────────────────────────────────
  var LOG_LEVELS = {
    DEBUG: 0,
    INFO:  1,
    WARN:  2,
    ERROR: 3
  };

  // ──────────────────────────────────────────────────────────
  // LIMITS
  // System-wide safety thresholds — not per-environment.
  // These govern retry behaviour, quota protection, and queue
  // safety across all environments.
  //
  // Consumed by:
  //   RetryManager.gs     → maxQueueRetries, retryBackoffMs
  //   QueueProcessor.gs   → maxQueueDepthAlert, deadLetterAfterAttempts
  //   HealthMonitor.gs    → maxExecutionMs, quotaApiCallWarning
  //   ArchivalService.gs  → archiveAfterDays, purgeDeadLetterAfterDays
  //   IdempotencyEngine.gs → idempotencyTtlDays
  // ──────────────────────────────────────────────────────────
  var LIMITS = {

    // ── Queue retry behaviour ────────────────────────────
    // Number of processing attempts before a queue item is
    // moved to DEAD_LETTER_QUEUE.
    // Matches SYSTEM_ARCHITECTURE.md: "attempt_count >= 3 → DEAD_LETTER"
    deadLetterAfterAttempts: 3,

    // Maximum items held in STG_PROCESSING_QUEUE before
    // NotificationService alerts the admin.
    maxQueueDepthAlert: 100,

    // Exponential backoff base delay between retries (ms).
    // RetryManager multiplies by attempt_count:
    //   attempt 1 → 5s, attempt 2 → 10s, attempt 3 → dead letter
    retryBackoffBaseMs: 5000,

    // ── Quota and execution time guards ──────────────────
    // GAS hard limit is 6 minutes (360,000ms). Stop processing
    // at 5 minutes to leave a clean exit window.
    // HealthMonitor.isApproachingLimit() checks against this value.
    maxExecutionMs: 300000,       // 5 minutes

    // Number of Spreadsheet API calls before HealthMonitor
    // raises a WARN log. GAS paid workspace limit: ~200/execution.
    quotaApiCallWarning: 150,

    // ── Idempotency ──────────────────────────────────────
    // How long idempotency keys are retained in _SYS_IDEMPOTENCY
    // before they can be purged. Must be longer than any realistic
    // form resubmission window.
    idempotencyTtlDays: 30,

    // ── Archival ─────────────────────────────────────────
    // FACT table partitions older than this are moved to archive tabs.
    // ArchivalService.gs reads this value — do not hardcode in the service.
    archiveAfterDays: 60,         // ~2 months of live data per partition

    // Dead letter queue items older than this are eligible for
    // purge after manual review.
    purgeDeadLetterAfterDays: 7,

    // ── Financial safety ─────────────────────────────────
    // Maximum designers processed in a single payroll run before
    // HealthMonitor forces a checkpoint. Prevents quota exhaustion
    // mid-run on large rosters.
    payrollQuotaCheckEvery: 20,

    // Maximum billing jobs processed per run before checkpoint.
    billingQuotaCheckEvery: 20

  };

  // ──────────────────────────────────────────────────────────
  // PRIVATE: ENVIRONMENT DETECTION
  //
  // Detection strategy: Spreadsheet ID match only.
  //   Compares SpreadsheetApp.getActiveSpreadsheet().getId()
  //   against the known IDs registered in SPREADSHEET_IDS.
  //
  // Fallback: DEV — safe default. The script can never
  //   accidentally operate as PROD if an ID is unrecognised.
  //
  // Trigger context: getActiveSpreadsheet() returns null when
  //   the trigger is time-based and not UI-bound. The try/catch
  //   handles this gracefully — falls back to DEV.
  // ──────────────────────────────────────────────────────────
  function detectEnvironment_() {
    try {
      var activeId = SpreadsheetApp.getActiveSpreadsheet().getId();
      if (activeId === SPREADSHEET_IDS.PROD)    return 'PROD';
      if (activeId === SPREADSHEET_IDS.STAGING) return 'STAGING';
      if (activeId === SPREADSHEET_IDS.DEV)     return 'DEV';
    } catch (e) {
      // No active spreadsheet (time-based trigger context)
      // Fall through to DEV default below
    }

    // Safe fallback — never accidentally runs as PROD
    return 'DEV';
  }

  // ──────────────────────────────────────────────────────────
  // CACHED ENVIRONMENT (resolved once per execution)
  // GAS executions are single-threaded and short-lived —
  // resolving at module load time is safe and avoids
  // repeated SpreadsheetApp calls inside hot paths.
  // ──────────────────────────────────────────────────────────
  var _env     = detectEnvironment_();
  var _runtime = RUNTIME[_env];

  // ──────────────────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────────────────

  /**
   * Returns the active environment string: 'DEV' | 'STAGING' | 'PROD'
   */
  function getEnvironment() {
    return _env;
  }

  /**
   * Returns the spreadsheet ID for the active environment.
   * Used by DAL.gs to open the correct spreadsheet.
   */
  function getSpreadsheetId() {
    return SPREADSHEET_IDS[_env];
  }

  /**
   * Returns a runtime parameter for the active environment.
   * @param {string} key - e.g. 'loggingLevel', 'cacheTtlSeconds', 'lockTimeoutMs'
   * @param {*} defaultValue - returned if key not found
   */
  function get(key, defaultValue) {
    var val = _runtime[key];
    return (val !== undefined) ? val : (defaultValue !== undefined ? defaultValue : null);
  }

  /**
   * Returns batch size for the given processor type.
   * @param {string} processor - 'queueProcessor' | 'payrollChunk' | 'billingChunk'
   */
  function getBatchSize(processor) {
    return (_runtime.batchSizes && _runtime.batchSizes[processor])
      ? _runtime.batchSizes[processor]
      : 10;  // safe default
  }

  /**
   * Returns trigger frequency config.
   * @param {string} trigger - 'queueProcessorMinutes' | 'healthMonitorMinutes' | 'archivalHour'
   */
  function getTriggerFrequency(trigger) {
    return (_runtime.triggers && _runtime.triggers[trigger])
      ? _runtime.triggers[trigger]
      : null;
  }

  /**
   * Returns the numeric log level threshold for the active environment.
   * Logger.gs uses this to suppress lower-priority entries.
   */
  function getLogLevel() {
    var levelName = _runtime.loggingLevel || 'INFO';
    return LOG_LEVELS.hasOwnProperty(levelName) ? LOG_LEVELS[levelName] : LOG_LEVELS.INFO;
  }

  /**
   * Returns true if the given log level name should be written
   * in the current environment.
   * @param {string} levelName - 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
   */
  function isLogLevelActive(levelName) {
    var entryLevel = LOG_LEVELS.hasOwnProperty(levelName) ? LOG_LEVELS[levelName] : 0;
    return entryLevel >= getLogLevel();
  }

  /**
   * Returns true if this is a production environment.
   * Guards destructive operations in AdminConsole and ArchivalService.
   */
  function isProduction() {
    return _env === 'PROD';
  }

  /**
   * Returns true if this is the DEV environment.
   * Used by test harness and setup scripts.
   */
  function isDev() {
    return _env === 'DEV';
  }

  /**
   * Returns all allowed transitions from a given state.
   * Consumed by StateMachine.gs (T6) — never access TRANSITIONS directly.
   * @param {string} state - a STATES value
   * @returns {string[]} array of valid next states (empty if terminal)
   */
  function getAllowedTransitions(state) {
    return TRANSITIONS.hasOwnProperty(state) ? TRANSITIONS[state].slice() : [];
  }

  /**
   * Returns true if a state→nextState transition is valid.
   * @param {string} fromState
   * @param {string} toState
   */
  function isTransitionValid(fromState, toState) {
    var allowed = getAllowedTransitions(fromState);
    for (var i = 0; i < allowed.length; i++) {
      if (allowed[i] === toState) return true;
    }
    return false;
  }

  /**
   * Returns the business rule config for a given state, or null if none.
   * @param {string} state
   */
  function getStateRule(state) {
    return STATE_RULES.hasOwnProperty(state) ? STATE_RULES[state] : null;
  }

  // ──────────────────────────────────────────────────────────
  // PUBLIC INTERFACE
  // ──────────────────────────────────────────────────────────
  return {

    // System
    VERSION: VERSION,

    // Environment
    getEnvironment:      getEnvironment,
    getSpreadsheetId:    getSpreadsheetId,
    isProduction:        isProduction,
    isDev:               isDev,

    // Runtime parameters
    get:                 get,
    getBatchSize:        getBatchSize,
    getTriggerFrequency: getTriggerFrequency,

    // Logging
    getLogLevel:         getLogLevel,
    isLogLevelActive:    isLogLevelActive,
    LOG_LEVELS:          LOG_LEVELS,

    // Table name registry
    TABLES:              TABLES,

    // System limits
    LIMITS:              LIMITS,

    // State machine
    STATES:              STATES,
    TRANSITIONS:         TRANSITIONS,
    getAllowedTransitions: getAllowedTransitions,
    isTransitionValid:   isTransitionValid,
    getStateRule:        getStateRule,

    // Routing / ID constants
    FORM_TYPES:          FORM_TYPES,
    ID_PREFIXES:         ID_PREFIXES

  };

})();
