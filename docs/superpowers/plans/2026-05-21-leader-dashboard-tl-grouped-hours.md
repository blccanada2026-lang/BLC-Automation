# Leader Dashboard: TL-Grouped Team Hours — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Team Hours table on the Leader Dashboard with per-TL grouped sections, built from DIM_STAFF_ROSTER and overlaid with FACT_WORK_LOGS hours.

**Architecture:** `getLeaderDashboard` in PortalData.gs gains a new private `buildTlGroups_` helper that reads active roster → builds groups → overlays hours from hoursMap. The response returns both `tl_groups` (new) and `team_hours` (kept for one transition cycle). The frontend `renderLeaderDashboard` prefers `tl_groups` and falls back to `team_hours`.

**Tech Stack:** Google Apps Script (V8), vanilla JS DOM manipulation in GAS HtmlService.

---

## Files Changed

| File | Lines | What changes |
|------|-------|-------------|
| `src/07-portal/PortalData.gs` | 359–366 | Lift `staffRows` declaration outside try block |
| `src/07-portal/PortalData.gs` | 402 (after) | Add `buildTlGroups_` call |
| `src/07-portal/PortalData.gs` | 444–448 | Add `tl_groups` to return JSON |
| `src/07-portal/PortalData.gs` | 774 (before PUBLIC API) | Insert `buildTlGroups_` function |
| `src/07-portal/PortalData.gs` | 1033 (after IIFE) | Append `testLeaderDashboardGroups` standalone function |
| `src/07-portal/PortalView.html` | 127 (after) | Add 4 CSS rules |
| `src/07-portal/PortalView.html` | 2565 (before renderLeaderDashboard) | Insert `renderGroupedHours` + `renderFlatHours` functions |
| `src/07-portal/PortalView.html` | 2573–2612 | Replace flat hours block with dispatch logic |

---

## Task 1: Backend — `buildTlGroups_` + update `getLeaderDashboard`

**Files:**
- Modify: `src/07-portal/PortalData.gs:359-366` (lift staffRows)
- Modify: `src/07-portal/PortalData.gs:402` (add tl_groups call)
- Modify: `src/07-portal/PortalData.gs:444-448` (add tl_groups to return)
- Modify: `src/07-portal/PortalData.gs:774` (insert buildTlGroups_ before PUBLIC API)
- Modify: `src/07-portal/PortalData.gs:1033` (append test function)

- [ ] **Step 1: Write the test function first**

Append this to the very end of `src/07-portal/PortalData.gs` (after the closing `}();` on line 1032):

```javascript
/**
 * Targeted test: verifies getLeaderDashboard emits tl_groups with correct shape.
 * Run from Apps Script editor as an active CEO or PM user (DEV only).
 */
function testLeaderDashboardGroups() {
  if (!Config.isDev()) throw new Error('testLeaderDashboardGroups: DEV only');
  var email = Session.getActiveUser().getEmail();
  var raw   = PortalData.getLeaderDashboard(email);
  var data  = JSON.parse(raw);

  if (!Array.isArray(data.tl_groups))  throw new Error('FAIL: tl_groups missing or not array');
  if (!Array.isArray(data.team_hours)) throw new Error('FAIL: team_hours missing');

  for (var i = 0; i < data.tl_groups.length; i++) {
    var g = data.tl_groups[i];
    if (g.leader !== null && typeof g.leader.person_code !== 'string')
      throw new Error('FAIL: group[' + i + '].leader.person_code not string');
    if (!Array.isArray(g.members))
      throw new Error('FAIL: group[' + i + '].members not array');
    if (typeof g.subtotal !== 'number')
      throw new Error('FAIL: group[' + i + '].subtotal not number');
    var expectedSub = (g.leader ? g.leader.total_hours : 0);
    for (var m = 0; m < g.members.length; m++) expectedSub += g.members[m].total_hours;
    expectedSub = Math.round(expectedSub * 100) / 100;
    if (Math.abs(expectedSub - g.subtotal) > 0.01)
      throw new Error('FAIL: group[' + i + '].subtotal mismatch: got ' + g.subtotal + ', want ' + expectedSub);
  }

  Logger.info('testLeaderDashboardGroups PASS', {
    group_count: data.tl_groups.length,
    team_hours_count: data.team_hours.length,
    period_id: data.period_id
  });
  return 'PASS: ' + data.tl_groups.length + ' groups, ' + data.team_hours.length + ' flat rows';
}
```

- [ ] **Step 2: Confirm the test fails**

In the Apps Script editor: select `testLeaderDashboardGroups` and run it.
Expected: throws `FAIL: tl_groups missing or not array` (because `tl_groups` doesn't exist yet).

- [ ] **Step 3: Insert `buildTlGroups_` before the PUBLIC API section**

Insert this function block immediately before the `// ============================================================` comment on line 776 of `src/07-portal/PortalData.gs` (right before `// PUBLIC API`):

```javascript
  // ============================================================
  // SECTION: buildTlGroups_
  // Builds grouped team hours from active DIM_STAFF_ROSTER rows,
  // then overlays hours from hoursMap. Every active leader gets a
  // group entry even if no hours have been logged.
  // ============================================================

  /**
   * @param {Object[]} staffRows  Active-only rows from DIM_STAFF_ROSTER
   * @param {Object}   hoursMap   { person_code: { design: N, qc: N } }
   * @param {Object}   nameMap    { person_code: displayName }
   * @param {string}   actorRole  RBAC role of requesting actor
   * @param {string}   actorCode  personCode of requesting actor
   * @returns {Object[]}  [{ leader, members, subtotal }] sorted desc by subtotal
   */
  function buildTlGroups_(staffRows, hoursMap, nameMap, actorRole, actorCode) {
    var today = new Date().toISOString().substring(0, 10);

    var roleMap        = {};   // person_code → role
    var rosterByLeader = {};   // leader_code → [{ person_code, name }]
    var leaderSet      = {};   // leader_code → true

    for (var i = 0; i < staffRows.length; i++) {
      var s = staffRows[i];

      // Active check (mirrors getMyRatees logic)
      if (s.active === false || String(s.active).toUpperCase().trim() === 'FALSE') continue;
      var et = s.effective_to;
      if (et instanceof Date) {
        var ey = et.getFullYear(), em = String(et.getMonth()+1), ed = String(et.getDate());
        if (em.length < 2) em = '0'+em;
        if (ed.length < 2) ed = '0'+ed;
        et = ey + '-' + em + '-' + ed;
      } else {
        et = String(et || '').trim().substring(0, 10);
      }
      if (et && et < today) continue;

      var code = String(s.person_code     || '').trim();
      var sup  = String(s.supervisor_code || '').trim();
      var role = String(s.role            || '').toUpperCase().trim();
      if (!code) continue;

      roleMap[code] = role;

      if (sup) {
        if (!rosterByLeader[sup]) rosterByLeader[sup] = [];
        rosterByLeader[sup].push({ person_code: code, name: nameMap[code] || code });
        leaderSet[sup] = true;
      }
    }

    // TEAM_LEAD: build only their own group (synthesized even if empty)
    var leaderCodes = (actorRole === 'TEAM_LEAD')
      ? [actorCode]
      : Object.keys(leaderSet);

    var groups = [];

    for (var l = 0; l < leaderCodes.length; l++) {
      var lCode = leaderCodes[l];
      var lh    = hoursMap[lCode] || { design: 0, qc: 0 };
      var lDes  = Math.round(lh.design * 100) / 100;
      var lQc   = Math.round(lh.qc    * 100) / 100;
      var leader = {
        person_code:  lCode,
        name:         nameMap[lCode] || lCode,
        role:         roleMap[lCode] || '',
        design_hours: lDes,
        qc_hours:     lQc,
        total_hours:  Math.round((lDes + lQc) * 100) / 100
      };

      var reports = rosterByLeader[lCode] || [];
      var members = [];
      for (var m = 0; m < reports.length; m++) {
        var mCode = reports[m].person_code;
        var mh    = hoursMap[mCode] || { design: 0, qc: 0 };
        var mDes  = Math.round(mh.design * 100) / 100;
        var mQc   = Math.round(mh.qc    * 100) / 100;
        members.push({
          person_code:  mCode,
          name:         reports[m].name,
          design_hours: mDes,
          qc_hours:     mQc,
          total_hours:  Math.round((mDes + mQc) * 100) / 100
        });
      }
      members.sort(function(a, b) { return b.total_hours - a.total_hours; });

      var sub = leader.total_hours;
      for (var ms = 0; ms < members.length; ms++) sub += members[ms].total_hours;

      groups.push({ leader: leader, members: members, subtotal: Math.round(sub * 100) / 100 });
    }

    // Orphaned entries: hours logged but not assigned to any group (CEO/PM/ADMIN only)
    if (actorRole !== 'TEAM_LEAD') {
      var assigned = {};
      for (var g = 0; g < groups.length; g++) {
        if (groups[g].leader) assigned[groups[g].leader.person_code] = true;
        for (var gm = 0; gm < groups[g].members.length; gm++) {
          assigned[groups[g].members[gm].person_code] = true;
        }
      }
      var orphans = [];
      var hCodes = Object.keys(hoursMap);
      for (var o = 0; o < hCodes.length; o++) {
        if (assigned[hCodes[o]]) continue;
        var oh   = hoursMap[hCodes[o]];
        var oDes = Math.round(oh.design * 100) / 100;
        var oQc  = Math.round(oh.qc    * 100) / 100;
        orphans.push({
          person_code:  hCodes[o],
          name:         nameMap[hCodes[o]] || hCodes[o],
          design_hours: oDes,
          qc_hours:     oQc,
          total_hours:  Math.round((oDes + oQc) * 100) / 100
        });
      }
      if (orphans.length > 0) {
        orphans.sort(function(a, b) { return b.total_hours - a.total_hours; });
        var oSub = 0;
        for (var os = 0; os < orphans.length; os++) oSub += orphans[os].total_hours;
        groups.push({ leader: null, members: orphans, subtotal: Math.round(oSub * 100) / 100 });
      }
    }

    // Sort by subtotal desc; orphan group (leader === null) stays last
    groups.sort(function(a, b) {
      if (a.leader === null) return 1;
      if (b.leader === null) return -1;
      return b.subtotal - a.subtotal;
    });

    return groups;
  }

```

- [ ] **Step 4: Lift `staffRows` out of the try block**

In `getLeaderDashboard` at line 359–366, change:

```javascript
    var staffNameMap = {};
    try {
      var staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
      for (var s = 0; s < staffRows.length; s++) {
        var code = String(staffRows[s].person_code || '').trim();
        if (code) staffNameMap[code] = String(staffRows[s].name || code);
      }
    } catch (e) { /* table may not exist yet */ }
```

to:

```javascript
    var staffNameMap = {};
    var staffRows    = [];
    try {
      staffRows = DAL.readAll(Config.TABLES.DIM_STAFF_ROSTER, { callerModule: 'PortalData' });
      for (var s = 0; s < staffRows.length; s++) {
        var code = String(staffRows[s].person_code || '').trim();
        if (code) staffNameMap[code] = String(staffRows[s].name || code);
      }
    } catch (e) { /* table may not exist yet */ }
```

- [ ] **Step 5: Call `buildTlGroups_` after `teamHours.sort(...)` (line 402)**

After the line `teamHours.sort(function(a, b) { return b.total_hours - a.total_hours; });`, add:

```javascript
    // ── 3b. Build tl_groups from roster + hoursMap ────────────
    var tlGroups = buildTlGroups_(staffRows, hoursMap, staffNameMap, role, actor.personCode);
```

- [ ] **Step 6: Add `tl_groups` to the return JSON**

Change the return statement (currently lines 444–448) from:

```javascript
    return JSON.stringify({
      period_id:      periodId,
      team_hours:     teamHours,
      payroll_status: payrollStatus
    });
```

to:

```javascript
    return JSON.stringify({
      period_id:      periodId,
      tl_groups:      tlGroups,
      team_hours:     teamHours,
      payroll_status: payrollStatus
    });
```

- [ ] **Step 7: Run the test — confirm it passes**

In the Apps Script editor: select `testLeaderDashboardGroups` and run it.
Expected in execution transcript: `testLeaderDashboardGroups PASS` with `group_count` > 0.
If it throws, read the error message — it will name the exact failing assertion.

- [ ] **Step 8: Commit**

```bash
git add src/07-portal/PortalData.gs
git commit -m "feat(portal): add buildTlGroups_ + emit tl_groups in getLeaderDashboard"
```

---

## Task 2: Frontend — CSS + extract `renderFlatHours`

**Files:**
- Modify: `src/07-portal/PortalView.html:127` (add CSS after this line)
- Modify: `src/07-portal/PortalView.html:2565` (insert renderFlatHours before renderLeaderDashboard)
- Modify: `src/07-portal/PortalView.html:2573-2612` (update hours dispatch to call renderFlatHours)

- [ ] **Step 1: Add 4 CSS rules**

In `src/07-portal/PortalView.html`, after line 127 (after `.dash-tbl th { ... }` rule), insert:

```css
    .tl-group          { margin-bottom:20px; }
    .tl-group-header   { font-size:13px; font-weight:700; margin:0 0 6px 0;
                         color:var(--c-text); padding:4px 0; }
    .tl-leader-row td  { background:#f0f4ff; font-weight:600; }
    .tl-subtotal-row td { font-weight:700; border-top:1px solid var(--c-border);
                          color:var(--c-text); }
```

- [ ] **Step 2: Insert `renderFlatHours` before `renderLeaderDashboard`**

Insert the following function immediately before the `function renderLeaderDashboard(data) {` line (currently line 2566):

```javascript
function renderFlatHours(teamHours, container) {
  var totalHrs = 0;
  var tbl = document.createElement('table');
  tbl.className = 'dash-tbl';
  var thead = document.createElement('thead');
  var hr = document.createElement('tr');
  ['Person', 'Design Hrs', 'QC Hrs', 'Total'].forEach(function(h) {
    var th = document.createElement('th'); th.textContent = h; hr.appendChild(th);
  });
  thead.appendChild(hr);
  tbl.appendChild(thead);
  var tbody = document.createElement('tbody');
  teamHours.forEach(function(row) {
    totalHrs += row.total_hours || 0;
    var tr = document.createElement('tr');
    var nameCell = document.createElement('td');
    nameCell.textContent = row.name || row.person_code;
    nameCell.style.fontWeight = '600';
    tr.appendChild(nameCell);
    [row.design_hours, row.qc_hours, row.total_hours].forEach(function(v) {
      var td = document.createElement('td');
      td.textContent = (v || 0).toFixed(1);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tbl.appendChild(tbody);
  container.appendChild(tbl);
  document.getElementById('dash-hours-total').textContent =
    'Total: ' + totalHrs.toFixed(1) + ' hrs';
}

```

- [ ] **Step 3: Replace the inline hours block with a `renderFlatHours` call**

In `renderLeaderDashboard`, replace lines 2573–2612 (the entire hours `if/else` block):

Old (from `if (!data.team_hours ...` to `...toFixed(1) + ' hrs';`):

```javascript
  if (!data.team_hours || data.team_hours.length === 0) {
    var emptyHours = document.createElement('div');
    emptyHours.className   = 'dash-empty';
    emptyHours.textContent = 'No work logs this period.';
    hoursBody.appendChild(emptyHours);
  } else {
    var totalHrs = 0;
    var tbl = document.createElement('table');
    tbl.className = 'dash-tbl';
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    ['Person', 'Design Hrs', 'QC Hrs', 'Total'].forEach(function(h) {
      var th = document.createElement('th');
      th.textContent = h;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    tbl.appendChild(thead);

    var tbody = document.createElement('tbody');
    data.team_hours.forEach(function(row) {
      totalHrs += row.total_hours || 0;
      var tr = document.createElement('tr');
      var nameCell = document.createElement('td');
      nameCell.textContent = row.name || row.person_code;
      nameCell.style.fontWeight = '600';
      tr.appendChild(nameCell);
      [row.design_hours, row.qc_hours, row.total_hours].forEach(function(v) {
        var td = document.createElement('td');
        td.textContent = (v || 0).toFixed(1);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    hoursBody.appendChild(tbl);

    document.getElementById('dash-hours-total').textContent =
      'Total: ' + totalHrs.toFixed(1) + ' hrs';
  }
```

New:

```javascript
  if (data.tl_groups && data.tl_groups.length > 0) {
    renderGroupedHours(data.tl_groups, hoursBody);
  } else if (data.team_hours && data.team_hours.length > 0) {
    renderFlatHours(data.team_hours, hoursBody);
  } else {
    var emptyHours = document.createElement('div');
    emptyHours.className   = 'dash-empty';
    emptyHours.textContent = 'No work logs this period.';
    hoursBody.appendChild(emptyHours);
  }
```

- [ ] **Step 4: Open the portal in a browser and verify the dashboard still loads**

As a CEO or PM user: open the portal, click Dashboard. The Team Hours panel should render (flat table for now since `renderGroupedHours` doesn't exist yet — the fallback `renderFlatHours` path will be used until Task 3). No JS errors in the browser console. Payroll status panel unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/07-portal/PortalView.html
git commit -m "feat(portal): add CSS for tl-groups, extract renderFlatHours, wire dispatch"
```

---

## Task 3: Frontend — `renderGroupedHours`

**Files:**
- Modify: `src/07-portal/PortalView.html` (insert `renderGroupedHours` before `renderFlatHours`)

- [ ] **Step 1: Insert `renderGroupedHours` immediately before `renderFlatHours`**

In `src/07-portal/PortalView.html`, insert the following function immediately before the `function renderFlatHours(` line added in Task 2:

```javascript
function renderGroupedHours(groups, container) {
  var grandTotal = 0;
  groups.forEach(function(group) {
    grandTotal += group.subtotal || 0;

    var groupDiv = document.createElement('div');
    groupDiv.className = 'tl-group';

    var header = document.createElement('h4');
    header.className = 'tl-group-header';
    if (group.leader) {
      var suffix = group.leader.role === 'TEAM_LEAD' ? ' (TL)' :
                   group.leader.role === 'PM'        ? ' (PM)' : '';
      header.textContent = (group.leader.name || group.leader.person_code) + suffix + "'s Team";
    } else {
      header.textContent = 'Unassigned';
    }
    groupDiv.appendChild(header);

    var tbl = document.createElement('table');
    tbl.className = 'dash-tbl';
    var thead = document.createElement('thead');
    var hrow = document.createElement('tr');
    ['Person', 'Design Hrs', 'QC Hrs', 'Total'].forEach(function(h) {
      var th = document.createElement('th'); th.textContent = h; hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    tbl.appendChild(thead);

    var tbody = document.createElement('tbody');

    // Leader row (tinted, bold, role suffix)
    if (group.leader) {
      var lSuffix = group.leader.role === 'TEAM_LEAD' ? ' (TL)' :
                    group.leader.role === 'PM'        ? ' (PM)' : '';
      var ltr = document.createElement('tr');
      ltr.className = 'tl-leader-row';
      var ltd = document.createElement('td');
      ltd.textContent = (group.leader.name || group.leader.person_code) + lSuffix;
      ltr.appendChild(ltd);
      [group.leader.design_hours, group.leader.qc_hours, group.leader.total_hours].forEach(function(v) {
        var td = document.createElement('td');
        td.textContent = (v || 0).toFixed(1);
        ltr.appendChild(td);
      });
      tbody.appendChild(ltr);
    }

    // Member rows
    group.members.forEach(function(member) {
      var mtr = document.createElement('tr');
      var mtd = document.createElement('td');
      mtd.textContent = member.name || member.person_code;
      mtr.appendChild(mtd);
      [member.design_hours, member.qc_hours, member.total_hours].forEach(function(v) {
        var td = document.createElement('td');
        td.textContent = (v || 0).toFixed(1);
        mtr.appendChild(td);
      });
      tbody.appendChild(mtr);
    });

    // Subtotal row
    var str = document.createElement('tr');
    str.className = 'tl-subtotal-row';
    var stLabel = document.createElement('td');
    stLabel.setAttribute('colspan', '3');
    stLabel.textContent = 'Team Total';
    str.appendChild(stLabel);
    var stVal = document.createElement('td');
    stVal.textContent = (group.subtotal || 0).toFixed(1);
    str.appendChild(stVal);
    tbody.appendChild(str);

    tbl.appendChild(tbody);
    groupDiv.appendChild(tbl);
    container.appendChild(groupDiv);
  });

  document.getElementById('dash-hours-total').textContent =
    'Grand Total: ' + grandTotal.toFixed(1) + ' hrs';
}

```

- [ ] **Step 2: Verify in browser — CEO/PM view (grouped)**

As a CEO or PM user: open the portal, open Dashboard. Expected:
- Team Hours panel shows multiple `<div class="tl-group">` sections
- Each section has an `<h4>` header like "SVN (TL)'s Team"
- Leader row is tinted blue (`#f0f4ff` background), bold, with `(TL)` or `(PM)` suffix
- Members listed below leader, sorted by total hours descending
- Subtotal row at bottom of each table, bold
- "Grand Total: X.X hrs" in the panel header meta area
- Payroll status section below is unchanged

- [ ] **Step 3: Verify in browser — TEAM_LEAD view (scoped)**

As a TEAM_LEAD user: open the portal, open Dashboard. Expected:
- Exactly one group section visible (their own team)
- Their own row appears as the leader row
- Their direct reports listed as members
- If no hours logged yet, all hours show 0.0 but the section still appears

- [ ] **Step 4: Verify fallback (optional — simulate by removing tl_groups from response)**

If you want to manually verify the flat fallback: temporarily comment out the `tl_groups: tlGroups,` line in `getLeaderDashboard`, reload the portal. The Team Hours panel should fall back to the original flat table. Uncomment when done.

- [ ] **Step 5: Commit**

```bash
git add src/07-portal/PortalView.html
git commit -m "feat(portal): add renderGroupedHours — TL-grouped team hours on leader dashboard"
```

---

## Self-Review Checklist

- [x] Spec constraint 1 (roster-first): `buildTlGroups_` loops staffRows first, then overlays hoursMap — ✓
- [x] Spec constraint 2 (keep team_hours): return JSON in Step 6 includes both keys — ✓
- [x] Spec constraint 3 (frontend fallback): dispatch in Task 2 Step 3 prefers `tl_groups`, falls back to `team_hours` — ✓
- [x] Spec constraint 4 (TL synthesized group): `leaderCodes = [actorCode]` for TEAM_LEAD, rosterByLeader defaults to `[]` — ✓
- [x] Spec constraint 5 (payroll unchanged): no changes to payroll section in any task — ✓
- [x] Spec constraint 6 (only 2 files): only PortalData.gs and PortalView.html touched — ✓
- [x] Spec constraint 7 (targeted tests): `testLeaderDashboardGroups` standalone function, no full suite — ✓
- [x] Spec constraint 8 (no push without approval): no push step in any task — ✓
- [x] Type consistency: `buildTlGroups_` called with `(staffRows, hoursMap, staffNameMap, role, actor.personCode)` in Step 5, defined as `(staffRows, hoursMap, nameMap, actorRole, actorCode)` — ✓
- [x] `--c-surface-2` avoided (doesn't exist in codebase) — hardcoded `#f0f4ff` used instead — ✓
