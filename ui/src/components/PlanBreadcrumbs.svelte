<script lang="ts">
  // Heading breadcrumbs bar for the source-view plan surface (EXC-946). Where the
  // contents rail answers "what is in this plan", the bar answers "where am I in
  // it": the ancestor chain enclosing the heading being read, updating as the
  // reviewer scrolls. It reads the same line-anchored heading model the rail does
  // (toc.ts) through headingTrail.ts, and reports a pick as a source line, so a
  // crumb jump lands exactly where a rail jump does.
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
  import { tick, untrack } from "svelte";

  import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { headingMatches, headingTrail } from "$lib/headingTrail.ts";
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

  // j/k walk the open menu, re-dispatched as the arrow keys bits-ui's own roving
  // focus already handles — so a submenu (whose content has its own roving group)
  // walks with the same few lines, and disabled rows, wrapping, and Enter-to-select
  // all stay the primitive's. Handled here, on the content, rather than as a global
  // binding, because the dispatcher suppresses nothing just because a menu owns
  // focus. That is only half of what CommentNavigator does (EXC-792): it ALSO
  // extends the dispatcher's editing-context check in App.svelte, which buys it
  // every key at once. This claims j/k alone, so the rest of the review keys still
  // reach the plan while a crumb menu is open.
  //
  // Only a bare j/k. A command modifier means the reviewer is talking to the
  // browser or the OS (⌘J is Downloads), so those pass straight through — the same
  // line bits-ui's typeahead and the dispatcher's own isBareSpec draw. A shifted
  // J/K never arrives here at all: the key is then uppercase.
  //
  // The one preventDefault does three jobs, and the order each needs is guaranteed
  // by svelte-toolbelt's composeHandlers, which re-checks defaultPrevented before
  // EVERY handler in a merged chain:
  //   1. bits-ui merges this handler ahead of its own, so the letter never reaches
  //      the menu's typeahead and jumps to some row starting with "j".
  //   2. The window dispatcher yields on defaultPrevented, so the plan's own j/k
  //      line cursor stays put behind the open menu.
  //   3. A SubContent is a DOM DESCENDANT of its parent Content (bits-ui portals
  //      neither), so the keydown keeps bubbling into this same handler one level
  //      up. The pre-check is what stops that second pass from dispatching a second
  //      arrow and double-stepping the walk.
  // Arrow keys are untouched and keep working.
  function onMenuKeydown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    // `/` trades the hierarchy for the flat filter, from whatever depth of the
    // menu is open. The preventDefault is load-bearing twice over: it keeps the
    // key out of the menu's typeahead, and the window dispatcher yields on
    // defaultPrevented, so the plan's own `/` search stays shut behind the bar.
    if (e.key === "/") {
      e.preventDefault();
      filtering = true;
      return;
    }
    const arrow = e.key === "j" ? "ArrowDown" : e.key === "k" ? "ArrowUp" : null;
    if (arrow === null) return;
    e.preventDefault();
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: arrow, bubbles: true, cancelable: true }),
    );
  }

  // Whether the open menu is showing the filter rather than the hierarchy, and
  // the live query. One pair for the whole bar: only one menu is ever open, and
  // the results span the plan, so which crumb hosts them carries no meaning.
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

  // The result rows of whichever menu is open. Portalled to the body, so this
  // reaches past the component's own subtree — the same place the tests look.
  function resultRows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(".plan-crumb-menu .crumb-filter-row")];
  }

  // Put the hierarchy back with the menu still open, and land focus on a row so
  // j/k keep working. Awaits the swap: the rows being focused do not exist until
  // the render that `filtering = false` schedules has run.
  async function restoreMenu(): Promise<void> {
    filtering = false;
    query = "";
    await tick();
    document
      .querySelector<HTMLElement>(
        ".plan-crumb-menu [data-slot='dropdown-menu-item'], .plan-crumb-menu [data-slot='dropdown-menu-sub-trigger']",
      )
      ?.focus();
  }

  // The query field's keys. Everything but Escape is stopped here rather than
  // allowed to bubble: bits-ui runs typeahead on any character key inside the
  // menu content and focuses whichever row matches, which would empty the field
  // of focus on the first keystroke. Escape deliberately keeps going, so the
  // content's onEscapeKeydown below is the single place that decides what Escape
  // means on this surface.
  function onQueryKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") return;
    e.stopPropagation();
    if (e.key === "Enter") {
      // The row's own select: it jumps AND closes the menu, so Enter from the
      // field is the four-keystroke path (b, /, query, Enter) without a detour
      // through the list.
      e.preventDefault();
      resultRows()[0]?.click();
    } else if (e.key === "ArrowDown") {
      // Hand off to the menu's roving focus, which is what j/k then walk.
      e.preventDefault();
      resultRows()[0]?.focus();
    }
  }

  // Above this depth the bar elides the middle of the trail, keeping the outermost
  // heading and the innermost two — the reader's immediate parent and where they
  // are. The elided levels stay reachable through the first crumb's nested
  // submenus. This bounds the trail's LENGTH only; a single long heading is held
  // by the per-crumb truncation below.
  const COLLAPSE_ABOVE = 3;

  // The trail depths rendered, ascending. Indices rather than crumbs because the
  // sibling menus recurse by depth, and a collapsed trail must still hand the
  // right depth to `level`.
  const depths = $derived(
    trail.length > COLLAPSE_ABOVE
      ? [0, trail.length - 2, trail.length - 1]
      : trail.map((_, index) => index),
  );
</script>

<!-- One level's sibling headings. The heading that is itself on the trail nests
     the level below through a DropdownMenuSub, so the menus follow the heading
     hierarchy; every other sibling is a plain row that jumps. Recursion bottoms
     out at the innermost crumb, whose own heading has no level below it.
     Either way that heading carries aria-current, so the row the reader is
     already on is marked at every depth. -->
{#snippet level(depth: number)}
  {@const crumb = trail[depth]}
  {#each crumb?.siblings ?? [] as heading (heading.line)}
    {@const here = heading.line === crumb?.heading.line}
    {#if here && depth + 1 < trail.length}
      <DropdownMenu.Sub>
        <DropdownMenu.SubTrigger aria-current="location">
          <span class="crumb-label" title={heading.text}>{heading.text}</span>
        </DropdownMenu.SubTrigger>
        <DropdownMenu.SubContent class="plan-crumb-menu" onkeydown={onMenuKeydown}>
          {@render level(depth + 1)}
        </DropdownMenu.SubContent>
      </DropdownMenu.Sub>
    {:else}
      <DropdownMenu.Item
        aria-current={here ? "location" : undefined}
        onSelect={() => onJump(heading.line)}
      >
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
      class="crumb-filter-row"
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

<!-- Nothing to place the reader in — a plan with no headings, or one not yet
     scrolled — renders no bar at all. There is deliberately no minimum-heading
     gate beyond that: a one-heading plan still has a location. -->
{#if trail.length > 0}
  <Breadcrumb.Root bind:ref={barEl} class="plan-breadcrumbs" aria-label="Plan location">
    <Breadcrumb.List>
      {#each depths as depth, index (depth)}
        {@const crumb = trail[depth]}
        {@const current = depth === trail.length - 1}
        {@const previous = depths[index - 1]}
        {#if index > 0}
          <Breadcrumb.Separator />
          <!-- A gap in the depths is the elided middle of a deep trail. -->
          {#if previous != null && depth - previous > 1}
            <Breadcrumb.Item><Breadcrumb.Ellipsis /></Breadcrumb.Item>
            <Breadcrumb.Separator />
          {/if}
        {/if}
        <Breadcrumb.Item class={current ? "crumb-item current" : "crumb-item"}>
          <!-- A closed menu is always a hierarchical one: the filter is a mode of
               an open menu, never a state the bar carries between openings. -->
          <DropdownMenu.Root
            onOpenChange={(open) => {
              if (!open) {
                filtering = false;
                query = "";
              }
            }}
          >
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <button
                  {...props}
                  type="button"
                  class="crumb"
                  class:current
                  title={crumb?.heading.text}
                  aria-current={current ? "location" : undefined}
                  aria-keyshortcuts={current ? ariaKeyshortcutsFor("actions.headingNav") : undefined}
                >{#key crumb?.heading.line}<span class="crumb-text">{crumb?.heading.text}</span>{/key}</button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content
              align="start"
              class="plan-crumb-menu"
              onkeydown={onMenuKeydown}
              onEscapeKeydown={(e) => {
                // While filtering, Escape is a step back to the hierarchy rather
                // than a dismissal: bits-ui closes only if this event was not
                // defaultPrevented. It fires wherever focus sits — the query
                // field or a result row walked to with j/k.
                if (!filtering) return;
                e.preventDefault();
                void restoreMenu();
              }}
            >
              {#if filtering}
                {@render filter()}
              {:else}
                {@render level(depth)}
                <!-- The `/` cap teaches the filter the way the bar's `b` cap
                     teaches the menu, on the same setting. A plain element, so
                     the menu's roving focus never offers it as a row. -->
                {#if showShortcutHints}
                  <DropdownMenu.Separator />
                  <p class="crumb-menu-hint">
                    Filter headings <Kbd class="kbd-sm" aria-hidden="true">/</Kbd>
                  </p>
                {/if}
              {/if}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
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
     plan's monospace voice — the same split SourceToc makes (EXC-900). It sits in
     the compare row and inherits that row's --ctl-h control height, so the trail
     lines up with the picker beside it.
     The vendored components render outside this component's style scope, so every
     rule here is :global and anchored on .plan-breadcrumbs / .plan-crumb-menu. */
  :global(.plan-breadcrumbs) {
    display: flex;
    align-items: center;
    height: var(--ctl-h);
    font-family: var(--font-sans);
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
  :global(.plan-breadcrumbs [data-slot="breadcrumb-ellipsis"]) {
    flex: none;
    color: var(--ink-faint);
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
  /* The innermost crumb is where the reader is, so it takes full ink while its
     ancestors stay soft. It is marked by weight rather than by the rail's amber
     wash: the rail is a list of destinations where amber picks one out, while
     every crumb here is already the trail, so a second colour would compete with
     the amber the menu below spends on the same "you are here" job. */
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
     selection) — the same signal SourceToc's active row carries. Being unlayered,
     it also out-specifies the catalog's layered `data-highlighted` background, so
     the row the reader is on needs the rule below to show any movement under j/k. */
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

  /* The filter is a MODE of the crumb menu, not a second surface: it keeps the
     panel, its width, its scrolling, and its row treatment, and only swaps what
     is inside. So there is no panel styling here at all — just the field, the
     one thing a row cannot be mistaken for, and the two quiet labels below.
     The field is the shadcn Input molded the way the ToC rail's filter molds it:
     surface, border, and focus ring stay the recipe's (bridged tokens), and only
     the pinning and the menu's compact voice are set. */
  :global(.plan-crumb-menu .crumb-filter-field) {
    height: 2rem;
    margin-bottom: 0.25rem;
    font-size: var(--text-sm);
  }

  /* The enclosing heading, trailing its row: what tells two identically titled
     sections apart. It is metadata about the row rather than the row's label, so
     it takes the quietest ink and the smallest size — the same weighting the
     chevrons and the `b` cap have in the bar. It yields width before the heading
     does, and truncates rather than wrapping the row onto a second line. */
  :global(.plan-crumb-menu .crumb-parent) {
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
