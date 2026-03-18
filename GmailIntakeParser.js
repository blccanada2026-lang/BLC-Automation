// ============================================================
// GmailIntakeParser.gs
// Blue Lotus Consulting Corporation
// Automatically reads job emails from clients and queues them
// for allocation — zero manual typing of job numbers.
//
// HOW IT WORKS:
//   1. Runs every 30 minutes via a time-based trigger
//   2. Searches Gmail for emails from known client domains
//   3. Parses job number, product types, due date, notes
//   4. Creates rows in JOB_INTAKE sheet (one per product type)
//   5. Labels processed emails so they are never processed twice
//
// SUPPORTED CLIENT TYPES:
//   EMAIL  — Small clients (e.g. Titan) who email job details
//   MITEK  — Big clients accessed via MiTek terminal (import handled separately)
//   MANUAL — Fallback: Sarty types job directly into JOB_INTAKE sheet
//
// SETUP:
//   1. Add client rows to CLIENT_INTAKE_CONFIG sheet
//   2. Run setupEmailIntakeTrigger() once from the menu
//   3. System runs automatically from then on
// ============================================================


// ── JOB_INTAKE sheet column map (1-based for getRange) ──────
var JI = {
  intakeId:        1,   // A — e.g. INT-20260317-001
  clientCode:      2,   // B
  jobNumber:       3,   // C
  jobName:         4,   // D — from "Job Name is tagged:"
  productType:     5,   // E
  dueDate:         6,   // F — parsed date
  notes:           7,   // G — loading specs, special instructions
  urgent:          8,   // H — Yes / No
  sourceFrom:      9,   // I — sender email address
  sourceSubject:   10,  // J — email subject line
  sourceEmailDate: 11,  // K — when email was sent
  parsedDate:      12,  // L — when BLC system parsed it
  status:          13,  // M — Pending / Allocated / Duplicate / Error
  allocatedBy:     14,  // N — who allocated it (Sarty etc.)
  allocatedDate:   15   // O — when it was allocated
};

// ── CLIENT_INTAKE_CONFIG sheet column map (1-based) ─────────
var CIC = {
  clientCode:        1,  // A — must match CLIENT_MASTER clientCode
  intakeMethod:      2,  // B — EMAIL / MITEK / MANUAL
  senderEmailDomain: 3,  // C — e.g. titanmanufacturing.ca
  jobNumberPattern:  4,  // D — regex string e.g. B6\d{5}
  gmailLabel:        5,  // E — label to apply after processing
  active:            6   // F — Yes / No
};

// ── Product type keyword map ─────────────────────────────────
// Keys are lowercase search terms found in email body.
// Values are the canonical product type strings used in MASTER.
var PRODUCT_KEYWORDS = [
  { keyword: 'i-joist',    product: 'I-Joist Floor'      },
  { keyword: 'ijoist',     product: 'I-Joist Floor'      },
  { keyword: 'i joist',    product: 'I-Joist Floor'      },
  { keyword: 'floor',      product: 'Floor Truss'         },
  { keyword: 'roof',       product: 'Roof Truss'          },
  { keyword: 'wall',       product: 'Wall Frame'          },
  { keyword: 'lumber',     product: 'Lumber Estimation'   }
  // Note: I-Joist must come before Floor (to avoid "floor" matching I-Joist lines)
  // Note: Order matters — more specific keywords first
];

var GMAIL_PROCESSED_LABEL = 'BLC-Processed';
var INTAKE_STATUS_PENDING   = 'Pending';
var INTAKE_STATUS_DUPLICATE = 'Duplicate';
var INTAKE_STATUS_ERROR     = 'Error';


// ============================================================
// MAIN ENTRY POINT
// Called every 30 minutes by time-based trigger.
// ============================================================

function scanForNewJobEmails() {
  var FUNCTION_NAME = 'scanForNewJobEmails';
  var processed = 0, skipped = 0, errors = 0;

  try {
    var configs = getActiveEmailConfigs_();
    if (configs.length === 0) {
      logException('INFO', 'SYSTEM', FUNCTION_NAME,
        'No active EMAIL clients in CLIENT_INTAKE_CONFIG. Nothing to scan.');
      return;
    }

    // Ensure the processed label exists in Gmail
    ensureGmailLabel_(GMAIL_PROCESSED_LABEL);

    for (var i = 0; i < configs.length; i++) {
      var config = configs[i];
      try {
        var result = processClientEmails_(config);
        processed += result.processed;
        skipped   += result.skipped;
        errors    += result.errors;
      } catch (clientErr) {
        errors++;
        logException('ERROR', config.clientCode, FUNCTION_NAME,
          'Failed processing emails for client: ' + clientErr.message);
      }
    }

    logException('INFO', 'SYSTEM', FUNCTION_NAME,
      'Email scan complete. Processed: ' + processed +
      ' | Skipped (already done): ' + skipped +
      ' | Errors: ' + errors);

  } catch (err) {
    logException('ERROR', 'SYSTEM', FUNCTION_NAME,
      'scanForNewJobEmails crashed: ' + err.message);
  }
}


// ============================================================
// PROCESS ONE CLIENT'S EMAILS
// ============================================================

function processClientEmails_(config) {
  var FUNCTION_NAME = 'processClientEmails_';
  var processed = 0, skipped = 0, errors = 0;

  // Search for unprocessed emails from this client's domain
  // -label:BLC-Processed ensures we never double-process
  var query = 'from:' + config.senderEmailDomain +
              ' -label:' + GMAIL_PROCESSED_LABEL +
              ' in:inbox';

  var threads = GmailApp.search(query, 0, 50); // max 50 threads per run

  for (var t = 0; t < threads.length; t++) {
    try {
      var thread   = threads[t];
      var messages = thread.getMessages();
      // Use the FIRST message — it's the original job request
      var message  = messages[0];

      var from     = message.getFrom();
      var subject  = message.getSubject();
      var body     = message.getPlainBody();
      var sentDate = message.getDate();

      // Parse the email body
      var parsed = parseJobEmail_(body, config);

      if (!parsed.jobNumber) {
        // Could not find a job number — label and skip
        logException('WARNING', config.clientCode, FUNCTION_NAME,
          'No job number found in email from ' + from +
          ' | Subject: ' + subject);
        markEmailProcessed_(thread);
        skipped++;
        continue;
      }

      // Create one JOB_INTAKE row per product type found
      var productTypes = parsed.productTypes;
      if (productTypes.length === 0) {
        // No product type identified — create one row with blank product type
        // Sarty will fill it in manually from the intake queue
        productTypes = [''];
      }

      for (var p = 0; p < productTypes.length; p++) {
        var isDuplicate = checkDuplicateIntake_(
          config.clientCode, parsed.jobNumber, productTypes[p]
        );

        createIntakeRow_({
          clientCode:      config.clientCode,
          jobNumber:       parsed.jobNumber,
          jobName:         parsed.jobName,
          productType:     productTypes[p],
          dueDate:         parsed.dueDate,
          notes:           parsed.notes,
          urgent:          parsed.urgent ? 'Yes' : 'No',
          sourceFrom:      from,
          sourceSubject:   subject,
          sourceEmailDate: sentDate,
          status:          isDuplicate ? INTAKE_STATUS_DUPLICATE : INTAKE_STATUS_PENDING
        });
      }

      markEmailProcessed_(thread);
      processed++;

      logException('INFO', config.clientCode, FUNCTION_NAME,
        'Parsed email: Job ' + parsed.jobNumber +
        ' | Products: ' + (productTypes.join(', ') || 'unknown') +
        ' | Due: ' + parsed.dueDate +
        ' | Urgent: ' + (parsed.urgent ? 'YES' : 'No'));

    } catch (msgErr) {
      errors++;
      logException('ERROR', config.clientCode, FUNCTION_NAME,
        'Failed to process email thread ' + t + ': ' + msgErr.message);
      // Still mark as processed to avoid infinite retry loops
      try { markEmailProcessed_(threads[t]); } catch(e) {}
    }
  }

  return { processed: processed, skipped: skipped, errors: errors };
}


// ============================================================
// EMAIL PARSER — extracts structured data from raw email body
// All sub-functions are pure (no side effects) so they are
// easy to unit test.
// ============================================================

/**
 * parseJobEmail_(body, config)
 * Master parser — calls all sub-parsers and returns a clean object.
 *
 * @param {string} body   - plain text email body
 * @param {object} config - row from CLIENT_INTAKE_CONFIG
 * @returns {object} { jobNumber, jobName, productTypes[], dueDate, notes, urgent }
 */
function parseJobEmail_(body, config) {
  var text = body || '';

  return {
    jobNumber:    extractJobNumber_(text, config.jobNumberPattern),
    jobName:      extractJobName_(text),
    productTypes: extractProductTypes_(text),
    dueDate:      extractDueDate_(text),
    notes:        extractNotes_(text),
    urgent:       isUrgent_(text)
  };
}

/**
 * extractJobNumber_(text, pattern)
 * Uses the client-specific regex pattern stored in CLIENT_INTAKE_CONFIG.
 * Falls back to a general "Job # XXXXX" pattern if no client pattern set.
 *
 * Example:
 *   "CDN Job # B600105" with pattern "B6\d{5}" → "B600105"
 */
function extractJobNumber_(text, pattern) {
  if (!text) return '';

  // Try client-specific pattern first (most accurate)
  if (pattern) {
    try {
      var clientRegex = new RegExp(pattern, 'i');
      var clientMatch = text.match(clientRegex);
      if (clientMatch) return clientMatch[0].trim().toUpperCase();
    } catch (e) {
      // Invalid regex stored in config — fall through to generic
    }
  }

  // Generic fallback: look for "Job # XXXXX" or "Job Number: XXXXX"
  var genericPatterns = [
    /Job\s*#\s*([A-Z0-9][\w\-]{2,})/i,
    /Job\s+Number:?\s*([A-Z0-9][\w\-]{2,})/i,
    /Job\s+No\.?\s*:?\s*([A-Z0-9][\w\-]{2,})/i
  ];

  for (var i = 0; i < genericPatterns.length; i++) {
    var m = text.match(genericPatterns[i]);
    if (m) return m[1].trim().toUpperCase();
  }

  return '';
}

/**
 * extractJobName_(text)
 * Looks for "Job Name is tagged: XYZ" or similar patterns.
 *
 * Example:
 *   "Job Name is tagged: Macleod" → "Macleod"
 *   "Job Name is tagged: KI DREAM PROJECT" → "KI DREAM PROJECT"
 */
function extractJobName_(text) {
  if (!text) return '';

  var patterns = [
    /Job\s+Name\s+is\s+tagged:\s*(.+)/i,
    /Job\s+Name:\s*(.+)/i,
    /Tagged:\s*(.+)/i,
    /Project\s+Name:\s*(.+)/i
  ];

  for (var i = 0; i < patterns.length; i++) {
    var m = text.match(patterns[i]);
    if (m) return m[1].trim();
  }

  return '';
}

/**
 * extractProductTypes_(text)
 * Scans for product type keywords and returns all unique matches.
 * Returns an array because one email can contain multiple product types
 * (e.g. "Roof & Floor truss" → ["Roof Truss", "Floor Truss"]).
 *
 * IMPORTANT: More specific keywords (I-Joist) checked before general ones (Floor).
 */
function extractProductTypes_(text) {
  if (!text) return [];

  var lower    = text.toLowerCase();
  var found    = {};
  var results  = [];

  for (var i = 0; i < PRODUCT_KEYWORDS.length; i++) {
    var kw = PRODUCT_KEYWORDS[i];
    if (lower.indexOf(kw.keyword) !== -1 && !found[kw.product]) {
      found[kw.product] = true;
      results.push(kw.product);
    }
  }

  return results;
}

/**
 * extractDueDate_(text)
 * Parses informal due date expressions from email body.
 * Returns a JavaScript Date object, or empty string if not found.
 *
 * Handles:
 *   "Need this done by March 19 - morning"
 *   "NEED BACK BY JAN 12 (MORNING / FOR REVIEW)"
 *   "Need back by January 5"
 *   "Due: March 25"
 */
function extractDueDate_(text) {
  if (!text) return '';

  var duePhrasePatterns = [
    /Need\s+this\s+done\s+by\s+([A-Za-z]+\s+\d{1,2})/i,
    /NEED\s+BACK\s+BY\s+([A-Za-z]+\s+\d{1,2})/i,
    /Need\s+back\s+by\s+([A-Za-z]+\s+\d{1,2})/i,
    /Due\s+(?:by\s+)?:?\s*([A-Za-z]+\s+\d{1,2})/i,
    /Deadline:?\s*([A-Za-z]+\s+\d{1,2})/i,
    /By\s+([A-Za-z]+\s+\d{1,2})\s*[-–(]/i
  ];

  for (var i = 0; i < duePhrasePatterns.length; i++) {
    var m = text.match(duePhrasePatterns[i]);
    if (m) return parseDateString_(m[1]);
  }

  return '';
}

/**
 * parseDateString_(str)
 * Converts "March 19" or "Jan 12" to a Date object.
 * If the date is in the past, assumes next year.
 */
function parseDateString_(str) {
  var MONTHS = {
    'jan': 0,  'january': 0,
    'feb': 1,  'february': 1,
    'mar': 2,  'march': 2,
    'apr': 3,  'april': 3,
    'may': 4,
    'jun': 5,  'june': 5,
    'jul': 6,  'july': 6,
    'aug': 7,  'august': 7,
    'sep': 8,  'september': 8,
    'oct': 9,  'october': 9,
    'nov': 10, 'november': 10,
    'dec': 11, 'december': 11
  };

  var m = str.match(/([A-Za-z]+)\s+(\d{1,2})/);
  if (!m) return str; // return raw string if we can't parse

  var monthKey = m[1].toLowerCase();
  var day      = parseInt(m[2], 10);
  var monthNum = MONTHS[monthKey];

  if (monthNum === undefined || isNaN(day)) return str;

  var now  = new Date();
  var year = now.getFullYear();
  var date = new Date(year, monthNum, day);

  // If date is in the past, try next year
  if (date < now) date = new Date(year + 1, monthNum, day);

  return date;
}

/**
 * extractNotes_(text)
 * Picks up special instructions — loading specs, project context etc.
 * Looks for lines containing "Loading" or other known note patterns.
 *
 * Example:
 *   "Thunder Bay Loading" → "Thunder Bay Loading"
 *   "Big Trout Lake Loading" → "Big Trout Lake Loading"
 */
function extractNotes_(text) {
  if (!text) return '';

  var lines   = text.split('\n');
  var notes   = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    var lower = line.toLowerCase();

    // Loading specifications (Thunder Bay Loading, Big Trout Lake Loading, etc.)
    if (lower.indexOf('loading') !== -1) {
      notes.push(line);
      continue;
    }

    // "CDN Job" context line — useful to store
    if (lower.indexOf('cdn job') !== -1 && lower.indexOf('#') === -1) {
      notes.push(line);
      continue;
    }

    // Explicit urgent note lines
    if (lower.indexOf('urgent note') !== -1) {
      notes.push(line);
    }
  }

  return notes.join(' | ');
}

/**
 * isUrgent_(text)
 * Returns true if the email contains urgency indicators.
 *
 * Detects:
 *   "PLEASE MOVE TO TOP OF LIST"
 *   "URGENT" in all caps
 *   "RUSH"
 */
function isUrgent_(text) {
  if (!text) return false;

  var urgentPhrases = [
    'PLEASE MOVE TO TOP OF LIST',
    'MOVE TO TOP',
    'TOP PRIORITY',
    'URGENT',
    'RUSH JOB',
    'ASAP'
  ];

  var upper = text.toUpperCase();
  for (var i = 0; i < urgentPhrases.length; i++) {
    if (upper.indexOf(urgentPhrases[i]) !== -1) return true;
  }

  return false;
}


// ============================================================
// JOB_INTAKE SHEET OPERATIONS
// ============================================================

/**
 * createIntakeRow_(data)
 * Appends one row to the JOB_INTAKE sheet.
 */
function createIntakeRow_(data) {
  var sheet  = getSheet(CONFIG.sheets.jobIntake);
  var intakeId = generateIntakeId_();

  var row = new Array(15).fill('');
  row[JI.intakeId        - 1] = intakeId;
  row[JI.clientCode      - 1] = data.clientCode      || '';
  row[JI.jobNumber       - 1] = data.jobNumber        || '';
  row[JI.jobName         - 1] = data.jobName          || '';
  row[JI.productType     - 1] = data.productType      || '';
  row[JI.dueDate         - 1] = data.dueDate          || '';
  row[JI.notes           - 1] = data.notes            || '';
  row[JI.urgent          - 1] = data.urgent           || 'No';
  row[JI.sourceFrom      - 1] = data.sourceFrom       || '';
  row[JI.sourceSubject   - 1] = data.sourceSubject    || '';
  row[JI.sourceEmailDate - 1] = data.sourceEmailDate  || '';
  row[JI.parsedDate      - 1] = new Date();
  row[JI.status          - 1] = data.status           || INTAKE_STATUS_PENDING;
  row[JI.allocatedBy     - 1] = '';
  row[JI.allocatedDate   - 1] = '';

  sheet.appendRow(row);
}

/**
 * checkDuplicateIntake_(clientCode, jobNumber, productType)
 * Returns true if this exact job+product already exists in JOB_INTAKE
 * with status Pending or Allocated.
 * Prevents the same email being processed twice.
 */
function checkDuplicateIntake_(clientCode, jobNumber, productType) {
  try {
    var sheet = getSheet(CONFIG.sheets.jobIntake);
    var data  = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      var existingJob     = String(data[i][JI.jobNumber    - 1]).trim().toUpperCase();
      var existingProduct = String(data[i][JI.productType  - 1]).trim();
      var existingClient  = String(data[i][JI.clientCode   - 1]).trim().toUpperCase();
      var existingStatus  = String(data[i][JI.status       - 1]).trim();

      if (existingJob     === jobNumber.toUpperCase()  &&
          existingProduct === productType              &&
          existingClient  === clientCode.toUpperCase() &&
          existingStatus  !== 'Error') {
        return true;
      }
    }
  } catch (e) { /* sheet may not exist yet */ }

  return false;
}

/**
 * generateIntakeId_()
 * Creates a unique intake ID: INT-YYYYMMDD-HHMMSS
 */
function generateIntakeId_() {
  var now = new Date();
  var pad = function(n) { return n < 10 ? '0' + n : String(n); };
  return 'INT-' +
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) + '-' +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds());
}


// ============================================================
// GMAIL HELPERS
// ============================================================

function ensureGmailLabel_(labelName) {
  var existing = GmailApp.getUserLabelByName(labelName);
  if (!existing) GmailApp.createLabel(labelName);
}

function markEmailProcessed_(thread) {
  var label = GmailApp.getUserLabelByName(GMAIL_PROCESSED_LABEL);
  if (label) label.addToThread(thread);
}


// ============================================================
// CLIENT_INTAKE_CONFIG READER
// ============================================================

/**
 * getActiveEmailConfigs_()
 * Returns all rows from CLIENT_INTAKE_CONFIG where
 * intakeMethod = "EMAIL" and active = "Yes".
 */
function getActiveEmailConfigs_() {
  try {
    var data    = getSheetData(CONFIG.sheets.clientIntakeConfig);
    var configs = [];

    for (var i = 1; i < data.length; i++) {
      var method = String(data[i][CIC.intakeMethod      - 1]).trim().toUpperCase();
      var active = String(data[i][CIC.active            - 1]).trim().toUpperCase();

      if (method !== 'EMAIL' || active !== 'YES') continue;

      configs.push({
        clientCode:        String(data[i][CIC.clientCode        - 1]).trim().toUpperCase(),
        intakeMethod:      method,
        senderEmailDomain: String(data[i][CIC.senderEmailDomain - 1]).trim().toLowerCase(),
        jobNumberPattern:  String(data[i][CIC.jobNumberPattern  - 1]).trim(),
        gmailLabel:        String(data[i][CIC.gmailLabel        - 1]).trim() || GMAIL_PROCESSED_LABEL,
        active:            active
      });
    }

    return configs;
  } catch (err) {
    logException('ERROR', 'SYSTEM', 'getActiveEmailConfigs_',
      'Could not read CLIENT_INTAKE_CONFIG: ' + err.message);
    return [];
  }
}


// ============================================================
// SETUP & ADMIN FUNCTIONS
// Called once from the BLC System menu to initialise.
// ============================================================

/**
 * setupEmailIntakeTrigger()
 * Creates the 30-minute recurring trigger for scanForNewJobEmails().
 * Safe to run multiple times — checks for existing trigger first.
 */
function setupEmailIntakeTrigger() {
  var FUNCTION_NAME = 'setupEmailIntakeTrigger';
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'scanForNewJobEmails') {
      SpreadsheetApp.getUi().alert(
        '✅ Email intake trigger already exists. No changes made.'
      );
      return;
    }
  }

  ScriptApp.newTrigger('scanForNewJobEmails')
    .timeBased()
    .everyMinutes(30)
    .create();

  logException('INFO', 'SYSTEM', FUNCTION_NAME,
    'scanForNewJobEmails trigger created — runs every 30 minutes.');

  SpreadsheetApp.getUi().alert(
    '✅ Email intake trigger created.\n\n' +
    'The system will now scan Gmail every 30 minutes for new job emails.\n\n' +
    'Make sure CLIENT_INTAKE_CONFIG has your client email domains set up.'
  );
}

/**
 * createIntakeSheets()
 * One-time setup: creates JOB_INTAKE and CLIENT_INTAKE_CONFIG sheets
 * if they don't already exist.
 * Run this once after deploying this file.
 */
function createIntakeSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // ── JOB_INTAKE ───────────────────────────────────────────
  if (!ss.getSheetByName(CONFIG.sheets.jobIntake)) {
    var intakeSheet = ss.insertSheet(CONFIG.sheets.jobIntake);
    intakeSheet.appendRow([
      'Intake ID', 'Client Code', 'Job Number', 'Job Name',
      'Product Type', 'Due Date', 'Notes', 'Urgent',
      'Source From', 'Source Subject', 'Email Date',
      'Parsed Date', 'Status', 'Allocated By', 'Allocated Date'
    ]);
    intakeSheet.setFrozenRows(1);
    logException('INFO', 'SYSTEM', 'createIntakeSheets',
      'JOB_INTAKE sheet created.');
  }

  // ── CLIENT_INTAKE_CONFIG ─────────────────────────────────
  if (!ss.getSheetByName(CONFIG.sheets.clientIntakeConfig)) {
    var configSheet = ss.insertSheet(CONFIG.sheets.clientIntakeConfig);
    configSheet.appendRow([
      'Client Code', 'Intake Method', 'Sender Email Domain',
      'Job Number Pattern (regex)', 'Gmail Label', 'Active'
    ]);
    // Pre-populate TITAN as the first email client
    configSheet.appendRow([
      'TITAN', 'EMAIL', 'titanmanufacturing.ca', 'B6\\d{5}',
      'BLC-Processed', 'Yes'
    ]);
    configSheet.setFrozenRows(1);
    logException('INFO', 'SYSTEM', 'createIntakeSheets',
      'CLIENT_INTAKE_CONFIG sheet created with TITAN pre-populated.');
  }

  SpreadsheetApp.getUi().alert(
    '✅ Intake sheets created.\n\n' +
    'Next steps:\n' +
    '1. Add other clients to CLIENT_INTAKE_CONFIG\n' +
    '2. Run "Setup Email Intake Trigger" from the menu\n' +
    '3. Run "Test Email Parser" to verify TITAN emails parse correctly'
  );
}

/**
 * testEmailParser()
 * Menu function — runs the parser against the last 5 unprocessed
 * emails from known client domains and shows results in an alert.
 * Use this to verify the parser is working before enabling the trigger.
 */
function testEmailParser() {
  var configs = getActiveEmailConfigs_();
  if (configs.length === 0) {
    SpreadsheetApp.getUi().alert(
      '⚠️ No active EMAIL clients in CLIENT_INTAKE_CONFIG.\n' +
      'Add a client row first.'
    );
    return;
  }

  var results = [];
  for (var i = 0; i < configs.length; i++) {
    var config  = configs[i];
    var query   = 'from:' + config.senderEmailDomain + ' in:inbox';
    var threads = GmailApp.search(query, 0, 3);

    for (var t = 0; t < threads.length; t++) {
      var message = threads[t].getMessages()[0];
      var body    = message.getPlainBody();
      var parsed  = parseJobEmail_(body, config);

      results.push(
        'Client: ' + config.clientCode +
        '\nFrom: '    + message.getFrom() +
        '\nJob #: '   + (parsed.jobNumber   || '❌ NOT FOUND') +
        '\nName: '    + (parsed.jobName     || '—') +
        '\nProducts: '+ (parsed.productTypes.join(', ') || '❌ NOT FOUND') +
        '\nDue: '     + (parsed.dueDate     || '—') +
        '\nUrgent: '  + (parsed.urgent ? '🔴 YES' : 'No') +
        '\nNotes: '   + (parsed.notes       || '—') +
        '\n---'
      );
    }
  }

  SpreadsheetApp.getUi().alert(
    results.length > 0
      ? 'Email Parser Test Results:\n\n' + results.join('\n')
      : 'No emails found from known client domains.'
  );
}

/**
 * markIntakeAllocated(intakeId, allocatedBy)
 * Called by onAllocationSubmit() when a job from the intake queue
 * is allocated to a designer. Updates status in JOB_INTAKE.
 */
function markIntakeAllocated(jobNumber, productType, allocatedBy) {
  try {
    var sheet = getSheet(CONFIG.sheets.jobIntake);
    var data  = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][JI.jobNumber   - 1]).trim().toUpperCase() !== jobNumber.toUpperCase()) continue;
      if (String(data[i][JI.productType - 1]).trim() !== productType) continue;
      if (String(data[i][JI.status      - 1]).trim() !== INTAKE_STATUS_PENDING) continue;

      sheet.getRange(i + 1, JI.status       ).setValue('Allocated');
      sheet.getRange(i + 1, JI.allocatedBy  ).setValue(allocatedBy  || 'onAllocationSubmit');
      sheet.getRange(i + 1, JI.allocatedDate).setValue(new Date());
      return;
    }
  } catch (e) {
    logException('WARNING', jobNumber, 'markIntakeAllocated',
      'Could not update JOB_INTAKE status: ' + e.message);
  }
}
