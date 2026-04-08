// ============================================================
// StaffOnboarding.gs — BLC Nexus T8 Staff Management
// src/08-staff/StaffOnboarding.gs
//
// LOAD ORDER: T8. Loads after all T0–T7 files.
// DEPENDENCIES: Config (T0), Identifiers (T0), DAL (T1),
//               RBAC (T2), Logger (T3)
//
// ╔══════════════════════════════════════════════════════════╗
// ║  Complete staff lifecycle management:                   ║
// ║                                                         ║
// ║  onboardStaff(actorEmail, payload)                      ║
// ║    1. Validates all required fields                     ║
// ║    2. Writes DIM_STAFF_ROSTER (profile + pay config)    ║
// ║    3. Writes DIM_STAFF_BANKING (OFX/wire transfer info) ║
// ║    4. Returns { personCode, isNew }                     ║
// ║                                                         ║
// ║  generateContract(actorEmail, personCode)               ║
// ║    1. Loads staff + banking details                     ║
// ║    2. Creates Google Doc contractor agreement           ║
// ║    3. Writes DIM_STAFF_CONTRACTS metadata               ║
// ║    4. Returns { contractId, docUrl, docTitle }          ║
// ║                                                         ║
// ║  getStaffList(actorEmail)                               ║
// ║    → All active staff enriched with contract/banking    ║
// ║      status (not the sensitive details themselves)      ║
// ║                                                         ║
// ║  getBankingDetails(actorEmail, personCode)              ║
// ║    → CEO only: full banking record for a staff member   ║
// ║                                                         ║
// ║  Permission: ADMIN_CONFIG (CEO + ADMIN roles)           ║
// ║  Banking view: PAYROLL_RUN (CEO only)                   ║
// ╚══════════════════════════════════════════════════════════╝
//
// OFX FIELD GUIDE (India staff):
//   account_holder_name → MUST match bank records exactly (OFX compliance)
//   account_number      → Savings/Current account number
//   ifsc_code           → 11-character branch code (e.g. HDFC0001234)
//   account_type        → Savings / Current / NRE / NRO
//   purpose_of_payment  → "Contract services payment" (default)
//
// OFX FIELD GUIDE (International / Canada):
//   swift_bic           → 8 or 11 character SWIFT/BIC code
//   iban                → International Bank Account Number
//   routing_number      → US: 9-digit ABA routing number
//   institution_number  → Canada: 3-digit bank code
//   transit_number      → Canada: 5-digit branch code
//
// CONTRACT FOLDER:
//   Contracts are saved to a Drive folder named 'BLC Contractor Agreements'.
//   If the folder doesn't exist it is created automatically.
//
// CALL PATTERN:
//   StaffOnboarding.onboardStaff('raj.nair@bluelotuscanada.ca', payload);
//   StaffOnboarding.generateContract('raj.nair@...', 'DS5');
// ============================================================

var StaffOnboarding = (function () {

  var MODULE = 'StaffOnboarding';

  // ── Folder name for generated contracts in Google Drive ─────
  var CONTRACT_FOLDER_NAME = 'BLC Contractor Agreements';

  // ============================================================
  // SECTION 1: onboardStaff
  //
  // Writes (or updates) DIM_STAFF_ROSTER + DIM_STAFF_BANKING.
  // Idempotent: if person_code already exists, existing rows
  // are NOT modified — returns isNew=false as a signal.
  // ============================================================

  /**
   * @param {string} actorEmail
   * @param {Object} payload
   *   Required:
   *     person_code, name, email, role
   *     pay_currency, pay_design, pay_qc
   *     effective_from
   *   Optional:
   *     supervisor_code, pm_code, bonus_eligible, notes
   *   Banking (all optional at onboarding — can be added later):
   *     account_holder_name, bank_name, bank_country, bank_branch,
   *     bank_address, account_number, account_type,
   *     ifsc_code, swift_bic, iban, routing_number,
   *     institution_number, transit_number,
   *     purpose_of_payment, ofx_recipient_id
   *
   * @returns {{ personCode: string, isNew: boolean }}
   */
  function onboardStaff(actorEmail, payload) {
    // ── Auth ──────────────────────────────────────────────────
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    // ── Validate required fields ──────────────────────────────
    var required = ['person_code', 'name', 'email', 'role', 'pay_currency',
                    'pay_design', 'pay_qc', 'effective_from'];
    for (var i = 0; i < required.length; i++) {
      if (!payload[required[i]] && payload[required[i]] !== 0) {
        throw new Error('StaffOnboarding: missing required field: ' + required[i]);
      }
    }

    var personCode = String(payload.person_code).trim().toUpperCase();
    var role       = String(payload.role).trim().toUpperCase();

    var validRoles = { DESIGNER: 1, QC: 1, TEAM_LEAD: 1, PM: 1, CEO: 1, ADMIN: 1 };
    if (!validRoles[role]) {
      throw new Error('StaffOnboarding: invalid role "' + role + '". Must be: DESIGNER, QC, TEAM_LEAD, PM, CEO, or ADMIN');
    }

    var validCurrencies = { INR: 1, CAD: 1, USD: 1 };
    var payCurrency = String(payload.pay_currency).trim().toUpperCase();
    if (!validCurrencies[payCurrency]) {
      throw new Error('StaffOnboarding: invalid pay_currency "' + payCurrency + '". Must be INR, CAD, or USD.');
    }

    // ── Check if person_code already exists ───────────────────
    var existing;
    try {
      existing = DAL.readWhere(
        Config.TABLES.DIM_STAFF_ROSTER,
        { person_code: personCode },
        { callerModule: MODULE }
      );
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') existing = [];
      else throw e;
    }

    var isNew = !existing || existing.length === 0;

    if (!isNew) {
      Logger.warn('STAFF_ONBOARD_EXISTS', {
        module:      MODULE,
        message:     'person_code already exists in DIM_STAFF_ROSTER — skipping roster write',
        person_code: personCode
      });
    } else {
      // ── Write DIM_STAFF_ROSTER ─────────────────────────────
      var rosterRow = {
        person_code:     personCode,
        name:            String(payload.name).trim(),
        email:           String(payload.email).trim().toLowerCase(),
        role:            role,
        supervisor_code: String(payload.supervisor_code || '').trim(),
        pm_code:         String(payload.pm_code         || '').trim(),
        pay_currency:    payCurrency,
        pay_design:      parseFloat(payload.pay_design) || 0,
        pay_qc:          parseFloat(payload.pay_qc)     || 0,
        bonus_eligible:  payload.bonus_eligible === true || payload.bonus_eligible === 'TRUE' ? 'TRUE' : 'FALSE',
        active:          'TRUE',
        effective_from:  String(payload.effective_from).trim(),
        effective_to:    ''
      };

      DAL.appendRow(Config.TABLES.DIM_STAFF_ROSTER, rosterRow, { callerModule: MODULE });

      Logger.info('STAFF_ONBOARDED', {
        module:      MODULE,
        message:     'Staff member added to DIM_STAFF_ROSTER',
        person_code: personCode,
        role:        role,
        actor:       actorEmail
      });
    }

    // ── Write DIM_STAFF_BANKING (if banking fields provided) ──
    var hasBankingData = payload.account_number || payload.iban || payload.ifsc_code || payload.swift_bic;

    if (hasBankingData) {
      // Check for existing banking row
      var existingBanking;
      try {
        existingBanking = DAL.readWhere(
          Config.TABLES.DIM_STAFF_BANKING,
          { person_code: personCode },
          { callerModule: MODULE }
        );
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') existingBanking = [];
        else throw e;
      }

      if (existingBanking && existingBanking.length > 0) {
        Logger.warn('STAFF_BANKING_EXISTS', {
          module:      MODULE,
          message:     'Banking record already exists — skipping banking write. Use updateBanking() to change.',
          person_code: personCode
        });
      } else {
        var bankingRow = {
          person_code:         personCode,
          account_holder_name: String(payload.account_holder_name || payload.name || '').trim(),
          bank_name:           String(payload.bank_name           || '').trim(),
          bank_country:        String(payload.bank_country        || 'India').trim(),
          bank_branch:         String(payload.bank_branch         || '').trim(),
          bank_address:        String(payload.bank_address        || '').trim(),
          account_number:      String(payload.account_number      || '').trim(),
          account_type:        String(payload.account_type        || 'Savings').trim(),
          ifsc_code:           String(payload.ifsc_code           || '').trim().toUpperCase(),
          swift_bic:           String(payload.swift_bic           || '').trim().toUpperCase(),
          iban:                String(payload.iban                || '').trim().toUpperCase(),
          routing_number:      String(payload.routing_number      || '').trim(),
          institution_number:  String(payload.institution_number  || '').trim(),
          transit_number:      String(payload.transit_number      || '').trim(),
          currency:            payCurrency,
          purpose_of_payment:  String(payload.purpose_of_payment  || 'Contract services payment').trim(),
          ofx_recipient_id:    String(payload.ofx_recipient_id    || '').trim(),
          active:              'TRUE',
          created_at:          new Date().toISOString(),
          notes:               String(payload.banking_notes       || '').trim()
        };

        DAL.appendRow(Config.TABLES.DIM_STAFF_BANKING, bankingRow, { callerModule: MODULE });

        Logger.info('STAFF_BANKING_SAVED', {
          module:      MODULE,
          message:     'Banking details saved to DIM_STAFF_BANKING',
          person_code: personCode,
          bank_country: bankingRow.bank_country
        });
      }
    }

    return { personCode: personCode, isNew: isNew };
  }

  // ============================================================
  // SECTION 2: generateContract
  //
  // Creates a Google Doc Independent Contractor Agreement.
  // Saves the document to the 'BLC Contractor Agreements' Drive folder.
  // Writes metadata to DIM_STAFF_CONTRACTS.
  // ============================================================

  /**
   * @param {string} actorEmail  CEO or Admin
   * @param {string} personCode
   * @param {Object} [options]
   * @param {string} [options.startDate]      Default: today
   * @param {string} [options.jurisdiction]   Default: 'Province of Saskatchewan, Canada'
   * @returns {{ contractId: string, docUrl: string, docTitle: string }}
   */
  function generateContract(actorEmail, personCode, options) {
    options = options || {};

    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    // ── Load staff record ─────────────────────────────────────
    var staffRows;
    try {
      staffRows = DAL.readWhere(
        Config.TABLES.DIM_STAFF_ROSTER,
        { person_code: personCode },
        { callerModule: MODULE }
      );
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') staffRows = [];
      else throw e;
    }

    if (!staffRows || staffRows.length === 0) {
      throw new Error('No staff record found for person_code: ' + personCode);
    }

    var staff = staffRows[0];

    // ── Contract metadata ─────────────────────────────────────
    var today        = new Date();
    var contractDate = today.toLocaleDateString('en-CA');   // YYYY-MM-DD
    var startDate    = options.startDate || String(staff.effective_from || contractDate);
    var jurisdiction = options.jurisdiction || 'Province of Saskatchewan, Canada';
    var rate         = parseFloat(staff.pay_design) || 0;
    var rateCurrency = String(staff.pay_currency || 'INR').toUpperCase();
    var contractId   = 'CON-' + personCode + '-' + today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0');
    var docTitle     = 'BLC Contractor Agreement — ' + staff.name + ' — ' + startDate;

    // ── Build Google Doc ──────────────────────────────────────
    var docUrl = buildContractDocument_(staff, {
      contractId:   contractId,
      contractDate: contractDate,
      startDate:    startDate,
      jurisdiction: jurisdiction,
      rate:         rate,
      rateCurrency: rateCurrency,
      docTitle:     docTitle
    });

    // ── Save contract metadata ────────────────────────────────
    var contractRow = {
      contract_id:   contractId,
      person_code:   personCode,
      contract_type: 'INDEPENDENT_CONTRACTOR',
      jurisdiction:  jurisdiction,
      start_date:    startDate,
      end_date:      '',
      rate:          rate,
      rate_currency: rateCurrency,
      rate_period:   'HOURLY',
      doc_title:     docTitle,
      doc_url:       docUrl,
      status:        'DRAFT',
      generated_at:  new Date().toISOString(),
      generated_by:  actor.personCode || actorEmail,
      notes:         ''
    };

    DAL.appendRow(Config.TABLES.DIM_STAFF_CONTRACTS, contractRow, { callerModule: MODULE });

    Logger.info('CONTRACT_GENERATED', {
      module:      MODULE,
      message:     'Contractor agreement generated',
      person_code: personCode,
      contract_id: contractId,
      doc_url:     docUrl
    });

    return { contractId: contractId, docUrl: docUrl, docTitle: docTitle };
  }

  // ============================================================
  // SECTION 3: buildContractDocument_ (private)
  //
  // Creates the Google Doc using DocumentApp.
  // Returns the document URL.
  // ============================================================

  function buildContractDocument_(staff, meta) {
    var doc  = DocumentApp.create(meta.docTitle);
    var body = doc.getBody();

    // ── Styles ────────────────────────────────────────────────
    var H1 = DocumentApp.ParagraphHeading.HEADING1;
    var H2 = DocumentApp.ParagraphHeading.HEADING2;
    var H3 = DocumentApp.ParagraphHeading.HEADING3;
    var NORMAL = DocumentApp.ParagraphHeading.NORMAL;

    function addHeading(text, level) {
      return body.appendParagraph(text).setHeading(level);
    }

    function addPara(text) {
      return body.appendParagraph(text).setHeading(NORMAL);
    }

    function addBlank() {
      body.appendParagraph('');
    }

    // ── TITLE ─────────────────────────────────────────────────
    addHeading('INDEPENDENT CONTRACTOR AGREEMENT', H1)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    addBlank();

    // ── PREAMBLE ──────────────────────────────────────────────
    addPara('This Independent Contractor Agreement ("Agreement") is made and entered into ' +
            'as of ' + meta.contractDate + ' between:');
    addBlank();

    addHeading('COMPANY', H3);
    addPara('Blue Lotus Consulting Corporation');
    addPara('(hereinafter referred to as "Company")');
    addBlank();

    addHeading('CONTRACTOR', H3);
    addPara(staff.name);
    addPara('Email: ' + (staff.email || ''));
    addPara('(hereinafter referred to as "Contractor")');
    addBlank();

    addPara('WHEREAS, the Company desires to retain the professional services of the Contractor; and');
    addPara('WHEREAS, the Contractor desires to provide such services under the terms and conditions set forth herein;');
    addBlank();
    addPara('NOW, THEREFORE, in consideration of the mutual covenants contained herein, the parties agree as follows:');
    addBlank();

    // ── SECTION 1: SERVICES ───────────────────────────────────
    addHeading('1. SERVICES', H2);
    addPara('1.1  The Contractor agrees to provide structural design, drafting, and related technical services ' +
            'as assigned by the Company from time to time ("Services"). The Contractor\'s designated role is: ' +
            staff.role + '.');
    addPara('1.2  Services shall be performed remotely and submitted digitally via the Company\'s project ' +
            'management system (BLC Nexus).');
    addPara('1.3  The Contractor shall maintain the quality standards and turnaround times as communicated ' +
            'by the Company or its designees.');
    addPara('1.4  The Contractor shall log all hours in the Company\'s time-tracking system. Only logged ' +
            'and approved hours shall be compensated.');
    addBlank();

    // ── SECTION 2: COMPENSATION ───────────────────────────────
    addHeading('2. COMPENSATION', H2);
    addPara('2.1  The Company shall pay the Contractor at the following rates for Services rendered:');
    addPara('       Design work:  ' + meta.rate + ' ' + meta.rateCurrency + ' per hour');
    addPara('       QC work:      ' + (parseFloat(staff.pay_qc) || 0) + ' ' + meta.rateCurrency + ' per hour');
    addPara('2.2  All compensation is expressed in ' + meta.rateCurrency + '.');
    addPara('2.3  The Contractor shall also be eligible for a supervisor bonus (if applicable) ' +
            'as per the Company\'s current compensation policy.');
    addBlank();

    // ── SECTION 3: PAYMENT SCHEDULE ───────────────────────────
    addHeading('3. PAYMENT SCHEDULE AND METHOD', H2);
    addPara('3.1  Payments shall be made within fifteen (15) calendar days following the end of each calendar month.');
    addPara('3.2  The Company shall process payment after the Contractor has reviewed and confirmed ' +
            'their monthly paystub in the BLC Portal.');
    addPara('3.3  Payments shall be made via international bank transfer to the Contractor\'s designated account ' +
            'as recorded in the Company\'s payment system.');
    addPara('3.4  The Company shall use commercially reasonable efforts to process transfers promptly via OFX, ' +
            'Wise, or a similar licensed international payment platform.');
    addPara('3.5  Bank transfer fees, if any, shall be borne by the Contractor.');
    addBlank();

    // ── SECTION 4: IP ─────────────────────────────────────────
    addHeading('4. INTELLECTUAL PROPERTY', H2);
    addPara('4.1  All work product, deliverables, designs, drawings, models, documents, and materials ' +
            'created by the Contractor in the course of performing Services ("Work Product") shall be the ' +
            'exclusive property of the Company and its clients from the moment of creation.');
    addPara('4.2  The Contractor hereby irrevocably assigns to the Company all intellectual property rights ' +
            'in and to the Work Product, including all copyrights, design rights, and related rights.');
    addPara('4.3  The Contractor shall not retain copies of Work Product beyond what is strictly necessary ' +
            'to perform the Services, and shall securely delete or return all materials upon request or termination.');
    addBlank();

    // ── SECTION 5: CONFIDENTIALITY ────────────────────────────
    addHeading('5. CONFIDENTIALITY', H2);
    addPara('5.1  The Contractor agrees to keep strictly confidential all information regarding the Company\'s ' +
            'clients, projects, pricing, business operations, and proprietary systems ("Confidential Information").');
    addPara('5.2  The Contractor shall not disclose client names, project details, rates, or any Confidential ' +
            'Information to any third party, including family members and other contractors.');
    addPara('5.3  This obligation of confidentiality shall survive the termination of this Agreement ' +
            'for a period of three (3) years.');
    addPara('5.4  The Contractor shall promptly notify the Company of any actual or suspected breach ' +
            'of confidentiality.');
    addBlank();

    // ── SECTION 6: INDEPENDENT CONTRACTOR ────────────────────
    addHeading('6. INDEPENDENT CONTRACTOR STATUS', H2);
    addPara('6.1  The Contractor is an independent contractor and not an employee, agent, or partner of the Company. ' +
            'Nothing in this Agreement creates an employment relationship.');
    addPara('6.2  The Contractor shall be solely responsible for all taxes, provident fund contributions, ' +
            'insurance, and statutory obligations applicable in their jurisdiction of residence.');
    addPara('6.3  The Contractor shall use their own equipment, software, internet connection, and workspace. ' +
            'The Company shall not provide tools or equipment unless expressly agreed in writing.');
    addPara('6.4  The Contractor may engage in other work, provided it does not conflict with the interests ' +
            'of the Company or its clients, and does not impair the timely delivery of Services.');
    addBlank();

    // ── SECTION 7: STANDARDS OF WORK ─────────────────────────
    addHeading('7. STANDARDS OF WORK AND QUALITY', H2);
    addPara('7.1  All Services shall be performed in a professional, competent, and timely manner.');
    addPara('7.2  Work shall comply with applicable building codes, structural standards, and the Company\'s ' +
            'quality guidelines as updated from time to time.');
    addPara('7.3  The Contractor shall participate in quality review (QC) processes as required and shall ' +
            'address rework requests promptly at no additional charge where the error is attributable ' +
            'to the Contractor.');
    addBlank();

    // ── SECTION 8: TERM AND TERMINATION ──────────────────────
    addHeading('8. TERM AND TERMINATION', H2);
    addPara('8.1  This Agreement commences on ' + meta.startDate + ' and continues indefinitely until terminated ' +
            'in accordance with this section.');
    addPara('8.2  Either party may terminate this Agreement by providing thirty (30) calendar days\' written notice ' +
            'to the other party.');
    addPara('8.3  The Company may terminate this Agreement immediately, without notice, for cause. Cause includes ' +
            'but is not limited to: material breach of confidentiality, failure to meet quality standards after ' +
            'notice, misconduct, or fraudulent time reporting.');
    addPara('8.4  Upon termination, the Contractor shall: (a) immediately cease all Services; (b) return or ' +
            'securely destroy all Company and client materials; and (c) submit a final invoice for approved hours ' +
            'up to the termination date.');
    addBlank();

    // ── SECTION 9: NON-SOLICITATION ──────────────────────────
    addHeading('9. NON-SOLICITATION', H2);
    addPara('9.1  During the term of this Agreement and for six (6) months following its termination, the ' +
            'Contractor shall not directly or indirectly solicit the Company\'s clients, employees, or other ' +
            'contractors for similar or competing services.');
    addBlank();

    // ── SECTION 10: LIMITATION OF LIABILITY ──────────────────
    addHeading('10. LIMITATION OF LIABILITY', H2);
    addPara('10.1  The Company\'s aggregate liability to the Contractor under or in connection with this Agreement ' +
            'shall not exceed the total amounts paid to the Contractor in the three (3) calendar months preceding ' +
            'the event giving rise to the claim.');
    addPara('10.2  Neither party shall be liable for indirect, consequential, or punitive damages.');
    addBlank();

    // ── SECTION 11: GOVERNING LAW ─────────────────────────────
    addHeading('11. GOVERNING LAW AND DISPUTE RESOLUTION', H2);
    addPara('11.1  This Agreement shall be governed by and construed in accordance with the laws of the ' +
            meta.jurisdiction + ', without regard to its conflict of law provisions.');
    addPara('11.2  Any dispute arising under or in connection with this Agreement shall first be addressed ' +
            'through good-faith negotiation. If unresolved within thirty (30) days, the dispute shall be ' +
            'referred to binding arbitration in ' + meta.jurisdiction + '.');
    addBlank();

    // ── SECTION 12: ENTIRE AGREEMENT ─────────────────────────
    addHeading('12. GENERAL PROVISIONS', H2);
    addPara('12.1  This Agreement constitutes the entire agreement between the parties with respect to its ' +
            'subject matter and supersedes all prior agreements and understandings.');
    addPara('12.2  Any amendment to this Agreement must be in writing and signed by authorised representatives ' +
            'of both parties.');
    addPara('12.3  If any provision of this Agreement is found to be unenforceable, the remaining provisions ' +
            'shall continue in full force.');
    addPara('12.4  This Agreement may be executed in counterparts, including electronically.');
    addBlank();

    // ── SIGNATURES ────────────────────────────────────────────
    addHeading('SIGNATURES', H2);
    addBlank();
    addPara('IN WITNESS WHEREOF, the parties have executed this Agreement as of ' + meta.contractDate + '.');
    addBlank();

    addPara('BLUE LOTUS CONSULTING CORPORATION');
    addBlank();
    addPara('Signature:  ___________________________________');
    addPara('Name:       Raj Nair');
    addPara('Title:      Chief Executive Officer');
    addPara('Date:       ___________________________________');
    addBlank();
    addBlank();

    addPara('CONTRACTOR');
    addBlank();
    addPara('Signature:  ___________________________________');
    addPara('Name:       ' + staff.name);
    addPara('Date:       ___________________________________');
    addBlank();

    // ── APPENDIX A: Contract Reference ───────────────────────
    addBlank();
    addPara('───────────────────────────────────────────────────────');
    addPara('Contract Reference: ' + meta.contractId);
    addPara('Generated:         ' + meta.contractDate);
    addPara('Person Code:       ' + staff.person_code);
    addPara('Role:              ' + staff.role);

    doc.saveAndClose();

    // ── Move to BLC Contracts folder ──────────────────────────
    try {
      var folder = getOrCreateContractFolder_();
      var file   = DriveApp.getFileById(doc.getId());
      folder.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    } catch (driveErr) {
      Logger.warn('CONTRACT_FOLDER_ERROR', {
        module:  MODULE,
        message: 'Could not move contract to BLC folder — stays in root Drive',
        error:   driveErr.message
      });
    }

    return doc.getUrl();
  }

  // ── Get or create the BLC Contractor Agreements Drive folder ─

  function getOrCreateContractFolder_() {
    var folders = DriveApp.getFoldersByName(CONTRACT_FOLDER_NAME);
    if (folders.hasNext()) return folders.next();
    return DriveApp.createFolder(CONTRACT_FOLDER_NAME);
  }

  // ============================================================
  // SECTION 4: getStaffList
  //
  // Returns all active staff with their contract + banking status
  // (no sensitive banking details — just a status flag).
  // ============================================================

  /**
   * @param {string} actorEmail
   * @returns {Object[]}  Array of staff summary objects
   */
  function getStaffList(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    // ── Load staff ────────────────────────────────────────────
    var staffRows;
    try {
      staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return [];
      throw e;
    }

    // ── Load contract status map { personCode → latest contract } ─
    var contractMap = {};
    try {
      var contractRows = DAL.readAll(Config.TABLES.DIM_STAFF_CONTRACTS, { callerModule: MODULE });
      for (var c = 0; c < contractRows.length; c++) {
        var crow = contractRows[c];
        var code = String(crow.person_code || '');
        // Keep latest (last generated_at wins)
        if (!contractMap[code] || crow.generated_at > contractMap[code].generated_at) {
          contractMap[code] = {
            contract_id:  crow.contract_id,
            status:       crow.status,
            generated_at: crow.generated_at,
            doc_url:      crow.doc_url
          };
        }
      }
    } catch (e) { /* table may not exist yet */ }

    // ── Load banking status map (boolean — not the details) ───
    var bankingMap = {};
    try {
      var bankingRows = DAL.readAll(Config.TABLES.DIM_STAFF_BANKING, { callerModule: MODULE });
      for (var b = 0; b < bankingRows.length; b++) {
        var brow = bankingRows[b];
        var bcode = String(brow.person_code || '');
        if (String(brow.active || '').toUpperCase() === 'TRUE') {
          bankingMap[bcode] = true;
        }
      }
    } catch (e) { /* table may not exist yet */ }

    // ── Build result ──────────────────────────────────────────
    var result = [];
    for (var i = 0; i < staffRows.length; i++) {
      var row = staffRows[i];
      if (String(row.active || '').toUpperCase() !== 'TRUE') continue;

      var code     = String(row.person_code || '');
      var contract = contractMap[code];

      result.push({
        person_code:     code,
        name:            String(row.name          || code),
        email:           String(row.email         || ''),
        role:            String(row.role          || ''),
        supervisor_code: String(row.supervisor_code || ''),
        pm_code:         String(row.pm_code       || ''),
        pay_currency:    String(row.pay_currency  || 'INR'),
        pay_design:      parseFloat(row.pay_design) || 0,
        pay_qc:          parseFloat(row.pay_qc)     || 0,
        bonus_eligible:  String(row.bonus_eligible || '') === 'TRUE',
        effective_from:  String(row.effective_from  || ''),
        has_banking:     !!bankingMap[code],
        contract_status: contract ? contract.status : 'NONE',
        contract_url:    contract ? contract.doc_url : '',
        contract_id:     contract ? contract.contract_id : ''
      });
    }

    // Sort: by role hierarchy then name
    var roleOrder = { CEO: 0, ADMIN: 1, PM: 2, TEAM_LEAD: 3, QC: 4, DESIGNER: 5 };
    result.sort(function(a, b) {
      var ra = roleOrder[a.role] !== undefined ? roleOrder[a.role] : 99;
      var rb = roleOrder[b.role] !== undefined ? roleOrder[b.role] : 99;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });

    return result;
  }

  // ============================================================
  // SECTION 5: getBankingDetails
  //
  // CEO-only: returns the full banking record for a staff member.
  // ============================================================

  /**
   * @param {string} actorEmail  CEO only
   * @param {string} personCode
   * @returns {Object|null}  Banking record or null if not found
   */
  function getBankingDetails(actorEmail, personCode) {
    var actor = RBAC.resolveActor(actorEmail);
    // Banking details require full financial access
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);

    var rows;
    try {
      rows = DAL.readWhere(
        Config.TABLES.DIM_STAFF_BANKING,
        { person_code: personCode },
        { callerModule: MODULE }
      );
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return null;
      throw e;
    }

    if (!rows || rows.length === 0) return null;

    // Return most recent active record
    var active = rows.filter(function(r) { return String(r.active || '').toUpperCase() === 'TRUE'; });
    return active.length > 0 ? active[active.length - 1] : null;
  }

  // ============================================================
  // SECTION 6: bulkOnboardStaff
  //
  // Reads STG_STAFF_IMPORT and processes every row that has not
  // already been imported (import_status is blank or 'ERROR').
  // Writes import_status + import_notes back to each row.
  //
  // Returns: { total, created, skipped, errors, results[] }
  // ============================================================

  /**
   * Reads STG_STAFF_IMPORT and onboards each eligible row.
   * Idempotent — rows with import_status='IMPORTED' are skipped.
   * Auth: CEO + ADMIN (ADMIN_CONFIG).
   *
   * @param {string} actorEmail
   * @returns {{ total: number, created: number, skipped: number, errors: number, results: Object[] }}
   */
  function bulkOnboardStaff(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    // ── Read the staging sheet ────────────────────────────────
    var importRows;
    try {
      importRows = DAL.readAll(Config.TABLES.STG_STAFF_IMPORT, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') {
        throw new Error('STG_STAFF_IMPORT sheet not found. Run SetupScript first to create it.');
      }
      throw e;
    }

    if (!importRows || importRows.length === 0) {
      return { total: 0, created: 0, skipped: 0, errors: 0, results: [] };
    }

    var summary = { total: 0, created: 0, skipped: 0, errors: 0, results: [] };

    for (var i = 0; i < importRows.length; i++) {
      var row = importRows[i];

      // Skip blank rows (no person_code)
      var personCode = String(row.person_code || '').trim().toUpperCase();
      if (!personCode) continue;

      summary.total++;

      // Skip already-imported rows
      var existingStatus = String(row.import_status || '').trim().toUpperCase();
      if (existingStatus === 'IMPORTED') {
        summary.skipped++;
        summary.results.push({ person_code: personCode, status: 'SKIPPED', reason: 'Already imported' });
        continue;
      }

      // ── Process the row ──────────────────────────────────────
      var statusToWrite;
      var notesToWrite;

      try {
        var result = onboardStaffRow_(actor, actorEmail, row);
        statusToWrite = result.isNew ? 'IMPORTED' : 'SKIPPED_EXISTS';
        notesToWrite  = result.isNew ? 'Created successfully' : 'person_code already in DIM_STAFF_ROSTER';

        if (result.isNew) {
          summary.created++;
        } else {
          summary.skipped++;
        }

        summary.results.push({
          person_code: personCode,
          name:        String(row.name || ''),
          status:      statusToWrite,
          reason:      notesToWrite
        });

      } catch (rowErr) {
        statusToWrite = 'ERROR';
        notesToWrite  = rowErr.message || 'Unknown error';
        summary.errors++;

        summary.results.push({
          person_code: personCode,
          name:        String(row.name || ''),
          status:      'ERROR',
          reason:      notesToWrite
        });

        Logger.warn('BULK_ONBOARD_ROW_ERROR', {
          module:      MODULE,
          message:     'Error processing import row',
          person_code: personCode,
          error:       notesToWrite
        });
      }

      // ── Write status back to staging sheet ───────────────────
      try {
        DAL.updateWhere(
          Config.TABLES.STG_STAFF_IMPORT,
          { person_code: personCode },
          { import_status: statusToWrite, import_notes: notesToWrite },
          { callerModule: MODULE }
        );
      } catch (updateErr) {
        // Non-fatal — the onboarding itself succeeded; only the feedback write failed
        Logger.warn('BULK_ONBOARD_STATUS_WRITE_FAILED', {
          module:      MODULE,
          message:     'Could not write import_status back to STG_STAFF_IMPORT',
          person_code: personCode,
          error:       updateErr.message
        });
      }
    }

    Logger.info('BULK_ONBOARD_COMPLETE', {
      module:  MODULE,
      message: 'Bulk staff import complete',
      total:   summary.total,
      created: summary.created,
      skipped: summary.skipped,
      errors:  summary.errors,
      actor:   actorEmail
    });

    return summary;
  }

  // ── Private helper: onboard a single row without auth re-check ─

  /**
   * Core onboarding logic extracted from onboardStaff() so that
   * bulkOnboardStaff() can auth once and call this per row.
   *
   * @param {Object} actor   Already-resolved RBAC actor
   * @param {string} actorEmail
   * @param {Object} payload  Row from STG_STAFF_IMPORT
   * @returns {{ personCode: string, isNew: boolean }}
   */
  function onboardStaffRow_(actor, actorEmail, payload) {
    // Validate required fields
    var required = ['person_code', 'name', 'email', 'role', 'pay_currency',
                    'pay_design', 'pay_qc', 'effective_from'];
    for (var i = 0; i < required.length; i++) {
      if (!payload[required[i]] && payload[required[i]] !== 0) {
        throw new Error('Missing required field: ' + required[i]);
      }
    }

    var personCode  = String(payload.person_code).trim().toUpperCase();
    var role        = String(payload.role).trim().toUpperCase();
    var payCurrency = String(payload.pay_currency).trim().toUpperCase();

    var validRoles      = { DESIGNER: 1, QC: 1, TEAM_LEAD: 1, PM: 1, CEO: 1, ADMIN: 1 };
    var validCurrencies = { INR: 1, CAD: 1, USD: 1 };

    if (!validRoles[role]) {
      throw new Error('Invalid role "' + role + '"');
    }
    if (!validCurrencies[payCurrency]) {
      throw new Error('Invalid pay_currency "' + payCurrency + '"');
    }

    // Check for existing roster row
    var existing;
    try {
      existing = DAL.readWhere(
        Config.TABLES.DIM_STAFF_ROSTER,
        { person_code: personCode },
        { callerModule: MODULE }
      );
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') existing = [];
      else throw e;
    }

    var isNew = !existing || existing.length === 0;

    if (isNew) {
      var rosterRow = {
        person_code:     personCode,
        name:            String(payload.name).trim(),
        email:           String(payload.email).trim().toLowerCase(),
        role:            role,
        supervisor_code: String(payload.supervisor_code || '').trim(),
        pm_code:         String(payload.pm_code         || '').trim(),
        pay_currency:    payCurrency,
        pay_design:      parseFloat(payload.pay_design) || 0,
        pay_qc:          parseFloat(payload.pay_qc)     || 0,
        bonus_eligible:  payload.bonus_eligible === true || String(payload.bonus_eligible || '').toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
        active:          'TRUE',
        effective_from:  String(payload.effective_from).trim(),
        effective_to:    String(payload.effective_to || '')
      };
      DAL.appendRow(Config.TABLES.DIM_STAFF_ROSTER, rosterRow, { callerModule: MODULE });
    }

    // Write banking if provided
    var hasBankingData = payload.account_number || payload.iban || payload.ifsc_code || payload.swift_bic;
    if (hasBankingData) {
      var existingBanking;
      try {
        existingBanking = DAL.readWhere(
          Config.TABLES.DIM_STAFF_BANKING,
          { person_code: personCode },
          { callerModule: MODULE }
        );
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') existingBanking = [];
        else throw e;
      }

      if (!existingBanking || existingBanking.length === 0) {
        var bankingRow = {
          person_code:         personCode,
          account_holder_name: String(payload.account_holder_name || payload.name || '').trim(),
          bank_name:           String(payload.bank_name           || '').trim(),
          bank_country:        String(payload.bank_country        || 'India').trim(),
          bank_branch:         String(payload.bank_branch         || '').trim(),
          bank_address:        String(payload.bank_address        || '').trim(),
          account_number:      String(payload.account_number      || '').trim(),
          account_type:        String(payload.account_type        || 'Savings').trim(),
          ifsc_code:           String(payload.ifsc_code           || '').trim().toUpperCase(),
          swift_bic:           String(payload.swift_bic           || '').trim().toUpperCase(),
          iban:                String(payload.iban                || '').trim().toUpperCase(),
          routing_number:      String(payload.routing_number      || '').trim(),
          institution_number:  String(payload.institution_number  || '').trim(),
          transit_number:      String(payload.transit_number      || '').trim(),
          currency:            payCurrency,
          purpose_of_payment:  String(payload.purpose_of_payment  || 'Contract services payment').trim(),
          ofx_recipient_id:    String(payload.ofx_recipient_id    || '').trim(),
          active:              'TRUE',
          created_at:          new Date().toISOString(),
          notes:               String(payload.banking_notes       || '').trim()
        };
        DAL.appendRow(Config.TABLES.DIM_STAFF_BANKING, bankingRow, { callerModule: MODULE });
      }
    }

    return { personCode: personCode, isNew: isNew };
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    /**
     * Onboard a new staff member. Writes DIM_STAFF_ROSTER + DIM_STAFF_BANKING.
     * CEO + Admin only. Idempotent on person_code.
     */
    onboardStaff: onboardStaff,

    /**
     * Generate a Google Doc contractor agreement for a staff member.
     * Creates the document in Google Drive (BLC Contractor Agreements folder).
     * CEO + Admin only.
     */
    generateContract: generateContract,

    /**
     * Returns all active staff with contract + banking status flags.
     * Does NOT expose sensitive banking details.
     * CEO + Admin only.
     */
    getStaffList: getStaffList,

    /**
     * Returns full banking details for a staff member.
     * CEO only (PAYROLL_RUN permission required).
     */
    getBankingDetails: getBankingDetails,

    /**
     * Reads STG_STAFF_IMPORT and onboards each unprocessed row.
     * Writes import_status + import_notes back per row.
     * CEO + Admin only. Safe to re-run — already-IMPORTED rows are skipped.
     * Returns { total, created, skipped, errors, results[] }.
     */
    bulkOnboardStaff: bulkOnboardStaff
  };

}());
