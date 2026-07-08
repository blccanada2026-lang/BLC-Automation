# BLC Nexus — SOP Architectural Decisions

## Decision Log

---

### ADR-SOP-001: SOP identity = client_code + product_code (not job_type or software)

**Status:** Accepted  
**Context:** Original design considered keying SOPs on `job_type` or `software`. Both are too granular — a designer with the same product (TRUSS) across multiple software tools should follow the same SOP.  
**Decision:** SOP identity = `client_code + product_code`. The `scope_code` field on `DIM_SOP_TEMPLATES` maps to `product_code` on the job side.  
**Consequences:** One SOP per client per product. Simpler resolution logic. Easier to audit.

---

### ADR-SOP-002: Feature flag — WARN_ONLY before BLOCK

**Status:** Accepted  
**Context:** Immediately blocking QC submissions on an unproven checklist would disrupt operations. Designers need time to adapt.  
**Decision:** Gate launches in `WARN_ONLY` mode. `SOP_MODE` Script Property controls behavior. `SOP_ENABLED` must be explicitly set to `true`.  
**Consequences:** No operational disruption during pilot. Switch to `BLOCK` only after WARN_ONLY pilot validates coverage.

---

### ADR-SOP-003: Pilot client gate

**Status:** Accepted  
**Context:** Rolling out SOP enforcement across all clients simultaneously is risky.  
**Decision:** `SOP_PILOT_CLIENTS` Script Property limits enforcement to named clients. Empty = all clients (only safe after full rollout).  
**Consequences:** Phased rollout. SBS pilot first, then expand.

---

### ADR-SOP-004: One mixed Google Form → three product-specific SOPs

**Status:** Accepted  
**Context:** SBS has one mixed Google Form covering TRUSS and OPEN_WOOD_FLOOR. I-Joist has a separate Word doc.  
**Decision:** Never import a 1:1 copy of the Google Form. Separate all items by product. I-Joist SOP comes from the Word doc only — not inferred from the form.  
**Consequences:** Three separate SOP templates created: SBS+TRUSS, SBS+OPEN_WOOD_FLOOR, SBS+I_JOIST_FLOOR.

---

### ADR-SOP-005: 5-phase gated import process

**Status:** Accepted  
**Context:** Bad SOP items reaching PROD are hard to correct (audit trail, in-flight jobs). Classification must be done carefully.  
**Decision:** No import until each phase is explicitly approved:
- Phase 1: Discovery — classify every question by product
- Phase 2: SOP Design — propose structures with codes and sequencing
- Phase 3: Nexus Mapping — generate exact column values
- Phase 4: Migration Validation — verify codes, no duplicates
- Phase 5: Import Execution — dry run, review, final import  
**Consequences:** Slower import. Zero bad data risk.

---

### ADR-SOP-006: MIGRATION_SOP_IMPORT staging sheet as one-time artifact

**Status:** Accepted  
**Context:** SOP items need to be imported from Google Forms/Word docs. Google Forms are banned for live input (Rule R1). A staging sheet is an acceptable one-time migration artifact.  
**Decision:** Use `MIGRATION_SOP_IMPORT` sheet as the staging surface for import only. `SopImporter.gs` reads this sheet and creates templates + items. This is not an ongoing input path.  
**Consequences:** Import is auditable, reversible, and separated from production data flow.

---

### ADR-SOP-007: SOP Compliance Dashboard deferred to Phase 2

**Status:** Accepted  
**Context:** Dashboard metrics are meaningless before real SOP data exists in FACT_SOP_AUDITS / FACT_SOP_CURRENT_STATUS.  
**Decision:** Dashboard is not built until after SBS SOP import and WARN_ONLY pilot are complete.  
**Consequences:** No dashboard work in Phase 1. See SOP_ROADMAP.md for dashboard specification.

---

### ADR-SOP-008: SOP items are operational checklists, not training content

**Status:** Accepted  
**Context:** Source documents (Google Forms, Word docs) often contain training guidance, documentation reminders, and non-verifiable actions.  
**Decision:** Every SOP item must answer: "Can an auditor verify this step was actually completed?" If no → remove.  
**Target size:** 15–30 items. Hard max: 40 items.  
**Consequences:** All source documents reviewed against this filter before import. Recommended removals documented in Section C of each import analysis.

---

### ADR-SOP-009: SOP changes use version increment, never in-place edit

**Status:** Accepted  
**Context:** A client may request SOP changes after a template is ACTIVE. Editing the active template in place destroys the audit trail — in-flight jobs would silently reference different items than when they were created.  
**Decision:** When a client changes an SOP, do NOT modify the ACTIVE template directly. Instead: compare old vs new, identify additions/removals/severity changes, produce an impact assessment, recommend a version increment, produce a migration plan. The new version goes through DRAFT → ACTIVE lifecycle; the old version is retired.  
**Consequences:** Full audit history preserved. Every job references the exact template version that was active when it was submitted.

---

### ADR-SOP-010: New client onboarding requires independent SOP design (never copy-paste)

**Status:** Accepted  
**Context:** As BLC Nexus expands to additional clients (MATIX, NORSPAN, others), there is a risk of copying one client's SOP to another as a shortcut.  
**Decision:** Each new client requires: (1) product inventory, (2) SOP gap analysis, (3) client-specific controls identified, (4) proposed SOP designed from scratch, (5) import mapping, (6) pilot recommendation. Never copy an existing client's SOP blindly — different clients have different standards, specifications, and failure modes.  
**Consequences:** More upfront work per client. Better quality and auditability. No cross-contamination of client-specific requirements.

---

### ADR-SOP-011: Item category naming — adopt functional domain categories

**Status:** Accepted  
**Context:** Earlier design (sop_design_principles memory, pre-2026-06-25) used nature-of-requirement categories: CRITICAL_QUALITY / CLIENT_REQUIREMENT / PROCESS_COMPLIANCE / ENGINEERING_BEST_PRACTICE. The Master Prompt (2026-06-25) introduced functional domain categories: Design / QC / Engineering / Client Requirement / Production / Documentation.  
**Decision:** Adopt the Master Prompt functional domain categories. They are more actionable for dashboards (filter by domain), easier for designers to classify, and directly map to reporting dimensions. The old category names are retired.  
**Consequences:** Any future SOP items must use the new category set. The sop_design_principles memory file reflects the updated categories.

---

### ADR-SOP-012: Two distinct SOP families — Designer SOP and QC Review SOP

**Status:** Accepted  
**Context:** Original SOP design treated all checklist items as a single family. In practice, a designer completing a checklist before QC submission is a fundamentally different act from a QC reviewer verifying the quality of the completed design. Mixing them in one template creates confusion about ownership and makes reporting on each role's compliance meaningless.  
**Decision:** Two separate SOP families exist: (1) **Designer SOP** — keyed by `client_code + product_code`, answers "Did the designer perform the required work?"; (2) **QC Review SOP** — process-based, answers "Did QC properly validate the work?". These are never merged into one template. QC outcomes are PASS / MINOR_ERROR / REWORK.  
**Consequences:** Each product needs both a Designer SOP and a QC Review SOP before full enforcement is possible. Dashboard metrics for each role are independently reportable.

---

### ADR-SOP-013: GLOBAL_QC_REVIEW_SOP as the default — client/product-specific only when required

**Status:** Accepted  
**Context:** QC review processes are largely consistent across clients and products (review the designer's SOP, check client notes, verify load criteria, document findings). Creating separate QC SOPs per client/product would generate maintenance overhead without adding quality value for most clients.  
**Decision:** A single `GLOBAL_QC_REVIEW_SOP` is the default QC process template. Client/product-specific QC SOPs are only created when a client genuinely requires unique QC workflows not covered by the global template. This decision must be explicitly justified and documented in an ADR at the time of deviation.  
**Consequences:** Lower template maintenance burden. Consistent QC process across clients. Dashboard comparisons across clients are valid (apples-to-apples). Exceptions are tracked and justified.

---

## QMS Decision Log

These ADRs document the evolution from SOP module to Quality Management System.

---

### ADR-QMS-001: SOP module evolved into Quality Management System (QMS)

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** The original T13 module was scoped as an SOP checklist gate for designers. As the program matured, it became clear that quality management requires three distinct layers: designer execution verification (Designer SOP), reviewer process verification (QC Review Process), and structured defect recording (QC Findings). Calling this program "SOP" undersells its scope and creates confusion when onboarding new clients who ask about QC review tracking.  
**Decision:** The initiative is now the BLC Nexus Quality Management System (QMS). The existing Designer SOP module is Layer 1 of the QMS. New layers are added in QMS PRs. All existing ADR-SOP-* decisions remain valid — they document Layer 1. ADR-QMS-* decisions document the broader QMS architecture.  
**Consequences:** Documentation updated to reflect QMS framing. `docs/QUALITY_FRAMEWORK.md` created as the QMS constitution. No code changes — this is a conceptual rebranding that clarifies scope without altering existing implementation.

---

### ADR-QMS-002: Designer SOP and QC Review Process are separate implementation layers with separate table families

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** ADR-SOP-012 established that Designer SOP and QC Review SOP are separate families conceptually. This ADR resolves the implementation question: should they share the same DIM_SOP_TEMPLATES schema or use dedicated tables?  
**Decision:** Separate table families. Layer 1 (Designer SOP) uses `DIM_SOP_*` and `FACT_SOP_*` prefixed tables. Layer 2 (QC Review Process) uses `DIM_QC_*` and `FACT_QC_*` prefixed tables. This separation is enforced in naming, DAL access, and file organization (`Sop*.gs` vs `Qc*.gs`). The two layers are never mixed in a single table or handler.  
**Consequences:** Clear ownership per layer. Dashboard queries can independently aggregate SOP compliance and QC review compliance. DAL access patterns are distinct and testable in isolation.

---

### ADR-QMS-003: QC Review Process uses qc_process_code key, not client_code + product_code

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** The Designer SOP uses `client_code + product_code` as its identity key (ADR-SOP-001). The QC Review Process is universal — a reviewer checking a truss job and an I-joist job follows the same review workflow. Using `client_code + product_code` for QC review would force creation of dozens of near-identical QC templates as the client base grows.  
**Decision:** QC Review Process items are keyed by `qc_process_code`, a string field in `DIM_QC_PROCESS_ITEMS`. The default value is `GLOBAL_QC_PROCESS`. Client/product-specific variants may use codes such as `SBS_QC_PROCESS` if a client genuinely requires unique review steps — but each deviation requires its own ADR justification. The `DIM_SOP_TEMPLATES` schema is not used for QC process items.  
**Consequences:** One GLOBAL_QC_PROCESS template covers all clients by default. Dashboard reviewer metrics are comparable across clients (same items). Maintenance burden is minimal.

---

### ADR-QMS-004: QC Findings taxonomy is required infrastructure before dashboard can be built

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** Dashboard metrics for defect analysis require a controlled vocabulary. If findings are recorded as free text, they cannot be aggregated, trended, or used for coaching. A taxonomy must be defined and seeded in `DIM_QC_FINDING_TYPES` before any findings data is collected, otherwise the data is analytically worthless.  
**Decision:** `DIM_QC_FINDING_TYPES` is created and seeded with the initial 17-code taxonomy (LOAD_ERROR through OTHER) in PR QMS-2, before any QC Review Process code is written (PR QMS-3). Free-text comments are permitted alongside a finding code but not as a substitute for one.  
**Consequences:** All findings are analytically queryable from day one. Dashboard build can begin as soon as enough real data exists. Free-text overrides are not allowed in the findings submission path.

---

### ADR-QMS-005: Dashboard implementation deferred until real QMS data exists

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** Building a dashboard before real QMS data exists produces misleading metrics and wastes build effort on views that will change once real usage patterns emerge.  
**Decision:** No dashboard implementation until all three conditions are met: (1) at least one Designer SOP ACTIVE in DEV with real checklist responses in FACT_SOP_AUDITS; (2) GLOBAL_QC_PROCESS template ACTIVE in DEV with real reviewer responses in FACT_QC_REVIEW_CHECKLISTS; (3) at least 2 weeks of WARN_ONLY pilot data. Raj must approve dashboard scope before build begins.  
**Consequences:** Dashboard build is delayed relative to QMS schema work. This is intentional — the schema investment happens first and is independent of the dashboard.

---

### ADR-QMS-006: FACT_QC_REVIEW_CHECKLISTS uses row-per-item model (not JSON blob)

**Status:** Accepted  
**Date:** 2026-06-25  
**Decision owner:** Raj Nair (CTO)  
**Context:** Two storage models were considered for QC review checklist responses: (A) one row per checklist item per review; (B) one JSON blob per review containing all item responses. Both are technically valid. The choice affects dashboard analytics, auditability, and storage volume.  
**Decision:** Row-per-item (Model A). Reasons: (1) matches the existing `FACT_SOP_AUDITS` pattern — consistency across layers; (2) enables per-item aggregation without JSON parsing (most-missed items, reviewer blind spots); (3) each row is independently auditable — an auditor can verify a specific item without parsing a blob; (4) simpler DAL write path — `BatchOperations.appendRows()` handles N items in one call. Storage volume (estimated 10,000 rows/month at 500 jobs × 20 items) is acceptable in Google Sheets with monthly partitioning (Rule D6).  
**Consequences:** `FACT_QC_REVIEW_CHECKLISTS` has one row per item per review. Partitioned monthly. Dashboard queries aggregate by item for trend analysis. No JSON columns in the QMS FACT tables.

---

## PR QMS-2 Architecture Decisions

These ADRs were approved by the CTO before implementation of PR QMS-2 (QC Finding Taxonomy). They correct structural gaps identified in the pre-implementation architecture review.

---

### ADR-QMS-007: QC Review outcomes align to existing QCHandler vocabulary

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** Early QMS documentation described QC Review outcomes as `PASS / MINOR_ERROR / REWORK`. The existing `QCHandler.gs` already uses `APPROVED / MINOR_REWORK / MAJOR_REWORK / CLIENT_SENT` as its outcome vocabulary. Introducing a parallel outcome vocabulary would create a terminology clash, confuse reviewers using the portal, and make cross-layer dashboard comparisons incorrect.  
**Decision:** QC Review outcomes are `APPROVED / MINOR_REWORK / MAJOR_REWORK`. `CLIENT_SENT` is an existing QCHandler state (job returned to client) and is out of scope for the QMS Review Process outcome. All documentation updated to use the correct vocabulary.  
**Consequences:** No new outcome vocabulary introduced. QMS outcome terminology is consistent with QCHandler. All affected docs updated in PR QMS-2.

---

### ADR-QMS-008: FACT_QC_REVIEW_SESSIONS as parent session record

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** Original PR QMS-3 plan had only `FACT_QC_REVIEW_CHECKLISTS` (item-level rows). There was no parent record to anchor the outcome and reviewer identity for a complete review session. Without a session record, reporting "who reviewed this job and what was the outcome" requires reconstructing session context from item rows — fragile and ambiguous when a reviewer submits multiple review passes on the same job.  
**Decision:** `FACT_QC_REVIEW_SESSIONS` is added as a parent session record. It holds: `qc_session_id`, `job_number`, `reviewer_person_code`, `qc_process_code`, `outcome`, `session_started_at`, `session_completed_at`, `request_id`. `FACT_QC_REVIEW_CHECKLISTS` rows FK to `qc_session_id`.  
**Consequences:** Clean parent-child relationship. Session outcome is unambiguous. Dashboard session-level aggregation is straightforward.

---

### ADR-QMS-009: QC Review outcome recorded on FACT_QC_REVIEW_SESSIONS, not FACT_QC_FINDINGS

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** One outcome per review, but potentially many findings per review. If outcome is stored on `FACT_QC_FINDINGS`, a review with 3 findings produces 3 outcome rows — creating apparent duplicates or requiring de-duplication for any dashboard metric. Outcome is a property of the review session, not of an individual finding.  
**Decision:** QC Review outcome (`APPROVED / MINOR_REWORK / MAJOR_REWORK`) is stored on `FACT_QC_REVIEW_SESSIONS.outcome`. `FACT_QC_FINDINGS` stores defect classifications only (finding_code, severity, comment). `FACT_QC_FINDINGS` and `FACT_QC_REVIEW_CHECKLISTS` FK to the same `qc_session_id`.  
**Consequences:** One outcome per session row — no de-duplication needed. Finding-level and session-level metrics are independently queryable.

---

### ADR-QMS-010: DIM_QC_PROCESS_TEMPLATES as versioning parent for process items

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** Original design had only `DIM_QC_PROCESS_ITEMS` keyed by `qc_process_code`. If the GLOBAL_QC_PROCESS template needs to be updated (new control added, item retired), there was no mechanism to version the process — the global key would be updated in-place, destroying the audit trail for reviews conducted under prior versions.  
**Decision:** `DIM_QC_PROCESS_TEMPLATES` is added as a parent table. It holds: `qc_process_template_id`, `qc_process_code`, `version`, `status` (DRAFT/ACTIVE/RETIRED), `effective_from`, `effective_to`, lifecycle metadata. `DIM_QC_PROCESS_ITEMS` holds a FK to `qc_process_template_id`. Pattern mirrors `DIM_SOP_TEMPLATES → DIM_SOP_ITEMS`.  
**Consequences:** QC process templates are versioned. Reviews reference the exact process template version active at review time. Version management follows the same pattern as Designer SOP templates.

---

### ADR-QMS-011: QMS reviewer identity uses person_code, not email

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** `FACT_SOP_AUDITS` stores `designer_email` (not `person_code`) due to an early implementation choice in Layer 1. All other FACT tables (FACT_QC_EVENTS, FACT_BILLING_LEDGER, FACT_PAYROLL_LEDGER) use `person_code` as the canonical actor identifier. For QMS Layers 2 and 3, using email would perpetuate the inconsistency and make cross-layer reporting harder.  
**Decision:** `FACT_QC_REVIEW_SESSIONS`, `FACT_QC_REVIEW_CHECKLISTS`, and `FACT_QC_FINDINGS` all use `reviewer_person_code`. The email-as-identity gap in `FACT_SOP_AUDITS` is documented as a known Layer 1 technical debt to be addressed when SBS SOP pilot data is available. A reporting bridge (email → person_code lookup via `DIM_STAFF_ROSTER`) is used for cross-layer dashboard joins until the gap is resolved.  
**Consequences:** Layers 2 and 3 are internally consistent with the rest of the FACT table family. Layer 1 email gap is isolated and documented. Dashboard joins are implementable via a bridge lookup.

---

### ADR-QMS-012: DIM_QC_FINDING_TYPES expanded to 20 columns for dashboard analytics

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** Original architecture doc defined 10 columns for `DIM_QC_FINDING_TYPES`. For the QMS dashboard to support compliance scoring, safety reporting, and UI filtering, additional structured columns are required at seed time — not as later schema alterations. Adding columns post-seed is disruptive in Google Sheets (requires header fix + data backfill).  
**Decision:** `DIM_QC_FINDING_TYPES` is defined with 20 columns at seed time: `finding_code`, `finding_label`, `finding_group`, `category`, `severity_default`, `kpi_weight`, `is_structural_risk`, `product_applicability`, `requires_comment`, `common_in_rework`, `active_flag`, `description`, `display_order`, `notes`, `created_by`, `created_at`, `last_updated_at`, `last_updated_by`, `retired_at`, `benchmark_code`. All 17 seed records populate all 20 columns.  
**Consequences:** Full 20-column schema is defined once. No schema migration needed for dashboard build. kpi_weight, is_structural_risk, and display_order support compliance scoring and safety reporting.

---

### ADR-QMS-013: PR QMS-3 delivered in two sub-PRs (schema first, then engine)

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** PR QMS-3 (QC Review Process schema + engine) is the largest PR in the QMS sequence. Delivering it as one PR risks merging schema and behavioral code together without a clear schema review checkpoint.  
**Decision:** PR QMS-3 is split: (a) QMS-3a delivers the schema only — `DIM_QC_PROCESS_TEMPLATES`, `DIM_QC_PROCESS_ITEMS`, `FACT_QC_REVIEW_SESSIONS`, `FACT_QC_REVIEW_CHECKLISTS`, `FACT_QC_FINDINGS` in SetupScript + Config; (b) QMS-3b delivers the engine — `QcReviewEngine.gs`, `QcReviewDAL.gs`, handlers, GLOBAL_QC_PROCESS seed data. QMS-3a must be approved before QMS-3b begins.  
**Consequences:** Schema reviewed independently from business logic. Reduces risk of schema+engine entanglement. Approval gates preserved.

---

### ADR-QMS-014: PLATE_ERROR has product_applicability=TRUSS (only product-specific finding code)

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** Metal connector plate design is specific to truss products. No other finding code in the initial taxonomy is product-restricted — all others apply across all structural products. PLATE_ERROR is not relevant to wood frame floor or I-joist designs.  
**Decision:** `PLATE_ERROR.product_applicability = 'TRUSS'`. All 16 other initial codes have `product_applicability = 'ALL'`. The `product_applicability` field is checked by `QcReviewEngine` (PR QMS-3) to filter the available finding codes when a reviewer is documenting findings on a non-truss product.  
**Consequences:** Reviewers on floor/joist jobs are not offered PLATE_ERROR as a finding option. Dashboard filtering by product is accurate from day one. Future product-specific findings follow the same pattern.

---

### ADR-QMS-015: is_structural_risk flag required on all finding codes for safety reporting

**Status:** Accepted  
**Date:** 2026-06-25  
**Context:** A QMS dashboard for a structural design firm must be able to report on safety-critical findings separately from process/documentation findings. Without a structural risk flag, every dashboard query that attempts to isolate structural defects must hard-code a list of finding codes — fragile and unmaintainable as the taxonomy grows.  
**Decision:** Every `DIM_QC_FINDING_TYPES` record has `is_structural_risk` = 'TRUE' or 'FALSE'. Initial taxonomy: 8 codes are structural risk (`LOAD_ERROR`, `GEOMETRY_ERROR`, `BEARING_ERROR`, `CONNECTOR_ERROR`, `PLATE_ERROR`, `ENGINEERING_ERROR`, `WRONG_DESIGN_STANDARD`, `CALCULATION_ERROR`). 9 codes are non-structural. Any new finding code added to the taxonomy must explicitly set this flag — the field is non-nullable.  
**Consequences:** Safety dashboard metric (structural-risk finding rate) is computable from day one. Classification is transparent and auditable. New finding codes cannot be added without an explicit structural risk decision.

---

## QMS-3A Architecture Decisions

---

### ADR-QMS-016: FACT_QC_REVIEW_SESSIONS uses an event_type discriminator to remain append-only

**Status:** Accepted  
**Date:** 2026-06-26  
**Context:** A QC review session has a lifecycle: it opens when a reviewer begins work, and closes when the reviewer submits an outcome. The outcome, completion timestamp, and notes only exist at close time. A naive single-row design would require updating the session row after it is created — violating Rule A5 (FACT tables are append-only). Two alternative designs were considered: (A) a single mutable session row with `updateWhere` at close time; (B) two append-only rows per session with an `event_type` discriminator. Option A is simpler to query but violates A5 and sets a precedent for FACT table mutability in the QMS layer. Option B preserves full audit integrity: both the open and close events are independently timestamped, immutable, and queryable.  
**Decision:** `FACT_QC_REVIEW_SESSIONS` uses an `event_type` discriminator column with three valid values: `QC_REVIEW_STARTED`, `QC_REVIEW_COMPLETED`, `QC_REVIEW_VOIDED`. Each review session produces exactly two rows sharing a `qc_session_id`: one STARTED row (appended when the review opens) and one COMPLETED or VOIDED row (appended when the review closes). No row is ever updated. The STARTED row carries `qc_template_ids_resolved` and `session_started_at`; the COMPLETED row carries `outcome`, `notes`, and `session_completed_at`. Dashboard queries join the two rows on `qc_session_id` to produce a complete session view. `QcReviewDAL.getOpenSessionForJob()` identifies sessions with a STARTED row but no COMPLETED or VOIDED row.  
**Additional decision — ID prefix conflict:** The approved prefix `QI` for QC process items conflicts with the existing `QUEUE_ITEM: 'QI'` entry in `Config.ID_PREFIXES`. Resolution: QC process items use prefix `QPI` (QC Process Item). All other approved prefixes (QT, QS, QR, QF) are unaffected. `Config.ID_PREFIXES` and `QcConstants.ID_PREFIXES` both document this with inline comments.  
**Consequences:** FACT_QC_REVIEW_SESSIONS is fully append-only — no `updateWhere` calls are ever needed. The event_type pattern is consistent with the existing `FACT_QC_FINDINGS` amendment pattern (FINDING_RECORDED / FINDING_CORRECTED). Dashboard queries are slightly more complex (require JOIN on session_id to reconstruct full session) but this is handled cleanly at the reporting layer. Test helpers must account for the two-row pattern.  
**Partially superseded by ADR-QMS-017:** `qc_template_ids_resolved` (comma-delimited) replaced by `global_template_id`, `product_template_id`, `client_template_id` (three nullable FK columns). Period_id, qc_event_id also added. All other decisions in this ADR remain in force.

---

## QMS-3C-Prep Architecture Decisions

---

### ADR-QMS-017: QMS-3C-Prep schema corrections to FACT_QC_REVIEW_SESSIONS, FACT_QC_REVIEW_CHECKLISTS, FACT_QC_FINDINGS, and FACT_QC_EVENTS

**Status:** Accepted  
**Date:** 2026-06-26  
**Context:** Before QMS-3C engine implementation begins, four schema gaps were identified that would require DAL-breaking changes after data was written. These gaps were caught during architecture review (pre-implementation). The corrections are schema-only — no engine, no handler, no portal changes. No QMS data has been written in DEV yet, so no migration is required.

**Gap 1 — period_id missing from FACT_QC_REVIEW_SESSIONS, FACT_QC_REVIEW_CHECKLISTS, FACT_QC_FINDINGS:** All other FACT tables in Nexus include `period_id` as the monthly partition key. The three QMS FACT tables were designed without it, making monthly partitioning (Rule D6) impossible without a schema break after data is written.

**Gap 2 — qc_template_ids_resolved is a comma-delimited string:** The original design stored resolved template IDs as a comma-delimited string (e.g. `"QT-001,QT-002"`). This requires string parsing in every Looker query, is not Sheets-native, and cannot be used in JOIN-equivalent operations.

**Gap 3 — no bidirectional FK between FACT_QC_EVENTS and FACT_QC_REVIEW_SESSIONS:** QcReviewHandler (QMS-3C) will write to both tables when a reviewer submits an outcome. Without cross-table FKs, audit reconstruction requires joining on `job_number` alone, which is non-unique (multiple QC sessions per job are valid).

**Gap 4 — no qc_session_id on FACT_QC_EVENTS:** Pre-QMS rows will have no session context, which is correct. Post-QMS rows written by QcReviewHandler should carry the session ID that drove the outcome.

**Decision:**
- `FACT_QC_EVENTS`: add `qc_session_id` (nullable). Null on all pre-QMS rows and on rows written by the QCHandler fallback path. Set by QcReviewHandler (QMS-3C+) when a session drives the outcome.
- `FACT_QC_REVIEW_SESSIONS`: (a) add `period_id` (required, position 3 after event_type); (b) replace `qc_template_ids_resolved` with three nullable FK columns — `global_template_id` (always set on STARTED rows), `product_template_id` (null if no product supplement active), `client_template_id` (null if no client override active); (c) add `qc_event_id` (nullable, FK to FACT_QC_EVENTS.event_id, set on COMPLETED rows by QcReviewHandler, null on STARTED rows).
- `FACT_QC_REVIEW_CHECKLISTS`: add `period_id` (nullable, position 3 after qc_session_id).
- `FACT_QC_FINDINGS`: add `period_id` (nullable, position 4 after amendment_of).
- Template resolution sequencing: global items seq 1–99, product supplement items seq 100–199, client override items seq 200+. This sequencing is enforced by QcReviewEngine (QMS-3C).
- QcReviewHandler (future T6 handler, QMS-3C) will replace QCHandler Flow B as the reviewer submission path. QCHandler Flow B (QC_APPROVE permission) is maintained as a 30-day fallback after QcReviewHandler is launched, then deprecated. QcReviewHandler owns both the FACT_QC_REVIEW_SESSIONS close row and the FACT_QC_EVENTS outcome write, ensuring the bidirectional FK is always set atomically.

**Consequences:** All four FACT tables now include `period_id` consistent with system-wide partitioning standards. Three-column template tracking eliminates string parsing in queries. The bidirectional FK enables unambiguous audit reconstruction. The `qc_event_id` reference on FACT_QC_REVIEW_SESSIONS.COMPLETED rows closes the dual-write loop. Column counts: FACT_QC_EVENTS 13, FACT_QC_REVIEW_SESSIONS 18, FACT_QC_REVIEW_CHECKLISTS 14, FACT_QC_FINDINGS 16. All existing tests pass unchanged (no data written yet). `runFixHeaders()` (not `runSetupSchemas()`) must be used to apply corrected headers to existing partition tabs.

---

### ADR-QMS-018: HealthMonitor design note — QC sessions open longer than 24 hours

**Status:** Accepted (design note — no implementation)  
**Date:** 2026-06-26  
**Context:** A QC review session that is opened (STARTED row written) but never completed leaves a dangling STARTED row in FACT_QC_REVIEW_SESSIONS with no corresponding COMPLETED or VOIDED row. This is a normal in-progress state, but it becomes an operational problem if the reviewer never returns. Without a staleness signal, Nexus management has no visibility into blocked reviews.

**Decision (design note only — implementation deferred to QMS-3C or QMS-3D):** HealthMonitor should include a check for QC sessions where `session_started_at` is older than 24 hours and no COMPLETED or VOIDED row exists for the same `qc_session_id`. This check should emit a `WARN` log event and, optionally, a health alert to `HM_ALERT_RECIPIENT`. The detection query requires a DAL read on the current-period FACT_QC_REVIEW_SESSIONS partition, grouped by `qc_session_id`, filtering for sessions with STARTED but no COMPLETED/VOIDED row and `session_started_at < now - 24h`. No implementation is added in QMS-3C-Prep. This note records the design intent so it is not forgotten when QcReviewEngine is built.

**Consequences:** No code changes. This ADR is a placeholder to ensure HealthMonitor coverage is designed into QcReviewEngine from the start rather than retrofitted. Implementation assigned to QMS-3C or QMS-3D depending on scope fit.

---

## Billing Hardening Sprint — Work Log & Job Creation Decisions

---

### ADR-WL-001: job_number normalization as defense in depth (guard + retroactive fixer)

**Status:** Accepted  
**Date:** 2026-07-08  
**Context:** Post-cutover work log submissions occasionally carried a client/lot description suffix on `job_number` after a space or underscore (e.g. `"2605-6039-A Mary's Landing Lot 9-16 OWF"` instead of `"2605-6039-A"`). Because `VW_JOB_CURRENT_STATE` never has a row for the full descriptive string, a full FACT_WORK_LOGS → VW_JOB_CURRENT_STATE audit (`WorkLogOrphanAudit.gs`) found 1,448 total orphaned job_numbers across all partitions (1,382 pre-cutover, expected — see ADR context below; 66 post-cutover, unexpected). Of the 66 post-cutover orphans, normalization (strip everything after the first space/underscore) resolved 46 to a real VW row; 1 (`"job assign & help"`) is admin overhead, not a real job; 19 do not resolve and remain genuinely orphaned.  
**Decision:** Two-layer fix. (1) **Guard** — `WorkLogHandler.handle()` normalizes `job_number` (strip to the token before the first space/underscore) immediately after payload validation, before the VW existence check and before the FACT_WORK_LOGS write, logging `WORK_LOG_JOB_NUMBER_NORMALIZED` (WARN) when normalization changes the value. This prevents new orphans of this shape at the source. (2) **Retroactive fixer** — `OrphanJobNumberFixer.gs` (`runOrphanJobNumberFixer(dryRun)`, wrapper `runOrphanJobNumberFixer_LIVE()`) resolves the 46 existing post-cutover orphans via a **net-zero void + re-submit** (not a single additive `WORK_LOG_AMENDED` row): for each correctable row, writes a `WORK_LOG_VOIDED` row under the original job_number (hours negated) plus a `WORK_LOG_SUBMITTED` row under the normalized job_number (same hours). Idempotent via `ORPHAN_JOB_FIX_<original event_id>` key, checked both by DAL scan and `IdempotencyEngine`.  
**Why net-zero, not additive:** `PayrollEngine.aggregateHours_()` sums `FACT_WORK_LOGS` hours by `actor_code` + period only — it does not filter by `job_number` or `event_type`, and the only exclusion (`row.migration_batch`) is not a column present on the 2026-06/07 partitions these orphans live in. A single additive `WORK_LOG_AMENDED` row under the normalized job_number, with the original orphan row left untouched, would have doubled the actor's counted hours the moment payroll runs for that period. Net-zero re-attribution (matching the existing `WORK_LOG_REASSIGN` pattern in `WorkLogCorrectionHandler.gs`) keeps the actor's total hours unchanged regardless of payroll timing.  
**Result:** `runOrphanJobNumberFixer_LIVE()` run in PROD — 46 job_numbers resolved, 99.75 hours moved (net zero to actor totals). 19 orphans remain genuinely un-resolvable (need a manual VW row decision — see PROJECT_MEMORY.md §7) and 1 admin-overhead entry (`"job assign & help"`) was intentionally skipped.  
**Consequences:** New malformed submissions of this shape are caught at the handler before ever reaching FACT_WORK_LOGS. The 1,382 pre-cutover orphans were left untouched by this sprint — they predate the portal and were expected (migration imported raw work-log hours without corresponding job-lifecycle events for jobs already completed before cutover; see PROJECT_MEMORY.md §11). `OrphanJobNumberFixer` was added to `DAL.gs`'s `FACT_WORK_LOGS` `WRITE_PERMISSIONS` list — required before its writes could pass the write guard.

---

### ADR-WL-002: 16-hour daily cap on work log submissions

**Status:** Accepted  
**Date:** 2026-06-30  
**Context:** Designers could submit unlimited hours per work_date with no sanity check. A fat-fingered entry (e.g. 80 instead of 8) would silently corrupt payroll and billing hours with no guard until manual reconciliation caught it weeks later.  
**Decision:** `WorkLogHandler.handle()` Step 5d computes net hours already logged by the actor on the submitted `work_date` (`getDailyNetHours_`, excluding migration rows) and rejects the submission if adding the new hours would exceed 16h/day, with an error message showing already-logged vs. submitted hours. Shipped alongside a content-based duplicate guard (Step 5c: rejects an exact actor+job+date+hours repeat as a silent `DUPLICATE_WORK_LOG`, not an error).  
**Consequences:** Obvious data-entry mistakes are caught at submission time. Legitimate long days (up to 16h) are still allowed — the cap is a sanity bound, not a policy limit on actual work hours. Test suite required dynamic per-run work dates (`TW_WORK_DATE`, offset slot logic) to avoid cross-test accumulation against the same actor+date.

---

### ADR-WL-003: Closed-job guard on work log submission

**Status:** Accepted  
**Date:** 2026-07-01  
**Context:** Without a state check, designers could log hours against a job already in `INVOICED`, `VOIDED`, or `CANCELLED` state — appending new hours to a job whose invoice has already gone to the client, corrupting billing records after the fact.  
**Decision:** `WorkLogHandler.handle()` Step 4 checks `StateMachine.getJobView(jobNumber).current_state` before accepting a submission. `INVOICED`, `VOIDED`, `CANCELLED` are explicitly blocked (not all covered by `Config.STATES` transitions); `StateMachine.isTerminal()` is checked as a fallback so any future terminal state added to `Config` is covered automatically. Rejected submissions throw `"Cannot log hours — job {job_number} is in {state} state."`  
**Consequences:** Once a job is invoiced, its hours ledger is frozen against new work-log submissions. Legitimate corrections to a closed job's history go through the dedicated correction handlers (`WorkLogCorrectionHandler.gs` — amend/void/reassign), which have their own RBAC hierarchy and an explicit ALL-scope override for PM/CEO/ADMIN, rather than reopening the closed-job guard on the submission path itself.

---

### ADR-JOB-002: product_code required at job creation

**Status:** Accepted  
**Date:** 2026-07-06  
**Context:** `JobCreateHandler`'s payload schema allowed `product_code` to be blank (`required: false`). Downstream, `product_code` drives job_type classification/fallback, SOP template resolution (product-scoped SOPs), QC finding applicability (e.g. `PLATE_ERROR` is TRUSS-specific), and client timesheet product/job-type columns. Blank `product_code` at the source pushed fallback-handling complexity into every one of those downstream consumers instead of validating once where the job is created. A related audit (`BlankProductAudit.gs`) found existing blank-`product_code` jobs for SBS and NORSPAN in one period.  
**Decision:** Enforced with a **post-validation guard**, not a schema `required: true` change — `ValidationEngine`'s generic "field is required" message isn't actionable for a job-creation submitter choosing from a product dropdown. `JobCreateHandler.handle()` Step 2a explicitly checks `cleanPayload.product_code` for blank/absent after validation and throws a specific, actionable message: `"Product type is required. Please select a product (e.g. Roof Truss, Floor Truss)."` The schema field itself stays `required: false` with a comment explaining the guard handles enforcement.  
**Consequences:** All new jobs must specify a product at creation; existing blank-`product_code` jobs identified by `BlankProductAudit.gs` are a separate cleanup item, not retroactively touched by this guard. Downstream product-dependent logic (job_type fallback, SOP template resolution, timesheet generation) can now assume `product_code` is always present for jobs created after 2026-07-06.
