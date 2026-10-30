# Brief

*Audience: contributors and coding agents changing how caret looks, moves, sounds, or
prints.*

## Subject

caret routes a coding agent's plan to a person for review. A loopback daemon serves a
Svelte review UI; a CLI installs, diagnoses, and runs it.

**Audience:** a developer reviewing their own agent's plan, mid-task, hands on the
keyboard, moving between a terminal and a browser tab.

**The one job:** read the plan, comment on the lines that matter, then approve it or send
it back, without reaching for the mouse.

## Surfaces and modes

| Surface | Where | Mode |
| --- | --- | --- |
| Review UI: plan, comments, approve and request changes, settings | `ui/` | Operate |
| Plan preview, the rendered plan text | `ui/src/lib/planMarkdown.ts` and its passes | Read |
| CLI output: `caret doctor`, `caret install`, the other subcommands | `src/commands/` | Operate |
| Dev console and task output: `mise run dev`, `mise run preflight` | `scripts/tasks/` | Operate |

## Direction

A quiet, warm, near-monochrome code tool, polished in every detail and never in the way.
Warm paper and ink in both schemes, hairline rules for structure, and one vivid amber
accent: the `^` insertion mark the tool is named for, kept for the wordmark, the primary
action, focus, and the cursor. Geist for UI text and Berkeley Mono for code, carets,
paths, and the version tag. The chrome is tactile without being skeuomorphic. Controls are
soft rubber caps sitting in shallow wells, and they sink into the well when pressed.
Passive labels are pressed into the surface rather than raised from it. Menus float on
soft layered shadows and modals on deep ones. No glass, no heavy gradients, no glows. One
fast transition (160 ms, strong ease-out) confirms each change of state. Keyboard first,
with vim keys and the key for each control shown on the control itself. Sound marks state
changes and actions, on by default. A light and a dark theme always, following the system.
Power features are there to be discovered, not shown all at once.

In the terminal: say what changed and what to run next, put failures first, use the ANSI
colour slots and plain Unicode symbols, and keep the lines the user knows.
