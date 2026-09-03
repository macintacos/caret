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
  //
  // The marker is a shadcn Button and the tag a shadcn Badge (EXC-765); the dashed
  // pre-card treatment is re-applied over the copied Button via :global below.
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
  <!-- Neutral ink (not amber), which keeps it off the brand-active hue that
       SourceAnnotationCard's unresolved "Draft" dot owns, so the two
       affordances stay visually distinct. -->
  <Badge variant="outline" class="quiet-badge">Resume</Badge>
  <span class="clamp-line preview">{text}</span>
</Button>

<style>
  /* Inline within the library's annotation row, sized to match the comment chip
     so the rows line up — but visibly pre-card: a dashed left rail and a
     transparent ground read as "started, not added", against the comment card's
     solid raised paper and solid accent rail. The compound [data-slot] selector
     (0,2,0) outranks the copied Button's utilities so these overrides win. */
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
    /* Opacity-only reveal, matching the comment chip and composer, so the row's
       measured height never moves (the preventScroll guard depends on it). The
       global reduced-motion rule in app.css collapses it to a static frame. */
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
