// ============================================================
// DataIntegrityMonitor.gs — BLC Nexus T9 Notifications
// src/09-notifications/DataIntegrityMonitor.gs
//
// Orchestrator: severity framework, runDataIntegrityChecks(), and (as
// of commit 5) trigger wiring + severity-based alerting.
//
// The 10 check functions this file calls live in sibling files
// (split 2026-07-09 to stay under RULE A8's ~500-line module cap,
// .claude/rules/core_rules.md — the original single-file version hit
// 828 lines). Same global GAS namespace, so no import is needed:
//   DataIntegrityChecks_WorkLog.gs  — checks 1, 2, 6, 7 (FACT_WORK_LOGS)
//   DataIntegrityChecks_Entity.gs   — checks 3, 5, 8, 9, 10 (dimension/VW)
//   DataSelfHealing.gs              — check 4 + dead letter/queue-stall healing (commit 3)
//   PreBillingGate.gs               — pre-billing gate (commit 4)
//
// File location note: the original build spec named this file for
// src/03-infrastructure/. It lives in src/09-notifications/ instead,
// next to ExecutionHealthMonitor.gs — RULE X forbids business logic
// in 03-infrastructure (logging/health/errors only), and this
// monitor's checks (client/roster/VW/queue reads) are exactly the
// kind of business-rule logic ExecutionHealthMonitor.gs already
// contains at T9.
//
// Severity → alert routing:
//   CRITICAL — emailed immediately, same run that found it (05:00 daily).
//   HIGH     — written to _SYS_INTEGRITY_DIGEST; one digest email at 06:00 daily.
//   MEDIUM   — written to _SYS_INTEGRITY_DIGEST; one digest email Sunday 06:00.
//   INFO     — logged via Logger.info() only. Never emailed, never digested.
//
// runDataIntegrityChecks() itself stays pure (no email, no digest
// writes) — it's the function commits 1-4 already built and
// PreBillingGate.gs's callers rely on it (and the individual check
// functions) staying side-effect-free. The 05:00 trigger points at
// the new runDataIntegrityMonitorJob() below instead, which wraps
// runDataIntegrityChecks() with alerting — same split as
// ExecutionHealthMonitor.gs's runHealthMonitorJob() (trigger, alerts)
// vs. runHealthCheck() (manual, side-effect-free by default).
//
// Function-name correction from the build spec: the existing 15-min
// health monitor's trigger-bound entry point is runHealthMonitorJob()
// (ExecutionHealthMonitor.gs), not "runExecutionHealthMonitor" — that
// name doesn't exist in this codebase. The queue stall check
// (Check 4's sibling self-healing action) is wired into the real
// function name.
//
// Trigger landscape after this commit:
//   Every 15 min   — runHealthMonitorJob() (existing, unchanged) +
//                     runQueueStallRecovery() call added inside it
//                     (DataSelfHealing.gs handles its own debounce —
//                     see that file — so no new trigger needed here)
//   Daily 03:00    — REMOVED: runProdContaminationCheck() standalone
//                     trigger. Its logic is Check 5, now covered by
//                     the 05:00 run below. runProdContaminationCheck()
//                     itself is untouched (still callable manually)
//                     — only its install/remove trigger functions and
//                     the trigger they installed are removed.
//   Daily 04:00    — runDeadLetterRecovery() (DataSelfHealing.gs)
//   Daily 05:00    — runDataIntegrityMonitorJob() (this file — all 10
//                     checks + CRITICAL immediate email + HIGH/MEDIUM
//                     digest writes)
//   Daily 06:00    — runSendDailyIntegrityDigest() (this file)
//   Sunday 06:00   — runSendWeeklyIntegrityDigest() (this file)
//
// Install/remove: runInstallDataIntegrityTriggers() / runRemoveDataIntegrityTriggers()
// below install/remove the 04:00/05:00/06:00/Sunday-06:00 triggers as
// one group (04:00 points at a DataSelfHealing.gs function — GAS
// triggers reference function names as strings, so which file defines
// the function doesn't matter). The 15-min trigger is unchanged and
// managed separately by ExecutionHealthMonitor.gs's own install/remove
// functions, as before.
//
// DEV behavior: every MailApp.sendEmail call in this file is preceded
// by a Config.isDev() check — checks/digest-writes still run and log
// normally in DEV, no email is ever sent.
//
// Issue shape (stable contract — PreBillingGate.gs and this file's
// alert routing both consume this without reshaping):
//   {
//     check:             'CHECK_1_DUPLICATE_WORK_LOGS',
//     severity:          'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO',
//     category:          short machine-stable tag, e.g. 'DUPLICATE_WORK_LOGS'
//     message:           human-readable summary
//     data:              { ...check-specific detail, counts, samples }
//     recommendedAction: human-readable next step
//   }
//
// MANUAL RUN (no side effects): runDataIntegrityChecks()
// MANUAL RUN (with alerting, same as the 05:00 trigger): runDataIntegrityMonitorJob()
// ============================================================

var DIM_SEVERITY_ = { CRITICAL: 'CRITICAL', HIGH: 'HIGH', MEDIUM: 'MEDIUM', INFO: 'INFO' };
var DIM_ALERT_RECIPIENT_ = 'raj.nair@bluelotuscanada.ca';

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

// ─────────────────────────────────────────────────────────────
// Trigger-bound entry point (05:00 daily) — commit 5
// ─────────────────────────────────────────────────────────────

/**
 * Runs all 10 checks (via runDataIntegrityChecks()) then routes by
 * severity: CRITICAL emails immediately, HIGH/MEDIUM write to
 * _SYS_INTEGRITY_DIGEST for their respective digest emails, INFO is
 * already logged by runDataIntegrityChecks() itself. Bind this to the
 * 05:00 trigger, not runDataIntegrityChecks() directly.
 */
function runDataIntegrityMonitorJob() {
  var result = runDataIntegrityChecks();

  if (result.bySeverity.CRITICAL.length > 0) {
    dimSendCriticalAlert_(result.bySeverity.CRITICAL);
  }

  var toDigest = result.bySeverity.HIGH.concat(result.bySeverity.MEDIUM);
  if (toDigest.length > 0) {
    dimWriteDigestRows_(toDigest);
  }
}

// ─────────────────────────────────────────────────────────────
// Alerting — CRITICAL immediate email + HIGH/MEDIUM digest writes
// ─────────────────────────────────────────────────────────────

/** Sends one email for all CRITICAL issues from a single run. DEV: logs only. */
function dimSendCriticalAlert_(criticalIssues) {
  var subject = 'ACTION REQUIRED — BLC Nexus: ' + criticalIssues.length +
                ' critical data integrity issue' + (criticalIssues.length !== 1 ? 's' : '');
  var intro = 'The data integrity monitor found ' + criticalIssues.length +
              ' CRITICAL issue' + (criticalIssues.length !== 1 ? 's' : '') +
              ' during the 05:00 daily run. These are stop-work candidates per the severity framework.';

  if (Config.isDev()) {
    console.log('[DataIntegrityMonitor] DEV — would send CRITICAL alert: ' + subject);
    return;
  }

  MailApp.sendEmail({
    to: DIM_ALERT_RECIPIENT_,
    subject: subject,
    htmlBody: dimBuildAlertEmailHtml_('BLC Nexus — Critical Data Integrity Alert', intro, criticalIssues)
  });

  Logger.info('DATA_INTEGRITY_CRITICAL_ALERT_SENT', {
    module: 'DataIntegrityMonitor', count: criticalIssues.length, recipient: DIM_ALERT_RECIPIENT_
  });
}

/** Appends HIGH/MEDIUM issues to _SYS_INTEGRITY_DIGEST for the daily/weekly digest emails. */
function dimWriteDigestRows_(issues) {
  var MODULE = 'DataIntegrityMonitor';
  var timestamp = new Date().toISOString();

  var rows = issues.map(function(i) {
    return {
      entry_id:           Identifiers.generateId(),
      timestamp:          timestamp,
      severity:           i.severity,
      check_name:         i.check,
      category:           i.category,
      message:            i.message,
      recommended_action: i.recommendedAction || '',
      data_json:          JSON.stringify(i.data || {})
    };
  });

  try {
    // RULE P2 nominally points to BatchOperations.gs for multi-row writes,
    // but that module doesn't exist in this codebase yet (grep confirms —
    // only referenced in a DAL.gs comment). DAL.appendRows() is the real,
    // working bulk-write primitive (single API call, no chunking) and is
    // the right size for this — a handful of HIGH/MEDIUM findings per run,
    // not the >50-row case BatchOperations.gs would exist to chunk.
    DAL.appendRows(Config.TABLES.SYS_INTEGRITY_DIGEST, rows, { callerModule: MODULE });
  } catch (e) {
    if (e.code === 'SHEET_NOT_FOUND') {
      console.log('[DataIntegrityMonitor] ⚠️ _SYS_INTEGRITY_DIGEST tab does not exist — ' +
                  'run runSetupSchemas() to create it. ' + rows.length + ' digest row(s) NOT written.');
      Logger.warn('INTEGRITY_DIGEST_TABLE_MISSING', { module: MODULE, dropped_rows: rows.length });
      return;
    }
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────
// Digest senders — 06:00 daily (HIGH) and Sunday 06:00 weekly (MEDIUM)
// ─────────────────────────────────────────────────────────────

/** Reads _SYS_INTEGRITY_DIGEST rows matching severity within the last windowMs. */
function dimReadDigestRows_(severity, windowMs) {
  var MODULE = 'DataIntegrityMonitor';
  var rows;
  try {
    rows = DAL.readAll(Config.TABLES.SYS_INTEGRITY_DIGEST, { callerModule: MODULE });
  } catch (e) {
    if (e.code === 'SHEET_NOT_FOUND') return [];
    throw e;
  }
  var cutoff = new Date(Date.now() - windowMs).toISOString();
  return rows.filter(function(r) {
    return String(r.severity || '') === severity && String(r.timestamp || '') >= cutoff;
  });
}

/**
 * Trigger-bound (06:00 daily). Sends one digest email if any HIGH
 * findings were written to _SYS_INTEGRITY_DIGEST in the last 24h.
 * DEV: logs only, no email.
 */
function runSendDailyIntegrityDigest() {
  var rows = dimReadDigestRows_(DIM_SEVERITY_.HIGH, 24 * 60 * 60 * 1000);
  if (rows.length === 0) {
    console.log('[DataIntegrityMonitor] Daily digest — no HIGH findings in the last 24h. No email sent.');
    return;
  }

  var subject = 'BLC Nexus Daily Integrity Report — ' + rows.length + ' issue' + (rows.length !== 1 ? 's' : '');
  var intro   = rows.length + ' HIGH-severity issue' + (rows.length !== 1 ? 's' : '') +
                ' found in the last 24 hours, grouped by check.';

  if (Config.isDev()) {
    console.log('[DataIntegrityMonitor] DEV — would send daily digest: ' + subject);
    return;
  }

  MailApp.sendEmail({
    to: DIM_ALERT_RECIPIENT_,
    subject: subject,
    htmlBody: dimBuildAlertEmailHtml_('BLC Nexus — Daily Integrity Digest', intro, dimDigestRowsToIssues_(rows))
  });
}

/**
 * Trigger-bound (Sunday 06:00). Sends one digest email if any MEDIUM
 * findings were written to _SYS_INTEGRITY_DIGEST in the last 7 days.
 * DEV: logs only, no email.
 */
function runSendWeeklyIntegrityDigest() {
  var rows = dimReadDigestRows_(DIM_SEVERITY_.MEDIUM, 7 * 24 * 60 * 60 * 1000);
  if (rows.length === 0) {
    console.log('[DataIntegrityMonitor] Weekly digest — no MEDIUM findings in the last 7 days. No email sent.');
    return;
  }

  var subject = 'BLC Nexus Weekly Integrity Report — ' + rows.length + ' issue' + (rows.length !== 1 ? 's' : '');
  var intro   = rows.length + ' MEDIUM-severity issue' + (rows.length !== 1 ? 's' : '') +
                ' found in the last 7 days, grouped by check.';

  if (Config.isDev()) {
    console.log('[DataIntegrityMonitor] DEV — would send weekly digest: ' + subject);
    return;
  }

  MailApp.sendEmail({
    to: DIM_ALERT_RECIPIENT_,
    subject: subject,
    htmlBody: dimBuildAlertEmailHtml_('BLC Nexus — Weekly Integrity Digest', intro, dimDigestRowsToIssues_(rows))
  });
}

/** Converts _SYS_INTEGRITY_DIGEST rows back into the issue shape dimBuildAlertEmailHtml_ expects. */
function dimDigestRowsToIssues_(rows) {
  return rows.map(function(r) {
    return {
      check: r.check_name, severity: r.severity, category: r.category,
      message: r.message, recommendedAction: r.recommended_action
    };
  });
}

/**
 * Shared HTML email builder — same visual pattern as
 * ExecutionHealthMonitor.gs's sendHealthAlert_ (colour-coded severity
 * badges in a bordered table) for a consistent look across BLC
 * Nexus's system emails.
 */
function dimBuildAlertEmailHtml_(title, intro, issues) {
  var SEVERITY_COLOURS = {
    CRITICAL: { fg: '#c0392b', bg: '#fdf0ef' },
    HIGH:     { fg: '#e67e22', bg: '#fef9ef' },
    MEDIUM:   { fg: '#2e7d32', bg: '#f1f8f2' },
    INFO:     { fg: '#607d8b', bg: '#f5f7f8' }
  };

  var rows = issues.map(function(i) {
    var colours = SEVERITY_COLOURS[i.severity] || SEVERITY_COLOURS.INFO;
    var badge = '<span style="display:inline-block;background:' + colours.fg + ';color:#fff;' +
                'border-radius:3px;padding:1px 6px;font-size:11px;font-weight:bold;margin-right:8px;">' +
                i.severity + '</span>';
    var action = i.recommendedAction
      ? '<br><span style="font-size:12px;color:#666;">→ ' + i.recommendedAction + '</span>' : '';
    return '<tr style="background:' + colours.bg + ';border-bottom:1px solid #eee;">' +
           '<td style="padding:10px 14px;font-size:13px;color:#333;">' +
             badge + '<strong>' + (i.check || '') + '</strong> — ' + i.message + action +
           '</td></tr>';
  }).join('');

  return '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#222;">' +
    '<div style="background:#1a3c6e;padding:20px 28px;border-radius:6px 6px 0 0;">' +
    '  <h2 style="margin:0;color:#fff;font-size:18px;">' + title + '</h2>' +
    '  <p style="margin:4px 0 0;color:#a8c4e8;font-size:12px;">' +
         Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEEE, dd MMM yyyy HH:mm z') +
    '  </p>' +
    '</div>' +
    '<div style="border:1px solid #ddd;border-top:none;padding:24px 28px;border-bottom:none;">' +
    '  <p style="font-size:14px;margin:0 0 16px;">' + intro + '</p>' +
    '  <table style="width:100%;border-collapse:collapse;border-radius:4px;overflow:hidden;">' + rows + '</table>' +
    '</div>' +
    '<div style="border:1px solid #ddd;border-top:none;padding:12px 28px;border-radius:0 0 6px 6px;background:#f8f9fc;">' +
    '  <p style="font-size:12px;color:#888;margin:0;">— BLC Nexus DataIntegrityMonitor</p>' +
    '</div>' +
    '</div>';
}

// ─────────────────────────────────────────────────────────────
// Trigger install/remove — 04:00, 05:00, 06:00 daily, Sunday 06:00
// ─────────────────────────────────────────────────────────────

/**
 * Installs the 04:00 (dead letter recovery), 05:00 (data integrity
 * checks), 06:00 daily (HIGH digest), and Sunday 06:00 (MEDIUM
 * digest) triggers as one group. Idempotent — removes any existing
 * copies of these four triggers first. Does NOT touch the 15-min
 * health monitor trigger (ExecutionHealthMonitor.gs owns that).
 */
function runInstallDataIntegrityTriggers() {
  var HANDLERS = [
    'runDeadLetterRecovery', 'runDataIntegrityMonitorJob',
    'runSendDailyIntegrityDigest', 'runSendWeeklyIntegrityDigest'
  ];
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (HANDLERS.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('runDeadLetterRecovery').timeBased().everyDays(1).atHour(4).create();
  ScriptApp.newTrigger('runDataIntegrityMonitorJob').timeBased().everyDays(1).atHour(5).create();
  ScriptApp.newTrigger('runSendDailyIntegrityDigest').timeBased().everyDays(1).atHour(6).create();
  ScriptApp.newTrigger('runSendWeeklyIntegrityDigest').timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(6).create();

  console.log('✅ Data integrity triggers installed: 04:00 dead letter recovery, ' +
              '05:00 checks, 06:00 daily digest, Sunday 06:00 weekly digest.');
}

/** Removes the four triggers installed by runInstallDataIntegrityTriggers(). */
function runRemoveDataIntegrityTriggers() {
  var HANDLERS = [
    'runDeadLetterRecovery', 'runDataIntegrityMonitorJob',
    'runSendDailyIntegrityDigest', 'runSendWeeklyIntegrityDigest'
  ];
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (HANDLERS.indexOf(t.getHandlerFunction()) !== -1) { ScriptApp.deleteTrigger(t); removed++; }
  });
  console.log(removed ? ('✅ Removed ' + removed + ' data integrity trigger(s).') : '⚠️ No triggers found — already removed.');
}
