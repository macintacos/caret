// Network helpers shared across the subprocess tests.

/**
 * A loopback port that is free right now (probe-then-release).
 *
 * Racy in principle — the port is released before the caller reuses it — but on
 * loopback a collision is vanishingly unlikely in a test run.
 */
export function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
  const port = probe.port!;
  probe.stop();
  return port;
}
