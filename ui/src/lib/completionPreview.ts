// The Ctrl+Space completion preview's own module (EXC-1186): the toggle that says
// whether a list is previewing, the panel shell each source fills with its own
// answer — a skill's description, or a file's lines — and the renderer for the
// lines themselves.
//
// The toggle and the shell are shared by both sources; the line renderer has only
// the file one, and lives here anyway. Every `caret-preview-*` element is built in
// this file and painted by one theme block in markdownEditor.ts, so the class
// names have exactly two sites to stay in step across rather than three.
//
// The toggle is read by the SOURCES at query time rather than by the panel at
// render time, and that is forced by how the panel repaints.
// `CompletionTooltip.updateSel` re-evaluates a row's `info` only when the
// selected `<li>` ELEMENT changes, so flipping this in isolation would leave the
// panel exactly as it was. The Ctrl+Space binding therefore follows the flip with
// `startCompletion`, which forces every source back to Pending and re-queries —
// fresh options, fresh `info`, panel re-evaluated. A source that read the toggle
// only when CodeMirror asked it to render would never be asked.

import type { FileExcerpt } from "@core/lib/types";

/** Whether the completion list is showing its preview panel. Named so a source
 * can take one as a parameter and a unit can hand it one of its own. */
export interface PreviewToggle {
  on(): boolean;
  toggle(): void;
}

/**
 * A preview toggle, closed to begin with.
 *
 * Sticky for the session and deliberately not persisted: a reviewer who opened a
 * panel keeps it open for every list they open afterwards, and a reload starts
 * closed again. The factory beside the module instance below is the seam a unit
 * builds its own through, the same shape `createSkillCache` sits in beside
 * `skillsFor` — a test's toggle can neither be read by the app nor written by it.
 */
export function createPreviewToggle(): PreviewToggle {
  let showing = false;
  return {
    on: () => showing,
    toggle() {
      showing = !showing;
    },
  };
}

/** The one toggle the app reads: every feedback editor's list previews or does
 * not together, because the panel is a mode the reviewer is in rather than a
 * property of one editor. */
export const previewToggle: PreviewToggle = createPreviewToggle();

/**
 * The panel shell a source fills: a header strip naming what is being previewed,
 * and an empty body to write the answer into.
 *
 * Returned SYNCHRONOUSLY, filled in later. `Completion.info` may return a
 * promise, but `updateSel`'s async branch skips the `aria-describedby` wiring its
 * sync branch does — so a row awaiting its answer would go undescribed to a
 * screen reader, and the panel would appear late rather than immediately. Handing
 * back an empty body and writing into it when the answer lands keeps the row
 * described and the panel where the reviewer's eye already is.
 *
 * Nothing here positions anything: `.cm-completionInfo` is CodeMirror's own
 * element and its base theme already places it against the list and flips it on
 * viewport overflow. These class names exist for the theme block in
 * markdownEditor.ts to paint against, and for nothing else.
 */
export function previewPanel(title: string): { dom: HTMLElement; body: HTMLElement } {
  const dom = document.createElement("div");
  dom.className = "caret-preview";
  const strip = document.createElement("div");
  strip.className = "caret-preview-title";
  strip.textContent = title;
  const body = document.createElement("div");
  body.className = "caret-preview-body";
  dom.append(strip, body);
  return { dom, body };
}

/**
 * Writes `excerpt`'s lines into `body`, numbered from the excerpt's own
 * `startLine`, with the row for `mark` — the line the reviewer cited — flagged
 * for the theme to pick out.
 *
 * A `mark` past the end of the file gets a sentence of its own above the lines.
 * The daemon clamps such a window to the file's tail, so what comes back is a
 * real excerpt that simply does not contain the cited line — and a tail drawn
 * with nothing marked and nothing said reads as a preview that went to the wrong
 * place. Saying where the file ends is the ordinary answer the reviewer can act
 * on, and the list keeps working either way.
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
    row.append(gutter, text);
    body.append(row);
  });
}
