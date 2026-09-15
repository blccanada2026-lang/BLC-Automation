// ============================================================
// Aug2026BonusAdjustment.gs — BLC Nexus T12 Migration/Correction
// src/12-migration/Aug2026BonusAdjustment.gs
//
// One-off correction for the two Aug-2026 FACT_PAYROLL_LEDGER
// supervisor-bonus rows found wrong during this session's audit — see
// docs/superpowers/specs/2026-09-14-payroll-bonus-adjustment-design.md.
// NOT a general adjustment API: the two corrections below are
// hardcoded, specific to this one incident. A future correction reuses
// the PAYROLL_BONUS_ADJUSTED event type and this script's pattern, not
// this file itself.
//
// HOW TO RUN (Apps Script editor, PROD project):
//   1. runAug2026BonusAdjustmentDryRun()   — read-only, no writes, no emails
//   2. runAug2026BonusAdjustment('raj.nair@bluelotuscanada.ca')  — writes +
//      sends HR-routed correction emails
//
// Must be run BEFORE approveAllPayroll('2026-08') — user decision
// 2026-09-14: HR re-sends corrected statements before CEO approval, not
// after.
//
// Each correction is verified against the person's CURRENT summed
// PAYROLL_BONUS_SUPERVISOR total before anything is written — if it no
// longer matches the expected old amount (data changed since this
// script was written), the run aborts with NO writes.
// ============================================================

var AUG2026_ADJUSTMENT_ACTOR_EMAIL_ = 'raj.nair@bluelotuscanada.ca';
var AUG2026_ADJUSTMENT_PERIOD_ID_   = '2026-08';

var AUG2026_ADJUSTMENT_CORRECTIONS_ = [
  {
    personCode:        'BCH',
    expectedOldAmount: 4487.50,
    deltaAmount:       3500.00,
    notes:             'Aug 2026 supervisor bonus correction: +140 supervised hrs ' +
                        '(Rajkumar, SBS) newly attributed. INR 4,487.50 -> INR 7,987.50.'
  },
  {
    personCode:        'SGO',
    expectedOldAmount: 48343.75,
    deltaAmount:       6500.00,
    notes:             'Aug 2026 PM bonus correction: QC hours now count equally with ' +
                        'design hours (billing-parity rule) - +260 QC hrs across staff ' +
                        '(Deb Sen 120, Rajkumar 140). INR 48,343.75 -> INR 54,843.75.'
  }
];

/**
 * Reads a person's current FACT_PAYROLL_LEDGER state for the period:
 * every row (for the ledger-status print), the summed
 * PAYROLL_BONUS_SUPERVISOR total, the original bonus row's event_id
 * (for payload_json.adjustment_of), and whether a PAYROLL_BONUS_ADJUSTED
 * row already exists for this idempotency key.
 *
 * @returns {{ allRows: Array, currentBonusTotal: number, originalEventId: string,
 *             alreadyAdjusted: boolean, idempotencyKey: string }}
 */
function aug2026GatherPersonState_(personCode) {
  var allRows = DAL.readAll(Config.TABLES.FACT_PAYROLL_LEDGER, {
    callerModule: 'Aug2026BonusAdjustment', periodId: AUG2026_ADJUSTMENT_PERIOD_ID_
  }).filter(function (r) { return r.person_code === personCode; });

  var bonusRows = allRows.filter(function (r) { return r.event_type === 'PAYROLL_BONUS_SUPERVISOR'; });
  var currentBonusTotal = bonusRows.reduce(function (sum, r) { return sum + (parseFloat(r.bonus_amount) || 0); }, 0);
  var originalEventId = bonusRows.length > 0 ? bonusRows[0].event_id : '';

  var idempotencyKey = 'PAYROLL_BONUS_ADJUSTED|' + personCode + '|' + AUG2026_ADJUSTMENT_PERIOD_ID_;
  var alreadyAdjusted = allRows.some(function (r) { return r.idempotency_key === idempotencyKey; });

  return {
    allRows: allRows,
    currentBonusTotal: Math.round(currentBonusTotal * 100) / 100,
    originalEventId: originalEventId,
    alreadyAdjusted: alreadyAdjusted,
    idempotencyKey: idempotencyKey
  };
}

/**
 * Shared core for both entry points. write=false never touches DAL,
 * MailApp, or refreshMartPayrollSummary_ — pure read + verify + report.
 *
 * @param {boolean} write
 * @param {string} [actorEmail]  Required when write=true.
 * @returns {{ results: Array<{person_code, old_amount, new_amount, delta, applied, reason}> }}
 */
function aug2026RunCorrections_(write, actorEmail) {
  var actor = null;
  if (write) {
    actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
    RBAC.enforceFinancialAccess(actor);
  } else {
    actor = RBAC.resolveActor(AUG2026_ADJUSTMENT_ACTOR_EMAIL_);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);
  }

  var actualScriptId = ScriptApp.getScriptId();
  console.log('=== Aug 2026 bonus adjustment — ' + (write ? 'REAL RUN (writes + emails)' : 'DRY RUN (read-only)') + ' ===');
  console.log('Script ID: ' + actualScriptId + ' — confirm this matches the project you intend to ' +
              (write ? 'write to' : 'check') + ' (DEV: 1smkj0mmUqcWDDJPq... / PROD: 1HzRiDrQJ6z-BxPzk...) before ' +
              (write ? 'this script appends FACT_PAYROLL_LEDGER rows and sends HR correction emails.' : 'trusting this output.'));

  var staffCache = PayrollEngine.buildStaffCache_(AUG2026_ADJUSTMENT_PERIOD_ID_ + '-01');

  // Pass 1 — gather + verify EVERY correction before writing ANY of them.
  // If any correction fails its mismatch guard, this throws before a
  // single row has been appended or a single email sent for the whole
  // batch — not just for whichever correction happens to be checked first.
  var prepared = [];
  for (var i = 0; i < AUG2026_ADJUSTMENT_CORRECTIONS_.length; i++) {
    var c = AUG2026_ADJUSTMENT_CORRECTIONS_[i];
    var state = aug2026GatherPersonState_(c.personCode);

    console.log('');
    console.log('--- ' + c.personCode + ' — existing FACT_PAYROLL_LEDGER rows for ' + AUG2026_ADJUSTMENT_PERIOD_ID_ + ' ---');
    state.allRows.forEach(function (r) {
      console.log('  ' + r.event_type + ' | status=' + r.status + ' | bonus_amount=' + r.bonus_amount + ' | ' + r.timestamp);
    });

    if (Math.round(state.currentBonusTotal * 100) !== Math.round(c.expectedOldAmount * 100)) {
      throw new Error('Aug2026BonusAdjustment: ' + c.personCode + ' current PAYROLL_BONUS_SUPERVISOR total is ' +
                       state.currentBonusTotal + ', expected ' + c.expectedOldAmount + ' — data has changed since ' +
                       'this script was written. Aborting with NO writes. Re-verify before re-running.');
    }

    prepared.push({ correction: c, state: state });
  }

  // Pass 2 — every guard above passed, so it's now safe to write (or, for
  // a dry run, just report) each correction.
  var results = [];
  for (var j = 0; j < prepared.length; j++) {
    var pc = prepared[j].correction;
    var pstate = prepared[j].state;
    var newAmount = Math.round((pc.expectedOldAmount + pc.deltaAmount) * 100) / 100;

    if (pstate.alreadyAdjusted) {
      console.log('  ' + pc.personCode + ': already adjusted (idempotency_key=' + pstate.idempotencyKey + ') — skipping.');
      results.push({ person_code: pc.personCode, old_amount: pc.expectedOldAmount, new_amount: newAmount, delta: pc.deltaAmount, applied: false, reason: 'already_adjusted' });
      continue;
    }

    console.log('  ' + pc.personCode + ': ' + pc.expectedOldAmount.toFixed(2) + ' -> ' + newAmount.toFixed(2) + ' (delta ' + pc.deltaAmount.toFixed(2) + ')' +
                (write ? '' : ' [DRY RUN — not written]'));

    var emailSent = false;
    if (write) {
      var adjustmentRow = {
        event_id:        Identifiers.generateId(),
        period_id:       AUG2026_ADJUSTMENT_PERIOD_ID_,
        event_type:      'PAYROLL_BONUS_ADJUSTED',
        timestamp:       new Date().toISOString(),
        actor_code:      actor.personCode || '',
        actor_role:      actor.role || '',
        person_code:     pc.personCode,
        design_hours:    0,
        qc_hours:        0,
        design_pay:      0,
        qc_pay:          0,
        bonus_amount:    pc.deltaAmount,
        total_pay:       pc.deltaAmount,
        status:          'PENDING_CONFIRMATION',
        notes:           pc.notes,
        idempotency_key: pstate.idempotencyKey,
        payload_json:    JSON.stringify({
                            adjustment_of: pstate.originalEventId,
                            reason:        'Aug 2026 supervisor/PM bonus audit correction',
                            old_amount:    pc.expectedOldAmount,
                            new_amount:    newAmount
                          })
      };
      DAL.appendRow(Config.TABLES.FACT_PAYROLL_LEDGER, adjustmentRow, {
        callerModule: 'Aug2026BonusAdjustment', periodId: AUG2026_ADJUSTMENT_PERIOD_ID_
      });

      var staff = staffCache[pc.personCode];
      if (staff) {
        PayrollEngine.sendBonusAdjustmentEmail_(staff, pc.personCode, AUG2026_ADJUSTMENT_PERIOD_ID_, pc.expectedOldAmount, newAmount, pc.notes);
        emailSent = true;
      } else {
        console.log('  WARNING: ' + pc.personCode + ' not found in staff cache as of asOfDate — ledger row written but NO EMAIL SENT.');
      }
    }

    results.push({ person_code: pc.personCode, old_amount: pc.expectedOldAmount, new_amount: newAmount, delta: pc.deltaAmount, applied: write, reason: write ? (emailSent ? 'applied' : 'applied_no_email') : 'dry_run' });
  }

  if (write) {
    PayrollEngine.refreshMartPayrollSummary_(AUG2026_ADJUSTMENT_PERIOD_ID_);
    console.log('');
    console.log('=== Done. Run approveAllPayroll(\'' + AUG2026_ADJUSTMENT_PERIOD_ID_ + '\') only AFTER confirming ' +
                'HR has forwarded the correction emails above and both staff have re-confirmed. ===');
  } else {
    console.log('');
    console.log('=== Dry run complete. No writes were made. Run runAug2026BonusAdjustment(actorEmail) to apply. ===');
  }

  return { results: results };
}

function runAug2026BonusAdjustmentDryRun() {
  return aug2026RunCorrections_(false);
}

function runAug2026BonusAdjustment(actorEmail) {
  return aug2026RunCorrections_(true, actorEmail);
}
