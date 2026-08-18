# Retry the worker health check before declaring it dead

## Context

The supervisor marks a worker dead the first time its health check fails, so a single
dropped packet costs a restart. Restarts are not free: the in-flight job is abandoned and
re-queued, and the replacement spends its first few seconds warming caches.

Three of last week's five restarts came back healthy on the very next probe, which is the
shape of a transient failure rather than a dead process.

## Approach

Give the health check a small retry budget before it reports failure. The supervisor keeps
its current interface — one boolean per worker — so nothing downstream has to learn that
retries exist.

The budget is deliberately small. A worker that is genuinely wedged should still be
replaced quickly, and a long retry loop would only turn a dead worker into a slow one.

## Steps

1. Give the probe a retry budget, spaced by the poll interval it already uses.
2. Report failure only once the budget is exhausted.
3. Log a warning on each retried probe, so a flapping worker stays visible.
4. Leave the restart path itself untouched.

## Verification

Kill a worker outright and confirm it is still replaced within one poll cycle of the
budget running out. Then drop a single probe with a firewall rule and confirm no restart
happens at all.

## Risks

A wedged worker now survives the whole budget rather than one probe, which delays its
replacement by that much. That is the trade the retry buys, and keeping the budget short
is what bounds it.
