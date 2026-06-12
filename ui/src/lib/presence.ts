// Tab-close presence retraction (EXC-562). The daemon decides whether a UI tab
// is already open — and so whether the review hook should skip foregrounding a
// new browser tab — from how recently a tab polled GET /api/reviews. That poll
// is throttled by the browser for backgrounded tabs, so the daemon's live-client
// window has to be generous; the price of a generous window is that a tab which
// just *closed* would otherwise still count as live. This beacon pays that price
// down: on `pagehide` the tab tells the daemon it is going away, so a closed tab
// stops counting at once and the next plan correctly opens a fresh tab.
//
// `pagehide` (not `unload`) is the reliable close hook for sendBeacon; it also
// fires when the tab is frozen into the bfcache, which is fine to retract on —
// a frozen tab can't surface a review, and a later resume re-stamps presence on
// its next poll. Framework-agnostic and unit-tested in isolation; App.svelte
// wires it to `window` (cf. safeMode.ts).

/** Path the close beacon posts to — the daemon clears UI presence here. */
export const UI_GONE_PATH = "/api/ui/gone";

export interface UiGoneBeaconOptions {
  /** Event source to listen on — `window` in the app. */
  target: EventTarget;
  /** Beacon sender; injectable for tests. Defaults to navigator.sendBeacon. */
  sendBeacon?: (url: string) => boolean;
}

/** Install a `pagehide` listener that beacons the daemon that this tab is
 * closing. Returns a teardown that removes the listener. */
export function installUiGoneBeacon(opts: UiGoneBeaconOptions): () => void {
  const send = opts.sendBeacon ?? ((url: string) => navigator.sendBeacon(url));
  const onPageHide = () => {
    send(UI_GONE_PATH);
  };
  opts.target.addEventListener("pagehide", onPageHide);
  return () => opts.target.removeEventListener("pagehide", onPageHide);
}
