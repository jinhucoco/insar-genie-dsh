import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseAuxiliarySteps,
  parsePairProgress,
  parseGuardLog,
  computeStatus,
} from "../src/host/status.js";

const FIX = (f: string) =>
  join(process.cwd(), "test", "fixtures", f);

describe("parseAuxiliarySteps", () => {
  it("解析 auxiliary.sml 的 OK/NotOK 标记", () => {
    const steps = parseAuxiliarySteps(readFileSync(FIX("auxiliary.sml"), "utf8"));
    expect(steps.generate_connection_graph).toBe(true);
    expect(steps.interf_stack).toBe(false);
    expect(steps.geocode_result).toBe(false);
  });
});

describe("parsePairProgress", () => {
  it("从 step_performed.sml 计算已完成对/总对", () => {
    const { done, total } = parsePairProgress(
      readFileSync(FIX("step_performed.sml"), "utf8"),
    );
    expect(total).toBe(310);
    expect(done).toBe(4); // fixture 中 4 行 step=1
  });
});

describe("parseGuardLog", () => {
  it("从 guard.log 提取最后一条进度", () => {
    const last = parseGuardLog(readFileSync(FIX("guard.log"), "utf8"));
    expect(last.donePairs).toBe(190);
    expect(last.totalPairs).toBe(376);
    expect(last.diskGb).toBeGreaterThan(20);
  });
});

describe("computeStatus", () => {
  it("组合成完整状态（当前在干涉图阶段）", () => {
    const status = computeStatus({
      auxXml: readFileSync(FIX("auxiliary.sml"), "utf8"),
      stepPerformedXml: readFileSync(FIX("step_performed.sml"), "utf8"),
      guardLog: readFileSync(FIX("guard.log"), "utf8"),
    });
    expect(status.step).toBe("interf_stack");
    expect(status.stepIndex).toBe(1);
    expect(status.donePairs).toBe(190);
    expect(status.totalPairs).toBe(376);
    expect(status.progressLabel).toContain("干涉");
  });

  it("auxXml 缺失时返回 error 而非误导的全零状态", () => {
    const status = computeStatus({ auxXml: "", stepPerformedXml: "", guardLog: "" });
    expect(status.error?.code).toBe("no-auxiliary");
    expect(status.progressLabel).toBe("无法读取进度文件");
    expect(status.donePairs).toBe(0);
  });

  it("无动态速率时按基线长度分档兑底（短基线快，长基线慢）", () => {
    // guardLog 为空/无体检记录 → 无动态速率，走基线分档兑底
    const aux = readFileSync(FIX("auxiliary.sml"), "utf8");
    const step = readFileSync(FIX("step_performed.sml"), "utf8");
    // 假设一组有实际对数的数据（用 step 文件里的 total>0）来触发 eta 计算
    // 关键断言：速率随基线增大而减小
    const s2 = computeStatus({ auxXml: aux, stepPerformedXml: step, guardLog: "", maxPercBaseline: 2 });
    const s4 = computeStatus({ auxXml: aux, stepPerformedXml: step, guardLog: "", maxPercBaseline: 4 });
    const s8 = computeStatus({ auxXml: aux, stepPerformedXml: step, guardLog: "", maxPercBaseline: 8 });
    // 无基线参数 → 默认为短基线速率 0.22
    const sDef = computeStatus({ auxXml: aux, stepPerformedXml: step, guardLog: "" });
    expect(s2.pairsPerMinute).toBeCloseTo(0.22);
    expect(s4.pairsPerMinute).toBeCloseTo(0.12);
    expect(s8.pairsPerMinute).toBeCloseTo(0.05);
    expect(sDef.pairsPerMinute).toBeCloseTo(0.22);
    // 长基线 ETA 更长（更多剩余时间）
    expect(s8.etaMinutes).toBeGreaterThan(s2.etaMinutes);
  });
});
