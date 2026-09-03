import "@ui/support/setup.ts";
import { describe, expect, test } from "bun:test";

import {
  autocompletion,
  closeCompletion,
  completionStatus,
  moveCompletionSelection,
  selectedCompletionIndex,
} from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { FileExcerpt } from "@core/lib/types";
import {
  allowCompletionAccept,
  completionListPainted as painted,
  typeInto,
  until,
} from "@ui/support/helpers.ts";
import {
  completionPreview,
  createPreviewToggle,
  type PreviewableCompletion,
  type PreviewToggle,
  placePreview,
  previewShell,
  previewToggle,
  previewTooltipSpace,
  renderExcerptLines,
} from "$lib/completionPreview.ts";

// The Ctrl+Space preview's own module (EXC-1186): the session toggle, the shell
// of the accessory panel, and the renderer that fills it with a file's lines.
// All of it is plain state and plain DOM, so happy-dom exercises it fully. That
// the WINDOW opens beside a real list, on a real keypress, and lands on the right
// side of it is browser behaviour and lives in test/e2e/file-completion.e2e.ts.

describe("createPreviewToggle", () => {
  test("starts closed, so a list opens as it always did", () => {
    expect(createPreviewToggle().on()).toBe(false);
  });

  test("a toggle opens it and a second one closes it", () => {
    const toggle = createPreviewToggle();
    toggle.toggle();
    expect(toggle.on()).toBe(true);
    toggle.toggle();
    expect(toggle.on()).toBe(false);
  });

  test("stays open across reads, so the next list previews too", () => {
    const toggle = createPreviewToggle();
    toggle.toggle();
    expect(toggle.on()).toBe(true);
    expect(toggle.on()).toBe(true);
  });

  test("a fresh toggle neither reads from nor leaks into the module's", () => {
    // The seam that keeps a unit's state out of the app's — the same reason
    // `createSkillCache` sits beside `skillsFor`.
    const mine = createPreviewToggle();
    mine.toggle();
    expect(mine.on()).toBe(true);
    expect(previewToggle.on()).toBe(false);
  });
});

describe("previewShell", () => {
  test("the strips are inside the panel and start empty", () => {
    // The panel is built before the row's answer is known and filled in when the
    // read lands, so an empty shell is the state a reviewer actually sees first.
    const { dom, title, body } = previewShell();
    expect(dom.contains(title)).toBe(true);
    expect(dom.contains(body)).toBe(true);
    expect(title.textContent).toBe("");
    expect(body.textContent).toBe("");
  });

  test("the class names the stylesheet hangs off are what it builds", () => {
    // Pinned because the CSS lives in styles/atoms.css — the panel is mounted in
    // <body>, out of reach of any component or CodeMirror theme — so a rename here
    // silently unstyles it rather than failing anything.
    const { dom, title, body } = previewShell();
    expect(dom.className).toBe("caret-preview");
    expect(title.className).toBe("caret-preview-title");
    expect(body.className).toBe("caret-preview-body");
  });
});

describe("renderExcerptLines", () => {
  const EXCERPT: FileExcerpt = {
    path: "src/lib/foo.ts",
    language: "typescript",
    startLine: 40,
    endLine: 43,
    lines: ["const a = 1;", "  const b = 2;", "", "const c = 3;"],
    totalLines: 900,
  };

  /** Each rendered row as the reviewer reads it: its number and its source. */
  function rows(excerpt: FileExcerpt, mark?: number): Array<[string, string]> {
    const body = document.createElement("div");
    renderExcerptLines(body, excerpt, mark);
    return [...body.querySelectorAll(".caret-preview-line")].map((row) => [
      row.querySelector(".caret-preview-lineno")?.textContent ?? "",
      row.textContent?.slice(row.querySelector(".caret-preview-lineno")?.textContent?.length) ?? "",
    ]);
  }

  test("numbers run from the excerpt's own first line, not from one", () => {
    expect(rows(EXCERPT).map(([n]) => n)).toEqual(["40", "41", "42", "43"]);
  });

  test("each line's text is rendered as it is on disk, indentation included", () => {
    expect(rows(EXCERPT).map(([, text]) => text)).toEqual([
      "const a = 1;",
      "  const b = 2;",
      "",
      "const c = 3;",
    ]);
  });

  test("the cited line is the one that wears the mark", () => {
    const body = document.createElement("div");
    renderExcerptLines(body, EXCERPT, 42);
    const marked = [...body.querySelectorAll(".caret-preview-marked")];
    expect(marked).toHaveLength(1);
    expect(marked[0]?.querySelector(".caret-preview-lineno")?.textContent).toBe("42");
  });

  test("no cited line marks nothing", () => {
    const body = document.createElement("div");
    renderExcerptLines(body, EXCERPT);
    expect(body.querySelectorAll(".caret-preview-marked")).toHaveLength(0);
  });

  test("a cited line the excerpt does not reach marks nothing", () => {
    // Reachable: the daemon clamps a range that runs past the end of a file, so a
    // reviewer citing line 4000 of a 900-line file gets the file's tail back with
    // the line they named nowhere in it.
    const body = document.createElement("div");
    renderExcerptLines(body, EXCERPT, 4000);
    expect(body.querySelectorAll(".caret-preview-line")).toHaveLength(4);
    expect(body.querySelectorAll(".caret-preview-marked")).toHaveLength(0);
  });

  test("a line past the end of the file says so, rather than showing a tail unexplained", () => {
    const body = document.createElement("div");
    renderExcerptLines(body, EXCERPT, 4000);
    expect(body.querySelector(".caret-preview-note")?.textContent).toBe(
      "This file ends at line 900.",
    );
  });

  test("a line the file does reach adds no note", () => {
    const body = document.createElement("div");
    renderExcerptLines(body, EXCERPT, 42);
    expect(body.querySelector(".caret-preview-note")).toBeNull();
  });
});

/** An editor with the panel plugin installed, over `rows`. */
function mountCompletionPreview(
  rows: PreviewableCompletion[],
  toggle: PreviewToggle,
  showHints: () => boolean = () => true,
  timeoutMs?: number,
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({
    parent: host,
    root: document,
    state: EditorState.create({
      doc: "",
      extensions: [
        autocompletion({ override: [(ctx) => ({ from: ctx.pos, options: rows })] }),
        completionPreview(toggle, showHints, timeoutMs),
      ],
    }),
  });
  return {
    view,
    dispose: () => {
      view.destroy();
      host.remove();
    },
  };
}

// The panel itself, over a real painted list. It is a view plugin that mounts
// into <body>, so what it decides — whether a panel exists, what is in it, and
// which row it describes — is reachable here; only its PLACEMENT needs a browser
// that lays out, and that lives in test/e2e/file-completion.e2e.ts.
describe("the preview panel", () => {
  const ROWS: PreviewableCompletion[] = [
    {
      label: "src/alpha.ts",
      preview: {
        title: "src/alpha.ts",
        key: "alpha",
        fill: async (body) => {
          body.textContent = "const alpha = 1;";
        },
      },
    },
    {
      label: "src/beta.ts",
      preview: {
        title: "src/beta.ts",
        key: "beta",
        fill: async (body) => {
          body.textContent = "const beta = 2;";
        },
      },
    },
  ];

  /** An editor over `ROWS` with the panel plugin installed and nothing else, so
   * the plugin is what these assertions are about. */
  function mount(toggle: PreviewToggle, showHints: () => boolean = () => true) {
    return mountCompletionPreview(ROWS, toggle, showHints);
  }

  const panelIn = () => document.querySelector(".caret-preview");

  /** Flip the toggle the way the keybinding does — the flip changes no editor
   * state, so an empty transaction is what runs the update cycle behind it. */
  function flip(view: EditorView, toggle: PreviewToggle): void {
    toggle.toggle();
    view.dispatch({});
  }

  /** Mount over `ROWS`, type `@a`, and wait for the list to paint. */
  async function openedList(showHints?: () => boolean) {
    const toggle = createPreviewToggle();
    const { view, dispose } = mount(toggle, showHints);
    typeInto(view, "@a");
    expect(await until(() => painted(view))).toBe(true);
    return { view, toggle, dispose };
  }

  /** Mount over `ROWS`, type `@a`, and wait for the list to become active and
   * ready to accept a selection — what `moveCompletionSelection` needs. */
  async function openedActiveList() {
    const toggle = createPreviewToggle();
    const { view, dispose } = mount(toggle);
    typeInto(view, "@a");
    // A painted list is not yet a list `moveCompletionSelection` will act on: it
    // declines while the state is still pending, and again inside
    // autocomplete's own interaction delay — the guard against a keystroke in
    // flight landing on a list that just changed under it.
    expect(await until(() => completionStatus(view.state) === "active")).toBe(true);
    await allowCompletionAccept();
    return { view, toggle, dispose };
  }

  test("no window until the reviewer asks for one", async () => {
    const { dispose } = await openedList();
    try {
      expect(panelIn()).toBeNull();
    } finally {
      dispose();
    }
  });

  test("opens with the highlighted row's own answer in it, and closes again", async () => {
    const { view, toggle, dispose } = await openedList();
    try {
      flip(view, toggle);
      // The title is what the panel knows without asking; the answer arrives.
      expect(panelIn()?.textContent).toContain("src/alpha.ts");
      expect(await until(() => panelIn()?.textContent?.includes("const alpha = 1;") === true)).toBe(
        true,
      );

      flip(view, toggle);
      expect(panelIn()).toBeNull();
    } finally {
      dispose();
    }
  });

  test("opening it leaves the reviewer's place in the list alone", async () => {
    // The bug the panel exists to fix: the old panel was a row's
    // `Completion.info`, which repaints only on a re-query — and a re-query
    // restarts the list at its first row, throwing away the row that was asked
    // about.
    const { view, toggle, dispose } = await openedActiveList();
    try {
      moveCompletionSelection(true)(view);
      const before = selectedCompletionIndex(view.state);
      expect(before).toBe(1);

      flip(view, toggle);
      expect(selectedCompletionIndex(view.state)).toBe(before);
      expect(await until(() => panelIn()?.textContent?.includes("const beta = 2;") === true)).toBe(
        true,
      );
    } finally {
      dispose();
    }
  });

  test("follows the selection from row to row", async () => {
    const { view, toggle, dispose } = await openedActiveList();
    try {
      flip(view, toggle);
      expect(await until(() => panelIn()?.textContent?.includes("const alpha = 1;") === true)).toBe(
        true,
      );

      moveCompletionSelection(true)(view);
      expect(await until(() => panelIn()?.textContent?.includes("const beta = 2;") === true)).toBe(
        true,
      );
    } finally {
      dispose();
    }
  });

  test("goes away with the list it belongs to", async () => {
    const { view, toggle, dispose } = await openedList();
    try {
      flip(view, toggle);
      expect(panelIn()).not.toBeNull();

      closeCompletion(view);
      expect(await until(() => panelIn() === null)).toBe(true);
    } finally {
      dispose();
    }
  });

  test("a destroyed editor takes its panel with it", async () => {
    // It lives in <body>, not in the editor, so nothing removes it for free.
    const { view, toggle, dispose } = await openedList();
    flip(view, toggle);
    expect(panelIn()).not.toBeNull();
    dispose();
    expect(panelIn()).toBeNull();
  });

  test("the hint strip wears the chrome's keycaps and sits above the rows", async () => {
    // The reason it is a real element rather than generated content: `::before`
    // can draw a sentence but not a <kbd>, so the strip used to be the one
    // shortcut hint in the UI that looked nothing like the others.
    const { view, dispose } = await openedList();
    try {
      const tooltip = view.dom.querySelector(".cm-tooltip-autocomplete");
      expect(
        await until(() => tooltip?.firstElementChild?.className === "caret-completion-hint"),
      ).toBe(true);
      const caps = [...(tooltip?.querySelectorAll(".caret-completion-hint kbd") ?? [])];
      expect(caps.map((k) => k.textContent)).toEqual(["Ctrl", "Space"]);
      expect(caps.every((k) => k.getAttribute("data-slot") === "kbd")).toBe(true);
      expect(tooltip?.querySelector(".caret-completion-hint")?.textContent).toContain("to preview");
    } finally {
      dispose();
    }
  });

  test("with the panel open the strip names the way back out", async () => {
    const { view, toggle, dispose } = await openedList();
    try {
      flip(view, toggle);
      const hint = () => view.dom.querySelector(".caret-completion-hint")?.textContent ?? "";
      expect(await until(() => hint().includes("close"))).toBe(true);
    } finally {
      dispose();
    }
  });

  test("waits for the list to be placed rather than pinning itself to the top", async () => {
    // CodeMirror parks a tooltip it has not positioned yet far above the viewport
    // (`top: -10000px`), and every measure request's read runs before any of
    // their writes — so the panel's first read of a list is always of a parked
    // rect. Placing against it put the panel at the top of the screen with the
    // list halfway down, which is what a reviewer saw on every `@` once the
    // toggle started persisting.
    const { view, toggle, dispose } = await openedList();
    try {
      const tooltip = view.dom.querySelector<HTMLElement>(".cm-tooltip-autocomplete");
      if (tooltip === null) throw new Error("expected a painted list");
      const parked = new DOMRect(0, -10000, 200, 300);
      tooltip.getBoundingClientRect = () => parked;

      flip(view, toggle);
      const hidden = () => (panelIn() as HTMLElement | null)?.style.visibility === "hidden";
      expect(await until(hidden)).toBe(true);

      // Once the tooltip lands, so does the panel. WHERE it lands is
      // `placePreview`'s arithmetic above — happy-dom lays nothing out, so the
      // viewport it would be placed within is zero by zero here.
      const placed = new DOMRect(40, 120, 200, 300);
      tooltip.getBoundingClientRect = () => placed;
      view.dispatch({});
      expect(await until(() => !hidden())).toBe(true);
    } finally {
      dispose();
    }
  });

  test("shortcut hints off takes the strip away and leaves the shortcut", async () => {
    // The preference hides the AFFORDANCE, never the key.
    const { view, toggle, dispose } = await openedList(() => false);
    try {
      flip(view, toggle);
      expect(view.dom.querySelector(".caret-completion-hint")).toBeNull();
      expect(panelIn()).not.toBeNull();
    } finally {
      dispose();
    }
  });
});

// What the panel shows BETWEEN the row changing and its answer landing. The
// answer is a round trip on every source, so the in-between is a state a reviewer
// arrowing down a list sees on every single row — a blank body there is the
// flicker, and the staging below is what removes it.
describe("the preview panel while an answer is in flight", () => {
  /** A row whose answer lands only when the returned `land` is called. */
  function heldRow(label: string, text: string) {
    let land = (): void => {};
    let aborted = false;
    const row: PreviewableCompletion = {
      label,
      preview: {
        title: label,
        key: label,
        fill: (body, signal) =>
          new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve();
            });
            land = () => {
              body.textContent = text;
              resolve();
            };
          }),
      },
    };
    return { row, land: () => land(), aborted: () => aborted };
  }

  function mountOver(rows: PreviewableCompletion[], toggle: PreviewToggle, timeoutMs?: number) {
    return mountCompletionPreview(rows, toggle, () => true, timeoutMs);
  }

  const panelIn = () => document.querySelector(".caret-preview");
  const bodyIn = () => document.querySelector(".caret-preview-body");

  async function openOver(
    rows: PreviewableCompletion[],
    toggle: PreviewToggle,
    timeoutMs?: number,
  ) {
    const mounted = mountOver(rows, toggle, timeoutMs);
    typeInto(mounted.view, "@a");
    expect(await until(() => painted(mounted.view))).toBe(true);
    toggle.toggle();
    mounted.view.dispatch({});
    return mounted;
  }

  /** Open the panel over a slow row and wait for its loading indicator. */
  async function openLoadingSlowRow() {
    const held = heldRow("src/slow.ts", "const slow = 1;");
    const toggle = createPreviewToggle();
    const { dispose } = await openOver([held.row], toggle);
    expect(await until(() => bodyIn()?.querySelector(".caret-preview-loading") !== null)).toBe(
      true,
    );
    return { held, dispose };
  }

  test("a pending answer shows the loading indicator rather than an empty body", async () => {
    const { dispose } = await openLoadingSlowRow();
    try {
      // And the title is already right, so the panel names what it is fetching.
      expect(panelIn()?.textContent).toContain("src/slow.ts");
    } finally {
      dispose();
    }
  });

  test("the answer replaces the indicator when it lands", async () => {
    const { held, dispose } = await openLoadingSlowRow();
    try {
      held.land();
      expect(await until(() => bodyIn()?.textContent === "const slow = 1;")).toBe(true);
      expect(bodyIn()?.querySelector(".caret-preview-loading")).toBeNull();
    } finally {
      dispose();
    }
  });

  test("an answer that never lands times out into a sentence", async () => {
    const held = heldRow("src/never.ts", "unreachable");
    const toggle = createPreviewToggle();
    const { dispose } = await openOver([held.row], toggle, 10);
    try {
      expect(await until(() => bodyIn()?.textContent === "No information found.")).toBe(true);
    } finally {
      dispose();
    }
  });

  test("a fill that writes nothing is the same answer as none at all", async () => {
    const silent: PreviewableCompletion = {
      label: "src/empty.ts",
      preview: { title: "src/empty.ts", key: "empty", fill: async () => {} },
    };
    const toggle = createPreviewToggle();
    const { dispose } = await openOver([silent], toggle);
    try {
      expect(await until(() => bodyIn()?.textContent === "No information found.")).toBe(true);
    } finally {
      dispose();
    }
  });

  test("a fill that rejects says so rather than throwing into CodeMirror", async () => {
    const broken: PreviewableCompletion = {
      label: "src/boom.ts",
      preview: {
        title: "src/boom.ts",
        key: "boom",
        fill: () => Promise.reject(new Error("nope")),
      },
    };
    const toggle = createPreviewToggle();
    const { dispose } = await openOver([broken], toggle);
    try {
      expect(await until(() => bodyIn()?.textContent === "No information found.")).toBe(true);
    } finally {
      dispose();
    }
  });

  test("arrowing on aborts the read the reviewer left behind", async () => {
    // The reason `fill` is handed a signal at all: a reply arriving after the
    // reviewer has moved must neither be waited for nor painted.
    const first = heldRow("src/one.ts", "const one = 1;");
    const second = heldRow("src/two.ts", "const two = 2;");
    const toggle = createPreviewToggle();
    const { view, dispose } = await openOver([first.row, second.row], toggle);
    try {
      expect(await until(() => completionStatus(view.state) === "active")).toBe(true);
      await allowCompletionAccept();
      moveCompletionSelection(true)(view);
      expect(await until(() => first.aborted())).toBe(true);

      // The abandoned answer landing late writes nothing.
      first.land();
      second.land();
      expect(await until(() => bodyIn()?.textContent === "const two = 2;")).toBe(true);
    } finally {
      dispose();
    }
  });

  test("closing the panel aborts the read under it", async () => {
    const held = heldRow("src/slow.ts", "const slow = 1;");
    const toggle = createPreviewToggle();
    const { view, dispose } = await openOver([held.row], toggle);
    try {
      expect(await until(() => bodyIn() !== null)).toBe(true);
      toggle.toggle();
      view.dispatch({});
      expect(await until(() => held.aborted())).toBe(true);
      expect(panelIn()).toBeNull();
    } finally {
      dispose();
    }
  });
});

// Where the panel goes, as arithmetic rather than as layout: `placePreview` is
// pure over the list's rect and the viewport, so every case a reviewer can put
// the list in — a narrow window, a list against the bottom, a list against the
// right — is reachable here. That the browser then AGREES with this arithmetic is
// what test/e2e/file-completion.e2e.ts pins.
describe("placePreview", () => {
  const ROOM = { width: 1400, height: 900 };
  const WIDTH = 464;
  /** A list 200px wide and 300px tall, at (x, y). */
  const listAt = (x: number, y: number) => ({ left: x, right: x + 200, top: y, bottom: y + 300 });

  test("beside the list on the right when the room is there", () => {
    const spot = placePreview(listAt(300, 200), WIDTH, ROOM);
    expect(spot.left).toBe(508); // 300 + 200 + GAP
    expect(spot.top).toBe(200);
  });

  test("flips to the list's left when the right edge is too close", () => {
    const spot = placePreview(listAt(1100, 200), WIDTH, ROOM);
    expect(spot.left).toBe(628); // 1100 - GAP - 464
    expect(spot.top).toBe(200);
  });

  test("drops below the list when neither side will hold it", () => {
    // The window is narrower than list + panel either way round, so side by side
    // is not on offer at all and stacking is what is left.
    const narrow = { width: 700, height: 900 };
    const spot = placePreview(listAt(200, 100), WIDTH, narrow);
    expect(spot.top).toBe(408); // 100 + 300 + GAP
    expect(spot.left).toBe(200); // aligned with the list it belongs to
  });

  test("a stacked panel is pulled back inside the right edge", () => {
    const narrow = { width: 600, height: 900 };
    const spot = placePreview(listAt(300, 100), WIDTH, narrow);
    expect(spot.left).toBe(128); // 600 - GAP - 464
  });

  test("stacks ABOVE a list that is itself above the cursor", () => {
    // The direction follows the list rather than being re-decided, so the column
    // reads panel, list, the line being typed. Anchored by its BOTTOM, so it hugs
    // the list rather than flying to the top of the screen and leaving the gap
    // between them for the answer to fill.
    const narrow = { width: 600, height: 900 };
    const spot = placePreview(listAt(200, 560), WIDTH, narrow, true);
    expect(spot.top).toBeUndefined();
    expect(spot.bottom).toBe(348); // 900 - (560 - GAP)
    expect(spot.maxHeight).toBe(544); // up to the list's own top, less both gaps
  });

  test("stays BELOW a list below the cursor, however little room is left there", () => {
    // Not "wherever there is more of it": above is roomier here, but it is also
    // the far side of the line the reviewer is typing on, which would read as two
    // unrelated panels. `previewTooltipSpace` is what guarantees the room below —
    // the list was shrunk to leave it.
    const narrow = { width: 600, height: 900 };
    const spot = placePreview(listAt(200, 560), WIDTH, narrow, false);
    expect(spot.bottom).toBeUndefined();
    expect(spot.top).toBe(868);
  });

  test("a panel stacked below is anchored by its top, not its bottom", () => {
    const narrow = { width: 700, height: 900 };
    const spot = placePreview(listAt(200, 100), WIDTH, narrow);
    expect(spot.bottom).toBeUndefined();
    expect(spot.top).toBe(408);
  });

  test("beside beats stacked, whichever side the list took", () => {
    // A list above the cursor in a wide enough window still gets its panel
    // alongside; the flip only decides how a STACK is ordered.
    const spot = placePreview(listAt(300, 200), WIDTH, ROOM, true);
    expect(spot.left).toBe(508);
    expect(spot.top).toBe(200);
  });

  test("a list against the bottom keeps the panel on screen", () => {
    const spot = placePreview(listAt(300, 860), WIDTH, ROOM);
    expect(spot.top).toBe(796); // clamped so MIN_HEIGHT still fits below it
    expect(spot.maxHeight).toBe(96);
  });

  test("the height it may take is always what is left under it", () => {
    const spot = placePreview(listAt(300, 200), WIDTH, ROOM);
    expect((spot.top ?? 0) + spot.maxHeight).toBe(ROOM.height - 8);
  });

  test("never places the panel off the left edge", () => {
    const spot = placePreview(listAt(0, 100), WIDTH, { width: 500, height: 900 });
    expect(spot.left).toBeGreaterThanOrEqual(8);
  });
});

// What moves the completion LIST out of the panel's way. CodeMirror flips a
// tooltip above the cursor when it will not fit below within the space it is
// given, and re-reads that space on every measure — so keeping the panel's floor
// out of it is what makes a list opened near the foot of the window rise above
// the line being typed.
describe("previewTooltipSpace", () => {
  const ROOM = { width: 1400, height: 900 };

  test("with no panel open it is the viewport, exactly as CodeMirror's own default", () => {
    expect(previewTooltipSpace(ROOM, false)).toEqual({
      top: 0,
      left: 0,
      right: 1400,
      bottom: 900,
    });
  });

  test("an open panel keeps its own floor out of the list's reach, at BOTH ends", () => {
    // MIN_HEIGHT plus a gap either side — the least a stacked panel would need —
    // and taken off each end, because the list may take either. CodeMirror shrinks
    // a tooltip to the space it is given, so the list stops that far short of the
    // edge and the panel gets exactly the floor it needs beyond it.
    expect(previewTooltipSpace(ROOM, true)).toEqual({
      top: 112,
      left: 0,
      right: 1400,
      bottom: 788,
    });
  });

  test("the same slice off each end, so the tie-break is left where it was", () => {
    // Reserving only one end would tilt CodeMirror's "where is there more room"
    // comparison toward the other, which is not this feature's decision to make.
    const open = previewTooltipSpace(ROOM, true);
    const shut = previewTooltipSpace(ROOM, false);
    expect(open.top - shut.top).toBe(shut.bottom - open.bottom);
  });
});
