// ============================================================
// DataIntegrityChecks_Entity.gs — BLC Nexus T9 Notifications
// src/09-notifications/DataIntegrityChecks_Entity.gs
//
// Data integrity Checks 3, 5, 8, 9, 10 — all dimension/VW-focused
// (DIM_CLIENT_MASTER, DIM_CLIENT_RATES, DIM_STAFF_ROSTER,
// VW_JOB_CURRENT_STATE). Pure detection logic, read-only, no writes.
// Each check function returns Object[] in the shared issue shape (see
// DataIntegrityMonitor.gs header for the contract). Called by
// runDataIntegrityChecks() in DataIntegrityMonitor.gs — same global
// GAS namespace, no import needed.
//
// Split from the original single-file DataIntegrityMonitor.gs
// 2026-07-09 to stay under RULE A8's ~500-line module cap
// (.claude/rules/core_rules.md). Checks 1/2/6/7 (FACT_WORK_LOGS-
// focused) are in DataIntegrityChecks_WorkLog.gs. Check 4 (dead
// letter growth) is in DataSelfHealing.gs, alongside dead letter
// self-healing.
//
// Reuse:
//   Check 5 calls checkRosterContamination_() / checkVwContamination_() /
//     checkWorkLogContamination_() / checkQueueContamination_() from
//     ExecutionHealthMonitor.gs. Those functions' underlying fixture
//     lists (HM_TEST_CLIENT_CODES_, HM_TEST_PERSON_CODES_) were edited
//     2026-07-09 to drop NORSPAN and add TLM/WLD/designer@blclotus.com —
//     this file calls them, it does not duplicate their logic.
//   Checks 3, 8, 9, 10 have no prior audit script to reuse — new logic.
// ============================================================

// ─────────────────────────────────────────────────────────────
// Check 3 — Client code consistency (CRITICAL)
//
// Every distinct client_code in VW_JOB_CURRENT_STATE (excluding
// VOIDED jobs) must resolve to a DIM_CLIENT_MASTER row. Catches the
// NORSPAN-class problem (bare client_code with no dimension row, or a
// near-miss of a real code) at detection time instead of at billing.
// ─────────────────────────────────────────────────────────────

/**
 * @param {Object} [jobFilter] Set of job_number -> true. When provided
 *   (by PreBillingGate.gs), only VW rows for jobs in this set are
 *   checked — scopes the check to jobs actually in a billing period
 *   instead of the whole table. Omitted = full-table scan (daily monitor).
 */
function checkClientCodeConsistency_(jobFilter) {
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
    if (jobFilter && !jobFilter[r.job_number]) return;
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
// Check 5 — Test contamination (CRITICAL)
//
// Reuses checkRosterContamination_() / checkVwContamination_() /
// checkWorkLogContamination_() / checkQueueContamination_() from
// ExecutionHealthMonitor.gs unmodified (same global GAS namespace —
// no import needed). Those return { severity: 'ERROR', category, message }
// (R10 test-fixture scan); mapped to this monitor's CRITICAL here,
// since any hit is an R10.8 stop-work condition. The separate daily
// runProdContaminationCheck() trigger stays as-is until commit 7,
// which unifies it into this monitor.
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

/**
 * @param {Object} [jobFilter] Set of job_number -> true. When provided
 *   (by PreBillingGate.gs), only VW rows for jobs in this set are
 *   checked. Omitted = full active-pipeline scan (daily monitor).
 */
function checkAllocatedToValidity_(jobFilter) {
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
    if (jobFilter && !jobFilter[r.job_number]) return;
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

/**
 * @param {Object} [jobFilter] Set of job_number -> true. When provided
 *   (by PreBillingGate.gs): part (a) only checks clients that have at
 *   least one job in the filter (unrelated clients aren't this
 *   billing run's problem); part (b) only checks VW rows for jobs in
 *   the filter. Omitted = full-table scan (daily monitor).
 */
function checkRateConfigurationCompleteness_(jobFilter) {
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

  // When scoped to a billing period, only clients with a job actually
  // in that period are relevant — pull their client_codes from VW.
  var relevantClients = null;
  if (jobFilter) {
    relevantClients = {};
    DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE }).forEach(function(r) {
      if (!jobFilter[r.job_number]) return;
      var code = String(r.client_code || '').trim();
      if (code) relevantClients[code] = true;
    });
  }

  var clientsWithNoRates = [];
  clientRows.forEach(function(c) {
    if (!isActiveRow_(c)) return;
    var code = String(c.client_code || '').trim();
    if (!code) return;
    if (relevantClients && !relevantClients[code]) return;
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
    if (jobFilter && !jobFilter[r.job_number]) return;
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
