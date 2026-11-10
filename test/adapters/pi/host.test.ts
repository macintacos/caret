import { expect, test } from "bun:test";

import { PI_FLOOR, parsePiVersion, readPiVersion, type VersionSpawn } from "@/adapters/pi/host.ts";

const printing =
  (stdout: string, exitCode: number | null = 0): VersionSpawn =>
  async () => ({ exitCode, stdout });

test("parsePiVersion reads the first X.Y.Z, bare or prefixed", () => {
  expect(parsePiVersion("1.5.0\n")).toBe("1.5.0");
  expect(parsePiVersion("pi 1.6.2")).toBe("1.6.2");
  expect(parsePiVersion("garbage")).toBeNull();
});

test("readPiVersion is ok at or above the floor", async () => {
  expect(await readPiVersion(printing("1.5.0\n"))).toEqual({ status: "ok", version: "1.5.0" });
  expect(await readPiVersion(printing("1.7.0\n"))).toEqual({ status: "ok", version: "1.7.0" });
});

test("readPiVersion flags a version below the floor as too-old", async () => {
  expect(await readPiVersion(printing("1.4.9\n"))).toEqual({ status: "too-old", version: "1.4.9" });
});

test("readPiVersion flags major 0 as pre-rename", async () => {
  expect(await readPiVersion(printing("0.31.2\n"))).toEqual({
    status: "pre-rename",
    version: "0.31.2",
  });
});

test("readPiVersion reads missing when pi cannot report a version", async () => {
  const throwing: VersionSpawn = async () => {
    throw new Error("ENOENT");
  };
  expect(await readPiVersion(throwing)).toEqual({ status: "missing" });
  expect(await readPiVersion(printing("1.5.0\n", 1))).toEqual({ status: "missing" });
  expect(await readPiVersion(printing("", null))).toEqual({ status: "missing" });
  expect(await readPiVersion(printing("garbage"))).toEqual({ status: "missing" });
});

test("readPiVersion runs `pi --version`", async () => {
  let argv: readonly string[] = [];
  await readPiVersion(async (a) => {
    argv = a;
    return { exitCode: 0, stdout: "1.5.0" };
  });
  expect(argv).toEqual(["pi", "--version"]);
});

test("PI_FLOOR is 1.5.0, the first release published as pi", () => {
  expect(PI_FLOOR).toBe("1.5.0");
});
