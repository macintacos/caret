// The `commenting.*` keys that act on the hovered comment stop: which are live right now,
// and what each does through the hovered card's handle.
import {
  type CardHandle,
  type CommentKey,
  type CommentStop,
  commentKeys,
  type FocusedStop,
  type RegisterCard,
  stopIndex,
  stopKey,
} from "$lib/diffview/commentStops";

export interface CommentKeysDeps {
  stops: () => readonly CommentStop[];
  focusedStop: () => FocusedStop | null;
  resume: (key: string) => void;
  activeElement: () => Element | null;
}

/** The card or Resume marker owning `el`, by its stop key, or null outside every stop. */
function owningStopKey(el: Element): string | null {
  const owner = el.closest("[data-annotation-card], [data-scratch-marker]");
  if (owner == null) return null;
  return owner.getAttribute("data-annotation-card") ?? owner.getAttribute("data-scratch-marker");
}

export function createCommentKeys(deps: CommentKeysDeps) {
  const handles = new Map<string, CardHandle>();

  const register: RegisterCard = (id, handle) => {
    handles.set(id, handle);
    return () => {
      if (handles.get(id) === handle) handles.delete(id);
    };
  };

  const hoveredHandle = (focused: FocusedStop) =>
    focused.ref.kind === "comment" ? handles.get(focused.ref.id) : undefined;

  function live(key: CommentKey): boolean {
    const focused = deps.focusedStop();
    if (focused == null) return false;

    // An open composer or the discard confirm owns every key, so work in progress is
    // never thrown away by a stray keypress.
    const active = deps.activeElement();
    if (active?.closest('.composer, [role="alertdialog"]')) return false;

    // Enter yields to a focused control's own activation, unless that control belongs to
    // another card or marker than the hovered one.
    if (key === "activate" && active?.closest("button, a[href]")) {
      const owner = owningStopKey(active);
      if (owner == null || owner === stopKey(focused.ref)) return false;
    }

    const stop = deps.stops()[stopIndex(deps.stops(), focused.ref)];
    if (stop == null) return false;
    const expanded = hoveredHandle(focused)?.expanded() ?? false;
    return commentKeys({ kind: stop.ref.kind, state: stop.state }, expanded).includes(key);
  }

  function run(key: CommentKey): void {
    const focused = deps.focusedStop();
    if (focused == null) return;

    const { ref } = focused;
    const handle = hoveredHandle(focused);
    switch (key) {
      case "edit":
      case "editInsert":
        handle?.edit();
        break;
      case "activate":
        if (ref.kind === "resume") deps.resume(ref.key);
        else if (handle?.expanded()) handle.edit();
        else handle?.expand();
        break;
      case "collapse":
        handle?.collapse();
        break;
      case "expand":
        handle?.expand();
        break;
      case "discard":
        handle?.discard();
        break;
    }
  }

  return {
    register,
    expand: (id: string) => handles.get(id)?.expand(),
    live,
    run,
  };
}
