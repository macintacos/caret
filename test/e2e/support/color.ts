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
