<script lang="ts">
  // Source-view plan surface: renders the active plan version's stored text as
  // line-numbered markdown source through the diffview SourceView wrapper, with
  // a left-hand filterable contents pane and a line gutter for creating comments.
  // The contents pane jumps the source view to a heading's line. Hovering a line
  // shows the built-in gutter `+`; clicking it opens an inline composer at the
  // selected line or range, and submitting creates a line-anchored
  // {startLine, endLine} annotation in the autosave working copy. The composer is
  // positioned at the chosen line's offset (the wrapper's File is
  // container-managed, which disables the library's renderAnnotation, so the
  // composer is rendered here rather than slotted by the library). The wrapper
  // owns the @pierre/diffs lifecycle and preserves the view instance across
  // re-renders when the contentKey is unchanged, so scroll survives the 2s poll
  // re-delivering the same version.
  //
  // When the review has multiple stored versions, a compare control lets the
  // reviewer diff any two of them (base vs. target) through the SourceDiffView
  // wrapper, switching the split/unified layout at runtime. The contents pane,
  // gutter, and annotations belong to the single-version view only — compare mode
  // is a clean read-only diff with none of them.
  import SourceView from "../lib/diffview/SourceView.svelte";
  import SourceDiffView from "../lib/diffview/SourceDiffView.svelte";
  import { createSourceCommenting } from "../lib/diffview/commenting.ts";
  import { buildLinkLayer } from "../lib/diffview/links.ts";
  import { readDiffStyle, writeDiffStyle } from "../lib/diffStylePref.ts";
  import { type CompareStore, createCompare } from "../state/compare.svelte.ts";
  import VersionComparePicker from "./VersionComparePicker.svelte";
  import type { SourceViewGutter } from "../lib/diffview/options.ts";
  import type { SourceViewApi } from "../lib/diffview/types.ts";
  import { activeHeadingLine, extractHeadings } from "../lib/toc.ts";
  import type { ClientReview } from "@core/types";
  import SourceComposer from "./SourceComposer.svelte";
  import SourceToc from "./SourceToc.svelte";

  interface Props {
    /** The review whose current plan version is rendered. */
    review: ClientReview;
    /** Persist a gutter-created line-anchored annotation. */
    onCreateLineAnnotation: (anchor: {
      startLine: number;
      endLine: number;
      comment: string;
    }) => void;
  }

  let { review, onCreateLineAnnotation }: Props = $props();

  // Compare state: the component owns the reactive store (runes live here) and
  // the factory mutates it; the layout-preference read/write are injected so the
  // factory stays pure. Annotation display is never wired here. The version/style
  // fields are placeholders — the init effect below sets the real default pair
  // and persisted layout as soon as the active review is established.
  let compareStore = $state<CompareStore>({
    comparing: false,
    baseVersion: 0,
    targetVersion: 0,
    diffStyle: "split",
  });
  const compare = createCompare(compareStore, {
    readPref: readDiffStyle,
    writePref: writeDiffStyle,
  });

  // Seed the default pair + persisted layout when the active review changes, and
  // reconcile the selected pair on every version-set change (a poll tick adding
  // a revision, or a switch to a different review).
  let lastReviewId: string | undefined;
  $effect(() => {
    if (review.id !== lastReviewId) {
      lastReviewId = review.id;
      compare.init(review.versions);
    } else {
      compare.syncVersions(review.versions);
    }
  });

  const canCompare = $derived(compare.canCompare(review.versions));
  const showDiff = $derived(canCompare && compareStore.comparing);

  // Identity of the rendered content: the wrapper recreates its instance only
  // when this changes, so a poll tick that re-delivers the same version updates
  // in place (scroll preserved) while a new version recreates the view.
  const contentKey = $derived(`${review.id}:${review.version}`);
  // The diff view's identity keys on the selected version pair, so picking a new
  // pair recreates it while a poll tick on an unchanged pair updates in place.
  const diffContentKey = $derived(
    `${review.id}:${compareStore.baseVersion}:${compareStore.targetVersion}`,
  );

  // The opt-in link layer: simplified display text plus per-line clickable spans,
  // with line parity preserved (so the headings' and gutter's line numbers match
  // the stored plan). Memoized on the plan text so an unchanged poll tick yields
  // the SAME layer reference — SourceView change-detects its options by reference,
  // so a fresh object each tick would trigger a redundant setOptions + repaint.
  let memo: { text: string; layer: ReturnType<typeof buildLinkLayer> } | undefined;
  const linkLayer = $derived.by(() => {
    if (memo?.text !== review.currentPlan) {
      memo = { text: review.currentPlan, layer: buildLinkLayer(review.currentPlan) };
    }
    return memo.layer;
  });

  const baseText = $derived(compare.planFor(review.versions, compareStore.baseVersion));
  const targetText = $derived(compare.planFor(review.versions, compareStore.targetVersion));

  // Headings scanned from the formatted source (fence-aware). Line numbers index
  // the stored plan text, which matches the view's per-line data-line, so a jump
  // lands on the right row. Memoized on the plan text alongside the link layer.
  let headingMemo: { text: string; headings: ReturnType<typeof extractHeadings> } | undefined;
  const headings = $derived.by(() => {
    if (headingMemo?.text !== review.currentPlan) {
      headingMemo = { text: review.currentPlan, headings: extractHeadings(review.currentPlan) };
    }
    return headingMemo.headings;
  });

  // The imperative scroll API the SourceView hands us once mounted.
  let api: SourceViewApi | undefined;

  // The source line of the heading currently in the reading zone. Tracked from
  // the scroll container's topmost rendered line so the pane highlights the
  // section being read.
  let activeLine = $state<number | null>(null);
  // The scroll container (the .diff-plan element). Shared by the ToC tracking
  // (topmost visible line) and the gutter composer's line-offset positioning.
  let scrollEl = $state<HTMLElement | undefined>();

  // Recompute the active heading from the view's topmost visible source line,
  // throttled with rAF so a scroll burst settles into one read. The view paints
  // each line as <div data-line="N"> in a shadow root; the first row whose
  // bottom sits below the container's top edge is the top visible line.
  function topVisibleLine(): number | null {
    const rows = scrollEl?.querySelector(".diffview")?.shadowRoot?.querySelectorAll<HTMLElement>(
      "[data-line]",
    );
    if (rows == null || rows.length === 0) return null;
    const top = scrollEl!.getBoundingClientRect().top;
    for (const row of rows) {
      if (row.getBoundingClientRect().bottom > top) {
        const n = Number(row.getAttribute("data-line"));
        return Number.isFinite(n) ? n : null;
      }
    }
    return null;
  }

  $effect(() => {
    const el = scrollEl;
    if (!el) return;
    // depend on the heading set so tracking re-arms after a version change
    void headings;
    let raf = 0;
    const update = () => {
      const top = topVisibleLine();
      if (top != null) activeLine = activeHeadingLine(headings, top);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  });

  // Reactive mirror of the controller's pending target, so the composer renders
  // and re-positions when it opens or closes. The controller owns the state
  // machine; this is the view's read of it.
  let pending = $state<{ startLine: number; endLine: number } | undefined>();
  // Vertical offset (px) of the pending line within the scroll container, where
  // the composer anchors.
  let composerTop = $state(0);

  const commenting = createSourceCommenting({
    onCreate: (anchor) => onCreateLineAnnotation(anchor),
    onChange: () => {
      pending = commenting.pending();
    },
  });

  // Discard an open composer when the rendered content changes (a new version
  // arrives, or the review switches): its line anchor belongs to the prior text,
  // so submitting it onto the new version would mis-anchor. contentKey is the
  // reactive trigger.
  $effect(() => {
    void contentKey;
    commenting.cancel();
  });

  // Offset of `lineNumber` (1-based) within the scroll container: the line row's
  // top relative to the container, plus the current scroll. Falls back to 0 when
  // the row isn't found (e.g. virtualized out), keeping the composer in view.
  function lineOffset(lineNumber: number): number {
    const shadow = scrollEl?.querySelector(".diffview")?.shadowRoot;
    const row = shadow?.querySelector(`[data-line-index="${lineNumber - 1}"]`);
    if (row == null || scrollEl == null) return scrollEl?.scrollTop ?? 0;
    const rowRect = row.getBoundingClientRect();
    const hostRect = scrollEl.getBoundingClientRect();
    return rowRect.top - hostRect.top + scrollEl.scrollTop;
  }

  const gutter: SourceViewGutter = {
    enableGutterUtility: true,
    onGutterUtilityClick: (range) => {
      composerTop = lineOffset(Math.min(range.start, range.end));
      commenting.open({ start: range.start, end: range.end });
    },
    // Container-managed mode disables library annotation rendering; the option is
    // required by the bag's shape, so it returns nothing here.
    renderAnnotation: () => undefined,
  };
</script>

{#if canCompare}
  <VersionComparePicker
    versions={review.versions}
    comparing={compareStore.comparing}
    baseVersion={compareStore.baseVersion}
    targetVersion={compareStore.targetVersion}
    diffStyle={compareStore.diffStyle}
    onSetComparing={compare.setComparing}
    onSelectBase={compare.setBase}
    onSelectTarget={compare.setTarget}
    onSetDiffStyle={compare.setDiffStyle}
  />
{/if}

<div class="diff-surface">
  <!-- The contents pane and gutter composer are the single-version surface only.
       Compare mode is a clean diff with no ToC, no gutter, no annotations. -->
  {#if !showDiff}
    <SourceToc {headings} {activeLine} onJump={(line) => api?.scrollToLine(line)} />
  {/if}
  <div class="diff-plan" bind:this={scrollEl}>
    {#if showDiff}
      <!-- Compare mode: a diff between the selected version pair. Base is the
           reference version (the default base is the current version) and renders
           on the diff's "after" side; target is what it's compared against and
           renders on the "before" side — so the default current-vs-previous pair
           reads as the changes that produced the current version. Annotations and
           the gutter are deliberately omitted. The layout switches at runtime via
           the picker (no remount). -->
      <SourceDiffView
        oldDoc={{ name: "plan.md", text: targetText }}
        newDoc={{ name: "plan.md", text: baseText }}
        contentKey={diffContentKey}
        options={{ diffStyle: compareStore.diffStyle }}
      />
    {:else}
      <SourceView
        doc={{ name: "plan.md", text: linkLayer.text }}
        links={linkLayer.spans}
        {gutter}
        {contentKey}
        onReady={(a) => (api = a)}
      />
      {#if pending}
        <SourceComposer
          startLine={pending.startLine}
          endLine={pending.endLine}
          top={composerTop}
          onSubmit={(comment) => commenting.submit(comment)}
          onCancel={() => commenting.cancel()}
        />
      {/if}
    {/if}
  </div>
</div>

<style>
  /* The contents pane and source view share one row; the pane is a fixed-width
     left lane, the source view takes the rest and scrolls on its own. */
  .diff-surface {
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  /* Fills the content row and scrolls on its own; the SourceView container
     virtualizes its own lines inside. position: relative anchors the absolutely
     positioned composer to this scroll container. */
  .diff-plan {
    flex: 1 1 auto;
    min-width: 0;
    position: relative;
    min-height: 0;
    overflow: auto;
    background: var(--paper);
  }
</style>
