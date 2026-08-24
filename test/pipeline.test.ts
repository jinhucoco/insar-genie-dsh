import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
