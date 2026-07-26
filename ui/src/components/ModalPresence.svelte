<script lang="ts">
  // The gate that lets a modal play its exit (EXC-891). bits-ui holds a surface in
  // the DOM while its exit keyframes run, but only if `open` reaches `false` on a
  // still-mounted component — a host `{#if showFoo}` unmounts it in the same tick,
  // so the exit never starts. App composes this instead: the surface stays rendered
  // through the close, and unmounts once it reports the exit done
  // (onOpenChangeComplete). The unmount is what preserves every mount-on-open
  // semantic the `{#if}` was silently providing.
  //
  // The `{#key}` covers the one case a plain `{#if open || exiting}` would miss:
  // re-opening mid-exit, where the surface never left the DOM and would otherwise
  // carry the previous session's local state.
  import { untrack, type Snippet } from "svelte";
  import { createModalPresence, type PresenceStore } from "$lib/modalPresence.ts";

  interface Props {
    /** The host's open flag. */
    open: boolean;
    /** The surface, handed the live `open` plus the callback that reports its exit done. */
    modal: Snippet<[{ open: boolean; onClosed: () => void }]>;
  }
  let { open, modal }: Props = $props();

  const store = $state<PresenceStore>({ present: false, generation: 0 });
  const presence = createModalPresence(store);

  // `open` is this effect's only dependency — untrack keeps the generation bump
  // (a read-then-write) from re-triggering it.
  $effect(() => {
    const isOpen = open;
    untrack(() => presence.sync(isOpen));
  });
</script>

{#if store.present}
  {#key store.generation}
    {@render modal({ open, onClosed: () => presence.settle(open) })}
  {/key}
{/if}
