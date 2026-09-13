---
description: Demo caret by presenting a short plan about this repo via ExitPlanMode
---

Read `${CLAUDE_PLUGIN_ROOT}/templates/demo.md`. Follow its leading HTML comment exactly to
fill the slots, then call `ExitPlanMode` with everything after that comment as the `plan`
argument. Do **no** other research and edit **no** file — this is only to exercise the
review flow.

This triggers caret's `PermissionRequest`/`ExitPlanMode` hook, which opens the plan in a
local browser UI for inline review. When the user approves or requests changes there, the
decision flows back to you:

- **Approved** → proceed (this is just a demo, so simply acknowledge that caret approved
  the plan and stop).
- **Changes requested** → the feedback arrives as the denial reason. Revise the plan
  accordingly, keeping it about the same size, and present it again via `ExitPlanMode`
  (caret captures it as a new version).
