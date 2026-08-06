# Payroll/Bonus/Billing Exclusion Findings — `migration_batch` Field

**Status:** Investigation complete, read-only. No writes, no commits, no code
execution against PROD or DEV performed in this session.
**Trigger:** Item 4 of `IMPORT_PLAN.md` §4.0 — does `BATCH-RECON-001` (431
rows, `NORSPAN-MB` + `TITAN`, Jan–Apr 2026, `src/12-migration/MigrationReconFiller.gs`)
get correctly excluded from payroll/bonus/billing aggregation?
**Bottom line: no. The exclusion field doesn't exist in the schema, and one of
the three engines that rely on it has had zero exclusion logic since
2026-05-28. Q1 2026 quarterly bonus was computed and committed to
`FACT_PAYROLL_LEDGER` on 2026-06-01 — after both facts were already true.**

---

## 1. Does `migration_batch` exist as a `FACT_WORK_LOGS` column?

**No — confirmed from three independent angles, no live query needed.**

**a) Canonical schema definition.** `src/setup/SetupScript.gs:225-230`:
```javascript
'FACT_WORK_LOGS': [
  'event_id', 'job_number', 'period_id', 'event_type',
  'timestamp', 'actor_code', 'actor_role',
  'hours', 'work_date', 'notes',
  'idempotency_key', 'payload_json'
],
```
12 columns. No `migration_batch`.

**b) How the write path actually behaves — this is the part that removes any
doubt about "maybe a partition has an extra column."** `DAL.appendRow`/
`appendRows` (`src/01-dal/DAL.gs:679-762`) never write arbitrary object keys —
they call `objectToRow_(headers, data)`:
```javascript
// src/01-dal/DAL.gs:378-387
function objectToRow_(headers, obj) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var key = headers[i];
    var val = (key && obj.hasOwnProperty(key)) ? obj[key] : '';
    row.push(val === null ? '' : val);
  }
  return row;
}
```
`headers` comes from `getHeaders_(sheet)` — **the live sheet's actual header
row**, read fresh via `getRange(1,1,1,lastCol).getValues()`
(`DAL.gs:346-351`), not from any schema constant. The loop only iterates over
`headers`; any key in `obj` that isn't one of those column names is never even
looked at. So this isn't "migration_batch might get dropped" — by construction,
**any field not already a column header on the specific partition tab being
written to is unconditionally discarded**, regardless of what the calling code
puts in the row object. `MigrationReconFiller.buildRow_()`
(`MigrationReconFiller.gs:480-498`) does set `migration_batch: RECON_BATCH` on
every row object it builds — it's just never looked at.

**c) `ensurePartition()` guarantees every partition shares the same header.**
(`DAL.gs:918-967`) When a new monthly partition tab doesn't exist yet, it's
created by copying the header row from the first existing partition of the
same table found in the spreadsheet's tab list (`getSheets()` order) — never
from the `SetupScript.gs` schema constant directly, and never by adding a new
column to an existing tab. There is no code path anywhere in `DAL.gs` or
`SetupScript.gs` that appends a 13th column to an existing `FACT_WORK_LOGS`
partition. So once the first-ever `FACT_WORK_LOGS` partition was created with
the 12-column canonical header (which never included `migration_batch`),
every partition since — Jan 2026 through today — inherits the same 12
columns, unless someone hand-edited a header cell directly in the Sheets UI
(this project has a documented history of occasional manual sheet edits — see
`SESSION_LOG.md` 2026-06-18: "RKU added to REF_ACCOUNT_DESIGNER_MAP (data fix
by user)" — so I can't rule that out with 100% certainty without a live read,
but it would be a one-off deviation from every code path, not the expected
state).

**Independent corroboration already sitting in the repo, not authored by me:**

- `PROJECT_MEMORY.md §11`: *"amendment_of and migration_batch columns NOT in
  FACT_WORK_LOGS|2026-06 header — DAL silently drops them."* — this is a
  previously-recorded, already-confirmed live observation for the 2026-06
  partition specifically (from the BATCH-004-HOURS-FIX work, unrelated to
  Norspan).
- `BillingEngine.gs:327`, in-code comment: **`"FACT_WORK_LOGS schema drops
  migration_batch so it cannot be used as a filter."`** — someone already
  diagnosed this exact fact while writing `buildHoursCache_()`, and left it as
  a comment. (See §3 — despite this comment being correct, a *different*
  function later in the same file still relies on the dead field. The
  knowledge didn't propagate.)

**What I did not do:** run a live read of the actual `FACT_WORK_LOGS|2026-01`
through `|2026-04` header rows. That would require either executing an
already-deployed function against PROD (see the `runDiagnoseQ1Hours()` option
in §5) or deploying new code — both are executions against live Apps Script,
which I held back from per this session's read-only scope. The evidence above
is static-analysis-certain for how the row **would** have been written; §2
below cross-checks it against what a real payload actually contains.

---

## 2. What's actually stored on a `BATCH-RECON-001` row — any surviving marker?

**Partially distinguishable — but not to the code that needs it to be.**

Given the 12-column header and `MigrationReconFiller.buildRow_()`'s object
(`event_id, job_number, period_id, event_type: 'WORK_LOG_MIGRATED', timestamp,
actor_code, actor_role, hours, work_date, notes: 'Invoice reconciliation —
BATCH-RECON-001', idempotency_key, migration_batch: 'BATCH-RECON-001'`), here
is what each column actually resolves to on write:

| Column | Value written | Survives? |
|---|---|---|
| `event_id` | generated ID | ✅ |
| `job_number` | invoice Q-number, e.g. `Q251132` | ✅ |
| `period_id` | `YYYY-MM` | ✅ |
| `event_type` | `'WORK_LOG_MIGRATED'` | ✅ — **this is the real marker** |
| `timestamp` | write-time ISO string | ✅ |
| `actor_code` | `RKG`/`BCH`/`VKV`/`SGO`/`PRS`/`PBG`/`DBS`/`NMM` | ✅ |
| `actor_role` | `DESIGNER`/`TEAM_LEAD`/`PM` | ✅ |
| `hours` | invoice hours | ✅ |
| `work_date` | invoice date | ✅ |
| `notes` | `'Invoice reconciliation — BATCH-RECON-001'` | ✅ — **also a real marker** |
| `idempotency_key` | `'RECON-0000'`…`'RECON-0430'` | ✅ |
| `payload_json` | *(not set by `buildRow_()` at all)* | blank |
| `migration_batch` | `'BATCH-RECON-001'` | ❌ **dropped — not a column** |

So a human (or a query written to check for it) *can* tell these rows apart —
`event_type = 'WORK_LOG_MIGRATED'` and `notes` starting with `'Invoice
reconciliation —'` both survive intact. **The rows are not anonymous.** The
problem is narrower and more specific than "indistinguishable": **the specific
exclusion mechanism three financial engines were built to rely on
(`row.migration_batch`) silently never worked, while a working alternative
(`event_type === 'WORK_LOG_MIGRATED'`) has existed in the data the whole time
and just wasn't used by those three engines.**

Proof that `event_type`-based exclusion is a known, working pattern
elsewhere in this exact codebase — `WorkLogHandler.gs:185-195`
(`getDailyNetHours_`, added 2026-06-30 per ADR-WL-002):
```javascript
function getDailyNetHours_(actorLogs, workDate) {
  var total = 0;
  for (var i = 0; i < actorLogs.length; i++) {
    var r = actorLogs[i];
    if (r.migration_batch) continue;                      // dead — same as everywhere else
    if (String(r.event_type || '') === 'WORK_LOG_MIGRATED') continue;  // this one actually works
    ...
```
Whoever wrote this on 2026-06-30 hedged with both checks — a sign they either
knew or suspected `migration_batch` wasn't reliable and added a real backstop.
That fix was never carried back to `PayrollEngine.aggregateHours_()`,
`BillingEngine.buildHoursCache_()`, or `QuarterlyBonusEngine.aggregateQuarterHours_()`.

---

## 3. Blast radius — which engines, which periods, which designers, how many hours

**Three engines inherited the same broken `if (row.migration_batch) continue;`
guard from one commit (`57d1ef5`, 2026-04-17, "billing/payroll inflation
guards"). Their current state has diverged:**

| Engine | Function | Current state | Real exposure |
|---|---|---|---|
| `PayrollEngine.gs` | `aggregateHours_()` (line 177-193) | Guard still present, still dead (`if (row.migration_batch) continue;`, `migration_batch` never populated) | **Latent, not yet realized** — see §4, no V3 base-payroll run has happened for any Jan–Apr period |
| `QuarterlyBonusEngine.gs` | `aggregateQuarterHours_()` (line 153-184) | Guard **deleted entirely** in commit `9f7222f` (2026-05-28), never replaced | **Realized** — see §4, Q1 2026 bonus was computed and committed after this date |
| `BillingEngine.gs` | `buildHoursCache_()` (line 309-354) | Guard was apparently never real to begin with — only a narrow `SUPERSEDED_MIGRATED` check for legacy `BTD`/`SNA` actor codes on `event_type === 'WORK_LOG_MIGRATED'` rows exists; the header comment at line 292-297 claims general migration exclusion but the code doesn't do it | **Likely low/no realized exposure** — see note below |

**Why billing is probably safe despite the same bug:** `buildHoursCache_()`
builds `hoursMap` keyed by `job_number`
(`src/09-billing/BillingEngine.gs:750`: `var totalHours = hoursCache[jobNumber]
|| 0;`, looked up per real job from `jobLookup`/`VW_JOB_CURRENT_STATE`).
`BATCH-RECON-001` rows use invoice-native `job_number` values (`Q251132`,
`Q260000`, etc.) which don't correspond to any real `BLC-XXXXX` job in
`VW_JOB_CURRENT_STATE` — so they populate `hoursMap['Q260000']` etc., a key
that (almost certainly) never gets looked up by the invoice-generation loop,
which iterates real jobs, not every key in the cache. **Not fully verified
live**, but the design makes accidental inclusion in an actual client invoice
structurally unlikely, unlike payroll/bonus below.

**Why payroll and bonus are NOT protected the same way:** both
`aggregateHours_()` and `aggregateQuarterHours_()` sum hours **by
`actor_code` + period only** — no `job_number` filter anywhere in either
function (confirmed by reading both in full). This is the same structural
point already documented in `docs/SOP_DECISIONS.md` ADR-WL-001 for a
different bug: *"`PayrollEngine.aggregateHours_()` sums `FACT_WORK_LOGS` hours
by `actor_code` + period only — it does not filter by `job_number` or
`event_type`."* The invoice-Q-number namespace that protects billing does
nothing here.

### Quantified hours by actor and quarter (from `RECON_ENTRIES_`, both clients combined — `PayrollEngine`/`QuarterlyBonusEngine` don't distinguish `NORSPAN-MB` from `TITAN`, only `actor_code`)

| actor_code | role(s) seen | Q1 (Jan–Mar) hours | April hours (Q2-partial) | Total Jan–Apr |
|---|---|---|---|---|
| RKG | DESIGNER | 299.00 | 70.00 | 369.00 |
| BCH | TEAM_LEAD | 104.75 | 17.75 | 122.50 |
| PRS | DESIGNER | 99.00 | 25.75 | 124.75 |
| VKV | DESIGNER | 96.90 | 24.75 | 121.65 |
| PBG | TEAM_LEAD | 35.75 | 5.75 | 41.50 |
| NMM | DESIGNER | 24.75 | 4.00 | 28.75 |
| DBS | DESIGNER | 16.00 | 0.00 | 16.00 |
| SGO | PM | 7.00 | 0.00 | 7.00 |
| **Total** | | **683.15** | **148.00** | **831.15** |

(831.15 = 616.15 NORSPAN-MB + 215.00 TITAN, matching §1 of `IMPORT_PLAN.md`;
here broken out by actor and quarter instead of by client.)

**Monthly totals, all actors combined:** Jan 228.9h · Feb 211.75h · Mar 242.5h
· Apr 148.0h.

**Every one of these 8 actor_codes would have had inflated `design_hours`**
(or `qc_hours` — none of these 8 are `actor_role = 'QC'` here, so all of it
lands in `design_hours`/base-pay design bucket) in any payroll or bonus
calculation that read the Jan–Apr `FACT_WORK_LOGS` partitions without a
working migration exclusion, **on top of** whatever real/organic hours those
same people logged for their real work in the same months.

**Whether all 8 were Q1-bonus-eligible, rated, and actually included in the
committed Q1 ledger is not something I verified** — `computeBonuses_()`
(`QuarterlyBonusEngine.gs:400`) skips anyone failing `isEligible_()` (marked
`SKIPPED`) or missing a rating (marked `PENDING`), so the real affected subset
of these 8 could be smaller than all 8. Confirming that requires either a live
read of `FACT_QUARTERLY_BONUS`/the committed ledger rows, or re-running
`aggregateQuarterHours_('Q1', 2026)` with a corrected filter and diffing — both
out of scope for this read-only session.

---

## 4. Was this actually paid, or is it computed on demand?

**Split answer — one engine already fired for real, the other hasn't fired at all yet via V3.**

**Quarterly bonus — already computed and committed, not yet paid out.**
Git history for `QuarterlyBonusEngine.gs` (chronological):

| Date | Commit | Event |
|---|---|---|
| 2026-04-17 | `57d1ef5` | `migration_batch` exclusion added (already ineffective per §1) |
| 2026-05-08 | `385b1ae` | `MigrationReconFiller` (`BATCH-RECON-001`) written — 616.15h NORSPAN-MB + 215h TITAN land in Jan–Apr `FACT_WORK_LOGS` |
| **2026-05-28** | **`9f7222f`** | **`if (row.migration_batch) continue;` deleted from `aggregateQuarterHours_()`, not replaced** |
| 2026-06-01 | `1a03bf2` | `"feat(payroll): commit Q1 2026 bonus + roster cleanup"` — `runCommitQ1Bonus()` → `QuarterlyBonusEngine.runQuarterlyBonus(...)` → writes to `FACT_PAYROLL_LEDGER` (append-only per Rule A5 — this is a real, permanent ledger entry, not a preview) |
| 2026-06-04 → 06-16 | `39c1397`, `74a20a9`, `927faba`, `f6ffec1`, `c02088a`, `6bb2cc7`, `41711b7` | Bonus letter generation, correction report, HR composite pinning |
| (per `PROJECT_MEMORY.md §6`) | — | **"Q1 bonus corrections — ✅ COMPLETE (2026-06-16). 16 letters in CEO inbox (₹72,231.13 total). Not yet forwarded to designers."** — status unchanged as of the last session log update (2026-07-08 sprint) and no later commit touches this |

**By the time Q1 2026 bonus was committed to `FACT_PAYROLL_LEDGER`
(2026-06-01), both preconditions for inflated hours were already true**:
`BATCH-RECON-001` had been sitting in the Jan–Apr partitions for 3+ weeks, and
the one exclusion mechanism (`migration_batch`, dead from the start per §1)
had been physically deleted from the aggregation function 4 days earlier. This
is a **retroactive-exposure** situation, but the exposure hasn't become an
actual overpayment yet — the ₹72,231.13 in letters is calculated and ledgered,
but per `PROJECT_MEMORY.md` still sitting unforwarded in
`blccanada2026@gmail.com`. **This is the live stop point** — nothing has been
paid to a designer yet, but the ledger entry and the letter amounts may
already be wrong.

**Base payroll — not yet run via V3 for any period, latent only.**
`PayrollEngine.aggregateHours_()` has the same dead guard, but per
`PROJECT_MEMORY.md §6`/§7: *"June billing — PENDING"*, *"First June payroll
run from V3 (blocked on June billing)"*, and `CLAUDE.md`/`PROJECT_MEMORY.md
§13`: *"No payroll run until Phase 3 cutover verified."* V3 cutover was
2026-06-16; Jan–May payroll was run under the legacy V2/Stacey system, outside
this codebase entirely, so `PayrollEngine.aggregateHours_()` reading the
Jan–Apr partitions has (per the project's own record) never actually executed
for a real payroll run. **No realized base-pay exposure — this is purely a
fix-before-first-use problem**, but it needs fixing before whichever period V3
payroll first runs against a partition containing these rows (any retroactive
Jan–Apr recalculation, or if June/July partitions ever pick up a similar
recon-style migration batch).

**Q2 2026 bonus** — the 148h of April `BATCH-RECON-001` hours would flow into
Q2 (Apr–Jun) bonus the same way, but per `SESSION_LOG.md`
2026-07-15/07-16 entries, Q2 rating requests are still at preview stage
(`runSendQ2FeedbackRequestsToHR` was a real send, but the manager/TL *rating*
request — a precondition for `computeBonuses_()`'s `ratingScore` — was still
"read-only preview, no send" as of 07-15). Since `computeBonuses_()` marks
anyone with `ratingScore === null` as `PENDING` with `bonus_inr: 0`, **Q2
bonus has very likely not been committed yet** — this is still a
fix-before-computation window, not a realized one, but should be closed before
Q2 ratings actually go out and bonus gets committed.

---

## 5. `NorspanJobOriginAudit.gs` — walkthrough, not executed

Full file (96 lines, `src/12-migration/NorspanJobOriginAudit.gs`, committed
`9078b53`, 2026-07-17). I read it in full; I did not run it. Walking through
every function:

**Module-level constant (line 14):**
```javascript
var NJOA_TARGET_JOBS = ['BLC-00406', 'BLC-00547'];
```
Hardcoded, two real `BLC-XXXXX` job numbers (this internal format, not the
invoice Q-numbers from §1-4 — these are unrelated to `BATCH-RECON-001`). No
documented reason anywhere in the repo for why these two specifically (see
`IMPORT_PLAN.md §3` — I already searched for other mentions and found none).

**`njoaDiscoverPartitions_()` (lines 16-30):**
```javascript
function njoaDiscoverPartitions_() {
  var sheets  = DAL.listSheets();                 // read-only: ss.getSheets().map(name)
  var prefix  = Config.TABLES.FACT_JOB_EVENTS + '|';
  var periods = [];
  for (...) if (name starts with prefix) periods.push(the 'YYYY-MM' suffix);
  periods.sort();
  return periods;
}
```
Calls `DAL.listSheets()` (`DAL.gs:1024-1028`) — literally just
`ss.getSheets().map(s => s.getName())`, a metadata read, no cell access at
all. Filters to tab names starting with `FACT_JOB_EVENTS|` and matching a
`YYYY-MM` suffix pattern. Output: a sorted list of every monthly partition
that exists for `FACT_JOB_EVENTS`, e.g. `['2026-01', '2026-02', ...,
'2026-07']` — whatever partitions actually exist in the live spreadsheet.

**`runNorspanJobOriginAudit()` (lines 36-96) — the entry point:**
1. Calls `njoaDiscoverPartitions_()`, prints the partition list.
2. For each discovered partition, calls `DAL.readAll(Config.TABLES.FACT_JOB_EVENTS,
   { callerModule: 'NorspanJobOriginAudit', periodId: pid })` — a full-sheet
   read of that partition tab (`getRange().getValues()` under the hood, per
   `DAL.gs:563` `readAll`; no RBAC/actor check inside `readAll` itself, no
   write calls anywhere in this path). Catches `SHEET_NOT_FOUND` per
   partition and skips (some partitions may not have `FACT_JOB_EVENTS` tabs at
   all — harmless).
3. For every row read, checks if `row.job_number` is one of the two target
   jobs; if so, appends it to that job's bucket (`byJob['BLC-00406']` /
   `byJob['BLC-00547']`).
4. After scanning all partitions, for each of the two target jobs: sorts its
   collected events by `timestamp` ascending, then `console.log`s, per event:
   `event_type, timestamp, actor_code, actor_role, client_code, job_type,
   product_code, client_job_ref, notes, idempotency_key, payload_json` — every
   field that exists on a `FACT_JOB_EVENTS` row for that specific job, in
   chronological order. If a job has zero matching rows anywhere, it prints
   "No FACT_JOB_EVENTS rows found for `<job>` in any scanned partition."
5. Prints `=== End ===`.

**What it would output, concretely:** for each of `BLC-00406` and
`BLC-00547`, the full lifecycle of `FACT_JOB_EVENTS` rows — every
`JOB_CREATED`/`JOB_ASSIGNED`/`JOB_STARTED`/etc. event ever written for that
job number, across every monthly partition, showing exactly which
`actor_code` created/touched it, what `client_code` it was tagged with at each
step, and any `notes`/`payload_json` attached. Given the audit's stated
purpose ("origin diagnostic... so their origin can be confirmed"), the likely
intent is to check whether either job's `client_code` shows `NORSPAN` (bare,
the buggy code from the 07-08 duplicate-client issue) at some point in its
event history, or whether its `actor_code`/`actor_role` looks wrong — but I
can't confirm which without the actual printed rows.

**Confirmed read-only by full-file inspection:** zero calls to
`DAL.appendRow`, `appendRows`, `updateWhere`, `patchFactRows`, or any
`SpreadsheetApp` write method anywhere in this file. `console.log` output only
goes to the Apps Script execution transcript — nothing persists to a sheet or
file, so if you run it, the only record is whatever you copy out of the
execution log (Apps Script editor → Executions, or Cloud Logging) — it won't
leave a durable artifact on its own the way the CSV/manifest files did.

**Decision point for you:** since `.clasp.json` currently points at the PROD
script ID (`1HzRiDrQJ6z...`, matching `.clasp.prod.json`), running
`runNorspanJobOriginAudit()` right now — via the Apps Script editor directly,
or via `clasp run runNorspanJobOriginAudit` from this repo — executes against
real PROD data. It's read-only by code, but it's still a live execution I
didn't take on your behalf. If you'd rather verify in DEV first: `cp
.clasp.dev.json .clasp.json` points clasp at the DEV project
(`1smkj0mmUqcWDDJPq...`) instead — but note DEV likely doesn't have real
`BLC-00406`/`BLC-00547` job history to audit (per `IntegrityMonitorBaselineAudit.gs`'s
own commit message: *"DEV wouldn't have the real V2 states or the real
malformed-row history to audit"* — same logic would apply here), so a DEV run
would probably come back empty and not actually answer the question. Running
it against PROD directly, the same way every other read-only diagnostic in
`src/12-migration/` has been run per this project's established pattern (see
`IntegrityMonitorBaselineAudit.gs`'s commit: *"Deployment: commit + push to
PROD directly... read-only against real PROD historical data is the entire
point"*), is probably the actually-useful option here — your call.

A parallel, already-existing option worth knowing about for the payroll
question specifically: `runDiagnoseQ1Hours()`
(`src/10-payroll/QuarterlyBonusEngine.gs`, added in the same `9f7222f` commit
that deleted the exclusion guard, 2026-05-28) already exists, is already
committed, and — per its code — reads each of the `2026-01`/`02`/`03`
`FACT_WORK_LOGS` partitions and prints `rows.length`, `totalHours`, the
literal `Object.keys(sample)` of the first row (**a live header dump — this
would directly answer §1 without any ambiguity**), and a with/without-`actor_code`
breakdown. It's also read-only (only `DAL.readAll`, only `console.log`), also
untouched by this session, and also would need to run against whatever
`.clasp.json` currently targets. I'm flagging it rather than running it, same
posture as the origin audit — your call whether to run either or both
yourself.

---

## Summary for CTO escalation

1. `migration_batch` is not, and by the write-path's actual mechanics cannot
   be, a real `FACT_WORK_LOGS` column — confirmed from `DAL.appendRow`/`appendRows`'s
   `objectToRow_()` logic, not just from the schema list. No live query was
   needed to establish this with certainty.
2. `BATCH-RECON-001` rows are marked via `event_type = 'WORK_LOG_MIGRATED'`
   and a `notes` prefix — both of which survive on write and could be filtered
   on — but `PayrollEngine.aggregateHours_()`, `QuarterlyBonusEngine.aggregateQuarterHours_()`,
   and `BillingEngine.buildHoursCache_()` were all built to filter on the dead
   `migration_batch` field instead, following a pattern (`getDailyNetHours_()`
   in `WorkLogHandler.gs`) that a later fix (2026-06-30) got right elsewhere
   but never backported here.
3. 831.15 hours across 8 actor_codes (RKG, BCH, PRS, VKV, PBG, NMM, DBS, SGO)
   are exposed in `FACT_WORK_LOGS` Jan–Apr 2026 with no working exclusion —
   683.15h of that in Q1 (Jan–Mar).
4. **Q1 2026 quarterly bonus was committed to `FACT_PAYROLL_LEDGER` on
   2026-06-01 — four days after the one nominal (already-ineffective) guard
   was deleted from `aggregateQuarterHours_()`, and three weeks after the
   exposed hours were written.** ₹72,231.13 across 16 letters, sitting
   unforwarded in the CEO inbox per `PROJECT_MEMORY.md`. Whether all 8
   actor_codes above were among the 16 bonus-eligible/rated designers, and by
   how much each letter might be inflated, is not yet quantified — needs a
   live read of the committed `FACT_QUARTERLY_BONUS`/ledger rows or a
   corrected re-run of `aggregateQuarterHours_('Q1', 2026)` to diff against.
5. Base payroll (`PayrollEngine`) has the same dead guard but no realized
   exposure yet — V3 payroll has never run against a Jan–Apr partition (all
   of that quarter was paid under legacy V2). This is a fix-before-first-use
   item, not a retroactive one.
6. Billing exposure is probably structurally near-zero (job-number namespace
   mismatch between invoice Q-numbers and real `BLC-XXXXX` jobs), but the
   `buildHoursCache_()` header comment claiming general migration exclusion is
   stale/misleading relative to what the code does and should be corrected
   regardless.

No fix has been designed or written. Per your instruction, this stops here
for CTO sign-off before any correction (to the engines' exclusion logic, or to
the Q1 bonus ledger/letters) is scoped.
