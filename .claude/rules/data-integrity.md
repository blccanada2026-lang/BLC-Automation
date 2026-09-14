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

## D7 — Payroll Hours Must Reconcile to Client Timesheets
For every designer or team lead, total PAID hours for a period (`design_hours + qc_hours`
combined, from `PayrollEngine`'s aggregation) must equal the total hours BILLED to the
client for that same person over that same period (from `ClientTimesheetEngine`'s output).
This is a per-person total, not a per-role one — the client timesheet does not separate
design from QC hours, so the comparison must sum both before matching.

Non-negotiable. A person paid for hours the client was never billed for (or billed for
hours nobody was paid for) is a stop-work condition — investigate the discrepancy before
running or approving payroll for that period, never after.

Known, already-confirmed divergence risks between the two aggregations (found 2026-09-12,
not yet closed by an automated gate):
- `ClientTimesheetEngine.gs`'s `buildWorkLogEntries_` drops any work-log row whose
  `job_number` doesn't resolve to a real job — `PayrollEngine`'s aggregation has no
  equivalent check and will still pay for those hours.
- `ClientTimesheetEngine.gs` silently excludes any row with an unparseable `work_date` —
  `PayrollEngine`'s aggregation never parses `work_date` and will still pay for the row.
- `PayrollEngine` reads a whole calendar-month partition with no date filter; the client
  timesheet filters to an exact half-month `work_date` window — a row whose `period_id`
  and `work_date` disagree can land in one and not the other.

These are documented, not yet enforced — no automated pre-payroll check exists for this
yet. Until one does, reconciliation must be done manually (see `DesignerHoursAudit.gs`,
`SartyReconAudit.gs` in `src/12-migration/` for prior-art reconciliation tooling) before
trusting any payroll run's design/QC hours as final.
