#!/usr/bin/env bash
#
# Drives the launchctl sequence createLaunchdManager performs, against the plist
# buildLaunchdPlist() really emitted, in this Mac's own login session. `mise run macos
# verify` generates that plist and the throwaway HOME and puts this script on them.
#
# Every check states what launchd answered, because these answers are what
# src/service/launchd-manager.ts is written against — a release that changes one should
# fail here rather than in a user's login.
set -uo pipefail

# Never $HOME: everything below builds a fake caret install and hands it to launchd, and
# the developer's real home must not be where that lands.
home="${CARET_VERIFY_HOME:?set by .mise/tasks/macos}"
label="${CARET_VERIFY_LABEL:?set by .mise/tasks/macos}"
window_ms="${CARET_VERIFY_WINDOW_MS:?set by .mise/tasks/macos}"
real_label="${CARET_VERIFY_REAL_LABEL:?set by .mise/tasks/macos}"
plist="${CARET_VERIFY_PLIST:?set by .mise/tasks/macos}"
uid="$(id -u)"
domain="gui/$uid"
target="$domain/$label"
window_s=$((window_ms / 1000))
failed=0

# The machine the real bin/caret-launcher resolves against before it execs. `run` is the
# resident case and `drain` a resident daemon slow to stop; any other mode is the status
# to exit with. The `service` record names the throwaway label, which is what arms the
# launcher's stop_agent for the terminal-exit section below; evict() cannot fire beside it,
# since its branch needs candidate_dirs empty and the version directory here populates it.
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
printf '%s\n' "$label" >"$home/.local/state/caret/launcher/service"

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

# The ERE form of the DISABLED regex in launchd-manager.ts for one label: its dots
# escaped as the TypeScript escapes them, the same whitespace tolerance, and anchored at
# `$` where the TypeScript ends on `\b` — BSD grep has no `\b`, and print-disabled puts
# nothing after the word. One derivation, so the pattern under test and the near miss
# beside it cannot drift apart.
disabled_re() {
  printf '"%s"[[:space:]]*=>[[:space:]]*(true|disabled)$' "${1//./\\.}"
}

# A label's own print-disabled row, for the notes that record what a release spelled
# without asserting it.
spelling_of() {
  launchctl print-disabled "$domain" | grep -F "\"$1\"" | sed 's/^[[:space:]]*//'
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

# readStatus's `state = running` pattern (launchd-manager.ts) as an ERE, carrying that
# regex's own whitespace tolerance and anchored at `$` where it ends on `\b` — BSD grep has
# no `\b`. Spelled once, because the check below and this predicate must not drift apart.
running_re='^[[:space:]]*state[[:space:]]*=[[:space:]]*running$'
# job_running, job_gone and spawns_past reach until_true only as `"$@"`, which shellcheck
# cannot follow.
# shellcheck disable=SC2329
job_running() { launchctl print "$target" 2>/dev/null | grep -qE "$running_re"; }
# The negation lives in the predicate: bash does not recognise `!` as the reserved word
# once it arrives through until_true's `"$@"`.
# shellcheck disable=SC2329
job_gone() { ! launchctl print "$target" >/dev/null 2>&1; }
spawn_count() { awk 'END { print NR }' "$home/spawns"; }
# shellcheck disable=SC2329
spawns_past() { [ "$(spawn_count)" -ge "$1" ]; }
last_spawn() { tail -1 "$home/spawns"; }

printf -- '--- host: what this release answers as\n'
note "the host these answers came from" \
  "macOS $(sw_vers -productVersion), domain $domain, window ${window_s}s"

printf -- '--- install: what launchd makes of the generated plist\n'
expect "bootstrap accepts the generated plist" 0 "" launchctl bootstrap "$domain" "$plist"
# launchd reports `state = xpcproxy` for the moment before it execs the job, so the two
# RUNNING patterns are read once the agent has settled rather than immediately.
until_true 20 job_running
# Read from the plist rather than restated here, so moving EXIT_TIMEOUT_SEC in
# src/service/launchd.ts moves what this asserts.
exit_timeout="$(awk '/<key>ExitTimeOut<\/key>/ { getline; gsub(/[^0-9]/, ""); print }' "$plist")"
# The getline assumes the integer sits on the next line; without this the pattern below
# would go unsatisfiable and blame launchd for a layout change in the builder.
[ -n "$exit_timeout" ] ||
  fail "read ExitTimeOut out of the generated plist" "no <integer> after the key"
matches "print reports the plist's ExitTimeOut of ${exit_timeout}s" \
  "^[[:space:]]*exit[[:space:]]+timeout[[:space:]]*=[[:space:]]*$exit_timeout\$" \
  launchctl print "$target"
matches "print reports a running state, one of readStatus's two RUNNING patterns" \
  "$running_re" launchctl print "$target"
matches "print reports a pid, the other one" \
  '^[[:space:]]*pid[[:space:]]*=[[:space:]]*[0-9]+$' launchctl print "$target"

printf -- '--- reload: the bootout/bootstrap pair a caret install --refresh takes\n'
# Back to back against a running agent, which is where `Bootstrap failed: 5: Input/output
# error` comes from: bootout returns before launchd has finished tearing the job down, and
# the bootstrap behind it lands on a domain still holding the old one.
reload_failure=""
for i in $(seq 1 10); do
  bootout_out="$(launchctl bootout "$target" 2>&1)"
  bootout_rc=$?
  bootstrap_out="$(launchctl bootstrap "$domain" "$plist" 2>&1)"
  bootstrap_rc=$?
  if [ "$bootout_rc" != 0 ] || [ "$bootstrap_rc" != 0 ]; then
    reload_failure="iteration $i: bootout rc=$bootout_rc ${bootout_out:-(silent)}, bootstrap rc=$bootstrap_rc ${bootstrap_out:-(silent)}"
    break
  fi
done
if [ -z "$reload_failure" ]; then
  pass "ten bootout/bootstrap cycles against a running agent"
else
  fail "ten bootout/bootstrap cycles against a running agent" "$reload_failure"
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
# nothing — a precondition rather than a settle-wait, so it reports itself instead of
# letting the check below blame ExitTimeOut for an agent that never started.
if until_true 45 test -e "$home/drain-ready"; then
  before="$(spawn_count)"
  launchctl kickstart -k "$target" >/dev/null
  # After the kickstart, not before: the mode file is read at start, so the instance now
  # draining keeps `drain` while the successor launchd brings up gets `run` — the sections
  # below are then not timing against a drain, and no drain goes unmeasured.
  set_mode run
  if until_true 30 test -e "$home/drained"; then
    pass "an 8s drain runs to completion under the ${exit_timeout}s ExitTimeOut"
  else
    fail "an 8s drain runs to completion under the ${exit_timeout}s ExitTimeOut" \
      "no completion marker 30s after kickstart -k"
  fi
  # A new spawn rather than `state = running`: the drainer's own pid stays alive for all 8s
  # of its trap, so a state read here would be answered by the predecessor.
  until_true 45 spawns_past "$((before + 1))"
else
  fail "a drain-mode agent starts, so the drain below is a drain" \
    "no drain-ready marker 45s after kickstart -k"
  set_mode run
fi

printf -- '--- terminal exit: what the launcher does where launchd has no allowlist\n'
# An unrunnable bin/caret with candidate_dirs still populated: the one launcher branch that
# exits 78 without evicting, so stop_agent is what has to take the agent down. KeepAlive is
# unconditional in the plist — systemd's RestartPreventExitStatus has no launchd spelling —
# which makes this the only brake on a respawn loop in a user's login session.
chmod -x "$caret_root/bin/caret"
launchctl kickstart -k "$target" >/dev/null
if until_true 45 job_gone; then
  pass "exit 78 boots the agent out, since KeepAlive would otherwise respawn into it"
else
  fail "exit 78 boots the agent out" "still loaded 45s after the kickstart"
fi
chmod +x "$caret_root/bin/caret"
launchctl bootstrap "$domain" "$plist" ||
  fail "the agent bootstraps again after booting itself out" "rc=$?"

printf -- '--- disabled: the opt-out readStatus reads, and the near miss beside it\n'
launchctl disable "$target"
matches "print-disabled reports a disabled label" "$(disabled_re "$label")" \
  launchctl print-disabled "$domain"
note "the spelling this release used for a disabled label" "$(spelling_of "$label")"
# The near miss this run creates for itself: the throwaway label is the real one plus a
# suffix, so only the pattern's closing quote keeps the developer's own agent from reading
# as opted out while this one is disabled. Read only — nothing here touches that label.
if launchctl print-disabled "$domain" 2>/dev/null | grep -qE "$(disabled_re "$real_label")"; then
  note "the prefix-collision near miss" \
    "$real_label is itself opted out on this host, so the collision cannot be told apart"
else
  pass "$real_label's DISABLED pattern does not match the disabled $label"
fi
launchctl enable "$target"
# Not asserted: pre-Ventura prints `=> false` and Ventura-era `=> enabled`, and no caret
# code reads either — the check below already proves the enable took effect, because a
# label still disabled would satisfy the DISABLED pattern.
note "the spelling this release used for an enabled label" "$(spelling_of "$label")"
if launchctl print-disabled "$domain" 2>/dev/null | grep -qE "$(disabled_re "$label")"; then
  fail "enable puts the label back" "the DISABLED pattern still matches it"
else
  pass "enable puts the label back"
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
