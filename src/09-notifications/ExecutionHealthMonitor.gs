// ============================================================
// ExecutionHealthMonitor.gs — BLC Nexus T9 Notifications
// src/09-notifications/ExecutionHealthMonitor.gs
//
// Runs every 15 minutes. Checks for application-level failures:
//   1. _SYS_LOGS — ERROR entries in the last 30 minutes
//   2. DEAD_LETTER_QUEUE — any unreviewed items
//   3. STG_PROCESSING_QUEUE — items stuck > 2 hours in PENDING
//
// NOTE: GAS cannot directly read the Apps Script Executions tab
// (that requires an external Cloud project OAuth call). This monitor
// watches the application layer via DAL, which catches all errors
// that pass through our try/catch handlers — the large majority.
//
// INSTALL:  runInstallHealthMonitorTrigger()
// REMOVE:   runRemoveHealthMonitorTrigger()
// MANUAL:   runHealthCheck()
//
// As of commit 5 (DataIntegrityMonitor.gs), runHealthMonitorJob() also
// calls DataSelfHealing.gs's runQueueStallRecovery() on every 15-min
// cycle (self-contained: its own Config.isDev() gate + cooldown, so
// no changes needed here beyond the one call).
//
// ── PROD contamination check (R10) ─────────────────────────
// checkRosterContamination_() / checkVwContamination_() /
// checkWorkLogContamination_() / checkQueueContamination_() below are
// still live — DataIntegrityChecks_Entity.gs's Check 5 calls them
// directly as part of the 05:00 daily data integrity run. What's
// removed as of commit 5 is only the STANDALONE 03:00 trigger + its
// install/remove functions — that cadence is superseded by the 05:00
// run, which now covers this same scan daily. runProdContaminationCheck()
// itself is untouched and still callable manually for an on-demand check.
//
// MANUAL: runProdContaminationCheck()
//
// ⚠️  If runInstallProdContaminationTrigger() was ever run in PROD, the
// 03:00 trigger it created is NOT removed by deploying this commit —
// GAS triggers are project state, not code. Remove it manually via
// Apps Script editor → Triggers, or run the now-deleted
// runRemoveProdContaminationTrigger() one last time from a version
// before this commit before deploying.
// ============================================================

var HM_ALERT_RECIPIENT_PROP_ = 'CEO_BRIEFING_RECIPIENT';
var HM_LAST_ALERT_PROP_      = 'HM_LAST_ALERT_MS';
var HM_ALERT_COOLDOWN_MS_    = 2 * 60 * 60 * 1000;   // 2 hours between alerts
var HM_LOOK_BACK_MS_         = 30 * 60 * 1000;        // scan last 30 minutes of logs
var HM_STUCK_THRESHOLD_MS_   = 2 * 60 * 60 * 1000;   // queue items stuck > 2 hours

// SOP module is WIP — remove this suppression when DIM_SOP_TEMPLATES
// is built. See PROJECT_MEMORY.md §7. Until then, SopDAL.gs/Portal.gs
// log these two action codes as ERROR on every SOP-template read
// attempt (there's nothing to read yet), which would otherwise alert
// on expected, known noise every 15-min cycle.
var HM_SUPPRESSED_ERROR_ACTIONS_ = {
  SOP_DAL_READ_FAILED:             true,
  PORTAL_SOP_TEMPLATE_READ_FAILED: true
};

/**
 * Clock trigger entry point — runs every 15 minutes.
 * Do not rename: trigger is keyed to this exact function name.
 */
function runHealthMonitorJob() {
  // Self-healing action, not an "issue" — DataSelfHealing.gs's own
  // Config.isDev() gate and 15-min cooldown make this safe to call
  // unconditionally on every cycle. Isolated in its own try/catch so
  // a failure here never blocks the issue-collection/alerting below.
  try { runQueueStallRecovery(); } catch (e) { console.log('[HealthMonitor] runQueueStallRecovery failed: ' + e.message); }

  try {
    var issues = collectIssues_();
    if (issues.length === 0) return;

    var props     = PropertiesService.getScriptProperties();
    var lastAlert = parseInt(props.getProperty(HM_LAST_ALERT_PROP_) || '0', 10);
    if (Date.now() - lastAlert < HM_ALERT_COOLDOWN_MS_) {
      console.log('[HealthMonitor] Issues found but within cooldown window. Suppressing alert.');
      return;
    }

    var recipient = props.getProperty(HM_ALERT_RECIPIENT_PROP_) || 'raj.nair@bluelotuscanada.ca';
    sendHealthAlert_(recipient, issues);
    props.setProperty(HM_LAST_ALERT_PROP_, String(Date.now()));
  } catch(e) {
    console.log('[HealthMonitor] ❌ Monitor itself failed: ' + e.message);
  }
}

/**
 * Manual run — prints issues to console, optionally sends email.
 * @param {boolean} sendEmail  Default false — set true to force send even within cooldown.
 */
function runHealthCheck(sendEmail) {
  var issues = collectIssues_();
  if (issues.length === 0) {
    console.log('[HealthMonitor] ✅ All clear — no issues detected.');
    return;
  }
  console.log('[HealthMonitor] ⚠️ Issues found:');
  issues.forEach(function(i) { console.log('  • [' + i.severity + '] ' + i.message); });

  if (sendEmail) {
    var recipient = PropertiesService.getScriptProperties()
                      .getProperty(HM_ALERT_RECIPIENT_PROP_) || 'raj.nair@bluelotuscanada.ca';
    sendHealthAlert_(recipient, issues);
    console.log('[HealthMonitor] Alert sent to ' + recipient);
  }
}

// ─────────────────────────────────────────────────────────────
// Issue collectors
// ─────────────────────────────────────────────────────────────

function collectIssues_() {
  var issues = [];
  try { issues = issues.concat(checkSysLogs_()); }    catch(e) { console.log('[HM] checkSysLogs failed: ' + e.message); }
  try { issues = issues.concat(checkDeadLetter_()); } catch(e) { console.log('[HM] checkDeadLetter failed: ' + e.message); }
  try { issues = issues.concat(checkStuckQueue_()); } catch(e) { console.log('[HM] checkStuckQueue failed: ' + e.message); }
  return issues;
}

function checkSysLogs_() {
  var issues  = [];
  var cutoff  = new Date(Date.now() - HM_LOOK_BACK_MS_).toISOString();
  var rows    = DAL.readAll(Config.TABLES.SYS_LOGS, { callerModule: 'ExecutionHealthMonitor' });
  var allErrors = rows.filter(function(r) {
    return String(r.level || '').toUpperCase() === 'ERROR' &&
           String(r.timestamp || '') >= cutoff;
  });

  // SOP suppression (see HM_SUPPRESSED_ERROR_ACTIONS_ above) — these
  // don't count toward alerting. Logged once as INFO here rather than
  // per-row, so the suppression itself doesn't add ERROR-scan noise.
  var suppressedCount = 0;
  var errors = allErrors.filter(function(r) {
    if (HM_SUPPRESSED_ERROR_ACTIONS_[String(r.action || '')]) { suppressedCount++; return false; }
    return true;
  });
  if (suppressedCount > 0) {
    Logger.info('SOP_ERRORS_SUPPRESSED', {
      module: 'ExecutionHealthMonitor', count: suppressedCount,
      message: suppressedCount + ' SOP-module error(s) suppressed from health-monitor alerting (WIP module, PROJECT_MEMORY.md §7).'
    });
  }

  if (errors.length === 0) return issues;

  // Group by module to avoid noise
  var byModule = {};
  errors.forEach(function(r) {
    var mod = String(r.module || 'UNKNOWN');
    if (!byModule[mod]) byModule[mod] = [];
    byModule[mod].push(r);
  });

  Object.keys(byModule).forEach(function(mod) {
    var count = byModule[mod].length;
    var sample = byModule[mod][byModule[mod].length - 1];
    issues.push({
      severity: 'ERROR',
      category: 'SYS_LOGS',
      message:  mod + ': ' + count + ' error(s) in last 30 min. ' +
                'Latest: ' + (sample.action || '') + ' — ' + (sample.message || '')
    });
  });
  return issues;
}

function checkDeadLetter_() {
  var issues = [];
  var rows   = DAL.readAll(Config.TABLES.DEAD_LETTER_QUEUE, { callerModule: 'ExecutionHealthMonitor' });
  // Only alert on items added in last 24 hours to avoid re-alerting on old known items
  var cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  var recent = rows.filter(function(r) {
    return String(r.moved_at || r.timestamp || '') >= cutoff;
  });
  if (recent.length > 0) {
    issues.push({
      severity: 'ERROR',
      category: 'DEAD_LETTER',
      message:  recent.length + ' item(s) moved to Dead Letter Queue in the last 24 hours. ' +
                'These require manual review in the Dead Letter Queue sheet.'
    });
  }
  return issues;
}

function checkStuckQueue_() {
  var issues  = [];
  var cutoff  = new Date(Date.now() - HM_STUCK_THRESHOLD_MS_).toISOString();
  var rows    = DAL.readAll(Config.TABLES.STG_PROCESSING_QUEUE, { callerModule: 'ExecutionHealthMonitor' });
  var stuck   = rows.filter(function(r) {
    var status    = String(r.status || '').toUpperCase();
    var createdAt = String(r.created_at || r.timestamp || '');
    return (status === 'PENDING' || status === 'PROCESSING') && createdAt < cutoff && createdAt !== '';
  });
  if (stuck.length > 0) {
    issues.push({
      severity: 'WARN',
      category: 'QUEUE_STUCK',
      message:  stuck.length + ' queue item(s) have been PENDING/PROCESSING for over 2 hours. ' +
                'QueueProcessor may not be running. Check Triggers tab.'
    });
  }
  return issues;
}

// ─────────────────────────────────────────────────────────────
// Email builder
// ─────────────────────────────────────────────────────────────

function sendHealthAlert_(recipient, issues) {
  var errorCount = issues.filter(function(i) { return i.severity === 'ERROR'; }).length;
  var warnCount  = issues.filter(function(i) { return i.severity === 'WARN';  }).length;
  var emoji      = errorCount > 0 ? '🔴' : '🟡';
  var subject    = emoji + ' [BLC Nexus] ' + (errorCount > 0 ? 'System Errors' : 'System Warnings') +
                   ' — ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

  var rows = issues.map(function(i) {
    var colour  = i.severity === 'ERROR' ? '#c0392b' : '#e67e22';
    var bgCol   = i.severity === 'ERROR' ? '#fdf0ef' : '#fef9ef';
    var badge   = '<span style="display:inline-block;background:' + colour + ';color:#fff;' +
                  'border-radius:3px;padding:1px 6px;font-size:11px;font-weight:bold;margin-right:8px;">' +
                  i.severity + '</span>';
    return '<tr style="background:' + bgCol + ';border-bottom:1px solid #eee;">' +
           '<td style="padding:10px 14px;font-size:13px;color:#333;">' +
             badge + i.message +
           '</td></tr>';
  }).join('');

  var html =
    '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#222;">' +
    '<div style="background:#1a3c6e;padding:20px 28px;border-radius:6px 6px 0 0;">' +
    '  <h2 style="margin:0;color:#fff;font-size:18px;">BLC Nexus — System Health Alert</h2>' +
    '  <p style="margin:4px 0 0;color:#a8c4e8;font-size:12px;">' +
         Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEEE, dd MMM yyyy HH:mm z') +
    '  </p>' +
    '</div>' +
    '<div style="border:1px solid #ddd;border-top:none;padding:24px 28px;border-bottom:none;">' +
    '  <p style="font-size:14px;margin:0 0 16px;">' +
         'The health monitor detected <strong>' + issues.length + ' issue(s)</strong> ' +
         '(' + errorCount + ' error' + (errorCount !== 1 ? 's' : '') + ', ' +
               warnCount  + ' warning' + (warnCount  !== 1 ? 's' : '') + ').' +
    '  </p>' +
    '  <table style="width:100%;border-collapse:collapse;border-radius:4px;overflow:hidden;">' +
         rows +
    '  </table>' +
    '  <p style="font-size:13px;color:#666;margin:20px 0 0;">' +
         'Check <strong>Apps Script → Executions</strong> for stack traces. ' +
         'Errors in <strong>_SYS_LOGS</strong> sheet for detail.' +
    '  </p>' +
    '  <p style="font-size:12px;color:#aaa;margin:8px 0 0;">Next alert suppressed for 2 hours.</p>' +
    '</div>' +
    '<div style="border:1px solid #ddd;border-top:none;padding:12px 28px;border-radius:0 0 6px 6px;background:#f8f9fc;">' +
    '  <p style="font-size:12px;color:#888;margin:0;">— BLC Nexus ExecutionHealthMonitor</p>' +
    '</div>' +
    '</div>';

  MailApp.sendEmail({ to: recipient, subject: subject, htmlBody: html });
}

// ─────────────────────────────────────────────────────────────
// Trigger management
// ─────────────────────────────────────────────────────────────

/**
 * Installs a 15-minute health monitor trigger. Idempotent.
 */
function runInstallHealthMonitorTrigger() {
  var FN = 'runHealthMonitorJob';
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === FN) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger(FN).timeBased().everyMinutes(15).create();
  console.log('✅ Health monitor installed: ' + FN + ' every 15 minutes.');
}

/**
 * Removes the health monitor trigger.
 */
function runRemoveHealthMonitorTrigger() {
  var FN      = 'runHealthMonitorJob';
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === FN) { ScriptApp.deleteTrigger(t); removed++; }
  });
  console.log(removed ? '✅ Removed health monitor trigger.' : '⚠️ No trigger found — already removed.');
}

// ─────────────────────────────────────────────────────────────
// PROD contamination check (R10) — daily, separate cadence from
// the 15-minute operational health check above. Scans for
// test-fixture identities/client codes that should never
// legitimately exist in PROD once every test runner is
// Config.isDev()-gated (see TestHarness.gs, TestRunner.gs,
// RBAC.gs getDevTestActors_()). Read-only — no writes.
// ─────────────────────────────────────────────────────────────

var HM_TEST_PERSON_CODES_ = { DS1: true, QC1: true, RND: true, NTL: true, TLM: true, WLD: true };
var HM_TEST_EMAIL_DOMAIN_ = '@test.blc.internal';
// Real-domain addresses hardcoded into test fixtures pre-2026-07-08 (see
// .claude/rules/testing-policy.md background) — not @test.blc.internal,
// so they need an explicit exact-match check in isTestFixtureEmail_.
var HM_TEST_FIXED_EMAILS_ = { 'designer@blclotus.com': true };
var HM_TEST_CLIENT_CODES_ = { 'TEST-CLIENT': true };
// NORSPAN removed 2026-07-09 (CTO correction): the 88 NORSPAN jobs were a
// client_code mismatch/typo, already voided — a real client code variant,
// not a test fixture. Do not re-add without CTO confirmation.

// Known-residue baselines — 2026-07-10 PROD baseline audit
// (IntegrityMonitorBaselineAudit.gs Investigation 2). Both tables are
// append-only/never-deleted in practice, so historical test-fixture rows
// from the 2026-07-08 incident (testing-policy.md background) can never
// reach zero — only new contamination above these counts is actionable.
// Investigation 2 confirmed all 42 countable (SUBMITTED/MIGRATED)
// FACT_WORK_LOGS test-actor rows are voided (net-zero hours); the 134
// total below also includes the VOIDED events themselves and other
// event types. If the current count drops below its baseline (e.g. a
// manual purge), update the constant down — don't leave it stale high,
// or genuine new contamination under the old ceiling would go silent.
// Baseline updated 2026-07-13 from 134 to 161 — delta is remediation events from cleanup sprint, not new test activity.
var HM_KNOWN_TEST_RESIDUE_FACT_WORK_LOGS_ = 161; // 42 voided SUBMITTED + 22 system events + 70 void/amendment events (2026-07-10) + 27 remediation events (voids/period fixes/orphan fixes, 2026-07-13). All DS1. Append-only table, cannot be cleaned.
var HM_KNOWN_TEST_RESIDUE_STG_QUEUE_      = 333;

/** True if email belongs to the synthetic test-identity domain or a known hardcoded test fixture. */
function isTestFixtureEmail_(email) {
  var e = String(email || '').toLowerCase().trim();
  return e.indexOf(HM_TEST_EMAIL_DOMAIN_) !== -1 || !!HM_TEST_FIXED_EMAILS_[e];
}

/**
 * DIM_STAFF_ROSTER should never contain an ACTIVE test person_code or
 * @test.blc.internal email once seedTestStaff()/StaffOnboarding paths
 * are Config.isDev()-gated. Any hit means a test run wrote into the
 * real roster. 2026-07-10 baseline audit: the 6 PROD test-fixture rows
 * are already deactivated (active=false, via TestStaffDeactivator.gs)
 * — that's the remediated end state for this incident, not a new one,
 * so deactivated rows are excluded here. An active test-identity row
 * still means live contamination and still fires.
 */
function checkRosterContamination_() {
  var issues = [];
  var rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'ExecutionHealthMonitor' });
  var hits = (rows || []).filter(function(r) {
    var isTestIdentity = HM_TEST_PERSON_CODES_[String(r.person_code || '').toUpperCase()] ||
                          isTestFixtureEmail_(r.email);
    if (!isTestIdentity) return false;
    var isDeactivated = r.active === false || String(r.active || '').toUpperCase().trim() === 'FALSE';
    return !isDeactivated; // only flag rows where active is NOT false
  });
  if (hits.length > 0) {
    issues.push({
      severity: 'ERROR',
      category: 'PROD_CONTAMINATION_ROSTER',
      message:  hits.length + ' DIM_STAFF_ROSTER row(s) match test identities (person_code DS1/QC1/RND/NTL ' +
                'or @test.blc.internal email): ' +
                hits.slice(0, 10).map(function(r) { return (r.person_code || '?') + '/' + (r.email || '?'); }).join(', ') +
                (hits.length > 10 ? ' (+' + (hits.length - 10) + ' more)' : '')
    });
  }
  return issues;
}

/**
 * VW_JOB_CURRENT_STATE should never contain a non-VOIDED row with
 * client_code = 'TEST-CLIENT' (the current test fixture value). NORSPAN
 * is intentionally excluded — see HM_TEST_CLIENT_CODES_ note above.
 *
 * 2026-07-10 baseline audit (4th sub-fix, added after DEV verification
 * surfaced this as the one Check 5 sub-check the first 3 refinements
 * missed): VOIDED TEST-CLIENT rows are permanent append-only-adjacent
 * residue — thCleanupTestArtifacts_() (TestHarness.gs) and every
 * DataIntegrityMonitorTest.gs cleanup void these rows but never delete
 * them, so the count only grows over time regardless of how "clean"
 * things are. Unlike FACT_WORK_LOGS/STG_PROCESSING_QUEUE (Refinement 1,
 * no state field to exclude on, hence a numeric baseline there), this
 * table has current_state — VOIDED is a real exclusion, not a guessed
 * ceiling, and matches the same VOIDED-exclusion pattern already used
 * by checkClientCodeConsistency_()/checkAllocatedToValidity_()/
 * checkRateConfigurationCompleteness_()/checkVwStateIntegrity_() for
 * terminal-state jobs. Only a non-VOIDED TEST-CLIENT row is live
 * contamination.
 */
function checkVwContamination_() {
  var issues = [];
  var rows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: 'ExecutionHealthMonitor' });
  var hits = (rows || []).filter(function(r) {
    if (!HM_TEST_CLIENT_CODES_[String(r.client_code || '').trim()]) return false;
    return String(r.current_state || '').toUpperCase().trim() !== 'VOIDED';
  });
  if (hits.length > 0) {
    issues.push({
      severity: 'ERROR',
      category: 'PROD_CONTAMINATION_VW',
      message:  hits.length + ' VW_JOB_CURRENT_STATE row(s) with client_code TEST-CLIENT (non-VOIDED): ' +
                hits.slice(0, 10).map(function(r) { return r.job_number; }).join(', ') +
                (hits.length > 10 ? ' (+' + (hits.length - 10) + ' more)' : '')
    });
  }
  return issues;
}

/**
 * Discovers FACT_WORK_LOGS|YYYY-MM partition tab names. Same pattern
 * as WorkLogOrphanAudit.gs's discoverWorkLogPartitions_() — kept as
 * a separate copy (not shared) to avoid a cross-module dependency
 * from this always-on monitor onto a one-off migration audit file.
 */
function discoverHmWorkLogPartitions_() {
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

/**
 * FACT_WORK_LOGS should never contain MORE THAN the known-residue
 * baseline (HM_KNOWN_TEST_RESIDUE_FACT_WORK_LOGS_) of test actor_code
 * rows. Scans only the most recent 2 partitions (this month + last
 * month) — a daily check does not need to re-scan the full historical
 * archive, and new contamination surfaces in the current period first.
 * 2026-07-10 baseline audit (Investigation 2) confirmed the existing
 * count is 100% voided/remediated residue in an append-only table that
 * can never be cleaned to zero — only growth ABOVE that baseline is
 * actionable new contamination.
 */
function checkWorkLogContamination_() {
  var issues  = [];
  var periods = discoverHmWorkLogPartitions_().slice(-2);
  var hits    = [];

  periods.forEach(function(periodId) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: 'ExecutionHealthMonitor', periodId: periodId });
    } catch (e) {
      return; // SHEET_NOT_FOUND or similar — skip this partition
    }
    (rows || []).forEach(function(r) {
      if (HM_TEST_PERSON_CODES_[String(r.actor_code || '').toUpperCase()]) hits.push(r);
    });
  });

  if (hits.length <= HM_KNOWN_TEST_RESIDUE_FACT_WORK_LOGS_) {
    console.log('[ExecutionHealthMonitor] FACT_WORK_LOGS test-actor rows: ' + hits.length +
                ' — within known baseline of ' + HM_KNOWN_TEST_RESIDUE_FACT_WORK_LOGS_ + ', no alert.');
    return issues;
  }

  issues.push({
    severity: 'ERROR',
    category: 'PROD_CONTAMINATION_WORKLOG',
    message:  hits.length + ' FACT_WORK_LOGS row(s) in partition(s) [' + periods.join(', ') +
              '] with a test actor_code (DS1/QC1/RND/NTL) — exceeds known baseline of ' +
              HM_KNOWN_TEST_RESIDUE_FACT_WORK_LOGS_ + '. Possible NEW contamination.'
  });
  return issues;
}

/**
 * STG_PROCESSING_QUEUE should never contain MORE THAN the known-residue
 * baseline (HM_KNOWN_TEST_RESIDUE_STG_QUEUE_) of @test.blc.internal
 * submitter_email rows — that domain only resolves via RBAC's
 * Config.isDev()-gated getDevTestActors_(), so its presence in the live
 * queue means a test submission reached PROD's intake path. 2026-07-10
 * baseline audit set this to the confirmed existing count; only growth
 * above it is actionable new contamination.
 */
function checkQueueContamination_() {
  var issues = [];
  var rows = DAL.readAll(Config.TABLES.STG_PROCESSING_QUEUE, { callerModule: 'ExecutionHealthMonitor' });
  var hits = (rows || []).filter(function(r) { return isTestFixtureEmail_(r.submitter_email); });

  if (hits.length <= HM_KNOWN_TEST_RESIDUE_STG_QUEUE_) {
    console.log('[ExecutionHealthMonitor] STG_PROCESSING_QUEUE test-fixture rows: ' + hits.length +
                ' — within known baseline of ' + HM_KNOWN_TEST_RESIDUE_STG_QUEUE_ + ', no alert.');
    return issues;
  }

  issues.push({
    severity: 'ERROR',
    category: 'PROD_CONTAMINATION_QUEUE',
    message:  hits.length + ' STG_PROCESSING_QUEUE row(s) with a @test.blc.internal submitter_email — ' +
              'exceeds known baseline of ' + HM_KNOWN_TEST_RESIDUE_STG_QUEUE_ + '. Possible NEW contamination.'
  });
  return issues;
}

/**
 * R10 — daily PROD contamination check. Read-only. Any hit is a
 * stop-work condition (R10 point 8), so this always alerts on a
 * hit — no cooldown suppression like the routine 15-minute monitor.
 * @returns {{ contaminated: boolean, issues: Array }}
 */
function runProdContaminationCheck() {
  var issues = [];
  try { issues = issues.concat(checkRosterContamination_());  } catch(e) { console.log('[ProdContaminationCheck] roster check failed: ' + e.message); }
  try { issues = issues.concat(checkVwContamination_());      } catch(e) { console.log('[ProdContaminationCheck] VW check failed: ' + e.message); }
  try { issues = issues.concat(checkWorkLogContamination_()); } catch(e) { console.log('[ProdContaminationCheck] work log check failed: ' + e.message); }
  try { issues = issues.concat(checkQueueContamination_());   } catch(e) { console.log('[ProdContaminationCheck] queue check failed: ' + e.message); }

  if (issues.length === 0) {
    console.log('[ProdContaminationCheck] ✅ Clean — no test artifacts found in PROD.');
    return { contaminated: false, issues: [] };
  }

  console.log('[ProdContaminationCheck] 🔴 CONTAMINATION FOUND — ' + issues.length + ' issue(s):');
  issues.forEach(function(i) { console.log('  • [' + i.severity + '] ' + i.message); });

  var recipient = PropertiesService.getScriptProperties()
                    .getProperty(HM_ALERT_RECIPIENT_PROP_) || 'raj.nair@bluelotuscanada.ca';
  sendHealthAlert_(recipient, issues);

  return { contaminated: true, issues: issues };
}

// runInstallProdContaminationTrigger() / runRemoveProdContaminationTrigger()
// removed 2026-07-10 (commit 5) — superseded by the 05:00 daily data
// integrity run (runDataIntegrityMonitorJob(), DataIntegrityMonitor.gs),
// which now covers this same scan via Check 5. runProdContaminationCheck()
// itself is untouched above and still callable manually. See this
// file's header comment for the PROD manual-trigger-removal note.
