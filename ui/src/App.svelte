<script lang="ts">
  // The app shell: the composition root that wires caret's state factories to the
  // review surface. It runs the /api/health probe (version, commit, isDev,
  // source), drives review selection + polling, autosave, and resolve
  // (approve variants / reject / request changes), and owns the top-level dialogs
  // — request-changes, settings, onboarding, and the unsent-comments guard — plus
  // theme, safe mode, the keyboard-shortcut dispatcher, and the UI-gone presence
  // beacon. The behaviors themselves live in $lib/* and @/state/*; this file only
  // holds them together and lays out the TopBar + DiffPlanView.
  import { getHealth } from "$lib/api.ts";
  import { approveVariants } from "$lib/approve.ts";
  import { createPlanNotifier } from "$lib/notify.ts";
  import { installUiGoneBeacon } from "$lib/presence.ts";
  import { createSafeModeGuard } from "$lib/safeMode.ts";
  import {
    bind,
    createShortcutDispatcher,
    defaultIsEditingContext,
    EDITOR_SHORTCUTS,
    scopedShortcuts,
    shortcuts,
  } from "$lib/shortcuts/index.ts";
  import { type AlertStore, createAlerts } from "@/state/alerts.ts";
  import { createAutosave } from "@/state/autosave.svelte.ts";
  import {
    createReviewSelection,
    startPolling,
    type SelectionStore,
  } from "@/state/polling.svelte.ts";
  import { createResolve, type ResolveStore } from "@/state/resolve.svelte.ts";
  import {
    type CommentIndexEntry,
    commentIndex,
    coveredLineCount,
    pendingItems,
  } from "$lib/feedback.ts";
  import {
    applyAppearance,
    changeAppearance,
    currentThemeId,
    watchSystemScheme,
  } from "$lib/appearance.ts";
  import { THEMES, type ThemeId } from "$lib/theme.ts";
  import {
    clearKnownPrefs,
    freshResetApplied,
    markFreshResetApplied,
    shouldShowOnboarding,
  } from "$lib/prefs.ts";
  import { readShortcutHints } from "$lib/shortcutHintsPref.ts";
  import { SETTINGS_REGISTRY, type StagedField } from "$lib/settingsRegistry.ts";
  import { type ComposerScratch, createSourceCommenting } from "$lib/diffview/commenting.ts";
  import type { ApproveVariant, ApproveVariantId, Annotation, PersistedScratch } from "@core/lib/types";

  import * as Alert from "$lib/components/ui/alert/index.js";
  import AlertHost from "@/components/AlertHost.svelte";
  import UnsentCommentsDialog from "@/components/UnsentCommentsDialog.svelte";
  import CommentNavigator from "@/components/CommentNavigator.svelte";
  import DiffPlanView from "@/components/DiffPlanView.svelte";
  import EmptyState from "@/components/EmptyState.svelte";
  import OnboardingDialog from "@/components/OnboardingDialog.svelte";
  import RequestChangesDialog from "@/components/RequestChangesDialog.svelte";
  import SettingsDialog from "@/components/SettingsDialog.svelte";
  import ShortcutsHelp from "@/components/ShortcutsHelp.svelte";
  import StatusBar from "@/components/StatusBar.svelte";
  import TopBar from "@/components/TopBar.svelte";

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
  // The in-UI alert/toast queue (EXC-850): App owns the reactive backing store,
  // createAlerts (below) mutates it, and AlertHost renders it bottom-right.
  let alertStore = $state<AlertStore>({ alerts: [] });
  // The adapter's declared approve variants, read once from the health probe.
  // Undefined until the probe lands (or for a daemon that predates the field);
  // approveVariants() falls back to the built-in set so the split-button always
  // has options.
  let declaredVariants = $state<ApproveVariant[] | undefined>(undefined);
  // True when the daemon runs from source (EXC-556); read once from the health
  // probe to show the "local build" badge. A daemon predating the field omits
  // it, so this stays false.
  let isDev = $state(false);
  // The running build's version + commit (EXC-561), read once from the same
  // health probe to feed the VersionBadge in the status bar. Undefined until the probe
  // lands (or for a daemon predating the fields); the badge self-gates on
  // `version` and degrades when `commit` is absent.
  let version = $state<string | undefined>(undefined);
  let commit = $state<string | undefined>(undefined);
  // The active adapter's id (EXC-791), read once from the health probe — the
  // environment the UI adapts to (e.g. an OpenCode session). Undefined until the
  // probe lands or for a daemon that predates the field; passed to the TopBar,
  // which exposes it as data-source.
  let source = $state<string | undefined>(undefined);
  let work = $state<{
    annotations: Annotation[];
    generalCommentDraft: string;
    composerScratches: PersistedScratch[];
    focusedAnnotation: string | null;
  }>({ annotations: [], generalCommentDraft: "", composerScratches: [], focusedAnnotation: null });

  let showDialog = $state(false);
  // Whether the keyboard shortcuts help modal is open (EXC-787). Toggled by the
  // ? key (registered below) and opened by the status bar's keyboard button.
  let showHelp = $state(false);
  // Whether the comment navigator is open (toggled by the status strip's comment
  // tally). The reveal action DiffPlanView hands up on mount, used to scroll the
  // plan to a navigated comment's line; undefined until the source view paints.
  let showComments = $state(false);
  let revealLine = $state<((line: number) => void) | undefined>();
  // The approve variant a pending-comment guard is holding: the mode the reviewer
  // chose, parked until they confirm or divert. Null = no guard open.
  let pendingApproveMode = $state<ApproveVariantId | null>(null);
  // The reject guard (EXC-685): true while a Reject is parked on a pending-
  // comment confirmation, mirroring pendingApproveMode. False = no guard open.
  let pendingReject = $state(false);
  let safeMode = $state(false);

  // Theme (EXC-730, EXC-773). main.ts paints the saved appearance before mount;
  // this mirrors the RESOLVED theme id — mode + the light/dark slots + the OS
  // preference — so the picked palette reaches the diff view, which renders into a
  // shadow root and can't read it off the chrome. Editing any of the three
  // appearance settings applies immediately (the registry field's write persists
  // then wipes); applySetting resyncs themeId so the reactive reads follow.
  let themeId = $state<ThemeId>(currentThemeId());
  let showSettings = $state(false);
  // First-run onboarding (EXC-781): opens once for a brand-new user whose
  // notification permission is still undecided. Guarded on Notification support
  // so a browser without the API never shows a modal that can't enable anything.
  // The dev --fresh boot re-evaluates this after clearing prefs (health handler).
  let showOnboarding = $state(
    typeof Notification !== "undefined" && shouldShowOnboarding(Notification.permission),
  );
  // Shortcut-hint affordances (EXC-826). App owns the reactive flag and threads it
  // to the surfaces that show discoverability chrome (the TopBar key-cap hints, the
  // status-bar keyboard button, the V-mode chip); applySetting resyncs it after a
  // Settings edit so flipping it applies in place. The ? help modal stays reachable
  // by keyboard regardless.
  let showShortcutHints = $state(readShortcutHints());

  // Settings apply immediately (EXC-843). The two-pane Settings dialog calls this the
  // moment a control changes: it persists + applies through the registry field's
  // write(), resyncs the reactive mirrors other surfaces read — themeId (the diff-view
  // scheme) and showShortcutHints (the hint chrome) — then confirms with a toast. A
  // failed write raises a PERSISTENT error toast the user must read and dismiss.
  //
  // settingsRev bumps on every applied change; DiffPlanView watches it to re-read the
  // diff-layout/marker prefs into its compare store so an open diff reflows live too
  // (those prefs live in the view's own store, not a mirror App can resync).
  let settingsRev = $state(0);
  function applySetting(field: StagedField, value: unknown) {
    try {
      field.write(value);
    } catch (err) {
      // ponytail: the hint is the write's own message — localStorage prefs can't fail
      // today, but a future daemon-backed setting throws a helpful one (e.g. "Start
      // the caret daemon to change this"). Persistent so a failure isn't missed.
      const hint =
        err instanceof Error && err.message ? err.message : "The change wasn't saved.";
      alerts.push({
        variant: "destructive",
        title: `Couldn't save ${field.label.toLowerCase()}`,
        message: hint,
        persistent: true,
      });
      return;
    }
    themeId = currentThemeId();
    showShortcutHints = readShortcutHints();
    settingsRev++;
    alerts.push({ variant: "success", message: `${field.label} updated` });
  }

  // The unsent-scratch controller lives here (EXC-877): App owns createSourceCommenting
  // (created below, once `autosave` exists) and injects it down into both consumers —
  // DiffPlanView, which renders the composer + Resume markers and drives
  // open/submit/cancel/resume, and the Request Changes dialog, which Saves/Discards/
  // demotes scratches. These three runes mirror the controller's non-reactive reads so
  // both consumers re-render on every change; the factory's onChange writes them.
  let pending = $state<{ startLine: number; endLine: number } | undefined>();
  let pendingText = $state("");
  let scratches = $state<ComposerScratch[]>([]);

  // ----- State modules -----
  const selection = createReviewSelection(selStore);
  const autosave = createAutosave(work, () => selection.activeId, {
    onOffline: () => selection.setConnected(false),
  });
  // The scratch controller, injected into DiffPlanView + RequestChangesDialog (EXC-877).
  // onCreate graduates a submitted composer draft straight into the autosaved annotation
  // set; onChange mirrors the controller's non-reactive reads into the three runes above.
  const commenting = createSourceCommenting({
    onCreate: autosave.createLineAnnotation,
    onChange: () => {
      pending = commenting.pending();
      pendingText = commenting.pendingText();
      scratches = commenting.scratches();
    },
  });
  // Persist the retained scratches through autosave in a scheduled $effect rather than
  // synchronously inside onChange, so the write is never re-entrant with the controller
  // callback that produced it (e.g. DiffPlanView's contentKey reseed, whose onChange
  // would otherwise write host state mid-flush). setScratches' scratchesEqual guard
  // absorbs the seed echo, so a reseed of the just-served set schedules no redundant PUT.
  $effect(() => {
    autosave.setScratches(scratches);
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
  // EXC-427 desktop-plan notifier. Component-scoped so both consumers — the poll
  // (observe) and the EXC-815 dismiss-on-open effect below — share one instance.
  const notifier = createPlanNotifier({ onSelect: selection.selectReview });
  const alerts = createAlerts(alertStore);
  let active = $derived(selection.active);
  // The variants the split-button renders: the declared set when present, else
  // the built-in fallback.
  let variants = $derived(approveVariants(declaredVariants));
  // Everything a plain Approve would silently leave behind, as a preview list:
  // the general-comment draft first, then the non-blank committed inline comments,
  // then the retained-but-unsent composer scratches. The approve/reject guard
  // renders this list so the reviewer sees what's at stake; the TopBar badge and
  // status strip read its length. Deriving pendingCount from the same list keeps
  // every surface in agreement about what's pending — an uncommitted scratch
  // (EXC-745) and a lone general-comment draft (EXC-742) are both now protected on
  // Approve exactly like a committed comment.
  let guardItems = $derived(pendingItems(work.annotations, work.generalCommentDraft, scratches));
  let pendingCount = $derived(guardItems.length);
  // Distinct source lines the pending line-anchored comments cover (union of
  // ranges), for the status strip's at-a-glance "N comments · M lines" readout.
  let coveredLines = $derived(coveredLineCount(work.annotations));
  // The plan's inline comments + unsent drafts as a navigable, searchable index for
  // the comment navigator — committed line-anchored comments plus the retained
  // composer scratches (flagged draft), in document order.
  let comments = $derived(commentIndex(work.annotations, scratches));

  // Reveal a comment from the navigator: focus it (the source view highlights the
  // card in amber and expands it) and scroll the plan to its line.
  function revealComment(entry: CommentIndexEntry) {
    autosave.focusAnnotation(entry.id);
    revealLine?.(entry.line);
  }

  // ----- Working-copy reload -----
  // When the active review (or its version) changes — whether from a selection
  // or the 2s poll bumping the active review to a new version — reconcile the
  // working copy. `active` is the derived dependency.
  $effect(() => {
    autosave.syncActive(active);
  });

  // ----- OS appearance -----
  // Follow the system light/dark flip (EXC-773). No reactive reads: runs once on
  // mount, returns the disposer. changeAppearance re-resolves against the fresh OS
  // preference, so under a manual mode it re-paints the same theme (a harmless
  // no-op) and only `system` actually changes — one call, no mode branch here. It
  // wipes like an in-app switch, so the sweep explains the change if the reviewer
  // is watching.
  $effect(() => {
    return watchSystemScheme(() => {
      changeAppearance();
      themeId = currentThemeId();
    });
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
        version = h.version;
        commit = h.commit;
        source = h.source;
        // Dev --fresh (EXC-781): reset the browser to a brand-new-user session —
        // clear saved UI prefs, fall back to the default appearance (main.ts already
        // painted whatever was stored before this probe resolved, so re-paint here —
        // instantly, since a reset isn't a switch the user made), and re-open
        // first-run onboarding. Once per daemon boot only (keyed on
        // instanceId): the daemon reports fresh on every /api/health for its whole
        // life, so without this guard each reload would re-clear the onboarded flag
        // and "Maybe later" would never stick.
        if (h.fresh && !freshResetApplied(h.instanceId)) {
          clearKnownPrefs();
          applyAppearance();
          themeId = currentThemeId();
          showShortcutHints = readShortcutHints();
          showOnboarding =
            typeof Notification !== "undefined" && shouldShowOnboarding(Notification.permission);
          markFreshResetApplied(h.instanceId);
        }
      })
      .catch(() => selection.setConnected(false));

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

  // ----- Dismiss plan notifications once the user is back in caret (EXC-815) -----
  // Toasts fire only while the user is away; the moment they return — focus the
  // window or the tab becomes visible — every one is redundant (the bell and
  // switcher show these plans), so close them all. The presence gate lives in
  // notifier.dismissAllIfPresent(): mergeReviews auto-selects while away, so a
  // toast the away user never saw must never be closed out from under them.
  // isAway() is not reactive, hence the focus/visibility listeners; this effect
  // reads no reactive state, so it runs once and keeps its listeners for the
  // component's life.
  $effect(() => {
    const dismiss = () => notifier.dismissAllIfPresent();
    dismiss();
    window.addEventListener("focus", dismiss);
    document.addEventListener("visibilitychange", dismiss);
    return () => {
      window.removeEventListener("focus", dismiss);
      document.removeEventListener("visibilitychange", dismiss);
    };
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

  // ----- Keyboard shortcuts (EXC-786) -----
  // Stand up the global shortcut dispatcher on window and register the existing
  // editor chords as read-only entries — they surface in the help modal while
  // the composer keeps owning ⌘/Ctrl+Enter and Esc on focus. Mount-once: reads
  // no reactive state, returns its teardown. Downstream tickets register their
  // own shortcuts into the same `shortcuts` singleton.
  $effect(() => {
    const unregister = EDITOR_SHORTCUTS.map((entry) => shortcuts.register(entry));
    // A live binding = EXC-786's reservation (bind spreads key/label/group/cap/scope
    // from CANONICAL_KEYMAP) + the caller's run/enabled, registered into the shared
    // singleton. `reg` is the local wrapper over bind + register so each binding is a
    // single call (EXC-876).
    const reg = (id: string, opts: Parameters<typeof bind>[1]) => shortcuts.register(bind(id, opts));
    // The ? key toggles the shortcuts help modal (EXC-787). help.show carries scope:
    // "global" in the table (EXC-849), so binding it lets ? fire from every view —
    // including over the Settings modal, where the review shortcuts are suppressed. The
    // key and its global scope come from the reservation.
    const unregisterHelp = reg("help.show", {
      run: () => {
        showHelp = !showHelp;
      },
    });
    // The review-verdict + chrome shortcuts (EXC-789). Each binds EXC-786's canonical
    // reservation and adds the live run + enabled here, routing through the SAME guarded
    // path as its TopBar button — `a` is never a raw approve, always onApprove's
    // unsent-comments guard. The two verdict actions gate on an active, not-busy review
    // (matching the buttons' disabled state); Settings is persistent chrome (EXC-730),
    // reachable with no review. Shift+C toggles the comment navigator (EXC-792), gated on
    // an active review like the status-strip tally that also toggles it.
    const canAct = () => active != null && !resolve.busy;
    const unregisterActions = [
      reg("actions.approve", { run: () => onApprove(resolve.approveMode), enabled: canAct }),
      reg("actions.requestChanges", {
        run: () => {
          showDialog = true;
        },
        enabled: canAct,
      }),
      reg("actions.settings", {
        run: () => {
          showSettings = true;
        },
      }),
      reg("actions.toggleComments", {
        run: () => {
          showComments = !showComments;
        },
        enabled: () => active != null,
      }),
    ];
    const dispatcher = createShortcutDispatcher({
      target: window,
      registry: shortcuts,
      // The open comment navigator owns the keyboard while it holds focus
      // (EXC-792) — like a text field or the composer — so plan motion (j/k) and
      // the verdict keys don't fire while the reviewer walks the comment list.
      isEditingContext: () =>
        defaultIsEditingContext() || document.activeElement?.closest("#comment-navigator") != null,
      // While the Settings modal owns the view, the review shortcuts are inert
      // (EXC-849) — only the settings-scoped entries and the globals (?) fire.
      activeScope: () => (showSettings ? "settings" : null),
    });
    return () => {
      for (const off of unregister) off();
      unregisterHelp();
      for (const off of unregisterActions) off();
      dispatcher.destroy();
    };
  });

  // ----- Tab-close presence retraction (EXC-562) -----
  // Tell the daemon when this tab is closing so it stops counting us as a live
  // client. Without it the daemon leans on the throttled 2s reviews poll, and a
  // backgrounded-but-open tab would still get a redundant new tab on the next
  // plan. Mount-once: reads no reactive state, returns its teardown.
  $effect(() => installUiGoneBeacon({ target: window }));

  function onApprove(mode: ApproveVariantId) {
    // Approve always routes through a confirmation (EXC-791): even with nothing
    // queued, a stray click must not ship the plan. Park the chosen mode; the
    // guard (UnsentCommentsDialog) additionally previews any pending comments a
    // plain approve would drop.
    pendingApproveMode = mode;
  }
  function approveAnyway(notes: string) {
    // `notes` is the optional reviewer note from the confirm dialog (EXC-791); it
    // rides the allow as feedback and reaches the agent. resolve.approve omits a
    // blank note.
    const mode = pendingApproveMode;
    pendingApproveMode = null;
    if (mode) void resolve.approve(mode, notes);
  }
  function onReject() {
    // Reject always confirms (EXC-685): consistent whether or not comments are
    // queued. The dialog additionally guards unsent comments when present.
    pendingReject = true;
  }
  function rejectAnyway() {
    pendingReject = false;
    void resolve.reject();
  }
  function divertToRequestChanges() {
    // The annotations + general-comment draft are App.svelte's autosaved state,
    // so they survive the hand-off to the request-changes dialog untouched.
    // Shared by both guards (approve + reject), so clear both.
    pendingApproveMode = null;
    pendingReject = false;
    showDialog = true;
  }
  function onRequestChanges(generalComment: string) {
    showDialog = false;
    void resolve.requestChanges(generalComment);
  }
  // Copy the active review's working directory (EXC-850). The write is optimistic
  // — the Clipboard API rejects in insecure contexts, where the path is still on
  // screen to copy by hand — and the success alert reflects the click intent.
  function onCopyCwd(cwd: string) {
    void navigator.clipboard?.writeText(cwd).catch(() => {});
    alerts.push({ variant: "success", message: "Copied path to clipboard" });
  }
  // Copy a diagnostics block from the Settings Advanced pane (EXC-848). Same
  // optimistic pattern as onCopyCwd: the write may reject in an insecure context
  // (the block text is still on screen), and the success alert reflects the click.
  function copyDiagnostics(text: string) {
    void navigator.clipboard?.writeText(text).catch(() => {});
    alerts.push({ variant: "success", message: "Copied diagnostics to clipboard" });
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
    {source}
    {pendingCount}
    onSelect={selection.selectReview}
    {onApprove}
    onRequestChanges={() => (showDialog = true)}
    {onReject}
    onOpenSettings={() => (showSettings = true)}
    {showShortcutHints}
  />

  {#if selection.daemonChanged}
    <!-- shadcn Alert as the semantic role="alert" container, molded to a
         full-width top strip (see .daemon-banner in the style block). -->
    <Alert.Root class="daemon-banner">
      <p class="db-text">The caret daemon was replaced — reload to resync.</p>
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
    </Alert.Root>
  {/if}

  {#if active}
    <!-- The plan rendered as line-numbered markdown source with a left-hand
         filterable contents pane and a line gutter for creating comments. -->
    <DiffPlanView
      review={active}
      {themeId}
      {commenting}
      {pending}
      {pendingText}
      {scratches}
      annotations={autosave.annotations}
      focusedAnnotation={autosave.focusedAnnotation}
      onEditAnnotation={autosave.editAnnotation}
      onDeleteAnnotation={autosave.deleteAnnotation}
      onFocusAnnotation={autosave.focusAnnotation}
      onExposeReveal={(r) => (revealLine = r)}
      {onCopyCwd}
      {showShortcutHints}
      {settingsRev}
    />
  {:else}
    <EmptyState connected={selection.connected} />
  {/if}

  <!-- The bottom status bar (EXC-787): the row-4 grid child consolidating the
       build/version badge (left), the plan-review status (right, when active),
       and the keyboard ? affordance (far right). A grid child, so it reserves
       space at the bottom; the CommentNavigator docks just above it. -->
  <StatusBar
    {version}
    {commit}
    {isDev}
    active={active !== null}
    {pendingCount}
    {coveredLines}
    reviewVersion={active?.version ?? 1}
    connected={selection.connected}
    commentsOpen={showComments}
    onToggleComments={() => (showComments = !showComments)}
    onOpenHelp={() => (showHelp = true)}
    {showShortcutHints}
  />
</div>

<!-- The comment navigator: a searchable index of the plan's inline comments,
     docked above the bottom status bar. A root sibling of .shell, gated on an
     active review; its toggle is the bar's comment tally. Reveals a comment by
     focusing it (the source view highlights + expands the card) and scrolling
     the plan to its line. -->
<CommentNavigator
  open={active !== null && showComments}
  {comments}
  activeId={autosave.focusedAnnotation}
  onReveal={revealComment}
  onClose={() => (showComments = false)}
  {showShortcutHints}
/>

{#if pendingApproveMode !== null && active}
  <UnsentCommentsDialog
    items={guardItems}
    action="Approve"
    consequence="Approving accepts the plan and starts the agent's work."
    icon="check"
    kind="dialog"
    showNotes
    onConfirm={approveAnyway}
    onRequestChanges={divertToRequestChanges}
    onCancel={() => (pendingApproveMode = null)}
  />
{/if}

{#if pendingReject && active}
  <UnsentCommentsDialog
    items={guardItems}
    action="Reject"
    consequence="The agent will be told the plan was rejected and to wait for your next message."
    onConfirm={rejectAnyway}
    onRequestChanges={divertToRequestChanges}
    onCancel={() => (pendingReject = false)}
  />
{/if}

{#if showDialog && active}
  <RequestChangesDialog
    annotations={autosave.annotations}
    generalComment={autosave.generalCommentDraft}
    planText={active.currentPlan}
    {scratches}
    onGeneralCommentInput={autosave.editGeneralComment}
    onSubmit={onRequestChanges}
    onSaveScratch={(key) => commenting.save(key)}
    onDiscardScratch={(key) => commenting.discard(key)}
    onDiscardAnnotation={(id) => autosave.deleteAnnotation(id)}
    onDraftAnnotation={(a) => {
      // "Mark as draft": demote a committed line comment into the unsent-scratch
      // section — drop the annotation and insert a scratch at its range, so it can
      // be Saved back or Discarded like any other unsent draft (EXC-762).
      autosave.deleteAnnotation(a.id);
      commenting.draft({ startLine: a.startLine, endLine: a.endLine, text: a.comment });
    }}
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

<!-- The in-UI alert/toast stack (EXC-850): pinned bottom-right above the status
     bar, rendering App's alert queue. A root sibling, like the safe-mode toast. -->
<AlertHost alerts={alertStore.alerts} onDismiss={alerts.dismiss} />

<!-- Settings is persistent chrome (theme switching), reachable whether or not a
     review is active — so it renders at the top level, ungated on `active`. -->
{#if showSettings}
  <SettingsDialog
    entries={SETTINGS_REGISTRY}
    onChange={applySetting}
    onClose={() => (showSettings = false)}
    onCopyDiagnostic={copyDiagnostics}
  />
{/if}

<!-- First-run onboarding: a one-time invite to enable desktop notifications,
     gated on a brand-new user (see showOnboarding above). -->
{#if showOnboarding}
  <OnboardingDialog onClose={() => (showOnboarding = false)} />
{/if}

<!-- Keyboard shortcuts help (EXC-787): the ? key toggles it, the status bar's
     keyboard button opens it. Reads the live registry (shortcuts.list()) at open,
     so it grows as later tickets register — then narrowed (EXC-849) to the shortcuts
     valid in the current view: over Settings it lists only the settings + global
     shortcuts, matching what the dispatcher will actually fire. -->
{#if showHelp}
  <ShortcutsHelp
    entries={scopedShortcuts(shortcuts.list(), showSettings ? "settings" : null)}
    onClose={() => (showHelp = false)}
  />
{/if}

<style>
  /* Pin the shell's direct children to their grid rows (app.css declares
     `auto auto 1fr auto`): TopBar, the optional banner, content, then the bottom
     status bar. Explicit placement keeps content on the 1fr row whether or not
     the banner is present — without it, an absent banner would let content drift
     off 1fr. `:global` because these children render their own roots. */
  .shell > :global(.topbar) {
    grid-row: 1;
  }
  .shell > :global(.diff-plan),
  .shell > :global(.empty) {
    grid-row: 3;
  }
  .shell > :global(.status-bar) {
    grid-row: 4;
  }

  /* Persistent, dismissible banner shown when the daemon behind the port was
     replaced (its instanceId flipped). Alert.Root carries only the semantic
     role="alert" here; the rest re-shapes its card default into a full-width top
     strip that consumes grid row 2 and pushes the content down rather than
     overlaying it, so it can't be mistaken for a transient toast. The accent left
     rule signals urgency without an icon (icon-rules: an icon must earn its place;
     a one-line message doesn't need one). Reached with :global because the class
     rides the Alert child component (no scope hash); the overrides win because
     this scoped component CSS is unlayered and Tailwind's utilities are layered —
     unlayered always beats layered. */
  .shell > :global(.daemon-banner) {
    grid-row: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.6rem clamp(1rem, 3vw, 2rem);
    background: var(--accent-wash);
    color: var(--ink);
    border: 0;
    border-bottom: 1px solid var(--rule-strong);
    border-left: 3px solid var(--accent);
    border-radius: 0;
    font-size: var(--text-base);
    animation: daemon-banner-in var(--dur-base) var(--ease-out);
  }
  .db-text {
    margin: 0;
    min-width: 0;
    line-height: var(--leading-tight);
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
    font-size: var(--text-sm);
    cursor: pointer;
    border-radius: var(--radius);
    padding: 0.3rem 0.7rem;
    transition: background var(--dur-fast) var(--ease-out);
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
    font-size: var(--text-base);
    animation: safe-mode-in var(--dur-base) var(--ease-out);
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
    line-height: var(--leading-tight);
  }
  .sm-text strong {
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  .sm-text span {
    color: var(--ink-soft);
    font-size: var(--text-xs);
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
</style>
