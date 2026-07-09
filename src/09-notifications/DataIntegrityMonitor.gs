// ============================================================
// DataIntegrityMonitor.gs — BLC Nexus T9 Notifications
// src/09-notifications/DataIntegrityMonitor.gs
//
// Automated data integrity monitoring with severity levels.
// Read-only — no FACT or VW writes, no queue writes.
//
// COMMITS 1–2 OF 7 — Checks 1–10 + severity framework.
//   Self-healing actions, the pre-billing gate, trigger wiring, and
//   full alert-email formatting land in later commits. Until then,
//   runDataIntegrityChecks() is a manual/console runner — it does not
//   install a trigger and does not send email.
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
//   Check 7 calls normalizeJobNumber_() / isAdminOverheadJobNumber_()
//     from WorkLogOrphanAudit.gs unmodified.
//   Check 6's malformed-period_id predicate mirrors (does not call —
//     the original is a private closure var inside the WorkLogPeriodFixer
//     IIFE, not exposed) WorkLogPeriodFixer.gs's isMalformed_(): a Date
//     object or anything not matching /^\d{4}-\d{2}$/. Rows already
//     covered by a WORK_LOG_PERIOD_FIXED amendment are excluded, same
//     as that fixer's alreadyFixed set, so this doesn't re-alert on the
//     9,873 rows already fixed 2026-07-06.
//   Checks 8, 9, 10 have no prior audit script to reuse — new logic.
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

// ─────────────────────────────────────────────────────────────
// Check 6 — Period_id format integrity (MEDIUM)
//
// Current + previous month FACT_WORK_LOGS partitions: every row's
// period_id must be a bare 'YYYY-MM' string, not a Date object or
// blank. We fixed 9,873 malformed rows on 2026-07-06
// (WorkLogPeriodFixer.gs) — this catches recurrence going forward.
// Rows that already have a matching WORK_LOG_PERIOD_FIXED amendment
// (amendment_of === event_id) are excluded, same as that fixer's own
// idempotency set — the original malformed row is never edited
// (FACT tables are append-only, RULE A5), only amended, so without
// this exclusion every already-fixed row would re-alert forever.
// ─────────────────────────────────────────────────────────────

/** Mirrors WorkLogPeriodFixer.gs's private isMalformed_(). */
function dimIsMalformedPeriodId_(val) {
  if (val instanceof Date) return true;
  return !/^\d{4}-\d{2}$/.test(String(val || '').trim());
}

/** 'YYYY-MM' → 'YYYY-MM' of the previous month, via string arithmetic
 *  (no Date round-trip — new Date('YYYY-MM-01') parses as UTC midnight
 *  while getMonth()/getFullYear() read local time, which shifts the
 *  result by a month under a script timezone behind UTC). */
function dimPreviousMonthPartition_(periodId) {
  var y = parseInt(periodId.substring(0, 4), 10);
  var m = parseInt(periodId.substring(5, 7), 10); // 1-12
  m -= 1;
  if (m < 1) { m = 12; y -= 1; }
  return y + '-' + (m < 10 ? '0' : '') + m;
}

function checkPeriodIdFormat_() {
  var MODULE  = 'DataIntegrityMonitor';
  var current = dimCurrentMonthPartition_();
  var prev    = dimPreviousMonthPartition_(current);
  var partitions = [prev, current];

  var malformedByPartition = {};
  var totalMalformed = 0;

  partitions.forEach(function(periodId) {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: MODULE, periodId: periodId });
    } catch (e) {
      return; // partition doesn't exist — nothing to check
    }

    // amendment_of is NOT in the FACT_WORK_LOGS header (PROJECT_MEMORY §11,
    // WorkLogCorrectionHandler.gs:56-57) — DAL silently drops it on write,
    // so it can't be used to find already-fixed rows. idempotency_key IS
    // in the header and WorkLogPeriodFixer.gs writes it as
    // 'WL_PERIOD_FIX_' + originalEventId — strip the prefix to recover it.
    var FIX_PREFIX = 'WL_PERIOD_FIX_';
    var alreadyFixed = {};
    rows.forEach(function(r) {
      if (String(r.event_type || '') !== Constants.EVENT_TYPES.WORK_LOG_PERIOD_FIXED) return;
      var key = String(r.idempotency_key || '');
      if (key.indexOf(FIX_PREFIX) === 0) alreadyFixed[key.substring(FIX_PREFIX.length)] = true;
    });

    var hits = rows.filter(function(r) {
      if (!dimIsMalformedPeriodId_(r.period_id)) return false;
      var eventId = String(r.event_id || '');
      return !alreadyFixed[eventId];
    });

    if (hits.length > 0) {
      malformedByPartition[periodId] = hits.length;
      totalMalformed += hits.length;
    }
  });

  if (totalMalformed === 0) return [];

  return [{
    check:    'CHECK_6_PERIOD_ID_FORMAT',
    severity: DIM_SEVERITY_.MEDIUM,
    category: 'PERIOD_ID_MALFORMED',
    message:  totalMalformed + ' row(s) with malformed period_id across partition(s): ' +
              Object.keys(malformedByPartition).map(function(p) { return p + ' (' + malformedByPartition[p] + ')'; }).join(', '),
    data: { partitions: malformedByPartition, total: totalMalformed },
    recommendedAction: 'Run WorkLogPeriodFixer.run(true) (dry run) to confirm, then runWorkLogPeriodFixer_LIVE() ' +
                        'to write WORK_LOG_PERIOD_FIXED amendment events.'
  }];
}

// ─────────────────────────────────────────────────────────────
// Check 7 — Job number normalization (MEDIUM)
//
// Current month's FACT_WORK_LOGS: any job_number carrying a
// space/underscore-appended description (e.g. "2605-6039-A Mary's
// Landing Lot 9-16 OWF") creates a VW orphan (Check 2) because VW
// never had the description suffix. Admin overhead ("job assign &
// help") is excluded — it isn't a real job_number.
// ─────────────────────────────────────────────────────────────

function checkJobNumberNormalization_() {
  var MODULE   = 'DataIntegrityMonitor';
  var periodId = dimCurrentMonthPartition_();

  var rows;
  try {
    rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: MODULE, periodId: periodId });
  } catch (e) {
    return []; // partition doesn't exist yet
  }

  var seen = {};
  var samples = [];
  rows.forEach(function(r) {
    var jn = String(r.job_number || '').trim();
    if (!jn || isAdminOverheadJobNumber_(jn)) return;
    if (normalizeJobNumber_(jn) === jn) return; // no space/underscore — already normalized
    if (seen[jn]) return;
    seen[jn] = true;
    if (samples.length < 10) samples.push(jn);
  });

  var total = Object.keys(seen).length;
  if (total === 0) return [];

  return [{
    check:    'CHECK_7_JOB_NUMBER_NORMALIZATION',
    severity: DIM_SEVERITY_.MEDIUM,
    category: 'JOB_NUMBER_UNNORMALIZED',
    message:  total + ' distinct unnormalized job_number(s) in ' + periodId + ' work log entries: ' +
              samples.join(', ') + (total > samples.length ? ', ...' : ''),
    data: { period_id: periodId, distinct_count: total, samples: samples },
    recommendedAction: 'Confirm WorkLogHandler\'s job_number normalization guard (ADR-WL-001) is firing on ' +
                        'the portal submission path these entries came through.'
  }];
}

// ─────────────────────────────────────────────────────────────
// Check 8 — allocated_to validation (HIGH)
//
// Every distinct allocated_to in VW_JOB_CURRENT_STATE, restricted to
// the active pipeline (excludes terminal states INVOICED/VOIDED/
// CANCELLED — a departed staff member's name on already-settled
// history isn't an actionable finding, just noise) and blank
// allocated_to, must match a person_code in DIM_STAFF_ROSTER with
// active=TRUE. Catches blanks, email addresses, and inactive/departed
// staff still assigned to active jobs.
// ─────────────────────────────────────────────────────────────

var DIM_TERMINAL_STATES_ = { INVOICED: true, VOIDED: true, CANCELLED: true };

function checkAllocatedToValidity_() {
  var MODULE = 'DataIntegrityMonitor';

  var staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
  var activeStaff = {};
  staffRows.forEach(function(s) {
    var isActive = s.active === true || String(s.active || '').toUpperCase().trim() === 'TRUE';
    if (!isActive) return;
    var code = String(s.person_code || '').trim().toUpperCase();
    if (code) activeStaff[code] = true;
  });

  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });

  var byInvalidCode = {}; // allocated_to (as stored) -> { count, jobs: [] }
  vwRows.forEach(function(r) {
    if (DIM_TERMINAL_STATES_[String(r.current_state || '').toUpperCase()]) return;
    var allocatedTo = String(r.allocated_to || '').trim();
    if (!allocatedTo) return;
    if (activeStaff[allocatedTo.toUpperCase()]) return;

    if (!byInvalidCode[allocatedTo]) byInvalidCode[allocatedTo] = { count: 0, jobs: [] };
    byInvalidCode[allocatedTo].count++;
    if (byInvalidCode[allocatedTo].jobs.length < 10) byInvalidCode[allocatedTo].jobs.push(r.job_number);
  });

  var invalidCodes = Object.keys(byInvalidCode);
  if (invalidCodes.length === 0) return [];

  var totalJobs = invalidCodes.reduce(function(sum, c) { return sum + byInvalidCode[c].count; }, 0);

  return [{
    check:    'CHECK_8_ALLOCATED_TO_VALIDATION',
    severity: DIM_SEVERITY_.HIGH,
    category: 'ALLOCATED_TO_INVALID',
    message:  invalidCodes.length + ' invalid allocated_to value(s) across ' + totalJobs + ' job(s): ' +
              invalidCodes.slice(0, 10).map(function(c) { return c + ' (' + byInvalidCode[c].count + ')'; }).join(', '),
    data: { invalid_count: invalidCodes.length, job_count: totalJobs, samples: byInvalidCode },
    recommendedAction: 'Each value must be a valid, active DIM_STAFF_ROSTER person_code. Reassign jobs with ' +
                        'blank/email/inactive allocated_to to a real active staff member.'
  }];
}

// ─────────────────────────────────────────────────────────────
// Check 9 — Rate configuration completeness (CRITICAL)
//
// (a) Every active DIM_CLIENT_MASTER client_code must have at least
//     one DIM_CLIENT_RATES row.
// (b) Every distinct client_code + product_code combination among VW
//     jobs still in the active pipeline (excludes terminal states
//     INVOICED/VOIDED/CANCELLED — those are already billed or dead,
//     not a forward-looking billing risk) must resolve to a rate —
//     either a client+product-specific row, or a client-only fallback
//     row (product_code blank), matching BillingEngine's documented
//     lookup order exactly (BillingEngine.gs "RATE LOOKUP" comment:
//     client+product first, then client-only fallback, else skip).
// Missing rates mean zero-dollar invoices. Reported as one CRITICAL
// issue listing every missing combo, not one per combo — a client
// with several missing product rates is one root cause, not several,
// and per-combo CRITICALs would flood commit 5's alert email.
// ─────────────────────────────────────────────────────────────

function checkRateConfigurationCompleteness_() {
  var MODULE = 'DataIntegrityMonitor';
  var issues = [];

  var clientRows = DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: MODULE });
  var rateRows   = DAL.readAll(Config.TABLES.DIM_CLIENT_RATES, { callerModule: MODULE });

  function isActiveRow_(r) {
    return r.active === true || String(r.active || '').toUpperCase().trim() === 'TRUE';
  }

  // ── (a) active clients with zero rate rows at all ──────────────
  var ratesByClient = {}; // client_code -> [rate rows]
  rateRows.forEach(function(r) {
    if (!isActiveRow_(r)) return;
    var code = String(r.client_code || '').trim();
    if (!code) return;
    (ratesByClient[code] || (ratesByClient[code] = [])).push(r);
  });

  var clientsWithNoRates = [];
  clientRows.forEach(function(c) {
    if (!isActiveRow_(c)) return;
    var code = String(c.client_code || '').trim();
    if (!code) return;
    if (!ratesByClient[code] || ratesByClient[code].length === 0) clientsWithNoRates.push(code);
  });

  if (clientsWithNoRates.length > 0) {
    issues.push({
      check:    'CHECK_9_RATE_CONFIGURATION',
      severity: DIM_SEVERITY_.CRITICAL,
      category: 'CLIENT_NO_RATES',
      message:  clientsWithNoRates.length + ' active client(s) have no DIM_CLIENT_RATES entry at all: ' +
                clientsWithNoRates.sort().join(', '),
      data: { clients: clientsWithNoRates.sort() },
      recommendedAction: 'Add at least a client-level fallback rate (blank product_code) to DIM_CLIENT_RATES ' +
                          'for each listed client before the next billing run.'
    });
  }

  // ── (b) active client+product combos in VW with no matching rate ──
  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  var byMissingCombo = {}; // "client|product" -> { client_code, product_code, count, jobs }

  vwRows.forEach(function(r) {
    if (DIM_TERMINAL_STATES_[String(r.current_state || '').toUpperCase()]) return;
    var clientCode  = String(r.client_code || '').trim();
    var productCode = String(r.product_code || '').trim();
    if (!clientCode) return;

    var clientRates = ratesByClient[clientCode] || [];
    var hasMatch = clientRates.some(function(rate) {
      var rateProduct = String(rate.product_code || '').trim();
      return rateProduct === '' || rateProduct === productCode;
    });
    if (hasMatch) return;

    var comboKey = clientCode + '|' + productCode;
    if (!byMissingCombo[comboKey]) {
      byMissingCombo[comboKey] = { client_code: clientCode, product_code: productCode, count: 0, jobs: [] };
    }
    byMissingCombo[comboKey].count++;
    if (byMissingCombo[comboKey].jobs.length < 10) byMissingCombo[comboKey].jobs.push(r.job_number);
  });

  var missingCombos = Object.keys(byMissingCombo).sort();
  if (missingCombos.length > 0) {
    var totalAffectedJobs = missingCombos.reduce(function(sum, k) { return sum + byMissingCombo[k].count; }, 0);
    var comboSummaries = missingCombos.map(function(comboKey) {
      var d = byMissingCombo[comboKey];
      return d.client_code + '/' + (d.product_code || '(blank)') + ' (' + d.count + ' job(s))';
    });

    issues.push({
      check:    'CHECK_9_RATE_CONFIGURATION',
      severity: DIM_SEVERITY_.CRITICAL,
      category: 'CLIENT_PRODUCT_NO_RATE',
      message:  missingCombos.length + ' client/product combination(s) in the active pipeline have no rate — ' +
                totalAffectedJobs + ' job(s) affected: ' + comboSummaries.join('; '),
      data: { combo_count: missingCombos.length, job_count: totalAffectedJobs, combos: byMissingCombo },
      recommendedAction: 'Add a DIM_CLIENT_RATES row (client+product, or a client-only fallback with blank ' +
                          'product_code) for each combination listed before those jobs reach billing.'
    });
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────
// Check 10 — VW state integrity (MEDIUM)
//
// Scans VW_JOB_CURRENT_STATE for: blank current_state; current_state
// outside the valid enum (Config.STATES, plus VOIDED/CANCELLED which
// are legitimate terminal/administrative states outside the forward
// TRANSITIONS machine — see Config.gs); and jobs sitting in
// IN_PROGRESS for more than 90 days since updated_at (possibly stuck).
// ─────────────────────────────────────────────────────────────

function checkVwStateIntegrity_() {
  var MODULE = 'DataIntegrityMonitor';
  var issues = [];

  var validStates = {};
  Object.keys(Config.STATES).forEach(function(k) { validStates[Config.STATES[k]] = true; });
  validStates.VOIDED = true;
  validStates.CANCELLED = true;

  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });

  var blankStateJobs   = [];
  var invalidStateJobs = []; // { job_number, current_state }
  var stuckJobs        = []; // { job_number, updated_at, days }
  var ninetyDaysAgo     = Date.now() - 90 * 24 * 60 * 60 * 1000;

  vwRows.forEach(function(r) {
    var state = String(r.current_state || '').trim();
    var jobNumber = r.job_number;

    if (!state) {
      blankStateJobs.push(jobNumber);
      return;
    }
    if (!validStates[state]) {
      invalidStateJobs.push({ job_number: jobNumber, current_state: state });
      return;
    }
    if (state === Config.STATES.IN_PROGRESS) {
      var updated = new Date(r.updated_at);
      if (!isNaN(updated.getTime()) && updated.getTime() < ninetyDaysAgo) {
        var days = Math.floor((Date.now() - updated.getTime()) / (24 * 60 * 60 * 1000));
        stuckJobs.push({ job_number: jobNumber, updated_at: r.updated_at, days: days });
      }
    }
  });

  if (blankStateJobs.length > 0) {
    issues.push({
      check:    'CHECK_10_VW_STATE_INTEGRITY',
      severity: DIM_SEVERITY_.MEDIUM,
      category: 'VW_BLANK_STATE',
      message:  blankStateJobs.length + ' VW_JOB_CURRENT_STATE row(s) have a blank current_state: ' +
                blankStateJobs.slice(0, 10).join(', ') + (blankStateJobs.length > 10 ? ', ...' : ''),
      data: { count: blankStateJobs.length, samples: blankStateJobs.slice(0, 10) },
      recommendedAction: 'Every VW row must have a current_state from Config.STATES. Investigate how these rows were written.'
    });
  }

  if (invalidStateJobs.length > 0) {
    issues.push({
      check:    'CHECK_10_VW_STATE_INTEGRITY',
      severity: DIM_SEVERITY_.MEDIUM,
      category: 'VW_INVALID_STATE',
      message:  invalidStateJobs.length + ' VW_JOB_CURRENT_STATE row(s) have a current_state outside the valid enum: ' +
                invalidStateJobs.slice(0, 10).map(function(j) { return j.job_number + '=' + j.current_state; }).join(', ') +
                (invalidStateJobs.length > 10 ? ', ...' : ''),
      data: { count: invalidStateJobs.length, samples: invalidStateJobs.slice(0, 10) },
      recommendedAction: 'Confirm whether this is a typo/legacy state value or a genuinely new state that ' +
                          'needs to be added to Config.STATES/TRANSITIONS.'
    });
  }

  if (stuckJobs.length > 0) {
    stuckJobs.sort(function(a, b) { return b.days - a.days; });
    issues.push({
      check:    'CHECK_10_VW_STATE_INTEGRITY',
      severity: DIM_SEVERITY_.MEDIUM,
      category: 'VW_STUCK_IN_PROGRESS',
      message:  stuckJobs.length + ' job(s) have been IN_PROGRESS for more than 90 days. Oldest: ' +
                stuckJobs[0].job_number + ' (' + stuckJobs[0].days + ' days).',
      data: { count: stuckJobs.length, samples: stuckJobs.slice(0, 10) },
      recommendedAction: 'Review with the assigned team lead — likely stalled work, a migration artifact ' +
                          'that never got a real state transition, or a job that should have been voided.'
    });
  }

  return issues;
}
