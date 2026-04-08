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

    // Clear MART data rows (keep header), then append fresh aggregates
    try {
      var ss      = SpreadsheetApp.getActiveSpreadsheet();
      var martTab = ss.getSheetByName(Config.TABLES.MART_BILLING_SUMMARY);
      if (martTab && martTab.getLastRow() > 1) {
        martTab.deleteRows(2, martTab.getLastRow() - 1);
      }
    } catch (e) {
      Logger.warn('BILLING_MART_CLEAR_FAILED', {
        module:  MODULE,
        message: 'Could not clear MART_BILLING_SUMMARY — will append',
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
      var invoiceId = Identifiers.generateId();

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
      var hoursCache = buildHoursCache_(periodId);

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

      for (var i = 0; i < billableJobs.length; i++) {

        if (HealthMonitor.isApproachingLimit()) {
          HealthMonitor.checkLimits();
          Logger.warn('BILLING_RUN_PARTIAL', {
            module:    MODULE,
            message:   'Stopping early — quota limit approaching',
            processed: processed,
            remaining: billableJobs.length - i
          });
          break;
        }

        var job            = billableJobs[i];
        var jobNumber      = job.job_number;
        var idempotencyKey = buildIdempotencyKey_(jobNumber, periodId);

        try {
          // Skip already-billed
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
            Logger.warn('BILLING_ZERO_HOURS', {
              module:     MODULE,
              message:    'No work log hours found for job — billed at $0. Log hours or contact PM.',
              job_number: jobNumber
            });
          }

          // Build + write billing record
          var billingRow = buildBillingRow_(
            job, totalHours, rateInfo, actor, periodId, invoiceId, idempotencyKey
          );
          DAL.appendRow(
            Config.TABLES.FACT_BILLING_LEDGER,
            billingRow,
            { callerModule: MODULE, periodId: periodId }
          );

          // Transition VW → INVOICED
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
      if (processed > 0) {
        refreshMartBillingSummary_(periodId);
      }

      var result = {
        processed:   processed,
        skipped:     skipped,
        errors:      errors,
        by_currency: byCurrency,
        invoice_id:  invoiceId,
        period_id:   periodId
      };

      Logger.info('BILLING_RUN_COMPLETE', {
        module:  MODULE,
        message: 'Billing run complete',
        result:  JSON.stringify(result)
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
