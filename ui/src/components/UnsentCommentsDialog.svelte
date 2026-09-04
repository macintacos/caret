<script lang="ts">
  import type { PendingItem } from "$lib/feedback.ts";
  import type { IconName } from "$lib/icons.ts";
  import { Button } from "$lib/components/ui/button/index.js";
  import type { ReviewContext } from "$lib/editorCompletion.ts";
  import { isSubmitChord } from "$lib/keys.ts";
  import { ariaKeyshortcutsFor } from "$lib/shortcuts/index.ts";
  import Icon from "@/components/Icon.svelte";
  import MarkdownEditor from "@/components/MarkdownEditor.svelte";
  import Modal from "@/components/Modal.svelte";
  import SubmitCap from "@/components/SubmitCap.svelte";

  interface Props {
    /** Controlled open — false while the guard plays its exit. */
    open: boolean;
    /** The surface finished its exit and may be unmounted. */
    onClosed?: () => void;
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
    /** The Modal role, forwarded through. Approve passes "dialog" so a click
     * outside dismisses (EXC-791); Reject keeps the default "confirm" — an
     * alertdialog guard whose backdrop click does not dismiss (a verdict is
     * deliberate, EXC-685). */
    kind?: "dialog" | "confirm";
    /** Show an optional free-text notes field whose value is handed to onConfirm
     * (EXC-791). Approve turns this on so the reviewer can pass the agent a note
     * to fold into its work; Reject leaves it off. */
    showNotes?: boolean;
    /** Confirm the verdict. `notes` carries the notes field's text when shown
     * (empty string otherwise); the caller decides whether to forward it. */
    onConfirm: (notes: string) => void;
    onRequestChanges: () => void;
    onCancel: () => void;
    /** The review being resolved, forwarded to the notes editor so reference
     * completion resolves against it. Only meaningful when showNotes. */
    reviewContext?: ReviewContext;
  }
  let {
    open,
    onClosed,
    items,
    action,
    consequence,
    icon,
    kind = "confirm",
    showNotes = false,
    onConfirm,
    onRequestChanges,
    onCancel,
    reviewContext,
  }: Props = $props();

  // The optional reviewer note (EXC-791), local to the dialog and handed to
  // onConfirm on confirm. Only rendered — and only meaningful — when showNotes.
  let notes = $state("");

  // With queued comments the dialog previews them and guards against dropping them;
  // with none it is a bare confirmation.
  let count = $derived(items.length);
  let hasComments = $derived(count > 0);

  // Without a notes field the primary path is Enter-confirmable (EXC-761): focus the
  // confirm action on open so a bare Enter activates it, rather than letting bits-ui
  // land focus on Cancel. With one, the note is what the reviewer came to type, so the
  // editor takes the on-open focus instead and ⌘↵ confirms (EXC-1212).
  let confirmEl = $state<HTMLElement | null>(null);

  // ⌘↵/Ctrl+Enter confirms from the focused confirm button (the no-notes variant's
  // on-open focus). The notes editor routes its own submit chord through
  // onSubmitChord below, so this handler rides only the button. preventDefault
  // stops the focused button's native click from double-firing onConfirm.
  function onKey(e: KeyboardEvent) {
    if (!isSubmitChord(e)) return;
    e.preventDefault();
    onConfirm(notes);
  }
</script>

<!-- The host mounts this per open (ModalPresence) and keeps it through the exit. -->
<Modal
  {kind}
  {open}
  {onClosed}
  eyebrow={action}
  title="{action} this plan?"
  contentClass="guard-content"
  onDismiss={onCancel}
  onOpenAutoFocus={(e) => {
    // Prevent bits-ui's first-focusable focus either way — it would land on
    // Cancel. With notes shown, MarkdownEditor autofocuses its own contenteditable
    // on mount (with preventScroll), so nothing more is needed here.
    e.preventDefault();
    if (!showNotes) confirmEl?.focus();
  }}
>
  {#snippet description()}
    {consequence}
    {#if hasComments}
      You have {count} pending comment{count === 1 ? "" : "s"} that won't be sent.
    {/if}
  {/snippet}

  {#if hasComments}
    <!-- A preview of exactly what a plain confirm would leave behind, so the
         reviewer sees their unsent work before deciding. -->
    <ul class="comments" aria-label="Your unsent comments">
      {#each items as item, i (i)}
        <li class="comment">
          <span class="anchor metric">{item.label}</span>
          <span class="text">{item.text}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if showNotes}
    <!-- Optional note handed to the agent on approval (EXC-791): distinct from the
         unsent inline comments above (which a plain approve drops) — this text IS
         sent, folded into the plan the agent works from, with no re-planning. -->
    <div class="field">
      <span class="form-label">Notes for the agent <span class="optional">(optional)</span></span>
      <MarkdownEditor
        autofocus
        value={notes}
        placeholder="Anything the agent should fold into the work — no re-planning needed."
        ariaLabel="Notes for the agent"
        {reviewContext}
        onInput={(t) => (notes = t)}
        onSubmitChord={() => onConfirm(notes)}
        onCancelChord={onCancel}
      />
    </div>
  {/if}

  {#snippet footer()}
    <Button variant="secondary" class="float-chip" onclick={onCancel}>Cancel</Button>
    {#if hasComments}
      <Button variant="secondary" class="float-chip" onclick={onRequestChanges}>
        <Icon name="corner-up-left" size={14} />
        Request changes
      </Button>
    {/if}
    <Button
      bind:ref={confirmEl}
      onclick={() => onConfirm(notes)}
      onkeydown={onKey}
      aria-keyshortcuts={ariaKeyshortcutsFor("editor.submit")}
    >
      {#if icon}<Icon name={icon} size={14} />{/if}
      {hasComments ? `${action} anyway` : action}
      <SubmitCap />
    </Button>
  {/snippet}
</Modal>

<style>
  /* Widen the guard past the shadcn Dialog default: the three-button footer does not
     fit max-w-sm, and the shell's overflow-y-auto forces overflow-x to compute to
     auto, so the surplus width became a horizontal scrollbar that read as the modal
     being clipped. app.css scans only lib/components/ui for Tailwind, so a max-w
     utility written here would never be generated — this plain :global rule sets the
     width directly. Specificity (0,2,0) beats the vendored `.sm:max-w-sm` (0,1,0);
     min() keeps the small-screen inset. Both slots, so the approve (Dialog) and
     reject (AlertDialog) guards read as one width, off the shared
     --confirm-dialog-width token (app.css) the Request Changes dialog also tracks. */
  :global(
    [data-slot="dialog-content"].guard-content,
    [data-slot="alert-dialog-content"].guard-content
  ) {
    max-width: min(var(--confirm-dialog-width), calc(100% - 2rem));
  }

  /* Preview of the unsent feedback: a quiet sunk container — no accent, which is
     reserved for actions. Height-capped and scrollable so a long queue never grows
     the dialog past the viewport. */
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

  /* Optional reviewer-notes field (EXC-791), reusing the request-changes form
     treatment so the two dialogs read as one system. */
  .field {
    display: block;
    margin-top: 1rem;
  }
</style>
