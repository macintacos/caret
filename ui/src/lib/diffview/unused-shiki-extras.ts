// Stub for shiki/wasm, the @pierre/theme/* bundles, and shiki's @shikijs/themes/*
// that @pierre/diffs and shiki statically reference but caret never uses. vite.config.ts aliases those
// specifiers here so their payloads stay out of the build.
//
// caret highlights with shiki's pure-JS regex engine (diffview/shiki-bundle.ts),
// so the Oniguruma WASM binary the `shiki-wasm` engine would lazy-load (~600 KB) is
// never fetched, and it renders only its own palettes (registered via
// registerCustomTheme in diffview/theme.ts), so neither library's bundled theme
// loaders are ever invoked.
const unavailable = () => {
  throw new Error(
    "shiki/wasm, @pierre/theme and @shikijs/themes bundles are stubbed out of the caret UI build " +
      "(diffview/unused-shiki-extras.ts): caret uses the JS regex engine and its " +
      "own themes. Remove the alias in ui/vite.config.ts to restore them.",
  );
};

export default unavailable;
export const getWasmInstance = unavailable;
export const wasmBinary = undefined;
