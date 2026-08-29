<script lang="ts">
  // The settings Updates pane (EXC-1207): the read-only half of the Updates category —
  // what the daemon's cached verdict says about this caret, and the exact command that
  // takes the upgrade. The `updates.check` toggle is an ordinary registry field, so the
  // shell renders it BENEATH this block rather than this pane replacing it (unlike
  // Notifications and Advanced, which own their whole pane).
  //
  // The report arrives as a PROP, which is the one place this diverges from AdvancedPane:
  // that pane owns its own fetches, but App needs this same report for the load toast and
  // the two badges, and a second fetch would be a second truth. A null report — the fetch
  // failed, or the daemon wires no update thunk at all — degrades to a quiet placeholder,
  // matching AdvancedPane's per-block degrade rather than raising an error.
  //
  // The verdict→copy mapping is pure and lives in lib/updates.ts; this file is the shell.
  import type { UpdateReport } from "@core/lib/types";
  import { Field, FieldTitle } from "$lib/components/ui/field/index.js";
  import { isUpdatePending, updatePaneCopy } from "$lib/updates.ts";

  interface Props {
    /** The daemon's verdict, or null when it could not be read. Already reflects the
     * reviewer's live `updates.check` (EXC-1210), so the pane renders it as handed over. */
    report: UpdateReport | null;
  }
  let { report }: Props = $props();

  const copy = $derived(report ? updatePaneCopy(report) : null);
  // The dot is the pane's one hued element, and it carries the verdict before the
  // sentence does. --attention is the novelty job ("worth a glance"), --ok the positive
  // semantic, and everything else stays on the neutral ink ramp. Amber is deliberately
  // not spent here: it marks selection and brand, and the rail row beside this pane is
  // already wearing it.
  const tone = $derived.by(() => {
    if (!report) return "quiet";
    if (isUpdatePending(report.status)) return "pending";
    return report.status.kind === "current" ? "ok" : "quiet";
  });
</script>

<!-- One Field, named by its own title, so the block is a structural group rather than a
     nameless boundary — the same treatment AdvancedPane gives its four blocks. It
     DISPLAYS a value and labels no control, so it takes FieldTitle (a <div>), never
     FieldLabel. -->
<div class="updates" data-updates-pane>
  <Field class="update-section" aria-labelledby="update-status-label">
    <FieldTitle id="update-status-label" class="update-label">Update status</FieldTitle>

    {#if copy}
      <p class="update-headline">
        <span class="update-dot" data-tone={tone} aria-hidden="true"></span>
        {copy.headline}
      </p>
      <p class="update-detail">{copy.detail}</p>
      {#if copy.command}
        <!-- The command is the one thing anyone will select out of this pane, so it takes
             the sunk mono block the Advanced diagnostics already read as copyable text.
             It is a <code>, not a control: there is no copy button here, deliberately —
             the reader is at a terminal, and the Advanced pane's copy affordance is a
             click away if one is ever wanted.

             It scrolls (the release command overflows the pane), and Chrome and Safari
             leave a plain `overflow: auto` element out of the tab order — so the region
             role plus the tab stop ARE the keyboard reading affordance, exactly as
             FilePreview's `.fp-code` carries them for the same reason (EXC-972). -->
        <code
          class="update-command"
          role="region"
          tabindex="0"
          aria-label="Upgrade command">{copy.command}</code>
      {/if}
    {:else}
      <p class="update-placeholder">No update information is available from the daemon.</p>
    {/if}
  </Field>
</div>

<style>
  .updates {
    display: flex;
    flex-direction: column;
  }
  /* The field parts carry shadcn's roomier default gaps; the pane's own rhythm is
     re-asserted here rather than in the vendored tree, which a re-sync reverts wholesale
     (shadcn-rules.md § Adding a component that collides with the vendored tree). Svelte
     does not scope-hash a class handed to a COMPONENT, so those selectors are written
     :global, anchored on `.updates`, which is a plain element and still carries the hash. */
  .updates :global(.update-section) {
    gap: 0.4rem;
  }
  /* The uppercase block label, in the same vocabulary as the Advanced pane's labels and
     the settings section heads — so a reader crossing panes meets one heading style. */
  .updates :global(.update-label) {
    font-size: var(--text-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-faint);
  }

  /* The verdict itself: the pane's answer, at full ink so it out-reads everything around
     it, with the dot on its leading edge. */
  .update-headline {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    line-height: var(--leading-snug);
    color: var(--ink);
  }
  .update-detail {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-snug);
    color: var(--ink-soft);
  }
  /* A plain coloured disc, not an icon — the same affordance the Advanced pane's daemon
     liveness dot is, and hued by the job its tone does. `align-self` rather than a
     baseline shift: a disc has no baseline of its own to sit on. */
  .update-dot {
    flex: none;
    align-self: center;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--ink-faint);
  }
  .update-dot[data-tone="pending"] {
    background: var(--attention);
  }
  .update-dot[data-tone="ok"] {
    background: var(--ok);
  }

  /* The upgrade command, on the recessed surface the Advanced blocks use. It scrolls
     rather than wrapping: a wrapped shell command invites a half-copied paste. */
  .update-command {
    display: block;
    margin-top: 0.35rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper-sunk);
    overflow-x: auto;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    color: var(--ink);
    white-space: pre;
  }

  /* A degraded pane reads muted — it is a placeholder, not data, and not a failure. */
  .update-placeholder {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--ink-faint);
  }
</style>
