# BLC Nexus — Quality Management System Framework

**Version:** 1.0 — 2026-06-25  
**Authority:** This is the QMS constitution. It governs the architecture, philosophy, and implementation path for all quality management work in BLC Nexus.  
**Supersedes:** Nothing — this is the first QMS-level document. It extends (does not replace) the SOP program docs.

---

## Section 1 — QMS Philosophy

BLC Nexus operates as a structural design BPO. Errors in structural design have real-world safety implications. The QMS exists to create an auditable record that the right quality controls were applied to every job — before submission, during review, and after delivery.

The QMS is not a form compliance system. It is a quality evidence system.

**Three core questions the QMS answers:**

1. Did the designer perform all required product-specific design steps? *(Designer SOP)*
2. Did the reviewer properly validate the completed design? *(QC Review Process)*
3. What specific defects were found, and how severe were they? *(QC Findings)*

Every checklist item, every review step, and every finding must answer: **"Can an auditor objectively verify this was completed?"** Items that cannot be verified are rejected.

**What the QMS is NOT:**
- Not a training system
- Not a documentation system
- Not a client management system
- Not a project management tool

It is a quality control evidence system, purpose-built for structural design review.

---

## Section 2 — Designer SOP Architecture (Layer 1)

> **Status:** Implemented and tested in DEV. Feature-flagged off in PROD.  
> **Source of truth:** `docs/SOP_ARCHITECTURE.md`

### Purpose
Answers: *"Did the designer perform all required product-specific design steps?"*

### Identity Key
```
client_code + product_code
```
On the job side: `product_code`. On the template side: `scope_code`. These are the same concept.

### Data Model
| Table | Role |
|---|---|
| `DIM_SOP_TEMPLATES` | Template registry — one ACTIVE per (client, product) |
| `DIM_SOP_ITEMS` | Checklist items per template |
| `FACT_SOP_AUDITS` | Append-only item responses |
| `FACT_SOP_CURRENT_STATUS` | Projection — completion state per job |

### Template Lifecycle
```
DRAFT → ACTIVE → RETIRED
```
Never edit an ACTIVE template in place. Version increment always.

### Gate Behavior
Controlled by Script Properties:
- `SOP_ENABLED` — must be `true` to activate
- `SOP_MODE` — `WARN_ONLY` (default) or `BLOCK`
- `SOP_PILOT_CLIENTS` — comma-separated client codes for phased rollout

### Current SOPs
Three SBS SOPs pending import (Phase 1–5 gated process, Form URL and Word doc not yet received):
- `SBS + TRUSS`
- `SBS + OPEN_WOOD_FLOOR`
- `SBS + I_JOIST_FLOOR`

---

## Section 3 — QC Review Process Architecture (Layer 2)

> **Status:** Design approved. Schema pending (PR QMS-3).  
> **Feature flag:** `QMS_QC_PROCESS_ENABLED` — default `false`

### Purpose
Answers: *"Did the reviewer properly validate the completed design?"*

This is NOT a duplicate of the Designer SOP. The Designer SOP tracks design execution. The QC Review Process tracks review execution. Different actors, different questions, different data.

### Identity Key
```
qc_process_code = GLOBAL_QC_PROCESS (default)
```
The QC Review Process is universal by default. It does not use `client_code + product_code` keying. Only create client/product-specific QC process templates when a client genuinely requires a unique review workflow (ADR required to justify — see ADR-QMS-003).

### Data Model
| Table | Role |
|---|---|
| `DIM_QC_PROCESS_ITEMS` | Review checklist items keyed by `qc_process_code` |
| `FACT_QC_REVIEW_CHECKLISTS` | Reviewer responses — one row per item per review |

### Row-Per-Item Model (ADR-QMS-006)
`FACT_QC_REVIEW_CHECKLISTS` stores one row per checklist item per review, matching the `FACT_SOP_AUDITS` pattern. This is required for per-item dashboard analytics (most-missed items, reviewer consistency, audit evidence). JSON blob storage is explicitly rejected.

### QC Review Outcomes
Every completed QC review produces exactly one outcome (recorded on `FACT_QC_REVIEW_SESSIONS` — ADR-QMS-007, ADR-QMS-009):
- `APPROVED` — design meets all requirements
- `MINOR_REWORK` — minor errors found, correctable without full redesign
- `MAJOR_REWORK` — design must be returned for significant revision

### Relationship to Existing QCHandler
`FACT_QC_REVIEW_CHECKLISTS` is additive. The existing `QCHandler.gs` outcome logic (`SUBMITTED_FOR_QC → QC_COMPLETE`) is not modified. `FACT_QC_REVIEW_CHECKLISTS` records *what the reviewer checked*, while `FACT_QC_EVENTS` records *the state transition*. These are linked by `job_number`.

### Example GLOBAL_QC_PROCESS Items
*(Design-time — not yet imported)*
- Designer SOP completion reviewed
- Client notes reviewed
- Loading criteria verified
- Bearing conditions reviewed
- Software warnings reviewed
- Special framing reviewed
- Revisions reviewed
- Output package reviewed
- QC comments documented
- Outcome recorded

---

## Section 4 — QC Findings Taxonomy (Layer 3)

> **Status:** Schema defined and seeded (PR QMS-2). `FACT_QC_FINDINGS` table pending (PR QMS-3b).  
> **Feature flag:** `QMS_FINDINGS_ENABLED` — default `false`

### Purpose
Provides a controlled vocabulary for defect classification. Findings are not free-text — they reference structured codes from `DIM_QC_FINDING_TYPES`. This enables dashboard analytics, trend detection, and reviewer consistency measurement.

Free-text comments are allowed alongside a finding code but not instead of one.

### Data Model
| Table | Role |
|---|---|
| `DIM_QC_FINDING_TYPES` | Controlled vocabulary of finding categories |
| `FACT_QC_FINDINGS` | Structured findings per job per reviewer |

### Finding Codes (Initial Taxonomy)
| Code | Description |
|---|---|
| `LOAD_ERROR` | Incorrect loading applied (snow, wind, dead, live) |
| `GEOMETRY_ERROR` | Incorrect geometry or dimensions |
| `BEARING_ERROR` | Bearing location or condition error |
| `CONNECTOR_ERROR` | Connector, hanger, or fastener error |
| `PLATE_ERROR` | Truss plate size, placement, or orientation error |
| `ENGINEERING_ERROR` | Structural engineering calculation or logic error |
| `INPUT_ERROR` | Incorrect input parameters in software |
| `DRAFTING_ERROR` | Drawing or output presentation error |
| `OUTPUT_ERROR` | Missing or incorrect output files |
| `DOCUMENTATION_ERROR` | Missing or incorrect documentation |
| `CLIENT_REQUIREMENT_MISSED` | Client-specific standard not followed |
| `REVISION_MISSED` | Requested revision not applied |
| `WRONG_DESIGN_STANDARD` | Wrong design standard or code used |
| `CALCULATION_ERROR` | Arithmetic or calculation error |
| `SOFTWARE_WARNING_IGNORED` | Software-generated warning not addressed |
| `SPECIAL_INSTRUCTION_MISSED` | Special instruction from client or PM not followed |
| `OTHER` | Does not fit any category — requires comment |

### Severity Levels
| Severity | Definition |
|---|---|
| `INFO` | Observation only — no rework required |
| `MINOR` | Small error — correctable within current submission |
| `MAJOR` | Significant error — likely requires rework |
| `CRITICAL` | Structural or safety concern — mandatory rework |

### DIM_QC_FINDING_TYPES Schema (20 columns — ADR-QMS-012)

> **Status:** Schema defined in PR QMS-2. Seeded with 17 initial codes.

| Column | Description |
|---|---|
| `finding_code` | Unique code (UPPER_SNAKE_CASE) — primary key |
| `finding_label` | Short label for UI display |
| `finding_group` | High-level safety grouping: `STRUCTURAL` / `PROCESS` / `DOCUMENTATION` |
| `category` | Functional domain: Design / Engineering / QC / Documentation / Client Requirement / Production |
| `severity_default` | Suggested default severity: INFO / MINOR / MAJOR / CRITICAL |
| `kpi_weight` | Numeric 0.5–10.0 — used for compliance scoring in future dashboard |
| `is_structural_risk` | TRUE/FALSE — TRUE for 8 codes that could affect structural integrity (ADR-QMS-015) |
| `product_applicability` | `ALL` or specific product codes (only `PLATE_ERROR` = `TRUSS` — ADR-QMS-014) |
| `requires_comment` | Y/N — Y enforced at submission time (only `OTHER` requires comment) |
| `common_in_rework` | TRUE/FALSE — identifies findings frequently seen in rework jobs |
| `active_flag` | TRUE/FALSE |
| `description` | Full reviewer guidance text |
| `display_order` | Unique integer — controls consistent UI ordering |
| `notes` | Internal notes about the finding code |
| `created_by` | Actor person_code |
| `created_at` | ISO timestamp |
| `last_updated_at` | ISO timestamp |
| `last_updated_by` | Actor person_code |
| `retired_at` | ISO timestamp if retired (empty string when active) |
| `benchmark_code` | Optional reference to industry standard or ISO 9001 clause |

**Structural risk codes (8):** LOAD_ERROR, GEOMETRY_ERROR, BEARING_ERROR, CONNECTOR_ERROR, PLATE_ERROR, ENGINEERING_ERROR, WRONG_DESIGN_STANDARD, CALCULATION_ERROR

**Product-restricted codes (1):** PLATE_ERROR — `product_applicability = TRUSS`

---

## Section 5 — Audit Model

All QMS data is append-only. No FACT table row is ever modified or deleted.

**Audit chain for a job:**
```
Job submitted for QC
  → SopGate evaluates Designer SOP (FACT_SOP_AUDITS)
  → QC reviewer completes QC checklist (FACT_QC_REVIEW_CHECKLISTS)
  → QC reviewer records findings (FACT_QC_FINDINGS)
  → QC outcome recorded (FACT_QC_EVENTS via QCHandler)
```

Every row in every FACT table records:
- `job_number` — which job
- `reviewer_email` / `created_by` — who acted
- `created_at` / `checked_at` — when
- `request_id` — idempotency key (prevents duplicate writes)

**Template versioning:** Every job references the `sop_template_id` or `qc_process_code` that was ACTIVE at the time of review. Template retirements do not affect historical records.

---

## Section 6 — Compliance Model

### Phase Gate Approach
QMS enforcement follows the same phased rollout as Designer SOP:

```
Phase 0: Feature flags off (current state in PROD)
Phase 1: DEV testing with real template data
Phase 2: WARN_ONLY — gate is active but does not block
Phase 3: BLOCK — gate blocks on critical incomplete items
```

Never jump from Phase 0 to Phase 3. The WARN_ONLY phase exists to validate template completeness before operational blocking.

### Feature Flag Hierarchy
```
QMS_ENABLED            — master switch (default false)
  QMS_QC_PROCESS_ENABLED — enables QC checklist collection
  QMS_FINDINGS_ENABLED   — enables findings recording
  QMS_DEV_ONLY           — enforces DEV-only mode
  SOP_ENABLED            — Layer 1 gate (existing)
    SOP_MODE             — WARN_ONLY / BLOCK
    SOP_PILOT_CLIENTS    — phased client rollout
```

If `QMS_ENABLED` is `false`, all QMS layers are silent regardless of sub-flags.

---

## Section 7 — Dashboard Readiness

> **Dashboard implementation is deferred. See ADR-QMS-005.**

The data model is designed now to support future reporting. Every table, every column, every code is chosen with dashboard analytics in mind.

### Future Designer Metrics
- SOP completion % by designer / team / client / product
- Blocking item completion %
- Most frequently missed items
- Compliance trend over time
- Rework correlation (jobs with incomplete SOPs → rework rate)

### Future QC Metrics
- QC review completion % by reviewer
- PASS / MINOR_ERROR / REWORK distribution
- Findings by code (most common defects)
- Reviewer consistency (same job type, same defect rate?)
- Review completeness (all checklist items answered?)

### Future Manager Metrics
- Team compliance %
- Client compliance %
- Product compliance %
- Missed item trends → training needs identification

### Future Client Metrics
- Client quality trend
- Product quality trend
- Rework trend
- Audit readiness score

### Future AI Metrics *(Phase 7)*
- Predictive rework risk (job characteristics → likely rework)
- Common failure pattern detection
- Designer coaching recommendations
- Reviewer blind spot identification
- Client-specific risk trends

**Prerequisites before dashboard build:**
- All 3 SBS Designer SOPs ACTIVE in DEV
- GLOBAL_QC_PROCESS template ACTIVE in DEV
- QC Findings taxonomy seeded in DEV
- WARN_ONLY pilot running with 2+ weeks of real data
- Raj approves dashboard scope before build begins

---

## Section 8 — AI Analytics Roadmap (Phase 7)

Not implemented. Not planned for near term. Documented as future direction only.

The QMS data model (row-per-item, structured finding codes, consistent timestamps, actor traceability) is intentionally designed to be ML-ready. When the time comes:

- `FACT_SOP_AUDITS` provides designer behaviour signals per item
- `FACT_QC_REVIEW_CHECKLISTS` provides reviewer behaviour signals
- `FACT_QC_FINDINGS` provides labelled defect data (supervised learning input)
- `FACT_QC_EVENTS` provides outcome labels (PASS/MINOR_ERROR/REWORK)

**Do not implement AI features until:**
- 6+ months of real QMS data exists
- Dashboard analytics are operational and validated
- CTO explicitly approves AI phase

---

## Section 9 — New Client Onboarding Impact

Every new client requires the full QMS onboarding sequence:

1. **Product inventory** — what products does this client submit?
2. **Product mapping** — map to Nexus product codes
3. **SOP gap analysis** — what controls are needed?
4. **Designer SOP design** — per product (Phase 1–5 gated)
5. **QC SOP review** — does GLOBAL_QC_PROCESS cover this client? If not, justify a client-specific variant in an ADR.
6. **DEV import** — templates imported and tested in DEV
7. **DEV validation** — test runs confirm correct behavior
8. **WARN_ONLY pilot** — run for minimum 2 weeks
9. **BLOCK approval** — explicit CTO sign-off before blocking mode

**Never copy another client's SOP blindly.** Different clients have different specifications, standards, common failure modes, and review cultures. A copy-paste SOP that doesn't reflect real client requirements is worse than no SOP — it creates false compliance confidence.

---

## Section 10 — Change Management Impact

### Designer SOP Changes
When a client requests an SOP change after a template is ACTIVE:

1. Compare old vs new — classify each change as add / remove / severity change
2. Assess impact — which in-flight jobs are affected?
3. Produce migration plan
4. Create new DRAFT template version
5. Publish new version → old version RETIRED
6. Document change in ADR (if material) or commit message (if minor)

### QC Process Changes
The same versioning principle applies to `DIM_QC_PROCESS_ITEMS`. Changes to the GLOBAL_QC_PROCESS template require the same version increment workflow.

### Finding Taxonomy Changes
- Adding a new finding code: low risk — append to `DIM_QC_FINDING_TYPES`
- Retiring a finding code: set `active_flag = FALSE`, set `retired_at` — do not delete (historical findings reference it)
- Renaming a finding code: forbidden — retire old, create new (historical integrity)

---

## Section 11 — Naming Conventions

### Table Naming
| Prefix | Layer | Example |
|---|---|---|
| `DIM_SOP_` | Layer 1 Designer SOP dimensions | `DIM_SOP_TEMPLATES` |
| `FACT_SOP_` | Layer 1 Designer SOP facts | `FACT_SOP_AUDITS` |
| `DIM_QC_` | Layer 2/3 QC dimensions | `DIM_QC_PROCESS_ITEMS` |
| `FACT_QC_` | Layer 2/3 QC facts | `FACT_QC_FINDINGS` |
| `VW_QMS_` | Future QMS view projections | `VW_QMS_COMPLIANCE_SUMMARY` |

### File Naming
| Pattern | Purpose |
|---|---|
| `Sop*.gs` | Layer 1 Designer SOP code |
| `Qc*.gs` | Layer 2/3 QC Review / Findings code |
| `Qms*.gs` | Cross-layer QMS orchestration |

### Code Naming
| Type | Convention | Example |
|---|---|---|
| Finding codes | `UPPER_SNAKE_CASE` | `LOAD_ERROR` |
| Process codes | `UPPER_SNAKE_CASE` | `GLOBAL_QC_PROCESS` |
| Template versions | Integer | `1`, `2`, `3` |
| Item codes | `PREFIX-SEQ` | `SBS-T-001`, `GQC-001` |

### ID Naming
| Entity | Format |
|---|---|
| QC review | `QCREV-{timestamp}-{random}` |
| QC finding | `QCFND-{timestamp}-{random}` |
| QC process item | `QCITEM-{seq}` |

---

## Section 12 — DEV/PROD Safety Rules

| Rule | Detail |
|---|---|
| DEV Script ID | `1smkj0mmUqcWDDJPq-RUuVxRG4nE3TMKy4KrOIVUcdEN9lrFucL57aqAE` |
| PROD Script ID | `1HzRiDrQJ6z-BxPzk-MHgm4pUb5enabsEA9Hg16OoRzpOhGjv9FyeiQQ0` |
| Deploy to DEV | `npm run push:dev` only — after git commit |
| Deploy to PROD | Forbidden until full QMS pilot complete and CTO approves |
| PROD flags | `QMS_ENABLED`, `QMS_QC_PROCESS_ENABLED`, `QMS_FINDINGS_ENABLED` must NOT be set in PROD |
| `.clasp.json` | Never manually edited — managed by npm deploy scripts |

**PROD enablement sequence (future, not current):**
1. All QMS PRs merged, all tests passing
2. SBS Designer SOPs ACTIVE in PROD
3. GLOBAL_QC_PROCESS template ACTIVE in PROD
4. Findings taxonomy seeded in PROD
5. `QMS_ENABLED=true` set by CTO with explicit written approval
6. Monitor for 2 weeks in WARN_ONLY
7. CTO approves BLOCK mode separately

---

## Section 13 — Relationship to SOP Docs

| Document | Role |
|---|---|
| `docs/QUALITY_FRAMEWORK.md` (this file) | QMS constitution — architecture, philosophy, all layers |
| `docs/CLAUDE_SOP_MEMORY.md` | Session bootstrap — read first every session |
| `docs/SOP_GUARDRAILS.md` | Safety card — stop conditions and absolute rules |
| `docs/SOP_MASTER_PROMPT.md` | Working charter — paste into every Claude session |
| `docs/SOP_ARCHITECTURE.md` | Technical data model — tables, flags, source files |
| `docs/SOP_DECISIONS.md` | ADR log — all architectural decisions |
| `docs/SOP_PRODUCT_INVENTORY.md` | Per-client, per-product SOP status |
| `docs/SOP_ROADMAP.md` | Phase plan and PR roadmap |

**Reading order for a new session:**
1. `CLAUDE_SOP_MEMORY.md` (status + context)
2. `SOP_GUARDRAILS.md` (safety)
3. `SOP_MASTER_PROMPT.md` (working charter)
4. `QUALITY_FRAMEWORK.md` (this file, for QMS-level work)
5. `SOP_DECISIONS.md` (if making an architectural decision)
