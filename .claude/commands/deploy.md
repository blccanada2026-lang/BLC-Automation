# Command: /deploy <environment>

## Process
1. Run pre-deploy hook (all checks must pass)
2. Generate deployment manifest
3. Produce file concatenation order:
   - Config.gs first (foundation)
   - Constants.gs, Identifiers.gs
   - DAL.gs, WriteGuard.gs
   - RBAC.gs, ActorResolver.gs
   - All infrastructure files
   - All business logic files
   - Setup files last
   - Test files: DEV only
4. Run post-deploy hook

## Output
Deployment manifest + clasp push command + post-deploy verification results
