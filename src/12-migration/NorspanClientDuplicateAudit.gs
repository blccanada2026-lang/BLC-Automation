// ============================================================
// NorspanClientDuplicateAudit.gs — BLC Nexus Data Diagnostic
// src/12-migration/NorspanClientDuplicateAudit.gs
//
// HOW TO RUN (Apps Script editor):
//   runNorspanClientDuplicateAudit()
//
// Sarty (2026-07-08): the portal job list shows a plain "NORSPAN"
// client alongside "NORSPAN-MB" (the correct client_code). Same class
// of problem as MATIX vs. MATIX-SK (see SartyReconAudit.gs history).
//
// Prints, console-only:
//   1. Every DIM_CLIENT_MASTER row whose client_code OR client_name
//      contains "NORSPAN" — ALL columns, not just client_code/name.
//   2. VW_JOB_CURRENT_STATE job counts: client_code = 'NORSPAN' vs
//      client_code = 'NORSPAN-MB' vs anything else containing "NORSPAN".
//
// Read-only — no writes to any table. Fix (merge/correct client_code)
// is a separate, deliberate follow-up once these findings are reviewed.
// ============================================================

function runNorspanClientDuplicateAudit() {
  var MODULE = 'NorspanClientDuplicateAudit';

  console.log('=== NORSPAN client duplicate audit ===');
  console.log('');

  // ── Part 1: DIM_CLIENT_MASTER rows containing "NORSPAN" ─────
  var clientRows = DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: MODULE });
  console.log('DIM_CLIENT_MASTER: scanned ' + clientRows.length + ' row(s).');

  var matches = [];
  for (var i = 0; i < clientRows.length; i++) {
    var row  = clientRows[i];
    var code = String(row.client_code || '').toUpperCase();
    var name = String(row.client_name || '').toUpperCase();
    if (code.indexOf('NORSPAN') !== -1 || name.indexOf('NORSPAN') !== -1) {
      matches.push(row);
    }
  }

  console.log('Rows matching "NORSPAN" (client_code or client_name): ' + matches.length);
  console.log('');

  for (var m = 0; m < matches.length; m++) {
    console.log('[Match ' + (m + 1) + '] — all columns:');
    var cols = Object.keys(matches[m]);
    for (var c = 0; c < cols.length; c++) {
      console.log('  ' + cols[c] + ': ' + String(matches[m][cols[c]]));
    }
    console.log('');
  }

  if (matches.length === 0) {
    console.log('No DIM_CLIENT_MASTER row contains "NORSPAN" — unexpected given the portal symptom. Re-check client_code casing/whitespace, or whether the dropdown source has its own hardcoded list.');
  } else if (matches.length === 1) {
    console.log('Only one DIM_CLIENT_MASTER row found — the duplicate the portal shows is NOT a second client master row. Root cause is likely 55 jobs written with the wrong client_code, not a DIM_CLIENT_MASTER duplicate. See Part 2.');
  } else {
    console.log('Multiple DIM_CLIENT_MASTER rows found — this IS a duplicate client master entry (same class as MATIX vs. MATIX-SK). One of these rows needs to be removed or merged into the correct "NORSPAN-MB" row.');
  }

  console.log('');

  // ── Part 2: VW_JOB_CURRENT_STATE job counts by client_code ──
  var vwRows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
  console.log('VW_JOB_CURRENT_STATE: scanned ' + vwRows.length + ' row(s).');

  var countsByCode = {}; // exact client_code (as stored) -> count
  for (var v = 0; v < vwRows.length; v++) {
    var cc = String(vwRows[v].client_code || '').trim();
    if (cc.toUpperCase().indexOf('NORSPAN') === -1) continue;
    countsByCode[cc] = (countsByCode[cc] || 0) + 1;
  }

  var codes = Object.keys(countsByCode);
  if (codes.length === 0) {
    console.log('No VW_JOB_CURRENT_STATE rows have a client_code containing "NORSPAN".');
  } else {
    console.log('Job counts by exact client_code (containing "NORSPAN"):');
    for (var k = 0; k < codes.length; k++) {
      console.log('  "' + codes[k] + '": ' + countsByCode[codes[k]] + ' job(s)');
    }
  }

  var norspanExact   = countsByCode['NORSPAN']    || 0;
  var norspanMbExact = countsByCode['NORSPAN-MB'] || 0;

  console.log('');
  console.log('--- SUMMARY ---');
  console.log('DIM_CLIENT_MASTER rows matching "NORSPAN": ' + matches.length);
  console.log('VW jobs with client_code exactly "NORSPAN": ' + norspanExact);
  console.log('VW jobs with client_code exactly "NORSPAN-MB": ' + norspanMbExact);
  console.log('Correct client_code per CTO: "NORSPAN-MB".');
  if (norspanExact > 0) {
    console.log(norspanExact + ' job(s) have client_code "NORSPAN" and need correcting to "NORSPAN-MB" — NOT done by this audit (read-only). Review findings above before running any correction.');
  }

  console.log('=== End ===');

  return {
    dimClientMasterMatches: matches.length,
    vwCountsByCode:         countsByCode,
    norspanExactCount:      norspanExact,
    norspanMbExactCount:    norspanMbExact
  };
}
