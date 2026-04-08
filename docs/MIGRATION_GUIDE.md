# BLC Nexus — Migration Guide (V2 → V3)

## Three-Truth Model

```
Layer 1 — Raw Truth:        MIGRATION_RAW_IMPORT (untouched copy of V2 data)
Layer 2 — System Truth:     MIGRATION_NORMALIZED (cleaned, validated, mapped)
Layer 3 — Official Truth:   FACT tables via replay engine (V3 events)
```

Never modify Layer 1. All corrections happen in Layer 2 before replay.

## Legacy Source Inventory

### V2 Source Tables
| V2 Table | V3 Target | Notes |
|----------|-----------|-------|
| TL_VIEW | VW_JOB_CURRENT_STATE | Current job state projection |
| INTAKE_QUEUE | FACT_JOB_EVENTS | Historical job create events |
| WORK_LOG (legacy) | FACT_WORK_LOGS | Historical work hours |
| BILLING_SHEET | FACT_BILLING_LEDGER | Historical billing records |
| PAYROLL_SHEET | FACT_PAYROLL_LEDGER | Historical payroll records |
| STAFF_ROSTER | DIM_STAFF_ROSTER | Designer master data |

## Field Mapping Templates

### Job Events (INTAKE_QUEUE → FACT_JOB_EVENTS)
| V2 Field | V3 Field | Transformation |
|----------|----------|----------------|
| timestamp | created_at | Direct |
| job_number | internal_job_id | Prepend client_code: SBS-{job_number}-A-1 |
| client | client_code | Normalize to uppercase 3-char code |
| status | to_state | Map V2 status → V3 state enum |
| assigned_to | actor_code | Resolve name → PersonCode via DIM_STAFF_ROSTER |
| — | from_state | Derive from previous event |
| — | event_type | Derive from status change |
| — | period_id | Compute from created_at |
| — | source_submission_id | Generate: MIGR-{v2_row_id} |

### Work Logs (WORK_LOG → FACT_WORK_LOGS)
| V2 Field | V3 Field | Transformation |
|----------|----------|----------------|
| date | created_at | Direct |
| designer | person_code | Resolve name → PersonCode |
| job_ref | internal_job_id | Normalize to ClientCode-JobNumber-Option-Version |
| hours | hours | Direct (validate > 0 and <= 24) |
| type | work_type | Map: Design/QC/Rework → DESIGN/QC/REWORK_MAJOR |
| — | period_id | Compute from date |
| — | source_submission_id | Generate: MIGR-WL-{v2_row_id} |

## Import Process

### Step 1: Raw Import
```
LegacyImporter.importFromV2()
  → Reads V2 sheets via SpreadsheetApp (read-only)
  → Writes raw rows to MIGRATION_RAW_IMPORT
  → Tags each row: source_system=V2, migration_batch=BATCH-001, migration_timestamp
  → NEVER transforms or cleans — raw copy only
```

### Step 2: Normalization
```
ReconciliationService.normalize()
  → Reads from MIGRATION_RAW_IMPORT
  → Applies field mappings and transformations
  → Validates each row against V3 schema
  → Writes clean rows to MIGRATION_NORMALIZED
  → Logs failures to MIGRATION_NORMALIZED with status=FAILED
```

### Step 3: Validation Checkpoint
Before replay, verify reconciliation totals match:
- Total job count in MIGRATION_NORMALIZED vs V2 source
- Total work hours per designer vs V2 payroll records
- Total billed amounts per client vs V2 billing sheets

### Step 4: Replay
```
ReplayMigrator.replay()
  → Reads MIGRATION_NORMALIZED rows in chronological order
  → Converts each row to a V3 event payload
  → Calls appropriate handler (JobCreateHandler, WorkLogHandler, etc.)
  → Handlers write to FACT tables via normal V3 path
  → Tags events: migration_source=MIGR, migration_batch=BATCH-001
```

## Normalization Rules
1. All PersonCode values must resolve to active DIM_STAFF_ROSTER records
2. All ClientCode values must resolve to active DIM_CLIENT_MASTER records
3. All dates must be valid and within expected range (Jan 2024 onward)
4. Work hours must be > 0 and <= 24 per entry
5. Job IDs must conform to ClientCode-JobNumber-Option-Version format
6. Duplicate V2 rows (same designer + job + date + hours) are flagged, not imported

## Override Rules (Jan/Feb Periods Only)
For the initial migration covering January and February periods:
- Allow migration_override flag on FACT_PAYROLL_LEDGER writes
- Allow backdated period_id values (normally rejected)
- Allow missing source_submission_id uniqueness (migration IDs prefixed MIGR-)
- These overrides are hardcoded OFF for all other periods

## Reconciliation Checkpoints
After each batch, verify:
```
Total hours migrated = Total hours in V2 (by period, by designer)
Total jobs migrated = Total jobs in V2 (by client, by status)
Total pay amounts = Total V2 payroll (by period)
Zero records in MIGRATION_NORMALIZED with status=FAILED
```

## Rollback Procedure
If migration batch fails reconciliation:
1. Record failing batch ID and timestamp
2. Delete all FACT rows tagged with migration_batch=FAILED_BATCH_ID
3. Delete all MIGRATION_NORMALIZED rows for that batch
4. Fix normalization issue in source mapping
5. Re-run normalization for that batch only
6. Re-run reconciliation checkpoint
7. Re-run replay for that batch only

Note: MIGRATION_RAW_IMPORT rows are NEVER deleted — raw truth is preserved.
