# dsh-persona-memory

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的三个互补插件，打在一个包里：

| 插件 | 干什么 | 何时动 |
|---|---|---|
| **persona-distill** | 人格蒸馏：把每天刷到的素材攒成候选，定期定型进 `AGENTS.md` 的「我学来的」 | 每天增量读素材，满周期定型 |
| **persona-journal** | 日记：从各渠道素材里挑出她**自己觉得有意思**的几件事，写进月度日记 | 每天一个时间点 |
| **life-memory** | 会遗忘的记忆：上下文放不下时把旧轮次折成关键词线索、从历史切除，需要时顺着线索回想 | 会话超阈值就折 |

一句话：**记忆是「发生了什么」，人格是「我是谁」，遗忘是「什么该被放下」。三层各管一段，不互相污染。**

---

## 安装

### 方式一：从本地目录装（推荐，最稳）

先把这个仓库弄到本地（`git clone` 或直接下载 ZIP 解压）：

```bash
git clone https://github.com/bailu974/deepseek-dsh-persona-memory.git
dsh plugin --profile desktop add link:/path/to/deepseek-dsh-persona-memory
```

### 方式二：`dsh plugin add <github 地址>`

```bash
dsh plugin --profile desktop add https://github.com/bailu974/deepseek-dsh-persona-memory
```

> ⚠️ 这条路要求本机装了 **git**。DSH 的插件安装底层走 pnpm，pnpm 拉 GitHub 仓库需要 git；
> 没装 git 时会报找不到仓库/下载失败。装了 git 仍然失败的话，用方式一。
>
> 另外：**仓库根目录必须有 `package.json`**。如果你 fork 后把插件放进子目录（例如
> `插件名/package.json`），从根目录安装就会「下载没发现」——这正是本仓库早期踩过的坑。

装好后 profile 的 `dsh.profile.bundles` 会多出两项，对应两个可分别开关的插件：

```yaml
- id: persona-distill   # 人格蒸馏
- id: persona-journal   # 日记
```

---

## persona-journal（日记）

### 它怎么工作

1. **从多个渠道收片段**（见下面的「素材渠道」）
2. 片段少于 `minSnippets` 条 → 当天不写（不值得写）
3. 调一次 headless 模型，按硬规则写最多 `maxLines` 行
4. 追加到 `journalDir/YYYY-MM.md`

### 素材渠道（sources）

日记**不绑死某个渠道**：任何能产出「当天片段」的东西都能注册成源。

```json
"sources": [
  { "type": "snowluma-log", "dir": "E:/SnowLuma/logs", "bridgeConfigPath": "E:/ai/qq-bridge/config.json", "limit": 40 },
  { "type": "external", "adapter": "bili-journal", "label": "B站" },
  { "type": "inbox", "dir": "C:/Users/你/.dsh/work-inbox", "label": "工作", "markerOnly": true, "enabled": false }
]
```

| 类型 | 读什么 | 说明 |
|---|---|---|
| `snowluma-log` | `snowluma-YYYY-MM-DD.log` | QQ 聊天；可配 `bridgeConfigPath` 走白名单 |
| `external` | distill 的外部适配器（B站手账等） | `adapter` 填适配器 id，按日期取当天条目 |
| `inbox` | `<dir>/YYYY-MM-DD.md` 或 `<dir>/YYYY-MM.md` 的分节 | 人工/半自动手记 |

`inbox` 的两个开关：

- `markerOnly: true` —— **只取 `<!-- diary -->` 与 `<!-- /diary -->` 之间的内容**。适合「干活」这种日常内容很杂、只有几条想留下的场景
- `enabled: false` —— 默认关，需要时再开

不配 `sources` 时行为不变：只读 `snowlumaLogDir`。

硬规则写在代码里，不给模型自由发挥：

- 每天最多 `maxLines` 行，没意思就写「今天没什么」
- **不写人名、群名、QQ 号、原话引用、承诺**
- 第一人称、口语、短；不总结、不升华
- 每周固定一天额外跑一次「本周自检」：看这 7 天记的都是哪类事，偏了就写下来

### 配置

用户配置在 `<家>/persona-journal/config.json`（首次运行写默认值）：

```json
{
  "enabled": true,
  "runAt": "23:50",
  "journalDir": "",
  "fallbackJournalDir": "",
  "snowlumaLogDir": "",
  "bridgeConfigPath": "",
  "dshExe": "",
  "dshBin": "",
  "overlayPath": "",
  "model": "",
  "maxLines": 5,
  "maxSnippets": 120,
  "minSnippets": 5,
  "selfcheckWeekday": 1
}
```

| 字段 | 说明 |
|---|---|
| `journalDir` | 日记目录；留空 = `<家>/persona/journal` |
| `fallbackJournalDir` | 上面那个不可写（外接盘拔了）时退回这里 |
| `snowlumaLogDir` | SnowLuma 日志目录；留空 = 不写日记 |
| `bridgeConfigPath` | 可选，读 bridge 的 `config.json` 拿白名单 |
| `dshExe` / `dshBin` | 跑 headless 用的 DSH 可执行文件与 bin.js；留空读环境变量 `DSH_EXE` / `DSH_BIN` |
| `overlayPath` | headless 的 overlay；留空 = `<家>/persona/headless-overlay.yml` |
| `selfcheckWeekday` | 周几做本周自检（`0`=周日，`1`=周一…） |

> ⚠️ **为什么一定要 overlay**：headless 默认找 `DEEPSEEK_API_KEY`，而桌面版用的是账号登录。
> 走 overlay 才复用账号凭证，否则会报 `MISSING_CREDENTIAL`。overlay 最简形态：
>
> ```yaml
> - id: credentials
>   disabled: false
> - id: authorization
>   disabled: false
> - id: deepseek-account
>   disabled: false
> - id: agent-default-model
>   config:
>     provider: deepseek-account
>     model: deepseek-flash
> ```

### 两种触发方式

**插件内定时**（推荐）：挂载后按 `runAt` 自己跑；启动时会补跑当天错过的任务。接口：

```
GET  /api/persona-journal/status     # 配置、状态、今天写没写
POST /api/persona-journal/run        # { "date": "2026-11-01", "dry": false }
```

**命令行**（想交给 cron / Windows 任务计划）：

```bash
node journal-cli.mjs                    # 写今天
node journal-cli.mjs --date 2026-10-30  # 补写某天
node journal-cli.mjs --dry              # 只拼 prompt，不调模型
node journal-cli.mjs --selfcheck        # 只跑本周自检
node journal-cli.mjs --config my.json   # 用指定配置
```

> Windows 上注意：任务计划里用 `wscript` 包一层隐藏启动，否则 `cmd` 窗口一关进程就被 `Ctrl+C` 杀掉（结果码 `0xC000013A`）。

### 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| `ACCOUNT_SIGN_IN_REQUIRED` / `MISSING_CREDENTIAL` | headless 找不到账号凭证 | **`DSH_HOME` 必须是真实的 `<用户>/.dsh`**，不能用临时/隔离目录跑；也不要依赖 `DEEPSEEK_API_KEY`（那是另一条鉴权路） |
| 日志里「只有 0 条可用片段，跳过」 | 当天没有素材 | 检查 `sources` 的 `dir` 对不对；QQ 那路要有 `snowluma-YYYY-MM-DD.log` |
| `inbox` 源一条都没读进来 | 开了 `markerOnly` 但没写标记 | 内容要包在 `<!-- diary -->` 与 `<!-- /diary -->` 之间 |
| 改了 `config.json` 不生效 | 老版本的问题 | 现在每次 tick 都会重读；仍然不生效就检查文件是否有 BOM（已做兼容） |
| 装不上 / 「下载没发现」 | 本机没装 git，或仓库根目录没有 `package.json` | 用 `link:` 本地安装；fork 时别把插件塞进子目录 |

---

## persona-distill（人格蒸馏）

保留原 `dsh-persona-distill` 的全部能力：

- 每天增量读素材（`voice.md` / `notes.md` / `digest/*.md`），候选进 `pending.md`
- 满足条件才定型：`lastPromote ≥ 周期` 且 `[说] 类 ≥ 3` 且所有源可读；**或**候选 ≥ 40 条
- 定型 = 覆盖写 `AGENTS.md` 的「我学来的」段，并归档候选
- 设置页可改 `runAt`、模型、是否启用

完整规则见 `prompts/distill.md`。

### 条数上限与淘汰

「我学来的」会一直变长，所以要有个天花板：

- **上限 90 条**（原则 / 场景样本 / 我怎么活 / 判断 合计）
- 没超就正常写；超了按**权重从低到高**淘汰回上限以内

权重：

| 项 | 加减 |
|---|---|
| 类别基准 | 原则 +3 / 判断 +3 / 我怎么活 +3 / 场景样本 +1.5 |
| 新近度 | 最近 7 天 +2；30 天内 +1；更早 0 |
| 稳定性 | 连续存在 3 版以上 +0.5 |

保护：每类至少留 2 条；**最近 7 天新增的这一轮不删**；不动标题、注释和 HAND 段。

一句话：**老的、场景类的、只出现过一两次的先走；判断类的、最近学的、反复验证过的留下。**

### 日记会自动变成蒸馏源

只要日记在写，蒸馏运行时会把它同步成 `external-persona-journal` 这个源（复用外部源适配器），于是这条链是通的：

```
聊天 / 手账 / 工作手记 → 片段 → 她挑几件 → 日记 → 蒸馏定型人格
```

细节：

- 日记目录取 `persona-journal/config.json` 里配的 `journalDir`，没配就用 `<家>/persona/journal`
- 同步产物：`source.json` + `digest/persona-journal.md`（每条日记一行）
- `voice.md` 会写一句「这个外部源不产说话样本」——**必须存在**，否则蒸馏的「源读不出来 → 禁止定型」降级保护会整轮罢工
- 日记不产「认识的修正 / 下一次如何回应」，所以 `notes.md` 里没有可摘的结论，这是正常的

---

## life-memory（会遗忘的记忆）

上下文放不下的时候，把最旧的几轮对话蒸馏成关键词线索，**从历史里物理删除**；
之后再提起那件事，顺着线索用 `recall_from_clues` 把记忆重新长出来。

```
上下文 ≤ 阈值        什么都不做
上下文 > 阈值
  → 挑最旧的「已完成」轮次
  → 抽关键词 + 线索种子，写进本地 SQLite
  → 那段历史替换成一条「记忆已折叠」提示
  → 需要时 recall_from_clues(关键词) 顺着线索回想
```

线索库默认在 `<家>/life-memory/memory.db`，不联网、不外传。

### 这个版本修了什么

思路来自 [`@tuhengyu/dsh-full-life-memory`](https://www.npmjs.com/package/@tuhengyu/dsh-full-life-memory)（MIT）。
实际跑下来发现几个**会让机制彻底失效**的问题，都已修掉：

| # | 问题 | 后果 | 修法 |
|---|---|---|---|
| 1 | 选区间时挑「事件日志里最旧的轮次」，但它们上次折叠时已被整段替换 | **每个会话只会折叠一次**，之后上下文无限增长（实测单步到 68 万 token） | 先算「surface 上还真实存在的轮次」，再从中挑最旧的 |
| 2 | `forgetTurns` 被内部 clamp 成 10 | 配多大都只能切 10 轮 | 上限放宽到 200 |
| 3 | 估算按 `chars / 3` 算 token | 中文低估约 1.8 倍，永远算不够，把能切的都切光 | 改成 `chars × 0.6` |
| 4 | 一次只切固定轮数 | 每轮都触发折叠，缓存刚建立就被冲掉 | 按「还差多少」累计，一次压回阈值以下 |
| 5 | 全局一套参数 | QQ 和桌面会话需求相反 | 支持按会话分策略 |

### 按会话分策略

```yaml
sessionsFile: 'E:/ai/qq-bridge/state/sessions.json'   # 能认出哪些 session 走激进策略的 JSON（旧名 qqSessionsFile 仍可用）
qqPolicy:
  aggressive:                                    # 列表里的会话：一次砍到阈值、只留 5 轮
    forgetThresholdTokens: 20000
    forgetTurns: 200
    keepCompletedTurns: 5
  gentle:                                        # 其它全部：阈值更高、留更多轮
    forgetThresholdTokens: 60000
    forgetTurns: 10
    keepCompletedTurns: 20
```

**不只 QQ**：刷 B 站、刷微博、定时任务这些插件跑在各自的会话里，默认走 `gentle`；
想让它们也压狠一点，把对应的 session id 加进同一个文件即可，不用改代码。

### 工具：`recall_from_clues`

```
recall_from_clues(keyword)   # 给一个具体词比整句好
```

- 只读本地 SQLite，返回一段**重建的记忆提示**，不是原文
- 最多 `limit` 条线索、`maxPromptChars` 字符；找不到返回 `found: false`
- ⚠️ 在「工具白名单」环境（如 QQ 桥接）里要把它加进执行期白名单，否则会出现「看得见、一调就被拒」

---

## 目录结构

```
dsh-persona-memory/
├── index.js            # persona-distill 的 host 半端
├── client.js           # persona-distill 的设置页
├── journal.js          # persona-journal 插件（定时 + HTTP + 可复用 runJournal）
├── journal-cli.mjs     # 日记命令行入口
├── life-memory/        # 会遗忘的记忆：折叠 + 线索 + recall 工具
├── lib/                # distill 的内部模块
├── prompts/            # 蒸馏用的提示词模板
├── cordis.patch.yml    # 一个包里挂两个插件
└── test/               # node --test
```

---

## 开发

```bash
node --test                  # 跑测试
node journal-cli.mjs --dry   # 不花 token 地检查日记提示词
```

---

## 致谢与许可

MIT。

`persona-distill` 部分源自 [dsh-persona-distill](https://github.com/Speraymer/dsh-persona-distill)（MIT，作者 Speraymer）。本仓库在该实现基础上：

- 保留原实现与测试
- 新增 `persona-journal`（日记）并与之合包
- 把定型周期做成可配置

日记部分（`journal.js` / `journal-cli.mjs`）为本仓库新增。

`life-memory` 部分源自 [@tuhengyu/dsh-full-life-memory](https://www.npmjs.com/package/@tuhengyu/dsh-full-life-memory)（MIT，作者 tuhengyu），本仓库修复了上面列出的 5 个问题并补了测试。
