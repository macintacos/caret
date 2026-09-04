// Stub for shiki/wasm and the @pierre/theme/* bundles that @pierre/diffs
// statically references but caret never uses. vite.config.ts aliases those
// specifiers here so their payloads stay out of the build.
//
// caret highlights with shiki's pure-JS regex engine (diffview/shiki-bundle.ts),
// so the Oniguruma WASM binary the `shiki-wasm` engine would lazy-load (~600 KB) is
// never fetched, and it renders only its own palettes (registered via
// registerCustomTheme in diffview/theme.ts), so the library's bundled pierre-* theme
// loaders are never invoked.
const unavailable = () => {
  throw new Error(
    "shiki/wasm and @pierre/theme bundles are stubbed out of the caret UI build " +
      "(diffview/unused-shiki-extras.ts): caret uses the JS regex engine and its " +
      "own themes. Remove the alias in ui/vite.config.ts to restore them.",
  );
};

export default unavailable;
export const getWasmInstance = unavailable;
export const wasmBinary = undefined;
