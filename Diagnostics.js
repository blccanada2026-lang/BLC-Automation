function diagnoseSyncIssue() {
  var cmData     = getSheetData(CONFIG.sheets.clientMaster);
  var masterData = getSheetData(CONFIG.sheets.masterJobDatabase);
  var MJ         = CONFIG.masterCols;
  var output     = [];

  output.push("CLIENT_MASTER rows found: " + (cmData.length - 1));
  output.push("MASTER rows found: " + (masterData.length - 1));
  output.push("---");

  // Check each client
  for (var i = 1; i < cmData.length; i++) {
    var clientCode = String(cmData[i][0]  || "").trim();
    var isActive   = String(cmData[i][9]  || "").trim();
    var formId     = String(cmData[i][15] || "").trim();

    output.push("Client row " + i + ": code='" + clientCode +
      "' active='" + isActive +
      "' formId='" + (formId ? formId.substring(0,10) + "..." : "BLANK") + "'");

    if (!clientCode || isActive !== "Yes" || !formId) {
      output.push("  ⚠️ SKIPPED — check values above");
      continue;
    }

    // Count matching completed jobs
    var matched = 0;
    for (var j = 1; j < masterData.length; j++) {
      var mClient = String(masterData[j][MJ.clientCode - 1] || "").trim();
      var mStatus = String(masterData[j][MJ.status     - 1] || "").trim();
      var mIsTest = String(masterData[j][MJ.isTest     - 1] || "").trim();
      if (mClient === clientCode &&
          mIsTest !== "Yes" &&
          (mStatus === CONFIG.status.completed || mStatus === "Billed")) {
        matched++;
      }
    }
    output.push("  Completed jobs found for " + clientCode + ": " + matched);
  }

  // Show first 3 completed rows from MASTER for spot check
  output.push("---");
  output.push("First 3 Completed rows in MASTER:");
  var count = 0;
  for (var k = 1; k < masterData.length && count < 3; k++) {
    var s = String(masterData[k][MJ.status - 1] || "").trim();
    if (s === CONFIG.status.completed || s === "Billed") {
      output.push("  Job: " + masterData[k][MJ.jobNumber  - 1] +
        " | Client: '"     + masterData[k][MJ.clientCode  - 1] + "'" +
        " | Status: '"     + masterData[k][MJ.status      - 1] + "'");
      count++;
    }
  }

  var result = output.join("\n");
  Logger.log(result);
  SpreadsheetApp.getUi().alert(result);
}

function diagnoseFormItems() {
  var cmData  = getSheetData(CONFIG.sheets.clientMaster);
  var output  = [];

  // Just check first client form
  var clientCode = String(cmData[1][0]  || "").trim();
  var formId     = String(cmData[1][15] || "").trim();

  output.push("Checking form for: " + clientCode);
  output.push("Form ID: " + formId);
  output.push("---");

  try {
    var form  = FormApp.openById(formId);
    var items = form.getItems();
    output.push("Items found in form: " + items.length);
    output.push("---");
    for (var i = 0; i < items.length; i++) {
      output.push("Item " + i + ": title='" + items[i].getTitle() +
        "' type='" + items[i].getType() + "'" +
        " LIST type value=" + FormApp.ItemType.LIST);
    }
  } catch (err) {
    output.push("❌ Could not open form: " + err.message);
  }

  var result = output.join("\n");
  Logger.log(result);
  SpreadsheetApp.getUi().alert(result);
}