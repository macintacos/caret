<script lang="ts">
  // What's new (EXC-1452): the release notes a bundle skipped, or the trunk commits a
  // manual build is missing. The host mounts this per open (ModalPresence), so each open
  // runs `load` once. The footer is built from the report the UI already holds, never
  // from `load`, so the compare link and the upgrade guidance survive a failed fetch.
  import type { UpdateChanges, UpdateReport } from "@core/lib/types";
  import Modal from "@/components/Modal.svelte";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";
  import { renderMarkdown } from "$lib/markdown.ts";
  import { topmostDialogContent } from "$lib/modalStack.ts";
  import { compareUrl, pullUrl, upgradeGuidance } from "$lib/updates.ts";

  interface Props {
    /** Controlled open — false while the modal plays its exit. */
    open: boolean;
    /** The surface finished its exit and may be unmounted. */
    onClosed?: () => void;
    /** Dismiss (Escape or backdrop). */
    onClose: () => void;
    report: UpdateReport;
    /** The harness's restart line from /api/health, when the daemon knows its harness. */
    restartHint?: string;
    /** Fetches the changes; App passes getUpdateChanges. */
    load: () => Promise<UpdateChanges>;
  }
  let { open, onClosed, onClose, report, restartHint, load }: Props = $props();

  let state = $state<
    { kind: "loading" } | { kind: "error" } | { kind: "ready"; changes: UpdateChanges }
  >({ kind: "loading" });

  $effect(() => {
    load().then(
      (changes) => (state = { kind: "ready", changes }),
      () => (state = { kind: "error" }),
    );
  });

  const compare = $derived(compareUrl(report));
  const guidance = $derived.by(() => {
    const status = report.status;
    return status.kind === "behind-release" || status.kind === "behind-commit"
      ? upgradeGuidance(status, restartHint)
      : null;
  });

  // The sanitizer's output, tightened for a surface that renders GitHub-authored text:
  // an <img> would make the browser call out to its host, and an in-tab link would
  // navigate the review away.
  function releaseHtml(body: string): string {
    const template = document.createElement("template");
    template.innerHTML = renderMarkdown(body);
    for (const img of template.content.querySelectorAll("img")) img.remove();
    for (const a of template.content.querySelectorAll("a")) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noreferrer");
    }
    return template.innerHTML;
  }

  // Land focus on the dialog, not the footer's command field or links — the same
  // synthetic-event reach ShortcutsHelp uses.
  function focusDialog(e: Event): void {
    e.preventDefault();
    topmostDialogContent()?.focus();
  }
</script>

<Modal
  kind="dialog"
  {open}
  {onClosed}
  eyebrow="Updates"
  title="What's new"
  onDismiss={onClose}
  onOpenAutoFocus={focusDialog}
  contentClass="whats-new-content"
>
  <div class="changes">
    {#if state.kind === "loading"}
      <div class="changes-status"><Spinner /></div>
    {:else if state.kind === "error"}
      <p class="changes-status">Couldn't load what's new.</p>
    {:else if state.changes.kind === "releases"}
      {#each state.changes.releases as release (release.version)}
        <section class="release">
          <h3 class="release-version">caret {release.version}</h3>
          <div class="release-body">{@html releaseHtml(release.body)}</div>
        </section>
      {:else}
        <p class="changes-status">No release notes to show.</p>
      {/each}
    {:else}
      <ul class="commits">
        {#each state.changes.commits as commit (commit.sha)}
          {@const href = commit.pr === null ? null : pullUrl(commit.pr)}
          <li>
            {#if href}
              <a {href} target="_blank" rel="noreferrer">{commit.subject}</a>
            {:else}
              {commit.subject}
            {/if}
          </li>
        {:else}
          <li class="changes-status">No commits to show.</li>
        {/each}
        {#if state.changes.more > 0}
          <li class="commits-more">
            {#if compare}
              <a href={compare} target="_blank" rel="noreferrer">…and {state.changes.more} more</a>
            {:else}
              …and {state.changes.more} more
            {/if}
          </li>
        {/if}
      </ul>
    {/if}
  </div>

  {#snippet footer()}
    <div class="upgrade">
      {#if compare}
        <a class="upgrade-compare" href={compare} target="_blank" rel="noreferrer">Compare on GitHub</a>
      {/if}
      {#if guidance}
        <Input
          class="upgrade-command settings-copy-box settings-copy-text"
          readonly
          value={guidance.command}
          aria-label="Upgrade command" />
        {#each guidance.lines as line}
          <p class="upgrade-line">{line}</p>
        {/each}
      {/if}
    </div>
  {/snippet}
</Modal>

<style>
  /* Rides the portalled content (no scope hash → :global); a changelog wants a reading
     measure wider than the shadcn default, but not the keymap's. */
  :global(.whats-new-content) {
    max-width: min(40rem, calc(100vw - 2rem));
  }
  .changes {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    font-size: var(--text-sm);
    color: var(--ink);
  }
  .changes-status {
    display: flex;
    justify-content: center;
    margin: 0;
    padding: 1.5rem 0;
    color: var(--ink-faint);
  }
  .release-version {
    margin: 0 0 0.4rem;
    font-size: var(--text-base);
    font-weight: 600;
  }
  .release-body :global(:is(p, ul, ol)) {
    margin: 0 0 0.5rem;
  }
  .release-body :global(ul),
  .release-body :global(ol) {
    padding-left: 1.25rem;
  }
  .commits {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .commits-more {
    color: var(--ink-soft);
  }
  .changes a,
  .upgrade a {
    color: var(--accent);
    text-decoration: none;
  }
  .changes a:hover,
  .upgrade a:hover {
    text-decoration: underline;
  }
  .upgrade {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    width: 100%;
    font-size: var(--text-sm);
  }
  .upgrade :global(.upgrade-command) {
    height: auto;
  }
  .upgrade-line {
    margin: 0;
    color: var(--ink-soft);
  }
</style>
