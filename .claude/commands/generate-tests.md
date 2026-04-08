# Command: /generate-tests <module-name>

Activates: qa agent

## Generates
1. Happy path test — valid input, correct actor, expected outcome
2. RBAC denial test — invalid role, expected 403
3. Invalid input test — missing/malformed fields, expected validation error
4. Duplicate submission test — same source_submission_id, expected idempotent skip
5. Edge case tests — boundary conditions specific to module

## Output
tests/unit/<module>.test.gs or tests/integration/<module>-flow.test.gs
