// ============================================================
// MatixReconFiller_2026.gs — BLC Nexus T12 Migration
// src/12-migration/MatixReconFiller_2026.gs
//
// Inserts Matix SK work log entries into FACT_WORK_LOGS.
// Source: MATIX_2026_01_1H_RECON.md  (48 entries,  118 hrs)
//         MATIX_2026_01_2H_RECON.md  (48 entries,  127.5 hrs)
//         MATIX_2026_02_1H_RECON.md  (45 entries,  117 hrs)
//         MATIX_2026_02_2H_RECON.md  (65 entries,  142.75 hrs)
//         MATIX_2026_03_1H_RECON.md  (108 entries, 138 hrs)
//         MATIX_2026_03_2H_RECON.md  (78 entries,  181.75 hrs)
//         MATIX_2026_04_1H_RECON.md  (89 entries,  197 hrs)
//         MATIX_2026_04_2H_RECON.md  (73 entries,  183.25 hrs)
// Total: 554 entries, 1205.25 hrs
//
// Batch tag: BATCH-RECON-MATIX-2026
// Idempotency keys: MX-2601-1H-NNNN … MX-2604-2H-NNNN
//
// Actor code resolutions applied:
//   DG = DBG  (Debby Gosh/Ghosh, DESIGNER)
//   DS = DBS  (Deb Sen, DESIGNER)
//   SG = SGO  (Sarty Gosh, PM)
//
// Notes:
//   - Job number format: plain 6-digit numeric, 16xxxx series.
//   - Suffix variants preserved verbatim:
//       160608_Rev, 160669_MAIN, 160669_GARAGE, 160669_Garage,
//       160669_Main Bldg, 160760_GARAGE, 160760_Garage,
//       160792A, 160792B, 160798A, 160798B,
//       160862_GARAGE, 160863_GARAGE, 160864_GARAGE,
//       160862A/B, 160863A/B, 160864A/B.
//   - Mar 2H DG Mar 18 row: PDF showed "E" — confirmed as 160760_GARAGE.
//   - Apr 2H DG Apr 22 row: PDF showed "E" — inferred as 160862_GARAGE.
//   - DG Feb 25: two rows for 160686 same date — both DESIGNER, per D4.
//   - DG Mar 1H: two rows for 160706 on Mar 2 (I JOIST Floor 1 × 2) — per D4.
//   - SGO actor_role = 'PM' regardless of QC work type on invoice.
//   - DBG multi-component rows (I JOIST Floor 1/2/3, Roof Truss) each
//     written as a separate row per D4.
//
// Run from Apps Script editor (overrides must be enabled):
//   1. runMigrationEnableOverrides()
//   2. runFillMatixJan1H()  …  runFillMatixApr2H()
//   3. runMigrationDisableOverrides()
// ============================================================

var MatixReconFiller_2026 = (function () {

  var MODULE      = 'MatixReconFiller';
  var RECON_BATCH = 'BATCH-RECON-MATIX-2026';

  // Format: [client_code, job_number, work_date, hours, actor_code, actor_role]

  // ── Jan 1–15 2026 (48 entries, 118 hrs) ──────────────────────

  var JAN_1H_ = [
    // ── DBG Jan 1-15 (32 rows, 65 hrs) ───────────────────────────
    ['MATIX-SK', '160539', '2026-01-06', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160539', '2026-01-06', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160539', '2026-01-06', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160539', '2026-01-07', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160539', '2026-01-07', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160539', '2026-01-07', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160554', '2026-01-07', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160554', '2026-01-07', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160554', '2026-01-07', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160554', '2026-01-08', 3,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160554', '2026-01-08', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160554', '2026-01-08', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160561', '2026-01-09', 6,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160561', '2026-01-09', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160566', '2026-01-12', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160566', '2026-01-12', 5,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160566', '2026-01-12', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160566', '2026-01-13', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160566', '2026-01-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160566', '2026-01-13', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160571', '2026-01-13', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160571', '2026-01-13', 3,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160571', '2026-01-13', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160571', '2026-01-14', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160571', '2026-01-14', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160571', '2026-01-14', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160569', '2026-01-15', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160569', '2026-01-15', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160569', '2026-01-15', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160572', '2026-01-15', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160572', '2026-01-15', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160572', '2026-01-15', 1,    'DBG', 'DESIGNER'],
    // ── DBS Jan 1-15 (10 rows, 48.5 hrs) ─────────────────────────
    ['MATIX-SK', '160554', '2026-01-07', 8,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160566', '2026-01-10', 9,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160571', '2026-01-12', 6,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160569', '2026-01-12', 2,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160569', '2026-01-13', 3.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160576', '2026-01-13', 4,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160576', '2026-01-14', 7,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160571', '2026-01-14', 2,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160571', '2026-01-15', 4,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160595', '2026-01-15', 3,    'DBS', 'DESIGNER'],
    // ── SGO Jan 1-15 (6 rows, 4.5 hrs) ───────────────────────────
    ['MATIX-SK', '160539', '2026-01-07', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160554', '2026-01-08', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160561', '2026-01-12', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160566', '2026-01-13', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160571', '2026-01-15', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160569', '2026-01-15', 0.75, 'SGO', 'PM']
  ];

  // ── Jan 16–31 2026 (48 entries, 127.5 hrs) ───────────────────

  var JAN_2H_ = [
    // ── DBG Jan 16-31 (34 rows, 81 hrs) ──────────────────────────
    ['MATIX-SK', '160572', '2026-01-19', 3,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160572', '2026-01-19', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160572', '2026-01-19', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160570', '2026-01-20', 8,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160570', '2026-01-21', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160570', '2026-01-21', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160570', '2026-01-21', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160570', '2026-01-21', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160570', '2026-01-22', 8,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160576', '2026-01-26', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160576', '2026-01-26', 5,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160576', '2026-01-26', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160576', '2026-01-27', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160576', '2026-01-27', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160576', '2026-01-27', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160595', '2026-01-27', 5,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160595', '2026-01-27', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160595', '2026-01-27', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160595', '2026-01-28', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160595', '2026-01-28', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160595', '2026-01-28', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160612', '2026-01-28', 5,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160612', '2026-01-28', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160612', '2026-01-28', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160612', '2026-01-29', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160612', '2026-01-29', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160612', '2026-01-29', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160613', '2026-01-29', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160613', '2026-01-29', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160613', '2026-01-29', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160621', '2026-01-29', 5,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160621', '2026-01-29', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160629', '2026-01-30', 6,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160629', '2026-01-30', 1.5,  'DBG', 'DESIGNER'],
    // ── DBS Jan 16-31 (10 rows, 43 hrs) ──────────────────────────
    ['MATIX-SK', '160595',     '2026-01-16', 4.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160599',     '2026-01-16', 4,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160599',     '2026-01-17', 3.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160600',     '2026-01-17', 5,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160607',     '2026-01-19', 3.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160607',     '2026-01-20', 4,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160608',     '2026-01-20', 4.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160612',     '2026-01-21', 8,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160613',     '2026-01-21', 3.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160608_Rev', '2026-01-30', 2.5,  'DBS', 'DESIGNER'],
    // ── SGO Jan 16-31 (4 rows, 3.5 hrs) ──────────────────────────
    ['MATIX-SK', '160572', '2026-01-20', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160570', '2026-01-26', 1.25, 'SGO', 'PM'],
    ['MATIX-SK', '160576', '2026-01-28', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160595', '2026-01-29', 0.75, 'SGO', 'PM']
  ];

  // ── Feb 1–15 2026 (45 entries, 117 hrs) ──────────────────────

  var FEB_1H_ = [
    // ── DBG Feb 1-15 (29 rows, 66.75 hrs) ────────────────────────
    ['MATIX-SK', '160640', '2026-02-05', 7,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160640', '2026-02-05', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160640', '2026-02-06', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160640', '2026-02-06', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160648', '2026-02-07', 5.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160648', '2026-02-07', 1.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160649', '2026-02-09', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160649', '2026-02-09', 3,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160649', '2026-02-09', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160649', '2026-02-10', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160649', '2026-02-10', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160649', '2026-02-10', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160647', '2026-02-10', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160647', '2026-02-10', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160647', '2026-02-10', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160647', '2026-02-11', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160647', '2026-02-11', 2.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160647', '2026-02-11', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160664', '2026-02-11', 3.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160664', '2026-02-11', 3.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160664', '2026-02-11', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160665', '2026-02-12', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160665', '2026-02-12', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160665', '2026-02-12', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160666', '2026-02-12', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160666', '2026-02-12', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160666', '2026-02-12', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160661', '2026-02-13', 6,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160661', '2026-02-13', 1.75, 'DBG', 'DESIGNER'],
    // ── DBS Feb 1-15 (9 rows, 45 hrs) ────────────────────────────
    ['MATIX-SK', '160640', '2026-02-05', 10,   'DBS', 'DESIGNER'],
    ['MATIX-SK', '160648', '2026-02-06', 7,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160649', '2026-02-06', 2.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160649', '2026-02-07', 7,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160664', '2026-02-11', 4,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160665', '2026-02-11', 1,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160666', '2026-02-11', 3,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160668', '2026-02-12', 2,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160661', '2026-02-12', 8.5,  'DBS', 'DESIGNER'],
    // ── SGO Feb 1-15 (7 rows, 5.25 hrs) ──────────────────────────
    ['MATIX-SK', '160648', '2026-02-06', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160640', '2026-02-06', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160649', '2026-02-10', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160647', '2026-02-10', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160664', '2026-02-11', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160666', '2026-02-12', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160661', '2026-02-13', 0.75, 'SGO', 'PM']
  ];

  // ── Feb 16–28 2026 (65 entries, 142.75 hrs) ──────────────────

  var FEB_2H_ = [
    // ── DBG Feb 16-28 (42 rows, 77.75 hrs) ───────────────────────
    ['MATIX-SK', '160668',          '2026-02-16', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160668',          '2026-02-16', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160668',          '2026-02-16', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160672',          '2026-02-18', 6,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160672',          '2026-02-18', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160674',          '2026-02-19', 5.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160674',          '2026-02-19', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160674',          '2026-02-19', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160674',          '2026-02-20', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160674',          '2026-02-20', 0.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160675',          '2026-02-20', 5.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160675',          '2026-02-20', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160675',          '2026-02-20', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160680',          '2026-02-24', 4.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160680',          '2026-02-24', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160680',          '2026-02-24', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160678',          '2026-02-24', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160678',          '2026-02-24', 0.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160678',          '2026-02-24', 0.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160683',          '2026-02-24', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160683',          '2026-02-24', 0.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160683',          '2026-02-24', 0.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160684',          '2026-02-24', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160684',          '2026-02-24', 0.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160684',          '2026-02-24', 0.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160685',          '2026-02-24', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160685',          '2026-02-24', 0.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160685',          '2026-02-24', 0.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160675',          '2026-02-25', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160678',          '2026-02-25', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160680',          '2026-02-25', 0.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160683',          '2026-02-25', 0.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160684',          '2026-02-25', 0.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160685',          '2026-02-25', 0.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160686',          '2026-02-25', 4.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160686',          '2026-02-25', 1.25, 'DBG', 'DESIGNER'],  // D4: second row same job/date
    ['MATIX-SK', '160691',          '2026-02-26', 5.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160691',          '2026-02-26', 6,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160691',          '2026-02-26', 1.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160669_MAIN',     '2026-02-27', 5.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160669_MAIN',     '2026-02-27', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160669_GARAGE',   '2026-02-27', 0.75, 'DBG', 'DESIGNER'],
    // ── DBS Feb 16-28 (13 rows, 59.5 hrs) ────────────────────────
    ['MATIX-SK', '160672',           '2026-02-18', 7,   'DBS', 'DESIGNER'],
    ['MATIX-SK', '160674',           '2026-02-18', 3,   'DBS', 'DESIGNER'],
    ['MATIX-SK', '160674',           '2026-02-19', 6,   'DBS', 'DESIGNER'],
    ['MATIX-SK', '160680',           '2026-02-19', 4,   'DBS', 'DESIGNER'],
    ['MATIX-SK', '160678',           '2026-02-20', 4,   'DBS', 'DESIGNER'],
    ['MATIX-SK', '160683',           '2026-02-20', 1.5, 'DBS', 'DESIGNER'],
    ['MATIX-SK', '160684',           '2026-02-20', 1.5, 'DBS', 'DESIGNER'],
    ['MATIX-SK', '160685',           '2026-02-20', 1,   'DBS', 'DESIGNER'],
    ['MATIX-SK', '160669_Garage',    '2026-02-23', 2,   'DBS', 'DESIGNER'],
    ['MATIX-SK', '160669_Main Bldg', '2026-02-24', 6,   'DBS', 'DESIGNER'],
    ['MATIX-SK', '160686',           '2026-02-24', 5,   'DBS', 'DESIGNER'],
    ['MATIX-SK', '160691',           '2026-02-25', 10,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160706',           '2026-02-26', 8.5, 'DBS', 'DESIGNER'],
    // ── SGO Feb 16-28 (10 rows, 5.5 hrs) ─────────────────────────
    ['MATIX-SK', '160668', '2026-02-17', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160672', '2026-02-19', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160680', '2026-02-24', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160678', '2026-02-24', 0.25, 'SGO', 'PM'],
    ['MATIX-SK', '160683', '2026-02-24', 0.25, 'SGO', 'PM'],
    ['MATIX-SK', '160684', '2026-02-24', 0.25, 'SGO', 'PM'],
    ['MATIX-SK', '160685', '2026-02-24', 0.25, 'SGO', 'PM'],
    ['MATIX-SK', '160675', '2026-02-25', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160691', '2026-02-27', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160669', '2026-02-27', 0.75, 'SGO', 'PM']
  ];

  // ── Mar 1–15 2026 (108 entries, 138 hrs) ─────────────────────

  var MAR_1H_ = [
    // ── DBG Mar 1-15 (60 rows, 68.25 hrs) ────────────────────────
    ['MATIX-SK', '160706', '2026-03-02', 5.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160706', '2026-03-02', 1.75, 'DBG', 'DESIGNER'],  // D4: second row same job/date/type
    ['MATIX-SK', '160718', '2026-03-03', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160718', '2026-03-03', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160718', '2026-03-03', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160719', '2026-03-03', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160719', '2026-03-03', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160719', '2026-03-03', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160721', '2026-03-03', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160721', '2026-03-03', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160721', '2026-03-03', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160722', '2026-03-03', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160722', '2026-03-03', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160722', '2026-03-03', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160723', '2026-03-03', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160723', '2026-03-03', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160723', '2026-03-03', 0.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160730', '2026-03-04', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160730', '2026-03-04', 3.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160730', '2026-03-04', 1.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160733', '2026-03-09', 5.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160733', '2026-03-09', 1.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160736', '2026-03-10', 7,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160736', '2026-03-10', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160739', '2026-03-11', 1.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160739', '2026-03-11', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160739', '2026-03-11', 1.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160740', '2026-03-11', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160740', '2026-03-11', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160740', '2026-03-11', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160741', '2026-03-12', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160741', '2026-03-12', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160741', '2026-03-12', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160742', '2026-03-12', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160742', '2026-03-12', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160742', '2026-03-12', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160743', '2026-03-12', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160743', '2026-03-12', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160743', '2026-03-12', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160744', '2026-03-12', 1.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160744', '2026-03-12', 1.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160744', '2026-03-12', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160745', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160745', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160745', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160746', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160746', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160746', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160747', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160747', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160747', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160748', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160748', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160748', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160749', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160749', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160749', '2026-03-13', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160623', '2026-03-13', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160623', '2026-03-13', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160623', '2026-03-13', 1,    'DBG', 'DESIGNER'],
    // ── DBS Mar 1-15 (15 rows, 51.5 hrs) ─────────────────────────
    ['MATIX-SK', '160718', '2026-03-02', 5,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160719', '2026-03-02', 1,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160721', '2026-03-03', 1,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160722', '2026-03-03', 1,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160723', '2026-03-03', 1,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160730', '2026-03-04', 6.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160733', '2026-03-07', 8,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160736', '2026-03-09', 4,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160736', '2026-03-10', 8,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160739', '2026-03-10', 2,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160739', '2026-03-11', 6,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160740', '2026-03-11', 2,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160741', '2026-03-12', 2,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160742', '2026-03-12', 2,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160743', '2026-03-12', 2,    'DBS', 'DESIGNER'],
    // ── SGO Mar 1-15 (33 rows, 18.25 hrs) ────────────────────────
    ['MATIX-SK', '160718', '2026-03-02', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160719', '2026-03-02', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160706', '2026-03-02', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160721', '2026-03-03', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160722', '2026-03-03', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160723', '2026-03-03', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160718', '2026-03-03', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160719', '2026-03-03', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160721', '2026-03-03', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160722', '2026-03-03', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160723', '2026-03-03', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160730', '2026-03-04', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160730', '2026-03-04', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160733', '2026-03-09', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160733', '2026-03-09', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160736', '2026-03-10', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160736', '2026-03-10', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160739', '2026-03-11', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160739', '2026-03-11', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160740', '2026-03-11', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160740', '2026-03-11', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160741', '2026-03-12', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160742', '2026-03-12', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160743', '2026-03-12', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160741', '2026-03-12', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160742', '2026-03-12', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160743', '2026-03-12', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160744', '2026-03-13', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160745', '2026-03-13', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160746', '2026-03-13', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160747', '2026-03-13', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160748', '2026-03-13', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160749', '2026-03-13', 0.5,  'SGO', 'PM']
  ];

  // ── Mar 16–31 2026 (78 entries, 181.75 hrs) ──────────────────

  var MAR_2H_ = [
    // ── DBG Mar 16-31 (41 rows, 91.75 hrs) ───────────────────────
    ['MATIX-SK', '160623',        '2026-03-16', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160623',        '2026-03-16', 4.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160623',        '2026-03-16', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160759',        '2026-03-17', 4.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160759',        '2026-03-17', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160759',        '2026-03-17', 1.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160760',        '2026-03-18', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160760',        '2026-03-18', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160760',        '2026-03-18', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160760_GARAGE', '2026-03-18', 1,    'DBG', 'DESIGNER'],  // PDF showed "E" — confirmed 160760_GARAGE
    ['MATIX-SK', '160757',        '2026-03-19', 6,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160757',        '2026-03-19', 2.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160769',        '2026-03-20', 5.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160769',        '2026-03-20', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160774',        '2026-03-23', 5,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160774',        '2026-03-23', 6,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160774',        '2026-03-23', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160775',        '2026-03-24', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160775',        '2026-03-24', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160775',        '2026-03-24', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160778',        '2026-03-25', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160778',        '2026-03-25', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160778',        '2026-03-25', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160778',        '2026-03-26', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160778',        '2026-03-26', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160788',        '2026-03-26', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160788',        '2026-03-26', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160788',        '2026-03-26', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160788',        '2026-03-30', 3,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160788',        '2026-03-30', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160788',        '2026-03-30', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160789',        '2026-03-30', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160789',        '2026-03-30', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160789',        '2026-03-31', 5,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160789',        '2026-03-31', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160778',        '2026-03-31', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160778',        '2026-03-31', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160778',        '2026-03-31', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160784',        '2026-03-31', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160784',        '2026-03-31', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160784',        '2026-03-31', 0.5,  'DBG', 'DESIGNER'],
    // ── DBS Mar 16-31 (15 rows, 77.5 hrs) ────────────────────────
    ['MATIX-SK', '160759',        '2026-03-16', 9,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160760',        '2026-03-17', 1.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160760',        '2026-03-18', 4.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160760_Garage', '2026-03-18', 1.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160774',        '2026-03-21', 7,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160775',        '2026-03-23', 8,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160788',        '2026-03-26', 6,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160789',        '2026-03-26', 4,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160789',        '2026-03-27', 7,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160792A',       '2026-03-28', 8.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160792B',       '2026-03-28', 2.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160793',        '2026-03-30', 7.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160794',        '2026-03-30', 3.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160794',        '2026-03-31', 3,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160795',        '2026-03-31', 4,    'DBS', 'DESIGNER'],
    // ── SGO Mar 16-31 (22 rows, 12.5 hrs) ────────────────────────
    ['MATIX-SK', '160623',        '2026-03-17', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160759',        '2026-03-17', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160760_GARAGE', '2026-03-18', 0.25, 'SGO', 'PM'],
    ['MATIX-SK', '160760',        '2026-03-18', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160760',        '2026-03-18', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160759',        '2026-03-18', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160769',        '2026-03-20', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160757',        '2026-03-20', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160774',        '2026-03-24', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160774',        '2026-03-24', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160775',        '2026-03-24', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160775',        '2026-03-24', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160788',        '2026-03-26', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160789',        '2026-03-30', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160792A',       '2026-03-30', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160792B',       '2026-03-30', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160793',        '2026-03-30', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160794',        '2026-03-31', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160795',        '2026-03-31', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160789',        '2026-03-31', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160788',        '2026-03-31', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160778',        '2026-03-31', 0.75, 'SGO', 'PM']
  ];

  // ── Apr 1–15 2026 (89 entries, 197 hrs) ──────────────────────

  var APR_1H_ = [
    // ── DBG Apr 1-15 (48 rows, 100.5 hrs) ────────────────────────
    ['MATIX-SK', '160792', '2026-04-01', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160792', '2026-04-01', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160792', '2026-04-01', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160792', '2026-04-02', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160792', '2026-04-02', 2.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160792', '2026-04-02', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160793', '2026-04-02', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160793', '2026-04-02', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160793', '2026-04-03', 4.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160793', '2026-04-03', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160795', '2026-04-03', 0.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160795', '2026-04-03', 1.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160798', '2026-04-06', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160798', '2026-04-06', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160798', '2026-04-06', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160796', '2026-04-06', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160796', '2026-04-06', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160796', '2026-04-06', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160796', '2026-04-07', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160796', '2026-04-07', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160796', '2026-04-07', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160622', '2026-04-07', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160622', '2026-04-07', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160622', '2026-04-07', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160622', '2026-04-08', 3.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160622', '2026-04-08', 3.75, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160622', '2026-04-08', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160622', '2026-04-09', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160624', '2026-04-09', 4.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160624', '2026-04-09', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160624', '2026-04-09', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160625', '2026-04-10', 5,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160625', '2026-04-10', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160625', '2026-04-10', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160626', '2026-04-13', 4.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160626', '2026-04-13', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160626', '2026-04-13', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160626', '2026-04-14', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160626', '2026-04-14', 5,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160626', '2026-04-14', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160815', '2026-04-14', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160815', '2026-04-14', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160815', '2026-04-14', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160827', '2026-04-14', 5.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160827', '2026-04-14', 2.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160809', '2026-04-15', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160809', '2026-04-15', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160809', '2026-04-15', 1.5,  'DBG', 'DESIGNER'],
    // ── DBS Apr 1-15 (15 rows, 83.25 hrs) ────────────────────────
    ['MATIX-SK', '160796',  '2026-04-01', 9,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160798A', '2026-04-02', 8.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160798B', '2026-04-02', 2.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160622',  '2026-04-03', 8.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160624',  '2026-04-04', 7,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160624',  '2026-04-07', 3.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160819',  '2026-04-08', 2.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160827',  '2026-04-08', 8,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160809',  '2026-04-09', 6,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160839',  '2026-04-10', 3.25, 'DBS', 'DESIGNER'],
    ['MATIX-SK', '160840',  '2026-04-10', 7.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160843',  '2026-04-13', 6.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160850',  '2026-04-14', 6.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160850',  '2026-04-15', 1,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160851',  '2026-04-15', 3,    'DBS', 'DESIGNER'],
    // ── SGO Apr 1-15 (26 rows, 13.25 hrs) ────────────────────────
    ['MATIX-SK', '160784',  '2026-04-01', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160796',  '2026-04-02', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160798A', '2026-04-02', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160798B', '2026-04-02', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160792',  '2026-04-02', 0.75, 'SGO', 'PM'],
    ['MATIX-SK', '160798',  '2026-04-06', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160793',  '2026-04-06', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160795',  '2026-04-06', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160622',  '2026-04-06', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160796',  '2026-04-07', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160624',  '2026-04-07', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160819',  '2026-04-08', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160827',  '2026-04-08', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160622',  '2026-04-09', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160624',  '2026-04-09', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160809',  '2026-04-09', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160625',  '2026-04-10', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160839',  '2026-04-14', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160840',  '2026-04-14', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160843',  '2026-04-14', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160815',  '2026-04-14', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160626',  '2026-04-14', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160827',  '2026-04-15', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160850',  '2026-04-15', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160851',  '2026-04-15', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160809',  '2026-04-15', 0.5,  'SGO', 'PM']
  ];

  // ── Apr 16–30 2026 (73 entries, 183.25 hrs) ──────────────────

  var APR_2H_ = [
    // ── DBG Apr 16-30 (33 rows, 109.75 hrs) ──────────────────────
    ['MATIX-SK', '160840',        '2026-04-16', 5,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160840',        '2026-04-16', 3.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160840',        '2026-04-16', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160843',        '2026-04-17', 6,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160843',        '2026-04-17', 6,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160843',        '2026-04-17', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160850',        '2026-04-20', 5,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160850',        '2026-04-20', 6,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160850',        '2026-04-20', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160851',        '2026-04-21', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160851',        '2026-04-21', 5,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160851',        '2026-04-21', 1,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160862',        '2026-04-22', 6,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160862',        '2026-04-22', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160862_GARAGE', '2026-04-22', 1,    'DBG', 'DESIGNER'],  // PDF showed "E" — inferred 160862_GARAGE
    ['MATIX-SK', '160863',        '2026-04-23', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160863',        '2026-04-23', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160863',        '2026-04-23', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160863_GARAGE', '2026-04-23', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160864',        '2026-04-24', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160864',        '2026-04-24', 4,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160864',        '2026-04-24', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160864_GARAGE', '2026-04-24', 0.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160869',        '2026-04-27', 3.25, 'DBG', 'DESIGNER'],
    ['MATIX-SK', '160869',        '2026-04-27', 3,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160869',        '2026-04-27', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160868',        '2026-04-28', 4.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160868',        '2026-04-28', 1.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160881',        '2026-04-29', 5,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160881',        '2026-04-29', 5.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160881',        '2026-04-29', 2,    'DBG', 'DESIGNER'],
    ['MATIX-SK', '160883',        '2026-04-30', 5.5,  'DBG', 'DESIGNER'],
    ['MATIX-SK', '160883',        '2026-04-30', 2,    'DBG', 'DESIGNER'],
    // ── DBS Apr 16-30 (16 rows, 62.25 hrs) ───────────────────────
    ['MATIX-SK', '160862A', '2026-04-18', 4,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160862B', '2026-04-18', 1.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160863A', '2026-04-18', 4,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160863B', '2026-04-18', 0.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160864A', '2026-04-20', 3,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160864B', '2026-04-20', 0.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160868',  '2026-04-21', 1.75, 'DBS', 'DESIGNER'],
    ['MATIX-SK', '160869',  '2026-04-21', 5,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160875',  '2026-04-22', 10,   'DBS', 'DESIGNER'],
    ['MATIX-SK', '160881',  '2026-04-23', 8,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160883',  '2026-04-24', 8.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160895',  '2026-04-29', 3,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160896',  '2026-04-29', 3,    'DBS', 'DESIGNER'],
    ['MATIX-SK', '160897',  '2026-04-29', 2.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160904',  '2026-04-30', 5.5,  'DBS', 'DESIGNER'],
    ['MATIX-SK', '160905',  '2026-04-30', 1.5,  'DBS', 'DESIGNER'],
    // ── SGO Apr 16-30 (24 rows, 11.25 hrs) ───────────────────────
    ['MATIX-SK', '160840',  '2026-04-16', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160862A', '2026-04-20', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160862B', '2026-04-20', 0.25, 'SGO', 'PM'],
    ['MATIX-SK', '160863A', '2026-04-20', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160863B', '2026-04-20', 0.25, 'SGO', 'PM'],
    ['MATIX-SK', '160864A', '2026-04-20', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160864B', '2026-04-20', 0.25, 'SGO', 'PM'],
    ['MATIX-SK', '160850',  '2026-04-21', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160851',  '2026-04-21', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160868',  '2026-04-21', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160869',  '2026-04-21', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160881',  '2026-04-21', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160862',  '2026-04-22', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160863',  '2026-04-23', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160864',  '2026-04-24', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160883',  '2026-04-27', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160869',  '2026-04-27', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160868',  '2026-04-27', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160895',  '2026-04-29', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160896',  '2026-04-29', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160897',  '2026-04-29', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160881',  '2026-04-29', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160905',  '2026-04-30', 0.5,  'SGO', 'PM'],
    ['MATIX-SK', '160883',  '2026-04-30', 0.5,  'SGO', 'PM']
  ];

  // ── Row builder ──────────────────────────────────────────────

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

  // ── Core filler ──────────────────────────────────────────────

  function fill_(actorEmail, entries, keyPrefix) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    Logger.info('MATIX_RECON_FILL_START', {
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
        Logger.error('MATIX_RECON_FILL_WRITE_FAILED', {
          module: MODULE, period: periodId, error: e.message
        });
        failed   += rows.length;
        inserted -= rows.length;
      }
    });

    Logger.info('MATIX_RECON_FILL_COMPLETE', {
      module: MODULE, batch: RECON_BATCH, prefix: keyPrefix,
      inserted: inserted, skipped: skipped, failed: failed
    });

    return { inserted: inserted, skipped: skipped, failed: failed };
  }

  // ── Public API ────────────────────────────────────────────────

  return {
    fillJan1H: function (actorEmail) { return fill_(actorEmail, JAN_1H_, 'MX-2601-1H-'); },
    fillJan2H: function (actorEmail) { return fill_(actorEmail, JAN_2H_, 'MX-2601-2H-'); },
    fillFeb1H: function (actorEmail) { return fill_(actorEmail, FEB_1H_, 'MX-2602-1H-'); },
    fillFeb2H: function (actorEmail) { return fill_(actorEmail, FEB_2H_, 'MX-2602-2H-'); },
    fillMar1H: function (actorEmail) { return fill_(actorEmail, MAR_1H_, 'MX-2603-1H-'); },
    fillMar2H: function (actorEmail) { return fill_(actorEmail, MAR_2H_, 'MX-2603-2H-'); },
    fillApr1H: function (actorEmail) { return fill_(actorEmail, APR_1H_, 'MX-2604-1H-'); },
    fillApr2H: function (actorEmail) { return fill_(actorEmail, APR_2H_, 'MX-2604-2H-'); }
  };

}());

// ── Top-level runners (call from Apps Script editor) ────────────

function runFillMatixJan1H() {
  console.log('═══════════════════════════════════════════');
  console.log('[MatixReconFiller_2026] Jan 1-15 2026');
  console.log('  Entries: 48 | Expected hrs: 118');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MatixReconFiller_2026.fillJan1H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

function runFillMatixJan2H() {
  console.log('═══════════════════════════════════════════');
  console.log('[MatixReconFiller_2026] Jan 16-31 2026');
  console.log('  Entries: 48 | Expected hrs: 127.5');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MatixReconFiller_2026.fillJan2H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

function runFillMatixFeb1H() {
  console.log('═══════════════════════════════════════════');
  console.log('[MatixReconFiller_2026] Feb 1-15 2026');
  console.log('  Entries: 45 | Expected hrs: 117');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MatixReconFiller_2026.fillFeb1H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

function runFillMatixFeb2H() {
  console.log('═══════════════════════════════════════════');
  console.log('[MatixReconFiller_2026] Feb 16-28 2026');
  console.log('  Entries: 65 | Expected hrs: 142.75');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MatixReconFiller_2026.fillFeb2H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

function runFillMatixMar1H() {
  console.log('═══════════════════════════════════════════');
  console.log('[MatixReconFiller_2026] Mar 1-15 2026');
  console.log('  Entries: 108 | Expected hrs: 138');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MatixReconFiller_2026.fillMar1H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

function runFillMatixMar2H() {
  console.log('═══════════════════════════════════════════');
  console.log('[MatixReconFiller_2026] Mar 16-31 2026');
  console.log('  Entries: 78 | Expected hrs: 181.75');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MatixReconFiller_2026.fillMar2H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

function runFillMatixApr1H() {
  console.log('═══════════════════════════════════════════');
  console.log('[MatixReconFiller_2026] Apr 1-15 2026');
  console.log('  Entries: 89 | Expected hrs: 197');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MatixReconFiller_2026.fillApr1H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

function runFillMatixApr2H() {
  console.log('═══════════════════════════════════════════');
  console.log('[MatixReconFiller_2026] Apr 16-30 2026');
  console.log('  Entries: 73 | Expected hrs: 183.25');
  console.log('═══════════════════════════════════════════');
  try {
    var r = MatixReconFiller_2026.fillApr2H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

// ── Idempotency key reset (run once only if keys got stuck) ─────

function runClearMatixJan1HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 47; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_MX-2601-1H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[MatixReconFiller_2026] Cleared ' + cleared + ' Jan1H idempotency keys.');
}

function runClearMatixJan2HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 47; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_MX-2601-2H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[MatixReconFiller_2026] Cleared ' + cleared + ' Jan2H idempotency keys.');
}

function runClearMatixFeb1HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 44; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_MX-2602-1H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[MatixReconFiller_2026] Cleared ' + cleared + ' Feb1H idempotency keys.');
}

function runClearMatixFeb2HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 64; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_MX-2602-2H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[MatixReconFiller_2026] Cleared ' + cleared + ' Feb2H idempotency keys.');
}

function runClearMatixMar1HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 107; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_MX-2603-1H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[MatixReconFiller_2026] Cleared ' + cleared + ' Mar1H idempotency keys.');
}

function runClearMatixMar2HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 77; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_MX-2603-2H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[MatixReconFiller_2026] Cleared ' + cleared + ' Mar2H idempotency keys.');
}

function runClearMatixApr1HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 88; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_MX-2604-1H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[MatixReconFiller_2026] Cleared ' + cleared + ' Apr1H idempotency keys.');
}

function runClearMatixApr2HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 72; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_MX-2604-2H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[MatixReconFiller_2026] Cleared ' + cleared + ' Apr2H idempotency keys.');
}
