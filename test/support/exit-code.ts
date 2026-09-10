// A reusable "this call left no failure exit code" matcher for the install suites.
import { expect } from "bun:test";

/**
 * Run `act` and assert it left `process.exitCode` clean, returning whatever it resolved
 * to.
 *
 * Resets before rather than snapshotting the code and comparing after. A snapshot reads
 * whatever ran earlier — an earlier case in the same file, or another file under a
 * shared-global `bun test <dir>` run — so a regression that sets the code is already
 * recorded by the time the snapshot is taken, and comparing against it passes. Resetting
 * makes the assertion both order-independent and falsifiable.
 */
export async function expectCleanExitCode<T>(act: () => Promise<T>): Promise<T> {
  process.exitCode = 0;
  const result = await act();
  expect(process.exitCode).toBe(0);
  return result;
}
