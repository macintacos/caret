<script lang="ts">
  // The plan's table-of-contents popup (EXC-1095): every heading at once, nested
  // by level, with the one being read marked and a filter field at the top. It
  // complements the breadcrumbs bar rather than replacing it — PlanBreadcrumbs is
  // the drill-down surface, this is the see-the-whole-shape-at-once one — and
  // takes the same three props, so both read one heading model and one activeLine.
  //
  // Built on `command` inside a `popover`, the same two primitives the breadcrumbs
  // bar's own filter uses; only its hierarchy menus are dropdowns. What that buys is
  // both halves of the listbox contract (EXC-1096): structurally the field is a legal
  // sibling of the list and the rows are real options a screen reader can browse; for
  // narration, the field carries `aria-controls` and `aria-activedescendant`, so the
  // row the roving walk lands on is announced as the list narrows without focus ever
  // leaving the field. Those two attributes are bits-ui's, derived from the command's
  // viewport node — which exists only because the vendored command-list.svelte renders
  // a `Command.Viewport`; read the comment there before touching it.
  //
  // The popup shows TWO views of one heading model (EXC-1103), and the query picks
  // between them. Empty, it is the whole plan nested by level — the browsing view.
  // Filtered, each ancestor path collapses into ONE breadcrumb header with its matches
  // flush left beneath it, because a match four levels down otherwise spends four rows
  // placing itself.
  //
  // That header is a `Command.Group` heading rather than markup of caret's own: a
  // listbox may own options and groups and NOT loose text, and bits-ui wires the
  // heading up as the group's `aria-labelledby` target, so the ancestor path reaches a
  // screen reader as the group's name.
  //
  // Beside the list, the peek shows the selected row's section: where it sits, its line
  // range, its comments and drafts, whether it changed since the previous version, and
  // its opening lines. bits-ui's pointer selection stays on, so hover selects and the
  // peek follows the pointer; the keyboard's ring shows only while keys drive.
  //
  // Presentational: the only state is the popup's own — open, query, and the
  // command's selected row — the tree and the sections are derived, and the parent owns
  // the heading set, the plan and its comments, and the scroll tracking that moves
  // `activeLine`.
  import type { PlanVersion } from "@core/lib/types";
  import { untrack } from "svelte";

  import { Button } from "$lib/components/ui/button/index.js";
  import * as Command from "$lib/components/ui/command/index.js";
  import type { CommentIndexEntry } from "$lib/feedback.ts";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import {
    groupedHeadingMatches,
    type HeadingGroup,
    type HeadingNode,
    headingTrail,
    headingTree,
  } from "$lib/headingTrail.ts";
  import type { IconName } from "$lib/icons.ts";
  import { createKeyRepeat, walkCommandList } from "$lib/keyRepeat.ts";
  import { ariaKeyshortcutsFor } from "$lib/shortcuts/index.ts";
  import { sound } from "$lib/sound.ts";
  import { headingMatcher, type TocHeading } from "$lib/toc.ts";
  import { describeSection, plural, sectionCounts, tocSections } from "$lib/tocSections.ts";

  import Icon from "@/components/Icon.svelte";

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
    /** Whether the `\` keycap is shown (EXC-1097). When off, the cap hides; the
     * key still works, exactly as the breadcrumbs bar's `b` cap behaves. */
    showShortcutHints?: boolean;
    /** Hand the parent an action that opens the popup, so `\` can summon it
     * (EXC-1097). The same handle PlanBreadcrumbs passes up for `b`. */
    onExposeOpen?: (open: () => void) => void;
  }

  let {
    headings,
    activeLine,
    plan,
    comments,
    previous,
    onJump,
    showShortcutHints = false,
    onExposeOpen,
  }: Props = $props();

  const uid = $props.id();
  let open = $state(false);
  let query = $state("");
  let queryEl = $state<HTMLInputElement | null>(null);

  // Whether keys are driving the selection, which is when its ring shows. Hover moves the
  // selection too, and a ring chasing the pointer would only repeat the hover face.
  let keysDriving = $state(false);
  // The row Enter picked, which plays the key's press while the popup leaves.
  let pressedLine = $state<number | null>(null);

  // Hold-to-repeat for the walk keys (EXC-1122): a held key moves once, pauses,
  // then runs at the app's own cadence rather than the OS's. The lifecycle and the
  // reason it cannot be left to the OS are in $lib/keyRepeat.ts.
  const repeat = createKeyRepeat();

  // Nothing left running if the popup is unmounted mid-hold — compare mode drops
  // both of its entry points while it is open.
  $effect(() => repeat.stop);

  // Tab walks the list instead of leaving it (EXC-1102), and the arrows join it for
  // the cadence (EXC-1122). The claim itself is walkCommandList's, shared with the
  // breadcrumbs bar's filter panel — the same primitive over the same kind of field.
  // What was specific to this surface is only WHY Tab had to be claimed: the popover
  // traps focus with a single tabbable inside, so untouched the key moved focus out
  // of the field and straight back to it, doing nothing at all.
  function onWalkKeydown(e: KeyboardEvent): void {
    keysDriving = true;
    walkCommandList(e, queryEl, repeat);
  }

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

  // Both views are built on the same `parentIndices` walk in the same module, so they
  // can never disagree about what encloses what. `$derived` is lazy, so only the view
  // actually rendered below is ever computed.
  //
  // Every heading renders a row, bounded by the low hundreds of headings a caret plan
  // carries — agent-authored markdown, not a book. What costs at that scale is not this
  // recompute (a few linear passes, microseconds) but what each row IS: a full bits-ui
  // command item with its own effects and id, and a Command.List that tears the whole
  // list down and rebuilds it whenever the query crosses between empty and non-empty.
  // List virtualization is out of scope until a real plan is measured past that ceiling
  // (EXC-1062).
  const tree = $derived(headingTree(headings));
  const groups = $derived(groupedHeadingMatches(headings, query));
  const sections = $derived(tocSections(headings, plan, comments, previous?.plan ?? null));

  // The rows on screen, in either view, so the peek and the match count read what the
  // list shows. The peek checks the selection against them because the command keeps its
  // value when a query unmounts the row it named.
  const shown = $derived(searching ? groups.flatMap((g) => g.matches) : headings);
  const peeked = $derived(shown.find((h) => String(h.line) === selected) ?? null);
  const peekTrail = $derived(
    peeked === null
      ? ""
      : headingTrail(headings, peeked.line)
          .slice(0, -1)
          .map((crumb) => crumb.heading.text)
          .filter((text) => text !== "")
          .join(" › "),
  );

  // The level the PLAN opens at, which is where its indent guides start (EXC-1106).
  // The indent itself is measured from level 1 — that absolute origin is what keeps a
  // section at one indent whatever else is on screen — so a plan whose top-level
  // headings are `##` renders every row one step in with nothing at zero, and guides
  // measured from that empty column would run down a column the plan never opens. A
  // PLAN-WIDE floor rather than a per-row one — see the trade the ::before rule records.
  // The empty arm is unreachable (a plan with no headings renders no rows to read it);
  // it is what keeps Math.min() off Infinity.
  const guideBase = $derived(
    headings.length === 0 ? 1 : Math.min(...headings.map((h) => h.level)),
  );

  // What a row marks — the SAME closure `filterHeadings` decides membership with, reached
  // from beside the filter rather than by transforming what it returns. Why deriving the
  // runs from its OUTPUT silently empties the panel is written once, in toc.ts, where an
  // edit could reintroduce it.
  const matcher = $derived(headingMatcher(query));

  // What the status line says, empty when the list has rows. Derived rather than
  // inlined in the markup because the element it feeds is always mounted (a live region
  // cannot be conjured up with its text already inside it). Read off whichever view is
  // showing, so a query matching nothing and a plan with no headings stay two distinct
  // messages.
  const emptyMessage = $derived(
    (searching ? groups.length : tree.length) > 0
      ? ""
      : headings.length === 0
        ? "No headings in plan"
        : "No headings match",
  );
  const noMatch = $derived(searching && groups.length === 0 && headings.length > 0);

  // Whether the popup is closing because the reviewer picked a heading, which
  // onCloseAutoFocus below reads to decide where focus lands. The same flag
  // PlanBreadcrumbs.svelte spends on the same job and on the same terms: a pick drops
  // focus to the body so the reviewer lands in the plan rather than ringed on a control
  // they are done with, which is affordable because `\` summons the popup back
  // (shortcuts/keymap.ts) exactly as `b` does the bar.
  let leaving = false;

  // A popup always opens on the whole plan, looking at the heading being read.
  // Neither the query nor the row the last session walked to survives, so
  // reopening is never a stale view of a plan that has since scrolled.
  function seed(): void {
    query = "";
    selected = activeLine === null ? "" : String(activeLine);
    keysDriving = false;
    pressedLine = null;
    // The popup's cue, sounded from the open itself rather than from either caller
    // (EXC-1126) — the trigger's onOpenChange and openPopup below both land here, so
    // the `\` key and the click cannot drift onto different sounds. The singleton
    // rather than an injected dep: a component has no factory seam to thread one
    // through — the carve-out sound.ts names.
    sound.play("contentsOpen");
  }

  // The whole open, for callers outside the primitive. bits-ui runs onOpenChange
  // from its OWN box setter only — a trigger click, Escape, an outside click — so
  // a programmatic write to `open` receives none of the seeding the trigger path
  // gets, and poking the flag alone opens the popup on the first row carrying the
  // previous session's query. Both entry points go through here so they cannot
  // diverge.
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
  // The `??` is not dead code beside that clamp: it is NaN's path, which survives both
  // Math.min and Math.max and indexes the tuple out of range.
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
    // A run in flight goes with the popup (EXC-1122). It has to be cancelled here
    // rather than left to the popover's onOpenChange, which bits-ui runs from its OWN
    // box setter — a programmatic write to `open` reaches none of it, the same gap
    // openPopup above documents for the seeding.
    repeat.stop();
    leaving = true;
    pressedLine = line;
    open = false;
    onJump(line);
  }

  // The no-match state's way back. The click took focus to the cap, so it goes back to
  // the field the reviewer was typing in.
  function clearFilter(): void {
    query = "";
    queryEl?.focus();
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
  {@const section = sections.get(heading.line)}
  {@const note = section === undefined ? "" : describeSection(section, previous?.version ?? null)}
  {@const counts = section === undefined ? null : sectionCounts(section)}
  <!-- The counts and the change go through aria-describedby, so the option's name stays
       the heading alone. -->
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
         so the guides to its left stay on the panel's surface. -->
    <span class="toc-key">
      <!-- What level this heading is (EXC-1105). In the shared snippet so both views get it —
           and the filtered one, whose rows are all at depth 0, has nothing else to say it.
           No wrapper element of its own: `data-icon` on Icon.svelte's own <span> is the hook
           the style rule needs. -->
      <Icon name={levelIcon(heading.level)} size={14} />
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
          {#if section?.change}<span class="toc-dot"></span>{/if}
          {#if counts?.comments}
            <span class="toc-count stamp"><Icon name="message-square" size={11} />{counts.comments}</span>
          {/if}
          {#if counts?.drafts}
            <span class="toc-count toc-tint"><Icon name="pencil-line" size={11} />{counts.drafts}</span>
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

<Popover.Root
  bind:open
  onOpenChange={(opening) => {
    // The trigger's half of the seeding above; openPopup covers every other
    // caller, since this fires only for the primitive's own opens.
    if (opening) seed();
    // A popup dismissed mid-hold takes the run with it (EXC-1122): a timer still
    // firing arrows at a field that is gone leaves nothing to walk and everything
    // to leak.
    else repeat.stop();
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
    <!-- `loop` wraps the walk at both ends (EXC-1122). The command defaults it OFF
         where menu content defaults it on (bits-ui command.svelte vs.
         menu-content.svelte), so this list stopped dead where the breadcrumbs bar's
         two views both wrapped. It wraps EVERY one of the command's navigation keys,
         not only Tab — the arrows go with it, which is the point: Tab wrapping while
         the arrows stopped in the same list would read as a bug. -->
    <Command.Root
      shouldFilter={false}
      loop
      bind:value={selected}
      onkeydown={onWalkKeydown}
      data-keys={keysDriving ? "" : undefined}
    >
      <div class="toc-head">
        <Command.Input
          bind:ref={queryEl}
          bind:value={query}
          placeholder="Filter headings…"
          aria-label="Filter headings"
        />
        <!-- aria-hidden: the field's active descendant and the status line already narrate
             what the query left. -->
        <span class="toc-match-count metric" aria-hidden="true">{searching ? shown.length : ""}</span>
      </div>
      <!-- Which of the two views the list is rendering, published so the motion rules
           in the stylesheet can tell them apart (EXC-1107). Inert in every other
           respect: no role, no name, nothing narrated, nothing selectable.
           It is needed because the two views are NOT distinguishable from the markup
           they produce. A filtered row is a bare `Command.Item` exactly as an
           unfiltered one is — the shared `{#snippet row}` emits one shape — and the
           `Command.Group` wrapper is not a proxy for the view either, since a match
           whose ancestor path is empty renders its rows outside any group. Only the
           filtered view's rows animate in (see the toc-row-in rule for why the
           outline's several hundred must not), so something has to say which view is
           on screen.
           `searching` rather than bits-ui's own `search === ""`: they agree except on
           a query that is only whitespace, where this stays "outline" while bits-ui
           still remounts. The marker and the rendered branch come off the SAME derived,
           so "matches" over outline rows — the case that would be wrong — is
           unreachable. The disagreement costs only a spurious toc-list-in when a lone
           space is typed or deleted. -->
      <Command.List
        aria-label="Plan headings"
        data-toc-view={searching ? "matches" : "outline"}
        onpointermove={() => (keysDriving = false)}
        onscroll={(e) => e.currentTarget.toggleAttribute("data-scrolled", e.currentTarget.scrollTop > 0)}
      >
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

               A group with no breadcrumb renders its rows BARE: no header above a
               top-level match, and no unlabelled `role="group"` naming nothing.
               The branch is on the CRUMB rather than on `trail.length`, and the
               two are not the same test: `# ` on its own line is a real heading
               whose text is empty, so a trail can be non-empty and still have
               nothing to say — branching on the length would render exactly the
               unlabelled group this rules out. Empty segments drop out of the
               join for the same reason.

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
           otherwise miss: a query matching nothing leaves no active row for the
           field's aria-activedescendant to name, so without a live region the list
           empties in silence.
           Mounted unconditionally, with only its TEXT switched — a live region has
           to be idle in the DOM before the change it announces, and one inserted
           with its content already in it is skipped by some AT outright. Same shape
           and same reason as FilePreview.svelte's `.fp-range`. -->
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
    <!-- Not a live region: it changes on every hover, and the option's description already
         carries its counts and change to a screen reader. -->
    <div class="toc-peek">
      <div class="toc-peek-body">
        {#if peeked === null}
          <p class="toc-peek-empty">Nothing selected.</p>
        {:else}
          {@const section = sections.get(peeked.line)}
          {#if peekTrail !== ""}
            <p class="toc-peek-trail eyebrow">{peekTrail}</p>
          {/if}
          <p class="toc-peek-title">{peeked.text}</p>
          {#if section !== undefined}
            {@const counts = sectionCounts(section)}
            <div class="toc-peek-facts">
              <span class="toc-fact stamp">Lines <span class="metric">{peeked.line}–{section.end}</span></span>
              {#if counts.comments > 0}
                <span class="toc-fact stamp">
                  <Icon name="message-square" size={11} />{plural(counts.comments, "comment")}
                </span>
              {/if}
              {#if counts.drafts > 0}
                <span class="toc-fact toc-tint">
                  <Icon name="pencil-line" size={11} />{plural(counts.drafts, "draft")}
                </span>
              {/if}
              {#if section.change !== null && previous !== null}
                <span class="toc-fact toc-tint">{section.change} since v{previous.version}</span>
              {/if}
            </div>
            {#if section.excerpt !== ""}
              <p class="toc-peek-excerpt"><span>{section.excerpt}</span></p>
            {/if}
            {#if section.comments.length > 0}
              <ul class="toc-peek-notes">
                {#each section.comments as entry (entry.id)}
                  <li class:draft={entry.draft}>
                    <span class="toc-peek-at metric">L{entry.line}</span>
                    <span class="toc-peek-say">{entry.text}</span>
                  </li>
                {/each}
              </ul>
            {/if}
            {#if section.deeper > 0}
              <p class="toc-peek-deeper">{plural(section.deeper, "more comment")} in subsections.</p>
            {/if}
          {/if}
        {/if}
      </div>
      {#if showShortcutHints}
        <div class="toc-legend" aria-hidden="true">
          <span><Kbd class="kbd-sm">↑</Kbd><Kbd class="kbd-sm">↓</Kbd> walk</span>
          <span><Kbd class="kbd-sm">↵</Kbd> jump</span>
          <span><Kbd class="kbd-sm">esc</Kbd> close</span>
        </div>
      {/if}
    </div>
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

  /* A split float: the outline on the left, the peek on the right. The vendored
     Popover.Content ships w-72 as a padded flex column, so the panel takes over its box.
     The peek is size-contained, so the outline alone sets the panel's height and hovering
     rows of different length never resizes it; the floor holds a typical section's peek
     when the outline is short, and goes when there are no rows to peek at. */
  :global(.plan-toc-panel) {
    display: grid;
    grid-template-columns: minmax(0, 23rem) minmax(0, 1fr);
    width: min(44rem, calc(100vw - 1rem));
    padding: 0;
    gap: 0;
    overflow: hidden;
  }
  :global(.plan-toc-panel:has([data-slot="command-item"])) {
    min-height: min(21rem, 70vh);
  }
  :global(.plan-toc-panel [data-slot="command"]) {
    padding: 0;
    border-radius: 0;
    background: transparent;
  }

  /* The filter field, cut into the panel to the `.field-well` recipe, focus included: no
     ring, only the text cursor and an edge a step firmer. The atom itself can't apply: the
     vendored input group pins its box-shadow with `shadow-none!`, which only Tailwind's own
     shadow variables reach. */
  :global(.plan-toc-panel .toc-head) {
    position: relative;
    z-index: 1;
    background: var(--paper-raised);
    transition: box-shadow var(--dur-state) var(--ease-out);
  }
  :global(.plan-toc-panel [data-slot="command-input-wrapper"]) {
    padding: 4px;
  }
  :global(.plan-toc-panel [data-slot="command-input-wrapper"] [data-slot="input-group"]) {
    border-color: transparent;
    background: var(--field-floor);
    --tw-inset-shadow: var(--field-shade);
    --tw-inset-ring-shadow: inset 0 0 0 1px var(--rule);
    --tw-ring-shadow: var(--well-lip);
  }
  :global(.plan-toc-panel [data-slot="command-input-wrapper"] [data-slot="input-group"]:focus-within) {
    --tw-inset-ring-shadow: inset 0 0 0 1px var(--rule-strong);
  }
  :global(.plan-toc-panel [data-slot="command-input-wrapper"] [data-slot="input-group-addon"]) {
    opacity: 1;
    color: var(--ink-faint);
  }
  :global(.plan-toc-panel [data-slot="command-input"]) {
    padding-inline-end: 2rem;
    font-size: var(--text-md);
    caret-color: var(--accent);
  }
  :global(.plan-toc-panel [data-slot="command-input"])::placeholder {
    color: var(--ink-faint);
    opacity: 1;
  }
  :global(.plan-toc-panel .toc-match-count) {
    position: absolute;
    inset-block: 4px;
    inset-inline-end: calc(4px + 0.6rem);
    display: flex;
    align-items: center;
    font-size: var(--text-2xs);
    color: var(--ink-faint);
    pointer-events: none;
  }
  /* Once rows have scrolled beneath it, the field's band casts a shade over them. The
     list marks itself rather than going through state, so the list bits-ui rebuilds at
     each empty/non-empty crossing starts unshaded. */
  :global(.plan-toc-panel [data-slot="command"]:has([data-slot="command-list"][data-scrolled]) .toc-head) {
    box-shadow:
      0 1px 0 var(--rule),
      var(--float-low);
  }

  /* The list re-forming when the query crosses between empty and non-empty — the one
     boundary at which this surface really does swap one view for another. bits-ui's
     `Command.List` wraps its OWN element in `{#key search === ""}`, so the list — the
     element `data-toc-view` above hangs on — and the viewport under it are both
     destroyed and rebuilt at exactly that crossing (see command-list.svelte, which
     documents it as the hazard it is for anything reading `viewportNode` back). A
     remount restarts a CSS animation on its own, which makes that teardown the trigger:
     nothing of caret's own to retrigger, and it cannot fire more than once per crossing
     however fast the reviewer types.
     Scoped to the OUTLINE arm only. Coming back to the whole plan is the direction that
     has nothing else to carry it, since the outline's rows deliberately do not animate;
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
  :global(.plan-toc-panel [data-toc-view="outline"] [data-slot="command-viewport"]) {
    animation: toc-list-in var(--dur-state) var(--ease-out);
  }

  /* A match arriving, and its breadcrumb header arriving with it. ONE declaration for
     both, so a header cannot pop in above rows that faded.
     Rows animate IN only. A row that stops matching is removed by Svelte with nothing
     to hang an exit on, and the two mechanisms that could give it one — a Svelte
     `transition` directive, or a FLIP `animate` one — are both element-only, where
     `Command.Item` is a component. Reaching either would mean a wrapper element inside
     the `role="listbox"`, which takes ownership of the options away from it, or a
     `child` snippet reimplementing the vendored item — and both put a JS-driven
     transition on every row of a list that runs to the low hundreds.
     Scoped to the MATCHES arm, and NOT because that view is always small — measured on
     the dev plan, a one-character query matches 44 of its 64 headings across 15 groups
     and every one of them mounts at once. What the scoping buys is that the filtered
     view mounts only when the reviewer types, where the outline mounts on every single
     open and its arrival is already carried by the panel's own zoom and the list rule
     beside it. Those 59 concurrent ramps cost nothing readable: profiled over that
     crossing, frame times were median 8.3ms / p95 9.7ms / max 16.6ms with this rule and
     median 8.3 / p95 9.7 / max 16.7 with it disabled.
     Opacity and transform only, and no `will-change`: a CSS-animated element is
     promoted by the browser on its own, and pinning a layer per row is how a list this
     long turns a cheap animation into a memory problem. The offset is vertical, so
     `--toc-step` — the one source for the indent rhythm and the guide comb — is not
     involved. */
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
  :global(.plan-toc-panel [data-toc-view="matches"] [data-slot="command-item"]),
  :global(.plan-toc-panel [data-toc-view="matches"] [data-command-group-heading]) {
    animation: toc-row-in var(--dur-state) var(--ease-out);
  }

  /* The list carries its own leading space so the first row is not flush against
     the filter field: the vendored command-input wrapper is `p-1 pb-0` and the list
     only `scroll-py-1`, so nothing sat between them. It rides on the scroll
     container rather than on the first row, which keeps it a property of the list
     as a whole — a row scrolled to the top does not carry a phantom offset with it.

     The height is the ToC's own, deliberately NOT the vendored `max-h-72` (18rem)
     it overrides: that class is shared with the breadcrumbs bar's filter panel
     (EXC-1098), which anchors to a crumb mid-bar and wants to stay compact. This
     panel hangs off the control row with the whole plan under it, so it earns a longer
     run before scrolling.

     Both terms of the min() have to be resolvable when the stylesheet is parsed, which
     rules out --bits-popover-content-available-height: floating-ui publishes it a frame
     LATE, and a min() over an unset variable is invalid at computed-value time, which
     drops max-height to `unset` rather than to an earlier declaration. The list would
     mount at its natural height, and bits-ui — which scrolls the seeded row into view
     exactly once, on that mount — would find nothing overflowing and scroll nowhere,
     leaving the popup parked at the top with the current heading below the fold. `vh`
     costs a clamp against the window rather than against the trigger's own room, and is
     never invalid. */
  :global(.plan-toc-panel [data-slot="command-list"]) {
    padding: 0.375rem 4px 4px;
    max-height: min(25rem, 70vh);
  }

  /* One step of nesting, and the panel's own grid. The indent, the guide band's
     origin, its width, and the comb the guides are drawn with are four measurements
     that MUST agree, and three of them are pinned against each other by the e2e's
     `band.left + band.width === padding + guide-x` — the gradient's repeat period is
     not, so a step retuned in one place and not the other would slide every column but
     the first off its glyph while the suite stayed green. One declaration, per
     svelte-rules.md § CSS-token discipline ("a constant coupled across files gets
     one named source"). --toc-guide-x is mirrored as GUIDE_X_PX in
     test/e2e/plan-toc.e2e.ts. */
  :global(.plan-toc-panel) {
    --toc-step: 1rem;
    --toc-guide-x: 0.55rem;
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
     cost the row width that the deepest matches need most.
     The row itself never paints: its key (below) is the part that rises. */
  :global(.plan-toc-panel [data-slot="command-item"]) {
    padding: 0;
    padding-inline-start: calc(var(--toc-depth, 0) * var(--toc-step));
    background: transparent;
    color: var(--ink);
    font-size: var(--text-md);
    line-height: var(--leading-tight);
  }
  :global(.plan-toc-panel [data-slot="command-item"]:is([data-level="4"], [data-level="5"], [data-level="6"])) {
    color: var(--ink-soft);
  }
  :global(.plan-toc-panel :is([data-level="1"], [data-level="2"]) .toc-label) {
    font-weight: 600;
  }
  /* The vendored row's check indicator marks a checked item, which a heading never is. */
  :global(.plan-toc-panel .cn-command-item-indicator) {
    display: none;
  }

  /* The indent guides (EXC-1106): one hairline per level between the plan's own
     root and this row, at the indent's own pitch, so a row's text and the column
     it hangs under agree about depth. A row draws NOTHING in its own column — the
     line for a level is punctuated by the heading that opens it, which is what
     makes the set read as a tree rather than as a ruled ledger. --toc-guides is
     therefore the count, and where the band STARTS falls out of it: each tooth hangs
     --toc-guide-x into its ancestor's key, under that key's level glyph.
     Zero is the whole of the filtered view's answer (a flush-left row hangs under
     a breadcrumb header, not under a column) and of a plan's shallowest rows,
     which is why the count is passed rather than derived from --toc-depth: only
     the indent is measured from level 1. A zero width paints nothing, so both
     cases fall out of the same declaration.

     A column marks a LEVEL, not a tree edge, and that is the trade — the same one the
     indent rule above accepts. A plan that skips from `#` to `###` draws a column at the
     level in between, and a plan that opens deeper than a heading further down
     (`## Alpha` before `# Beta`) gives Alpha a column with nothing above it. Accepted:
     the indent is absolute, so `###` sits two steps in whether or not a `##` exists, and
     guides drawn from the real ancestors would leave a guide-free channel immediately
     left of a plainly indented row. What guideBase closes is narrower: a column to the
     left of EVERY row, down the whole panel, where the plan has no such level.

     A ::before rather than the row's own background: border-radius clips an element's
     own background layers while leaving an absolutely-positioned child alone, and the
     row is rounded-lg, so the leftmost tooth would be nicked top and bottom and the line
     would stripe at each row boundary. `inset-block: 0` on an already-relative row is
     what joins adjacent rows into one line.
     content:"" and pointer-events:none: nothing in the accessibility tree, and nothing
     between the reviewer and the row they are clicking.
     --rule is what caret already paints an indent guide with — FolderTree.svelte hands
     it to `--trees-indent-guide-bg-override` for the file tree's — so it retints with
     the theme for free. */
  :global(.plan-toc-panel [data-slot="command-item"])::before {
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

  /* The key: a row's cap, flat on the panel at rest. It rises under the pointer, which
     moves the selection; the keyboard's selection adds a solid --accent ring, since the
     bridge's 30% --ring falls under 3:1 against the float and here the ring is the one
     signal telling the keyboard's row from the pointer's. The heading being read is
     latched down, as the compare toggle is when it is on. Every state draws the same five
     shadow layers, so a change of state transitions. The layers are the kit's cap rest
     and press (styles/atoms.css); a row is no `.cap`, which would claim a tray. */
  :global(.plan-toc-panel) {
    --toc-key-flat:
      inset 0 0 0 0 transparent,
      inset 0 1px 0 transparent,
      inset 0 0 0 1px transparent,
      inset 0 4px 5px -3px transparent,
      inset 0 -3px 6px 0 transparent;
    --toc-key-up:
      inset 0 0 0 0 transparent,
      inset 0 1px 0 var(--rim-top),
      inset 0 0 0 1px var(--rim-side),
      inset 0 4px 5px -3px var(--dome-hi),
      inset 0 -3px 6px 0 var(--dome-lo);
    --toc-key-down:
      inset 0 0 0 1px var(--well-floor),
      inset 0 1px 0 transparent,
      inset 0 0 0 2px var(--rim-side),
      inset 0 4px 5px -1px var(--press-shade),
      inset 0 0 4px 1px var(--press-ring);
  }
  :global(.plan-toc-panel .toc-key) {
    --key-face: transparent;
    --key-grain: none;
    --key-shadow: var(--toc-key-flat);
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.875rem;
    padding: 0 0.45rem 0 0.375rem;
    border-radius: var(--radius);
    background-color: var(--key-face);
    background-image: var(--key-grain);
    background-size: 128px;
    background-blend-mode: soft-light;
    box-shadow: var(--key-shadow);
    outline: 2px solid transparent;
    outline-offset: 1px;
    transition:
      background-color var(--dur-state) var(--ease-out),
      color var(--dur-state) var(--ease-out),
      box-shadow var(--dur-state) var(--ease-out),
      outline-color var(--dur-state) var(--ease-out);
  }
  :global(.plan-toc-panel [data-slot="command-item"][data-selected] .toc-key) {
    --key-face: var(--neutral-face-hover);
    --key-grain: var(--grain);
    --key-shadow: var(--toc-key-up);
    color: var(--ink);
  }
  :global(.plan-toc-panel [data-keys] [data-slot="command-item"][data-selected] .toc-key) {
    outline-color: var(--accent);
  }
  :global(.plan-toc-panel [data-slot="command-item"][aria-current="location"] .toc-key) {
    --key-face: var(--neutral-face-latched);
    --key-grain: var(--grain);
    --key-shadow: var(--toc-key-down);
    color: var(--ink);
  }
  :global(.plan-toc-panel [data-slot="command-item"][aria-current="location"][data-selected] .toc-key) {
    --key-face: color-mix(in lab, var(--neutral-face-latched), var(--neutral-face-hover));
  }
  :global(.plan-toc-panel [data-slot="command-item"]:is(:active, [data-key-pressed]) .toc-key) {
    --key-face: var(--neutral-face-down);
    --key-grain: var(--grain);
    --key-shadow: var(--toc-key-down);
  }

  /* What a row says beyond its heading: an --attention dot when the section changed
     since the previous version, and stamps counting its comments and its drafts. */
  :global(.plan-toc-panel .toc-meta) {
    flex: none;
    margin-inline-start: auto;
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  :global(.plan-toc-panel .toc-dot) {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 99px;
    background: var(--attention);
  }
  :global(.plan-toc-panel :is(.toc-count, .toc-fact)) {
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
  :global(.plan-toc-panel .toc-count) {
    padding: 0 0.42rem 0 0.32rem;
  }
  /* A draft or a change is novelty, tinted at the comment stamp's strengths, so a draft
     count reads as the Draft stamp on a comment card does. */
  :global(.plan-toc-panel .toc-tint) {
    background: color-mix(in lab, var(--well-floor), var(--attention) var(--stamp-floor));
    box-shadow: var(--well-shade), var(--well-lip);
    color: color-mix(in lab, var(--attention), var(--stamp-word-toward) var(--stamp-word-mix));
  }
  /* The vendored row inks every svg of a selected row; a stamp's glyph keeps its word's. */
  :global(.plan-toc-panel :is(.toc-meta, .toc-peek-facts) svg) {
    color: inherit;
  }

  /* The vendored group ships `p-1`, which would inset its rows a step further than
     the unfiltered view's and open a gap the list already pads. The header and the
     rows carry their own padding, so the group is a pure grouping box — and an unclipped
     one, since a flush-left key's ring reaches past the group's edges. */
  :global(.plan-toc-panel [data-slot="command-group"]) {
    padding: 0;
    overflow: visible;
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
  /* One line, elided from the START (EXC-1108). A deep path is mostly ancestors the
     reader already knows; what places the match is the tail, so that is the half worth
     keeping when the line runs out. Italic separates the path from the headings it is
     made of — every segment here is also a heading's own text, and upright it reads as
     one more row rather than as the trail above them.

     CSS has no start-ellipsis, so this is the `direction: rtl` technique: the inline
     END moves to the left, and `text-overflow` elides there. `text-align: left` puts
     the line back where the rows are. The text itself is unaffected — every segment is
     a strong LTR run, and the bidi algorithm resolves the neutral separators between
     two LTR runs as LTR (UBA rule N1), so the path still reads left to right.

     The `::after` is what makes that safe rather than nearly safe. Rule N1 needs a
     strong character on BOTH sides; a TRAILING neutral has none, so it falls to N2 and
     takes the paragraph direction — RTL — which throws it to the far left. A heading
     ending in `?` or `)` really does render `?ROLLOUT PLAN › WHY`; the e2e reds on it.
     A zero-width LEFT-TO-RIGHT MARK gives those neutrals the following strong LTR
     character they need.

     `/ ""` is the half that keeps it out of the accessibility tree, and it is not
     decoration. Generated content participates in the accessible NAME computation, and
     this heading is its group's `aria-labelledby` target — so a bare `content: "\200E"`
     appends the mark to the group's name and the committed role-and-name query for
     `Plan › Setup` stops matching. The alternative-text syntax hands the renderer the
     mark and assistive tech an empty string. `textContent` never saw either form, which
     is why the unit assertions could not have caught that. */
  :global(.plan-toc-panel [data-command-group-heading]) {
    padding-inline: 0.5rem;
    padding-block: 0.25rem;
    margin-block-start: 0.5rem;
    font-style: italic;
    direction: rtl;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :global(.plan-toc-panel [data-command-group-heading])::after {
    content: "\200E" / "";
  }
  :global(.plan-toc-panel [data-slot="command-group"]:first-child [data-command-group-heading]) {
    margin-block-start: 0;
  }

  /* The heading-level marker, dimmer than the label it labels: subordinate wayfinding
     rather than content, so it takes the neutral ink ramp and not a hue — it is none of
     the three jobs a hue has (doc/agents/svelte-rules.md § Every hue has a job).
     On the SVG rather than on Icon.svelte's wrapper, and that placement is the whole rule.
     The vendored item declares `data-selected:[&_svg]:text-accent-foreground` on the svg
     itself — which the bridge resolves to the LABEL's own --ink — and a declaration that
     matches an element beats a value inherited into it, whatever layer either sits in. A
     rule on the wrapper loses the walked-to row without ever being overridden, and that row
     is no edge case: the popup seeds its selection to the heading being read on every open,
     and the filtered view always lands on the first match.
     --ink-soft rather than the fainter rung the eyebrow takes, because the ground that
     decides it is not the panel but a raised or latched key's face, where --ink-faint
     falls under the 3:1 a non-text graphic wants. */
  :global(.plan-toc-panel [data-slot="command-item"] [data-icon^="heading-"] svg) {
    color: var(--ink-soft);
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
     inside one. What keeps it legible is ALPHA STACKING: --mark composites on top of
     whatever the row already paints, so the run is always a step further from the panel
     than its row is. Not a hue guarantee — only caret's own palette names a markHue
     distinct from its washHue; every vendor palette leaves both unset and recipe.ts
     collapses markHue → washHue → accent. Measured on the painted pixels, the run
     separates from its row by ΔE*ab 8.8–20.3 across both schemes and all three row
     states. */
  :global(.plan-toc-panel .toc-hit) {
    border-radius: 2px;
    background: var(--mark);
    box-shadow: var(--chip-stamped);
    color: var(--ink);
  }

  /* An empty list says why, at the quietest ink — the same weight the breadcrumbs'
     own no-match line takes. The box is always in the markup so the live region is
     idle before it speaks, so the padding is what it wears only when it has
     something to say: with no text and no padding it generates no line box and the
     panel closes up exactly as it did when the element was conditional. */
  :global(.plan-toc-panel .toc-empty-row) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding-inline: 4px;
  }
  :global(.plan-toc-panel .toc-empty) {
    margin: 0;
    padding: 0;
    min-width: 0;
    color: var(--ink-soft);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }
  :global(.plan-toc-panel .toc-empty:not(:empty)) {
    padding: 0.55rem 0.25rem 0.55rem 0.5rem;
  }
  :global(.plan-toc-panel .toc-empty-row .tray) {
    margin-block: 0.25rem;
  }

  /* The peek: everything caret knows about the selected row's section, on a ground a
     step toward the sunk paper so it reads as a pane of the float rather than a second
     list. The opening lines sit in a recessed panel, as a fenced block does in the
     plan. */
  :global(.plan-toc-panel .toc-peek) {
    contain: size;
    display: flex;
    flex-direction: column;
    min-width: 0;
    border-inline-start: 1px solid var(--rule);
    background: color-mix(in lab, var(--paper-raised), var(--paper-sunk) 55%);
    font-size: var(--text-md);
  }
  /* The body scrolls when a section has more to say than the outline is tall, and the key
     legend stays put below it. */
  :global(.plan-toc-panel .toc-peek-body) {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.85rem 0.95rem 0.7rem;
  }
  /* Children keep their height and the body scrolls, rather than a clipped child (the
     trail) shrinking away to nothing. */
  :global(.plan-toc-panel .toc-peek-body > *) {
    flex: none;
  }
  :global(.plan-toc-panel .toc-peek p) {
    margin: 0;
  }
  /* Elided from the start, like the breadcrumb headers above, for the same reasons. */
  :global(.plan-toc-panel .toc-peek-trail) {
    margin-block-end: -0.35rem;
    font-style: italic;
    direction: rtl;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  :global(.plan-toc-panel .toc-peek-trail)::after {
    content: "\200E" / "";
  }
  :global(.plan-toc-panel .toc-peek-title) {
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: var(--leading-tight);
    text-wrap: balance;
    overflow-wrap: anywhere;
  }
  :global(.plan-toc-panel .toc-peek-facts) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  :global(.plan-toc-panel .toc-fact) {
    padding: 0 0.45rem;
    font-family: var(--font-sans);
    letter-spacing: 0.02em;
  }
  :global(.plan-toc-panel .toc-peek-excerpt) {
    padding: 0.5rem 0.65rem;
    border-radius: var(--radius);
    background: var(--code-panel);
    box-shadow: var(--panel-recess);
    color: var(--ink-soft);
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
  }
  :global(.plan-toc-panel .toc-peek-excerpt span) {
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  :global(.plan-toc-panel .toc-peek-notes) {
    display: grid;
    gap: 0.35rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  :global(.plan-toc-panel .toc-peek-notes li) {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
  }
  :global(.plan-toc-panel .toc-peek-at) {
    flex: none;
    font-size: var(--text-2xs);
    color: var(--ink-faint);
  }
  :global(.plan-toc-panel .toc-peek-say) {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  :global(.plan-toc-panel .toc-peek-notes .draft .toc-peek-say) {
    color: var(--ink-soft);
    font-style: italic;
  }
  :global(.plan-toc-panel :is(.toc-peek-deeper, .toc-peek-empty)) {
    color: var(--ink-faint);
    font-size: var(--text-sm);
  }
  /* The key legend, run edge to edge along the peek's foot. */
  :global(.plan-toc-panel .toc-legend) {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.9rem;
    padding: 0.45rem 0.65rem;
    border-top: 1px solid var(--rule);
    color: var(--ink-faint);
    font-size: var(--text-xs);
  }
  :global(.plan-toc-panel .toc-legend span) {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }
  @media (hover: none) and (pointer: coarse) {
    :global(.plan-toc-panel .toc-legend) {
      display: none;
    }
  }

  /* Under 40rem of panel the peek stacks below the outline, and the two share the
     window's height rather than each claiming most of it. 41rem is the 40rem panel plus
     the 1rem the width rule above keeps clear of the window. */
  @media (max-width: 41rem) {
    :global(.plan-toc-panel) {
      grid-template-columns: minmax(0, 1fr);
    }
    :global(.plan-toc-panel:has([data-slot="command-item"])) {
      min-height: 0;
    }
    :global(.plan-toc-panel [data-slot="command-list"]) {
      max-height: 40vh;
    }
    :global(.plan-toc-panel .toc-peek) {
      contain: none;
      max-height: 40vh;
      border-inline-start: 0;
      border-top: 1px solid var(--rule);
    }
  }
</style>
