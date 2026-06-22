# Architecture — BLC Nexus

## Core Pattern
**Event-driven, queue-based, append-only facts.**
```
Portal Submit → STG_PROCESSING_QUEUE → Handler → FACT Table → View Projection
```
All job state is derived from events. VW_JOB_CURRENT_STATE is a projection, not source of truth.

---

## File Load Order (deployment)
1. Config.gs → Constants.gs → Identifiers.gs
2. DAL.gs → WriteGuard.gs → CacheManager.gs → BatchOperations.gs
3. RBAC.gs → ActorResolver.gs → ScopeFilter.gs
4. Logger.gs → IdempotencyEngine.gs → HealthMonitor.gs → ErrorHandler.gs → NotificationService.gs
5. ValidationEngine.gs → FieldValidators.gs → BusinessRuleValidator.gs → SOPEnforcer.gs
6. QueueProcessor.gs → IntakeService.gs → RetryManager.gs → DeadLetterHandler.gs
7. StateMachine.gs → all job lifecycle handlers
8. All business logic modules (07–11)
9. MigrationEngine.gs and related (12)
10. AdminConsole.gs → ConfigManager.gs → ArchivalService.gs (13)
11. Setup files last (SheetCreator, ProtectionApplier, TriggerManager, SeedData, VersionRecorder)
12. Tests: DEV environment only

---

## Module Map
| # | Module | Path |
|---|---|---|
| T8 | Staff Onboarding | src/08-staff/StaffOnboarding.gs |
| T9 | Client Feedback | src/09-feedback/ClientFeedback.gs + ClientFeedbackTrigger.gs |

---

## Key Tables
| Table | Type | Notes |
|---|---|---|
| FACT_WORK_LOGS | Fact (append-only) | Source of truth for hours |
| FACT_PAYROLL_LEDGER | Fact (append-only) | All payroll events |
| FACT_CLIENT_FEEDBACK | Fact (append-only) | Feedback responses |
| FACT_PERFORMANCE_RATINGS | Fact (append-only) | TL/PM/CEO ratings |
| FACT_QC_EVENTS | Fact (append-only) | QC rework cycles |
| FACT_QUARTERLY_BONUS | Fact (append-only) | Quarterly bonus records |
| DIM_STAFF_ROSTER | Dimension | Staff profiles + rates |
| DIM_STAFF_BANKING | Dimension | OFX banking fields |
| DIM_STAFF_CONTRACTS | Dimension | Contract metadata |
| DIM_CLIENT_MASTER | Dimension | Client profiles |
| DIM_CLIENT_RATES | Dimension | Billing rates per client |
| DIM_FX_RATES | Dimension | Currency conversion rates |
| REF_ACCOUNT_DESIGNER_MAP | Reference | Designer→client assignments |
| STG_PROCESSING_QUEUE | Staging | Async write queue |
| STG_STAFF_IMPORT | Staging | Bulk staff import sheet |
| VW_JOB_CURRENT_STATE | View | Derived projection only — not source of truth |
