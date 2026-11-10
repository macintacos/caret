import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

// pi's UNICODE_SPACES (utils/paths.js), which its edit and write tools turn into " ".
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/** Whether a write to `path`, resolved against `cwd` as pi's edit and write tools resolve
 * it, lands inside `dir`. Fails closed: false whenever that can't be told. */
export function landsInside(path: string, cwd: string, dir: string): boolean {
  try {
    const normalized = expandHome(path.replace(UNICODE_SPACES, " ").replace(/^@/, ""));
    return realPathOf(resolve(cwd, normalized)).startsWith(realPathOf(dir) + sep);
  } catch {
    return false;
  }
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

/** The nearest existing ancestor's real path, plus the segments below it. Throws on an
 * existing entry that won't resolve (a dangling symlink, a loop). */
function realPathOf(path: string): string {
  const rest: string[] = [];
  let at = path;
  while (!lstatSync(at, { throwIfNoEntry: false })) {
    rest.unshift(basename(at));
    at = dirname(at);
  }
  // .native: Node's JS realpathSync keeps the input's case on macOS.
  return join(realpathSync.native(at), ...rest);
}
