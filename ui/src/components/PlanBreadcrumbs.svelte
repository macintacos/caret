<script lang="ts">
  // Heading breadcrumbs bar for the source-view plan surface (EXC-946), and since
  // EXC-949 retired the contents rail, the plan's only heading-navigation surface.
  // It answers "where am I in this plan": the ancestor chain enclosing the heading
  // being read, updating as the reviewer scrolls. It reads the line-anchored
  // heading model in toc.ts through headingTrail.ts, and reports a pick as a source
  // line, which the parent turns into a scroll.
  //
  // Each crumb opens the headings it can be swapped for at that level. The crumb's
  // OWN heading opens the level below as a submenu instead of jumping in place —
  // you are already there — so one menu walks the whole hierarchy rather than
  // making the reviewer close and reopen at each depth.
  //
  // Presentational: no state of its own, the trail is derived, and the parent owns
  // both the heading set and the scroll tracking that moves `activeLine`.
  //
  // EXC-947: keyboard-drivable too. `b` (registered by DiffPlanView) invokes the
  // trailing crumb through the `onExposeOpen` handle below, and j/k walk the open
  // menu's rows — including a submenu's — by re-dispatching as the arrow keys the
  // menu already handles.
  //
  // EXC-948: `/` swaps the open menu for a flat filter over EVERY heading in the
  // plan — the browsing model the menus give you, traded for the one you want
  // when you already know the destination. It stays inside the same menu, so the
  // walk, the jump, the dismissal, and the focus return are all still the
  // primitive's; Escape swaps the hierarchy back rather than closing.
  //
  // That reuse costs one ARIA deviation, recorded here rather than left to be
  // rediscovered: bits-ui puts role="menu" on the content, and a textbox is not
  // among the roles `menu` admits as children. The role cannot be overridden from
  // the call site (the primitive merges its own last), so a screen reader in menu
  // mode gets the field's label but no narration as the row set narrows. The
  // structural fix is combobox + listbox semantics — shadcn's `command` in a
  // popover — which is a vendoring job this issue does not carry.
  import { type Snippet, tick, untrack } from "svelte";

  import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import {
    type HeadingNode,
    headingMatches,
    headingTrail,
    visibleDepths,
  } from "$lib/headingTrail.ts";
  import { ariaKeyshortcutsFor } from "$lib/shortcuts/index.ts";
  import type { TocHeading } from "$lib/toc.ts";

  interface Props {
    /** Headings extracted from the plan source, in document order. */
    headings: TocHeading[];
    /** Source line of the heading currently in the reading zone, or null. */
    activeLine: number | null;
    /** Jump the view to a heading's 1-based source line. */
    onJump: (line: number) => void;
    /** Whether the `b` keycap is shown (EXC-826/EXC-947). When off, the cap hides;
     * the key itself still works. */
    showShortcutHints?: boolean;
    /** Hand the parent a closure that opens the trailing crumb's menu, so the `b`
     * binding can invoke the bar without reaching into its markup. Mirrors
     * DiffPlanView's own `onExposeReveal` handle. */
    onExposeOpen?: (open: () => void) => void;
  }

  let { headings, activeLine, onJump, showShortcutHints = false, onExposeOpen }: Props = $props();

  const trail = $derived(headingTrail(headings, activeLine));

  // The headings on the reviewer's own trail, by source line: what marks "you
  // are here" in a menu at any depth, and what stays unmarked once the walk
  // turns off into a branch the reviewer is not in.
  const trailLines = $derived(new Set(trail.map((crumb) => crumb.heading.line)));

  let barEl = $state<HTMLElement | null>(null);

  // Open the crumb the reader is on — the level being read, the one `b` advertises.
  // A programmatic click carries detail: 0, which is exactly what bits-ui's trigger
  // treats as a keyboard-ish activation, so the whole invocation is the click; a
  // second `b` toggles back shut. bits-ui then usually moves focus onto the first
  // row itself, since the real `b` keypress left its `isUsingKeyboard` true — but
  // that flag also clears on pointermove, so a mouse twitch mid-open can leave focus
  // on the content instead. Either way j/k below enter the list from the top.
  // Keyed on aria-current rather than the .current class: same element, but a
  // contract the menu depends on instead of a style hook a CSS pass could rename.
  function openTrail(): void {
    barEl?.querySelector<HTMLButtonElement>('.crumb[aria-current="location"]')?.click();
  }

  // Hand the open action up once. `untrack` keeps onExposeOpen from becoming a
  // dependency; openTrail reads the live `barEl`, so exposing it before the bar
  // paints is safe (it simply no-ops until there is a crumb).
  $effect(() => {
    untrack(() => onExposeOpen)?.(openTrail);
  });

  // The vim keys the open menu answers to, mapped onto the arrows bits-ui's own
  // roving focus and submenu handling already implement (EXC-947 for the walk,
  // EXC-957 for the hierarchy). Left/right are the primitive's SUB_CLOSE_KEYS and
  // SUB_OPEN_KEYS, so `h` steps back out to the row that opened the submenu and
  // `l` descends into the highlighted row's own.
  const MENU_ARROWS: Record<string, string> = {
    j: "ArrowDown",
    k: "ArrowUp",
    h: "ArrowLeft",
    l: "ArrowRight",
  };

  // h/j/k/l walk the open menu, re-dispatched as the arrow keys above — so a
  // submenu (whose content has its own roving group) walks with the same few
  // lines, and disabled rows, wrapping, and Enter-to-select all stay the
  // primitive's. Handled here, on the content, rather than as a global
  // binding, because the dispatcher suppresses nothing just because a menu owns
  // focus. That is only half of what CommentNavigator does (EXC-792): it ALSO
  // extends the dispatcher's editing-context check in App.svelte, which buys it
  // every key at once. This claims four keys, so the rest of the review keys still
  // reach the plan while a crumb menu is open.
  //
  // Only bare keys. A command modifier means the reviewer is talking to the
  // browser or the OS (⌘J is Downloads), so those pass straight through — the same
  // line bits-ui's typeahead and the dispatcher's own isBareSpec draw. A shifted
  // J/K never arrives here at all: the key is then uppercase.
  //
  // The one preventDefault does two jobs, and the order each needs is guaranteed
  // by svelte-toolbelt's composeHandlers, which re-checks defaultPrevented before
  // EVERY handler in a merged chain:
  //   1. bits-ui merges this handler ahead of its own, so the letter never reaches
  //      the menu's typeahead and jumps to some row starting with "j".
  //   2. The window dispatcher yields on defaultPrevented, so the plan's own j/k
  //      line cursor stays put behind the open menu.
  // The re-dispatch below cannot loop: it carries an ARROW, which the map does not
  // hold, so the second pass returns at the lookup rather than dispatching a
  // third. (Before EXC-957 portalled the SubContent, a submenu's keydown also
  // bubbled into the parent Content's copy of this handler, and defaultPrevented
  // was what stopped that. It no longer reaches there; both still carry the
  // handler, which is why the walk works at every depth either way.)
  // Job 2 is vacuous for h and l — neither is bound in keymap.ts — but they take
  // the same path as j/k rather than a second, quieter one, so a later binding on
  // either key cannot reach the plan from behind an open menu.
  // Arrow keys are untouched and keep working.
  function onMenuKeydown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // `/` trades the hierarchy for the flat filter, from whatever depth of the
    // menu is open, and — once filtering — takes the reviewer back to the query
    // from a row they walked to, the same second job it does in the comment
    // navigator. It never arrives from the field itself, which stops its own
    // keys, so a `/` there is typed into the query.
    // The preventDefault is load-bearing twice over: it keeps the key out of the
    // menu's typeahead, and the window dispatcher yields on defaultPrevented, so
    // the plan's own `/` search stays shut behind the bar.
    if (e.key === "/") {
      e.preventDefault();
      filtering = true;
      queryEl?.focus();
      return;
    }
    const arrow = MENU_ARROWS[e.key];
    if (arrow === undefined) return;
    e.preventDefault();
    // At the top of a crumb's own menu there is no submenu for ArrowLeft to
    // close, so `h` steps out to the crumb before it in the trail instead. That
    // is the "up" a reviewer means once the menu they are in is already the
    // outermost one open — and without it the keyboard could only ever reach the
    // subtree of whichever crumb the menu was opened on, while a mouse could
    // reach the whole plan from the outermost one.
    if (e.key === "h" && openPreviousCrumb()) return;
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: arrow, bubbles: true, cancelable: true }),
    );
  }

  // Move the open menu one crumb outward, if there is one and no submenu is open
  // beneath it. Both steps are the programmatic click openTrail uses — the first
  // toggles the open trigger shut, the second opens its neighbour — so focus
  // lands in the new menu exactly as `b` leaves it. Returns whether it moved, so
  // the caller can fall through to the arrow when it did not.
  function openPreviousCrumb(): boolean {
    if (document.activeElement?.closest("[data-slot='dropdown-menu-sub-content']")) return false;
    const cells = [
      ...(barEl?.querySelectorAll<HTMLElement>(
        ".crumb-item:not(.elided), .crumb-marker:not(.elided)",
      ) ?? []),
    ];
    const open = cells.findIndex((cell) => cell.querySelector('[aria-expanded="true"]') !== null);
    const previous = cells[open - 1]?.querySelector<HTMLButtonElement>("button");
    if (open < 1 || previous === undefined || previous === null) return false;
    cells[open]?.querySelector<HTMLButtonElement>("button")?.click();
    previous.click();
    return true;
  }

  // Take the reviewer to a heading and leave the bar. A plain row's select closes
  // the menu on its own; a row that nests a submenu has no select to close it, so
  // the open trigger is toggled shut with the same programmatic click openTrail
  // uses to open one. Scoped to the bar, so the match is a crumb's trigger or the
  // elision marker's — the two things here that open a menu — and never a
  // sub-trigger, which lives in bits-ui's portalled content outside this element.
  function jump(line: number): void {
    barEl?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.click();
    onJump(line);
  }

  // A heading with children is still a destination, not only a doorway: Enter
  // and a mouse click take the reviewer there, while `l`/ArrowRight, Space and
  // hover open the level below it.
  //
  // bits-ui turns each of ITS submenu-open keys into a synthetic click on the
  // trigger, so the two paths can only be told apart on the click's `detail` — 0
  // for that synthetic one, non-zero for a real press, the same tell openTrail
  // reads above. Enter never reaches that point: it is claimed here first,
  // because bits-ui's own handler would have flattened it into the very click
  // this cannot distinguish.
  function onRowKeydown(e: KeyboardEvent, line: number): void {
    if (e.key !== "Enter" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    jump(line);
  }

  function onRowClick(e: MouseEvent, line: number): void {
    if (e.detail === 0) return;
    e.preventDefault();
    jump(line);
  }

  // Whether the open menu is showing the filter rather than the hierarchy, and
  // the live query. One set for the whole bar: the results span the plan, so
  // which crumb hosts them carries no meaning.
  let filtering = $state(false);
  let query = $state("");
  let queryEl = $state<HTMLInputElement | null>(null);

  const matches = $derived(headingMatches(headings, query));

  // The reviewer opened the filter to type, so the field takes focus as soon as
  // it exists. Reads `queryEl` reactively, which is what makes this fire on the
  // render that mounts the field rather than the keystroke that asked for it.
  $effect(() => {
    if (filtering) queryEl?.focus();
  });

  // The open menu's content element, reached through the field rather than the
  // document: bits-ui portals the content to the body, so the field's ancestor is
  // the only handle on the panel these rows belong to that cannot pick up a
  // different crumb's menu — including one still fading out.
  function menuContent(): HTMLElement | null {
    return queryEl?.closest<HTMLElement>("[data-slot='dropdown-menu-content']") ?? null;
  }

  // The result rows. While filtering, every item in that content is one.
  function resultRows(): HTMLElement[] {
    return [
      ...(menuContent()?.querySelectorAll<HTMLElement>("[data-slot='dropdown-menu-item']") ?? []),
    ];
  }

  // Put the hierarchy back with the menu still open, and land focus on a row so
  // j/k keep working. The content is resolved BEFORE the swap, since the field it
  // is reached through is the very thing about to unmount; the await is what lets
  // the rows being focused exist by the time they are looked up.
  async function restoreMenu(): Promise<void> {
    const content = menuContent();
    filtering = false;
    query = "";
    await tick();
    content
      ?.querySelector<HTMLElement>(
        "[data-slot='dropdown-menu-item'], [data-slot='dropdown-menu-sub-trigger']",
      )
      ?.focus();
  }

  // The query field's keys. Four belong to the surface rather than to the query,
  // so they keep bubbling: Escape to the content's onEscapeKeydown below, which is
  // the single place deciding what Escape means here; Tab to bits-ui's own
  // handleTabKeyDown, which closes the menu and moves focus past the bar; and the
  // vertical arrows to the menu's roving focus group, which enters the results at
  // the top on ArrowDown and at the bottom on ArrowUp precisely because the field
  // is not one of its candidates. Everything else is stopped, because bits-ui runs
  // typeahead on any character key inside the content and focuses whichever row
  // matches — which would empty the field of focus on the first keystroke.
  function onQueryKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" || e.key === "Tab" || e.key === "ArrowDown" || e.key === "ArrowUp") {
      return;
    }
    e.stopPropagation();
    if (e.key === "Enter") {
      // The row's own select: it jumps AND closes the menu, so Enter from the
      // field is the four-keystroke path (b, /, query, Enter) without a detour
      // through the list. CommentNavigator's Enter instead hands focus to its
      // list — its rows are cards to read, where these are destinations to take.
      e.preventDefault();
      resultRows()[0]?.click();
    }
  }

  // The bar elides the middle of its trail on the room the row actually gives it
  // — a measurement, not the depth count it used to be (EXC-957), which shortened
  // a four-level trail on a 1600px window with the row half empty.
  //
  // EVERY level is rendered, whatever the row can hold; the ones it cannot get
  // `.elided`, which takes them out of flow, out of the a11y tree, and out of the
  // tab order while leaving them measurable. That is what breaks the circularity
  // in "measure the whole trail while showing part of it": dropping a level from
  // the markup would also drop the width that says whether it could come back.
  let listEl = $state<HTMLElement | null>(null);
  let shown = $state<number[] | null>(null);

  // Null until the first measurement, and whenever the trail got deeper or
  // shallower than the one measured — showing the whole trail is the right guess
  // in both cases. Re-rooting at the SAME depth slips through, since the set is
  // still the right shape; the effect below re-measures in the same flush, so
  // the only cost is that the levels shown are one flush behind their widths.
  const depths = $derived(
    shown !== null && shown.at(-1) === trail.length - 1
      ? shown
      : trail.map((_, index) => index),
  );
  const collapsed = $derived(depths.length < trail.length);

  // What the elision marker holds, named rather than left as "more": the levels
  // between the outermost crumb and the first one the row could keep. Without
  // this a screen-reader user hears a control that says nothing about where it
  // leads — the same gap the inert vendored marker left.
  const markerLabel = $derived.by(() => {
    const names = trail.slice(1, depths[1] ?? 1).map((crumb) => crumb.heading.text);
    return names.length > 0 ? `Hidden levels: ${names.join(", ")}` : "Hidden levels";
  });

  // One measurement pass. `.measuring` puts every level back in flow and stops
  // the list shrinking, so what is read is the trail the row would need rather
  // than the one it is showing. Added and removed inside a single task, so the
  // frozen state is never painted.
  //
  // The width the trail is measured against is the BAR's, less the keycap that
  // rides past it — not the list's own, which is exactly as wide as whatever the
  // trail currently shows. The bar takes the control row's middle (`flex: 1` in
  // DiffPlanView), so while the row has free space its width is fixed by the row
  // rather than by its content.
  //
  // Once the row over-fills, the bar shrinks in proportion to its content, so
  // giving up a level DOES widen the room left and can bring one back. That
  // settles rather than oscillating because every step of the loop is monotone:
  // visibleDepths keeps more levels as `avail` grows, the bar's share grows with
  // the levels shown, and a monotone map over a chain of at most six levels
  // reaches a fixed point. Breaking that monotonicity — a level whose measured
  // width shrinks as the row tightens, say — is what would turn this into a
  // resize loop.
  function measure(): void {
    const list = listEl;
    const bar = barEl;
    if (list === null || bar === null) return;
    list.classList.add("measuring");
    const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 0;
    const widths = [...list.querySelectorAll<HTMLElement>(".crumb-item")].map((el) => el.offsetWidth);
    const separator =
      (list.querySelector<HTMLElement>("[data-slot='breadcrumb-separator']")?.offsetWidth ?? 0) +
      gap * 2;
    const marker =
      (list.querySelector<HTMLElement>(".crumb-marker")?.offsetWidth ?? 0) + separator;
    list.classList.remove("measuring");
    const cap = bar.querySelector<HTMLElement>(".crumb-cap");
    const capWidth = cap
      ? cap.offsetWidth + (Number.parseFloat(getComputedStyle(cap).marginInlineStart) || 0)
      : 0;
    shown = visibleDepths(widths, separator, marker, bar.clientWidth - capWidth);
  }

  // The width the row gives the bar, watched rather than polled. Rounded to whole
  // pixels so sub-pixel jitter during a drag-resize cannot re-measure, and read as
  // a dependency by the effect below rather than driving the measurement itself,
  // so a resize and a re-rooted trail both settle in one pass.
  let barWidth = $state(0);

  $effect(() => {
    const bar = barEl;
    if (bar === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? 0);
      if (width !== barWidth) barWidth = width;
    });
    observer.observe(bar);
    return () => observer.disconnect();
  });

  // Re-measure when the levels change or the row resizes. Writing `shown` can
  // feed back in — on an over-full row the bar's width follows its content — but
  // only monotonically, so the loop settles in a step or two rather than running
  // (see the note on measure()).
  $effect(() => {
    void trail;
    void barWidth;
    measure();
  });
</script>

<!-- One level of the heading tree. EVERY heading that encloses others nests them
     through a DropdownMenuSub, not just the one on the reader's own trail
     (EXC-957) — that limiter is what left most of the plan reachable only by
     jumping to a section and reopening the bar. So the menus recurse the whole
     hierarchy, bottoming out at the headings that enclose nothing, and any
     heading in the plan is a walk away from any crumb.
     A heading on the trail carries aria-current wherever it appears, so "you are
     here" reads at every depth and goes quiet once the walk turns off into a
     branch the reader is not in. -->
{#snippet level(nodes: HeadingNode[])}
  {#each nodes as node (node.heading.line)}
    {@const heading = node.heading}
    {@const here = trailLines.has(heading.line) ? "location" : undefined}
    {#if node.children.length > 0}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger
          aria-current={here}
          onkeydown={(e) => onRowKeydown(e, heading.line)}
          onclick={(e) => onRowClick(e, heading.line)}
        >
          <span class="crumb-label" title={heading.text}>{heading.text}</span>
        </DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent
          class="plan-crumb-menu"
          onkeydown={onMenuKeydown}
        >
          {@render level(node.children)}
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
    {:else}
      <DropdownMenu.Item aria-current={here} onSelect={() => onJump(heading.line)}>
        <span class="crumb-label" title={heading.text}>{heading.text}</span>
      </DropdownMenu.Item>
    {/if}
  {/each}
{/snippet}

<!-- The flat filter: one row per matching heading anywhere in the plan, each
     naming the heading that encloses it so two same-named sections stay apart.
     Rows are ordinary menu items, so the j/k walk, Enter-to-jump, and the amber
     "you are here" wash all come from the same machinery the hierarchy uses. -->
{#snippet filter()}
  <Input
    bind:ref={queryEl}
    class="crumb-filter-field"
    type="text"
    placeholder="Filter headings…"
    aria-label="Filter headings"
    bind:value={query}
    onkeydown={onQueryKeydown}
  />
  {#each matches as match (match.heading.line)}
    <DropdownMenu.Item
      aria-current={match.heading.line === activeLine ? "location" : undefined}
      onSelect={() => onJump(match.heading.line)}
    >
      <span class="crumb-label" title={match.heading.text}>{match.heading.text}</span>
      {#if match.parent}
        <span class="crumb-parent" title={match.parent}>{match.parent}</span>
      {/if}
    </DropdownMenu.Item>
  {:else}
    <p class="crumb-filter-empty">No headings match</p>
  {/each}
{/snippet}

<!-- One trigger's menu over `nodes`, shared by every crumb and by the elision
     marker so the filter, the Escape handling, and the hint cap have a single
     definition rather than one per kind of trigger.
     A menu always opens on its hierarchy: the filter is a mode of an open menu,
     never a state the bar carries between openings. Reset on the OPEN edge rather
     than the close one, because a trigger whose menu is open can be unmounted
     outright — the trail re-roots whenever the reader moves — and an unmount
     reports no close. -->
{#snippet menu(nodes: HeadingNode[], trigger: Snippet<[Record<string, unknown>]>)}
  <DropdownMenu.Root
    onOpenChange={(open) => {
      if (open) {
        filtering = false;
        query = "";
      }
    }}
  >
    <DropdownMenu.Trigger>
      {#snippet child({ props })}{@render trigger(props)}{/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content
      align="start"
      class="plan-crumb-menu"
      aria-keyshortcuts="/"
      onkeydown={onMenuKeydown}
      onEscapeKeydown={(e) => {
        // While filtering, Escape is a step back to the hierarchy rather than a
        // dismissal: bits-ui closes only if this event was not defaultPrevented.
        // It fires wherever focus sits — the query field or a result row walked
        // to with j/k.
        if (!filtering) return;
        e.preventDefault();
        void restoreMenu();
      }}
    >
      {#if filtering}
        {@render filter()}
      {:else}
        {@render level(nodes)}
        <!-- The `/` cap teaches the filter the way the bar's `b` cap teaches the
             menu, on the same setting. A plain element, so the menu's roving
             focus never offers it as a row. -->
        {#if showShortcutHints}
          <DropdownMenu.Separator />
          <p class="crumb-menu-hint">
            Filter headings <Kbd class="kbd-sm" aria-hidden="true">/</Kbd>
          </p>
        {/if}
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

<!-- Nothing to place the reader in — a plan with no headings, or one not yet
     scrolled — renders no bar at all. There is deliberately no minimum-heading
     gate beyond that: a one-heading plan still has a location. -->
{#if trail.length > 0}
  <Breadcrumb.Root bind:ref={barEl} class="plan-breadcrumbs" aria-label="Plan location">
    <Breadcrumb.List bind:ref={listEl}>
      {#each trail as crumb, depth (depth)}
        {@const current = depth === trail.length - 1}
        {@const hidden = depths.includes(depth) ? "" : "elided"}
        <!-- The elision marker sits at a fixed place in the list — just past the
             outermost crumb, the one level a collapse never gives up — so the DOM
             order holds whether or not anything is hidden. It opens the outermost
             level it swallowed; everything deeper is a submenu away from there,
             because every heading with children nests its own. -->
        {#if depth === 1}
          <Breadcrumb.Separator class={collapsed ? "" : "elided"} />
          {#snippet markerTrigger(props: Record<string, unknown>)}
            <Breadcrumb.Ellipsis {...props} class="crumb-ellipsis" aria-label={markerLabel} />
          {/snippet}
          <Breadcrumb.Item class={collapsed ? "crumb-marker" : "crumb-marker elided"}>
            {@render menu(trail[1]?.siblings ?? [], markerTrigger)}
          </Breadcrumb.Item>
        {/if}
        {#if depth > 0}
          <Breadcrumb.Separator class={hidden} />
        {/if}
        {#snippet crumbTrigger(props: Record<string, unknown>)}
          <button
            {...props}
            type="button"
            class="crumb"
            class:current
            title={crumb.heading.text}
            aria-current={current ? "location" : undefined}
            aria-keyshortcuts={current ? ariaKeyshortcutsFor("actions.headingNav") : undefined}
          >{#key crumb.heading.line}<span class="crumb-text">{crumb.heading.text}</span>{/key}</button>
        {/snippet}
        <Breadcrumb.Item class="crumb-item {current ? 'current' : ''} {hidden}">
          {@render menu(crumb.siblings, crumbTrigger)}
        </Breadcrumb.Item>
      {/each}
    </Breadcrumb.List>
    <!-- The `b` cap teaches the key, gated on the shortcut-hints setting like the
         compare toggle's `d`. It rides just past the crumb it opens — the trailing
         one — rather than leading the bar, which would read as labelling the whole
         trail. Outside the list, since that list is an <ol> of <li> crumbs, and
         outside the crumb button, whose ellipsis truncation would eat it. -->
    {#if showShortcutHints}
      <Kbd class="kbd-sm crumb-cap" aria-hidden="true">b</Kbd>
    {/if}
  </Breadcrumb.Root>
{/if}

<style>
  /* The bar is chrome, not plan surface, so it wears the UI's sans beside the
     plan's monospace voice (the split EXC-900 drew). It sits in the compare row
     and inherits that row's --ctl-h control height, so the trail lines up with
     the picker beside it.
     The vendored components render outside this component's style scope, so every
     rule here is :global and anchored on .plan-breadcrumbs / .plan-crumb-menu. */
  :global(.plan-breadcrumbs) {
    display: flex;
    align-items: center;
    height: var(--ctl-h);
    font-family: var(--font-sans);
    /* The containing block for the levels the row cannot hold, which go out of
       flow rather than out of the list (see .elided below). Without it they
       resolve against whatever ancestor happens to be positioned. */
    position: relative;
  }

  /* The vendored list wraps by default. In a fixed-height row a second line would
     grow the bar, so the trail stays on one line and its crumbs ellipsise. */
  :global(.plan-breadcrumbs [data-slot="breadcrumb-list"]) {
    flex-wrap: nowrap;
    min-width: 0;
    gap: 0.1rem;
    font-size: var(--text-sm);
  }
  :global(.plan-breadcrumbs [data-slot="breadcrumb-item"]) {
    min-width: 0;
  }
  /* The chevrons and the elision marker are punctuation between crumbs, so they
     sit at the quietest ink in the row and never shrink. */
  :global(.plan-breadcrumbs [data-slot="breadcrumb-separator"]),
  :global(.plan-breadcrumbs .crumb-marker) {
    flex: none;
    color: var(--ink-faint);
  }

  /* A level the row cannot hold. It stays in the list rather than leaving it, so
     the bar can keep measuring the trail it WOULD need while showing the one it
     can fit — dropping it from the markup would drop that width too. Out of flow
     costs the row nothing, and visibility:hidden takes it out of the a11y tree
     and the tab order, which is right: its headings are reached through the
     marker's menu now, not through a crumb nobody can see. */
  :global(.plan-breadcrumbs .elided) {
    position: absolute;
    visibility: hidden;
  }

  /* The measurement pass: every level back in flow, and the LIST itself stops
     shrinking, so it sits at its content width and there is no negative free
     space for the crumbs' shrink weighting below to distribute. What is read is
     therefore the trail the row would need rather than the one it is showing.
     Stopping the list rather than exempting each crumb matters: an exemption
     would tie with the `.current` weighting below at equal specificity and lose
     to it on order, leaving the reader's own crumb — and only that one — measured
     shrunk, in exactly the case the measurement exists for.
     The class is added and removed inside one task, so this state is never
     painted. */
  :global(.plan-breadcrumbs .measuring) {
    flex: none;
  }
  :global(.plan-breadcrumbs .measuring .elided) {
    position: static;
    visibility: visible;
  }
  /* The separator is a list-item, so the vendored icon inside it is placed by
     inline layout and rides the text baseline — which leaves the chevron a couple
     of pixels above the crumbs it punctuates. Centring it as a flex box puts the
     glyph on the row's axis, where the crumb boxes and the elision marker (already
     flex, from the vendored component) sit. */
  :global(.plan-breadcrumbs [data-slot="breadcrumb-separator"]) {
    display: flex;
    align-items: center;
  }
  /* Give the ancestors up before the crumb the reader is actually on. Shrinking
     every crumb equally shreds them all to a single letter as the row tightens,
     losing the one that matters most; weighting the shrink keeps "where you are"
     legible while its ancestors truncate. A weight rather than flex: none, so the
     current crumb still yields when there is genuinely no room. */
  :global(.plan-breadcrumbs .crumb-item) {
    flex-shrink: 8;
  }
  :global(.plan-breadcrumbs .crumb-item.current) {
    flex-shrink: 1;
  }

  /* The trail re-roots continuously as the reader scrolls, and an instant swap at
     that cadence reads as flicker. A crumb that genuinely appears — a new level,
     or the whole bar on first paint — eases in, and its separator travels with it,
     so a deepening trail reads as the trail extending rather than as a jump. A
     crumb that survives a re-root keeps its key and never re-animates, which is
     what keeps the motion quiet while scrolling within one level.
     Reduced motion is not handled here: the single global rule in app.css already
     neutralises this for the whole light-DOM root. */
  @keyframes crumb-in {
    from {
      opacity: 0;
      transform: translateX(-0.25rem);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  :global(.plan-breadcrumbs .crumb-item),
  :global(.plan-breadcrumbs [data-slot="breadcrumb-separator"]) {
    animation: crumb-in var(--dur-base) var(--ease-out);
  }

  /* Walking to a sibling at the same depth keeps the crumb mounted and swaps only
     its text, so the label carries a fade of its own — the change the mount
     animation above can never observe. Opacity alone, and from part-way rather
     than from zero: a transform does not apply to the inline box the crumb's
     ellipsis truncation depends on, and a full fade-from-nothing reads as a blink
     at scroll cadence. */
  @keyframes crumb-text-in {
    from {
      opacity: 0.4;
    }
    to {
      opacity: 1;
    }
  }
  :global(.plan-breadcrumbs .crumb-text) {
    animation: crumb-text-in var(--dur-fast) var(--ease-out);
  }

  /* Each crumb is a menu trigger. It deliberately does NOT wear .float-chip: three
     resting chip fills in a row read as three buttons rather than as one trail, so
     the chip surface is spent only on interaction. The hover and menu-open states
     below are the atom's, reproduced here rather than inherited-and-overridden, so
     the resting look does not depend on out-specifying a shared class.
     The unbroken min-width: 0 chain (list -> item -> button) plus the overflow
     rules are what keep a long heading truncating instead of widening the control
     row, and so what holds the app inside its MIN_APP_WIDTH_PX floor. */
  :global(.plan-breadcrumbs .crumb) {
    display: block;
    max-width: 14rem;
    min-width: 0;
    height: calc(var(--ctl-h) - 0.25rem);
    padding: 0 0.4rem;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--ink-soft);
    font-family: inherit;
    font-size: var(--text-sm);
    /* A button centres its own content vertically, so the label rides the same
       baseline as the picker's chip beside it. Pinning line-height to the box
       height instead fights that centring and lands the baseline half a pixel
       high — enough to read as "not quite sitting right" against the chip. */
    line-height: normal;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  :global(.plan-breadcrumbs .crumb:hover),
  :global(.plan-breadcrumbs .crumb[aria-expanded="true"]) {
    background: var(--chip-hover);
    color: var(--ink);
  }
  /* The elision marker stands in for the crumbs it swallowed, so it reads as one
     rather than earning a treatment of its own: quiet punctuation ink at rest,
     warming to the crumbs' own chip fill under the pointer and while its menu is
     open. Its box comes from the vendored component (a centred 1.25rem square),
     so only the button reset, the radius and the state colours are set here. */
  :global(.plan-breadcrumbs .crumb-ellipsis) {
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: inherit;
    cursor: pointer;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  :global(.plan-breadcrumbs .crumb-ellipsis:hover),
  :global(.plan-breadcrumbs .crumb-ellipsis[aria-expanded="true"]) {
    background: var(--chip-hover);
    color: var(--ink);
  }

  /* The innermost crumb is where the reader is, so it takes full ink while its
     ancestors stay soft. Marked by weight rather than by colour: every crumb is
     already the trail, so an amber wash here would carry no information the
     position does not, and would compete with the amber the menu below spends on
     the same "you are here" job. */
  :global(.plan-breadcrumbs .crumb.current) {
    color: var(--ink);
    font-weight: 600;
  }

  /* The portalled menus keep the catalog's own row treatment; only the width is
     pinned, so a long heading truncates in its row instead of stretching the
     panel to the width of the plan's longest heading. */
  :global(.plan-crumb-menu) {
    max-width: 22rem;
  }
  :global(.plan-crumb-menu .crumb-label) {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  /* The heading the reader is already on, marked with the amber wash the menu
     language reserves for the active choice (shadcn-rules.md § Menu highlight vs.
     selection). Being unlayered, it also out-specifies the catalog's layered
     `data-highlighted` background, so the row the reader is on needs the rule
     below to show any movement under j/k. */
  :global(.plan-crumb-menu [aria-current="location"]) {
    background: var(--accent-wash);
    color: var(--ink);
  }
  /* Walking onto the row the reader is already on: the wash warms toward the same
     --chip-hover every other highlighted row takes, so the amber keeps saying "you
     are here" while the fill still says "the keyboard is on it". The app's global
     focus outline lands here too, but only by cascade — base.css sits outside
     @layer base and so beats the item recipe's `outline-hidden` — and the recipe
     means to suppress it, so the fill is what this leans on. */
  :global(.plan-crumb-menu [aria-current="location"][data-highlighted]) {
    background: color-mix(in lab, var(--accent-wash), var(--chip-hover) 40%);
  }

  /* The field is the shadcn Input molded lightly: surface, border, and focus ring
     stay the recipe's (bridged tokens), so only the pinning and the menu's compact
     voice are set here. */
  :global(.plan-crumb-menu .crumb-filter-field) {
    height: 2rem;
    margin-bottom: 0.25rem;
    font-size: var(--text-sm);
  }

  /* The enclosing heading, trailing its row: what tells two identically titled
     sections apart. It is metadata about the row rather than the row's label, so
     it takes the quietest ink and the smallest size — the same weighting the
     chevrons and the `b` cap have in the bar. Weighted to give width up first,
     the way the bar's ancestors yield ahead of the crumb the reader is on, so a
     long heading truncates its parent rather than itself. */
  :global(.plan-crumb-menu .crumb-parent) {
    flex-shrink: 8;
    margin-inline-start: auto;
    padding-inline-start: 0.6rem;
    min-width: 0;
    max-width: 45%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--ink-faint);
    font-size: var(--text-xs);
  }

  /* A query with no hits says so, in the row's own geometry, rather than
     collapsing the panel to an empty box. */
  :global(.plan-crumb-menu .crumb-filter-empty) {
    margin: 0;
    padding: 0.375rem 0.5rem;
    color: var(--ink-faint);
    font-size: var(--text-xs);
  }

  /* The `/` cap under the hierarchy: the same "here is the key" job the bar's
     `b` cap does, at the same quiet ink, and never mistakable for a row — no
     hover, no pointer, and separated from the list by the menu's own rule. */
  :global(.plan-crumb-menu .crumb-menu-hint) {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    margin: 0;
    padding: 0.25rem 0.5rem 0.125rem;
    color: var(--ink-faint);
    font-size: var(--text-xs);
  }

  /* The `b` cap: punctuation-quiet like the chevrons, and never shrinking — the
     crumbs give up width first (they ellipsise; a 1-character cap cannot). The
     keycap atom draws from currentColor, so the faint ink here is the whole tint. */
  :global(.plan-breadcrumbs .crumb-cap) {
    flex: none;
    margin-inline-start: 0.3rem;
    color: var(--ink-faint);
  }
</style>
