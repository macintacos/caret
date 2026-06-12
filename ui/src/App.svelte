<script lang="ts">
  import { getHealth } from "./lib/api.ts";
  import { approveVariants } from "./lib/approve.ts";
  import { highlightReady } from "./lib/highlightReady.svelte.ts";
  import { createPlanNotifier } from "./lib/notify.ts";
  import { installUiGoneBeacon } from "./lib/presence.ts";
  import { createSafeModeGuard } from "./lib/safeMode.ts";
  import { createScrollSpy } from "./lib/scrollspy.ts";
  import { createAutosave } from "./state/autosave.svelte.ts";
  import {
    createReviewSelection,
    startPolling,
    type SelectionStore,
  } from "./state/polling.svelte.ts";
  import { createRenderMemo } from "./state/render.svelte.ts";
  import { createResolve, type ResolveStore } from "./state/resolve.svelte.ts";
  import type { ResolvedAnnotation } from "./lib/planPaint.ts";
  import type { ApproveVariant, ApproveVariantId, Annotation } from "@core/types";

  import AnnotationGutter from "./components/AnnotationGutter.svelte";
  import DiffPlanView from "./components/DiffPlanView.svelte";
  import EmptyState from "./components/EmptyState.svelte";
  import PlanView from "./components/PlanView.svelte";
  import RequestChangesDialog from "./components/RequestChangesDialog.svelte";
  import Toc from "./components/Toc.svelte";
  import TopBar from "./components/TopBar.svelte";
  import VersionBadge from "./components/VersionBadge.svelte";

  // ----- Reactive backing state -----
  // `daemonChanged`: set when the daemon behind the port is replaced (its
  // per-boot instanceId flips). Persistent until reload or dismiss — the
  // reviews on screen may belong to another daemon, so a transient toast would
  // be too easy to miss.
  let selStore = $state<SelectionStore>({
    reviews: [],
    activeId: null,
    connected: true,
    daemonChanged: false,
  });
  let resStore = $state<ResolveStore>({ approveMode: "default", busy: false });
  // The adapter's declared approve variants, read once from the health probe.
  // Undefined until the probe lands (or for a daemon that predates the field);
  // approveVariants() falls back to the built-in set so the split-button always
  // has options.
  let declaredVariants = $state<ApproveVariant[] | undefined>(undefined);
  // True when the daemon runs from source (EXC-556); read once from the health
  // probe to show the "local build" badge. A daemon predating the field omits
  // it, so this stays false.
  let isDev = $state(false);
  // When on (EXC-583), the plan renders through the @pierre/diffs source-view
  // surface instead of the legacy plan view + contents rail. Build-gated: the
  // daemon resolves it from [dev].diff_surface, which is inert in a prod build,
  // so this stays false there and the legacy surface is byte-identical.
  let diffSurface = $state(false);
  // The running build's version + commit (EXC-561), read once from the same
  // health probe to feed the bottom-left VersionBadge. Undefined until the probe
  // lands (or for a daemon predating the fields); the badge self-gates on
  // `version` and degrades when `commit` is absent.
  let version = $state<string | undefined>(undefined);
  let commit = $state<string | undefined>(undefined);
  let work = $state<{
    annotations: Annotation[];
    generalCommentDraft: string;
    focusedAnnotation: string | null;
  }>({ annotations: [], generalCommentDraft: "", focusedAnnotation: null });

  let resolvedAnnotations = $state<ResolvedAnnotation[]>([]);
  let activeSlug = $state<string | null>(null);
  let showDialog = $state(false);
  let safeMode = $state(false);
  let scrollEl = $state<HTMLElement | undefined>();

  // ----- State modules -----
  const selection = createReviewSelection(selStore);
  const autosave = createAutosave(work, () => selection.activeId, {
    onOffline: () => selection.setConnected(false),
  });
  const resolve = createResolve(resStore, {
    activeId: () => selection.activeId,
    annotations: () => work.annotations,
    planText: () => active?.currentPlan ?? "",
    flushPending: () => autosave.flushPending(),
    afterResolve: (id) => selection.afterResolve(id),
    onOffline: () => selection.setConnected(false),
    clearGeneralComment: () => autosave.clearGeneralComment(),
  });
  // The render memo caches per id:version to skip re-parsing on each 2s poll.
  // The highlighter builds off the critical path (main.ts), so the first render
  // of a plan can land before shiki is ready and produce plain <pre>. Recreating
  // the memo when highlightReady() flips busts that cache once, so the active
  // plan re-renders with syntax highlighting the moment the highlighter arrives.
  let renderMemo = $derived.by(() => {
    void highlightReady();
    return createRenderMemo();
  });

  let active = $derived(selection.active);
  let rendered = $derived(renderMemo.render(active));
  // The variants the split-button renders: the declared set when present, else
  // the built-in fallback.
  let variants = $derived(approveVariants(declaredVariants));

  // ----- Working-copy reload -----
  // When the active review (or its version) changes — whether from a selection
  // or the 2s poll bumping the active review to a new version — reconcile the
  // working copy. `active` is the derived dependency.
  $effect(() => {
    autosave.syncActive(active);
  });

  // ----- Polling -----
  // No reactive reads: runs once on mount, returns the poll's stop fn.
  $effect(() => {
    // An immediate health probe sets the connection flag before the first
    // reviews tick resolves; the poll keeps it current thereafter. The same
    // probe carries the adapter's declared approve variants, captured once for
    // the split-button, and the dev-build flag for the "local build" badge.
    void getHealth()
      .then((h) => {
        selection.setConnected(true);
        declaredVariants = h.approveVariants;
        isDev = h.isDev ?? false;
        diffSurface = h.diffSurface ?? false;
        version = h.version;
        commit = h.commit;
      })
      .catch(() => selection.setConnected(false));

    const notifier = createPlanNotifier({ onSelect: selection.selectReview });
    const stop = startPolling(
      (incoming) => {
        selection.setConnected(true);
        // Fire a desktop notification for genuinely-new reviews while the tab
        // is hidden or unfocused (EXC-427). Observe BEFORE merge: the notifier
        // diffs against its own seen-set, so the new-review signal stays
        // independent of what merge selects.
        notifier.observe(incoming);
        selection.mergeReviews(incoming);
      },
      2000,
      () => selection.setConnected(false),
      () => selection.markDaemonChanged(),
    );
    return stop;
  });

  // ----- Remembered approve mode (read once on load) -----
  // Assigns only (no reactive reads), so this effect runs a single time on
  // mount — deliberately separate from the 2s reviews poll above. A failure
  // leaves today's "default", matching the daemon's fail-safe.
  $effect(() => {
    resolve.loadApproveMode();
  });

  // ----- Safe Mode -----
  // Right after the view opens — or the tab/window regains focus — a keystroke
  // that lands within the grace window is treated as an accidental in-flight
  // keypress (the user was typing elsewhere when caret grabbed focus). While
  // active, all keys are swallowed so no shortcut fires. `arm()` re-opens the
  // grace window on every refocus.
  $effect(() => {
    const guard = createSafeModeGuard({
      target: window,
      onChange: (active) => (safeMode = active),
    });
    const rearm = () => guard.arm();
    const onVisible = () => {
      if (document.visibilityState === "visible") guard.arm();
    };
    window.addEventListener("focus", rearm);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", rearm);
      document.removeEventListener("visibilitychange", onVisible);
      guard.destroy();
    };
  });

  // ----- Tab-close presence retraction (EXC-562) -----
  // Tell the daemon when this tab is closing so it stops counting us as a live
  // client. Without it the daemon leans on the throttled 2s reviews poll, and a
  // backgrounded-but-open tab would still get a redundant new tab on the next
  // plan. Mount-once: reads no reactive state, returns its teardown.
  $effect(() => installUiGoneBeacon({ target: window }));

  // ----- Scrollspy -----
  $effect(() => {
    if (!scrollEl) return;
    // depend on rendered html so spy re-attaches after a re-render
    void rendered.html;
    const headingEls = rendered.headings
      .map((h) => scrollEl!.querySelector<HTMLElement>(`#${CSS.escape(h.blockId)}`))
      .filter((el): el is HTMLElement => el != null);
    return createScrollSpy({
      root: scrollEl,
      headings: headingEls,
      onActive: (slug) => (activeSlug = slug),
    });
  });

  function jumpTo(slug: string) {
    const el = scrollEl?.querySelector<HTMLElement>(`[data-slug="${CSS.escape(slug)}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function onApprove(mode: ApproveVariantId) {
    void resolve.approve(mode);
  }
  function onRequestChanges(generalComment: string) {
    showDialog = false;
    void resolve.requestChanges(generalComment);
  }
</script>

<div class="shell">
  <TopBar
    reviews={selection.reviews}
    {active}
    busy={resolve.busy}
    approveMode={resolve.approveMode}
    {variants}
    {isDev}
    onSelect={selection.selectReview}
    {onApprove}
    onRequestChanges={() => (showDialog = true)}
  />

  {#if selection.daemonChanged}
    <div class="daemon-banner" role="alert">
      <p class="db-text">
        The caret daemon was replaced — reload to resync.
      </p>
      <div class="db-actions">
        <button type="button" class="db-reload" onclick={() => location.reload()}>
          Reload
        </button>
        <button
          type="button"
          class="db-dismiss"
          aria-label="Dismiss"
          onclick={() => selection.dismissDaemonChanged()}
        >
          Dismiss
        </button>
      </div>
    </div>
  {/if}

  {#if active}
    {#if diffSurface}
      <!-- Source-view surface (EXC-583): the plan rendered as line-numbered
           markdown source, with a line gutter for creating comments. The
           contents rail lands on a later milestone. -->
      <DiffPlanView
        review={active}
        annotations={autosave.annotations}
        onCreateLineAnnotation={autosave.createLineAnnotation}
      />
    {:else}
      <!-- Fixed, viewport-pinned contents rail — a sibling of (not inside) the
           grid so it escapes .columns' overflow:hidden and pins to the viewport. -->
      <Toc headings={rendered.headings} {activeSlug} onJump={jumpTo} />

      <div class="columns">
        {#key active.id}
          <PlanView
            html={rendered.html}
            annotations={autosave.annotations}
            activeId={autosave.focusedAnnotation}
            bind:scrollEl
            onResolved={(r) => (resolvedAnnotations = r)}
            onCreate={autosave.createAnnotation}
            onFocusAnnotation={autosave.focusAnnotation}
          />
        {/key}

        <aside class="col col-gutter">
          <AnnotationGutter
            resolved={resolvedAnnotations}
            activeId={autosave.focusedAnnotation}
            onFocus={autosave.focusAnnotation}
            onEdit={autosave.editAnnotation}
            onDelete={autosave.deleteAnnotation}
          />
        </aside>
      </div>
    {/if}
  {:else}
    <EmptyState connected={selection.connected} />
  {/if}
</div>

<!-- Viewport-pinned build badge (EXC-561). A root sibling of .shell, not inside
     the grid, so it's always visible regardless of review state; self-gates on
     `version` until the health probe lands. -->
<VersionBadge {version} {commit} />

{#if showDialog && active}
  <RequestChangesDialog
    annotations={autosave.annotations}
    generalComment={autosave.generalCommentDraft}
    planText={active.currentPlan}
    onGeneralCommentInput={autosave.editGeneralComment}
    onSubmit={onRequestChanges}
    onCancel={() => {
      showDialog = false;
      // Flush now so a draft typed within the last 500ms debounce window is
      // persisted before the component unmounts — survives a page reload, not
      // just an in-session reopen.
      void autosave.flushPending();
    }}
  />
{/if}

{#if safeMode}
  <div class="safe-mode-toast" role="status" aria-live="polite">
    <span class="sm-dot" aria-hidden="true"></span>
    <div class="sm-text">
      <strong>Safe Mode</strong>
      <span>Ignoring input for a moment…</span>
    </div>
  </div>
{/if}

<style>
  /* Pin the shell's three direct children to their grid rows (app.css declares
     `auto auto 1fr`): TopBar, the optional banner, then content. Explicit
     placement keeps content on the 1fr row whether or not the banner is
     present — without it, an absent banner would let content drift off 1fr.
     `:global` because TopBar and the content elements render their own roots. */
  .shell > :global(.topbar) {
    grid-row: 1;
  }
  .shell > :global(.columns),
  .shell > :global(.diff-plan),
  .shell > :global(.empty) {
    grid-row: 3;
  }

  /* Persistent, dismissible banner shown when the daemon behind the port was
     replaced (its instanceId flipped). A sibling of TopBar at the top of the
     shell — it consumes a grid row and pushes the content down rather than
     overlaying it, so it can't be mistaken for a transient toast. Accent left
     rule signals urgency without an icon (icon-rules: an icon must earn its
     place; a one-line message doesn't need one). */
  .daemon-banner {
    grid-row: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.6rem clamp(1rem, 3vw, 2rem);
    background: var(--accent-wash);
    color: var(--ink);
    border-bottom: 1px solid var(--rule-strong);
    border-left: 3px solid var(--accent);
    font-size: 0.82rem;
    animation: daemon-banner-in 160ms ease-out;
  }
  .db-text {
    margin: 0;
    min-width: 0;
    line-height: 1.35;
  }
  .db-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: none;
  }
  .db-reload,
  .db-dismiss {
    font: inherit;
    font-size: 0.78rem;
    cursor: pointer;
    border-radius: var(--radius);
    padding: 0.3rem 0.7rem;
    transition: background 120ms ease;
  }
  .db-reload {
    background: var(--accent);
    color: var(--accent-ink);
    border: 1px solid var(--accent);
    font-weight: 600;
  }
  .db-reload:hover {
    background: var(--accent-bright);
    border-color: var(--accent-bright);
  }
  .db-dismiss {
    background: transparent;
    color: var(--ink-soft);
    border: 1px solid var(--rule-strong);
  }
  .db-dismiss:hover {
    color: var(--ink);
    background: var(--paper-raised);
  }
  @keyframes daemon-banner-in {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .daemon-banner {
      animation: none;
    }
  }

  /* Transient bottom-right indicator shown only while Safe Mode swallows input.
     Sits above the modal scrim (z-index 100) so it's visible over any dialog. */
  .safe-mode-toast {
    position: fixed;
    right: 1.25rem;
    bottom: 1.25rem;
    z-index: 200;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    max-width: 18rem;
    padding: 0.7rem 0.95rem;
    background: var(--paper-raised);
    color: var(--ink);
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    font-size: 0.8rem;
    animation: safe-mode-in 160ms ease-out;
  }
  .sm-dot {
    flex: none;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--accent);
    animation: safe-mode-pulse 1.2s ease-in-out infinite;
  }
  .sm-text {
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }
  .sm-text strong {
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .sm-text span {
    color: var(--ink-soft);
    font-size: 0.72rem;
  }
  @keyframes safe-mode-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes safe-mode-pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 var(--accent-wash);
    }
    50% {
      box-shadow: 0 0 0 4px transparent;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .safe-mode-toast,
    .sm-dot {
      animation: none;
    }
  }
</style>
