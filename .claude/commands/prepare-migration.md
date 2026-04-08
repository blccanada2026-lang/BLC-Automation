# Command: /prepare-migration <source>

Activates: migration agent

## Generates
1. Field mapping from source to V3 schema
2. Validation checkpoints with known reconciliation totals
3. Import script (writes to MIGRATION_RAW_IMPORT only)
4. Normalization script (clean + validate)
5. Replay script (convert to V3 events)
6. Rollback procedure

## Output
src/12-migration/ scripts + docs/MIGRATION_GUIDE.md section
