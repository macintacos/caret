<script lang="ts">
  // The one-time reference teaching badge (EXC-1061). A reviewer has no way to guess
  // that the plan's path tokens are clickable, so one badge is shown over one file
  // reference and one directory reference — a file opens an excerpt preview drawer, a
  // directory opens a folder-tree card — and opening a reference of that kind retires
  // its badge for good (the placement math and the persistence live in
  // lib/diffview/refHint.ts; DiffPlanView hands this component the coordinates).
  //
  // It is a REAL focusable button, deliberately not aria-hidden decoration. The token it
  // teaches is a classless shiki <span> inside the diff view's shadow root with no role
  // and no tab stop, so nothing unfocusable could surface this affordance to a keyboard
  // user: the tooltip shows on hover AND on focus, and activating the badge opens the
  // very reference the token would. Don't demote it to decoration.
  //
  // It sits in the .diff-plan light DOM (a sibling of the diff surface), so — unlike the
  // motionless shadow render surface — it may animate.
  //
  // `data-ref-hint` is a contract rather than a styling hook: the folder card's
  // outside-click dismissal reads it to let an activation through unswallowed,
  // exactly as it already does for a reference token. Renaming it breaks that.
  import type { FileRefKind } from "@core/lib/types";
  import { Button } from "$lib/components/ui/button/index.js";
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";

  interface Props {
    /** Which reference the badge sits over — decides the copy. */
    kind: FileRefKind;
    /** The referenced path, which the tooltip names. */
    path: string;
    /** Top/left of the token's top-right corner, in .diff-plan content coordinates. */
    top: number;
    left: number;
    /** Opens the reference the token beneath would open. */
    onActivate: () => void;
  }

  let { kind, path, top, left, onActivate }: Props = $props();

  // A stable NAME and a specific DESCRIPTION, the split browser-testing.md records
  // for a control rendering live data. bits-ui points aria-describedby at the open
  // tooltip, so a name identical to it would be announced twice — and "this file"
  // names nothing a screen reader can find anyway: the token the badge sits over is
  // a classless shiki span inside a shadow root, elsewhere in DOM order, with no
  // role. The path in the description is the antecedent the name cannot carry.
  const label = $derived(kind === "file" ? "Preview this file" : "Browse this folder");
  const hint = $derived(
    kind === "file" ? `Click to preview ${path}` : `Click to browse ${path}`,
  );
</script>

<!-- The badge is a shadcn Button wrapped in a shadcn Tooltip, following CodeCopyButton.
     The button stays the absolutely-positioned element (inline top/left from
     DiffPlanView), so its `.ref-hint` surface is molded in place. `{...props}` from the
     tooltip trigger is spread first so the explicit handlers/label below win — which
     REPLACES bits-ui's own onpointerdown/onclick on the trigger (its press
     suppression and close-on-click). Nothing is lost: the badge unmounts itself on
     activation, and an unmounted trigger takes its tooltip with it. -->
<Tooltip.Provider delayDuration={300}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="icon"
          class="ref-hint"
          style="top: {top}px; left: {left}px;"
          aria-label={label}
          data-ref-hint=""
          onpointerdown={(event) => event.stopPropagation()}
          onclick={(event) => {
            // Keep the click off the diff surface beneath (line-click commenting / drag).
            event.stopPropagation();
            onActivate();
          }}
        />
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{hint}</Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>

<style>
  /* `.ref-hint` is handed to <Button>, so it carries no Svelte scope hash and is styled
     via :global. These unlayered rules mold the Button's surface in place — they beat the
     Button recipe's layered Tailwind utilities, so what is left of the control is the dot
     itself. The unlayered box-shadow also suppresses the recipe's focus ring, so focus is
     shown by the explicit outline below. */
  :global(.ref-hint) {
    position: absolute;
    /* Sits ON the token's top-right corner rather than beside it, so the dot marks the
       reference without displacing a character cell. Centred on the corner and then
       pulled back in along both axes: the reference wears a rounded chip, and a dot
       centred exactly on the corner point reads as detached because the radius curves
       away beneath it. Biting into the corner instead reads as attached, and leaves
       only a sliver overhanging the chip. */
    transform: translate(calc(-50% - 0.2rem), calc(-50% + 0.2rem));
    /* A 24px pointer target (WCAG 2.5.8) around a ~9.6px dot: the padding is
       transparent because background-clip stops the fill at the content box, so the
       target is legal without the affordance being that big. */
    width: 1.5rem;
    height: 1.5rem;
    padding: 0.45rem;
    border: 0;
    border-radius: 50%;
    background: var(--attention);
    background-clip: content-box;
    box-shadow: none;
    /* Over the plan rows and the comment-span bracket rails (which take the default
       layer), under the code-copy chip (4) and the drawer. Shared with the plan's
       own rails — .drag-readout-rail, .drag-hint and .visual-hint are all 3 and all
       later in DOM order, so each paints over the badge where they overlap. That is
       the right way round: every one of them is transient, and the badge is what the
       reviewer can come back to. */
    z-index: 3;
  }

  :global(.ref-hint:focus-visible) {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
  }

  /* The teaching ping: a ring that grows out of the dot and fades out. It rests at
     opacity 0, so the dot's static base style is all there is when the animation does not
     run — which is why there is no local @media (prefers-reduced-motion) here. app.css's
     single global guard covers the light DOM under #app and collapses this to one 0.01ms
     iteration, leaving the quiet dot and no wave.
     scale(2.4) lands the ring on the button's own 24px box, so the wave never spills past
     the badge's hit area. Three pings rather than an infinite loop: the badge teaches
     once, then goes quiet whether or not the reviewer looked. The 1.6s is an ambient-scale
     literal, not a --dur-* token — svelte-rules § Motion principles carves ambient
     animations out of the ≤200ms one-shot vocabulary. */
  :global(.ref-hint)::after {
    content: '';
    position: absolute;
    inset: 0.45rem;
    border: 1px solid var(--attention);
    border-radius: 50%;
    opacity: 0;
    animation: ref-hint-ping 1.6s var(--ease-out) 3;
  }

  /* Global keyframe: referenced from the :global(.ref-hint) rule above, so it can't be
     Svelte-scoped or the name would mismatch and the ping wouldn't play. */
  @keyframes -global-ref-hint-ping {
    from {
      opacity: 0.6;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(2.4);
    }
  }
</style>
