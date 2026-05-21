// ============================================================
// AlbertaTrussReconFiller_2026.gs — BLC Nexus T12 Migration
// src/12-migration/AlbertaTrussReconFiller_2026.gs
//
// Inserts Alberta Truss work log entries into FACT_WORK_LOGS.
// Source: ALBERTA_2026_03_2H_RECON.md  (8 entries,  20.75 hrs)
//         ALBERTA_2026_04_1H_RECON.md  (7 entries,  23.5 hrs)
//         ALBERTA_2026_04_2H_RECON.md  (18 entries, 53.75 hrs)
// Total: 33 entries, 98 hrs
//
// Batch tag: BATCH-RECON-ALBERTA-2026
// Idempotency keys: AT-2603-2H-NNNN, AT-2604-1H-NNNN, AT-2604-2H-NNNN
//
// Actor code resolutions applied:
//   PS = PRS (Prianka Santra, DESIGNER)
//   DS = DBS (Deb Sen, DESIGNER)
//   SG = SGO (Sarty Gosh, PM)
//
// Notes:
//   - DBS does QC-type work at this client (consistent with Mar–Apr periods)
//     but actor_role remains 'DESIGNER' (system role).
//   - SGO rows are DESIGNER work type (I JOIST Floor 1 Design-Quote).
//   - D4: Two DBS QC rows on 2026-04-21 for 261647 — both written separately.
//   - Alberta Truss only active from 2026-03-16; Jan–Mar 1H periods have no invoices.
//   - 261114-02: hyphen-suffix is part of job number, record as-is.
//   - DBS job 161580 (Apr 4): 16xxxx series — unusual for this client, record as-is.
//
// Run from Apps Script editor (overrides must be enabled):
//   1. runMigrationEnableOverrides()
//   2. runFillAlbertaMar2H()
//   3. runFillAlbertaApr1H()
//   4. runFillAlbertaApr2H()
//   5. runMigrationDisableOverrides()
// ============================================================

var AlbertaTrussReconFiller_2026 = (function () {

  var MODULE      = 'AlbertaReconFiller';
  var RECON_BATCH = 'BATCH-RECON-ALBERTA-2026';

  // Format: [client_code, job_number, work_date, hours, actor_code, actor_role]

  // ── Mar 16–31 2026 (8 entries, 20.75 hrs) ────────────────────

  var MAR_2H_ = [
    // ── PRS Mar 16-31 (3 rows, 11 hrs) ───────────────────────────
    ['ALBERTA TRUSS', '261114',    '2026-03-17', 5,    'PRS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261114',    '2026-03-20', 3,    'PRS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261454',    '2026-03-26', 3,    'PRS', 'DESIGNER'],
    // ── DBS Mar 16-31 (2 rows, 5.25 hrs) — QC work ───────────────
    ['ALBERTA TRUSS', '261114',    '2026-03-20', 4,    'DBS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261454',    '2026-03-27', 1.25, 'DBS', 'DESIGNER'],
    // ── SGO Mar 16-31 (3 rows, 4.5 hrs) — DESIGNER work ─────────
    ['ALBERTA TRUSS', '261114-02', '2026-03-20', 2,    'SGO', 'PM'],
    ['ALBERTA TRUSS', '261459',    '2026-03-31', 1.5,  'SGO', 'PM'],
    ['ALBERTA TRUSS', '261460',    '2026-03-31', 1,    'SGO', 'PM']
  ];

  // ── Apr 1–15 2026 (7 entries, 23.5 hrs) ──────────────────────

  var APR_1H_ = [
    // ── PRS Apr 1-15 (4 rows, 17.25 hrs) ─────────────────────────
    ['ALBERTA TRUSS', '261580', '2026-04-03', 2.75, 'PRS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261580', '2026-04-04', 3.25, 'PRS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261519', '2026-04-09', 5,    'PRS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261519', '2026-04-13', 6.25, 'PRS', 'DESIGNER'],
    // ── DBS Apr 1-15 (2 rows, 3.75 hrs) — QC work ────────────────
    ['ALBERTA TRUSS', '161580', '2026-04-04', 1.5,  'DBS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261519', '2026-04-15', 2.25, 'DBS', 'DESIGNER'],
    // ── SGO Apr 1-15 (1 row, 2.5 hrs) — DESIGNER work ────────────
    ['ALBERTA TRUSS', '261614', '2026-04-06', 2.5,  'SGO', 'PM']
  ];

  // ── Apr 16–30 2026 (18 entries, 53.75 hrs) ───────────────────

  var APR_2H_ = [
    // ── PRS Apr 16-30 (8 rows, 25.5 hrs) ─────────────────────────
    ['ALBERTA TRUSS', '261647', '2026-04-17', 4,    'PRS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261712', '2026-04-20', 3,    'PRS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261891', '2026-04-21', 4.75, 'PRS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261647', '2026-04-23', 1.25, 'PRS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261891', '2026-04-23', 1.25, 'PRS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261712', '2026-04-27', 4,    'PRS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261865', '2026-04-29', 3,    'PRS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261865', '2026-04-30', 4.25, 'PRS', 'DESIGNER'],
    // ── DBS Apr 16-30 (6 rows, 11.25 hrs) — DESIGNER + QC ────────
    ['ALBERTA TRUSS', '261646', '2026-04-17', 4,    'DBS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261647', '2026-04-17', 1.5,  'DBS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261647', '2026-04-21', 1.5,  'DBS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261647', '2026-04-21', 0.75, 'DBS', 'DESIGNER'],  // D4: second QC row same job/date
    ['ALBERTA TRUSS', '261891', '2026-04-21', 0.5,  'DBS', 'DESIGNER'],
    ['ALBERTA TRUSS', '261712', '2026-04-28', 3,    'DBS', 'DESIGNER'],
    // ── SGO Apr 16-30 (4 rows, 17 hrs) — DESIGNER work ───────────
    ['ALBERTA TRUSS', '261715', '2026-04-16', 3.5,  'SGO', 'PM'],
    ['ALBERTA TRUSS', '261953', '2026-04-22', 5,    'SGO', 'PM'],
    ['ALBERTA TRUSS', '262070', '2026-04-28', 4,    'SGO', 'PM'],
    ['ALBERTA TRUSS', '262076', '2026-04-28', 4.5,  'SGO', 'PM']
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

    Logger.info('ALBERTA_RECON_FILL_START', {
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
        Logger.error('ALBERTA_RECON_FILL_WRITE_FAILED', {
          module: MODULE, period: periodId, error: e.message
        });
        failed   += rows.length;
        inserted -= rows.length;
      }
    });

    Logger.info('ALBERTA_RECON_FILL_COMPLETE', {
      module: MODULE, batch: RECON_BATCH, prefix: keyPrefix,
      inserted: inserted, skipped: skipped, failed: failed
    });

    return { inserted: inserted, skipped: skipped, failed: failed };
  }

  // ── Public API ─────────────────────────────────────────────

  return {
    fillMar2H: function (actorEmail) {
      return fill_(actorEmail, MAR_2H_, 'AT-2603-2H-');
    },
    fillApr1H: function (actorEmail) {
      return fill_(actorEmail, APR_1H_, 'AT-2604-1H-');
    },
    fillApr2H: function (actorEmail) {
      return fill_(actorEmail, APR_2H_, 'AT-2604-2H-');
    }
  };

}());

// ── Top-level runners (call from Apps Script editor) ────────────

function runFillAlbertaMar2H() {
  console.log('═══════════════════════════════════════════');
  console.log('[AlbertaTrussReconFiller_2026] Mar 16-31 2026');
  console.log('  Entries: 8 | Expected hrs: 20.75');
  console.log('═══════════════════════════════════════════');
  try {
    var r = AlbertaTrussReconFiller_2026.fillMar2H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

function runFillAlbertaApr1H() {
  console.log('═══════════════════════════════════════════');
  console.log('[AlbertaTrussReconFiller_2026] Apr 1-15 2026');
  console.log('  Entries: 7 | Expected hrs: 23.5');
  console.log('═══════════════════════════════════════════');
  try {
    var r = AlbertaTrussReconFiller_2026.fillApr1H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

function runFillAlbertaApr2H() {
  console.log('═══════════════════════════════════════════');
  console.log('[AlbertaTrussReconFiller_2026] Apr 16-30 2026');
  console.log('  Entries: 18 | Expected hrs: 53.75');
  console.log('═══════════════════════════════════════════');
  try {
    var r = AlbertaTrussReconFiller_2026.fillApr2H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

// ── Idempotency key reset (run once only if keys got stuck) ─────

function runClearAlbertaMar2HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 7; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_AT-2603-2H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[AlbertaTrussReconFiller_2026] Cleared ' + cleared + ' Mar2H idempotency keys.');
}

function runClearAlbertaApr1HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 6; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_AT-2604-1H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[AlbertaTrussReconFiller_2026] Cleared ' + cleared + ' Apr1H idempotency keys.');
}

function runClearAlbertaApr2HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 17; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_AT-2604-2H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[AlbertaTrussReconFiller_2026] Cleared ' + cleared + ' Apr2H idempotency keys.');
}
