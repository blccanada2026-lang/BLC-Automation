# Command: /health-check

## Checks
1. STG_PROCESSING_QUEUE backlog depth
2. Error queue depth
3. Dead letter queue entries
4. Processing latency (avg time from intake to fact write)
5. Fact table row counts and growth rate
6. Cache hit rate
7. Active trigger status
8. Last successful run per trigger

## Output
Health dashboard with GREEN/YELLOW/RED status per metric.
