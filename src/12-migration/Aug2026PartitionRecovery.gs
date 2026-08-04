// ============================================================
// Aug2026PartitionRecovery.gs — BLC Nexus T12 Migration (PROD incident recovery)
//
// INCIDENT: FACT_WORK_LOGS|2026-08 and FACT_QC_EVENTS|2026-08 were
// created with a blank header row (ensurePartition()'s non-atomic
// insertSheet()-then-header-copy gap, DAL.gs:918-936 — the same class
// of failure confirmed in DEV via PayrollAutomationBonusOnlyConfirm
// ProofB1.gs's own crash). Every WORK_LOG/QC_SUBMIT submission against
// these two partitions since 2026-08-01 threw "The rowContents passed
// to appendRow() must be nonempty" inside the real handler
// (WorkLogHandler.gs:380-388, QCHandler.gs:174-180), which both
// release their idempotency mark and re-throw on failure — so after
// 3 failed attempts each, QueueProcessor dead-lettered them with the
// full original payload intact in DEAD_LETTER_QUEUE. Confirmed
// 2026-08-04: 31 items (21 WORK_LOG, 59.75 hours; 10 QC_SUBMIT),
// cross-checked exactly against STG_PROCESSING_QUEUE. Nothing was
// silently lost — nothing ever reached row 2 of either broken tab, so
// there is nothing to recover FROM the tabs themselves, only from the
// dead-lettered queue payloads.
//
// RECOVERY STRATEGY: (1) repair both blank headers in place — the
// exact structural gap PartitionHeaderIntegrityCheck.gs diagnoses but
// doesn't repair; (2) replay every matching DEAD_LETTER_QUEUE payload
// through the REAL WorkLogHandler.handle()/QCHandler.handle() — not a
// reimplementation, so every validation/state-guard/idempotency check
// those handlers normally run still applies. Both handlers fail
// BEFORE mutating job state (FACT write comes before any
// VW_JOB_CURRENT_STATE transition in both handlers), so a job whose
// original QC_SUBMIT/WORK_LOG attempt failed is still in the exact
// state it was in before that attempt — safe to replay as a fresh
// attempt today.
//
// DELIBERATE EXCEPTION TO RULE A2 (DAL-only sheet access): header
// repair uses SpreadsheetApp directly for row-1 structural writes —
// DAL has no public API for this (ensurePartition()'s own internal
// header-copy does the same thing, DAL.gs:955-961). Same documented
// exception class as PartitionHeaderIntegrityCheck.gs/
// PartitionCellCensusCheck.gs/DevSysLogsTrimmer.gs. Every other write
// in this file goes through the real handlers' own DAL calls — this
// file itself never calls DAL.appendRow/appendRows/updateWhere.
//
// SAFETY: header repair re-verifies BLANK immediately before writing
// (never blindly overwrites a non-blank header). The known-scope
// cross-check (A26PR_KNOWN_QUEUE_IDS_) is a tripwire, not a filter —
// live discovery always drives what gets processed; a mismatch is
// reported loudly, not silently reconciled. DEAD_LETTER_QUEUE itself
// is never modified — it stays exactly as historical record; nothing
// in this file writes to it.
//
// HOW TO RUN (Apps Script editor):
//   runAug2026PartitionRecoveryPreview()   — read-only, run first
//   runAug2026PartitionRecoveryCommit()    — repairs headers + replays
// ============================================================

var A26PR_CALLER_ = 'MigrationReplayEngine';
// Known incident period, confirmed 2026-08-04. This is a SAFETY CHECK, not
// the value actually used for repair/replay — see a26prActualPeriod_() below.
// The real handlers (WorkLogHandler/QCHandler) always write into whatever
// Identifiers.generateCurrentPeriodId() resolves to at call time (today's
// real date), not a value this script can pass in. If the two diverge
// (e.g. this script is run after a month rollover), a fresh partition would
// be created for the new period, carrying the SAME unfixed blank-header bug
// — every function here refuses to proceed rather than silently operating
// on an unexpected period.
var A26PR_EXPECTED_PERIOD_ = '2026-08';
var A26PR_TARGET_TABLES_ = [];  // populated lazily below (Config not guaranteed loaded at top-level eval time)

function a26prActualPeriod_() {
  return Identifiers.generateCurrentPeriodId();
}

function a26prAssertExpectedPeriod_() {
  var actual = a26prActualPeriod_();
  if (actual !== A26PR_EXPECTED_PERIOD_) {
    throw new Error('Aug2026PartitionRecovery: refusing to proceed — current period resolves to "' +
      actual + '" but this script is scoped to the known incident period "' + A26PR_EXPECTED_PERIOD_ +
      '". The replay handlers always write into the CURRENT period, not a value this script controls, ' +
      'so running outside the expected period would repair/replay against the wrong partition. ' +
      'If the incident now genuinely spans a new period, update A26PR_EXPECTED_PERIOD_ deliberately after investigating.');
  }
  return actual;
}

function a26prTargetTables_() {
  if (A26PR_TARGET_TABLES_.length === 0) {
    A26PR_TARGET_TABLES_ = [Config.TABLES.FACT_WORK_LOGS, Config.TABLES.FACT_QC_EVENTS];
  }
  return A26PR_TARGET_TABLES_;
}

function a26prFormTypes_() {
  return [Config.FORM_TYPES.WORK_LOG, Config.FORM_TYPES.QC_SUBMIT];
}

// Known incident scope, confirmed 2026-08-04 by direct DEAD_LETTER_QUEUE/
// STG_PROCESSING_QUEUE inspection (31/31 exact cross-check). A tripwire
// for the live discovery below, not a filter — see file header.
var A26PR_KNOWN_QUEUE_IDS_ = [
  '93d17e9d-fc40-4345-8269-40c4b97276c4', '8ae6b658-fcd3-4181-a3a9-6645c66a4d7b',
  '6bb9e12d-7ff9-486c-af74-20188cea7aa2', 'c20612d7-11c8-4280-9ee3-f43f9fbb1855',
  'cf87a484-c372-4f94-a691-152acd424417', '9ca5cbd0-431d-4587-ac30-e0008ca5073d',
  'bbc50ae2-c837-4e21-bc58-60446b56e744', 'a5ba99ad-f6d3-4f63-a8e5-12975cb5a172',
  '70e01329-99c5-459b-83e4-99d1d73d9e2f', '063bfc66-290d-498d-96d8-d718433e6757',
  '31451b11-e3ad-42d2-827f-3927f5ccd092', '168f2901-cd9a-4d53-8413-20f691111752',
  'ad3e709b-5fe7-47dc-9d39-82c3fa2f18eb', 'ef19d807-0d3b-4d67-8b66-e4a8c2d9654b',
  'f5e58dba-d435-4d5d-9b7a-e3e2128aa34e', '98a65a6c-f965-45ad-994a-73fc874799ae',
  '52f71293-2abb-4cdc-9302-8aafd00e2562', '97bd7a77-17b1-4a36-90b7-bd3fb6ac2747',
  'e3958335-60ab-464d-9faf-88eca2e69c13', '933886db-301d-4d43-afc3-3fcc6296a549',
  'e7ec01f7-d5d8-4fc6-8976-05b71dd53c3e', '00b88b58-6b8d-4dfe-92c2-fe584232c316',
  '3a3da992-dbd5-409d-ae3b-ca1ea30165d6', 'b8e393cd-385f-48bb-9faa-8575a6188988',
  '923018c9-68b1-4b86-acf7-6b1644468b18', '80baac97-a3df-46ba-8ebb-cbbd02e274f2',
  'acc99668-afa0-4f00-a971-2e0a0860023a', 'd1643155-9f0a-4774-b058-eb051a58cc49',
  '1125f261-04fa-442c-9dbb-382931065ca1', 'cc26301e-e2af-4dd0-bee8-c7f426922000',
  '4642b87b-5e4a-4395-b02d-b9be3ccef0b2'
];

/**
 * Restricts a discovered item list to exactly the audited incident scope
 * (A26PR_KNOWN_QUEUE_IDS_). Unlike a26prCrossCheckScope_ (a tripwire,
 * never filters), this DOES filter — Commit only has done readiness/
 * duplicate-reconciliation diligence on these 31 items; live discovery
 * on DEAD_LETTER_QUEUE pulls in every historically dead-lettered WORK_LOG/
 * QC_SUBMIT item regardless of age or root cause, most of which are an
 * unrelated population (legacy job-number formats, many already
 * INVOICED/COMPLETED_BILLABLE — replaying against those would violate
 * Rule A5/D3, not part of this incident).
 * @returns {{ inScope: Object[], excluded: Object[] }}
 */
function a26prScopeToKnown_(items) {
  var knownSet = {};
  A26PR_KNOWN_QUEUE_IDS_.forEach(function (id) { knownSet[id] = true; });
  return {
    inScope:  items.filter(function (it) { return !!knownSet[it.queue_id]; }),
    excluded: items.filter(function (it) { return !knownSet[it.queue_id]; })
  };
}

/**
 * Normalizes a work_date value (Date object OR string) to 'YYYY-MM-DD',
 * same approach as PortalData.gs's private normWorkDate_ — work_date is
 * a date-formatted column subject to the same Sheets auto-format
 * behavior documented in PROJECT_MEMORY.md §3.4.
 */
function a26prNormDate_(raw) {
  if (!raw) return '';
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return '';
    var y = raw.getFullYear(), mo = raw.getMonth() + 1, d = raw.getDate();
    return y + '-' + (mo < 10 ? '0' : '') + mo + '-' + (d < 10 ? '0' : '') + d;
  }
  var s   = String(raw).trim();
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  var p = new Date(s);
  if (!isNaN(p.getTime())) {
    var py = p.getFullYear(), pm = p.getMonth() + 1, pd = p.getDate();
    return py + '-' + (pm < 10 ? '0' : '') + pm + '-' + (pd < 10 ? '0' : '') + pd;
  }
  return s;
}

/**
 * Read-only. Finds any existing FACT_WORK_LOGS row matching this exact
 * job/actor/date/hours combination with event_type WORK_LOG_SUBMITTED —
 * used both as Commit's automatic double-count safety net and by the
 * standalone reconciliation report.
 */
function a26prFindMatchingWorkLogRow_(jobNumber, actorCode, workDate, hours, periodId) {
  var rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, { callerModule: A26PR_CALLER_, periodId: periodId });
  var normDate = a26prNormDate_(workDate);
  var normHours = parseFloat(hours);
  return rows.filter(function (r) {
    return String(r.job_number || '') === jobNumber &&
      String(r.actor_code || '').trim().toUpperCase() === actorCode &&
      String(r.event_type || '') === 'WORK_LOG_SUBMITTED' &&
      a26prNormDate_(r.work_date) === normDate &&
      parseFloat(r.hours) === normHours;
  });
}

// ============================================================
// SECTION 1: Header status / repair (pure, side-effect isolated)
// ============================================================

/**
 * Read-only. @returns {{ exists: boolean, blank: boolean|null, tabName: string, sheet: Sheet|null }}
 */
function a26prGetHeaderStatus_(tableName, periodId) {
  var tabName = Identifiers.generatePartitionTabName(tableName, periodId);
  var ss      = SpreadsheetApp.getActiveSpreadsheet();
  var sheet   = ss.getSheetByName(tabName);
  if (!sheet) return { exists: false, blank: null, tabName: tabName, sheet: null };

  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var nonBlank = headers.filter(function (h) { return String(h || '').trim() !== ''; });
  return { exists: true, blank: nonBlank.length === 0, tabName: tabName, sheet: sheet };
}

/**
 * Writes the canonical header (SetupScript.gs SCHEMAS) into row 1,
 * ONLY if the header is currently blank — re-verified right before
 * writing, never blindly overwrites a non-blank header.
 * @returns {{ repaired: boolean, tabName: string, reason: string=, headers: string[]= }}
 */
function a26prRepairHeaderIfBlank_(tableName, periodId) {
  var status = a26prGetHeaderStatus_(tableName, periodId);
  if (!status.exists) {
    throw new Error('a26prRepairHeaderIfBlank_: tab "' + status.tabName + '" does not exist — nothing to repair.');
  }
  if (!status.blank) {
    return { repaired: false, tabName: status.tabName, reason: 'header already OK — not touched' };
  }

  var canonical = (typeof SCHEMAS !== 'undefined') ? SCHEMAS[tableName] : undefined;
  if (!canonical || canonical.length === 0) {
    throw new Error('a26prRepairHeaderIfBlank_: no canonical schema found for "' + tableName + '" in SCHEMAS.');
  }

  status.sheet.getRange(1, 1, 1, canonical.length).setValues([canonical]);
  return { repaired: true, tabName: status.tabName, headers: canonical };
}

// ============================================================
// SECTION 2: Dead-letter discovery + readiness (read-only)
// ============================================================

/** @returns {Object[]} DEAD_LETTER_QUEUE rows with form_type WORK_LOG/QC_SUBMIT */
function a26prDiscoverDeadLetterItems_() {
  var rows = DAL.readAll(Config.TABLES.DEAD_LETTER_QUEUE, { callerModule: A26PR_CALLER_ });
  var formTypes = a26prFormTypes_();
  return rows.filter(function (r) { return formTypes.indexOf(String(r.form_type || '')) !== -1; });
}

/** Compares live discovery against the known incident scope. Tripwire only — never filters. */
function a26prCrossCheckScope_(items) {
  var knownSet = {};
  A26PR_KNOWN_QUEUE_IDS_.forEach(function (id) { knownSet[id] = true; });
  var foundSet = {};
  items.forEach(function (it) { foundSet[it.queue_id] = true; });

  return {
    unexpected: items.filter(function (it) { return !knownSet[it.queue_id]; }).map(function (it) { return it.queue_id; }),
    missing:    A26PR_KNOWN_QUEUE_IDS_.filter(function (id) { return !foundSet[id]; })
  };
}

/** Read-only per-item readiness check — does NOT resolve actor's write permission, just existence. */
function a26prCheckReadiness_(item) {
  var payload;
  try {
    payload = JSON.parse(item.payload_json || '{}');
  } catch (e) {
    return { queue_id: item.queue_id, form_type: item.form_type, ready: false, reason: 'invalid payload_json: ' + e.message };
  }

  var jobNumber = payload.job_number;
  var view;
  try {
    view = StateMachine.getJobView(jobNumber);
  } catch (e) {
    return { queue_id: item.queue_id, form_type: item.form_type, job_number: jobNumber, ready: false, reason: 'getJobView threw: ' + e.message };
  }
  if (!view) {
    return { queue_id: item.queue_id, form_type: item.form_type, job_number: jobNumber, ready: false, reason: 'job not found in VW_JOB_CURRENT_STATE' };
  }

  var actorResolved = null;
  try { actorResolved = RBAC.resolveActor(item.submitter_email); } catch (e) { /* leave null */ }
  var actorOk = !!(actorResolved && actorResolved.personCode && actorResolved.personCode !== 'UNKNOWN');

  return {
    queue_id: item.queue_id, form_type: item.form_type, job_number: jobNumber,
    current_state: view.current_state, submitter_email: item.submitter_email,
    actor_resolved: actorOk,
    ready: actorOk
  };
}

// ============================================================
// SECTION 3: Preview (read-only)
// ============================================================

function runAug2026PartitionRecoveryPreview() {
  var scriptId = ScriptApp.getScriptId();
  console.log('=== Aug 2026 partition recovery — PREVIEW (read-only) ===');
  console.log('Script ID: ' + scriptId + ' — confirm which project this is ' +
              '(DEV: 1smkj0mmUqcWDDJPq... / PROD: 1HzRiDrQJ6z-BxPzk...) before trusting this output.');

  var actor = RBAC.resolveActor('raj.nair@bluelotuscanada.ca');
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);

  var periodId = a26prActualPeriod_();
  console.log('Resolved current period: ' + periodId + (periodId === A26PR_EXPECTED_PERIOD_ ? '' :
    ' *** WARNING: differs from expected incident period ' + A26PR_EXPECTED_PERIOD_ + ' — read-only preview, showing anyway ***'));

  console.log('');
  console.log('--- Header status ---');
  var headerStatuses = a26prTargetTables_().map(function (t) {
    var s = a26prGetHeaderStatus_(t, periodId);
    console.log('  ' + s.tabName + ': ' + (!s.exists ? 'DOES NOT EXIST' : (s.blank ? '*** BLANK (broken) ***' : 'OK')));
    return { table: t, exists: s.exists, blank: s.blank, tabName: s.tabName };
  });

  var items = a26prDiscoverDeadLetterItems_();
  console.log('');
  console.log('--- Discovery ---');
  console.log('Found ' + items.length + ' dead-letter item(s) matching form_type WORK_LOG/QC_SUBMIT.');

  var crossCheck = a26prCrossCheckScope_(items);
  if (crossCheck.unexpected.length === 0 && crossCheck.missing.length === 0) {
    console.log('Cross-check OK: matches the known ' + A26PR_KNOWN_QUEUE_IDS_.length + '-item incident scope exactly.');
  } else {
    if (crossCheck.unexpected.length > 0) {
      console.log('*** WARNING: ' + crossCheck.unexpected.length + ' item(s) NOT in the known incident list: ' + crossCheck.unexpected.join(', '));
    }
    if (crossCheck.missing.length > 0) {
      console.log('*** WARNING: ' + crossCheck.missing.length + ' known incident item(s) missing from live DEAD_LETTER_QUEUE: ' + crossCheck.missing.join(', '));
    }
  }

  console.log('');
  console.log('--- Per-item readiness ---');
  var readiness = items.map(a26prCheckReadiness_);
  var notReady = readiness.filter(function (r) { return !r.ready; });
  readiness.forEach(function (r) {
    console.log('  ' + r.queue_id + ' (' + r.form_type + ', ' + (r.job_number || '?') + '): ' +
                (r.ready ? 'ready (state=' + r.current_state + ')' : 'NOT READY — ' + (r.reason || 'actor did not resolve')));
  });
  console.log('');
  console.log('=== Done. ' + (readiness.length - notReady.length) + '/' + readiness.length + ' item(s) ready. ' +
              'Nothing written — read-only. ===');

  return { header_statuses: headerStatuses, discovered_count: items.length, cross_check: crossCheck, readiness: readiness };
}

// ============================================================
// SECTION 3b: Header repair only — no replay, no DEAD_LETTER_QUEUE access.
//
// The urgent half of recovery: once both headers are repaired, new
// WORK_LOG/QC_SUBMIT submissions stop failing. The 31 already dead-
// lettered items are not urgent — they are safely parked and go nowhere
// until explicitly replayed via runAug2026PartitionRecoveryCommit().
// Split out so the low-risk, already-proven fix isn't gated on the more
// complex replay path.
// ============================================================

function runAug2026PartitionRecoveryHeaderRepairOnly() {
  var scriptId = ScriptApp.getScriptId();
  console.log('=== Aug 2026 partition recovery — HEADER REPAIR ONLY ===');
  console.log('Script ID: ' + scriptId + ' — confirm which project this is ' +
              '(DEV: 1smkj0mmUqcWDDJPq... / PROD: 1HzRiDrQJ6z-BxPzk...) before trusting this output.');

  var actor = RBAC.resolveActor('raj.nair@bluelotuscanada.ca');
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
  RBAC.enforceFinancialAccess(actor);

  var periodId = a26prAssertExpectedPeriod_();
  console.log('Resolved current period: ' + periodId + ' (matches expected incident period)');

  console.log('');
  console.log('--- Header repair ---');
  var repairs = a26prTargetTables_().map(function (t) {
    var r = a26prRepairHeaderIfBlank_(t, periodId);
    console.log('  ' + r.tabName + ': ' + (r.repaired ? 'REPAIRED (' + r.headers.length + ' columns written)' : r.reason));
    return r;
  });

  console.log('');
  console.log('=== Done. Headers only — no dead-letter discovery, no replay. ' +
              'Run runAug2026PartitionRecoveryCommit() separately to replay parked items. ===');

  return { period: periodId, repairs: repairs };
}

// ============================================================
// SECTION 4: Commit — repairs headers + replays through real handlers
// ============================================================

/**
 * @param {string[]=} excludeQueueIds  Optional — queue_ids to skip without
 *   replaying (e.g. internal-duplicate candidates flagged by
 *   runAug2026PartitionRecoveryWorkLogReconciliation() that need a human
 *   judgment call, not an automated one). Items already present in
 *   FACT_WORK_LOGS are excluded automatically regardless of this list —
 *   see Step 3b.
 */
function runAug2026PartitionRecoveryCommit(excludeQueueIds) {
  excludeQueueIds = excludeQueueIds || [];
  var excludeSet = {};
  excludeQueueIds.forEach(function (id) { excludeSet[id] = true; });

  var scriptId = ScriptApp.getScriptId();
  console.log('=== Aug 2026 partition recovery — COMMIT ===');
  console.log('Script ID: ' + scriptId + ' — confirm which project this is ' +
              '(DEV: 1smkj0mmUqcWDDJPq... / PROD: 1HzRiDrQJ6z-BxPzk...) before trusting this output.');

  var actor = RBAC.resolveActor('raj.nair@bluelotuscanada.ca');
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
  RBAC.enforceFinancialAccess(actor);

  var periodId = a26prAssertExpectedPeriod_();
  console.log('Resolved current period: ' + periodId + ' (matches expected incident period)');

  console.log('');
  console.log('--- Step 1: Header repair ---');
  var repairs = a26prTargetTables_().map(function (t) {
    var r = a26prRepairHeaderIfBlank_(t, periodId);
    console.log('  ' + r.tabName + ': ' + (r.repaired ? 'REPAIRED (' + r.headers.length + ' columns written)' : r.reason));
    return r;
  });

  var discovered = a26prDiscoverDeadLetterItems_();
  console.log('');
  console.log('--- Step 2: Discovery (' + discovered.length + ' item(s) found, before scoping) ---');
  var crossCheck = a26prCrossCheckScope_(discovered);
  if (crossCheck.unexpected.length > 0 || crossCheck.missing.length > 0) {
    console.log('*** NOTE — scope mismatch vs known incident list. Unexpected: ' +
                JSON.stringify(crossCheck.unexpected) + ' Missing: ' + JSON.stringify(crossCheck.missing) + ' ***');
  }

  var scoped = a26prScopeToKnown_(discovered);
  var items  = scoped.inScope;
  console.log('--- Step 2b: Scoped to the known ' + A26PR_KNOWN_QUEUE_IDS_.length +
              '-item incident list — ' + items.length + ' in scope, ' + scoped.excluded.length +
              ' excluded (not part of this incident, not replayed): ' +
              JSON.stringify(scoped.excluded.map(function (i) { return i.queue_id; })));

  console.log('');
  console.log('--- Step 3: Replay ---');
  var results = items.map(function (it) {
    var result = { queue_id: it.queue_id, form_type: it.form_type };

    if (excludeSet[it.queue_id]) {
      result.status = 'SKIPPED_MANUAL_EXCLUDE';
      result.detail = 'excluded via excludeQueueIds parameter';
      console.log('  ' + it.queue_id + ' (' + it.form_type + '): ' + result.status);
      return result;
    }

    try {
      var payload = JSON.parse(it.payload_json || '{}');

      // Step 3b — WORK_LOG double-count safety net. Idempotency is
      // keyed on queue_id alone (WorkLogHandler.gs:111-112), so it
      // cannot catch two DIFFERENT dead-lettered queue_ids carrying
      // identical hours, or a dead-lettered item whose hours were
      // already re-submitted successfully after the header repair.
      // Checked here unconditionally, not just via excludeQueueIds,
      // since this specific case is unambiguous and mechanically
      // detectable — no human judgment call needed.
      if (it.form_type === Config.FORM_TYPES.WORK_LOG) {
        var itemActorForCheck = RBAC.resolveActor(it.submitter_email);
        var existing = a26prFindMatchingWorkLogRow_(
          payload.job_number, itemActorForCheck.personCode, payload.work_date, payload.hours, periodId);
        if (existing.length > 0) {
          result.status = 'ALREADY_PRESENT';
          result.detail = 'matching hours already in FACT_WORK_LOGS — not replayed (would double-count)';
          console.log('  ' + it.queue_id + ' (' + it.form_type + '): ' + result.status + ' — ' + result.detail);
          return result;
        }
      }

      var itemActor = RBAC.resolveActor(it.submitter_email);
      var queueItemLike = {
        queue_id:        it.queue_id,
        form_type:       it.form_type,
        submitter_email: it.submitter_email,
        payload_json:    it.payload_json
      };

      var outcome;
      if (it.form_type === Config.FORM_TYPES.WORK_LOG) {
        outcome = WorkLogHandler.handle(queueItemLike, itemActor);
      } else if (it.form_type === Config.FORM_TYPES.QC_SUBMIT) {
        outcome = QCHandler.handle(queueItemLike, itemActor);
      } else {
        throw new Error('No recovery handler mapped for form_type: ' + it.form_type);
      }

      var isDuplicate = (outcome === 'DUPLICATE' || outcome === 'DUPLICATE_WORK_LOG');
      result.status = isDuplicate ? 'ALREADY_RECOVERED' : 'RECOVERED';
      result.detail = String(outcome);
    } catch (e) {
      result.status = 'ERROR';
      result.detail = e.message;
    }
    console.log('  ' + it.queue_id + ' (' + it.form_type + '): ' + result.status + ' — ' + result.detail);
    return result;
  });

  var summary = { recovered: 0, already_recovered: 0, already_present: 0, skipped_manual: 0, error: 0 };
  results.forEach(function (r) {
    if (r.status === 'RECOVERED') summary.recovered++;
    else if (r.status === 'ALREADY_RECOVERED') summary.already_recovered++;
    else if (r.status === 'ALREADY_PRESENT') summary.already_present++;
    else if (r.status === 'SKIPPED_MANUAL_EXCLUDE') summary.skipped_manual++;
    else summary.error++;
  });

  console.log('');
  console.log('=== Done. ' + summary.recovered + ' recovered, ' + summary.already_recovered +
              ' already recovered (idempotent skip), ' + summary.already_present +
              ' already present (double-count guard), ' + summary.skipped_manual +
              ' manually excluded, ' + summary.error + ' error(s). ' +
              'DEAD_LETTER_QUEUE left untouched (historical record). ===');

  return {
    repairs: repairs, discovered_count: discovered.length, cross_check: crossCheck,
    out_of_scope: scoped.excluded, out_of_scope_count: scoped.excluded.length,
    results: results, summary: summary
  };
}

// ============================================================
// SECTION 5: WORK_LOG duplicate reconciliation (read-only)
//
// WorkLogHandler's idempotency key is queue_id alone (WorkLogHandler.gs:
// 111-112) — it only stops the SAME dead-letter item from replaying
// twice. It cannot catch two DIFFERENT dead-lettered queue_ids carrying
// identical hours (e.g. a designer re-logging the same hours during the
// outage, thinking the first attempt failed), or a dead-lettered item
// whose hours were already successfully re-submitted after the header
// repair. Both would double-count real payroll hours if blindly
// replayed. Commit's Step 3b already auto-excludes the unambiguous case
// (ALREADY_IN_FACT_WORK_LOGS) — this report exists for the ambiguous
// case (two dead-letters that look identical), which needs a human
// judgment call, not an automated one: could be an accidental retry, or
// two genuinely separate days that happen to match.
//
// Read-only. Never writes. Run BEFORE Commit, review the
// INTERNAL_DUPLICATE_CANDIDATE items, and pass whichever queue_ids
// should be skipped to Commit's excludeQueueIds parameter.
// ============================================================

function runAug2026PartitionRecoveryWorkLogReconciliation() {
  var scriptId = ScriptApp.getScriptId();
  console.log('=== Aug 2026 partition recovery — WORK_LOG duplicate reconciliation (read-only) ===');
  console.log('Script ID: ' + scriptId + ' — confirm which project this is ' +
              '(DEV: 1smkj0mmUqcWDDJPq... / PROD: 1HzRiDrQJ6z-BxPzk...) before trusting this output.');

  var actor = RBAC.resolveActor('raj.nair@bluelotuscanada.ca');
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);

  var periodId = a26prActualPeriod_();
  console.log('Resolved current period: ' + periodId);

  var discovered = a26prDiscoverDeadLetterItems_();
  var scoped = a26prScopeToKnown_(discovered);
  var wlItems = scoped.inScope.filter(function (it) { return it.form_type === Config.FORM_TYPES.WORK_LOG; });
  console.log('Reconciling ' + wlItems.length + ' known-incident WORK_LOG dead-letter item(s).');

  // Parse + resolve actor for each item first, so grouping/matching
  // never has to re-parse.
  var parsed = wlItems.map(function (it) {
    var payload = {};
    var parseError = null;
    try { payload = JSON.parse(it.payload_json || '{}'); } catch (e) { parseError = e.message; }
    var itemActor = RBAC.resolveActor(it.submitter_email);
    var normDate = a26prNormDate_(payload.work_date);
    return {
      queue_id: it.queue_id, job_number: payload.job_number, hours: payload.hours,
      work_date: normDate, actor_code: itemActor.personCode, submitter_email: it.submitter_email,
      parseError: parseError,
      groupKey: payload.job_number + '|' + itemActor.personCode + '|' + normDate + '|' + parseFloat(payload.hours)
    };
  });

  // Group by (job_number, actor_code, work_date, hours) to find internal duplicates.
  var groups = {};
  parsed.forEach(function (p) {
    if (!groups[p.groupKey]) groups[p.groupKey] = [];
    groups[p.groupKey].push(p.queue_id);
  });

  var items = parsed.map(function (p) {
    var classification, detail, duplicateOf = [];
    if (p.parseError) {
      classification = 'INVALID_PAYLOAD';
      detail = p.parseError;
    } else {
      var existing = a26prFindMatchingWorkLogRow_(p.job_number, p.actor_code, p.work_date, p.hours, periodId);
      if (existing.length > 0) {
        classification = 'ALREADY_IN_FACT_WORK_LOGS';
        detail = 'matching hours already written — Commit will auto-skip this one';
      } else if (groups[p.groupKey].length > 1) {
        classification = 'INTERNAL_DUPLICATE_CANDIDATE';
        duplicateOf = groups[p.groupKey].filter(function (id) { return id !== p.queue_id; });
        detail = 'same job/actor/date/hours as: ' + duplicateOf.join(', ') + ' — needs your judgment (accidental retry vs. two real days)';
      } else {
        classification = 'UNIQUE';
        detail = 'safe to replay';
      }
    }
    var result = {
      queue_id: p.queue_id, job_number: p.job_number, actor_code: p.actor_code,
      work_date: p.work_date, hours: p.hours, classification: classification,
      duplicate_of: duplicateOf, detail: detail
    };
    console.log('  ' + p.queue_id + ' (' + p.job_number + ', ' + p.actor_code + ', ' + p.work_date + ', ' + p.hours + 'h): ' + classification + ' — ' + detail);
    return result;
  });

  var summary = { unique: 0, already_present: 0, internal_duplicate: 0, invalid: 0 };
  items.forEach(function (r) {
    if (r.classification === 'UNIQUE') summary.unique++;
    else if (r.classification === 'ALREADY_IN_FACT_WORK_LOGS') summary.already_present++;
    else if (r.classification === 'INTERNAL_DUPLICATE_CANDIDATE') summary.internal_duplicate++;
    else summary.invalid++;
  });

  console.log('');
  console.log('=== Done. ' + summary.unique + ' unique (safe), ' + summary.already_present +
              ' already present (Commit auto-skips), ' + summary.internal_duplicate +
              ' internal-duplicate candidate(s) (need your judgment), ' + summary.invalid +
              ' invalid payload(s). Nothing written — read-only. ===');
  if (summary.internal_duplicate > 0) {
    console.log('For each INTERNAL_DUPLICATE_CANDIDATE group, decide which queue_id(s) to keep and pass the rest to runAug2026PartitionRecoveryCommit([...queue_ids to skip]).');
  }

  return { items: items, summary: summary };
}
