---
name: core_rules
description: Non-negotiable architectural rules for BLC Nexus. Enforced before any code generation. All rules map to src/ module responsibilities.
enforced: true
---

# BLC Nexus — Core Rules

These rules are enforced on every coding action. They exist because violations have caused data loss, audit failures, or quota crashes in previous versions (V1/V2). There are no exceptions.

---

## RULE A1 — Architecture First
**Before writing any code, confirm which src/ module (T0–T13) it belongs to.**

Every file belongs to exactly one module. If it spans multiple modules, decompose it.
Reference: `docs/SYSTEM_ARCHITECTURE.md` → Module Dependency Matrix.

---

## RULE A2 — Never Bypass DAL
**ALL sheet access through `getDAL()` — never SpreadsheetApp directly.**

```javascript
// FORBIDDEN — anywhere outside src/01-dal/
SpreadsheetApp.getActiveSpreadsheet().getSheetByName('FACT_JOB_EVENTS')

// REQUIRED — everywhere
DAL.appendRow('FACT_JOB_EVENTS', row)
DAL.getRows('DIM_STAFF_ROSTER', filters)
DAL.updateWhere('STG_PROCESSING_QUEUE', { status: 'COMPLETED' }, { id: item.id })
```

Why: WriteGuard, CacheManager, and BatchOperations run inside DAL. Bypassing DAL bypasses all write protection, caching, and quota management.

---

## RULE A3 — All Form Submissions Through Queue
**ALL form submissions → STG_RAW_INTAKE → STG_PROCESSING_QUEUE → handler.**

```javascript
// FORBIDDEN — direct handler call from trigger
function onFormSubmit(e) {
  JobCreateHandler.handle(e.values);  // WRONG
}

// REQUIRED — queue all submissions
function onFormSubmit(e) {
  IntakeService.receive(e);  // writes to STG_RAW_INTAKE and STG_PROCESSING_QUEUE
}
// QueueProcessor picks up and routes to handler every 3-5 min
```

Why: Synchronous form triggers timeout at 30s. Queue decouples intake from processing and provides retry, dead-letter, and idempotency guarantees.

---

## RULE A4 — Validation Before Every FACT Write
**ALWAYS call ValidationEngine.validate() before writing to any FACT table.**

```javascript
// REQUIRED — every handler before DAL.appendRow on FACT tables
var result = ValidationEngine.validate('JOB_CREATE', payload);
if (!result.valid) {
  return { success: false, errors: result.errors };
}
// Only reach DAL.appendRow if validation passes
DAL.appendRow('FACT_JOB_EVENTS', event);
```

Reference: `src/04-validation/ValidationEngine.gs`

---

## RULE A5 — FACT Tables Are Append-Only
**NEVER update or delete rows in FACT tables. Corrections are new events.**

```javascript
// FORBIDDEN
DAL.updateWhere('FACT_JOB_EVENTS', { hours: 8 }, { job_id: 'BLC-001' });
DAL.deleteRow('FACT_WORK_LOGS', { id: 'WL-001' });

// REQUIRED — create an amendment event
DAL.appendRow('FACT_WORK_LOGS', {
  event_id:       Identifiers.generateId(),
  event_type:     'WORK_LOG_AMENDED',
  amendment_of:   'WL-001',
  hours_corrected: 8,
  reason:          'Data entry error',
  created_by:      actor.person_code
});
```

Why: FACT tables are the audit trail. Modifying them destroys the event history that drives VW_JOB_CURRENT_STATE and all financial calculations.

---

## RULE S1 — RBAC on Every Operation
**RBAC.enforcePermission() must be the FIRST call in every handler.**

```javascript
// REQUIRED — first line, no exceptions
function handle(queueItem) {
  var actor = ActorResolver.resolve(queueItem.submitter_email);
  RBAC.enforcePermission(actor, 'JOB_CREATE');  // ← FIRST

  // Only continue if RBAC passes
  var validation = ValidationEngine.validate(...);
  // ...
}
```

Financial operations require an additional guard:
```javascript
RBAC.enforcePermission(actor, 'PAYROLL_RUN');
RBAC.enforceFinancialAccess(actor);  // CEO-only gate
```

Reference: `src/02-security/RBAC.gs`, `config/rbac/`

---

## RULE D1 — Idempotency Before Every FACT Write
**IdempotencyEngine.checkAndMark() must be called before every FACT table write.**

```javascript
// REQUIRED — before any DAL.appendRow on FACT tables
if (!IdempotencyEngine.checkAndMark(queueItem.source_submission_id)) {
  Logger.info('DUPLICATE_SUBMISSION', { id: queueItem.source_submission_id });
  return { success: true };  // already processed — return success silently
}
// Only reach here if this is the first time processing this submission
DAL.appendRow('FACT_JOB_EVENTS', event);
```

Why: Form triggers can fire multiple times for a single submission. Without idempotency, duplicate FACT rows corrupt every downstream calculation.

---

## RULE D2 — All Logging Through Logger
**ALWAYS use Logger.gs for all logging. Never use console.log() or Logger.log() directly.**

```javascript
// FORBIDDEN
Logger.log('Job created: ' + jobId);
console.log(jobId);

// REQUIRED
Logger.info('JOB_CREATED',  { job_id: jobId, actor: actor.person_code });
Logger.warn('QUOTA_WARN',   { elapsed_ms: HealthMonitor.getExecutionTimeMs() });
Logger.error('HANDLER_FAIL',{ error: e.message, context: 'JobCreateHandler' });
```

Levels: DEBUG (dev only) | INFO (significant events) | WARN (degraded state) | ERROR (failures)
All logs persist to `_SYS_LOGS` via DAL.

---

## RULE P1 — Quota Guard in All Loops
**Check HealthMonitor.isApproachingLimit() inside any loop processing more than 20 records.**

```javascript
// REQUIRED in any batch processing loop
for (var i = 0; i < records.length; i++) {
  if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
    Logger.warn('QUOTA_CUTOFF', { processed: i, total: records.length });
    return { partial: true, resumeFrom: i };
  }
  processRecord(records[i]);
}
```

Reference: `src/03-infrastructure/HealthMonitor.gs`

---

## RULE P2 — Batch Writes
**Use BatchOperations.appendRows() for any write of more than 1 row.**

```javascript
// FORBIDDEN for bulk writes
rows.forEach(function(r) { DAL.appendRow('FACT_TABLE', r); });

// REQUIRED
BatchOperations.appendRows('FACT_TABLE', rows);  // single API call
```

Reference: `src/01-dal/BatchOperations.gs`

---

## RULE X — No Business Logic Outside Handlers
**ALL business logic must live inside handlers or engines. Never in utilities, scripts, or helpers.**

```
ALLOWED locations for business logic:
  src/06-job-lifecycle/*Handler.gs
  src/07-work-log/*Engine.gs
  src/08-qc/*Engine.gs
  src/09-billing/*Engine.gs
  src/10-payroll/*Engine.gs
  src/11-reporting/*Engine.gs
  src/12-migration/*Engine.gs
  src/13-admin/*Engine.gs

FORBIDDEN locations for business logic:
  src/00-foundation/   → config and constants only
  src/01-dal/          → data access only — no decisions
  src/02-security/     → RBAC checks only — no business rules
  src/03-infrastructure/ → logging, health, errors only
  src/04-validation/   → validation rules only — no processing
  Any *Utils.gs, *Helper.gs, or *Script.gs file
```

Why: Business logic in utilities cannot be replayed by EventReplayEngine, cannot be audited through the standard log path, and breaks the handler → FACT → view projection chain.

---

## RULE Y — Failure Stops the System
**If any test fails: STOP. Fix the root cause. Do not proceed to the next module.**

```
Required state before moving to next module:
  ✅ All unit tests pass (zero failures)
  ✅ All integration tests pass (zero failures)
  ✅ No known test skipped or commented out

FORBIDDEN:
  ❌ Moving to Module N+1 while Module N has a failing test
  ❌ Marking a test as "known issue" and continuing
  ❌ Deploying to STAGING with any red test
  ❌ Fixing symptoms without fixing root cause
```

Why: In an event-driven system, a handler that has a failing test will corrupt FACT tables when it fires in production. A corrupted FACT table cannot be corrected — only amended. Preventing bad writes is always cheaper than reconciling them.

---

## RULE Z — Always Use Queue and DAL
**All writes must go through DAL. All async processing must go through the queue. Direct writes are forbidden.**

```javascript
// FORBIDDEN — direct write bypassing DAL
var ss = SpreadsheetApp.getActiveSpreadsheet();
ss.getSheetByName('FACT_JOB_EVENTS').appendRow([...]);

// FORBIDDEN — calling handler directly, bypassing queue
function onFormSubmit(e) {
  JobCreateHandler.handle(e.values);
}

// REQUIRED — all writes through DAL
DAL.appendRow('FACT_JOB_EVENTS', eventRow);
BatchOperations.appendRows('FACT_JOB_EVENTS', eventRows);

// REQUIRED — all async processing through queue
function onFormSubmit(e) {
  IntakeService.receive(e);  // → STG_RAW_INTAKE → STG_PROCESSING_QUEUE
}
// QueueProcessor routes to handler on next trigger cycle
```

Why: DAL runs WriteGuard (access control), CacheManager (quota), and BatchOperations (efficiency). Bypassing it bypasses all three. Queue bypass removes retry, dead-letter, and idempotency guarantees — a single trigger timeout would silently drop data.

---

## Summary Table
| Rule | What it protects | Module |
|------|-----------------|--------|
| A1 | Module boundaries | All |
| A2 | Sheet access isolation | src/01-dal |
| A3 | Queue integrity | src/05-queue |
| A4 | Data quality | src/04-validation |
| A5 | Audit trail / FACT immutability | src/01-dal |
| S1 | Access control | src/02-security |
| D1 | Duplicate prevention | src/03-infrastructure |
| D2 | Observability | src/03-infrastructure |
| P1 | Quota protection | src/03-infrastructure |
| P2 | Quota protection (writes) | src/01-dal |
| X  | Business logic containment | src/06–13 handlers/engines |
| Y  | Test gate / no partial progress | tests/ |
| Z  | Write path integrity (DAL + queue) | src/01-dal, src/05-queue |
