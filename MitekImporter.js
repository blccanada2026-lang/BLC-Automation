// ============================================================
// MitekImporter.gs
// Blue Lotus Consulting Corporation
// Manual entry of MiTek Management System jobs into JOB_INTAKE.
//
// WHY MANUAL: MiTek clients give BLC terminal access to their
// MiTek system (screenshot only — no copy-paste due to server
// access restrictions). The team reads the MiTek screen and
// types job details into the BLC intake form.
//
// FLOW:
//   1. Sarty opens the Intake Queue web page (?page=intake)
//   2. Clicks "Add MiTek Job" button
//   3. Types job details from the MiTek screen
//   4. Submits → creates JOB_INTAKE row (status=Pending)
//   5. Job appears in the queue ready to allocate
//
// CLIENT JOB NUMBER FORMATS:
//   SBS      — XXXX-XXXX-[Letter]  e.g. 2601-0883-A, 2512-8644-D
//              Tab: Design Schedule
//   MATIX-SK — 6-digit numeric     e.g. 160769, 160762
//              Tab: Open Orders (not Quotes in Progress)
//
// PRODUCT NAME MAPPING (what MiTek shows → BLC canonical):
//   SBS:
//     Roof              → Roof Truss
//     Floor             → Floor Truss
//     Wall              → Wall Frame
//     Joist / I-Joist   → I-Joist Floor
//   MATIX-SK:
//     Roof Level        → Roof Truss
//     Main Floor        → Floor Truss
//     OW Second Floor   → I-Joist Floor  (OW = Open Web)
//     Garage Truss      → Roof Truss
// ============================================================


// ── MiTek product keyword map ────────────────────────────────
// Checked in order — more specific phrases first.
// Covers both SBS and MATIX-SK product column text.
var MITEK_PRODUCT_KEYWORDS = [
  { keyword: 'ow second floor',  product: 'I-Joist Floor'    },  // MATIX OW = Open Web
  { keyword: 'ow floor',         product: 'I-Joist Floor'    },
  { keyword: 'open web',         product: 'I-Joist Floor'    },
  { keyword: 'i-joist',          product: 'I-Joist Floor'    },
  { keyword: 'ijoist',           product: 'I-Joist Floor'    },
  { keyword: 'main floor',       product: 'Floor Truss'      },  // MATIX main floor
  { keyword: 'second floor',     product: 'Floor Truss'      },
  { keyword: 'roof level',       product: 'Roof Truss'       },  // MATIX roof level
  { keyword: 'garage - truss',   product: 'Roof Truss'       },  // MATIX garage pkg
  { keyword: 'garage truss',     product: 'Roof Truss'       },
  { keyword: 'roof',             product: 'Roof Truss'       },  // SBS / generic
  { keyword: 'floor',            product: 'Floor Truss'      },  // SBS / generic
  { keyword: 'wall',             product: 'Wall Frame'       },
  { keyword: 'lumber',           product: 'Lumber Estimation'}
];

// ── Client job number formats ────────────────────────────────
// SBS:        XXXX-XXXX-[Letter]           e.g. 2601-0883-A        (MiTek, Design Schedule)
// MATIX-SK:   6-digit numeric              e.g. 160769              (MiTek, Quotes/Orders)
// NELSON:     6-digit numeric + optional letter                     (MiTek, Parent OT Reference)
//             e.g. 260337 (Roof), 260337F (Floor)
//             Login: miteKi01 | Company: Winterburn Truss Inc
// NORSPAN-MB: Q + 6 digits + opt letter   e.g. Q260161, Q260145S   (Alpine iCommand, LogMeIn)
// ALBERTA TRUSS: 6-digit + optional -NN  e.g. 261114-01, 255578    (MiTek, login: designer3)
var MITEK_JOB_PATTERNS = {
  'SBS':        /^\d{4}-\d{4}-[A-Z]$/,
  'MATIX-SK':   /^\d{6}$/,
  'NELSON':        /^\d{6}[A-Z]?$/,      // 6-digit + optional letter  e.g. 260337, 260337F
  'NORSPAN-MB':    /^Q\d{6}[A-Z]?$/,
  'ALBERTA TRUSS': /^\d{6}(-\d{2})?$/   // 6-digit + optional -NN suffix  e.g. 261114-01, 255578
};


// ============================================================
// SUBMIT A MITEK JOB
// Called from IntakeQueue.html via google.script.run
// Creates a JOB_INTAKE row for the entered job.
// ============================================================

function submitMitekJob(payload) {
  var FUNCTION_NAME = "submitMitekJob";
  var jobNumber = "UNKNOWN";

  try {
    // ── Unpack ─────────────────────────────────────────────
    jobNumber       = String(payload.jobNumber    || "").trim().toUpperCase();
    var clientCode  = String(payload.clientCode   || "").trim().toUpperCase();
    var productRaw  = String(payload.product      || "").trim().toLowerCase();
    var dueDate     = payload.dueDate             || "";
    var jobName     = String(payload.jobName      || "").trim();
    var modelName   = String(payload.modelName    || "").trim();
    var notes       = String(payload.notes        || "").trim();
    var enteredBy   = String(payload.enteredBy    || "").trim();
    var source      = String(payload.source       || "MiTek").trim();
    var isUrgent    = payload.urgent === true || payload.urgent === "true";

    // ── Validate required fields ────────────────────────────
    if (!jobNumber) {
      return { ok: false, msg: "Job number is required." };
    }
    if (!clientCode) {
      return { ok: false, msg: "Client code is required." };
    }
    if (!productRaw) {
      return { ok: false, msg: "Product type is required." };
    }

    // ── Validate job number format ──────────────────────────
    // Accept standard MiTek format OR any non-empty string
    // (some clients may have different formats)
    if (jobNumber.length < 3) {
      return { ok: false, msg: "Job number too short: '" + jobNumber + "'" };
    }

    // ── Map product type ────────────────────────────────────
    // Check keyword list in order (more specific phrases first)
    var productType = "";
    for (var ki = 0; ki < MITEK_PRODUCT_KEYWORDS.length; ki++) {
      if (productRaw.indexOf(MITEK_PRODUCT_KEYWORDS[ki].keyword) !== -1) {
        productType = MITEK_PRODUCT_KEYWORDS[ki].product;
        break;
      }
    }
    if (!productType) {
      // Fall back: use raw value if it's already a canonical BLC type
      productType = String(payload.product || "").trim();
    }

    // ── Parse due date ──────────────────────────────────────
    var dueDateObj = null;
    if (dueDate) {
      dueDateObj = new Date(dueDate);
      if (isNaN(dueDateObj.getTime())) dueDateObj = null;
    }

    // ── Build notes with model name ─────────────────────────
    var fullNotes = [];
    if (modelName) fullNotes.push("Model: " + modelName);
    if (notes)     fullNotes.push(notes);
    var combinedNotes = fullNotes.join(" | ");

    // ── Duplicate check ─────────────────────────────────────
    if (checkDuplicateIntake_(jobNumber, productType)) {
      return {
        ok: false,
        msg: "⚠️ " + jobNumber + " (" + productType + ") already exists in the intake queue."
      };
    }

    // ── Generate intake ID ──────────────────────────────────
    var intakeId = generateIntakeId_();

    // ── Build intake row ────────────────────────────────────
    var now     = new Date();
    var newRow  = new Array(15).fill("");

    newRow[JI.intakeId        - 1] = intakeId;
    newRow[JI.clientCode      - 1] = clientCode;
    newRow[JI.jobNumber       - 1] = jobNumber;
    newRow[JI.jobName         - 1] = jobName;
    newRow[JI.productType     - 1] = productType;
    newRow[JI.dueDate         - 1] = dueDateObj || "";
    newRow[JI.notes           - 1] = combinedNotes;
    newRow[JI.urgent          - 1] = isUrgent ? "Yes" : "No";
    newRow[JI.sourceFrom      - 1] = source + "/" + (enteredBy || "manual");
    newRow[JI.sourceSubject   - 1] = "MiTek Design Schedule";
    newRow[JI.sourceEmailDate - 1] = now;
    newRow[JI.parsedDate      - 1] = now;
    newRow[JI.status          - 1] = INTAKE_STATUS_PENDING;
    newRow[JI.allocatedBy     - 1] = "";
    newRow[JI.allocatedDate   - 1] = "";

    // ── Append to JOB_INTAKE ────────────────────────────────
    var intakeSheet = getSheet(CONFIG.sheets.jobIntake);
    if (!intakeSheet) {
      return { ok: false, msg: "JOB_INTAKE sheet not found. Run 'Create Intake Sheets' first." };
    }
    intakeSheet.appendRow(newRow);

    logException("INFO", jobNumber, FUNCTION_NAME,
      "MiTek job added to intake. Client=" + clientCode +
      " | Product=" + productType +
      " | By=" + enteredBy);

    return {
      ok:  true,
      msg: "✅ " + jobNumber + " (" + productType + ") added to intake queue."
    };

  } catch (err) {
    logException("ERROR", jobNumber, FUNCTION_NAME,
      "submitMitekJob crashed: " + err.message);
    return { ok: false, msg: "System error: " + err.message };
  }
}


// ============================================================
// GET MITEK ENTRY FORM DATA
// Called from IntakeQueue.html to populate the MiTek form
// dropdowns (client codes that use MiTek intake method).
// ============================================================

function getMitekFormData() {
  try {
    var auth = authenticateInternalUser();
    if (!auth.authenticated) {
      return { ok: false, error: auth.error };
    }

    var allowedRoles = ["Team Leader", "Project Manager", "CEO"];
    if (allowedRoles.indexOf(auth.role) === -1) {
      return { ok: false, error: "Access denied." };
    }

    // Get MiTek clients from CLIENT_INTAKE_CONFIG
    var mitekClients = getMitekClients_();

    return {
      ok:          true,
      userName:    auth.name,
      mitekClients: mitekClients,
      productTypes: CONFIG.productTypes
    };

  } catch (err) {
    return { ok: false, error: "Server error: " + err.message };
  }
}


// ============================================================
// PRIVATE HELPERS
// ============================================================

/**
 * Returns array of client codes that use MITEK intake method.
 * Falls back to all active clients if CLIENT_INTAKE_CONFIG missing.
 */
function getMitekClients_() {
  try {
    var configSheet = getSheet(CONFIG.sheets.clientIntakeConfig);
    var clients = [];

    if (configSheet) {
      var data = configSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var code   = String(data[i][CIC.clientCode      - 1]).trim().toUpperCase();
        var method = String(data[i][CIC.intakeMethod     - 1]).trim().toUpperCase();
        var active = String(data[i][CIC.active           - 1]).trim();
        if (code && (method === "MITEK" || method === "MANUAL") && active === "Yes") {
          clients.push(code);
        }
      }
    }

    // If no MiTek clients configured, fall back to all active clients
    if (clients.length === 0) {
      var cmData = getSheetData(CONFIG.sheets.clientMaster);
      for (var j = 1; j < cmData.length; j++) {
        var cmCode   = String(cmData[j][0]).trim().toUpperCase();
        var cmActive = String(cmData[j][9]).trim();
        if (cmCode && cmActive === "Yes") clients.push(cmCode);
      }
    }

    return clients;

  } catch (e) {
    return ["SBS", "MATIX-SK", "NORSPAN-MB"]; // Hardcoded fallback
  }
}


/**
 * Strips the " - BL" suffix from MiTek designer names.
 * "Sandy Das - BL" → "Sandy Das" → normalised via DESIGNER_NAME_MAP
 */
function normaliseMitekDesignerName(rawName) {
  var stripped = String(rawName || "").replace(/\s*-\s*BL\s*$/i, "").trim();
  return normaliseDesignerName(stripped);
}
