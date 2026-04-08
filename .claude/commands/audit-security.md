# Command: /audit-security [module-name]

Activates: security agent

## Scans For
1. enforcePermission() calls in all handlers
2. enforceFinancialAccess() in billing/payroll handlers
3. Write guard coverage in DAL for all tables
4. Direct SpreadsheetApp access outside DAL
5. Missing actor_code on DAL writes

## Output
Security audit report with pass/fail per handler. Lists all vulnerabilities.
