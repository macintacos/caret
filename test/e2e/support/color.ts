// How far apart two colors read, measured as the browser paints them. A spec that asks
// whether a state reads apart from its rest needs the resolved color, not the sheet's
// source text, so each is painted through a canvas first.

import type { Page } from "@playwright/test";

/** Each CSS color as CIELAB (D65) [L, a, b], painted opaque through a canvas. Alpha is
 * dropped, so pass opaque colors. */
export function toLab(page: Page, colors: readonly string[]): Promise<number[][]> {
  return page.evaluate((list) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (ctx === null) throw new Error("no 2d context");
    return list.map((color) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0] = [...ctx.getImageData(0, 0, 1, 1).data].map((c) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
      const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
      const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
    });
  }, colors);
}

/** The CIE76 distance between two CSS colors, as `toLab` paints them. */
export async function colorDistance(page: Page, a: string, b: string): Promise<number> {
  const [p = [], q = []] = await toLab(page, [a, b]);
  return Math.hypot(...p.map((v, i) => v - (q[i] ?? 0)));
}

/** `color`, which may be translucent, painted over the opaque `ground`, as `rgb(r g b)`. */
export function paintOver(page: Page, color: string, ground: string): Promise<string> {
  return page.evaluate(
    ([top, under]) => {
      const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      if (ctx === null) throw new Error("no 2d context");
      for (const fill of [under, top]) {
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, 1, 1);
      }
      const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r} ${g} ${b})`;
    },
    [color, ground] as const,
  );
}

/** The WCAG contrast ratio between two `rgb(r g b)` colors, lighter over darker. */
export function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    const [r = 0, g = 0, b = 0] = (color.match(/\d+/g) ?? []).map((c) => {
      const v = Number(c) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** How one range of a custom highlight paints, each as `rgb(r g b)`. */
export interface HighlightPaint {
  /** The text of the block the range sits in. */
  block: string;
  /** The range's fill: the commonest pixel inside its box. */
  fill: string;
  /** What it sits on: the commonest pixel in the 4px after its box. */
  ground: string;
  /** Its text: the pixel inside its box furthest from the fill, a glyph's core. Antialiasing
   * only pulls a pixel toward the fill, so a contrast read from it never flatters. */
  ink: string;
}

/** How every range of the custom highlight `name` paints, read off a screenshot. Each range
 * must sit on one line and be followed by a space on it. */
export async function highlightPaint(page: Page, name: string): Promise<HighlightPaint[]> {
  const shot = (await page.screenshot()).toString("base64");
  return page.evaluate(
    async ([png, highlight]) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx === null) throw new Error("no 2d context");
      ctx.drawImage(image, 0, 0);
      const scale = image.width / innerWidth;
      const pixels = (left: number, top: number, right: number, bottom: number) => {
        const [x, y] = [Math.round(left * scale), Math.round(top * scale)];
        const w = Math.max(1, Math.round(right * scale) - x);
        const h = Math.max(1, Math.round(bottom * scale) - y);
        const data = ctx.getImageData(x, y, w, h).data;
        const out: number[][] = [];
        for (let i = 0; i < data.length; i += 4)
          out.push([data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]);
        return out;
      };
      const commonest = (list: number[][]) => {
        const counts = new Map<string, number>();
        for (const p of list) counts.set(p.join(" "), (counts.get(p.join(" ")) ?? 0) + 1);
        return [...counts].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
      };
      const furthest = (list: number[][], from: string) => {
        const f = from.split(" ").map(Number);
        const gap = (p: number[]) => Math.hypot(...p.map((v, i) => v - (f[i] ?? 0)));
        return list.reduce((a, b) => (gap(b) > gap(a) ? b : a)).join(" ");
      };
      return [...(CSS.highlights.get(highlight) ?? [])].map((range) => {
        // A range that starts at a text node's end has an empty first box.
        const box = [...(range as Range).getClientRects()].reduce((a, b) =>
          b.width > a.width ? b : a,
        );
        const inside = pixels(box.left + 1, box.top + 1, box.right - 1, box.bottom - 1);
        const fill = commonest(inside);
        const parent = (range as Range).startContainer.parentElement;
        return {
          block:
            parent?.closest("[data-line], p, h1, h2, h3, li, pre, blockquote, th, td")
              ?.textContent ?? "",
          fill: `rgb(${fill})`,
          ground: `rgb(${commonest(pixels(box.right + 1, box.top + 1, box.right + 5, box.bottom - 1))})`,
          ink: `rgb(${furthest(inside, fill)})`,
        };
      });
    },
    [shot, name] as const,
  );
}
