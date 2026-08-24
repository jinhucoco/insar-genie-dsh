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
