# BLC Nexus — API Reference

> This document is populated as modules are built. Each public function is documented here by module.

## Module: Config (src/00-foundation/Config.gs)

### getConfig()
Returns the Config singleton instance.
- Returns: `Config`

### Config.prototype.getEnvironment()
Returns current environment string.
- Returns: `string` — 'DEV' | 'STAGING' | 'PROD'

### Config.prototype.getSpreadsheetId()
Returns the active spreadsheet ID for the current environment.
- Returns: `string`

### Config.prototype.getVersion()
Returns current system version.
- Returns: `string` — semver (e.g., '3.0.0')

---

## Module: DAL (src/01-dal/DAL.gs)

### getDAL()
Returns the DAL singleton instance.
- Returns: `DAL`

### DAL.prototype.getRows(sheetName, filterFn?)
Reads all rows from a sheet, optionally filtered.
- Params: `sheetName` (string), `filterFn` (optional function)
- Returns: `Array<Object>`

### DAL.prototype.appendRow(sheetName, rowData, callingModule)
Appends a single row to a sheet. Enforces write guard.
- Params: `sheetName` (string), `rowData` (Object), `callingModule` (string)
- Returns: `{ success: boolean, rowIndex?: number, error?: string }`

### DAL.prototype.appendRows(sheetName, rowsArray, callingModule)
Batch appends multiple rows. Preferred for fact table writes.
- Params: `sheetName` (string), `rowsArray` (Array), `callingModule` (string)
- Returns: `{ success: boolean, count?: number, error?: string }`

### DAL.prototype.updateWhere(sheetName, matchFn, updateData, callingModule)
Updates matching rows. NOT for use on FACT tables.
- Params: `sheetName` (string), `matchFn` (function), `updateData` (Object), `callingModule` (string)
- Returns: `{ success: boolean, updatedCount?: number, error?: string }`

---

## Module: RBAC (src/02-security/RBAC.gs)

### getRBAC()
Returns the RBAC singleton instance.
- Returns: `RBAC`

### RBAC.prototype.enforcePermission(actorCode, permission)
Enforces that actor has the specified permission. Throws on denial.
- Params: `actorCode` (string), `permission` (string)
- Throws: `RBACDenialError` if permission not granted

### RBAC.prototype.enforceFinancialAccess(actorCode)
Enforces that actor has can_access_billing flag. Throws on denial.
- Params: `actorCode` (string)
- Throws: `RBACDenialError` if financial access not granted

### RBAC.prototype.hasPermission(actorCode, permission)
Returns boolean without throwing.
- Params: `actorCode` (string), `permission` (string)
- Returns: `boolean`

---

## Module: Logger (src/03-infrastructure/Logger.gs)

### getLogger()
Returns the Logger singleton instance.
- Returns: `Logger`

### Logger.prototype.info(module, actorCode, action, targetId, message)
Logs an INFO level entry to _SYS_LOGS.

### Logger.prototype.warn(module, actorCode, action, targetId, message)
Logs a WARN level entry to _SYS_LOGS.

### Logger.prototype.error(module, actorCode, action, targetId, message, detail?)
Logs an ERROR level entry to _SYS_LOGS and _SYS_EXCEPTIONS.

### Logger.prototype.debug(module, actorCode, action, targetId, message)
Logs a DEBUG level entry. Suppressed in PROD environment.

---

## Module: StateMachine (src/06-job-lifecycle/StateMachine.gs)

### getStateMachine()
Returns the StateMachine singleton instance.
- Returns: `StateMachine`

### StateMachine.prototype.validateTransition(fromState, toState)
Validates whether a state transition is allowed.
- Params: `fromState` (string), `toState` (string)
- Returns: `{ valid: boolean, reason?: string }`

### StateMachine.prototype.getAllowedTransitions(currentState)
Returns array of valid next states.
- Params: `currentState` (string)
- Returns: `Array<string>`

### StateMachine.prototype.isTerminal(state)
Returns true if the state is terminal (no further transitions).
- Params: `state` (string)
- Returns: `boolean`

---

> Additional modules will be documented here as they are implemented.
> Run `/build-module <name>` and the post-code hook will auto-append entries.
