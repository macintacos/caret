import "@ui/test-setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_SOUND_VOLUME,
  readSoundEnabled,
  readSoundVolume,
  SOUND_ENABLED_KEY,
  SOUND_VOLUME_KEY,
  writeSoundEnabled,
  writeSoundVolume,
} from "$lib/soundPref.ts";

afterEach(() => localStorage.clear());

/** Run `body` with localStorage replaced by a getter that throws, mirroring a
 * blocked / private-mode store. */
function withBlockedStorage(body: () => void): void {
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });
  try {
    body();
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
  }
}

describe("readSoundEnabled", () => {
  test("defaults to on when nothing is stored", () => {
    expect(readSoundEnabled()).toBe(true);
  });

  test("returns false once the reviewer has switched sound off", () => {
    localStorage.setItem(SOUND_ENABLED_KEY, "off");
    expect(readSoundEnabled()).toBe(false);
  });

  test("defaults to on for an unrecognized stored value", () => {
    localStorage.setItem(SOUND_ENABLED_KEY, "muted");
    expect(readSoundEnabled()).toBe(true);
  });

  test("fails safe to on when localStorage throws", () => {
    withBlockedStorage(() => {
      expect(readSoundEnabled()).toBe(true);
    });
  });
});

describe("writeSoundEnabled", () => {
  test("round-trips both states", () => {
    writeSoundEnabled(false);
    expect(readSoundEnabled()).toBe(false);
    writeSoundEnabled(true);
    expect(readSoundEnabled()).toBe(true);
  });

  test("swallows a storage failure rather than throwing", () => {
    withBlockedStorage(() => {
      expect(() => writeSoundEnabled(false)).not.toThrow();
    });
  });
});

describe("readSoundVolume", () => {
  test("defaults low when nothing is stored", () => {
    expect(readSoundVolume()).toBe(DEFAULT_SOUND_VOLUME);
    expect(DEFAULT_SOUND_VOLUME).toBeLessThanOrEqual(0.3);
    expect(DEFAULT_SOUND_VOLUME).toBeGreaterThan(0);
  });

  test("returns a stored in-range value", () => {
    localStorage.setItem(SOUND_VOLUME_KEY, "0.5");
    expect(readSoundVolume()).toBe(0.5);
  });

  test("clamps a stored value above the ceiling", () => {
    localStorage.setItem(SOUND_VOLUME_KEY, "4");
    expect(readSoundVolume()).toBe(1);
  });

  test("clamps a stored value below the floor", () => {
    localStorage.setItem(SOUND_VOLUME_KEY, "-2");
    expect(readSoundVolume()).toBe(0);
  });

  test("defaults on a stored value that is not a finite number", () => {
    localStorage.setItem(SOUND_VOLUME_KEY, "loud");
    expect(readSoundVolume()).toBe(DEFAULT_SOUND_VOLUME);
  });

  test("defaults on an empty stored value rather than reading it as silence", () => {
    localStorage.setItem(SOUND_VOLUME_KEY, "");
    expect(readSoundVolume()).toBe(DEFAULT_SOUND_VOLUME);
    localStorage.setItem(SOUND_VOLUME_KEY, "   ");
    expect(readSoundVolume()).toBe(DEFAULT_SOUND_VOLUME);
  });

  test("fails safe to the default when localStorage throws", () => {
    withBlockedStorage(() => {
      expect(readSoundVolume()).toBe(DEFAULT_SOUND_VOLUME);
    });
  });
});

describe("writeSoundVolume", () => {
  test("round-trips a value", () => {
    writeSoundVolume(0.75);
    expect(readSoundVolume()).toBe(0.75);
  });

  test("clamps before persisting, so a stored value is always in range", () => {
    writeSoundVolume(9);
    expect(readSoundVolume()).toBe(1);
  });

  test("ignores a value that is not a finite number", () => {
    writeSoundVolume(0.4);
    writeSoundVolume(Number.NaN);
    expect(readSoundVolume()).toBe(0.4);
  });

  test("swallows a storage failure rather than throwing", () => {
    withBlockedStorage(() => {
      expect(() => writeSoundVolume(0.5)).not.toThrow();
    });
  });
});
