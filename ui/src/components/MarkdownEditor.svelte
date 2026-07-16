<script lang="ts">
  // The comment-editing surface, and the ONE swap boundary for the editor engine
  // (paired with its CodeMirror config in ../lib/markdownEditor.ts). It wraps
  // CodeMirror 6 in the "syntax-visible" paradigm: the markdown syntax characters
  // stay on screen, but prose stays sans, inline/fenced code switches to
  // monospace, links get the accent colour, and bold/italic/headings render — all
  // while the value remains the literal markdown string. Swapping to another
  // engine (e.g. Milkdown) means reimplementing only this component and its config
  // module against the prop contract below; SourceComposer, the annotation-card
  // edit field, and the saved-comment render path are insulated from the choice.
  import { EditorState } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { untrack } from "svelte";
  import { markdownExtensions } from "$lib/markdownEditor.ts";

  interface Props {
    /** Initial markdown, seeded once at mount (a resumed scratch restores here). */
    value?: string;
    placeholder?: string;
    /** Focus on mount with { preventScroll: true } (the inline-reveal guard). */
    autofocus?: boolean;
    ariaLabel?: string;
    /** Live value on every edit (and once with the seed at mount). */
    onInput?: (text: string) => void;
    /** ⌘/Ctrl+Enter. */
    onSubmitChord?: () => void;
    /** Esc. */
    onCancelChord?: () => void;
  }
  let {
    value = "",
    placeholder = "",
    autofocus = false,
    ariaLabel = "",
    onInput,
    onSubmitChord,
    onCancelChord,
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
      // The composer is slot-projected into the diffs library's shadow DOM, so
      // CodeMirror's default root (getRootNode() → that ShadowRoot) doesn't match
      // where the slotted light-DOM content is focus-tracked (the document). CM
      // gates focus on root.activeElement === contentDOM, so a mismatched root
      // leaves it never focused — no visible caret, and typing desyncs. This bit
      // the edit-a-saved-comment path, where CM mounts inside the already-placed
      // container; anchoring the root at the document keeps focus detection right.
      root: document,
      state: EditorState.create({
        doc: seed,
        extensions: markdownExtensions({
          placeholder: untrack(() => placeholder),
          ariaLabel: untrack(() => ariaLabel),
          onInput: (text) => onInput?.(text),
          onSubmitChord: () => onSubmitChord?.(),
          onCancelChord: () => onCancelChord?.(),
        }),
      }),
    });

    // Surface the seed so the host holds the live text from the first frame, then
    // focus without scrolling (the composer opens inline at an already-visible
    // line; a scrolling focus slams the container to the document bottom).
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
