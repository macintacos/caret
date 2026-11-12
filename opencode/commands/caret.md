---
description: Plan a change and review it in caret (`/caret <what you want done>`), or run `/caret doctor` or `/caret demo`
agent: plan
---

ARGUMENT=[$ARGUMENTS]

The argument is the text inside those brackets, with surrounding whitespace ignored. Walk
the `router` fence from `@caret` to the one stop the argument matches, and load only the
file that stop names, from `__CARET_REFERENCES__/`. Do not read the other reference files.

```router
@caret: /caret with the argument above
  > argument
argument?: What is the whole argument?
  empty, or exactly `plan` > usage
  exactly `doctor` > doctor
  exactly `demo` > demo
  `plan` followed by a description > plan
  anything else, including a description that merely starts with `doctor` or `demo` > plan
usage!: Reply with the usage hint below; load no file. Then tell the user this command switched the session to the `plan` agent, and that they can switch back to `build`.
doctor!: Load doctor.md and follow it. Then tell the user this command switched the session to the `plan` agent, and that they can switch back to `build`.
demo!: Load demo.md and follow it
plan!: Load plan.md and follow it; the description is the argument without a leading `plan`
```

## Usage hint

- `/caret <what you want done>` plans the change and opens the plan in caret for review.
  `/caret plan <description>` does the same, for a description that starts with `doctor`
  or `demo`.
- `/caret doctor` diagnoses this caret install.
- `/caret demo` walks a short demo plan through the review UI.
- `<leader>p` (`ctrl+x p` by default) opens the plan waiting for your review in the
  browser (OpenCode v2).
