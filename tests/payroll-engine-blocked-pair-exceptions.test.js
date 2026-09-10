/**
 * payroll-engine-blocked-pair-exceptions.test.js
 *
 * Tests for PayrollEngine.filterUnexpectedBlockedPairs_() — the
 * pre-cutover gate helper (2026-09-10 design spec §6). Under product-
 * scoped supervision, some blockedPairs are permanent by design (e.g. a
 * designer's I-Joist hours on an account where I-Joist coverage is
 * intentionally outside TEAM_LEAD-tier supervision, already covered by
 * a different bonus mechanism). The gate is: this function returns [].
 */

const fs   = require('fs');
const path = require('path');
const { installV3StaffMocks } = require('./gas-v3-staff-mocks');

function loadSrc(relPath) {
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let mocks;

beforeEach(() => {
  mocks = installV3StaffMocks();
  mocks.Config.TABLES.VW_JOB_CURRENT_STATE = 'VW_JOB_CURRENT_STATE';
  mocks.Config.TABLES.FACT_WORK_LOGS       = 'FACT_WORK_LOGS';
  mocks.Config.TABLES.FACT_PAYROLL_LEDGER  = 'FACT_PAYROLL_LEDGER';
  mocks.Config.TABLES.DIM_FX_RATES         = 'DIM_FX_RATES';
  loadSrc('../src/06-handlers/WorkLogAggregation.gs');
  loadSrc('../src/10-payroll/PayrollEngine.gs');
});

describe('PayrollEngine.filterUnexpectedBlockedPairs_()', () => {
  test('a blocked pair matching an accepted exception is filtered out', () => {
    const blockedPairs = [
      { client_code: 'ALBERTA TRUSS', product_code: 'FLOOR_JOIST', designer_code: 'PRS', hours: 4 }
    ];
    expect(PayrollEngine.filterUnexpectedBlockedPairs_(blockedPairs)).toEqual([]);
  });

  test('a blocked pair NOT matching any accepted exception still fails the gate (is returned)', () => {
    const blockedPairs = [
      { client_code: 'BRAND NEW ACCOUNT', product_code: 'ROOF_TRUSS', designer_code: 'PRS', hours: 8 }
    ];
    expect(PayrollEngine.filterUnexpectedBlockedPairs_(blockedPairs)).toEqual([
      { client_code: 'BRAND NEW ACCOUNT', product_code: 'ROOF_TRUSS', designer_code: 'PRS', hours: 8 }
    ]);
  });

  test('a mixed list returns only the unexpected ones', () => {
    const blockedPairs = [
      { client_code: 'ALBERTA TRUSS', product_code: 'FLOOR_JOIST', designer_code: 'PRS', hours: 4 },
      { client_code: 'BRAND NEW ACCOUNT', product_code: 'ROOF_TRUSS', designer_code: 'PRS', hours: 8 },
      { client_code: 'NELSON', product_code: 'FLOOR_JOIST', designer_code: 'AR001', hours: 6 }
    ];
    expect(PayrollEngine.filterUnexpectedBlockedPairs_(blockedPairs)).toEqual([
      { client_code: 'BRAND NEW ACCOUNT', product_code: 'ROOF_TRUSS', designer_code: 'PRS', hours: 8 }
    ]);
  });

  test('an accepted exception only matches its exact (client, product, designer) triple — a different designer on the same client/product is NOT exempted', () => {
    const blockedPairs = [
      { client_code: 'ALBERTA TRUSS', product_code: 'FLOOR_JOIST', designer_code: 'SOMEONE_ELSE', hours: 3 }
    ];
    expect(PayrollEngine.filterUnexpectedBlockedPairs_(blockedPairs)).toEqual([
      { client_code: 'ALBERTA TRUSS', product_code: 'FLOOR_JOIST', designer_code: 'SOMEONE_ELSE', hours: 3 }
    ]);
  });

  test('an empty blockedPairs list returns empty', () => {
    expect(PayrollEngine.filterUnexpectedBlockedPairs_([])).toEqual([]);
  });

  test('an accepted exception only matches its exact product — a different product on the same client/designer is NOT exempted', () => {
    const blockedPairs = [
      { client_code: 'ALBERTA TRUSS', product_code: 'ROOF_TRUSS', designer_code: 'PRS', hours: 5 }
    ];
    expect(PayrollEngine.filterUnexpectedBlockedPairs_(blockedPairs)).toEqual([
      { client_code: 'ALBERTA TRUSS', product_code: 'ROOF_TRUSS', designer_code: 'PRS', hours: 5 }
    ]);
  });
});
