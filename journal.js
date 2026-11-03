/**
 * dsh-persona-memory / journal —— 让角色给自己写日记。
 *
 * 为什么单独一层：记忆是「发生了什么」，人格是「我是谁」。中间放一份**她自己筛过的日记**，
 * 既能将来喂给人格蒸馏，又不会让一次情绪直接定格成人设。
 *
 * 规则（写死在这里，别让模型自由发挥）：
 *   · 每天最多 N 行，宁缺毋滥（没意思就不写）
 *   · 不写人名 / 群名 / QQ 号 / 原文引用 / 承诺
 *   · 第一人称、口语、不总结不升华
 *   · 每周一天额外跑一次「本周自检」：看这 7 天都记了哪类事，偏了就写下来
 *
 * 两种用法：
 *   1. 装成插件（本文件作为 cordis 插件挂载）：按 runAt 自己定时，带 HTTP 接口
 *   2. 当命令行跑（见 journal-cli.mjs）：适合丢给系统定时任务（cron / 任务计划）
 *
 * 素材来源：SnowLuma 的每日日志（`snowluma-YYYY-MM-DD.log`）。
 * 只取白名单会话里别人说的话 —— 可选地读一份 bridge 的 config.json 拿 allow 名单。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { collectFromSources } from './lib/journal-sources.mjs';

export const name = 'persona-journal';
export const inject = ['webServer'];

const DEFAULTS = {
  enabled: true,
  runAt: '23:50',
  journalDir: '',
  fallbackJournalDir: '',
  snowlumaLogDir: '',
  bridgeConfigPath: '',
  dshExe: '',
  dshBin: '',
  overlayPath: '',
  model: '',
  maxLines: 3,
  maxSnippets: 120,
  maxSnippetsPerSource: 40,
  sources: [],
  home: '',
  minSnippets: 5,
  selfcheckWeekday: 1,
};

const JOURNAL_HEAD = (month) => `# 日记 · ${month}\n\n`;

export function dshHome() {
  if (process.env.DSH_HOME) return process.env.DSH_HOME;
  return path.join(process.env.USERPROFILE ?? os.homedir(), '.dsh');
}

function stateFile() {
  return path.join(dshHome(), 'persona-journal', 'state.json');
}

function configFile() {
  return path.join(dshHome(), 'persona-journal', 'config.json');
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeRunAt(value) {
  // 允许 9:5 / 09:05 / 23:50 这几种写法，统一补零
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(value ?? '').trim());
  if (!m) return DEFAULTS.runAt;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return DEFAULTS.runAt;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function normalizeConfig(raw) {
  const cfg = { ...DEFAULTS, ...(raw ?? {}) };
  cfg.enabled = cfg.enabled !== false;
  cfg.runAt = normalizeRunAt(cfg.runAt);
  cfg.maxLines = Number.isFinite(Number(cfg.maxLines)) ? Math.max(1, Math.min(10, Number(cfg.maxLines))) : DEFAULTS.maxLines;
  cfg.maxSnippets = Number.isFinite(Number(cfg.maxSnippets)) ? Math.max(5, Math.min(500, Number(cfg.maxSnippets))) : DEFAULTS.maxSnippets;
  cfg.minSnippets = Number.isFinite(Number(cfg.minSnippets)) ? Math.max(1, Number(cfg.minSnippets)) : DEFAULTS.minSnippets;
  cfg.selfcheckWeekday = Number.isInteger(Number(cfg.selfcheckWeekday)) ? Number(cfg.selfcheckWeekday) : DEFAULTS.selfcheckWeekday;
  cfg.maxSnippetsPerSource = Number.isFinite(Number(cfg.maxSnippetsPerSource))
    ? Math.max(1, Math.min(200, Number(cfg.maxSnippetsPerSource)))
    : DEFAULTS.maxSnippetsPerSource;
  cfg.sources = Array.isArray(cfg.sources) ? cfg.sources.filter((x) => x && typeof x === 'object') : [];
  cfg.home = (typeof cfg.home === 'string' && cfg.home.trim()) || dshHome();
  for (const key of ['journalDir', 'fallbackJournalDir', 'snowlumaLogDir', 'bridgeConfigPath', 'dshExe', 'dshBin', 'overlayPath', 'model']) {
    cfg[key] = typeof cfg[key] === 'string' ? cfg[key].trim() : '';
  }
  return cfg;
}

/** 只读磁盘上的配置（不带默认值），用来判断用户改过什么。 */
function readDiskConfig() {
  const raw = readJson(configFile(), null);
  return raw && typeof raw === 'object' ? raw : {};
}

/** 配置文件：<家>/persona-journal/config.json（存在就用它，缺字段回落到默认值）。 */
export function loadConfig(overrides = {}) {
  const fromDisk = readJson(configFile(), {}) ?? {};
  return normalizeConfig({ ...fromDisk, ...overrides });
}

export function saveConfig(patch) {
  const next = normalizeConfig({ ...(readJson(configFile(), {}) ?? {}), ...patch });
  writeJson(configFile(), next);
  return next;
}

/** 日记目录：配置优先，其次兜底目录；不可写就往下退。 */
export function resolveJournalDir(cfg, log = () => {}) {
  const fallback = cfg.fallbackJournalDir || path.join(dshHome(), 'persona', 'journal');
  const candidates = [cfg.journalDir, fallback].filter(Boolean);
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      if (dir !== cfg.journalDir && cfg.journalDir) log(`⚠️ 日记目录退回 ${dir}（${cfg.journalDir} 不可用）`);
      return dir;
    } catch {
      /* 试下一个 */
    }
  }
  return fallback;
}

export function today(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function allowedKeys(cfg) {
  if (!cfg.bridgeConfigPath) return null; // 没配白名单 = 不过滤
  const raw = readJson(cfg.bridgeConfigPath, null);
  if (!raw) return null;
  const groups = new Set((raw?.allow?.groups ?? []).map(String));
  const privates = new Set((raw?.allow?.private ?? []).map(String));
  return { groups, privates };
}

/** 从 SnowLuma 日志里抽当天的聊天片段（只取别人的话，不带媒体占位）。 */
/**
 * 收集当天片段：交给多源层（QQ 日志 / inbox 手记 / 外部适配器）。
 * 保留这个函数名是为了向后兼容与测试。
 */
export function collectSnippets(cfg, date, log = () => {}) {
  return collectFromSources(cfg, date, log);
}

function stripNoise(s) {
  return String(s ?? '')
    .split('\n')
    .filter((l) => !/^\[llm-|^\[dsh|^\[mcp|^\[plugin|model listing|skipped \d+ row/.test(l.trim()))
    .join('\n')
    .trim();
}

/** 调一次 headless，返回纯文本。 */
function runHeadless(cfg, prompt) {
  const exe = cfg.dshExe || process.env.DSH_EXE || '';
  const bin = cfg.dshBin || process.env.DSH_BIN || '';
  if (!exe || !bin) {
    throw new Error('缺少 dshExe / dshBin 配置：日记要靠 DSH 的 headless 跑一次模型，路径填在插件设置里');
  }
  const args = [bin, 'headless'];
  // 关键：走 overlay。否则 headless 会找 DEEPSEEK_API_KEY，而桌面版用的是账号登录。
  const overlay = cfg.overlayPath || path.join(dshHome(), 'persona', 'headless-overlay.yml');
  if (fs.existsSync(overlay)) args.push('--patch', overlay);
  if (cfg.model) args.push('--model', cfg.model);
  args.push(prompt);
  try {
    const out = execFileSync(exe, args, {
      encoding: 'utf8',
      timeout: 180000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return stripNoise(out);
  } catch (error) {
    // execFileSync 的 message 会把整条命令行（含 prompt 里的聊天片段）抄进来。
    // 这里只留一行可读原因，避免把私聊内容写进 state.json / 日志。
    const raw = String(error?.stderr || '') || String(error?.message || '');
    const line = raw
      .split('\n')
      .map((l) => l.trim())
      .find((l) => /^dsh:\s|MISSING_CREDENTIAL|ACCOUNT_SIGN_IN_REQUIRED|Error:/.test(l)) || raw.split('\n').pop() || 'headless 失败';
    throw new Error(line.slice(0, 300));
  }
}

function buildDiaryPrompt(cfg, snippets) {
  return [
    '你是这个角色。下面是今天你在聊天里看到的一些片段。',
    '挑出你**真心觉得有意思、有感觉**的（最多 ' + cfg.maxLines + ' 件），写成今天的日记。',
    '',
    '硬规则：',
    `1. 最多 ${cfg.maxLines} 行，每行一句话；没意思就只写「今天没什么」。`,
    '2. 不许出现人名、群名、QQ 号，不许引用原话，不许复述对话内容。',
    '3. 第一人称、口语、短。不要总结、不要升华、不要写「今天我学到了」。',
    '4. 只写你在意的那个点，不写谁说了什么。',
    '',
    '—— 今天的片段 ——',
    ...snippets,
    '',
    '只输出日记正文，不要任何解释。',
  ].join('\n');
}

function buildSelfcheckPrompt(entries) {
  return [
    '你是这个角色。下面是你这 7 天写的日记。',
    '请你自检一件事：**你最近记的都是哪一类事？有没有偏？**',
    '',
    '硬规则：',
    '1. 最多 4 行。第一行写构成（例如「3 条吃的、2 条被怼」），后面写你觉得偏在哪。',
    '2. 不许提人名、群名、QQ 号。不要自我批评上价值，实话实说就行。',
    '3. 如果没偏，就直说「没偏」。',
    '',
    '—— 最近 7 天的日记 ——',
    ...entries,
    '',
    '只输出正文。',
  ].join('\n');
}

function journalFileFor(cfg, date, log) {
  return path.join(resolveJournalDir(cfg, log), `${date.slice(0, 7)}.md`);
}

function hasEntryFor(cfg, date, log) {
  const file = journalFileFor(cfg, date, log);
  if (!fs.existsSync(file)) return false;
  return fs.readFileSync(file, 'utf8').includes(`## ${date}`);
}

function appendToJournal(cfg, date, block, log) {
  const dir = resolveJournalDir(cfg, log);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${date.slice(0, 7)}.md`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JOURNAL_HEAD(date.slice(0, 7)), 'utf8');
  fs.appendFileSync(file, block, 'utf8');
  return file;
}

function readRecentEntries(cfg, days = 7, log) {
  const entries = [];
  for (let i = 1; i <= days; i += 1) {
    const date = today(-i);
    const file = journalFileFor(cfg, date, log);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const m = new RegExp(`## ${date}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(text);
    if (m) entries.push(`[${date}]\n${m[1].trim()}`);
  }
  return entries;
}

/**
 * 写一篇日记。
 * @returns {{ok:boolean, wrote:boolean, date:string, reason?:string, file?:string}}
 */
export function runJournal(cfgInput, options = {}) {
  const cfg = normalizeConfig(cfgInput ?? loadConfig());
  const log = options.log ?? ((msg) => console.log(`[journal] ${msg}`));
  const date = options.date || today();
  const dry = options.dry === true;
  const onlySelfcheck = options.selfcheck === true;

  const result = { ok: true, wrote: false, date };

  if (!onlySelfcheck) {
    if (hasEntryFor(cfg, date, log)) {
      log(`今天（${date}）已经写过日记，跳过`);
      result.reason = 'already-written';
    } else {
      const snippets = collectSnippets(cfg, date);
      if (snippets.length < cfg.minSnippets) {
        log(`今天只有 ${snippets.length} 条可用片段，跳过（不值得写）`);
        result.reason = 'not-enough-snippets';
      } else {
        const prompt = buildDiaryPrompt(cfg, snippets);
        if (dry) {
          result.prompt = prompt;
          result.reason = 'dry-run';
          log(`dry-run：拼好 prompt（${snippets.length} 条片段），没有调用模型`);
        } else {
          log(`片段 ${snippets.length} 条，调用模型…`);
          const text = runHeadless(cfg, prompt);
          const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, cfg.maxLines + 2);
          if (!lines.length) {
            log('模型没有输出，跳过');
            result.reason = 'empty-model-output';
          } else {
            result.file = appendToJournal(cfg, date, `## ${date}\n\n${lines.join('\n')}\n\n`, log);
            result.wrote = true;
            log(`已写入 ${result.file}`);
          }
        }
      }
    }
  }

  const isSelfcheckDay = new Date().getDay() === cfg.selfcheckWeekday;
  if ((isSelfcheckDay || onlySelfcheck) && !dry) {
    const entries = readRecentEntries(cfg, 7, log);
    if (entries.length < 3) {
      log(`最近 7 天只有 ${entries.length} 篇日记，自检跳过`);
    } else {
      log(`本周自检：读 ${entries.length} 篇日记…`);
      try {
        const text = runHeadless(cfg, buildSelfcheckPrompt(entries));
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6);
        if (lines.length) {
          result.file = appendToJournal(cfg, date, `### 本周自检（${date}）\n\n${lines.join('\n')}\n\n`, log);
          log(`自检已写入 ${result.file}`);
        }
      } catch (error) {
        log(`自检失败：${error?.message ?? error}`);
      }
    }
  }

  return result;
}

function readState() {
  return readJson(stateFile(), { lastFiredDay: '', lastResult: '', lastRunAt: '' }) ?? {};
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  writeJson(stateFile(), next);
  return next;
}

/** 插件入口：装进 DSH 后自动按 runAt 每天跑一次（错过会补跑）。 */
export function apply(ctx, config) {
  // patch 里的 config 只是默认值；用户在设置页/配置文件里改的东西优先。
  const cfg = normalizeConfig({ ...(config ?? {}), ...readDiskConfig() });
  if (!cfg.enabled) {
    ctx.logger?.info?.('persona-journal: 已禁用（enabled=false）');
    return;
  }

  const log = (msg) => {
    const line = `persona-journal: ${msg}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(`[journal] ${msg}`);
  };

  let retryAfter = 0;

  const fire = (live) => {
    // 先认今天，避免连续失败时每分钟重试刷屏；失败后 30 分钟才允许再试。
    writeState({ lastFiredDay: today(), lastRunAt: new Date().toISOString(), lastResult: 'running' });
    try {
      const r = runJournal(live, { log });
      writeState({ lastResult: r.wrote ? 'wrote' : (r.reason ?? 'skipped'), lastFile: r.file ?? '', lastError: '' });
    } catch (error) {
      log(`定时运行失败：${error?.message ?? error}`);
      const reason = String(error?.message ?? error).slice(0, 300);
      writeState({ lastResult: `error: ${reason}`, lastError: reason });
      retryAfter = Date.now() + 30 * 60_000;
    }
  };

  const tick = () => {
    // 每次 tick 重读配置：改 runAt / 目录不用重启。
    const live = normalizeConfig({ ...(config ?? {}), ...readDiskConfig() });
    if (!live.enabled) return;
    const now = new Date();
    const [hh, mm] = live.runAt.split(':').map(Number);
    if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return;

    const state = readState();
    if (state.lastFiredDay === today()) {
      // 今天跑过：成功就不再跑；失败过的话，冷却结束后允许再试一次
      if (!state.lastError) return;
      if (Date.now() < retryAfter) return;
    }
    fire(live);
  };

  // 启动先补跑一次（昨天没跑成的话今天开机就补），再每分钟检查。
  setTimeout(tick, 15_000);
  const timer = setInterval(tick, 60_000);
  if (typeof timer.unref === 'function') timer.unref();
  ctx.effect?.(() => () => clearInterval(timer));

  const webServer = ctx.get?.('webServer') ?? ctx.webServer;
  if (webServer && typeof webServer.register === 'function') {
    try {
      ctx.effect?.(() => webServer.register({
      kind: 'prefix',
      path: '/api/persona-journal',
      handler: async (req, res) => {
        try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const send = (code, body) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(body));
        };
        if (req.method === 'GET' && url.pathname === '/api/persona-journal/status') {
          send(200, {
            ok: true,
            config: cfg,
            state: readState(),
            journalDir: resolveJournalDir(cfg, log),
            todayEntry: hasEntryFor(cfg, today(), log),
          });
          return;
        }
        if (req.method === 'POST' && url.pathname === '/api/persona-journal/run') {
          let body = {};
          try {
            body = JSON.parse(await readBody(req) || '{}');
          } catch {
            body = {};
          }
          try {
            const r = runJournal({ ...cfg, ...(body.config ?? {}) }, { date: body.date, dry: body.dry === true });
            send(200, { ok: true, result: r });
          } catch (error) {
            send(500, { ok: false, error: String(error?.message ?? error) });
          }
          return;
        }
        if (req.method === 'GET' && url.pathname === '/api/persona-journal/config') {
          send(200, { ok: true, config: cfg });
          return;
        }
        send(404, { ok: false, error: 'not found' });
        } catch (error) {
          try {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
          } catch { /* 响应已经发过了 */ }
        }
      },
      }), 'persona-journal: /api/persona-journal 路由');
    } catch (error) {
      log(`HTTP 路由没挂上：${error?.message ?? error}`);
    }
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
