import "@ui/support/mount.ts";
import { describe, expect, test } from "bun:test";

import { render } from "@ui/support/mount.ts";
import Icon from "@/components/Icon.svelte";

// icons.test.ts gates the registry↔directory↔Icon.svelte wiring; this suite
// covers only the render contract: the a11y label/aria-hidden split and sizing.
describe("Icon", () => {
  test("inlines the named SVG", () => {
    const { target } = render(Icon, { name: "check" });
    expect(target.querySelector("svg")).not.toBeNull();
  });

  test("decorative by default: aria-hidden, no role/label", () => {
    const { target } = render(Icon, { name: "bell" });
    const span = target.querySelector(".icon")!;
    expect(span.getAttribute("aria-hidden")).toBe("true");
    expect(span.getAttribute("role")).toBeNull();
    expect(span.getAttribute("aria-label")).toBeNull();
  });

  test("informative when labeled: role=img + aria-label, not hidden", () => {
    const { target } = render(Icon, { name: "bell", label: "Notifications" });
    const span = target.querySelector(".icon")!;
    expect(span.getAttribute("role")).toBe("img");
    expect(span.getAttribute("aria-label")).toBe("Notifications");
    expect(span.getAttribute("aria-hidden")).toBeNull();
  });

  test("applies the square size to the wrapper", () => {
    const { target } = render(Icon, { name: "check", size: 24 });
    const style = target.querySelector(".icon")!.getAttribute("style") ?? "";
    expect(style).toContain("width: 24px");
    expect(style).toContain("height: 24px");
  });

  test("defaults to a 16px square when size is omitted", () => {
    const { target } = render(Icon, { name: "check" });
    const style = target.querySelector(".icon")!.getAttribute("style") ?? "";
    expect(style).toContain("width: 16px");
    expect(style).toContain("height: 16px");
  });
});
