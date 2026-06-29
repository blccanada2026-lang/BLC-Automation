// ============================================================
// ClientTimesheetEngineTest.gs — BLC Nexus T11 Tests
// src/setup/ClientTimesheetEngineTest.gs
//
// HOW TO RUN (Apps Script editor):
//   runClientTimesheetTests()
//
// Tests validate entry-level invariants: no negative hours,
// no zero-hour rows, all required fields present (7 data fields
// map to 8 HTML columns with S.No added at render time).
// ============================================================

var TEST_CTE_CLIENT = 'NELSON';
var TEST_CTE_PERIOD = '2026-06B';

function testClientTimesheetEngine_noNegativeHours() {
  var entries = ClientTimesheetEngine.getEntries(TEST_CTE_CLIENT, TEST_CTE_PERIOD);
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].hours < 0) {
      return {
        pass: false,
        message: 'Negative hours ' + entries[i].hours + ' at row ' + i +
                 ' (job ' + entries[i].job_number + ', designer ' + entries[i].designer_code + ')'
      };
    }
  }
  return { pass: true, message: 'No negative hours across ' + entries.length + ' entries' };
}

function testClientTimesheetEngine_noZeroHourRows() {
  var entries = ClientTimesheetEngine.getEntries(TEST_CTE_CLIENT, TEST_CTE_PERIOD);
  for (var i = 0; i < entries.length; i++) {
    if (entries[i].hours === 0) {
      return {
        pass: false,
        message: 'Zero-hour row at index ' + i +
                 ' (job ' + entries[i].job_number + ', designer ' + entries[i].designer_code + ')'
      };
    }
  }
  return { pass: true, message: 'No zero-hour rows across ' + entries.length + ' entries' };
}

function testClientTimesheetEngine_columnCount() {
  var REQUIRED = ['work_date', 'job_number', 'job_type', 'client_job_ref', 'designer_code', 'hours', 'notes'];
  var entries  = ClientTimesheetEngine.getEntries(TEST_CTE_CLIENT, TEST_CTE_PERIOD);
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    for (var f = 0; f < REQUIRED.length; f++) {
      if (!(REQUIRED[f] in e)) {
        return {
          pass: false,
          message: 'Missing field "' + REQUIRED[f] + '" at row ' + i +
                   ' (job ' + e.job_number + ')'
        };
      }
    }
  }
  // 7 data fields + S.No added at render = 8 HTML columns
  return {
    pass: true,
    message: 'All ' + entries.length + ' entries have 7 required fields (→ 8 HTML columns with S.No)'
  };
}

/**
 * Runs all ClientTimesheetEngine tests. Returns pass/fail summary.
 */
function runClientTimesheetTests() {
  var tests = [
    testClientTimesheetEngine_noNegativeHours,
    testClientTimesheetEngine_noZeroHourRows,
    testClientTimesheetEngine_columnCount
  ];
  var passed = 0, failed = 0;
  for (var i = 0; i < tests.length; i++) {
    var result = tests[i]();
    var label  = result.pass ? 'PASS' : 'FAIL';
    console.log('[' + label + '] ' + tests[i].name + ' — ' + result.message);
    if (result.pass) { passed++; } else { failed++; }
  }
  console.log('=== ClientTimesheetEngine: ' + passed + ' passed, ' + failed + ' failed ===');
  return { passed: passed, failed: failed };
}
