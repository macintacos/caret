import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { capture, render } from "../../test-mount.ts";

import ReaderAffordances from "./ReaderAffordances.svelte";

const baseProps = {
  overflow: "scroll" as const,
  disableLineNumbers: false,
  onSetOverflow: () => {},
  onSetDisableLineNumbers: () => {},
};

describe("ReaderAffordances wrap toggle", () => {
  test("reflects the inactive wrap state", () => {
    const { target } = render(ReaderAffordances, baseProps);
    const wrap = target.querySelector<HTMLButtonElement>(".wrap-toggle")!;
    expect(wrap.getAttribute("aria-pressed")).toBe("false");
  });

  test("reflects the active wrap state", () => {
    const { target } = render(ReaderAffordances, { ...baseProps, overflow: "wrap" });
    const wrap = target.querySelector<HTMLButtonElement>(".wrap-toggle")!;
    expect(wrap.getAttribute("aria-pressed")).toBe("true");
  });

  test("clicking toggles overflow to wrap when scrolling", () => {
    const onSetOverflow = capture<"scroll" | "wrap">();
    const { target } = render(ReaderAffordances, {
      ...baseProps,
      overflow: "scroll",
      onSetOverflow: onSetOverflow.cb,
    });
    target.querySelector<HTMLButtonElement>(".wrap-toggle")!.click();
    expect(onSetOverflow.last()).toBe("wrap");
  });

  test("clicking toggles overflow back to scroll when wrapping", () => {
    const onSetOverflow = capture<"scroll" | "wrap">();
    const { target } = render(ReaderAffordances, {
      ...baseProps,
      overflow: "wrap",
      onSetOverflow: onSetOverflow.cb,
    });
    target.querySelector<HTMLButtonElement>(".wrap-toggle")!.click();
    expect(onSetOverflow.last()).toBe("scroll");
  });
});

describe("ReaderAffordances line-number toggle", () => {
  test("reads pressed when numbers are shown", () => {
    const { target } = render(ReaderAffordances, { ...baseProps, disableLineNumbers: false });
    const numbers = target.querySelector<HTMLButtonElement>(".line-numbers-toggle")!;
    expect(numbers.getAttribute("aria-pressed")).toBe("true");
  });

  test("reads unpressed when numbers are hidden", () => {
    const { target } = render(ReaderAffordances, { ...baseProps, disableLineNumbers: true });
    const numbers = target.querySelector<HTMLButtonElement>(".line-numbers-toggle")!;
    expect(numbers.getAttribute("aria-pressed")).toBe("false");
  });

  test("clicking hides the numbers when they are shown", () => {
    const onSetDisableLineNumbers = capture<boolean>();
    const { target } = render(ReaderAffordances, {
      ...baseProps,
      disableLineNumbers: false,
      onSetDisableLineNumbers: onSetDisableLineNumbers.cb,
    });
    target.querySelector<HTMLButtonElement>(".line-numbers-toggle")!.click();
    expect(onSetDisableLineNumbers.last()).toBe(true);
  });

  test("clicking shows the numbers when they are hidden", () => {
    const onSetDisableLineNumbers = capture<boolean>();
    const { target } = render(ReaderAffordances, {
      ...baseProps,
      disableLineNumbers: true,
      onSetDisableLineNumbers: onSetDisableLineNumbers.cb,
    });
    target.querySelector<HTMLButtonElement>(".line-numbers-toggle")!.click();
    expect(onSetDisableLineNumbers.last()).toBe(false);
  });
});
