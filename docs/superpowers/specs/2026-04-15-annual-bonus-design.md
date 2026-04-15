# Annual Bonus — Design Spec
**Date:** 2026-04-15
**Status:** Approved

---

## Summary

Wire the existing `QuarterlyBonusEngine.runAnnualBonus` to the portal with a CEO-only button, and surface annual bonus amounts in the leader dashboard payroll status table.

---

## Business Rules (from CLAUDE.md)

- Annual bonus = sum of Q1 + Q2 + Q3 + Q4 `bonus_inr` (CALCULATED rows only)
- Paid once at year-end — intended for December but not enforced by the engine
- Annual bonus is **in addition to** Q4 quarterly bonus — both paid in December
- Written as `event_type = 'ANNUAL_BONUS'` to `FACT_QUARTERLY_BONUS` with `quarter_period_id = 'ANNUAL-{year}'`
- Idempotency key: `ANNUAL_BONUS|{person_code}|{year}` — safe to re-run
- If any quarter had PENDING rows, those people are silently skipped (only CALCULATED quarters count)

---

## What's Already Built

- `QuarterlyBonusEngine.runAnnualBonus(actorEmail, year)` — complete implementation, CEO-only, idempotent
- `FACT_QUARTERLY_BONUS` table schema — includes `event_type`, `quarter_period_id`, `bonus_inr`

---

## Changes Required

### 1. `QuarterlyBonusEngine.gs` — return counts from `runAnnualBonus_`

`runAnnualBonus_` currently writes rows but returns `undefined`. Add `written` / `skipped` counters and return `{ written, skipped, year }`. Propagate the return value through the public `runAnnualBonus` function.

```
runAnnualBonus_(actorEmail, year) → { written: N, skipped: M, year: 2026 }
runAnnualBonus(actorEmail, year)  → { written: N, skipped: M, year: 2026 }
```

`skipped` covers: duplicate (already written), or person had no CALCULATED quarterly rows.

---

### 2. `Portal.gs` — `portal_runAnnualBonus(year)`

New portal function. CEO only (enforced inside engine).

```javascript
function portal_runAnnualBonus(year) {
  var email  = Session.getActiveUser().getEmail();
  var result = QuarterlyBonusEngine.runAnnualBonus(email, parseInt(year, 10));
  return JSON.stringify(result);
}
```

---

### 3. `PortalData.gs` — annual bonus map in `getLeaderDashboard`

After loading `payroll_status`, read `FACT_QUARTERLY_BONUS` once and build an annual bonus map:

```
annualBonusMap = { personCode: bonus_inr }
filtered to: event_type === 'ANNUAL_BONUS'
         AND quarter_period_id === 'ANNUAL-' + year
```

`year` is derived from `periodId.substring(0, 4)` (e.g. `'2026-04'` → `2026`).

Add `annual_bonus_inr: annualBonusMap[code] || 0` to each `payroll_status` row.

Response shape unchanged except each payroll row gains one field:
```json
{ "person_code": "DS1", "name": "...", "design_pay": 0, ..., "annual_bonus_inr": 4200 }
```

---

### 4. `PortalView.html` — "Run Annual Bonus" button

**Location:** Leader dashboard toolbar, immediately after the existing "🏆 Run Quarterly Bonus" button.

```html
<button class="btn-muted btn-sm" id="btn-run-annual-bonus" style="display:none">
  🎁 Run Annual Bonus
</button>
```

**Visibility:** `perms.canRunPayroll` (CEO only). Must be added to:
- Initial `onDataLoaded` visibility block
- `renderPortal_` visibility block (CEO preview mode)
- `allBtns` hide-all array in `renderPortal_`

---

### 5. `PortalView.html` — `runAnnualBonus()` JS function

```javascript
function runAnnualBonus() {
  var now      = new Date();
  var year     = now.getFullYear();
  var isDecember = now.getMonth() === 11;  // 0-indexed

  var warning = isDecember ? '' :
    '\n\n⚠ Warning: You are running this outside of December. ' +
    'Q4 may not be complete — staff with missing quarters will be skipped.';

  if (!confirm('Run annual bonus for ' + year + '?' + warning +
    '\n\nThis sums all CALCULATED quarterly bonuses for each eligible staff member.' +
    '\nAlready-written annual bonuses will be skipped (re-run safe).')) return;

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
        loadLeaderDashboard();  // refresh dashboard to show new annual bonus column
      } catch(e) { showToast('Annual bonus run complete.', 'success'); }
    })
    .withFailureHandler(function(err) {
      showLoading(false);
      showToast('Error: ' + (err.message || String(err)), 'error');
    })
    .portal_runAnnualBonus(year);
}
```

---

### 6. `PortalView.html` — Payroll status table: add "Annual Bonus" column

**Header row:** Insert "Annual Bonus" between "Bonus INR" and "Total INR":

```
Person | Base INR | Bonus INR | Annual Bonus | Total INR | Status
```

**Data row:** Show `fmtInr(row.annual_bonus_inr)` if > 0, otherwise `'—'` in muted grey.

No change to `total_pay` — annual bonus is displayed informational only (it's a separate FACT_QUARTERLY_BONUS entry, not included in MART_PAYROLL_SUMMARY total_pay).

---

## Data Flow

```
CEO clicks "Run Annual Bonus"
  → portal_runAnnualBonus(year)
  → QuarterlyBonusEngine.runAnnualBonus(email, year)
    → reads FACT_QUARTERLY_BONUS (event_type=QUARTERLY_BONUS, status=CALCULATED, year's quarters)
    → sums bonus_inr per person_code
    → writes ANNUAL_BONUS rows to FACT_QUARTERLY_BONUS (idempotent)
  → returns { written, skipped, year }
  → toast shown, dashboard auto-refreshes

Dashboard load (getLeaderDashboard)
  → reads FACT_QUARTERLY_BONUS (event_type=ANNUAL_BONUS, ANNUAL-{year})
  → merges annual_bonus_inr into payroll_status rows
  → payroll table renders Annual Bonus column
```

---

## Files Changed

| File | Change |
|---|---|
| `src/10-payroll/QuarterlyBonusEngine.gs` | Return `{ written, skipped, year }` from `runAnnualBonus_` and `runAnnualBonus` |
| `src/07-portal/Portal.gs` | Add `portal_runAnnualBonus(year)` |
| `src/07-portal/PortalData.gs` | Add annual bonus map to `getLeaderDashboard` response |
| `src/07-portal/PortalView.html` | Button, JS function, payroll table column |

---

## Out of Scope

- Paystub email for annual bonus (separate from monthly paystub — deferred)
- Annual bonus confirmation flow (no staff sign-off required for this phase)
- MART_PAYROLL_SUMMARY update (annual bonus stays in FACT_QUARTERLY_BONUS only)
