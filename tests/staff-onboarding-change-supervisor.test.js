/**
 * staff-onboarding-change-supervisor.test.js
 *
 * Tests for StaffOnboarding.changeSupervisor() — the SCD-2-style write
 * path for supervisor_code changes (Task 2, effective-dating). Convention
 * (explicit, from the user): the closed-out row's effective_to = the day
 * BEFORE the new effective date; the new row's effective_from = the
 * change date itself, effective_to = ''. Date-range lookups elsewhere are
 * inclusive on both ends (effective_from <= targetDate <= effective_to,
 * OR effective_to blank for the current row).
 *
 * DIM_STAFF_ROSTER is NOT append-only like FACT tables (Rule A5 applies
 * only to FACT tables) — it's a dimension table, and closing out the old
 * row via DAL.updateWhere() (setting effective_to) is the existing,
 * established pattern in this codebase (see StaffOnboarding.onboardStaff's
 * own activate-existing-row branch, and MigrationRunner.gs's active-flag
 * backfill).
 */

const fs   = require('fs');
const path = require('path');
const { installV3StaffMocks } = require('./gas-v3-staff-mocks');

function loadSrc(relPath) {
  // eval() loads trusted, repo-local .gs source (not user input) — same
  // pattern as every other test in this repo. Indirect (global) eval so
  // declarations become visible outside this helper.
  (0, eval)(fs.readFileSync(path.join(__dirname, relPath), 'utf8'));
}

let mocks;

beforeEach(() => {
  mocks = installV3StaffMocks();
  loadSrc('../src/08-staff/StaffOnboarding.gs');
});

function seedRoster(rows) {
  mocks.store['DIM_STAFF_ROSTER'] = rows.map(r => Object.assign({
    person_code: '', name: '', email: '', role: 'DESIGNER',
    supervisor_code: '', pm_code: '', pay_currency: 'INR',
    pay_design: 0, pay_qc: 0, bonus_eligible: 'FALSE',
    active: 'TRUE', effective_from: '2025-01-01', effective_to: ''
  }, r));
}

describe('StaffOnboarding.changeSupervisor()', () => {
  test('closes the old row (effective_to = day before effectiveDate) and inserts a new row (effective_from = effectiveDate)', () => {
    seedRoster([{ person_code: 'KUM', name: 'Test Kumar', supervisor_code: 'OLD_TL' }]);

    StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'KUM', 'NEW_TL', '2026-04-15');

    const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'KUM');
    expect(rows).toHaveLength(2);

    const oldRow = rows.find(r => r.supervisor_code === 'OLD_TL');
    const newRow = rows.find(r => r.supervisor_code === 'NEW_TL');

    expect(oldRow.effective_to).toBe('2026-04-14');   // day before the change date
    expect(newRow.effective_from).toBe('2026-04-15'); // the change date itself
    expect(newRow.effective_to).toBe('');
  });

  test('the new row copies forward every other field from the old row unchanged', () => {
    seedRoster([{
      person_code: 'KUM', name: 'Test Kumar', email: 'kum@test.blc.internal',
      role: 'DESIGNER', pm_code: 'PM1', pay_currency: 'INR',
      pay_design: 300, pay_qc: 300, bonus_eligible: 'TRUE',
      supervisor_code: 'OLD_TL'
    }]);

    StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'KUM', 'NEW_TL', '2026-04-15');

    const newRow = mocks.store['DIM_STAFF_ROSTER'].find(r => r.person_code === 'KUM' && r.supervisor_code === 'NEW_TL');
    expect(newRow.name).toBe('Test Kumar');
    expect(newRow.email).toBe('kum@test.blc.internal');
    expect(newRow.role).toBe('DESIGNER');
    expect(newRow.pm_code).toBe('PM1');
    expect(newRow.pay_design).toBe(300);
    expect(newRow.pay_qc).toBe(300);
    expect(newRow.bonus_eligible).toBe('TRUE');
    expect(newRow.active).toBe('TRUE');
  });

  test('idempotent: calling twice with the same (personCode, newSupervisorCode, effectiveDate) does not create duplicate rows', () => {
    seedRoster([{ person_code: 'KUM', supervisor_code: 'OLD_TL' }]);

    StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'KUM', 'NEW_TL', '2026-04-15');
    StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'KUM', 'NEW_TL', '2026-04-15');

    const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'KUM');
    expect(rows).toHaveLength(2); // still just old (closed) + new — not 3
  });

  test('a second, later supervisor change appends a third row and correctly closes the second', () => {
    seedRoster([{ person_code: 'KUM', supervisor_code: 'OLD_TL' }]);

    StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'KUM', 'MID_TL', '2026-04-15');
    StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'KUM', 'NEW_TL', '2026-07-01');

    const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'KUM');
    expect(rows).toHaveLength(3);

    const oldRow = rows.find(r => r.supervisor_code === 'OLD_TL');
    const midRow = rows.find(r => r.supervisor_code === 'MID_TL');
    const newRow = rows.find(r => r.supervisor_code === 'NEW_TL');

    expect(oldRow.effective_to).toBe('2026-04-14');
    expect(midRow.effective_from).toBe('2026-04-15');
    expect(midRow.effective_to).toBe('2026-06-30');
    expect(newRow.effective_from).toBe('2026-07-01');
    expect(newRow.effective_to).toBe('');
  });

  test('throws a clear error if person_code does not exist', () => {
    seedRoster([{ person_code: 'OTHER', supervisor_code: 'OLD_TL' }]);
    expect(() => StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'NOBODY', 'NEW_TL', '2026-04-15'))
      .toThrow(/NOBODY/);
  });

  test('throws a clear error if there is no currently-active (open-ended) row to close for that person', () => {
    // Every row for this person already has an effective_to set — nothing open to close.
    seedRoster([{ person_code: 'KUM', supervisor_code: 'OLD_TL', effective_to: '2026-01-01' }]);
    expect(() => StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'KUM', 'NEW_TL', '2026-04-15'))
      .toThrow(/no active|open-ended|current/i);
  });

  test('enforces RBAC — calls RBAC.enforcePermission with ADMIN_CONFIG, same tier as onboardStaff', () => {
    seedRoster([{ person_code: 'KUM', supervisor_code: 'OLD_TL' }]);
    const spy = jest.spyOn(mocks.RBAC, 'enforcePermission');

    StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'KUM', 'NEW_TL', '2026-04-15');

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'ADMIN_CONFIG');
  });

  describe('cycle prevention', () => {
    // The QC network is intentionally cyclic (e.g. BCH QCs SDA, SDA QCs
    // BCH) — but that lives in DIM_QC_ASSIGNMENTS (Task 3), never in
    // supervisor_code. The reporting tree itself must stay acyclic, or
    // buildSupervisorBonusMap_'s direct-match summation would still be
    // "correct" per its own logic but the org chart it's reading would be
    // nonsensical (A supervises B, B supervises A).

    test('rejects a direct 2-node cycle: A already supervises B, reject making B supervise A', () => {
      // TL_A currently supervises TL_B (TL_B.supervisor_code = TL_A).
      seedRoster([
        { person_code: 'TL_A', role: 'TEAM_LEAD', supervisor_code: 'PM1' },
        { person_code: 'TL_B', role: 'TEAM_LEAD', supervisor_code: 'TL_A' }
      ]);

      // Attempting to make TL_A report to TL_B would create TL_A -> TL_B -> TL_A.
      expect(() => StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'TL_A', 'TL_B', '2026-07-01'))
        .toThrow(/cycle/i);

      // Rejected — no new row should have been written.
      const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'TL_A');
      expect(rows).toHaveLength(1);
    });

    test('rejects an indirect 3-node cycle: A -> B -> C, reject making C supervise A', () => {
      // KUM.supervisor_code = TL_A, TL_A.supervisor_code = TL_B.
      seedRoster([
        { person_code: 'KUM',  role: 'DESIGNER',   supervisor_code: 'TL_A' },
        { person_code: 'TL_A', role: 'TEAM_LEAD',  supervisor_code: 'TL_B' },
        { person_code: 'TL_B', role: 'TEAM_LEAD',  supervisor_code: 'PM1'  }
      ]);

      // Attempting to make TL_B report to KUM would create TL_B -> KUM -> TL_A -> TL_B.
      expect(() => StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'TL_B', 'KUM', '2026-07-01'))
        .toThrow(/cycle/i);

      const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'TL_B');
      expect(rows).toHaveLength(1);
    });

    test('refuses to run if the person has MORE THAN ONE open-ended row — refuses to guess which to close', () => {
      seedRoster([
        { person_code: 'KUM', supervisor_code: 'OLD_TL', effective_from: '2024-01-01', effective_to: '' },
        { person_code: 'KUM', supervisor_code: 'OTHER_TL', effective_from: '2025-01-01', effective_to: '' }
      ]);

      expect(() => StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'KUM', 'NEW_TL', '2026-07-01'))
        .toThrow(/KUM/);

      // Rejected before any write — still exactly the 2 pre-existing rows.
      const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'KUM');
      expect(rows).toHaveLength(2);
    });

    test('allows a legitimate re-parenting that does not create a cycle', () => {
      // TL_A and TL_B are peers (both report to PM1) — moving TL_B under
      // TL_A is fine, no cycle.
      seedRoster([
        { person_code: 'TL_A', role: 'TEAM_LEAD', supervisor_code: 'PM1' },
        { person_code: 'TL_B', role: 'TEAM_LEAD', supervisor_code: 'PM1' }
      ]);

      expect(() => StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'TL_B', 'TL_A', '2026-07-01'))
        .not.toThrow();

      const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'TL_B');
      expect(rows).toHaveLength(2);
    });
  });

  describe('write-result verification — closedRow/newRowCreated must be derived from DAL results, never hardcoded', () => {
    // Root cause of the 2026-07-25 DEV rehearsal failure: the real DAL's
    // updateWhere matched on effective_from, a date-formatted column —
    // Sheets returns a fresh Date object per getValues() read, and
    // matchesConditions_'s loose `!=` is reference-identity for two
    // distinct Date instances, so the match silently failed (0 rows
    // updated) while scd2FieldChange_ returned closedRow: true anyway,
    // because that flag was a hardcoded literal, never checked against
    // DAL.updateWhere's actual { updated: N } result. Fixed two ways:
    // (1) match on effective_to = '' instead of the date column, (2)
    // assert the write affected exactly one row before proceeding.
    // These tests target (2) directly, at the Jest level, by making the
    // DAL layer itself report a bad count — independent of whether the
    // real Sheets Date-object bug can be reproduced in a mock at all.

    test('throws if the close-row write reports it affected ZERO rows, even though the row exists', () => {
      seedRoster([{ person_code: 'KUM', supervisor_code: 'OLD_TL' }]);
      const originalUpdateWhere = mocks.DAL.updateWhere;
      mocks.DAL.updateWhere = jest.fn(() => ({ updated: 0 }));

      try {
        expect(() => StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'KUM', 'NEW_TL', '2026-07-01'))
          .toThrow(/KUM/);
      } finally {
        mocks.DAL.updateWhere = originalUpdateWhere;
      }
    });

    test('throws if the close-row write reports it affected MORE THAN ONE row', () => {
      seedRoster([{ person_code: 'KUM', supervisor_code: 'OLD_TL' }]);
      const originalUpdateWhere = mocks.DAL.updateWhere;
      mocks.DAL.updateWhere = jest.fn(() => ({ updated: 2 }));

      try {
        expect(() => StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'KUM', 'NEW_TL', '2026-07-01'))
          .toThrow(/KUM/);
      } finally {
        mocks.DAL.updateWhere = originalUpdateWhere;
      }
    });

    test('after changeSupervisor(), a FRESH DAL re-read (not the return value, not the in-memory store) confirms the old row is truly closed and exactly one row is open-ended', () => {
      seedRoster([{ person_code: 'KUM', supervisor_code: 'OLD_TL' }]);

      StaffOnboarding.changeSupervisor('ceo@test.blc.internal', 'KUM', 'NEW_TL', '2026-07-01');

      const rows = mocks.DAL.readWhere('DIM_STAFF_ROSTER', { person_code: 'KUM' });
      expect(rows).toHaveLength(2);

      const openRows = rows.filter(r => !String(r.effective_to || '').trim());
      expect(openRows).toHaveLength(1);
      expect(openRows[0].supervisor_code).toBe('NEW_TL');

      const closedRows = rows.filter(r => String(r.effective_to || '').trim());
      expect(closedRows).toHaveLength(1);
      expect(closedRows[0].effective_to).toBe('2026-06-30');
      expect(closedRows[0].supervisor_code).toBe('OLD_TL');
    });
  });
});
