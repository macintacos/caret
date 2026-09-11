import { expect, test } from "bun:test";

import { SERVICE_LABELS, servicePlatform } from "@/service/index.ts";
import { LAUNCHD_LABEL, SYSTEMD_UNIT } from "@/service/manager.ts";

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
