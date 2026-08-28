import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import type { UpdateReport, UpdateStatus } from "@core/lib/types";
import { isUpdatePending, updatePaneCopy, updateSignature, updateToast } from "$lib/updates.ts";

// EXC-1207. The verdict→presentation mapping every update surface renders, so the
// toast, the two badges, and the pane can never disagree about what one status means.
// Pure and node-free: nothing here mounts, fetches, or reads storage.

const report = (status: UpdateStatus, over: Partial<UpdateReport> = {}): UpdateReport => ({
  install: "binary",
  version: "1.4.0",
  commit: "abc1234",
  status,
  ...over,
});

const RELEASE: UpdateStatus = {
  kind: "behind-release",
  available: "1.5.0",
  command: "bunx --no-cache @macintacos/caret@latest install --refresh",
};
const COMMIT: UpdateStatus = {
  kind: "behind-commit",
  aheadBy: 3,
  command: "mise run build --install",
};
const QUIET: UpdateStatus[] = [
  { kind: "current" },
  { kind: "unavailable", reason: "dev" },
  { kind: "unavailable", reason: "disabled" },
  { kind: "unknown", reason: "could not compare this build against trunk" },
];

describe("isUpdatePending", () => {
  test("only the two behind-* verdicts are pending", () => {
    expect(isUpdatePending(RELEASE)).toBe(true);
    expect(isUpdatePending(COMMIT)).toBe(true);
    for (const status of QUIET) expect(isUpdatePending(status)).toBe(false);
  });
});

describe("updateSignature", () => {
  test("a release is identified by the version that is available", () => {
    expect(updateSignature(RELEASE)).toBe("release:1.5.0");
  });

  test("a commit verdict is identified by how far behind it is", () => {
    // aheadBy is the honest identity: it is what moves when something newer lands,
    // and the daemon's 24h throttle bounds how often it can.
    expect(updateSignature(COMMIT)).toBe("commit:3");
    expect(updateSignature({ ...COMMIT, aheadBy: 4 })).toBe("commit:4");
  });

  test("a verdict with nothing to announce has no signature", () => {
    for (const status of QUIET) expect(updateSignature(status)).toBeNull();
  });

  test("two different available releases never share a signature", () => {
    expect(updateSignature(RELEASE)).not.toBe(updateSignature({ ...RELEASE, available: "1.6.0" }));
  });
});

describe("updateToast", () => {
  test("a newer release names the version and what is running", () => {
    const toast = updateToast(report(RELEASE));
    expect(toast?.title).toBeTruthy();
    expect(toast?.message).toContain("1.5.0");
    expect(toast?.message).toContain("1.4.0");
  });

  test("a commit verdict names the distance, pluralized", () => {
    expect(updateToast(report(COMMIT))?.message).toContain("3 commits");
    expect(updateToast(report({ ...COMMIT, aheadBy: 1 }))?.message).toContain("1 commit");
    expect(updateToast(report({ ...COMMIT, aheadBy: 1 }))?.message).not.toContain("1 commits");
  });

  test("a quiet verdict raises no toast", () => {
    for (const status of QUIET) expect(updateToast(report(status))).toBeNull();
  });

  test("never renders the upgrade command — that is the pane's job", () => {
    expect(updateToast(report(RELEASE))?.message).not.toContain("bunx");
  });
});

describe("updatePaneCopy", () => {
  test("a newer release leads with the available version and carries the command verbatim", () => {
    const copy = updatePaneCopy(report(RELEASE));
    expect(copy.headline).toContain("1.5.0");
    expect(copy.detail).toContain("1.4.0");
    expect(copy.command).toBe(RELEASE.command);
  });

  test("a commit verdict leads with the distance and carries its own command", () => {
    const copy = updatePaneCopy(report(COMMIT));
    expect(copy.headline).toContain("3 commits");
    expect(copy.command).toBe(COMMIT.command);
    expect(updatePaneCopy(report({ ...COMMIT, aheadBy: 1 })).headline).toContain("1 commit");
  });

  test("an up-to-date caret says so and offers no command", () => {
    const copy = updatePaneCopy(report({ kind: "current" }));
    expect(copy.headline).toBeTruthy();
    expect(copy.detail).toContain("1.4.0");
    expect(copy.command).toBeNull();
  });

  test("the two unavailable reasons read differently, and neither reads as a failure", () => {
    const dev = updatePaneCopy(report({ kind: "unavailable", reason: "dev" }, { install: "dev" }));
    const off = updatePaneCopy(report({ kind: "unavailable", reason: "disabled" }));
    expect(dev.headline).not.toBe(off.headline);
    for (const copy of [dev, off]) {
      expect(copy.command).toBeNull();
      expect(`${copy.headline} ${copy.detail}`.toLowerCase()).not.toContain("fail");
    }
  });

  test("a `disabled` verdict read while the switch is back ON says the check resumes", () => {
    // The daemon decides `disabled` once, at boot, and holds it for its whole life — so
    // after the reviewer turns the switch back on, the verdict is stale. Telling them to
    // "turn it back on" six pixels above a switch that already reads on is the one thing
    // this copy must not do.
    const off = updatePaneCopy(report({ kind: "unavailable", reason: "disabled" }), false);
    const backOn = updatePaneCopy(report({ kind: "unavailable", reason: "disabled" }), true);
    expect(off.detail).not.toBe(backOn.detail);
    expect(backOn.detail.toLowerCase()).toContain("restart");
    expect(off.detail.toLowerCase()).not.toContain("restart");
  });

  test("checkEnabled changes nothing for any other verdict", () => {
    // It is a `disabled`-only correction, not a second axis through the whole mapping.
    for (const status of [RELEASE, COMMIT, { kind: "current" } as UpdateStatus]) {
      expect(updatePaneCopy(report(status), true)).toEqual(updatePaneCopy(report(status), false));
    }
  });

  test("the uncomparable-build reason is framed as normal for a local build", () => {
    // This is the DAILY reading on a developer's machine, not a rare failure: a local
    // build bakes in an unpushed commit, GitHub's compare 404s, and the verdict settles
    // here. The copy has to say that is normal rather than implying something broke.
    const copy = updatePaneCopy(
      report({ kind: "unknown", reason: "could not compare this build against trunk" }),
    );
    expect(copy.detail.toLowerCase()).toContain("locally");
    expect(copy.command).toBeNull();
    expect(`${copy.headline} ${copy.detail}`.toLowerCase()).not.toContain("error");
    expect(`${copy.headline} ${copy.detail}`.toLowerCase()).not.toContain("fail");
  });

  test("any other unknown reason surfaces the daemon's own sentence", () => {
    // Every reason but the compare one is a genuine "could not tell", and the daemon's
    // own wording says which — flattening them all into one line would hide the case.
    const copy = updatePaneCopy(
      report({ kind: "unknown", reason: "could not reach npm for the published version" }),
    );
    expect(copy.detail).toContain("reach npm for the published version");
    expect(copy.command).toBeNull();
  });

  test("every status kind yields a non-empty headline and detail", () => {
    for (const status of [RELEASE, COMMIT, ...QUIET]) {
      const copy = updatePaneCopy(report(status));
      expect(copy.headline.length, status.kind).toBeGreaterThan(0);
      expect(copy.detail.length, status.kind).toBeGreaterThan(0);
    }
  });

  test("never derives a command — only a status that carries one gets one", () => {
    for (const status of QUIET) expect(updatePaneCopy(report(status)).command).toBeNull();
  });
});
