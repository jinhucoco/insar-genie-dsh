# insar-genie-dsh 开发与维护指南

> 面向**本插件开发者/维护者**。用户请阅读 [README.md](../README.md)。

## 工具内部实现（开发者视角）

| 工具 | 内部要点 |
|---|---|
| `insar_pipeline` | 脚本家=设置 `scriptsDir`（空=插件内置 assets/experiment）；数据根=`experimentDir`/exp.dir（B3 解耦）；扩基线时重写脚本根 config.env 确保 bat 读到 2%→4%（B2）|
| `insar_run` | 内置 `assets/scripts/multi_download.py`；`scriptDir` 可选，可用 `INSAR_GENIE_SCRIPTS` 环境变量或参数覆盖；--list 或 --aoi/--start/--end + --pol/--out |
| `insar_import_bulk` | 内置 `assets/scripts/import_slc_bulk.py`：按时相（日期）分组、同轨校验、双帧拼接（msc）/单帧不拼、断点续跑、AOI 裁剪（D11/D13）|
| `insar_experiment` | 内置 `assets/experiment/bat/<step>/<bat>`；step=import_slc/cg/interf/dem/gacos_bulk/gacos_import/inv1/inv2/geocode |
| `insar_status` | 解析 auxiliary.sml / step_performed.sml / guard 日志；进度与 ETA |
| `insar_settings` | 含启动探测的 ENVI/SARscape 路径（probe.ts）|

### insar_pipeline 三张强制校验门

1. **2% 空间基线铁律**：`MAX_PERC_BASELINE` 初始 2%（用户方法论，勿用 SARscape 默认 45%）。
2. **连接图校验门**：跑完 `CG_report.txt` 读孤立景数，**>4 → 自动扩基线 2%→4% 重跑**（上限 4%，最多 3 次），仍不合格则中断上报。
3. **参数一致性门**：每步后读 `tmp/*/work/PARAMETERS_INFO_*.xml` 实际落盘值 vs 参数快照，不一致即告警/中断（`ignoreInconsistency=true` 跳过）。

> 多视推导：用户只设 Grid Size（15/30m），`insar_pipeline` 按映射规则推导 RG/AZ Looks 并展示在确认卡。
> 参数快照在连接图扩基线确定最终 `maxPercBaseline` 之后构建（避免校验误报）。

## 脚本来源与同步（两仓约定）

插件 `assets/scripts` + `assets/experiment` 里的 Python/bat 脚本**来自技能仓库 `jinhucoco/insar-genie`**（`scripts/` + `experiment/`），是其在插件内的**发布副本**。

> ⚠️ **方向铁律**：脚本**唯一源头**在技能仓库 `jinhucoco/insar-genie`（dev 分支）。**必须先改技能仓库**，再用 `sync_assets.py --sync` **从技能仓库复制到插件 assets**。方向反了（改插件 assets → 复制到技能仓库）会导致两仓语义漂移。

正确改脚本流程：
1. 在技能仓库 `jinhucoco/insar-genie`（dev）改 `scripts/` / `experiment/` / `SKILL.md`
2. `git add -A && git commit && git push origin dev`（CI 的 sync 校验克隆的就是 dev）
3. 在插件仓库跑 `python scripts/sync_assets.py --skill-repo <技能仓库路径> --sync` 同步到 assets
4. `git add assets/ && git commit && git push origin main`

同步/校验（在插件 repo 根执行）：
```bash
python scripts/sync_assets.py --skill-repo <技能仓库路径>    # 校验：报告不一致/缺失，不改动
python scripts/sync_assets.py --skill-repo <技能仓库路径> --sync   # 同步：从技能仓库复制到 assets
```

> CI（`.github/workflows/test.yml`）在 push 到 main 时自动 clone 技能仓库并跑 sync 校验，防止两仓漂移。

**注意**：直接在插件仓库内改 `assets/` 下的脚本但不同步技能仓库，会在下次 sync/CI 被覆盖回去。**改一处必须同步全部副本（MD5 校验）**。

## 构建与测试

```bash
npm install
npm run build        # tsc host + tsdown client
npm test             # vitest（host/client 全部用例）
npm run typecheck:client
```

## 发布新版本

```bash
bash .release.sh patch      # bug 修复/文档 (0.1.0 → 0.1.1)
bash .release.sh minor      # 新功能/非 breaking (0.1.0 → 0.2.0)
bash .release.sh major      # breaking (→ 1.0.0)
bash .release.sh --dry-run  # 预览流程, 不实际发布
```

`.release.sh` 自动：校验两仓资产一致 → bump 版本 → `npm run build` → `npm publish --access public` → push git tag（触发 CI）。

### 如何让用户升级

用户安装时 `dsh plugin add` 写入 **`^` 范围**（如 `^0.1.0`）。发布新版本后用户执行：

```bash
dsh plugin --profile web update @jinhucoco/insar-genie-dsh
# 或 cd ~/.dsh/profiles/web && pnpm update @jinhucoco/insar-genie-dsh
# 重启 dsh web 生效
```

### ⚠️ 版本范围陷阱（0.x 敏感）

npm 的 `^0.1.0` **只匹配 `0.1.x`**（0.x 的 minor 视为 breaking）：

| 你发 | 用户 `pnpm update` 能否拿到 |
|---|---|
| `0.1.1`（patch）| ✅ 能 |
| `0.2.0`（minor，含新功能）| ❌ 不能 |
| `1.0.0`（major）| ❌ 不能 |

> 想让用户自动升级新功能（minor），需用户在 `^0.1.0` 范围内等 patch，或手动升级。**建议**：插件稳定后再升 `1.0.0`，此后 `^1.0.0` 能自动升级所有 `1.x`。

> **发布前必须**：改插件 `assets/`（脚本/SKILL.md）时，先改技能仓库 dev，再 sync_assets --sync，最后发布——否则 CI 的 sync 校验失败。

## 本地安装（开发）

Windows 本地开发用 `link:` 软链接安装（`file:` 依赖的盘符冒号会被 pnpm 误解析报 ENOENT）：

```powershell
powershell -ExecutionPolicy Bypass -File install-dsh.ps1
```

改源码后 `npm run build`，重启 dsh web 即生效（软链接，无需重新 install）。

## 状态

- host 工具：✅ 可用（insar_pipeline / insar_run / insar_import_bulk / insar_experiment / insar_status / insar_templates / insar_register / insar_list / insar_settings）
- client UI：✅ 已有（5 卡参数确认 PipelineConfirm / 参数确认卡 / 进度面板 / 设置卡 / 实验列表），走 `conversation.chat.turnTail` + `settings.section` 插槽
- 构建：`npm run build`（tsc host + tsdown client）；测试：`npm test`（vitest）
- CI：`.github/workflows/test.yml`（build + vitest + 两仓脚本同步校验；push 到 main 触发）
- 发布：`npm publish --access public`（scoped 包；`prepack`/`prepublishOnly` 自动 build）