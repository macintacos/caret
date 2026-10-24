# Exceptions

*Audience: contributors and coding agents changing how caret looks, moves, sounds, or
prints.*

The places where caret departs from the defaults its direction starts from, on purpose.
Each one was chosen side by side against the default. Floors never appear here.

## Radii: 10 / 6 / pill

**Default:** 12px cards, 6px controls, 3px meters.

**caret:** 10px panels (`--radius-lg`), 6px controls (`--radius`), and pill-shaped badges
and meters. Chosen over the default on 2026-10-23.

## The waiting screen

**Default:** an empty state is one plain sentence, left-aligned, with no illustration or
icon, and louder motion is kept very subtle.

**caret:** the screen shown while no plan is waiting
(`ui/src/components/EmptyState.svelte`) is centred and carries a large floating amber `^`,
a heading, a short paragraph, the `listening` status pill, and a rotating carrot fact at
the foot. It is the screen people see most and caret's one brand moment. The float is slow
and small, and it stops under reduced motion, as does the fact rotation. Chosen over the
plain sentence and over a one-line blinking cursor on 2026-10-23.

This exception covers this screen only. Other empty views and the rest of the page
structure follow the defaults.
