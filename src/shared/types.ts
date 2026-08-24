/** 实验生命周期状态 */
export type ExperimentLifecycle =
  | "draft" | "queued" | "running" | "paused" | "failed" | "done";

/** SBAS 五步（对应 auxiliary.sml 的 OK/NotOK 标记） */
export const SBAS_STEPS = [
  "generate_connection_graph",
  "interf_stack",
  "unwrapping",
  "first_inversion",
  "second_inversion",
  "geocode_result",
] as const;
export type SbasStep = (typeof SBAS_STEPS)[number];

/** 一个实验的完整记录 */
export interface Experiment {
  id: string;                      // uuid，如 "20260822-1530"
  name: string;                    // 用户给的名字，如 "民勤_minqin"
  terrain: TerrainType;            // 地形类型
  dir: string;                     // 实验根目录（G:\xxx）
  dataDirs: {
    slc: string;
    poeorb: string;                // 精密轨道目录
    gacos: string;
    dem: string;
  };
  guardDir?: string;               // 守护日志所在目录（默认 <实验目录>/asf_experiment；
                                   // 真实布局可能分离，如日志在 workDir/asf_experiment）
  params: ExperimentParams;        // 参数快照（确认卡确认后的最终值）
  status: ExperimentLifecycle;
  startedAt?: string;              // ISO 时间
  error?: { code: string; detail: string; evidence: string };
}

/** 地形类型（模板库键） */
export type TerrainType =
  | "mining" | "landslide" | "urban" | "desert" | "loess";

/** 参数快照（防呆：空间基线必须是 2-4%） */
export interface ExperimentParams {
  rgLooks: number;                 // 多视 RG（由 GridSize 推导）
  azLooks: number;                 // 多视 AZ
  gridSize: number;                // 建议网格大小 15/30m（主导参数，多视由此推导）
  maxTimeBaselineDays: number;     // 180
  maxPercBaseline: number;         // 2 或 4 —— 防呆校验区间
  filtering: "GOLDSTEIN";
  goldsteinWinSize: number;        // 64
  unwrappingMethod: "MCF" | "MCF_DELAUNAY";
  unwrapCohThreshold: number;      // 0.2
  displacementModel: "linear" | "quadratic" | "periodic";
  coherenceThreshold: number;      // 产品相干阈值
  minValidInterfPercent: number;   // 最小有效干涉 %
  minValidImagePercent: number;    // 最小有效影像 %（反演2）
  atmosphereLpMeters: number;      // 去大气低通
  atmosphereHpDays: number;        // 去大气高通
  radius: number;                  // 精炼半径
  refinePolyDegree: number;        // 精炼残差多项式阶
  geocodeGridSize: number;         // 地理编码网格（与多视匹配）
  useGacos: boolean;
  demFile: string;
}

/** 连接图校验结果 */
export interface ConnectionGraphCheck {
  isolatedCount: number;           // 孤立景数
  passed: boolean;                 // isolatedCount <= 4
  message: string;
}

/** 运行期参数一致性校验结果 */
export interface ParamsConsistencyCheck {
  mismatches: { key: string; expected: unknown; actual: unknown }[];
  passed: boolean;                 // 无 mismatch
  message: string;
}


/** insar_status 返回的进度快照 */
export interface ExperimentStatus {
  step: SbasStep;                  // 当前步骤
  stepIndex: number;               // 0-5
  totalSteps: number;              // 6
  donePairs: number;               // 干涉图：已完成对
  totalPairs: number;              // 干涉图：总对
  pairsPerMinute: number;          // 速率
  etaMinutes: number;              // 剩余时间
  diskGb: number;                  // 数据盘占用
  progressLabel: string;           // "干涉图生成 79%"
  isStalled: boolean;
  error?: { code: string; detail: string; evidence: string };
}
