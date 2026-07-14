#!/usr/bin/env bash
# shellcheck disable=SC2034  # DRY_RUN / CARET_AGENTS / WANT_* are read by the sourced install.sh, which shellcheck can't follow here.
#
# Unit tests for the helper functions in scripts/install.sh. Where install.test.sh
# EXECUTES the script end-to-end (dry-run plans, stubbed real runs), this SOURCES
# it — the sourced-guard at the bottom of install.sh keeps main() from running —
# and calls the extracted helpers directly, asserting their effect on PLAN, on the
# WANT_* targets, and on exit status.
#
#   bash scripts/install-lib.test.sh
#
# Hermetic: a stub `claude` on PATH satisfies require/detection, and every helper
# is exercised in DRY_RUN, where run() only records into PLAN and executes nothing.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/install.sh"

# A stub `claude` so `require claude` / detection succeed without a real install.
stub_dir="$(mktemp -d "${TMPDIR:-/tmp}/caret-lib.XXXXXX")"
printf '#!/usr/bin/env bash\nexit 0\n' >"$stub_dir/claude"
chmod +x "$stub_dir/claude"
PATH="$stub_dir:$PATH"
trap 'rm -rf "$stub_dir"' EXIT

# Source the library under test. The sourced-guard means main() does NOT run — we
# only pull in the function + default-global definitions. Sourcing turns on
# install.sh's `set -euo pipefail`, so take error control back afterward: these
# tests capture exit codes explicitly and assert on possibly-empty arrays.
# shellcheck source=/dev/null
source "$script"
set +eu

pass=0
fails=0
ok() {
  printf 'ok   - %s\n' "$1"
  pass=$((pass + 1))
}
fail() {
  printf 'FAIL - %s\n' "$1" >&2
  fails=$((fails + 1))
}
# eq EXPECTED ACTUAL LABEL — assert exact string equality.
eq() { if [ "$2" = "$1" ]; then ok "$3"; else fail "$3 (got [$2], want [$1])"; fi; }
# has HAYSTACK NEEDLE LABEL — assert HAYSTACK contains NEEDLE (literal).
has() { case "$1" in *"$2"*) ok "$3" ;; *) fail "$3 (missing [$2] in [$1])" ;; esac }

# --- quote: join argv, shell-quoting each element -------------------------------
eq "claude plugin install" "$(quote claude plugin install)" "quote passes simple argv through"
has "$(quote caret 'a b')" 'a\ b' "quote shell-escapes whitespace"

# --- run: dry-run records into PLAN and executes nothing ------------------------
DRY_RUN=1
PLAN=()
run claude plugin marketplace add macintacos/caret
eq "1" "${#PLAN[@]}" "run (dry) records exactly one plan entry"
eq "claude plugin marketplace add macintacos/caret" "${PLAN[0]:-}" "run (dry) records the verbatim command"

# --- run: real mode executes the command and records nothing --------------------
DRY_RUN=0
PLAN=()
probe="$stub_dir/ran"
run touch "$probe"
if [ -f "$probe" ]; then ok "run (real) executes the command"; else fail "run (real) did not execute the command"; fi
eq "0" "${#PLAN[@]}" "run (real) records nothing into PLAN"

# --- register_marketplace_from: add succeeds, so no update fallback -------------
DRY_RUN=1
PLAN=()
register_marketplace_from macintacos/caret
eq "1" "${#PLAN[@]}" "register_marketplace_from records only the add when it succeeds"
has "${PLAN[0]:-}" "claude plugin marketplace add macintacos/caret" "register_marketplace_from adds the given source"

# --- install_claude_plugin: uninstall, then install, then enable ----------------
DRY_RUN=1
PLAN=()
install_claude_plugin
eq "3" "${#PLAN[@]}" "install_claude_plugin records uninstall + install + enable"
has "${PLAN[0]:-}" "plugin uninstall caret@caret" "install_claude_plugin uninstalls first"
has "${PLAN[1]:-}" "plugin install caret@caret --scope user" "install_claude_plugin installs with --scope user"
has "${PLAN[2]:-}" "plugin enable caret@caret" "install_claude_plugin enables last"

# --- parse_args: only --from-local is accepted ----------------------------------
FROM_LOCAL=0
parse_args
eq "0" "$FROM_LOCAL" "parse_args with no args leaves FROM_LOCAL=0"
FROM_LOCAL=0
parse_args --from-local
eq "1" "$FROM_LOCAL" "parse_args --from-local sets FROM_LOCAL=1"
# An unknown flag must exit non-zero; run in a subshell so it can't kill the test.
(parse_args --bogus) >/dev/null 2>&1
rc=$?
if [ "$rc" -ne 0 ]; then ok "parse_args rejects an unknown flag (exit $rc)"; else fail "parse_args accepted an unknown flag"; fi

# --- select_targets: CARET_AGENTS overrides agent detection ---------------------
WANT_CLAUDE=0
WANT_OPENCODE=0
CARET_AGENTS=opencode
select_targets
unset CARET_AGENTS
eq "1" "$WANT_OPENCODE" "select_targets honors CARET_AGENTS=opencode"
eq "0" "$WANT_CLAUDE" "select_targets skips Claude when only opencode requested"
WANT_CLAUDE=0
WANT_OPENCODE=0
CARET_AGENTS=claude
select_targets
unset CARET_AGENTS
eq "1" "$WANT_CLAUDE" "select_targets honors CARET_AGENTS=claude"
eq "0" "$WANT_OPENCODE" "select_targets skips OpenCode when only claude requested"

if [ "$fails" -eq 0 ]; then
  printf '\nAll install.sh helper unit tests passed (%d).\n' "$pass"
  exit 0
else
  printf '\n%d unit test(s) failed.\n' "$fails" >&2
  exit 1
fi
