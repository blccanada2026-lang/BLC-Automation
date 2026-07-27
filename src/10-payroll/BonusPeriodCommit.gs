// ============================================================
// BonusPeriodCommit.gs — BLC Nexus T10 Payroll
// src/10-payroll/BonusPeriodCommit.gs
//
// LOAD ORDER: T10. Loads after BonusPeriodEngine.gs,
// DanglingCorrectionGuard.gs, and QuarterlyBonusEngine.gs (same tier).
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1), RBAC (T2),
//               Logger (T3), CacheService (GAS builtin),
//               Utilities (GAS builtin), BonusPeriodEngine (T10),
//               DanglingCorrectionGuard (T10), QuarterlyBonusEngine (T10)
//
// DANGLING CORRECTION GUARD (ADR-WL-005 follow-up): for QUARTER
// periods, both previewBonusForPeriod() and commitBonusForPeriod()
// call DanglingCorrectionGuard.gs's dcgDetectDanglingCorrections_() to
// check for cross-partition WORK_LOG_REASSIGN corrections whose
// original quarter was already committed before the correction was
// filed (a real double-payment path — see that file's header for the
// full mechanism). Preview SURFACES findings (informational, does not
// throw); commit BLOCKS if any are found. ANNUAL periods don't run
// this check directly — they sum already-committed quarterly amounts
// (see runAnnualBonus_ / bpcPreviewAnnual_), so any dangling
// correction affecting a quarter was already caught at that quarter's
// own commit.
//
// Period-level commit tracking, dry-run/commit run-ID gating, and the
// audited supersede operation — the DAL-dependent half of the
// parameterized bonus engine (see BonusPeriodEngine.gs for the pure
// period-parsing/date-validation half).
//
// STORAGE MODEL: period-commit markers are stored as new event_type
// rows WITHIN the existing FACT_QUARTERLY_BONUS table (no schema
// change — reuses all 15 existing columns; see the ADR for why this
// was chosen over adding new columns or a new table).
//
//   event_type='PERIOD_COMMIT'         — one row per successful commit.
//     person_code:       '' (not applicable to a period-level record)
//     quarter_period_id: the period_value ('2026-Q2' or '2026-ANNUAL')
//                         — reuses the same field runAnnualBonus_()
//                         already overloads for annual entries.
//     bonus_inr:          the period's total committed amount (sum of
//                         all per-person amounts)
//     status:             'COMMITTED'
//     pending_reason:     '' for a normal commit, or
//                         'SUPERSEDES <old_bonus_id> | <reason>' for a
//                         commit written by supersedeBonusForPeriod()
//     idempotency_key:    'PERIOD_COMMIT|' + periodType + '|' + periodValue
//                         — THE period-level idempotency check.
//
//   event_type='PERIOD_COMMIT_VOIDED'  — written by supersede, voids
//     the OLD PERIOD_COMMIT row (FACT tables are append-only — the old
//     row is never edited, only referenced).
//     pending_reason:     'SUPERSEDES <old_bonus_id>' — the only
//                         mechanism used to determine whether a given
//                         PERIOD_COMMIT row is still "active".
//
//   Per-person rows use the EXISTING event_type='QUARTERLY_BONUS'/
//   'ANNUAL_BONUS' (unchanged, written via QuarterlyBonusEngine's own
//   writers for a NORMAL commit) plus two NEW event types written only
//   by supersede: 'QUARTERLY_BONUS_VOIDED'/'ANNUAL_BONUS_VOIDED' (voids
//   the old per-person amount) and a fresh 'QUARTERLY_BONUS'/
//   'ANNUAL_BONUS' row with a DISTINCT idempotency key
//   ('...|SUPERSEDE:<new_bonus_id>') so it can never collide with the
//   original commit's key and so writeBonusLedger_()'s own idempotency
//   check (keyed only by personCode+period) is untouched — a supersede
//   never re-runs the normal writer, it has its own.
// ============================================================

var BPC_MODULE_              = 'BonusPeriodEngine';
var BPC_RUN_CACHE_TTL_SEC_    = 21600; // 6 hours — CacheService's max TTL

function bpcPeriodCommitIdemKey_(periodType, periodValue) {
  return 'PERIOD_COMMIT|' + periodType + '|' + periodValue;
}

function bpcReadAllBonusRows_() {
  try {
    return DAL.readAll(Config.TABLES.FACT_QUARTERLY_BONUS, { callerModule: BPC_MODULE_ });
  } catch (e) {
    if (e.code === 'SHEET_NOT_FOUND') return [];
    throw e;
  }
}

function bpcIsMarkerVoided_(allRows, bonusId) {
  return allRows.some(function (r) {
    return r.event_type === 'PERIOD_COMMIT_VOIDED' &&
           String(r.pending_reason || '').indexOf('SUPERSEDES ' + bonusId) === 0;
  });
}

/** Returns the active (non-superseded) PERIOD_COMMIT marker for a period, or null. */
function bpcGetActiveMarker_(periodType, periodValue) {
  var allRows = bpcReadAllBonusRows_();
  var idemKey = bpcPeriodCommitIdemKey_(periodType, periodValue);

  var commits = allRows.filter(function (r) {
    return r.event_type === 'PERIOD_COMMIT' && r.idempotency_key === idemKey;
  });
  var active = commits.filter(function (c) { return !bpcIsMarkerVoided_(allRows, c.bonus_id); });
  if (active.length === 0) return null;

  active.sort(function (a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  return active[0];
}

function bpcGetCommittedQuartersForYear_(year) {
  var result = {};
  ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function (q) {
    result[q] = !!bpcGetActiveMarker_('QUARTER', year + '-' + q);
  });
  return result;
}

// ── Run-ID / checksum gating (the "can't commit what wasn't previewed") ──

function bpcRunCacheKey_(runId) { return 'BONUS_RUN|' + runId; }

function bpcChecksum_(rows) {
  var canon = rows.map(function (r) {
    return [r.person_code, r.design_hours, r.bonus_inr, r.status].join('|');
  }).sort().join(';');
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, canon);
  return bytes.map(function (b) { return ((b < 0 ? b + 256 : b)).toString(16); }).join('');
}

function bpcStoreRun_(runId, periodType, periodValue, checksum) {
  CacheService.getScriptCache().put(
    bpcRunCacheKey_(runId),
    JSON.stringify({ periodType: periodType, periodValue: periodValue, checksum: checksum }),
    BPC_RUN_CACHE_TTL_SEC_
  );
}

function bpcValidateRun_(runId, periodType, periodValue, currentChecksum) {
  var raw = CacheService.getScriptCache().get(bpcRunCacheKey_(runId));
  if (!raw) {
    throw new Error('commitBonusForPeriod: run ID "' + runId + '" not found or expired. ' +
                     'Call previewBonusForPeriod() again to get a fresh run ID before committing.');
  }
  var stored = JSON.parse(raw);
  if (stored.periodType !== periodType || stored.periodValue !== periodValue) {
    throw new Error('commitBonusForPeriod: run ID "' + runId + '" was generated for a different period (' +
                     stored.periodType + ' ' + stored.periodValue + '), not ' + periodType + ' ' + periodValue + '.');
  }
  if (stored.checksum !== currentChecksum) {
    throw new Error('commitBonusForPeriod: underlying data has changed since run ID "' + runId +
                     '" was previewed (checksum mismatch). Call previewBonusForPeriod() again for a fresh preview before committing.');
  }
}

// ── Annual preview (sum-of-quarters — mirrors runAnnualBonus_'s math, no writes) ──

function bpcPreviewAnnual_(year) {
  var totals = {};
  ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function (q) {
    QuarterlyBonusEngine.previewQuarterlyBonus(null, q, year).forEach(function (row) {
      if (row.status !== 'CALCULATED') return;
      var code = row.person_code;
      totals[code] = (totals[code] || 0) + (parseFloat(row.bonus_inr) || 0);
    });
  });
  return Object.keys(totals).map(function (code) {
    return { person_code: code, design_hours: 0, bonus_inr: Math.round(totals[code] * 100) / 100, status: 'CALCULATED' };
  });
}

function bpcRowsForPeriod_(actorEmail, parsed) {
  return (parsed.periodType === 'QUARTER')
    ? QuarterlyBonusEngine.previewQuarterlyBonus(actorEmail, parsed.quarter, parsed.year)
    : bpcPreviewAnnual_(parsed.year);
}

// ── Public: preview / commit / supersede ──────────────────────────

/**
 * Dry-run preview for a QUARTER or ANNUAL bonus period. Writes nothing.
 * Validates period eligibility (QUARTER must be fully closed; ANNUAL
 * requires all four quarters already committed) before computing.
 *
 * @param {string} actorEmail
 * @param {string} periodType  'QUARTER' | 'ANNUAL'
 * @param {string} periodValue 'YYYY-Qn' | 'YYYY-ANNUAL'
 * @param {Date}   [asOfDate]  Defaults to now; pass explicitly in tests.
 * @returns {{ runId, periodType, periodValue, rows, priorCommit }}
 */
function previewBonusForPeriod(actorEmail, periodType, periodValue, asOfDate) {
  var actor = RBAC.resolveActor(actorEmail);
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);

  var parsed = parseBonusPeriod_(periodType, periodValue);

  if (parsed.periodType === 'QUARTER') {
    if (!isQuarterClosed_(parsed.quarter, parsed.year, asOfDate)) {
      throw new Error('previewBonusForPeriod: ' + periodValue + ' has not fully closed yet — ' +
                       'cannot preview a bonus for a quarter still in progress.');
    }
  } else {
    var committed = bpcGetCommittedQuartersForYear_(parsed.year);
    var missing = ['Q1', 'Q2', 'Q3', 'Q4'].filter(function (q) { return !committed[q]; });
    if (missing.length > 0) {
      throw new Error('previewBonusForPeriod: cannot preview annual bonus for ' + parsed.year +
                       ' — missing committed quarter(s): ' + missing.join(', ') + '. ' +
                       'Every quarter must have a committed ledger entry before an annual bonus can run on top of it.');
    }
  }

  var rows     = bpcRowsForPeriod_(actorEmail, parsed);
  var runId    = Identifiers.generateId();
  var checksum = bpcChecksum_(rows);
  bpcStoreRun_(runId, periodType, periodValue, checksum);

  var priorMarker = bpcGetActiveMarker_(periodType, periodValue);

  var danglingCorrections = (parsed.periodType === 'QUARTER')
    ? dcgDetectDanglingCorrections_(parsed.quarter, parsed.year)
    : [];
  if (danglingCorrections.length > 0) {
    Logger.warn('BONUS_PERIOD_DANGLING_CORRECTIONS', {
      module: 'BonusPeriodCommit', periodType: periodType, periodValue: periodValue,
      count: danglingCorrections.length,
      corrections: danglingCorrections.map(function (d) { return d.message; })
    });
  }

  return {
    runId: runId,
    periodType: periodType,
    periodValue: periodValue,
    rows: rows,
    priorCommit: priorMarker ? {
      bonusId: priorMarker.bonus_id,
      totalInr: priorMarker.bonus_inr,
      committedAt: priorMarker.timestamp,
      committedBy: priorMarker.actor_email
    } : null,
    danglingCorrections: danglingCorrections
  };
}

/**
 * Commits a QUARTER or ANNUAL bonus period. Requires a runId from a
 * matching, still-fresh previewBonusForPeriod() call. Blocks (does not
 * silently skip or overwrite) if the period already has an active
 * committed entry — use supersedeBonusForPeriod() for corrections.
 *
 * @param {string} actorEmail
 * @param {string} periodType
 * @param {string} periodValue
 * @param {string} runId
 * @param {Date}   [asOfDate]
 * @returns {{ committed: boolean, bonusId: string, totalInr: number }}
 */
function commitBonusForPeriod(actorEmail, periodType, periodValue, runId, asOfDate) {
  var actor = RBAC.resolveActor(actorEmail);
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
  RBAC.enforceFinancialAccess(actor);

  var parsed = parseBonusPeriod_(periodType, periodValue);

  var existing = bpcGetActiveMarker_(periodType, periodValue);
  if (existing) {
    throw new Error('commitBonusForPeriod: ' + periodType + ' ' + periodValue +
                     ' already has a committed bonus ledger entry (bonus_id=' + existing.bonus_id +
                     ', committed ' + existing.timestamp + ' by ' + existing.actor_email + '). ' +
                     'Use supersedeBonusForPeriod() to correct an already-committed period — never re-commit directly.');
  }

  var rows     = bpcRowsForPeriod_(actorEmail, parsed);
  var checksum = bpcChecksum_(rows);
  bpcValidateRun_(runId, periodType, periodValue, checksum);

  if (parsed.periodType === 'QUARTER') {
    var dangling = dcgDetectDanglingCorrections_(parsed.quarter, parsed.year);
    if (dangling.length > 0) {
      throw new Error('commitBonusForPeriod: ' + periodType + ' ' + periodValue +
        ' has ' + dangling.length + ' dangling correction(s) that must be resolved before committing:\n' +
        dangling.map(function (d) { return '  - ' + d.message; }).join('\n'));
    }
  }

  return bpcWriteCommit_(actorEmail, periodType, periodValue, parsed, rows, null, asOfDate);
}

/**
 * Audited correction of an already-committed period. Voids the old
 * PERIOD_COMMIT marker and the old per-person amounts (referencing them,
 * never editing/deleting — FACT tables are append-only), then writes a
 * fresh commit with the current (corrected) figures. Requires an
 * existing committed entry to supersede — cannot be used as a substitute
 * for a normal first commit.
 *
 * @param {string} actorEmail
 * @param {string} periodType
 * @param {string} periodValue
 * @param {string} reason        Required — recorded in the audit trail.
 * @param {Date}   [asOfDate]
 * @returns {{ committed: boolean, bonusId: string, totalInr: number, supersedesBonusId: string }}
 */
function supersedeBonusForPeriod(actorEmail, periodType, periodValue, reason, asOfDate) {
  var actor = RBAC.resolveActor(actorEmail);
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
  RBAC.enforceFinancialAccess(actor);

  if (!reason || !String(reason).trim()) {
    throw new Error('supersedeBonusForPeriod: a correction reason is required.');
  }

  var parsed = parseBonusPeriod_(periodType, periodValue);

  var existing = bpcGetActiveMarker_(periodType, periodValue);
  if (!existing) {
    throw new Error('supersedeBonusForPeriod: ' + periodType + ' ' + periodValue +
                     ' has no committed entry — nothing to supersede. Use commitBonusForPeriod() for a first commit.');
  }

  var now = asOfDate || new Date();

  // Void the old period-level marker (referenced, never edited).
  DAL.appendRow(Config.TABLES.FACT_QUARTERLY_BONUS, {
    bonus_id:          Identifiers.generateId(),
    event_type:        'PERIOD_COMMIT_VOIDED',
    person_code:       '',
    quarter_period_id: periodValue,
    design_hours: 0, client_score: 0, error_score: 0, rating_score: 0, composite_score: 0,
    bonus_inr:          -(parseFloat(existing.bonus_inr) || 0),
    status:             'SUPERSEDED',
    pending_reason:     'SUPERSEDES ' + existing.bonus_id,
    actor_email:        actorEmail,
    timestamp:          now.toISOString(),
    idempotency_key:    'PERIOD_COMMIT_VOID|' + periodType + '|' + periodValue + '|' + existing.bonus_id
  }, { callerModule: BPC_MODULE_ });

  // Void old per-person amounts, then write corrected ones — both with
  // idempotency keys distinct from the normal-commit writer's keys, so
  // this never collides with (or is blocked by) writeBonusLedger_()'s
  // own per-person idempotency check.
  var oldPerPersonType = (parsed.periodType === 'QUARTER') ? 'QUARTERLY_BONUS' : 'ANNUAL_BONUS';
  var allRows = bpcReadAllBonusRows_();
  var oldPeriodField = periodValue;
  var oldPerPersonRows = allRows.filter(function (r) {
    return r.event_type === oldPerPersonType && r.quarter_period_id === oldPeriodField;
  });
  oldPerPersonRows.forEach(function (r) {
    DAL.appendRow(Config.TABLES.FACT_QUARTERLY_BONUS, {
      bonus_id:          Identifiers.generateId(),
      event_type:        oldPerPersonType + '_VOIDED',
      person_code:       r.person_code,
      quarter_period_id: periodValue,
      design_hours: 0, client_score: 0, error_score: 0, rating_score: 0, composite_score: 0,
      bonus_inr:          -(parseFloat(r.bonus_inr) || 0),
      status:             'SUPERSEDED',
      pending_reason:     'SUPERSEDES ' + r.bonus_id,
      actor_email:        actorEmail,
      timestamp:          now.toISOString(),
      idempotency_key:    r.idempotency_key + '|VOIDED_BY_SUPERSEDE|' + existing.bonus_id
    }, { callerModule: BPC_MODULE_ });
  });

  var rows = bpcRowsForPeriod_(actorEmail, parsed);
  var result = bpcWriteCommit_(actorEmail, periodType, periodValue, parsed, rows,
    { supersedesBonusId: existing.bonus_id, reason: reason }, now);

  return Object.assign(result, { supersedesBonusId: existing.bonus_id });
}

/**
 * Shared writer for a fresh PERIOD_COMMIT marker + per-person rows.
 * `supersedeInfo` is null for a normal commit, or
 * { supersedesBonusId, reason } for a supersede's new commit — used
 * only to give the new per-person rows distinct idempotency keys and to
 * record the linkage on the marker itself.
 */
function bpcWriteCommit_(actorEmail, periodType, periodValue, parsed, rows, supersedeInfo, asOfDate) {
  var now = asOfDate || new Date();
  var newBonusId = Identifiers.generateId();

  var calculated = rows.filter(function (r) { return r.status === 'CALCULATED'; });
  var total = calculated.reduce(function (sum, r) { return sum + (parseFloat(r.bonus_inr) || 0); }, 0);
  total = Math.round(total * 100) / 100;

  var perPersonType = (parsed.periodType === 'QUARTER') ? 'QUARTERLY_BONUS' : 'ANNUAL_BONUS';

  calculated.forEach(function (row) {
    var idemKey = supersedeInfo
      ? perPersonType + '|' + row.person_code + '|' + periodValue + '|SUPERSEDE:' + newBonusId
      : perPersonType + '|' + row.person_code + '|' + periodValue;
    DAL.appendRow(Config.TABLES.FACT_QUARTERLY_BONUS, {
      bonus_id:          Identifiers.generateId(),
      event_type:        perPersonType,
      person_code:       row.person_code,
      quarter_period_id: periodValue,
      design_hours:      row.design_hours || 0,
      client_score:      row.client_score || 0,
      error_score:       row.error_score  || 0,
      rating_score:      row.rating_score || 0,
      composite_score:   row.composite_score || 0,
      bonus_inr:         row.bonus_inr || 0,
      status:            'CALCULATED',
      pending_reason:    supersedeInfo ? ('SUPERSEDE correction: ' + supersedeInfo.reason) : '',
      actor_email:       actorEmail,
      timestamp:         now.toISOString(),
      idempotency_key:   idemKey
    }, { callerModule: BPC_MODULE_ });
  });

  DAL.appendRow(Config.TABLES.FACT_QUARTERLY_BONUS, {
    bonus_id:          newBonusId,
    event_type:        'PERIOD_COMMIT',
    person_code:       '',
    quarter_period_id: periodValue,
    design_hours: 0, client_score: 0, error_score: 0, rating_score: 0, composite_score: 0,
    bonus_inr:          total,
    status:             'COMMITTED',
    pending_reason:     supersedeInfo ? ('SUPERSEDES ' + supersedeInfo.supersedesBonusId + ' | ' + supersedeInfo.reason) : '',
    actor_email:        actorEmail,
    timestamp:          now.toISOString(),
    idempotency_key:    bpcPeriodCommitIdemKey_(periodType, periodValue)
  }, { callerModule: BPC_MODULE_ });

  return { committed: true, bonusId: newBonusId, totalInr: total };
}

// ── Public entry point matching the requested API shape ────────────

/**
 * runBonusForPeriod(periodType, periodValue) — the parameterized bonus
 * entry point business requirement asked for, replacing hardcoded
 * "current quarter" assumptions with an explicit, selectable period.
 *
 * DRY-RUN ONLY — per item 5, a bonus can never be committed without
 * first being previewed, so this is not a one-call run-and-commit. It
 * returns a preview (per-designer basis, formula inputs, and a run ID)
 * exactly like previewBonusForPeriod(); pass the same periodType/
 * periodValue plus the returned runId to commitBonusForPeriod() to
 * actually commit. Named to match the request; behavior is identical
 * to previewBonusForPeriod() — kept as a thin alias rather than two
 * divergent implementations.
 *
 * @param {string} actorEmail
 * @param {string} periodType   'QUARTER' | 'ANNUAL'
 * @param {string} periodValue  'YYYY-Qn' | 'YYYY-ANNUAL'
 * @param {Date}   [asOfDate]   Defaults to now; pass explicitly in tests.
 * @returns {{ runId, periodType, periodValue, rows, priorCommit }}
 */
function runBonusForPeriod(actorEmail, periodType, periodValue, asOfDate) {
  return previewBonusForPeriod(actorEmail, periodType, periodValue, asOfDate);
}

// ── Editor-runnable convenience wrappers ────────────────────────────
// The Apps Script editor's Run button can't pass arguments (same
// constraint documented in TimesheetPeriodRunner.gs) — these are for
// interactive DEV testing of the test matrix below, not a replacement
// for calling the parameterized functions directly/programmatically.

function runBonusPreview_Q1_2026()   { return JSON.stringify(previewBonusForPeriod('raj.nair@bluelotuscanada.ca', 'QUARTER', '2026-Q1'), null, 2); }
function runBonusPreview_Annual_2026() { return JSON.stringify(previewBonusForPeriod('raj.nair@bluelotuscanada.ca', 'ANNUAL', '2026-ANNUAL'), null, 2); }
