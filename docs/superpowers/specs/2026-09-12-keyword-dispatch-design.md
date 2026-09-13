# insar-genie 关键词调度（关键词 → 功能菜单）设计

- 日期：2026-09-12
- 仓库：`jinhucoco/insar-genie-dsh`（分支 `dev`）
- 状态：已获用户批准，进入实现

## 1. 要解决的问题

插件目前没有任何"入口"：用户只说出裸关键词（`insar` / `SBAS` / `实验`）时，AI 不知道该干什么，
只能反问或猜。根因两处：

1. `src/index.ts` 里 `registerSkill()` 送给技能目录的 `description` / `whenToUse`，
   触发词**全是完整长句**（"从ASF下载哨兵数据""跑SBAS"…），裸关键词命中率低；
2. `assets/SKILL.md` 通篇是"怎么跑"，缺一个"先问用户要做什么"的动作。

目标：**用户说裸关键词 → AI 第一条回复必须是插件功能菜单 + 一句"想做哪一件？"**；
用户已给出明确任务时不打断。

## 2. 行为规则

```
命中「领域关键词」 且 未命中「明确任务标记」 → 注入调度指令（弹功能菜单）
否则 → 不注入，正常协作
```

| 情况 | 例子 | 动作 |
|------|------|------|
| 裸关键词，无明确任务 | 「insar」「SBAS」「实验」 | 先列功能菜单 + 问想做哪一件 |
| 已给出明确任务 | 「实验进展如何」「跑SBAS，区域古浪.shp，2020-2025」「下载配套数据」「就用推荐值」 | 跳过菜单，直接干活 |
| 与 insar 无关 | 「帮我写个正则」 | 完全不触发 |

- **领域关键词**：`insar` `in-sar` `sbas` `sarscape` `sentinel` `哨兵` `slc` `gacos` `poeorb`
  `ztd` `干涉` `形变` `沉降` `解缠` `连接图` `反演` `地理编码` `基线` `时相` `多视` `实验` `earthdata`
- **明确任务标记**（命中任一即视为明确）：文件/路径（`.shp .kml .csv .ztd .hgt .dat .env` 等、`D:\…`）｜
  日期（`20240101` / `2024-01-01` / `2024年`）｜动作词（`下载 导入 跑 执行 开始 继续 重跑 补跑 接着
  查看 查一下 看一下 进展 进度 状态 结果 报告 注册 配置 设置 检查 自检 确认 就用 按推荐 没问题
  怎么设 停止 取消 重来 恢复 汇报`）

**容错取向**：判定故意偏保守——宁可多注入一条（模型看到"若已给出明确任务则忽略本条"就跳过），
也不漏掉裸关键词。因此判定不准只会多一行提示，不会做错事。

## 3. 实现

### 3.1 宿主层：新增 `src/host/dispatch.ts`

三层职责分开，前两层是纯函数、可单测：

1. **判定** `detectDispatch(text): boolean` —— 领域关键词 ∧ 无明确任务标记
2. **内容** `FUNCTIONS` / `buildDispatchText()` / `buildDispatchMessage(turn)`
   —— 菜单唯一数据源（单测强制与 `assets/SKILL.md` 一致）
3. **接线** `registerDispatch(ctx): void` —— 挂 `agent/pre-step`

关键决策：

- **注入通道**：`agent/pre-step` 瀑布。`await next()` 拿到 `decision`，命中则在
  `decision.messages` 末尾追加一条 plugin 来源的 user 消息（与官方本机 preset
  `instruction-hint` 同款做法，是该宿主的既定注入方式）。
- **消息来源**：`source: { kind: "plugin", plugin: "insar-genie-dsh", form: "instructions" }`。
  用 `dsh-llm` 内置的 `plugin` kind + `instructions` form（而非自造 kind），
  类型安全且 UI 会按"指令类上下文"呈现。
- **只注入一次**：仅在 `payload.step === 1` 注入。已核实 `dsh-agent-loop` 源码
  （`lib/index.js:1005` 每个 turn 把 `phase.step` 重置为 0、turn 内自增），
  因此"turn 第一个 step"天然一次，**不依赖任何内存状态，重启也不会重复**。
- **消息 id 全局唯一**（带 turn + 时间戳 + 序号）。不刻意做持久化去重：
  即使宿主重启后同一 turn 重跑，也只是多一条幂等提示文本，
  而**唯一 id 保证了历史回放不会撞 id**（撞 id 才是真事故）。
- **失败安全**：整个监听体 try/catch，异常只 `logger.warn` 一次、原样返回 decision，
  绝不阻断会话。

### 3.2 接线：`src/index.ts`

- `apply()` 里调用 `registerDispatch(ctx)`；
- `registerSkill()` 的 `description` / `whenToUse` 放宽：补裸关键词触发词，
  并写明"未给出明确任务时先列功能菜单问用户想做哪一件"。

> 注：这份 `description` 才是技能目录里给模型看的（`assets/SKILL.md` 的 frontmatter 只在不经插件
> 单独使用时生效），两处必须同步。

### 3.3 技能层：`assets/SKILL.md`

- frontmatter `description` 同步放宽触发词；
- 正文顶部新增「零号动作：关键词调度（先说功能菜单，再干活）」章节：
  判定表 + 8 项菜单表 + 与宿主同规则的明确任务判据。

菜单定义了两处（TS 常量 + SKILL.md 表），由 `test/dispatch.test.ts` 逐条断言防漂移。

## 4. 功能菜单（8 项，按流程排序）

| # | 功能 | 后端 |
|---|------|------|
| 1 | 下载 SLC 主数据 | `insar_run` |
| 2 | 下载配套数据 | POEORB / GACOS / DEM 三个下载脚本 |
| 3 | SLC 批量导入 | `insar_import_bulk` |
| 4 | 参数确认 + 跑 SBAS 全流程 | `insar_pipeline`（5 卡确认） |
| 5 | 单步执行 / 补跑 | `insar_experiment` |
| 6 | 查实验进展 | `insar_status` / `insar_list` |
| 7 | 环境自检 / 账号配置 | `check_environment.py` / `setup_env.py` / `insar_settings` |
| 8 | DEM 预处理 | dem 三步 bat（拼接 → 导入 → 去大地水准面） |

## 5. 测试

新增 `test/dispatch.test.ts`：

- 裸关键词（`insar` / `SBAS` / `实验` / `哨兵` / `干涉`…）全部触发
- 明确指令（`实验进展如何` / `跑SBAS，区域古浪.shp，2020-2025` / `下载配套数据` / `就用推荐值`）
  全部不触发
- 与 insar 无关的文本不触发
- `step !== 1` 不注入；`kind !== 'enter'` 不注入
- 监听体内部异常不抛出、只 warn 一次
- **菜单一致性**：`FUNCTIONS` 每条的 `label` 必须出现在 `assets/SKILL.md` 正文中

既有测试（84 项）全绿 + `npm run build`。

## 6. 已知边界与风险

- **preset 交互**：本机自定义 preset `anchored-standard` 的 `context-gate` 会在会话未"晋升"时
  剥离未声明 kind 的自动注入。当前默认 preset 是内置 `standard`（无此门），不受影响；
  若将来切到 `anchored-standard`，需把本插件的注入 kind 加进其 `allowKinds`，
  否则会话首轮注入会被剥掉。
- **注入时机**：只在 turn 的第一个 step，因此"用户中途补充一句裸关键词"不会二次弹菜单
  （避免同一任务里反复打断）；要触发请开新一轮。
- **装机生效**：`.pnpm` 下的装机副本是物理拷贝，改源码不会自动生效。
  跑 `install-dsh.ps1`（切 `link:` 软链）或重装，并**重启 `dsh web`** 才加载新 host 代码。

## 7. 两仓同步（发布铁律）

`assets/SKILL.md` 与技能仓 `jinhucoco/insar-genie` 根 `SKILL.md` 必须 MD5 一致；
`.release.sh` 会跑 `scripts/sync_assets.py` 卡一致性。改完插件仓后必须同步技能仓（或跑 `--sync`）。
