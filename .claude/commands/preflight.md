# /preflight — Session Start Checklist

Run this at the start of every session to orient Claude before any work begins.

## Steps
1. Read `CLAUDE.md` (root) — confirm standing rules are loaded
2. Ask the user: **"What is the task scope for this session?"**
   - Which client?
   - Which period/month?
   - Which module or workflow phase?
   - What is the single bounded deliverable?
3. Based on the answer, load **only** the relevant context files:
   - Payroll work → load `.claude/context/payroll-rules.md`
   - Billing work → load `.claude/context/billing-rules.md`
   - Staff work → load `.claude/context/staff-onboarding.md`
   - Feedback/ratings → load `.claude/context/feedback-rules.md`
   - Migration → load `.claude/context/migration-status.md`
   - Architecture/design → load `.claude/context/architecture.md`
4. Run `git status` — note any dirty files from previous session
5. Confirm the session scope is narrow enough (one client, one month, one phase)

## Output
Confirm back to the user:
> "Ready. Session scope: [X]. Loaded context: [Y]. Git status: [clean/dirty — Z files]."
