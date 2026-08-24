import type { ConnectionGraphCheck, ExperimentParams, ParamsConsistencyCheck } from "../shared/types.js";
/** 由 gridSize 推导多视：有地形用模板值（地形优先），否则 looksFromGridSize 兑底（30m→8:2 / 15m→4:1）。 */
export declare function deriveLooks(gridSize: number, terrain?: string): {
    rgLooks: number;
    azLooks: number;
};
/** 连接图校验：读 CG_report.txt 的孤立景数，≤4 通过。 */
export declare function checkConnectionGraph(workDir: string): ConnectionGraphCheck;
/** 运行期参数一致性校验：定位匹配模块的最新 PARAMETERS_INFO_*.xml，提取 key 与快照比对。
 *  @param workDir 工作目录（实验 tmp 下，含 PARAMETERS_INFO 落盘）
 *  @param params  确认快照（key 与落盘 XML 的 tag 对应，小写下划线）
 *  @param moduleKey 匹配模块名（如 'INTERFEROGRAM_GENERATION'）；可选，缺省扫全部
 *  @returns 缺证（找不到 XML / 全部 key 未核实）时 passed=false, missingInfo=true —— 不静默通过。 */
export declare function checkParamsConsistency(workDir: string, params: Partial<Record<string, unknown>>, moduleKey?: string): ParamsConsistencyCheck;
/** 生成参数快照（由用户确认的 ExperimentParams → 与落盘 XML key 对齐的映射）。 */
export declare function buildParamsSnapshot(p: ExperimentParams): Record<string, unknown>;
