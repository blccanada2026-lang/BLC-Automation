// ============================================================
// BillingEngine.gs — BLC Nexus T9 Billing
// src/09-billing/BillingEngine.gs
//
// LOAD ORDER: T9. Loads after all T0–T7 files.
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1),
//               RBAC (T2), Logger (T3), HealthMonitor (T3)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Batch billing engine — NOT queue-driven.               ║
// ║                                                         ║
// ║  Billing model: hours × client hourly rate              ║
// ║                                                         ║
// ║  runBillingRun(actorEmail, options)                     ║
// ║    1. Load DIM_CLIENT_RATES → rate cache                ║
// ║    2. Sum FACT_WORK_LOGS hours per job                  ║
// ║    3. For each COMPLETED_BILLABLE job:                  ║
// ║         a. Resolve rate (client+product, then client)   ║
// ║         b. amount = total_hours × hourly_rate           ║
// ║         c. Write FACT_BILLING_LEDGER                    ║
// ║         d. Transition VW → INVOICED                     ║
// ║    4. Refresh MART_BILLING_SUMMARY aggregate            ║
// ║                                                         ║
// ║  Permission: BILLING_RUN (PM + CEO)                     ║
// ╚══════════════════════════════════════════════════════════╝
//
// RATE LOOKUP (DIM_CLIENT_RATES):
//   Most specific match wins.
//   Priority 1: client_code + product_code match
//   Priority 2: client_code match + product_code blank (flat rate)
//   If no rate found: job is skipped with WARN — never billed at zero.
//
// HOURS:
//   Summed from FACT_WORK_LOGS for the billing period.
//   If a job has no work log entries, hours default to 0 and
//   the job is billed at $0 with a WARN (edge case — contact PM).
//
// CURRENCIES:
//   Rate currency is taken from DIM_CLIENT_RATES per client.
//   Supported: CAD, USD. Each billing record stores its own currency.
//   Mixed-currency runs are allowed — MART_BILLING_SUMMARY groups by
//   client_code AND currency for correct totals.
//
// IDEMPOTENCY:
//   Key: BILLING|{job_number}|{periodId}
//   Re-running the engine skips already-billed jobs safely.
// ============================================================

var BillingEngine = (function () {

  var MODULE = 'BillingEngine';

  // ============================================================
  // PRIVATE SCHEMAS — used by ValidationEngine.validate()
  // Rule A4: validate before every FACT table write.
  // Defined once at module scope; never mutated.
  // ============================================================

  var BILLING_LEDGER_SCHEMA = {
    event_id:        { type: 'string', required: true,  label: 'Event ID' },
    job_number:      { type: 'string', required: true,  pattern: /^BLC-\d{5}$/, label: 'Job Number' },
    period_id:       { type: 'string', required: true,  pattern: /^\d{4}-\d{2}$/, label: 'Period ID' },
    event_type:      { type: 'string', required: true,  label: 'Event Type' },
    timestamp:       { type: 'string', required: true,  label: 'Timestamp' },
    actor_code:      { type: 'string', required: true,  label: 'Actor Code' },
    client_code:     { type: 'string', required: true,  minLength: 2, label: 'Client Code' },
    amount:          { type: 'number', required: true,  min: 0, label: 'Amount' },
    currency:        { type: 'string', required: true,  allowedValues: ['CAD', 'USD'], label: 'Currency' },
    invoice_id:      { type: 'string', required: true,  label: 'Invoice ID' },
    idempotency_key: { type: 'string', required: true,  label: 'Idempotency Key' }
  };

  var INVOICED_EVENT_SCHEMA = {
    event_id:   { type: 'string', required: true, label: 'Event ID' },
    job_number: { type: 'string', required: true, pattern: /^BLC-\d{5}$/, label: 'Job Number' },
    event_type: { type: 'string', required: true, label: 'Event Type' },
    from_state: { type: 'string', required: true, label: 'From State' },
    to_state:   { type: 'string', required: true, label: 'To State' },
    timestamp:  { type: 'string', required: true, label: 'Timestamp' },
    actor_code: { type: 'string', required: true, label: 'Actor Code' },
    period_id:  { type: 'string', required: true, pattern: /^\d{4}-\d{2}$/, label: 'Period ID' },
    invoice_id: { type: 'string', required: true, label: 'Invoice ID' }
  };

  // ============================================================
  // SECTION 1: RATE CACHE
  //
  // Built once per run from DIM_CLIENT_RATES.
  //
  // Cache shape:
  //   { 'AXYZCO:LOGO': { hourly_rate: 150, currency: 'CAD' },  // specific
  //     'AXYZCO:':     { hourly_rate: 120, currency: 'CAD' } }  // flat fallback
  //
  // Key format: '{client_code}:{product_code}'
  //   product_code is '' for flat-rate rows.
  // ============================================================

  /**
   * Loads all active rows from DIM_CLIENT_RATES and builds a lookup map.
   *
   * @returns {Object}  rate cache map
   */
  function buildRateCache_() {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.DIM_CLIENT_RATES, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') {
        Logger.warn('BILLING_NO_RATE_TABLE', {
          module:  MODULE,
          message: 'DIM_CLIENT_RATES sheet not found — run runSetup() first'
        });
        return {};
      }
      throw e;
    }

    var cache = {};
    for (var i = 0; i < rows.length; i++) {
      var row    = rows[i];
      var active = String(row.active || '').toUpperCase();
      if (active !== 'TRUE' && active !== 'YES' && active !== '1') continue;

      var clientCode  = String(row.client_code  || '').toUpperCase().trim();
      var productCode = String(row.product_code || '').toUpperCase().trim();
      var rate        = parseFloat(row.hourly_rate) || 0;
      var currency    = String(row.currency || 'CAD').toUpperCase().trim();

      if (!clientCode) continue;

      var key = clientCode + ':' + productCode;
      // If duplicate keys, highest rate wins (conservative for billing)
      if (!cache[key] || rate > cache[key].hourly_rate) {
        cache[key] = { hourly_rate: rate, currency: currency };
      }
    }

    return cache;
  }

  /**
   * Resolves the hourly rate for a given client + product.
   * Priority 1: client_code + product_code (specific override)
   * Priority 2: client_code + '' (flat rate fallback)
   *
   * @param {Object} rateCache
   * @param {string} clientCode
   * @param {string} productCode
   * @returns {{ hourly_rate: number, currency: string }|null}
   */
  function resolveRate_(rateCache, clientCode, productCode) {
    var client  = String(clientCode  || '').toUpperCase().trim();
    var product = String(productCode || '').toUpperCase().trim();

    // Try specific: client + product
    var specificKey = client + ':' + product;
    if (rateCache[specificKey]) return rateCache[specificKey];

    // Fallback: client flat rate
    var flatKey = client + ':';
    if (rateCache[flatKey]) return rateCache[flatKey];

    return null;
  }

  // ============================================================
  // SECTION 2: HOURS CACHE
  //
  // Reads FACT_WORK_LOGS for the billing period.
  // Returns total hours summed per job_number.
  // Shape: { 'BLC-00001': 8.5, 'BLC-00002': 3.25 }
  // ============================================================

  /**
   * @param {string} periodId  YYYY-MM
   * @returns {Object}  { jobNumber → totalHours }
   */
  function buildHoursCache_(periodId) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: MODULE,
        periodId:     periodId
      });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return {};
      throw e;
    }

    var hoursMap = {};
    for (var i = 0; i < rows.length; i++) {
      var jobNum = String(rows[i].job_number || '');
      var hours  = parseFloat(rows[i].hours) || 0;
      if (!jobNum) continue;
      hoursMap[jobNum] = (hoursMap[jobNum] || 0) + hours;
    }
    return hoursMap;
  }

  // ============================================================
  // SECTION 3: IDEMPOTENCY
  // ============================================================

  function buildIdempotencyKey_(jobNumber, periodId) {
    return 'BILLING|' + jobNumber + '|' + periodId;
  }

  function isBilled_(idempotencyKey, periodId) {
    try {
      var existing = DAL.readWhere(
        Config.TABLES.FACT_BILLING_LEDGER,
        { idempotency_key: idempotencyKey },
        { periodId: periodId }
      );
      return existing.length > 0;
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return false;
      throw e;
    }
  }

  // ============================================================
  // SECTION 4: BILLING RECORD BUILDER
  // ============================================================

  /**
   * @param {Object} job             VW_JOB_CURRENT_STATE row
   * @param {number} totalHours      Summed from FACT_WORK_LOGS
   * @param {Object} rateInfo        { hourly_rate, currency }
   * @param {Object} actor           Resolved RBAC actor
   * @param {string} periodId
   * @param {string} invoiceId       Shared run-level invoice ID
   * @param {string} idempotencyKey
   * @returns {Object}
   */
  function buildBillingRow_(job, totalHours, rateInfo, actor, periodId, invoiceId, idempotencyKey) {
    var amount = Math.round(totalHours * rateInfo.hourly_rate * 100) / 100;

    return {
      event_id:        Identifiers.generateId(),
      job_number:      job.job_number,
      period_id:       periodId,
      event_type:      'INVOICE_CREATED',
      timestamp:       new Date().toISOString(),
      actor_code:      actor.personCode || '',
      actor_role:      actor.role       || '',
      client_code:     job.client_code  || '',
      amount:          amount,
      currency:        rateInfo.currency,
      invoice_id:      invoiceId,
      notes:           '',
      idempotency_key: idempotencyKey,
      payload_json:    JSON.stringify({
        product_code:  job.product_code,
        total_hours:   totalHours,
        hourly_rate:   rateInfo.hourly_rate,
        line_total:    amount
      })
    };
  }

  // ============================================================
  // SECTION 5: MART REFRESH
  //
  // Rebuilds MART_BILLING_SUMMARY from the full FACT_BILLING_LEDGER
  // for the period. Groups by client_code + currency separately
  // so CAD and USD totals are never merged.
  // ============================================================

  function refreshMartBillingSummary_(periodId) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_BILLING_LEDGER, {
        callerModule: MODULE,
        periodId:     periodId
      });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return;
      throw e;
    }

    // Aggregate: { 'AXYZCO:CAD' → { client_code, total_amount, currency } }
    var totals = {};
    for (var i = 0; i < rows.length; i++) {
      var row      = rows[i];
      var client   = String(row.client_code || 'UNKNOWN');
      var currency = String(row.currency    || 'CAD').toUpperCase();
      var amount   = parseFloat(row.amount) || 0;
      var aggKey   = client + ':' + currency;
      if (!totals[aggKey]) totals[aggKey] = { client_code: client, total_amount: 0, currency: currency };
      totals[aggKey].total_amount += amount;
    }

    var updatedAt = new Date().toISOString();
    var martRows  = [];
    var keys      = Object.keys(totals);
    for (var j = 0; j < keys.length; j++) {
      var t = totals[keys[j]];
      martRows.push({
        period_id:    periodId,
        client_code:  t.client_code,
        total_amount: Math.round(t.total_amount * 100) / 100,
        currency:     t.currency,
        updated_at:   updatedAt
      });
    }

    // Clear MART data rows (keep header), then append fresh aggregates.
    // NOTE: DAL does not yet expose a clearSheet() method, so this uses SpreadsheetApp
    // directly. This is an acknowledged A2 exception scoped to MART (non-FACT projection
    // tables). WriteGuard and CacheManager are not required here — MART is rebuilt from
    // FACT_BILLING_LEDGER on every run and carries no audit-trail obligation.
    // TODO: add DAL.clearSheet() and migrate this call when implemented.
    try {
      Logger.info('BILLING_MART_CLEAR_START', {
        module:    MODULE,
        message:   'Clearing MART_BILLING_SUMMARY before refresh',
        period_id: periodId
      });
      var ss      = SpreadsheetApp.getActiveSpreadsheet();
      var martTab = ss.getSheetByName(Config.TABLES.MART_BILLING_SUMMARY);
      if (martTab && martTab.getLastRow() > 1) {
        martTab.deleteRows(2, martTab.getLastRow() - 1);
      }
      Logger.info('BILLING_MART_CLEAR_DONE', {
        module:    MODULE,
        message:   'MART_BILLING_SUMMARY cleared',
        period_id: periodId
      });
    } catch (e) {
      Logger.warn('BILLING_MART_CLEAR_FAILED', {
        module:  MODULE,
        message: 'Could not clear MART_BILLING_SUMMARY — will append duplicate rows',
        error:   e.message
      });
    }

    if (martRows.length > 0) {
      DAL.appendRows(Config.TABLES.MART_BILLING_SUMMARY, martRows, { callerModule: MODULE });
    }

    Logger.info('BILLING_MART_REFRESHED', {
      module:    MODULE,
      message:   'MART_BILLING_SUMMARY refreshed',
      period_id: periodId,
      rows:      martRows.length
    });
  }

  // ============================================================
  // SECTION 6: runBillingRun — MAIN ENTRY POINT
  // ============================================================

  /**
   * Runs a billing pass for all COMPLETED_BILLABLE jobs.
   * Safe to run multiple times — idempotent per job per period.
   *
   * @param {string} actorEmail
   * @param {Object} [options]
   * @param {string} [options.periodId]  Default: current period
   * @returns {{
   *   processed:    number,
   *   skipped:      number,
   *   errors:       string[],
   *   by_currency:  Object,
   *   invoice_id:   string,
   *   period_id:    string
   * }}
   */
  function runBillingRun(actorEmail, options) {
    options = options || {};
    HealthMonitor.startExecution(MODULE);

    try {
      // ── 1. Auth ──────────────────────────────────────────
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.BILLING_RUN);

      var periodId  = options.periodId || Identifiers.generateCurrentPeriodId();

      // Resolve a stable invoice group ID for this period.
      // Re-runs reuse the same ID so all jobs billed for a period share
      // one invoice_id — partial-run + retry does not split the invoice.
      // Downstream: always group client invoices by period_id; invoice_id
      // is a grouping convenience only, not the billing authority.
      var invoiceGroupKey = 'INVOICE_GROUP_' + periodId;
      var invoiceId       = PropertiesService.getScriptProperties().getProperty(invoiceGroupKey);
      if (!invoiceId) {
        invoiceId = Identifiers.generateId();
        PropertiesService.getScriptProperties().setProperty(invoiceGroupKey, invoiceId);
        Logger.info('BILLING_INVOICE_GROUP_CREATED', {
          module:     MODULE,
          message:    'New invoice group ID created for period',
          period_id:  periodId,
          invoice_id: invoiceId
        });
      } else {
        Logger.info('BILLING_INVOICE_GROUP_REUSED', {
          module:     MODULE,
          message:    'Reusing invoice group ID for period (re-run)',
          period_id:  periodId,
          invoice_id: invoiceId
        });
      }

      Logger.info('BILLING_RUN_START', {
        module:     MODULE,
        message:    'Billing run started',
        period_id:  periodId,
        invoice_id: invoiceId,
        actor:      actorEmail
      });

      // ── 2. Load rate cache ───────────────────────────────
      var rateCache  = buildRateCache_();
      var rateCount  = Object.keys(rateCache).length;

      if (rateCount === 0) {
        Logger.warn('BILLING_NO_RATES', {
          module:  MODULE,
          message: 'DIM_CLIENT_RATES is empty — add client rates before running billing'
        });
      }

      // ── 3. Load hours cache ──────────────────────────────
      var hoursCache  = buildHoursCache_(periodId);
      var hoursCount  = Object.keys(hoursCache).length;

      Logger.info('BILLING_CACHES_LOADED', {
        module:      MODULE,
        rate_count:  rateCount,
        hours_count: hoursCount,
        period_id:   periodId
      });

      if (hoursCount === 0) {
        Logger.warn('BILLING_NO_WORK_LOGS', {
          module:    MODULE,
          message:   'No work log hours found for period — all jobs will bill at $0. Check FACT_WORK_LOGS partition.',
          period_id: periodId
        });
      }

      // ── 4. Load COMPLETED_BILLABLE jobs ──────────────────
      var allJobs      = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
      var billableJobs = allJobs.filter(function (j) {
        return j.current_state === Config.STATES.COMPLETED_BILLABLE;
      });

      Logger.info('BILLING_JOBS_FOUND', {
        module:   MODULE,
        message:  'Billable jobs loaded',
        billable: billableJobs.length
      });

      // ── 5. Ensure FACT partition ─────────────────────────
      DAL.ensurePartition(Config.TABLES.FACT_BILLING_LEDGER, periodId, MODULE);

      // ── 6. Process each job ──────────────────────────────
      var processed  = 0;
      var skipped    = 0;
      var errors     = [];
      var byCurrency = {};  // { 'CAD': 0.00, 'USD': 0.00 }
      var wasPartial = false;

      for (var i = 0; i < billableJobs.length; i++) {

        if (HealthMonitor.isApproachingLimit()) {
          HealthMonitor.checkLimits();
          wasPartial = true;
          Logger.warn('BILLING_RUN_TRUNCATED', {
            module:    MODULE,
            message:   'Billing run truncated by quota limit — re-run to process remaining jobs',
            processed: processed,
            remaining: billableJobs.length - i,
            period_id: periodId,
            invoice_id: invoiceId
          });
          break;
        }

        var job            = billableJobs[i];
        var jobNumber      = job.job_number;
        var idempotencyKey = buildIdempotencyKey_(jobNumber, periodId);

        try {
          // Fast path: check without lock (optimisation — avoids lock overhead on re-runs).
          // This is not the correctness gate; the re-check inside the lock is.
          if (isBilled_(idempotencyKey, periodId)) {
            skipped++;
            continue;
          }

          // Resolve rate (client+product, then client flat)
          var clientCode  = String(job.client_code  || '').toUpperCase().trim();
          var productCode = String(job.product_code || '').toUpperCase().trim();
          var rateInfo    = resolveRate_(rateCache, clientCode, productCode);

          if (!rateInfo) {
            Logger.warn('BILLING_NO_RATE', {
              module:       MODULE,
              message:      'No active rate for client — job skipped. Add a row to DIM_CLIENT_RATES.',
              job_number:   jobNumber,
              client_code:  clientCode,
              product_code: productCode
            });
            errors.push(jobNumber + ': no rate for client "' + clientCode + '"');
            skipped++;
            continue;
          }

          // Get total hours for this job
          var totalHours = hoursCache[jobNumber] || 0;
          if (totalHours === 0) {
            if (!options.allowZeroHours) {
              // Block: do not write a $0 invoice row and do not transition to INVOICED.
              // Job stays COMPLETED_BILLABLE so work logs can be added and billing re-run.
              // Pass options.allowZeroHours = true to override for intentional $0 billing.
              Logger.error('BILLING_ZERO_HOURS', {
                module:      MODULE,
                message:     'Job blocked — no work log hours found for period. Add work logs and re-run, or pass allowZeroHours:true to force.',
                job_number:  jobNumber,
                client_code: clientCode,
                invoice_id:  invoiceId,
                period_id:   periodId
              });
              errors.push(jobNumber + ': blocked — no hours logged for period ' + periodId);
              skipped++;
              continue;
            }
            // allowZeroHours override: proceed but still surface as an error.
            Logger.error('BILLING_ZERO_HOURS_OVERRIDE', {
              module:      MODULE,
              message:     'Job billed at $0 — allowZeroHours override active. Do not send to client without review.',
              job_number:  jobNumber,
              client_code: clientCode,
              invoice_id:  invoiceId,
              period_id:   periodId
            });
          }

          // Build the billing row before acquiring the lock (no shared state involved).
          var billingRow = buildBillingRow_(
            job, totalHours, rateInfo, actor, periodId, invoiceId, idempotencyKey
          );

          // Correctness gate: re-check inside a script lock so the isBilled_ read
          // and the appendRow write are atomic. A concurrent run that passed the
          // fast-path check above will block here; once it acquires the lock it will
          // find isBilled_ = true and skip cleanly.
          // waitLock(8000) throws LockTimeoutException if the lock is not free within
          // 8 s — the outer catch handles this as BILLING_JOB_ERROR and the job
          // remains COMPLETED_BILLABLE for the next run.
          var lock     = LockService.getScriptLock();
          var acquired = false;
          try {
            lock.waitLock(8000);
            acquired = true;

            if (isBilled_(idempotencyKey, periodId)) {
              skipped++;
              continue; // finally releases the lock before the loop continues
            }

            // Rule A4: validate before every FACT write.
            // Throws ValidationError if any required field is absent or malformed —
            // caught by the outer per-job catch, logged as BILLING_JOB_ERROR.
            ValidationEngine.validate(BILLING_LEDGER_SCHEMA, billingRow, { module: MODULE });

            DAL.appendRow(
              Config.TABLES.FACT_BILLING_LEDGER,
              billingRow,
              { callerModule: MODULE, periodId: periodId }
            );
          } finally {
            if (acquired) lock.releaseLock();
          }

          // Guard: assert COMPLETED_BILLABLE → INVOICED is a valid transition
          // before writing any FACT event. Throws INVALID_TRANSITION if not.
          StateMachine.assertTransition(
            Config.STATES.COMPLETED_BILLABLE,
            Config.STATES.INVOICED,
            { jobNumber: jobNumber }
          );

          // Write INVOICED transition to FACT_JOB_EVENTS — this is the
          // source of truth. EventReplayEngine rebuilds VW from this row,
          // not from the VW updateWhere below.
          var invoicedEvent = {
            event_id:     Identifiers.generateId(),
            job_number:   jobNumber,
            event_type:   Config.STATES.INVOICED,
            from_state:   Config.STATES.COMPLETED_BILLABLE,
            to_state:     Config.STATES.INVOICED,
            timestamp:    billingRow.timestamp,
            actor_code:   actor.personCode || '',
            actor_role:   actor.role       || '',
            period_id:    periodId,
            invoice_id:   invoiceId,
            payload_json: JSON.stringify({ billing_event_id: billingRow.event_id })
          };

          // Rule A4: validate before FACT_JOB_EVENTS write.
          ValidationEngine.validate(INVOICED_EVENT_SCHEMA, invoicedEvent, { module: MODULE });

          DAL.appendRow(
            Config.TABLES.FACT_JOB_EVENTS,
            invoicedEvent,
            { callerModule: MODULE }
          );

          // Update the VW projection from the FACT event just written.
          // If this fails, FACT_JOB_EVENTS already holds the transition —
          // EventReplayEngine can reconstruct INVOICED on next VW rebuild.
          DAL.updateWhere(
            Config.TABLES.VW_JOB_CURRENT_STATE,
            { job_number: jobNumber },
            {
              current_state: Config.STATES.INVOICED,
              prev_state:    Config.STATES.COMPLETED_BILLABLE,
              updated_at:    billingRow.timestamp
            },
            { callerModule: MODULE }
          );

          // Accumulate by currency
          var cur = rateInfo.currency;
          byCurrency[cur] = Math.round(((byCurrency[cur] || 0) + billingRow.amount) * 100) / 100;
          processed++;

          Logger.info('BILLING_JOB_BILLED', {
            module:      MODULE,
            message:     'Job billed',
            job_number:  jobNumber,
            hours:       totalHours,
            rate:        rateInfo.hourly_rate,
            amount:      billingRow.amount,
            currency:    cur,
            invoice_id:  invoiceId
          });

        } catch (jobErr) {
          Logger.error('BILLING_JOB_ERROR', {
            module:     MODULE,
            message:    'Error billing job — skipping',
            job_number: jobNumber,
            error:      jobErr.message
          });
          errors.push(jobNumber + ': ' + jobErr.message);
          skipped++;
        }

      } // end for

      // ── 7. Refresh MART ──────────────────────────────────
      // Refresh even on re-runs (skipped > 0) in case ledger rows were corrected manually.
      if (processed > 0 || skipped > 0) {
        refreshMartBillingSummary_(periodId);
      }

      var result = {
        processed:   processed,
        skipped:     skipped,
        errors:      errors,
        by_currency: byCurrency,
        invoice_id:  invoiceId,
        period_id:   periodId,
        partial:     wasPartial
      };

      Logger.info('BILLING_RUN_COMPLETE', {
        module:       MODULE,
        message:      wasPartial ? 'Billing run complete (partial — re-run required)' : 'Billing run complete',
        processed:    processed,
        skipped:      skipped,
        error_count:  errors.length,
        by_currency:  JSON.stringify(byCurrency),
        invoice_id:   invoiceId,
        period_id:    periodId,
        partial:      wasPartial,
        elapsed_ms:   (HealthMonitor.getStatus() || {}).elapsedMs || 0
      });

      return result;

    } finally {
      HealthMonitor.endExecution();
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    runBillingRun: runBillingRun
  };

}());
