---
description: Demo caret by submitting a short fake plan to caret's review UI
agent: plan
---

This is a caret demo. Do **not** do any real work, research, or file edits — the only goal
is to exercise caret's plan-review flow.

Call the `caret_review_plan` tool with the following short, deliberately-fake plan as the
`plan` argument (verbatim):

```markdown
# Demo plan

## Context
Exercise caret's review flow end to end — nothing here is real work.

## Steps
1. Pretend to add a `GET /status` endpoint returning `{ ok: true }`.
2. Pretend to register it before the rate limiter.
3. Pretend to add a unit test asserting 200 and the JSON body.
```

caret opens the plan in a local browser UI for inline review. When the user approves or
requests changes, the decision returns as the tool result:

- **Approved** → acknowledge that caret approved the demo plan, and stop.
- **Changes requested** → revise the fake plan per the feedback and call
  `caret_review_plan` again (caret captures it as a new version).
