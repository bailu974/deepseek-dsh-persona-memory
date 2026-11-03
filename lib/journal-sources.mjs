/**
 * journal-sources —— 日记的「原料渠道」。
 *
 * 日记不绑死某个渠道：任何能产出「当天片段」的东西都可以注册成源。
 * 内置三种类型：
 *
 *   snowluma-log  QQ 网关的日志（snowluma-YYYY-MM-DD.log），只取别人的话
 *   inbox         一个目录里的人工/半自动手记：
 *                   · <dir>/YYYY-MM-DD.md          （当天一篇）
 *                   · <dir>/YYYY-MM.md             （按月，用 ## YYYY-MM-DD 分节）
 *                   · markerOnly=true 时只取 <!-- diary --> 与 <!-- /diary --> 之间的内容，
 *                     适合「干活」这种需要人工划线才进日记的渠道
 *   external      复用 distill 的外部源适配器（B站手账等），按日期取当天条目
 *
 * 统一输出：`HH:MM [渠道名] 文本` 或 `[渠道名] 文本`。
 */
import fs from 'node:fs';
import path from 'node:path';

import { ADAPTERS } from './external.mjs';

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- QQ 日志

function allowedKeys(bridgeConfigPath) {
  if (!bridgeConfigPath) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(bridgeConfigPath, 'utf8').replace(/^\uFEFF/, ''));
    return {
      groups: new Set((raw?.allow?.groups ?? []).map(String)),
      privates: new Set((raw?.allow?.private ?? []).map(String)),
    };
  } catch {
    return null;
  }
}

function fromSnowlumaLog(source, date, cfg) {
  const dir = source.dir || cfg.snowlumaLogDir;
  if (!dir) return [];
  const file = path.join(dir, `snowluma-${date}.log`);
  if (!fs.existsSync(file)) return [];

  const allow = allowedKeys(source.bridgeConfigPath || cfg.bridgeConfigPath);
  const out = [];
  const seen = new Set();

  for (const line of readText(file).split('\n')) {
    const m = /^(\d{2}:\d{2}:\d{2}).*?\[Event\]\s+(?:群 \[(.+?)\((\d+)\)\] \| \[.+?\((\d+)\)\]|私聊 \[.+?\((\d+)\)\]):\s*(.*)$/.exec(line);
    if (!m) continue;
    const groupName = m[2];
    const groupId = m[3];
    const senderId = m[4];
    const privateId = m[5];
    let text = m[6];

    if (allow) {
      const ok = groupId
        ? allow.groups.has(groupId)
        : allow.privates.has(privateId) || allow.privates.has(senderId);
      if (!ok) continue;
    }

    text = text.replace(/^ID:\S+\s*/, '');
    while (/^\[(回复|引用)/.test(text)) {
      let depth = 0;
      let end = -1;
      for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '[') depth += 1;
        else if (text[i] === ']') {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      if (end < 0) break;
      text = text.slice(end + 1).trimStart();
    }
    text = text
      .replace(/@\d+/g, '')
      .replace(/\[CQ:[^\]]*\]/g, '')
      .replace(/\[(图片|表情|语音|视频|文件|动画表情|空消息|Markdown|转发消息[^\]]*)\]/g, '')
      .trim();

    if (!text || text.length < 2 || text.length > 100) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(`${m[1]} ${groupName ? `[${groupName}] ` : ''}${text}`);
    if (out.length >= (source.limit || cfg.maxSnippetsPerSource)) break;
  }
  return out;
}

// ---------------------------------------------------------------- 手记 inbox

/** 取出 `## YYYY-MM-DD` 那一节；没有分节就整篇。 */
function sectionForDate(text, date) {
  const m = new RegExp(`^##\\s+${date}\\s*$`, 'm').exec(text);
  if (!m) return text;
  const rest = text.slice(m.index + m[0].length);
  const next = /^##\s+\d{4}-\d{2}-\d{2}\s*$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** markerOnly：只取 <!-- diary --> ... <!-- /diary --> 之间。 */
function markerBlock(text) {
  const m = /<!--\s*diary\s*-->([\s\S]*?)<!--\s*\/diary\s*-->/i.exec(text);
  return m ? m[1] : '';
}

function fromInbox(source, date, cfg) {
  const dir = source.dir;
  if (!dir) return [];
  const daily = path.join(dir, `${date}.md`);
  const monthly = path.join(dir, `${date.slice(0, 7)}.md`);
  let text = fs.existsSync(daily) ? readText(daily) : (fs.existsSync(monthly) ? sectionForDate(readText(monthly), date) : '');
  if (!text) return [];
  if (source.markerOnly) {
    text = markerBlock(text);
    if (!text) return [];
  }
  const out = [];
  const seen = new Set();
  for (const raw of text.split('\n')) {
    let line = raw.replace(/^\s*[-*+]\s*/, '').replace(/^#+\s*/, '').trim();
    if (!line) continue;
    if (line.length > 200) line = line.slice(0, 200);
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(`[${source.label || '工作'}] ${line}`);
    if (out.length >= (source.limit || cfg.maxSnippetsPerSource)) break;
  }
  return out;
}

// ---------------------------------------------------------------- 外部适配器

function fromExternal(source, date, cfg) {
  const adapter = ADAPTERS.find((a) => a.id === (source.adapter || source.id));
  if (!adapter) return [];
  const home = source.home || cfg.home;
  let files = [];
  try {
    files = (adapter.files ? adapter.files(home) : []).filter((f) => fs.existsSync(f));
  } catch {
    return [];
  }
  const out = [];
  for (const file of files) {
    let entries = [];
    try {
      entries = adapter.parse(readText(file)) || [];
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (e.date && e.date !== date) continue;
      const text = String(e.excerpt || e.title || '').trim();
      if (!text) continue;
      out.push(`[${source.label || adapter.name}] ${text}`);
      if (out.length >= (source.limit || cfg.maxSnippetsPerSource)) break;
    }
    if (out.length >= (source.limit || cfg.maxSnippetsPerSource)) break;
  }
  return out;
}

// ---------------------------------------------------------------- 入口

/** 默认源：配了 snowlumaLogDir 就只读 QQ，保持旧行为不变。 */
function defaultSources(cfg) {
  if (!cfg.snowlumaLogDir) return [];
  return [{ type: 'snowluma-log', dir: cfg.snowlumaLogDir }];
}

/**
 * 收集当天所有源的片段。
 * @returns {string[]} 形如 `12:03 [群名] 文本` / `[工作] 文本`
 */
export function collectFromSources(cfg, date, log = () => {}) {
  const sources = Array.isArray(cfg.sources) && cfg.sources.length ? cfg.sources : defaultSources(cfg);
  const out = [];
  for (const source of sources) {
    if (!source || source.enabled === false) continue;
    const type = String(source.type || '').trim();
    let got = [];
    try {
      if (type === 'snowluma-log') got = fromSnowlumaLog(source, date, cfg);
      else if (type === 'inbox') got = fromInbox(source, date, cfg);
      else if (type === 'external') got = fromExternal(source, date, cfg);
    } catch (error) {
      log(`源 ${type || '?'} 读取失败：${error?.message ?? error}`);
      got = [];
    }
    if (got.length) {
      log(`源 ${source.label || type}：${got.length} 条`);
      out.push(...got);
    }
    if (out.length >= cfg.maxSnippets) break;
  }
  return out.slice(0, cfg.maxSnippets);
}
