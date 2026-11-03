// The layout's live moves: the outline column standing or folding, and a file docking
// beside the plan or leaving it. The change applies at once, so the plan is laid out where
// it ends in one pass, on the first frame. Each part that moved is then drawn back at the
// place it stood and let go, sliding home on a CSS transition: only transforms move, and a
// second change reverses a slide mid-flight from wherever it has got to.
//
// The CSS is two rules: `[data-slide-from]` (styles/base.css) holds a part at its start
// offset, and scale where it stretches, for one style pass, and each part declares its own
// `transform` transition on `--slide-dur`.

/** A part's box, as `getBoundingClientRect` gives it. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Offset {
  x: number;
  y: number;
}

/** A part once the change has applied: where it stood, where it now stands, and the part
 * it sits inside, by index, if that part slides too. */
export interface Placed {
  from?: Box;
  to: Box;
  /** Where a part with nothing before the change comes in from, given its box. */
  enter?: (box: Box) => Offset;
  parent?: number;
  /** Whether it starts at its old width, so a change of width alone moves it. */
  keepsWidth?: boolean;
}

/** Under half a pixel, a part has not moved. */
const STILL_PX = 0.5;

/** The offset each part starts from: from the place it stood, less what the parts it sits
 * inside already carry. Parents come before their children. Null where a part does not
 * slide. */
export function startOffsets(parts: readonly (Placed | null)[]): (Offset | null)[] {
  const carried: Offset[] = [];
  return parts.map((part, i) => {
    carried[i] = { x: 0, y: 0 };
    if (part === null) return null;
    const ride =
      part.parent === undefined ? { x: 0, y: 0 } : (carried[part.parent] ?? { x: 0, y: 0 });
    const own = part.from
      ? { x: part.from.left - part.to.left - ride.x, y: part.from.top - part.to.top - ride.y }
      : (part.enter?.(part.to) ?? null);
    const resized =
      part.keepsWidth && part.from && Math.abs(part.from.width - part.to.width) >= STILL_PX;
    if (own === null || (!resized && Math.abs(own.x) < STILL_PX && Math.abs(own.y) < STILL_PX)) {
      carried[i] = ride;
      return null;
    }
    carried[i] = { x: ride.x + own.x, y: ride.y + own.y };
    return own;
  });
}

/** One part of a slide, looked up before the change and again after it. */
export interface SlidePart {
  before: () => HTMLElement | null | undefined;
  after: () => HTMLElement | null | undefined;
  /** How a part with nothing before the change comes in, and on what duration token. */
  enter?: { from: (box: Box) => Offset; duration: string };
  /** Whether the part spans between edges that move on their own, so it scales as well as
   * sliding (`--slide-sx`, from its left edge): a plain surface, since what it holds would
   * scale too. `"both"`: each edge starts where it stood. `"start"`: its start edge does,
   * and its end edge goes with the part it sits inside. */
  stretches?: "both" | "start";
}

export interface SlideOptions {
  /** The slide's duration token, read once the change has applied. */
  duration: () => string;
  /** Called once the change has applied, with every part held at its new place: the
   * moment to measure the layout the slide ends in. */
  measured?: () => void;
}

export interface SlideDeps {
  prefersReducedMotion: () => boolean;
}

const defaultDeps: SlideDeps = {
  prefersReducedMotion: () =>
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
};

/** The width a part starts at, as a scale of its new one. */
function startScale(
  stretches: SlidePart["stretches"],
  offset: Offset,
  old: Box | undefined,
  box: Box | undefined,
): number {
  if (!box?.width) return 1;
  if (stretches === "both" && old) return old.width / box.width;
  if (stretches === "start") return (box.width - offset.x) / box.width;
  return 1;
}

function hold(el: HTMLElement, at: Offset, scale = 1): void {
  el.style.setProperty("--slide-x", `${at.x}px`);
  el.style.setProperty("--slide-y", `${at.y}px`);
  el.style.setProperty("--slide-sx", `${scale}`);
  el.setAttribute("data-slide-from", "");
}

/** Applies `change`, which must leave the DOM updated (a Svelte caller flushes), and slides
 * each part from where it stood to where the change put it. `change` is told whether the
 * parts will slide: under reduced motion they don't. `parts` lists a part before any part
 * inside it. */
export function slideLayout(
  parts: readonly SlidePart[],
  change: (sliding: boolean) => void,
  options: SlideOptions,
  deps: SlideDeps = defaultDeps,
): void {
  if (deps.prefersReducedMotion()) {
    change(false);
    return;
  }
  const from = parts.map((part) => part.before()?.getBoundingClientRect());
  change(true);
  const els = parts.map((part) => part.after() ?? null);
  // Held at their places with any running slide let go, so one layout pass measures the
  // layout the change ends in.
  for (const el of els) if (el) hold(el, { x: 0, y: 0 });
  const to = els.map((el) => el?.getBoundingClientRect());
  options.measured?.();
  const offsets = startOffsets(
    els.map((el, i) => {
      const box = to[i];
      if (!el || !box) return null;
      const parent = els.findLastIndex((other, j) => j < i && other?.contains(el));
      return {
        from: from[i],
        to: box,
        enter: parts[i]?.enter?.from,
        parent: parent < 0 ? undefined : parent,
        keepsWidth: parts[i]?.stretches === "both",
      };
    }),
  );
  const duration = options.duration();
  const sliding: HTMLElement[] = [];
  els.forEach((el, i) => {
    const offset = offsets[i];
    if (!el) return;
    if (!offset) {
      el.removeAttribute("data-slide-from");
      return;
    }
    const old = from[i];
    hold(el, offset, startScale(parts[i]?.stretches, offset, old, to[i]));
    el.style.setProperty("--slide-dur", old ? duration : (parts[i]?.enter?.duration ?? duration));
    sliding.push(el);
  });
  // One style pass with the parts at their start offsets, so letting go is a change the
  // parts' transitions run, and one more once they are let go, so every slide starts in
  // this task, with whatever the change itself set sliding.
  void sliding[0]?.getBoundingClientRect();
  for (const el of sliding) el.removeAttribute("data-slide-from");
  void sliding[0]?.getBoundingClientRect();
}
