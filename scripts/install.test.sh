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
# The compile (and the UI-fallback copy it carries) routes through the one build
# task, so the plan names that task rather than re-spelling the bun build flags.
assert_contains "$out" ".mise/tasks/build-bin" "plan compiles through the build task"
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

# --- success path through the register phase (synthetic checkout, all tools stubbed) ---
# A real run only ever exercised the register block and run_long's success branch
# interactively. We drive it hermetically: a synthetic local checkout (so source
# resolution takes the in-place build path — no clone, no network) plus stub
# git/bun/bunx/claude on PATH so nothing real builds or registers. Every tool
# logs its argv to $CALL_LOG, letting us assert the exact register sequence.
#
# build-bin is copied verbatim into the synthetic checkout so the real compile
# flow runs (through stubs): the bun stub honors `build --compile … --outfile P`
# by writing an executable P, so the post-build `[ -x bin/caret ]` guard passes.

# Lay down a synthetic checkout + stub dir. Echoes "ROOT STUBS HOME LOG" so the
# caller can capture the paths; the caller owns cleanup.
make_success_fixture() {
  local root stubs home log tool
  root="$(mktemp -d)"
  stubs="$(mktemp -d)"
  home="$(mktemp -d)"
  log="$root/calls.log"

  mkdir -p "$root/scripts" "$root/.claude-plugin" "$root/.mise/tasks" "$root/ui/dist"
  cp "$script" "$root/scripts/install.sh"
  cp "$test_dir/../.mise/tasks/build-bin" "$root/.mise/tasks/build-bin"
  # marketplace.json's presence is the local-checkout signal; the ui/dist tree
  # is what build-bin's UI-fallback copy reads (`cp -R ui/dist bin/ui`).
  printf '{}\n' >"$root/.claude-plugin/marketplace.json"
  printf '<!doctype html>\n' >"$root/ui/dist/index.html"

  # git/bunx/claude: log argv, succeed. (claude is overridden per-test below.)
  for tool in git bunx claude; do
    {
      printf '#!/usr/bin/env bash\n'
      printf 'printf "%%s\\n" "%s $*" >>"%s"\n' "$tool" "$log"
      printf 'exit 0\n'
    } >"$stubs/$tool"
    chmod +x "$stubs/$tool"
  done

  # bun: log argv; `build --compile … --outfile P` writes an executable P so the
  # post-build guard passes; everything else (install) succeeds.
  cat >"$stubs/bun" <<STUB
#!/usr/bin/env bash
printf '%s\n' "bun \$*" >>"$log"
out=""
prev=""
for a in "\$@"; do
  case "\$prev" in --outfile) out="\$a" ;; esac
  case "\$a" in --outfile=*) out="\${a#--outfile=}" ;; esac
  prev="\$a"
done
if [ -n "\$out" ]; then
  printf '#!/usr/bin/env bash\nexit 0\n' >"\$out"
  chmod +x "\$out"
fi
exit 0
STUB
  chmod +x "$stubs/bun"

  printf '%s %s %s %s' "$root" "$stubs" "$home" "$log"
}

# Replace the claude stub with a body that records argv and applies a caller-set
# exit policy: CLAUDE_FAIL is a space-separated list of plugin subcommands that
# should exit 1 (e.g. "marketplace" or "install uninstall enable").
write_claude_stub() {
  local stubs="$1" log="$2" fails="${3:-}"
  cat >"$stubs/claude" <<STUB
#!/usr/bin/env bash
printf '%s\n' "claude \$*" >>"$log"
sub="\$2"  # "plugin <sub> …"
for f in $fails; do
  [ "\$sub" = "\$f" ] && exit 1
done
exit 0
STUB
  chmod +x "$stubs/claude"
}

# Run the synthetic installer; echoes captured stdout+stderr, sets $? to its rc.
run_success_installer() {
  local root="$1" stubs="$2" home="$3"
  PATH="$stubs:$PATH" HOME="$home" NO_COLOR=1 "$bash_bin" "$root/scripts/install.sh" 2>&1
}

# Happy path: every tool succeeds.
read -r ROOT STUBS HOME_DIR LOG < <(make_success_fixture)
write_claude_stub "$STUBS" "$LOG"
rc=0
ok_out="$(run_success_installer "$ROOT" "$STUBS" "$HOME_DIR")" || rc=$?
calls="$(cat "$LOG")"

if [ "$rc" -eq 0 ]; then
  ok "success run exits 0 through the register phase"
else
  fail "success run exited $rc"
fi

# The full pipeline ran, not just detection: build deps, UI build, compile.
assert_contains "$calls" "bun install" "success run installs build dependencies"
assert_contains "$calls" "vite build" "success run builds the UI"
assert_contains "$calls" "build --compile" "success run compiles the binary"

# Register sequence. marketplace add succeeds, so the update fallback never runs.
assert_contains "$calls" "claude plugin marketplace add $ROOT" "register adds the marketplace"
assert_absent "$calls" "marketplace update" "marketplace update is skipped when add succeeds"
assert_contains "$calls" "claude plugin install caret@caret --scope user" "register installs the plugin"
assert_contains "$calls" "claude plugin enable" "register enables the plugin"

# uninstall must precede install (reinstall-to-refresh-the-cache ordering).
uninstall_line="$(grep -n 'plugin uninstall' <<<"$calls" | head -1 | cut -d: -f1)"
install_line="$(grep -n 'plugin install' <<<"$calls" | head -1 | cut -d: -f1)"
if [ -n "$uninstall_line" ] && [ -n "$install_line" ] && [ "$uninstall_line" -lt "$install_line" ]; then
  ok "register uninstalls before installing"
else
  fail "register should uninstall before installing (uninstall=$uninstall_line install=$install_line)"
fi

# Success-path output the non-TTY harness can observe: ✓ glyphs, no ✗, the
# register step labels, and the final installed line.
assert_contains "$ok_out" "✓" "success path prints ✓ glyphs"
assert_absent "$ok_out" "✗" "success path prints no ✗ glyph"
assert_contains "$ok_out" "Registering the caret marketplace" "success path shows the register step"
assert_contains "$ok_out" "caret installed" "success path ends with the installed line"
rm -rf "$ROOT" "$STUBS" "$HOME_DIR"

# marketplace add → update fallback: add exits 1, so update must run.
read -r ROOT STUBS HOME_DIR LOG < <(make_success_fixture)
write_claude_stub "$STUBS" "$LOG" "marketplace"
rc=0
run_success_installer "$ROOT" "$STUBS" "$HOME_DIR" >/dev/null || rc=$?
calls="$(cat "$LOG")"
# `marketplace add` and `marketplace update` share the "marketplace" subcommand,
# so this stub fails both; the install still aborts non-zero only if a non-best-
# effort step fails. update is the fallback, and a failing update is fatal (no
# `|| true`), so this run is expected to fail — assert the fallback was attempted.
assert_contains "$calls" "claude plugin marketplace update caret" "add failure triggers the update fallback"
rm -rf "$ROOT" "$STUBS" "$HOME_DIR"

# Best-effort `|| true`: uninstall and enable fail, but the run still succeeds.
read -r ROOT STUBS HOME_DIR LOG < <(make_success_fixture)
write_claude_stub "$STUBS" "$LOG" "uninstall enable"
rc=0
run_success_installer "$ROOT" "$STUBS" "$HOME_DIR" >/dev/null || rc=$?
if [ "$rc" -eq 0 ]; then
  ok "best-effort uninstall/enable failures do not fail the install"
else
  fail "best-effort uninstall/enable failures should not fail the install (rc=$rc)"
fi
rm -rf "$ROOT" "$STUBS" "$HOME_DIR"

# A failing non-best-effort register step (plugin install) aborts non-zero.
read -r ROOT STUBS HOME_DIR LOG < <(make_success_fixture)
write_claude_stub "$STUBS" "$LOG" "install"
rc=0
run_success_installer "$ROOT" "$STUBS" "$HOME_DIR" >/dev/null || rc=$?
if [ "$rc" -ne 0 ]; then
  ok "a failing plugin install aborts non-zero ($rc)"
else
  fail "a failing plugin install should abort non-zero"
fi
rm -rf "$ROOT" "$STUBS" "$HOME_DIR"

if [ "$fails" -eq 0 ]; then
  printf '\nAll install.sh dry-run tests passed.\n'
else
  printf '\n%d test(s) failed.\n' "$fails" >&2
  exit 1
fi
