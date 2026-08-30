import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { getTemplate, validateBaseline } from "./templates.js";
import { computeStatus } from "./status.js";
import { runPython } from "./runner.js";
import { resolveScriptsDir, resolveExperimentDir, hasBundledScripts, resolveCgDir } from "./paths.js";
import { writeConfigEnv } from "./configenv.js";
import { checkConnectionGraph, checkParamsConsistency, buildParamsSnapshot, buildPipelineCards } from "./pipeline.js";
import { withAuxiliary } from "./probe.js";
/** 各步 → PARAMETERS_INFO_<MODULE>_CMD_*.xml 的模块匹配段（latestParamsInfo 用 includes(moduleKey)）。 */
export const STEP_MODULE_KEY = {
    cg: "INSAR_STACK_SBAS_GENERATE_CONNECTION_GRAPH",
    interf: "INSAR_STACK_SBAS_INTERFEROGRAM_GENERATION",
    inv1: "INSAR_STACK_SBAS_INVERSION",
    inv2: "INSAR_STACK_SBAS_INVERSION",
    geocode: "INSAR_STACK_SBAS_GEOCODE",
};
/** 通用输出：宽松 object schema + JSON 文本渲染（同 dsh-tool-goal 的 GOAL_OUTPUT） */
const JSON_OUTPUT = {
    schema: { type: "object", additionalProperties: true },
    render: (_args, value) => [{
            type: "text",
            text: JSON.stringify(value) ?? "",
        }],
};
/**
 * 注册三个工具到 host tools 注册表。
 * 依赖：ctx.tools（host 工具运行时）、registry。
 */
export function registerTools(ctx, deps) {
    ctx.tools.register(defineTool({
        name: "insar_run",
        description: "Run the ASF Sentinel-1 SLC downloader (bundled scripts/multi_download.py) with the given download inputs. Synchronous await: the download runs to completion — hours for large AOIs — so do not expect an immediate return. Provide either a manifest CSV (list) or an AOI + time range (aoi/start/end); pass pol/out to control polarization and destination. scriptDir is optional: defaults to the plugin's bundled scripts directory (auto-installed).",
        parameters: {
            scriptDir: { type: "string", description: "Optional. Directory containing multi_download.py. Defaults to the plugin's bundled scripts dir (installed with the plugin). Override with INSAR_GENIE_SCRIPTS env or this arg. Only pass a trusted path." },
            list: { type: "string", description: "Manifest CSV path (columns: date,frame,orbit,satellite,file). List-driven path; takes precedence over aoi/start/end." },
            aoi: { type: "string", description: "AOI shapefile/kml path. Search-driven path; requires start and end." },
            start: { type: "string", description: "Start date YYYYMMDD (search-driven path)." },
            end: { type: "string", description: "End date YYYYMMDD (search-driven path)." },
            pol: { type: "string", description: "Polarization(s), comma-separated, e.g. 'VV+VH,VV'. Defaults to 'VV+VH,VV'." },
            out: { type: "string", description: "Download output directory. Defaults to '<scriptDir>/sentinel1_data'." },
            pythonBin: { type: "string", description: "Python executable path. Defaults to 'python'. Only pass a trusted interpreter path." },
        },
        output: JSON_OUTPUT,
        async execute(input) {
            // 脚本目录：显式传值 > 环境变量 > 插件内置 assets/scripts（开箱即用）。
            // 注意：显式/环境变量 override 直接采用（即使当前不存在也作为 cwd 传给 runner——
            // 下载脚本路径由用户负责；仅当完全未提供且内置缺失时才报错）。
            const scriptDir = resolveScriptsDir(input.scriptDir);
            if (!input.scriptDir && !process.env.INSAR_GENIE_SCRIPTS && !hasBundledScripts()) {
                throw new Error("insar_run: multi_download.py not found. Pass scriptDir or set INSAR_GENIE_SCRIPTS.");
            }
            const args = ["multi_download.py"];
            if (input.list) {
                // 清单驱动（与 multi_download.py 的 "list 优先于搜索路径" 语义一致）
                args.push("--list", input.list);
            }
            else {
                if (!input.aoi || !input.start || !input.end) {
                    throw new Error("insar_run: provide either list (manifest CSV) or aoi + start + end (search-driven download)");
                }
                args.push("--aoi", input.aoi, "--start", input.start, "--end", input.end);
            }
            if (input.pol)
                args.push("--pol", input.pol);
            if (input.out)
                args.push("--out", input.out);
            // 同步 await：数小时级下载，不设超时（runPython timeoutMs 缺省为 undefined）
            const result = await runPython(input.pythonBin ?? "python", args, scriptDir);
            if (result.exitCode !== 0) {
                throw new Error(`insar_run failed: ${result.stderr}`);
            }
            return { ok: true, args, scriptDir, stdout: result.stdout };
        },
    }));
    ctx.tools.register(defineTool({
        name: "insar_import_bulk",
        description: "SLC 批量导入驱动 —— 按清单【时相(日期)】分组,每组调一次 ImportSentinel1Format。D11/D13 修复: 原 import_slc 步骤 file_search 抓目录全部 zip 无条件拼接,会把不同时相混拼;本工具按日期分组、同轨校验,组内(单帧或双帧)一起导入,由 SARscape 自动决定拼接(双帧→msc_slc_list 拼接,单帧→slc_list)。输出每个时相独立产物 + 断点续跑(跳过已完成时相)。参数: list=清单CSV, slcDir=zip目录, out=输出目录, aoi=研究区shp(可选,裁剪burst), pol=极化, onlyDate=只跑某天, skip=跳过前N时相。",
        parameters: {
            scriptDir: { type: "string", description: "Optional. Directory containing import_slc_bulk.py. Defaults to bundled assets/scripts." },
            list: { type: "string", required: true, description: "Manifest CSV (columns: date,frame,orbit,satellite,file)." },
            slcDir: { type: "string", required: true, description: "Directory containing SLC zip files." },
            out: { type: "string", required: true, description: "Import output directory." },
            aoi: { type: "string", description: "AOI shapefile (WGS84) — bursts clipped (optional)." },
            pol: { type: "string", description: "Polarization. Defaults 'ONLY_VV_POL'." },
            skip: { type: "number", description: "Skip first N dates (resume)." },
            max: { type: "number", description: "Max dates to process (0=all)." },
            onlyDate: { type: "string", description: "Process only this date YYYYMMDD." },
            pythonBin: { type: "string", description: "Python executable. Defaults 'python'." },
        },
        output: JSON_OUTPUT,
        async execute(input) {
            const scriptDir = resolveScriptsDir(input.scriptDir);
            if (!input.scriptDir && !process.env.INSAR_GENIE_SCRIPTS && !hasBundledScripts()) {
                throw new Error("insar_import_bulk: import_slc_bulk.py not found. Pass scriptDir or set INSAR_GENIE_SCRIPTS.");
            }
            const args = ["import_slc_bulk.py",
                "--list", input.list,
                "--slc-dir", input.slcDir,
                "--out", input.out,
            ];
            if (input.aoi) {
                args.push("--aoi", input.aoi);
            }
            if (input.pol) {
                args.push("--pol", input.pol);
            }
            if (input.skip != null) {
                args.push("--skip", String(input.skip));
            }
            if (input.max != null) {
                args.push("--max", String(input.max));
            }
            if (input.onlyDate) {
                args.push("--only-date", input.onlyDate);
            }
            const result = await runPython(input.pythonBin ?? "python", args, scriptDir);
            if (result.exitCode !== 0) {
                throw new Error(`insar_import_bulk failed (exit ${result.exitCode}): ${result.stderr}`);
            }
            return { ok: true, args, scriptDir, stdout: result.stdout };
        },
    }));
    ctx.tools.register(defineTool({
        name: "insar_status",
        description: "Read an experiment's current SBAS progress (connection graph → geocoding) from its status files.",
        parameters: {
            experimentId: { type: "string", required: true, description: "Experiment id from the registry." },
        },
        output: JSON_OUTPUT,
        execute(input) {
            const exp = deps.registry.get(input.experimentId);
            if (!exp)
                throw new Error(`experiment not found: ${input.experimentId}`);
            // 真实布局：auxiliary.sml / sbas_step_performed.sml 在 CG 目录（<数据根>/CG_*_SBAS_processing/）下，
            // 由 resolveCgDir 探测（settings.experimentDir 优先，回退 exp.dir 扫描 CG_*）。
            const s = deps.settings?.get();
            const cgDir = resolveCgDir(exp.dir, s?.experimentDir);
            const auxXml = readFileSafe(join(cgDir, "auxiliary.sml"), "");
            // SARscape 配对进度文件：sbas_step_performed.sml（CG 目录根的 work/ 或根下；fixture 名 step_performed.sml 兼容）
            const stepCandidates = [
                join(cgDir, "work", "sbas_step_performed.sml"),
                join(cgDir, "sbas_step_performed.sml"),
                join(cgDir, "work", "work_step_performed.sml"),
                join(cgDir, "work_step_performed.sml"),
                join(cgDir, "work", "step_performed.sml"),
                join(cgDir, "step_performed.sml"),
            ];
            const stepXml = readFileSafe(stepCandidates.find((p) => existsSync(p)) ?? join(cgDir, "work", "work_step_performed.sml"), "");
            // guard 日志：探测候选路径（真实布局 guard 日志在 workDir/asf_experiment，不在实验目录附近）
            const guardLog = readFileSafe(resolveGuardLog(exp), "");
            // 注：status.ts 的参数名是 stepPerformedXml（简报原文 stepXml 与现有代码不一致，已适配）
            return Promise.resolve(computeStatus({ auxXml, stepPerformedXml: stepXml, guardLog, maxPercBaseline: exp.params?.maxPercBaseline }));
        },
    }));
    ctx.tools.register(defineTool({
        name: "insar_templates",
        description: "Return a terrain parameter template (mining/landslide/urban/desert/loess) or the terrain list.",
        parameters: {
            terrain: { type: "string", description: "Terrain type; omit to list all." },
        },
        output: JSON_OUTPUT,
        execute(input) {
            if (input.terrain) {
                // 注：getTemplate 返回 interface ExperimentParams，无隐式索引签名，故 as never 适配 Record<string, JsonValue>
                return Promise.resolve(getTemplate(input.terrain));
            }
            return Promise.resolve({
                terrains: ["mining", "landslide", "urban", "desert", "loess"],
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: "insar_register",
        description: "Register a new experiment in the registry (ProgressPanel's experiment list / insar_status need an entry). Creates the record and returns its id.",
        parameters: {
            name: { type: "string", required: true, description: "Experiment display name, e.g. 'minqin1'." },
            terrain: { type: "string", required: true, description: "Terrain type: mining|landslide|urban|desert|loess." },
            dir: { type: "string", required: true, description: "Experiment root directory (e.g. G:\\minqin1_SBAS_processing)." },
            slcDir: { type: "string", description: "SLC data directory." },
            poeorbDir: { type: "string", description: "Precise orbit (POEORB) directory." },
            gacosDir: { type: "string", description: "GACOS atmospheric delay directory." },
            demDir: { type: "string", description: "DEM directory." },
            guardDir: { type: "string", description: "Guard log directory (default <dir>/asf_experiment; set when the log lives elsewhere, e.g. workDir/asf_experiment)." },
            params: { type: "object", additionalProperties: true, description: "Experiment parameter snapshot (ExperimentParams shape)." },
        },
        output: JSON_OUTPUT,
        execute(input) {
            // 防呆：写入注册表前校验空间基线必须在 2-4%，杜绝 45% 事故
            if (input.params?.maxPercBaseline !== undefined) {
                const gate = validateBaseline(input.params.maxPercBaseline);
                if (!gate.ok) {
                    throw new Error(`insar_register: ${gate.message}`);
                }
            }
            const id = deps.registry.create({
                name: input.name,
                terrain: input.terrain,
                dir: input.dir,
                dataDirs: {
                    slc: input.slcDir ?? "",
                    poeorb: input.poeorbDir ?? "",
                    gacos: input.gacosDir ?? "",
                    dem: input.demDir ?? "",
                },
                guardDir: input.guardDir,
                params: input.params,
                status: "draft",
            });
            return Promise.resolve({ ok: true, experimentId: id });
        },
    }));
    ctx.tools.register(defineTool({
        name: "insar_list",
        description: "List registered experiments (id/name/terrain/status). ProgressPanel's experiment selector uses this.",
        parameters: {
            _unused: { type: "string", description: "Unused; kept to satisfy schema." },
        },
        output: JSON_OUTPUT,
        execute() {
            return Promise.resolve({
                experiments: deps.registry.list().map((e) => ({
                    id: e.id,
                    name: e.name,
                    terrain: e.terrain,
                    status: e.status,
                    dir: e.dir,
                })),
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: "insar_experiment",
        description: "Run one SBAS processing step (SARscape batch) for an experiment by step key. The batch script lives in the plugin's bundled experiment/bat/<step>/ directory (auto-installed); the working dir is the experiment's own directory. Steps: import_slc / cg / interf / dem / gacos_bulk / gacos_import / inv1 / inv2 / geocode.",
        parameters: {
            experimentId: { type: "string", required: true, description: "Experiment id from the registry (its dir is the working directory)." },
            step: { type: "string", required: true, description: "Step key. One of: import_slc, cg, interf, dem, gacos_bulk, gacos_import, inv1, inv2, geocode." },
            experimentDir: { type: "string", description: "Optional override. Defaults to the experiment's registered dir. Override with INSAR_GENIE_EXPERIMENT env or this arg." },
            timeoutMs: { type: "number", description: "Optional timeout in ms for the batch run; defaults to no timeout (long SARscape steps)." },
        },
        output: JSON_OUTPUT,
        execute(input) {
            const exp = deps.registry.get(input.experimentId);
            if (!exp)
                throw new Error(`experiment not found: ${input.experimentId}`);
            const experimentRoot = resolveExperimentDir(input.experimentDir);
            const batName = stepToBat(input.step);
            const batPath = join(experimentRoot, "bat", batName);
            if (!existsSync(batPath)) {
                throw new Error(`insar_experiment: no batch for step '${input.step}' (looked at ${batPath})`);
            }
            return runBatch(batPath, exp.dir, input.timeoutMs).then((r) => {
                if (r.exitCode !== 0) {
                    throw new Error(`insar_experiment failed (${input.step}, exit ${r.exitCode}): ${r.stderr}`);
                }
                return { ok: true, step: input.step, bat: batName, experimentDir: exp.dir, stdout: r.stdout };
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: "insar_settings",
        description: "Read the resolved insar-genie settings (credentials/paths after startup path probing). Returns the effective values; ENVI IDL + SARscape paths are auto-detected at plugin startup unless manually overridden.",
        parameters: {
            _unused: { type: "string", description: "Unused; kept to satisfy schema." },
        },
        output: JSON_OUTPUT,
        execute() {
            const s = deps.settings?.get();
            return Promise.resolve({
                earthdataUser: s?.earthdataUser ?? "",
                earthdataPassword: s?.earthdataPassword ?? "",
                gacosEmail: s?.gacosEmail ?? "",
                gacosImapAuthCode: s?.gacosImapAuthCode ?? "",
                enviIdl: s?.enviIdl ?? "",
                sarscapeLib: s?.sarscapeLib ?? "",
                workDir: s?.workDir ?? "",
                poeorbDir: s?.poeorbDir ?? "",
                experimentDir: s?.experimentDir ?? "",
            });
        },
    }));
    ctx.tools.register(defineTool({
        name: "insar_pipeline",
        description: "Run the full SBAS processing pipeline for an experiment. Phase 1 (default, confirmMode='manual' or unset): generate config.env + the 5-card param confirmation (pipeline.cards) and return without executing — the user confirms each card then re-calls with confirmed=true. Phase 2 (confirmed=true or confirmMode='auto'): execute connection graph (with baseline-widening gate), interferogram+unwrapping, inversion step1, step2, geocoding; every step verifies the run params match the confirmed snapshot (PARAMETERS_INFO consistency gate; aborts on mismatch unless ignoreInconsistency). Requires ENVI/SARscape.",
        parameters: {
            experimentId: { type: "string", required: true, description: "Experiment id from the registry." },
            confirmMode: { type: "string", description: "'manual' (default) returns pipeline.cards for user confirmation (B1 confirm-then-run). 'auto' skips confirmation and runs directly with template recommended values (still enforces 2% baseline iron rule)." },
            confirmed: { type: "boolean", description: "Phase 2 flag: true executes the pipeline after the user confirmed the cards; false/omitted returns the confirm cards (B1)." },
            ignoreInconsistency: { type: "boolean", description: "If true, proceed despite a PARAMETERS_INFO mismatch (default false = abort on mismatch)." },
            paramOverrides: { type: "string", description: "(D2) JSON string of user-edited card values from the confirm UI, e.g. '{\"MAX_PERC_BASELINE\":\"4\",\"MAX_TIME_BASELINE\":\"120\"}'. Applied to config.env before execution. AI parses and passes these when user modified fields on the cards." },
        },
        output: JSON_OUTPUT,
        async execute(input) {
            const exp = deps.registry.get(input.experimentId);
            if (!exp)
                throw new Error(`experiment not found: ${input.experimentId}`);
            const s = deps.settings?.get();
            if (!s)
                throw new Error("insar_pipeline: settings not configured (ASF/ENVI/SARscape paths)");
            // B3 解耦：脚本根始终自动（插件内置 assets/experiment，env INSAR_GENIE_EXPERIMENT 可覆盖；
            // 不读设置——用户无需配置脚本位置），实验结果存放目录（experimentDir，空=exp.dir）分管数据。
            // config.env 写到脚本根（bat 用 %~dp0..\..\config.env 在脚本根找它）；数据全靠 config.env 里的绝对路径。
            const expDataDir = s.experimentDir && s.experimentDir.trim() ? s.experimentDir : exp.dir;
            const scriptRoot = resolveExperimentDir();
            const tmpDir = join(expDataDir, "tmp");
            // (D2) 应用用户修改的卡片值(paramOverrides JSON 字符串)到 config.env 关键字段
            // 支持: MAX_PERC_BASELINE / MIN_PERC_BASELINE / MAX_TIME_BASELINE / MIN_TIME_BASELINE(数值)
            let ov = {};
            if (input.paramOverrides) {
                try {
                    const parsed = JSON.parse(input.paramOverrides);
                    if (parsed && typeof parsed === "object")
                        ov = parsed;
                }
                catch {
                    /* 非法 JSON 忽略,走默认 */
                }
            }
            const ovNum = (k) => {
                const v = ov[k];
                if (v === undefined || v === "")
                    return undefined;
                const n = Number(v);
                return Number.isFinite(n) ? n : undefined;
            };
            const ovMaxPerc = ovNum("MAX_PERC_BASELINE");
            const ovMaxTime = ovNum("MAX_TIME_BASELINE");
            // 基线防呆: 用户改的 MAX_PERC_BASELINE 也必须落在 2-4% 铁律区间(与 buildPipelineCards 一致)
            const clampedPerc = ovMaxPerc !== undefined
                ? Math.min(4, Math.max(0, ovMaxPerc))
                : (exp.params?.maxPercBaseline ?? 2);
            const baseEnv = {
                workDir: s.workDir,
                resultRoot: expDataDir,
                tmpDir,
                slcData: exp.dataDirs.slc || join(s.workDir, "slc"),
                demFinal: exp.dataDirs.dem || "",
                enviIdl: s.enviIdl,
                // D5: 统一规范化到 auxiliary 级（用户手填 SARscape 根或缺 \auxiliary 时,config.env 直接可用）
                sarscapeLib: withAuxiliary(s.sarscapeLib),
                gacosList: join(expDataDir, "gacos_list.txt"),
                sarModules: join(expDataDir, "sar_modules.txt"),
                maxPercBaseline: clampedPerc,
                maxTimeBaselineDays: ovMaxTime ?? (exp.params?.maxTimeBaselineDays ?? 180),
                superReference: exp.params?.superReference ?? "",
            };
            // 先写一次 config.env 到脚本根（无论确认与否都生成）。
            writeConfigEnv(scriptRoot, baseEnv);
            const confirmMode = input.confirmMode ?? "manual";
            const confirmed = input.confirmed === true || confirmMode === "auto";
            // B1 阶段 1（确认后跑）：默认返回 5 卡供用户确认，不执行。
            if (!confirmed) {
                const cards = buildPipelineCards({ terrain: exp.terrain, params: exp.params });
                return Promise.resolve({
                    ok: true,
                    needsConfirm: true,
                    experimentId: exp.id,
                    scriptRoot,
                    experimentDir: expDataDir,
                    configEnv: baseEnv,
                    pipeline: { cards },
                    note: "Phase 1: cards generated for user confirmation (B1). Re-call with confirmed=true (or confirmMode='auto') to run.",
                });
            }
            const runStep = deps.runStep ?? defaultRunStep;
            const writeBaselineEnv = (baseline) => {
                writeConfigEnv(scriptRoot, {
                    ...baseEnv,
                    maxPercBaseline: baseline,
                });
            };
            // ② 连接图 + 校验门（孤立景数>4 → 从 2% 扩到 4% 重跑，铁律上限 4%，最多 3 次）。
            // (D2) 初始基线用 override 后的 clampedPerc（用户改的 MAX_PERC_BASELINE 生效）
            let maxPercBaseline = clampedPerc;
            let cgCheck = {
                isolatedCount: 0,
                passed: false,
                missingInfo: false,
                message: "连接图未运行",
            };
            for (let attempt = 0; attempt < 3; attempt++) {
                // B2: 先把当前基线写进 config.env（bat 读 %MAX_PERC_BASELINE%），确保扩基线真正生效。
                writeBaselineEnv(maxPercBaseline);
                await runStep(exp, "cg", { maxPercBaseline, scriptRoot });
                // CG_report 在实验结果存放目录（RESULT_ROOT）下的 CG_*_SBAS_processing/connection_graph/
                cgCheck = checkConnectionGraph(expDataDir, expDataDir);
                if (cgCheck.passed)
                    break;
                if (cgCheck.missingInfo)
                    break; // 报告缺失不可重试，留给上层报错
                if (maxPercBaseline >= 4)
                    break; // 铁律 2-4%，已到上限仍不合格
                maxPercBaseline = 4;
            }
            if (!cgCheck.passed) {
                throw new Error(`insar_pipeline: 连接图校验门未过（${cgCheck.message}）`);
            }
            // 最终基线回写注册表
            deps.registry.update(exp.id, { params: { ...exp.params, maxPercBaseline } });
            // 参数快照必须在扩基线之后构建：snapshot 需反映实际运行的基线（maxPercBaseline，可能是 2 或 4），
            // 否则扩基线后 PARAMETERS_INFO 记录的实际基线(4) vs 快照(2) 会误报不一致（B2 重要发现修复）。
            const snapshot = buildParamsSnapshot({ ...exp.params, maxPercBaseline });
            // ③ 依次跑 interf/inv1/inv2/geocode，每步后参数一致性校验门。
            const steps = [
                { step: "interf", moduleKey: STEP_MODULE_KEY.interf },
                { step: "inv1", moduleKey: STEP_MODULE_KEY.inv1 },
                { step: "inv2", moduleKey: STEP_MODULE_KEY.inv2 },
                { step: "geocode", moduleKey: STEP_MODULE_KEY.geocode },
            ];
            const paramsInfoDir = join(tmpDir, "work"); // SKILL.md: PARAMETERS_INFO 落盘于 <tmp>/work
            const stepResults = [
                { step: "cg", ok: cgCheck.passed },
            ];
            for (const { step, moduleKey } of steps) {
                await runStep(exp, step, { scriptRoot });
                const check = checkParamsConsistency(paramsInfoDir, snapshot, moduleKey);
                if (!check.passed && !input.ignoreInconsistency) {
                    throw new Error(`insar_pipeline: 步骤 ${step} 参数一致性校验失败（${check.message}）；传 ignoreInconsistency=true 可跳过`);
                }
                stepResults.push({ step, ok: check.passed, unverified: check.unverified, missingInfo: check.missingInfo });
            }
            return Promise.resolve({
                ok: true,
                experimentId: exp.id,
                // B2 一致：configEnv 反映扩基线后的实际基线（非初始 baseEnv 的 2）
                configEnv: { ...baseEnv, maxPercBaseline },
                scriptRoot,
                experimentDir: expDataDir,
                baseline: { maxPercBaseline },
                steps: stepResults,
                note: "pipeline orchestration driver; step execution via runStep (default runs the SARscape bat)",
            });
        },
    }));
}
/** step 键 → bat 文件名（对应插件内置 experiment/bat/<子目录>/<bat>） */
function stepToBat(step) {
    const map = {
        import_slc: join("00_import", "run_import_slc.bat"),
        cg: join("01_connection_graph", "run_cg_final.bat"),
        interf: join("02_interferogram", "run_interf.bat"),
        dem: join("03_data_prep", "run_dem.bat"),
        gacos_bulk: join("03_data_prep", "run_gacos_bulk.bat"),
        gacos_import: join("03_data_prep", "run_gacos_import.bat"),
        inv1: join("03_inversion", "run_inv1.bat"),
        inv2: join("03_inversion", "run_inv2.bat"),
        geocode: join("04_geocode", "run_geocode.bat"),
    };
    const hit = map[step];
    if (!hit)
        throw new Error(`unknown step '${step}' (valid: ${Object.keys(map).join(", ")})`);
    return hit;
}
/** 缺省 runStep：真实调用 SARscape 批处理（step 键 → bat 文件）。
 *  @param overrides.scriptRoot 脚本根（bat 树+config.env 的家，B3 解耦）；默认 resolveExperimentDir()（env/插件内置）。
 *  @param overrides.maxPercBaseline 已被 insar_pipeline 写进 config.env（bat 读 %MAX_PERC_BASELINE%），此处仅透传。 */
async function defaultRunStep(exp, step, overrides) {
    const experimentRoot = resolveExperimentDir(overrides?.scriptRoot || undefined);
    const batName = stepToBat(step);
    const batPath = join(experimentRoot, "bat", batName);
    if (!existsSync(batPath)) {
        throw new Error(`insar_pipeline: no batch for step '${step}' (looked at ${batPath})`);
    }
    const r = await runBatch(batPath, exp.dir);
    if (r.exitCode !== 0) {
        throw new Error(`insar_pipeline failed (${step}, exit ${r.exitCode}): ${r.stderr}`);
    }
    return { ok: true, step };
}
/** 执行 Windows batch（cmd /c），捕获输出（SARscape 步骤可能是长任务） */
function runBatch(batPath, cwd, timeoutMs) {
    return new Promise((resolve) => {
        const child = spawn("cmd", ["/c", batPath], { cwd, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        const cap = 64 * 1024;
        const push = (s, b) => (s + b.toString("utf8")).slice(-cap);
        child.stdout?.on("data", (b) => { stdout = push(stdout, b); });
        child.stderr?.on("data", (b) => { stderr = push(stderr, b); });
        const timer = timeoutMs !== undefined && timeoutMs > 0
            ? setTimeout(() => { child.kill("SIGTERM"); }, timeoutMs)
            : undefined;
        child.on("error", (e) => { if (timer)
            clearTimeout(timer); resolve({ exitCode: null, stdout, stderr: `${stderr}\n${String(e)}` }); });
        child.on("close", (code) => { if (timer)
            clearTimeout(timer); resolve({ exitCode: code, stdout, stderr }); });
    });
}
function readFileSafe(path, fallback) {
    try {
        return readFileSync(path, "utf8");
    }
    catch {
        return fallback;
    }
}
/**
 * 定位 guard 日志（sbas_guard.log）。
 * 真实布局：日志可能在 workDir/asf_experiment，与实验目录分离（如实验在 G:\，日志在 D:\work\data\asf_experiment）。
 * 优先级：
 *  1. 实验记录的 guardDir（注册/设置时显式指定——最可靠）
 *  2. 探测候选路径（实验目录 / 父级 / DSH_HOME 下的 asf_experiment）
 * 都不存在返回空串（调用方 readFileSafe 兜底）。
 */
export function resolveGuardLog(exp) {
    // 候选 0：实验记录显式指定的 guardDir（开箱即用的真实布局）
    if (exp.guardDir) {
        const explicit = join(exp.guardDir, "sbas_guard.log");
        if (existsSync(explicit))
            return explicit;
    }
    // 候选 1：实验目录自身下的 asf_experiment
    const self = join(exp.dir, "asf_experiment", "sbas_guard.log");
    if (existsSync(self))
        return self;
    // 候选 2：实验目录父级下的 asf_experiment
    const parent = join(exp.dir, "..", "asf_experiment", "sbas_guard.log");
    if (existsSync(parent))
        return parent;
    // 候选 3：DSH_HOME 下的 asf_experiment（sbas_guard.py 用 WORK_DIR，此处尽力探测）
    if (process.env.DSH_HOME) {
        const home = join(process.env.DSH_HOME, "asf_experiment", "sbas_guard.log");
        if (existsSync(home))
            return home;
    }
    return "";
}
