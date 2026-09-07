import { expect, test } from "bun:test";

import { selectServiceManager } from "@/service/index.ts";
import type { ServiceManager } from "@/service/manager.ts";

function fakeManager(): ServiceManager {
  return {
    install: async () => {},
    uninstall: async () => {},
    status: async () => ({ installed: false, running: false }),
    restart: async () => {},
  };
}

const managers = { darwin: fakeManager(), linux: fakeManager() };

test("selectServiceManager picks the manager for the running platform", () => {
  expect(selectServiceManager(managers, "darwin")).toBe(managers.darwin);
  expect(selectServiceManager(managers, "linux")).toBe(managers.linux);
});

test("selectServiceManager rejects an unsupported platform by name", () => {
  expect(() => selectServiceManager(managers, "win32")).toThrow(/win32/);
  expect(() => selectServiceManager(managers, "win32")).toThrow(/macOS.*Linux/);
});
