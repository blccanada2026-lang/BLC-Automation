# Annual Bonus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `QuarterlyBonusEngine.runAnnualBonus` to the portal with a CEO-only button and surface annual bonus amounts in the leader dashboard payroll status table.

**Architecture:** The engine already calculates and writes annual bonus rows — it just returns nothing and isn't connected to the portal. Three layers of change: engine (add return counts), portal data (read ANNUAL_BONUS rows into dashboard), and UI (button + table column).

**Tech Stack:** Google Apps Script (V8), HtmlService, DAL/RBAC pattern, FACT_QUARTERLY_BONUS table.

---

## Files

| File | Change |
|---|---|
| `src/10-payroll/QuarterlyBonusEngine.gs` | Add `written`/`skipped` counters; return `{ written, skipped, year }` |
| `src/07-portal/Portal.gs` | Add `portal_runAnnualBonus(year)` |
| `src/07-portal/PortalData.gs` | Read ANNUAL_BONUS rows in `getLeaderDashboard`; add `annual_bonus_inr` per person |
| `src/07-portal/PortalView.html` | Button HTML, event listener, visibility blocks, `runAnnualBonus()` JS, table column |
| `src/setup/TestRunner.gs` | Add `testAnnualBonus()` diagnostic |

---

## Task 1: Return counts from `runAnnualBonus_`

**Files:**
- Modify: `src/10-payroll/QuarterlyBonusEngine.gs` (lines 435–622)

- [ ] **Step 1: Add counters and return value to `runAnnualBonus_`**

  Replace the entire `runAnnualBonus_` function body. The function currently returns `undefined`. Changes: add `written = 0` and `skipped = 0` at the top; increment `skipped++` on the duplicate path; increment `written++` after `DAL.appendRow`; return `{ written, skipped, year }` at the end.

  ```javascript
  function runAnnualBonus_(actorEmail, year) {
    var quarters  = ['Q1', 'Q2', 'Q3', 'Q4'];
    var yearStr   = String(year);
    var annualPid = 'ANNUAL-' + yearStr;
    var totals    = {};
    var written   = 0;
    var skipped   = 0;

    var allRows;
    try {
      allRows = DAL.readAll(Config.TABLES.FACT_QUARTERLY_BONUS, { callerModule: MODULE });
    } catch (e) {
      if (e.code === 'SHEET_NOT_FOUND') allRows = [];
      else throw e;
    }

    var validQPids = {};
    for (var q = 0; q < quarters.length; q++) {
      validQPids[quarterPeriodId_(quarters[q], year)] = true;
    }

    for (var i = 0; i < allRows.length; i++) {
      var row    = allRows[i];
      var qPid   = String(row.quarter_period_id || '').trim();
      var evType = String(row.event_type        || '').trim();
      var status = String(row.status            || '').trim();
      var code   = String(row.person_code       || '').trim();
      var amt    = parseFloat(row.bonus_inr)    || 0;
      if (!validQPids[qPid] || evType !== 'QUARTERLY_BONUS' || status !== 'CALCULATED' || !code) continue;
      totals[code] = (totals[code] || 0) + amt;
    }

    var codes = Object.keys(totals);
    for (var j = 0; j < codes.length; j++) {
      var personCode     = codes[j];
      var annualAmount   = Math.round(totals[personCode] * 100) / 100;
      var idempotencyKey = 'ANNUAL_BONUS|' + personCode + '|' + yearStr;

      var existing;
      try {
        existing = DAL.readWhere(
          Config.TABLES.FACT_QUARTERLY_BONUS,
          { idempotency_key: idempotencyKey },
          { callerModule: MODULE }
        );
      } catch (e) {
        if (e.code === 'SHEET_NOT_FOUND') existing = [];
        else throw e;
      }

      if (existing.length > 0) {
        Logger.warn('QB_ANNUAL_DUPLICATE', { module: MODULE,
          message: 'Annual bonus already recorded',
          person_code: personCode, year: year });
        skipped++;
        continue;
      }

      DAL.appendRow(Config.TABLES.FACT_QUARTERLY_BONUS, {
        bonus_id:          Identifiers.generateId(),
        event_type:        'ANNUAL_BONUS',
        person_code:       personCode,
        quarter_period_id: annualPid,
        design_hours:      0,
        client_score:      0,
        error_score:       0,
        rating_score:      0,
        composite_score:   0,
        bonus_inr:         annualAmount,
        status:            'CALCULATED',
        pending_reason:    '',
        actor_email:       actorEmail,
        timestamp:         new Date().toISOString(),
        idempotency_key:   idempotencyKey
      }, { callerModule: MODULE });

      Logger.info('QB_ANNUAL_WRITTEN', { module: MODULE,
        message: 'Annual bonus written',
        person_code: personCode, amount_inr: annualAmount, year: year });
      written++;
    }

    return { written: written, skipped: skipped, year: year };
  }
  ```

- [ ] **Step 2: Propagate return value through the public `runAnnualBonus`**

  Replace the `runAnnualBonus` public function (currently at line ~617):

  ```javascript
  /**
   * Sums Q1-Q4 quarterly bonuses and writes a single ANNUAL_BONUS row per person.
   * @param {string} actorEmail
   * @param {number} year
   * @returns {{ written: number, skipped: number, year: number }}
   */
  function runAnnualBonus(actorEmail, year) {
    var actor = RBAC.resolveActor(actorEmail);
    RBAC.enforcePermission(actor, RBAC.ACTIONS.PAYROLL_RUN);
    RBAC.enforceFinancialAccess(actor);
    return runAnnualBonus_(actorEmail, year);
  }
  ```

- [ ] **Step 3: Add a test function to TestRunner.gs**

  Append this function at the bottom of `src/setup/TestRunner.gs`:

  ```javascript
  /**
   * Manual test: verifies runAnnualBonus returns the correct shape
   * and is idempotent. Run from Apps Script editor.
   * Requires at least one QUARTERLY_BONUS CALCULATED row in FACT_QUARTERLY_BONUS.
   */
  function testAnnualBonus() {
    header_('ANNUAL BONUS TEST');

    var year = new Date().getFullYear();

    // First run — should write rows (or 0 if no quarterly data yet)
    var result1 = QuarterlyBonusEngine.runAnnualBonus(Session.getActiveUser().getEmail(), year);
    console.log('First run:  written=' + result1.written + ' skipped=' + result1.skipped + ' year=' + result1.year);

    var shapeOk = typeof result1.written === 'number' &&
                  typeof result1.skipped === 'number' &&
                  result1.year === year;
    console.log('Shape OK:  ' + shapeOk);

    // Second run — must be idempotent (written=0, skipped=result1.written)
    var result2 = QuarterlyBonusEngine.runAnnualBonus(Session.getActiveUser().getEmail(), year);
    console.log('Second run: written=' + result2.written + ' skipped=' + result2.skipped);

    var idempotent = result2.written === 0 && result2.skipped === result1.written;
    console.log('Idempotent: ' + idempotent);

    console.log(shapeOk && idempotent ? '✅ PASS' : '❌ FAIL');
    line_();
  }
  ```

- [ ] **Step 4: Run the test from Apps Script editor**

  Open the Apps Script editor → select `testAnnualBonus` → Run.

  Expected output (if quarterly data exists):
  ```
  === ANNUAL BONUS TEST ===
  First run:  written=N skipped=0 year=2026
  Shape OK:  true
  Second run: written=0 skipped=N
  Idempotent: true
  ✅ PASS
  ```
  Expected output (if no quarterly data yet — still valid):
  ```
  First run:  written=0 skipped=0 year=2026
  Shape OK:  true
  Second run: written=0 skipped=0
  Idempotent: true
  ✅ PASS
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src/10-payroll/QuarterlyBonusEngine.gs src/setup/TestRunner.gs
  git commit -m "feat: return { written, skipped, year } from runAnnualBonus"
  ```

---

## Task 2: Add `portal_runAnnualBonus` to Portal.gs

**Files:**
- Modify: `src/07-portal/Portal.gs`

- [ ] **Step 1: Add the portal function**

  In `src/07-portal/Portal.gs`, add the following block immediately after the `portal_runQuarterlyBonus` function (search for `portal_runQuarterlyBonus` to find the insertion point):

  ```javascript
  // ============================================================
  // portal_runAnnualBonus — CEO triggers annual bonus run
  // ============================================================

  /**
   * Runs the annual bonus calculation and writes ANNUAL_BONUS rows to FACT_QUARTERLY_BONUS.
   * Sums Q1–Q4 CALCULATED quarterly bonuses for the given year per eligible staff member.
   * CEO only. Idempotent — re-running returns written=0, skipped=N.
   *
   * @param {number} year  e.g. 2026
   * @returns {string}  JSON: { written, skipped, year }
   */
  function portal_runAnnualBonus(year) {
    var email  = Session.getActiveUser().getEmail();
    var result = QuarterlyBonusEngine.runAnnualBonus(email, parseInt(year, 10));
    return JSON.stringify(result);
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add src/07-portal/Portal.gs
  git commit -m "feat: add portal_runAnnualBonus portal function"
  ```

---

## Task 3: Add annual bonus to `getLeaderDashboard`

**Files:**
- Modify: `src/07-portal/PortalData.gs` (function `getLeaderDashboard`, lines 273–353)

- [ ] **Step 1: Add annual bonus map read after the payroll status block**

  In `getLeaderDashboard`, the current section 3 (lines 328–353) reads from `MART_PAYROLL_SUMMARY` and builds `payrollStatus`. Add a new section 4 immediately after the `payrollStatus` build, before the `return JSON.stringify(...)` call:

  ```javascript
    // ── 4. Annual bonus from FACT_QUARTERLY_BONUS ─────────────
    var annualBonusMap = {};
    try {
      var annualPid  = 'ANNUAL-' + periodId.substring(0, 4);  // e.g. 'ANNUAL-2026'
      var bonusRows  = DAL.readAll(Config.TABLES.FACT_QUARTERLY_BONUS, { callerModule: 'PortalData' });
      for (var b = 0; b < bonusRows.length; b++) {
        var br = bonusRows[b];
        if (String(br.event_type        || '') !== 'ANNUAL_BONUS')  continue;
        if (String(br.quarter_period_id || '') !== annualPid)       continue;
        var bcode = String(br.person_code || '').trim();
        if (bcode) annualBonusMap[bcode] = parseFloat(br.bonus_inr) || 0;
      }
    } catch (e) { /* FACT_QUARTERLY_BONUS may be empty */ }
  ```

- [ ] **Step 2: Add `annual_bonus_inr` field to each payroll_status row**

  In the same function, find the `payrollStatus.push(...)` call (currently inside the `martRows` loop). Add `annual_bonus_inr` to the object:

  ```javascript
        payrollStatus.push({
          person_code:      mcode,
          name:             staffNameMap[mcode] || mcode,
          design_pay:       parseFloat(mrow.design_pay)       || 0,
          qc_pay:           parseFloat(mrow.qc_pay)           || 0,
          supervisor_bonus: parseFloat(mrow.supervisor_bonus) || 0,
          total_pay:        parseFloat(mrow.total_pay)        || 0,
          status:           String(mrow.status || 'NOT_RUN'),
          annual_bonus_inr: annualBonusMap[mcode] || 0
        });
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/07-portal/PortalData.gs
  git commit -m "feat: add annual_bonus_inr to getLeaderDashboard payroll_status rows"
  ```

---

## Task 4: Wire button, JS function, and table column in PortalView.html

**Files:**
- Modify: `src/07-portal/PortalView.html`

- [ ] **Step 1: Add the button HTML**

  Find line 345 (the "Run Quarterly Bonus" button). Insert the new button immediately after it:

  ```html
        <button class="btn-muted btn-sm" id="btn-run-quarterly-bonus" style="display:none">🏆 Run Quarterly Bonus</button>
        <button class="btn-muted btn-sm" id="btn-run-annual-bonus" style="display:none">🎁 Run Annual Bonus</button>
  ```

- [ ] **Step 2: Add the event listener**

  Find line 866 (the `btn-run-quarterly-bonus` listener). Add the new listener immediately after it:

  ```javascript
  document.getElementById('btn-run-quarterly-bonus').addEventListener('click', runQuarterlyBonus);
  document.getElementById('btn-run-annual-bonus').addEventListener('click',    runAnnualBonus);
  ```

- [ ] **Step 3: Add to `onDataLoaded` visibility block**

  Find line 948 (the `btn-run-quarterly-bonus` visibility line). Add the new line immediately after it:

  ```javascript
  if (_data.perms.canRunPayroll)     document.getElementById('btn-run-quarterly-bonus').style.display   = 'inline-block';
  if (_data.perms.canRunPayroll)     document.getElementById('btn-run-annual-bonus').style.display      = 'inline-block';
  ```

- [ ] **Step 4: Add to `allBtns` in `renderPortal_`**

  Find line 1187 (the `allBtns` array). Add `'btn-run-annual-bonus'` to the list:

  ```javascript
  var allBtns = ['btn-create-job','btn-sbs-intake','btn-process-queue','btn-clients',
                 'btn-leader-dash','btn-staff-panel',
                 'btn-send-feedback','btn-send-ratings','btn-run-bonus',
                 'btn-run-quarterly-bonus','btn-run-annual-bonus','btn-approve-payroll','lbl-test-mode'];
  ```

- [ ] **Step 5: Add the `runAnnualBonus()` JS function**

  Find the `runQuarterlyBonus()` function (search for `function runQuarterlyBonus`). Add the following function immediately after its closing brace:

  ```javascript
  function runAnnualBonus() {
    var now       = new Date();
    var year      = now.getFullYear();
    var isDecember = (now.getMonth() === 11);  // getMonth() is 0-indexed

    var warning = isDecember ? '' :
      '\n\n⚠ Warning: You are running this outside of December. ' +
      'Q4 may not be complete — staff with missing quarters will be skipped.';

    if (!confirm(
      'Run annual bonus for ' + year + '?' + warning +
      '\n\nThis sums all CALCULATED quarterly bonuses for each eligible staff member.' +
      '\nAlready-written annual bonuses are skipped (re-run safe).'
    )) return;

    showLoading(true);
    google.script.run
      .withSuccessHandler(function(json) {
        showLoading(false);
        try {
          var r = JSON.parse(json);
          showToast(
            'Annual bonus ' + r.year + ': ' + r.written + ' written, ' + r.skipped + ' skipped.',
            r.written > 0 ? 'success' : 'warning'
          );
          loadLeaderDashboard();
        } catch(e) { showToast('Annual bonus run complete.', 'success'); }
      })
      .withFailureHandler(function(err) {
        showLoading(false);
        showToast('Error: ' + (err.message || String(err)), 'error');
      })
      .portal_runAnnualBonus(year);
  }
  ```

- [ ] **Step 6: Add "Annual Bonus" column to payroll status table header**

  Find line 2304 (the `['Person', 'Base INR', 'Bonus INR', 'Total INR', 'Status']` header array). Replace it:

  ```javascript
  ['Person', 'Base INR', 'Bonus INR', 'Annual Bonus', 'Total INR', 'Status'].forEach(function(h) {
  ```

- [ ] **Step 7: Add "Annual Bonus" cell to payroll status table rows**

  Find the data row rendering (around line 2322). Currently it renders `[baseInr, row.supervisor_bonus || 0, row.total_pay || 0]` as cells. Replace that block with one that includes the annual bonus cell:

  ```javascript
      var baseInr = (row.design_pay || 0) + (row.qc_pay || 0);
      [baseInr, row.supervisor_bonus || 0].forEach(function(v) {
        var td = document.createElement('td');
        td.textContent = fmtInr(v);
        ptr.appendChild(td);
      });

      // Annual bonus cell — show '—' in muted grey if not yet calculated
      var annualTd = document.createElement('td');
      var annualAmt = row.annual_bonus_inr || 0;
      annualTd.textContent  = annualAmt > 0 ? fmtInr(annualAmt) : '—';
      annualTd.style.color  = annualAmt > 0 ? '' : 'var(--c-muted)';
      ptr.appendChild(annualTd);

      // Total pay
      var totalTd = document.createElement('td');
      totalTd.textContent = fmtInr(row.total_pay || 0);
      ptr.appendChild(totalTd);
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add src/07-portal/PortalView.html
  git commit -m "feat: annual bonus button, JS handler, and payroll table column"
  ```

---

## Self-Review Checklist

After all tasks are complete, verify:

- [ ] `runAnnualBonus` returns `{ written, skipped, year }` (not `undefined`)
- [ ] `portal_runAnnualBonus` is callable from the portal (GAS `google.script.run`)
- [ ] `getLeaderDashboard` response includes `annual_bonus_inr` on every payroll row
- [ ] `btn-run-annual-bonus` appears in the leader dashboard for CEO and is hidden for other roles
- [ ] December warning does NOT appear when running in December; warning DOES appear in all other months
- [ ] Payroll table has 6 columns: Person, Base INR, Bonus INR, Annual Bonus, Total INR, Status
- [ ] "—" shown in grey when `annual_bonus_inr === 0`; formatted INR shown when > 0
- [ ] Running annual bonus twice: second run toast says "0 written, N skipped"
- [ ] `testAnnualBonus()` passes in Apps Script editor
