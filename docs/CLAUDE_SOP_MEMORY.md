# CLAUDE_SOP_MEMORY.md — BLC Nexus SOP Bootstrap

**Read this file at the start of every SOP-related session.**
Then paste `docs/SOP_MASTER_PROMPT.md` into the session to activate the governing operating charter.
This file captures the architecture and status; the Master Prompt governs how to work.

---

## What Is the SOP Module?

Module T13 (`src/13-sop/`) is a quality gate that enforces product-specific checklist completion before a job can advance to QC submission. It is:
- Event-sourced and append-only (FACT_SOP_AUDITS)
- Controlled by Script Property feature flags (off by default)
- Wired into the queue-based architecture (not a direct call path)

---

## SOP Key Architecture

```
SOP identity = client_code + product_code
```

- `scope_code` on `DIM_SOP_TEMPLATES` = `product_code` on the job
- One ACTIVE template per `(client_code, product_code)` at a time
- Multiple versions supported: DRAFT → ACTIVE → RETIRED
- Never combine multiple products into one template

---

## Current Status (as of 2026-06-25)

| Item | Status |
|---|---|
| T13 source code | Complete and tested in DEV |
| Feature flag `SOP_ENABLED` in PROD | `false` (module is silent) |
| SBS SOP templates imported to DEV | NO — pending Phase 1–5 process |
| SBS Google Form URL | Not yet received |
| I-Joist Word document | Not yet received |
| WARN_ONLY pilot | Not started |
| SOP Compliance Dashboard | Deferred to Phase 2 |

---

## Key Source Files

| File | Purpose |
|---|---|
| `src/13-sop/SopGate.gs` | QC gate — evaluates SOP completeness at submit time |
| `src/13-sop/SopAuditEngine.gs` | Reads FACT_SOP_AUDITS, returns incomplete required items |
| `src/13-sop/SopDAL.gs` | All SOP sheet reads/writes via getDAL() |
| `src/13-sop/SopAdminEngine.gs` | Create/publish/retire templates (RBAC: SOP_ADMIN) |
| `src/13-sop/SopImporter.gs` | One-time migration from MIGRATION_SOP_IMPORT sheet |
| `src/13-sop/SopTemplateEngine.gs` | Template resolution and item rendering |
| `src/13-sop/SopTests.gs` | Gate + audit engine unit tests |
| `src/13-sop/SopAdminTests.gs` | Admin engine unit tests |
| `tests/sop-integration.test.js` | Integration tests |

---

## Feature Flags

| Script Property | Values | Default |
|---|---|---|
| `SOP_ENABLED` | `true` / `false` | off (not set) |
| `SOP_MODE` | `WARN_ONLY` / `BLOCK` | `WARN_ONLY` if absent |
| `SOP_PILOT_CLIENTS` | Comma-separated codes (e.g. `SBS`) | empty = all clients |

Gate passes silently if: `SOP_ENABLED` is not `true`, client not in pilot list, no active template exists for the product.

---

## Target SOPs — SBS

| SOP | Source | Rule |
|---|---|---|
| SBS+TRUSS | Google Form — extract TRUSS items only | No 1:1 copy. Phase 1–5 process required. |
| SBS+OPEN_WOOD_FLOOR | Google Form — extract OWF items only | Same form as TRUSS — separate at Phase 1. |
| SBS+I_JOIST_FLOOR | Word document provided by Raj | Never infer from Form. Word doc only. |

---

## Import Process — 5 Phases (Gated)

**Never import anything without approval at each phase.**

| Phase | Description |
|---|---|
| 1. Discovery | Classify every Form question by product (TRUSS / OWF / I_JOIST / SHARED / REMOVE) |
| 2. SOP Design | Propose structure: item codes, sequencing, required/optional |
| 3. Nexus Mapping | Generate exact DIM_SOP_TEMPLATES + DIM_SOP_ITEMS column values |
| 4. Migration Validation | Verify codes, no duplicates, unique item codes |
| 5. Import Execution | Populate MIGRATION_SOP_IMPORT → dry run → final import |

---

## Required Output Sections (for every source document)

**A** — Source Summary: what was received, purpose, client, product, item count  
**B** — Classification Matrix: every question → product assignment + reasoning  
**C** — Recommended Removals: training content, non-verifiable items, duplicates  
**D** — Recommended Additions: missing engineering/QC controls  
**E** — Final Nexus SOP Design: item number, label, description, required, category, ownership, severity  
**F** — Nexus Import Mapping: import-ready column values for MIGRATION_SOP_IMPORT  

---

## SOP Item Philosophy

Every SOP item must answer: **"Can an auditor verify this step was actually completed?"**

- BAD: "Review design carefully" / "Check all dimensions"
- GOOD: "Verify roof pitch matches architectural drawings"

Target: 15–30 items. Hard max: 40.

Item classification required (see ADR-SOP-011 for category rename history):
- **Category:** Design / QC / Engineering / Client Requirement / Production / Documentation
- **Ownership:** DESIGNER / QC / BOTH
- **Severity:** BLOCKING / WARNING / INFO

---

## Deployment Safety Rules

1. All T13 code must pass `testAll()` before any PROD deploy.
2. Set `SOP_ENABLED = true` in PROD only after: import validated in DEV + WARN_ONLY pilot approved.
3. Set `SOP_PILOT_CLIENTS = SBS` before enabling — never enable for all clients on first launch.
4. Switch `SOP_MODE` from `WARN_ONLY` to `BLOCK` only after 2+ weeks of WARN_ONLY data confirm coverage.
5. No PROD template changes without a corresponding git commit (Rule R1).

---

## SOP Compliance Dashboard — DEFERRED

**Do not build the dashboard now.**

Build after:
- SBS SOP import complete (all 3 templates ACTIVE in DEV)
- WARN_ONLY pilot running with real data in FACT_SOP_AUDITS
- Raj approves dashboard scope

Dashboard will show:
- SOP completion % by designer, team lead, client, product
- Critical item completion %
- Most missed items
- Jobs submitted to QC with incomplete SOPs
- WARN_ONLY vs BLOCK violation counts
- Weekly/monthly trends

Data sources: FACT_SOP_AUDITS, FACT_SOP_CURRENT_STATUS, DIM_SOP_TEMPLATES, DIM_SOP_ITEMS, VW_JOB_CURRENT_STATE, FACT_QC_EVENTS.

Outputs will support: team quality review, client audit readiness, designer coaching, QC tracking, future bonus calculations.

---

## Key Commits

| Commit | Description |
|---|---|
| `b36300f` | SOP schema and constants foundation |
| `2e941cf` | SOP DAL, template engine, audit engine |
| `aaa1a48` | SOP admin engine, importer, admin tests |
| `39facff` | SOP QC gate |
| `63eb31c` | SOP gate implementation |
| `537e8e5` | DEV Google Form SOP import utility |
| `2c2cd67` | Fix: resolve templates by product scope |
| `245a8b7` | Stabilize SOP checklist handler tests |

---

## Next Actions Required

1. Raj to provide: SBS Google Form URL + I-Joist Word document
2. Begin Phase 1 Discovery using the 5-phase gated process
3. Do not write any DAL calls or template data until Phase 3 is approved

---

## Related Docs

- `docs/SOP_MASTER_PROMPT.md` — governing operating charter (paste into every SOP session)
- `docs/SOP_ARCHITECTURE.md` — data model, feature flags, file inventory
- `docs/SOP_DECISIONS.md` — architectural decision log (ADR-SOP-001 through 011)
- `docs/SOP_PRODUCT_INVENTORY.md` — per-client, per-product import status
- `docs/SOP_ROADMAP.md` — phase plan + dashboard specification
