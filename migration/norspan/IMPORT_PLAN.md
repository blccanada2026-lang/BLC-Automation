# NORSPAN-MB Invoice Batch — Import Plan (DRAFT, NOT EXECUTED)

**Status:** Draft for CTO review. No code has been run, no data has been written.
**Author context:** Produced in a read-only investigation session, 2026-07-22.
**Scope of investigation:** static analysis only — git history, source files, and
the untracked `migration/norspan/` CSVs. No live Sheets/DAL query was run against
PROD or DEV (`.clasp.json` currently points at PROD; running any Apps Script
function, even a read-only one, was treated as out of scope for this session
without explicit go-ahead — see §3).

---

## 1. What is this batch, and does it overlap with the existing 431-entry recon?

**Finding: this is effectively the same 333-row / 616.15-hour NORSPAN-MB dataset
that is already loaded in PROD — not a redo of the whole recon, not a
correction of missing data, and not net-new rows. It is a re-extraction of the
same 8 invoices, done independently and later, with ~97.6% of rows identical
and 8 rows (2.4%) disagreeing on which designer logged the hours.**

Evidence:

- `MigrationReconFiller.gs` (`src/12-migration/MigrationReconFiller.gs`) was
  committed **2026-05-08** (`385b1ae`, fixed same day in `e0f2b9d`) and has not
  been touched since. It hardcodes `RECON_ENTRIES_`, a 431-row array covering
  both NORSPAN-MB and TITAN, Jan–Apr 2026. `migration-status.md` marks this
  batch (`BATCH-RECON-001`) **✅ Complete**.
- Filtering `RECON_ENTRIES_` to `client_code === 'NORSPAN-MB'` gives **exactly
  333 rows, 616.15 hours** — the identical row count and hour total as
  `migration/norspan/norspan_manifest.json` (which itself notes
  `# Hours : 616.15 (expected: 616.15)` in the extractor script, i.e. the
  extractor author already knew the target total).
- A full multiset diff on `(job_number, date, actor_code, hours)` between the
  333 RECON rows and the 333 CSV rows: **325 rows match exactly**. The
  remaining 8 differ only in `actor_code` — every mismatched row is credited
  to `BCH` in the hand-built `RECON_ENTRIES_`, but to `RKG` or `VKV` in the
  new automated extraction:

  | date | hours | RECON actor | CSV actor | source invoice |
  |---|---|---|---|---|
  | 2026-01-19 | 0.5 | BCH | RKG (job Q260028) or unaffected (job Q260029 also present, no clean 1:1 pairing — see note) | Invoice_From_Jan_16th-31st_Norspan.csv |
  | 2026-02-18 | 1.0 | BCH (job Q260091) | RKG (Q260091) | Invoice_From_Feb_16th_to_28thNorspan.csv |
  | 2026-02-18 | 1.0 | BCH (job Q260098) | VKV (Q260098) | Invoice_From_Feb_16th_to_28thNorspan.csv |
  | 2026-03-02 | 1.5 | BCH (job Q260099) | RKG (Q260099) | Invoice_From_March_1st-15th_Norspan_MB.csv |
  | 2026-03-04 | 0.5 | BCH (job Q260125) | VKV (Q260125) | Invoice_From_March_1st-15th_Norspan_MB.csv |
  | 2026-03-18 | 0.25 | BCH (job Q260156) | RKG (Q260156) | Invoice_From_March_16th_to_31st_Norspan.csv |
  | 2026-03-18 | 0.5 | BCH (job Q260109) | VKV (Q260109) | Invoice_From_March_16th_to_31st_Norspan.csv |
  | 2026-04-21 | 1.5 | BCH (job Q260248) | RKG (Q260248) | Invoice_From_April_16th_to_30th_Norspan.csv |

  (The 2026-01-19/0.5h pair is genuinely ambiguous on both sides — both
  datasets have two same-date/same-hours lines that don't pair 1:1 cleanly by
  job number alone; needs eyes-on the source PDF, not just the CSV, to resolve.)

  **Every unique `job_number` appears in both datasets** — there is no
  job present in one CSV batch and absent from the other. This is a pure
  attribution question on 8 lines, not a coverage gap.

**Interpretation:** `RECON_ENTRIES_` was almost certainly hand-transcribed from
the same 8 Norspan invoice PDFs back in May, and the designer's initials were
misread or mis-attributed to the team lead (BCH) on 8 short line items where
BCH's name doesn't actually appear (per `norspan_extractor.py`'s
`DESIGNER_MAP`, "RG-Ravi Gummadi"/"RG-RaviKumar" → RKG, "VK-Vani" → VKV,
"BC-Bharath Charles" → BCH — these are visually similar two-letter prefixes on
a scanned/OCR'd invoice, an easy hand-transcription slip). The Python extractor
is a mechanical, zero-LLM re-read of the same PDFs and is more likely to be
correct on a token-level regex match than the manual transcription — but this
is not proven without checking the 8 source PDF lines by eye.

**This is not a "should we import 333 new rows" decision — it is a "do we
need to correct designer attribution on 8 already-loaded rows" decision.**
No new hours belong in FACT_WORK_LOGS from this batch.

---

## 2. Is this explained by the 07-08 NORSPAN vs NORSPAN-MB client-code bug?

**No.** Two independent problems share the "NORSPAN" name and got conflated by
proximity, but they don't touch the same data:

- `RECON_ENTRIES_` has used the client code `NORSPAN-MB` (not bare `NORSPAN`)
  on every row since it was written on **2026-05-08** — two months before
  Sarty's duplicate-client report.
- The 07-08 fix (`NorspanClientCodeFixer.gs`, commit `dba39b3`) corrects
  **`VW_JOB_CURRENT_STATE`** rows — i.e. real jobs created through the
  portal/job-lifecycle path (`JobCreateHandler` → `FACT_JOB_EVENTS` →
  `VW_JOB_CURRENT_STATE`), using internal `BLC-XXXXX` job numbers. It does not
  read or write `FACT_WORK_LOGS`, and its own header comment says so
  explicitly ("This only fixes VW_JOB_CURRENT_STATE + the audit trail... does
  NOT touch DIM_CLIENT_MASTER").
- `BATCH-RECON-001` rows use invoice-native `job_number` values (`Q251132`,
  `Q260000`, etc.) that don't correspond to any `BLC-XXXXX` job and were
  never part of the 66 jobs the 07-08 fixer touched.

So the NORSPAN-MB CSV batch's existence has nothing to do with the 07-08 bug —
it's an independent verification/re-extraction effort against the same source
invoices used for the May recon.

---

## 3. What did the `BLC-00406`/`BLC-00547` diagnostic (`9078b53`) find?

**I can't tell you — there is no captured output anywhere in the repo, and I
did not run the script.**

What I can confirm from the source and commit history:

- `NorspanJobOriginAudit.gs` (`src/12-migration/NorspanJobOriginAudit.gs`,
  committed `9078b53`, 2026-07-17) is genuinely read-only by inspection — it
  only calls `DAL.readAll(Config.TABLES.FACT_JOB_EVENTS, ...)` per partition
  and `console.log`s the results for two hardcoded jobs, `BLC-00406` and
  `BLC-00547`. No `DAL.appendRow`/`appendRows`/`updateWhere` calls anywhere in
  the file.
- The commit message says this file was "**Pre-existing untracked file found
  before a PROD deploy**" — i.e. the last session found it sitting uncommitted
  before pushing to PROD and committed it as part of dirty-tree cleanup. That
  phrasing means the script was written *before* that session, its purpose
  already decided, but the commit itself is just housekeeping, not a record of
  a run.
- `BLC-00406` and `BLC-00547` appear **nowhere else** in the repo — not in
  `NorspanSartyQueueAudit.gs` (which targets bare `NORSPAN` client_code +
  Sarty's dead-letter items generically, no specific job numbers), not in
  `NorspanClientDuplicateAudit.gs`, not in `PROJECT_MEMORY.md`'s risk table,
  not in `SESSION_LOG.md`. There's no documented trail for why these two jobs
  specifically were flagged.
- Google Apps Script execution logs (`console.log` output from a manual editor
  run) aren't stored in git — if this was ever run, the output only exists in
  the Apps Script project's execution transcript (or Cloud Logging), which I
  have no access to from this repo checkout, and running it now would mean
  executing code against PROD (current `.clasp.json` target), which I held
  back from doing without your sign-off.

**Open item, not closed by this investigation:** find out what's actually odd
about `BLC-00406`/`BLC-00547` before touching NORSPAN data further. Likely
candidates given the file is scoped to `FACT_JOB_EVENTS` origin fields
(`actor_code`, `actor_role`, `client_code`, `notes`): these two jobs may have
an unexpected `client_code` (echoing the bare-`NORSPAN` bug elsewhere) or a
blank/wrong `actor_code` on their creation event. Running
`runNorspanJobOriginAudit()` (read-only, confirmed safe by code review) would
answer this in under a minute — recommend doing that as the actual first step
of a resumed session, once you're comfortable running it against PROD.

---

## 4. Migration plan

### 4.0 — Blocking pre-existing risk found during this investigation (not caused by this batch, but relevant to it)

While tracing how `BATCH-RECON-001` rows are excluded from live payroll, I
found the exclusion mechanism looks broken:

- `PayrollEngine.aggregateHours_()` (`src/10-payroll/PayrollEngine.gs:177-193`)
  excludes migration rows with `if (row.migration_batch) continue;`.
- The canonical `FACT_WORK_LOGS` schema in `SetupScript.gs:225-230` is
  `event_id, job_number, period_id, event_type, timestamp, actor_code,
  actor_role, hours, work_date, notes, idempotency_key, payload_json` —
  **`migration_batch` is not a column.**
- `MigrationReconFiller.buildRow_()` sets `migration_batch: RECON_BATCH` on
  every row it writes, but if the partition sheet's header doesn't have that
  column, DAL silently drops the field on write (this exact failure mode is
  already documented for a different batch in `PROJECT_MEMORY.md §11`: *"
  amendment_of and migration_batch columns NOT in FACT_WORK_LOGS|2026-06
  header — DAL silently drops them"*).
- If the same is true for the `FACT_WORK_LOGS|2026-01` through `|2026-04`
  partitions, then `row.migration_batch` reads as `undefined` on every
  `BATCH-RECON-001` row, `if (row.migration_batch)` is false, and the row is
  **not** excluded — it would be counted by `aggregateHours_()` alongside
  whatever `BATCH-001` (blank-actor) rows already exist for the same
  underlying hours, double-counting RKG/BCH/VKV/SGO's Jan–Apr hours in any
  V3 payroll run or hours report over that range.
- I have **not verified this live** (would require reading the actual
  partition headers, which I held back from doing without sign-off). But
  given the exact precedent already logged for the 2026-06 partition, I'd
  treat this as high-likelihood, not speculative.

**Recommendation: verify this before anything else touches NORSPAN-MB data.**
A single read-only check — confirm whether `migration_batch` is present in the
`FACT_WORK_LOGS|2026-01..2026-04` headers, and whether `aggregateHours_()`
would in fact double-count — belongs before step 4.1 below, and arguably
belongs before any V3 payroll run is ever executed retroactively over Jan–Apr,
independent of this NORSPAN thread.

### 4.1 — What would actually be inserted

**Nothing, if the goal is just to load this CSV batch.** The 333 rows in
`migration/norspan/*.csv` are (per §1) the same invoice hours already present
in PROD as part of `BATCH-RECON-001`. A straight import would create 333
duplicate `FACT_WORK_LOGS` rows for NORSPAN-MB Jan–Apr, on top of an existing
double-count risk (§4.0) — i.e. it risks turning a possible 2x into a 3x.

**What might legitimately need to be inserted: correction events for 8 rows**,
*if* the CSV extraction's designer attribution is confirmed correct against
the source PDFs (not yet done — see §1's caveat on the ambiguous 01-19 pair).
That would be a small, targeted correction, not a batch import.

### 4.2 — What needs to be corrected or backed out first

1. **Resolve §4.0** — confirm whether `BATCH-RECON-001` rows are actually
   excluded from `aggregateHours_()` today. If not, that's a standing data
   integrity bug independent of this batch and should probably be its own
   ADR/ticket, not folded into a NORSPAN-specific fix.
2. **Resolve the `BLC-00406`/`BLC-00547` audit** (§3) — run
   `runNorspanJobOriginAudit()` and read the actual output before deciding
   whether it's related to this attribution question or a separate issue.
3. **Manually verify the 8 disputed rows against the source PDFs** (not just
   the CSV vs the hardcoded array) — the extractor is mechanical but not
   proven infallible (its own `DESIGNER_MAP` is a substring match on OCR'd
   text; a misread `"BC-"` vs `"RG-"` prefix is exactly the kind of error a
   regex extractor could also make). This determines whether any correction
   is even warranted, and if so, in which direction.
4. **Resolve the ambiguous 2026-01-19 / 0.5h pair** — both datasets have two
   same-date, same-hours lines that don't cleanly pair by job number; needs a
   human read of that one invoice section.

### 4.3 — Idempotency / duplicate-prevention strategy, if a correction is built

- Do **not** reuse `MigrationReconFiller`'s idempotency scheme
  (`'RECON-0000'` … `'RECON-0430'`, purely sequential/positional — see
  `MigrationReconFiller.gs:483`). It gives no protection against re-deriving
  the same logical row from a different extraction and generating a
  different-but-colliding-in-effect entry.
- The extractor already computes a content-based key per row:
  `md5(client_code|person_code|job_number|date_iso|actor_role|hours)`
  (`norspan_extractor.py:163-165`). That's the right shape for correction
  work, but note it **includes `person_code`** — so a row whose only problem
  is a wrong `person_code` produces a *different* idempotency key under both
  the "wrong" and "right" attribution, meaning content-hash idempotency alone
  won't catch or prevent the double-attribution case. A correction script
  needs to match on `(job_number, date, hours)` — deliberately excluding actor
  — to find the row to correct, the same way the diff in §1 did.
- Follow the established pattern for this exact situation:
  **ADR-WL-001's net-zero void + re-submit**, not a raw `UPDATE` (impossible
  anyway — FACT tables are append-only per Rule A5) and not a bare additive
  `WORK_LOG_AMENDED` (would double the hours the same way ADR-WL-001 warned
  against, doubly relevant given §4.0). For each of the 8 (or however many
  are confirmed wrong):
  - Write a `WORK_LOG_VOIDED` row for the original entry (BCH, hours negated).
  - Write a `WORK_LOG_SUBMITTED` (or `WORK_LOG_MIGRATED`, matching the
    original event_type convention) row under the corrected actor (RKG or
    VKV, same hours).
  - Idempotency key: `NORSPAN_RECON_ATTR_FIX_<original event_id>`, checked via
    both a `DAL.readWhere` scan (covers a crashed/partial rerun) and
    `IdempotencyEngine.checkAndMark` — mirroring
    `NorspanClientCodeFixer.runLive()`'s pattern exactly.

### 4.4 — Rollback plan

- Because FACT tables are append-only, "rollback" means a further correcting
  event, not a delete. If a correction fixer is run and turns out wrong (e.g.
  the CSV extraction is later shown to be the one in error, not the hand-built
  recon), the rollback is: void the correction's `WORK_LOG_SUBMITTED` row and
  re-submit under the original (BCH) actor — same net-zero pattern, run in
  reverse. Keep the fixer idempotent and re-runnable both directions rather
  than one-shot, the same way `OrphanJobNumberFixer` was built.
- Before any `LIVE` run: dry-run first (print the matched rows and proposed
  correction, no writes — `NorspanClientCodeFixer.runDryRun()` is the template
  to copy), and get explicit sign-off on the dry-run output, per this
  project's established two-phase (`_DRYRUN` / `_LIVE`) convention for every
  migration fixer in `src/12-migration/`.
- Test in DEV first per R10 — DEV script ID is
  `1smkj0mmUqcWDDJPq-RUuVxRG4nE3TMKy4KrOIVUcdEN9lrFucL57aqAE`
  (`.clasp.dev.json`), separate from the PROD project this repo's
  `.clasp.json` currently targets.

### 4.5 — R10 / D1 / D2 checks this must pass before any PROD execution

- **R10.1–10.4**: build and test in DEV first; any test runner/shared setup
  helper must start with the `Config.isDev()` guard; use only
  `TEST-CLIENT`/`test-*@test.blc.internal` synthetic identities in tests, never
  real NORSPAN-MB/RKG/BCH/VKV data in a test fixture.
- **R10.7**: any new fixer that writes to `FACT_WORK_LOGS` must be added to
  `DAL.gs`'s `WRITE_PERMISSIONS['FACT_WORK_LOGS']` array
  (`src/01-dal/DAL.gs:108-112`) — currently `MigrationReconFiller` is listed;
  a new module name (e.g. `NorspanReconAttributionFixer`) would need adding.
  **Migration/fixer scripts require explicit CTO approval before PROD
  execution — this plan is that approval request, not the approval itself.**
- **D1 (Idempotency)**: see §4.3 — `IdempotencyEngine.checkAndMark()` plus a
  DAL scan guard before every write, matching the `NorspanClientCodeFixer`
  precedent.
- **D2 (Logging)**: all diagnostic/fixer output through `Logger.info/warn/error`
  per the module's existing convention (`RECON_FILL_START`,
  `RECON_FILL_COMPLETE` style event names) — not raw `console.log` for
  anything that isn't a manual dry-run inspection aid.
- **R9 stop conditions**: this whole thread touches `FACT_WORK_LOGS`
  (explicitly named in R9 as a stop-work-and-ask domain) — every step above
  assumes a resumed session stops and asks before any `_LIVE` run, matching
  what R9 already requires.

---

## Summary / recommended order for the next session

1. Confirm §4.0 (migration_batch column / double-count exposure) — read-only.
2. Run `runNorspanJobOriginAudit()` for BLC-00406/BLC-00547 and read the
   actual output — read-only, but executes against whatever `.clasp.json`
   currently targets (PROD right now) — get sign-off first even though the
   script itself is read-only.
3. Manually check the 8 disputed rows (+ the ambiguous 01-19 pair) against the
   source PDFs, not just the two extracted datasets against each other.
4. Only then decide whether `NorspanReconAttributionFixer` (or similar) is
   worth building, and build it DEV-first with dry-run/live split per §4.3–4.5.
5. This plan's own existence (`migration/norspan/IMPORT_PLAN.md`) and the
   underlying CSVs are still untracked in git — worth a decision on whether to
   commit them (as documentation of the investigation) even before any code
   is written, so this doesn't sit as an unexplained dirty-tree item again the
   way `NorspanJobOriginAudit.gs` did on 07-17.
