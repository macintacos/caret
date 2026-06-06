// The built single-file UI, embedded as a text asset. `bun build --compile`
// inlines this into the binary (verified: it survives deletion of the source
// HTML). Imported dynamically by the daemon so a dev run without a UI build (or
// a fresh checkout where ui/dist/ is absent) falls back gracefully instead of
// failing to start.
import html from "../ui/dist/index.html" with { type: "text" };

// With `with { type: "text" }` the runtime value is the HTML string, but
// @types/bun types `*.html` imports as HTMLBundle. `String()` both narrows the
// static type to `string` and is an identity at runtime (the value is already a
// string) — typed, with no `as unknown as string` double-cast.
export default String(html);
