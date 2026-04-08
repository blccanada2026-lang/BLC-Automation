# Rules: Coding Standards

## Naming
- Files: PascalCase.gs
- Classes: PascalCase
- Functions: camelCase
- Constants: UPPER_SNAKE_CASE
- Private methods: trailingUnderscore_
- Tests: test[Module]_[scenario]
- Sheet names: PREFIX_SNAKE_CASE
- IDs: PREFIX-TIMESTAMP-RANDOM

## Required
- Every public function requires JSDoc
- Every handler wrapped in try/catch
- Singleton pattern for module classes

## Prohibited
- Direct SpreadsheetApp outside DAL
- Logger.log in production code
- Hardcoded sheet names
- Hardcoded roles
- sleep(), dynamic code execution, mutable globals
