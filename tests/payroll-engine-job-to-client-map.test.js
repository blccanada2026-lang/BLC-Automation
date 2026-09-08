/**
 * payroll-engine-job-to-client-map.test.js
 *
 * Tests for PayrollEngine.buildJobToClientMap_() — resolves job_number to
 * client_code via VW_JOB_CURRENT_STATE, needed to bucket work-log hours
 * by client account for the account-scoped supervisor bonus calculation
 * (2026-09-08 design spec).
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

describe('PayrollEngine.buildJobToClientMap_()', () => {
  test('maps job_number to client_code for every row in VW_JOB_CURRENT_STATE', () => {
    mocks.store['VW_JOB_CURRENT_STATE'] = [
      { job_number: 'BLC-01001', client_code: 'ALBERTA TRUSS' },
      { job_number: 'BLC-01002', client_code: 'TITAN TRUSS' }
    ];

    const map = PayrollEngine.buildJobToClientMap_();

    expect(map['BLC-01001']).toBe('ALBERTA TRUSS');
    expect(map['BLC-01002']).toBe('TITAN TRUSS');
  });

  test('returns an empty object if VW_JOB_CURRENT_STATE has no rows', () => {
    mocks.store['VW_JOB_CURRENT_STATE'] = [];
    const map = PayrollEngine.buildJobToClientMap_();
    expect(map).toEqual({});
  });
});
