/**
 * SeedStaffImport.gs
 * ─────────────────────────────────────────────────────────────────
 * One-time setup: populate STG_STAFF_IMPORT with BLC staff records
 * collected April 2026.
 *
 * Run order:
 *   1. SetupScript.setupAll()          — creates all sheets
 *   2. seedStaffImport()               — this file, fills staging table
 *   3. StaffOnboarding.bulkOnboardStaff('raj.nair@bluelotuscanada.ca')
 *                                      — promotes to DIM_STAFF_ROSTER + BANKING
 *
 * Safe to re-run: rows with import_status='IMPORTED' are skipped by bulkOnboard.
 * Do NOT re-run seedStaffImport after bulkOnboard has run unless you clear the sheet.
 */

/* global SpreadsheetApp, Logger */

function seedStaffImport() {
  var ss     = SpreadsheetApp.getActiveSpreadsheet();
  var sheet  = ss.getSheetByName('STG_STAFF_IMPORT');
  if (!sheet) {
    throw new Error('STG_STAFF_IMPORT sheet not found. Run SetupScript.setupAll() first.');
  }

  // Column order must match SetupScript header definition exactly.
  var COLS = [
    'person_code', 'name', 'email', 'role',
    'supervisor_code', 'pm_code',
    'pay_currency', 'pay_design', 'pay_qc',
    'bonus_eligible', 'effective_from',
    'bank_country', 'account_holder_name', 'bank_name',
    'account_number', 'account_type',
    'ifsc_code',
    'institution_number', 'transit_number', 'routing_number',
    'swift_bic', 'iban',
    'bank_branch', 'bank_address',
    'purpose_of_payment', 'ofx_recipient_id',
    'notes', 'import_status', 'import_notes'
  ];

  // ── Staff data ────────────────────────────────────────────────
  // Fields: person_code, name, email, role, supervisor_code, pm_code,
  //         pay_currency, pay_design, pay_qc, bonus_eligible, effective_from,
  //         bank_country, account_holder_name, bank_name,
  //         account_number, account_type, ifsc_code,
  //         [canada/usa fields = ''], [swift/iban = ''],
  //         bank_branch, bank_address, purpose_of_payment, ofx_recipient_id,
  //         notes, import_status, import_notes
  //
  // supervisor_code convention:
  //   DESIGNER → their Team Lead's person_code
  //   TEAM_LEAD → their managing TL or PM's person_code (per org chart)
  //   PM        → '' (reports to CEO externally)
  //
  // All pay in INR. bonus_eligible=FALSE for everyone — eligibility is
  // determined at run-time by start_date (≥1 year). CEO can override manually.

  var rows = [
    // ── Project Managers ──────────────────────────────────────────────────
    {
      person_code:        'SGO',
      name:               'Sarthak Ghosh',
      email:              'sarthakaespl@gmail.com',
      role:               'PM',
      supervisor_code:    '',
      pm_code:            '',
      pay_currency:       'INR',
      pay_design:         500,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Sarthak Ghosh',
      bank_name:          'Axis Bank Ltd',
      account_number:     '922010017432810',
      account_type:       'Savings',
      ifsc_code:          'UTIB0001031',
      notes:              'OFX nick: Sarthak Ghosh'
    },

    // ── Team Leads ────────────────────────────────────────────────────────
    {
      person_code:        'BCH',
      name:               'Bharath Charles',
      email:              'bharathchunarkar121@gmail.com',
      role:               'TEAM_LEAD',
      supervisor_code:    '',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         400,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Chunarkar Bharath',
      bank_name:          'IDFC First Bank Limited',
      account_number:     '10079855951',
      account_type:       'Savings',
      ifsc_code:          'IDFB0080221',
      notes:              'OFX nick: Chunarkar Bharath; legal name Chunarkar Bharath'
    },
    {
      person_code:        'SDA',
      name:               'Samar Kumar Das',
      email:              'samar.das1995@gmail.com',
      role:               'TEAM_LEAD',
      supervisor_code:    'SGO',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         350,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Samar Kumar Das',
      bank_name:          'State Bank of India',
      account_number:     '35651986955',
      account_type:       'Savings',
      ifsc_code:          'SBIN0014090',
      notes:              'OFX nick: Sandy'
    },
    {
      person_code:        'PBG',
      name:               'Pabitra Ghosh',
      email:              'pabitra8846@gmail.com',
      role:               'TEAM_LEAD',
      supervisor_code:    'SDA',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         300,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Pabitra Ghosh',
      bank_name:          'ICICI Bank Limited',
      account_number:     '269101502252',
      account_type:       'Savings',
      ifsc_code:          'ICIC0002691',
      notes:              'BLC email: pabitra@bluelotuscanada.ca'
    },
    {
      person_code:        'SVN',
      name:               'Savvy Nath',
      email:              'subonath2018@gmail.com',
      role:               'TEAM_LEAD',
      supervisor_code:    'SDA',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         300,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Subo',
      bank_name:          'State Bank of India',
      account_number:     '34176713928',
      account_type:       'Savings',
      ifsc_code:          'SBIN0000106',
      notes:              'OFX nick: Nath; legal name Subonath'
    },

    // ── QC ────────────────────────────────────────────────────────────────
    {
      person_code:        'RKU',
      name:               'Raj Kumar',
      email:              'rky9133@gmail.com',
      role:               'QC',
      supervisor_code:    'BCH',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         0,
      pay_qc:             350,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Udutha Raj Kumar',
      bank_name:          'State Bank of India',
      account_number:     '62306404326',
      account_type:       'Savings',
      ifsc_code:          'SBIN0020303',
      notes:              'OFX nick: Udutha Raj Kumar'
    },

    // ── Senior Designers (billed at designer rate, managed by PM directly) ─
    {
      person_code:        'DBG',
      name:               'Debarati Ghosh',
      email:              'debiaespl@gmail.com',
      role:               'DESIGNER',
      supervisor_code:    'SGO',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         450,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Debarati Ghosh',
      bank_name:          'Axis Bank Ltd',
      account_number:     '922010017424961',
      account_type:       'Savings',
      ifsc_code:          'UTIB0001031',
      notes:              'Senior Designer; OFX nick: Debarati Ghosh'
    },
    {
      person_code:        'DBS',
      name:               'Deb Sen',
      email:              'debnathsen9831@gmail.com',
      role:               'DESIGNER',
      supervisor_code:    'SGO',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         300,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Debnath Sen',
      bank_name:          'Central Bank of India',
      account_number:     '3486889902',
      account_type:       'Savings',
      ifsc_code:          'CBIN0281317',
      notes:              'Senior Designer; reports to SGO directly'
    },

    // ── Designers ─────────────────────────────────────────────────────────
    {
      person_code:        'PRS',
      name:               'Priyanka Santra',
      email:              'priyanka.santra613@gmail.com',
      role:               'DESIGNER',
      supervisor_code:    'PBG',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         250,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Priyanka Santra',
      bank_name:          'State Bank of India',
      account_number:     '34001118329',
      account_type:       'Savings',
      ifsc_code:          'SBIN0001414'
    },
    {
      person_code:        'ABB',
      name:               'Abhijit Bera',
      email:              'abhijitshilpamandira@gmail.com',
      role:               'DESIGNER',
      supervisor_code:    'SVN',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         300,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Abhijit Bera',
      bank_name:          'UCO Bank',
      account_number:     '12740110012673',
      account_type:       'Savings',
      ifsc_code:          'UCBA0001274',
      notes:              'BLC email: a.bera@bluelotuscanada.ca'
    },
    {
      person_code:        'SYR',
      name:               'Sayan Roy',
      email:              'sr5062407@gmail.com',
      role:               'DESIGNER',
      supervisor_code:    'BCH',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         250,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Sayan Roy',
      bank_name:          'State Bank of India',
      account_number:     '40786064449',
      account_type:       'Savings',
      ifsc_code:          'SBIN0012365'
    },
    {
      person_code:        'BSG',
      name:               'Banik Sagar',
      email:              'sagarbanik77@gmail.com',
      role:               'DESIGNER',
      supervisor_code:    'SDA',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         300,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Anubrata Banik',
      bank_name:          'State Bank of India',
      account_number:     '20382863610',
      account_type:       'Savings',
      ifsc_code:          'SBIN0001745',
      notes:              'BLC email: sagar.b@bluelotuscanada.ca; legal name Anubrata Banik'
    },
    {
      person_code:        'VKV',
      name:               'Vani KV',
      email:              'kolimivani@gmail.com',
      role:               'DESIGNER',
      supervisor_code:    'BCH',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         250,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Kolimi Venkata Vani',
      bank_name:          'ICICI Bank Limited',
      account_number:     '236301514223',
      account_type:       'Savings',
      ifsc_code:          'ICIC0002363',
      notes:              'BLC email: vani@bluelotuscanada.ca'
    },
    {
      person_code:        'RKG',
      name:               'RaviKumar Gummadi',
      email:              'ravigummadi12@gmail.com',
      role:               'DESIGNER',
      supervisor_code:    'BCH',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         250,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Gummadi Ravikumar',
      bank_name:          'IDFC First Bank Limited',
      account_number:     '10088714044',
      account_type:       'Savings',
      ifsc_code:          'IDFB0080205',
      notes:              'BLC email: ravikumar@bluelotuscanada.ca'
    },
    {
      person_code:        'NMM',
      name:               'Nitesh Mishra',
      email:              'nitishrickybahl.nrb@gmail.com',
      role:               'DESIGNER',
      supervisor_code:    'PBG',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         250,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      bank_country:       'India',
      account_holder_name:'Nitesh Mishra',
      bank_name:          'State Bank of India',
      account_number:     '35143240779',
      account_type:       'Savings',
      ifsc_code:          'SBIN0012461'
    },

    // ── Active — banking pending ───────────────────────────────────────────
    {
      person_code:        'JYS',
      name:               'Joy Sarkar',
      email:              'joysarkar21.1143@gmail.com',
      role:               'DESIGNER',
      supervisor_code:    '',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         350,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2024-01-01',
      notes:              'Banking pending — add later via StaffOnboarding.updateBanking()'
    },
    {
      person_code:        'AR001',
      name:               'Abhisek Rit',
      email:              'abhisek.architect@gmail.com',
      role:               'DESIGNER',
      supervisor_code:    'SGO',
      pm_code:            'SGO',
      pay_currency:       'INR',
      pay_design:         350,
      pay_qc:             0,
      bonus_eligible:     'FALSE',
      effective_from:     '2026-03-12',
      notes:              'Onboarded 2026-03-12; < 1 yr — not bonus eligible until 2027-03-12 or CEO override. Banking pending.'
    }
  ];

  // ── Write rows to sheet ───────────────────────────────────────
  var written = 0;
  rows.forEach(function(record) {
    var row = COLS.map(function(col) {
      var v = record[col];
      return v !== undefined ? v : '';
    });
    sheet.appendRow(row);
    written++;
  });

  console.log('seedStaffImport: wrote ' + written + ' rows to STG_STAFF_IMPORT.');
  console.log('Next step: run StaffOnboarding.bulkOnboardStaff("raj.nair@bluelotuscanada.ca")');
}
