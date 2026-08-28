# PROD Readiness Assessment — Payout Statement Summary + Run Payroll Button

**Delivered:** 2026-08-27, as CTO advisory, at explicit user request ("advise me on the safest way to take this to production... make sure you are sure before we move it to production mode").

**Scope of this assessment:** everything merged to local `main` at commit `4d14ac9` this session — the Payout Statement Summary feature (preview trigger, additive HR email on real commits, Paystub→Payout Statement rename) plus the same-session follow-on "Run Payroll" portal button. Not yet pushed to `origin`, not yet deployed to PROD.

**Bottom line: I believe this is ready for PROD**, with one specific operational caution (the new Run Payroll button, detailed below) and a short mandatory pre-flight sequence. No advisor tool was available in this session to get a second opinion (checked, confirmed unavailable) — this is my own direct analysis, and I've tried to show my work rather than just assert a verdict, so you can push back on any specific claim.

---

## 1. Risk breakdown, by component

**Payout Statement preview (`previewPayoutStatement`, the "📧 Generate Payout Statement" button) — LOW risk.**
No FACT_PAYROLL_LEDGER write, no per-consultant email, fully repeatable. Worst case if something's wrong: an email doesn't send, or has wrong numbers in it. It cannot corrupt payroll data or affect what a consultant sees. This is the safest part of the whole change, by construction — it was designed as a no-write preview specifically so it could never touch the live payroll state.

**Additive HR summary wired into `runPayrollRun`/`runBonusRun` — LOW-MEDIUM risk.**
This adds one new call each to two already-live, financially-critical functions. Three things keep this safe:
- The new call is wrapped in its own try/catch that never rethrows (`sendPayoutStatementSummary_`'s whole body, confirmed in code review) — even a bug in the new email-formatting code cannot break the actual payroll commit around it. Worst case: the new HR email doesn't send, or is malformed; the ledger write and the consultant's own email — the part staff actually depend on — are unaffected.
- The final whole-branch review specifically verified, line by line, that neither function's existing behavior (idempotency check, ledger write, consultant email) was touched — only new lines were added, nothing reordered or modified.
- Live-verified in DEV: ran both functions for real, confirmed exactly one additional email fires per commit, confirmed the existing per-consultant/per-supervisor emails still fire correctly.

**Run Payroll portal button ("💵 Run Payroll") — this is the one piece worth real caution, and it's an *operational* risk, not a code-bug risk.**
`runPayrollRun` already existed and was already fully trusted — this button doesn't change what it does, only *how easy it is to trigger*. Before this change, running base pay required deliberately opening the Apps Script editor and picking the function by name — a high-friction, clearly-deliberate action. Now it's a single click from the portal, gated only by a `confirm()` dialog. The code risk is genuinely low (it's the same well-tested function, just newly exposed); the process risk is that a misclick or habitual "yes" on the confirm dialog now has a lower barrier to triggering a real payroll run for the *current* period — real ledger writes, real emails to every staff member with logged hours. This is the one part of today's change I'd treat with active caution on first real use, not because I found a bug, but because we just live-tested exactly this scenario in DEV and saw firsthand how easy it is to click before fully registering what it does (see the mid-session incident where "Run Payroll" was clicked before the recipient/scope was fully understood — no harm resulted, since only your own account had hours logged, but it's the right cautionary data point).

**Paystub → Payout Statement rename — LOW risk.** Pure string changes, verified against every internal identifier, tested, DEV-confirmed live.

**Unrelated DEV-drift incident found this session — not part of what's deploying, but changes my pre-flight recommendation (see §2.1).** DEV was found running source code older than `main`, missing four already-verified fixes from 2026-08-14, for a cause that's still unknown. This means DEV can silently drift without anyone noticing — the same could be true of PROD, and until now nobody had a habit of checking. I'm treating this as a new standing pre-flight step, not a one-off.

---

## 2. Pre-flight sequence (do this before any deploy, in order)

### 2.1 Verify PROD's actual current source — new step, added because of this session's DEV-drift finding
Before touching PROD, pull its live source and diff it against `main`, the same way we just did for DEV:
```bash
mkdir -p /tmp/prod-check && cp .clasp.prod.json /tmp/prod-check/.clasp.json
cd /tmp/prod-check && clasp pull
# then diff against a git-archived copy of main's src/, same technique used this session
```
If PROD has drifted the same way DEV did, that needs to be understood *before* deploying on top of it — you'd want to know whether PROD is missing fixes too, not just overwrite and hope. If PROD matches `main` exactly, this confirms the baseline is clean and you can proceed with confidence.

### 2.2 Confirm `PAYOUT_STATEMENT_REVIEW_RECIPIENT` in PROD
Set it explicitly to the real HR mailbox (`HR@bluelotuscanada.ca`, or wherever it should actually land) via Script Properties — don't rely on the hardcoded fallback silently being correct. Confirm someone actually monitors that inbox before the first real run.

### 2.3 Standard R5/R6 checklist (already in `CLAUDE.md`, not new — just restating as part of this specific deploy)
- **Update, 2026-08-28: `git push origin main` already happened** — local `main` and `origin/main` are identical at `af71c81` (confirmed via real `git fetch`). `git status` clean, `git log origin/main..HEAD` empty. This gate is satisfied — the only remaining approval needed is for `npm run push:prod` itself.
- `.clasp.json` matches `.clasp.prod.json` (handled by `npm run push:prod` itself).
- `grep -r "whoAmI\|isDev\|rajeshnair\|rajnaircanada\|nairscanada" src/` — the R5 dev-actor leak check. Worth noting: this feature's tests use `test-hr@test.blc.internal`/`THR`-style synthetic identities that only resolve under `Config.isDev()` — they should not appear in this grep's real hits, but run it as always.

### 2.4 After `npm run push:prod`
- **New Version redeploy is mandatory** — this feature touches `Portal.gs` and `PortalView.html`. Confirm you're redeploying the deployment entry whose URL matches `PORTAL_BASE_URL`, not just the first one listed (the exact mistake found and fixed during this session's own DEV walkthrough history).
- Watch `HealthMonitor` for 5 minutes post-deploy per R9's stop condition — if it fires any critical alert, stop and investigate before anyone uses the new buttons.
- Do a harmless smoke test first: click "📧 Generate Payout Statement" (preview, no-write) before anyone touches "💵 Run Payroll" or "💰 Run Bonus" for real. Confirm the email arrives correctly in PROD, exactly as it did in DEV.

---

## 3. Rollout sequence I'd recommend

1. Deploy the code (§2 above). Deploying does not force anyone to use anything — R9's stop conditions and the existing RBAC gates are unchanged.
2. First real use of "📧 Generate Payout Statement" (preview) — CEO, supervised by you personally watching the result, same as any first-time production use of a new financial-adjacent feature in this codebase's own history (this repo already has this exact pattern documented — see the still-open "First-ever supervised HR_ACCOUNTING/ADMIN Run Billing click" item elsewhere in `CTO_TASK_QUEUE.md`).
3. Only after that's confirmed working: first real use of "💵 Run Payroll" for an actual period, watching closely — confirm the ledger write, the consultant emails, and the new HR summary all land as expected, for real people this time.
4. Same for "💰 Run Bonus" if it hasn't been used in PROD before under this exact combined-summary behavior (the button itself is pre-existing; only its new HR-summary side effect is new).
5. Normal cadence from there — no special caution needed once the above three have each been confirmed once for real.

**No schema changes, no data migration in this feature** — that's a real safety factor. Rollback (R7) is the standard `git revert` + redeploy, cleanly, with nothing structural to unwind.

---

## 4. What I'm explicitly *not* deciding for you

- Whether HR_ACCOUNTING should ever get real commit access (`PAYROLL_RUN`) — you already decided no, correctly, and this deploy doesn't touch that.
- Exactly who does the supervised first clicks, or when — that's scheduling, not a technical readiness question.
- The root cause of the DEV-drift incident — worth investigating separately, doesn't block this deploy once §2.1 confirms PROD itself hasn't drifted the same way.

---

## 5. Emergency rollback — what to do if something breaks

**First: this deploy is structurally low-risk for a full outage, and that's by design, not luck.** Everything in this feature is additive — new functions, new buttons, one new guarded line each in `runPayrollRun`/`runBonusRun`. Nothing existing was rewritten. No schema change, no data migration, nothing touches `FACT_WORK_LOGS`/`FACT_JOB_EVENTS`/QC/billing at all. So the realistic failure modes split into two very different severities — diagnose which one you're in before picking a remedy:

**Case A — only the new pieces misbehave (most likely if anything goes wrong).**
Symptoms: "Generate Payout Statement" / "Run Payroll" / "Run Bonus" throws an error, or the HR email doesn't arrive, or looks wrong — but job creation, work log submission, QC, billing, and everyone's normal day-to-day portal use are unaffected.
**This is not a system-down situation, and does not need an emergency rollback.** The rest of the team keeps working normally. Just stop using the broken button, tell me what you saw, and we fix it properly (new commit, new deploy) at normal pace — no pressure to rush a fix live. This is the expected shape of *any* real issue here, precisely because every new email-sending path is independently wrapped so it can't take anything else down with it (verified in review, not just claimed).

**Case B — the portal itself won't load, or something clearly outside this feature breaks (e.g. a JS error blocks the whole page).**
This would mean something unexpected slipped through everything above — unlikely, but here's the exact remedy, straight from `CLAUDE.md` R7, with the one nuance that matters for *this specific* deploy:

1. **Stop.** Don't make more changes, don't try to hot-fix live. Tell me and we execute the rollback below.
2. **Revert the merge commit** — because this landed as a merge (not a single commit), a plain `git revert` will fail; it needs `-m 1` to tell git which side is the "real" history:
   ```bash
   git revert -m 1 4d14ac9
   ```
   (`4d14ac9` is the actual merge commit — confirm with `git log --oneline` first in case anything's landed on top of it by then.)
3. **Push the revert:**
   ```bash
   git push origin main
   ```
4. **Redeploy:**
   ```bash
   npm run push:prod
   ```
   then a **New Version redeploy** in the Apps Script editor (mandatory — this touched `Portal.gs`/`PortalView.html`, same as the original deploy).
5. **Verify:** portal loads, a real (non-test) job round-trips correctly, `HealthMonitor` shows no new critical alerts.

This restores the exact pre-deploy state. Nothing is lost — the revert is itself a new commit, so the broken version stays in history and nothing needs to be force-pushed or discarded.

**One more scenario worth naming, because it's different from both above — a real financial mistake, not a code bug** (e.g. "Run Payroll" gets clicked for the wrong period, or by mistake). This is *not* a code rollback situation at all: `FACT_PAYROLL_LEDGER` is append-only by architectural rule (A5, `.claude/rules/architecture.md`) — nothing gets deleted or overwritten to fix it, ever. The remedy is the same pattern already used elsewhere in this codebase for payroll/work-log corrections: a new adjustment/void event on top, never touching the original row. Tell me what actually happened and I'll help construct the correction — this is a data-correctness conversation, not a rollback, and it doesn't require reverting any code.

---

## 6. My actual verdict

Ready to deploy once §2's pre-flight steps pass. The code is well-tested (535/535, live DEV-verified across every real path including the exact failure mode of an idempotent re-run), reviewed twice over (per-task plus a whole-branch pass that caught and fixed 4 real issues before you ever saw it), and additive by design everywhere that matters. The one thing I'd treat with real operational caution — not because of a bug, but because we just watched it happen — is the reduced friction on triggering a real payroll run from the portal. Supervise the first real click on that specific button; everything else is routine.
