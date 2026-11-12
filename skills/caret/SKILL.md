---
name: caret
description: Plan a change and review it in caret (`/caret <what you want done>`), or run `/caret doctor` or `/caret demo`
argument-hint: "[what you want done] | doctor | demo"
---

ARGUMENT=[$ARGUMENTS]

The argument is the text inside those brackets, with surrounding whitespace ignored. Walk
the `router` fence from `@caret` to the one stop the argument matches, and load only the
file that stop names, from `${CLAUDE_SKILL_DIR}/references/`. Do not read the other
reference files.

caret's plugin root is `${CLAUDE_PLUGIN_ROOT}`; the reference files write it as
`<plugin root>`.

```router
@caret: /caret with the argument above
  > argument
argument?: What is the whole argument?
  empty, or exactly `plan` > usage
  exactly `doctor` > doctor
  exactly `demo` > demo
  `plan` followed by a description > plan
  anything else, including a description that merely starts with `doctor` or `demo` > plan
usage!: Reply with the usage hint below and stop
doctor!: Load doctor.md and follow it
demo!: Load demo.md and follow it
plan!: Load plan.md and follow it; the description is the whole argument, minus a leading standalone word `plan`
```

## Usage hint

- `/caret <what you want done>` plans the change and opens the plan in caret for review.
  `/caret plan <description>` does the same, for a description that starts with `doctor`
  or `demo`.
- `/caret doctor` diagnoses this caret install.
- `/caret demo` walks a short demo plan through the review UI.
