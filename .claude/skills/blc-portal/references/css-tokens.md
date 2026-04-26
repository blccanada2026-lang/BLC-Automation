# BLC Portal — CSS Tokens & Badge Reference

## Design Tokens (`:root`)

| Token | Value | Usage |
|---|---|---|
| `--c-primary` | `#1a3c5e` | Header bg, stat values, primary accent |
| `--c-secondary` | `#2d6a9f` | `.btn-primary`, focus borders |
| `--c-accent` | `#f59e0b` | Highlight, warning accent |
| `--c-bg` | `#f1f5f9` | Page background |
| `--c-surface` | `#ffffff` | Cards, tables, modals |
| `--c-border` | `#e2e8f0` | All borders |
| `--c-text` | `#1e293b` | Body text |
| `--c-muted` | `#64748b` | Labels, secondary text, icons |
| `--c-success` | `#10b981` | `.btn-success`, positive badges |
| `--c-danger` | `#ef4444` | `.btn-danger`, error states |
| `--c-warning` | `#f59e0b` | `.btn-warning`, caution badges |
| `--radius` | `6px` | All border-radius |
| `--shadow` | `0 1px 3px rgba(0,0,0,0.1)` | Cards, panels |

## Job State Badges (`.badge-STATENAME`)

```css
.badge-INTAKE_RECEIVED    { background: #f1f5f9; color: #64748b; }
.badge-ALLOCATED          { background: #dbeafe; color: #1d4ed8; }
.badge-IN_PROGRESS        { background: #ede9fe; color: #7c3aed; }
.badge-ON_HOLD            { background: #fef3c7; color: #b45309; }
.badge-CLIENT_RETURN      { background: #ffedd5; color: #c2410c; }
.badge-QC_REVIEW          { background: #fce7f3; color: #9d174d; }
.badge-COMPLETED_BILLABLE { background: #d1fae5; color: #065f46; }
.badge-INVOICED           { background: #e2e8f0; color: #475569; }
.badge-rework             { background: #fee2e2; color: #991b1b; }
```

Render in JS:
```javascript
function stateBadge(state) {
  return '<span class="badge badge-' + state + '">' + state.replace(/_/g, ' ') + '</span>';
}
```

## Payroll Status Badges (`.pay-STATUSNAME`)

```css
.pay-badge                { display:inline-block; padding:3px 9px; border-radius:12px;
                            font-size:11px; font-weight:700; letter-spacing:.04em; }
.pay-PENDING_CONFIRMATION { background:#fef3c7; color:#b45309; }
.pay-CONFIRMED            { background:#d1fae5; color:#065f46; }
.pay-PROCESSED            { background:#dbeafe; color:#1d4ed8; }
.pay-NOT_RUN              { background:#f1f5f9; color:#64748b; }
```

## Button Variants

| Class | Colour | Use for |
|---|---|---|
| `.btn-primary` | Blue `#2d6a9f` | Default actions, form submits |
| `.btn-success` | Green `#10b981` | Confirm, approve, save |
| `.btn-warning` | Amber `#f59e0b` | Caution actions (send emails) |
| `.btn-danger` | Red `#ef4444` | Destructive / irreversible |
| `.btn-muted` | Grey `#e2e8f0` | Secondary / cancel |
| `.btn-ghost` | Transparent/white | Header-area buttons only |
| `.btn-sm` | (modifier) | Small inline action buttons in table rows |

## Typography Scale

| Use | Size | Weight | Color | Transform |
|---|---|---|---|---|
| Page h1 (header) | 16px | 700 | white | — |
| Section h2 | 15px | 700 | `--c-text` | — |
| Table headers | 11px | 700 | `--c-muted` | uppercase |
| Labels | 12px | 600 | `--c-muted` | uppercase |
| Body / td | 14px | 400 | `--c-text` | — |
| Badge text | 11px | 700 | varies | — |
| Small / secondary | 12px | 400 | `--c-muted` | — |

## Notification / Toast

```css
.notif { position:fixed; bottom:20px; right:20px; padding:12px 20px;
         border-radius:var(--radius); font-size:13px; font-weight:600;
         box-shadow:0 4px 12px rgba(0,0,0,.15); z-index:200; transition:opacity .3s; }
.notif-ok  { background:#d1fae5; color:#065f46; border:1px solid #6ee7b7; }
.notif-err { background:#fee2e2; color:#991b1b; border:1px solid #fca5a5; }
```

```javascript
function showNotif(msg, isErr) {
  var el = document.createElement('div');
  el.className = 'notif ' + (isErr ? 'notif-err' : 'notif-ok');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(function() { el.style.opacity = '0'; }, 2800);
  setTimeout(function() { el.parentNode && el.parentNode.removeChild(el); }, 3200);
}
```
