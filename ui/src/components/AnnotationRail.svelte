<script lang="ts">
  import AnnotationGutter from "./AnnotationGutter.svelte";
  import type { ResolvedAnnotation } from "./PlanView.svelte";
  import Rail from "./Rail.svelte";

  // The right-edge annotation rail: a slim dock that hover/focus/tap/pin-expands
  // the existing AnnotationGutter. Reuses the shared Rail primitive (right side,
  // full-height) and adds what the TOC rail lacks: a count/density gauge, a
  // persistent detached-count signal, and a pin that keeps the panel open.
  interface Props {
    resolved: ResolvedAnnotation[];
    activeId: string | null;
    onFocus: (id: string) => void;
    onEdit: (id: string, comment: string) => void;
    onDelete: (id: string) => void;
  }
  let { resolved, activeId, onFocus, onEdit, onDelete }: Props = $props();

  // Pin keeps the panel open through a hover-leave; tap-open is the touch/click
  // path. Either forces the Rail panel open.
  let pinned = $state(false);
  let tapOpen = $state(false);

  let count = $derived(resolved.length);
  let detached = $derived(resolved.filter((r) => r.orphaned).length);
  // No annotations → no rail (today's empty state).
  let visible = $derived(count > 0);
</script>

{#if visible}
  <div class="anno-rail">
    <Rail
      side="right"
      placement="fill"
      label="Annotations"
      touch="tap"
      forceOpen={pinned || tapOpen}
    >
      {#snippet strip()}
        <div class="dock">
          <button
            class="pin"
            class:pinned
            aria-pressed={pinned}
            aria-label={pinned
              ? "Unpin annotations panel"
              : "Pin annotations panel open"}
            title={pinned ? "Unpin" : "Pin open"}
            onclick={() => (pinned = !pinned)}
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8 1.5c-2.49 0-4.5 2.01-4.5 4.5 0 3.2 4.5 8.5 4.5 8.5s4.5-5.3 4.5-8.5c0-2.49-2.01-4.5-4.5-4.5zm0 6.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z"
              />
            </svg>
          </button>

          <button
            class="gauge"
            aria-label="{count} annotation{count === 1 ? '' : 's'}{detached > 0
              ? `, ${detached} detached`
              : ''}"
            aria-expanded={pinned || tapOpen}
            onclick={() => (tapOpen = !tapOpen)}
          >
            <!-- Visual only; the button's aria-label already names the count and
                 detached total, so the SR doesn't read the digits twice. -->
            <span class="caret" aria-hidden="true">^</span>
            <span class="count" aria-hidden="true">{count}</span>
            {#if detached > 0}
              <span
                class="detached"
                aria-hidden="true"
                title="{detached} detached comment{detached === 1 ? '' : 's'}"
              >
                {detached}⚠
              </span>
            {/if}
          </button>
        </div>
      {/snippet}

      {#snippet panel()}
        <AnnotationGutter {resolved} {activeId} {onFocus} {onEdit} {onDelete} />
      {/snippet}
    </Rail>
  </div>
{/if}

<style>
  /* Sets the panel width + the top offset (below the TopBar) the Rail reads.
     display:contents keeps the wrapper out of the app grid; the variables still
     inherit down to the fixed Rail nav. */
  .anno-rail {
    display: contents;
    --rail-panel-w: 22rem;
    --rail-top: var(--topbar-h, 3.25rem);
  }

  /* The dock sits at the top of the full-height rail, its chips flush to the
     viewport edge so the pin's screen position never shifts as the panel
     animates in/out. */
  .dock {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.5rem;
    padding: 0.75rem 0;
  }

  .pin {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.65rem;
    height: 1.65rem;
    border-radius: 99px;
    border: 1px solid var(--rule);
    background: var(--paper-raised);
    color: var(--ink-faint);
    box-shadow: var(--shadow-card);
    transition:
      color 0.15s,
      background-color 0.15s,
      border-color 0.15s;
  }
  .pin:hover {
    color: var(--accent);
    border-color: var(--rule-strong);
  }
  .pin.pinned {
    color: var(--accent-ink);
    background: var(--accent);
    border-color: var(--accent);
  }

  .gauge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
    min-width: 1.75rem;
    padding: 0.4rem 0.35rem;
    border-radius: 99px;
    border: 1px solid var(--rule);
    background: var(--paper-raised);
    box-shadow: var(--shadow-card);
    transition: border-color 0.15s;
  }
  .gauge:hover {
    border-color: var(--rule-strong);
  }
  .gauge .caret {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    line-height: 1;
    color: var(--accent);
  }
  .gauge .count {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 0.92rem;
    line-height: 1;
    color: var(--ink);
  }
  .gauge .detached {
    margin-top: 0.15rem;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.02em;
    color: var(--ink-soft);
    background: var(--mark-orphan);
    border-radius: 99px;
    padding: 0.05rem 0.28rem;
  }
</style>
