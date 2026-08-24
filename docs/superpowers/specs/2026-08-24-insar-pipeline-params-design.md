# insar_pipeline 参数确认设计（SBAS 全流程）

> 日期：2026-08-24
> 状态：设计稿（待审查）
> 目标：用户装插件后，调用 `insar_pipeline` 即可**全自动跑 SBAS**；但参数确认保留且做强——**每一步骤一张确认卡，每参数展示「软件默认值 + 推荐值」让用户抉择**，确认后自动生成 config.env 与参数快照并执行。

---

## 1. 定位（已确认）

- **阶段化编排**（不是一键无脑跑）：`insar_pipeline` 拆成可独立触发的阶段，AI 一调用即按序自动跑，阶段间可人工介入。
- **参数确认模式**：**每次完整展示每一步骤的确认卡**，一次性推送，用户逐卡确认后才开始实验。**2-4% 基线铁律无条件强制**（不因确认而放松）。
- **合并式 5 卡**：按 SARscape 软件的 5 个 SBAS 工具组织（非细分 step）。

## 2. 阶段划分（insar_pipeline 编排）

| 阶段 | 内容 | 依赖 |
|---|---|---|
| **download** | SLC 下载（multi_download.py） | config.json 凭证 |
| **companion** | POEORB + GACOS + DEM（配套数据） | SLC 已就位 |
| **config** | 生成 config.env（路径全自动，从 settings + 实验目录） | settings |
| **processing** | 五步 SBAS 工具（5 卡确认后执行） | config.env + 配套数据 + ENVI/SARscape license |

> 参数确认发生在 **processing 阶段**（五步工具执行前）。download / companion / config 阶段也为自动。

## 3. 推荐值 = 地形参数表（核心决策知识）

> **SBAS-InSAR 无普适参数**——`insar_pipeline` 先识别研究区地形，再按**地形参数表**对应行给出每步推荐值。
> 来源：SKILL.md「实验参数设置提醒机制」（2026-08-06 学术论文系统学习固化）。

| 地形类型 | 多视 | 时间基线 | 空间基线 | 滤波 | 解缠 | 相干阈值 | 形变模型 |
|---------|------|---------|---------|------|------|---------|---------|
| 矿区（快速大形变）| 4:1~7:2 | 短(36-90天) | 2-4% | Goldstein | MCF/Delaunay | 0.2-0.3 | **quadratic/分段线性** |
| 城市沉降（慢小形变）| 4:1~5:1 | 中(120-180天) | 2-4% | Goldstein | MCF | 0.3 | linear |
| 滑坡（局部非线性）| 5:1~7:2 | 中(90-180天) | 2-4% | Goldstein | **Delaunay MCF** | 0.2-0.3 | linear + 速率阈值筛选 |
| 黄土高原（低相干）| 7:2~8:2 | 中(180天) | 2-4% | Goldstein + 强滤波 | **Delaunay MCF** | 0.15-0.2 | linear |
| 高山植被区（强失相干）| 7:2~8:2 | 短(90天) | 2-4% | Goldstein + NL 滤波 | **Delaunay MCF** | 0.15-0.2 | linear |
| 冻土/冰川（季节性）| 5:1~7:2 | 短(36-90天) | 2-4% | Goldstein | MCF | 0.3 | **periodic** |
| 农业/耕地（时间失相干）| 7:2~8:2 | 短(36-90天) | 2-4% | Goldstein | MCF/Delaunay | 0.2 | linear |

**推荐值派生规则**：
- **多视不是默认死值**：SARscape 在跑完连接图、把工程头文件（aux）选入涉工作流后，会自动弹出一个**分辨率窗口**，根据**建议网格大小（GRID_SIZE_FOR_SUGGESTED_LOOKS）**自动给出默认多视（如 4:1/3:1/8:2）。所以用户真正设的是**网格大小**，多视是它推导出来的建议。
- 因此：设定 `GRID_SIZE_FOR_SUGGESTED_LOOKS`（15m/30m）→ SARscape 弹窗自动给多视建议（4:1→15m，8:2→30m）。**注意：默认 15 必须改**（用户规则：多视比→grid 大小对应；研究区>800km² 用 7:2/8:2→30m）。
- **多视同时看范围大小**：>800km²（大范围）→ 7:2/8:2（≈30m 稳健）；<800km²（城市/矿区局部精细）→ 4:1~5:1（高分辨率），SARscape 弹窗据此给对应建议值。
- 空间基线 → 铁律 2%（不足扩 4%）
- 解缠 → 高相干 MCF；植被/复杂区 Delaunay MCF
- 形变模型 → linear 默认；矿区/滑坡 quadratic；冻土 periodic
- 相干阈值 → 高相干 0.3，低相干 0.15-0.2

## 3b. 参数确认交互流程

1. `insar_pipeline` 识别地形 → `insar_templates` 取「**地形参数表对应行**」的推荐值
2. 读取当前数据集（Sentinel-1 TOPSAR）的 **SARscape 软件默认值**
3. 生成 **5 张确认卡**，每卡列出每个参数的 `字段名 / 软件默认值 / 推荐值(按地形表) / 推荐理由`
4. 一次性推送给用户：
   - 用户选「全部确认」→ 写 config.env + 参数快照，开始 processing
   - 用户改某步某参数 → 更新该卡，重发给用户等确认
   - 用户取消 → 中止
5. 基线铁律（2%）在任何模式下都不会被绕过

## 4. 五步参数确认卡（每参数：default = SARscape 软件默认，rec = 推荐）

### 卡① Connection Graph

| 字段 (.task) | GUI 显示名 | default | rec | 理由 |
|---|---|---|---|---|
| MIN_PERC_BASELINE | Min Normal Baseline (%) | 0 | 0 | 铁律下限 |
| **MAX_PERC_BASELINE** | Max Normal Baseline (%) | **2** | **2** | 铁律；SARscape 对 Sentinel-1 默认即 2%，2%→稀疏GCP快，45%→稠密DEM慢380倍 |
| MIN_TIME_BASELINE | Min Temporal Baseline (days) | 0 | 0 | |
| **MAX_TIME_BASELINE** | Max Temporal Baseline (days) | 180 | 180 | 常规 SBAS 时间基线 |
| DEGREE_OF_REDUNDANCY | Degree of Redundancy | low | **high** | 高冗余更稳（可放宽连接率）|
| REDUNDANCY_CRITERIUM | Redundancy Criteria | min_normal | min_normal | |
| MAX_LINK_NR_PER_IMAGE | Max Connections per Acquisition | 8 | **10** | 低相干区提高连通 |
| ALLOW_DISCONNECTED_BLOCKS | Allow Disconnected Blocks | NotOK | NotOK | 保整体连续 |
| SUPER_REFERENCE | Input Super Reference | auto | 自动选 | 中央超参考 |

### ⚠️ 连接图校验门（强制关卡，全自动核心）

> **时间/空间基线设置后，必须校验「大多数影像是否链接上了」，达标才进后续干涉/反演；
> 否则基线太紧、影像孤立，后续全是废步。** 这是 `insar_pipeline` 的强制质量控制点，
> 不是可选项——连接图不达标，直接卡住并自动处理，绝不带病进下一步。

**判据**（读 CG_report.txt 的孤立影像数）：
- **孤立景数** = 未参与任何连接对的影像数（影像数较多时，个别景连不上属正常）。
- **达标：孤立景数 ≤ 4** → 保持 2% 基线，进干涉。
- **不达标：孤立景数 > 4** → 视为基线太紧，进入扩基线重跑。

**自动扩基线重跑逻辑**（符合空间基线铁律执行流程）：
1. 先 2% 基线跑完，读 CG_report.txt 统计孤立景数。
2. 孤立景数 ≤ 4 → 保持 2%，进干涉。
3. 孤立景数 > 4 → **自动扩到 4%**（MAX_PERC_BASELINE=4）重跑连接图。
4. 4% 仍孤立 > 4 景 → **联动扩时间基线**（如 MAX_TIME_BASELINE 180→更大）重跑，保持干涉对数量合理。
5. 仍无法降到 ≤4 景孤立 → 上报用户：数据或基线设置可能有问题，中断并给出建议（如换轨道/扩时间范围）。

> 注：连接图用 SLC 内嵌轨道状态矢量（SV）算基线，**不需要 POEORB**；跑完看 auxiliary.sml 的
> generate_connection_graph=OK + CG_report 有效配对数与孤立景数（而非 trace 的 baseline estimation failure 标记）。

### 卡② Interferogram Generation & Unwrapping

> 多视/解缠/相干阈值/形变模型均按「地形参数表对应行」（如黄土高原 loess：解缠 Delaunay MCF，相干 0.15-0.2；矿区：形变 quadratic）。
> **多视机制（用户已确认方案 A）**：用户只设 **Grid Size（15m/30m）**作为主导参数，`insar_pipeline` **显式按映射规则推导 RG/AZ Looks**，并把推导出的多视值**展示给用户确认**（不是靠 SARscape 弹窗/自动，像 run_interf.bat 那样 SetParam 传 looks）。

**多视 → Grid Size 映射规则**：
- **30m → RG:AZ = 8:2**（>800km² 大范围，低相干/植被区）
- **15m → RG:AZ = 4:1~5:1**（<800km² 局部精细，城市/矿区高分辨率）

| 字段 (.task) | GUI 显示名 | default | rec(按地形+范围) | 理由 |
|---|---|---|---|---|
| DEM_SARSCAPEDATA | DEM | — | 自动填 DEM_FINAL | GEOIDAL/SUBTRACT 三步产物 |
| **GRID_SIZE_FOR_SUGGESTED_LOOKS** | Grid Size for Suggested Looks | **15(必须改)** | **30**(大范围)/**15**(局部精细) | **主导参数**：多视由此推导；>800km²→30m，<800km²→15m |
| **RG_LOOKS_NBR** | Range Looks | 4 | **pipeline 推导**(30m→8 / 15m→4-5) | 由 Grid Size 推导，展示给用户确认（非弹窗） |
| **AZ_LOOKS_NBR** | Azimuth Looks | 1 | **pipeline 推导**(30m→2 / 15m→1) | 与 RG 配套，展示给用户确认 |
| LAYOVER_SHADOW_MASK | Apply Layover and Shadow Mask | OK | OK | 山地必开 |
| COREGISTRATION_WITH_DEM | Coregistration With DEM | — | OK | DEM 辅助配准 |
| FILTERING_METHOD | Filtering Method | GOLDSTEIN | GOLDSTEIN | 通用；低相干加大 alpha/窗口 |
| GOLDSTEIN_WINSIZE | Goldstein Win Size | 64 | 64 | 窗口适中 |
| UPHA_METHOD_TYPE | Unwrapping Method Type | MCF_DELAUNAY | **Delaunay MCF**(植被/复杂区)/**MCF**(城市) | 地形表 + 实测 |
| UPHA_COH_THRESHOLD | Unwrapping Coherence Threshold | 0.30 | **0.2**(黄土/滑坡)/**0.3**(城市) | 地形表相干阈值 |
| UPHA_LEVELS_NBR | Unwrapping Decomposition Level | 1 | 1 | 实测 |
| EXTERNAL_SENSOR | Atmosphere External Sensors | — | **GACOS** | 时相齐必选 |
| WATER_VAPOUR_FILE_LIST | Optional Water Vapour File List | — | GACOS ztd 导入产物列表 | |
| COH_RG_AZ_BOXSIZE | Coherence RG/AZ Box Size | 5,5 | 5,5 | |

### 卡③ Inversion Step 1

> 形变模型按地形表：linear 默认；矿区/滑坡→quadratic/分段线性；冻土→periodic。

| 字段 (.task) | GUI 显示名 | default | rec(按地形表) | 理由 |
|---|---|---|---|---|
| DISPLACEMENT_MODEL_TYPE | Displacement Model Type | linear | **linear**(默认)/**quadratic**(矿区/滑坡)/**periodic**(冻土) | 地形表形变模型 |
| ESTIMATE_RESIDUAL_HEIGHT | Estimate Residual Height | OK | OK | 残余高程估计 |
| PRODUCT_COHERENCE_THRESHOLD | Product Coherence Threshold | 0.30 | **0.2**(低相干)/**0.3**(城市) | 地形表相干阈值 |
| MIN_VALID_INTERF_PERC | Min Valid Interferograms % | 65 | 65 | |
| DISCONNECTED_BLOCKS_TYPE | Allow Disconnected Time Series | NotOK | NotOK | |
| UPHA_METHOD_TYPE | Unwrapping Method Type | MCF_DELAUNAY | **Delaunay MCF** | 植被/复杂区 |
| UPHA_COH_THRESHOLD | Unwrapping Coherence Threshold | 0.30 | 0.2 | |
| RADIUS | Refinement Radius (m) | 22.5 | 37.5 | 精炼半径 |
| REFINEMENT_RES_PHASE_POLY_DEGREE | Refinement Res Phase Poly Degree | 3 | 3 | |

### 卡④ Inversion Step 2

| 字段 (.task) | GUI 显示名 | default | rec | 理由 |
|---|---|---|---|---|
| DISPLACEMENT_MODEL_TYPE | Displacement Model Type | same_as_first | same_as_first | |
| MIN_VALID_INTERF_PERC | Min Valid Interferograms % | 65 | 65 | |
| MIN_VALID_IMAGE_PERC | Min Valid Acquisitions % | 90 | 90 | |
| PRODUCT_COHERENCE_THRESHOLD | Product Coherence Threshold | 0.30 | 0.2 | |
| ATMOSPHERE_LP_METERS | Atmosphere Low Pass Size (m) | 1600 | **1200** | 去大气低通 |
| ATMOSPHERE_HP_DAYS | Atmosphere High Pass Size (days) | 365 | 365 | |
| DISCONNECTED_BLOCKS_TYPE | Interpol Disconnected Time Series | NotOK | NotOK | |
| RADIUS | Refinement Radius (m) | 22.5 | 37.5 | |
| REFINEMENT_RES_PHASE_POLY_DEGREE | Refinement Res Phase Poly Degree | 3 | 3 | |

### 卡⑤ Geocoding

> 输出网格与多视匹配：8:2→30m，4:1→15m（按地形表多视决定）。

| 字段 (.task) | GUI 显示名 | default | rec(按地形) | 理由 |
|---|---|---|---|---|
| GEOCODE_RG_GRID_SIZE | X Dimension (m) | 15 | **30**(8:2)/**15**(4:1) | 与多视匹配，8:2→30m |
| GEOCODE_AZ_GRID_SIZE | Y Dimension (m) | 15 | **30**(8:2)/**15**(4:1) | |
| PRECISION_HEIGHT_THR | Height Precision Threshold | 10 | 30 | 进度精度探索可放宽 |
| PRECISION_VELOCITY_THR | Velocity Precision Threshold | 8 | 30 | 精度 vs 点密度平衡 |
| COHERENCE_THR | Product Temporal Coherence Threshold | 0.1 | 0.1 | |
| WATER_BODY_MASK_DB | Water Mask (dB) | 0.0 | 0.0 | |
| GENERATE_RASTER | Make Geocoded Raster | OK | OK | |
| GENERATE_SHAPE | Make Geocoded Shape | OK | OK | |
| SHAPE_TIME_SERIES | Generate Shape Time Series | OK | OK | |
| GENERATE_VERTICAL | Vertical Displacement | NotOK | NotOK | |
| GENERATE_MAX_SLOPE | Slope Displacement | NotOK | NotOK | |

### ⚠️ 运行阶段参数一致性校验门（防呆铁律落地，强制）

> **参数设置、实验开始运行后，必须校验「实际在跑的参数 == 用户确认的参数快照」**，
> 确保 SARscape 确实按用户设定执行（防呆：AI 或脚本误传、默认值覆盖、参数丢失导致跑错）。
> 这是每步运行后、进入下一步前的**强制关卡**，不一致即告警/中断，绝不带错进下一步。

**校验数据源**：SARscape 每步运行后都会落盘 `tmp*/work/PARAMETERS_INFO_<模块>_CMD_<时间戳>.xml`，
完整记录该步**实际使用的每个参数值**（如 `min_perc_baseline`/`max_perc_baseline`/`max_time_baseline`/
`rg_looks_nbr`/`up_coh_threshold` 等）。

**校验逻辑**：
1. 每步运行完成后，定位该步的 `PARAMETERS_INFO_*.xml`（按模块名 + 最新时间戳）。
2. 解析 XML，提取**用户确认过的关键参数**（至少含：环境基座/多视/解缠/相干阈值/滤波等）。
3. 与 `insar_pipeline` 存的**参数快照（确认后的最终值）**逐一比对。
4. 一致 → 通过，进下一步。
5. 不一致（如 max_perc_baseline 实际是 45 而非用户设的 2）→ **显著告警 + 上报用户，默认中断**，
   除非用户显式忽略（参数被覆盖是严重问题，需人工判断）。
6. 校验结果也写入实验记录（registry），供审计。

> 注：参数名 .task/落盘 XML 为小写下划线（如 `max_perc_baseline`），与 .task 的
> `MAX_PERC_BASELINE` 对应；比对时归一化大小写/下划线。

## 5. config.env 自动生成（processing 前）

`insar_pipeline` 自动写 config.env（从 settings + 实验目录填路径），关键字段：

```
WORK_DIR / RESULT_ROOT / TMP_DIR
SLC_DATA / SLC_ROI / SLC_POLARIZATION
DEM_RAW / DEM_DAT / DEM_ENVI / DEM_FINAL / DEM_FILE
GACOS_LIST / SAR_MODULES / ENVI_IDL / IDL_EXE / SARSCAPE_LIB
```

> 注：config.env 字段名与 bat 读的一致；`SARscape_Preference=Use actual preferences` 时部分系统默认值用 SARscape 内部策略，不做硬覆盖。

## 6. 数据来源（真实，非编造）

- **参数名/GUI显示名**：`C:/Program Files/SARMAP SA/SARscape/auxiliary/envi_extensions/envi/resource/templates/tasks/*.task`
- **软件默认值**：`auxiliary/description_files/SARscape_default_values_dataset_Sentinel TOPSAR (IW - EW)_specific.txt`
- **推荐值**：插件 `insar_templates`（mining/landslide/urban/desert/loess 模板）+ 你的方法论（2% 基线铁律、GOLDSTEIN 64、MCF、GACOS）

## 7. 待确认 / 后续

- [ ] 五个工具参数确认卡格式是否 OK（5 卡、每卡 default+rec）
- [ ] 推荐值是否按你实验复核（尤其 rg/az looks、coherence 阈值按地形）
- [ ] 是否需要「每地形一套模板」落地到 templates.ts（目前是 5 类别硬编码）
