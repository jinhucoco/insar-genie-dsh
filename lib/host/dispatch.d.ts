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
export declare const PLUGIN_ID = "insar-genie-dsh";
/** 注入消息的 `source.form`：语义是「模型应当遵循的指令」，对齐 dsh-llm 的 ContextForm */
export declare const DISPATCH_FORM: "instructions";
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
export declare const FUNCTIONS: readonly InsarFunctionItem[];
/**
 * 判定这条用户消息是否需要弹功能菜单。
 *
 * 取向是**保守**：宁可多注入一条（指令文本自带"已给出明确任务则忽略本条"兜底），
 * 也不漏掉裸关键词——漏掉才是这个功能的失败模式。
 *
 * @param text - 用户消息的纯文本（只看 text 块，不看附件与工具结果）
 * @returns true = 只说到了领域关键词、没给出明确任务 → 需要注入调度指令
 */
export declare function detectDispatch(text: string): boolean;
/** 渲染菜单文本（编号 + 短名 + 说明），宿主注入与 SKILL.md 表同源 */
export declare function renderMenu(): string;
/** 调度指令正文：告诉模型"这一轮只出菜单" */
export declare function buildDispatchText(): string;
/**
 * 注入消息（与 dsh-llm 的 UserMessage 同构；本插件不依赖该包，故本地声明形状）。
 * id 全局唯一，保证同一 turn 即使被重跑也只是多一条幂等提示，不会撞 id 破坏历史回放。
 */
export interface InjectedMessage {
    readonly id: string;
    readonly role: "user";
    readonly content: readonly {
        readonly type: "text";
        readonly text: string;
    }[];
    readonly source: {
        readonly kind: "plugin";
        readonly plugin: string;
        readonly form: typeof DISPATCH_FORM;
    };
}
/** 构造一条调度指令注入消息 */
export declare function buildDispatchMessage(turn: number): InjectedMessage;
/** `agent/pre-step` 载荷（本插件不依赖 @deepseek-ai/dsh-agent，只窄化用到的字段） */
export interface PreStepPayload {
    agent?: {
        session?: {
            id?: string;
        };
    };
    messages?: readonly unknown[];
    turn?: number;
    step?: number;
}
/** `agent/pre-step` 的瀑布决策（只关心 enter 与消息批次） */
export interface PreStepDecision {
    kind?: string;
    messages?: unknown[];
}
/**
 * 注册 `agent/pre-step` 监听：命中调度条件时，在本次 step 的消息批次末尾追加调度指令。
 *
 * 只在 turn 的第一个 step 注入 —— 已核实 dsh-agent-loop 每个 turn 把 `phase.step` 重置为 0、
 * turn 内自增，所以这天然是"一 turn 一条"，不依赖任何内存状态，宿主重启也不会重复。
 *
 * 整段 try/catch：注入失败只记一次日志、原样返回 decision，绝不阻断会话。
 */
export declare function registerDispatch(ctx: Context): void;
