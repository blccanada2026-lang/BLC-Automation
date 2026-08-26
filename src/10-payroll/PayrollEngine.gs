// ============================================================
// PayrollEngine.gs — BLC Nexus T10 Payroll
// src/10-payroll/PayrollEngine.gs
//
// LOAD ORDER: T10. Loads after all T0–T9 files.
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1),
//               RBAC (T2), Logger (T3), HealthMonitor (T3),
//               WorkLogExclusion (T6), WorkLogAggregation (T6)
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

  /** 'YYYY-MM-DDTHH:mm:ss...' or Date -> 'YYYY-MM-DD'. Mirrors QuarterlyBonusEngine's toIsoDate_ — separate module, can't share it. */
  function toIsoDate_(val) {
    if (!val) return '';
    if (val instanceof Date) {
      return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    return String(val).slice(0, 10);
  }

  /**
   * Builds the staff lookup cache, resolving each person_code to the ONE
   * DIM_STAFF_ROSTER row whose effective_from/effective_to range covers
   * asOfDate (Task 2 — effective-dated supervisor_code, per
   * data-integrity.md Rule D4). Inclusive on both ends:
   * effective_from <= asOfDate <= effective_to, or effective_to blank
   * for the current/open-ended row. Defaults to today if asOfDate is
   * omitted, as a backward-compatible safety net for any caller not
   * updated to pass one explicitly — every caller in THIS file passes
   * one explicitly (see runPayrollRun/runBonusRun).
   *
   * @param {string} [asOfDate]  'YYYY-MM-DD'. Defaults to today.
   * @returns {Object}  { person_code: { name, email, role, pay_design,
   *                       pay_qc, pay_currency, supervisor_code, pm_code,
   *                       bonus_eligible } }
   */
  function buildStaffCache_(asOfDate) {
    asOfDate = asOfDate || toIsoDate_(new Date());

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

      var effFrom = toIsoDate_(row.effective_from);
      var effTo   = toIsoDate_(row.effective_to);

      // Integrity check, unconditional — fires regardless of whether this
      // row would otherwise match asOfDate. An inverted window is data
      // corruption, not something to silently skip past. Added 2026-07-27
      // after a broken changeSupervisor() idempotency check produced
      // exactly this shape in DEV.
      if (effFrom && effTo && effTo < effFrom) {
        throw new Error('PayrollEngine.buildStaffCache_: person_code "' + code + '" has a DIM_STAFF_ROSTER row ' +
                         'with an inverted validity window (effective_from="' + effFrom + '" is AFTER ' +
                         'effective_to="' + effTo + '") — this is data corruption, not a query issue. ' +
                         'Clean up the row before re-running.');
      }

      if (effFrom && effFrom > asOfDate) continue; // not yet effective as of asOfDate
      if (effTo   && effTo   < asOfDate) continue; // already closed out as of asOfDate

      if (cache[code]) {
        throw new Error('PayrollEngine.buildStaffCache_: more than one DIM_STAFF_ROSTER row resolves as ' +
                         'valid for person_code "' + code + '" as of ' + asOfDate + ' — refusing to silently ' +
                         'pick one (would silently corrupt payroll/bonus attribution). Conflicting rows: ' +
                         'supervisor_code="' + cache[code].supervisor_code + '" vs "' + String(row.supervisor_code || '').trim() +
                         '". Clean up DIM_STAFF_ROSTER for this person_code before re-running.');
      }

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

    // Shared NET-hours aggregation — see WorkLogAggregation.gs. Excludes
    // migrated historical rows (event_type-based, not the dead
    // row.migration_batch field — see WorkLogExclusion.gs) and correctly
    // nets void/amendment corrections instead of double-counting them
    // (ADR-WL-004 follow-up fix).
    return aggregateNetWorkLogHours(rows);
  }

  // ============================================================
  // SECTION 4a: PER-PERSON PAY CALCULATION (pure)
  //
  // Extracted from runPayrollRun()'s per-person loop (Payout Statement
  // feature, 2026-08) so the same math is reused by both the real commit
  // run and the no-write preview path (previewPayoutStatement, Task 3).
  // Deliberately excludes everything row-assembly-related (event_id,
  // actor_code, idempotency_key, status, payload_json) — those stay in
  // runPayrollRun's own loop, which wraps this function's result into the
  // full FACT_PAYROLL_LEDGER row exactly as it always has. See
  // docs/superpowers/specs/2026-08-26-payout-statement-design.md §4.1 for
  // why the signature is scoped this way — an earlier draft that included
  // actor/idempotencyKey here would have silently broken the idempotency
  // check in hasEvent_() if that field were ever dropped by mistake.
  // ============================================================

  function computePersonPay_(staff, personCode, hours, fxCache) {
    // Rounding must match exactly: design_pay and qc_pay are each rounded
    // independently inside toInr_(), then total_pay is rounded again after
    // summing the two already-rounded values — do not collapse this into a
    // single rounding pass, it changes totals by a cent in edge cases.
    var designPayInr = toInr_(hours.design_hours * staff.pay_design, staff.pay_currency, fxCache);
    var qcPayInr     = toInr_(hours.qc_hours     * staff.pay_qc,     staff.pay_currency, fxCache);
    var totalInr     = Math.round((designPayInr + qcPayInr) * 100) / 100;

    return {
      person_code:  personCode,
      name:         staff.name,
      design_hours: hours.design_hours,
      qc_hours:     hours.qc_hours,
      design_pay:   designPayInr,
      qc_pay:       qcPayInr,
      total_pay:    totalInr,
      currency:     'INR'
    };
  }

  // ============================================================
  // SECTION 5: SUPERVISOR BONUS CALCULATION (TEAM_LEAD only)
  //
  // Returns: { personCode → bonusAmountINR }
  //
  // TEAM_LEAD: bonus = INR 25 × Σ(design_hours of designers
  //            where staffCache[designer].supervisor_code = TL.code)
  //
  // PM bonus moved to buildPmBonusMap_() (Phase B1, payroll automation,
  // 2026-07) — architecturally distinct: a flat, roster-wide sum with
  // no supervisor_code/pm_code lookup at all, not a variant of this
  // direct-report logic. See PAYROLL_AUTOMATION_ARCHITECTURE.md §2.3
  // for why: the old PM branch here was already non-recursive, but its
  // correctness depended on every non-PM staff row having pm_code
  // correctly populated — a data-integrity dependency the new flat
  // rule deliberately has none of.
  // ============================================================

  function buildSupervisorBonusMap_(staffCache, hoursMap) {
    var bonusMap = {};

    var staffCodes = Object.keys(staffCache);

    for (var i = 0; i < staffCodes.length; i++) {
      var supervisorCode = staffCodes[i];
      var supervisor     = staffCache[supervisorCode];
      var role           = supervisor.role;

      if (role !== 'TEAM_LEAD') continue;

      var supervisedDesignHours = 0;

      // Sum design hours of all designers whose supervisor_code = this TL
      for (var j = 0; j < staffCodes.length; j++) {
        var designerCode = staffCodes[j];
        var designer     = staffCache[designerCode];
        if (designer.supervisor_code !== supervisorCode) continue;
        var designerHours = hoursMap[designerCode];
        if (designerHours) supervisedDesignHours += designerHours.design_hours;
      }

      if (supervisedDesignHours > 0) {
        bonusMap[supervisorCode] = Math.round(supervisedDesignHours * SUPERVISOR_BONUS_INR * 100) / 100;
      }
    }

    return bonusMap;
  }

  // ============================================================
  // SECTION 5b: PM BONUS CALCULATION (flat, roster-wide)
  //
  // Returns: { personCode → bonusAmountINR }
  //
  // PM: bonus = INR 25 × Σ(design_hours of every staff member in
  //     staffCache whose role !== 'PM') — company-wide, flat, no
  //     supervisor_code/pm_code lookup. Deliberately NOT a superset
  //     of buildSupervisorBonusMap_'s TL logic and NOT recursive —
  //     see PAYROLL_AUTOMATION_ARCHITECTURE.md §2.3.
  //
  // Consequence of "flat, company-wide" worth restating here (not a
  // bug): if more than one PM is active simultaneously, EVERY PM is
  // credited the identical total — this function has no attribution
  // mechanism between multiple PMs. Not a concern today (one PM), but
  // a real, documented implication of the rule as specified.
  // ============================================================

  function buildPmBonusMap_(staffCache, hoursMap) {
    var bonusMap = {};

    var staffCodes    = Object.keys(staffCache);
    var nonPmDesignHours = 0;

    for (var j = 0; j < staffCodes.length; j++) {
      var code   = staffCodes[j];
      var member = staffCache[code];
      if (member.role === 'PM') continue; // excludes every PM's own hours, not just "this" PM's
      var memberHours = hoursMap[code];
      if (memberHours) nonPmDesignHours += memberHours.design_hours;
    }

    if (nonPmDesignHours <= 0) return bonusMap;

    var bonusAmount = Math.round(nonPmDesignHours * SUPERVISOR_BONUS_INR * 100) / 100;

    for (var i = 0; i < staffCodes.length; i++) {
      var supervisorCode = staffCodes[i];
      if (staffCache[supervisorCode].role !== 'PM') continue;
      bonusMap[supervisorCode] = bonusAmount;
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
  // SECTION 8b: PAYOUT STATEMENT SUMMARY EMAIL
  //
  // Sends one combined review email to PAYOUT_STATEMENT_REVIEW_RECIPIENT
  // covering whichever of base pay / supervisor bonus / quarterly bonus
  // preview are present. Called by previewPayoutStatement (Task 3, no
  // write) and, additively, by runPayrollRun/runBonusRun (Task 4, on
  // real commit) — each caller passes only the section(s) it has data
  // for. Non-fatal on MailApp failure, same convention as
  // sendPaystubEmail_/sendBonusEmail_ above.
  // ============================================================

  function sendPayoutStatementSummary_(periodId, sections, meta) {
    var recipient = PropertiesService.getScriptProperties().getProperty('PAYOUT_STATEMENT_REVIEW_RECIPIENT')
      || 'HR@bluelotuscanada.ca';

    if (!recipient) {
      Logger.warn('PAYOUT_STATEMENT_NO_RECIPIENT', {
        module: MODULE, message: 'No recipient resolved — summary not sent', period_id: periodId
      });
      return;
    }

    try {
      var lines = ['Hi,', '', 'Payout statement summary for period: ' + periodId, ''];

      if (sections.basePay && sections.basePay.length > 0) {
        lines = lines.concat(formatBasePaySection_(sections.basePay));
      }
      if (sections.supervisorBonus && sections.supervisorBonus.length > 0) {
        lines = lines.concat(formatSupervisorBonusSection_(sections.supervisorBonus));
      }
      if (sections.quarterlyBonus && sections.quarterlyBonus.length > 0) {
        lines = lines.concat(formatQuarterlyBonusSection_(sections.quarterlyBonus, meta.quarterPeriodId));
      }

      lines.push(meta.committed
        ? 'This reflects payroll already committed for this period; confirmation emails have already been sent to affected staff.'
        : 'This is a review summary only. No payroll has been committed yet.');
      lines.push('');
      lines.push('— BLC Payout System');

      MailApp.sendEmail({
        to:      recipient,
        subject: 'BLC Payout Statement Summary — ' + periodId + ' (Review)',
        body:    lines.join('\n')
      });

      Logger.info('PAYOUT_STATEMENT_SUMMARY_SENT', {
        module: MODULE, message: 'Payout statement summary sent', period_id: periodId, recipient: recipient
      });
    } catch (emailErr) {
      Logger.warn('PAYOUT_STATEMENT_SUMMARY_FAILED', {
        module: MODULE, message: 'Payout statement summary email failed', period_id: periodId, error: emailErr.message
      });
    }
  }

  function formatBasePaySection_(basePay) {
    var lines = ['BASE PAY', '───────────────────────────────'];
    var total = 0;
    basePay.forEach(function (row) {
      lines.push(row.person_code + '  ' + row.name + '  Design ' + row.design_hours + 'h  QC ' +
        row.qc_hours + 'h  Design Pay INR ' + row.design_pay.toFixed(2) + '  QC Pay INR ' +
        row.qc_pay.toFixed(2) + '  Total INR ' + row.total_pay.toFixed(2));
      total += row.total_pay;
    });
    lines.push('Period Total: INR ' + (Math.round(total * 100) / 100).toFixed(2));
    lines.push('───────────────────────────────');
    lines.push('');
    return lines;
  }

  function formatSupervisorBonusSection_(supervisorBonus) {
    var lines = ['SUPERVISOR BONUS', '───────────────────────────────'];
    var total = 0;
    supervisorBonus.forEach(function (row) {
      lines.push(row.person_code + '  ' + row.name + '  ' + row.role + '  INR ' + row.bonus_amount.toFixed(2));
      total += row.bonus_amount;
    });
    lines.push('Total: INR ' + (Math.round(total * 100) / 100).toFixed(2));
    lines.push('───────────────────────────────');
    lines.push('');
    return lines;
  }

  function formatQuarterlyBonusSection_(quarterlyBonus, quarterPeriodId) {
    var lines = ['QUARTERLY BONUS PREVIEW — ' + quarterPeriodId + ' (preview, not yet committed)',
                 '───────────────────────────────'];
    quarterlyBonus.forEach(function (row) {
      lines.push(row.person_code + '  ' + row.name + '  ' + row.role + '  status=' + row.status +
        '  INR ' + (row.bonus_inr || 0).toFixed(2));
    });
    lines.push('───────────────────────────────');
    lines.push('');
    return lines;
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
      // asOfDate = first day of the period being run — Task 2 effective-dating.
      // periodId is 'YYYY-MM'; a run for a given month resolves supervisor_code
      // (and every other roster field) as of that month's start, not "today" —
      // so re-running a past month's payroll after a later roster change still
      // reflects who was actually supervising during that month.
      var staffCache = buildStaffCache_(periodId + '-01');
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
      var wasPartial = false;

      for (var i = 0; i < personCodes.length; i++) {

        if (HealthMonitor.isApproachingLimit()) {
          wasPartial = true;
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

          var hours   = hoursMap[personCode];
          var payCalc = computePersonPay_(staff, personCode, hours, fxCache);

          var payrollRow = {
            event_id:        Identifiers.generateId(),
            period_id:       periodId,
            event_type:      'PAYROLL_CALCULATED',
            timestamp:       new Date().toISOString(),
            actor_code:      actor.personCode || '',
            actor_role:      actor.role       || '',
            person_code:     personCode,
            design_hours:    payCalc.design_hours,
            qc_hours:        payCalc.qc_hours,
            design_pay:      payCalc.design_pay,
            qc_pay:          payCalc.qc_pay,
            bonus_amount:    0,
            total_pay:       payCalc.total_pay,
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

          byPerson.push(payCalc);
          processed++;

          Logger.info('PAYROLL_PERSON_CALCULATED', {
            module: MODULE, person_code: personCode, name: staff.name,
            design_hours: payCalc.design_hours, qc_hours: payCalc.qc_hours,
            total_inr: payCalc.total_pay
          });

        } catch (personErr) {
          Logger.error('PAYROLL_PERSON_ERROR', {
            module: MODULE, person_code: personCode, error: personErr.message
          });
          errors.push(personCode + ': ' + personErr.message);
          skipped++;
        }
      }

      // ── 6. Send HR summary ────────────────────────────────
      sendPayoutStatementSummary_(periodId, { basePay: byPerson }, { committed: true, quarterPeriodId: null });

      // ── 7. Refresh MART ───────────────────────────────────
      if (processed > 0) refreshMartPayrollSummary_(periodId);

      var result = { processed: processed, skipped: skipped, errors: errors,
                     by_person: byPerson, period_id: periodId, partial: wasPartial };
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
      // asOfDate = first day of the period — Task 2 effective-dating. This is
      // the supervisor-bonus attribution path itself: a re-run of a past
      // month's bonus after a later supervisor_code change must still credit
      // whoever actually supervised that month, not today's supervisor.
      var staffCache = buildStaffCache_(periodId + '-01');
      var hoursMap   = aggregateHours_(periodId);
      // TL (direct-report sum) and PM (flat, roster-wide sum) are two
      // architecturally distinct calculations (Phase B1, payroll
      // automation — see buildPmBonusMap_'s own header comment) merged
      // into one map here. Person codes never collide — role is
      // singular per person in staffCache — so a plain merge is safe;
      // the write loop below is agnostic to which function produced
      // which amount.
      var tlBonusMap = buildSupervisorBonusMap_(staffCache, hoursMap);
      var pmBonusMap = buildPmBonusMap_(staffCache, hoursMap);
      var bonusMap   = {};
      Object.keys(tlBonusMap).forEach(function (code) { bonusMap[code] = tlBonusMap[code]; });
      Object.keys(pmBonusMap).forEach(function (code) { bonusMap[code] = pmBonusMap[code]; });

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

      sendPayoutStatementSummary_(periodId, { supervisorBonus: bySupervisor }, { committed: true, quarterPeriodId: null });

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
   * @returns {{ processed, skipped, period_id, partial }}
   */
  function approveAllPayroll(actorEmail, periodId) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
    RBAC.enforceFinancialAccess(actor);

    HealthMonitor.startExecution(MODULE);
    var wasPartial = false;

    try {
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
        if (HealthMonitor.isApproachingLimit()) {
          wasPartial = true;
          Logger.warn('APPROVE_ALL_PARTIAL', {
            module: MODULE, message: 'Stopping — quota limit approaching',
            processed: processed, remaining: codes.length - j
          });
          break;
        }

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

      return { processed: processed, skipped: skipped, period_id: periodId, partial: wasPartial };

    } finally {
      HealthMonitor.endExecution();
    }
  }

  // ============================================================
  // SECTION 14: previewPayoutStatement — no-write preview for HR review
  //
  // CEO/HR_ACCOUNTING trigger. Computes base pay + supervisor bonus (and,
  // optionally, a quarterly bonus preview) for a period WITHOUT writing
  // to FACT_PAYROLL_LEDGER and WITHOUT sending any per-consultant/
  // per-supervisor confirm-gate email — only the one combined HR review
  // summary (sendPayoutStatementSummary_, Task 2). Fully repeatable: no
  // idempotency marking, same period can be previewed any number of
  // times. See docs/superpowers/specs/2026-08-26-payout-statement-design.md
  // §4.2.
  // ============================================================

  /**
   * @param {string} actorEmail
   * @param {string} periodId  'YYYY-MM'
   * @param {{ includeQuarterly: boolean, quarter: string, year: number }} options
   * @returns {{ previewed: boolean, period_id: string, by_person: Object[],
   *   by_supervisor: Object[], quarterly: Object[]|null }}
   */
  function previewPayoutStatement(actorEmail, periodId, options) {
    options = options || {};

    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_PREVIEW);
    RBAC.enforceFinancialAccess(actor, RBAC.ACTIONS.PAYROLL_PREVIEW);

    periodId = periodId || Identifiers.generateCurrentPeriodId();

    var staffCache = buildStaffCache_(periodId + '-01');
    var fxCache    = buildFxRateCache_();
    var hoursMap   = aggregateHours_(periodId);

    var basePay      = [];
    var personCodes  = Object.keys(hoursMap);

    for (var i = 0; i < personCodes.length; i++) {
      if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
        Logger.warn('PAYOUT_STATEMENT_PREVIEW_PARTIAL', {
          module: MODULE, message: 'Stopping preview — quota limit approaching',
          processed: i, remaining: personCodes.length - i
        });
        break;
      }
      var personCode = personCodes[i];
      var staff       = staffCache[personCode];
      if (!staff) continue;
      basePay.push(computePersonPay_(staff, personCode, hoursMap[personCode], fxCache));
    }

    var tlBonusMap = buildSupervisorBonusMap_(staffCache, hoursMap);
    var pmBonusMap = buildPmBonusMap_(staffCache, hoursMap);
    var bonusMap   = {};
    Object.keys(tlBonusMap).forEach(function (code) { bonusMap[code] = tlBonusMap[code]; });
    Object.keys(pmBonusMap).forEach(function (code) { bonusMap[code] = pmBonusMap[code]; });

    var supervisorBonus = Object.keys(bonusMap).map(function (code) {
      var staff = staffCache[code];
      return { person_code: code, name: staff.name, role: staff.role, bonus_amount: bonusMap[code] };
    });

    var quarterlyBonus     = null;
    var quarterPeriodId    = null;
    if (options.includeQuarterly) {
      quarterlyBonus  = QuarterlyBonusEngine.previewQuarterlyBonus(actorEmail, options.quarter, options.year);
      quarterPeriodId = options.quarter + '-' + options.year;
    }

    sendPayoutStatementSummary_(periodId, {
      basePay:         basePay,
      supervisorBonus: supervisorBonus,
      quarterlyBonus:  quarterlyBonus
    }, { committed: false, quarterPeriodId: quarterPeriodId });

    Logger.info('PAYOUT_STATEMENT_PREVIEWED', {
      module: MODULE, message: 'Payout statement previewed', period_id: periodId,
      base_pay_count: basePay.length, supervisor_bonus_count: supervisorBonus.length
    });

    return {
      previewed:     true,
      period_id:     periodId,
      by_person:     basePay,
      by_supervisor: supervisorBonus,
      quarterly:     quarterlyBonus
    };
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
    approveAllPayroll: approveAllPayroll,

    /**
     * CEO/HR_ACCOUNTING preview trigger — computes base pay + supervisor
     * bonus (+ optional quarterly bonus) for a period and sends ONE
     * combined summary to the HR review recipient. No FACT write, no
     * per-consultant/per-supervisor email, fully repeatable.
     */
    previewPayoutStatement: previewPayoutStatement,

    // Exposed 2026-07-23 (payroll-hardening effort, Phase 4 promotion
    // dry-run) — same precedent as QuarterlyBonusEngine.aggregateQuarterHours_
    // (see that file's public return object) — so a read-only dry-run tool
    // (AggregationFixDryRun.gs) can call the REAL hours-aggregation function
    // runPayrollRun() actually uses, not a reimplementation. Read-only by
    // construction: only calls DAL.readAll() (never appendRow/appendRows/
    // ensurePartition) — see this function's own body above.
    aggregateHours_: aggregateHours_,

    // Exposed 2026-07-24 (Task 2, supervisor_code effective-dating) — same
    // precedent as aggregateHours_ above — so the Jest suite can test the
    // real date-filtering and supervisor-attribution logic runPayrollRun()/
    // runBonusRun() actually use, not a reimplementation. Both read-only.
    buildStaffCache_:         buildStaffCache_,
    buildSupervisorBonusMap_: buildSupervisorBonusMap_,

    // Exposed 2026-07-28 (Phase B1, payroll automation) — same
    // precedent as buildSupervisorBonusMap_ above, so the Jest suite
    // can test the real, flat PM bonus calculation runBonusRun()
    // actually uses, not a reimplementation.
    buildPmBonusMap_: buildPmBonusMap_,

    // Exposed 2026-08-26 (Payout Statement feature) — same precedent as
    // buildPmBonusMap_ above, so the Jest suite can test the real
    // per-person pay math both runPayrollRun() and previewPayoutStatement()
    // (Task 3) use, not a reimplementation. Pure — no DAL/Logger calls.
    computePersonPay_: computePersonPay_,

    // Exposed 2026-08-26 (Payout Statement feature) — same precedent as
    // computePersonPay_ above, so the Jest suite can test the real email
    // builder both previewPayoutStatement (Task 3) and the runPayrollRun/
    // runBonusRun commit-path wiring (Task 4) use.
    sendPayoutStatementSummary_: sendPayoutStatementSummary_
  };

}());
