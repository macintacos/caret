<script lang="ts">
  import {
    getApproveMode,
    getHealth,
    HttpError,
    putAnnotations,
    resolveReview,
    startPolling,
  } from "./lib/api.ts";
  import { formatFeedback } from "./lib/feedback.ts";
  import { renderPlan, type HeadingEntry } from "./lib/render.ts";
  import { createSafeModeGuard } from "./lib/safeMode.ts";
  import { createScrollSpy } from "./lib/scrollspy.ts";
  import type { AcceptMode, Annotation, ClientReview } from "./lib/types.ts";

  import AnnotationGutter from "./components/AnnotationGutter.svelte";
  import EmptyState from "./components/EmptyState.svelte";
  import PlanView, {
    type ResolvedAnnotation,
  } from "./components/PlanView.svelte";
  import RequestChangesDialog from "./components/RequestChangesDialog.svelte";
  import Toc from "./components/Toc.svelte";
  import TopBar from "./components/TopBar.svelte";

  // ----- State -----
  let reviews = $state<ClientReview[]>([]);
  let activeId = $state<string | null>(null);
  let connected = $state(true);
  let busy = $state(false);
  let showDialog = $state(false);
  let safeMode = $state(false);

  // Remembered approve mode (machine-global, last-wins). Read once on load and
  // mirrored locally on each approve so the next plan defaults to it.
  let approveMode = $state<AcceptMode>("default");

  // Working copy of annotations for the active review (edited locally, autosaved).
  let annotations = $state<Annotation[]>([]);
  let resolved = $state<ResolvedAnnotation[]>([]);
  let focusedAnnotation = $state<string | null>(null);
  let activeSlug = $state<string | null>(null);

  let scrollEl = $state<HTMLElement | undefined>();
  // Keyed on id:version so a new version (revision) also reloads the working
  // copy — never persist stale annotations from a prior version onto the next.
  let lastLoadedKey: string | null = null;

  let active = $derived(reviews.find((r) => r.id === activeId) ?? null);

  // Memoize the (expensive) markdown render on id+version so the 2s poll —
  // which replaces `reviews` with fresh objects every tick — doesn't re-parse
  // an unchanged plan (and needlessly churn the highlight repaint).
  let renderCache: {
    key: string;
    value: { html: string; headings: HeadingEntry[] };
  } | null = null;
  let rendered = $derived.by(() => {
    if (!active) return { html: "", headings: [] as HeadingEntry[] };
    const key = `${active.id}:${active.version}`;
    if (renderCache?.key === key) return renderCache.value;
    const value = renderPlan(active.currentPlan);
    renderCache = { key, value };
    return value;
  });

  // ----- Deep link -----
  function deepLinkId(): string | null {
    return new URLSearchParams(location.search).get("review");
  }
  function setUrl(id: string | null) {
    const url = new URL(location.href);
    if (id) url.searchParams.set("review", id);
    else url.searchParams.delete("review");
    history.replaceState(null, "", url);
  }

  // ----- Selecting / loading a review -----
  function selectReview(id: string | null) {
    activeId = id;
    setUrl(id);
  }

  // When the active review (or its version) changes, load its annotations into
  // the working copy.
  $effect(() => {
    const key = active ? `${active.id}:${active.version}` : null;
    if (active && key !== lastLoadedKey) {
      // Flush the PREVIOUS review's pending save FIRST (it snapshots the current
      // `annotations` + pendingSaveId synchronously) — before we overwrite
      // `annotations` with the new review's, or we'd save them onto the old id.
      void flushPending();
      lastLoadedKey = key;
      annotations = active.annotations.map((a) => ({ ...a }));
      focusedAnnotation = null;
    } else if (!active) {
      void flushPending();
      lastLoadedKey = null;
      annotations = [];
    }
  });

  // ----- Polling -----
  $effect(() => {
    void getHealth()
      .then(() => (connected = true))
      .catch(() => (connected = false));

    const stop = startPolling(
      (incoming) => {
        connected = true;
        mergeReviews(incoming);
      },
      2000,
      () => (connected = false),
    );
    return stop;
  });

  // ----- Remembered approve mode (read once on load) -----
  // Assigns only (no reactive reads), so this effect runs a single time on
  // mount — deliberately separate from the 2s reviews poll above. A failure
  // leaves today's "default", matching the daemon's fail-safe.
  $effect(() => {
    void getApproveMode()
      .then((m) => (approveMode = m))
      .catch(() => {});
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

  function mergeReviews(incoming: ClientReview[]) {
    reviews = incoming;
    // Pick active: keep current if still present, else deep link, else first.
    if (!activeId || !incoming.some((r) => r.id === activeId)) {
      const wanted = deepLinkId();
      const next =
        (wanted && incoming.find((r) => r.id === wanted)?.id) ??
        incoming[0]?.id ??
        null;
      if (next !== activeId) selectReview(next);
    }
  }

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

  // ----- Annotation CRUD + debounced autosave -----
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingSaveId: string | null = null;

  function scheduleSave() {
    if (!activeId) return;
    pendingSaveId = activeId;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushPending, 500);
  }

  async function flushPending(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
    }
    if (!pendingSaveId) return;
    const id = pendingSaveId;
    pendingSaveId = null;
    const snapshot = annotations.map((a) => ({ ...a }));
    try {
      await putAnnotations(id, snapshot);
    } catch (err) {
      // A non-2xx (e.g. the review was resolved/removed) is not a connection
      // problem — the daemon answered. Only a real network failure goes offline.
      if (!(err instanceof HttpError)) connected = false;
    }
  }

  function createAnnotation(sel: {
    blockId: string;
    startOffset: number;
    endOffset: number;
    quote: string;
    comment: string;
  }) {
    const id = crypto.randomUUID();
    annotations = [...annotations, { id, ...sel }];
    focusedAnnotation = id;
    scheduleSave();
  }

  function editAnnotation(id: string, comment: string) {
    annotations = annotations.map((a) => (a.id === id ? { ...a, comment } : a));
    scheduleSave();
  }

  function deleteAnnotation(id: string) {
    annotations = annotations.filter((a) => a.id !== id);
    if (focusedAnnotation === id) focusedAnnotation = null;
    scheduleSave();
  }

  function focusAnnotation(id: string) {
    focusedAnnotation = id;
    const card = document.querySelector(`[data-annotation-card="${id}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ----- Resolve flow -----
  async function approve(mode: AcceptMode) {
    if (!activeId) return;
    const id = activeId;
    busy = true;
    await flushPending();
    try {
      await resolveReview(id, { behavior: "allow", acceptMode: mode });
      approveMode = mode; // remember locally so the next plan defaults to it
      afterResolve(id);
    } catch (err) {
      // 404/409 = already resolved or removed elsewhere → just advance.
      if (err instanceof HttpError) afterResolve(id);
      else connected = false;
    } finally {
      busy = false;
    }
  }

  async function requestChanges(generalComment: string) {
    if (!activeId) return;
    const id = activeId;
    showDialog = false;
    busy = true;
    await flushPending();
    const feedback = formatFeedback(annotations, generalComment);
    try {
      await resolveReview(id, { behavior: "deny", feedback });
      afterResolve(id);
    } catch (err) {
      if (err instanceof HttpError) afterResolve(id);
      else connected = false;
    } finally {
      busy = false;
    }
  }

  function afterResolve(id: string) {
    const remaining = reviews.filter((r) => r.id !== id);
    reviews = remaining;
    // Auto-advance to the next pending review, or clear.
    const next = remaining[0]?.id ?? null;
    selectReview(next);
  }
</script>

<div class="shell">
  <TopBar
    {reviews}
    {active}
    {busy}
    {approveMode}
    onSelect={selectReview}
    onApprove={approve}
    onRequestChanges={() => (showDialog = true)}
  />

  {#if active}
    <div class="columns">
      <aside class="col col-toc">
        <Toc headings={rendered.headings} {activeSlug} onJump={jumpTo} />
      </aside>

      {#key active.id}
        <PlanView
          html={rendered.html}
          {annotations}
          activeId={focusedAnnotation}
          bind:scrollEl
          onResolved={(r) => (resolved = r)}
          onCreate={createAnnotation}
          onFocusAnnotation={focusAnnotation}
        />
      {/key}

      <aside class="col col-gutter">
        <AnnotationGutter
          {resolved}
          activeId={focusedAnnotation}
          onFocus={focusAnnotation}
          onEdit={editAnnotation}
          onDelete={deleteAnnotation}
        />
      </aside>
    </div>
  {:else}
    <EmptyState {connected} />
  {/if}
</div>

{#if showDialog && active}
  <RequestChangesDialog
    {annotations}
    onSubmit={requestChanges}
    onCancel={() => (showDialog = false)}
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
    font-family: var(--font-mono);
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
