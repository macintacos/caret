<script lang="ts">
  import { approveLabel } from "$lib/approve.ts";
  import { shortCwd } from "$lib/cwd.ts";
  import type { ApproveVariant, ApproveVariantId, ClientReview } from "@core/lib/types";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
  import DevBadge from "@/components/DevBadge.svelte";
  import Icon from "@/components/Icon.svelte";
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
    onSelect: (id: string) => void;
    onApprove: (mode: ApproveVariantId) => void;
    onRequestChanges: () => void;
    /** Reject the plan: deny with a concise "wait for the user" message and no
     * inline comments (EXC-685). Guarded for pending comments in App.svelte. */
    onReject: () => void;
    /** Open the Settings modal (theme switching). Persistent chrome, like the
     * bell — reachable whether or not a review is active (EXC-730). */
    onOpenSettings: () => void;
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
    onSelect,
    onApprove,
    onRequestChanges,
    onReject,
    onOpenSettings,
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
      <ReviewSwitcher {reviews} activeId={active.id} {onSelect} />
      <VersionLabel version={active.version} />
    {/if}
  </div>

  {#if active}
    <!-- Full cwd on hover; the row itself shows the abbreviated path. -->
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <!-- The cwd is non-interactive display text; the tooltip is a
                 pointer-hover enhancement over the always-visible abbreviated path.
                 No tabindex — a nonnegative tabindex on a non-interactive element is
                 itself an a11y anti-pattern (svelte a11y_no_noninteractive_tabindex). -->
            <div {...props} class="context mono">{shortCwd(active.cwd)}</div>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content>{active.cwd}</Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>

    <div class="actions" class:busy>
      <!-- Same quiet floating-chip as Request changes (soft fill, ink-soft label),
           differentiated only by warming to danger on hover. Reject always routes
           through a confirm dialog, so the resting button stays low-key. -->
      <Button variant="secondary" class="reject float-chip" onclick={onReject} disabled={busy}>Reject</Button>

      <Button variant="secondary" class="request float-chip" onclick={onRequestChanges} disabled={busy}>
        <Icon name="corner-up-left" size={14} />
        Request changes
        {#if pendingCount > 0}
          <Badge
            variant="secondary"
            class="count metric"
            aria-label="{pendingCount} pending comment{pendingCount === 1 ? '' : 's'}"
          >
            {pendingCount}
          </Badge>
        {/if}
      </Button>

      <!-- Approve control. With a single variant the approve is binary (e.g. an
           OpenCode session, EXC-791), so there is nothing to choose between: a
           plain amber button, matching the split-button's primary half. With more
           than one variant it is the split-button — the primary approves in the
           remembered mode and the toggle opens the variant menu (mechanics in
           SplitButton.svelte). The menu rows stay here (approve-specific) and
           render into the component's portal, where the scoped .v-* styles still
           reach them because the scope hash rides the elements. -->
      {#if variants.length <= 1}
        <Button variant="default" class="approve" onclick={() => onApprove(approveMode)} disabled={busy}>
          <Icon name="check" size={14} />
          {approveLabel(approveMode, variants)}
        </Button>
      {:else}
        <SplitButton onclick={() => onApprove(approveMode)} optionsLabel="Approve options" disabled={busy}>
          <Icon name="check" size={14} />
          {approveLabel(approveMode, variants)}
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
  {/if}

  <!-- Always-visible permission badge + settings, pinned right in both layouts:
       when a review is active `.context` (flex: 1) eats the slack; with no
       review the slot's own margin-left pushes it right. -->
  <div class="bell-slot">
    <NotifyBell />
    <Button variant="secondary" size="icon" class="settings float-chip" aria-label="Settings" onclick={onOpenSettings}>
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
    padding: 0.7rem clamp(1rem, 3vw, 2rem);
    border-bottom: 1px solid var(--rule);
    background: var(--paper-raised);
    position: relative;
    z-index: 30;
  }
  .lead {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
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
  .context {
    flex: 1;
    text-align: center;
    color: var(--ink-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-left: auto;
  }
  /* Buttons carry their own disabled dimming (shadcn disabled:opacity-50); this
     just hardens the whole cluster against clicks while a verdict is in flight. */
  .actions.busy {
    pointer-events: none;
  }
  /* Pins the bell + settings cluster to the right edge when no review is active
     (`.context`'s flex:1 handles the active layout; here auto resolves to 0). */
  .bell-slot {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    margin-left: auto;
  }

  /* Reject warms to danger on hover — the one place red belongs in the row. */
  .actions :global(.reject:not(:disabled):hover) {
    background: var(--danger);
    color: var(--paper);
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
</style>
