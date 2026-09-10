# Product-Scoped Account Supervision (Phase 1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `REF_ACCOUNT_SUPERVISION` and the account-scoped supervisor
bonus calc so a Team Lead's bonus can be scoped to a specific product line
within an account (e.g. Truss vs I-Joist), not just the whole account,
while whole-account (wildcard) assignments keep working unchanged.

**Architecture:** Add an optional `product_code` column to
`REF_ACCOUNT_SUPERVISION` (blank = wildcard). Thread a product dimension
through the existing three-function pipeline built in Phase 1
(`buildJobToClientMap_` → `aggregateNetWorkLogHoursByAccount` →
`buildSupervisorBonusMapByAccount_`), with a most-specific-row-wins
matching rule when both a wildcard and a product-specific row could
apply. Add a small accepted-exceptions gate so intentionally-unsupervised
product/account combinations (e.g. Sarty's I-Joist coverage via his flat
PM bonus) don't block the eventual cutover. Add the one missing SCD-2
write path this depends on (`StaffOnboarding.changeRole()`).

**Tech Stack:** Google Apps Script (V8), Google Sheets via the DAL layer,
Jest against a GAS-source-eval mock harness (`tests/gas-v3-staff-mocks.js`).

**Spec:** `docs/superpowers/specs/2026-09-10-product-scoped-supervision-design.md`
(Phase 1.5 — extends `docs/superpowers/specs/2026-09-08-payout-supervision-redesign-design.md`,
Phase 1, shipped to PROD 2026-09-09 as
`docs/superpowers/plans/2026-09-08-payout-supervision-redesign-phase1.md`)

## Global Constraints

- RBAC via `RBAC.resolveActor()`/`RBAC.enforcePermission()` — every new
  write-path function's first two statements.
- DAL access only via `getDAL()`/`DAL.*` — never `SpreadsheetApp` directly
  (the one exception is the ONE-TIME schema-patch function in Task 2,
  which mirrors the existing `runPatchBillingLedgerSchema` precedent —
  that class of function is not DAL-mediated in this codebase today).
- TDD mandatory: red-green-refactor, tests in `tests/*.test.js` using the
  existing GAS-source-eval mock harness (`tests/gas-v3-staff-mocks.js`).
- This model's effective date is 2026-08-01 (spec §2) — do not add any
  handling for pre-2026-07-06 blank-`product_code` legacy data; it is out
  of scope by construction.
- `assignAccountSupervisor`'s and `buildSupervisorBonusMapByAccount_`'s
  existing test *scenarios and expected outcomes* must be preserved
  exactly — but their fixture literals and (for the latter) its
  `hoursMapByAccount` input necessarily gain one nesting level for the
  product dimension, since the input/output shape is changing. This is a
  mechanical, required update, not a scope violation — do not skip it and
  do not leave the old 2-level fixtures in place hoping they still pass
  (they will not: the shape genuinely changed).
- No Phase 2 portal UI work, no change to `buildPmBonusMap_`, no
  retroactive blank-`product_code` handling (spec §11) — do not add tasks
  for any of these.
- The actual 15-row PROD backfill (spec §9) and Deb Sen's role change to
  `TEAM_LEAD` are real-world data operations the user runs directly in
  the Apps Script editor **after** this plan's code ships to PROD — they
  are explicitly not implementation tasks in this plan (see Task 8).
- Every commit touching a live financial write path gets an independent
  code-reviewer subagent pass before merge (established practice this
  session).
- Git workflow: worktree-isolated feature branch, fast-forward-only merge
  to `main` via `git push origin HEAD:main`, full test suite green before
  merge, then `npm run push:prod` from the PRIMARY checkout only.

---

## Task 1: `StaffOnboarding.changeRole()`

**Files:**
- Modify: `src/08-staff/StaffOnboarding.gs` (add function after `changePayRate`, ~line 1330; add export after `changePayRate: changePayRate,`, ~line 1454)
- Test: `tests/staff-onboarding-change-role.test.js` (new)

**Interfaces:**
- Consumes: `scd2FieldChange_(personCode, fieldChanges, effectiveDate)` (existing, `StaffOnboarding.gs:1094`) — unchanged, called with `{ role: newRole }`.
- Produces: `StaffOnboarding.changeRole(actorEmail, personCode, newRole, effectiveDate)` → `{ personCode, closedRow, newRowCreated, changed, reason }`. Later tasks do not consume this directly (it's a manual data-operation prerequisite, run by the user, not called from other code in this plan) — but the whole point of Phase 1.5's Deb Sen rows is that they pay nothing until this has been run against her roster row in PROD.

This is a blocking predecessor per spec §8 — do it first, before any `product_code` work.

- [ ] **Step 1: Write the failing tests**

Create `tests/staff-onboarding-change-role.test.js`:

```javascript
/**
 * staff-onboarding-change-role.test.js
 *
 * Tests for StaffOnboarding.changeRole() — the SCD-2-style write path
 * for DIM_STAFF_ROSTER.role changes, same mechanism as changeSupervisor()
 * and changePayRate() (see scd2FieldChange_). Built as the blocking
 * prerequisite for the 2026-09-10 product-scoped-supervision design spec
 * §8 — a supervisor named in REF_ACCOUNT_SUPERVISION earns nothing from
 * buildSupervisorBonusMapByAccount_ until their role is exactly
 * 'TEAM_LEAD' (PayrollEngine.gs's role-based PM-skip rule), so this
 * function is what actually lets that bonus flow.
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

describe('StaffOnboarding.changeRole()', () => {
  test('closes the old row (effective_to = day before effectiveDate) and inserts a new row with the new role', () => {
    seedRoster([{ person_code: 'DBS', name: 'Deb Sen', role: 'QC_REVIEWER' }]);

    StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01');

    const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'DBS');
    expect(rows).toHaveLength(2);

    const oldRow = rows.find(r => r.role === 'QC_REVIEWER');
    const newRow = rows.find(r => r.role === 'TEAM_LEAD');

    expect(oldRow.effective_to).toBe('2026-07-31');
    expect(newRow.effective_from).toBe('2026-08-01');
    expect(newRow.effective_to).toBe('');
  });

  test('the new row copies forward every other field from the old row unchanged', () => {
    seedRoster([{
      person_code: 'DBS', name: 'Deb Sen', email: 'dbs@test.blc.internal',
      role: 'QC_REVIEWER', supervisor_code: 'SGO', pay_currency: 'INR',
      pay_design: 300, pay_qc: 300, bonus_eligible: 'TRUE'
    }]);

    StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01');

    const newRow = mocks.store['DIM_STAFF_ROSTER'].find(r => r.person_code === 'DBS' && r.role === 'TEAM_LEAD');
    expect(newRow.name).toBe('Deb Sen');
    expect(newRow.email).toBe('dbs@test.blc.internal');
    expect(newRow.supervisor_code).toBe('SGO');
    expect(newRow.pay_design).toBe(300);
    expect(newRow.pay_qc).toBe(300);
    expect(newRow.bonus_eligible).toBe('TRUE');
    expect(newRow.active).toBe('TRUE');
  });

  test('idempotent: calling twice with the same (personCode, newRole, effectiveDate) does not create duplicate rows', () => {
    seedRoster([{ person_code: 'DBS', role: 'QC_REVIEWER' }]);

    StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01');
    StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01');

    const rows = mocks.store['DIM_STAFF_ROSTER'].filter(r => r.person_code === 'DBS');
    expect(rows).toHaveLength(2); // still just old (closed) + new — not 3
  });

  test('throws a clear error if newRole is blank', () => {
    seedRoster([{ person_code: 'DBS', role: 'QC_REVIEWER' }]);
    expect(() => StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', '', '2026-08-01'))
      .toThrow(/newRole is required/);
  });

  test('throws a clear error if person_code does not exist', () => {
    seedRoster([{ person_code: 'OTHER', role: 'DESIGNER' }]);
    expect(() => StaffOnboarding.changeRole('ceo@test.blc.internal', 'NOBODY', 'TEAM_LEAD', '2026-08-01'))
      .toThrow(/NOBODY/);
  });

  test('throws a clear error if there is no currently-active (open-ended) row to close for that person', () => {
    seedRoster([{ person_code: 'DBS', role: 'QC_REVIEWER', effective_to: '2026-01-01' }]);
    expect(() => StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01'))
      .toThrow(/no active|open-ended|current/i);
  });

  test('enforces RBAC — calls RBAC.enforcePermission with ADMIN_CONFIG, same tier as changeSupervisor/changePayRate', () => {
    seedRoster([{ person_code: 'DBS', role: 'QC_REVIEWER' }]);
    const spy = jest.spyOn(mocks.RBAC, 'enforcePermission');

    StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01');

    expect(spy).toHaveBeenCalledWith(expect.anything(), 'ADMIN_CONFIG');
  });

  test('refuses to run if the person has MORE THAN ONE open-ended row — refuses to guess which to close', () => {
    seedRoster([
      { person_code: 'DBS', role: 'QC_REVIEWER', effective_from: '2024-01-01', effective_to: '' },
      { person_code: 'DBS', role: 'DESIGNER', effective_from: '2025-01-01', effective_to: '' }
    ]);
    expect(() => StaffOnboarding.changeRole('ceo@test.blc.internal', 'DBS', 'TEAM_LEAD', '2026-08-01'))
      .toThrow(/DBS/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/staff-onboarding-change-role.test.js`
Expected: FAIL — `StaffOnboarding.changeRole is not a function`

- [ ] **Step 3: Implement `changeRole()`**

In `src/08-staff/StaffOnboarding.gs`, insert immediately after the closing brace of `changePayRate` (right before the `/** * Effective-dated assignment...` JSDoc for `assignAccountSupervisor`, currently ~line 1330):

```javascript
  /**
   * Effective-dated role change. Closes the current DIM_STAFF_ROSTER row
   * and inserts a new one, SCD-2 style — same mechanism as
   * changeSupervisor()/changePayRate(). CEO + Admin only.
   *
   * Deliberately does NOT validate newRole against a canonical role
   * list: RBAC.gs's role matrix and DIM_STAFF_ROSTER's stored role
   * strings are not the same alphabet (RBAC aliases QC_REVIEWER -> QC
   * only inside its own permission-matrix lookup, never on the roster
   * value itself — see 2026-09-08 design spec, Discrepancy 1).
   * Cross-checking against RBAC's canonical set here risks rejecting a
   * legitimate roster role due to that exact aliasing mismatch. Callers
   * are responsible for passing a value DIM_STAFF_ROSTER already uses
   * elsewhere (DESIGNER, TEAM_LEAD, QC_REVIEWER, PM, CEO, ADMIN).
   *
   * @param {string} actorEmail
   * @param {string} personCode
   * @param {string} newRole
   * @param {string} effectiveDate  'YYYY-MM-DD'
   * @returns {{ personCode: string, closedRow: boolean, newRowCreated: boolean, changed: boolean, reason: string }}
   */
  function changeRole(actorEmail, personCode, newRole, effectiveDate) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    personCode = String(personCode || '').trim().toUpperCase();
    newRole    = String(newRole || '').trim().toUpperCase();

    if (!newRole) {
      throw new Error('StaffOnboarding.changeRole: newRole is required');
    }

    return scd2FieldChange_(personCode, { role: newRole }, effectiveDate);
  }

```

Then in the `return { ... }` public API block (~line 1454), add right after `changePayRate: changePayRate,`:

```javascript
    /**
     * Effective-dated role change (DIM_STAFF_ROSTER.role). Closes the
     * current row and inserts a new one, SCD-2 style — see
     * changeSupervisor's section comment for the full convention.
     * CEO + Admin only. Idempotent on (person_code, newRole, effectiveDate).
     */
    changeRole: changeRole,

```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/staff-onboarding-change-role.test.js`
Expected: PASS, 8/8

- [ ] **Step 5: Run the full suite to confirm zero regressions**

Run: `npx jest`
Expected: all existing tests still pass, plus the 8 new ones

- [ ] **Step 6: Commit**

```bash
git add src/08-staff/StaffOnboarding.gs tests/staff-onboarding-change-role.test.js
git commit -m "feat: add StaffOnboarding.changeRole() SCD-2 write path"
```

---

## Task 2: `REF_ACCOUNT_SUPERVISION` schema — add `product_code` column

**Files:**
- Modify: `src/setup/SetupScript.gs` (fresh-provision header array, line ~176)
- Modify: `src/08-staff/StaffOnboarding.gs` (new one-time PROD/DEV patch function, top-level, outside the module IIFE, appended at end of file)

**Interfaces:**
- Consumes: nothing new.
- Produces: a `product_code` column on the live `REF_ACCOUNT_SUPERVISION` sheet, positioned last. Task 3's `assignAccountSupervisor` reads/writes this column by name (DAL maps by header, not position — confirmed via `DAL.gs:426-427`), so column order doesn't matter to any consumer.

No Jest test for this task — mirrors the existing, untested-by-design
`runPatchBillingLedgerSchema()` precedent in `src/09-billing/BillingEngine.gs:1114`
(a one-time utility invoked directly from the Apps Script editor, not
covered by the Jest suite since it drives `SpreadsheetApp` directly).
Verification is manual (Step 3 below).

- [ ] **Step 1: Update the fresh-provision schema definition**

In `src/setup/SetupScript.gs`, change:

```javascript
  'REF_ACCOUNT_SUPERVISION': [
    'client_code', 'designer_code', 'supervisor_code',
    'effective_from', 'effective_to', 'notes'
  ],
```

to:

```javascript
  'REF_ACCOUNT_SUPERVISION': [
    'client_code', 'product_code', 'designer_code', 'supervisor_code',
    'effective_from', 'effective_to', 'notes'
  ],
```

- [ ] **Step 2: Add the one-time live-sheet patch function**

Append to the end of `src/08-staff/StaffOnboarding.gs` (after the closing
`}());` of the module IIFE, as a top-level global function — mirrors
`runPatchBillingLedgerSchema`'s placement pattern exactly):

```javascript

/**
 * ONE-TIME: Patches REF_ACCOUNT_SUPERVISION's header row to add a
 * 'product_code' column, needed for the 2026-09-10 product-scoped-
 * supervision design (Phase 1.5).
 *
 * Run this ONCE from the Apps Script editor, in DEV first then PROD,
 * before calling assignAccountSupervisor() with a productCode, or
 * before the 15-row backfill (design spec §9). Safe to re-run — skips
 * if the column already exists.
 */
function runPatchAccountSupervisionSchema() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(Config.TABLES.REF_ACCOUNT_SUPERVISION);
  if (!sheet) {
    console.log('REF_ACCOUNT_SUPERVISION sheet not found — nothing to patch.');
    return;
  }

  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    var newHeader = ['client_code', 'product_code', 'designer_code', 'supervisor_code',
                      'effective_from', 'effective_to', 'notes'];
    sheet.getRange(1, 1, 1, newHeader.length).setValues([newHeader]);
    console.log('SET header on empty sheet: REF_ACCOUNT_SUPERVISION');
    return;
  }

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('product_code') >= 0) {
    console.log('SKIP REF_ACCOUNT_SUPERVISION — already has product_code');
    return;
  }

  sheet.insertColumnAfter(lastCol);
  sheet.getRange(1, lastCol + 1).setValue('product_code');
  console.log('PATCHED REF_ACCOUNT_SUPERVISION — added product_code column');
}
```

- [ ] **Step 3: Manual verification (documented here, executed later at deploy time — Task 8)**

This step does not run now — it runs after Task 8's PROD deploy, in this
order:
1. In the DEV Apps Script editor, run `runPatchAccountSupervisionSchema()`.
2. Confirm the log shows either "SET header" (if DEV's table was empty)
   or "PATCHED" (if it already had the old 6-column header).
3. Open the DEV sheet directly and confirm the header row now reads
   `client_code, designer_code, supervisor_code, effective_from,
   effective_to, notes, product_code` (or the fresh 7-column order if it
   was empty).
4. Run `runPatchAccountSupervisionSchema()` again — confirm it now logs
   "SKIP ... already has product_code" (idempotency check).
5. Repeat steps 1-4 against PROD.

- [ ] **Step 4: Commit**

```bash
git add src/setup/SetupScript.gs src/08-staff/StaffOnboarding.gs
git commit -m "feat: add product_code column to REF_ACCOUNT_SUPERVISION schema"
```

---

## Task 3: `assignAccountSupervisor()` — add `productCode` parameter

**Files:**
- Modify: `src/08-staff/StaffOnboarding.gs` (`assignAccountSupervisor`, ~line 1330-1399)
- Modify: `tests/staff-onboarding-assign-account-supervisor.test.js` (extend `seedSupervision` default + add new tests; existing test bodies are unchanged)

**Interfaces:**
- Consumes: `DAL.readWhere`/`DAL.updateWhere`/`DAL.appendRow` against `Config.TABLES.REF_ACCOUNT_SUPERVISION` (existing).
- Produces: `StaffOnboarding.assignAccountSupervisor(actorEmail, clientCode, designerCode, supervisorCode, effectiveDate, productCode)` — `productCode` optional, defaults to `''`. Return shape gains a `productCode` field: `{ clientCode, designerCode, productCode, closedRow, newRowCreated, changed, reason }`.

- [ ] **Step 1: Write the failing tests**

In `tests/staff-onboarding-assign-account-supervisor.test.js`, first
update the shared fixture helper — change:

```javascript
function seedSupervision(rows) {
  mocks.store['REF_ACCOUNT_SUPERVISION'] = rows.map(r => Object.assign({
    client_code: '', designer_code: '', supervisor_code: '',
    effective_from: '2024-01-01', effective_to: '', notes: ''
  }, r));
}
```

to:

```javascript
function seedSupervision(rows) {
  mocks.store['REF_ACCOUNT_SUPERVISION'] = rows.map(r => Object.assign({
    client_code: '', product_code: '', designer_code: '', supervisor_code: '',
    effective_from: '2024-01-01', effective_to: '', notes: ''
  }, r));
}
```

(This is a fixture-default fix, not a behavior change to any existing
test — every existing test's assertions and expected outcomes are
untouched by it, since none of them assert on `product_code`.)

Then add these new tests at the end of the `describe('StaffOnboarding.assignAccountSupervisor()', ...)` block:

```javascript
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest tests/staff-onboarding-assign-account-supervisor.test.js`
Expected: the 4 new tests FAIL (productCode not yet threaded through);
all pre-existing tests in this file continue to PASS unmodified (the
`seedSupervision` default change does not affect their outcomes).

- [ ] **Step 3: Implement the `productCode` parameter**

In `src/08-staff/StaffOnboarding.gs`, replace the entire `assignAccountSupervisor` function body with:

```javascript
  function assignAccountSupervisor(actorEmail, clientCode, designerCode, supervisorCode, effectiveDate, productCode) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

    clientCode     = String(clientCode || '').trim().toUpperCase();
    designerCode   = String(designerCode || '').trim().toUpperCase();
    supervisorCode = String(supervisorCode || '').trim().toUpperCase();
    effectiveDate  = String(effectiveDate || '').trim();
    productCode    = String(productCode || '').trim().toUpperCase();

    if (!clientCode)     throw new Error('StaffOnboarding.assignAccountSupervisor: clientCode is required');
    if (!designerCode)   throw new Error('StaffOnboarding.assignAccountSupervisor: designerCode is required');
    if (!supervisorCode) throw new Error('StaffOnboarding.assignAccountSupervisor: supervisorCode is required');
    if (!effectiveDate)  throw new Error('StaffOnboarding.assignAccountSupervisor: effectiveDate is required (YYYY-MM-DD)');

    var existing;
    try {
      existing = DAL.readWhere(Config.TABLES.REF_ACCOUNT_SUPERVISION,
        { client_code: clientCode, designer_code: designerCode, product_code: productCode }, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') existing = [];
      else throw e;
    }

    var openRows = (existing || []).filter(function (r) { return !String(r.effective_to || '').trim(); });
    if (openRows.length > 1) {
      throw new Error('StaffOnboarding.assignAccountSupervisor: found ' + openRows.length + ' open-ended rows for ' +
                       clientCode + '/' + productCode + '/' + designerCode + ' — refusing to guess which to close.');
    }

    var currentRow = openRows[0];

    if (currentRow) {
      var currentEffFrom = toIsoDateStr_(currentRow.effective_from);
      if (currentEffFrom === effectiveDate && String(currentRow.supervisor_code).trim().toUpperCase() === supervisorCode) {
        return { clientCode: clientCode, designerCode: designerCode, productCode: productCode, closedRow: false, newRowCreated: false,
                 changed: false, reason: 'already_current' };
      }
      var closedTo = dayBefore_(effectiveDate);
      if (closedTo < currentEffFrom) {
        throw new Error('StaffOnboarding.assignAccountSupervisor: refusing to close the current row for ' +
                         clientCode + '/' + productCode + '/' + designerCode + ' (effective_from="' + currentEffFrom + '") with ' +
                         'effective_to="' + closedTo + '" — that is BEFORE the row\'s own start date, an ' +
                         'inverted/impossible validity window. effectiveDate must be after "' + currentEffFrom + '".');
      }

      var updateResult = DAL.updateWhere(
        Config.TABLES.REF_ACCOUNT_SUPERVISION,
        { client_code: clientCode, designer_code: designerCode, product_code: productCode, effective_to: '' },
        { effective_to: closedTo },
        { callerModule: MODULE }
      );
      var closedCount = (updateResult && typeof updateResult.updated === 'number') ? updateResult.updated : 0;
      if (closedCount !== 1) {
        throw new Error('StaffOnboarding.assignAccountSupervisor: expected the close-row write to affect exactly ' +
                         '1 row for ' + clientCode + '/' + productCode + '/' + designerCode + ' but it reported ' + closedCount + '.');
      }
    }

    DAL.appendRow(Config.TABLES.REF_ACCOUNT_SUPERVISION, {
      client_code:     clientCode,
      product_code:    productCode,
      designer_code:   designerCode,
      supervisor_code: supervisorCode,
      effective_from:  effectiveDate,
      effective_to:    '',
      notes:           ''
    }, { callerModule: MODULE });

    return { clientCode: clientCode, designerCode: designerCode, productCode: productCode, closedRow: !!currentRow, newRowCreated: true,
             changed: true, reason: 'applied' };
  }
```

Also update the JSDoc comment immediately above this function (currently
ending `... Idempotent on (clientCode, designerCode, supervisorCode,
effectiveDate).`) to read `... Idempotent on (clientCode, productCode,
designerCode, supervisorCode, effectiveDate). productCode is optional —
blank means "covers every product on this account" (2026-09-10 design
spec §3/§4).`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/staff-onboarding-assign-account-supervisor.test.js`
Expected: PASS, all tests (pre-existing + 4 new)

- [ ] **Step 5: Run the full suite to confirm zero regressions**

Run: `npx jest`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/08-staff/StaffOnboarding.gs tests/staff-onboarding-assign-account-supervisor.test.js
git commit -m "feat: add optional productCode param to assignAccountSupervisor"
```

---

## Task 4: `aggregateNetWorkLogHoursByAccount()` — add product bucketing

**Files:**
- Modify: `src/06-handlers/WorkLogAggregation.gs` (lines 99-132)
- Modify: `tests/work-log-aggregation.test.js` (the `describe('aggregateNetWorkLogHoursByAccount()', ...)` block only, lines 162-216 — the earlier `describe('aggregateNetWorkLogHours()', ...)` block, lines 31-160, is untouched)

**Interfaces:**
- Consumes: a `jobToClientProductMap` parameter, shape `{ job_number: { client_code, product_code } }` — produced by Task 5's `buildJobToClientProductMap_()`. (Previously `jobToClientMap`, shape `{ job_number: client_code }` — this is a breaking shape change to this function's second parameter.)
- Produces: `hoursMap[actorCode][clientCode][productCode] = { design_hours, qc_hours }` (previously two levels deep: `hoursMap[actorCode][clientCode] = { design_hours, qc_hours }`). Task 6's `buildSupervisorBonusMapByAccount_` consumes this new three-level shape.

- [ ] **Step 1: Write the failing tests**

In `tests/work-log-aggregation.test.js`, replace the entire
`describe('aggregateNetWorkLogHoursByAccount()', ...)` block (lines
162-216) with:

```javascript
describe('aggregateNetWorkLogHoursByAccount()', () => {
  const jobToClientProductMap = {
    'BLC-01001': { client_code: 'ALBERTA TRUSS', product_code: 'ROOF_TRUSS' },
    'BLC-01002': { client_code: 'TITAN TRUSS',   product_code: 'ROOF_TRUSS' },
    'BLC-01003': { client_code: 'SBS',           product_code: 'ROOF_TRUSS' }
  };

  test('sums hours per (actor, client_code, product_code), split design vs QC', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 4, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'QC_REVIEWER', hours: 2, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientProductMap);
    expect(result.PRS['ALBERTA TRUSS']['ROOF_TRUSS'].design_hours).toBe(10);
    expect(result.PRS['ALBERTA TRUSS']['ROOF_TRUSS'].qc_hours).toBe(2);
  });

  test('the same person\'s hours on two different accounts stay in separate buckets', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 3, job_number: 'BLC-01002', event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientProductMap);
    expect(result.PRS['ALBERTA TRUSS']['ROOF_TRUSS'].design_hours).toBe(6);
    expect(result.PRS['TITAN TRUSS']['ROOF_TRUSS'].design_hours).toBe(3);
  });

  test('the same person\'s hours on two different products within the SAME account stay in separate buckets', () => {
    const map = {
      'BLC-01001': { client_code: 'ALBERTA TRUSS', product_code: 'ROOF_TRUSS' },
      'BLC-01004': { client_code: 'ALBERTA TRUSS', product_code: 'FLOOR_JOIST' }
    };
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 3, job_number: 'BLC-01004', event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, map);
    expect(result.PRS['ALBERTA TRUSS']['ROOF_TRUSS'].design_hours).toBe(6);
    expect(result.PRS['ALBERTA TRUSS']['FLOOR_JOIST'].design_hours).toBe(3);
  });

  test('nets a WORK_LOG_VOIDED negative delta against the same (actor, client_code, product_code) bucket', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: -6, job_number: 'BLC-01001', event_type: 'WORK_LOG_VOIDED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientProductMap);
    expect(result.PRS['ALBERTA TRUSS']['ROOF_TRUSS'].design_hours).toBe(0);
  });

  test('excludes migrated rows, same as aggregateNetWorkLogHours', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 6, job_number: 'BLC-01001', event_type: 'WORK_LOG_SUBMITTED' },
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 40, job_number: 'BLC-01001', event_type: 'WORK_LOG_MIGRATED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientProductMap);
    expect(result.PRS['ALBERTA TRUSS']['ROOF_TRUSS'].design_hours).toBe(6);
  });

  test('a row whose job_number has no entry in jobToClientProductMap is bucketed under literal "(UNKNOWN)" for both client and product, not silently dropped', () => {
    const rows = [
      { actor_code: 'PRS', actor_role: 'DESIGNER', hours: 5, job_number: 'BLC-99999', event_type: 'WORK_LOG_SUBMITTED' },
    ];
    const result = aggregateNetWorkLogHoursByAccount(rows, jobToClientProductMap);
    expect(result.PRS['(UNKNOWN)']['(UNKNOWN)'].design_hours).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/work-log-aggregation.test.js`
Expected: FAIL — the 3-level property accesses (e.g.
`result.PRS['ALBERTA TRUSS']['ROOF_TRUSS']`) return `undefined` against
the current 2-level implementation.

- [ ] **Step 3: Implement the product bucketing**

In `src/06-handlers/WorkLogAggregation.gs`, replace lines 99-132
(the entire `aggregateNetWorkLogHoursByAccount` function) with:

```javascript
function aggregateNetWorkLogHoursByAccount(rows, jobToClientProductMap) {
  var hoursMap = {};
  jobToClientProductMap = jobToClientProductMap || {};

  for (var i = 0; i < (rows || []).length; i++) {
    var row = rows[i];
    if (isMigratedWorkLog(row)) continue;

    var code    = String((row && (row.actor_code || row.person_code)) || '').trim();
    var role    = String((row && row.actor_role) || '').toUpperCase();
    var hours   = parseFloat(row && row.hours);
    var mapping = jobToClientProductMap[row && row.job_number] || {};
    var client  = mapping.client_code || '(UNKNOWN)';
    var product = mapping.product_code || '(UNKNOWN)';

    if (!code || isNaN(hours) || hours === 0) continue;

    if (!hoursMap[code]) hoursMap[code] = {};
    if (!hoursMap[code][client]) hoursMap[code][client] = {};
    if (!hoursMap[code][client][product]) hoursMap[code][client][product] = { design_hours: 0, qc_hours: 0 };

    if (role === 'QC' || role === 'QC_REVIEWER') {
      hoursMap[code][client][product].qc_hours += hours;
    } else {
      hoursMap[code][client][product].design_hours += hours;
    }
  }

  Object.keys(hoursMap).forEach(function (code) {
    Object.keys(hoursMap[code]).forEach(function (client) {
      Object.keys(hoursMap[code][client]).forEach(function (product) {
        hoursMap[code][client][product].design_hours = Math.round(hoursMap[code][client][product].design_hours * 100) / 100;
        hoursMap[code][client][product].qc_hours     = Math.round(hoursMap[code][client][product].qc_hours     * 100) / 100;
      });
    });
  });

  return hoursMap;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/work-log-aggregation.test.js`
Expected: PASS, all tests (the untouched `aggregateNetWorkLogHours()`
block plus the rewritten `aggregateNetWorkLogHoursByAccount()` block)

- [ ] **Step 5: Run the full suite to confirm zero regressions**

Run: `npx jest`
Expected: all tests pass EXCEPT `tests/payroll-engine-supervisor-bonus-by-account.test.js`
and `tests/payroll-engine-job-to-client-map.test.js`, which are expected
to fail until Tasks 5 and 6 update them — confirm the failures are
confined to those two files before proceeding.

- [ ] **Step 6: Commit**

```bash
git add src/06-handlers/WorkLogAggregation.gs tests/work-log-aggregation.test.js
git commit -m "feat: bucket aggregateNetWorkLogHoursByAccount by product in addition to client"
```

---

## Task 5: `buildJobToClientMap_()` → `buildJobToClientProductMap_()`

**Files:**
- Modify: `src/10-payroll/PayrollEngine.gs` (function definition ~line 165-181, export ~line 1470)
- Delete: `tests/payroll-engine-job-to-client-map.test.js`
- Create: `tests/payroll-engine-job-to-client-product-map.test.js`

**Interfaces:**
- Consumes: `DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, ...)` (existing) — now also reads `product_code` off each row (already present on `VW_JOB_CURRENT_STATE`, confirmed via `src/12-migration/BlankProductAudit.gs`).
- Produces: `PayrollEngine.buildJobToClientProductMap_()` → `{ job_number: { client_code, product_code } }`. Feeds Task 4's `aggregateNetWorkLogHoursByAccount(rows, jobToClientProductMap)`.

No caller elsewhere in `src/` needs updating — `buildJobToClientMap_` is
only referenced in its own definition, its own export line, and its own
test file (confirmed by repo-wide grep). It is not yet wired into
`runBonusRun`/`previewPayoutStatement` (Phase 1 deliberately left it
unwired — same for this rename).

- [ ] **Step 1: Write the failing tests**

Delete `tests/payroll-engine-job-to-client-map.test.js` and create
`tests/payroll-engine-job-to-client-product-map.test.js`:

```javascript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/payroll-engine-job-to-client-product-map.test.js`
Expected: FAIL — `PayrollEngine.buildJobToClientProductMap_ is not a function`

- [ ] **Step 3: Implement the rename and shape change**

In `src/10-payroll/PayrollEngine.gs`, replace the `buildJobToClientMap_`
function (lines 165-181) with:

```javascript
  function buildJobToClientProductMap_() {
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
      map[jobNumber] = {
        client_code:  String(rows[i].client_code  || '').trim(),
        product_code: String(rows[i].product_code || '').trim()
      };
    }
    return map;
  }
```

Then in the public API export block, change:

```javascript
    buildJobToClientMap_:     buildJobToClientMap_,
```

to:

```javascript
    buildJobToClientProductMap_: buildJobToClientProductMap_,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/payroll-engine-job-to-client-product-map.test.js`
Expected: PASS, 3/3

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: all tests pass EXCEPT `tests/payroll-engine-supervisor-bonus-by-account.test.js`,
which Task 6 fixes next.

- [ ] **Step 6: Commit**

```bash
git add src/10-payroll/PayrollEngine.gs tests/payroll-engine-job-to-client-product-map.test.js
git rm tests/payroll-engine-job-to-client-map.test.js
git commit -m "feat: rename buildJobToClientMap_ to buildJobToClientProductMap_, add product_code"
```

---

## Task 6: `buildSupervisorBonusMapByAccount_()` — wildcard/specific precedence matching

**Files:**
- Modify: `src/10-payroll/PayrollEngine.gs` (function ~line 388-477)
- Modify: `tests/payroll-engine-supervisor-bonus-by-account.test.js` (full rewrite of fixtures per Global Constraints; scenarios/assertions preserved, 3 new tests added)

**Interfaces:**
- Consumes: `hoursMapByAccount` in the new 3-level shape from Task 4 (`{ designerCode: { clientCode: { productCode: { design_hours, qc_hours } } } }`); `REF_ACCOUNT_SUPERVISION` rows now carrying `product_code` from Task 3.
- Produces: same `{ bonusMap, blockedPairs }` shape, but each `blockedPairs` entry now also carries `product_code`. Task 7's exceptions filter consumes this `blockedPairs` array shape.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/payroll-engine-supervisor-bonus-by-account.test.js` with:

```javascript
/**
 * payroll-engine-supervisor-bonus-by-account.test.js
 *
 * Tests for PayrollEngine.buildSupervisorBonusMapByAccount_() — the
 * product-scoped rewrite (2026-09-10 design spec §5) of the account-
 * scoped calc (2026-09-08 design spec §4.4). NOT wired into
 * runBonusRun/previewPayoutStatement by this task — see the 2026-09-08
 * design spec §7 and the 2026-09-10 spec §11 for why.
 *
 * hoursMapByAccount is now three levels deep:
 * { designerCode: { clientCode: { productCode: { design_hours, qc_hours } } } }
 * (previously two levels — see 2026-09-08 design spec's version of this
 * file for the pre-product-scoping shape).
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
    product_code: '', effective_from: '2024-01-01', effective_to: ''
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
      PRS: { 'ALBERTA TRUSS': { 'ROOF_TRUSS': { design_hours: 95.25, qc_hours: 0 } } }
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
      RKG: { SBS: { 'ROOF_TRUSS': { design_hours: 10, qc_hours: 0 } } },
      ABB: { NORSPAN: { 'ROOF_TRUSS': { design_hours: 20, qc_hours: 0 } } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

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
      BIT: { 'SOME SMALL ACCOUNT': { 'ROOF_TRUSS': { design_hours: 12, qc_hours: 0 } } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.SGO).toBeUndefined();
    expect(result.blockedPairs).toEqual([]);
  });

  test('a genuinely unassigned pair is blocked, not silently mis-credited or dropped', () => {
    seedSupervision([]);
    const staffCache = {
      PRS: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: { 'BRAND NEW ACCOUNT': { 'ROOF_TRUSS': { design_hours: 8, qc_hours: 0 } } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap).toEqual({});
    expect(result.blockedPairs).toEqual([
      { client_code: 'BRAND NEW ACCOUNT', product_code: 'ROOF_TRUSS', designer_code: 'PRS', hours: 8 }
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
      PRS: { 'ALBERTA TRUSS': { 'ROOF_TRUSS': { design_hours: 10, qc_hours: 0 } } },
      RKG: { 'UNASSIGNED ACCOUNT': { 'ROOF_TRUSS': { design_hours: 5, qc_hours: 0 } } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.DBS).toBe(250);
    expect(result.blockedPairs).toEqual([
      { client_code: 'UNASSIGNED ACCOUNT', product_code: 'ROOF_TRUSS', designer_code: 'RKG', hours: 5 }
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
      PRS: { 'ALBERTA TRUSS': { 'ROOF_TRUSS': { design_hours: 10, qc_hours: 0 } } }
    };

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
      BIT: { SBS: { 'ROOF_TRUSS': { design_hours: 6, qc_hours: 0 } } }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.RKG).toBeUndefined();
    expect(result.blockedPairs).toEqual([]); // an assignment row DOES exist — not "unassigned"
  });

  test('throws if more than one REF_ACCOUNT_SUPERVISION row resolves as valid for the same (client, product, designer) as of asOfDate (data corruption, e.g. a manual sheet edit bypassing assignAccountSupervisor)', () => {
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
      BIT: { SBS: { 'ROOF_TRUSS': { design_hours: 6, qc_hours: 0 } } }
    };

    expect(() => PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01'))
      .toThrow(/SBS\/ROOF_TRUSS\/BIT/);
  });

  test('a supervisor_code in REF_ACCOUNT_SUPERVISION not found in staffCache (e.g. typo or inactive person) is logged as SUPERVISOR_BONUS_UNRESOLVED_SUPERVISOR and blocked, not silently skipped with no visibility', () => {
    seedSupervision([
      { client_code: 'ACME CORP', designer_code: 'PRS', supervisor_code: 'NONEXISTENT' }
    ]);
    const staffCache = {
      PRS: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: { 'ACME CORP': { 'ROOF_TRUSS': { design_hours: 20, qc_hours: 0 } } }
    };

    const logWarns = [];
    mocks.Logger.warn = (eventName, payload) => {
      logWarns.push({ eventName, payload });
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(logWarns.length).toBe(1);
    expect(logWarns[0].eventName).toBe('SUPERVISOR_BONUS_UNRESOLVED_SUPERVISOR');
    expect(logWarns[0].payload.supervisor_code).toBe('NONEXISTENT');
    expect(logWarns[0].payload.client_code).toBe('ACME CORP');
    expect(logWarns[0].payload.product_code).toBe('ROOF_TRUSS');
    expect(logWarns[0].payload.designer_code).toBe('PRS');
    expect(logWarns[0].payload.hours).toBe(20);

    expect(result.blockedPairs).toEqual([
      { client_code: 'ACME CORP', product_code: 'ROOF_TRUSS', designer_code: 'PRS', hours: 20 }
    ]);

    expect(result.bonusMap.NONEXISTENT).toBeUndefined();
  });

  test('a supervisor with only very-small-hours pairs that round to zero is filtered out (no non-positive entries in bonusMap)', () => {
    seedSupervision([
      { client_code: 'TINY ACCOUNT 1', designer_code: 'PRS', supervisor_code: 'DBS' },
      { client_code: 'TINY ACCOUNT 2', designer_code: 'PRS', supervisor_code: 'DBS' }
    ]);
    const staffCache = {
      DBS: staff({ role: 'TEAM_LEAD' }),
      PRS: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      PRS: {
        'TINY ACCOUNT 1': { 'ROOF_TRUSS': { design_hours: 0.00001, qc_hours: 0 } },
        'TINY ACCOUNT 2': { 'ROOF_TRUSS': { design_hours: 0.00001, qc_hours: 0 } }
      }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.DBS).toBeUndefined();
    expect(result.blockedPairs).toEqual([]);
  });

  test('a product-specific supervision row matches only that exact product, leaving other products on the same account unmatched', () => {
    seedSupervision([
      { client_code: 'NELSON', product_code: 'ROOF_TRUSS', designer_code: 'AR001', supervisor_code: 'DBS' }
    ]);
    const staffCache = {
      DBS: staff({ role: 'TEAM_LEAD' }),
      AR001: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      AR001: {
        NELSON: {
          'ROOF_TRUSS':  { design_hours: 10, qc_hours: 0 },
          'FLOOR_JOIST': { design_hours: 4,  qc_hours: 0 }
        }
      }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.DBS).toBe(250); // 10 x 25, ROOF_TRUSS only
    expect(result.blockedPairs).toEqual([
      { client_code: 'NELSON', product_code: 'FLOOR_JOIST', designer_code: 'AR001', hours: 4 }
    ]);
  });

  test('when both a wildcard row and a product-specific row match, the specific row wins for that product — the wildcard still covers the other products', () => {
    seedSupervision([
      { client_code: 'NORSPAN-MB', product_code: '',           designer_code: 'VKV', supervisor_code: 'BCH' },
      { client_code: 'NORSPAN-MB', product_code: 'FLOOR_JOIST', designer_code: 'VKV', supervisor_code: 'SDA' }
    ]);
    const staffCache = {
      BCH: staff({ role: 'TEAM_LEAD' }),
      SDA: staff({ role: 'TEAM_LEAD' }),
      VKV: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      VKV: {
        'NORSPAN-MB': {
          'ROOF_TRUSS':  { design_hours: 10, qc_hours: 0 },
          'FLOOR_JOIST': { design_hours: 6,  qc_hours: 0 }
        }
      }
    };

    const result = PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01');

    expect(result.bonusMap.BCH).toBe(250); // 10 x 25, ROOF_TRUSS via the wildcard
    expect(result.bonusMap.SDA).toBe(150); // 6 x 25, FLOOR_JOIST via the specific row
    expect(result.blockedPairs).toEqual([]);
  });

  test('throws if two product-specific rows resolve for the same exact product (not just the same client+designer)', () => {
    seedSupervision([
      { client_code: 'NELSON', product_code: 'ROOF_TRUSS', designer_code: 'AR001', supervisor_code: 'DBS', effective_from: '2024-01-01', effective_to: '' },
      { client_code: 'NELSON', product_code: 'ROOF_TRUSS', designer_code: 'AR001', supervisor_code: 'SGO', effective_from: '2025-01-01', effective_to: '' }
    ]);
    const staffCache = {
      DBS: staff({ role: 'TEAM_LEAD' }),
      SGO: staff({ role: 'PM' }),
      AR001: staff({ role: 'DESIGNER' })
    };
    const hoursMapByAccount = {
      AR001: { NELSON: { 'ROOF_TRUSS': { design_hours: 5, qc_hours: 0 } } }
    };

    expect(() => PayrollEngine.buildSupervisorBonusMapByAccount_(staffCache, hoursMapByAccount, '2026-09-01'))
      .toThrow(/NELSON\/ROOF_TRUSS\/AR001/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/payroll-engine-supervisor-bonus-by-account.test.js`
Expected: FAIL across most tests — the current implementation reads
`hoursMapByAccount[designerCode][clientCode].design_hours` directly
(a 2-level access), which is `undefined` against the new 3-level fixtures.

- [ ] **Step 3: Implement the three-tier matching**

In `src/10-payroll/PayrollEngine.gs`, replace the entire
`buildSupervisorBonusMapByAccount_` function (lines 388-477) with:

```javascript
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
        var clientCode   = clientCodes[j];
        var productCodes = Object.keys(hoursMapByAccount[designerCode][clientCode]);

        for (var p = 0; p < productCodes.length; p++) {
          var productCode = productCodes[p];
          var pairHours   = hoursMapByAccount[designerCode][clientCode][productCode].design_hours;
          if (!pairHours) continue;

          var candidateRows = [];
          for (var k = 0; k < supervisionRows.length; k++) {
            var row = supervisionRows[k];
            if (String(row.client_code).trim() !== clientCode) continue;
            if (String(row.designer_code).trim() !== designerCode) continue;
            var rowProduct = String(row.product_code || '').trim();
            if (rowProduct !== '' && rowProduct !== productCode) continue;
            var effFrom = toIsoDate_(row.effective_from);
            var effTo   = toIsoDate_(row.effective_to);
            if (effFrom && effFrom > asOfDate) continue;
            if (effTo   && effTo   < asOfDate) continue;
            candidateRows.push(row);
          }

          // Most-specific-wins: an exact-product row beats a wildcard row
          // for this bucket. Only fall back to wildcards when no exact
          // match exists. (2026-09-10 design spec §5, step 2.)
          var exactRows = candidateRows.filter(function (r) { return String(r.product_code || '').trim() === productCode; });
          var matchingRows = exactRows.length > 0
            ? exactRows
            : candidateRows.filter(function (r) { return String(r.product_code || '').trim() === ''; });

          if (matchingRows.length > 1) {
            throw new Error('PayrollEngine.buildSupervisorBonusMapByAccount_: ' + matchingRows.length +
                             ' REF_ACCOUNT_SUPERVISION rows resolve as valid for ' + clientCode + '/' + productCode + '/' + designerCode +
                             ' as of ' + asOfDate + ' — refusing to silently pick one (would silently corrupt bonus ' +
                             'attribution). This means assignAccountSupervisor\'s own guards were bypassed somehow ' +
                             '(e.g. a manual sheet edit) — clean up the duplicate rows before retrying.');
          }

          var matchingRow = matchingRows[0];

          if (!matchingRow) {
            Logger.warn('SUPERVISOR_BONUS_UNASSIGNED_PAIR', {
              module: MODULE, client_code: clientCode, product_code: productCode, designer_code: designerCode, hours: pairHours
            });
            blockedPairs.push({ client_code: clientCode, product_code: productCode, designer_code: designerCode, hours: pairHours });
            continue;
          }

          var supervisorCode = String(matchingRow.supervisor_code).trim();
          var supervisor      = staffCache[supervisorCode];

          // Case 1: supervisor_code not found in staffCache (typo, inactive, etc.) — log and block
          if (!supervisor) {
            Logger.warn('SUPERVISOR_BONUS_UNRESOLVED_SUPERVISOR', {
              module: MODULE, supervisor_code: supervisorCode, client_code: clientCode,
              product_code: productCode, designer_code: designerCode, hours: pairHours
            });
            blockedPairs.push({ client_code: clientCode, product_code: productCode, designer_code: designerCode, hours: pairHours });
            continue;
          }

          // Case 2: supervisor found but wrong role (e.g., PM) — skip silently, no logging, no blocking
          if (supervisor.role !== 'TEAM_LEAD') continue; // role-based PM-skip rule, spec §4.5

          bonusMap[supervisorCode] = Math.round(((bonusMap[supervisorCode] || 0) + pairHours * SUPERVISOR_BONUS_INR) * 100) / 100;
        }
      }
    }

    // Final defensive filter: ensure no bonusMap entry has a non-positive value.
    var finalBonusMap = {};
    var bonusKeys = Object.keys(bonusMap);
    for (var m = 0; m < bonusKeys.length; m++) {
      var code = bonusKeys[m];
      if (bonusMap[code] > 0) {
        finalBonusMap[code] = bonusMap[code];
      }
    }

    return { bonusMap: finalBonusMap, blockedPairs: blockedPairs };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/payroll-engine-supervisor-bonus-by-account.test.js`
Expected: PASS, all 13 tests

- [ ] **Step 5: Run the full suite to confirm zero regressions**

Run: `npx jest`
Expected: all tests pass (this closes out the last two files that were
expected-red from Tasks 4 and 5's steps)

- [ ] **Step 6: Commit**

```bash
git add src/10-payroll/PayrollEngine.gs tests/payroll-engine-supervisor-bonus-by-account.test.js
git commit -m "feat: product-scoped matching (specific-wins-over-wildcard) in buildSupervisorBonusMapByAccount_"
```

---

## Task 7: Accepted-exceptions gate for the pre-cutover `blockedPairs` check

**Files:**
- Modify: `src/10-payroll/PayrollEngine.gs` (new constant + function, placed after `buildSupervisorBonusMapByAccount_`, before the `SECTION 5b: PM BONUS CALCULATION` comment block, ~line 479)
- Test: `tests/payroll-engine-blocked-pair-exceptions.test.js` (new)

**Interfaces:**
- Consumes: `blockedPairs` array from Task 6's `buildSupervisorBonusMapByAccount_` (`{ client_code, product_code, designer_code, hours }[]`).
- Produces: `PayrollEngine.filterUnexpectedBlockedPairs_(blockedPairs)` → the subset of `blockedPairs` NOT covered by an accepted exception. The pre-cutover gate (run manually by whoever executes the eventual cutover, not wired into any automated pipeline by this plan) is: this returns `[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/payroll-engine-blocked-pair-exceptions.test.js`:

```javascript
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/payroll-engine-blocked-pair-exceptions.test.js`
Expected: FAIL — `PayrollEngine.filterUnexpectedBlockedPairs_ is not a function`

- [ ] **Step 3: Implement the exceptions list and filter**

In `src/10-payroll/PayrollEngine.gs`, insert immediately after the
closing brace of `buildSupervisorBonusMapByAccount_` (before the
`// SECTION 5b: PM BONUS CALCULATION` comment block):

```javascript

  // ============================================================
  // SECTION 5c: PRE-CUTOVER ACCEPTED-EXCEPTIONS GATE
  //
  // Some blocked pairs are permanent by design under product-scoped
  // supervision — e.g. a designer's I-Joist hours on an account whose
  // I-Joist work is intentionally outside TEAM_LEAD-tier supervision
  // (already covered by a different bonus mechanism, e.g. Sarty's flat
  // company-wide PM bonus). The pre-cutover gate must not require these
  // to disappear — it requires every remaining blocked pair to be on
  // this explicit, reviewed list. (2026-09-10 design spec §6.)
  //
  // A hardcoded code constant, not a table, deliberately — user's
  // explicit choice given how few of these exist today. Update this
  // list (and get it reviewed like any other code change) whenever a
  // new intentional exception is identified.
  // ============================================================

  var ACCEPTED_UNSUPERVISED_PAIRS_ = [
    // Deb Sen's Truss-only scope on Alberta Truss/Nelson leaves I-Joist
    // there intentionally unsupervised at the TEAM_LEAD tier — Sarty's
    // flat, company-wide PM bonus already covers it (buildPmBonusMap_).
    { client_code: 'ALBERTA TRUSS', product_code: 'FLOOR_JOIST', designer_code: 'PRS' },
    { client_code: 'NELSON',        product_code: 'FLOOR_JOIST', designer_code: 'AR001' }
  ];

  /**
   * Filters blockedPairs (from buildSupervisorBonusMapByAccount_) down
   * to only the ones NOT on the accepted-exceptions list above. The
   * pre-cutover gate is: this returns an empty array.
   *
   * @param {Array<{client_code, product_code, designer_code, hours}>} blockedPairs
   * @returns {Array} the subset not covered by an accepted exception
   */
  function filterUnexpectedBlockedPairs_(blockedPairs) {
    return (blockedPairs || []).filter(function (pair) {
      return !ACCEPTED_UNSUPERVISED_PAIRS_.some(function (accepted) {
        return accepted.client_code === pair.client_code &&
               accepted.product_code === pair.product_code &&
               accepted.designer_code === pair.designer_code;
      });
    });
  }

```

Then add to the public API export block, after `buildSupervisorBonusMapByAccount_: buildSupervisorBonusMapByAccount_,`:

```javascript
    filterUnexpectedBlockedPairs_: filterUnexpectedBlockedPairs_,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/payroll-engine-blocked-pair-exceptions.test.js`
Expected: PASS, 5/5

- [ ] **Step 5: Run the full suite to confirm zero regressions**

Run: `npx jest`
Expected: all tests pass, full suite green

- [ ] **Step 6: Commit**

```bash
git add src/10-payroll/PayrollEngine.gs tests/payroll-engine-blocked-pair-exceptions.test.js
git commit -m "feat: add accepted-exceptions gate for permanently-expected blocked pairs"
```

---

## Task 8: Final review, merge, deploy — then the deliberately-separate next step

**Files:** none (review/merge/deploy only)

- [ ] **Step 1: Run the complete test suite one final time**

Run: `npx jest`
Expected: 100% pass, zero skipped, zero failures (RULE Y / T5)

- [ ] **Step 2: Request an independent code-reviewer subagent pass**

Per this session's established practice for any commit touching a live
financial write path, dispatch a code-reviewer subagent (see
`superpowers:requesting-code-review`) covering the full branch diff
against `main`. Give it: this plan's file, the spec
(`docs/superpowers/specs/2026-09-10-product-scoped-supervision-design.md`),
and the base/head SHAs. Fix any Critical/Important findings before
proceeding; do not skip this because "it's just a bonus calc."

- [ ] **Step 3: Merge to main**

```bash
git push origin HEAD:main
```

(Worktree sessions cannot merge into the primary checkout directly —
fast-forward push only, per this repo's established workflow.)

- [ ] **Step 4: Deploy to PROD from the PRIMARY checkout**

From the primary checkout (never a worktree):
```bash
git pull origin main
npm run push:prod
```

- [ ] **Step 5: Run the schema patch in DEV, then PROD (Task 2, Step 3)**

Execute the manual verification steps documented in Task 2 — run
`runPatchAccountSupervisionSchema()` in the DEV Apps Script editor first,
confirm the header, then repeat against PROD.

- [ ] **Step 6: Stop here — the following are deliberately NOT part of this plan**

This plan ships the engineering (schema, functions, tests). It
deliberately stops before:

- Running `StaffOnboarding.changeRole('<ceo-email>', 'DBS', 'TEAM_LEAD', '2026-08-01')` against PROD — a real HR/org-chart change the user makes, not an automated step.
- Running the 15-row `assignAccountSupervisor()` backfill from spec §9 against PROD.
- Reviewing `buildSupervisorBonusMapByAccount_`'s `blockedPairs` output (through `filterUnexpectedBlockedPairs_`) against real August 2026 data to confirm the gate is clean.
- Wiring `buildSupervisorBonusMapByAccount_`/`buildJobToClientProductMap_`/`aggregateNetWorkLogHoursByAccount` into `runBonusRun`/`previewPayoutStatement` — the actual cutover, which only happens once the gate above is clean.

These are real-world data operations and a business decision (the
cutover), not implementation tasks — same separation Phase 1 used. Tell
the user this plan is code-complete and these four items are the
deliberately-separate next step once it's deployed.
