// ============================================================
// ProductTypePatch.gs
// Blue Lotus Consulting Corporation
// Standardises Product Type values in MASTER_JOB_DATABASE.
// Safe to re-run — only changes non-canonical values.
// Rewritten: March 11, 2026 — added canonical whitelist,
// dry-run mode, batch writes, protected canonical values.
// ============================================================

// ── CANONICAL PRODUCT TYPES ──────────────────────────────────
// These are the ONLY valid values. Any row already containing
// one of these values will NEVER be touched — regardless of
// what else is in the map.
var CANONICAL_PRODUCT_TYPES = [
  'Roof Truss',
  'Floor Truss',
  'Wall Frame',
  'I-Joist Floor',
  'Management',
  'Lumber Estimation'
];

// ── NORMALISATION MAP ────────────────────────────────────────
// Only non-canonical raw values go here.
// NEVER add a canonical value as a key — it will never be
// reached anyway due to the whitelist check above.
var PRODUCT_TYPE_MAP = {
  // Roof Truss variants
  'Truss':                    'Roof Truss',
  'roof truss':               'Roof Truss',
  'ROOF TRUSS':               'Roof Truss',
  'Roof truss':               'Roof Truss',

  // Floor Truss variants
  'floor truss':              'Floor Truss',
  'FLOOR TRUSS':              'Floor Truss',
  'Floor truss':              'Floor Truss',
  'Open Web Floor':           'Floor Truss',
  'open web floor':           'Floor Truss',
  'OWW Floor 1':              'Floor Truss',
  'OWW Floor 2':              'Floor Truss',
  'OWW Floor':                'Floor Truss',

  // Wall Frame variants
  'wall frame':               'Wall Frame',
  'WALL FRAME':               'Wall Frame',
  'Wall Panel':               'Wall Frame',
  'wall panel':               'Wall Frame',

  // I-Joist Floor variants
  'I Joist Floor':            'I-Joist Floor',
  'i-joist floor':            'I-Joist Floor',
  'i joist floor':            'I-Joist Floor',
  'IJoist Floor':             'I-Joist Floor',
  'I-Joist floor':            'I-Joist Floor',

  // Management variants
  'management':               'Management',
  'MANAGEMENT':               'Management',

  // Lumber Estimation variants
  'Lumber estimation':        'Lumber Estimation',
  'lumber estimation':        'Lumber Estimation',
  'LUMBER ESTIMATION':        'Lumber Estimation'

  // NOTE: 'Roof Truss & Floor Truss' is deliberately NOT in this map.
  // A job with both product types must be manually split into two rows.
  // The function will flag these for review without changing them.
};

// ── NORMALISE FUNCTION ───────────────────────────────────────
function normaliseProductType(raw) {
  var trimmed = String(raw || "").trim();

  // If already canonical — return unchanged immediately
  if (CANONICAL_PRODUCT_TYPES.indexOf(trimmed) !== -1) {
    return trimmed;
  }

  // Look up in map — if not found, return original (will be flagged for review)
  return PRODUCT_TYPE_MAP[trimmed] || trimmed;
}

// ── MAIN STANDARDISE FUNCTION ────────────────────────────────
function standardiseProductTypes() {
  var FUNCTION_NAME = "standardiseProductTypes";
  var MJ = CONFIG.masterCols;

  try {
    var masterSheet = getSheet(CONFIG.sheets.masterJob);
    var data        = masterSheet.getDataRange().getValues();
    var changeCount = 0;
    var skipCount   = 0;
    var reviewList  = [];
    var updates     = []; // batch all changes, write at end

    for (var i = 1; i < data.length; i++) {
      var row       = data[i];
      var jobNumber = String(row[MJ.jobNumber  - 1] || "").trim();
      var rawType   = String(row[MJ.productType - 1] || "").trim();

      // Skip blank product types
      if (!rawType) {
        skipCount++;
        continue;
      }

      // Skip if already canonical — NEVER touch these rows
      if (CANONICAL_PRODUCT_TYPES.indexOf(rawType) !== -1) {
        continue;
      }

      var canonical = normaliseProductType(rawType);

      // If map returned the same value, it's an unknown type — flag for review
      if (canonical === rawType) {
        reviewList.push(
          "Row " + (i + 1) + " | Job: " + jobNumber +
          " | Unknown type: '" + rawType + "'"
        );
        logException("WARNING", jobNumber, FUNCTION_NAME,
          "Unknown Product Type — not in map and not canonical: '" + rawType + "'");
        continue;
      }

      // Queue the update
      updates.push({ rowIndex: i + 1, from: rawType, to: canonical, jobNumber: jobNumber });
    }

    // ── CONFIRM BEFORE WRITING ───────────────────────────────
    if (updates.length === 0 && reviewList.length === 0) {
      SpreadsheetApp.getUi().alert(
        "✅ Nothing to do — all Product Types are already canonical."
      );
      return;
    }

    if (updates.length > 0) {
      var confirmMsg = "About to update " + updates.length + " row(s):\n\n";
      // Show first 10 changes as preview
      var preview = updates.slice(0, 10);
      for (var p = 0; p < preview.length; p++) {
        confirmMsg += "Row " + preview[p].rowIndex + " | " + preview[p].jobNumber +
                      " | '" + preview[p].from + "' → '" + preview[p].to + "'\n";
      }
      if (updates.length > 10) {
        confirmMsg += "...and " + (updates.length - 10) + " more.\n";
      }
      confirmMsg += "\nProceed?";

      var ui = SpreadsheetApp.getUi();
      var response = ui.alert("Confirm Product Type Updates", confirmMsg,
                              ui.ButtonSet.YES_NO);
      if (response !== ui.Button.YES) {
        ui.alert("Cancelled. No changes made.");
        return;
      }
    }

    // ── BATCH WRITE ALL CHANGES ──────────────────────────────
    for (var u = 0; u < updates.length; u++) {
      var upd = updates[u];
      masterSheet.getRange(upd.rowIndex, MJ.productType  ).setValue(upd.to);
      masterSheet.getRange(upd.rowIndex, MJ.lastUpdated  ).setValue(new Date());
      masterSheet.getRange(upd.rowIndex, MJ.lastUpdatedBy).setValue("standardiseProductTypes");
      changeCount++;
      logException("INFO", upd.jobNumber, FUNCTION_NAME,
        "Product Type updated: '" + upd.from + "' → '" + upd.to + "'");
    }

    SpreadsheetApp.flush();

    // ── RESULTS SUMMARY ──────────────────────────────────────
    var reviewMsg = reviewList.length > 0
      ? "\n\n⚠️ " + reviewList.length + " unknown value(s) found — NOT changed:\n" +
        reviewList.join("\n") +
        "\n\nCheck EXCEPTIONS_LOG. These need manual review."
      : "\n\n✅ No unknown values — all rows accounted for.";

    SpreadsheetApp.getUi().alert(
      "✅ Product Type standardisation complete.\n\n" +
      "Rows updated:   " + changeCount + "\n" +
      "Rows skipped:   " + skipCount   + " (blank)\n" +
      "Unknown values: " + reviewList.length +
      reviewMsg
    );

    logException("INFO", "SYSTEM", FUNCTION_NAME,
      "Complete. Updated: " + changeCount +
      " | Skipped: " + skipCount +
      " | Unknown: " + reviewList.length);

  } catch (err) {
    logException("ERROR", "SYSTEM", FUNCTION_NAME,
      "Crashed: " + err.message);
    SpreadsheetApp.getUi().alert(
      "❌ Error during standardisation:\n" + err.message +
      "\n\nCheck EXCEPTIONS_LOG for details."
    );
  }
}