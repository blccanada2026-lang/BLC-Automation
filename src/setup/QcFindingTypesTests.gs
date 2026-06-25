// ============================================================
// QcFindingTypesTests.gs — BLC Nexus T13 QMS Layer 3
// src/setup/QcFindingTypesTests.gs
//
// PURPOSE: Tests for QcFindingTypes.gs — finding taxonomy
// seed data correctness and idempotency.
//
// HOW TO RUN (Apps Script editor):
//   runQcFindingTypesTests()  — all 9 tests, aggregate summary
//
//   Individual tests (also callable directly):
//   testQcFT_seedDataCount()
//   testQcFT_findingCodesUnique()
//   testQcFT_displayOrderUnique()
//   testQcFT_requiredFieldsPresent()
//   testQcFT_kpiWeightRange()
//   testQcFT_structuralRiskCodes()
//   testQcFT_productApplicabilityTrussOnly()
//   testQcFT_seedIdempotency()
//   testQcFT_existingSopTestsUnaffected()
//
// Most tests (1–7) operate purely on getSeedData() — no DAL
// calls, no sheet writes. Tests 8–9 call seed() or SopTests.
// ============================================================

/**
 * Runs all 9 QcFindingTypes tests and prints an aggregate summary.
 * @returns {{ passed: number, failed: number }}
 */
function runQcFindingTypesTests() {
  var totalPassed = 0;
  var totalFailed = 0;

  var tests = [
    testQcFT_seedDataCount,
    testQcFT_findingCodesUnique,
    testQcFT_displayOrderUnique,
    testQcFT_requiredFieldsPresent,
    testQcFT_kpiWeightRange,
    testQcFT_structuralRiskCodes,
    testQcFT_productApplicabilityTrussOnly,
    testQcFT_seedIdempotency,
    testQcFT_existingSopTestsUnaffected
  ];

  for (var i = 0; i < tests.length; i++) {
    try {
      var c = tests[i]();
      totalPassed += c.passed;
      totalFailed += c.failed;
    } catch (e) {
      console.log('EXCEPTION in ' + tests[i].name + ': ' + e.message);
      totalFailed++;
    }
  }

  console.log('');
  console.log('QC FINDING TYPES TESTS — ' + totalPassed + ' passed, ' + totalFailed + ' failed');
  return { passed: totalPassed, failed: totalFailed };
}


// ============================================================
// TEST 1 — Seed Data Count
// QcFindingTypes.getSeedData() returns exactly 17 records.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQcFT_seedDataCount() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var data = QcFindingTypes.getSeedData();
    assertH_(results, counters, 'getSeedData returns an array', Array.isArray(data), 'not an array');
    assertH_(results, counters, 'getSeedData returns exactly 17 records',
      data.length === 17, 'count=' + data.length);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQcFT_seedDataCount', results, counters);
  return counters;
}


// ============================================================
// TEST 2 — Finding Codes Unique
// No two records share the same finding_code.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQcFT_findingCodesUnique() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var data   = QcFindingTypes.getSeedData();
    var seen   = {};
    var dups   = [];

    for (var i = 0; i < data.length; i++) {
      var code = data[i].finding_code;
      assertH_(results, counters, 'Record ' + i + ': finding_code is a non-empty string',
        typeof code === 'string' && code.length > 0, 'code=' + JSON.stringify(code));
      if (seen[code]) {
        dups.push(code);
      }
      seen[code] = true;
    }

    assertH_(results, counters, 'All finding_codes are unique (no duplicates)',
      dups.length === 0, 'duplicates: ' + dups.join(', '));
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQcFT_findingCodesUnique', results, counters);
  return counters;
}


// ============================================================
// TEST 3 — Display Order Unique
// No two records share the same display_order value.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQcFT_displayOrderUnique() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var data = QcFindingTypes.getSeedData();
    var seen = {};
    var dups = [];

    for (var i = 0; i < data.length; i++) {
      var order = data[i].display_order;
      assertH_(results, counters, 'Record ' + i + ' (' + data[i].finding_code + '): display_order is a number',
        typeof order === 'number', 'display_order=' + JSON.stringify(order));
      if (seen[order] !== undefined) {
        dups.push(order);
      }
      seen[order] = true;
    }

    assertH_(results, counters, 'All display_order values are unique',
      dups.length === 0, 'duplicates: ' + dups.join(', '));
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQcFT_displayOrderUnique', results, counters);
  return counters;
}


// ============================================================
// TEST 4 — Required Fields Present
// Every record has all 20 required columns present and
// non-empty for fields that must have a value.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQcFT_requiredFieldsPresent() {
  var results       = [];
  var counters      = { passed: 0, failed: 0 };
  // Fields that must be non-empty strings
  var REQUIRED_NON_EMPTY = [
    'finding_code', 'finding_label', 'finding_group', 'category',
    'severity_default', 'active_flag', 'description',
    'created_by', 'created_at'
  ];
  // Fields that must be present (but may be empty string)
  var REQUIRED_PRESENT = [
    'kpi_weight', 'is_structural_risk', 'product_applicability',
    'requires_comment', 'common_in_rework',
    'display_order', 'notes',
    'last_updated_at', 'last_updated_by',
    'retired_at', 'benchmark_code'
  ];

  try {
    var data = QcFindingTypes.getSeedData();
    var allNonEmptyOk = true;
    var allPresentOk  = true;

    for (var i = 0; i < data.length; i++) {
      var rec  = data[i];
      var code = rec.finding_code || ('row ' + i);

      for (var j = 0; j < REQUIRED_NON_EMPTY.length; j++) {
        var field = REQUIRED_NON_EMPTY[j];
        var val   = rec[field];
        if (!(typeof val === 'string' && val.length > 0) &&
            !(typeof val === 'number')) {
          results.push('  FAIL: ' + code + '.' + field + ' is missing or empty — ' + JSON.stringify(val));
          counters.failed++;
          allNonEmptyOk = false;
        }
      }

      for (var k = 0; k < REQUIRED_PRESENT.length; k++) {
        var pField = REQUIRED_PRESENT[k];
        if (!rec.hasOwnProperty(pField)) {
          results.push('  FAIL: ' + code + '.' + pField + ' property is missing entirely');
          counters.failed++;
          allPresentOk = false;
        }
      }
    }

    if (allNonEmptyOk) {
      results.push('  PASS: All required non-empty fields present in all 17 records');
      counters.passed++;
    }
    if (allPresentOk) {
      results.push('  PASS: All 20 columns present in all 17 records');
      counters.passed++;
    }
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQcFT_requiredFieldsPresent', results, counters);
  return counters;
}


// ============================================================
// TEST 5 — KPI Weight Range
// Every kpi_weight is a number in the range 0.5–10.0 inclusive.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQcFT_kpiWeightRange() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var data      = QcFindingTypes.getSeedData();
    var allInRange = true;

    for (var i = 0; i < data.length; i++) {
      var w    = data[i].kpi_weight;
      var code = data[i].finding_code;
      var ok   = typeof w === 'number' && w >= 0.5 && w <= 10.0;
      if (!ok) {
        results.push('  FAIL: ' + code + '.kpi_weight out of range — ' + w);
        counters.failed++;
        allInRange = false;
      }
    }

    if (allInRange) {
      results.push('  PASS: All kpi_weight values are in range 0.5–10.0');
      counters.passed++;
    }
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQcFT_kpiWeightRange', results, counters);
  return counters;
}


// ============================================================
// TEST 6 — Structural Risk Codes
// Exactly 8 records have is_structural_risk='TRUE'.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQcFT_structuralRiskCodes() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var data      = QcFindingTypes.getSeedData();
    var riskCodes = [];

    for (var i = 0; i < data.length; i++) {
      if (data[i].is_structural_risk === 'TRUE') {
        riskCodes.push(data[i].finding_code);
      }
    }

    assertH_(results, counters, 'Exactly 8 codes have is_structural_risk=TRUE',
      riskCodes.length === 8,
      'count=' + riskCodes.length + ', codes: ' + riskCodes.join(', '));

    // Verify the expected 8 structural codes are all present
    var expected8 = [
      'LOAD_ERROR', 'GEOMETRY_ERROR', 'BEARING_ERROR', 'CONNECTOR_ERROR',
      'PLATE_ERROR', 'ENGINEERING_ERROR', 'WRONG_DESIGN_STANDARD', 'CALCULATION_ERROR'
    ];
    var riskSet = {};
    for (var j = 0; j < riskCodes.length; j++) { riskSet[riskCodes[j]] = true; }

    var allExpectedPresent = true;
    for (var k = 0; k < expected8.length; k++) {
      if (!riskSet[expected8[k]]) {
        results.push('  FAIL: expected structural risk code missing — ' + expected8[k]);
        counters.failed++;
        allExpectedPresent = false;
      }
    }
    if (allExpectedPresent) {
      results.push('  PASS: All 8 expected structural risk codes are present');
      counters.passed++;
    }
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQcFT_structuralRiskCodes', results, counters);
  return counters;
}


// ============================================================
// TEST 7 — Product Applicability TRUSS Only
// Exactly one code has product_applicability ≠ 'ALL': PLATE_ERROR.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQcFT_productApplicabilityTrussOnly() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var data      = QcFindingTypes.getSeedData();
    var notAll    = [];

    for (var i = 0; i < data.length; i++) {
      if (data[i].product_applicability !== 'ALL') {
        notAll.push(data[i].finding_code + '=' + data[i].product_applicability);
      }
    }

    assertH_(results, counters, 'Exactly one code has product_applicability ≠ ALL',
      notAll.length === 1, 'count=' + notAll.length + ', values: ' + notAll.join(', '));

    if (notAll.length === 1) {
      assertH_(results, counters, 'The non-ALL code is PLATE_ERROR with applicability TRUSS',
        notAll[0] === 'PLATE_ERROR=TRUSS', 'found: ' + notAll[0]);
    }
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQcFT_productApplicabilityTrussOnly', results, counters);
  return counters;
}


// ============================================================
// TEST 8 — Seed Idempotency
// Running QcFindingTypes.seed() twice does not create duplicate
// rows in DIM_QC_FINDING_TYPES.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQcFT_seedIdempotency() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    // First seed run
    var r1 = QcFindingTypes.seed(TH_CEO_EMAIL);
    assertH_(results, counters, 'First seed run: inserted >= 0',
      typeof r1.inserted === 'number' && r1.inserted >= 0, 'inserted=' + r1.inserted);

    // Read current count after first run
    var rowsAfterFirst = DAL.readWhere(Config.TABLES.DIM_QC_FINDING_TYPES, {});
    var countAfterFirst = rowsAfterFirst ? rowsAfterFirst.length : 0;

    assertH_(results, counters, 'After first seed: DIM_QC_FINDING_TYPES has >= 17 rows',
      countAfterFirst >= 17, 'count=' + countAfterFirst);

    // Second seed run — must skip all already-present codes
    var r2 = QcFindingTypes.seed(TH_CEO_EMAIL);
    assertH_(results, counters, 'Second seed run: inserted = 0 (all already present)',
      r2.inserted === 0, 'inserted=' + r2.inserted);
    assertH_(results, counters, 'Second seed run: skipped = 17',
      r2.skipped === 17, 'skipped=' + r2.skipped);

    // Row count must be unchanged
    var rowsAfterSecond = DAL.readWhere(Config.TABLES.DIM_QC_FINDING_TYPES, {});
    var countAfterSecond = rowsAfterSecond ? rowsAfterSecond.length : 0;
    assertH_(results, counters, 'Row count unchanged after second seed',
      countAfterSecond === countAfterFirst,
      'before=' + countAfterFirst + ', after=' + countAfterSecond);

  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQcFT_seedIdempotency', results, counters);
  return counters;
}


// ============================================================
// TEST 9 — Existing SOP Tests Unaffected
// testSopAll() passes with zero failures after QcFindingTypes
// seed is applied — no regression in Layer 1.
// ============================================================

/**
 * @returns {{ passed: number, failed: number }}
 */
function testQcFT_existingSopTestsUnaffected() {
  var results  = [];
  var counters = { passed: 0, failed: 0 };

  try {
    var sopResults = testSopAll();

    var sopFailed = sopResults.filter(function (r) { return r.status === 'FAIL'; }).length;
    assertH_(results, counters, 'testSopAll() completes without exception', true, '');
    assertH_(results, counters, 'testSopAll() has zero failing tests',
      sopFailed === 0, 'failed=' + sopFailed);

  } catch (e) {
    results.push('  FAIL: testSopAll() threw an exception — ' + e.message);
    counters.failed++;
  }

  printResultsH_('testQcFT_existingSopTestsUnaffected', results, counters);
  return counters;
}
