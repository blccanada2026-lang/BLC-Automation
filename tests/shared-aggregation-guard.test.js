/**
 * shared-aggregation-guard.test.js
 *
 * Regression guard for the failure class hit twice in this effort:
 *   1. Q1 2026 exclusion bug — an engine checked `row.migration_batch`
 *      directly instead of the shared isMigratedWorkLog() predicate
 *      (migration_batch is never a real FACT_WORK_LOGS column — DAL
 *      silently drops it on write. See ADR-WL-004).
 *   2. Void-netting bug — an engine filtered `hours <= 0` directly
 *      instead of the shared aggregateNetWorkLogHours(), which
 *      silently dropped legitimate WORK_LOG_VOIDED negative-delta
 *      rows instead of netting them (see ADR-WL-005).
 *
 * Both bugs were "the shared logic got bypassed or duplicated back
 * into an engine directly" — not caught by unit-testing the shared
 * functions in isolation, since those were correct; the bug was in
 * an ENGINE not calling them. This suite reads the REAL source files
 * (not mocks) and asserts every known FACT_WORK_LOGS-consuming
 * aggregation entry point still calls the shared functions and does
 * not contain a reintroduced inline copy of either broken pattern.
 *
 * Scoped to the six live aggregation entry points, not the whole
 * file: QuarterlyBonusEngine.gs also contains several one-off
 * Q1-incident audit/report functions (runQ1BonusAuditDetailed,
 * runQ1ManualCorrectionReport, runQ1CorrectedHours,
 * runQ1BonusOverpaymentReport) that legitimately use `hours <= 0` to
 * build duplicate-detection keys — a different, non-payroll concern.
 * A whole-file grep would false-positive on those; this suite reads
 * only the named function bodies.
 */

const fs = require('fs');
const path = require('path');

function readFile(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

/**
 * Strips // line comments and /* block comments *\/ so the forbidden-pattern
 * checks below only match live code — several functions here legitimately
 * mention "migration_batch" in a comment explaining why it's NOT read
 * (e.g. "row.migration_batch is never a real FACT_WORK_LOGS column").
 */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

/** Extracts a function's body text via brace counting, starting from its `function NAME(` line. */
function extractFunctionBody(source, functionName) {
  const decl = new RegExp('function\\s+' + functionName + '\\s*\\(');
  const match = decl.exec(source);
  if (!match) {
    throw new Error('Could not find function ' + functionName + ' in source — has it been renamed or removed?');
  }
  const start = match.index;
  const braceStart = source.indexOf('{', start);
  if (braceStart === -1) throw new Error('Could not find opening brace for ' + functionName);

  let depth = 0;
  let i = braceStart;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  return source.slice(start, i);
}

const TARGETS = [
  {
    file: 'src/10-payroll/PayrollEngine.gs',
    fn: 'aggregateHours_',
    mustCall: ['aggregateNetWorkLogHours('],
  },
  {
    file: 'src/10-payroll/QuarterlyBonusEngine.gs',
    fn: 'aggregateQuarterHours_',
    mustCall: ['aggregateNetWorkLogHours('],
  },
  {
    file: 'src/09-billing/BillingEngine.gs',
    fn: 'buildHoursCache_',
    mustCall: ['isMigratedWorkLog('],
  },
  {
    file: 'src/09-billing/BillingEngine.gs',
    fn: 'runBillingRateCheck',
    mustCall: ['isMigratedWorkLog('],
  },
  {
    file: 'src/11-reporting/ClientTimesheetEngine.gs',
    fn: 'buildHoursMap_',
    mustCall: ['isMigratedWorkLog('],
  },
  {
    file: 'src/11-reporting/ClientTimesheetEngine.gs',
    fn: 'buildWorkLogEntries_',
    mustCall: ['isMigratedWorkLog('],
  },
  {
    file: 'src/11-reporting/ClientTimesheetEngine.gs',
    fn: 'runWorkLogDiagnostic',
    mustCall: ['isMigratedWorkLog('],
  },
  {
    file: 'src/06-handlers/WorkLogHandler.gs',
    fn: 'getDailyNetHours_',
    mustCall: ['isMigratedWorkLog('],
  },
];

const FORBIDDEN_PATTERNS = [
  { pattern: /\.migration_batch\b/, label: 'row.migration_batch (never a real column — silently dropped by DAL on write)' },
  { pattern: /hours\s*<=\s*0/, label: 'hours <= 0 (drops legitimate negative WORK_LOG_VOIDED deltas instead of netting them)' },
];

describe('shared aggregation/exclusion logic guard', () => {
  TARGETS.forEach(({ file, fn, mustCall }) => {
    describe(file + ' :: ' + fn + '()', () => {
      let body;
      beforeAll(() => {
        body = extractFunctionBody(readFile(file), fn);
      });

      mustCall.forEach((call) => {
        test('calls the shared function ' + call.replace('(', '()'), () => {
          expect(body).toEqual(expect.stringContaining(call));
        });
      });

      FORBIDDEN_PATTERNS.forEach(({ pattern, label }) => {
        test('does not reintroduce the broken inline pattern: ' + label, () => {
          expect(pattern.test(stripComments(body))).toBe(false);
        });
      });
    });
  });

  test('shared functions themselves still exist at their known locations (sanity check for the extraction above)', () => {
    const workLogAggregation = readFile('src/06-handlers/WorkLogAggregation.gs');
    const workLogExclusion   = readFile('src/06-handlers/WorkLogExclusion.gs');
    expect(workLogAggregation).toEqual(expect.stringContaining('function aggregateNetWorkLogHours('));
    expect(workLogExclusion).toEqual(expect.stringContaining('function isMigratedWorkLog('));
  });
});
