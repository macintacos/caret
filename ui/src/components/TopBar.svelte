<script lang="ts">
  // The top bar: the review's primary chrome. Holds the brand wordmark, the
  // local-build DevBadge, the ReviewSwitcher, the per-plan VersionLabel, the
  // NotifyBell, and the approve / reject / request-changes / settings controls
  // (approve is a SplitButton over the adapter-declared variants). Presentation
  // only — every action is a callback prop resolved by App.svelte, and the
  // approve control's shape is driven by the variant count, not the adapter id.
  import { approveLabel } from "$lib/approve.ts";
  import { ariaKeyshortcutsFor } from "$lib/shortcuts/index.ts";
  import type { ApproveVariant, ApproveVariantId, ClientReview } from "@core/lib/types";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import DevBadge from "@/components/DevBadge.svelte";
  import Icon from "@/components/Icon.svelte";
  import KbdCap from "@/components/KbdCap.svelte";
  import NotifyBell from "@/components/NotifyBell.svelte";
  import ReviewSwitcher from "@/components/ReviewSwitcher.svelte";
  import SplitButton from "@/components/SplitButton.svelte";
  import VersionLabel from "@/components/VersionLabel.svelte";

  interface Props {
    reviews: ClientReview[];
    active: ClientReview | null;
    busy: boolean;
    /** Remembered approve variant id; sets the primary button's id + label. */
    approveMode: ApproveVariantId;
    /** The adapter-declared approve variants to render (labels/order/default). */
    variants: ApproveVariant[];
    /** True when the daemon runs from source; shows the "local build" badge. */
    isDev?: boolean;
    /** The active adapter's id ("claude" | "opencode" | …), the environment the
     * UI adapts to (EXC-791). Exposed as data-source on the topbar so styling or
     * tooling can key off it; the approve control's shape is driven by the
     * variant count, not this. Absent until the health probe lands. */
    source?: string;
    /** How much unsent feedback is queued — the general-comment draft, committed
     * inline comments, and retained-but-unsent composer scratches (App.svelte's
     * shared pendingCount). Surfaced as a count on the Request-changes button so
     * the pending work is visible before they open the dialog; hidden at zero. */
    pendingCount: number;
    /** Ids of plans marked unread — arrivals and revisions that landed while
     * another plan was being read (EXC-411). Handed straight to the switcher,
     * which marks its trigger and the matching dropdown rows. */
    unread: string[];
    onSelect: (id: string) => void;
    onApprove: (mode: ApproveVariantId) => void;
    onRequestChanges: () => void;
    /** Reject the plan: deny with a concise "wait for the user" message and no
     * inline comments (EXC-685). Guarded for pending comments in App.svelte. */
    onReject: () => void;
    /** Open the Settings modal (theme switching). Persistent chrome, like the
     * bell — reachable whether or not a review is active (EXC-730). */
    onOpenSettings: () => void;
    /** Whether the shortcut-hint key-cap hints are shown (EXC-826). When off, the
     * inline a/r caps hide; the shortcuts themselves still fire. */
    showShortcutHints: boolean;
  }
  let {
    reviews,
    active,
    busy,
    approveMode,
    variants,
    isDev = false,
    source,
    pendingCount,
    unread,
    onSelect,
    onApprove,
    onRequestChanges,
    onReject,
    onOpenSettings,
    showShortcutHints,
  }: Props = $props();
</script>

<header class="topbar" data-source={source}>
  <div class="lead">
    <span class="brand" title="caret">
      <span class="brand-caret" aria-hidden="true">^</span>caret
    </span>
    <DevBadge {isDev} />
    <Separator orientation="vertical" style="height: 1.4rem; min-height: 0" />
    {#if active}
      <ReviewSwitcher {reviews} activeId={active.id} {unread} {onSelect} />
      <VersionLabel version={active.version} />
    {/if}
  </div>

  {#if active}
    <div class="actions" class:busy>
      <!-- Same quiet floating-chip as Request changes (soft fill, ink-soft label),
           differentiated only by warming to danger on hover. Reject always routes
           through a confirm dialog, so the resting button stays low-key. -->
      <Button
        variant="secondary"
        class="reject float-chip"
        onclick={onReject}
        disabled={busy}
        aria-keyshortcuts={ariaKeyshortcutsFor("actions.reject")}
      >
        <Icon name="x" size={14} />
        Reject
        {#if showShortcutHints}
          <!-- One combined key: the global shift icon then R, both typed KbdCaps
               (see caps.ts) so the shift glyph is the shared icon, never a ⇧ char.
               KbdCap's `size` is px while the cap's text is em-relative (the base
               [data-slot="kbd"] is 0.8em of this button's 14px), so 9 is not a free
               number — it is ~0.8 of the resulting 11px glyph, seating the arrow at
               the letter's cap height. Retune it if the button's font-size moves. -->
          <Kbd aria-hidden="true"><KbdCap key="shift" size={9} /><KbdCap key="R" /></Kbd>
        {/if}
      </Button>

      <Button
        variant="secondary"
        class="request float-chip"
        onclick={onRequestChanges}
        disabled={busy}
        aria-keyshortcuts={ariaKeyshortcutsFor("actions.requestChanges")}
      >
        <Icon name="corner-up-left" size={14} />
        Request changes
        {#if pendingCount > 0}
          <Badge
            variant="secondary"
            class="count count-attention metric"
            aria-label="{pendingCount} pending comment{pendingCount === 1 ? '' : 's'}"
          >
            {pendingCount}
          </Badge>
        {/if}
        {#if showShortcutHints}<Kbd aria-hidden="true">r</Kbd>{/if}
      </Button>

      <!-- Below --w-narrow the Reject + Request-changes buttons above collapse
           into this "More actions" overflow menu (their inline buttons hide via
           CSS); below --w-tight Approve joins them too, leaving only ⋯ + bell +
           settings on the right. The trigger carries the pending count so it
           stays visible once Request changes is in the menu. Hidden above
           --w-narrow, so the wide layout is unchanged. -->
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="secondary"
              size="icon"
              class="overflow-trigger float-chip"
              aria-label={pendingCount > 0 ? `More actions, ${pendingCount} pending` : "More actions"}
              disabled={busy}
            >
              <Icon name="ellipsis" size={16} />
              {#if pendingCount > 0}
                <!-- Visual only: the trigger's own aria-label carries the count
                     (an element's aria-label replaces its subtree for naming, so
                     a label here would never be announced). -->
                <Badge
                  variant="secondary"
                  class="count count-attention metric overflow-count"
                  aria-hidden="true"
                >
                  {pendingCount}
                </Badge>
              {/if}
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <!-- Approve joins the menu at the tightest widths (the inline Approve
               control below hides ≤ --w-tight); these rows are CSS-hidden above
               that width. The remembered/default variant leads. -->
          {#each variants as v (v.id)}
            <!-- Deferred like Request changes below: the approve confirm is a
                 dismissible dialog (Modal kind="dialog"), so it must open after
                 this menu has closed or the menu's interact-outside dismisses it. -->
            <DropdownMenu.Item class="overflow-approve" onSelect={() => setTimeout(() => onApprove(v.id), 0)}>
              <Icon name="check" size={14} />
              <span class="v-col">
                <span class="v-label">{v.label}</span>
                {#if v.description}<span class="v-note">{v.description}</span>{/if}
              </span>
              <!-- Only the remembered variant carries the `a` cap — it's the row
                   the `a` shortcut (onApprove(approveMode)) actually fires. -->
              {#if v.id === approveMode && showShortcutHints}
                <Kbd class="menu-key" aria-hidden="true">a</Kbd>
              {/if}
            </DropdownMenu.Item>
          {/each}
          <DropdownMenu.Separator class="overflow-approve-sep" />
          <!-- Defer the open past this menu's close: Request changes is a
               dismissible dialog (Modal kind="dialog"), and the closing menu's
               own interact-outside would dismiss a dialog opened on the same
               tick. Reject is an alertdialog (ignores outside-interaction), so it
               fires directly. -->
          <DropdownMenu.Item onSelect={() => setTimeout(onRequestChanges, 0)}>
            <Icon name="corner-up-left" size={14} />
            Request changes
            {#if pendingCount > 0}
              <Badge
                variant="secondary"
                class="count count-attention metric"
                aria-label="{pendingCount} pending comment{pendingCount === 1 ? '' : 's'}"
              >
                {pendingCount}
              </Badge>
            {/if}
            {#if showShortcutHints}<Kbd class="menu-key" aria-hidden="true">r</Kbd>{/if}
          </DropdownMenu.Item>
          <DropdownMenu.Item variant="destructive" onSelect={() => onReject()}>
            <Icon name="x" size={14} />
            Reject
            <!-- Same ⇧R cap as the inline button above, in the menu-row placement
                 Approve and Request changes already use, so all three verdicts carry
                 a cap once they collapse in here. -->
            {#if showShortcutHints}
              <Kbd class="menu-key" aria-hidden="true"
                ><KbdCap key="shift" size={9} /><KbdCap key="R" /></Kbd
              >
            {/if}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <!-- Approve control. With a single variant the approve is binary (e.g. an
           OpenCode session, EXC-791), so there is nothing to choose between: a
           plain amber button, matching the split-button's primary half. With more
           than one variant it is the split-button — the primary approves in the
           remembered mode and the toggle opens the variant menu (mechanics in
           SplitButton.svelte). The menu rows stay here (approve-specific) and
           render into the component's portal, where the scoped .v-* styles still
           reach them because the scope hash rides the elements. Wrapped in a slot
           so the whole control hides ≤ --w-tight, where the approve options move
           into the overflow menu above. -->
      <div class="approve-slot">
        {#if variants.length <= 1}
          <Button
            variant="default"
            class="approve"
            onclick={() => onApprove(approveMode)}
            disabled={busy}
            aria-keyshortcuts={ariaKeyshortcutsFor("actions.approve")}
          >
            <Icon name="check" size={14} />
            {approveLabel(approveMode, variants)}
            {#if showShortcutHints}<Kbd aria-hidden="true">a</Kbd>{/if}
          </Button>
        {:else}
          <SplitButton
            onclick={() => onApprove(approveMode)}
            optionsLabel="Approve options"
            keyshortcuts={ariaKeyshortcutsFor("actions.approve")}
            disabled={busy}
          >
            <Icon name="check" size={14} />
            {approveLabel(approveMode, variants)}
            {#if showShortcutHints}<Kbd aria-hidden="true">a</Kbd>{/if}
            {#snippet menu()}
              {#each variants as v (v.id)}
                <DropdownMenu.Item class="approve-variant" onSelect={() => onApprove(v.id)}>
                  <span class="v-col">
                    <span class="v-label">{v.label}</span>
                    {#if v.description}<span class="v-note">{v.description}</span>{/if}
                  </span>
                </DropdownMenu.Item>
              {/each}
            {/snippet}
          </SplitButton>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Always-visible permission badge + settings, pinned right in both layouts:
       when a review is active `.actions`'s margin-left:auto eats the slack and
       carries this cluster right with it; with no review the slot's own
       margin-left pushes it right. -->
  <div class="bell-slot">
    <NotifyBell />
    <Button
      variant="secondary"
      size="icon"
      class="settings float-chip"
      aria-label="Settings"
      aria-keyshortcuts={ariaKeyshortcutsFor("actions.settings")}
      onclick={onOpenSettings}
    >
      <Icon name="settings" size={16} />
    </Button>
  </div>
</header>

<style>
  /* The header row sits on the raised paper surface with a hairline rule, so it
     stacks seamlessly with the compare bar (VersionComparePicker) directly below
     it — the two read as one layered header system over the source view. */
  .topbar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.7rem var(--bar-inset);
    border-bottom: 1px solid var(--rule);
    background: var(--paper-raised);
    position: relative;
    z-index: 30;
    /* As a grid item of .shell the default min-width:auto lets the topbar expand
       its track to fit content, so the flex row below never feels shrink pressure
       and the title stays at its 46vw cap while the right-hand controls overflow
       off-screen. min-width:0 pins the topbar to the viewport, so the lead
       shrinks and the title truncates instead (the controls are flex-shrink:0). */
    min-width: 0;
  }
  /* Takes the row's free space and yields it first: when the controls need room
     the lead shrinks and the plan title (ReviewSwitcher .title) truncates, rather
     than pushing the right-hand controls off-screen. */
  .lead {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
    flex: 1 1 auto;
  }
  .brand {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: var(--text-xl);
    letter-spacing: -0.01em;
    color: var(--ink);
    white-space: nowrap;
  }
  .brand-caret {
    font-family: var(--font-mono);
    color: var(--accent);
    margin-right: 0.05em;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-left: auto;
    /* Never shrink — the lead truncates first, so the controls stay full-size. */
    flex-shrink: 0;
  }
  /* Buttons carry their own disabled dimming (shadcn disabled:opacity-50); this
     just hardens the whole cluster against clicks while a verdict is in flight. */
  .actions.busy {
    pointer-events: none;
  }
  /* Pins the bell + settings cluster to the right edge. With no review active it
     is the only right-side group, so its own margin-left:auto pushes it right.
     When a review IS active, `.actions` already owns an auto margin — two auto
     margins in one flex row split the free space and strand the bell cluster
     mid-row, so the override below zeroes this one and both groups ride the
     single `.actions` margin to the right edge together. */
  .bell-slot {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
    /* Bell + Settings stay visible at every width — the lead truncates first. */
    flex-shrink: 0;
  }
  .actions + .bell-slot {
    margin-left: 0;
  }

  /* Reject warms to danger on hover — the one place red belongs in the row. */
  .actions :global(.reject:not(:disabled):hover) {
    background: var(--danger);
    color: var(--paper);
  }
  /* The X glyph reads danger-red at rest (the reject affordance); on hover the chip
     fills with danger, so the glyph flips to the paper ink to stay legible on it. */
  .actions :global(.reject .icon) {
    color: var(--danger);
  }
  .actions :global(.reject:not(:disabled):hover .icon) {
    color: inherit;
  }
  /* The ⇧ inside the key cap is an .icon too, and a keycap has no hue of its own —
     it derives from currentColor so both glyphs read as one key (see the hue table
     in doc/agents/svelte-rules.md). Stated as its own positive rule rather than by
     narrowing the two above to a direct child: `>` would silently drop the X's red
     the day a shadcn re-sync wraps Button's children in an element. */
  .actions :global(.reject [data-slot="kbd"] .icon) {
    color: inherit;
  }

  /* Approve-menu variant rows stack a label over its description. Scoped styles
     ride the elements into the portal (the hash travels on the class). */
  .v-col {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .v-label {
    font-weight: 600;
    color: var(--ink);
  }
  .v-note {
    color: var(--ink-faint);
    font-size: var(--text-xs);
  }
  /* The approve options carry the check as a selection cue, not a bullet: reserve
     its slot on every row (visibility, not display, so the label never shifts) and
     reveal it only on the highlighted (hovered/keyboard-focused) row. */
  :global(.overflow-approve .icon) {
    visibility: hidden;
  }
  :global(.overflow-approve[data-highlighted] .icon) {
    visibility: visible;
  }
  /* The shortcut cap on an overflow-menu row is pushed to the row's right edge.
     :global because the rows portal out of scope (like the .overflow-* rules). */
  :global([data-slot="kbd"].menu-key) {
    margin-left: auto;
  }

  /* ----- Narrow-width consolidation (EXC-810) ----- */
  /* Below --w-narrow the Reject + Request-changes buttons collapse into the
     overflow menu; above it the trigger is hidden, so the wide layout is
     unchanged. The px literals mirror lib/layout.ts's NARROW_WIDTH_PX (960) and
     TIGHT_WIDTH_PX (640) minus one — @media can't read the --w-* tokens. */
  /* Fluid collapse (EXC-813): a control appearing across these breakpoints fades +
     scales in (@starting-style gives it its from-state, and this runs once on first
     mount too). The reverse — fading OUT — is deliberately instant: a hiding control
     kept in flow to animate would keep stealing width mid-collapse and transiently
     shove the bell/gear off-screen, defeating the narrow-width collapse. So display
     flips immediately (no allow-discrete) and only the enter animates. background-
     color/color stay in the list so the chip's own hover transition survives this
     override; the global reduced-motion rule in app.css collapses it to one frame. */
  .actions :global(.reject),
  .actions :global(.request),
  .actions :global(.overflow-trigger),
  .approve-slot {
    transition:
      opacity var(--dur-enter) var(--ease-out),
      transform var(--dur-enter) var(--ease-out),
      background-color var(--dur-micro) var(--ease-out),
      color var(--dur-micro) var(--ease-out);
  }
  @starting-style {
    .actions :global(.reject),
    .actions :global(.request),
    .actions :global(.overflow-trigger),
    .approve-slot {
      opacity: 0;
      transform: scale(0.94);
    }
  }
  .actions :global(.overflow-trigger) {
    display: none;
    opacity: 0;
    transform: scale(0.94);
    position: relative;
  }
  @media (max-width: 959px) {
    .actions :global(.reject),
    .actions :global(.request) {
      display: none;
      opacity: 0;
      transform: scale(0.94);
    }
    .actions :global(.overflow-trigger) {
      display: inline-flex;
      opacity: 1;
      transform: none;
    }
  }
  /* Pending count pinned to the trigger's top-right corner, lifted off the
     ellipsis with a paper ring (the NotifyBell dot pattern). The hue is
     --attention, from the shared .count-attention modifier — the count's job is
     to be noticed, and amber stays reserved for the Approve primary. */
  .actions :global(.overflow-count) {
    position: absolute;
    top: -5px;
    right: -6px;
    padding: 0 0.3rem;
    box-shadow: 0 0 0 1.5px var(--paper-raised);
    pointer-events: none;
  }
  /* At/below --w-tight the inline Approve control hides and the approve options
     move into the overflow menu, so the header keeps only ⋯ + bell + settings on
     the right and the plan title truncates to fit. */
  @media (max-width: 639px) {
    .approve-slot {
      display: none;
      opacity: 0;
      transform: scale(0.94);
    }
    /* Collapsed to just ⋯, it's an icon button like the bell + gear beside it, so
       tuck it into their 0.35rem rhythm — the topbar's own 1rem gap would otherwise
       strand ⋯ further from the bell than the bell sits from the gear. */
    .actions + .bell-slot {
      margin-left: calc(0.35rem - 1rem);
    }
  }
  /* The approve rows live in the overflow menu but only belong there ≤ --w-tight;
     above it the inline Approve control shows them, so hide the menu copies.
     :global() because the rows are prop-classed and portalled out of scope. */
  @media (min-width: 640px) {
    :global(.overflow-approve),
    :global(.overflow-approve-sep) {
      display: none;
    }
  }
</style>
