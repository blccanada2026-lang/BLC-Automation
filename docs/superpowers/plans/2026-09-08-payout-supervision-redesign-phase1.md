# Payout & Account-Supervision Redesign — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy the data model and calculation logic for account-scoped Team Lead bonus attribution, without changing what production payroll actually pays out until a real-data backfill is complete and verified.

**Architecture:** A new effective-dated reference table (`REF_ACCOUNT_SUPERVISION`) records which Team Lead supervises which designer on which client account. A new, separate bonus-calculation function reads this table and computes bonuses per (designer, account) pair instead of the current company-wide flat sum. The new function is built, tested, and deployed alongside the old one — `runBonusRun` and `previewPayoutStatement` keep calling the OLD function until a final, explicitly human-gated cutover task swaps them over.

**Tech Stack:** Google Apps Script (V8), Jest for tests (GAS source loaded via `eval()` against hand-rolled mocks — no GAS runtime in CI), clasp for deployment.

**Spec:** `docs/superpowers/specs/2026-09-08-payout-supervision-redesign-design.md`

## Global Constraints

- RBAC: every new function's first two lines are `RBAC.resolveActor(actorEmail)` then `RBAC.enforcePermission(actor, ...)` — no exceptions, no code between them.
- DAL only: never call `SpreadsheetApp` directly. Every `DAL.appendRow`/`DAL.updateWhere`/`DAL.readWhere`/`DAL.readAll` call on `REF_ACCOUNT_SUPERVISION` passes `{ callerModule: 'StaffOnboarding' }`.
- `REF_ACCOUNT_SUPERVISION` writes require `'StaffOnboarding'` in DAL's `WRITE_PERMISSIONS['REF_ACCOUNT_SUPERVISION']` allow-list (added in Task 1) — any write with a different `callerModule` string must be rejected by the existing DAL guard, not by new code in this plan.
- TDD: every task writes a failing test first, watches it fail for the stated reason, then writes minimal code to pass. Full suite (`npm test`) must stay green before any commit that isn't itself a WIP mid-task state.
- Every commit touching `StaffOnboarding.gs`, `PayrollEngine.gs`, or `WorkLogAggregation.gs` gets an independent code-reviewer subagent pass before merge to `main` (per this repo's established practice — a real bug was caught this way on the smaller, related `changePayRate` function in this same lineage).
- Git: this plan assumes work happens in an isolated worktree (create via the using-git-worktrees skill / `EnterWorktree` at execution time). Merge to `main` via `git push origin HEAD:main` (fast-forward only) — worktree sessions in this environment cannot merge into the primary checkout directly. `npm run push:prod` runs ONLY from the primary checkout, after pulling `main`, never from a worktree.
- `PortalView.html`/`Portal.gs` are NOT touched anywhere in this plan (Phase 1 has no UI) — no manual "New Version" redeploy is needed for any task here.
- Do not implement Phase 2 (portal panel, `updateStaffRecord`, `STAFF_PAYOUT_ADMIN`) as part of this plan — it gets its own plan once Task 7's backfill is verified complete.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/00-foundation/Config.gs` | Register `REF_ACCOUNT_SUPERVISION` in `Config.TABLES` (Task 1). |
| `src/setup/SetupScript.gs` | Register `REF_ACCOUNT_SUPERVISION`'s column schema in `SCHEMAS` so `runSetupSchemas()` provisions the sheet (Task 1). |
| `src/01-dal/DAL.gs` | Add `REF_ACCOUNT_SUPERVISION: ['AdminEngine', 'MigrationEngine', 'StaffOnboarding']` to `WRITE_PERMISSIONS` (Task 1). |
| `src/08-staff/StaffOnboarding.gs` | New `assignAccountSupervisor()` — effective-dated open/close on `REF_ACCOUNT_SUPERVISION` (Task 2). |
| `src/06-handlers/WorkLogAggregation.gs` | One-line `QC_REVIEWER` fix (Task 3); new `aggregateNetWorkLogHoursByAccount()` sibling function (Task 4). |
| `src/10-payroll/PayrollEngine.gs` | New `buildJobToClientMap_()` (Task 5); new `buildSupervisorBonusMapByAccount_()` (Task 6); final cutover edit to `runBonusRun`/`previewPayoutStatement` (Task 8). |
| `tests/staff-onboarding-assign-account-supervisor.test.js` | New. Mirrors `tests/staff-onboarding-change-supervisor.test.js`'s pattern. |
| `tests/work-log-aggregation.test.js` | Extended with the `QC_REVIEWER` fix test and the new `aggregateNetWorkLogHoursByAccount` describe block. |
| `tests/payroll-engine-job-to-client-map.test.js` | New. |
| `tests/payroll-engine-supervisor-bonus-by-account.test.js` | New. Mirrors `tests/payroll-engine-pm-bonus.test.js`'s mock/helper pattern. |

---

### Task 1: `REF_ACCOUNT_SUPERVISION` table registration

**Files:**
- Modify: `src/00-foundation/Config.gs:177` (insert after `REF_ACCOUNT_DESIGNER_MAP`)
- Modify: `src/setup/SetupScript.gs:167` (insert after `REF_ACCOUNT_DESIGNER_MAP`'s schema block)
- Modify: `src/01-dal/DAL.gs:92` (insert after `DIM_SEQUENCE_COUNTERS` in `WRITE_PERMISSIONS`)

**Interfaces:**
- Produces: `Config.TABLES.REF_ACCOUNT_SUPERVISION` (string `'REF_ACCOUNT_SUPERVISION'`), a `SCHEMAS['REF_ACCOUNT_SUPERVISION']` column list, and DAL write access for `callerModule: 'StaffOnboarding'`. Task 2 depends on all three existing before writing any code.

This task is pure configuration/schema — no new logic, so it has no dedicated test file of its own. Its correctness is verified by Task 2's tests, which exercise real `DAL.appendRow`/`DAL.updateWhere` calls against this table through the shared mock harness (which reads `Config.TABLES` and `WRITE_PERMISSIONS` the same way the real DAL does).

- [ ] **Step 1: Add the table name to `Config.TABLES`**

In `src/00-foundation/Config.gs`, immediately after line 177 (`REF_ACCOUNT_DESIGNER_MAP: 'REF_ACCOUNT_DESIGNER_MAP',`):

```javascript
    REF_ACCOUNT_SUPERVISION: 'REF_ACCOUNT_SUPERVISION', // which Team Lead supervises which designer, per client account (bonus attribution)
```

- [ ] **Step 2: Add the column schema**

In `src/setup/SetupScript.gs`, immediately after the `REF_ACCOUNT_DESIGNER_MAP` schema block (after line 167's closing `],`):

```javascript
  // Which Team Lead/PM supervises which designer, on which client account —
  // the source of truth for INR 25/hr supervisor bonus attribution.
  // Effective-dated (D4): effective_to blank = the currently active
  // assignment for that (client_code, designer_code) pair. NEVER derive
  // this from DIM_STAFF_ROSTER.supervisor_code — that field cannot express
  // "this designer's hours on Account X go to Lead A, but on Account Y go
  // to Lead B" (see 2026-09-08 design spec, problem statement).
  'REF_ACCOUNT_SUPERVISION': [
    'client_code', 'designer_code', 'supervisor_code',
    'effective_from', 'effective_to', 'notes'
  ],
```

- [ ] **Step 3: Grant `StaffOnboarding` write access**

In `src/01-dal/DAL.gs`, immediately after line 92 (`'DIM_SEQUENCE_COUNTERS': ['JobCreateHandler', 'AdminEngine'],`):

```javascript
    'REF_ACCOUNT_SUPERVISION':  ['AdminEngine', 'MigrationEngine', 'StaffOnboarding'],
```

- [ ] **Step 4: Commit**

```bash
git add src/00-foundation/Config.gs src/setup/SetupScript.gs src/01-dal/DAL.gs
git commit -m "Register REF_ACCOUNT_SUPERVISION table (schema, config, DAL write grant)"
```

---

### Task 2: `StaffOnboarding.assignAccountSupervisor()`

**Files:**
- Modify: `src/08-staff/StaffOnboarding.gs` (add new private helper + public function + export entry)
- Test: `tests/staff-onboarding-assign-account-supervisor.test.js` (new)

**Interfaces:**
- Consumes: `RBAC.resolveActor(email)`, `RBAC.enforcePermission(actor, action)`, `RBAC.ACTIONS.ADMIN_CONFIG`, `DAL.readWhere(table, conditions, opts)`, `DAL.updateWhere(table, conditions, updates, opts)`, `DAL.appendRow(table, row, opts)`, `Config.TABLES.REF_ACCOUNT_SUPERVISION` (from Task 1).
- Produces: `StaffOnboarding.assignAccountSupervisor(actorEmail, clientCode, designerCode, supervisorCode, effectiveDate)` → `{ clientCode, designerCode, closedRow: boolean, newRowCreated: boolean, changed: boolean, reason: string }`. Task 6's tests use this to seed `REF_ACCOUNT_SUPERVISION` rows.

This is the same close-current/open-new pattern as `scd2FieldChange_`, but keyed on `(client_code, designer_code)` instead of `person_code` alone — not a literal reuse (per spec §6.2), a fresh small implementation.

- [ ] **Step 1: Write the failing tests**

Create `tests/staff-onboarding-assign-account-supervisor.test.js`:

```javascript
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
    client_code: '', designer_code: '', supervisor_code: '',
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/staff-onboarding-assign-account-supervisor.test.js -v`
Expected: FAIL — `TypeError: StaffOnboarding.assignAccountSupervisor is not a function` (and `Config.TABLES.REF_ACCOUNT_SUPERVISION` reads as `undefined` if Task 1 wasn't done first — do Task 1 first).

- [ ] **Step 3: Implement `assignAccountSupervisor`**

In `src/08-staff/StaffOnboarding.gs`, add immediately after `changePayRate`'s closing brace (before the `// ============================================================\n  // PUBLIC API` section marker):

```javascript
  /**
   * Effective-dated assignment of which Team Lead/PM supervises a
   * designer on a specific client account — the source of truth for
   * INR 25/hr supervisor bonus attribution (see 2026-09-08 design spec).
   * Same close-current/open-new SCD-2 pattern as scd2FieldChange_, but
   * keyed on (client_code, designer_code) — a fresh implementation, not
   * a reuse, since scd2FieldChange_ is keyed on person_code alone.
   * CEO + Admin only. Idempotent on (clientCode, designerCode,
   * supervisorCode, effectiveDate).
   *
   * @param {string} actorEmail
   * @param {string} clientCode
   * @param {string} designerCode
   * @param {string} supervisorCode
   * @param {string} effectiveDate  'YYYY-MM-DD'
   * @returns {{ clientCode: string, designerCode: string, closedRow: boolean, newRowCreated: boolean, changed: boolean, reason: string }}
   */
  function assignAccountSupervisor(actorEmail, clientCode, designerCode, supervisorCode, effectiveDate) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    clientCode     = String(clientCode || '').trim().toUpperCase();
    designerCode   = String(designerCode || '').trim().toUpperCase();
    supervisorCode = String(supervisorCode || '').trim().toUpperCase();
    effectiveDate  = String(effectiveDate || '').trim();

    if (!clientCode)     throw new Error('StaffOnboarding.assignAccountSupervisor: clientCode is required');
    if (!designerCode)   throw new Error('StaffOnboarding.assignAccountSupervisor: designerCode is required');
    if (!supervisorCode) throw new Error('StaffOnboarding.assignAccountSupervisor: supervisorCode is required');
    if (!effectiveDate)  throw new Error('StaffOnboarding.assignAccountSupervisor: effectiveDate is required (YYYY-MM-DD)');

    var existing;
    try {
      existing = DAL.readWhere(Config.TABLES.REF_ACCOUNT_SUPERVISION,
        { client_code: clientCode, designer_code: designerCode }, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') existing = [];
      else throw e;
    }

    var openRows = (existing || []).filter(function (r) { return !String(r.effective_to || '').trim(); });
    if (openRows.length > 1) {
      throw new Error('StaffOnboarding.assignAccountSupervisor: found ' + openRows.length + ' open-ended rows for ' +
                       clientCode + '/' + designerCode + ' — refusing to guess which to close.');
    }

    var currentRow = openRows[0];

    if (currentRow) {
      var currentEffFrom = toIsoDateStr_(currentRow.effective_from);
      if (currentEffFrom === effectiveDate && String(currentRow.supervisor_code).trim().toUpperCase() === supervisorCode) {
        return { clientCode: clientCode, designerCode: designerCode, closedRow: false, newRowCreated: false,
                 changed: false, reason: 'already_current' };
      }
      var closedTo = dayBefore_(effectiveDate);
      if (closedTo < currentEffFrom) {
        throw new Error('StaffOnboarding.assignAccountSupervisor: refusing to close the current row for ' +
                         clientCode + '/' + designerCode + ' (effective_from="' + currentEffFrom + '") with ' +
                         'effective_to="' + closedTo + '" — that is BEFORE the row\'s own start date, an ' +
                         'inverted/impossible validity window. effectiveDate must be after "' + currentEffFrom + '".');
      }

      var updateResult = DAL.updateWhere(
        Config.TABLES.REF_ACCOUNT_SUPERVISION,
        { client_code: clientCode, designer_code: designerCode, effective_to: '' },
        { effective_to: closedTo },
        { callerModule: MODULE }
      );
      var closedCount = (updateResult && typeof updateResult.updated === 'number') ? updateResult.updated : 0;
      if (closedCount !== 1) {
        throw new Error('StaffOnboarding.assignAccountSupervisor: expected the close-row write to affect exactly ' +
                         '1 row for ' + clientCode + '/' + designerCode + ' but it reported ' + closedCount + '.');
      }
    }

    DAL.appendRow(Config.TABLES.REF_ACCOUNT_SUPERVISION, {
      client_code:     clientCode,
      designer_code:   designerCode,
      supervisor_code: supervisorCode,
      effective_from:  effectiveDate,
      effective_to:    '',
      notes:           ''
    }, { callerModule: MODULE });

    return { clientCode: clientCode, designerCode: designerCode, closedRow: !!currentRow, newRowCreated: true,
             changed: true, reason: 'applied' };
  }
```

- [ ] **Step 4: Add the export**

In `src/08-staff/StaffOnboarding.gs`'s `PUBLIC API` return object, immediately after the `changePayRate: changePayRate` entry:

```javascript
    changePayRate: changePayRate,

    /**
     * Effective-dated assignment of a designer's supervisor on a specific
     * client account (REF_ACCOUNT_SUPERVISION). CEO + Admin only.
     * Idempotent on (clientCode, designerCode, supervisorCode, effectiveDate).
     */
    assignAccountSupervisor: assignAccountSupervisor
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/staff-onboarding-assign-account-supervisor.test.js -v`
Expected: PASS, all 8 tests.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/08-staff/StaffOnboarding.gs tests/staff-onboarding-assign-account-supervisor.test.js
git commit -m "Add StaffOnboarding.assignAccountSupervisor() for account-scoped supervision"
```

---

### Task 3: `WorkLogAggregation.gs:70` — `QC_REVIEWER` classification fix

**Files:**
- Modify: `src/06-handlers/WorkLogAggregation.gs:70`
- Test: `tests/work-log-aggregation.test.js` (extend)

**Interfaces:**
- Produces: `aggregateNetWorkLogHours(rows)` now classifies `actor_role === 'QC_REVIEWER'` rows into `qc_hours`, same as `'QC'`. No signature change — existing callers (`PayrollEngine.aggregateHours_`, `QuarterlyBonusEngine`, `GenerateTimesheet.gs`) are unaffected in shape, only in the (now-correct) result for `QC_REVIEWER` rows.

- [ ] **Step 1: Write the failing test**

In `tests/work-log-aggregation.test.js`, add this test inside the existing `describe('aggregateNetWorkLogHours()', ...)` block:

```javascript
  test('classifies QC_REVIEWER rows as qc_hours, same as QC (RBAC.gs alias, not applied to actor.role outside RBAC\'s own matrix lookup — see 2026-09-08 design spec, Discrepancy 1)', () => {
    const rows = [
      { actor_code: 'DBS', actor_role: 'QC_REVIEWER', hours: 4, event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'DBS', actor_role: 'QC_REVIEWER', hours: 3, event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHours(rows);
    expect(result.DBS.qc_hours).toBe(7);
    expect(result.DBS.design_hours).toBe(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/work-log-aggregation.test.js -v`
Expected: FAIL — `expect(result.DBS.qc_hours).toBe(7)` receives `0` (all 7 hours landed in `design_hours` instead).

- [ ] **Step 3: Implement the fix**

In `src/06-handlers/WorkLogAggregation.gs`, line 70, change:

```javascript
    if (role === 'QC') {
```

to:

```javascript
    if (role === 'QC' || role === 'QC_REVIEWER') {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/work-log-aggregation.test.js -v`
Expected: PASS, all tests in the file including the new one.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions (this function is shared by `PayrollEngine.gs`, `QuarterlyBonusEngine.gs`, `GenerateTimesheet.gs` — confirm none of their existing tests assumed the old, incorrect classification).

- [ ] **Step 6: Commit**

```bash
git add src/06-handlers/WorkLogAggregation.gs tests/work-log-aggregation.test.js
git commit -m "Fix QC_REVIEWER hours misclassified as design_hours in aggregateNetWorkLogHours"
```

---

### Task 4: `aggregateNetWorkLogHoursByAccount()` — per-account hours aggregation

**Files:**
- Modify: `src/06-handlers/WorkLogAggregation.gs` (add new sibling function)
- Test: `tests/work-log-aggregation.test.js` (extend)

**Interfaces:**
- Consumes: nothing new — pure function over its two parameters, same `isMigratedWorkLog` helper `aggregateNetWorkLogHours` already uses.
- Produces: `aggregateNetWorkLogHoursByAccount(rows, jobToClientMap)` → `{ personCode: { clientCode: { design_hours, qc_hours } } }`. Task 6 consumes this directly. `jobToClientMap` is a plain object `{ jobNumber: clientCode }` — Task 5 produces it.

- [ ] **Step 1: Write the failing tests**

In `tests/work-log-aggregation.test.js`, add a new top-level `describe` block after the existing `aggregateNetWorkLogHours()` block:

```javascript
describe('aggregateNetWorkLogHoursByAccount()', () => {
  const jobToClientMap = {
    'BLC-01001': 'ALBERTA TRUSS',
    'BLC-01002': 'TITAN TRUSS',
    'BLC-01003': 'SBS'
  };

  test('sums hours per (actor, client_code), split design vs QC', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 4, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'QC_REVIEWER', hours: 2, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientMap);
    expect(result.PRS['ALBERTA TRUSS'].design_hours).toBe(10);
    expect(result.PRS['ALBERTA TRUSS'].qc_hours).toBe(2);
  });

  test('the same person\'s hours on two different accounts stay in separate buckets', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 3, job_number: 'BLC-01002', event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientMap);
    expect(result.PRS['ALBERTA TRUSS'].design_hours).toBe(6);
    expect(result.PRS['TITAN TRUSS'].design_hours).toBe(3);
  });

  test('nets a WORK_LOG_VOIDED negative delta against the same (actor, client_code) bucket', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: -6, job_number: 'BLC-01001', event_type: 'WORK_LOG_VOIDED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientMap);
    expect(result.PRS['ALBERTA TRUSS'].design_hours).toBe(0);
  });

  test('excludes migrated rows, same as aggregateNetWorkLogHours', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 40, job_number: 'BLC-01001', event_type: 'WORK_LOG_MIGRATED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientMap);
    expect(result.PRS['ALBERTA TRUSS'].design_hours).toBe(6);
  });

  test('a row whose job_number has no entry in jobToClientMap is bucketed under a literal "(UNKNOWN)" key, not silently dropped', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 5, job_number: 'BLC-99999', event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientMap);
    expect(result.PRS['(UNKNOWN)'].design_hours).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/work-log-aggregation.test.js -v`
Expected: FAIL — `TypeError: aggregateNetWorkLogHoursByAccount is not a function`.

- [ ] **Step 3: Implement `aggregateNetWorkLogHoursByAccount`**

In `src/06-handlers/WorkLogAggregation.gs`, add immediately after `aggregateNetWorkLogHours`'s closing brace:

```javascript
/**
 * Same NET-hours aggregation principle as aggregateNetWorkLogHours (void/
 * amendment deltas netted against their originals, migrated rows
 * excluded), but bucketed per (actor_code, client_code) instead of just
 * actor_code — needed for account-scoped Team Lead bonus attribution
 * (2026-09-08 design spec). A row whose job_number isn't in jobToClientMap
 * is bucketed under the literal key '(UNKNOWN)' rather than dropped, so a
 * stale/missing job-to-client mapping is visible in the result rather than
 * silently losing hours.
 *
 * @param {Array<Object>} rows
 * @param {Object} jobToClientMap  { jobNumber: clientCode }
 * @returns {Object}  { personCode: { clientCode: { design_hours, qc_hours } } }
 */
function aggregateNetWorkLogHoursByAccount(rows, jobToClientMap) {
  var hoursMap = {};
  jobToClientMap = jobToClientMap || {};

  for (var i = 0; i < (rows || []).length; i++) {
    var row = rows[i];
    if (isMigratedWorkLog(row)) continue;

    var code   = String((row && (row.actor_code || row.person_code)) || '').trim();
    var role   = String((row && row.actor_role) || '').toUpperCase();
    var hours  = parseFloat(row && row.hours);
    var client = jobToClientMap[row && row.job_number] || '(UNKNOWN)';

    if (!code || isNaN(hours) || hours === 0) continue;

    if (!hoursMap[code]) hoursMap[code] = {};
    if (!hoursMap[code][client]) hoursMap[code][client] = { design_hours: 0, qc_hours: 0 };

    if (role === 'QC' || role === 'QC_REVIEWER') {
      hoursMap[code][client].qc_hours += hours;
    } else {
      hoursMap[code][client].design_hours += hours;
    }
  }

  Object.keys(hoursMap).forEach(function (code) {
    Object.keys(hoursMap[code]).forEach(function (client) {
      hoursMap[code][client].design_hours = Math.round(hoursMap[code][client].design_hours * 100) / 100;
      hoursMap[code][client].qc_hours     = Math.round(hoursMap[code][client].qc_hours     * 100) / 100;
    });
  });

  return hoursMap;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/work-log-aggregation.test.js -v`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/06-handlers/WorkLogAggregation.gs tests/work-log-aggregation.test.js
git commit -m "Add aggregateNetWorkLogHoursByAccount() for per-account bonus attribution"
```

---

### Task 5: `PayrollEngine.buildJobToClientMap_()`

**Files:**
- Modify: `src/10-payroll/PayrollEngine.gs` (add new private helper + export for testing)
- Test: `tests/payroll-engine-job-to-client-map.test.js` (new)

**Interfaces:**
- Consumes: `DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, opts)`.
- Produces: `buildJobToClientMap_()` → `{ jobNumber: clientCode }`, exposed on `PayrollEngine`'s public API (same precedent as `buildStaffCache_`) so Task 6's tests and the eventual Task 8 cutover can call it directly. Feeds `aggregateNetWorkLogHoursByAccount`'s second parameter (Task 4).

- [ ] **Step 1: Write the failing tests**

Create `tests/payroll-engine-job-to-client-map.test.js`:

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/payroll-engine-job-to-client-map.test.js -v`
Expected: FAIL — `TypeError: PayrollEngine.buildJobToClientMap_ is not a function`.

- [ ] **Step 3: Implement `buildJobToClientMap_`**

In `src/10-payroll/PayrollEngine.gs`, add immediately after `buildStaffCache_`'s closing brace (before `SECTION 4a`):

```javascript
  // ============================================================
  // SECTION 3b: JOB → CLIENT RESOLUTION
  //
  // Resolves job_number to client_code for account-scoped supervisor
  // bonus attribution (2026-09-08 design spec) — FACT_WORK_LOGS rows
  // carry job_number only, not client_code directly.
  // ============================================================

  /**
   * @returns {Object}  { jobNumber: clientCode }
   */
  function buildJobToClientMap_() {
    var rows;
    try {
      rows = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') return {};
      throw e;
    }

    var map = {};
    for (var i = 0; i < rows.length; i++) {
      var jobNumber = String(rows[i].job_number || '').trim();
      if (!jobNumber) continue;
      map[jobNumber] = String(rows[i].client_code || '').trim();
    }
    return map;
  }
```

- [ ] **Step 4: Add the export**

In `src/10-payroll/PayrollEngine.gs`'s public API return object, immediately after `buildStaffCache_: buildStaffCache_,`:

```javascript
    buildStaffCache_:         buildStaffCache_,
    buildJobToClientMap_:     buildJobToClientMap_,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/payroll-engine-job-to-client-map.test.js -v`
Expected: PASS, both tests.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/10-payroll/PayrollEngine.gs tests/payroll-engine-job-to-client-map.test.js
git commit -m "Add PayrollEngine.buildJobToClientMap_() for account-scoped bonus attribution"
```

---

### Task 6: `PayrollEngine.buildSupervisorBonusMapByAccount_()`

**Files:**
- Modify: `src/10-payroll/PayrollEngine.gs` (add new function + export; does NOT touch `runBonusRun` or `previewPayoutStatement` — that's Task 8, gated separately)
- Test: `tests/payroll-engine-supervisor-bonus-by-account.test.js` (new)

**Interfaces:**
- Consumes: `staffCache` (shape from `buildStaffCache_`, Task 5's `buildJobToClientMap_` output), `hoursMapByAccount` (shape from Task 4's `aggregateNetWorkLogHoursByAccount`), `DAL.readAll(Config.TABLES.REF_ACCOUNT_SUPERVISION, opts)`, `Logger.warn`.
- Produces: `buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, asOfDate)` → `{ bonusMap: { personCode: amountInr }, blockedPairs: [{ client_code, designer_code, hours }] }`. This is the exact shape Task 8's cutover will plug into `runBonusRun`/`previewPayoutStatement` in place of the old `buildSupervisorBonusMap_` call — NOT wired in by this task.

- [ ] **Step 1: Write the failing tests**

Create `tests/payroll-engine-supervisor-bonus-by-account.test.js`:

```javascript
/**
 * payroll-engine-supervisor-bonus-by-account.test.js
 *
 * Tests for PayrollEngine.buildSupervisorBonusMapByAccount_() — the
 * account-scoped rewrite of buildSupervisorBonusMap_ (2026-09-08 design
 * spec §4.4). NOT wired into runBonusRun/previewPayoutStatement by this
 * task — see the design spec §7 for why (cutover requires a real-data
 * backfill of REF_ACCOUNT_SUPERVISION first, a separate later task).
 *
 * Covers all four concrete test cases from the design spec §5:
 *   1. Deb Sen -> Priyanka S, Alberta Truss
 *   2. Bharath, two accounts, two teams
 *   3. An account with no assigned Team Lead, defaulted to the PM (Sarty)
 *      -- role-based skip rule, no double-pay (spec §4.5)
 *   4. A genuinely unassigned pair -- blocked, not silently mis-credited
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
  mocks.Config.TABLES.FACT_PAYROLL_LEDGER     = 'FACT_PAYROLL_LEDGER';
  mocks.Config.TABLES.DIM_FX_RATES            = 'DIM_FX_RATES';
  loadSrc('../src/06-handlers/WorkLogAggregation.gs');
  loadSrc('../src/10-payroll/PayrollEngine.gs');
});

function staff(overrides) {
  return Object.assign({ role: 'DESIGNER' }, overrides);
}

function seedSupervision(rows) {
  mocks.store['REF_ACCOUNT_SUPERVISION'] = rows.map(r => Object.assign({
    effective_from: '2024-01-01', effective_to: ''
  }, r));
}

describe('PayrollEngine.buildSupervisorBonusMapByAccount_()', () => {
  test('Deb Sen -> Priyanka S, Alberta Truss: credits Deb Sen, not Pabitra, for her Alberta Truss hours', () => {
    seedSupervision([
      { client_code: 'ALBERTA TRUSS', designer_code: 'PRS', supervisor_code: 'DBS' }
    ]);
    const staffCache = {
      DBS: staff({ role: 'TEAM_LEAD' }),
      PBG: staff({ role: 'TEAM_LEAD' }),
      PRS: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: { 'ALBERTA TRUSS': { design_hours: 95.25, qc_hours: 0 } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.DBS).toBe(2381.25); // 95.25 x 25
    expect(result.bonusMap.PBG).toBeUndefined();
    expect(result.blockedPairs).toEqual([]);
  });

  test('Bharath, two accounts, two teams: each account\'s hours attribute to the right lead independently', () => {
    seedSupervision([
      { client_code: 'SBS',     designer_code: 'RKG', supervisor_code: 'BCH' },
      { client_code: 'NORSPAN', designer_code: 'ABB', supervisor_code: 'BCH' }
    ]);
    const staffCache = {
      BCH: staff({ role: 'TEAM_LEAD' }),
      RKG: staff({ role: 'DESIGNER' }),
      ABB: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      RKG: { SBS: { design_hours: 10, qc_hours: 0 } },
      ABB: { NORSPAN: { design_hours: 20, qc_hours: 0 } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    // Both accounts' hours (10 + 20 = 30) roll up to the same person, Bharath.
    expect(result.bonusMap.BCH).toBe(750); // 30 x 25
  });

  test('an account defaulted to the PM (no real Team Lead): no double-pay, since PM already gets these hours via buildPmBonusMap_', () => {
    seedSupervision([
      { client_code: 'SOME SMALL ACCOUNT', designer_code: 'BIT', supervisor_code: 'SGO' } // SGO = Sarty, role PM
    ]);
    const staffCache = {
      SGO: staff({ role: 'PM' }),
      BIT: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      BIT: { 'SOME SMALL ACCOUNT': { design_hours: 12, qc_hours: 0 } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    // No TL-bonus entry for Sarty — his role is PM, not TEAM_LEAD. The
    // pair is NOT blocked (an assignment row exists), it just produces no
    // TL-bonus credit, per the role-based skip rule (spec §4.5).
    expect(result.bonusMap.SGO).toBeUndefined();
    expect(result.blockedPairs).toEqual([]);
  });

  test('a genuinely unassigned pair is blocked, not silently mis-credited or dropped', () => {
    seedSupervision([]); // nothing assigned at all
    const staffCache = {
      PRS: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: { 'BRAND NEW ACCOUNT': { design_hours: 8, qc_hours: 0 } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap).toEqual({});
    expect(result.blockedPairs).toEqual([
      { client_code: 'BRAND NEW ACCOUNT', designer_code: 'PRS', hours: 8 }
    ]);
  });

  test('one blocked pair does not affect a different, correctly-assigned pair in the same run', () => {
    seedSupervision([
      { client_code: 'ALBERTA TRUSS', designer_code: 'PRS', supervisor_code: 'DBS' }
    ]);
    const staffCache = {
      DBS: staff({ role: 'TEAM_LEAD' }),
      PRS: staff({ role: 'DESIGNER' }),
      RKG: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: { 'ALBERTA TRUSS': { design_hours: 10, qc_hours: 0 } },
      RKG: { 'UNASSIGNED ACCOUNT': { design_hours: 5, qc_hours: 0 } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.DBS).toBe(250); // PRS's pair still computed normally
    expect(result.blockedPairs).toEqual([
      { client_code: 'UNASSIGNED ACCOUNT', designer_code: 'RKG', hours: 5 }
    ]);
  });

  test('resolves the supervisor as of asOfDate, not today — a later reassignment must not retroactively change a past period\'s attribution', () => {
    seedSupervision([
      { client_code: 'ALBERTA TRUSS', designer_code: 'PRS', supervisor_code: 'PBG', effective_from: '2024-01-01', effective_to: '2026-08-31' },
      { client_code: 'ALBERTA TRUSS', designer_code: 'PRS', supervisor_code: 'DBS', effective_from: '2026-09-01', effective_to: '' }
    ]);
    const staffCache = {
      PBG: staff({ role: 'TEAM_LEAD' }),
      DBS: staff({ role: 'TEAM_LEAD' }),
      PRS: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: { 'ALBERTA TRUSS': { design_hours: 10, qc_hours: 0 } }
    };

    // A payroll run for AUGUST (asOfDate 2026-08-01) must still credit
    // PBG, the lead who was actually assigned during that period.
    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-08-01');

    expect(result.bonusMap.PBG).toBe(250);
    expect(result.bonusMap.DBS).toBeUndefined();
  });

  test('only credits a resolved supervisor whose role is literally TEAM_LEAD — a DESIGNER accidentally assigned as supervisor produces no bonus, not a crash', () => {
    seedSupervision([
      { client_code: 'SBS', designer_code: 'BIT', supervisor_code: 'RKG' } // RKG is a DESIGNER, not a lead
    ]);
    const staffCache = {
      RKG: staff({ role: 'DESIGNER' }),
      BIT: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      BIT: { SBS: { design_hours: 6, qc_hours: 0 } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.RKG).toBeUndefined();
    expect(result.blockedPairs).toEqual([]); // an assignment row DOES exist — not "unassigned"
  });

  test('throws if more than one REF_ACCOUNT_SUPERVISION row resolves as valid for the same pair as of asOfDate (data corruption, e.g. a manual sheet edit bypassing assignAccountSupervisor) — same "refuse to silently pick one" convention as buildStaffCache_', () => {
    seedSupervision([
      { client_code: 'SBS', designer_code: 'BIT', supervisor_code: 'BCH', effective_from: '2024-01-01', effective_to: '' },
      { client_code: 'SBS', designer_code: 'BIT', supervisor_code: 'SDA', effective_from: '2025-01-01', effective_to: '' }
    ]);
    const staffCache = {
      BCH: staff({ role: 'TEAM_LEAD' }),
      SDA: staff({ role: 'TEAM_LEAD' }),
      BIT: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      BIT: { SBS: { design_hours: 6, qc_hours: 0 } }
    };

    expect(() => PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01'))
      .toThrow(/SBS\/BIT/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/payroll-engine-supervisor-bonus-by-account.test.js -v`
Expected: FAIL — `TypeError: PayrollEngine.buildSupervisorBonusMapByAccount_ is not a function`.

- [ ] **Step 3: Implement `buildSupervisorBonusMapByAccount_`**

In `src/10-payroll/PayrollEngine.gs`, add immediately after `buildSupervisorBonusMap_`'s closing brace (before `SECTION 5b`):

```javascript
  // ============================================================
  // SECTION 5a: ACCOUNT-SCOPED SUPERVISOR BONUS (2026-09-08 design spec)
  //
  // Rewrite of buildSupervisorBonusMap_ that attributes each designer's
  // hours to whoever REF_ACCOUNT_SUPERVISION says supervises them on
  // THAT SPECIFIC client account, instead of summing a designer's entire
  // period total and crediting one flat supervisor_code. Built and
  // tested standalone — NOT wired into runBonusRun/previewPayoutStatement
  // until a separate, later cutover task confirms REF_ACCOUNT_SUPERVISION
  // has been backfilled with every active designer's real current
  // account/supervisor pairing (spec §7 — the table starts empty, and
  // this function blocks any pair with no assignment row).
  // ============================================================

  /**
   * @param {Object} staffCache          From buildStaffCache_(asOfDate).
   * @param {Object} hoursMapByAccount   From aggregateNetWorkLogHoursByAccount().
   *                                     { personCode: { clientCode: { design_hours, qc_hours } } }
   * @param {string} asOfDate            'YYYY-MM-DD' — resolves REF_ACCOUNT_SUPERVISION
   *                                     as of this date, same convention as buildStaffCache_.
   * @returns {{ bonusMap: Object, blockedPairs: Array<{client_code, designer_code, hours}> }}
   */
  function buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, asOfDate) {
    var supervisionRows;
    try {
      supervisionRows = DAL.readAll(Config.TABLES.REF_ACCOUNT_SUPERVISION, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') supervisionRows = [];
      else throw e;
    }

    var bonusMap     = {};
    var blockedPairs = [];
    var designerCodes = Object.keys(hoursMapByAccount);

    for (var i = 0; i < designerCodes.length; i++) {
      var designerCode  = designerCodes[i];
      var clientCodes   = Object.keys(hoursMapByAccount[designerCode]);

      for (var j = 0; j < clientCodes.length; j++) {
        var clientCode  = clientCodes[j];
        var pairHours   = hoursMapByAccount[designerCode][clientCode].design_hours;
        if (!pairHours) continue;

        var matchingRows = [];
        for (var k = 0; k < supervisionRows.length; k++) {
          var row = supervisionRows[k];
          if (String(row.client_code).trim() !== clientCode) continue;
          if (String(row.designer_code).trim() !== designerCode) continue;
          var effFrom = toIsoDate_(row.effective_from);
          var effTo   = toIsoDate_(row.effective_to);
          if (effFrom && effFrom > asOfDate) continue;
          if (effTo   && effTo   < asOfDate) continue;
          matchingRows.push(row);
        }

        if (matchingRows.length > 1) {
          throw new Error('PayrollEngine.buildSupervisorBonusMapByAccount_: ' + matchingRows.length +
                           ' REF_ACCOUNT_SUPERVISION rows resolve as valid for ' + clientCode + '/' + designerCode +
                           ' as of ' + asOfDate + ' — refusing to silently pick one (would silently corrupt bonus ' +
                           'attribution). This means assignAccountSupervisor\'s own guards were bypassed somehow ' +
                           '(e.g. a manual sheet edit) — clean up the duplicate rows before retrying.');
        }

        var matchingRow = matchingRows[0];

        if (!matchingRow) {
          Logger.warn('SUPERVISOR_BONUS_UNASSIGNED_PAIR', {
            module: MODULE, client_code: clientCode, designer_code: designerCode, hours: pairHours
          });
          blockedPairs.push({ client_code: clientCode, designer_code: designerCode, hours: pairHours });
          continue;
        }

        var supervisorCode = String(matchingRow.supervisor_code).trim();
        var supervisor      = staffCache[supervisorCode];
        if (!supervisor || supervisor.role !== 'TEAM_LEAD') continue; // role-based PM-skip rule, spec §4.5

        bonusMap[supervisorCode] = Math.round(((bonusMap[supervisorCode] || 0) + pairHours * SUPERVISOR_BONUS_INR) * 100) / 100;
      }
    }

    return { bonusMap: bonusMap, blockedPairs: blockedPairs };
  }
```

- [ ] **Step 4: Add the export**

In `src/10-payroll/PayrollEngine.gs`'s public API return object, immediately after `buildSupervisorBonusMap_: buildSupervisorBonusMap_,`:

```javascript
    buildSupervisorBonusMap_:          buildSupervisorBonusMap_,
    buildSupervisorBonusMapByAccount_: buildSupervisorBonusMapByAccount_,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/payroll-engine-supervisor-bonus-by-account.test.js -v`
Expected: PASS, all 8 tests.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, no regressions. `buildSupervisorBonusMap_` (the old function) is completely untouched — confirm no existing test for it changed behavior.

- [ ] **Step 7: Commit**

```bash
git add src/10-payroll/PayrollEngine.gs tests/payroll-engine-supervisor-bonus-by-account.test.js
git commit -m "Add PayrollEngine.buildSupervisorBonusMapByAccount_() — not yet wired into runBonusRun"
```

---

### Task 7: Code review, merge, and deploy Phase 1's code (not yet live in the bonus run)

**Files:** None new — this task reviews and ships Tasks 1-6's combined diff.

- [ ] **Step 1: Request an independent code review**

Dispatch a `feature-dev:code-reviewer` subagent. Give it: the worktree path, `git diff main` (or the equivalent base commit) covering Tasks 1-6, and this context — "this adds a new REF_ACCOUNT_SUPERVISION table and a new account-scoped bonus calculation function, but does NOT wire it into the live runBonusRun/previewPayoutStatement yet (that's a separate, later task gated on a real-data backfill). Focus review on: the assignAccountSupervisor SCD-2 logic (does it correctly mirror changeSupervisor's guards for its composite key), the buildSupervisorBonusMapByAccount_ role-based PM-skip rule (does it correctly avoid double-paying a PM who's also listed as a fallback supervisor), and the blockedPairs mechanism (does an unassigned pair actually get isolated from other pairs in the same run, not just in the test's specific inputs)."

- [ ] **Step 2: Fix any Critical/Important findings**

Apply fixes with the same TDD discipline (failing test first if the finding describes a behavior gap) before proceeding.

- [ ] **Step 3: Run the full suite one final time**

Run: `npm test`
Expected: PASS, zero failures.

- [ ] **Step 4: Push the worktree branch as a backup, then fast-forward `main`**

```bash
git push origin HEAD:refs/heads/<worktree-branch-name>
git push origin HEAD:main
```

(If this repo's Bash permission classifier blocks these pushes, as it has in past sessions, ask the user to run them via the `!` prefix instead of retrying.)

- [ ] **Step 5: In the primary checkout, pull and verify**

```bash
git status --short          # must be clean
git fetch origin
git log origin/main..HEAD --oneline   # must be empty; if not, reconcile before proceeding (see Task 8's own note on this)
git pull origin main
npm test                    # PASS, zero failures, from the primary checkout
```

- [ ] **Step 6: Run the R5 pre-deploy safety grep**

```bash
grep -rn "whoAmI\|isDev\|rajeshnair\|rajnaircanada\|nairscanada" src/
```

Expected: only legitimate `Config.isDev()` guard usages, no hardcoded real identities.

- [ ] **Step 7: Deploy to PROD**

```bash
npm run push:prod
```

Expected: `Pushed N files` with the full file list, no error.

- [ ] **Step 8: Provision the new sheet in PROD**

In the PROD Apps Script editor, run `runSetupSchemas()` once. This is idempotent (`ensureTab_` only creates missing tabs, never touches existing data) — it will create the new, empty `REF_ACCOUNT_SUPERVISION` tab with the correct headers, and leave every other existing tab untouched.

- [ ] **Step 9: Verify in PROD**

Run a read-only check in the Apps Script editor:

```javascript
function verifyRefAccountSupervisionProvisioned() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('REF_ACCOUNT_SUPERVISION');
  if (!sheet) { console.log('MISSING'); return; }
  console.log('Headers: ' + JSON.stringify(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]));
  console.log('Row count (excluding header): ' + (sheet.getLastRow() - 1));
}
```

Expected: headers match `client_code, designer_code, supervisor_code, effective_from, effective_to, notes`; row count is 0 (freshly provisioned, empty).

No manual "New Version" redeploy is needed — this task touches no `PortalView.html`/`Portal.gs` files.

---

## What comes after this plan (not part of it)

1. **Backfill (human action, no fixed duration).** The user enters every active designer's current, correct `(client_code, supervisor_code)` pairing via `StaffOnboarding.assignAccountSupervisor()`, called directly from the Apps Script editor (no portal UI exists yet) — one call per pairing, matching the pattern already established this session for one-off PROD corrections. This is NOT a task in this plan because it has no fixed engineering duration and depends entirely on the user's own knowledge of current account assignments, not on anything Claude can determine independently.

2. **Cutover verification (a follow-up task, once #1 is confirmed complete).** Run `PayrollEngine.buildSupervisorBonusMapByAccount_()` against real PROD data for the most recent closed period (read-only — call it directly in the Apps Script editor with the real `staffCache`/`hoursMapByAccount`/`asOfDate`, do not write anything) and confirm `blockedPairs` is empty. Only once it's empty should `runBonusRun` and `previewPayoutStatement` in `PayrollEngine.gs` be edited to call `buildSupervisorBonusMapByAccount_` instead of `buildSupervisorBonusMap_` — a small, mechanical two-call-site swap, but one that must not happen before `blockedPairs` is verified empty against real data, per the spec's §7 cutover risk.

3. **Phase 2 (portal panel).** Gets its own spec-to-plan cycle once #1 and #2 are done — `updateStaffRecord`, the `STAFF_PAYOUT_ADMIN` RBAC action, and the portal UI, per spec §6.
