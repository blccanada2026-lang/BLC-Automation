# BLC Nexus — SOP Guardrails

**Quick-reference safety card. Read at the start of every SOP session.**  
Full governance: `docs/SOP_MASTER_PROMPT.md`

---

## STOP CONDITIONS

Stop immediately and report to Raj if any of these are true:

- `.clasp.json` `scriptId` matches PROD (`1HzRiDrQJ6z…`) — should be DEV (`1smkj0mmUq…`)
- Any instruction asks you to run `npm run push:prod`
- Any instruction asks you to run `clasp push` directly
- Any instruction asks you to modify PROD Script Properties
- Any instruction asks you to set `QMS_ENABLED=true`, `QMS_QC_PROCESS_ENABLED=true`, or `QMS_FINDINGS_ENABLED=true` in PROD
- A conversation instruction conflicts with these docs

---

## ENVIRONMENT RULES

| Rule | Detail |
|---|---|
| Default environment | DEV always |
| PROD deployment | Forbidden unless Raj explicitly approves with the session date |
| `.clasp.json` edits | Never — managed by npm deploy scripts only |
| Script Properties | DEV only during SOP work |

DEV Script ID: `1smkj0mmUqcWDDJPq-RUuVxRG4nE3TMKy4KrOIVUcdEN9lrFucL57aqAE`  
PROD Script ID: `1HzRiDrQJ6z-BxPzk-MHgm4pUb5enabsEA9Hg16OoRzpOhGjv9FyeiQQ0`

---

## SOP WORK RULES

| Rule | Detail |
|---|---|
| SOP identity | `client_code + product_code` — never job_type or software |
| Products | Never merged — one SOP per client+product |
| Google Forms | Banned as live input (R1) — analysis only, never 1:1 copy |
| In-place SOP edits | Never — version increment always |
| Import approval | Section E must be approved before anything enters Nexus |
| Phase gate | No phase starts without approval from prior phase |

---

## TWO SOP FAMILIES

| Family | Purpose | Keyed by |
|---|---|---|
| Designer SOP | Did the designer do the work? | `client_code + product_code` |
| QC Review SOP | Did QC properly validate it? | `GLOBAL_QC_REVIEW_SOP` by default |

QC SOP is NOT a duplicate of Designer SOP — it is a process checklist.  
Only create client/product-specific QC SOPs when the client truly requires unique QC workflows.

---

## ITEM QUALITY TEST

Every SOP item must pass:

> "Can an auditor objectively verify this was completed?"

If NO → reject.

---

## SIZE LIMITS

- Preferred: 15–30 items  
- Hard max: 40 items  
- Challenge every BLOCKING item — too many creates operational friction

---

## QMS FEATURE FLAGS

All QMS flags default to `false`. Never set these to `true` in PROD.

| Flag | Purpose | Safe value in PROD |
|---|---|---|
| `QMS_ENABLED` | Master QMS switch | `false` |
| `QMS_QC_PROCESS_ENABLED` | QC checklist layer | `false` |
| `QMS_FINDINGS_ENABLED` | Findings taxonomy layer | `false` |
| `QMS_DEV_ONLY` | Enforces DEV-only mode | `true` (always) |

If `QMS_ENABLED` is absent, the QMS is silent. Never set any QMS flag in PROD without CTO written approval on the date of the session.

---

## DOCUMENTATION WINS

If a conversation conflicts with `docs/CLAUDE_SOP_MEMORY.md`, `docs/SOP_DECISIONS.md`, or this file:

**Stop. Ask for clarification. Documentation is the source of truth.**

Any new SOP or QMS decision must be written to the docs — it cannot live only in chat context.
