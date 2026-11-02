<script lang="ts">
  // The bottom status bar (EXC-787): build/version badge (left), the review's
  // working directory (centre), plan-review status and keyboard-shortcuts affordance
  // (right). App.svelte places it as the
  // status-bar grid row, so it reserves space rather than overlaying the plan; the
  // CommentNavigator docks just above it.
  import KeyboardHelpButton from "@/components/KeyboardHelpButton.svelte";
  import StatusStrip from "@/components/StatusStrip.svelte";
  import VersionBadge from "@/components/VersionBadge.svelte";
  import { shortCwd } from "$lib/cwd.ts";

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
    /** Copy `cwd` to the clipboard (EXC-850); App.svelte writes it and raises the alert. */
    onCopyCwd: (cwd: string) => void;
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
    onCopyCwd,
  }: Props = $props();
</script>

<footer class="status-bar" aria-label="Status bar">
  <VersionBadge {version} {commit} {isDev} />
  {#if cwd !== undefined}
    <button
      type="button"
      class="cwd tray"
      aria-label={`Copy path ${cwd} to the clipboard`}
      onclick={() => onCopyCwd(cwd)}><span class="mono">{shortCwd(cwd)}</span></button>
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
  /* Equal outer tracks hold the path at the bar's centre; it gives way first, down to an
     ellipsis, before either side does. */
  .status-bar {
    display: grid;
    grid-template-columns: 1fr minmax(0, max-content) 1fr;
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
    transition:
      background-color var(--dur-state) var(--ease-out),
      color var(--dur-state) var(--ease-out),
      box-shadow var(--dur-state) var(--ease-out);
  }
  .cwd > span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
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
