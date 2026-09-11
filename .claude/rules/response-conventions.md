# Rules: Response Conventions

## RC1 — Always Cite Function Locations
Every time a function, handler, or script is named in a response — whether
it's newly written, referenced from existing code, or given as a
"run this" instruction — state its exact file path and line number inline,
formatted as:

```
`functionName()` — `src/path/To/File.gs:123`
```

Apply this **every time** the function is mentioned, not just on first
mention in a conversation. Do not make the user ask "where is X?" — most
runnable functions here are Apps Script functions meant to be executed
directly in the Apps Script editor (DEV or PROD project), and there is no
local CLI to run them — the file path and line number are the only way to
locate and open them.

If the exact line number isn't already known from a Read/Edit/grep in the
current turn, grep for it before answering rather than guessing or omitting
the location.
