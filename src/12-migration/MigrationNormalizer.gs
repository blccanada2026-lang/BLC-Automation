// ============================================================
// MigrationNormalizer.gs — BLC Nexus T12 Migration
// src/12-migration/MigrationNormalizer.gs
//
// Phase E — Layer 2: reads MIGRATION_RAW_IMPORT, maps raw rows
// to normalized payloads, validates, writes to MIGRATION_NORMALIZED.
// Idempotent by import_key.
// ============================================================

var MigrationNormalizer = (function () {

  var MODULE = 'MigrationNormalizer';

  // ── Column name mappings: Stacey → Nexus ─────────────────
  // Adapt these to actual Stacey column names after running
  // StaceyAuditor.sampleTab() and reviewing output.
  var STAFF_MAP = {
    person_code:     ['person_code', 'PersonCode', 'Code'],
    name:            ['name', 'Name', 'FullName', 'full_name'],
    email:           ['email', 'Email'],
    role:            ['role', 'Role'],
    supervisor_code: ['supervisor_code', 'SupervisorCode', 'supervisor'],
    pm_code:         ['pm_code', 'PMCode', 'pm'],
    pay_design:      ['pay_design', 'PayDesign', 'design_rate'],
    pay_qc:          ['pay_qc', 'PayQC', 'qc_rate'],
    pay_currency:    ['pay_currency', 'PayCurrency', 'currency']
  };

  var CLIENT_MAP = {
    client_code:   ['client_code', 'ClientCode', 'Code'],
    client_name:   ['client_name', 'ClientName', 'Name'],
    contact_email: ['contact_email', 'ContactEmail', 'Email']
  };

  var JOB_MAP = {
    job_number:  ['job_number', 'JobNumber', 'Job', 'job_no'],
    client_code: ['client_code', 'ClientCode'],
    period_id:   ['period_id', 'PeriodId', 'Period', 'period'],
    status:      ['status', 'Status']
  };

  var WORK_LOG_MAP = {
    job_number:   ['job_number', 'JobNumber'],
    person_code:  ['person_code', 'PersonCode'],
    hours:        ['hours', 'Hours', 'design_hours', 'DesignHours'],
    work_date:    ['work_date', 'WorkDate', 'Date', 'date'],
    actor_role:   ['actor_role', 'ActorRole', 'role', 'Role']
  };

  var BILLING_MAP = {
    job_number:  ['job_number', 'JobNumber'],
    client_code: ['client_code', 'ClientCode'],
    amount:      ['amount', 'Amount', 'total', 'Total'],
    currency:    ['currency', 'Currency'],
    period_id:   ['period_id', 'PeriodId', 'Period']
  };

  var PAYROLL_MAP = {
    person_code:  ['person_code', 'PersonCode'],
    period_id:    ['period_id', 'PeriodId', 'Period'],
    amount_inr:   ['amount_inr', 'AmountINR', 'amount', 'Amount'],
    event_type:   ['event_type', 'EventType', 'type']
  };

  var ENTITY_MAPS = {
    STAFF:    STAFF_MAP,
    CLIENT:   CLIENT_MAP,
    JOB:      JOB_MAP,
    WORK_LOG: WORK_LOG_MAP,
    BILLING:  BILLING_MAP,
    PAYROLL:  PAYROLL_MAP
  };

  /**
   * Maps a Stacey column name to the Nexus field name using the alias list.
   * Returns the first alias found in rawRow. Returns undefined if none match.
   */
  function mapField_(rawRow, aliases) {
    for (var i = 0; i < aliases.length; i++) {
      if (rawRow.hasOwnProperty(aliases[i]) && rawRow[aliases[i]] !== '') {
        return rawRow[aliases[i]];
      }
    }
    return undefined;
  }

  /**
   * Applies a column map to a raw row object, returning a normalized payload.
   */
  function applyMap_(rawRow, fieldMap) {
    var result = {};
    Object.keys(fieldMap).forEach(function (nexusField) {
      var val = mapField_(rawRow, fieldMap[nexusField]);
      if (val !== undefined) result[nexusField] = val;
    });
    return result;
  }

  /**
   * Detects which entity type a raw_import row belongs to based on source_tab.
   * Uses MigrationConfig.STACEY_TABLES to do the reverse lookup.
   */
  function detectEntityType_(sourceTab) {
    var st = MigrationConfig.STACEY_TABLES;
    if (sourceTab === st.STAFF)     return 'STAFF';
    if (sourceTab === st.CLIENTS)   return 'CLIENT';
    if (sourceTab === st.JOBS)      return 'JOB';
    if (sourceTab === st.WORK_LOGS) return 'WORK_LOG';
    if (sourceTab === st.BILLING)   return 'BILLING';
    if (sourceTab === st.PAYROLL)   return 'PAYROLL';
    return null;
  }

  /**
   * Loads already-normalized import keys to support idempotency.
   */
  function loadNormalizedKeys_(batch) {
    var rows;
    try {
      rows = DAL.readAll(MigrationConfig.TABLES.NORMALIZED, { callerModule: MODULE });
    } catch (e) {
      Logger.warn('NORMALIZER_READ_FAILED', { module: MODULE, error: e.message });
      return {};
    }
    var existing = {};
    (rows || []).filter(function (r) { return r.migration_batch === batch; })
               .forEach(function (r) { existing[r.import_key] = true; });
    return existing;
  }

  /**
   * Normalizes all MIGRATION_RAW_IMPORT rows for the current batch.
   * Reads raw rows, maps to normalized payloads, validates, writes to
   * MIGRATION_NORMALIZED. Idempotent — already normalized rows are skipped.
   *
   * @param {string} actorEmail
   * @returns {{ normalized: number, invalid: number, skipped: number, partial: boolean }}
   */
  function normalizeAll(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    var batch = MigrationConfig.getBatch();

    Logger.info('NORMALIZER_START', { module: MODULE, batch: batch });

    var rawRows = DAL.readAll(MigrationConfig.TABLES.RAW_IMPORT, { callerModule: MODULE });
    if (!rawRows || rawRows.length === 0) {
      Logger.warn('NORMALIZER_EMPTY', { module: MODULE, message: 'No rows in MIGRATION_RAW_IMPORT' });
      return { normalized: 0, invalid: 0, skipped: 0, partial: false };
    }

    var existingKeys = loadNormalizedKeys_(batch);
    var batchRows    = rawRows.filter(function (r) { return r.migration_batch === batch; });

    var normalized = 0;
    var invalid    = 0;
    var skipped    = 0;
    var partial    = false;
    var buffer     = [];

    function flushBuffer_() {
      if (buffer.length === 0) return;
      BatchOperations.appendRows(MigrationConfig.TABLES.NORMALIZED, buffer);
      normalized += buffer.length;
      buffer = [];
    }

    for (var i = 0; i < batchRows.length; i++) {
      // Quota guard every 20 iterations before doing work
      if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
        Logger.warn('NORMALIZER_QUOTA_CUTOFF', { module: MODULE, processed: i, total: batchRows.length });
        flushBuffer_();
        partial = true;
        break;
      }

      var raw = batchRows[i];

      if (existingKeys[raw.import_key]) {
        skipped++;
        continue;
      }

      var entityType = detectEntityType_(raw.source_tab);
      if (!entityType) {
        Logger.warn('NORMALIZER_UNKNOWN_TAB', { module: MODULE, tab: raw.source_tab, importKey: raw.import_key });
        skipped++;
        continue;
      }

      var rawObj = {};
      try {
        rawObj = JSON.parse(raw.raw_json || '{}');
      } catch (e) {
        Logger.error('NORMALIZER_JSON_PARSE_FAILED', { module: MODULE, importKey: raw.import_key, error: e.message });
        invalid++;
        continue;
      }

      var fieldMap    = ENTITY_MAPS[entityType];
      var payload     = applyMap_(rawObj, fieldMap);
      var validation  = MigrationValidator.validate(entityType, payload);
      var valStatus   = validation.valid ? 'VALID' : 'INVALID';
      var valNotes    = validation.errors.join('; ');

      if (!validation.valid) invalid++;

      buffer.push({
        norm_id:           Identifiers.generateId(),
        import_key:        raw.import_key,
        migration_batch:   batch,
        entity_type:       entityType,
        normalized_json:   JSON.stringify(payload),
        validation_status: valStatus,
        validation_notes:  valNotes,
        replay_status:     'PENDING',
        normalized_at:     new Date().toISOString(),
        normalized_by:     actorEmail
      });

      if (buffer.length >= 100) {
        flushBuffer_();
        if (HealthMonitor.isApproachingLimit()) {
          Logger.warn('NORMALIZER_QUOTA_CUTOFF', { module: MODULE, processed: i, total: batchRows.length });
          partial = true;
          break;
        }
      }
    }

    flushBuffer_();

    Logger.info('NORMALIZER_COMPLETE', {
      module: MODULE, normalized: normalized, invalid: invalid, skipped: skipped, partial: partial
    });

    return { normalized: normalized, invalid: invalid, skipped: skipped, partial: partial };
  }

  return { normalizeAll: normalizeAll };
}());
