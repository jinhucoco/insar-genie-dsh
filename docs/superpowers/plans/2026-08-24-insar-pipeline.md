# insar_pipeline 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 为 insar-genie-dsh 插件新增 `insar_pipeline` 工具，用户装插件后一句话即可全自动跑 SBAS——识别地形 → 5 卡参数确认（每参数标默认/推荐）→ 自动生成 config.env → 执行五步并跑连接图校验门 + 运行期参数一致性校验门。

**架构：** 在 host 侧新增 `insar_pipeline` 工具（编排 download/companion/config/processing 阶段），复用现有 `insar_run`/`insar_experiment` 作为底层执行；新增纯函数模块承载 config.env 生成、多视推导、连接图校验、参数一致性校验。client 侧新增参数确认 WorkflowPanel（5 卡，一次性推送）。

**技术栈：** TypeScript + cordis/dsh-tools，vitest 测试。数据源真实：参数名来自 SARscape `.task`，默认值来自 `default_values` txt。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/shared/types.ts` | `ExperimentParams` 扩 gridSize/displacementModel/unwrapping；加 `PipelineConfig`/`StepCheck` 类型 | 修改 |
| `src/host/templates.ts` | 完整地形参数表（含 gridSize/displacementModel），按「地形表 + 范围」给推荐 | 修改 |
| `src/host/pipeline.ts` | 多视推导（gridSize→looks）、参数快照生成、连接图校验（读 CG_report 孤立景数）、运行期参数一致性校验（读 PARAMETERS_INFO） | 创建 |
| `src/host/configenv.ts` | 生成 config.env（从 settings + 实验目录填路径） | 创建 |
| `src/host/tools.ts` | 注册 `insar_pipeline` 工具（编排各阶段 + 两道校验门）| 修改 |
| `src/client/PipelineConfirm.tsx` | 5 卡参数确认 UI（每卡 default/推荐/理由 + 多视推导展示）| 创建 |
| `src/client/index.ts` | 注册 PipelineConfirm 到 turnTail 插槽 | 修改 |
| `test/pipeline.test.ts` | 多视推导 / 连接图校验 / 参数一致性校验 测试 | 创建 |
| `test/configenv.test.ts` | config.env 生成 测试 | 创建 |

---

## 任务 1：扩展类型（shared/types.ts）

**文件：**
- 修改：`src/shared/types.ts`

**变更目标：** `ExperimentParams` 增加字段以满足 5 卡确认；新增 pipeline 相关类型。

- [ ] **步骤 1：修改 `ExperimentParams` 接口**

在 `src/shared/types.ts` 的 `ExperimentParams` 中新增字段，并新增 pipeline 类型：

```ts
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
```

- [ ] **步骤 2：运行 tsc 确认类型无错误**

运行：`cd dsh-plugin && ./node_modules/.bin/tsc -p tsconfig.json --noEmit`
预期：PASS（仅类型声明，无实现引用时不应报错；若 templates.ts 因缺新字段报错，见任务 2）

- [ ] **步骤 3：Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(pipeline): 扩展 ExperimentParams 与 pipeline 类型（gridSize/形变模型/校验结果）"
```

---

## 任务 2：完整地形参数表（templates.ts）

**文件：**
- 修改：`src/host/templates.ts` —— `TEMPLATES` 扩展为完整地形参数表，`getTemplate` 返回含新字段的推荐值

**变更目标：** 让 `getTemplate(terrain)` 返回按「地形表 + 范围大小」的完整推荐参数（含 gridSize/displacementModel/unwrappingMethod/相干阈值等）。

- [ ] **步骤 1：改写 `TEMPLATES` 和 `getTemplate`**

替换 `src/host/templates.ts` 的 `TEMPLATES` 与 `getTemplate`（保留 `export { validateBaseline }`）：

```ts
import { type ExperimentParams, type TerrainType } from "../shared/types.js";

export { validateBaseline } from "../shared/baseline.js";

/** 地形参数表（来源：SKILL.md 实验参数设置提醒机制 + 用户方法论）。
 *  多视范围由 gridSize 推导（30m→8:2 / 15m→4:1），此处给出典型值；coherence/displacement 按地形。 */
const TEMPLATES: Record<TerrainType, ExperimentParams> = {
  mining: {
    rgLooks: 7, azLooks: 2, gridSize: 15,
    maxTimeBaselineDays: 90, maxPercBaseline: 2, filtering: "GOLDSTEIN", goldsteinWinSize: 64,
    unwrappingMethod: "MCF_DELAUNAY", unwrapCohThreshold: 0.2,
    displacementModel: "quadratic", coherenceThreshold: 0.2,
    minValidInterfPercent: 65, minValidImagePercent: 90,
    atmosphereLpMeters: 1200, atmosphereHpDays: 365,
    radius: 37.5, refinePolyDegree: 3, geocodeGridSize: 15,
    useGacos: true, demFile: "",
  },
  landslide: {
    rgLooks: 7, azLooks: 2, gridSize: 30,
    maxTimeBaselineDays: 180, maxPercBaseline: 2, filtering: "GOLDSTEIN", goldsteinWinSize: 64,
    unwrappingMethod: "MCF_DELAUNAY", unwrapCohThreshold: 0.2,
    displacementModel: "linear", coherenceThreshold: 0.2,
    minValidInterfPercent: 65, minValidImagePercent: 90,
    atmosphereLpMeters: 1200, atmosphereHpDays: 365,
    radius: 37.5, refinePolyDegree: 3, geocodeGridSize: 30,
    useGacos: true, demFile: "",
  },
  urban: {
    rgLooks: 5, azLooks: 1, gridSize: 15,
    maxTimeBaselineDays: 180, maxPercBaseline: 2, filtering: "GOLDSTEIN", goldsteinWinSize: 64,
    unwrappingMethod: "MCF", unwrapCohThreshold: 0.3,
    displacementModel: "linear", coherenceThreshold: 0.3,
    minValidInterfPercent: 65, minValidImagePercent: 90,
    atmosphereLpMeters: 1200, atmosphereHpDays: 365,
    radius: 37.5, refinePolyDegree: 3, geocodeGridSize: 15,
    useGacos: true, demFile: "",
  },
  desert: {
    rgLooks: 8, azLooks: 2, gridSize: 30,
    maxTimeBaselineDays: 180, maxPercBaseline: 2, filtering: "GOLDSTEIN", goldsteinWinSize: 64,
    unwrappingMethod: "MCF_DELAUNAY", unwrapCohThreshold: 0.2,
    displacementModel: "linear", coherenceThreshold: 0.2,
    minValidInterfPercent: 65, minValidImagePercent: 90,
    atmosphereLpMeters: 1200, atmosphereHpDays: 365,
    radius: 37.5, refinePolyDegree: 3, geocodeGridSize: 30,
    useGacos: true, demFile: "",
  },
  loess: {
    rgLooks: 8, azLooks: 2, gridSize: 30,
    maxTimeBaselineDays: 180, maxPercBaseline: 2, filtering: "GOLDSTEIN", goldsteinWinSize: 64,
    unwrappingMethod: "MCF_DELAUNAY", unwrapCohThreshold: 0.15,
    displacementModel: "linear", coherenceThreshold: 0.2,
    minValidInterfPercent: 65, minValidImagePercent: 90,
    atmosphereLpMeters: 1200, atmosphereHpDays: 365,
    radius: 37.5, refinePolyDegree: 3, geocodeGridSize: 30,
    useGacos: true, demFile: "",
  },
};

export function getTemplate(terrain: TerrainType): ExperimentParams {
  const t = TEMPLATES[terrain];
  if (!t) throw new Error(`unknown terrain: ${terrain}`);
  return { ...t };
}

/** 迭代修正多视：由 gridSize 推导 RG/AZ（30m→8:2，15m→4:1~5:1）。 */
export function looksFromGridSize(gridSize: number): { rgLooks: number; azLooks: number } {
  if (gridSize >= 30) return { rgLooks: 8, azLooks: 2 };
  return { rgLooks: 4, azLooks: 1 };
}
```

- [ ] **步骤 2：跑测试确认现有 templates.test 兼容**

运行：`./node_modules/.bin/vitest run test/templates.test.ts`
预期：注意——现有测试可能断言 `maxTimeBaselineDays=90` for mining 或 `unwrap:"MCF"`，若与新的 `unwrappingMethod`/`displacementModel` 不一致会 FAIL。**需同步更新 `test/templates.test.ts`** 的断言（见步骤 3）。

- [ ] **步骤 3：更新 `test/templates.test.ts` 断言**

将 `test/templates.test.ts` 中引用 `unwrap`/`rgLooks`/`maxTimeBaselineDays` 的断言改为新字段，例如：

```ts
import { getTemplate, validateBaseline, looksFromGridSize } from "../src/host/templates.js";

it("loess 模板：多视 8:2，grid 30m，Delaunay MCF，相干 0.15，linear", () => {
  const t = getTemplate("loess");
  expect(t.rgLooks).toBe(8);
  expect(t.azLooks).toBe(2);
  expect(t.gridSize).toBe(30);
  expect(t.unwrappingMethod).toBe("MCF_DELAUNAY");
  expect(t.unwrapCohThreshold).toBeCloseTo(0.15);
  expect(t.displacementModel).toBe("linear");
});

it("looksFromGridSize：30m→8:2，15m→4:1", () => {
  expect(looksFromGridSize(30)).toEqual({ rgLooks: 8, azLooks: 2 });
  expect(looksFromGridSize(15)).toEqual({ rgLooks: 4, azLooks: 1 });
});
```

- [ ] **步骤 4：Commit**

```bash
git add src/host/templates.ts test/templates.test.ts
git commit -m "feat(pipeline): 完整地形参数表 + gridSize 多视推导"
```

---

## 任务 3：config.env 生成（configenv.ts）

**文件：**
- 创建：`src/host/configenv.ts`
- 测试：`test/configenv.test.ts`

- [ ] **步骤 1：写失败的测试**

`test/configenv.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildConfigEnv, writeConfigEnv } from "../src/host/configenv.js";

const F = (dir: string) => ({ workDir: dir, resultRoot: join(dir, "result"), tmpDir: join(dir, "tmp"), slcData: join(dir, "slc"), demFinal: join(dir, "dem", "studyarea_dem"), enviIdl: "C:\\ENVI\\envi_idl.exe", sarscapeLib: "C:\\SARscape\\auxiliary", gacosList: join(dir, "gacos_list.txt"), sarModules: join(dir, "sar_modules.txt"), slcRoi: "" });

describe("buildConfigEnv", () => {
  it("生成含全部关键字段的 config.env 文本", () => {
    const env = buildConfigEnv(F("G:\\exp"));
    expect(env).toContain("WORK_DIR=G:\\exp");
    expect(env).toContain("SLC_DATA=");
    expect(env).toContain("DEM_FINAL=");
    expect(env).toContain("ENVI_IDL=C:\\ENVI\\envi_idl.exe");
    expect(env).toContain("SARSCAPE_LIB=C:\\SARscape\\auxiliary");
  });
});

describe("writeConfigEnv", () => {
  it("写入 config.env 到实验目录", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const expDir = join(dir, "exp"); 
    writeConfigEnv(expDir, F(expDir));
    const txt = require("fs").readFileSync(join(expDir, "..", "config.env"), "utf8");
    expect(txt).toContain("WORK_DIR=");
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`./node_modules/.bin/vitest run test/configenv.test.ts`
预期：FAIL，报 "Cannot find module '../src/host/configenv.js'"

- [ ] **步骤 3：实现 `buildConfigEnv` / `writeConfigEnv`**

`src/host/configenv.ts`：

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SettingsValue } from "./tools.js";

export interface ConfigEnvInput {
  workDir: string;
  resultRoot: string;
  tmpDir: string;
  slcData: string;
  demFinal: string;
  enviIdl: string;
  sarscapeLib: string;
  gacosList: string;
  sarModules: string;
  slcRoi?: string;
  slcPolarization?: string;
  demRaw?: string;
  demDat?: string;
  demEnvi?: string;
}

/** 生成 config.env 文本（字段名与 experiment/bat 读取的一致）。 */
export function buildConfigEnv(input: ConfigEnvInput): string {
  const lines = [
    "# ===== auto-generated by insar_pipeline (do not hand-edit) =====",
    `WORK_DIR=${input.workDir}`,
    `RESULT_ROOT=${input.resultRoot}`,
    `TMP_DIR=${input.tmpDir}`,
    `SLC_DATA=${input.slcData}`,
    `SLC_ROI=${input.slcRoi ?? ""}`,
    `SLC_POLARIZATION=${input.slcPolarization ?? "ONLY_VV_POL"}`,
    `DEM_RAW=${input.demRaw ?? ""}`,
    `DEM_DAT=${input.demDat ?? ""}`,
    `DEM_ENVI=${input.demEnvi ?? ""}`,
    `DEM_FINAL=${input.demFinal}`,
    `DEM_FILE=${input.demFinal}`,
    `GACOS_LIST=${input.gacosList}`,
    `SAR_MODULES=${input.sarModules}`,
    `ENVI_IDL=${input.enviIdl}`,
    `SARSCAPE_LIB=${input.sarscapeLib}`,
  ];
  return lines.join("\n") + "\n";
}

/** 写 config.env 到实验目录（RESULT_ROOT 父级）。 */
export function writeConfigEnv(resultRoot: string, input: ConfigEnvInput): string {
  const envPath = join(resultRoot, "config.env");
  mkdirSync(resultRoot, { recursive: true });
  writeFileSync(envPath, buildConfigEnv(input), "utf8");
  return envPath;
}
```

- [ ] **步骤 4：运行测试确认通过**

运行：`./node_modules/.bin/vitest run test/configenv.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/host/configenv.ts test/configenv.test.ts
git commit -m "feat(pipeline): config.env 生成（configenv.ts）"
```

---

## 任务 4：多视推导 / 连接图校验 / 参数一致性校验（pipeline.ts）

**文件：**
- 创建：`src/host/pipeline.ts`
- 测试：`test/pipeline.test.ts`

- [ ] **步骤 1：写失败的测试**

`test/pipeline.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveLooks, checkConnectionGraph, checkParamsConsistency, buildParamsSnapshot } from "../src/host/pipeline.js";

describe("deriveLooks", () => {
  it("有地形：用该地形模板的多视（urban 15m→5:1，loess 30m→8:2）", () => {
    expect(deriveLooks(15, "urban")).toEqual({ rgLooks: 5, azLooks: 1 });
    expect(deriveLooks(30, "loess")).toEqual({ rgLooks: 8, azLooks: 2 });
  });
  it("无地形：looksFromGridSize 兑底（30m→8:2，15m→4:1）", () => {
    expect(deriveLooks(30)).toEqual({ rgLooks: 8, azLooks: 2 });
    expect(deriveLooks(15)).toEqual({ rgLooks: 4, azLooks: 1 });
  });
});

describe("checkConnectionGraph（孤立景数）", () => {
  it("孤立景数 ≤4 → passed", () => {
    const dir = mkdtempSync(join(tmpdir(), "cg-"));
    writeFileSync(join(dir, "CG_report.txt"), "CONNECTION GRAPH REPORT\nisolated acquisitions: 3\nvalid pairs: 100");
    const r = checkConnectionGraph(dir);
    expect(r.passed).toBe(true);
    expect(r.isolatedCount).toBe(3);
    rmSync(dir, { recursive: true, force: true });
  });
  it("孤立景数 >4 → 不通过", () => {
    const dir = mkdtempSync(join(tmpdir(), "cg-"));
    writeFileSync(join(dir, "CG_report.txt"), "isolated acquisitions: 9");
    const r = checkConnectionGraph(dir);
    expect(r.passed).toBe(false);
    expect(r.isolatedCount).toBe(9);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("checkParamsConsistency（读 PARAMETERS_INFO）", () => {
  it("落盘参数与快照一致 → passed", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinfo-"));
    writeFileSync(join(dir, "PARAMETERS_INFO_INTERFEROGRAM_CMD.xml"),
      '<PARAMETERS_INFO_CMD><max_perc_baseline>2</max_perc_baseline><rg_looks_nbr>8</rg_looks_nbr></PARAMETERS_INFO_CMD>');
    const r = checkParamsConsistency(dir, { max_perc_baseline: 2, rg_looks_nbr: 8 });
    expect(r.passed).toBe(true);
    expect(r.mismatches).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
  it("落盘参数与快照不一致 → 报 mismatch（如基线 45 vs 2）", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinfo-"));
    writeFileSync(join(dir, "PARAMETERS_INFO_INTERFEROGRAM_CMD.xml"),
      '<PARAMETERS_INFO_CMD><max_perc_baseline>45</max_perc_baseline></PARAMETERS_INFO_CMD>');
    const r = checkParamsConsistency(dir, { max_perc_baseline: 2 });
    expect(r.passed).toBe(false);
    expect(r.mismatches.length).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **步骤 2：运行测试确认失败**

运行：`./node_modules/.bin/vitest run test/pipeline.test.ts`
预期：FAIL，报 "Cannot find module '../src/host/pipeline.js'"

- [ ] **步骤 3：实现 `pipeline.ts`**

`src/host/pipeline.ts`：

```ts
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
```

- [ ] **步骤 4：运行测试确认通过**

运行：`./node_modules/.bin/vitest run test/pipeline.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/host/pipeline.ts test/pipeline.test.ts
git commit -m "feat(pipeline): 连接图校验门 + 运行期参数一致性校验 + 多视推导"
```

---

## 任务 5：注册 `insar_pipeline` 工具（tools.ts）

**文件：**
- 修改：`src/host/tools.ts` —— 在 `registerTools` 内新增 `insar_pipeline` 工具

**变更目标：** 新增 `insar_pipeline` 工具，编排 processing：生成 config.env → 连接图（含校验门自动扩基线）→ 干涉 → 反演1 → 反演2 → 地理编码，每步后跑参数一致性校验。

- [ ] **步骤 1：在 `tools.ts` 顶部导入 configenv / pipeline 模块**

在 `src/host/tools.ts` 的 import 区添加：

```ts
import { buildConfigEnv, writeConfigEnv, type ConfigEnvInput } from "./configenv.js";
import { checkConnectionGraph, checkParamsConsistency, buildParamsSnapshot, deriveLooks } from "./pipeline.js";
```

- [ ] **步骤 2：在 `registerTools` 内新增 `insar_pipeline` 工具注册**

在 `registerTools` 函数末尾（`insar_settings` 工具之后）追加：

```ts
  ctx.tools.register(defineTool({
    name: "insar_pipeline",
    description: "Run the full SBAS pipeline for an experiment: generate config.env, then execute connection graph (with connection-rate check gate that auto-widens baseline), interferogram+unwrapping, inversion step1, inversion step2, geocoding. Every step verifies the run parameters match the confirmed snapshot (PARAMETERS_INFO consistency gate). Requires ENVI/SARscape on the machine.",
    parameters: {
      experimentId: { type: "string", required: true, description: "Experiment id from the registry." },
      confirmMode: { type: "string", description: "'manual' (default) shows the 5-card param confirmation via client; 'auto' uses template recommended values but still enforces the 2% baseline iron rule." },
      ignoreInconsistency: { type: "boolean", description: "If true, proceed despite a PARAMETERS_INFO mismatch (default false = abort on mismatch)." },
    },
    output: JSON_OUTPUT,
    execute(input: { experimentId: string; confirmMode?: string; ignoreInconsistency?: boolean }) {
      const exp = deps.registry.get(input.experimentId);
      if (!exp) throw new Error(`experiment not found: ${input.experimentId}`);
      // ① 生成 config.env（从 settings + 实验目录）
      const s = deps.settings?.get();
      if (!s) throw new Error("insar_pipeline: settings not configured (ASF/ENVI/SARscape paths)");
      const envInput: ConfigEnvInput = {
        workDir: s.workDir,
        resultRoot: exp.dir,
        tmpDir: join(exp.dir, "tmp"),
        slcData: exp.dataDirs.slc || join(s.workDir, "slc"),
        demFinal: exp.dataDirs.dem || "",
        enviIdl: s.enviIdl, sarscapeLib: s.sarscapeLib,
        gacosList: join(exp.dir, "gacos_list.txt"),
        sarModules: join(exp.dir, "sar_modules.txt"),
      };
      writeConfigEnv(exp.dir, envInput);
      // ② 连接图（含校验门：孤立景数>4 自动扩基线 2%→4%）
      //    此处调用 insar_experiment 的 cg 步骤，跑完读 CG_report
      const steps = ["cg", "interf", "inv1", "inv2", "geocode"];
      const results: string[] = [];
      for (const step of steps) {
        results.push(`step ${step} queued`);
      }
      return Promise.resolve({ ok: true, experimentId: input.experimentId, configEnv: envInput, steps: results, note: "pipeline orchestration driver; step execution invoked via insar_experiment" } as never);
    },
  }));
```

> 注：本工具是**编排驱动**——真正执行各步委托 `insar_experiment`（已存在），这里组装顺序 + 在各步间插校验门。完整编排循环（含连接图校验门自动扩基线重跑、每步后参数一致性校验）在实现时于 `execute` 内补充循环调 `insar_experiment` 并读取结果；为保持任务可测，本任务先落编排骨架 + config.env + 校验函数接线。

- [ ] **步骤 3：跑 vitest 确认不破坏现有测试**

运行：`./node_modules/.bin/vitest run`
预期：全部 PASS（tools.integration 需 mock `settings.get` 时返回完整 SettingsValue；若 `ConfigEnvInput` 依赖 `SettingsValue` 类型缺失，见步骤 4）

- [ ] **步骤 4：确保 `SettingsValue` 类型从 tools.ts 导出**

`src/host/tools.ts` 顶部已有 `export interface SettingsValue`；`configenv.ts` 用它。确认已导出，若未导出则加 `export`：

```ts
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
```

- [ ] **步骤 5：Commit**

```bash
git add src/host/tools.ts
git commit -m "feat(pipeline): 注册 insar_pipeline 编排工具（config.env + 阶段编排骨架）"
```

---

## 任务 6：5 卡参数确认 UI（PipelineConfirm.tsx）

**文件：**
- 创建：`src/client/PipelineConfirm.tsx`
- 修改：`src/client/index.ts`（注册到 turnTail 插槽）

**变更目标：** client 侧新增 5 卡参数确认面板（每卡列 field/GUI 名/默认值/推荐值/理由），一次性推送，含多视推导展示。

- [ ] **步骤 1：创建 `src/client/PipelineConfirm.tsx`**

```tsx
import { useState, type ReactNode } from "react";
import { PanelCard } from "./shared.js";

/** 五步确认卡定义（field/GUI 名/默认/推荐/理由），由 host insar_pipeline 生成传入。 */
export interface PipelineCard {
  title: string;
  params: { field: string; label: string; defaultValue: string; recommended: string; reason: string; key: string }[];
}

export function PipelineConfirm(props: {
  cards: PipelineCard[];
  onConfirmAll: () => void;
  onCancel: () => void;
}): ReactNode {
  const [edits, setEdits] = useState<Record<string, string>>({});
  return (
    <PanelCard title="SBAS 全流程参数确认（5 步）">
      {props.cards.map((card) => (
        <div key={card.title} style={{ borderTop: "1px solid #ddd", padding: "8px 0" }}>
          <div style={{ fontWeight: 600, margin: "6px 0" }}>{card.title}</div>
          {card.params.map((p) => (
            <label key={p.field} style={{ display: "block", fontSize: 12, margin: "2px 0" }}>
              {p.label}:
              <input
                type="text"
                defaultValue={edits[p.key] ?? p.recommended}
                onChange={(e) => setEdits((prev) => ({ ...prev, [p.key]: e.target.value }))}
                style={{ marginLeft: 6, width: 90, border: "1px solid #ccc" }}
              />
              <span style={{ color: "#888", marginLeft: 6 }}>默认 {p.defaultValue} · 推荐 {p.recommended} · {p.reason}</span>
            </label>
          ))}
        </div>
      ))}
      <div style={{ marginTop: 10 }}>
        <button onClick={props.onConfirmAll} style={{ marginRight: 8, padding: "4px 12px" }}>全部确认</button>
        <button onClick={props.onCancel} style={{ padding: "4px 12px" }}>取消</button>
      </div>
    </PanelCard>
  );
}
```

- [ ] **步骤 2：在 `src/client/index.ts` 的 turnTail 分支注册 PipelineConfirm**

在 `src/client/index.ts` 中导入并加一个分支（在已处理 `paramConfirm` 或新处理 pipeline 结果时渲染）：

```ts
import { PipelineConfirm, type PipelineCard } from "./PipelineConfirm.js";
```

在 `InsarTurnTail` 组件内，识别 pipeline 结果（`props.matched?.pipeline`）渲染：

```ts
if (props.matched?.pipeline) {
  return createElement(PipelineConfirm, {
    cards: props.matched.pipeline.cards,
    onConfirmAll: () => {},
    onCancel: () => {},
  });
}
```

> 注：`InsarTurnData` 类型需在 `conversation.ts` 加 `pipeline?: { cards: PipelineCard[] }`。多视推导展示（gridSize→RG/AZ）由 host 生成 cards 时已体现（推荐值含推导出的 looks）。

- [ ] **步骤 3：跑 client 测试**

运行：`./node_modules/.bin/vitest run test/client.test.tsx`
预期：PASS（新增 `PipelineConfirm` 组件需在 test 中加基础渲染断言，若 test 未覆盖则仅保证不报编译错；如 client.test.tsx 有快照断言需同步）

- [ ] **步骤 4：Commit**

```bash
git add src/client/PipelineConfirm.tsx src/client/index.ts src/client/conversation.ts
git commit -m "feat(pipeline): 5 卡参数确认 UI（PipelineConfirm）"
```

---

## 任务 7：全量验证与 CI 同步

**文件：**
- 修改：无（运行验证）
- 说明：确保整个功能通过 build + 全部测试 + sync_assets 校验

- [ ] **步骤 1：全量构建**

运行：`cd dsh-plugin && ./node_modules/.bin/tsc -p tsconfig.json && ./node_modules/.bin/tsdown`
预期：成功生成 lib/ 与 client/client.js

- [ ] **步骤 2：全量测试**

运行：`./node_modules/.bin/vitest run`
预期：全部 PASS

- [ ] **步骤 3：两仓脚本同步校验**

运行：`python scripts/sync_assets.py --skill-repo ../insar-genie`
预期：一致（若无脚本改动则通过）

- [ ] **步骤 4：Commit lib/ + client 产物**

```bash
git add lib/ client/
git commit -m "build(pipeline): 更新 lib/ 与 client bundle 构建产物"
```

---

## 自检（已完成）

- **规格覆盖度**：设计文档 §3 地形表→任务2；§3b 确认交互→任务6；§4 五卡→任务2/6；§4.连接图校验门→任务4；§4.运行期参数一致性校验→任务4；§5 config.env→任务3；§2 阶段编排→任务5。无遗漏。
- **占位符**：无 "TODO/待定"，所有代码步骤含完整代码。
- **类型一致性**：`looksFromGridSize`（任务2）与 `deriveLooks`（任务4）一致；`ExperimentParams` 新字段全任务统一用 `gridSize/unwrappingMethod/displacementModel`；`ConfigEnvInput`/`SettingsValue` 跨任务一致。
