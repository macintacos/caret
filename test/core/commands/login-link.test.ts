import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exposureWarning } from "@/commands/login-link.ts";

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

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

/** Run `caret login-link` over a temp config.toml holding `config` and a temp state home,
 * with `token` written to its token file when given. */
async function loginLink(config: string, token?: string) {
  const dir = await mkdtemp(join(tmpdir(), "caret-login-link-"));
  dirs.push(dir);
  const configFile = join(dir, "config.toml");
  await writeFile(configFile, config);
  const tokenFile = join(dir, "caret", "daemon.token");
  if (token !== undefined) {
    await mkdir(join(dir, "caret"), { recursive: true });
    await writeFile(tokenFile, token);
  }
  const proc = Bun.spawn([process.execPath, "src/cli.ts", "login-link"], {
    env: {
      ...process.env,
      CARET_CONFIG_FILE: configFile,
      XDG_STATE_HOME: dir,
      CARET_PORT: "4242",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code, tokenFile };
}

const TOKEN_ON = '[daemon]\nauth = "token"\nhostnames = ["caret.test"]\n';

test("login-link prints the login link when auth is on and a token exists", async () => {
  const r = await loginLink(TOKEN_ON, "tok123");
  expect(r.code).toBe(0);
  expect(r.stdout.trim()).toBe("http://caret.test:4242/?token=tok123");
});

test("login-link fails naming the token file when no daemon has minted one", async () => {
  const r = await loginLink(TOKEN_ON);
  expect(r.code).toBe(1);
  expect(r.stdout).toBe("");
  expect(r.stderr).toContain(r.tokenFile);
});

test("login-link fails pointing at the plain URL and warns when auth is off on an exposed bind", async () => {
  const r = await loginLink('[daemon]\nhost = "0.0.0.0"\nauth = "none"\n', "tok123");
  expect(r.code).toBe(1);
  expect(r.stdout).toBe("");
  expect(r.stderr).toContain("http://caret.localhost:4242");
  expect(r.stderr).toContain(exposureWarning({ host: "0.0.0.0", auth: "none" }, 4242) ?? "");
});
