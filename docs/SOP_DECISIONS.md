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
