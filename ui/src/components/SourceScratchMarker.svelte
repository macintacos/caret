<script lang="ts">
  // The line affordance for a retained but unsubmitted composer draft (a
  // "scratch"): text typed into the composer and dismissed without submitting.
  // Clicking it resumes the composer with the text restored.
  //
  // It reads "Unsent", the scratch's word everywhere it shows, never "Draft": that is
  // SourceAnnotationCard's state label for a saved comment, and a scratch was never
  // added to the working copy, so it must never read as an existing comment.
  import Icon from "@/components/Icon.svelte";

  interface Props {
    /** The retained draft text, previewed on one clamped line. */
    text: string;
    /** Resume editing: reopen the composer at this scratch's range. */
    onResume: () => void;
  }
  let { text, onResume }: Props = $props();
</script>

<button type="button" class="scratch tray" onclick={onResume} aria-label="Resume unsent comment">
  <span class="unsent"><Icon name="message-square-more" size={14} />Unsent</span>
  <span class="clamp-line preview">{text}</span>
  <span class="cap resume">Resume</span>
</button>

<style>
  /* A saved comment is a card resting on the page; a scratch was never added, so it
     sits in a well cut into it, tinted with the novelty hue the comment stamps use.
     Sized to the comment card so the rows line up. The whole row is the button, and
     the cap presses with it (styles/atoms.css). */
  .scratch {
    display: flex;
    width: 100%;
    max-width: min(46rem, 100%);
    margin: 0.4rem 0 0.55rem;
    border: none;
    background: color-mix(in lab, var(--well-floor), var(--attention) var(--unsent-floor));
    font: inherit;
    text-align: left;
    cursor: pointer;
    /* Opacity-only, never size: the row's measured height must not move (the
       preventScroll guard depends on it). */
    animation: reveal var(--dur-state) var(--ease-out);
  }
  .scratch:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }
  /* Inked like a comment stamp's word, so its hue matches the Draft stamp's while the
     word and glyph tell the two apart. */
  .unsent {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding-inline: 0.45rem 0.2rem;
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: color-mix(in lab, var(--attention), var(--stamp-word-toward) var(--stamp-word-mix));
  }
  .preview {
    padding-inline: 0.4rem 0.55rem;
    font-size: var(--text-sm);
  }
  .resume {
    flex: none;
    display: inline-flex;
    align-items: center;
    height: 1.5rem;
    padding: 0 0.55rem;
    font-size: var(--text-xs);
    font-weight: 600;
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
