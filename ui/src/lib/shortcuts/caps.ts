// The typed keyboard-cap schema: the closed set of keys a Kbd cap may name, and
// the single, exhaustive conversion from a key to how it renders. A named key
// draws a shared glyph/icon (today only "shift" → the global arrow-big-up icon);
// every other key is an alphabet letter that renders as its own text. The union
// IS the schema — <KbdCap> accepts only a KbdKey, so the shift icon is reachable
// ONLY by passing the literal "shift", and kbdCap()'s assertNever tail turns a
// new named key into a compile error until it is given a rendering. Node-free:
// it maps keys to render descriptors and owns no DOM.

import type { IconName } from "$lib/icons.ts";

// The alphabet, listed once; the letter type derives from it (both cases, so a
// shifted "C" and an unshifted "j" are equally valid caps).
const ALPHABET = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "h",
  "i",
  "j",
  "k",
  "l",
  "m",
  "n",
  "o",
  "p",
  "q",
  "r",
  "s",
  "t",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
] as const;
type Lower = (typeof ALPHABET)[number];
type Letter = Lower | Uppercase<Lower>;

/** A key whose cap is a shared glyph/icon rather than its own text. "shift"
 * draws the global shift icon; add more here as they earn one. */
type NamedKey = "shift";

/** The schema a typed Kbd cap must satisfy: an alphabet letter, or a named key. */
export type KbdKey = Letter | NamedKey;

/** How a cap renders: a shared icon for a named key (with its accessible label),
 * else the key's own glyph text. */
export type CapRender = { icon: IconName; label: string } | { text: string };

const NAMED_KEYS: ReadonlySet<string> = new Set<NamedKey>(["shift"]);
const KEYS: ReadonlySet<string> = new Set<string>([
  ...ALPHABET,
  ...ALPHABET.map((c) => c.toUpperCase()),
  ...NAMED_KEYS,
]);

/** Whether a raw cap token is a known key. The bridge that lets the reserved
 * keymap keep carrying glyph strings (⌘, ↵, /) while "shift" and the letters
 * route through the typed renderer. */
export function isKbdKey(s: string): s is KbdKey {
  return KEYS.has(s);
}

// A named key is one with a shared glyph; the guard narrows KbdKey down to
// NamedKey so kbdCap's switch can hold an assertNever tail. Set-backed, so it
// stays correct as NamedKey grows.
function isNamed(key: KbdKey): key is NamedKey {
  return NAMED_KEYS.has(key);
}

/** The one conversion from a key to its rendering, exhaustive over KbdKey: a
 * letter renders as its own text; each named key resolves in the switch, whose
 * assertNever tail fails to compile the moment a NamedKey lacks a case. */
export function kbdCap(key: KbdKey): CapRender {
  if (!isNamed(key)) return { text: key };
  switch (key) {
    case "shift":
      return { icon: "arrow-big-up", label: "Shift" };
    default:
      return assertNever(key);
  }
}

function assertNever(key: never): never {
  throw new Error(`unhandled KbdKey: ${key as string}`);
}
