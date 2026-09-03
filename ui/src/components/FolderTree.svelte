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
    FileTreeVisibleRow,
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
    refreshCard,
    treeKey,
  } from "$lib/folderTree.ts";
  import Icon from "@/components/Icon.svelte";
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
     * level reports its own on its row. `empty` is a card that HAS a tree and
     * nothing to put in it — a refresh that found the folder emptied, or a
     * reopen of one. It keeps the tree mounted, and with it the refresh control,
     * where the `empty` state above would take both away. */
    | { kind: "ready"; elided: number; empty: boolean };
  let view = $state.raw<State>({ kind: "loading" });
  /** What the tree is built from, and the signal to mount it: one level's worth
   * of paths on a first open, every cached level's plus the memory they came
   * back from on a reopen. ONE value rather than a paths field and a separate
   * `restored` flag, so the tree effect cannot read half of a reference — it
   * would otherwise be correct only by the convention that these two effects run
   * in declaration order. */
  let build = $state.raw<{ paths: string[]; from?: FolderCardMemory } | undefined>();
  /** Whether a refresh is in flight, which is both the spinner in the header and
   * the guard that stops a second press stacking another round of requests. */
  let refreshing = $state(false);
  /** Whether the last refresh could not be read. The tree it failed to replace
   * is still standing, so the header says the card is stale rather than the card
   * emptying itself. */
  let refreshFailed = $state(false);

  // The per-level bookkeeping (folderTree.ts) and the daemon's own canonical
  // path for the card's root, which every deeper request is built from.
  // Deliberately NOT reactive: the row decoration closes over `levels` and the
  // library re-reads it on every render, and every write below is followed by
  // something that repaints.
  let levels: Levels = createLevels();
  let rootPath = "";
  let tree: FileTree | undefined;
  /** Where the reader has the tree scrolled to, followed as they move it.
   *
   * Component-level rather than local to the mount effect because a refresh
   * needs it too — and reading it back at teardown is not an option: svelte
   * detaches an effect's DOM BEFORE running its teardown, and a detached
   * element's `scrollTop` is spec'd to read 0.
   */
  let scrollTop = 0;

  // Open on the referenced directory's immediate children, collapsed, in one
  // round trip — unless this reference has been open before, in which case the
  // whole tree comes back from memory with no round trip at all (EXC-1138).
  // Re-runs when the reference changes — DiffPlanView reuses this instance for a
  // newly-clicked folder — dropping everything the previous one accumulated.
  $effect(() => {
    const id = reviewId;
    const root = path;
    let cancelled = false;
    // A card reused for another reference inherits none of the previous one's
    // refresh: an in-flight one bails on the tree it no longer owns, and a
    // failure belongs to the folder it happened in.
    refreshing = false;
    refreshFailed = false;
    const remembered = memory.read(id, root);
    if (remembered !== undefined) {
      // Synchronous by design: the card is `ready` with its whole path set
      // before this effect returns, so it paints in one frame rather than
      // flashing "Loading…" over a tree it already has.
      rootPath = remembered.rootPath;
      levels = createLevels(remembered.levels);
      view = {
        kind: "ready",
        elided: remembered.elided,
        empty: remembered.levels.paths.length === 0,
      };
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
        view = { kind: "ready", elided: listing.total - listing.entries.length, empty: false };
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

  /** Every row no collapsed parent hides — not just the ones the virtualizer has
   * painted. `getVisibleCount() - 1` because the library's range end is
   * inclusive. */
  function visibleRows(owner: FileTree): readonly FileTreeVisibleRow[] {
    return owner.getVisibleRows(0, Math.max(0, owner.getVisibleCount() - 1));
  }

  // Every expanded directory whose level nobody has asked for asks for it.
  // Driven off the model rather than off a click so a row expanded from the
  // keyboard loads exactly as one expanded by pointer does — the card focuses
  // its first row on open, so arrow keys reach the library's own key handling.
  function syncExpansions(owner: FileTree): void {
    for (const treePath of levels.claim(visibleRows(owner))) void loadLevel(owner, treePath);
  }

  /**
   * Re-read every level the card has OPEN and repaint in place (EXC-1139).
   *
   * Nothing invalidates the cache on its own: a review runs while an agent edits
   * the working copy, and when to stop trusting the tree is the reader's call
   * rather than the card's. This is that call, and the only thing that makes it.
   *
   * `resetPaths` rather than a remount, because the library's reset re-enters
   * exactly the state a restored card is constructed in — the tree's own
   * `initialExpansion: "closed"` plus an explicit expansion set — so the card
   * keeps one construction site instead of growing a second. And `levels.reset`
   * mutates the instance the mount effect captured, so the memory this card
   * files on the way out is the tree the reader is actually looking at.
   *
   * A refresh never leaves the `ready` state, even when the folder came back
   * empty — it says so through `ready`'s own `empty` instead. The `empty` state
   * is for a card that never had a tree, and flipping into it here would unmount
   * this control out from under the reader in the same gesture they used it,
   * leaving them nothing to press when the folder fills again.
   */
  async function refresh(): Promise<void> {
    const owner = tree;
    if (owner === undefined || refreshing) return;
    refreshing = true;
    refreshFailed = false;
    const before = captureCard({
      rootPath,
      levels,
      rows: visibleRows(owner),
      scrollTop,
      itemHeight: owner.getItemHeight(),
    });
    // A directory the daemon declines to enumerate is left out: asking again
    // buys a second refusal, and `refreshCard` keeps it open on the strength of
    // its parent's listing alone.
    const skipped = new Set(before.levels.skipped);
    const open = ["", ...before.expanded.map(treeKey).filter((p) => !skipped.has(p))];
    // Together rather than one level at a time: they are independent reads, and
    // the fold is what imposes order. Each catches its own refusal, so one
    // directory the daemon will not read does not take the refresh with it.
    const answers = await Promise.all(
      open.map(async (treePath) => {
        try {
          const listing = await getDirListing(reviewId, path, cwdPath(rootPath, treePath));
          return [treePath, listing] as const;
        } catch {
          return undefined;
        }
      }),
    );
    // The reference changed under the refresh, so this card is gone and neither
    // its flags nor its tree are this call's to touch — the effect that replaced
    // it has already cleared both.
    if (owner !== tree) return;
    refreshing = false;
    // The root is always the first answer, and the only one whose refusal means
    // the REFRESH failed. Any other is a directory the reader can no longer
    // open, which `refreshCard` shuts rather than treating as an error.
    if (answers[0] === undefined) {
      refreshFailed = true;
      return;
    }
    const next = refreshCard(before, answers.filter((a) => a !== undefined));
    levels.reset(next.levels);
    view = { kind: "ready", elided: next.elided, empty: next.levels.paths.length === 0 };
    owner.resetPaths(next.levels.paths, { initialExpandedPaths: next.expanded });
    // No `focusFirstItem` here, and `focus: false` on the scroll, unlike the
    // mount below: the reader pressed a button, so focus stays on that button
    // rather than being yanked into the tree it just repainted.
    if (next.topPath !== undefined) {
      owner.scrollToPath(next.topPath, { offset: "top", focus: false });
    }
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
    // teardown — see `scrollTop`'s own declaration for why that is the only
    // workable direction. The assignment RESETS the previous mount's value, and
    // has to: `scrollTop` outlives any one tree now, so a card that went ready →
    // loading → ready would otherwise hand the next refresh an offset measured
    // against a tree that is gone.
    scrollTop = 0;
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
          rows: visibleRows(owner),
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
  class:ft-open={view.kind === "ready" && !view.empty}
  data-folder-tree
  bind:this={card}
  style:top="{placed?.top ?? 0}px"
  style:left="{placed?.left ?? 0}px"
  style:visibility={placed === undefined ? "hidden" : "visible"}
>
  <div class="ft-header ref-header">
    <span class="ft-badge ref-badge">Folder</span>
    <span class="ft-path ref-path">{path}</span>
    <span class="ft-header-end ref-header-end">
      {#if view.kind === "ready" && view.elided > 0}
        <!-- The cap has no page-past, so this is a statement of what the reader
             cannot reach through this card — never an affordance implying they
             can. -->
        <span class="ft-elided">{view.elided} more not shown</span>
      {/if}
      <!-- The tree the refresh failed to replace is still standing, so this says
           the card is stale rather than the card emptying itself. Mounted
           unconditionally, with only its TEXT switched — a live region has to be
           idle in the DOM before the change it announces, and one inserted with
           its content already in it is skipped by some AT outright. Same shape
           and same reason as PlanToc.svelte's `.toc-empty`. Empty it draws
           nothing, and cancels the flex gap it would otherwise leave behind. -->
      <span class="ft-stale" role="status">{refreshFailed ? "couldn't refresh" : ""}</span>
      {#if view.kind === "ready"}
        <!-- Only where there is a cached tree to re-read: the first level is the
             reference effect's, and reopening a card that never got one is its
             own retry. aria-disabled rather than disabled while a refresh is in
             flight, so the reader who pressed it from the keyboard keeps focus
             on it instead of being dropped to the body. -->
        <button
          type="button"
          class="ft-refresh ref-icon-btn"
          aria-label="Re-read this folder"
          aria-disabled={refreshing}
          aria-busy={refreshing}
          onclick={refresh}
        >
          {#if refreshing}
            <Spinner size={11} aria-hidden="true" />
          {:else}
            <Icon name="refresh-cw" size={11} />
          {/if}
        </button>
      {/if}
      {#if showShortcutHints}
        <span class="ft-hint ref-esc-hint"><Kbd class="kbd-sm">esc</Kbd> to close</span>
      {/if}
    </span>
  </div>
  {#if view.kind === "ready"}
    <!-- Kept in the DOM even with nothing in it, so the tree object survives and
         the header's refresh control stays live; the lane is hidden rather than
         unmounted because unmounting it is what would destroy the tree. -->
    <div class="ft-tree" class:ft-tree-empty={view.empty} bind:this={host}></div>
  {/if}
  {#if view.kind === "loading"}
    <!-- Decorative: the "Loading…" beside it is the accessible message, so the
         spinner's default role="status" + aria-label would say it twice. Nothing
         announces the wait; spinner.svelte records why a region cannot here. -->
    <div class="ft-message ref-message" data-folder-state="loading">
      <Spinner size={12} aria-hidden="true" />Loading…
    </div>
  {:else if view.kind === "error"}
    <div class="ft-message ref-message" data-folder-state="error">Couldn't read this folder.</div>
  {:else if view.kind === "empty" || view.empty}
    <div class="ft-message ref-message" data-folder-state="empty">This folder is empty.</div>
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
  .ft-elided,
  .ft-stale {
    color: var(--ink-faint);
    white-space: nowrap;
  }
  /* The live region is always mounted, so with no failure to report it has to
     give back the flex gap it would otherwise hold open. `display: none` would
     reintroduce the very insertion the unconditional mount avoids. */
  .ft-stale:empty {
    margin-inline-end: calc(-1 * var(--ref-header-gap));
  }
  /* The same button idiom FilePreview's header uses (.fp-close): a real control
     at header scale. It takes no tint of its own — this is not a way out of the
     card — so it sits in the header's faint ink and comes up to full ink under
     the pointer. The focus ring is the app's global `button:focus-visible` in
     styles/base.css. */
  .ft-refresh {
    background: none;
    color: var(--ink-faint);
    transition: color var(--dur-micro) var(--ease-out);
  }
  .ft-refresh:hover,
  .ft-refresh:focus-visible {
    color: var(--ink);
  }
  /* The vendored 24px glyph carries stroke-width 2, which at 11px renders under
     one device pixel and smudges rather than reading as a pair of arrows. */
  .ft-refresh :global(svg) {
    stroke-width: 2.5;
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
  /* The lane, not the tree: `display: none` leaves the element — and so the
     FileTree bound to it — in place, which is what lets the card go empty and
     come back through one `resetPaths` rather than a remount. */
  .ft-tree-empty {
    display: none;
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
