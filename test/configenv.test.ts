import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
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
    expect(env).toContain("SLC_POLARIZATION=ONLY_VV_POL");
  });

  it("config.env 行尾必须是 CRLF（cmd for/f 会吞 LF 行，SLC_DATA 值被截断）", () => {
    const env = buildConfigEnv(F("G:\\exp"));
    expect((env.match(/\r\n/g) || []).length).toBeGreaterThan(0);
    // 排除 \r\n 后不应有孤立 \n
    const stripped = env.replace(/\r\n/g, "");
    expect(stripped).not.toContain("\n");
  });

  it("B2：含基线字段 MAX_PERC_BASELINE / MAX_TIME_BASELINE（默认 2 / 180），可被覆盖", () => {
    const env = buildConfigEnv({ ...F("G:\\exp"), maxPercBaseline: 4, maxTimeBaselineDays: 90 });
    expect(env).toContain("MAX_PERC_BASELINE=4");
    expect(env).toContain("MAX_TIME_BASELINE=90");
    // 缺省时回退 2 / 180（bat 的 if not defined 兜底 + 生成时默认）
    const env2 = buildConfigEnv(F("G:\\exp"));
    expect(env2).toContain("MAX_PERC_BASELINE=2");
    expect(env2).toContain("MAX_TIME_BASELINE=180");
  });

  it("SUPER_REFERENCE：写入 config.env（空 = bat 内置兑底；非空 = 自定义超参考）", () => {
    const env2 = buildConfigEnv(F("G:\\exp"));
    expect(env2).toContain("SUPER_REFERENCE="); // 空 → cmd 视为未定义，bat 走 if not defined 兑底
    const env3 = buildConfigEnv({ ...F("G:\\exp"), superReference: "E:/slc/sentinel1_999_msc_slc_list" });
    expect(env3).toContain("SUPER_REFERENCE=E:/slc/sentinel1_999_msc_slc_list");
  });
});

describe("writeConfigEnv", () => {
  it("写入 config.env 到实验目录（resultRoot 根下）", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const expDir = join(dir, "exp");
    const written = writeConfigEnv(expDir, F(expDir));
    const txt = readFileSync(join(expDir, "config.env"), "utf8");
    expect(txt).toContain("WORK_DIR=");
    expect(written).toBe(join(expDir, "config.env"));
    rmSync(dir, { recursive: true, force: true });
  });
});
