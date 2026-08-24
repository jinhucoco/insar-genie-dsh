import { describe, it, expect } from "vitest";
import { getTemplate, validateBaseline, looksFromGridSize } from "../src/host/templates.js";

describe("getTemplate", () => {
  it("按地形返回参数模板（loess：多视 8:2，grid 30m，Delaunay MCF，相干 0.15，linear）", () => {
    const t = getTemplate("loess");
    expect(t.rgLooks).toBe(8);
    expect(t.azLooks).toBe(2);
    expect(t.gridSize).toBe(30);
    expect(t.unwrappingMethod).toBe("MCF_DELAUNAY");
    expect(t.unwrapCohThreshold).toBeCloseTo(0.15);
    expect(t.displacementModel).toBe("linear");
    expect(t.maxPercBaseline).toBe(2);
  });
  it("未知地形抛错", () => {
    expect(() => getTemplate("ocean" as any)).toThrow("unknown terrain");
  });
});

describe("looksFromGridSize", () => {
  it("30m→8:2，15m→4:1", () => {
    expect(looksFromGridSize(30)).toEqual({ rgLooks: 8, azLooks: 2 });
    expect(looksFromGridSize(15)).toEqual({ rgLooks: 4, azLooks: 1 });
  });
  it(">30m 也按 8:2（含 30），<30m 按 4:1", () => {
    expect(looksFromGridSize(60)).toEqual({ rgLooks: 8, azLooks: 2 });
    expect(looksFromGridSize(10)).toEqual({ rgLooks: 4, azLooks: 1 });
  });
});

describe("validateBaseline", () => {
  it("2% 通过", () => {
    expect(validateBaseline(2).ok).toBe(true);
  });
  it("4% 通过（扩大上限）", () => {
    expect(validateBaseline(4).ok).toBe(true);
  });
  it("45% 被拦截（防呆，杜绝事故）", () => {
    const r = validateBaseline(45);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("2-4");
  });
  it("1% 被拦截（低于下限）", () => {
    expect(validateBaseline(1).ok).toBe(false);
  });
});
