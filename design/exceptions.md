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

## The preview-default notice

**Default:** a popover closes on Escape and on an outside click; Escape means one step
out.

**caret:** the notice on the Source button
(`ui/src/components/PreviewDefaultNotice.svelte`) ignores both. Only "Got it" or the first
use of Source ends it, so a reload before either shows it again. Escape still reaches the
plan underneath: it closes a search or leaves visual mode as usual. Chosen on 2026-11-10.

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
(`ui/src/components/EmptyState.svelte`) is centred and carries a large `^` standing as a
rubber key in its own bed, a heading, a short paragraph, the listening stamp, and a
rotating carrot fact at the foot. The key's legend is lit as a light, which goes out while
caret is offline. The listening stamp is a pocket holding the status bar's LED and
"listening". It is the screen people see most and caret's one brand moment. The legend's
glow breathes slowly, and under reduced motion it stops, lit; the fact rotation stops too.
The centred `^` screen was chosen over the plain sentence and over a one-line blinking
cursor on 2026-10-23.

Two departures from the kit go with it. The legend lightens the amber toward white at its
core in dark and darkens it at its rim, where the accent is otherwise used verbatim. The
key's geometry scales from a 3px side, twice the kit's. Chosen over the Lamp, Stamp and
Key variants on 2026-11-04
([`decisions.md`](decisions.md#2026-11-04-the-waiting-screens--stands-as-a-lit-key)).

This exception covers this screen only. Other empty views and the rest of the page
structure follow the defaults.
