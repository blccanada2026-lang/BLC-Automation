---
name: blc-portal
description: >
  BLC Nexus portal development conventions — use this whenever building, extending, or debugging
  the GAS Web App portal (src/07-portal/). Covers HtmlService patterns, server-side portal_* functions,
  client-side google.script.run calls, the CSS design system, RBAC flow, data injection, and modal/table
  patterns. Invoke any time the user asks to add a portal page, portal button, dashboard panel, modal form,
  data table, or server-callable function. Also use when the user references PortalView.html, Portal.gs,
  doGet, google.script.run, or the leader dashboard — even if they don't say "portal skill".
---

# BLC Portal — Development Conventions

This skill encodes the exact patterns used in the BLC Nexus portal (T7). Follow them precisely — the
portal runs in the GAS sandbox, so deviations (CDNs, ES6 modules, fetch, import) will silently break.

## File Structure

```
src/07-portal/
  Portal.gs          ← GAS Web App entry point + all portal_* global functions
  PortalData.gs      ← data layer: reads FACT/DIM tables, formats response JSON
  PortalView.html    ← main portal page (one-page app, sections shown/hidden by JS)
  QuarterlyRating.html ← standalone page for the rating flow (separate doGet route)
```

New pages go in `src/07-portal/`. New server functions go in `Portal.gs` as top-level globals.
Business logic never lives in Portal.gs — it delegates to `PortalData.gs` or a business module.

## Server Side — Portal.gs Conventions

### Function naming and shape
Every function exposed to `google.script.run` must be a **top-level global** (not inside a class or IIFE).
Name them `portal_<action>` (snake_case after the prefix).

```javascript
/**
 * Short description.
 * @param {string} payloadJson  JSON-encoded payload
 * @returns {string}  JSON: { ok: true, ... }
 */
function portal_myAction(payloadJson) {
  var email = Session.getActiveUser().getEmail();   // ← always first
  var payload;
  try { payload = JSON.parse(payloadJson); }
  catch (e) { throw new Error('portal_myAction: invalid JSON payload.'); }

  var result = MyModule.doThing(email, payload);    // ← delegate to business module
  return JSON.stringify(result);                    // ← always return a JSON string
}
```

Key rules:
- `Session.getActiveUser().getEmail()` is **always the first line**
- Parse `payloadJson` in a try/catch and throw a named error on failure
- Delegate to `PortalData.gs` or a business module — no business logic in Portal.gs
- Return `JSON.stringify(result)` — never a raw object (GAS serialises inconsistently)
- RBAC is enforced inside the business module, not in Portal.gs

### doGet routing
```javascript
function doGet(e) {
  var page = e && e.parameter && e.parameter.page ? e.parameter.page : '';

  if (page === 'my-page') {
    // Data injection pattern — inject JS vars before the HTML body
    var html    = HtmlService.createHtmlOutputFromFile('07-portal/MyPage');
    var content = '<script>var INJECTED_DATA = ' + JSON.stringify(data) + ';<\/script>\n'
                + html.getContent();
    return HtmlService.createHtmlOutput(content)
      .setTitle('BLC My Page')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService
    .createHtmlOutputFromFile('07-portal/PortalView')
    .setTitle('BLC Job Portal')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

File references omit `.html`: `'07-portal/PortalView'` not `'07-portal/PortalView.html'`.

### PortalData.gs pattern
`PortalData.gs` is a singleton module. It calls `getDAL()` for all sheet reads (Rule A2).
New data functions follow this shape:

```javascript
var PortalData = (function() {
  function myQuery(email) {
    var actor = ActorResolver.resolve(email);
    RBAC.enforcePermission(actor, 'SOME_PERMISSION');
    var rows = getDAL().getRows('SOME_TABLE', {});
    // ... shape the data ...
    return JSON.stringify(result);
  }
  return { myQuery: myQuery, /* ... other public API */ };
})();
```

## Client Side — HTML Conventions

### Language and compatibility
- **ES5 only** — use `var`, not `let`/`const`. No arrow functions, no template literals, no `fetch`.
- No external scripts or stylesheets (GAS sandbox blocks CDNs).
- No `import`/`export`, no modules.

### google.script.run pattern

```javascript
// Standard call — always include both handlers
google.script.run
  .withSuccessHandler(function(json) {
    var data = JSON.parse(json);
    // update DOM
  })
  .withFailureHandler(function(err) {
    showError(err.message || 'An error occurred.');
  })
  .portal_myAction(JSON.stringify(payload));
```

Loading state pattern:
```javascript
function loadSomething() {
  setLoading(true);
  google.script.run
    .withSuccessHandler(function(json) {
      setLoading(false);
      renderData(JSON.parse(json));
    })
    .withFailureHandler(function(err) {
      setLoading(false);
      showError(err.message);
    })
    .portal_getSomething();
}
```

### Data injection (for standalone pages)
Injected vars are checked with a typeof guard:
```javascript
var MY_VAR = (typeof INJECTED_MY_VAR !== 'undefined' ? INJECTED_MY_VAR : '') || '';
```

## CSS Design System

All CSS is inline in the HTML file (no separate stylesheet). Use CSS custom properties from `:root`.
See `references/css-tokens.md` for the full token list.

### Required `:root` block (copy into every new page)
```css
:root {
  --c-primary:   #1a3c5e;
  --c-secondary: #2d6a9f;
  --c-accent:    #f59e0b;
  --c-bg:        #f1f5f9;
  --c-surface:   #ffffff;
  --c-border:    #e2e8f0;
  --c-text:      #1e293b;
  --c-muted:     #64748b;
  --c-success:   #10b981;
  --c-danger:    #ef4444;
  --c-warning:   #f59e0b;
  --radius:      6px;
  --shadow:      0 1px 3px rgba(0,0,0,0.1);
}
```

### Reset block (copy into every new page)
```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       background: var(--c-bg); color: var(--c-text); font-size: 14px; line-height: 1.5; }
```

### Button classes
```css
button { cursor: pointer; font-family: inherit; font-size: 13px; border: none;
         border-radius: var(--radius); padding: 6px 14px; transition: opacity .15s; }
button:hover { opacity: .85; }
button:disabled { opacity: .4; cursor: not-allowed; }

.btn-primary { background: var(--c-secondary); color: #fff; }
.btn-success { background: var(--c-success);   color: #fff; }
.btn-warning { background: var(--c-warning);   color: #fff; }
.btn-danger  { background: var(--c-danger);    color: #fff; }
.btn-muted   { background: #e2e8f0;            color: var(--c-text); }
.btn-ghost   { background: rgba(255,255,255,.12); color: #fff; border: 1px solid rgba(255,255,255,.2); }
.btn-sm      { padding: 4px 10px; font-size: 12px; }
```

### Header
```css
header {
  background: var(--c-primary); color: #fff;
  padding: 0 24px; height: 56px;
  display: flex; align-items: center; justify-content: space-between;
  box-shadow: 0 2px 4px rgba(0,0,0,.2);
}
.header-brand h1 { font-size: 16px; font-weight: 700; letter-spacing: .02em; }
.header-user { display: flex; align-items: center; gap: 12px; font-size: 13px; }
.role-badge { background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.25);
              border-radius: 20px; padding: 3px 10px; font-size: 11px; font-weight: 700;
              letter-spacing: .06em; text-transform: uppercase; }
```

```html
<header>
  <div class="header-brand"><h1>BLC Nexus — Page Title</h1></div>
  <div class="header-user">
    <span class="role-badge" id="role-badge">...</span>
    <span id="user-email">Loading...</span>
  </div>
</header>
```

### Main layout
```css
main { max-width: 1280px; margin: 0 auto; padding: 24px 20px; }
```

### Data tables
```css
.table-wrap { background: var(--c-surface); border: 1px solid var(--c-border);
              border-radius: var(--radius); box-shadow: var(--shadow); overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th { background: #f8fafc; text-align: left; padding: 10px 14px; font-size: 11px;
     font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
     color: var(--c-muted); border-bottom: 1px solid var(--c-border); }
td { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #f8fafc; }
```

```html
<div class="table-wrap">
  <table>
    <thead><tr><th>Col A</th><th>Col B</th></tr></thead>
    <tbody id="my-table-body">
      <!-- populated by JS -->
    </tbody>
  </table>
</div>
```

### Stat cards
```css
.stats-bar { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
.stat-card { background: var(--c-surface); border: 1px solid var(--c-border);
             border-radius: var(--radius); padding: 14px 20px; min-width: 120px;
             box-shadow: var(--shadow); flex: 1; }
.stat-value { font-size: 28px; font-weight: 700; color: var(--c-primary); }
.stat-label { font-size: 11px; color: var(--c-muted); text-transform: uppercase;
              letter-spacing: .06em; margin-top: 2px; }
```

### Status badges
```css
.badge { display: inline-block; padding: 3px 9px; border-radius: 12px;
         font-size: 11px; font-weight: 700; letter-spacing: .04em; white-space: nowrap; }
```
Modifier classes follow the pattern `.badge-STATENAME`. See `references/css-tokens.md` for all badge colours.

### Dashboard grid (two-column, responsive)
```css
.dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media(max-width: 800px) { .dash-grid { grid-template-columns: 1fr; } }
.dash-panel { background: var(--c-surface); border: 1px solid var(--c-border);
              border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
.dash-panel-hdr { padding: 12px 16px; background: #f8fafc;
                  border-bottom: 1px solid var(--c-border); font-weight: 700; font-size: 13px; }
```

### Modal pattern
```css
.modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.4);
                  z-index: 100; align-items: center; justify-content: center; }
.modal-backdrop.open { display: flex; }
.modal { background: var(--c-surface); border-radius: var(--radius);
         width: 90%; max-width: 540px; box-shadow: 0 8px 32px rgba(0,0,0,.18); }
.modal-header { padding: 16px 20px; border-bottom: 1px solid var(--c-border);
                display: flex; justify-content: space-between; align-items: center; }
.modal-header h3 { font-size: 15px; font-weight: 700; }
.modal-close { background: none; padding: 4px 8px; color: var(--c-muted); font-size: 16px; }
.modal-body { padding: 20px; }
.modal-footer { padding: 12px 20px; border-top: 1px solid var(--c-border);
                display: flex; justify-content: flex-end; gap: 8px; }
```

```javascript
// Open / close helpers
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
// Wire close buttons: <button class="modal-close" data-close="modal-id">✕</button>
document.querySelectorAll('[data-close]').forEach(function(btn) {
  btn.addEventListener('click', function() { closeModal(btn.getAttribute('data-close')); });
});
```

### Form field patterns
```css
input, select, textarea {
  font-family: inherit; font-size: 13px; width: 100%;
  border: 1px solid var(--c-border); border-radius: var(--radius);
  padding: 7px 10px; outline: none; transition: border-color .15s;
}
input:focus, select:focus, textarea:focus { border-color: var(--c-secondary); }
label { display: block; font-weight: 600; margin-bottom: 4px; font-size: 12px;
        color: var(--c-muted); text-transform: uppercase; letter-spacing: .04em; }
.field { margin-bottom: 14px; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-section { border: 1px solid var(--c-border); border-radius: var(--radius);
                padding: 16px; margin-bottom: 16px; }
.form-section-title { font-weight: 700; font-size: 12px; text-transform: uppercase;
                      letter-spacing: .06em; color: var(--c-muted); margin-bottom: 12px; }
```

## RBAC — Portal Integration

RBAC is enforced inside `PortalData.gs` / business modules via `RBAC.enforcePermission(actor, permission)`.
The portal HTML reads `actor.role` from view data and conditionally shows/hides sections:

```javascript
// In the success handler for portal_getViewData:
var actor = data.actor;  // { email, personCode, role, displayName }
var perms = data.perms;  // { canCreateJob, canViewAll, isQcReviewer, isDesigner }

// Show CEO-only toolbar
if (actor.role === 'CEO' || actor.role === 'ADMIN') {
  document.getElementById('admin-toolbar').style.display = 'flex';
}
// Show leader dashboard for CEO/PM/TEAM_LEAD
if (['CEO', 'PM', 'TEAM_LEAD'].indexOf(actor.role) !== -1) {
  loadLeaderDashboard();
}
```

Never trust the client to enforce permissions — the server always re-checks via RBAC.

**Critical rule — `actor.role` for UI gating, never `perms.*`:**
`perms` flags (`canCreateJob`, `canViewAll`, etc.) are job-CRUD permissions only. They do not represent
role-level access. Always use `actor.role` directly for showing/hiding sections:

```javascript
// CORRECT — use actor.role for section visibility
if (actor.role === 'CEO' || actor.role === 'ADMIN') {
  document.getElementById('admin-tools-panel').style.display = 'block';
}
if (['CEO', 'PM', 'TEAM_LEAD'].indexOf(actor.role) !== -1) {
  loadLeaderDashboard();
}

// WRONG — perms.* flags are not role gates; these fields may not exist
if (perms.canManageStaff) { ... }   // ← does not exist; will be undefined
if (perms.isAdmin) { ... }          // ← does not exist; will be undefined
```

## Adding a New Portal Section — Checklist

1. **Portal.gs**: add `portal_mySection()` and any action functions (`portal_myAction()`)
2. **PortalData.gs**: add the data query / write function called by Portal.gs
3. **PortalView.html** (or new `.html` file): add the section div, CSS, and JS
4. **doGet** (if a new page): add routing in `doGet(e)` for `page === 'my-section'`
5. **RBAC**: ensure the business module enforces the correct permission
6. **Toolbar button** (if CEO/PM-triggered): add to the appropriate toolbar section in the HTML

## Toolbar Pattern (CEO actions)
```html
<div class="toolbar">
  <h2>Section Title</h2>
  <div class="toolbar-actions">
    <button class="btn-primary" onclick="doSomething()">Action Label</button>
  </div>
</div>
```

## Toast Notification Pattern

Use this for user feedback after server actions. Build with DOM methods — no `innerHTML`.

```css
.notif { position: fixed; bottom: 20px; right: 20px; padding: 12px 20px;
         border-radius: var(--radius); font-size: 13px; font-weight: 600;
         box-shadow: 0 4px 12px rgba(0,0,0,.15); z-index: 200; transition: opacity .3s; }
.notif-ok  { background: #d1fae5; color: #065f46; border: 1px solid #6ee7b7; }
.notif-err { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
```

```javascript
function showNotif(msg, isErr) {
  var d = document.createElement('div');
  d.className   = 'notif ' + (isErr ? 'notif-err' : 'notif-ok');
  d.textContent = msg;                          // textContent — never innerHTML
  document.body.appendChild(d);
  setTimeout(function() { d.style.opacity = '0'; }, 2800);
  setTimeout(function() { d.parentNode && d.parentNode.removeChild(d); }, 3200);
}
```

## Reference Files

- `references/css-tokens.md` — complete token list, all badge colours, all button variants
