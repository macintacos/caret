// The planning gate's path containment. Imports node: builtins only and uses erasable
// syntax only: test/pi/gate.test.ts loads it under plain Node, where pi runs.
import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

// pi's UNICODE_SPACES (utils/paths.js), which its edit and write tools turn into " ".
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/** Whether a write to `path`, resolved against `cwd` as pi's edit and write tools resolve
 * it, lands inside `dir`. Fails closed: false whenever that can't be told, and for a
 * `file:` URL, the one pi normalisation it does not mirror. */
export function landsInside(path: string, cwd: string, dir: string): boolean {
  try {
    if (/^file:\/\//.test(normalize(path))) return false;
    return realPathOf(resolveLikePi(path, cwd)).startsWith(realPathOf(dir) + sep);
  } catch {
    return false;
  }
}

/** `path` resolved lexically against `cwd`, as pi's tools resolve it. */
export function resolveLikePi(path: string, cwd: string): string {
  return resolve(cwd, expandHome(normalize(path)));
}

function normalize(path: string): string {
  return path.replace(UNICODE_SPACES, " ").replace(/^@/, "");
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

/** The nearest existing ancestor's real path, plus the segments below it. Throws on an
 * existing entry that won't resolve (a dangling symlink, a loop) or a missing root. */
function realPathOf(path: string): string {
  const rest: string[] = [];
  let at = path;
  while (!lstatSync(at, { throwIfNoEntry: false })) {
    // An absent win32 root (an unmapped drive) is its own dirname.
    if (dirname(at) === at) throw new Error(`no such root: ${at}`);
    rest.unshift(basename(at));
    at = dirname(at);
  }
  // .native: Node's JS realpathSync keeps the input's case on macOS.
  return join(realpathSync.native(at), ...rest);
}
