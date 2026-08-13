// The pure halves of the `assets` task (EXC-805): the host-tool lookup, the seam
// geometry the four-theme stitch is cut along, and the magick / ffmpeg argv the
// composite and the encode run. Everything here is a plain function — the browser
// driving and the daemon boot are effects that live in the task's run functions,
// so this suite runs with none of Chromium, ImageMagick or ffmpeg installed.
//
// test/scripts/ mirrors scripts/ (doc/agents/test-layout.md).

import { expect, test } from "bun:test";

import { MARKDOWN_READ_BY_TESTS } from "@scripts/preflight.ts";
import {
  ANNOTATION_ANCHOR,
  assetsPlan,
  bandCommand,
  encodeCommand,
  FRAME,
  PLAN_TITLE_FRAGMENT,
  resolveTool,
  seamLines,
  seamPolygons,
  stitchCommand,
} from "@/tasks/assets.ts";

// ---- resolveTool ----

test("resolveTool returns the resolved binary path", () => {
  expect(resolveTool(() => "/opt/homebrew/bin/magick", "magick", "imagemagick")).toBe(
    "/opt/homebrew/bin/magick",
  );
});

test("resolveTool throws with the install hint when the tool is absent", () => {
  // The hint is the whole point of the guard: without it the failure surfaces as
  // an ENOENT from a spawn deep inside the pipeline.
  expect(() => resolveTool(() => null, "magick", "imagemagick")).toThrow(
    /brew install imagemagick/,
  );
  expect(() => resolveTool(() => null, "ffmpeg", "ffmpeg")).toThrow(/brew install ffmpeg/);
});

// ---- seam geometry ----

interface Point {
  x: number;
  y: number;
}

const points = (spec: string): Point[] =>
  spec.split(" ").map((pair) => {
    const [x, y] = pair.split(",").map(Number);
    return { x: x as number, y: y as number };
  });

/** Seam k's two ends, as the line's `x1,y1 x2,y2` draw points name them. */
const ends = (line: string): [Point, Point] => points(line) as [Point, Point];

/** The x a straight line sits at for a given y. */
const xAt = (a: Point, b: Point, y: number): number =>
  a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);

test("seamLines cuts a four-band frame into three seams, evenly spaced at mid-height", () => {
  const lines = seamLines(FRAME.width, FRAME.height, 4);
  expect(lines).toHaveLength(3);
  // Mid-height spacing is not cosmetic: a straight line's mean x across the
  // frame IS its mid-height x, and the area to a full-height seam's left is that
  // mean times the height. Evenly spaced mid-heights therefore means every band
  // has exactly `width · height / bands` — the balance the picture is judged on.
  const midX = lines.map((line) => xAt(...ends(line), FRAME.height / 2));
  expect(midX).toEqual([FRAME.width / 4, FRAME.width / 2, (FRAME.width * 3) / 4]);
});

test("every seam enters the top edge and leaves the bottom edge, inside the frame", () => {
  // The load-bearing half of the equal-area claim above, and the flaw a
  // corner-to-corner diagonal has: a seam shallow enough to exit through a SIDE
  // makes its outer band a corner triangle rather than a full-height stripe, so
  // evenly spaced seams stop producing evenly sized bands. Checked across band
  // counts, since the outermost seam is the one that escapes first.
  for (const bands of [2, 3, 4, 5]) {
    for (const line of seamLines(FRAME.width, FRAME.height, bands)) {
      const [top, bottom] = ends(line);
      expect(top.y).toBe(0);
      expect(bottom.y).toBe(FRAME.height);
      expect(top.x).toBeLessThanOrEqual(FRAME.width);
      expect(bottom.x).toBeGreaterThanOrEqual(0);
    }
  }
});

test("the seams run at 60 degrees, steep enough to clear the side edges", () => {
  // Shallower than ~51° on this frame and the four-band case starts exiting
  // through the sides (the test above); the angle is what buys the margin.
  // Read back off the emitted points, which are whole pixels because magick
  // draws on an integer grid — so the tolerance is a rounding tolerance, not
  // slack in the claim.
  const [top, bottom] = ends(seamLines(FRAME.width, FRAME.height, 4)[1] as string);
  const degrees = (Math.atan2(bottom.y - top.y, top.x - bottom.x) * 180) / Math.PI;
  expect(Math.abs(degrees - 60)).toBeLessThan(0.1);
});

test("seamPolygons yields one mask per seam, cut along that seam", () => {
  const polygons = seamPolygons(FRAME.width, FRAME.height, 4);
  const lines = seamLines(FRAME.width, FRAME.height, 4);
  expect(polygons).toHaveLength(3);
  polygons.forEach((polygon, k) => {
    const pts = points(polygon);
    expect(pts).toHaveLength(4);
    // The mask's first edge IS seam k, extended a frame past each horizontal
    // edge so it reaches the corners. Compared against the drawn line, so a mask
    // that drifted from the stroke over it fails here. Within a pixel, because
    // both are emitted on magick's integer grid.
    const [above, below] = pts as [Point, Point];
    const seam = ends(lines[k] as string);
    expect(above.y).toBeLessThan(0);
    expect(below.y).toBeGreaterThan(FRAME.height);
    expect(Math.abs(xAt(above, below, 0) - seam[0].x)).toBeLessThan(1);
    expect(Math.abs(xAt(above, below, FRAME.height) - seam[1].x)).toBeLessThan(1);
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
  expect(stitchCommand("magick", ["a.png", "b.png"], "#ff8800", ["1,2 3,4"], 6, "out.png")).toEqual(
    [
      "magick",
      "a.png",
      "b.png",
      "-flatten",
      "-stroke",
      "#ff8800",
      "-strokewidth",
      "6",
      "-draw",
      "line 1,2 3,4",
      "out.png",
    ],
  );
});

test("encodeCommand builds a browser-playable H.264 mp4 at the measured rate", () => {
  // yuv420p + faststart is what makes it play in a browser and in QuickTime
  // rather than only in a developer's media player; the rate is measured from
  // the capture so playback is real time.
  const cmd = encodeCommand("ffmpeg", 12.5, "/tmp/f-%05d.jpg", "out.mp4");
  expect(cmd.slice(0, 2)).toEqual(["ffmpeg", "-y"]);
  expect(cmd).toContain("12.500");
  expect(cmd).toContain("/tmp/f-%05d.jpg");
  expect(cmd.join(" ")).toContain("-c:v libx264");
  expect(cmd.join(" ")).toContain("-pix_fmt yuv420p");
  expect(cmd.join(" ")).toContain("-movflags +faststart");
  expect(cmd.at(-1)).toBe("out.mp4");
});

test("the demo recording stays out of the repository", async () => {
  // GitHub plays a video from an attachment URL, not from a repo path, so the
  // README embeds the upload's URL — and a committed recording would add a
  // multi-megabyte blob to history on every regeneration for nothing.
  const ignored = await Bun.file(`${import.meta.dir}/../../.gitignore`).text();
  expect(ignored).toContain("/doc/assets/caret-review-demo.mp4");
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
