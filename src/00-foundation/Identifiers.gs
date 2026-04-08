// ============================================================
// Identifiers.gs — BLC Nexus T0 Foundation
// src/00-foundation/Identifiers.gs
//
// LOAD ORDER: Third T0 file (loads after Config.gs, Constants.gs).
// DEPENDENCIES: None — this module has zero imports.
//
// Responsibilities:
//   All ID and key generation for BLC Nexus. Every entity
//   written to a FACT or STG table must have an ID generated
//   here before the write. Centralising generation ensures:
//     1. Format changes require only one edit
//     2. Partition tab names are always consistent
//     3. Idempotency keys are always deterministic
//
// ID FORMAT REFERENCE:
//   Generic UUID:     Utilities.getUuid()
//   Job number:       BLC-00001  (BLC- prefix + 5-digit sequence)
//   Period:           YYYY-MM    (e.g. 2026-03)
//   Partition tab:    TABLE_NAME|YYYY-MM  (e.g. FACT_JOB_EVENTS|2026-03)
//   Idempotency key:  {prefix}_{sourceId}  (deterministic from source data)
//
// DO NOT:
//   - Call SpreadsheetApp or any GAS API other than Utilities
//   - Import or call any other module (T0 = zero dependencies)
//   - Store sequence counters here (DAL owns next-sequence lookups)
//   - Use Math.random() for IDs — Utilities.getUuid() is cryptographic
// ============================================================

var Identifiers = (function () {

  // ──────────────────────────────────────────────────────────
  // GENERIC ID
  // Standard UUID v4 via GAS Utilities. Use for log entries,
  // exception records, and any entity without a domain prefix.
  // ──────────────────────────────────────────────────────────

  /**
   * Returns a standard UUID v4 string.
   * Example: "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
   */
  function generateId() {
    return Utilities.getUuid();
  }

  // ──────────────────────────────────────────────────────────
  // PREFIXED SHORT ID
  // Compact 12-char alphanumeric suffix for human-visible IDs
  // that appear in UI (queue items, submission receipts).
  // Format: PREFIX-XXXXXXXXXXXX  (12 uppercase hex chars)
  // ──────────────────────────────────────────────────────────

  /**
   * Generates a short prefixed ID.
   * @param {string} prefix  e.g. 'QITM', 'SUB', 'LOG'
   * @returns {string}  e.g. 'QITM-A3F9C812D047'
   */
  function generatePrefixedId(prefix) {
    if (!prefix || typeof prefix !== 'string') {
      throw new Error('Identifiers.generatePrefixedId: prefix is required');
    }
    var uuid   = Utilities.getUuid().replace(/-/g, '');
    var suffix = uuid.substring(0, 12).toUpperCase();
    return prefix + '-' + suffix;
  }

  // ──────────────────────────────────────────────────────────
  // JOB NUMBER
  // Human-readable sequential job identifier.
  // Format: BLC-NNNNN  (BLC- prefix + 5-digit zero-padded seq)
  //
  // Usage: DAL reads the next sequence from a counter row in
  // DIM_SEQUENCE_COUNTERS, then passes it to this function.
  // The generated ID is written to FACT_JOB_EVENTS.job_number.
  // ──────────────────────────────────────────────────────────

  /**
   * Generates a BLC job number from a sequence integer.
   * @param {number} sequenceNumber  Positive integer (e.g. 1, 42, 10000)
   * @returns {string}  e.g. 'BLC-00042'
   * @throws  If sequenceNumber is missing or non-numeric
   */
  function generateJobId(sequenceNumber) {
    if (sequenceNumber === undefined || sequenceNumber === null) {
      throw new Error('Identifiers.generateJobId: sequenceNumber is required');
    }
    var n = parseInt(sequenceNumber, 10);
    if (isNaN(n) || n < 1) {
      throw new Error('Identifiers.generateJobId: sequenceNumber must be a positive integer, got: ' + sequenceNumber);
    }
    // padStart not available in GAS ES5 — use manual zero-padding
    var s = String(n);
    while (s.length < 5) { s = '0' + s; }
    return 'BLC-' + s;
  }

  // ──────────────────────────────────────────────────────────
  // PERIOD ID
  // Billing and payroll period identifier.
  // Format: YYYY-MM  (ISO 8601 year-month)
  //
  // All FACT table partitions and payroll runs use period_id
  // as their primary time-range key.
  // ──────────────────────────────────────────────────────────

  /**
   * Derives a period_id string from any Date or ISO date string.
   * @param {Date|string} date  Date object or parseable date string
   * @returns {string}  e.g. '2026-03'
   * @throws  If date is invalid
   */
  function generatePeriodId(date) {
    var d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) {
      throw new Error('Identifiers.generatePeriodId: invalid date — ' + date);
    }
    var year  = d.getFullYear();
    var month = d.getMonth() + 1;
    var mm    = month < 10 ? '0' + month : String(month);
    return year + '-' + mm;
  }

  /**
   * Returns the period_id for the current date/time.
   * Convenience wrapper around generatePeriodId(new Date()).
   * @returns {string}  e.g. '2026-04'
   */
  function generateCurrentPeriodId() {
    return generatePeriodId(new Date());
  }

  // ──────────────────────────────────────────────────────────
  // PARTITION TAB NAME
  // Google Sheets tab name for partitioned FACT tables.
  // Format: TABLE_NAME|YYYY-MM
  // Example: FACT_JOB_EVENTS|2026-03
  //
  // DAL calls generatePartitionTabName() to resolve the exact
  // sheet tab before every FACT table read/write. The pipe
  // character is intentional — it is visible in the tab name
  // and makes table/period parsing unambiguous.
  // ──────────────────────────────────────────────────────────

  /**
   * Builds a partition tab name from a table name and period_id.
   * @param {string} tableName  e.g. 'FACT_JOB_EVENTS'
   * @param {string} periodId   e.g. '2026-03'
   * @returns {string}  e.g. 'FACT_JOB_EVENTS|2026-03'
   * @throws  If either argument is missing
   */
  function generatePartitionTabName(tableName, periodId) {
    if (!tableName) {
      throw new Error('Identifiers.generatePartitionTabName: tableName is required');
    }
    if (!periodId) {
      throw new Error('Identifiers.generatePartitionTabName: periodId is required');
    }
    return tableName + '|' + periodId;
  }

  /**
   * Parses a partition tab name back into its components.
   * @param {string} tabName  e.g. 'FACT_JOB_EVENTS|2026-03'
   * @returns {{ tableName: string, periodId: string }|null}
   *   Returns null if tabName is not a valid partition tab name.
   */
  function parsePartitionTabName(tabName) {
    if (!tabName || typeof tabName !== 'string') return null;
    var idx = tabName.indexOf('|');
    if (idx === -1) return null;
    var tableName = tabName.substring(0, idx);
    var periodId  = tabName.substring(idx + 1);
    if (!tableName || !periodId) return null;
    return { tableName: tableName, periodId: periodId };
  }

  // ──────────────────────────────────────────────────────────
  // IDEMPOTENCY KEY
  // Deterministic key for IdempotencyEngine.checkAndMark().
  // Must be built from stable source data — never random.
  //
  // Formats by domain:
  //   Form submission:  INTAKE_{submission_id}
  //   Queue item:       QUEUE_{queue_id}
  //   Migration row:    MIGRATION_V2_{legacy_job_number}_{event_type}
  //   Payroll run:      PAYROLL_{person_code}_{period_id}
  //   Billing run:      BILLING_{job_number}_{period_id}
  // ──────────────────────────────────────────────────────────

  /**
   * Builds a namespaced idempotency key.
   * All parts are joined with underscores and uppercased.
   * @param {...string} parts  Key segments (e.g. 'PAYROLL', personCode, periodId)
   * @returns {string}  e.g. 'PAYROLL_SGO_2026-03'
   * @throws  If no parts provided or any part is empty
   */
  function buildIdempotencyKey() {
    var parts = Array.prototype.slice.call(arguments);
    if (parts.length === 0) {
      throw new Error('Identifiers.buildIdempotencyKey: at least one part is required');
    }
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i] && parts[i] !== 0) {
        throw new Error('Identifiers.buildIdempotencyKey: part[' + i + '] is empty');
      }
    }
    return parts.join('_').toUpperCase();
  }

  // ──────────────────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────────────────
  return {
    generateId:               generateId,
    generatePrefixedId:       generatePrefixedId,
    generateJobId:            generateJobId,
    generatePeriodId:         generatePeriodId,
    generateCurrentPeriodId:  generateCurrentPeriodId,
    generatePartitionTabName: generatePartitionTabName,
    parsePartitionTabName:    parsePartitionTabName,
    buildIdempotencyKey:      buildIdempotencyKey
  };

})();
