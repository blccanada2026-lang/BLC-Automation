# Rules: Testing

## T1 — Minimum Test Coverage
Every handler needs: happy path + RBAC denial + invalid input + duplicate submission test.

## T2 — Test Data Prefix
All test records use TEST- prefix in IDs. Never use production data in tests.

## T3 — Test Independence
Tests are independent and idempotent. No shared state between tests.

## T4 — Integration Verification
Integration tests verify actual fact table data written, not just return values.

## T5 — Zero-Failure Gate
testAll() must pass with zero failures before any deployment to STAGING or PROD.
