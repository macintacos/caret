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
# by writing an executable P, so the post-build `[ -x bin/caret-native ]` guard passes.

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
  cp "$test_dir/make-dev-marketplace.sh" "$root/scripts/make-dev-marketplace.sh"
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
  # Pin XDG_STATE_HOME under the stub HOME so the generated dev marketplace
  # (make-dev-marketplace.sh) lands inside the fixture and is cleaned with it.
  PATH="$stubs:$PATH" HOME="$home" XDG_STATE_HOME="$home/.local/state" NO_COLOR=1 "$bash_bin" "$root/scripts/install.sh" 2>&1
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

# Register sequence. The local build registers the generated dev marketplace
# (source symlinked to the checkout), not the checkout's own npm-sourced
# manifest. marketplace add succeeds, so the update fallback never runs.
assert_contains "$calls" "marketplace add $HOME_DIR/.local/state/caret/dev-marketplace" "register adds the generated dev marketplace"
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

# --- --from-local: reuse the just-built artifacts, register, cycle the daemon ---
# (EXC-555) `mise run build --install` calls `install.sh --from-local`, which
# forces local mode, REUSES bin/caret-native + bin/ui (no rebuild), reinstalls
# the plugin, and cycles the daemon via the just-built `caret prewarm`.

# Pre-create the build artifacts --from-local reuses, in an existing fixture
# ROOT. The bin/caret-native stub logs its argv to $LOG so we can assert the
# daemon cycle ran `caret prewarm`; $exit_code lets a test make prewarm "fail".
seed_local_artifacts() {
  local root="$1" log="$2" exit_code="${3:-0}"
  mkdir -p "$root/bin/ui"
  cat >"$root/bin/caret-native" <<STUB
#!/usr/bin/env bash
printf '%s\n' "caret \$*" >>"$log"
exit $exit_code
STUB
  chmod +x "$root/bin/caret-native"
}

# Dry run --from-local: reuses artifacts, plans the daemon cycle, never rebuilds.
# Runs against this real checkout (it has .claude-plugin/marketplace.json, so
# local mode is detected); dry-run skips the artifact guard, so no seeding needed.
rc=0
fl_dry="$(CARET_DRY_RUN=1 "$bash_bin" "$script" --from-local 2>&1)" || rc=$?
if [ "$rc" -eq 0 ]; then
  ok "--from-local dry run exits 0"
else
  fail "--from-local dry run exited $rc"
fi
assert_contains "$fl_dry" "DRY RUN" "--from-local announces dry-run mode"
assert_contains "$fl_dry" "no rebuild" "--from-local reports artifact reuse (no rebuild)"
assert_contains "$fl_dry" "prewarm" "--from-local plan cycles the daemon via prewarm"
assert_contains "$fl_dry" "claude plugin install" "--from-local plan still installs the plugin"
assert_absent "$fl_dry" "bun install" "--from-local plan does not reinstall build deps"
assert_absent "$fl_dry" "build --compile" "--from-local plan does not recompile the binary"

# Real run --from-local (synthetic checkout, seeded artifacts, stubbed tools):
# the register sequence runs, the daemon cycle invokes `caret prewarm`, and no
# rebuild command fires.
read -r ROOT STUBS HOME_DIR LOG < <(make_success_fixture)
write_claude_stub "$STUBS" "$LOG"
seed_local_artifacts "$ROOT" "$LOG"
rc=0
fl_real="$(PATH="$STUBS:$PATH" HOME="$HOME_DIR" XDG_STATE_HOME="$HOME_DIR/.local/state" NO_COLOR=1 "$bash_bin" "$ROOT/scripts/install.sh" --from-local 2>&1)" || rc=$?
calls="$(cat "$LOG")"
if [ "$rc" -eq 0 ]; then
  ok "--from-local real run exits 0"
else
  fail "--from-local real run exited $rc"
fi
assert_contains "$calls" "claude plugin install caret@caret --scope user" "--from-local installs the plugin"
assert_contains "$calls" "claude plugin enable" "--from-local enables the plugin"
assert_contains "$calls" "caret prewarm" "--from-local prewarms via caret prewarm"
# The daemon step is best-effort: prewarm hands off to the fresh build by
# retiring a retireable daemon, but REUSES an un-retireable legacy daemon (no
# /api/retire, no lock) — and can't report which happened. So the step must not
# claim the swap is done. Regression: the old "Cycling the daemon to the fresh
# build" wording reported success even when prewarm reused a stale daemon.
assert_absent "$fl_real" "Cycling the daemon" "--from-local daemon step does not over-claim the swap"
assert_absent "$calls" "bun install" "--from-local does not reinstall build deps"
assert_absent "$calls" "vite build" "--from-local does not rebuild the UI"
assert_absent "$calls" "build --compile" "--from-local does not recompile the binary"
rm -rf "$ROOT" "$STUBS" "$HOME_DIR"

# Best-effort guards: a clean machine (uninstall fails, nothing to remove) and a
# daemon hiccup (prewarm exits 1) must not abort an otherwise-clean install.
read -r ROOT STUBS HOME_DIR LOG < <(make_success_fixture)
write_claude_stub "$STUBS" "$LOG" "uninstall enable"
seed_local_artifacts "$ROOT" "$LOG" 1
rc=0
PATH="$STUBS:$PATH" HOME="$HOME_DIR" XDG_STATE_HOME="$HOME_DIR/.local/state" NO_COLOR=1 "$bash_bin" "$ROOT/scripts/install.sh" --from-local >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then
  ok "--from-local best-effort uninstall + daemon-cycle failures do not fail the install"
else
  fail "--from-local best-effort failures should not fail the install (rc=$rc)"
fi
assert_contains "$(cat "$LOG")" "caret prewarm" "--from-local still attempted the daemon cycle"
rm -rf "$ROOT" "$STUBS" "$HOME_DIR"

# Missing artifacts: --from-local fails with a clear message instead of silently
# rebuilding (no bin/caret-native + bin/ui seeded).
read -r ROOT STUBS HOME_DIR LOG < <(make_success_fixture)
write_claude_stub "$STUBS" "$LOG"
rc=0
fl_miss="$(PATH="$STUBS:$PATH" HOME="$HOME_DIR" NO_COLOR=1 "$bash_bin" "$ROOT/scripts/install.sh" --from-local 2>&1)" || rc=$?
if [ "$rc" -ne 0 ]; then
  ok "--from-local with missing artifacts exits non-zero ($rc)"
else
  fail "--from-local with missing artifacts should fail"
fi
assert_contains "$fl_miss" "mise run build" "--from-local missing-artifact error points at the build"
assert_absent "$(cat "$LOG")" "bun install" "--from-local does not silently rebuild on missing artifacts"
rm -rf "$ROOT" "$STUBS" "$HOME_DIR"

# An unrecognized argument is a hard error (the only supported flag is --from-local).
rc=0
bad_arg="$(CARET_DRY_RUN=1 "$bash_bin" "$script" --nope 2>&1)" || rc=$?
if [ "$rc" -ne 0 ]; then
  ok "unknown argument exits non-zero ($rc)"
else
  fail "unknown argument should exit non-zero"
fi
assert_contains "$bad_arg" "unknown argument" "unknown argument names the gap"

# --from-local must NOT require bun: it reuses artifacts and never builds. Run
# the dry run with bun deliberately absent from PATH — real git + dirname (the
# only externals the from-local dry-run path needs) plus a claude stub, but no
# bun. Without the FROM_LOCAL gate on `require bun`, this hard-fails on missing
# bun; with it, the run succeeds.
nobun_dir="$(mktemp -d)"
ln -s "$(command -v git)" "$nobun_dir/git"
ln -s "$(command -v dirname)" "$nobun_dir/dirname"
printf '#!/usr/bin/env bash\nexit 0\n' >"$nobun_dir/claude"
chmod +x "$nobun_dir/claude"
rc=0
nobun_out="$(PATH="$nobun_dir" CARET_DRY_RUN=1 "$bash_bin" "$script" --from-local 2>&1)" || rc=$?
rm -rf "$nobun_dir"
if [ "$rc" -eq 0 ]; then
  ok "--from-local does not require bun"
else
  fail "--from-local should not require bun (rc=$rc): $nobun_out"
fi

# --- mise-task glue: `mise run build --install` forwards to install.sh --from-local ---
# mise sets usage_install=true when --install is passed (verified). Run the real
# build-task body directly — bash ignores the #MISE/#USAGE directives, so no mise
# or build-bin depends fire — with a stubbed scripts/install.sh that logs argv.
glue_root="$(mktemp -d)"
mkdir -p "$glue_root/scripts" "$glue_root/.mise/tasks"
cp "$test_dir/../.mise/tasks/build" "$glue_root/.mise/tasks/build"
glue_log="$glue_root/install-calls.log"
cat >"$glue_root/scripts/install.sh" <<STUB
#!/usr/bin/env bash
printf '%s\n' "install.sh \$*" >>"$glue_log"
exit 0
STUB
chmod +x "$glue_root/scripts/install.sh"

# With the flag set, the task forwards to install.sh --from-local.
rc=0
(cd "$glue_root" && usage_install=true "$bash_bin" .mise/tasks/build) >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then
  ok "build --install task exits 0"
else
  fail "build --install task exited $rc"
fi
assert_contains "$(cat "$glue_log" 2>/dev/null)" "install.sh --from-local" "build --install forwards to install.sh --from-local"

# Without the flag, the build task is build-only: it exits 0 and never calls
# install.sh. The exit-0 check keeps a crashing build body from passing the
# never-called assertion vacuously.
: >"$glue_log"
rc=0
(cd "$glue_root" && "$bash_bin" .mise/tasks/build) >/dev/null 2>&1 || rc=$?
if [ "$rc" -eq 0 ]; then
  ok "plain build task exits 0"
else
  fail "plain build task exited $rc"
fi
assert_absent "$(cat "$glue_log" 2>/dev/null)" "install.sh" "plain build never calls install.sh"
rm -rf "$glue_root"

if [ "$fails" -eq 0 ]; then
  printf '\nAll install.sh dry-run tests passed.\n'
else
  printf '\n%d test(s) failed.\n' "$fails" >&2
  exit 1
fi
