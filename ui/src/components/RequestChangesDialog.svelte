<script lang="ts">
  import { type Annotation, isLineAnnotation, type LineAnnotation } from "@core/types";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { type ComposerScratch, rangeLabel } from "../lib/diffview/commenting.ts";
  import { formatFeedback, pendingInline, pendingLineCount } from "../lib/feedback.ts";
  import { isSubmitChord } from "../lib/keys.ts";
  import ConfirmPopover from "./ConfirmPopover.svelte";
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
    // Discard a committed inline comment outright (with confirmation) — the same
    // delete path as the in-source annotation card (EXC-762).
    onDiscardAnnotation: (id: string) => void;
    // "Mark as draft": demote a committed line comment into the unsent-scratch
    // section. Only line-anchored comments can demote (a scratch is line-ranged).
    onDraftAnnotation: (annotation: LineAnnotation) => void;
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
    onDiscardAnnotation,
    onDraftAnnotation,
  }: Props = $props();

  // The general-comment input, focused on open via the Modal's onOpenAutoFocus
  // hook (bits-ui owns initial focus; this lands it on the primary input).
  let textarea = $state<HTMLElement | null>(null);

  // Live preview of exactly what the agent will receive.
  let preview = $derived(formatFeedback(annotations, generalComment, planText));
  // The committed inline comments actually reaching the agent (non-blank), each
  // listed below for a per-comment Discard or Mark-as-draft.
  let inlineComments = $derived(pendingInline(annotations));
  let inlineCount = $derived(inlineComments.length);
  // Distinct source locations the pending comments anchor to; only worth showing
  // when it's smaller than the comment count (several comments share a line),
  // otherwise "N comments on N lines" just restates the count.
  let lineCount = $derived(pendingLineCount(annotations));
  // The dialog has nothing to send: no inline comments and a blank general note.
  // Shows a nudge instead of a hollow "0 comments" tally.
  let empty = $derived(inlineCount === 0 && generalComment.trim().length === 0);
  // The general comment is required only when it is the sole possible content —
  // no inline comment will be included, so a blank note leaves nothing to send.
  // When inline comments exist it is genuinely optional, and the label says so.
  let generalRequired = $derived(inlineCount === 0);
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

  // Which row's Discard confirmation is open — keyed (annotation id / scratch key)
  // so exactly one ConfirmPopover shows at a time. Mark-as-draft and Save are
  // non-destructive and skip the bubble.
  let confirmingAnnotation = $state<string | null>(null);
  let confirmingScratch = $state<string | null>(null);

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
     the accessible name. contentClass is a plain marker the dialog styles below to
     widen past the (unscanned) Tailwind default — see the width rule. -->
<Modal
  kind="dialog"
  open
  eyebrow="Request changes"
  title="Send the plan back for revision"
  contentClass="rcd-content"
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
      <span class="lbl">
        General comment{#if !generalRequired}<span class="optional"> (optional)</span>{/if}
      </span>
      <Textarea
        bind:ref={textarea}
        value={generalComment}
        oninput={(e) => onGeneralCommentInput(e.currentTarget.value)}
        rows={4}
        required={generalRequired}
        aria-required={generalRequired}
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

    <!-- Committed inline comments: each will be sent, and each can be Discarded
         (with confirmation) or Marked as a draft — demoted into "Unsent comments"
         below, where it drops out of the compiled preview and can be Saved back.
         Line-anchored comments can demote; legacy selection-anchored ones (no line
         range) offer Discard only. Actions sit OUTSIDE the collapsible so they never
         hide behind a collapse (the EXC-746 guard, applied here too). -->
    {#if inlineComments.length > 0}
      <section class="inline-comments" aria-labelledby="inline-label">
        <span class="lbl" id="inline-label">
          Inline comments
          <Badge variant="outline" class="tally">{inlineCount}</Badge>
        </span>
        {#each inlineComments as a (a.id)}
          <div class="inline-row">
            <Collapsible.Root class="inline-disclosure">
              <Collapsible.Trigger class="row-trigger">
                <Icon name="chevron-down" size={14} />
                <span class="anchor metric">
                  {isLineAnnotation(a) ? rangeLabel(a.startLine, a.endLine) : "Comment"}
                </span>
                <span class="snippet">{a.comment}</span>
              </Collapsible.Trigger>
              <Collapsible.Content>
                <pre class="row-text">{a.comment}</pre>
              </Collapsible.Content>
            </Collapsible.Root>
            <div class="inline-actions">
              {#if isLineAnnotation(a)}
                <Button
                  variant="secondary"
                  size="sm"
                  class="float-chip mark-draft"
                  onclick={() => onDraftAnnotation(a)}
                >
                  Mark as draft
                </Button>
              {/if}
              <span class="confirm-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  class="float-chip discard"
                  onclick={() => (confirmingAnnotation = a.id)}
                >
                  Discard
                </Button>
                {#if confirmingAnnotation === a.id}
                  <ConfirmPopover
                    question="Discard this comment?"
                    confirmLabel="Discard"
                    align="start"
                    onConfirm={() => {
                      onDiscardAnnotation(a.id);
                      confirmingAnnotation = null;
                    }}
                    onCancel={() => (confirmingAnnotation = null)}
                  />
                {/if}
              </span>
            </div>
          </div>
        {/each}
      </section>
    {/if}

    <!-- Unsent composer drafts ("scratches"): text typed into a line composer but
         never submitted. They are not committed comments — the count, empty-state,
         and preview never include them — so they are surfaced here for a conscious
         Save (graduate into the sent feedback) or Discard (with confirmation). Each
         row keeps its Save/Discard OUTSIDE the collapsible (only the full-text
         preview collapses) and reads "unsent", never "Draft" (a created, pending
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
              <Collapsible.Trigger class="row-trigger">
                <Icon name="chevron-down" size={14} />
                <span class="anchor metric">{rangeLabel(s.startLine, s.endLine)}</span>
                <span class="snippet">{s.text}</span>
              </Collapsible.Trigger>
              <Collapsible.Content>
                <pre class="row-text">{s.text}</pre>
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
              <span class="confirm-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  class="float-chip discard"
                  onclick={() => (confirmingScratch = s.key)}
                >
                  Discard
                </Button>
                {#if confirmingScratch === s.key}
                  <ConfirmPopover
                    question="Discard this comment?"
                    confirmLabel="Discard"
                    align="start"
                    onConfirm={() => {
                      onDiscardScratch(s.key);
                      confirmingScratch = null;
                    }}
                    onCancel={() => (confirmingScratch = null)}
                  />
                {/if}
              </span>
            </div>
          </div>
        {/each}
      </section>
    {/if}

    {#if preview}
      <div class="preview">
        <Collapsible.Root>
          <Collapsible.Trigger class="preview-trigger">
            <Icon name="chevron-down" size={14} />
            Compiled feedback preview
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
    <Button onclick={submit} disabled={!preview} aria-keyshortcuts="Meta+Enter Control+Enter">
      Send for revision
      <Kbd class="send-kbd" aria-hidden="true">
        <Icon name="command" size={12} /><Icon name="corner-down-left" size={12} />
      </Kbd>
    </Button>
  {/snippet}
</Modal>

<style>
  /* Widen the modal past the shadcn default. contentClass rides through Modal to
     the portalled Dialog.Content, but app.css scans only lib/components/ui for
     Tailwind, so a max-w utility written here would never be generated — this plain
     :global rule sets the width directly. Specificity (0,2,0) beats the vendored
     `.sm:max-w-sm` (0,1,0); min() keeps the small-screen inset. */
  :global([data-slot="dialog-content"].rcd-content) {
    max-width: min(900px, calc(100% - 2rem));
  }

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
  /* The "(optional)" qualifier on the general-comment label: a soft, un-uppercased
     aside so it reads as a note on the field, not part of the label proper. It
     appears only while inline comments exist (the field is then genuinely optional);
     with none, the label drops it and the field is required. */
  .optional {
    text-transform: none;
    letter-spacing: 0;
    color: var(--ink-faint);
    font-weight: 400;
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

  /* Committed inline comments: a solid-railed block (they WILL be sent), distinct
     from the dashed, unsent scratch block below. Quiet sunk ground; the solid rail
     reads "committed" against the scratch rows' dashed "started, not sent". */
  .inline-comments {
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper-sunk);
  }
  .inline-comments .lbl {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.4rem;
  }
  .inline-row {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    border-left: 3px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--paper);
    margin-top: 0.4rem;
    padding: 0.4rem 0.55rem;
  }
  .inline-comments :global(.inline-disclosure) {
    flex: 1 1 auto;
    min-width: 0;
  }
  .inline-actions {
    flex: none;
    display: flex;
    gap: 0.5rem;
  }

  /* Unsent-scratch section: a quieter block than the committed feedback, reading as
     "started, not sent". It borrows the source view's Resume-marker idiom — dashed
     neutral rails, transparent ground, no accent — so an unsent draft never carries
     the actionable accent the dialog reserves for real feedback. */
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
  /* The count chip beside a section label: an outline Badge, kept to the tabular
     metric face so a growing count stays fixed-width. */
  :global(.tally) {
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
  .scratch-actions {
    flex: none;
    display: flex;
    gap: 0.5rem;
  }

  /* Shared row disclosure trigger (inline + scratch): a bits-ui Collapsible.Trigger
     (a <button>) reset to read as a plain summary line — a rotating chevron, the
     line anchor, and a one-line snippet that expands to the full text. */
  :global(.row-trigger) {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    text-align: start;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  /* The line-anchor label: a numeric chrome surface, so it takes the tabular metric
     face the rest of the review's line references use. */
  .anchor {
    flex: none;
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--ink-soft);
  }
  .snippet {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--text-base);
    color: var(--ink-soft);
  }
  .row-text {
    margin: 0.4rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    white-space: pre-wrap;
    color: var(--ink);
  }

  /* Save graduates a scratch into the sent feedback; Discard drops it. On hover
     each takes its semantic tint — green for the keep, red for the drop — so the
     consequence reads before the click. Resting state stays the quiet float-chip. */
  :global(.save) {
    transition:
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  :global(.save:hover) {
    color: var(--ok);
    border-color: var(--ok);
  }
  :global(.discard) {
    transition:
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  :global(.discard:hover) {
    color: var(--danger);
    border-color: var(--danger);
  }
  /* Anchors a Discard's ConfirmPopover to the button (it renders absolutely inside
     this positioned wrapper — the pattern SourceAnnotationCard's delete uses). */
  .confirm-wrap {
    position: relative;
    display: inline-flex;
  }

  /* Committed-feedback preview: a quiet sunk container behind a disclosure, showing
     exactly what the agent will receive after the draft/discard edits above. */
  .preview {
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper-sunk);
    overflow: hidden;
  }
  .preview :global(.preview-trigger) {
    display: flex;
    align-items: center;
    gap: 0.4rem;
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
  }

  /* The disclosure chevron: one vendored chevron-down per trigger, rotated by the
     Collapsible's data-state — right (▶) when closed, down (▼) when open — so it
     reads as a standard disclosure. Scoped under .rcd-content (this dialog's
     content) so the global selector can't reach collapsibles elsewhere. */
  :global(.rcd-content [data-slot="collapsible-trigger"] svg) {
    flex: none;
    color: var(--ink-faint);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  :global(.rcd-content [data-slot="collapsible-trigger"][data-state="closed"] svg) {
    transform: rotate(-90deg);
  }

  /* Animated expand/collapse via the grid-template-rows 0fr↔1fr technique: the
     content row grows from 0 to its natural height while its single child clips, so
     both directions animate smoothly with no height measurement and no mount flash.
     The vendored Collapsible.Content always renders its child (hiding is left to
     CSS), so a collapsed disclosure stays in the DOM — just 0-height and clipped.
     Scoped to this dialog's content. The one global reduced-motion rule in app.css
     neutralizes it (a per-component block would be dead CSS — see motion.test.ts). */
  :global(.rcd-content [data-slot="collapsible-content"]) {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows var(--dur-base) var(--ease-out);
  }
  :global(.rcd-content [data-slot="collapsible-content"][data-state="open"]) {
    grid-template-rows: 1fr;
  }
  :global(.rcd-content [data-slot="collapsible-content"] > *) {
    min-height: 0;
    overflow: hidden;
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
