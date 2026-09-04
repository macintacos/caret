<script lang="ts">
  // The app shell: the composition root that wires caret's state factories to the
  // review surface. It runs the /api/health probe (version, commit, isDev,
  // source), drives review selection + polling, autosave, and resolve
  // (approve variants / reject / request changes), and owns the top-level dialogs
  // — request-changes, settings, onboarding, and the unsent-comments guard — plus
  // theme, safe mode, the keyboard-shortcut dispatcher, and the UI-gone presence
  // beacon. The behaviors themselves live in $lib/* and @/state/*; this file only
  // holds them together and lays out the TopBar + DiffPlanView.
  import { untrack } from "svelte";
  import { getHealth, getUpdate, markSeen } from "$lib/api.ts";
  import { approveVariants } from "$lib/approve.ts";
  import { createPlanNotifier } from "$lib/notify.ts";
  import { installUiGoneBeacon } from "$lib/presence.ts";
  import { createSafeModeGuard } from "$lib/safeMode.ts";
  import { createSeenWatcher } from "$lib/seen.ts";
  import {
    bind,
    createShortcutDispatcher,
    defaultIsEditingContext,
    EDITOR_SHORTCUTS,
    scopedShortcuts,
    shortcuts,
  } from "$lib/shortcuts/index.ts";
  import { sound } from "$lib/sound.ts";
  import { type AlertStore, createAlerts } from "@/state/alerts.ts";
  import { appearance } from "@/state/appearance.svelte.ts";
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
    versionCommentIndex,
  } from "$lib/feedback.ts";
  import {
    clearKnownPrefs,
    freshResetApplied,
    markFreshResetApplied,
    shouldShowOnboarding,
  } from "$lib/prefs.ts";
  import { readShortcutHints } from "$lib/shortcutHintsPref.ts";
  import {
    SETTINGS_REGISTRY,
    type StagedField,
    THEME_KEYS,
    UPDATES_CATEGORY,
    UPDATES_CHECK_KEY,
  } from "$lib/settingsRegistry.ts";
  import { isUpdatePending, updateSignature, updateToast } from "$lib/updates.ts";
  import { readToastedUpdate, seedUpdatesCheck, writeToastedUpdate } from "$lib/updatesPref.ts";
  import { type ComposerScratch, createSourceCommenting } from "$lib/diffview/commenting.ts";
  import type { DiffSide } from "$lib/diffview/types.ts";
  import type {
    ApproveVariant,
    ApproveVariantId,
    Annotation,
    PersistedScratch,
    UpdateReport,
  } from "@core/lib/types";

  import * as Alert from "$lib/components/ui/alert/index.js";
  import AlertHost from "@/components/AlertHost.svelte";
  import UnsentCommentsDialog from "@/components/UnsentCommentsDialog.svelte";
  import CommentNavigator from "@/components/CommentNavigator.svelte";
  import DiffPlanView from "@/components/DiffPlanView.svelte";
  import EmptyState from "@/components/EmptyState.svelte";
  import ModalPresence from "@/components/ModalPresence.svelte";
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
    unread: [],
    arrivals: 0,
  });
  let resStore = $state<ResolveStore>({ approveMode: "default", busy: false });
  // The in-UI alert/toast queue (EXC-850): App owns the reactive backing store,
  // createAlerts (below) mutates it, and AlertHost renders it bottom-right.
  let alertStore = $state<AlertStore>({ alerts: [] });
  // The adapter's declared approve variants, read once from the health probe.
  // Undefined until it lands, or for a daemon predating the field; approveVariants()
  // then falls back to the built-in set.
  let declaredVariants = $state<ApproveVariant[] | undefined>(undefined);
  // True when the daemon runs from source (EXC-556), for the "local build" badge. A
  // daemon predating the field omits it, so this stays false.
  let isDev = $state(false);
  // The running build's version + commit (EXC-561), for the status bar's
  // VersionBadge, which self-gates on `version` and degrades without `commit`.
  let version = $state<string | undefined>(undefined);
  let commit = $state<string | undefined>(undefined);
  // The active adapter's id (EXC-791) — the environment the UI adapts to (e.g. an
  // OpenCode session). Undefined until the probe lands, or for a daemon predating it.
  let source = $state<string | undefined>(undefined);
  // The daemon's update verdict (EXC-1207), read on load and re-read after the
  // Updates toggle lands. Null when it can't be read — a daemon that wires no update
  // thunk 404s the route — and every surface then stays quiet. The `updates.check`
  // opt-out is folded in daemon-side (EXC-1210), so this is their whole truth.
  let updateReport = $state<UpdateReport | null>(null);
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
  let revealLine = $state<((line: number, side?: DiffSide) => void) | undefined>();
  // The approve variant a pending-comment guard is holding: the mode the reviewer
  // chose, parked until they confirm or divert. Null = no guard open.
  let pendingApproveMode = $state<ApproveVariantId | null>(null);
  // The reject guard (EXC-685): true while a Reject is parked on a pending-
  // comment confirmation, mirroring pendingApproveMode. False = no guard open.
  let pendingReject = $state(false);
  let safeMode = $state(false);

  let showSettings = $state(false);
  // Which category Settings opens on (EXC-1207) — set only by the update toast's deep
  // link; undefined lands on Appearance. ModalPresence mounts SettingsDialog per open,
  // so recording it before showing is what makes the seed apply.
  let settingsCategory = $state<string | undefined>(undefined);
  // The two surfaces the reviewer summons over a plan announce themselves on the way
  // in only. The verdict dialogs sit this out — they belong to the decision flow,
  // which sounds through its own verdict cue.
  function openSettings(category?: string): void {
    sound.play("modalOpen");
    settingsCategory = category;
    showSettings = true;
  }
  function openHelp(): void {
    sound.play("modalOpen");
    showHelp = true;
  }
  // One writer, so every route to the panel sounds the same (EXC-1126). On the flip
  // only, the guard setComparing and setConnected use for the same reason.
  function setComments(visible: boolean): void {
    if (visible !== showComments) sound.play("commentsToggled");
    showComments = visible;
  }
  function toggleComments(): void {
    setComments(!showComments);
  }
  // First-run onboarding (EXC-781): opens once for a brand-new user whose
  // notification permission is still undecided. Guarded on Notification support
  // so a browser without the API never shows a modal that can't enable anything.
  // The dev --fresh boot re-evaluates this after clearing prefs (health handler).
  let showOnboarding = $state(
    typeof Notification !== "undefined" && shouldShowOnboarding(Notification.permission),
  );
  // Shortcut-hint affordances (EXC-826), threaded to every surface showing
  // discoverability chrome; applySetting resyncs it so a Settings edit applies in
  // place. The ? help modal stays reachable by keyboard regardless.
  let showShortcutHints = $state(readShortcutHints());

  // Settings apply immediately (EXC-843): Settings calls this the moment a control
  // changes. Only showShortcutHints needs a resync — the appearance fields command
  // the appearance module, which every surface reads live.
  //
  // settingsRev bumps on every applied change; DiffPlanView watches it to re-read the
  // diff-layout/marker prefs into its compare store, which App cannot resync because
  // those prefs live in the view's own store.
  let settingsRev = $state(0);
  async function applySetting(field: StagedField, value: unknown) {
    try {
      // Awaited: a daemon-backed field's write is a POST (EXC-1206), and a rejected
      // promise is the only way it can report a refusal. The Settings shell awaits
      // this in turn, so a failure re-reads the field and snaps the control back.
      await field.write(value);
    } catch (err) {
      // The write's own message: a daemon-backed field says why in a sentence, and a
      // localStorage pref cannot fail at all. Persistent so it isn't missed.
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
    showShortcutHints = readShortcutHints();
    // The daemon folds this switch into the verdict it serves (EXC-1210), so re-reading
    // the route is what clears the badges the instant the check is turned off.
    if (field.key === UPDATES_CHECK_KEY) {
      // Keep the last known verdict when the re-read fails: null is the pane's "could not
      // be read" signal, so blanking it here would empty the Updates pane at the same
      // instant the success toast says the write landed.
      const fresh = await getUpdate().catch(() => null);
      if (fresh) updateReport = fresh;
    }
    settingsRev++;
    alerts.push({
      variant: "success",
      message: `${field.label} updated`,
      // A theme change is the one settings edit with a sound of its own; the rest
      // take the success toast's. Either way the edit is heard exactly once.
      sound: THEME_KEYS.includes(field.key) ? "themeSwitch" : undefined,
    });
  }

  // The unsent-scratch controller lives here (EXC-877) because both DiffPlanView and
  // the Request Changes dialog consume it. These three runes mirror the controller's
  // non-reactive reads so both re-render on every change; its onChange writes them.
  let pending = $state<{ startLine: number; endLine: number } | undefined>();
  let pendingText = $state("");
  let scratches = $state<ComposerScratch[]>([]);

  // ----- State modules -----
  const selection = createReviewSelection(selStore, { onSound: sound.play });
  // The reviewer picking another plan, which selectReview alone is not: that is also
  // the funnel for a deep link, a re-select and an auto-advance. The notifier's click
  // sits out too — the plan it jumps to already sounded its own arrival. Only on a
  // real move, since the switcher lists the active plan as a pickable row.
  function switchPlan(id: string): void {
    if (id !== selection.activeId) sound.play("planSwitched");
    selection.selectReview(id);
  }
  const autosave = createAutosave(work, () => selection.activeId, {
    onOffline: () => selection.setConnected(false),
  });
  // The scratch controller, injected into DiffPlanView + RequestChangesDialog (EXC-877).
  // onCreate graduates a submitted composer draft straight into the autosaved annotation
  // set; onChange mirrors the controller's non-reactive reads into the three runes above.
  const commenting = createSourceCommenting({
    onCreate: (anchor) => {
      autosave.createLineAnnotation(anchor);
      sound.play("annotationPosted");
    },
    onChange: () => {
      pending = commenting.pending();
      pendingText = commenting.pendingText();
      scratches = commenting.scratches();
    },
    sound: sound.play,
  });
  // A scheduled $effect rather than a synchronous write inside onChange, so the write
  // is never re-entrant with the callback that produced it (DiffPlanView's contentKey
  // reseed would otherwise write host state mid-flush).
  $effect(() => {
    autosave.setScratches(scratches);
  });
  const resolve = createResolve(resStore, {
    activeId: () => selection.activeId,
    annotations: () => work.annotations,
    planText: () => active?.currentPlan ?? "",
    flushPending: () => autosave.flushPending(),
    afterResolve: (id) => selection.afterResolve(id),
    onOffline: () => {
      selection.setConnected(false);
      // Fires only on a genuine network failure, since a daemon non-2xx still advances
      // — so this is exactly the case the optimistic confirmations below get wrong.
      // Nothing advanced and the plan is still on screen; the persistent alert is what
      // keeps a failed decision from reading as a landed one.
      alerts.push({
        variant: "destructive",
        title: "Couldn't send the decision",
        message: "caret can't reach the daemon. Make sure it's running, then send it again.",
        persistent: true,
      });
    },
    clearGeneralComment: () => autosave.clearGeneralComment(),
  });
  // EXC-427 desktop-plan notifier. Component-scoped so both consumers — the poll
  // (observe) and the EXC-815 dismiss-on-open effect below — share one instance.
  const notifier = createPlanNotifier({ onSelect: selection.selectReview });
  // EXC-961 read detection: a plan submitted from a cmux pane leaves that pane
  // unread, and reading it here is enough to clear the mark — no decision
  // required. Component-scoped like the notifier: the track effect below feeds
  // it, and the effect after that owns its teardown.
  const seenWatcher = createSeenWatcher({
    onSeen: (id) => void markSeen(id),
    target: window,
    doc: document,
  });
  const alerts = createAlerts(alertStore, { sound: sound.play });
  let active = $derived(selection.active);
  // What every feedback editor needs to resolve a reference: the review it belongs
  // to, the working directory a file lookup roots at, and the adapter a skill
  // lookup is scoped to. Assembled here because only App holds all three — the
  // adapter id arrives on the health probe, not on the review record.
  let reviewContext = $derived(
    active ? { reviewId: active.id, cwd: active.cwd, adapter: source } : undefined,
  );
  let variants = $derived(approveVariants(declaredVariants));
  // Whether to mark the update surfaces (EXC-1207). The daemon's verdict alone: an
  // opted-out reviewer is served `disabled`, which is not pending.
  let updatePending = $derived(!!updateReport && isUpdatePending(updateReport.status));
  // Everything a plain Approve would silently leave behind, as a preview list the
  // approve/reject guard renders. Deriving pendingCount from the same list keeps
  // every surface agreeing on what's pending — an uncommitted scratch (EXC-745) and a
  // lone general-comment draft (EXC-742) are protected exactly like a committed one.
  let guardItems = $derived(pendingItems(work.annotations, work.generalCommentDraft, scratches));
  let pendingCount = $derived(guardItems.length);
  // Distinct source lines the pending line-anchored comments cover (union of
  // ranges), for the status strip's at-a-glance "N comments · M lines" readout.
  let coveredLines = $derived(coveredLineCount(work.annotations));
  // Reported upward by DiffPlanView, which owns compare state (EXC-872), because the
  // navigator is a root sibling of .shell rather than a child of the view. Ordered as
  // the diff renders them (before = the old document), not sorted, so the panel can
  // tell which side a comment jumps to.
  let compareRange = $state<{ before: number; after: number } | null>(null);
  // The navigator's index: committed comments plus retained scratches (flagged
  // draft), in document order. While comparing it lists every version in the compared
  // range instead, each badged with its source version; drafts are single-version.
  let comments = $derived(
    compareRange && active
      ? versionCommentIndex(
          // The current version's comments live in the working copy until the
          // debounced save and the next poll land, so the served version carries
          // a stale set; older versions are server-only and already settled.
          active.versions.map((v) =>
            v.version === active.version ? { ...v, annotations: work.annotations } : v,
          ),
          compareRange.before,
          compareRange.after,
        )
      : commentIndex(work.annotations, scratches),
  );

  // The panel's heading. While comparing it names the compared span low-to-high,
  // whichever way round the reviewer picked the pair.
  let commentsTitle = $derived(
    compareRange
      ? `Comments in v${Math.min(compareRange.before, compareRange.after)}–v${Math.max(compareRange.before, compareRange.after)}`
      : "Comments",
  );

  // A row the index marked unlinkable has nothing on screen to scroll to, so it does
  // neither. Focusing is single-version only: a compare entry's id carries a `v3:`
  // prefix that matches no card, so it would strand a bogus id in the working copy.
  function revealComment(entry: CommentIndexEntry) {
    if (!entry.linkable || entry.line == null) return;
    if (compareRange === null) autosave.focusAnnotation(entry.id);
    revealLine?.(entry.line, entry.side);
  }

  // ----- Working-copy reload -----
  // When the active review (or its version) changes — whether from a selection
  // or the 2s poll bumping the active review to a new version — reconcile the
  // working copy. `active` is the derived dependency.
  $effect(() => {
    autosave.syncActive(active);
  });

  // ----- OS appearance -----
  // Follow the system light/dark flip (EXC-773); the appearance module owns the one
  // subscription and stays silent under a pinned mode. No reactive reads: runs once on
  // mount, returns the disposer.
  $effect(() => appearance.watch());

  // ----- Update verdict -----
  // Read the daemon's verdict once on mount. No network check is triggered by the UI:
  // the daemon decided this against its own cache and the route only reports it. A
  // failed read is quiet — the report stays null and every surface says nothing.
  $effect(() => {
    void getUpdate()
      .catch(() => null)
      .then((report) => {
        // Seed the holder the Updates toggle's synchronous read() closes over, so the
        // control opens showing what is actually on disk rather than the default.
        if (report) seedUpdatesCheck(report.checkEnabled);
        updateReport = report;
      });
  });

  // The once-per-version nudge, fired only when this browser has not already toasted
  // THIS signature. Persistent, because it can fire at most once per version so it
  // cannot nag; silent, because a page load should not chime.
  //
  // `toasted` is a plain local, not the stored marker, and it is what keeps this effect
  // from re-entering: the stored marker is allowed to fail, and with storage blocked
  // `readToastedUpdate()` keeps answering null, so the guard would never hold and the
  // effect would push, invalidate itself and take the app down with
  // `effect_update_depth_exceeded`. The push is untracked besides, so the queue is
  // never a dependency in the first place (the ModalPresence idiom).
  let toasted = false;
  $effect(() => {
    if (toasted || !updatePending || !updateReport) return;
    const signature = updateSignature(updateReport.status);
    const toast = updateToast(updateReport);
    if (!signature || !toast || readToastedUpdate() === signature) return;
    toasted = true;
    writeToastedUpdate(signature);
    untrack(() => {
      const id = alerts.push({
        ...toast,
        persistent: true,
        sound: null,
        action: {
          label: "View",
          run: () => {
            // Activating an alert does not dismiss it (state/alerts.ts), and leaving this
            // one behind the dialog it just opened would strand it.
            alerts.dismiss(id);
            openSettings(UPDATES_CATEGORY);
          },
        },
      });
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
        // Dev --fresh (EXC-781): reset the browser to a brand-new-user session. The
        // re-paint is needed because main.ts already painted whatever was stored
        // before this probe resolved. Keyed on instanceId because the daemon reports
        // fresh on every /api/health for its whole life — without the guard each
        // reload would re-clear the onboarded flag and "Maybe later" would never stick.
        if (h.fresh && !freshResetApplied(h.instanceId)) {
          clearKnownPrefs();
          appearance.boot();
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
  // Toasts fire only while the user is away, so the moment they return every one is
  // redundant. The presence gate lives in notifier.dismissAllIfPresent(): mergeReviews
  // auto-selects while away, so a toast the away user never saw must never be closed
  // out from under them. isAway() is not reactive, hence the listeners; this effect
  // reads no reactive state, so it runs once and keeps them for the component's life.
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
  // The editor chords register as read-only entries — they surface in the help modal
  // while the composer keeps owning ⌘/Ctrl+Enter and Esc on focus. Mount-once: reads
  // no reactive state, returns its teardown.
  $effect(() => {
    const unregister = EDITOR_SHORTCUTS.map((entry) => shortcuts.register(entry));
    // A live binding is EXC-786's reservation (bind spreads key/label/group/cap/scope
    // from CANONICAL_KEYMAP) plus the caller's run/enabled.
    const reg = (id: string, opts: Parameters<typeof bind>[1]) => shortcuts.register(bind(id, opts));
    // help.show carries scope: "global" in the table (EXC-849), so ? fires from every
    // view — including over Settings, where the review shortcuts are suppressed.
    const unregisterHelp = reg("help.show", {
      run: () => {
        if (showHelp) showHelp = false;
        else openHelp();
      },
    });
    // The review-verdict + chrome shortcuts (EXC-789), each routing through the SAME
    // guarded path as its TopBar button — `a` is never a raw approve, always onApprove's
    // unsent-comments guard, and Shift+R is never a raw deny, always onReject's confirm
    // (EXC-913). Settings is persistent chrome (EXC-730), reachable with no review.
    const canAct = () => active != null && !resolve.busy;
    const unregisterActions = [
      reg("actions.approve", { run: () => onApprove(resolve.approveMode), enabled: canAct }),
      reg("actions.requestChanges", {
        run: () => {
          showDialog = true;
        },
        enabled: canAct,
      }),
      reg("actions.reject", { run: onReject, enabled: canAct }),
      reg("actions.settings", { run: openSettings }),
      reg("actions.toggleComments", {
        run: toggleComments,
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

  // ----- Sound unlock (EXC-1100) -----
  // Browsers refuse to start audio until the page has been interacted with, so the
  // shared AudioContext is created inside the first gesture rather than inside
  // whichever poll tick happens to want the first sound. Mount-once: reads no
  // reactive state, returns the listener disposer.
  $effect(() => sound.unlock());

  // ----- Tab-close presence retraction (EXC-562) -----
  // Tell the daemon when this tab is closing so it stops counting us as a live
  // client. Without it the daemon leans on the throttled 2s reviews poll, and a
  // backgrounded-but-open tab would still get a redundant new tab on the next
  // plan. Mount-once: reads no reactive state, returns its teardown.
  $effect(() => installUiGoneBeacon({ target: window }));

  // ----- Read detection for the cmux unread mark (EXC-961) -----
  // A continuous dwell on the plan, visible and focused, reports it as seen.
  // Mount-once: the watcher (constructed above) owns its own presence listeners,
  // so this effect exists only to detach them at teardown.
  $effect(() => seenWatcher.destroy);
  // Feed the watcher whatever is on screen — the derived `active` covers both a
  // selection change and the 2s poll bumping the review to a new version.
  $effect(() => {
    seenWatcher.track(active ? { id: active.id, version: active.version } : null);
  });

  function onApprove(mode: ApproveVariantId) {
    // Approve always routes through a confirmation (EXC-791): even with nothing
    // queued, a stray click must not ship the plan. Park the chosen mode; the
    // guard (UnsentCommentsDialog) additionally previews any pending comments a
    // plain approve would drop.
    pendingApproveMode = mode;
  }
  // The three verdict hand-offs (EXC-894). Each acknowledges BEFORE clearing its
  // modal's flag, so the confirmation is already sliding in while the surface recedes —
  // the ordering is the point, not the toast. The acknowledgment is optimistic and the
  // resolve stays fired-not-awaited; the failure that would mask is caught by
  // createResolve's onOffline above.
  //
  // The flag check is what makes each idempotent: the surface stays mounted through its
  // 140ms exit, so a second press inside that window would push a second confirmation
  // for one decision.
  function approveAnyway(notes: string) {
    const mode = pendingApproveMode;
    if (!mode) return;
    alerts.push({ variant: "success", message: "Plan approved", sound: "approved" });
    pendingApproveMode = null;
    void resolve.approve(mode, notes);
  }
  function onReject() {
    // Reject always confirms (EXC-685): consistent whether or not comments are
    // queued. The dialog additionally guards unsent comments when present.
    pendingReject = true;
  }
  function rejectAnyway() {
    if (!pendingReject) return;
    // Neutral rather than success, here and on request-changes: AlertHost leads the
    // success variant with a check glyph that would read as approval on a plan being
    // sent back.
    alerts.push({ variant: "default", message: "Plan rejected", sound: "rejected" });
    pendingReject = false;
    void resolve.reject();
  }
  function divertToRequestChanges() {
    // The annotations and general-comment draft are autosaved state, so they survive
    // the hand-off untouched. Shared by both guards, so clear both.
    //
    // Deliberately silent: this swaps one modal for another rather than deciding
    // anything, and `active` is unchanged so the arrival does not replay either.
    pendingApproveMode = null;
    pendingReject = false;
    showDialog = true;
  }
  function onRequestChanges(generalComment: string) {
    if (!showDialog) return;
    alerts.push({ variant: "default", message: "Changes requested", sound: "changesRequested" });
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
    unread={selection.unread}
    arrivals={selection.arrivals}
    onSelect={switchPlan}
    {onApprove}
    onRequestChanges={() => (showDialog = true)}
    {onReject}
    onOpenSettings={openSettings}
    {showShortcutHints}
    {updatePending}
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
    <!-- The plan rendered as line-numbered markdown source with a heading
         breadcrumbs bar and a line gutter for creating comments. The
         resolved theme id is passed down because the view renders into a shadow
         root and can't read the palette off the chrome. -->
    <DiffPlanView
      review={active}
      themeId={appearance.themeId}
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
      onCompareChange={(r) => (compareRange = r)}
      {reviewContext}
      {onCopyCwd}
      {showShortcutHints}
      {settingsRev}
    />
  {:else}
    <EmptyState connected={selection.connected} />
  {/if}

  <!-- The arrival (EXC-894): the second half of the hand-off a decided modal starts.
       The guard recedes on --dur-exit while this lifts on --dur-enter, so the two read
       as one gesture rather than two events that coincided.

       A curtain rather than an animation on the content, because the two destinations
       arrive by different mechanisms: draining the queue MOUNTS EmptyState, where a CSS
       animation would replay on its own, while a stacked plan leaves DiffPlanView
       mounted and re-renders through contentKey, where it would not. Keying an element
       that owns nothing covers both — remounting the view to buy a fade would tear down
       the @pierre/diffs render, re-init the compare store and strand revealLine.

       Keyed on the review's identity rather than the derived object: the 2s poll bumps
       the version without changing the id, and a revision in place is not an arrival. -->
  {#key active?.id ?? "none"}
    <div class="arrival" aria-hidden="true"></div>
  {/key}

  <!-- While comparing, the tally counts what the panel it toggles actually lists, so
       the two can't disagree, and 0 covered lines is how the "· M lines" readout —
       which measures the current version — is suppressed. The approve guard reads
       guardItems, not these, so no verdict logic moves. -->
  <StatusBar
    {version}
    {commit}
    {isDev}
    active={active !== null}
    pendingCount={compareRange ? comments.length : pendingCount}
    coveredLines={compareRange ? 0 : coveredLines}
    reviewVersion={active?.version ?? 1}
    connected={selection.connected}
    commentsOpen={showComments}
    onToggleComments={toggleComments}
    onOpenHelp={openHelp}
    {showShortcutHints}
  />
</div>

<!-- A root sibling of .shell rather than a child of the view, gated on an active
     review. -->
<CommentNavigator
  open={active !== null && showComments}
  {comments}
  activeId={autosave.focusedAnnotation}
  onReveal={revealComment}
  onClose={() => setComments(false)}
  compare={compareRange !== null}
  title={commentsTitle}
  {showShortcutHints}
/>

<!-- Each modal is hosted by ModalPresence rather than an {#if} (EXC-891): the
     surface stays mounted while `open` is false so bits-ui can play its exit, then
     unmounts. One consequence on the three `active`-gated sites below: `active` can
     go null DURING the exit (approveAnyway resolves the review while the guard is
     still fading), so a site that dereferences it reads it optionally. -->
<ModalPresence open={pendingApproveMode !== null && active !== null}>
  {#snippet modal({ open, onClosed })}
    <UnsentCommentsDialog
      {open}
      {onClosed}
      items={guardItems}
      action="Approve"
      consequence="Approving accepts the plan and starts the agent's work."
      icon="check"
      kind="dialog"
      showNotes
      {reviewContext}
      onConfirm={approveAnyway}
      onRequestChanges={divertToRequestChanges}
      onCancel={() => (pendingApproveMode = null)}
    />
  {/snippet}
</ModalPresence>

<ModalPresence open={pendingReject && active !== null}>
  {#snippet modal({ open, onClosed })}
    <UnsentCommentsDialog
      {open}
      {onClosed}
      items={guardItems}
      action="Reject"
      consequence="The agent will be told the plan was rejected and to wait for your next message."
      {reviewContext}
      onConfirm={rejectAnyway}
      onRequestChanges={divertToRequestChanges}
      onCancel={() => (pendingReject = false)}
    />
  {/snippet}
</ModalPresence>

<ModalPresence open={showDialog && active !== null}>
  {#snippet modal({ open, onClosed })}
    <RequestChangesDialog
      {open}
      {onClosed}
      annotations={autosave.annotations}
      generalComment={autosave.generalCommentDraft}
      planText={active?.currentPlan ?? ""}
      {scratches}
      {reviewContext}
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
  {/snippet}
</ModalPresence>

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
<ModalPresence open={showSettings}>
  {#snippet modal({ open, onClosed })}
    <SettingsDialog
      {open}
      {onClosed}
      entries={SETTINGS_REGISTRY}
      onChange={applySetting}
      onClose={() => (showSettings = false)}
      onCopyDiagnostic={copyDiagnostics}
      initialCategory={settingsCategory}
      {updatePending}
      {updateReport}
    />
  {/snippet}
</ModalPresence>

<!-- First-run onboarding: a one-time invite to enable desktop notifications,
     gated on a brand-new user (see showOnboarding above). -->
<ModalPresence open={showOnboarding}>
  {#snippet modal({ open, onClosed })}
    <OnboardingDialog {open} {onClosed} onClose={() => (showOnboarding = false)} />
  {/snippet}
</ModalPresence>

<!-- Reads the live registry at open, so it grows as later tickets register, then
     narrows (EXC-849) to the shortcuts valid in the current view — over Settings, only
     the settings + global ones, matching what the dispatcher will actually fire. -->
<ModalPresence open={showHelp}>
  {#snippet modal({ open, onClosed })}
    <ShortcutsHelp
      {open}
      {onClosed}
      entries={scopedShortcuts(shortcuts.list(), showSettings ? "settings" : null)}
      onClose={() => (showHelp = false)}
    />
  {/snippet}
</ModalPresence>

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

  /* The hand-off's arrival, covering the content row but deliberately OUT OF FLOW. The
     grid placement gives this absolutely-positioned child its containing block (.shell
     is positioned for exactly this, layout.css) and `inset: 0` stretches it to that
     area. In flow it could not work: DiffPlanView renders `.control-row` and
     `.diff-surface` as two auto-placed siblings, landing in rows 2 and 3, so an in-flow
     item claiming row 3 would push `.diff-surface` into an implicit fifth row under the
     status bar. Declared after both content branches, so it paints over them with no
     z-index of its own.

     What that costs: the curtain covers row 3, so an arriving plan's `.control-row`
     swaps at once beneath it. Widening to `grid-row: 2 / 4` is not the fix, because row
     2 is the daemon banner's when one is present — the real fix is a single DiffPlanView
     root pinned to row 3.

     Both ends of the placement are spelled out because out of flow they have to be: an
     `auto` grid line on an absolutely-positioned child resolves to the grid container's
     PADDING EDGE rather than "span 1", so a bare `grid-row: 3` would run the curtain
     over the status bar too — and the bar stays continuous through the hand-off.

     Opacity only, never a wipe: the directional sweep is spoken for by the theme switch,
     where it means "everything was restyled". One paper tone serves both destinations —
     it matches --paper under the empty state and sits a step above --paper-sunk under a
     plan, so that reveal begins on a slight lift. `forwards` is load-bearing: without
     the fill the final opacity is discarded and the curtain snaps back to full paper,
     blanking the content region for the rest of the session. */
  .arrival {
    position: absolute;
    grid-row: 3 / 4;
    grid-column: 1 / 2;
    inset: 0;
    pointer-events: none;
    background: var(--paper);
    animation: arrival var(--dur-enter) var(--ease-out) forwards;
  }
  @keyframes arrival {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  /* Alert.Root's card default re-shaped into a full-width strip that consumes grid
     row 2 and pushes the content down rather than overlaying it, so it can't be
     mistaken for a transient toast. :global because the class rides the Alert child
     component; the overrides win because this scoped CSS is unlayered and Tailwind's
     utilities are layered. */
  .shell > :global(.daemon-banner) {
    grid-row: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.6rem var(--bar-inset);
    background: var(--accent-wash);
    color: var(--ink);
    border: 0;
    border-bottom: 1px solid var(--rule-strong);
    border-left: 3px solid var(--accent);
    border-radius: 0;
    font-size: var(--text-base);
    animation: daemon-banner-in var(--dur-enter) var(--ease-out);
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
    transition: background var(--dur-micro) var(--ease-out);
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
    animation: safe-mode-in var(--dur-enter) var(--ease-out);
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
