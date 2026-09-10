# Product-Scoped Account Supervision — Design Spec

**Date:** 2026-09-10
**Status:** Approved (2026-09-10) — proceeding to implementation plan
**Related:** `docs/superpowers/specs/2026-09-08-payout-supervision-redesign-design.md`
(Phase 1, shipped to PROD 2026-09-09). This spec is **Phase 1.5** — it
extends Phase 1's table and calc engine before Phase 2 (the portal UI)
starts, and Phase 2 must be built against the shape defined here, not
Phase 1's original 2-column shape.

## 1. Problem

Phase 1 scoped Team Lead supervisor bonus by client account only:
`REF_ACCOUNT_SUPERVISION(client_code, designer_code, supervisor_code)`.
Real business need, user's words: "if a team lead does only roof truss
then he can get only the supervisor bonus for roof truss and not i joist
and vice versa" — some team leads are responsible for a designer's whole
account, others only for one product line within it, and both must be
representable at once.

Motivating case: Deb Sen becomes Team Lead for Alberta Truss and Nelson,
but only for Truss work (`ROOF_TRUSS` + `FLOOR_TRUSS`) — Sarty remains
responsible for I-Joist (`FLOOR_JOIST`) work on those same two accounts,
via his existing flat, company-wide PM bonus (`buildPmBonusMap_`), which
does not use this table at all.

## 2. Confirmed facts this design is built on

- `product_code` is an existing, closed-enum field (`ROOF_TRUSS`,
  `FLOOR_TRUSS`, `FLOOR_JOIST`, `WALL_PANEL`, `LUMBER_TAKEOFF`), required
  at job creation and read-only thereafter (`JobUpdateHandler.gs` only
  ever reads it back from the existing row — it cannot blank it out).
  "I-Joist" is the business name for `FLOOR_JOIST`.
- `product_code` became mandatory at job creation on 2026-07-06
  (`31923f1`, "guard: require product_code at job creation"). Before
  that, some jobs (concentrated in SBS/Norspan per
  `src/12-migration/BlankProductAudit.gs`) have a blank `product_code`.
- This model's effective date is **2026-08-01** — the first period this
  redesign actually drives a payout statement. Every job whose hours
  count toward this calc was therefore created after the 2026-07-06
  guard existed, so it always has a real product. Pre-2026-07-06 blank
  data is out of scope by construction, not by a special case in the
  code.
- Deb Sen's `DIM_STAFF_ROSTER.role` is currently `QC_REVIEWER`.
  `buildSupervisorBonusMapByAccount_` silently skips (`continue`, no
  logging) any supervisor whose role isn't exactly `TEAM_LEAD` — this is
  the same role-gate Phase 1 already relies on for the Sarty PM-skip
  case. Deb Sen's rows under this spec pay nothing until her role
  becomes `TEAM_LEAD`.

## 3. Data model change

Add one column to `REF_ACCOUNT_SUPERVISION`: `product_code`. Blank means
"covers every product on this account" (a wildcard); a specific enum
value scopes the row to that product only. The row's effective key
becomes `client_code + product_code + designer_code`, SCD-2'd exactly as
today (`effective_from`/`effective_to`).

Both wildcard and product-specific rows must be able to coexist for
different designers/supervisors on the same account — e.g. Bharath
covers all of Vani KV's Norspan hours (wildcard) while a different lead
could in principle cover just one product for a different designer on
the same account.

## 4. Function signature change

`StaffOnboarding.assignAccountSupervisor(actorEmail, clientCode,
designerCode, supervisorCode, effectiveDate, productCode)` — `productCode`
is a new 6th parameter, **optional**, defaulting to `''` (wildcard) when
omitted. Existing/whole-account call sites do not need to change shape.

## 5. Calculation engine changes

`buildJobToClientMap_()` becomes `buildJobToClientProductMap_()`:
`job_number → { client_code, product_code }` (was `job_number → client_code`).

The hours aggregation that currently buckets by `(designerCode,
clientCode)` gains a third level: `(designerCode, clientCode,
productCode)`, using each job's real product code.

Matching in `buildSupervisorBonusMapByAccount_`, per
`(designerCode, clientCode, productCode)` bucket:

1. Collect every `REF_ACCOUNT_SUPERVISION` row (as-of the payout date)
   where `client_code` and `designer_code` match, and `product_code` is
   either blank or exactly equal to the bucket's product.
2. If any row in that set has an exact product match, **only** exact
   matches count for this bucket — wildcard rows are discarded.
   Otherwise, the wildcard row(s) count.
3. If more than one row remains after step 2, that is the existing
   hard-throw ambiguity guard (`PayrollEngine.gs:422`), unchanged in
   spirit — evaluated within whichever tier won, not across both tiers.
4. If zero rows remain after step 2, the bucket is a `blockedPairs`
   entry — visible, never a silent skip.

## 6. Blocked-pair semantics and the cutover gate

Under product scoping, some blocked pairs are **permanent by design**,
not a data gap to close — e.g. every `FLOOR_JOIST` bucket for Priyanka
and Abhisek Rit will always appear blocked, because Sarty's coverage of
that work is intentionally outside this table (his PM bonus already
covers it, and no inert "supervisor row that role-gates to nothing" is
written for him — see §7).

The cutover gate (the check that must pass before `runBonusRun`/
`previewPayoutStatement` switch from the old flat calc to this one)
changes from "`blockedPairs` is empty" to: **every remaining blocked
pair matches an explicit, hardcoded accepted-exceptions list** in the
payroll module. This list is a plain code-level constant (not a new
table — deliberately low-ceremony given how few of these exist today),
reviewed like any other code change whenever it's updated. Any blocked
pair not on that list still fails the gate.

## 7. Why Sarty gets no explicit row for I-Joist

Considered and rejected: adding `REF_ACCOUNT_SUPERVISION` rows naming
Sarty as `FLOOR_JOIST` supervisor on Alberta Truss/Nelson, purely for
record-keeping, knowing the role gate would pay him nothing (he already
holds `PM`, not `TEAM_LEAD`).

Rejected because a row that names a supervisor but pays nothing is
indistinguishable, at read time, from a typo'd `supervisor_code` or an
unnoticed role change — the exact ambiguity Phase 1's own review already
caught and fixed once (an unresolvable `supervisor_code` was silently
indistinguishable from the intentional PM-skip case). The absence of a
row is unambiguous; a present-but-inert row is not. Account ownership
that isn't about this specific bonus is a different fact with a
different lifetime — `REF_ACCOUNT_DESIGNER_MAP` already exists for that
purpose, and overloading one table with two meanings is the same design
mistake the `role`-field/`QC_REVIEWER` bug (Phase 1's problem #1) made.

## 8. Blocking prerequisite: `StaffOnboarding.changeRole()`

No public function exists to change `DIM_STAFF_ROSTER.role` the SCD-2-safe
way — only `changeSupervisor()` and `changePayRate()`, both built on the
private `scd2FieldChange_` pattern. This spec requires a new
`changeRole(actorEmail, personCode, newRole, effectiveDate)`, mirroring
`changeSupervisor()`'s exact shape (same close-old-row/open-new-row SCD-2
pattern, same `ADMIN_CONFIG` permission gate), with tests mirroring
`staff-onboarding-change-supervisor.test.js`.

This is a **blocking predecessor task, not a parallel follow-up** — every
one of Deb Sen's four rows (§9) pays zero until her role is `TEAM_LEAD`.
It needs its own TDD cycle and code review before the backfill in §9 has
any financial effect, since it is itself a live financial write path
(a role change affects which bonus gate a person passes).

## 9. Backfill row set (reference — executed after implementation ships)

All rows effective **2026-08-01**. 11 whole-account rows (`product_code`
blank) plus 4 product-scoped rows for Deb Sen:

| Client | Product | Designer | Supervisor |
|---|---|---|---|
| SBS | (all) | MARV (Maruthi) | BCH (Bharath) |
| SBS | (all) | RKU (Rajkumar) | BCH (Bharath) |
| SBS | (all) | BIT (Bittu Dalui) | SVN (Savvy) |
| SBS | (all) | JYS (Joy Sarkar) | SVN (Savvy) |
| SBS | (all) | ABB (Abhijit Bera) | SVN (Savvy) |
| SBS | (all) | SYR (Sayan Roy) | SDA (Sandy) |
| SBS | (all) | PBG (Pabitra) | SDA (Sandy) |
| SBS | (all) | DBG (Debby Gosh) | SGO (Sarty) |
| MATIX-SK | (all) | DBG (Debby Gosh) | SGO (Sarty) |
| NORSPAN-MB | (all) | VKV (Vani KV) | BCH (Bharath) |
| NORSPAN-MB | (all) | RKG (RaviKumar Gummadi) | BCH (Bharath) |
| ALBERTA TRUSS | `ROOF_TRUSS` | PRS (Priyanka S) | DBS (Deb Sen) |
| ALBERTA TRUSS | `FLOOR_TRUSS` | PRS (Priyanka S) | DBS (Deb Sen) |
| NELSON | `ROOF_TRUSS` | AR001 (Abhisek Rit) | DBS (Deb Sen) |
| NELSON | `FLOOR_TRUSS` | AR001 (Abhisek Rit) | DBS (Deb Sen) |

`SNA` and `BTD` (52h and 86.25h on SBS in the raw `FACT_WORK_LOGS`
aggregation used to discover this row set) are confirmed legacy V2
migration codes for `SVN`/`BIT` respectively (`SUPERSEDED_MIGRATED`
pattern used across six existing modules) — already folded into `SVN`'s
and `BIT`'s real totals, not separate people, no row needed.

## 10. Testing

New/changed functions get full T1 coverage (happy path, RBAC denial,
invalid input, duplicate submission where applicable), TDD'd red-green,
mirroring existing patterns: `staff-onboarding-assign-account-supervisor
.test.js` extended for the `productCode` parameter and precedence rules;
a new test file for `changeRole()` mirroring
`staff-onboarding-change-supervisor.test.js`; `PayrollEngine`'s existing
`payroll-engine-supervisor-bonus-by-account.test.js` extended for the
three-tier matching (wildcard-only, product-specific-only, both present)
and the blocked-pair-with-accepted-exception path.

## 11. Explicitly out of scope for this spec

- Phase 2's portal UI is not touched here — it starts after this spec
  ships, and must be built to edit the 3-key (`client + product +
  designer`) shape defined here, not Phase 1's original 2-key shape.
- No change to `buildPmBonusMap_` or Sarty's PM bonus mechanism.
- No retroactive handling of pre-2026-07-06 blank-`product_code` jobs —
  confirmed out of scope by the 2026-08-01 effective date (§2).
