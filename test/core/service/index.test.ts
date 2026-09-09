import { expect, test } from "bun:test";

import { SERVICE_LABELS, selectServiceManager, servicePlatform } from "@/service/index.ts";
import { LAUNCHD_LABEL, type ServiceManager, SYSTEMD_UNIT } from "@/service/manager.ts";

function fakeManager(): ServiceManager {
  return {
    install: async () => {},
    uninstall: async () => {},
    status: async () => ({ installed: false, running: false, disabled: false }),
    restart: async () => {},
  };
}

const managers = { darwin: fakeManager(), linux: fakeManager() };

test("selectServiceManager picks the manager for the running platform", () => {
  expect(selectServiceManager(managers, "darwin")).toBe(managers.darwin);
  expect(selectServiceManager(managers, "linux")).toBe(managers.linux);
});

test("servicePlatform narrows the two platforms residency is implemented for", () => {
  expect(servicePlatform("darwin")).toBe("darwin");
  expect(servicePlatform("linux")).toBe("linux");
});

test("servicePlatform rejects anything else by name, before a manager is built", () => {
  expect(() => servicePlatform("win32")).toThrow(/win32/);
  expect(() => servicePlatform("win32")).toThrow(/darwin\/linux/);
});

test("each platform's label is the one its manager accepts", () => {
  expect(SERVICE_LABELS.darwin).toBe(LAUNCHD_LABEL);
  expect(SERVICE_LABELS.linux).toBe(SYSTEMD_UNIT);
});

test("selectServiceManager rejects an unsupported platform by name", () => {
  expect(() => selectServiceManager(managers, "win32")).toThrow(/win32/);
  expect(() => selectServiceManager(managers, "win32")).toThrow(/darwin\/linux/);
});
