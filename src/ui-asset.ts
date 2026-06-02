// The built single-file UI, embedded as a text asset. `bun build --compile`
// inlines this into the binary (verified: it survives deletion of the source
// HTML). Imported dynamically by the daemon so a dev run without a UI build (or
// a fresh checkout where ui/dist/ is absent) falls back gracefully instead of
// failing to start.
import html from "../ui/dist/index.html" with { type: "text" };

// With `type: "text"` the runtime value is the HTML string, but @types/bun types
// `*.html` imports as HTMLBundle — narrow it back to string.
export default html as unknown as string;
