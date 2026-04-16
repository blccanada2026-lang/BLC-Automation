// ============================================================
// DAL.gs — BLC Nexus T1 Data Access Layer
// src/01-dal/DAL.gs
//
// LOAD ORDER: First file in T1. Loads after all T0 files.
// DEPENDENCIES: Config (T0), Identifiers (T0)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  THIS IS THE ONLY MODULE ALLOWED TO USE SpreadsheetApp  ║
// ║  Every other module accesses data through DAL methods.  ║
// ╚══════════════════════════════════════════════════════════╝
//
// Responsibilities:
//   1. Open and cache the correct spreadsheet for the environment
//   2. Resolve partitioned table names (FACT_*|YYYY-MM)
//   3. Read rows as plain objects (header-row-to-key mapping)
//   4. Write rows from plain objects (key-to-column mapping)
//   5. Enforce WriteGuard — only authorised modules may write
//   6. Enforce Rule A5 — FACT tables are append-only (no updates)
//   7. Track SpreadsheetApp API call count for HealthMonitor
//   8. Provide a logging bridge for Logger.gs (T3)
//
// PUBLIC API:
//   DAL.readAll(tableName, options)
//   DAL.readWhere(tableName, conditions, options)
//   DAL.appendRow(tableName, data, options)
//   DAL.appendRows(tableName, dataArray, options)
//   DAL.updateWhere(tableName, conditions, updates, options)
//   DAL.ensurePartition(tableName, periodId, callerModule)
//   DAL.getApiCallCount()
//   DAL.setLogHook(fn)
//
// OPTIONS OBJECT (common across all methods):
//   options.callerModule {string} — REQUIRED for all writes.
//     Must match an entry in WRITE_PERMISSIONS for the table.
//   options.periodId {string} — Required for FACT table reads.
//     Format: YYYY-MM. Derived from data.period_id if omitted on writes.
//
// ERROR HANDLING:
//   All failures throw a DalError with:
//     .code    — machine-readable string (catch and branch on this)
//     .message — human-readable description
//     .context — object with relevant debug fields
//
// DO NOT:
//   - Call SpreadsheetApp anywhere outside this file
//   - Call Logger.gs directly (use the setLogHook bridge)
//   - Add business logic (that belongs in T6–T13 handlers)
//   - Cache rows across executions (GAS state is per-execution only)
// ============================================================

var DAL = (function () {

  // ──────────────────────────────────────────────────────────
  // WRITE GUARD — PERMISSION MATRIX
  //
  // Maps each base table name to the list of module names that
  // may write to it. Partition suffixes are stripped before lookup
  // so 'FACT_JOB_EVENTS|2026-03' checks against 'FACT_JOB_EVENTS'.
  //
  // To authorise a new module:
  //   1. Add the module name to the relevant array below
  //   2. Update docs/SYSTEM_ARCHITECTURE.md
  //   3. Add a test in tests/dal.test.js for the new permission
  //
  // The matrix is intentionally strict: an unlisted module throws.
  // This makes unauthorised writes visible immediately in DEV,
  // rather than silently bypassing the audit trail in PROD.
  // ──────────────────────────────────────────────────────────
  var WRITE_PERMISSIONS = {

    // ── System tables (T3 infrastructure only) ──────────────
    '_SYS_LOGS':             ['Logger'],
    '_SYS_EXCEPTIONS':       ['ErrorHandler'],
    '_SYS_IDEMPOTENCY':      ['IdempotencyEngine'],
    '_SYS_VERSION':          ['VersionRecorder', 'AdminEngine'],

    // ── Dimension tables (Admin + Migration only) ───────────
    'DIM_STAFF_ROSTER':         ['AdminEngine', 'MigrationEngine', 'StaffOnboarding'],
    'DIM_CLIENT_MASTER':        ['AdminEngine', 'MigrationEngine', 'ClientOnboarding'],
    'DIM_CLIENT_RATES':         ['AdminEngine', 'MigrationEngine', 'ClientOnboarding'],
    'DIM_FX_RATES':             ['AdminEngine', 'MigrationEngine'],
    'DIM_STAFF_BANKING':        ['AdminEngine', 'MigrationEngine', 'StaffOnboarding'],
    'DIM_STAFF_CONTRACTS':      ['AdminEngine', 'MigrationEngine', 'StaffOnboarding'],
    'STG_STAFF_IMPORT':         ['StaffOnboarding'],    // bulk import staging — status written back per row
    'STG_INTAKE_SBS':           ['SheetAdapter'],       // SBS job intake staging — status written back per row
    'FACT_CLIENT_FEEDBACK':     ['ClientFeedback'],          // feedback scores — written by ClientFeedback handler
    'FACT_PERFORMANCE_RATINGS': ['PortalData'],              // TL/PM quarterly ratings — written via portal
    'FACT_QUARTERLY_BONUS':     ['QuarterlyBonusEngine'],   // quarterly + annual bonus calculations
    'DIM_PRODUCT_RATES':        ['AdminEngine', 'MigrationEngine'],
    'DIM_SEQUENCE_COUNTERS':    ['JobCreateHandler', 'AdminEngine'],

    // ── Staging tables (Intake + Queue only) ────────────────
    'STG_RAW_INTAKE':        ['IntakeService'],
    'STG_PROCESSING_QUEUE':  ['IntakeService', 'QueueProcessor', 'RetryManager', 'PortalData'],
    'DEAD_LETTER_QUEUE':     ['DeadLetterHandler', 'QueueProcessor'],

    // ── FACT tables (handlers + migration only) ─────────────
    // These tables are append-only (Rule A5). updateWhere() is
    // hard-blocked regardless of what callerModule is passed.
    'FACT_JOB_EVENTS':       ['JobCreateHandler', 'JobStartHandler', 'JobHoldHandler',
                              'JobResumeHandler', 'ClientReturnHandler',
                              'EventReplayEngine', 'MigrationEngine'],
    'FACT_WORK_LOGS':        ['WorkLogHandler', 'MigrationEngine'],
    'FACT_QC_EVENTS':        ['QCHandler', 'MigrationEngine'],
    'FACT_BILLING_LEDGER':   ['BillingEngine', 'MigrationEngine'],
    'FACT_PAYROLL_LEDGER':   ['PayrollEngine', 'MigrationEngine'],
    'FACT_SOP_SUBMISSIONS':  ['SOPHandler', 'MigrationEngine'],

    // ── View tables (rebuilt projections) ───────────────────
    'VW_JOB_CURRENT_STATE':  ['EventReplayEngine', 'JobCreateHandler', 'JobStartHandler',
                              'JobHoldHandler', 'JobResumeHandler', 'ClientReturnHandler', 'QCHandler',
                              'BillingEngine'],
    'VW_DESIGNER_WORKLOAD':  ['EventReplayEngine', 'ReportingEngine'],

    // ── Mart tables (reporting aggregates) ──────────────────
    'MART_DASHBOARD':        ['ReportingEngine', 'DashboardService'],
    'MART_BILLING_SUMMARY':  ['BillingEngine', 'ReportingEngine'],
    'MART_PAYROLL_SUMMARY':  ['PayrollEngine', 'ReportingEngine'],
    'MART_TEAM_SUMMARY':     ['ReportingEngine'],
    'MART_DESIGNER_SUMMARY': ['ReportingEngine'],
    'MART_ACCOUNT_SUMMARY':  ['ReportingEngine'],

  };

  // ──────────────────────────────────────────────────────────
  // PARTITION MAP
  // Tables whose tab names include a |YYYY-MM period suffix.
  // All FACT tables are partitioned. No others are.
  // ──────────────────────────────────────────────────────────
  var PARTITIONED_TABLES = {
    'FACT_JOB_EVENTS':      true,
    'FACT_WORK_LOGS':       true,
    'FACT_QC_EVENTS':       true,
    'FACT_BILLING_LEDGER':  true,
    'FACT_PAYROLL_LEDGER':  true,
    'FACT_SOP_SUBMISSIONS': true
  };

  // FACT tables are the same set as partitioned tables here.
  // Named separately for Rule A5 enforcement clarity.
  var FACT_TABLES = PARTITIONED_TABLES;

  // ──────────────────────────────────────────────────────────
  // PRIVATE STATE (per execution — reset on each GAS invocation)
  // ──────────────────────────────────────────────────────────
  var _ss           = null;   // cached Spreadsheet reference
  var _apiCallCount = 0;      // SpreadsheetApp call counter
  var _logHook      = null;   // registered by Logger.gs (T3)

  // ============================================================
  // SECTION 1: INTERNAL ERROR TYPE
  // ============================================================

  /**
   * Structured DAL error.
   * Callers should catch and branch on err.code, not err.message.
   *
   * @param {string} code     Machine-readable identifier (SCREAMING_SNAKE_CASE)
   * @param {string} message  Human-readable explanation
   * @param {Object} context  Debug fields { tableName, callerModule, ... }
   */
  function DalError_(code, message, context) {
    this.name    = 'DalError';
    this.code    = code;
    this.message = '[DAL:' + code + '] ' + message;
    this.context = context || {};
    this.stack   = (new Error()).stack;
  }
  DalError_.prototype = Object.create(Error.prototype);
  DalError_.prototype.constructor = DalError_;

  // ============================================================
  // SECTION 2: LOGGING BRIDGE
  //
  // DAL emits events at INFO/WARN/ERROR level. Until Logger.gs
  // registers a hook via setLogHook(), these are:
  //   INFO  → silent (no-op)
  //   WARN  → GAS native Logger.log (visible in execution log)
  //   ERROR → GAS native Logger.log
  //
  // This design avoids a circular dependency:
  //   Logger.gs writes to _SYS_LOGS via DAL.appendRow
  //   DAL must NOT call Logger.gs during those writes
  //   The hook pattern breaks the cycle — Logger registers
  //   after it is initialised, then DAL routes through it.
  // ============================================================

  /**
   * Emits an internal DAL event through the registered log hook.
   * Safe to call at any point — hook failures are swallowed to
   * prevent logging errors from masking the original operation.
   *
   * @param {string} level   'INFO' | 'WARN' | 'ERROR'
   * @param {string} action  Event identifier  e.g. 'APPEND_ROW'
   * @param {Object} context Additional debug fields
   */
  function emit_(level, action, context) {
    if (_logHook) {
      try { _logHook(level, action, context); }
      catch (e) { /* hook must not throw — swallow silently */ }
      return;
    }
    // Fallback: GAS native log for WARN and ERROR before Logger is registered
    if (level === 'WARN' || level === 'ERROR') {
      Logger.log('[DAL ' + level + '] ' + action + ' — ' + JSON.stringify(context || {}));
    }
  }

  // ============================================================
  // SECTION 3: SPREADSHEET ACCESS
  // ============================================================

  /**
   * Returns the Spreadsheet for the active environment.
   * Cached after the first call — one openById() per execution.
   * Uses Config.getSpreadsheetId() which reads from SPREADSHEET_IDS
   * matched to the detected environment.
   */
  function getSpreadsheet_() {
    if (_ss) return _ss;
    trackApiCall_();
    _ss = SpreadsheetApp.openById(Config.getSpreadsheetId());
    return _ss;
  }

  /** Increments the SpreadsheetApp API call counter. */
  function trackApiCall_() {
    _apiCallCount++;
  }

  // ============================================================
  // SECTION 4: TABLE AND PARTITION RESOLUTION
  // ============================================================

  /** Returns true if tableName is in the PARTITIONED_TABLES map. */
  function isPartitioned_(tableName) {
    return PARTITIONED_TABLES.hasOwnProperty(tableName);
  }

  /** Returns true if tableName is in the FACT_TABLES map (append-only). */
  function isFactTable_(tableName) {
    return FACT_TABLES.hasOwnProperty(tableName);
  }

  /**
   * Resolves the actual Google Sheets tab name for a table.
   *
   * Non-partitioned: returns tableName unchanged.
   * Partitioned (FACT_*): returns tableName + '|' + periodId.
   *   e.g. 'FACT_JOB_EVENTS' + '2026-03' → 'FACT_JOB_EVENTS|2026-03'
   *
   * If periodId is not provided for a partitioned table, defaults
   * to the current period (Identifiers.generateCurrentPeriodId()).
   */
  function resolveTabName_(tableName, periodId) {
    if (!isPartitioned_(tableName)) return tableName;
    var pid = periodId || Identifiers.generateCurrentPeriodId();
    return Identifiers.generatePartitionTabName(tableName, pid);
  }

  /**
   * Returns the Sheet object for a given tab name, or null.
   * Counts as one API call.
   */
  function getSheet_(tabName) {
    trackApiCall_();
    return getSpreadsheet_().getSheetByName(tabName);
  }

  /**
   * Returns the Sheet object, throwing DalError if the tab does not exist.
   * @param {string} tabName    Fully resolved tab name (with partition if applicable)
   * @param {string} tableName  Base table name (for error context only)
   */
  function requireSheet_(tabName, tableName) {
    var sheet = getSheet_(tabName);
    if (!sheet) {
      throw new DalError_(
        'SHEET_NOT_FOUND',
        'Sheet tab "' + tabName + '" does not exist. ' +
        (isPartitioned_(tableName)
          ? 'For FACT tables, call DAL.ensurePartition() before the first write of a new period.'
          : 'Verify the sheet name in Config.TABLES and that the tab exists in the spreadsheet.'),
        { tableName: tableName, tabName: tabName }
      );
    }
    return sheet;
  }

  // ============================================================
  // SECTION 5: ROW ↔ OBJECT CONVERSION
  //
  // BLC Nexus uses a header-row convention:
  //   Row 1: column names (e.g. ['job_number', 'period_id', 'event_type', ...])
  //   Row 2+: data values
  //
  // DAL reads row 1 as a key map, then converts each data row
  // to a plain object for the caller. On writes, the object is
  // converted back to an array in header order.
  //
  // This means:
  //   - Column order in the sheet does not matter to callers
  //   - Missing keys in the write object write as empty string
  //   - Extra keys in the write object are silently ignored
  // ============================================================

  /**
   * Reads the header row (row 1) from a sheet.
   * Returns an array of column name strings.
   * Empty / blank headers are included (positional placeholders).
   */
  function getHeaders_(sheet) {
    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) return [];
    trackApiCall_();
    return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  }

  /**
   * Converts a raw row array to a plain object using header names as keys.
   * Blank header cells are skipped (they hold no column name).
   * @param {string[]} headers  From getHeaders_()
   * @param {Array}    row      Raw values from getValues()
   * @returns {Object}
   */
  function rowToObject_(headers, row) {
    var obj = {};
    for (var i = 0; i < headers.length; i++) {
      if (headers[i] !== '' && headers[i] !== null && headers[i] !== undefined) {
        obj[headers[i]] = (row[i] !== undefined) ? row[i] : '';
      }
    }
    return obj;
  }

  /**
   * Converts a plain object to a row array ordered by headers.
   * Keys in obj that have no matching header are silently ignored.
   * Headers with no matching key in obj write as empty string.
   * @param {string[]} headers  From getHeaders_()
   * @param {Object}   obj      Data to write
   * @returns {Array}  Ready to pass to sheet.appendRow() or setValues()
   */
  function objectToRow_(headers, obj) {
    var row = [];
    for (var i = 0; i < headers.length; i++) {
      var key = headers[i];
      var val = (key && obj.hasOwnProperty(key)) ? obj[key] : '';
      // Convert null to empty string — Sheets API treats null as literal 'null'
      row.push(val === null ? '' : val);
    }
    return row;
  }

  // ============================================================
  // SECTION 6: CONDITION MATCHING
  // ============================================================

  /**
   * Returns true if rowObj satisfies every condition in conditions.
   * All conditions must match (AND semantics — no OR support).
   *
   * Comparison uses loose equality (==) because Google Sheets
   * may return numbers as strings or vice versa depending on
   * cell formatting. Callers that need strict type matching
   * should filter the results of readWhere() themselves.
   *
   * @param {Object} rowObj     Row as a plain object from rowToObject_()
   * @param {Object} conditions { column: expectedValue } pairs
   * @returns {boolean}
   */
  function matchesConditions_(rowObj, conditions) {
    for (var col in conditions) {
      if (!conditions.hasOwnProperty(col)) continue;
      // Loose equality handles '5' == 5 (common in Sheets data)
      /* jshint eqeqeq: false */
      if (rowObj[col] != conditions[col]) return false;
      /* jshint eqeqeq: true */
    }
    return true;
  }

  // ============================================================
  // SECTION 7: WRITE GUARD ENFORCEMENT
  // ============================================================

  /**
   * Checks that callerModule is authorised to write to tableName.
   * Throws DalError on any violation — never silently permits.
   *
   * The WriteGuard is enforced in ALL environments (DEV, STAGING,
   * PROD). This ensures module boundary violations are caught
   * during development, not discovered in production.
   *
   * @param {string} tableName    Base table name (no partition suffix)
   * @param {string} callerModule Name of the calling module
   * @throws {DalError_}
   */
  function enforceWriteGuard_(tableName, callerModule) {
    if (!callerModule || typeof callerModule !== 'string' || callerModule.trim() === '') {
      throw new DalError_(
        'WRITE_GUARD_NO_CALLER',
        'options.callerModule is required for all write operations. ' +
        'Pass the name of your module as a string (e.g. { callerModule: "JobCreateHandler" }).',
        { tableName: tableName }
      );
    }

    var allowed = WRITE_PERMISSIONS[tableName];

    if (!allowed) {
      throw new DalError_(
        'WRITE_GUARD_TABLE_NOT_REGISTERED',
        'Table "' + tableName + '" is not in the WRITE_PERMISSIONS matrix. ' +
        'Add it to DAL.gs before any module writes to it.',
        { tableName: tableName, callerModule: callerModule }
      );
    }

    for (var i = 0; i < allowed.length; i++) {
      if (allowed[i] === callerModule) return; // authorised — exit cleanly
    }

    throw new DalError_(
      'WRITE_GUARD_DENIED',
      '"' + callerModule + '" is not authorised to write to "' + tableName + '". ' +
      'Authorised modules: ' + allowed.join(', ') + '. ' +
      'If this module should have access, add it to WRITE_PERMISSIONS in DAL.gs.',
      { tableName: tableName, callerModule: callerModule, authorised: allowed }
    );
  }

  // ============================================================
  // SECTION 8: WRITE DATA VALIDATION
  //
  // DAL performs only basic structural validation before writes.
  // Full schema validation (required fields, types, business rules)
  // is the responsibility of ValidationEngine.gs (T4).
  //
  // DAL's checks:
  //   - data is a non-null plain object
  //   - data has at least one field
  //   - no field has an undefined value (undefined → probably a bug)
  //
  // Note: null is allowed (maps to empty string on write).
  // Note: empty string is allowed (explicit empty cell).
  // ============================================================

  /**
   * Basic structural validation of a write data object.
   * @param {string} tableName  For error context
   * @param {Object} data       The object being written
   * @throws {DalError_}
   */
  function validateWriteData_(tableName, data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new DalError_(
        'INVALID_WRITE_DATA',
        'Write data must be a plain object { column: value }. Received: ' + typeof data,
        { tableName: tableName }
      );
    }
    var keys = Object.keys(data);
    if (keys.length === 0) {
      throw new DalError_(
        'EMPTY_WRITE_DATA',
        'Write data object has no fields. Nothing to write to "' + tableName + '".',
        { tableName: tableName }
      );
    }
    for (var i = 0; i < keys.length; i++) {
      if (data[keys[i]] === undefined) {
        throw new DalError_(
          'UNDEFINED_FIELD_VALUE',
          'Field "' + keys[i] + '" is undefined in write data for "' + tableName + '". ' +
          'Use null or empty string for intentionally blank fields.',
          { tableName: tableName, field: keys[i] }
        );
      }
    }
  }

  // ============================================================
  // SECTION 9: PERIOD ID RESOLUTION
  //
  // For FACT table writes, the period_id determines which partition
  // tab receives the row. Resolution priority:
  //   1. options.periodId  (explicit — use this when you know the period)
  //   2. data.period_id    (from the row data itself — most common case)
  //   3. current period    (fallback — today's YYYY-MM via Identifiers)
  //
  // For reads, the same priority applies except there is no data object.
  // ============================================================

  /**
   * Resolves the period_id to use for a FACT table operation.
   * @param {Object|null} data     Write data object (may contain period_id)
   * @param {Object}      options  May contain options.periodId
   * @returns {string}  YYYY-MM format period identifier
   */
  function resolvePeriodId_(data, options) {
    if (options && options.periodId) return options.periodId;
    if (data && data.period_id)     return data.period_id;
    return Identifiers.generateCurrentPeriodId();
  }

  // ============================================================
  // SECTION 10: PUBLIC — READ ALL
  // ============================================================

  /**
   * Reads all data rows from a table as an array of plain objects.
   * Row 1 (headers) is used to key the objects. Row 2 onward is data.
   *
   * For FACT tables: reads from the partition matching options.periodId.
   * If periodId is not provided, defaults to the current period and
   * emits a WARN log (ambiguous reads should always specify a period).
   *
   * @param {string}  tableName        A Config.TABLES constant value
   * @param {Object}  [options]
   * @param {string}  [options.periodId]  YYYY-MM period for FACT tables
   * @returns {Object[]}  Array of row objects. Empty array if no data rows.
   * @throws  {DalError_}  SHEET_NOT_FOUND if the tab does not exist
   *
   * @example
   *   var staff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER);
   *   var aprilJobs = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS, { periodId: '2026-04' });
   */
  function readAll(tableName, options) {
    options = options || {};

    var periodId = isPartitioned_(tableName) ? resolvePeriodId_(null, options) : null;

    // Warn when periodId is defaulted for a partitioned table read
    if (isPartitioned_(tableName) && !options.periodId) {
      emit_('WARN', 'READ_ALL_NO_PERIOD', {
        tableName: tableName,
        defaulting: periodId,
        hint: 'Pass options.periodId to read a specific partition explicitly.'
      });
    }

    var tabName = resolveTabName_(tableName, periodId);
    var sheet   = requireSheet_(tabName, tableName);
    var lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      // Sheet exists but has only a header row (or is completely empty)
      emit_('INFO', 'READ_ALL_EMPTY', { tableName: tableName, tabName: tabName });
      return [];
    }

    var headers = getHeaders_(sheet);
    trackApiCall_();
    var rawRows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

    var result = [];
    for (var i = 0; i < rawRows.length; i++) {
      result.push(rowToObject_(headers, rawRows[i]));
    }

    emit_('INFO', 'READ_ALL', {
      tableName: tableName,
      tabName:   tabName,
      rowCount:  result.length
    });
    return result;
  }

  // ============================================================
  // SECTION 11: PUBLIC — READ WHERE
  // ============================================================

  /**
   * Reads all rows matching the given conditions (AND semantics).
   * Internally calls readAll() and filters in memory.
   *
   * @param {string}  tableName
   * @param {Object}  conditions  { columnName: value } — ALL must match
   * @param {Object}  [options]
   * @param {string}  [options.periodId]  YYYY-MM for FACT table reads
   * @returns {Object[]}  Matching rows. Empty array if none match.
   * @throws  {DalError_}  INVALID_CONDITIONS if conditions is not an object
   *
   * @example
   *   var pending = DAL.readWhere(Config.TABLES.STG_PROCESSING_QUEUE,
   *                               { status: 'PENDING' });
   *
   *   var designerRows = DAL.readWhere(Config.TABLES.FACT_WORK_LOGS,
   *                                    { person_code: 'SGO', period_id: '2026-03' },
   *                                    { periodId: '2026-03' });
   */
  function readWhere(tableName, conditions, options) {
    options = options || {};

    if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) {
      throw new DalError_(
        'INVALID_CONDITIONS',
        'conditions must be a plain object { column: value }. Received: ' + typeof conditions,
        { tableName: tableName }
      );
    }

    var all     = readAll(tableName, options);
    var matches = [];
    for (var i = 0; i < all.length; i++) {
      if (matchesConditions_(all[i], conditions)) {
        matches.push(all[i]);
      }
    }

    emit_('INFO', 'READ_WHERE', {
      tableName:  tableName,
      conditions: conditions,
      matched:    matches.length,
      scanned:    all.length
    });
    return matches;
  }

  // ============================================================
  // SECTION 12: PUBLIC — APPEND ROW
  // ============================================================

  /**
   * Appends a single row to a table.
   *
   * For FACT tables: writes to the partition for the row's period_id.
   * Resolution order: options.periodId → data.period_id → current period.
   *
   * @param {string}  tableName
   * @param {Object}  data             Row data as { columnName: value }
   * @param {Object}  options
   * @param {string}  options.callerModule  REQUIRED — name of calling module
   * @param {string}  [options.periodId]    YYYY-MM for FACT tables
   * @throws {DalError_}  WRITE_GUARD_DENIED, SHEET_NOT_FOUND, INVALID_WRITE_DATA
   *
   * @example
   *   DAL.appendRow(Config.TABLES.FACT_JOB_EVENTS, eventRow,
   *                 { callerModule: 'JobCreateHandler', periodId: '2026-04' });
   *
   *   DAL.appendRow(Config.TABLES.STG_RAW_INTAKE, intakeRow,
   *                 { callerModule: 'IntakeService' });
   */
  function appendRow(tableName, data, options) {
    options = options || {};

    validateWriteData_(tableName, data);
    enforceWriteGuard_(tableName, options.callerModule);

    var periodId = isPartitioned_(tableName) ? resolvePeriodId_(data, options) : null;
    var tabName  = resolveTabName_(tableName, periodId);
    var sheet    = requireSheet_(tabName, tableName);
    var headers  = getHeaders_(sheet);
    var row      = objectToRow_(headers, data);

    trackApiCall_();
    sheet.appendRow(row);

    emit_('INFO', 'APPEND_ROW', {
      tableName:    tableName,
      tabName:      tabName,
      callerModule: options.callerModule
    });
  }

  // ============================================================
  // SECTION 13: PUBLIC — APPEND ROWS (BULK WRITE)
  //
  // Writes multiple rows in a single setValues() call — one API
  // quota hit regardless of how many rows are in the batch.
  //
  // For very large batches (> 50 rows), callers should use
  // BatchOperations.gs (T1) which chunks the array and checks
  // HealthMonitor between chunks. This method does not chunk.
  // ============================================================

  /**
   * Appends multiple rows to a table in a single API call.
   * All rows must target the same partition (same period_id).
   *
   * @param {string}    tableName
   * @param {Object[]}  dataArray        Non-empty array of row objects
   * @param {Object}    options
   * @param {string}    options.callerModule  REQUIRED
   * @param {string}    [options.periodId]    YYYY-MM for FACT tables.
   *   If omitted, period is derived from dataArray[0].period_id.
   *   All rows in the array must belong to the same period.
   * @throws {DalError_}  INVALID_BULK_DATA if array is empty or not an array
   *
   * @example
   *   DAL.appendRows(Config.TABLES.FACT_PAYROLL_LEDGER, payrollRows,
   *                  { callerModule: 'PayrollEngine', periodId: '2026-04' });
   */
  function appendRows(tableName, dataArray, options) {
    options = options || {};

    if (!Array.isArray(dataArray) || dataArray.length === 0) {
      throw new DalError_(
        'INVALID_BULK_DATA',
        'appendRows requires a non-empty array of row objects. ' +
        'Use appendRow() for single-row writes.',
        { tableName: tableName, received: typeof dataArray }
      );
    }

    // Validate and guard before touching the sheet
    enforceWriteGuard_(tableName, options.callerModule);
    for (var v = 0; v < dataArray.length; v++) {
      validateWriteData_(tableName, dataArray[v]);
    }

    // Period is resolved from options or first row — all rows assumed same period
    var periodId = isPartitioned_(tableName) ? resolvePeriodId_(dataArray[0], options) : null;
    var tabName  = resolveTabName_(tableName, periodId);
    var sheet    = requireSheet_(tabName, tableName);
    var headers  = getHeaders_(sheet);

    // Convert all objects to row arrays in one pass
    var rows = [];
    for (var i = 0; i < dataArray.length; i++) {
      rows.push(objectToRow_(headers, dataArray[i]));
    }

    // One setValues() call — O(1) API quota regardless of row count
    var startRow = sheet.getLastRow() + 1;
    trackApiCall_();
    sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);

    emit_('INFO', 'APPEND_ROWS', {
      tableName:    tableName,
      tabName:      tabName,
      rowCount:     rows.length,
      callerModule: options.callerModule
    });
  }

  // ============================================================
  // SECTION 14: PUBLIC — UPDATE WHERE
  //
  // Updates fields on rows matching conditions.
  //
  // !! FACT TABLES ARE HARD-BLOCKED — RULE A5 !!
  //    Corrections to FACT data must be new amendment events.
  //    This method throws immediately if called on any FACT table,
  //    regardless of callerModule or any other option.
  //
  // For high-volume updates (> 20 rows), consider loading all
  // rows, modifying in memory, and replacing the entire sheet
  // range in one setValues() call instead.
  // ============================================================

  /**
   * Updates fields on all rows that match conditions.
   * Allowed only on STG, DIM, VW, and MART tables.
   * FACT tables throw unconditionally (Rule A5).
   *
   * @param {string}  tableName
   * @param {Object}  conditions  { column: value } — rows to update
   * @param {Object}  updates     { column: newValue } — fields to overwrite
   * @param {Object}  options
   * @param {string}  options.callerModule  REQUIRED
   * @returns {{ updated: number }}  Count of rows that were modified
   * @throws  {DalError_}  FACT_UPDATE_FORBIDDEN on any FACT table
   *
   * @example
   *   DAL.updateWhere(Config.TABLES.STG_PROCESSING_QUEUE,
   *                   { queue_id: item.queue_id },
   *                   { status: 'COMPLETED', completed_at: new Date() },
   *                   { callerModule: 'QueueProcessor' });
   */
  function updateWhere(tableName, conditions, updates, options) {
    options = options || {};

    // ── Rule A5 hard stop ──────────────────────────────────
    if (isFactTable_(tableName)) {
      throw new DalError_(
        'FACT_UPDATE_FORBIDDEN',
        'updateWhere() is forbidden on FACT table "' + tableName + '". ' +
        'FACT tables are append-only (Rule A5). ' +
        'Write a correction as a new amendment event instead. ' +
        'e.g. event_type: "WORK_LOG_AMENDED" with amendment_of: originalId.',
        { tableName: tableName, callerModule: options.callerModule }
      );
    }

    if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) {
      throw new DalError_(
        'INVALID_CONDITIONS',
        'conditions must be a plain object { column: value }',
        { tableName: tableName }
      );
    }
    if (!updates || typeof updates !== 'object' || Array.isArray(updates) ||
        Object.keys(updates).length === 0) {
      throw new DalError_(
        'INVALID_UPDATES',
        'updates must be a non-empty plain object { column: newValue }',
        { tableName: tableName }
      );
    }

    enforceWriteGuard_(tableName, options.callerModule);

    var sheet   = requireSheet_(tableName, tableName);
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return { updated: 0 };
    }

    var headers = getHeaders_(sheet);
    trackApiCall_();
    var allValues = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

    // Build a column-name → index map for O(1) update lookups
    var colIndex = {};
    for (var h = 0; h < headers.length; h++) {
      if (headers[h]) colIndex[headers[h]] = h;
    }

    // Identify matching rows and apply updates in memory
    var changedRows = [];
    for (var r = 0; r < allValues.length; r++) {
      var rowObj = rowToObject_(headers, allValues[r]);
      if (!matchesConditions_(rowObj, conditions)) continue;

      for (var col in updates) {
        if (updates.hasOwnProperty(col) && colIndex.hasOwnProperty(col)) {
          allValues[r][colIndex[col]] = (updates[col] === null) ? '' : updates[col];
        }
      }
      changedRows.push({ sheetRow: r + 2, values: allValues[r] });
                        // +1 for 1-based index, +1 for header row
    }

    // Write each updated row back to the sheet
    // Each call is one API quota unit — keep batches small.
    // For bulk updates, callers should prefer full-range replacement.
    for (var u = 0; u < changedRows.length; u++) {
      trackApiCall_();
      sheet.getRange(changedRows[u].sheetRow, 1, 1, headers.length)
           .setValues([changedRows[u].values]);
    }

    emit_('INFO', 'UPDATE_WHERE', {
      tableName:    tableName,
      conditions:   conditions,
      updated:      changedRows.length,
      callerModule: options.callerModule
    });

    return { updated: changedRows.length };
  }

  // ============================================================
  // SECTION 15: PUBLIC — ENSURE PARTITION
  //
  // Creates a FACT table partition tab if it does not already exist.
  // Must be called before the first appendRow/appendRows of a new
  // billing period. Typically invoked by a monthly PartitionProvisioner
  // trigger, or by AdminEngine during manual period setup.
  //
  // Header row strategy:
  //   1. Find the most recent existing partition for the same table
  //   2. Copy its header row to the new tab
  //   3. If no existing partition exists (first-ever deployment),
  //      create an empty tab — SetupScript must add the header row.
  // ============================================================

  /**
   * Ensures a partition tab exists for a FACT table and period.
   * Safe to call multiple times — idempotent (no-op if tab exists).
   *
   * @param {string}  tableName     A partitioned FACT table name
   * @param {string}  periodId      YYYY-MM format
   * @param {string}  callerModule  Must be in WRITE_PERMISSIONS for tableName
   * @returns {{ created: boolean, tabName: string }}
   * @throws  {DalError_}  NOT_PARTITIONED_TABLE, WRITE_GUARD_DENIED
   *
   * @example
   *   // Called by PartitionProvisioner at start of each month:
   *   DAL.ensurePartition(Config.TABLES.FACT_JOB_EVENTS, '2026-05', 'AdminEngine');
   */
  function ensurePartition(tableName, periodId, callerModule) {
    if (!isPartitioned_(tableName)) {
      throw new DalError_(
        'NOT_PARTITIONED_TABLE',
        '"' + tableName + '" is not a partitioned table. ' +
        'ensurePartition() is only for FACT_* tables.',
        { tableName: tableName }
      );
    }

    enforceWriteGuard_(tableName, callerModule);

    var tabName       = Identifiers.generatePartitionTabName(tableName, periodId);
    var existingSheet = getSheet_(tabName);

    if (existingSheet) {
      emit_('INFO', 'ENSURE_PARTITION_EXISTS', { tableName: tableName, tabName: tabName });
      return { created: false, tabName: tabName };
    }

    // Find an existing partition to copy headers from
    trackApiCall_();
    var allSheets     = getSpreadsheet_().getSheets();
    var headerSource  = null;
    var searchPrefix  = tableName + '|';

    for (var i = 0; i < allSheets.length; i++) {
      if (allSheets[i].getName().indexOf(searchPrefix) === 0) {
        headerSource = allSheets[i];
        break;
      }
    }

    // Create the new tab
    trackApiCall_();
    var newSheet = getSpreadsheet_().insertSheet(tabName);

    if (headerSource) {
      var headers = getHeaders_(headerSource);
      if (headers.length > 0) {
        trackApiCall_();
        newSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
    }
    // If no headerSource: sheet is created empty.
    // SetupScript or AdminEngine is responsible for the initial header row.

    emit_('INFO', 'ENSURE_PARTITION_CREATED', {
      tableName:    tableName,
      tabName:      tabName,
      callerModule: callerModule,
      copiedHeaders: headerSource ? true : false
    });

    return { created: true, tabName: tabName };
  }

  // ============================================================
  // SECTION 16: PUBLIC — SHEET UTILITIES
  //
  // clearSheet() and listSheets() allow engines to manage MART and
  // VW sheets without bypassing DAL via SpreadsheetApp directly.
  // Resolves the known A2 exception documented in ReportingEngine,
  // EventReplayEngine, BillingEngine, and PayrollEngine.
  // ============================================================

  /**
   * Deletes all data rows (row 2 onward) from a named sheet, keeping
   * the header row intact. Safe on empty or missing sheets (returns 0).
   *
   * Used by engines that clear MART or VW sheets before rebuilding.
   *
   * @param {string} sheetName
   * @returns {number}  Rows deleted (0 if sheet empty or not found)
   */
  function clearSheet(sheetName) {
    var ss    = getSpreadsheet_();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() <= 1) return 0;
    trackApiCall_();
    var rowCount = sheet.getLastRow() - 1;
    sheet.deleteRows(2, rowCount);
    emit_('INFO', 'CLEAR_SHEET', { tableName: sheetName, rowsCleared: rowCount });
    return rowCount;
  }

  /**
   * Returns the names of all sheets in the spreadsheet.
   * Used by engines that discover partition tabs by name prefix
   * (e.g. FACT_WORK_LOGS|YYYY-MM matching).
   *
   * @returns {string[]}  Tab names in sheet order
   */
  function listSheets() {
    var ss = getSpreadsheet_();
    trackApiCall_();
    return ss.getSheets().map(function(s) { return s.getName(); });
  }

  // ============================================================
  // SECTION 17: PUBLIC — UTILITY METHODS
  // ============================================================

  /**
   * Returns the number of SpreadsheetApp API calls made by DAL
   * in the current execution. Used by HealthMonitor.gs to check
   * whether the quota warning threshold has been reached.
   *
   * @returns {number}
   */
  function getApiCallCount() {
    return _apiCallCount;
  }

  /**
   * Registers a logging hook function.
   * Called once by Logger.gs (T3) during its own initialization.
   * After registration, all DAL emit_() calls route through this hook.
   *
   * Hook signature: fn(level, action, context)
   *   level:   'INFO' | 'WARN' | 'ERROR'
   *   action:  event identifier string (e.g. 'APPEND_ROW')
   *   context: plain object with debug fields
   *
   * @param {Function} hookFn
   * @throws {DalError_}  If hookFn is not a function
   */
  function setLogHook(hookFn) {
    if (typeof hookFn !== 'function') {
      throw new DalError_(
        'INVALID_LOG_HOOK',
        'setLogHook() requires a function. Received: ' + typeof hookFn,
        {}
      );
    }
    _logHook = hookFn;
  }

  /**
   * Resets the cached spreadsheet reference and API call counter.
   * Used exclusively by the test harness to isolate test runs.
   * Do NOT call this in production code.
   */
  function _resetForTesting() {
    _ss           = null;
    _apiCallCount = 0;
    _logHook      = null;
  }

  /**
   * Resets the cumulative API call counter to zero.
   * Used by the test harness between tests to prevent the HealthMonitor
   * quota guard from blocking processQueue() after a quota-intensive test.
   * Safe to call without affecting _ss or _logHook.
   * Do NOT call this in production code.
   */
  function _resetApiCallCount() {
    _apiCallCount = 0;
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {

    // ── Core data operations ──────────────────────────────────
    readAll:         readAll,
    readWhere:       readWhere,
    appendRow:       appendRow,
    appendRows:      appendRows,
    updateWhere:     updateWhere,

    // ── Partition management ──────────────────────────────────
    ensurePartition: ensurePartition,

    // ── Sheet utilities ───────────────────────────────────────
    clearSheet:      clearSheet,
    listSheets:      listSheets,

    // ── Infrastructure integration ────────────────────────────
    getApiCallCount: getApiCallCount,  // consumed by HealthMonitor.gs
    setLogHook:      setLogHook,       // called by Logger.gs during init

    // ── Test support (prefix _ = not for production use) ─────
    _resetForTesting:   _resetForTesting,
    _resetApiCallCount: _resetApiCallCount

  };

})();
