<script lang="ts">
  // The line affordance for a retained but unsubmitted composer draft (a
  // "scratch"): text typed into the composer and dismissed without submitting.
  // Clicking it resumes the composer with the text restored.
  //
  // Its badge reads "Resume" — an action, not a state — kept deliberately distinct
  // from SourceAnnotationCard's "Draft" state label. A scratch was never added to
  // the working copy, so it must never read as an existing comment.
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";

  interface Props {
    /** The retained draft text, previewed on one clamped line. */
    text: string;
    /** Resume editing: reopen the composer at this scratch's range. */
    onResume: () => void;
  }
  let { text, onResume }: Props = $props();
</script>

<Button variant="ghost" class="scratch" onclick={onResume} aria-label="Resume unsent comment">
  <!-- Neutral ink, off the brand-active amber that SourceAnnotationCard's
       unresolved "Draft" dot owns. -->
  <Badge variant="outline" class="quiet-badge">Resume</Badge>
  <span class="clamp-line preview">{text}</span>
</Button>

<style>
  /* Sized to match the comment chip so the rows line up, but dashed and
     transparent against the card's solid paper: "started, not added". The
     compound [data-slot] selector (0,2,0) outranks the copied Button's
     utilities. */
  :global([data-slot="button"].scratch) {
    display: flex;
    width: 100%;
    height: auto;
    max-width: min(46rem, 100%);
    align-items: baseline;
    justify-content: flex-start;
    gap: 0.45rem;
    margin: 0.4rem 0 0.55rem;
    padding: 0.3rem 0.55rem;
    text-align: left;
    font-weight: 400;
    background: transparent;
    border: 1px dashed var(--rule);
    border-left: 3px dashed var(--ink-faint);
    border-radius: var(--radius);
    transition: border-color var(--dur-micro) var(--ease-out);
    /* Opacity-only, never size: the row's measured height must not move (the
       preventScroll guard depends on it). */
    animation: reveal var(--dur-micro) var(--ease-out);
  }
  :global([data-slot="button"].scratch:hover) {
    background: transparent;
    border-color: var(--rule-strong);
    border-left-color: var(--ink-soft);
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
