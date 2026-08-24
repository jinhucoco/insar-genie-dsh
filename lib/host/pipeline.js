import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { looksFromGridSize, getTemplate } from "./templates.js";
/** 由 gridSize 推导多视：有地形用模板值（地形优先），否则 looksFromGridSize 兑底（30m→8:2 / 15m→4:1）。 */
export function deriveLooks(gridSize, terrain) {
    if (terrain) {
        const t = getTemplate(terrain);
        return { rgLooks: t.rgLooks, azLooks: t.azLooks };
    }
    return looksFromGridSize(gridSize);
}
/** 连接图校验：读 CG_report.txt 的孤立景数，≤4 通过。 */
export function checkConnectionGraph(workDir) {
    const report = join(workDir, "CG_report.txt");
    let text = "";
    if (existsSync(report))
        text = readFileSync(report, "utf8");
    const m = /isolated\s+acquisitions?\s*[:=]\s*(\d+)/i.exec(text);
    const isolated = m ? Number(m[1]) : 0;
    return {
        isolatedCount: isolated,
        passed: isolated <= 4,
        message: isolated <= 4 ? `连接图 OK：${isolated} 景孤立` : `连接图不合格：${isolated} 景孤立（>4），需扩基线`,
    };
}
/** 运行期参数一致性校验：定位匹配模块的最新 PARAMETERS_INFO_*.xml，提取 key 与快照比对。
 *  @param workDir 工作目录（实验 tmp 下，含 PARAMETERS_INFO 落盘）
 *  @param params  确认快照（key 与落盘 XML 的 tag 对应，小写下划线）
 *  @param moduleKey 匹配模块名（如 'INTERFEROGRAM_GENERATION'）；可选，缺省扫全部
 *  @returns 缺证（找不到 XML / 全部 key 未核实）时 passed=false, missingInfo=true —— 不静默通过。 */
export function checkParamsConsistency(workDir, params, moduleKey) {
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
    const mismatches = [];
    const unverified = [];
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
function latestParamsInfo(workDir, moduleKey) {
    if (!existsSync(workDir))
        return null;
    let files = readdirSync(workDir).filter((f) => f.toUpperCase().startsWith("PARAMETERS_INFO_") && f.toLowerCase().includes(".xml"));
    if (moduleKey) {
        files = files.filter((f) => f.toUpperCase().includes(moduleKey.toUpperCase()));
    }
    if (files.length === 0)
        return null;
    // 按文件名时间戳（DDMonYYYY_HHMMSS）排序选最新，无法解析退化字典序
    files.sort((a, b) => {
        const ts = (s) => {
            const m = /_(\d+[A-Za-z]{3}\d+)_(\d+)/i.exec(s);
            return m ? Number(m[1].replace(/[^0-9]/g, "") + m[2]) : 0;
        };
        const d = ts(a) - ts(b);
        return d !== 0 ? d : a.localeCompare(b);
    });
    return join(workDir, files[files.length - 1]);
}
/** 生成参数快照（由用户确认的 ExperimentParams → 与落盘 XML key 对齐的映射）。 */
export function buildParamsSnapshot(p) {
    return {
        max_perc_baseline: p.maxPercBaseline,
        rg_looks_nbr: p.rgLooks,
        az_looks_nbr: p.azLooks,
        up_coh_threshold: p.unwrapCohThreshold,
        product_coherence_thresh: p.coherenceThreshold,
        displacement_model_type: p.displacementModel,
    };
}
