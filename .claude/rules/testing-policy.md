# Rules: Testing Policy (R10 detail)

This file is the operational companion to `testing.md` (T1–T5) and `CLAUDE.md` R10.
T1–T5 say what a good test looks like; this file says how to keep every test
suite from ever touching real PROD data or identities again. Background: on
2026-07-08, hardcoded real identities in `TestHarness.gs`/`TestRunner.gs`
(`sarthakaespl@gmail.com`, `designer@blclotus.com`, `qc@blclotus.com`,
client_code `NORSPAN`) were found creating real jobs/staff rows in PROD every
time a test ran there — this file exists to make sure that class of bug can't
recur silently.

---

## 1. Test data conventions

Use these values, and only these, in any test fixture:

| Purpose            | Value                                  |
|---------------------|-----------------------------------------|
| Client code         | `TEST-CLIENT`                          |
| CEO test actor      | `test-ceo@test.blc.internal`           |
| PM test actor       | `test-pm@test.blc.internal`            |
| Designer test actor | `test-designer@test.blc.internal`      |
| QC test actor       | `test-qc@test.blc.internal`            |
| Job number (manual) | `BLC-99999` (or any number in a clearly out-of-range block reserved for tests) |
| Person codes        | `DS1`, `QC1` — reserved, DEV-only synthetic actors, registered in `RBAC.gs` `getDevTestActors_()` |

All of the above resolve **only** via `getDevTestActors_()` in `RBAC.gs`, which
returns `{}` when `Config.isDev()` is false. That is the actual safety
backstop — even if a guard is missing somewhere, these identities cannot
resolve to a valid actor in PROD, so any write attempt fails RBAC before it
reaches DAL.

## 2. Prohibited patterns

Never appear in a test fixture, in any file under `src/setup/` or any
`*Test.gs`/`*Tests.gs` file:

- Any real staff email (anything in `DIM_STAFF_ROSTER`'s real seed data —
  `SeedStaffImport.gs`, `SetupScript.gs` — or any `@blclotus.com`,
  `@gmail.com` address belonging to an actual person)
- Any real client_code (anything in `DIM_CLIENT_MASTER`'s real seed data —
  e.g. `NORSPAN-MB`, `MATIX-SK`, `SBS`, `TITAN`)
- A bare client_code that could collide with a real one even by
  approximation (this is exactly how `'NORSPAN'` — missing the `-MB` suffix
  — became a live incident)
- A raw string literal duplicating a constant's value instead of referencing
  the constant (this is how the `qc@blclotus.com` literal in
  `TestRunner.gs:886` survived a constant rename undetected until reviewed)

Before adding a new test fixture, grep for it:
```
grep -rn "<the value you're about to hardcode>" src/
```
If it already appears in `SetupScript.gs`, `SeedStaffImport.gs`, or any
`DIM_CLIENT_MASTER`/`DIM_STAFF_ROSTER` seed data, it is real — do not reuse it.

## 3. Test runner requirements

Every function that is a **test runner** (an aggregator that a human or
trigger can invoke directly — `run*Tests()`, `runAllTests*()`, `testSopAll()`,
batch runners like `runSopGateTests_batchN()`) or a **shared setup helper**
that performs a write (`thSetupAllocatedJob_()`, `seedTestStaff()`,
`setupTestJobInProgress_()`, and anything like them) must:

1. Start with:
   ```javascript
   if (!Config.isDev()) {
     throw new Error('Test suite cannot run in PROD. Switch to DEV environment.');
   }
   ```
   This is non-negotiable per R10.4 — add it before writing any other new
   test code, not after.

2. Use only the synthetic identities/values from Section 1 — never inline a
   real-looking string, always reference a shared constant (`TH_*_EMAIL`,
   `TH_CLIENT_CODE`, etc.) so a future rename propagates everywhere.

3. Call the cleanup helper before returning, so leftover artifacts from a
   crashed run don't accumulate in DEV:
   ```javascript
   thCleanupTestArtifacts_();
   ```
   (`TestHarness.gs`) — self-healing: it scans for `client_code='TEST-CLIENT'`
   and voids matches, so it also catches leftovers from any prior run, not
   just the current one.

**Guard both the aggregator and the shared helper.** Guarding only
`runJobCreateTests()` does not protect someone from running
`testJobCreateHandler_happyPath()` directly from the Apps Script editor's
function picker — but if the shared setup helper it calls
(`thSetupAllocatedJob_()`) is also guarded, that path is closed regardless of
which function was invoked directly.

## 4. PROD verification procedures

**Never run a test suite against PROD to verify a PROD deploy.** Per R10.6,
verification after `npm run push:prod` means:

- Run `runHealthCheck()` / confirm the 15-minute `runHealthMonitorJob()`
  trigger shows no new alerts
- Run `runProdContaminationCheck()` manually once, immediately after the
  deploy, as an extra check beyond its daily 03:00 schedule
  (`src/09-notifications/ExecutionHealthMonitor.gs`)
- Check the portal loads and a real (non-test) job round-trips correctly
- If the deploy touched `PortalView.html`/`Portal.gs`, confirm the New
  Version redeploy happened (R4.7)

If `runProdContaminationCheck()` reports `contaminated: true` at any point,
treat it as R10.8 — stop all other work until the source is found and closed,
matching R9's stop-work conditions.

## 5. Adding a new test suite — template

```javascript
/**
 * @returns {{ passed: number, failed: number }}
 */
function runYourNewTests() {
  if (!Config.isDev()) {
    throw new Error('Test suite cannot run in PROD. Switch to DEV environment.');
  }

  seedTestStaff();   // only if the suite needs DIM_STAFF_ROSTER rows (DS1/QC1)

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testYourModule_happyPath,
    testYourModule_rbacDenial,
    testYourModule_invalidPayload,
    testYourModule_duplicate
    // T1: every handler needs happy path + RBAC denial + invalid input + duplicate submission
  ];

  for (var i = 0; i < tests.length; i++) {
    var c = tests[i]();
    suiteCounters.passed += c.passed;
    suiteCounters.failed += c.failed;
  }

  thCleanupTestArtifacts_();
  return suiteCounters;
}
```

Register the new runner in `TestHarness.gs`'s `runV3HandlerTests()` suite
list if it belongs to the V3 handler test set, so it runs as part of the
full aggregate too.

Before committing a new test file: run the R10.7 grep sweep —
```
grep -rn "sarthakaespl@gmail\.com\|designer@blclotus\.com\|qc@blclotus\.com\|'NORSPAN'" src/setup/ <your new file>
```
— and confirm it's clean.
