# Open Items — BLC Nexus
> **Durable action registry.** Read at session start. Update throughout session. Never delete completed items — mark ✅ with date instead.
> Format: `- [ ] PRIORITY | ACTION | Added: YYYY-MM-DD | Context`

---

## 🔴 Urgent — Must action outside Claude Code

- [ ] 🔴 URGENT | Rotate PROD Google Apps Script ID in Google Apps Script console | Added: 2026-06-22 | Old ID `1HzRiDrQJ6z-BxPzk-MHgm4pUb5enabsEA9Hg16OoRzpOhGjv9FyeiQQ0` was public since first commit. Treat as compromised. Update new ID in 1Password/internal wiki and in `.clasp.prod.json` locally.
- [ ] 🔴 URGENT | Notify all team members with a clone to re-clone | Added: 2026-06-22 | git history was rewritten via filter-repo (341 commits rewritten). Any existing clone is diverged. Must re-clone from `https://github.com/blccanada2026-lang/BLC-Automation.git`

---

## 🟡 Next Session — Claude Code tasks

- [ ] 🟡 NEXT | Review `blc-go-live-fixes.patch` — determine if changes are already in src or need applying | Added: 2026-06-22 | File is untracked in repo root. Unknown if patch has been applied.
- [ ] 🟡 NEXT | Review `migration/` directory — determine contents and whether to commit or gitignore | Added: 2026-06-22 | Directory is untracked. Contents unknown.
- [ ] 🟡 NEXT | Update `preflight.md` to reference `cutover-plan.md` and `test-plan.md` | Added: 2026-06-22 | Both files exist in `.claude/context/` but are not loaded by preflight for any session type.
- [ ] 🟡 NEXT | Complete architecture module map in `architecture.md` | Added: 2026-06-22 | Only T8 and T9 are listed. T0–T7 and T10–T13 are missing from the Module Map table.

---

## ✅ Completed

- [x] ✅ 2026-06-22 | Purge `.clasp.prod.json` and `.clasp.json` from all git history (341 commits rewritten, force-pushed)
- [x] ✅ 2026-06-22 | Untrack `.clasp.prod.json` and `.clasp.json`, add to `.gitignore`
- [x] ✅ 2026-06-22 | Add `.DS_Store` to `.gitignore` globally
- [x] ✅ 2026-06-22 | Commit all `.claude/` context, commands, and rules
- [x] ✅ 2026-06-22 | Add R1 rule — git commit required before every PROD deploy
- [x] ✅ 2026-06-22 | Push all commits to `origin/main` and deploy to PROD via clasp (86 files, HEAD `a64d432`)
