# JobUpdateHandler — Design Spec
**Date:** 2026-05-06
**Status:** Approved

## Problem

`PortalData.editJob` writes directly to `FACT_JOB_EVENTS` and `VW_JOB_CURRENT_STATE` with `callerModule: 'PortalData'`, but neither table lists `PortalData` in `WRITE_PERMISSIONS`. The write guard throws on every save, making the Edit Job modal non-functional.

## Solution

Introduce `JobUpdateHandler` in `src/06-handlers/` — the standard location for all FACT_JOB_EVENTS writers. `PortalData.editJob` delegates to it directly (synchronous call, no queue), matching the pattern established by `SheetAdapter` → `JobAssignHandler`.

## Files Changed

| File | Change |
|---|---|
| `src/06-handlers/JobUpdateHandler.gs` | **New** — handler |
| `src/00-foundation/Constants.gs` | Add `JOB_UPDATED` to `EVENT_TYPES` |
| `src/01-dal/DAL.gs` | Add `JobUpdateHandler` to `FACT_JOB_EVENTS` and `VW_JOB_CURRENT_STATE` write lists |
| `src/07-portal/PortalData.gs` | Replace two `DAL.*` calls with `JobUpdateHandler.handle(email, jobNumber, changes)` |

## Handler Design — JobUpdateHandler.gs

### Module shape
Singleton IIFE, exported as `var JobUpdateHandler = (function() { ... })();`

### Public API
```javascript
JobUpdateHandler.handle(email, jobNumber, changes)
// Returns: { ok: true, job_number: string }
// Throws:  Error on RBAC denial, job-not-found, INVOICED lock, or DAL failure
```

`changes` is `{ target_date?, notes?, client_job_ref? }` — all optional, all strings.

### Execution sequence (strict order)
1. `RBAC.resolveActor(email)` → actor
2. `RBAC.enforcePermission(actor, RBAC.ACTIONS.JOB_CREATE)` — **first, unconditional**
3. Validate `jobNumber` is a non-empty string
4. Load VW row from `VW_JOB_CURRENT_STATE` — throw if not found
5. Throw if `vwRow.current_state === 'INVOICED'`
6. Validate `changes` — at least one field present; string values only; `target_date` must be valid ISO date if provided
7. Generate `idempotency_key = 'JOB_UPDATE_' + jobNumber + '_' + Identifiers.generateId()`
8. Build `eventRow` (see schema below)
9. `DAL.appendRow(Config.TABLES.FACT_JOB_EVENTS, eventRow, { callerModule: 'JobUpdateHandler' })`
10. Build `vwUpdate = { updated_at: now, ...changed fields }`
11. `DAL.updateWhere(Config.TABLES.VW_JOB_CURRENT_STATE, { job_number: jobNumber }, vwUpdate, { callerModule: 'JobUpdateHandler' })`
12. `Logger.info('JOB_UPDATED', { job_number, actor: email, changes })`
13. Return `{ ok: true, job_number: jobNumber }`

### FACT_JOB_EVENTS event row (JOB_UPDATED)
All columns present in all other JOB_* events:
```
event_id, job_number, period_id, event_type='JOB_UPDATED',
timestamp, actor_code, actor_role, client_code, job_type,
product_code, quantity, client_job_ref, target_date, notes,
idempotency_key, payload_json
```
Fields not changed by this event carry forward from the VW row.

## Constants.gs

Add to `EVENT_TYPES`:
```javascript
JOB_UPDATED: 'JOB_UPDATED',
```

## DAL.gs — WRITE_PERMISSIONS

```javascript
'FACT_JOB_EVENTS': [...existing..., 'JobUpdateHandler'],
'VW_JOB_CURRENT_STATE': [...existing..., 'JobUpdateHandler'],
```

## PortalData.gs — editJob

Remove the two `DAL.*` calls and the VW load. Replace the body after RBAC with:
```javascript
return JobUpdateHandler.handle(email, jobNumber, changes);
```
RBAC stays in the handler — remove the duplicate check from `PortalData.editJob` too (handler owns it).

## Idempotency Note

This handler is called synchronously from the portal (one user action = one call). The idempotency key uses `Identifiers.generateId()` to guarantee uniqueness per invocation. This prevents phantom double-writes if GAS re-invokes the function on a timeout retry, not double-submission from the user (that is prevented by the modal's loading state in the portal JS).

## What Is Not Changing

- No queue involvement — this is a synchronous portal action
- No new portal JS — `submitEditJob` already calls `portal_editJob` correctly
- No schema changes to FACT_JOB_EVENTS or VW_JOB_CURRENT_STATE
- No new RBAC permissions — reuses `JOB_CREATE`
