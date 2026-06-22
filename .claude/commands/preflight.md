# /preflight — Session Start Checklist

Run this at the start of every session to orient Claude before any work begins.

## Steps

### 0. Open Items — MANDATORY FIRST STEP
Read `.claude/context/open-items.md` and report ALL unchecked items to the user:
cat .claude/context/open-items.md
- Display all `[ ]` items grouped by priority (🔴 first, then 🟡)
- Do not summarize — show full action and context for each item
- Ask: **"Are any of these completed or no longer relevant before we start?"**
- Mark any confirmed-done items ✅ with today's date immediately
- If open-items.md does not exist → create it with a note: `Created: YYYY-MM-DD — no items yet`

### 1. Load Standing Rules
Read `CLAUDE.md` (root) — confirm standing rules are loaded.

### 2. Define Session Scope
Ask the user: **"What is the task scope for this session?"**
- Which client?
- Which period/month?
- Which module or workflow phase?
- What is the single bounded deliverable?

### 3. Load Relevant Context
Based on the answer, load **only** the relevant context files:
- Payroll work → `.claude/context/payroll-rules.md`
- Billing work → `.claude/context/billing-rules.md`
- Staff work → `.claude/context/staff-onboarding.md`
- Feedback/ratings → `.claude/context/feedback-rules.md`
- Migration → `.claude/context/migration-status.md`
- Architecture/design → `.claude/context/architecture.md`
- Post-cutover planning → `.claude/context/cutover-plan.md`
- UAT/testing → `.claude/context/test-plan.md`

### 4. Git Status Check
git status
Note any dirty files from previous session. If dirty — ask user before proceeding.

### 5. Scope Confirmation
Confirm the session scope is narrow enough (one client, one month, one phase).

---

## Session End Protocol — MANDATORY BEFORE /compact OR CLOSING
Run these steps at every session end, after every /compact, and before any context clear:
cat .claude/context/open-items.md

1. Mark any items completed this session as ✅ with today's date
2. Add any new open items discovered this session — be specific, include context
3. Add a new entry to `.claude/context/migration-status.md` session log if any migration work was done
4. Update `.claude/context/backlog.md` if any features were completed or added
5. Confirm `git status` is clean or note dirty files explicitly in open-items.md
6. Run `git push origin main` if any commits are unpushed

---

## /compact Mid-Session Protocol
Before running /compact at any point during a session:

1. Read and update `open-items.md` — capture anything in-progress as a new `[ ]` item with full context
2. Note the exact next step as a `🔵 IN-PROGRESS` item so the post-compact session knows exactly where to resume
3. Format: `- [ ] 🔵 IN-PROGRESS | [what was being done] | Resume: [exact next step] | Added: YYYY-MM-DD`

---

## Output
Confirm back to the user:
> "Ready. Open items: [N urgent, M pending]. Session scope: [X]. Loaded context: [Y]. Git status: [clean/dirty — Z files]."
