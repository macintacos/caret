/**
 * Keeps the gutter "+" in place while it holds keyboard focus. @pierre/diffs takes the
 * "+" out of `root` when the pointer leaves the plan, which would drop the focus with it,
 * so while the "+" holds focus those leaves wait and replay once the focus moves on,
 * unless the pointer came back first. A leave is not composed, so only the shadow root,
 * not its host, sees it on the way down.
 *
 * @returns the teardown.
 */
export function holdUtilityWhileFocused(root: ShadowRoot): () => void {
  let held: EventTarget[] = [];
  const focused = () => root.activeElement?.closest("[data-gutter-utility-slot]") != null;
  const onLeave = (event: Event) => {
    if (event.target === null || !focused()) return;
    event.stopPropagation();
    held.push(event.target);
  };
  const onMove = () => {
    held = [];
  };
  const onFocusOut = () => {
    const targets = held;
    held = [];
    if (targets.length === 0) return;
    // After focusin, so the focus has landed elsewhere before the leaves replay.
    queueMicrotask(() => {
      if (focused()) return;
      for (const target of targets) target.dispatchEvent(new PointerEvent("pointerleave"));
    });
  };
  root.addEventListener("pointerleave", onLeave, { capture: true });
  root.addEventListener("pointermove", onMove, { capture: true });
  root.addEventListener("focusout", onFocusOut);
  return () => {
    root.removeEventListener("pointerleave", onLeave, { capture: true });
    root.removeEventListener("pointermove", onMove, { capture: true });
    root.removeEventListener("focusout", onFocusOut);
  };
}
