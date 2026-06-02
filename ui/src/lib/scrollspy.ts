// Scroll-synced active-heading tracking. Observes heading elements within the
// center scroll container and reports the topmost heading currently in the
// reading zone. rootMargin is tuned so exactly one heading is "active": a tall
// negative bottom margin shrinks the observation band to a sliver near the top.

export interface ScrollSpyOptions {
  /** The scroll container (observer root). */
  root: HTMLElement;
  /** Heading elements to track, in document order. */
  headings: HTMLElement[];
  /** Called with the slug (data-slug) of the active heading, or null. */
  onActive: (slug: string | null) => void;
}

export function createScrollSpy(opts: ScrollSpyOptions): () => void {
  const { root, headings, onActive } = opts;
  if (headings.length === 0) return () => {};

  // Track visibility per heading; the active one is the first visible heading
  // in document order, falling back to the last heading scrolled past.
  const visible = new Set<Element>();
  let lastPassed: HTMLElement | null = headings[0] ?? null;

  const compute = () => {
    let active: HTMLElement | null = null;
    for (const h of headings) {
      if (visible.has(h)) {
        active = h;
        break;
      }
    }
    if (!active) active = lastPassed;
    onActive(active?.dataset.slug ?? null);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          visible.add(entry.target);
        } else {
          visible.delete(entry.target);
          // If a heading left the band by scrolling up, remember it as passed.
          if (entry.boundingClientRect.top < 0) {
            lastPassed = entry.target as HTMLElement;
          }
        }
      }
      compute();
    },
    {
      root,
      // Observation band: top ~10% to a thin slice, so a single heading wins.
      rootMargin: "0px 0px -80% 0px",
      threshold: 0,
    },
  );

  for (const h of headings) observer.observe(h);

  return () => observer.disconnect();
}
