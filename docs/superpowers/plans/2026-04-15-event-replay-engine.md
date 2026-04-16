# EventReplayEngine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build EventReplayEngine — a CEO-only recovery tool that rebuilds VW_JOB_CURRENT_STATE and VW_DESIGNER_WORKLOAD by replaying all FACT table events from scratch.

**Architecture:** Single-pass sequential replay. Discover all FACT partition tabs via regex scan, read oldest-first, fold events into in-memory maps, then clear-and-rewrite each VW table in one batch. CEO-only via PAYROLL_RUN + enforceFinancialAccess gate.

**Tech Stack:** Google Apps Script (V8), DAL (including DAL.appendRows for batch writes), RBAC, HealthMonitor, SpreadsheetApp (clear exception — same pattern as BillingEngine).

---

## Files

| File | Change |
|---|---|
| `src/11-reporting/EventReplayEngine.gs` | Create — all replay logic |
| `src/07-portal/Portal.gs` | Add `portal_rebuildViews()` after `portal_runAnnualBonus` |
| `src/07-portal/PortalView.html` | Button HTML, event listener, allBtns, visibility ×2, JS handler |
| `src/setup/TestRunner.gs` | Append `testEventReplay()` at end of file |

---

## Task 1: Create EventReplayEngine.gs

**Files:**
- Create: `src/11-reporting/EventReplayEngine.gs`

- [x] **Step 1: Create the file with module header and skeleton**

  Create `src/11-reporting/EventReplayEngine.gs` with this exact content:

  ```javascript
  // ============================================================
  // EventReplayEngine.gs — BLC Nexus T11 Reporting
  // src/11-reporting/EventReplayEngine.gs
  //
  // LOAD ORDER: T11. Loads after all T0–T10 files.
  // DEPENDENCIES: Config (T0), Constants (T0), DAL (T1),
  //               RBAC (T2), Logger (T3), HealthMonitor (T3)
  //
  // ╔══════════════════════════════════════════════════════════╗
  // ║  CEO-triggered recovery tool.                           ║
  // ║  Rebuilds VW_JOB_CURRENT_STATE and VW_DESIGNER_WORKLOAD ║
  // ║  by replaying all FACT_JOB_EVENTS and FACT_WORK_LOGS    ║
  // ║  partitions from scratch.                               ║
  // ║                                                         ║
  // ║  Not a routine operation — run only when VW tables      ║
  // ║  are suspected to be corrupted or out of sync.          ║
  // ║                                                         ║
  // ║  Entry point:                                           ║
  // ║    rebuildAllViews(actorEmail)                          ║
  // ║                                                         ║
  // ║  Permission: PAYROLL_RUN + enforceFinancialAccess (CEO) ║
  // ║                                                         ║
  // ║  NOTE: Uses SpreadsheetApp.getSheetByName().deleteRows()║
  // ║  to clear VW sheets — same known A2 exception as        ║
  // ║  BillingEngine/PayrollEngine. DAL has no clearSheet().  ║
  // ║  TODO: migrate when DAL.clearSheet() is implemented.    ║
  // ║                                                         ║
  // ║  FUTURE: migrate portal button to AdminConsole (T13)    ║
  // ║  when that module is built.                             ║
  // ╚══════════════════════════════════════════════════════════╝

  var EventReplayEngine = (function () {

    var MODULE = 'EventReplayEngine';

    // ============================================================
    // SECTION 1: PARTITION DISCOVERY
    // ============================================================

    /**
     * Scans the active spreadsheet for tab names matching
     * `BASE_TABLE_NAME|YYYY-MM` and returns the period IDs
     * sorted ascending (oldest first).
     *
     * @param {string} baseTableName  e.g. 'FACT_JOB_EVENTS'
     * @returns {string[]}  e.g. ['2025-11', '2025-12', '2026-01']
     */
    function discoverPartitions_(baseTableName) {
      var ss      = SpreadsheetApp.getActiveSpreadsheet();
      var sheets  = ss.getSheets();
      var prefix  = baseTableName + '|';
      var periods = [];
      for (var i = 0; i < sheets.length; i++) {
        var name = sheets[i].getName();
        if (name.indexOf(prefix) === 0) {
          var period = name.substring(prefix.length);
          if (/^\d{4}-\d{2}$/.test(period)) {
            periods.push(period);
          }
        }
      }
      periods.sort();
      return periods;
    }

    // ============================================================
    // SECTION 2: SHEET CLEAR
    // ============================================================

    /**
     * Clears all data rows from a sheet (keeps header row 1).
     * Returns the number of rows cleared, or 0 if sheet is
     * empty or missing.
     *
     * NOTE: Uses SpreadsheetApp directly — known A2 exception.
     * Same pattern as BillingEngine.refreshMartBillingSummary_().
     *
     * @param {string} sheetName  e.g. 'VW_JOB_CURRENT_STATE'
     * @returns {number}  rows cleared
     */
    function clearSheet_(sheetName) {
      var ss    = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet || sheet.getLastRow() <= 1) return 0;
      var rowCount = sheet.getLastRow() - 1;
      sheet.deleteRows(2, rowCount);
      return rowCount;
    }

    // ============================================================
    // SECTION 3: REBUILD VW_JOB_CURRENT_STATE
    // ============================================================

    /**
     * Replays all FACT_JOB_EVENTS partitions (oldest first) into
     * an in-memory job map, then clears and rewrites
     * VW_JOB_CURRENT_STATE in one BatchOperations call.
     *
     * @param {number} startMs  Date.now() from rebuildAllViews_ — for elapsed_ms
     * @returns {{ written: number, cleared: number, partial: boolean }}
     */
    function rebuildJobView_(startMs) {
      var periods = discoverPartitions_(Config.TABLES.FACT_JOB_EVENTS);
      var jobMap  = {};  // keyed by job_number

      for (var p = 0; p < periods.length; p++) {
        var periodId = periods[p];
        var rows;
        try {
          rows = DAL.readAll(Config.TABLES.FACT_JOB_EVENTS, {
            callerModule: MODULE,
            periodId:     periodId
          });
        } catch (e) {
          if (e.code === 'SHEET_NOT_FOUND') {
            Logger.warn('REPLAY_PARTITION_SKIPPED', {
              module: MODULE, table: Config.TABLES.FACT_JOB_EVENTS, periodId: periodId
            });
            continue;
          }
          throw e;
        }

        for (var i = 0; i < rows.length; i++) {
          if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
            Logger.warn('REPLAY_QUOTA_CUTOFF', {
              module: MODULE, processed: i, period: periodId
            });
            return { written: 0, cleared: 0, partial: true };
          }
          foldJobEvent_(jobMap, rows[i]);
        }
      }

      // Clear VW then batch-write all rebuilt rows
      var cleared = clearSheet_(Config.TABLES.VW_JOB_CURRENT_STATE);
      var vwRows  = objectValues_(jobMap);
      if (vwRows.length > 0) {
        DAL.appendRows(Config.TABLES.VW_JOB_CURRENT_STATE, vwRows, { callerModule: MODULE });
      }

      Logger.info('REPLAY_JOB_VIEW_REBUILT', {
        module: MODULE, written: vwRows.length, cleared: cleared
      });

      return { written: vwRows.length, cleared: cleared, partial: false };
    }

    /**
     * Applies a single FACT_JOB_EVENTS row to the in-memory job map.
     * Mutates jobMap in place.
     *
     * @param {Object} jobMap  keyed by job_number
     * @param {Object} row     one FACT_JOB_EVENTS row
     */
    function foldJobEvent_(jobMap, row) {
      var jobNumber = String(row.job_number  || '').trim();
      var eventType = String(row.event_type  || '').trim();
      var updatedAt = String(row.timestamp   || '').trim();
      if (!jobNumber) return;

      switch (eventType) {

        case 'JOB_CREATED':
          jobMap[jobNumber] = {
            job_number:          jobNumber,
            client_code:         String(row.client_code    || ''),
            job_type:            String(row.job_type       || ''),
            product_code:        String(row.product_code   || ''),
            quantity:            parseFloat(row.quantity)  || 0,
            current_state:       row.allocated_to
                                   ? Config.STATES.ALLOCATED
                                   : Config.STATES.INTAKE_RECEIVED,
            prev_state:          '',
            allocated_to:        String(row.allocated_to   || ''),
            period_id:           String(row.period_id      || ''),
            created_at:          updatedAt,
            updated_at:          updatedAt,
            rework_cycle:        0,
            client_return_count: 0
          };
          break;

        case 'JOB_STARTED':
          if (!jobMap[jobNumber]) break;
          jobMap[jobNumber].prev_state   = jobMap[jobNumber].current_state;
          jobMap[jobNumber].current_state = Config.STATES.IN_PROGRESS;
          jobMap[jobNumber].allocated_to  = String(row.allocated_to || jobMap[jobNumber].allocated_to);
          jobMap[jobNumber].updated_at    = updatedAt;
          break;

        case 'JOB_HELD':
          if (!jobMap[jobNumber]) break;
          jobMap[jobNumber].prev_state    = jobMap[jobNumber].current_state;
          jobMap[jobNumber].current_state = Config.STATES.ON_HOLD;
          jobMap[jobNumber].updated_at    = updatedAt;
          break;

        case 'JOB_RESUMED':
          if (!jobMap[jobNumber]) break;
          jobMap[jobNumber].current_state = jobMap[jobNumber].prev_state;
          jobMap[jobNumber].prev_state    = Config.STATES.ON_HOLD;
          jobMap[jobNumber].updated_at    = updatedAt;
          break;

        case 'QC_SUBMITTED':
          if (!jobMap[jobNumber]) break;
          jobMap[jobNumber].current_state = Config.STATES.QC_REVIEW;
          jobMap[jobNumber].updated_at    = updatedAt;
          break;

        case 'QC_APPROVED':
          if (!jobMap[jobNumber]) break;
          jobMap[jobNumber].current_state = Config.STATES.COMPLETED_BILLABLE;
          jobMap[jobNumber].updated_at    = updatedAt;
          break;

        case 'QC_REWORK_REQUESTED':
          if (!jobMap[jobNumber]) break;
          jobMap[jobNumber].current_state      = Config.STATES.IN_PROGRESS;
          jobMap[jobNumber].rework_cycle       = (jobMap[jobNumber].rework_cycle || 0) + 1;
          jobMap[jobNumber].client_return_count = (jobMap[jobNumber].client_return_count || 0) + 1;
          jobMap[jobNumber].updated_at          = updatedAt;
          break;

        case 'INVOICED':
          if (!jobMap[jobNumber]) break;
          jobMap[jobNumber].current_state = Config.STATES.INVOICED;
          jobMap[jobNumber].updated_at    = updatedAt;
          break;

        default:
          Logger.warn('REPLAY_UNKNOWN_EVENT', {
            module: MODULE, event_type: eventType, job_number: jobNumber
          });
          break;
      }
    }

    // ============================================================
    // SECTION 4: REBUILD VW_DESIGNER_WORKLOAD
    // ============================================================

    /**
     * Aggregates all FACT_WORK_LOGS partitions into an in-memory
     * workload map, then clears and rewrites VW_DESIGNER_WORKLOAD.
     *
     * @returns {{ written: number, cleared: number, partial: boolean }}
     */
    function rebuildWorkloadView_() {
      var periods     = discoverPartitions_(Config.TABLES.FACT_WORK_LOGS);
      var workloadMap = {};  // keyed by 'person_code|period_id'

      for (var p = 0; p < periods.length; p++) {
        var periodId = periods[p];
        var rows;
        try {
          rows = DAL.readAll(Config.TABLES.FACT_WORK_LOGS, {
            callerModule: MODULE,
            periodId:     periodId
          });
        } catch (e) {
          if (e.code === 'SHEET_NOT_FOUND') {
            Logger.warn('REPLAY_PARTITION_SKIPPED', {
              module: MODULE, table: Config.TABLES.FACT_WORK_LOGS, periodId: periodId
            });
            continue;
          }
          throw e;
        }

        for (var i = 0; i < rows.length; i++) {
          if (i % 20 === 0 && HealthMonitor.isApproachingLimit()) {
            Logger.warn('REPLAY_QUOTA_CUTOFF', {
              module: MODULE, processed: i, period: periodId, table: 'FACT_WORK_LOGS'
            });
            return { written: 0, cleared: 0, partial: true };
          }

          var code = String(rows[i].person_code || '').trim();
          var pid  = String(rows[i].period_id   || '').trim();
          var qty  = parseFloat(rows[i].quantity) || 0;
          var ts   = String(rows[i].timestamp    || '');
          if (!code || !pid) continue;

          var key = code + '|' + pid;
          if (!workloadMap[key]) {
            workloadMap[key] = {
              person_code:    code,
              period_id:      pid,
              job_count:      0,
              total_quantity: 0,
              last_updated:   ts
            };
          }
          workloadMap[key].job_count++;
          workloadMap[key].total_quantity += qty;
          if (ts > workloadMap[key].last_updated) workloadMap[key].last_updated = ts;
        }
      }

      var cleared    = clearSheet_(Config.TABLES.VW_DESIGNER_WORKLOAD);
      var wlRows     = objectValues_(workloadMap);
      if (wlRows.length > 0) {
        DAL.appendRows(Config.TABLES.VW_DESIGNER_WORKLOAD, wlRows, { callerModule: MODULE });
      }

      Logger.info('REPLAY_WORKLOAD_VIEW_REBUILT', {
        module: MODULE, written: wlRows.length, cleared: cleared
      });

      return { written: wlRows.length, cleared: cleared, partial: false };
    }

    // ============================================================
    // SECTION 5: UTILITY
    // ============================================================

    /** Returns Object.values() equivalent (GAS V8 compatible). */
    function objectValues_(obj) {
      var keys   = Object.keys(obj);
      var values = [];
      for (var i = 0; i < keys.length; i++) values.push(obj[keys[i]]);
      return values;
    }

    // ============================================================
    // SECTION 6: MAIN ENTRY POINT
    // ============================================================

    /**
     * Rebuilds VW_JOB_CURRENT_STATE and VW_DESIGNER_WORKLOAD
     * by replaying all FACT partitions from scratch.
     * CEO only (PAYROLL_RUN + enforceFinancialAccess).
     *
     * @param {string} actorEmail
     * @returns {{
     *   vw_job:      { written: number, cleared: number },
     *   vw_workload: { written: number, cleared: number },
     *   partial:     boolean,
     *   elapsed_ms:  number
     * }}
     */
    function rebuildAllViews_(actorEmail) {
      var startMs = Date.now();

      Logger.info('REPLAY_STARTED', { module: MODULE, actor: actorEmail });

      var jobResult      = rebuildJobView_(startMs);
      var workloadResult = rebuildWorkloadView_();

      var elapsed  = Date.now() - startMs;
      var partial  = jobResult.partial || workloadResult.partial;

      Logger.info('REPLAY_COMPLETE', {
        module:     MODULE,
        elapsed_ms: elapsed,
        partial:    partial,
        jobs:       jobResult.written,
        workload:   workloadResult.written
      });

      return {
        vw_job:      { written: jobResult.written,      cleared: jobResult.cleared },
        vw_workload: { written: workloadResult.written, cleared: workloadResult.cleared },
        partial:     partial,
        elapsed_ms:  elapsed
      };
    }

    // ============================================================
    // SECTION 7: PUBLIC API
    // ============================================================

    /**
     * Rebuilds all VW projection tables by replaying FACT events.
     * CEO only.
     *
     * @param {string} actorEmail
     * @returns {{ vw_job, vw_workload, partial, elapsed_ms }}
     */
    function rebuildAllViews(actorEmail) {
      var actor = RBAC.resolveActor(actorEmail);
      RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
      RBAC.enforceFinancialAccess(actor);
      return rebuildAllViews_(actorEmail);
    }

    return {
      rebuildAllViews: rebuildAllViews
    };

  })();
  ```

- [x] **Step 2: Verify Config.STATES constants exist**

  In `src/00-foundation/Config.gs`, confirm these state constants are defined:
  `Config.STATES.ALLOCATED`, `Config.STATES.INTAKE_RECEIVED`, `Config.STATES.IN_PROGRESS`,
  `Config.STATES.ON_HOLD`, `Config.STATES.IN_QC`, `Config.STATES.COMPLETED`, `Config.STATES.INVOICED`.

  Run this grep to confirm:
  ```bash
  grep -n "ALLOCATED\|INTAKE_RECEIVED\|IN_PROGRESS\|ON_HOLD\|IN_QC\|COMPLETED\|INVOICED" src/00-foundation/Config.gs
  ```
  Expected: each state name appears at least once. If any are missing, add them to the `Config.STATES` object in Config.gs before continuing.

- [x] **Step 3: Add EventReplayEngine to DAL WRITE_PERMISSIONS** (it's already there — verify)

  In `src/01-dal/DAL.gs`, confirm `EventReplayEngine` is listed for both VW tables:
  ```bash
  grep -n "EventReplayEngine" src/01-dal/DAL.gs
  ```
  Expected output includes both:
  ```
  'VW_JOB_CURRENT_STATE':  ['EventReplayEngine', ...
  'VW_DESIGNER_WORKLOAD':  ['EventReplayEngine', ...
  ```
  If `BatchOperations` is a separate module, also confirm it is allowed to write VW tables — or adjust the call to use `DAL.appendRows()` directly if BatchOperations is not separately registered. Check `src/01-dal/BatchOperations.gs` to see if it calls DAL internally.

- [x] **Step 4: Commit**

  ```bash
  git add src/11-reporting/EventReplayEngine.gs
  git commit -m "feat: add EventReplayEngine — replay FACT events into VW projections"
  ```

---

## Task 2: Add `portal_rebuildViews` to Portal.gs

**Files:**
- Modify: `src/07-portal/Portal.gs`

- [x] **Step 1: Add the portal function after `portal_runAnnualBonus`**

  In `src/07-portal/Portal.gs`, find the `portal_runAnnualBonus` function (currently the last portal function). Add the following block immediately after its closing brace:

  ```javascript
  // ============================================================
  // portal_rebuildViews — CEO triggers full VW projection rebuild
  // ============================================================

  /**
   * Rebuilds VW_JOB_CURRENT_STATE and VW_DESIGNER_WORKLOAD by
   * replaying all FACT_JOB_EVENTS and FACT_WORK_LOGS partitions.
   * CEO only. Run only when view tables are suspected to be
   * corrupted or out of sync.
   *
   * NOTE: Portal button to be migrated to AdminConsole (T13) when built.
   *
   * @returns {string}  JSON: { vw_job, vw_workload, partial, elapsed_ms }
   */
  function portal_rebuildViews() {
    var email  = Session.getActiveUser().getEmail();
    var result = EventReplayEngine.rebuildAllViews(email);
    return JSON.stringify(result);
  }
  ```

- [x] **Step 2: Commit**

  ```bash
  git add src/07-portal/Portal.gs
  git commit -m "feat: add portal_rebuildViews portal function"
  ```

---

## Task 3: Wire button, JS handler, and visibility in PortalView.html

**Files:**
- Modify: `src/07-portal/PortalView.html`

- [x] **Step 1: Add the button HTML**

  Find the line containing `btn-run-annual-bonus` (currently line 346). Insert the new button immediately after it:

  ```html
        <button class="btn-muted btn-sm" id="btn-run-annual-bonus" style="display:none">🎁 Run Annual Bonus</button>
        <button class="btn-danger btn-sm" id="btn-rebuild-views" style="display:none">🔧 Rebuild Views</button>
  ```

  Note: use `btn-danger` class (red) instead of `btn-muted` — this is a destructive operation and should look different from routine buttons. If `btn-danger` doesn't exist in the stylesheet, use `btn-muted` instead and add a comment.

- [x] **Step 2: Add the event listener**

  Find the line with `btn-run-annual-bonus` event listener (currently line 868). Add the new listener immediately after it:

  ```javascript
  document.getElementById('btn-run-annual-bonus').addEventListener('click',    runAnnualBonus);
  document.getElementById('btn-rebuild-views').addEventListener('click',       rebuildViews);
  ```

- [x] **Step 3: Add to `allBtns` in `renderPortal_`**

  Find the `allBtns` array (currently line 1187). Add `'btn-rebuild-views'` to the list:

  ```javascript
  var allBtns = ['btn-create-job','btn-sbs-intake','btn-process-queue','btn-clients',
                 'btn-leader-dash','btn-staff-panel',
                 'btn-send-feedback','btn-send-ratings','btn-run-bonus',
                 'btn-run-quarterly-bonus','btn-run-annual-bonus','btn-rebuild-views',
                 'btn-approve-payroll','lbl-test-mode'];
  ```

- [x] **Step 4: Add visibility in `renderPortal_`**

  Find the line setting `btn-run-annual-bonus` visibility in `renderPortal_` (currently line 1206). Add the new line immediately after it:

  ```javascript
  if (perms.canRunPayroll)   document.getElementById('btn-run-annual-bonus').style.display    = 'inline-block';
  if (perms.canRunPayroll)   document.getElementById('btn-rebuild-views').style.display        = 'inline-block';
  ```

- [x] **Step 5: Add visibility in `onDataLoaded`**

  Find the line setting `btn-run-annual-bonus` visibility in `onDataLoaded` (currently line 951). Add the new line immediately after it:

  ```javascript
  if (_data.perms.canRunPayroll)     document.getElementById('btn-run-annual-bonus').style.display      = 'inline-block';
  if (_data.perms.canRunPayroll)     document.getElementById('btn-rebuild-views').style.display          = 'inline-block';
  ```

- [x] **Step 6: Add the `rebuildViews()` JS function**

  Find the `runAnnualBonus()` function. Add the following function immediately after its closing brace:

  ```javascript
  function rebuildViews() {
    if (!confirm(
      'Rebuild all view projections?\n\n' +
      'This clears and rewrites VW_JOB_CURRENT_STATE and VW_DESIGNER_WORKLOAD ' +
      'by replaying all FACT events from scratch.\n\n' +
      '⚠ Do not run during active queue processing.\n' +
      'Run time: ~30–60 seconds depending on data volume.'
    )) return;

    showLoading(true);
    google.script.run
      .withSuccessHandler(function(json) {
        showLoading(false);
        try {
          var r   = JSON.parse(json);
          var sec = Math.round(r.elapsed_ms / 1000);
          if (r.partial) {
            showToast('Partial rebuild — quota limit reached, re-run to complete.', 'warning');
          } else {
            showToast(
              'Views rebuilt in ' + sec + 's — ' +
              r.vw_job.written + ' jobs, ' +
              r.vw_workload.written + ' workload rows.',
              'success'
            );
          }
          loadLeaderDashboard();
        } catch(e) { showToast('Views rebuilt.', 'success'); }
      })
      .withFailureHandler(function(err) {
        showLoading(false);
        showToast('Error: ' + (err.message || String(err)), 'error');
      })
      .portal_rebuildViews();
  }
  ```

- [x] **Step 7: Check `btn-danger` style exists**

  Search for `btn-danger` in `PortalView.html`:
  ```bash
  grep -n "btn-danger" src/07-portal/PortalView.html
  ```
  If not found, change the button class in Step 1 from `btn-danger` to `btn-muted` instead.

- [x] **Step 8: Commit**

  ```bash
  git add src/07-portal/PortalView.html
  git commit -m "feat: add Rebuild Views button and JS handler to portal"
  ```

---

## Task 4: Add `testEventReplay()` to TestRunner.gs

**Files:**
- Modify: `src/setup/TestRunner.gs`

- [x] **Step 1: Append the test function at the end of TestRunner.gs**

  Add the following function at the very end of `src/setup/TestRunner.gs`:

  ```javascript
  /**
   * Manual test: verifies rebuildAllViews returns the correct shape
   * and is idempotent. Run from Apps Script editor.
   * Requires at least one FACT_JOB_EVENTS partition tab to exist.
   */
  function testEventReplay() {
    header_('EVENT REPLAY TEST');

    var email = Session.getActiveUser().getEmail();

    // First run — rebuilds from all FACT partitions
    var result1 = EventReplayEngine.rebuildAllViews(email);
    info_('First run: jobs=' + result1.vw_job.written +
          ' workload=' + result1.vw_workload.written +
          ' partial=' + result1.partial +
          ' elapsed_ms=' + result1.elapsed_ms);

    var shapeOk = (
      typeof result1.vw_job.written      === 'number' &&
      typeof result1.vw_job.cleared      === 'number' &&
      typeof result1.vw_workload.written === 'number' &&
      typeof result1.vw_workload.cleared === 'number' &&
      typeof result1.partial             === 'boolean' &&
      typeof result1.elapsed_ms          === 'number'
    );
    info_('Shape OK: ' + shapeOk);

    // Row count check — VW_JOB_CURRENT_STATE must match vw_job.written
    var ss        = SpreadsheetApp.getActiveSpreadsheet();
    var vwSheet   = ss.getSheetByName('VW_JOB_CURRENT_STATE');
    var actualRows = vwSheet ? Math.max(vwSheet.getLastRow() - 1, 0) : 0;
    var rowCountOk = (actualRows === result1.vw_job.written);
    info_('Row count OK: ' + rowCountOk +
          ' (sheet=' + actualRows + ' written=' + result1.vw_job.written + ')');

    // Second run — idempotent: same row counts
    var result2 = EventReplayEngine.rebuildAllViews(email);
    info_('Second run: jobs=' + result2.vw_job.written +
          ' workload=' + result2.vw_workload.written);

    var idempotent = (
      result2.vw_job.written      === result1.vw_job.written &&
      result2.vw_workload.written === result1.vw_workload.written
    );
    info_('Idempotent: ' + idempotent);

    var allOk = shapeOk && rowCountOk && idempotent && !result1.partial;
    if (allOk) {
      pass_('EventReplay shape, row count, and idempotency checks passed');
    } else {
      fail_('EventReplay check failed — shapeOk=' + shapeOk +
            ' rowCountOk=' + rowCountOk +
            ' idempotent=' + idempotent +
            ' partial=' + result1.partial);
    }
    line_();
  }
  ```

- [x] **Step 2: Commit**

  ```bash
  git add src/setup/TestRunner.gs
  git commit -m "feat: add testEventReplay diagnostic to TestRunner"
  ```

---

## Task 5: Push and verify

- [x] **Step 1: Push to Apps Script**

  ```bash
  clasp push
  ```

  Expected: `Pushed N files at HH:MM:SS` with no errors.

- [x] **Step 2: Run `testEventReplay` in Apps Script editor**

  Open Apps Script editor → select `testEventReplay` → Run.

  Expected output (with FACT data present):
  ```
  ═══════════════════════════════════════════
    EVENT REPLAY TEST
  ═══════════════════════════════════════════
    ℹ️   First run: jobs=N workload=M partial=false elapsed_ms=XXXX
    ℹ️   Shape OK: true
    ℹ️   Row count OK: true (sheet=N written=N)
    ℹ️   Second run: jobs=N workload=M
    ℹ️   Idempotent: true
    ✅  EventReplay shape, row count, and idempotency checks passed
  ───────────────────────────────────────────
  ```

  Expected output (no FACT data yet — still valid):
  ```
    ℹ️   First run: jobs=0 workload=0 partial=false elapsed_ms=XXX
    ℹ️   Shape OK: true
    ℹ️   Row count OK: true (sheet=0 written=0)
    ℹ️   Second run: jobs=0 workload=0
    ℹ️   Idempotent: true
    ✅  EventReplay shape, row count, and idempotency checks passed
  ```

- [x] **Step 3: Smoke-test the portal button**

  Open the portal as CEO → confirm "🔧 Rebuild Views" button appears in the leader dashboard toolbar → click it → confirm dialog appears → confirm → confirm toast shows `"Views rebuilt in Xs — N jobs, M workload rows"` and leader dashboard refreshes.

- [x] **Step 4: Final commit — update plan and CLAUDE.md**

  Mark annual bonus and EventReplayEngine as done in `CLAUDE.md`:
  ```
  - [x] EventReplayEngine (VW rebuild from FACT events)
  ```

  ```bash
  git add CLAUDE.md docs/superpowers/plans/2026-04-15-event-replay-engine.md
  git commit -m "docs: mark EventReplayEngine complete"
  ```
