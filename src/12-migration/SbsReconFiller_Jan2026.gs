// ============================================================
// SbsReconFiller_Jan2026.gs — BLC Nexus T12 Migration
// src/12-migration/SbsReconFiller_Jan2026.gs
//
// Inserts SBS January 2026 work log entries into FACT_WORK_LOGS.
// Source: reconciliation reports SBS_2026_01_1H_RECON.md (107 entries, 293 hrs)
//                                SBS_2026_01_2H_RECON.md (181 entries, 578.75 hrs)
// Total: 288 entries, 871.75 hours
//
// Batch tag: BATCH-RECON-SBS-2601
// Idempotency keys: SBS-2601-1H-NNNN (Jan 1H), SBS-2601-2H-NNNN (Jan 2H)
//
// Decisions applied:
//   D1: SKD (invoice) = SDA (system) — Sandy Das = Samar Kumar Das
//   D2: "job assign & help" → job# SBS-ADMIN-2026-01, actor_role=PM
//   D3/D4: All duplicate rows written separately as they appear on the invoice
//   D5: RKU actor_role = 'QC' (paid for QC hours, no supervisor bonus)
//   D6: BCH job# 2601-038 (17-01) normalized to 2601-0038
//
// Run from Apps Script editor (overrides must be enabled):
//   1. runMigrationEnableOverrides()
//   2. runFillSbsJan1H()
//   3. runFillSbsJan2H()
//   4. runMigrationDisableOverrides()
// ============================================================

var SbsReconFiller_Jan2026 = (function () {

  var MODULE     = 'SbsReconFiller_Jan2026';
  var RECON_BATCH = 'BATCH-RECON-SBS-2601';

  // Format: [client_code, job_number, work_date, hours, actor_code, actor_role]

  // ── January 1–15 2026 (107 entries, 293 hrs) ─────────────────

  var JAN_1H_ = [
    // ── SGO Jan 1-15 (8.75 hrs) ───────────────────────────────
    ['SBS', '2501-0502',         '2026-01-07', 3,    'SGO', 'PM'],
    ['SBS', '2512-9641',         '2026-01-12', 1.5,  'SGO', 'PM'],
    ['SBS', '2601-0198',         '2026-01-13', 1.5,  'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-13', 0.75, 'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-14', 1,    'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-15', 1,    'SGO', 'PM'],
    // ── BCH Jan 1-15 (24.5 hrs) ───────────────────────────────
    ['SBS', '2512-9521', '2026-01-02', 1.5, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2503-3460', '2026-01-07', 3,   'BCH', 'TEAM_LEAD'],
    ['SBS', '2501-0469', '2026-01-08', 2,   'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0113', '2026-01-08', 1,   'BCH', 'TEAM_LEAD'],
    ['SBS', '2512-9411', '2026-01-10', 6,   'BCH', 'TEAM_LEAD'],
    ['SBS', '2512-9411', '2026-01-12', 5,   'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0386', '2026-01-15', 6,   'BCH', 'TEAM_LEAD'],
    // ── SDA Jan 1-15 (73.5 hrs) ───────────────────────────────
    ['SBS', '2512-9195', '2026-01-01', 4.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9195', '2026-01-02', 5.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2503-4005', '2026-01-02', 2.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9656', '2026-01-03', 1,    'SDA', 'TEAM_LEAD'],
    ['SBS', '2503-3616', '2026-01-05', 2.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9195', '2026-01-05', 2.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2509-4562', '2026-01-05', 2.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2501-0502', '2026-01-07', 3.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9641', '2026-01-07', 1.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9641', '2026-01-08', 8.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9641', '2026-01-09', 8.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9641', '2026-01-12', 2.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9411', '2026-01-12', 5.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9411', '2026-01-13', 9.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0292', '2026-01-14', 2.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0382', '2026-01-14', 2.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0260', '2026-01-15', 1.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9411', '2026-01-15', 5.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0207', '2026-01-15', 1.75, 'SDA', 'TEAM_LEAD'],
    // ── SVN Jan 1-15 (37.5 hrs) ───────────────────────────────
    ['SBS', '2503-3616-H', '2026-01-01', 4,   'SVN', 'TEAM_LEAD'],
    ['SBS', '2503-3616-H', '2026-01-02', 3,   'SVN', 'TEAM_LEAD'],
    ['SBS', '2503-3616-I', '2026-01-02', 6,   'SVN', 'TEAM_LEAD'],
    ['SBS', '2503-3616-I', '2026-01-04', 5,   'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0207-A', '2026-01-13', 4,   'SVN', 'TEAM_LEAD'],
    ['SBS', '2510-6647-A', '2026-01-13', 2,   'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0207-A', '2026-01-14', 8,   'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0207-A', '2026-01-15', 4,   'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0246-A', '2026-01-15', 1.5, 'SVN', 'TEAM_LEAD'],
    // ── RKU Jan 1-15 (34.5 hrs) — role=QC (D5) ───────────────
    ['SBS', '2503-3460-C', '2026-01-05', 1.5,  'RKU', 'QC'],
    ['SBS', '2512-9748-A', '2026-01-05', 1.75, 'RKU', 'QC'],
    ['SBS', '2503-3460-C', '2026-01-06', 2.5,  'RKU', 'QC'],
    ['SBS', '2601-0013-A', '2026-01-06', 1,    'RKU', 'QC'],
    ['SBS', '2503-3460-D', '2026-01-06', 3,    'RKU', 'QC'],
    ['SBS', '2506-3460-B', '2026-01-07', 2.5,  'RKU', 'QC'],
    ['SBS', '2601-0010-A', '2026-01-07', 1.25, 'RKU', 'QC'],
    ['SBS', 'M00181',      '2026-01-07', 0.75, 'RKU', 'QC'],
    ['SBS', '2503-3460-H', '2026-01-07', 2,    'RKU', 'QC'],
    ['SBS', '2601-0113-A', '2026-01-08', 2,    'RKU', 'QC'],
    ['SBS', '2601-0010-A', '2026-01-07', 1,    'RKU', 'QC'],  // second entry same date (D4)
    ['SBS', '2512-8822',   '2026-01-12', 0.5,  'RKU', 'QC'],
    ['SBS', '2502-1842',   '2026-01-12', 1.75, 'RKU', 'QC'],
    ['SBS', '2601-0362',   '2026-01-14', 5.5,  'RKU', 'QC'],
    ['SBS', '2601-0362',   '2026-01-15', 5,    'RKU', 'QC'],
    ['SBS', '2506-0431',   '2026-01-15', 2,    'RKU', 'QC'],
    ['SBS', '2506-0430',   '2026-01-15', 0.5,  'RKU', 'QC'],
    // ── ABB Jan 1-15 (15.5 hrs) ───────────────────────────────
    ['SBS', 'M00181',    '2026-01-07', 1.5, 'ABB', 'DESIGNER'],
    ['SBS', '2601-0010', '2026-01-09', 2,   'ABB', 'DESIGNER'],
    ['SBS', '2510-7410', '2026-01-09', 1.5, 'ABB', 'DESIGNER'],
    ['SBS', '2601-0198', '2026-01-12', 2.5, 'ABB', 'DESIGNER'],
    ['SBS', '2601-0292', '2026-01-13', 6.5, 'ABB', 'DESIGNER'],
    ['SBS', '2601-0246', '2026-01-15', 1.5, 'ABB', 'DESIGNER'],
    // ── SYR Jan 1-15 (22.75 hrs) ──────────────────────────────
    ['SBS', '2512-9748-A', '2026-01-02', 5,    'SYR', 'DESIGNER'],
    ['SBS', '2512-9748-A', '2026-01-03', 2,    'SYR', 'DESIGNER'],
    ['SBS', '2512-9748-A', '2026-01-05', 2,    'SYR', 'DESIGNER'],
    ['SBS', '2503-4005-K', '2026-01-05', 1,    'SYR', 'DESIGNER'],
    ['SBS', '2503-4005-E', '2026-01-05', 0.5,  'SYR', 'DESIGNER'],
    ['SBS', '2503-4005-H', '2026-01-05', 0.5,  'SYR', 'DESIGNER'],
    ['SBS', '2503-4005-A', '2026-01-05', 0.5,  'SYR', 'DESIGNER'],
    ['SBS', '2601-0013-A', '2026-01-06', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', '2510-7409-A', '2026-01-09', 1.75, 'SYR', 'DESIGNER'],
    ['SBS', '2601-0222-A', '2026-01-15', 3,    'SYR', 'DESIGNER'],
    ['SBS', '2601-0223-A', '2026-01-15', 3,    'SYR', 'DESIGNER'],
    ['SBS', '2503-4005-F', '2026-01-15', 1,    'SYR', 'DESIGNER'],
    ['SBS', '2503-4005-G', '2026-01-15', 1,    'SYR', 'DESIGNER'],
    // ── PBG Jan 1-15 (5.5 hrs) ────────────────────────────────
    ['SBS', '2512-9656', '2026-01-02', 4,   'PBG', 'TEAM_LEAD'],
    ['SBS', '2601-0260', '2026-01-14', 1.5, 'PBG', 'TEAM_LEAD'],
    // ── BSG Jan 1-15 (70.5 hrs, D4: all same-day rows written separately) ──
    ['SBS', '2509-4562-D', '2026-01-01', 1.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-D', '2026-01-01', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-D', '2026-01-01', 1.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-D', '2026-01-01', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-D', '2026-01-02', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-D', '2026-01-02', 2.25, 'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-G', '2026-01-02', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-G', '2026-01-05', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-G', '2026-01-05', 2.25, 'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-G', '2026-01-05', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-G', '2026-01-06', 1.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-G', '2026-01-06', 1.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-A', '2026-01-06', 1.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-A', '2026-01-06', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-A', '2026-01-07', 1.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-A', '2026-01-07', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-A', '2026-01-07', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-A', '2026-01-07', 2.25, 'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-C', '2026-01-08', 2,    'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-H', '2026-01-08', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-H', '2026-01-08', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-H', '2026-01-09', 2.25, 'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-H', '2026-01-09', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-H', '2026-01-09', 1.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4562-H', '2026-01-09', 1.5,  'BSG', 'DESIGNER'],
    ['SBS', '2601-0204-A', '2026-01-12', 2,    'BSG', 'DESIGNER'],
    ['SBS', '2601-0364-A', '2026-01-14', 7.5,  'BSG', 'DESIGNER'],
    ['SBS', '2601-0364-A', '2026-01-15', 8,    'BSG', 'DESIGNER']
  ];

  // ── January 16–31 2026 (181 entries, 578.75 hrs) ─────────────

  var JAN_2H_ = [
    // ── SGO Jan 16-31 (29 hrs) ────────────────────────────────
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-16', 1.5, 'SGO', 'PM'],
    ['SBS', '2601-0382',         '2026-01-16', 2,   'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-19', 1.5, 'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-20', 1.5, 'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-21', 1.5, 'SGO', 'PM'],
    ['SBS', '2601-0549',         '2026-01-21', 2,   'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-22', 1.5, 'SGO', 'PM'],
    ['SBS', '2601-0163',         '2026-01-22', 2.5, 'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-23', 1.5, 'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-26', 1.5, 'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-27', 3,   'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-28', 3,   'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-29', 3,   'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-01', '2026-01-30', 2,   'SGO', 'PM'],
    ['SBS', '2601-0673',         '2026-01-30', 1,   'SGO', 'PM'],
    // ── BCH Jan 16-31 (60 hrs) ────────────────────────────────
    ['SBS', '2506-0430', '2026-01-17', 1.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0038', '2026-01-17', 2,    'BCH', 'TEAM_LEAD'],  // D6: normalized from 2601-038
    ['SBS', '2601-0222', '2026-01-19', 2,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0163', '2026-01-19', 4,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0163', '2026-01-20', 10,   'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0633', '2026-01-21', 0.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0163', '2026-01-21', 4,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0161', '2026-01-21', 2,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0161', '2026-01-22', 8,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0358', '2026-01-23', 2,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0676', '2026-01-23', 1.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0673', '2026-01-24', 5,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0673', '2026-01-26', 1,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0667', '2026-01-26', 1.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0650', '2026-01-27', 1.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0637', '2026-01-28', 1.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0555', '2026-01-28', 2,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0673', '2026-01-29', 7,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0673', '2026-01-30', 3,    'BCH', 'TEAM_LEAD'],
    // ── RKU Jan 16-31 (58.5 hrs) — role=QC (D5) ──────────────
    ['SBS', '2512-8644-B', '2026-01-19', 0.75, 'RKU', 'QC'],
    ['SBS', '2512-8644-D', '2026-01-19', 0.5,  'RKU', 'QC'],
    ['SBS', '2512-8644-E', '2026-01-19', 0.75, 'RKU', 'QC'],
    ['SBS', '2512-8644-F', '2026-01-19', 0.75, 'RKU', 'QC'],
    ['SBS', '2511-8323-A', '2026-01-19', 0.75, 'RKU', 'QC'],
    ['SBS', '2511-8323-C', '2026-01-19', 0.5,  'RKU', 'QC'],
    ['SBS', '2601-0335-A', '2026-01-19', 0.5,  'RKU', 'QC'],
    ['SBS', '2501-0469-B', '2026-01-21', 2,    'RKU', 'QC'],
    ['SBS', '2601-0633',   '2026-01-21', 2,    'RKU', 'QC'],
    ['SBS', '2601-0684',   '2026-01-21', 2,    'RKU', 'QC'],
    ['SBS', '2601-0163',   '2026-01-21', 1.5,  'RKU', 'QC'],
    ['SBS', '2601-0475',   '2026-01-22', 1,    'RKU', 'QC'],
    ['SBS', '2601-0475',   '2026-01-22', 0.75, 'RKU', 'QC'],
    ['SBS', '2601-0163',   '2026-01-22', 2,    'RKU', 'QC'],
    ['SBS', '2601-0163',   '2026-01-22', 0.5,  'RKU', 'QC'],
    ['SBS', '2601-0684',   '2026-01-22', 3,    'RKU', 'QC'],
    ['SBS', '2601-0358',   '2026-01-23', 6,    'RKU', 'QC'],
    ['SBS', '2601-0650',   '2026-01-26', 3.5,  'RKU', 'QC'],
    ['SBS', '2501-1012',   '2026-01-26', 0.5,  'RKU', 'QC'],
    ['SBS', '2601-0555',   '2026-01-26', 0.5,  'RKU', 'QC'],
    ['SBS', '2601-0555',   '2026-01-27', 5.5,  'RKU', 'QC'],
    ['SBS', '2601-0635',   '2026-01-28', 1.75, 'RKU', 'QC'],
    ['SBS', '2601-0636',   '2026-01-28', 1.5,  'RKU', 'QC'],
    ['SBS', '2601-0603',   '2026-01-28', 2.5,  'RKU', 'QC'],
    ['SBS', '2601-0820',   '2026-01-29', 3.5,  'RKU', 'QC'],
    ['SBS', '2601-0824',   '2026-01-30', 3.5,  'RKU', 'QC'],
    ['SBS', '2601-0555',   '2026-01-30', 1.5,  'RKU', 'QC'],
    ['SBS', '2601-1056',   '2026-01-31', 1,    'RKU', 'QC'],
    ['SBS', '2601-1056',   '2026-01-31', 1,    'RKU', 'QC'],  // second row same date (D4)
    ['SBS', '2601-0825',   '2026-01-31', 3.5,  'RKU', 'QC'],
    ['SBS', '2601-0826',   '2026-01-31', 3.5,  'RKU', 'QC'],
    // ── SDA Jan 16-31 (83.5 hrs) ──────────────────────────────
    ['SBS', '2601-0364',   '2026-01-16', 1.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0382',   '2026-01-16', 3.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2506-0431',   '2026-01-16', 1.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2503-4005',   '2026-01-16', 1.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0382',   '2026-01-17', 0.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0418',   '2026-01-19', 1.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0418',   '2026-01-19', 0.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0060',   '2026-01-19', 1.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0549',   '2026-01-20', 6.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0395',   '2026-01-20', 1.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0639',   '2026-01-21', 1.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0549',   '2026-01-21', 5.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0635',   '2026-01-21', 1.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0393',   '2026-01-22', 1.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0635',   '2026-01-22', 6.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0046-C', '2026-01-24', 1.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0049-C', '2026-01-24', 1.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0636',   '2026-01-26', 3.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0637',   '2026-01-26', 4.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0689',   '2026-01-27', 1.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0637',   '2026-01-27', 2,    'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0635',   '2026-01-27', 2.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0636',   '2026-01-27', 2.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0920',   '2026-01-28', 4.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0635',   '2026-01-28', 1.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0636',   '2026-01-28', 1.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0049',   '2026-01-28', 1,    'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9195',   '2026-01-29', 8.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0871',   '2026-01-30', 1.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0847',   '2026-01-30', 1.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0637',   '2026-01-30', 1,    'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0920',   '2026-01-30', 2.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0919',   '2026-01-30', 2.75, 'SDA', 'TEAM_LEAD'],
    // ── SVN Jan 16-31 (62.5 hrs) ──────────────────────────────
    ['SBS', '2601-0060-A', '2026-01-16', 8,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0060-A', '2026-01-17', 4,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0060-A', '2026-01-19', 9.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0639-A', '2026-01-20', 2,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0393-D', '2026-01-21', 3,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0393-E', '2026-01-21', 3,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0478-A', '2026-01-22', 2,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0393-D', '2026-01-22', 2,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0393-E', '2026-01-22', 2,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0847-A', '2026-01-28', 8,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0847-A', '2026-01-29', 8.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0915-A', '2026-01-29', 1,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0985-A', '2026-01-30', 1.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0915-A', '2026-01-30', 8,    'SVN', 'TEAM_LEAD'],
    // ── PBG Jan 16-31 (30 hrs) ────────────────────────────────
    ['SBS', '2601-0418', '2026-01-19', 8, 'PBG', 'TEAM_LEAD'],
    ['SBS', '2601-0395', '2026-01-20', 8, 'PBG', 'TEAM_LEAD'],
    ['SBS', '2601-0689', '2026-01-27', 8, 'PBG', 'TEAM_LEAD'],
    ['SBS', '2601-0871', '2026-01-29', 4, 'PBG', 'TEAM_LEAD'],
    ['SBS', '2601-0913', '2026-01-30', 2, 'PBG', 'TEAM_LEAD'],
    // ── BSG Jan 16-31 (64.25 hrs) ─────────────────────────────
    ['SBS', '2601-0362-A', '2026-01-16', 0.5,  'BSG', 'DESIGNER'],
    ['SBS', '2601-0362-A', '2026-01-16', 0.5,  'BSG', 'DESIGNER'],
    ['SBS', '2512-9236-A', '2026-01-20', 2.25, 'BSG', 'DESIGNER'],
    ['SBS', '2601-0392-E', '2026-01-20', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2601-0392-E', '2026-01-20', 2.25, 'BSG', 'DESIGNER'],
    ['SBS', '2601-0392-E', '2026-01-20', 3.5,  'BSG', 'DESIGNER'],
    ['SBS', '2601-0392-E', '2026-01-21', 1.5,  'BSG', 'DESIGNER'],
    ['SBS', '2601-0392-D', '2026-01-21', 4.25, 'BSG', 'DESIGNER'],
    ['SBS', '2601-0047-C', '2026-01-22', 8,    'BSG', 'DESIGNER'],
    ['SBS', '2601-0047-C', '2026-01-23', 6.5,  'BSG', 'DESIGNER'],
    ['SBS', '2601-0805-A', '2026-01-26', 2,    'BSG', 'DESIGNER'],
    ['SBS', '2601-0805-A', '2026-01-27', 5.5,  'BSG', 'DESIGNER'],
    ['SBS', '2601-0805-A', '2026-01-28', 8.5,  'BSG', 'DESIGNER'],
    ['SBS', '2601-0805-A', '2026-01-29', 7,    'BSG', 'DESIGNER'],
    ['SBS', '2601-0805-A', '2026-01-30', 9.5,  'BSG', 'DESIGNER'],
    // ── ABB Jan 16-31 (98.5 hrs) ──────────────────────────────
    ['SBS', '2601-0478',   '2026-01-19', 7.5,  'ABB', 'DESIGNER'],
    ['SBS', '2601-0475-B', '2026-01-19', 1,    'ABB', 'DESIGNER'],
    ['SBS', '2601-0475-B', '2026-01-21', 4,    'ABB', 'DESIGNER'],
    ['SBS', '2601-0475-A', '2026-01-21', 4,    'ABB', 'DESIGNER'],
    ['SBS', '2601-0046-C', '2026-01-21', 3.5,  'ABB', 'DESIGNER'],
    ['SBS', '2601-0046-C', '2026-01-22', 10,   'ABB', 'DESIGNER'],
    ['SBS', '2601-0050-C', '2026-01-23', 8,    'ABB', 'DESIGNER'],
    ['SBS', '2601-0050-C', '2026-01-26', 1.5,  'ABB', 'DESIGNER'],
    ['SBS', '2601-0048',   '2026-01-26', 6,    'ABB', 'DESIGNER'],
    ['SBS', '2601-0605',   '2026-01-26', 2,    'ABB', 'DESIGNER'],
    ['SBS', '2601-0605',   '2026-01-27', 11,   'ABB', 'DESIGNER'],
    ['SBS', '2601-0605',   '2026-01-28', 10,   'ABB', 'DESIGNER'],
    ['SBS', '2601-0985',   '2026-01-29', 9,    'ABB', 'DESIGNER'],
    ['SBS', '2601-0998',   '2026-01-29', 1,    'ABB', 'DESIGNER'],
    ['SBS', '2601-0998',   '2026-01-30', 10,   'ABB', 'DESIGNER'],
    ['SBS', '2601-0998',   '2026-01-31', 2,    'ABB', 'DESIGNER'],
    ['SBS', '2601-0998',   '2026-01-31', 8,    'ABB', 'DESIGNER'],
    // ── SYR Jan 16-31 (92.5 hrs) ──────────────────────────────
    ['SBS', '2503-4005-I', '2026-01-16', 1,    'SYR', 'DESIGNER'],
    ['SBS', '2503-4005-J', '2026-01-16', 1,    'SYR', 'DESIGNER'],
    ['SBS', '2503-4005-F', '2026-01-19', 0.25, 'SYR', 'DESIGNER'],
    ['SBS', '2503-4005-G', '2026-01-19', 0.25, 'SYR', 'DESIGNER'],
    ['SBS', '2503-4005-I', '2026-01-19', 0.25, 'SYR', 'DESIGNER'],
    ['SBS', '2503-4005-J', '2026-01-19', 0.25, 'SYR', 'DESIGNER'],
    ['SBS', '2601-0222-A', '2026-01-19', 3.5,  'SYR', 'DESIGNER'],
    ['SBS', '2601-0223-A', '2026-01-19', 4,    'SYR', 'DESIGNER'],
    ['SBS', '2601-0222-A', '2026-01-20', 3,    'SYR', 'DESIGNER'],
    ['SBS', '2601-0223-A', '2026-01-20', 4,    'SYR', 'DESIGNER'],
    ['SBS', '2601-0578-A', '2026-01-20', 2,    'SYR', 'DESIGNER'],
    ['SBS', '2601-0578-A', '2026-01-21', 8,    'SYR', 'DESIGNER'],
    ['SBS', '2601-0049-C', '2026-01-22', 8,    'SYR', 'DESIGNER'],
    ['SBS', '2601-0049-C', '2026-01-23', 4,    'SYR', 'DESIGNER'],
    ['SBS', '2601-0049-C', '2026-01-24', 4,    'SYR', 'DESIGNER'],
    ['SBS', '2601-0049-C', '2026-01-26', 6,    'SYR', 'DESIGNER'],
    ['SBS', '2601-0603-A', '2026-01-26', 2,    'SYR', 'DESIGNER'],
    ['SBS', '2601-0603-A', '2026-01-27', 8,    'SYR', 'DESIGNER'],
    ['SBS', '2601-0603-A', '2026-01-28', 6,    'SYR', 'DESIGNER'],
    ['SBS', '2506-0664-A', '2026-01-28', 2,    'SYR', 'DESIGNER'],
    ['SBS', '2506-0666-A', '2026-01-29', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', '2506-0668-A', '2026-01-29', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', '2601-0959-A', '2026-01-29', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', '2601-0961-A', '2026-01-29', 1,    'SYR', 'DESIGNER'],
    ['SBS', 'M00098-A',    '2026-01-29', 2,    'SYR', 'DESIGNER'],
    ['SBS', 'M00098-A',    '2026-01-30', 1,    'SYR', 'DESIGNER'],
    ['SBS', '2501-0042-A', '2026-01-30', 2.5,  'SYR', 'DESIGNER'],
    ['SBS', '2501-0756-A', '2026-01-30', 2,    'SYR', 'DESIGNER'],
    ['SBS', '2412-1402-A', '2026-01-30', 3.5,  'SYR', 'DESIGNER'],
    ['SBS', '2601-1056-A', '2026-01-31', 3.5,  'SYR', 'DESIGNER'],
    ['SBS', '2601-0959-A', '2026-01-31', 2,    'SYR', 'DESIGNER'],
    ['SBS', '2506-0666-A', '2026-01-31', 3,    'SYR', 'DESIGNER']
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

    Logger.info('SBS_RECON_FILL_START', {
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
        Logger.error('SBS_RECON_FILL_WRITE_FAILED', {
          module: MODULE, period: periodId, error: e.message
        });
        failed   += rows.length;
        inserted -= rows.length;
      }
    });

    Logger.info('SBS_RECON_FILL_COMPLETE', {
      module: MODULE, batch: RECON_BATCH, prefix: keyPrefix,
      inserted: inserted, skipped: skipped, failed: failed
    });

    return { inserted: inserted, skipped: skipped, failed: failed };
  }

  // ── Public API ─────────────────────────────────────────────

  return {
    /**
     * Inserts SBS Jan 1–15 2026 entries (107 rows, 293 hrs).
     * Idempotent — already-inserted rows are skipped.
     * @param {string} actorEmail
     */
    fillJan1H: function (actorEmail) {
      return fill_(actorEmail, JAN_1H_, 'SBS-2601-1H-');
    },

    /**
     * Inserts SBS Jan 16–31 2026 entries (181 rows, 578.75 hrs).
     * Idempotent — already-inserted rows are skipped.
     * @param {string} actorEmail
     */
    fillJan2H: function (actorEmail) {
      return fill_(actorEmail, JAN_2H_, 'SBS-2601-2H-');
    }
  };

}());

// ── Top-level runners (call from Apps Script editor) ────────────

/**
 * Inserts SBS Jan 1–15 2026 into FACT_WORK_LOGS.
 * Run AFTER runMigrationEnableOverrides().
 * Safe to re-run — idempotent.
 */
function runFillSbsJan1H() {
  console.log('═══════════════════════════════════════════');
  console.log('[SbsReconFiller_Jan2026] Jan 1-15 2026');
  console.log('  Entries: 107 | Expected hrs: 293');
  console.log('═══════════════════════════════════════════');
  try {
    var r = SbsReconFiller_Jan2026.fillJan1H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

/**
 * Inserts SBS Jan 16–31 2026 into FACT_WORK_LOGS.
 * Run AFTER runMigrationEnableOverrides().
 * Safe to re-run — idempotent.
 */
function runFillSbsJan2H() {
  console.log('═══════════════════════════════════════════');
  console.log('[SbsReconFiller_Jan2026] Jan 16-31 2026');
  console.log('  Entries: 181 | Expected hrs: 578.75');
  console.log('═══════════════════════════════════════════');
  try {
    var r = SbsReconFiller_Jan2026.fillJan2H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

// ── Idempotency key reset (run once only if keys got stuck) ─────
function runClearSbsJan1HKeys() {
  var props   = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 106; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : '0';
    var key = 'IDEM_SBS-2601-1H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[SbsReconFiller_Jan2026] Cleared ' + cleared + ' Jan1H idempotency keys.');
}

function runClearSbsJan2HKeys() {
  var props   = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 180; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : '0';
    var key = 'IDEM_SBS-2601-2H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[SbsReconFiller_Jan2026] Cleared ' + cleared + ' Jan2H idempotency keys.');
}
