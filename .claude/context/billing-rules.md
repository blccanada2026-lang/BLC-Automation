# Billing Rules — BLC Nexus

## Rate Model
- Billing is **hourly**: `amount = total_hours × client_hourly_rate`
- Hours sourced from `FACT_WORK_LOGS` grouped by `job_number`
- Rates stored in `DIM_CLIENT_RATES` (per client, optional per-product override)
- `product_code` blank in DIM_CLIENT_RATES = flat rate for all products
- `product_code` set = product-specific override (differential pricing — future use)
- Supported billing currencies: **CAD, USD**

---

## Client Onboarding
- New clients onboarded via portal (CEO/PM only)
- Creates one row in DIM_CLIENT_MASTER + one flat-rate row in DIM_CLIENT_RATES
- Additional product-specific rates added directly in DIM_CLIENT_RATES sheet
