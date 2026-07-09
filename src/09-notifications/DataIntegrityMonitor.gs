// ============================================================
// DataIntegrityMonitor.gs — BLC Nexus T9 Notifications
// src/09-notifications/DataIntegrityMonitor.gs
//
// Orchestrator only: severity framework + runDataIntegrityChecks().
// Trigger wiring and alert-email formatting land in commit 5. Until
// then this is a manual/console runner — no trigger, no email.
//
// The 10 check functions this file calls live in sibling files
// (split 2026-07-09 to stay under RULE A8's ~500-line module cap,
// .claude/rules/core_rules.md — the original single-file version hit
// 828 lines). Same global GAS namespace, so no import is needed:
//   DataIntegrityChecks_WorkLog.gs  — checks 1, 2, 6, 7 (FACT_WORK_LOGS)
//   DataIntegrityChecks_Entity.gs   — checks 3, 5, 8, 9, 10 (dimension/VW)
//   DataSelfHealing.gs              — check 4 + dead letter/queue-stall healing (commit 3)
//   PreBillingGate.gs               — pre-billing gate (commit 4, not yet built)
//
// File location note: the original build spec named this file for
// src/03-infrastructure/. It lives in src/09-notifications/ instead,
// next to ExecutionHealthMonitor.gs — RULE X forbids business logic
// in 03-infrastructure (logging/health/errors only), and this
// monitor's checks (client/roster/VW/queue reads) are exactly the
// kind of business-rule logic ExecutionHealthMonitor.gs already
// contains at T9.
//
// Severity:
//   CRITICAL — data actively wrong, stop-work candidate. Alert immediately (commit 5).
//   HIGH     — will affect billing if not fixed before next cycle. Daily digest (commit 5).
//   MEDIUM   — data quality issue, no immediate business impact. Weekly digest (commit 5).
//   INFO     — expected/known condition. Log only, never alerts.
//
// Issue shape (stable contract — commit 4's pre-billing gate and
// commit 5's alert routing both consume this without reshaping):
//   {
//     check:             'CHECK_1_DUPLICATE_WORK_LOGS',
//     severity:          'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO',
//     category:          short machine-stable tag, e.g. 'DUPLICATE_WORK_LOGS'
//     message:           human-readable summary
//     data:              { ...check-specific detail, counts, samples }
//     recommendedAction: human-readable next step
//   }
//
// MANUAL RUN: runDataIntegrityChecks()
// ============================================================

var DIM_SEVERITY_ = { CRITICAL: 'CRITICAL', HIGH: 'HIGH', MEDIUM: 'MEDIUM', INFO: 'INFO' };

/**
 * Runs Checks 1–10, logs a summary to console grouped by severity, and
 * returns the full structured result. Read-only. No trigger, no email
 * (those land in commit 5) — call this manually from the Apps Script
 * editor or chain it into other runners.
 * @returns {{ issues: Object[], bySeverity: Object, counts: Object }}
 */
function runDataIntegrityChecks() {
  var MODULE = 'DataIntegrityMonitor';
  var issues = [];

  try { issues = issues.concat(checkDuplicateWorkLogs_()); }
  catch (e) { console.log('[DataIntegrityMonitor] Check 1 (duplicate work logs) failed: ' + e.message); }

  try { issues = issues.concat(checkOrphanedWorkLogs_()); }
  catch (e) { console.log('[DataIntegrityMonitor] Check 2 (orphaned work logs) failed: ' + e.message); }

  try { issues = issues.concat(checkClientCodeConsistency_()); }
  catch (e) { console.log('[DataIntegrityMonitor] Check 3 (client code consistency) failed: ' + e.message); }

  try { issues = issues.concat(checkDeadLetterGrowth_()); }
  catch (e) { console.log('[DataIntegrityMonitor] Check 4 (dead letter growth) failed: ' + e.message); }

  try { issues = issues.concat(checkTestContamination_()); }
  catch (e) { console.log('[DataIntegrityMonitor] Check 5 (test contamination) failed: ' + e.message); }

  try { issues = issues.concat(checkPeriodIdFormat_()); }
  catch (e) { console.log('[DataIntegrityMonitor] Check 6 (period_id format) failed: ' + e.message); }

  try { issues = issues.concat(checkJobNumberNormalization_()); }
  catch (e) { console.log('[DataIntegrityMonitor] Check 7 (job number normalization) failed: ' + e.message); }

  try { issues = issues.concat(checkAllocatedToValidity_()); }
  catch (e) { console.log('[DataIntegrityMonitor] Check 8 (allocated_to validation) failed: ' + e.message); }

  try { issues = issues.concat(checkRateConfigurationCompleteness_()); }
  catch (e) { console.log('[DataIntegrityMonitor] Check 9 (rate configuration) failed: ' + e.message); }

  try { issues = issues.concat(checkVwStateIntegrity_()); }
  catch (e) { console.log('[DataIntegrityMonitor] Check 10 (VW state integrity) failed: ' + e.message); }

  var bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], INFO: [] };
  issues.forEach(function(i) {
    (bySeverity[i.severity] || (bySeverity[i.severity] = [])).push(i);
  });

  var counts = {
    CRITICAL: bySeverity.CRITICAL.length,
    HIGH:     bySeverity.HIGH.length,
    MEDIUM:   bySeverity.MEDIUM.length,
    INFO:     bySeverity.INFO.length,
    total:    issues.length
  };

  Logger.info('DATA_INTEGRITY_CHECK_DONE', { module: MODULE, counts: counts });

  console.log('[DataIntegrityMonitor] Run complete — ' + counts.total + ' issue(s): ' +
              counts.CRITICAL + ' CRITICAL, ' + counts.HIGH + ' HIGH, ' +
              counts.MEDIUM + ' MEDIUM, ' + counts.INFO + ' INFO.');
  issues.forEach(function(i) {
    console.log('  • [' + i.severity + '] ' + i.check + ' — ' + i.message);
  });
  if (issues.length === 0) {
    console.log('[DataIntegrityMonitor] ✅ All clear — no issues detected across checks 1–10.');
  }

  return { issues: issues, bySeverity: bySeverity, counts: counts };
}
