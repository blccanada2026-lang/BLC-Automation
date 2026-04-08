# Rules: Architecture

## A1 — Layered Architecture
T1 Foundation → T2 Master Data → T3 Transaction Core → T4 QC/Exceptions → T5 Financial → T6 Presentation → T8 Migration.
Modules only depend on same or lower tier.

## A2 — DAL Monopoly
ALL sheet reads/writes through getDAL(). No module calls SpreadsheetApp directly.

## A3 — Queue-Based Processing
ALL external submissions: Form → STG_RAW_INTAKE → STG_PROCESSING_QUEUE → Handler → FACT tables.

## A4 — Event Sourcing
Job state derived from events. VW_JOB_CURRENT_STATE is a computed projection, not source of truth.

## A5 — Append-Only Facts
No updates, no deletes on FACT tables. Corrections via adjustment events.

## A6 — Configuration Externalized
Business rules in config sheets, not hardcoded.

## A7 — Module Identity
Every DAL write includes calling module's identity string.

## A8 — No Monoliths
One module per file. Max ~500 lines. Single responsibility.
