// The Ctrl+Space completion preview (EXC-1186): the toggle that says whether a
// list is previewing, the hint strip that says the shortcut exists, and the
// accessory panel beside the list showing what the highlighted row actually is
// — a skill's own description, or a file's lines.
//
// The panel is caret's own element in `document.body`, NOT CodeMirror's
// `Completion.info`. Two reasons, each load-bearing:
//
//   * `info` renders INSIDE the completion tooltip, at `left: 100%`. Two of the
//     three editors that offer completion sit in a dialog whose body scrolls,
//     and a CSS `overflow-y: auto` forces the other axis to clip as well — so
//     there the panel was cut away entirely, with nothing to see.
//   * `CompletionTooltip.updateSel` re-evaluates `info` only when the selected
//     `<li>` ELEMENT changes. Toggling therefore had to be followed by a
//     re-query to repaint at all, and a re-query restarts the list at its first
//     row — so asking for a preview threw away the row it was asked about.
//
// Owning the panel instead means the toggle is read at RENDER time, the
// reviewer's place in the list is never disturbed, and no ancestor's overflow
// can hide it. `document.body` rather than the editor is what buys the last of
// those: the dialog centres itself with a `transform`, which would make it the
// containing block for a fixed child and clip it right back.
//
// The styling is global CSS (styles/atoms.css), not a CodeMirror `theme()`,
// because the panel is not inside the editor any more. The hint strip still is,
// so it stays in markdownEditor.ts's theme block — and its keycaps are the
// chrome's own `[data-slot="kbd"]` atom, so one shortcut hint is drawn one way
// across the whole UI.

import { type Completion, selectedCompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { type EditorView, tooltips, ViewPlugin } from "@codemirror/view";

import type { FileExcerpt } from "@core/lib/types";
import { readCompletionPreview, writeCompletionPreview } from "$lib/completionPreviewPref.ts";
import { keyCapsFor } from "$lib/shortcuts/keymap.ts";

/** Whether the completion list is showing its preview panel. Named so a source
 * can take one as a parameter and a unit can hand it one of its own. */
export interface PreviewToggle {
  on(): boolean;
  toggle(): void;
}

/**
 * A preview toggle over a stored answer.
 *
 * The panel is a mode the reviewer is in rather than a property of one list, so
 * the state outlives the list that opened it — and, through the persisted pair
 * the module instance below binds, the tab as well: a reviewer who turned the
 * panel on means it for the next `@` they type and for the one after a reload.
 *
 * The pair is parameters rather than a module read for the same reason
 * `createSkillCache` sits beside `skillsFor`: a unit gets an in-memory toggle by
 * default, which can neither be read from nor leak into the app's storage.
 *
 * @param read - The stored answer, consulted once per instance. Defaults to
 *   closed, so a unit's toggle starts where an unasked reviewer's does.
 * @param write - Where a flip is recorded. Defaults to nowhere.
 */
export function createPreviewToggle(
  read: () => boolean = () => false,
  write: (open: boolean) => void = () => {},
): PreviewToggle {
  let showing = read();
  return {
    on: () => showing,
    toggle() {
      showing = !showing;
      write(showing);
    },
  };
}

/** The one toggle the app reads: every feedback editor's list previews or does
 * not together, and the answer survives a reload. */
export const previewToggle: PreviewToggle = createPreviewToggle(
  readCompletionPreview,
  writeCompletionPreview,
);

/** What one completion row shows in the preview panel. */
export interface RowPreview {
  /** The strip above the body: the path, or the `/name`. */
  title: string;
  /** Identity of the answer this row would show. The panel refetches only when
   * it changes, so narrowing a query that leaves the highlighted row where it
   * was does not blank the panel on every keystroke. */
  key: string;
  /**
   * Fills `body` with the answer, resolving once there is something to show.
   *
   * `body` is a STAGING element, not the panel's own: the panel swaps it in
   * whole when this resolves, and shows a loading indicator until then. That is
   * what makes arrowing down a list read as one panel changing its contents
   * rather than as a panel blanking and refilling on every row.
   *
   * Resolving with nothing written is the same answer as not resolving at all —
   * the panel says so in a sentence. A source that KNOWS why it has nothing (a
   * file too large to send, a skill that describes itself nowhere) should write
   * that sentence itself and resolve; rejecting says only "no answer".
   *
   * `signal` aborts on the reviewer arrowing away or closing the panel, so a
   * slow read is neither waited for nor painted after they have moved.
   */
  fill: (body: HTMLElement, signal: AbortSignal) => Promise<void>;
}

/** A completion row that can describe itself in the preview panel.
 *
 * A field of caret's own rather than `Completion.info`, which CodeMirror would
 * answer by rendering its own panel inside the tooltip — the one this module
 * exists to replace. CodeMirror carries an unknown field through untouched, so
 * the row that comes back from `selectedCompletion` still has it. */
export interface PreviewableCompletion extends Completion {
  preview?: RowPreview;
}

/** How far the panel sits from the list, and from the viewport's edges. */
const GAP = 8;

/** The shortest the panel is ever squeezed to before it starts scrolling
 * inside. Bounding the height here rather than measuring the filled window is
 * what lets the placement run once, before the answer has landed: the content
 * arrives into a box whose limits are already decided. */
const MIN_HEIGHT = 96;

/** How long an answer has to land before the panel gives up on it. Generous:
 * every source degrades its own failures to a sentence and resolves, so reaching
 * this means a read that neither answered nor failed — and the reviewer is
 * looking at a spinner either way. */
const ANSWER_TIMEOUT_MS = 6000;

/** What the panel says when the answer neither landed nor explained itself. */
const NO_ANSWER = "No information found.";

/** How many frames the completion list has to stay put before the panel stops
 * following it. It has to outlast CodeMirror's own 50ms resize debounce, which is
 * when a tooltip that grew after being measured gets re-placed — ten frames is
 * ~160ms at 60Hz, and comfortably longer on a slower one. */
const STILL_FRAMES = 10;

/** A rectangle the panel is placed against — the completion list's, in viewport
 * coordinates. Structural rather than a `DOMRect`, so the geometry below can be
 * exercised without a browser that lays out. */
export interface ListRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The space the panel is placed within: the viewport, in CSS pixels. */
export interface Viewport {
  width: number;
  height: number;
}

/** Where the panel goes, in viewport coordinates.
 *
 * Exactly one of `top` and `bottom` is set. A panel that grows DOWNWARD from a
 * known edge is anchored by its top; one sitting above the list grows upward, and
 * anchoring that by its bottom is what keeps it hugging the list as its content
 * arrives — a top computed from a height not yet measured would leave the panel
 * stranded at the viewport's own edge with the gap between them for the answer to
 * fill. */
export interface PreviewSpot {
  left: number;
  top?: number;
  bottom?: number;
  /** The tallest the panel may be here. The body scrolls past it. */
  maxHeight: number;
}

/** Beside the list: vertically aligned with its top, pulled up far enough that
 * `MIN_HEIGHT` still fits under it. */
function alongside(list: ListRect, left: number, room: Viewport): PreviewSpot {
  const top = Math.min(Math.max(GAP, list.top), Math.max(GAP, room.height - GAP - MIN_HEIGHT));
  return { left: Math.max(GAP, left), top, maxHeight: room.height - top - GAP };
}

/**
 * Where the panel goes for a list at `list`, given its own `width` and the
 * viewport.
 *
 * Beside the list is the answer whenever it fits — right by preference, left when
 * the right edge is too close, which is what keeps the panel from being shoved
 * against the viewport's own edge on a list opened near it.
 *
 * When NEITHER side will hold it the panel stacks instead of squeezing: a window
 * narrow enough that a list and a panel cannot sit side by side is a window where
 * one over the other is the only honest layout, and half a panel clipped at the
 * edge is worse than a full one below.
 *
 * Which way it stacks is not re-decided here — it follows the LIST. CodeMirror
 * already chose a side of the cursor for the list by asking where there is more
 * room, and `previewTooltipSpace` kept the panel's own floor out of that answer,
 * so the far side of the list is both free and the only order that reads: panel,
 * list, the line being typed. Deciding independently would put the panel on the
 * other side of the cursor from the list it belongs to.
 *
 * @param listAbove - Whether CodeMirror put the list above the cursor line.
 */
export function placePreview(
  list: ListRect,
  width: number,
  room: Viewport,
  listAbove = false,
): PreviewSpot {
  const rightOf = list.right + GAP;
  if (rightOf + width <= room.width - GAP) return alongside(list, rightOf, room);
  const leftOf = list.left - GAP - width;
  if (leftOf >= GAP) return alongside(list, leftOf, room);

  // Stacked. Aligned with the list it belongs to, then pulled back inside the
  // right edge — the panel is wider than the list, so a list near that edge would
  // otherwise push it off.
  const left = Math.max(GAP, Math.min(list.left, room.width - GAP - width));
  if (listAbove) {
    return { left, bottom: room.height - (list.top - GAP), maxHeight: list.top - 2 * GAP };
  }
  return { left, top: list.bottom + GAP, maxHeight: room.height - list.bottom - 2 * GAP };
}

/**
 * The space CodeMirror lays its tooltips out in, with room kept at the bottom for
 * the preview panel while one is open.
 *
 * This is what moves the completion LIST out of the panel's way. CodeMirror flips
 * a tooltip above the cursor when it will not fit below within this space, and
 * every measure re-reads it — so reserving the panel's own floor at the bottom
 * makes a list opened near the foot of the window rise above the line being typed,
 * leaving the panel to stack over it. Without it the list sits at the bottom, the
 * panel has nowhere below it to go, and the only room left is at the top of the
 * screen — nowhere near the row it is describing.
 *
 * The TOP is kept back too, not just the bottom, and that symmetry is what makes
 * the rule hold whichever side the list ends up on. CodeMirror also SHRINKS a
 * tooltip to the space it is given, so a list that would have filled its side now
 * stops `MIN_HEIGHT` short of the edge — leaving the panel exactly the floor it
 * needs beyond it. Reserving only one end would tilt the "where is there more
 * room" tie-break toward the other, which is not this feature's decision to make;
 * taking the same slice off each leaves that comparison where CodeMirror would
 * have had it.
 *
 * Keyed on the panel merely being OPEN rather than on where the last placement
 * put it: the reservation would otherwise depend on a measurement that depends on
 * the reservation, and the two would chase each other. Open is also knowable on
 * the tooltip's FIRST measure, because the panel is created in the same update
 * that creates the list — which is the case the reviewer actually meets, a list
 * opened with the preview already on.
 *
 * `left`/`right` are the viewport's, exactly as CodeMirror's own default
 * (`windowSpace`) computes them.
 */
export function previewTooltipSpace(
  room: Viewport,
  open: boolean,
): { top: number; left: number; bottom: number; right: number } {
  const reserved = open ? MIN_HEIGHT + 2 * GAP : 0;
  return {
    top: reserved,
    left: 0,
    right: room.width,
    bottom: room.height - reserved,
  };
}

/** The panel's shell: a strip naming what is previewed, and an empty body for
 * the answer. Exported for the unit that pins the class names the stylesheet
 * hangs off — a rename here would silently unstyle the panel. */
export function previewShell(): { dom: HTMLElement; title: HTMLElement; body: HTMLElement } {
  const dom = document.createElement("div");
  dom.className = "caret-preview";
  dom.setAttribute("role", "note");
  const title = document.createElement("div");
  title.className = "caret-preview-title";
  const body = document.createElement("div");
  body.className = "caret-preview-body";
  dom.append(title, body);
  return { dom, title, body };
}

/** The placeholder a pending answer sits behind: three bars, pulsing. Wordless
 * and `aria-hidden`, because the title above it already names what is being
 * fetched and a screen reader has no use for a shimmer. The stylesheet delays its
 * fade-in, so an answer from a warm daemon never flashes it. */
function loadingBars(): HTMLElement {
  const bars = document.createElement("div");
  bars.className = "caret-preview-loading";
  bars.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i++) bars.append(document.createElement("span"));
  return bars;
}

/** The sentence a fill that answered nothing leaves behind. */
function noAnswer(): HTMLElement {
  const said = document.createElement("div");
  said.className = "caret-preview-note";
  said.textContent = NO_ANSWER;
  return said;
}

/**
 * Writes `excerpt`'s lines into `body`, numbered from the excerpt's own
 * `startLine`, with the row for `mark` — the line the reviewer cited — flagged
 * for the stylesheet to pick out.
 *
 * A `mark` past the end of the file gets a sentence of its own above the lines.
 * The daemon clamps such a panel to the file's tail, so what comes back is a
 * real excerpt that simply does not contain the cited line — and a tail drawn
 * with nothing marked and nothing said reads as a preview that went to the wrong
 * place. Saying where the file ends is the ordinary answer the reviewer can act
 * on, and the list keeps working either way.
 *
 * Each line's source goes into a span of its own, which is what the syntax
 * highlighter has to write into (fileCompletion.ts § paintHighlight): the
 * numbers are the gutter's and stay out of the grammar's reach.
 */
export function renderExcerptLines(body: HTMLElement, excerpt: FileExcerpt, mark?: number): void {
  if (mark !== undefined && mark > excerpt.totalLines) {
    const note = document.createElement("div");
    note.className = "caret-preview-note";
    note.textContent = `This file ends at line ${excerpt.totalLines}.`;
    body.append(note);
  }
  excerpt.lines.forEach((text, offset) => {
    const number = excerpt.startLine + offset;
    const row = document.createElement("div");
    row.className =
      number === mark ? "caret-preview-line caret-preview-marked" : "caret-preview-line";
    const gutter = document.createElement("span");
    gutter.className = "caret-preview-lineno";
    gutter.textContent = String(number);
    const code = document.createElement("span");
    code.className = "caret-preview-code";
    code.textContent = text;
    row.append(gutter, code);
    body.append(row);
  });
}

/** The hint strip's sentence, in the two states it has. The shortcut keeps
 * working with the strip gone, exactly as every other hint in the chrome does —
 * the preference hides the AFFORDANCE, never the key. */
function hintLabel(open: boolean): string {
  return open ? "to close the preview" : "to preview";
}

/** The hint strip: the chord's own caps, drawn as the chrome's keycaps, then what
 * it does. The caps come from the shortcut registry rather than a literal, so
 * what this strip shows and what the editor binds cannot drift apart. */
function hintStrip(open: boolean): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "caret-completion-hint";
  for (const chord of keyCapsFor("editor.previewCompletion")) {
    for (const cap of chord) {
      const kbd = document.createElement("kbd");
      kbd.setAttribute("data-slot", "kbd");
      kbd.className = "kbd-sm";
      kbd.textContent = cap;
      strip.append(kbd);
    }
  }
  const what = document.createElement("span");
  what.textContent = hintLabel(open);
  strip.append(what);
  return strip;
}

/** The id the panel carries so the highlighted row can point a screen reader at
 * it. One window per document, so one id is enough. */
const PANEL_ID = "caret-completion-preview";

/**
 * The preview panel and the hint strip, as one view plugin — plus the tooltip
 * space that keeps the completion list out of the panel's way.
 *
 * One plugin rather than two because both the panel and the strip hang off the
 * same completion tooltip and the same toggle: splitting them would mean two
 * plugins racing to find the same element on the same update, for two halves of
 * one affordance. The tooltip space rides along with it because it is a fact
 * about the panel — whether one is open — that only the plugin knows.
 *
 * The space configures `tooltipSpace` and nothing else. `position` and `parent`
 * are deliberately left alone: `completionListOpen` (editorCompletion.ts) finds
 * the list under `view.dom`, which holds only while no `tooltips({ parent })` is
 * configured anywhere in the stack.
 *
 * @param toggle - Whether the reviewer has the panel open.
 * @param showHints - Whether the hint strip is drawn at all. Read on every update
 *   rather than captured, so a change in Settings is picked up live.
 * @param timeoutMs - How long an answer has to land. A parameter only so a unit
 *   can reach the timed-out state without waiting the real budget out.
 */
export function completionPreview(
  toggle: PreviewToggle,
  showHints: () => boolean,
  timeoutMs: number = ANSWER_TIMEOUT_MS,
): Extension[] {
  const plugin = ViewPlugin.define((view) => new PreviewWindow(view, toggle, showHints, timeoutMs));
  return [
    plugin,
    tooltips({
      tooltipSpace: (view) => {
        const room = view.dom.ownerDocument.documentElement;
        return previewTooltipSpace(
          { width: room.clientWidth, height: room.clientHeight },
          view.plugin(plugin)?.isOpen() === true,
        );
      },
    }),
  ];
}

class PreviewWindow {
  private dom: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  /** Drops the answer currently in flight: aborts its read and disarms its
   * timeout. Null when nothing is pending. */
  private cancel: (() => void) | null = null;
  private key: string | null = null;
  /** A pending re-measure for a list that is still moving, or 0. */
  private frame = 0;
  /** Where the list was when the panel was last placed against it, so a list that
   * has settled stops asking for another frame. */
  private lastPlacedAt = "";
  /** Consecutive frames the list has been found where it already was. */
  private still = 0;
  private readonly onViewportChange = () => this.measure();

  constructor(
    private readonly view: EditorView,
    private readonly toggle: PreviewToggle,
    private readonly showHints: () => boolean,
    private readonly timeoutMs: number,
  ) {
    // Capture-phase, so a scroll inside ANY container the editor sits in moves
    // the panel with it. A fixed element does not ride a scroll of its own
    // accord, which is the price of not being clipped by one.
    window.addEventListener("scroll", this.onViewportChange, true);
    window.addEventListener("resize", this.onViewportChange);
    this.update();
  }

  /** Whether a panel is on screen. Read by the tooltip space above, which keeps
   * the list clear of one. */
  isOpen(): boolean {
    return this.dom !== null;
  }

  update(): void {
    const row = selectedCompletion(this.view.state) as PreviewableCompletion | null;
    // A null selection during a re-query (autocomplete reports the open list as
    // `disabled` for that whole window) leaves what is on screen alone: the list
    // itself stays painted and dimmed, and blanking the panel under it would
    // flicker once per keystroke. Whether the list is still there at all is the
    // measure below's to answer.
    if (row !== null) {
      if (this.toggle.on() && row.preview !== undefined) this.show(row.preview);
      else this.close();
    }
    this.measure();
  }

  destroy(): void {
    window.removeEventListener("scroll", this.onViewportChange, true);
    window.removeEventListener("resize", this.onViewportChange);
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.close();
    this.hint?.remove();
    this.hint = null;
  }

  /** Geometry is read in the measure phase and written in the write phase, which
   * is also where the hint strip is put into the tooltip — the tooltip may not
   * exist yet on the update that opens the list, and by the measure cycle it
   * always does. */
  private measure(): void {
    this.view.requestMeasure({
      key: this,
      read: () => {
        const list = this.view.dom.querySelector<HTMLElement>(".cm-tooltip-autocomplete");
        if (list === null) return null;
        return {
          list,
          listRect: list.getBoundingClientRect(),
          // CodeMirror stamps the side it chose onto the tooltip itself, which is
          // the one place the panel can learn it without re-deriving the decision.
          listAbove: list.classList.contains("cm-tooltip-above"),
          width: this.dom?.offsetWidth ?? 0,
          natural: this.naturalHeight(),
        };
      },
      write: (found) => {
        if (found === null) {
          // The list is gone, so the affordances that hang off it go with it.
          this.close();
          this.hint?.remove();
          this.hint = null;
          return;
        }
        this.drawHint(found.list);
        this.describeSelected(found.list);
        // A tooltip CodeMirror has not placed yet is parked far above the
        // viewport (`top: -10000px`), and it is parked on exactly the frame the
        // list opens: every measure request's `read` runs before any of their
        // `write`s, so this one has already read the rect by the time the tooltip
        // plugin's own write puts it where it belongs. Placing against that rect
        // is what pinned a freshly opened panel to the top of the screen — the
        // ordinary case now that the toggle persists, because the list is then
        // created with the panel already on.
        //
        // So the panel hides rather than guessing, and asks again a frame later,
        // by which time the tooltip has landed. A tooltip STAYS parked only while
        // it is scrolled out of view, where hidden is the right answer anyway.
        if (found.listRect.bottom < 0) {
          this.placeNextFrame();
          return;
        }
        this.place(found.listRect, found.listAbove, found.width, found.natural);
        // The list can still move AFTER this write, and nothing in that reaches a
        // view update — so a panel placed against where the list WAS would simply
        // stay there, overlapping it. It happens on the ordinary path: the hint
        // strip goes into the tooltip in this very write, CodeMirror measured its
        // size before that, and its resize observer corrects the placement on a
        // 50ms debounce. A flip above the cursor rides in on that same correction.
        //
        // So the panel follows the rect until it has been still for long enough to
        // have outlasted that debounce. Bounded and self-terminating: a settled
        // list costs `STILL_FRAMES` measures once and nothing thereafter.
        const where = `${found.listRect.top}:${found.listRect.left}:${found.listRect.width}:${found.listRect.height}:${found.listAbove}`;
        if (where !== this.lastPlacedAt) {
          this.lastPlacedAt = where;
          this.still = 0;
        } else if (this.still >= STILL_FRAMES) return;
        else this.still++;
        this.measureNextFrame();
      },
    });
  }

  /** Hide the panel and measure again on the next frame — for a list CodeMirror
   * has not placed yet, where there is nothing honest to place against. */
  private placeNextFrame(): void {
    if (this.dom !== null) this.dom.style.visibility = "hidden";
    this.measureNextFrame();
  }

  /** Measure again on the next frame. At most one ask is pending at a time, so a
   * list that keeps moving costs one measure a frame rather than the measure loop
   * CodeMirror would have to abandon — requesting from inside a write re-runs that
   * loop, and it gives up after five passes. */
  private measureNextFrame(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  }

  /** How tall the panel would be with nothing constraining it, or 0 where nothing
   * lays out (happy-dom) and the height is therefore not ours to set. The body's
   * scroll height is its content's, whatever height flex has given the box. */
  private naturalHeight(): number {
    if (this.dom === null || this.titleEl === null || this.bodyEl === null) return 0;
    const content = this.titleEl.offsetHeight + this.bodyEl.scrollHeight;
    // The panel's own 1px border, top and bottom: `max-height` is border-box, so
    // a height measured from the content alone would scroll by two pixels.
    return content === 0 ? 0 : content + 2;
  }

  private show(preview: RowPreview): void {
    if (this.dom === null) {
      const shell = previewShell();
      shell.dom.id = PANEL_ID;
      document.body.appendChild(shell.dom);
      this.dom = shell.dom;
      this.titleEl = shell.title;
      this.bodyEl = shell.body;
    }
    if (this.key === preview.key || this.titleEl === null || this.bodyEl === null) return;
    this.key = preview.key;
    this.cancel?.();
    this.titleEl.textContent = preview.title;
    this.bodyEl.replaceChildren(loadingBars());
    this.cancel = this.fetchAnswer(preview);
  }

  /**
   * Starts `preview`'s read into a staging element and swaps it in whole when it
   * lands, returning the cancel for it.
   *
   * Staging is the whole anti-flicker: the panel's body keeps the loading bars
   * until there is a complete answer to put in their place, so a reviewer arrowing
   * down a list sees one panel whose contents change rather than a panel that
   * empties and refills per row.
   */
  private fetchAnswer(preview: RowPreview): () => void {
    const controller = new AbortController();
    const staged = document.createElement("div");
    let settled = false;
    const settle = (node: Node): void => {
      if (settled || controller.signal.aborted || this.bodyEl === null) return;
      settled = true;
      clearTimeout(timer);
      this.bodyEl.replaceChildren(node);
      // The answer's height is not the loading bars', and the panel animates
      // between the two — so it has to be measured again now there is something
      // to measure.
      this.measure();
    };
    const timer = setTimeout(() => settle(noAnswer()), this.timeoutMs);
    // An answer resolving with an empty staging element said nothing, which is
    // the same thing the reviewer needs told as an answer that never came.
    preview.fill(staged, controller.signal).then(
      () => settle(staged.hasChildNodes() ? staged : noAnswer()),
      () => settle(noAnswer()),
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }

  private close(): void {
    this.cancel?.();
    this.cancel = null;
    this.key = null;
    this.lastPlacedAt = "";
    this.still = 0;
    this.dom?.remove();
    this.dom = null;
    this.titleEl = null;
    this.bodyEl = null;
  }

  /** Writes the placement `placePreview` decided, plus the height the panel wants
   * within it — an explicit height rather than `auto` is what the stylesheet's
   * transition has to animate between, so an answer taller than the loading bars
   * grows the panel into place instead of snapping. */
  private place(list: DOMRect, listAbove: boolean, width: number, natural: number): void {
    if (this.dom === null) return;
    const room = document.documentElement;
    const spot = placePreview(
      list,
      width,
      { width: room.clientWidth, height: room.clientHeight },
      listAbove,
    );
    this.dom.style.left = `${Math.round(spot.left)}px`;
    // Exactly one of the two anchors it; the other has to be cleared, because a
    // panel that has moved from one to the other would otherwise be stretched
    // between both.
    this.dom.style.top = spot.top === undefined ? "" : `${Math.round(spot.top)}px`;
    this.dom.style.bottom = spot.bottom === undefined ? "" : `${Math.round(spot.bottom)}px`;
    this.dom.style.maxHeight = `${Math.round(spot.maxHeight)}px`;
    this.dom.style.height =
      natural === 0 ? "" : `${Math.round(Math.min(natural, spot.maxHeight))}px`;
    // Whatever `placeNextFrame` hid, now that there is a real place for it.
    this.dom.style.visibility = "";
  }

  /** The panel describes the row it is about, so a screen reader reaching the
   * highlighted option reads the preview with it. CodeMirror sets this itself
   * for a row carrying `info` and clears it when the row is deselected; the
   * window is caret's own, so setting it is too. */
  private describeSelected(list: HTMLElement): void {
    const selected = list.querySelector("[aria-selected]");
    if (selected === null) return;
    if (this.dom === null) selected.removeAttribute("aria-describedby");
    else selected.setAttribute("aria-describedby", PANEL_ID);
  }

  /** The strip is the tooltip's first child, re-seated whenever it is not: the
   * list is REPLACED on every re-query (`this.list.remove()` then an append), so
   * a strip added once would end up under the rows it labels. */
  private drawHint(list: HTMLElement): void {
    if (!this.showHints()) {
      this.hint?.remove();
      this.hint = null;
      return;
    }
    if (this.hint === null) this.hint = hintStrip(this.toggle.on());
    else {
      const what = this.hint.lastElementChild;
      if (what !== null) what.textContent = hintLabel(this.toggle.on());
    }
    if (list.firstChild !== this.hint) list.insertBefore(this.hint, list.firstChild);
  }
}
