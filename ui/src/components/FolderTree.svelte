<script lang="ts">
  // The folder preview (EXC-918): a viewport-fixed card opened by clicking a plan
  // reference the daemon resolved to a directory, holding an interactive tree
  // rooted at that path as the prose wrote it. A folder has no natural bound the
  // way a file's `:line` gives one, so FilePreview's deliberate no-scroll peek
  // does not carry over — the value here is navigating the directory's shape, so
  // the card is interactive by design. Folders expand; files are inert.
  //
  // Expansion is lazy, one level per open folder, because a plan is entitled to
  // cite `node_modules/` and one level of that is already thousands of rows. The
  // library is path-first and exposes no expand callback, so `subscribe` — which
  // fires on any model change, an expand included — is the hook: each time it
  // fires, every expanded directory whose level has not arrived asks for it. A
  // directory row draws its chevron whether or not its children are known, so an
  // unopened folder is expandable before there is anything under it.
  //
  // The card is honest about what it is NOT showing, which is the one thing it
  // says beyond the names: a level the daemon capped reports how many rows it
  // elided, and a directory the daemon declines to enumerate says so when opened
  // instead of appearing empty. Both ride the row's own decoration lane in faint
  // ink — quiet, and always there where they apply.
  //
  // Dismissal is DiffPlanView's (Escape, or a click outside the card); a click
  // inside is left alone so the tree can be navigated.
  import { tick } from "svelte";
  import { FileTree } from "@pierre/trees";
  import "@pierre/trees/web-components";
  import type {
    FileTreeRowDecoration,
    FileTreeRowDecorationContext,
  } from "@pierre/trees";

  import { getDirListing } from "$lib/api.ts";
  import type { DrawerEdge } from "$lib/fileDrawer.ts";
  import {
    anchorCard,
    CARD_MARGIN,
    cardBounds,
    createLevels,
    cwdPath,
    type Levels,
  } from "$lib/folderTree.ts";
  import { Kbd } from "$lib/components/ui/kbd/index.js";
  import { Spinner } from "$lib/components/ui/spinner/index.js";

  interface Props {
    reviewId: string;
    /** The directory reference exactly as the plan wrote it. Doubles as the
     * anchor every /dir request carries: the route counts its descent guard from
     * this path, so a level asked for without it is a 404. */
    path: string;
    /** The clicked reference's box, captured at click time — a rect rather than
     * the element, because the card is placed once and never tracks it, and the
     * plan surface can be torn down (compare mode) while the card still holds
     * this. A detached element would measure all zeros and park the card in the
     * viewport's corner. */
    anchor: { top: number; bottom: number; left: number };
    /** Whether the shortcut-hint affordances are shown (EXC-826); gates the
     * header's "esc to close" chip. Escape closes the card regardless. */
    showShortcutHints?: boolean;
  }
  let { reviewId, path, anchor, showShortcutHints = true }: Props = $props();

  type State =
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "empty" }
    /** `elided` is what the daemon's cap dropped from the ROOT level; a nested
     * level reports its own on its row. */
    | { kind: "ready"; elided: number };
  let view = $state.raw<State>({ kind: "loading" });
  // The root level's tree paths, which is also the signal to mount the tree.
  let rootPaths = $state.raw<string[] | undefined>();

  // The per-level bookkeeping (folderTree.ts), and the daemon's own canonical
  // path for the card's root, which every deeper request is built from.
  // Deliberately NOT reactive: the row decoration closes over `levels` and the
  // library re-reads it on every render, and every write below is followed by
  // something that repaints.
  let levels: Levels = createLevels();
  let rootPath = "";
  let tree: FileTree | undefined;

  // Open on the referenced directory's immediate children, collapsed, in one
  // round trip. Re-runs when the reference changes — DiffPlanView reuses this
  // instance for a newly-clicked folder — dropping everything the previous one
  // accumulated.
  $effect(() => {
    const id = reviewId;
    const root = path;
    let cancelled = false;
    view = { kind: "loading" };
    rootPaths = undefined;
    levels = createLevels();
    void (async () => {
      try {
        const listing = await getDirListing(id, root, "");
        if (cancelled) return;
        rootPath = listing.path;
        const paths = levels.record("", listing);
        if (paths.length === 0) {
          view = { kind: "empty" };
          return;
        }
        view = { kind: "ready", elided: listing.total - listing.entries.length };
        rootPaths = paths;
      } catch {
        if (!cancelled) view = { kind: "error" };
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  let host = $state<HTMLElement | null>(null);
  let card = $state<HTMLElement | null>(null);
  let placed = $state<{ top: number; left: number } | undefined>();

  // Place the card against its own measured size, once it has settled into the
  // size it will keep. `view.kind` is read into the effect's dependency set on
  // purpose: the card is a header and one line of text while it loads, and
  // ~20rem taller once `.ft-open` applies, so measuring at mount — which is all
  // `tick()` would ever wait for — would flip against a height five times too
  // small and hang a full-size card off the bottom of the viewport. It stays put
  // afterwards: the reader dismisses this card rather than scrolling with it.
  //
  // The open preview lane narrows the box the card is placed inside (EXC-1129),
  // and it is MEASURED here rather than passed down as a prop: the effect is
  // already reading the card's own settled rect at this instant, and the lane's
  // has to be read at that same instant to agree with it — a prop would carry a
  // rect captured whenever the parent last happened to measure. Reading a sibling
  // surface out of the DOM is the same shape modalStack's `topmostDialogContent`
  // takes, and for the same reason. A lane that opens AFTER the card is placed
  // does not re-place it: placement is computed once, at open, and moving a card
  // the reader is already reading would cost more than the overlap.
  $effect(() => {
    const el = card;
    const box = anchor;
    if (el === null || view.kind === "loading") return;
    void tick().then(() => {
      if (card !== el) return;
      const self = el.getBoundingClientRect();
      const laneEl = document.querySelector<HTMLElement>("[data-file-drawer]");
      const laneRect = laneEl?.getBoundingClientRect();
      placed = anchorCard(
        box,
        { width: self.width, height: self.height },
        cardBounds(
          { width: window.innerWidth, height: window.innerHeight },
          laneEl === null || laneRect === undefined
            ? undefined
            : { edge: laneEl.dataset.fileDrawer as DrawerEdge, top: laneRect.top, left: laneRect.left },
        ),
        CARD_MARGIN,
      );
    });
  });

  // Kill the library's own transitions under reduced motion. They live inside its
  // shadow root, which the global `#app` rule in styles/base.css cannot reach, and
  // `unsafeCSS` is the library's documented way in. Nothing else is injected here
  // — the palette rides CSS custom properties, which inherit through the boundary.
  //
  // The bare `*` that svelte-rules.md forbids in the light DOM is right here: the
  // shadow root IS the bound, so this reaches the library's own elements and
  // nothing else — which is exactly what the global rule's two anchors buy.
  const TREE_REDUCED_MOTION = `
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
      }
    }
  `;

  function rowDecoration({ row }: FileTreeRowDecorationContext): FileTreeRowDecoration | null {
    return levels.note(row);
  }

  // Fetch one level and fold it in. `batch` rather than a loop of `add` so the
  // level costs one mutation and one repaint, and rather than `resetPaths`, which
  // would discard every folder the reader has already opened.
  async function loadLevel(owner: FileTree, treePath: string): Promise<void> {
    try {
      const listing = await getDirListing(reviewId, path, cwdPath(rootPath, treePath));
      if (owner !== tree) return;
      const adds = levels.record(treePath, listing);
      if (adds.length > 0) {
        owner.batch(adds.map((p) => ({ type: "add" as const, path: p })));
        return;
      }
    } catch {
      if (owner !== tree) return;
      levels.fail(treePath);
    }
    // An empty or refused level adds no path, so nothing repainted it — and the
    // row is left claiming to be open with nothing under it. Ask for the repaint
    // that would otherwise have come free with a mutation. This never re-enters
    // `syncExpansions`: render() repaints without notifying subscribers.
    owner.render({});
  }

  // Every expanded directory whose level nobody has asked for asks for it.
  // Driven off the model rather than off a click so a row expanded from the
  // keyboard loads exactly as one expanded by pointer does — the card focuses
  // its first row on open, so arrow keys reach the library's own key handling.
  //
  // `getVisibleCount() - 1` because the library's range end is inclusive.
  function syncExpansions(owner: FileTree): void {
    const rows = owner.getVisibleRows(0, Math.max(0, owner.getVisibleCount() - 1));
    for (const treePath of levels.claim(rows)) void loadLevel(owner, treePath);
  }

  // Mount the tree once its container exists and the first level has arrived.
  // Rebuilt from scratch when the reference changes — the model is the level, so
  // there is no state worth carrying between two different directories.
  $effect(() => {
    const container = host;
    const paths = rootPaths;
    if (container === null || paths === undefined) return;
    const owner = new FileTree({
      paths,
      initialExpansion: "closed",
      // A row at caret's own density rather than the library's roomier 30px
      // default, so a level reads as a listing beside the plan's mono text.
      itemHeight: 22,
      // Off, though the library defaults it ON. Flattening compacts a chain of
      // single-child directories into one row reporting the chain's TERMINAL —
      // which under one-level-at-a-time loading means the row a reader just
      // clicked renames itself and reads as collapsed the moment its level
      // lands, so the click appears to have done nothing. Compaction would have
      // to prefetch the whole chain to be honest, which is a level the reader
      // never asked for.
      flattenEmptyDirectories: false,
      // The library's drag-and-drop, rename, mutation, context-menu, git-status
      // and search surfaces are all left unwired: this is a read-only view of a
      // directory a plan cited, and every one of them would offer to act on the
      // reader's real files.
      dragAndDrop: false,
      renaming: false,
      search: false,
      renderRowDecoration: rowDecoration,
      unsafeCSS: TREE_REDUCED_MOTION,
    });
    tree = owner;
    // The web-components entry is imported for its registration side effect, so
    // this creates a real <file-tree-container> with its own shadow root — the
    // same container-managed posture @pierre/diffs has.
    owner.render({ containerWrapper: container });
    // Every element the library renders is tabIndex -1, so without this the card
    // is reachable only by pointer: the reader who opened it with a click could
    // not then walk it with the arrow keys. Focusing the first row hands the
    // library's own key handling somewhere to start. Escape still closes the
    // card from here — DiffPlanView listens on `window`, in the capture phase.
    owner.focusFirstItem();
    const unsubscribe = owner.subscribe(() => syncExpansions(owner));
    return () => {
      unsubscribe();
      owner.cleanUp();
      if (tree === owner) tree = undefined;
    };
  });

</script>

<div
  class="folder-tree"
  class:ft-open={view.kind === "ready"}
  data-folder-tree
  bind:this={card}
  style:top="{placed?.top ?? 0}px"
  style:left="{placed?.left ?? 0}px"
  style:visibility={placed === undefined ? "hidden" : "visible"}
>
  <div class="ft-header">
    <span class="ft-badge">Folder</span>
    <span class="ft-path">{path}</span>
    <span class="ft-header-end">
      {#if view.kind === "ready" && view.elided > 0}
        <!-- The cap has no page-past, so this is a statement of what the reader
             cannot reach through this card — never an affordance implying they
             can. -->
        <span class="ft-elided">{view.elided} more not shown</span>
      {/if}
      {#if showShortcutHints}
        <span class="ft-hint"><Kbd class="kbd-sm">esc</Kbd> to close</span>
      {/if}
    </span>
  </div>
  {#if view.kind === "ready"}
    <div class="ft-tree" bind:this={host}></div>
  {:else if view.kind === "empty"}
    <div class="ft-message" data-folder-state="empty">This folder is empty.</div>
  {:else if view.kind === "error"}
    <div class="ft-message" data-folder-state="error">Couldn't read this folder.</div>
  {:else}
    <!-- Decorative: the "Loading…" beside it is the accessible message, so the
         spinner's default role="status" + aria-label would say it twice. Nothing
         announces the wait; spinner.svelte records why a region cannot here. -->
    <div class="ft-message" data-folder-state="loading">
      <Spinner size={12} aria-hidden="true" />Loading…
    </div>
  {/if}
</div>

<style>
  /* A viewport-fixed card on the app's raised paper, placed against the reference
     it opened from (anchorCard) and sized to hold a level without dominating the
     plan behind it. z-index clears the TopBar (30) and the plan's own sticky rails
     while staying under the portalled shadcn overlays (z-50), so it paints over
     the chrome and never over a modal — and under the comment navigator (45),
     which is a persistent dock rather than a surface the reader dismisses.

     `position: fixed` here depends on the invariant styles/layout.css states:
     no `transform` / `filter` / `perspective` / `will-change` on `.shell`, `#app`
     or `body`, any of which would make one of them the containing block. */
  .folder-tree {
    position: fixed;
    z-index: 40;
    display: flex;
    flex-direction: column;
    width: min(24rem, calc(100vw - 1.5rem));
    max-height: min(22rem, calc(100vh - 6rem));
    overflow: hidden;
    background: var(--paper-raised);
    color: var(--ink);
    border: 1px solid var(--rule);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-card);
    animation: ft-in var(--dur-enter) var(--ease-out);
  }
  /* The same header vocabulary FilePreview uses — a filled kind chip, the path,
     and the way out pushed right — so the two reference surfaces read as one
     family rather than two designs. */
  .ft-header {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    padding: 0.3rem 0.6rem;
    border-bottom: 1px solid var(--rule);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
  }
  .ft-badge {
    flex: 0 0 auto;
    align-self: center;
    padding: 0.05rem 0.4rem;
    border-radius: var(--radius);
    background: var(--ink-soft);
    color: var(--paper);
    font-weight: 700;
    font-size: var(--text-2xs);
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }
  .ft-path {
    color: var(--ink);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ft-header-end {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    margin-left: auto;
  }
  .ft-elided {
    color: var(--ink-faint);
    white-space: nowrap;
  }
  .ft-hint {
    display: inline-flex;
    align-items: center;
    gap: 0.3em;
    padding: 0.1rem 0.4rem;
    border-radius: var(--radius);
    background: var(--paper-sunk);
    color: var(--ink-faint);
    white-space: nowrap;
  }
  /* The tree is virtualized, so it cannot size to its content: the library's own
     `:host([data-file-tree-virtualized]) { height: 100% }` means the host resolves
     against whatever this lane gives it, and an auto height gives it nothing —
     the card renders as a bare header. So the card takes a definite height while
     a tree is in it, and the tree pages inside that. The message states (loading,
     empty, error) are a line of text and stay content-sized, which is why the
     height rides a class rather than the card itself. */
  .folder-tree.ft-open {
    height: min(20rem, calc(100vh - 6rem));
  }
  .ft-tree {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  /* The @pierre/trees palette bridge, the same single-rule shape app.css uses for
     --diffs-*: every value is a caret token, never a literal. Custom properties
     inherit through the shadow boundary, which is what makes a live theme switch
     free — paintTheme rewrites the tokens on :root and the tree retints with the
     rest of the app, no refetch and no JS.

     The face is caret's mono: a file tree IS a listing of paths, and every other
     path in this app — the plan's references, the preview's gutter, the cwd —
     reads mono. Amber reaches only the selected row (--accent-wash) and the focus
     ring, which is the one job the token vocabulary assigns it. */
  .ft-tree :global(file-tree-container) {
    flex: 1;
    min-width: 0;
    --trees-bg-override: var(--paper-raised);
    --trees-bg-muted-override: var(--paper-sunk);
    --trees-fg-override: var(--ink);
    --trees-fg-muted-override: var(--ink-faint);
    --trees-accent-override: var(--ink-soft);
    --trees-border-color-override: var(--rule);
    --trees-selected-bg-override: var(--accent-wash);
    --trees-selected-fg-override: var(--ink);
    --trees-selected-focused-border-color-override: var(--accent);
    --trees-focus-ring-color-override: var(--accent);
    --trees-indent-guide-bg-override: var(--rule);
    --trees-scrollbar-thumb-override: var(--ink-faint);
    /* The library tints each file icon by file type — a green markdown glyph, a
       red npm one. caret's palette gives every hue a job (svelte-rules.md), and
       "this file is markdown" is not one of them; worse, green and red already
       mean added and removed here. Every per-type variable falls back to this one,
       so a single value makes the whole set neutral. */
    --trees-file-icon-color: var(--ink-faint);
    --trees-font-family-override: var(--font-mono);
    --trees-font-size-override: var(--text-2xs);
    --trees-border-radius-override: var(--radius);
  }
  .ft-message {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.5rem 0.6rem;
    color: var(--ink-soft);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    animation: ft-in var(--dur-micro) var(--ease-out);
  }
  /* The card rises the same 4px onto the surface FilePreview's region does, so
     opening either reference surface reads as one gesture. Reduced motion is not
     handled here — the global kill-switch in styles/base.css collapses every
     animation under #app, and per doc/agents/svelte-rules.md no component honors
     the preference on its own. The tree's own shadow root is out of that rule's
     reach, which is what TREE_REDUCED_MOTION covers. */
  @keyframes ft-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
