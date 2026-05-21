# Leader Dashboard: TL-Grouped Team Hours

**Date:** 2026-05-21
**Status:** Approved
**Scope:** `src/07-portal/PortalData.gs`, `src/07-portal/PortalView.html`

---

## Problem

The Leader Dashboard Team Hours table is a flat list of all staff sorted by total hours. CEO/PM/ADMIN users with 30+ staff see a wall of rows with no structure. There is no way to see how each TL's team is performing as a unit.

---

## Solution

Replace the flat `team_hours` array in the `getLeaderDashboard` response with a `tl_groups` structure. Each group has a leader (TL or PM), their direct reports, and a subtotal. The frontend renders one collapsible section per group.

---

## Data Shape

`portal_getLeaderDashboard` returns:

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
  "payroll_status": [...]
}
```

- `leader` is always present (even if the leader logged zero hours — hours default to 0)
- `members` are sorted descending by `total_hours`
- `subtotal` = leader.total_hours + sum(members[i].total_hours)
- `payroll_status` is unchanged — stays flat

---

## Backend Changes — `PortalData.gs` `getLeaderDashboard`

### Grouping logic

1. **Build `supervisorMap`**: `person_code → supervisor_code` from DIM_STAFF_ROSTER (table already loaded for the name map — read once, reuse).
2. **Build `leaderSet`**: every person_code that is referenced as a `supervisor_code` by at least one active staff member. These become group headers.
3. **Group hoursMap entries**:
   - For each leader in `leaderSet`: collect all `hoursMap` entries where `supervisorMap[person_code] === leaderCode` → these are `members`. Leader's own hours entry (if present) becomes `leader`; if the leader logged zero hours, synthesize a zero-hours leader entry using the name map.
   - Members sorted descending by `total_hours`.
   - `subtotal` = leader.total_hours + sum(member.total_hours).
4. **Orphaned entries** (have hours, no supervisor_code, not in leaderSet): collected into a single trailing `{ leader: null, members: [...], subtotal: X }` group. Frontend renders this as "Unassigned".
5. **Group ordering**: sort groups descending by `subtotal`.

### TEAM_LEAD scoping

When `actor.role === 'TEAM_LEAD'`: after building all groups, filter to the single group where `leader.person_code === actor.personCode`. Return that one group only.

### Return value

Replace `team_hours` key with `tl_groups` in the returned JSON object.

---

## Frontend Changes — `PortalView.html` `renderLeaderDashboard`

### DOM structure per group

```
<div class="tl-group">
  <h4 class="tl-group-header">SVN's Team</h4>
  <table class="dash-tbl">
    <thead>
      <tr><th>Person</th><th>Design Hrs</th><th>QC Hrs</th><th>Total</th></tr>
    </thead>
    <tbody>
      <tr class="tl-leader-row"><td>Savan (TL)</td><td>12.5</td><td>0.0</td><td>12.5</td></tr>
      <tr><td>Alice</td><td>45.0</td><td>0.0</td><td>45.0</td></tr>
      <tr><td>Bob</td><td>38.5</td><td>5.0</td><td>43.5</td></tr>
      <tr class="tl-subtotal-row"><td colspan="3">Team Total</td><td>101.0</td></tr>
    </tbody>
  </table>
</div>
```

- Leader row: class `tl-leader-row` (tinted background, bold name, role suffix `(TL)` or `(PM)`)
- Subtotal row: class `tl-subtotal-row` (right-aligned label, bold total)
- Unassigned group: header reads "Unassigned" (no role suffix)
- Grand total line below all groups: `Grand Total: 284.5 hrs`
- Empty state (no `tl_groups` or all empty): existing "No work logs this period." message

### CSS additions (inline in `<style>` block)

```css
.tl-group         { margin-bottom: 20px; }
.tl-group-header  { font-size: 14px; font-weight: 700; margin: 0 0 6px 0; color: var(--c-text); }
.tl-leader-row td { background: var(--c-surface-2, #f0f4ff); font-weight: 600; }
.tl-subtotal-row td { font-weight: 700; border-top: 1px solid var(--c-border); }
```

---

## Invariants

- `payroll_status` table is untouched — flat render stays as-is.
- If a TL has no work logs themselves but their team does, the leader entry appears with 0.0 hours (not omitted).
- If a leader has work logs but zero team members with logs, they appear as a single-row group (leader row + subtotal = same value).
- TEAM_LEAD always sees exactly one group (their own). If no matching group exists (new TL, no team logged yet), they see the empty state.

---

## Files Changed

| File | Change |
|------|--------|
| `src/07-portal/PortalData.gs` | Replace flat `team_hours` build in `getLeaderDashboard` with `tl_groups` grouping logic |
| `src/07-portal/PortalView.html` | Replace flat table in `renderLeaderDashboard` with per-group section rendering + CSS |
