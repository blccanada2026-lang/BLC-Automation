// ============================================================
// PayrollEngine.gs — BLC Nexus T10 Payroll
// src/10-payroll/PayrollEngine.gs
//
// LOAD ORDER: T10. Loads after all T0–T9 files.
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1),
//               RBAC (T2), Logger (T3), HealthMonitor (T3)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Two separate entry points — run independently:         ║
// ║                                                         ║
// ║  runPayrollRun(actorEmail, options)                     ║
// ║    → Base pay (design + QC) in INR for all staff        ║
// ║    → Converts CAD/USD rates via DIM_FX_RATES at runtime ║
// ║    → Sends paystub email to each staff member           ║
// ║    → Writes PAYROLL_CALCULATED rows, status=PENDING     ║
// ║                                                         ║
// ║  runBonusRun(actorEmail, options)                       ║
// ║    → Supervisor bonus only (INR 25 × supervised hrs)    ║
// ║    → TL: Σ(design_hours of direct reports)              ║
// ║    → PM: Σ(design_hours of all mapped staff, excl. PM)  ║
// ║    → Writes PAYROLL_BONUS_SUPERVISOR rows                ║
// ║                                                         ║
// ║  Paystub approval workflow:                             ║
// ║    1. PayrollEngine writes PAYROLL_CALCULATED            ║
// ║    2. Email sent to staff                               ║
// ║    3. Staff confirms via portal → PAYROLL_CONFIRMED      ║
// ║    4. CEO approves all → PAYROLL_PROCESSED              ║
// ║                                                         ║
// ║  Permission: PAYROLL_RUN (CEO only) +                   ║
// ║              enforceFinancialAccess()                   ║
// ╚══════════════════════════════════════════════════════════╝
//
// CURRENCY RULE:
//   ALL amounts written to FACT_PAYROLL_LEDGER are in INR.
//   Staff with pay_currency=CAD: rate converted at run time
//   via DIM_FX_RATES (from_currency=CAD, to_currency=INR).
//   Supervisor bonus is always INR 25/hr — no conversion.
//
// IDEMPOTENCY:
//   Key: {TYPE}|{person_code}|{periodId}
//   Types: PAYROLL_BASE, PAYROLL_BONUS
//   Safe to re-run — existing keys are skipped.
//
// CALL PATTERN:
//   PayrollEngine.runPayrollRun('raj.nair@bluelotuscanada.ca');
//   PayrollEngine.runBonusRun('raj.nair@bluelotuscanada.ca');
// ============================================================

var PayrollEngine = (function () {

  var MODULE               = 'PayrollEngine';
  var SUPERVISOR_BONUS_INR = 25;   // INR per supervised design hour

  // ============================================================
  // SECTION 1: STAFF CACHE
  //
  // Shape: { personCode → { name, email, role, pay_design, pay_qc,
  //                         pay_currency, supervisor_code, pm_code,
  //                         bonus_eligible } }
  // ============================================================

  function buildStaffCache_() {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') {
        Logger.warn('PAYROLL_NO_STAFF_TABLE', { module: MODULE,
          message: 'DIM_STAFF_ROSTER not found — run runSetup() first' });
        return {};
      }
      throw e;
    }

    var cache = {};
    for (var i = 0; i < rows.length; i++) {
      var row    = rows[i];
      var active = String(row.active || '').toUpperCase();
      if (active !== 'TRUE' && active !== 'YES' && active !== '1') continue;

      var code = String(row.person_code || '').trim();
      if (!code) continue;

      cache[code] = {
        name:            String(row.name            || code),
        email:           String(row.email           || '').trim().toLowerCase(),
        role:            String(row.role            || '').toUpperCase().trim(),
        pay_design:      parseFloat(row.pay_design) || 0,
        pay_qc:          parseFloat(row.pay_qc)     || 0,
        pay_currency:    String(row.pay_currency    || 'INR').toUpperCase().trim(),
        supervisor_code: String(row.supervisor_code || '').trim(),
        pm_code:         String(row.pm_code         || '').trim(),
        bonus_eligible:  String(row.bonus_eligible  || '').toUpperCase() === 'TRUE'
      };
    }
    return cache;
  }

  // ============================================================
  // SECTION 2: FX RATE CACHE
  //
  // Reads DIM_FX_RATES and builds a lookup: { 'CAD': 62.5, 'USD': 83.0 }
  // Only X→INR rates are loaded (to_currency must be 'INR').
  // INR itself is always 1.0.
  // ============================================================

  function buildFxRateCache_() {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.DIM_FX_RATES, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') {
        Logger.warn('PAYROLL_NO_FX_TABLE', { module: MODULE,
          message: 'DIM_FX_RATES not found — only INR staff will be processed' });
        return { INR: 1.0 };
      }
      throw e;
    }

    var cache  = { INR: 1.0 };
    var today  = new Date().toISOString().slice(0, 10);

    for (var i = 0; i < rows.length; i++) {
      var row  = rows[i];
      var from = String(row.from_currency || '').toUpperCase().trim();
      var to   = String(row.to_currency   || '').toUpperCase().trim();
      if (to !== 'INR' || !from) continue;

      var effFrom = String(row.effective_from || '').slice(0, 10);
      var effTo   = String(row.effective_to   || '').slice(0, 10);
      if (effFrom && effFrom > today) continue;
      if (effTo   && effTo   < today) continue;

      var rate = parseFloat(row.rate) || 0;
      if (rate > 0) cache[from] = rate;   // last row wins per currency
    }

    return cache;
  }

  // ============================================================
  // SECTION 3: CURRENCY CONVERSION
  // ============================================================

  /**
   * Converts an amount in the given currency to INR.
   * Throws if no FX rate is configured for the currency.
   *
   * @param {number} amount
   * @param {string} currency  e.g. 'CAD', 'USD', 'INR'
   * @param {Object} fxCache   From buildFxRateCache_()
   * @returns {number}  Amount in INR, rounded to 2dp
   */
  function toInr_(amount, currency, fxCache) {
    var cur = (currency || 'INR').toUpperCase().trim();
    if (cur === 'INR') return Math.round(amount * 100) / 100;
    var rate = fxCache[cur];
    if (!rate) {
      throw new Error(
        'No FX rate configured for ' + cur + '→INR. ' +
        'Add a row to DIM_FX_RATES with from_currency=' + cur + ', to_currency=INR.'
      );
    }
    return Math.round(amount * rate * 100) / 100;
  }

  // ============================================================
  // SECTION 4: HOURS AGGREGATION
  //
  // Reads FACT_WORK_LOGS for the period.
  // actor_role='QC' → qc_hours, all others → design_hours
  //
  // Returns: { 'DS1': { design_hours: 12.5, qc_hours: 0 }, ... }
  // ============================================================

  function aggregateHours_(periodId) {
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
      var row   = rows[i];
      var code  = String(row.actor_code || '').trim();
      var role  = String(row.actor_role || '').toUpperCase();
      var hours = parseFloat(row.hours) || 0;
      if (!code || hours <= 0) continue;

      if (!hoursMap[code]) hoursMap[code] = { design_hours: 0, qc_hours: 0 };
      if (role === 'QC') {
        hoursMap[code].qc_hours += hours;
      } else {
        hoursMap[code].design_hours += hours;
      }
    }

    var codes = Object.keys(hoursMap);
    for (var j = 0; j < codes.length; j++) {
      var h = hoursMap[codes[j]];
      h.design_hours = Math.round(h.design_hours * 100) / 100;
      h.qc_hours     = Math.round(h.qc_hours     * 100) / 100;
    }
    return hoursMap;
  }

  // ============================================================
  // SECTION 5: SUPERVISOR BONUS CALCULATION
  //
  // Returns: { personCode → bonusAmountINR }
  //
  // TEAM_LEAD: bonus = INR 25 × Σ(design_hours of designers
  //            where staffCache[designer].supervisor_code = TL.code)
  //
  // PM: bonus = INR 25 × Σ(design_hours of all staff
  //     where staffCache[staff].pm_code = PM.code, excl. PM's own)
  // ============================================================

  function buildSupervisorBonusMap_(staffCache, hoursMap) {
    var bonusMap = {};

    var staffCodes = Object.keys(staffCache);

    for (var i = 0; i < staffCodes.length; i++) {
      var supervisorCode = staffCodes[i];
      var supervisor     = staffCache[supervisorCode];
      var role           = supervisor.role;

      if (role !== 'TEAM_LEAD' && role !== 'PM') continue;

      var supervisedDesignHours = 0;

      if (role === 'TEAM_LEAD') {
        // Sum design hours of all designers whose supervisor_code = this TL
        for (var j = 0; j < staffCodes.length; j++) {
          var designerCode = staffCodes[j];
          var designer     = staffCache[designerCode];
          if (designer.supervisor_code !== supervisorCode) continue;
          var designerHours = hoursMap[designerCode];
          if (designerHours) supervisedDesignHours += designerHours.design_hours;
        }
      } else {
        // PM: sum design hours of all staff whose pm_code = this PM, excl. PM's own
        for (var k = 0; k < staffCodes.length; k++) {
          var memberCode = staffCodes[k];
          if (memberCode === supervisorCode) continue;  // exclude PM's own hours
          var member = staffCache[memberCode];
          if (member.pm_code !== supervisorCode) continue;
          var memberHours = hoursMap[memberCode];
          if (memberHours) supervisedDesignHours += memberHours.design_hours;
        }
      }

      if (supervisedDesignHours > 0) {
        bonusMap[supervisorCode] = Math.round(supervisedDesignHours * SUPERVISOR_BONUS_INR * 100) / 100;
      }
    }

    return bonusMap;
  }

  // ============================================================
  // SECTION 6: IDEMPOTENCY
  // ============================================================

  function buildIdempotencyKey_(type, personCode, periodId) {
    return type + '|' + personCode + '|' + periodId;
  }

  function hasEvent_(idempotencyKey, periodId) {
    try {
      var existing = DAL.readWhere(
        Config.TABLES.FACT_PAYROLL_LEDGER,
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
  // SECTION 7: PAYSTUB EMAIL
  //
  // Sends a paystub summary to the staff member via MailApp.
  // Non-fatal — if email fails, payroll row is still written.
  // ============================================================

  function sendPaystubEmail_(staff, personCode, periodId, row) {
    if (!staff.email) {
      Logger.warn('PAYROLL_NO_EMAIL', {
        module:      MODULE,
        message:     'No email for staff member — paystub not sent',
        person_code: personCode
      });
      return;
    }

    try {
      var subject = 'BLC Paystub — ' + periodId + ' (Action Required)';
      var body = [
        'Hi ' + staff.name + ',',
        '',
        'Your payroll has been calculated for period: ' + periodId,
        '',
        'PAYSTUB SUMMARY',
        '───────────────────────────────',
        'Period:          ' + periodId,
        'Design Hours:    ' + (row.design_hours || 0) + ' hrs',
        'QC Hours:        ' + (row.qc_hours     || 0) + ' hrs',
        'Design Pay:      INR ' + (row.design_pay || 0).toFixed(2),
        'QC Pay:          INR ' + (row.qc_pay    || 0).toFixed(2),
        'Total Pay:       INR ' + (row.total_pay || 0).toFixed(2),
        '───────────────────────────────',
        '',
        'ACTION REQUIRED:',
        'Please review and confirm your paystub by logging in to the BLC Portal.',
        'Payroll will not be processed until you confirm.',
        '',
        'If you have any questions, contact your PM or CEO.',
        '',
        '— BLC Payroll System'
      ].join('\n');

      MailApp.sendEmail({
        to:      staff.email,
        subject: subject,
        body:    body
      });

      Logger.info('PAYROLL_EMAIL_SENT', {
        module:      MODULE,
        message:     'Paystub email sent',
        person_code: personCode,
        email:       staff.email,
        period_id:   periodId
      });
    } catch (emailErr) {
      Logger.warn('PAYROLL_EMAIL_FAILED', {
        module:      MODULE,
        message:     'Paystub email failed — payroll row still written',
        person_code: personCode,
        error:       emailErr.message
      });
    }
  }

  // ============================================================
  // SECTION 8: BONUS EMAIL
  // ============================================================

  function sendBonusEmail_(staff, personCode, periodId, bonusAmount) {
    if (!staff.email) return;

    try {
      var subject = 'BLC Supervisor Bonus — ' + periodId + ' (Action Required)';
      var body = [
        'Hi ' + staff.name + ',',
        '',
        'Your supervisor bonus has been calculated for period: ' + periodId,
        '',
        'BONUS SUMMARY',
        '───────────────────────────────',
        'Period:           ' + periodId,
        'Supervisor Bonus: INR ' + bonusAmount.toFixed(2),
        '───────────────────────────────',
        '',
        'ACTION REQUIRED:',
        'Please confirm your paystub in the BLC Portal.',
        '',
        '— BLC Payroll System'
      ].join('\n');

      MailApp.sendEmail({ to: staff.email, subject: subject, body: body });
    } catch (e) {
      Logger.warn('PAYROLL_BONUS_EMAIL_FAILED', {
        module: MODULE, person_code: personCode, error: e.message
      });
    }
  }

  // ============================================================
  // SECTION 9: MART REFRESH
  //
  // Reads FACT_PAYROLL_LEDGER for the period, aggregates by
  // person_code. Shows latest status + totals per person.
  // Replace-all (MART is disposable — FACT is source of truth).
  // ============================================================

  function refreshMartPayrollSummary_(periodId) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_PAYROLL_LEDGER, {
        callerModule: MODULE,
        periodId:     periodId
      });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return;
      throw e;
    }

    // Aggregate by person_code
    var personData = {};
    for (var i = 0; i < rows.length; i++) {
      var row   = rows[i];
      var code  = String(row.person_code || '');
      var etype = String(row.event_type  || '');
      if (!code) continue;

      if (!personData[code]) {
        personData[code] = {
          design_pay:       0,
          qc_pay:           0,
          supervisor_bonus: 0,
          total_pay:        0,
          status:           'PENDING_CONFIRMATION'
        };
      }

      if (etype === 'PAYROLL_CALCULATED') {
        personData[code].design_pay += parseFloat(row.design_pay) || 0;
        personData[code].qc_pay     += parseFloat(row.qc_pay)     || 0;
      } else if (etype === 'PAYROLL_BONUS_SUPERVISOR') {
        personData[code].supervisor_bonus += parseFloat(row.bonus_amount) || 0;
      } else if (etype === 'PAYROLL_CONFIRMED') {
        personData[code].status = 'CONFIRMED';
      } else if (etype === 'PAYROLL_PROCESSED') {
        personData[code].status = 'PROCESSED';
      }
    }

    var updatedAt = new Date().toISOString();
    var martRows  = [];
    var codes     = Object.keys(personData);
    for (var j = 0; j < codes.length; j++) {
      var p = personData[codes[j]];
      var total = Math.round((p.design_pay + p.qc_pay + p.supervisor_bonus) * 100) / 100;
      martRows.push({
        period_id:        periodId,
        person_code:      codes[j],
        design_pay:       Math.round(p.design_pay       * 100) / 100,
        qc_pay:           Math.round(p.qc_pay           * 100) / 100,
        supervisor_bonus: Math.round(p.supervisor_bonus * 100) / 100,
        total_pay:        total,
        status:           p.status,
        updated_at:       updatedAt
      });
    }

    // Clear MART and rebuild
    try {
      DAL.clearSheet(Config.TABLES.MART_PAYROLL_SUMMARY);
    } catch (e) {
      Logger.warn('PAYROLL_MART_CLEAR_FAILED', {
        module: MODULE, message: 'Could not clear MART_PAYROLL_SUMMARY', error: e.message
      });
    }

    if (martRows.length > 0) {
      DAL.appendRows(Config.TABLES.MART_PAYROLL_SUMMARY, martRows, { callerModule: MODULE });
    }

    Logger.info('PAYROLL_MART_REFRESHED', {
      module: MODULE, message: 'MART_PAYROLL_SUMMARY refreshed',
      period_id: periodId, rows: martRows.length
    });
  }

  // ============================================================
  // SECTION 10: runPayrollRun — BASE PAY ONLY
  //
  // Calculates design_pay + qc_pay in INR for all staff with
  // work log hours in the period. Sends paystub email to each.
  // Writes PAYROLL_CALCULATED rows with status=PENDING_CONFIRMATION.
  //
  // Run SEPARATELY from runBonusRun().
  // ============================================================

  /**
   * @param {string} actorEmail
   * @param {Object} [options]
   * @param {string} [options.periodId]  Default: current period
   * @returns {{ processed, skipped, errors, by_person, period_id }}
   */
  function runPayrollRun(actorEmail, options) {
    options = options || {};
    HealthMonitor.startExecution(MODULE);

    try {
      // ── 1. Auth — double-guard ────────────────────────────
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
      RBAC.enforceFinancialAccess(actor);

      var periodId = options.periodId || Identifiers.generateCurrentPeriodId();

      Logger.info('PAYROLL_RUN_START', {
        module: MODULE, message: 'Base pay run started',
        period_id: periodId, actor: actorEmail
      });

      // ── 2. Load caches ────────────────────────────────────
      var staffCache = buildStaffCache_();
      var fxCache    = buildFxRateCache_();

      if (Object.keys(staffCache).length === 0) {
        Logger.warn('PAYROLL_NO_STAFF', {
          module: MODULE, message: 'DIM_STAFF_ROSTER is empty'
        });
      }

      // ── 3. Aggregate hours ────────────────────────────────
      var hoursMap    = aggregateHours_(periodId);
      var personCodes = Object.keys(hoursMap);

      if (personCodes.length === 0) {
        Logger.warn('PAYROLL_NO_HOURS', {
          module: MODULE, message: 'No work logs found for period', period_id: periodId
        });
        return { processed: 0, skipped: 0, errors: [], by_person: [], period_id: periodId };
      }

      // ── 4. Ensure FACT partition ──────────────────────────
      DAL.ensurePartition(Config.TABLES.FACT_PAYROLL_LEDGER, periodId, MODULE);

      // ── 5. Process each person ────────────────────────────
      var processed = 0, skipped = 0, errors = [], byPerson = [];

      for (var i = 0; i < personCodes.length; i++) {

        if (HealthMonitor.isApproachingLimit()) {
          Logger.warn('PAYROLL_RUN_PARTIAL', {
            module: MODULE, message: 'Stopping — quota limit approaching',
            processed: processed, remaining: personCodes.length - i
          });
          break;
        }

        var personCode     = personCodes[i];
        var idempotencyKey = buildIdempotencyKey_('PAYROLL_BASE', personCode, periodId);

        try {
          if (hasEvent_(idempotencyKey, periodId)) {
            Logger.info('PAYROLL_PERSON_SKIPPED', {
              module: MODULE, message: 'Already calculated this period', person_code: personCode
            });
            skipped++;
            continue;
          }

          var staff = staffCache[personCode];
          if (!staff) {
            errors.push(personCode + ': not found in DIM_STAFF_ROSTER');
            skipped++;
            continue;
          }

          var hours = hoursMap[personCode];

          // Convert pay rates to INR
          var designPayInr = toInr_(hours.design_hours * staff.pay_design, staff.pay_currency, fxCache);
          var qcPayInr     = toInr_(hours.qc_hours     * staff.pay_qc,     staff.pay_currency, fxCache);
          var totalInr     = Math.round((designPayInr + qcPayInr) * 100) / 100;

          var payrollRow = {
            event_id:        Identifiers.generateId(),
            period_id:       periodId,
            event_type:      'PAYROLL_CALCULATED',
            timestamp:       new Date().toISOString(),
            actor_code:      actor.personCode || '',
            actor_role:      actor.role       || '',
            person_code:     personCode,
            design_hours:    hours.design_hours,
            qc_hours:        hours.qc_hours,
            design_pay:      designPayInr,
            qc_pay:          qcPayInr,
            bonus_amount:    0,
            total_pay:       totalInr,
            status:          'PENDING_CONFIRMATION',
            notes:           'Base pay (' + staff.pay_currency + '→INR)',
            idempotency_key: idempotencyKey,
            payload_json:    JSON.stringify({
              name:         staff.name,
              pay_currency: staff.pay_currency,
              pay_design:   staff.pay_design,
              pay_qc:       staff.pay_qc
            })
          };

          DAL.appendRow(Config.TABLES.FACT_PAYROLL_LEDGER, payrollRow, {
            callerModule: MODULE, periodId: periodId
          });

          sendPaystubEmail_(staff, personCode, periodId, payrollRow);

          byPerson.push({
            person_code:  personCode,
            name:         staff.name,
            design_hours: hours.design_hours,
            qc_hours:     hours.qc_hours,
            design_pay:   designPayInr,
            qc_pay:       qcPayInr,
            total_pay:    totalInr,
            currency:     'INR'
          });
          processed++;

          Logger.info('PAYROLL_PERSON_CALCULATED', {
            module: MODULE, person_code: personCode, name: staff.name,
            design_hours: hours.design_hours, qc_hours: hours.qc_hours,
            total_inr: totalInr
          });

        } catch (personErr) {
          Logger.error('PAYROLL_PERSON_ERROR', {
            module: MODULE, person_code: personCode, error: personErr.message
          });
          errors.push(personCode + ': ' + personErr.message);
          skipped++;
        }
      }

      // ── 6. Refresh MART ───────────────────────────────────
      if (processed > 0) refreshMartPayrollSummary_(periodId);

      var result = { processed: processed, skipped: skipped, errors: errors,
                     by_person: byPerson, period_id: periodId };
      Logger.info('PAYROLL_RUN_COMPLETE', {
        module: MODULE, message: 'Base pay run complete', result: JSON.stringify(result)
      });
      return result;

    } finally {
      HealthMonitor.endExecution();
    }
  }

  // ============================================================
  // SECTION 11: runBonusRun — SUPERVISOR BONUS ONLY
  //
  // Run AFTER base pay has been calculated for the period.
  // Calculates INR 25 × supervised design hours per TL and PM.
  // Writes PAYROLL_BONUS_SUPERVISOR rows.
  //
  // Can be re-run if new hours come in — idempotent.
  // ============================================================

  /**
   * @param {string} actorEmail
   * @param {Object} [options]
   * @param {string} [options.periodId]  Default: current period
   * @returns {{ processed, total_bonus_inr, by_supervisor, period_id }}
   */
  function runBonusRun(actorEmail, options) {
    options = options || {};
    HealthMonitor.startExecution(MODULE);

    try {
      // ── 1. Auth ───────────────────────────────────────────
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
      RBAC.enforceFinancialAccess(actor);

      var periodId = options.periodId || Identifiers.generateCurrentPeriodId();

      Logger.info('PAYROLL_BONUS_START', {
        module: MODULE, message: 'Supervisor bonus run started',
        period_id: periodId, actor: actorEmail
      });

      // ── 2. Load staff + hours ─────────────────────────────
      var staffCache = buildStaffCache_();
      var hoursMap   = aggregateHours_(periodId);
      var bonusMap   = buildSupervisorBonusMap_(staffCache, hoursMap);

      var supervisorCodes = Object.keys(bonusMap);
      if (supervisorCodes.length === 0) {
        Logger.warn('PAYROLL_BONUS_NONE', {
          module: MODULE, message: 'No supervisors with supervised hours found', period_id: periodId
        });
        return { processed: 0, total_bonus_inr: 0, by_supervisor: [], period_id: periodId };
      }

      DAL.ensurePartition(Config.TABLES.FACT_PAYROLL_LEDGER, periodId, MODULE);

      // ── 3. Write bonus rows ───────────────────────────────
      var processed = 0, totalBonusInr = 0, bySupervisor = [];

      for (var i = 0; i < supervisorCodes.length; i++) {
        var supervisorCode = supervisorCodes[i];
        var bonusAmount    = bonusMap[supervisorCode];
        var idempotencyKey = buildIdempotencyKey_('PAYROLL_BONUS', supervisorCode, periodId);

        try {
          if (hasEvent_(idempotencyKey, periodId)) {
            Logger.info('PAYROLL_BONUS_SKIPPED', {
              module: MODULE, message: 'Bonus already written this period', person_code: supervisorCode
            });
            continue;
          }

          var staff = staffCache[supervisorCode];
          if (!staff) { continue; }

          var bonusRow = {
            event_id:        Identifiers.generateId(),
            period_id:       periodId,
            event_type:      'PAYROLL_BONUS_SUPERVISOR',
            timestamp:       new Date().toISOString(),
            actor_code:      actor.personCode || '',
            actor_role:      actor.role       || '',
            person_code:     supervisorCode,
            design_hours:    0,
            qc_hours:        0,
            design_pay:      0,
            qc_pay:          0,
            bonus_amount:    bonusAmount,
            total_pay:       bonusAmount,
            status:          'PENDING_CONFIRMATION',
            notes:           'Supervisor bonus INR 25/hr (' + staff.role + ')',
            idempotency_key: idempotencyKey,
            payload_json:    JSON.stringify({
              supervisor_role: staff.role,
              bonus_rate:      SUPERVISOR_BONUS_INR
            })
          };

          DAL.appendRow(Config.TABLES.FACT_PAYROLL_LEDGER, bonusRow, {
            callerModule: MODULE, periodId: periodId
          });

          sendBonusEmail_(staff, supervisorCode, periodId, bonusAmount);

          bySupervisor.push({
            person_code:  supervisorCode,
            name:         staff.name,
            role:         staff.role,
            bonus_amount: bonusAmount
          });
          processed++;
          totalBonusInr += bonusAmount;

          Logger.info('PAYROLL_BONUS_CALCULATED', {
            module: MODULE, person_code: supervisorCode, role: staff.role, bonus_inr: bonusAmount
          });

        } catch (bonusErr) {
          Logger.error('PAYROLL_BONUS_ERROR', {
            module: MODULE, person_code: supervisorCode, error: bonusErr.message
          });
        }
      }

      if (processed > 0) refreshMartPayrollSummary_(periodId);

      var result = {
        processed:       processed,
        total_bonus_inr: Math.round(totalBonusInr * 100) / 100,
        by_supervisor:   bySupervisor,
        period_id:       periodId
      };
      Logger.info('PAYROLL_BONUS_COMPLETE', {
        module: MODULE, message: 'Supervisor bonus run complete', result: JSON.stringify(result)
      });
      return result;

    } finally {
      HealthMonitor.endExecution();
    }
  }

  // ============================================================
  // SECTION 12: confirmPaystub — Staff confirms their paystub
  //
  // Called from the portal by the staff member themselves.
  // Writes a PAYROLL_CONFIRMED event row.
  // ============================================================

  /**
   * @param {string} actorEmail  The staff member confirming
   * @param {string} periodId
   * @returns {{ ok: boolean, message: string }}
   */
  function confirmPaystub(actorEmail, periodId) {
    var actor = RBAC.resolveActor(actorEmail);
    periodId  = periodId || Identifiers.generateCurrentPeriodId();

    var personCode     = actor.personCode;
    var idempotencyKey = buildIdempotencyKey_('PAYROLL_CONFIRMED', personCode, periodId);

    // Check they have a calculated row to confirm
    var calculated;
    try {
      calculated = DAL.readWhere(
        Config.TABLES.FACT_PAYROLL_LEDGER,
        { person_code: personCode, event_type: 'PAYROLL_CALCULATED' },
        { periodId: periodId }
      );
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') calculated = [];
      else throw e;
    }

    if (!calculated || calculated.length === 0) {
      return { ok: false, message: 'No payroll found for ' + periodId + '. Payroll may not have been run yet.' };
    }

    if (hasEvent_(idempotencyKey, periodId)) {
      return { ok: true, message: 'Paystub already confirmed for ' + periodId + '.' };
    }

    var confirmRow = {
      event_id:        Identifiers.generateId(),
      period_id:       periodId,
      event_type:      'PAYROLL_CONFIRMED',
      timestamp:       new Date().toISOString(),
      actor_code:      personCode,
      actor_role:      actor.role || '',
      person_code:     personCode,
      design_hours:    0,
      qc_hours:        0,
      design_pay:      0,
      qc_pay:          0,
      bonus_amount:    0,
      total_pay:       0,
      status:          'CONFIRMED',
      notes:           'Staff self-confirmation',
      idempotency_key: idempotencyKey,
      payload_json:    JSON.stringify({ confirmed_at: new Date().toISOString() })
    };

    DAL.appendRow(Config.TABLES.FACT_PAYROLL_LEDGER, confirmRow, {
      callerModule: MODULE, periodId: periodId
    });

    refreshMartPayrollSummary_(periodId);

    Logger.info('PAYROLL_CONFIRMED', {
      module: MODULE, person_code: personCode, period_id: periodId
    });

    return { ok: true, message: 'Paystub confirmed for ' + periodId + '. Thank you!' };
  }

  // ============================================================
  // SECTION 13: approveAllPayroll — CEO final approval
  //
  // Writes PAYROLL_PROCESSED rows for all CONFIRMED staff.
  // Staff without a PAYROLL_CONFIRMED row are skipped.
  // ============================================================

  /**
   * @param {string} actorEmail  CEO only
   * @param {string} periodId
   * @returns {{ processed, skipped, period_id }}
   */
  function approveAllPayroll(actorEmail, periodId) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
    RBAC.enforceFinancialAccess(actor);

    periodId = periodId || Identifiers.generateCurrentPeriodId();

    // Read all payroll rows for the period to find confirmed persons
    var allRows;
    try {
      allRows = DAL.readAll(Config.TABLES.FACT_PAYROLL_LEDGER, {
        callerModule: MODULE,
        periodId:     periodId
      });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') allRows = [];
      else throw e;
    }

    // Group by person_code → track which events exist
    var personEvents = {};
    for (var i = 0; i < allRows.length; i++) {
      var row   = allRows[i];
      var code  = String(row.person_code  || '');
      var etype = String(row.event_type   || '');
      if (!code) continue;
      if (!personEvents[code]) personEvents[code] = {};
      personEvents[code][etype] = true;
    }

    var processed = 0, skipped = 0;
    var codes     = Object.keys(personEvents);

    for (var j = 0; j < codes.length; j++) {
      var personCode = codes[j];
      var events     = personEvents[personCode];

      // Only process staff who have confirmed but not yet been processed
      if (!events['PAYROLL_CONFIRMED']) { skipped++; continue; }
      if (events['PAYROLL_PROCESSED'])  { skipped++; continue; }

      var idempotencyKey = buildIdempotencyKey_('PAYROLL_PROCESSED', personCode, periodId);

      var processRow = {
        event_id:        Identifiers.generateId(),
        period_id:       periodId,
        event_type:      'PAYROLL_PROCESSED',
        timestamp:       new Date().toISOString(),
        actor_code:      actor.personCode || '',
        actor_role:      actor.role       || '',
        person_code:     personCode,
        design_hours:    0,
        qc_hours:        0,
        design_pay:      0,
        qc_pay:          0,
        bonus_amount:    0,
        total_pay:       0,
        status:          'PROCESSED',
        notes:           'CEO final approval',
        idempotency_key: idempotencyKey,
        payload_json:    JSON.stringify({ approved_at: new Date().toISOString() })
      };

      DAL.appendRow(Config.TABLES.FACT_PAYROLL_LEDGER, processRow, {
        callerModule: MODULE, periodId: periodId
      });
      processed++;
    }

    if (processed > 0) refreshMartPayrollSummary_(periodId);

    Logger.info('PAYROLL_ALL_APPROVED', {
      module: MODULE, processed: processed, skipped: skipped, period_id: periodId
    });

    return { processed: processed, skipped: skipped, period_id: periodId };
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    /**
     * Run base pay (design + QC) for all staff in the period.
     * CEO only. Idempotent. Sends paystub emails.
     * Run SEPARATELY from runBonusRun().
     */
    runPayrollRun: runPayrollRun,

    /**
     * Run supervisor bonus (INR 25 × supervised design hours).
     * CEO only. Idempotent. Run AFTER runPayrollRun().
     */
    runBonusRun: runBonusRun,

    /**
     * Staff member confirms their own paystub for the period.
     * Called from portal by the staff member.
     */
    confirmPaystub: confirmPaystub,

    /**
     * CEO final approval — marks all CONFIRMED records as PROCESSED.
     * Only processes staff who have confirmed their paystub.
     */
    approveAllPayroll: approveAllPayroll
  };

}());
