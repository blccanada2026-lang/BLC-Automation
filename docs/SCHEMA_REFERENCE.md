# BLC Nexus — Schema Reference

> All table schemas are defined in `config/schemas/*.json`. This document provides a human-readable summary.
> Run `/validate-schema` to verify schema compliance at any time.

## System Tables

### _SYS_LOGS
**Type:** SYSTEM | **Append-only:** Yes
| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| log_id | STRING | No | Unique log entry ID |
| timestamp | DATETIME | No | Event timestamp |
| level | ENUM | No | DEBUG / INFO / WARN / ERROR |
| module | STRING | No | Source module name |
| actor_code | STRING | Yes | PersonCode of actor |
| actor_role | STRING | Yes | Role at time of action |
| action | STRING | No | Action performed |
| target_id | STRING | Yes | Target entity ID |
| message | STRING | No | Log message |
| detail_json | STRING | Yes | JSON detail payload |

### _SYS_EXCEPTIONS
**Type:** SYSTEM | **Append-only:** Yes
| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| exception_id | STRING | No | Unique exception ID |
| timestamp | DATETIME | No | Exception timestamp |
| severity | ENUM | No | WARNING / ERROR / CRITICAL |
| module | STRING | No | Module where exception occurred |
| function_name | STRING | Yes | Function name |
| job_number | STRING | Yes | Related job number |
| message | STRING | No | Exception message |
| stack_trace | STRING | Yes | Stack trace if available |
| resolved | BOOLEAN | No | Whether resolved (default: false) |

### _SYS_VERSION
**Type:** SYSTEM
| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| version | STRING | No | Semantic version (x.y.z) |
| deployed_at | DATETIME | No | Deployment timestamp |
| deployed_by | STRING | No | Actor who deployed |
| environment | ENUM | No | DEV / STAGING / PROD |
| notes | STRING | Yes | Deployment notes |

---

## Dimension Tables

### DIM_STAFF_ROSTER
**Type:** DIMENSION | **Effective-dated:** Yes
| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| record_id | STRING | No | Unique record ID |
| person_code | STRING | No | Unique person code (e.g., SGO) |
| full_name | STRING | No | Full display name |
| role | STRING | No | DESIGNER / TEAM_LEAD / PM / etc. |
| client_code | STRING | Yes | Primary client assignment |
| supervisor_id | STRING | Yes | PersonCode of supervisor |
| supervisor_name | STRING | Yes | Supervisor display name |
| pay_design | BOOLEAN | No | Paid for design hours (default: true) |
| pay_qc | BOOLEAN | No | Paid for QC hours (default: false) |
| bonus_eligible | BOOLEAN | No | Eligible for supervisor bonus |
| hourly_rate | NUMBER | No | Rate in INR per hour |
| effective_from | DATE | No | Rate effective from |
| effective_to | DATE | Yes | Rate effective to (null = current) |
| active | BOOLEAN | No | Currently active (default: true) |

### DIM_CLIENT_MASTER
**Type:** DIMENSION | **Effective-dated:** Yes
| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| client_code | STRING | No | Unique client code (e.g., SBS) |
| client_name | STRING | No | Full client name |
| country | STRING | No | Client country |
| currency | ENUM | No | CAD / USD / INR |
| billing_rate | NUMBER | No | Default hourly billing rate |
| effective_from | DATE | No | Rate effective from |
| effective_to | DATE | Yes | Rate effective to |
| active | BOOLEAN | No | Account currently active |

---

## Staging Tables

### STG_RAW_INTAKE
**Type:** STAGING | **Append-only:** Yes
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| submission_id | STRING | No | — | Unique submission ID |
| received_at | DATETIME | No | — | Timestamp of receipt |
| form_type | STRING | No | — | JOB_CREATE / WORK_LOG / QC / etc. |
| submitter_email | STRING | No | — | Google Form submitter email |
| raw_payload_json | STRING | No | — | Full raw form payload as JSON |
| status | ENUM | No | PENDING | PENDING / QUEUED / PROCESSED / FAILED / DUPLICATE |
| queued_at | DATETIME | Yes | — | When moved to processing queue |

### STG_PROCESSING_QUEUE
**Type:** STAGING
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| queue_id | STRING | No | — | Unique queue entry ID |
| submission_id | STRING | No | — | Reference to STG_RAW_INTAKE |
| form_type | STRING | No | — | Handler routing key |
| payload_json | STRING | No | — | Parsed payload for handler |
| priority | NUMBER | No | 5 | Processing priority (1=highest) |
| status | ENUM | No | PENDING | PENDING / PROCESSING / COMPLETED / FAILED / DEAD_LETTER |
| attempt_count | NUMBER | No | 0 | Number of processing attempts |
| last_attempt_at | DATETIME | Yes | — | Timestamp of last attempt |
| error_message | STRING | Yes | — | Last error if failed |
| created_at | DATETIME | No | — | Queue entry creation timestamp |

---

## Fact Tables

### FACT_JOB_EVENTS
**Type:** FACT | **Append-only:** Yes | **Partitioned by:** period_id

### FACT_WORK_LOGS
**Type:** FACT | **Append-only:** Yes | **Partitioned by:** period_id

### FACT_PAYROLL_LEDGER
**Type:** FACT | **Append-only:** Yes | **Partitioned by:** period_id

> See `config/schemas/fact-tables.json` for full column specifications.

---

## View and Mart Tables

### VW_JOB_CURRENT_STATE
**Type:** VIEW | **Source:** FACT_JOB_EVENTS (computed projection)

### MART_DASHBOARD
**Type:** MART | **Refresh:** Every 30 minutes by scheduled trigger

> See `config/schemas/view-tables.json` for full column specifications.
