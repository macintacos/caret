import { expect, test } from "bun:test";

import { SERVICE_LABELS, selectServiceManager } from "@/service/index.ts";
import { LAUNCHD_LABEL, type ServiceManager, SYSTEMD_UNIT } from "@/service/manager.ts";

function fakeManager(): ServiceManager {
  return {
    install: async () => {},
    uninstall: async () => {},
    status: async () => ({ installed: false, running: false, disabled: false }),
    restart: async () => {},
  };
}

const darwin = fakeManager();
const linux = fakeManager();
const managers = { darwin: () => darwin, linux: () => linux };

test("selectServiceManager picks the manager for the running platform", () => {
  expect(selectServiceManager(managers, "darwin")).toBe(darwin);
  expect(selectServiceManager(managers, "linux")).toBe(linux);
});

test("only the running platform's manager is constructed", () => {
  const built: string[] = [];

  selectServiceManager(
    {
      darwin: () => {
        built.push("darwin");
        return darwin;
      },
      linux: () => {
        built.push("linux");
        return linux;
      },
    },
    "linux",
  );

  expect(built).toEqual(["linux"]);
});

test("each platform's label is the one its manager accepts", () => {
  expect(SERVICE_LABELS.darwin).toBe(LAUNCHD_LABEL);
  expect(SERVICE_LABELS.linux).toBe(SYSTEMD_UNIT);
});

test("selectServiceManager rejects an unsupported platform by name", () => {
  expect(() => selectServiceManager(managers, "win32")).toThrow(/win32/);
  expect(() => selectServiceManager(managers, "win32")).toThrow(/darwin\/linux/);
});
