// ============================================================
// DataSelfHealing.gs — BLC Nexus T9 Notifications
// src/09-notifications/DataSelfHealing.gs
//
// Check 4 (dead letter growth) — moved out of the original single-
// file DataIntegrityMonitor.gs during the 2026-07-09 split (RULE A8,
// .claude/rules/core_rules.md — the original file hit 828 lines).
// It lives here, not in DataIntegrityChecks_WorkLog.gs or
// DataIntegrityChecks_Entity.gs, because commit 3 adds dead letter
// self-healing (auto-retry) to this same file next — detection and
// healing for the same system belong together.
// ============================================================

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
    recommendedAction: 'Review the Dead Letter Queue sheet. Self-healing auto-retry lands in commit 3.'
  }];
}
