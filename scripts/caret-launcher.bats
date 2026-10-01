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
  CACHE_CASES="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)/test/core/commands/install/fixtures/launcher-caches.txt"
  BASH_BIN="$(command -v bash)"
  export LAUNCHER CACHE_CASES BASH_BIN
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
# whose PATH is bare. It carries a UI build, so the root is complete.
seed_caret() {
  mkdir -p "$1/bin" "$1/ui/dist"
  printf '<!doctype html>\n' >"$1/ui/dist/index.html"
  printf '{\n  "version": "%s"\n}\n' "$2" >"$1/package.json"
  cat >"$1/bin/caret" <<CARET
#!$BASH_BIN
echo "CARET $2 \$* PATH=\$PATH"
CARET
  chmod +x "$1/bin/caret"
}

# Seeds every line of shared cache case $1 under $home/.cache and prints its winning
# version.
seed_cache_case() {
  local name version path win
  while read -r name version path win; do
    case "$name" in '' | '#'*) continue ;; esac
    if [ "$name" != "$1" ]; then continue; fi
    seed_caret "$home/.cache/$path" "$version"
    if [ "$win" = win ]; then printf '%s' "$version"; fi
  done <"$CACHE_CASES"
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

# An installed service: the stubs, bin/, the `service` record, and its unit file,
# whose path lands in $unit.
seed_service() {
  stub_service
  mkdir -p "$home/.local/state/caret/bin"
  printf 'dev.excessive.caret\n' >"$home/.local/state/caret/launcher/service"
  unit="$(unit_path dev.excessive.caret)"
  mkdir -p "$(dirname "$unit")"
  touch "$unit"
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

# The launcher as a generated unit starts it. The variable gates the log preamble, so a
# supervised case reads the log file — unless it is proving the preamble degraded,
# where the output is back on $output.
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

# The same cases drive launcherCandidateDirs' suite, so the bash and TS rules cannot
# drift apart.
@test "every shared cache case runs the fixture's winner" {
  stub_bun
  local name seen=" " want
  while read -r name _; do
    case "$name" in '' | '#'*) continue ;; esac
    case "$seen" in *" $name "*) continue ;; esac
    seen="$seen$name "
    rm -rf "$home/.cache/opencode"
    want="$(seed_cache_case "$name")"
    run launcher </dev/null
    if [[ "$output" != *"CARET $want "* ]]; then
      echo "case $name: want $want, got: $output"
      return 1
    fi
  done <"$CACHE_CASES"
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

@test "a root with no UI build loses to a complete lower version" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  local partial="$home/.cache/opencode/packages/@macintacos/caret@latest/node_modules/@macintacos/caret"
  seed_caret "$partial" 0.15.0
  rm "$partial/ui/dist/index.html"
  run -0 launcher
  [[ "$output" == *"CARET 0.14.0"* ]]
}

@test "a pin with no UI build falls through to semver-max" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  seed_caret "$home/checkout" 0.1.0
  rm "$home/checkout/ui/dist/index.html"
  printf '%s\n' "$home/checkout" >"$home/.local/state/caret/launcher/pinned-root"
  run -0 launcher
  [[ "$output" == *"CARET 0.14.0"* ]]
}

@test "a pin with a compiled binary but no ui/dist stays pinned" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  seed_caret "$home/checkout" 0.1.0
  rm "$home/checkout/ui/dist/index.html"
  cp "$home/checkout/bin/caret" "$home/checkout/bin/caret-native"
  printf '%s\n' "$home/checkout" >"$home/.local/state/caret/launcher/pinned-root"
  run -0 launcher
  [[ "$output" == *"CARET 0.1.0"* ]]
}

# Mirrors the no-runnable-bin/caret case above.
@test "only UI-less roots exit 78 without evicting or re-probing" {
  stub_bun
  stub_service
  printf 'dev.excessive.caret\n' >"$home/.local/state/caret/launcher/service"
  local partial="$home/.claude/plugins/cache/caret/caret/0.14.0"
  seed_caret "$partial" 0.14.0
  rm "$partial/ui/dist/index.html"
  local start=$SECONDS
  run -78 launcher
  [[ "$output" == *"$partial"* ]]
  [ -e "$home/.local/state/caret/launcher" ]
  [ $((SECONDS - start)) -lt 5 ]
}

@test "no caret anywhere evicts the launcher, its records, and its service unit" {
  seed_service
  mkdir -p "$home/.local/state/caret/roots"
  run -0 launcher
  [ ! -e "$unit" ]
  [ ! -e "$home/.local/state/caret/bin" ]
  [ ! -e "$home/.local/state/caret/launcher" ]
  [ ! -e "$home/.local/state/caret/roots" ]
}

@test "an owned root beats a stale Claude root once OpenCode's cache is empty" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/1.0.2" 1.0.2
  seed_caret "$home/.local/state/caret/roots/1.1.0" 1.1.0
  run -0 launcher
  [[ "$output" == *"CARET 1.1.0"* ]]
}

@test "an owned root older than an agent's root loses" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/1.2.0" 1.2.0
  seed_caret "$home/.local/state/caret/roots/1.1.0" 1.1.0
  run -0 launcher
  [[ "$output" == *"CARET 1.2.0"* ]]
}

# A hook reuses a supervised daemon only on a matching build, so a same-version owned
# copy winning would cycle the service on every review from that agent.
@test "an owned root loses a version tie to an agent's root" {
  stub_bun
  local claude="$home/.claude/plugins/cache/caret/caret/1.1.0"
  seed_caret "$claude" 1.1.0
  seed_caret "$home/.local/state/caret/roots/1.1.0" 1.1.0
  printf '#!%s\necho "CARET claude-1.1.0"\n' "$BASH_BIN" >"$claude/bin/caret"
  run -0 launcher
  [[ "$output" == *"CARET claude-1.1.0"* ]]
}

@test "an owned root alone is run, not evicted" {
  stub_bun
  seed_service
  seed_caret "$home/.local/state/caret/roots/1.1.0" 1.1.0
  run -0 launcher
  [[ "$output" == *"CARET 1.1.0"* ]]
  [ -e "$unit" ]
  [ -e "$home/.local/state/caret/bin" ]
}

@test "a dot-prefixed dir under the owned roots is never a candidate" {
  seed_service
  seed_caret "$home/.local/state/caret/roots/.1.1.0.123.tmp" 1.1.0
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

# Both may already exist at whatever umask created them, so the chmods are not
# redundant with the create — the case openDaemonStderr's own explicit chmod covers.
@test "a supervised run tightens an existing world-readable logs/ and file" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  local logs="$home/.local/state/caret/logs"
  mkdir -p "$logs"
  chmod 755 "$logs"
  touch "$logs/daemon-stderr.log"
  chmod 644 "$logs/daemon-stderr.log"
  run -0 launcher_supervised
  [ "$(stat_mode "$logs")" = 700 ]
  [ "$(stat_mode "$logs/daemon-stderr.log")" = 600 ]
}

# The degradation path: an unwritable state dir must not become a restart loop.
@test "an unwritable state dir still execs caret" {
  [ "$(id -u)" -ne 0 ] || skip "root ignores the mode bits"
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  chmod 500 "$home/.local/state/caret"
  run launcher_supervised
  # Restored before the assertions: `run -0` would abort first and leave a dir bats
  # cannot remove.
  chmod 700 "$home/.local/state/caret"
  [ "$status" -eq 0 ]
  [[ "$output" == *"CARET 0.14.0"* ]]
}

# Nothing under the state dir at all, which is what a wiped state dir leaves a
# supervisor restarting into — and the launcher's own diagnostics, not a child's,
# are what has to reach the file.
@test "a supervised launcher that cannot find bun logs why into a fresh state dir" {
  if [ -x /opt/homebrew/bin/bun ] || [ -x /usr/local/bin/bun ]; then
    skip "a real bun sits on an absolute search path"
  fi
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  rm -rf "$home/.local/state/caret"
  run -78 launcher_supervised
  [ "$(stat_mode "$home/.local/state/caret/logs")" = 700 ]
  [[ "$(cat "$home/.local/state/caret/logs/daemon-stderr.log")" == *"no bun"* ]]
}

@test "an unsupervised run keeps its output on the terminal" {
  stub_bun
  seed_caret "$home/.claude/plugins/cache/caret/caret/0.14.0" 0.14.0
  run -0 launcher
  [[ "$output" == *"CARET 0.14.0"* ]]
  [ ! -e "$home/.local/state/caret/logs" ]
}
