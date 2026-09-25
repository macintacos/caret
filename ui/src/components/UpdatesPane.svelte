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
  import { Button } from "$lib/components/ui/button/index.js";
  import { Field, FieldTitle } from "$lib/components/ui/field/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import { isUpdatePending, updatePaneCopy } from "$lib/updates.ts";

  interface Props {
    /** The daemon's verdict, or null when it could not be read. Already reflects the
     * reviewer's live `updates.check` (EXC-1210), so the pane renders it as handed over. */
    report: UpdateReport | null;
    /** Opens the What's new modal; offered only while an update is pending. */
    onWhatsNew?: () => void;
  }
  let { report, onWhatsNew = () => {} }: Props = $props();

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
    <FieldTitle id="update-status-label" class="update-label settings-block-label">Update status</FieldTitle>

    {#if copy}
      <p class="update-headline">
        <span class="update-dot" data-tone={tone} aria-hidden="true"></span>
        {copy.headline}
      </p>
      <p class="update-detail">{copy.detail}</p>
      {#if copy.command}
        <!-- The command is the one thing anyone will select out of this pane, so it takes
             the sunk mono block the Advanced diagnostics already read as copyable text.
             There is no copy button here, deliberately — the reader is at a terminal, and
             the Advanced pane's copy affordance is a click away if one is ever wanted.

             A read-only field: the release command overflows the pane, and a field is
             focusable, scrolls under the arrow keys, and selects only the command on
             select-all, all natively. -->
        <Input
          class="update-command settings-copy-box settings-copy-text"
          readonly
          value={copy.command}
          aria-label="Upgrade command" />
      {/if}
      {#if report && isUpdatePending(report.status)}
        <Button class="update-whats-new" variant="outline" size="sm" data-whats-new onclick={onWhatsNew}>
          What's new
        </Button>
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
     (shadcn-rules.md). Svelte does not scope-hash a class handed to a COMPONENT, so those
     selectors are written :global, anchored on `.updates`, which is a plain element and
     still carries the hash. */
  .updates :global(.update-section) {
    gap: 0.4rem;
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

  /* The copy-box padding sets the field's height, over the Input's fixed one. */
  .updates :global(.update-command) {
    height: auto;
    margin-top: 0.35rem;
  }
  .updates :global(.update-command:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }

  .updates :global(.update-whats-new) {
    align-self: flex-start;
    margin-top: 0.35rem;
  }

  /* A degraded pane reads muted — it is a placeholder, not data, and not a failure. */
  .update-placeholder {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--ink-faint);
  }
</style>
