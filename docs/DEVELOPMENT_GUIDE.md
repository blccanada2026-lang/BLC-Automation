# BLC Nexus — Development Guide

## Prerequisites
- Google account with access to the BLC spreadsheet
- Node.js 18+ (for clasp)
- `npm install -g @google/clasp`
- `clasp login` (authenticate with Google)

## Environment Setup

### 1. Configure Environment
Edit `config/environments/dev.json` and replace:
- `REPLACE_WITH_DEV_SPREADSHEET_ID` → your DEV spreadsheet ID

### 2. Configure clasp
Edit `.clasp.json` and replace:
- `REPLACE_WITH_APPS_SCRIPT_SCRIPT_ID` → your Apps Script project ID

### 3. First Deployment
```
clasp push
```
Then in Apps Script editor, run these functions in order:
1. `createAllSheets()` — creates all sheet tabs
2. `applyAllProtections()` — locks sensitive sheets
3. `seedReferenceData()` — populates DIM tables with initial data
4. `installAllTriggers()` — sets up time-based and form triggers
5. `recordVersion()` — logs v3.0.0 deployment

## Adding a New Module

### Step 1: Plan with Architect Agent
Run `/build-module <name>` and answer the architect's questions about:
- Which tier does this module belong in?
- What tables does it read/write?
- What other modules does it depend on?
- What RBAC permissions are needed?

### Step 2: Define Schema (if new tables needed)
Add to the appropriate `config/schemas/*.json` file.
Run `/validate-schema` to verify compliance.

### Step 3: Update Write Guards
Add entries to `config/rbac/write-guards.json` for any new tables this module writes.

### Step 4: Update RBAC Permissions
Add new permissions to `config/rbac/permissions.json` if this module introduces new operations.

### Step 5: Create the Source File
Place in the correct `src/<tier>-<module>/` directory.
Follow the handler pattern from `backend.md` agent.

### Step 6: Generate Tests
Run `/generate-tests <module>` to create test stubs.
Implement all 4 required test cases.

### Step 7: Review
Run `/review-architecture <module>` and fix any violations.
Run `/audit-security <module>` and fix any gaps.

## Adding a New Handler

Handler skeleton (copy and fill in):
```javascript
/**
 * Handle [event type] events from the processing queue.
 * @param {Object} payload - Parsed form payload
 * @param {string} actorCode - PersonCode of actor
 * @param {string} submissionId - Idempotency key
 * @returns {Object} { success: boolean, error?: string }
 */
MyHandler.prototype.handle = function(payload, actorCode, submissionId) {
  var logger = getLogger();
  try {
    // 1. RBAC enforcement
    var rbac = getRBAC();
    rbac.enforcePermission(actorCode, 'MY_PERMISSION');

    // 2. Validate fields
    var validation = getValidationEngine();
    var fieldResult = validation.validateFields(payload, REQUIRED_FIELDS);
    if (!fieldResult.success) return fieldResult;

    // 3. Validate business rules
    var ruleResult = validation.validateBusinessRules(payload);
    if (!ruleResult.success) return ruleResult;

    // 4. Idempotency check
    var idempotency = getIdempotencyEngine();
    if (idempotency.isDuplicate(submissionId)) {
      return { success: true, detail: { skipped: true, reason: 'duplicate' } };
    }

    // 5. Write to fact table via DAL
    var dal = getDAL();
    dal.appendRow(SHEETS.FACT_MY_TABLE, { /* row data */ });

    // 6. Update state view if needed
    // dal.updateWhere(SHEETS.VW_JOB_CURRENT_STATE, ...)

    // 7. Log success
    logger.info('MY_HANDLER', actorCode, 'MY_ACTION', payload.jobId, 'Success');

    idempotency.mark(submissionId);
    return { success: true };

  } catch(e) {
    logger.error('MY_HANDLER', actorCode, 'MY_ACTION', payload.jobId, e.message);
    return { success: false, error: e.message };
  }
};
```

## Adding a New Table

1. Add schema definition to the appropriate `config/schemas/*.json`
2. Add sheet name constant to `src/00-foundation/Constants.gs` SHEETS object
3. Add write guard entry to `config/rbac/write-guards.json`
4. Add sheet creation logic to `src/setup/SheetCreator.gs`
5. Add DAL methods if complex queries needed
6. Run `/validate-schema <table>` to verify

## Code Review Checklist
- [ ] File in correct src/ tier directory
- [ ] No SpreadsheetApp calls outside DAL.gs
- [ ] All handlers have try/catch
- [ ] All handlers call enforcePermission() first
- [ ] All new IDs use generateId()
- [ ] All logging uses getLogger(), not Logger.log
- [ ] HealthMonitor.isApproachingLimit() checked in loops
- [ ] All public functions have JSDoc
- [ ] No hardcoded sheet names (use SHEETS constant)
- [ ] No hardcoded role names (use roles from config)
- [ ] Tests written and passing
- [ ] CHANGELOG.md updated
