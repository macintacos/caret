// The OpenCode v2 TUI host provides this module at runtime; nothing installs it.
declare module "@opentui/solid" {
  function createElement(tag: "box" | "text" | "span" | "b"): unknown;
  function insertNode(parent: unknown, child: unknown): void;
  function insert(parent: unknown, value: string): unknown;
  function setProp<T>(node: unknown, name: string, value: T, prev?: T): T;
  function effect<T>(fn: (prev?: T) => T): void;
}
