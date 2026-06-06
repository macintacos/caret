// Test-only preload: compiles `.svelte` (and `.svelte.ts` runes) modules to
// client-side output so the component suite can mount them under happy-dom with
// Svelte 5's `mount()`/`unmount()`.
//
// Why a hand-rolled plugin over the official bun-plugin-svelte: that plugin
// defaults to server-side generation outside Bun's dev server (so `mount()`
// throws "not available on the server") and emits scoped CSS as a virtual
// `bun-svelte:*.css` module whose namespace round-trip is unresolved under
// `bun test` ("Virtual CSS module not found"). This plugin sidesteps both by
// calling svelte's own compiler with `generate: "client"` and `css: "injected"`
// (styles inline into the JS — no virtual module), which is all the component
// units need: render output, prop wiring, conditional branches, a11y
// attributes. Pixel layout and real-browser behavior stay in the e2e suite.
//
// Scoped to `.svelte`/`.svelte.ts` onLoad filters, so it is inert for the
// backend suite. The browser export condition (svelte's client runtime entry)
// is supplied by the `--conditions browser` flag on the test command; the
// backend suite passes unchanged under it.
import { compile, compileModule } from "svelte/compiler";

const ts = new Bun.Transpiler({ loader: "ts" });

Bun.plugin({
  name: "svelte-test",
  setup(builder) {
    builder.onLoad({ filter: /\.svelte$/ }, async (args) => {
      const source = await Bun.file(args.path).text();
      const { js } = compile(source, {
        filename: args.path,
        generate: "client",
        css: "injected",
        dev: true,
      });
      return { contents: js.code, loader: "js" };
    });
    builder.onLoad({ filter: /\.svelte\.[tj]s$/ }, async (args) => {
      let source = await Bun.file(args.path).text();
      if (args.path.endsWith(".ts")) source = ts.transformSync(source);
      const { js } = compileModule(source, {
        filename: args.path,
        generate: "client",
        dev: true,
      });
      return { contents: js.code, loader: "js" };
    });
  },
});
