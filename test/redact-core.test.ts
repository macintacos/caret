import { expect, test } from "bun:test";
import {
	CENSOR,
	DENY_KEYS,
	MAX_DEPTH,
	scrubGraph,
	shortId,
} from "../src/redact-core.ts";

// The shared browser-safe core: DENY_KEYS, the parameterized scrub walk, and
// shortId. Both runtimes route through these — src/redact.ts (with the home-path
// string transform wired in) and ui/src/lib/log.ts (no transform, censor-only).

test("exports the shared constants", () => {
	expect(CENSOR).toBe("<redacted>");
	expect([...DENY_KEYS]).toEqual(["plan", "prompt", "feedback"]);
	expect(MAX_DEPTH).toBe(6);
});

test("shortId returns the first UUID segment", () => {
	expect(shortId("3fa85f64-5717-4562-b3fc-2c963f66afa6")).toBe("3fa85f64");
});

test("scrubGraph censors DENY_KEYS recursively with no string transform", () => {
	const out = scrubGraph({
		plan: "SECRET",
		nested: { feedback: "f", keep: "ok" },
		prompt: "p",
	});
	expect(out).toEqual({
		plan: "<redacted>",
		nested: { feedback: "<redacted>", keep: "ok" },
		prompt: "<redacted>",
	});
});

test("scrubGraph passes strings through untouched when no transform is given", () => {
	expect(scrubGraph({ msg: "/home/bob/x", list: ["a", "b"] })).toEqual({
		msg: "/home/bob/x",
		list: ["a", "b"],
	});
});

test("scrubGraph applies the per-string transform to every string", () => {
	const out = scrubGraph({ msg: "abc", list: ["d"], n: 7 }, (s) =>
		s.toUpperCase(),
	);
	expect(out).toEqual({ msg: "ABC", list: ["D"], n: 7 });
});

test("scrubGraph builds new structures and never mutates the input", () => {
	const original = { plan: "secret", keep: { x: 1 } };
	scrubGraph(original);
	expect(original.plan).toBe("secret");
});

test("scrubGraph caps recursion depth", () => {
	let deep: Record<string, unknown> = { plan: "deep secret" };
	for (let i = 0; i < 10; i++) deep = { n: deep };
	const out = JSON.stringify(scrubGraph(deep));
	expect(out).toContain("<depth-capped>");
	expect(out).not.toContain("deep secret");
});

test("scrubGraph cuts cycles with <cyclic> instead of hanging", () => {
	const a: Record<string, unknown> = { name: "a" };
	a.self = a;
	const out = scrubGraph(a) as Record<string, unknown>;
	expect(out.name).toBe("a");
	expect(out.self).toBe("<cyclic>");
});

test("scrubGraph walks shared (non-cyclic) references normally", () => {
	const shared = { keep: "ok" };
	expect(scrubGraph({ a: shared, b: shared })).toEqual({
		a: { keep: "ok" },
		b: { keep: "ok" },
	});
});

test("scrubGraph leaves non-string primitives untouched", () => {
	expect(scrubGraph(42)).toBe(42);
	expect(scrubGraph(null)).toBe(null);
	expect(scrubGraph(true, (s) => s.toUpperCase())).toBe(true);
});
