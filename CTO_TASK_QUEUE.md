# CTO_TASK_QUEUE.md — Active Workstreams

Running, human-and-Claude-readable log of active cross-session workstreams:
current step, and what's blocked on what. Distinct from `SESSION_LOG.md`
(what happened in a given session) — this tracks task *state* across
sessions, so a fresh session (or a fresh Claude instance) can pick up any
active thread without re-deriving where it left off.

**Update this file at the start and end of every session touching any of
these threads. Keep it lean** — this file tracks what's ACTIVE, not a
permanent archive. Once a thread is fully closed, its durable outcome
belongs in `PROJECT_MEMORY.md` (Completed Work / Known Risks / standing
§3.x rules) and `SESSION_LOG.md` (dated entry) — trim it out of here
rather than letting it accumulate. (Trimmed 2026-08-10 from ~1390 lines —
full pre-trim detail is preserved in `git log -p CTO_TASK_QUEUE.md` if
ever needed; nothing durable was lost, it's all already cross-referenced
into `PROJECT_MEMORY.md`.)

**Standing practice, added 2026-07-26:** update the "Session State" block
below at the end of every turn, not just at session/task boundaries. Keep
it terse (2-4 lines), overwrite it each turn — same-turn breadcrumb, not a
log. The durable narrative belongs in `PROJECT_MEMORY.md`/`SESSION_LOG.md`.

**Standing practice, added 2026-07-27 — `push:dev` discipline.** `clasp
push --force` (what `push:dev`/`push:prod` run) fully **replaces** a
script's deployed content — it does not merge. All `push:dev` calls must
originate from the worktree/branch that currently has the superset of
everything that needs to be in DEV — never run `push:dev` from the
primary checkout while a separate DEV-only branch has content `main`
lacks, that silently deletes it from DEV.

---

## Session State (last updated: end of turn, 2026-09-15)

**2026-09-15, NEW THREAD OPENED, Socratic mode — not yet started, question
phase.** User asked: check whether Q2 bonus calculations and the
client/supervisor feedback-form flow are "wired fully" (scope not yet
clarified — could mean code exists / mechanically connected / populated
with real Q2 data / a specific deadline concern), consult advisor as part
of it. **User explicitly invoked two standing operating modes for this
task** (now also saved as memory `feedback_socratic_ceo_mindset.md`):
(1) Socratic — ask one clarifying question at a time before investigating,
don't dump an answer; (2) CEO mindset — once answering, surface only 2-3
strategic calls that would move the needle, skip small stuff, not an
exhaustive audit trail (opposite style from this session's payroll audit,
which was deliberately thorough). User also asked: if context usage
exceeds ~70%, proactively compact/refresh without losing this task's
state — this file is the continuity mechanism for that. **Status: first
clarifying question asked, awaiting answer — no investigation started yet,
no files read yet beyond this note.**

---

**2026-09-15, later — PUSHED TO DEV THEN PROD.** After the git push to
origin (`bfe09e1`), user said "move to dev": `npm run push:dev` → 170
files, DEV script ID confirmed, both `PayrollEngine.gs` and the new
`Aug2026BonusAdjustment.gs` confirmed in the pushed set. Then "npm run
push:prod": git re-checked clean, `npm run push:prod` → **170 files
live in PROD** 10:13:14am, script ID confirmed
(`1HzRiDrQJ6z-BxPzk...`). No `PortalView.html`/`Portal.gs` touched, so
no manual New Version redeploy needed (R4.7 N/A).

**DRY RUN + REAL RUN executed 2026-09-15, 10:18-10:19am — CORRECTIONS
APPLIED IN PROD.** Dry run confirmed: script ID PROD, both BCH and SGO
still `PENDING_CONFIRMATION` (no drift since 2026-09-13/14), deltas
exactly as expected. Real run (`runAug2026BonusAdjustment('raj.nair@bluelotuscanada.ca')`)
completed cleanly — no errors, no "NO EMAIL SENT" warnings (both
staff resolved in `staffCache`, both correction emails sent via HR
routing). **BCH: ₹4,487.50 → ₹7,987.50 (PAYROLL_BONUS_ADJUSTED row
written). SGO: ₹48,343.75 → ₹54,843.75 (PAYROLL_BONUS_ADJUSTED row
written).** `MART_PAYROLL_SUMMARY` refreshed. Deb Sen's row untouched
throughout, as designed.

**2026-09-15, 10:32am — full team unified-statement resend to HR
(read-only, one-off `temp.gs` script, same pattern as the 2026-09-12
send, not committed to the repo).** User asked to resend all individual
payout statements to HR for a final check now that the corrections are
in. Read `FACT_PAYROLL_LEDGER` for `2026-08`, summed
`PAYROLL_CALCULATED` (base) + `PAYROLL_BONUS_SUPERVISOR` +
`PAYROLL_BONUS_ADJUSTED` (bonus, now correctly including both
corrections) per person, sent 17 HR-routed emails (Design/QC hours+pay,
Supervisor Bonus line where nonzero, Grand Total). **All 17 sent
successfully, no errors.** Confirmed the two corrected figures came
through exactly right: **BCH bonus 7,987.50, SGO bonus 54,843.75** — both
matching the `runAug2026BonusAdjustment` run above. Deb Sen unchanged at
1,150. No FACT writes — read + email only.

**Not yet done — 2 manual steps left, not scriptable, need the user:**
(1) HR reviews and forwards all 17 (or at minimum the corrected 2) to
each named person; staff re-confirm via the portal; (2) only after
that, run `approveAllPayroll('2026-08')`. This closes out the entire
Sarty-bonus-audit thread that opened this session.

---

**2026-09-15 — Aug-2026 bonus adjustment mechanism BUILT (subagent-driven,
not yet deployed).** User said "let's work through the adjustment
mechanism" for the two now-confirmed-wrong Aug bonus rows (Bharath
₹4,487.50→₹7,987.50, Sarty/PM ₹48,343.75→₹54,843.75). Full cycle: brainstorm
(architectural path) → spec at
`docs/superpowers/specs/2026-09-14-payroll-bonus-adjustment-design.md`
(advisor-reviewed, 4 fixes applied) → plan at
`docs/superpowers/plans/2026-09-14-payroll-bonus-adjustment.md` →
subagent-driven-development execution, directly on `main` (user's
explicit choice, no worktree — consistent with this whole session).

- **New mechanism:** `PAYROLL_BONUS_ADJUSTED` event type — a delta-only
  row, `refreshMartPayrollSummary_` now sums it alongside
  `PAYROLL_BONUS_SUPERVISOR` (`PayrollEngine.gs:1024-1025`,1078`). New
  `sendBonusAdjustmentEmail_` (HR-routed correction email,
  `PayrollEngine.gs:~839`). Both exposed on the public API.
- **One-off script:** `src/12-migration/Aug2026BonusAdjustment.gs` —
  `runAug2026BonusAdjustmentDryRun()` / `runAug2026BonusAdjustment(actorEmail)`,
  hardcoded to exactly the two corrections. Two-pass structure (verify
  ALL corrections' guards before writing ANY — a real gap found and
  fixed during task review; the first version let one person's write
  proceed before the second's mismatch check could abort). Prints
  script ID before any write (DEV/PROD confirmation). Silently-skipped
  emails now surface as `reason: 'applied_no_email'` plus a console
  warning, not silent success.
- **Critical bug found and fixed during final review:** the script's
  `callerModule` identity (`'Aug2026BonusAdjustment'`) was never added
  to `DAL.gs`'s `WRITE_PERMISSIONS['FACT_PAYROLL_LEDGER']` array — the
  real run would have thrown `WRITE_GUARD_DENIED` on its first write in
  PROD (fails safe — zero writes — but couldn't do its job). Invisible
  to Jest because the shared mock's `appendRow` drops the `callerModule`
  argument entirely. Fixed: identity added to the matrix
  (`DAL.gs:118`), noted in `docs/SYSTEM_ARCHITECTURE.md`.
- **6 commits, all local, NOT pushed to origin yet:** `70f57b9` (spec) →
  `1dc415c` (MART sum) → `9e5043c` (correction email) → `a479c29`
  (script) → `13a6a9f` (whole-batch safety fix) → `ecc60b6` (final-review
  fixes: write-permission, script-ID print, silent-email fix, RBAC-denial
  test). Full test suite: 4,772 passing (same 2 pre-existing unrelated
  `code-review-graph/` fixture failures throughout).
- **Not yet done:** git push to origin, `npm run push:dev`/`push:prod`,
  and the actual PROD run sequence (dry-run → real run → confirm HR
  forwarded both correction emails → only then `approveAllPayroll('2026-08')`).
  Full SDD ledger with all review findings (including 5 parked Minor
  items) at `.superpowers/sdd/2026-09-14-payroll-bonus-adjustment/progress.md`
  until the workspace is cleaned up per `finishing-a-development-branch`.

---

**2026-09-14 — PUSHED TO PROD.** User asked to run the R5/R6 pre-PROD
checklist, one blocker found (`git status` dirty — R9 stop condition),
user said "yes, commit and push": committed `db3b810` ("Count design and
QC hours equally in supervisor/PM bonus pools") covering the 5 files
changed this session, pushed to `origin/main` — confirmed `git status`
clean and `git log origin/main..HEAD` empty afterward. User then said
"npm run push:prod" directly — ran it, **169 files pushed to PROD**
11:10:31am, `.clasp.json` confirmed pointing to the PROD script ID
(`1HzRiDrQJ6z-BxPzk...`) after the push. Neither `PortalView.html` nor
`Portal.gs` touched this session, so no manual "New Version" redeploy
needed (R4.7 N/A).

**Post-deploy confirmation run (same day, 1:51-2:00pm) — fix verified
live in PROD, one new gap found and fixed:**

- First confirmation run (1:51pm) came back byte-for-byte IDENTICAL to
  the pre-fix numbers — investigated, found no actual problem (re-ran
  `npm run push:prod` again as a precaution, confirmed `PayrollEngine.gs`
  present in the pushed file list, no `.claspignore` exclusion); second
  run (1:55pm) showed the fix live. Root cause of the first stale-looking
  run not conclusively identified (Apps Script editor/propagation
  quirk suspected) — not investigated further since re-running resolved
  it; flag if it recurs.
- **BCH (Bharath) CONFIRMED: ₹7,987.50 = 319.5h — exact match to ground
  truth** (179.5 old + Rajkumar's 140).
- **SGO (Sarty) PM bonus CONFIRMED via direct computation
  (`PayrollEngine.buildPmBonusMap_`, dry-run tool doesn't cover PM):
  ₹54,843.75 = 2,193.75h** (1,933.75 old + Deb Sen's 120 QC + Rajkumar's
  140 QC — arithmetic checks out exactly).
- **New gap surfaced by the fix itself (not a code bug — same blind spot
  as Rajkumar's, now fixed):** pre-cutover gate went NOT CLEAN — 6
  unexpected blocked pairs, all Deb Sen's own personal hours (120h
  total across Matix-SK/Alberta Truss/Nelson, 100% QC, invisible under
  the old design-only formula same as Rajkumar's were). Had this not
  been fixed, `runBonusRun` would ABORT ENTIRELY (paying nobody, not
  just Deb Sen) the next time it's actually run. **FIXED 2026-09-14
  2:00pm** — user confirmed same pattern as Bharath's own-hours setup;
  ran `assignAccountSupervisor` for DBS→SGO on all 3 clients
  (Matix-SK, Alberta Truss, Nelson), all three confirmed
  `newRowCreated:true`.
- **Not yet re-verified:** need one more dry-run pass to confirm
  `unexpectedBlockedPairs: 0` again after this latest fix, before
  treating the picture as fully closed.

**Final re-verification DONE 2026-09-14 2:02pm — AUDIT FULLY CLOSED,
numbers locked.** Re-ran `tempConfirmAug2026BonusFix`:
- **`PRE-CUTOVER GATE: CLEAN — 0 unexpected blocked pairs`** confirmed.
- Deb Sen's 6 own-hours pairs now correctly appear in
  `skippedNonTeamLead` (rolling up to SGO, same as BCH's own-hours
  pattern) instead of `blockedPairs`. Her own `bonusMap` figure
  unchanged at ₹1,150 (46h, PRS+AR001) — correct, she is never credited
  for her own hours.
- **BCH final: ₹7,987.50 (319.5h)** — stable, exact match to ground
  truth.
- **SGO (PM) final: ₹54,843.75 (2,193.75h)** — stable.
- **DBS final: ₹1,150 (46h)** — unchanged, confirmed correct earlier
  this session, not touched.

**Not yet done:**
1. **PROD health verification** — per `testing-policy.md`, never run a
   test suite against PROD; the sanctioned checks (`runHealthCheck()`,
   confirm no new `HealthMonitor` alerts, portal loads, a real job
   round-trips) still haven't been run this session.
2. **The actual August correction — still not started.** Bharath's and
   Sarty's `FACT_PAYROLL_LEDGER` rows for 2026-08 are still sitting at
   their OLD (pre-fix) figures: BCH was ₹4,487.50 (needs to become
   ₹7,987.50, +₹3,500), SGO was ₹48,343.75 (needs to become ₹54,843.75,
   +₹6,500). None of today's `REF_ACCOUNT_SUPERVISION` data fixes or the
   code deploy retroactively rewrite already-written ledger rows. Needs
   an explicit adjustment event (Rule A5 — never an overwrite) once the
   user wants to proceed. Deb Sen's row is correct and must NOT be
   touched. No design for this adjustment mechanism has been discussed
   yet — next thing to work through with the user.

---

**2026-09-13, latest — PUSHED TO DEV.** User said "push to dev now" once
the manual-audit thread below fully closed (Rajkumar's `REF_ACCOUNT_SUPERVISION`
row applied in PROD, Deb Sen's number confirmed correct, no other open
questions). Pre-push: full Jest suite green (4,757 tests; same 2
pre-existing unrelated TS parse failures in vendored `code-review-graph/`
fixtures, untouched). Ran `npm run push:dev` → `cp .clasp.dev.json
.clasp.json && clasp push --force` → **169 files pushed successfully**
to the DEV Apps Script project. This carries everything from this
session: both design+QC-parity bonus changes (PM path `buildPmBonusMap_`,
TL path `buildSupervisorBonusMapByAccount_`) — the AR001
`ACCEPTED_UNSUPERVISED_PAIRS_` addition was added and then fully
reverted earlier this session, confirmed NOT present in what was pushed.

**Not yet done — explicit next steps:**
1. DEV smoke-test/verification (R10) — nothing run against DEV yet this
   turn to confirm the push landed correctly beyond the push command's
   own success output.
2. PROD push (`npm run push:prod`) — NOT done, only DEV. Needs R5/R6
   checklist + explicit user go-ahead separately; this session has not
   been asked to push PROD yet.
3. August `FACT_PAYROLL_LEDGER` adjustments for Bharath (his 179.5h
   supervised figure needs to become 319.5h once Rajkumar's 140h flows
   through) and Sarty/SGO (PM figure needs recomputing under the
   design+QC-parity rule) — existing rows are `PENDING_CONFIRMATION`,
   need an explicit adjustment event per Rule A5, not an overwrite. Not
   started — still waiting on this to be sequenced with the user. Deb
   Sen's row is confirmed correct and should NOT be touched.
4. Git commit — NOT done. Per this session's standing instruction, only
   commit when the user explicitly asks; nothing asked yet this session.
   Working tree still has the same 5 modified files as before the push
   (`.claude/rules/data-integrity.md`, `CTO_TASK_QUEUE.md`,
   `src/10-payroll/PayrollEngine.gs`,
   `tests/payroll-engine-pm-bonus.test.js`,
   `tests/payroll-engine-supervisor-bonus-by-account.test.js`).

---

**2026-09-13, later same session — user's manual audit surfaced 3 more
Aug 2026 discrepancies; DEV PUSH ON HOLD pending clarification, nothing
in this entry acted on yet.** User reported, verbatim as given (typos
kept for traceability): Priyanka "Design hours -28.75"; Deb Sen (DBS)
"Design 120 - Super Bonus - 28.75"; Bharath (BCH) "Design hrs -173 Sup
hours - 319.5". User's own theory: BCH/DBS's supervisor-bonus figures
are off because both supervise designers across MULTIPLE client
accounts; unsure why Priyanka's design hours differ.

**Ground-truth reading CONFIRMED by user 2026-09-13.** BCH (Bharath):
own design hours 173, supervised total 319.5 across his 2 accounts. DBS
(Deb Sen): own design hours 120, supervised total 28.75. PRS (Priyanka):
own design hours 28.75.

**Real dry-run pulled from PROD (`runSupervisorBonusByAccountDryRun('2026-08')`,
run by user 2026-09-13 11:40am) resolved most of this — two confirmed-
correct, one confirmed-fixed, one reopened:**

- **BCH's own 173 confirmed exactly correct, not a discrepancy at all:**
  his `skippedNonTeamLead` entries (NORSPAN-MB/ROOF_TRUSS 34.5 +
  SBS/ROOF_TRUSS 91.5 + SBS/FLOOR_TRUSS 47) sum to exactly 173.0 —
  matches the user's ground truth exactly. His own hours are correctly
  excluded from his own supervised total (a TL never supervises himself)
  and correctly still flow into SGO's PM bonus.
- **`blockedPairs` (123.0h total) confirmed as exactly SGO's own personal
  hours**, matching the original "123" figure from the very start of
  this audit. Correctly excluded from TL tier, correctly covered by
  `ACCEPTED_UNSUPERVISED_PAIRS_`, correctly still in the PM pool.
- **BCH's 140h shortfall (179.5 system vs 319.5 ground truth) — ROOT
  CAUSE FOUND: not a code bug, a missing `REF_ACCOUNT_SUPERVISION` row,
  now RESOLVED.** Cross-referencing the full per-designer/client/product
  breakdown (from a second, custom read-only diagnostic —
  `tempDiagBCHandDBS_Aug2026`, not a repo file, pasted into `temp.gs`)
  found `RKU` (Rajkumar) logged exactly 140.0h of 100%-QC hours on SBS
  (22.75 Floor Truss + 117.25 Roof Truss, 0 design) with **NO**
  `REF_ACCOUNT_SUPERVISION` row at all. **Explains why he was invisible
  in the dry-run** (not blocked, not skipped, not counted anywhere): PROD
  is still running the OLD `pairHours = design_hours`-only formula (the
  design+QC-parity fix below is local-only, not pushed) — his `pairHours`
  computed to 0 under that formula and got silently `continue`'d before
  ever reaching the supervision lookup. So no third TL's Aug bonus is
  currently inflated by his hours — they've never been credited to
  anyone. **User confirmed 2026-09-13: Rajkumar reports to Bharath.**
  **DONE 2026-09-13 12:11pm** — user ran
  `StaffOnboarding.assignAccountSupervisor('raj.nair@bluelotuscanada.ca', 'SBS', 'RKU', 'BCH', '2026-08-01')`
  in PROD, confirmed result `{"newRowCreated":true,"changed":true,"reason":"applied"}`.
  `REF_ACCOUNT_SUPERVISION` now correctly has SBS/RKU→BCH effective
  2026-08-01. This alone does NOT yet change Bharath's August bonus
  figure — `aggregateNetWorkLogHoursByAccount`/`buildSupervisorBonusMapByAccount_`
  still won't count Rajkumar's hours until the design+QC-parity code
  (below) is actually deployed and the bonus is re-run/adjusted; until
  then this is correct data sitting inert.
- **DBS's apparent 17.25h "overage" — CLOSED 2026-09-13, confirmed
  correct, no bug, no fix.** Went through a false start: user first said
  "exclude AR001" (code change made, then reverted same turn after user
  corrected "AR001 is reporting to Deb Sen so its correct" — confirmed
  via git diff, 137/137 affected tests green after revert;
  `PayrollEngine.gs` back to having only the two design+QC-parity
  changes). User then confirmed their manual "Super Bonus 28.75" figure
  never included Abhisek/AR001's Nelson hours in the first place — it
  was Priyanka-only. Full reconciliation: PRS 25.5+3.5=29.0h + AR001
  15+2=17.0h = **46.0h, an exact match to the system's ₹1,150.** 28.75
  (Priyanka-only, ground truth) + 17.0 (AR001, never tallied) = 45.75,
  landing right next to the system's 46.0 (same ~0.25h rounding gap seen
  elsewhere in this audit). **Deb Sen's ₹1,150 August bonus is correct
  as computed — do not adjust it, and do not re-add an AR001 exception
  to `ACCEPTED_UNSUPERVISED_PAIRS_`.**
- **PRS (Priyanka) 28.75 vs system 29.0 (25.5 + 3.5, Alberta Truss Roof+
  Floor Truss)** — 0.25h gap, almost certainly rounding in the manual
  tally, not a system error. Not pursued further as a standalone issue.
- Dropped: a nickname-collision hypothesis (`SARTY_DATA_`/
  `SartyReconAudit.gs`) considered and ruled out — that matching is
  internal to that one old audit script only; the real aggregation keys
  on `actor_code`/`designer_code`, never a nickname.

**Not yet done:** Rajkumar's `assignAccountSupervisor` call (above, not
yet run by user); DBS/AR001 question still open; DEV push still on hold
per user's explicit instruction; nothing pushed, nothing re-run against
real payroll data yet. August's already-written `FACT_PAYROLL_LEDGER`
bonus rows (BCH, DBS, SGO, SDA, SVN — all `PENDING_CONFIRMATION`) still
need an explicit adjustment event once the full, final set of
corrections is settled — not started, deliberately held until this
audit closes rather than corrected piecemeal.

---

**2026-09-13 — Sarty's (SGO, PM) Aug 2026 bonus AMOUNT questioned, then
baseline-error CONFIRMED (not a code bug).** User expected ₹56,450 (2,258
hrs = 2,381 total hours billed, minus SGO's own 123) vs. actual ₹48,343.75
(1,933.75 hrs). **User confirmed 2026-09-13: the 2,381 figure is
design+QC combined, not design-only.** That withdraws the 2,258 target —
it was never valid to compare against `buildPmBonusMap_`'s design-hours-
only formula (`src/10-payroll/PayrollEngine.gs:619-621,632`, flat
`INR 25 × Σ(design_hours)` for every non-PM `staffCache` member as-of
`2026-08-01`). Revised arithmetic: 2,381 (design+QC, all staff incl. SGO)
− 1,933.75 (design-only, non-PM, SGO's 123 already excluded by `:641`) =
447.25, of which SGO's own 123 accounts for part, leaving **~324.25 that
should be ≈ August `qc_hours` of non-PM staff** (Deb Sen's 120 QC hours,
already known from thread #0, is one piece of it).

- **Single discriminating check, not yet run (no Sheets/Apps Script
  access from this session):** total August `qc_hours` across non-PM
  staff in `aggregateHours_('2026-08')`. If ≈324.25 → ₹48,343.75 is
  correct, audit closes. If materially below → the shortfall is the
  `staffCache` silent-drop at `:642` (see next bullet), and only then is
  the `aggregateHours_` vs `buildStaffCache_` set-difference check worth
  running.
- **Real open question this surfaced — a spec decision, not a defect:**
  should the PM bonus pool include hours logged by QC-role staff? Code
  today says no (thread #0: QC/design classification is role-based, not
  work-type-based — may not match the user's "total team hours" mental
  model). If the answer should be yes, August is understated by
  `25 × (non-PM QC hours)` — roughly ₹8,100 if that lands near 324.25 —
  which is a bonus restatement + spec change, not a code fix. **Needs to
  be put to the user as a decision, not resolved unilaterally.**
- **Separate latent defect, independent of the above — report but don't
  treat as this month's explanation:** `buildPmBonusMap_` (`:635-644`)
  iterates `Object.keys(staffCache)`, looks up `hoursMap[code]`, and
  silently skips (`if (memberHours)`, no `else`, no log) anyone with Aug
  hours who isn't in `staffCache` as of `2026-08-01` (inactive, or
  `effective_from` after Aug 1 — e.g. someone onboarded mid-August).
  Contrast `buildSupervisorBonusMapByAccount_` (TL path only, `:433`),
  which pushes unattributable hours to `blockedPairs` and **aborts the
  whole run** (`:1270`) instead of silently dropping them. The PM path
  has no equivalent guard — worth fixing on its own merits.
- No code changed this session — did not touch `PayrollEngine.gs` (R9:
  payroll changes beyond approved scope require explicit stop-and-ask;
  this was audit-only, as requested).

---

**2026-09-12, later same session — August unified statements sent as a
one-off bridge.** Ran a hand-written (not the reviewed/tested thread #1
code) `dbgResendUnifiedAug2026Statements` script via `temp.gs`: read the
already-committed `FACT_PAYROLL_LEDGER` rows for `2026-08` (17
`PAYROLL_CALCULATED` + 5 `PAYROLL_BONUS_SUPERVISOR`) and sent HR 17
individual emails, each showing Design/QC hours+pay and, for the 5
supervisors, an added Supervisor Bonus line + Grand Total. All 17 sent
successfully (confirmed via Execution log, no skips); bonus additions
verified correct (e.g. SGO 61,500+48,343.75=109,843.75, DBS
42,000+1,150=43,150). **No FACT writes — read + email only, safe to
consider done.** HR still needs to forward each to the named person; staff
confirm; then CEO `approveAllPayroll` for `2026-08`. The *permanent* version
of this format (built into `PayrollEngine.gs` for all future months) is
still thread #1 below, untouched by this one-off send.

**2026-09-12 session, four open threads queued from the same session,
none started yet, not yet sequenced against each other:**
0. **QC vs Design hour classification is role-based, not workflow-based —
   RULE CHANGED AND IMPLEMENTED 2026-09-13 (code only — NOT deployed,
   NOT re-run against PROD data yet).** Superseded the "TEAM_LEAD QC
   only" framing from earlier the same day: **user's final rule (stated
   2026-09-13) is that design and QC hours are billed to clients equally,
   so the PM bonus pool must count both equally too, for every non-PM
   staff member regardless of role** (not just TEAM_LEADs) — minus the
   PM's own hours (design + QC), which the existing `role === 'PM'`
   filter already excludes as a whole person, so no separate handling
   was needed for that half of the rule.
   - **Implemented — PM path:** `buildPmBonusMap_`
     (`src/10-payroll/PayrollEngine.gs:632-657`) now sums
     `memberHours.design_hours + memberHours.qc_hours` (was: design_hours
     only) into what's now named `nonPmBillableHours`. Header comment
     (`:619-629`) rewritten to state the new rule.
   - **Implemented — TL path too (user confirmed 2026-09-13, same
     session):** `buildSupervisorBonusMapByAccount_`
     (`src/10-payroll/PayrollEngine.gs:433-553`, the function
     `runBonusRun` actually uses for TL bonus — the older non-account
     `buildSupervisorBonusMap_` is dead code in the real pipeline, not
     called from `runBonusRun`, left untouched) now computes
     `pairHours = pairBucket.design_hours + pairBucket.qc_hours` instead
     of `design_hours` alone (`:456-458`). Header comment (`:406-424`)
     updated with the same rule + user's own caveat: in practice this
     rarely changes anything, since regular designers essentially never
     log QC hours — only an actual QC_REVIEWER-role person does (e.g.
     Rajkumar today), and QC reviewers aren't usually counted as a TL's
     own team member. Kept for billing-parity consistency with the PM
     path regardless.
   - New regression test added:
     `tests/payroll-engine-supervisor-bonus-by-account.test.js` — a
     QC_REVIEWER-role designer with nonzero `qc_hours` now correctly
     adds to their TL's bonus pool (no prior test fixture in this file
     exercised nonzero `qc_hours` at all).
   - **Deliberately did NOT touch `aggregateNetWorkLogHours`/hour
     classification itself** — that split also drives
     `computePersonPay_`'s design-vs-QC-rate base pay math (`:340-341`),
     and Aug base pay is already confirmed/approved separately;
     re-bucketing there would retroactively change already-approved pay.
     Stamped FACT rows untouched either way (Rule A5).
   - **User noted 2026-09-13: `pay_design` == `pay_qc` for every
     TEAM_LEAD and QC_REVIEWER role** (not verified against live
     `DIM_STAFF_ROSTER` this session — user-stated fact, not
     independently confirmed). Relevant, not yet acted on: if true, it
     means reclassifying a TL's/QC reviewer's hours between design and
     QC buckets would NOT change their base pay at all for those two
     roles — the retroactive-base-pay risk flagged above doesn't apply
     to them specifically (may still apply to other roles with differing
     rates, not checked). Does NOT by itself imply the TL bonus path
     should now also count QC hours equally (that's still a separate,
     unasked-for decision) — but it does remove the main reason to be
     cautious about reclassification for these two roles if the user
     asks for that next.
   - **Tests updated and passing:** `tests/payroll-engine-pm-bonus.test.js`
     — one test asserting the old design-only behavior rewritten to
     assert the new combined behavior; full suite green (4,757 tests,
     the only 2 failing suites are pre-existing unrelated TS parse errors
     in the vendored `code-review-graph/` fixtures, untouched by this
     change).
   - **NOT done yet — explicit next steps, none authorized so far:**
     (1) DEV push + smoke test (R10 — this session made local/git changes
     only, no `clasp push` run); (2) re-running `runBonusRun('2026-08')`
     won't naturally correct SGO's figure — `hasEvent_`'s idempotency key
     (`PAYROLL_BONUS|SGO|2026-08`) already exists from the original run,
     so a plain re-run will skip him; a correction needs an explicit
     adjustment event per Rule A5, not an overwrite — sequence this with
     the user, don't design it unilaterally; (3) PROD deploy only after
     DEV verification, per standard R4/R10 flow. **Timing still favorable:**
     Aug bonus rows are still `PENDING_CONFIRMATION`,
     `approveAllPayroll('2026-08')` has not run.
   - Expected outcome once re-run against real Aug data: corrected PM
     bonus ≈ `48,343.75 + 25 × (Aug non-PM qc_hours)`, plausibly close to
     the user's original ₹56,450 expectation if their 123-hour figure for
     Sarty was his own total (design+QC) personal hours — not confirmed
     against live numbers yet, this session had no Sheets/Apps Script
     access.

   Original framing retained below for context:
   Today: `WorkLogHandler.gs:216` stamps `actor_role` from the submitter's
   OWN roster role at logging time; `aggregateNetWorkLogHours()`
   (`WorkLogAggregation.gs:70`) buckets 100% of a person's hours as QC
   only if their role is literally `QC`/`QC_REVIEWER` — there is NO
   per-entry "type of work" field, and job workflow state (e.g. a job
   sitting in a QC-review step) has zero influence on the classification
   (confirmed by reading `WorkLogHandler.gs`'s full `handle()` — job state
   is only checked to reject logging against closed jobs, `:293-305`).
   So a TEAM_LEAD/PM who spends time reviewing their team's work has that
   time counted as design hours, not QC — the system cannot track
   "time a supervisor spent on QC for their team" as a distinct thing
   today. User wants this scoped as a real feature later — needs its own
   design conversation (what workflow states should count, what happens
   to jobs that flip between design/QC repeatedly, etc.) before any code.
   Surfaced by investigating Deb Sen's Aug 0h-design/120h-QC split — that
   specific case is NOT a bug (her Aug work-log rows correctly, immutably
   reflect her real role at the time she logged, `QC_REVIEWER`; her
   `TEAM_LEAD` promotion was only backdated into the roster on 2026-09-10
   for pay-rate/bonus purposes, never rewriting historical FACT rows per
   Rule A5) — but it's a real latent risk for anyone else whose
   design/QC rates differ and whose role gets backdated across a period.
1. **Payout statement format rework (Option B, user-approved):** base pay
   email unchanged; when `runBonusRun` fires, supervisors get a full
   replacement statement (design + QC + bonus + grand total) instead of
   today's separate bonus-only email. Non-supervisors unaffected.
2. **Merged "Run Payroll + Run Bonus" portal button + bonus-aware confirm
   gate (user-approved).** One button: base pay runs first always: if it
   fails, stop. Bonus attempts second in its own try/catch — an
   `unexpectedBlockedPairs` abort must NOT roll back or block the already-
   committed base pay. `confirmPaystub`/`approveAllPayroll` must refuse to
   treat someone as confirmed if a `PAYROLL_BONUS_SUPERVISOR` row exists
   for the period with a timestamp AFTER their `PAYROLL_CONFIRMED` row.
   **Open question, not yet answered by user:** does "remove the other 2
   buttons" include Approve All Payroll, or just Run Payroll+Run Bonus?
   Assume NOT (Approve All stays separate/manual) until user confirms
   otherwise — it writes an irreversible `PAYROLL_PROCESSED` event.
   Touches `Portal.gs`+`PortalView.html` → needs a manual "New Version"
   redeploy after push, not just `npm run push:prod` (R4.7).
3. **D7 data-integrity rule added** (`.claude/rules/data-integrity.md`) —
   total PAID hours (design+QC combined) per designer/team lead per period
   must reconcile to total hours BILLED to the client for that person over
   that period. User confirmed this exact framing. Two concrete divergence
   risks already found between `PayrollEngine`'s hour aggregation and
   `ClientTimesheetEngine`'s: (a) orphaned job_numbers — paid but not
   billed; (b) unparseable `work_date` rows — same direction. **Doc-only so
   far — no automated enforcement gate built yet.** Next step, not yet
   started: an automated pre-payroll reconciliation check that aborts
   `runPayrollRun` on divergence, same pattern as `runBonusRun`'s existing
   `unexpectedBlockedPairs` abort (`PayrollEngine.gs:1270`).

**All three are separate workstreams — don't bundle into one worktree/PR.**
#3 is the largest (touches billing + payroll); sequence with the user
before starting any of them.

---

**2026-09-12 session — August 2026 supervisor/PM bonus run executed in
PROD.** User reported Sarty's (SGO, PM) August bonus missing. Investigated
two false leads first (SGO's `role` field — confirmed exactly `PM` on both
historical and current roster rows, not a bug; Deb Sen's carried-forward
350/hr `TEAM_LEAD` rate from her prior `QC_REVIEWER` row — user confirmed
350 is correct, no rate change needed) before finding the real cause:
`PayrollEngine.runBonusRun()` had simply never been invoked for `2026-08` —
only `runPayrollRun` (base pay) had run, and `sendPaystubEmail_`'s template
never includes bonus (bonus is a separate ledger row + separate email by
design). Re-ran `runSupervisorBonusByAccountDryRun('2026-08')` to confirm
no drift since the 2026-09-10 dry run (clean, `unexpectedBlockedPairs: 0`,
DBS still ₹1,150 for Roof Truss+Floor Truss only), then ran
`PayrollEngine.runBonusRun('raj.nair@bluelotuscanada.ca', {periodId:'2026-08'})`
for real in PROD via a pasted `temp.gs` wrapper. **Result: 5 processed,
INR 76,225 total** — SDA ₹8,550, SVN ₹13,693.75, BCH ₹4,487.50, DBS ₹1,150,
SGO (PM) ₹48,343.75. Bonus emails sent (routed to HR per
`PAYSTUB_ROUTE_TO_HR_`). No code changed this session — `git status` clean,
nothing to commit/push/deploy. **Next step, not yet done: HR needs to
forward the bonus emails, staff confirm via portal, then CEO
`approveAllPayroll` for 2026-08** (base pay was already confirmed/approved
separately, per Step 8 of the Phase 1.5 plan referenced below).

**2026-09-11 session, most recent first — all shipped to PROD except the
last item (committed, not yet pushed/deployed — pending: DEV smoke test
of the redesigned bulk version before pushing):**
- **"Send Test Paystubs (All)" button** (`worktree-bulk-test-paystub-to-hr`) — redesigned per direct user feedback after the DEV click-through: the first version (`worktree-test-paystub-hr-guard`, single person_code prompt) wasn't what was wanted — "this should be for all the team so that HR gets the email." Replaced with `PayrollEngine.sendAllTestPaystubEmails(actorEmail, periodId)`: fires a real paystub email for **every** person with hours in the period (same population `runPayrollRun` would process), no FACT write, repeatable. CEO tools cluster, confirm() names the period before sending (bulk, unlike the single-person version). Same `PAYSTUB_ROUTE_TO_HR_` refuse-if-false guard as the prior version, carried over — **when the `PAYSTUB_ROUTE_TO_HR_` flip below happens, this function needs its own deliberate decision too, not just a flag flip.**
- **My Hours panel collapsed by default**, deployed to PROD (`665e6e3`) — reuses the Invoiced tier panel's arrow/click-to-expand pattern; long periods (e.g. 2026-09) were rendering as one long open table. Search/filter force it open.
- **Individual paystub/bonus emails routed to HR for review**, deployed to PROD (`665e6e3`) — `PayrollEngine.gs`'s new `PAYSTUB_ROUTE_TO_HR_ = true` module constant (next to `SUPERVISOR_BONUS_INR`) sends every per-consultant paystub and per-supervisor bonus email to HR instead of the person, so HR can verify and forward manually while the new product-scoped bonus calc is being trusted. **Open follow-up, target ~December 2026 (3 payroll cycles): flip `PAYSTUB_ROUTE_TO_HR_` back to `false` once the numbers have been verified AND re-check `sendAllTestPaystubEmails` at the same time (it refuses to run while the flag is false — decide then whether to remove it, gate it differently, or leave it disabled)** — deliberately a code constant (reviewed/deployed like any other payroll change), not a Script Property or auto-expiring date, so it can't silently revert unnoticed either way. Don't let this vanish — nobody else will remember it.
- **Portal "Run Payroll" month-picker + review-surfacing**, deployed to PROD (`06ae207`) — Run Payroll/Run Bonus/Approve All Payroll now prompt for a period instead of always targeting "current period," and Run Payroll/Run Bonus show real preview numbers (staff/supervisor counts, unattributed-pair warnings) in the confirm dialog before committing. All three now reject a malformed period (regex `YYYY-MM` or blank) before reaching any run/approve call — added after independent review flagged `approveAllPayroll`'s new picker as the one place a typo could silently target the wrong month on an irreversible write. HR's access is still preview-only (`previewPayoutStatement`, unchanged); CEO-only commit is unchanged. `previewPayoutStatement()` gained an additive `options.silent` flag (default false) so the confirm-dialog preview fetch doesn't also fire HR's separate review email.
- **`buildSupervisorBonusMapByAccount_()`'s silent non-TEAM_LEAD skip made visible**, deployed to PROD (`dac9832`) — the PM-fallback skip rule (spec §4.5) was the only one of its three skip/block paths with no log/no return-value trace; now logged as `SUPERVISOR_BONUS_NON_TEAM_LEAD_SKIP` and surfaced in a new non-gating `skippedNonTeamLead` field (dry-run script + HR preview email), without changing the skip behavior itself.
- All PROD deploys above verified via `runHealthCheck()`/`runProdContaminationCheck()` post-deploy — clean.

---

**TASK RB-3.5 — Phase 1.5 (product-scoped account supervision) CODE
COMPLETE on both DEV and PROD, 2026-09-10. Schema is done on DEV, still
OPEN on PROD (corrected below — an earlier note in this section wrongly
marked PROD's schema done; see the correction dated later 2026-09-10).**
Deployed to PROD's Apps Script source 2026-09-10 (168 files, no
errors).** Built via subagent-driven-development in worktree
`.claude/worktrees/product-scoped-supervision` (branch
`worktree-product-scoped-supervision`): 7 tasks, 1 fix round on 3 of them,
1 final whole-branch review (2 Important + 6 Minor findings, all fixed in
one bundled wave, re-reviewed clean). 651/651 tests passing (48 suites),
re-verified fresh in the primary checkout right before deploy. Merged to
`main` and pushed to `origin/main` (`d80e965`) before the PROD push — see
`.claude/worktrees/product-scoped-supervision/.superpowers/sdd/2026-09-10-product-scoped-supervision-phase1.5/progress.md`
for the full task-by-task ledger, and
`docs/superpowers/plans/2026-09-10-product-scoped-supervision-phase1.5.md`
(Task 8) for the plan this executed.
**What shipped:** `StaffOnboarding.changeRole()` (new, mirrors
`changeSupervisor()`'s SCD-2 shape); `product_code` added as an optional
6th param on `assignAccountSupervisor()` (blank = wildcard, existing
callers unaffected); `REF_ACCOUNT_SUPERVISION` schema-patch script
(`runPatchAccountSupervisionSchema()`, not yet executed against either
sheet — see below); `buildJobToClientMap_()` renamed to
`buildJobToClientProductMap_()` (now returns `{client_code, product_code}`
per job); `aggregateNetWorkLogHoursByAccount()` now buckets by product too;
`buildSupervisorBonusMapByAccount_()` rewritten for exact-product-wins-
over-wildcard matching, still hard-throws on genuine ambiguity, still
surfaces zero-match as a visible blocked pair; new
`filterUnexpectedBlockedPairs_()` gate (accepted-exceptions list is a plain
code constant, not a table, per explicit user choice this session).
**2026-09-10, later same day:** discovered DEV's Apps Script project had
never received Phase 1 OR Phase 1.5 (only PROD had been pushed to) — user
found this by checking DEV's `StaffOnboarding.gs` directly (ended at
`changeSupervisor()`, no `assignAccountSupervisor`/`changeRole` at all).
Confirmed via `clasp pull` against both `.clasp.dev.json` and
`.clasp.prod.json` scriptIds independently (not cached) that PROD's live
source was correct (1563-line `StaffOnboarding.gs`, byte-identical to git
HEAD) and DEV's was stale. Ran `npm run push:dev` — 168 files, clean. DEV's
only prior divergence from `main` was one disposable 4-line scratch file
(`src/test.js`, leftover one-off verification for the already-closed
feedback-status-RBAC fix) — lost on push as expected, nothing of value.
DEV and PROD now both match current `main`.

**Schema setup — DEV done 2026-09-10.** DEV's `REF_ACCOUNT_SUPERVISION`
tab never existed at all (only PROD had it, from Phase 1) — running
`runPatchAccountSupervisionSchema()` there just no-op'd ("sheet not
found"). Ran `runSetupSchemas()` instead (`src/setup/SetupScript.gs:1303`)
— safe/idempotent (`ensureTab_`/`ensureHeaders_` only ever create missing
tabs/headers, never touch existing content), created the tab with
`product_code` already in its header (baked into current `SCHEMAS`), plus
9 unrelated `FACT_*|2026-09` partitions DEV was simply behind on.

**CORRECTION, later 2026-09-10 — PROD schema WAS NOT done at the time,
NOW IS, verified twice.** The "SKIP — already has product_code" result
logged earlier turned out to be from re-running the patch in **DEV**
(already patched via `runSetupSchemas()` minutes earlier), not PROD — a
tab mix-up, caught by the user directly dumping PROD's real header via a
temporary `dbgDumpAccountSupervision()` function (script ID confirmed
matching `.clasp.prod.json`: `1HzRiDrQJ6z-BxPzk-MHgm4pUb5enabsEA9Hg16OoRzpOhGjv9FyeiQQ0`).
That first dump showed PROD's real (unpatched) header: `lastRow=1
lastCol=6`, `["client_code","designer_code","supervisor_code",
"effective_from","effective_to","notes"]`. Ran
`runPatchAccountSupervisionSchema()` for real against PROD this time —
logged `PATCHED REF_ACCOUNT_SUPERVISION — added product_code column`.
**Re-verified with a second direct dump** (not just trusting the log,
given the earlier mismatch): `lastRow=1 lastCol=7`,
`["client_code","designer_code","supervisor_code","effective_from",
"effective_to","notes","product_code"]` — column genuinely present,
table still empty (no pre-existing rows, as expected). Note:
`product_code` landed appended at the end, not in DEV's canonical
position (`insertColumnAfter`, not a full rewrite) — harmless, DAL is
header-keyed not position-keyed, just a cosmetic DEV/PROD difference.
**Task 8 of the Phase 1.5 plan is now genuinely complete: code + schema,
both DEV and PROD, independently verified.** No New Version redeploy
needed — this branch touched zero `PortalView.html`/`Portal.gs` files.

**August 2026 real-data backfill worklist — derived 2026-09-10 from
running the dry-run tool against real PROD `FACT_WORK_LOGS` data (empty
`REF_ACCOUNT_SUPERVISION` table, so every real bucket shows up as
blocked — see the dry-run's own log for the raw 34-line output this was
grouped from). Corrects the earlier "15-row backfill" assumption from
the design spec: the real August data has 15 distinct designers, but 3
of them work multiple accounts (needing a separate supervision row per
account each — this is in fact exactly why account-scoping matters for
them) and 2 need product-split rows, so the real backfill needs MORE
than 15 rows once modeled correctly. NOT YET WRITTEN to PROD — this is
the worklist, not the completed backfill.**

Known — Deb Sen's product-scoped rows (4 rows, `effective_from
2026-08-01`, per the 2026-09-10 design spec's whole reason for
existing):

| client_code | product_code | designer_code | supervisor_code |
|---|---|---|---|
| ALBERTA TRUSS | ROOF_TRUSS | PRS | DBS |
| ALBERTA TRUSS | FLOOR_TRUSS | PRS | DBS |
| NELSON | ROOF_TRUSS | AR001 | DBS |
| NELSON | FLOOR_TRUSS | AR001 | DBS |

(FLOOR_JOIST for PRS/AR001 deliberately stays unsupervised — already on
`ACCEPTED_UNSUPERVISED_PAIRS_`, `PayrollEngine.gs:523-529`.)

Multi-account designers — need one row per account, real supervisor per
account NOT YET CONFIRMED (their `DIM_STAFF_ROSTER.supervisor_code` only
gives one flat value across all accounts, not useful here — has to be
confirmed manually per account):

| designer_code | accounts needing separate rows |
|---|---|
| BCH | NORSPAN-MB, SBS |
| DBG | MATIX-SK, SBS |
| SGO | ALBERTA TRUSS, MATIX-SK, SBS, NELSON |

Single-account designers — one wildcard (blank `product_code`) row each
expected, supervisor likely = their current
`DIM_STAFF_ROSTER.supervisor_code`, NOT YET CONFIRMED against that
sheet: PBG, JYS, VKV, RKG, BIT, SDA, MARV, ABB, SYR, SVN (all single
real-August-hours account each, mostly SBS; VKV/RKG on NORSPAN-MB).

**Worklist fully resolved 2026-09-10, with user.** Real PROD
`DIM_STAFF_ROSTER` dump reviewed (confirmed real staff + inactive
legacy/DEV-test rows, not a contamination issue). Found and resolved a
real silent-failure risk `filterUnexpectedBlockedPairs_` cannot catch:
`buildSupervisorBonusMapByAccount_` silently pays ₹0 (no bonus, no
blocked-pair flag) for any pair whose resolved supervisor isn't role
`TEAM_LEAD` — several designers' flat roster `supervisor_code` is `SGO`
(role `PM`), which would have silently zeroed real bonus amounts if
backfilled naively. Resolved explicitly with the user, pair by pair:
- **SVN, SDA (own hours), DBG, BCH (own hours)** — `SGO` is genuinely
  the right value on their `REF_ACCOUNT_SUPERVISION` row; user confirmed
  this is an intentional ₹0 at the TEAM_LEAD tier, already covered by
  SGO's separate flat PM bonus.
- **SGO's own hours** (4 accounts, 123.5h) — no row at all; SGO is
  himself the PM, `buildPmBonusMap_` already excludes PM-role staff from
  its own sum, so his own hours get NO bonus at any tier, by design.
  Added as 7 new entries to `ACCEPTED_UNSUPERVISED_PAIRS_`
  (`PayrollEngine.gs`, commit `8018715`) so the pre-cutover gate treats
  this as a known, reviewed gap rather than failing on it. Independent
  code review: clean (see below). Deployed + independently verified on
  both DEV and PROD.

**Final 18-row `REF_ACCOUNT_SUPERVISION` backfill, all
`effective_from = '2026-08-01'`, NOT YET WRITTEN:**

| client_code | product_code | designer_code | supervisor_code |
|---|---|---|---|
| ALBERTA TRUSS | ROOF_TRUSS | PRS | DBS |
| ALBERTA TRUSS | FLOOR_TRUSS | PRS | DBS |
| NELSON | ROOF_TRUSS | AR001 | DBS |
| NELSON | FLOOR_TRUSS | AR001 | DBS |
| SBS | (blank) | PBG | SDA |
| SBS | (blank) | JYS | SVN |
| NORSPAN-MB | (blank) | VKV | BCH |
| NORSPAN-MB | (blank) | RKG | BCH |
| SBS | (blank) | BIT | SVN |
| SBS | (blank) | MARV | BCH |
| SBS | (blank) | ABB | SVN |
| SBS | (blank) | SYR | SDA |
| SBS | (blank) | SDA | SGO |
| SBS | (blank) | SVN | SGO |
| MATIX-SK | (blank) | DBG | SGO |
| SBS | (blank) | DBG | SGO |
| NORSPAN-MB | (blank) | BCH | SGO |
| SBS | (blank) | BCH | SGO |

The 4 `PRS`/`AR001` rows are contingent on Step 4 (`changeRole` for
`DBS` → `TEAM_LEAD`) actually running — until then they'd also silently
zero, same mechanism.

**BACKFILL WRITTEN AND VERIFIED CLEAN, 2026-09-10, in PROD.** Ran the
role change + all 18 rows via a single pasted script; every row logged
`changed: true, reason: "applied"` (all genuinely new, no conflicts).
Re-ran `runSupervisorBonusByAccountDryRun('2026-08')` against real PROD
data to confirm, not just trusted the write log:
- `bonusMap`: exactly the 4 expected real TEAM_LEADs — `BCH` ₹4,487.50,
  `DBS` ₹1,150 (confirms her role change actually took effect — she's
  getting real bonus, not a silent zero), `SDA` ₹8,550, `SVN` ₹13,693.75.
- `blockedPairs` (7): exactly SGO's own hours, as intended.
- `unexpectedBlockedPairs`: **0. PRE-CUTOVER GATE: CLEAN.**

**Step 7 (the cutover) — CODE COMPLETE 2026-09-11, commits `37f61ed` +
`4b38723`, NOT YET DEPLOYED.** `runBonusRun`/`previewPayoutStatement`
now call `buildSupervisorBonusMapByAccount_` instead of the old flat
`buildSupervisorBonusMap_`. Design reviewed by advisor before writing
(asymmetric abort: `runBonusRun` refuses to write on any unexpected
blocked pair; `previewPayoutStatement` surfaces the list instead of
throwing). Independent review on the most capable available model
(opus) — thorough, found:
- **1 Critical (C1), resolved with existing evidence, not a code
  change tonight:** `buildSupervisorBonusMapByAccount_:509`'s
  `role !== 'TEAM_LEAD'` check silently skips (no blocked-pair entry,
  no warning) rather than blocking — different from the "no row found"
  case. Reviewer's worry: if Deb Sen's role change hadn't taken effect
  by `asOfDate=2026-08-01`, her rows would silently pay ₹0 invisibly.
  **Resolved**: the dry-run log already on record explicitly shows
  `asOfDate: 2026-08-01` and `DBS: INR 1150` — direct proof her role
  change had taken effect by that date, using the identical function.
  **Real, permanent, NOT fixed tonight**: this silent-skip mechanism is
  also what the 6 intentional `SGO`-as-supervisor rows (SDA/SVN/DBG×2/
  BCH×2's own hours) rely on by design — fixing it properly means
  updating `ACCEPTED_UNSUPERVISED_PAIRS_` to also cover those 6, which
  reopens already-shipped, already-reviewed code. Flagged as a
  follow-up, not blocking.
- **3 Important**, 2 closed same-session (added `ensurePartition`
  spy-not-called assertion to the abort test; added an end-to-end test
  proving an accepted-exception blocked pair does NOT abort the run —
  the actual August 2026 shape, previously only tested in isolation).
  One genuinely operational and NOT yet acted on: **the portal's "Run
  Payroll"/bonus buttons always use the CURRENT period
  (`Identifiers.generateCurrentPeriodId()`) — August 2026 CANNOT be run
  from the portal.** Must invoke
  `PayrollEngine.runBonusRun('raj.nair@bluelotuscanada.ca', { periodId: '2026-08' })`
  directly from the Apps Script editor.
- Minor/optional (not blocking): accepted blocked pairs (the known
  7 SGO ones) don't appear in the HR summary email, only in `_SYS_LOGS`
  — worth a future follow-up, not tonight.

**Deploy pending user go-ahead.** Once deployed (DEV+PROD, same
tab-closed + independent-verify precaution as every other push
tonight): Step 8, generate August stubs, via the editor call above —
NOT the portal button.

**Read-only dry-run tool added and deployed 2026-09-10:**
`runSupervisorBonusByAccountDryRun(periodId, asOfDate)`
(`src/12-migration/SupervisorBonusByAccountDryRun.gs:54`) — previews
`blockedPairs` against real `FACT_WORK_LOGS` data for a period, ahead of
the backfill/cutover (Task 8 Step 6). Mirrors `AggregationFixDryRun.gs`'s
read-only pattern, reuses `PayrollEngine`'s already-exposed helpers
(no logic duplication). Independent code review: clean, no
Critical/Important findings. TDD: 6/6 new tests, full suite 657/657.
Hit the same editor-tab-autosave-reverts-a-push bug documented in
`SESSION_LOG.md`'s 2026-08-31 entry (a stale open `test.gs` tab silently
wiped the pushed file from DEV, twice) — resolved by closing all editor
tabs before pushing and independently verifying via a scratch `clasp
pull` after each push, both DEV and PROD. Live-verified in DEV against a
real GAS runtime: ran clean against real `FACT_WORK_LOGS` data (1 row,
`TEST-CLIENT`/`A26D1` — DEV's own leftover synthetic test data, correctly
shown as a blocked pair since DEV's `REF_ACCOUNT_SUPERVISION` is empty).
Independently confirmed present on PROD via a fresh `clasp pull` (113
lines, byte match) after deploy.

**Blank-product-code check for August, run against PROD 2026-09-10:**
`runBlankProductAudit('2026-08A')` and `('2026-08B')` both returned 0 —
zero SBS/Norspan jobs with blank `product_code` in August (scoped to just
those two accounts, per that script's own design — other backfill
accounts like Alberta Truss/Nelson/Matix-SK aren't covered by this
audit). One risk item from the plan is cleared for August specifically.

Deliberately **NOT** part
of this task, per the plan's own Step 6 (same separation as Phase 1): Deb
Sen's `changeRole` call, the 15-row `assignAccountSupervisor` backfill from
spec §9, reviewing `blockedPairs` against real August 2026 data, and the
actual `runBonusRun`/`previewPayoutStatement` cutover.

**TASK RB-3 — rate corrections CLOSED 2026-09-08; Phase 1 of the
account-supervision redesign CLOSED and LIVE in PROD 2026-09-09; Phase 2
and the real-data backfill are the next open items.** The 7 HR-confirmed
rate corrections (effective 2026-07-01) are shipped, verified, and live in
PROD — see EPIC below. Still outstanding, and NOT part of this task:
re-running the August billing/payroll dry-run.
Separately, investigating this surfaced two real payroll-rules problems
that led to a full architectural design conversation (brainstorming skill,
full process) and, now, a completed Phase 1 implementation: (1) TEAM_LEAD
supervisor bonus has no account-scoping — live example, Pabitra Ghosh was
credited ~₹2,381 for Priyanka S's hours on Alberta Truss, an account he has
nothing to do with; (2) `QC_REVIEWER` role alias never reaches `actor.role`,
so QC reviewers' hours misclassify as design_hours (was financially silent,
one-rate model confirmed company-wide — now fixed, see below).

**Phase 1 shipped 2026-09-09** (subagent-driven-development, 6 tasks + 1
fix-round + 1 final-review fix-round, all task-reviewed, one whole-branch
review): new `REF_ACCOUNT_SUPERVISION` table (provisioned in PROD, verified
empty with correct headers), `StaffOnboarding.assignAccountSupervisor()`,
the `WorkLogAggregation.gs` QC_REVIEWER classification fix,
`aggregateNetWorkLogHoursByAccount()`, `PayrollEngine.buildJobToClientMap_()`,
and `PayrollEngine.buildSupervisorBonusMapByAccount_()` (the new per-account
bonus calc) — merged to `main` (`ff36fd0`) and deployed to PROD. **The new
calc is deliberately NOT wired into `runBonusRun`/`previewPayoutStatement`
yet** — those still call the old, flat, company-wide function, byte-for-byte
untouched, verified independently by two separate reviewers reading the
source directly (not just the diff). Full detail, including one real
Important bug the review process caught and fixed before merge (an
unresolvable `supervisor_code` — e.g. a sheet typo — was silently
indistinguishable from the intentional PM-skip case; now logged and blocked,
visible), is in the design spec and implementation plan:
`docs/superpowers/specs/2026-09-08-payout-supervision-redesign-design.md`,
`docs/superpowers/plans/2026-09-08-payout-supervision-redesign-phase1.md`.

**Next, blocking, human action — not an engineering task:** back-fill
`REF_ACCOUNT_SUPERVISION` with every active designer's real, current
account/supervisor pairing, via `StaffOnboarding.assignAccountSupervisor()`
called directly in the Apps Script editor (no portal UI yet — that's
Phase 2). The table starts empty; until this is done, a real-data
preview run of `buildSupervisorBonusMapByAccount_` would show every pair
as blocked. Only once `blockedPairs` comes back empty against real PROD
data should `runBonusRun`/`previewPayoutStatement` be switched over to the
new calculation — a small, separate, deliberately-not-yet-done cutover
task once the backfill is verified. Phase 2 (the CEO/HR self-service
portal panel) is planned after that. Design spec written and committed:
`docs/superpowers/specs/2026-09-08-payout-supervision-redesign-design.md`
— new `REF_ACCOUNT_SUPERVISION` table, per-account bonus rewrite, a
role-based PM-fallback skip rule (verified Sarty holds exactly one active
role so this is safe), new `STAFF_PAYOUT_ADMIN` RBAC action, and a Phase 2
CEO/HR self-service portal panel. **Awaiting user's review of the written
spec before moving to an implementation plan — no code written for this
part yet.** A CAD-denominated per-account profitability calculator was also
requested and is explicitly sequenced after this design closes.

**TASK RB-2 — fully CLOSED 2026-09-08, including both real corrections.**
Root cause for the August payroll/HR-invoice discrepancy fully diagnosed
(rate staleness for 7 staff, still pending HR confirmation — untouched;
2 confirmed duplicate work-log entries — Sarty Gosh, Abhisek Rit — both
fixed). WORK_LOG_CORRECTION_ADMIN carve-out shipped to PROD across two
merge batches (aa94a66, then d3ae6e1) with 4 review cycles total, each
finding something real — see EPIC above for the full list. Both PROD
pushes redeployed (New Version) by the user.
Discovered at execution time that the portal's "My Hours" view can't
browse past periods at all (hardcoded to current period) — worked around
by submitting both corrections directly into the same queue path the
portal's Void button uses, not by scripting around the handler. Both
verified correct by re-reading FACT_WORK_LOGS.
**Next action:** re-run the August billing/payroll dry-run to check where
things stand now that both duplicates are fixed — rate corrections for
the other 7 staff are still outstanding and pending HR, so August payroll
still shouldn't be committed yet. Two logged follow-ups, not started
(AMEND/REASSIGN event_id disambiguation; My Hours past-period browsing) —
don't pick either up without the user asking, they're deliberately
deferred, not forgotten.
**Earlier this session, unrelated:** TASK NEW-4 (payout-run review) and
TASK NEW-6/NEW-7 (staff status maintenance, paystub→HR review) remain
exactly where they were — not started, not touched this turn.

**TASK NEW-3 (timesheet automation) — CLOSED, 2026-09-02/03.** Per-client
PreBillingGate isolation in `ClientTimesheetEngine.gs` (one client's data
issue no longer blocks everyone's timesheet) + new on-demand
"🧾 Generate Client Timesheets" portal button, RBAC-gated on
`TIMESHEET_GENERATE`. Built via strict TDD (559 tests), code-reviewed
(1 real bug found/fixed: blank `client_code` defaulting mismatch that
would have silently let a flagged job through unskipped), DEV-verified
live by user (full round trip confirmed working; zero clients generated
in the test run was a DEV data-availability gap, not a bug). Merged to
`main` via fast-forward push to `origin/main` (commit `4111793`) — worktree
sessions can't touch the primary checkout directly, so this and all
subsequent merges in this session used `git push origin HEAD:main`
instead of a local merge. Full history: `git log -p` on this file before
2026-09-03, or `git log 9ae6eb4..4111793`.
**Non-incident closed alongside this:** DEV payout-statement preview
showed 3 test-fixture staff (`A26D1`/`PMBT1`/`PMCONF1`) mixed into real
entries — confirmed DEV-only (not PROD) and preview-only (no FACT write),
so this was expected seeded test data, not R10.8 contamination.

---

**TASK RB-1 (getFeedbackStatus RBAC bug) — CLOSED, 2026-09-03. Merged to
main, NOT yet deployed to PROD.** Found incidentally while diagnosing
TASK NEW-4 (user pasted an unrelated PROD execution-log error while
looking for a different diagnostic's output). Real bug:
`ClientFeedback.getFeedbackStatus()` (`src/09-feedback/ClientFeedback.gs`)
gated on `RBAC.ACTIONS.PAYROLL_RUN` (CEO-only) instead of a permission
TEAM_LEAD/PM also hold, contradicting its own JSDoc ("CEO/PM/TL only") —
confirmed live-blocking a real TEAM_LEAD (Samar Kumar Das) in PROD.
**Fix:** added `RBAC.ACTIONS.FEEDBACK_VIEW` to `RBAC.gs` (true for
CEO/PM/TEAM_LEAD/ADMIN/SYSTEM, modeled on `getLeaderDashboard()`'s
identical visibility tier — added to all 9 roles' `PERMISSION_MATRIX`
rows), switched `getFeedbackStatus()` to use it. TDD'd (new test file
`tests/client-feedback-status-rbac.test.js`, 4 tests, RED reproduced the
exact real incident) — 563/563 tests green, zero regressions. Code
review: no critical/important findings; one minor nit (stale JSDoc role
lists) fixed same-session. DEV-verified live by user via a direct
`ClientFeedback.getFeedbackStatus()` call as the TEAM_LEAD test identity
— confirmed working. Merged to `main` (fast-forward push, commit
`d7eea8f`). **`npm run push:prod` not yet run — needs explicit go-ahead**
since this is a live PROD bug fix, not routine feature work; ask before
deploying.

---

**TASK CF-1 — CLOSED, 2026-09-01.** PROD deploy reversion incident
resolved; Nelson Lumber + 3 more real responses (Alberta Truss, MATIX-SK,
SBS, all Q1 2026 — 13 designer rows total) backfilled and verified
correct; all 65 confirmed-safe orphan forms trashed (65/65, 0 failures,
post-trash count matched expectation exactly). Full detail in the CF-1
section below, kept for reference — nothing further to action.


**IMPORTANT — PROD is in a split state as of 2026-08-28, read before touching Portal.gs/PortalView.html or the Apps Script editor.**
`npm run push:prod` was run 2026-08-28 with user approval for Payout Statement (TASK NEW-1) + QC findings-picker (PR #21, W2-3) — **but PROD's Apps Script *source* also picked up the SOP upload workflow (PR #22, TASK W2-4)**, because that branch was already merged into `main` (confirmed: merge commit `c0835de` is an ancestor of current `main` — the task queue's prior claim that W2-4 was "NOT yet merged" was stale/wrong, corrected below) and `clasp push --force` pushes the whole `src/` tree, not per-feature. **The user explicitly chose NOT to do the "New Version" redeploy yet** — PROD's live `/exec` URL is still serving the old version (`0014b58`, 2026-08-10) and nothing user-facing has changed.
**CORRECTION, same day:** W2-4 does NOT need a live-DEV verification pass — that already happened in full on 2026-08-14 (see `SESSION_LOG.md`'s 2026-08-14 entry and the corrected W2-4 line below; an earlier note in this file claiming otherwise was itself stale and has been fixed). What's actually still open before the New Version redeploy is PROD-side one-time setup (`runSetupSchemas()`, `runGenerateSopReviewSecret()`, confirming PROD's web-app access setting, the `PLATE_ERROR` PROD data fix) — see W2-4 below for the full list.
**Next step:** run the W2-4 PROD-setup checklist below, get explicit go-ahead, then do the New Version redeploy for all three bundled features at once (they can't be un-bundled from PROD's source at this point without a separate targeted push).

---

**NEW THREAD, 2026-09-01 — PROD Script Properties quota, root cause in IdempotencyEngine (TASK PQ-1). ACTIVE, mid-investigation, nothing purged or deleted yet.**
`diagnosePropertiesQuota()` run against PROD: 12,081 properties, ~524,258 bytes by the
script's own UTF-16-length accounting, against Apps Script's documented 500KB
(512,000-byte) hard total-storage limit for PropertiesService (source:
https://developers.google.com/apps-script/guides/services/quotas). **Not yet
independently confirmed as an active "store is full" incident** — the script's
own byte math may not match Google's internal accounting; a write-probe and a
`_SYS_LOGS` check (below) are needed before treating this as more than "near
the limit."

**Root cause:** `IdempotencyEngine.checkAndMark()`
(`src/03-infrastructure/IdempotencyEngine.gs:29`) writes a permanent
`IDEM_<key>` Script Property for every processed job/work-log/QC event and
never expires or bulk-cleans them. Only `clear(key)` (line 60) removes one,
and only on a handler retry — not routine cleanup. Breakdown: `IDEM_WORK`
1,180 / `IDEM_QC` 913 / `IDEM_JOB` 568 / `IDEM_TEST` 155 / `IDEM_MIGRATED` 121
/ `IDEM_ORPHAN` 53 / `IDEM_PERF` 37 / `IDEM_WL` 20 (all ongoing, still
growing) + **~8,948 near-unique `IDEM_MIGR-WL-*` keys** — one-time historical
migration idempotency markers; those migrations are done and will never
replay, so these are pure permanent cruft, roughly 70% of total bytes.
`FEEDBACK_FORM` = 13, matching CF-1's "13 live forms" exactly — confirms this
run was against the same PROD store CF-1 investigated.

**Real-but-unverified risk:** if the store is actually full, any new
`props.setProperty()` write (including new `IDEM_*` keys) may be silently
failing — `checkAndMark()`'s catch block (lines 44-48) logs
`IDEMPOTENCY_STORE_FULL` and returns `true` (treats as non-duplicate), which
would mean new duplicate submissions aren't currently being caught. The read
path (line 37) is unaffected — existing keys still dedupe fine; exposure
would be limited to events first seen after the store filled, not
"idempotency is off" globally.

**Flagged separately — do NOT sweep into the delete set:** `IDEM_TEST` (155
keys) is test-idempotency data sitting in PROD's live Properties store. Per
R10.8 this class of finding is a stop-work condition (same root-cause
pattern as the 2026-07-08 incident `testing-policy.md` exists to prevent) —
needs its own explanation, not just deletion. **Must be exported (key+value)
before any purge** — both to preserve evidence of when/how it got there and
because purging destroys that evidence.

**CORRECTION, same day — the write-probe result above was misleading, NOT
resolved as "nearing limit only."** `_SYS_LOGS` (ground truth, not a
point-in-time probe) shows **2,705 `IDEMPOTENCY_STORE_FULL` failures since
2026-07-22T06:18:13Z, most recent 2026-09-01T18:21:08Z (hours before this
check)** — the store has been intermittently hovering at/over the 512,000-
byte limit for ~6 weeks, not a new development. A point-in-time write-probe
can succeed even when the store fails moments later — it isn't the
authoritative signal, `_SYS_LOGS` is.

**Actual blast radius is narrower than 2,705, still unmeasured.** A failed
mark does NOT by itself create a duplicate FACT row — `checkAndMark()`
returning `true` just means that one event processed correctly, once, with
no dedup marker persisted. A duplicate only materializes if that exact same
`idempotency_key` is delivered again later and finds no marker. **Real harm
must be measured directly in `FACT_WORK_LOGS`/`FACT_JOB_EVENTS`** (group by
`idempotency_key`, count > 1, since 2026-07-22) — not inferred from the
2,705 figure. Audit script pending, results not yet in.

**Next steps, in order:**
1. ✅ **DONE 2026-09-01** — write-probe succeeded (store had headroom at
   that instant) — **superseded by the `_SYS_LOGS` finding above, do not
   rely on this result for incident framing.**
2. ✅ **DONE 2026-09-01** — `_SYS_LOGS` check: 2,705 `IDEMPOTENCY_STORE_FULL`
   entries, 2026-07-22 → 2026-09-01 (ongoing, see correction above).
3. ✅ **DONE 2026-09-01** — 155 `IDEM_TEST` keys exported (name+value) to a
   Drive file before any purge touches the store. **This unblocks the
   purge** (`IDEM_TEST` itself is explicitly excluded from the delete set —
   real explanation for test data in PROD's Properties store still owed,
   separate from this cleanup).
3b. ✅ **DONE 2026-09-01 — CLEAN.** Duplicate-`idempotency_key` audit
    against `FACT_WORK_LOGS`/`FACT_JOB_EVENTS`, July-Sept 2026 partitions:
    **0 duplicate keys in either table** (2,132 distinct keys in
    FACT_WORK_LOGS, 2,307 in FACT_JOB_EVENTS, none appearing more than
    once). **Confirms none of the 2,705 failed idempotency marks ever
    resulted in an actual duplicate FACT row** — no data remediation
    workstream needed behind this finding. Only the storage cleanup below
    remains.
4. ⏸️ **PAUSED before deletion, 2026-09-01 — user asked to re-check with
   advisor first, which caught a real problem.** `previewIdemMigrKeyPurge()`
   confirmed exact count = **4,184** keys matching `IDEM_MIGR-WL-` (fewer
   than the rough ~8,948 upper-bound estimate from the original diagnostic —
   that number included other prefixes too). **NOT all 4,184 are safe to
   delete — batch tags matter.** Traced `MigrationReplayEngine.gs` +
   importer files directly and confirmed:
   - `BATCH-001` = default/general cutover batch
     (`MigrationConfig.CURRENT_BATCH`)
   - `BATCH-002` = `MayTimesheetImporter.gs`
   - `BATCH-003` = `Q1TimesheetImporter.gs` — task queue's own "raw Q1
     `FACT_WORK_LOGS` dedup... still uncleaned" note means this isn't
     fully closed out either, some caution warranted
   - **`BATCH-004` = `JuneWorkLogImporter.gs` — ACTIVELY BEING RECONCILED,
     DO NOT PURGE.** That file contains live `BATCH-004-HOURS-FIX`
     correction functions explicitly referencing "BATCH-004 idempotency
     gaps" — matches the task queue's own open "June billing... status
     not rechecked recently" item. These markers are still load-bearing.
   - **Why it matters even though `MigrationReplayEngine.gs:375`'s
     `replay_status='REPLAYED'` sheet flag is the primary duplicate
     guard** (checked before the handler runs at all): `batchMarkReplayed_()`
     has a try/catch that logs and swallows a write failure rather than
     throwing — if that sheet flag ever silently failed to get set for a
     row, the `IDEM_MIGR-WL-*` Script Property is the ONLY remaining
     guard against a duplicate `FACT_WORK_LOGS` row on a future re-run of
     that batch.
   `purgeIdemMigrKeysBatch()` has been rewritten with a hard
   `SAFE_BATCH_TAGS` allowlist that defaults to **empty** (refuses to
   delete anything until populated) — deployed to PROD, verified durable.
   Added `censusIdemMigrKeys()` (bucket matched keys by BATCH tag +
   census the ~4,700-key residual tail that isn't fully explained yet) and
   `exportIdemMigrKeysBeforePurge()` (dumps all 4,184 keys to Drive before
   any deletion — this was missing before, asymmetric with the `IDEM_TEST`
   export). **Next: run `censusIdemMigrKeys()`, get explicit per-batch
   confirmation (BATCH-001/002 likely safe, BATCH-003 needs the Q1 dedup
   question resolved first, BATCH-004 excluded until June reconciliation
   is confirmed closed), then populate `SAFE_BATCH_TAGS` and redeploy
   before purging.**

**All verifications now complete, 2026-09-01 — SAFE_BATCH_TAGS =
['BATCH-001','BATCH-002'] confirmed safe, purge not yet run.**
- ✅ No installed trigger reaches `MigrationReplayEngine.replayAll` or any
  Step-D importer function (checked every `ScriptApp.newTrigger` call in
  the codebase) — replay is human/editor-invoked only, a controllable risk.
- ✅ `censusIdemMigrKeys()`: BATCH-001 = 2,607, BATCH-002 = 387,
  BATCH-004 = 1,190 (0 BATCH-003 — the Q1 dedup caution turned out moot,
  no keys under that tag exist in this set). Residual ~4,700 gap explained:
  mostly `IDEM_MIGR-JOB-*` (a sibling prefix from `replayJob_()`, out of
  scope for this purge — separate cleanup opportunity for later).
- ✅ `MIGRATION_NORMALIZED.replay_status` check: BATCH-002 = 0 unreplayed
  WORK_LOG rows (fully clean). BATCH-001 = 14 unreplayed, but confirmed
  via `checkIfTestRowsHaveProperties()` (0 matches) that all 14 are
  validation-rejected `TEST-*` fixtures with NO corresponding Script
  Property at all (`MigrationReplayEngine.gs:340-342` filters to
  `validation_status==='VALID'` before the replay loop even runs, so
  `checkAndMark()` was never called for them) — BATCH-001 fully clean too.
- ✅ **Live confirmation the store is genuinely at/over the 500KB limit
  right now**: `selfTestRestoreRoundTrip()`'s first attempt failed with
  `"You have exceeded the property storage quota"` on its own test-key
  setup — direct proof, not just historical `_SYS_LOGS`, that new writes
  are failing at this moment. Rewrote the self-test to sample 3 REAL
  existing BATCH-002 keys (delete + restore to original value, net-zero,
  space-neutral) instead of creating new dummy keys, since any new
  `setProperty()` can fail while the store is full — the purge itself is
  unaffected by this (`deleteProperty()` needs no headroom).
- ✅ **`selfTestRestoreRoundTrip()` — ROUND-TRIP TEST PASSED, 2026-09-01.**
  Sampled 3 real BATCH-002 keys, exported, deleted, restored from export,
  verified byte-identical to originals, cleaned up test export file. Real
  keys left correctly restored, net-zero effect on real data. **The
  restore path is proven, not just designed.**

**TASK PQ-1 — CLOSED, 2026-09-01. Purge executed successfully, verified
clean.** `purgeIdemMigrKeysBatch()` run 4 times (1,000 + 1,000 + 994 + 0),
deleted exactly 2,994 `IDEM_MIGR-WL-*` keys (`BATCH-001`: 2,607 +
`BATCH-002`: 387), confirmed via `censusIdemMigrKeys()` re-run: total
properties dropped from **12,081 → 9,087**, exact size dropped from
**~524,258 → 340,940 bytes** (well clear of the 512,000-byte limit, ~171KB
headroom). Only `BATCH-004` (1,190 keys, deliberately excluded) remains
among `IDEM_MIGR-WL-*`. `checkIdempotencyStoreFullLogs()` re-run post-purge:
log count still **2,705**, unchanged from the pre-purge reading — confirms
zero new `IDEMPOTENCY_STORE_FULL` failures since the purge (an initial read
of 4 "post-purge" entries was a false alarm — a hand-written UTC boundary
miscalculated the local/UTC offset; one of the 4 was byte-identical to the
very first 12:27 PM reading, i.e. pre-purge).

**Pre-purge export gap, corrected post-hoc:** `exportIdemMigrKeysBeforePurge()`
(the full 4,184-key backup) was never actually run before the purge — only
`IDEM_TEST`'s 155-key export happened. Not a functional risk in practice,
since the actual go-ahead basis was the independent `MIGRATION_NORMALIZED
.replay_status` verification (confirmed clean for both batches), not this
export — but reconstructed a deduped, exact replacement afterward:
**2,994 keys, matching the real deleted count precisely.**

**Restore references, both on Drive (needed by any future session, not
just this one):**
- `IDEM_TEST` (155 keys, kept, not deleted): https://drive.google.com/file/d/1j7lriTVSLxdPDE0nPrBJ9G6FVJiCOGLW/view?usp=drivesdk
- `IDEM_MIGR-WL-*` BATCH-001+002 (2,994 keys, deleted, reconstructed
  post-hoc, deduped): https://drive.google.com/file/d/1Jrxp0X1iv48ZAeLTigj3twokhHCj_CMH/view?usp=drivesdk
- Restore via `restoreIdemMigrKeysFromExport(fileId)` in
  `IdempotencyPropertiesMaintenance.gs` if ever needed — proven via a
  real-data round-trip test before the purge ran.

**Carried-forward open items, not part of this task's scope:**
- `IdempotencyEngine` still has no TTL/expiry — `IDEM_WORK`/`QC`/`JOB` will
  keep growing indefinitely and the store will drift back toward the limit
  over time. Needs its own design task (e.g. period-partitioned keys).
- `IDEM_MIGR-JOB-*` tail (sibling prefix from `replayJob_()`, ~4,700+ keys
  in the residual census) — same cruft pattern, not touched by this purge.
- `BATCH-004` (`JuneWorkLogImporter.gs`, 1,190 keys) — revisit once June
  reconciliation is confirmed closed; re-run the same verification chain
  (trigger check, `replay_status` audit, fresh export) before purging it,
  do not assume the BATCH-001/002 all-clear extends to it.
- ✅ **RESOLVED, 2026-09-01 — not an R10.8 violation, false alarm from
  naming.** Traced every idKey construction starting with `TEST` in the
  codebase (exactly two): `TestArtifactVoidFixer.gs` (voids
  `client_code='NORSPAN'` test-pollution rows from `VW_JOB_CURRENT_STATE`/
  `FACT_JOB_EVENTS` — root-caused in its own header to `TestHarness.gs`/
  `TestRunner.gs` hardcoding `'NORSPAN'` pre-2026-07-08 `Config.isDev()`
  guard) and `TestWorkLogVoidFixer.gs` ("PROD contamination cleanup —
  Fix 4", voids `actor_code='DS1'` `FACT_WORK_LOGS` rows via net-zero
  negated-hours entries). Both are legitimate one-time PROD remediation
  scripts for the already-known 2026-07-08 incident, not new test data
  sitting in PROD — the `IDEM_TEST` keys are those fixers' own
  idempotency guards (so a crashed/partial run can be safely re-run
  without double-voiding), not contamination themselves. No action
  needed; excluding them from the PQ-1 purge was still correct as a
  matter of scope discipline, just not because of an open incident.

Purge only the stale
   of the space) — export the full key list first, delete one-at-a-time
   with a fresh-recount-and-hard-stop-on-mismatch gate (same pattern that
   worked for the 65-form trash), batched (~1,000/run) to stay under the
   6-min execution ceiling. **Do NOT use `setProperties(keepObj, true)`** —
   a bug in the keep-filter would silently wipe `PORTAL_BASE_URL` /
   `PORTAL_LINK_SECRET` / `FEEDBACK_FORM_*` / `SOP_*` / `HM_ALERT_RECIPIENT`.
5. Deploy the purge script via `npm run push:prod` (not pasted into the Apps
   Script editor) — re-opens the exact autosave-clobber failure mode from
   the 2026-08-31 reversion incident if done via editor paste-and-run for a
   mutating script. Confirmed safe re: the held New Version redeploy:
   editor-run functions pick up a plain `clasp push` immediately without
   disturbing what's live at `/exec`.
6. **Separate follow-up, not this task:** `IdempotencyEngine` has no
   TTL/expiry design at all — will refill given time even after this purge.
   Needs its own task (e.g. period-partitioned idempotency keys instead of
   unbounded flat Script Properties). Not scoping it now.

---

**NEW THREAD, 2026-08-28/31 — ClientFeedback.gs duplicate-form + lost-response investigation (TASK CF-1).**
Found ~70 duplicate "BLC Performance Feedback" Google Forms in Drive while
investigating an unrelated question. Root causes identified and fixed,
commit `7f8cce8` on local `main` (**NOT yet pushed to origin, NOT yet
deployed** — that's this session's next step):
1. `getOrCreateClientForm_()` treated ANY exception during form-reuse as
   "form deleted", silently wiping a valid Script Properties cache entry
   and creating a duplicate Form. Fixed via new `isFormGone_()` — only a
   confirmed Drive-level trashed/missing check now triggers recreation;
   any other error propagates instead of being swallowed.
2. The response-destination link used `SpreadsheetApp.getActiveSpreadsheet()`
   (browser-tab-dependent) instead of `Config.getSpreadsheetId()` — this is
   how one real client response got silently routed into DEV's spreadsheet
   while the form was created against PROD. Fixed.

**Deployment nuance, IMPORTANT — do not do a New Version redeploy for this
fix.** `ClientFeedback.gs` changes only reach the portal-invoked path
(`portal_sendFeedbackRequests`) via a New Version redeploy (Apps Script
Versions are full-project snapshots) — but PROD is currently mid-hold on
exactly that redeploy because of the W2-4/SOP-upload bundling above. **Do
not redeploy PROD to get this fix live for the portal button** — that would
also promote the untested SOP upload workflow, which the user explicitly
declined. Editor-run functions (`runSendQ2FeedbackRequestsToHR()`, etc.)
pick up the fix immediately from a plain `clasp push`, no redeploy needed.
The portal's "✉ Send Feedback Requests" button stays on old (buggy) code
until the W2-4 redeploy decision is resolved — acceptable, since that
button isn't in active use.

**Real finding, separate, not yet fixed:** `src/setup/TestRunner.gs`'s
`clearFeedbackFormCache()`, `testFeedback()`, `testRatingRequests()`,
`dryRunRatingRequests()`, `dryRunFeedbackRequests()` had **no
`Config.isDev()` guard** — an R10.4/testing-policy.md violation (the exact
rule written after the 2026-07-08 incident). `clearFeedbackFormCache()`
explains much of the observed form-duplication clustering (a legitimate
dev workflow — deliberately clearing the cache between test iterations —
just missing its required safety guard).

**FIXED, 2026-09-01 (commit `4ce9f6f`).** All 5 functions now have the
standard guard (`if (!Config.isDev()) throw new Error(...)`) as their
first statement, matching the existing pattern used elsewhere in
`TestRunner.gs`. R10.7 grep sweep clean (no new hardcoded identities).
Pushed to both DEV and PROD; PROD verified durable via a scratch-dir
`clasp pull` — byte-identical to git HEAD, all 12 `isDev()` guard
instances present (7 pre-existing + 5 new).

**Real finding, more serious — `FACT_CLIENT_FEEDBACK` has ZERO rows in
PROD, total.** No client feedback has ever been captured in production via
this feature, as far as the table shows. One genuine, substantive real
response exists (Nelson Lumber Ltd., see below) sitting orphaned outside
the table — everything else ever created was either test data (redirected
to HR/internal addresses) or never responded to.

**Nelson Lumber Ltd. orphan response — needs backfill, NOT YET DONE.**
Form ID `1aZhedgW08SLN60yQJesxXINOFcZbfA1aBbMmQ2bkKhI`
("BLC Performance Feedback — Nelson Lumber Ltd. — Q2 2026", created
2026-04-13). Real, substantive client feedback, submitted
`2026-04-13T20:08:09.445Z`, response ID
`2_ABaOnuddOv5vmJJUoDzdj3gAyRS9hVHNiVN7er9cWWJvySjS7NUYVnQLSHB2NAOexBaD9ys`.
Grid scores `["3","3"]` for two designers — **designer codes not yet
identified** (need to read the form's grid row labels — same order as the
response array — before backfilling). **`period_id` not yet confirmed** —
inferred as `'2026-04'` (matches `sendFeedbackRequests()`'s
`Identifiers.generateCurrentPeriodId()` default if triggered via the portal
button with an empty periodId around that date; every hardcoded editor
runner's periodId — `'2026-01'`, `'2026-03'`, `'2026-06'` — is ruled out
since none produce the observed "Q2 2026" label except a blank/default
call) — **not confirmed, needs verification** (check for a
`FBRESP_*_NELSON` tab in DEV's spreadsheet `18f2sSSYhlK9vDAZ9-zbPf4mFOsVmBNDjofSYN6-b1CA`
before assuming). **Do not hand-write a `DAL.appendRow` FACT row** — build
the payload `onFeedbackFormSubmit` would have produced and run it through
`processFeedbackResponse` (the real queue/idempotency/validation path) so
this doesn't diverge from what the trigger would have written.
`submitted_at` must be the real `2026-04-13T20:08:09.445Z`, not today.

**Third root cause found and fixed, same thread — `ClientFeedbackTrigger.gs`
used a hardcoded system actor email (`system@blc-nexus.internal`) that
`RBAC.gs` never registered (only `system@blclotus.com` is registered),
causing every real `CLIENT_FEEDBACK` queue item to dead-letter at
actor-resolution before ever reaching the handler — this, not the two
causes above, was the actual reason `FACT_CLIENT_FEEDBACK` had zero rows.
Fixed alongside a `submitted_at` override param on
`processFeedbackResponse()` (for backfilling historical responses), commit
`5e895d5`.

**PROD deploy reversion incident, found and resolved 2026-08-31.** After
pushing `5e895d5`, repeated `clasp pull` verifications showed PROD's actual
source alternating between fixed and reverted-to-old, including a fully
deleted `test.js` reappearing — i.e. a whole-project revert, not a
single-file issue. Root cause: the user had an Apps Script editor browser
tab open on this project; its autosave was pushing the tab's stale
in-memory buffer (old `ClientFeedback.gs` + a stale `test.js`) back over
`clasp push`'s output. Ruled out on Claude's side first (`.clasp.json`
correctly pointed at PROD's scriptId, no stray background push process).
**Fix: close every Apps Script editor tab for this project completely
(not just reload) before/during any `clasp push`.** Re-pushed after tabs
closed, verified via fresh `clasp pull` into a scratch dir — both fixes
durably present, byte-identical to git HEAD. Standing risk for future
sessions: **always confirm no Apps Script editor tab is open before a PROD
push**, and verify via a scratch-dir `clasp pull` after, never trust a
`clasp push` success message alone.

**Nelson Lumber Ltd. backfill — DONE, 2026-08-31.** Designer codes
confirmed as `DBS` and `AR001` (from the form's grid row labels), `period_id`
confirmed as `'2026-04'` (user's explicit choice). Two rows written via the
real queue/handler path (`PortalData.writeQueueItem` →
`QueueProcessor.processQueue()`), both `status=COMPLETED`, both
`submitted_at=2026-04-13T20:08:09.445Z` (the true historical value, not the
processing date) — verified directly against `FACT_CLIENT_FEEDBACK`.
(Two earlier attempts had produced rows with the wrong `submitted_at`
because the fix wasn't durably deployed yet per the reversion incident
above — those bad rows were found and deleted before the final correct
write.)

**Three more real, uncaptured client responses found and backfilled,
2026-09-01 — same root cause as Nelson.** Re-verifying the orphan list
(needed after discovering the first verification script's live-form
detection was broken — see below) surfaced 3 more responses sitting on
still-*live* forms (not orphans) that never reached
`FACT_CLIENT_FEEDBACK`, because the system-email dead-letter bug existed
for this feature's entire history until the fix landed:
- Alberta Truss, period `2026-01`: designers PRS (4), DBS (4)
- MATIX-SK, period `2026-01`: designers DBG (4), DBS (4)
- SBS, period `2026-01`: designers BCH (5), SDA (5), SVN (4), PBG (4),
  JYS (4), ABB (4), SYR (4), DBG (4), BIT (4) — **BSG intentionally
  skipped**, left blank on the client's form, matches the trigger's own
  skip-blank-rows logic.

All 13 rows backfilled via the real queue/handler path (same pattern as
Nelson), verified correct: `client_code`/`designer_code`/`raw_score` all
match the source form responses, all 13 queue items `COMPLETED`.
**Confirms the `period_id` Date-coercion landmine is real** (flagged
earlier, not yet fixed) — verification had to switch from `period_id`
string-equality (which silently returned zero rows) to filtering by
`client_code` only, since `period_id` is stored as a Date object
(`2026-01` → `2026-01-01T06:00:00.000Z`), not the string written. Also
confirmed `QueueProcessor.processQueue()` has some per-run batch limit —
13 items needed 3 separate `processQueue()` calls to fully drain (6, then
0 more progress, then the remaining 7 completed on a further call).

**First verification script had a real bug, caught before any damage —
worth remembering for next time.** `FEEDBACK_FORM_{periodId}_{clientCode}`
Script Properties store the Google Form ID as a **plain string**, not a
JSON object with a `.formId` field (see `ClientFeedback.gs` header comment,
"SCRIPT PROPERTIES KEYS" section) — the first re-verification script
assumed the JSON shape, silently failed `JSON.parse` on every entry, and
reported 0 live forms instead of 13. This inflated the "orphans with
responses" count from 1 (Nelson) to 4, which is what surfaced the 3 new
lost responses above — a lucky catch from a bug, but the corrected script
(`liveIds[fileId] = key` using the raw string value) is the one to reuse
going forward. Also confirmed: `ALBERTA TRUSS` (with a space) is the real,
correct `client_code` in `DIM_CLIENT_MASTER` — not a Norspan-style
mismatch, just an unusual naming convention for that one client.

**65 orphan Google Forms confirmed safe to trash (zero responses each,
independently re-verified three times) — final indexed list produced
2026-09-01, awaiting manual trash by the business owner.** Regenerate any
time via a read-only script that lists live Script Properties (raw string
values, not JSON — see the property-shape note above) then cross-checks
Drive forms against them, counting responses on each non-live one; only
zero-response, non-live forms are safe. **Do not hand-transcribe this
list by hand** — a manual retype attempt this session produced 69 IDs
instead of 65 (no duplicates, just transcription drift from a long
repetitive list) and was caught and discarded before being used. Always
have the script itself print an indexed, self-consistent list
(`N of TOTAL`, plus `array.length` printed separately as a cross-check)
and work directly from that execution log — never from a re-typed copy.
13 forms are currently live/cached (`FEEDBACK_FORM_*` Script Properties)
— never trash those; 1 additional orphan (Nelson, already backfilled)
still has its original real response on the form and is correctly
excluded from the safe list. Only the business owner executes the actual
trash operation, one by one via Drive search/URL — no bulk-delete script.

**Still open, deferred (not urgent):** `src/setup/TestRunner.gs`'s missing
`Config.isDev()` guards (see above) — not yet fixed.

**TASK CF-1 — CLOSED, 2026-09-01. All 3 steps done.**
1. ✅ `git push origin main` + `npm run push:prod` for commits `7f8cce8` and
   `5e895d5` — verified durable after the reversion incident above.
   **No New Version redeploy** (still correct — see deployment nuance above).
2. ✅ Nelson Lumber backfill + 3 more real responses found + backfilled
   (Alberta Truss, MATIX-SK, SBS, all Q1 2026 — 13 designer rows total).
3. ✅ 65 safe orphan forms trashed via a script-driven run (recomputed the
   list fresh in the same execution, hard-stopped unless count == 65,
   then `setTrashed(true)` on each — reversible, ~30-day Drive retention).
   Result: 65 of 65 trashed, 0 failures, post-trash count = 14 remaining
   (13 live + Nelson's original orphan form), exactly as expected.

This thread is fully closed. Durable outcomes (3 root causes fixed, 4
real client responses backfilled, 65 duplicate forms removed) are now in
`SESSION_LOG.md`'s 2026-08-31/09-01 entries; nothing further to track
here going forward except the still-deferred `TestRunner.gs`
`Config.isDev()` gap noted above.

---

**Payout Statement Summary (TASK NEW-1) — implementation, live DEV
verification, merge to local `main`, push to `origin/main`, and `clasp push` to PROD's source all
complete.** Local `main` and `origin/main` are identical at `032e390`
(confirmed via real `git fetch origin` 2026-08-28). Full detail in that
task's entry below (Wave Backlog section) and in
`docs/superpowers/plans/2026-08-26-payout-statement.md`'s SDD ledger. 8
tasks + 1 final-review fix wave + 1 same-session follow-on (Run Payroll
button), all reviewed clean, 535/535 Jest passing as of 2026-08-27 (not
re-verified since — bare `npx jest` is currently unreliable, see
`testPathIgnorePatterns` gap below), all 5 DEV checklist items confirmed
live 2026-08-27. CTO PROD-readiness assessment is a durable doc:
`docs/PROD_READINESS_PAYOUT_STATEMENT.md` (§2.3 and §5 need a small
correction — the "git push required first" gate it names is already
satisfied; see doc). **Next step is user-driven: explicit approval to run
`npm run push:prod`** per CLAUDE.md R9 — not yet given. Remaining
pre-flight per the doc: §2.1 (verify PROD's actual live source hasn't
drifted, same check that caught DEV drift this session) + §2.2 (confirm
`PAYOUT_STATEMENT_REVIEW_RECIPIENT` Script Property in PROD).

Prior session (2026-08-14, SOP upload workflow + QC findings-picker live
DEV walkthrough) is fully closed — durable outcomes already in
`PROJECT_MEMORY.md` and `SESSION_LOG.md`'s 2026-08-14 entry; compressed out
of this Session State block per this file's own standing practice (nothing
lost, see `git log -p CTO_TASK_QUEUE.md` for the pre-compression detail).

## CTO Wave Backlog (from 2026-08-07 assessment, prioritized 2026-08-09)

Source: full CTO architecture/performance/tech-debt assessment,
2026-08-07 (see `PROJECT_MEMORY.md` §3.8 for durable findings).

### EPIC: Wave 0 — Verification & Safety
- **TASK W0-1** | PROD Apps Script project ID rotation | P0 (security) but **explicitly DEFERRED by user, 2026-08-09** — do not action without being asked again; reminder saved to cross-session memory, surface once the rest of this backlog is implemented.
- **TASK W0-2** | Add minimal performance instrumentation to the 4 highest-traffic portal reads | P1 | **DONE 2026-08-10, PR #20, deployed PROD `0014b58`.** Reused existing `HealthMonitor.startExecution()`/`endExecution()` pattern — `portal_getViewData`/`portal_getLeaderDashboard`/`portal_getMyHours`/`portal_getCEODashboard` now log duration_ms+api_calls to `_SYS_LOGS` per call. `PerfBaselineReport.gs` (new, read-only) reports count/min/avg/p95/max per module. **Pending: confirm PROD New Version redeploy done, then let real usage accumulate a day or two before reading the report there.**
- **TASK W0-3** | Review `blc-go-live-fixes.patch` (gitignored, unreviewed since June) | P3 | Not started.
- **TASK W0-4** | Investigate `QueueProcessor` 232-second execution outlier (`max=231994ms` vs `p95≈8.8s` across 2,906+ calls, pre-existing instrumentation) | P2 | Found 2026-08-10 while validating W0-2's report tooling. Close to Apps Script's 6-min execution ceiling — if ever actually hit mid-run, that's a silent partial-processing risk. Single outlier so far, not confirmed as a pattern. Not investigated.

### EPIC: Wave 1 — Technical Debt Reduction (`src/12-migration/` archival)
- **TASK W1-1** | Systematic caller-trace of all 71 T12 files (cross-reference `DAL.gs` `WRITE_PERMISSIONS` + git history per file) → classify KEEP/ARCHIVE definitively | P2 | Prerequisite — do not archive anything before this. Not started. **Deprioritized by user, 2026-08-09** — doing Wave 0 → Wave 2 first.
- **TASK W1-2** | Archive the legacy `onIntakeFormSubmit`/`INTAKE_FORM_ID` trigger installer in `setup/Triggers.gs` (confirmed not installed, confirmed superseded by portal-button SBS intake) | P3 | Not started.

### EPIC: Wave 2 — SOP/QC Finish & Activate (NOT a rebuild — `src/13-sop/` already exists, 3,725 lines, feature-flagged pilot infra) — **CURRENT FOCUS**
- **TASK W2-1** | Design pilot rollout plan: which client(s) first, `WARN_ONLY` vs `BLOCK`, timeline | P2 | **Inputs confirmed 2026-08-10: client `NORSPAN-MB`, mode `WARN_ONLY`, start week of 2026-08-17 (Monday).** Rollout mechanics (`SopGate.gs`): set Script Properties `SOP_ENABLED='true'`, `SOP_MODE='WARN_ONLY'`, `SOP_PILOT_CLIENTS='NORSPAN-MB'` in the Apps Script editor (no code change needed — flags are already read live). WARN_ONLY means non-blocking — designers see nothing rejected, only `SOP_GATE_WARN` log entries land in `_SYS_LOGS` when a QC submission has incomplete checklist items. **Unblocked 2026-08-10** — all content decisions settled (software Alpine, ~9-item category-level checklist, job_type/scope_code, and the 3 numeric conflicts between the two source docs all resolved via user's managers). Full detail in Session State above. **Ready to build via `SopAdminEngine`** — pre-flight gap (verify no conflicting ACTIVE template already exists) still applies before flipping `SOP_ENABLED`.
- **TASK W2-2** | Trace `QcFindingTypes.gs` (521 lines, defines a QC finding taxonomy) — confirm whether an internal-QC reviewer queue UI exists or still needs building | P2 | **DONE 2026-08-10.** At the time, taxonomy (17 codes, `DIM_QC_FINDING_TYPES`) was fully seeded but had zero consumers — confirmed needing a UI, not a revival. **W2-3 (below) built and merged that consumer 2026-08-12** — no longer zero consumers.
- **TASK W2-3** | Build QC findings-picker UI: multi-select finding codes (from `DIM_QC_FINDING_TYPES`) on the `#modal-qc-review` modal, new `portal_getQcFindingTypes()` read endpoint (first-ever reader of that table), `QCHandler.gs` changes to accept/store selected finding code(s) on the QC event | P2 | **DONE 2026-08-12 — merged to main (PR #21), 79/79 tests passing live in DEV.** `npm run push:prod` ran 2026-08-28 (source now on PROD's Apps Script project) — **New Version redeploy still pending**, held pending W2-4 below. See Session State above.
- **TASK W2-4** | Build SOP upload workflow: CEO-only structured upload → manager review link (no login) → CEO publish, for both SOP designer docs and (partially) QC-review SOP docs | P2 | **SECOND CORRECTION 2026-08-28 — the "never run live in DEV" note added earlier today was ALSO wrong; I propagated a stale claim without checking `SESSION_LOG.md`'s own already-accurate record.** Ground truth, confirmed via `SESSION_LOG.md`'s 2026-08-14 entry + git ancestry checks: **this was fully live-DEV-verified end-to-end on 2026-08-14** — all 3 phases (setup, designer+QC flow, and the SOP upload/review/publish flow itself using a real Norspan-MB source PDF) confirmed working live. 4 real bugs found that session, all fixed and confirmed on `main` today: `d439f4c` (QC_ROLES dropdown), `7e33e48` (base64 file-transport fix), `25af809` (product-vocabulary unification), `2cb7d8d` (PLATE_ERROR seed fix). **This task is NOT an open live-verification item.** What's actually still open, because PROD is a separate Apps Script project that's never had this feature's setup run: (1) `runSetupSchemas()` once in PROD — creates `DIM_SOP_UPLOADS`/`FACT_SOP_REVIEW_FEEDBACK` tabs; (2) `runGenerateSopReviewSecret()` once in PROD — without it every review link throws; (3) confirm PROD's deployed web app "Who has access" setting allows the no-login review link (manifest says `MYSELF`, confirmed stale for DEV — verify PROD separately); (4) apply the `PLATE_ERROR` product_applicability data fix (`TRUSS`→`ROOF_TRUSS`) to PROD's live `DIM_QC_FINDING_TYPES` sheet — code fix already on `main`, live PROD row still needs it (same item as "Other Still-Open Items" below); (5) lower-risk, worth a quick real confirmation: Drive `setSharing(ANYONE_WITH_LINK, VIEW)` succeeded in DEV under the same Workspace org — should hold in PROD too, not separately proven. **Do not touch `SOP_ENABLED`/`SOP_MODE`/`SOP_PILOT_CLIENTS`** — those gate the separate, deliberately-still-off W2-1 pilot decision; none of the above requires flipping them, and `SopUploadEngine`/its endpoints don't check `SOP_ENABLED` at all (confirmed via grep). Source is already sitting in PROD's Apps Script project (2026-08-28 `clasp push`, bundled with W2-3 + NEW-1) but not yet live — New Version redeploy still deliberately held pending items 1-4 above.

### EPIC: Wave 3 — Client Feedback data-model extension
- **TASK W3-1** | Add structured severity/root-cause/resubmission fields to the existing `ClientFeedback.gs` intake | P3 | Depends on Wave 2 producing real QC data. Not started.

### EPIC: Wave 4 — Quality Analytics
- **TASK W4-1** | Define metrics precisely (First Pass Quality, rework rate by designer/client/product, etc.) before any dashboard work | P3 | Not started.

### EPIC: Wave 5 — Learning Hub
- **TASK W5-1** | Design content/tagging model | P4 | Sequenced after Wave 2 produces real error-classification data. Not started.

### EPIC: New — Portal Payout Statement Generation for CEO/HR Review
- **TASK NEW-1** | Build a portal-triggered Payout Statement generation feature for CEO + HR admin, routing output to `HR@bluelotuscanada.ca` for review before team distribution | **MERGED TO MAIN LOCALLY 2026-08-27 (commit `4d14ac9`), awaiting explicit PROD approval** | Requested 2026-08-14, brainstormed and designed 2026-08-26 (design questions (a)-(d) all resolved — see spec), implemented via subagent-driven-development on branch `worktree-payout-statement` (`.claude/worktrees/payout-statement`), live-verified in DEV 2026-08-27, merged to local `main` same day (clean merge, no conflicts, 535/535 passing on the merged result — worktree left on disk post-merge, harness's own EnterWorktree tracking had already ended so it wasn't auto-removed, harmless to leave or delete manually).
  **Design spec:** `docs/superpowers/specs/2026-08-26-payout-statement-design.md`. **Implementation plan:** `docs/superpowers/plans/2026-08-26-payout-statement.md` (8 tasks, all individually reviewed clean, plus a final whole-branch review that found and fixed 4 Important issues — see that plan's Global Constraints and the SDD ledger at `.claude/worktrees/payout-statement/.superpowers/sdd/2026-08-26-payout-statement/progress.md` for full detail).
  **What shipped:** `PayrollEngine.previewPayoutStatement(actorEmail, periodId, options)` — a new no-write CEO/HR_ACCOUNTING preview trigger (reuses the existing `PAYROLL_PREVIEW`/`PAYROLL_VIEW` RBAC actions, no matrix change) that computes base pay + supervisor bonus (+ optional quarterly bonus) and emails one combined summary to the `PAYOUT_STATEMENT_REVIEW_RECIPIENT` Script Property (default `HR@bluelotuscanada.ca`). Additive only — the existing per-consultant confirm-gate email flow (`sendPaystubEmail_`/`confirmPaystub`) is completely unchanged in mechanism; `runPayrollRun`/`runBonusRun` now also send the same HR summary automatically on a real commit (guarded to only fire when something was actually processed, not on an idempotent re-run). New portal button "📧 Generate Payout Statement" (CEO/HR_ACCOUNTING only), plain-text batch email (no PDF), manual `prompt()`-based period entry (no scheduled trigger). Also renamed all pre-existing user-facing "Paystub" text to "Payout Statement" across `PayrollEngine.gs`/`PortalView.html`/`StaffOnboarding.gs` (contractor CRA/legal terminology — BLC's consultants are not employees) — internal identifiers (`sendPaystubEmail_`, `confirmPaystub`, CSS ids) deliberately left unrenamed. Also fixed a stale `.claude/context/payroll-rules.md` doc/code drift found during design: PM bonus is a flat, company-wide calculation (not `pm_code`-scoped as the doc incorrectly said) — confirmed as the correct, already-shipped Phase B1 behavior; kept as-is, doc corrected.
  **Follow-on, same session, same branch:** added a "💵 Run Payroll" portal button for CEO (base pay had no portal trigger at all before — Apps Script editor only), mirroring the existing "Run Bonus" button exactly. CEO-only, reuses the existing `canRunPayroll` flag, no RBAC change. Commit `dba5905`.
  **Tests:** 535/535 Jest passing (full repo suite), including new coverage for the double-rounding contract, RBAC gating, additive-not-replacing behavior, and the idempotent-re-run guard added during final review.
  **Live DEV verification — all 5 checklist items confirmed 2026-08-27:** (1) Run Payroll (CEO) — 1 ledger row written, committed HR summary arrived correctly; (2) Run Bonus (CEO) — bonus emails + committed HR summary arrived; (3) HR_ACCOUNTING access — header/button visibility all correct; (4) quarterly bonus opt-in section rendered correctly, separate from totals; (5) renamed strings confirmed live across every email seen. **Real incident found and fixed along the way, unrelated to this feature**: DEV was running source code older than `main`, missing all 4 fixes from the 2026-08-14 session (cause unknown, no worktree showed post-2026-08-14 activity) — the `npm run push:dev` for this feature also restored those fixes as a side effect; confirmed via `clasp pull` + diff against `main` before pushing. **Real gap found in test infra**: `RBAC.gs`'s `getDevTestActors_()` already defines a synthetic HR_ACCOUNTING test identity (`test-hr@test.blc.internal` → `THR`), but `seedTestStaff()` never seeds a matching `DIM_STAFF_ROSTER` row for it, so the `?pt=` link path couldn't resolve it — worked around with an ephemeral one-off `livetest_seedThr()` script (not committed, wiped by next `push:dev`); `seedTestStaff()` should get a proper `THR` entry as a follow-up so this doesn't need re-solving next time.
  **STALE CLAIM CORRECTED 2026-09-01** — this line previously said "NOT pushed to origin, NOT deployed to PROD," which was left over from before the 2026-08-28 deploy and never updated. Directly re-verified: `origin/main` and local `main` are identical (`0cbb17e`), both NEW-1 commits (`4d14ac9`, `dba5905`) are ancestors of current `main`, and a scratch-dir `clasp pull` of PROD's actual source confirms `previewPayoutStatement`, the "📧 Generate Payout Statement" button, and the "💵 Run Payroll" button are all present and byte-identical to git HEAD's `PayrollEngine.gs`. **NEW-1's code is durably deployed to PROD's source.** What remains open is the same "New Version" redeploy gate described in the Session State block above (bundled with W2-3 and W2-4) — not a re-push.
  **Post-merge finding, not blocking:** a bare `npx jest` from the repo root double-counts/fails on unrelated content — `package.json`'s `testPathIgnorePatterns` excludes `.worktrees/` but not `.claude/worktrees/` (a second, harness-native worktree location this session used) or `code-review-graph/` (a local, gitignored tool with incompatible Vitest test files). Confirmed the actual suite is clean (536 → 535 real tests, 36 suites) once scoped past those two paths; worth adding both to the ignore list as a quick follow-up so `npm test` is reliable by default again.

### EPIC: New — Portal Cleanup & Staff/Payroll Workflow Gaps (2026-09-03)
User asked for a portal button audit/tidy-up plus two new features. Decomposed
into 3 pieces, agreed build order: (1) button cleanup, (2) individual paystub
→ HR review → forward to staff, (3) staff status maintenance.
- **Button cleanup — RESOLVED, no action needed.** Audited all toolbar
  buttons. "📄 Generate Timesheet" (PDF) looked redundant with the new
  "🧾 Generate Client Timesheets" but isn't — the old button produces
  actual downloadable PDF files per client/date-range (still sent to
  clients directly), the new one writes to an internal `TIMESHEET_EXPORT`
  review sheet, semi-monthly periods only. User confirmed PDFs still
  needed — keeping both. "🧾 Run Billing" explained (bills clients,
  unrelated to payroll) — not redundant, just unclear from the label.
  Nothing else flagged for removal.
- **TASK NEW-7** | Individual paystub → HR review → forward to staff workflow. Today `runPayrollRun()`'s `sendPaystubEmail_()` emails each staff member their paystub directly for self-confirmation — no HR-in-the-loop step exists. User wants HR to receive/verify individual paystubs first, then forward to the team. | P2 | Not started — next up after NEW-6.
- **TASK NEW-6** | Staff lifecycle maintenance: ability to change/modify staff status (deactivate/offboard, promote, change role/supervisor) from the portal. | P2 | Not started. Confirmed gap: only `portal_onboardStaff`/`portal_bulkOnboardStaff` exist — no update/deactivate function. `DIM_STAFF_ROSTER` already has the needed fields (`active`, `role`, `supervisor_code`, `pm_code`, `effective_from`/`effective_to` — D4 point-in-time pattern), just no portal-facing write path to them. `TestStaffDeactivator.gs` (`src/12-migration/`) is an unrelated one-time test-data cleanup script, not a real feature.

### EPIC: August 2026 Payroll Discrepancy — Rate Reconciliation & Work-Log Correction Tool (2026-09-04)
Root-caused a payroll-vs-HR-invoice mismatch to two independent causes: (1)
stale/incorrectly-entered pay rates for 7 staff (HR-confirmed and corrected
in PROD 2026-09-08 — see TASK RB-3 below; no back-pay owed, July was already
paid manually outside Nexus using the corrected rates), (2) two confirmed
duplicate FACT_WORK_LOGS entries (Sarty Gosh — Nelson, job BLC-01016, one of
two 4.5h rows on 2026-08-18/19, HR-confirmed only one line exists on their
timesheet; Abhisek Rit — Nelson, job BLC-01070, 2026-08-24, byte-identical
4h double-submit, `dupe_count: 2` via `WorkLogDedupAudit`).
- **TASK RB-2 — CLOSED, deployed to PROD and both corrections performed
  2026-09-08.** Built a reusable CEO/ADMIN/HR_ACCOUNTING correction door
  into the existing (already-tested) `WorkLogCorrectionHandler.gs` rather
  than a new one-off script — new `WORK_LOG_CORRECTION_ADMIN` RBAC action
  (deliberately NOT widening the general `WORK_LOG_AMEND`/`WORK_LOG_VOID`
  actions DESIGNER/TEAM_LEAD use for self-correction; SYSTEM stays excluded
  per its own pre-existing CTO-spec policy). Four review cycles found and
  fixed real issues before merge: (a) `enforceCorrectionPermission_` was
  silently bypassing `assertActorExists_` for any role already holding the
  primary action; (b) idempotency (keyed on `queue_id`, fresh every
  submission) didn't protect against a retried/double-submitted void of the
  SAME entry — closed with a server-side `findExistingCorrection_` guard in
  `handleVoid`/`handleAmend`/`handleReassign`; (c) that same guard was
  silently dead code in `handleReassign` (its void note format never
  matched the detection regex) and, in `handleVoid`, blocked the very
  "void the whole entry and re-submit fresh" recovery path its own error
  message advertised (a prior AMEND no longer blocks a further VOID — only
  a prior VOID does). Also added `event_id` as an optional disambiguator on
  `VOID_SCHEMA` so two byte-identical duplicate rows (Abhisek Rit's exact
  case) can actually be told apart.
- **Follow-up gap, not yet closed:** `event_id` disambiguation was only
  added to VOID, not AMEND/REASSIGN — a surviving duplicate twin still
  can't be edited/reassigned through the portal (still finds both original
  rows, throws "ambiguous"). Not urgent (both known corrections were
  VOID-only) but will resurface the moment a duplicate-row case needs an
  amend instead.
- **Follow-up gap, found during execution:** `PortalData.getMyHours` (and
  the portal's "My Hours" panel built on it) hardcodes
  `Identifiers.generateCurrentPeriodId()` — there is no way to browse a
  past period through the portal UI at all, for anyone, regardless of role.
  This meant the new Void button couldn't actually be used to fix August's
  duplicates from September — worked around by submitting both corrections
  directly into the same `WORK_LOG_VOID` queue path
  (`PortalData.writeQueueItem` + `QueueProcessor.processQueue()`, exactly
  what `portal_submitAction` does) via one-off Apps Script editor scripts,
  not through the "My Hours" UI. A real fix (optional periodId param on
  `getMyHours`/`portal_getMyHours` + a period selector in the UI) is a
  legitimate follow-up, not done here — same reasoning as the AMEND/
  REASSIGN gap above: this session's actual two corrections didn't need it
  built, so it wasn't, but any *future* use of this tool for a past period
  will hit the same wall.
- **Both corrections performed and verified 2026-09-08, run by CEO (Raj
  Nair) directly (already has full correction authority, so HR_ACCOUNTING
  access was never actually exercised for these two):**
  - Sarty Gosh / BLC-01016: voided the 2026-08-19 4.5h entry (event_id
    `5225da4f-...`), kept 2026-08-18. Net now 4.5h, matching HR's Nelson
    timesheet.
  - Abhisek Rit / BLC-01070: voided the 2026-08-25 4h entry (event_id
    `e6b4c9fb-...`), kept the 2026-08-24 submission (`705b3589-...`). Net
    now 4h, matching HR's Nelson total.
  - Both verified by re-reading `FACT_WORK_LOGS` post-write — void rows
    correctly reference the target `event_id`, correct signed actor/reason
    in notes, no unintended second write.
  - **Not yet done:** re-run the August billing/payroll dry-run
    (`checkAugustBillingDryRunSafe()`-style check from earlier this
    session) to confirm these two fixes plus the still-pending rate
    corrections (7 staff, waiting on HR) fully reconcile before actually
    committing August payroll/billing.

- **TASK RB-3 — Rate reconciliation (HR-confirmed) + payroll rules audit —
  IN PROGRESS, 2026-09-08.** Supersedes the "not yet actioned" rate line
  above — HR has now confirmed exact values. Effective date confirmed as
  **2026-07-01** (not August — July payroll was already run and paid
  manually, outside Nexus, using these corrected rates; no back-pay is
  owed, only Nexus's own `DIM_STAFF_ROSTER` is stale).
  - **All 7 rate corrections shipped and verified in PROD, 2026-09-08
    11:36.** `StaffOnboarding.changePayRate()` added (commit `4cdbb05`,
    code-reviewed — one Important finding fixed before use: missing
    `newRates` validation could close the old row then fail appending the
    new one, leaving a person with no open roster row at all; fixed with a
    guard + 3 new tests before any PROD call), merged to `main` via a
    3-way merge (`3f7eac6` — the spec commit `bfdf07a` and this work had
    diverged from a stale worktree base; reconciled cleanly, zero file
    overlap), deployed to PROD (168 files). 5 people corrected via
    `changePayRate` (PRS, ABB, RKG, DBS, BIT); Sayan Roy and Savvy Nath
    corrected via a direct `DAL.updateWhere` patch instead (their existing
    2026-07-01 row, per the inverted-window guard explained below).
    `verifyAllSevenRates()` confirms all 7 match HR's figures exactly.
    **7 confirmed rate corrections, verified against live PROD data
    (`verifyBeforeRateCorrection()`, 2026-09-08 09:53):**
    | Person | Code | Current pay_design/qc | Target | Mechanism |
    |---|---|---|---|---|
    | Priyanka S | PRS | 250/250 | 300 | new SCD-2 row, close 2026-06-30 |
    | Abhijit Bera | ABB | 300/300 | 350 | new SCD-2 row, close 2026-06-30 |
    | RaviKumar Gummadi | RKG | 250/250 | 300 | new SCD-2 row, close 2026-06-30 |
    | Deb Sen | DBS | 300/300 | 350 | new SCD-2 row, close 2026-06-30 |
    | Bittu Dalui | BIT | 250/250 | 300 | new SCD-2 row, close 2026-06-30 |
    | Sayan Roy | SYR | 250/250 (on existing 2026-07-01 row) | 300 | **direct field patch**, not a new row |
    | Savvy Nath | SVN | 300/300 (on existing 2026-07-01 row) | 350 | **direct field patch**, not a new row |
    Sayan Roy and Savvy Nath already have a row dated exactly 2026-07-01
    (opened by a legitimate `changeSupervisor()` call that changed their
    reporting line the same day — SYR's supervisor BCH→SDA, SVN's SDA→SGO
    — and carried the old, uncorrected rate forward). `scd2FieldChange_`
    (`StaffOnboarding.gs:1094`) cannot touch this: calling it again with
    `effectiveDate='2026-07-01'` closes the current row at `2026-06-30`,
    which is *before* the row's own start date — the function's own
    2026-07-27 inverted-window guard (line ~1187) throws on exactly this
    shape. Confirmed correct fix is a direct `pay_design`/`pay_qc` patch on
    that existing row (safe: `DIM_STAFF_ROSTER` is a dimension table, not
    FACT/Rule A5, and `scd2FieldChange_` itself already uses
    `DAL.updateWhere` on this same table for the `effective_to` field).
  - `scd2FieldChange_` is **private/unexported** — only `changeSupervisor`
    (`StaffOnboarding.gs:1255`) calls it externally. The 5-person fix needs
    a small new exported wrapper (`changePayRate`, mirroring
    `changeSupervisor`'s exact shape: `RBAC.enforcePermission(actor,
    RBAC.ACTIONS.ADMIN_CONFIG)` then delegate to `scd2FieldChange_`) —
    real code change, needs commit + PROD push, not a scratch script.
  - Verified `PayrollEngine.buildStaffCache_` (`PayrollEngine.gs:89`)
    genuinely filters `DIM_STAFF_ROSTER` rows by `effective_from`/
    `effective_to` against `periodId + '-01'` — so correctly-dated rows
    will resolve correctly for any future payroll run, this isn't cosmetic.
  - **Still outstanding, not this task's scope:** re-running the August
    billing/payroll dry-run (TASK RB-2's own leftover item) now that both
    the duplicate-hours fix and these rate corrections are both in — this
    has NOT been done. Shipping the rate data is not the same as August
    being reconciled; whether client billing (`DIM_CLIENT_RATES`) uses
    these same numbers hasn't been checked either.

  - **Payroll rules audit, requested by user to prevent re-litigating this
    piece by piece.** Traced actual code (not assumed from docs):
    - **DESIGNER**: `pay_design × design_hours` (net of amend/void via
      `aggregateNetWorkLogHours`, `WorkLogAggregation.gs:56`). No bonus.
    - **QC reviewer**: `pay_qc × qc_hours`, gated on
      `WorkLogAggregation.gs:70`'s `role === 'QC'` check on the work log
      row's `actor_role` string. No bonus (reviewers don't supervise for
      bonus purposes under the current model).
    - **TEAM_LEAD**: own `pay_design × design_hours` (if they log any) +
      `INR 25 × Σ(design_hours of every designer whose supervisor_code =
      this TL)`, **company-wide, no account/client dimension at all**
      (`buildSupervisorBonusMap_`, `PayrollEngine.gs:306`). Matches
      `payroll-rules.md:39-41` exactly — code and docs agree with each
      other, and both disagree with the real business rule.
    - **PM**: own hours (if any) + `INR 25 × Σ(design_hours of every
      non-PM staff, company-wide)` — flat, deliberately **not** scoped by
      `pm_code` (`buildPmBonusMap_`, `PayrollEngine.gs:355`, rewritten
      Phase B1 2026-07). This is documented as intentional in both the
      code comments and `payroll-rules.md:42-50`, including the
      already-flagged multi-PM caveat — **not a discrepancy**, listed only
      for completeness.

  - **Discrepancy 1 — TEAM_LEAD bonus is not account-scoped (real business
    rule gap, live and currently costing money).** User's stated rule:
    "the team lead is associated with an account... check which account
    they are team leads for and who they are supervising in that account
    only" (example given: Bharath is TL across both SBS and Norspan with
    two different teams). The current model cannot express this — a
    designer has exactly one flat `supervisor_code`, with no way to say
    "this designer's hours on Account X go to TL-A, but on Account Y go to
    TL-B." **Confirmed live instance, not hypothetical:** Priyanka S
    (`PRS`) has logged 95.25 hours in Jul/Aug 2026 against **Alberta
    Truss** — nothing against Titan Truss, the account tied to her current
    `supervisor_code` (`PBG`, Pabitra Ghosh). Titan Truss no longer sends
    work. Pabitra is currently credited ~₹2,381 (95.25 × ₹25) for hours he
    has nothing to do with; whoever actually leads Alberta Truss gets
    nothing. Checked whether `REF_ACCOUNT_DESIGNER_MAP`
    (`client_code, designer_code, role, assigned_from_date,
    assigned_to_date, notes`) already models this — it doesn't: its `role`
    column is always literally `'DESIGNER'` in the seed data
    (`SetupScript.gs:856-858`), "Team Lead" appears only as a free-text
    `notes` string, and nothing under `src/10-payroll/` reads this table
    at all. **There is no existing data model for account-scoped
    supervision** — building one is real design work, not a quick fix.
    User named Deb Sen (`DBS`) as Priyanka's real supervisor going
    forward, but see Discrepancy 2 — his role is `QC_REVIEWER`, and
    `buildSupervisorBonusMap_` only fires for `role === 'TEAM_LEAD'`, so
    reassigning her to him today would silently pay **nobody** a bonus on
    her hours (worse than the current wrong attribution). **Reassignment
    deliberately not yet made — blocked on user decision.**
  - **Discrepancy 2 — `QC_REVIEWER` role alias never applied outside RBAC
    permission checks (real bug, live, currently financially silent by
    coincidence).** `RBAC.gs:93` declares `QC_REVIEWER: 'QC'` as an alias,
    but `lookupActor_` (`RBAC.gs:734`) returns the raw, unaliased roster
    string; `enforcePermission` (`RBAC.gs:1162`) canonicalizes it locally
    via `resolveRole_` for its own matrix lookup, but the alias is never
    applied to the `actor` object itself. So `actor.role` stays
    `'QC_REVIEWER'` everywhere else, including where `WorkLogHandler.gs`
    writes `actor_role: actor.role` into `FACT_WORK_LOGS`. Confirmed on
    live data: **106/106** of Deb Sen's Jul/Aug 2026 work log rows carry
    `actor_role: "QC_REVIEWER"` — none read as `"QC"`. Since
    `WorkLogAggregation.gs:70` tests `role === 'QC'` exactly, every one of
    his hours is bucketed as `design_hours`, not `qc_hours`. Currently
    silent only because his `pay_design` and `pay_qc` happen to be equal
    (300, soon 350 under the correction above) — the moment those two
    rates diverge for him or anyone else onboarded with role
    `QC_REVIEWER`, this misroutes real pay. Not fixed yet — needs a
    decision on where the alias should actually apply (normalize at
    `resolveActor()`/`lookupActor_` time so `actor.role` is always
    canonical, vs. widening the `=== 'QC'` checks to also accept
    `'QC_REVIEWER'`).
  - **All three open decisions above resolved 2026-09-08, in a full
    brainstorming-skill design conversation:** (1) Deb Sen's role changes
    to TEAM_LEAD as part of reassigning him Priyanka's supervision — not
    yet actually done in the roster, waiting on the backfill step below;
    (2) account-scoped bonus gets a real new data model
    (`REF_ACCOUNT_SUPERVISION`) — **built and shipped**, see Phase 1
    entry above and in Session State; (3) the `QC_REVIEWER` alias bug is
    fixed with an isolated one-line change to `WorkLogAggregation.gs`
    (NOT a global RBAC fix — `WorkLogCorrectionHandler.gs` deliberately
    relies on the raw unaliased string elsewhere) — **shipped** as part
    of Phase 1.
  - The 7 rate corrections above were independent of these decisions and
    shipped separately, first — see their own entry above.

### Parallel Track: BLC Growth Platform
- **TASK GP-1** | Standalone project decision + architecture (own future CTO assessment, not folded into this backlog) | P4 | Not started, not scoped.

---

## Other Still-Open Items

- **`PLATE_ERROR` finding code has stale `product_applicability`
  (`'TRUSS'`)** — needs to become `'ROOF_TRUSS'` in both DEV and PROD
  `DIM_QC_FINDING_TYPES` seed/live data, direct consequence of the
  2026-08-14 SOP-upload/job-creation vocabulary unification fix. Not
  yet done.
- **Findings-picker checkboxes render visually all-ticked on open**
  (cosmetic only — confirmed via live data that actual submissions are
  correct, not a data bug) — low-priority CSS/rendering fix, not
  scoped/scheduled.
- **W0-2's `PerfBaselineReport` has 4 days of unread real PROD
  traffic** (since 2026-08-10) — read it before deciding whether portal
  action latency needs work; raised again 2026-08-14 during live DEV
  testing (DEV's own latency is not representative — bloated by test
  data).
- **Task 3 — QC assignment mapping** (`DIM_QC_ASSIGNMENTS`) — unblocked since 2026-07-26, **explicit go-ahead still required before starting.** Two settled design decisions, don't re-litigate: date-ranged from day one (same `asOfDate` pattern as the supervisor_code work); must replace `QCHandler.gs`'s `sendReworkNotification_()`'s current `supervisor_code`-based CC logic with real QC-assignment data — see `PROJECT_MEMORY.md` §3.3 for the TL-vs-QC business rule this depends on.
- **Task 4 — Staff lifecycle management** — **not started, explicit instruction not to begin.** Promotions/pay changes/account allocation. Depends on `StaffOnboarding.scd2FieldChange_()` (already built, generalized for reuse). Open question: what "account allocation" means — not resolved.
- **DAL date-column matching audit** — `DAL.gs`'s `matchesConditions_()` uses loose `!=`, breaks on Date-object-vs-Date-object comparison (see `PROJECT_MEMORY.md` §3.1/§3.4 for the confirmed bug class). Full blast-radius sweep (2026-07-26): 242/243 call sites safe, one low-confidence unconfirmed case (`Job260337DuplicateFixer.gs:184`, string-vs-Date, likely coincidentally safe). Not urgent — proper fix is scoping `matchesConditions_()` itself as its own task.
- **Partition headers can diverge from canonical `SCHEMAS`** — proposed fix scoped, not implemented: `ensurePartition()`'s early-return path should verify existing headers against canonical `SCHEMAS`, not just tab existence. 0 blank-header partitions found in a full 2026-07-27 PROD scan; a few confirmed-harmless header-order/orphan-table cases found alongside. Low urgency — see git history for full detail if ever needed.
- **Payroll Automation Phase B1 (Items 2–3)** — status last checked 2026-07-29, not revisited since. Item 1 (RBAC/`HR_ACCOUNTING`) is live in PROD. Items 2 (onboarding proof) and 3 (PM bonus, fixed twice on real DEV findings) — **needs a status check**, may be stale/paused or simply forgotten. Branch `payroll-automation/phase-b1`. **Correction (2026-08-12): DEV was NOT actually holding this branch** — see DEV state note below; this item's "pushed to DEV" claim was stale/inaccurate and should be re-verified once DEV is repointed back to phase-b2.
- **DEV environment state (2026-08-12):** DEV had been running the **uncommitted working tree** of `payroll-automation/phase-b2` (found via `clasp pull` comparison — not any committed branch). That work is now committed (`payroll-automation/phase-b2` `0786b49`, not yet pushed to origin) plus backed up to `~/blc-nexus-dev-snapshot-2026-08-12.tar.gz`. DEV now holds `qc-findings-picker`/`main` post-merge. **To restore DEV to the phase-b2/Aug2026-partition-recovery state:** run `npm run push:dev` from `.worktrees/payroll-automation-phase-b2`.
- **Two real bugs found by W2-3's first-ever live test execution (2026-08-12), both fixed, merged in PR #21:** (1) `FACT_QC_FINDINGS` was missing from `DAL.gs`'s `PARTITIONED_TABLES` map, so every read/write resolved to a bare, never-created tab instead of a monthly partition (`FACT_QC_REVIEW_SESSIONS`/`FACT_QC_REVIEW_CHECKLISTS` have the identical latent gap, not fixed — no writer yet, will bite their first writer the same way). (2) Google Sheets silently coerces a `"TRUE"` string into a real boolean on write; `String(true) === 'true'` (lowercase) failed a strict `=== 'TRUE'` check on `DIM_QC_FINDING_TYPES.active_flag`, rejecting every finding code as inactive despite correct seed data. Fixed in `QCHandler.gs` and `Portal.gs` (`.toUpperCase()` before compare). **Standing gotcha:** any future `DIM_*`/`FACT_*` table with a `TRUE`/`FALSE` column will hit this same coercion.
- **Q2 bonus wiring check (2026-09-15, two forks + advisor, YELLOW verdict)** — calculation code is real and correctly wired end-to-end (feedback + TL/PM/CEO ratings genuinely feed `QuarterlyBonusEngine.gs`, 312 tests passing, no `DAL.gs` write-permission gaps). Exposure is entirely in unconfirmed operational follow-through — same pattern as the Aug2026 bonus bug (Rajkumar/Deb Sen supervision rows) and the `Aug2026BonusAdjustment` write-permission gap: code shipped, the data-side step it depended on was never confirmed done. **Run in this order — each gates the next:**
  1. **BLOCKER — run first:** `runQ2RatingsPreflightCheck()` in `src/12-migration/Q2RatingsPreflightCheck.gs:41`. Last known value "0/13 active staff confirmed" is a stale mid-August read, not current — nobody knows today's real number. If it's still near-zero, there is no Q2 bonus to calculate yet (`getInternalRatings_`, `QuarterlyBonusEngine.gs:319`, requires TL+PM scores for designers / CEO scores for TLs+PMs — missing ratings means missing bonuses, not wrong ones). The other two items below are precision problems that only matter once this one clears.
  2. `runQ2ReworkCycleBackfill(false)` in `src/10-payroll/QuarterlyBonusEngine.gs:2676` — fixes a `rework_cycle` data bug affecting ≥4 real jobs' QC error rates feeding the Q2 calc. Written and committed with `dryRun=true` default; no record it was ever run live. Run only after step 1 confirms there's real data to protect.
  3. `runQ2RatingsPeriodIdCheck()` (`QuarterlyBonusEngine.gs:2400`) and `runQ2BonusLedgerPeriodIdCheck()` (`QuarterlyBonusEngine.gs:2428`) — read-only diagnostics for a documented `period_id` corruption risk, confirmed unconfirmed for `FACT_PERFORMANCE_RATINGS`, never even checked for `FACT_CLIENT_FEEDBACK` (`QuarterlyBonusEngine.gs:306-318`). Never run.
  - **Unverified, not clean:** `installFeedbackTrigger()` (`src/09-feedback/ClientFeedbackTrigger.gs:187`) — fork ran out of budget confirming this fired this quarter. If it never ran, client feedback collection may not have fired at all, independently explaining thin Q2 data. Flagged, not chased.
  - **Systemic takeaway (advisor):** this is the third time in one quarter that code shipped ahead of an unconfirmed data step. Worth one line in the payroll/bonus run checklist: every `dryRun` default flipped and logged, every migration script's `WRITE_PERMISSIONS` entry present, before calling a bonus run "ready."
  - **REAL PROD Q2 readiness numbers (2026-09-15, via the new "🔍 Check Quarter Readiness" portal button, first live PROD run):**
    - **Ratings: 7/16 confirmed, 9 missing (2026-09-15, in progress)** — SGO, BCH, SDA, SVN, PBG, DBG, DBS, RKU, AR001. Several are TL/PM raters (SGO, BCH, SDA, SVN, DBS), so their own missing CEO rating also blocks their designers' scores downstream. Quarter ended 2026-06-30. **Reminders sent 2026-09-15** — all 3 rater rows in the portal's "Ratings Gaps" table ("Send Reminder") confirmed Sent, covering the full missing list. **Still open: waiting on actual submissions** — re-run "🔍 Check Quarter Readiness" for Q2 in a few days to confirm the 9 have dropped before running the real Q2 bonus.
    - **Rework-cycle backfill: APPLIED 2026-09-15** — 4/4 jobs updated, 0 not found. Matches Fork 1's original "≥4 real jobs" finding exactly. Closed — no further action.
    - **period_id integrity: CLEAN on PROD, both tables.** DEV showed 5 corrupted `FACT_PERFORMANCE_RATINGS` rows (proving the coercion bug class is real, not hypothetical), but PROD's real data has none. This risk is closed for Q2 — no further action needed.
  - **Client feedback completeness added to the readiness check (2026-09-15, on direct request "are the customer feedbacks there for Q2")** — no tool had ever checked this before; the original investigation only ever covered internal TL/PM/CEO ratings. `QuarterlyReadinessEngine.runQuarterlyReadinessCheck` now also reports `client_feedback: { total_responses, by_month }` — one call per month of the quarter to the real `ClientFeedback.getFeedbackStatus` (`src/09-feedback/ClientFeedback.gs:332`), since client feedback is tracked per-month, not per-quarter. Not yet run against PROD for Q2 — next portal click on "🔍 Check Quarter Readiness" for Q2 will show the real answer.

- **"Full quarterly cycle automation" feature check (2026-09-15, advisor-reviewed)** — user asked whether the portal auto-sends feedback/rating requests every quarter and auto-generates the bonus statement, per "requirements/architecture." Checked both source docs directly, not just current code:
  - `docs/superpowers/specs/2026-04-06-quarterly-bonus-engine-design.md` (the original approved spec) never specifies an unattended cycle — step 1 is "prompt for quarter/year," step 11 is "show summary alert," §4.4 is "Raj reviews BONUS_LEDGER → approves." The only "automatic" in the whole doc (line 208) is annual bonus auto-chaining after a quarterly run, not scheduling.
  - `.worktrees/payroll-automation-phase-b1/PAYROLL_AUTOMATION_ARCHITECTURE.md` (the actual architecture doc — not in `main`, only in two worktrees) states outright: **"Payroll itself has zero triggers... No `ScriptApp.newTrigger` for payroll automation"** (line 236-241), and its trigger inventory (row 10) explicitly logs the quarterly rating request/reminder as "manual CEO action," same for the client feedback request (row 12, `ClientFeedback.gs:565`).
  - **Conclusion: nothing was missed. The requirements never called for a fully unattended cycle** — a human-triggered send + explicit review/approve was the intended design from day one, not a shortcut taken under deadline pressure.
  - **What IS genuinely built and CEO-reachable today** (confirmed via `PortalView.html:443-444`, real buttons wired to live backend, not editor-only): "✉ Send Feedback Requests" → `ClientFeedback.gs` flow (form → `onFeedbackFormSubmit` → queue → `FACT_CLIENT_FEEDBACK`) and "📋 Send Rating Requests" → `PortalData.sendRatingRequests()`, which does include the CEO as a rater (`RatingRequestPreview.gs`'s `isCeo` branch) — TL/PM/CEO are all covered, not just TL/PM. `getRatingsGaps`/`sendRatingReminder` (`PortalData.gs:1132,1249`) already exist to chase stragglers, also manual.
  - **What's genuinely absent:** (1) any time-based trigger to fire those two sends automatically each quarter (confirmed via full-repo `ScriptApp.newTrigger` sweep — none exists for this); (2) auto-commit of the bonus once data is complete — and this one is a **deliberate ADR, not a gap**: `SOP_DECISIONS.md:454`, dry-run-only by design, checksum-gated runId enforcing "can't commit what wasn't previewed," put in place after the Q1 2026 bonus was computed over 616h+215h of contaminated migrated hours and needed a full amendment. A "statement generator" partially exists too — `previewPayoutStatement` (`docs/superpowers/specs/2026-08-26-payout-statement-design.md`) can include quarterly bonus as an opt-in preview section, but by design never sums it into a total, because quarterly/annual bonus "has no confirmation mechanism at all today."
  - **Recommended next-quarter build (not started, not scoped):** a scheduled trigger that fires the two existing portal-send functions automatically each quarter, plus surfaces `getRatingsGaps` output to the CEO — gets nearly all the value of "automatic" with none of the risk. Explicitly do **not** automate the commit step; that gate stays manual per the standing ADR.
  - **Not a Q2-payout blocker** — this is a next-quarter build question, doesn't touch the imminent Q2 run. `runQ2RatingsPreflightCheck()` (see item above) remains the actual next action.
- **First-ever supervised HR_ACCOUNTING/ADMIN Run Billing click** and **CEO smoke-test of Generate Timesheet with a real range** — both still open from the 2026-08-06 PR #15 thread, not yet confirmed done.
- `runSendOnboardingEmailToARN()` — harmless one-off sitting in `StaffOnboardingMailer.gs`, safe to delete whenever that file is next touched.
- **19 truly orphaned job_numbers** (post-cutover, don't resolve via normalization) — needs a manual decision: create VW rows for them, or write them off. See `PROJECT_MEMORY.md` §12 ADR-WL-001.
- **Admin overhead policy decision** — how should `"job assign & help"`-style non-job hours be tracked going forward? Separate pseudo-job in VW, or excluded entirely from work-log reporting?
- **`submitted_at`/`created_at` bug in `writeQueueItem`** — identified 2026-07-08, not yet fixed.
- **Test suite uses some real staff identities** — needs a DEV-only-synthetic-actor pass; a lot of this session's own work already moved this direction, but the original audit item was never formally closed.
- **Inactive staff security check** — review RBAC/portal access for staff marked `active=FALSE` in `DIM_STAFF_ROSTER`, not re-verified since the 2026-06-29 active-flag fix.
- **June billing** — was blocked on Sarty confirmation of June 06B reconciliation findings + outstanding designer hour submissions; status not rechecked recently.
- **Business/ops, non-code**: forward 16 Q1 bonus letters (₹72,231.13, sitting in CEO inbox) to designers; send Q2 rating + feedback requests via portal (confirm current quarter status first); raw Q1 `FACT_WORK_LOGS` dedup (1,694 rows from a Jan–Mar CSV re-import, bonus already corrected via amendment, raw data itself still uncleaned).
