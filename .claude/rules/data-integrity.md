# Rules: Data Integrity

## D1 — Staging First
All external data enters via STG_RAW_INTAKE before processing.

## D2 — Idempotency
Check source_submission_id before processing. Reject duplicates gracefully.

## D3 — State Machine Enforcement
All job state changes validated against allowed transitions. INVOICED is terminal and immutable.

## D4 — Effective Dating
All reference data has effective_from/effective_to for point-in-time queries.

## D5 — Referential Integrity
All codes (ClientCode, PersonCode, etc.) must resolve to active dimension records.

## D6 — Period Partitioning
Fact tables partitioned monthly. Archive periods older than 2 months.
