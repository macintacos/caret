// The OpenCode v2 TUI host provides this module at runtime; nothing installs it.
declare module "@opentui/solid" {
  function createElement(tag: "text"): unknown;
  function insert(parent: unknown, accessor: () => string): unknown;
}
