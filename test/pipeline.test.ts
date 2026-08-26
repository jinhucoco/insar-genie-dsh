import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveLooks, checkConnectionGraph, checkParamsConsistency, buildParamsSnapshot, buildPipelineCards } from "../src/host/pipeline.js";

describe("deriveLooks", () => {
  it("有地形：用该地形模板的多视（urban 15m→5:1，loess 30m→8:2）", () => {
    expect(deriveLooks(15, "urban")).toEqual({ rgLooks: 5, azLooks: 1 });
    expect(deriveLooks(30, "loess")).toEqual({ rgLooks: 8, azLooks: 2 });
  });
  it("无地形：looksFromGridSize 兑底（30m→8:2，15m→4:1）", () => {
    expect(deriveLooks(30)).toEqual({ rgLooks: 8, azLooks: 2 });
    expect(deriveLooks(15)).toEqual({ rgLooks: 4, azLooks: 1 });
  });

describe("buildPipelineCards（B1 确认后跑）", () => {
  const base = {
    terrain: "urban" as const,
    params: {
      rgLooks: 5, azLooks: 1, gridSize: 15, maxTimeBaselineDays: 180, maxPercBaseline: 2,
      filtering: "GOLDSTEIN" as const, goldsteinWinSize: 64, unwrappingMethod: "MCF" as const,
      unwrapCohThreshold: 0.3, displacementModel: "linear" as const, coherenceThreshold: 0.3,
      minValidInterfPercent: 65, minValidImagePercent: 90, atmosphereLpMeters: 1200,
      atmosphereHpDays: 365, radius: 37.5, refinePolyDegree: 3, geocodeGridSize: 15,
      useGacos: true, demFile: "",
    },
  };

  it("生成 5 张确认卡（每卡 title + params 含 field/label/default/recommended/reason/key）", () => {
    const cards = buildPipelineCards(base);
    expect(cards).toHaveLength(5);
    expect(cards.map((c) => c.title)).toEqual([
      "① Connection Graph（连接图）",
      "② Interferogram & Unwrapping（干涉+解缠）",
      "③ Inversion Step 1（反演1）",
      "④ Inversion Step 2（反演2）",
      "⑤ Geocoding（地理编码）",
    ]);
    for (const card of cards) {
      for (const p of card.params) {
        expect(p.field).toBeTruthy();
        expect(p.label).toBeTruthy();
        expect(p.defaultValue).toBeTruthy();
        expect(p.recommended).toBeTruthy();
        expect(p.key).toBe(p.field);
        expect(typeof p.reason).toBe("string");
      }
    }
  });

  it("推荐值按地形表：urban 15m 多视 5:1，baseline 推荐 2（铁律）", () => {
    const cards = buildPipelineCards(base);
    const interf = cards[1];
    const rg = interf.params.find((p) => p.field === "RG_LOOKS_NBR")!;
    const az = interf.params.find((p) => p.field === "AZ_LOOKS_NBR")!;
    expect(rg.recommended).toBe("5");
    expect(az.recommended).toBe("1");
    const cg = cards[0];
    const bl = cg.params.find((p) => p.field === "MAX_PERC_BASELINE")!;
    expect(bl.recommended).toBe("2");
    expect(bl.defaultValue).toBe("2");
  });
});
});

describe("checkConnectionGraph（孤立景数）", () => {
  it("孤立景数 ≤4 → passed", () => {
    const dir = mkdtempSync(join(tmpdir(), "cg-"));
    writeFileSync(join(dir, "CG_report.txt"), "CONNECTION GRAPH REPORT\nisolated acquisitions: 3\nvalid pairs: 100");
    const r = checkConnectionGraph(dir);
    expect(r.passed).toBe(true);
    expect(r.isolatedCount).toBe(3);
    expect(r.missingInfo).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
  it("孤立景数 >4 → 不通过", () => {
    const dir = mkdtempSync(join(tmpdir(), "cg-"));
    writeFileSync(join(dir, "CG_report.txt"), "isolated acquisitions: 9");
    const r = checkConnectionGraph(dir);
    expect(r.passed).toBe(false);
    expect(r.isolatedCount).toBe(9);
    expect(r.missingInfo).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
  it("真实布局：CG_*_SBAS_processing/connection_graph/CG_report.txt 被探测到（expDir 根无报告）", () => {
    const dir = mkdtempSync(join(tmpdir(), "cg-"));
    const cg = join(dir, "CG_demo_SBAS_processing", "connection_graph");
    mkdirSync(cg, { recursive: true });
    writeFileSync(join(cg, "CG_report.txt"), "isolated acquisitions: 2");
    const r = checkConnectionGraph(dir);
    expect(r.passed).toBe(true);
    expect(r.isolatedCount).toBe(2);
    expect(r.missingInfo).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
  it("experimentDir （数据根 ≠ exp.dir）优先：报告在数据根的 CG_* 下", () => {
    const root = mkdtempSync(join(tmpdir(), "cg-"));
    const expDir = join(root, "exp"); // 实验登记目录（无产物）
    const dataRoot = join(root, "data"); // settings.experimentDir
    const cg = join(dataRoot, "CG_demo_SBAS_processing", "connection_graph");
    mkdirSync(cg, { recursive: true });
    writeFileSync(join(cg, "CG_report.txt"), "isolated acquisitions: 7");
    const r = checkConnectionGraph(expDir, dataRoot);
    expect(r.passed).toBe(false);
    expect(r.isolatedCount).toBe(7);
    rmSync(root, { recursive: true, force: true });
  });
  it("找不到 CG_report.txt → passed=false + missingInfo=true（不静默通过）", () => {
    const dir = mkdtempSync(join(tmpdir(), "cg-"));
    const r = checkConnectionGraph(dir);
    expect(r.passed).toBe(false);
    expect(r.missingInfo).toBe(true);
    expect(r.isolatedCount).toBe(0);
    expect(r.message).toContain("找不到 CG_report.txt");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("checkParamsConsistency（读 PARAMETERS_INFO）", () => {
  it("落盘参数与快照一致 → passed（missingInfo=false）", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinfo-"));
    writeFileSync(join(dir, "PARAMETERS_INFO_INTERFEROGRAM_GENERATION_CMD.xml"),
      '<PARAMETERS_INFO_CMD><max_perc_baseline>2</max_perc_baseline><rg_looks_nbr>8</rg_looks_nbr></PARAMETERS_INFO_CMD>');
    const r = checkParamsConsistency(dir, { max_perc_baseline: 2, rg_looks_nbr: 8 }, "INTERFEROGRAM_GENERATION");
    expect(r.passed).toBe(true);
    expect(r.mismatches).toEqual([]);
    expect(r.missingInfo).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("落盘参数与快照不一致 → 报 mismatch（如基线 45 vs 2）", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinfo-"));
    writeFileSync(join(dir, "PARAMETERS_INFO_INTERFEROGRAM_GENERATION_CMD.xml"),
      '<PARAMETERS_INFO_CMD><max_perc_baseline>45</max_perc_baseline></PARAMETERS_INFO_CMD>');
    const r = checkParamsConsistency(dir, { max_perc_baseline: 2 }, "INTERFEROGRAM_GENERATION");
    expect(r.passed).toBe(false);
    expect(r.mismatches.length).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("找不到 PARAMETERS_INFO_*.xml → passed=false, missingInfo=true（不静默通过）", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinfo-"));
    const r = checkParamsConsistency(dir, { max_perc_baseline: 2 }, "INTERFEROGRAM_GENERATION");
    expect(r.passed).toBe(false);
    expect(r.missingInfo).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("XML 缺 key → 未核实则 missingInfo=true（不静默通过）；部分核实且一致则 passed=true 但 unverified 列出", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinfo-"));
    writeFileSync(join(dir, "PARAMETERS_INFO_INTERFEROGRAM_GENERATION_CMD.xml"),
      '<PARAMETERS_INFO_CMD><max_perc_baseline>2</max_perc_baseline></PARAMETERS_INFO_CMD>');
    // 全部 key 无法核实
    const rAllMissing = checkParamsConsistency(dir, { rg_looks_nbr: 8 }, "INTERFEROGRAM_GENERATION");
    expect(rAllMissing.missingInfo).toBe(true);
    expect(rAllMissing.passed).toBe(false);
    expect(rAllMissing.unverified).toContain("rg_looks_nbr");
    // 部分核实且一致
    const rPartial = checkParamsConsistency(dir, { max_perc_baseline: 2, rg_looks_nbr: 8 }, "INTERFEROGRAM_GENERATION");
    expect(rPartial.passed).toBe(true);
    expect(rPartial.missingInfo).toBe(false);
    expect(rPartial.unverified).toContain("rg_looks_nbr");
    rmSync(dir, { recursive: true, force: true });
  });

  it("moduleKey 过滤：只选匹配模块的 XML（多个模块文件时按时间戳选最新）", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinfo-"));
    // 两个模块、不同时间戳，moduleKey 应只匹配 INTERFEROGRAM_GENERATION
    writeFileSync(join(dir, "PARAMETERS_INFO_IMPORT_SENTINEL1_CMD_13Aug2026_212544.xml"),
      '<PARAMETERS_INFO_CMD><max_perc_baseline>99</max_perc_baseline></PARAMETERS_INFO_CMD>');
    writeFileSync(join(dir, "PARAMETERS_INFO_INTERFEROGRAM_GENERATION_CMD_20Aug2026_100000.xml"),
      '<PARAMETERS_INFO_CMD><max_perc_baseline>2</max_perc_baseline></PARAMETERS_INFO_CMD>');
    // 旧的也混合，验证按时间戳选最新
    writeFileSync(join(dir, "PARAMETERS_INFO_INTERFEROGRAM_GENERATION_CMD_18Aug2026_220000.xml"),
      '<PARAMETERS_INFO_CMD><max_perc_baseline>5</max_perc_baseline></PARAMETERS_INFO_CMD>');
    const r = checkParamsConsistency(dir, { max_perc_baseline: 2 }, "INTERFEROGRAM_GENERATION");
    expect(r.passed).toBe(true);      // 最新(20Aug)=2 与快照一致
    expect(r.missingInfo).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("buildParamsSnapshot", () => {
  it("把 ExperimentParams 映射为与落盘 XML key 对齐的快照", () => {
    const snap = buildParamsSnapshot({
      rgLooks: 8, azLooks: 2, gridSize: 30, maxTimeBaselineDays: 180,
      maxPercBaseline: 2, filtering: "GOLDSTEIN", goldsteinWinSize: 64,
      unwrappingMethod: "MCF_DELAUNAY", unwrapCohThreshold: 0.2,
      displacementModel: "linear", coherenceThreshold: 0.2,
      minValidInterfPercent: 65, minValidImagePercent: 90,
      atmosphereLpMeters: 1200, atmosphereHpDays: 365,
      radius: 37.5, refinePolyDegree: 3, geocodeGridSize: 30,
      useGacos: true, demFile: "",
    } as never);
    expect(snap).toMatchObject({
      max_perc_baseline: 2, rg_looks_nbr: 8, az_looks_nbr: 2,
      up_coh_threshold: 0.2, product_coherence_thresh: 0.2,
      displacement_model_type: "linear",
    });
  });
});
