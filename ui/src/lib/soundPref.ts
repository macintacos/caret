// Whether caret makes sound, and how loud, persisted in localStorage (EXC-1100).
// Both are pure browser choices with no security surface and no cross-process
// consumer, so they live in localStorage rather than the daemon's machine-global
// prefs — the same call diffIndicatorsPref.ts and shortcutHintsPref.ts made.
//
// The switch rides definePref's "on"/"off" enum, exposed as a boolean like
// shortcutHintsPref. The volume cannot: a clamped number fits neither the flag nor
// the enum shape, so its read/write is bespoke over registerPrefKey — the same
// carve-out fileDrawer.ts's remembered sizes take. Both keys are registered either
// way, so `mise run dev --fresh` resets them and prefKeys.test.ts sees them.
//
// The volume is defined here even though nothing writes it yet: EXC-1101 adds the
// slider, and persisting from the start means the read path is built once.

import { definePref, registerPrefKey } from "$lib/definePref.ts";

/** localStorage key holding whether caret plays sounds. */
export const SOUND_ENABLED_KEY = "caret.sound";

/** localStorage key holding the sound volume, as a `0`–`1` multiplier. */
export const SOUND_VOLUME_KEY = "caret.sound.volume";

/** Volume with nothing remembered. Deliberately low — caret should be audible
 * from the next room over only if you are listening for it. */
export const DEFAULT_SOUND_VOLUME = 0.25;

const enabledPref = definePref<"on" | "off">(SOUND_ENABLED_KEY, ["on", "off"], "on");

/** Whether caret plays sounds. Defaults to true on a missing, unrecognized, or
 * unreadable value — sound is on out of the box, and the toggle is the one
 * off-switch. */
export const readSoundEnabled = (): boolean => enabledPref.read() === "on";

/** Persist whether caret plays sounds. A storage failure is swallowed: the
 * preference is non-essential, so a write that can't land must not surface. */
export const writeSoundEnabled = (on: boolean): void => enabledPref.write(on ? "on" : "off");

registerPrefKey(SOUND_VOLUME_KEY);

/** `value` as a volume multiplier, or `undefined` when it is not a finite number
 * — which is how both a junk stored string and a junk caller argument are
 * rejected in one place. */
function asVolume(value: unknown): number | undefined {
  // `Number("")` is 0, so an empty or blank stored value would read as silence
  // with the toggle still showing on — and no slider yet to recover with.
  if (typeof value === "string" && value.trim() === "") return undefined;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return Math.min(1, Math.max(0, n));
}

/** The persisted sound volume, clamped to `0`–`1`. Fail-safe like the rest of the
 * pref modules: a missing, unparseable, or unreadable value degrades to the low
 * default rather than throwing or blaring. */
export function readSoundVolume(): number {
  try {
    return asVolume(localStorage.getItem(SOUND_VOLUME_KEY)) ?? DEFAULT_SOUND_VOLUME;
  } catch {
    return DEFAULT_SOUND_VOLUME;
  }
}

/** Persist the sound volume, clamped to `0`–`1`. A non-finite value is ignored
 * (the stored volume stays put) and a storage failure is swallowed. */
export function writeSoundVolume(value: number): void {
  const volume = asVolume(value);
  if (volume === undefined) return;
  try {
    localStorage.setItem(SOUND_VOLUME_KEY, String(volume));
  } catch {
    // Storage unavailable (private mode, quota, disabled) — drop silently.
  }
}
