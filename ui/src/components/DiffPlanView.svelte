<script lang="ts">
  // Source-view plan surface: renders the active plan version's stored text as
  // line-numbered markdown source through the diffview SourceView wrapper. A
  // read-only surface — no gutter affordances, no annotations, no contents rail.
  // The wrapper owns the @pierre/diffs lifecycle and preserves the view instance
  // across re-renders when the contentKey is unchanged, so scroll survives the
  // 2s poll re-delivering the same version.
  //
  // When the review has multiple stored versions, a compare control lets the
  // reviewer diff any two of them (base vs. target) through the SourceDiffView
  // wrapper, switching the split/unified layout at runtime. Annotations are never
  // shown in compare mode — they belong to the single-version view.
  import SourceView from "../lib/diffview/SourceView.svelte";
  import SourceDiffView from "../lib/diffview/SourceDiffView.svelte";
  import { buildLinkLayer } from "../lib/diffview/links.ts";
  import { readDiffStyle, writeDiffStyle } from "../lib/diffStylePref.ts";
  import { type CompareStore, createCompare } from "../state/compare.svelte.ts";
  import VersionComparePicker from "./VersionComparePicker.svelte";
  import type { ClientReview } from "@core/types";

  interface Props {
    /** The review whose current plan version is rendered. */
    review: ClientReview;
  }

  let { review }: Props = $props();

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
  // with line parity preserved (so future line numbers match the stored plan).
  // Memoized on the plan text so an unchanged poll tick yields the SAME layer
  // reference — SourceView change-detects its options by reference, so a fresh
  // object each tick would trigger a redundant setOptions + repaint.
  let memo: { text: string; layer: ReturnType<typeof buildLinkLayer> } | undefined;
  const linkLayer = $derived.by(() => {
    if (memo?.text !== review.currentPlan) {
      memo = { text: review.currentPlan, layer: buildLinkLayer(review.currentPlan) };
    }
    return memo.layer;
  });

  const baseText = $derived(compare.planFor(review.versions, compareStore.baseVersion));
  const targetText = $derived(compare.planFor(review.versions, compareStore.targetVersion));
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

<div class="diff-plan">
  {#if showDiff}
    <!-- Compare mode: a diff between the selected version pair. Base is the
         reference version (the default base is the current version) and renders
         on the diff's "after" side; target is what it's compared against and
         renders on the "before" side — so the default current-vs-previous pair
         reads as the changes that produced the current version. Annotations are
         deliberately omitted. The layout switches at runtime via the picker (no
         remount). -->
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
      {contentKey}
    />
  {/if}
</div>

<style>
  /* Fills the content row and scrolls on its own; the SourceView container
     virtualizes its own lines inside. */
  .diff-plan {
    min-height: 0;
    overflow: auto;
    background: var(--paper);
  }
</style>
