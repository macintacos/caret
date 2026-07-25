// The injected collaborators the release orchestration runs against. Effectful
// dependencies (git, gh, fs) are passed in so each step is unit-testable with
// fakes; cli.ts wires the real ones.

import type { GitOps } from "@/tasks/release/git.ts";
import type { GitHubOps } from "@/tasks/release/github.ts";
import type { NpmOps } from "@/tasks/release/npm.ts";
import type { RumdlOps } from "@/tasks/release/rumdl.ts";

/** Read/write/exists over the working tree; injected for testability. */
export interface FsOps {
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** Diagnostics sink (stderr in the real CLI; silent in tests). */
export interface Io {
  log(message: string): void;
}

export interface Deps {
  git: GitOps;
  github: GitHubOps;
  npm: NpmOps;
  rumdl: RumdlOps;
  fs: FsOps;
  io: Io;
}
