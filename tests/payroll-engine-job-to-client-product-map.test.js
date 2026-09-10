/**
 * payroll-engine-job-to-client-product-map.test.js
 *
 * Tests for PayrollEngine.buildJobToClientProductMap_() — resolves
 * job_number to { client_code, product_code } via VW_JOB_CURRENT_STATE,
 * needed to bucket work-log hours by client account AND product for the
 * product-scoped supervisor bonus calculation (2026-09-10 design spec).
 * Supersedes buildJobToClientMap_() (2026-09-08 design spec), which
 * returned only a client_code string per job.
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

describe('PayrollEngine.buildJobToClientProductMap_()', () => {
  test('maps job_number to { client_code, product_code } for every row in VW_JOB_CURRENT_STATE', () => {
    mocks.store['VW_JOB_CURRENT_STATE'] = [
      { job_number: 'BLC-01001', client_code: 'ALBERTA TRUSS', product_code: 'ROOF_TRUSS' },
      { job_number: 'BLC-01002', client_code: 'TITAN TRUSS',   product_code: 'FLOOR_JOIST' }
    ];

    const map = PayrollEngine.buildJobToClientProductMap_();

    expect(map['BLC-01001']).toEqual({ client_code: 'ALBERTA TRUSS', product_code: 'ROOF_TRUSS' });
    expect(map['BLC-01002']).toEqual({ client_code: 'TITAN TRUSS', product_code: 'FLOOR_JOIST' });
  });

  test('returns an empty object if VW_JOB_CURRENT_STATE has no rows', () => {
    mocks.store['VW_JOB_CURRENT_STATE'] = [];
    const map = PayrollEngine.buildJobToClientProductMap_();
    expect(map).toEqual({});
  });

  test('a row with a blank product_code maps to an empty string, not undefined', () => {
    mocks.store['VW_JOB_CURRENT_STATE'] = [
      { job_number: 'BLC-01003', client_code: 'SBS', product_code: '' }
    ];
    const map = PayrollEngine.buildJobToClientProductMap_();
    expect(map['BLC-01003']).toEqual({ client_code: 'SBS', product_code: '' });
  });
});
