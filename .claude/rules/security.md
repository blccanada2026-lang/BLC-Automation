# Rules: Security

## S1 — RBAC on Every Operation
Every handler enforces RBAC before any data access.

## S2 — Financial Data Isolation
All billing/payroll data requires can_access_billing flag.

## S3 — Write Guard Enforcement
Write permissions enforced via WRITE_PERMISSIONS matrix in DAL.

## S4 — Actor Traceability
Every write records actor_code and actor_role.

## S5 — Immutable Audit Trail
_SYS_LOGS is append-only and never modified.

## S6 — Scope Enforcement
Roles limited to: SELF | TEAM | ACCOUNTS | FINANCIAL | ALL | EXTERNAL
