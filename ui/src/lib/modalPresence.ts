// Keeping a modal in the DOM while its exit plays (EXC-891). bits-ui's Presence
// layer is what drives `data-state="closed"` and holds a surface mounted until its
// exit keyframes finish — but it only gets the chance if `open` reaches `false` on
// a still-mounted component. A host that gates the modal with `{#if}` rips it out
// in the same tick, so the exit never runs. This owns the two facts a host needs to
// hold the surface open a moment longer: whether it is present, and which open it
// belongs to.

export interface PresenceStore {
  /** Whether the surface is in the DOM — open, or still playing its exit. */
  present: boolean;
  /** Bumps on every open, so the host can {#key} a fresh mount per open. */
  generation: number;
}

export function createModalPresence(store: PresenceStore) {
  return {
    /** The host's open flag changed. Opening mounts — or, mid-exit, remounts —
     *  the surface; closing leaves it present until the exit reports done. */
    sync(isOpen: boolean): void {
      if (!isOpen) return;
      store.present = true;
      store.generation++;
    },
    /** The surface finished an open/close animation. Only a completed CLOSE
     *  unmounts; a completion reported while open is the enter finishing, or a
     *  stale callback from a surface that has since re-opened. */
    settle(isOpen: boolean): void {
      if (isOpen) return;
      store.present = false;
    },
  };
}
