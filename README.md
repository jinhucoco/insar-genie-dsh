# @jinhucoco/insar-genie-dsh

SBAS-InSAR 全链路 DSH 插件：`insar_pipeline`（一键全自动编排 SBAS）+ `insar_run` / `insar_status` / `insar_templates` / `insar_register` / `insar_list` / `insar_experiment` / `insar_settings` 工具 + 参数防呆校验（2-4% 基线门禁 / 连接图校验门 / 参数一致性门）+ 实验注册表 + client UI（参数确认卡 / 进度面板 / 设置卡）。

**开箱即用**：插件自带完整 SBAS 执行链（`assets/scripts/` 下载/配套数据工具 + `assets/experiment/` SARscape 五步 batch 与守护脚本）。安装插件后 `insar_run` / `insar_experiment` 自动使用内置脚本，**无需另装技能或手动传脚本路径**。

## 脚本来源与同步（两仓约定）

插件 `assets/scripts` + `assets/experiment` 里的 Python/bat 脚本**来自技能仓库 `jinhucoco/insar-genie`**（`scripts/` + `experiment/`），是其在插件的**发布副本**。

> ⚠️ **方向铁律**：脚本**唯一源**在技能仓库 `jinhucoco/insar-genie`（dev 分支）。**必须先改技能仓库**，再用 `sync_assets.py --sync` **从技能仓库复制到插件 assets**。方向反了（改插件 assets → 复制到技能仓库）会导致两仓语义漂移。

> 正确改脚本流程：
> 1. 在技能仓库 `~/.../asf-sentinel1-download`（dev 分支）改 `scripts/` / `experiment/` / `SKILL.md`
> 2. `git add -A && git commit && git push origin dev`（CI 的 sync 校验克隆的就是 dev）
> 3. 在插件仓库跑 `python scripts/sync_assets.py --skill-repo <技能仓库> --sync` 同步到 assets
> 4. `git add assets/ && git commit && git push origin main`

**同步 / 校验（在插件 repo 根执行）**：

```bash
python scripts/sync_assets.py --skill-repo <技能仓库路径>    # 校验：报告不一致/缺失，不改动
python scripts/sync_assets.py --skill-repo <技能仓库路径> --sync   # 同步：从技能仓库复制到 assets
```

> CI（`.github/workflows/test.yml`）会在 push 到 main 时自动 clone 技能仓库并跑 sync 校验，防止两仓漂移。

## 安装

```powershell
dsh plugin --profile web add @jinhucoco/insar-genie-dsh -w
```

> **说明**：本包自包含——`lib/`（host 产物）+ `client/client.js`（client bundle）+ `assets/`（内嵌技能与全套脚本）均已入库，**clone 后开箱即用，无需再 build**。`prepublishOnly`/`prepack` 已钩住 `npm run build`，`npm publish` 时自动保证产物最新。
>
> 发布到 npm：`npm publish --access public`（scoped 包必须 `--access public` 才免费公开；`@dsh-custom` 是公共 scope 无权限，用 `@jinhucoco` 账号自有 scope）。
>
> Windows 本地开发用 `link:` 软链安装（`file:` 依赖的盘符冒号会被 pnpm 误解析，报 ENOENT）：
> ```powershell
> powershell -ExecutionPolicy Bypass -File install-dsh.ps1
> ```
> 改源码后 `npm run build`，重启 dsh web 即生效（软链，无需重复 install）。

## 使用

- 对话：「跑 SBAS，区域 xxx.shp，2020-2025，VV」
- AI 识别地形 → 调用 `insar_templates` 取模板 → 生成参数表 → 用户确认 → `insar_run` 执行下载（list 清单 CSV 或 aoi+start+end，同步 await，数小时级）
- 注册实验：`insar_register`（写入注册表，记录参数快照，`maxPercBaseline` 防呆拦截非法值）
- 实验运行中：`insar_status` 查询五步进度与剩余时间（速率按 guard 日志动态计算，无数据时兜底 0.22 对/分）

## 全流程使用（装插件即跑）

装好插件后，其他用户即可在对话中全流程跑 SBAS 实验，无需额外配置脚本：

1. **首次配置**（设置 → insar-genie）：填 ASF 账号密码、GACOS 邮箱 + IMAP 授权码、实验目录 `experimentDir`；ENVI/SARscape 路径已自动探测，工作目录默认 `G:\`。
2. **对话发起**：「跑 SBAS，区域 xxx.shp，2020-2025，VV」。
3. AI 自动：
   - 识别地形 → `insar_templates` 取模板 → 展示参数表（含 2-4% 基线防呆）
   - **`insar_pipeline` 两阶段一键编排**：
     - **阶段 1（确认前）**：`insar_pipeline(experimentId)` → 生成 **5 张参数确认卡**（每参数标默认/推荐/理由）+ 写 config.env，返回 `needsConfirm` 不执行；client 展示确认卡，用户逐项抉择
     - **阶段 2（用户确认后）**：`insar_pipeline(experimentId, confirmed=true)` → 真正执行五步：连接图 → 干涉+解缠 → 反演1 → 反演2 → 地理编码，每步带校验门
   - `insar_status` 汇报进度（进度面板实时显示）
4. 需要自定义脚本位置时：设 `INSAR_GENIE_SCRIPTS` / `INSAR_GENIE_EXPERIMENT` 环境变量，或给 `insar_run` 的 `scriptDir` / `insar_experiment` 的 `experimentDir` 传值。

> 脚本路径解析优先级：显式参数 > 环境变量 > 插件内置 `assets/`（随包走，默认）。

### insar_pipeline 三张强制校验门（全自动核心）

`insar_pipeline` 每步执行前/后都带防呆门，绝不带病进下一步：

1. **2% 空间基线铁律**：`MAX_PERC_BASELINE` 初始 2%（用户方法论，勿用 SARscape 默认 45%）。
2. **连接图校验门**：跑完 `CG_report.txt` 读孤立景数，**>4 → 自动扩基线 2%→4% 重跑**（铁律上限 4%，最多 3 次），仍不合格则中断上报。
3. **参数一致性门**：每步后读 `tmp/*/work/PARAMETERS_INFO_*.xml` **实际落盘值** vs **用户确认的参数快照**，不一致即告警/中断（`ignoreInconsistency=true` 可跳过）。

> 多视推导（方案 A）：用户只设 **Grid Size**（15/30m），`insar_pipeline` 按映射规则显式推导 RG/AZ Looks（如 15m→4:1~5:1），并展示在确认卡上供用户确认。

> 参数快照构建：**在连接图扩基线确定最终 `maxPercBaseline` 之后**构建（避免扩基线后快照与实际运行基线不一致导致校验误报）。

## 工具

| 工具 | 作用 |
|---|---|
| `insar_pipeline` | **一键全自动编排 SBAS**（B1 两阶段确认后跑）：默认返回 5 卡参数确认（`pipeline.cards`）+ config.env 不执行；`confirmed=true` 才真正执行五步，并带连接图门 + 参数一致性门。实验目录优先用设置 `experimentDir`（B3）；扩基线时重写 config.env 的 `MAX_PERC_BASELINE` 确保 bat 读到（B2）|
| `insar_run` | 执行 Sentinel-1 SLC 下载（内置 `assets/scripts/multi_download.py`；`scriptDir` 可选，默认内置目录，可用 `INSAR_GENIE_SCRIPTS` 环境变量或参数覆盖；--list 或 --aoi/--start/--end + --pol/--out，不设超时）|
| `insar_experiment` | 单步执行 SARscape 批处理（内置 assets/experiment/bat/<step>/<bat>；step=import_slc/cg/interf/dem/gacos_bulk/gacos_import/inv1/inv2/geocode）。`insar_pipeline` 自动编排内部委托它，无需手动调用 |
| `insar_status` | 读取实验状态（解析 auxiliary.sml / step_performed.sml / guard 日志；进度与 ETA）|
| `insar_templates` | 按地形返回参数模板（矿区/滑坡/城市/沙漠/黄土高原）|
| `insar_register` | 注册新实验到注册表（记录参数快照，返回 id；防呆校验基线）|
| `insar_list` | 列出已注册实验（id/name/terrain/status）|
| `insar_settings` | 读取解析后的设置值（含启动探测的 ENVI/SARscape 路径）|

## 设置（settings → insar-genie）

- earthdataUser / earthdataPassword：ASF 凭证
- gacosEmail / gacosImapAuthCode：GACOS 邮箱 + IMAP 授权码
- enviIdl / sarscapeLib：ENVI/SARscape 路径（**启动时自动探测**，无需手填）
- workDir / poeorbDir：数据目录（POEORB 默认 <实验目录>/poeorb；gacos/dem/slc 目录由实验目录管理）
- experimentDir：实验目录（**B3**——`insar_pipeline` 优先用它作实验根目录，需含 `bat/`（内置五步 bat + config.env）；未配置则回退到实验记录 `exp.dir`）

## 防呆铁律

- 空间基线必须在 2-4%（`validateBaseline` 单一来源 `src/shared/baseline.ts`，host 与 client 共用；`insar_register` 写入前强制拦截 45% 事故）
- 连接图必须校验（孤立景数 >4 → 扩基线 2%→4% 重跑，上限 4%）
- 执行后校验 `tmp/*/work/PARAMETERS_INFO_*.xml` 实际落盘值 == 参数快照（`checkParamsConsistency`；缺证时 `passed=false, missingInfo=true`，不静默通过）

## 状态

- host 工具：✅ 可用（8 个）
- client UI：✅ 已有（5 卡参数确认 PipelineConfirm / 参数确认卡 / 进度面板 / 设置卡 / 实验列表），走 `conversation.chat.turnTail` + `settings.section` 插槽
- 构建：`npm run build`（tsc host + tsdown client）；测试 `npm test`（vitest **122 用例**）
- CI：`.github/workflows/test.yml`（build + vitest + 两仓脚本同步校验；push 到 main 触发）
- 发布：`npm publish --access public`（scoped 包；`prepack`/`prepublishOnly` 自动 build）
