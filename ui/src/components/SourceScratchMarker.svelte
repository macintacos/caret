<script lang="ts">
  // The line affordance for a retained but unsubmitted composer draft (a
  // "scratch"): text the reviewer typed into the composer and then dismissed
  // without submitting. It renders inline in the source view's per-line
  // annotation row (the parent projects it into the library's slot — see
  // annotationSlot.ts), like a comment card, but reads as a quieter, pre-card
  // affordance — a dashed left rail and a transparent ground — so it never looks
  // like a comment that was actually added. Clicking it resumes the composer with
  // the text restored.
  //
  // Its badge reads "Resume" — an action, not a state — kept deliberately
  // distinct from SourceAnnotationCard's "Draft" state label (a created, pending
  // annotation). A scratch was never added to the working copy; the marker offers
  // to keep typing, not to show an existing comment.
  interface Props {
    /** The retained draft text, previewed on one clamped line. */
    text: string;
    /** Resume editing: reopen the composer at this scratch's range. */
    onResume: () => void;
  }
  let { text, onResume }: Props = $props();
</script>

<button class="scratch" type="button" onclick={onResume} aria-label="Resume unsent comment">
  <span class="badge">Resume</span>
  <span class="preview">{text}</span>
</button>

<style>
  /* Inline within the library's annotation row, sized to match the comment chip
     so the rows line up — but visibly pre-card: a dashed left rail and a
     transparent ground read as "started, not added", against the comment card's
     solid raised paper and solid accent rail. */
  .scratch {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    width: 100%;
    max-width: min(46rem, 100%);
    text-align: left;
    margin: 0.4rem 0 0.55rem;
    padding: 0.3rem 0.55rem;
    background: transparent;
    border: 1px dashed var(--rule);
    border-left: 3px dashed var(--ink-faint);
    border-radius: var(--radius);
    cursor: pointer;
    transition: border-color var(--dur-fast) var(--ease-out);
    /* Opacity-only reveal, matching the comment chip and composer, so the row's
       measured height never moves (the preventScroll guard depends on it). The
       global reduced-motion rule in app.css collapses it to a static frame. */
    animation: reveal var(--dur-fast) var(--ease-out);
  }
  .scratch:hover {
    border-color: var(--rule-strong);
    border-left-color: var(--ink-soft);
  }
  /* The action badge: a quiet, neutral tag. Neutral ink (not amber) keeps it off
     the brand-active hue that SourceAnnotationCard's unresolved "Draft" dot owns,
     so the two affordances stay visually distinct. */
  .badge {
    flex: none;
    font-size: var(--text-2xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--ink-faint);
    line-height: var(--leading-none);
  }
  .preview {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--text-base);
    color: var(--ink-soft);
  }
  @keyframes reveal {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
