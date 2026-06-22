# Context Management Rules — BLC Nexus

## Session Scope Rule
One session should normally equal:
> **one client + one month + one workflow phase + one bounded deliverable**

If you find yourself spanning multiple clients, multiple months, or multiple unrelated modules in one session — stop and use /compact or /clear before continuing.

---

## When to Use /compact
Run `/compact` when any of the following are true:
- Context feels large or sluggish
- More than 6 files have been changed
- `git diff` exceeds ~800 lines
- More than 3 test/fix loops have occurred on the same problem
- Switching task phases (e.g. from building to testing)

---

## When to Use /clear
Run `/clear` when:
- Switching major domains (e.g. payroll → billing → onboarding)
- Switching clients or months
- After a completed migration slice
- After a major milestone is committed and pushed

---

## When to Use /btw
Use `/btw` for side questions or brief tangents that don't belong in the main task thread. This keeps the primary context clean.

---

## File Reading Rules
- Read the **smallest relevant file region** — use line ranges, not full file reads
- Do not re-read a file you already have in context unless it has changed
- Do not paste full log output unless explicitly asked
- Summarize long command output (e.g. test runs, build output)

---

## State Persistence Rules
- Update `.claude/context/migration-status.md` at the end of any migration session
- Update `.claude/context/backlog.md` when features are completed or added
- Do not rely on chat history to remember session state — write it to a file

---

## Session End Checklist
Before ending any session:
1. `git status` — list all changed files
2. Summarize what was changed and why
3. If task is complete and tested → `git commit` with a clear message
4. `git push origin main` — always push after commit (remote is the backup; never leave local-only)
5. `npm run push:prod` — always run immediately after `git push origin main` to deploy to live Apps Script
6. If working tree is dirty and task is NOT complete → warn clearly, do not commit or push
7. Update `migration-status.md` if migration work was done
8. Update `backlog.md` if any features were completed or added

**`npm run push:prod` safety rule:** Only after `git push origin main` succeeds. Never mid-session.
If the change touches `PortalView.html` or `Portal.gs`, remind user to do a New Version redeploy in Apps Script editor (Deploy → Manage → Edit → New Version).
