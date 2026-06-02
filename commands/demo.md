---
description: Demo caret by presenting a short fake plan via ExitPlanMode
---

Invent a short, plausible-but-fake implementation plan — 3–5 bullet points across a couple of small sections (for example, "Add a `/health` endpoint": a Context section, an Approach section, and a couple of Steps). Do **not** do any real work, research, or file edits — this is only to exercise the review flow.

Present the plan to the user by calling `ExitPlanMode` with that plan markdown as the `plan` argument.

This triggers caret's `PermissionRequest`/`ExitPlanMode` hook, which opens the plan in a local browser UI for inline review. When the user approves or requests changes there, the decision flows back to you:

- **Approved** → proceed (this is just a demo, so simply acknowledge that caret approved the plan and stop).
- **Changes requested** → the feedback arrives as the denial reason. Revise the fake plan accordingly and present it again via `ExitPlanMode` (caret captures it as a new version).
