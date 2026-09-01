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

## Session State (last updated: end of turn, 2026-08-31)

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
- **Q2 ratings** — blocked on data collection, not code. `Q2RatingsPreflightCheck.gs` last showed 0/13 active staff confirmed for `2026-Q2`. Re-run to check current progress before any Q2 bonus dry-run.
- **First-ever supervised HR_ACCOUNTING/ADMIN Run Billing click** and **CEO smoke-test of Generate Timesheet with a real range** — both still open from the 2026-08-06 PR #15 thread, not yet confirmed done.
- `runSendOnboardingEmailToARN()` — harmless one-off sitting in `StaffOnboardingMailer.gs`, safe to delete whenever that file is next touched.
- **19 truly orphaned job_numbers** (post-cutover, don't resolve via normalization) — needs a manual decision: create VW rows for them, or write them off. See `PROJECT_MEMORY.md` §12 ADR-WL-001.
- **Admin overhead policy decision** — how should `"job assign & help"`-style non-job hours be tracked going forward? Separate pseudo-job in VW, or excluded entirely from work-log reporting?
- **`submitted_at`/`created_at` bug in `writeQueueItem`** — identified 2026-07-08, not yet fixed.
- **Test suite uses some real staff identities** — needs a DEV-only-synthetic-actor pass; a lot of this session's own work already moved this direction, but the original audit item was never formally closed.
- **Inactive staff security check** — review RBAC/portal access for staff marked `active=FALSE` in `DIM_STAFF_ROSTER`, not re-verified since the 2026-06-29 active-flag fix.
- **June billing** — was blocked on Sarty confirmation of June 06B reconciliation findings + outstanding designer hour submissions; status not rechecked recently.
- **Business/ops, non-code**: forward 16 Q1 bonus letters (₹72,231.13, sitting in CEO inbox) to designers; send Q2 rating + feedback requests via portal (confirm current quarter status first); raw Q1 `FACT_WORK_LOGS` dedup (1,694 rows from a Jan–Mar CSV re-import, bonus already corrected via amendment, raw data itself still uncleaned).
