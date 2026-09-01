// Standing gate on bun.lock carrying no duplicate version that bun can collapse
// (EXC-1216). A duplicate is not neutral churn here: CodeMirror's extension system is
// identity-based, so a second physical copy of @codemirror/state (or view, language,
// @lezer/common) hands EditorState.create an extension set it does not recognise as
// its own, MarkdownEditor.svelte never constructs, and a reviewer sees the Notes label
// above an empty bordered box. Nothing in that failure names a version, which is why
// it is worth failing `bun test` over rather than trusting a contributor to remember a
// cleanup pass.
//
// `bun dedupe --check` is the instrument, rather than a re-implementation that reads
// the lock itself, because deciding "could this duplicate be collapsed?" is
// re-resolution and bun already does it: ~170 ms, writes nothing, and offline — it
// only re-resolves onto versions bun.lock already names, so it still reports correctly
// with the registry unreachable.
//
// The binary is `process.execPath`, never a bare "bun". `dedupe` is new in bun 1.4,
// and a "bun" resolved off PATH outside this repo lands on an older mise-managed
// install that answers `error: Script not found "dedupe"`. `process.execPath` is
// always the binary running this suite, which under `mise run test` is the 1.4 install
// mise.toml pins.
//
// This gate and codemirror-single-copy.test.ts are complementary rather than nested.
// This one is repo-wide and catches every duplicate that CAN be collapsed by
// re-resolving onto a version already in the lock; that one catches a split
// @codemirror/* set even where no single version satisfies every range — precisely the
// case its header records dedupe declining. Neither reads the resolved node_modules
// tree, which is why ui/vite.config.ts still carries its `resolve.dedupe` block.
import { expect, test } from "bun:test";
import { join } from "node:path";

// The suite sits at test/structure/, two levels below the repo root; resolving against
// import.meta.dir reads the real tree regardless of the runner's cwd.
const REPO_ROOT = join(import.meta.dir, "..", "..");

const { exitCode, stdout, stderr } = Bun.spawnSync([process.execPath, "dedupe", "--check"], {
  cwd: REPO_ROOT,
  stdout: "pipe",
  stderr: "pipe",
});
const report = stdout.toString();

/** bun's own report says `N duplicate versions can be removed` and nothing about what a
 * duplicate costs, so the gate owns the explanation and the remedy. */
const DUPLICATE_HINT = [
  "bun.lock resolves a package to more than one version where one would do.",
  "",
  "A duplicated CodeMirror copy (@codemirror/* or @lezer/common) breaks the annotation",
  "editor: the extension system is identity-based, so EditorState.create rejects the",
  "set, MarkdownEditor.svelte never constructs, and the Notes field renders as an empty",
  "bordered box with no error naming a version.",
  "",
  "Fix: run `bun dedupe` at the repo root and commit the resulting bun.lock.",
].join("\n");

test("`bun dedupe --check` actually ran", () => {
  // An older bun answers `error: Script not found "dedupe"` on stderr and exits
  // non-zero with nothing on stdout, which the assertion below would otherwise report
  // as a dirty lockfile. bun writes its whole report to stdout, so an empty stdout is
  // that misfire and nothing else.
  expect(report.trim() === "" ? stderr.toString().trim() : "").toBe("");
});

test("bun.lock carries no collapsible duplicate versions", () => {
  // Asserting against "" puts the hint AND bun's own report in the failure diff.
  expect(exitCode === 0 ? "" : `${DUPLICATE_HINT}\n\n${report}`).toBe("");
});
