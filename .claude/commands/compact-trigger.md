# /compact-trigger — When and How to Compact

## Auto-trigger conditions
Claude should suggest /compact when it detects ANY of these:
- Context window > ~50% full
- More than 6 files changed in this session
- `git diff` output exceeds ~800 lines
- More than 3 test/fix loops on the same issue
- A phase change is about to happen (e.g. done building, now testing)
- The user asks a question unrelated to the current task thread

## What to do before /compact
1. Write a brief summary of what has been done so far
2. Note any files that are dirty (uncommitted)
3. Note what the next step is
4. Save any important state to a durable file if needed (migration-status.md, backlog.md)
5. Then run /compact

## After /compact
- Reload only the context files relevant to the next task
- Do NOT reload all context files by default
- Confirm the session scope is still correct

## Hard rule
Never run /compact mid-write. Always finish the current file edit or test run first.
