#!/usr/bin/env bash
#
# Hermetic tests for the CARET_DRY_RUN mode of scripts/install.sh. They exercise
# only the read-only detection and the dry-run plan rendering — no network and
# no mutation — so they are safe to run anywhere git, bun, and claude are on the
# PATH. The dry-run feature is what makes install.sh testable without installing.
#
#   bash scripts/install.test.sh
#
set -uo pipefail

test_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$test_dir/install.sh"
bash_bin="$(command -v bash)"

fails=0

ok() { printf 'ok   - %s\n' "$1"; }
fail() {
  printf 'FAIL - %s\n' "$1" >&2
  fails=$((fails + 1))
}

assert_contains() {
  case "$1" in
  *"$2"*) ok "$3" ;;
  *) fail "$3 (missing substring: $2)" ;;
  esac
}

assert_absent() {
  case "$1" in
  *"$2"*) fail "$3 (unexpected substring: $2)" ;;
  *) ok "$3" ;;
  esac
}

# --- dry run from inside this checkout: in-place build, no clone, no network ---
rc=0
out="$(CARET_DRY_RUN=1 "$bash_bin" "$script" 2>&1)" || rc=$?
if [ "$rc" -eq 0 ]; then
  ok "local-checkout dry run exits 0"
else
  fail "local-checkout dry run exited $rc"
fi

assert_contains "$out" "DRY RUN" "announces dry-run mode"
assert_contains "$out" "local checkout" "reports the local-checkout source"
assert_contains "$out" "in place" "reports an in-place build"
assert_contains "$out" "bun install" "plan includes the dependency install"
assert_contains "$out" "vite" "plan includes the UI build"
# A single space-free token (like "vite" above): the compile is a bash -c
# one-liner, and the dry-run plan renders it through printf %q, which
# backslash-escapes the spaces inside it.
assert_contains "$out" "--compile" "plan includes the binary build"
assert_contains "$out" "CARET_BUILD_COMMIT" "plan bakes the commit into the binary"
assert_contains "$out" "index.html" "plan includes the UI copy"
assert_contains "$out" "claude plugin install" "plan includes the plugin install"
assert_contains "$out" "nothing was changed" "ends with the no-change closer"
assert_absent "$out" "git clone" "local path never clones"

# --- piped / NO_COLOR output carries no ANSI escapes ---
rc=0
plain="$(CARET_DRY_RUN=1 NO_COLOR=1 "$bash_bin" "$script" 2>&1)" || rc=$?
if [ "$rc" -eq 0 ]; then
  assert_absent "$plain" "$(printf '\033')" "NO_COLOR output has no escape codes"
else
  fail "NO_COLOR dry run exited $rc"
fi

# --- a missing required tool hard-fails in dry-run, same as a real run ---
empty_dir="$(mktemp -d)"
rc=0
missing_out="$(PATH="$empty_dir" CARET_DRY_RUN=1 "$bash_bin" "$script" 2>&1)" || rc=$?
rmdir "$empty_dir"
if [ "$rc" -ne 0 ]; then
  ok "missing-tool dry run exits non-zero ($rc)"
else
  fail "missing-tool dry run unexpectedly succeeded"
fi
assert_contains "$missing_out" "missing" "missing-tool error names the gap"

# --- a failing long step surfaces a ✗ and a non-zero exit (spinner safety) ---
# Real-mode run with stubbed tools: `bun install` fails, so the first long step
# errors out before any registration step — hermetic and non-mutating.
stub_dir="$(mktemp -d)"
for tool in git bunx claude; do
  printf '#!/usr/bin/env bash\nexit 0\n' >"$stub_dir/$tool"
  chmod +x "$stub_dir/$tool"
done
cat >"$stub_dir/bun" <<'STUB'
#!/usr/bin/env bash
[ "${1:-}" = "install" ] && exit 1
exit 0
STUB
chmod +x "$stub_dir/bun"

rc=0
fail_out="$(PATH="$stub_dir:$PATH" "$bash_bin" "$script" 2>&1)" || rc=$?
rm -rf "$stub_dir"
if [ "$rc" -ne 0 ]; then
  ok "failed long step exits non-zero ($rc)"
else
  fail "failed long step should exit non-zero"
fi
assert_contains "$fail_out" "✗" "failed long step prints a ✗ glyph"
assert_absent "$fail_out" "Registering" "a failed build aborts before any registration step"

if [ "$fails" -eq 0 ]; then
  printf '\nAll install.sh dry-run tests passed.\n'
else
  printf '\n%d test(s) failed.\n' "$fails" >&2
  exit 1
fi
