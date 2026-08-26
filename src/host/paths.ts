import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

/**
 * 插件内置脚本路径定位（开箱即用核心）。
 *
 * 插件把完整 SBAS 执行链打包在 `assets/scripts`（下载/配套数据工具）和
 * `assets/experiment`（SARscape 五步 batch + guard）。本模块按插件安装根解析这些
 * 路径，使 `insar_run` / `insar_status` 等工具无需用户传 `scriptDir` 即可找到脚本。
 *
 * 解析链：
 * 1. 环境变量显式覆盖（INSAR_GENIE_SCRIPTS / INSAR_GENIE_EXPERIMENT）——用户自定义安装位置
 * 2. 插件包根下的 assets（默认，随包走）
 *
 * 注：宿主进程为 ESM（type:module），用 import.meta.url 定位本文件 → 上推到包根
 * （lib/host/paths.js 的 ../../ = 插件包根），assets 就在包根下。
 */

/** 当前模块所在目录（lib/host），上推两级到插件包根 */
function pluginRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // here = <pkg>/lib/host → 上两级 = <pkg>
  return join(here, "..", "..");
}

/** 解析 scripts 目录（下载/配套数据工具）。
 *  显式 override 或环境变量直接返回（路径存在性由调用方决定，作为 cwd 透传）；
 *  否则回退插件包根 assets/scripts（随包走，开箱即用）。 */
export function resolveScriptsDir(override?: string): string {
  if (override) return override;
  if (process.env.INSAR_GENIE_SCRIPTS) return process.env.INSAR_GENIE_SCRIPTS;
  return join(pluginRoot(), "assets", "scripts");
}

/** 解析 experiment 目录（SARscape 五步 batch + guard） */
export function resolveExperimentDir(override?: string): string {
  if (override) return override;
  if (process.env.INSAR_GENIE_EXPERIMENT) return process.env.INSAR_GENIE_EXPERIMENT;
  return join(pluginRoot(), "assets", "experiment");
}

/** 是否插件内置目录存在脚本（供工具在缺省时兜底报错提示） */
export function hasBundledScripts(): boolean {
  return existsSync(join(pluginRoot(), "assets", "scripts", "multi_download.py"));
}

/** 解析插件 assets 根（skill 的 resourceBase：SKILL.md 与 scripts/ experiment/ 并列于此）。 */
export function resolveAssetsDir(): string {
  return join(pluginRoot(), "assets");
}

/**
 * 探测实验的 SARscape 结果根（CG 目录的家，guard 用 <RESULT_ROOT>/<CG_DIR_NAME>）。
 *
 * 真实布局（guard 脚本权威）：SARscape 输出在 `<数据根>/CG_xxx_SBAS_processing/` 下——
 * `auxiliary.sml`、`connection_graph/CG_report.txt`、`work/work_interferogram_stacking/`
 * 都在这个 CG 目录里，不在数据根本身。
 *
 * 解析链（与 settings.experimentDir 优先的 B3 解耦一致）：
 *  1. 数据根 = settings.experimentDir（用户显式设的实验结果存放目录——最可靠）或 exp.dir
 *  2. 数据根下的一级 `CG_*_SBAS_processing` 目录（真实布局）
 *  3. 数据根下任意一级 `CG_*` 目录（旧/自定义命名兜底）
 *  4. 全无 → 回退数据根本身（调用方读文件失败自行兜底）
 */
export function resolveCgDir(expDir: string, experimentDir?: string): string {
  const dataRoot = experimentDir && experimentDir.trim() ? experimentDir : expDir;
  let entries: string[] = [];
  try {
    entries = readdirSync(dataRoot);
  } catch {
    return dataRoot;
  }
  // 真实命名偏好：CG_<name>_SBAS_processing
  const sbas = entries.filter((e) => /^CG_.*_SBAS_processing$/i.test(e));
  if (sbas.length > 0) return join(dataRoot, sbas[0]);
  // 兜底：任意 CG_* 开头的目录
  const anyCg = entries.filter((e) => /^CG_/i.test(e) && isDirectory(join(dataRoot, e)));
  if (anyCg.length > 0) return join(dataRoot, anyCg[0]);
  return dataRoot;
}

/** 目录判断（statSync 安全包装，不存在/非目录返回 false） */
function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
