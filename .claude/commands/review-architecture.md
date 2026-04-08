# Command: /review-architecture [module-name]

Activates: architect agent

## Checks
1. Dependency directions (no upward tier dependencies)
2. DAL compliance (no direct SpreadsheetApp)
3. RBAC enforcement points present
4. Queue pattern followed for external inputs
5. State machine compliance
6. Idempotency implemented

## Output
Pass/Fail report with specific rule violations and remediation steps.
