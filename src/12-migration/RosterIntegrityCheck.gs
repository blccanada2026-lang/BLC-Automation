// ============================================================
// RosterIntegrityCheck.gs — BLC Nexus T12 Migration/Diagnostic
//
// READ-ONLY. Full scan of DIM_STAFF_ROSTER for two specific corruption
// signatures, prompted by a DEV finding (2026-07-27): changeSupervisor()/
// scd2FieldChange_()'s idempotency check compared effective_from with
// plain string equality (String(r.effective_from).trim() !== effectiveDate),
// which never matches when effective_from is read back from real Sheets
// data as a Date object (only the Jest mock's plain-string fixtures ever
// matched — a fidelity gap, not a real idempotency guarantee). A repeat
// call with identical arguments therefore never hit the "already done"
// path — it closed whatever row was currently open (even one just
// created by a prior identical call) and appended another, with
// effective_to computed from the SAME effectiveDate each time. In DEV
// this produced 6 corrupted rows, each with effective_to BEFORE its own
// effective_from (an inverted/impossible validity window).
//
// PROD is believed clean only because Task2Step6Apply.gs's pre-write
// verification (checking exact expected pre-state) would abort a second
// run rather than proceed — not because changeSupervisor() itself is
// safe. This script checks that belief against real data rather than
// assuming it.
//
// Checks, across the ENTIRE DIM_STAFF_ROSTER (not just Task 2's target
// codes):
//   1. Any row where effective_to < effective_from (both non-blank) —
//      an inverted/impossible validity window, the exact corruption
//      signature found in DEV.
//   2. Any person_code with more than one open-ended (blank effective_to)
//      row — the duplicate-open-row condition the asOfDate resolution
//      guards (added earlier this session) are designed to catch.
//
// READ-ONLY BY CONSTRUCTION: DAL.readAll() only. No DAL.appendRow/
// appendRows/updateWhere/ensurePartition anywhere in this file. Not
// Config.isDev()-gated — deliberately, since it must run against PROD
// to answer this truthfully.
//
// HOW TO RUN (Apps Script editor, whichever project is active):
//   runRosterIntegrityCheck()
// ============================================================

function runRosterIntegrityCheck() {
  var actualScriptId = ScriptApp.getScriptId();
  console.log('=== DIM_STAFF_ROSTER integrity check (read-only) ===');
  console.log('Script ID: ' + actualScriptId + ' — confirm which project this is ' +
              '(DEV: 1smkj0mmUqcWDDJPq... / PROD: 1HzRiDrQJ6z-BxPzk...) before trusting this output.');

  var actor = RBAC.resolveActor('raj.nair@bluelotuscanada.ca');
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);

  var allRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'RosterIntegrityCheck' });
  console.log('Total DIM_STAFF_ROSTER rows: ' + allRows.length);

  /** Normalizes a Sheets date cell (Date object or string) to 'YYYY-MM-DD'. Mirrors PayrollEngine.gs's toIsoDate_. */
  function toIsoDate_(val) {
    if (!val) return '';
    if (val instanceof Date) {
      return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    return String(val).trim().substring(0, 10);
  }

  // ── Check 1: inverted validity windows (effective_to < effective_from) ──
  console.log('');
  console.log('--- 1. Rows where effective_to < effective_from (inverted window) ---');
  var invertedRows = [];
  allRows.forEach(function (r) {
    var from = toIsoDate_(r.effective_from);
    var to   = toIsoDate_(r.effective_to);
    if (from && to && to < from) {
      invertedRows.push(r);
    }
  });
  console.log('Found: ' + invertedRows.length);
  invertedRows.forEach(function (r) {
    console.log('  person_code=' + r.person_code + ' | supervisor_code=' + r.supervisor_code +
                ' | effective_from=' + toIsoDate_(r.effective_from) +
                ' | effective_to=' + toIsoDate_(r.effective_to) +
                ' | active=' + r.active);
  });

  // ── Check 2: more than one open-ended row for the same person_code ──
  console.log('');
  console.log('--- 2. person_codes with more than one open-ended (blank effective_to) row ---');
  var byCode = {};
  allRows.forEach(function (r) {
    var code = String(r.person_code || '').trim();
    if (!code) return;
    if (!byCode[code]) byCode[code] = [];
    byCode[code].push(r);
  });
  var duplicateOpenCodes = [];
  Object.keys(byCode).forEach(function (code) {
    var openRows = byCode[code].filter(function (r) { return !String(r.effective_to || '').trim(); });
    if (openRows.length > 1) {
      duplicateOpenCodes.push({ code: code, openRows: openRows });
    }
  });
  console.log('Found: ' + duplicateOpenCodes.length + ' person_code(s) with more than one open-ended row');
  duplicateOpenCodes.forEach(function (entry) {
    console.log('  ' + entry.code + ': ' + entry.openRows.length + ' open-ended rows');
    entry.openRows.forEach(function (r) {
      console.log('    supervisor_code=' + r.supervisor_code + ' | effective_from=' + toIsoDate_(r.effective_from));
    });
  });

  console.log('');
  console.log('=== Summary: ' + invertedRows.length + ' inverted-window row(s), ' +
              duplicateOpenCodes.length + ' person_code(s) with duplicate open rows. ' +
              (invertedRows.length === 0 && duplicateOpenCodes.length === 0 ? 'CLEAN.' : 'CORRUPTION FOUND — see above.') +
              ' ===');
}
