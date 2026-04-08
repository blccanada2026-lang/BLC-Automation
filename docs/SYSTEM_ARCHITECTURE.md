# BLC Nexus — System Architecture

## System Layers

### T0: Foundation
- **Config.gs** — environment detection, spreadsheet binding, version constant
- **Constants.gs** — SHEETS map (sheet name constants), FORM_TYPES, EVENT_TYPES
- **Identifiers.gs** — generateId(), generateJobId(), generatePeriodId()

### T1: Data Access Layer (DAL)
- **DAL.gs** — all SpreadsheetApp interactions; getRows(), appendRow(), updateWhere()
- **WriteGuard.gs** — enforces WRITE_PERMISSIONS matrix; blocks unauthorized module writes
- **CacheManager.gs** — CacheService wrapper; getOrSet(), invalidate()
- **BatchOperations.gs** — appendRows() for bulk fact writes; reduces API calls

### T2: Security
- **RBAC.gs** — enforcePermission(), enforceFinancialAccess(), hasPermission()
- **ActorResolver.gs** — resolves submitter email → PersonCode + role from DIM_STAFF_ROSTER
- **ScopeFilter.gs** — filters query results by role scope (SELF/TEAM/ACCOUNTS/ALL)

### T3: Infrastructure
- **Logger.gs** — structured logging to _SYS_LOGS; levels: DEBUG/INFO/WARN/ERROR
- **IdempotencyEngine.gs** — checkAndMark() using source_submission_id
- **HealthMonitor.gs** — isApproachingLimit(), getExecutionTimeMs(), queue depth checks
- **ErrorHandler.gs** — standardized error routing to _SYS_EXCEPTIONS and dead letter queue
- **NotificationService.gs** — Gmail-based notifications for critical events

### T4: Validation
- **ValidationEngine.gs** — orchestrates field + business rule validation
- **FieldValidators.gs** — required field checks, type validation, format validation
- **BusinessRuleValidator.gs** — domain-specific rules (rate lookups, period checks)
- **SOPEnforcer.gs** — SOP checklist validation before QC approval

### T5: Queue
- **QueueProcessor.gs** — time-triggered; dequeues and routes to handlers
- **IntakeService.gs** — onFormSubmit handler; writes to STG_RAW_INTAKE and STG_PROCESSING_QUEUE
- **RetryManager.gs** — exponential backoff retry for failed queue items
- **DeadLetterHandler.gs** — moves permanently failed items to DEAD_LETTER_QUEUE

### T6: Job Lifecycle
- **StateMachine.gs** — validateTransition(), getAllowedTransitions(), transition()
- **JobCreateHandler.gs** — processes JOB_CREATE form submissions
- **JobStartHandler.gs** — processes JOB_START events
- **JobHoldHandler.gs** — processes JOB_HOLD/JOB_RESUME events
- **ClientReturnHandler.gs** — processes CLIENT_RETURN events
- **EventReplayEngine.gs** — replays FACT_JOB_EVENTS to rebuild VW_JOB_CURRENT_STATE

### T7–T13: Business Logic Modules
See module map in README.md.

## Data Flow Diagrams

### Job Creation Flow
```
Google Form Submit
  → IntakeService.onFormSubmit()
  → STG_RAW_INTAKE (raw JSON stored)
  → STG_PROCESSING_QUEUE (status: PENDING)
  → QueueProcessor (every 3-5 min)
  → JobCreateHandler.handle()
    → RBAC.enforcePermission('JOB_CREATE')
    → ValidationEngine.validate()
    → IdempotencyEngine.checkAndMark()
    → DAL.appendRow('FACT_JOB_EVENTS', event)
    → DAL.appendRow('VW_JOB_CURRENT_STATE', projection)
    → Logger.info('JOB_CREATED', ...)
  → STG_PROCESSING_QUEUE (status: COMPLETED)
```

### Payroll Run Flow
```
CEO/PM triggers PayrollEngine.runPayroll(periodId)
  → RBAC.enforcePermission('PAYROLL_RUN')
  → RBAC.enforceFinancialAccess()
  → IdempotencyEngine.checkAndMark()
  → PeriodSlicer.getHoursForPeriod()
  → PayrollBatchProcessor.processInChunks(20)
    → RateResolver.getEffectiveRate(personCode, date)
    → DAL.appendRow('FACT_PAYROLL_LEDGER', record)
    → HealthMonitor.isApproachingLimit() check
  → SupervisorBonusCalculator.calculate()
  → MART_PAYROLL_SUMMARY updated
```

## Module Dependency Matrix
| Module | Depends On |
|--------|-----------|
| Config | (none — foundation) |
| DAL | Config, Constants |
| RBAC | DAL, Config |
| Logger | DAL, Config |
| ValidationEngine | DAL, Config, FieldValidators, BusinessRuleValidator |
| QueueProcessor | DAL, RBAC, Logger, IdempotencyEngine, all Handlers |
| JobCreateHandler | DAL, RBAC, Logger, ValidationEngine, StateMachine, IdempotencyEngine |
| BillingEngine | DAL, RBAC, Logger, ValidationEngine, PeriodSlicer, BillingRuleResolver |
| PayrollEngine | DAL, RBAC, Logger, ValidationEngine, RateResolver, PayrollBatchProcessor |

## State Machine

### Job States
```
INTAKE_RECEIVED → ALLOCATED → IN_PROGRESS → QC_REVIEW → COMPLETED_BILLABLE → INVOICED
                                    ↕              ↕
                                 ON_HOLD       IN_PROGRESS (rework)
                                    ↕
                             CLIENT_RETURN
```

### Terminal States
- **INVOICED** — no further transitions allowed; row is immutable

### Special Rules
- **ON_HOLD** — stores prev_state to route correctly on resume
- **CLIENT_RETURN** — increments client_return_count, requires reason
- **QC_REVIEW** — requires completed SOP checklist submission

## Queue Processing Flow
```
Every 3-5 minutes:
1. QueueProcessor acquires LockService lock (30s timeout)
2. Reads up to BATCH_SIZE=20 PENDING rows from STG_PROCESSING_QUEUE
3. For each item:
   a. Mark status = PROCESSING
   b. Route to handler by form_type
   c. Handler returns { success, error }
   d. On success: mark COMPLETED
   e. On failure: increment attempt_count
      - attempt_count < 3: mark PENDING (retry)
      - attempt_count >= 3: mark DEAD_LETTER, call DeadLetterHandler
4. Check HealthMonitor.isApproachingLimit() after each batch
5. Release lock
```

## RBAC Enforcement Points
1. **Write Guard** (DAL layer) — checks WRITE_PERMISSIONS matrix by calling module name
2. **Permission Check** (handler layer) — enforcePermission(action) before any processing
3. **Scope Filter** (query layer) — ScopeFilter.apply() on all data reads

## Partitioning Strategy
- Fact tables: one sheet tab per period (e.g., `FACT_JOB_EVENTS|2026-03`)
- Archive: periods older than 2 months moved to archive tabs
- Views/Marts: single tab, replaced on each refresh
- Reference/DIM tables: single tab, effective-dated rows
