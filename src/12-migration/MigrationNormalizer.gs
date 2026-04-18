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
  // Confirmed against actual Stacey tab headers 2026-04-18.
  var STAFF_MAP = {
    person_code:     ['Designer_ID', 'person_code', 'PersonCode'],
    name:            ['Designer_Name', 'Designer Name', 'name', 'Name'],
    role:            ['Role', 'role'],
    supervisor_code: ['Supervisor_ID', 'supervisor_code', 'SupervisorCode'],
    // Stacey has one Hourly_Rate for both design and QC work
    pay_design:      ['Hourly_Rate', 'pay_design', 'PayDesign'],
    pay_qc:          ['Hourly_Rate', 'pay_qc', 'PayQC'],
    pay_currency:    ['pay_currency', 'PayCurrency'],
    bonus_eligible:  ['Supervisor_Bonus_Eligible', 'bonus_eligible']
  };

  var CLIENT_MAP = {
    client_code:   ['Client_Code', 'client_code', 'ClientCode'],
    client_name:   ['Client_Name', 'client_name', 'ClientName'],
    contact_email: ['contact_email', 'ContactEmail', 'Email']
  };

  var JOB_MAP = {
    job_number:  ['Job_Number', 'job_number', 'JobNumber'],
    client_code: ['Client_Code', 'client_code', 'ClientCode'],
    period_id:   ['Billing_Period', 'period_id', 'PeriodId', 'Period'],
    status:      ['Status', 'status']
  };

  // 'Your Name' (work logs) and 'QC Reviewer Name' (QC logs) are full
  // designer names — resolved to person_code via name→code map at normalise time.
  var WORK_LOG_MAP = {
    job_number:  ['Job Number', 'job_number', 'JobNumber'],
    person_code: ['Your Name', 'QC Reviewer Name', 'person_code', 'PersonCode'],
    hours:       ['Hours Worked', 'QC Hours Spent', 'hours', 'Hours'],
    work_date:   ['Date Worked', 'Date of QC Review', 'work_date', 'WorkDate'],
    actor_role:  ['actor_role', 'ActorRole', 'role', 'Role']
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

  // ── Stacey role name → Nexus role constant ────────────────
  var ROLE_MAP = {
    'team leader':       'TEAM_LEAD',
    'teamlead':          'TEAM_LEAD',
    'team lead':         'TEAM_LEAD',
    'tl':                'TEAM_LEAD',
    'project manager':   'PM',
    'pm':                'PM',
    'designer':          'DESIGNER',
    'qc':                'QC',
    'ceo':               'CEO',
    'admin':             'ADMIN'
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
    if (sourceTab === st.QC_LOGS)   return 'WORK_LOG'; // QC logs → same entity, role=QC
    if (sourceTab === st.BILLING)   return 'BILLING';
    if (sourceTab === st.PAYROLL)   return 'PAYROLL';
    return null;
  }

  // Returns the default actor_role for a source tab.
  function detectDefaultRole_(sourceTab) {
    if (sourceTab === MigrationConfig.STACEY_TABLES.QC_LOGS) return 'QC';
    return 'DESIGNER';
  }

  /**
   * Strips currency symbols (₹, $, C$, USD) and whitespace from a rate string,
   * returning a plain numeric string.
   */
  function parseRate_(val) {
    if (val === undefined || val === null) return val;
    return String(val).replace(/[₹$€£,\s]/g, '').trim();
  }

  /**
   * Post-processes a STAFF payload:
   * - Normalises role name to Nexus constant
   * - Strips currency symbol from pay_design / pay_qc
   * - Defaults pay_currency to INR if ₹ symbol was present
   */
  function postProcessStaff_(payload) {
    if (payload.role) {
      var key = String(payload.role).trim().toLowerCase();
      if (ROLE_MAP[key]) payload.role = ROLE_MAP[key];
    }
    var rawRate = String(payload.pay_design || payload.pay_qc || '');
    var isInr   = rawRate.indexOf('₹') !== -1;
    if (payload.pay_design) payload.pay_design = parseRate_(payload.pay_design);
    if (payload.pay_qc)     payload.pay_qc     = parseRate_(payload.pay_qc);
    if (!payload.pay_currency) payload.pay_currency = isInr ? 'INR' : 'CAD';
    return payload;
  }

  /**
   * Builds a lowercase Designer_Name → Designer_ID lookup from STAFF raw rows.
   * Used to resolve person_code from full names in work-log forms.
   *
   * @param {Object[]} allRawRows  All MIGRATION_RAW_IMPORT rows for the batch
   * @returns {Object}  map of lowercased name → person_code
   */
  function buildNameCodeMap_(allRawRows) {
    var map  = {};
    var staffTab = MigrationConfig.STACEY_TABLES.STAFF;
    allRawRows.forEach(function (r) {
      if (r.source_tab !== staffTab) return;
      try {
        var raw  = JSON.parse(r.raw_json || '{}');
        var name = raw['Designer_Name'] || raw['name'] || raw['Name'];
        var code = raw['Designer_ID']   || raw['person_code'];
        if (name && code) map[String(name).trim().toLowerCase()] = String(code).trim();
      } catch (e) { /* skip malformed row */ }
    });
    return map;
  }

  /**
   * Attempts to extract a period_id (YYYY-MM) from BLC job number format YYMM-XXXX.
   * Returns '' if the pattern does not match.
   */
  function extractPeriodFromJobNumber_(jobNumber) {
    var m = String(jobNumber || '').match(/^(\d{2})(\d{2})-/);
    if (!m) return '';
    var year  = 2000 + parseInt(m[1], 10);
    var month = parseInt(m[2], 10);
    if (month < 1 || month > 12) return '';
    return year + '-' + (month < 10 ? '0' + month : String(month));
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
    var nameCodeMap  = buildNameCodeMap_(batchRows);

    var normalized  = 0;
    var invalid     = 0;
    var skipped     = 0;
    var partial     = false;
    var buffer      = [];
    var runStart    = new Date();
    var LIMIT_MS    = 270000; // 4.5 min — leaves 1.5 min buffer before GAS 6-min kill

    function flushBuffer_() {
      if (buffer.length === 0) return;
      DAL.appendRows(MigrationConfig.TABLES.NORMALIZED, buffer, { callerModule: MODULE });
      normalized += buffer.length;
      buffer = [];
    }

    for (var i = 0; i < batchRows.length; i++) {
      // Wall-clock guard — check every 20 rows; stop before GAS kills the execution
      if (i % 20 === 0 && (new Date() - runStart) > LIMIT_MS) {
        Logger.warn('NORMALIZER_TIME_CUTOFF', { module: MODULE, processed: i, total: batchRows.length, elapsedMs: new Date() - runStart });
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

      var fieldMap = ENTITY_MAPS[entityType];
      var payload  = applyMap_(rawObj, fieldMap);

      if (entityType === 'STAFF') {
        payload = postProcessStaff_(payload);
      }

      if (entityType === 'JOB' && !payload.period_id && payload.job_number) {
        var derived = extractPeriodFromJobNumber_(payload.job_number);
        if (derived) payload.period_id = derived;
      }

      if (entityType === 'WORK_LOG') {
        // Resolve full designer name → person_code if form used a name field
        if (payload.person_code) {
          var nameKey = String(payload.person_code).trim().toLowerCase();
          if (nameCodeMap[nameKey]) payload.person_code = nameCodeMap[nameKey];
        }
        if (!payload.actor_role) {
          payload.actor_role = detectDefaultRole_(raw.source_tab);
        }
      }
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
