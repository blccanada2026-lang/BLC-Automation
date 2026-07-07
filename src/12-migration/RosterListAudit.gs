// ============================================================
// RosterListAudit.gs — BLC Nexus Data Diagnostic
// src/12-migration/RosterListAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runListAllStaff()
//
// Console-only dump of every DIM_STAFF_ROSTER row (person_code,
// name, role, active) — no filtering, no writes. Read-only.
// ============================================================

/**
 * Prints every DIM_STAFF_ROSTER row to the console. No filtering.
 * Read-only — no FACT or VW writes.
 */
function runListAllStaff() {
  var MODULE = 'RosterListAudit';

  var rows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });

  console.log('=== DIM_STAFF_ROSTER — all rows (' + rows.length + ') ===');
  console.log('');

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    console.log(
      '[' + (i + 1) + '] person_code=' + String(r.person_code || '(blank)') +
      '  name=' + String(r.name || '(blank)') +
      '  role=' + String(r.role || '(blank)') +
      '  active=' + String(r.active || '(blank)')
    );
  }

  console.log('');
  console.log('=== End — ' + rows.length + ' row(s) ===');
}
