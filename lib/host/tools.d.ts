import { createRegistry } from "./registry.js";
import type { Experiment } from "../shared/types.js";
/** settings 的值对象形状（与 SettingsSchema resolve 后的字段对齐，避免 schemastery 携带类型） */
export interface SettingsValue {
    earthdataUser: string;
    earthdataPassword: string;
    gacosEmail: string;
    gacosImapAuthCode: string;
    enviIdl: string;
    sarscapeLib: string;
    workDir: string;
    poeorbDir: string;
    /** B3：实验数据根（非空时替代注册的 exp.dir 作为 RESULT_ROOT/TMP_DIR 家） */
    experimentDir?: string;
    /** 脚本根（解耦）：五步 bat 树 + config.env 的家；空 = 插件内置 assets/experiment */
    scriptsDir?: string;
}
/** 编排执行单步：runStep(exp, step, overrides)。overrides 可覆盖基线等，便于测试断言分派。 */
export type RunStep = (exp: Experiment, step: string, overrides?: Record<string, unknown>) => Promise<{
    ok: boolean;
    step: string;
    [k: string]: unknown;
}>;
/** 各步 → PARAMETERS_INFO_<MODULE>_CMD_*.xml 的模块匹配段（latestParamsInfo 用 includes(moduleKey)）。 */
export declare const STEP_MODULE_KEY: Record<string, string>;
/**
 * 注册三个工具到 host tools 注册表。
 * 依赖：ctx.tools（host 工具运行时）、registry。
 */
export declare function registerTools(ctx: any, deps: {
    registry: ReturnType<typeof createRegistry>;
    settings?: {
        get(): SettingsValue | undefined;
    };
    /** 编排运行单步的回调（测试可注入 mock；缺省真实跑 bat）。 */
    runStep?: RunStep;
}): void;
/**
 * 定位 guard 日志（sbas_guard.log）。
 * 真实布局：日志可能在 workDir/asf_experiment，与实验目录分离（如实验在 G:\，日志在 D:\work\data\asf_experiment）。
 * 优先级：
 *  1. 实验记录的 guardDir（注册/设置时显式指定——最可靠）
 *  2. 探测候选路径（实验目录 / 父级 / DSH_HOME 下的 asf_experiment）
 * 都不存在返回空串（调用方 readFileSafe 兜底）。
 */
export declare function resolveGuardLog(exp: Experiment): string;
