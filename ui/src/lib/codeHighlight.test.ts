import { describe, expect, test } from "bun:test";
import { highlightCode, plainCodeHtml, resolveLang } from "./codeHighlight.ts";

describe("resolveLang", () => {
  test("maps common fence aliases to canonical grammars", () => {
    expect(resolveLang("ts")).toBe("typescript");
    expect(resolveLang("js")).toBe("javascript");
    expect(resolveLang("bash")).toBe("shellscript");
    expect(resolveLang("py")).toBe("python");
    expect(resolveLang("TypeScript")).toBe("typescript"); // case-insensitive
  });

  test("unknown / empty / nullish languages resolve to null (plain fallback)", () => {
    expect(resolveLang("not-a-real-language")).toBeNull();
    expect(resolveLang("")).toBeNull();
    expect(resolveLang("   ")).toBeNull();
    expect(resolveLang(null)).toBeNull();
    expect(resolveLang(undefined)).toBeNull();
  });
});

describe("plainCodeHtml", () => {
  test("escapes the code so raw markup never renders live", () => {
    const html = plainCodeHtml("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("highlightCode", () => {
  test("a null or unknown language returns the escaped plain fallback", async () => {
    expect(await highlightCode("plain text", null)).toBe(plainCodeHtml("plain text"));
    expect(await highlightCode("x", "not-a-real-language")).toBe(plainCodeHtml("x"));
  });

  test("a known language returns caret-themed, dual-theme shiki markup", async () => {
    const html = await highlightCode("const x = 1;", "ts");
    expect(html).toContain("shiki");
    // defaultColor:false emits per-token CSS variables so light/dark switch via CSS.
    expect(html).toContain("--shiki-dark");
    expect(html).toContain("const");
  });
});
