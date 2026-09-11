#!/usr/bin/env bash
#
# Drives the launchctl sequence createLaunchdManager performs, against the plist
# buildLaunchdPlist() really emitted, in this Mac's own login session. `mise run macos
# verify` generates that plist and the throwaway HOME and puts this script on them.
#
# Every check states what launchd answered, because these answers are what
# src/service/launchd-manager.ts is written against — a release that changes one should
# fail here rather than in a user's login.
#
# The predicates and command wrappers below are all invoked as `"$@"` by expect(),
# matches() and until_true(), which shellcheck cannot follow — hence the file-wide SC2329.
# shellcheck disable=SC2329
set -uo pipefail

# Never $HOME: everything below builds a fake caret install and hands it to launchd, and
# the developer's real home must not be where that lands.
home="${CARET_VERIFY_HOME:?set by .mise/tasks/macos}"
label="${CARET_VERIFY_LABEL:?set by .mise/tasks/macos}"
window_ms="${CARET_VERIFY_WINDOW_MS:?set by .mise/tasks/macos}"
plist="$home/$label.plist"
uid="$(id -u)"
domain="gui/$uid"
target="$domain/$label"
window_s=$((window_ms / 1000))
failed=0

# The machine the real bin/caret-launcher resolves against before it execs. `run` is the
# resident case and `drain` a resident daemon slow to stop; any other mode is the status
# to exit with. No `service` record is written: that record is what the launcher's
# stop_agent and evict() act on, and leaving it absent is what keeps a failed resolve from
# booting out or deleting anything.
caret_root="$home/.claude/plugins/cache/caret/caret/0.1.0"
mkdir -p "$caret_root/bin" "$home/bin" "$home/.local/state/caret/launcher"
: >"$home/spawns"
# Multi-line, because candidate_version() anchors its sed at line start.
printf '{\n  "version": "0.1.0"\n}\n' >"$caret_root/package.json"
cat >"$caret_root/bin/caret" <<'CARET'
#!/bin/sh
# One line per start, which is how the throttle check times launchd's respawns without
# racing a pid that can live microseconds.
date +%s >>"$HOME/spawns"
mode="$(cat "$HOME/mode")"
# A day, not `sleep infinity`: launchd hands the job PATH=/usr/bin:/bin:/usr/sbin:/sbin,
# where sleep is BSD's and rejects the GNU spelling the Linux twin's fake caret uses.
if [ "$mode" = run ]; then exec sleep 86400; fi
# Outlives SIGTERM by longer than launchd's own default grace, as a daemon draining its
# reviews does — which is what makes the plist's ExitTimeOut the thing under test.
if [ "$mode" = drain ]; then
  trap ': >"$HOME/draining"; sleep 8; : >"$HOME/drained"; exit 0' TERM
  : >"$HOME/drain-ready"
  sleep 86400 &
  wait
fi
exit "$mode"
CARET
chmod +x "$caret_root/bin/caret"
printf '#!/bin/sh\nexit 0\n' >"$home/bin/bun"
chmod +x "$home/bin/bun"
printf '%s\n' "$home/bin/bun" >"$home/.local/state/caret/launcher/bun-path"

set_mode() { printf '%s\n' "$1" >"$home/mode"; }
set_mode run

pass() { printf 'ok   %s\n' "$1"; }
# An observation the run records without passing or failing on it — for behaviour that is
# genuinely host-dependent, where asserting either outcome would be asserting the host.
note() { printf 'note %s — %s\n' "$1" "$2"; }
fail() {
  printf 'FAIL %s — %s\n' "$1" "$2"
  failed=$((failed + 1))
}

# expect <name> <want-rc> <want-output-substring> <cmd...>. Streams are merged because
# launchctl puts its refusals on stderr and its answers on stdout, and a check on a
# refusal wants the sentence, not just the status.
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

# matches <name> <ere> <cmd...>. stdout only and a regex, because these are the patterns
# readStatus tests against `printed.stdout` — a check that also accepted stderr, or took a
# looser substring, would prove something the manager never reads.
matches() {
  local name=$1 pattern=$2 out
  shift 2
  out="$("$@" 2>/dev/null)"
  if printf '%s\n' "$out" | grep -qE "$pattern"; then
    pass "$name"
  else
    fail "$name" "no /$pattern/ in: ${out//$'\n'/ }"
  fi
}

# until_true <deadline-secs> <predicate...>. launchd answers these over time — a throttled
# respawn, a drain — so they are polled to a deadline rather than slept past.
until_true() {
  local deadline=$((SECONDS + $1))
  shift
  while [ "$SECONDS" -lt "$deadline" ]; do
    "$@" && return 0
    sleep 1
  done
  return 1
}

job_running() { launchctl print "$target" 2>/dev/null | grep -qE '^[[:space:]]*state = running$'; }
spawn_count() { awk 'END { print NR }' "$home/spawns"; }
spawns_past() { [ "$(spawn_count)" -ge "$1" ]; }
last_spawn() { tail -1 "$home/spawns"; }

printf -- '--- host: what this release answers as\n'
note "the host these answers came from" \
  "macOS $(sw_vers -productVersion), domain $domain, window ${window_s}s"

printf -- '--- install: the sequence install() performs\n'
expect "bootstrap accepts the generated plist" 0 "" launchctl bootstrap "$domain" "$plist"
# launchd reports `state = xpcproxy` for the moment before it execs the job, so the two
# RUNNING patterns are read once the agent has settled rather than immediately.
until_true 20 job_running
# Read from the plist rather than restated here, so moving EXIT_TIMEOUT_SEC in
# src/service/launchd.ts moves what this asserts.
exit_timeout="$(awk '/<key>ExitTimeOut<\/key>/ { getline; gsub(/[^0-9]/, ""); print }' "$plist")"
matches "print reports the plist's ExitTimeOut of ${exit_timeout}s" \
  "^[[:space:]]*exit timeout = $exit_timeout\$" launchctl print "$target"
matches "print reports a running state, one of readStatus's two RUNNING patterns" \
  '^[[:space:]]*state = running$' launchctl print "$target"
matches "print reports a pid, the other one" \
  '^[[:space:]]*pid = [0-9]+$' launchctl print "$target"

printf -- '--- reload: the bootout/bootstrap pair a caret install --refresh takes\n'
# Back to back against a running agent, which is where `Bootstrap failed: 5: Input/output
# error` comes from: bootout returns before launchd has finished tearing the job down, and
# the bootstrap behind it lands on a domain still holding the old one.
reload_broke=""
for i in $(seq 1 10); do
  bootout_out="$(launchctl bootout "$target" 2>&1)"
  bootout_rc=$?
  bootstrap_out="$(launchctl bootstrap "$domain" "$plist" 2>&1)"
  bootstrap_rc=$?
  if [ "$bootout_rc" != 0 ] || [ "$bootstrap_rc" != 0 ]; then
    reload_broke="iteration $i: bootout rc=$bootout_rc ${bootout_out:-(silent)}, bootstrap rc=$bootstrap_rc ${bootstrap_out:-(silent)}"
    break
  fi
done
if [ -z "$reload_broke" ]; then
  pass "ten bootout/bootstrap cycles against a running agent"
else
  fail "ten bootout/bootstrap cycles against a running agent" "$reload_broke"
fi

printf -- '--- keepalive: what an exited agent costs the hook waiting on its successor\n'
until_true 20 job_running
set_mode 0
before="$(spawn_count)"
launchctl kickstart -k "$target" >/dev/null
# Three starts, so the gap measured below sits between two respawns launchd throttled
# rather than beside the kickstart's own immediate one.
if until_true 45 spawns_past "$((before + 3))"; then
  pass "KeepAlive respawns an agent that exits 0"
else
  fail "KeepAlive respawns an agent that exits 0" \
    "$(($(spawn_count) - before)) starts after the kickstart, wanted 3"
fi
gap="$(tail -2 "$home/spawns" | awk 'NR == 1 { first = $1 } END { print $1 - first }')"
if [ "$gap" -lt "$window_s" ]; then
  pass "a throttled respawn lands inside ensureDaemon's ${window_s}s window (${gap}s)"
else
  fail "a throttled respawn lands inside ensureDaemon's ${window_s}s window" \
    "${gap}s between starts, so SUPERVISOR_WINDOW_MS no longer covers the throttle"
fi

printf -- '--- restart: what kickstart -k costs the same hook\n'
set_mode run
launchctl kickstart -k "$target" >/dev/null
until_true 45 job_running
before="$(spawn_count)"
kicked_at="$(date +%s)"
# Killed right after its own start, the worst case for the throttle: launchd measures
# ThrottleInterval start to start, so a daemon that has been up a while comes back sooner
# than this one does.
launchctl kickstart -k "$target" >/dev/null
if until_true "$window_s" spawns_past "$((before + 1))"; then
  pass "a successor starts inside the ${window_s}s window ($(($(last_spawn) - kicked_at))s)"
else
  fail "a successor starts inside the ${window_s}s window" \
    "none after ${window_s}s, which is all restart()'s caller waits"
fi

printf -- '--- drain: SIGTERM must leave the daemon the plist ExitTimeOut, not a default\n'
set_mode drain
rm -f "$home/drain-ready" "$home/draining" "$home/drained"
launchctl kickstart -k "$target" >/dev/null
# The launcher resolves caret before it execs it, and a SIGTERM that lands first drains
# nothing.
until_true 45 test -e "$home/drain-ready"
launchctl kickstart -k "$target" >/dev/null
if until_true 30 test -e "$home/drained"; then
  pass "an 8s drain runs to completion under the ${exit_timeout}s ExitTimeOut"
else
  fail "an 8s drain runs to completion under the ${exit_timeout}s ExitTimeOut" \
    "no completion marker 30s after kickstart -k"
fi
# Back to a plain long-running agent, so the checks below are not timing against a drain.
set_mode run
launchctl kickstart -k "$target" >/dev/null
until_true 45 job_running

printf -- '--- disabled: the opt-out readStatus reads, and the near miss beside it\n'
launchctl disable "$target"
# The ERE form of the DISABLED regex in launchd-manager.ts with this run's label
# substituted, anchored at `$` where the TypeScript ends on `\b` — BSD grep has no `\b`,
# and print-disabled puts nothing after the word.
matches "print-disabled reports a disabled label" \
  "\"$label\" => (true|disabled)\$" launchctl print-disabled "$domain"
note "the spelling this release used" \
  "$(launchctl print-disabled "$domain" | grep -F "\"$label\"" | sed 's/^[[:space:]]*//')"
launchctl enable "$target"
matches "enable puts the label back" \
  "\"$label\" => enabled\$" launchctl print-disabled "$domain"
# The near miss the DISABLED pattern has to survive: every enabled agent on the machine
# reads as opted out if it ever matches the word inside `enabled`.
if launchctl print-disabled "$domain" 2>/dev/null | grep -qE "\"$label\" => (true|disabled)\$"; then
  fail "an enabled label does not also read as disabled" "the DISABLED pattern matched it"
else
  pass "an enabled label does not also read as disabled"
fi

printf -- '--- uninstall: what uninstall() gets back, loaded and not\n'
expect "bootout returns 0 on a loaded agent" 0 "" launchctl bootout "$target"
expect "bootout fails on an absent one, so uninstall() must be best-effort" 3 \
  "No such process" launchctl bootout "$target"

printf -- '---\n'
if [ "$failed" = 0 ]; then
  printf 'all checks ok\n'
else
  printf '%d check(s) failed\n' "$failed"
fi
exit $((failed > 0))
