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

  import type { DirEntry } from "@core/lib/types";
  import { getDirListing } from "$lib/api.ts";
  import { anchorCard, cwdPath, levelPaths, treeKey } from "$lib/folderTree.ts";
  import { Kbd } from "$lib/components/ui/kbd/index.js";

  interface Props {
    reviewId: string;
    /** The directory reference exactly as the plan wrote it. Doubles as the
     * anchor every /dir request carries: the route counts its descent guard from
     * this path, so a level asked for without it is a 404. */
    path: string;
    /** The clicked token, measured once to place the card. */
    anchor: HTMLElement;
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

  // Per-level bookkeeping, deliberately NOT reactive: the row decoration closes
  // over these and the library re-reads it on every render, and every write below
  // is followed by something that repaints. Keys are canonical tree paths (no
  // trailing slash), matching what a visible row reports.
  let rootPath = "";
  const loaded = new Set<string>();
  const pending = new Set<string>();
  const skipped = new Set<string>();
  const failed = new Set<string>();
  const elidedBy = new Map<string, number>();
  let tree: FileTree | undefined;

  const join = (parent: string, name: string) => (parent === "" ? name : `${parent}/${name}`);

  // The daemon marks a directory it will not enumerate on sight (node_modules,
  // dist, a dotted name). The mark is advisory — it would still list one asked
  // for directly — but the card takes it: a plan citing a directory means the
  // shape of the reader's project, not the shape of its dependencies.
  function noteSkipped(parent: string, entries: readonly DirEntry[]): void {
    for (const e of entries) {
      if (e.skipped === true) skipped.add(join(parent, e.name));
    }
  }

  function reset(): void {
    loaded.clear();
    pending.clear();
    skipped.clear();
    failed.clear();
    elidedBy.clear();
  }

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
    reset();
    void (async () => {
      try {
        const listing = await getDirListing(id, root, "");
        if (cancelled) return;
        rootPath = listing.path;
        loaded.add("");
        noteSkipped("", listing.entries);
        if (listing.entries.length === 0) {
          view = { kind: "empty" };
          return;
        }
        view = { kind: "ready", elided: listing.total - listing.entries.length };
        rootPaths = levelPaths("", listing.entries);
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

  // Place the card once, against its own measured size — the header's path and
  // the tree's first level both size it, so a placement computed before they
  // render would flip on the wrong height.
  $effect(() => {
    const el = card;
    const token = anchor;
    if (el === null) return;
    void tick().then(() => {
      if (card !== el) return;
      const box = el.getBoundingClientRect();
      placed = anchorCard(
        token.getBoundingClientRect(),
        { width: box.width, height: box.height },
        { width: window.innerWidth, height: window.innerHeight },
        CARD_MARGIN,
      );
    });
  });

  /** How close to a viewport edge the card may sit, in px. */
  const CARD_MARGIN = 12;

  // Kill the library's own transitions under reduced motion. They live inside its
  // shadow root, which the global `#app` rule in styles/base.css cannot reach, and
  // `unsafeCSS` is the library's documented way in. Nothing else is injected here
  // — the palette rides CSS custom properties, which inherit through the boundary.
  const TREE_REDUCED_MOTION = `
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        transition: none !important;
        animation: none !important;
      }
    }
  `;

  // What a directory row says about itself beyond its name. At most one applies:
  // a skipped directory is never fetched, so it can neither fail nor elide.
  function rowDecoration({ row }: FileTreeRowDecorationContext): FileTreeRowDecoration | null {
    if (row.kind !== "directory") return null;
    // A row reports a directory's path with its trailing slash; the bookkeeping
    // above is keyed by treeKey. See folderTree.ts's treeKey for why the two
    // spellings exist at all.
    const key = treeKey(row.path);
    // Only once opened: before that the row is an ordinary folder, and saying so
    // up front would read as a warning about a directory nobody asked to see.
    if (skipped.has(key)) return row.isExpanded ? { text: "not listed" } : null;
    if (failed.has(key)) return { text: "couldn't load" };
    const elided = elidedBy.get(key);
    return elided === undefined ? null : { text: `+${elided} more` };
  }

  // Fetch one level and fold it in. `batch` rather than a loop of `add` so the
  // level costs one mutation and one repaint, and rather than `resetPaths`, which
  // would discard every folder the reader has already opened.
  async function loadLevel(owner: FileTree, treePath: string): Promise<void> {
    try {
      const listing = await getDirListing(reviewId, path, cwdPath(rootPath, treePath));
      if (owner !== tree) return;
      loaded.add(treePath);
      noteSkipped(treePath, listing.entries);
      const elided = listing.total - listing.entries.length;
      if (elided > 0) elidedBy.set(treePath, elided);
      const adds = levelPaths(treePath, listing.entries);
      if (adds.length > 0) {
        owner.batch(adds.map((p) => ({ type: "add" as const, path: p })));
        return;
      }
    } catch {
      if (owner !== tree) return;
      failed.add(treePath);
    } finally {
      pending.delete(treePath);
    }
    // An empty or refused level adds no path, so nothing repainted it — and the
    // row is left claiming to be open with nothing under it. Ask for the repaint
    // that would otherwise have come free with a mutation.
    owner.render({});
  }

  // Every expanded directory whose level has not arrived asks for it. Driven off
  // the model rather than off a click so the keyboard path (a focused row's
  // ArrowRight) loads exactly as the pointer path does.
  function syncExpansions(owner: FileTree): void {
    for (const row of owner.getVisibleRows(0, owner.getVisibleCount())) {
      if (row.kind !== "directory" || !row.isExpanded) continue;
      // Key form, not the row's own spelling: see rowDecoration above.
      const key = treeKey(row.path);
      if (loaded.has(key) || pending.has(key) || skipped.has(key)) continue;
      pending.add(key);
      void loadLevel(owner, key);
    }
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
    const unsubscribe = owner.subscribe(() => syncExpansions(owner));
    return () => {
      unsubscribe();
      owner.cleanUp();
      if (tree === owner) tree = undefined;
    };
  });

  const message = $derived(
    view.kind === "empty"
      ? "This folder is empty."
      : view.kind === "error"
        ? "Couldn't read this folder."
        : "Loading…",
  );
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
  {:else}
    <div class="ft-message" data-folder-state={view.kind}>{message}</div>
  {/if}
</div>

<style>
  /* A viewport-fixed card on the app's raised paper, placed against the reference
     it opened from (anchorCard) and sized to hold a level without dominating the
     plan behind it. z-index clears the TopBar (30) and the plan's own sticky rails
     while staying under the portalled shadcn overlays (z-50), so it paints over
     the chrome and never over a modal. */
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
    animation: ft-in var(--dur-base) var(--ease-out);
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
    padding: 0.5rem 0.6rem;
    color: var(--ink-soft);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    animation: ft-in var(--dur-fast) var(--ease-out);
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
