// The update `mise run dev --update <kind>` pretends is available (EXC-1452). A from-source
// build has no upstream to be behind, so without it the toast, the Updates pane's button
// and What's new never show in dev. The verdicts come from the real `updateStatusFor`, so
// their commands match what a real install is told.

import { prNumber } from "@/daemon/update-changes.ts";
import { updateStatusFor } from "@/daemon/update-check.ts";
import { parseVersionTriple } from "@/lib/semver.ts";
import type { BuildKind, UpdateChanges, UpdateReport, UpdateStatus } from "@/lib/types.ts";

/** The install kind the mock poses as, its verdict, and what What's new lists for it. */
export interface DevUpdate {
  install: BuildKind;
  status: UpdateStatus;
  changes: UpdateChanges;
}

/** The mock `raw` names (`release` or `commit`, from CARET_DEV_UPDATE), or null. Always
 * null off a dev build, so no installed caret can be made to claim an update. */
export function devUpdateFor(
  raw: string | undefined,
  identity: Pick<UpdateReport, "install" | "version" | "commit">,
): DevUpdate | null {
  if (identity.install !== "dev") return null;
  if (raw === "release") return releaseUpdate(identity.version, identity.commit);
  if (raw === "commit") return commitUpdate(identity.version, identity.commit);
  return null;
}

function releaseUpdate(version: string, commit: string): DevUpdate {
  const [major, minor, patch] = parseVersionTriple(version) ?? [0, 0, 0];
  const available = `${major}.${minor + 1}.0`;
  const releases = [
    { version: available, body: MINOR_NOTES },
    { version: `${major}.${minor}.${patch + 2}`, body: PATCH_NOTES },
    { version: `${major}.${minor}.${patch + 1}`, body: FIRST_PATCH_NOTES },
  ];
  return {
    install: "bundle",
    status: updateStatusFor({
      kind: "bundle",
      version,
      commit,
      npmLatest: available,
      release: null,
      aheadBy: null,
    }),
    changes: { kind: "releases", releases },
  };
}

function commitUpdate(version: string, commit: string): DevUpdate {
  const commits = COMMIT_SUBJECTS.map((subject, i) => ({
    sha: (i + 1).toString(16).repeat(40),
    subject,
    pr: prNumber(subject),
  }));
  const aheadBy = commits.length + UNLISTED_COMMITS;
  return {
    install: "binary",
    status: updateStatusFor({
      kind: "binary",
      version,
      commit,
      npmLatest: null,
      release: version,
      aheadBy,
    }),
    changes: { kind: "commits", commits, more: UNLISTED_COMMITS },
  };
}

const UNLISTED_COMMITS = 37;

const COMMIT_SUBJECTS = [
  "feat(ui): add a What's new dialog for caret updates (#603)",
  "fix(daemon): keep the update verdict across a config reload (#601)",
  "docs: describe the Updates pane in RUNNING",
  "refactor(review): split the store's rehydrate from its index (#598)",
  "fix(ui): stop the comment editor losing focus on a theme switch (#596)",
  "chore: bump Bun to 1.4.2",
  "test(e2e): cover the toast's action button (#593)",
];

const MINOR_NOTES = `This release adds a What's new dialog, so an update says what it brings before you install it.

### Added

- A **What's new** dialog, opened from the update toast and from Settings → Updates.
- \`caret doctor --json\` for scripted health checks.

### Changed

- The update toast no longer repeats the upgrade command; What's new carries it.
`;

const PATCH_NOTES = `### Fixed

- Fixed a crash when a plan opened with a fenced code block.
- Fixed [the README's](https://github.com/macintacos/caret#readme) install anchor.

To pick it up now:

\`\`\`sh
bunx --no-cache @macintacos/caret@latest install --refresh
\`\`\`
`;

const FIRST_PATCH_NOTES = `### Changed

- Updated release builds to Bun 1.4.2.
`;
