<script lang="ts">
  // The bottom status bar (EXC-787): build/version badge (left), plan-review
  // status and keyboard-shortcuts affordance (right). App.svelte places it as the
  // status-bar grid row, so it reserves space rather than overlaying the plan; the
  // CommentNavigator docks just above it.
  import KeyboardHelpButton from "@/components/KeyboardHelpButton.svelte";
  import StatusStrip from "@/components/StatusStrip.svelte";
  import VersionBadge from "@/components/VersionBadge.svelte";

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
  }: Props = $props();
</script>

<footer class="status-bar" aria-label="Status bar">
  <VersionBadge {version} {commit} {isDev} />
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
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    height: var(--status-bar-h);
    padding: 0 0.7rem;
    background: var(--paper-raised);
    border-top: 1px solid var(--rule);
    color: var(--ink-soft);
  }
  .status-bar-end {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    min-width: 0;
  }
</style>
