// Browser-safe redaction core (EXC-399, EXC-445): the value-graph walk, the
// DENY_KEYS denylist, and shortId — shared by both runtimes. The daemon/hook
// side (src/redact.ts, src/log.ts) and the browser side (ui/src/lib/log.ts via
// the @core alias) import from here, so the denylist and the algorithm live in
// ONE place rather than drifting between two hand-mirrored copies.
//
// Pure TS with no node imports, so it bundles into the browser UI as well as
// the compiled bun binary (target architecture §5). Node-only concerns — home
// path scrubbing, NDJSON file round-trips — stay in src/redact.ts and ride in
// through the optional per-string transform below.

export const CENSOR = "<redacted>";

/** Keys whose values must never reach a log, toggle or no toggle — codifies
 * the "never log plan/prompt/feedback bodies" rule (EXC-444 added feedback:
 * reviewer prose is user-generated content like plan bodies) as a structural
 * invariant rather than a code-review convention. Exact-key matching only:
 * a future identifying key (hostname, user, email, …) must be added here
 * explicitly. */
export const DENY_KEYS = new Set(["plan", "prompt", "feedback"]);

/** Cause/extra chains are short; anything deeper than this is pathological. */
export const MAX_DEPTH = 6;

/** Walk a value graph, censoring DENY_KEYS unconditionally and — when a
 * `scrubStr` transform is supplied — rewriting every string through it (the
 * daemon's home-path scrub under the redact toggle; the UI passes none, so
 * strings pass through and only DENY_KEYS applies). Builds new structures
 * (never mutates), caps depth, and tolerates cycles — `seen` tracks the current
 * path only, so repeated (shared) references are walked normally while true
 * cycles cut off. */
export function scrubGraph(
	v: unknown,
	scrubStr?: (s: string) => string,
): unknown {
	return walk(v, scrubStr, 0, new WeakSet());
}

function walk(
	v: unknown,
	scrubStr: ((s: string) => string) | undefined,
	depth: number,
	seen: WeakSet<object>,
): unknown {
	if (typeof v === "string") return scrubStr ? scrubStr(v) : v;
	if (v === null || typeof v !== "object") return v;
	if (seen.has(v)) return "<cyclic>";
	if (depth >= MAX_DEPTH) return "<depth-capped>";
	seen.add(v);
	let out: unknown;
	if (Array.isArray(v)) {
		out = v.map((el) => walk(el, scrubStr, depth + 1, seen));
	} else {
		const obj: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v)) {
			obj[k] = DENY_KEYS.has(k) ? CENSOR : walk(val, scrubStr, depth + 1, seen);
		}
		out = obj;
	}
	seen.delete(v);
	return out;
}

/** Review-id prefix (the first UUID segment) for log MESSAGES: keeps lines
 * scannable without restating the full id, which rides in the structured
 * `reviewId` extra field for stitching/queries (EXC-444). */
export function shortId(id: string): string {
	return id.slice(0, 8);
}
