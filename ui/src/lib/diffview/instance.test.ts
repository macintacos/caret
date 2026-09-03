import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import {
  createDiffViewLifecycle,
  type DiffViewInstance,
  type DiffViewSyncProps,
} from "$lib/diffview/instance.ts";

// The lifecycle contract under a recording fake factory: one instance per
// content identity, option updates as full-replacement setOptions + rerender,
// annotation updates as setLineAnnotations + rerender, cleanUp on teardown.
// The components exercise the same contract against the real library in their
// own suites; this one pins the call protocol deterministically.

interface FakeOptions {
  overflow?: string;
  diffStyle?: string;
}
interface FakeAnnotation {
  lineNumber: number;
}
interface FakeContent {
  file: { name: string };
}

interface Call {
  method:
    | "render"
    | "setOptions"
    | "setLineAnnotations"
    | "rerender"
    | "onThemeChange"
    | "setSelectedLines"
    | "cleanUp";
  args: unknown[];
}

interface FakeInstance extends DiffViewInstance<FakeOptions, FakeAnnotation, FakeContent> {
  createdWith: FakeOptions;
  calls: Call[];
}

// Explicit type arguments: inferring TContent from the fake's render() param
// (an intersection type) would widen it to the whole intersection.
const makeLifecycle = (factory: { create: (options: FakeOptions) => FakeInstance }) =>
  createDiffViewLifecycle<FakeOptions, FakeAnnotation, FakeContent>({ create: factory.create });

function makeFactory() {
  const instances: FakeInstance[] = [];
  const create = (options: FakeOptions): FakeInstance => {
    const calls: Call[] = [];
    const instance: FakeInstance = {
      createdWith: options,
      calls,
      render: (props) => {
        calls.push({ method: "render", args: [props] });
        return true;
      },
      setOptions: (next) => calls.push({ method: "setOptions", args: [next] }),
      setLineAnnotations: (annotations) =>
        calls.push({ method: "setLineAnnotations", args: [annotations] }),
      rerender: () => calls.push({ method: "rerender", args: [] }),
      onThemeChange: () => calls.push({ method: "onThemeChange", args: [] }),
      setSelectedLines: (range, options) =>
        calls.push({ method: "setSelectedLines", args: [range, options] }),
      cleanUp: () => calls.push({ method: "cleanUp", args: [] }),
    };
    instances.push(instance);
    return instance;
  };
  return { instances, create };
}

const container = (): HTMLElement => document.createElement("div");

function props(
  over: Partial<DiffViewSyncProps<FakeOptions, FakeAnnotation, FakeContent>> = {},
): DiffViewSyncProps<FakeOptions, FakeAnnotation, FakeContent> {
  return {
    contentKey: "review-1:v1",
    container: container(),
    content: { file: { name: "plan.md" } },
    options: { overflow: "scroll" },
    ...over,
  };
}

describe("diff-view lifecycle mount", () => {
  test("first sync creates one instance and renders content into the container", () => {
    const factory = makeFactory();
    const lifecycle = makeLifecycle(factory);
    const p = props({ annotations: [{ lineNumber: 3 }] });
    lifecycle.sync(p);
    expect(factory.instances).toHaveLength(1);
    const [instance] = factory.instances;
    expect(instance!.createdWith).toBe(p.options);
    expect(instance!.calls).toEqual([
      {
        method: "render",
        args: [{ ...p.content, fileContainer: p.container, lineAnnotations: p.annotations }],
      },
    ]);
  });

  test("a no-op sync issues no instance calls", () => {
    const factory = makeFactory();
    const lifecycle = makeLifecycle(factory);
    const p = props();
    lifecycle.sync(p);
    const callsAfterMount = factory.instances[0]!.calls.length;
    lifecycle.sync(p);
    expect(factory.instances).toHaveLength(1);
    expect(factory.instances[0]!.calls).toHaveLength(callsAfterMount);
  });
});

describe("diff-view lifecycle updates preserve the instance", () => {
  /** A lifecycle with one annotation already synced (line 1) — the arrangement
   * shared by the cases below, which each apply their own next `sync`. */
  function withOneAnnotationSynced() {
    const factory = makeFactory();
    const lifecycle = makeLifecycle(factory);
    const p = props({ annotations: [{ lineNumber: 1 }] });
    lifecycle.sync(p);
    return { factory, lifecycle, p };
  }

  test("an option change replaces options wholesale (previous spread in) and repaints", () => {
    const factory = makeFactory();
    const lifecycle = makeLifecycle(factory);
    const p = props({ options: { overflow: "scroll", diffStyle: "split" } });
    lifecycle.sync(p);
    lifecycle.sync({ ...p, options: { overflow: "wrap" } });
    expect(factory.instances).toHaveLength(1);
    const updates = factory.instances[0]!.calls.slice(1);
    expect(updates).toEqual([
      { method: "setOptions", args: [{ overflow: "wrap", diffStyle: "split" }] },
      { method: "rerender", args: [] },
    ]);
  });

  test("an annotation change goes through setLineAnnotations and repaints", () => {
    const { factory, lifecycle, p } = withOneAnnotationSynced();
    const next = [{ lineNumber: 2 }];
    lifecycle.sync({ ...p, annotations: next });
    expect(factory.instances).toHaveLength(1);
    expect(factory.instances[0]!.calls.slice(1)).toEqual([
      { method: "setLineAnnotations", args: [next] },
      { method: "rerender", args: [] },
    ]);
  });

  test("clearing annotations passes an empty list", () => {
    const { factory, lifecycle, p } = withOneAnnotationSynced();
    lifecycle.sync({ ...p, annotations: undefined });
    expect(factory.instances[0]!.calls.slice(1)).toEqual([
      { method: "setLineAnnotations", args: [[]] },
      { method: "rerender", args: [] },
    ]);
  });

  test("options and annotations changing together repaint once", () => {
    const { factory, lifecycle, p } = withOneAnnotationSynced();
    lifecycle.sync({ ...p, options: { overflow: "wrap" }, annotations: [{ lineNumber: 2 }] });
    const rerenders = factory.instances[0]!.calls.filter((c) => c.method === "rerender");
    expect(factory.instances).toHaveLength(1);
    expect(rerenders).toHaveLength(1);
  });
});

describe("diff-view lifecycle recreation and teardown", () => {
  test("a content-key change tears down the old instance and renders a fresh one", () => {
    const factory = makeFactory();
    const lifecycle = makeLifecycle(factory);
    const p = props();
    lifecycle.sync(p);
    const nextContent = { file: { name: "plan-v2.md" } };
    lifecycle.sync({ ...p, contentKey: "review-1:v2", content: nextContent });
    expect(factory.instances).toHaveLength(2);
    expect(factory.instances[0]!.calls.at(-1)).toEqual({ method: "cleanUp", args: [] });
    expect(factory.instances[1]!.calls).toEqual([
      {
        method: "render",
        args: [{ ...nextContent, fileContainer: p.container, lineAnnotations: undefined }],
      },
    ]);
  });

  test("a content-key change clears the old instance's shadow DOM remnants", () => {
    const factory = makeFactory();
    const lifecycle = makeLifecycle(factory);
    const host = container();
    const shadow = host.attachShadow({ mode: "open" });
    shadow.appendChild(document.createElement("pre"));
    const p = props({ container: host });
    lifecycle.sync(p);
    lifecycle.sync({ ...p, contentKey: "review-1:v2" });
    expect(shadow.childNodes).toHaveLength(0);
  });

  test("destroy cleans up the instance and is idempotent", () => {
    const factory = makeFactory();
    const lifecycle = makeLifecycle(factory);
    lifecycle.sync(props());
    lifecycle.destroy();
    lifecycle.destroy();
    const cleanUps = factory.instances[0]!.calls.filter((c) => c.method === "cleanUp");
    expect(cleanUps).toHaveLength(1);
  });

  test("destroy before any sync is a no-op", () => {
    const factory = makeFactory();
    const lifecycle = makeLifecycle(factory);
    lifecycle.destroy();
    expect(factory.instances).toHaveLength(0);
  });
});

describe("diff-view lifecycle rehighlight", () => {
  test("rehighlight forces a fresh tokenization via the instance's theme-change hook", () => {
    const factory = makeFactory();
    const lifecycle = makeLifecycle(factory);
    lifecycle.sync(props());
    lifecycle.rehighlight();
    expect(factory.instances[0]!.calls.at(-1)).toEqual({ method: "onThemeChange", args: [] });
  });

  test("rehighlight before any sync is a no-op", () => {
    const factory = makeFactory();
    const lifecycle = makeLifecycle(factory);
    lifecycle.rehighlight();
    expect(factory.instances).toHaveLength(0);
  });
});

describe("diff-view lifecycle selection", () => {
  test("select forwards an ascending range to setSelectedLines as a quiet write", () => {
    const factory = makeFactory();
    const lifecycle = makeLifecycle(factory);
    lifecycle.sync(props());
    lifecycle.select({ start: 4, end: 8 });
    // notify:false keeps it a pure visual write — caret owns the readout, so the
    // library must not re-emit selection callbacks for caret's own write.
    expect(factory.instances[0]!.calls.at(-1)).toEqual({
      method: "setSelectedLines",
      args: [{ start: 4, end: 8 }, { notify: false }],
    });
  });

  test("select(null) clears the library selection", () => {
    const factory = makeFactory();
    const lifecycle = makeLifecycle(factory);
    lifecycle.sync(props());
    lifecycle.select(null);
    expect(factory.instances[0]!.calls.at(-1)).toEqual({
      method: "setSelectedLines",
      args: [null, { notify: false }],
    });
  });

  test("select before any sync is a no-op", () => {
    const factory = makeFactory();
    const lifecycle = makeLifecycle(factory);
    lifecycle.select({ start: 1, end: 2 });
    expect(factory.instances).toHaveLength(0);
  });
});
