// ============================================================
// MigrationReplayEngine.gs — BLC Nexus T12 Migration
// src/12-migration/MigrationReplayEngine.gs
//
// Phase E — Layer 3: replays MIGRATION_NORMALIZED rows into
// FACT and DIM tables in dependency order.
//
// Replay order: STAFF → CLIENT → JOB → WORK_LOG → BILLING → PAYROLL
//
// CRITICAL: migrated rows are tagged with migration_batch so they
// can be excluded from live billing and payroll runs.
// Idempotent — already-replayed rows are skipped.
//
// LOAD ORDER: After MigrationNormalizer.gs (T12)
// DEPENDENCIES: DAL, Config, MigrationConfig, RBAC, ActorResolver,
//               IdempotencyEngine, HealthMonitor, Logger, Identifiers
// ============================================================

var MigrationReplayEngine = (function () {

  var MODULE = 'MigrationReplayEngine';
  var REPLAY_ORDER = ['STAFF', 'CLIENT', 'JOB', 'WORK_LOG', 'BILLING', 'PAYROLL'];

  // ── Private helpers ────────────────────────────────────────

  /**
   * Loads norm_ids already marked as REPLAYED for the given batch.
   * Used to skip rows that were successfully replayed in a previous run.
   *
   * @param {string} batch  Migration batch ID (e.g. 'BATCH-001')
   * @returns {Object}  Map of norm_id → true for all REPLAYED rows
   */
  function loadReplayedIds_(batch) {
    var rows;
    try {
      rows = DAL.readAll(MigrationConfig.TABLES.NORMALIZED, { callerModule: MODULE });
    } catch (e) {
      Logger.warn('REPLAY_READ_FAILED', { module: MODULE, error: e.message });
      return {};
    }
    var replayed = {};
    (rows || []).filter(function (r) {
      return r.migration_batch === batch && r.replay_status === 'REPLAYED';
    }).forEach(function (r) { replayed[r.norm_id] = true; });
    return replayed;
  }

  /**
   * Marks a normalized row as REPLAYED in MIGRATION_NORMALIZED.
   *
   * @param {string} normId      The norm_id of the row to mark
   * @param {string} actorEmail  Email of the actor running the replay
   */
  function markReplayed_(normId, actorEmail) {
    try {
      DAL.updateWhere(
        MigrationConfig.TABLES.NORMALIZED,
        { norm_id: normId },
        { replay_status: 'REPLAYED', replayed_at: new Date().toISOString(), replayed_by: actorEmail },
        { callerModule: MODULE }
      );
    } catch (e) {
      Logger.warn('REPLAY_MARK_FAILED', { module: MODULE, normId: normId, error: e.message });
    }
  }

  /**
   * Marks a normalized row as FAILED in MIGRATION_NORMALIZED.
   *
   * @param {string} normId      The norm_id of the row to mark
   * @param {string} reason      Human-readable failure reason
   * @param {string} actorEmail  Email of the actor running the replay
   */
  function markFailed_(normId, reason, actorEmail) {
    try {
      DAL.updateWhere(
        MigrationConfig.TABLES.NORMALIZED,
        { norm_id: normId },
        { replay_status: 'FAILED', replay_error: reason, replayed_by: actorEmail },
        { callerModule: MODULE }
      );
    } catch (e) {
      Logger.warn('REPLAY_MARK_FAILED_ERR', { module: MODULE, normId: normId, error: e.message });
    }
  }

  // ── Entity replay handlers ────────────────────────────────

  /**
   * Replays a STAFF row into DIM_STAFF_ROSTER.
   *
   * @param {Object} payload    Normalized payload (parsed from normalized_json)
   * @param {string} batch      Migration batch ID
   * @param {string} actorEmail Email of the actor running the replay
   * @returns {{ ok: boolean, skipped: boolean }}
   */
  function replayStaff_(payload, batch, actorEmail) {
    var idKey = 'MIGR-STAFF-' + payload.person_code + '-' + batch;
    if (!IdempotencyEngine.checkAndMark(idKey)) return { ok: true, skipped: true };
    DAL.appendRow(Config.TABLES.DIM_STAFF_ROSTER, Object.assign({}, payload, {
      migration_batch: batch,
      created_by:      actorEmail,
      created_at:      new Date().toISOString()
    }), { callerModule: MODULE });
    return { ok: true };
  }

  /**
   * Replays a CLIENT row into DIM_CLIENT_MASTER.
   *
   * @param {Object} payload    Normalized payload
   * @param {string} batch      Migration batch ID
   * @param {string} actorEmail Email of the actor running the replay
   * @returns {{ ok: boolean, skipped: boolean }}
   */
  function replayClient_(payload, batch, actorEmail) {
    var idKey = 'MIGR-CLIENT-' + payload.client_code + '-' + batch;
    if (!IdempotencyEngine.checkAndMark(idKey)) return { ok: true, skipped: true };
    DAL.appendRow(Config.TABLES.DIM_CLIENT_MASTER, Object.assign({}, payload, {
      migration_batch: batch,
      created_by:      actorEmail,
      created_at:      new Date().toISOString()
    }), { callerModule: MODULE });
    return { ok: true };
  }

  /**
   * Replays a JOB row into FACT_JOB_EVENTS as a JOB_MIGRATED event.
   *
   * @param {Object} payload    Normalized payload
   * @param {string} batch      Migration batch ID
   * @param {string} actorEmail Email of the actor running the replay
   * @returns {{ ok: boolean, skipped: boolean }}
   */
  function replayJob_(payload, batch, actorEmail) {
    var idKey = 'MIGR-JOB-' + payload.job_number + '-' + batch;
    if (!IdempotencyEngine.checkAndMark(idKey)) return { ok: true, skipped: true };
    DAL.appendRow(Config.TABLES.FACT_JOB_EVENTS, {
      event_id:        Identifiers.generateId(),
      event_type:      'JOB_MIGRATED',
      job_number:      payload.job_number,
      client_code:     payload.client_code,
      period_id:       payload.period_id,
      status:          payload.status || 'COMPLETED',
      migration_batch: batch,
      created_by:      actorEmail,
      created_at:      new Date().toISOString()
    }, { callerModule: MODULE, periodId: payload.period_id });
    return { ok: true };
  }

  /**
   * Replays a WORK_LOG row into FACT_WORK_LOGS as a WORK_LOG_MIGRATED event.
   *
   * @param {Object} payload    Normalized payload
   * @param {string} batch      Migration batch ID
   * @param {string} actorEmail Email of the actor running the replay
   * @returns {{ ok: boolean, skipped: boolean }}
   */
  function replayWorkLog_(payload, batch, actorEmail) {
    var idKey = 'MIGR-WL-' + payload.job_number + '-' + payload.person_code + '-' +
                (payload.work_date || '') + '-' + batch;
    if (!IdempotencyEngine.checkAndMark(idKey)) return { ok: true, skipped: true };
    DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
      event_id:        Identifiers.generateId(),
      event_type:      'WORK_LOG_MIGRATED',
      job_number:      payload.job_number,
      person_code:     payload.person_code,
      hours:           Number(payload.hours) || 0,
      work_date:       payload.work_date || '',
      actor_role:      payload.actor_role || 'DESIGNER',
      period_id:       payload.period_id || '',
      migration_batch: batch,
      created_by:      actorEmail,
      created_at:      new Date().toISOString()
    }, { callerModule: MODULE, periodId: payload.period_id });
    return { ok: true };
  }

  /**
   * Replays a BILLING row into FACT_BILLING_LEDGER as a BILLING_MIGRATED event.
   *
   * @param {Object} payload    Normalized payload
   * @param {string} batch      Migration batch ID
   * @param {string} actorEmail Email of the actor running the replay
   * @returns {{ ok: boolean, skipped: boolean }}
   */
  function replayBilling_(payload, batch, actorEmail) {
    var idKey = 'MIGR-BILL-' + payload.job_number + '-' + payload.client_code + '-' + batch;
    if (!IdempotencyEngine.checkAndMark(idKey)) return { ok: true, skipped: true };
    DAL.appendRow(Config.TABLES.FACT_BILLING_LEDGER, {
      billing_id:      Identifiers.generateId(),
      event_type:      'BILLING_MIGRATED',
      job_number:      payload.job_number,
      client_code:     payload.client_code,
      amount:          Number(payload.amount) || 0,
      currency:        payload.currency || 'CAD',
      period_id:       payload.period_id || '',
      migration_batch: batch,
      created_by:      actorEmail,
      created_at:      new Date().toISOString()
    }, { callerModule: MODULE, periodId: payload.period_id });
    return { ok: true };
  }

  /**
   * Replays a PAYROLL row into FACT_PAYROLL_LEDGER as a PAYROLL_MIGRATED event.
   *
   * @param {Object} payload    Normalized payload
   * @param {string} batch      Migration batch ID
   * @param {string} actorEmail Email of the actor running the replay
   * @returns {{ ok: boolean, skipped: boolean }}
   */
  function replayPayroll_(payload, batch, actorEmail) {
    var idKey = 'MIGR-PAY-' + payload.person_code + '-' + payload.period_id + '-' + batch;
    if (!IdempotencyEngine.checkAndMark(idKey)) return { ok: true, skipped: true };
    DAL.appendRow(Config.TABLES.FACT_PAYROLL_LEDGER, {
      payroll_id:      Identifiers.generateId(),
      event_type:      'PAYROLL_MIGRATED',
      person_code:     payload.person_code,
      period_id:       payload.period_id,
      amount_inr:      Number(payload.amount_inr) || 0,
      migration_batch: batch,
      created_by:      actorEmail,
      created_at:      new Date().toISOString()
    }, { callerModule: MODULE, periodId: payload.period_id });
    return { ok: true };
  }

  /**
   * Pre-creates all FACT partition tabs needed by the current batch.
   * Called once at the start of replayAll() before the write loop.
   * Idempotent — no-op for tabs that already exist.
   */
  function ensureMigrationPartitions_(batchRows) {
    var tableMap = {
      JOB:      Config.TABLES.FACT_JOB_EVENTS,
      WORK_LOG: Config.TABLES.FACT_WORK_LOGS,
      BILLING:  Config.TABLES.FACT_BILLING_LEDGER,
      PAYROLL:  Config.TABLES.FACT_PAYROLL_LEDGER
    };
    var seen = {};
    batchRows.forEach(function (r) {
      if (r.validation_status !== 'VALID') return;
      var table = tableMap[r.entity_type];
      if (!table) return;
      try {
        var payload = JSON.parse(r.normalized_json || '{}');
        var period  = payload.period_id;
        if (!period || period === 'UNKNOWN') return;
        var key = table + '|' + period;
        if (seen[key]) return;
        seen[key] = true;
        DAL.ensurePartition(table, period, MODULE);
      } catch (e) {
        Logger.warn('REPLAY_ENSURE_PARTITION_FAILED', {
          module: MODULE, error: e.message
        });
      }
    });
    Logger.info('REPLAY_PARTITIONS_ENSURED', {
      module: MODULE, count: Object.keys(seen).length
    });
  }

  var ENTITY_HANDLERS = {
    STAFF:    replayStaff_,
    CLIENT:   replayClient_,
    JOB:      replayJob_,
    WORK_LOG: replayWorkLog_,
    BILLING:  replayBilling_,
    PAYROLL:  replayPayroll_
  };

  // ── Public API ─────────────────────────────────────────────

  /**
   * Replays all VALID MIGRATION_NORMALIZED rows into FACT/DIM tables.
   * Processes in dependency order: STAFF → CLIENT → JOB → WORK_LOG → BILLING → PAYROLL.
   * Skips INVALID rows and already-replayed rows.
   * Idempotent — safe to re-run after a partial or failed run.
   *
   * @param {string} actorEmail  Email of the CEO/ADMIN running the replay
   * @returns {{ replayed: number, skipped: number, failed: number, partial: boolean }}
   */
  function replayAll(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
    RBAC.enforceFinancialAccess(actor);

    var batch = MigrationConfig.getBatch();

    Logger.info('REPLAY_START', { module: MODULE, batch: batch });

    var allNorm = DAL.readAll(MigrationConfig.TABLES.NORMALIZED, { callerModule: MODULE });
    if (!allNorm || allNorm.length === 0) {
      Logger.warn('REPLAY_EMPTY', { module: MODULE, message: 'No rows in MIGRATION_NORMALIZED' });
      return { replayed: 0, skipped: 0, failed: 0, partial: false };
    }

    var replayedIds = loadReplayedIds_(batch);
    var batchRows   = allNorm.filter(function (r) {
      return r.migration_batch === batch && r.validation_status === 'VALID';
    });

    ensureMigrationPartitions_(batchRows);

    var replayed = 0;
    var skipped  = 0;
    var failed   = 0;
    var partial  = false;
    var runStart = new Date();
    var LIMIT_MS = 270000; // 4.5 min wall-clock guard

    // Process in dependency order: STAFF → CLIENT → JOB → WORK_LOG → BILLING → PAYROLL
    for (var o = 0; o < REPLAY_ORDER.length; o++) {
      var entityType = REPLAY_ORDER[o];
      var entityRows = batchRows.filter(function (r) { return r.entity_type === entityType; });
      var handler    = ENTITY_HANDLERS[entityType];

      Logger.info('REPLAY_ENTITY_START', {
        module: MODULE, entityType: entityType, count: entityRows.length
      });

      for (var i = 0; i < entityRows.length; i++) {
        if (i % 20 === 0 && (new Date() - runStart) > LIMIT_MS) {
          Logger.warn('REPLAY_TIME_CUTOFF', {
            module: MODULE, entityType: entityType, processed: i, total: entityRows.length, elapsedMs: new Date() - runStart
          });
          partial = true;
          break;
        }

        var row = entityRows[i];

        if (replayedIds[row.norm_id]) {
          skipped++;
          continue;
        }

        var payload = {};
        try {
          payload = JSON.parse(row.normalized_json || '{}');
        } catch (e) {
          Logger.error('REPLAY_JSON_PARSE_FAILED', {
            module: MODULE, normId: row.norm_id, error: e.message
          });
          markFailed_(row.norm_id, 'JSON parse error: ' + e.message, actorEmail);
          failed++;
          continue;
        }

        try {
          var result = handler(payload, batch, actorEmail);
          markReplayed_(row.norm_id, actorEmail); // always sync status — data written in prior run or just now
          if (result.skipped) {
            skipped++;
          } else {
            replayed++;
          }
        } catch (e) {
          Logger.error('REPLAY_HANDLER_FAILED', {
            module: MODULE, entityType: entityType, normId: row.norm_id, error: e.message
          });
          markFailed_(row.norm_id, e.message, actorEmail);
          failed++;
        }
      }

      // Stop processing further entity types if quota hit
      if (partial) break;
    }

    Logger.info('REPLAY_COMPLETE', {
      module: MODULE, replayed: replayed, skipped: skipped, failed: failed, partial: partial
    });

    return { replayed: replayed, skipped: skipped, failed: failed, partial: partial };
  }

  return { replayAll: replayAll };

}());
