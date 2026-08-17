// caret's sound layer (EXC-1100): one table mapping each moment worth hearing to
// a cuelume sound, and the thin service that plays it.
//
// Framework-agnostic and unit-tested in isolation, the shape notify.ts already
// uses for the other "announce something happened" surface: the audio backend is
// an injectable option, so happy-dom's missing Web Audio API never matters to a
// test — no test here touches a real AudioContext. `createSound` stays exported
// for those tests; the app uses the `sound` singleton below, which surfaces
// (CodeCopyButton inside the diff view) read directly rather than through five
// levels of prop-drilling, exactly as they read `appearance`.
//
// The enabled/volume preferences are read PER CALL rather than mirrored into
// instance state, so flipping the settings toggle takes effect on the next sound
// with nothing to keep in sync. That also leaves cuelume's own setEnabled /
// setVolume module globals deliberately unused: one source for the preference,
// which is caret's, beats two that can disagree.

import { play as cuelumePlay, type SoundName } from "cuelume";

import { uiLog } from "$lib/log.ts";
import { readSoundEnabled, readSoundVolume } from "$lib/soundPref.ts";

/** A moment caret makes a sound for. Every one is a discrete state change or an
 * explicit action — nothing here fires on scroll, pointer movement, or hover. */
export type SoundEvent =
  | "planArrived"
  | "planRevised"
  | "planExpired"
  | "daemonDropped"
  | "daemonReconnected"
  | "approved"
  | "changesRequested"
  | "rejected"
  | "annotationPosted"
  | "toastSuccess"
  | "toastError"
  | "toastNotice"
  | "filePreviewOpen"
  | "filePreviewClose"
  | "modalOpen"
  | "themeSwitch"
  | "copyCode";

/**
 * The single event→sound table. Which cuelume sound suits which moment is a
 * judgement call to be tuned by ear now that it ships, so this is deliberately
 * the only place that judgement is written down: **silencing a moment is a
 * one-line delete here**, and an event with no entry plays nothing. Coverage
 * starts broad and gets pruned; that pruning must never be a refactor.
 *
 * Sounds repeat across events on purpose — an unreachable daemon and a failed
 * action are the same news to the ear.
 */
export const SOUND_MAP: Partial<Record<SoundEvent, SoundName>> = {
  // The daemon's news, which the reviewer may be away from the tab for.
  planArrived: "arrival",
  // A revision landing in a tab that did not request it. The tab that DID send a
  // Request Changes dropped the review locally on resolve, so the revision returns
  // to it as an arrival — which is what it is, from that seat.
  planRevised: "page",
  planExpired: "whisper",
  daemonDropped: "error",
  daemonReconnected: "ready",
  // The three verdicts and the comment that feeds them. Each rides its own toast
  // rather than sounding beside it, so a decision is heard once.
  approved: "success",
  changesRequested: "loading",
  rejected: "droplet",
  annotationPosted: "pulse",
  // Whatever else reaches the toast queue, by variant.
  toastSuccess: "chime",
  toastError: "error",
  toastNotice: "tick",
  // Chrome: surfaces opening and closing, and the two one-shot actions.
  filePreviewOpen: "bloom",
  filePreviewClose: "whisper",
  modalOpen: "scan",
  themeSwitch: "toggle",
  copyCode: "tick",
};

/** The sound cuelume synthesizes to unlock its AudioContext, kept out of
 * SOUND_MAP so pruning a moment can never disarm the unlock. */
const UNLOCK_SOUND: SoundName = "tick";

/** Loud enough that cuelume renders it — a computed volume of exactly zero is a
 * no-op there, which is the whole reason this is not simply `0` — and far too
 * quiet to hear. The point is the AudioContext it creates, not the sound. */
const UNLOCK_VOLUME = 0.0001;

/** The gestures that count as the reviewer's first interaction with the page. */
const UNLOCK_EVENTS = ["pointerdown", "keydown"] as const;

/** The slice of cuelume the service uses. Injectable so a test observes what
 * would have been played without a real AudioContext. */
export interface SoundEngine {
  play(sound: SoundName, options?: { volume?: number }): void;
}

/** The effects an instance performs, injectable for isolated unit tests. */
export interface SoundDeps {
  /** The audio backend. Defaults to cuelume. */
  engine?: SoundEngine;
  /** Where `unlock` listens for the first gesture. Defaults to `window`; with no
   * target `unlock` is a no-op. Playback is unaffected — cuelume has its own guard
   * for a runtime with no Web Audio. */
  target?: EventTarget;
}

export interface Sound {
  /** Play an event's sound. A no-op while the reviewer has sound switched off,
   * and for an event SOUND_MAP does not carry. */
  play(event: SoundEvent): void;
  /**
   * Arm the one-shot listener that creates and resumes cuelume's shared
   * AudioContext on the reviewer's first gesture, returning its disposer.
   *
   * Browsers refuse to start audio before the page has been interacted with.
   * cuelume already declines to play until then, and resumes a suspended context
   * when it does — but that resume would land inside whatever task asked for the
   * sound (a poll tick), where the strictest browsers still refuse it. Unlocking
   * from inside the gesture itself is what makes the first real sound audible.
   *
   * Unlocks even while sound is switched off, so switching it back on needs no
   * second gesture. The cue it plays to do so is inaudible either way.
   */
  unlock(): () => void;
}

/**
 * Build a sound service over the persisted preferences. Exported for isolated
 * unit tests; the app uses the `sound` singleton below.
 */
export function createSound(deps: SoundDeps = {}): Sound {
  const engine: SoundEngine = deps.engine ?? { play: cuelumePlay };
  const target = deps.target ?? (typeof window === "undefined" ? undefined : window);

  // The one place the engine is touched, and the one place a throw is contained.
  // cuelume guards context creation, but its node graph is built unguarded — a
  // wedged AudioContext throws synchronously from createOscillator. That throw
  // would surface as someone else's failure: the poll wraps its consumers in the
  // same try as its fetch, so a silent cue would be reported as an unreachable
  // daemon. Logged rather than swallowed, like notify.ts's construct failure.
  function render(name: SoundName, volume: number): void {
    try {
      engine.play(name, { volume });
    } catch (err) {
      uiLog.warn("ui", "sound failed to play", { sound: name, reason: String(err) });
    }
  }

  return {
    play(event) {
      if (!readSoundEnabled()) return;
      const name = SOUND_MAP[event];
      if (!name) return;
      render(name, readSoundVolume());
    },
    unlock() {
      if (!target) return () => {};
      const detach = () => {
        for (const type of UNLOCK_EVENTS) target.removeEventListener(type, onGesture);
      };
      // Detach both listeners rather than relying on `once` per type: the first
      // gesture unlocks, and the other type's listener must go with it.
      const onGesture = () => {
        detach();
        render(UNLOCK_SOUND, UNLOCK_VOLUME);
      };
      for (const type of UNLOCK_EVENTS) target.addEventListener(type, onGesture);
      return detach;
    },
  };
}

/** The app-wide sound service. App.svelte injects `sound.play` into the alert
 * queue and the review selection and arms `sound.unlock()`; the surfaces with no
 * such seam (the file preview, the code-copy button) call it directly. */
export const sound = createSound();
