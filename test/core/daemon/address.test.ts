import { expect, test } from "bun:test";

import { DEFAULTS } from "@/config/settings.ts";
import {
  authEnabled,
  connectHostname,
  daemonBaseUrl,
  isExposed,
  localHostname,
  loginLink,
  publicHostname,
} from "@/daemon/address.ts";

test.each([
  ["127.0.0.1", false],
  ["127.5.5.5", false],
  ["::1", false],
  ["localhost", false],
  ["0.0.0.0", true],
  ["::", true],
  ["192.168.1.5", true],
  ["fe80::1", true],
])("isExposed(%s) is %p", (host, exposed) => {
  expect(isExposed(host)).toBe(exposed);
});

test.each([
  [{ host: "127.0.0.1" }, false],
  [{ host: "0.0.0.0" }, true],
  [{ host: "127.0.0.1", auth: "token" as const }, true],
  [{ host: "0.0.0.0", auth: "none" as const }, false],
])("authEnabled(%o) is %p", (daemon, on) => {
  expect(authEnabled(daemon)).toBe(on);
});

test.each([
  ["127.0.0.1", "127.0.0.1"],
  ["localhost", "localhost"],
  ["0.0.0.0", "127.0.0.1"],
  ["::", "[::1]"],
  ["::1", "[::1]"],
  ["0:0:0:0:0:0:0:1", "[::1]"],
  ["192.168.1.5", "192.168.1.5"],
  ["fe80::1", "[fe80::1]"],
  ["FE80::1", "[fe80::1]"],
])("connectHostname(%s) is %s", (host, name) => {
  expect(connectHostname(host)).toBe(name);
});

test("daemonBaseUrl joins the connect hostname and the port", () => {
  expect(daemonBaseUrl(DEFAULTS)).toBe(`http://127.0.0.1:${DEFAULTS.daemon.port}`);
  expect(
    daemonBaseUrl({ ...DEFAULTS, daemon: { ...DEFAULTS.daemon, host: "::", port: 5000 } }),
  ).toBe("http://[::1]:5000");
});

test.each([
  ["127.0.0.1", "caret.localhost"],
  ["localhost", "caret.localhost"],
  ["0.0.0.0", "caret.localhost"],
  ["192.168.1.5", "192.168.1.5"],
  ["::", "[::1]"],
])("localHostname(%s) is %s", (host, name) => {
  expect(localHostname(host)).toBe(name);
});

test("publicHostname prefers the first configured hostname", () => {
  expect(publicHostname({ host: "0.0.0.0", hostnames: ["caret.lan", "other.lan"] })).toBe(
    "caret.lan",
  );
});

test("publicHostname falls back to the local hostname", () => {
  expect(publicHostname({ host: "0.0.0.0", hostnames: [] })).toBe("caret.localhost");
});

test("loginLink adds the token to a bare origin", () => {
  expect(loginLink("http://caret.lan:42718/", "abc")).toBe("http://caret.lan:42718/?token=abc");
});

test("loginLink keeps an existing review query", () => {
  expect(loginLink("http://caret.lan:42718/?review=r1", "abc")).toBe(
    "http://caret.lan:42718/?review=r1&token=abc",
  );
});
