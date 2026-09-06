#!/usr/bin/env bats
#
# Hermetic tests for bin/caret — the committed plugin entrypoint shim (EXC-643).
# Each case assembles a fake plugin root with a subset of the three runtimes the
# shim resolves between (compiled bin/caret-native, the bun bundle dist/cli.js,
# raw src/cli.ts) and asserts the shim execs the right one with argv intact.
#
#   mise x -- bats scripts/caret-shim.bats
#
# `run -<status>` asserts the exit code inline, which is why 1.5.0 is the floor.

bats_require_minimum_version 1.5.0

setup_file() {
  SHIM="$(cd "$(dirname "$BATS_TEST_FILENAME")/../bin" && pwd)/caret"
  BASH_BIN="$(command -v bash)"
  export SHIM BASH_BIN
}

# A throwaway plugin root; each case seeds the runtimes it wants. bats removes
# $BATS_TEST_TMPDIR after each test, so no case cleans up after itself.
setup() {
  root="$BATS_TEST_TMPDIR/plugin"
  mkdir -p "$root/bin" "$root/dist" "$root/src"
  cp "$SHIM" "$root/bin/caret"
  chmod +x "$root/bin/caret"
}

# Each runtime echoes a tag and the argv it received, so an assertion names which
# one was exec'd and proves the arguments survived the hop.
seed_native() {
  cat >"$root/bin/caret-native" <<NATIVE
#!$BASH_BIN
echo "NATIVE:\$*"
NATIVE
  chmod +x "$root/bin/caret-native"
}

seed_bundle() {
  echo 'console.log("BUNDLE:" + process.argv.slice(2).join(" "))' >"$root/dist/cli.js"
}

seed_source() {
  echo 'console.log("SOURCE:" + process.argv.slice(2).join(" "))' >"$root/src/cli.ts"
}

shim() { "$BASH_BIN" "$root/bin/caret" "$@"; }

@test "execs bin/caret-native when present, argv intact" {
  seed_native
  # A bundle and source too — the binary must still win.
  seed_bundle
  seed_source
  run -0 shim review --foo
  [[ "$output" == *"NATIVE:review --foo"* ]]
}

@test "execs bun dist/cli.js when no binary" {
  seed_bundle
  seed_source
  run -0 shim prewarm
  [[ "$output" == *"BUNDLE:prewarm"* ]]
}

@test "execs bun src/cli.ts when only source exists" {
  rmdir "$root/dist"
  seed_source
  run -0 shim discovery
  [[ "$output" == *"SOURCE:discovery"* ]]
}

# A bundle-only root run with a PATH carrying the coreutils the shim needs
# (dirname, readlink) but no bun. `env -i` drops every other inherited var, so a
# real bun on the developer's machine cannot leak in.
@test "a root needing bun without one on PATH exits 127, naming bun" {
  seed_bundle
  local fakebin="$BATS_TEST_TMPDIR/fakebin" tool tool_path
  mkdir -p "$fakebin"
  for tool in dirname readlink; do
    tool_path="$(command -v "$tool" 2>/dev/null || true)"
    [ -n "$tool_path" ] && ln -s "$tool_path" "$fakebin/$tool"
  done
  run -127 env -i PATH="$fakebin" "$BASH_BIN" "$root/bin/caret" review
  [[ "$output" == *"bun"* ]]
}
