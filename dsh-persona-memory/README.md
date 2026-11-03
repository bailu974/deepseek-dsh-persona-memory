# dsh-persona-memory

给 [DeepSeek Harness](https://github.com/deepseek-ai) 用的两个互补插件，打在一个包里：

| 插件 | 干什么 | 何时动 |
|---|---|---|
| **persona-distill** | 人格蒸馏：把每天刷到的素材攒成候选，定期定型进 `AGENTS.md` 的「我学来的」 | 每天增量读素材，满周期定型 |
| **persona-journal** | 日记：从聊天日志里挑出她**自己觉得有意思**的三件事，写进月度日记 | 每天一个时间点 |

一句话：**记忆是「发生了什么」，人格是「我是谁」。中间放一份她自己筛过的日记，既不让人格被一次情绪带偏，也留住了她自己的视角。**

---

## 安装

```bash
dsh plugin --profile desktop add dsh-persona-memory
```

本地开发：

```bash
dsh plugin --profile desktop add link:/path/to/dsh-persona-memory
```

装好后 profile 的 `dsh.profile.bundles` 会多出两项，对应两个可分别开关的插件：

```yaml
- id: persona-distill   # 人格蒸馏
- id: persona-journal   # 日记
```

---

## persona-journal（日记）

### 它怎么工作

1. 读当天的 SnowLuma 日志（`snowluma-YYYY-MM-DD.log`），只取**别人说的话**
   - 配了 `bridgeConfigPath` 的话，只取 `allow.groups` / `allow.private` 白名单里的会话
2. 片段少于 `minSnippets` 条 → 当天不写（不值得写）
3. 调一次 headless 模型，按硬规则写最多 `maxLines` 行
4. 追加到 `journalDir/YYYY-MM.md`

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
  "maxLines": 3,
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

---

## persona-distill（人格蒸馏）

保留原 `dsh-persona-distill` 的全部能力：

- 每天增量读素材（`voice.md` / `notes.md` / `digest/*.md`），候选进 `pending.md`
- 满足条件才定型：`lastPromote ≥ 周期` 且 `[说] 类 ≥ 3` 且所有源可读；**或**候选 ≥ 40 条
- 定型 = 覆盖写 `AGENTS.md` 的「我学来的」段，并归档候选
- 设置页可改 `runAt`、模型、是否启用

完整规则见 `prompts/distill.md`。

---

## 目录结构

```
dsh-persona-memory/
├── index.js            # persona-distill 的 host 半端
├── client.js           # persona-distill 的设置页
├── journal.js          # persona-journal 插件（定时 + HTTP + 可复用 runJournal）
├── journal-cli.mjs     # 日记命令行入口
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
