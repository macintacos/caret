// The vendored Lucide icon registry. Each name maps 1:1 to a verbatim SVG at
// ui/src/icons/<name>.svg (EXC-395); icons.test.ts enforces the bijection and
// per-file invariants. Adding an icon: see doc/agents/icon-rules.md.
export const ICON_NAMES = [
  "arrow-big-up",
  "bell",
  "bell-off",
  "check",
  "chevron-down",
  "circle-question-mark",
  "command",
  "copy",
  "corner-down-left",
  "corner-up-left",
  "ellipsis",
  "file",
  "git-compare",
  "keyboard",
  "monitor",
  "moon",
  "panel-left",
  "settings",
  "sun",
  "trash-2",
  "unplug",
  "x",
] as const;

export type IconName = (typeof ICON_NAMES)[number];
