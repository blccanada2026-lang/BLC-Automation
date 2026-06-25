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
