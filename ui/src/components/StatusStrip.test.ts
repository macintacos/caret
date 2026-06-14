import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import StatusStrip from "./StatusStrip.svelte";

const base = {
  active: true,
  pendingCount: 0,
  coveredLines: 0,
  version: 1,
  connected: true,
};

describe("StatusStrip", () => {
  test("self-gates: renders nothing when no review is active", () => {
    const { target } = render(StatusStrip, { ...base, active: false, pendingCount: 3 });
    expect(target.querySelector(".status-strip")).toBeNull();
  });

  test("active with comments: shows the pending tally and the .metric atom", () => {
    const { target } = render(StatusStrip, { ...base, pendingCount: 3, coveredLines: 5 });
    const strip = target.querySelector(".status-strip");
    expect(strip).not.toBeNull();
    expect(strip!.classList.contains("metric")).toBe(true);
    expect(strip!.querySelector(".num")!.textContent).toBe("3");
    expect(strip!.textContent).toContain("comments");
  });

  test("singular comment label when exactly one comment is pending", () => {
    const { target } = render(StatusStrip, { ...base, pendingCount: 1 });
    const strip = target.querySelector(".status-strip")!;
    expect(strip.textContent).toContain("comment");
    expect(strip.textContent).not.toContain("comments");
  });

  test("active with no comments still renders (revision + connection carry value)", () => {
    const { target } = render(StatusStrip, { ...base, pendingCount: 0 });
    const strip = target.querySelector(".status-strip");
    expect(strip).not.toBeNull();
    expect(strip!.querySelector(".num")!.textContent).toBe("0");
  });

  test("colors a populated pending tally semantically", () => {
    const populated = render(StatusStrip, { ...base, pendingCount: 2 });
    expect(populated.target.querySelector(".num")!.classList.contains("has")).toBe(true);

    const empty = render(StatusStrip, { ...base, pendingCount: 0 });
    expect(empty.target.querySelector(".num")!.classList.contains("has")).toBe(false);
  });

  test("shows the covered-lines tally only when there are line-covering comments", () => {
    const withCoverage = render(StatusStrip, { ...base, pendingCount: 2, coveredLines: 4 });
    expect(withCoverage.target.querySelector(".covered")!.textContent).toBe("4");

    // Comments exist but none anchor to source lines (e.g. legacy-only) → no
    // lines tally, just the comment count.
    const noCoverage = render(StatusStrip, { ...base, pendingCount: 2, coveredLines: 0 });
    expect(noCoverage.target.querySelector(".covered")).toBeNull();
  });

  test("shows the ^vN revision pill only past the first version", () => {
    const v2 = render(StatusStrip, { ...base, version: 2 });
    expect(v2.target.querySelector(".rev")!.textContent).toContain("v2");
    expect(v2.target.querySelector(".rev .caret")!.textContent).toBe("^");

    const v1 = render(StatusStrip, { ...base, version: 1 });
    expect(v1.target.querySelector(".rev")).toBeNull();
  });

  test("reflects the connection state once, with a semantic dot", () => {
    const online = render(StatusStrip, { ...base, connected: true });
    const onConn = online.target.querySelector(".conn")!;
    expect(onConn.classList.contains("offline")).toBe(false);
    expect(onConn.textContent).toContain("live");

    const offline = render(StatusStrip, { ...base, connected: false });
    const offConn = offline.target.querySelector(".conn")!;
    expect(offConn.classList.contains("offline")).toBe(true);
    expect(offConn.textContent).toContain("offline");
  });
});
