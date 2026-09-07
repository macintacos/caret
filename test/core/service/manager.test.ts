import { expect, test } from "bun:test";

import { serviceEnvironment } from "@/service/manager.ts";

test("serviceEnvironment always marks the daemon as supervised", () => {
  expect(serviceEnvironment({})).toEqual({ CARET_SUPERVISED: "1" });
});

test("serviceEnvironment passes through every world variable that is set", () => {
  expect(
    serviceEnvironment({
      HOME: "/home/ada",
      XDG_STATE_HOME: "/home/ada/.local/state",
      XDG_CONFIG_HOME: "/home/ada/.config",
      CARET_CONFIG_FILE: "/home/ada/.config/caret/config.toml",
      CARET_PORT: "42718",
    }),
  ).toEqual({
    HOME: "/home/ada",
    XDG_STATE_HOME: "/home/ada/.local/state",
    XDG_CONFIG_HOME: "/home/ada/.config",
    CARET_CONFIG_FILE: "/home/ada/.config/caret/config.toml",
    CARET_PORT: "42718",
    CARET_SUPERVISED: "1",
  });
});

test("serviceEnvironment omits a world variable that is empty or unset", () => {
  expect(serviceEnvironment({ HOME: "/home/ada", XDG_STATE_HOME: "" })).toEqual({
    HOME: "/home/ada",
    CARET_SUPERVISED: "1",
  });
  expect(serviceEnvironment({ HOME: "/home/ada", XDG_STATE_HOME: undefined })).toEqual({
    HOME: "/home/ada",
    CARET_SUPERVISED: "1",
  });
});

test("serviceEnvironment carries nothing outside the world set", () => {
  expect(serviceEnvironment({ PATH: "/usr/bin", EDITOR: "vim", HOME: "/home/ada" })).toEqual({
    HOME: "/home/ada",
    CARET_SUPERVISED: "1",
  });
});
