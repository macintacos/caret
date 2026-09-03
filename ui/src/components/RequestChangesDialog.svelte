<script lang="ts">
  // The Request Changes dialog: where the reviewer composes the general comment
  // and reviews the queued inline annotations and retained scratches before
  // feedback is submitted to the agent. A controlled view — its editable state
  // (general comment, scratches) lives in App.svelte so it survives the dialog
  // unmounting on Cancel / Escape / scrim.
  import { type Annotation, isLineAnnotation, type LineAnnotation } from "@core/lib/types";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
  import { type ComposerScratch, rangeLabel } from "$lib/diffview/commenting.ts";
  import type { ReviewContext } from "$lib/editorCompletion.ts";
  import { formatFeedback, pendingInline, pendingLineCount, sourceLines } from "$lib/feedback.ts";
  import { isSubmitChord } from "$lib/keys.ts";
  import { ariaKeyshortcutsFor } from "$lib/shortcuts/index.ts";
  import ConfirmPopover from "@/components/ConfirmPopover.svelte";
  import Icon from "@/components/Icon.svelte";
  import MarkdownEditor from "@/components/MarkdownEditor.svelte";
  import Modal from "@/components/Modal.svelte";
  import SubmitCap from "@/components/SubmitCap.svelte";

  interface Props {
    // Controlled open — false while the dialog plays its exit.
    open: boolean;
    // The surface finished its exit and may be unmounted.
    onClosed?: () => void;
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
    // The review being sent back, forwarded to the general-comment editor so
    // reference completion resolves against it.
    reviewContext?: ReviewContext;
  }
  let {
    open,
    onClosed,
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
    reviewContext,
  }: Props = $props();

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

  function submit() {
    onSubmit(generalComment.trim());
  }
  // Escape-to-dismiss is owned by bits-ui (Modal's onDismiss → onCancel); this
  // handler carries only caret's own ⌘↵/Ctrl+Enter submit chord, and rides the
  // body wrapper so it fires wherever focus sits inside the dialog. The
  // MarkdownEditor already intercepts the chord (and preventDefault's it) when
  // focus is inside it, so guard on !defaultPrevented to avoid a double submit.
  function onKey(e: KeyboardEvent) {
    if (isSubmitChord(e) && !e.defaultPrevented) submit();
  }
</script>

<!-- Composes the shared Modal (kind="dialog": Escape + backdrop dismiss, routed to
     onCancel). The host mounts this per open (ModalPresence) and keeps it through
     the exit. The eyebrow keeps caret's dialog signature; the title is the fuller
     heading bits-ui wires as the accessible name. contentClass is a plain marker the
     dialog styles below to widen past the (unscanned) Tailwind default — see the
     width rule. -->
<Modal
  kind="dialog"
  {open}
  {onClosed}
  eyebrow="Request changes"
  title="Send the plan back for revision"
  contentClass="rcd-content"
  onDismiss={onCancel}
  onOpenAutoFocus={(e) => {
    // MarkdownEditor autofocuses its own contenteditable on mount (with
    // preventScroll); prevent bits-ui's default first-focusable focus so it
    // stays on the editor rather than jumping to the first button.
    e.preventDefault();
  }}
>
  <div class="body" role="presentation" onkeydown={onKey}>
    <div class="field">
      <span class="form-label">
        General comment{#if !generalRequired}<span class="optional"> (optional)</span>{/if}
      </span>
      <!-- The live-markdown composer (the same swap boundary as the inline
           comment editor): styles markdown as you type. Autofocused on open;
           ⌘↵ submits and Esc dismisses via the chord callbacks. -->
      <MarkdownEditor
        value={generalComment}
        placeholder="Describe the overall changes you want…"
        ariaLabel="General comment"
        ariaRequired={generalRequired}
        {reviewContext}
        autofocus
        onInput={onGeneralCommentInput}
        onSubmitChord={submit}
        onCancelChord={onCancel}
      />
    </div>

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
        <span class="form-label" id="inline-label">
          Inline comments
          <Badge variant="outline" class="tally">{inlineCount}</Badge>
        </span>
        <!-- A real list, so assistive tech gets a count and each row's position
             instead of a flat run of buttons (EXC-1057). Unnamed on purpose: the
             enclosing section is already a named region, and a name here would be
             announced twice and duplicate the label's text a third time. -->
        <ul class="row-list">
          {#each inlineComments as a (a.id)}
            {@const context = isLineAnnotation(a)
              ? sourceLines(a.startLine, a.endLine, planText)
              : []}
            <li class="inline-row">
              <Collapsible.Root class="inline-disclosure">
                <!-- Row head: the disclosure trigger and the per-comment actions on
                     one centered line. The actions ride the head (never the collapsing
                     body) so they show without expanding (the EXC-746 guard). -->
                <div class="row-head">
                  <Collapsible.Trigger class="row-trigger">
                    <Icon name="chevron-down" size={14} />
                    <span class="anchor metric">
                      {isLineAnnotation(a) ? rangeLabel(a.startLine, a.endLine) : "Comment"}
                    </span>
                    <span class="clamp-line">{a.comment}</span>
                  </Collapsible.Trigger>
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
                    {@render discard(() => onDiscardAnnotation(a.id))}
                  </div>
                </div>
                <Collapsible.Content>
                  <div class="row-body">
                    <pre class="row-text">{a.comment}</pre>
                    <!-- Nested, collapsed-by-default: the actual source lines the
                         comment anchors to, so the reviewer can read the code it was
                         written against without leaving the dialog (EXC-762). Only for
                         line-anchored comments with a live anchor. -->
                    {#if context.length > 0}
                      <Collapsible.Root class="context-disclosure">
                        <Collapsible.Trigger class="row-trigger context-trigger">
                          <Icon name="chevron-down" size={14} />
                          <span class="context-label">Context</span>
                        </Collapsible.Trigger>
                        <Collapsible.Content>
                          <pre class="context-lines">{context.join("\n")}</pre>
                        </Collapsible.Content>
                      </Collapsible.Root>
                    {/if}
                  </div>
                </Collapsible.Content>
              </Collapsible.Root>
            </li>
          {/each}
        </ul>
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
        <span class="form-label" id="scratches-label">
          Unsent comments
          <Badge variant="outline" class="tally">{scratches.length}</Badge>
        </span>
        <p class="scratches-note">
          Comments you started but never sent. Save one to include it, or discard it.
        </p>
        <ul class="row-list">
          {#each scratches as s (s.key)}
            <li class="scratch-row">
              <Collapsible.Root class="scratch-disclosure">
                <div class="row-head">
                  <Collapsible.Trigger class="row-trigger">
                    <Icon name="chevron-down" size={14} />
                    <span class="anchor metric">{rangeLabel(s.startLine, s.endLine)}</span>
                    <span class="clamp-line">{s.text}</span>
                  </Collapsible.Trigger>
                  <div class="scratch-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      class="float-chip save"
                      onclick={() => onSaveScratch(s.key)}
                    >
                      Save
                    </Button>
                    {@render discard(() => onDiscardScratch(s.key))}
                  </div>
                </div>
                <Collapsible.Content>
                  <pre class="row-text">{s.text}</pre>
                </Collapsible.Content>
              </Collapsible.Root>
            </li>
          {/each}
        </ul>
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
    <Button onclick={submit} disabled={!preview} aria-keyshortcuts={ariaKeyshortcutsFor("editor.submit")}>
      Send for revision
      <SubmitCap />
    </Button>
  {/snippet}
</Modal>

<!-- Discarding is the destructive one, so it routes through a confirmation; Mark as
     draft and Save do not. The bubble owns its own open state and anchors itself to
     the trigger — this dialog's body scrolls, and bits-ui tracks the button through
     it. Only one settles open: opening a second row's bubble is an outside
     interaction that dismisses the first, though the loser plays its exit before
     leaving the DOM. -->
{#snippet discard(onConfirm: () => void)}
  <ConfirmPopover question="Discard this comment?" confirmLabel="Discard" {onConfirm}>
    {#snippet trigger(props)}
      <Button {...props} variant="secondary" size="sm" class="float-chip discard">Discard</Button>
    {/snippet}
  </ConfirmPopover>
{/snippet}

<style>
  /* Widen the modal past the shadcn default. contentClass rides through Modal to
     the portalled Dialog.Content, but app.css scans only lib/components/ui for
     Tailwind, so a max-w utility written here would never be generated — this plain
     :global rule sets the width directly. Specificity (0,2,0) beats the vendored
     `.sm:max-w-sm` (0,1,0); min() keeps the small-screen inset. */
  :global([data-slot="dialog-content"].rcd-content) {
    /* Shared --confirm-dialog-width token (app.css) so this and the approve/reject
       guard (UnsentCommentsDialog's .guard-content) track one width. */
    max-width: min(var(--confirm-dialog-width), calc(100% - 2rem));
    /* Cap the height so a long inline-comment list can't push the modal past the
       screen (it clipped at top and bottom before). The content is a header /
       body / footer grid; pinning the outer rows to auto and the body to 1fr lets
       ONLY the body scroll, keeping the title and the Send/Cancel actions in view.
       dvh tracks the mobile URL-bar viewport. */
    max-height: calc(100dvh - 2rem);
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  /* Body is the scroll region when the content overflows the capped height; Modal's
     grid owns the header→body→footer rhythm, so this only needs the intra-body
     spacing plus the overflow. min-height:0 lets it actually shrink inside the grid
     row rather than forcing the modal taller. It also carries the ⌘↵ keydown
     (role="presentation": no semantics, mirrors the scrim's role in the old shell). */
  .body {
    display: grid;
    /* Pin the single column to minmax(0, 1fr): without the explicit `0` min, grid
       items default to min-width:auto (min-content) and a long unbroken comment
       expands the column past the modal, forcing a horizontal scroll and shoving
       the row's action buttons off-screen. This is what keeps the buttons in view
       and lets the snippet truncate instead. */
    grid-template-columns: minmax(0, 1fr);
    gap: 0.8rem;
    overflow-y: auto;
    min-height: 0;
  }
  .field {
    display: block;
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
  .inline-comments .form-label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.4rem;
  }
  /* Both row groups are real lists (EXC-1057); the ul carries no spacing of its
     own, which lives on .inline-row / .scratch-row below. */
  .row-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .inline-row {
    border-left: 3px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--paper);
    margin-top: 0.4rem;
    padding: 0.15rem 0.25rem;
  }
  .inline-comments :global(.inline-disclosure) {
    min-width: 0;
  }
  /* The always-visible top line of a row: the disclosure trigger (grows) and the
     per-row actions, vertically centered so a taller action button and the one-line
     trigger read as a single row rather than top-aligned and off-kilter. The
     collapsing body sits below this head, so the actions never hide on collapse. */
  .row-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .inline-actions,
  .scratch-actions {
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
  .scratches .form-label {
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
    border-left: 3px dashed var(--ink-faint);
    border-radius: var(--radius);
    background: var(--paper);
    margin-top: 0.4rem;
    padding: 0.15rem 0.25rem;
  }
  .scratches :global(.scratch-disclosure) {
    min-width: 0;
  }

  /* Shared row disclosure trigger (inline + scratch + nested context): a bits-ui
     Collapsible.Trigger (a <button>) reset to read as a plain summary line — a
     rotating chevron, the line anchor, and a one-line snippet that expands to the
     full text. It grows to fill the head; a subtle raised-paper wash on hover
     signals the whole line is clickable to toggle it. */
  :global(.row-trigger) {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.35rem 0.4rem;
    border: 0;
    border-radius: var(--radius);
    background: none;
    text-align: start;
    cursor: pointer;
    color: inherit;
    font: inherit;
    transition: background var(--dur-micro) var(--ease-out);
  }
  :global(.row-trigger:hover) {
    background: var(--paper-raised);
  }
  /* The expanded body of an inline row: the full comment, then the nested Context
     disclosure. Children carry their own inset so a scratch row (whose body has no
     wrapper) and an inline row read with the same left edge. */
  .row-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.35rem;
  }
  .context-label {
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  /* The quoted source lines — a quiet sunk block so the code reads as context
     beneath the comment, not another comment. */
  /* Every block of quoted text in the dialog — a comment's own text, the source
     lines it anchors to, the compiled preview — is source, wrapped rather than
     scrolled. Each rule below adds only its own inset and ink. */
  .context-lines,
  .row-text,
  .preview pre {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .context-lines {
    margin: 0.15rem 0 0;
    padding: 0.4rem 0.55rem;
    border-radius: var(--radius);
    background: var(--paper-sunk);
    color: var(--ink-soft);
  }
  /* The line-anchor label: a numeric chrome surface, so it takes the tabular metric
     face the rest of the review's line references use. */
  .anchor {
    flex: none;
    font-size: var(--text-2xs);
    font-weight: 600;
    color: var(--ink-soft);
  }
  .row-text {
    margin: 0;
    padding: 0.1rem 0.4rem 0.25rem;
    color: var(--ink);
  }

  /* Save graduates a scratch into the sent feedback; Discard drops it. On hover
     each takes its semantic tint — green for the keep, red for the drop — so the
     consequence reads before the click. Resting state stays the quiet float-chip. */
  :global(.save) {
    transition:
      color var(--dur-micro) var(--ease-out),
      border-color var(--dur-micro) var(--ease-out);
  }
  :global(.save:hover) {
    color: var(--ok);
    border-color: var(--ok);
  }
  :global(.discard) {
    transition:
      color var(--dur-micro) var(--ease-out),
      border-color var(--dur-micro) var(--ease-out);
  }
  :global(.discard:hover) {
    color: var(--danger);
    border-color: var(--danger);
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
    transition: background var(--dur-micro) var(--ease-out);
  }
  .preview :global(.preview-trigger:hover) {
    background: var(--paper-raised);
  }
  .preview pre {
    margin: 0;
    padding: 0.5rem 0.8rem 0.8rem;
    color: var(--ink);
  }

  /* The disclosure chevron: one vendored chevron-down per trigger, rotated by the
     Collapsible's data-state — right (▶) when closed, down (▼) when open — so it
     reads as a standard disclosure. Scoped under .rcd-content (this dialog's
     content) so the global selector can't reach collapsibles elsewhere. */
  :global(.rcd-content [data-slot="collapsible-trigger"] svg) {
    flex: none;
    color: var(--ink-faint);
    transition: transform var(--dur-micro) var(--ease-out);
  }
  :global(.rcd-content [data-slot="collapsible-trigger"][data-state="closed"] svg) {
    transform: rotate(-90deg);
  }

  /* Animated expand/collapse of the disclosure body (preview, inline/scratch rows,
     and the nested Context), so the content grows out of the trigger line rather
     than snapping in. Driven by bits-ui's own measured height var + data-state: on
     open it plays expand, on close it plays collapse, and the Collapsible's presence
     machine keeps the node mounted for the whole collapse keyframe (it waits for the
     animationend) before hiding it — a keyframe reveal, not a tween, is what that
     presence machine watches for. Scoped to this dialog's content. The one global
     reduced-motion rule in app.css neutralizes it (a per-component block would be
     dead CSS — see motion.test.ts). */
  :global(.rcd-content [data-slot="collapsible-content"]) {
    overflow: hidden;
  }
  :global(.rcd-content [data-slot="collapsible-content"][data-state="open"]) {
    animation: rcd-expand var(--dur-enter) var(--ease-out);
  }
  :global(.rcd-content [data-slot="collapsible-content"][data-state="closed"]) {
    animation: rcd-collapse var(--dur-exit) var(--ease-in);
  }
  @keyframes rcd-expand {
    from {
      height: 0;
    }
    to {
      height: var(--bits-collapsible-content-height);
    }
  }
  @keyframes rcd-collapse {
    from {
      height: var(--bits-collapsible-content-height);
    }
    to {
      height: 0;
    }
  }

</style>
