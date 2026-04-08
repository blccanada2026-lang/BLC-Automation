# Hook: pre-schema
Trigger: Before creating or modifying any schema in config/schemas/

## Checks
1. Backward compatibility — adding columns is safe, removing/renaming is forbidden
2. Schema standards — naming conventions, required fields present
3. Referential integrity — foreign keys resolve to existing tables

## On Violation
STOP. Report issues. Suggest safe migration path (add new column, deprecate old one).
