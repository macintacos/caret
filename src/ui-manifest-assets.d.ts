// Ambient types for the build-generated embed manifest's asset imports (EXC-522).
// The generated module (src/ui-manifest.generated.ts) imports each built UI file
// with `with { type: "file" }`, whose runtime value is the embedded file's path
// string — but @types/bun keys its `*.html`/`*.txt`/… declarations on extension,
// not on the import attribute, so it has no declaration for `*.css`/`*.js` here.
// Declare them as the path strings they resolve to at runtime; the `.html`
// HTMLBundle mistype is narrowed at the use site with String() in the generated
// module — identity on an already-string value.
declare module "*.css" {
  const path: string;
  export default path;
}

declare module "*.js" {
  const path: string;
  export default path;
}

// The generated manifest module itself (src/ui-manifest.generated.ts) is
// gitignored and only emitted by the build task, so it's absent on a clean
// checkout where the type gate (`tsc --noEmit`) still runs. This ambient
// declaration lets loadUiAssets' dynamic import resolve without it; when the
// real module is present, TypeScript types against it instead.
declare module "*/ui-manifest.generated.ts" {
  export const UI_MANIFEST: Record<string, string>;
}
