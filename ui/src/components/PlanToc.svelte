<script lang="ts">
  // The plan's table-of-contents popup (EXC-1095): every heading at once, nested
  // by level, with the one being read marked and a filter field at the top. It
  // complements the breadcrumbs bar rather than replacing it — PlanBreadcrumbs is
  // the drill-down surface, this is the see-the-whole-shape-at-once one — and
  // takes the same three props, so both read one heading model and one activeLine.
  //
  // Built on `command` inside a `popover` rather than the `dropdown-menu` the bar
  // uses, which is the whole point of the epic: bits-ui puts role="menu" on
  // dropdown content, and a textbox is not a role `menu` admits as a child, so the
  // bar's own filter narrates nothing as its rows narrow (the deviation is
  // recorded in PlanBreadcrumbs.svelte's header). `command` gives combobox +
  // listbox semantics instead, so this surface starts without that defect.
  //
  // Presentational: no state beyond the popup's own open/query, the tree is
  // derived, and the parent owns both the heading set and the scroll tracking that
  // moves `activeLine`.
  //
  // Real-browser behavior — the keyboard walk, focus return, dismissal, narration
  // — is EXC-1096 and is deliberately not implemented here.
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Command from "$lib/components/ui/command/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { type FilteredHeadingNode, filteredHeadingTree } from "$lib/headingTrail.ts";
  import type { TocHeading } from "$lib/toc.ts";

  interface Props {
    /** Headings extracted from the plan source, in document order. */
    headings: TocHeading[];
    /** Source line of the heading currently in the reading zone, or null. The
     * same value PlanBreadcrumbs receives — this surface tracks no scroll of its
     * own. */
    activeLine: number | null;
    /** Jump the view to a heading's 1-based source line. */
    onJump: (line: number) => void;
  }

  let { headings, activeLine, onJump }: Props = $props();

  let open = $state(false);
  let query = $state("");
  let queryEl = $state<HTMLInputElement | null>(null);

  // The command's own selected row, which is what bits-ui scrolls into view. Set
  // to the heading being read on the open edge (below), so the popup opens looking
  // at where the reviewer already is. Rows are keyed on the source line rather
  // than on their text, so two identically titled sections stay distinct.
  let selected = $state("");

  // The whole tree when the query is empty, the filtered one otherwise —
  // `filteredHeadingTree` is documented to return the entire tree with everything
  // matched for an empty query, so this is ONE render path rather than a branch
  // between two views of the same model. It is built on the same `parentIndices`
  // walk `headingTree` is, in the same module, so the two can never disagree about
  // what encloses what.
  //
  // Every heading renders a row: caret plans are agent-authored markdown and sit
  // in the low hundreds of headings, which is well inside what the DOM handles at
  // this row complexity. List virtualization is out of scope until a real plan is
  // measured past that ceiling — see EXC-1062's Out of scope.
  const tree = $derived(filteredHeadingTree(headings, query));

  // Take the reviewer to a heading and leave. Closing here rather than letting the
  // row's select do it keeps the pick and the dismissal one action, the way
  // PlanBreadcrumbs' own jump() does.
  function jump(line: number): void {
    open = false;
    onJump(line);
  }
</script>

<!-- One level of the filtered tree, and then the levels under it. A snippet emits
     no wrapper element, so this recursion produces a FLAT sequence of rows in
     document order — which is what role="listbox" needs, since it admits `option`
     and `group` children and not rows nested inside rows. The tree's depth rides
     on --toc-depth instead, which the stylesheet turns into an indent.
     A match is a destination and renders as an option; a heading kept only to
     place a match under it renders as inert presentation. -->
{#snippet rows(nodes: FilteredHeadingNode[])}
  {#each nodes as node (node.heading.line)}
    {@const heading = node.heading}
    {#if node.matched}
      <Command.Item
        value={String(heading.line)}
        style="--toc-depth: {heading.level - 1}"
        aria-current={heading.line === activeLine ? "location" : undefined}
        onSelect={() => jump(heading.line)}
      >
        <span class="toc-label" title={heading.text}>{heading.text}</span>
      </Command.Item>
    {:else}
      <div class="toc-context" role="presentation" style="--toc-depth: {heading.level - 1}">
        <span class="toc-label" title={heading.text}>{heading.text}</span>
      </div>
    {/if}
    {@render rows(node.children)}
  {/each}
{/snippet}

<Popover.Root
  bind:open
  onOpenChange={(opening) => {
    // A popup always opens on the whole plan, looking at the heading being read.
    // Neither the query nor the row the last session walked to survives, so
    // reopening is never a stale view of a plan that has since scrolled.
    if (!opening) return;
    query = "";
    selected = activeLine === null ? "" : String(activeLine);
  }}
>
  <Popover.Trigger>
    {#snippet child({ props })}
      <!-- A neutral control, so it wears the topbar's chip surface rather than an
           outline or the amber primary (doc/agents/shadcn-rules.md § The caret
           surface language) — the same variant + class pairing the compare toggle
           beside it in the control row uses. -->
      <Button {...props} variant="secondary" size="sm" class="toc-trigger float-chip">
        Contents
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    class="plan-toc-panel"
    align="start"
    onOpenAutoFocus={(e) => {
      // The reviewer opened this to type, so focus goes to the field rather than
      // to the panel bits-ui would otherwise focus.
      e.preventDefault();
      queryEl?.focus();
    }}
  >
    <!-- shouldFilter={false} is load-bearing: the command ships a fuzzy filter
         that also RE-SORTS the rows by score, which would both fight the
         nesting-preserving filter above and shuffle document order. Filtering is
         the tree's job; the command's job here is the listbox semantics and the
         roving selection. -->
    <Command.Root shouldFilter={false} bind:value={selected}>
      <Command.Input
        bind:ref={queryEl}
        bind:value={query}
        placeholder="Filter headings…"
        aria-label="Filter headings"
      />
      <Command.List aria-label="Plan headings">
        {@render rows(tree)}
        <!-- Nothing to show, said in the row geometry rather than as an empty box.
             A plan with no headings is a different message from a query that hit
             nothing, and only the first is a property of the plan. -->
        {#if tree.length === 0}
          <p class="toc-empty">
            {headings.length === 0 ? "No headings in plan" : "No headings match"}
          </p>
        {/if}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>

<style>
  /* The trigger and the portalled panel both render outside this component's
     style scope — the panel because bits-ui teleports it to the body — so every
     rule here is :global and anchored on .toc-trigger / .plan-toc-panel, the same
     shape PlanBreadcrumbs uses for .plan-crumb-menu. Being unlayered, they also
     beat the copied components' own Tailwind utilities, which is what lets the
     panel hand its padding to the command inside it. */

  /* The whole affordance is .float-chip's; only the label's one-line promise is
     set here, so a narrow control row ellipsises the row rather than wrapping the
     trigger. */
  :global(.toc-trigger) {
    white-space: nowrap;
  }

  /* The vendored Popover.Content ships w-72 with padding and a gap of its own, and
     the Command inside already pads itself — so the padding is handed over rather
     than doubled, and the panel is widened enough to hold a deep heading before it
     truncates. */
  :global(.plan-toc-panel) {
    width: 20rem;
    padding: 0;
    gap: 0;
  }

  /* Both row kinds take the same box, so the tree's shape reads the same whether a
     row is a destination or the context placing one. Depth is the only geometry
     separating them, and it is the heading's own level rather than its position in
     the filtered tree — so a section sits at the same indent whether or not its
     ancestors matched. */
  :global(.plan-toc-panel [data-slot="command-item"]),
  :global(.plan-toc-panel .toc-context) {
    padding-inline-start: calc(0.5rem + var(--toc-depth, 0) * 0.75rem);
  }

  /* A heading kept only to place a match under it. It is quiet ink and takes no
     pointer — there is nothing to pick here, and a hover response would promise
     otherwise. The box matches the command's own row so the two interleave
     without a rhythm change. */
  :global(.plan-toc-panel .toc-context) {
    display: flex;
    align-items: center;
    padding-block: 0.375rem;
    padding-inline-end: 0.5rem;
    color: var(--ink-faint);
    font-size: var(--text-sm);
    pointer-events: none;
  }

  /* A long heading truncates in its row rather than stretching the panel to the
     width of the plan's longest one. */
  :global(.plan-toc-panel .toc-label) {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* The heading the reviewer is already on, marked with the amber wash the menu
     language reserves for the active choice (shadcn-rules.md § Menu highlight vs.
     selection) — the same mark PlanBreadcrumbs spends on the same job. */
  :global(.plan-toc-panel [aria-current="location"]) {
    background: var(--accent-wash);
    color: var(--ink);
  }
  /* The keyboard landing on the row the reviewer is already on: the wash warms
     toward the neutral --chip-hover every other highlighted row takes, so the
     amber keeps saying "you are here" while the fill still says "the keyboard is
     on it". */
  :global(.plan-toc-panel [aria-current="location"][data-selected]) {
    background: color-mix(in lab, var(--accent-wash), var(--chip-hover) 40%);
  }

  /* An empty list says why, at the quietest ink — the same weight the breadcrumbs'
     own no-match line takes. */
  :global(.plan-toc-panel .toc-empty) {
    margin: 0;
    padding: 0.5rem;
    color: var(--ink-faint);
    font-size: var(--text-xs);
  }
</style>
