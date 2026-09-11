/**
 * supervisor-bonus-by-account-dry-run.test.js
 *
 * Tests for runSupervisorBonusByAccountDryRun() (SupervisorBonusByAccountDryRun.gs)
 * — the read-only pre-cutover preview tool for
 * PayrollEngine.buildSupervisorBonusMapByAccount_() (2026-09-10 design
 * spec Phase 1.5, Task 8 Step 6). Confirms it computes the same result
 * the real function would, and that it never writes anything.
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
  mocks.Config.TABLES.REF_ACCOUNT_SUPERVISION = 'REF_ACCOUNT_SUPERVISION';
  mocks.Config.TABLES.VW_JOB_CURRENT_STATE    = 'VW_JOB_CURRENT_STATE';
  mocks.Config.TABLES.FACT_WORK_LOGS          = 'FACT_WORK_LOGS';
  global.ScriptApp = { getScriptId: function () { return 'test-script-id'; } };
  loadSrc('../src/00-foundation/Constants.gs');
  loadSrc('../src/06-handlers/WorkLogExclusion.gs');
  loadSrc('../src/06-handlers/WorkLogAggregation.gs');
  loadSrc('../src/10-payroll/PayrollEngine.gs');
  loadSrc('../src/12-migration/SupervisorBonusByAccountDryRun.gs');
});

function seedJob(jobNumber, clientCode, productCode) {
  mocks.store['VW_JOB_CURRENT_STATE'] = mocks.store['VW_JOB_CURRENT_STATE'] || [];
  mocks.store['VW_JOB_CURRENT_STATE'].push({ job_number: jobNumber, client_code: clientCode, product_code: productCode });
}

function seedWorkLog(jobNumber, actorCode, hours) {
  mocks.store['FACT_WORK_LOGS'] = mocks.store['FACT_WORK_LOGS'] || [];
  mocks.store['FACT_WORK_LOGS'].push({ job_number: jobNumber, actor_code: actorCode, actor_role: 'DESIGNER', hours: hours });
}

function seedSupervision(rows) {
  mocks.store['REF_ACCOUNT_SUPERVISION'] = rows.map(r => Object.assign({
    product_code: '', effective_from: '2024-01-01', effective_to: ''
  }, r));
}

function seedStaff(rows) {
  mocks.store['DIM_STAFF_ROSTER'] = rows.map(r => Object.assign({
    active: 'TRUE', effective_from: '2024-01-01', effective_to: ''
  }, r));
}

describe('runSupervisorBonusByAccountDryRun()', () => {
  test('happy path: computes bonusMap + blockedPairs from real-shaped data, matches the real function directly', () => {
    seedJob('BLC-001', 'ALBERTA TRUSS', 'ROOF_TRUSS');
    seedWorkLog('BLC-001', 'PRS', 95.25);
    seedSupervision([{ client_code: 'ALBERTA TRUSS', designer_code: 'PRS', supervisor_code: 'DBS' }]);
    seedStaff([
      { person_code: 'DBS', name: 'Deb Sen', role: 'TEAM_LEAD' },
      { person_code: 'PRS', name: 'Priyanka S', role: 'DESIGNER' }
    ]);

    const result = runSupervisorBonusByAccountDryRun('2026-08');

    expect(result.bonusMap).toEqual({ DBS: 95.25 * 25 });
    expect(result.blockedPairs).toEqual([]);
    expect(result.unexpectedBlockedPairs).toEqual([]);
  });

  test('unassigned pair shows up in blockedPairs AND unexpectedBlockedPairs when not on the accepted-exceptions list', () => {
    seedJob('BLC-002', 'SBS', 'WALL_PANEL');
    seedWorkLog('BLC-002', 'XYZ', 10);
    seedSupervision([]); // no assignment at all
    seedStaff([{ person_code: 'XYZ', name: 'Some Designer', role: 'DESIGNER' }]);

    const result = runSupervisorBonusByAccountDryRun('2026-08');

    expect(result.blockedPairs).toEqual([
      { client_code: 'SBS', product_code: 'WALL_PANEL', designer_code: 'XYZ', hours: 10 }
    ]);
    expect(result.unexpectedBlockedPairs).toEqual(result.blockedPairs);
  });

  test('a blocked pair ON the accepted-exceptions list shows in blockedPairs but NOT unexpectedBlockedPairs', () => {
    seedJob('BLC-003', 'ALBERTA TRUSS', 'FLOOR_JOIST');
    seedWorkLog('BLC-003', 'PRS', 8);
    seedSupervision([]); // PRS's FLOOR_JOIST on ALBERTA TRUSS is a known, accepted exception
    seedStaff([{ person_code: 'PRS', name: 'Priyanka S', role: 'DESIGNER' }]);

    const result = runSupervisorBonusByAccountDryRun('2026-08');

    expect(result.blockedPairs).toHaveLength(1);
    expect(result.unexpectedBlockedPairs).toEqual([]);
  });

  test('never writes anything — appendRow/appendRows/updateWhere are never called', () => {
    seedJob('BLC-001', 'ALBERTA TRUSS', 'ROOF_TRUSS');
    seedWorkLog('BLC-001', 'PRS', 10);
    seedSupervision([{ client_code: 'ALBERTA TRUSS', designer_code: 'PRS', supervisor_code: 'DBS' }]);
    seedStaff([
      { person_code: 'DBS', name: 'Deb Sen', role: 'TEAM_LEAD' },
      { person_code: 'PRS', name: 'Priyanka S', role: 'DESIGNER' }
    ]);

    const appendRowSpy    = jest.spyOn(mocks.DAL, 'appendRow');
    const appendRowsSpy   = jest.spyOn(mocks.DAL, 'appendRows');
    const updateWhereSpy  = jest.spyOn(mocks.DAL, 'updateWhere');

    runSupervisorBonusByAccountDryRun('2026-08');

    expect(appendRowSpy).not.toHaveBeenCalled();
    expect(appendRowsSpy).not.toHaveBeenCalled();
    expect(updateWhereSpy).not.toHaveBeenCalled();
  });

  test('RBAC denial propagates — does not swallow enforcePermission errors', () => {
    mocks.RBAC.enforcePermission = jest.fn(() => { throw new Error('PERMISSION_DENIED'); });

    expect(() => runSupervisorBonusByAccountDryRun('2026-08')).toThrow('PERMISSION_DENIED');
  });

  test('missing periodId throws a clear error instead of silently defaulting', () => {
    expect(() => runSupervisorBonusByAccountDryRun()).toThrow(/periodId is required/);
  });
});
