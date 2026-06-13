// Stub for shiki/wasm and the @pierre/theme/* bundles that @pierre/diffs
// statically references but caret never uses. vite.config.ts aliases those
// specifiers here so their payloads stay out of the build.
//
// caret highlights with shiki's pure-JS regex engine (diffview/shiki-bundle.ts),
// so the Oniguruma WASM binary the library would lazy-load for the `shiki-wasm`
// engine (~600 KB) is dead weight — the wrapper never selects that engine.
// caret also renders only its own caret-light / caret-dark themes (registered via
// registerCustomTheme in diffview/theme.ts), so the library's bundled pierre-*
// theme loaders are never invoked.
//
// These exports satisfy the static import graph while contributing no payload. A
// throwing default makes any future switch to the WASM engine or a pierre theme
// fail loudly here, pointing back at this stub, rather than silently shipping the
// dropped bytes again.
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
