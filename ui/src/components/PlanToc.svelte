<script lang="ts">
  // The plan's outline (EXC-1095): every heading at once, nested by level, with the one
  // being read latched. It complements the breadcrumbs rather than replacing them —
  // PlanBreadcrumbs is the drill-down surface, this is the see-the-whole-shape-at-once
  // one — and reads the same heading model and activeLine they do.
  //
  // It stands in one of two places, which DiffPlanView picks: a column cut into the
  // window's body left of the plan, or a float dropped from the plan header's outline key
  // where the column has no room. The column opens its filter on `\`; the float always
  // shows it, focused.
  //
  // Built on `command`, which buys both halves of the listbox contract (EXC-1096):
  // structurally the field is a legal sibling of the list and the rows are real options a
  // screen reader can browse; for narration, the field carries `aria-controls` and
  // `aria-activedescendant`, so the row the roving walk lands on is announced as the list
  // narrows without focus ever leaving the field. Those two attributes are bits-ui's,
  // derived from the command's viewport node — which exists only because the vendored
  // command-list.svelte renders a `Command.Viewport`; read the comment there before
  // touching it.
  //
  // The list shows TWO views of one heading model (EXC-1103), and the query picks between
  // them. Empty, it is the whole plan nested by level — the browsing view. Filtered, each
  // ancestor path collapses into ONE breadcrumb header with its matches flush left beneath
  // it, because a match four levels down otherwise spends four rows placing itself.
  //
  // That header is a `Command.Group` heading rather than markup of caret's own: a listbox
  // may own options and groups and NOT loose text, and bits-ui wires the heading up as the
  // group's `aria-labelledby` target, so the ancestor path reaches a screen reader as the
  // group's name.
  //
  // Presentational: the only state is the outline's own — whether the filter is open, the
  // query, and the command's selected row. The parent owns the heading set, the plan and
  // its comments, and the scroll tracking that moves `activeLine`.
  import type { PlanVersion } from "@core/lib/types";
  import { type Snippet, tick, untrack } from "svelte";

  import { Button } from "$lib/components/ui/button/index.js";
  import * as Command from "$lib/components/ui/command/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import type { CommentIndexEntry } from "$lib/feedback.ts";
  import {
    groupedHeadingMatches,
    type HeadingGroup,
    type HeadingNode,
    headingTree,
  } from "$lib/headingTrail.ts";
  import { createKeyRepeat, walkCommandList } from "$lib/keyRepeat.ts";
  import { ariaKeyshortcutsFor } from "$lib/shortcuts/index.ts";
  import { sound } from "$lib/sound.ts";
  import { headingMatcher, type TocHeading } from "$lib/toc.ts";
  import {
    describeSection,
    plural,
    type SectionDelta,
    sectionCounts,
    tocSections,
  } from "$lib/tocSections.ts";

  import Icon from "@/components/Icon.svelte";
  import KbdCap from "@/components/KbdCap.svelte";

  interface Props {
    /** Headings extracted from the plan source, in document order. */
    headings: TocHeading[];
    /** Source line of the heading currently in the reading zone, or null. The
     * same value PlanBreadcrumbs receives — this surface tracks no scroll of its
     * own. */
    activeLine: number | null;
    /** The plan source the headings were extracted from. */
    plan: string;
    /** The plan's comments and unsent drafts, anchored to `plan`'s lines. */
    comments: CommentIndexEntry[];
    /** The version before the current one, or null on a plan's first version. */
    previous: Pick<PlanVersion, "version" | "plan"> | null;
    /** Jump the view to a heading's 1-based source line. */
    onJump: (line: number) => void;
    /** A column cut into the body beside the plan, or a float over it. */
    placement: "column" | "float";
    /** While comparing, what each changed section gained and lost, keyed on its
     * heading's line. Only those sections are listed; null off compare. */
    deltas?: Map<number, SectionDelta> | null;
    /** Whether `activeLine` moves because the reader jumped to a heading, which fades the
     * latch across, rather than because the plan scrolled, which snaps it. */
    latchGlides?: boolean;
    /** Whether the keycaps are shown (the Show Hints setting). The keys work either
     * way. */
    showShortcutHints?: boolean;
    /** Hide the column (its head's Hide outline key). */
    onHide?: () => void;
    /** Hand the parent an action that opens the filter and focuses it, so `\` can
     * reach the column. */
    onExposeFilter?: (open: () => void) => void;
    /** What sits at the column's foot. */
    foot?: Snippet;
  }

  let {
    headings,
    activeLine,
    plan,
    comments,
    previous,
    onJump,
    placement,
    deltas = null,
    latchGlides = false,
    showShortcutHints = false,
    onHide,
    onExposeFilter,
    foot,
  }: Props = $props();

  const uid = $props.id();
  // The float exists only to filter, so it opens with the field; the column shows it
  // on `\` or its Outline key.
  let filtering = $state(untrack(() => placement === "float"));
  // The column's filter just closed, so its rows rise back into the field's room.
  let filterClosed = $state(false);
  let query = $state("");
  let queryEl = $state<HTMLInputElement | null>(null);

  // The row Enter picked in the float, which plays the key's press while the float
  // leaves.
  let pressedLine = $state<number | null>(null);

  // Hold-to-repeat for the walk keys (EXC-1122): a held key moves once, pauses,
  // then runs at the app's own cadence rather than the OS's. The lifecycle and the
  // reason it cannot be left to the OS are in $lib/keyRepeat.ts.
  const repeat = createKeyRepeat();
  $effect(() => repeat.stop);

  // The latch snaps when the plan scrolls it along: motion on a change that runs constantly
  // under a scroll reads as lag. The rows' transitions are off for the frame it moves in.
  let latchSnap = $state(false);
  let latchedBefore = untrack(() => activeLine);
  $effect.pre(() => {
    const line = activeLine;
    if (line === latchedBefore) return;
    latchedBefore = line;
    latchSnap = !untrack(() => latchGlides);
    if (latchSnap) requestAnimationFrame(() => (latchSnap = false));
  });

  // Tab walks the list instead of leaving it (EXC-1102), and the arrows join it for
  // the cadence (EXC-1122). The claim itself is walkCommandList's, shared with the
  // breadcrumbs bar's filter panel — the same primitive over the same kind of field.
  function onWalkKeydown(e: KeyboardEvent): void {
    walkCommandList(e, queryEl, repeat);
  }

  // The command's own selected row, seeded to the heading being read whenever the filter
  // opens, so the walk starts where the reviewer already is. Rows are keyed on the source
  // line rather than on their text, so two identically titled sections stay distinct.
  // It starts there too: bits-ui selects the first row of a command mounted with no
  // value, and that pending selection would land after a later seed.
  let selected = $state(untrack(() => (activeLine === null ? "" : String(activeLine))));

  // Two views of one heading model, and which one is showing is the whole of
  // EXC-1103. Trimmed rather than a bare `!== ""` so the boundary matches
  // `filterHeadings`' own notion of empty — a stray space must not swap the view.
  const searching = $derived(query.trim() !== "");

  // Both views are built on the same `parentIndices` walk in the same module, so they
  // can never disagree about what encloses what. `$derived` is lazy, so only the view
  // actually rendered below is ever computed.
  //
  // Every heading renders a row, bounded by the low hundreds of headings a caret plan
  // carries — agent-authored markdown, not a book. List virtualization is out of scope
  // until a real plan is measured past that ceiling (EXC-1062).
  const listed = $derived(deltas === null ? headings : headings.filter((h) => deltas.has(h.line)));
  const tree = $derived(headingTree(listed));
  const groups = $derived(groupedHeadingMatches(listed, query));
  const sections = $derived(tocSections(headings, plan, comments, previous?.plan ?? null));
  const shown = $derived(searching ? groups.flatMap((g) => g.matches) : listed);

  // The level the PLAN opens at, which is where its indent guides start (EXC-1106).
  // The indent itself is measured from level 1 — that absolute origin is what keeps a
  // section at one indent whatever else is on screen — so a plan whose top-level
  // headings are `##` renders every row one step in with nothing at zero, and guides
  // measured from that empty column would run down a column the plan never opens.
  // The empty arm is unreachable (a plan with no headings renders no rows to read it);
  // it is what keeps Math.min() off Infinity.
  const guideBase = $derived(listed.length === 0 ? 1 : Math.min(...listed.map((h) => h.level)));

  // What a row marks — the SAME closure `filterHeadings` decides membership with, reached
  // from beside the filter rather than by transforming what it returns. Why deriving the
  // runs from its OUTPUT silently empties the list is written once, in toc.ts.
  const matcher = $derived(headingMatcher(query));

  // What the status line says, empty when the list has rows. Derived rather than
  // inlined in the markup because the element it feeds is always mounted (a live region
  // cannot be conjured up with its text already inside it).
  const emptyMessage = $derived(
    (searching ? groups.length : tree.length) > 0
      ? ""
      : listed.length > 0
        ? "No headings match"
        : deltas === null
          ? "No headings in plan"
          : "No sections changed",
  );
  const noMatch = $derived(searching && groups.length === 0 && listed.length > 0);

  // Opening the filter starts on the whole plan, looking at the heading being read, so
  // it is never a stale view of a plan that has since scrolled. The cue sounds from here
  // so the `\` key and a click cannot drift onto different sounds.
  function seed(): void {
    query = "";
    selected = activeLine === null ? "" : String(activeLine);
    pressedLine = null;
    sound.play("contentsOpen");
  }

  // The float's field is focused by its host as it opens; the column's mounts with
  // this call, so it takes focus once it is in the DOM.
  // The field takes room at the list's top, so the heading being read is brought back
  // into view under it.
  async function openFilter(): Promise<void> {
    seed();
    filtering = true;
    filterClosed = false;
    await tick();
    queryEl?.focus();
    rootEl?.querySelector('[aria-current="location"]')?.scrollIntoView({ block: "nearest" });
  }

  function closeFilter(): void {
    repeat.stop();
    query = "";
    filtering = untrack(() => placement === "float");
    filterClosed = !filtering;
  }

  // The float mounts on every open, so its mount is its open.
  $effect(() => {
    if (untrack(() => placement) === "float") untrack(seed);
  });

  $effect(() => {
    untrack(() => onExposeFilter)?.(openFilter);
  });

  // The column stands for the whole review, so it keeps the heading being read in view
  // as the reader moves. bits-ui scrolls its selection into view only on its own mount.
  let rootEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (placement !== "column" || activeLine === null) return;
    void tick().then(() =>
      rootEl?.querySelector('[aria-current="location"]')?.scrollIntoView({ block: "nearest" }),
    );
  });

  // Escape is one step out: a query clears, then the filter closes and focus leaves the
  // outline, which stays on screen with nothing in it focused. The float's host closes
  // the float on Escape instead.
  function onFieldKeydown(e: KeyboardEvent): void {
    if (placement !== "column" || e.key !== "Escape") return;
    e.preventDefault();
    if (searching) {
      query = "";
      return;
    }
    queryEl?.blur();
    closeFilter();
  }

  // Take the reviewer to a heading. A pick from the filter drops focus into the plan
  // rather than leaving it ringed on a field they are done with; `\` brings it back.
  function jump(line: number): void {
    repeat.stop();
    if (placement === "float") pressedLine = line;
    else if (filtering) {
      queryEl?.blur();
      closeFilter();
    }
    onJump(line);
  }

  // The no-match state's way back. The click took focus to the cap, so it goes back to
  // the field the reviewer was typing in.
  function clearFilter(): void {
    query = "";
    queryEl?.focus();
  }

  // A group's header text: its ancestor path, root-most first. Empty segments drop
  // out — `# ` on its own line is a real heading whose text is empty, and keeping
  // it would open the crumb on a separator with nothing before it. An all-empty
  // trail therefore yields "", which is what the markup reads as "render no
  // header", so a group can never be built without a name to give it.
  //
  // The separator is a literal rather than the chevron Icon PlanBreadcrumbs sets
  // its trail with: `Command.Group` takes its heading as a STRING, so there is no
  // markup to put an icon in.
  function breadcrumb(group: HeadingGroup): string {
    return group.trail
      .map((h) => h.text)
      .filter((text) => text !== "")
      .join(" › ");
  }

  function deltaStamp(delta: SectionDelta): string {
    return [delta.added > 0 ? `+${delta.added}` : "", delta.removed > 0 ? `−${delta.removed}` : ""]
      .filter((part) => part !== "")
      .join(" ");
  }

  function deltaNote(delta: SectionDelta): string {
    return [
      delta.added > 0 ? `${plural(delta.added, "line")} added` : "",
      delta.removed > 0 ? `${plural(delta.removed, "line")} removed` : "",
    ]
      .filter((part) => part !== "")
      .join(", ");
  }
</script>

<!-- ONE row, and the only place either view spells a destination out. Both views
     render every heading they show through here, so a per-row decoration has a
     single home. `depth` is the indent the row sits at, in levels, and `guides`
     how many guide columns run down its left; see the --toc-depth and ::before
     rules in the stylesheet for what each view passes and why. The two are
     separate numbers rather than one because only the indent is measured from
     level 1 — see `guideBase`. -->
{#snippet row(heading: TocHeading, depth: number, guides: number)}
  <!-- The label as runs, so the characters the query matched can be marked. The fallback
       is the type's, not a case either view reaches: a filtered row matched by
       construction, and the unfiltered view's query is empty, which the matcher answers
       with the whole label unmarked. -->
  {@const parts = matcher(heading.text) ?? [{ text: heading.text, hit: false }]}
  {@const delta = deltas?.get(heading.line)}
  {@const section = deltas === null ? sections.get(heading.line) : undefined}
  {@const note =
    delta !== undefined
      ? deltaNote(delta)
      : section === undefined
        ? ""
        : describeSection(section, previous?.version ?? null)}
  {@const counts = section === undefined ? null : sectionCounts(section)}
  <!-- The counts, the change and the delta go through aria-describedby, so the option's
       name stays the heading alone. -->
  <Command.Item
    value={String(heading.line)}
    style="--toc-depth: {depth}; --toc-guides: {guides}"
    data-level={heading.level}
    data-key-pressed={heading.line === pressedLine ? "" : undefined}
    aria-current={heading.line === activeLine ? "location" : undefined}
    aria-describedby={note === "" ? undefined : `${uid}-note-${heading.line}`}
    onSelect={() => jump(heading.line)}
  >
    <!-- The key: the part of the row that rises as a cap. It starts at the row's indent,
         so the guides to its left stay on the outline's ground. -->
    <span class="toc-key">
      <!-- Only a MATCHED run takes an element; unmatched text stays a bare text node, so the
           unfiltered view's markup is byte-identical to a plain `{heading.text}` — no
           wrapper span on any of a plan's several hundred rows.
           The row's TEXT is the heading either way, which keeps the option's accessible
           name exactly the heading. Splitting the label rather than adding to it is what
           keeps the mark out of the accessibility tree: a plain span is invisible to it,
           where a real `mark` element is narrated by WebKit. -->
      <span class="toc-label" title={heading.text}>
        {#each parts as part}{#if part.hit}<span class="toc-hit">{part.text}</span>{:else}{part.text}{/if}{/each}
      </span>
      {#if note !== ""}
        <span class="toc-meta" aria-hidden="true">
          {#if delta !== undefined}
            <span class="toc-delta">{deltaStamp(delta)}</span>
          {:else}
            {#if section?.change}<span class="toc-dot"></span>{/if}
            {#if counts?.comments}
              <span class="toc-count stamp"><Icon name="message-square" size={11} />{counts.comments}</span>
            {/if}
            {#if counts?.drafts}
              <span class="toc-count toc-tint"><Icon name="message-square-more" size={11} />{counts.drafts}</span>
            {/if}
          {/if}
        </span>
        <span id="{uid}-note-{heading.line}" hidden>{note}</span>
      {/if}
    </span>
  </Command.Item>
{/snippet}

<!-- One group's matches, all flush left. Both arms of the header/no-header branch
     below render through here, so the two can never drift apart. Keyed on the
     source line: the MODEL keys on reference rather than line, deliberately (see
     `groupedHeadingMatches`), so this view is the stricter of the two — two
     headings sharing a line would be a duplicate-key error here where the model
     would have kept them apart. Unreachable through `extractHeadings`, which
     numbers from the source. -->
{#snippet matchRows(group: HeadingGroup)}
  {#each group.matches as heading (heading.line)}
    {@render row(heading, 0, 0)}
  {/each}
{/snippet}

<!-- The empty-query view: one level of the tree, and then the levels under it. A
     snippet emits no wrapper element, so this recursion produces a FLAT sequence
     of rows in document order — which is what role="listbox" needs, since it
     admits `option` and `group` children and not rows nested inside rows. The
     tree's depth rides on --toc-depth instead, which the stylesheet turns into an
     indent. -->
{#snippet nested(nodes: HeadingNode[])}
  {#each nodes as node (node.heading.line)}
    {@render row(node.heading, node.heading.level - 1, node.heading.level - guideBase)}
    {@render nested(node.children)}
  {/each}
{/snippet}

<div
  class="plan-toc"
  bind:this={rootEl}
  data-placement={placement}
  data-filtering={filtering ? "" : undefined}
  data-latch-snap={latchSnap ? "" : undefined}
  data-filter-closed={filterClosed ? "" : undefined}
>
  {#if placement === "column"}
    <div class="toc-title-row">
      <!-- Its name keeps the visible word and says what a press does: it opens the
           filter, as `\` does. -->
      <Button
        variant="ghost"
        size="sm"
        class="toc-title"
        aria-label="Filter outline"
        aria-keyshortcuts={ariaKeyshortcutsFor("actions.contents")}
        onclick={openFilter}
      >
        Outline
        {#if showShortcutHints}<Kbd class="kbd-sm" aria-hidden="true">\</Kbd>{/if}
      </Button>
      <!-- Sized as the header's Show outline key, which takes its place. -->
      <span class="tray header-tray">
        <Button
          variant="secondary"
          size={showShortcutHints ? "sm" : "icon-sm"}
          class="toc-hide float-chip"
          aria-label="Hide outline"
          aria-keyshortcuts={ariaKeyshortcutsFor("actions.toggleOutline")}
          onclick={onHide}
        >
          <Icon name="panel-left" size={14} />
          {#if showShortcutHints}
            <Kbd class="kbd-sm" aria-hidden="true"><KbdCap key="shift" /><KbdCap key={"\\"} /></Kbd>
          {/if}
        </Button>
      </span>
    </div>
  {/if}
  <!-- shouldFilter={false} is load-bearing, in two separate ways. The command ships a
       fuzzy filter that also RE-SORTS rows by score, which would fight the grouping above
       and shuffle document order — and it scores a row against its VALUE, which here is a
       bare source line, so it would match nothing and empty the list rather than merely
       reorder it. The second way is the groups: bits-ui short-circuits
       `CommandGroupContainerState.shouldRender` to true only while
       `shouldFilter === false`, and otherwise renders a group only if the stock engine
       scored something into it. With line-valued rows that is never, so every breadcrumb
       group would go `hidden` too.
       `loop` wraps the walk at both ends (EXC-1122): the command defaults it OFF where
       menu content defaults it on, and Tab wrapping while the arrows stopped would read as
       a bug. -->
  <Command.Root shouldFilter={false} loop bind:value={selected} onkeydown={onWalkKeydown}>
    <!-- With no rows there is nothing to filter, so the empty line stands alone. -->
    {#if filtering && listed.length > 0}
      <div class="toc-head">
        <Command.Input
          bind:ref={queryEl}
          bind:value={query}
          placeholder="Filter headings…"
          aria-label="Filter headings"
          onkeydown={onFieldKeydown}
        />
        <!-- aria-hidden: the field's active descendant and the status line already narrate
             what the query left. -->
        <span class="toc-match-count metric" aria-hidden="true">{searching ? shown.length : ""}</span>
      </div>
    {/if}
    <!-- Which of the two views the list is rendering, published so the motion rules
         in the stylesheet can tell them apart (EXC-1107). Inert in every other
         respect. The two views are NOT distinguishable from the markup they produce:
         a filtered row is a bare `Command.Item` exactly as an unfiltered one is, and
         the `Command.Group` wrapper is not a proxy for the view either, since a match
         whose ancestor path is empty renders its rows outside any group. -->
    <Command.List
      aria-label="Plan headings"
      data-toc-view={searching ? "matches" : "outline"}
      onscroll={(e) => e.currentTarget.toggleAttribute("data-scrolled", e.currentTarget.scrollTop > 0)}
    >
      {#if searching}
        <!-- Each ancestor path collapses to one Command.Group, whose heading IS
             the breadcrumb (EXC-1103). Reaching for the primitive rather than
             hand-rolling the header is what makes the header the group's
             accessible NAME: bits-ui renders the container `role="presentation"`
             (so the listbox keeps ownership), the heading as a plain node with
             an id, and the items wrapper as `role="group"` with
             `aria-labelledby` pointing at it. A header is not an item, so the
             roving walk never lands on one.

             A group with no breadcrumb renders its rows BARE: no header above a
             top-level match, and no unlabelled `role="group"` naming nothing.
             The branch is on the CRUMB rather than on `trail.length`: `# ` on its
             own line is a real heading whose text is empty, so a trail can be
             non-empty and still have nothing to say.

             `value` is explicit and prefixed rather than left to the vendored
             default of the heading text. bits-ui keys `allGroups` on it and its
             cleanup deletes that key outright, so two groups sharing a value
             have the first unmount corrupt the second — reachable whenever two
             distinct sections carry the same title. The prefix keeps it clear of
             the ITEM values too, which are bare source lines in the same map. -->
        {#each groups as group (group.matches[0]?.line)}
          {@const crumb = breadcrumb(group)}
          {#if crumb === ""}
            {@render matchRows(group)}
          {:else}
            <Command.Group value="group:{group.matches[0]?.line}" heading={crumb} headingClass="form-label">
              {@render matchRows(group)}
            </Command.Group>
          {/if}
        {/each}
      {:else}
        {@render nested(tree)}
      {/if}
    </Command.List>
    <!-- Nothing to show, said in the row geometry rather than as an empty box.
         A plan with no headings is a different message from a query that hit
         nothing, and only the first is a property of the plan.
         A SIBLING of the list rather than a row inside it, for the ownership reason
         the header gives. `role="status"` because a query matching nothing leaves no
         active row for the field's aria-activedescendant to name, so without a live
         region the list empties in silence. Mounted unconditionally, with only its TEXT
         switched — a live region has to be idle in the DOM before the change it
         announces. -->
    <div class="toc-empty-row">
      <p class="toc-empty" role="status">{emptyMessage}</p>
      <!-- Beside the live region rather than in it: a status announces text, and a
           control inside one would be read out with it. -->
      {#if noMatch}
        <span class="tray">
          <Button variant="secondary" size="sm" class="float-chip" onclick={clearFilter}>
            Clear filter
          </Button>
        </span>
      {/if}
    </div>
  </Command.Root>
  {#if foot}
    <div class="toc-foot">{@render foot()}</div>
  {/if}
</div>

<style>
  /* The vendored command parts sit outside this component's style scope, so the rules
     that reach them are :global and anchored on .plan-toc, the outline's own root. Being
     unlayered, they also beat the copied components' own Tailwind utilities. The float's
     panel itself (radius, surface, size) is its host's, DiffPlanView. */
  /* --toc-quiet is the outline's secondary ink. On the float's raised paper that is
     --ink-soft; on the body, where --ink-soft misses AA in the palest palettes, it is a
     neutral key's label ink (theme.test.ts measures it there). */
  .plan-toc {
    --toc-step: 1rem;
    --toc-guide-x: 0.55rem;
    --toc-quiet: var(--ink-soft);
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .plan-toc[data-placement="column"] {
    --toc-quiet: color-mix(in lab, var(--ink-soft), var(--ink) 15%);
    height: 100%;
  }
  .plan-toc :global([data-slot="command"]) {
    flex: 1 1 auto;
    min-height: 0;
    padding: 0;
    border-radius: 0;
    background: transparent;
  }

  /* The column's head: the Outline key that opens the filter, and the key that hides
     the column. */
  .toc-title-row {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    height: 2.6rem;
    padding-inline: 0.95rem 0.35rem;
  }
  .toc-title-row :global(.toc-title) {
    margin-inline-end: auto;
    padding-inline: 0.45rem;
    gap: 0.4rem;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--toc-quiet);
  }
  .toc-title-row :global(.toc-title:is(:hover, :focus-visible)) {
    background: var(--ink-wash);
    color: var(--ink);
  }

  .plan-toc :global(.toc-head) {
    position: relative;
    z-index: 1;
    flex: none;
    transition: box-shadow var(--dur-state) var(--ease-out);
  }
  .plan-toc[data-placement="float"] :global(.toc-head) {
    background: var(--paper-raised);
  }
  /* The field's corner nests in the float's: the float's radius less the field's. The
     column has no corner, so its field sits in the rows' own inset. */
  .plan-toc[data-placement="float"] :global([data-slot="command-input-wrapper"]) {
    padding: calc(var(--key-radius) + 4px - var(--radius));
  }
  .plan-toc[data-placement="column"] :global([data-slot="command-input-wrapper"]) {
    padding: 0.35rem 0.5rem 0.2rem 0.45rem;
  }
  .plan-toc :global([data-slot="command-input-wrapper"] [data-slot="input-group-addon"]) {
    opacity: 1;
    color: var(--ink-faint);
  }
  .plan-toc :global([data-slot="command-input"]) {
    padding-inline-end: 2rem;
    font-size: var(--text-md);
    caret-color: var(--accent);
  }
  .plan-toc :global([data-slot="command-input"])::placeholder {
    color: var(--ink-faint);
    opacity: 1;
  }
  .plan-toc :global(.toc-match-count) {
    position: absolute;
    inset-block: 4px;
    inset-inline-end: calc(4px + 0.6rem);
    display: flex;
    align-items: center;
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    pointer-events: none;
  }
  /* Once rows have scrolled beneath it, the float's field band casts a shade over them.
     The list marks itself rather than going through state, so the list bits-ui rebuilds
     at each empty/non-empty crossing starts unshaded. */
  .plan-toc[data-placement="float"]
    :global([data-slot="command"]:has([data-slot="command-list"][data-scrolled]) .toc-head) {
    box-shadow:
      0 1px 0 var(--rule),
      var(--float-low);
  }

  /* The list re-forming when the query crosses between empty and non-empty — the one
     boundary at which this surface really does swap one view for another. bits-ui's
     `Command.List` wraps its OWN element in `{#key search === ""}`, so the list and the
     viewport under it are both destroyed and rebuilt at exactly that crossing. A remount
     restarts a CSS animation on its own, which makes that teardown the trigger; the list
     arriving with the column or the float plays it too. Scoped to the OUTLINE arm only:
     coming back to the whole plan is the direction that has nothing else to carry it;
     going the other way the matches below carry it. */
  @keyframes toc-list-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .plan-toc :global([data-toc-view="outline"] [data-slot="command-viewport"]) {
    animation: toc-list-in var(--dur-state) var(--ease-out);
  }

  /* The column's filter: on `\` the field drops in at the column's head and the rows settle
     under it by its height; closing, the rows rise back into its room. --toc-head-h is the
     field's height: its 2rem group (command-input.svelte's h-8) and the 0.35rem and
     0.2rem the column pads it with. */
  .plan-toc[data-placement="column"] {
    --toc-head-h: 2.55rem;
  }
  .plan-toc[data-placement="column"] :global(.toc-head) {
    animation: toc-head-drop var(--dur-state) var(--ease-out);
  }
  .plan-toc[data-placement="column"][data-filtering] :global([data-slot="command-list"]) {
    animation: toc-rows-settle var(--dur-state) var(--ease-out);
  }
  .plan-toc[data-placement="column"][data-filter-closed] :global([data-slot="command-list"]) {
    animation: toc-rows-rise var(--dur-state) var(--ease-out);
  }
  /* The field shows once the rows have cleared most of its room, so its words never sit on
     a row's. */
  @keyframes toc-head-drop {
    0%,
    30% {
      opacity: 0;
      transform: translateY(-0.5rem);
    }
  }
  @keyframes toc-rows-settle {
    from {
      transform: translateY(calc(-1 * var(--toc-head-h)));
    }
  }
  @keyframes toc-rows-rise {
    from {
      transform: translateY(var(--toc-head-h));
    }
  }

  /* While comparing, the float's stamps arrive a beat after its list: the list lands, then
     says what changed, all within --dur-state so no stamp lands late enough to read as
     loading. Not while a query re-forms the rows. */
  .plan-toc[data-placement="float"] :global([data-toc-view="outline"] .toc-delta) {
    animation: toc-stamp-in calc(var(--dur-state) * 0.75) var(--ease-out)
      calc(var(--dur-state) * 0.25) both;
  }
  @keyframes toc-stamp-in {
    from {
      opacity: 0;
      transform: scale(0.85);
    }
  }

  /* A match arriving, and its breadcrumb header arriving with it. ONE declaration for
     both, so a header cannot pop in above rows that faded. Rows animate IN only: a row
     that stops matching is removed by Svelte with nothing to hang an exit on, and the
     mechanisms that could give it one are element-only, where `Command.Item` is a
     component. Opacity and transform only, and no `will-change`: a CSS-animated element
     is promoted on its own, and pinning a layer per row is how a list this long turns a
     cheap animation into a memory problem. */
  @keyframes toc-row-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .plan-toc :global([data-toc-view="matches"] [data-slot="command-item"]),
  .plan-toc :global([data-toc-view="matches"] [data-command-group-heading]) {
    animation: toc-row-in var(--dur-state) var(--ease-out);
  }

  /* The list scrolls on its own. The float caps it below the window; the column runs
     down the body's whole height. Both terms of the float's min() resolve when the
     stylesheet is parsed, so the cap never falls through to `unset` while floating-ui
     publishes its own measures a frame late. */
  .plan-toc :global([data-slot="command-list"]) {
    flex: 1 1 auto;
    min-height: 0;
    padding: 0.15rem 0.5rem 0.75rem 0.45rem;
  }
  .plan-toc[data-placement="column"] :global([data-slot="command-list"]) {
    max-height: none;
  }
  .plan-toc[data-placement="float"] :global([data-slot="command-list"]) {
    max-height: min(23rem, 60vh);
    padding: 0.375rem 4px 4px;
  }

  /* The one indent rule, and the two views mean different things by it.
     Unfiltered, --toc-depth is the heading's own LEVEL minus one — absolute, not a
     position in a tree — so a section sits at the same indent whatever else is on
     screen, which is what keeps the list from reflowing under the reviewer as they
     type. The trade is an absolute origin: a plan whose top-level headings are
     `##` renders every row one step in, with nothing at zero. Accepted — a uniform
     offset costs nothing to read, where a shifting indent would.
     Filtered, every row passes zero: the breadcrumb header above it carries the
     hierarchy. The row itself never paints: its key (below) is the part that rises.
     The indent alone shows the level; a row draws no level glyph. */
  .plan-toc :global([data-slot="command-item"]) {
    height: auto;
    min-height: 1.875rem;
    padding: 0;
    padding-inline-start: calc(var(--toc-depth, 0) * var(--toc-step));
    background: transparent;
    color: var(--ink);
    font-size: var(--text-sm);
    line-height: var(--leading-tight);
  }
  .plan-toc :global([data-slot="command-item"]:is([data-level="4"], [data-level="5"], [data-level="6"])) {
    color: var(--toc-quiet);
  }
  .plan-toc :global(:is([data-level="1"], [data-level="2"]) .toc-label) {
    font-weight: 600;
  }
  /* The Hide outline key and the header's Show outline key are one key in a layout move
     (lib/paneMove.ts), travelling in its well between the column's head and the header. */
  :global(:root[data-pane-move]) .toc-title-row .header-tray {
    view-transition-name: outline-key;
  }
  /* The vendored row's check indicator marks a checked item, which a heading never is. */
  .plan-toc :global(.cn-command-item-indicator) {
    display: none;
  }

  /* The indent guides (EXC-1106): one hairline per level between the plan's own
     root and this row, at the indent's own pitch, so a row's text and the column
     it hangs under agree about depth. A row draws NOTHING in its own column — the
     line for a level is punctuated by the heading that opens it, which is what
     makes the set read as a tree rather than as a ruled ledger. --toc-guides is
     therefore the count. Zero is the whole of the filtered view's answer and of a
     plan's shallowest rows; a zero width paints nothing.
     A column marks a LEVEL, not a tree edge, and that is the trade the indent rule
     accepts: a plan that skips from `#` to `###` draws a column at the level in between.
     A ::before rather than the row's own background: border-radius clips an element's
     own background layers, so the leftmost tooth would be nicked top and bottom and the
     line would stripe at each row boundary. --rule is what caret already paints an
     indent guide with (FolderTree.svelte), so it retints with the theme for free. */
  .plan-toc :global([data-slot="command-item"])::before {
    content: "";
    position: absolute;
    inset-block: 0;
    inset-inline-start: calc(
      var(--toc-guide-x) + (var(--toc-depth, 0) - var(--toc-guides, 0)) * var(--toc-step)
    );
    width: calc(var(--toc-guides, 0) * var(--toc-step));
    background-image: repeating-linear-gradient(
      to right,
      var(--rule) 0 1px,
      transparent 1px var(--toc-step)
    );
    pointer-events: none;
  }

  /* The key: a row's key, flat on the ground at rest. It rises under the pointer and,
     while the filter is open, on the selection the keys move, so the keyboard's row
     looks exactly as the pointer's. With the filter closed bits-ui still holds a
     selection (it seeds the first row), so the column rises on hover alone. The heading
     being read is latched down, as the compare toggle is when it is on. Every state
     draws the same five shadow layers, so a change of state transitions. The rise and
     press are the key row's (the --key-row-* tokens); a row is no `.key-row`, whose
     states key on the row itself rather than on the command item around it. */
  .plan-toc :global(.toc-key) {
    --key-face: transparent;
    --key-image: none;
    --key-shadow:
      inset 0 2px 2px -1px transparent,
      0 0 0 transparent,
      0 0 0 transparent,
      0 0 0 transparent,
      0 0 0 transparent;
    --key-shift: 0;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 1.875rem;
    padding: 0.28rem 0.45rem 0.28rem 0.375rem;
    border-radius: var(--key-radius);
    background-color: var(--key-face);
    background-image: var(--key-image);
    background-size: auto, 128px;
    background-blend-mode: normal, soft-light;
    box-shadow: var(--key-shadow);
    translate: 0 var(--key-shift);
    transition:
      translate var(--dur-state) var(--ease-spring),
      background-color var(--dur-state) var(--ease-out),
      color var(--dur-state) var(--ease-out),
      box-shadow var(--dur-state) var(--ease-out);
  }
  .plan-toc[data-filtering] :global([data-slot="command-item"][data-selected] .toc-key),
  .plan-toc:not([data-filtering]) :global([data-slot="command-item"]:hover .toc-key) {
    --key-face: var(--neutral-face-hover);
    --key-image: var(--key-row-up-image);
    --key-shadow: var(--key-row-up);
    --key-shift: calc(-1 * var(--key-rise));
    color: var(--ink);
  }
  .plan-toc[data-latch-snap] :global([data-slot="command-item"] .toc-key) {
    transition-property: none;
  }
  .plan-toc :global([data-slot="command-item"][aria-current="location"] .toc-key) {
    --key-face: var(--neutral-face-latched);
    --key-image: var(--key-row-down-image);
    --key-shadow: var(--key-row-down);
    --key-shift: var(--key-sink);
    color: var(--ink);
  }
  .plan-toc[data-filtering] :global([data-slot="command-item"][aria-current="location"][data-selected] .toc-key),
  .plan-toc:not([data-filtering]) :global([data-slot="command-item"][aria-current="location"]:hover .toc-key) {
    --key-face: var(--neutral-face-latched-hover);
  }
  .plan-toc :global([data-slot="command-item"]:is(:active, [data-key-pressed]) .toc-key) {
    --key-face: var(--neutral-face-press);
    --key-image: var(--key-row-down-image);
    --key-shadow: var(--key-row-down);
    --key-shift: var(--key-sink);
    transition-timing-function: var(--ease-out);
  }

  /* What a row says beyond its heading: an --attention dot when the section changed
     since the previous version, and stamps counting its comments and its unsent ones —
     or, while comparing, what it gained and lost. */
  .plan-toc :global(.toc-meta) {
    flex: none;
    margin-inline-start: auto;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .plan-toc :global(.toc-dot) {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 99px;
    background: var(--attention);
  }
  .plan-toc :global(:is(.toc-count, .toc-delta)) {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    height: 1.15rem;
    border-radius: 99px;
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 600;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .plan-toc :global(.toc-count) {
    padding: 0 0.42rem 0 0.32rem;
  }
  .plan-toc :global(.toc-delta) {
    padding-inline: 0.35rem;
    background: var(--well-floor);
    box-shadow: var(--well-shade), var(--well-lip);
    color: var(--ink-soft);
  }
  /* An unsent count is novelty, tinted at the comment stamp's strengths. Its glyph is
     the source marker's, not the Draft stamp's pencil. */
  .plan-toc :global(.toc-tint) {
    background: color-mix(in lab, var(--well-floor), var(--attention) var(--stamp-floor));
    box-shadow: var(--well-shade), var(--well-lip);
    color: color-mix(in lab, var(--attention), var(--stamp-word-toward) var(--stamp-word-mix));
  }
  /* The vendored row inks every svg of a selected row; a stamp's glyph keeps its word's. */
  .plan-toc :global(.toc-meta svg) {
    color: inherit;
  }

  /* The vendored group ships `p-1`, which would inset its rows a step further than
     the unfiltered view's. The header and the rows carry their own padding, so the group
     is a pure grouping box — and an unclipped one. */
  .plan-toc :global([data-slot="command-group"]) {
    padding: 0;
    overflow: visible;
  }

  /* The breadcrumb header, in `.form-label`'s type and ink, placed on the rows' own left
     edge. One line, elided from the START (EXC-1108): what places the match is the tail,
     so that is the half worth keeping. Italic separates the path from the headings it is
     made of.
     CSS has no start-ellipsis, so this is the `direction: rtl` technique, with
     `text-align: left` putting the line back where the rows are. The text itself is
     unaffected — every segment is a strong LTR run, and the bidi algorithm resolves the
     neutral separators between two LTR runs as LTR (UBA rule N1).
     The `::after` makes that safe: a TRAILING neutral (a heading ending in `?` or `)`)
     has no strong character after it, so it would take the paragraph direction and jump
     to the far left. A zero-width LEFT-TO-RIGHT MARK gives it one. `/ ""` keeps the mark
     out of the group's accessible name, which this heading is the target of. */
  .plan-toc :global([data-command-group-heading]) {
    padding-inline: 0.5rem;
    padding-block: 0.25rem;
    margin-block: 0.5rem 0;
    font-style: italic;
    direction: rtl;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .plan-toc :global([data-command-group-heading])::after {
    content: "\200E" / "";
  }
  .plan-toc :global([data-slot="command-group"]:first-child [data-command-group-heading]) {
    margin-block-start: 0;
  }

  /* A long heading wraps to a second line, then truncates. */
  .plan-toc :global(.toc-label) {
    min-width: 0;
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
  }

  /* The characters the filter matched. It rides --mark, caret's content-highlight token
     — the same wash the plan's `/` search hits take, so a marked run means one thing
     wherever a reviewer meets it. Bare background and nothing else: an inline pad would
     shift the glyphs after it and eat width the deepest matches need. It reads over
     both row marks because --mark composites on top of whatever the row already paints. */
  .plan-toc :global(.toc-hit) {
    border-radius: 2px;
    background: var(--mark);
    box-shadow: var(--chip-stamped);
    color: var(--ink);
  }

  /* An empty list says why, at the quietest ink. The box is always in the markup so the
     live region is idle before it speaks, so the padding is what it wears only when it
     has something to say. */
  .plan-toc :global(.toc-empty-row) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding-inline: 0.45rem 0.5rem;
  }
  .plan-toc :global(.toc-empty) {
    margin: 0;
    padding: 0;
    min-width: 0;
    color: var(--ink-soft);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }
  .plan-toc :global(.toc-empty:not(:empty)) {
    padding: 0.55rem 0.25rem 0.55rem 0.5rem;
  }
  .plan-toc :global(.toc-empty-row .tray) {
    margin-block: 0.25rem;
  }

  .toc-foot {
    flex: none;
    display: flex;
    min-width: 0;
    --ctl-h: 1.75rem;
    padding: 0.35rem 0.5rem 0.5rem 0.45rem;
  }
</style>
