---
description: Demo caret by submitting a short plan about this repo to caret's review UI
agent: plan
---

Read `__CARET_ROOT__/templates/demo.md`. Follow its leading HTML comment exactly to fill
the slots, then call the `caret_review_plan` tool with everything after that comment as
the `plan` argument. Do **not** do any other research, and edit no file — this is only to
exercise caret's plan-review flow.

caret opens the plan in a local browser UI for inline review. When the user approves or
requests changes, the decision returns as the tool result:

- **Approved** → acknowledge that caret approved the demo plan, and stop.
- **Changes requested** → revise the plan accordingly, keeping it about the same size, and
  call `caret_review_plan` again (caret captures it as a new version).
