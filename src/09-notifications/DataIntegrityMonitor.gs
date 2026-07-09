// ============================================================
// DataIntegrityMonitor.gs — BLC Nexus T9 Notifications
// src/09-notifications/DataIntegrityMonitor.gs
//
// Automated data integrity monitoring with severity levels.
// Read-only — no FACT or VW writes, no queue writes.
//
// COMMIT 1 OF 7 — Checks 1–5 + severity framework only.
//   Checks 6–10, self-healing actions, the pre-billing gate, trigger
//   wiring, and full alert-email formatting land in later commits.
//   Until then, runDataIntegrityChecks() is a manual/console runner —
//   it does not install a trigger and does not send email.
//
// File location note: the original build spec named this file for
// src/03-infrastructure/. It lives in src/09-notifications/ instead,
// next to ExecutionHealthMonitor.gs — RULE X (.claude/rules/core_rules.md)
// forbids business logic in 03-infrastructure (logging/health/errors
// only), and this monitor's checks (client/roster/VW/queue reads) are
// exactly the kind of business-rule logic ExecutionHealthMonitor.gs
// already contains at T9.
//
// Reuse (RULE — one implementation, two callers, where behavior
// actually matches):
//   Check 2 calls computeWorkLogOrphans_() from WorkLogOrphanAudit.gs
//     unmodified, then filters to the current month.
//   Check 5 calls checkRosterContamination_() / checkVwContamination_() /
//     checkWorkLogContamination_() / checkQueueContamination_() from
//     ExecutionHealthMonitor.gs. Those functions' underlying fixture
//     lists (HM_TEST_CLIENT_CODES_, HM_TEST_PERSON_CODES_) were edited
//     2026-07-09 to drop NORSPAN and add TLM/WLD/designer@blclotus.com —
//     this file calls them, it does not duplicate their logic.
//   Check 1 reuses normWd_() (date normalization) from
//     WorkLogDedupAudit.gs, but does NOT reuse that file's grouping
//     function — the spec's detection is strictly narrower (event_type
//     filter, hours in the key, net against WORK_LOG_VOIDED) than the
//     manual audit's intentionally-broad key, so lifting it as-is would
//     either under-implement the spec or change the manual audit's
//     live behavior. WorkLogDedupAudit.gs is untouched in this commit.
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
 * Runs Checks 1–5, logs a summary to console grouped by severity, and
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
    console.log('[DataIntegrityMonitor] ✅ All clear — no issues detected across checks 1–5.');
  }

  return { issues: issues, bySeverity: bySeverity, counts: counts };
}

/** Builds the current month's period_id, e.g. '2026-07'. */
function dimCurrentMonthPartition_() {
  var n = new Date();
  var m = (n.getMonth() + 1 < 10 ? '0' : '') + (n.getMonth() + 1);
  return n.getFullYear() + '-' + m;
}

// ─────────────────────────────────────────────────────────────
// Check 1 — Duplicate work logs (HIGH)
//
// Current month's FACT_WORK_LOGS partition: rows with the same
// actor_code + job_number + work_date + hours where event_type is
// WORK_LOG_SUBMITTED or WORK_LOG_MIGRATED, minus any that already
// have a matching WORK_LOG_VOIDED (same actor/job/date, hours negated).
// A group only alerts if its *net* count after voiding is still > 1 —
// this avoids re-alerting on duplicates already fixed via
// WorkLogCorrectionHandler/WorkLogDedupFixer.
// ─────────────────────────────────────────────────────────────

function checkDuplicateWorkLogs_() {
  var MODULE     = 'DataIntegrityMonitor';
  var periodId   = dimCurrentMonthPartition_();
  var COUNTABLE  = {};
  COUNTABLE[Constants.EVENT_TYPES.WORK_LOG_SUBMITTED] = true;
  COUNTABLE[Constants.EVENT_TYPES.WORK_LOG_MIGRATED]  = true;

  var rows;
  try {
    rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: MODULE, periodId: periodId });
  } catch (e) {
    return []; // partition doesn't exist yet (e.g. first day of a new month) — nothing to check
  }

  // submitted[key] = [row, ...] ; voidedHours[actor\x00job\x00date] = count of voids seen
  var submitted    = {};
  var voidedCounts = {};
  var year         = parseInt(periodId.split('-')[0], 10);

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var ac  = String(row.actor_code || '').trim().toUpperCase();
    var jn   = String(row.job_number || '').trim();
    var wd   = normWd_(row.work_date, year);
    var hrs  = parseFloat(row.hours);
    if (!ac || !jn || !wd || isNaN(hrs)) continue;

    var eventType = String(row.event_type || '');

    if (eventType === Constants.EVENT_TYPES.WORK_LOG_VOIDED) {
      // Voids are stored as negative hours of the entry they cancel.
      var voidKey = ac + '\x00' + jn + '\x00' + wd + '\x00' + Math.abs(hrs);
      voidedCounts[voidKey] = (voidedCounts[voidKey] || 0) + 1;
      continue;
    }

    if (!COUNTABLE[eventType]) continue;

    var key = ac + '\x00' + jn + '\x00' + wd + '\x00' + hrs;
    (submitted[key] || (submitted[key] = [])).push(row);
  }

  var dupeGroups   = [];
  var totalExcess  = 0;
  var actorsHit    = {};

  Object.keys(submitted).forEach(function(key) {
    var group    = submitted[key];
    var voided   = voidedCounts[key] || 0;
    var netCount = group.length - voided;
    if (netCount <= 1) return; // already resolved (or never duplicated)

    var parts = key.split('\x00');
    dupeGroups.push({
      actor_code: parts[0], job_number: parts[1], work_date: parts[2], hours: parseFloat(parts[3]),
      raw_count: group.length, voided_count: voided, net_count: netCount
    });
    totalExcess += (netCount - 1);
    actorsHit[parts[0]] = true;
  });

  if (dupeGroups.length === 0) return [];

  dupeGroups.sort(function(a, b) { return b.net_count - a.net_count; });

  return [{
    check:    'CHECK_1_DUPLICATE_WORK_LOGS',
    severity: DIM_SEVERITY_.HIGH,
    category: 'DUPLICATE_WORK_LOGS',
    message:  dupeGroups.length + ' duplicate work log group(s) detected in partition ' + periodId +
              '. Total excess hours: ' + totalExcess + '. Actors: ' + Object.keys(actorsHit).sort().join(', '),
    data: {
      period_id:      periodId,
      dupe_groups:    dupeGroups.length,
      excess_hours:   totalExcess,
      actors:         Object.keys(actorsHit).sort(),
      samples:        dupeGroups.slice(0, 10)
    },
    recommendedAction: 'Run WorkLogDedupAudit for ' + periodId + ' to confirm, then void the excess ' +
                        'entries via WorkLogCorrectionHandler (net-zero, per ADR-WL-001 convention).'
  }];
}

// ─────────────────────────────────────────────────────────────
// Check 2 — Orphaned work logs (HIGH)
//
// Reuses computeWorkLogOrphans_() from WorkLogOrphanAudit.gs
// unmodified (that function itself discovers and reads every
// FACT_WORK_LOGS partition — this is unavoidable for a correct orphan
// computation, since a job_number's VW row can be missing regardless
// of which partition logged hours against it). Filtered here to
// current-month orphans only, and admin overhead excluded, per spec.
// ─────────────────────────────────────────────────────────────

function checkOrphanedWorkLogs_() {
  var periodId = dimCurrentMonthPartition_();
  var result   = computeWorkLogOrphans_('DataIntegrityMonitor');

  var currentMonthOrphans = result.orphans.filter(function(o) {
    return o.most_recent_partition === periodId && !isAdminOverheadJobNumber_(o.job_number);
  });

  if (currentMonthOrphans.length === 0) return [];

  currentMonthOrphans.sort(function(a, b) { return b.total_hours - a.total_hours; });
  var totalHours = sumOrphanHours_(currentMonthOrphans);
  var largest     = currentMonthOrphans[0];

  return [{
    check:    'CHECK_2_ORPHANED_WORK_LOGS',
    severity: DIM_SEVERITY_.HIGH,
    category: 'ORPHANED_WORK_LOGS',
    message:  currentMonthOrphans.length + ' orphaned job_number(s) with ' + totalHours +
              ' total hours in ' + periodId + '. Largest: ' + largest.job_number + ' (' + largest.total_hours + 'h).',
    data: {
      period_id:    periodId,
      orphan_count: currentMonthOrphans.length,
      total_hours:  totalHours,
      samples:      currentMonthOrphans.slice(0, 10)
    },
    recommendedAction: 'Run runWorkLogOrphanAuditRecent() for full detail. Check job_number normalization ' +
                        '(Check 7, commit 2) before assuming a genuine orphan needing a manual VW decision (ADR-WL-001).'
  }];
}

// ─────────────────────────────────────────────────────────────
// Check 3 — Client code consistency (CRITICAL)
//
// Every distinct client_code in VW_JOB_CURRENT_STATE (excluding
// VOIDED jobs) must resolve to a DIM_CLIENT_MASTER row. Catches the
// NORSPAN-class problem (bare client_code with no dimension row, or a
// near-miss of a real code) at detection time instead of at billing.
// ─────────────────────────────────────────────────────────────

function checkClientCodeConsistency_() {
  var MODULE = 'DataIntegrityMonitor';

  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  var clientRows = DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: MODULE });

  var knownClients = {};
  clientRows.forEach(function(c) {
    var code = String(c.client_code || '').trim();
    if (code) knownClients[code] = true;
  });

  // byMissingCode[client_code] = { count, sample job_numbers }
  var byMissingCode = {};
  vwRows.forEach(function(r) {
    if (String(r.current_state || '').toUpperCase() === 'VOIDED') return;
    var code = String(r.client_code || '').trim();
    if (!code || knownClients[code]) return;

    if (!byMissingCode[code]) byMissingCode[code] = { count: 0, jobs: [] };
    byMissingCode[code].count++;
    if (byMissingCode[code].jobs.length < 10) byMissingCode[code].jobs.push(r.job_number);
  });

  var missingCodes = Object.keys(byMissingCode);
  if (missingCodes.length === 0) return [];

  var issues = missingCodes.sort().map(function(code) {
    var d = byMissingCode[code];
    return {
      check:    'CHECK_3_CLIENT_CODE_CONSISTENCY',
      severity: DIM_SEVERITY_.CRITICAL,
      category: 'CLIENT_CODE_ORPHAN',
      message:  'Client code "' + code + '" on ' + d.count + ' job(s) has no DIM_CLIENT_MASTER entry.',
      data: {
        client_code: code,
        job_count:   d.count,
        samples:     d.jobs
      },
      recommendedAction: 'Confirm whether "' + code + '" is a typo/alias of an existing client_code ' +
                          '(as with MATIX vs. MATIX-SK) or needs its own DIM_CLIENT_MASTER row. ' +
                          'Jobs on an unresolved client_code will bill to a phantom client.'
    };
  });

  return issues;
}

// ─────────────────────────────────────────────────────────────
// Check 4 — Dead letter queue growth (HIGH)
//
// DEAD_LETTER_QUEUE items in the last 24 hours. Threshold: > 3 items
// triggers the issue. Grouped by form_type + most common error_message
// so the alert is actionable rather than just a count (distinct from
// ExecutionHealthMonitor's 15-min checkDeadLetter_(), which is an
// unconditional any-recent-item routine ops check — left unmodified).
// ─────────────────────────────────────────────────────────────

function checkDeadLetterGrowth_() {
  var MODULE = 'DataIntegrityMonitor';
  var THRESHOLD = 3;

  var rows   = DAL.readAll(Config.TABLES.DEAD_LETTER_QUEUE, { callerModule: MODULE });
  var cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  var recent = rows.filter(function(r) {
    return String(r.dead_lettered_at || '') >= cutoff;
  });

  if (recent.length <= THRESHOLD) return [];

  // byFormType[form_type] = { count, errors: { message: count } }
  var byFormType = {};
  recent.forEach(function(r) {
    var ft = String(r.form_type || 'UNKNOWN');
    if (!byFormType[ft]) byFormType[ft] = { count: 0, errors: {} };
    byFormType[ft].count++;
    var err = String(r.error_message || '').substring(0, 120);
    byFormType[ft].errors[err] = (byFormType[ft].errors[err] || 0) + 1;
  });

  var breakdown = Object.keys(byFormType).sort(function(a, b) {
    return byFormType[b].count - byFormType[a].count;
  }).map(function(ft) {
    var errs = byFormType[ft].errors;
    var topError = Object.keys(errs).sort(function(a, b) { return errs[b] - errs[a]; })[0] || '';
    return ft + ': ' + byFormType[ft].count + ' (top error: "' + topError + '")';
  });

  return [{
    check:    'CHECK_4_DEAD_LETTER_GROWTH',
    severity: DIM_SEVERITY_.HIGH,
    category: 'DEAD_LETTER_GROWTH',
    message:  recent.length + ' item(s) dead-lettered in the last 24 hours (threshold ' + THRESHOLD +
              '). Breakdown: ' + breakdown.join('; '),
    data: {
      total_24h:  recent.length,
      threshold:  THRESHOLD,
      by_form_type: byFormType
    },
    recommendedAction: 'Review the Dead Letter Queue sheet. Commit 3\'s self-healing auto-retry will ' +
                        'classify these as permanent vs. transient once shipped.'
  }];
}

// ─────────────────────────────────────────────────────────────
// Check 5 — Test contamination (CRITICAL)
//
// Reuses checkRosterContamination_() / checkVwContamination_() /
// checkWorkLogContamination_() / checkQueueContamination_() from
// ExecutionHealthMonitor.gs unmodified (same global GAS namespace —
// no import needed). Those return { severity: 'ERROR', category, message }
// (R10 test-fixture scan); mapped to this monitor's CRITICAL here,
// since any hit is an R10.8 stop-work condition. The separate daily
// runProdContaminationCheck() trigger stays as-is in this commit —
// unifying it into this monitor (removing the standalone trigger) is
// commit 7 per the build plan.
//
// 2026-07-09 update: NORSPAN removed from HM_TEST_CLIENT_CODES_ in
// ExecutionHealthMonitor.gs (CTO correction — the 88 NORSPAN jobs were
// a client_code mismatch, already voided, not a test fixture; see that
// file's HM_TEST_CLIENT_CODES_ comment). Check 5 no longer fires on
// NORSPAN. Check 3 may still fire on it if 'NORSPAN' itself lacks a
// DIM_CLIENT_MASTER row — that is a legitimate Check 3 finding, not a
// contamination false-positive, and is unaffected by this note.
// ─────────────────────────────────────────────────────────────

function checkTestContamination_() {
  var raw = [];
  try { raw = raw.concat(checkRosterContamination_()); }  catch (e) { console.log('[DataIntegrityMonitor] Check 5 roster sub-check failed: ' + e.message); }
  try { raw = raw.concat(checkVwContamination_()); }      catch (e) { console.log('[DataIntegrityMonitor] Check 5 VW sub-check failed: ' + e.message); }
  try { raw = raw.concat(checkWorkLogContamination_()); } catch (e) { console.log('[DataIntegrityMonitor] Check 5 work log sub-check failed: ' + e.message); }
  try { raw = raw.concat(checkQueueContamination_()); }   catch (e) { console.log('[DataIntegrityMonitor] Check 5 queue sub-check failed: ' + e.message); }

  return raw.map(function(i) {
    return {
      check:    'CHECK_5_TEST_CONTAMINATION',
      severity: DIM_SEVERITY_.CRITICAL,
      category: i.category || 'PROD_CONTAMINATION',
      message:  'PROD contamination detected: ' + i.message + ' — R10.8 STOP-WORK condition.',
      data:     { source_category: i.category },
      recommendedAction: 'Stop-work per R10.8. Identify and close the entry point that let test data ' +
                          'reach PROD before any other development continues.'
    };
  });
}
