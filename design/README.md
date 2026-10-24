# caret design

*Audience: contributors and coding agents changing how caret looks, moves, sounds, or
prints.*

caret's design direction. The code holds every value; these pages hold the intent and
point at where each value lives.

| You want to | Read |
| --- | --- |
| Know what caret is for, who uses it, and the direction in one paragraph | [`brief.md`](brief.md) |
| Find where a colour, size, duration, or radius lives | [`tokens.md`](tokens.md) |
| Build a surface, control, state, sound, or CLI output the caret way | [`patterns.md`](patterns.md) |
| See where caret departs from the defaults on purpose | [`exceptions.md`](exceptions.md) |
| See what was decided, when, and what the code has yet to catch up on | [`decisions.md`](decisions.md) |

## Updating this directory

- **A new decision:** add a dated entry to `decisions.md`. If it changes how something is
  built, update `patterns.md` in the same change.
- **A deliberate departure from the defaults:** record it in `exceptions.md` with what it
  departs from.
- **A token:** change it at its source of truth, which `tokens.md` names. Never copy a
  value into these pages; update `tokens.md` only when a role moves to a new home.
- **Code that catches up with a decision:** remove its line from the open list in
  `decisions.md`.
- **A new page:** add a row to the table above, and add the page to the doc map in
  [`doc/agents/documentation-rules.md`](../doc/agents/documentation-rules.md).

The floors (contrast, focus, target size, reduced motion, 200% zoom, colour never the only
signal) are not design choices and never appear in `exceptions.md`. A floor the code
misses is an open item in `decisions.md` until it is fixed.
