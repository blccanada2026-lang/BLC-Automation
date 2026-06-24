# BLC Nexus — SOP Product Inventory

## Status Legend

| Status | Meaning |
|---|---|
| PLANNED | Identified, not started |
| IN_ANALYSIS | Source document being classified |
| DESIGNED | Classification done, structure approved |
| IMPORT_READY | Nexus mapping complete, ready for staging sheet |
| IMPORTED_DEV | Imported to DEV, not yet PROD |
| ACTIVE_PROD | Live in PROD, enforcing |

---

## SBS (Structural Building Solutions)

| Product | SOP Key | Source | Status | Notes |
|---|---|---|---|---|
| TRUSS | SBS+TRUSS | Google Form (extract TRUSS items only) | PLANNED | Requires Phase 1–5 approval sequence |
| OPEN_WOOD_FLOOR | SBS+OPEN_WOOD_FLOOR | Google Form (extract OWF items only) | PLANNED | Same source as TRUSS — separate at Phase 1 |
| I_JOIST_FLOOR | SBS+I_JOIST_FLOOR | Word document (provided separately) | PLANNED | Never infer from Form — Word doc only |

**SBS notes:**
- Google Form URL: not yet received
- I-Joist Word doc: not yet received
- All three SOPs blocked until source documents are provided
- Deployment order: TRUSS first (simplest product), then OWF, then I_JOIST

---

## Future Clients (Planned — Not Started)

| Client | Products | Source | Status |
|---|---|---|---|
| MATIX | TRUSS, I_JOIST_FLOOR | TBD | PLANNED |
| Other clients | TBD | TBD | PLANNED |

---

## Source Document Rules

- **Google Form** → Run through 5-phase gated process. Separate by product. Never 1:1 copy.
- **Word document** → Interpret and design — do not copy blindly. Apply SOP philosophy filter.
- **Verbal / email description** → Not acceptable as sole source. Must be formalized in a document.
- **Existing PROD form** → Same rules as Google Form. Treat as discovery input, not final SOP.

---

## Product Code Registry

These are the valid `product_code` values currently in scope for SOP enforcement:

| Product Code | Description |
|---|---|
| TRUSS | Roof truss design |
| OPEN_WOOD_FLOOR | Open wood floor system |
| I_JOIST_FLOOR | I-Joist floor system |

Additional product codes must be registered in `Config.gs` before they can be used in SOP templates.
