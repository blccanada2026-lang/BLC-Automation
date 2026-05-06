// ============================================================
// SheetAdapter.gs — BLC Nexus T6 Handlers
// src/06-handlers/SheetAdapter.gs
//
// LOAD ORDER: T6. Loads after all T0–T5 files.
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1),
//               RBAC (T2), Logger (T3), HealthMonitor (T3),
//               IntakeService (T5)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Sheet-based bulk job intake for clients who send        ║
// ║  job lists in their own column format (e.g. SBS).        ║
// ║                                                          ║
// ║  The adapter reads a per-client staging sheet            ║
// ║  (STG_INTAKE_{CLIENT}), maps each row to the standard    ║
// ║  JOB_CREATE payload using DIM_CLIENT_INTAKE_CONFIG,      ║
// ║  and submits via IntakeService.processSubmission().       ║
// ║                                                          ║
// ║  Status is written back per row (_status, _queue_id,     ║
// ║  _queued_at, _error). Rows with non-empty _status are    ║
// ║  skipped — safe to re-run after fixing errors.           ║
// ║                                                          ║
// ║  Entry points (called from portal or PortalData.gs):     ║
// ║    processSbsIntake(actorEmail)                          ║
// ║    processClientIntake(actorEmail, clientCode,           ║
// ║                         sheetTableKey, uniqueKeyField)   ║
// ╚══════════════════════════════════════════════════════════╝
//
// PM WORKFLOW (SBS example):
//   1. Copy job rows from SBS's system
//   2. Paste into STG_INTAKE_SBS (columns must match sheet headers)
//   3. Click "Process SBS Jobs" in the portal
//   4. Adapter maps rows → queue → QueueProcessor → FACT_JOB_EVENTS
//   5. _status column shows QUEUED or ERROR: <reason> per row
//
// COLUMN MAPPING (DIM_CLIENT_INTAKE_CONFIG):
//   source_column blank + fixed_value set → fixed injection (e.g. client_code='SBS')
//   source_column set                     → read from sheet row + apply transform
//   Multiple rows with same target_field  → joined with ' | ' by sort_order
//
// TRANSFORMS:
//   TRIM     — String(v).trim()
//   UPPERCASE — String(v).trim().toUpperCase()
//   DATE_ISO  — MM/DD/YYYY or GAS Date → YYYY-MM-DD
//   (blank)  — String(v).trim() (pass-through)
//
// UNIQUE KEY:
//   SBS uses 'Job #' as the unique row identifier for DAL writeback.
//   Future clients: specify their equivalent unique column in processClientIntake.
//
// IDEMPOTENCY:
//   _status = 'QUEUED' rows are skipped on re-run.
//   True duplicate detection (same job submitted twice) is handled
//   downstream by IdempotencyEngine in JobCreateHandler.
// ============================================================

var SheetAdapter = (function () {

  var MODULE = 'SheetAdapter';

  // ============================================================
  // SECTION 1: TRANSFORMS
  // Applied to raw cell values before mapping to payload fields.
  // ============================================================

  var TRANSFORMS_ = {

    TRIM: function (v) {
      return String(v !== null && v !== undefined ? v : '').trim();
    },

    UPPERCASE: function (v) {
      return String(v !== null && v !== undefined ? v : '').trim().toUpperCase();
    },

    // Handles MM/DD/YYYY strings and GAS Date objects.
    // GAS reads date cells as Date objects; string cells keep the raw text.
    DATE_ISO: function (v) {
      if (!v && v !== 0) return '';
      if (v instanceof Date) {
        var mm = String(v.getMonth() + 1);
        var dd = String(v.getDate());
        var yy = v.getFullYear();
        if (mm.length < 2) mm = '0' + mm;
        if (dd.length < 2) dd = '0' + dd;
        return yy + '-' + mm + '-' + dd;
      }
      var s = String(v).trim();
      var parts = s.split('/');
      if (parts.length === 3) {
        var m = parts[0], d = parts[1], y = parts[2];
        if (m.length < 2) m = '0' + m;
        if (d.length < 2) d = '0' + d;
        return y + '-' + m + '-' + d;
      }
      return s; // unrecognised format — return as-is
    }

  };

  // ============================================================
  // SECTION 2: CLIENT CONFIG LOADER
  // Reads DIM_CLIENT_INTAKE_CONFIG for a client and caches per run.
  // ============================================================

  var configCache_ = {};

  /**
   * Loads and caches the mapping config for a client.
   * Rows are sorted by sort_order ascending so multi-source
   * fields (e.g. notes) are joined in the correct order.
   *
   * @param {string} clientCode  e.g. 'SBS'
   * @returns {Object[]}  Sorted config rows from DIM_CLIENT_INTAKE_CONFIG
   * @throws  {Error}     If no config rows found for the client
   */
  function loadClientConfig_(clientCode) {
    if (configCache_[clientCode]) return configCache_[clientCode];

    var rows = DAL.readWhere(
      Config.TABLES.DIM_CLIENT_INTAKE_CONFIG,
      { client_code: clientCode }
    );

    if (!rows || rows.length === 0) {
      throw new Error(
        'SheetAdapter: no mapping config found for client "' + clientCode +
        '" in DIM_CLIENT_INTAKE_CONFIG. Add rows via SetupScript or manually.'
      );
    }

    rows.sort(function (a, b) {
      return (parseInt(a.sort_order, 10) || 0) - (parseInt(b.sort_order, 10) || 0);
    });

    configCache_[clientCode] = rows;
    return rows;
  }

  // ============================================================
  // SECTION 3: TRANSFORM RUNNER
  // ============================================================

  /**
   * Applies the named transform to a raw value.
   * Falls back to TRIM if transform is blank or unrecognised.
   *
   * @param {*}      value
   * @param {string} transform  'TRIM' | 'UPPERCASE' | 'DATE_ISO' | ''
   * @returns {string|number}
   */
  function applyTransform_(value, transform) {
    var t = String(transform || '').trim().toUpperCase();
    if (t && TRANSFORMS_[t]) return TRANSFORMS_[t](value);
    return String(value !== null && value !== undefined ? value : '').trim();
  }

  // ============================================================
  // SECTION 4: ROW MAPPER
  // Maps a raw sheet row to a standard JOB_CREATE payload.
  // ============================================================

  /**
   * Maps one raw data row to a normalized payload using the client's
   * config rows. Fields with multiple source columns (e.g. notes from
   * Job Name + Customer + Model) are joined with ' | ' by sort_order.
   *
   * @param {Object}   rawRow  Row object from DAL.readAll (header → value)
   * @param {Object[]} config  Sorted config rows for this client
   * @returns {{ payload: Object, errors: string[] }}
   */
  function mapRow_(rawRow, config) {
    var parts  = {};   // { targetField: [value, value, ...] }
    var errors = [];

    for (var i = 0; i < config.length; i++) {
      var cfg         = config[i];
      var sourceCol   = String(cfg.source_column || '').trim();
      var targetField = String(cfg.target_field  || '').trim();
      var transform   = String(cfg.transform     || '').trim();
      var required    = String(cfg.required      || '').trim().toUpperCase() === 'TRUE';
      var fixedValue  = String(cfg.fixed_value   || '').trim();

      if (!targetField) continue;

      var value;

      if (!sourceCol && fixedValue !== '') {
        // Fixed injection — value does not come from the sheet
        value = (targetField === 'quantity')
          ? (parseInt(fixedValue, 10) || 1)
          : fixedValue;

      } else if (sourceCol) {
        var raw     = rawRow[sourceCol];
        var isEmpty = (raw === null || raw === undefined || String(raw).trim() === '');
        if (isEmpty) {
          if (required) {
            errors.push('Required column "' + sourceCol + '" (→ ' + targetField + ') is empty');
          }
          continue;
        }
        value = applyTransform_(raw, transform);
        if (required && value === '') {
          errors.push('Required column "' + sourceCol + '" (→ ' + targetField + ') is blank after transform');
          continue;
        }
        if (value === '') continue; // optional empty — skip

      } else {
        continue; // no source_column and no fixed_value — skip row
      }

      // Collect parts per target field for joining
      if (!parts[targetField]) parts[targetField] = [];
      parts[targetField].push(value);
    }

    // Build payload — single-source fields are unwrapped; multi-source are joined
    var payload = {};
    for (var field in parts) {
      if (!parts.hasOwnProperty(field)) continue;
      var fieldParts = parts[field];
      payload[field] = (fieldParts.length === 1)
        ? fieldParts[0]
        : fieldParts.join(' | ');
    }

    return { payload: payload, errors: errors };
  }

  // ============================================================
  // SECTION 5: CORE PROCESSOR
  // Reads a client intake sheet, maps rows, submits to queue,
  // and writes status back per row.
  // ============================================================

  /**
   * Processes all pending rows in a client intake sheet.
   *
   * "Pending" = rows where _status is blank or 'PENDING'.
   * Already-processed rows (_status = 'QUEUED' or 'ERROR: ...') are skipped.
   *
   * @param {string} actorEmail     PM or CEO email
   * @param {string} clientCode     e.g. 'SBS' — used to load config
   * @param {string} sheetTableKey  Key in Config.TABLES, e.g. 'STG_INTAKE_SBS'
   * @param {string} uniqueKeyField Column name used as DAL filter for writeback (e.g. 'Job #')
   * @returns {{ processed: number, queued: number, errors: Object[] }}
   */
  function processClientIntake_(actorEmail, clientCode, sheetTableKey, uniqueKeyField) {

    // ── RBAC — PM, ADMIN, CEO can submit jobs ───────────────
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, 'JOB_CREATE');

    var tableName = Config.TABLES[sheetTableKey];
    if (!tableName) {
      throw new Error(
        'SheetAdapter: unknown sheetTableKey "' + sheetTableKey +
        '" — add it to Config.TABLES first.'
      );
    }

    // ── Reset config cache for this run ─────────────────────
    configCache_ = {};

    // ── Load client mapping config ───────────────────────────
    var clientConfig = loadClientConfig_(clientCode);

    // ── Build designer name → person_code map ────────────────
    // Used to resolve designer_name field (e.g. "Sarty Gosh - BL") to allocated_to.
    var designerNameMap_ = {};
    try {
      var rosterRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
      for (var d = 0; d < rosterRows.length; d++) {
        var rCode = String(rosterRows[d].person_code || '').trim();
        var rName = String(rosterRows[d].name        || '').trim().toLowerCase();
        if (rCode && rName) designerNameMap_[rName] = rCode;
      }
      console.log('[SheetAdapter] Designer name map built: ' + Object.keys(designerNameMap_).length + ' entries');
    } catch (e) {
      console.log('[SheetAdapter] ERROR building designer name map: ' + e.message);
    }

    // ── Read all rows from the intake sheet ──────────────────
    var allRows = DAL.readAll(tableName);

    // ── Filter to pending rows ───────────────────────────────
    var pending = [];
    for (var i = 0; i < allRows.length; i++) {
      var s = String(allRows[i]['_status'] || '').trim();
      if (s === '' || s === 'PENDING') pending.push(allRows[i]);
    }

    if (pending.length === 0) {
      Logger.info('SHEET_ADAPTER_NOTHING_PENDING', {
        module: MODULE, client_code: clientCode, table: tableName,
        message: 'No pending rows — nothing to process'
      });
      return { processed: 0, queued: 0, errors: [] };
    }

    Logger.info('SHEET_ADAPTER_START', {
      module: MODULE, client_code: clientCode, table: tableName,
      pending_count: pending.length, actor: actorEmail
    });

    var queued   = 0;
    var errorLog = [];

    for (var r = 0; r < pending.length; r++) {

      // ── Quota guard every 20 rows (Rule P1) ───────────────
      if (r > 0 && r % 20 === 0 && HealthMonitor.isApproachingLimit()) {
        Logger.warn('SHEET_ADAPTER_QUOTA_CUTOFF', {
          module: MODULE, processed: r, total: pending.length,
          message: 'Approaching execution limit — stopping early'
        });
        break;
      }

      var rawRow    = pending[r];
      var uniqueKey = rawRow[uniqueKeyField];
      var now       = new Date().toISOString();

      // ── Map row → payload ──────────────────────────────────
      var mapped = mapRow_(rawRow, clientConfig);

      if (mapped.errors.length > 0) {
        var errMsg    = mapped.errors.join('; ');
        var errFilter = {};
        errFilter[uniqueKeyField] = uniqueKey;

        Logger.warn('SHEET_ADAPTER_MAP_ERROR', {
          module: MODULE, unique_key: uniqueKey, client_code: clientCode,
          message: errMsg
        });

        DAL.updateWhere(
          tableName,
          errFilter,
          { '_status': 'ERROR: ' + errMsg, '_error': errMsg, '_queued_at': now },
          { callerModule: MODULE }
        );

        errorLog.push({ key: uniqueKey, errors: mapped.errors });
        continue;
      }

      // ── Resolve designer_name → allocated_to ─────────────
      // Config rows may map a display-name column (e.g. "Design/Estimator")
      // to the special field "designer_name". Strip client suffixes like
      // " - BL", normalise to lowercase, and look up in DIM_STAFF_ROSTER.
      console.log('[SheetAdapter] payload keys: ' + Object.keys(mapped.payload).join(', '));
      if (mapped.payload.designer_name) {
        var rawName      = String(mapped.payload.designer_name).trim();
        var stripped     = rawName.replace(/\s*-\s*\w+\s*$/, '').trim().toLowerCase();
        var resolvedCode = designerNameMap_[stripped] || '';
        console.log('[SheetAdapter] Resolving "' + rawName + '" → stripped: "' + stripped + '" → code: "' + (resolvedCode || 'NOT FOUND') + '"');
        if (resolvedCode) {
          mapped.payload.allocated_to = resolvedCode;
        } else {
          Logger.warn('SHEET_ADAPTER_DESIGNER_UNRESOLVED', {
            module: MODULE, unique_key: uniqueKey, raw_name: rawName,
            message: 'Designer name could not be resolved to a person_code — job will be unassigned'
          });
        }
        delete mapped.payload.designer_name;
      } else {
        console.log('[SheetAdapter] designer_name not in payload — skipping resolution');
      }

      // ── Submit via IntakeService ───────────────────────────
      var result;
      try {
        result = IntakeService.processSubmission({
          formType:       Config.FORM_TYPES.JOB_CREATE,
          submitterEmail: actorEmail,
          payload:        mapped.payload,
          source:         'SHEET_ADAPTER'
        });
      } catch (e) {
        var submitErrMsg   = 'Submit error: ' + e.message;
        var submitErrFilter = {};
        submitErrFilter[uniqueKeyField] = uniqueKey;

        Logger.error('SHEET_ADAPTER_SUBMIT_FAIL', {
          module: MODULE, unique_key: uniqueKey, client_code: clientCode,
          message: submitErrMsg
        });

        DAL.updateWhere(
          tableName,
          submitErrFilter,
          { '_status': 'ERROR: ' + e.message, '_error': e.message, '_queued_at': now },
          { callerModule: MODULE }
        );

        errorLog.push({ key: uniqueKey, errors: [submitErrMsg] });
        continue;
      }

      if (!result.ok) {
        var rejectMsg    = 'Intake rejected — check _SYS_LOGS for detail';
        var rejectFilter = {};
        rejectFilter[uniqueKeyField] = uniqueKey;

        DAL.updateWhere(
          tableName,
          rejectFilter,
          { '_status': 'ERROR: ' + rejectMsg, '_error': rejectMsg, '_queued_at': now },
          { callerModule: MODULE }
        );

        errorLog.push({ key: uniqueKey, errors: [rejectMsg] });
        continue;
      }

      // ── Write QUEUED status back ───────────────────────────
      var successFilter = {};
      successFilter[uniqueKeyField] = uniqueKey;

      DAL.updateWhere(
        tableName,
        successFilter,
        {
          '_status':    'QUEUED',
          '_queue_id':  result.queueId,
          '_queued_at': now,
          '_error':     ''
        },
        { callerModule: MODULE }
      );

      queued++;
    }

    Logger.info('SHEET_ADAPTER_COMPLETE', {
      module:     MODULE,
      client_code: clientCode,
      table:      tableName,
      processed:  pending.length,
      queued:     queued,
      errors:     errorLog.length,
      actor:      actorEmail
    });

    return {
      processed: pending.length,
      queued:    queued,
      errors:    errorLog
    };
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  return {

    /**
     * Processes all pending rows in STG_INTAKE_SBS.
     * Called from the portal "Process SBS Jobs" button (via PortalData.gs).
     *
     * PM workflow:
     *   1. Paste SBS job rows into STG_INTAKE_SBS (leave _status blank)
     *   2. Click "Process SBS Jobs" in the portal
     *   3. Check _status column — QUEUED or ERROR: <reason> per row
     *
     * @param {string} actorEmail  PM or CEO email
     * @returns {{ processed: number, queued: number, errors: Object[] }}
     */
    processSbsIntake: function (actorEmail) {
      return processClientIntake_(actorEmail, 'SBS', 'STG_INTAKE_SBS', 'Job #');
    },

    /**
     * Generic entry point for any client with a configured intake sheet.
     * Use this to wire up future clients (NORSPAN, MATIX, etc.) without
     * needing new handler functions — just add rows to DIM_CLIENT_INTAKE_CONFIG
     * and a STG_INTAKE_{CLIENT} sheet, then call this with the right params.
     *
     * @param {string} actorEmail     PM or CEO email
     * @param {string} clientCode     e.g. 'NORSPAN'
     * @param {string} sheetTableKey  Key in Config.TABLES for the intake sheet
     * @param {string} uniqueKeyField Column in the sheet that uniquely identifies a row
     * @returns {{ processed: number, queued: number, errors: Object[] }}
     */
    processClientIntake: processClientIntake_

  };

}());
