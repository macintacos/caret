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
  // recorded in PlanBreadcrumbs.svelte's header).
  //
  // What that buys HERE is the structural half, and only that half: the field is a
  // legal sibling of the list, and the rows are real options a screen reader can
  // browse. The narration half is NOT closed yet. bits-ui computes the field's
  // `aria-controls` and `aria-activedescendant` from the command's viewport node,
  // and the vendored command-list.svelte renders no `Command.Viewport` — so both
  // come out null and nothing announces which option is active as the rows narrow.
  // Wiring that viewport is a change to the vendored primitive; the narration
  // contract that depends on it is EXC-1096. Do not read the combobox role alone
  // as evidence the bar's defect is fixed.
  //
  // Presentational: the only state is the popup's own — open, query, and the
  // command's selected row — the tree is derived, and the parent owns both the
  // heading set and the scroll tracking that moves `activeLine`.
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

  // The command's own selected row, seeded to the heading being read on the open
  // edge (below) so the popup opens looking at where the reviewer already is.
  // Rows are keyed on the source line rather than on their text, so two
  // identically titled sections stay distinct.
  //
  // Seeding it is also what SCROLLS that row into view, and the invariant that
  // rests on is worth stating because nothing in the markup shows it: bits-ui
  // scrolls a pre-set value into view only on the command's INITIAL mount, and the
  // command re-mounts on every open precisely because Popover.Content unmounts its
  // content on close. Giving the content `forceMount`, or hoisting Command.Root
  // outside the popover, would leave this line still assigning and the scroll
  // silently gone.
  let selected = $state("");

  // The whole tree when the query is empty, the filtered one otherwise —
  // `filteredHeadingTree` is documented to return the entire tree with everything
  // matched for an empty query, so this is ONE render path rather than a branch
  // between two views of the same model. It is built on the same `parentIndices`
  // walk `headingTree` is, in the same module, so the two can never disagree about
  // what encloses what.
  //
  // Every heading renders a row, and the ceiling that bounds is the low hundreds
  // of headings a caret plan carries — agent-authored markdown, not a book. What
  // costs at that scale is not this recompute (four linear passes over the
  // headings, microseconds) but what each row IS: a full bits-ui command item with
  // its own effects and id, and a Command.List that tears the whole list down and
  // rebuilds it whenever the query crosses between empty and non-empty. List
  // virtualization is out of scope until a real plan is measured past that ceiling
  // — see EXC-1062's Out of scope.
  const tree = $derived(filteredHeadingTree(headings, query));

  // Take the reviewer to a heading and leave. A command row does not dismiss its
  // host the way a menu item does, so the pick closes the popup itself.
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
     A match is a destination and renders as an option. A heading kept only to
     place a match under it is a plain div — never a Command.Item, so it joins
     neither the roving selection nor the primitive's item set — and is
     `aria-hidden`, which is stronger than the presentational role it reads as:
     `role="presentation"` strips an element's own role but leaves its text in the
     tree, and bare text is not something a listbox may own. So the ancestor names
     are sighted-only context for now. Handing them to assistive tech properly —
     as the option's own description rather than as loose rows — is EXC-1096's
     narration contract, not a gap to patch here. -->
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
      <div class="toc-context" aria-hidden="true" style="--toc-depth: {heading.level - 1}">
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
      <Button {...props} variant="secondary" size="sm" class="float-chip">Contents</Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    class="plan-toc-panel"
    align="start"
    onOpenAutoFocus={(e) => {
      // The reviewer opened this to type, so focus goes to the field rather than
      // to the panel bits-ui would otherwise focus. Suppressed only once there is
      // a field to hand it to: preventing the default with nothing to receive it
      // strands focus on the body, which loses Escape-to-close AND drops the
      // shortcut dispatcher's editing-context guard, so every bare plan key would
      // fire behind the open popup.
      if (queryEl === null) return;
      e.preventDefault();
      queryEl.focus();
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
      </Command.List>
      <!-- Nothing to show, said in the row geometry rather than as an empty box.
           A plan with no headings is a different message from a query that hit
           nothing, and only the first is a property of the plan.
           Deliberately a SIBLING of the list rather than a row inside it: it is a
           status message about the list, and a listbox may own options and groups
           but not a stray paragraph. -->
      {#if tree.length === 0}
        <p class="toc-empty">
          {headings.length === 0 ? "No headings in plan" : "No headings match"}
        </p>
      {/if}
    </Command.Root>
  </Popover.Content>
</Popover.Root>

<style>
  /* The panel renders outside this component's style scope — bits-ui teleports it
     to the body — so every rule here is :global and anchored on .plan-toc-panel,
     the same shape PlanBreadcrumbs uses for .plan-crumb-menu. Being unlayered,
     they also beat the copied components' own Tailwind utilities, which is what
     lets the panel hand its padding to the command inside it.
     The trigger needs no rule at all: .float-chip carries the whole affordance,
     and the Button recipe already pins the label to one line. */

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
     separating them, and it is the heading's own LEVEL rather than its position in
     the filtered tree — so a section sits at the same indent whether or not its
     ancestors matched, which is the property that keeps the list from reflowing
     under the reviewer as they type. The trade is an absolute origin: a plan whose
     top-level headings are `##` renders every row one step in, with nothing at
     zero. Accepted — a uniform offset costs nothing to read, where a shifting
     indent would. */
  :global(.plan-toc-panel [data-slot="command-item"]),
  :global(.plan-toc-panel .toc-context) {
    padding-inline-start: calc(0.5rem + var(--toc-depth, 0) * 0.75rem);
  }

  /* A heading kept only to place a match under it: quiet ink, and the same box as
     the command's own row so the two interleave without a rhythm change. Nothing
     suppresses pointer events here — the row is a plain div with no handler and no
     role, so there is no interaction to take away, and killing pointers would also
     kill the native tooltip that rescues a heading truncated at depth. */
  :global(.plan-toc-panel .toc-context) {
    display: flex;
    align-items: center;
    padding-block: 0.375rem;
    padding-inline-end: 0.5rem;
    color: var(--ink-faint);
    font-size: var(--text-sm);
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
