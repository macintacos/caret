#!/usr/bin/env bash
#
# Drives the systemd sequence createSystemdManager performs, against the unit
# buildSystemdUnit() really emitted, inside a booted Linux. Runs as the unprivileged
# account in its own user session; `mise run linux verify` puts it there.
#
# Every check states what systemd answered, because these answers are what
# src/service/systemd-manager.ts is written against — a release that changes one should
# fail here rather than in a user's login.
#
# The predicates and command wrappers below are all invoked as `"$@"` by expect(),
# settled() and until_true(), which shellcheck cannot follow — hence the file-wide SC2329.
# shellcheck disable=SC2329
set -uo pipefail

unit=caret.service
unit_dir="$HOME/.config/systemd/user"
log="$HOME/daemon-stderr.log"
failed=0

# The unit's ExecStart, standing in for bin/caret-launcher: the restart contract is about
# what the launcher exits with, so exit status is all this needs to reproduce. `run` is
# the resident case; any other mode is the status to exit with.
cat >"$HOME/fake-caret" <<'LAUNCHER'
#!/usr/bin/env bash
mode="$(cat "$HOME/mode")"
if [ "$mode" = run ]; then exec sleep infinity; fi
exit "$mode"
LAUNCHER
chmod +x "$HOME/fake-caret"
echo run >"$HOME/mode"

pass() { printf 'ok   %s\n' "$1"; }
fail() {
  printf 'FAIL %s — %s\n' "$1" "$2"
  failed=$((failed + 1))
}

# expect <name> <want-rc> <want-output-substring> <cmd...>. Streams are merged because
# systemd splits its answer across them by verb — `is-enabled` prints the word on stdout,
# `mask` the refusal on stderr — and each check wants whichever one carries it.
expect() {
  local name=$1 want_rc=$2 want_out=$3 out rc
  shift 3
  out="$("$@" 2>&1)"
  rc=$?
  if [ "$rc" = "$want_rc" ] && [[ $out == *"$want_out"* ]]; then
    pass "$name"
  else
    fail "$name" "rc=$rc (want $want_rc), output: ${out//$'\n'/ }"
  fi
}

prop() { systemctl --user show "$unit" -p "$1" --value; }
result_is() { [ "$(prop Result)" = "$1" ]; }
state_is() { [ "$(prop ActiveState)" = "$1" ]; }
has_restarted() { [ "$(prop NRestarts)" -gt 0 ]; }
burst_spent() { [ "$(prop NRestarts)" = "$1" ] && state_is failed; }

# until_true <deadline-secs> <predicate...>. The restart contract plays out over
# RestartSec-spaced starts, so these are polled to a deadline rather than slept past.
until_true() {
  local deadline=$((SECONDS + $1))
  shift
  while [ "$SECONDS" -lt "$deadline" ]; do
    "$@" && return 0
    sleep 1
  done
  return 1
}

# settled <name> <predicate...> — one check whose answer systemd arrives at over time.
settled() {
  local name=$1
  shift
  if until_true 45 "$@"; then
    pass "$name"
  else
    fail "$name" "Result=$(prop Result) NRestarts=$(prop NRestarts) ActiveState=$(prop ActiveState)"
  fi
}

# A session stripped of everything that names the user bus, which is what a host running
# no user manager looks like — the condition probeSystemd() exists to detect.
busless() { env -u XDG_RUNTIME_DIR -u DBUS_SESSION_BUS_ADDRESS "$@"; }

printf -- '--- probe: what answers without a user bus\n'
expect "show-environment reaches the user bus" 0 XDG_RUNTIME_DIR \
  systemctl --user show-environment
expect "show-environment fails without a user bus" 1 "Failed to connect to bus" \
  busless systemctl --user show-environment
# The pair below is why show-environment is the probe: is-enabled exits non-zero for a
# missing bus AND for a unit that is merely absent, so its status alone cannot say which.
expect "is-enabled fails without a user bus too" 1 "Failed to connect to bus" \
  busless systemctl --user is-enabled "$unit"
expect "is-enabled also exits non-zero for a unit that is merely absent" 4 not-found \
  systemctl --user is-enabled "$unit"

printf -- '--- install: write the unit, reload, enable\n'
mkdir -p "$unit_dir"
cp "$HOME/$unit" "$unit_dir/$unit"
expect "daemon-reload accepts the generated unit" 0 "" systemctl --user daemon-reload
expect "a unit on disk but not enabled reads disabled" 1 disabled \
  systemctl --user is-enabled "$unit"
expect "mask refuses while the unit file exists" 1 "already exists" \
  systemctl --user mask "$unit"
expect "enable --now loads and starts the quoted-word ExecStart" 0 "" \
  systemctl --user enable --now "$unit"
expect "the enabled unit is active" 0 active systemctl --user is-active "$unit"
expect "StandardOutput=append: created the daemon log" 0 "" test -f "$log"

printf -- '--- restart contract: what each launcher exit does\n'
echo 78 >"$HOME/mode"
systemctl --user reset-failed "$unit"
systemctl --user restart "$unit" 2>/dev/null
settled "exit 78 parks the unit (Result=exit-code)" result_is exit-code
if [ "$(prop NRestarts)" = 0 ]; then
  pass "exit 78 never restarts (NRestarts=0)"
else
  fail "exit 78 never restarts (NRestarts=0)" "NRestarts=$(prop NRestarts)"
fi

echo 0 >"$HOME/mode"
systemctl --user reset-failed "$unit"
systemctl --user restart "$unit"
settled "exit 0 restarts, so the upgrade drain comes back" has_restarted

echo 1 >"$HOME/mode"
systemctl --user reset-failed "$unit"
systemctl --user restart "$unit" 2>/dev/null
# Read from the unit rather than restated here, so moving START_LIMIT_BURST in
# src/service/systemd.ts moves what this asserts. systemd records the burst in NRestarts
# and leaves Result on the last execution's own failure — `start-limit-hit` is what a
# refused start request reports, not what the spent unit settles at.
burst="$(sed -n 's/^StartLimitBurst=//p' "$unit_dir/$unit")"
settled "an exit 1 burst stops at StartLimitBurst=$burst restarts" burst_spent "$burst"

printf -- '--- uninstall: disable, remove, reload\n'
echo run >"$HOME/mode"
systemctl --user reset-failed "$unit"
systemctl --user start "$unit"
until_true 15 state_is active
systemctl --user stop "$unit"
expect "a known but stopped unit reads inactive" 3 inactive systemctl --user is-active "$unit"
expect "disable --now succeeds while the unit exists" 0 "" \
  systemctl --user disable --now "$unit"
rm -f "$unit_dir/$unit"
systemctl --user daemon-reload
expect "a removed unit reads not-found" 4 not-found systemctl --user is-enabled "$unit"
expect "disable --now on an absent unit fails, so uninstall must be best-effort" 1 \
  "does not exist" systemctl --user disable --now "$unit"

printf -- '---\n'
if [ "$failed" = 0 ]; then
  printf 'all checks ok\n'
else
  printf '%d check(s) failed\n' "$failed"
fi
exit $((failed > 0))
