# Hook: post-deploy
Trigger: After successful deployment

## Actions
1. Record version in _SYS_VERSION sheet
2. Run /health-check command
3. Verify all triggers active
4. Log deployment in _SYS_LOGS
5. Send admin notification (PROD only)
