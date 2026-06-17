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
// ║  Billing model: semi-monthly periods                    ║
// ║    2026-06A = June 1–15                                 ║
// ║    2026-06B = June 16–30                                ║
// ║                                                         ║
// ║  Bill ALL jobs that have hours logged in the period,    ║
// ║  regardless of job state. Only COMPLETED_BILLABLE jobs  ║
// ║  are transitioned to INVOICED. In-progress jobs stay    ║
// ║  in their current state and can be billed again in the  ║
// ║  next period for new hours.                             ║
// ║                                                         ║
// ║  runBillingRun(actorEmail, options)                     ║
// ║    1. Parse semi-monthly period → fromDate, toDate      ║
// ║    2. Load DIM_CLIENT_RATES → rate cache                ║
// ║    3. Sum FACT_WORK_LOGS hours per job (date-filtered)  ║
// ║    4. For each job with hours > 0 in period:            ║
// ║         a. Resolve rate (client+product, then client)   ║
// ║         b. amount = total_hours × hourly_rate           ║
// ║         c. Write FACT_BILLING_LEDGER (with job_status)  ║
// ║         d. If COMPLETED_BILLABLE → transition INVOICED  ║
// ║    5. Refresh MART_BILLING_SUMMARY aggregate            ║
// ║                                                         ║
// ║  Permission: BILLING_RUN (PM + CEO)                     ║
// ╚══════════════════════════════════════════════════════════╝
//
// PERIOD IDs:
//   Semi-monthly: '2026-06A' (1st–15th), '2026-06B' (16th–end)
//   FACT_BILLING_LEDGER is partitioned monthly: |2026-06
//   ensurePartition / isBilled_ always use the monthPartition.
//
// RATE LOOKUP (DIM_CLIENT_RATES):
//   Most specific match wins.
//   Priority 1: client_code + product_code match
//   Priority 2: client_code match + product_code blank (flat rate)
//   If no rate found: job is skipped with WARN.
//
// IDEMPOTENCY:
//   Key: BILLING|{job_number}|{periodId}  (e.g. BILLING|BLC-00001|2026-06A)
//   Re-running the engine skips already-billed jobs safely.
// ============================================================

var BillingEngine = (function () {

  var MODULE = 'BillingEngine';

  // ============================================================
  // PRIVATE SCHEMAS — used by ValidationEngine.validate()
  // Rule A4: validate before every FACT table write.
  // ============================================================

  var BILLING_LEDGER_SCHEMA = {
    event_id:        { type: 'string', required: true,  label: 'Event ID' },
    job_number:      { type: 'string', required: true,  label: 'Job Number' },
    period_id:       { type: 'string', required: true,  pattern: /^\d{4}-\d{2}[AB]$/, label: 'Period ID' },
    event_type:      { type: 'string', required: true,  label: 'Event Type' },
    timestamp:       { type: 'string', required: true,  label: 'Timestamp' },
    actor_code:      { type: 'string', required: true,  label: 'Actor Code' },
    client_code:     { type: 'string', required: true,  minLength: 2, label: 'Client Code' },
    amount:          { type: 'number', required: true,  min: 0, label: 'Amount' },
    currency:        { type: 'string', required: true,  allowedValues: ['CAD', 'USD'], label: 'Currency' },
    invoice_id:      { type: 'string', required: true,  label: 'Invoice ID' },
    job_status:      { type: 'string', required: true,  allowedValues: ['COMPLETED', 'IN_PROGRESS'], label: 'Job Status' },
    idempotency_key: { type: 'string', required: true,  label: 'Idempotency Key' }
  };

  var INVOICED_EVENT_SCHEMA = {
    event_id:   { type: 'string', required: true, label: 'Event ID' },
    job_number: { type: 'string', required: true, label: 'Job Number' },
    event_type: { type: 'string', required: true, label: 'Event Type' },
    from_state: { type: 'string', required: true, label: 'From State' },
    to_state:   { type: 'string', required: true, label: 'To State' },
    timestamp:  { type: 'string', required: true, label: 'Timestamp' },
    actor_code: { type: 'string', required: true, label: 'Actor Code' },
    period_id:  { type: 'string', required: true, pattern: /^\d{4}-\d{2}[AB]$/, label: 'Period ID' },
    invoice_id: { type: 'string', required: true, label: 'Invoice ID' }
  };

  // ============================================================
  // SECTION 0: PERIOD HELPERS
  //
  // Semi-monthly period IDs:
  //   2026-06A → June  1–15
  //   2026-06B → June 16–30
  //
  // FACT_BILLING_LEDGER is partitioned monthly (|2026-06).
  // parseSemiMonthlyPeriod_ returns monthPartition for all
  // DAL partition calls; the semi-monthly periodId is stored
  // as a field value inside each row.
  // ============================================================

  /**
   * Parses a semi-monthly period ID into date bounds and the
   * monthly partition key used by FACT_BILLING_LEDGER.
   *
   * @param {string} periodId  e.g. '2026-06A' or '2026-06B'
   * @returns {{ fromDate: Date, toDate: Date, monthPartition: string, year: number }}
   * @throws  If periodId is not a valid semi-monthly ID
   */
  function parseSemiMonthlyPeriod_(periodId) {
    var m = periodId.match(/^(\d{4})-(\d{2})([AB])$/);
    if (!m) {
      throw new Error('BillingEngine: invalid semi-monthly period ID "' + periodId +
                      '". Expected format: YYYY-MM[A|B] e.g. 2026-06A');
    }
    var year     = parseInt(m[1], 10);
    var monthIdx = parseInt(m[2], 10) - 1;  // JS months are 0-indexed
    var half     = m[3];

    var fromDate, toDate;
    if (half === 'A') {
      fromDate = new Date(year, monthIdx, 1);
      toDate   = new Date(year, monthIdx, 15);
    } else {
      fromDate = new Date(year, monthIdx, 16);
      toDate   = new Date(year, monthIdx + 1, 0);  // day 0 of next month = last day
    }

    return {
      fromDate:       fromDate,
      toDate:         toDate,
      monthPartition: m[1] + '-' + m[2],
      year:           year
    };
  }

  /**
   * Returns the semi-monthly period ID for the current date.
   * Day 1–15  → 'YYYY-MMA'
   * Day 16–31 → 'YYYY-MMB'
   *
   * @returns {string}  e.g. '2026-06A'
   */
  function generateCurrentBillingPeriodId() {
    var now   = new Date();
    var year  = now.getFullYear();
    var month = now.getMonth() + 1;
    var mm    = month < 10 ? '0' + month : String(month);
    var half  = now.getDate() <= 15 ? 'A' : 'B';
    return year + '-' + mm + half;
  }

  /**
   * Converts a Date to an integer YYYYMMDD for timezone-safe comparisons.
   * Uses local time — same as the dates constructed in parseSemiMonthlyPeriod_.
   *
   * @param {Date} d
   * @returns {number}  e.g. 20260615
   */
  function dateToYMD_(d) {
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  /**
   * Parses a work_date value to a Date object for range comparisons.
   * Handles:
   *   - Date objects (Google Sheets may return date cells as Date)
   *   - ISO strings: '2026-06-15' or '2026-06-15T00:00:00.000Z'
   *   - Mangled Date.toString() fragments: 'Mon Jun 01' (BATCH-004 legacy)
   *
   * All dates are returned in local time to match parseSemiMonthlyPeriod_.
   *
   * @param {Date|string} raw
   * @param {number}      fallbackYear  used when parsing yearless strings
   * @returns {Date|null}
   */
  function parseWorkDate_(raw, fallbackYear) {
    if (!raw) return null;

    // Google Sheets can return date cells as Date objects
    if (raw instanceof Date) {
      return isNaN(raw.getTime()) ? null : raw;
    }

    var s = String(raw).trim();
    if (!s) return null;

    // Fast path: YYYY-MM-DD (preferred — portal-submitted work logs)
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      return new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
    }

    // Mangled Date.toString() like 'Mon Jun 01' (BATCH-004 rows not fully patched)
    // Pattern: 3-char weekday + space + 3-char month + space + 1-2 digit day
    var MONTH_MAP = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
                      jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
    var mangled = s.match(/[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})/);
    if (mangled) {
      var monthIdx = MONTH_MAP[mangled[1].toLowerCase()];
      if (monthIdx !== undefined) {
        return new Date(fallbackYear || new Date().getFullYear(), monthIdx, parseInt(mangled[2], 10));
      }
    }

    // Last resort: JS Date parser (handles many formats)
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // ============================================================
  // SECTION 1: RATE CACHE
  //
  // Built once per run from DIM_CLIENT_RATES.
  //
  // Cache shape:
  //   { 'AXYZCO:LOGO': { hourly_rate: 150, currency: 'CAD' },
  //     'AXYZCO:':     { hourly_rate: 120, currency: 'CAD' } }
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

    var specificKey = client + ':' + product;
    if (rateCache[specificKey]) return rateCache[specificKey];

    var flatKey = client + ':';
    if (rateCache[flatKey]) return rateCache[flatKey];

    return null;
  }

  // ============================================================
  // SECTION 2: HOURS CACHE
  //
  // Reads FACT_WORK_LOGS for the monthly partition but filters
  // rows to the semi-monthly date range [fromDate, toDate].
  //
  // Migration rows (migration_batch set) are excluded from
  // billing — they represent historical data already captured
  // in Stacey V2.
  //
  // Returns: { 'BLC-00001': 8.5, 'NL-01': 3.25, ... }
  // ============================================================

  /**
   * @param {string} monthPartition  e.g. '2026-06'
   * @param {Date}   fromDate        inclusive start of billing period
   * @param {Date}   toDate          inclusive end of billing period
   * @param {number} year            used for yearless date parsing
   * @returns {Object}  { jobNumber → totalHours }
   */
  function buildHoursCache_(monthPartition, fromDate, toDate, year, jobLookup) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: MODULE,
        periodId:     monthPartition
      });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return {};
      throw e;
    }

    var fromYMD = dateToYMD_(fromDate);
    var toYMD   = dateToYMD_(toDate);

    // BTD and SNA are legacy wrong actor codes whose WORK_LOG_MIGRATED rows were
    // superseded by WORK_LOG_AMENDED rows (runFixBTDtoBIT, runFixSNAtoSVN).
    // Skip those originals to avoid double-counting. Same pattern as ClientTimesheetEngine.
    // FACT_WORK_LOGS schema drops migration_batch so it cannot be used as a filter.
    var SUPERSEDED_MIGRATED = { 'BTD': true, 'SNA': true };

    var hoursMap = {};
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var evType  = String(row.event_type  || '');
      var actCode = String(row.actor_code  || '').trim().toUpperCase();
      if (evType === 'WORK_LOG_MIGRATED' && SUPERSEDED_MIGRATED[actCode]) continue;

      var parsedDate = parseWorkDate_(row.work_date, year);
      if (!parsedDate) {
        Logger.warn('BILLING_UNPARSEABLE_DATE', {
          module:    MODULE,
          job:       row.job_number,
          work_date: String(row.work_date)
        });
        continue;
      }

      var ymd = dateToYMD_(parsedDate);
      if (ymd < fromYMD || ymd > toYMD) continue;

      // Strip description suffixes e.g. "2605-6039-A Mary's Landing Lot 9 OWF"
      var jobNum = String(row.job_number || '').trim().split(/\s+/)[0];
      var hours  = parseFloat(row.hours);
      if (!jobNum || isNaN(hours) || hours === 0) continue;

      // Allow negative hours: runUndoDuplicateDBGFix writes negative WORK_LOG_AMENDED
      // events to cancel erroneous duplicate corrections. Accumulating them correctly
      // nets out the duplicates without needing explicit exclusion rules.
      hoursMap[jobNum] = (hoursMap[jobNum] || 0) + hours;
    }

    // Remove jobs that netted to zero or negative (fully reversed corrections)
    var filtered = {};
    var mapKeys  = Object.keys(hoursMap);
    for (var k = 0; k < mapKeys.length; k++) {
      if (hoursMap[mapKeys[k]] > 0) filtered[mapKeys[k]] = hoursMap[mapKeys[k]];
    }
    return filtered;
  }

  // ============================================================
  // SECTION 3: IDEMPOTENCY
  // ============================================================

  function buildIdempotencyKey_(jobNumber, periodId) {
    return 'BILLING|' + jobNumber + '|' + periodId;
  }

  /**
   * @param {string} idempotencyKey
   * @param {string} monthPartition  e.g. '2026-06' — the sheet partition
   */
  function isBilled_(idempotencyKey, monthPartition) {
    try {
      var existing = DAL.readWhere(
        Config.TABLES.FACT_BILLING_LEDGER,
        { idempotency_key: idempotencyKey },
        { periodId: monthPartition }
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
   * @param {number} totalHours      Summed from FACT_WORK_LOGS for period
   * @param {Object} rateInfo        { hourly_rate, currency }
   * @param {Object} actor           Resolved RBAC actor
   * @param {string} periodId        Semi-monthly ID e.g. '2026-06A'
   * @param {string} invoiceId       Shared run-level invoice ID
   * @param {string} idempotencyKey
   * @param {string} jobStatus       'COMPLETED' or 'IN_PROGRESS'
   * @param {string} remarks         Human-readable billing note
   * @returns {Object}
   */
  function buildBillingRow_(job, totalHours, rateInfo, actor, periodId, invoiceId,
                             idempotencyKey, jobStatus, remarks) {
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
      job_status:      jobStatus,
      remarks:         remarks,
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
  // Reads ALL rows from the monthly partition of FACT_BILLING_LEDGER
  // so that running the B half does not erase A half aggregates.
  // Groups by client_code + currency + period_id so both halves
  // appear as separate rows in MART_BILLING_SUMMARY.
  // ============================================================

  /**
   * @param {string} monthPartition  e.g. '2026-06'
   */
  function refreshMartBillingSummary_(monthPartition) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_BILLING_LEDGER, {
        callerModule: MODULE,
        periodId:     monthPartition
      });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return;
      throw e;
    }

    // Aggregate: { 'AXYZCO:CAD:2026-06A' → totals object }
    var totals = {};
    for (var i = 0; i < rows.length; i++) {
      var row      = rows[i];
      var client   = String(row.client_code || 'UNKNOWN');
      var currency = String(row.currency    || 'CAD').toUpperCase();
      var pid      = String(row.period_id   || monthPartition);
      var amount   = parseFloat(row.amount) || 0;
      var aggKey   = client + ':' + currency + ':' + pid;
      if (!totals[aggKey]) {
        totals[aggKey] = { client_code: client, total_amount: 0, currency: currency, period_id: pid };
      }
      totals[aggKey].total_amount += amount;
    }

    var updatedAt = new Date().toISOString();
    var martRows  = [];
    var keys      = Object.keys(totals);
    for (var j = 0; j < keys.length; j++) {
      var t = totals[keys[j]];
      martRows.push({
        period_id:    t.period_id,
        client_code:  t.client_code,
        total_amount: Math.round(t.total_amount * 100) / 100,
        currency:     t.currency,
        updated_at:   updatedAt
      });
    }

    // Clear MART data rows (keep header), then write fresh aggregates.
    // NOTE: MART tables are non-FACT projections rebuilt from FACT every run.
    // Direct SpreadsheetApp access is an acknowledged A2 exception here.
    try {
      DAL.clearSheet(Config.TABLES.MART_BILLING_SUMMARY);
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
      module:         MODULE,
      month_partition: monthPartition,
      rows:           martRows.length
    });
  }

  // ============================================================
  // SECTION 6: runBillingRun — MAIN ENTRY POINT
  // ============================================================

  /**
   * Runs a billing pass for all jobs that have hours logged in
   * the semi-monthly period. Safe to re-run — idempotent per job per period.
   *
   * Only COMPLETED_BILLABLE jobs are transitioned to INVOICED.
   * In-progress jobs remain in their current state and accumulate
   * hours for subsequent period billing.
   *
   * @param {string} actorEmail
   * @param {Object} [options]
   * @param {string}  [options.periodId]  e.g. '2026-06A'. Default: current semi-monthly period.
   * @param {boolean} [options.dryRun]    true → compute only, no writes
   * @returns {{
   *   processed:    number,
   *   skipped:      number,
   *   errors:       string[],
   *   by_currency:  Object,
   *   invoice_id:   string,
   *   period_id:    string,
   *   dryRun:       boolean,
   *   partial:      boolean
   * }}
   */
  function runBillingRun(actorEmail, options) {
    options = options || {};
    HealthMonitor.startExecution(MODULE);

    try {
      // ── 1. Auth ──────────────────────────────────────────
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.BILLING_RUN);

      var dryRun   = options.dryRun === true;
      var periodId = options.periodId || generateCurrentBillingPeriodId();

      // Validate and parse the semi-monthly period
      var periodParts  = parseSemiMonthlyPeriod_(periodId);
      var fromDate     = periodParts.fromDate;
      var toDate       = periodParts.toDate;
      var monthPartition = periodParts.monthPartition;
      var year         = periodParts.year;

      // Stable invoice group ID for this period — re-runs reuse it so all jobs
      // in the same period share one invoice_id (grouping convenience only).
      var invoiceGroupKey = 'INVOICE_GROUP_' + periodId;
      var invoiceId       = PropertiesService.getScriptProperties().getProperty(invoiceGroupKey);
      if (!invoiceId) {
        invoiceId = Identifiers.generateId();
        if (!dryRun) {
          PropertiesService.getScriptProperties().setProperty(invoiceGroupKey, invoiceId);
        }
      }

      Logger.info('BILLING_RUN_START', {
        module:          MODULE,
        period_id:       periodId,
        month_partition: monthPartition,
        from:            fromDate.toISOString().substring(0, 10),
        to:              toDate.toISOString().substring(0, 10),
        invoice_id:      invoiceId,
        actor:           actorEmail,
        dry_run:         dryRun
      });

      // ── 2. Load rate cache ───────────────────────────────
      var rateCache = buildRateCache_();
      var rateCount = Object.keys(rateCache).length;
      if (rateCount === 0) {
        Logger.warn('BILLING_NO_RATES', {
          module:  MODULE,
          message: 'DIM_CLIENT_RATES is empty — add client rates before running billing'
        });
      }

      // ── 3. Build VW job lookup (moved before hours cache — needed for per-client filtering) ──
      var allVwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
      var jobLookup = {};
      for (var v = 0; v < allVwRows.length; v++) {
        jobLookup[allVwRows[v].job_number] = allVwRows[v];
      }

      // ── 4. Load hours cache (date-filtered to period) ────
      var hoursCache = buildHoursCache_(monthPartition, fromDate, toDate, year, jobLookup);
      var hoursCount = Object.keys(hoursCache).length;

      Logger.info('BILLING_CACHES_LOADED', {
        module:      MODULE,
        rate_count:  rateCount,
        hours_count: hoursCount,
        period_id:   periodId
      });

      if (hoursCount === 0) {
        Logger.warn('BILLING_NO_WORK_LOGS', {
          module:    MODULE,
          message:   'No work log hours found for period — nothing to bill. Check FACT_WORK_LOGS partition.',
          period_id: periodId
        });
      }

      // Candidate jobs: all jobs with hours > 0 in this period
      var jobsToProcess = Object.keys(hoursCache);

      Logger.info('BILLING_JOBS_FOUND', {
        module:   MODULE,
        billable: jobsToProcess.length,
        period_id: periodId
      });

      // ── 5. Ensure FACT partition (skip in dry-run) ───────
      if (!dryRun) {
        DAL.ensurePartition(Config.TABLES.FACT_BILLING_LEDGER, monthPartition, MODULE);
      }

      // ── 6. Process each job ──────────────────────────────
      var processed  = 0;
      var skipped    = 0;
      var errors     = [];
      var byCurrency = {};
      var wasPartial = false;

      for (var i = 0; i < jobsToProcess.length; i++) {

        if (HealthMonitor.isApproachingLimit()) {
          HealthMonitor.checkLimits();
          wasPartial = true;
          Logger.warn('BILLING_RUN_TRUNCATED', {
            module:    MODULE,
            message:   'Billing run truncated by quota limit — re-run to process remaining jobs',
            processed: processed,
            remaining: jobsToProcess.length - i,
            period_id: periodId
          });
          break;
        }

        var jobNumber = jobsToProcess[i];
        var job       = jobLookup[jobNumber];

        if (!job) {
          Logger.warn('BILLING_JOB_NOT_IN_VW', {
            module:     MODULE,
            job_number: jobNumber,
            period_id:  periodId,
            message:    'Job has hours in FACT_WORK_LOGS but not found in VW_JOB_CURRENT_STATE — skipped'
          });
          errors.push(jobNumber + ': not found in VW_JOB_CURRENT_STATE');
          skipped++;
          continue;
        }

        // Never re-bill terminal INVOICED jobs
        if (job.current_state === Config.STATES.INVOICED) {
          skipped++;
          continue;
        }

        var idempotencyKey = buildIdempotencyKey_(jobNumber, periodId);

        try {
          if (!dryRun && isBilled_(idempotencyKey, monthPartition)) {
            skipped++;
            continue;
          }

          var clientCode  = String(job.client_code  || '').toUpperCase().trim();
          var productCode = String(job.product_code || '').toUpperCase().trim();
          var rateInfo    = resolveRate_(rateCache, clientCode, productCode);

          if (!rateInfo) {
            Logger.warn('BILLING_NO_RATE', {
              module:       MODULE,
              message:      'No active rate for client — job skipped',
              job_number:   jobNumber,
              client_code:  clientCode,
              product_code: productCode
            });
            errors.push(jobNumber + ': no rate for client "' + clientCode + '"');
            skipped++;
            continue;
          }

          var totalHours  = hoursCache[jobNumber] || 0;
          if (totalHours <= 0) { skipped++; continue; }
          var isCompleted = job.current_state === Config.STATES.COMPLETED_BILLABLE;
          var jobStatus   = isCompleted ? 'COMPLETED' : 'IN_PROGRESS';
          var remarks     = isCompleted
            ? 'Job complete — invoiced'
            : 'Job in progress — partial billing ' + periodId;

          var billingRow = buildBillingRow_(
            job, totalHours, rateInfo, actor, periodId, invoiceId,
            idempotencyKey, jobStatus, remarks
          );

          if (!dryRun) {
            // Lock: atomic idempotency re-check + write
            var lock     = LockService.getScriptLock();
            var acquired = false;
            try {
              lock.waitLock(8000);
              acquired = true;

              if (isBilled_(idempotencyKey, monthPartition)) {
                skipped++;
                continue;
              }

              // Rule A4: validate before FACT write
              ValidationEngine.validate(BILLING_LEDGER_SCHEMA, billingRow, { module: MODULE });

              DAL.appendRow(
                Config.TABLES.FACT_BILLING_LEDGER,
                billingRow,
                { callerModule: MODULE, periodId: monthPartition }
              );
            } finally {
              if (acquired) lock.releaseLock();
            }

            // Transition COMPLETED_BILLABLE → INVOICED (only for completed jobs)
            if (isCompleted) {
              StateMachine.assertTransition(
                Config.STATES.COMPLETED_BILLABLE,
                Config.STATES.INVOICED,
                { jobNumber: jobNumber }
              );

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

              ValidationEngine.validate(INVOICED_EVENT_SCHEMA, invoicedEvent, { module: MODULE });

              // FACT_JOB_EVENTS is partitioned monthly — pass monthPartition explicitly
              // to prevent DAL from using data.period_id ('2026-06B') as the partition key.
              DAL.appendRow(
                Config.TABLES.FACT_JOB_EVENTS,
                invoicedEvent,
                { callerModule: MODULE, periodId: monthPartition }
              );

              // Update VW projection (FACT_JOB_EVENTS is the source of truth;
              // VW is a derived convenience — EventReplayEngine can rebuild if needed)
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
            }
          }

          var cur = rateInfo.currency;
          byCurrency[cur] = Math.round(((byCurrency[cur] || 0) + billingRow.amount) * 100) / 100;
          processed++;

          Logger.info('BILLING_JOB_BILLED', {
            module:      MODULE,
            job_number:  jobNumber,
            hours:       totalHours,
            rate:        rateInfo.hourly_rate,
            amount:      billingRow.amount,
            currency:    cur,
            job_status:  jobStatus,
            dry_run:     dryRun
          });

        } catch (jobErr) {
          Logger.error('BILLING_JOB_ERROR', {
            module:     MODULE,
            job_number: jobNumber,
            error:      jobErr.message
          });
          errors.push(jobNumber + ': ' + jobErr.message);
          skipped++;
        }

      } // end for

      // ── 7. Refresh MART (reads full month partition — covers both A and B) ──
      if (!dryRun && (processed > 0 || skipped > 0)) {
        refreshMartBillingSummary_(monthPartition);
      }

      var result = {
        processed:   processed,
        skipped:     skipped,
        errors:      errors,
        by_currency: byCurrency,
        invoice_id:  invoiceId,
        period_id:   periodId,
        dryRun:      dryRun,
        partial:     wasPartial
      };

      Logger.info('BILLING_RUN_COMPLETE', {
        module:       MODULE,
        message:      dryRun ? 'Billing dry run complete (no writes)' :
                      wasPartial ? 'Billing run complete (partial — re-run required)' :
                      'Billing run complete',
        processed:    processed,
        skipped:      skipped,
        error_count:  errors.length,
        by_currency:  JSON.stringify(byCurrency),
        invoice_id:   invoiceId,
        period_id:    periodId,
        dry_run:      dryRun,
        partial:      wasPartial
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
    runBillingRun:                  runBillingRun,
    generateCurrentBillingPeriodId_: generateCurrentBillingPeriodId,
    parseSemiMonthlyPeriod_:         parseSemiMonthlyPeriod_
  };

}());

// ============================================================
// RUNNER FUNCTIONS — call from Apps Script editor
// ============================================================

/**
 * Dry run: computes billing for 2026-06A (June 1–15), logs all amounts, writes nothing.
 * Run this first to verify totals before going live.
 */
function runBillingRunDryRun_06A() {
  var actorEmail = 'raj.nair@bluelotuscanada.ca';
  Logger.info('BILLING_DRY_RUN_MANUAL', { actor: actorEmail, period: '2026-06A' });
  var result = BillingEngine.runBillingRun(actorEmail, { periodId: '2026-06A', dryRun: true });
  Logger.info('BILLING_DRY_RUN_RESULT', { result: JSON.stringify(result) });
  console.log('DRY RUN RESULT: ' + JSON.stringify(result, null, 2));
}

/**
 * Live billing run for 2026-06A (June 1–15).
 * Run runBillingRunDryRun_06A() first and verify totals before calling this.
 */
function runBillingRunLive_06A() {
  var actorEmail = 'raj.nair@bluelotuscanada.ca';
  var result = BillingEngine.runBillingRun(actorEmail, { periodId: '2026-06A' });
  Logger.info('BILLING_MANUAL_RESULT', { result: JSON.stringify(result) });
  console.log('BILLING RESULT: ' + JSON.stringify(result, null, 2));
}

/**
 * Diagnostic: shows per-client, per-event-type hour breakdown for June 1-15.
 * Run this to identify why client totals differ from expected values.
 */
function runBillingWorkLogBreakdown_06A() {
  var MODULE    = 'BillingEngine';
  var fromYMD   = 20260601;
  var toYMD     = 20260615;
  var year      = 2026;
  var MONTH_MAP = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

  function pd_(raw) {
    if (!raw) return null;
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
    var s = String(raw).trim();
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(+iso[1], +iso[2]-1, +iso[3]);
    var mg = s.match(/[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})/);
    if (mg) { var mi = MONTH_MAP[mg[1].toLowerCase()]; if (mi !== undefined) return new Date(year, mi, +mg[2]); }
    return null;
  }
  function ymd_(d) { return d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate(); }

  var rows   = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: MODULE, periodId: '2026-06' });
  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  var jl = {};
  for (var v = 0; v < vwRows.length; v++) jl[vwRows[v].job_number] = vwRows[v];

  var byClient = {};
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var d = pd_(row.work_date);
    if (!d) continue;
    var wd = ymd_(d);
    if (wd < fromYMD || wd > toYMD) continue;
    var jn  = String(row.job_number || '').trim().split(/\s+/)[0];
    var hrs = parseFloat(row.hours) || 0;
    if (!jn || hrs <= 0) continue;
    var vw  = jl[jn];
    var cli = vw ? String(vw.client_code || '').toUpperCase().trim() : 'UNKNOWN';
    var evt = String(row.event_type || '');
    var act = String(row.actor_code || '').trim().toUpperCase();
    if (!byClient[cli]) byClient[cli] = {};
    var key = evt + '|' + act;
    byClient[cli][key] = (byClient[cli][key] || 0) + hrs;
  }

  var clients = Object.keys(byClient).sort();
  console.log('=== Work Log Breakdown June 1–15 by Client / Event+Actor ===');
  for (var c = 0; c < clients.length; c++) {
    var cli = clients[c];
    var entries = byClient[cli];
    var keys    = Object.keys(entries).sort();
    var total   = 0;
    for (var k = 0; k < keys.length; k++) total += entries[keys[k]];
    console.log('\n' + cli + ' — total ' + total + 'h');
    for (var k = 0; k < keys.length; k++) {
      console.log('  ' + keys[k] + ': ' + entries[keys[k]] + 'h');
    }
  }
}

/**
 * Dry run: computes billing for the current semi-monthly period,
 * logs all amounts, but writes nothing.
 * Run this first to verify before the live run.
 */
function runBillingRunDryRun() {
  var actorEmail = 'raj.nair@bluelotuscanada.ca';
  var periodId   = '';   // blank = current semi-monthly period
  Logger.info('BILLING_DRY_RUN_MANUAL', { actor: actorEmail, period: periodId || '(current)' });
  var result = BillingEngine.runBillingRun(actorEmail, { periodId: periodId, dryRun: true });
  Logger.info('BILLING_DRY_RUN_RESULT', { result: JSON.stringify(result) });
  console.log('DRY RUN RESULT: ' + JSON.stringify(result, null, 2));
}

/**
 * Live billing run for the current semi-monthly period.
 * Run runBillingRunDryRun() first to verify.
 *
 * To run a specific period: set periodId e.g. '2026-06A'
 */
function runBillingRunManual() {
  var actorEmail = 'raj.nair@bluelotuscanada.ca';
  var periodId   = '';   // blank = current semi-monthly period
  var result = BillingEngine.runBillingRun(actorEmail, { periodId: periodId });
  Logger.info('BILLING_MANUAL_RESULT', { result: JSON.stringify(result) });
  console.log('BILLING RESULT: ' + JSON.stringify(result, null, 2));
}

/**
 * ONE-TIME REPAIR: Write INVOICED events for jobs that were billed in
 * FACT_BILLING_LEDGER but whose INVOICED state transition was not written
 * to FACT_JOB_EVENTS (due to the WRITE_GUARD_DENIED bug in the first run).
 *
 * Safe to re-run — skips jobs already in INVOICED state in VW.
 * Run AFTER adding BillingEngine to FACT_JOB_EVENTS WRITE_PERMISSIONS.
 */
function runRepairInvoicedTransitions() {
  var MODULE         = 'BillingEngine';
  var periodId       = '2026-06B';
  var monthPartition = '2026-06';   // FACT_JOB_EVENTS partition is monthly — must pass explicitly
  var actorEmail     = 'raj.nair@bluelotuscanada.ca';
  var actor      = RBAC.resolveActor(actorEmail);

  // Jobs billed this period that are still COMPLETED_BILLABLE (transition not written)
  var stuckJobs = ['BLC-00184', 'BLC-00171', 'BLC-00186'];
  var repaired  = 0;

  for (var i = 0; i < stuckJobs.length; i++) {
    var jobNumber = stuckJobs[i];

    // Look up the billing row we already wrote to get the invoice_id
    var billingRows = [];
    try {
      billingRows = DAL.readWhere(
        Config.TABLES.FACT_BILLING_LEDGER,
        { job_number: jobNumber },
        { periodId: '2026-06' }
      );
    } catch (e) {
      console.log('ERROR reading billing row for ' + jobNumber + ': ' + e.message);
      continue;
    }

    // Filter to this semi-monthly period
    var billingRow = null;
    for (var b = 0; b < billingRows.length; b++) {
      if (String(billingRows[b].period_id || '') === periodId) {
        billingRow = billingRows[b];
        break;
      }
    }
    if (!billingRow) {
      console.log('SKIP ' + jobNumber + ' — no billing row found for ' + periodId);
      continue;
    }

    // Check VW — skip if already INVOICED
    var vwRows = [];
    try {
      vwRows = DAL.readWhere(Config.TABLES.VW_JOB_CURRENT_STATE, { job_number: jobNumber }, {});
    } catch (e) { /* ignore */ }
    var vwJob = vwRows[0] || null;
    if (vwJob && vwJob.current_state === Config.STATES.INVOICED) {
      console.log('SKIP ' + jobNumber + ' — already INVOICED in VW');
      continue;
    }

    var now = new Date().toISOString();
    var invoicedEvent = {
      event_id:     Identifiers.generateId(),
      job_number:   jobNumber,
      event_type:   Config.STATES.INVOICED,
      from_state:   Config.STATES.COMPLETED_BILLABLE,
      to_state:     Config.STATES.INVOICED,
      timestamp:    now,
      actor_code:   actor.personCode || '',
      actor_role:   actor.role       || '',
      period_id:    periodId,
      invoice_id:   billingRow.invoice_id,
      payload_json: JSON.stringify({ billing_event_id: billingRow.event_id, repair: true })
    };

    try {
      DAL.appendRow(Config.TABLES.FACT_JOB_EVENTS, invoicedEvent, { callerModule: MODULE, periodId: monthPartition });
      DAL.updateWhere(
        Config.TABLES.VW_JOB_CURRENT_STATE,
        { job_number: jobNumber },
        { current_state: Config.STATES.INVOICED, prev_state: Config.STATES.COMPLETED_BILLABLE, updated_at: now },
        { callerModule: MODULE }
      );
      console.log('REPAIRED ' + jobNumber + ' → INVOICED (invoice_id=' + billingRow.invoice_id + ')');
      repaired++;
    } catch (e) {
      console.log('ERROR repairing ' + jobNumber + ': ' + e.message);
    }
  }

  console.log('runRepairInvoicedTransitions complete. Repaired: ' + repaired + '/' + stuckJobs.length);
}

/**
 * ONE-TIME: Patches FACT_BILLING_LEDGER|* header rows to add
 * 'job_status' and 'remarks' columns after 'invoice_id'.
 *
 * Run this ONCE from the Apps Script editor before the first billing run.
 * Safe to re-run — skips tabs that already have both columns.
 */
function runPatchBillingLedgerSchema() {
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheets  = ss.getSheets();
  var PREFIX  = 'FACT_BILLING_LEDGER|';
  var patched = 0;

  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name.indexOf(PREFIX) !== 0) continue;

    var sheet   = sheets[i];
    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) {
      // Empty sheet — set full header from SetupScript definition
      var newHeader = [
        'event_id', 'job_number', 'period_id', 'event_type',
        'timestamp', 'actor_code', 'actor_role',
        'client_code', 'amount', 'currency', 'invoice_id',
        'job_status', 'remarks', 'notes',
        'idempotency_key', 'payload_json'
      ];
      sheet.getRange(1, 1, 1, newHeader.length).setValues([newHeader]);
      console.log('SET header on empty sheet: ' + name);
      patched++;
      continue;
    }

    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var hasJobStatus = headers.indexOf('job_status') >= 0;
    var hasRemarks   = headers.indexOf('remarks')    >= 0;
    if (hasJobStatus && hasRemarks) {
      console.log('SKIP ' + name + ' — already has job_status and remarks');
      continue;
    }

    // Insert after 'invoice_id' (or append if not found)
    var invoiceIdx = headers.indexOf('invoice_id');
    if (invoiceIdx < 0) {
      console.log('WARN ' + name + ' — no invoice_id column found; skipping');
      continue;
    }

    // Insert two new columns after invoice_id (1-based index)
    var insertAfter = invoiceIdx + 2;  // +2 because insertColumnAfter is 1-based
    if (!hasJobStatus) {
      sheet.insertColumnAfter(insertAfter);
      sheet.getRange(1, insertAfter + 1).setValue('job_status');
      insertAfter++;
    }
    if (!hasRemarks) {
      sheet.insertColumnAfter(insertAfter);
      sheet.getRange(1, insertAfter + 1).setValue('remarks');
    }
    console.log('PATCHED ' + name + ' — added job_status + remarks');
    patched++;
  }

  console.log('runPatchBillingLedgerSchema complete. Patched: ' + patched);
}

/**
 * Diagnostic: dumps DIM_CLIENT_RATES and per-job billing preview for the current period.
 * Run from Apps Script editor to verify rates before going live.
 */
function runBillingRateCheck() {
  var MODULE = 'BillingEngine';

  // 1. Dump all active rates
  var rateRows = DAL.readAll(Config.TABLES.DIM_CLIENT_RATES, { callerModule: MODULE });
  console.log('=== DIM_CLIENT_RATES (active rows) ===');
  var activeRates = [];
  for (var i = 0; i < rateRows.length; i++) {
    var r = rateRows[i];
    var active = String(r.active || '').toUpperCase();
    if (active !== 'TRUE' && active !== 'YES' && active !== '1') continue;
    activeRates.push(r);
    console.log(
      '  client=' + r.client_code +
      ' product=' + (r.product_code || '(flat)') +
      ' rate=' + r.hourly_rate + ' ' + r.currency
    );
  }
  if (activeRates.length === 0) console.log('  (no active rates found)');

  // 2. Show per-job preview for current billing period
  var periodId  = BillingEngine.generateCurrentBillingPeriodId_();
  var period    = BillingEngine.parseSemiMonthlyPeriod_(periodId);
  console.log('\n=== Billing preview: ' + periodId +
              ' (' + period.fromDate.toDateString() + ' – ' + period.toDate.toDateString() + ') ===');

  // Read work logs for the month
  var wlRows = [];
  try {
    wlRows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
      callerModule: MODULE,
      periodId: period.monthPartition
    });
  } catch (e) {
    console.log('  No FACT_WORK_LOGS partition for ' + period.monthPartition);
  }

  var MONTH_MAP = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
                    jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
  function parseDate_(raw, yr) {
    if (!raw) return null;
    if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
    var s = String(raw).trim();
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(parseInt(iso[1],10), parseInt(iso[2],10)-1, parseInt(iso[3],10));
    var mg = s.match(/[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})/);
    if (mg) { var mi = MONTH_MAP[mg[1].toLowerCase()]; if (mi !== undefined) return new Date(yr, mi, parseInt(mg[2],10)); }
    var d = new Date(s); return isNaN(d.getTime()) ? null : d;
  }
  function ymd_(d) { return d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate(); }

  var fromYMD = ymd_(period.fromDate), toYMD = ymd_(period.toDate);

  // Sum hours per job (exclude migration_batch rows)
  var hoursMap = {}, jobClients = {};
  var allVw = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  for (var j = 0; j < allVw.length; j++) jobClients[allVw[j].job_number] = allVw[j];

  for (var w = 0; w < wlRows.length; w++) {
    var row = wlRows[w];
    if (row.migration_batch) continue;
    var d = parseDate_(row.work_date, period.year);
    if (!d) continue;
    var wy = ymd_(d);
    if (wy < fromYMD || wy > toYMD) continue;
    var jn = String(row.job_number || '');
    if (!jn) continue;
    hoursMap[jn] = (hoursMap[jn] || 0) + (parseFloat(row.hours) || 0);
  }

  // Build rate cache
  var rateCache = {};
  for (var a = 0; a < activeRates.length; a++) {
    var ar  = activeRates[a];
    var cc  = String(ar.client_code  || '').toUpperCase().trim();
    var pc  = String(ar.product_code || '').toUpperCase().trim();
    var key = cc + ':' + pc;
    rateCache[key] = { hourly_rate: parseFloat(ar.hourly_rate)||0, currency: String(ar.currency||'CAD').toUpperCase() };
  }
  function resolveRate_(cc, pc) {
    var c = (cc||'').toUpperCase().trim(), p = (pc||'').toUpperCase().trim();
    return rateCache[c+':'+p] || rateCache[c+':'] || null;
  }

  var jobs = Object.keys(hoursMap).sort();
  var totals = {};
  for (var k = 0; k < jobs.length; k++) {
    var jnum  = jobs[k];
    var hrs   = hoursMap[jnum];
    var vwJob = jobClients[jnum];
    var cli   = vwJob ? String(vwJob.client_code||'').toUpperCase().trim() : '?';
    var prd   = vwJob ? String(vwJob.product_code||'').toUpperCase().trim() : '';
    var rate  = resolveRate_(cli, prd);
    var amt   = rate ? Math.round(hrs * rate.hourly_rate * 100) / 100 : null;
    var cur   = rate ? rate.currency : '?';
    var state = vwJob ? vwJob.current_state : '?';
    console.log(
      '  ' + jnum +
      ' | client=' + cli +
      ' | hrs=' + hrs +
      ' | rate=' + (rate ? rate.hourly_rate + ' ' + cur : 'NO RATE') +
      ' | amount=' + (amt !== null ? amt + ' ' + cur : 'SKIP') +
      ' | state=' + state
    );
    if (amt !== null) {
      totals[cur] = Math.round(((totals[cur]||0) + amt) * 100) / 100;
    }
  }

  console.log('\n=== Totals ===');
  var curs = Object.keys(totals);
  for (var t = 0; t < curs.length; t++) {
    console.log('  ' + curs[t] + ': ' + totals[curs[t]]);
  }
  console.log('  Jobs: ' + jobs.length + '  (no-rate skips: ' + (jobs.length - curs.reduce(function(s,c){ return s; }, 0)) + ')');
}
