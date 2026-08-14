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

## Session State (last updated: end of turn, 2026-08-14)

**SOP upload workflow — PR #22 MERGED to main** (https://github.com/blccanada2026-lang/BLC-Automation/pull/22,
merge commit `c0835de`, merged 2026-08-14 12:10 UTC via GitHub directly —
not a Claude action). Implementation complete (4 tasks + 1 final-review
fix wave, commits `55ba9c7..0632b56`) — full detail in `SESSION_LOG.md`'s
2026-08-13 entry. New CEO-only structured-upload → manager-review →
CEO-publish path for SOP documents (`SopUploadEngine.gs`,
`DIM_SOP_UPLOADS`, `FACT_SOP_REVIEW_FEEDBACK`, `SOP_UPLOAD` RBAC action,
`ReviewSop.html`).

**Final whole-branch review found 1 Critical + 6 Important issues, all
fixed and re-verified clean:** neither the manager review page nor the
CEO publish screen originally showed the structured checklist/notes the
human was meant to verify before approving — both now render it. Plus 6
Important fixes (XSS escaping, template-mismatch validation, Drive file
sharing, silent-missing-link error surfacing, `QC_REVIEW_SOP` publish
guard).

**LIVE DEV TESTING IN PROGRESS as of 2026-08-14, resumed this session.**
Branch pushed to DEV (167 files, includes `ReviewSop.html`/
`SopUploadEngine.gs`) — confirmed no drift first (DEV matched `main`
exactly before push, byte-for-byte). User wants a real end-to-end
walkthrough, in this order:
1. **Setup (in progress):** `runSetupSchemas()` — **DONE**, confirmed clean
   (first attempt hit a transient `Service Spreadsheets timed out` on
   `ensureHeaders_`, `setup/SetupScript.gs:633`; re-run succeeded, all
   tabs ✅ EXISTS including `DIM_SOP_UPLOADS`/`FACT_SOP_REVIEW_FEEDBACK`/QC
   partitions — `setupSchemas_()` is idempotent so the retry was safe).
   Next: `runGenerateSopReviewSecret()` (`src/07-portal/Portal.gs:986`) —
   awaiting result. Then confirm the DEV web app's "Who has access"
   deployment setting (checked-in `appsscript.json` says `MYSELF`, almost
   certainly stale vs. reality since 100+ staff already use no-login
   `?pt=` portal links — verify, don't assume).
2. **Designer + QC flow — IN PROGRESS.** Step 1 fully done: schemas
   confirmed, `SOP_REVIEW_LINK_SECRET` generated (separate Script
   Property from the R9-protected `PORTAL_LINK_SECRET` — no conflict),
   DEV web app access confirmed "Anyone with the link",
   `runSopUploadEngineTests()` 37/37 passing live (also confirmed
   `TEST-CLIENT` already exists in `DIM_CLIENT_MASTER` via
   `thEnsureTestClient_()`, run as part of that suite).

   Researched the mechanism before scripting instructions: `SopGate`
   matches a job to a template by `(client_code, product_code)` only —
   `SopAdminEngine.createTemplate`'s `scopeCode` param IS what gets
   matched against the job's `product_code` (`job_type`/`software` are
   stored but not part of the lookup key). Portal identity
   (`PortalAuth.resolveEmail`) requires either a same-domain Google
   session or a signed `?pt=` token resolving to an **active
   `DIM_STAFF_ROSTER` row** — consumer Gmail accounts (all current DEV
   test actors) don't reliably get a session identity, so `?pt=` links
   are required even for the real-Gmail dev actors (RND/NTL/RPM), not
   just synthetic ones. `seedTestStaff()` (`src/setup/TestRunner.gs:309`,
   idempotent) creates the roster rows DS1/QC1/RND/NTL need to make
   those tokens resolve. `PortalAuth.buildPersonalLink(personCode)`
   (`src/02-security/PortalAuth.gs:247`) builds the link directly.

   Gave user a single paste-and-run GAS editor script
   (`livetest_seedStep2`, not committed — ephemeral, next `push:dev`
   wipes it per the clasp-clobber behavior) that: runs `seedTestStaff()`
   → creates+publishes a synthetic template (`TEST-CLIENT` /
   `TEST_JOB_TYPE` / `TEST_SOFTWARE` / `TEST_SCOPE`, 3 items) → sets
   `SOP_ENABLED='true'`, `SOP_MODE='WARN_ONLY'`,
   `SOP_PILOT_CLIENTS='TEST-CLIENT'` (scoped only to the synthetic
   client — does not touch/enable the real NORSPAN-MB W2-1 pilot config)
   → prints `?pt=` links for NTL (create+assign job), DS1 (designer,
   fills checklist), QC1 (QC, reviews).

   **Seed script run 2026-08-14 07:06 — succeeded.** Template
   `ST-7E2750DAC142` published (3 items). Gate flags set
   (`SOP_ENABLED=true`/`SOP_MODE=WARN_ONLY`/`SOP_PILOT_CLIENTS=TEST-CLIENT`).
   `?pt=` links generated for NTL/DS1/QC1 (not recorded here — signed
   tokens, regenerate via `PortalAuth.buildPersonalLink(code)` if
   needed again; they don't expire unless `PORTAL_LINK_SECRET` rotates).
   **Real gap found & fixed 2026-08-14 07:27:** the portal's Create Job
   modal (`PortalView.html:829-846`) uses **fixed dropdowns**, not free
   text, for Job Type (`DESIGN|REVISION|PRINT|RUSH`) and Product Code
   (`ROOF_TRUSS|FLOOR_JOIST|FLOOR_TRUSS|WALL_PANEL|LUMBER_TAKEOFF`) —
   these don't match `Config.PRODUCT_CODES` (`TRUSS|OPEN_WOOD_FLOOR|
   I_JOIST_FLOOR`, a separate, inconsistent vocabulary used elsewhere,
   e.g. `SopUploadEngineTest.gs`) and don't match the original synthetic
   `scopeCode='TEST_SCOPE'` template — that template could never be
   reached since `TEST_SCOPE` isn't a selectable product. User's first
   test job used product_code `ROOF_TRUSS` (real dropdown value); built
   a second template for `TEST-CLIENT`/`ROOF_TRUSS`
   (`ST-AA97BEA3CBC9`, published) to match it. First bad template
   (`ST-7E2750DAC142`, scope `TEST_SCOPE`) left as harmless orphan, not
   retired — no collision risk, different scope_code.

   Checklist loaded fine, all 3 items checked — but no "Submit QC"
   button appeared. **Second real gap found 2026-08-14 ~07:35:** user
   was browsing the DS1 `?pt=` link while signed into the CEO's own
   Google account. `PortalAuth.resolveEmail()` checks
   `Session.getActiveUser().getEmail()` BEFORE the token
   (`src/02-security/PortalAuth.gs:113-117`) — for the script owner
   this is always non-empty, so it silently overrides any `?pt=` token
   and resolves as CEO regardless of which link was opened (only
   non-owner Google accounts get '' from Session and correctly fall
   through to the token). Checklist still loaded because CEO bypasses
   all RBAC; but `canSubmitQC` (`PortalData.gs:305`) deliberately
   excludes CEO, so the button never rendered. **Not a code bug** —
   inherent Apps Script owner-session behavior. Fix: user must open
   `?pt=` links (DS1, QC1) in a context NOT signed into the CEO Google
   account (Incognito / separate Chrome profile).

   **Third real gap found & fixed 2026-08-14 ~07:50:** same
   session-overrides-token issue recurred with NTL instead of CEO —
   reusing the same Incognito window across identities (NTL to create
   the job, then DS1 in the same window) kept the NTL Google session
   active, which again silently overrode the DS1 `?pt=` token. Fix:
   each identity needs its own fresh Incognito window (close
   completely, reopen, go straight to the link with no Google sign-in
   first) — confirmed working once done that way (header showed "Test
   Designer"). **General lesson for any future portal walkthrough with
   multiple non-owner test identities: one full Incognito
   window-close-and-reopen per identity, not just a new tab.**

   Along the way, confirmed 3 leftover `TEST-CLIENT`/`ROOF_TRUSS` jobs
   exist from this session's trial-and-error: `BLC-00288` (used for the
   real walkthrough), `BLC-00289`/`BLC-00290` (harmless duplicates,
   never started — can be ignored/left as-is, DEV-only).

   **`BLC-00288`: checklist filled (3/3 items) → Submit QC completed as
   DS1 → job now shows QC_REVIEW state.** SOP gate should have logged
   `SOP_GATE_PASSED` (all required items were checked) — not yet
   independently confirmed in `_SYS_LOGS`, optional to verify later.

   **Fourth real gap found ~08:05:** QC1 (fresh Incognito, correctly
   resolved) couldn't see `BLC-00288` in its list. `loadJobs_`'s
   QC-scope filter (`PortalData.gs:188-202`) only shows a QC actor jobs
   where the designer is on their team (`REF_ACCOUNT_DESIGNER_MAP` or
   `supervisor_code` — DS1's `supervisor_code` is `SDA`, not `QC1`, and
   no account-map row links them) OR `qc_reviewer_code` already equals
   their own code. `QC_SUBMIT` does not auto-assign a reviewer — that's
   the separate `QC_REASSIGN` action (`QCReassignHandler.gs`,
   `new_reviewer_code` payload field, TL/PM/CEO permission). **Not a
   bug** — by design a QC reviewer must be explicitly assigned. Fix in
   progress: NTL (fresh Incognito) running "Reassign QC" on `BLC-00288`
   → `QC1`, then QC1 refreshes.

   **Real pre-existing bug found & fixed, user approved fixing
   immediately (2026-08-14 08:48):** the "Reassign QC" dropdown
   (`portal_getQCReviewers`, `Portal.gs:342-360`) filtered
   `QC_ROLES = { QC_REVIEWER, TEAM_LEAD, PM, CEO }` — **plain `QC` role
   was never included**, even though `RBAC.gs:93` aliases
   `QC_REVIEWER` → `QC` for all permission purposes and every other
   scope/visibility check in `PortalData.gs` treats them as
   equivalent. Net effect: any staff member with role exactly `QC`
   (not `QC_REVIEWER`) could never be assigned as a job's QC reviewer
   through the portal — possibly a live PROD gap, not confirmed either
   way whether any real QC-role staff exist in PROD roster (worth a
   follow-up check, not blocking). Not part of PR #22's scope — a
   pre-existing latent bug this walkthrough surfaced (same pattern as
   the 2 bugs W2-3's first live run found). **Fix:** added `QC: true`
   to `QC_ROLES` (one line). Pushed to DEV — `npm run push:dev`,
   "Pushed 167 files" 2026-08-14 08:48. **NOT committed to git yet**
   (only create commits when explicitly asked) and **NOT pushed to
   PROD** (needs separate explicit approval per standing practice).
   Reminder: get user's go-ahead to commit + eventually PROD-deploy
   this once the DEV walkthrough confirms it works.

   QC1 still didn't appear in the dropdown after the push — root cause:
   `clasp push` updates script *source*, but the DEV web app `/exec`
   URL (all `?pt=` links) serves a pinned **Version**, same mechanic as
   the R4.7/R5 PROD rule ("serves the last manually deployed version,
   NOT the latest clasp push") — just never previously hit for DEV in
   this session since earlier changes (schema/properties) don't need a
   redeploy, only `Portal.gs`/`PortalView.html` changes do. User did a
   New Version redeploy — but then NTL's own job list came back empty.

   **Diagnosed via `PortalData.getViewData('nairscanada@gmail.com')`
   direct call: NTL's actor/scope resolved correctly
   (`personCode:NTL, role:TEAM_LEAD, scope:TEAM`), but `job count: 0`.
   Root cause — correct RBAC behavior, not a bug:** `TEAM_LEAD` scope
   only shows jobs where the designer is a team member
   (`supervisor_code === 'NTL'` or a `REF_ACCOUNT_DESIGNER_MAP` link).
   `DS1`'s seeded `supervisor_code` is `SDA`, not `NTL` — so NTL
   genuinely never had visibility into DS1's jobs. **This means the
   earlier "successful" Reassign QC attempt (before this) was almost
   certainly still running on the CEO session** — header was never
   re-verified right before that specific step. Lesson: re-verify the
   header every time before trusting an action, not just once per
   window.

   **Fix for the walkthrough: use the CEO's own regular (non-incognito)
   browser session for admin actions on `BLC-00288`** — CEO scope is
   `ALL`, no team filter, no token dance needed (script owner). The QC
   scope filter has an OR-escape-hatch independent of team membership
   (`reviewer === qcCode`), so once `qc_reviewer_code` is set to `QC1`
   via Reassign QC, QC1 will see the job regardless of the team-scope
   restriction that blocked NTL.

   CEO could see + reassign the job and open Review, but the
   findings-picker didn't appear at all when MINOR_REWORK was selected
   (Rework Notes did appear — same toggle handler, so this was a real
   split, not user error).

   **Fifth real gap found ~09:50 — genuinely stale deployment, distinct
   from the earlier PROD-vs-clasp-source rule.** Diagnosed by checking
   the live DOM (not View Source — Apps Script serves content inside a
   `*.googleusercontent.com` iframe, so View Source / default-frame
   console both show Google's outer wrapper, not the actual page — a
   dead end that cost a few rounds before catching it). Confirmed via
   the "Finding(s)" label being visually absent entirely (not just an
   empty list) that the served page predated PR #21. Root cause: **the
   DEV Apps Script project has more than one deployment entry** — the
   one the user had been editing (bumped to "version 49") was NOT the
   one `PORTAL_BASE_URL` / the `?pt=` links actually point to
   (`.../AKfycbxJ_hEMbcw2.../exec`). Editing/redeploying the wrong
   entry explains why the earlier `QC_ROLES` fix verification was also
   never actually confirmed against the real served app. **Fix: user
   located the correct deployment (matching the known URL) and
   confirmed the findings-picker now renders.** Standing lesson for any
   future `Portal.gs`/`PortalView.html` DEV redeploy: always confirm
   which deployment entry's URL matches `PORTAL_BASE_URL` before
   trusting a "New Version" redeploy — don't assume there's only one.

   Also note: 16 of 17 seeded `DIM_QC_FINDING_TYPES` rows have
   `product_applicability='ALL'`; only `PLATE_ERROR` is
   product-specific (`'TRUSS'`, the `Config.PRODUCT_CODES` vocabulary,
   not the portal dropdown's `ROOF_TRUSS`) — so the vocabulary mismatch
   already logged above would only ever hide that one code, not empty
   the whole list. Not the cause of this gap, but worth remembering if
   `PLATE_ERROR` specifically seems to never appear during future
   testing with a `ROOF_TRUSS`-product job.

   **STEP 2 COMPLETE (2026-08-14 ~10:00).** Findings selected,
   MINOR_REWORK submitted → `BLC-00288` correctly transitioned to
   `MINOR_FIX` state (Log Work / Mark Sent to Client actions now
   available) — this transition only happens if the backend accepted
   `finding_codes`, confirming the PR #21 findings-picker works
   end-to-end live in DEV (UI → queue → `QCHandler` → state machine).

   **Real gaps found & fixed this step (all now resolved):** (1)
   portal Product Code dropdown uses a fixed real vocabulary, not free
   text — synthetic template had to target `ROOF_TRUSS` not an
   invented code; (2) Apps Script owner/session identity silently
   overrides `?pt=` tokens — every non-owner test identity needs its
   own fully-fresh Incognito window, not just a new tab/link; (3)
   `portal_getQCReviewers` excluded plain `QC` role from the
   reassign-dropdown (real pre-existing bug, fixed, pushed to DEV —
   `QC: true` added to `QC_ROLES` in `Portal.gs:346`); (4) TEAM_LEAD's
   job-list scope is genuinely team-restricted (correct behavior, not a
   bug — DS1 isn't NTL's report); (5) the DEV Apps Script project has
   multiple deployment entries and it's easy to redeploy the wrong one
   — always confirm the deployment URL matches `PORTAL_BASE_URL` before
   trusting a redeploy.

   **Still open, not urgent:** the `QC_ROLES` fix (#3 above) is pushed
   to DEV but **not committed to git and not deployed to PROD** — needs
   explicit user go-ahead for both, separate from this walkthrough.
3. **SOP upload flow, NOT YET STARTED**: user (as CEO) uploads a real
   document → Claude structures it → user gets a review link → user
   plays the "manager" role, approves via the link → user publishes.
   This is also where checklist items #2 (`runGenerateSopReviewSecret`),
   #4 (`driveFile.setSharing` domain-policy check), and #5 (real
   `google.script.run` file-transport check) actually get exercised.

**`runSopUploadEngineTests()` (17 tests) still not executed live** —
should be run as part of step 1 once schemas/secret are set up, same
process as the QC-findings-picker feature (whose own live run found 2
real bugs invisible to manual trace).

Also note: the QC-review-SOP backend (`QcProcessAdminEngine`) remains
unbuilt — `doc_type: 'QC_REVIEW_SOP'` uploads can be created and reviewed
by managers through this workflow, but `publishUpload` explicitly rejects
publishing them until that engine exists (out of scope for this PR,
flagged as the next project).

**W2-1 — numeric conflicts resolved by user's managers, 2026-08-10.**
All three blockers from the two NORSPAN-MB source docs (`SOP-NOR-TRS-003`
designer rules, `SOP-NOR-TRS-QC-005` QC-reviewer checklist) now have
confirmed answers:
- **Deflection limit: L/360 for both LL and TL** (Doc 1 was correct;
  Doc 2's L/300 was wrong).
- **Valley truss stud spacing: 4' O.C. is the default; 24" O.C. applies
  only when the valley is at an exposed location, for sheathing** — both
  docs were partially right, this is a conditional exception, not a
  straight conflict. Checklist item wording needs to capture the
  exposed-location condition, not just state one flat number.
- **Span limits: Residential 40' / Commercial 75' caps confirmed** (Doc
  1), **and separately, truss length >48' requires 2×6 top & bottom
  chords** (clarifies Doc 2's "2×6 for spans ≥48'" as a lumber-sizing
  rule, not a competing span cap) — "both apply together" was the
  right call. Note: Doc 2's other claim ("2×4 up to 28'") was not
  explicitly restated by the manager — minor loose end, not blocking
  given the checklist is category-level (~9 items), not itemizing every
  lumber-size threshold individually.

All prior settled inputs still stand: software = Alpine, ~9-item
category-level granularity, `job_type='Roof Truss'`/`scope_code='TRUSS'`.
Doc 2's QC-reviewer content (admin tracking, Pass/Fail, Root Cause
tagging, Section 7) is still explicitly held aside from this pilot —
targets the separate unwired `PRODUCT_QC_TRUSS` system, not `SopGate`.

**Next action — W2-1 now unblocked, ready to build:** write the
~9-item designer checklist reflecting the resolved values above, then
build/publish via `SopAdminEngine.createTemplate`/`addItem`/
`publishTemplate` for NORSPAN-MB. Original pre-flight gap (confirm no
conflicting ACTIVE template already exists in `DIM_SOP_TEMPLATES` for
NORSPAN-MB) still applies — check before flipping `SOP_ENABLED`.
2026-08-17 pilot start date back on track.

**W2-3 (findings-picker UI) — merged to main 2026-08-12 (PR #21,
`5e80aa7`), fully validated live in DEV.**
`runQCFindingsPickerTests()` 23/23, `runQCHandlerTests()` 25/25,
`runQCHandlerFlowTests()` 31/31 — **79/79 passing, 0 regressions.**
Live execution (this was the first time these suites ever actually
ran — previously only manually traced) found and fixed 2 real bugs
along the way: a `PARTITIONED_TABLES` registration gap for
`FACT_QC_FINDINGS`, and a Google-Sheets-coerces-`"TRUE"`-to-boolean
bug in the `active_flag` check (2 call sites). Full writeup in "Other
Still-Open Items" below and in `SESSION_LOG.md`'s 2026-08-12 entry.
`DIM_QC_FINDING_TYPES` confirmed seeded correctly in DEV (17/17 rows).
**Not yet deployed to PROD** — no PROD deploy is authorized without
separate, explicit user approval (CLAUDE.md R4/R6/R9). When that
approval comes: Tasks 2+3 (backend validation + frontend picker) must
ship together, same push — the backend unconditionally rejects
MINOR_REWORK/MAJOR_REWORK without `finding_codes`, and the frontend is
the only thing that supplies it from the real UI.

---

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
- **TASK W2-3** | Build QC findings-picker UI: multi-select finding codes (from `DIM_QC_FINDING_TYPES`) on the `#modal-qc-review` modal, new `portal_getQcFindingTypes()` read endpoint (first-ever reader of that table), `QCHandler.gs` changes to accept/store selected finding code(s) on the QC event | P2 | **DONE 2026-08-12 — merged to main (PR #21), 79/79 tests passing live in DEV.** Only remaining step is a PROD deploy, which needs separate explicit user approval. See Session State above.
- **TASK W2-4** | Build SOP upload workflow: CEO-only structured upload → manager review link (no login) → CEO publish, for both SOP designer docs and (partially) QC-review SOP docs | P2 | **Implementation DONE 2026-08-13 on branch `sop-upload-workflow` (4 tasks + final-review fix wave, commits `55ba9c7..442aa7a`) — NOT yet merged, NOT yet deployed to DEV or PROD.** Final whole-branch review found and fixed 1 Critical (manager/CEO review screens didn't show the structured checklist) + 6 Important issues. `runSopUploadEngineTests()` (17 tests) manually traced only, needs a live DEV run per the 5-item checklist in Session State above before trusted.

### EPIC: Wave 3 — Client Feedback data-model extension
- **TASK W3-1** | Add structured severity/root-cause/resubmission fields to the existing `ClientFeedback.gs` intake | P3 | Depends on Wave 2 producing real QC data. Not started.

### EPIC: Wave 4 — Quality Analytics
- **TASK W4-1** | Define metrics precisely (First Pass Quality, rework rate by designer/client/product, etc.) before any dashboard work | P3 | Not started.

### EPIC: Wave 5 — Learning Hub
- **TASK W5-1** | Design content/tagging model | P4 | Sequenced after Wave 2 produces real error-classification data. Not started.

### Parallel Track: BLC Growth Platform
- **TASK GP-1** | Standalone project decision + architecture (own future CTO assessment, not folded into this backlog) | P4 | Not started, not scoped.

---

## Other Still-Open Items

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
