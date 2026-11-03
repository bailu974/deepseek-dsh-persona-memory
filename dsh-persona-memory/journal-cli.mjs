#!/usr/bin/env node
/**
 * journal-cli.mjs —— 命令行写日记，适合交给系统定时任务（cron / 任务计划）。
 *
 * 用法：
 *   node journal-cli.mjs                 # 写今天（读 <家>/persona-journal/config.json）
 *   node journal-cli.mjs --date 2026-10-30   # 补写某天
 *   node journal-cli.mjs --dry           # 只拼 prompt，不调用模型
 *   node journal-cli.mjs --selfcheck     # 只跑本周自检
 *   node journal-cli.mjs --config <path> # 用指定配置文件
 */
import fs from 'node:fs';
import { loadConfig, normalizeConfig, runJournal } from './journal.js';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? String(argv[i + 1] ?? '').trim() : '';
};

let cfg = loadConfig();
const configPath = valueOf('--config');
if (configPath) {
  try {
    // Windows 上很容易存成带 BOM 的 UTF-8，JSON.parse 会直接报 Unexpected token
    const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
    cfg = normalizeConfig({ ...cfg, ...JSON.parse(raw) });
  } catch (error) {
    console.error(`[journal] 读取 --config 失败：${error?.message ?? error}`);
    process.exit(1);
  }
}

const result = runJournal(cfg, {
  date: valueOf('--date') || undefined,
  dry: has('--dry'),
  selfcheck: has('--selfcheck'),
  log: (msg) => console.log(`[journal] ${msg}`),
});

process.exit(result.ok ? 0 : 1);
