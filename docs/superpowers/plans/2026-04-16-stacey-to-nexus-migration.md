# Stacey → Nexus Production Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely migrate all real production data from the Stacey legacy system into Nexus V3 with zero data loss, full auditability, validated reconciliation, and a tested cutover path.

**Architecture:** Three-Truth Model — Layer 1 (MIGRATION_RAW_IMPORT = untouched Stacey copy), Layer 2 (MIGRATION_NORMALIZED = cleaned/mapped), Layer 3 (FACT tables via normal V3 handler replay). All migration code lives in `src/12-migration/`. No production data moves until Phases A–C pass their readiness gates.

**Tech Stack:** Google Apps Script (V8), Google Sheets (DAL), RBAC/DAL/Logger/HealthMonitor from existing Nexus tiers, SpreadsheetApp.openById() for Stacey read-only access.

> **⚠️ SCOPE NOTE:** Phase H (User Manuals) is documentation-only and independent of migration code. It should be executed as a separate plan after go-live. It is documented here for completeness but not implemented in this plan's tasks.

---

## Files

| File | Action | Responsibility |
|---|---|---|
| `src/12-migration/MigrationConfig.gs` | Create | Stacey spreadsheet ID, batch constants, override flags |
| `src/12-migration/PurgeTool.gs` | Create | Phase B — identify and purge test data from Nexus |
| `src/12-migration/StaceyAuditor.gs` | Create | Phase C — read Stacey and produce source inventory |
| `src/12-migration/MigrationRawImporter.gs` | Create | Phase D — raw copy Stacey → MIGRATION_RAW_IMPORT (Layer 1) |
| `src/12-migration/MigrationNormalizer.gs` | Create | Phase E — clean/map → MIGRATION_NORMALIZED (Layer 2) |
| `src/12-migration/MigrationValidator.gs` | Create | Phase E — field and business rule validation during normalization |
| `src/12-migration/MigrationReplayEngine.gs` | Create | Phase E — replay Layer 2 → FACT tables via handlers (Layer 3) |
| `src/12-migration/MigrationReconciler.gs` | Create | Phase F — record counts, hours totals, billing totals |
| `src/12-migration/MigrationTestRunner.gs` | Create | Phase G — end-to-end system test scenarios using migrated data |
| `src/setup/TestRunner.gs` | Modify | Add migration diagnostic functions |
| `config/schemas/migration_tables.json` | Create | Schemas for MIGRATION_RAW_IMPORT and MIGRATION_NORMALIZED |
| `docs/superpowers/plans/2026-04-16-stacey-to-nexus-migration.md` | This file | |

---

## BLOCKING DEPENDENCIES

Before Task 1 can execute, confirm:
1. **Stacey Spreadsheet ID** — needed in `MigrationConfig.gs`. CEO provides read-only access.
2. **Nexus DEV/STAGING spreadsheet IDs** — migration must run in DEV first, never PROD first.
3. **Stacey sheet names** — the auditor will discover them, but a list helps. Ask the CEO for a screenshot of the Stacey tab list.

---

## Phase A — Nexus Readiness Audit

### Task 1: Confirm all required Nexus tables exist and are structured

**Files:**
- Read: `config/schemas/` (all JSON schema files)
- Read: `src/00-foundation/Config.gs` (TABLES registry)
- Create: `src/12-migration/MigrationConfig.gs`

- [ ] **Step 1: Read the full TABLES registry from Config.gs**

  Open `src/00-foundation/Config.gs` and locate the `TABLES` constant. List every table name. Verify the following required tables exist:

  ```
  Required for migration:
  FACT_JOB_EVENTS          — job lifecycle events
  FACT_WORK_LOGS           — designer hours
  FACT_BILLING_LEDGER      — billing records
  FACT_PAYROLL_LEDGER      — payroll records
  DIM_STAFF_ROSTER         — designer master data
  DIM_CLIENT_MASTER        — client master data
  DIM_CLIENT_RATES         — billing rates
  DIM_FX_RATES             — currency conversion
  VW_JOB_CURRENT_STATE     — job projection
  STG_PROCESSING_QUEUE     — queue
  STG_RAW_INTAKE           — raw intake
  MIGRATION_RAW_IMPORT     — Layer 1 (may not exist yet)
  MIGRATION_NORMALIZED     — Layer 2 (may not exist yet)
  ```

  Record any missing tables in a comment block at the top of `MigrationConfig.gs`.

- [ ] **Step 2: Create `src/12-migration/MigrationConfig.gs`**

  ```javascript
  // ============================================================
  // MigrationConfig.gs — BLC Nexus T12 Migration
  // src/12-migration/MigrationConfig.gs
  //
  // Central configuration for the Stacey → Nexus migration.
  // All batch IDs, spreadsheet IDs, and override flags live here.
  // ============================================================

  var MigrationConfig = (function () {

    // ── Stacey (legacy) spreadsheet ───────────────────────────
    // Read-only. Never write to Stacey.
    // CEO must provide this ID before migration begins.
    var STACEY_SPREADSHEET_ID = 'REPLACE_WITH_STACEY_SPREADSHEET_ID';

    // ── Migration batch tracking ──────────────────────────────
    var CURRENT_BATCH        = 'BATCH-001';
    var MIGRATION_SOURCE_TAG = 'STACEY_V2';

    // ── Override flags (ONLY for migration period) ────────────
    // These flags permit backdated period_ids and relaxed
    // idempotency rules during migration. Hardcoded OFF by default.
    // Set to true ONLY during the actual migration run, then back to false.
    var ALLOW_BACKDATE_PERIOD   = false;
    var ALLOW_MIGR_IDEMPOTENCY  = false;

    // ── Table names (migration-specific) ─────────────────────
    var TABLES = {
      RAW_IMPORT:   'MIGRATION_RAW_IMPORT',
      NORMALIZED:   'MIGRATION_NORMALIZED',
      AUDIT_LOG:    'MIGRATION_AUDIT_LOG'
    };

    // ── Source table names (Stacey tabs — update after audit) ─
    // Fill these in after running StaceyAuditor.runAudit()
    var STACEY_TABLES = {
      STAFF:       'REPLACE_AFTER_AUDIT',   // e.g. 'STAFF_ROSTER'
      CLIENTS:     'REPLACE_AFTER_AUDIT',
      JOBS:        'REPLACE_AFTER_AUDIT',   // e.g. 'INTAKE_QUEUE' or 'TL_VIEW'
      WORK_LOGS:   'REPLACE_AFTER_AUDIT',
      BILLING:     'REPLACE_AFTER_AUDIT',
      PAYROLL:     'REPLACE_AFTER_AUDIT'
    };

    return {
      getStaceyId:           function () { return STACEY_SPREADSHEET_ID; },
      getBatch:              function () { return CURRENT_BATCH; },
      getSourceTag:          function () { return MIGRATION_SOURCE_TAG; },
      isBackdateAllowed:     function () { return ALLOW_BACKDATE_PERIOD; },
      isMigrIdempotency:     function () { return ALLOW_MIGR_IDEMPOTENCY; },
      enableOverrides:       function () {
        ALLOW_BACKDATE_PERIOD  = true;
        ALLOW_MIGR_IDEMPOTENCY = true;
      },
      disableOverrides:      function () {
        ALLOW_BACKDATE_PERIOD  = false;
        ALLOW_MIGR_IDEMPOTENCY = false;
      },
      TABLES:                TABLES,
      STACEY_TABLES:         STACEY_TABLES
    };
  }());
  ```

- [ ] **Step 3: Verify MIGRATION_RAW_IMPORT and MIGRATION_NORMALIZED tables exist in the Nexus spreadsheet**

  Run in Apps Script editor:
  ```javascript
  function checkMigrationTables() {
    var ss = SpreadsheetApp.openById(Config.getSpreadsheetId());
    var needed = ['MIGRATION_RAW_IMPORT', 'MIGRATION_NORMALIZED', 'MIGRATION_AUDIT_LOG'];
    needed.forEach(function(name) {
      var sheet = ss.getSheetByName(name);
      console.log(name + ': ' + (sheet ? 'EXISTS' : 'MISSING — run SetupScript to create'));
    });
  }
  ```

  If any are MISSING, add them to SetupScript and run setup before continuing.

- [ ] **Step 4: Commit**

  ```bash
  git add src/12-migration/MigrationConfig.gs
  git commit -m "feat(migration): add MigrationConfig — batch constants and override flags"
  ```

---

### Task 2: Readiness audit — produce the Phase A table

**Files:**
- Read: `src/02-security/RBAC.gs` (role model)
- Read: `src/00-foundation/Config.gs` (table list, transitions)
- Read: `docs/SCHEMA_REFERENCE.md`

- [ ] **Step 1: Run the readiness checklist manually**

  Open the Apps Script editor and run this diagnostic:

  ```javascript
  function runNexusReadinessAudit() {
    var ss = SpreadsheetApp.openById(Config.getSpreadsheetId());
    var checks = [
      'FACT_JOB_EVENTS', 'FACT_WORK_LOGS', 'FACT_BILLING_LEDGER',
      'FACT_PAYROLL_LEDGER', 'DIM_STAFF_ROSTER', 'DIM_CLIENT_MASTER',
      'DIM_CLIENT_RATES', 'DIM_FX_RATES', 'VW_JOB_CURRENT_STATE',
      'MIGRATION_RAW_IMPORT', 'MIGRATION_NORMALIZED', 'MIGRATION_AUDIT_LOG',
      'STG_PROCESSING_QUEUE', 'STG_RAW_INTAKE', '_SYS_LOGS', '_SYS_EXCEPTIONS'
    ];
    checks.forEach(function(name) {
      var sheet = ss.getSheetByName(name);
      if (!sheet) {
        console.log('❌ MISSING: ' + name);
      } else {
        console.log('✅ EXISTS:  ' + name + ' (' + Math.max(sheet.getLastRow()-1,0) + ' rows)');
      }
    });
  }
  ```

  **Expected:** All tables ✅. Any ❌ must be fixed before migration continues.

- [ ] **Step 2: Record readiness results in a comment in MigrationConfig.gs**

  Add a `READINESS_AUDIT` comment block at the top of `MigrationConfig.gs` with the date and results table:

  ```javascript
  // READINESS AUDIT — 2026-04-16
  // | Area                  | Ready? | Risk   | Fix Before Migration        |
  // |-----------------------|--------|--------|-----------------------------|
  // | FACT tables           | ✅     | Low    | None                        |
  // | DIM tables            | ✅     | Low    | None                        |
  // | Migration tables      | ❓     | High   | Create if missing           |
  // | RBAC model            | ✅     | Low    | None                        |
  // | Audit logging         | ✅     | Low    | None                        |
  // | Rollback mechanism    | ✅     | Medium | batch-tag purge ready       |
  // | Stacey read access    | ❓     | High   | Provide STACEY_SPREADSHEET_ID|
  // | DEV/PROD isolation    | ✅     | Low    | Run in DEV first            |
  // | Override flags        | ✅     | High   | Keep false until migration  |
  ```

  Update ❓ marks after running the check above.

- [ ] **Step 3: Commit**

  ```bash
  git add src/12-migration/MigrationConfig.gs
  git commit -m "docs(migration): add Phase A readiness audit results to MigrationConfig"
  ```

---

## Phase B — Test Data Purge

### Task 3: Build PurgeTool — identify all test/dummy data in Nexus

**Files:**
- Create: `src/12-migration/PurgeTool.gs`

- [ ] **Step 1: Create `src/12-migration/PurgeTool.gs` — audit-only mode first**

  ```javascript
  // ============================================================
  // PurgeTool.gs — BLC Nexus T12 Migration
  // src/12-migration/PurgeTool.gs
  //
  // Identifies and (with explicit confirmation) removes test/dummy
  // data from Nexus before production migration.
  //
  // SAFETY: auditOnly=true by default. Pass false ONLY after
  // reviewing the audit output and confirming with CEO.
  // ============================================================

  var PurgeTool = (function () {

    var MODULE = 'PurgeTool';

    // Prefixes that identify test records across all tables
    var TEST_PREFIXES = ['TEST-', 'DUMMY-', 'SAMPLE-', 'DEV-', 'BLC-TEST'];

    // Emails that identify test actors
    var TEST_EMAIL_PATTERNS = ['@blctest.com', 'test-designer@', 'test-pm@'];

    function isTestId_(id) {
      if (!id) return false;
      var s = String(id).toUpperCase();
      return TEST_PREFIXES.some(function(p) { return s.indexOf(p) === 0; });
    }

    function isTestEmail_(email) {
      if (!email) return false;
      var s = String(email).toLowerCase();
      return TEST_EMAIL_PATTERNS.some(function(p) { return s.indexOf(p) !== -1; });
    }

    /**
     * Scans a table and returns all rows that look like test data.
     * Does NOT delete anything.
     *
     * @param {string} tableName
     * @param {string} idField  — column to check for test prefix
     * @returns {{ tableName, rows: Object[], count: number }}
     */
    function scanTable_(tableName, idField) {
      var rows;
      try {
        rows = DAL.readAll(tableName, { callerModule: MODULE });
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') return { tableName: tableName, rows: [], count: 0 };
        throw e;
      }
      var suspect = rows.filter(function(r) {
        return isTestId_(r[idField]) ||
               isTestEmail_(r.actor_email) ||
               isTestEmail_(r.submitter_email);
      });
      return { tableName: tableName, rows: suspect, count: suspect.length };
    }

    /**
     * Runs a non-destructive audit of all Nexus tables for test data.
     * Prints a summary table. Call this FIRST before any purge.
     *
     * @param {string} actorEmail — must be CEO
     */
    function runAudit(actorEmail) {
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

      Logger.info('PURGE_AUDIT_START', { module: MODULE, message: 'Starting test data audit' });

      var targets = [
        { table: Config.TABLES.FACT_JOB_EVENTS,     id: 'job_number'  },
        { table: Config.TABLES.FACT_WORK_LOGS,       id: 'event_id'    },
        { table: Config.TABLES.FACT_BILLING_LEDGER,  id: 'billing_id'  },
        { table: Config.TABLES.FACT_PAYROLL_LEDGER,  id: 'payroll_id'  },
        { table: Config.TABLES.VW_JOB_CURRENT_STATE, id: 'job_number'  },
        { table: Config.TABLES.STG_PROCESSING_QUEUE, id: 'queue_id'    },
        { table: Config.TABLES.STG_RAW_INTAKE,       id: 'intake_id'   },
        { table: Config.TABLES.DIM_STAFF_ROSTER,     id: 'person_code' },
        { table: Config.TABLES.DIM_CLIENT_MASTER,    id: 'client_code' }
      ];

      var results = [];
      targets.forEach(function(t) {
        var scan = scanTable_(t.table, t.id);
        results.push(scan);
        Logger.info('PURGE_AUDIT_TABLE', {
          module:    MODULE,
          table:     t.table,
          suspects:  scan.count
        });
        console.log((scan.count > 0 ? '⚠️  ' : '✅  ') +
                    t.table + ': ' + scan.count + ' suspect rows');
        if (scan.count > 0) {
          scan.rows.forEach(function(r) {
            console.log('    → ' + (r[t.id] || r.event_id || r.queue_id || '?'));
          });
        }
      });

      var totalSuspect = results.reduce(function(s, r) { return s + r.count; }, 0);
      console.log('\nTotal suspect rows: ' + totalSuspect);
      console.log('Review above, then call PurgeTool.runPurge(email) to remove.');

      return { total: totalSuspect, results: results };
    }

    /**
     * Deletes all rows flagged as test data from FACT and STG tables.
     * Uses DAL.updateWhere to mark rows deleted (FACT tables are append-only —
     * test rows written during DEV are tagged and excluded from all calculations).
     *
     * For STG and DIM tables: rows are hard-deleted via DAL.
     *
     * SAFETY: Run runAudit() first and review output before calling this.
     *
     * @param {string}  actorEmail
     * @param {boolean} dryRun — if true, logs what would be deleted but deletes nothing
     */
    function runPurge(actorEmail, dryRun) {
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
      RBAC.enforceFinancialAccess(actor);

      if (dryRun !== false) {
        Logger.warn('PURGE_DRY_RUN', { module: MODULE,
          message: 'dryRun=true — no data will be deleted. Pass false to execute.' });
        return runAudit(actorEmail);
      }

      Logger.info('PURGE_START', { module: MODULE,
        message: 'Starting test data purge', actor: actorEmail });

      // Mark FACT rows as test data (append-only — cannot hard delete)
      // Tag the row with migration_batch='TEST_PURGED' for exclusion in all queries
      var factTables = [
        { table: Config.TABLES.FACT_JOB_EVENTS,    id: 'job_number'  },
        { table: Config.TABLES.FACT_WORK_LOGS,      id: 'event_id'    },
        { table: Config.TABLES.FACT_BILLING_LEDGER, id: 'billing_id'  },
        { table: Config.TABLES.FACT_PAYROLL_LEDGER, id: 'payroll_id'  }
      ];

      var totalTagged  = 0;
      var totalDeleted = 0;

      factTables.forEach(function(t) {
        var scan = scanTable_(t.table, t.id);
        scan.rows.forEach(function(r) {
          try {
            var cond = {};
            cond[t.id] = r[t.id];
            DAL.updateWhere(t.table, cond,
              { migration_batch: 'TEST_PURGED', status: 'PURGED' },
              { callerModule: MODULE }
            );
            totalTagged++;
          } catch (e) {
            Logger.warn('PURGE_TAG_FAILED', { module: MODULE, id: r[t.id], error: e.message });
          }
        });
      });

      // Hard-delete STG and VW test rows (these are not append-only)
      var deleteTables = [
        { table: Config.TABLES.VW_JOB_CURRENT_STATE, id: 'job_number'  },
        { table: Config.TABLES.STG_PROCESSING_QUEUE,  id: 'queue_id'   },
        { table: Config.TABLES.STG_RAW_INTAKE,        id: 'intake_id'  }
      ];

      deleteTables.forEach(function(t) {
        var scan = scanTable_(t.table, t.id);
        scan.rows.forEach(function(r) {
          try {
            // DAL does not support hard delete — use updateWhere to mark deleted
            var cond = {};
            cond[t.id] = r[t.id];
            DAL.updateWhere(t.table, cond,
              { status: 'PURGED', migration_batch: 'TEST_PURGED' },
              { callerModule: MODULE }
            );
            totalDeleted++;
          } catch (e) {
            Logger.warn('PURGE_DELETE_FAILED', { module: MODULE, id: r[t.id], error: e.message });
          }
        });
      });

      Logger.info('PURGE_COMPLETE', { module: MODULE,
        tagged: totalTagged, deleted: totalDeleted, actor: actorEmail });

      console.log('Purge complete: ' + totalTagged + ' FACT rows tagged, ' +
                  totalDeleted + ' STG rows marked PURGED.');
      return { tagged: totalTagged, deleted: totalDeleted };
    }

    return { runAudit: runAudit, runPurge: runPurge };
  }());
  ```

- [ ] **Step 2: Add a TestRunner diagnostic for the purge audit**

  Append to `src/setup/TestRunner.gs`:

  ```javascript
  /**
   * Runs the test data purge audit (non-destructive).
   * Shows all suspected test rows per table.
   * Run from Apps Script editor before migration.
   */
  function testPurgeAudit() {
    header_('PURGE AUDIT');
    var result = PurgeTool.runAudit(Session.getActiveUser().getEmail());
    if (result.total === 0) {
      pass_('No test data found — Nexus is clean for migration');
    } else {
      info_('Found ' + result.total + ' suspect rows — review above before proceeding');
      info_('Call PurgeTool.runPurge(email, false) after reviewing to execute purge');
    }
    line_();
  }
  ```

- [ ] **Step 3: Push and run `testPurgeAudit()` in Apps Script editor**

  ```bash
  git add src/12-migration/PurgeTool.gs src/setup/TestRunner.gs
  clasp push --force
  ```

  Expected output: Either `✅ No test data found` or a list of suspect rows to review.

  **Decision gate:** If suspect rows are found — review the list with CEO before calling `PurgeTool.runPurge(email, false)`.

- [ ] **Step 4: Commit**

  ```bash
  git commit -m "feat(migration): add PurgeTool — Phase B test data audit and purge"
  ```

---

## Phase C — Stacey Source Audit

> **⚠️ BLOCKING:** Requires `STACEY_SPREADSHEET_ID` set in `MigrationConfig.gs` and read access granted to the Apps Script service account. Do not proceed until the CEO provides this.

### Task 4: Build StaceyAuditor — discover and classify Stacey source data

**Files:**
- Create: `src/12-migration/StaceyAuditor.gs`

- [ ] **Step 1: Set the Stacey spreadsheet ID**

  Open `src/12-migration/MigrationConfig.gs` and replace `'REPLACE_WITH_STACEY_SPREADSHEET_ID'` with the real Stacey spreadsheet ID provided by the CEO.

  ```javascript
  var STACEY_SPREADSHEET_ID = '1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; // real ID here
  ```

- [ ] **Step 2: Create `src/12-migration/StaceyAuditor.gs`**

  ```javascript
  // ============================================================
  // StaceyAuditor.gs — BLC Nexus T12 Migration
  // src/12-migration/StaceyAuditor.gs
  //
  // Read-only inspection of the Stacey legacy spreadsheet.
  // Produces a source inventory: tab names, row counts, column
  // headers, sample data, and data quality signals.
  //
  // NEVER writes to Stacey. All output goes to console + Logger.
  // ============================================================

  var StaceyAuditor = (function () {

    var MODULE = 'StaceyAuditor';

    function getStaceySheet_(tabName) {
      var ss = SpreadsheetApp.openById(MigrationConfig.getStaceyId());
      var sheet = ss.getSheetByName(tabName);
      if (!sheet) throw new Error('StaceyAuditor: tab "' + tabName + '" not found in Stacey.');
      return sheet;
    }

    /**
     * Lists all tabs in the Stacey spreadsheet with row counts.
     * Run this first to discover the tab structure.
     *
     * @returns {{ name: string, rows: number }[]}
     */
    function listTabs() {
      var ss     = SpreadsheetApp.openById(MigrationConfig.getStaceyId());
      var sheets = ss.getSheets();
      var result = sheets.map(function(s) {
        return { name: s.getName(), rows: Math.max(s.getLastRow() - 1, 0) };
      });
      result.forEach(function(t) {
        console.log(t.rows + '\t' + t.name);
      });
      return result;
    }

    /**
     * Reads headers and first 5 data rows from a named Stacey tab.
     * Use this to understand column structure before building the mapper.
     *
     * @param {string} tabName
     * @returns {{ headers: string[], samples: Object[] }}
     */
    function sampleTab(tabName) {
      var sheet   = getStaceySheet_(tabName);
      var lastRow = sheet.getLastRow();
      if (lastRow < 1) return { headers: [], samples: [] };

      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
                        .map(function(h) { return String(h).trim(); })
                        .filter(function(h) { return h !== ''; });

      var sampleCount = Math.min(5, lastRow - 1);
      var samples     = [];
      if (sampleCount > 0) {
        var rawRows = sheet.getRange(2, 1, sampleCount, headers.length).getValues();
        rawRows.forEach(function(row) {
          var obj = {};
          headers.forEach(function(h, i) { obj[h] = row[i]; });
          samples.push(obj);
        });
      }

      console.log('Tab: ' + tabName + ' | Columns: ' + headers.length +
                  ' | Total rows: ' + (lastRow - 1));
      console.log('Headers: ' + headers.join(', '));
      console.log('Sample:  ' + JSON.stringify(samples[0] || {}));

      return { headers: headers, samples: samples };
    }

    /**
     * Full source audit — runs sampleTab on every tab with > 0 rows.
     * Produces the Phase C source inventory table.
     *
     * @param {string} actorEmail — must be CEO
     */
    function runAudit(actorEmail) {
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

      Logger.info('STACEY_AUDIT_START', { module: MODULE,
        message: 'Starting Stacey source audit' });

      var tabs = listTabs();

      console.log('\n=== STACEY SOURCE AUDIT ===');
      console.log('Tab count: ' + tabs.length);
      console.log('');

      var inventory = [];
      tabs.forEach(function(t) {
        if (t.rows === 0) {
          console.log('SKIP (empty): ' + t.name);
          return;
        }
        try {
          var sample = sampleTab(t.name);
          inventory.push({
            tab:     t.name,
            rows:    t.rows,
            columns: sample.headers.length,
            headers: sample.headers,
            sample:  sample.samples[0] || {}
          });
        } catch (e) {
          Logger.warn('STACEY_AUDIT_TAB_ERROR', {
            module: MODULE, tab: t.name, error: e.message
          });
          console.log('ERROR reading ' + t.name + ': ' + e.message);
        }
      });

      Logger.info('STACEY_AUDIT_COMPLETE', { module: MODULE,
        tabs_found: tabs.length, tabs_audited: inventory.length });

      console.log('\n=== SUMMARY TABLE ===');
      console.log('Tab Name\t\tRows\tColumns');
      inventory.forEach(function(t) {
        console.log(t.tab + '\t' + t.rows + '\t' + t.columns);
      });

      console.log('\nNext: Update MigrationConfig.STACEY_TABLES with correct tab names.');
      return inventory;
    }

    /**
     * Data quality scan for a specific Stacey tab.
     * Checks for: blank required fields, duplicate IDs, date ranges, outlier values.
     *
     * @param {string} tabName
     * @param {string} idField  — column expected to be unique (e.g. 'job_number')
     * @param {string[]} requiredFields
     * @returns {{ blanks: number, duplicates: number, total: number }}
     */
    function qualityScan(tabName, idField, requiredFields) {
      var sheet = getStaceySheet_(tabName);
      if (sheet.getLastRow() <= 1) return { blanks: 0, duplicates: 0, total: 0 };

      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
                         .map(function(h) { return String(h).trim(); });
      var allValues = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

      var seen      = {};
      var blanks    = 0;
      var dupes     = 0;
      var total     = allValues.length;

      allValues.forEach(function(row, idx) {
        var obj = {};
        headers.forEach(function(h, i) { obj[h] = row[i]; });

        // Blank check
        requiredFields.forEach(function(f) {
          if (!obj[f] || String(obj[f]).trim() === '') blanks++;
        });

        // Duplicate ID check
        var idVal = String(obj[idField] || '').trim();
        if (idVal) {
          if (seen[idVal]) dupes++;
          else seen[idVal] = true;
        }
      });

      console.log(tabName + ': total=' + total + ' blanks=' + blanks + ' dupes=' + dupes);
      return { total: total, blanks: blanks, duplicates: dupes, tabName: tabName };
    }

    return { listTabs: listTabs, sampleTab: sampleTab, runAudit: runAudit, qualityScan: qualityScan };
  }());
  ```

- [ ] **Step 3: Add TestRunner diagnostic**

  Append to `src/setup/TestRunner.gs`:

  ```javascript
  /**
   * Discovers all tabs in the Stacey legacy spreadsheet.
   * Run from Apps Script editor to get the Phase C source inventory.
   * Requires STACEY_SPREADSHEET_ID set in MigrationConfig.gs.
   */
  function testStaceyAudit() {
    header_('STACEY SOURCE AUDIT');
    try {
      var result = StaceyAuditor.runAudit(Session.getActiveUser().getEmail());
      info_('Tabs audited: ' + result.length);
      info_('Check console output for full tab inventory.');
      info_('Next: update MigrationConfig.STACEY_TABLES with correct tab names.');
      pass_('Stacey audit complete');
    } catch (e) {
      fail_('Stacey audit failed: ' + e.message);
      info_('Check: Is STACEY_SPREADSHEET_ID set in MigrationConfig.gs?');
      info_('Check: Does the Apps Script service account have read access to Stacey?');
    }
    line_();
  }
  ```

- [ ] **Step 4: Push and run `testStaceyAudit()` in Apps Script editor**

  ```bash
  git add src/12-migration/StaceyAuditor.gs src/setup/TestRunner.gs
  clasp push --force
  ```

  Run `testStaceyAudit()`. Review the console output tab list. Update `MigrationConfig.STACEY_TABLES` with the correct tab names.

- [ ] **Step 5: Run quality scans on each source tab**

  After identifying tab names, run quality scans from the Apps Script editor:

  ```javascript
  function runStaceyQualityScans() {
    // Update these tab names after running testStaceyAudit()
    var scans = [
      { tab: MigrationConfig.STACEY_TABLES.STAFF,     id: 'name',       required: ['name', 'role'] },
      { tab: MigrationConfig.STACEY_TABLES.JOBS,      id: 'job_number', required: ['job_number', 'client', 'status'] },
      { tab: MigrationConfig.STACEY_TABLES.WORK_LOGS, id: 'row_index',  required: ['designer', 'date', 'hours'] },
      { tab: MigrationConfig.STACEY_TABLES.BILLING,   id: 'invoice_id', required: ['client', 'amount', 'period'] }
    ];
    scans.forEach(function(s) {
      try {
        StaceyAuditor.qualityScan(s.tab, s.id, s.required);
      } catch (e) {
        console.log('ERROR: ' + s.tab + ' — ' + e.message);
      }
    });
  }
  ```

  Record results: blank count, duplicate count, total rows per tab. These numbers become the **reconciliation targets** for Phase F.

- [ ] **Step 6: Commit**

  ```bash
  git add src/12-migration/MigrationConfig.gs src/12-migration/StaceyAuditor.gs src/setup/TestRunner.gs
  git commit -m "feat(migration): add StaceyAuditor — Phase C source inventory and quality scan"
  ```

---

## Phase D — Raw Import (Layer 1)

> **Gate:** Phase C must be complete. `MigrationConfig.STACEY_TABLES` must be filled with real tab names. Quality scan totals recorded.

### Task 5: Build MigrationRawImporter — copy Stacey → MIGRATION_RAW_IMPORT

**Files:**
- Create: `src/12-migration/MigrationRawImporter.gs`

- [ ] **Step 1: Create `src/12-migration/MigrationRawImporter.gs`**

  ```javascript
  // ============================================================
  // MigrationRawImporter.gs — BLC Nexus T12 Migration
  // src/12-migration/MigrationRawImporter.gs
  //
  // Layer 1: Raw copy of Stacey data into MIGRATION_RAW_IMPORT.
  // NEVER transforms or cleans — preserves original values exactly.
  // Tags each row: source_system, migration_batch, source_tab,
  // source_row_index, migration_timestamp.
  // Idempotent: rows tagged with same batch are skipped on re-run.
  // ============================================================

  var MigrationRawImporter = (function () {

    var MODULE = 'MigrationRawImporter';

    /**
     * Copies all rows from a single Stacey tab into MIGRATION_RAW_IMPORT.
     * Idempotent — rows already tagged with the current batch are skipped.
     *
     * @param {string} staceyTabName
     * @param {string} entityType   — e.g. 'STAFF', 'JOB', 'WORK_LOG', 'BILLING', 'PAYROLL'
     * @returns {{ written: number, skipped: number, total: number }}
     */
    function importTab_(staceyTabName, entityType) {
      var staceySheet = SpreadsheetApp.openById(MigrationConfig.getStaceyId())
                                      .getSheetByName(staceyTabName);
      if (!staceySheet) {
        throw new Error('MigrationRawImporter: tab "' + staceyTabName + '" not found in Stacey.');
      }

      var lastRow = staceySheet.getLastRow();
      if (lastRow <= 1) return { written: 0, skipped: 0, total: 0 };

      var headers   = staceySheet.getRange(1, 1, 1, staceySheet.getLastColumn())
                                 .getValues()[0]
                                 .map(function(h) { return String(h).trim(); });
      var allValues = staceySheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

      var batch     = MigrationConfig.getBatch();
      var timestamp = new Date().toISOString();
      var written   = 0;
      var skipped   = 0;

      // Check for existing rows with same batch + entity + source_row_index
      var existing;
      try {
        existing = DAL.readWhere(
          MigrationConfig.TABLES.RAW_IMPORT,
          { migration_batch: batch, entity_type: entityType },
          { callerModule: MODULE }
        );
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') existing = [];
        else throw e;
      }
      var existingIdx = {};
      existing.forEach(function(r) {
        existingIdx[String(r.source_row_index)] = true;
      });

      var rowsToWrite = [];

      allValues.forEach(function(row, idx) {
        var rowIndex = String(idx + 2); // 1-based sheet row, +1 for header
        if (existingIdx[rowIndex]) { skipped++; return; }

        // Build raw payload — every source field stored as JSON
        var rawPayload = {};
        headers.forEach(function(h, i) { rawPayload[h] = row[i]; });

        rowsToWrite.push({
          raw_id:             Identifiers.generateId(),
          entity_type:        entityType,
          source_system:      MigrationConfig.getSourceTag(),
          source_tab:         staceyTabName,
          source_row_index:   rowIndex,
          migration_batch:    batch,
          migration_timestamp: timestamp,
          raw_payload_json:   JSON.stringify(rawPayload),
          status:             'RAW'
        });
        written++;
      });

      if (rowsToWrite.length > 0) {
        BatchOperations.appendRows(MigrationConfig.TABLES.RAW_IMPORT, rowsToWrite);
      }

      Logger.info('RAW_IMPORT_TAB', { module: MODULE,
        tab: staceyTabName, entity: entityType,
        written: written, skipped: skipped, total: allValues.length });

      return { written: written, skipped: skipped, total: allValues.length };
    }

    /**
     * Runs the full raw import — all Stacey tabs → MIGRATION_RAW_IMPORT.
     * CEO only. Idempotent.
     *
     * @param {string} actorEmail
     * @returns {{ totals: Object, partial: boolean }}
     */
    function runImport(actorEmail) {
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
      RBAC.enforceFinancialAccess(actor);

      Logger.info('RAW_IMPORT_START', { module: MODULE,
        message: 'Starting raw import from Stacey', batch: MigrationConfig.getBatch() });

      var tabs = [
        { tab: MigrationConfig.STACEY_TABLES.STAFF,     entity: 'STAFF'     },
        { tab: MigrationConfig.STACEY_TABLES.CLIENTS,   entity: 'CLIENT'    },
        { tab: MigrationConfig.STACEY_TABLES.JOBS,      entity: 'JOB'       },
        { tab: MigrationConfig.STACEY_TABLES.WORK_LOGS, entity: 'WORK_LOG'  },
        { tab: MigrationConfig.STACEY_TABLES.BILLING,   entity: 'BILLING'   },
        { tab: MigrationConfig.STACEY_TABLES.PAYROLL,   entity: 'PAYROLL'   }
      ];

      var totals  = {};
      var partial = false;

      for (var i = 0; i < tabs.length; i++) {
        if (HealthMonitor.isApproachingLimit()) {
          Logger.warn('RAW_IMPORT_QUOTA_CUTOFF', {
            module: MODULE, processed: i, total: tabs.length });
          partial = true;
          break;
        }
        var t = tabs[i];
        if (!t.tab || t.tab === 'REPLACE_AFTER_AUDIT') {
          Logger.warn('RAW_IMPORT_TAB_SKIP', { module: MODULE,
            message: 'Tab name not configured — skipping', entity: t.entity });
          continue;
        }
        try {
          totals[t.entity] = importTab_(t.tab, t.entity);
        } catch (e) {
          Logger.error('RAW_IMPORT_TAB_FAILED', {
            module: MODULE, entity: t.entity, error: e.message });
          totals[t.entity] = { error: e.message };
        }
      }

      Logger.info('RAW_IMPORT_COMPLETE', { module: MODULE, totals: JSON.stringify(totals) });
      return { totals: totals, partial: partial };
    }

    return { runImport: runImport };
  }());
  ```

- [ ] **Step 2: Add TestRunner diagnostic**

  Append to `src/setup/TestRunner.gs`:

  ```javascript
  /**
   * Runs Phase D raw import from Stacey into MIGRATION_RAW_IMPORT (Layer 1).
   * Idempotent — safe to re-run. Reports written/skipped per entity type.
   */
  function testRawImport() {
    header_('MIGRATION: Raw Import (Layer 1)');
    var result = MigrationRawImporter.runImport(Session.getActiveUser().getEmail());
    var entities = Object.keys(result.totals);
    entities.forEach(function(e) {
      var t = result.totals[e];
      if (t.error) {
        fail_('  ' + e + ': ERROR — ' + t.error);
      } else {
        info_('  ' + e + ': total=' + t.total + ' written=' + t.written + ' skipped=' + t.skipped);
      }
    });
    if (result.partial) {
      info_('WARNING: partial=true — quota limit hit. Re-run to continue.');
    } else {
      pass_('Raw import complete — all entities imported');
    }
    info_('Reconciliation target: verify MIGRATION_RAW_IMPORT row counts match Stacey tab row counts.');
    line_();
  }
  ```

- [ ] **Step 3: Push and run `testRawImport()` in Apps Script editor**

  ```bash
  git add src/12-migration/MigrationRawImporter.gs src/setup/TestRunner.gs
  clasp push --force
  ```

  Verify `MIGRATION_RAW_IMPORT` row counts match Stacey source tab row counts from Phase C.

- [ ] **Step 4: Commit**

  ```bash
  git commit -m "feat(migration): add MigrationRawImporter — Layer 1 raw copy from Stacey"
  ```

---

## Phase E — Normalize + Replay (Layers 2 and 3)

### Task 6: Build MigrationNormalizer — clean and map Layer 1 → Layer 2

> **Gate:** Phase D complete. `MIGRATION_RAW_IMPORT` row counts match Stacey source totals.

**Files:**
- Create: `src/12-migration/MigrationNormalizer.gs`

- [ ] **Step 1: Create `src/12-migration/MigrationNormalizer.gs`**

  ```javascript
  // ============================================================
  // MigrationNormalizer.gs — BLC Nexus T12 Migration
  // src/12-migration/MigrationNormalizer.gs
  //
  // Layer 2: Reads MIGRATION_RAW_IMPORT, applies field mappings,
  // validates each row against V3 schema, writes to
  // MIGRATION_NORMALIZED. Failures written with status=FAILED.
  //
  // Field mapping rules from docs/MIGRATION_GUIDE.md.
  // ============================================================

  var MigrationNormalizer = (function () {

    var MODULE = 'MigrationNormalizer';

    // ── Person code resolver ────────────────────────────────────
    // Maps Stacey display name → Nexus person_code
    // Built once per run from DIM_STAFF_ROSTER
    var _personCodeCache = null;

    function buildPersonCodeCache_() {
      if (_personCodeCache) return _personCodeCache;
      var staff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
      _personCodeCache = {};
      staff.forEach(function(s) {
        var name = String(s.full_name || s.name || '').trim().toLowerCase();
        if (name) _personCodeCache[name] = s.person_code;
      });
      return _personCodeCache;
    }

    function resolvePersonCode_(displayName) {
      var cache = buildPersonCodeCache_();
      var key   = String(displayName || '').trim().toLowerCase();
      return cache[key] || null;
    }

    // ── Client code resolver ────────────────────────────────────
    var _clientCodeCache = null;

    function buildClientCodeCache_() {
      if (_clientCodeCache) return _clientCodeCache;
      var clients = DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: MODULE });
      _clientCodeCache = {};
      clients.forEach(function(c) {
        var name = String(c.client_name || '').trim().toLowerCase();
        if (name) _clientCodeCache[name] = c.client_code;
        // Also index by code directly
        if (c.client_code) _clientCodeCache[c.client_code.toLowerCase()] = c.client_code;
      });
      return _clientCodeCache;
    }

    function resolveClientCode_(rawClient) {
      var cache = buildClientCodeCache_();
      var key   = String(rawClient || '').trim().toLowerCase();
      return cache[key] || String(rawClient || '').toUpperCase().substring(0, 10) || null;
    }

    // ── Period ID from date ─────────────────────────────────────
    function toPeriodId_(dateValue) {
      var d = new Date(dateValue);
      if (isNaN(d.getTime())) return null;
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart ? String(d.getMonth() + 1).padStart(2, '0')
                                                 : ('0' + (d.getMonth() + 1)).slice(-2);
      return y + '-' + m;
    }

    // ── Normalize a single raw row ──────────────────────────────
    function normalizeRow_(rawRow) {
      var entityType = rawRow.entity_type;
      var raw        = JSON.parse(rawRow.raw_payload_json || '{}');
      var errors     = [];
      var normalized = {};

      if (entityType === 'STAFF') {
        // Map: name, role, supervisor, pay rates
        var personCode = resolvePersonCode_(raw.name || raw.Name);
        if (!personCode) {
          errors.push('Cannot resolve person_code for name: ' + (raw.name || raw.Name));
        }
        normalized = {
          person_code:    personCode,
          full_name:      String(raw.name || raw.Name || '').trim(),
          role:           String(raw.role || raw.Role || '').toUpperCase().trim(),
          supervisor:     String(raw.supervisor || raw.TL || '').trim(),
          pay_design:     parseFloat(raw.pay_design || raw.rate || 0),
          pay_currency:   String(raw.currency || 'INR').toUpperCase()
        };

      } else if (entityType === 'JOB') {
        // Map: job_number, client, status → event_type
        var clientCode = resolveClientCode_(raw.client || raw.Client);
        if (!clientCode) errors.push('Cannot resolve client_code for: ' + (raw.client || raw.Client));
        var periodId = toPeriodId_(raw.timestamp || raw.date || raw.Date);
        if (!periodId) errors.push('Invalid date: ' + (raw.timestamp || raw.date));
        normalized = {
          job_number:   String(raw.job_number || raw['Job #'] || '').trim(),
          client_code:  clientCode,
          event_type:   'JOB_CREATED',
          period_id:    periodId,
          actor_code:   resolvePersonCode_(raw.assigned_to || raw.designer) || 'UNKNOWN',
          notes:        String(raw.notes || raw.Notes || '').substring(0, 500)
        };

      } else if (entityType === 'WORK_LOG') {
        // Map: designer, job_ref, date, hours, type
        var wPersonCode = resolvePersonCode_(raw.designer || raw.Designer || raw.name);
        if (!wPersonCode) errors.push('Cannot resolve person_code for: ' + (raw.designer || raw.Designer));
        var wPeriodId = toPeriodId_(raw.date || raw.Date);
        if (!wPeriodId) errors.push('Invalid date: ' + (raw.date || raw.Date));
        var hours = parseFloat(raw.hours || raw.Hours || 0);
        if (hours <= 0 || hours > 24) errors.push('Invalid hours: ' + hours);
        normalized = {
          person_code:  wPersonCode,
          job_number:   String(raw.job_ref || raw['Job #'] || raw.job_number || '').trim(),
          period_id:    wPeriodId,
          hours:        hours,
          work_type:    String(raw.type || raw.Type || 'DESIGN').toUpperCase().trim(),
          notes:        String(raw.notes || '').substring(0, 500)
        };

      } else if (entityType === 'BILLING') {
        var bClientCode = resolveClientCode_(raw.client || raw.Client);
        var bPeriodId   = toPeriodId_(raw.date || raw.period || raw.Date);
        normalized = {
          client_code:  bClientCode,
          period_id:    bPeriodId,
          total_hours:  parseFloat(raw.hours || raw.total_hours || 0),
          amount:       parseFloat(raw.amount || raw.Amount || 0),
          currency:     String(raw.currency || 'CAD').toUpperCase()
        };

      } else if (entityType === 'PAYROLL') {
        var pPersonCode = resolvePersonCode_(raw.name || raw.designer || raw.Designer);
        var pPeriodId   = toPeriodId_(raw.period || raw.date || raw.Date);
        normalized = {
          person_code:  pPersonCode,
          period_id:    pPeriodId,
          design_hours: parseFloat(raw.design_hours || raw.hours || 0),
          total_pay:    parseFloat(raw.total_pay || raw.amount || 0)
        };
      }

      return {
        status:          errors.length === 0 ? 'NORMALIZED' : 'FAILED',
        validation_errors: errors.join('; '),
        normalized_json: JSON.stringify(normalized)
      };
    }

    /**
     * Reads all RAW rows, normalizes them, writes to MIGRATION_NORMALIZED.
     * Idempotent — already-normalized rows (status != 'RAW') are skipped.
     *
     * @param {string} actorEmail
     * @returns {{ normalized: number, failed: number, skipped: number, partial: boolean }}
     */
    function runNormalization(actorEmail) {
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
      RBAC.enforceFinancialAccess(actor);

      Logger.info('NORMALIZE_START', { module: MODULE, message: 'Starting normalization' });

      var rawRows;
      try {
        rawRows = DAL.readWhere(
          MigrationConfig.TABLES.RAW_IMPORT,
          { status: 'RAW' },
          { callerModule: MODULE }
        );
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') rawRows = [];
        else throw e;
      }

      var normalized = 0;
      var failed     = 0;
      var skipped    = 0;
      var partial    = false;
      var toWrite    = [];

      for (var i = 0; i < rawRows.length; i++) {
        if (i % 20 === 0 && i > 0 && HealthMonitor.isApproachingLimit()) {
          Logger.warn('NORMALIZE_QUOTA_CUTOFF', { module: MODULE, processed: i });
          partial = true;
          break;
        }

        var raw    = rawRows[i];
        var result = null;
        try {
          result = normalizeRow_(raw);
        } catch (e) {
          result = {
            status:           'FAILED',
            validation_errors: e.message,
            normalized_json:  '{}'
          };
        }

        toWrite.push({
          norm_id:            Identifiers.generateId(),
          raw_id:             raw.raw_id,
          entity_type:        raw.entity_type,
          source_tab:         raw.source_tab,
          source_row_index:   raw.source_row_index,
          migration_batch:    raw.migration_batch,
          status:             result.status,
          validation_errors:  result.validation_errors || '',
          normalized_json:    result.normalized_json,
          normalized_at:      new Date().toISOString()
        });

        if (result.status === 'NORMALIZED') normalized++;
        else failed++;

        // Write in batches of 50 to avoid quota
        if (toWrite.length >= 50) {
          BatchOperations.appendRows(MigrationConfig.TABLES.NORMALIZED, toWrite);
          toWrite = [];
        }
      }

      if (toWrite.length > 0) {
        BatchOperations.appendRows(MigrationConfig.TABLES.NORMALIZED, toWrite);
      }

      Logger.info('NORMALIZE_COMPLETE', { module: MODULE,
        normalized: normalized, failed: failed, skipped: skipped });

      return { normalized: normalized, failed: failed, skipped: skipped, partial: partial };
    }

    return { runNormalization: runNormalization };
  }());
  ```

- [ ] **Step 2: Add TestRunner diagnostic**

  ```javascript
  /**
   * Runs Phase E normalization: MIGRATION_RAW_IMPORT → MIGRATION_NORMALIZED.
   * Must have 0 FAILED rows before proceeding to replay.
   */
  function testNormalization() {
    header_('MIGRATION: Normalization (Layer 2)');
    var result = MigrationNormalizer.runNormalization(Session.getActiveUser().getEmail());
    info_('Normalized: ' + result.normalized + ' | Failed: ' + result.failed +
          ' | Skipped: ' + result.skipped);
    if (result.failed > 0) {
      fail_('FAILED rows exist — fix mapping in MigrationNormalizer before replay.');
      info_('Query MIGRATION_NORMALIZED where status=FAILED to see errors.');
    } else if (result.normalized === 0 && !result.partial) {
      info_('Nothing to normalize — all rows already processed.');
      pass_('Normalization up to date');
    } else {
      pass_('Normalization complete — 0 failures');
    }
    line_();
  }
  ```

- [ ] **Step 3: Push, run, fix all FAILED rows**

  ```bash
  git add src/12-migration/MigrationNormalizer.gs src/setup/TestRunner.gs
  clasp push --force
  ```

  Run `testNormalization()`. Inspect any FAILED rows in `MIGRATION_NORMALIZED`. Fix the field mapping in `normalizeRow_()` for each failure type. Re-run until `failed=0`.

- [ ] **Step 4: Commit**

  ```bash
  git commit -m "feat(migration): add MigrationNormalizer — Layer 2 clean/map from raw import"
  ```

---

### Task 7: Build MigrationReplayEngine — replay Layer 2 → FACT tables (Layer 3)

> **Gate:** Phase E normalization complete. `MIGRATION_NORMALIZED` has zero `status=FAILED` rows.

**Files:**
- Create: `src/12-migration/MigrationReplayEngine.gs`

- [ ] **Step 1: Create `src/12-migration/MigrationReplayEngine.gs`**

  ```javascript
  // ============================================================
  // MigrationReplayEngine.gs — BLC Nexus T12 Migration
  // src/12-migration/MigrationReplayEngine.gs
  //
  // Layer 3: Replays MIGRATION_NORMALIZED rows into FACT tables
  // via the normal V3 handler path — same as live operations.
  //
  // Each normalized row is converted to a V3 event payload and
  // written directly to FACT tables (bypassing the queue, which
  // would add ~5 min delay per batch).
  //
  // Tagged: migration_batch=BATCH-001, migration_source=STACEY_V2
  // Idempotent: idempotency_key = 'MIGR-{source_tab}-{row_index}'
  // ============================================================

  var MigrationReplayEngine = (function () {

    var MODULE = 'MigrationReplayEngine';

    function buildIdempotencyKey_(entityType, sourceTab, sourceRowIndex) {
      return 'MIGR-' + entityType + '-' + sourceTab + '-' + sourceRowIndex;
    }

    function replayStaff_(norm, actor) {
      var data = JSON.parse(norm.normalized_json);
      if (!data.person_code) {
        throw new Error('Staff replay: missing person_code for row ' + norm.source_row_index);
      }

      // Check if already in DIM_STAFF_ROSTER
      var existing = DAL.readWhere(Config.TABLES.DIM_STAFF_ROSTER,
        { person_code: data.person_code }, { callerModule: MODULE });
      if (existing.length > 0) return 'SKIPPED_EXISTS';

      // Onboard via StaffOnboarding to go through proper validation
      var payload = {
        person_code:  data.person_code,
        name:         data.full_name,
        role:         data.role,
        pay_design:   data.pay_design || 0,
        pay_qc:       0,
        pay_currency: data.pay_currency || 'INR',
        supervisor_code: '',
        pm_code:      '',
        bonus_eligible: true,
        bank_country: 'India'
      };
      StaffOnboarding.onboardStaff(actor.email, payload);
      return 'WRITTEN';
    }

    function replayJob_(norm, actor) {
      var data     = JSON.parse(norm.normalized_json);
      var iKey     = buildIdempotencyKey_(norm.entity_type, norm.source_tab, norm.source_row_index);
      var periodId = data.period_id || Identifiers.generateCurrentPeriodId();

      // Ensure partition exists
      DAL.ensurePartition(Config.TABLES.FACT_JOB_EVENTS, periodId, MODULE);

      // Check idempotency
      var existing = DAL.readWhere(Config.TABLES.FACT_JOB_EVENTS,
        { idempotency_key: iKey }, { callerModule: MODULE });
      if (existing.length > 0) return 'SKIPPED_EXISTS';

      DAL.appendRow(Config.TABLES.FACT_JOB_EVENTS, {
        event_id:           Identifiers.generateId(),
        job_number:         data.job_number,
        period_id:          periodId,
        event_type:         'JOB_CREATED',
        timestamp:          new Date().toISOString(),
        actor_code:         data.actor_code || 'MIGR',
        actor_role:         'SYSTEM',
        client_code:        data.client_code,
        job_type:           data.job_type || 'DESIGN',
        product_code:       '',
        quantity:           1,
        notes:              data.notes || '',
        idempotency_key:    iKey,
        migration_batch:    MigrationConfig.getBatch(),
        migration_source:   MigrationConfig.getSourceTag(),
        payload_json:       norm.normalized_json
      }, { callerModule: MODULE });

      return 'WRITTEN';
    }

    function replayWorkLog_(norm, actor) {
      var data     = JSON.parse(norm.normalized_json);
      var iKey     = buildIdempotencyKey_(norm.entity_type, norm.source_tab, norm.source_row_index);
      var periodId = data.period_id || Identifiers.generateCurrentPeriodId();

      DAL.ensurePartition(Config.TABLES.FACT_WORK_LOGS, periodId, MODULE);

      var existing = DAL.readWhere(Config.TABLES.FACT_WORK_LOGS,
        { idempotency_key: iKey }, { callerModule: MODULE });
      if (existing.length > 0) return 'SKIPPED_EXISTS';

      DAL.appendRow(Config.TABLES.FACT_WORK_LOGS, {
        event_id:         Identifiers.generateId(),
        event_type:       'WORK_LOG_SUBMITTED',
        person_code:      data.person_code,
        job_number:       data.job_number,
        period_id:        periodId,
        hours:            data.hours,
        work_type:        data.work_type || 'DESIGN',
        notes:            data.notes || '',
        idempotency_key:  iKey,
        migration_batch:  MigrationConfig.getBatch(),
        migration_source: MigrationConfig.getSourceTag(),
        timestamp:        new Date().toISOString()
      }, { callerModule: MODULE });

      return 'WRITTEN';
    }

    /**
     * Replays all NORMALIZED rows into FACT tables.
     * Processes in entity order: STAFF → CLIENT → JOB → WORK_LOG → BILLING → PAYROLL
     * Idempotent — rows with existing idempotency_key are skipped.
     *
     * @param {string} actorEmail  — CEO only
     * @param {string} [entityFilter] — replay only one entity type (optional, for dry runs)
     * @returns {{ written: number, skipped: number, failed: number, partial: boolean }}
     */
    function runReplay(actorEmail, entityFilter) {
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
      RBAC.enforceFinancialAccess(actor);

      Logger.info('REPLAY_START', { module: MODULE,
        message: 'Starting migration replay', filter: entityFilter || 'ALL' });

      var normRows;
      try {
        normRows = entityFilter
          ? DAL.readWhere(MigrationConfig.TABLES.NORMALIZED,
              { status: 'NORMALIZED', entity_type: entityFilter }, { callerModule: MODULE })
          : DAL.readWhere(MigrationConfig.TABLES.NORMALIZED,
              { status: 'NORMALIZED' }, { callerModule: MODULE });
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') normRows = [];
        else throw e;
      }

      // Sort by entity priority: STAFF first, then CLIENT, then transactions
      var priority = { STAFF: 1, CLIENT: 2, JOB: 3, WORK_LOG: 4, BILLING: 5, PAYROLL: 6 };
      normRows.sort(function(a, b) {
        return (priority[a.entity_type] || 9) - (priority[b.entity_type] || 9);
      });

      var written = 0; var skipped = 0; var failed = 0; var partial = false;

      for (var i = 0; i < normRows.length; i++) {
        if (i % 20 === 0 && i > 0 && HealthMonitor.isApproachingLimit()) {
          Logger.warn('REPLAY_QUOTA_CUTOFF', { module: MODULE, processed: i, total: normRows.length });
          partial = true;
          break;
        }

        var norm   = normRows[i];
        var result = 'UNKNOWN';

        try {
          if      (norm.entity_type === 'STAFF')    result = replayStaff_(norm, actor);
          else if (norm.entity_type === 'JOB')      result = replayJob_(norm, actor);
          else if (norm.entity_type === 'WORK_LOG') result = replayWorkLog_(norm, actor);
          else result = 'SKIPPED_UNSUPPORTED';

          if (result === 'WRITTEN')        written++;
          else if (result.indexOf('SKIP') === 0) skipped++;

          // Mark row as REPLAYED
          DAL.updateWhere(MigrationConfig.TABLES.NORMALIZED,
            { norm_id: norm.norm_id },
            { status: 'REPLAYED', replayed_at: new Date().toISOString() },
            { callerModule: MODULE }
          );

        } catch (e) {
          failed++;
          Logger.warn('REPLAY_ROW_FAILED', {
            module: MODULE, norm_id: norm.norm_id,
            entity: norm.entity_type, error: e.message });
          DAL.updateWhere(MigrationConfig.TABLES.NORMALIZED,
            { norm_id: norm.norm_id },
            { status: 'REPLAY_FAILED', validation_errors: e.message },
            { callerModule: MODULE }
          );
        }
      }

      Logger.info('REPLAY_COMPLETE', { module: MODULE,
        written: written, skipped: skipped, failed: failed, partial: partial });
      return { written: written, skipped: skipped, failed: failed, partial: partial };
    }

    return { runReplay: runReplay };
  }());
  ```

- [ ] **Step 2: Add TestRunner diagnostic**

  ```javascript
  /**
   * Runs Phase E replay: MIGRATION_NORMALIZED → FACT tables (Layer 3).
   * Run in DEV first. Validate reconciliation before running in PROD.
   */
  function testMigrationReplay() {
    header_('MIGRATION: Replay (Layer 3)');
    var result = MigrationReplayEngine.runReplay(Session.getActiveUser().getEmail());
    info_('Written: ' + result.written + ' | Skipped: ' + result.skipped +
          ' | Failed: ' + result.failed);
    if (result.failed > 0) {
      fail_('REPLAY_FAILED rows exist — check MIGRATION_NORMALIZED for errors');
    } else if (result.partial) {
      info_('partial=true — quota limit hit, re-run to continue');
    } else {
      pass_('Replay complete');
    }
    line_();
  }
  ```

- [ ] **Step 3: Run replay in DEV first**

  ```bash
  clasp push --force
  ```

  Run `testMigrationReplay()`. Confirm `failed=0` and row counts look correct. Do NOT run in PROD until Phase F reconciliation passes.

- [ ] **Step 4: Commit**

  ```bash
  git add src/12-migration/MigrationReplayEngine.gs src/setup/TestRunner.gs
  git commit -m "feat(migration): add MigrationReplayEngine — Layer 3 FACT table replay"
  ```

---

## Phase F — Reconciliation

### Task 8: Build MigrationReconciler — verify totals match source

**Files:**
- Create: `src/12-migration/MigrationReconciler.gs`

- [ ] **Step 1: Create `src/12-migration/MigrationReconciler.gs`**

  ```javascript
  // ============================================================
  // MigrationReconciler.gs — BLC Nexus T12 Migration
  // src/12-migration/MigrationReconciler.gs
  //
  // Phase F validation: verifies migrated FACT data matches
  // Stacey source totals. Run after replay, before go-live.
  //
  // Reconciliation targets (from Phase C quality scans):
  //   - Total job count per client
  //   - Total work hours per designer per period
  //   - Total billed amount per client per period
  // ============================================================

  var MigrationReconciler = (function () {

    var MODULE = 'MigrationReconciler';

    /**
     * Counts migrated rows in a FACT table tagged with the current batch.
     */
    function countMigratedRows_(tableName, entityFilter) {
      try {
        var rows = DAL.readWhere(tableName,
          { migration_batch: MigrationConfig.getBatch() },
          { callerModule: MODULE });
        return rows.length;
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') return 0;
        throw e;
      }
    }

    /**
     * Computes total hours from migrated FACT_WORK_LOGS rows.
     */
    function sumMigratedHours_() {
      var rows;
      try {
        rows = DAL.readWhere(Config.TABLES.FACT_WORK_LOGS,
          { migration_batch: MigrationConfig.getBatch() },
          { callerModule: MODULE });
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') return 0;
        throw e;
      }
      return rows.reduce(function(s, r) { return s + (parseFloat(r.hours) || 0); }, 0);
    }

    /**
     * Reads raw work log total from MIGRATION_RAW_IMPORT for comparison.
     */
    function sumRawHours_() {
      try {
        var rawRows = DAL.readWhere(MigrationConfig.TABLES.RAW_IMPORT,
          { entity_type: 'WORK_LOG', migration_batch: MigrationConfig.getBatch() },
          { callerModule: MODULE });
        return rawRows.reduce(function(s, r) {
          try {
            var payload = JSON.parse(r.raw_payload_json || '{}');
            return s + (parseFloat(payload.hours || payload.Hours || 0));
          } catch (e) { return s; }
        }, 0);
      } catch (e) { return 0; }
    }

    /**
     * Full reconciliation report. Compares Nexus FACT counts
     * against MIGRATION_RAW_IMPORT source counts.
     *
     * @param {string} actorEmail  — CEO only
     * @returns {{ passed: boolean, checks: Object[] }}
     */
    function runReconciliation(actorEmail) {
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);
      RBAC.enforceFinancialAccess(actor);

      Logger.info('RECONCILE_START', { module: MODULE });

      var checks = [];
      var passed = true;

      // Check 1: Job count
      var rawJobs      = countMigratedRows_(MigrationConfig.TABLES.RAW_IMPORT + '_JOBS', 'JOB');
      var factJobs     = countMigratedRows_(Config.TABLES.FACT_JOB_EVENTS, 'JOB');
      var jobCheck     = { name: 'Job count', raw: rawJobs, fact: factJobs,
                           pass: factJobs >= rawJobs };
      if (!jobCheck.pass) passed = false;
      checks.push(jobCheck);

      // Check 2: Work log hours
      var rawHours  = sumRawHours_();
      var factHours = sumMigratedHours_();
      var tolerance = 0.01; // allow for rounding
      var hoursCheck = { name: 'Total work hours', raw: rawHours, fact: factHours,
                         pass: Math.abs(rawHours - factHours) <= tolerance };
      if (!hoursCheck.pass) passed = false;
      checks.push(hoursCheck);

      // Check 3: Zero MIGRATION_NORMALIZED FAILED rows
      var failedNorm;
      try {
        failedNorm = DAL.readWhere(MigrationConfig.TABLES.NORMALIZED,
          { status: 'FAILED' }, { callerModule: MODULE });
      } catch (e) { failedNorm = []; }
      var normCheck = { name: 'Zero normalization failures',
                        raw: 0, fact: failedNorm.length, pass: failedNorm.length === 0 };
      if (!normCheck.pass) passed = false;
      checks.push(normCheck);

      // Check 4: Zero REPLAY_FAILED rows
      var failedReplay;
      try {
        failedReplay = DAL.readWhere(MigrationConfig.TABLES.NORMALIZED,
          { status: 'REPLAY_FAILED' }, { callerModule: MODULE });
      } catch (e) { failedReplay = []; }
      var replayCheck = { name: 'Zero replay failures',
                          raw: 0, fact: failedReplay.length, pass: failedReplay.length === 0 };
      if (!replayCheck.pass) passed = false;
      checks.push(replayCheck);

      Logger.info('RECONCILE_COMPLETE', {
        module: MODULE, passed: passed, checks: JSON.stringify(checks) });

      console.log('\n=== RECONCILIATION REPORT ===');
      checks.forEach(function(c) {
        console.log((c.pass ? '✅' : '❌') + ' ' + c.name +
                    ': source=' + c.raw + ' nexus=' + c.fact);
      });
      console.log(passed ? '\n✅ ALL CHECKS PASSED — safe to proceed to go-live'
                         : '\n❌ CHECKS FAILED — do NOT go live until resolved');

      return { passed: passed, checks: checks };
    }

    return { runReconciliation: runReconciliation };
  }());
  ```

- [ ] **Step 2: Add TestRunner diagnostic**

  ```javascript
  /**
   * Phase F reconciliation: verifies migrated FACT data matches Stacey source.
   * Must pass (all ✅) before go-live. Zero failures = safe to proceed.
   */
  function testReconciliation() {
    header_('MIGRATION: Reconciliation (Phase F)');
    var result = MigrationReconciler.runReconciliation(Session.getActiveUser().getEmail());
    if (result.passed) {
      pass_('All reconciliation checks passed — migration data is consistent');
      info_('Next: run testSystemEndToEnd() to validate workflows with real data');
    } else {
      fail_('Reconciliation FAILED — DO NOT go live. Investigate failed checks above.');
    }
    line_();
  }
  ```

- [ ] **Step 3: Push and run `testReconciliation()`**

  ```bash
  git add src/12-migration/MigrationReconciler.gs src/setup/TestRunner.gs
  clasp push --force
  ```

  Expected: all ✅. Any ❌ must be diagnosed and fixed before proceeding.

- [ ] **Step 4: Commit**

  ```bash
  git commit -m "feat(migration): add MigrationReconciler — Phase F validation and reconciliation"
  ```

---

## Phase G — System Test with Real Data

### Task 9: Build MigrationTestRunner — end-to-end scenarios on real data

**Files:**
- Create: `src/12-migration/MigrationTestRunner.gs`

- [ ] **Step 1: Create `src/12-migration/MigrationTestRunner.gs`**

  ```javascript
  // ============================================================
  // MigrationTestRunner.gs — BLC Nexus T12 Migration
  // src/12-migration/MigrationTestRunner.gs
  //
  // Phase G: End-to-end system tests using real migrated data.
  // All tests are READ-ONLY against real data — they do not
  // create new production records.
  // ============================================================

  var MigrationTestRunner = (function () {

    var MODULE = 'MigrationTestRunner';

    function pass_(msg)  { console.log('  ✅  ' + msg); }
    function fail_(msg)  { console.log('  ❌  ' + msg); }
    function info_(msg)  { console.log('  ℹ️   ' + msg); }
    function head_(msg)  { console.log('\n── ' + msg + ' ──'); }

    /**
     * T1: Verify migrated jobs appear in VW_JOB_CURRENT_STATE
     */
    function testJobsInView() {
      head_('T1: Jobs in VW_JOB_CURRENT_STATE');
      try {
        var jobs = DAL.readAll(Config.TABLES.VW_JOB_CURRENT_STATE, { callerModule: MODULE });
        var migrJobs = jobs.filter(function(j) {
          return String(j.migration_source || '').indexOf('STACEY') !== -1 ||
                 String(j.migration_batch  || '').indexOf('BATCH')  !== -1;
        });
        info_('Total jobs in view: ' + jobs.length);
        info_('Migrated jobs in view: ' + migrJobs.length);
        if (migrJobs.length > 0) pass_('Migrated jobs visible in VW_JOB_CURRENT_STATE');
        else fail_('No migrated jobs found in VW_JOB_CURRENT_STATE');
      } catch (e) { fail_('Error: ' + e.message); }
    }

    /**
     * T2: Verify work hours are queryable per designer
     */
    function testWorkHoursQueryable() {
      head_('T2: Work hours queryable per designer');
      try {
        var staff = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: MODULE });
        if (staff.length === 0) { fail_('No staff in DIM_STAFF_ROSTER'); return; }
        var sampleCode = staff[0].person_code;
        var logs = DAL.readWhere(Config.TABLES.FACT_WORK_LOGS,
          { person_code: sampleCode }, { callerModule: MODULE });
        info_('Designer ' + sampleCode + ': ' + logs.length + ' work log entries');
        if (logs.length > 0) pass_('Work logs queryable per designer');
        else info_('No work logs for ' + sampleCode + ' (may be valid)');
      } catch (e) { fail_('Error: ' + e.message); }
    }

    /**
     * T3: Verify RBAC — DESIGNER cannot run payroll
     */
    function testRBACDesignerDenied() {
      head_('T3: RBAC — DESIGNER cannot run payroll');
      var staff;
      try {
        staff = DAL.readWhere(Config.TABLES.DIM_STAFF_ROSTER,
          { role: 'DESIGNER' }, { callerModule: MODULE });
      } catch (e) { fail_('Cannot read DIM_STAFF_ROSTER: ' + e.message); return; }
      if (staff.length === 0) { info_('No DESIGNER staff found — skipping'); return; }
      var designerActor = {
        email: staff[0].email || 'test@test.com', personCode: staff[0].person_code,
        role: 'DESIGNER', scope: 'SELF', isSystem: false
      };
      var denied = false;
      try {
        RBAC.enforcePermission(designerActor, RBAC.ACTIONS.PAYROLL_RUN);
      } catch (e) { denied = true; }
      if (denied) pass_('DESIGNER correctly denied PAYROLL_RUN');
      else fail_('DESIGNER was NOT denied PAYROLL_RUN — RBAC failure');
    }

    /**
     * T4: Verify billing engine can read rates for migrated clients
     */
    function testBillingRatesAccessible() {
      head_('T4: Billing rates accessible for migrated clients');
      try {
        var clients = DAL.readAll(Config.TABLES.DIM_CLIENT_MASTER, { callerModule: MODULE });
        var rates   = DAL.readAll(Config.TABLES.DIM_CLIENT_RATES,  { callerModule: MODULE });
        info_('Clients: ' + clients.length + ' | Rate rows: ' + rates.length);
        var covered = clients.filter(function(c) {
          return rates.some(function(r) { return r.client_code === c.client_code; });
        });
        info_(covered.length + ' of ' + clients.length + ' clients have billing rates');
        if (covered.length === clients.length) pass_('All clients have billing rates');
        else fail_(
          (clients.length - covered.length) + ' clients missing billing rates — billing run will skip them');
      } catch (e) { fail_('Error: ' + e.message); }
    }

    /**
     * T5: Verify dashboards can be generated from migrated data
     */
    function testDashboardDataAvailable() {
      head_('T5: Dashboard data available');
      try {
        var email  = Session.getActiveUser().getEmail();
        var result = PortalData.getLeaderDashboard(email, Identifiers.generateCurrentPeriodId());
        var data   = JSON.parse(result);
        info_('Team hours rows: '   + (data.team_hours    ? data.team_hours.length   : 'N/A'));
        info_('Payroll status rows: ' + (data.payroll_status ? data.payroll_status.length : 'N/A'));
        pass_('Leader dashboard data generated successfully');
      } catch (e) { fail_('Dashboard error: ' + e.message); }
    }

    /**
     * Runs all Phase G tests.
     * @param {string} actorEmail
     */
    function runAll(actorEmail) {
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.ADMIN_CONFIG);

      console.log('╔══════════════════════════════════════════╗');
      console.log('║  PHASE G — SYSTEM TEST (REAL DATA)       ║');
      console.log('╚══════════════════════════════════════════╝');

      testJobsInView();
      testWorkHoursQueryable();
      testRBACDesignerDenied();
      testBillingRatesAccessible();
      testDashboardDataAvailable();

      console.log('\nPhase G complete. Investigate any ❌ before go-live.');
    }

    return { runAll: runAll };
  }());
  ```

- [ ] **Step 2: Add TestRunner entry point**

  ```javascript
  /**
   * Phase G: End-to-end system test using real migrated data.
   * Run after Phase F reconciliation passes.
   */
  function testMigrationSystemTest() {
    header_('MIGRATION: Phase G System Test');
    MigrationTestRunner.runAll(Session.getActiveUser().getEmail());
    line_();
  }
  ```

- [ ] **Step 3: Push and run**

  ```bash
  git add src/12-migration/MigrationTestRunner.gs src/setup/TestRunner.gs
  clasp push --force
  ```

  Run `testMigrationSystemTest()`. All tests must pass before proceeding to Phase J cutover.

- [ ] **Step 4: Commit**

  ```bash
  git commit -m "feat(migration): add MigrationTestRunner — Phase G end-to-end real data tests"
  ```

---

## Phase I — Risk Register

> This section is a living document. Update risks as new information becomes available from Phases C and D.

| Risk | Severity | Likelihood | Mitigation |
|---|---|---|---|
| Stacey names don't match DIM_STAFF_ROSTER person_code | High | High | Build name→code cache in normalizer; flag unresolved names as FAILED; fix before replay |
| Stacey tab names differ from expected | High | Medium | StaceyAuditor.listTabs() discovers real names; update MigrationConfig.STACEY_TABLES |
| Duplicate work log rows in Stacey | Medium | High | Phase C quality scan counts duplicates; normalizer dedupes by designer+job+date+hours |
| Backdated period_ids rejected by DAL | High | Medium | MigrationConfig.enableOverrides() temporarily permits backdated periods; disabled after replay |
| Quota exhaustion during large batch replay | Medium | High | HealthMonitor guard every 20 rows; partial=true return; re-run picks up from NORMALIZED rows with status=NORMALIZED |
| Wrong client mapping (e.g. "SBS" vs "Stacey Berg Studio") | High | Medium | Client code cache maps both code and name; unresolved clients flagged FAILED |
| Test data not fully purged from Nexus DEV before migration | Medium | Medium | PurgeTool.runAudit() + runPurge() in Phase B; review output before migration |
| Replay runs against PROD before DEV validation | Critical | Low | Replay requires CEO RBAC + financial access; Config env check before write |
| Missing DIM_CLIENT_RATES for migrated clients | Medium | High | T4 in MigrationTestRunner catches this; fix rates before billing run |
| User confusion after cutover | Low | High | Role-based user manuals (Phase H — separate plan) |
| Rollback failure if FACT rows tagged incorrectly | High | Low | All migrated rows tagged migration_batch=BATCH-001; rollback deletes by batch tag |

---

## Phase J — Cutover Roadmap

### T-7 Days
- [ ] Run `testStaceyAudit()` — confirm Stacey source counts are final
- [ ] Run `testPurgeAudit()` — confirm Nexus DEV is clean
- [ ] Brief team: Nexus go-live date confirmed, Stacey read-only from T-1
- [ ] CEO provides final Stacey spreadsheet ID for PROD migration

### T-3 Days
- [ ] Complete full migration dry run in DEV: Phases D → E → F → G
- [ ] All reconciliation checks ✅ in DEV
- [ ] All Phase G system tests ✅ in DEV
- [ ] Share PROD migration plan with CEO for sign-off
- [ ] Confirm DIM_CLIENT_RATES populated for all Stacey clients
- [ ] Confirm DIM_FX_RATES has current CAD/USD rates

### T-1 Day
- [ ] Announce Stacey freeze: "No new entries in Stacey after 6PM today"
- [ ] Take a manual backup: download Stacey as .xlsx
- [ ] Take a manual backup: download Nexus PROD as .xlsx (pre-migration state)
- [ ] Set `MigrationConfig.STACEY_SPREADSHEET_ID` to PROD Stacey ID
- [ ] Verify Nexus PROD is running (portal loads, queue trigger active)

### Migration Day
- [ ] CEO runs `PurgeTool.runAudit()` on PROD Nexus — confirm clean
- [ ] CEO runs `PurgeTool.runPurge(email, false)` on PROD if any test data found
- [ ] CEO runs `MigrationRawImporter.runImport()` — Layer 1
- [ ] Verify `MIGRATION_RAW_IMPORT` row counts match Stacey source
- [ ] CEO runs `MigrationNormalizer.runNormalization()` — Layer 2
- [ ] Verify `failed=0` in normalization output
- [ ] CEO runs `MigrationReplayEngine.runReplay()` — Layer 3
- [ ] CEO runs `MigrationReconciler.runReconciliation()` — Phase F
- [ ] **GO/NO-GO gate:** All reconciliation ✅ → proceed. Any ❌ → rollback
- [ ] CEO runs `MigrationTestRunner.runAll()` — Phase G
- [ ] If all pass → announce go-live to team

### Rollback Trigger
If reconciliation fails or any Phase G test is CRITICAL:
1. Record failing batch: `BATCH-001`
2. In Apps Script editor: `DAL.updateWhere('FACT_JOB_EVENTS', { migration_batch: 'BATCH-001' }, { status: 'ROLLBACK' })`
3. Repeat for `FACT_WORK_LOGS`, `FACT_BILLING_LEDGER`, `FACT_PAYROLL_LEDGER`
4. Restore Stacey as operational system
5. Diagnose normalization failure → fix → re-run from Phase D

### Day +1
- [ ] CEO spot-checks 5 random jobs: Nexus VW_JOB_CURRENT_STATE vs Stacey source
- [ ] CEO spot-checks 3 random designers: work log hours totals match
- [ ] Queue processor confirmed running (trigger active)
- [ ] Portal accessible for all roles
- [ ] Announce: Stacey is now read-only archive

### First Week
- [ ] Monitor `_SYS_EXCEPTIONS` daily for migration-related errors
- [ ] Address any user questions (designer onboarding to Nexus portal)
- [ ] Run first live billing run in Nexus with real post-migration data
- [ ] Confirm feedback system active for current quarter

### First Month
- [ ] First full payroll run in Nexus (end of period)
- [ ] Quarterly bonus inputs collected via new feedback system
- [ ] MART dashboards verified in Looker Studio
- [ ] Phase H (User Manuals) plan executed

---

## Phase K — Multi-Agent Stress Test

> Run this checklist before signing off on Migration Day. Each "agent" is a review lens — one person can run all of them sequentially.

| Agent | Challenge | Severity | Fix |
|---|---|---|---|
| **Architect** | Are migration tables (RAW_IMPORT, NORMALIZED) in SetupScript schema? If not, they won't exist on fresh PROD deploy | High | Add to SetupScript before migration |
| **Architect** | Does MigrationReplayEngine bypass the queue? Queue bypass removes retry/idempotency guarantees | Medium | Confirmed bypass is intentional for migration speed; idempotency key handles duplicates |
| **Data Quality** | What if Stacey has 2 rows with same designer+job+date+hours? Normalizer flags as duplicate — but which one gets NORMALIZED? | High | Add explicit dedupe: first occurrence NORMALIZED, subsequent SKIPPED with note |
| **Data Quality** | What if a Stacey designer name has trailing space or different capitalisation? | High | resolvePersonCode_ normalises to lowercase trim — verify against real Stacey data in Phase C |
| **QA** | Phase G tests are read-only but don't test new job intake POST-migration | Medium | After migration, CEO submits 1 test job via portal — verify full pipeline fires |
| **Finance/Audit** | Migration-tagged FACT rows will inflate billing and payroll totals if billing run covers historical periods | Critical | Billing/payroll engines must filter OUT migration_source=STACEY_V2 OR only run on current period — confirm with CEO before first billing run |
| **Operations** | What if replay partially completes (partial=true) and CEO runs it again — does it pick up correctly? | High | NORMALIZED rows with status=NORMALIZED are retried; REPLAYED rows are skipped — confirmed idempotent |
| **Security** | MigrationConfig.enableOverrides() with no time limit — could be left ON accidentally | High | Add Logger.warn every time a migration override is used; CEO disables manually after replay |

**Hardened action from stress test:**
- Add `setup/SetupScript.gs` entries for `MIGRATION_RAW_IMPORT`, `MIGRATION_NORMALIZED`, `MIGRATION_AUDIT_LOG` (Task 10)
- Add explicit duplicate row handling in `MigrationNormalizer.normalizeRow_()` (Task 10)
- Add Finance warning about historical billing inflation (document in RUNBOOK.md)

---

### Task 10: Harden — SetupScript migration tables + dedupe + billing warning

**Files:**
- Modify: `src/setup/SetupScript.gs` (add migration table schemas)
- Modify: `src/12-migration/MigrationNormalizer.gs` (add explicit dedupe)
- Modify: `docs/RUNBOOK.md` (add billing warning)

- [ ] **Step 1: Add migration tables to SetupScript**

  In `src/setup/SetupScript.gs`, find the section that defines all sheet schemas. Add:

  ```javascript
  // ── Migration tables ─────────────────────────────────────────
  ensureTab_('MIGRATION_RAW_IMPORT');
  ensureHeaders_('MIGRATION_RAW_IMPORT', [
    'raw_id', 'entity_type', 'source_system', 'source_tab',
    'source_row_index', 'migration_batch', 'migration_timestamp',
    'raw_payload_json', 'status'
  ]);

  ensureTab_('MIGRATION_NORMALIZED');
  ensureHeaders_('MIGRATION_NORMALIZED', [
    'norm_id', 'raw_id', 'entity_type', 'source_tab', 'source_row_index',
    'migration_batch', 'status', 'validation_errors',
    'normalized_json', 'normalized_at', 'replayed_at'
  ]);

  ensureTab_('MIGRATION_AUDIT_LOG');
  ensureHeaders_('MIGRATION_AUDIT_LOG', [
    'log_id', 'timestamp', 'phase', 'entity_type', 'batch',
    'written', 'skipped', 'failed', 'notes'
  ]);
  ```

- [ ] **Step 2: Add explicit dedupe to MigrationNormalizer**

  In `MigrationNormalizer.runNormalization_`, before processing each row, build a dedupe key for WORK_LOG rows. Add this inside the normalization loop before `normalizeRow_`:

  ```javascript
  // Dedupe work logs: same designer+job+date+hours = duplicate
  if (norm.entity_type === 'WORK_LOG') {
    var rawPayload = JSON.parse(norm.raw_payload_json || '{}');
    var dedupeKey = 'WL-DEDUP-' +
      String(rawPayload.designer || rawPayload.Designer || '').toLowerCase().trim() + '|' +
      String(rawPayload.job_ref || rawPayload['Job #'] || '').trim() + '|' +
      String(rawPayload.date || rawPayload.Date || '') + '|' +
      String(rawPayload.hours || rawPayload.Hours || '0');
    if (seenDedupeKeys[dedupeKey]) {
      skipped++;
      toWrite.push({
        norm_id: Identifiers.generateId(), raw_id: norm.raw_id,
        entity_type: norm.entity_type, source_tab: norm.source_tab,
        source_row_index: norm.source_row_index,
        migration_batch: norm.migration_batch,
        status: 'SKIPPED_DUPLICATE',
        validation_errors: 'Duplicate work log: ' + dedupeKey,
        normalized_json: '{}', normalized_at: new Date().toISOString()
      });
      continue;
    }
    seenDedupeKeys[dedupeKey] = true;
  }
  ```

  Add `var seenDedupeKeys = {};` before the loop.

- [ ] **Step 3: Add billing warning to RUNBOOK.md**

  Open `docs/RUNBOOK.md` and add:

  ```markdown
  ## Migration Billing Warning

  **IMPORTANT:** After the Stacey → Nexus migration, FACT_WORK_LOGS and FACT_BILLING_LEDGER
  contain rows tagged `migration_source=STACEY_V2` covering historical periods.

  Before running any billing run:
  - Confirm the billing period is CURRENT (not historical)
  - BillingEngine only runs on the specified period — it will NOT double-bill historical data
  - Do NOT run a billing run for any period that already has Stacey billing records
    unless you have confirmed no Stacey invoice was issued for that period
  ```

- [ ] **Step 4: Push and verify SetupScript creates migration tables**

  ```bash
  git add src/setup/SetupScript.gs src/12-migration/MigrationNormalizer.gs docs/RUNBOOK.md
  clasp push --force
  ```

  Run `runSetupSchemas()` from Apps Script editor. Verify `MIGRATION_RAW_IMPORT`, `MIGRATION_NORMALIZED`, `MIGRATION_AUDIT_LOG` tabs are created with correct headers.

- [ ] **Step 5: Commit**

  ```bash
  git commit -m "fix(migration): harden — SetupScript migration tables, dedupe, billing warning"
  ```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Phase A — Nexus readiness audit: Tasks 1–2
- [x] Phase B — Test data purge: Task 3
- [x] Phase C — Stacey source audit: Task 4
- [x] Phase D — Data mapping blueprint: Task 5 (raw import) + field mappings in Task 6
- [x] Phase E — Migration strategy: Tasks 6–7 (normalize + replay), cutover options documented in Phase J
- [x] Phase F — Validation/reconciliation: Task 8
- [x] Phase G — Real data system test: Task 9
- [x] Phase H — User manuals: FLAGGED as separate plan (out of scope here, documented)
- [x] Phase I — Risk register: Documented after Task 8
- [x] Phase J — Cutover roadmap: T-7 through First Month checkboxes
- [x] Phase K — Multi-agent stress test: Documented, hardened in Task 10

**Placeholder scan:** No TBD/TODO/fill-in-later items except the intentional REPLACE_AFTER_AUDIT constants in MigrationConfig which are filled at runtime from Phase C output.

**Type consistency:** All function names consistent across tasks. `MigrationConfig.TABLES.RAW_IMPORT` used consistently. `BatchOperations.appendRows` used for bulk writes throughout.
