// The View Transitions probe and ambient effects, shared by the two swaps that use the
// API — the theme wipe (lib/themeWipe.ts) and the plan hand-off (lib/planHandoff.ts) — so
// a browser-quirk gate lands in one place.

/** The API, probed for without hard-typing it (it isn't in every TS DOM lib); of the
 * transition it returns, only `finished` is ever read. */
type StartViewTransition = (update: () => void) => { finished?: Promise<unknown> } | undefined;

type MaybeViewTransitions = Document & { startViewTransition?: StartViewTransition };

/** The ambient effects a view transition needs, injected so a unit test drives the
 * decision without a real browser. */
export interface ViewTransitionDeps {
  /** Runs the update inside a transition when supported; undefined means unsupported. */
  startViewTransition?: StartViewTransition;
  /** True when the user prefers reduced motion — run the update instantly, no transition. */
  prefersReducedMotion: () => boolean;
}

/** True when this document has the View Transitions API. App withholds the `.arrival`
 * curtain on the empty state only when this is true, so an engine without the API keeps it. */
export function supportsViewTransition(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof (document as MaybeViewTransitions).startViewTransition === "function"
  );
}

/** The real browser effects, with the API bound to this document. */
export function viewTransitionDeps(): ViewTransitionDeps {
  const doc = typeof document !== "undefined" ? (document as MaybeViewTransitions) : undefined;
  const start = doc?.startViewTransition;
  return {
    startViewTransition: typeof start === "function" ? start.bind(doc) : undefined,
    prefersReducedMotion: () =>
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}
