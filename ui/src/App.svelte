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
  import { getHealth, getUpdate, getUpdatesCheck, markSeen } from "$lib/api.ts";
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
  // The daemon's cached update verdict (EXC-1207), read once on load. Null until it
  // lands, and null for good when it can't be read — a daemon that wires no update thunk
  // 404s the route, and every surface then simply stays quiet. Every update surface
  // renders this one value.
  let updateReport = $state<UpdateReport | null>(null);
  // The reviewer's `updates.check` opt-out, mirrored here from the same load. It gates
  // the surfaces below in the BROWSER, which is load-bearing rather than belt-and-
  // braces: the daemon evaluates the switch when the check RUNS and then holds that
  // verdict for its whole life, so a user who turns the check off against a long-lived
  // daemon would still be served a stale `behind-release` on their next page load.
  // Mirroring it here is also what makes the flip take effect with no round trip.
  let updatesCheck = $state(true);
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
  // Which category Settings opens on (EXC-1207). Undefined for every existing caller —
  // the keyboard shortcut and the topbar gear land on Appearance as they always have —
  // and set only by the update toast's deep link. The host mounts SettingsDialog per
  // open (ModalPresence), so recording it before showing is what makes the seed apply.
  let settingsCategory = $state<string | undefined>(undefined);
  // Settings and the shortcuts help are the two surfaces the reviewer summons over
  // a plan; each announces itself once, on the way in, since closing is their own
  // move. The verdict dialogs also open over a plan but sit this out — they belong
  // to the decision flow, which sounds through its own verdict cue.
  function openSettings(category?: string): void {
    sound.play("modalOpen");
    settingsCategory = category;
    showSettings = true;
  }
  function openHelp(): void {
    sound.play("modalOpen");
    showHelp = true;
  }
  // The comment panel's visibility has one writer, so every route to it sounds the
  // same: the C shortcut and the status-strip tally through toggleComments, the
  // panel's own ✕ and Escape through setComments(false) (EXC-1126). Sounded on the
  // flip only, the guard setComparing and setConnected use for the same reason.
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
  // Shortcut-hint affordances (EXC-826). App owns the reactive flag and threads it
  // to the surfaces that show discoverability chrome (the TopBar key-cap hints, the
  // status-bar keyboard button, the V-mode chip); applySetting resyncs it after a
  // Settings edit so flipping it applies in place. The ? help modal stays reachable
  // by keyboard regardless.
  let showShortcutHints = $state(readShortcutHints());

  // Settings apply immediately (EXC-843). The two-pane Settings dialog calls this the
  // moment a control changes: it persists + applies through the registry field's
  // write(), resyncs the one reactive mirror left here — showShortcutHints (the hint
  // chrome) — then confirms with a toast. The appearance fields need no resync: they
  // command the appearance module, which every surface reads live. A failed write
  // raises a PERSISTENT error toast the user must read and dismiss.
  //
  // settingsRev bumps on every applied change; DiffPlanView watches it to re-read the
  // diff-layout/marker prefs into its compare store so an open diff reflows live too
  // (those prefs live in the view's own store, not a mirror App can resync).
  let settingsRev = $state(0);
  async function applySetting(field: StagedField, value: unknown) {
    try {
      // Awaited: a daemon-backed field's write is a POST (EXC-1206), and a rejected
      // promise is the only way it can report a refusal. The Settings shell awaits
      // this in turn, so a failure re-reads the field and snaps the control back.
      await field.write(value);
    } catch (err) {
      // The hint is the write's own message: a localStorage pref can't fail, while a
      // daemon-backed one says why in a sentence ("The caret daemon isn't
      // reachable…"). Persistent so a failure isn't missed.
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
    // The other reactive mirror (EXC-1207): the daemon owns this value, so there is no
    // module to re-read it from — the accepted write IS the new truth. Mirroring it here
    // is what clears the badges the instant the reviewer turns the check off.
    if (field.key === UPDATES_CHECK_KEY) updatesCheck = value === true;
    settingsRev++;
    alerts.push({
      variant: "success",
      message: `${field.label} updated`,
      // A theme change is the one settings edit with a sound of its own; the rest
      // take the success toast's. Either way the edit is heard exactly once.
      sound: THEME_KEYS.includes(field.key) ? "themeSwitch" : undefined,
    });
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
  const selection = createReviewSelection(selStore, { onSound: sound.play });
  // The reviewer picking another plan from the switcher, which selectReview alone is
  // not: that is also the funnel for a deep link, mergeReviews' re-select, and
  // afterResolve's auto-advance, none of which the reviewer asked for. The plan
  // notifier's click (createPlanNotifier below) is reviewer-initiated but sits out
  // too — the plan it jumps to already sounded its own arrival. Sounded only on a
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
    onOffline: () => {
      selection.setConnected(false);
      // Resolve's OWN onOffline — createAutosave's and startPolling's are separate
      // closures — and it fires only on a genuine network failure, since a daemon non-2xx
      // means the daemon answered and still advances. So this is exactly the case the
      // optimistic confirmations below get wrong: nothing advanced, the plan is still on
      // screen, and this persistent alert is what keeps a failed decision from reading as
      // a landed one. Same shape as applySetting's failure half above.
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
  // The variants the split-button renders: the declared set when present, else
  // the built-in fallback.
  let variants = $derived(approveVariants(declaredVariants));
  // Whether to mark the update surfaces (EXC-1207) — the browser-side gate described
  // above, ANDed with the daemon's verdict.
  let updatePending = $derived(
    updatesCheck && !!updateReport && isUpdatePending(updateReport.status),
  );
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
  // The two versions being diffed while compare mode is on screen, null otherwise
  // — DiffPlanView owns compare state and reports it upward (EXC-872), because the
  // navigator is a root sibling of .shell rather than a child of the view. Ordered
  // as the diff renders them (before = the old document), not sorted, so the panel
  // can tell which side a comment jumps to.
  let compareRange = $state<{ before: number; after: number } | null>(null);
  // The plan's inline comments + unsent drafts as a navigable, searchable index for
  // the comment navigator — committed line-anchored comments plus the retained
  // composer scratches (flagged draft), in document order. While comparing, the
  // panel lists the comments left on every version in the compared range instead,
  // each badged with its source version; drafts are single-version only.
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

  // Reveal a comment from the navigator: focus it (the source view highlights the
  // card in amber and expands it) and scroll the view to its line. A row the index
  // marked unlinkable has nothing on screen to scroll to, so it does neither.
  // Focusing is single-version only: a compare entry's id carries a `v3:` prefix
  // that matches no card, so focusing it would strand a bogus id in the working
  // copy for the reviewer to find after leaving compare mode.
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
  // Follow the system light/dark flip (EXC-773). The appearance module owns the one
  // subscription and re-resolves against the fresh preference, wiping like an in-app
  // switch when the palette actually moves and staying silent under a pinned mode.
  // No reactive reads: runs once on mount, returns the disposer.
  $effect(() => appearance.watch());

  // ----- Update verdict -----
  // Read the daemon's CACHED verdict plus the reviewer's opt-out, once on mount. No
  // network check is triggered by the UI — the daemon decided this at boot and the route
  // only reports it. No reactive reads, so this runs once. Both failures are quiet: the
  // report stays null (every surface then says nothing) and the opt-out fails safe to on.
  //
  // The two reads SETTLE TOGETHER, and the gate is assigned before the verdict. Fired as
  // independent promises they race, and the race has a predictable loser: /api/update is a
  // synchronous thunk read while /api/prefs awaits two file reads, so the verdict lands
  // first essentially every time. With `updatesCheck` still at its optimistic default, a
  // reviewer who had opted out would get the toast anyway — and it would spend that
  // version's once-per-version marker on its way past, so the nudge would be lost for good
  // if they ever turned checks back on. Settling first is what makes the gate atomic.
  $effect(() => {
    void Promise.all([getUpdate().catch(() => null), getUpdatesCheck()]).then(
      ([report, check]) => {
        updatesCheck = check;
        // Seed the holder the Updates toggle's synchronous read() closes over, so the
        // control opens showing what is actually on disk rather than the default.
        seedUpdatesCheck(check);
        updateReport = report;
      },
    );
  });

  // The once-per-version nudge. Fires when the verdict resolves and the gate holds, and
  // only when this browser has not already toasted THIS signature — so a reviewer who
  // dismissed it does not meet it again on every reload, and a newer version still gets
  // its own. Persistent, because a nudge worth reading should not vanish in four seconds
  // and it can fire at most once per version so it cannot nag; silent, because a page
  // load should not chime.
  //
  // `toasted` is a plain local rather than the stored marker, and it is what keeps this
  // effect from re-entering: `alerts.push` READS `alertStore.alerts` to append to it, so
  // pushing from inside an effect makes the queue one of this effect's own dependencies.
  // The stored marker cannot stand in, because it is allowed to fail — with storage
  // blocked, `readToastedUpdate()` keeps answering null and the guard never holds, so the
  // effect would push, invalidate itself, push again, and take the app down with
  // `effect_update_depth_exceeded`. The push is untracked besides, so the queue is never a
  // dependency in the first place (the ModalPresence idiom).
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
        if (showHelp) showHelp = false;
        else openHelp();
      },
    });
    // The review-verdict + chrome shortcuts (EXC-789). Each binds EXC-786's canonical
    // reservation and adds the live run + enabled here, routing through the SAME guarded
    // path as its TopBar button — `a` is never a raw approve, always onApprove's
    // unsent-comments guard, and Shift+R is never a raw deny, always onReject's confirm
    // (EXC-913). The three verdict actions gate on an active, not-busy review
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
  // The three verdict hand-offs (EXC-894). Each acknowledges BEFORE clearing its modal's
  // flag, so the confirmation is already sliding in bottom-right while the surface recedes
  // — the ordering is the point, not the toast. The acknowledgment is optimistic and the
  // resolve stays fired-not-awaited, so nothing here can delay or block it; the failure it
  // would otherwise mask is caught by createResolve's onOffline above. Each names its
  // verdict in the past tense of the button that was pressed, so the action keeps one name
  // through the whole gesture.
  // Each of the three opens on its own flag, which is also what makes it idempotent: the
  // surface stays mounted through its 140ms exit, so its confirm button is still clickable
  // after the first press cleared the flag. Without the guard a second press inside that
  // window pushes a second confirmation for one decision.
  function approveAnyway(notes: string) {
    // `notes` is the optional reviewer note from the confirm dialog (EXC-791); it
    // rides the allow as feedback and reaches the agent. resolve.approve omits a
    // blank note.
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
    // Neutral rather than success, here and on request-changes: both are completed
    // decisions rather than good outcomes, and AlertHost leads the success variant with a
    // check glyph that would read as approval on a plan being sent back. Same gesture,
    // the weight each verdict deserves.
    alerts.push({ variant: "default", message: "Plan rejected", sound: "rejected" });
    pendingReject = false;
    void resolve.reject();
  }
  function divertToRequestChanges() {
    // The annotations + general-comment draft are App.svelte's autosaved state,
    // so they survive the hand-off to the request-changes dialog untouched.
    // Shared by both guards (approve + reject), so clear both.
    //
    // Deliberately silent: this swaps one modal for another rather than deciding
    // anything, so there is no verdict to confirm — and `active` is unchanged, so the
    // arrival below does not replay either. The surfaces still cross on the shared
    // choreography (EXC-892); only the two hand-off moves sit this one out.
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

  <!-- The arrival (EXC-894): the second half of the hand-off a decided modal starts. The
       guard recedes on --dur-exit while this lifts on --dur-enter, so the departure has
       cleared before the arrival settles and the two read as one gesture rather than as
       two events that happened to coincide.

       A curtain rather than an animation on the content itself, because the two
       destinations arrive by different mechanisms: draining the queue MOUNTS EmptyState,
       where a CSS animation would replay on its own, while a plan stacked behind this one
       leaves DiffPlanView mounted and re-renders its shadow content through contentKey,
       where it would not. Keying an element that owns nothing covers both with one rule,
       and costs nothing — remounting the view to buy a fade would tear down the
       @pierre/diffs render, re-init the compare store and strand revealLine. Owning
       nothing is also why the plan under it does not move at all: this lifts off it.

       Keyed on the review's identity rather than the derived object: the 2s poll bumps the
       active review to a new version without changing the id, and a revision landing in
       place is not an arrival. -->
  {#key active?.id ?? "none"}
    <div class="arrival" aria-hidden="true"></div>
  {/key}

  <!-- The bottom status bar (EXC-787): the row-4 grid child consolidating the
       build/version badge (left), the plan-review status (right, when active),
       and the keyboard ? affordance (far right). While comparing, its tally
       counts what the panel it toggles actually lists, so the button and its
       panel can't disagree, and 0 covered lines is how the "· M lines" readout
       (which measures the current version) is suppressed; the approve guard
       reads guardItems, not these, so no verdict logic moves. A grid child, so it reserves
       space at the bottom; the CommentNavigator docks just above it. -->
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
      {updatesCheck}
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

<!-- Keyboard shortcuts help (EXC-787): the ? key toggles it, the status bar's
     keyboard button opens it. Reads the live registry (shortcuts.list()) at open,
     so it grows as later tickets register — then narrowed (EXC-849) to the shortcuts
     valid in the current view: over Settings it lists only the settings + global
     shortcuts, matching what the dispatcher will actually fire. -->
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

  /* The hand-off's arrival, covering the content row it names but deliberately OUT OF
     FLOW. The grid placement is what gives an absolutely-positioned child its containing
     block — .shell is positioned for exactly this (layout.css) — and `inset: 0` then
     stretches it to that area. In flow it could not work: the content row is filled by a
     single AUTO-PLACED child. DiffPlanView renders `.control-row` and `.diff-surface` as
     two siblings rather than one root — which is also why the `.diff-plan` arm of the rule
     above has matched nothing since long before this curtain — and auto-placement drops the
     first into row 2 (the banner's row, empty in the common case) and the second into row 3.
     An in-flow item claiming row 3 is placed before either and pushes `.diff-surface` into
     an implicit fifth row, under the status bar. Out of flow it takes part in no placement
     at all. Declared after both content branches, so it paints over them with no z-index of
     its own.

     What that costs, stated rather than inherited: the curtain covers row 3, so on an
     arriving plan `.control-row` — the ToC chip, compare picker, breadcrumbs and cwd — is
     NOT covered and swaps at once beneath it. Widening to `grid-row: 2 / 4` is not the fix,
     because row 2 is the daemon banner's when one is present. The real fix is a single
     DiffPlanView root pinned to row 3, which would also make this boundary a deliberate
     element rather than a track number; until then the drain-to-empty destination is fully
     covered (`.empty` is pinned to row 3) and the stacked-plan one is covered from the
     control row down.

     Both ends of the placement are spelled out because out of flow they have to be: an
     `auto` grid line on an absolutely-positioned child resolves to the grid container's
     PADDING EDGE rather than to "span 1", so a bare `grid-row: 3` would run the curtain
     down over the status bar as well — and the bar is chrome that stays continuous through
     the hand-off, because the app did not change, only the plan did.

     Opacity only, and deliberately not a wipe: the directional sweep is spoken for by the
     theme switch, where it means "everything was restyled". A plan arriving is a smaller
     claim, so the page simply develops back in under the curtain. One paper tone serves
     both destinations: it matches the body's --paper exactly under the empty state, and
     sits a step above the diff view's --paper-sunk under a plan, so that reveal begins on
     a slight lift rather than on the same tone. Judged the better trade than tinting the
     curtain per destination, which would need it to know which one it is. `forwards` is
     load-bearing rather than cosmetic — without the fill the final opacity is discarded
     and the curtain snaps back to full paper, blanking the content region for the rest of
     the session. Reduced motion stays the global rule's job (styles/base.css), which
     collapses this to 0.01ms and makes the hand-off the instant state change it should be
     under that preference — hence no @media here. */
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
