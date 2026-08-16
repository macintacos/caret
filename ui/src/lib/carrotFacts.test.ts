import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { CARROT_FACTS } from "$lib/carrotFacts.ts";

// Content boundaries the issue draws around the bank. They are asserted rather
// than left to review because they are the constraint most likely to erode when
// someone adds the next fact: every folk carrot fact within reach is a health
// claim, and the best-known one of all is a wartime night-vision story.
const FORBIDDEN = [/night vision/i, /\bRAF\b/, /beta-?carotene/i, /eyesight/i, /digest/i];

describe("CARROT_FACTS", () => {
  test("holds enough facts that a rotation does not visibly repeat", () => {
    expect(CARROT_FACTS.length).toBeGreaterThanOrEqual(20);
  });

  test("every source is a parseable https URL", () => {
    for (const fact of CARROT_FACTS) {
      expect(() => new URL(fact.source)).not.toThrow();
      expect(new URL(fact.source).protocol).toBe("https:");
    }
  });

  test("no fact text repeats", () => {
    const texts = CARROT_FACTS.map((f) => f.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  test("no source repeats — each fact deep-links to where its claim is stated", () => {
    const sources = CARROT_FACTS.map((f) => f.source);
    expect(new Set(sources).size).toBe(sources.length);
  });

  test("no fact strays into health claims or the night-vision myth", () => {
    for (const fact of CARROT_FACTS) {
      for (const pattern of FORBIDDEN) {
        expect(fact.text).not.toMatch(pattern);
      }
    }
  });
});
