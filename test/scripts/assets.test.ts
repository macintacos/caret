// The pure halves of the `assets` task (EXC-805): the ImageMagick lookup, the
// seam geometry the four-theme stitch is cut along, and the magick argv the
// composite runs. Everything here is a plain function — the browser driving and
// the daemon boot are effects that live in the task's run functions, so this
// suite needs neither Chromium nor ImageMagick installed.
//
// test/scripts/ mirrors scripts/ (doc/agents/test-layout.md).

import { expect, test } from "bun:test";

import { MARKDOWN_READ_BY_TESTS } from "@scripts/preflight.ts";
import {
  ANNOTATION_ANCHOR,
  assetsPlan,
  bandCommand,
  FRAME,
  PLAN_TITLE_FRAGMENT,
  resolveMagick,
  seamLines,
  seamPolygons,
  stitchCommand,
} from "@/tasks/assets.ts";

// ---- resolveMagick ----

test("resolveMagick returns the resolved binary path", () => {
  expect(resolveMagick(() => "/opt/homebrew/bin/magick")).toBe("/opt/homebrew/bin/magick");
});

test("resolveMagick throws with the install hint when magick is absent", () => {
  // The hint is the whole point of the guard: without it the failure surfaces as
  // an ENOENT from a spawn deep inside the composite.
  expect(() => resolveMagick(() => null)).toThrow(/brew install imagemagick/);
});

// ---- seam geometry ----

// The seams are parallel anti-diagonals: every point on seam k satisfies
// x/width + y/height = t, and the polygons' cut edge has to lie on that same
// line or the mask would not meet the stroke drawn over it.
const onSeam = (width: number, height: number, x: number, y: number): number =>
  x / width + y / height;

const points = (spec: string): { x: number; y: number }[] =>
  spec.split(" ").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return { x: x as number, y: y as number };
  });

test("seamLines cuts a four-band frame with three evenly spaced anti-diagonals", () => {
  const lines = seamLines(FRAME.width, FRAME.height, 4);
  expect(lines).toHaveLength(3);
  // Evenly spaced across the frame's mid-height: quarter, half, three-quarter.
  const midX = lines.map((line) => {
    const [a, b] = points(line) as [{ x: number; y: number }, { x: number; y: number }];
    return a.x + ((b.x - a.x) * (FRAME.height / 2 - a.y)) / (b.y - a.y);
  });
  expect(midX).toEqual([FRAME.width / 4, FRAME.width / 2, (FRAME.width * 3) / 4]);
});

test("the middle seam of an even band count runs corner to corner", () => {
  // The frame's own diagonal, which is what makes the stitch read as one picture
  // cut apart rather than as four images tiled.
  expect(seamLines(FRAME.width, FRAME.height, 4)[1]).toBe(`${FRAME.width},0 0,${FRAME.height}`);
  // The geometry is derived from the band count, so two bands is one corner-to-
  // corner cut — the degenerate case the four-band form generalizes.
  expect(seamLines(FRAME.width, FRAME.height, 2)).toEqual([`${FRAME.width},0 0,${FRAME.height}`]);
  expect(seamPolygons(FRAME.width, FRAME.height, 2)).toHaveLength(1);
});

test("seamPolygons yields one half-plane mask per seam, cut along that seam", () => {
  const polygons = seamPolygons(FRAME.width, FRAME.height, 4);
  expect(polygons).toHaveLength(3);
  polygons.forEach((polygon, k) => {
    const pts = points(polygon);
    expect(pts).toHaveLength(4);
    // The first edge is the cut: both ends sit on seam k's line, and it spans
    // past both horizontal edges of the frame so the mask meets the corners.
    const t = 0.5 + (k + 1) / 4;
    const [p0, p1] = pts as [{ x: number; y: number }, { x: number; y: number }];
    expect(onSeam(FRAME.width, FRAME.height, p0.x, p0.y)).toBeCloseTo(t, 10);
    expect(onSeam(FRAME.width, FRAME.height, p1.x, p1.y)).toBeCloseTo(t, 10);
    expect(p0.y).toBeLessThan(0);
    expect(p1.y).toBeGreaterThan(FRAME.height);
  });
});

test("each mask keeps the bottom-right corner and drops the top-left one", () => {
  // Which side of the cut the later band paints on: bands composite in order, so
  // band k has to cover the corner the frame ends at and leave the one it starts
  // at to the bands already laid down.
  const inside = (polygon: string, x: number, y: number): boolean => {
    const pts = points(polygon);
    // Convex quadrilateral: inside means the same turn direction at every edge.
    const signs = pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length] as { x: number; y: number };
      return Math.sign((q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x));
    });
    return signs.every((s) => s >= 0) || signs.every((s) => s <= 0);
  };
  for (const polygon of seamPolygons(FRAME.width, FRAME.height, 4)) {
    expect(inside(polygon, FRAME.width - 1, FRAME.height - 1)).toBe(true);
    expect(inside(polygon, 1, 1)).toBe(false);
  }
});

// ---- magick argv ----

test("bandCommand masks a capture with its seam polygon in one magick call", () => {
  expect(bandCommand("magick", 1440, 900, "cap.png", "1,2 3,4", "band.png")).toEqual([
    "magick",
    "cap.png",
    "(",
    "-size",
    "1440x900",
    "xc:black",
    "-fill",
    "white",
    "-draw",
    "polygon 1,2 3,4",
    ")",
    "-alpha",
    "off",
    "-compose",
    "CopyOpacity",
    "-composite",
    "band.png",
  ]);
});

test("stitchCommand flattens the bands then strokes the seams in the accent", () => {
  expect(stitchCommand("magick", ["a.png", "b.png"], "#ff8800", ["1,2 3,4"], "out.png")).toEqual([
    "magick",
    "a.png",
    "b.png",
    "-flatten",
    "-stroke",
    "#ff8800",
    "-strokewidth",
    "4",
    "-draw",
    "line 1,2 3,4",
    "out.png",
  ]);
});

// ---- the umbrella's sequence ----

/** Capture what assetsPlan would spawn, without spawning it. */
function fakeRunner(codes: number[] = []) {
  const calls: { cmd: string[]; env?: Record<string, string> }[] = [];
  const run = async (cmd: string[], opts: { env?: Record<string, string> } = {}) => {
    calls.push({ cmd, env: opts.env });
    return codes[calls.length - 1] ?? 0;
  };
  return { calls, run };
}

test("bare assets builds the UI once, then runs stitch before video with the skip set", async () => {
  // Both targets call ensureUi through their own prerequisites, so without the
  // skip a bare run pays the full Vite build twice. Stitch leads because it is
  // the target that needs ImageMagick — a missing host tool has to fail before
  // the recording, not after it.
  const { calls, run } = fakeRunner();
  expect(await assetsPlan(run)).toBe(0);
  expect(calls.map((c) => c.cmd.slice(2).join(" "))).toEqual([
    "build ui",
    "assets stitch",
    "assets video",
  ]);
  expect(calls[1]?.env?.CARET_SKIP_BUILD_UI).toBe("1");
  expect(calls[2]?.env?.CARET_SKIP_BUILD_UI).toBe("1");
});

test("a failed stitch stops the umbrella before it records anything", async () => {
  const { calls, run } = fakeRunner([0, 1]);
  expect(await assetsPlan(run)).toBe(1);
  expect(calls.map((c) => c.cmd.slice(2).join(" "))).toEqual(["build ui", "assets stitch"]);
});

// ---- fixture drift ----

// The task resolves both of these against scripts/tasks/dev/demo-plan.md at run
// time, in a browser, outside every gate — so an edit that strands one is only
// caught here. preflight's MARKDOWN_READ_BY_TESTS is what makes that true for a
// Markdown-only change, which would otherwise narrow the gate to `lint` alone.
const DEMO_PLAN = await Bun.file(`${import.meta.dir}/../../scripts/tasks/dev/demo-plan.md`).text();

test("the demo plan carries the anchors the assets task resolves against it", () => {
  expect(DEMO_PLAN.split(ANNOTATION_ANCHOR)).toHaveLength(2);
  expect(DEMO_PLAN).toContain(PLAN_TITLE_FRAGMENT);
  // The recording retitles the plan's h1 for the agent's follow-up.
  expect(DEMO_PLAN).toMatch(/^# .+$/m);
});

test("preflight runs this suite when only the demo plan changed", () => {
  expect(MARKDOWN_READ_BY_TESTS).toContain("scripts/tasks/dev/demo-plan.md");
});
