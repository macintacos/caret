<script lang="ts">
  // The bottom status bar (EXC-787): build/version badge (left), the review's
  // working directory (centre), plan-review status and keyboard-shortcuts affordance
  // (right). App.svelte places it as the
  // status-bar grid row, so it reserves space rather than overlaying the plan; the
  // CommentNavigator docks just above it.
  import Icon from "@/components/Icon.svelte";
  import KeyboardHelpButton from "@/components/KeyboardHelpButton.svelte";
  import StatusStrip from "@/components/StatusStrip.svelte";
  import VersionBadge from "@/components/VersionBadge.svelte";
  import { homeRelative, middleCuts } from "$lib/cwd.ts";

  interface Props {
    // Build/version segment (VersionBadge).
    version: string | undefined;
    commit: string | undefined;
    isDev?: boolean;
    // Review-status segment (StatusStrip). `reviewVersion` is the plan revision,
    // distinct from the build `version` above.
    active: boolean;
    pendingCount: number;
    coveredLines: number;
    reviewVersion: number;
    connected: boolean;
    commentsOpen?: boolean;
    onToggleComments?: () => void;
    // Keyboard-shortcuts affordance (far right).
    onOpenHelp: () => void;
    /** Whether the shortcut-hint affordances are shown (EXC-826). When off, the
     * keyboard button hides; the ? shortcut still opens the help modal. */
    showShortcutHints: boolean;
    /** The review's working directory (EXC-807), absent with no review. */
    cwd?: string;
    /** The daemon user's home directory, so `cwd` shows from `~` inside it. */
    home?: string;
    /** Copy `cwd` to the clipboard (EXC-850). Rejects when the copy did not land. */
    onCopyCwd: (cwd: string) => Promise<void>;
  }
  let {
    version,
    commit,
    isDev = false,
    active,
    pendingCount,
    coveredLines,
    reviewVersion,
    connected,
    commentsOpen = false,
    onToggleComments,
    onOpenHelp,
    showShortcutHints,
    cwd,
    home,
    onCopyCwd,
  }: Props = $props();

  // True while the pill confirms a copy, held as long as the version badge's.
  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const COPIED_MS = 1500;

  function copyCwd(path: string): void {
    onCopyCwd(path).then(
      () => {
        copied = true;
        clearTimeout(timer);
        timer = setTimeout(() => {
          copied = false;
        }, COPIED_MS);
      },
      // A refused write has nothing to confirm; the path stays as it was.
      () => {},
    );
  }

  $effect(() => () => clearTimeout(timer));

  // Shows the longest of `cuts` that fits the element, again whenever it resizes. Its
  // width comes from the whole path in .room, so swapping the cut never resizes it.
  function fitCut(cuts: string[]) {
    return (el: HTMLElement) => {
      const fit = () => {
        for (const cut of cuts) {
          el.textContent = cut;
          if (el.scrollWidth <= el.clientWidth) return;
        }
      };
      fit();
      const observer = new ResizeObserver(fit);
      observer.observe(el);
      // A web font landing changes the cuts' widths but not the room's.
      void document.fonts?.ready.then(fit);
      return () => observer.disconnect();
    };
  }
</script>

<footer class="status-bar" aria-label="Status bar">
  <VersionBadge {version} {commit} {isDev} />
  {#if cwd !== undefined}
    {@const shown = homeRelative(cwd, home)}
    <button
      type="button"
      class="cwd tray"
      data-copied={copied || undefined}
      aria-label={`Copy path ${cwd} to the clipboard`}
      onclick={() => copyCwd(cwd)}
      ><span class="path mono" {@attach fitCut(middleCuts(shown))}></span><span
        class="room mono"
        aria-hidden="true">{shown}</span
      ><span class="copied mono" aria-hidden="true"><Icon name="check" size={12} />Copied</span></button
    >
    <span class="sr-only" role="status">{copied ? "Copied path to clipboard" : ""}</span>
  {/if}
  <div class="status-bar-end">
    <StatusStrip
      {active}
      {pendingCount}
      {coveredLines}
      version={reviewVersion}
      {connected}
      {commentsOpen}
      {onToggleComments}
      {showShortcutHints}
    />
    {#if showShortcutHints}
      <KeyboardHelpButton onOpen={onOpenHelp} />
    {/if}
  </div>
</footer>

<style>
  /* Equal outer tracks hold the path at the bar's centre; it gives way first, cutting
     its middle, and neither side shrinks below its own width for it. */
  .status-bar {
    display: grid;
    grid-template-columns: minmax(max-content, 1fr) minmax(0, max-content) minmax(max-content, 1fr);
    align-items: center;
    gap: 1rem;
    height: var(--status-bar-h);
    /* Cut into the window's body like the top bar, and inset to line up with the plan
       pane's inner edge above it. */
    padding: 0 calc(var(--pane-gap) + 0.2rem) 0 calc(var(--pane-gap) + 0.3rem);
    color: var(--ink-soft);
  }
  .status-bar > :global(.version-badge) {
    justify-self: start;
  }
  .status-bar-end {
    grid-column: 3;
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }

  /* The working-directory path. A click copies it, but it is metadata rather than a
     control, so it lies in a bed (.tray) with no key: under the pointer the bed takes the
     ink wash a ghost control takes, and a press leaves the same dimple. */
  .cwd {
    grid-column: 2;
    display: grid;
    align-items: center;
    min-width: 0;
    max-width: 100%;
    appearance: none;
    border: none;
    height: 1.75rem;
    padding: 0 0.7rem;
    /* A neutral key's label (atoms.css --cap-label): plain --ink-soft falls just under
       4.5:1 on the body in some palettes. */
    color: color-mix(in lab, var(--ink-soft), var(--ink) 15%);
    cursor: pointer;
    /* The path and "Copied" roll in and out through the bed's edges. */
    overflow: hidden;
    transition:
      background-color var(--dur-state) var(--ease-out),
      color var(--dur-state) var(--ease-out),
      box-shadow var(--dur-state) var(--ease-out);
  }
  /* One cell for all three. .room is the whole path, unseen, so the bed is as wide as
     the whole path is or the bar allows, whichever cut .path shows. */
  .cwd > span {
    grid-area: 1 / 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-size: var(--text-xs);
  }
  /* Only when the leaf alone outruns the room. */
  .path {
    text-overflow: ellipsis;
  }
  .room {
    height: 0;
    visibility: hidden;
  }
  .path,
  .copied {
    transition:
      opacity var(--dur-state) var(--ease-out),
      transform var(--dur-state) var(--ease-out);
  }
  .copied {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3em;
    opacity: 0;
    transform: translateY(100%);
  }
  .copied > :global(svg) {
    color: var(--ok);
  }
  .cwd[data-copied] .path {
    opacity: 0;
    transform: translateY(-100%);
  }
  .cwd[data-copied] .copied {
    opacity: 1;
    transform: none;
  }
  .cwd:is(:hover, :focus-visible) {
    background-color: var(--ink-wash);
    color: var(--ink);
  }
  .cwd:active {
    background-color: var(--ink-wash);
    box-shadow:
      var(--bed-shade),
      inset 0 1px var(--press-blur) var(--press-shade);
  }
</style>
