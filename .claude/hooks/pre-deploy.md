# Hook: pre-deploy
Trigger: Before deployment to STAGING or PROD

## Checks
1. All tests pass (testAll() = zero failures)
2. No TODO/FIXME in production code
3. Version number updated in Config.gs
4. Schema backward compatible
5. Write guard matrix complete
6. RBAC matrix complete
7. No debug code or console.log
8. CHANGELOG.md updated

## On Violation
BLOCK deployment. List all failures. Do not proceed until all checks pass.
