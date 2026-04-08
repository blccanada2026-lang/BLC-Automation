# Command: /build-module <module-name>

Activates agents in sequence: architect → data → security → backend → qa

## Steps
1. [architect] Review module placement, define boundaries, approve dependencies
2. [data] Define table schemas in config/schemas/, specify column definitions
3. [security] Define write guard entries, RBAC permission entries
4. [backend] Create source .gs file with full implementation stubs
5. [qa] Create test stubs with all required test cases

## Output
- src/<tier>-<module>/<ModuleName>.gs
- tests/unit/<module>.test.gs
- Updated config/schemas/ if new tables
- Updated config/rbac/write-guards.json
