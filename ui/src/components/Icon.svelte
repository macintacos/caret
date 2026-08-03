<script lang="ts">
  // Renders one vendored Lucide SVG (ui/src/icons/, see doc/agents/icon-rules.md). The
  // imports are static `?raw` strings so the markup ships inside the JS bundle —
  // no per-icon network round-trip, no emitted asset to manage, and the fixed
  // small registry means a dynamic import would buy nothing. The SVGs stay
  // verbatim: sizing is CSS on the wrapper (overriding the files' width/height
  // attributes), and color rides on stroke="currentColor" from the parent's `color`.
  import arrowBigUp from "@/icons/arrow-big-up.svg?raw";
  import bell from "@/icons/bell.svg?raw";
  import bellOff from "@/icons/bell-off.svg?raw";
  import check from "@/icons/check.svg?raw";
  import chevronDown from "@/icons/chevron-down.svg?raw";
  import chevronRight from "@/icons/chevron-right.svg?raw";
  import circleQuestionMark from "@/icons/circle-question-mark.svg?raw";
  import command from "@/icons/command.svg?raw";
  import copy from "@/icons/copy.svg?raw";
  import cornerDownLeft from "@/icons/corner-down-left.svg?raw";
  import cornerUpLeft from "@/icons/corner-up-left.svg?raw";
  import ellipsis from "@/icons/ellipsis.svg?raw";
  import file from "@/icons/file.svg?raw";
  import gitCompare from "@/icons/git-compare.svg?raw";
  import keyboard from "@/icons/keyboard.svg?raw";
  import monitor from "@/icons/monitor.svg?raw";
  import moon from "@/icons/moon.svg?raw";
  import panelLeft from "@/icons/panel-left.svg?raw";
  import settings from "@/icons/settings.svg?raw";
  import sun from "@/icons/sun.svg?raw";
  import trash2 from "@/icons/trash-2.svg?raw";
  import unplug from "@/icons/unplug.svg?raw";
  import x from "@/icons/x.svg?raw";
  import type { IconName } from "$lib/icons.ts";

  const SVGS: Record<IconName, string> = {
    "arrow-big-up": arrowBigUp,
    bell,
    "bell-off": bellOff,
    check,
    "chevron-down": chevronDown,
    "chevron-right": chevronRight,
    "circle-question-mark": circleQuestionMark,
    command,
    copy,
    "corner-down-left": cornerDownLeft,
    "corner-up-left": cornerUpLeft,
    ellipsis,
    file,
    "git-compare": gitCompare,
    keyboard,
    monitor,
    moon,
    "panel-left": panelLeft,
    settings,
    sun,
    "trash-2": trash2,
    unplug,
    x,
  };

  interface Props {
    name: IconName;
    /** Rendered square size in px. */
    size?: number;
    /** Accessible label; omitted = decorative (aria-hidden). */
    label?: string;
  }
  let { name, size = 16, label }: Props = $props();
</script>

<span
  class="icon"
  style="width: {size}px; height: {size}px;"
  role={label ? "img" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
>
  {@html SVGS[name]}
</span>

<style>
  .icon {
    display: inline-flex;
    flex: none;
  }
  /* Scoped under .icon: scale the verbatim 24x24 SVG to the wrapper. */
  .icon :global(svg) {
    width: 100%;
    height: 100%;
  }
</style>
