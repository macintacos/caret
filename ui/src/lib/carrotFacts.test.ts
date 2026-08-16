import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { CARROT_FACTS, type CarrotFact, createFactBag, ROTATE_MS } from "$lib/carrotFacts.ts";

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

// A fact bank read through a shuffled bag rather than a fresh random pick: over
// a long wait an independent draw repeats itself, and a repeat is the one thing
// a reader parked on this screen would actually notice.
describe("createFactBag", () => {
  const facts = (n: number): CarrotFact[] =>
    Array.from({ length: n }, (_, i) => ({
      text: `fact ${i}`,
      source: `https://example.test/${i}`,
    }));

  // Deterministic stand-in for Math.random: walks a fixed cycle, so a shuffle is
  // reproducible without pinning the shuffle's output order.
  const cyclicRandom = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length]!;
  };

  test("a full pass yields every fact exactly once", () => {
    const bank = facts(5);
    const bag = createFactBag(bank, cyclicRandom([0.1, 0.7, 0.3, 0.9, 0.5]));
    const drawn = bank.map(() => bag.next());
    expect(new Set(drawn.map((f) => f.text))).toEqual(new Set(bank.map((f) => f.text)));
  });

  test("the draw after a full pass comes from a refilled bag", () => {
    const bank = facts(4);
    const bag = createFactBag(bank, cyclicRandom([0.2, 0.8, 0.4]));
    for (let i = 0; i < bank.length; i++) bag.next();
    const nextPass = bank.map(() => bag.next());
    expect(new Set(nextPass.map((f) => f.text))).toEqual(new Set(bank.map((f) => f.text)));
  });

  test("a single-entry bank keeps returning its one fact", () => {
    const bag = createFactBag(facts(1), () => 0);
    expect(bag.next().text).toBe("fact 0");
    expect(bag.next().text).toBe("fact 0");
  });

  test("defaults to the real bank", () => {
    const texts = new Set(CARROT_FACTS.map((f) => f.text));
    expect(texts.has(createFactBag().next().text)).toBe(true);
  });

  test("ROTATE_MS sits in the 45–60s window the screen calls for", () => {
    expect(ROTATE_MS).toBeGreaterThanOrEqual(45_000);
    expect(ROTATE_MS).toBeLessThanOrEqual(60_000);
  });
});
