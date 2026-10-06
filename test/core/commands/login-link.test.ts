import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { drainProcess } from "@test/support/cli-process.ts";
import { setupTempStateDir } from "@test/support/env.ts";
import { exposureWarning, loginLinkOutcome } from "@/commands/login-link.ts";

test.each([
  [{ host: "0.0.0.0", auth: "none" as const }, true],
  [{ host: "0.0.0.0" }, false],
  [{ host: "127.0.0.1", auth: "none" as const }, false],
])("exposureWarning(%o) warns: %p", (daemon, warns) => {
  const warning = exposureWarning(daemon, 4242);
  if (warns) {
    expect(warning).toContain(`daemon.host = ${daemon.host}`);
    expect(warning).toContain("port 4242");
  } else {
    expect(warning === null).toBe(true);
  }
});

const TOKEN_ON = { host: "127.0.0.1", auth: "token" as const, hostnames: ["caret.test"] };
const TOKEN_FILE = "/state/caret/daemon.token";

test("loginLinkOutcome prints the login link when auth is on and a token exists", () => {
  expect(loginLinkOutcome(TOKEN_ON, 4242, "tok123", TOKEN_FILE)).toEqual({
    stdout: "http://caret.test:4242/?token=tok123",
    stderr: [],
    code: 0,
  });
});

test("loginLinkOutcome fails naming the token file when no daemon has minted one", () => {
  const outcome = loginLinkOutcome(TOKEN_ON, 4242, null, TOKEN_FILE);
  expect(outcome.code).toBe(1);
  expect(outcome.stdout).toBeUndefined();
  expect(outcome.stderr.join("\n")).toContain(TOKEN_FILE);
});

test.each([
  [{ host: "0.0.0.0", auth: "none" as const, hostnames: [] }, true],
  [{ host: "127.0.0.1", hostnames: [] }, false],
])("loginLinkOutcome with auth off (%o) points at the plain URL, warning: %p", (daemon, warns) => {
  const outcome = loginLinkOutcome(daemon, 4242, "tok123", TOKEN_FILE);
  expect(outcome.code).toBe(1);
  expect(outcome.stdout).toBeUndefined();
  expect(outcome.stderr[0]).toContain("http://caret.localhost:4242");
  expect(outcome.stderr.length).toBe(warns ? 2 : 1);
});

const stateDir = setupTempStateDir("caret-login-link-");

test("caret login-link writes the outcome to stdout and its exit code", async () => {
  const configFile = join(stateDir(), "config.toml");
  await writeFile(configFile, '[daemon]\nauth = "token"\nhostnames = ["caret.test"]\n');
  await mkdir(join(stateDir(), "caret"), { recursive: true });
  await writeFile(join(stateDir(), "caret", "daemon.token"), "tok123");
  const r = await drainProcess(
    Bun.spawn([process.execPath, "src/cli.ts", "login-link"], {
      env: { ...process.env, CARET_CONFIG_FILE: configFile, CARET_PORT: "4242" },
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
  expect(r.exit).toBe(0);
  expect(r.stdout).toBe("http://caret.test:4242/?token=tok123\n");
});
