---
description: Demo caret by presenting a short fake plan via ExitPlanMode
---

Read the shared fake-plan fixture at `${CLAUDE_PLUGIN_ROOT}/scripts/dev/fake-plan.md` and
present its contents **verbatim** to the user by calling `ExitPlanMode` with that markdown
as the `plan` argument. This is the same fixture `mise run dev` seeds, so the demo and the
dev environment draw their plan from one source of truth. Do **not** do any real work,
research, or file edits — this is only to exercise the review flow. If the fixture can't
be read, fall back to inventing a short, plausible-but-fake plan (a Context section, an
Approach section, and a couple of Steps).

This triggers caret's `PermissionRequest`/`ExitPlanMode` hook, which opens the plan in a
local browser UI for inline review. When the user approves or requests changes there, the
decision flows back to you:

- **Approved** → proceed (this is just a demo, so simply acknowledge that caret approved
  the plan and stop).
- **Changes requested** → the feedback arrives as the denial reason. Revise the plan
  accordingly and present it again via `ExitPlanMode` (caret captures it as a new
  version).
