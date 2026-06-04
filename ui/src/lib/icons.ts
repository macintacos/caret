// The vendored Lucide icon registry. Each name maps 1:1 to a verbatim SVG at
// ui/src/icons/<name>.svg (EXC-395); icons.test.ts enforces the bijection and
// per-file invariants. Adding an icon: see .claude/rules/icon-rules.md.
export const ICON_NAMES = [
  "check",
  "chevron-down",
  "command",
  "corner-down-left",
  "corner-up-left",
  "unplug",
] as const;

export type IconName = (typeof ICON_NAMES)[number];
