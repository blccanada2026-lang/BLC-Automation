# BLC Nexus — SOP Roadmap

## Current Priority Stack

1. Create SOP memory/docs ← DONE
2. Finalize SOP architecture + Master Charter v2.0 ← DONE
3. PR QMS-1: QMS documentation + ADRs ← IN PROGRESS
4. PR QMS-2: QC Findings taxonomy schema (pending approval)
5. PR QMS-3: QC Review Process schema (pending approval)
6. PR QMS-4: DEV test harness (pending approval)
7. Receive SBS source documents from Raj (Form URL + I-Joist Word doc)
8. Phase 1–5: Import SBS Designer SOPs into DEV (gated, approval at each phase)
9. Validate product-specific checklist behavior in DEV
10. Pilot SBS in WARN_ONLY mode
11. PR QMS-5: Portal prototype DEV only (pending approval, after schemas validated)
12. Phase 2: Design and build QMS Compliance Dashboard (after pilot)

---

## Phase 1 — SBS SOP Import (Current Phase)

**Gate:** No import until each sub-phase is approved.

| Sub-phase | Description | Status |
|---|---|---|
| 1. Discovery | Classify every Google Form question by product | BLOCKED — awaiting Form URL |
| 2. SOP Design | Propose 3 SOP structures with item codes | Not started |
| 3. Nexus Mapping | Generate exact DIM_SOP_TEMPLATES / DIM_SOP_ITEMS values | Not started |
| 4. Migration Validation | Verify product codes, no duplicate templates, unique item codes | Not started |
| 5. Import Execution | Staging import, dry run, final import | Not started |

**Blocking inputs needed:**
- SBS Google Form URL
- I-Joist Floor SOP Word document

---

## Phase 2 — SOP Compliance Dashboard

**Do not build the dashboard before the WARN_ONLY pilot completes. Dashboard metrics are meaningless without real SOP data.**

### Dashboard Scope

The SOP Compliance Dashboard will be built after SBS import + pilot. It will provide operational visibility into SOP completion rates across the business.

### Target Views

| View | Description | Audience |
|---|---|---|
| SOP completion by designer | % complete per designer per period | Team lead, QC |
| SOP completion by team lead | Aggregate by team | Management |
| SOP completion by client | Client-level compliance rate | Management, audit |
| SOP completion by product | TRUSS / OWF / I_JOIST breakdown | QC manager |
| Critical item completion | % of BLOCKING items completed | QC manager |
| Most missed items | Top 10 most frequently incomplete items | Operations |
| Jobs submitted to QC with incomplete SOPs | Count + list | QC manager |
| WARN_ONLY violations | Jobs that would have been blocked | Management |
| BLOCK violations | Jobs actually blocked | Management |
| Trend by week/month | Completion rate over time | All |

### Data Sources

| Source | Purpose |
|---|---|
| `FACT_SOP_AUDITS` | Raw checklist item responses |
| `FACT_SOP_CURRENT_STATUS` | Current completion state per job |
| `DIM_SOP_TEMPLATES` | Template metadata (client, product, version) |
| `DIM_SOP_ITEMS` | Item metadata (label, required, severity) |
| `VW_JOB_CURRENT_STATE` | Job context (designer, client, product, state) |
| `FACT_QC_EVENTS` | QC submission events for correlation |

### Dashboard Outputs

The dashboard must eventually support:
- Team quality review (weekly)
- Client audit readiness (on-demand)
- Designer coaching (quarterly)
- QC performance tracking
- Future quarterly bonus calculations (SOP compliance as a bonus factor)

### Delivery Vehicle

TBD at design time: Looker Studio (current reporting tool) vs portal-embedded table view.

### Phase 2 Prerequisites

- [ ] SBS SOP import complete and ACTIVE in DEV
- [ ] WARN_ONLY pilot running (at minimum 2 weeks of real data)
- [ ] FACT_SOP_AUDITS contains enough rows to validate aggregation logic
- [ ] Raj approves dashboard scope and design before build begins

---

---

---

## QMS PR Roadmap

| PR | Scope | Status | Gate |
|---|---|---|---|
| **QMS-1** | Documentation + ADRs (QUALITY_FRAMEWORK.md, ADR-QMS-001–006, all docs updated) | IN PROGRESS | Approved by Raj |
| **QMS-2** | QC Findings taxonomy schema (`DIM_QC_FINDING_TYPES`, seed data) | Pending approval | Wait for QMS-1 merge |
| **QMS-3** | QC Review Process schema (`DIM_QC_PROCESS_ITEMS`, `FACT_QC_REVIEW_CHECKLISTS`, `FACT_QC_FINDINGS`, `QcReviewEngine.gs`, `QcReviewDAL.gs`) | Pending approval | Wait for QMS-2 merge |
| **QMS-4** | DEV test harness (`QmsTests.gs` — zero regressions required) | Pending approval | Wait for QMS-3 merge |
| **QMS-5** | Portal prototype DEV only (QC reviewer UI, feature-flagged) | Pending separate approval | Wait for QMS-4 merge + Raj approval |

**Do not start any PR until the prior PR is merged and the next is explicitly approved.**

---

## Phase 1B — GLOBAL_QC_REVIEW_SOP Design

The QC Review SOP is process-based and does not require a client source document. It can be designed independently of the SBS Designer SOP import.

| Item | Description | Status |
|---|---|---|
| Design GLOBAL_QC_REVIEW_SOP | Controls for QC reviewer process | Not started |
| Map outcomes | PASS / MINOR_ERROR / REWORK | Not started |
| DEV import | Import to DIM_SOP_TEMPLATES as global template | Not started |
| Gate wiring | Wire QC SOP into QC submit flow (separate from Designer SOP gate) | Not started |

**Note:** GLOBAL_QC_REVIEW_SOP uses a special key — not `client_code + product_code`. Architecture decision needed at design time (ADR required).

---

## Future Phases

| Phase | Description |
|---|---|
| Phase 3 | Expand to additional clients (MATIX, others) — independent SOP design per ADR-SOP-010 |
| Phase 4 | Switch SBS from WARN_ONLY to BLOCK after pilot validates coverage |
| Phase 5 | SOP compliance as input to quarterly bonus calculation |
| Phase 6 | Client-facing audit export (audit readiness package) |
| Phase 7 | AI-assisted SOP audit (flag likely-incomplete items based on job history) |
