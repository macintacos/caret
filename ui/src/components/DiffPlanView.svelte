<script lang="ts">
  // Source-view plan surface: renders the active plan version's stored text as
  // line-numbered markdown source through the diffview SourceView wrapper, with
  // a left-hand filterable contents pane and a line gutter for creating comments.
  // The contents pane jumps the source view to a heading's line. Hovering a line
  // shows the built-in gutter `+`; clicking it opens an inline composer at the
  // selected line or range, and submitting creates a line-anchored
  // {startLine, endLine} annotation in the autosave working copy. Saved comments
  // and the open composer render inline in the library's per-line annotation rows
  // (see annotationSlot.ts): the wrapper is fed one line annotation per anchored
  // line so the library reserves the row, and the card/composer DOM is projected
  // into that row's slot, so a comment sits between the code lines instead of
  // floating over them. The wrapper owns the @pierre/diffs lifecycle and preserves
  // the view instance across re-renders when the contentKey is unchanged, so
  // scroll survives the 2s poll re-delivering the same version.
  //
  // When the review has multiple stored versions, a compare control lets the
  // reviewer diff any two of them (base vs. target) through the SourceDiffView
  // wrapper, switching the split/unified layout at runtime. The contents pane,
  // gutter, and annotations belong to the single-version view only — compare mode
  // is a clean read-only diff with none of them.
  import SourceView from "../lib/diffview/SourceView.svelte";
  import SourceDiffView from "../lib/diffview/SourceDiffView.svelte";
  import { slotInto, toLineAnnotations } from "../lib/diffview/annotationSlot.ts";
  import { createSourceCommenting } from "../lib/diffview/commenting.ts";
  import { buildLinkLayer } from "../lib/diffview/links.ts";
  import { readDiffStyle, writeDiffStyle } from "../lib/diffStylePref.ts";
  import { type CompareStore, createCompare } from "../state/compare.svelte.ts";
  import VersionComparePicker from "./VersionComparePicker.svelte";
  import type { SourceViewGutter } from "../lib/diffview/options.ts";
  import type { SourceViewApi } from "../lib/diffview/types.ts";
  import { activeHeadingLine, extractHeadings } from "../lib/toc.ts";
  import {
    type Annotation,
    type ClientReview,
    isLegacyAnnotation,
    isLineAnnotation,
  } from "@core/types";
  import SourceComposer from "./SourceComposer.svelte";
  import SourceAnnotationCard from "./SourceAnnotationCard.svelte";
  import LegacyAnnotationList from "./LegacyAnnotationList.svelte";
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
    /** The working-copy annotations to display over the source. */
    annotations: Annotation[];
    /** The single focused annotation id (drives expand + highlight), or null. */
    focusedAnnotation: string | null;
    onEditAnnotation: (id: string, comment: string) => void;
    onDeleteAnnotation: (id: string) => void;
    onFocusAnnotation: (id: string) => void;
  }

  let {
    review,
    onCreateLineAnnotation,
    annotations,
    focusedAnnotation,
    onEditAnnotation,
    onDeleteAnnotation,
    onFocusAnnotation,
  }: Props = $props();

  // Line-anchored annotations render inline in the source view's per-line
  // annotation rows; legacy (selection-anchored) annotations have no line and
  // list read-only below the view. Both narrow from the same on-disk union.
  const lineAnnotations = $derived(annotations.filter(isLineAnnotation));
  const legacyAnnotations = $derived(annotations.filter(isLegacyAnnotation));

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

  // The imperative API the SourceView hands us once mounted: scroll-to-line plus
  // the host element whose annotation slots we project comments into.
  let api = $state<SourceViewApi | undefined>();
  const host = $derived(api?.host);

  // The source line of the heading currently in the reading zone. Tracked from
  // the scroll container's topmost rendered line so the pane highlights the
  // section being read.
  let activeLine = $state<number | null>(null);
  // The scroll container (the .diff-plan element), used by the ToC tracking to
  // read the topmost visible line.
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
  // when it opens or closes. The controller owns the state machine; this is the
  // view's read of it.
  let pending = $state<{ startLine: number; endLine: number } | undefined>();

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

  const gutter: SourceViewGutter = {
    enableGutterUtility: true,
    enableLineSelection: true,
    onGutterUtilityClick: (range) => commenting.open({ start: range.start, end: range.end }),
    // caret fills the library's annotation slots itself (see annotationSlot.ts), so
    // the library's own renderAnnotation callback — disabled in container-managed
    // mode anyway — goes unused; the option is required by the bag's shape.
    renderAnnotation: () => undefined,
  };

  // One library line annotation per anchored line — the saved comments plus the
  // open composer — so the library reserves an inline annotation row whose slot we
  // fill with the card/composer DOM (see annotationSlot.ts). Comments anchor to
  // their last line, so a multi-line comment sits below its whole range. Memoized
  // by the line set so an unchanged poll tick keeps the same array reference and
  // the wrapper skips a redundant library re-render.
  let annoKey: string | undefined;
  let annoValue: ReturnType<typeof toLineAnnotations> = [];
  const sourceAnnotations = $derived.by(() => {
    const lines = [...lineAnnotations.map((a) => a.endLine), ...(pending ? [pending.endLine] : [])];
    const key = [...new Set(lines)].sort((a, b) => a - b).join(",");
    if (annoKey !== key) {
      annoKey = key;
      annoValue = toLineAnnotations(lines);
    }
    return annoValue;
  });
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
        annotations={sourceAnnotations}
        {gutter}
        {contentKey}
        onReady={(a) => (api = a)}
        onLineComment={(line) => commenting.open({ start: line, end: line })}
      />
      <!-- Saved comments and the open composer are projected into the library's
           per-line annotation rows (slotInto), so they render inline between the
           code lines at their anchor line rather than floating over them. -->
      {#each lineAnnotations as a (a.id)}
        <div use:slotInto={{ host, line: a.endLine }}>
          <SourceAnnotationCard
            annotation={a}
            focused={a.id === focusedAnnotation}
            onFocus={onFocusAnnotation}
            onEdit={onEditAnnotation}
            onDelete={onDeleteAnnotation}
          />
        </div>
      {/each}
      {#if pending}
        <div use:slotInto={{ host, line: pending.endLine }}>
          <SourceComposer
            startLine={pending.startLine}
            endLine={pending.endLine}
            onSubmit={(comment) => commenting.submit(comment)}
            onCancel={() => commenting.cancel()}
          />
        </div>
      {/if}
    {/if}
  </div>
</div>

{#if legacyAnnotations.length > 0}
  <LegacyAnnotationList annotations={legacyAnnotations} />
{/if}

<style>
  /* The contents pane and source view share one row; the pane is a fixed-width
     left lane, the source view takes the rest and scrolls on its own. */
  .diff-surface {
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  /* Fills the content row and scrolls on its own; the SourceView renders its
     line grid (and the inline annotation rows) inside. */
  .diff-plan {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    background: var(--paper);
  }
</style>
