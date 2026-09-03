import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { sounds } from "cuelume";

import { createSound, SOUND_MAP, type SoundEngine, type SoundEvent } from "$lib/sound.ts";
import { SOUND_ENABLED_KEY, SOUND_VOLUME_KEY } from "$lib/soundPref.ts";

afterEach(() => localStorage.clear());

/** A recording stand-in for cuelume: the injection point that keeps every test
 * below off a real AudioContext, which happy-dom does not implement at all. */
function recorder(): SoundEngine & { played: Array<{ sound: string; volume?: number }> } {
  const played: Array<{ sound: string; volume?: number }> = [];
  return {
    played,
    play(sound, options) {
      played.push({ sound, volume: options?.volume });
    },
  };
}

describe("SOUND_MAP", () => {
  test("every mapped event names a real cuelume sound", () => {
    for (const name of Object.values(SOUND_MAP)) expect(sounds).toContain(name);
  });
});

describe("play", () => {
  test("plays the event's mapped cuelume sound", () => {
    const engine = recorder();
    createSound({ engine }).play("planArrived");
    expect(engine.played[0]?.sound).toBe(SOUND_MAP.planArrived);
  });

  test("forwards the persisted volume", () => {
    localStorage.setItem(SOUND_VOLUME_KEY, "0.4");
    const engine = recorder();
    createSound({ engine }).play("approved");
    expect(engine.played[0]?.volume).toBe(0.4);
  });

  test("plays nothing while sound is switched off", () => {
    localStorage.setItem(SOUND_ENABLED_KEY, "off");
    const engine = recorder();
    createSound({ engine }).play("approved");
    expect(engine.played).toHaveLength(0);
  });

  test("reads the preference per call, so switching sound off takes effect at once", () => {
    const engine = recorder();
    const sound = createSound({ engine });
    sound.play("approved");
    localStorage.setItem(SOUND_ENABLED_KEY, "off");
    sound.play("approved");
    expect(engine.played).toHaveLength(1);
  });

  test("plays nothing for an event absent from the table — pruning is a one-line delete", () => {
    const engine = recorder();
    createSound({ engine }).play("neverMapped" as SoundEvent);
    expect(engine.played).toHaveLength(0);
  });
});

// A cue must never be able to cost its caller anything: the poll reports a
// consumer's exception as an unreachable daemon, and two call sites do real work
// beside their cue. So the guarantee is "play never throws", and the only honest
// test of it injects the throw — the poisoned-dependency shape log.test.ts uses.
const poisoned: SoundEngine = {
  play() {
    throw new Error("AudioContext is closed");
  },
};

describe("an engine that throws", () => {
  test("play swallows it — a wedged AudioContext is not the caller's problem", () => {
    expect(() => createSound({ engine: poisoned }).play("planArrived")).not.toThrow();
  });

  test("unlock swallows it too, from inside the gesture handler", () => {
    const target = new EventTarget();
    createSound({ engine: poisoned, target }).unlock();
    expect(() => target.dispatchEvent(new Event("pointerdown"))).not.toThrow();
  });
});

describe("unlock", () => {
  /** A recording engine, unlocked on a fresh target. */
  function unlockedRecorder() {
    const target = new EventTarget();
    const engine = recorder();
    const dispose = createSound({ engine, target }).unlock();
    return { target, engine, dispose };
  }

  test("creates the AudioContext on the first gesture, inaudibly", () => {
    const { target, engine } = unlockedRecorder();
    target.dispatchEvent(new Event("pointerdown"));
    expect(engine.played).toHaveLength(1);
    expect(engine.played[0]?.volume).toBeLessThan(0.01);
  });

  test("a keystroke unlocks too", () => {
    const { target, engine } = unlockedRecorder();
    target.dispatchEvent(new Event("keydown"));
    expect(engine.played).toHaveLength(1);
  });

  test("fires once, not on every later gesture", () => {
    const { target, engine } = unlockedRecorder();
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("keydown"));
    target.dispatchEvent(new Event("pointerdown"));
    expect(engine.played).toHaveLength(1);
  });

  test("the disposer detaches both listeners before any gesture lands", () => {
    const { target, engine, dispose } = unlockedRecorder();
    dispose();
    target.dispatchEvent(new Event("pointerdown"));
    target.dispatchEvent(new Event("keydown"));
    expect(engine.played).toHaveLength(0);
  });

  test("unlocks even while sound is switched off, so enabling it later needs no second gesture", () => {
    localStorage.setItem(SOUND_ENABLED_KEY, "off");
    const { target, engine } = unlockedRecorder();
    target.dispatchEvent(new Event("pointerdown"));
    expect(engine.played).toHaveLength(1);
  });
});
