<script lang="ts">
  // The comment-editing surface, and the ONE swap boundary for the editor engine
  // (paired with its CodeMirror config in ../lib/markdownEditor.ts). Swapping to
  // another engine means reimplementing only this component and that config module
  // against the prop contract below; SourceComposer, the annotation-card edit field
  // and the saved-comment render path are insulated from the choice.
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { untrack } from "svelte";
  import type { ReviewContext } from "$lib/editorCompletion.ts";
  import { markdownExtensions } from "$lib/markdownEditor.ts";

  interface Props {
    /** Initial markdown, seeded once at mount (a resumed scratch restores here). */
    value?: string;
    placeholder?: string;
    /** Focus on mount with { preventScroll: true } (the inline-reveal guard). */
    autofocus?: boolean;
    ariaLabel?: string;
    /** Reflected onto the editor's `aria-required` when set (the required-field
     * signal a dialog's general-comment field carries). Omitted leaves it off.
     * ponytail: seeded once at mount like the rest of the config, so a field whose
     * required-ness flips while the editor is open keeps its mount value (the
     * reactive disabled-submit guard stays the source of truth). Upgrade to a live
     * attribute — a contentDOM effect or a CM Compartment — only if a field needs
     * the signal to toggle mid-edit. */
    ariaRequired?: boolean;
    /** Live value on every edit (and once with the seed at mount). */
    onInput?: (text: string) => void;
    /** ⌘/Ctrl+Enter. */
    onSubmitChord?: () => void;
    /** Esc. */
    onCancelChord?: () => void;
    /** The review this editor composes feedback for, so reference completion can
     * resolve against it (files under its cwd, skills for its adapter). Every
     * feedback surface passes it; omitted, the editor simply offers no completion.
     * ponytail: a mount-time seed like the rest of the config, so a host that
     * outlives a review switch would keep the old context. DiffPlanView is exactly
     * such a host — App keeps it mounted across a switch on purpose — but every
     * editor under it is unmounted or rebuilt by that switch, so none survives to
     * hold a stale context. Upgrade to a live value — a CM Compartment — if a host
     * ever survives a switch with its editor open. */
    reviewContext?: ReviewContext;
  }
  let {
    value = "",
    placeholder = "",
    autofocus = false,
    ariaLabel = "",
    ariaRequired,
    onInput,
    onSubmitChord,
    onCancelChord,
    reviewContext,
  }: Props = $props();

  let host = $state<HTMLDivElement | undefined>();

  $effect(() => {
    if (!host) return;
    // Seed once: prop changes after mount must not rebuild the editor (mirrors
    // SourceComposer's untrack seed). Callbacks are read live inside the
    // listeners, so they are not effect dependencies.
    const seed = untrack(() => value);
    const view = new EditorView({
      parent: host,
      // The composer is slot-projected into the diffs library's shadow DOM, but the
      // slotted light-DOM content is focus-tracked on the document. CM gates focus
      // on root.activeElement === contentDOM, so CodeMirror's default root (that
      // ShadowRoot) leaves it never focused — no caret, and typing desyncs.
      root: document,
      state: EditorState.create({
        doc: seed,
        extensions: markdownExtensions({
          placeholder: untrack(() => placeholder),
          ariaLabel: untrack(() => ariaLabel),
          ariaRequired: untrack(() => ariaRequired),
          onInput: (text) => onInput?.(text),
          onSubmitChord: () => onSubmitChord?.(),
          onCancelChord: () => onCancelChord?.(),
          reviewContext: untrack(() => reviewContext),
        }),
      }),
    });

    // Surface the seed so the host holds the live text from the first frame, then
    // focus without scrolling — the composer opens inline at an already-visible
    // line, and a scrolling focus slams the container to the document bottom.
    onInput?.(seed);
    if (untrack(() => autofocus)) view.contentDOM.focus({ preventScroll: true });

    return () => view.destroy();
  });
</script>

<div class="md-editor" bind:this={host}></div>

<style>
  .md-editor {
    width: 100%;
    box-sizing: border-box;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
  }
  .md-editor:focus-within {
    border-color: var(--accent);
  }
</style>
