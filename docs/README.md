# BLC Nexus — Project Overview

## What is BLC Nexus?
BLC Nexus (internally known as Stacey V3) is the internal operations platform for Blue Lotus Consulting Corporation. It manages the full lifecycle of structural design jobs: intake, allocation, work logging, QC, billing, and payroll — for 100+ designers across 25+ client accounts.

## Architecture Diagram (Text)
```
┌─────────────────────────────────────────────────────────────┐
│  INPUT LAYER                                                │
│  Google Forms (Job Create / Work Log / QC Submit)           │
└──────────────────────────┬──────────────────────────────────┘
                           │ onFormSubmit trigger
┌──────────────────────────▼──────────────────────────────────┐
│  STAGING LAYER                                              │
│  STG_RAW_INTAKE → STG_PROCESSING_QUEUE                      │
└──────────────────────────┬──────────────────────────────────┘
                           │ Time-based trigger (every 3-5 min)
┌──────────────────────────▼──────────────────────────────────┐
│  PROCESSING LAYER (QueueProcessor)                          │
│  Route by form_type → Handler                               │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  FACT TABLE LAYER (append-only)                             │
│  FACT_JOB_EVENTS / FACT_WORK_LOGS / FACT_BILLING_LEDGER     │
│  FACT_PAYROLL_LEDGER / FACT_QC_EVENTS / FACT_SOP_SUBMISSIONS│
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  VIEW / MART LAYER                                          │
│  VW_JOB_CURRENT_STATE / MART_DASHBOARD / MART_BILLING_SUMMARY│
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  REPORTING LAYER                                            │
│  Looker Studio dashboards connected to MART tables          │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start
1. Clone this scaffold into your Apps Script project directory
2. Replace `REPLACE_WITH_DEV_SPREADSHEET_ID` in `config/environments/dev.json`
3. Replace `REPLACE_WITH_APPS_SCRIPT_SCRIPT_ID` in `.clasp.json`
4. Run `src/setup/SheetCreator.gs` → `createAllSheets()` to initialize the spreadsheet
5. Run `src/setup/SeedData.gs` → `seedReferenceData()` to populate DIM tables
6. Run `src/setup/TriggerManager.gs` → `installAllTriggers()` to activate automation
7. Run `src/setup/VersionRecorder.gs` → `recordVersion()` to log deployment

## Module Map
| Tier | Directory | Purpose |
|------|-----------|---------|
| T0 | src/00-foundation | Config, Constants, Identifiers |
| T1 | src/01-dal | Data Access Layer, Write Guards, Cache, Batch |
| T2 | src/02-security | RBAC, Actor Resolution, Scope Filtering |
| T3 | src/03-infrastructure | Logger, Idempotency, Health, Errors, Notifications |
| T4 | src/04-validation | Field Validators, Business Rules, SOP |
| T5 | src/05-queue | Queue Processor, Intake, Retry, Dead Letter |
| T6 | src/06-job-lifecycle | State Machine, Job handlers, Event Replay |
| T7 | src/07-work-log | Work Log Handler, Attribution, Duplicate Detection |
| T8 | src/08-qc | QC Handler, Checklist Engine, Rework Tracker |
| T9 | src/09-billing | Billing Engine, Period Slicer, Invoice Generator |
| T10 | src/10-payroll | Payroll Engine, Supervisor Bonus, Rate Resolver |
| T11 | src/11-reporting | Dashboard Mart, Role-Based Views, Export |
| T12 | src/12-migration | Migration Engine, Legacy Importer, Reconciliation |
| T13 | src/13-admin | Admin Console, Config Manager, Archival |
| Setup | src/setup | Sheet Creator, Protection, Triggers, Seed, Version |

## Development Workflow
1. Use `/build-module <name>` to scaffold new modules
2. Use `/review-architecture` before committing new code
3. Use `/generate-tests` to create test stubs
4. Use `/audit-security` before any deployment
5. Use `/deploy DEV` → `/deploy STAGING` → `/deploy PROD`

## Testing
Run `testAll()` in DEV environment. All tests must pass (zero failures) before deploying to STAGING or PROD.

## Deployment
See `docs/DEVELOPMENT_GUIDE.md` for full deployment instructions.
