# Command: /validate-schema [table-name]

Activates: data agent

## Validates
1. All schemas in config/schemas/ against naming standards
2. Required fields present on all table types
3. Referential integrity (foreign key references resolve)
4. SHEETS constants match schema definitions
5. No orphaned columns (defined in schema but not in SHEETS)

## Output
Validation report with pass/fail per table. Lists all violations.
