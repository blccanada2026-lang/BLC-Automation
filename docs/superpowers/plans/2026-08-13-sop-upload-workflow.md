# SOP Upload Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the CEO upload a source SOP document (designer checklist or
QC-review checklist) via the portal for any client/product, have it
structured by a Claude session into the existing SOP template engine as a
draft, get reviewed by managers via a shareable no-login link, and be
explicitly published by the CEO before it goes live.

**Architecture:** A new engine (`SopUploadEngine.gs`) owns the upload
lifecycle (`DIM_SOP_UPLOADS`) and manager feedback
(`FACT_SOP_REVIEW_FEEDBACK`), reusing the existing `SopAdminEngine`
untouched for actual template creation/publishing. Two new external-facing
surfaces follow established patterns exactly: the manager-review link
reuses the quarterly-ratings HMAC-token-before-actor-resolution pattern
(no portal login), and the review page is a new `doGet` branch alongside
the existing `page=rate-staff` one.

**Tech Stack:** Google Apps Script (V8), existing DAL/RBAC/Logger
infrastructure, Google Drive (`DriveApp`) for file storage — OAuth scope
already present in `appsscript.json`.

## Global Constraints

- Every new table needs: a `SCHEMAS` entry in `SetupScript.gs`; correct
  list membership (`FACT_SOP_REVIEW_FEEDBACK` → `FLAT_FACT_TABLE_NAMES`,
  same as `FACT_CLIENT_FEEDBACK` — low-volume, not partitioned;
  `DIM_SOP_UPLOADS` → no list, created generically as a non-FACT table);
  `WRITE_PERMISSIONS` entries; and **actual tab creation in the DEV
  spreadsheet is a deploy prerequisite** — run `runSetupSchemas()` in the
  DEV Apps Script editor after this plan's first push, before running any
  test that writes to these tables. (This exact class of gap — a table
  declared in code but never actually created as a sheet tab — caused two
  real live-DEV bugs on the immediately-prior QC-findings-picker feature;
  see `SESSION_LOG.md`'s 2026-08-12 entry.)
- No `TRUE`/`FALSE`-valued columns anywhere in this work. Every flag in
  this plan's schemas is either a free-text/enum string (`status`,
  `verdict`, `doc_type`) — never a bare boolean-looking column. If any
  future step needs a true/false comparison against Sheets data, compare
  with `String(x).toUpperCase() === 'TRUE'`, never `=== 'TRUE'` alone
  (Google Sheets silently coerces a written `"TRUE"` string to a real
  boolean; this exact bug was found and fixed in `QCHandler.gs`/`Portal.gs`
  on 2026-08-12 — same root cause class, do not reintroduce it).
- `RBAC.enforcePermission()` (or, for the token-gated manager-review path,
  explicit token verification before any data access) must be the
  unconditional first statement in every new handler function.
- All new test suites/setup helpers must start with the `Config.isDev()`
  guard and use only synthetic identities from
  `.claude/rules/testing-policy.md` (`TEST-CLIENT`, `test-*@test.blc.internal`).
- `DIM_SOP_TEMPLATES.scope_code` is already the product-matching field
  used by `SopGate` — do not add any new product column to that table.
  Upload-created templates set `scope_code` directly to the product value
  (`TRUSS` / `OPEN_WOOD_FLOOR` / `I_JOIST_FLOOR`).
- The manager-feedback endpoint's secret is a **new, separate** Script
  Property (`SOP_REVIEW_LINK_SECRET`) — never reuse `PORTAL_LINK_SECRET`
  (its rotation is a global staff-lockout event per CLAUDE.md R9) or
  `RATING_LINK_SECRET` (a different feature's secret).
- No PROD deploy, no `npm run push:prod`, is authorized by this plan.
  DEV-only, per CLAUDE.md R10.

---

### Task 1: Data layer, RBAC, and the upload endpoint

**Files:**
- Modify: `src/setup/SetupScript.gs` (add `SCHEMAS['DIM_SOP_UPLOADS']`,
  `SCHEMAS['FACT_SOP_REVIEW_FEEDBACK']`, add
  `'FACT_SOP_REVIEW_FEEDBACK'` to `FLAT_FACT_TABLE_NAMES`)
- Modify: `src/00-foundation/Config.gs` (add `ID_PREFIXES.SOP_UPLOAD`,
  `ID_PREFIXES.SOP_FEEDBACK`, add `Config.TABLES.DIM_SOP_UPLOADS` and
  `Config.TABLES.FACT_SOP_REVIEW_FEEDBACK`, add `Config.PRODUCT_CODES`
  and `Config.PRODUCT_LABELS`)
- Modify: `src/02-security/RBAC.gs` (add `ACTIONS.SOP_UPLOAD`, add
  `SOP_UPLOAD: true` to the `CEO` block, `SOP_UPLOAD: false` to all 8
  other role blocks: `DESIGNER`, `TEAM_LEAD`, `QC`, `PM`, `ADMIN`,
  `SYSTEM`, `CLIENT`, `HR_ACCOUNTING`)
- Modify: `src/01-dal/DAL.gs` (add `WRITE_PERMISSIONS['DIM_SOP_UPLOADS']`
  and `WRITE_PERMISSIONS['FACT_SOP_REVIEW_FEEDBACK']`)
- Create: `src/13-sop/SopUploadEngine.gs`
- Modify: `src/07-portal/Portal.gs` (add `portal_uploadSopDocument`)
- Modify: `src/07-portal/PortalView.html` (add the upload form, CEO-only)
- Create: `src/setup/SopUploadEngineTest.gs`
- Modify: `src/setup/TestHarness.gs` (register the new suite in
  `runV3HandlerTests()`)

**Interfaces:**
- Produces: `SopUploadEngine.createUpload(actorEmail, params)` where
  `params = { clientCode, productCode, docType, fileBlob, fileName }`,
  `docType` is `'DESIGNER_SOP'` or `'QC_REVIEW_SOP'`. Returns
  `{ uploadId: string, driveFileUrl: string }`. Throws on RBAC denial,
  missing params, unknown/inactive `clientCode`, or invalid `productCode`/
  `docType`.
- Produces: `Config.PRODUCT_CODES = { TRUSS: 'TRUSS', OPEN_WOOD_FLOOR: 'OPEN_WOOD_FLOOR', I_JOIST_FLOOR: 'I_JOIST_FLOOR' }`
  and `Config.PRODUCT_LABELS` (product code → human `job_type` label) —
  Task 2 and Task 3 read these; later work (out of scope here) reading job
  creation should use the same constant.
- Produces: `Config.TABLES.DIM_SOP_UPLOADS` = `'DIM_SOP_UPLOADS'`,
  `Config.TABLES.FACT_SOP_REVIEW_FEEDBACK` = `'FACT_SOP_REVIEW_FEEDBACK'`
  — Task 2 and Task 3 read/write these tables via these constants.
- Consumes: `DAL.appendRow`, `DAL.readWhere`, `DAL.updateWhere` (existing,
  `src/01-dal/DAL.gs`); `RBAC.resolveActor`, `RBAC.enforcePermission`,
  `RBAC.ACTIONS` (existing, `src/02-security/RBAC.gs`);
  `Identifiers.generatePrefixedId` (existing, `src/00-foundation/Identifiers.gs`);
  `DAL.readWhere(Config.TABLES.DIM_CLIENT_MASTER, { client_code, active: 'TRUE' })`
  for client validation — compare with `.toUpperCase()`, not `===`.

- [ ] **Step 1: Add the two new table schemas**

In `src/setup/SetupScript.gs`, find the `SCHEMAS` object (starts around
line 55) and add these two entries near the other `DIM_SOP_*`/`FACT_SOP_*`
entries:

```javascript
  // DIM_SOP_UPLOADS — tracks an uploaded SOP source document through
  // its lifecycle: PENDING (just uploaded) -> DRAFT_READY (Claude has
  // structured it into a DRAFT template) -> PUBLISHED, or REJECTED.
  // Not a FACT table — status is mutated in place via updateWhere,
  // same pattern as DIM_SOP_TEMPLATES.
  'DIM_SOP_UPLOADS': [
    'upload_id', 'client_code', 'product_code', 'doc_type',
    'drive_file_id', 'drive_file_url',
    'uploaded_by', 'uploaded_at', 'status',
    'resulting_template_id', 'notes'
  ],

  // FACT_SOP_REVIEW_FEEDBACK — one row per manager comment on a draft
  // SOP upload. Append-only, flat (not partitioned — low volume, same
  // class as FACT_CLIENT_FEEDBACK).
  'FACT_SOP_REVIEW_FEEDBACK': [
    'feedback_id', 'upload_id', 'reviewer_name',
    'verdict', 'comment', 'submitted_at'
  ],
```

Find `FLAT_FACT_TABLE_NAMES` (around line 540) and add the new table:

```javascript
var FLAT_FACT_TABLE_NAMES = [
  'FACT_CLIENT_FEEDBACK',
  'FACT_PERFORMANCE_RATINGS',
  'FACT_QUARTERLY_BONUS',
  'FACT_SOP_CURRENT_STATUS',
  'FACT_SOP_REVIEW_FEEDBACK'
];
```

`DIM_SOP_UPLOADS` needs no list membership — non-`FACT_`-prefixed tables
in `SCHEMAS` are created generically by `setupSchemas_()`'s loop over
`Object.keys(SCHEMAS)`.

- [ ] **Step 2: Add table name constants, ID prefixes, and product taxonomy to Config.gs**

In `src/00-foundation/Config.gs`, find `Config.TABLES` and add:

```javascript
    DIM_SOP_UPLOADS:            'DIM_SOP_UPLOADS',
    FACT_SOP_REVIEW_FEEDBACK:   'FACT_SOP_REVIEW_FEEDBACK',
```

Find `ID_PREFIXES` (around line 321) and add:

```javascript
    SOP_UPLOAD:   'SU',   // SU-{ts}-{rand}  (SOP document upload — DIM_SOP_UPLOADS)
    SOP_FEEDBACK: 'SF',   // SF-{ts}-{rand}  (SOP manager review feedback — FACT_SOP_REVIEW_FEEDBACK)
```

Add a new top-level block near `ID_PREFIXES` for the product taxonomy:

```javascript
  // ──────────────────────────────────────────────────────────
  // PRODUCT TAXONOMY
  // The 3 products BLC designs. Used as DIM_SOP_TEMPLATES.scope_code
  // (designer SOPs — already the product-matching field, see
  // docs/superpowers/specs/2026-08-13-sop-upload-workflow-design.md)
  // and DIM_QC_PROCESS_TEMPLATES.product_code (QC-review SOPs, once
  // that system is built). PRODUCT_LABELS is a display-only label used
  // for DIM_SOP_TEMPLATES.job_type — job_type plays no role in
  // template resolution, it is metadata only.
  // ──────────────────────────────────────────────────────────
  var PRODUCT_CODES = {
    TRUSS:           'TRUSS',
    OPEN_WOOD_FLOOR: 'OPEN_WOOD_FLOOR',
    I_JOIST_FLOOR:   'I_JOIST_FLOOR'
  };

  var PRODUCT_LABELS = {
    TRUSS:           'Roof Truss',
    OPEN_WOOD_FLOOR:  'Open Wood Floor',
    I_JOIST_FLOOR:    'I-Joist Floor'
  };
```

Add both to the returned public object at the bottom of `Config.gs`
(find the `return { ... }` block and add `PRODUCT_CODES: PRODUCT_CODES,`
and `PRODUCT_LABELS: PRODUCT_LABELS,` alongside the existing `ID_PREFIXES:
ID_PREFIXES,` line).

- [ ] **Step 3: Add the new RBAC action**

In `src/02-security/RBAC.gs`, find the `ACTIONS` object's SOP section
(search for `SOP_ADMIN:`) and add directly after it:

```javascript
    SOP_UPLOAD:          'SOP_UPLOAD',      // Upload a source SOP document for structuring (CEO only)
```

In the `PERMISSION_MATRIX`, find the `CEO: {` block (around line 419) and
add:

```javascript
      SOP_UPLOAD:      true,
```

For each of the other 8 role blocks (`DESIGNER`, `TEAM_LEAD`, `QC`, `PM`,
`ADMIN`, `SYSTEM`, `CLIENT`, `HR_ACCOUNTING`), add in the same relative
position (near their existing `SOP_ADMIN` line, for readability):

```javascript
      SOP_UPLOAD:      false,
```

- [ ] **Step 4: Add write permissions**

In `src/01-dal/DAL.gs`, find `WRITE_PERMISSIONS` (search for
`'DIM_SOP_TEMPLATES':`) and add directly after it:

```javascript
    'DIM_SOP_UPLOADS':        ['SopUploadEngine'],
    'FACT_SOP_REVIEW_FEEDBACK': ['SopUploadEngine'],
```

- [ ] **Step 5: Write `SopUploadEngine.gs`**

Create `src/13-sop/SopUploadEngine.gs`:

```javascript
// ============================================================
// SopUploadEngine.gs — BLC Nexus T13 SOP Upload Workflow
// src/13-sop/SopUploadEngine.gs
//
// Owns DIM_SOP_UPLOADS (upload lifecycle) and
// FACT_SOP_REVIEW_FEEDBACK (manager review comments). Does NOT
// touch DIM_SOP_TEMPLATES/DIM_SOP_ITEMS directly — template
// creation and publishing goes through the existing
// SopAdminEngine, called from a Claude session, not from here.
//
// LOAD ORDER: T13, after SopDAL.gs.
// DEPENDENCIES: Config (T0), RBAC (T2), Logger (T3), DAL (T1)
// ============================================================

var SopUploadEngine = (function () {

  var MODULE = 'SopUploadEngine';

  function SopUploadError_(code, message, details) {
    var e = new Error(message);
    e.name = 'SopUploadError';
    e.code = code;
    e.details = details || {};
    return e;
  }

  // ──────────────────────────────────────────────────────────
  // createUpload
  // Validates, stores the file in Drive, writes a PENDING
  // DIM_SOP_UPLOADS row, and emails the CEO.
  //
  // params: { clientCode, productCode, docType, fileBlob, fileName }
  // Returns: { uploadId, driveFileUrl }
  // ──────────────────────────────────────────────────────────
  function createUpload(actorEmail, params) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.SOP_UPLOAD);

    params = params || {};
    if (!params.clientCode || !params.productCode || !params.docType || !params.fileBlob) {
      throw SopUploadError_('SOP_UPLOAD_MISSING_FIELDS',
        'clientCode, productCode, docType, and fileBlob are all required', params);
    }
    if (params.docType !== 'DESIGNER_SOP' && params.docType !== 'QC_REVIEW_SOP') {
      throw SopUploadError_('SOP_UPLOAD_INVALID_DOC_TYPE',
        'doc_type must be DESIGNER_SOP or QC_REVIEW_SOP', { docType: params.docType });
    }
    var validProducts = [Config.PRODUCT_CODES.TRUSS, Config.PRODUCT_CODES.OPEN_WOOD_FLOOR, Config.PRODUCT_CODES.I_JOIST_FLOOR];
    if (validProducts.indexOf(params.productCode) === -1) {
      throw SopUploadError_('SOP_UPLOAD_INVALID_PRODUCT',
        'product_code must be one of: ' + validProducts.join(', '), { productCode: params.productCode });
    }

    var clientRows = DAL.readWhere(Config.TABLES.DIM_CLIENT_MASTER,
      { client_code: params.clientCode }, { callerModule: MODULE });
    var activeClient = clientRows.filter(function (r) {
      return String(r.active).toUpperCase() === 'TRUE';
    })[0];
    if (!activeClient) {
      throw SopUploadError_('SOP_UPLOAD_UNKNOWN_CLIENT',
        'client_code "' + params.clientCode + '" is not an active client', { clientCode: params.clientCode });
    }

    var folder = getOrCreateUploadFolder_();
    var driveFile = folder.createFile(params.fileBlob.setName(params.fileName || 'sop-upload'));
    var uploadId = Identifiers.generatePrefixedId(Config.ID_PREFIXES.SOP_UPLOAD);
    var now = new Date().toISOString();

    DAL.appendRow(Config.TABLES.DIM_SOP_UPLOADS, {
      upload_id:              uploadId,
      client_code:            params.clientCode,
      product_code:           params.productCode,
      doc_type:               params.docType,
      drive_file_id:          driveFile.getId(),
      drive_file_url:         driveFile.getUrl(),
      uploaded_by:            actorEmail,
      uploaded_at:            now,
      status:                 'PENDING',
      resulting_template_id:  '',
      notes:                  ''
    }, { callerModule: MODULE });

    Logger.info('SOP_UPLOAD_CREATED', {
      module: MODULE, uploadId: uploadId, clientCode: params.clientCode,
      productCode: params.productCode, docType: params.docType
    });

    notifyCeoOfUpload_(uploadId, params.clientCode, params.productCode, params.docType, driveFile.getUrl());

    return { uploadId: uploadId, driveFileUrl: driveFile.getUrl() };
  }

  function getOrCreateUploadFolder_() {
    var FOLDER_NAME = 'BLC Nexus — SOP Uploads';
    var existing = DriveApp.getFoldersByName(FOLDER_NAME);
    if (existing.hasNext()) return existing.next();
    return DriveApp.createFolder(FOLDER_NAME);
  }

  function notifyCeoOfUpload_(uploadId, clientCode, productCode, docType, driveFileUrl) {
    var recipient = PropertiesService.getScriptProperties().getProperty('HM_ALERT_RECIPIENT');
    if (!recipient) {
      Logger.warn('SOP_UPLOAD_NOTIFY_SKIPPED', { module: MODULE, reason: 'HM_ALERT_RECIPIENT not set', uploadId: uploadId });
      return;
    }
    try {
      MailApp.sendEmail({
        to: recipient,
        subject: 'New SOP document uploaded — needs processing (' + clientCode + ' / ' + productCode + ')',
        body: 'A new ' + docType + ' document was uploaded for client ' + clientCode +
              ', product ' + productCode + '.\n\n' +
              'Upload ID: ' + uploadId + '\n' +
              'Document: ' + driveFileUrl + '\n\n' +
              'Start a Claude Code session and ask it to process this pending SOP upload.'
      });
    } catch (e) {
      Logger.error('SOP_UPLOAD_NOTIFY_FAILED', { module: MODULE, uploadId: uploadId, error: e.message });
    }
  }

  return {
    createUpload: createUpload
  };

})();
```

- [ ] **Step 6: Add the portal wrapper**

In `src/07-portal/Portal.gs`, add near the other `portal_getSop*`
functions:

```javascript
/**
 * Uploads a source SOP document for structuring. CEO only.
 * payload: { clientCode, productCode, docType }
 * fileBlob comes separately as a Blob (not JSON-serializable).
 *
 * @param {string} ptoken
 * @param {string} payloadJson
 * @param {Blob}   fileBlob
 * @returns {string} JSON: { uploadId, driveFileUrl }
 */
function portal_uploadSopDocument(ptoken, payloadJson, fileBlob) {
  var email = PortalAuth.resolveEmail(ptoken);
  var payload = JSON.parse(payloadJson);
  var result = SopUploadEngine.createUpload(email, {
    clientCode:  payload.clientCode,
    productCode: payload.productCode,
    docType:     payload.docType,
    fileBlob:    fileBlob,
    fileName:    payload.fileName
  });
  return JSON.stringify(result);
}
```

- [ ] **Step 7: Add the upload form to the portal UI**

In `src/07-portal/PortalView.html`, find where CEO-only sections are
conditionally rendered (search for `perms.isQcReviewer` or a similar
role-gated block used as a model) and add a new CEO-only section with:
a client `<select>` populated from the existing client list data already
available to the portal, a product `<select>` with the 3 fixed options
(`Truss` / `Open Wood Floor` / `I-Joist Floor`, values `TRUSS` /
`OPEN_WOOD_FLOOR` / `I_JOIST_FLOOR`), a doc-type `<select>` (`Designer
SOP` / `QC-Review SOP`, values `DESIGNER_SOP` / `QC_REVIEW_SOP`), and a
file `<input type="file">`. On submit, build a `FormData`-free approach:
Apps Script's `google.script.run` supports passing a `Blob` directly from
an `<input type="file">` via the standard pattern —
`google.script.run.withSuccessHandler(...).portal_uploadSopDocument(ptoken, JSON.stringify(payload), fileInput.files[0])`.
Show a success message with the returned `uploadId` on success, an error
banner on failure — follow this file's existing `.sop-error-banner`
pattern for the banner styling.

- [ ] **Step 8: Write the test suite**

Create `src/setup/SopUploadEngineTest.gs`:

```javascript
// ============================================================
// SopUploadEngineTest.gs — T1 minimum for SopUploadEngine.createUpload
// ============================================================

var TH_SOP_UPLOAD_CLIENT = 'TEST-CLIENT';

function testSopUpload_happyPath() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var blob = Utilities.newBlob('fake sop content', 'text/plain', 'test-sop.txt');
    var result = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_SOP_UPLOAD_CLIENT,
      productCode: Config.PRODUCT_CODES.TRUSS,
      docType: 'DESIGNER_SOP',
      fileBlob: blob,
      fileName: 'test-sop.txt'
    });
    assertH_(results, counters, 'Returns an uploadId', !!result.uploadId, JSON.stringify(result));

    var rows = DAL.readWhere(Config.TABLES.DIM_SOP_UPLOADS, { upload_id: result.uploadId });
    assertH_(results, counters, 'DIM_SOP_UPLOADS row exists', rows.length === 1, 'count=' + rows.length);
    if (rows.length === 1) {
      assertH_(results, counters, 'status = PENDING', rows[0].status === 'PENDING', rows[0].status);
      assertH_(results, counters, 'product_code stored', rows[0].product_code === Config.PRODUCT_CODES.TRUSS, rows[0].product_code);
    }
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_rbacDenial() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var blob = Utilities.newBlob('fake sop content', 'text/plain', 'test-sop.txt');
    var threw = false;
    try {
      SopUploadEngine.createUpload(TH_DESIGNER_EMAIL, {
        clientCode: TH_SOP_UPLOAD_CLIENT, productCode: Config.PRODUCT_CODES.TRUSS,
        docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
      });
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Non-CEO actor rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_invalidInput() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var threw = false;
    try {
      SopUploadEngine.createUpload(TH_CEO_EMAIL, {
        clientCode: TH_SOP_UPLOAD_CLIENT, productCode: 'NOT_A_REAL_PRODUCT',
        docType: 'DESIGNER_SOP', fileBlob: Utilities.newBlob('x'), fileName: 'x.txt'
      });
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Invalid product_code rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_unknownClient() {
  // T1 calls for a "duplicate submission" case; this is a one-off admin
  // action with no natural idempotency key, so this suite substitutes
  // the other realistic rejection case: an unknown/inactive client_code.
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var threw = false;
    try {
      SopUploadEngine.createUpload(TH_CEO_EMAIL, {
        clientCode: 'NOT-A-REAL-CLIENT', productCode: Config.PRODUCT_CODES.TRUSS,
        docType: 'DESIGNER_SOP', fileBlob: Utilities.newBlob('x'), fileName: 'x.txt'
      });
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Unknown client_code rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function runSopUploadEngineTests() {
  if (!Config.isDev()) {
    throw new Error('Test suite cannot run in PROD. Switch to DEV environment.');
  }
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SOP UPLOAD ENGINE TEST SUITE');
  console.log('═══════════════════════════════════════════════════════');

  var suiteCounters = { passed: 0, failed: 0 };
  var tests = [
    testSopUpload_happyPath,
    testSopUpload_rbacDenial,
    testSopUpload_invalidInput,
    testSopUpload_unknownClient
  ];
  for (var i = 0; i < tests.length; i++) {
    var c = tests[i]();
    suiteCounters.passed += c.passed;
    suiteCounters.failed += c.failed;
  }
  console.log('SUITE TOTAL — passed: ' + suiteCounters.passed + '  failed: ' + suiteCounters.failed);
  thCleanupTestArtifacts_();
  return suiteCounters;
}
```

Check `TestHarness.gs` for the exact names of `TH_CEO_EMAIL` and
`TH_DESIGNER_EMAIL` constants (or their equivalents) before using them
above — if they don't already exist under those names, use whatever the
existing CEO/Designer test-actor email constants are actually called in
this codebase, and add a comment noting the substitution.

- [ ] **Step 9: Register the suite and commit**

In `src/setup/TestHarness.gs`, find `runV3HandlerTests()` and add
`runSopUploadEngineTests()` to its list of suites, matching the existing
pattern for suite registration.

```bash
git add src/setup/SetupScript.gs src/00-foundation/Config.gs \
  src/02-security/RBAC.gs src/01-dal/DAL.gs src/13-sop/SopUploadEngine.gs \
  src/07-portal/Portal.gs src/07-portal/PortalView.html \
  src/setup/SopUploadEngineTest.gs src/setup/TestHarness.gs
git commit -m "feat: SOP upload endpoint (DIM_SOP_UPLOADS, SopUploadEngine, portal upload form)"
```

---

### Task 2: Manager review link

**Files:**
- Modify: `src/07-portal/Portal.gs` (add `runGenerateSopReviewSecret`,
  `portal_getSopUploadForReview`, `portal_submitSopReviewFeedback`, add
  the `page === 'review-sop'` branch to `doGet`)
- Modify: `src/13-sop/SopUploadEngine.gs` (add `tokenForUpload`,
  `getUploadForReview`, `submitReviewFeedback`)
- Create: `src/07-portal/ReviewSop.html`
- Modify: `src/setup/SopUploadEngineTest.gs` (add feedback-endpoint tests)

**Interfaces:**
- Consumes: `Config.TABLES.DIM_SOP_UPLOADS`,
  `Config.TABLES.FACT_SOP_REVIEW_FEEDBACK`, `Identifiers.generatePrefixedId`,
  `Config.ID_PREFIXES.SOP_FEEDBACK` (all from Task 1).
- Produces: `SopUploadEngine.tokenForUpload(uploadId)` → signed token
  string. `SopUploadEngine.getUploadForReview(uploadId, token)` → throws
  on bad token, else returns
  `{ uploadId, clientCode, productCode, docType, driveFileUrl, status }`.
  `SopUploadEngine.submitReviewFeedback(uploadId, token, reviewerName, verdict, comment)`
  → throws on bad token or `status !== 'DRAFT_READY'`, else appends a
  `FACT_SOP_REVIEW_FEEDBACK` row and returns `{ ok: true }`. Task 3 uses
  `tokenForUpload` to build the shareable link shown on the publish
  screen.

- [ ] **Step 1: Add the token functions to `SopUploadEngine.gs`**

Add to `src/13-sop/SopUploadEngine.gs` (inside the IIFE, before the
`return` statement — update the `return` block to also export
`tokenForUpload`, `getUploadForReview`, and `submitReviewFeedback`):

```javascript
  // ──────────────────────────────────────────────────────────
  // Manager-review token — HMAC-SHA256(uploadId, SOP_REVIEW_LINK_SECRET).
  // Same pattern as PortalData.gs's ratingToken_/requireValidRatingToken_
  // (RATING_LINK_SECRET) — a dedicated secret per CLAUDE.md R9, never
  // PORTAL_LINK_SECRET (global rotation = staff lockout event).
  // ──────────────────────────────────────────────────────────
  function tokenForUpload(uploadId) {
    var secret = PropertiesService.getScriptProperties().getProperty('SOP_REVIEW_LINK_SECRET');
    if (!secret) {
      throw new Error('SOP_REVIEW_LINK_SECRET not set. Run runGenerateSopReviewSecret() once from the Apps Script editor.');
    }
    var bytes = Utilities.computeHmacSha256Signature(String(uploadId), secret);
    return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
  }

  function requireValidReviewToken_(uploadId, token) {
    if (!token) {
      throw SopUploadError_('SOP_REVIEW_TOKEN_MISSING', 'Review link token missing.', { uploadId: uploadId });
    }
    if (String(token) !== tokenForUpload(uploadId)) {
      throw SopUploadError_('SOP_REVIEW_TOKEN_INVALID', 'Invalid review link token for upload ' + uploadId + '.', { uploadId: uploadId });
    }
  }

  function getUploadRow_(uploadId) {
    var rows = DAL.readWhere(Config.TABLES.DIM_SOP_UPLOADS, { upload_id: uploadId }, { callerModule: MODULE });
    if (!rows || rows.length === 0) {
      throw SopUploadError_('SOP_UPLOAD_NOT_FOUND', 'Upload not found: ' + uploadId, { uploadId: uploadId });
    }
    return rows[0];
  }

  // ──────────────────────────────────────────────────────────
  // getUploadForReview — token-gated, no actor resolution, no
  // RBAC. Matches the quarterly-ratings external-reviewer model:
  // the token itself is the credential.
  // ──────────────────────────────────────────────────────────
  function getUploadForReview(uploadId, token) {
    requireValidReviewToken_(uploadId, token);
    var row = getUploadRow_(uploadId);
    return {
      uploadId:     row.upload_id,
      clientCode:   row.client_code,
      productCode:  row.product_code,
      docType:      row.doc_type,
      driveFileUrl: row.drive_file_url,
      status:       row.status
    };
  }

  // ──────────────────────────────────────────────────────────
  // submitReviewFeedback — token-gated. Refuses once the upload
  // has moved past DRAFT_READY (link "dies" after publish).
  // ──────────────────────────────────────────────────────────
  function submitReviewFeedback(uploadId, token, reviewerName, verdict, comment) {
    requireValidReviewToken_(uploadId, token);
    var row = getUploadRow_(uploadId);
    if (row.status !== 'DRAFT_READY') {
      throw SopUploadError_('SOP_REVIEW_NOT_OPEN',
        'This SOP is no longer open for review (status: ' + row.status + ').', { uploadId: uploadId, status: row.status });
    }
    if (!reviewerName || (verdict !== 'LOOKS_CORRECT' && verdict !== 'HAS_ISSUES')) {
      throw SopUploadError_('SOP_REVIEW_INVALID_FEEDBACK',
        'reviewerName is required and verdict must be LOOKS_CORRECT or HAS_ISSUES.', { reviewerName: reviewerName, verdict: verdict });
    }

    DAL.appendRow(Config.TABLES.FACT_SOP_REVIEW_FEEDBACK, {
      feedback_id:    Identifiers.generatePrefixedId(Config.ID_PREFIXES.SOP_FEEDBACK),
      upload_id:      uploadId,
      reviewer_name:  reviewerName,
      verdict:        verdict,
      comment:        comment || '',
      submitted_at:   new Date().toISOString()
    }, { callerModule: MODULE });

    Logger.info('SOP_REVIEW_FEEDBACK_SUBMITTED', { module: MODULE, uploadId: uploadId, verdict: verdict });
    return { ok: true };
  }
```

Update the `return { ... }` block at the bottom of the IIFE to:

```javascript
  return {
    createUpload:          createUpload,
    tokenForUpload:        tokenForUpload,
    getUploadForReview:    getUploadForReview,
    submitReviewFeedback:  submitReviewFeedback
  };
```

- [ ] **Step 2: Add the secret generator and portal wrappers**

In `src/07-portal/Portal.gs`, add near `runGenerateRatingSecret`:

```javascript
function runGenerateSopReviewSecret() {
  var secret = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
      Utilities.getUuid() + Date.now() + Math.random())
  );
  PropertiesService.getScriptProperties().setProperty('SOP_REVIEW_LINK_SECRET', secret);
  console.log('SOP_REVIEW_LINK_SECRET generated. Any previously-shared review links are now invalid.');
}

/**
 * Returns a draft SOP upload's details for manager review. Token-gated,
 * no portal login. Accessed directly from a shared review link, not the
 * main portal flow — mirrors portal_getMyRatees's rater-link model.
 *
 * @param {string} uploadId
 * @param {string} token
 * @returns {string} JSON
 */
function portal_getSopUploadForReview(uploadId, token) {
  return JSON.stringify(SopUploadEngine.getUploadForReview(uploadId, token));
}

/**
 * Submits a manager's review feedback on a draft SOP upload.
 * Token-gated, no portal login.
 *
 * @param {string} uploadId
 * @param {string} token
 * @param {string} reviewerName
 * @param {string} verdict       'LOOKS_CORRECT' | 'HAS_ISSUES'
 * @param {string} comment       optional
 * @returns {string} JSON: { ok: true }
 */
function portal_submitSopReviewFeedback(uploadId, token, reviewerName, verdict, comment) {
  return JSON.stringify(SopUploadEngine.submitReviewFeedback(uploadId, token, reviewerName, verdict, comment));
}
```

- [ ] **Step 3: Add the `doGet` route**

In `src/07-portal/Portal.gs`'s `doGet(e)`, find the `if (page === 'rate-staff')`
branch (near the top of the function) and add a new branch directly
after it, before the fallback portal-page logic:

```javascript
  if (page === 'review-sop') {
    var uploadId    = e && e.parameter && e.parameter.uploadId ? e.parameter.uploadId : '';
    var reviewToken = e && e.parameter && e.parameter.token    ? e.parameter.token    : '';
    var reviewHtml  = HtmlService.createHtmlOutputFromFile('07-portal/ReviewSop');
    var reviewContent =
        '<script>var INJECTED_UPLOAD_ID = ' + JSON.stringify(uploadId)    + ';<\/script>\n'
      + '<script>var INJECTED_TOKEN = '     + JSON.stringify(reviewToken) + ';<\/script>\n'
      + reviewHtml.getContent();
    return HtmlService.createHtmlOutput(reviewContent)
      .setTitle('BLC SOP Review')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
```

- [ ] **Step 4: Write `ReviewSop.html`**

Create `src/07-portal/ReviewSop.html`, following `QuarterlyRating.html`'s
structure (a standalone HTML page, not embedded in the main portal
shell — check that file first for its exact boilerplate/style-linking
pattern and match it). Content: read `INJECTED_UPLOAD_ID`/`INJECTED_TOKEN`,
call `google.script.run.withSuccessHandler(...).portal_getSopUploadForReview(uploadId, token)`
on load, render the client/product/doc-type, a link to `driveFileUrl`
(labelled "View original document"), a name `<input>`, a verdict radio
group (`Looks Correct` / `Has Issues`), an optional comment `<textarea>`,
and a submit button calling
`portal_submitSopReviewFeedback(uploadId, token, name, verdict, comment)`.
On success show a thank-you message; on failure (including the
`SOP_REVIEW_NOT_OPEN` case) show a clear message that this SOP is no
longer open for review.

- [ ] **Step 5: Add feedback-endpoint tests**

Add to `src/setup/SopUploadEngineTest.gs`:

```javascript
function testSopUpload_reviewFeedback_validToken() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var blob = Utilities.newBlob('x', 'text/plain', 'x.txt');
    var upload = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_SOP_UPLOAD_CLIENT, productCode: Config.PRODUCT_CODES.TRUSS,
      docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
    });
    // Simulate Claude having structured it — move straight to DRAFT_READY for this test.
    DAL.updateWhere(Config.TABLES.DIM_SOP_UPLOADS,
      { upload_id: upload.uploadId }, { status: 'DRAFT_READY' }, { callerModule: 'SopUploadEngineTest' });

    var token = SopUploadEngine.tokenForUpload(upload.uploadId);
    var review = SopUploadEngine.getUploadForReview(upload.uploadId, token);
    assertH_(results, counters, 'getUploadForReview returns status DRAFT_READY', review.status === 'DRAFT_READY', review.status);

    var feedback = SopUploadEngine.submitReviewFeedback(upload.uploadId, token, 'Test Manager', 'LOOKS_CORRECT', 'looks fine');
    assertH_(results, counters, 'submitReviewFeedback ok', feedback.ok === true, JSON.stringify(feedback));

    var rows = DAL.readWhere(Config.TABLES.FACT_SOP_REVIEW_FEEDBACK, { upload_id: upload.uploadId });
    assertH_(results, counters, 'FACT_SOP_REVIEW_FEEDBACK row written', rows.length === 1, 'count=' + rows.length);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_reviewFeedback_invalidToken() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var blob = Utilities.newBlob('x', 'text/plain', 'x.txt');
    var upload = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_SOP_UPLOAD_CLIENT, productCode: Config.PRODUCT_CODES.TRUSS,
      docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
    });
    DAL.updateWhere(Config.TABLES.DIM_SOP_UPLOADS,
      { upload_id: upload.uploadId }, { status: 'DRAFT_READY' }, { callerModule: 'SopUploadEngineTest' });

    var threw = false;
    try {
      SopUploadEngine.getUploadForReview(upload.uploadId, 'not-a-real-token');
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Wrong token rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_reviewFeedback_refusedAfterPublish() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var blob = Utilities.newBlob('x', 'text/plain', 'x.txt');
    var upload = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_SOP_UPLOAD_CLIENT, productCode: Config.PRODUCT_CODES.TRUSS,
      docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
    });
    DAL.updateWhere(Config.TABLES.DIM_SOP_UPLOADS,
      { upload_id: upload.uploadId }, { status: 'PUBLISHED' }, { callerModule: 'SopUploadEngineTest' });

    var token = SopUploadEngine.tokenForUpload(upload.uploadId);
    var threw = false;
    try {
      SopUploadEngine.submitReviewFeedback(upload.uploadId, token, 'Test Manager', 'LOOKS_CORRECT', '');
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Feedback refused once status is PUBLISHED', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}
```

Add all three to `runSopUploadEngineTests()`'s `tests` array.

- [ ] **Step 6: Commit**

```bash
git add src/07-portal/Portal.gs src/13-sop/SopUploadEngine.gs \
  src/07-portal/ReviewSop.html src/setup/SopUploadEngineTest.gs
git commit -m "feat: manager review link for draft SOP uploads (token-gated, no login)"
```

---

### Task 3: CEO publish screen

**Files:**
- Modify: `src/13-sop/SopUploadEngine.gs` (add `listPendingUploads`,
  `publishUpload`, `markDraftReady`)
- Modify: `src/07-portal/Portal.gs` (add `portal_getPendingSopUploads`,
  `portal_publishSopUpload`)
- Modify: `src/07-portal/PortalView.html` (add the pending-uploads /
  publish screen, CEO-only)
- Modify: `src/setup/SopUploadEngineTest.gs` (add publish tests)

**Interfaces:**
- Consumes: `SopAdminEngine.publishTemplate` (existing,
  `src/13-sop/SopAdminEngine.gs`) — unmodified; `SopUploadEngine.tokenForUpload`
  (Task 2) to build the shareable link shown on this screen.
- Produces: `SopUploadEngine.markDraftReady(uploadId, resultingTemplateId, notes)`
  — the function a Claude session calls (via the Apps Script editor,
  directly — not portal-exposed) once it has structured an upload into a
  `DRAFT` template via `SopAdminEngine`. Sets `status: 'DRAFT_READY'`,
  `resulting_template_id`, and `notes`.
  `SopUploadEngine.listPendingUploads()` → array of upload rows with
  `status !== 'PUBLISHED'` and `status !== 'REJECTED'`, each including
  its feedback rows and review link.
  `SopUploadEngine.publishUpload(actorEmail, uploadId)` → RBAC
  `SOP_UPLOAD`-gated, calls `SopAdminEngine.publishTemplate`, then updates
  the upload row to `status: 'PUBLISHED'`. Throws if the upload has no
  `resulting_template_id` yet (not structured) or is already `PUBLISHED`.

- [ ] **Step 1: Add `markDraftReady`, `listPendingUploads`, `publishUpload`**

Add to `src/13-sop/SopUploadEngine.gs`, before the `return` statement:

```javascript
  // ──────────────────────────────────────────────────────────
  // markDraftReady — called by a Claude session (via the Apps
  // Script editor) once it has structured an upload's source
  // document into a DRAFT template via SopAdminEngine. Not
  // portal-exposed — this is a manual, editor-run step.
  // ──────────────────────────────────────────────────────────
  function markDraftReady(uploadId, resultingTemplateId, notes) {
    if (!resultingTemplateId) {
      throw SopUploadError_('SOP_UPLOAD_MISSING_TEMPLATE_ID', 'resultingTemplateId is required.', { uploadId: uploadId });
    }
    DAL.updateWhere(Config.TABLES.DIM_SOP_UPLOADS,
      { upload_id: uploadId },
      { status: 'DRAFT_READY', resulting_template_id: resultingTemplateId, notes: notes || '' },
      { callerModule: MODULE });
    Logger.info('SOP_UPLOAD_DRAFT_READY', { module: MODULE, uploadId: uploadId, resultingTemplateId: resultingTemplateId });
    return { uploadId: uploadId, status: 'DRAFT_READY' };
  }

  // ──────────────────────────────────────────────────────────
  // listPendingUploads — CEO publish screen. Everything not yet
  // PUBLISHED or REJECTED, each with its feedback and review link.
  // ──────────────────────────────────────────────────────────
  function listPendingUploads(actorEmail) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.SOP_UPLOAD);

    var allUploads = DAL.readWhere(Config.TABLES.DIM_SOP_UPLOADS, {}, { callerModule: MODULE });
    var pending = allUploads.filter(function (r) {
      return r.status !== 'PUBLISHED' && r.status !== 'REJECTED';
    });

    var allFeedback = DAL.readWhere(Config.TABLES.FACT_SOP_REVIEW_FEEDBACK, {}, { callerModule: MODULE });

    return pending.map(function (row) {
      var feedback = allFeedback.filter(function (f) { return f.upload_id === row.upload_id; });
      var reviewLink = row.status === 'DRAFT_READY'
        ? buildReviewLink_(row.upload_id)
        : '';
      return {
        uploadId:             row.upload_id,
        clientCode:           row.client_code,
        productCode:          row.product_code,
        docType:              row.doc_type,
        driveFileUrl:         row.drive_file_url,
        status:               row.status,
        resultingTemplateId:  row.resulting_template_id,
        notes:                row.notes,
        reviewLink:           reviewLink,
        feedback:             feedback.map(function (f) {
          return { reviewerName: f.reviewer_name, verdict: f.verdict, comment: f.comment, submittedAt: f.submitted_at };
        })
      };
    });
  }

  function buildReviewLink_(uploadId) {
    var base = PropertiesService.getScriptProperties().getProperty('PORTAL_BASE_URL') || '';
    if (!base) return '';
    var sep = base.indexOf('?') === -1 ? '?' : '&';
    return base + sep + 'page=review-sop&uploadId=' + encodeURIComponent(uploadId) +
      '&token=' + encodeURIComponent(tokenForUpload(uploadId));
  }

  // ──────────────────────────────────────────────────────────
  // publishUpload — publishes the linked DIM_SOP_TEMPLATES draft
  // via the existing, unmodified SopAdminEngine.publishTemplate,
  // then marks the upload PUBLISHED.
  // ──────────────────────────────────────────────────────────
  function publishUpload(actorEmail, uploadId) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.SOP_UPLOAD);

    var row = getUploadRow_(uploadId);
    if (row.status === 'PUBLISHED') {
      throw SopUploadError_('SOP_UPLOAD_ALREADY_PUBLISHED', 'This upload has already been published.', { uploadId: uploadId });
    }
    if (!row.resulting_template_id) {
      throw SopUploadError_('SOP_UPLOAD_NOT_STRUCTURED', 'This upload has not been structured into a template yet.', { uploadId: uploadId });
    }

    SopAdminEngine.publishTemplate(actorEmail, row.resulting_template_id);

    DAL.updateWhere(Config.TABLES.DIM_SOP_UPLOADS,
      { upload_id: uploadId }, { status: 'PUBLISHED' }, { callerModule: MODULE });

    Logger.info('SOP_UPLOAD_PUBLISHED', { module: MODULE, uploadId: uploadId, templateId: row.resulting_template_id });
    return { uploadId: uploadId, status: 'PUBLISHED' };
  }
```

Update the `return { ... }` block to also export `markDraftReady`,
`listPendingUploads`, and `publishUpload`.

- [ ] **Step 2: Add portal wrappers**

Add to `src/07-portal/Portal.gs`:

```javascript
/**
 * Lists all non-published, non-rejected SOP uploads with their draft
 * status, review link, and any manager feedback so far. CEO only.
 *
 * @param {string} ptoken
 * @returns {string} JSON array
 */
function portal_getPendingSopUploads(ptoken) {
  var email = PortalAuth.resolveEmail(ptoken);
  return JSON.stringify(SopUploadEngine.listPendingUploads(email));
}

/**
 * Publishes a structured SOP upload's underlying template. CEO only.
 *
 * @param {string} ptoken
 * @param {string} uploadId
 * @returns {string} JSON: { uploadId, status }
 */
function portal_publishSopUpload(ptoken, uploadId) {
  var email = PortalAuth.resolveEmail(ptoken);
  return JSON.stringify(SopUploadEngine.publishUpload(email, uploadId));
}
```

- [ ] **Step 3: Add the publish screen to the portal UI**

In `src/07-portal/PortalView.html`, in the same CEO-only area as the
upload form from Task 1, add a "Pending SOP Uploads" list: on load (or
on a refresh button), call `portal_getPendingSopUploads(ptoken)` and
render each upload's client/product/doc-type/status, its manager
feedback (reviewer name, verdict, comment, submitted date) if any, its
review link (as a copyable text field, when `status === 'DRAFT_READY'`)
labelled "Share this link with managers," and a "Publish" button
(enabled only when `status === 'DRAFT_READY'`) calling
`portal_publishSopUpload(ptoken, uploadId)`. On success, remove the row
or mark it Published; on failure show the error message inline.

- [ ] **Step 4: Add publish tests**

`SopAdminEngine.createTemplate` throws `SOP_ACTIVE_TEMPLATE_EXISTS` if an
ACTIVE template already exists for the same `clientCode` + `scopeCode` —
and `thCleanupTestArtifacts_()` only voids test jobs, it does not retire
SOP templates. Without handling this, these tests would pass once and
then fail on every subsequent run (violates Rule T3 — tests must be
idempotent). Add this helper first, and call it before each
`createTemplate` call below — this keeps every test on the single
approved `TEST-CLIENT` code (per `.claude/rules/testing-policy.md`)
rather than reproducing `SopAdminTests.gs`'s older `'TEST-' + suffix`
pattern, which predates that policy and should not be copied into new
test files.

Add to `src/setup/SopUploadEngineTest.gs`:

```javascript
// Retires any pre-existing ACTIVE template for this client+scope so
// createTemplate() can run again on a repeat test run (Rule T3).
function thRetireActiveSopTemplateIfAny_(clientCode, scopeCode) {
  var existing = SopDAL.findActiveTemplateForJob(clientCode, scopeCode);
  if (existing) {
    SopAdminEngine.retireTemplate(TH_CEO_EMAIL, existing.sop_template_id);
  }
}

function testSopUpload_publish_happyPath() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    thRetireActiveSopTemplateIfAny_(TH_SOP_UPLOAD_CLIENT, Config.PRODUCT_CODES.TRUSS);
    var template = SopAdminEngine.createTemplate(TH_CEO_EMAIL, {
      clientCode: TH_SOP_UPLOAD_CLIENT, jobType: Config.PRODUCT_LABELS.TRUSS,
      software: 'TestSoftware', scopeCode: Config.PRODUCT_CODES.TRUSS
    });
    SopAdminEngine.addItem(TH_CEO_EMAIL, template.sopTemplateId, {
      item_code: 'TEST_ITEM_1', item_label: 'Test item', is_required: 'TRUE'
    });

    var blob = Utilities.newBlob('x', 'text/plain', 'x.txt');
    var upload = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_SOP_UPLOAD_CLIENT, productCode: Config.PRODUCT_CODES.TRUSS,
      docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
    });
    SopUploadEngine.markDraftReady(upload.uploadId, template.sopTemplateId, 'test notes');

    var result = SopUploadEngine.publishUpload(TH_CEO_EMAIL, upload.uploadId);
    assertH_(results, counters, 'publishUpload returns PUBLISHED', result.status === 'PUBLISHED', result.status);

    var rows = DAL.readWhere(Config.TABLES.DIM_SOP_UPLOADS, { upload_id: upload.uploadId });
    assertH_(results, counters, 'DIM_SOP_UPLOADS row shows PUBLISHED', rows[0].status === 'PUBLISHED', rows[0].status);

    var templateRow = SopDAL.getTemplateById(template.sopTemplateId);
    assertH_(results, counters, 'Underlying template is ACTIVE', templateRow.status === 'ACTIVE', templateRow.status);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_publish_rbacDenial() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var threw = false;
    try {
      SopUploadEngine.listPendingUploads(TH_DESIGNER_EMAIL);
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Non-CEO listPendingUploads rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_publish_notStructured() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    var blob = Utilities.newBlob('x', 'text/plain', 'x.txt');
    var upload = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_SOP_UPLOAD_CLIENT, productCode: Config.PRODUCT_CODES.TRUSS,
      docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
    });
    var threw = false;
    try {
      SopUploadEngine.publishUpload(TH_CEO_EMAIL, upload.uploadId);
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Publishing a not-yet-structured upload rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}

function testSopUpload_publish_doublePublish() {
  var results = [], counters = { passed: 0, failed: 0 };
  try {
    thRetireActiveSopTemplateIfAny_(TH_SOP_UPLOAD_CLIENT, Config.PRODUCT_CODES.OPEN_WOOD_FLOOR);
    var template = SopAdminEngine.createTemplate(TH_CEO_EMAIL, {
      clientCode: TH_SOP_UPLOAD_CLIENT, jobType: Config.PRODUCT_LABELS.OPEN_WOOD_FLOOR,
      software: 'TestSoftware', scopeCode: Config.PRODUCT_CODES.OPEN_WOOD_FLOOR
    });
    SopAdminEngine.addItem(TH_CEO_EMAIL, template.sopTemplateId, {
      item_code: 'TEST_ITEM_2', item_label: 'Test item 2', is_required: 'TRUE'
    });
    var blob = Utilities.newBlob('x', 'text/plain', 'x.txt');
    var upload = SopUploadEngine.createUpload(TH_CEO_EMAIL, {
      clientCode: TH_SOP_UPLOAD_CLIENT, productCode: Config.PRODUCT_CODES.OPEN_WOOD_FLOOR,
      docType: 'DESIGNER_SOP', fileBlob: blob, fileName: 'x.txt'
    });
    SopUploadEngine.markDraftReady(upload.uploadId, template.sopTemplateId, '');
    SopUploadEngine.publishUpload(TH_CEO_EMAIL, upload.uploadId);

    var threw = false;
    try {
      SopUploadEngine.publishUpload(TH_CEO_EMAIL, upload.uploadId);
    } catch (e) { threw = true; }
    assertH_(results, counters, 'Second publish rejected', threw, 'threw=' + threw);
  } catch (e) {
    results.push('  FAIL: unexpected exception — ' + e.message);
    counters.failed++;
  }
  results.forEach(function (r) { console.log(r); });
  return counters;
}
```

Add all four to `runSopUploadEngineTests()`'s `tests` array. Verify
`SopAdminEngine.createTemplate`'s and `SopAdminEngine.addItem`'s exact
parameter names against `src/13-sop/SopAdminEngine.gs` before running —
the plan reproduces them from that file's current source, but check for
drift if the file has changed since this plan was written.

- [ ] **Step 5: Commit**

```bash
git add src/13-sop/SopUploadEngine.gs src/07-portal/Portal.gs \
  src/07-portal/PortalView.html src/setup/SopUploadEngineTest.gs
git commit -m "feat: CEO publish screen for structured SOP uploads"
```

---

### Task 4: Session close-out

**Files:**
- Modify: `SESSION_LOG.md`
- Modify: `CTO_TASK_QUEUE.md`
- Modify: `PROJECT_MEMORY.md`

**Interfaces:**
- Consumes: nothing new — this task only documents Tasks 1-3's output.

- [ ] **Step 1: Update `SESSION_LOG.md`**

Add a dated entry summarizing: the SOP upload workflow was implemented
(3 tasks — upload endpoint, manager review link, CEO publish screen),
what got built, and the two deploy prerequisites below.

- [ ] **Step 2: Update `CTO_TASK_QUEUE.md`**

Add an entry noting: implementation complete, NOT yet merged/deployed,
GAS test suite (`runSopUploadEngineTests`) verified by manual code trace
only in this environment (same caveat as every prior GAS feature built
in a session without a live Apps Script editor) — needs a live DEV run
before this is trusted, following the exact same process used for the
QC-findings-picker feature (push to DEV, run the suite from the editor's
function picker, fix anything that only surfaces at runtime). Also note
explicitly: **`runSetupSchemas()` must be run once in the DEV Apps Script
editor after the first push** to actually create the `DIM_SOP_UPLOADS`
and `FACT_SOP_REVIEW_FEEDBACK` tabs — this is a deploy prerequisite, not
automatic. Also note: **`runGenerateSopReviewSecret()` must be run once**
before any review link will work — until then `tokenForUpload` throws.
Also note the QC-review-SOP backend (`QcProcessAdminEngine`) remains
unbuilt — `doc_type: QC_REVIEW_SOP` uploads can be created and reviewed
by managers, but `markDraftReady`/`publishUpload` have nothing to link to
until that engine exists.

- [ ] **Step 3: Update `PROJECT_MEMORY.md`**

Add: a Known Risks entry for the two deploy prerequisites above (schema
setup, review secret generation); a Decisions Made entry recording that
`DIM_SOP_TEMPLATES.scope_code` was confirmed (not assumed) to already be
the product-matching field via direct reading of `SopGate.evaluate_()`,
correcting an earlier wrong assumption in this plan's own design spec —
worth recording so a future session doesn't repeat the same
misunderstanding.

- [ ] **Step 4: Commit**

```bash
git add SESSION_LOG.md CTO_TASK_QUEUE.md PROJECT_MEMORY.md
git commit -m "docs: close out SOP upload workflow implementation"
```
