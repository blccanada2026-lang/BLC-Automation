# BLC Nexus — SOP Roadmap

## Current Priority Stack

1. Create SOP memory/docs (this document and siblings) ← DONE
2. Finalize SOP architecture + Master Charter v2.0 ← DONE
3. Design GLOBAL_QC_REVIEW_SOP (process template, no source doc needed)
4. Receive source documents from Raj (Form URL + I-Joist Word doc)
5. Phase 1–5: Import SBS Designer SOPs into DEV (gated, approval at each phase)
6. Validate product-specific checklist behavior in DEV
7. Pilot SBS in WARN_ONLY mode
8. Phase 2: Design and build SOP Compliance Dashboard (after pilot)

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
