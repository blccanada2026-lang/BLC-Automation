// ============================================================
// DataIntegrityChecks_WorkLog.gs — BLC Nexus T9 Notifications
// src/09-notifications/DataIntegrityChecks_WorkLog.gs
//
// Data integrity Checks 1, 2, 6, 7 — all FACT_WORK_LOGS-focused.
// Pure detection logic, read-only, no writes. Each check function
// returns Object[] in the shared issue shape (see DataIntegrityMonitor.gs
// header for the contract). Called by runDataIntegrityChecks() in
// DataIntegrityMonitor.gs — same global GAS namespace, no import needed.
//
// Split from the original single-file DataIntegrityMonitor.gs
// 2026-07-09 to stay under RULE A8's ~500-line module cap
// (.claude/rules/core_rules.md). Checks 3/5/8/9/10 (dimension/VW-
// focused) are in DataIntegrityChecks_Entity.gs. Check 4 (dead letter
// growth) is in DataSelfHealing.gs, alongside dead letter self-healing.
//
// Reuse:
//   Check 2 calls computeWorkLogOrphans_() from WorkLogOrphanAudit.gs
//     unmodified, then filters to the current month.
//   Check 1 reuses normWd_() (date normalization) from
//     WorkLogDedupAudit.gs, but does NOT reuse that file's grouping
//     function — the spec's detection is strictly narrower (event_type
//     filter, hours in the key, net against WORK_LOG_VOIDED) than the
//     manual audit's intentionally-broad key. WorkLogDedupAudit.gs is
//     untouched.
//   Check 7 calls normalizeJobNumber_() / isAdminOverheadJobNumber_()
//     from WorkLogOrphanAudit.gs unmodified.
//   Check 6's malformed-period_id predicate mirrors (does not call —
//     the original is a private closure var inside the WorkLogPeriodFixer
//     IIFE, not exposed) WorkLogPeriodFixer.gs's isMalformed_(): a Date
//     object or anything not matching /^\d{4}-\d{2}$/. Rows already
//     covered by a WORK_LOG_PERIOD_FIXED amendment are excluded via
//     idempotency_key prefix-stripping (amendment_of is NOT in the
//     FACT_WORK_LOGS header — DAL drops it on write, per PROJECT_MEMORY
//     §11 — so it can't be used for this).
// ============================================================

/** Builds the current month's period_id, e.g. '2026-07'. Shared by checks 1/2/6/7. */
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

/**
 * @param {string} [monthPartitionOverride] 'YYYY-MM'. Defaults to the
 *   current month. Passed by PreBillingGate.gs to scope this check to
 *   a specific billing period's monthly partition instead of "now".
 * @param {Object} [jobFilter] Set of job_number -> true. When provided
 *   (by PreBillingGate.gs), duplicates on jobs outside the filter are
 *   ignored — a duplicate on a job with no hours in this billing
 *   period can't affect this period's billing. Omitted = whole
 *   partition (daily monitor).
 */
function checkDuplicateWorkLogs_(monthPartitionOverride, jobFilter) {
  var MODULE     = 'DataIntegrityMonitor';
  var periodId   = monthPartitionOverride || dimCurrentMonthPartition_();
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
    if (jobFilter && !jobFilter[jn]) continue;

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

/**
 * @param {string} [monthPartitionOverride] 'YYYY-MM'. Defaults to the
 *   current month. Passed by PreBillingGate.gs to scope this check to
 *   a specific billing period's monthly partition instead of "now".
 * @param {Object} [jobFilter] Set of job_number -> true. When provided
 *   (by PreBillingGate.gs), only orphans with hours in this exact
 *   billing period's date range are flagged — an orphan whose hours
 *   fall in the other half of the month can't affect this period's
 *   billing. Note: an orphan by definition has no VW row, so it can
 *   still appear in jobFilter (built purely from FACT_WORK_LOGS).
 *   Omitted = whole partition (daily monitor).
 */
function checkOrphanedWorkLogs_(monthPartitionOverride, jobFilter) {
  var periodId = monthPartitionOverride || dimCurrentMonthPartition_();
  var result   = computeWorkLogOrphans_('DataIntegrityMonitor');

  var currentMonthOrphans = result.orphans.filter(function(o) {
    if (jobFilter && !jobFilter[o.job_number]) return false;
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
                        '(Check 7) before assuming a genuine orphan needing a manual VW decision (ADR-WL-001).'
  }];
}

// ─────────────────────────────────────────────────────────────
// Check 6 — Period_id format integrity (MEDIUM)
//
// Current + previous month FACT_WORK_LOGS partitions: every row's
// period_id must be a bare 'YYYY-MM' string, not a Date object or
// blank. We fixed 9,873 malformed rows on 2026-07-06
// (WorkLogPeriodFixer.gs) — this catches recurrence going forward.
// Rows that already have a matching WORK_LOG_PERIOD_FIXED amendment
// are excluded via idempotency_key prefix-stripping, so this doesn't
// re-alert on the 9,873 rows already fixed.
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
