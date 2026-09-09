#!/usr/bin/env bats
#
# Hermetic tests for bin/caret-launcher — the stable launcher a service unit
# names forever (EXC-1160). Each case builds a throwaway machine under bats'
# per-test $BATS_TEST_TMPDIR: the two agent cache roots the launcher globs,
# caret's state dir, and a PATH holding nothing but stubs and the coreutils the
# launcher shells out to. The subject runs under `env -i`, so nothing of the
# developer's real environment leaks in.
#
#   mise run test bats scripts/caret-launcher.bats
#
# `run -<status>` asserts the exit code inline, which is why 1.5.0 is the floor.

bats_require_minimum_version 1.5.0

setup_file() {
  LAUNCHER="$(cd "$(dirname "$BATS_TEST_FILENAME")/../bin" && pwd)/caret-launcher"
  BASH_BIN="$(command -v bash)"
  export LAUNCHER BASH_BIN
}

# A throwaway machine with both agent cache roots and caret's state dir. The stub
# PATH carries only the tools the launcher itself invokes. bats removes
# $BATS_TEST_TMPDIR after each test, so no case cleans up after itself.
setup() {
  home="$BATS_TEST_TMPDIR/machine"
  mkdir -p "$home/bin" "$home/.claude/plugins/cache/caret/caret" \
    "$home/.cache/opencode/packages/@macintacos" "$home/.local/state/caret/launcher"
  local tool tool_path
  for tool in basename chmod cut dirname head id mkdir rm sed sleep sort tail uname; do
    tool_path="$(command -v "$tool" 2>/dev/null || true)"
    [ -n "$tool_path" ] && ln -s "$tool_path" "$home/bin/$tool"
  done
  # The loop's last test decides setup's status, and a missing tool would fail
  # every case rather than the one that needed it.
  return 0
}

# A fake caret install at $1 declaring version $2. Its bin/caret echoes a tag and
# the PATH it inherited, so an assertion names which root was exec'd and proves
# the launcher's one load-bearing line — bun's dir prepended for a supervisor
# whose PATH is bare.
seed_caret() {
  mkdir -p "$1/bin"
  printf '{\n  "version": "%s"\n}\n' "$2" >"$1/package.json"
  cat >"$1/bin/caret" <<CARET
#!$BASH_BIN
echo "CARET $2 \$* PATH=\$PATH"
CARET
  chmod +x "$1/bin/caret"
}

# A bun the launcher can find, recorded the way installLauncher records it.
stub_bun() {
  printf '#!/bin/sh\nexit 0\n' >"$home/bin/bun"
  chmod +x "$home/bin/bun"
  printf '%s\n' "$home/bin/bun" >"$home/.local/state/caret/launcher/bun-path"
}

# launchctl / systemctl the launcher can call without touching the real machine.
stub_service() {
  local tool
  for tool in launchctl systemctl; do
    printf '#!/bin/sh\nexit 0\n' >"$home/bin/$tool"
    chmod +x "$home/bin/$tool"
  done
}

# BSD and GNU stat disagree on the flag. GNU first, because its `-f` prints file
# system status on stdout rather than failing cleanly, which would poison the
# capture; BSD rejects `-c` outright.
stat_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

# The unit file the launcher derives from the `service` record on this OS.
unit_path() {
  if [ "$(uname)" = Darwin ]; then
    printf '%s' "$home/Library/LaunchAgents/$1.plist"
  else
    printf '%s' "$home/.config/systemd/user/$1"
  fi
}

launcher() {
  env -i PATH="$home/bin" HOME="$home" \
    XDG_STATE_HOME="$home/.local/state" \
    XDG_CACHE_HOME="$home/.cache" \
    XDG_CONFIG_HOME="$home/.config" \
    CLAUDE_CONFIG_DIR="$home/.claude" \
    CARET_SUPERVISED="${CARET_SUPERVISED:-}" \
    "$BASH_BIN" "$LAUNCHER" "$@"
}

# The launcher as a generated unit starts it. The variable is what gates the log
# preamble, so every case below asserts on the file rather than on $output.
launcher_supervised() { CARET_SUPERVISED=1 launcher "$@"; }

# 0.9.0 alongside 0.14.0 is the pair a lexicographic sort gets wrong.
@test "highest version wins within one Claude root" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.9.0" 0.9.0
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.11.1" 0.11.1
  run -0 launcher
  [[ "$output" == *"CARET 0.14.0"* ]]
}

@test "bun's directory is prepended to the child's PATH" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  run -0 launcher
  [[ "$output" == *"PATH=$home/bin:"* ]]
}

@test "highest version wins regardless of which agent installed it" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  seed_caret "$home/.cache/opencode/packages/@macintacos/caret/node_modules/@macintacos/caret" 0.15.0
  run -0 launcher
  [[ "$output" == *"CARET 0.15.0"* ]]
}

# OpenCode names the dir after the verbatim `plugin` specifier, so the version
# has to come from package.json one level down.
@test "an @latest-named OpenCode dir resolves through node_modules" {
  stub_bun
  seed_caret "$home/.cache/opencode/packages/@macintacos/caret@latest/node_modules/@macintacos/caret" 0.11.0
  run -0 launcher
  [[ "$output" == *"CARET 0.11.0"* ]]
}

@test "a pinned root beats a higher installed version" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  seed_caret "$home/checkout" 0.1.0
  printf '%s\n' "$home/checkout" >"$home/.local/state/caret/launcher/pinned-root"
  run -0 launcher
  [[ "$output" == *"CARET 0.1.0"* ]]
}

@test "a pin whose target is gone falls through to semver-max" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  printf '%s\n' "$home/gone" >"$home/.local/state/caret/launcher/pinned-root"
  run -0 launcher
  [[ "$output" == *"CARET 0.14.0"* ]]
}

@test "argv is forwarded intact" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  run -0 launcher daemon --port 42718
  [[ "$output" == *"CARET 0.14.0 daemon --port 42718"* ]]
}

# `env -i` relocates HOME and the XDG roots, so four of the six search entries
# land in the sandbox — but /opt/homebrew/bin and /usr/local/bin are absolute and
# cannot be hidden.
@test "a machine with no bun exits 78, naming bun and where it searched" {
  if [ -x /opt/homebrew/bin/bun ] || [ -x /usr/local/bin/bun ]; then
    skip "a real bun sits on an absolute search path"
  fi
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  run -78 launcher
  [[ "$output" == *"no bun"* ]]
  [[ "$output" == *"$home/.bun/bin"* ]]
}

# A populated version dir with no runnable bin/caret is a bad install rather than
# an extraction caught mid-flight, so it is terminal on the first probe — only a
# total miss is worth waiting on, and only a total miss deletes anything.
@test "a version dir with no runnable bin/caret exits 78 without evicting or re-probing" {
  stub_bun
  stub_service
  printf 'dev.excessive.caret\n' >"$home/.local/state/caret/launcher/service"
  local broken="$home/.claude/plugins/cache/caret/caret/0.14.0"
  mkdir -p "$broken"
  printf '{\n  "version": "0.14.0"\n}\n' >"$broken/package.json"
  local start=$SECONDS
  run -78 launcher
  [[ "$output" == *"$broken"* ]]
  [ -e "$home/.local/state/caret/launcher" ]
  [ $((SECONDS - start)) -lt 5 ]
}

# Resolving it would exec-fail at 126, which is neither the terminal nor the
# eviction status, so the supervisor would respawn into it forever.
@test "a non-executable bin/caret exits 78 rather than exec-failing" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  chmod -x "$home/.claude/plugins/cache/caret/caret/0.14.0/bin/caret"
  run -78 launcher
}

@test "no caret anywhere evicts the launcher, its records, and its service unit" {
  stub_service
  mkdir -p "$home/.local/state/caret/bin"
  printf 'dev.excessive.caret\n' >"$home/.local/state/caret/launcher/service"
  local unit
  unit="$(unit_path dev.excessive.caret)"
  mkdir -p "$(dirname "$unit")"
  touch "$unit"
  run -0 launcher
  [ ! -e "$unit" ]
  [ ! -e "$home/.local/state/caret/bin" ]
  [ ! -e "$home/.local/state/caret/launcher" ]
}

# Nothing here installed a supervisor, so this launcher cannot know what still
# names it; deleting itself would leave whatever does respawning on ENOENT.
@test "no caret and no service record exits 78 rather than evicting" {
  stub_service
  mkdir -p "$home/.local/state/caret/bin"
  run -78 launcher
  [ -e "$home/.local/state/caret/bin" ]
}

# The sleep has to land between two probes, so it tracks the launcher's own 5s
# interval — change one and change the other. FD 3 is bats' own output channel;
# a background job that inherits it keeps bats waiting after the test ends.
@test "a caret that appears mid-probe is exec'd rather than evicted" {
  stub_bun
  stub_service
  mkdir -p "$home/.local/state/caret/bin"
  (sleep 6 && seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0) 3>&- &
  run -0 launcher
  wait
  [[ "$output" == *"CARET 0.14.0"* ]]
  [ -e "$home/.local/state/caret/bin" ]
}

@test "a supervised run creates logs/ and captures the child's output" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  run -0 launcher_supervised
  [ -d "$home/.local/state/caret/logs" ]
  [[ "$(cat "$home/.local/state/caret/logs/daemon-stderr.log")" == *"CARET 0.14.0"* ]]
}

@test "a supervised run leaves logs/ at 0700 and the log at 0600" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  run -0 launcher_supervised
  [ "$(stat_mode "$home/.local/state/caret/logs")" = 700 ]
  [ "$(stat_mode "$home/.local/state/caret/logs/daemon-stderr.log")" = 600 ]
}

# The upgraded-install case openDaemonStderr's own explicit chmod covers: a file
# opened at the supervisor's umask before this launcher carried the preamble.
@test "a supervised run tightens a log file an older install left world-readable" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  local logs="$home/.local/state/caret/logs"
  mkdir -p "$logs"
  touch "$logs/daemon-stderr.log"
  chmod 644 "$logs/daemon-stderr.log"
  run -0 launcher_supervised
  [ "$(stat_mode "$logs/daemon-stderr.log")" = 600 ]
}

# Every step of the preamble is guarded so this degrades to the supervisor's own
# stream; unguarded it would exit under `set -e`, which is a restart loop.
@test "an unwritable state dir still execs caret" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  chmod 500 "$home/.local/state/caret"
  run -0 launcher_supervised
  chmod 700 "$home/.local/state/caret"
  [[ "$output" == *"CARET 0.14.0"* ]]
}

@test "an unsupervised run keeps its output on the terminal" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  run -0 launcher
  [[ "$output" == *"CARET 0.14.0"* ]]
  [ ! -e "$home/.local/state/caret/logs" ]
}
