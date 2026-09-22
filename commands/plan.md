---
description: Plan a change and route the plan through caret's review UI before implementing it
argument-hint: [what you want done]
---

Plan this, then implement it once caret approves the plan:

$ARGUMENTS

If that is empty, plan whatever the user asked for earlier in this session.

Call `EnterPlanMode` first: `ExitPlanMode` is refused outside plan mode. Research what the
change needs — read the relevant code, trace the real flow — then write the plan to the
file your plan-mode instructions name. Call `ExitPlanMode` with that same text as its
`plan` argument — caret reviews the argument, so a call without it reaches the review UI
empty.

This triggers caret's `PermissionRequest`/`ExitPlanMode` hook, which opens the plan in a
local browser UI for inline review. When the user approves or requests changes there, the
decision flows back to you:

- **Approved** → implement the plan.
- **Changes requested** → the feedback arrives as the denial reason. Re-read the plan file
  (caret rewrites it in its canonical shape, so the feedback's line numbers match it),
  revise it, and call `ExitPlanMode` again with the revised text as its `plan` argument.
