// Standing gate on bun.lock carrying no duplicate version that bun can collapse
// (EXC-1216). Most duplicates are inert churn; the class that is not is CodeMirror's, and
// DUPLICATE_HINT below carries that story because it is the text a failing run actually
// prints. What makes the rule worth failing `bun test` over rather than trusting a
// contributor to remember a cleanup pass is that nothing in the resulting failure names a
// version — a duplicate that does break something breaks it silently.
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

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");

const { exitCode, stdout, stderr } = Bun.spawnSync([process.execPath, "dedupe", "--check"], {
  cwd: REPO_ROOT,
  stdout: "pipe",
  stderr: "pipe",
});
const report = stdout.toString();
const failure = stderr.toString().trim();

/** bun's own report says `N duplicate versions can be removed` and ends with a bare
 * `bun dedupe`, so the gate owns the cost a duplicate carries and sharpens that one-word
 * remedy into a committable one. */
const DUPLICATE_HINT = [
  "bun.lock resolves a package to more than one version where one would do.",
  "The versions bun would collapse are listed below.",
  "",
  "Most duplicates are inert; one class is not, and it is why this is a gate. CodeMirror's",
  "extension system is identity-based, so a second copy of @codemirror/* or @lezer/common",
  "makes EditorState.create reject the extension set — MarkdownEditor.svelte never",
  "constructs and the Notes field renders as an empty bordered box, with no error naming a",
  "version. Keeping the lock collapsed is what keeps that class out.",
  "",
  "Fix: run `bun dedupe` at the repo root and commit the resulting bun.lock.",
].join("\n");

test("`bun dedupe --check` ran a real check", () => {
  // bun exits 1 without checking anything in three cases the duplicate assertion below
  // would otherwise report as a dirty lockfile: an older bun with no `dedupe` subcommand
  // (`Script not found`), a missing bun.lock, and a bun.lock that no longer matches
  // package.json — the shape a package.json edit leaves behind until `bun install` runs.
  // Each is announced on stderr, which a completed check leaves empty; the version banner
  // bun prints to stdout even on those errors is why stdout cannot be the signal.
  expect(failure).toBe("");
});

test("bun.lock carries no collapsible duplicate versions", () => {
  // Asserting against "" puts the hint AND bun's own report in the failure diff.
  expect(exitCode === 0 ? "" : `${DUPLICATE_HINT}\n\n${report}`).toBe("");
});
