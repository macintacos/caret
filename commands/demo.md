---
description: Demo caret by presenting a short plan about this repo via ExitPlanMode
---

Call `EnterPlanMode` first: `ExitPlanMode` is refused outside plan mode. Then read
`${CLAUDE_PLUGIN_ROOT}/templates/demo.md` and follow its leading HTML comment exactly to
fill the slots. Write everything after that comment to the plan file your plan-mode
instructions name, then call `ExitPlanMode` with that same text as its `plan` argument —
caret reviews the argument, so a call without it reaches the review UI empty. Do **no**
other research and edit **no** file but the plan file — this is only to exercise the
review flow.

This triggers caret's `PermissionRequest`/`ExitPlanMode` hook, which opens the plan in a
local browser UI for inline review. When the user approves or requests changes there, the
decision flows back to you:

- **Approved** → proceed (this is just a demo, so simply acknowledge that caret approved
  the plan and stop).
- **Changes requested** → the feedback arrives as the denial reason. Revise the plan
  accordingly, keeping it about the same size, update the plan file, and call
  `ExitPlanMode` again with the revised text as its `plan` argument (caret captures it as
  a new version).
