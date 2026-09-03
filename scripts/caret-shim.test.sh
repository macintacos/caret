#!/usr/bin/env bash
#
# Hermetic tests for bin/caret — the committed plugin entrypoint shim (EXC-643).
# Each case assembles a fake plugin root with a subset of the three runtimes the
# shim resolves between (compiled bin/caret-native, the bun bundle dist/cli.js,
# raw src/cli.ts) and asserts the shim execs the right one with argv intact.
#
#   bash scripts/caret-shim.test.sh
#
set -uo pipefail

test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
shim="$test_dir/../bin/caret"
bash_bin="$(command -v bash)"

# shellcheck source=/dev/null
source "$test_dir/test-harness.sh"

# Build a throwaway plugin root; caller seeds the runtimes it wants.
make_root() {
  local root
  root="$(mktemp -d "${TMPDIR:-/tmp}/caret-shim.XXXXXX")"
  mkdir -p "$root/bin" "$root/dist" "$root/src"
  cp "$shim" "$root/bin/caret"
  chmod +x "$root/bin/caret"
  printf '%s' "$root"
}

# --- 1. prefers the compiled binary when present --------------------------
root="$(make_root)"
cat >"$root/bin/caret-native" <<'NATIVE'
#!/usr/bin/env bash
echo "NATIVE:$*"
NATIVE
chmod +x "$root/bin/caret-native"
# Seed a bundle and source too — the binary must still win.
echo 'console.log("BUNDLE:" + process.argv.slice(2).join(" "))' >"$root/dist/cli.js"
echo 'console.log("SOURCE:" + process.argv.slice(2).join(" "))' >"$root/src/cli.ts"
out="$("$bash_bin" "$root/bin/caret" review --foo 2>&1)"
assert_contains "$out" "NATIVE:review --foo" "execs bin/caret-native when present (argv intact)"
rm -rf "$root"

# --- 2. falls to the bun bundle when no compiled binary -------------------
root="$(make_root)"
echo 'console.log("BUNDLE:" + process.argv.slice(2).join(" "))' >"$root/dist/cli.js"
echo 'console.log("SOURCE:" + process.argv.slice(2).join(" "))' >"$root/src/cli.ts"
out="$("$bash_bin" "$root/bin/caret" prewarm 2>&1)"
assert_contains "$out" "BUNDLE:prewarm" "execs bun dist/cli.js when no binary"
rm -rf "$root"

# --- 3. falls to raw source when neither binary nor bundle ----------------
root="$(make_root)"
rmdir "$root/dist" 2>/dev/null || rm -rf "$root/dist"
echo 'console.log("SOURCE:" + process.argv.slice(2).join(" "))' >"$root/src/cli.ts"
out="$("$bash_bin" "$root/bin/caret" discovery 2>&1)"
assert_contains "$out" "SOURCE:discovery" "execs bun src/cli.ts when only source exists"
rm -rf "$root"

# --- 4. clear error (exit 127) when bun is required but absent -------------
# A bundle-only root run with a PATH that has the coreutils the shim needs
# (dirname, readlink) but no bun. env -i drops every other inherited var.
root="$(make_root)"
echo 'console.log("BUNDLE")' >"$root/dist/cli.js"
fakebin="$(mktemp -d "${TMPDIR:-/tmp}/caret-shim-bin.XXXXXX")"
for tool in dirname readlink; do
  p="$(command -v "$tool" 2>/dev/null || true)"
  [ -n "$p" ] && ln -s "$p" "$fakebin/$tool"
done
out="$(env -i PATH="$fakebin" "$bash_bin" "$root/bin/caret" review 2>&1)"
rc=$?
assert_contains "$out" "bun" "missing-bun error mentions bun"
if [ "$rc" -eq 127 ]; then ok "missing-bun exits 127"; else fail "missing-bun exits 127 (got $rc)"; fi
rm -rf "$root" "$fakebin"

summary caret-shim.test.sh
