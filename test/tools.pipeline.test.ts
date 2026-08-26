import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// mock 编排外部依赖：绝不真正跑 SARscape / 读真实 PARAMETERS_INFO / 写 config.env。
const { checkConnectionGraphMock, checkParamsConsistencyMock, writeConfigEnvMock, buildParamsSnapshotMock } =
  vi.hoisted(() => ({
    checkConnectionGraphMock: vi.fn(),
    checkParamsConsistencyMock: vi.fn(),
    writeConfigEnvMock: vi.fn(),
    buildParamsSnapshotMock: vi.fn(),
  }));

vi.mock("../src/host/configenv.js", () => ({
  writeConfigEnv: writeConfigEnvMock,
  buildConfigEnv: (i: unknown) => JSON.stringify(i),
}));
vi.mock("../src/host/pipeline.js", () => ({
  checkConnectionGraph: checkConnectionGraphMock,
  checkParamsConsistency: checkParamsConsistencyMock,
  buildParamsSnapshot: buildParamsSnapshotMock,
  deriveLooks: () => ({ rgLooks: 4, azLooks: 4 }),
  buildPipelineCards: () => [
    { title: "① Connection Graph", params: [{ field: "MAX_PERC_BASELINE", label: "Max Baseline", defaultValue: "2", recommended: "2", reason: "铁律", key: "MAX_PERC_BASELINE" }] },
  ],
}));

import { registerTools } from "../src/host/tools.js";
import { createRegistry } from "../src/host/registry.js";
import { resolveExperimentDir } from "../src/host/paths.js";

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

// 最小可用的 ExperimentParams（buildParamsSnapshot 被 mock）
const TEST_PARAMS = {
  rgLooks: 4,
  azLooks: 4,
  gridSize: 15,
  maxTimeBaselineDays: 180,
  maxPercBaseline: 2,
  filtering: "GOLDSTEIN" as const,
  goldsteinWinSize: 64,
  unwrappingMethod: "MCF" as const,
  unwrapCohThreshold: 0.2,
  displacementModel: "linear" as const,
  coherenceThreshold: 0.2,
  minValidInterfPercent: 50,
  minValidImagePercent: 50,
  atmosphereLpMeters: 700,
  atmosphereHpDays: 30,
  radius: 30,
  refinePolyDegree: 3,
  geocodeGridSize: 30,
  useGacos: true,
  demFile: "G:/dem/studyarea_dem",
};

const TEST_SETTINGS = {
  earthdataUser: "u",
  earthdataPassword: "p",
  gacosEmail: "e",
  gacosImapAuthCode: "c",
  enviIdl: "C:/Program Files/Harris/ENVI56/IDL88/bin/bin.x86_64/envi_idl.exe",
  sarscapeLib: "C:/Program Files/SARMAP SA/SARscape/auxiliary",
  workDir: "D:/work/data",
  poeorbDir: "D:/work/data/poeorb",
};

function registerPipelineTool(dir: string, runStep: unknown, settingsOverride?: Record<string, unknown>): Tool {
  const registry = createRegistry(join(dir, "registry"));
  const experimentId = registry.create({
    name: "test",
    terrain: "urban",
    dir,
    dataDirs: { slc: "E:/slc", poeorb: "", gacos: "", dem: "G:/dem" },
    params: TEST_PARAMS as never,
    status: "draft",
  });
  const registered: Tool[] = [];
  const ctx: any = { tools: { register: (t: Tool) => registered.push(t) } };
  registerTools(ctx, {
    registry,
    settings: { get: () => ({ ...TEST_SETTINGS, ...settingsOverride }) },
    runStep: runStep as never,
  });
  const tool = registered.find((t) => t.name === "insar_pipeline");
  if (!tool) throw new Error("insar_pipeline not registered");
  return { ...tool, __experimentId: experimentId } as Tool & { __experimentId: string };
}

describe("insar_pipeline 编排", () => {
  let dir: string;
  let pipeline: Tool & { __experimentId: string };
  let runStepMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "insar-pipeline-"));
    checkConnectionGraphMock.mockReset();
    checkParamsConsistencyMock.mockReset();
    writeConfigEnvMock.mockReset();
    buildParamsSnapshotMock.mockReset();
    buildParamsSnapshotMock.mockImplementation((p: unknown) => ({ snapshot: p }));
    runStepMock = vi.fn();
    runStepMock.mockResolvedValue({ ok: true, step: "cg" });
    pipeline = registerPipelineTool(dir, runStepMock);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("B1 默认（确认后跑）：返回 needsConfirm + pipeline.cards，不执行任何步骤", async () => {
    // 不传 confirmed/confirmMode → 只生成确认卡，不跑步骤
    const out = await pipeline.execute({ experimentId: pipeline.__experimentId });

    expect(out).toMatchObject({ ok: true, needsConfirm: true });
    const cards = (out as { pipeline?: { cards?: { title: string; params: { key: string }[] }[] } }).pipeline?.cards;
    expect(Array.isArray(cards)).toBe(true);
    expect(cards?.length).toBeGreaterThan(0);
    expect(cards![0].title).toContain("Connection Graph");
    expect(cards![0].params[0]).toMatchObject({ key: "MAX_PERC_BASELINE" });

    // 不应执行任何 runStep（不跑 SARscape）
    expect(runStepMock).not.toHaveBeenCalled();
  });

  it("生成 config.env（写到脚本根=插件内置）+ 按序跑 5 步 + 每步参数一致性校验", async () => {
    checkConnectionGraphMock.mockReturnValue({ isolatedCount: 0, passed: true, message: "OK" });
    checkParamsConsistencyMock.mockReturnValue({ mismatches: [], passed: true, message: "一致", missingInfo: false, unverified: [] });

    const out = await pipeline.execute({ experimentId: pipeline.__experimentId, confirmed: true });

    // config.env 写了：初始 writeConfigEnv(scriptRoot, baseEnv) + cg 循环里 writeBaselineEnv(2) 各一次
    // scriptsDir 未设 → 脚本根 = 插件内置 assets/experiment（resolveExperimentDir() 默认链）
    expect(writeConfigEnvMock).toHaveBeenCalledTimes(2);
    const [scriptRoot, envInput] = writeConfigEnvMock.mock.calls[0];
    expect(scriptRoot).toBe(resolveExperimentDir());
    expect(envInput.resultRoot).toBe(dir); // 数据根回退 exp.dir
    expect(envInput.superReference).toBe(""); // SUPER_REFERENCE 默认空（走 bat 兑底）
    expect(envInput.slcData).toBe("E:/slc");
    expect(envInput.workDir).toBe("D:/work/data");

    // 5 步按序执行
    const steps = runStepMock.mock.calls.map((c) => c[1]);
    expect(steps).toEqual(["cg", "interf", "inv1", "inv2", "geocode"]);

    // 参数一致性校验：4 次（interf/inv1/inv2/geocode 各有 moduleKey）
    expect(checkParamsConsistencyMock).toHaveBeenCalledTimes(4);
    const cgStepModuleKeys = checkParamsConsistencyMock.mock.calls.map((c) => c[2]);
    expect(cgStepModuleKeys).toEqual([
      "INSAR_STACK_SBAS_INTERFEROGRAM_GENERATION",
      "INSAR_STACK_SBAS_INVERSION",
      "INSAR_STACK_SBAS_INVERSION",
      "INSAR_STACK_SBAS_GEOCODE",
    ]);

    expect(out).toMatchObject({ ok: true });
    expect((out as { steps: { step: string; ok: boolean; unverified?: string[]; missingInfo?: boolean }[] }).steps).toEqual([
      { step: "cg", ok: true },
      { step: "interf", ok: true, unverified: [], missingInfo: false },
      { step: "inv1", ok: true, unverified: [], missingInfo: false },
      { step: "inv2", ok: true, unverified: [], missingInfo: false },
      { step: "geocode", ok: true, unverified: [], missingInfo: false },
    ]);
  });

  it("连接图门：孤立景数>4 → 自动把基线从 2% 扩到 4% 后重跑 cg", async () => {
    // 第一次 cg：>4 孤立（未过）→ 扩到 4% 重跑 → 通过
    checkConnectionGraphMock
      .mockReturnValueOnce({ isolatedCount: 7, passed: false, message: ">4" })
      .mockReturnValueOnce({ isolatedCount: 2, passed: true, message: "OK" });
    checkParamsConsistencyMock.mockReturnValue({ mismatches: [], passed: true, message: "一致", missingInfo: false, unverified: [] });

    await pipeline.execute({ experimentId: pipeline.__experimentId, confirmed: true });

    // cg 跑 2 次，第二次 overrides.maxPercBaseline=4
    const cgCalls = runStepMock.mock.calls.filter((c) => c[1] === "cg");
    expect(cgCalls).toHaveLength(2);
    expect(cgCalls[0][2]).toMatchObject({ maxPercBaseline: 2, scriptRoot: resolveExperimentDir() });
    expect(cgCalls[1][2]).toMatchObject({ maxPercBaseline: 4, scriptRoot: resolveExperimentDir() });
    // 后续步仍按序执行
    const steps = runStepMock.mock.calls.filter((c) => c[1] !== "cg").map((c) => c[1]);
    expect(steps).toEqual(["interf", "inv1", "inv2", "geocode"]);
    // B2 重要发现：参数快照必须在扩基线后构建（snapshot.max_perc_baseline 应为扩后的 4）
    expect(buildParamsSnapshotMock).toHaveBeenCalledTimes(1);
    expect(buildParamsSnapshotMock.mock.calls[0][0]).toMatchObject({ maxPercBaseline: 4 });
  });

  it("连接图门：扩到 4% 仍不合格 → 抛错中断", async () => {
    checkConnectionGraphMock.mockReturnValue({ isolatedCount: 9, passed: false, message: ">4" });
    checkParamsConsistencyMock.mockReturnValue({ mismatches: [], passed: true, message: "一致", missingInfo: false, unverified: [] });

    await expect(pipeline.execute({ experimentId: pipeline.__experimentId, confirmed: true })).rejects.toThrow(/连接图校验门未过/);
    // 不应执行后续步骤
    const steps = runStepMock.mock.calls.map((c) => c[1]);
    expect(steps).toEqual(["cg", "cg"]); // 2 次 cg 尝试（2% 与 4%），未进入后续
  });

  it("参数一致性门：某项不一致且未 ignoreInconsistency → 抛错中断", async () => {
    checkConnectionGraphMock.mockReturnValue({ isolatedCount: 0, passed: true, message: "OK" });
    checkParamsConsistencyMock
      .mockReturnValueOnce({ mismatches: [], passed: true, message: "一致", missingInfo: false, unverified: [] })
      .mockReturnValueOnce({ mismatches: [{ key: "max_perc_baseline", expected: 2, actual: 45 }], passed: false, message: "不一致", missingInfo: false, unverified: [] });

    await expect(pipeline.execute({ experimentId: pipeline.__experimentId, confirmed: true })).rejects.toThrow(/参数一致性校验失败/);
    const steps = runStepMock.mock.calls.map((c) => c[1]);
    expect(steps).toEqual(["cg", "interf", "inv1"]); // 在 inv1 处中断
  });

  it("参数一致性门：ignoreInconsistency=true 时即使不一致也继续跑完", async () => {
    checkConnectionGraphMock.mockReturnValue({ isolatedCount: 0, passed: true, message: "OK" });
    checkParamsConsistencyMock.mockReturnValue({ mismatches: [{ key: "x", expected: 1, actual: 2 }], passed: false, message: "不一致", missingInfo: false, unverified: [] });

    const out = await pipeline.execute({ experimentId: pipeline.__experimentId, ignoreInconsistency: true, confirmed: true });

    const steps = runStepMock.mock.calls.map((c) => c[1]);
    expect(steps).toEqual(["cg", "interf", "inv1", "inv2", "geocode"]);
    expect(out).toMatchObject({ ok: true });
  });

  it("B3 解耦：scriptsDir 定脚本根（config.env 目标+runStep），experimentDir 定数据根（resultRoot）", async () => {
    const expSettingsDir = mkdtempSync(join(tmpdir(), "insar-exp-"));
    const scriptSettingsDir = mkdtempSync(join(tmpdir(), "insar-scripts-"));
    checkConnectionGraphMock.mockReturnValue({ isolatedCount: 0, passed: true, message: "OK" });
    checkParamsConsistencyMock.mockReturnValue({ mismatches: [], passed: true, message: "一致", missingInfo: false, unverified: [] });
    const p = registerPipelineTool(dir, runStepMock, { experimentDir: expSettingsDir, scriptsDir: scriptSettingsDir });

    const out = await p.execute({ experimentId: p.__experimentId, confirmed: true });

    // config.env 写到脚本根（scriptsDir），而非实验目录/插件内置
    const [cfgTarget, envInput] = writeConfigEnvMock.mock.calls[0];
    expect(cfgTarget).toBe(scriptSettingsDir);
    expect(envInput.resultRoot).toBe(expSettingsDir); // 数据根用设置页 experimentDir（非 exp.dir）
    // 每步 runStep 的 overrides.scriptRoot 指向脚本根
    const roots = runStepMock.mock.calls.map((c) => c[2]?.scriptRoot);
    expect(roots.every((r: unknown) => r === scriptSettingsDir)).toBe(true);
    // 返回值同时暴露两个根
    expect(out).toMatchObject({ scriptRoot: scriptSettingsDir, experimentDir: expSettingsDir });
    rmSync(expSettingsDir, { recursive: true, force: true });
    rmSync(scriptSettingsDir, { recursive: true, force: true });
  });

  it("SUPER_REFERENCE：注册参数 params.superReference 非空时写入 config.env", async () => {
    const registry = createRegistry(join(dir, "registry-sr"));
    const id = registry.create({
      name: "sr-test", terrain: "desert", dir,
      dataDirs: { slc: "E:/slc", poeorb: "", gacos: "", dem: "" },
      params: { ...TEST_PARAMS, superReference: "E:/slc_out/sentinel1_999_20250101_010101_IW_D_VV_msc_slc_list" } as never,
      status: "draft",
    });
    checkConnectionGraphMock.mockReturnValue({ isolatedCount: 0, passed: true, message: "OK" });
    checkParamsConsistencyMock.mockReturnValue({ mismatches: [], passed: true, message: "一致", missingInfo: false, unverified: [] });
    const registered: Tool[] = [];
    registerTools({ tools: { register: (t: Tool) => registered.push(t) } } as never, {
      registry,
      settings: { get: () => ({ ...TEST_SETTINGS, scriptsDir: join(dir, "scripts") }) } as never,
      runStep: runStepMock as never,
    });
    const tool = registered.find((t) => t.name === "insar_pipeline")!;

    await tool.execute({ experimentId: id, confirmed: true });

    const [, envInput] = writeConfigEnvMock.mock.calls[0];
    expect(envInput.superReference).toBe("E:/slc_out/sentinel1_999_20250101_010101_IW_D_VV_msc_slc_list");
  });
});
