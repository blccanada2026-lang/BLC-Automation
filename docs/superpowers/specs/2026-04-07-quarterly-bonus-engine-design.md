# Quarterly Bonus Engine — Design Spec
*blc-nexus | Confirmed by Raj Nair, 2026-04-07*

---

## Goal

Calculate and record a quarterly performance bonus for each eligible BLC designer, TL, and PM. Generate a separate bonus report — never bundled with regular payroll. Sum Q1–Q4 into an annual bonus paid in December.

## Architecture

Single new IIFE module `QuarterlyBonusEngine.gs` (mirrors `PayrollEngine.gs` pattern). Ratings entered via a new portal route backed by a new `FACT_PERFORMANCE_RATINGS` table. Output written to `FACT_PAYROLL_LEDGER` with distinct event types `QUARTERLY_BONUS` and `ANNUAL_BONUS`.

**Load order:** T10 (same tier as PayrollEngine — loads after all T0–T9 files).

---

## Bonus Formula

### Quarterly

```
composite_score  = (client_score × 0.30)
                 + (error_score  × 0.40)   ← error_score = 1 − error_rate
                 + (rating_score × 0.30)

quarterly_bonus  = total_design_hours_in_quarter × composite_score × INR 25
```

All three inputs must be present. If any are missing the row is written with `status = PENDING` — never silently skipped.

### Annual

```
annual_bonus = SUM(Q1 + Q2 + Q3 + Q4 quarterly_bonus amounts already paid)
```

Annual bonus is a straight sum of the four quarterly amounts already recorded in `FACT_PAYROLL_LEDGER`. It is NOT a recalculation. Paid in December as a separate lump-sum entry.

---

## Eligibility

| Condition | Eligible? |
|---|---|
| `start_date` in DIM_STAFF_ROSTER ≥ 1 year ago AND `active = TRUE` | YES |
| `start_date` < 1 year ago BUT `bonus_eligible = TRUE` (CEO override) | YES |
| `active = FALSE` | NO |
| `start_date` < 1 year ago AND `bonus_eligible ≠ TRUE` | NO |

CEO grants exceptions by manually setting `bonus_eligible = TRUE` in DIM_STAFF_ROSTER.

---

## Who Rates Whom

| Ratee | Rater(s) | Rating score used |
|---|---|---|
| Designer | Their TL + their PM | Average of TL score and PM score |
| Team Lead | CEO | CEO score directly |
| PM | CEO | CEO score directly |

**Rating categories** (4 per ratee, 1–5 stars each, averaged to one score):
1. Quality & Accuracy
2. SOP Adherence
3. Communication
4. Initiative

Score normalisation: `avg_raw_stars − 1) / 4` → gives 0.0 (1-star) to 1.0 (5-star).

---

## Composite Score Inputs

### 1. Client Score (30%)
Source: `ClientFeedback.getFeedbackSummary(periodId)`
- Returns `{ designer_code: { avg_normalized } }` where `avg_normalized` is already 0–100.
- Divide by 100 to get 0.0–1.0.
- Only designers have client scores; TLs and PMs get this component = 0 (or skipped if not applicable).

### 2. Error Rate (40%)
Source: `VW_JOB_CURRENT_STATE`
- Read all rows where `period_id` falls within the quarter's 3 months.
- Per designer (`allocated_to`): `error_rate = count(rework_cycle > 0) / total_jobs`
- `error_score = 1 − error_rate`
- Designers with 0 jobs in the period: error_score = 1.0 (no errors = perfect).

### 3. Internal Rating Score (30%)
Source: `FACT_PERFORMANCE_RATINGS` (new table — see below)
- For designers: `rating_score = avg(TL_score, PM_score)` (both required; if one missing → PENDING)
- For TLs/PMs: `rating_score = CEO_score`

---

## New Table: FACT_PERFORMANCE_RATINGS

Append-only, partitioned by `period_id` (format: `YYYY-Qn`, e.g. `2026-Q1`).

| Field | Type | Notes |
|---|---|---|
| `rating_id` | string | Identifiers.generateId() with `PR` prefix |
| `period_id` | string | Quarter key e.g. `2026-Q1` |
| `ratee_code` | string | person_code of the person being rated |
| `rater_code` | string | person_code of the rater |
| `rater_role` | string | `TL` \| `PM` \| `CEO` |
| `score_quality` | number | 1–5 |
| `score_sop` | number | 1–5 |
| `score_communication` | number | 1–5 |
| `score_initiative` | number | 1–5 |
| `avg_score_normalized` | number | `(avg_raw − 1) / 4` → 0.0–1.0 |
| `submitted_at` | string | ISO timestamp |
| `idempotency_key` | string | `PERF_RATING\|{rater_code}\|{ratee_code}\|{period_id}` |

**Sheet name:** `FACT_PERFORMANCE_RATINGS` (no monthly partitioning — one sheet per quarter key).

---

## Files to Create / Modify

| File | Change |
|---|---|
| `src/10-payroll/QuarterlyBonusEngine.gs` | **CREATE** — new IIFE module |
| `src/00-foundation/Config.gs` | **MODIFY** — add `FACT_PERFORMANCE_RATINGS` to `Config.TABLES` + sheet headers |
| `src/07-portal/Portal.gs` | **MODIFY** — add `rate-staff` route |
| `src/07-portal/PortalData.gs` | **MODIFY** — add `getMyRatees()` + `submitRating()` |
| `src/07-portal/QuarterlyRating.html` | **CREATE** — rating form UI |

---

## QuarterlyBonusEngine.gs Internal Structure

```
Section 1: Constants
  QUARTERLY_BONUS_INR_PER_HOUR = 25
  WEIGHTS = { client: 0.30, error: 0.40, rating: 0.30 }
  QUARTER_MONTHS = { Q1:[1,2,3], Q2:[4,5,6], Q3:[7,8,9], Q4:[10,11,12] }

Section 2: Helpers
  quarterPeriodId_(quarter, year)         → '2026-Q1'
  monthPeriodIds_(quarter, year)          → ['2026-01','2026-02','2026-03']
  isEligible_(staffRow, today)            → bool

Section 3: Data gathering
  aggregateQuarterHours_(quarter, year)   → { person_code: design_hours }
  getQcErrorRates_(quarter, year)         → { person_code: error_score 0-1 }
  getClientScores_(quarter, year)         → { person_code: score 0-1 }
  getInternalRatings_(quarterPeriodId)    → { person_code: score 0-1 | null }

Section 4: Score computation
  computeCompositeScore_(c, e, r)         → 0.0–1.0

Section 5: Bonus rows
  computeBonuses_(staffCache, hours, errors, client, ratings, qPid)
                                          → array of ledger row objects

Section 6: Ledger
  writeBonusLedger_(bonusRows, actorEmail, qPid)

Section 7: Annual
  runAnnualBonus_(actorEmail, year)

Section 8: Public entry points
  runQuarterlyBonus(actorEmail, quarter, year)
  runAnnualBonus(actorEmail, year)
  previewQuarterlyBonus(actorEmail, quarter, year)  ← read-only, no writes
```

---

## Portal: Rating Entry Flow

1. CEO/TL/PM opens URL: `[portal]/exec?page=rate-staff&period=2026-Q1`
2. Portal authenticates via RBAC (same pattern as existing portal routes)
3. `PortalData.getMyRatees(raterEmail, quarterPeriodId)` returns the list of staff to rate
4. Rater fills in 4 star scores per ratee and submits
5. `PortalData.submitRating(raterEmail, payload)` validates + writes to `FACT_PERFORMANCE_RATINGS`
6. Idempotency key prevents double-submission; re-submitting overwrites (last write wins per rater/ratee/period)

**QuarterlyRating.html:**
- Lists ratees (auto-populated from server)
- 4 star-rating inputs per ratee (Quality, SOP, Communication, Initiative)
- Submit button per ratee (not one big submit)
- All server data injected via `textContent` — no innerHTML (XSS safe)

---

## Output: FACT_PAYROLL_LEDGER

Two new `event_type` values added alongside existing `PAYROLL_CALCULATED`, `PAYROLL_BONUS_SUPERVISOR`:

| event_type | When written |
|---|---|
| `QUARTERLY_BONUS` | `runQuarterlyBonus()` |
| `ANNUAL_BONUS` | `runAnnualBonus()` |

Idempotency keys:
- `QUARTERLY_BONUS|{person_code}|{quarterPeriodId}` e.g. `QUARTERLY_BONUS|DS1|2026-Q1`
- `ANNUAL_BONUS|{person_code}|{year}` e.g. `ANNUAL_BONUS|DS1|2026`

---

## Separate Report — Not Payroll

- `runQuarterlyBonus()` and `runAnnualBonus()` write to `FACT_PAYROLL_LEDGER` only.
- They do NOT trigger paystub emails. No confirmation workflow.
- CEO reviews via a read sheet or `previewQuarterlyBonus()` before running.
- Bonus amounts are visible in paystub only when CEO chooses to include them in a future summary email (separate feature, out of scope here).

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Any input missing (no client score, no ratings) | Write row with `status=PENDING`, `amount=0`, log warning |
| Designer has 0 jobs in period | `error_score = 1.0` (no rework = no errors) |
| Designer has no ratings yet | `status=PENDING` — bonus not calculated until ratings submitted |
| Staff not eligible (< 1 yr, no override) | Skip entirely, log info |
| Duplicate run | Idempotency key skips existing rows, logs warning |
| FACT_PERFORMANCE_RATINGS sheet missing | Throw with clear message: "Run setupQuarterlyBonusSheets() first" |

---

## Permissions

| Action | Required RBAC permission |
|---|---|
| `runQuarterlyBonus()` | `PAYROLL_RUN` (CEO only) |
| `runAnnualBonus()` | `PAYROLL_RUN` (CEO only) |
| `previewQuarterlyBonus()` | `PAYROLL_VIEW` |
| Submit rating via portal | `RATE_STAFF` (new permission — TL, PM, CEO) |

---

## Out of Scope (this spec)

- Sending bonus amounts via email to staff
- Paystub confirmation workflow for bonuses
- UI dashboard for bonus history
- Retroactive recalculation of past quarters
