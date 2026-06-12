// Scroll-to-line for the source view. @pierre/diffs renders each line as a
// <div data-line="N"> inside the container's shadow root; jumping to a heading
// is a lookup of that row plus scrollIntoView. Lives in the wrapper module so
// the library's DOM shape stays behind the import boundary.

/**
 * Scrolls the source view so the row for 1-based `line` is at the top of the
 * viewport. Returns whether a matching row was found (false when the line is
 * outside the rendered range or the view has not painted yet).
 */
export function scrollToLine(container: HTMLElement, line: number): boolean {
  const row = container.shadowRoot?.querySelector<HTMLElement>(`[data-line="${line}"]`);
  if (row == null) return false;
  row.scrollIntoView({ block: "start" });
  return true;
}
