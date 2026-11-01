# Exceptions

*Audience: contributors and coding agents changing how caret looks, moves, sounds, or
prints.*

The places where caret departs from the defaults its direction starts from, on purpose.
Each one was chosen side by side against the default. Floors never appear here.

## Radii

**Default:** 12px cards, 6px controls, 3px meters.

**caret:** 10px panels (`--radius-lg`), 6px fields and menu rows (`--radius`), and
pill-shaped badges and meters, chosen over the default on 2026-10-23. The keypad rounds
rounder, chosen on 2026-10-31: 8px keys (`--key-radius`), beds at the key's radius plus
their 3px side pad (11px), 4px where two ganged keys face each other, 5px keycaps and
switch keys (`--nub-radius`), 12px table and code-block pads (`--pad-radius`), and the
14px plan pane (`--pane-radius`). Every modal rounds at 14px too (`--modal-radius`). A
container whose corner holds another rounded shape rounds at that shape's radius plus the
inset, so the comment composer, Settings below 640px wide, the popup menus and the Discard
confirm bubble round wider than these.

## A key's spring

**Default:** one fast transition with a decelerating curve for every state change, and
bounce or elastic curves only on purpose.

**caret:** a key's press runs on that curve, and its return springs past rest and settles,
as a rubber key does (`--ease-spring` over `--dur-state`). Only the key's travel springs;
its shading and colour stay on `--ease-out`. Under reduced motion no key travels, so only
the shading changes. Chosen with the Keypad kit on 2026-10-31.

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
