import { describe, expect, test } from "bun:test";

import { configToToml, formatUptime, readDaemonPort } from "$lib/diagnostics.ts";

// Pure formatters behind the Advanced diagnostics pane (EXC-848): they turn the
// wire shapes (uptime ms, the opaque settings graph) into the block text the pane
// renders. No DOM, so this is a plain bun-test unit.

describe("formatUptime", () => {
  test("seconds under a minute", () => {
    expect(formatUptime(0)).toBe("0s");
    expect(formatUptime(45_000)).toBe("45s");
    expect(formatUptime(59_999)).toBe("59s");
  });

  test("whole minutes under an hour drop the seconds", () => {
    expect(formatUptime(60_000)).toBe("1m");
    expect(formatUptime(3 * 60_000 + 45_000)).toBe("3m");
  });

  test("hours and minutes under a day", () => {
    expect(formatUptime(3_600_000)).toBe("1h 0m");
    expect(formatUptime(2 * 3_600_000 + 14 * 60_000)).toBe("2h 14m");
  });

  test("days and hours at a day or more", () => {
    expect(formatUptime(25 * 3_600_000)).toBe("1d 1h");
    expect(formatUptime(2 * 86_400_000 + 3 * 3_600_000)).toBe("2d 3h");
  });
});

describe("readDaemonPort", () => {
  test("returns a numeric daemon.port from the settings graph", () => {
    expect(readDaemonPort({ daemon: { port: 42718 } })).toBe(42718);
  });

  test("undefined when the port is missing, non-numeric, or the graph isn't a daemon table", () => {
    expect(readDaemonPort({ daemon: {} })).toBeUndefined();
    expect(readDaemonPort({ daemon: { port: "42718" } })).toBeUndefined();
    expect(readDaemonPort({})).toBeUndefined();
    expect(readDaemonPort(null)).toBeUndefined();
    expect(readDaemonPort("nope")).toBeUndefined();
  });
});

describe("configToToml", () => {
  test("serializes nested settings into TOML tables", () => {
    const toml = configToToml({ daemon: { port: 42718 }, review: { timeout_s: 3600 } });
    expect(toml).toContain("[daemon]");
    expect(toml).toContain("port = 42718");
    expect(toml).toContain("[review]");
    expect(toml).toContain("timeout_s = 3600");
  });

  test("empty settings serialize to an empty string", () => {
    expect(configToToml({}).trim()).toBe("");
  });
});
