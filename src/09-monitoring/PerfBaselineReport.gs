// ============================================================
// PerfBaselineReport.gs — BLC Nexus T9 Monitoring
// src/09-monitoring/PerfBaselineReport.gs
//
// Wave 0 performance baseline (2026-08-09 CTO assessment). Reads the
// EXECUTION_COMPLETE log rows that HealthMonitor.startExecution()/
// endExecution() already write to _SYS_LOGS (existing mechanism, see
// HealthMonitor.gs — this file adds no new write path) and reports
// count/min/avg/p95/max duration_ms and avg api_calls per module.
//
// Currently instrumented portal entry points (Portal.gs):
//   portal_getViewData, portal_getLeaderDashboard,
//   portal_getMyHours, portal_getCEODashboard
//
// Read-only. DAL.readAll only, no writes.
//
// HOW TO RUN (Apps Script editor, PROD project — this is where the
// real usage data lives):
//   runPerfBaselineReport()
// ============================================================

function runPerfBaselineReport() {
  console.log('=== Wave 0 performance baseline — EXECUTION_COMPLETE summary ===');

  var rows;
  try {
    rows = DAL.readWhere(Config.TABLES.SYS_LOGS, { action: 'EXECUTION_COMPLETE' }, { callerModule: 'MigrationReplayEngine' });
  } catch (e) {
    console.log('*** Could not read _SYS_LOGS: ' + e.message + ' ***');
    return;
  }

  console.log('Total EXECUTION_COMPLETE rows: ' + rows.length);
  if (rows.length === 0) {
    console.log('No data yet — this is expected immediately after deploy. Check back after a day or two of real portal usage.');
    return;
  }

  var byModule = {};
  rows.forEach(function (r) {
    var detail;
    try { detail = JSON.parse(r.detail_json || '{}'); } catch (e) { return; }
    var durationMs = Number(detail.duration_ms);
    if (isNaN(durationMs)) return;
    var mod = String(r.module || 'UNKNOWN');
    if (!byModule[mod]) byModule[mod] = [];
    byModule[mod].push({ duration_ms: durationMs, api_calls: Number(detail.api_calls) || 0 });
  });

  Object.keys(byModule).sort().forEach(function (mod) {
    var samples = byModule[mod];
    var durations = samples.map(function (s) { return s.duration_ms; }).sort(function (a, b) { return a - b; });
    var apiCalls  = samples.map(function (s) { return s.api_calls; });

    var count = durations.length;
    var min   = durations[0];
    var max   = durations[count - 1];
    var avg   = Math.round(durations.reduce(function (a, b) { return a + b; }, 0) / count);
    var p95   = durations[Math.min(count - 1, Math.ceil(count * 0.95) - 1)];
    var avgApi = Math.round(apiCalls.reduce(function (a, b) { return a + b; }, 0) / count);

    console.log('');
    console.log('--- ' + mod + ' (' + count + ' calls) ---');
    console.log('  duration_ms: min=' + min + ' avg=' + avg + ' p95=' + p95 + ' max=' + max);
    console.log('  avg api_calls per call: ' + avgApi);
  });

  console.log('');
  console.log('=== Done. Re-run periodically as more real usage accumulates. ===');
}
