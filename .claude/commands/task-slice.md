# /task-slice — Break Work Into Bounded Deliverables

Use this before starting any large or multi-part task to prevent context blowout.

## Steps
1. Ask: "What is the full scope of what needs to be done?"
2. Break it into slices where each slice = one session's work
3. Each slice must have:
   - A single clear deliverable
   - A clear done condition ("tests pass", "CEO can run X from portal", etc.)
   - An estimated context cost (small / medium / large)
4. Propose the slice order — dependencies first
5. Confirm with user which slice to start NOW

## Rules
- Do not start slice N+1 in the same session as slice N unless both are small
- After completing a slice: commit, update backlog.md, then /clear before the next
- If a slice turns out larger than expected mid-session → stop, /compact, re-slice

## Output format
> Slice 1: [Deliverable] — Done when: [condition] — Size: small/medium/large
> Slice 2: [Deliverable] — Done when: [condition] — Size: small/medium/large
> ...
> Starting with Slice [N].
