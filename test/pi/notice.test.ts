import { describe, expect, test } from "bun:test";

import { type Component, type TuiMouseEvent, visibleWidth } from "@earendil-works/pi-tui";

import type { DetachedSpawn } from "@oc/review-bridge.ts";
import {
  installNotice,
  type NoticeApi,
  type NoticeContext,
  type NoticeTheme,
  noticeLine,
} from "@piext/notice.ts";
import { createReviewStore, footerText, type ReviewOutcome } from "@piext/state.ts";

const URL = "http://caret.localhost:42718/review/abc";
const tagTheme: NoticeTheme = { fg: (c, t) => `<${c}>${t}</${c}>`, bold: (t) => `<b>${t}</b>` };
const plainTheme: NoticeTheme = { fg: (_c, t) => t, bold: (t) => t };

type WidgetContent = Parameters<NoticeContext["ui"]["setWidget"]>[1];
type WidgetFactory = (tui: unknown, theme: NoticeTheme) => Component;

function fakeCtx(mode: NoticeContext["mode"] = "tui", hasUI = mode === "tui" || mode === "rpc") {
  const widgets: WidgetContent[] = [];
  const statuses: (string | undefined)[] = [];
  const notes: { message: string; type?: string }[] = [];
  const ctx: NoticeContext = {
    mode,
    hasUI,
    ui: {
      notify: (message, type) => notes.push({ message, type }),
      setStatus: (_key, text) => statuses.push(text),
      setWidget: ((_key: string, content: WidgetContent) =>
        widgets.push(content)) as NoticeContext["ui"]["setWidget"],
    },
    sessionManager: { getSessionId: () => "s1" },
  };
  return { ctx, widgets, statuses, notes };
}

function fakeApi() {
  const handlers: Record<string, (...a: unknown[]) => unknown> = {};
  const commands: Record<string, (args: string, ctx: NoticeContext) => Promise<void>> = {};
  const shortcuts: Record<string, (ctx: NoticeContext) => void> = {};
  const api: NoticeApi = {
    on: ((event: string, handler: (...a: unknown[]) => unknown) => {
      handlers[event] = handler;
    }) as NoticeApi["on"],
    registerCommand: (name, { handler }) => {
      commands[name] = handler;
    },
    registerShortcut: (key, { handler }) => {
      shortcuts[key] = handler;
    },
  };
  return { api, handlers, commands, shortcuts };
}

function setup(mode?: NoticeContext["mode"], hasUI?: boolean) {
  const store = createReviewStore();
  const spawns: { bin: string; args: string[] }[] = [];
  let failWith: Error | undefined;
  const spawn: DetachedSpawn = (bin, args, onError) => {
    spawns.push({ bin, args });
    if (failWith) onError(failWith);
  };
  const api = fakeApi();
  installNotice(api.api, { store, bin: "/bin/caret", spawn });
  const c = fakeCtx(mode, hasUI);
  const start = () => api.handlers.session_start?.({}, c.ctx);
  return { store, spawns, ...api, ...c, start, fail: (e: Error) => (failWith = e) };
}

const lastWidget = (widgets: WidgetContent[]) => widgets[widgets.length - 1];
const mount = (widgets: WidgetContent[], theme = tagTheme) =>
  (lastWidget(widgets) as WidgetFactory)(undefined, theme);

const mouse = (
  type: TuiMouseEvent["type"],
  button: TuiMouseEvent["button"] = "left",
): TuiMouseEvent => ({
  type,
  button,
  x: 3,
  y: 0,
  screenX: 3,
  screenY: 20,
  width: 80,
  height: 1,
  shift: false,
  alt: false,
  ctrl: false,
});

describe("the pending notice in tui mode", () => {
  test("a waiting review sets the footer status and a themed one-line row", () => {
    const s = setup();
    s.start();
    s.store.update("s1", { pending: URL });
    expect(s.statuses.at(-1)).toBe(footerText({ pending: URL, planning: false }));
    expect(typeof lastWidget(s.widgets)).toBe("function");
    const lines = mount(s.widgets).render(80);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line).toMatch(
      /^ <warning>\^<\/warning> <muted>caret<\/muted> {2}<b><text>[^<]+<\/text><\/b> +<dim>ctrl\+alt\+c<\/dim> <muted>[^<]+<\/muted> $/,
    );
    expect(line).not.toContain("\u001b");
  });

  for (const lastOutcome of ["approved", "changes", "cancelled", "failed"] as ReviewOutcome[]) {
    test(`a review ending ${lastOutcome} clears the row and the status`, () => {
      const s = setup();
      s.start();
      s.store.update("s1", { pending: URL });
      s.store.update("s1", { pending: undefined, lastOutcome });
      expect(lastWidget(s.widgets)).toBeUndefined();
      expect(s.statuses.at(-1)).toBeUndefined();
    });
  }

  test("planning with nothing waiting shows the planning status and no row", () => {
    const s = setup();
    s.start();
    s.store.update("s1", { planning: true });
    expect(s.statuses.at(-1)).toBe(footerText({ planning: true }));
    expect(lastWidget(s.widgets)).toBeUndefined();
  });

  test("a session that starts with a review already waiting paints at once", () => {
    const s = setup();
    s.store.update("s1", { pending: URL });
    s.start();
    expect(typeof lastWidget(s.widgets)).toBe("function");
    expect(s.statuses.at(-1)).toBe(footerText({ pending: URL, planning: false }));
  });

  test("another session's update paints nothing", () => {
    const s = setup();
    s.start();
    const before = s.statuses.length;
    s.store.update("s2", { pending: URL });
    expect(s.statuses.length).toBe(before);
    expect(s.widgets.length).toBe(before);
  });

  test("after session_shutdown, updates paint nothing", () => {
    const s = setup();
    s.start();
    s.handlers.session_shutdown?.();
    const before = s.statuses.length;
    s.store.update("s1", { pending: URL });
    expect(s.statuses.length).toBe(before);
  });

  test("a reload leaves one live subscription", () => {
    const s = setup();
    s.start();
    s.handlers.session_shutdown?.();
    const next = fakeApi();
    installNotice(next.api, { store: s.store, bin: "/bin/caret", spawn: () => {} });
    const c = fakeCtx();
    next.handlers.session_start?.({}, c.ctx);
    const before = s.statuses.length + c.statuses.length;
    s.store.update("s1", { pending: URL });
    expect(s.statuses.length + c.statuses.length).toBe(before + 1);
  });

  test("the row repaints in the current theme after invalidate", () => {
    const s = setup();
    s.start();
    s.store.update("s1", { pending: URL });
    let currentTheme = tagTheme;
    const liveTheme: NoticeTheme = {
      fg: (c, t) => currentTheme.fg(c, t),
      bold: (t) => currentTheme.bold(t),
    };
    const row = mount(s.widgets, liveTheme);
    expect(row.render(80)[0]).toContain("<warning>^</warning>");
    currentTheme = { fg: (c, t) => `[${c}]${t}[/${c}]`, bold: (t) => `[b]${t}[/b]` };
    row.invalidate();
    expect(row.render(80)[0]).toContain("[warning]^[/warning]");
  });

  test("only a left click on the row opens the review", () => {
    const s = setup();
    s.start();
    s.store.update("s1", { pending: URL });
    const row = mount(s.widgets);
    for (const e of [
      mouse("press"),
      mouse("release"),
      mouse("drag"),
      mouse("move"),
      mouse("click", "right"),
    ]) {
      expect(row.handleMouse?.(e)).toBeUndefined();
    }
    expect(s.spawns).toHaveLength(0);
    expect(row.handleMouse?.(mouse("click"))).toEqual({ handled: true });
    expect(s.spawns).toHaveLength(1);
  });
});

describe("noticeLine", () => {
  for (const width of [20, 40, 80, 120]) {
    test(`fits within ${width} columns`, () => {
      expect(visibleWidth(noticeLine(plainTheme, width))).toBeLessThanOrEqual(width);
    });
  }

  test("shows the key and its verb when there is room", () => {
    expect(noticeLine(plainTheme, 80)).toContain("ctrl+alt+c open in browser");
  });

  test("drops the key and its verb when there is not", () => {
    expect(noticeLine(plainTheme, 20)).not.toContain("ctrl+alt+c");
  });
});

describe("other modes", () => {
  test("rpc mode gets a plain one-line widget", () => {
    const s = setup("rpc");
    s.start();
    s.store.update("s1", { pending: URL });
    expect(lastWidget(s.widgets)).toEqual([
      "^ caret  plan waiting for your review   /caret open in browser",
    ]);
  });

  for (const mode of ["print", "json"] as const) {
    test(`${mode} mode paints nothing`, () => {
      const s = setup(mode, false);
      s.start();
      s.store.update("s1", { pending: URL });
      expect(s.widgets).toHaveLength(0);
      expect(s.statuses).toHaveLength(0);
    });
  }
});

describe("opening the review", () => {
  const expected = {
    bin: "/bin/caret",
    args: ["band-link", "--session", "s1", "--open"],
  };

  test("/caret opens the session's review", async () => {
    const s = setup();
    await s.commands.caret?.("", s.ctx);
    expect(s.spawns).toEqual([expected]);
  });

  test("ctrl+alt+c opens the session's review", () => {
    const s = setup();
    expect(Object.keys(s.shortcuts)).toEqual(["ctrl+alt+c"]);
    s.shortcuts["ctrl+alt+c"]?.(s.ctx);
    expect(s.spawns).toEqual([expected]);
  });

  test("a failed open notifies with a doctor hint", async () => {
    const s = setup();
    s.fail(new Error("spawn ENOENT"));
    await expect(s.commands.caret?.("", s.ctx)).resolves.toBeUndefined();
    expect(s.notes).toEqual([
      { message: "caret: open failed: spawn ENOENT. Run caret doctor to see why.", type: "error" },
    ]);
  });

  test("a failure reported after the session went stale does not throw", async () => {
    const s = setup();
    let report: (() => void) | undefined;
    const api = fakeApi();
    installNotice(api.api, {
      store: s.store,
      bin: "/bin/caret",
      spawn: (_bin, _args, onError) => {
        report = () => onError(new Error("exited with status 1"));
      },
    });
    const stale = {
      ...s.ctx,
      get ui(): NoticeContext["ui"] {
        throw new Error("This extension ctx is stale");
      },
    };
    await api.commands.caret?.("", stale);
    expect(() => report?.()).not.toThrow();
  });
});
