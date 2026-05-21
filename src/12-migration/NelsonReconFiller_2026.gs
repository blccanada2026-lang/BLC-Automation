// ============================================================
// NelsonReconFiller_2026.gs — BLC Nexus T12 Migration
// src/12-migration/NelsonReconFiller_2026.gs
//
// Inserts Nelson Lumber work log entries into FACT_WORK_LOGS.
// Source: NELSON_2026_03_2H_RECON.md  (13 entries, 77.5 hrs)
//         NELSON_2026_04_1H_RECON.md  (17 entries, 94 hrs)
//         NELSON_2026_04_2H_RECON.md  (9 entries,  68 hrs)
// Total: 39 entries, 239.5 hrs
//
// Batch tag: BATCH-RECON-NELSON-2026
// Idempotency keys: NL-2603-2H-NNNN, NL-2604-1H-NNNN, NL-2604-2H-NNNN
//
// Actor code resolutions applied:
//   AR = AR001 (Abhisekh Rit, DESIGNER)
//   DS = DBS  (Deb Sen, DESIGNER)
//   SG = SGO  (Sarty Gosh, PM)
//
// Notes:
//   - Jan + Feb + Mar 1H periods SKIPPED — no invoice files available.
//   - Nelson Lumber job numbers have NO Q-prefix (e.g. 260337, not Q260337).
//   - F suffix = Floor variant (e.g. 260337F), part of job number.
//   - G prefix = client-issued (e.g. G2602072, G2602072F), record as-is.
//   - Extended job number suffixes: G2602072_CORRIDOR, G2602072F_REVISION,
//     G2602072-Rev, 260391B1, 260391B1F, 260391B2 — full string as job_number.
//   - All AR dates on Mar 2H invoice showed year 2020 — corrected to 2026.
//   - Last Apr 1H AR row showed 15-04-2028 — corrected to 2026.
//   - DS has 0 hrs in Mar 2H (listed on invoice but no line items).
//
// Run from Apps Script editor (overrides must be enabled):
//   1. runMigrationEnableOverrides()
//   2. runFillNelsonMar2H()
//   3. runFillNelsonApr1H()
//   4. runFillNelsonApr2H()
//   5. runMigrationDisableOverrides()
// ============================================================

var NelsonReconFiller_2026 = (function () {

  var MODULE      = 'NelsonReconFiller';
  var RECON_BATCH = 'BATCH-RECON-NELSON-2026';

  // Format: [client_code, job_number, work_date, hours, actor_code, actor_role]

  // ── Mar 16–31 2026 (13 entries, 77.5 hrs) ────────────────────

  var MAR_2H_ = [
    // ── AR001 Mar 16-31 (9 rows, 64 hrs) — dates corrected from 2020 → 2026
    ['NELSON', '260337',   '2026-03-19', 8,  'AR001', 'DESIGNER'],
    ['NELSON', '260337',   '2026-03-22', 8,  'AR001', 'DESIGNER'],
    ['NELSON', '260337',   '2026-03-23', 6,  'AR001', 'DESIGNER'],
    ['NELSON', '260337',   '2026-03-24', 2,  'AR001', 'DESIGNER'],
    ['NELSON', '260337',   '2026-03-25', 6,  'AR001', 'DESIGNER'],
    ['NELSON', 'G2602072', '2026-03-27', 1,  'AR001', 'DESIGNER'],
    ['NELSON', 'G2602072', '2026-03-29', 8,  'AR001', 'DESIGNER'],
    ['NELSON', 'G2602072', '2026-03-30', 10, 'AR001', 'DESIGNER'],
    ['NELSON', 'G2602072', '2026-03-31', 15, 'AR001', 'DESIGNER'],
    // ── SGO Mar 16-31 (4 rows, 13.5 hrs) — DESIGNER work
    ['NELSON', '260337F',   '2026-03-19', 3,   'SGO', 'PM'],
    ['NELSON', '260337F',   '2026-03-22', 2.5, 'SGO', 'PM'],
    ['NELSON', '260337F',   '2026-03-23', 2,   'SGO', 'PM'],
    ['NELSON', 'G2602072F', '2026-03-31', 6,   'SGO', 'PM']
    // DBS: 0 hrs this period — no entries
  ];

  // ── Apr 1–15 2026 (17 entries, 94 hrs) ───────────────────────

  var APR_1H_ = [
    // ── AR001 Apr 1-15 (5 rows, 41 hrs) — last row date corrected from 2028 → 2026
    ['NELSON', 'G2602072-Rev', '2026-04-09', 8,  'AR001', 'DESIGNER'],
    ['NELSON', 'G2602072-Rev', '2026-04-10', 12, 'AR001', 'DESIGNER'],
    ['NELSON', '260391B1',     '2026-04-13', 8,  'AR001', 'DESIGNER'],
    ['NELSON', '260391B1',     '2026-04-14', 5,  'AR001', 'DESIGNER'],
    ['NELSON', '260391B1',     '2026-04-15', 8,  'AR001', 'DESIGNER'],
    // ── DBS Apr 1-15 (4 rows, 19.5 hrs)
    ['NELSON', '260391B2', '2026-04-07', 7.5, 'DBS', 'DESIGNER'],
    ['NELSON', '260391B2', '2026-04-09', 2,   'DBS', 'DESIGNER'],
    ['NELSON', '260391B2', '2026-04-11', 7,   'DBS', 'DESIGNER'],
    ['NELSON', '260391B2', '2026-04-14', 3,   'DBS', 'DESIGNER'],
    // ── SGO Apr 1-15 (8 rows, 33.5 hrs) — DESIGNER work
    ['NELSON', 'G2602072F',          '2026-04-01', 6,   'SGO', 'PM'],
    ['NELSON', 'G2602072_CORRIDOR',  '2026-04-02', 6,   'SGO', 'PM'],
    ['NELSON', '260391B1F',          '2026-04-06', 2,   'SGO', 'PM'],
    ['NELSON', '260391B1F',          '2026-04-07', 2,   'SGO', 'PM'],
    ['NELSON', 'G2602072F_REVISION', '2026-04-08', 5,   'SGO', 'PM'],
    ['NELSON', '260391B1F',          '2026-04-08', 2.5, 'SGO', 'PM'],
    ['NELSON', 'G2602072F_REVISION', '2026-04-09', 6,   'SGO', 'PM'],
    ['NELSON', '260391B1F',          '2026-04-15', 4,   'SGO', 'PM']
  ];

  // ── Apr 16–30 2026 (9 entries, 68 hrs) ───────────────────────

  var APR_2H_ = [
    // ── AR001 Apr 16-30 (5 rows, 44 hrs)
    ['NELSON', '260391B1', '2026-04-16', 8,  'AR001', 'DESIGNER'],
    ['NELSON', '260391B1', '2026-04-17', 8,  'AR001', 'DESIGNER'],
    ['NELSON', '260391B1', '2026-04-18', 8,  'AR001', 'DESIGNER'],
    ['NELSON', '260391B1', '2026-04-20', 12, 'AR001', 'DESIGNER'],
    ['NELSON', '260391B1', '2026-04-21', 8,  'AR001', 'DESIGNER'],
    // ── DBS Apr 16-30 (1 row, 3 hrs)
    ['NELSON', '260391B2', '2026-04-17', 3, 'DBS', 'DESIGNER'],
    // ── SGO Apr 16-30 (3 rows, 21 hrs) — DESIGNER work
    ['NELSON', '260391B1F', '2026-04-21', 8,  'SGO', 'PM'],
    ['NELSON', '260391B1F', '2026-04-22', 3,  'SGO', 'PM'],
    ['NELSON', '260493',    '2026-04-30', 10, 'SGO', 'PM']
  ];

  // ── Row builder ────────────────────────────────────────────

  function buildRow_(entry, iKey) {
    var workDate = entry[2];
    var periodId = workDate.substring(0, 7);
    return {
      event_id:        Identifiers.generateId(),
      job_number:      entry[1],
      period_id:       periodId,
      event_type:      'WORK_LOG_MIGRATED',
      timestamp:       new Date().toISOString(),
      actor_code:      entry[4],
      actor_role:      entry[5],
      hours:           entry[3],
      work_date:       workDate,
      notes:           'Invoice reconciliation — ' + RECON_BATCH,
      idempotency_key: iKey,
      migration_batch: RECON_BATCH
    };
  }

  // ── Core filler ────────────────────────────────────────────

  function fill_(actorEmail, entries, keyPrefix) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    Logger.info('NELSON_RECON_FILL_START', {
      module: MODULE, batch: RECON_BATCH, prefix: keyPrefix, total: entries.length
    });

    var inserted     = 0;
    var skipped      = 0;
    var failed       = 0;
    var rowsByPeriod = {};

    entries.forEach(function (entry, idx) {
      var pad  = idx < 10 ? '000' : idx < 100 ? '00' : idx < 1000 ? '0' : '';
      var iKey = keyPrefix + pad + idx;
      var periodId = entry[2].substring(0, 7);

      if (!IdempotencyEngine.checkAndMark(iKey)) {
        skipped++;
        return;
      }

      var row = buildRow_(entry, iKey);
      if (!rowsByPeriod[periodId]) rowsByPeriod[periodId] = [];
      rowsByPeriod[periodId].push(row);
      inserted++;
    });

    Object.keys(rowsByPeriod).forEach(function (periodId) {
      var rows = rowsByPeriod[periodId];
      try {
        DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, periodId, MODULE);
        DAL.appendRows(Config.TABLES.FACT_WORK_LOGS, rows, { callerModule: MODULE, periodId: periodId });
      } catch (e) {
        Logger.error('NELSON_RECON_FILL_WRITE_FAILED', {
          module: MODULE, period: periodId, error: e.message
        });
        failed   += rows.length;
        inserted -= rows.length;
      }
    });

    Logger.info('NELSON_RECON_FILL_COMPLETE', {
      module: MODULE, batch: RECON_BATCH, prefix: keyPrefix,
      inserted: inserted, skipped: skipped, failed: failed
    });

    return { inserted: inserted, skipped: skipped, failed: failed };
  }

  // ── Public API ─────────────────────────────────────────────

  return {
    fillMar2H: function (actorEmail) {
      return fill_(actorEmail, MAR_2H_, 'NL-2603-2H-');
    },
    fillApr1H: function (actorEmail) {
      return fill_(actorEmail, APR_1H_, 'NL-2604-1H-');
    },
    fillApr2H: function (actorEmail) {
      return fill_(actorEmail, APR_2H_, 'NL-2604-2H-');
    }
  };

}());

// ── Top-level runners (call from Apps Script editor) ────────────

function runFillNelsonMar2H() {
  console.log('═══════════════════════════════════════════');
  console.log('[NelsonReconFiller_2026] Mar 16-31 2026');
  console.log('  Entries: 13 | Expected hrs: 77.5');
  console.log('═══════════════════════════════════════════');
  try {
    var r = NelsonReconFiller_2026.fillMar2H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

function runFillNelsonApr1H() {
  console.log('═══════════════════════════════════════════');
  console.log('[NelsonReconFiller_2026] Apr 1-15 2026');
  console.log('  Entries: 17 | Expected hrs: 94');
  console.log('═══════════════════════════════════════════');
  try {
    var r = NelsonReconFiller_2026.fillApr1H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

function runFillNelsonApr2H() {
  console.log('═══════════════════════════════════════════');
  console.log('[NelsonReconFiller_2026] Apr 16-30 2026');
  console.log('  Entries: 9 | Expected hrs: 68');
  console.log('═══════════════════════════════════════════');
  try {
    var r = NelsonReconFiller_2026.fillApr2H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

// ── Idempotency key reset (run once only if keys got stuck) ─────

function runClearNelsonMar2HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 12; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_NL-2603-2H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[NelsonReconFiller_2026] Cleared ' + cleared + ' Mar2H idempotency keys.');
}

function runClearNelsonApr1HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 16; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_NL-2604-1H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[NelsonReconFiller_2026] Cleared ' + cleared + ' Apr1H idempotency keys.');
}

function runClearNelsonApr2HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 8; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_NL-2604-2H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[NelsonReconFiller_2026] Cleared ' + cleared + ' Apr2H idempotency keys.');
}
