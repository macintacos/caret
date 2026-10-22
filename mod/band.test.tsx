import type { Engine } from "claude-code/testing";
import { expect, test } from "claude-code/testing";

const BAND = {
  plugin: "caret",
  component: "AbovePrompt",
  surface: "terminal",
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const;

const LINK = "http://caret.localhost:42718/?review=r1";

const band = async ($: Engine) => {
  const ui = await $.ui.mount(BAND);
  const text = (await ui.find({ type: "Text" }))?.text;
  await ui.unmount();
  return text;
};

const link = async ($: Engine) => {
  const ui = await $.ui.mount(BAND);
  const href = (await ui.find({ type: "Link" }))?.props?.href;
  await ui.unmount();
  return href;
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const engineUi = (on: Parameters<Parameters<typeof test>[1]>[1]) => {
  on("ui.render", ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine</Text>;
  });
  on("session.id", () => ({ value: "session-a" }));
};

test("the band links review_plan's pending review and its button opens it", async ($, on) => {
  engineUi(on);
  let approve = () => {};
  on("tool.call", () => new Promise((resolve) => (approve = () => resolve({ result: {} }))));
  const runs: (readonly string[])[] = [];
  on("process.run", (_, e) => {
    runs.push(e.argv);
    return { value: { exitCode: 0, stdout: `${LINK}\n`, stderr: "" } };
  });

  const review = $.tool.call({ tool: "mcp__plugin_caret_caret__review_plan", plan: "" });
  await tick();
  expect(await band($)).toContain("🥕 CARET PLAN WAITING");
  expect(await link($)).toBe(LINK);
  expect(runs[0]?.slice(2)).toEqual(["band-link", "--session", "mcp-session-a"]);
  expect(runs[0]?.[0]).toBe("bash");
  expect(runs[0]?.[1]?.endsWith("/bin/caret")).toBe(true);

  const ui = await $.ui.mount(BAND);
  await ui.press({ key: "open in browser" });
  await ui.unmount();
  expect(runs[1]?.slice(2)).toEqual(["band-link", "--session", "mcp-session-a", "--open"]);

  approve();
  await review;
  expect(await band($)).toBe("engine");
});

test("the band shows while caret holds the ExitPlanMode permission request", async ($, on) => {
  engineUi(on);
  let decide = () => {};
  let hold = () => {};
  const held = new Promise<void>((resolve) => (hold = resolve));
  on("classic.PermissionRequest", () => {
    hold();
    return new Promise((resolve) => (decide = () => resolve({})));
  });
  const runs: (readonly string[])[] = [];
  on("process.run", (_, e) => {
    runs.push(e.argv);
    return { value: { exitCode: 0, stdout: LINK, stderr: "" } };
  });

  const request = $.classic.PermissionRequest({
    tool_name: "ExitPlanMode",
    tool_input: {},
    session_id: "session-b",
  });
  await held;
  await tick();
  expect(await band($)).toContain("🥕 CARET PLAN WAITING");
  expect(runs[0]?.slice(2)).toEqual(["band-link", "--session", "session-b"]);

  decide();
  await request;
  expect(await band($)).toBe("engine");
});

test("no band shows when caret answers with no link", async ($, on) => {
  engineUi(on);
  let approve = () => {};
  on("tool.call", () => new Promise((resolve) => (approve = () => resolve({ result: {} }))));
  on("process.run", () => ({ value: { exitCode: 0, stdout: "", stderr: "" } }));

  const review = $.tool.call({ tool: "mcp__plugin_caret_caret__review_plan", plan: "" });
  await tick();
  expect(await band($)).toBe("engine");
  approve();
  await review;
});

test("a review resolves with its result when caret cannot run", async ($, on) => {
  engineUi(on);
  let approve = () => {};
  on("tool.call", () => new Promise((resolve) => (approve = () => resolve({ result: { ok: 1 } }))));
  on("process.run", () => ({ deny: "no" }));

  const review = $.tool.call({ tool: "mcp__plugin_caret_caret__review_plan", plan: "" });
  await tick();
  expect(await band($)).toBe("engine");
  approve();
  expect(await review).toEqual({ result: { ok: 1 } });
});

test("a link that arrives after the review ended draws no band", async ($, on) => {
  engineUi(on);
  let approve = () => {};
  let answer = () => {};
  const answered = new Promise<void>((resolve) => (answer = resolve));
  let hold = () => {};
  const held = new Promise<void>((resolve) => (hold = resolve));
  on("tool.call", () => {
    hold();
    return new Promise((resolve) => (approve = () => resolve({ result: {} })));
  });
  on("process.run", async () => {
    await answered;
    return { value: { exitCode: 0, stdout: LINK, stderr: "" } };
  });

  const review = $.tool.call({ tool: "mcp__plugin_caret_caret__review_plan", plan: "" });
  await held;
  approve();
  await review;
  answer();
  await tick();
  expect(await band($)).toBe("engine");
});

test("a review that fails clears the band", async ($, on) => {
  engineUi(on);
  let fail = () => {};
  on("tool.call", () => new Promise((_, reject) => (fail = () => reject(new Error("timeout")))));
  on("process.run", () => ({ value: { exitCode: 0, stdout: LINK, stderr: "" } }));

  const review = $.tool.call({ tool: "mcp__plugin_caret_caret__review_plan", plan: "" });
  await tick();
  expect(await band($)).toContain("🥕 CARET PLAN WAITING");
  fail();
  await expect(review).rejects.toThrow();
  expect(await band($)).toBe("engine");
});

test("a call refused while another review waits leaves that review's band up", async ($, on) => {
  engineUi(on);
  const approvals: Array<() => void> = [];
  on("tool.call", () => new Promise((resolve) => approvals.push(() => resolve({ result: {} }))));
  let calls = 0;
  let answerInner = () => {};
  const innerAnswered = new Promise<void>((resolve) => (answerInner = resolve));
  on("process.run", async () => {
    if (calls++ > 0) await innerAnswered;
    return { value: { exitCode: 0, stdout: LINK, stderr: "" } };
  });

  const outer = $.tool.call({ tool: "mcp__plugin_caret_caret__review_plan", plan: "" });
  const inner = $.tool.call({ tool: "mcp__plugin_caret_caret__review_plan", plan: "" });
  while (approvals.length < 2) await tick();
  await tick();
  approvals[1]?.();
  await inner;
  answerInner();
  await tick();
  expect(await band($)).toContain("🥕 CARET PLAN WAITING");

  approvals[0]?.();
  await outer;
  expect(await band($)).toBe("engine");
});
