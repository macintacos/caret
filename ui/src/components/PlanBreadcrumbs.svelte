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
  // when you already know the destination. Escape swaps the hierarchy back
  // rather than closing, so the two views are one surface from the bar's side.
  //
  // EXC-1098: that filter is `command` in a `popover` rather than a mode of the
  // menu, and the reason is accessibility rather than layout. bits-ui puts
  // role="menu" on dropdown content, a textbox is not among the roles `menu`
  // admits as children, and the role cannot be overridden from the call site — so
  // a filter field hosted inside the menu gives a screen reader the field's label
  // and then silence as its rows narrow. Here the field is a real combobox whose
  // `aria-activedescendant` names the row the selection is on, over a listbox of
  // real options. Both attributes are bits-ui's, derived from the command's
  // viewport node, which exists only because the vendored command-list.svelte
  // renders a `Command.Viewport`; read the comment there before touching it. The
  // ToC popup (PlanToc.svelte) is built on the same two primitives, so the plan's
  // two heading surfaces narrate identically.
  //
  // Where they diverge is deliberate and stays: this filter names each match's
  // enclosing heading ON the row, one row per match, where the ToC popup gathers
  // matches under a shared breadcrumb header carrying the whole ancestor path.
  // This bar has one row's width to spend, which a path does not fit in.
  // Drilling down is what the crumb menus are for; the filter is for when the
  // destination is already known.
  import { type Snippet, untrack } from "svelte";

  import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
  import * as Command from "$lib/components/ui/command/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
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
  // treats as a keyboard-ish activation, so the whole invocation is the click.
  // bits-ui then usually moves focus onto the first row itself, since the real `b`
  // keypress left its `isUsingKeyboard` true — but that flag also clears on
  // pointermove, so a mouse twitch mid-open can leave focus on the content instead.
  // Either way j/k below enter the list from the top.
  // Keyed on aria-current rather than the .current class: same element, but a
  // contract the menu depends on instead of a style hook a CSS pass could rename.
  //
  // The key is a toggle for the BAR, not for one crumb: whichever trigger is open
  // is the one it shuts, because `h` walks the open menu outward onto an ancestor
  // crumb (openPreviousCrumb below) and shutting only the trailing crumb would
  // leave that one standing. Nothing else closes it either — a programmatic click
  // dispatches no pointerdown, so the open menu's own dismiss-on-outside never
  // fires and the bar ends up showing two panels at once.
  function openTrail(): void {
    const open = barEl?.querySelector<HTMLButtonElement>('[aria-expanded="true"]') ?? null;
    if (open !== null) {
      open.click();
      return;
    }
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
  // primitive's. Tab and Shift+Tab join them on the same two arrows (EXC-1121), so
  // they walk whichever level is already open and cross no submenu boundary in
  // either direction: Tab was never one of bits-ui's SUB_OPEN_KEYS or
  // SUB_CLOSE_KEYS, so the arrow it becomes is the only thing it can do here.
  // Handled here, on the content, rather than as a global
  // binding, because the dispatcher suppresses nothing just because a menu owns
  // focus. That is only half of what CommentNavigator does (EXC-792): it ALSO
  // extends the dispatcher's editing-context check in App.svelte, which buys it
  // every key at once. This claims five keys, so the rest of the review keys still
  // reach the plan while a crumb menu is open.
  //
  // Only bare keys. A command modifier means the reviewer is talking to the
  // browser or the OS (⌘J is Downloads), so those pass straight through — the same
  // line bits-ui's typeahead and the dispatcher's own isBareSpec draw. Shift is not
  // one of them, because it is how Tab carries its direction; a shifted J/K never
  // arrives here at all, since the key is then uppercase.
  //
  // The one preventDefault does two jobs, and the order each needs is guaranteed
  // by svelte-toolbelt's composeHandlers, which re-checks defaultPrevented before
  // EVERY handler in a merged chain:
  //   1. bits-ui merges this handler ahead of its own, so the letter never reaches
  //      the menu's typeahead and jumps to some row starting with "j" — and Tab
  //      never reaches the primitive's own Tab, which closes the whole menu and
  //      moves focus to the first tabbable past the root trigger.
  //   2. The window dispatcher yields on defaultPrevented, so the plan's own j/k
  //      line cursor stays put behind the open menu.
  // The re-dispatch below cannot loop: it carries an ARROW, which is neither Tab
  // nor in the map, so the second pass returns at the lookup rather than
  // dispatching a third. (Before EXC-957 portalled the SubContent, a submenu's
  // keydown also bubbled into the parent Content's copy of this handler, and
  // defaultPrevented was what stopped that. It no longer reaches there; both still
  // carry the handler, which is why the walk works at every depth either way.)
  // Job 2 is vacuous for h, l and Tab — none of them is bound in keymap.ts — but
  // they take the same path as j/k rather than a second, quieter one, so a later
  // binding on any of them cannot reach the plan from behind an open menu.
  // Arrow keys are untouched and keep working.
  function onMenuKeydown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // `/` trades the hierarchy for the flat filter, from whatever depth of the
    // menu is open. This handler hangs off menu content, so it cannot fire once
    // the swap has happened — a `/` inside the field is typed into the query.
    // The preventDefault is load-bearing twice over: it keeps the key out of the
    // menu's typeahead, and the window dispatcher yields on defaultPrevented, so
    // the plan's own `/` search stays shut behind the bar.
    if (e.key === "/") {
      e.preventDefault();
      // The trigger whose menu is open, remembered before it is shut so Escape
      // can put that same hierarchy back — and used as the filter panel's anchor,
      // so the panel appears where the menu was.
      filterOrigin = barEl?.querySelector<HTMLButtonElement>('[aria-expanded="true"]') ?? null;
      // Every opening starts on the whole plan. Reset on the OPEN edge rather
      // than any close, for the reason the menu snippet gives about its own
      // reset: a panel can be unmounted outright when the trail re-roots, and an
      // unmount reports no close for a close-edge reset to hang off.
      query = "";
      // The menu's close must not drag focus back to the crumb: the filter is
      // about to take it. Same suppression a pick uses, for the same reason.
      leaving = true;
      filterOrigin?.click();
      filtering = true;
      return;
    }
    // Tab sits beside the map rather than in it: the map is keyed on a bare
    // character, and Tab's direction rides the shift modifier instead.
    const arrow = e.key === "Tab" ? (e.shiftKey ? "ArrowUp" : "ArrowDown") : MENU_ARROWS[e.key];
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

  // Whether the menu is closing on something that must NOT hand focus back to the
  // crumb (onCloseAutoFocus below). Two occasions: a pick, which hands the
  // reviewer to the plan and would otherwise leave the crumb ringed over a plan
  // they have already moved on to, and the `/` swap, where the filter panel is
  // taking focus next. Escape is deliberately untouched: dismissing a menu leaves
  // the reviewer in the bar, where the crumb is exactly where focus belongs.
  let leaving = false;

  // Take the reviewer to a heading from a MENU row. Landing focus on the body
  // costs nothing here — the plan's own keys are window-level, and `b` summons the
  // bar back — which is the same trade the search HUD makes when Enter commits a
  // query and blurs. A filter row has its own select (`pick` below): it dismisses
  // a different panel, and one whose close never consults `leaving`.
  function goTo(line: number): void {
    leaving = true;
    onJump(line);
  }

  // Take the reviewer to a heading from a FILTER row. A menu row closes its own
  // menu on select; a command row does not close its host, so the pick shuts the
  // panel itself.
  function pick(line: number): void {
    closeFilter();
    onJump(line);
  }

  // Take the reviewer to a heading and leave the bar. A plain row's select closes
  // the menu on its own; a row that nests a submenu has no select to close it, so
  // the open trigger is toggled shut with the same programmatic click openTrail
  // uses to open one. Scoped to the bar, so the match is a crumb's trigger or the
  // elision marker's — the two things here that open a menu — and never a
  // sub-trigger, which lives in bits-ui's portalled content outside this element.
  function jump(line: number): void {
    barEl?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.click();
    goTo(line);
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

  // Whether the filter panel is open, and the live query. One set for the whole
  // bar: the results span the plan, so which crumb hosts them carries no meaning
  // — which is also why there is ONE panel rather than one per crumb.
  let filtering = $state(false);
  let query = $state("");
  let queryEl = $state<HTMLInputElement | null>(null);

  // The trigger the filter was summoned from: the panel's anchor while it is
  // open, and the menu Escape puts back. `$state` because the anchor is read
  // reactively by the popover.
  let filterOrigin = $state<HTMLButtonElement | null>(null);

  // What the panel hangs off. The plan scrolls under an open panel — the popover
  // locks no scroll — so the trail can re-root and take the remembered trigger
  // out of the document with it. A detached node is still truthy, and floating-ui
  // would measure it as a zero-sized box in the viewport corner, so the fallback
  // has to be reached through `isConnected` rather than through `??`.
  const filterAnchor = $derived(
    filterOrigin?.isConnected === true ? filterOrigin : barEl,
  );

  const matches = $derived(headingMatches(headings, query));

  // What the status line says, empty when there are rows. Derived rather than
  // inlined in the markup because the element it feeds is always mounted — see
  // the comment on it for why a live region cannot be conjured up with its text
  // already inside it.
  const emptyMessage = $derived(matches.length > 0 ? "" : "No headings match");

  // Put the hierarchy back with the bar still open: shut the panel, then re-open
  // the menu the filter was summoned from, with the same programmatic click `b`
  // uses (see openTrail for what detail: 0 buys and where focus lands).
  //
  // The remembered trigger can have been unmounted while the panel was open: the
  // trail re-roots whenever the reader scrolls. The crumb the reader is on now is
  // the right fallback, since that is where `b` would have opened anyway.
  function restoreMenu(): void {
    const origin = filterOrigin?.isConnected === true ? filterOrigin : null;
    closeFilter();
    (origin ?? barEl?.querySelector<HTMLButtonElement>('.crumb[aria-current="location"]'))?.click();
  }

  // Shut the filter panel and forget what it was anchored to. The query goes with
  // it: a menu always reopens on its hierarchy, so a query that survived would only
  // reappear on the next `/` over a plan that has since scrolled.
  function closeFilter(): void {
    filtering = false;
    query = "";
    filterOrigin = null;
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
      <DropdownMenu.Item aria-current={here} onSelect={() => goTo(heading.line)}>
        <span class="crumb-label" title={heading.text}>{heading.text}</span>
      </DropdownMenu.Item>
    {/if}
  {/each}
{/snippet}

<!-- One trigger's menu over `nodes`, shared by every crumb and by the elision
     marker so the `/` claim and the hint cap have a single definition rather than
     one per kind of trigger.
     A menu always opens on its hierarchy: the filter is a panel the bar summons,
     never a state a menu carries between openings. Shut on the OPEN edge rather
     than on the panel's own close, because a panel whose trigger is unmounted —
     the trail re-roots whenever the reader moves — reports no close to hang a
     reset off. -->
{#snippet menu(nodes: HeadingNode[], trigger: Snippet<[Record<string, unknown>]>)}
  <DropdownMenu.Root
    onOpenChange={(open) => {
      if (open) filtering = false;
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
      onCloseAutoFocus={(e) => {
        // Only a pick or the `/` swap suppresses the return. Every other close —
        // Escape, a click outside, Tab — hands focus back to the trigger as the
        // primitive intends, so a dismissal never strands the reviewer's next key.
        if (!leaving) return;
        leaving = false;
        e.preventDefault();
      }}
    >
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

  <!-- The flat filter: one row per matching heading anywhere in the plan, each
       naming the heading that encloses it so two same-named sections stay apart.
       It is a `command` in a `popover` rather than a mode of the open menu, which
       is what makes the field a combobox and the rows real options (see header).
       There is no Popover.Trigger: the bar has no control that means "filter" —
       `/` inside an open menu is the whole invocation — so a trigger would be a
       phantom in the tab order and the accessibility tree. `customAnchor` gives
       the panel its position instead, on the very trigger the menu it replaces
       hung from.
       It does not trap focus, which the vendored Popover.Content otherwise does.
       Nothing here needs one: the panel holds exactly one tabbable, and since
       EXC-1121 the command below claims Tab outright, so focus never reaches the
       browser's own default and never leaves the field. -->
  <Popover.Root bind:open={filtering}>
    <Popover.Content
      class="plan-crumb-filter"
      align="start"
      customAnchor={filterAnchor}
      trapFocus={false}
      onOpenAutoFocus={(e) => {
        // The reviewer pressed `/` to type, so focus goes to the field rather
        // than to the panel bits-ui would otherwise focus. Suppressed only once
        // there is a field to hand it to: preventing the default with nothing to
        // receive it strands focus on the body, which loses Escape-to-close AND
        // drops the shortcut dispatcher's editing-context guard, so every bare
        // plan key would fire behind the open panel.
        if (queryEl === null) return;
        e.preventDefault();
        queryEl.focus();
      }}
      onCloseAutoFocus={(e) => {
        // Suppressed unconditionally, unlike the menu's: this popover has no
        // trigger of its own, so there is nothing for bits-ui to hand focus back
        // to and the default is a no-op at best and a race at worst. Every close
        // already places focus itself — a pick leaves the reviewer in the plan,
        // Escape re-opens the menu onto a row, and an outside click lands where
        // the reviewer put it.
        e.preventDefault();
      }}
      onEscapeKeydown={(e) => {
        // Escape steps back to the hierarchy rather than dismissing the bar, the
        // meaning it has had here since EXC-948. bits-ui closes only if this
        // event was not defaultPrevented, so the swap is ours to perform.
        e.preventDefault();
        restoreMenu();
      }}
    >
      <!-- shouldFilter={false} is load-bearing. The command scores each row's
           `value` against the query and hides everything that scores 0 — and a
           row's value here is its SOURCE LINE, which no heading query ever
           matches, so leaving the engine on would empty the panel on the first
           keystroke. Filtering is headingMatches' job; the command's job here is
           the listbox semantics and the roving selection. The same one prop the
           ToC popup sets, for its own version of the same reason. -->
      <!-- `loop` is the other prop this surface has to set, and for the opposite
           reason: the command defaults it OFF where menu content defaults it on
           (bits-ui command.svelte vs. menu-content.svelte), so without it the bar's
           two views would stop at opposite ends of their lists. It wraps EVERY one
           of the command's navigation keys, not only the Tab below — the arrows go
           with it, which is the point: Tab wrapping while the arrows stopped in the
           same list would read as a bug. -->
      <Command.Root
        shouldFilter={false}
        loop
        onkeydown={(e) => {
          // Tab walks the results instead of leaving them (EXC-1121), the same claim
          // the hierarchy menus make on the same key. The primitive maps the arrows
          // and the vim chords and ignores Tab, so untouched it fell through to the
          // browser — and with nothing tabbable after a panel portalled to the body,
          // that stepped off the end of the document.
          //
          // Re-dispatching an arrow rather than writing the selection is the
          // load-bearing choice. bits-ui scrolls a selection into view from its OWN
          // keydown path, so a hand-rolled walk would step the reviewer onto rows
          // below the fold without ever bringing them into sight. `#next`/`#prev` are
          // private, so the handler is the only door in. Dispatched from the field
          // because that is where the keypress really landed, and the primitive
          // listens for it on the root the event bubbles to. Same shape, same reason,
          // as PlanToc.svelte's own Tab walk.
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
        <!-- Named apart from the ToC popup's "Plan headings": both surfaces
             publish a listbox of headings, and an unscoped role query would
             otherwise collect either one. -->
        <Command.List aria-label="Matching headings">
          {#each matches as match (match.heading.line)}
            <Command.Item
              value={String(match.heading.line)}
              aria-current={match.heading.line === activeLine ? "location" : undefined}
              onSelect={() => pick(match.heading.line)}
            >
              <span class="crumb-label" title={match.heading.text}>{match.heading.text}</span>
              {#if match.parent}
                <span class="crumb-parent" title={match.parent}>{match.parent}</span>
              {/if}
            </Command.Item>
          {/each}
        </Command.List>
        <!-- Deliberately a SIBLING of the list rather than a row inside it: a
             listbox may own options and groups, not loose text.
             `role="status"` because this is the one narrowing a screen reader
             would otherwise miss: a keystroke that changes the first match moves
             the selection and the field's aria-activedescendant announces the new
             row, but a query matching nothing leaves no active row to name.
             Mounted unconditionally, with only its TEXT switched — a live region
             has to be idle in the DOM before the change it announces, and one
             inserted with its content already in it is skipped by some AT
             outright. Same shape and same reason as FilePreview.svelte's
             `.fp-range` and PlanToc.svelte's `.toc-empty`. -->
        <p class="crumb-filter-empty" role="status">{emptyMessage}</p>
      </Command.Root>
    </Popover.Content>
  </Popover.Root>
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
    animation: crumb-in var(--dur-enter) var(--ease-out);
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
    animation: crumb-text-in var(--dur-micro) var(--ease-out);
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
      background var(--dur-micro) var(--ease-out),
      color var(--dur-micro) var(--ease-out);
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
      background var(--dur-micro) var(--ease-out),
      color var(--dur-micro) var(--ease-out);
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

  /* The filter panel is pinned at the width the menus cap out at, so the two
     views of one surface stay in the same neighbourhood as `/` swaps between them
     — a fixed width rather than a cap, because a query that narrows to one short
     heading would otherwise collapse the panel around it while the reviewer is
     still typing. The vendored Popover.Content ships padding and a gap of its own
     and the Command inside already pads itself, so the padding is handed over
     rather than doubled — the same handover .plan-toc-panel makes, which is what
     keeps the plan's two heading panels reading as one thing. */
  :global(.plan-crumb-filter) {
    width: 22rem;
    padding: 0;
    gap: 0;
  }

  :global(.plan-crumb-menu .crumb-label),
  :global(.plan-crumb-filter .crumb-label) {
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

  /* The same pair for the filter's rows. The command marks the row its roving
     selection is on `data-selected` where the menu marks a focused row
     `data-highlighted`; the treatment is identical, so the mark reads the same
     whichever view of the surface the reviewer is in. */
  :global(.plan-crumb-filter [aria-current="location"]) {
    background: var(--accent-wash);
    color: var(--ink);
  }
  :global(.plan-crumb-filter [aria-current="location"][data-selected]) {
    background: color-mix(in lab, var(--accent-wash), var(--chip-hover) 40%);
  }

  /* The enclosing heading, trailing its row: what tells two identically titled
     sections apart. It is metadata about the row rather than the row's label, so
     it takes the quietest ink and the smallest size — the same weighting the
     chevrons and the `b` cap have in the bar. Weighted to give width up first,
     the way the bar's ancestors yield ahead of the crumb the reader is on, so a
     long heading truncates its parent rather than itself. */
  :global(.plan-crumb-filter .crumb-parent) {
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
     collapsing the panel to an empty box. The box is always in the markup so the
     live region is idle before it speaks, so the padding is what it wears only
     when it has something to say: with no text and no padding it generates no
     line box and the panel closes up as if the element were conditional. */
  :global(.plan-crumb-filter .crumb-filter-empty) {
    margin: 0;
    padding: 0;
    color: var(--ink-faint);
    font-size: var(--text-xs);
  }
  :global(.plan-crumb-filter .crumb-filter-empty:not(:empty)) {
    padding: 0.375rem 0.5rem;
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
