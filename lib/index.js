import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createRegistry } from "./host/registry.js";
import { registerDispatch } from "./host/dispatch.js";
import { registerTools } from "./host/tools.js";
import { registerSettings, SETTINGS_NS } from "./host/settings.js";
import { resolveAssetsDir } from "./host/paths.js";
export * from "./shared/types.js";
export { computeStatus } from "./host/status.js";
export { getTemplate, validateBaseline } from "./host/templates.js";
export const name = "insar-genie-dsh";
/** 声明本插件注入的服务：registerTools 用 ctx.tools，registerSettings 用 ctx.settings，
 *  registerSkill 用 ctx.skills。缺省该数组时 Cordis 判定 `cannot get property without inject`。 */
export const inject = ["tools", "settings", "skills"];
/** 实验注册表存储目录（可通过设置覆盖） */
export const REGISTRY_DIR = () => process.env.DSH_HOME
    ? join(process.env.DSH_HOME, "insar-genie")
    : join(process.cwd(), ".insar-genie");
/** 注册 insar-genie skill：插件自带的 AI 全流程工作流知识（assets/SKILL.md）。
 *  resourceBase 指向插件 assets 根 —— AI 加载 skill 后据此定位内置 scripts/ + experiment/。
 *  这让插件开箱即用：装插件 → 普通会话加载 insar-genie skill 即可全流程跑 SBAS，无需 agent preset。
 *  （单独导出以便测试 —— 不依赖 ctx.settings/tools 等其它服务。） */
export function registerSkill(ctx) {
    const assetsDir = resolveAssetsDir();
    const skillPath = join(assetsDir, "SKILL.md");
    let content;
    try {
        content = readFileSync(skillPath, "utf8");
    }
    catch {
        // 内置 skill 缺失不阻断插件加载（工具/UI 仍可用），仅提示
        return;
    }
    ctx.skills.register({
        name: "insar-genie",
        source: "runtime",
        description: "SBAS-InSAR 全链路 AI 技能：从 Sentinel-1 SLC 数据下载、配套数据（DEM/GACOS/POEORB）获取，到 SARscape 实验参数确认与批处理执行，再到守护监控，全程 AI 与用户对话交互、AI 自动执行。只要用户提到 insar、SBAS、实验、哨兵、Sentinel-1、干涉、形变、沉降、SARscape、GACOS、POEORB、DEM 等领域关键词就会触发；用户没给出明确任务时，先列插件功能菜单问用户想做哪一件（下载SLC主数据/下载配套数据/SLC批量导入/参数确认+跑SBAS全流程/单步执行/查实验进展/环境自检与账号配置/DEM预处理）。",
        whenToUse: "用户提到 insar / SBAS / 实验 / 哨兵 / Sentinel-1 / 干涉 / 形变 / 沉降 / SARscape / GACOS / POEORB / DEM 等领域关键词（哪怕只是一个裸关键词），或要从 ASF 下载 Sentinel-1 SLC、开展 SBAS-InSAR 实验（下载→配套数据→参数确认→批处理→监控）、批量导入 SLC、查实验进展、配置环境与账号、预处理 DEM。",
        content,
        resourceBase: { kind: "directory", path: assetsDir },
    });
}
export function apply(ctx) {
    const registry = createRegistry(REGISTRY_DIR());
    registerSettings(ctx);
    const readSettings = () => ctx.settings?.get(SETTINGS_NS);
    registerTools(ctx, { registry, settings: { get: readSettings } });
    registerSkill(ctx);
    // 关键词调度：裸关键词（insar/SBAS/实验…）+ 无明确任务 → 注入功能菜单指令
    registerDispatch(ctx);
    // 注：cordis 4.0.1 的 Events 键不含 'dispose'，按简报意图保留空 disposer 占位，用 as any 适配
    ctx.on("dispose", () => { });
}
