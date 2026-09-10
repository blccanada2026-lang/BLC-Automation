/**
 * staff-onboarding-assign-account-supervisor.test.js
 *
 * Tests for StaffOnboarding.assignAccountSupervisor() — the SCD-2-style
 * write path for REF_ACCOUNT_SUPERVISION, keyed on (client_code,
 * designer_code) rather than person_code alone (see scd2FieldChange_ and
 * changeSupervisor for the DIM_STAFF_ROSTER analog this mirrors the
 * pattern of, not the code of — see 2026-09-08 design spec §6.2).
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
  loadSrc('../src/08-staff/StaffOnboarding.gs');
});

function seedSupervision(rows) {
  mocks.store['REF_ACCOUNT_SUPERVISION'] = rows.map(r => Object.assign({
    client_code: '', product_code: '', designer_code: '', supervisor_code: '',
    effective_from: '2024-01-01', effective_to: '', notes: ''
  }, r));
}

describe('StaffOnboarding.assignAccountSupervisor()', () => {
  test('first assignment ever for a (client, designer) pair: no row to close, just appends', () => {
    seedSupervision([]);

    const result = StaffOnboarding.assignAccountSupervisor(
      'ceo@test.blc.internal', 'ALBERTA TRUSS', 'PRS', 'DBS', '2026-09-08'
    );

    expect(result.closedRow).toBe(false);
    expect(result.newRowCreated).toBe(true);

    const rows = mocks.store['REF_ACCOUNT_SUPERVISION'].filter(
      r => r.client_code === 'ALBERTA TRUSS' && r.designer_code === 'PRS'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].supervisor_code).toBe('DBS');
    expect(rows[0].effective_from).toBe('2026-09-08');
    expect(rows[0].effective_to).toBe('');
  });

  test('reassignment: closes the old row (effective_to = day before) and inserts a new one', () => {
    seedSupervision([
      { client_code: 'TITAN TRUSS', designer_code: 'PRS', supervisor_code: 'PBG', effective_from: '2025-01-01', effective_to: '' }
    ]);

    StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'TITAN TRUSS', 'PRS', 'DBS', '2026-09-08');

    const rows = mocks.store['REF_ACCOUNT_SUPERVISION'].filter(
      r => r.client_code === 'TITAN TRUSS' && r.designer_code === 'PRS'
    );
    expect(rows).toHaveLength(2);
    const oldRow = rows.find(r => r.supervisor_code === 'PBG');
    const newRow = rows.find(r => r.supervisor_code === 'DBS');
    expect(oldRow.effective_to).toBe('2026-09-07');
    expect(newRow.effective_from).toBe('2026-09-08');
    expect(newRow.effective_to).toBe('');
  });

  test('idempotent: calling twice with the same (client, designer, supervisor, effectiveDate) does not duplicate', () => {
    seedSupervision([]);

    StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'SBS', 'BIT', 'BCH', '2026-09-08');
    StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'SBS', 'BIT', 'BCH', '2026-09-08');

    const rows = mocks.store['REF_ACCOUNT_SUPERVISION'].filter(
      r => r.client_code === 'SBS' && r.designer_code === 'BIT'
    );
    expect(rows).toHaveLength(1);
  });

  test('a different designer on the same account gets an independent row — pairs are (client, designer), not per-client-only', () => {
    seedSupervision([]);

    StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'SBS', 'BIT', 'BCH', '2026-09-08');
    StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'SBS', 'ABB', 'SVN', '2026-09-08');

    const bitRows = mocks.store['REF_ACCOUNT_SUPERVISION'].filter(r => r.designer_code === 'BIT');
    const abbRows = mocks.store['REF_ACCOUNT_SUPERVISION'].filter(r => r.designer_code === 'ABB');
    expect(bitRows).toHaveLength(1);
    expect(abbRows).toHaveLength(1);
    expect(bitRows[0].supervisor_code).toBe('BCH');
    expect(abbRows[0].supervisor_code).toBe('SVN');
  });

  test('the same designer on two different accounts (Bharath\'s two-team case) gets two independent rows', () => {
    seedSupervision([]);

    // Bharath (BCH) supervises different designers on SBS vs Norspan —
    // this test is from the OTHER side: one designer, two accounts, two
    // different supervisors, proving the composite key isn't collapsed
    // to designer_code alone.
    StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'SBS', 'RKG', 'BCH', '2026-09-08');
    StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'NORSPAN', 'RKG', 'SDA', '2026-09-08');

    const rows = mocks.store['REF_ACCOUNT_SUPERVISION'].filter(r => r.designer_code === 'RKG');
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.client_code === 'SBS').supervisor_code).toBe('BCH');
    expect(rows.find(r => r.client_code === 'NORSPAN').supervisor_code).toBe('SDA');
  });

  test('rejects a backdate to at/before the current open row\'s own effective_from (inverted-window guard)', () => {
    seedSupervision([
      { client_code: 'SBS', designer_code: 'BIT', supervisor_code: 'BCH', effective_from: '2026-09-08', effective_to: '' }
    ]);

    expect(() => StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'SBS', 'BIT', 'SDA', '2026-09-01'))
      .toThrow(/inverted|before/i);

    const rows = mocks.store['REF_ACCOUNT_SUPERVISION'].filter(r => r.designer_code === 'BIT');
    expect(rows).toHaveLength(1); // rejected before any write
  });

  test('enforces RBAC — calls RBAC.enforcePermission with ADMIN_CONFIG, same tier as changeSupervisor/changePayRate', () => {
    seedSupervision([]);
    const spy = jest.spyOn(mocks.RBAC, 'enforcePermission');

    StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'SBS', 'BIT', 'BCH', '2026-09-08');

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'ADMIN_CONFIG');
  });

  test('throws a clear error if clientCode, designerCode, or supervisorCode is blank', () => {
    seedSupervision([]);
    expect(() => StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', '', 'BIT', 'BCH', '2026-09-08'))
      .toThrow(/clientCode/i);
    expect(() => StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'SBS', '', 'BCH', '2026-09-08'))
      .toThrow(/designerCode/i);
    expect(() => StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'SBS', 'BIT', '', '2026-09-08'))
      .toThrow(/supervisorCode/i);
  });

  test('productCode defaults to blank (wildcard) when omitted — existing whole-account call shape still works', () => {
    seedSupervision([]);

    const result = StaffOnboarding.assignAccountSupervisor(
      'ceo@test.blc.internal', 'SBS', 'MARV', 'BCH', '2026-08-01'
    );

    expect(result.productCode).toBe('');
    const rows = mocks.store['REF_ACCOUNT_SUPERVISION'].filter(r => r.client_code === 'SBS' && r.designer_code === 'MARV');
    expect(rows).toHaveLength(1);
    expect(rows[0].product_code).toBe('');
  });

  test('a product-specific assignment and a whole-account (wildcard) assignment for the same designer+client coexist as two independent rows', () => {
    seedSupervision([]);

    StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'ALBERTA TRUSS', 'PRS', 'DBS', '2026-08-01', 'ROOF_TRUSS');
    StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'ALBERTA TRUSS', 'PRS', 'DBS', '2026-08-01', 'FLOOR_TRUSS');

    const rows = mocks.store['REF_ACCOUNT_SUPERVISION'].filter(r => r.client_code === 'ALBERTA TRUSS' && r.designer_code === 'PRS');
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.product_code).sort()).toEqual(['FLOOR_TRUSS', 'ROOF_TRUSS']);
  });

  test('reassigning one product does not close or affect a different product\'s open row for the same designer+client', () => {
    seedSupervision([
      { client_code: 'NELSON', product_code: 'ROOF_TRUSS',  designer_code: 'AR001', supervisor_code: 'DBS', effective_from: '2026-08-01', effective_to: '' },
      { client_code: 'NELSON', product_code: 'FLOOR_TRUSS', designer_code: 'AR001', supervisor_code: 'DBS', effective_from: '2026-08-01', effective_to: '' }
    ]);

    StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'NELSON', 'AR001', 'SGO', '2026-09-01', 'ROOF_TRUSS');

    const rows = mocks.store['REF_ACCOUNT_SUPERVISION'].filter(r => r.client_code === 'NELSON' && r.designer_code === 'AR001');
    expect(rows).toHaveLength(3); // ROOF_TRUSS closed+reopened (2) + FLOOR_TRUSS untouched (1)

    const floorTruss = rows.find(r => r.product_code === 'FLOOR_TRUSS');
    expect(floorTruss.supervisor_code).toBe('DBS');
    expect(floorTruss.effective_to).toBe(''); // untouched

    const roofTrussOld = rows.find(r => r.product_code === 'ROOF_TRUSS' && r.supervisor_code === 'DBS');
    const roofTrussNew = rows.find(r => r.product_code === 'ROOF_TRUSS' && r.supervisor_code === 'SGO');
    expect(roofTrussOld.effective_to).toBe('2026-08-31');
    expect(roofTrussNew.effective_from).toBe('2026-09-01');
  });

  test('throws if more than one open-ended row exists for the same (client, product, designer) — refuses to guess which to close', () => {
    seedSupervision([
      { client_code: 'SBS', product_code: 'ROOF_TRUSS', designer_code: 'BIT', supervisor_code: 'BCH', effective_from: '2024-01-01', effective_to: '' },
      { client_code: 'SBS', product_code: 'ROOF_TRUSS', designer_code: 'BIT', supervisor_code: 'SDA', effective_from: '2025-01-01', effective_to: '' }
    ]);

    expect(() => StaffOnboarding.assignAccountSupervisor('ceo@test.blc.internal', 'SBS', 'BIT', 'SVN', '2026-08-01', 'ROOF_TRUSS'))
      .toThrow(/SBS/);
  });

  test('throws if productCode is given but REF_ACCOUNT_SUPERVISION has no product_code column yet (schema patch not run), rather than silently writing a wildcard row', () => {
    mocks.store['REF_ACCOUNT_SUPERVISION'] = [
      { client_code: 'SBS', designer_code: 'MARV', supervisor_code: 'BCH', effective_from: '2024-01-01', effective_to: '' }
      // deliberately no product_code key on this row — simulates a pre-patch sheet
    ];

    expect(() => StaffOnboarding.assignAccountSupervisor(
      'ceo@test.blc.internal', 'ALBERTA TRUSS', 'PRS', 'DBS', '2026-08-01', 'ROOF_TRUSS'
    )).toThrow(/product_code column/);
  });

  test('a wildcard (blank productCode) call is unaffected by a missing product_code column — no guard needed since it never writes the field', () => {
    mocks.store['REF_ACCOUNT_SUPERVISION'] = [
      { client_code: 'SBS', designer_code: 'MARV', supervisor_code: 'BCH', effective_from: '2024-01-01', effective_to: '' }
    ];

    expect(() => StaffOnboarding.assignAccountSupervisor(
      'ceo@test.blc.internal', 'NORSPAN-MB', 'VKV', 'BCH', '2026-08-01'
    )).not.toThrow();
  });
});
