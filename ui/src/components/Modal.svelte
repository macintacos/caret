<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Dialog from "$lib/components/ui/dialog/index.js";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";

  interface Props {
    /** The modal's role and dismissal contract:
     *  - "dialog" — a dismissible surface (Settings): Escape AND backdrop click
     *    close it, routed to onDismiss.
     *  - "confirm" — an `alertdialog` guard (Approve/Reject): a deliberate choice
     *    is required, so a backdrop click does NOT dismiss; Escape still does,
     *    routed to onDismiss. */
    kind?: "dialog" | "confirm";
    /** Controlled open — the host gates the component with {#if}, so it mounts
     * open and this stays literal-true; bits-ui's close intents route to onDismiss. */
    open: boolean;
    /** Uppercase eyebrow over the title (caret's dialog signature). Optional. */
    eyebrow?: string;
    /** The dialog heading — wired to aria-labelledby by bits-ui. */
    title: string;
    /** Any dismissal intent (Escape always; backdrop only for kind="dialog"). */
    onDismiss: () => void;
    /** bits-ui's open-autofocus hook (both roles), e.g. to land focus on the
     * confirm action instead of Cancel, or on a dialog's primary input. Passed
     * straight through to the Content of whichever primitive `kind` selects. */
    onOpenAutoFocus?: (e: Event) => void;
    /** Optional description, rendered inside the primitive's Description element so
     * bits-ui wires aria-describedby. A snippet so a consumer can compose dynamic
     * copy (e.g. a pending-count warning). */
    description?: Snippet;
    /** Body content between header and footer. */
    children: Snippet;
    /** Footer actions (rendered in the shared footer band). */
    footer?: Snippet;
    /** Extra classes for the Content element, mainly to widen a content-heavy
     * modal past the shadcn default (max-w-sm) — e.g. "sm:max-w-xl". Merged via
     * the primitive's cn(), so a later max-w wins over the default. */
    contentClass?: string;
  }
  let {
    kind = "dialog",
    open,
    eyebrow,
    title,
    onDismiss,
    onOpenAutoFocus,
    description,
    children,
    footer,
    contentClass,
  }: Props = $props();
</script>

<!-- One caret modal, two roles. The bits-ui primitive differs by kind (Dialog vs
     AlertDialog — different role and backdrop-dismiss semantics), but the visible
     chrome — eyebrow, title, description, footer band, and the raised-paper surface
     the shadcn *-content/*-footer components now share — is styled once (below) and
     worn by both branches, so a future modal reuses this shell instead of hand-
     rolling a look that drifts. -->
{#if kind === "confirm"}
  <AlertDialog.Root {open}>
    <AlertDialog.Content onEscapeKeydown={() => onDismiss()} {onOpenAutoFocus} class={contentClass}>
      <AlertDialog.Header class="m-head">
        {#if eyebrow}<span class="eyebrow">{eyebrow}</span>{/if}
        <AlertDialog.Title class="m-title">{title}</AlertDialog.Title>
        {#if description}
          <AlertDialog.Description>{@render description()}</AlertDialog.Description>
        {/if}
      </AlertDialog.Header>
      {@render children()}
      {#if footer}<AlertDialog.Footer>{@render footer()}</AlertDialog.Footer>{/if}
    </AlertDialog.Content>
  </AlertDialog.Root>
{:else}
  <Dialog.Root {open} onOpenChange={(o) => { if (!o) onDismiss(); }}>
    <Dialog.Content
      showCloseButton={false}
      {onOpenAutoFocus}
      class={contentClass}
      onInteractOutside={(e) => {
        // A confirmation bubble (ConfirmPopover) portals to document.body — a
        // sibling of this content, not a descendant — so bits-ui counts a click on
        // it as an outside interaction and would dismiss the whole modal, tearing
        // the bubble down before its Discard click lands (that was the unreliable
        // in-modal discard — EXC-765). Treat a click within the bubble as inside.
        if ((e.target as Element | null)?.closest?.(".confirm-popover")) e.preventDefault();
      }}
    >
      <Dialog.Header class="m-head">
        {#if eyebrow}<span class="eyebrow">{eyebrow}</span>{/if}
        <Dialog.Title class="m-title">{title}</Dialog.Title>
        {#if description}
          <Dialog.Description>{@render description()}</Dialog.Description>
        {/if}
      </Dialog.Header>
      {@render children()}
      {#if footer}<Dialog.Footer>{@render footer()}</Dialog.Footer>{/if}
    </Dialog.Content>
  </Dialog.Root>
{/if}

<style>
  /* The shared modal identity. These classes ride this component's scope hash onto
     the elements bits-ui portals into document.body, so the styling reaches the
     portalled panel; keeping it in one <style> is what stops the two modals drifting.
     Colors ride caret tokens only. */
  /* caret's dialog signature: the uppercase eyebrow over the title. Scoped — this
     span is Modal's own element, so the hash rides it into the portal. */
  .eyebrow {
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  /* .m-head / .m-title land on the shadcn Header/Title CHILD components, so they
     carry no Modal scope hash — reached with :global, anchored under the header so
     the title rule can't leak. .m-head overrides the alert header's small-screen
     text-center so both roles read start-aligned; .m-title overrides the differing
     shadcn title sizes (dialog text-base vs alert text-lg) so every modal wears the
     same heading. */
  :global(.m-head) {
    text-align: start;
  }
  :global(.m-head .m-title) {
    font-size: var(--text-lg);
    font-weight: 600;
    line-height: var(--leading-tight);
    color: var(--ink);
  }
</style>
