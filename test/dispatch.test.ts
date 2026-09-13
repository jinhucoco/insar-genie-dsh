import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PLUGIN_ID,
  FUNCTIONS,
  detectDispatch,
  renderMenu,
  buildDispatchText,
  buildDispatchMessage,
  registerDispatch,
  type PreStepDecision,
  type PreStepPayload,
} from "../src/host/dispatch.js";
import { resolveAssetsDir } from "../src/host/paths.js";

type Handler = (
  payload: PreStepPayload,
  next: () => Promise<PreStepDecision>,
) => Promise<PreStepDecision>;

/** 造一个只捕获 agent/pre-step 监听器的假 ctx（命中/未命中都不需要真会话） */
function makeCtx() {
  let handler: Handler | undefined;
  const warnings: string[] = [];
  const ctx = {
    on: (name: string, h: Handler) => {
      if (name === "agent/pre-step") handler = h;
    },
    logger: { warn: (message: string) => warnings.push(message) },
  } as unknown as Parameters<typeof registerDispatch>[0];
  registerDispatch(ctx);
  return {
    warnings,
    run: (
      payload: PreStepPayload,
      decision?: PreStepDecision,
    ): Promise<PreStepDecision> => {
      if (!handler) throw new Error("registerDispatch 未注册 agent/pre-step");
      // 忠实模拟真实 loop：next() 默认原样返回已认领的消息批次
      const claimed = decision ?? { kind: "enter", messages: [...(payload.messages ?? [])] };
      return handler(payload, async () => claimed);
    },
  };
}

/** 一条用户文本消息（agent/pre-step 载荷里的最小形状） */
function userMessage(text: string) {
  return { role: "user", content: [{ type: "text", text }] };
}

describe("detectDispatch：裸关键词要触发", () => {
  it.each([
    "insar",
    "SBAS",
    "实验",
    "哨兵",
    "干涉",
    "形变",
    "SARscape",
    "GACOS",
    "帮我看看 insar",
    "搞个 SBAS 吧",
    "实验",
    "insar 是什么",
    "POEORB",
  ])("「%s」→ 触发", (text) => {
    expect(detectDispatch(text)).toBe(true);
  });
});

describe("detectDispatch：已给出明确任务不触发", () => {
  it.each([
    "实验进展如何",
    "跑SBAS，区域古浪.shp，时间20200101至20251231",
    "下载配套数据",
    "就用推荐值",
    "没问题，全部确认",
    "insar 用 G:/minqin2 的数据",
    "帮我跑一下实验",
    "开始第2步",
    "检查一下环境",
    "查看 insar 状态",
    "参数怎么设",
    "insar 研究区 2024年",
    "重跑 geocode",
  ])("「%s」→ 不触发", (text) => {
    expect(detectDispatch(text)).toBe(false);
  });
});

describe("detectDispatch：与 insar 无关的文本一律不触发", () => {
  it.each(["帮我写个正则", "把 README 翻译成英文", "今天天气不错", "", "   "])(
    "「%s」→ 不触发",
    (text) => {
      expect(detectDispatch(text)).toBe(false);
    },
  );
});

describe("agent/pre-step 注入", () => {
  it("turn 第一个 step + 裸关键词 → 追加一条插件指令消息", async () => {
    const { run } = makeCtx();
    const decision = await run({ messages: [userMessage("SBAS")], turn: 7, step: 1 });
    expect(decision.kind).toBe("enter");
    expect(decision.messages).toHaveLength(2);
    const injected = decision.messages?.[1] as {
      id: string;
      role: string;
      content: { type: string; text: string }[];
      source: { kind: string; plugin: string; form: string };
    };
    expect(injected.role).toBe("user");
    expect(injected.source).toEqual({ kind: "plugin", plugin: PLUGIN_ID, form: "instructions" });
    expect(injected.content[0].type).toBe("text");
    expect(injected.content[0].text).toMatch(/你想做哪一件/);
    // 八项菜单全在注入文本里
    for (const item of FUNCTIONS) expect(injected.content[0].text).toContain(item.label);
  });

  it("保留原有消息，注入追加在末尾", async () => {
    const { run } = makeCtx();
    const original = userMessage("实验");
    const decision = await run({ messages: [original], turn: 1, step: 1 });
    expect(decision.messages?.[0]).toBe(original);
    expect(decision.messages).toHaveLength(2);
  });

  it("只在 turn 第一个 step 注入（step=2 不注入，同一 turn 不会弹两次菜单）", async () => {
    const { run } = makeCtx();
    const original = userMessage("实验");
    const decision = await run({ messages: [original], turn: 1, step: 2 });
    expect(decision.messages).toEqual([original]);
  });

  it("明确任务不注入", async () => {
    const { run } = makeCtx();
    const original = userMessage("跑SBAS，区域古浪.shp，20200101至20251231");
    const decision = await run({ messages: [original], turn: 1, step: 1 });
    expect(decision.messages).toEqual([original]);
  });

  it("非 user 消息（系统/工具结果）不参与判定", async () => {
    const { run } = makeCtx();
    const original = { role: "assistant", content: [{ type: "text", text: "SBAS" }] };
    const decision = await run({ messages: [original], turn: 1, step: 1 });
    expect(decision.messages).toEqual([original]);
  });

  it("decision 为 reject 时原样放行", async () => {
    const { run } = makeCtx();
    const decision = await run({ messages: [userMessage("insar")], turn: 1, step: 1 }, { kind: "reject" });
    expect(decision).toEqual({ kind: "reject" });
  });

  it("监听体内部异常不抛出，只 warn 一次，原样返回 decision", async () => {
    const { run, warnings } = makeCtx();
    // content 取值即抛：命中判定路径里的异常必须被吞掉，不能拖垮会话
    const bomb = {
      role: "user",
      get content(): unknown {
        throw new Error("boom");
      },
    };
    const decision = await run({ messages: [bomb], turn: 1, step: 1 });
    expect(decision.kind).toBe("enter");
    expect(decision.messages).toEqual([bomb]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/关键词调度注入失败/);

    await run({ messages: [bomb], turn: 2, step: 1 });
    expect(warnings).toHaveLength(1);
  });
});

describe("菜单内容与防漂移", () => {
  it("菜单 8 项、编号连续", () => {
    expect(FUNCTIONS).toHaveLength(8);
    expect(FUNCTIONS.map((f) => f.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("菜单每一项的 label 都出现在 assets/SKILL.md 正文（两处定义必须一致）", () => {
    const skill = readFileSync(join(resolveAssetsDir(), "SKILL.md"), "utf8");
    for (const item of FUNCTIONS) {
      expect(skill, `SKILL.md 缺少菜单项「${item.label}」`).toContain(item.label);
    }
    expect(skill).toContain("零号动作");
  });

  it("注入文本与 renderMenu 同源，并带上兜底例外条款", () => {
    const text = buildDispatchText();
    expect(text).toContain(renderMenu());
    expect(text).toMatch(/忽略本条/);
    expect(text).toContain("你想做哪一件");
  });

  it("注入消息 id 全局唯一（同一 turn 重跑也不会撞 id 破坏历史回放）", () => {
    const ids = new Set([buildDispatchMessage(3).id, buildDispatchMessage(3).id, buildDispatchMessage(4).id]);
    expect(ids.size).toBe(3);
  });
});
