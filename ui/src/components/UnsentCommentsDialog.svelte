<script lang="ts">
  import type { PendingItem } from "../lib/feedback.ts";
  import type { IconName } from "../lib/icons.ts";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import Icon from "./Icon.svelte";

  interface Props {
    /** The unsent feedback a plain confirm would leave behind — the general-comment
     * draft, committed inline comments, and unsent scratches — each a short anchor
     * label plus its text. When empty the dialog is a plain "are you sure?" confirm
     * (Reject always confirms, EXC-685); when non-empty it previews the items and
     * guards them from being silently dropped. */
    items: PendingItem[];
    /** The verdict's label, e.g. "Approve" or "Reject". Drives the title,
     * eyebrow, and the confirm button. */
    action: string;
    /** One-line sentence describing what the verdict does, always shown. */
    consequence: string;
    /** Optional glyph for the confirm button (omit for a text-only action). */
    icon?: IconName;
    onConfirm: () => void;
    onRequestChanges: () => void;
    onCancel: () => void;
  }
  let { items, action, consequence, icon, onConfirm, onRequestChanges, onCancel }: Props = $props();

  // With queued comments the dialog previews them and guards against dropping
  // them; with none it's a bare confirmation. The count drives the "won't be
  // sent" warning; the label, the Request-changes divert, and the "anyway"
  // wording all key off whether any are pending.
  let count = $derived(items.length);
  let hasComments = $derived(count > 0);

  // The primary path is Enter-confirmable (EXC-761 keeps today's behavior): focus
  // the confirm action on open so a bare Enter activates it, rather than letting
  // bits-ui land focus on Cancel.
  let confirmEl = $state<HTMLElement | null>(null);
</script>

<!-- shadcn AlertDialog: the confirm-guard role (`alertdialog`), a real focus trap,
     and Escape-to-cancel come from bits-ui. App gates this with {#if}, so it mounts
     open (controlled); Escape and the buttons route to the existing callbacks. Unlike
     the old scrim, a backdrop click does NOT dismiss — correct for a confirm guard. -->
<AlertDialog.Root open>
  <AlertDialog.Content
    onEscapeKeydown={() => onCancel()}
    onOpenAutoFocus={(e) => {
      e.preventDefault();
      confirmEl?.focus();
    }}
  >
    <AlertDialog.Header>
      <span class="eyebrow">{action}</span>
      <AlertDialog.Title>{action} this plan?</AlertDialog.Title>
      <AlertDialog.Description class="body">
        {consequence}
        {#if hasComments}
          You have {count} pending comment{count === 1 ? "" : "s"} that won't be sent.
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>

    {#if hasComments}
      <!-- A preview of exactly what a plain confirm would leave behind, so the
           reviewer sees their unsent work before deciding. Each row pairs a short
           anchor (the general note, a line reference, or an unsent draft's range)
           with the comment text, clamped so a long comment stays a scan-line. -->
      <ul class="comments" aria-label="Your unsent comments">
        {#each items as item, i (i)}
          <li class="comment">
            <span class="anchor metric">{item.label}</span>
            <span class="text">{item.text}</span>
          </li>
        {/each}
      </ul>
    {/if}

    <AlertDialog.Footer>
      <AlertDialog.Cancel onclick={onCancel}>Cancel</AlertDialog.Cancel>
      {#if hasComments}
        <Button variant="outline" onclick={onRequestChanges}>
          <Icon name="corner-up-left" size={14} />
          Request changes
        </Button>
      {/if}
      <AlertDialog.Action bind:ref={confirmEl} onclick={onConfirm}>
        {#if icon}<Icon name={icon} size={14} />{/if}
        {hasComments ? `${action} anyway` : action}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
  /* caret's dialog identity: the uppercase eyebrow over the title. The panel,
     title, and description wear the bridged shadcn look; colors ride caret tokens. */
  .eyebrow {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  /* Preview of the unsent feedback: a quiet sunk container — no accent (reserved
     for actions), muted ink, hairline row dividers — reading as "here's what you'd
     leave behind". Height-capped and scrollable so a long queue never grows the
     dialog past the viewport. */
  .comments {
    list-style: none;
    margin: 0;
    padding: 0.1rem 0.6rem;
    max-height: 8.5rem;
    overflow-y: auto;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper-sunk);
  }
  .comment {
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
    padding: 0.5rem 0;
  }
  .comment + .comment {
    border-top: 1px solid var(--rule);
  }
  /* The anchor lead: "General", "Line 7", "Lines 4–6" — the tabular metric face
     the rest of the review's line references use, sized down and fixed-width so
     the comment column aligns down the list. */
  .anchor {
    flex: none;
    min-width: 3.5rem;
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--ink-faint);
  }
  .text {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    color: var(--ink-soft);
    /* Clamp a long comment to two lines here — the full text is one click away in
       Request changes; the preview only needs it recognizable. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    white-space: pre-wrap;
  }
</style>
