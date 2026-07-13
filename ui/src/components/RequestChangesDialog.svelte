<script lang="ts">
  import type { Annotation } from "@core/types";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { type ComposerScratch, rangeLabel } from "../lib/diffview/commenting.ts";
  import { formatFeedback, pendingInlineCount, pendingLineCount } from "../lib/feedback.ts";
  import { isSubmitChord } from "../lib/keys.ts";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";

  interface Props {
    annotations: Annotation[];
    // The general comment is lifted into App.svelte (autosaved per review), so
    // it survives the dialog unmounting on Cancel/Escape/scrim. The dialog is a
    // controlled view over the parent's value.
    generalComment: string;
    // The active review's current plan text, so the preview quotes a
    // line-anchored annotation's source lines exactly as the agent will see them.
    planText: string;
    // Retained, unsubmitted composer drafts ("scratches", EXC-634). They are not
    // committed comments and are not sent unless the reviewer Saves one here.
    scratches: ComposerScratch[];
    onGeneralCommentInput: (value: string) => void;
    onSubmit: (generalComment: string) => void;
    onCancel: () => void;
    // Save graduates a scratch into a committed comment included in the feedback;
    // discard drops it for this review. Both act on the source-view controller.
    onSaveScratch: (key: string) => void;
    onDiscardScratch: (key: string) => void;
  }
  let {
    annotations,
    generalComment,
    planText,
    scratches,
    onGeneralCommentInput,
    onSubmit,
    onCancel,
    onSaveScratch,
    onDiscardScratch,
  }: Props = $props();

  // The general-comment input, focused on open via the Modal's onOpenAutoFocus
  // hook (bits-ui owns initial focus; this lands it on the primary input).
  let textarea = $state<HTMLElement | null>(null);

  // Live preview of exactly what the agent will receive.
  let preview = $derived(formatFeedback(annotations, generalComment, planText));
  let inlineCount = $derived(pendingInlineCount(annotations));
  // Distinct source locations the pending comments anchor to; only worth showing
  // when it's smaller than the comment count (several comments share a line),
  // otherwise "N comments on N lines" just restates the count.
  let lineCount = $derived(pendingLineCount(annotations));
  // The dialog has nothing to send: no inline comments and a blank general note.
  // Shows a nudge instead of a hollow "0 comments" tally.
  let empty = $derived(inlineCount === 0 && generalComment.trim().length === 0);
  // The inline-comment tally, collapsing the redundant "on M lines" when each
  // comment sits on its own location.
  let countSummary = $derived(
    lineCount > 0 && lineCount < inlineCount
      ? `${inlineCount} comments on ${lineCount} line${lineCount === 1 ? "" : "s"} will be included.`
      : `${inlineCount} comment${inlineCount === 1 ? "" : "s"} will be included.`,
  );
  // Scratches are surfaced for a conscious Save but are never counted into the
  // tally above (they aren't sent unless Saved), so the count would otherwise read
  // as a bare contradiction of the "Unsent comments [N]" chip below. Say plainly
  // they won't go unless Saved (EXC-746).
  let draftsHint = $derived(
    scratches.length === 1
      ? "1 unsent draft below won't be sent unless you Save it."
      : `${scratches.length} unsent drafts below won't be sent unless you Save them.`,
  );

  function submit() {
    onSubmit(generalComment.trim());
  }
  // Escape-to-dismiss is owned by bits-ui (Modal's onDismiss → onCancel); this
  // handler carries only caret's own ⌘↵/Ctrl+Enter submit chord, and rides the
  // body wrapper so it fires wherever focus sits inside the dialog.
  function onKey(e: KeyboardEvent) {
    if (isSubmitChord(e)) submit();
  }
</script>

<!-- Composes the shared Modal (kind="dialog": Escape + backdrop dismiss, routed to
     onCancel). App gates this with {#if showDialog}, so it mounts open. The eyebrow
     keeps caret's dialog signature; the title is the fuller heading bits-ui wires as
     the accessible name. -->
<Modal
  kind="dialog"
  open
  eyebrow="Request changes"
  title="Send the plan back for revision"
  onDismiss={onCancel}
  onOpenAutoFocus={(e) => {
    // Land focus on the general-comment input rather than bits-ui's default
    // first-focusable; if the ref isn't bound yet, let bits-ui do its default.
    if (textarea) {
      e.preventDefault();
      textarea.focus();
    }
  }}
>
  <div class="body" role="presentation" onkeydown={onKey}>
    <label class="field">
      <span class="lbl">General comment</span>
      <Textarea
        bind:ref={textarea}
        value={generalComment}
        oninput={(e) => onGeneralCommentInput(e.currentTarget.value)}
        rows={4}
        placeholder="Describe the overall changes you want…"
      />
    </label>

    <div class="summary" class:empty>
      {#if empty}
        No comments yet — add inline comments or a general note to send.
      {:else}
        {countSummary}
      {/if}
    </div>
    {#if scratches.length > 0}
      <p class="drafts-hint">{draftsHint}</p>
    {/if}

    <!-- Unsent composer drafts ("scratches"): text typed into a line composer but
         never submitted. They are not committed comments — the count, empty-state,
         and preview above never include them — so they are surfaced here for a
         conscious Save (graduate into the sent feedback) or Discard, and the
         drafts-hint above states they won't be sent unless Saved. Each row keeps
         its Save/Discard OUTSIDE the collapsible (only the full-text preview
         collapses) and reads "unsent", never "Draft" (a created, pending
         annotation), so it never looks like a comment that was actually added. -->
    {#if scratches.length > 0}
      <section class="scratches" aria-labelledby="scratches-label">
        <span class="lbl" id="scratches-label">
          Unsent comments
          <Badge variant="outline" class="tally">{scratches.length}</Badge>
        </span>
        <p class="scratches-note">
          Comments you started but never sent. Save one to include it, or discard it.
        </p>
        {#each scratches as s (s.key)}
          <div class="scratch-row">
            <Collapsible.Root class="scratch-disclosure">
              <Collapsible.Trigger class="scratch-trigger">
                <span class="anchor metric">{rangeLabel(s.startLine, s.endLine)}</span>
                <span class="snippet">{s.text}</span>
              </Collapsible.Trigger>
              <Collapsible.Content>
                <pre class="scratch-text">{s.text}</pre>
              </Collapsible.Content>
            </Collapsible.Root>
            <div class="scratch-actions">
              <Button
                variant="secondary"
                size="sm"
                class="float-chip save"
                onclick={() => onSaveScratch(s.key)}
              >
                Save
              </Button>
              <Button
                variant="secondary"
                size="sm"
                class="float-chip discard"
                onclick={() => onDiscardScratch(s.key)}
              >
                Discard
              </Button>
            </div>
          </div>
        {/each}
      </section>
    {/if}

    {#if preview}
      <div class="preview">
        <Collapsible.Root>
          <Collapsible.Trigger class="preview-trigger">
            Preview feedback sent to the agent
          </Collapsible.Trigger>
          <Collapsible.Content>
            <pre>{preview}</pre>
          </Collapsible.Content>
        </Collapsible.Root>
      </div>
    {/if}
  </div>

  {#snippet footer()}
    <Button variant="secondary" class="float-chip" onclick={onCancel}>Cancel</Button>
    <Button
      onclick={submit}
      disabled={!preview}
      aria-keyshortcuts="Meta+Enter Control+Enter"
    >
      Send for revision
      <Kbd class="send-kbd" aria-hidden="true">
        <Icon name="command" size={12} /><Icon name="corner-down-left" size={12} />
      </Kbd>
    </Button>
  {/snippet}
</Modal>

<style>
  /* Body is a plain flow column; Modal's grid owns the header→body→footer rhythm,
     so this only needs the intra-body spacing. It also carries the ⌘↵ keydown
     (role="presentation": no semantics, mirrors the scrim's role in the old shell). */
  .body {
    display: grid;
    gap: 0.8rem;
  }
  .field {
    display: block;
  }
  .lbl {
    display: block;
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin-bottom: 0.4rem;
  }
  .summary {
    /* Matches the .mono atom's size (--text-sm) but stays in the sans face — this
       is a count summary, not code, so it takes the size without the mono font. */
    font-size: var(--text-sm);
    color: var(--ink-faint);
  }
  /* The empty-state nudge reads as guidance, not a tally — italic to set it apart
     from the count summary without spending a stronger ink or the accent. */
  .summary.empty {
    font-style: italic;
    color: var(--ink-soft);
  }
  /* The unsent-draft clarifier: the same muted register as the count summary,
     since it qualifies that count rather than competing with it. */
  .drafts-hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--ink-faint);
  }

  /* Unsent-scratch section: a quieter block than the committed-feedback preview,
     reading as "started, not sent". It borrows the source view's Resume-marker
     idiom — dashed neutral rails, transparent ground, no accent — so an unsent
     draft never carries the actionable accent the dialog reserves for real
     feedback. */
  .scratches {
    padding: 0.7rem 0.8rem;
    border: 1px dashed var(--rule);
    border-radius: var(--radius);
    background: var(--paper-sunk);
  }
  .scratches .lbl {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0;
  }
  /* The count chip beside the section label: an outline Badge, kept to the tabular
     metric face so a growing count stays fixed-width. */
  .scratches :global(.tally) {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-transform: none;
    letter-spacing: 0;
  }
  .scratches-note {
    margin: 0.35rem 0 0.6rem;
    font-size: var(--text-sm);
    color: var(--ink-faint);
  }
  /* One unsent draft: a flex row pairing a disclosure (anchor + one-line snippet,
     expanding to the full text) with always-visible Save/Discard. The dashed
     neutral left rail echoes SourceScratchMarker, so the dialog and the in-source
     affordance read as the same kind of thing. The actions sit OUTSIDE the
     disclosure, so they never hide behind its collapse (EXC-746). */
  .scratch-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    border-left: 3px dashed var(--ink-faint);
    border-radius: var(--radius);
    background: var(--paper);
    margin-top: 0.4rem;
    padding: 0.4rem 0.55rem;
  }
  .scratches :global(.scratch-disclosure) {
    flex: 1 1 auto;
    min-width: 0;
  }
  /* The disclosure trigger is a bits-ui Collapsible.Trigger (a <button>); reset its
     button chrome so it reads as the old <summary> line, not a control. */
  .scratches :global(.scratch-trigger) {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    text-align: start;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  /* The line-anchor label: a numeric chrome surface, so it takes the tabular
     metric face the rest of the review's line references use. */
  .scratch-row .anchor {
    flex: none;
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--ink-soft);
  }
  .scratch-row .snippet {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--text-base);
    color: var(--ink-soft);
  }
  .scratch-text {
    margin: 0.4rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    white-space: pre-wrap;
    color: var(--ink);
  }
  .scratch-actions {
    flex: none;
    display: flex;
    gap: 0.5rem;
  }

  /* Committed-feedback preview: a quiet sunk container behind a disclosure, showing
     exactly what the agent will receive. */
  .preview {
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper-sunk);
    overflow: hidden;
  }
  .preview :global(.preview-trigger) {
    display: block;
    width: 100%;
    padding: 0.5rem 0.7rem;
    border: 0;
    background: none;
    text-align: start;
    cursor: pointer;
    font-size: var(--text-xs);
    color: var(--ink-soft);
  }
  .preview pre {
    margin: 0;
    padding: 0.5rem 0.8rem 0.8rem;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    white-space: pre-wrap;
    color: var(--ink);
    border-top: 1px solid var(--rule);
  }

  /* The ⌘↵ cap rides inside the filled Send button, so it sheds the Kbd chip's own
     light fill and inherits the button ink — subtle glyphs on the amber, not a
     light box punched into it. */
  :global(.send-kbd) {
    background: transparent;
    color: inherit;
    opacity: 0.8;
  }
</style>
