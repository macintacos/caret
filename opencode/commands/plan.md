---
description: Plan a change and submit the plan to caret's review UI
agent: plan
---

Plan this:

$ARGUMENTS

If that is empty, plan whatever the user asked for earlier in this session.

Research what the change needs — read the relevant code, trace the real flow — then write
the plan as markdown to a file in the plans directory your system prompt names, and call
the `caret_review_plan` tool with that file as the `path` argument. If no plans directory
was named, pass the plan inline as the `plan` argument instead.

caret opens the plan in a local browser UI for inline review. When the user approves or
requests changes, the decision returns as the tool result:

- **Approved** → report the approved plan's path and tell the user to switch to the
  `build` agent to implement it. The `plan` agent cannot edit files.
- **Changes requested** → revise the plan and call `caret_review_plan` again. With a
  `path`, re-read the file first — caret rewrites it in its canonical shape, so the
  feedback's line numbers match it — and revise it with targeted edits.
