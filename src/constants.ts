// Cross-cutting constants with no behavior. Pure TS, no node imports — so the
// browser singlefile build and config files (ui/vite.config.ts) can import these
// without dragging in the daemon's node-only dependency chain.

/** Default daemon port — the [daemon].port schema default (EXC-430). */
export const DEFAULT_PORT = 42718;
