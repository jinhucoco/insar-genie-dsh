# Changelog

本文件记录 `@jinhucoco/insar-genie-dsh` 的版本历史。遵循 [Keep a Changelog](https://keepachangelog.com/) 语义版本。

## [0.1.2] - 2026-08-25

### 设置侧边栏补 scriptsDir / experimentDir 字段

- SettingsCard 新增「脚本根」「实验数据根」两个文件夹字段（带目录浏览），用户可在 UI 直接填写；`insar_settings` 输出同步暴露两值。

## [0.1.1] - 2026-08-25

### 脚本根与实验目录解耦 + 超参考参数化

- **新增设置 `scriptsDir`（脚本根）**：五步 bat 树 + config.env 的家；**留空 = 插件内置 assets/experiment（开箱即用）**。与 `experimentDir`（实验数据根）彻底解耦——实验目录回归纯数据，无需再复制插件 bat 到实验目录。单实验串行跑，多实验共享同一份脚本；config.env 每次运行前由 pipeline 重写（含扩基线后的最终基线）。
- **超参考参数化 `SUPER_REFERENCE`**：`run_cg_final.bat` 的中央超参考改从 config.env 读 `%SUPER_REFERENCE%`（对应注册参数 `params.superReference`），留空走 bat 内置兑底（民勤 sentinel1_135_20230112… 清单）。换新研究区不再需要手改 bat，确认卡①也展示该项供用户填写。
- `defaultRunStep` 经 overrides.scriptRoot 定位 bat；返回值新增 `scriptRoot` / `experimentDir` 字段。
- 测试 122 → 124（脚本根/数据根分离、SUPER_REFERENCE 写入）。

## [0.1.0] - 2026-08-25

### 首发（已发布 npm + GitHub 远程）

**insar_pipeline 一键全自动编排（核心）**

- `insar_pipeline` 工具：**B1 两阶段确认后跑**
  - 阶段 1（默认，无 `confirmed`）：生成 5 张参数确认卡（`pipeline.cards`，每参数标默认值/推荐值/理由）+ 写 config.env，返回 `needsConfirm` 不执行
  - 阶段 2（`confirmed: true`）：执行五步（连接图 → 干涉+解缠 → 反演1 → 反演2 → 地理编码），每步带校验门
- **三张强制校验门**（全自动核心）：
  - 2% 空间基线铁律（`MAX_PERC_BASELINE`，勿用 SARscape 默认 45%）
  - 连接图校验门：`CG_report.txt` 孤立景数 >4 → 自动扩基线 2%→4% 重跑（上限 4%，最多 3 次）
  - 参数一致性门：每步后读 `tmp/*/work/PARAMETERS_INFO_*.xml` 落盘值 == 用户确认快照（缺证 `passed=false, missingInfo=true` 不静默通过）
- **B2 扩基线生效**：`run_cg_final.bat` 基线改从 config.env 读 `%MAX_PERC_BASELINE%`（带 `if not defined` 兜底）；`insar_pipeline` 扩基线时重写 config.env 确保 bat 读到 2%→4%
- **B3 实验目录从 settings 读取**：设置页新增 `experimentDir` 字段，`insar_pipeline` 优先用它作实验根目录，否则回退 `exp.dir`
- **多视推导（方案 A）**：用户只设 Grid Size（15/30m），`insar_pipeline` 按映射规则显式推导 RG/AZ Looks（15m→4:1~5:1 / 30m→8:2），展示在确认卡上
- **参数快照在扩基线后构建**（避免扩基线后快照与实际运行基线不一致导致校验误报）

**基础能力**

- 8 个 host 工具：`insar_pipeline` / `insar_run` / `insar_experiment` / `insar_status` / `insar_templates` / `insar_register` / `insar_list` / `insar_settings`
- 参数防呆校验（2-4% 基线门禁）+ 实验注册表 + client UI（5 卡参数确认 / 进度面板 / 设置卡）
- 自包含：`lib/` + `client/client.js` + `assets/`（内嵌技能与全套脚本）随包，clone 后开箱即用
- 包名 `@jinhucoco/insar-genie-dsh`（发布到账号自有 scope）；安装：`dsh plugin --profile web add @jinhucoco/insar-genie-dsh -w`

**测试**：122 用例通过；CI（`.github/workflows/test.yml`）：build + vitest + 两仓脚本同步校验全绿。

## 注意（版本维护）

- `^0.1.0` 范围只匹配 `0.1.x`。发 `0.2.0`（新功能/breaking）时，已装用户需手动升级；发 `0.1.x`（patch/bug 修复）用户 `dsh plugin update` 可自动拿到。
- 改插件 `assets/`（脚本/SKILL.md）必须先改**技能仓库 `jinhucoco/insar-genie` 的 dev 分支**，再用 `scripts/sync_assets.py --sync` 复制到插件，再发布。否则 CI 的 sync 校验失败。
