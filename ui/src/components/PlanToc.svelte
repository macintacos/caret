<script lang="ts">
  // The plan's table-of-contents popup (EXC-1095): every heading at once, nested
  // by level, with the one being read marked and a filter field at the top. It
  // complements the breadcrumbs bar rather than replacing it — PlanBreadcrumbs is
  // the drill-down surface, this is the see-the-whole-shape-at-once one — and
  // takes the same three props, so both read one heading model and one activeLine.
  //
  // Built on `command` inside a `popover`, which is the whole point of the epic:
  // bits-ui puts role="menu" on dropdown content, and a textbox is not a role
  // `menu` admits as a child, so a filter field hosted inside a menu narrates
  // nothing as its rows narrow. The breadcrumbs bar's own filter is built on the
  // same two primitives for the same reason; only its hierarchy menus are
  // dropdowns.
  //
  // What that buys HERE is both halves (EXC-1096 closed the second). Structurally
  // the field is a legal sibling of the list and the rows are real options a screen
  // reader can browse; for narration, the field carries `aria-controls` and
  // `aria-activedescendant`, so the row the roving walk lands on is announced as the
  // list narrows without focus ever leaving the field. Those two attributes are
  // bits-ui's, derived from the command's viewport node — which exists only because
  // the vendored command-list.svelte renders a `Command.Viewport`. That is caret's
  // addition to the registry source and the reason the whole vendoring paid off; see
  // the comment there before touching it.
  //
  // The popup shows TWO views of one heading model (EXC-1103), and the query picks
  // between them. Empty, it is the whole plan nested by level — see the shape of a
  // plan at a glance. Filtered, each ancestor path collapses into ONE breadcrumb
  // header with its matches flush left beneath it, because a match four levels down
  // otherwise spends four rows placing itself. The nesting is the browsing view; the
  // breadcrumb is the searching one.
  //
  // That header is a `Command.Group` heading rather than markup of caret's own, and
  // the reason is the same constraint that shaped EXC-1096: a listbox may own
  // options and groups and NOT loose text. bits-ui wires the heading up as the
  // group's `aria-labelledby` target, so the ancestor path reaches a screen reader
  // as the group's name — where EXC-1096's dimmed ancestor rows could only be
  // `aria-hidden`, sighted-only wayfinding for a reader scanning the indent.
  //
  // Presentational: the only state is the popup's own — open, query, and the
  // command's selected row — the tree is derived, and the parent owns both the
  // heading set and the scroll tracking that moves `activeLine`.
  import { untrack } from "svelte";

  import Icon from "@/components/Icon.svelte";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Command from "$lib/components/ui/command/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import {
    groupedHeadingMatches,
    type HeadingGroup,
    type HeadingNode,
    headingTree,
  } from "$lib/headingTrail.ts";
  import type { IconName } from "$lib/icons.ts";
  import { ariaKeyshortcutsFor } from "$lib/shortcuts/index.ts";
  import { headingMatcher, type TocHeading } from "$lib/toc.ts";

  interface Props {
    /** Headings extracted from the plan source, in document order. */
    headings: TocHeading[];
    /** Source line of the heading currently in the reading zone, or null. The
     * same value PlanBreadcrumbs receives — this surface tracks no scroll of its
     * own. */
    activeLine: number | null;
    /** Jump the view to a heading's 1-based source line. */
    onJump: (line: number) => void;
    /** Whether the `\` keycap is shown (EXC-1097). When off, the cap hides; the
     * key still works, exactly as the breadcrumbs bar's `b` cap behaves. */
    showShortcutHints?: boolean;
    /** Hand the parent an action that opens the popup, so `\` can summon it
     * (EXC-1097). The same handle PlanBreadcrumbs passes up for `b`. */
    onExposeOpen?: (open: () => void) => void;
  }

  let { headings, activeLine, onJump, showShortcutHints = false, onExposeOpen }: Props = $props();

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

  // Two views of one heading model, and which one is showing is the whole of
  // EXC-1103. Trimmed rather than a bare `!== ""` so the boundary matches
  // `filterHeadings`' own notion of empty — a stray space must not swap the view.
  const searching = $derived(query.trim() !== "");

  // The empty-query view: the whole plan, nested by level, exactly as before.
  // The filtered view: matches gathered under one breadcrumb header per ancestor
  // path, flush left. Both are built on the same `parentIndices` walk in the same
  // module, so the two can never disagree about what encloses what. `$derived` is
  // lazy, so only the view actually rendered below is ever computed.
  //
  // Every heading renders a row, and the ceiling that bounds is the low hundreds
  // of headings a caret plan carries — agent-authored markdown, not a book. What
  // costs at that scale is not this recompute (a few linear passes over the
  // headings, microseconds) but what each row IS: a full bits-ui command item with
  // its own effects and id, and a Command.List that tears the whole list down and
  // rebuilds it whenever the query crosses between empty and non-empty. List
  // virtualization is out of scope until a real plan is measured past that ceiling
  // — see EXC-1062's Out of scope.
  const tree = $derived(headingTree(headings));
  const groups = $derived(groupedHeadingMatches(headings, query));

  // What a row marks — the SAME closure `filterHeadings` decides membership with, reached
  // from beside the filter rather than by transforming what it returns. `filterHeadings`
  // (toc.ts) carries why deriving the runs from its OUTPUT is the shape that silently
  // empties the panel; that is where an edit could reintroduce it, so it is written once
  // there rather than twice.
  const matcher = $derived(headingMatcher(query));

  // What the status line says, empty when the list has rows. Derived rather than
  // inlined in the markup because the element it feeds is always mounted — see the
  // comment on it for why a live region cannot be conjured up with its text already
  // inside it. Read off whichever view is showing, so a query matching nothing and
  // a plan with no headings stay the two distinct messages they were.
  const emptyMessage = $derived(
    (searching ? groups.length : tree.length) > 0
      ? ""
      : headings.length === 0
        ? "No headings in plan"
        : "No headings match",
  );

  // Whether the popup is closing because the reviewer picked a heading, which
  // onCloseAutoFocus below reads to decide where focus lands. The same flag
  // PlanBreadcrumbs.svelte spends on the same job, and now on the same terms: a
  // pick drops focus to the body so the reviewer lands in the plan rather than
  // ringed on a control they are done with, which is affordable because `\`
  // summons the popup back (shortcuts/keymap.ts) exactly as `b` does the bar.
  let leaving = false;

  // A popup always opens on the whole plan, looking at the heading being read.
  // Neither the query nor the row the last session walked to survives, so
  // reopening is never a stale view of a plan that has since scrolled.
  function seed(): void {
    query = "";
    selected = activeLine === null ? "" : String(activeLine);
  }

  // The whole open, for callers outside the primitive. bits-ui runs onOpenChange
  // from its OWN box setter only — a trigger click, Escape, an outside click — so
  // a programmatic write to `open` receives none of the seeding the trigger path
  // gets. Poking the flag alone opens the popup on the first row carrying the
  // previous session's query, and nothing errors: the heading being read is still
  // marked, because aria-current is derived from `activeLine` rather than from the
  // seeded selection. Both entry points go through here so they cannot diverge.
  function openPopup(): void {
    seed();
    open = true;
  }

  // Hand that open up once, so `\` reaches this popup (EXC-1097). `untrack` keeps
  // onExposeOpen from becoming a dependency.
  $effect(() => {
    untrack(() => onExposeOpen)?.(openPopup);
  });

  // A group's header text: its ancestor path, root-most first. Empty segments drop
  // out — `# ` on its own line is a real heading whose text is empty, and keeping
  // it would open the crumb on a separator with nothing before it. An all-empty
  // trail therefore yields "", which is what the markup reads as "render no
  // header", so a group can never be built without a name to give it.
  //
  // The separator is a literal rather than the chevron Icon PlanBreadcrumbs sets
  // its trail with: `Command.Group` takes its heading as a STRING, so there is no
  // markup to put an icon in. The two surfaces show the same idea with different
  // glyphs for that reason, not by drift.
  function breadcrumb(group: HeadingGroup): string {
    return group.trail
      .map((h) => h.text)
      .filter((text) => text !== "")
      .join(" › ");
  }

  // The marker each row wears, by heading level (EXC-1105). Lucide ships exactly six
  // heading glyphs, which is also the range ATX allows, so `extractHeadings` can never
  // hand this anything else — the clamp is a floor under a level arriving from some
  // future caller, not a case markdown reaches. What it rules out is asking Icon.svelte
  // for a name the registry holds no SVG for, which renders an empty box in every row.
  const LEVEL_ICONS = [
    "heading-1",
    "heading-2",
    "heading-3",
    "heading-4",
    "heading-5",
    "heading-6",
  ] as const satisfies readonly IconName[];

  function levelIcon(level: number): IconName {
    const clamped = Math.min(LEVEL_ICONS.length, Math.max(1, Math.trunc(level)));
    return LEVEL_ICONS[clamped - 1] ?? LEVEL_ICONS[0];
  }

  // Take the reviewer to a heading and leave. A command row does not dismiss its
  // host the way a menu item does, so the pick closes the popup itself.
  function jump(line: number): void {
    leaving = true;
    open = false;
    onJump(line);
  }
</script>

<!-- ONE row, and the only place either view spells a destination out. Both views
     render every heading they show through here, so a per-row decoration has a
     single home. `depth` is the indent the row sits at, in levels; see the
     --toc-depth rule in the stylesheet for what each view passes and why. -->
{#snippet row(heading: TocHeading, depth: number)}
  <!-- The label as runs, so the characters the query matched can be marked. The fallback
       is the type's, not a case either view reaches: a filtered row matched by
       construction, and the unfiltered view's query is empty, which the matcher answers
       with the whole label unmarked. It degrades to the plain label rather than to
       nothing, so a future caller can never blank a row. -->
  {@const parts = matcher(heading.text) ?? [{ text: heading.text, hit: false }]}
  <Command.Item
    value={String(heading.line)}
    style="--toc-depth: {depth}"
    aria-current={heading.line === activeLine ? "location" : undefined}
    onSelect={() => jump(heading.line)}
  >
    <!-- What level this heading is, said once per row and in both views (EXC-1105). The
         nested view already implies it in the indent; the FILTERED view passes depth 0 for
         every row, so there this is the only thing carrying it — which is why the marker
         lives in the shared snippet rather than in one view's branch.
         No wrapper span: Icon.svelte's own <span> is the element, and `data-icon` names the
         glyph on it, so the style rule below has a hook without a second node on each of a
         plan's several hundred rows. Decorative, so Icon renders it aria-hidden and it
         contributes no text — which is what keeps the option's accessible name exactly the
         heading (test/e2e/plan-toc.e2e.ts pins that in a real role engine). -->
    <Icon name={levelIcon(heading.level)} size={14} />
    <!-- Only a MATCHED run takes an element; unmatched text stays a bare text node. That
         keeps the unfiltered view's markup byte-identical to a plain `{heading.text}` —
         no wrapper span on any of a plan's several hundred rows — so this decoration is
         inert until the reviewer actually types.
         The row's TEXT is the heading either way, which is what keeps the option's
         accessible name exactly the heading, since that name is computed from its
         contents. Splitting the label rather than adding to it is also what keeps the
         mark out of the accessibility tree: a plain span is invisible to it, where a real
         `mark` element is narrated by WebKit. -->
    <span class="toc-label" title={heading.text}>
      {#each parts as part}{#if part.hit}<span class="toc-hit">{part.text}</span>{:else}{part.text}{/if}{/each}
    </span>
  </Command.Item>
{/snippet}

<!-- The empty-query view: one level of the tree, and then the levels under it. A
     snippet emits no wrapper element, so this recursion produces a FLAT sequence
     of rows in document order — which is what role="listbox" needs, since it
     admits `option` and `group` children and not rows nested inside rows. The
     tree's depth rides on --toc-depth instead, which the stylesheet turns into an
     indent. -->
<!-- One group's matches, all flush left. Both arms of the header/no-header branch
     below render through here, so the two can never drift apart. Keyed on the
     source line: the MODEL keys on reference rather than line, deliberately (see
     `groupedHeadingMatches`), so this view is the stricter of the two — two
     headings sharing a line would be a duplicate-key error here where the model
     would have kept them apart. Unreachable through `extractHeadings`, which
     numbers from the source. -->
{#snippet matchRows(group: HeadingGroup)}
  {#each group.matches as heading (heading.line)}
    {@render row(heading, 0)}
  {/each}
{/snippet}

{#snippet nested(nodes: HeadingNode[])}
  {#each nodes as node (node.heading.line)}
    {@render row(node.heading, node.heading.level - 1)}
    {@render nested(node.children)}
  {/each}
{/snippet}

<Popover.Root
  bind:open
  onOpenChange={(opening) => {
    // The trigger's half of the seeding above; openPopup covers every other
    // caller, since this fires only for the primitive's own opens.
    if (opening) seed();
  }}
>
  <Popover.Trigger>
    {#snippet child({ props })}
      <!-- A neutral control, so it wears the topbar's chip surface rather than an
           outline or the amber primary (doc/agents/shadcn-rules.md § The caret
           surface language) — the same variant + class pairing the compare toggle
           beside it in the control row uses.
           The `\` cap teaches the key on the same setting that gates the compare
           toggle's `d` and the breadcrumbs bar's `b`; aria-hidden so the glyph
           never lands in the button's name, which aria-keyshortcuts carries
           instead — derived from the reservation, so the two cannot disagree. -->
      <Button
        {...props}
        variant="secondary"
        size="sm"
        class="float-chip"
        aria-keyshortcuts={ariaKeyshortcutsFor("actions.contents")}
      >
        Contents
        {#if showShortcutHints}
          <Kbd class="kbd-sm" aria-hidden="true">\</Kbd>
        {/if}
      </Button>
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
    onCloseAutoFocus={(e) => {
      // Only a pick suppresses the return; Escape, an outside click and Tab all hand
      // focus back to the trigger as the primitive intends. See `leaving` above.
      if (!leaving) return;
      leaving = false;
      e.preventDefault();
    }}
  >
    <!-- shouldFilter={false} is load-bearing, and since EXC-1103 in two separate
         ways. The command ships a fuzzy filter that also RE-SORTS rows by score,
         which would fight the grouping above and shuffle document order — and it
         scores a row against its VALUE, which here is a bare source line, so it
         would match nothing and empty the panel rather than merely reorder it.
         The second way is the groups: bits-ui short-circuits
         `CommandGroupContainerState.shouldRender` to true only while
         `shouldFilter === false`, and otherwise renders a group only if the
         stock engine scored something into it. With line-valued rows that is
         never, so every breadcrumb group would go `hidden` too.
         Filtering is `groupedHeadingMatches`' job; the command's job here is the
         listbox semantics and the roving selection. -->
    <Command.Root
      shouldFilter={false}
      bind:value={selected}
      onkeydown={(e) => {
        // Tab walks the list instead of leaving it (EXC-1102). The primitive maps
        // the arrows and the vim chords and ignores Tab, and the popover traps
        // focus with a single tabbable inside — so untouched, Tab moved focus out
        // of the field and straight back to it, doing nothing at all.
        //
        // Re-dispatching an arrow rather than writing `selected` is the load-bearing
        // choice. bits-ui scrolls a selection into view from its OWN keydown path;
        // assigning the bound value only does that on the command's initial mount
        // (see `selected` above), so a hand-rolled walk would step the reviewer onto
        // rows below the fold without ever bringing them into sight. `#next`/`#prev`
        // are private, so the handler is the only door in. Dispatched from the field
        // because that is where the keypress really landed, and the primitive listens
        // for it on the root the event bubbles to.
        if (e.key !== "Tab" || queryEl === null) return;
        e.preventDefault();
        queryEl.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: e.shiftKey ? "ArrowUp" : "ArrowDown",
            bubbles: true,
            cancelable: true,
          }),
        );
      }}
    >
      <Command.Input
        bind:ref={queryEl}
        bind:value={query}
        placeholder="Filter headings…"
        aria-label="Filter headings"
      />
      <Command.List aria-label="Plan headings">
        {#if searching}
          <!-- Each ancestor path collapses to one Command.Group, whose heading IS
               the breadcrumb (EXC-1103). Reaching for the primitive rather than
               hand-rolling the header is what makes the header the group's
               accessible NAME: bits-ui renders the container `role="presentation"`
               (so the listbox keeps ownership), the heading as a plain node with
               an id, and the items wrapper as `role="group"` with
               `aria-labelledby` pointing at it. Loose text is the one thing a
               listbox may not own, and this is how the breadcrumb avoids being it
               — the reason EXC-1096's ancestors had to be `aria-hidden` instead.
               A header is not an item, so the roving walk — a flat DOM-order
               querySelectorAll over the command's items — never lands on one.

               A group with no breadcrumb renders its rows BARE. AC6 asks for no
               header above a top-level match, and an unlabelled `role="group"`
               around it would be a level of structure naming nothing.
               The branch is on the CRUMB rather than on `trail.length`, and the
               two are not the same test: `# ` on its own line is a real heading
               whose text is empty, so a trail can be non-empty and still have
               nothing to say. Branching on the length would then render a group
               the vendored component gives no heading to — an unlabelled one,
               exactly what this paragraph rules out. Empty segments drop out of
               the join for the same reason, or the crumb opens on a separator
               with nothing before it.

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
              <Command.Group value="group:{group.matches[0]?.line}" heading={crumb} headingClass="eyebrow">
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
           Deliberately a SIBLING of the list rather than a row inside it, for the
           ownership reason the header gives.
           `role="status"` because this is the one narrowing a screen reader would
           otherwise miss: a keystroke that changes the first match moves the
           selection and the field's aria-activedescendant announces the new row,
           but a query matching nothing leaves no active row to name, so without a
           live region the list empties in silence.
           Mounted unconditionally, with only its TEXT switched — a live region has
           to be idle in the DOM before the change it announces, and one inserted
           with its content already in it is skipped by some AT outright. Same shape
           and same reason as FilePreview.svelte's `.fp-range`. Empty, it has no
           padding and generates no line box, so it costs no height. -->
      <p class="toc-empty" role="status">{emptyMessage}</p>
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

  /* The list carries its own leading space so the first row is not flush against
     the filter field: the vendored command-input wrapper is `p-1 pb-0` and the list
     only `scroll-py-1`, so nothing sat between them. It rides on the scroll
     container rather than on the first row, which keeps it a property of the list
     as a whole — a row scrolled to the top does not carry a phantom offset with it.

     The height is the ToC's own, deliberately NOT the vendored `max-h-72` (18rem)
     it overrides: that class is shared with the breadcrumbs bar's filter panel
     (EXC-1098), which anchors to a crumb mid-bar and wants to stay compact. This
     panel hangs off the control row with the whole plan under it, so it earns twice
     the run before scrolling.

     Both terms of the min() have to be resolvable when the stylesheet is parsed,
     which rules out the variable that looks made for this job.
     --bits-popover-content-available-height is the room floating-ui measures between
     the trigger and the viewport edge, but it is published a frame LATE, and a min()
     over an unset variable is invalid at computed-value time — which drops
     max-height to `unset` rather than falling back to any earlier declaration. The
     list would then mount at its natural height, and bits-ui — which scrolls the
     seeded row into view exactly once, on that mount — would correctly find nothing
     overflowing and scroll nowhere. The variable arrives, the list shrinks, and the
     popup opens parked at the top with the current heading stranded below the fold.
     `vh` costs a clamp against the window rather than against the trigger's own
     room, and is never invalid. */
  :global(.plan-toc-panel [data-slot="command-list"]) {
    padding-block-start: 0.5rem;
    max-height: min(36rem, 70vh);
  }

  /* The one indent rule, and the two views mean different things by it.
     Unfiltered, --toc-depth is the heading's own LEVEL minus one — absolute, not a
     position in a tree — so a section sits at the same indent whatever else is on
     screen, which is what keeps the list from reflowing under the reviewer as they
     type. The trade is an absolute origin: a plan whose top-level headings are
     `##` renders every row one step in, with nothing at zero. Accepted — a uniform
     offset costs nothing to read, where a shifting indent would.
     Filtered, every row passes zero: the breadcrumb header above it carries the
     hierarchy, so repeating it in the indent would say the same thing twice and
     cost the row width that the deepest matches need most. */
  :global(.plan-toc-panel [data-slot="command-item"]) {
    padding-inline-start: calc(0.5rem + var(--toc-depth, 0) * 0.75rem);
  }

  /* The vendored group ships `p-1`, which would inset its rows a step further than
     the unfiltered view's and open a gap the list already pads. The header and the
     rows carry their own padding, so the group is a pure grouping box. */
  :global(.plan-toc-panel [data-slot="command-group"]) {
    padding: 0;
  }

  /* The breadcrumb header. `.eyebrow` (styles/atoms.css) is caret's uppercase-label
     vocabulary and supplies the whole of it — smaller than the rows, tracked,
     uppercase, at the faintest ink — so the only thing left here is placing it: the
     rows' own inline padding, so header and labels share one left edge, and the
     space above that separates one group from the group before it. `:first-child`
     rather than a bottom margin on the group, so the first header sits flush
     against the leading space the list already carries.
     The atom is unlayered, so it wins over the vendored heading's Tailwind size and
     colour utilities the way .float-chip wins over the Button variant's. */
  :global(.plan-toc-panel [data-command-group-heading]) {
    padding-inline: 0.5rem;
    padding-block: 0.25rem;
    margin-block-start: 0.5rem;
  }
  :global(.plan-toc-panel [data-slot="command-group"]:first-child [data-command-group-heading]) {
    margin-block-start: 0;
  }

  /* The heading-level marker, at the same rung of the neutral ink ramp the breadcrumb
     header's `.eyebrow` and the empty line take — it is the same KIND of thing as those,
     subordinate wayfinding rather than content, so it reads dimmer than the label it
     labels. Neutral rather than hued because it is none of the three jobs a hue has
     (doc/agents/svelte-rules.md § Every hue has a job).
     Being unlayered, this beats command-item.svelte's Tailwind
     `data-selected:[&_svg]:text-accent-foreground`, so the marker stays dimmed on the row
     the keyboard is on instead of brightening to the label's colour with it. That
     precedence is measured in test/e2e/plan-toc.e2e.ts rather than assumed. */
  :global(.plan-toc-panel [data-slot="command-item"] [data-icon^="heading-"]) {
    color: var(--ink-faint);
  }

  /* A long heading truncates in its row rather than stretching the panel to the
     width of the plan's longest one. */
  :global(.plan-toc-panel .toc-label) {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* The characters the filter matched. It rides --mark, caret's content-highlight token
     (doc/agents/svelte-rules.md § CSS-token discipline) — the same wash the plan view's
     `/` search hits take, so a marked run means one thing wherever a reviewer meets it.
     Bare background and nothing else: an inline pad would shift the glyphs after it and
     eat width the deepest matches need, and the run has to survive inside a label that
     truncates.
     It reads over BOTH marks a row can already wear because it is a different kind of
     thing rather than a different hue — those two fill the whole row, this fills a run
     inside one. What keeps it legible over the amber one is ALPHA STACKING, and that is
     the general mechanism: --mark composites on top of whatever the row already paints,
     so the run is always a step further from the panel than its row is. Do not read this
     as a hue guarantee — only caret's own palette names a markHue distinct from its
     washHue; every vendor palette leaves both unset, and recipe.ts then collapses
     markHue → washHue → accent, so there the mark and the row wash are the same hue at
     different alphas. Measured on the painted pixels, the run separates from its row by
     ΔE*ab 8.8–20.3 across both schemes and all three row states. */
  :global(.plan-toc-panel .toc-hit) {
    background: var(--mark);
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
     own no-match line takes. The box is always in the markup so the live region is
     idle before it speaks, so the padding is what it wears only when it has
     something to say: with no text and no padding it generates no line box and the
     panel closes up exactly as it did when the element was conditional. */
  :global(.plan-toc-panel .toc-empty) {
    margin: 0;
    padding: 0;
    color: var(--ink-faint);
    font-size: var(--text-xs);
  }
  :global(.plan-toc-panel .toc-empty:not(:empty)) {
    padding: 0.5rem;
  }
</style>
