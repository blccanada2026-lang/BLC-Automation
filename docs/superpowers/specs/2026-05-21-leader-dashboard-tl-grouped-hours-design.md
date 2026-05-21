# Leader Dashboard: TL-Grouped Team Hours

**Date:** 2026-05-21
**Status:** Approved (revised)
**Scope:** `src/07-portal/PortalData.gs`, `src/07-portal/PortalView.html` only

---

## Problem

The Leader Dashboard Team Hours table is a flat list of all staff sorted by total hours. CEO/PM/ADMIN users with 30+ staff see a wall of rows with no structure. There is no way to see how each TL's team is performing as a unit.

---

## Solution

Add a `tl_groups` structure to the `getLeaderDashboard` response alongside the existing `team_hours` (kept for one transition cycle). Each group has a leader (TL or PM), their direct reports, and a subtotal. Groups are built from active DIM_STAFF_ROSTER first, then overlaid with hours from hoursMap — so groups always exist even when no hours have been logged. The frontend prefers `tl_groups` and falls back to the flat `team_hours` table if `tl_groups` is absent.

---

## Constraints

1. Build TL groups from active DIM_STAFF_ROSTER first, then overlay hours from hoursMap.
2. Keep legacy `team_hours` in the backend response for one transition cycle.
3. Frontend prefers `tl_groups`; falls back to flat `team_hours` rendering if `tl_groups` is missing.
4. For TEAM_LEAD scope, synthesize the TL's own group even if no hours exist.
5. Payroll status rendering is untouched.
6. Only `PortalData.gs` and `PortalView.html` are touched.
7. Targeted tests only (no full suite run).
8. Do not push without explicit approval.

---

## Data Shape

`portal_getLeaderDashboard` returns both keys:

```json
{
  "period_id": "2026-05",
  "tl_groups": [
    {
      "leader": {
        "person_code": "SVN",
        "name": "Savan",
        "design_hours": 12.5,
        "qc_hours": 0.0,
        "total_hours": 12.5
      },
      "members": [
        { "person_code": "DS1", "name": "Alice", "design_hours": 45.0, "qc_hours": 0.0,  "total_hours": 45.0 },
        { "person_code": "DS2", "name": "Bob",   "design_hours": 38.5, "qc_hours": 5.0,  "total_hours": 43.5 }
      ],
      "subtotal": 101.0
    }
  ],
  "team_hours": [...],
  "payroll_status": [...]
}
```

- `tl_groups` is built from DIM_STAFF_ROSTER; every active leader has an entry even with zero hours
- `leader` hours default to `{ design_hours: 0, qc_hours: 0, total_hours: 0 }` if no work logs exist
- `members` are sorted descending by `total_hours`; members with no logs are included with zero hours
- `subtotal` = leader.total_hours + sum(members[i].total_hours)
- `team_hours` retains its current shape (flat array, unchanged logic)
- `payroll_status` is unchanged

---

## Backend Changes — `PortalData.gs` `getLeaderDashboard`

### Step 1 — Build roster structures (from DIM_STAFF_ROSTER, read once)

```
staffNameMap:    person_code → name
supervisorMap:   person_code → supervisor_code
leaderSet:       Set of person_codes that appear as supervisor_code for ≥1 active staff member
rosterByLeader:  leader_code → [{ person_code, name }, ...]   (active direct reports only)
```

Active = `active` flag is TRUE and `effective_to` is blank or in the future.

### Step 2 — Build hoursMap from FACT_WORK_LOGS (unchanged)

```
hoursMap: person_code → { design: N, qc: N }
```

### Step 3 — Build tl_groups

For every leader in `leaderSet` (ordered by name for stable output, then re-sorted by subtotal descending):

```
leaderHours = hoursMap[leaderCode] || { design: 0, qc: 0 }
members     = rosterByLeader[leaderCode].map(m => {
                h = hoursMap[m.person_code] || { design: 0, qc: 0 }
                return { person_code, name, design_hours, qc_hours, total_hours }
              }).sort(desc by total_hours)
subtotal    = leader.total_hours + sum(members)
```

Orphaned entries (hours logged, no supervisor_code, not in leaderSet): collected into a trailing `{ leader: null, members: [...], subtotal: X }` "Unassigned" group (edge case safety net).

Final `tl_groups` sorted descending by `subtotal`.

### Step 4 — TEAM_LEAD scoping

When `actor.role === 'TEAM_LEAD'`:
- Build only the one group where `leaderCode === actor.personCode`.
- If the TL has no direct reports in DIM_STAFF_ROSTER, synthesize an empty group: `{ leader: tlEntry, members: [], subtotal: tlHours }`.
- Return `tl_groups` with that single group.
- `team_hours` for TEAM_LEAD: filter to the TL's team codes (existing `buildTeamCodes_` logic, unchanged).

### Step 5 — Return value

```javascript
return JSON.stringify({
  period_id:      periodId,
  tl_groups:      tlGroups,    // new
  team_hours:     teamHours,   // kept for transition cycle
  payroll_status: payrollStatus
});
```

---

## Frontend Changes — `PortalView.html` `renderLeaderDashboard`

### Dispatch logic

```javascript
if (data.tl_groups && data.tl_groups.length > 0) {
  renderGroupedHours(data.tl_groups, hoursBody);
} else if (data.team_hours && data.team_hours.length > 0) {
  renderFlatHours(data.team_hours, hoursBody);   // existing code, extracted to function
} else {
  // empty state
}
```

### `renderGroupedHours(groups, container)` — new function

For each group:

```html
<div class="tl-group">
  <h4 class="tl-group-header">[Leader Name]'s Team</h4>
  <table class="dash-tbl">
    <thead><tr><th>Person</th><th>Design Hrs</th><th>QC Hrs</th><th>Total</th></tr></thead>
    <tbody>
      <!-- leader row -->
      <tr class="tl-leader-row">
        <td>Savan (TL)</td><td>12.5</td><td>0.0</td><td>12.5</td>
      </tr>
      <!-- member rows -->
      <tr><td>Alice</td><td>45.0</td><td>0.0</td><td>45.0</td></tr>
      <!-- subtotal row -->
      <tr class="tl-subtotal-row">
        <td colspan="3">Team Total</td><td>101.0</td>
      </tr>
    </tbody>
  </table>
</div>
```

- Leader row: class `tl-leader-row` — tinted background, bold, role suffix `(TL)` or `(PM)` based on group context
- Unassigned group: header reads "Unassigned", no leader row
- Grand total div below all groups: `Grand Total: 284.5 hrs`
- `dash-hours-total` element updated with grand total (preserves existing element)

### `renderFlatHours(teamHours, container)` — extracted from existing code

The existing flat table rendering moved into a named function. Logic is identical; no behaviour change.

### CSS additions (in existing `<style>` block)

```css
.tl-group         { margin-bottom: 20px; }
.tl-group-header  { font-size: 14px; font-weight: 700; margin: 0 0 6px 0; color: var(--c-text); }
.tl-leader-row td { background: var(--c-surface-2, #f0f4ff); font-weight: 600; }
.tl-subtotal-row td { font-weight: 700; border-top: 1px solid var(--c-border); }
```

---

## Invariants

- `payroll_status` rendering is untouched — no changes to that section.
- Every active leader in DIM_STAFF_ROSTER always appears as a group header, even with zero hours.
- Every active direct report always appears in their leader's group, even with zero hours.
- TEAM_LEAD always gets exactly one group returned (synthesized if empty).
- `team_hours` flat array logic is unchanged — existing behaviour preserved for fallback.
- No other files are modified.

---

## Testing

Targeted manual tests only — no full suite run:

| Scenario | Expected |
|----------|----------|
| CEO view — staff with hours logged | Groups appear, sorted by subtotal desc |
| CEO view — TL with no hours logged | Group still appears, leader row shows 0.0 |
| CEO view — designer with no supervisor_code | Appears in "Unassigned" group |
| TEAM_LEAD view | Exactly one group returned and rendered |
| TEAM_LEAD view — no hours logged yet | Group synthesized with zeros, not empty state |
| Old client (no tl_groups in response) | Falls back to flat team_hours table |
| Payroll status section | Unchanged — no regression |

---

## Files Changed

| File | Change |
|------|--------|
| `src/07-portal/PortalData.gs` | Add `buildTlGroups_` helper; update `getLeaderDashboard` to emit `tl_groups` alongside `team_hours` |
| `src/07-portal/PortalView.html` | Add `renderGroupedHours`, extract `renderFlatHours`, update dispatch in `renderLeaderDashboard`; add 4 CSS rules |
