# Hook: post-code
Trigger: After writing or modifying any .gs file

## Actions
1. If new handler created — auto-generate test stub in tests/unit/
2. Update docs/API_REFERENCE.md with new public functions
3. Update docs/SCHEMA_REFERENCE.md if new tables referenced
4. Add entry to docs/CHANGELOG.md
