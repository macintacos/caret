#!/usr/bin/env bash
#
# caret installer — builds caret on your machine and registers it with Claude
# Code through the native plugin system, so you never need `claude --plugin-dir`.
#
#   curl -fsSL https://raw.githubusercontent.com/macintacos/caret/trunk/scripts/install.sh | bash
#
# It clones caret at its latest release tag (vX.Y.Z) — no manual `git clone`
# needed — builds the platform-specific binary, and installs it as a plugin.
# Re-run any time to update — it fetches the latest release, rebuilds, and
# reinstalls. Requires `git`, `bun` (https://bun.sh), and `claude`.

set -euo pipefail

REPO_URL="https://github.com/macintacos/caret.git"
MARKETPLACE="caret"
PLUGIN="caret"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
err() { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; }

require() {
  command -v "$1" >/dev/null 2>&1 || {
    err "missing \`$1\` — $2"
    exit 1
  }
}

require git "install git, then re-run"
require bun "install Bun from https://bun.sh, then re-run"
require claude "install Claude Code (https://claude.com/claude-code), then re-run"

# Latest published release tag (vX.Y.Z), newest first — mirrors the sort used by
# the release tooling in scripts/release/git.ts.
latest_release_tag() {
  local out ref
  out="$(git ls-remote --tags --refs --sort=-v:refname "$REPO_URL" 'v*.*.*' 2>/dev/null || true)"
  ref="${out%%$'\n'*}"     # first line: "<sha>\trefs/tags/vX.Y.Z"
  printf '%s' "${ref##*/}" # strip through the last slash -> "vX.Y.Z"
}

# Source resolution: if this script is being run from a file inside an existing
# caret checkout (dev, or already cloned), build that checkout in place.
# Otherwise clone (or fast-forward) into a stable data directory.
REPO_DIR=""
src="${BASH_SOURCE[0]:-}"
if [ -n "$src" ] && [ -f "$src" ]; then
  candidate="$(cd "$(dirname "$src")/.." 2>/dev/null && pwd || true)"
  if [ -n "$candidate" ] && [ -f "$candidate/.claude-plugin/marketplace.json" ]; then
    REPO_DIR="$candidate"
    ref_desc="$(git -C "$REPO_DIR" describe --tags --always --dirty 2>/dev/null || echo 'unknown ref')"
    info "Using the local caret checkout at $REPO_DIR — building $ref_desc, not a published release"
  fi
fi
if [ -z "$REPO_DIR" ]; then
  REPO_DIR="${CARET_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/caret}"

  tag="$(latest_release_tag)"
  if [ -z "$tag" ]; then
    err "no caret release tags (vX.Y.Z) found at $REPO_URL — the release process may not have run yet"
    exit 1
  fi

  if [ -d "$REPO_DIR/.git" ]; then
    info "Updating caret in $REPO_DIR to release $tag"
    git -C "$REPO_DIR" fetch --depth 1 --force origin "refs/tags/$tag:refs/tags/$tag"
    git -C "$REPO_DIR" checkout --quiet --detach "$tag"
  else
    info "Cloning caret release $tag into $REPO_DIR"
    git clone --depth 1 --branch "$tag" "$REPO_URL" "$REPO_DIR"
  fi
fi

cd "$REPO_DIR"

info "Installing build dependencies (bun install)"
bun install

info "Building the UI and the caret binary (platform-specific)"
(cd ui && bunx vite build)
bun build --compile --outfile bin/caret src/cli.ts
# Keep a copy of the UI beside the binary as a runtime fallback.
cp ui/dist/index.html bin/index.html

[ -x bin/caret ] || {
  err "build did not produce bin/caret"
  exit 1
}

info "Registering caret with Claude Code"
# Register caret's directory as a local marketplace (idempotent).
claude plugin marketplace add "$REPO_DIR" 2>/dev/null ||
  claude plugin marketplace update "$MARKETPLACE" >/dev/null
# Reinstall so the freshly built binary always lands in the plugin cache, even
# when the version is unchanged.
claude plugin uninstall "${PLUGIN}@${MARKETPLACE}" >/dev/null 2>&1 || true
claude plugin install "${PLUGIN}@${MARKETPLACE}" --scope user >/dev/null
claude plugin enable "${PLUGIN}@${MARKETPLACE}" >/dev/null 2>&1 || true

echo
info "caret installed. Restart Claude Code (or run /reload-plugins), then try /caret:demo."
