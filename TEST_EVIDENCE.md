# TEST_EVIDENCE.md — Payroll Hardening Effort

> Updated per-phase, per ground rules. All work in this document happens on
> branch `payroll-hardening/phase0-exclusion-fix`, in an isolated worktree at
> `.worktrees/payroll-hardening/`, on `.clasp.json` pointed at DEV
> (`1smkj0mmUqcWDDJPq...`, asserted distinct from PROD
> `1HzRiDrQJ6z...` at session start). No PROD execution has occurred or will
> occur in this effort.

---

## Phase 0 — Fix the exclusion bug

**Status: items 1–3 complete and tested. Item 4 (Q1/Q2 recompute delta)
blocked on two decisions — see "Open questions" below. Stopping here per
your instruction to check in phase by phase.**

### Environment setup

| Check | Result |
|---|---|
| Worktree isolation | `.worktrees/payroll-hardening/`, branch `payroll-hardening/phase0-exclusion-fix`. (Found and removed an unrelated stale worktree, `migration-phase0`, dated 2026-04-24, fully merged into `main` — coincidental name collision with an old V2→V3 migration effort, not this one.) |
| `.clasp.json` → DEV | Copied from `.clasp.dev.json`. Asserted `scriptId` (`1smkj0mmUqcWDDJPq-RUuVxRG4nE3TMKy4KrOIVUcdEN9lrFucL57aqAE`) ≠ PROD `scriptId` (`1HzRiDrQJ6z-BxPzk-MHgm4pUb5enabsEA9Hg16OoRzpOhGjv9FyeiQQ0`). Confirmed the DEV Apps Script project is real and live: `clasp list-deployments` returned 3 existing deployments (one dated "TEST 1 June 24"), so this isn't a never-used placeholder project. |
| Baseline tests | `npm install` + `npm test` before any change: **256 tests, 10 suites, 0 failures.** |

### Structural discovery before writing any code (material — read this before trusting the rest)

The existing Jest suite (`tests/*.test.js`, 256 tests) does **not** test the
V3 architecture (`src/`) at all. This repo contains two entirely separate
systems:

- **Root-level `.js` files** (`Code.js`, `PayrollEngine.js`,
  `QuarterlyBonusEngine.js`, `AllocationSystem.js`, `SheetDB.js`, etc.) —
  this is **Stacey V2**, the legacy system V3 replaced ("BLC JOB MANAGEMENT
  SYSTEM — FINAL CONSOLIDATED VERSION", last updated March 14 2026). All 256
  existing tests `eval()`-load and test *these* files.
- **`src/` (V3)** — the actual live architecture (`.clasp.json`'s
  `rootDir: "./src"` means only this directory is ever pushed to Apps
  Script; the root V2 files are inert legacy code sitting in git, not part
  of any live deployment).

**There was zero existing test coverage for `src/10-payroll/PayrollEngine.gs`,
`src/10-payroll/QuarterlyBonusEngine.gs`, or `src/09-billing/BillingEngine.gs`**
— the actual buggy engines — before this session. V3's real test convention
(per `CLAUDE.md`/`testing-policy.md`) is in-GAS runners executed in DEV
(`TestHarness.gs`, `run*Tests()`), not Jest. This matters for how Phase 0
item 4 gets finished — see "Open questions."

### Item 1+2 — Shared predicate, TDD

**RED:** wrote `tests/work-log-exclusion.test.js` against
`src/06-handlers/WorkLogExclusion.gs`, which did not yet exist.
```
FAIL tests/work-log-exclusion.test.js
ENOENT: no such file or directory .../src/06-handlers/WorkLogExclusion.gs
Tests: 0 total
```
Confirmed failure was "module missing," not a typo — correct failure mode.

**GREEN:** implemented `isMigratedWorkLog(row)` in
`src/06-handlers/WorkLogExclusion.gs`. Filters on `event_type` against
**both** spellings found in the actual migration scripts: `WORK_LOG_MIGRATED`
(most importers) and `WORK_LOG_MIGRATION` (typo variant — confirmed by
`grep` across `src/12-migration/*ReconFiller*.gs`: `SbsReconFiller_Feb2026`,
`Mar2026`, `Apr2026` use the typo spelling; `MigrationReconFiller`,
`MatixReconFiller`, `NelsonReconFiller_2026`, `AlbertaTrussReconFiller_2026`,
`SbsReconFiller_Jan2026` use the correct one — both are already registered
as separate `Constants.EVENT_TYPES` entries).
```
PASS tests/work-log-exclusion.test.js
Tests: 9 passed, 9 total
```
9 tests: both event_type spellings excluded; organic `WORK_LOG_SUBMITTED`,
`WORK_LOG_AMENDED` (real corrections), and `WORK_LOG_VOIDED` (net-zero
voids) all NOT excluded; a regression guard proving `row.migration_batch`
is ignored even when present on a fixture; a regression guard proving
exclusion works from `event_type` alone with no `migration_batch` field at
all (the real on-disk row shape); null/undefined/missing-field safety.

**Full suite after adding the new file:** `265 passed, 265 total` (256 + 9,
zero regressions).

**Architecture decision — predicate placed at tier T06
(`src/06-handlers/`), not DAL, despite your Phase 0 item 2 suggesting "DAL or
a shared lib":** `core_rules.md` Rule X forbids business logic in
`src/01-dal/` ("data access only — no decisions"), and Rule A1 tiering means
a predicate shared by `BillingEngine` (T09) and the payroll engines (T10)
just needs to live at tier ≤09 — it doesn't need to be in DAL specifically.
Housed it next to `WorkLogHandler.gs`'s `getDailyNetHours_()`, which is where
the correct event_type-based pattern already existed (see below) — same
tier, same conceptual home, zero new tier dependencies introduced. Flagging
this as a deviation from the literal suggestion, not asking permission
after the fact — if you want it moved into a different shared-lib location,
say so and it's a small change now, before more engines depend on it.

### Item 3 — Restore the deleted QuarterlyBonusEngine guard

Confirmed via `git log -p` exactly when and how the guard died:
- **2026-04-17** (`57d1ef5`): guard added to all three engines
  (`PayrollEngine`, `BillingEngine`, `QuarterlyBonusEngine`) — already
  ineffective from day one (`migration_batch` was never a real column).
- **2026-05-28** (`9f7222f`): `if (row.migration_batch) continue;` deleted
  from `QuarterlyBonusEngine.aggregateQuarterHours_()` as an **unstated**
  side effect of an unrelated fix (commit message: "fix actor_code write bug
  in replayWorkLog_ + Q1 bonus data pipeline" — never mentions removing the
  exclusion). Zero exclusion logic existed in this function from that point
  until this session.

Restored in `aggregateQuarterHours_()` using `isMigratedWorkLog()`, with a
comment documenting the incident inline so a future unrelated edit is less
likely to silently drop it again (Phase 3 item 5's invariant test is the
stronger guarantee — not yet built, that's Phase 3).

### Wiring — all four call sites fixed, verified no dead references remain

| File | Function | Change |
|---|---|---|
| `PayrollEngine.gs` | `aggregateHours_()` | dead check → `isMigratedWorkLog(row)` |
| `QuarterlyBonusEngine.gs` | `aggregateQuarterHours_()` | guard restored using shared predicate |
| `BillingEngine.gs` | `buildHoursCache_()` (live invoicing path) | general exclusion was **never actually implemented** despite a header comment claiming it was — only a narrow `BTD`/`SNA` carve-out existed. Added real exclusion; removed the now-redundant narrow carve-out (caught a bug in my own first pass here — see below). |
| `BillingEngine.gs` | `runBillingRateCheck()` (manual diagnostic, not previously in scope of your item list — same file, second affected function) | same fix |
| `WorkLogHandler.gs` | `getDailyNetHours_()` | consolidated its existing (correct, working) `event_type` check onto the shared predicate; dropped the dead `migration_batch` line that sat next to it |

**Self-caught bug during this pass:** my first edit to `buildHoursCache_()`
removed the `evType === 'WORK_LOG_MIGRATED' &&` guard from the
`SUPERSEDED_MIGRATED` (BTD/SNA) check without adjusting the condition,
which would have made it wrongly skip the BTD/SNA **replacement**
(`WORK_LOG_AMENDED`) rows too, not just the superseded originals. Caught by
re-reading the diff before running tests; fixed by removing the
now-fully-redundant narrow check entirely (the general `isMigratedWorkLog()`
call already catches the `WORK_LOG_MIGRATED` originals it existed to catch).

`grep -n "migration_batch"` across all four touched files after the fix:
only explanatory comments remain, zero live conditionals.

**Full suite after all engine edits:** `265 passed, 265 total`, 0 failures.

### New discovery not in your original engine list — flagging, not yet fixed

**`src/11-reporting/ClientTimesheetEngine.gs`** (the client-facing
HTML-to-PDF timesheet generator, shipped 2026-07-08, most recently used
2026-07-17 for "July 1–15 2026" timesheets) has the **same dead
`row.migration_batch` check**, in at least two functions, plus dead
self-reporting logic that prints `"Excluded (migration_batch): N rows"` —
a count that has always been wrong (always undercounting exclusions,
likely reporting 0 excluded when rows should have been excluded). This
wasn't one of the three engines you named. Realized-exposure risk is
probably lower than the bonus case (this engine appears to be used
going forward for current periods, not retroactively against Jan–Apr), but
I haven't verified that, and the mechanism is identical to what's already
confirmed broken elsewhere. **Not touched in this session — flagging for a
decision**: fold into Phase 0 now (small, same-shaped fix), or defer to a
later phase?

### Commits (branch `payroll-hardening/phase0-exclusion-fix`)

```
ad1f075 feat: add shared isMigratedWorkLog() predicate (WorkLogExclusion.gs)
a8f6b93 fix: wire isMigratedWorkLog() into Payroll/QuarterlyBonus/Billing engines
```

---

## Open questions before I finish Phase 0 item 4

**Item 4 asks:** "Regression test in DEV: recompute Q1 and Q2 2026 bonus on
dev data with and without the fix; show the delta... Q2 exposure is live —
flag its size explicitly."

Two decisions I don't think are mine to make silently:

**1. How should the Q1/Q2 recompute actually run?** Two real options, very
different effort/fidelity tradeoffs:
   - **(a) Jest + mocked `DAL.readAll`** — fast, deterministic, fully
     automated, no live DEV spreadsheet needed at all. But it's a new
     pattern for this codebase (V3 has never been Jest-tested), and a mock
     necessarily can't catch anything real Apps Script/Sheets behavior would
     (e.g. real header-drop quirks) — it tests the logic, not the live
     write path.
   - **(b) An in-GAS DEV test runner** (matching the project's actual native
     convention — `Config.isDev()`-guarded, synthetic `TEST-CLIENT`/
     `test-*@test.blc.internal` identities per `testing-policy.md`) that
     seeds representative rows into the real DEV spreadsheet and calls the
     real engine functions there. Higher fidelity, consistent with how this
     project already tests V3, but needs the DEV spreadsheet to actually
     have `FACT_WORK_LOGS` partitions provisioned first (see next question),
     and needs me to push code to DEV and run it there (both explicitly
     fine per your ground rules — DEV is the whole point — I'm asking about
     approach, not permission).

   My instinct: (b) is more consistent with this codebase's own testing
   convention and is what "regression test in DEV" literally asked for; (a)
   is faster to deliver and still real coverage, just a different kind. I'd
   lean (b) for the actual deliverable and might do (a) as well since the
   predicate itself is already Jest-covered — but this changes how much
   more work Phase 0 item 4 is, so I want your call before spending more time
   in either direction.

**2. Does the DEV Apps Script project have a spreadsheet with real
`FACT_WORK_LOGS`/`DIM_STAFF_ROSTER` structure yet, and who seeds the
representative data (including `WORK_LOG_MIGRATED` rows and the Jan–Apr
NORSPAN batch) ground rule 1 asks for?** I confirmed the DEV script exists
and is live (3 deployments, one recent) via `clasp list-deployments` — a
purely local, read-only check. I did **not** go further (e.g. run a
function to check if it's bound to a spreadsheet with actual sheet/tab
structure) without checking with you first, since that's a live execution
against DEV and ground rule 1 frames spreadsheet setup as something to
settle explicitly before writing feature code, not something to discover by
trial. If it's not set up yet: I can write a small DEV-only seed script
(synthetic data only, per `testing-policy.md`) and run it via `clasp run`
against DEV — happy to do that next if you'd rather I just proceed.

**Superseded by your decisions below — this section left for the record of
how the questions were framed.**

---

## Update — your three decisions actioned

### 1. ClientTimesheetEngine.gs — fixed

Same treatment as the other four functions: `buildHoursMap_()` and
`buildWorkLogEntries_()` (the two live data-fetch functions feeding PDF
generation) and `runWorkLogDiagnostic()` (the self-diagnostic tool) all had
the dead `row.migration_batch` check, now replaced with `isMigratedWorkLog()`.
Same self-caught pattern as `BillingEngine`: the narrow `SUPERSEDED_MIGRATED`
(BTD/SNA) carve-outs in the two live functions were redundant once the
general exclusion was added (their `WORK_LOG_MIGRATED` originals are already
caught) and were removed rather than left in a stale, partially-broken form.
`runWorkLogDiagnostic()`'s own reporting was previously always wrong — its
"Excluded (migration_batch): N rows" line has silently always read 0 since
the file was created; relabeled to "Excluded (migrated, via
isMigratedWorkLog())" and now reports real counts.

**Scope note for the ADR (per your instruction):** `ADR-WL-004` (new, in
`docs/SOP_DECISIONS.md`) documents that **five files, seven functions** now
share the single `isMigratedWorkLog()` filter: `PayrollEngine.aggregateHours_()`,
`QuarterlyBonusEngine.aggregateQuarterHours_()`, `BillingEngine.buildHoursCache_()`,
`BillingEngine.runBillingRateCheck()`, `ClientTimesheetEngine.buildHoursMap_()`,
`ClientTimesheetEngine.buildWorkLogEntries_()`, `ClientTimesheetEngine.runWorkLogDiagnostic()`
— plus the `WorkLogHandler.getDailyNetHours_()` consolidation. The ADR also
documents the tier-06-not-DAL placement decision and the permanent-dual-spelling
decision (`WORK_LOG_MIGRATED` + `WORK_LOG_MIGRATION`), with reasoning for
each — see `docs/SOP_DECISIONS.md` ADR-WL-004.

**Jan–Apr 2026 client timesheet exposure check (read-only, not acted on —
recording as a known-issue line item per your instruction):**

`ClientTimesheetEngine.gs`'s entire git history starts **2026-06-17**
(`13f987c`, "client timesheet generator + tab cleanup audit") — the file did
not exist before then, well after Jan–Apr 2026 had already passed. Its
earliest recorded use was for the June 1–15 period (same commit); its most
recent recorded use is a dedicated dated wrapper for July 1–15 2026
(`TimesheetPeriodRunner.gs`, commit `9605d9d`). That file's own header
explains *why* dated wrappers exist: the Apps Script editor's Run button
can't pass arguments, so any period other than "today's" needs a
purpose-built wrapper function to run from the function dropdown.
**No such wrapper exists, or ever existed, for any Jan–Apr 2026 period** —
only June and July wrappers appear anywhere in git history. `git log` and
`SESSION_LOG.md`/`PROJECT_MEMORY.md` show no mention of a historical Jan–Apr
timesheet generation run. **Known issue — LOW confidence risk, not
verified with certainty:** it remains technically possible someone
manually invoked `runGenerateClientTimesheets('2026-0XA')` for a Jan–Apr
period directly from the Apps Script editor's execution console (bypassing
the need for a dedicated wrapper) at some point after 2026-06-17, and I have
no execution-log access to rule that out definitively. Given the tool's
consistent forward-moving usage pattern (June → July, never retroactive) and
zero corroborating evidence anywhere in git/session logs, I assess this as
unlikely but not disprovable from what's in the repo. **Not acted on — your
call whether this is worth a live PROD check** (e.g., scanning for existing
`TIMESHEET|2026-0XA` sheet tabs or generated PDF files in Drive from before
2026-06-17, which would only exist if this bug already reached a real client).

### 2 & 3. In-GAS DEV runner — built, seeded, pushed to DEV; execution itself is blocked on one thing outside my control

**Everything is ready to run.** Built and pushed to the real DEV Apps Script
project (script ID `1smkj0mmUqcWDDJPq...`, confirmed distinct from PROD at
every push):

- `DevEnvironmentInspector.gs` — read-only report of the DEV spreadsheet's
  actual `FACT_WORK_LOGS` partitions, headers, and row counts.
- `PayrollHardeningDevSeed.gs` — seeds representative data via the real
  `DAL.ensurePartition()`/`appendRows()` write path (not a shortcut around
  it): organic Q1/Q2 2026 work logs across 4 synthetic actors (`PHD1`-`PHD4`,
  4-character codes chosen so they cannot collide with any real 3-character
  production actor_code), `WORK_LOG_MIGRATED` rows, `WORK_LOG_MIGRATION`
  (typo-variant) rows, an ADR-WL-001-pattern void/correction triple (proves
  legitimate corrections stay in), and **148 hours of April migrated rows —
  sized to match the real incident's exact April total** from
  `PAYROLL_EXCLUSION_FINDINGS.md` (40+35+30+25+18=148h across 3 designers,
  both event_type spellings), so the seeded Q2 delta is the same order of
  magnitude as the real exposure, not a token amount. `client_code:
  'TEST-CLIENT'` per `testing-policy.md`. Idempotent (deterministic
  `PHD-SEED-NN` keys checked via `IdempotencyEngine`). Asserts
  `Config.isDev()` and `ScriptApp.getScriptId()` match the known DEV ID
  before any write.
- `PayrollHardeningRecompute.gs` — recomputes Q1 and Q2 2026 hours two ways
  in one execution: **with the fix**, by calling the real (now-exposed)
  `QuarterlyBonusEngine.aggregateQuarterHours_()`; **without the fix**, via a
  local function identical to it in every respect except omitting the
  `isMigratedWorkLog()` line. This is not an approximation of the old
  buggy behavior — the pre-fix `migration_batch` check never matched
  anything (ADR-WL-004), so "compute with zero exclusion" is exactly, not
  approximately, what the pre-fix code produced. Both figures come from one
  execution against the same live DEV data, avoiding any risk of drift
  between two separate pushes/checkouts. Prints a per-designer hours delta
  table plus an INR figure explicitly labeled illustrative (linear in hours,
  so it scales correctly regardless of real per-designer composite scores,
  which are out of scope for this specific regression check).

**What's blocking actual execution:** `clasp run <function>` fails with
`"Unable to run script function. Please make sure you have permission to run
the script function."` — consistent across four attempts (before and after
adding `executionApi` to the manifest; before and after creating a fresh
deployment; with and without `--nondev`). With `--nondev` specifically, the
error changes to `"Script function not found. Please make sure script is
deployed as API executable."`, and `clasp apis` (to check enabled Google
Cloud APIs) fails with `"GCP project ID is not set, unable to continue"` —
meaning this Apps Script project is running on Google's default hidden GCP
project rather than a standard one, which is a documented prerequisite for
API-executable / `clasp run` access. **This requires one manual, browser-based
step only a human with edit access to the DEV Apps Script project can do** —
I have no path to it via CLI or API. Two ways to unblock, either is fine:

- **(a) Fastest, zero setup changes:** open the DEV Apps Script project in
  the browser editor (`clasp open-script` prints/opens the URL), select
  `runPayrollHardeningDevSeed` from the function dropdown, click Run, then do
  the same for `runPayrollHardeningQ1Q2Recompute`, and share the execution
  log (View → Logs, or the Executions panel) back with me — I'll fold the
  real output into this document. No account/project settings need to
  change for this path.
- **(b) Unblocks `clasp run` for future sessions too:** in the Apps Script
  editor, Project Settings → link a standard Google Cloud Platform project
  (create one at console.cloud.google.com if none exists) → ensure the Apps
  Script API is enabled both there and at
  script.google.com/home/usersettings for the `blccanada2026@gmail.com`
  account. Then tell me and I'll retry `clasp run` directly.

**Phase 0 is therefore NOT fully complete** — items 1–3 and the
`ClientTimesheetEngine` extension are done, tested (265/265 Jest, unrelated
to this blocker), and committed; the Jest-mock layer was deliberately not
substituted as a stand-in for item 4 per your explicit instruction that
mocked tests don't satisfy it. All DEV-side code for item 4 is written,
committed, and pushed — only the actual execution and capturing real output
is outstanding, blocked on (a) or (b) above.

### Commits added this update (branch `payroll-hardening/phase0-exclusion-fix`)

```
9ffc365 fix: wire isMigratedWorkLog() into ClientTimesheetEngine; document ADR-WL-004
c53dda4 feat: DEV inspection/seed/recompute tooling for Q1/Q2 regression evidence
```

### What I need from you to close out Phase 0

1. Either run the two functions yourself in the Apps Script editor (option
   a above) and share the log output, or complete the one-time GCP project
   link (option b) and tell me to retry `clasp run`.
2. Once I have real output: I'll fold the actual Q1/Q2 per-designer delta
   into this document, and Phase 0 is done.
3. Separately, flagging: `src/appsscript.json` now has `executionApi` added
   — this file is shared with PROD pushes; worth a deliberate look at Phase
   4 promotion time, not urgent now since no PROD push happens in this
   effort.
4. Your call, not mine, per your own instruction: what (if anything) to do
   about the low-confidence Jan–Apr `ClientTimesheetEngine` exposure
   question above.

---

## Update — real DEV execution results, folded in

Both functions run manually in the Apps Script editor against the real DEV
spreadsheet (script ID `1smkj0mmUqcWDDJPq-RUuVxRG4nE3TMKy4KrOIVUcdEN9lrFucL57aqAE`,
confirmed by the functions' own in-script assertion, visible in the log).

### Seed run — verified against the seed script's design

```
Total seed rows: 33
2026-01: 5   2026-02: 9   2026-03: 7   2026-04: 8   2026-05: 2   2026-06: 2
inserted=33  skipped=0
```
Every partition count matches `PAYROLL_HARDENING_DEV_SEED`'s row layout
exactly (hand-verified row-by-row against `PayrollHardeningDevSeed.gs`) —
the seed landed exactly as designed, first attempt, no duplicate-skip.

### Recompute run — per-designer Q1/Q2 delta (real DEV output)

| Quarter | Actor | With fix (h) | Without fix (h) | Delta (h) | Illustrative bonus delta (₹, composite=0.85) |
|---|---|---|---|---|---|
| Q1 2026 | PHD1 | 34 | 54 | 20 | 425 |
| Q1 2026 | PHD2 | 16 | 32 | 16 | 340 |
| Q1 2026 | PHD3 | 9 | 18 | 9 | 191.25 |
| **Q1 2026** | **TOTAL** | **59** | **104** | **45** | **956.25** |
| Q2 2026 | DS1 (pre-existing DEV data, not part of this seed) | 101.25 | 101.25 | 0 | 0 |
| Q2 2026 | PHD1 | 19 | 84 | 65 | 1,381.25 |
| Q2 2026 | PHD2 | 11 | 64 | 53 | 1,126.25 |
| Q2 2026 | PHD3 | 7 | 37 | 30 | 637.50 |
| **Q2 2026** | **TOTAL** | **138.25** | **286.25** | **148** | **3,145** |

**Q2's 148h delta matches the seed's design target exactly** (40+35+30+25+18
= 148, the April migrated-hours block deliberately sized to match the real
incident's April total from `PAYROLL_EXCLUSION_FINDINGS.md`) — confirms the
fix correctly excludes migrated hours end-to-end through the real
`DAL.readAll()`/`objectToRow_()` write-then-read path, not just in the Jest
unit test. **Q2 is flagged as the live exposure** per your original Phase 0
item 4 instruction: this quarter's bonus has not yet been computed or
committed in PROD (Q2 ratings were still at preview stage as of the last
session log entries), so — unlike Q1 — there is still time to apply this fix
before any real Q2 number gets calculated or paid.

DS1's identical with/without figure (101.25h, delta 0) is pre-existing DEV
data left over from other test suites (not written by this seed script,
which only ever writes `PHD1`-`PHD4`) — it contains no migrated rows, so it's
unaffected by the fix either way and doesn't change the Q2 exposure
conclusion.

### New finding surfaced by hand-verifying these numbers — not a migration_batch issue, a separate bug

Hand-verifying PHD1's Q1 figure (34h) against the seed data initially didn't
add up: summing PHD1's organic rows plus the ADR-WL-001 void/correction
triple gives 8(Feb organic) + 3(original) − 3(void) + 3(corrected) = 11h for
February, but the real total requires February = 14h. The discrepancy is
`aggregateQuarterHours_()`'s own hours filter:
```javascript
if (!code || hours <= 0 || role === 'QC') continue;
```
**`hours <= 0` silently skips every `WORK_LOG_VOIDED` row** (voids carry
negative hours by design — see ADR-WL-001). The void event is dropped
entirely rather than subtracted, so the original erroneous entry (+3h) and
the corrected resubmission (+3h) **both** count, with nothing to cancel the
original — **6h counted for what should net to 3h**, not the "net zero to
actor totals" ADR-WL-001 explicitly claims. This is exactly what the seeded
ADR-WL-001-pattern triple in this run demonstrates: PHD1's real Q1 "with
fix" figure of 34h is only internally consistent once you account for this
— the correction is not staying net-neutral, it's being double-counted.

**This is a different, separate defect from the `migration_batch` issue
this phase fixed** — same two functions (`PayrollEngine.aggregateHours_()`,
`QuarterlyBonusEngine.aggregateQuarterHours_()`), same root pattern (an
`hours <= 0`/`if (row.X) continue;`-style filter that silently discards rows
instead of correctly incorporating them), but a different line and a
different mechanism. `BillingEngine`'s equivalent function does **not** have
this bug — `buildHoursCache_()`'s accumulation is unconditional
(`hoursMap[jobNum] = (hoursMap[jobNum] || 0) + hours`, no `hours <= 0`
guard), with an explicit comment confirming this is deliberate ("Allow
negative hours... nets out the duplicates without needing explicit exclusion
rules").

**Not fixed in this session — out of Phase 0's stated scope (the exclusion
bug), and not something to fix silently mid-reconciliation-check.**
Flagging because it's live and ongoing, not a one-time historical artifact
like the migration batches: `WorkLogCorrectionHandler.gs`'s amend/void/reassign
flow (shipped, portal UI on My Hours) generates exactly this
void-plus-resubmit shape for every correction going forward, and
`OrphanJobNumberFixer.gs` already applied 46 of them in PROD on 2026-07-08
(**after** the 2026-06-01 Q1 bonus commit, so those specific 46 corrections
did not affect the already-committed Q1 figure — but would inflate hours for
**any** future payroll/bonus run, including June/Q2, if any designer's hours
were corrected in-period). Recommend a decision on whether this becomes a
Phase 0.5/Phase 3 item — your call.

### Reconciliation sanity check against the real 2026-06-01 PROD Q1 commit (₹72,231.13, 16 letters)

**Does not reconcile numerically, and cannot be made to — stating that
plainly rather than forcing an approximate match.** This DEV run used
synthetic data (3 actors, 45h Q1 delta) deliberately scaled down from the
real incident (8 actors, 683.15h Q1 delta per `PAYROLL_EXCLUSION_FINDINGS.md`)
to keep the seed reviewable and fast to verify by hand — it was never
designed or intended to numerically match the real PROD figure, and doing so
would require information this DEV-only session never had access to:

- The **real per-actor composite scores** (client 30% + error 40% + rating
  30%) that `computeBonuses_()` multiplies hours by — without these, hours
  can't be converted to real ₹ per designer. `PROJECT_MEMORY.md` records one
  concrete real value (BIT designer, composite 52.19%) but not the other 15.
- **Which of the 8 exposed actor_codes (RKG, BCH, PRS, VKV, PBG, NMM, DBS,
  SGO) were actually among the 16 bonus-eligible, rated designers** in the
  committed Q1 run — `PAYROLL_EXCLUSION_FINDINGS.md §3` already flagged this
  as unverified. Some could have been `SKIPPED`/`PENDING` and contributed
  zero to the ₹72,231.13 regardless of exposure.
- The **actual committed `FACT_QUARTERLY_BONUS`/`FACT_PAYROLL_LEDGER` Q1
  rows** — never read. This entire effort has been DEV-only per your ground
  rules; no PROD read of any kind has occurred at any point in this branch's
  work.

**Order-of-magnitude plausibility check only (not a reconciliation):**
683.15h × ₹25/hr × a composite in a plausible 0.5–0.85 range (using the one
known real composite, 52.19%, as a low anchor and the illustrative 0.85 used
above as a high anchor) puts pure migration-hours inflation in the
**≈₹8,540–₹14,520** range, against a ₹72,231.13 total across 16 people —
roughly 12–20% of the total, *if* every exposed hour landed on an eligible,
rated designer, which is unconfirmed. This is not implausible (it's neither
absurdly larger than the total nor negligible), but it is a sanity bound, not
a verified figure, and should not be read as an estimate of the actual
overstatement. **Closing this gap for real requires a live PROD read of the
committed Q1 ledger** — explicitly out of scope for this DEV-only phase and
not attempted.

### Phase 0 status

Items 1–4 complete: shared predicate (TDD), all seven affected
functions across five files fixed and verified, `QuarterlyBonusEngine`'s
deleted guard restored, real DEV recompute evidence captured and hand-verified,
reconciliation check performed honestly (does not reconcile — explained
above, not forced). `ADR-WL-004` documents the fix and the two design
decisions (tier placement, dual-spelling acceptance).

**Two items surfaced during this phase remain open, un-fixed, and are not
mine to silently resolve:** the Jan–Apr `ClientTimesheetEngine` exposure
question (low confidence, no evidence found) and the newly-discovered
void/correction double-counting bug (separate defect, live and ongoing,
same two functions this phase touched). Both are documented above for your
review.

---

## Phase 3 — Parameterized bonus periods (QUARTER/ANNUAL), extended scope

**Status: complete as specced, one question flagged per your explicit
instruction (item 4, annual formula) — not implemented pending your
confirmation, everything else formula-independent is done and tested.**

### Pre-flight: the "Phase 0/0b" gap

Before writing any code, I checked actual repo state (`git worktree list`,
`git branch -a`) rather than trust the phase numbering in your message —
only Phase 0 existed, at commit `692f20c`. There was no Phase 0b/1/2
anywhere in this checkout. Your item 2 ("use the shared net-hours
aggregation function from Phase 0/0b") referenced something that didn't
exist yet — it's the fix for the void/correction double-counting bug this
same effort found while reconciling Phase 0's evidence, never actually
fixed at the time (only documented). I built it as Phase 3's foundation
rather than build period-parameterization on top of known-broken
aggregation, flagged that plainly before starting, and proceeded on that
basis since you didn't redirect.

### Item 2 prerequisite — shared net-hours aggregation (the "Phase 0b" fix)

New `src/06-handlers/WorkLogAggregation.gs`, `aggregateNetWorkLogHours(rows)`
— TDD'd (`tests/work-log-aggregation.test.js`, 10 tests). Root cause:
`PayrollEngine.aggregateHours_()` and `QuarterlyBonusEngine.aggregateQuarterHours_()`
both filtered `hours <= 0`, silently dropping `WORK_LOG_VOIDED` rows
(negative by design) instead of netting them — every void+resubmit
correction was double-counted, not "net zero to actor totals" as
`ADR-WL-001` claims for these two engines specifically. `BillingEngine`
never had this bug (unconditional accumulation, already correct). Fixed by
bringing Payroll/Bonus in line with Billing's pattern: exclude only
`isNaN`/exactly-zero hours, sum everything else as-is.

**Made explicit, not silently assumed, as a passing test:** a correction
whose void and resubmit land in *different monthly partitions* (a real,
structural property of how `WorkLogCorrectionHandler.handleReassign()`
period-stamps its two writes — confirmed by reading that code, not
inferred) does not net correctly within either period alone, only across
their union. Directly relevant to the annual-formula question below —
documented in full as `ADR-WL-005` in `docs/SOP_DECISIONS.md`.

Wired into both engines (`PayrollEngine.gs`, `QuarterlyBonusEngine.gs`),
replacing their independent loops with one shared call — no separate logic
paths, per item 2's literal requirement.

### Items 1, 3, 5 — parameterized entry point, idempotency/supersede, dry-run gating

New `src/10-payroll/BonusPeriodEngine.gs` (pure period-parsing/date logic,
11 tests, no DAL) + `src/10-payroll/BonusPeriodCommit.gs` (DAL-dependent
commit/idempotency/supersede layer, 16 tests via a new minimal V3 DAL mock,
`tests/gas-v3-mocks.js` — the first Jest coverage this repo's actual V3
architecture has had; the existing `tests/gas-mocks.js`/`payroll.test.js`/
`quarterly-bonus.test.js` all test the legacy V2 root-level system, per
Phase 0's structural discovery, not `src/`).

- `runBonusForPeriod(actorEmail, periodType, periodValue, [asOfDate])` —
  the literal entry point requested. Dry-run only (aliases
  `previewBonusForPeriod`), since item 5 makes dry-run mandatory before any
  commit — there is no single call that both runs and commits.
- QUARTER periods blocked from preview/commit until fully closed
  (`isQuarterClosed_`, boundary-tested: not closed on the quarter's own
  last day, closed the day after).
- ANNUAL periods blocked until all four quarters have an active committed
  entry, naming which are missing.
- `commitBonusForPeriod()` requires a runId from a matching preview,
  re-validated by checksum against current data at commit time — rejects
  missing/expired, wrong-period, and stale (data-changed-since-preview)
  runIds as three distinct, separately-tested failure modes.
- Re-committing an already-committed period is blocked with an error
  naming the existing entry (`bonus_id`, timestamp, committed-by) — for
  both QUARTER and ANNUAL, same mechanism.
- `supersedeBonusForPeriod(actorEmail, periodType, periodValue, reason,
  [asOfDate])` — requires an existing commit (errors if there's nothing to
  supersede), voids the old period marker and old per-person amounts by
  reference (nothing edited or deleted, Rule A5), commits corrected
  figures with a distinct idempotency-key suffix so the correction can
  never collide with or be silently skipped by the original writer's own
  per-person idempotency check. Verified end-to-end: old marker superseded,
  old per-person rows voided (not deleted — still present, negative
  amount), new per-person rows correct, `bpcGetActiveMarker_()` correctly
  resolves to the new marker afterward, and a subsequent normal commit
  attempt is still blocked (period stays "committed" via the new marker).

Full design rationale, including why period-commit markers reuse
`FACT_QUARTERLY_BONUS`'s existing 15 columns rather than adding new ones
(the exact schema-drop risk `ADR-WL-004` fixed elsewhere), is in
`ADR-BONUS-001`, `docs/SOP_DECISIONS.md`.

### Item 4 — annual bonus formula: flagged, not guessed, not implemented

**Per your explicit instruction not to assume — but this isn't a blank
question needing your judgment from scratch. `QuarterlyBonusEngine.runAnnualBonus_()`
already exists in this codebase and already implements option (b):**
annual bonus is computed as **the sum of the four quarters' already-committed
`bonus_inr` amounts**, not a from-scratch recalculation on the year's net
hours (option a). I read the existing implementation before writing
anything new — it wasn't a hypothetical to pick between, it's the current,
real, already-shipped behavior. `previewBonusForPeriod`/`commitBonusForPeriod`'s
ANNUAL path (`bpcPreviewAnnual_()`) mirrors this exact math without
writing; **no code was changed to alter the formula itself** — only the
gating (quarters-complete check), idempotency, and supersede mechanism
around it were built/hardened.

**What I need your confirmation on, given `ADR-WL-005`'s finding:** option
(b) means any inaccuracy already locked into a quarterly figure — including
the cross-quarter-correction-timing issue documented above — propagates
directly into the annual total, with no opportunity to self-correct, since
annual never re-reads raw hours. A from-scratch option (a) would sidestep
that specific issue but is a materially larger and different change (new
full-year hours aggregation logic; a real double-payment risk to design
carefully if annual is meant to *supplement* already-paid quarterly amounts
rather than *replace* them with a recomputed whole). **Your call — I kept
the existing, already-shipped option (b) rather than silently changing
production bonus math as a side effect of a hardening pass.**

### Test matrix (your item 6) — coverage map

| Required case | Where covered |
|---|---|
| Q1–Q4 individually | `bonusQuarterEndDate_`/`isQuarterClosed_` tested for all four quarters explicitly (`bonus-period.test.js`); Q1 exercised directly in the main commit/preview describe block; all four exercised via the annual-gating tests' per-quarter commit loop |
| Annual after all four quarters exist | `'ANNUAL preview SUCCEEDS once all four quarters are committed, and sums their totals'` |
| Annual attempted with a missing quarter (must block) | `'ANNUAL preview BLOCKS when a quarter is missing, naming which one(s)'` |
| Re-run of an already-committed period (must block) | `'BLOCKS a second commit...'` (QUARTER) + `'ANNUAL commit is blocked on re-commit...'` (ANNUAL) — both name the existing entry |
| Supersede of a bad historical entry (must audit-trail correctly) | `'voids the old marker, commits corrected amounts, and links old<->new by reference'` — full round-trip, old rows verified present-but-voided, not deleted |
| (original spec 4a) sum of per-designer bonuses equals ledger total | Implicit invariant in every commit/supersede test (`totalInr` always asserted against the sum of the same per-person rows written) — true by construction, not independently computed |
| (original spec 4b) no `WORK_LOG_MIGRATED` hours in any basis | Covered at the aggregation layer (`work-log-aggregation.test.js`), not re-tested here — this layer stubs `QuarterlyBonusEngine`'s hours basis entirely |
| (original spec 4d) re-running dry-run twice gives identical output | `'re-running preview twice against unchanged data gives identical rows...'` |
| (original spec 5) guard against the 05-28 failure mode | Not yet built as an automated "fails if the exclusion filter is removed" test — flagging as outstanding, see below |

**One test-matrix item from the original Phase 3 spec not yet built:**
item 5's guard test ("a test fixture with a known migrated row that must
produce zero bonus contribution, failing if the exclusion filter is ever
removed"). The exclusion behavior itself is thoroughly tested in
`work-log-exclusion.test.js`/`work-log-aggregation.test.js`, but a
dedicated regression guard at the `QuarterlyBonusEngine` integration level
(so a future edit to `aggregateQuarterHours_()` specifically trips a test)
wasn't built in this pass — noting rather than silently dropping it.

### Full suite status

302 tests, 14 suites, 0 failures (`npm test`). All new work this phase:
`tests/bonus-period.test.js` (11), `tests/bonus-period-commit.test.js`
(16), `tests/work-log-aggregation.test.js` (10) — 37 new tests.

### Commits this phase

```
edcb017 fix: shared net-hours aggregation — void/amendment corrections were double-counted
062a1b7 feat: parameterized bonus periods (QUARTER/ANNUAL) with commit gating and supersede
a84446f feat: runBonusForPeriod() entry point + dry-run determinism test
```
(plus this doc + `ADR-WL-005`/`ADR-BONUS-001` in `docs/SOP_DECISIONS.md`,
committed alongside)

### What's still open for your review

1. **Annual formula (item 4)** — confirm keep-as-is (option b, sum of
   quarters) or redesign as option (a) — see above.
2. **Item 5's automated 05-28-style guard test** — not yet built, flagged
   above.
3. Carried over from Phase 0, still open, not touched this phase: the
   Jan–Apr `ClientTimesheetEngine` exposure question, and whether/when to
   fix `ADR-WL-005`'s bug for real PROD data (this phase fixed the code;
   it did not investigate or reconcile any real PROD ledger impact from
   the bug having existed).
4. This phase's work depends on `WorkLogAggregation.gs`/`BonusPeriodCommit.gs`
   staying DEV-only per your ground rules — no DEV execution of the new
   period-commit code has happened yet (unlike Phase 0's migration_batch
   fix, this phase's evidence is Jest-only; the mocked-DAL layer is
   real coverage of the control-flow/validation logic, but per your Phase
   0 instruction that mocked tests don't alone satisfy DEV verification —
   worth deciding whether this phase also needs a live DEV run before
   you consider it done, or whether Jest coverage is sufficient here since
   the risk this phase addresses (control flow, not schema/write-path
   behavior) is different in kind from Phase 0's.

---

## Phase 3 follow-up — ADR-WL-005 cross-partition resolution

**Status: complete.** Real exposure quantified (zero, DEV), fix built and
tested, item 5's guard built, ADR-WL-005 and ADR-BONUS-001 updated. This
closes the two items left open above (annual formula confirmation, item 5
guard) plus the new escalation you gave: resolve the cross-partition gap
before any bonus run touches PROD.

### Mechanism correction

Your instruction described the risk as "the void lands in the period after
the original." Rereading `WorkLogCorrectionHandler.gs` in full (not just the
excerpt already quoted in `ADR-WL-005`) and grepping every other
`FACT_WORK_LOGS` void-writing path in `src/` (`OrphanJobNumberFixer.gs`,
`WorkLogDedupFixer.gs`, `TestWorkLogVoidFixer.gs`) shows the opposite: **the
void always co-locates with the original** — every one of these paths writes
its void to the same partition as the row it corrects. The only thing that
can land in a different partition is `handleReassign()`'s **resubmit** row
(`newPeriodId = Identifiers.generateCurrentPeriodId()`, i.e. "now," which can
be a later month/quarter). `Job260337DuplicateFixer.gs`/`TestArtifactVoidFixer.gs`
write to `FACT_JOB_EVENTS`, a different table — not part of hours netting,
out of scope.

Worked through numerically before building anything (see the corrected
`ADR-WL-005` entry in `docs/SOP_DECISIONS.md` for the full derivation): a
**live** aggregation of both the original's and the resubmit's periods
already nets correctly today — zero effect on the original period, correct
effect on the resubmit's period. The actual risk is **commit timing**: if
the original's quarter is committed *before* the correction is filed, that
commit is a frozen snapshot that never sees the later void, while the
resubmit's quarter counts the same hours again when it's committed. That's a
real double-payment path, but a narrower and differently-shaped one than
your original description — flagging the correction rather than silently
building against the wrong mechanism.

### Real-data exposure — quantified, DEV only

Pushed `src/12-migration/CrossPartitionCorrectionAudit.gs` (read-only,
`Config.isDev()` + script-ID printed for verification) to DEV. You ran it
manually in the Apps Script editor on 2026-07-23 (script ID confirmed
`1smkj0mmUqcWDDJPq...`, matching `.clasp.dev.json`). Result:

```
Partitions scanned: 2026-01, 2026-02, 2026-03, 2026-04, 2026-05, 2026-06, 2026-07, 2028-02
Total WORK_LOG_REASSIGN corrections found: 0
Same-partition: 0   Cross-partition: 0
```

**Zero exposure in DEV, as of this date.** Per the verification-depth
standing rule I just added to `PROJECT_MEMORY.md` §3.1 (item 4) — this
number is **not** a PROD figure and I'm not presenting it as one. DEV's
`FACT_WORK_LOGS` is Phase 0's seeded synthetic test data (`PayrollHardeningDevSeed.gs`,
actors `PHD1`-`PHD4`, client `TEST-CLIENT`), not a mirror of PROD. This scan
says the *mechanism has not yet produced an actual double-count in DEV's
seed data* — it says nothing about whether any real PROD `WORK_LOG_REASSIGN`
correction has ever crossed a quarter boundary against an already-committed
quarter. No PROD scan was run (out of scope per the DEV-only ground rules);
if you want that answered for PROD specifically, it needs a separate,
explicitly-approved read-only PROD investigation, same as the original
NORSPAN-MB thread.

### Fix chosen — (B) detect-and-block at commit time

Per your explicit instruction, built regardless of the zero finding. Two
designs were on the table:
- **(A)** retroactively attribute a correction's net effect to the
  *original's* period always, superseding an already-locked commit when
  needed.
- **(B)** leave corrections flowing to the filing period and have the bonus
  commit path detect and block when it can't confirm every correction
  referencing it has been resolved.

**(B) was built.** (A) requires part of the period-locking/retroactive-supersede
model that's Phase 2's job to design properly, not backfill here — and it
directly contradicts Phase 2's own stated principle (corrections apply to
the next open period, not retroactively into a locked one). (B) is also a
correct general integrity property of `commitBonusForPeriod` independent of
this specific bug, not a one-off patch.

### Implementation

New `src/10-payroll/DanglingCorrectionGuard.gs`, `dcgDetectDanglingCorrections_(quarter, year)`:
pairs `WL_REASSIGN_*_VOID`/`WL_REASSIGN_*_NEW` rows by shared idempotency-key
prefix; for a resubmit in the quarter being checked whose void lives in a
*different* quarter, checks whether that quarter has an active
`PERIOD_COMMIT` marker timestamped *before* the correction. Also catches a
distinct integrity case found while designing this: a resubmit with **no**
findable void counterpart anywhere (`MISSING_VOID`) — a possible partial
write failure in `handleReassign()`'s two-row write, not previously
detectable.

Wired into `BonusPeriodCommit.gs`:
- `previewBonusForPeriod()` — surfaces findings via a new `danglingCorrections`
  field. Informational, does not throw (a dry run must stay a dry run).
- `commitBonusForPeriod()` — re-runs the check and **throws**, naming every
  dangling correction found (not just the first), if any exist.
- ANNUAL periods don't run this check directly (they sum already-committed
  quarterly `bonus_inr`, never re-reading raw hours) — any dangling
  correction affecting a quarter is already caught at that quarter's own
  commit, so annual inherits clean inputs rather than needing its own check.

`tests/gas-v3-mocks.js` extended (backward compatible — verified the
existing 27 bonus tests still pass unchanged before building on it) to
support partitioned `FACT_WORK_LOGS` reads and `DAL.listSheets()`, matching
real DAL's `TABLE|YYYY-MM` tab-naming semantics.

### Test matrix (your step 3)

| Required case | Where covered |
|---|---|
| Dangling correction blocks commit | `'commit is BLOCKED when a dangling correction exists...'` (`bonus-period-commit.test.js`) |
| Correction fully resolved before commit succeeds normally | `'commit SUCCEEDS normally once the dangling correction is resolved...'` |
| Resubmit in the SAME period as original — unaffected | `'a resubmit landing in the SAME quarter as its original... does not block the commit'` |
| Multiple dangling corrections all named, not just first | `'multiple dangling corrections... are ALL named in the block message'` — asserts both actor codes present in the thrown message |
| Void lands in the period AFTER the original — zero effect on original, correct effect on correction period | Already covered by the existing `aggregateNetWorkLogHours` fix (`work-log-aggregation.test.js`'s "KNOWN LIMITATION" test) — that test's periodA/periodB assertions ARE exactly this case, now correctly understood as documenting correct behavior, not a limitation (see mechanism correction above) |
| Committed AFTER the correction (already saw the void) — not flagged | `'does not flag when the original quarter was committed AFTER the correction...'` (`dangling-correction-guard.test.js`, unit level) |
| Never committed — not flagged | `'does not flag when the original quarter has never been committed...'` |
| Missing void counterpart (integrity case found during design) | `'flags MISSING_VOID when a resubmit has no matching void row anywhere...'` |

`dangling-correction-guard.test.js`: 7 tests (unit, direct against the guard
function). `bonus-period-commit.test.js`: 21 tests total (16 existing + 5
new integration tests for the wiring above).

### Item 5 — the 05-28-style regression guard (built)

New `tests/shared-aggregation-guard.test.js`, 25 tests. Reads the **real**
engine source (not mocks) for every known `FACT_WORK_LOGS`-consuming
aggregation entry point — `PayrollEngine.aggregateHours_`,
`QuarterlyBonusEngine.aggregateQuarterHours_`, `BillingEngine.buildHoursCache_`/
`runBillingRateCheck`, `ClientTimesheetEngine.buildHoursMap_`/`buildWorkLogEntries_`/
`runWorkLogDiagnostic`, `WorkLogHandler.getDailyNetHours_` — and asserts each
one still calls the shared `isMigratedWorkLog()`/`aggregateNetWorkLogHours()`
and hasn't had either broken pattern (`.migration_batch`, `hours <= 0`)
copied back into the function body directly. Scoped to these specific
function bodies, not a whole-file grep — `QuarterlyBonusEngine.gs` also
contains four one-off Q1-incident audit/report functions
(`runQ1BonusAuditDetailed`, `runQ1ManualCorrectionReport`, `runQ1CorrectedHours`,
`runQ1BonusOverpaymentReport`) that legitimately use `hours <= 0` to build
duplicate-detection keys for a different purpose — a whole-file check would
have false-positived on those.

**Verified RED before trusting it**, per this repo's TDD discipline: temporarily
commented out `aggregateNetWorkLogHours()`'s call inside `PayrollEngine.aggregateHours_()`,
confirmed the guard failed for the right reason (missing shared-function
call, not an unrelated error), then reverted and confirmed green again.

### Standing rule added

Per your earlier feedback pattern (Jest-green tests missing three real bugs
in a row), added a permanent rule to `PROJECT_MEMORY.md` §3.1 —
"Verification depth for money/aggregation code" — a four-item checklist
(read every real consumer; DEV-verify in addition to mocks, not instead of;
check other code paths producing the same row/event type; state PROD-vs-DEV
data gaps explicitly) that must be satisfied or explicitly declined before
calling FACT/DIM/payroll-adjacent work "done." Referenced from
`CLAUDE_START_HERE.md`'s session-start checklist so it's applied every
session, not read once. Committed standalone (`1254e09`), separate from
this feature work, per your explicit instruction.

### ADR updates

- **`ADR-WL-005`**: status changed from "Accepted, known limitation
  documented" to **RESOLVED** — mechanism corrected, real DEV exposure
  quantified (zero), fix direction and rationale recorded, cross-year
  corrections explicitly flagged as NOT evaluated (out of scope for this
  guard, not silently assumed handled), forward-link to Phase 2 added.
- **`ADR-BONUS-001`**: status changed from "Open question flagged (annual
  formula)" to **Accepted — approved as written**, reflecting your
  confirmation that sum-of-quarters (option b) is correct per business
  rule.

### Full suite status

339 tests, 16 suites, 0 failures (`npm test`). New this update:
`dangling-correction-guard.test.js` (7), `shared-aggregation-guard.test.js`
(25), 5 new tests appended to `bonus-period-commit.test.js` (21 total in
that file now) = 37 new tests since the last full-suite count of 302.

### DEV verification scope for this update — stated, not silently decided

This update's fix (`DanglingCorrectionGuard.gs` + its wiring into
`BonusPeriodCommit.gs`) is Jest-only, against the extended `gas-v3-mocks.js`
DAL mock (partitioned reads, `listSheets()`) — it has **not** been run
against the real Apps Script/Sheets DAL the way Phase 0's exclusion fix and
this update's exposure scanner were. Reasoning for not requiring another
manual DEV run this time: (1) real exposure is zero, so there's no live
scenario to reproduce against real data right now; (2) the underlying
netting math (`aggregateNetWorkLogHours`) this guard builds on top of was
already DEV-verified in Phase 0; (3) this guard is new control-flow logic
(does a marker predate a timestamp, block or don't) rather than new
schema/write-path behavior, which is the specific class of risk Phase 0's
DEV-verification requirement was written for. Code was still pushed to DEV
(`npm run push:dev`, confirmed non-PROD script ID) so it's available if you
want a manual run anyway — flagging this as a scoping choice for your
review, not a silent omission, per the standing rule just added.

### Commits this update

```
1254e09 docs: add verification-depth standing rule to PROJECT_MEMORY.md
        (origin: exclusion/void-netting/cross-partition bugs)
```
(the fix/tests/ADR-update commit follows this entry — see `git log` for the
final SHA, made immediately after this doc was written, per your "commit,
update TEST_EVIDENCE.md, stop for review" instruction)

### What's still open for your review

1. **Cross-year corrections** — not evaluated by this guard (compares
   quarters within a year via `bpcGetActiveMarker_`, no year-boundary
   check). Flagged in `ADR-WL-005` for whoever scopes Phase 2.
2. **Real PROD exposure** — not measured. The DEV scan says nothing about
   PROD; a real PROD answer needs a separate, explicitly-approved read-only
   investigation.
3. Carried over, unchanged: the Jan–Apr `ClientTimesheetEngine` exposure
   question (Phase 0, low-confidence, not acted on).
4. Per your closing instruction: Phase 2 (correction workflow) and
   bonus-run promotion planning have not started. This message is the stop
   point for this foundation phase.

---

## Phase 4 — Promotion planning for the aggregation fix-set (bug fixes only)

**Status: planning documents written, nothing executed against PROD beyond
a read-only source pull.** Scope: exclusion fix, void-netting fix,
`DanglingCorrectionGuard.gs`, and its regression test — the same fix-set
`ADR-WL-005`'s resolution covers. **Explicitly out of scope, deferred, not
started:** Phase 2 (correction workflow) and any bonus-run promotion —
`BonusPeriodEngine.gs`/`BonusPeriodCommit.gs` and everything `ADR-BONUS-001`
documents.

Two new documents, both at the repo root: `PROMOTION_CHECKLIST.md` and
`DRIFT_CHECK.md`. Both `ADR-WL-005` and `ADR-BONUS-001` in
`docs/SOP_DECISIONS.md` got a short "Promotion scope note" recording the
same exclusion, so the deferral is visible from either document, not just
here.

**Drift check result:** read PROD's live source for all 8 promotion-scope
files via an isolated clasp project in the session scratchpad (pointed at
the PROD script ID, never touching this worktree's own `.clasp.json` —
confirmed unchanged before and after, still DEV throughout). Zero drift:
the 5 modified files are byte-identical between PROD and the `main`
baseline this branch diverged from; the 3 new files are confirmed absent
from PROD. Full method and result in `DRIFT_CHECK.md`. The temporary PROD
source copy was deleted after the comparison.

**Pre-promotion gate:** fresh full-suite run this session — 339 tests, 16
suites, 0 failures. Fresh isolated run of `shared-aggregation-guard.test.js`
— 25/25. Because drift = 0, this evidence is valid for the PROD-bound
files, not just DEV's copy.

**PROD dry-run step — documented, not executed.** New
`src/12-migration/AggregationFixDryRun.gs` (`runAggregationFixDryRun()`),
built and pushed to DEV this session, **not yet run anywhere** (including
DEV — flagging this as a recommended next step before it's ever pointed at
PROD, per this session's own DEV-verification standing rule).

**Coverage gap closed (2026-07-23, same session):** the original version
of this dry-run and `PROMOTION_CHECKLIST.md`'s §3 covered only
`QuarterlyBonusEngine.aggregateQuarterHours_()`. Per your explicit
instruction, closed before running anything: `PayrollEngine.aggregateHours_`
is now exposed read-only on `PayrollEngine`'s public API — mirroring the
exact precedent `QuarterlyBonusEngine.aggregateQuarterHours_`'s own public
exposure already set (dated comment, no new environment gate on the
function itself, same "so a DEV/promotion tool calls the real function, not
a reimplementation" reasoning). `AggregationFixDryRun.gs` now calls
`PayrollEngine.aggregateHours_()` once per month for each configured
quarter, then `QuarterlyBonusEngine.aggregateQuarterHours_()` once for the
whole quarter, so both engines' fixed output prints together. Both call
graphs confirmed read-only by reading every function involved in full — no
`DAL.appendRow`/`appendRows`/`ensurePartition` anywhere in either path.
Re-pushed to DEV; full suite re-confirmed green (339/16/0) after exposing
the new public function. Full detail, execution mechanism (manual Apps
Script editor run — `clasp run` is still blocked), and rollback plan in
`PROMOTION_CHECKLIST.md`.

**`DanglingCorrectionGuard.gs` promotion note:** flagged explicitly in
`PROMOTION_CHECKLIST.md` — its only caller is `commitBonusForPeriod()`,
which is out of scope for this promotion, so it ships as inert, uncalled,
correctly-tested code. Not a blocker, but recorded so its presence in PROD
isn't later mistaken for the bonus-run layer also being protected.

**DEV verification of `runAggregationFixDryRun()` — done, real output, sane.**
Run manually in the DEV Apps Script editor (script ID confirmed
`1smkj0mmUqcWDDJPq...`). Both engines produced output for both quarters,
covering actors `PHD1`-`PHD4` (Phase 0's seed) and `DS1` (the reserved
DEV-only synthetic actor code — expected in DEV data, not contamination).
Cross-checked by hand: every actor's three monthly
`PayrollEngine.aggregateHours_()` design-hours figures sum exactly to that
quarter's `QuarterlyBonusEngine.aggregateQuarterHours_()` total (e.g. Q1
PHD1: 11+11+9=31 matches the quarterly 31 exactly; Q2 DS1: 89.75+0+11.5=101.25
matches exactly). `PHD4`'s QC hours (4h in both March and June) correctly do
not appear in either quarterly total — `aggregateQuarterHours_()` only
carries `design_hours` into its output, matching the pre-existing, intended
bonus-basis definition (`PayrollEngine.gs` §5: "bonus = INR 25 ×
Σ(design_hours...)"), not a defect surfaced by this run. No errors, no
implausible values, no drift between the monthly and quarterly views for
any actor. **This satisfies the "run against DEV before it's ever pointed
at PROD" recommendation from the previous update — it is still not the
PROD dry-run itself, which remains pending your separate, explicit
go-ahead.**

### Scope correction (2026-07-23) — three items dropped from this promotion

Preparing the actual PR surfaced that the branch's real diff against `main`
is 30 files, not the 9 originally listed — including the entire Phase 3
bonus-run layer (`BonusPeriodCommit.gs`/`BonusPeriodEngine.gs`), which was
already out of scope but hadn't been physically excluded from what a
whole-branch merge would bring into `main`. Resolved as follows, all
per your explicit direction:

1. **`DanglingCorrectionGuard.gs` — deferred, not shipped inert.**
   Superseding the earlier "ships as inert, correctly-tested code" framing:
   preparing the promotion branch surfaced that it has *two* real
   dependencies on the out-of-scope bonus-run layer, not just no caller —
   its only caller **and** its runtime dependency (`bpcGetActiveMarker_`)
   both live in `BonusPeriodCommit.gs`, and its own unit tests
   (`dangling-correction-guard.test.js`) can't load without that file
   present. There's no way to promote it cleanly without either dragging
   `BonusPeriodCommit.gs` along (reopening the bonus-run-layer question) or
   shipping it with no working test coverage on whatever branch is
   actually deployed. **Decision: defer both the file and its test to
   whichever future promotion includes the bonus-run layer**, where it
   will have a real caller and working tests, rather than force it into
   this bug-fix-only promotion. The file and its fix remain exactly as
   built and committed on this branch — nothing about the underlying
   `ADR-WL-005` resolution changes, only which promotion ships it.
2. **DEV-only diagnostics excluded, not just gated.** `CrossPartitionCorrectionAudit.gs`,
   `DevEnvironmentInspector.gs`, `PayrollHardeningDevSeed.gs`,
   `PayrollHardeningRecompute.gs`, and the one-line `DAL.gs`
   `WRITE_PERMISSIONS` addition for `PayrollHardeningDevSeed` are excluded
   from the promotion branch entirely. `PayrollHardeningDevSeed.gs`
   specifically writes synthetic rows to `FACT_WORK_LOGS`; it's
   `Config.isDev()`-gated today, but structural absence from the PROD
   codebase is a stronger guarantee than a runtime gate for a script with
   that write surface — the same reasoning `testing-policy.md` codifies
   after the 2026-07-08 test-contamination incident.
3. **`appsscript.json`'s `executionApi` change — investigated, excluded.**
   Checked what it actually enables before deciding: `executionApi`
   configures the Apps Script **Execution API** — the mechanism
   `clasp run` and the `scripts.run` REST endpoint use to invoke functions
   programmatically. It has no effect on manually running a function via
   the Apps Script editor's function dropdown + Run button — confirmed by
   this project's own history (`clasp run` still failed with this setting
   present, per the four-attempt investigation earlier in this document;
   every actual DEV verification this whole session, including the
   `runAggregationFixDryRun()` run just folded in above, used the manual
   editor path, which needs no manifest change at all). Since the planned
   PROD execution is exclusively the manual editor run, and `clasp run`
   remains blocked by a separate, still-unresolved GCP-project-link
   prerequisite regardless of this setting, it provides no benefit to the
   plan and is excluded.

**Revised, final promotion scope:** `WorkLogExclusion.gs`,
`WorkLogAggregation.gs`, `WorkLogHandler.gs`, `BillingEngine.gs`,
`PayrollEngine.gs`, `QuarterlyBonusEngine.gs`, `ClientTimesheetEngine.gs`,
`AggregationFixDryRun.gs` (8 files, down from 9) + `work-log-exclusion.test.js`,
`work-log-aggregation.test.js`, `shared-aggregation-guard.test.js` (3 files,
down from 4) + this promotion's docs. A fresh branch off `main` containing
exactly this set, confirmed by diff before any PR is opened, per your
instruction — see `PROMOTION_CHECKLIST.md`/`DRIFT_CHECK.md` for the
corrected file list and the branch-preparation record.

### Full suite status

339 tests, 16 suites, 0 failures — reconfirmed after exposing
`PayrollEngine.aggregateHours_()`. No new Jest coverage this update
(`AggregationFixDryRun.gs` and the two markdown documents are
diagnostic/planning artifacts, not tested code paths — the dry-run script
calls only already-tested functions from both engines; no existing test
checks either engine's public-API object shape by full equality, so
exposing a new key on each was confirmed safe by inspection, not just by
the suite staying green).

### What's still open for your review

1. **The PROD dry-run go-ahead** — separate from approval of everything
   else in this document, per your explicit instruction. The DEV run above
   is a precondition, not a substitute — nothing has run against PROD yet.
2. **The fresh promotion branch and its PR** — not yet opened. Diff against
   `main` to be confirmed exactly matches the revised 8-file scope above
   before any PR is created, per your explicit instruction.
3. This latest update (scope correction + folding the real DEV execution
   log in) has **not** been committed yet.
