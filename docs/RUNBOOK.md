# BLC Nexus — Operations Runbook

## Daily Operations

### Morning Health Check
Run `/health-check` and verify all metrics are GREEN:
- Queue backlog < 10 items
- Error queue = 0
- Dead letter queue = 0
- All triggers active

### Monitoring Queue Depth
Check STG_PROCESSING_QUEUE sheet. Filter by status=PENDING.
Normal: < 10 items pending
Warning: 10-50 items pending (trigger may be delayed)
Critical: > 50 items or items older than 15 minutes

---

## Incident Resolution

### Queue Stuck — Items Not Processing

**Symptoms:** Items in STG_PROCESSING_QUEUE with status=PENDING and created_at > 10 minutes ago

**Investigation:**
1. Check _SYS_LOGS for ERROR entries in QueueProcessor
2. Check Apps Script execution log for trigger failures
3. Check if LockService is stuck (rare — auto-releases after 30s)

**Resolution:**
1. In Apps Script editor, manually run `processQueue()` to test
2. If it errors, check _SYS_EXCEPTIONS for details
3. If trigger is missing, run `installAllTriggers()` in TriggerManager.gs
4. If items are stuck in PROCESSING status (crashed mid-run), run `resetStuckItems()` in QueueProcessor

### Failed Processing — Items in DEAD_LETTER_QUEUE

**Symptoms:** Items in STG_PROCESSING_QUEUE with status=DEAD_LETTER or entries in DEAD_LETTER_QUEUE sheet

**Investigation:**
1. Check error_message column on the failed queue item
2. Check _SYS_EXCEPTIONS for the exception with matching submission_id
3. Identify root cause: validation failure, RBAC denial, data integrity issue

**Resolution (validation/data issue):**
1. Do NOT delete the dead letter item
2. Correct the source data if needed
3. Create a corrected payload manually
4. Call the appropriate handler directly with the corrected payload
5. Mark the dead letter item as RESOLVED with a note

**Resolution (code bug):**
1. Fix the bug in the handler
2. Deploy the fix
3. Re-queue the dead letter item by setting status=PENDING and attempt_count=0
4. Monitor processing

### Performance Degradation

**Symptoms:** Queue processing taking > 5 minutes per batch, or execution timeouts

**Investigation:**
1. Check MART_DASHBOARD — look for unusually high row counts
2. Check fact table sheet tabs — are they approaching 10K rows?
3. Check _SYS_LOGS for WARN entries from HealthMonitor

**Resolution:**
1. Run `ArchivalService.archiveOldPeriods()` to move old data to archive tabs
2. If DIM table lookups are slow, run `CacheManager.warmCache()` to pre-populate cache
3. Reduce BATCH_SIZE in config if timeouts persist

---

## Data Operations

### Emergency Rollback

**Situation:** Bad data written to fact tables due to a bug

**Note:** Fact tables are append-only. Rollback = append a correction event.

**Steps:**
1. Identify the bad rows (search by source_submission_id or time range)
2. For job events: append a CORRECTION event with the correct state
3. For work logs: append a VOID entry with negative hours matching the bad entry, plus a correct entry
4. For billing: append a credit note entry to FACT_BILLING_LEDGER
5. For payroll: append a PAYROLL_ADJUSTMENT entry
6. Run EventReplayEngine to refresh VW_JOB_CURRENT_STATE

**NEVER:**
- Delete rows from fact tables
- Edit existing fact table rows
- Truncate staging tables that have processed items

### Data Correction via Adjustment Events

For correcting work hours:
```
Original entry: person_code=SGO, job=SBS-001-A-1, hours=8, type=DESIGN
Bad hours discovered (should be 6)

Correction sequence:
1. Append VOID: person_code=SGO, job=SBS-001-A-1, hours=-8, type=DESIGN, note=CORRECTION_VOID
2. Append CORRECT: person_code=SGO, job=SBS-001-A-1, hours=6, type=DESIGN, note=CORRECTION
```

---

## Client Operations

### New Client Onboarding
1. Add client to DIM_CLIENT_MASTER with effective_from = start date
2. Set billing_rate, currency, country
3. Create Google Form for client's intake (or update intake form dropdown)
4. Test with a dummy job submission in DEV
5. Notify PM that client is active

### Client Rate Change
1. Set effective_to on current DIM_CLIENT_MASTER row = last day of old rate
2. Add new row with new rate, effective_from = first day of new rate
3. Verify rate resolver picks up new rate correctly in DEV

---

## Designer Operations

### New Designer Onboarding
1. Generate PersonCode (3 initials, verify uniqueness in DIM_STAFF_ROSTER)
2. Add to DIM_STAFF_ROSTER with effective_from = start date
3. Set role, supervisor_id, hourly_rate, pay_design, pay_qc flags
4. Add email to ActorResolver mapping (or ensure Google login email matches)
5. Test by submitting a work log as the new designer in DEV

### Designer Rate Change
1. Set effective_to on current row = last day of old rate
2. Add new row with new rate, effective_from = first day of new rate
3. Verify payroll calculation uses correct rate in DEV before next period run

### Designer Offboarding
1. Set active = false on DIM_STAFF_ROSTER
2. Set effective_to = last working day
3. Ensure all open jobs are reallocated
4. Run final payroll period to close out any pending hours

---

## Period Operations

### Closing a Billing Period
1. Verify all IN_PROGRESS jobs have work logs for the period
2. Run BillingEngine.runBilling(periodId) — requires CEO/PM role
3. Verify FACT_BILLING_LEDGER has entries for all active clients
4. Export via ExportService for Xero import
5. Mark period as CLOSED in DIM_CONFIG_MASTER

### Running Payroll
1. Verify all work logs for the period are submitted
2. Run PayrollEngine.runPayroll(periodId) — requires CEO/PM role
3. Verify FACT_PAYROLL_LEDGER has entries for all active designers
4. Run SupervisorBonusCalculator.calculate(periodId)
5. Export payroll summary for payment processing
