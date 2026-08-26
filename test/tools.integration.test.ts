import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// mock runPython：绝不真正调用 multi_download.py（下载是数小时级真实网络操作）
const { runPythonMock } = vi.hoisted(() => ({ runPythonMock: vi.fn() }));
vi.mock("../src/host/runner.js", () => ({ runPython: runPythonMock }));

import { registerTools } from "../src/host/tools.js";
import { resolveGuardLog } from "../src/host/tools.js";
import { createRegistry } from "../src/host/registry.js";

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

function registerIntoFakeCtx(dir: string): Tool {
  const registry = createRegistry(join(dir, "registry"));
  const registered: Tool[] = [];
  const ctx: any = { tools: { register: (t: Tool) => registered.push(t) } };
  registerTools(ctx, { registry });
  const insarRun = registered.find((t) => t.name === "insar_run");
  if (!insarRun) throw new Error("insar_run not registered");
  return insarRun;
}

describe("insar_run → multi_download.py 真实 CLI 参数构造", () => {
  let dir: string;
  let insarRun: Tool;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "insar-tools-"));
    runPythonMock.mockReset();
    runPythonMock.mockResolvedValue({ exitCode: 0, stdout: "downloaded", stderr: "" });
    insarRun = registerIntoFakeCtx(dir);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("搜索路径：--aoi/--start/--end/--pol/--out 完整映射，cwd=scriptDir", async () => {
    const out = await insarRun.execute({
      scriptDir: "D:\\skill\\scripts",
      aoi: "C:\\aoi\\minqin.shp",
      start: "20240101",
      end: "20240630",
      pol: "VV+VH,VV",
      out: "G:\\s1",
    });
    expect(runPythonMock).toHaveBeenCalledTimes(1);
    expect(runPythonMock).toHaveBeenCalledWith(
      "python",
      [
        "multi_download.py",
        "--aoi", "C:\\aoi\\minqin.shp",
        "--start", "20240101",
        "--end", "20240630",
        "--pol", "VV+VH,VV",
        "--out", "G:\\s1",
      ],
      "D:\\skill\\scripts",
    );
    expect(out).toMatchObject({ ok: true });
  });

  it("清单路径：--list 映射（优先于搜索路径），cwd=scriptDir", async () => {
    await insarRun.execute({
      scriptDir: "D:\\skill\\scripts",
      list: "C:\\manifest.csv",
      pol: "VV",
      out: "G:\\s1",
    });
    expect(runPythonMock).toHaveBeenCalledWith(
      "python",
      ["multi_download.py", "--list", "C:\\manifest.csv", "--pol", "VV", "--out", "G:\\s1"],
      "D:\\skill\\scripts",
    );
  });

  it("未提供 list 且缺少 aoi/start/end 时抛错，不调用 runner", async () => {
    await expect(insarRun.execute({ scriptDir: "D:\\skill\\scripts" })).rejects.toThrow(/list|aoi/);
    expect(runPythonMock).not.toHaveBeenCalled();
  });

  it("exitCode !== 0 时抛 insar_run failed", async () => {
    runPythonMock.mockResolvedValue({ exitCode: 2, stdout: "", stderr: "usage error" });
    await expect(insarRun.execute({
      scriptDir: "D:\\skill\\scripts",
      aoi: "a.shp",
      start: "20240101",
      end: "20240201",
    })).rejects.toThrow(/insar_run failed/);
  });
});

describe("insar_settings → 返回 resolve 后的设置值（含路径探测结果）", () => {
  function registerSettingsTool(dir: string, settingsValues?: Record<string, string>): Tool {
    const registry = createRegistry(join(dir, "registry"));
    const registered: Tool[] = [];
    const ctx: any = { tools: { register: (t: Tool) => registered.push(t) } };
    registerTools(ctx, {
      registry,
      settings: settingsValues ? { get: () => settingsValues } : undefined,
    });
    const t = registered.find((x) => x.name === "insar_settings");
    if (!t) throw new Error("insar_settings not registered");
    return t;
  }

  it("无 settings 服务时返回全空（不抛错）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "insar-settings-"));
    const t = registerSettingsTool(dir);
    const out = await t.execute({});
    expect(out).toMatchObject({ earthdataUser: "", enviIdl: "" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("有 settings 时返回探测后的值（enviIdl/sarscapeLib 非空）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "insar-settings-"));
    const t = registerSettingsTool(dir, {
      earthdataUser: "demo@earthdata",
      enviIdl: "C:\\Program Files\\Harris\\ENVI56\\IDL88\\bin\\bin.x86_64\\envi_idl.exe",
      sarscapeLib: "C:\\Program Files\\SARMAP SA\\SARscape",
      poeorbDir: "",
    });
    const out = await t.execute({}) as Record<string, string>;
    expect(out.earthdataUser).toBe("demo@earthdata");
    expect(out.enviIdl).toMatch(/envi_idl\.exe$/);
    expect(out.sarscapeLib).toMatch(/sarscape$/i);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("insar_experiment → step→bat 映射 + 默认 experiment 目录定位", () => {
  function registerExperimentTool(dir: string): Tool {
    const registry = createRegistry(join(dir, "registry"));
    const registered: Tool[] = [];
    const ctx: any = { tools: { register: (t: Tool) => registered.push(t) } };
    registerTools(ctx, { registry });
    const t = registered.find((x) => x.name === "insar_experiment");
    if (!t) throw new Error("insar_experiment not registered");
    return t;
  }

  it("step 键映射到正确的 bat（经错误消息中的路径验证）", async () => {
    // 指向一个不含 bat 的临时目录，但注册实验目录存在；execute 应抛 no batch 且路径含 stepToBat 结果
    const dir = mkdtempSync(join(tmpdir(), "insar-exp-"));
    const registry = createRegistry(join(dir, "registry"));
    const expDir = join(dir, "exp");
    mkdirSync(expDir, { recursive: true });
    const id = registry.create({
      name: "test", terrain: "desert" as never, dir: expDir,
      dataDirs: { slc: "", poeorb: "", gacos: "", dem: "" },
      params: {} as never, status: "draft",
    });
    process.env.INSAR_GENIE_EXPERIMENT = join(dir, "no-bat-here");
    const registered: Tool[] = [];
    const ctx: any = { tools: { register: (t: Tool) => registered.push(t) } };
    registerTools(ctx, { registry });
    const t = registered.find((x) => x.name === "insar_experiment")!;
    // interf → 02_interferogram/run_interf.bat
    await expect(t.execute({ experimentId: id, step: "interf" })).rejects.toThrow(
      /02_interferogram.*run_interf\.bat|run_interf\.bat/,
    );
    delete process.env.INSAR_GENIE_EXPERIMENT;
    rmSync(dir, { recursive: true, force: true });
  });

  it("未知 step 抛错（不静默）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "insar-exp-"));
    const registry = createRegistry(join(dir, "registry"));
    const id = registry.create({ name: "t", terrain: "desert" as never, dir: dir, dataDirs: { slc: "", poeorb: "", gacos: "", dem: "" }, params: {} as never, status: "draft" });
    process.env.INSAR_GENIE_EXPERIMENT = dir;
    const registered: Tool[] = [];
    const ctx: any = { tools: { register: (t: Tool) => registered.push(t) } };
    registerTools(ctx, { registry });
    const t = registered.find((x) => x.name === "insar_experiment")!;
    await expect(t.execute({ experimentId: id, step: "bogus" })).rejects.toThrow(/unknown step/);
    delete process.env.INSAR_GENIE_EXPERIMENT;
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("resolveGuardLog → guardDir 优先定位 guard 日志", () => {
  it("实验记录的 guardDir 优先命中（不依赖猜测）", () => {
    const dir = mkdtempSync(join(tmpdir(), "insar-guard-"));
    const guardDir = join(dir, "asf_experiment");
    mkdirSync(guardDir, { recursive: true });
    writeFileSync(join(guardDir, "sbas_guard.log"), "[2026] 1/2");
    const exp = { id: "x", name: "t", terrain: "desert", dir: join(dir, "exp"), dataDirs: { slc: "", poeorb: "", gacos: "", dem: "" }, guardDir, params: {} as never, status: "draft" };
    expect(resolveGuardLog(exp as never)).toBe(join(guardDir, "sbas_guard.log"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("guardDir 指向无日志时回退到实验目录下 asf_experiment 探测", () => {
    const dir = mkdtempSync(join(tmpdir(), "insar-guard-"));
    // 在实验目录下放 discover 位置（exp/<dir>/asf_experiment/sbas_guard.log）
    const expDir = join(dir, "exp");
    const discoverDir = join(expDir, "asf_experiment");
    mkdirSync(discoverDir, { recursive: true });
    writeFileSync(join(discoverDir, "sbas_guard.log"), "[2026] 2/3");
    const exp = { id: "x", name: "t", terrain: "desert", dir: expDir, dataDirs: { slc: "", poeorb: "", gacos: "", dem: "" }, params: {} as never, status: "draft" };
    // guardDir 未设置，应回退到 exp/asf_experiment
    expect(resolveGuardLog(exp as never)).toBe(join(discoverDir, "sbas_guard.log"));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("insar_status → 真实 CG 目录布局下读 auxiliary.sml / step_performed", () => {
  function registerInsarStatus(dir: string): Tool {
    const registry = createRegistry(join(dir, "registry"));
    const registered: Tool[] = [];
    const ctx: any = { tools: { register: (t: Tool) => registered.push(t) } };
    registerTools(ctx, { registry });
    const t = registered.find((x) => x.name === "insar_status");
    if (!t) throw new Error("insar_status not registered");
    const id = registry.create({
      name: "demo", terrain: "desert", dir: join(dir, "exp"),
      dataDirs: { slc: "", poeorb: "", gacos: "", dem: "" },
      params: { maxPercBaseline: 2 } as never, status: "running",
    });
    return { ...t, experimentId: id } as never;
  }

  it("辅助文件在 CG_*_SBAS_processing/ 下时能读到（此前读 exp.dir 死路径失败）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "insar-status-"));
    const cgDir = join(dir, "exp", "CG_demo_SBAS_processing");
    mkdirSync(join(cgDir, "work"), { recursive: true });
    writeFileSync(join(cgDir, "auxiliary.sml"), '<sml><generate_connection_graph>OK</generate_connection_graph><interf_stack>NotOK</interf_stack></sml>');
    writeFileSync(join(cgDir, "work", "sbas_step_performed.sml"), '<sml><pair_list><MatrixInteger NumberOfRows = "10" NumberOfColumns = "3"><MatrixRowInteger ID = "0"><ValueInteger ID = "2">1</ValueInteger></MatrixRowInteger></MatrixInteger></pair_list></sml>');
    const t = registerInsarStatus(dir);
    const out = await t.execute({ experimentId: t.experimentId });
    const status = out as { step: string; stepIndex: number; totalPairs: number; donePairs: number };
    expect(status.step).toBe("interf_stack");
    expect(status.stepIndex).toBe(1);
    expect(status.totalPairs).toBe(10);
    rmSync(dir, { recursive: true, force: true });
  });

  it("auxiliary.sml 缺失时返回结构化 error（不再凭空报进度）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "insar-status-"));
    const t = registerInsarStatus(dir);
    const out = await t.execute({ experimentId: t.experimentId });
    const status = out as { error?: { code: string }; progressLabel: string };
    expect(status.error?.code).toBe("no-auxiliary");
    expect(status.progressLabel).toBe("无法读取进度文件");
    rmSync(dir, { recursive: true, force: true });
  });
});
