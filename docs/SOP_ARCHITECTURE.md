# BLC Nexus — SOP Module Architecture

## Overview

The SOP Checklist Gate (Module T13) enforces per-product standard operating procedure checklists before a job can advance to QC. It is an event-sourced, append-only quality gate wired into the existing queue-based architecture.

---

## SOP Identifier

```
SOP identity = client_code + product_code
```

Examples: `SBS+TRUSS`, `SBS+OPEN_WOOD_FLOOR`, `SBS+I_JOIST_FLOOR`, `MATIX+TRUSS`

Never combine multiple products into one SOP. One template = one client + one product.

---

## Data Model

### DIM_SOP_TEMPLATES
One row per SOP template version. Only one template per `(client_code, product_code)` may be ACTIVE at a time.

| Column | Description |
|---|---|
| sop_template_id | Unique ID |
| client_code | Client code (e.g. SBS) |
| job_type | Job type filter (or * for all) |
| software | Software filter (or * for all) |
| scope_code | Maps to product_code on the job side |
| template_name | Human-readable name |
| version | Integer version number |
| status | DRAFT → ACTIVE → RETIRED |
| created_at | ISO timestamp |
| created_by | Actor person_code |

### DIM_SOP_ITEMS
One row per checklist item per template.

| Column | Description |
|---|---|
| sop_item_id | Unique ID |
| sop_template_id | FK to DIM_SOP_TEMPLATES |
| item_seq | Display order |
| item_code | Unique code within template (e.g. SBS-T-001) |
| item_label | Short label shown to designer |
| item_description | Full description / guidance |
| is_required | Y/N — whether incomplete blocks BLOCK-mode submission |
| requires_comment | Y/N |
| requires_attachment | Y/N |
| active_flag | TRUE/FALSE |

### FACT_SOP_AUDITS
Append-only log of every checklist item response.

### FACT_SOP_CURRENT_STATUS
Projection — current SOP completion state per job.

---

## Template Lifecycle

```
DRAFT → (addItem / editItem) → (publishTemplate) → ACTIVE
ACTIVE → (copyTemplate) → new DRAFT (version N+1)
ACTIVE → (retireTemplate) → RETIRED
```

Only DRAFT templates may be edited. Only ACTIVE templates are enforced by the gate.

---

## Feature Flags (Script Properties)

| Property | Values | Default |
|---|---|---|
| `SOP_ENABLED` | `true` / `false` | off |
| `SOP_MODE` | `WARN_ONLY` / `BLOCK` | `WARN_ONLY` if absent |
| `SOP_PILOT_CLIENTS` | Comma-separated client codes | (empty = all clients) |

Gate logic:
1. Check `SOP_ENABLED` — if not `true`, pass through silently.
2. Check `SOP_PILOT_CLIENTS` — if set, only evaluate pilot clients.
3. Find ACTIVE template for `(client_code, product_code)`.
4. If no template → pass through (grace mode).
5. Evaluate required items. If incomplete:
   - `WARN_ONLY` → returns warning, does not block submission.
   - `BLOCK` → returns error, blocks QC submission.

---

## Source Files

| File | Role |
|---|---|
| `src/13-sop/SopGate.gs` | QC submission gate — evaluates SOP completeness |
| `src/13-sop/SopAuditEngine.gs` | Reads FACT_SOP_AUDITS, computes completion state |
| `src/13-sop/SopDAL.gs` | All SOP sheet access (via getDAL()) |
| `src/13-sop/SopAdminEngine.gs` | Create/edit/publish/retire templates |
| `src/13-sop/SopImporter.gs` | One-time migration from MIGRATION_SOP_IMPORT sheet |
| `src/13-sop/SopTemplateEngine.gs` | Template resolution and item rendering |
| `src/13-sop/SopAdminTests.gs` | Admin engine tests |
| `src/13-sop/SopTests.gs` | Gate and audit engine tests |
| `tests/sop-integration.test.js` | Integration tests |

---

## Module Dependencies

```
T13 (SOP) depends on:
  T0  — Config, constants
  T2  — RBAC.enforcePermission, RBAC.ACTIONS.SOP_ADMIN
  T1  — getDAL() (via SopDAL)
  T3  — Logger, HealthMonitor
  T4  — ValidationEngine (for FACT writes)
```

T13 must not be called by modules in T0–T12. It is a leaf module.

---

## Deployment State

- All T13 code implemented and tested in DEV.
- Feature flag `SOP_ENABLED` is `false` in PROD — module is present but silent.
- No SBS SOP templates imported to DEV yet (pending Phase 1–5 gated process).
- PROD deployment requires: SOP import complete + WARN_ONLY pilot approved.
