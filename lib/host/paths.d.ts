/** 解析 scripts 目录（下载/配套数据工具）。
 *  显式 override 或环境变量直接返回（路径存在性由调用方决定，作为 cwd 透传）；
 *  否则回退插件包根 assets/scripts（随包走，开箱即用）。 */
export declare function resolveScriptsDir(override?: string): string;
/** 解析 experiment 目录（SARscape 五步 batch + guard） */
export declare function resolveExperimentDir(override?: string): string;
/** 是否插件内置目录存在脚本（供工具在缺省时兜底报错提示） */
export declare function hasBundledScripts(): boolean;
/** 解析插件 assets 根（skill 的 resourceBase：SKILL.md 与 scripts/ experiment/ 并列于此）。 */
export declare function resolveAssetsDir(): string;
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
export declare function resolveCgDir(expDir: string, experimentDir?: string): string;
