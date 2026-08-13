// Stub for shiki/wasm and the two bundled theme collections — @pierre/theme/*
// and @shikijs/themes/* — that @pierre/diffs references but caret never uses.
// vite.config.ts aliases those specifiers here so their payloads stay out of the
// build.
//
// caret highlights with shiki's pure-JS regex engine (diffview/shiki-bundle.ts),
// so the Oniguruma WASM binary the library would lazy-load for the `shiki-wasm`
// engine (~600 KB) is dead weight — the wrapper never selects that engine.
// caret also renders only its own palettes (registered as custom themes via
// registerCustomTheme in diffview/theme.ts) and names one of them on both the
// light and dark slots (caretDiffTheme), so neither collection @pierre/theming
// assembles is ever resolved: not the library's own pierre-* palettes, and not
// the ~76 shiki themes it pairs them with (~1.8 MB across one chunk per theme).
//
// These exports satisfy the static import graph while contributing no payload. A
// throwing default makes any future switch to the WASM engine or a bundled theme
// fail loudly here, pointing back at this stub, rather than silently shipping the
// dropped bytes again.
const unavailable = () => {
  throw new Error(
    "shiki/wasm, @pierre/theme and @shikijs/themes are stubbed out of the caret UI " +
      "build (diffview/unused-shiki-extras.ts): caret uses the JS regex engine and " +
      "its own themes. Remove the alias in ui/vite.config.ts to restore them.",
  );
};

export default unavailable;
export const getWasmInstance = unavailable;
export const wasmBinary = undefined;
