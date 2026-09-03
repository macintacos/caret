// Claude-specific env isolation: point CLAUDE_CONFIG_DIR at a throwaway temp
// dir's "claude" subdirectory for each test, so an install probe or skill
// enumerator reads disposable state, never the real ~/.claude.
import { afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Wire a fresh throwaway CLAUDE_CONFIG_DIR for each test in the calling file: a
 * new temp root is created in beforeEach, CLAUDE_CONFIG_DIR pointed at its
 * "claude" subdirectory, and both removed/restored in afterEach. The returned
 * accessor yields the temp root, so a caller can seed sibling directories (e.g.
 * a reviewed project) beside "claude".
 */
export function setupTempClaudeConfigDir(prefix = "caret-claude-"): () => string {
  let tmp: string;
  let saved: string | undefined;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), prefix));
    saved = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = join(tmp, "claude");
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    await rm(tmp, { recursive: true, force: true });
  });
  return () => tmp;
}
