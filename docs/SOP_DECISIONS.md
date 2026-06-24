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
