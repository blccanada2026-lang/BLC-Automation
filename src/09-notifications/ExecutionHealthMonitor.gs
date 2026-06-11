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
// ============================================================

var HM_ALERT_RECIPIENT_PROP_ = 'CEO_BRIEFING_RECIPIENT';
var HM_LAST_ALERT_PROP_      = 'HM_LAST_ALERT_MS';
var HM_ALERT_COOLDOWN_MS_    = 2 * 60 * 60 * 1000;   // 2 hours between alerts
var HM_LOOK_BACK_MS_         = 30 * 60 * 1000;        // scan last 30 minutes of logs
var HM_STUCK_THRESHOLD_MS_   = 2 * 60 * 60 * 1000;   // queue items stuck > 2 hours

/**
 * Clock trigger entry point — runs every 15 minutes.
 * Do not rename: trigger is keyed to this exact function name.
 */
function runHealthMonitorJob() {
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
  var errors  = rows.filter(function(r) {
    return String(r.level || '').toUpperCase() === 'ERROR' &&
           String(r.timestamp || '') >= cutoff;
  });

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
