# Hook: pre-code
Trigger: Before writing any .gs file

## Checks
1. Correct tier placement (file in correct src/ subdirectory)
2. Dependency direction (only depends on same or lower tier)
3. DAL compliance (no SpreadsheetApp outside DAL.gs)
4. RBAC enforcement present in handlers
5. try/catch wrapping on all handler functions

## On Violation
STOP. Report violation with rule reference. Suggest compliant approach before proceeding.
