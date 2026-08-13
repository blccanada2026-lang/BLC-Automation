# SOP Upload Workflow — Design Spec

**Status:** Approved by user, 2026-08-13. Ready for implementation planning.

## Problem

The CEO needs a way to get Standard Operating Procedure (SOP) checklists —
both the designer-facing checklist and the QC-reviewer-facing checklist —
into the system for any client and any product, without needing someone to
hand-write code for each one. Today this can only be done by a developer
calling backend functions directly from the Apps Script editor.

## Context: two pre-existing systems, at very different stages

Investigation before this spec was written found two separate, already-
designed systems in `src/13-sop/` that this workflow builds on top of,
rather than replacing:

**System 1 — Designer SOP checklist** (`SopAdminEngine.gs`, `SopGate.gs`,
`DIM_SOP_TEMPLATES`) — the mature system. A template is keyed by
`client_code + job_type + software + scope_code`. The backend engine
already has full `createTemplate` / `addItem` / `editItem` / `publishTemplate`
/ `retireTemplate` functions and a `DRAFT → ACTIVE → RETIRED` lifecycle.
**Nothing here is exposed through the portal** — only `portal_getSopChecklist`
and `portal_getSopGateStatus` exist, both read-only, for designers
consuming an already-published checklist. This is the system the
NORSPAN-MB truss SOP (W2-1) is being built on.

**System 2 — QC-reviewer process checklist ("QMS Layer 2")** — a
*different* checklist from the finding-codes picker built in W2-3 (that
one tags defect codes on a review outcome; this one is the QC reviewer's
own checklist, parallel to the designer's SOP checklist). Its schema
(`DIM_QC_PROCESS_TEMPLATES`, `DIM_QC_PROCESS_ITEMS`,
`FACT_QC_REVIEW_SESSIONS`, `FACT_QC_REVIEW_CHECKLISTS`) and taxonomy
(`QcConstants.gs`) are fully designed — including an explicit product-tiered
resolution model: a `GLOBAL` default, optional `PRODUCT_SUPPLEMENT`
templates per product, optional `CLIENT_OVERRIDE` templates per client
(ADR-gated). **No engine exists yet** — the schema comment names its
future engine (`QcProcessAdminEngine`) but it has not been built. This is
0% implemented beyond the plan.

Building System 2's engine is **out of scope for this spec** — it is the
immediate next project after this one (see "Out of scope" below). This
spec's upload workflow is designed to support both doc types from day
one, so no rework is needed once System 2's engine exists.

**Sequencing note:** the NORSPAN-MB truss SOP (W2-1, pilot starting
2026-08-17) proceeds now via the existing manual path — a Claude session
calling `SopAdminEngine` directly — and does not wait for this workflow
to be built.

### Correction: `scope_code` is already the product field — no schema change needed

An earlier draft of this spec proposed adding a new `product_code` column
to `DIM_SOP_TEMPLATES`. That was wrong, caught by re-reading `SopGate.gs`
directly rather than trusting the earlier framing: `SopGate.evaluate_()`
reads the job's own `product_code` field and passes it straight into
`SopDAL.findActiveTemplateForJob(clientCode, productCode)`, which matches
it against `DIM_SOP_TEMPLATES.scope_code` — **`scope_code` already *is*
the product-matching field**, and only `client_code` + `scope_code` drive
template resolution. `job_type` and `software` are required by
`SopAdminEngine.createTemplate` but are stored as descriptive metadata
only — neither participates in resolution. This is also already how W2-1
is being built (`scope_code='TRUSS'`).

Resolution: **no schema change to `DIM_SOP_TEMPLATES`, and no change to
`SopGate`.** Upload-created templates simply set `scope_code` directly to
the new taxonomy value (`TRUSS` / `OPEN_WOOD_FLOOR` / `I_JOIST_FLOOR`).
`job_type` is derived from the same value via a fixed display-label map
(`TRUSS` → `'Roof Truss'`, `OPEN_WOOD_FLOOR` → `'Open Wood Floor'`,
`I_JOIST_FLOOR` → `'I-Joist Floor'`) purely for readability in admin
screens — it plays no role in matching. `software` is a separate,
genuinely free-standing field (e.g. `'Alpine'`) with no fixed list today;
the CEO supplies it at upload time (or Claude infers it from the source
document during structuring) as plain text.

## Decisions made during brainstorming (do not re-litigate)

- **Upload mechanism:** the CEO uploads the actual source document (not a
  form-built checklist). A Claude Code session — not an automated
  in-system AI API call — reads the document, asks clarifying questions
  for anything ambiguous or conflicting (the same process already proven
  on the NORSPAN-MB SOP, which caught a real numeric conflict between two
  source documents), and writes the structured items using the existing
  engine. This was chosen explicitly over full automation: an unreviewed
  AI parse of a structural-engineering document carries real risk of a
  silently dropped or misread requirement.
- **Product taxonomy becomes official:** exactly three products —
  `TRUSS`, `OPEN_WOOD_FLOOR`, `I_JOIST_FLOOR` — used consistently across
  job creation, designer-SOP templates, and QC-review-SOP templates,
  replacing today's inconsistent free-text `product_code` field (real
  historical values found during investigation include `'Roof Truss'`,
  `'ROOF_TRUSS'`, and even `'Alpine-iCommand'` — a software name entered
  by mistake). **Historical job records are not migrated** — this spec
  only enforces the clean list going forward.
- **Publish gate:** a human (the CEO) reviews and explicitly publishes —
  Claude never auto-publishes what it structures. This reuses the
  existing `DRAFT → ACTIVE` lifecycle already built into `SopAdminEngine`.
- **Manager review:** before publishing, the CEO can share **one link per
  draft** with however many managers they choose (not one link per
  manager) so managers can confirm the structured checklist is correct
  before it goes live. Managers view the checklist and the original
  source document, and submit a name + verdict (`LOOKS_CORRECT` /
  `HAS_ISSUES`) + optional comment. This is advisory input for the CEO's
  publish decision, not an approval gate that publishes by itself.
- **Notification:** an email fires when a document is uploaded, so
  whoever is responsible for running the Claude processing session knows
  a document is waiting — matching this system's existing notification
  patterns elsewhere (e.g. rework notifications).

## Data model

### New table — `DIM_SOP_UPLOADS`

Tracks every uploaded document through its lifecycle. Not a FACT table —
its status field is mutated in place (`updateWhere`), same pattern as
`DIM_SOP_TEMPLATES`.

| Column | Notes |
|---|---|
| `upload_id` | PK |
| `client_code` | must resolve to an existing `DIM_CLIENT_MASTER` row — SOP upload does not create new clients; client onboarding is a separate, existing flow (`portal_onboardClient`) that must happen first |
| `product_code` | one of `TRUSS` / `OPEN_WOOD_FLOOR` / `I_JOIST_FLOOR` |
| `doc_type` | `DESIGNER_SOP` \| `QC_REVIEW_SOP` |
| `drive_file_id`, `drive_file_url` | uploaded source document, stored in Drive |
| `uploaded_by`, `uploaded_at` | |
| `status` | `PENDING` → `DRAFT_READY` → `PUBLISHED`, or `REJECTED` |
| `resulting_template_id` | FK to `DIM_SOP_TEMPLATES.sop_template_id` (designer SOPs) or the future `DIM_QC_PROCESS_TEMPLATES.qc_process_template_id` (QC-review SOPs), set once Claude finishes structuring |
| `notes` | free text — Claude's summary of what it extracted, any assumptions made, any conflicts resolved and how |

### New table — `FACT_SOP_REVIEW_FEEDBACK`

Append-only. One row per manager comment (a shared link may collect
feedback from several different managers).

| Column | Notes |
|---|---|
| `feedback_id` | PK |
| `upload_id` | FK to `DIM_SOP_UPLOADS` |
| `reviewer_name` | free text — the manager types their own name, no portal login or roster match required |
| `verdict` | `LOOKS_CORRECT` \| `HAS_ISSUES` |
| `comment` | optional free text |
| `submitted_at` | |

### Product taxonomy

A fixed enum — `TRUSS`, `OPEN_WOOD_FLOOR`, `I_JOIST_FLOOR` — used as the
value of `product_code` on new job creation (replacing free text), as the
value of `DIM_SOP_TEMPLATES.scope_code` on upload-created designer-SOP
templates (see the correction above — no new column, this field already
serves as the product-matching key), and the future
`DIM_QC_PROCESS_TEMPLATES.product_code` (QC-review SOPs, which already
has a dedicated column for this). Where this enum is defined as a shared
constant and how job creation's validation changes is an
implementation-planning decision, not decided further here.

## End-to-end flow

1. **CEO uploads.** New portal screen, gated to the CEO role only (no
   other role gets this action in this spec — a natural future extension,
   not built here): pick client (existing clients only), pick product
   (fixed 3-value list), pick doc type (Designer SOP / QC-Review SOP),
   attach the file. This creates a `PENDING` row in `DIM_SOP_UPLOADS`,
   stores the file in Drive, and sends an email notification to the CEO's
   own address (same pattern as the existing `HM_ALERT_RECIPIENT` Script
   Property used for health-monitor alerts) — the CEO is both the
   uploader and the one who starts the Claude session, so no separate
   recipient list is needed.
2. **A Claude Code session processes it.** Someone (today: manually,
   by starting a session and pointing it at the pending upload) has
   Claude open the source document, read it, ask clarifying questions
   for anything ambiguous or conflicting, then write the structured
   items via the appropriate existing engine (`SopAdminEngine` for
   designer SOPs; the future QC-review engine for QC-review SOPs) as a
   `DRAFT` template. The upload row moves to `DRAFT_READY`,
   `resulting_template_id` is set, and `notes` records what was
   extracted/assumed/resolved.
3. **CEO shares the manager-review link.** Generated from the
   `DRAFT_READY` upload record, following the same signed-token pattern
   already used for the quarterly-ratings external link (`?page=...&token=...`,
   no portal login required). The CEO forwards this one link to whichever
   managers should weigh in.
4. **Managers review.** Each opens the link, sees the structured
   checklist read-only plus a link back to the original source document,
   and submits their name, a verdict, and an optional comment. Each
   submission appends a `FACT_SOP_REVIEW_FEEDBACK` row.
5. **CEO publishes.** From the upload's review screen in the portal
   (showing the draft content and all manager feedback collected so
   far), the CEO clicks publish, which calls the existing
   `publishTemplate`. The template becomes `ACTIVE`; the upload row
   moves to `PUBLISHED`.

## Out of scope for this spec

- **Building the QC-review-SOP backend engine** (`QcProcessAdminEngine`
  and friends, mirroring `SopAdminEngine`) — does not exist yet, is the
  next project immediately after this one. This spec's data model and
  upload flow already account for `doc_type = QC_REVIEW_SOP` so no rework
  is needed once that engine exists; until then, QC-review-SOP uploads
  can sit in `PENDING`/`DRAFT_READY` without a template to publish to.
- **Migrating historical job records** with inconsistent `product_code`
  values to the new taxonomy.
- **Changing job creation's `product_code` field validation** to enforce
  the new enum — flagged as a needed follow-up, not designed or built
  here.

## Testing

Standard T1 minimum applies to any new handler: happy path, RBAC denial
(who may upload — presumably CEO/admin only, to be confirmed in planning),
invalid input, duplicate submission. The manager-review endpoint needs its
own coverage: valid token, invalid/expired token, and the no-login/no-actor
path (mirrors how the quarterly-ratings external-rater flow already
handles unresolvable actors). Per `.claude/rules/testing-policy.md`, all
of this runs DEV-only against `TEST-CLIENT`/synthetic actors.
