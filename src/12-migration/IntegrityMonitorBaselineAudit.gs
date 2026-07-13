// ============================================================
// IntegrityMonitorBaselineAudit.gs — BLC Nexus T12 Migration/Audit
// src/12-migration/IntegrityMonitorBaselineAudit.gs
//
// Read-only PROD baseline audit for the Data Integrity Monitor
// (src/09-notifications/DataIntegrity*.gs). No writes anywhere in
// this file — safe to run directly against PROD, same pattern as
// WorkLogOrphanAudit.gs / DeadLetterQueueAudit.gs / RosterListAudit.gs
// in this directory.
//
// PURPOSE: establish real ground truth before writing any refinement
// to Checks 5 (test contamination), 6 (period_id format), or 10 (VW
// state integrity) — a "known baseline" needs a real count, and a
// decision to exclude an event_type or add a valid state needs to be
// based on what's actually in PROD, not a guess.
//
// HOW TO RUN (Apps Script editor, PROD):
//   runIntegrityMonitorBaselineAudit()                              — all 3
//   runIntegrityBaselineInvestigation1_VwStates()                   — 1 only
//   runIntegrityBaselineInvestigation2_WorkLogResidue()              — 2 only
//   runIntegrityBaselineInvestigation3_MalformedPeriodIdBreakdown()  — 3 only
//
// All output is console.log only. No sheet writes, no DAL writes, no
// Config.isDev() guard needed (nothing here can touch PROD data).
//
// Reuses (unmodified, same global GAS namespace):
//   discoverWorkLogPartitions_() — WorkLogOrphanAudit.gs
//   dimIsMalformedPeriodId_()    — DataIntegrityChecks_WorkLog.gs
//   normWd_()                    — WorkLogDedupAudit.gs
// ============================================================

var IMBA_MODULE_ = 'IntegrityMonitorBaselineAudit';
var IMBA_TEST_PERSON_CODES_ = ['DS1', 'QC1', 'RND', 'NTL'];

// ─────────────────────────────────────────────────────────────
// Investigation 1 — VW_JOB_CURRENT_STATE distinct current_state
// values with row counts, flagged against the check's current valid
// enum (Config.STATES + VOIDED/CANCELLED — mirrors
// checkVwStateIntegrity_()'s own enum-building logic exactly).
// Feeds a Check 10 fix: need every legitimate V2/migration state
// before deciding what belongs in the valid enum.
// ─────────────────────────────────────────────────────────────

/** @returns {Object} state -> count */
function runIntegrityBaselineInvestigation1_VwStates() {
  console.log('=== Investigation 1: VW_JOB_CURRENT_STATE distinct current_state values ===');

  var rows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: IMBA_MODULE_ });
  var counts = {};

  rows.forEach(function(r) {
    var state = String(r.current_state || '').trim();
    var key = state === '' ? '(blank)' : state;
    counts[key] = (counts[key] || 0) + 1;
  });

  // Mirrors checkVwStateIntegrity_()'s valid-state enum exactly
  // (DataIntegrityChecks_Entity.gs) so "NOT in current valid-state
  // enum" below reflects the real live check, not a re-derived guess.
  var validStates = {};
  Object.keys(Config.STATES).forEach(function(k) { validStates[Config.STATES[k]] = true; });
  validStates.VOIDED = true;
  validStates.CANCELLED = true;

  var keys = Object.keys(counts).sort(function(a, b) { return counts[b] - counts[a]; });
  console.log('Total VW_JOB_CURRENT_STATE rows: ' + rows.length);
  console.log('Distinct current_state values: ' + keys.length);
  console.log('');
  keys.forEach(function(k) {
    var flag = (k !== '(blank)' && validStates[k]) ? '' :
      '  <-- NOT in current valid-state enum (Config.STATES + VOIDED/CANCELLED)';
    console.log('  ' + k + ': ' + counts[k] + flag);
  });
  console.log('=== End Investigation 1 ===');

  return counts;
}

// ─────────────────────────────────────────────────────────────
// Investigation 2 — FACT_WORK_LOGS partitions 2026-06 and 2026-07:
// total rows tagged with a test actor_code (DS1/QC1/RND/NTL), and —
// among the countable SUBMITTED/MIGRATED rows specifically — how many
// pair against a matching WORK_LOG_VOIDED event (voided residue,
// harmless/permanent) vs how many don't (unvoided — worth a closer
// look). Void-key convention is identical to checkDuplicateWorkLogs_()
// in DataIntegrityChecks_WorkLog.gs: actor_code + job_number +
// work_date + abs(hours), paired one-for-one.
//
// Feeds a Check 5 fix: a "known residue" baseline needs a real count
// split from anything still live, not a single combined number.
// ─────────────────────────────────────────────────────────────

/** @returns {{totalRows:number, countableRows:number, voidedRows:number, unvoidedRows:number, otherEventTypeRows:number}} */
function runIntegrityBaselineInvestigation2_WorkLogResidue() {
  console.log('=== Investigation 2: FACT_WORK_LOGS test-actor residue (2026-06, 2026-07) ===');

  var periods = ['2026-06', '2026-07'];
  var testCodes = {};
  IMBA_TEST_PERSON_CODES_.forEach(function(c) { testCodes[c] = true; });

  var COUNTABLE = {};
  COUNTABLE[Constants.EVENT_TYPES.WORK_LOG_SUBMITTED] = true;
  COUNTABLE[Constants.EVENT_TYPES.WORK_LOG_MIGRATED]  = true;

  var summary = { totalRows: 0, countableRows: 0, voidedRows: 0, unvoidedRows: 0, otherEventTypeRows: 0 };
  var byActor = {};
  IMBA_TEST_PERSON_CODES_.forEach(function(c) { byActor[c] = { total: 0, countable: 0, voided: 0, unvoided: 0 }; });

  periods.forEach(function(periodId) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: IMBA_MODULE_, periodId: periodId });
    } catch (e) {
      console.log('  [' + periodId + '] partition not found — skipped (' + e.message + ')');
      return;
    }

    var testRows = rows.filter(function(r) {
      return testCodes[String(r.actor_code || '').trim().toUpperCase()];
    });

    var voidedCounts = {};
    testRows.forEach(function(r) {
      if (String(r.event_type || '') !== Constants.EVENT_TYPES.WORK_LOG_VOIDED) return;
      var ac  = String(r.actor_code || '').trim().toUpperCase();
      var jn  = String(r.job_number || '').trim();
      var wd  = normWd_(r.work_date, parseInt(periodId.split('-')[0], 10));
      var hrs = Math.abs(parseFloat(r.hours));
      if (!ac || !jn || !wd || isNaN(hrs)) return;
      var key = ac + '\x00' + jn + '\x00' + wd + '\x00' + hrs;
      voidedCounts[key] = (voidedCounts[key] || 0) + 1;
    });

    var periodTotal = testRows.length, periodVoided = 0, periodUnvoided = 0, periodOther = 0;

    testRows.forEach(function(r) {
      var eventType = String(r.event_type || '');
      var ac = String(r.actor_code || '').trim().toUpperCase();
      byActor[ac].total++;

      if (eventType === Constants.EVENT_TYPES.WORK_LOG_VOIDED) return; // the void event itself isn't residue to classify

      if (!COUNTABLE[eventType]) { periodOther++; summary.otherEventTypeRows++; return; }

      byActor[ac].countable++;
      summary.countableRows++;

      var jn  = String(r.job_number || '').trim();
      var wd  = normWd_(r.work_date, parseInt(periodId.split('-')[0], 10));
      var hrs = parseFloat(r.hours);
      var key = ac + '\x00' + jn + '\x00' + wd + '\x00' + hrs;

      if (voidedCounts[key] > 0) {
        voidedCounts[key]--;
        periodVoided++;
        summary.voidedRows++;
        byActor[ac].voided++;
      } else {
        periodUnvoided++;
        summary.unvoidedRows++;
        byActor[ac].unvoided++;
      }
    });

    summary.totalRows += periodTotal;
    console.log('  [' + periodId + '] total test-actor rows: ' + periodTotal +
                ' | countable (SUBMITTED/MIGRATED): ' + (periodVoided + periodUnvoided) +
                ' -> voided residue: ' + periodVoided + ', unvoided/live: ' + periodUnvoided +
                (periodOther ? ' | other event types: ' + periodOther : ''));
  });

  console.log('');
  console.log('TOTAL (2026-06 + 2026-07): ' + summary.totalRows + ' rows with a test actor_code');
  console.log('  Countable (SUBMITTED/MIGRATED): ' + summary.countableRows +
              ' -> voided residue: ' + summary.voidedRows + ', unvoided/live: ' + summary.unvoidedRows);
  if (summary.otherEventTypeRows) {
    console.log('  Other event types (not classified voided/unvoided): ' + summary.otherEventTypeRows);
  }
  console.log('By actor_code (total / countable / voided / unvoided):');
  IMBA_TEST_PERSON_CODES_.forEach(function(c) {
    var a = byActor[c];
    console.log('  ' + c + ': ' + a.total + ' / ' + a.countable + ' / ' + a.voided + ' / ' + a.unvoided);
  });
  console.log('=== End Investigation 2 ===');

  return summary;
}

// ─────────────────────────────────────────────────────────────
// Investigation 3 — malformed period_id rows across ALL discoverable
// FACT_WORK_LOGS partitions (not just the 2 the live Check 6 monitor
// scans — this is a one-time ground-truth audit, not a re-run of the
// daily check), broken down by event_type. dimIsMalformedPeriodId_()
// is reused unmodified from DataIntegrityChecks_WorkLog.gs.
//
// Feeds a Check 6 fix: need to know whether malformed rows are
// dominated by WORK_LOG_PERIOD_FIXED (the fixer's own output — i.e.
// a write-time bug reproducing the exact condition it's meant to fix)
// or by other event types (a different, unrelated source), before
// deciding whether an event_type exclusion is even the right shape
// of fix.
// ─────────────────────────────────────────────────────────────

/** @returns {{total:number, byEventType:Object, byPartition:Object}} */
function runIntegrityBaselineInvestigation3_MalformedPeriodIdBreakdown() {
  console.log('=== Investigation 3: malformed period_id rows by event_type (all partitions) ===');

  var partitions = discoverWorkLogPartitions_();
  console.log('Partitions scanned: ' + partitions.join(', '));

  var byEventType = {};
  var byPartition = {};
  var total = 0;

  partitions.forEach(function(periodId) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: IMBA_MODULE_, periodId: periodId });
    } catch (e) {
      console.log('  [' + periodId + '] read failed — skipped (' + e.message + ')');
      return;
    }

    var partitionCount = 0;
    rows.forEach(function(r) {
      if (!dimIsMalformedPeriodId_(r.period_id)) return;
      var eventType = String(r.event_type || '(blank)');
      byEventType[eventType] = (byEventType[eventType] || 0) + 1;
      total++;
      partitionCount++;
    });
    if (partitionCount > 0) byPartition[periodId] = partitionCount;
  });

  console.log('');
  console.log('TOTAL malformed period_id rows across all partitions: ' + total);
  console.log('');
  console.log('By event_type:');
  Object.keys(byEventType)
    .sort(function(a, b) { return byEventType[b] - byEventType[a]; })
    .forEach(function(et) {
      var pct = total > 0 ? (byEventType[et] / total * 100).toFixed(1) : '0.0';
      console.log('  ' + et + ': ' + byEventType[et] + ' (' + pct + '%)');
    });
  console.log('');
  console.log('By partition:');
  Object.keys(byPartition).sort().forEach(function(p) {
    console.log('  ' + p + ': ' + byPartition[p]);
  });
  console.log('=== End Investigation 3 ===');

  return { total: total, byEventType: byEventType, byPartition: byPartition };
}

// ─────────────────────────────────────────────────────────────
// Combined runner — all 3 investigations in sequence.
// ─────────────────────────────────────────────────────────────

/** @returns {{investigation1:Object, investigation2:Object, investigation3:Object}} */
function runIntegrityMonitorBaselineAudit() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  DATA INTEGRITY MONITOR — PROD BASELINE AUDIT         ║');
  console.log('║  Read-only. No writes. Safe to run in PROD.           ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  var inv1 = runIntegrityBaselineInvestigation1_VwStates();
  console.log('');
  var inv2 = runIntegrityBaselineInvestigation2_WorkLogResidue();
  console.log('');
  var inv3 = runIntegrityBaselineInvestigation3_MalformedPeriodIdBreakdown();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  AUDIT COMPLETE — share full console output before    ║');
  console.log('║  any fix code is written for Checks 5, 6, or 10.      ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  return { investigation1: inv1, investigation2: inv2, investigation3: inv3 };
}
