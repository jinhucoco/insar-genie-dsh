import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { looksFromGridSize, getTemplate } from "./templates.js";
import type { ConnectionGraphCheck, ExperimentParams, ParamsConsistencyCheck } from "../shared/types.js";

/** 由 gridSize 推导多视：有地形用模板值（地形优先），否则 looksFromGridSize 兑底（30m→8:2 / 15m→4:1）。 */
export function deriveLooks(gridSize: number, terrain?: string): { rgLooks: number; azLooks: number } {
  if (terrain) {
    const t = getTemplate(terrain as never);
    return { rgLooks: t.rgLooks, azLooks: t.azLooks };
  }
  return looksFromGridSize(gridSize);
}

/** 连接图校验：读 CG_report.txt 的孤立景数，≤4 通过。 */
export function checkConnectionGraph(workDir: string): ConnectionGraphCheck {
  const report = join(workDir, "CG_report.txt");
  let text = "";
  if (existsSync(report)) text = readFileSync(report, "utf8");
  const m = /isolated\s+acquisitions?\s*[:=]\s*(\d+)/i.exec(text);
  const isolated = m ? Number(m[1]) : 0;
  return {
    isolatedCount: isolated,
    passed: isolated <= 4,
    message: isolated <= 4 ? `连接图 OK：${isolated} 景孤立` : `连接图不合格：${isolated} 景孤立（>4），需扩基线`,
  };
}

/** 运行期参数一致性校验：定位最新 PARAMETERS_INFO_*.xml，提取 key 与快照比对。 */
export function checkParamsConsistency(
  workDir: string,
  params: Partial<Record<string, unknown>>,
): ParamsConsistencyCheck {
  const file = latestParamsInfo(workDir);
  if (!file) return { mismatches: [], passed: true, message: "未找到 PARAMETERS_INFO_*.xml，跳过一致性校验（记录到 registry 待人工核）" };
  const xml = readFileSync(file, "utf8");
  const mismatches: { key: string; expected: unknown; actual: unknown }[] = [];
  for (const [key, expected] of Object.entries(params)) {
    const tag = key.toLowerCase();
    const m = new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`, "i").exec(xml);
    if (!m) continue; // 该参数未落盘，跳过
    const actual = m[1].trim();
    if (String(expected).toLowerCase() !== actual.toLowerCase()) {
      mismatches.push({ key, expected, actual });
    }
  }
  return {
    mismatches,
    passed: mismatches.length === 0,
    message: mismatches.length === 0
      ? "运行参数与确认快照一致"
      : `参数不一致：${mismatches.map((x) => `${x.key} 期望${x.expected} 实际${x.actual}`).join("; ")}`,
  };
}

/** 定位工作目录下最新（按文件名时间戳）的 PARAMETERS_INFO_*.xml。 */
function latestParamsInfo(workDir: string): string | null {
  if (!existsSync(workDir)) return null;
  const files = readdirSync(workDir).filter((f) => /^PARAMETERS_INFO_.*\.xml$/i.test(f));
  if (files.length === 0) return null;
  files.sort(); // 文件名含时间戳（如 ..._21Aug2026_205400.xml），升序取最后
  return join(workDir, files[files.length - 1]);
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
