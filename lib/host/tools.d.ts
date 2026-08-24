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
}
/**
 * 注册三个工具到 host tools 注册表。
 * 依赖：ctx.tools（host 工具运行时）、registry。
 */
export declare function registerTools(ctx: any, deps: {
    registry: ReturnType<typeof createRegistry>;
    settings?: {
        get(): SettingsValue | undefined;
    };
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
