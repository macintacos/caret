// Zod schemas for the daemon's request bodies. Split out of server.ts so the
// route handlers import the parsers instead of defining them inline; the
// leniency rationale for each schema stays with it below.

import { z } from "zod";

import type { Behavior, DraftBody, PlanInput, ResolveBody } from "@/lib/types.ts";

// Request-body schemas at the browser trust boundary. They are deliberately
// lenient — a malformed body degrades to the schema's fallback rather than
// rejecting, matching the cast-and-trust behavior they replace. The win is a
// named boundary and per-field validation, not stricter rejection.

// POST /api/reviews: an incoming plan. Every field is optional and the whole
// object falls back to {} on a non-object body, mirroring the `req.json()
// .catch(() => ({}))` tolerance the body parser keeps — the router then defaults
// each absent field itself.
export const PlanInputSchema: z.ZodType<PlanInput> = z
  .object({
    sessionId: z.string().optional(),
    cwd: z.string().optional(),
    title: z.string().optional(),
    plan: z.string().optional(),
    // The agent's on-disk plan file, rewritten with the canonical text so the
    // agent's plan of record matches the review (see plan-file.ts). zod strips
    // unknown keys, so it must be declared here to survive the POST body parse.
    planFilePath: z.string().optional(),
    // The originating cmux pane (EXC-961). Both ids are required for a pane to
    // survive: a half-set pair would name a workspace without a surface, and
    // clearing at that granularity would hit panes unrelated to caret.
    cmux: z
      .object({ workspaceId: z.string().min(1), surfaceId: z.string().min(1) })
      .optional()
      .catch(undefined),
  })
  .catch({});

// POST /api/reviews/:id/file-refs: the candidate path strings the UI parsed from
// a plan, asking what each one resolves to. A non-array or non-object body
// degrades to an empty list (nothing resolves), matching the lenient boundary
// the other schemas keep. The handler de-dupes, then caps how many it resolves.
//
// The cap is roomy because the candidate gate is: since EXC-916 every plausible
// path token inside inline code is offered, not only the ones ending in a known
// extension, so a long plan can reach several hundred distinct tokens. A cap
// that truncated would silently drop real citations from the tail of a plan.
//
// What the cap really bounds is the expensive branch, and that is not the stat.
// A hit costs one realpath and one stat; a MISS costs those plus — when the
// token is slash-free and file-shaped — a bounded basename walk of up to
// MAX_SCAN_ENTRIES dirents. That walk is what a large cap buys, so the same
// EXC-916 narrowing that made the walk rare (a slash or an unknown extension
// stops it outright) is what makes this number affordable.
export const MAX_FILE_REFS = 1000;
export const FileRefsBodySchema = z
  .object({ paths: z.array(z.string()).catch([]) })
  .catch({ paths: [] });

const BehaviorSchema: z.ZodType<Behavior> = z.enum(["allow", "deny"]);

// POST /api/reviews/:id/resolve. `behavior` falls back to "allow" unless the
// body explicitly says "deny" (fail-safe: an absent or garbled behavior never
// denies on its own). `acceptMode` is an opaque approve-variant id carried
// verbatim — a non-string degrades to undefined at the field, leaving the rest of
// the decision intact; the handler then gates it against the adapter-declared set
// before seeding prefs (an id outside the set never moves the remembered value).
export const ResolveBodySchema: z.ZodType<ResolveBody> = z
  .object({
    behavior: BehaviorSchema.catch("allow"),
    feedback: z.string().optional(),
    acceptMode: z.string().optional().catch(undefined),
  })
  .catch({ behavior: "allow" });

// PUT /api/reviews/:id/draft. Each field is independently optional; the handler
// leaves an absent field untouched (`!= null`), so a draft-only write never
// wipes annotations and vice versa. An explicit null normalizes to undefined so
// a malformed null payload is treated as absent, not a clobber.
const LineAnnotationSchema = z
  .object({
    id: z.string(),
    // 1-based, inclusive line range into the stored plan version's text.
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    comment: z.string(),
    // Per-comment lifecycle from the ReviewStatus vocabulary. Optional so a draft
    // that predates the field round-trips; preserved here (rather than stripped as
    // an unknown key) so a client that sets it persists it.
    state: z.enum(["pending", "approved", "rejected", "expired"]).optional(),
  })
  .refine((a) => a.endLine >= a.startLine, { message: "endLine must be >= startLine" });
const LegacyAnnotationSchema = z.object({
  id: z.string(),
  blockId: z.string(),
  startOffset: z.number(),
  endOffset: z.number(),
  quote: z.string(),
  // The W3C TextQuoteSelector context is optional — an annotation persisted
  // before the hybrid anchor omits these and round-trips unchanged.
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  comment: z.string(),
});
const AnnotationSchema = z.union([LineAnnotationSchema, LegacyAnnotationSchema]);

// A persisted, unsent composer scratch: the line-range anchor plus the retained
// text. The UI type's derivable `key` is not persisted (see PersistedScratch).
const PersistedScratchSchema = z
  .object({
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    text: z.string(),
  })
  .refine((s) => s.endLine >= s.startLine, { message: "endLine must be >= startLine" });

/** Finds the first annotations entry that claims the line-anchored shape
 * (carries `startLine` or `endLine`) but fails LineAnnotationSchema. A
 * malformed line anchor is a client bug and rejects with 400; everything else
 * keeps the body-level degrade tolerance. Returns the validation message, or
 * null when no entry claims the shape badly. */
export function malformedLineAnchor(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const anns = (raw as { annotations?: unknown }).annotations;
  if (!Array.isArray(anns)) return null;
  for (const a of anns) {
    if (typeof a !== "object" || a === null) continue;
    if (!("startLine" in a || "endLine" in a)) continue;
    const res = LineAnnotationSchema.safeParse(a);
    if (!res.success) return res.error.issues[0]?.message ?? "invalid line anchor";
  }
  return null;
}
const nullToUndefined = <T>(v: T | null | undefined): T | undefined => v ?? undefined;
export const DraftBodySchema: z.ZodType<DraftBody> = z
  .object({
    annotations: z.array(AnnotationSchema).nullish().transform(nullToUndefined),
    generalCommentDraft: z.string().nullish().transform(nullToUndefined),
    // Per-field catch so one malformed scratch degrades this field to absent
    // without clobbering a valid sibling field in the same body.
    composerScratches: z
      .array(PersistedScratchSchema)
      .nullish()
      .transform(nullToUndefined)
      .catch(undefined),
    // The version the scratches were composed against (optional for back-compat
    // with clients that don't send it); the daemon uses it to drop a stale write.
    version: z.number().int().min(1).nullish().transform(nullToUndefined).catch(undefined),
  })
  .catch({
    annotations: undefined,
    generalCommentDraft: undefined,
    composerScratches: undefined,
    version: undefined,
  });

/** Parse a request body that may be malformed JSON. A JSON parse failure
 * degrades to `{}`; a body that fails the schema degrades to the schema's
 * `.catch` fallback — these routes never rejected a bad body, they tolerated
 * it. */
export async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await req.json().catch(() => ({})));
}
