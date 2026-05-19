// ============================================================
// SbsReconFiller_Mar2026.gs — BLC Nexus T12 Migration
// src/12-migration/SbsReconFiller_Mar2026.gs
//
// Inserts SBS March 1–15 2026 work log entries into FACT_WORK_LOGS.
// Source: SBS_2026_03_1H_RECON.md (381 entries, 642 hrs)
//
// Batch tag: BATCH-RECON-SBS-2603
// Idempotency keys: SBS-2603-1H-NNNN
//
// Decisions applied:
//   D1: SKD (invoice) = SDA (system)
//   D2: "job assign & help" → job# SBS-ADMIN-2026-03, actor_role=PM
//   D3/D4: All duplicate rows written separately as they appear on invoice
//   D5: RKU actor_role = 'QC' (all RKU rows regardless of invoice work type)
//   F1: BSG job descriptions stripped (_Kings Crossing etc) — already clean in report
//   F2/F7: SDA 2602-2149-A three times on 03-03 — three separate rows
//   F3: ABB 2603-2448-A on three dates (04, 05, 09 Mar) — three separate rows
//   F4: SDA 2601-0880 base job (no suffix) on 11-03 and 13-03 — distinct from -A/B/C/D
//   F5: SYR Rework entries written as DESIGNER — billable per invoice
//   F6: BCH 2601-0880-C twice on 05-03 (0.5 + 3 hrs) — two separate rows
//   F9: BCH and SYR both log 2602-1916-J — separate rows per actor
//   F10: SGO and SDA both log 2509-4564-B on 02-03 — separate rows per actor
//
// Mar 16–31 is BLOCKED — JS actor code unknown. File covers Mar 1–15 only.
//
// Run from Apps Script editor (overrides must be enabled):
//   1. runMigrationEnableOverrides()
//   2. runFillSbsMar1H()
//   3. runMigrationDisableOverrides()
// ============================================================

var SbsReconFiller_Mar2026 = (function () {

  var MODULE      = 'SbsReconFiller_Mar2026';
  var RECON_BATCH = 'BATCH-RECON-SBS-2603';

  // Format: [client_code, job_number, work_date, hours, actor_code, actor_role]

  // ── March 1–15 2026 (381 entries, 642 hrs) ───────────────────

  var MAR_1H_ = [
    // ── SGO Mar 1-15 (51.5 hrs, 75 rows) ─────────────────────
    ['SBS', 'SBS-ADMIN-2026-03', '2026-03-02', 1,    'SGO', 'PM'],
    ['SBS', '2509-4564-B',       '2026-03-02', 1.5,  'SGO', 'PM'],  // F10: same job as SDA row 6
    ['SBS', '2501-0143',         '2026-03-02', 1,    'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-03', '2026-03-03', 1.5,  'SGO', 'PM'],
    ['SBS', '2501-0236',         '2026-03-03', 1,    'SGO', 'PM'],
    ['SBS', '2501-0237',         '2026-03-03', 1,    'SGO', 'PM'],
    ['SBS', '2602-1845-B',       '2026-03-03', 1.5,  'SGO', 'PM'],
    ['SBS', '2602-1845-C',       '2026-03-03', 0.75, 'SGO', 'PM'],
    ['SBS', '2602-1845-D',       '2026-03-03', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-1845-E',       '2026-03-03', 0.5,  'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-03', '2026-03-04', 1.5,  'SGO', 'PM'],
    ['SBS', '2602-2167',         '2026-03-04', 1,    'SGO', 'PM'],
    ['SBS', '2602-1916-B',       '2026-03-04', 0.75, 'SGO', 'PM'],
    ['SBS', '2602-1916-C',       '2026-03-04', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-1916-D',       '2026-03-04', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-1916-F',       '2026-03-04', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-1916-G',       '2026-03-04', 0.5,  'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-03', '2026-03-05', 1.5,  'SGO', 'PM'],
    ['SBS', '2602-1916-I',       '2026-03-05', 0.5,  'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-03', '2026-03-06', 1.5,  'SGO', 'PM'],
    ['SBS', '2602-2149-A',       '2026-03-06', 2,    'SGO', 'PM'],
    ['SBS', '2602-2149-C',       '2026-03-06', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2149-E',       '2026-03-06', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2149-F',       '2026-03-06', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2149-D',       '2026-03-06', 0.25, 'SGO', 'PM'],
    ['SBS', '2602-2149-H',       '2026-03-06', 1.5,  'SGO', 'PM'],
    ['SBS', '2602-2376-A',       '2026-03-06', 0.5,  'SGO', 'PM'],
    ['SBS', 'SBS-ADMIN-2026-03', '2026-03-09', 1.5,  'SGO', 'PM'],
    ['SBS', '2507-1840-E',       '2026-03-09', 1,    'SGO', 'PM'],
    ['SBS', '2602-1892-A',       '2026-03-09', 0.75, 'SGO', 'PM'],
    ['SBS', '2601-0880-A',       '2026-03-09', 0.5,  'SGO', 'PM'],
    ['SBS', '2601-0880-B',       '2026-03-09', 0.5,  'SGO', 'PM'],
    ['SBS', '2601-0880-C',       '2026-03-09', 0.5,  'SGO', 'PM'],
    ['SBS', '2601-0880-D',       '2026-03-09', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2394-A',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2394-B',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2394-C',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2394-D',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2394-E',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2408-A',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2408-B',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2408-C',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2408-D',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2408-E',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2602-2408-F',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2445-A',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2445-B',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2445-C',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2445-D',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2445-E',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2445-F',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2445-G',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2447-A',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2447-B',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2447-C',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2447-D',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2447-E',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2447-F',       '2026-03-10', 0.5,  'SGO', 'PM'],
    ['SBS', '2411-0224-H',       '2026-03-10', 1,    'SGO', 'PM'],
    ['SBS', '2603-2449-A',       '2026-03-11', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2449-B',       '2026-03-11', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2449-C',       '2026-03-11', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2449-D',       '2026-03-11', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2449-E',       '2026-03-11', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2449-F',       '2026-03-11', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2516-A',       '2026-03-11', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2516-B',       '2026-03-11', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2516-C',       '2026-03-11', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2516-D',       '2026-03-11', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2516-E',       '2026-03-11', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2516-F',       '2026-03-11', 0.5,  'SGO', 'PM'],
    ['SBS', '2603-2516-G',       '2026-03-11', 0.5,  'SGO', 'PM'],
    ['SBS', '2601-0880',         '2026-03-13', 0.75, 'SGO', 'PM'],
    ['SBS', '2503-3627-F',       '2026-03-13', 0.75, 'SGO', 'PM'],
    ['SBS', '2601-0940-F',       '2026-03-13', 0.5,  'SGO', 'PM'],
    // ── BCH Mar 1-15 (36.5 hrs, 32 rows) ─────────────────────
    ['SBS', '2602-2291',         '2026-03-02', 2,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2501-0143',         '2026-03-02', 3,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2501-0236-A',       '2026-03-02', 1.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0880-A',       '2026-03-02', 2,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2501-0237-A',       '2026-03-03', 3,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-A',       '2026-03-03', 0.75, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-J',       '2026-03-03', 1.5,  'BCH', 'TEAM_LEAD'],  // F9: also SYR row same job
    ['SBS', '2601-0880-A',       '2026-03-03', 0.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0880-B',       '2026-03-03', 1.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-B',       '2026-03-03', 1.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-C',       '2026-03-03', 0.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-D',       '2026-03-04', 0.75, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-F',       '2026-03-04', 0.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-G',       '2026-03-04', 0.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1892-A',       '2026-03-04', 0.75, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-2280',         '2026-03-04', 0.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-I',       '2026-03-04', 3.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0880-B',       '2026-03-05', 0.5,  'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0880-C',       '2026-03-05', 0.5,  'BCH', 'TEAM_LEAD'],  // F6: row 1 of 2
    ['SBS', '2602-1916-L',       '2026-03-05', 0.25, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-M',       '2026-03-05', 0.25, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-N',       '2026-03-05', 0.25, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-P',       '2026-03-05', 0.25, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-Q',       '2026-03-05', 0.25, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-R',       '2026-03-05', 0.25, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-1916-S',       '2026-03-05', 1.75, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-2292-A',       '2026-03-05', 1,    'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-2283-A',       '2026-03-05', 0.75, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2601-0880-C',       '2026-03-05', 3,    'BCH', 'TEAM_LEAD'],  // F6: row 2 of 2
    ['SBS', '2601-0940-F',       '2026-03-06', 1.25, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2602-2277-A',       '2026-03-06', 0.75, 'BCH', 'TEAM_LEAD'],
    ['SBS', '2509-4875-B',       '2026-03-06', 1.25, 'BCH', 'TEAM_LEAD'],
    // ── ABB Mar 1-15 (103 hrs, 43 rows) ───────────────────────
    ['SBS', '2602-2289-A',       '2026-03-01', 3,    'ABB', 'DESIGNER'],
    ['SBS', '2602-2423-A',       '2026-03-02', 5,    'ABB', 'DESIGNER'],
    ['SBS', '2602-2424-A',       '2026-03-02', 2,    'ABB', 'DESIGNER'],
    ['SBS', '2602-2424-A',       '2026-03-03', 2,    'ABB', 'DESIGNER'],
    ['SBS', '2603-2476-C',       '2026-03-03', 0.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2477-C',       '2026-03-03', 0.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2478-C',       '2026-03-03', 0.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2479-C',       '2026-03-03', 0.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2476-A',       '2026-03-03', 0.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2477-A',       '2026-03-03', 0.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2478-A',       '2026-03-03', 0.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2479-A',       '2026-03-03', 0.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2476-B',       '2026-03-03', 0.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2477-B',       '2026-03-03', 0.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2478-B',       '2026-03-03', 0.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2479-B',       '2026-03-03', 0.5,  'ABB', 'DESIGNER'],
    ['SBS', '2602-2287-A',       '2026-03-04', 2.75, 'ABB', 'DESIGNER'],
    ['SBS', '2602-2378-A',       '2026-03-04', 3,    'ABB', 'DESIGNER'],
    ['SBS', '2603-2448-A',       '2026-03-04', 3,    'ABB', 'DESIGNER'],  // F3: row 1 of 3
    ['SBS', '2602-2163-A',       '2026-03-05', 3.25, 'ABB', 'DESIGNER'],
    ['SBS', '2602-2423',         '2026-03-05', 3,    'ABB', 'DESIGNER'],
    ['SBS', '2603-2448-A',       '2026-03-05', 3,    'ABB', 'DESIGNER'],  // F3: row 2 of 3
    ['SBS', '2603-2521-A',       '2026-03-06', 7,    'ABB', 'DESIGNER'],
    ['SBS', '2602-2403-A',       '2026-03-06', 3,    'ABB', 'DESIGNER'],
    ['SBS', '2602-2403-A',       '2026-03-07', 2.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2450-A',       '2026-03-07', 4.5,  'ABB', 'DESIGNER'],
    ['SBS', '2602-2419-A',       '2026-03-08', 4.25, 'ABB', 'DESIGNER'],
    ['SBS', '2603-2446-A',       '2026-03-08', 5,    'ABB', 'DESIGNER'],
    ['SBS', '2603-2448-A',       '2026-03-09', 0.75, 'ABB', 'DESIGNER'],  // F3: row 3 of 3
    ['SBS', '2602-2301-A',       '2026-03-09', 2.5,  'ABB', 'DESIGNER'],
    ['SBS', '2602-2301-A',       '2026-03-10', 1.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2824-B',       '2026-03-10', 6,    'ABB', 'DESIGNER'],
    ['SBS', '2603-2446',         '2026-03-11', 2,    'ABB', 'DESIGNER'],
    ['SBS', '2602-2403',         '2026-03-11', 2,    'ABB', 'DESIGNER'],
    ['SBS', '2602-2419',         '2026-03-11', 2,    'ABB', 'DESIGNER'],
    ['SBS', '2603-2450',         '2026-03-11', 2,    'ABB', 'DESIGNER'],
    ['SBS', '2603-2448',         '2026-03-11', 1,    'ABB', 'DESIGNER'],
    ['SBS', '2603-2448',         '2026-03-12', 1,    'ABB', 'DESIGNER'],
    ['SBS', '2603-2824-B',       '2026-03-12', 7,    'ABB', 'DESIGNER'],
    ['SBS', '2603-2521',         '2026-03-13', 2.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2926-A',       '2026-03-13', 3,    'ABB', 'DESIGNER'],
    ['SBS', '2603-2926-A',       '2026-03-15', 3.5,  'ABB', 'DESIGNER'],
    ['SBS', '2603-2929-A',       '2026-03-15', 4,    'ABB', 'DESIGNER'],
    // ── RKU Mar 1-15 (65.5 hrs, 66 rows) — role=QC (D5) ──────
    ['SBS', '2602-2280',         '2026-03-04', 1.25, 'RKU', 'QC'],
    ['SBS', '2602-2292-A',       '2026-03-04', 2,    'RKU', 'QC'],
    ['SBS', '2602-2292-A',       '2026-03-05', 5,    'RKU', 'QC'],
    ['SBS', '2602-2378-A',       '2026-03-05', 0.75, 'RKU', 'QC'],
    ['SBS', '2602-2287-A',       '2026-03-05', 1,    'RKU', 'QC'],
    ['SBS', '2602-2283-A',       '2026-03-05', 1.5,  'RKU', 'QC'],
    ['SBS', '2602-2277-A',       '2026-03-05', 1.5,  'RKU', 'QC'],
    ['SBS', '2602-2394-A',       '2026-03-06', 4.5,  'RKU', 'QC'],
    ['SBS', '2602-2394-A',       '2026-03-07', 0.25, 'RKU', 'QC'],
    ['SBS', '2602-2394-B',       '2026-03-07', 1.25, 'RKU', 'QC'],
    ['SBS', '2602-2394-C',       '2026-03-07', 1,    'RKU', 'QC'],
    ['SBS', '2602-2394-D',       '2026-03-07', 0.5,  'RKU', 'QC'],
    ['SBS', '2602-2394-E',       '2026-03-07', 1,    'RKU', 'QC'],
    ['SBS', '2602-2408-A',       '2026-03-07', 2,    'RKU', 'QC'],
    ['SBS', '2602-2408-B',       '2026-03-07', 1.25, 'RKU', 'QC'],
    ['SBS', '2602-2408-C',       '2026-03-07', 1.25, 'RKU', 'QC'],
    ['SBS', '2602-2408-D',       '2026-03-07', 0.5,  'RKU', 'QC'],
    ['SBS', '2602-2408-E',       '2026-03-09', 0.5,  'RKU', 'QC'],
    ['SBS', '2602-2408-F',       '2026-03-09', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2445-A',       '2026-03-09', 0.75, 'RKU', 'QC'],
    ['SBS', '2603-2445-B',       '2026-03-09', 0.75, 'RKU', 'QC'],
    ['SBS', '2603-2445-C',       '2026-03-09', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2445-D',       '2026-03-09', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2445-E',       '2026-03-09', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2445-F',       '2026-03-09', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2445-G',       '2026-03-09', 1,    'RKU', 'QC'],
    ['SBS', '2603-2447-A',       '2026-03-10', 0.75, 'RKU', 'QC'],
    ['SBS', '2603-2447-B',       '2026-03-10', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2447-C',       '2026-03-10', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2447-D',       '2026-03-10', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2447-E',       '2026-03-10', 0.75, 'RKU', 'QC'],
    ['SBS', '2603-2447-F',       '2026-03-10', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2449-A',       '2026-03-10', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2449-B',       '2026-03-10', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2449-C',       '2026-03-10', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2449-D',       '2026-03-11', 0.25, 'RKU', 'QC'],
    ['SBS', '2603-2449-E',       '2026-03-11', 0.25, 'RKU', 'QC'],
    ['SBS', '2603-2449-F',       '2026-03-11', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2516-A',       '2026-03-11', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2516-B',       '2026-03-11', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2516-C',       '2026-03-11', 0.25, 'RKU', 'QC'],
    ['SBS', '2603-2516-D',       '2026-03-11', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2516-E',       '2026-03-11', 0.25, 'RKU', 'QC'],
    ['SBS', '2603-2516-F',       '2026-03-11', 0.25, 'RKU', 'QC'],
    ['SBS', '2603-2516-G',       '2026-03-11', 0.75, 'RKU', 'QC'],
    ['SBS', '2512-9742-B',       '2026-03-12', 5,    'RKU', 'QC'],
    ['SBS', '2512-9742',         '2026-03-12', 1,    'RKU', 'QC'],
    ['SBS', '2602-1554-A',       '2026-03-13', 1.75, 'RKU', 'QC'],
    ['SBS', '2602-1554-B',       '2026-03-13', 1.25, 'RKU', 'QC'],
    ['SBS', '2602-1554-C',       '2026-03-13', 1,    'RKU', 'QC'],
    ['SBS', '2602-1554-D',       '2026-03-13', 1.5,  'RKU', 'QC'],
    ['SBS', 'M00142',            '2026-03-13', 0.25, 'RKU', 'QC'],
    ['SBS', '2509-4543-F',       '2026-03-13', 0.5,  'RKU', 'QC'],
    ['SBS', '2505-7978-K',       '2026-03-13', 1.25, 'RKU', 'QC'],
    ['SBS', '2603-2923-A',       '2026-03-14', 1.25, 'RKU', 'QC'],
    ['SBS', '2603-2923-B',       '2026-03-14', 0.75, 'RKU', 'QC'],
    ['SBS', '2603-2923-C',       '2026-03-14', 1,    'RKU', 'QC'],
    ['SBS', '2603-2923-D',       '2026-03-14', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2923-E',       '2026-03-14', 0.75, 'RKU', 'QC'],
    ['SBS', '2603-2923-F',       '2026-03-14', 1,    'RKU', 'QC'],
    ['SBS', '2603-2927-A',       '2026-03-14', 1.5,  'RKU', 'QC'],
    ['SBS', '2603-2927-F',       '2026-03-14', 1.5,  'RKU', 'QC'],
    ['SBS', '2603-2927-B',       '2026-03-14', 0.75, 'RKU', 'QC'],
    ['SBS', '2603-2927-C',       '2026-03-14', 0.75, 'RKU', 'QC'],
    ['SBS', '2603-2927-D',       '2026-03-14', 0.5,  'RKU', 'QC'],
    ['SBS', '2603-2927-E',       '2026-03-14', 0.75, 'RKU', 'QC'],
    // ── SDA Mar 1-15 (87.75 hrs, 51 rows) ─────────────────────
    ['SBS', '2602-1844-B',       '2026-03-02', 1.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-1844-C',       '2026-03-02', 0.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-1844-D',       '2026-03-02', 0.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-1844-E',       '2026-03-02', 0.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2411-0120-D',       '2026-03-02', 0.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2509-4564-B',       '2026-03-02', 2.5,  'SDA', 'TEAM_LEAD'],  // F10: same job as SGO row 2
    ['SBS', '2601-0627',         '2026-03-02', 2.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2149-A',       '2026-03-02', 1,    'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-1844-C',       '2026-03-03', 0.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-1844-D',       '2026-03-03', 0.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-1844-E',       '2026-03-03', 0.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2149-A',       '2026-03-03', 2.5,  'SDA', 'TEAM_LEAD'],  // F2/F7: row 1 of 2 on 03-03
    ['SBS', '2602-2149-A',       '2026-03-03', 3,    'SDA', 'TEAM_LEAD'],  // F2/F7: row 2 of 2 on 03-03
    ['SBS', '2602-1789-G',       '2026-03-03', 1.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2149-A',       '2026-03-04', 2.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2149-C',       '2026-03-04', 3.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2149-D',       '2026-03-04', 1,    'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2149-A',       '2026-03-05', 0.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2149-C',       '2026-03-05', 0.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2149-D',       '2026-03-05', 2.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2149-E',       '2026-03-05', 0.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2149-F',       '2026-03-05', 0.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2149-H',       '2026-03-05', 4.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2129',         '2026-03-05', 1.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2373-A',       '2026-03-06', 1.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2503-3559-E',       '2026-03-06', 1.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-2129',         '2026-03-06', 2.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2507-1840-E',       '2026-03-06', 1.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2411-0224-H',       '2026-03-06', 1.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-1818-F',       '2026-03-06', 0.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2507-1840-E',       '2026-03-09', 5.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2411-0224-H',       '2026-03-09', 3.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2602-1845-F',       '2026-03-10', 3.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2503-3627-F',       '2026-03-10', 2,    'SDA', 'TEAM_LEAD'],
    ['SBS', '2511-8323-C',       '2026-03-10', 2.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2508-3593-B',       '2026-03-10', 1.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2503-3627-F',       '2026-03-11', 3.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2509-4706-D',       '2026-03-11', 2,    'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0880',         '2026-03-11', 2,    'SDA', 'TEAM_LEAD'],  // F4: base job
    ['SBS', '2603-2685-C',       '2026-03-12', 3.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2501-1078-A',       '2026-03-12', 0.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2503-3858-B',       '2026-03-12', 0.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2503-3858-C',       '2026-03-12', 1,    'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-8644-F',       '2026-03-12', 1.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0940-F',       '2026-03-12', 1.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9742',         '2026-03-13', 1.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9742-B',       '2026-03-13', 1.5,  'SDA', 'TEAM_LEAD'],
    ['SBS', '2512-9048',         '2026-03-13', 1.25, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2601-0880',         '2026-03-13', 3.25, 'SDA', 'TEAM_LEAD'],  // F4: base job
    ['SBS', '2602-1248',         '2026-03-13', 1.75, 'SDA', 'TEAM_LEAD'],
    ['SBS', '2511-8323-C',       '2026-03-13', 0.25, 'SDA', 'TEAM_LEAD'],
    // ── SYR Mar 1-15 (88 hrs, 44 rows) ────────────────────────
    ['SBS', '2602-1916-A',       '2026-03-02', 0.5,  'SYR', 'DESIGNER'],
    ['SBS', '2602-1916-J',       '2026-03-02', 6.5,  'SYR', 'DESIGNER'],  // F9: also BCH row same job
    ['SBS', '2602-1916-A',       '2026-03-03', 0.5,  'SYR', 'DESIGNER'],
    ['SBS', '2602-1916-J',       '2026-03-03', 1,    'SYR', 'DESIGNER'],
    ['SBS', '2602-1916-A',       '2026-03-03', 0.5,  'SYR', 'DESIGNER'],  // Rework — F5
    ['SBS', '2602-1916-J',       '2026-03-03', 1,    'SYR', 'DESIGNER'],  // Rework — F5
    ['SBS', '2602-1916-Q',       '2026-03-03', 5.5,  'SYR', 'DESIGNER'],
    ['SBS', '2602-1892-A',       '2026-03-03', 0.5,  'SYR', 'DESIGNER'],
    ['SBS', '2602-1916-Q',       '2026-03-04', 0.5,  'SYR', 'DESIGNER'],
    ['SBS', '2602-1892-A',       '2026-03-04', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', '2602-1916-S',       '2026-03-04', 3.5,  'SYR', 'DESIGNER'],
    ['SBS', '2602-1916-R',       '2026-03-04', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', '2602-1916-N',       '2026-03-04', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', '2602-1916-P',       '2026-03-04', 1,    'SYR', 'DESIGNER'],
    ['SBS', '2602-1916-L',       '2026-03-04', 0.5,  'SYR', 'DESIGNER'],
    ['SBS', '2602-1916-M',       '2026-03-04', 0.5,  'SYR', 'DESIGNER'],
    ['SBS', '2502-2648-C',       '2026-03-05', 1,    'SYR', 'DESIGNER'],
    ['SBS', '2602-1916-M',       '2026-03-05', 0.25, 'SYR', 'DESIGNER'],  // Rework — F5
    ['SBS', '2602-1916-N',       '2026-03-05', 0.25, 'SYR', 'DESIGNER'],  // Rework — F5
    ['SBS', '2602-1916-S',       '2026-03-05', 0.5,  'SYR', 'DESIGNER'],  // Rework — F5
    ['SBS', '2602-1916-S',       '2026-03-05', 1,    'SYR', 'DESIGNER'],
    ['SBS', '2509-4875-B',       '2026-03-05', 2.5,  'SYR', 'DESIGNER'],
    ['SBS', '2509-4875-B',       '2026-03-06', 2.5,  'SYR', 'DESIGNER'],
    ['SBS', '2601-0892-A',       '2026-03-06', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', '2502-2648-B',       '2026-03-06', 3.5,  'SYR', 'DESIGNER'],
    ['SBS', '2511-8323-C',       '2026-03-09', 2.5,  'SYR', 'DESIGNER'],
    ['SBS', '2502-2648-B',       '2026-03-09', 4,    'SYR', 'DESIGNER'],
    ['SBS', '2602-1892-A',       '2026-03-09', 1,    'SYR', 'DESIGNER'],
    ['SBS', '2511-8323-C',       '2026-03-10', 5,    'SYR', 'DESIGNER'],
    ['SBS', '2501-1078-A',       '2026-03-10', 3.5,  'SYR', 'DESIGNER'],
    ['SBS', 'M00142-C',          '2026-03-11', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', '2503-3858-B',       '2026-03-11', 3,    'SYR', 'DESIGNER'],
    ['SBS', 'M00167-B',          '2026-03-11', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', '2503-3858-C',       '2026-03-11', 3,    'SYR', 'DESIGNER'],
    ['SBS', '2503-3858-C',       '2026-03-12', 1,    'SYR', 'DESIGNER'],
    ['SBS', '2509-4543-F',       '2026-03-12', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', 'M00167-B',          '2026-03-12', 4,    'SYR', 'DESIGNER'],
    ['SBS', '2505-7978-K',       '2026-03-12', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', '2512-9048-A',       '2026-03-12', 1,    'SYR', 'DESIGNER'],
    ['SBS', '2512-9048-A',       '2026-03-13', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', '2505-7978-K',       '2026-03-13', 4,    'SYR', 'DESIGNER'],
    ['SBS', 'M00167-B',          '2026-03-13', 3,    'SYR', 'DESIGNER'],
    ['SBS', 'M00167-B',          '2026-03-14', 1.5,  'SYR', 'DESIGNER'],
    ['SBS', '2503-3620-B',       '2026-03-14', 4.5,  'SYR', 'DESIGNER'],
    // ── SVN Mar 1-15 (80 hrs, 44 rows) ────────────────────────
    ['SBS', '2602-2065-B',       '2026-03-02', 1.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2065-E',       '2026-03-02', 1.25, 'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2065-F',       '2026-03-02', 1.25, 'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2289-A',       '2026-03-02', 1,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2165-A',       '2026-03-02', 1,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2423-A',       '2026-03-02', 2,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2065-B',       '2026-03-03', 0.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2065-E',       '2026-03-03', 1,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2065-F',       '2026-03-03', 0.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2424-A',       '2026-03-03', 1.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2503-3559-E',       '2026-03-03', 2,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2603-2476-C',       '2026-03-04', 0.25, 'SVN', 'TEAM_LEAD'],
    ['SBS', '2603-2477-C',       '2026-03-04', 0.25, 'SVN', 'TEAM_LEAD'],
    ['SBS', '2603-2476-A',       '2026-03-04', 0.25, 'SVN', 'TEAM_LEAD'],  // F8: Floor 1
    ['SBS', '2603-2476-B',       '2026-03-04', 0.25, 'SVN', 'TEAM_LEAD'],  // F8: Floor 1 (separate row)
    ['SBS', '2503-3559-E',       '2026-03-04', 8,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2423',         '2026-03-05', 1.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2163-A',       '2026-03-05', 1,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2503-3559-E',       '2026-03-05', 6,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2603-2521-A',       '2026-03-06', 2,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2601-0616-A',       '2026-03-06', 2,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2509-4706-D',       '2026-03-06', 4,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-1818-F',       '2026-03-06', 1,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2403-A',       '2026-03-09', 2,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2603-2450-A',       '2026-03-09', 2,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2419-A',       '2026-03-09', 1.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2603-2446-A',       '2026-03-09', 2,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2603-2448-A',       '2026-03-09', 1.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2301-A',       '2026-03-10', 1.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2509-4706-D',       '2026-03-10', 7,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2603-2446',         '2026-03-11', 1,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2403',         '2026-03-11', 0.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-2419',         '2026-03-11', 0.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-1248-A',       '2026-03-11', 6,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2603-2448',         '2026-03-12', 0.75, 'SVN', 'TEAM_LEAD'],
    ['SBS', '2603-2450',         '2026-03-12', 0.75, 'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-1248-A',       '2026-03-12', 4,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-1248-A',       '2026-03-13', 4,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2603-2521',         '2026-03-13', 1,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2603-2824-B',       '2026-03-13', 2,    'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-1554-A',       '2026-03-13', 0.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-1554-B',       '2026-03-13', 0.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-1554-C',       '2026-03-13', 0.5,  'SVN', 'TEAM_LEAD'],
    ['SBS', '2602-1554-D',       '2026-03-13', 0.5,  'SVN', 'TEAM_LEAD'],
    // ── BSG Mar 1-15 (63.75 hrs, 17 rows) ─────────────────────
    ['SBS', '2602-2376-A',       '2026-03-03', 3.5,  'BSG', 'DESIGNER'],
    ['SBS', '2602-2167-A',       '2026-03-03', 3,    'BSG', 'DESIGNER'],
    ['SBS', '2602-2167-A',       '2026-03-04', 2.5,  'BSG', 'DESIGNER'],
    ['SBS', '2601-0878-A',       '2026-03-04', 0.5,  'BSG', 'DESIGNER'],
    ['SBS', '2509-4564-A',       '2026-03-04', 1,    'BSG', 'DESIGNER'],
    ['SBS', '2602-2373-A',       '2026-03-04', 2,    'BSG', 'DESIGNER'],
    ['SBS', '2602-2373-A',       '2026-03-05', 4.25, 'BSG', 'DESIGNER'],
    ['SBS', '2512-8644-F',       '2026-03-09', 5,    'BSG', 'DESIGNER'],
    ['SBS', '2509-4564-F',       '2026-03-09', 5.5,  'BSG', 'DESIGNER'],
    ['SBS', '2508-3593-B',       '2026-03-10', 8.25, 'BSG', 'DESIGNER'],
    ['SBS', '2601-0907-A',       '2026-03-10', 1.25, 'BSG', 'DESIGNER'],
    ['SBS', '2512-8644-F',       '2026-03-11', 3,    'BSG', 'DESIGNER'],
    ['SBS', '2509-4564-F',       '2026-03-11', 5.5,  'BSG', 'DESIGNER'],
    ['SBS', '2512-8644-F',       '2026-03-12', 3.5,  'BSG', 'DESIGNER'],
    ['SBS', '2602-1681-A',       '2026-03-12', 4.5,  'BSG', 'DESIGNER'],
    ['SBS', '2603-2788-A',       '2026-03-13', 7.5,  'BSG', 'DESIGNER'],
    ['SBS', '2603-2788-A',       '2026-03-14', 3,    'BSG', 'DESIGNER'],
    // ── PBG Mar 1-15 (66 hrs, 9 rows) ─────────────────────────
    ['SBS', '2602-2129',         '2026-03-02', 4,    'PBG', 'TEAM_LEAD'],
    ['SBS', '2602-2129',         '2026-03-03', 10,   'PBG', 'TEAM_LEAD'],
    ['SBS', '2602-2129',         '2026-03-04', 10,   'PBG', 'TEAM_LEAD'],
    ['SBS', '2602-2129',         '2026-03-05', 4,    'PBG', 'TEAM_LEAD'],
    ['SBS', '2603-2685-C',       '2026-03-07', 8,    'PBG', 'TEAM_LEAD'],
    ['SBS', '2603-2685-C',       '2026-03-09', 8,    'PBG', 'TEAM_LEAD'],
    ['SBS', '2603-2685-C',       '2026-03-10', 10,   'PBG', 'TEAM_LEAD'],
    ['SBS', '2603-2685-C',       '2026-03-11', 4,    'PBG', 'TEAM_LEAD'],
    ['SBS', '2603-2823-B',       '2026-03-13', 8,    'PBG', 'TEAM_LEAD']
  ];

  // ── Row builder ────────────────────────────────────────────

  function buildRow_(entry, iKey) {
    var workDate = entry[2] instanceof Date ? entry[2] : new Date(entry[2] + 'T00:00:00');
    return {
      event_id:        Identifiers.generateId(),
      event_type:      'WORK_LOG_MIGRATION',
      period_id:       entry[2].substring(0, 7),
      client_code:     entry[0],
      job_number:      entry[1],
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
    fillMar1H: function (actorEmail) {
      return fill_(actorEmail, MAR_1H_, 'SBS-2603-1H-');
    }
  };

}());

// ── Top-level runner ─────────────────────────────────────────

function runFillSbsMar1H() {
  console.log('═══════════════════════════════════════════');
  console.log('[SbsReconFiller_Mar2026] Mar 1-15 2026');
  console.log('  Entries: 381 | Expected hrs: 642');
  console.log('═══════════════════════════════════════════');
  try {
    var r = SbsReconFiller_Mar2026.fillMar1H('blccanada2026@gmail.com');
    console.log('  inserted=' + r.inserted + ' skipped=' + r.skipped + ' failed=' + r.failed);
    console.log(r.failed === 0 ? '  ✅ Done' : '  ❌ Some writes failed — check Logger');
  } catch (e) {
    console.log('  ❌ ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}

// ── Idempotency key reset helper ─────────────────────────────

function runClearSbsMar1HKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 380; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : '0';
    var key = 'IDEM_SBS-2603-1H-' + pad + i;
    if (props.getProperty(key) !== null) { props.deleteProperty(key); cleared++; }
  }
  console.log('[SbsReconFiller_Mar2026] Cleared ' + cleared + ' Mar1H idempotency keys.');
}
