import { Context } from "@deepseek-ai/cordis";

/**
 * 关键词调度：裸关键词（insar / SBAS / 实验…）→ 功能菜单。
 *
 * 用户只说出领域关键词、没给明确任务时，在 `agent/pre-step` 注入一条
 * 「先列功能菜单再问用户想做哪一件」的调度指令。三层职责分开，便于单测：
 *
 *   1. 判定  {@link detectDispatch}      —— 纯函数（领域关键词 ∧ 无明确任务标记）
 *   2. 内容  {@link FUNCTIONS} / {@link buildDispatchText} —— 菜单唯一数据源
 *   3. 接线  {@link registerDispatch}    —— 挂 agent/pre-step，异常一律吞掉不伤会话
 *
 * 为什么要在宿主层强制注入：技能目录里的触发词靠模型自己命中 + 自己决定加载技能，
 * 裸关键词（尤其只有一个词的）命中率不稳。宿主层判定不依赖模型意愿，才是"必弹"的保证。
 * 技能层（assets/SKILL.md「零号动作」）再用同一份菜单兜一遍，两条路径行为一致。
 */

/** 本插件在注入消息 `source.plugin` 上的标识（也让其它组件能识别这条注入） */
export const PLUGIN_ID = "insar-genie-dsh";

/** 注入消息的 `source.form`：语义是「模型应当遵循的指令」，对齐 dsh-llm 的 ContextForm */
export const DISPATCH_FORM = "instructions" as const;

/** 领域关键词：命中即认为用户在问 SBAS-InSAR 这件事 */
const DOMAIN_RE =
  /insar|in-sar|sbas|sarscape|sentinel|哨兵|slc|gacos|poeorb|ztd|干涉|形变|沉降|解缠|连接图|反演|地理编码|基线|时相|多视|实验|earthdata/i;

/**
 * 明确任务标记：命中任一即认为用户已经说清要干什么，不需要菜单。
 * 三类：文件/路径、日期、动作词。
 */
const CONCRETE_RE = new RegExp(
  [
    // 文件 / 路径
    String.raw`\.(shp|kml|csv|zip|txt|ztd|hgt|dat|env|json|tif|tiff|img|hdr|sml|safe)\b`,
    String.raw`[a-z]:[\\/]`,
    // 日期
    String.raw`\b\d{8}\b`,
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    String.raw`\d{4}\s*年`,
    // 动作词
    "下载|导入|跑|执行|开始|继续|重跑|补跑|接着|查看|查一下|看一下|进展|进度|状态|结果|报告|注册|配置|设置|检查|自检|确认|就用|按推荐|没问题|怎么设|停止|取消|重来|恢复|汇报",
  ].join("|"),
  "i",
);

/** 功能菜单的一项 */
export interface InsarFunctionItem {
  /** 菜单编号（从 1 开始，与 SKILL.md 表一致） */
  readonly no: number;
  /** 菜单短名（单测断言它出现在 assets/SKILL.md 正文里，防两处漂移） */
  readonly label: string;
  /** 一句话说明（菜单里跟在破折号后面） */
  readonly hint: string;
}

/** 插件功能菜单 —— 宿主注入与 SKILL.md「零号动作」共用这一份定义 */
export const FUNCTIONS: readonly InsarFunctionItem[] = [
  {
    no: 1,
    label: "下载 SLC 主数据",
    hint: "从 ASF 搜索 / 校验 / 下载 Sentinel-1 SLC（同轨 + 逐时相覆盖保证）",
  },
  {
    no: 2,
    label: "下载配套数据",
    hint: "POEORB 精密轨道 / GACOS 大气延迟 / NASADEM",
  },
  {
    no: 3,
    label: "SLC 批量导入",
    hint: "按时相分组导入 SARscape（双帧自动拼接，支持续跑 / AOI 裁剪）",
  },
  {
    no: 4,
    label: "参数确认 + 跑 SBAS 全流程",
    hint: "地形识别 → 5 卡参数逐项确认 → 连接图 → 干涉 → 反演1 → 反演2 → 地理编码",
  },
  {
    no: 5,
    label: "单步执行 / 补跑",
    hint: "只跑某一步（连接图 / 干涉 / DEM / GACOS 导入 / 反演 / 地理编码）",
  },
  {
    no: 6,
    label: "查实验进展",
    hint: "当前步骤进度 / 实验列表 / 异常与停滞诊断",
  },
  {
    no: 7,
    label: "环境自检 / 账号配置",
    hint: "ENVI + SARscape 探测、config.env 生成、Earthdata 与 GACOS 邮箱配置",
  },
  {
    no: 8,
    label: "DEM 预处理",
    hint: "分幅拼接 → ENVI 导入（Geoidal DEM）→ 去大地水准面，产出可用 DEM",
  },
];

/**
 * 判定这条用户消息是否需要弹功能菜单。
 *
 * 取向是**保守**：宁可多注入一条（指令文本自带"已给出明确任务则忽略本条"兜底），
 * 也不漏掉裸关键词——漏掉才是这个功能的失败模式。
 *
 * @param text - 用户消息的纯文本（只看 text 块，不看附件与工具结果）
 * @returns true = 只说到了领域关键词、没给出明确任务 → 需要注入调度指令
 */
export function detectDispatch(text: string): boolean {
  if (typeof text !== "string" || text.trim().length === 0) return false;
  if (!DOMAIN_RE.test(text)) return false;
  return !CONCRETE_RE.test(text);
}

/** 渲染菜单文本（编号 + 短名 + 说明），宿主注入与 SKILL.md 表同源 */
export function renderMenu(): string {
  return FUNCTIONS.map((f) => `${f.no}. ${f.label} —— ${f.hint}`).join("\n");
}

/** 调度指令正文：告诉模型"这一轮只出菜单" */
export function buildDispatchText(): string {
  return [
    "【insar-genie 关键词调度】用户这条消息只提到了 insar / SBAS / 实验 等领域关键词，但没有给出明确任务。",
    "",
    "按下面执行（本条优先级最高）：",
    "0. 先加载 insar-genie 技能（后续每一步都以它的流程为准）；",
    "1. 这一轮只输出下面这份功能菜单（编号与文字照抄，不要增删），最后问一句「你想做哪一件？」；",
    "2. 不要自行猜测用户想做什么，不要反问研究区 / 时间范围等细节，不要调用其他工具；",
    "3. 例外：若这条消息其实已经给出了明确任务（有区域文件、时间范围、具体步骤或明确动作），忽略本条，直接照用户要求执行。",
    "",
    "功能菜单：",
    renderMenu(),
  ].join("\n");
}

/**
 * 注入消息（与 dsh-llm 的 UserMessage 同构；本插件不依赖该包，故本地声明形状）。
 * id 全局唯一，保证同一 turn 即使被重跑也只是多一条幂等提示，不会撞 id 破坏历史回放。
 */
export interface InjectedMessage {
  readonly id: string;
  readonly role: "user";
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly source: {
    readonly kind: "plugin";
    readonly plugin: string;
    readonly form: typeof DISPATCH_FORM;
  };
}

/** 注入消息 id 的自增序号（同毫秒内也不重复） */
let injectionSeq = 0;

/** 构造一条调度指令注入消息 */
export function buildDispatchMessage(turn: number): InjectedMessage {
  injectionSeq += 1;
  return {
    id: `insar-dispatch-t${turn}-${Date.now().toString(36)}-${injectionSeq}`,
    role: "user",
    content: [{ type: "text", text: buildDispatchText() }],
    source: { kind: "plugin", plugin: PLUGIN_ID, form: DISPATCH_FORM },
  };
}

/** `agent/pre-step` 载荷（本插件不依赖 @deepseek-ai/dsh-agent，只窄化用到的字段） */
export interface PreStepPayload {
  agent?: { session?: { id?: string } };
  messages?: readonly unknown[];
  turn?: number;
  step?: number;
}

/** `agent/pre-step` 的瀑布决策（只关心 enter 与消息批次） */
export interface PreStepDecision {
  kind?: string;
  messages?: unknown[];
}

/** 事件总线的最小面（cordis 的事件名是严格联合类型，这里按需窄化，避免 hard cast 到 any） */
interface DispatchHost {
  on(
    name: string,
    handler: (payload: PreStepPayload, next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>,
    options?: { prepend?: boolean },
  ): void;
  logger?: { warn?: (message: string) => void };
}

/** 从消息批次里抽出用户真正打的字（只看 user 角色的 text 块） */
function collectUserTexts(messages: readonly unknown[] | undefined): string[] {
  const out: string[] = [];
  for (const message of messages ?? []) {
    const m = message as { role?: string; content?: readonly unknown[] } | undefined;
    if (m?.role !== "user") continue;
    for (const block of m.content ?? []) {
      const b = block as { type?: string; text?: unknown } | undefined;
      if (b?.type === "text" && typeof b.text === "string") out.push(b.text);
    }
  }
  return out;
}

/**
 * 注册 `agent/pre-step` 监听：命中调度条件时，在本次 step 的消息批次末尾追加调度指令。
 *
 * 只在 turn 的第一个 step 注入 —— 已核实 dsh-agent-loop 每个 turn 把 `phase.step` 重置为 0、
 * turn 内自增，所以这天然是"一 turn 一条"，不依赖任何内存状态，宿主重启也不会重复。
 *
 * 整段 try/catch：注入失败只记一次日志、原样返回 decision，绝不阻断会话。
 */
export function registerDispatch(ctx: Context): void {
  const host = ctx as unknown as DispatchHost;
  let warned = false;
  const warnOnce = (message: string): void => {
    if (warned) return;
    warned = true;
    try {
      host.logger?.warn?.(message);
    } catch {
      // 日志服务不可用：这个保护只为不刷屏
    }
  };

  host.on(
    "agent/pre-step",
    async (payload, next) => {
      const decision = await next();
      try {
        if (decision?.kind !== "enter") return decision;
        if (payload?.step !== 1) return decision;
        if (!collectUserTexts(payload.messages).some(detectDispatch)) return decision;
        const message = buildDispatchMessage(payload.turn ?? 0);
        return { ...decision, messages: [...(decision.messages ?? []), message] };
      } catch (error) {
        warnOnce(
          `insar-genie: 关键词调度注入失败，已跳过：${String((error as Error)?.message ?? error)}`,
        );
        return decision;
      }
    },
    { prepend: true },
  );
}
