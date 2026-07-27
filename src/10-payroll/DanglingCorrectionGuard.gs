// ============================================================
// DanglingCorrectionGuard.gs — BLC Nexus T10 Payroll
// src/10-payroll/DanglingCorrectionGuard.gs
//
// Detects "dangling" WORK_LOG_REASSIGN corrections at bonus commit
// time: a resubmit row (WORK_LOG_SUBMITTED, idempotency_key ending
// '_NEW', written by WorkLogCorrectionHandler.handleReassign()) whose
// void counterpart lives in a DIFFERENT quarter that already has an
// ACTIVE PERIOD_COMMIT marker predating the correction.
//
// WHY THIS MATTERS (ADR-WL-005 follow-up): handleReassign() always
// writes its void row to the ORIGINAL's own period — confirmed by
// reading WorkLogCorrectionHandler.gs; handleAmend()/handleVoid()
// never cross partitions either, and every migration fixer that also
// writes WORK_LOG_VOIDED (OrphanJobNumberFixer.gs, WorkLogDedupFixer.gs,
// TestWorkLogVoidFixer.gs) writes its void+resubmit pair to the same
// partition. handleReassign() writes its resubmit row to
// Identifiers.generateCurrentPeriodId() ("now"), which can fall in a
// later quarter than the original.
//
// A LIVE aggregation of both quarters already nets correctly —
// aggregateNetWorkLogHours() (WorkLogAggregation.gs) handles this. The
// risk here is COMMIT TIMING, not aggregation math: if the original's
// quarter was already committed (a locked, frozen PERIOD_COMMIT
// snapshot) BEFORE the correction was filed, that commit will never
// see the void, while the resubmit's quarter counts the same hours
// again when it is committed — a real double-payment path.
//
// This is a general integrity property of commitBonusForPeriod /
// previewBonusForPeriod (see BonusPeriodCommit.gs), not a one-off
// patch: a period commit should refuse — or, in preview, loudly
// surface — if it cannot confirm every correction referencing it has
// been resolved. Full retroactive reconciliation (superseding an
// already-locked quarter to reflect a later correction) is
// deliberately NOT built here — it belongs to Phase 2's period-locking
// design (corrections flow to the next open period, not retroactively
// into a locked one), not backfilled ahead of it. See ADR-WL-005.
//
// Read-only. No writes.
// ============================================================

var DCG_MODULE_ = 'DanglingCorrectionGuard';

var DCG_QUARTER_MONTHS_ = {
  Q1: ['01', '02', '03'], Q2: ['04', '05', '06'],
  Q3: ['07', '08', '09'], Q4: ['10', '11', '12']
};

function dcgMonthPeriodIds_(quarter, year) {
  var months = DCG_QUARTER_MONTHS_[quarter];
  if (!months) throw new Error(DCG_MODULE_ + ': invalid quarter "' + quarter + '". Use Q1/Q2/Q3/Q4.');
  return months.map(function (m) { return String(year) + '-' + m; });
}

/** '2026-03' -> { quarter: 'Q1', year: '2026', periodValue: '2026-Q1' } */
function dcgQuarterOf_(periodId) {
  var m = /^(\d{4})-(\d{2})$/.exec(String(periodId || ''));
  if (!m) return null;
  var year  = m[1];
  var month = parseInt(m[2], 10);
  var q = Math.ceil(month / 3);
  return { quarter: 'Q' + q, year: year, periodValue: year + '-Q' + q };
}

function dcgDiscoverAllWorkLogPartitions_() {
  var sheets  = DAL.listSheets();
  var prefix  = Config.TABLES.FACT_WORK_LOGS + '|';
  var periods = [];
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i];
    if (name.indexOf(prefix) === 0) {
      var period = name.substring(prefix.length);
      if (/^\d{4}-\d{2}$/.test(period)) periods.push(period);
    }
  }
  periods.sort();
  return periods;
}

/** Rows for a quarter's 3 month partitions, each tagged with its periodId. */
function dcgReadQuarterRows_(quarter, year) {
  var periodIds = dcgMonthPeriodIds_(quarter, year);
  var tagged = [];
  for (var i = 0; i < periodIds.length; i++) {
    var pid = periodIds[i];
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: DCG_MODULE_, periodId: pid });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') continue;
      throw e;
    }
    for (var j = 0; j < rows.length; j++) tagged.push({ row: rows[j], periodId: pid });
  }
  return tagged;
}

/** Searches every FACT_WORK_LOGS partition for a row with the given idempotency_key. */
function dcgFindRowByIdemKey_(idemKey) {
  var partitions = dcgDiscoverAllWorkLogPartitions_();
  for (var p = 0; p < partitions.length; p++) {
    var pid = partitions[p];
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: DCG_MODULE_, periodId: pid });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') continue;
      throw e;
    }
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].idempotency_key || '') === idemKey) {
        return { row: rows[i], periodId: pid };
      }
    }
  }
  return null;
}

/**
 * Scans the given quarter's rows for WORK_LOG_REASSIGN resubmits and
 * returns any dangling corrections found. Empty array means clean.
 *
 * Two kinds of finding:
 *   - MISSING_VOID: a resubmit exists but its void counterpart cannot
 *     be found anywhere — the reassign write may have partially failed
 *     (handleReassign() marks idempotency once, then writes void then
 *     new; a failure between the two writes leaves an orphaned half).
 *   - DOUBLE_COUNT_RISK: the void counterpart lives in a DIFFERENT
 *     quarter that already has an active PERIOD_COMMIT marker whose
 *     timestamp predates this correction — that commit is a frozen
 *     snapshot that never saw the void.
 *
 * A resubmit whose void lives in the SAME quarter (even a different
 * month) is not flagged — aggregateQuarterHours_() already combines
 * all 3 months before netting, so that case already nets correctly.
 * A resubmit whose original quarter was never committed, or was
 * committed AFTER this correction, is not flagged either — nothing to
 * reconcile in either case.
 *
 * @param {string} quarter 'Q1'..'Q4'
 * @param {string|number} year
 * @returns {Array<Object>}
 */
function dcgDetectDanglingCorrections_(quarter, year) {
  var thisQuarterValue = String(year) + '-' + quarter;
  var taggedRows = dcgReadQuarterRows_(quarter, year);
  var dangling = [];

  for (var i = 0; i < taggedRows.length; i++) {
    var row = taggedRows[i].row;
    var key = String(row.idempotency_key || '');
    if (key.indexOf('WL_REASSIGN_') !== 0 || key.slice(-4) !== '_NEW') continue;

    var voidKey = key.slice(0, -4) + '_VOID';
    var found = dcgFindRowByIdemKey_(voidKey);

    if (!found) {
      dangling.push({
        type: 'MISSING_VOID',
        actorCode: row.actor_code,
        resubmitPeriod: taggedRows[i].periodId,
        resubmitEventId: row.event_id,
        message: 'Resubmit ' + row.event_id + ' (actor ' + row.actor_code + ', period ' +
                 taggedRows[i].periodId + ') has no matching void row for key "' + voidKey +
                 '" in any FACT_WORK_LOGS partition — the reassign write may have partially failed.'
      });
      continue;
    }

    var voidQuarter = dcgQuarterOf_(found.periodId);
    if (!voidQuarter || voidQuarter.periodValue === thisQuarterValue) continue;

    var marker;
    try {
      marker = bpcGetActiveMarker_('QUARTER', voidQuarter.periodValue);
    } catch (e) {
      dangling.push({
        type: 'MARKER_CHECK_FAILED',
        actorCode: row.actor_code,
        resubmitPeriod: taggedRows[i].periodId,
        originalPeriod: found.periodId,
        originalQuarter: voidQuarter.periodValue,
        message: 'Could not check the PERIOD_COMMIT marker for ' + voidQuarter.periodValue + ': ' + e.message
      });
      continue;
    }
    if (!marker) continue;

    var committedBeforeCorrection = new Date(marker.timestamp).getTime() < new Date(row.timestamp).getTime();
    if (!committedBeforeCorrection) continue;

    var hours = Math.abs(parseFloat(row.hours) || 0);
    dangling.push({
      type: 'DOUBLE_COUNT_RISK',
      actorCode: row.actor_code,
      hours: hours,
      resubmitPeriod: taggedRows[i].periodId,
      resubmitQuarter: thisQuarterValue,
      originalPeriod: found.periodId,
      originalQuarter: voidQuarter.periodValue,
      commitTimestamp: marker.timestamp,
      correctionTimestamp: row.timestamp,
      message: 'Resubmit for actor ' + row.actor_code + ' (' + hours + 'h, period ' + taggedRows[i].periodId +
               ') references an original in ' + found.periodId + ' (' + voidQuarter.periodValue +
               '), which was already committed on ' + marker.timestamp + ' — BEFORE this correction was filed (' +
               row.timestamp + '). That commit is a frozen snapshot and will not reflect the void; committing ' +
               thisQuarterValue + ' now would double-count these hours.'
    });
  }

  return dangling;
}
