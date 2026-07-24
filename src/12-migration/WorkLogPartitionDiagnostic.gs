// ============================================================
// WorkLogPartitionDiagnostic.gs — BLC Nexus T12 Migration/Diagnostic
// src/12-migration/WorkLogPartitionDiagnostic.gs
//
// READ-ONLY diagnostic built to resolve two specific open questions
// from the Phase 4 PROD dry-run investigation (2026-07-24):
//
//   1. Definitive live list of FACT_WORK_LOGS|* partition tabs, read
//      programmatically via DAL.listSheets() — resolves a contradictory
//      manual report about whether FACT_WORK_LOGS|2026-04 exists.
//   2. event_type distribution for named periods — extends a manual
//      spot-check already done for 2026-01 (found: WORK_LOG_MIGRATED +
//      WORK_LOG_PERIOD_FIXED only) to 2026-02/03/05 programmatically, to
//      confirm or rule out the same pattern, and specifically to catch
//      any organic event_type (e.g. WORK_LOG_SUBMITTED) that should be
//      counting toward payroll but isn't.
//
// READ-ONLY BY CONSTRUCTION: calls only DAL.listSheets() and
// DAL.readAll(). No DAL.appendRow/appendRows/ensurePartition anywhere in
// this file. Prints only event_type value counts, not row contents.
//
// NOT Config.isDev()-gated — intended to run against PROD, same
// reasoning as AggregationFixDryRun.gs (its whole purpose is answering
// a question about live PROD data). Prints the active script ID on every
// run so whoever runs it can confirm which project they're in.
//
// HOW TO RUN (Apps Script editor):
//   runWorkLogPartitionDiagnostic()
//
// Requires PAYROLL_VIEW (read-only RBAC action).
// ============================================================

var WLPD_ACTOR_EMAIL_       = 'raj.nair@bluelotuscanada.ca';
var WLPD_PARTITIONS_EXPECTED_ = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
var WLPD_EVENT_TYPE_CHECK_    = ['2026-02', '2026-03', '2026-05'];

function runWorkLogPartitionDiagnostic() {
  var actualScriptId = ScriptApp.getScriptId();
  console.log('=== Work log partition diagnostic (read-only) ===');
  console.log('Script ID: ' + actualScriptId + ' — confirm this matches the project you intend to check.');

  var actor = RBAC.resolveActor(WLPD_ACTOR_EMAIL_);
  RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_VIEW);

  console.log('');
  console.log('--- 1. Definitive live FACT_WORK_LOGS partition list (DAL.listSheets()) ---');
  var allSheets = DAL.listSheets();
  var prefix    = Config.TABLES.FACT_WORK_LOGS + '|';
  var partitions = [];
  for (var i = 0; i < allSheets.length; i++) {
    if (allSheets[i].indexOf(prefix) === 0) partitions.push(allSheets[i].substring(prefix.length));
  }
  partitions.sort();
  console.log('All FACT_WORK_LOGS partitions found (' + partitions.length + '): ' + partitions.join(', '));
  console.log('');
  WLPD_PARTITIONS_EXPECTED_.forEach(function (p) {
    console.log('  ' + p + ': ' + (partitions.indexOf(p) !== -1 ? 'EXISTS' : 'does NOT exist'));
  });

  console.log('');
  console.log('--- 2. event_type distribution ---');
  WLPD_EVENT_TYPE_CHECK_.forEach(function (periodId) {
    console.log('');
    console.log('  ' + periodId + ':');
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
        callerModule: 'WorkLogPartitionDiagnostic',
        periodId:     periodId
      });
    } catch (e) {
      console.log('    ERROR reading this partition: ' + e.message);
      return;
    }

    var counts = {};
    for (var j = 0; j < rows.length; j++) {
      var et = String((rows[j] && rows[j].event_type) || '(blank)');
      counts[et] = (counts[et] || 0) + 1;
    }

    console.log('    total rows: ' + rows.length);
    var types = Object.keys(counts).sort();
    if (types.length === 0) {
      console.log('    (no event_type values found — sheet may be empty)');
    }
    types.forEach(function (et) {
      console.log('    ' + et + ': ' + counts[et]);
    });
  });

  console.log('');
  console.log('=== End of diagnostic. Read-only — DAL.listSheets() and DAL.readAll() only, ' +
              'no writes anywhere in this file. ===');
}
