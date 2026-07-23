// ============================================================
// WorkLogAggregation.gs — BLC Nexus T06 Shared Aggregation
// src/06-handlers/WorkLogAggregation.gs
//
// LOAD ORDER: T06, after Constants.gs (T00) and WorkLogExclusion.gs (T06).
// DEPENDENCIES: Constants.gs, WorkLogExclusion.gs (isMigratedWorkLog).
//
// Single source of truth for NET hours aggregation from FACT_WORK_LOGS
// rows — "net" meaning migrated/historical rows are excluded and
// legitimate corrections (WORK_LOG_VOIDED negative deltas,
// WORK_LOG_AMENDED negative deltas) are summed together with their
// originals rather than dropped.
//
// Root cause this replaces: PayrollEngine.aggregateHours_() and
// QuarterlyBonusEngine.aggregateQuarterHours_() both filtered rows with
// `hours <= 0`, which silently discards WORK_LOG_VOIDED rows (negative
// hours by design, per the ADR-WL-001 void+resubmit correction pattern)
// instead of netting them. A void's negative delta was never subtracted
// from its original — so every correction of this shape was
// double-counted (original + resubmit both land, the void does nothing),
// not "net zero to actor totals" as ADR-WL-001 claims for the engines
// that used this pattern. BillingEngine.buildHoursCache_() never had this
// bug — its accumulation is unconditional except for isNaN/exactly-zero
// (see its own comment: "Allow negative hours... nets out the duplicates
// without needing explicit exclusion rules"). This function brings
// Payroll/Bonus in line with Billing's already-correct pattern.
//
// KNOWN STRUCTURAL LIMITATION (not something this function can fix on its
// own — see tests/work-log-aggregation.test.js's "KNOWN LIMITATION" test):
// WorkLogCorrectionHandler.handleReassign() can write a correction's void
// and resubmit into DIFFERENT monthly partitions (the void uses the
// original row's period_id; the resubmit uses whatever period is current
// when the correction is filed). A caller that aggregates a single period
// in isolation will see an incomplete net for that period; the two sides
// only reconcile when both periods' rows are aggregated together. This is
// a data-modeling property of how corrections are period-stamped, not a
// bug in this aggregation function — flagged here so any period-scoped
// caller (single month, single quarter) is aware its total may not
// reflect a correction that was filed in a different period than the
// original entry.
// ============================================================

/**
 * Aggregates NET hours per actor from a set of FACT_WORK_LOGS row objects.
 * Excludes migrated/historical rows (via isMigratedWorkLog) and rows with
 * no actor identity, exactly-zero, or non-numeric hours. All other
 * nonzero hours (including negative correction deltas) are summed as-is,
 * so void+resubmit and amendment corrections net to their intended final
 * value.
 *
 * @param {Object[]} rows  FACT_WORK_LOGS row objects (any partition/period;
 *                         caller decides scope — single month, quarter, year)
 * @returns {Object}  { actor_code: { design_hours: number, qc_hours: number } }
 *                    Values rounded to 2 decimal places.
 */
function aggregateNetWorkLogHours(rows) {
  var hoursMap = {};

  for (var i = 0; i < (rows || []).length; i++) {
    var row = rows[i];
    if (isMigratedWorkLog(row)) continue;

    var code  = String((row && (row.actor_code || row.person_code)) || '').trim();
    var role  = String((row && row.actor_role) || '').toUpperCase();
    var hours = parseFloat(row && row.hours);

    if (!code || isNaN(hours) || hours === 0) continue;

    if (!hoursMap[code]) hoursMap[code] = { design_hours: 0, qc_hours: 0 };
    if (role === 'QC') {
      hoursMap[code].qc_hours += hours;
    } else {
      hoursMap[code].design_hours += hours;
    }
  }

  Object.keys(hoursMap).forEach(function (code) {
    hoursMap[code].design_hours = Math.round(hoursMap[code].design_hours * 100) / 100;
    hoursMap[code].qc_hours     = Math.round(hoursMap[code].qc_hours     * 100) / 100;
  });

  return hoursMap;
}
