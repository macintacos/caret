// Network helpers shared across the subprocess tests.

/**
 * A loopback port that is free right now (probe-then-release).
 *
 * Binds an OS-assigned port, reads it, and releases it immediately. The window
 * between release and the caller's reuse is racy in principle, but loopback +
 * the OS's reuse backoff makes a collision vanishingly unlikely in a test run.
 */
export function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
  const port = probe.port!;
  probe.stop();
  return port;
}
