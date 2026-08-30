# @jinhucoco/insar-genie-dsh

**DSH 插件：AI 对话驱动的 SBAS-InSAR 全流程自动化。**

从 Sentinel-1 数据下载、配套数据（DEM/GACOS/POEORB）获取，到 SARscape 参数确认与批处理执行，再到守护监控——你只需用自然语言说出需求（时间范围 + 研究区矢量 + 极化），AI 自动完成。

## 安装

```powershell
dsh plugin --profile web add @jinhucoco/insar-genie-dsh -w
restart dsh web   # 重启生效
```

安装后插件自带全部脚本（`assets/`：下载工具 + SARscape 五步批处理 + 守护），**开箱即用，无需额外配置脚本路径**。

## 快速开始

安装后，直接在对话里说：

```
「从 ASF 下载哨兵数据，区域 研究区.shp，时间 20200101 至 20251231，VV」
「下载配套数据」
「开始 SBAS 实验」
「实验进展如何」
```

AI 会依次：
1. **下载 SLC**：分析数据 → 生成下载清单 → 校验轨道一致性与研究区覆盖 → 下载
2. **获取配套数据**：POEORB 精密轨道 / GACOS 大气延迟 / NASADEM DEM
3. **参数确认**（重要）：识别研究区地形 → 给你 **5 张参数确认卡**（连接图 / 干涉 / 反演1 / 反演2 / 地理编码），每项标注默认值/推荐值/理由，**你确认后才执行**
4. **执行实验**：连接图 → 干涉+解缠 → 反演 → 地理编码，每步带自动校验
5. **全程守护&汇报**：进度面板实时显示，异常自动处理

## 首次配置（设置 → insar-genie）

| 设置项 | 说明 |
|---|---|
| `earthdataUser` / `earthdataPassword` | NASA Earthdata 账号（ASF 下载 + DEM 下载用）|
| `gacosEmail` / `gacosImapAuthCode` | 接收 GACOS 结果的邮箱 + IMAP 授权码（用 GACOS 时）|
| `enviIdl` / `sarscapeLib` | ENVI / SARscape 路径 —— **启动时自动探测，一般无需手填** |
| `workDir` / `poeorbDir` / `experimentDir` | 数据与实验目录 |

> 账号免费注册：https://urs.earthdata.nasa.gov/（ASF 用）

## 工具一览

| 工具 | 作用 |
|---|---|
| `insar_pipeline` | **一键全自动编排 SBAS**。两阶段：先出 5 卡参数确认（不执行）→ 你确认后 `confirmed=true` 才真正执行五步 |
| `insar_run` | 下载 Sentinel-1 SLC（清单 CSV 或 AOI+时间范围驱动，数小时级同步等待）|
| `insar_import_bulk` | **批量导入 SLC**：按清单时相（日期）分组自动导入，双帧自动拼接、单帧不拼，支持续跑/ROI 裁剪 |
| `insar_experiment` | 单步执行 SARscape 批处理（import/cg/interf/dem/gacos/inv1/inv2/geocode）——`insar_pipeline` 内部委托它，一般无需手动调 |
| `insar_status` | 查询实验进度与预计完成时间 |
| `insar_templates` | 按地形返回参数模板（矿区/滑坡/城市/沙漠/黄土高原）|
| `insar_register` | 注册实验（记录目录与参数快照，返回实验 id）|
| `insar_list` | 列出已注册实验 |
| `insar_settings` | 读取当前设置 |

## 关键机制（自动防呆）

- **空间基线铁律 2%-4%**：连接图空间基线初始 2%，勿用 SARscape 默认 45%（长基线在低相干区配准极慢）。连接图孤立景数 >4 时自动扩到 4% 重跑。
- **参数确认再执行**：任何实验跑之前，AI 都会先给你参数表（带默认/推荐/理由），你确认或修改后才执行。修改的参数在确认后通过 `paramOverrides` 生效。
- **参数一致性校验**：每步执行后比对 SARscape 实际落盘参数与你确认的快照，不一致即告警，绝不带病进下一步。
- **按时相分组导入**：SLC 导入按"时相（日期）"分组——同一天多帧一起导（自动拼接成 msc SLC 列表），不同时相绝不混拼。
- **守护自愈**：长下载/导入由守护 + 计划任务托管，宿主重启后自动续跑。

## 常见问题

| 问题 | 处理 |
|---|---|
| 下载时是否需要代理 | 系统代理开着时脚本会自动走代理（更稳更快）；深夜/空闲时段网速好时自动加速 |
| 搜索 VV 返回 0 结果 | CMR 中该区域 SLC 极化属性是 `VV+VH`（双极化），用 `VV+VH` 下载、导入时取 `ONLY_VV_POL` 即得 VV |
| 有没有 pwr 强度图 | 导入默认生成（`Make Power QL`），用于目视检查 AOI 覆盖 |
| SARscape 批处理失败如何查 | 看 `<临时目录>/work/Process.trace` 的 `[SARS_LOG]`/`EC=70000` 行（批处理 stdout 不含执行细节）|
| 换新研究区 | 把新研究区 shp 告诉 AI，重新走「开始 SBAS 实验」；AI 会识别地形、给新参数、重新下载配套数据 |

## 需要本地环境

- **Python 3.10+**（依赖：`pip install -r assets/scripts/requirements.txt`）
- **ENVI + SARscape**（已装则插件自动探测路径）
- NASA Earthdata 账号（ASF 下载）
- 用 GACOS 时需要邮箱 IMAP 授权码

---

*开发/发布信息见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。*