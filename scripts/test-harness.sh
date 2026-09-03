# shellcheck shell=bash
# Assertion harness for the hermetic bash suites under scripts/ (sourced, never
# run). Each suite sources this, calls ok/fail/assert_contains per case, and ends
# with `summary <suite name>`, which reports the tally and sets the exit status.
#
# Sourced into the OUTER shell only: the suites drive their subjects in fresh
# `env -i` shells, which never see these functions.

fails=0

ok() { printf 'ok   - %s\n' "$1"; }

fail() {
  printf 'FAIL - %s\n' "$1" >&2
  fails=$((fails + 1))
}

assert_contains() {
  case "$1" in
  *"$2"*) ok "$3" ;;
  *) fail "$3 (missing substring: $2; got: $1)" ;;
  esac
}

# Report the tally for a finished suite and exit with its status.
summary() {
  echo
  if [ "$fails" -eq 0 ]; then
    echo "$1: PASS"
    exit 0
  fi
  echo "$1: $fails failure(s)" >&2
  exit 1
}
