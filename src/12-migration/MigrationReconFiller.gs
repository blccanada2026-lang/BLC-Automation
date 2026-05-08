// ============================================================
// MigrationReconFiller.gs — BLC Nexus T12 Migration
// src/12-migration/MigrationReconFiller.gs
//
// Inserts attributed invoice work log entries (BATCH-RECON-001)
// from Norspan-MB and TITAN invoices (Jan–Apr 2026).
//
// The original BATCH-001 migration rows have blank actor_code.
// These BATCH-RECON-001 rows carry full actor attribution so
// historical reporting can be done by designer.
//
// Both batches have migration_batch set → excluded from live
// billing/payroll. No double-billing risk.
//
// Run: runFillMissingWorkLogs() from Apps Script editor.
// Idempotent — re-running skips already-inserted entries.
// ============================================================

var MigrationReconFiller = (function () {

  var MODULE = 'MigrationReconFiller';
  var RECON_BATCH = 'BATCH-RECON-001';

  // ── Invoice entries ────────────────────────────────────────
  // Format: [client_code, job_number, work_date, hours, actor_code, actor_role]
  // Roles: BCH=TEAM_LEAD, RKG=DESIGNER, VKV=DESIGNER, SGO=PM,
  //        PRS=DESIGNER, PBG=TEAM_LEAD, DBS=DESIGNER, NMM=DESIGNER
  var RECON_ENTRIES_ = [
    // ── NORSPAN-MB Jan 1-15 ────────────────────────────────
    ['NORSPAN-MB', 'Q251132',  '2026-01-05', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q251109',  '2026-01-05', 2,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260000',  '2026-01-06', 6,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q251144',  '2026-01-07', 6,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260001',  '2026-01-08', 5,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q251145G', '2026-01-09', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260015',  '2026-01-09', 6,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260018',  '2026-01-09', 1.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q251145',  '2026-01-10', 4,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260021',  '2026-01-15', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q251129',  '2026-01-02', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q251130',  '2026-01-02', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q251131',  '2026-01-03', 0.75, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q251143',  '2026-01-03', 0.75, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q251149',  '2026-01-03', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q251109',  '2026-01-05', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q251150',  '2026-01-05', 4,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q251150',  '2026-01-06', 3,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260000',  '2026-01-06', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q251144',  '2026-01-07', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260001',  '2026-01-08', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q251037',  '2026-01-08', 3.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260010',  '2026-01-09', 6.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q251145G', '2026-01-10', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q251145G', '2026-01-10', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q251145',  '2026-01-13', 4,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260015',  '2026-01-14', 3,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260034',  '2026-01-15', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260021',  '2026-01-15', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260035',  '2026-01-15', 0.5,  'BCH', 'TEAM_LEAD'],
    // ── NORSPAN-MB Jan 16-31 ───────────────────────────────
    ['NORSPAN-MB', 'Q260034',  '2026-01-16', 5,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260002',  '2026-01-17', 8,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260017',  '2026-01-18', 2,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260003',  '2026-01-19', 12,   'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q251143',  '2026-01-19', 2,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260036',  '2026-01-20', 5,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260022',  '2026-01-20', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260031',  '2026-01-21', 4,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260031',  '2026-01-22', 4,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260038',  '2026-01-26', 6,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260025',  '2026-01-27', 1.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260053',  '2026-01-27', 3,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260054',  '2026-01-29', 4,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260054',  '2026-01-30', 12,   'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260031',  '2026-01-30', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260030',  '2026-01-15', 0.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260035',  '2026-01-15', 0.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260028',  '2026-01-19', 0.75, 'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260029',  '2026-01-20', 0.75, 'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260023',  '2026-01-21', 0.25, 'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260023',  '2026-01-22', 0.25, 'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260042',  '2026-01-23', 0.7,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260052',  '2026-01-25', 0.45, 'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260052',  '2026-01-26', 0.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260042',  '2026-01-27', 0.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260042',  '2026-01-28', 2.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260023',  '2026-01-30', 0.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260003',  '2026-01-19', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260002',  '2026-01-19', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260017',  '2026-01-19', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260029',  '2026-01-19', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260022',  '2026-01-20', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260029',  '2026-01-21', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260034',  '2026-01-22', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260036',  '2026-01-22', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260031',  '2026-01-23', 2,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260038',  '2026-01-26', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260052',  '2026-01-27', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260053',  '2026-01-28', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260042',  '2026-01-29', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260054',  '2026-01-30', 2,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260023',  '2026-01-31', 0.5,  'BCH', 'TEAM_LEAD'],
    // ── NORSPAN-MB Feb 1-15 ────────────────────────────────
    ['NORSPAN-MB', 'Q260070',  '2026-02-03', 2,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260070',  '2026-02-04', 5,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260075',  '2026-02-06', 7,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q250357G', '2026-02-07', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260077',  '2026-02-07', 1.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260081',  '2026-02-10', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260082',  '2026-02-10', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260084',  '2026-02-11', 5,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260093',  '2026-02-12', 8,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260093',  '2026-02-13', 4,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260092',  '2026-02-13', 2,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260071',  '2026-02-04', 2.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260071',  '2026-02-05', 0.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260071',  '2026-02-06', 0.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260079',  '2026-02-07', 1.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260081',  '2026-02-08', 5,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260082',  '2026-02-08', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260082',  '2026-02-09', 5,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260081',  '2026-02-10', 2,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260081',  '2026-02-10', 2,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260089',  '2026-02-12', 2.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260089',  '2026-02-13', 3,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260089',  '2026-02-15', 1.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260070',  '2026-02-05', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260071',  '2026-02-06', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260075',  '2026-02-07', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260077',  '2026-02-07', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q250357G', '2026-02-07', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260081',  '2026-02-10', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260082',  '2026-02-12', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260084',  '2026-02-12', 1.5,  'BCH', 'TEAM_LEAD'],
    // ── NORSPAN-MB Feb 16-28 ───────────────────────────────
    ['NORSPAN-MB', 'Q260089',  '2026-02-16', 2,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260091',  '2026-02-18', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260098',  '2026-02-18', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260106',  '2026-02-20', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260106',  '2026-02-24', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260107',  '2026-02-24', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260108',  '2026-02-24', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260112',  '2026-02-24', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260010',  '2026-02-26', 2,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260114',  '2026-02-26', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260117',  '2026-02-27', 0.75, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260010',  '2026-02-28', 2,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260099',  '2026-02-16', 3,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260098',  '2026-02-17', 3,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260106',  '2026-02-18', 6,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260108',  '2026-02-20', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260110',  '2026-02-20', 3,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260114',  '2026-02-24', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260117',  '2026-02-24', 2,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260110',  '2026-02-26', 7,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260110',  '2026-02-27', 10,   'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260099',  '2026-02-28', 3,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260089',  '2026-02-16', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260090',  '2026-02-16', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260091',  '2026-02-16', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260091',  '2026-02-17', 2.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260102',  '2026-02-17', 0.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260107',  '2026-02-20', 2.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260107',  '2026-02-21', 1.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260112',  '2026-02-22', 3,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260113',  '2026-02-24', 3,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260113',  '2026-02-25', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260113',  '2026-02-26', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260123',  '2026-02-26', 1.75, 'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260113',  '2026-02-27', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260113',  '2026-02-28', 0.5,  'VKV', 'DESIGNER'],
    // ── NORSPAN-MB Mar 1-15 ────────────────────────────────
    ['NORSPAN-MB', 'Q260113',  '2026-03-02', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260099',  '2026-03-02', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260125',  '2026-03-04', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260126',  '2026-03-04', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260103',  '2026-03-04', 1.25, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260128',  '2026-03-06', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260127',  '2026-03-06', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260124',  '2026-03-06', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260127M', '2026-03-06', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260132',  '2026-03-06', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260125',  '2026-03-02', 3.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260126',  '2026-03-03', 2,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260128',  '2026-03-04', 4,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260128',  '2026-03-05', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260132',  '2026-03-05', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260132',  '2026-03-06', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260140',  '2026-03-09', 2.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260140',  '2026-03-10', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260141',  '2026-03-10', 1.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260141',  '2026-03-11', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260140',  '2026-03-11', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260141',  '2026-03-12', 1.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260129',  '2026-03-12', 0.5,  'SGO', 'PM'],
    ['NORSPAN-MB', 'Q260133',  '2026-03-12', 0.5,  'SGO', 'PM'],
    ['NORSPAN-MB', 'Q260135',  '2026-03-12', 0.5,  'SGO', 'PM'],
    ['NORSPAN-MB', 'Q260142',  '2026-03-13', 0.5,  'SGO', 'PM'],
    ['NORSPAN-MB', 'Q260127M', '2026-03-13', 0.5,  'SGO', 'PM'],
    ['NORSPAN-MB', 'Q260127',  '2026-03-03', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260127M', '2026-03-03', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260103',  '2026-03-03', 3,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260103',  '2026-03-04', 4,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260124',  '2026-03-04', 4,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260124',  '2026-03-05', 6,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260124',  '2026-03-06', 6,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q24403A',  '2026-03-06', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260129',  '2026-03-06', 2,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260129',  '2026-03-07', 2,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260133',  '2026-03-07', 3,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260135',  '2026-03-09', 4,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260134',  '2026-03-10', 3,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260140',  '2026-03-10', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260141',  '2026-03-11', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260133',  '2026-03-11', 3,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260134',  '2026-03-12', 4,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260140',  '2026-03-13', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260127M', '2026-03-13', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260142',  '2026-03-13', 1,    'RKG', 'DESIGNER'],
    // ── NORSPAN-MB Mar 16-31 ───────────────────────────────
    ['NORSPAN-MB', 'Q260134',  '2026-03-16', 1.75, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260156',  '2026-03-18', 0.25, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260109',  '2026-03-18', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260158',  '2026-03-18', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260157',  '2026-03-18', 1.25, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260162',  '2026-03-18', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260163',  '2026-03-18', 0.25, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260177',  '2026-03-20', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260117',  '2026-03-20', 0.25, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260161',  '2026-03-21', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260166',  '2026-03-21', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260168',  '2026-03-21', 0.25, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260165',  '2026-03-21', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260178',  '2026-03-21', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260183',  '2026-03-24', 1.25, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260179',  '2026-03-25', 0.75, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260180',  '2026-03-28', 0.75, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260182',  '2026-03-28', 0.75, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260180',  '2026-03-30', 0.25, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260186',  '2026-03-30', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260187',  '2026-03-30', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260190',  '2026-03-30', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260192',  '2026-03-30', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260200',  '2026-03-31', 4,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260206',  '2026-03-31', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260158',  '2026-03-17', 2.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260160',  '2026-03-17', 0.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260161',  '2026-03-18', 2,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260168',  '2026-03-18', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260161',  '2026-03-19', 0.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260168',  '2026-03-19', 0.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260166',  '2026-03-19', 2,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260161',  '2026-03-20', 0.25, 'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260168',  '2026-03-20', 0.25, 'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260179',  '2026-03-20', 2,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260179',  '2026-03-21', 3,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260181',  '2026-03-23', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260181',  '2026-03-25', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260203',  '2026-03-31', 3,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260134',  '2026-03-16', 3,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260109',  '2026-03-17', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260156',  '2026-03-17', 0.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260157',  '2026-03-17', 6,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260162',  '2026-03-17', 1.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260163',  '2026-03-18', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260165',  '2026-03-18', 1.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260177',  '2026-03-19', 6,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260178',  '2026-03-20', 6,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260117',  '2026-03-20', 0.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260180',  '2026-03-21', 5,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260182',  '2026-03-23', 6,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260183',  '2026-03-24', 6,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260186',  '2026-03-24', 2,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260186',  '2026-03-25', 4,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260187',  '2026-03-25', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260190',  '2026-03-25', 0.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260192',  '2026-03-26', 5,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260181',  '2026-03-28', 8,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260201',  '2026-03-29', 0.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260202',  '2026-03-29', 2,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260205',  '2026-03-31', 0.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260206',  '2026-03-31', 2.25, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260200',  '2026-03-31', 0.5,  'SGO', 'PM'],
    // ── NORSPAN-MB Apr 1-15 ────────────────────────────────
    ['NORSPAN-MB', 'Q260209',  '2026-04-02', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260211',  '2026-04-02', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260210',  '2026-04-07', 0.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260212',  '2026-04-07', 0.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260216',  '2026-04-08', 4,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260200',  '2026-04-08', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260202',  '2026-04-09', 2,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260210A', '2026-04-10', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260202G', '2026-04-10', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260230',  '2026-04-10', 0.25, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260234',  '2026-04-13', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260210',  '2026-04-13', 0.25, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260210A', '2026-04-13', 0.25, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260212',  '2026-04-13', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260216',  '2026-04-13', 0.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260219',  '2026-04-13', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260234',  '2026-04-13', 0.25, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260237',  '2026-04-14', 4,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260239',  '2026-04-15', 1.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260203',  '2026-04-01', 3,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260204',  '2026-04-02', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260204',  '2026-04-03', 0.75, 'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260218',  '2026-04-08', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260219',  '2026-04-08', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260218',  '2026-04-09', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260160',  '2026-04-10', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260219',  '2026-04-11', 1.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260181',  '2026-04-01', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260201',  '2026-04-01', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260203',  '2026-04-02', 1,    'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260209',  '2026-04-02', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260211',  '2026-04-02', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260204',  '2026-04-03', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260202G', '2026-04-10', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260202',  '2026-04-10', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260160',  '2026-04-10', 0.5,  'BCH', 'TEAM_LEAD'],
    // ── NORSPAN-MB Apr 16-30 ───────────────────────────────
    ['NORSPAN-MB', 'Q260248',  '2026-04-20', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260248',  '2026-04-21', 1.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260250',  '2026-04-22', 2,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260254',  '2026-04-24', 2,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q250411',  '2026-04-28', 2,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q250411',  '2026-04-29', 1.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260250',  '2026-04-29', 1.5,  'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260275',  '2026-04-30', 2,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260265',  '2026-04-30', 1,    'VKV', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260239G', '2026-04-16', 0.25, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260242',  '2026-04-17', 2,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260230',  '2026-04-17', 0.25, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260245',  '2026-04-17', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260245A', '2026-04-17', 0.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260243',  '2026-04-17', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260239',  '2026-04-17', 0.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260246',  '2026-04-18', 5,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260232',  '2026-04-18', 1.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260246',  '2026-04-19', 3,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260233',  '2026-04-19', 1.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260241',  '2026-04-20', 2.25, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260241A', '2026-04-20', 1,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260241B', '2026-04-20', 0.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260241C', '2026-04-20', 0.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260251',  '2026-04-22', 3,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260248',  '2026-04-22', 0.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260250',  '2026-04-23', 0.75, 'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260256',  '2026-04-24', 8,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260260',  '2026-04-27', 5,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260261',  '2026-04-29', 3,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260263',  '2026-04-29', 2.5,  'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260267',  '2026-04-30', 6,    'RKG', 'DESIGNER'],
    ['NORSPAN-MB', 'Q260242',  '2026-04-17', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260230',  '2026-04-20', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260239G', '2026-04-20', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260243',  '2026-04-20', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260232',  '2026-04-20', 0.75, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260205',  '2026-04-20', 0.25, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260245',  '2026-04-20', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260245A', '2026-04-20', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260246',  '2026-04-20', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260233',  '2026-04-24', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260239',  '2026-04-24', 0.75, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260250',  '2026-04-24', 0.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260251',  '2026-04-24', 0.75, 'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260256',  '2026-04-27', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260260',  '2026-04-28', 1.5,  'BCH', 'TEAM_LEAD'],
    ['NORSPAN-MB', 'Q260261',  '2026-04-30', 0.75, 'BCH', 'TEAM_LEAD'],
    // ── TITAN Jan 1-15 ─────────────────────────────────────
    ['TITAN', 'B500678', '2026-01-01', 2,    'PRS', 'DESIGNER'],
    ['TITAN', 'B500678', '2026-01-02', 4,    'PRS', 'DESIGNER'],
    ['TITAN', 'B500678', '2026-01-05', 3,    'PRS', 'DESIGNER'],
    ['TITAN', 'B500668', '2026-01-05', 3,    'PRS', 'DESIGNER'],
    ['TITAN', 'B500678', '2026-01-08', 1,    'PRS', 'DESIGNER'],
    ['TITAN', 'B600015', '2026-01-14', 5,    'PRS', 'DESIGNER'],
    ['TITAN', 'B600015', '2026-01-15', 4,    'PRS', 'DESIGNER'],
    ['TITAN', 'B500378', '2026-01-06', 0.5,  'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B500677', '2026-01-07', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B500378', '2026-01-07', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B500668', '2026-01-07', 0.5,  'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B500678', '2026-01-07', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600002', '2026-01-09', 3,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600004', '2026-01-13', 1.5,  'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600004', '2026-01-06', 6,    'DBS', 'DESIGNER'],
    ['TITAN', 'B600004', '2026-01-07', 3.5,  'DBS', 'DESIGNER'],
    ['TITAN', 'B600004', '2026-01-08', 2.5,  'DBS', 'DESIGNER'],
    ['TITAN', 'B600004', '2026-01-08', 4,    'SGO', 'PM'],
    // ── TITAN Jan 16-31 ────────────────────────────────────
    ['TITAN', 'B600015', '2026-01-19', 2,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600025', '2026-01-21', 0.5,  'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600020', '2026-01-22', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600024', '2026-01-27', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600019', '2026-01-29', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600019', '2026-01-16', 4.5,  'PRS', 'DESIGNER'],
    ['TITAN', 'B600025', '2026-01-19', 1.25, 'PRS', 'DESIGNER'],
    ['TITAN', 'B600020', '2026-01-16', 3,    'NMM', 'DESIGNER'],
    ['TITAN', 'B600024', '2026-01-21', 2,    'NMM', 'DESIGNER'],
    // ── TITAN Feb 1-15 ─────────────────────────────────────
    ['TITAN', 'B400161', '2026-02-01', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600037', '2026-02-06', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600048', '2026-02-12', 0.5,  'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600037', '2026-02-05', 4,    'PRS', 'DESIGNER'],
    ['TITAN', 'B600047', '2026-02-05', 4.5,  'PRS', 'DESIGNER'],
    ['TITAN', 'B600050', '2026-02-12', 3,    'PRS', 'DESIGNER'],
    ['TITAN', 'B400161', '2026-02-01', 1.5,  'NMM', 'DESIGNER'],
    ['TITAN', 'B600048', '2026-02-11', 2,    'NMM', 'DESIGNER'],
    // ── TITAN Feb 16-28 ────────────────────────────────────
    ['TITAN', 'B600054', '2026-02-16', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600047', '2026-02-16', 2,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600048', '2026-02-18', 0.5,  'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600050', '2026-02-19', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600062', '2026-02-20', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600057', '2026-02-23', 0.5,  'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B500058', '2026-02-23', 0.25, 'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600062', '2026-02-23', 0.5,  'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600061', '2026-02-24', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600067', '2026-02-25', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600064', '2026-02-25', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600069', '2026-02-25', 2,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600050', '2026-02-16', 3,    'PRS', 'DESIGNER'],
    ['TITAN', 'B600050', '2026-02-17', 2.5,  'PRS', 'DESIGNER'],
    ['TITAN', 'B600057', '2026-02-18', 4.5,  'PRS', 'DESIGNER'],
    ['TITAN', 'B600064', '2026-02-19', 3.5,  'PRS', 'DESIGNER'],
    ['TITAN', 'B600067', '2026-02-19', 1.5,  'PRS', 'DESIGNER'],
    ['TITAN', 'B600067', '2026-02-20', 3.5,  'PRS', 'DESIGNER'],
    ['TITAN', 'B600069', '2026-02-24', 5.5,  'PRS', 'DESIGNER'],
    ['TITAN', 'B600079', '2026-03-27', 2.5,  'PRS', 'DESIGNER'], // dated Mar in Feb invoice
    ['TITAN', 'B600048', '2026-02-17', 2,    'NMM', 'DESIGNER'],
    ['TITAN', 'B600062', '2026-02-21', 4,    'NMM', 'DESIGNER'],
    ['TITAN', 'B600061', '2026-02-23', 3,    'NMM', 'DESIGNER'],
    ['TITAN', 'B600062', '2026-02-23', 1.5,  'NMM', 'DESIGNER'],
    ['TITAN', 'B600054', '2026-02-16', 4,    'DBS', 'DESIGNER'],
    // ── TITAN Mar 1-15 ─────────────────────────────────────
    ['TITAN', 'B600079', '2026-03-10', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600089', '2026-03-12', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B500354', '2026-03-12', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600079', '2026-03-05', 4,    'PRS', 'DESIGNER'],
    ['TITAN', 'B500354', '2026-03-11', 5.75, 'PRS', 'DESIGNER'],
    ['TITAN', 'B500354', '2026-03-12', 1,    'PRS', 'DESIGNER'],
    ['TITAN', 'B600077', '2026-03-12', 0.75, 'PRS', 'DESIGNER'],
    ['TITAN', 'B600102', '2026-03-15', 3,    'PRS', 'DESIGNER'],
    ['TITAN', 'B600089', '2026-03-08', 2.5,  'NMM', 'DESIGNER'],
    // ── TITAN Mar 16-31 ────────────────────────────────────
    ['TITAN', 'B600102', '2026-03-16', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600098', '2026-03-17', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600105', '2026-03-19', 1.5,  'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B500592', '2026-03-19', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600102', '2026-03-16', 0.75, 'PRS', 'DESIGNER'],
    ['TITAN', 'B600105', '2026-03-18', 2.5,  'PRS', 'DESIGNER'], // OWW Floor 1
    ['TITAN', 'B600105', '2026-03-18', 2.5,  'PRS', 'DESIGNER'], // Roof Truss
    ['TITAN', 'B600105', '2026-03-19', 4,    'PRS', 'DESIGNER'],
    ['TITAN', 'P-157',   '2026-03-31', 7,    'PRS', 'DESIGNER'],
    ['TITAN', 'B600128', '2026-03-31', 2,    'PRS', 'DESIGNER'],
    ['TITAN', 'B600098', '2026-03-17', 1.5,  'NMM', 'DESIGNER'],
    ['TITAN', 'B500592', '2026-03-18', 1.75, 'NMM', 'DESIGNER'],
    // ── TITAN Apr 1-15 ─────────────────────────────────────
    ['TITAN', 'B600133', '2026-04-02', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600128', '2026-04-02', 0.25, 'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600126', '2026-04-02', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600140', '2026-04-10', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600131', '2026-04-10', 1,    'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600050', '2026-04-10', 0.5,  'PBG', 'TEAM_LEAD'],
    ['TITAN', 'B600133', '2026-04-01', 2.25, 'PRS', 'DESIGNER'], // Roof Truss
    ['TITAN', 'B600133', '2026-04-01', 2.75, 'PRS', 'DESIGNER'], // OWW Floor 1
    ['TITAN', 'B600131', '2026-04-08', 2.75, 'PRS', 'DESIGNER'],
    ['TITAN', 'B600050', '2026-04-08', 0.75, 'PRS', 'DESIGNER'],
    ['TITAN', 'B600050', '2026-04-08', 0.5,  'PRS', 'DESIGNER'],
    ['TITAN', 'B600140', '2026-04-10', 3.75, 'PRS', 'DESIGNER'],
    ['TITAN', 'B600126', '2026-04-02', 4,    'NMM', 'DESIGNER'],
    // ── TITAN Apr 16-30 ────────────────────────────────────
    ['TITAN', 'B600147', '2026-04-22', 1,    'PBG', 'TEAM_LEAD'], // invoice shows 2026-05-22 (typo)
    ['TITAN', 'P-169',   '2026-04-16', 6.5,  'PRS', 'DESIGNER'],
    ['TITAN', 'B600147', '2026-04-22', 4,    'PRS', 'DESIGNER'],
    ['TITAN', 'B600147', '2026-04-22', 2.5,  'PRS', 'DESIGNER']
  ];

  // ── Row builder ────────────────────────────────────────────

  function buildRow_(entry, idx) {
    var workDate = entry[2];
    var periodId = workDate.substring(0, 7);
    var iKey     = 'RECON-' + (idx < 10 ? '000' : idx < 100 ? '00' : idx < 1000 ? '0' : '') + idx;
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

  // ── Public API ─────────────────────────────────────────────

  /**
   * Inserts all RECON_ENTRIES_ into FACT_WORK_LOGS partitions.
   * Idempotent — already-processed entries are skipped via IdempotencyEngine.
   *
   * @param {string} actorEmail
   * @returns {{ inserted: number, skipped: number, failed: number }}
   */
  function fillMissing(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    Logger.info('RECON_FILL_START', {
      module: MODULE,
      batch:  RECON_BATCH,
      total:  RECON_ENTRIES_.length
    });

    var inserted     = 0;
    var skipped      = 0;
    var failed       = 0;
    var rowsByPeriod = {};

    RECON_ENTRIES_.forEach(function (entry, idx) {
      var workDate = entry[2];
      var periodId = workDate.substring(0, 7);
      var iKey     = 'RECON-' + (idx < 10 ? '000' : idx < 100 ? '00' : idx < 1000 ? '0' : '') + idx;

      if (!IdempotencyEngine.checkAndMark(iKey)) {
        skipped++;
        return;
      }

      var row = buildRow_(entry, idx);
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
        Logger.error('RECON_FILL_WRITE_FAILED', {
          module:  MODULE,
          period:  periodId,
          error:   e.message
        });
        failed   += rows.length;
        inserted -= rows.length;
      }
    });

    Logger.info('RECON_FILL_COMPLETE', {
      module:   MODULE,
      batch:    RECON_BATCH,
      inserted: inserted,
      skipped:  skipped,
      failed:   failed
    });

    return { inserted: inserted, skipped: skipped, failed: failed };
  }

  return { fillMissing: fillMissing };
}());

// ── Clear stuck idempotency keys (run once if filler was run before writes worked) ──
function runClearReconIdempotencyKeys() {
  var props = PropertiesService.getScriptProperties();
  var cleared = 0;
  for (var i = 0; i <= 430; i++) {
    var pad = i < 10 ? '000' : i < 100 ? '00' : i < 1000 ? '0' : '';
    var key = 'IDEM_RECON-' + pad + i;
    if (props.getProperty(key) !== null) {
      props.deleteProperty(key);
      cleared++;
    }
  }
  console.log('[MigrationReconFiller] Cleared ' + cleared + ' idempotency keys.');
}

// ── Top-level runner ───────────────────────────────────────────
/**
 * Run from Apps Script editor after enabling migration overrides.
 * Safe to re-run — idempotent.
 */
function runFillMissingWorkLogs() {
  console.log('═══════════════════════════════════════════');
  console.log('[MigrationReconFiller] Inserting invoice work logs');
  console.log('  Batch: ' + 'BATCH-RECON-001');
  console.log('  Entries: ' + 431);
  console.log('═══════════════════════════════════════════');
  try {
    var result = MigrationReconFiller.fillMissing('blccanada2026@gmail.com');
    console.log('[MigrationReconFiller] Complete:');
    console.log('  inserted=' + result.inserted);
    console.log('  skipped='  + result.skipped);
    console.log('  failed='   + result.failed);
    if (result.failed > 0) {
      console.log('  ❌ Some writes failed — check Logger for RECON_FILL_WRITE_FAILED');
    } else {
      console.log('  ✅ Done');
    }
  } catch (e) {
    console.log('  ❌ fillMissing failed: ' + e.message);
  }
  console.log('═══════════════════════════════════════════');
}
