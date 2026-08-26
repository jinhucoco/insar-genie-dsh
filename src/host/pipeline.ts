import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { looksFromGridSize, getTemplate } from "./templates.js";
import { resolveCgDir } from "./paths.js";
import type { ConnectionGraphCheck, ExperimentParams, ParamsConsistencyCheck, TerrainType } from "../shared/types.js";

/** 由 gridSize 推导多视：有地形用模板值（地形优先），否则 looksFromGridSize 兑底（30m→8:2 / 15m→4:1）。 */
export function deriveLooks(gridSize: number, terrain?: string): { rgLooks: number; azLooks: number } {
  if (terrain) {
    const t = getTemplate(terrain as TerrainType);
    return { rgLooks: t.rgLooks, azLooks: t.azLooks };
  }
  return looksFromGridSize(gridSize);
}

/** 连接图校验：读 CG_report.txt 的孤立景数，≤4 通过。
 *  report 真实布局在 CG 目录下：<实验根>/CG_xxx_SBAS_processing/connection_graph/CG_report.txt
 *  （guard 脚本权威；旧布局 <实验根>/CG_report.txt 亦兼容，按存在性探测）。
 *  找不到报告 → passed=false + missingInfo=true（不静默通过，与参数一致性门同语义）。
 *  @param expDir 实验根目录（compDir 自动探测）
 *  @param experimentDir 可选：settings.experimentDir 显式实验数据根（优先） */
export function checkConnectionGraph(
  expDir: string,
  experimentDir?: string,
): ConnectionGraphCheck {
  const cgDir = resolveCgDir(expDir, experimentDir);
  // 候选 1：真实布局 CG 目录下的 connection_graph/
  const nested = join(cgDir, "connection_graph", "CG_report.txt");
  // 候选 2：CG 目录根下（旧布局/自定义输出）
  const root = join(cgDir, "CG_report.txt");
  const report = existsSync(nested) ? nested : existsSync(root) ? root : "";
  if (!report) {
    return {
      isolatedCount: 0,
      passed: false,
      missingInfo: true,
      message: `找不到 CG_report.txt（探测过 ${cgDir}/connection_graph/ 与 ${cgDir}/），无法校验连接图（需人工核）`,
    };
  }
  const text = readFileSync(report, "utf8");
  const m = /isolated\s+acquisitions?\s*[:=]\s*(\d+)/i.exec(text);
  const isolated = m ? Number(m[1]) : 0;
  return {
    isolatedCount: isolated,
    passed: isolated <= 4,
    missingInfo: false,
    message: isolated <= 4 ? `连接图 OK：${isolated} 景孤立` : `连接图不合格：${isolated} 景孤立（>4），需扩基线`,
  };
}

/** 运行期参数一致性校验：定位匹配模块的最新 PARAMETERS_INFO_*.xml，提取 key 与快照比对。
 *  @param workDir 工作目录（实验 tmp 下，含 PARAMETERS_INFO 落盘）
 *  @param params  确认快照（key 与落盘 XML 的 tag 对应，小写下划线）
 *  @param moduleKey 匹配模块名（如 'INTERFEROGRAM_GENERATION'）；可选，缺省扫全部
 *  @returns 缺证（找不到 XML / 全部 key 未核实）时 passed=false, missingInfo=true —— 不静默通过。 */
export function checkParamsConsistency(
  workDir: string,
  params: Partial<Record<string, unknown>>,
  moduleKey?: string,
): ParamsConsistencyCheck {
  const file = latestParamsInfo(workDir, moduleKey);
  if (!file) {
    return {
      mismatches: [],
      passed: false,
      message: "未找到匹配的 PARAMETERS_INFO_*.xml，无法校验参数一致性（需人工核）",
      missingInfo: true,
      unverified: Object.keys(params),
    };
  }
  const xml = readFileSync(file, "utf8");
  const mismatches: { key: string; expected: unknown; actual: unknown }[] = [];
  const unverified: string[] = [];
  for (const [key, expected] of Object.entries(params)) {
    const tag = key.toLowerCase();
    const m = new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`, "i").exec(xml);
    if (!m) {
      unverified.push(key); // 快照中但落盘未包含 —— 不判 mismatch，但记录
      continue;
    }
    const actual = m[1].trim();
    if (String(expected).toLowerCase() !== actual.toLowerCase()) {
      mismatches.push({ key, expected, actual });
    }
  }
  // 全部 key 都无法核实 → 视为证缺失（不静默通过）
  const totalKeys = Object.keys(params).length;
  const allUnverified = totalKeys > 0 && mismatches.length === 0 && unverified.length === totalKeys;
  return {
    mismatches,
    passed: mismatches.length === 0 && !allUnverified,
    message: mismatches.length > 0
      ? `参数不一致：${mismatches.map((x) => `${x.key} 期望${x.expected} 实际${x.actual}`).join("; ")}`
      : allUnverified
        ? `落盘 XML 无法核实任何确认参数（需人工核）：${unverified.join(", ")}`
        : `运行参数与确认快照一致${unverified.length > 0 ? `（${unverified.length} 项未核实：${unverified.join(", ")}）` : ""}`,
    missingInfo: allUnverified,
    unverified,
  };
}

/** 定位工作目录下匹配模块的最新（按文件名时间戳）PARAMETERS_INFO_*.xml。
 *  @param moduleKey 过滤模块名（含于文件名即可；如 'INTERFEROGRAM_GENERATION'）；可选 */
function latestParamsInfo(workDir: string, moduleKey?: string): string | null {
  if (!existsSync(workDir)) return null;
  let files = readdirSync(workDir).filter(
    (f) => f.toUpperCase().startsWith("PARAMETERS_INFO_") && f.toLowerCase().includes(".xml"),
  );
  if (moduleKey) {
    files = files.filter((f) => f.toUpperCase().includes(moduleKey.toUpperCase()));
  }
  if (files.length === 0) return null;
  // 按文件名时间戳（DDMonYYYY_HHMMSS）排序选最新，无法解析退化字典序
  files.sort((a, b) => {
    const ts = (s: string) => {
      const m = /_(\d+[A-Za-z]{3}\d+)_(\d+)/i.exec(s);
      return m ? Number(m[1].replace(/[^0-9]/g, "") + m[2]) : 0;
    };
    const d = ts(a) - ts(b);
    return d !== 0 ? d : a.localeCompare(b);
  });
  return join(workDir, files[files.length - 1]);
}

/** 五步确认卡：每卡 title + params[{field,label,defaultValue,recommended,reason,key}]。
 *  数据来源：设计文档 §4（字段名/GUI名/软件默认值/推荐值/理由）；推荐值按地形表 getTemplate(terrain)
 *  + deriveLooks(gridSize, terrain)。
 *  注意：value 用推荐值（recommended 是确认卡的默认回填值），defaultValue 是 SARscape 软件默认。 */
export interface PipelineCard {
  title: string;
  params: {
    field: string;
    label: string;
    defaultValue: string;
    recommended: string;
    reason: string;
    key: string;
  }[];
}

/** 由实验（地形 + 参数快照 + 推导多视）生成 5 张参数确认卡（B1：确认后跑）。 */
export function buildPipelineCards(exp: {
  terrain: TerrainType;
  params: ExperimentParams;
}): PipelineCard[] {
  const t = getTemplate(exp.terrain);
  const looks = deriveLooks(exp.params.gridSize, exp.terrain);
  const str = (v: string | number | boolean) => String(v);
  const rec = (v: string | number | boolean) => str(v);
  const def = (v: string | number | boolean) => str(v);

  // 卡① 连接图
  const cg = [
    { field: "MIN_PERC_BASELINE", label: "Min Normal Baseline (%)", defaultValue: def(0), recommended: rec(0), reason: "铁律下限" },
    { field: "MAX_PERC_BASELINE", label: "Max Normal Baseline (%)", defaultValue: def(2), recommended: rec(exp.params.maxPercBaseline ?? 2), reason: "铁律；SARscape 对 Sentinel-1 默认 2%，不足自动扩 4%" },
    { field: "MIN_TIME_BASELINE", label: "Min Temporal Baseline (days)", defaultValue: def(0), recommended: rec(0), reason: "" },
    { field: "MAX_TIME_BASELINE", label: "Max Temporal Baseline (days)", defaultValue: def(180), recommended: rec(exp.params.maxTimeBaselineDays), reason: "常规 SBAS 时间基线" },
    { field: "DEGREE_OF_REDUNDANCY", label: "Degree of Redundancy", defaultValue: "low", recommended: "high", reason: "高冗余更稳（可放宽连接率）" },
    { field: "MAX_LINK_NR_PER_IMAGE", label: "Max Connections per Acquisition", defaultValue: def(8), recommended: "10", reason: "低相干区提高连通" },
    { field: "ALLOW_DISCONNECTED_BLOCKS", label: "Allow Disconnected Blocks", defaultValue: "NotOK", recommended: "NotOK", reason: "保整体连续" },
    { field: "SUPER_REFERENCE", label: "Input Super Reference（中央超参考）", defaultValue: "auto", recommended: rec(exp.params.superReference || "(未设：用内置民勤超参考兑底)"), reason: "换新研究区必改；写完整 msc_slc_list 路径" },
  ];

  // 卡② 干涉+解缠
  const interf = [
    { field: "GRID_SIZE_FOR_SUGGESTED_LOOKS", label: "Grid Size for Suggested Looks (m)", defaultValue: def(15), recommended: rec(exp.params.gridSize), reason: "主导参数：多视由此推导（>800km²→30m，<800km²→15m）" },
    { field: "RG_LOOKS_NBR", label: "Range Looks", defaultValue: def(4), recommended: rec(looks.rgLooks), reason: `由 Grid Size 推导（${exp.params.gridSize}m→${looks.rgLooks}:${looks.azLooks}），展示给用户确认` },
    { field: "AZ_LOOKS_NBR", label: "Azimuth Looks", defaultValue: def(1), recommended: rec(looks.azLooks), reason: `与 RG 配套（${exp.params.gridSize}m→${looks.rgLooks}:${looks.azLooks}）` },
    { field: "LAYOVER_SHADOW_MASK", label: "Apply Layover and Shadow Mask", defaultValue: "OK", recommended: "OK", reason: "山地必开" },
    { field: "FILTERING_METHOD", label: "Filtering Method", defaultValue: "GOLDSTEIN", recommended: rec(exp.params.filtering), reason: "通用；低相干加大 alpha/窗口" },
    { field: "GOLDSTEIN_WINSIZE", label: "Goldstein Win Size", defaultValue: def(64), recommended: rec(exp.params.goldsteinWinSize), reason: "窗口适中" },
    { field: "UPHA_METHOD_TYPE", label: "Unwrapping Method Type", defaultValue: "MCF_DELAUNAY", recommended: rec(exp.params.unwrappingMethod), reason: "按地形表：植被/复杂区 Delaunay MCF，城市 MCF" },
    { field: "UPHA_COH_THRESHOLD", label: "Unwrapping Coherence Threshold", defaultValue: def(0.3), recommended: rec(exp.params.unwrapCohThreshold), reason: "按地形表相干阈值（高相干 0.3，低相干 0.15-0.2）" },
    { field: "EXTERNAL_SENSOR", label: "Atmosphere External Sensors", defaultValue: "—", recommended: exp.params.useGacos ? "GACOS" : "—", reason: "时相齐必选 GACOS" },
  ];

  // 卡③ 反演1
  const inv1 = [
    { field: "DISPLACEMENT_MODEL_TYPE", label: "Displacement Model Type", defaultValue: "linear", recommended: rec(exp.params.displacementModel), reason: "按地形表：linear 默认；矿区/滑坡 quadratic；冻土 periodic" },
    { field: "ESTIMATE_RESIDUAL_HEIGHT", label: "Estimate Residual Height", defaultValue: "OK", recommended: "OK", reason: "残余高程估计" },
    { field: "PRODUCT_COHERENCE_THRESHOLD", label: "Product Coherence Threshold", defaultValue: def(0.3), recommended: rec(exp.params.coherenceThreshold), reason: "按地形表相干阈值" },
    { field: "MIN_VALID_INTERF_PERC", label: "Min Valid Interferograms %", defaultValue: def(65), recommended: rec(exp.params.minValidInterfPercent), reason: "" },
    { field: "RADIUS", label: "Refinement Radius (m)", defaultValue: def(22.5), recommended: rec(exp.params.radius), reason: "精炼半径" },
  ];

  // 卡④ 反演2
  const inv2 = [
    { field: "DISPLACEMENT_MODEL_TYPE", label: "Displacement Model Type", defaultValue: "same_as_first", recommended: "same_as_first", reason: "" },
    { field: "MIN_VALID_INTERF_PERC", label: "Min Valid Interferograms %", defaultValue: def(65), recommended: rec(exp.params.minValidInterfPercent), reason: "" },
    { field: "MIN_VALID_IMAGE_PERC", label: "Min Valid Acquisitions %", defaultValue: def(90), recommended: rec(exp.params.minValidImagePercent), reason: "" },
    { field: "PRODUCT_COHERENCE_THRESHOLD", label: "Product Coherence Threshold", defaultValue: def(0.3), recommended: rec(exp.params.coherenceThreshold), reason: "" },
    { field: "ATMOSPHERE_LP_METERS", label: "Atmosphere Low Pass Size (m)", defaultValue: def(1600), recommended: rec(exp.params.atmosphereLpMeters), reason: "去大气低通" },
    { field: "ATMOSPHERE_HP_DAYS", label: "Atmosphere High Pass Size (days)", defaultValue: def(365), recommended: rec(exp.params.atmosphereHpDays), reason: "" },
    { field: "RADIUS", label: "Refinement Radius (m)", defaultValue: def(22.5), recommended: rec(exp.params.radius), reason: "精炼半径" },
  ];

  // 卡⑤ 地理编码（输出网格与多视匹配）
  const gridded = looks.rgLooks >= 8 || looks.azLooks >= 2 ? 30 : 15;
  const geocode = [
    { field: "GEOCODE_RG_GRID_SIZE", label: "X Dimension (m)", defaultValue: def(15), recommended: rec(exp.params.geocodeGridSize || gridded), reason: `与多视匹配（${looks.rgLooks}:${looks.azLooks}→${gridded}m）` },
    { field: "GEOCODE_AZ_GRID_SIZE", label: "Y Dimension (m)", defaultValue: def(15), recommended: rec(exp.params.geocodeGridSize || gridded), reason: `与多视匹配（${looks.rgLooks}:${looks.azLooks}→${gridded}m）` },
    { field: "COHERENCE_THR", label: "Product Temporal Coherence Threshold", defaultValue: def(0.1), recommended: def(0.1), reason: "" },
    { field: "GENERATE_RASTER", label: "Make Geocoded Raster", defaultValue: "OK", recommended: "OK", reason: "" },
    { field: "GENERATE_SHAPE", label: "Make Geocoded Shape", defaultValue: "OK", recommended: "OK", reason: "" },
  ];

  // 每张卡的 params 注入 key（= field，供 client 编辑时定位唯一参数）。
  const withKey = (arr: { field: string; label: string; defaultValue: string; recommended: string; reason: string }[]) =>
    arr.map((p) => ({ ...p, key: p.field }));

  return [
    { title: "① Connection Graph（连接图）", params: withKey(cg) },
    { title: "② Interferogram & Unwrapping（干涉+解缠）", params: withKey(interf) },
    { title: "③ Inversion Step 1（反演1）", params: withKey(inv1) },
    { title: "④ Inversion Step 2（反演2）", params: withKey(inv2) },
    { title: "⑤ Geocoding（地理编码）", params: withKey(geocode) },
  ];
}

/** 生成参数快照（由用户确认的 ExperimentParams → 与落盘 XML key 对齐的映射）。 */
export function buildParamsSnapshot(p: ExperimentParams): Record<string, unknown> {
  return {
    max_perc_baseline: p.maxPercBaseline,
    rg_looks_nbr: p.rgLooks,
    az_looks_nbr: p.azLooks,
    up_coh_threshold: p.unwrapCohThreshold,
    product_coherence_thresh: p.coherenceThreshold,
    displacement_model_type: p.displacementModel,
  };
}
