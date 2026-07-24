# DRIFT_CHECK.md — PROD vs. DEV Source Drift Check

**Purpose:** confirm that PROD's *currently live* source for every file in
the Phase 4 promotion scope has not diverged from the `main` git baseline
this branch was built against — i.e. that promoting this branch's changes
onto PROD is a clean, known delta, not a merge against source PROD already
moved past.

**Scope:** the 8 files listed in `PROMOTION_CHECKLIST.md`'s file list (3 new,
5 modified). Method and result for each below.

**Date:** 2026-07-23
**Run by:** Claude, in this session, per your explicit Phase 4 instruction.

**Revision note (2026-07-23):** the original version of this document
listed `DanglingCorrectionGuard.gs` as one of the 3 new files and checked
it against a live PROD pull. It has since been dropped from the promotion
entirely (deferred — see `PROMOTION_CHECKLIST.md` §1) and is replaced below
by `AggregationFixDryRun.gs`, which did not exist yet when the PROD pull
below was performed — see the note under "The 3 new files" for how its
absence from PROD is established.

---

## Method

PROD source was read via `clasp pull`, **not** by repointing this worktree's
`.clasp.json`. Instead, a separate, isolated clasp project was created in
the session scratchpad directory
(`prod-source-drift-check/.clasp.json`, pointed at the PROD script ID,
`rootDir: "./src"`), entirely outside this worktree. `clasp pull` ran there,
downloading PROD's live source into that isolated directory. This never put
this worktree's own `.clasp.json` at risk of pointing at PROD at any point —
a stronger guarantee than "repoint and revert," which was the method you
described; I used this instead and am flagging the substitution explicitly
rather than silently doing something different from what was asked.

**This worktree's own `.clasp.json` was never modified.** Confirmed before
and after the pull:

```
{
  "scriptId": "1smkj0mmUqcWDDJPq-RUuVxRG4nE3TMKy4KrOIVUcdEN9lrFucL57aqAE",
  "rootDir": "./src"
}
```
— the DEV script ID, unchanged throughout.

No `clasp run`, no writes, no execution of any kind — `clasp pull` only
downloads source files.

The temporary PROD-source copy in scratchpad was deleted immediately after
this comparison was completed (`rm -rf prod-source-drift-check`) — confirmed
removed before this document was written.

---

## Result: no drift found

**140 files pulled from PROD.** (Note: `clasp pull` writes `.js` extensions
by default; content, not extension, was compared.)

### The 3 new files — absence from PROD established

| File | Found in PROD? |
|---|---|
| `WorkLogExclusion.gs` | No — 0 matches (live PROD pull, this document's original check) |
| `WorkLogAggregation.gs` | No — 0 matches (live PROD pull, this document's original check) |
| `AggregationFixDryRun.gs` | Not independently re-pulled — reasoned, not re-verified live: this file didn't exist until after the PROD pull below was performed, and this session's own `npm run push:dev` logs are the only place it has ever been pushed (confirmed DEV script ID each time). It cannot be in PROD without a push this session never made. Stated as a sound inference from this session's own action history, not re-confirmed by a fresh pull — flagging the distinction rather than overclaiming a live check that didn't happen. |

Also explicitly checked and confirmed absent from the original pull
(correctly out of promotion scope entirely as of the 2026-07-23 revision —
DEV-only diagnostics, never to be promoted): `DanglingCorrectionGuard.gs`,
`CrossPartitionCorrectionAudit.gs` — both 0 matches in PROD.

### The 5 modified files — byte-identical to `main`, zero drift

Each file was diffed: PROD's live content vs. `git show main:<path>` (the
commit this branch diverged from, `9605d9d`).

| File | Result |
|---|---|
| `src/06-handlers/WorkLogHandler.gs` | Identical to `main` — no drift |
| `src/10-payroll/PayrollEngine.gs` | Identical to `main` — no drift |
| `src/10-payroll/QuarterlyBonusEngine.gs` | Identical to `main` — no drift |
| `src/09-billing/BillingEngine.gs` | Identical to `main` — no drift |
| `src/11-reporting/ClientTimesheetEngine.gs` | Identical to `main` — no drift |

**Conclusion: zero drift.** Nobody has pushed a change directly to PROD for
any of these 5 files since the DEV snapshot this branch was built from
(`main` at `9605d9d`). Promoting this branch's diff for these 8 files onto
PROD is a clean, known delta — exactly what's in `git diff main HEAD -- <the
8 files>`, nothing more, nothing PROD has that DEV doesn't for these files.

This also means the "fresh shared-aggregation-guard run" required by
`PROMOTION_CHECKLIST.md`'s pre-promotion gate, run against this worktree's
copies of the 5 modified engine files, is valid evidence for the PROD-bound
versions of those same files too — there is no PROD-only code path in any of
them that this worktree's copy doesn't already account for.

---

## What this does NOT check

- **Files outside the 8-file promotion scope.** Only these 8 files were
  compared. No claim is made about drift anywhere else in the 140-file PROD
  tree.
- **Runtime/data state** — this compares source code only. It says nothing
  about `FACT_WORK_LOGS` or any other sheet's data, and nothing about
  Script Properties, triggers, or deployment configuration.
- **PROD deploy version vs. PROD script source** — `clasp pull` reads the
  *latest saved* Apps Script source, not necessarily what's served by the
  live `/exec` URL if a "New Version" deploy hasn't been done since the last
  save (per `CLAUDE.md` R5/R4.7's standing warning about this gap). Not
  relevant to this drift check specifically (source-level comparison only),
  but worth remembering before promotion: pushing new source to PROD does
  not, by itself, mean requests immediately see it if a redeploy step is
  also required for the surface being changed. None of the 8 files here are
  `PortalView.html`/`Portal.gs`, so this specific redeploy trigger does not
  apply to this promotion.
