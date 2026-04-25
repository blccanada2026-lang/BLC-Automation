# Quarterly Bonus Engine — Design Spec
**Date:** 2026-04-06
**Status:** Approved for implementation

---

## Overview

A quarterly performance bonus system for BLC designers, team leads, and project managers. Bonuses are computed in March, June, September, and December. An additional annual bonus is paid in December only.

**Bonus formula (all roles):**
```
bonus_INR = quarterly_design_hours × composite_score × ₹25
```
Where `composite_score` is a 0–1 number derived from weighted performance inputs specific to each role.

---

## 1. Bonus Formulas by Role

### 1.1 Designer
```
composite = 0.30 × (avg_client_score / 5)
          + 0.30 × (1 − error_rate)
          + 0.25 × (tl_score / 5)
          + 0.15 × (pm_score / 5)
```

| Input | Weight | Source | Notes |
|---|---|---|---|
| Client feedback | 30% | Client rating portal | Avg of 5 sub-scores (see §3.1) |
| Error rate | 30% | MASTER_JOB_DATABASE | `rework_hours / total_design_hours` for the quarter |
| TL rating | 25% | TL rating portal | Weighted avg of 4 TL categories (see §3.2) |
| PM rating | 15% | PM rating portal | Weighted avg of 4 PM categories (see §3.3) |

**Hours base:** designer's own design hours in the quarter from MASTER_JOB_DATABASE.

---

### 1.2 Team Lead
```
composite = 0.30 × (1 − client_qc_returns / total_jobs)
          + 0.40 × avg_designer_composite_score
          + 0.30 × (ceo_score / 5)
```

| Input | Weight | Source | Notes |
|---|---|---|---|
| Client QC return rate | 30% | MASTER_JOB_DATABASE | Jobs returned by client after internal QC |
| Avg designer score | 40% | Computed from designer composites | Avg of all designers reporting to this TL |
| CEO rating | 30% | CEO rating portal | Avg of 4 CEO categories (see §3.4) |

**Hours base:** total design hours of all designers reporting to this TL in the quarter.

---

### 1.3 Project Manager
Same formula as Team Lead.

**Hours base:** total design hours of all designers under this PM in the quarter.

**Computation order:** Designers must be computed first, then TL, then PM (TL/PM depend on designer composite scores).

---

### 1.4 Annual Bonus (December only)
```
annual_bonus_INR = full_year_design_hours × annual_composite × ₹25
```
- Annual composite recalculated using aggregated Jan–Dec data
- Paid **in addition to** Q4 quarterly bonus
- If any quarter was PENDING, that quarter's data is excluded from the annual calculation and flagged

---

## 2. Data Model

### 2.1 QUARTERLY_BONUS_INPUTS (new sheet)

One consolidated row per person per quarter. Stores manually-entered rating averages only.
Auto-computed values (error rate, client QC return rate, avg designer score) are derived by the engine from MASTER at run time — not stored here.

| Column | Type | Notes |
|---|---|---|
| inputId | STRING | Auto-generated (QBI prefix) |
| quarter | STRING | Q1-2026, Q2-2026, Q3-2026, Q4-2026 |
| personId | STRING | Designer/TL/PM's designer_id |
| personName | STRING | |
| role | STRING | Designer / Team Leader / Project Manager |
| clientFeedbackAvg | NUMBER | Avg of 5 client sub-scores (designers only) |
| tlRatingAvg | NUMBER | Avg of 4 TL sub-scores (designers only) |
| pmRatingAvg | NUMBER | Avg of 4 PM sub-scores (designers only) |
| ceoRatingAvg | NUMBER | Avg of 4 CEO sub-scores (TL/PM only) |
| forcedDiffFlag | BOOLEAN | True if rater submitted >60% of their reportees above 4.0 |
| strengthNote | STRING | Open-ended: "one strength" (from TL/PM rater) |
| improvementNote | STRING | Open-ended: "one improvement area" (from TL/PM rater) |
| compositeScore | NUMBER | Final 0–1 computed score (written by engine at run time) |
| status | STRING | Draft / Pending / Approved |
| computedAt | TIMESTAMP | |

### 2.2 BONUS_LEDGER (existing SheetDB schema)

Stores final computed bonus amounts. Uses existing fields:
- `bonusType` = `QUARTERLY` or `ANNUAL`
- `calculationPeriod` = `Q1-2026`, `Q2-2026`, etc.
- `bonusINR` = final bonus amount
- `status` = `Draft` → `Approved` → `Paid`
- `feedbackScore` = composite score stored for audit
- `performanceTier` = `HIGH` / `AVERAGE` / `NEEDS_IMPROVEMENT` (derived from score)

---

## 3. Rating Forms — Portal Pages

All four rating views are served via `doGetSecure()` as a new `QUARTERLY_RATING` view. Submissions go via `doPost()` → writes to QUARTERLY_BONUS_INPUTS.

### 3.1 Client Rates Designer
- **Auth:** 32-char token from CLIENT_MASTER (existing token system)
- **Scope:** Client sees only designers who worked on their jobs that quarter
- **Sub-scores (each 1–5):**
  1. Quality & Accuracy
  2. Adherence to SOP
  3. Turn Around Time & Reliability
  4. Communication & Responsiveness
  5. Overall Satisfaction
- **Score used in formula:** average of the 5 sub-scores

### 3.2 TL Rates Designers
- **Auth:** Google session auth via `authenticateInternalUser()`, role=Team Leader
- **Scope:** TL sees only designers who report to them (from STAFF_ROSTER `supId`)
- **Sub-scores (each 1–5):**
  1. QC Discipline & Error Ownership
  2. SOP Compliance & Process Discipline
  3. Productivity Consistency
  4. Learning Ability & Improvement Curve
- **Open-ended fields (mandatory):**
  - One biggest strength
  - One key improvement area
- **Score used in formula:** average of the 4 sub-scores
- **Forced differentiation rule:** Engine flags a warning (not a block) if >60% of this TL's designers are rated above 4.0

### 3.3 PM Rates Designers
- **Auth:** Google session auth, role=Project Manager
- **Scope:** PM sees all designers mapped to them via `pm_code` in STAFF_ROSTER
- **Sub-scores (each 1–5):**
  1. Ownership & Accountability
  2. Communication Within Team
  3. Attitude, Reliability & Culture Fit
  4. Consistency Under Pressure
- **Open-ended fields (mandatory):**
  - One biggest strength
  - One key improvement area
- **Score used in formula:** average of the 4 sub-scores
- **Forced differentiation rule:** Same flag as TL

### 3.4 CEO Rates TL/PM
- **Auth:** Google session auth, role=CEO
- **Scope:** Raj sees all active TL and PM staff
- **Sub-scores (each 1–5):**
  1. Team Development
  2. Client Relationship Management
  3. Delivery Consistency
  4. Escalation Handling
- **Supporting notes field:** Free text (will be pre-populated by performance agent in Phase 2)
- **Score used in formula:** average of the 4 sub-scores

---

## 4. Computation Engine — QuarterlyBonusEngine.js

New file, separate from PayrollEngine.js.

### 4.1 Function Inventory

| Function | Purpose |
|---|---|
| `runQuarterlyBonus(quarter, year)` | Main entry — called from BLC Menu |
| `computeDesignerScores_(quarter, year, inputs)` | Computes composite for every designer |
| `computeSupervisorScores_(quarter, year, designerScores, inputs)` | TL then PM (depends on designer scores) |
| `getQuarterHours_(quarter, year)` | Reads MASTER for design hours across the quarter's 3 months |
| `getErrorRates_(quarter, year)` | Reads MASTER rework hours → `{designerName: rate}` |
| `getClientQcReturnRates_(quarter, year)` | Reads MASTER client return jobs → `{supervisorId: rate}` |
| `getBonusInputs_(quarter, year)` | Reads QUARTERLY_BONUS_INPUTS for the quarter |
| `checkForcedDifferentiation_(raterName, inputs)` | Returns true if >60% rated above 4.0 |
| `writeBonusLedger_(entries)` | Writes/overwrites BONUS_LEDGER rows for this quarter via SheetDB |
| `runAnnualBonus(year)` | December only — aggregates Jan–Dec, writes ANNUAL rows |
| `sendBonusRatingReminders(quarter, year)` | Sends portal links to staging or direct (config-driven) |
| `previewQuarterlyBonus(quarter, year)` | UI-only alert with summary before committing |

### 4.2 Quarter Definitions
```
Q1 = January, February, March    → run in March
Q2 = April, May, June            → run in June
Q3 = July, August, September     → run in September
Q4 = October, November, December → run in December (+ annual)
```

### 4.3 Execution Flow for runQuarterlyBonus
1. Prompt for quarter + year (if not passed)
2. `getQuarterHours_()` — aggregate design hours per person from MASTER
3. `getErrorRates_()` — compute error rate per designer from rework hours
4. `getClientQcReturnRates_()` — compute return rate per supervisor
5. `getBonusInputs_()` — load all rating rows from QUARTERLY_BONUS_INPUTS
6. `computeDesignerScores_()` — score every designer; PENDING if any input missing
7. `computeSupervisorScores_()` — score TL then PM using designer scores
8. `checkForcedDifferentiation_()` — flag and log any violations
9. `writeBonusLedger_()` — clear existing rows for this quarter, write new rows
10. If December: `runAnnualBonus()` automatically after quarterly run
11. Log to LOG_MASTER, show summary alert

### 4.4 Status Rules
- All inputs present → `status = Draft`, bonus computed
- Any input missing → `status = Pending`, `bonusINR = 0`, reason logged
- Raj reviews BONUS_LEDGER → approves → `status = Approved`
- Paid with monthly payroll run → `status = Paid`
- Re-runnable: existing BONUS_LEDGER rows for the quarter are deleted and recomputed

---

## 5. Link Delivery — Staged Rollout

### CONFIG_MASTER key
```
bonus_links_send_direct = false   ← Phase 1 (staging)
bonus_links_send_direct = true    ← Phase 2 (live)
```

### Phase 1 (Q1–Q2 2026)
`sendBonusRatingReminders()` sends all links to `blccanada2026@gmail.com` only.
Each email is clearly labelled: `"FOR: [Client Name] — [Client Email]"` so HR can copy-paste and forward.
One email per intended recipient.

### Phase 2 (Q3-2026 onwards, once validated)
Flip `bonus_links_send_direct = true` in CONFIG_MASTER. No code change required.
Links go directly to clients, TL, PM, and CEO.

---

## 6. Error Handling

| Scenario | Behaviour |
|---|---|
| Missing rating input | `PENDING` in BONUS_LEDGER, reason in notes |
| All inputs missing | Engine skips person, logs warning |
| Forced differentiation violation | Warning to LOG_MASTER + alert to Raj, not a block |
| Annual bonus with PENDING quarters | That quarter excluded, flagged in annual summary |
| Re-run for same quarter | Existing BONUS_LEDGER rows deleted first, recomputed |
| Zero design hours | Bonus = ₹0, still written for audit trail |

---

## 7. Testing Plan

- Unit test each score formula (designer, TL, PM, annual)
- Test PENDING when each input type is missing
- Test forced differentiation flag threshold (60%)
- Test dependency order (TL score uses designer scores)
- Test quarter month mapping (Q1=Jan-Mar etc.)
- Test re-run clears and rewrites correctly
- Test annual bonus excludes PENDING quarters
- All tests use existing Jest + gas-mocks.js infrastructure

---

## 8. Future (Phase 2 — Not in scope now)

- Performance agent pre-populates CEO rating supporting notes
- Portal UI for Raj to approve BONUS_LEDGER rows directly
- Automatic trigger on last day of quarter month
- Designer self-view of their bonus breakdown in the portal
