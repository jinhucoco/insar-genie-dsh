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

## 3. 参数确认交互流程

1. `insar_pipeline` 识别地形 → `insar_templates` 取出「**推荐值**」
2. 读取当前数据集（Sentinel-1 TOPSAR）的 **SARscape 软件默认值**
3. 生成 **5 张确认卡**，每卡列出每个参数的 `字段名 / 软件默认值 / 推荐值 / 推荐理由`
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

### 卡② Interferogram Generation & Unwrapping

| 字段 (.task) | GUI 显示名 | default | rec | 理由 |
|---|---|---|---|---|
| DEM_SARSCAPEDATA | DEM | — | 自动填 DEM_FINAL | GEOIDAL/SUBTRACT 三步产物 |
| RG_LOOKS_NBR | Range Looks | 4 | **8** | 低相干/沙漠区降噪（你实验 8:2）|
| AZ_LOOKS_NBR | Azimuth Looks | 1 | **2** | |
| LAYOVER_SHADOW_MASK | Apply Layover and Shadow Mask | OK | OK | 掩膜开 |
| COREGISTRATION_WITH_DEM | Coregistration With DEM | — | OK | |
| FILTERING_METHOD | Filtering Method | GOLDSTEIN | GOLDSTEIN | |
| GOLDSTEIN_WINSIZE | Goldstein Win Size | 64 | **64** | 窗口适中 |
| UPHA_METHOD_TYPE | Unwrapping Method Type | MCF_DELAUNAY | **MCF** | 推荐 Delaunay MCF |
| UPHA_COH_THRESHOLD | Unwrapping Coherence Threshold | 0.30 | 0.2(低相干)/0.3(城市) | 按地形 |
| UPHA_LEVELS_NBR | Unwrapping Decomposition Level | 1 | 1 | |
| EXTERNAL_SENSOR | Atmosphere External Sensors | — | **GACOS** | 大气校正 |
| WATER_VAPOUR_FILE_LIST | Optional Water Vapour File List | — | GACOS ztd 列表 | |
| COH_RG_AZ_BOXSIZE | Coherence RG/AZ Box Size | 5,5 | 5,5 | |

### 卡③ Inversion Step 1

| 字段 (.task) | GUI 显示名 | default | rec | 理由 |
|---|---|---|---|---|
| DISPLACEMENT_MODEL_TYPE | Displacement Model Type | linear | linear | 线性形变 |
| ESTIMATE_RESIDUAL_HEIGHT | Estimate Residual Height | OK | OK | 轨道误差分离 |
| PRODUCT_COHERENCE_THRESHOLD | Product Coherence Threshold | 0.30 | 0.2 | 低相干放宽 |
| MIN_VALID_INTERF_PERC | Min Valid Interferograms % | 65 | 65 | |
| DISCONNECTED_BLOCKS_TYPE | Allow Disconnected Time Series | NotOK | NotOK | |
| UPHA_METHOD_TYPE | Unwrapping Method Type | MCF_DELAUNAY | MCF | |
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

| 字段 (.task) | GUI 显示名 | default | rec | 理由 |
|---|---|---|---|---|
| GEOCODE_RG_GRID_SIZE | X Dimension (m) | 15 | **30** | 30m（10-30m 区间）|
| GEOCODE_AZ_GRID_SIZE | Y Dimension (m) | 15 | **30** | |
| PRECISION_HEIGHT_THR | Height Precision Threshold | 10 | 30 | 高度精度阈值 |
| PRECISION_VELOCITY_THR | Velocity Precision Threshold | 8 | 30 | 速度精度阈值 |
| COHERENCE_THR | Product Temporal Coherence Threshold | 0.1 | 0.1 | |
| WATER_BODY_MASK_DB | Water Mask (dB) | 0.0 | 0.0 | |
| GENERATE_RASTER | Make Geocoded Raster | OK | OK | |
| GENERATE_SHAPE | Make Geocoded Shape | OK | OK | |
| SHAPE_TIME_SERIES | Generate Shape Time Series | OK | OK | |
| GENERATE_VERTICAL | Vertical Displacement | NotOK | NotOK | |
| GENERATE_MAX_SLOPE | Slope Displacement | NotOK | NotOK | |

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
