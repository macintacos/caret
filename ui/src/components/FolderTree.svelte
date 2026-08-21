<script lang="ts">
  // The folder preview (EXC-918): a viewport-fixed card opened by clicking a plan
  // reference the daemon resolved to a directory, holding an interactive tree
  // rooted at that path as the prose wrote it. A folder has no natural bound the
  // way a file's `:line` gives one, so FilePreview's deliberate no-scroll peek
  // does not carry over — the value here is navigating the directory's shape, so
  // the card is interactive by design. Folders expand; files open (EXC-1137) —
  // activating a file row, by pointer or from the keyboard, opens that file in the
  // excerpt lane, so the card is a place the reader navigates FROM rather than a
  // shape they read and leave.
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
  import { tick, untrack } from "svelte";
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
    captureCard,
    CARD_MARGIN,
    cardBounds,
    createLevels,
    cwdPath,
    type FolderCardMemory,
    type FolderMemory,
    laneEdge,
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
    /** Where a dismissed card is filed and a reopened one comes back from
     * (EXC-1138). Owned by DiffPlanView, which replaces it on a review switch —
     * so a card that was open across one is filed into an instance nothing
     * references any more, rather than lingering in a shared map. */
    memory: FolderMemory;
    /** Whether the shortcut-hint affordances are shown (EXC-826); gates the
     * header's "esc to close" chip. Escape closes the card regardless. */
    showShortcutHints?: boolean;
    /** Open a file row in the excerpt lane (EXC-1137). The path is already
     * cwd-relative — the tree's own paths are relative to the referenced
     * directory, and the conversion is this card's to make because only it holds
     * the root the daemon reported. No line: a tree row carries no `:line`, so
     * the excerpt is framed on the file's head. */
    onOpenFile: (cwdRelativePath: string) => void;
  }
  let { reviewId, path, anchor, memory, showShortcutHints = true, onOpenFile }: Props = $props();

  type State =
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "empty" }
    /** `elided` is what the daemon's cap dropped from the ROOT level; a nested
     * level reports its own on its row. */
    | { kind: "ready"; elided: number };
  let view = $state.raw<State>({ kind: "loading" });
  /** What the tree is built from, and the signal to mount it: one level's worth
   * of paths on a first open, every cached level's plus the memory they came
   * back from on a reopen. ONE value rather than a paths field and a separate
   * `restored` flag, so the tree effect cannot read half of a reference — it
   * would otherwise be correct only by the convention that these two effects run
   * in declaration order. */
  let build = $state.raw<{ paths: string[]; from?: FolderCardMemory } | undefined>();

  // The per-level bookkeeping (folderTree.ts) and the daemon's own canonical
  // path for the card's root, which every deeper request is built from.
  // Deliberately NOT reactive: the row decoration closes over `levels` and the
  // library re-reads it on every render, and every write below is followed by
  // something that repaints.
  let levels: Levels = createLevels();
  let rootPath = "";
  let tree: FileTree | undefined;

  // Open on the referenced directory's immediate children, collapsed, in one
  // round trip — unless this reference has been open before, in which case the
  // whole tree comes back from memory with no round trip at all (EXC-1138).
  // Re-runs when the reference changes — DiffPlanView reuses this instance for a
  // newly-clicked folder — dropping everything the previous one accumulated.
  $effect(() => {
    const id = reviewId;
    const root = path;
    let cancelled = false;
    const remembered = memory.read(id, root);
    if (remembered !== undefined) {
      // Synchronous by design: the card is `ready` with its whole path set
      // before this effect returns, so it paints in one frame rather than
      // flashing "Loading…" over a tree it already has.
      rootPath = remembered.rootPath;
      levels = createLevels(remembered.levels);
      view = { kind: "ready", elided: remembered.elided };
      build = { paths: [...remembered.levels.paths], from: remembered };
      return;
    }
    view = { kind: "loading" };
    build = undefined;
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
        build = { paths };
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
  /**
   * The open preview lane's dock and box, or undefined when none is open.
   *
   * Measured out of the DOM rather than taken as a prop because the placement
   * effect below is already reading the card's own settled rect at one instant,
   * and the lane's has to be read at that same instant to agree with it — a prop
   * would carry whatever rect the parent last happened to measure.
   *
   * The dock is read as a total ternary rather than asserted: the attribute's
   * value comes from a typed prop one component away, so the fallback can never
   * fire today, but nothing local would say so if that changed. The rect is put
   * through `laneEdge` rather than used raw, because a lane opened FROM this card
   * is measured while it is still wiping in.
   *
   * A lane playing its CLOSING wipe is no lane, which is what the `:not()` buys.
   * It stays mounted for the length of that wipe, so a row clicked inside that
   * window would otherwise read a lane that is already leaving — and skip the
   * re-place on the very closed-to-open transition it exists to catch, since
   * reopening cancels the pending unmount and the lane comes straight back.
   */
  function openLane(): { edge: DrawerEdge; top: number; left: number } | undefined {
    const el = document.querySelector<HTMLElement>(
      "[data-file-drawer]:not([data-file-drawer-closing])",
    );
    if (el === null) return undefined;
    const edge: DrawerEdge = el.dataset.fileDrawer === "right" ? "right" : "bottom";
    const settled = Number.parseFloat(el.style.getPropertyValue("--fd-size"));
    return laneEdge(edge, el.getBoundingClientRect(), settled);
  }

  /** Put the card at `box`, sized as it currently measures and inside the
   * viewport less whatever lane is open at this instant. */
  function place(el: HTMLElement, box: { top: number; bottom: number; left: number }): void {
    const self = el.getBoundingClientRect();
    placed = anchorCard(
      box,
      { width: self.width, height: self.height },
      cardBounds({ width: window.innerWidth, height: window.innerHeight }, openLane()),
      CARD_MARGIN,
    );
  }

  //
  // The lane narrows the box the card is placed inside (EXC-1129). A lane that
  // opens AFTER the card is placed does not re-place it: placement is computed
  // once, at open, and moving a card the reader is already reading would cost
  // more than the overlap. `openRow` below is the one exception, and it re-places
  // by calling `place` directly rather than by joining this dependency set — the
  // once-at-open contract has to keep holding for every other way a lane opens.
  $effect(() => {
    const el = card;
    const box = anchor;
    if (el === null || view.kind === "loading") return;
    void tick().then(() => {
      if (card === el) place(el, box);
    });
  });

  /**
   * The tree-relative path of the file row an event came from, or null for
   * anything else — a directory row, the chevron on one, or the empty lane below
   * the last row.
   *
   * `composedPath` because every row lives inside `<file-tree-container>`'s shadow
   * root, so `e.target` retargets to the custom element and the row is only
   * reachable through the composed path. `data-item-path` / `data-item-type` are
   * the library's own row attributes.
   */
  function fileRowPath(e: Event): string | null {
    const rowEl = e
      .composedPath()
      .find((n): n is Element => n instanceof Element && n.matches('[data-type="item"]'));
    if (rowEl === undefined || rowEl.getAttribute("data-item-type") !== "file") return null;
    return rowEl.getAttribute("data-item-path");
  }

  /**
   * Open a file row in the excerpt lane (EXC-1137), converting the row's
   * tree-relative path into the cwd-relative one the excerpt route wants.
   *
   * Driven off real ACTIVATION rather than the library's `onSelectionChange`,
   * which is its only selection hook and fires on focus movement too: an
   * arrow-key walk down the tree would open one preview per keystroke.
   */
  function openRow(treePath: string): void {
    const el = card;
    // Sampled BEFORE the open, because the answer changes as a result of it. Only
    // the closed-to-open transition THIS click causes earns a re-place, because
    // it is the reader asking for the lane that is about to land on the card. A
    // lane already standing is left to placement-once whether or not the card
    // overlaps it — that overlap is EXC-1129's accepted cost, and a lane the
    // reader opened from the plan is not this click's to tidy up after.
    const laneWasOpen = openLane() !== undefined;
    onOpenFile(cwdPath(rootPath, treePath));
    if (laneWasOpen || el === null) return;
    void tick().then(() => {
      if (card === el) place(el, anchor);
    });
  }

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

  /**
   * The element the library scrolls, or null when it cannot be found.
   *
   * @pierre/trees exposes no scroll getter, so this element inside the tree's
   * own (open) shadow root is the only place a scroll position lives. It is
   * marked with the attribute the library's own stylesheet selects on, which is
   * as close to a contract as the library offers here. A miss is not a failure:
   * the card comes back with its expansion intact, at the top.
   */
  function scrollerOf(owner: FileTree): HTMLElement | null {
    const el = owner
      .getFileTreeContainer()
      ?.shadowRoot?.querySelector("[data-file-tree-virtualized-scroll]");
    return el instanceof HTMLElement ? el : null;
  }

  // Mount the tree once its container exists and its paths have arrived — one
  // level on a first open, every cached level on a restore.
  //
  // Rebuilt from scratch when the reference changes; what carries across a
  // DISMISSAL instead is the memory this teardown files (EXC-1138).
  $effect(() => {
    const container = host;
    const built = build;
    if (container === null || built === undefined) return;
    // The card this tree is FOR, captured as VALUES because the effect above
    // replaces `rootPath` and `levels` — and a review switch replaces `memory` —
    // the instant the reference changes, and both run before this effect's
    // teardown. A teardown reading them live would file this card's memory under
    // the next card's reference, or into the next review's. `reviewId` and
    // `path` are the reactive pair here, so the read is untracked to keep them
    // out of this effect's dependency set as well.
    const filed = untrack(() => ({ memory, reviewId, path, rootPath, levels }));
    const from = built.from;
    const owner = new FileTree({
      paths: built.paths,
      initialExpansion: "closed",
      // The reader's own expansion, applied at CONSTRUCTION rather than as a
      // run of lazy adds — which is what makes a reopened card paint whole in
      // one frame instead of unfolding itself.
      initialExpandedPaths: from?.expanded,
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
    // Follow the offset as the reader moves it, rather than reading it back at
    // teardown. Svelte detaches an effect's DOM BEFORE running its teardown, and
    // a detached element's `scrollTop` is spec'd to read 0 — so a card read at
    // that point would report the top however far the reader had scrolled, and
    // every reopen would land there.
    let scrollTop = 0;
    const scroller = scrollerOf(owner);
    const onScroll = () => {
      scrollTop = scroller?.scrollTop ?? 0;
    };
    // Attached before the scroll below, so a restore's own `scrollToPath` is
    // recorded too — reopening a card and dismissing it again keeps the place
    // rather than resetting it to the top.
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    // Every element the library renders is tabIndex -1, so without this the card
    // is reachable only by pointer: the reader who opened it with a click could
    // not then walk it with the arrow keys. Focusing the first row hands the
    // library's own key handling somewhere to start. Escape still closes the
    // card from here — DiffPlanView listens on `window`, in the capture phase.
    //
    // Unconditional, and the reopen's own scroll rides on top of it rather than
    // replacing it: `scrollToPath` focuses its target too, so the arrow keys
    // resume from the row that was under the reader's eye — but it early-returns
    // on a path it cannot resolve to a visible row, and a card left with no
    // focused row at all is the keyboard-dead one this call exists to prevent.
    owner.focusFirstItem();
    if (from?.topPath !== undefined) owner.scrollToPath(from.topPath, { offset: "top" });
    const unsubscribe = owner.subscribe(() => syncExpansions(owner));
    // The library's `subscribe` deliberately swallows its initial snapshot, so
    // the walk above will not run until the reader touches the tree. On a first
    // open that is exactly right — nothing is expanded, so there is nothing to
    // claim. On a REOPEN it is not: a directory whose level was refused or still
    // in flight comes back expanded and absent from the snapshot, and this walk
    // is the retry the memory promises it. Harmless either way, so it is not
    // worth a branch to say which case is which.
    syncExpansions(owner);
    // One click listener is the WHOLE activation surface, pointer and keyboard
    // alike: every row the library renders is a real <button>, so Enter and Space
    // on a focused row are the button's own native activation and arrive here as
    // an ordinary click. That is why there is no key handling of our own — and
    // why the two routes cannot drift, since the library's `handleRowClick` runs
    // for both and its selection follows either way. A directory click reaches
    // here too, and `fileRowPath` returns null for it, leaving the library's
    // expand/collapse as the whole of what that click did.
    const onRowClick = (e: MouseEvent) => {
      // A modified click is the library's range/toggle SELECTION gesture
      // (`computeFileTreeRowClickPlan`), not an activation, so it opens nothing.
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const treePath = fileRowPath(e);
      if (treePath !== null) openRow(treePath);
    };
    container.addEventListener("click", onRowClick);
    return () => {
      filed.memory.write(
        filed.reviewId,
        filed.path,
        captureCard({
          rootPath: filed.rootPath,
          levels: filed.levels,
          // `getVisibleCount() - 1` because the library's range end is
          // inclusive, and "visible" is every row no collapsed parent hides —
          // not just the ones the virtualizer has painted.
          rows: owner.getVisibleRows(0, Math.max(0, owner.getVisibleCount() - 1)),
          scrollTop,
          itemHeight: owner.getItemHeight(),
        }),
      );
      scroller?.removeEventListener("scroll", onScroll);
      container.removeEventListener("click", onRowClick);
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
